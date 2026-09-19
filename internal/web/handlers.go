package web

import (
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"visiongate/internal/cliproxy"
	"visiongate/internal/config"
)

func itoa(n int) string { return strconv.Itoa(n) }

func maskKey(k string) string {
	if len(k) <= 8 {
		return strings.Repeat("*", len(k))
	}
	return k[:8] + "…" + k[len(k)-4:]
}

// apiStatus mirrors the Electron status payload: engine state plus config echo.
func (a *App) apiStatus(w http.ResponseWriter, r *http.Request) {
	cfg := a.snapshotConfig()
	running := a.EngineRunning()
	resp := anyMap{
		"version": config.Version,
		"engine": anyMap{
			"running": running,
			"port":    cfg.Cliproxy.Port,
			"host":    cfg.Cliproxy.Host,
			"version": cliproxy.UpstreamVersion,
		},
		"requireKey": cfg.RequireKey,
		"routing":    cfg.Routing,
		"providers":  cfg.Providers,
	}
	jsonWrite(w, http.StatusOK, resp)
}

// apiEndpoints returns the absolute URLs the UI shows for copy-paste.
func (a *App) apiEndpoints(w http.ResponseWriter, r *http.Request) {
	cfg := a.snapshotConfig()
	base := "http://" + displayHost(cfg.Cliproxy.Host) + ":" + itoa(cfg.Cliproxy.Port)
	key := cfg.APIKey
	if len(cfg.Cliproxy.APIKeys) > 0 {
		key = cfg.Cliproxy.APIKeys[0]
	}
	jsonWrite(w, http.StatusOK, anyMap{
		"base":               base,
		"openai":             base + "/v1/chat/completions",
		"anthropic":          base,
		"anthropic_messages": base + "/v1/messages",
		"gemini":             base + "/v1beta/models",
		"panel":              base + "/management.html",
		"key":                key,
	})
}

// apiConfigGet returns the config with the management secret masked.
func (a *App) apiConfigGet(w http.ResponseWriter, r *http.Request) {
	cfg := a.snapshotConfig()
	clone := *cfg
	clone.Cliproxy.ManagementSecret = ""
	jsonWrite(w, http.StatusOK, clone)
}

// apiConfigSave merges the posted config, preserves the management secret,
// normalizes, saves, and rewrites config.yaml (the engine hot-reloads most
// fields via its watcher; a port change needs a restart).
func (a *App) apiConfigSave(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
	if err != nil {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "could not read body"})
		return
	}
	fresh, err := config.Load()
	if err != nil {
		fresh = config.Defaults()
	}
	if err := json.Unmarshal(body, fresh); err != nil {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "invalid config: " + err.Error()})
		return
	}
	prevSecret := a.snapshotConfig().Cliproxy.ManagementSecret
	if fresh.Cliproxy.ManagementSecret == "" {
		fresh.Cliproxy.ManagementSecret = prevSecret
	}
	config.Normalize(fresh)
	if err := fresh.Save(); err != nil {
		jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": err.Error()})
		return
	}
	a.SetConfig(fresh)
	cfgPath := filepath.Join(config.CliproxyDir(), "config.yaml")
	wantYAML := cliproxy.BuildConfigYAML(fresh.Cliproxy.Host, fresh.Cliproxy.Port, fresh.Cliproxy.ManagementSecret, config.CliproxyAuthDir(), fresh.Cliproxy.APIKeys, fresh.RequireKey, fresh.Cliproxy.ExtraConfigYAML)
	if err := cliproxy.WriteConfigIfChanged(cfgPath, wantYAML, strconv.Itoa(fresh.Cliproxy.Port), fresh.Cliproxy.ManagementSecret); err != nil {
		jsonWrite(w, http.StatusInternalServerError, anyMap{"ok": false, "error": err.Error()})
		return
	}
	jsonWrite(w, http.StatusOK, anyMap{"ok": true})
}

// snapshotConfig returns the current config pointer.
func (a *App) snapshotConfig() *config.Config {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg
}

// CurrentConfig is the exported accessor used by the model-rewrite
// middleware in main (the mapping must be read per request so UI changes
// apply immediately).
func (a *App) CurrentConfig() *config.Config {
	return a.snapshotConfig()
}

// embedded returns the embedded manager (may be nil early).
func (a *App) embedded() *cliproxy.Embedded {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cp
}

// displayHost renders the host for humans (empty = all interfaces).
func displayHost(h string) string {
	if h == "" {
		return "127.0.0.1"
	}
	return h
}
