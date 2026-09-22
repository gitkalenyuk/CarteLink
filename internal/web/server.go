// Package web serves the CartelGate UI and control API:
// the Electron main process's IPC surface: config get/save, providers CRUD,
// metrics, OAuth pass-through to the embedded CLIProxyAPI Management API.
// In the embedded build the same CLIProxyAPI server hosts these routes.
package web

import (
	"bytes"
	"context"
	"embed"
	"fmt"
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
	mu       sync.Mutex
	cfg      *config.Config
	cp       *cliproxy.Embedded
	cpWanted bool
	logBuf   []string
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
}

// NewApp builds the app around the config. The embedded service reference is
// attached later via SetEmbedded (main wires it after construction).
func NewApp(cfg *config.Config) *App {
	a := &App{
		cfg: cfg,
	}
	metricsPath := filepath.Join(config.DataDir(), "metrics.json")
	a.metricsStore = NewMetricsStore(metricsPath)
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
func (a *App) SyncYAML(cfg *config.Config) error {
	path := EngineCfgPath()
	if cfg.RequireKey {
		seen := map[string]bool{}
		merged := make([]string, 0, len(cfg.Cliproxy.APIKeys)+2)
		for _, k := range append(append([]string{}, cfg.Cliproxy.APIKeys...), cliproxy.ReadAPIKeys(path)...) {
			if k == "" || k == "cg-default-key" || k == "vg-cliproxy-default-key" || seen[k] {
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
	return cliproxy.SyncConfigYAML(path, cliproxy.Managed{
		Host:       cfg.Cliproxy.Host,
		Port:       cfg.Cliproxy.Port,
		Secret:     cfg.Cliproxy.ManagementSecret,
		AuthDir:    config.CliproxyAuthDir(),
		APIKeys:    cfg.Cliproxy.APIKeys,
		RequireKey: cfg.RequireKey,
		ExtraYAML:  cfg.Cliproxy.ExtraConfigYAML,
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

// IsAuthenticated reports whether the user is authorized to use CarteLink.
func (a *App) IsAuthenticated() bool {
	a.mu.Lock()
	enabled := a.cfg.Auth.Enabled
	a.mu.Unlock()
	if !enabled {
		return true
	}
	a.authMu.Lock()
	defer a.authMu.Unlock()
	return a.authStatus == "authorized"
}

// AuthStatus returns the current Telegram authentication state.
func (a *App) AuthStatus() (status string, reason string, user *config.AuthUser, brokerUrl string, enabled bool) {
	a.mu.Lock()
	enabled = a.cfg.Auth.Enabled
	brokerUrl = a.cfg.Auth.BrokerURL
	a.mu.Unlock()

	a.authMu.Lock()
	defer a.authMu.Unlock()
	status = a.authStatus
	reason = a.authReason
	user = a.authUser
	return
}

// SetAuthSession updates in-memory and persisted auth session.
func (a *App) SetAuthSession(session string, user *config.AuthUser) {
	a.authMu.Lock()
	a.authSession = session
	a.authUser = user
	a.authStatus = "authorized"
	a.authReason = ""
	a.authMu.Unlock()

	a.mu.Lock()
	a.cfg.Auth.Session = session
	a.cfg.Auth.User = user
	_ = a.cfg.Save()
	a.mu.Unlock()
}

// InitAuth initializes auth state on startup.
func (a *App) InitAuth() {
	a.mu.Lock()
	cfg := a.cfg
	a.mu.Unlock()

	if !cfg.Auth.Enabled {
		a.authMu.Lock()
		a.authStatus = "authorized"
		a.authMu.Unlock()
		return
	}

	if cfg.Auth.Session == "" {
		a.authMu.Lock()
		a.authStatus = "need_login"
		a.authMu.Unlock()
		return
	}

	a.authMu.Lock()
	a.authSession = cfg.Auth.Session
	a.authUser = cfg.Auth.User
	a.authStatus = "authorized"
	a.authMu.Unlock()

	// Asynchronously verify live membership
	go func() {
		a.VerifyAuthLive()
	}()
}

// VerifyAuthLive verifies membership with the hosted broker.
func (a *App) VerifyAuthLive() bool {
	a.mu.Lock()
	brokerUrl := a.cfg.Auth.BrokerURL
	if brokerUrl == "" {
		brokerUrl = config.DefaultBrokerURL
	}
	enabled := a.cfg.Auth.Enabled
	a.mu.Unlock()

	if !enabled {
		a.authMu.Lock()
		a.authStatus = "authorized"
		a.authMu.Unlock()
		return true
	}

	a.authMu.Lock()
	session := a.authSession
	a.authMu.Unlock()

	if session == "" {
		a.authMu.Lock()
		a.authStatus = "need_login"
		a.authMu.Unlock()
		return false
	}

	client := &http.Client{Timeout: 15 * time.Second}
	payload, _ := json.Marshal(map[string]any{
		"initData": "",
		"app":      true,
		"session":  session,
	})
	verifyURL := strings.TrimRight(brokerUrl, "/") + "/api/auth/verify"

	req, err := http.NewRequest(http.MethodPost, verifyURL, bytes.NewReader(payload))
	if err != nil {
		return true
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cookie", "ytc_session="+session)

	resp, err := client.Do(req)
	if err != nil {
		log.Println("[CarteLink auth] verify network blip:", err)
		return true
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool   `json:"ok"`
		Reason string `json:"reason"`
		Tier   string `json:"tier"`
		User   *struct {
			ID        any    `json:"id"`
			FirstName string `json:"first_name"`
			LastName  string `json:"last_name"`
			Name      string `json:"name"`
			Username  string `json:"username"`
		} `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Println("[CarteLink auth] decode verify error:", err)
		return true
	}

	a.authMu.Lock()
	defer a.authMu.Unlock()
	if result.OK {
		a.authStatus = "authorized"
		a.authReason = ""
		if result.User != nil {
			displayName := result.User.FirstName
			if result.User.LastName != "" {
				displayName += " " + result.User.LastName
			} else if displayName == "" {
				displayName = result.User.Name
			}
			userObj := &config.AuthUser{
				ID:       "",
				Name:     displayName,
				Username: result.User.Username,
			}
			if result.User.ID != nil {
				userObj.ID = strings.TrimSpace(bytes.NewBufferString("").String() + anyToString(result.User.ID))
			}
			a.authUser = userObj
			a.mu.Lock()
			a.cfg.Auth.User = userObj
			_ = a.cfg.Save()
			a.mu.Unlock()
		}
		return true
	}

	if result.Reason == "not_member" || result.Reason == "trial_expired" {
		a.authStatus = "denied"
		a.authReason = "not_member"
		log.Println("[CarteLink auth] access revoked: user is not a member of Secret YT_cartel 🧠")
		return false
	}

	a.authStatus = "need_login"
	a.authReason = result.Reason
	return false
}

// StartAuthWatchdog runs a 5-minute background live membership re-check.
func (a *App) StartAuthWatchdog() {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			a.mu.Lock()
			enabled := a.cfg.Auth.Enabled
			a.mu.Unlock()
			if enabled {
				a.VerifyAuthLive()
			}
		}
	}()
}


func anyToString(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}


// MetricsStore returns the metrics store instance.
func (a *App) MetricsStore() *MetricsStore {
	return a.metricsStore
}

// ActiveModels collects all model IDs available from OAuth accounts and custom providers.
func (a *App) ActiveModels() []string {
	modelsMap := make(map[string]bool)

	cfg := a.snapshotConfig()
	for _, p := range cfg.Providers {
		for _, m := range p.Models {
			m = strings.TrimSpace(m)
			if m != "" {
				modelsMap[m] = true
			}
		}
	}

	if a.EngineRunning() && !a.Paused() {
		status, raw, _ := a.mgmtRequest(http.MethodGet, "/v0/management/auth-files", nil)
		if status == http.StatusOK {
			var afData struct {
				Files []struct {
					Models []any `json:"models"`
				} `json:"files"`
			}
			if json.Unmarshal(raw, &afData) == nil {
				for _, f := range afData.Files {
					for _, m := range f.Models {
						switch mv := m.(type) {
						case string:
							if strings.TrimSpace(mv) != "" {
								modelsMap[strings.TrimSpace(mv)] = true
							}
						case map[string]any:
							if id, ok := mv["id"].(string); ok && strings.TrimSpace(id) != "" {
								modelsMap[strings.TrimSpace(id)] = true
							} else if name, ok := mv["name"].(string); ok && strings.TrimSpace(name) != "" {
								modelsMap[strings.TrimSpace(name)] = true
							}
						}
					}
				}
			}
		}

		status, raw, _ = a.mgmtRequest(http.MethodGet, "/v0/management/openai-compatibility", nil)
		if status == http.StatusOK {
			var ocData []struct {
				Models []string `json:"models"`
			}
			if json.Unmarshal(raw, &ocData) == nil {
				for _, oc := range ocData {
					for _, m := range oc.Models {
						m = strings.TrimSpace(m)
						if m != "" {
							modelsMap[m] = true
						}
					}
				}
			}
		}
	}

	if len(modelsMap) == 0 {
		return []string{"claude-3-5-sonnet", "gpt-4o", "gemini-2.0-flash"}
	}

	res := make([]string, 0, len(modelsMap))
	for m := range modelsMap {
		res = append(res, m)
	}
	return res
}
