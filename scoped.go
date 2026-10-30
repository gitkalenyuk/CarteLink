package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"cartelgate/internal/config"
	"cartelgate/internal/web"
)

// Gin context key: the scoped API key of this request (*config.ScopedKey).
const ctxScopedKey = "cl.scopedKey"

// requestKeys lists every credential the engine would accept the request with
// (same places as its config-access provider). All of them are checked, so a
// scoped key cannot slip past its limits in a less common spot.
func requestKeys(r *http.Request) []string {
	bearer := r.Header.Get("Authorization")
	if parts := strings.SplitN(bearer, " ", 2); len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
		bearer = strings.TrimSpace(parts[1])
	}
	q := r.URL.Query()
	return []string{bearer, r.Header.Get("X-Goog-Api-Key"), r.Header.Get("X-Api-Key"), q.Get("key"), q.Get("auth_token")}
}

// scopedKeyOf finds the scoped key a request carries. known=false means it
// carries a scoped-format key that no longer exists: that key must be refused
// (the engine may hold it for a moment after deletion).
func scopedKeyOf(cfg *config.Config, r *http.Request) (key *config.ScopedKey, known bool) {
	known = true
	for _, k := range requestKeys(r) {
		if !strings.HasPrefix(k, config.ScopedKeyPrefix) {
			continue
		}
		if sk := cfg.FindScopedKey(k); sk != nil {
			return sk, true
		}
		known = false
	}
	return nil, known
}

// scopedAllowedPath is the whole API surface of a scoped key: only routes
// where the model is known and checked. Everything else (WebSockets, realtime,
// videos, Codex search…) has no model to check, or carries it elsewhere.
func scopedAllowedPath(method, p string) bool {
	switch method {
	case http.MethodGet:
		return p == "/v1/models" || p == "/models" || p == "/v1beta/models" || strings.HasPrefix(p, "/v1beta/models/")
	case http.MethodPost:
		return scopedBodyModelPath(p) || strings.HasPrefix(p, "/v1beta/models/")
	}
	return false
}

// scopedBodyModelPath: POST routes with the model in a JSON body.
func scopedBodyModelPath(p string) bool {
	switch p {
	case "/v1/messages", "/v1/messages/count_tokens", "/v1/chat/completions", "/v1/completions",
		"/v1/responses", "/v1/responses/compact", "/v1/images/generations":
		return true
	}
	return false
}

// scopedModelMatch returns the requested model as the engine should get it, if
// the key allows it. Client decorations do not change which model it is: the
// "[1m]" marker, cloaked Claude ids, a "(high)" reasoning suffix.
func scopedModelMatch(sk *config.ScopedKey, want string) (string, bool) {
	name := strings.TrimSpace(uncloakClaudeDDModel(strip1M(want)))
	base, suffix := name, ""
	if open := strings.LastIndex(name, "("); open > 0 && strings.HasSuffix(name, ")") {
		base, suffix = name[:open], name[open:]
	}
	for _, m := range sk.Models {
		if strings.EqualFold(m, base) {
			return m + suffix, true
		}
	}
	return "", false
}

// scopedGeminiModel extracts the model from a Gemini path the way the engine
// does: /v1beta/models/<model>[:<method>].
func scopedGeminiModel(p string) string {
	tail := strings.TrimPrefix(p, "/v1beta/models/")
	if parts := strings.Split(tail, ":"); len(parts) <= 2 {
		return parts[0]
	}
	return ""
}

// scopedReject answers a request a scoped key may not make.
func scopedReject(c *gin.Context, app *web.App, status int, code, model, message string) {
	app.ErrorLog().Add(web.ErrorEntry{Status: status, Kind: "gateway", Method: c.Request.Method,
		Path: c.Request.URL.Path, Model: model, Client: c.Request.UserAgent(), Message: code + ": " + message})
	errType := "permission_error"
	switch status {
	case http.StatusUnauthorized:
		errType = "authentication_error"
	case http.StatusBadRequest:
		errType = "invalid_request_error"
	}
	c.AbortWithStatusJSON(status, gin.H{
		"type":  "error",
		"error": gin.H{"type": errType, "code": code, "message": message},
	})
}

func scopedModelRefused(c *gin.Context, app *web.App, sk *config.ScopedKey, model string) {
	scopedReject(c, app, http.StatusForbidden, "model_not_allowed", model,
		"model \""+model+"\" is not available for API key \""+sk.Name+"\". Available: "+strings.Join(sk.Models, ", "))
}

// enforceScopedKey applies a scoped key's limits ahead of the engine and
// reports whether the request may go on. Requests without a scoped key are
// not affected.
func enforceScopedKey(c *gin.Context, app *web.App) bool {
	cfg := app.CurrentConfig()
	sk, known := scopedKeyOf(cfg, c.Request)
	if !known {
		scopedReject(c, app, http.StatusUnauthorized, "invalid_api_key", "", "this CarteLink API key was deleted")
		return false
	}
	if sk == nil {
		return true
	}
	p := c.Request.URL.Path
	if !scopedAllowedPath(c.Request.Method, p) {
		scopedReject(c, app, http.StatusForbidden, "endpoint_not_allowed", "",
			"API key \""+sk.Name+"\" cannot use "+c.Request.Method+" "+p)
		return false
	}
	c.Set(ctxScopedKey, sk)
	if strings.HasPrefix(p, "/v1beta/models/") {
		model := scopedGeminiModel(p)
		if _, ok := scopedModelMatch(sk, model); !ok || isBlacklisted(cfg, model) {
			scopedModelRefused(c, app, sk, model)
			return false
		}
	}
	return true
}

func scopedKeyFromContext(c *gin.Context) *config.ScopedKey {
	if v, ok := c.Get(ctxScopedKey); ok {
		if sk, ok := v.(*config.ScopedKey); ok {
			return sk
		}
	}
	return nil
}

// scopedCatalog is what /v1/models shows a scoped key: its models, with the
// engine's description when it has one.
func scopedCatalog(sk *config.ScopedKey, upstream []map[string]any) []catalogModel {
	byID := make(map[string]map[string]any, len(upstream))
	for _, raw := range upstream {
		id, _ := raw["id"].(string)
		byID[strings.ToLower(uncloakClaudeDDModel(id))] = raw
	}
	out := make([]catalogModel, 0, len(sk.Models))
	for _, id := range sk.Models {
		m := catalogModel{ID: id, DisplayName: friendlyModelName(id), OwnedBy: "cartelink"}
		if raw := byID[strings.ToLower(id)]; raw != nil {
			if owned, _ := raw["owned_by"].(string); owned != "" {
				m.OwnedBy = owned
			}
			if name, _ := raw["display_name"].(string); name != "" && !strings.Contains(name, "claude-fable-5-dd") {
				m.DisplayName = name
			}
		}
		out = append(out, m)
	}
	return out
}

// scopedFilterModelList keeps the allowed entries of an engine list in its
// native format ({"models":[…]}): Gemini lists name them "models/<id>", the
// Codex catalogue "slug". Anything unreadable becomes an empty list.
func scopedFilterModelList(cfg *config.Config, sk *config.ScopedKey, body []byte) []byte {
	var doc map[string]json.RawMessage
	if json.Unmarshal(body, &doc) != nil || doc == nil {
		doc = map[string]json.RawMessage{}
	}
	var models []map[string]json.RawMessage
	_ = json.Unmarshal(doc["models"], &models)
	kept := make([]map[string]json.RawMessage, 0, len(models))
	for _, m := range models {
		var id string
		_ = json.Unmarshal(m["slug"], &id)
		if id == "" {
			_ = json.Unmarshal(m["name"], &id)
		}
		id = strings.TrimPrefix(id, "models/")
		if _, ok := scopedModelMatch(sk, id); ok && !isBlacklisted(cfg, id) {
			kept = append(kept, m)
		}
	}
	doc["models"], _ = json.Marshal(kept)
	out, err := json.Marshal(doc)
	if err != nil {
		return []byte(`{"models":[]}`)
	}
	return out
}

// handleScopedEngineList serves a list the engine answers in its own format
// (Gemini models, Codex catalogue) filtered down to a scoped key's models.
// GET /v1beta/models/<id> describes one model, already checked by
// enforceScopedKey: it passes through as it is.
func handleScopedEngineList(c *gin.Context, app *web.App, sk *config.ScopedKey) {
	if strings.HasPrefix(c.Request.URL.Path, "/v1beta/models/") {
		c.Next()
		return
	}
	rec := newResponseRecorder(c.Writer)
	c.Writer = rec
	c.Next()
	out := rec.body.Bytes()
	if rec.statusCode == http.StatusOK {
		out = scopedFilterModelList(app.CurrentConfig(), sk, out)
		rec.header.Set("Content-Length", strconv.Itoa(len(out)))
	}
	for k, v := range rec.header {
		rec.ResponseWriter.Header()[k] = v
	}
	rec.ResponseWriter.WriteHeader(rec.statusCode)
	_, _ = rec.ResponseWriter.Write(out)
}
