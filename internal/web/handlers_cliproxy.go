// Management/OAuth passthrough for the embedded engine. The VisionGate UI
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
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"visiongate/internal/config"
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
	cfg := a.snapshotConfig()
	full := fmt.Sprintf("http://%s%s", net.JoinHostPort(config.DisplayHost(cfg.Cliproxy.Host), strconv.Itoa(cfg.Cliproxy.Port)), path)
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, full, rdr)
	if err != nil {
		return 0, nil, err.Error()
	}
	req.Header.Set("X-Management-Key", cfg.Cliproxy.ManagementSecret)
	req.Header.Set("Accept", "application/json, application/yaml, text/plain, */*")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: mgmtTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err.Error()
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	return resp.StatusCode, raw, resp.Header.Get("Content-Type")
}

// writeMgmtResult forwards a management response to the UI caller.
func writeMgmtResult(w http.ResponseWriter, status int, raw []byte, ctype string) {
	if ctype == "" {
		ctype = "application/json"
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
	status, raw, ctype := a.mgmtRequest(r.Method, path, body)
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
			URL string `json:"url"`
		}
		if json.Unmarshal(raw, &parsed) == nil && parsed.URL != "" {
			cmd := openCleanBrowser(parsed.URL)
			if cmd != nil {
				a.SetOAuthBrowserCmd(cmd)
			}
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

// openCleanBrowser launches an isolated, private/incognito browser window
// so that previously logged in OAuth accounts do not pollute the session.
func openCleanBrowser(u string) *exec.Cmd {
	switch runtime.GOOS {
	case "windows":
		edgePaths := []string{
			`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
			`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
		}
		for _, p := range edgePaths {
			cmd := exec.Command(p, "--inprivate", "--new-window", u)
			if err := cmd.Start(); err == nil {
				return cmd
			}
		}
		chromePaths := []string{
			`C:\Program Files\Google\Chrome\Application\chrome.exe`,
			`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
		}
		for _, p := range chromePaths {
			cmd := exec.Command(p, "--incognito", "--new-window", u)
			if err := cmd.Start(); err == nil {
				return cmd
			}
		}
		// Fallback to msedge in PATH
		cmd := exec.Command("msedge.exe", "--inprivate", "--new-window", u)
		if err := cmd.Start(); err == nil {
			return cmd
		}
		// Fallback to default browser
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
		_ = cmd.Start()
		return cmd
	case "darwin":
		cmd := exec.Command("open", "-na", "Google Chrome", "--args", "--incognito", u)
		if err := cmd.Start(); err == nil {
			return cmd
		}
		cmd = exec.Command("open", u)
		_ = cmd.Start()
		return cmd
	default:
		cmd := exec.Command("google-chrome", "--incognito", "--new-window", u)
		if err := cmd.Start(); err == nil {
			return cmd
		}
		cmd = exec.Command("xdg-open", u)
		_ = cmd.Start()
		return cmd
	}
}
