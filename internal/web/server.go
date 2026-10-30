// Package web serves the CarteLink UI and control API:
// the Electron main process's IPC surface: config get/save, providers CRUD,
// metrics, OAuth pass-through to the embedded CLIProxyAPI Management API.
// In the embedded build the same CLIProxyAPI server hosts these routes.
package web

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"cartelgate/internal/cliproxy"
	"cartelgate/internal/config"
)

type anyMap = map[string]any

//go:embed ui
var uiFS embed.FS

// App wires the embedded CLIProxyAPI service and UI together.
type App struct {
	mu        sync.Mutex
	resolveFn func(model string) string
	cfg       *config.Config
	cp        *cliproxy.Embedded
	cpWanted  bool
	logBuf    []string
	// lifecycle params for the Start/Stop/Restart buttons (set by main after
	// the first successful Start).
	rootCtx         context.Context
	rootCancel      context.CancelFunc
	cfgPath         string
	starting        atomic.Bool
	oauthBrowserMu  sync.Mutex
	oauthBrowserCmd *exec.Cmd
	// paused gates API request processing while the embedded HTTP server
	// stays up — the panel lives on the same port, so a hard Stop would kill
	// the UI's own control API too (see the root middleware in main.go).
	paused atomic.Bool
	// restarting is set while EngineRestart tears the engine down and brings
	// it back (possibly on another port); lastError keeps the most recent
	// start failure for the status endpoint.
	restarting atomic.Bool
	lastError  string
	// auth fields
	authMu        sync.Mutex
	authStatus    string
	authReason    string
	authSession   string
	authUser      *config.AuthUser
	loopbackSrv   *http.Server
	loopbackNonce string
	metricsStore  *MetricsStore
	// sessionPort overrides the configured port for this run only.
	sessionPort int
	showFn      func()
	// switcherFn shows (true) or hides (false) the floating model switcher
	// window; nil where there is no desktop window.
	switcherFn  func(show bool)
	errLog      *ErrorLog
	knownModels map[string]bool
	knownAt     time.Time
	// engineModels are the served model ids in their original spelling.
	engineModels []string
}

// NewApp builds the app around the config. The embedded service reference is
// attached later via SetEmbedded (main wires it after construction).
func NewApp(cfg *config.Config) *App {
	a := &App{
		cfg: cfg,
	}
	metricsPath := filepath.Join(config.DataDir(), "metrics.json")
	a.metricsStore = NewMetricsStore(metricsPath)
	a.errLog = NewErrorLog(filepath.Join(config.DataDir(), "errors.jsonl"))
	return a
}

// SetEmbedded attaches the embedded CLIProxyAPI manager.
func (a *App) SetEmbedded(e *cliproxy.Embedded) {
	a.mu.Lock()
	a.cp = e
	a.mu.Unlock()
}

// SetLifecycle stores the parameters Start needs to (re)run the engine.
func (a *App) SetLifecycle(ctx context.Context, cancel context.CancelFunc, cfgPath string) {
	a.mu.Lock()
	a.rootCtx = ctx
	a.rootCancel = cancel
	a.cfgPath = cfgPath
	a.mu.Unlock()
}

// EngineStart starts the embedded engine if it is not already running.
func (a *App) EngineStart() error {
	a.paused.Store(false)
	a.mu.Lock()
	e := a.cp
	ctx, cfgPath := a.rootCtx, a.cfgPath
	a.mu.Unlock()
	if e == nil || ctx == nil {
		return errors.New("engine is not initialized yet")
	}
	if e.IsRunning() {
		return nil
	}
	if !a.starting.CompareAndSwap(false, true) {
		return errors.New("engine start already in progress")
	}
	defer a.starting.Store(false)
	return e.Start(ctx, cfgPath)
}

// EngineStop "stops" the engine from the UI's point of view: API request
// processing is paused while the embedded HTTP server stays up — the panel
// and its control API share the port, so a hard server shutdown would leave
// nothing to click Start on. Nothing answers on /v1/* while paused.
func (a *App) EngineStop() {
	a.paused.Store(true)
}

// EngineRestart really restarts the embedded engine: the current service is
// shut down and a fresh one is built from config.yaml (so a saved port/host
// change takes effect). The work runs in the background after a short delay
// so the HTTP response that triggered it can still be delivered by the old
// server; callers poll /status (on the new port if it changed).
func (a *App) EngineRestart() error {
	a.mu.Lock()
	e := a.cp
	ctx, cfgPath := a.rootCtx, a.cfgPath
	a.mu.Unlock()
	if e == nil || ctx == nil {
		return errors.New("engine is not initialized yet")
	}
	if !a.restarting.CompareAndSwap(false, true) {
		return errors.New("restart already in progress")
	}
	go func() {
		defer a.restarting.Store(false)
		time.Sleep(400 * time.Millisecond)
		a.paused.Store(false)
		e.Stop()
		if err := e.Start(ctx, cfgPath); err != nil {
			log.Println("engine restart failed:", err)
			a.setLastError("restart failed: " + err.Error())
			return
		}
		a.setLastError("")
	}()
	return nil
}

// Restarting reports whether a restart is in flight.
func (a *App) Restarting() bool { return a.restarting.Load() }

func (a *App) setLastError(s string) {
	a.mu.Lock()
	a.lastError = s
	a.mu.Unlock()
}

// LastError returns the most recent engine start/restart failure ("" if none).
func (a *App) LastError() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.lastError
}

// EngineCfgPath returns the engine config.yaml path.
func EngineCfgPath() string { return filepath.Join(config.CliproxyDir(), "config.yaml") }

// SyncYAML writes the managed keys of cfg into config.yaml. API keys that
// were added to the engine through the Management API (they live only in
// config.yaml) are merged into cfg.Cliproxy.APIKeys so the two files agree;
// the caller is expected to Save() cfg afterwards.
func (a *App) SyncYAML(cfg *config.Config, retire ...string) error {
	path := EngineCfgPath()
	if cfg.RequireKey {
		seen := map[string]bool{}
		for _, k := range retire {
			seen[k] = true
		}
		merged := make([]string, 0, len(cfg.Cliproxy.APIKeys)+2)
		for _, k := range append(append([]string{}, cfg.Cliproxy.APIKeys...), cliproxy.ReadAPIKeys(path)...) {
			if k == "" || k == "cg-default-key" || k == "vg-cliproxy-default-key" || seen[k] {
				continue
			}
			// A deleted scoped key must not come back from config.yaml.
			if strings.HasPrefix(k, config.ScopedKeyPrefix) && cfg.FindScopedKey(k) == nil {
				continue
			}
			seen[k] = true
			merged = append(merged, k)
		}
		if len(merged) == 0 && cfg.APIKey != "" {
			merged = append(merged, cfg.APIKey)
		}
		cfg.Cliproxy.APIKeys = merged
	}
	port := cfg.Cliproxy.Port
	a.mu.Lock()
	if a.sessionPort > 0 {
		port = a.sessionPort
	}
	a.mu.Unlock()
	return cliproxy.SyncConfigYAML(path, cliproxy.Managed{
		Host:       cfg.Cliproxy.Host,
		Port:       port,
		Secret:     cfg.Cliproxy.ManagementSecret,
		AuthDir:    config.CliproxyAuthDir(),
		APIKeys:    cfg.Cliproxy.APIKeys,
		RequireKey: cfg.RequireKey,
		ExtraYAML:  cfg.Cliproxy.ExtraConfigYAML,
		PluginsDir: config.CliproxyPluginsDir(),
	})
}

// EngineRunning reports whether the engine accepts API traffic right now.
func (a *App) EngineRunning() bool {
	a.mu.Lock()
	e := a.cp
	a.mu.Unlock()
	return e != nil && e.IsRunning() && !a.paused.Load()
}

// Paused reports whether API traffic is currently gated off (UI "stopped").
func (a *App) Paused() bool {
	return a.paused.Load()
}

// CPWanted reports whether the user wants the CLIProxy engine running.
func (a *App) CPWanted() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cpWanted
}

// SetCPWanted records user intent for the CLIProxy engine.
func (a *App) SetCPWanted(v bool) {
	a.mu.Lock()
	a.cpWanted = v
	a.mu.Unlock()
}

func (a *App) log(msg string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.logBuf = append(a.logBuf, time.Now().Format("15:04:05")+" "+msg)
	if len(a.logBuf) > 1000 {
		a.logBuf = a.logBuf[len(a.logBuf)-1000:]
	}
}

// SetConfig swaps the config pointer.
func (a *App) SetConfig(c *config.Config) {
	a.mu.Lock()
	a.cfg = c
	a.mu.Unlock()
}

// SetOAuthBrowserCmd stores the running OAuth browser process.
func (a *App) SetOAuthBrowserCmd(cmd *exec.Cmd) {
	a.oauthBrowserMu.Lock()
	defer a.oauthBrowserMu.Unlock()
	if a.oauthBrowserCmd != nil && a.oauthBrowserCmd.Process != nil {
		_ = a.oauthBrowserCmd.Process.Kill()
	}
	a.oauthBrowserCmd = cmd
}

// CloseOAuthBrowser terminates the OAuth browser window if one was opened.
func (a *App) CloseOAuthBrowser() {
	a.oauthBrowserMu.Lock()
	defer a.oauthBrowserMu.Unlock()
	if a.oauthBrowserCmd != nil && a.oauthBrowserCmd.Process != nil {
		_ = a.oauthBrowserCmd.Process.Kill()
		a.oauthBrowserCmd = nil
	}
}

// UIHandler serves the embedded UI files under /ui/ with no-cache headers.
func UIHandler() http.Handler {
	sub, err := fs.Sub(uiFS, "ui")
	if err != nil {
		panic(err)
	}
	fsHandler := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		fsHandler.ServeHTTP(w, r)
	})
}

// ControlHandler returns the /api/* control surface as a standalone handler
// (mounted on the shared Gin engine via gin.WrapH).
func ControlHandler(a *App) http.Handler {
	return http.HandlerFunc(a.controlRoot)
}

// MetricsStore returns the metrics store instance.
func (a *App) MetricsStore() *MetricsStore {
	return a.metricsStore
}

// SetSessionPort records a port used for this run only (the configured one
// was busy). It is never saved; config.yaml gets it so the engine binds it.
func (a *App) SetSessionPort(p int) {
	a.mu.Lock()
	a.sessionPort = p
	a.mu.Unlock()
}

// EffectivePort is the port the engine listens on right now.
func (a *App) EffectivePort() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.sessionPort > 0 {
		return a.sessionPort
	}
	return a.cfg.Cliproxy.Port
}

// ErrorLog returns the request error log.
func (a *App) ErrorLog() *ErrorLog { return a.errLog }

// SetModelResolver sets how a client model name maps to the model CarteLink
// sends it to (the routing lives in package main).
func (a *App) SetModelResolver(f func(model string) string) {
	a.mu.Lock()
	a.resolveFn = f
	a.mu.Unlock()
}

// ResolveModel maps a client model name through the routing ("" if unknown).
func (a *App) ResolveModel(model string) string {
	a.mu.Lock()
	f := a.resolveFn
	a.mu.Unlock()
	if f == nil {
		return model
	}
	return f(model)
}

// SetSwitcherHandler sets how the floating model switcher is shown/hidden.
func (a *App) SetSwitcherHandler(f func(show bool)) {
	a.mu.Lock()
	a.switcherFn = f
	a.mu.Unlock()
}

// UpdateConfig applies mutate to a copy of the current config, normalizes
// and saves it, then swaps it in. mutate may return an error to abort.
func (a *App) UpdateConfig(mutate func(c *config.Config) error) (*config.Config, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	cfg := a.cfg.Clone()
	if err := mutate(cfg); err != nil {
		return nil, err
	}
	config.Normalize(cfg)
	if err := cfg.Save(); err != nil {
		return nil, err
	}
	a.cfg = cfg
	return cfg, nil
}

// SetShowHandler sets what "show the app" does (window or browser).
func (a *App) SetShowHandler(f func()) {
	a.mu.Lock()
	a.showFn = f
	a.mu.Unlock()
}

// StartModelCatalog keeps a cached list of the models the engine serves; it
// powers the "smart" unmapped-model fallback (see IsKnownModel).
func (a *App) StartModelCatalog() {
	go func() {
		for {
			a.refreshModelCatalog()
			time.Sleep(60 * time.Second)
		}
	}()
}

func (a *App) refreshModelCatalog() {
	if !a.EngineRunning() || !a.IsAuthenticated() {
		return
	}
	cfg := a.snapshotConfig()
	req, err := http.NewRequest(http.MethodGet, "http://127.0.0.1:"+itoa(a.EffectivePort())+"/v1/models", nil)
	if err != nil {
		return
	}
	req.Header.Set("X-CarteLink-Internal", "1")
	key := cfg.APIKey
	if len(cfg.Cliproxy.APIKeys) > 0 {
		key = cfg.Cliproxy.APIKeys[0]
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.NewDecoder(resp.Body).Decode(&body) != nil {
		return
	}
	set := make(map[string]bool, len(body.Data))
	ids := make([]string, 0, len(body.Data))
	for _, m := range body.Data {
		orig := strings.TrimSpace(uncloak(m.ID))
		if id := strings.ToLower(orig); id != "" {
			if !set[id] {
				ids = append(ids, orig)
			}
			set[id] = true
		}
	}
	a.mu.Lock()
	a.engineModels = ids
	a.knownModels = set
	a.knownAt = time.Now()
	a.mu.Unlock()
}

// EngineModels refreshes and returns every model id the engine serves
// (accounts, API keys and plugin providers alike).
func (a *App) EngineModels() []string {
	a.refreshModelCatalog()
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.engineModels...)
}

// IsKnownModel reports whether the engine (or an enabled provider) serves
// model. With no catalog yet it answers true, so nothing is rerouted blindly.
func (a *App) IsKnownModel(model string) bool {
	m := strings.ToLower(strings.TrimSpace(model))
	a.mu.Lock()
	set, cfg := a.knownModels, a.cfg
	a.mu.Unlock()
	if len(set) == 0 {
		return true
	}
	if set[m] {
		return true
	}
	for _, p := range cfg.Providers {
		if !p.Enabled {
			continue
		}
		for _, pm := range p.Models {
			if strings.EqualFold(strings.TrimSpace(pm), m) {
				return true
			}
		}
	}
	return false
}

// uncloak reverses the engine's claude-fable-5-dd-<reversed> cloaking.
func uncloak(id string) string {
	const prefix = "claude-fable-5-dd-"
	if !strings.HasPrefix(id, prefix) {
		return id
	}
	base := id[len(prefix):]
	suffix := ""
	if open := strings.LastIndex(base, "("); open != -1 && strings.HasSuffix(base, ")") {
		suffix = base[open:]
		base = base[:open]
	}
	r := []rune(base)
	for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
		r[i], r[j] = r[j], r[i]
	}
	return string(r) + suffix
}
