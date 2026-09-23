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

	"cartelgate/internal/config"
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

// apiServerRestart: POST /api/server/restart — tears the engine down and
// rebuilds it from the saved config in the background. The reply carries the
// port the engine will come back on so the UI can follow it.
func (a *App) apiServerRestart(w http.ResponseWriter, r *http.Request) {
	if err := a.EngineRestart(); err != nil {
		jsonWrite(w, http.StatusConflict, anyMap{"ok": false, "error": err.Error()})
		return
	}
	cfg := a.snapshotConfig()
	jsonWrite(w, http.StatusOK, anyMap{
		"ok":         true,
		"restarting": true,
		"port":       a.EffectivePort(),
		"host":       config.DisplayHost(cfg.Cliproxy.Host),
	})
}

// waitForEngine polls the engine state plus a live /healthz probe until the
// engine answers or the deadline passes.
func (a *App) waitForEngine(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if a.EngineRunning() {
			cfg := a.snapshotConfig()
			client := &http.Client{Timeout: time.Second}
			if resp, err := client.Get("http://" + config.DisplayHost(cfg.Cliproxy.Host) + ":" + itoa(a.EffectivePort()) + "/healthz"); err == nil {
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
// a fresh random "cg-…" one and persist it. The engine's client key list is
// updated live through the management API so the new key works immediately.
func (a *App) apiGenerateKey(w http.ResponseWriter, r *http.Request) {
	// Work on a copy: the live config is read by the request middleware on
	// every call, so it must never be mutated in place.
	cfg := a.snapshotConfig().Clone()
	old := cfg.APIKey
	cfg.APIKey = config.NewKey()
	if cfg.RequireKey {
		// The gateway key is the first client key; the previous one is
		// retired so old copies stop working.
		keys := []string{cfg.APIKey}
		for _, k := range cfg.Cliproxy.APIKeys {
			if k != old && k != cfg.APIKey {
				keys = append(keys, k)
			}
		}
		cfg.Cliproxy.APIKeys = keys
		// Push live so the new key works immediately (config.yaml is synced
		// below as well, which also drops the retired key there).
		_, _, _ = a.mgmtRequest(http.MethodPut, "/v0/management/api-keys", mustJSON(keys))
	}
	if err := a.SyncYAML(cfg, old); err != nil {
		jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": err.Error()})
		return
	}
	if err := cfg.Save(); err != nil {
		jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": err.Error()})
		return
	}
	a.SetConfig(cfg)
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
// Creates/updates a CarteLink provider entry carrying the account's real
// model list (fetched from the engine), so the Models page can offer those
// models in the tier dropdowns. The engine itself already routes by model
// name — this entry is the user-visible handle for the account.
func (a *App) apiAccountToProvider(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
		// Auto is set by the Accounts page's background sync: it must not
		// re-create providers the user removed, nor re-enable disabled ones.
		Auto bool `json:"auto"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req)
	name := strings.TrimSpace(req.Name)
	if name == "" {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "name is required"})
		return
	}
	if req.Auto {
		id := "cp-" + accountFamily(name) + "-" + shortID(name)
		cfg := a.snapshotConfig()
		for _, h := range cfg.HiddenAccounts {
			if h == id {
				jsonWrite(w, http.StatusOK, anyMap{"ok": true, "id": id, "skipped": "hidden"})
				return
			}
		}
		for _, p := range cfg.Providers {
			if p.ID == id {
				jsonWrite(w, http.StatusOK, anyMap{"ok": true, "id": id, "skipped": "exists"})
				return
			}
		}
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
	cfg := a.cfg.Clone()
	replaced := false
	for i := range cfg.Providers {
		if cfg.Providers[i].ID == id {
			cfg.Providers[i].Models = models
			replaced = true
			break
		}
	}
	// An explicit (non-auto) add brings a hidden account back.
	kept := make([]string, 0, len(cfg.HiddenAccounts))
	for _, h := range cfg.HiddenAccounts {
		if h != id {
			kept = append(kept, h)
		}
	}
	cfg.HiddenAccounts = kept
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
	if err == nil {
		a.cfg = cfg
	}
	a.mu.Unlock()
	if err != nil {
		jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": err.Error()})
		return
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "id": id, "models": len(models)})
}

// apiAccountProviderHide: POST /api/account-provider/hide {"id"} — remembers
// that the user removed an account provider so the auto-sync leaves it gone.
func (a *App) apiAccountProviderHide(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req)
	id := strings.TrimSpace(req.ID)
	if id == "" {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "id is required"})
		return
	}
	a.mu.Lock()
	cfg := a.cfg.Clone()
	found := false
	for _, h := range cfg.HiddenAccounts {
		if h == id {
			found = true
		}
	}
	if !found {
		cfg.HiddenAccounts = append(cfg.HiddenAccounts, id)
	}
	err := cfg.Save()
	if err == nil {
		a.cfg = cfg
	}
	a.mu.Unlock()
	if err != nil {
		jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": err.Error()})
		return
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true})
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
