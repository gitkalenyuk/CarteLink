package web

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (a *App) controlRoot(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(r.URL.Path, "/api")
	a.control(w, r, p)
}

func (a *App) control(w http.ResponseWriter, r *http.Request, path string) {
	switch {
	case path == "/status" && r.Method == http.MethodGet:
		a.apiStatus(w, r)
	case path == "/auth/status" && r.Method == http.MethodGet:
		a.apiAuthStatus(w, r)
	case path == "/auth/login" && r.Method == http.MethodPost:
		a.apiAuthLogin(w, r)
	case path == "/auth/logout" && r.Method == http.MethodPost:
		a.apiAuthLogout(w, r)
	case path == "/auth/recheck" && r.Method == http.MethodPost:
		a.apiAuthRecheck(w, r)
	case path == "/endpoints" && r.Method == http.MethodGet:
		a.apiEndpoints(w, r)
	case path == "/config" && r.Method == http.MethodGet:
		a.apiConfigGet(w, r)
	case path == "/config" && r.Method == http.MethodPut:
		a.apiConfigSave(w, r)
	case path == "/server/start" && r.Method == http.MethodPost:
		a.apiServerStart(w, r)
	case path == "/server/stop" && r.Method == http.MethodPost:
		a.apiServerStop(w, r)
	case path == "/server/restart" && r.Method == http.MethodPost:
		a.apiServerRestart(w, r)
	case path == "/generate-key" && r.Method == http.MethodPost:
		a.apiGenerateKey(w, r)
	case path == "/account-to-provider" && r.Method == http.MethodPost:
		a.apiAccountToProvider(w, r)
	case path == "/provider-models" && r.Method == http.MethodPost:
		a.apiProviderModels(w, r)
	case strings.HasPrefix(path, "/cliproxy/api/"):
		a.apiClipApi(w, r)
	case path == "/cliproxy/oauth/start":
		a.apiClipOauthStart(w, r)
	case path == "/cliproxy/oauth/status":
		a.apiClipOauthStatus(w, r)
	case path == "/cliproxy/oauth/cancel":
		a.apiClipOauthCancel(w, r)
		case path == "/metrics" && r.Method == http.MethodGet:
		a.apiMetricsGet(w, r)
	case path == "/metrics/clear" && r.Method == http.MethodPost:
		a.apiMetricsClear(w, r)
	case path == "/cliproxy/oauth/close-browser" && r.Method == http.MethodPost:
		a.apiClipOauthCloseBrowser(w, r)
	default:
		jsonWrite(w, http.StatusNotFound, anyMap{"ok": false, "error": "unknown endpoint " + path})
	}
}

func jsonWrite(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}
