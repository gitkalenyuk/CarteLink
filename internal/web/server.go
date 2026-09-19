// Package web serves the VisionGateGo UI and control API — the equivalent of
// the Electron main process's IPC surface: config get/save, providers CRUD,
// metrics, OAuth pass-through to the embedded CLIProxyAPI Management API.
// In the embedded build the same CLIProxyAPI server hosts these routes.
package web

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"net/http"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"

	"visiongate/internal/cliproxy"
	"visiongate/internal/config"
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
}

// NewApp builds the app around the config. The embedded service reference is
// attached later via SetEmbedded (main wires it after construction).
func NewApp(cfg *config.Config) *App {
	a := &App{
		cfg: cfg,
	}
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

// EngineRestart resumes processing immediately (the embedded server never
// actually stopped); if the engine process has died for real, it is rebuilt.
func (a *App) EngineRestart() error {
	return a.EngineStart()
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

// UIHandler serves the embedded UI files under /ui/.
func UIHandler() http.Handler {
	sub, err := fs.Sub(uiFS, "ui")
	if err != nil {
		panic(err)
	}
	return http.FileServer(http.FS(sub))
}

// ControlHandler returns the /api/* control surface as a standalone handler
// (mounted on the shared Gin engine via gin.WrapH).
func ControlHandler(a *App) http.Handler {
	return http.HandlerFunc(a.controlRoot)
}
