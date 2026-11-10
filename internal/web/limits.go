// Account limits for the Overview and Statistics pages.
//
// The engine already keeps what the upstream said about each account: the
// rate-limit headers of the last response (Codex: x-codex-primary-*, Claude:
// anthropic-ratelimit-unified-*), the cooldown after a refusal and, for plugin
// accounts, a quota provider. GET /api/limits turns all of that into one plain
// shape so the UI never parses provider headers itself.
package web

import (
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// LimitWindow is one usage window of an account (5 hours, a week, a plugin bucket).
type LimitWindow struct {
	Key         string  `json:"key"`               // "5h", "week" or "other"
	Label       string  `json:"label,omitempty"`   // upstream name for "other" windows
	Minutes     int     `json:"minutes,omitempty"` // window length, when known
	UsedPercent float64 `json:"usedPercent"`       // 0..100
	ResetAt     int64   `json:"resetAt,omitempty"` // unix ms
	// Rolled: the window ended after the last observation, so the usage shown
	// (0) is an inference, not something the provider reported.
	Rolled bool `json:"rolled,omitempty"`
}

// LimitMetric is a free-form number a plugin reports (credits, balance…).
type LimitMetric struct {
	Label    string  `json:"label"`
	Value    float64 `json:"value"`
	Unit     string  `json:"unit,omitempty"`
	Currency string  `json:"currency,omitempty"`
}

// AccountLimit is everything the UI shows about one account's limits.
type AccountLimit struct {
	ID         string        `json:"id"`
	AuthIndex  string        `json:"authIndex"`
	Name       string        `json:"name"`
	Provider   string        `json:"provider"`
	Label      string        `json:"label"`
	Plan       string        `json:"plan,omitempty"`
	State      string        `json:"state"` // ok | warn | limited | error | disabled
	Message    string        `json:"message,omitempty"`
	RetryAt    int64         `json:"retryAt,omitempty"`    // unix ms, end of the cooldown
	ObservedAt int64         `json:"observedAt,omitempty"` // unix ms, age of the window data
	Windows    []LimitWindow `json:"windows"`
	Metrics    []LimitMetric `json:"metrics,omitempty"`
	Success    int64         `json:"success"`
	Failed     int64         `json:"failed"`
	// Percent: the provider reports usage in percent (rings can be drawn).
	Percent bool `json:"percent"`
	// Pending: a plugin quota is being fetched; ask again in a few seconds.
	Pending bool `json:"pending,omitempty"`
}

// warnAt is where an account turns amber: close to its limit, still answering.
const warnAt = 80.0

type authFileEntry struct {
	ID            string `json:"id"`
	AuthIndex     string `json:"auth_index"`
	Name          string `json:"name"`
	Provider      string `json:"provider"`
	Type          string `json:"type"`
	Label         string `json:"label"`
	Email         string `json:"email"`
	Account       string `json:"account"`
	Status        string `json:"status"`
	StatusMessage string `json:"status_message"`
	Disabled      bool   `json:"disabled"`
	Unavailable   bool   `json:"unavailable"`
	Success       int64  `json:"success"`
	Failed        int64  `json:"failed"`
	SupportsQuota bool   `json:"supports_quota"`
	NextRetry     string `json:"next_retry_after"`
	Quota         struct {
		ObservedAt string            `json:"observed_at"`
		Signals    map[string]string `json:"signals"`
	} `json:"quota"`
	IDToken struct {
		PlanType string `json:"plan_type"`
	} `json:"id_token"`
}

func parseAuthFiles(raw []byte) []authFileEntry {
	var wrapped struct {
		Files []authFileEntry `json:"files"`
	}
	if json.Unmarshal(raw, &wrapped) == nil && wrapped.Files != nil {
		return wrapped.Files
	}
	var list []authFileEntry
	_ = json.Unmarshal(raw, &list)
	return list
}

func parseTimeMs(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil || t.IsZero() || t.Year() < 2000 {
		return 0
	}
	return t.UnixMilli()
}

func clampPercent(v float64) float64 {
	if math.IsNaN(v) || v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return math.Round(v*10) / 10
}

func windowKey(minutes int, fallback string) string {
	switch {
	case minutes >= 290 && minutes <= 310:
		return "5h"
	case minutes >= 10000 && minutes <= 10160:
		return "week"
	case minutes > 0:
		return "other"
	}
	return fallback
}

// codexWindows reads x-codex-primary-* / x-codex-secondary-*.
func codexWindows(sig map[string]string, observedMs int64) []LimitWindow {
	var out []LimitWindow
	for _, w := range []struct{ name, fallback string }{{"primary", "5h"}, {"secondary", "week"}} {
		p := "x-codex-" + w.name + "-"
		usedRaw, ok := sig[p+"used-percent"]
		if !ok {
			continue
		}
		used, err := strconv.ParseFloat(usedRaw, 64)
		if err != nil {
			continue
		}
		minutes, _ := strconv.Atoi(sig[p+"window-minutes"])
		win := LimitWindow{Key: windowKey(minutes, w.fallback), Minutes: minutes, UsedPercent: clampPercent(used)}
		if win.Key == "other" {
			win.Label = minutesLabel(minutes)
		}
		if at, err := strconv.ParseInt(sig[p+"reset-at"], 10, 64); err == nil && at > 0 {
			win.ResetAt = at * 1000
		} else if after, err := strconv.ParseFloat(sig[p+"reset-after-seconds"], 64); err == nil && after >= 0 && observedMs > 0 {
			win.ResetAt = observedMs + int64(after*1000)
		}
		out = append(out, win)
	}
	return out
}

func minutesLabel(minutes int) string {
	switch {
	case minutes%1440 == 0:
		return strconv.Itoa(minutes/1440) + "d"
	case minutes%60 == 0:
		return strconv.Itoa(minutes/60) + "h"
	}
	return strconv.Itoa(minutes) + "m"
}

// claudeWindows reads anthropic-ratelimit-unified-<window>-utilization (a
// fraction of the window) and the matching -reset (unix seconds).
func claudeWindows(sig map[string]string) []LimitWindow {
	const prefix = "anthropic-ratelimit-unified-"
	const suffix = "-utilization"
	var out []LimitWindow
	for k, v := range sig {
		if !strings.HasPrefix(k, prefix) || !strings.HasSuffix(k, suffix) {
			continue
		}
		name := strings.TrimSuffix(strings.TrimPrefix(k, prefix), suffix)
		frac, err := strconv.ParseFloat(v, 64)
		if name == "" || err != nil {
			continue
		}
		win := LimitWindow{UsedPercent: clampPercent(frac * 100)}
		switch name {
		case "5h":
			win.Key, win.Minutes = "5h", 300
		case "7d":
			win.Key, win.Minutes = "week", 10080
		default:
			win.Key, win.Label = "other", strings.ReplaceAll(name, "_", " ")
		}
		if at, err := strconv.ParseInt(sig[prefix+name+"-reset"], 10, 64); err == nil && at > 0 {
			win.ResetAt = at * 1000
		}
		out = append(out, win)
	}
	return out
}

func sortWindows(ws []LimitWindow) {
	rank := func(w LimitWindow) int {
		switch w.Key {
		case "5h":
			return 0
		case "week":
			return 1
		}
		return 2
	}
	sort.SliceStable(ws, func(i, j int) bool {
		if ri, rj := rank(ws[i]), rank(ws[j]); ri != rj {
			return ri < rj
		}
		return ws[i].Label < ws[j].Label
	})
}

// buildAccountLimit normalizes one engine auth entry. now is injected for tests.
func buildAccountLimit(f authFileEntry, now time.Time) AccountLimit {
	prov := strings.ToLower(strings.TrimSpace(f.Provider))
	if prov == "" {
		prov = strings.ToLower(strings.TrimSpace(f.Type))
	}
	label := firstNonEmpty(f.Email, f.Account, f.Label, f.Name)
	acc := AccountLimit{
		ID: f.ID, AuthIndex: f.AuthIndex, Name: f.Name, Provider: prov, Label: label,
		Plan: strings.TrimSpace(f.IDToken.PlanType), Message: strings.TrimSpace(f.StatusMessage),
		Success: f.Success, Failed: f.Failed, Windows: []LimitWindow{},
	}
	sig := make(map[string]string, len(f.Quota.Signals))
	for k, v := range f.Quota.Signals {
		sig[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
	}
	acc.ObservedAt = parseTimeMs(f.Quota.ObservedAt)
	nowMs := now.UnixMilli()

	reached := false
	switch prov {
	case "codex":
		acc.Windows = append(acc.Windows, codexWindows(sig, acc.ObservedAt)...)
		if p := sig["x-codex-plan-type"]; p != "" {
			acc.Plan = p
		}
		reached = strings.EqualFold(sig["x-codex-limit-reached"], "true") || strings.EqualFold(sig["x-codex-allowed"], "false")
	case "claude":
		acc.Windows = append(acc.Windows, claudeWindows(sig)...)
		reached = strings.EqualFold(sig["anthropic-ratelimit-unified-status"], "rejected")
	}
	sortWindows(acc.Windows)
	acc.Percent = len(acc.Windows) > 0

	// A window that ended after the last answer has started again from zero.
	maxUsed := 0.0
	for i := range acc.Windows {
		w := &acc.Windows[i]
		if w.ResetAt > 0 && w.ResetAt <= nowMs {
			w.UsedPercent, w.ResetAt, w.Rolled = 0, 0, true
		}
		if w.UsedPercent > maxUsed {
			maxUsed = w.UsedPercent
		}
	}
	if retry := parseTimeMs(f.NextRetry); retry > nowMs {
		acc.RetryAt = retry
	}

	status := strings.ToLower(strings.TrimSpace(f.Status))
	blocked := f.Unavailable || status == "error" || status == "unavailable"
	switch {
	case f.Disabled || status == "disabled":
		acc.State = "disabled"
	case blocked && (acc.RetryAt > 0 || maxUsed >= 100 || (reached && maxUsed >= warnAt) || looksLikeLimit(acc.Message)):
		acc.State = "limited"
	case blocked:
		acc.State = "error"
	case maxUsed >= 100:
		acc.State = "limited"
	case maxUsed >= warnAt:
		acc.State = "warn"
	default:
		acc.State = "ok"
	}
	return acc
}

func looksLikeLimit(msg string) bool {
	m := strings.ToLower(msg)
	for _, s := range []string{"quota", "rate limit", "rate_limit", "usage limit", "usage_limit", "429", "too many requests", "exhausted"} {
		if strings.Contains(m, s) {
			return true
		}
	}
	return false
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v = strings.TrimSpace(v); v != "" {
			return v
		}
	}
	return ""
}

// ---- plugin quotas (Kiro, WorkBuddy…): asked from the plugin, cached ----

type pluginQuota struct {
	Subscription *struct {
		Plan     string `json:"plan"`
		TierName string `json:"tierName"`
	} `json:"subscription"`
	Summary []struct {
		Label    string  `json:"label"`
		Value    float64 `json:"value"`
		Unit     string  `json:"unit"`
		Currency string  `json:"currency"`
	} `json:"summary"`
	Groups []struct {
		DisplayName string `json:"displayName"`
		Buckets     []struct {
			Window            string   `json:"window"`
			RemainingFraction *float64 `json:"remainingFraction"`
			ResetTime         string   `json:"resetTime"`
			Description       string   `json:"description"`
		} `json:"buckets"`
	} `json:"groups"`
}

type quotaCacheEntry struct {
	at       time.Time
	quota    *pluginQuota // nil: the plugin had nothing or failed
	fetching bool
}

const (
	quotaCacheTTL  = 5 * time.Minute
	quotaCacheKeep = time.Hour
)

var (
	quotaCacheMu sync.Mutex
	quotaCache   = map[string]*quotaCacheEntry{}
)

// pluginQuotaFor returns the cached quota of a plugin account and, when it is
// missing or old, starts one background fetch. The page never waits for a plugin.
func (a *App) pluginQuotaFor(authIndex string, force bool) (q *pluginQuota, pending bool) {
	quotaCacheMu.Lock()
	defer quotaCacheMu.Unlock()
	now := time.Now()
	for k, e := range quotaCache {
		if !e.fetching && now.Sub(e.at) > quotaCacheKeep {
			delete(quotaCache, k)
		}
	}
	e := quotaCache[authIndex]
	if e == nil {
		e = &quotaCacheEntry{}
		quotaCache[authIndex] = e
	}
	stale := e.at.IsZero() || now.Sub(e.at) > quotaCacheTTL || force
	if stale && !e.fetching {
		e.fetching = true
		go a.fetchPluginQuota(authIndex)
	}
	return e.quota, e.fetching && e.at.IsZero()
}

func (a *App) fetchPluginQuota(authIndex string) {
	var parsed *pluginQuota
	body, _ := json.Marshal(map[string]string{"auth_index": authIndex})
	status, raw, _ := a.mgmtRequest(http.MethodPost, "/v0/management/quota/fetch", body)
	if status == http.StatusOK {
		var q pluginQuota
		if json.Unmarshal(raw, &q) == nil {
			parsed = &q
		}
	}
	quotaCacheMu.Lock()
	if e := quotaCache[authIndex]; e != nil {
		e.fetching = false
		e.at = time.Now()
		// A failed refresh keeps the last good answer instead of blanking the card.
		if parsed != nil || e.quota == nil {
			e.quota = parsed
		}
	}
	quotaCacheMu.Unlock()
}

func applyPluginQuota(acc *AccountLimit, q *pluginQuota, now time.Time) {
	if q == nil {
		return
	}
	if q.Subscription != nil && acc.Plan == "" {
		acc.Plan = firstNonEmpty(q.Subscription.Plan, q.Subscription.TierName)
	}
	for _, m := range q.Summary {
		if strings.TrimSpace(m.Label) == "" {
			continue
		}
		acc.Metrics = append(acc.Metrics, LimitMetric{Label: m.Label, Value: m.Value, Unit: m.Unit, Currency: m.Currency})
	}
	nowMs := now.UnixMilli()
	maxUsed := 0.0
	for _, g := range q.Groups {
		for _, b := range g.Buckets {
			if b.RemainingFraction == nil {
				continue
			}
			label := firstNonEmpty(b.Window, b.Description)
			if g.DisplayName != "" && len(q.Groups) > 1 {
				label = strings.TrimSpace(g.DisplayName + " · " + label)
			}
			win := LimitWindow{Key: "other", Label: label, UsedPercent: clampPercent((1 - *b.RemainingFraction) * 100)}
			if at := parseTimeMs(b.ResetTime); at > nowMs {
				win.ResetAt = at
			}
			acc.Windows = append(acc.Windows, win)
			if win.UsedPercent > maxUsed {
				maxUsed = win.UsedPercent
			}
		}
	}
	if len(acc.Windows) > 0 {
		acc.Percent = true
	}
	switch acc.State {
	case "ok", "warn":
		if maxUsed >= 100 {
			acc.State = "limited"
		} else if maxUsed >= warnAt {
			acc.State = "warn"
		}
	case "error":
		if maxUsed >= 100 {
			acc.State = "limited"
		}
	}
}

// apiLimits: GET /api/limits[?refresh=1]
func (a *App) apiLimits(w http.ResponseWriter, r *http.Request) {
	if a.Paused() || !a.EngineRunning() {
		jsonWrite(w, http.StatusOK, anyMap{"ok": true, "running": false, "accounts": []AccountLimit{}, "summary": limitSummary(nil)})
		return
	}
	status, raw, _ := a.mgmtRequest(http.MethodGet, "/v0/management/auth-files", nil)
	if status != http.StatusOK {
		jsonWrite(w, http.StatusBadGateway, anyMap{"ok": false, "error": "engine did not return accounts"})
		return
	}
	force := r.URL.Query().Get("refresh") == "1"
	now := time.Now()
	files := parseAuthFiles(raw)
	accounts := make([]AccountLimit, 0, len(files))
	for _, f := range files {
		acc := buildAccountLimit(f, now)
		if f.SupportsQuota && acc.AuthIndex != "" && acc.State != "disabled" {
			q, pending := a.pluginQuotaFor(acc.AuthIndex, force)
			applyPluginQuota(&acc, q, now)
			acc.Pending = pending
		}
		accounts = append(accounts, acc)
	}
	sort.SliceStable(accounts, func(i, j int) bool {
		if accounts[i].Provider != accounts[j].Provider {
			return accounts[i].Provider < accounts[j].Provider
		}
		return accounts[i].Label < accounts[j].Label
	})
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "running": true, "now": now.UnixMilli(), "accounts": accounts, "summary": limitSummary(accounts)})
}

func limitSummary(accounts []AccountLimit) anyMap {
	s := map[string]int{"ok": 0, "warn": 0, "limited": 0, "error": 0, "disabled": 0}
	for _, a := range accounts {
		s[a.State]++
	}
	return anyMap{"total": len(accounts), "ok": s["ok"], "warn": s["warn"], "limited": s["limited"], "error": s["error"], "disabled": s["disabled"]}
}
