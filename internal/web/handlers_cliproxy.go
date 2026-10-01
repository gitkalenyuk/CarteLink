// Management/OAuth passthrough for the embedded engine. The CarteLink UI
// calls /api/cliproxy/... on this server; we rewrite those to the embedded
// service's /v0/management/* endpoints and add the X-Management-Key header
// server-side, mirroring the Electron connector's cliproxy:api IPC.
package web

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"cartelgate/internal/config"
)

var browserFlows = map[string]bool{
	"anthropic": true, "codex": true, "antigravity": true,
}

// oauthStateRe restricts the state to safe characters (mirrors the Electron
// regex ^[A-Za-z0-9\-_.]{1,128}$).
var oauthStateRe = regexp.MustCompile(`^[A-Za-z0-9\-_.]{1,128}$`)

const mgmtTimeout = 20 * time.Second

// mgmtRequest performs an authenticated management API call against the
// embedded engine on 127.0.0.1:<port>.
func (a *App) mgmtRequest(method, path string, body []byte) (int, []byte, string) {
	return a.mgmtRequestType(method, path, body, "application/json")
}

// mgmtRequestType is mgmtRequest with an explicit request Content-Type
// (multipart uploads such as the Vertex key import) and a longer timeout for
// plugin installs, which download from GitHub.
func (a *App) mgmtRequestType(method, path string, body []byte, ctype string) (int, []byte, string) {
	if a.Paused() || !a.EngineRunning() {
		errJSON := []byte(`{"ok":false,"error":"Рушій зупинено. Натисніть кнопку 'Запустити' вгорі панелі."}`)
		return http.StatusServiceUnavailable, errJSON, "application/json"
	}
	cfg := a.snapshotConfig()
	full := fmt.Sprintf("http://%s%s", net.JoinHostPort(config.DisplayHost(cfg.Cliproxy.Host), strconv.Itoa(a.EffectivePort())), path)
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, full, rdr)
	if err != nil {
		errJSON := []byte(fmt.Sprintf(`{"ok":false,"error":%q}`, err.Error()))
		return http.StatusInternalServerError, errJSON, "application/json"
	}
	req.Header.Set("X-Management-Key", cfg.Cliproxy.ManagementSecret)
	req.Header.Set("Accept", "application/json, application/yaml, text/plain, */*")
	if body != nil {
		if ctype == "" {
			ctype = "application/json"
		}
		req.Header.Set("Content-Type", ctype)
	}
	timeout := mgmtTimeout
	if strings.Contains(path, "/plugin-store/") {
		timeout = 3 * time.Minute
	}
	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		errJSON := []byte(fmt.Sprintf(`{"ok":false,"error":"Помилка звʼязку з рушієм: %s"}`, err.Error()))
		return http.StatusBadGateway, errJSON, "application/json"
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	respType := resp.Header.Get("Content-Type")
	if respType == "" {
		respType = "application/json"
	}
	return resp.StatusCode, raw, respType
}

// writeMgmtResult forwards a management response to the UI caller.
func writeMgmtResult(w http.ResponseWriter, status int, raw []byte, ctype string) {
	if status <= 0 {
		status = http.StatusBadGateway
	}
	if ctype == "" {
		ctype = "application/json"
	}
	if len(raw) == 0 {
		raw = []byte(`{"ok":false,"error":"Порожня відповідь від сервера"}`)
	}
	w.Header().Set("Content-Type", ctype)
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

// apiClipApi forwards /api/cliproxy/api/<path> (any method) to the embedded
// engine's /v0/management/<path>.
func (a *App) apiClipApi(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/cliproxy/api/")
	if rest == "" {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "missing management path"})
		return
	}
	var body []byte
	if r.Body != nil && r.Method != http.MethodGet {
		body, _ = io.ReadAll(io.LimitReader(r.Body, 8<<20))
	}
	path := "/v0/management/" + rest
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	status, raw, ctype := a.mgmtRequestType(r.Method, path, body, r.Header.Get("Content-Type"))
	writeMgmtResult(w, status, raw, ctype)
}

// apiClipOauthStart: POST /api/cliproxy/oauth/start {provider}
func (a *App) apiClipOauthStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider string `json:"provider"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req)
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	if provider == "" {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "provider is required"})
		return
	}
	path := "/v0/management/" + provider + "-auth-url"
	if browserFlows[provider] {
		path += "?is_webui=true"
	}
	status, raw, _ := a.mgmtRequest(http.MethodGet, path, nil)
	if status >= 200 && status < 300 {
		var parsed struct {
			URL   string `json:"url"`
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &parsed) == nil && parsed.URL != "" {
			// Plugin logins may answer with a path on the engine itself
			// (e.g. /v0/resource/plugins/mirasim/...): make it absolute.
			if strings.HasPrefix(parsed.URL, "/") {
				cfg := a.snapshotConfig()
				parsed.URL = "http://" + net.JoinHostPort(config.DisplayHost(cfg.Cliproxy.Host), strconv.Itoa(a.EffectivePort())) + parsed.URL
				var full map[string]any
				if json.Unmarshal(raw, &full) == nil {
					full["url"] = parsed.URL
					if b, err := json.Marshal(full); err == nil {
						raw = b
					}
				}
			}
			cmd := openCleanBrowser(parsed.URL)
			if cmd != nil {
				a.SetOAuthBrowserCmd(cmd)
			}
		} else if parsed.URL == "" {
			errText := parsed.Error
			if errText == "" {
				errText = "Не вдалося згенерувати посилання для входу"
			}
			jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": errText})
			return
		}
	}
	writeMgmtResult(w, status, raw, "application/json")
}

// apiClipOauthCloseBrowser: POST /api/cliproxy/oauth/close-browser
func (a *App) apiClipOauthCloseBrowser(w http.ResponseWriter, r *http.Request) {
	a.CloseOAuthBrowser()
	jsonWrite(w, http.StatusOK, anyMap{"ok": true})
}

// apiClipOauthStatus: GET /api/cliproxy/oauth/status?state=...
func (a *App) apiClipOauthStatus(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	if state == "" || !oauthStateRe.MatchString(state) {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "bad state"})
		return
	}
	status, raw, _ := a.mgmtRequest(http.MethodGet, "/v0/management/get-auth-status?state="+url.QueryEscape(state), nil)
	if status == 200 {
		var st struct {
			Status    string `json:"status"`
			Completed bool   `json:"completed"`
		}
		if json.Unmarshal(raw, &st) == nil && (st.Status == "ok" || st.Status == "success" || st.Completed) {
			a.CloseOAuthBrowser()
		}
	}
	writeMgmtResult(w, status, raw, "application/json")
}

// apiClipOauthCancel: DELETE /api/cliproxy/oauth/cancel?state=...
func (a *App) apiClipOauthCancel(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	if state == "" || !oauthStateRe.MatchString(state) {
		jsonWrite(w, http.StatusBadRequest, anyMap{"ok": false, "error": "bad state"})
		return
	}
	status, raw, _ := a.mgmtRequest(http.MethodDelete, "/v0/management/oauth-session?state="+url.QueryEscape(state), nil)
	writeMgmtResult(w, status, raw, "application/json")
}

// oauthProfileDir is a throwaway browser profile used for OAuth logins. A
// dedicated --user-data-dir makes Edge/Chrome start a *separate* browser
// process even when the user's own browser is already open, so (1) the
// window has no cookies from earlier logins and (2) killing the process
// really closes the window when the login completes.
func oauthProfileDir() string {
	dir := filepath.Join(config.DataDir(), "oauth-browser")
	_ = os.RemoveAll(dir) // always start from a clean session
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

// openCleanBrowser launches an isolated private browser window so that
// previously logged in OAuth accounts do not pollute the session.
func openCleanBrowser(u string) *exec.Cmd {
	profile := oauthProfileDir()
	chromiumArgs := func(private string) []string {
		return []string{
			"--user-data-dir=" + profile,
			"--no-first-run", "--no-default-browser-check",
			private, "--new-window", u,
		}
	}
	try := func(bin string, args ...string) *exec.Cmd {
		cmd := exec.Command(bin, args...)
		if err := cmd.Start(); err != nil {
			return nil
		}
		return cmd
	}
	switch runtime.GOOS {
	case "windows":
		pf := os.Getenv("ProgramFiles")
		pf86 := os.Getenv("ProgramFiles(x86)")
		local := os.Getenv("LocalAppData")
		candidates := []struct{ bin, private string }{
			{filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`), "--inprivate"},
			{filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`), "--inprivate"},
			{filepath.Join(pf, `Google\Chrome\Application\chrome.exe`), "--incognito"},
			{filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`), "--incognito"},
			{filepath.Join(local, `Google\Chrome\Application\chrome.exe`), "--incognito"},
			{filepath.Join(pf, `BraveSoftware\Brave-Browser\Applicationrave.exe`), "--incognito"},
			{"msedge.exe", "--inprivate"},
			{"chrome.exe", "--incognito"},
		}
		for _, c := range candidates {
			if cmd := try(c.bin, chromiumArgs(c.private)...); cmd != nil {
				return cmd
			}
		}
		// Fallback to the default browser (cannot be closed automatically).
		cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
		_ = cmd.Start()
		return cmd
	case "darwin":
		for _, app := range []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		} {
			if cmd := try(app, chromiumArgs("--incognito")...); cmd != nil {
				return cmd
			}
		}
		cmd := exec.Command("open", u)
		_ = cmd.Start()
		return cmd
	default:
		for _, bin := range []string{"google-chrome", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"} {
			if cmd := try(bin, chromiumArgs("--incognito")...); cmd != nil {
				return cmd
			}
		}
		cmd := exec.Command("xdg-open", u)
		_ = cmd.Start()
		return cmd
	}
}

// providerModelsResp is what apiProviderModels returns.
type providerModelsResp struct {
	OK     bool     `json:"ok"`
	Models []string `json:"models"`
	Error  string   `json:"error,omitempty"`
}

// apiProviderModels: POST /api/provider-models {baseUrl, apiKey, headers}
// fetches <baseUrl>/models from an OpenAI-compatible upstream and returns
// the model ids, so the Providers page can fill the model list for the user.
func (a *App) apiProviderModels(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BaseURL string            `json:"baseUrl"`
		APIKey  string            `json:"apiKey"`
		Headers map[string]string `json:"headers"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		jsonWrite(w, http.StatusBadRequest, providerModelsResp{Error: "invalid body"})
		return
	}
	base := strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		jsonWrite(w, http.StatusBadRequest, providerModelsResp{Error: "base URL must start with http:// or https://"})
		return
	}
	hreq, err := http.NewRequest(http.MethodGet, base+"/models", nil)
	if err != nil {
		jsonWrite(w, http.StatusBadRequest, providerModelsResp{Error: err.Error()})
		return
	}
	if k := strings.TrimSpace(req.APIKey); k != "" {
		hreq.Header.Set("Authorization", "Bearer "+k)
	}
	hreq.Header.Set("Accept", "application/json")
	for k, v := range req.Headers {
		if k = strings.TrimSpace(k); k != "" {
			hreq.Header.Set(k, v)
		}
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(hreq)
	if err != nil {
		jsonWrite(w, http.StatusBadGateway, providerModelsResp{Error: err.Error()})
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(raw))
		if len(msg) > 300 {
			msg = msg[:300] + "…"
		}
		jsonWrite(w, http.StatusBadGateway, providerModelsResp{Error: fmt.Sprintf("upstream %d: %s", resp.StatusCode, msg)})
		return
	}
	jsonWrite(w, http.StatusOK, providerModelsResp{OK: true, Models: parseModelIDs(raw)})
}

// parseModelIDs extracts model ids from the common list shapes:
// {"data":[{"id":..}]}, {"models":[{"id"|"name":..}]}, or a bare array.
func parseModelIDs(raw []byte) []string {
	var any1 any
	if err := json.Unmarshal(raw, &any1); err != nil {
		return []string{}
	}
	var items []any
	switch v := any1.(type) {
	case []any:
		items = v
	case map[string]any:
		for _, key := range []string{"data", "models", "items"} {
			if arr, ok := v[key].([]any); ok {
				items = arr
				break
			}
		}
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(items))
	for _, it := range items {
		var id string
		switch m := it.(type) {
		case string:
			id = m
		case map[string]any:
			if s, ok := m["id"].(string); ok {
				id = s
			} else if s, ok := m["name"].(string); ok {
				id = s
			}
		}
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	sort.Strings(out)
	return out
}
