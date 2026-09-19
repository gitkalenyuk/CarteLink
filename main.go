// CartelGate — one process, one port, one window. The original CLIProxyAPI
// source code (third_party/CLIProxyAPI) is compiled into this binary and runs
// as the server: the same /v1/*, /v1beta/*, /v0/management/* surface as
// upstream, plus the CartelGate dark GUI mounted on the same engine. On
// Windows the app opens a desktop window (WebView2); with --headless (or on
// other platforms) it stays a console server and opens the default browser.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"cartelgate/internal/cliproxy"
	"cartelgate/internal/config"
	"cartelgate/internal/desktop"
	"cartelgate/internal/web"
)

func main() {
	// The window (and its COM apartment) must live on one OS thread.
	runtime.LockOSThread()

	headless := flag.Bool("headless", false, "run the server without the desktop window")
	portOverride := flag.Int("port", 0, "override the configured engine port")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil && !errors.Is(err, config.ErrCorrupt) {
		desktop.Alert("CartelGate", "Не вдалось прочитати налаштування: "+err.Error())
		os.Exit(1)
	}
	configWarning := ""
	if err != nil {
		configWarning = "config.json був пошкоджений і замінений на налаштування за замовчуванням.\n\n" + err.Error()
	}
	if *portOverride > 0 {
		cfg.Cliproxy.Port = *portOverride
	}
	app := web.NewApp(cfg)

	// Redirect stdout/stderr into a log file when there is no console
	// (the -H=windowsgui build). gin writers are re-pointed too — the engine
	// is constructed later, inside Start().
	useGUI := runtime.GOOS == "windows" && !*headless && desktop.Supported()
	if useGUI {
		_ = os.MkdirAll(config.CliproxyLogsDir(), 0o755)
		logPath := filepath.Join(config.CliproxyLogsDir(), "app.log")
		rotateLog(logPath, 5<<20)
		if f, err := os.OpenFile(logPath,
			os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644); err == nil {
			os.Stdout = f
			os.Stderr = f
			log.SetOutput(f)
			gin.DefaultWriter = f
			gin.DefaultErrorWriter = f
			// logrus captures os.Stderr at package init (an invalid handle in
			// a windowsgui build) — re-point it before anything logs.
			logrus.StandardLogger().SetOutput(f)
		}
		gin.SetMode(gin.ReleaseMode)
	}

	// Pick a usable port before the engine binds: if the configured one is
	// taken (another copy, the user's sidecar, …) move to the next free one
	// instead of dying. Never touch whatever holds the port.
	movedFrom := 0
	if p, changed := pickFreePort(cfg.Cliproxy.Host, cfg.Cliproxy.Port); changed {
		movedFrom = cfg.Cliproxy.Port
		cfg.Cliproxy.Port = p
		if *portOverride > 0 {
			log.Printf("port %d busy — CartelGate moved to %d (not saved: --port override)", movedFrom, p)
		} else if err := cfg.Save(); err != nil {
			log.Println("save config after port move:", err)
		} else {
			log.Printf("port %d busy — CartelGate moved to %d (saved)", movedFrom, p)
		}
	}

	// The embedded service owns the listener; CartelGate mounts on top of it.
	port := cfg.Cliproxy.Port
	host := cfg.Cliproxy.Host
	cfgPath := web.EngineCfgPath()

	// Keep config.yaml aligned with our settings (management edits preserved:
	// only the keys CartelGate owns are rewritten).
	if err := app.SyncYAML(cfg); err != nil {
		fail(useGUI, "config.yaml", err)
	}
	if err := cfg.Save(); err != nil {
		log.Println("save config:", err)
	}

	// Mount CartelGate GUI + control API on the shared Gin engine.
	mount := func(engine *gin.Engine) {
		engine.Any("/ui/*path", gin.WrapH(http.StripPrefix("/ui", web.UIHandler())))
		engine.Any("/api/*path", gin.WrapH(web.ControlHandler(app)))
		// No "/" route here — CLIProxyAPI already registers GET "/" (JSON
		// root); the root middleware below hijacks it instead.
	}

	// Root middleware runs ahead of every engine route. Jobs:
	//   1. send "/" to the GUI (upstream registers its own JSON root, so this
	//      has to intercept before routing, not add a route);
	//   2. pause-gate: while "stopped" from the UI, API traffic gets 503 but
	//      the panel, control API and healthz stay alive (they share the
	//      port — a hard server shutdown would kill the panel too);
	//   3. Claude tier mapping — rewrite the requested model name on the
	//      Anthropic/OpenAI chat endpoints using Routing.Tiers / ModelMap
	//      (mirrors the Electron gateway's resolveModel; the mapping is read
	//      per request, so saving it in the UI applies immediately).
	root := func(c *gin.Context) {
		if c.Request.URL.Path == "/" {
			c.Redirect(302, "/ui/")
			c.Abort()
			return
		}
		p := c.Request.URL.Path
		// The control API has no auth of its own, and the engine answers
		// every route with "Access-Control-Allow-Origin: *". Without this
		// gate any web page open in the user's browser could read the
		// config (API key) or drive the Management API passthrough.
		if strings.HasPrefix(p, "/api/") && !sameOriginRequest(c.Request) {
			c.AbortWithStatusJSON(403, gin.H{"ok": false, "error": "cross-origin access to the control API is not allowed"})
			return
		}
		// Panel surface: the GUI, its control API, the engine's own
		// management API (the control API proxies to it) and healthz stay
		// reachable while API traffic is paused.
		isPanel := p == "/ui/" || strings.HasPrefix(p, "/ui/") ||
			strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/v0/management/") ||
			p == "/management.html" || p == "/healthz"
		if !isPanel && app.Paused() {
			c.AbortWithStatusJSON(503, gin.H{
				"error": gin.H{
					"type":    "paused",
					"message": "CartelGate is stopped — press Start in the app.",
				},
			})
			return
		}
		if c.Request.Method == http.MethodPost {
			switch p {
			case "/v1/messages", "/v1/chat/completions":
				rewriteModel(c, app)
			}
		}
		if c.Request.Method == http.MethodGet && (p == "/v1/models" || p == "/models") {
			handleAugmentedModels(c, app)
			return
		}
		c.Next()
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	base := "http://" + config.DisplayHost(host) + ":" + strconv.Itoa(port)

	emb := cliproxy.NewEmbedded(mount, root)
	app.SetEmbedded(emb)
	// Give the UI's Start/Stop/Restart buttons what they need to (re)run the
	// engine: the same root context and config path this first Start uses.
	app.SetLifecycle(ctx, cancel, cfgPath)
	if err := emb.Start(ctx, cfgPath); err != nil {
		fail(useGUI, "server start", err)
	}

	// Start() returns on the OnAfterStart hook, which can fire a moment before
	// the listener actually accepts. Wait for real readiness before opening
	// the window, otherwise the window can land on ERR_CONNECTION_REFUSED.
	if err := waitReady(base, 15*time.Second); err != nil {
		fail(useGUI, "server did not become ready", err)
	}

	uiURL := base + "/ui/"
	if movedFrom != 0 {
		// Let the UI explain the port move (see the banner code in app.js).
		uiURL += "?moved=" + strconv.Itoa(movedFrom) + "&port=" + strconv.Itoa(port)
	}

	// If the engine dies on its own, tell the user instead of hanging. The
	// error channel is shared across restarts, so drain it in a loop; normal
	// shutdowns (nil / context.Canceled, e.g. from Stop or Restart) are
	// ignored — only an unexpected death exits the app.
	var shuttingDown atomic.Bool
	go func() {
		for {
			runErr, ok := <-emb.ErrChan()
			if !ok {
				return
			}
			if runErr == nil || errors.Is(runErr, context.Canceled) {
				continue
			}
			if shuttingDown.Load() {
				return
			}
			log.Println("engine exited:", runErr)
			fail(useGUI, "engine stopped unexpectedly", runErr)
		}
	}()

	// Ctrl+C / SIGTERM: graceful shutdown of the embedded service.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sig
		log.Println("shutting down…")
		shuttingDown.Store(true)
		cancel()
		emb.Stop()
		os.Exit(0)
	}()

	if configWarning != "" {
		log.Println(configWarning)
		if useGUI {
			desktop.Alert("CartelGate", configWarning)
		} else {
			fmt.Fprintln(os.Stderr, configWarning)
		}
	}

	if useGUI {
		// The desktop app: one window, opened automatically. Closing the
		// window quits the app.
		err := desktop.RunMainWindow(uiURL, "CartelGate", config.DataDir())
		if err != nil && err != desktop.ErrClosed {
			log.Println("window creation failed, falling back to browser:", err)
			desktop.Alert("CartelGate", "Microsoft Edge WebView2 runtime не знайдено на цьому комп'ютері.\n\nCartelGate відкриється у вашому стандартному браузері.")
			useGUI = false
		} else {
			shuttingDown.Store(true)
			cancel()
			emb.Stop()
			return
		}
	}

	// Console mode (non-Windows, or --headless): print the map and open the
	// default browser unless headless was requested.
	fmt.Println("CartelGate — one server, one port (CLIProxyAPI embedded + CartelGate UI)")
	fmt.Println("  UI:         " + uiURL)
	fmt.Println("  OpenAI API: " + base + "/v1/chat/completions")
	fmt.Println("  Anthropic:  " + base + "/v1/messages")
	fmt.Println("  Gemini:     " + base + "/v1beta/models")
	if movedFrom != 0 {
		fmt.Printf("  (port %d was busy — moved to %d)\n", movedFrom, port)
	}
	if !*headless {
		openBrowser(uiURL)
	}

	// Park main forever; the service runs on its own goroutines.
	select {}
}

var claudeModelIdentityRe = regexp.MustCompile(`(?i)You are powered by the model named [^.\n\r]+(?:\.|\r?\n)\s*(?:The exact model ID is [a-zA-Z0-9_.\-\[\]]+(?:\.|\r?\n)\s*)?`)

func friendlyModelName(m string) string {
	lower := strings.ToLower(m)
	switch {
	case strings.Contains(lower, "gemini-3.8-flash"):
		return "Gemini 3.8 Flash"
	case strings.Contains(lower, "gemini-3.7-flash"):
		return "Gemini 3.7 Flash"
	case strings.Contains(lower, "gemini-3.6-flash"):
		return "Gemini 3.6 Flash"
	case strings.Contains(lower, "gemini-3.5-flash-lite"):
		return "Gemini 3.5 Flash Lite"
	case strings.Contains(lower, "gemini-3.1-flash-lite"):
		return "Gemini 3.1 Flash Lite"
	case strings.Contains(lower, "gemini-3-flash"):
		return "Gemini 3 Flash"
	case strings.Contains(lower, "gemini-pro-agent") || strings.Contains(lower, "gemini-3.1-pro"):
		return "Gemini 3.1 Pro"
	case strings.Contains(lower, "gpt-oss-120b"):
		return "GPT-OSS 120B"
	case strings.Contains(lower, "claude-sonnet-4-6"):
		return "Claude Sonnet 4.6"
	case strings.Contains(lower, "claude-opus-4-6"):
		return "Claude Opus 4.6"
	case strings.Contains(lower, "gpt-5.5"):
		return "GPT 5.5"
	case strings.Contains(lower, "gpt-6"):
		return "GPT 6 Astra"
	case strings.Contains(lower, "gpt-4o"):
		return "GPT-4o"
	case strings.Contains(lower, "o3-mini"):
		return "o3-mini"
	case strings.Contains(lower, "kimi-k3"):
		return "Kimi K3"
	case strings.Contains(lower, "kimi-k2.8"):
		return "Kimi K2.8"
	case strings.Contains(lower, "kimi-k2.7"):
		return "Kimi K2.7"
	case strings.Contains(lower, "kimi-k2.6"):
		return "Kimi K2.6"
	case strings.Contains(lower, "kimi-k2.5"):
		return "Kimi K2.5"
	case strings.Contains(lower, "kimi-k2"):
		return "Kimi K2"
	case strings.Contains(lower, "grok-3"):
		return "Grok 3"
	case strings.Contains(lower, "llama-3.3"):
		return "Llama 3.3"
	default:
		return m
	}
}

func cleanSystemPrompt(text string, targetModel string) string {
	friendly := friendlyModelName(targetModel)
	replacement := fmt.Sprintf("You are powered by the model named %s. The exact model ID is %s. When asked about your identity or which model you are, you must identify as %s (%s). ", friendly, targetModel, friendly, targetModel)
	if claudeModelIdentityRe.MatchString(text) {
		return claudeModelIdentityRe.ReplaceAllString(text, replacement)
	}
	return text
}

// uncloakClaudeDDModel reverses the claude-fable-5-dd-<reversed> prefix used by
// CLIProxyAPI when cloaking non-Claude models for Claude Code.
func uncloakClaudeDDModel(id string) string {
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
	runes := []rune(base)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return string(runes) + suffix
}

// rewriteModel applies the Claude tier mapping to a chat request body: a
// model containing "haiku"/"sonnet"/"opus" is swapped for the tier's real
// model, then the modelMap applies, then an empty/generic name falls back to
// the default model — the same precedence as the Electron gateway.
// It also resolves cloaked model IDs (claude-fable-5-dd-*) and cleans fake
// identity prompts injected by Claude Code so models report their true identity.
func rewriteModel(c *gin.Context, app *web.App) {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 32<<20))
	if err != nil {
		return // let the engine handler produce its own read error
	}
	_ = c.Request.Body.Close()

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		// Not JSON (or empty) — pass the original bytes through untouched.
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		return
	}

	want, _ := payload["model"].(string)
	cfg := app.CurrentConfig()
	resolved := resolveModelName(cfg, want)
	changed := false
	if resolved != want {
		payload["model"] = resolved
		changed = true
	}

	targetModel := resolved
	if targetModel == "" {
		targetModel = uncloakClaudeDDModel(want)
	}

	// The blacklist is a hard block, not just a filter on /v1/models.
	if isBlacklisted(cfg, targetModel) || isBlacklisted(cfg, want) {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
			"type": "error",
			"error": gin.H{
				"type":    "invalid_request_error",
				"message": "model " + targetModel + " is blocked by the CartelGate model blacklist",
			},
		})
		return
	}

	// Clean Claude Code's artificial "You are powered by the model named Fable 5"
	// instruction so models know their genuine name.
	if sysStr, ok := payload["system"].(string); ok && sysStr != "" {
		newSys := cleanSystemPrompt(sysStr, targetModel)
		if newSys != sysStr {
			payload["system"] = newSys
			changed = true
		}
	} else if sysSlice, ok := payload["system"].([]any); ok && len(sysSlice) > 0 {
		for i, item := range sysSlice {
			if itemMap, ok := item.(map[string]any); ok {
				if t, ok := itemMap["text"].(string); ok && t != "" {
					newT := cleanSystemPrompt(t, targetModel)
					if newT != t {
						itemMap["text"] = newT
						sysSlice[i] = itemMap
						changed = true
					}
				}
			}
		}
		if changed {
			payload["system"] = sysSlice
		}
	}

	if changed {
		if nb, err := json.Marshal(payload); err == nil {
			body = nb
			// Only the REQUEST content-length changes; never touch response
			// headers here (c.Header would poison the downstream response).
			c.Request.ContentLength = int64(len(nb))
		}
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
}

// resolveModelName maps a client-requested model name through the routing
// config. Precedence: an exact modelMap hit (the official-models swaps on the
// Models page) wins over the tier substrings, because names like
// "claude-sonnet-5" also contain a tier word but deserve their own mapping.
// Tier and map values may be "provider:model" (UI convention) — only the
// model part is sent upstream; the engine routes by bare model name.
func resolveModelName(cfg *config.Config, want string) string {
	strip := func(s string) string {
		if i := strings.Index(s, ":"); i >= 0 && !strings.Contains(s, "://") {
			return s[i+1:]
		}
		return s
	}
	r := &cfg.Routing
	uncloaked := uncloakClaudeDDModel(want)

	// 1. Exact mapping (official-models swaps) — highest specificity.
	// Check original want first, then uncloaked.
	if mapped, ok := r.ModelMap[want]; ok && mapped != "" {
		return strip(mapped)
	}
	if mapped, ok := r.ModelMap[uncloaked]; ok && mapped != "" {
		return strip(mapped)
	}

	// 2. Tier mapping.
	m := uncloaked
	switch {
	case strings.Contains(uncloaked, "haiku") && r.Tiers.Haiku != "":
		m = r.Tiers.Haiku
	case strings.Contains(uncloaked, "sonnet") && r.Tiers.Sonnet != "":
		m = r.Tiers.Sonnet
	case strings.Contains(uncloaked, "opus") && r.Tiers.Opus != "":
		m = r.Tiers.Opus
	}
	if mapped, ok := r.ModelMap[m]; ok && mapped != "" {
		m = mapped
	}
	m = strip(m)

	// 3. Empty/generic names fall back to the default model.
	if m == "" || m == "*" {
		if r.DefaultModel != "" {
			return strip(r.DefaultModel)
		}
		return uncloaked
	}
	return m
}

// waitReady polls /healthz until the server answers or the timeout expires.
func waitReady(base string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	url := base + "/healthz"
	client := &http.Client{Timeout: 2 * time.Second}
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 500 {
				return nil
			}
		}
		time.Sleep(150 * time.Millisecond)
	}
	return fmt.Errorf("no response from %s within %s", url, timeout)
}

// pickFreePort probes host:port; when it is busy it scans upward for a free
// one. Returns (port, moved). The probe uses the raw host so that an
// all-interfaces bind ("") is tested against all interfaces, same as the
// engine will bind.
func pickFreePort(host string, port int) (int, bool) {
	if portAvailable(host, port) {
		return port, false
	}
	for p := port + 1; p <= port+100 && p < 65536; p++ {
		if portAvailable(host, p) {
			return p, true
		}
	}
	// Nothing nearby: ask the kernel for any free port.
	if l, err := net.Listen("tcp", net.JoinHostPort(host, "0")); err == nil {
		p := l.Addr().(*net.TCPAddr).Port
		_ = l.Close()
		return p, true
	}
	// Give up moving; the engine will report the original bind error.
	return port, false
}

func portAvailable(host string, port int) bool {
	l, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return false
	}
	_ = l.Close()
	return true
}

// fail reports a fatal error through the UI (message box) or stderr and exits.
func fail(useGUI bool, what string, err error) {
	log.Printf("%s failed: %v", what, err)
	msg := fmt.Sprintf(
		"CartelGate не зміг стартувати.\n\n%s: %v\n\nПовний лог: %s",
		what, err, filepath.Join(config.CliproxyLogsDir(), "app.log"),
	)
	if useGUI {
		desktop.Alert("CartelGate", msg)
	} else {
		fmt.Fprintln(os.Stderr, msg)
	}
	os.Exit(1)
}

// isBlacklisted reports whether a model id is on the configured blacklist.
func isBlacklisted(cfg *config.Config, model string) bool {
	if cfg == nil || model == "" {
		return false
	}
	m := strings.ToLower(strings.TrimSpace(model))
	for _, b := range cfg.ModelBlacklist {
		if strings.ToLower(strings.TrimSpace(b)) == m {
			return true
		}
	}
	return false
}

// sameOriginRequest decides whether a control-API request may proceed.
// Non-browser clients (no Origin, no Sec-Fetch-Site) are local processes and
// pass. Browser requests pass only when the Origin host matches the Host
// header (the embedded window and a tab opened on the UI itself) and the
// Host is a loopback/IP/localhost name — never a DNS-rebound public name.
func sameOriginRequest(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	site := r.Header.Get("Sec-Fetch-Site")
	if origin == "" && (site == "" || site == "none" || site == "same-origin") {
		return true
	}
	if site == "cross-site" {
		return false
	}
	if origin != "" {
		u, err := url.Parse(origin)
		if err != nil || !strings.EqualFold(u.Host, r.Host) {
			return false
		}
	}
	hostOnly := r.Host
	if h, _, err := net.SplitHostPort(r.Host); err == nil {
		hostOnly = h
	}
	hostOnly = strings.Trim(hostOnly, "[]")
	if strings.EqualFold(hostOnly, "localhost") || net.ParseIP(hostOnly) != nil {
		return true
	}
	return false
}

// rotateLog keeps app.log bounded: once it exceeds maxBytes the current file
// becomes app.log.1 (replacing the previous one) and a fresh log is started.
func rotateLog(path string, maxBytes int64) {
	fi, err := os.Stat(path)
	if err != nil || fi.Size() < maxBytes {
		return
	}
	_ = os.Remove(path + ".1")
	_ = os.Rename(path, path+".1")
}

// openBrowser opens the default browser cross-platform (console fallback).
func openBrowser(u string) {
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
	case "darwin":
		_ = exec.Command("open", u).Start()
	default:
		_ = exec.Command("xdg-open", u).Start()
	}
}

// responseRecorder captures status, headers and body from downstream handlers
// without committing them immediately, allowing response transformation.
type responseRecorder struct {
	gin.ResponseWriter
	statusCode int
	body       *bytes.Buffer
	header     http.Header
}

func newResponseRecorder(w gin.ResponseWriter) *responseRecorder {
	return &responseRecorder{
		ResponseWriter: w,
		statusCode:     http.StatusOK,
		body:           bytes.NewBuffer(nil),
		header:         make(http.Header),
	}
}

func (r *responseRecorder) Header() http.Header {
	return r.header
}

func (r *responseRecorder) WriteHeader(code int) {
	r.statusCode = code
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	return r.body.Write(b)
}

func (r *responseRecorder) WriteString(s string) (int, error) {
	return r.body.WriteString(s)
}

func (r *responseRecorder) Status() int {
	return r.statusCode
}

type catalogModel struct {
	ID          string
	DisplayName string
	OwnedBy     string
}

var officialClaudeModels = []catalogModel{
	{"claude-fable-5-1", "Claude Fable 5.1", "anthropic"},
	{"claude-opus-5", "Claude Opus 5", "anthropic"},
	{"claude-sonnet-5", "Claude Sonnet 5", "anthropic"},
	{"claude-haiku-4-5", "Claude Haiku 4.5", "anthropic"},
	{"claude-haiku-4-5-20251001", "Claude Haiku 4.5 (20251001)", "anthropic"},
	{"claude-fable-5", "Claude Fable 5", "anthropic"},
	{"claude-opus-4-8", "Claude Opus 4.8", "anthropic"},
	{"claude-opus-4-7", "Claude Opus 4.7", "anthropic"},
	{"claude-opus-4-6", "Claude Opus 4.6", "anthropic"},
	{"claude-opus-4-6-thinking", "Claude Opus 4.6 (Thinking)", "anthropic"},
	{"claude-opus-3", "Claude Opus 3", "anthropic"},
	{"claude-sonnet-4-6", "Claude Sonnet 4.6", "anthropic"},
	{"claude-3-7-sonnet-20250219", "Claude 3.7 Sonnet", "anthropic"},
	{"claude-3-7-sonnet-latest", "Claude 3.7 Sonnet (Latest)", "anthropic"},
	{"claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet", "anthropic"},
	{"claude-3-5-sonnet-latest", "Claude 3.5 Sonnet (Latest)", "anthropic"},
	{"claude-3-5-haiku-20241022", "Claude 3.5 Haiku", "anthropic"},
	{"claude-3-5-haiku-latest", "Claude 3.5 Haiku (Latest)", "anthropic"},
	{"claude-3-opus-20240229", "Claude 3 Opus", "anthropic"},
	{"claude-3-opus-latest", "Claude 3 Opus (Latest)", "anthropic"},
	{"claude-3-haiku-20240307", "Claude 3 Haiku", "anthropic"},
}

func isAnthropicModelsRequest(c *gin.Context) bool {
	if c.GetHeader("Anthropic-Version") != "" {
		return true
	}
	return strings.HasPrefix(c.GetHeader("User-Agent"), "claude-cli")
}

func handleAugmentedModels(c *gin.Context, app *web.App) {
	rec := newResponseRecorder(c.Writer)
	c.Writer = rec
	c.Next()

	// If auth failed or upstream returned an error, pass through upstream's status & body
	if rec.statusCode != http.StatusOK {
		for k, v := range rec.header {
			rec.ResponseWriter.Header()[k] = v
		}
		rec.ResponseWriter.WriteHeader(rec.statusCode)
		_, _ = rec.ResponseWriter.Write(rec.body.Bytes())
		return
	}

	isAnthropic := isAnthropicModelsRequest(c)

	var upstream struct {
		Data []map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rec.body.Bytes(), &upstream)

	seen := make(map[string]bool)
	var allModels []catalogModel

	// 1. Add all official Claude models so Claude Code model picker has the full catalog
	for _, m := range officialClaudeModels {
		if !seen[m.ID] {
			seen[m.ID] = true
			allModels = append(allModels, m)
		}
	}

	// 2. Add uncloaked models from upstream CLIProxyAPI
	for _, raw := range upstream.Data {
		id, _ := raw["id"].(string)
		uncloaked := uncloakClaudeDDModel(id)
		if uncloaked == "" {
			continue
		}
		owned, _ := raw["owned_by"].(string)
		if owned == "" {
			owned = "cliproxy"
		}
		displayName, _ := raw["display_name"].(string)
		if displayName == "" || strings.Contains(displayName, "claude-fable-5-dd") {
			displayName = friendlyModelName(uncloaked)
		}

		if !seen[uncloaked] {
			seen[uncloaked] = true
			allModels = append(allModels, catalogModel{
				ID:          uncloaked,
				DisplayName: displayName,
				OwnedBy:     owned,
			})
		}
	}

	// 3. Add models from active providers in CartelGate config
	cfg := app.CurrentConfig()
	if cfg != nil {
		for _, p := range cfg.Providers {
			for _, m := range p.Models {
				cleanM := strings.TrimSpace(m)
				if cleanM != "" && !seen[cleanM] {
					seen[cleanM] = true
					allModels = append(allModels, catalogModel{
						ID:          cleanM,
						DisplayName: friendlyModelName(cleanM),
						OwnedBy:     p.ID,
					})
				}
			}
		}
	}

	// 3.5. Filter out blacklisted models
	if cfg != nil && len(cfg.ModelBlacklist) > 0 {
		blk := make(map[string]bool)
		for _, b := range cfg.ModelBlacklist {
			blk[strings.ToLower(strings.TrimSpace(b))] = true
		}
		var filtered []catalogModel
		for _, m := range allModels {
			if !blk[strings.ToLower(strings.TrimSpace(m.ID))] {
				filtered = append(filtered, m)
			}
		}
		allModels = filtered
	}

	// 4. Format according to client type
	var out []byte
	var err error
	if isAnthropic {
		var dataList []map[string]any
		for _, m := range allModels {
			dataList = append(dataList, map[string]any{
				"type":             "model",
				"id":               m.ID,
				"display_name":     m.DisplayName,
				"created_at":       "2025-01-01T00:00:00Z",
				"max_tokens":       64000,
				"max_input_tokens": 200000,
				"object":           "model",
				"owned_by":         m.OwnedBy,
			})
		}
		firstID := ""
		lastID := ""
		if len(dataList) > 0 {
			firstID, _ = dataList[0]["id"].(string)
			lastID, _ = dataList[len(dataList)-1]["id"].(string)
		}
		out, err = json.Marshal(map[string]any{
			"data":     dataList,
			"has_more": false,
			"first_id": firstID,
			"last_id":  lastID,
		})
	} else {
		var dataList []map[string]any
		for _, m := range allModels {
			dataList = append(dataList, map[string]any{
				"id":       m.ID,
				"object":   "model",
				"owned_by": m.OwnedBy,
			})
		}
		out, err = json.Marshal(map[string]any{
			"object": "list",
			"data":   dataList,
		})
	}

	if err != nil {
		rec.ResponseWriter.WriteHeader(http.StatusInternalServerError)
		return
	}

	// Copy upstream response headers (CORS, cache-control, etc.)
	for k, v := range rec.header {
		rec.ResponseWriter.Header()[k] = v
	}
	rec.ResponseWriter.Header().Set("Content-Type", "application/json; charset=utf-8")
	rec.ResponseWriter.Header().Set("Content-Length", strconv.Itoa(len(out)))
	rec.ResponseWriter.WriteHeader(http.StatusOK)
	_, _ = rec.ResponseWriter.Write(out)
}
