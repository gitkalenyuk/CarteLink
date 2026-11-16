// cartelink-engine is the CLIProxyAPI engine host for CarteLink 3. The Rust
// app embeds this binary, writes it to the data folder and runs it as a hidden
// child process on a private loopback port. Everything user-facing (the
// gateway port, key checks, model mapping, the UI) lives in the Rust app; this
// process only runs the original upstream engine (third_party/CLIProxyAPI)
// plus two things the SDK service does not start by itself: the model catalog
// updater and the Antigravity client-version updater.
//
// Lifetime: the process exits when its stdin closes (the parent died or asked
// it to stop), so it never outlives CarteLink.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	_ "unsafe" // go:linkname

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	sdkapi "github.com/router-for-me/CLIProxyAPI/v7/sdk/api"
	sdkhandlers "github.com/router-for-me/CLIProxyAPI/v7/sdk/api/handlers"
	sdkAuth "github.com/router-for-me/CLIProxyAPI/v7/sdk/auth"
	sdkcliproxy "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
	_ "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator/builtin" // all built-in translators
)

// UpstreamVersion is the version of the embedded CLIProxyAPI source.
const UpstreamVersion = "7.3.20"

// The upstream server binary starts these from its own main(); the SDK service
// does not. They live in internal packages, so they are reached by linkname.
//
//go:linkname startModelsUpdater github.com/router-for-me/CLIProxyAPI/v7/internal/registry.StartModelsUpdater
func startModelsUpdater(ctx context.Context)

//go:linkname refreshAntigravityVersion github.com/router-for-me/CLIProxyAPI/v7/internal/misc.refreshAntigravityVersion
func refreshAntigravityVersion(ctx context.Context)

//go:linkname startAntigravityVersionUpdater github.com/router-for-me/CLIProxyAPI/v7/internal/misc.StartAntigravityVersionUpdater
func startAntigravityVersionUpdater(ctx context.Context)

//go:linkname antigravityLatestVersion github.com/router-for-me/CLIProxyAPI/v7/internal/misc.AntigravityLatestVersion
func antigravityLatestVersion() string

func main() {
	cfgPath := flag.String("config", "", "path to config.yaml")
	secret := flag.String("secret", "", "management secret guarding /_cartelink/*")
	version := flag.Bool("version", false, "print the engine version and exit")
	flag.Parse()
	if *version {
		fmt.Println(UpstreamVersion)
		return
	}
	if *cfgPath == "" {
		log.Fatal("-config is required")
	}
	log.SetFlags(log.LstdFlags)
	log.SetOutput(os.Stderr)
	logrus.StandardLogger().SetOutput(os.Stderr)
	gin.SetMode(gin.ReleaseMode)
	gin.DefaultWriter = os.Stderr
	gin.DefaultErrorWriter = os.Stderr

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Parent gone (stdin closed) or a signal: shut down.
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		cancel()
	}()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() { <-sig; cancel() }()

	// Current Antigravity client version before accounts register: Google
	// hides newer models from old client versions.
	refreshAntigravityVersion(ctx)
	startAntigravityVersionUpdater(ctx)
	log.Printf("antigravity client version: %s", antigravityLatestVersion())

	if err := run(ctx, *cfgPath, *secret); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("engine stopped: %v", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, cfgPath, secret string) error {
	raw, err := os.ReadFile(cfgPath)
	if err != nil {
		return fmt.Errorf("read config: %w", err)
	}
	cfg, err := sdkconfig.ParseConfigBytes(raw)
	if err != nil {
		return fmt.Errorf("parse config: %w", err)
	}
	if cfg.AuthDir != "" {
		_ = os.MkdirAll(cfg.AuthDir, 0o755)
	}
	if ds, ok := sdkAuth.GetTokenStore().(interface{ SetBaseDir(string) }); ok {
		ds.SetBaseDir(cfg.AuthDir)
	}

	started := make(chan struct{})
	svc, err := sdkcliproxy.NewBuilder().
		WithConfig(cfg).
		WithConfigPath(cfgPath).
		WithServerOptions(sdkapi.WithRouterConfigurator(func(e *gin.Engine, _ *sdkhandlers.BaseAPIHandler, _ *sdkconfig.Config) {
			mountCarteLink(e, secret)
		})).
		WithHooks(sdkcliproxy.Hooks{OnAfterStart: func(*sdkcliproxy.Service) { close(started) }}).
		Build()
	if err != nil {
		return fmt.Errorf("build service: %w", err)
	}

	done := make(chan error, 1)
	go func() { done <- svc.Run(ctx) }()

	select {
	case <-started:
		// The Rust app waits for /healthz; this line is for the log only.
		log.Printf("CARTELINK_ENGINE_READY %s", UpstreamVersion)
		startModelsUpdater(ctx)
	case err := <-done:
		return err
	}

	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		sctx, scancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer scancel()
		_ = svc.Shutdown(sctx)
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
		return ctx.Err()
	}
}

// mountCarteLink adds the few read-only endpoints the Rust app needs from
// inside the engine process (the model registry is in-process state).
func mountCarteLink(e *gin.Engine, secret string) {
	guard := func(c *gin.Context) {
		got := c.GetHeader("X-CarteLink-Secret")
		if secret == "" || subtle.ConstantTimeCompare([]byte(got), []byte(secret)) != 1 {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		c.Next()
	}
	g := e.Group("/_cartelink", guard)
	g.GET("/info", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"upstream": UpstreamVersion, "antigravity": antigravityLatestVersion()})
	})
	g.GET("/caps", func(c *gin.Context) {
		out, err := json.Marshal(modelCaps())
		if err != nil {
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
		c.Data(http.StatusOK, "application/json", out)
	})
}

// caps is what CarteLink needs to know about a model before it may add
// reasoning settings to a request, and its limits.
type caps struct {
	Thinking       bool     `json:"thinking"`
	Min            int      `json:"min,omitempty"`
	Max            int      `json:"max,omitempty"`
	ZeroAllowed    bool     `json:"zeroAllowed,omitempty"`
	DynamicAllowed bool     `json:"dynamicAllowed,omitempty"`
	Levels         []string `json:"levels,omitempty"`
	Effort         bool     `json:"effort"`
	Type           string   `json:"type,omitempty"`
	Context        int      `json:"context,omitempty"`
	MaxOutput      int      `json:"maxOutput,omitempty"`
	ConfigUpdate   bool     `json:"configUpdate,omitempty"`
	Providers      []string `json:"providers,omitempty"`
}

var effortParams = map[string]bool{"reasoning_effort": true, "reasoning": true, "effort": true}

// The SDK interface does not expose these, the concrete registry does.
type fullRegistry interface {
	GetAvailableModelInfos() []*sdkcliproxy.ModelInfo
	GetModelProviders(modelID string) []string
	GetModelInfo(modelID, provider string) *sdkcliproxy.ModelInfo
}

// modelCaps walks every available model and every provider serving it. When
// several providers serve one id the entry with reasoning controls wins and
// limits take the smaller value (a request may land on any of them).
func modelCaps() map[string]caps {
	out := map[string]caps{}
	reg, ok := sdkcliproxy.GlobalModelRegistry().(fullRegistry)
	if !ok {
		return out
	}
	for _, info := range reg.GetAvailableModelInfos() {
		if info == nil || strings.TrimSpace(info.ID) == "" {
			continue
		}
		provs := reg.GetModelProviders(info.ID)
		infos := make([]*sdkcliproxy.ModelInfo, 0, len(provs)+1)
		for _, p := range provs {
			if m := reg.GetModelInfo(info.ID, p); m != nil {
				infos = append(infos, m)
			}
		}
		if len(infos) == 0 {
			infos = append(infos, info)
		}
		key := strings.ToLower(uncloak(info.ID))
		for _, m := range infos {
			c := capsOf(m)
			c.Providers = provs
			if prev, ok := out[key]; ok {
				c = mergeCaps(prev, c)
			}
			out[key] = c
		}
	}
	return out
}

func capsOf(m *sdkcliproxy.ModelInfo) caps {
	c := caps{Type: m.Type, ConfigUpdate: m.SupportConfigurationUpdate}
	if th := m.Thinking; th != nil && (th.Max > 0 || len(th.Levels) > 0) {
		c.Thinking = true
		c.Min, c.Max = th.Min, th.Max
		c.ZeroAllowed, c.DynamicAllowed = th.ZeroAllowed, th.DynamicAllowed
		c.Levels = append([]string(nil), th.Levels...)
	}
	for _, p := range m.SupportedParameters {
		if effortParams[strings.ToLower(strings.TrimSpace(p))] {
			c.Effort = true
		}
	}
	switch strings.ToLower(m.Type) {
	case "openai", "codex", "openai-response":
		c.Effort = true
	}
	c.Context = firstPositive(m.MaxContextLength, m.ContextLength, m.InputTokenLimit)
	c.MaxOutput = firstPositive(m.MaxCompletionTokens, m.OutputTokenLimit)
	return c
}

func mergeCaps(prev, c caps) caps {
	c.Context = minPositive(prev.Context, c.Context)
	c.MaxOutput = minPositive(prev.MaxOutput, c.MaxOutput)
	if !(prev.Thinking || prev.Effort) {
		return c
	}
	if !(c.Thinking || c.Effort) {
		prev.Context, prev.MaxOutput = c.Context, c.MaxOutput
		return prev
	}
	c.ConfigUpdate = c.ConfigUpdate && prev.ConfigUpdate
	return c
}

func firstPositive(v ...int) int {
	for _, x := range v {
		if x > 0 {
			return x
		}
	}
	return 0
}

func minPositive(a, b int) int {
	switch {
	case a <= 0:
		return b
	case b <= 0 || a < b:
		return a
	}
	return b
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
