// Handlers for the Server page's live controls: Start/Stop/Restart buttons,
// key generation, and turning OAuth auth-file accounts into provider entries
// (which makes their real models selectable on the Models page).
package web

import (
	crand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"visiongate/internal/config"
)

// apiServerStart: POST /api/server/start
func (a *App) apiServerStart(w http.ResponseWriter, r *http.Request) {
	if err := a.EngineStart(); err != nil {
		jsonWrite(w, http.StatusConflict, anyMap{"ok": false, "error": err.Error()})
		return
	}
	// Wait briefly for real readiness so the UI doesn't show Running too early.
	ready := a.waitForEngine(5 * time.Second)
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "running": ready})
}

// apiServerStop: POST /api/server/stop
func (a *App) apiServerStop(w http.ResponseWriter, r *http.Request) {
	a.EngineStop()
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "running": false})
}

// apiServerRestart: POST /api/server/restart
func (a *App) apiServerRestart(w http.ResponseWriter, r *http.Request) {
	if err := a.EngineRestart(); err != nil {
		jsonWrite(w, http.StatusConflict, anyMap{"ok": false, "error": err.Error()})
		return
	}
	ready := a.waitForEngine(5 * time.Second)
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "running": ready})
}

// waitForEngine polls the engine state plus a live /healthz probe until the
// engine answers or the deadline passes.
func (a *App) waitForEngine(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if a.EngineRunning() {
			port := a.snapshotConfig().Cliproxy.Port
			client := &http.Client{Timeout: time.Second}
			if resp, err := client.Get("http://127.0.0.1:" + itoa(port) + "/healthz"); err == nil {
				_ = resp.Body.Close()
				if resp.StatusCode >= 200 && resp.StatusCode < 500 {
					return true
				}
			}
		}
		time.Sleep(150 * time.Millisecond)
	}
	return a.EngineRunning()
}

// apiGenerateKey: POST /api/generate-key — replace the local gateway key with
// a fresh random "vg-…" one and persist it. The engine's client key list is
// updated live through the management API so the new key works immediately.
func (a *App) apiGenerateKey(w http.ResponseWriter, r *http.Request) {
	cfg := a.snapshotConfig()
	cfg.APIKey = "vg-" + randomHex(24)
	if cfg.RequireKey {
		// Keep the engine in sync: the VisionGate key is the first client key.
		keys := append([]string{cfg.APIKey}, cfg.Cliproxy.APIKeys...)
		if status, raw, _ := a.mgmtRequest(http.MethodPut, "/v0/management/api-keys", mustJSON(keys)); status >= 300 {
			// Engine refused (offline?) — config still saved; YAML syncs on restart.
			_ = raw
		}
		cfg.Cliproxy.APIKeys = keys
	}
	if err := cfg.Save(); err != nil {
		jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": err.Error()})
		return
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "key": cfg.APIKey})
}

// mustJSON marshals v, returning null-bytes on failure (never happens for
// the simple values used here).
func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("null")
	}
	return b
}

// apiAccountToProvider: POST /api/account-to-provider {"name": "<auth file>"}.
// Creates/updates a VisionGate provider entry carrying the account's real
// model list (fetched from the engine), so the Models page can offer those
// models in the tier dropdowns. The engine itself already routes by model
// name — this entry is the user-visible handle for the account.
func (a *App) apiAccountToProvider(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req)
	name := strings.TrimSpace(req.Name)
	if name == "" {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "name is required"})
		return
	}

	// Fetch the account's models from the engine (best effort).
	models := []string{}
	status, raw, _ := a.mgmtRequest(http.MethodGet, "/v0/management/auth-files/models?name="+url.QueryEscape(name), nil)
	if status == 200 {
		var parsed struct {
			Models []struct {
				ID string `json:"id"`
			} `json:"models"`
		}
		if json.Unmarshal(raw, &parsed) == nil {
			for _, m := range parsed.Models {
				if id := strings.TrimSpace(m.ID); id != "" {
					models = append(models, id)
				}
			}
		}
	}

	// Which OAuth family is this account? Drives the provider label/id.
	family := accountFamily(name)
	id := "cp-" + family + "-" + shortID(name)

	a.mu.Lock()
	cfg := a.cfg
	replaced := false
	for i := range cfg.Providers {
		if cfg.Providers[i].ID == id {
			cfg.Providers[i].Models = models
			cfg.Providers[i].Enabled = true
			replaced = true
			break
		}
	}
	if !replaced {
		cfg.Providers = append(cfg.Providers, config.Provider{
			ID:      id,
			Label:   family + " · " + displayName(name),
			BaseURL: "embedded://cliproxy",
			Format:  "openai",
			Keys:    []string{},
			Models:  models,
			Enabled: true,
		})
	}
	err := cfg.Save()
	a.mu.Unlock()
	if err != nil {
		jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": err.Error()})
		return
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "id": id, "models": len(models)})
}

// accountFamily guesses the account family from the auth file name:
// "antigravity-name@gmail.com.json" → "antigravity".
func accountFamily(name string) string {
	base := baseName(name)
	base = strings.TrimSuffix(base, ".json")
	if i := strings.Index(base, "-"); i > 0 {
		return base[:i]
	}
	return base
}

// displayName trims the family prefix and extension: "antigravity-me@gmail.com.json"
// → "me@gmail.com".
func displayName(name string) string {
	base := strings.TrimSuffix(baseName(name), ".json")
	if i := strings.Index(base, "-"); i > 0 {
		return base[i+1:]
	}
	return base
}

// baseName strips any directory part from a file name.
func baseName(name string) string {
	if i := strings.LastIndex(name, "/"); i >= 0 {
		return name[i+1:]
	}
	if i := strings.LastIndex(name, "\\"); i >= 0 {
		return name[i+1:]
	}
	return name
}

// shortID makes a safe, mostly-unique id suffix from the account name.
func shortID(name string) string {
	base := displayName(name)
	var b strings.Builder
	for _, rn := range base {
		switch {
		case rn >= 'a' && rn <= 'z', rn >= 'A' && rn <= 'Z', rn >= '0' && rn <= '9':
			b.WriteRune(rn)
		default:
			b.WriteRune('-')
		}
	}
	out := b.String()
	if len(out) > 24 {
		out = out[:24]
	}
	return strings.ToLower(strings.Trim(out, "-"))
}

// randomHex generates n random bytes as hex (mirrors the config package's
// key generator; used for "Generate new key").
func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = crand.Read(b)
	return hex.EncodeToString(b)
}
