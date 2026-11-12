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
	case path == "/scoped-keys" || strings.HasPrefix(path, "/scoped-keys/"):
		a.apiScopedKeys(w, r, strings.TrimPrefix(strings.TrimPrefix(path, "/scoped-keys"), "/"))
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
	case path == "/app/ping" && r.Method == http.MethodGet:
		a.apiAppPing(w, r)
	case path == "/app/show" && r.Method == http.MethodPost:
		a.apiAppShow(w, r)
	case path == "/app/settings" && r.Method == http.MethodGet:
		a.apiAppSettingsGet(w, r)
	case path == "/app/settings" && r.Method == http.MethodPut:
		a.apiAppSettingsPut(w, r)
	case path == "/account-provider/hide" && r.Method == http.MethodPost:
		a.apiAccountProviderHide(w, r)
	case path == "/routing/apply-all" && r.Method == http.MethodPost:
		a.apiRoutingApplyAll(w, r)
	case path == "/switcher" && r.Method == http.MethodGet:
		a.apiSwitcherGet(w, r)
	case path == "/switcher" && r.Method == http.MethodPut:
		a.apiSwitcherPut(w, r)
	case path == "/switcher/switch" && r.Method == http.MethodPost:
		a.apiSwitcherSwitch(w, r)
	case path == "/model-info" && r.Method == http.MethodGet:
		a.apiModelInfo(w, r)
	case path == "/model-context" && r.Method == http.MethodGet:
		a.apiModelContext(w, r)
	case path == "/engine-models" && r.Method == http.MethodGet:
		jsonWrite(w, http.StatusOK, anyMap{"ok": true, "models": a.EngineModels()})
	case path == "/errors" && r.Method == http.MethodGet:
		a.apiErrorsGet(w, r)
	case path == "/errors/clear" && r.Method == http.MethodPost:
		a.apiErrorsClear(w, r)
	case path == "/limits" && r.Method == http.MethodGet:
		a.apiLimits(w, r)
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
