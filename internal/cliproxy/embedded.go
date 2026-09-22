// Package cliproxy now embeds the original CLIProxyAPI source code directly
// (compiled into this binary via third_party/CLIProxyAPI + go.mod replace).
// The embedded Service IS the single server: one process, one port. CartelGate
// routes (GUI + control API + gateway) are mounted on the same Gin engine via
// api.WithRouterConfigurator — no sidecar, no second port.
package cliproxy

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"

	sdkapi "github.com/router-for-me/CLIProxyAPI/v7/sdk/api"
	sdkhandlers "github.com/router-for-me/CLIProxyAPI/v7/sdk/api/handlers"
	sdkAuth "github.com/router-for-me/CLIProxyAPI/v7/sdk/auth"
	sdkcliproxy "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
	_ "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator/builtin" // register all built-in translators
)

// UpstreamVersion is the version of the embedded CLIProxyAPI source.
const UpstreamVersion = "7.3.5"

// Embedded manages the in-process CLIProxyAPI Service lifecycle. It supports
// Start/Stop/Restart: each Start builds a fresh Service (the old one was
// shut down by Stop), while the exit-error channel stays the same for the
// whole lifetime of the manager.
type Embedded struct {
	mu       sync.Mutex
	svc      *sdkcliproxy.Service
	running  bool
	starting bool
	authDir  string
	cfgPath  string
	gen      uint64 // increments per Start; guards status writes from stale runs

	// configure mounts CartelGate routes (GUI, control API, gateway) on the
	// shared Gin engine once per server construction.
	configure func(*gin.Engine)
	// root is appended as global middleware — serves the GUI and CartelGate
	// control API paths ahead of CLIProxyAPI's own handlers.
	root gin.HandlerFunc

	errChan chan error
}

// NewEmbedded creates the embedded-service manager.
func NewEmbedded(mount func(*gin.Engine), root gin.HandlerFunc) *Embedded {
	return &Embedded{configure: mount, root: root, errChan: make(chan error, 1)}
}

// Managed is the set of config.yaml keys CartelGate owns. SyncConfigYAML
// writes exactly these into the engine config and leaves everything else
// (providers, keys, routing strategy… added through the Management API)
// untouched.
type Managed struct {
	Host       string
	Port       int
	Secret     string
	AuthDir    string
	APIKeys    []string // written verbatim; nil/empty → "api-keys: []"
	RequireKey bool
	ExtraYAML  string // raw YAML appended/merged at top level (advanced users)
}

// ReadAPIKeys returns the api-keys currently in the on-disk engine config
// (keys added through the Management API live only there).
func ReadAPIKeys(path string) []string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var doc map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil
	}
	return stringList(doc["api-keys"])
}

// SyncConfigYAML merges the managed keys into config.yaml. When the file is
// missing or unparsable it is regenerated from the template; otherwise the
// existing document (with whatever the Management API persisted) is kept and
// only the managed keys are (re)set. The write is skipped when nothing
// changes so the engine's file watcher is not tickled needlessly.
func SyncConfigYAML(path string, m Managed) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	cur, _ := os.ReadFile(path)
	var doc map[string]any
	if len(strings.TrimSpace(string(cur))) == 0 || yaml.Unmarshal(cur, &doc) != nil || doc == nil {
		// Fresh (or unreadable) file: start from the template defaults and
		// let the common path below fill in the managed keys, so the output
		// is byte-stable across syncs.
		doc = map[string]any{
			"logging-to-file":                     false,
			"usage-statistics-enabled":            true,
			"request-log":                         false,
			"redis-usage-queue-retention-seconds": 3600,
		}
	}

	doc["redis-usage-queue-retention-seconds"] = 3600
	doc["host"] = m.Host
	doc["port"] = m.Port
	rm, _ := doc["remote-management"].(map[string]any)
	if rm == nil {
		rm = map[string]any{}
	}
	rm["allow-remote"] = false
	rm["secret-key"] = m.Secret
	rm["disable-control-panel"] = false
	doc["remote-management"] = rm
	doc["auth-dir"] = m.AuthDir
	if m.RequireKey {
		keys := m.APIKeys
		if len(keys) == 0 {
			keys = []string{"cg-default-key"}
		}
		doc["api-keys"] = keys
	} else {
		doc["api-keys"] = []string{}
	}
	cc, _ := doc["claude-code"].(map[string]any)
	if cc == nil {
		cc = map[string]any{}
	}
	cc["disable-cloaking-model-list"] = true
	doc["claude-code"] = cc
	if extra := strings.TrimSpace(m.ExtraYAML); extra != "" {
		var ex map[string]any
		if err := yaml.Unmarshal([]byte(extra), &ex); err != nil {
			return fmt.Errorf("extra config YAML: %w", err)
		}
		for k, v := range ex {
			doc[k] = v
		}
	}

	out, err := yaml.Marshal(doc)
	if err != nil {
		return err
	}
	out = append([]byte("# Managed by CartelGate — host/port/secret/auth-dir/api-keys are rewritten on every save.\n"), out...)
	if string(out) == string(cur) {
		return nil
	}
	return os.WriteFile(path, out, 0o644)
}

func stringList(v any) []string {
	items, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, it := range items {
		if s, ok := it.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, strings.TrimSpace(s))
		}
	}
	return out
}

// BuildConfigYAML produces the config.yaml used by the embedded service. It
// keeps the same fields the Electron connector wrote (host, port, management
// secret, auth-dir, api-keys) plus the extra passthrough YAML. With
// requireKey=false the api-keys section is left empty — the engine then
// accepts any client key; with requireKey=true the configured keys (or the
// built-in default) are enforced.
func BuildConfigYAML(host string, port int, secret string, authDir string, apiKeys []string, requireKey bool, extraYAML string) string {
	var b strings.Builder
	b.WriteString("# Generated by CartelGate — embedded CLIProxyAPI config.\n")
	fmt.Fprintf(&b, "host: %s\n", yamlQuote(host))
	fmt.Fprintf(&b, "port: %d\n", port)
	b.WriteString("\nremote-management:\n")
	b.WriteString("  allow-remote: false\n")
	fmt.Fprintf(&b, "  secret-key: %s\n", yamlQuote(secret))
	b.WriteString("  disable-control-panel: false\n")
	fmt.Fprintf(&b, "\nauth-dir: %s\n", yamlQuote(authDir))
	if requireKey {
		b.WriteString("\napi-keys:\n")
		if len(apiKeys) > 0 {
			for _, k := range apiKeys {
				fmt.Fprintf(&b, "  - %s\n", yamlQuote(k))
			}
		} else {
			b.WriteString("  - " + yamlQuote("cg-default-key") + "\n")
		}
	} else {
		// Empty api-keys: the engine unregisters its key provider and
		// accepts any client key.
		b.WriteString("\napi-keys: []\n")
	}
	b.WriteString("\nclaude-code:\n")
	b.WriteString("  disable-cloaking-model-list: true\n")
	b.WriteString("\nlogging-to-file: false\n")
	b.WriteString("usage-statistics-enabled: true\n")
	b.WriteString("request-log: false\n")
	if extra := strings.TrimSpace(extraYAML); extra != "" {
		b.WriteString("\n" + extra + "\n")
	}
	return b.String()
}

func yamlQuote(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`)
	return `"` + r.Replace(s) + `"`
}

// Start builds and runs the embedded service. It returns once the service
// reports startup (OnAfterStart) — the listener may still be a few ms from
// accepting; callers should poll /healthz for readiness. Run() keeps going in
// the background; its exit error lands on ErrChan (buffered, exactly once).
func (e *Embedded) Start(ctx context.Context, cfgPath string) error {
	e.mu.Lock()
	if e.running || e.starting {
		already := e.running
		e.mu.Unlock()
		if already {
			return nil
		}
		return errors.New("embedded service is already starting")
	}
	e.starting = true
	e.cfgPath = cfgPath
	e.mu.Unlock()

	fail := func(err error) error {
		e.mu.Lock()
		e.starting = false
		e.mu.Unlock()
		return err
	}

	raw, err := os.ReadFile(cfgPath)
	if err != nil {
		return fail(fmt.Errorf("read config: %w", err))
	}
	cfg, err := sdkconfig.ParseConfigBytes(raw)
	if err != nil {
		return fail(fmt.Errorf("parse config: %w", err))
	}
	e.mu.Lock()
	e.authDir = cfg.AuthDir
	e.mu.Unlock()
	if e.authDir != "" {
		_ = os.MkdirAll(e.authDir, 0o755)
	}

	tokenStore := sdkAuth.GetTokenStore()
	if dirSetter, ok := tokenStore.(interface{ SetBaseDir(string) }); ok {
		dirSetter.SetBaseDir(cfg.AuthDir)
	}

	started := make(chan struct{}) // closed by OnAfterStart
	hooks := sdkcliproxy.Hooks{
		OnAfterStart: func(s *sdkcliproxy.Service) {
			close(started)
		},
	}

	opts := []sdkapi.ServerOption{
		sdkapi.WithRouterConfigurator(func(engine *gin.Engine, _ *sdkhandlers.BaseAPIHandler, _ *sdkconfig.Config) {
			if e.configure != nil {
				e.configure(engine)
			}
		}),
	}
	if e.root != nil {
		opts = append(opts, sdkapi.WithMiddleware(e.root))
	}

	svc, err := sdkcliproxy.NewBuilder().
		WithConfig(cfg).
		WithConfigPath(cfgPath).
		WithServerOptions(opts...).
		WithHooks(hooks).
		Build()
	if err != nil {
		return fail(fmt.Errorf("build service: %w", err))
	}

	e.mu.Lock()
	e.svc = svc
	e.gen++
	myGen := e.gen
	e.mu.Unlock()

	// runDone is local to this Start call: it must not compete with the
	// app-wide watcher, which drains the shared errChan.
	runDone := make(chan error, 1)
	go func() {
		errRun := svc.Run(ctx)
		select {
		case e.errChan <- errRun:
		default:
			// Watcher hasn't consumed the previous value yet — drop it; a
			// fatal engine error always precedes the process exiting anyway.
		}
		select {
		case runDone <- errRun:
		default:
		}
		e.mu.Lock()
		// Only a run from the newest generation may clear the flags; a stale
		// run finishing after a restart must not clobber the new one's state.
		if e.gen == myGen {
			e.running = false
			e.starting = false
		}
		e.mu.Unlock()
	}()

	select {
	case <-started:
		e.mu.Lock()
		if e.gen == myGen {
			e.running = true
		}
		e.starting = false
		e.mu.Unlock()
		return nil
	case err := <-runDone:
		if err == nil || errors.Is(err, context.Canceled) {
			return fail(errors.New("embedded service stopped during startup"))
		}
		return fail(err)
	}
}

// ErrChan returns the channel that receives each Run()'s exit error (one
// value per Start; nil values are normal shutdowns). The channel is shared
// across restarts, so a single watcher goroutine can read it forever.
func (e *Embedded) ErrChan() <-chan error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.errChan
}

// Stop gracefully shuts the embedded service down. Safe to call repeatedly
// and before Start; a later Start rebuilds and rebinds the service.
func (e *Embedded) Stop() {
	e.mu.Lock()
	svc := e.svc
	e.running = false
	e.gen++ // invalidate in-flight state writes from the current run
	e.mu.Unlock()
	if svc != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = svc.Shutdown(ctx)
	}
}

// IsRunning reports listener state.
func (e *Embedded) IsRunning() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.running
}

// AuthDir exposes the resolved auth directory (for the UI's auth-file count).
func (e *Embedded) AuthDir() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.authDir
}

// Service exposes the underlying SDK service (for future deep integrations).
func (e *Embedded) Service() *sdkcliproxy.Service {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.svc
}
