package web

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Some account types advertise a fixed model list whether or not the
// account's plan includes each model. Kiro is the case in point: a free AWS
// Builder ID account cannot ask Kiro which models it may use, so the plugin
// offers all of them and Kiro answers INVALID_MODEL_ID at request time. The
// Claude account serves the same names, so every other request would fail.
// CarteLink hides such a model for that account type as soon as the provider
// rejects it (the same list as Accounts → models → hide, so it can be undone
// there) and the next request goes to an account that has it.

var autoHideMu sync.Mutex

// RejectedModelProvider reports which account type refused a model as not
// available on the account, going by the upstream error text ("" = none).
func RejectedModelProvider(message string) string {
	m := strings.ToLower(message)
	if strings.Contains(m, "invalid_model_id") && strings.Contains(m, "kiro ") {
		return "kiro"
	}
	return ""
}

// BaseModelName drops CarteLink's own additions to a model id: the thinking
// suffix "model(high)" and Claude Code's "[1m]" marker.
func BaseModelName(model string) string {
	model = strings.TrimSpace(model)
	if n := len(model); n > 4 && strings.EqualFold(model[n-4:], "[1m]") {
		model = strings.TrimSpace(model[:n-4])
	}
	if strings.HasSuffix(model, ")") {
		if i := strings.LastIndex(model, "("); i > 0 {
			model = strings.TrimSpace(model[:i])
		}
	}
	return model
}

// AutoHideModel adds model to provider's hidden-model list. It returns true
// when the list changed.
func (a *App) AutoHideModel(provider, model string) bool {
	provider = strings.ToLower(strings.TrimSpace(provider))
	model = BaseModelName(model)
	if provider == "" || model == "" {
		return false
	}
	autoHideMu.Lock()
	defer autoHideMu.Unlock()

	status, raw, _ := a.mgmtRequest(http.MethodGet, "/v0/management/oauth-excluded-models", nil)
	if status != http.StatusOK {
		return false
	}
	var cur struct {
		Excluded map[string][]string `json:"oauth-excluded-models"`
	}
	if json.Unmarshal(raw, &cur) != nil {
		return false
	}
	list := cur.Excluded[provider]
	for _, m := range list {
		if strings.EqualFold(strings.TrimSpace(m), model) {
			return false
		}
	}
	body, _ := json.Marshal(map[string]any{"provider": provider, "models": append(append([]string(nil), list...), model)})
	status, _, _ = a.mgmtRequest(http.MethodPatch, "/v0/management/oauth-excluded-models", body)
	if status != http.StatusOK {
		return false
	}
	a.ErrorLog().Add(ErrorEntry{Kind: "auto", Model: model,
		Message: "model " + model + " is not available on the " + provider + " account(s) — CarteLink hid it for " + provider})
	return true
}

// A provider's content filter refuses one request, not the key, but the
// engine cools the key down like after any upstream failure and every next
// request gets "auth_unavailable" until the cooldown ends. After such a
// refusal CarteLink finds the key that served it (usage records carry its
// auth_index) and lifts the cooldown right away.

// IsContentFilterError reports whether an upstream error is a content-filter refusal.
func IsContentFilterError(message string) bool {
	m := strings.ToLower(message)
	return strings.Contains(m, "content_filter") || strings.Contains(m, "content filter")
}

// UnblockAfterContentFilter lifts the cooldown of the key that served the
// refused request for model. The usage record arrives a few seconds after
// the response, so it is looked for a few times.
func (a *App) UnblockAfterContentFilter(model string) {
	model = BaseModelName(model)
	if model == "" || a.metricsStore == nil {
		return
	}
	since := time.Now().Add(-time.Minute)
	for try := 0; try < 6; try++ {
		time.Sleep(3 * time.Second)
		for _, rec := range a.metricsStore.Snapshot().History {
			failed, _ := rec["failed"].(bool)
			idx, _ := rec["auth_index"].(string)
			if !failed || idx == "" || !strings.EqualFold(BaseModelName(recModel(rec)), model) {
				continue
			}
			if ts, _ := rec["timestamp"].(string); ts != "" {
				if t, err := time.Parse(time.RFC3339Nano, ts); err == nil && t.Before(since) {
					continue
				}
			}
			body, _ := json.Marshal(map[string]string{"auth_index": idx})
			if status, _, _ := a.mgmtRequest(http.MethodPost, "/v0/management/reset-quota", body); status == http.StatusOK {
				a.ErrorLog().Add(ErrorEntry{Kind: "auto", Model: model,
					Message: "the provider's content filter refused one request for " + model + " — CarteLink kept the key available"})
			}
			return
		}
	}
}

func recModel(rec map[string]any) string {
	for _, k := range []string{"model", "alias", "response_model"} {
		if s, _ := rec[k].(string); s != "" {
			return s
		}
	}
	return ""
}
