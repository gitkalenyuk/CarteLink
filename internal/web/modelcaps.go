package web

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	sdkcliproxy "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy"
)

// ModelCaps is what CarteLink needs to know about a model before it may add
// reasoning settings to a request: whether the model takes a thinking budget
// (Anthropic/Gemini style), its allowed range, and whether it takes an
// OpenAI-style reasoning effort.
type ModelCaps struct {
	Thinking       bool `json:"thinking"`
	Min            int  `json:"min,omitempty"`
	Max            int  `json:"max,omitempty"`
	ZeroAllowed    bool `json:"zeroAllowed,omitempty"`
	DynamicAllowed bool `json:"dynamicAllowed,omitempty"`
	// Levels are the discrete reasoning levels of level-based models
	// (Claude Opus/Sonnet 5.5, Codex …) — they take no token budget.
	Levels []string `json:"levels,omitempty"`
	Effort bool     `json:"effort"`
	Type   string   `json:"type,omitempty"`
	// Context is the model's context window in tokens and MaxOutput its
	// output limit (0 = unknown). When several accounts serve the same id
	// the smallest window wins: a request may land on any of them.
	Context   int `json:"context,omitempty"`
	MaxOutput int `json:"maxOutput,omitempty"`
	// ConfigUpdate marks models the engine serves Responses requests to
	// natively (Codex configuration_update, gpt-6-*): it forwards their
	// reasoning effort unchecked, and upstream takes levels missing from
	// Levels ("ultra").
	ConfigUpdate bool `json:"configUpdate,omitempty"`
}

// knownProviders are the engine provider keys whose catalogues are scanned for
// capabilities. Providers that arrive later (plugins) are picked up from the
// connected accounts, see refreshModelCaps.
var knownProviders = []string{
	"antigravity", "claude", "codex", "gemini", "aistudio", "vertex",
	"kimi", "xai", "meta", "devin", "kiro", "mirasim", "gemini-cli", "openai-compatibility",
}

var (
	capsMu   sync.Mutex
	capsData map[string]ModelCaps
	capsAt   time.Time
)

// effortParams mark an OpenAI-style reasoning control in a model's parameter list.
var effortParams = map[string]bool{"reasoning_effort": true, "reasoning": true, "effort": true}

// ModelCapabilities returns the capability map (model id → caps), refreshed at
// most once a minute. The engine builds this catalogue from models.json, so
// new models are picked up without a CarteLink rebuild.
func (a *App) ModelCapabilities() map[string]ModelCaps {
	capsMu.Lock()
	defer capsMu.Unlock()
	if capsData != nil && time.Since(capsAt) < time.Minute {
		return capsData
	}
	out := make(map[string]ModelCaps, 128)
	reg := sdkcliproxy.GlobalModelRegistry()
	if reg == nil {
		capsData, capsAt = out, time.Now()
		return out
	}
	providers := append([]string(nil), knownProviders...)
	for _, p := range a.accountProviders() {
		providers = append(providers, p)
	}
	seenProv := map[string]bool{}
	for _, prov := range providers {
		prov = strings.ToLower(strings.TrimSpace(prov))
		if prov == "" || seenProv[prov] {
			continue
		}
		seenProv[prov] = true
		for _, m := range reg.GetAvailableModelsByProvider(prov) {
			if m == nil || strings.TrimSpace(m.ID) == "" {
				continue
			}
			c := ModelCaps{Type: m.Type, ConfigUpdate: m.SupportConfigurationUpdate}
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
			key := strings.ToLower(uncloak(m.ID))
			if prev, ok := out[key]; ok {
				c = mergeCaps(prev, c)
			}
			out[key] = c
		}
	}
	capsData, capsAt = out, time.Now()
	return out
}

// mergeCaps combines two catalogue entries with the same id (several
// providers serve it): the entry with reasoning controls wins, limits take
// the smaller value.
func mergeCaps(prev, c ModelCaps) ModelCaps {
	c.Context = minPositive(prev.Context, c.Context)
	c.MaxOutput = minPositive(prev.MaxOutput, c.MaxOutput)
	if !(prev.Thinking || prev.Effort) {
		return c
	}
	if !(c.Thinking || c.Effort) {
		prev.Context, prev.MaxOutput = c.Context, c.MaxOutput
		return prev
	}
	// The effort goes out unchecked only if every provider forwards it
	// natively: a request may land on any of them.
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

// minPositive is the smaller of two limits, ignoring unknown (0) ones.
func minPositive(a, b int) int {
	switch {
	case a <= 0:
		return b
	case b <= 0 || a < b:
		return a
	}
	return b
}

// accountProviders lists the provider keys of the connected accounts.
func (a *App) accountProviders() []string {
	status, raw, _ := a.mgmtRequest(http.MethodGet, "/v0/management/auth-files", nil)
	if status != http.StatusOK {
		return nil
	}
	var body struct {
		Files []struct {
			Provider string `json:"provider"`
			Type     string `json:"type"`
		} `json:"files"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return nil
	}
	out := make([]string, 0, len(body.Files))
	for _, f := range body.Files {
		if p := f.Provider; p != "" {
			out = append(out, p)
		} else if f.Type != "" {
			out = append(out, f.Type)
		}
	}
	return out
}

// CapsFor returns the capabilities of one model ("" → zero value).
func (a *App) CapsFor(model string) ModelCaps {
	if model == "" {
		return ModelCaps{}
	}
	caps := a.ModelCapabilities()
	key := strings.ToLower(strings.TrimSpace(uncloak(model)))
	if c, ok := caps[key]; ok {
		return c
	}
	// Provider-prefixed ("openrouter/claude-…") and suffixed ("…-high",
	// "…(high)") ids fall back to their base name.
	if i := strings.LastIndex(key, "/"); i >= 0 {
		if c, ok := caps[key[i+1:]]; ok {
			return c
		}
	}
	if i := strings.Index(key, "("); i > 0 {
		if c, ok := caps[strings.TrimSpace(key[:i])]; ok {
			return c
		}
	}
	return ModelCaps{}
}

// apiModelContext: GET /api/model-context?model=… — the context window of the
// model a client name ends up on (for the "Connect a program" snippets).
func (a *App) apiModelContext(w http.ResponseWriter, r *http.Request) {
	model := strings.TrimSpace(r.URL.Query().Get("model"))
	resolved := a.ResolveModel(model)
	if resolved == "" {
		resolved = model
	}
	c := a.CapsFor(resolved)
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "model": model, "resolved": resolved,
		"context": c.Context, "maxOutput": c.MaxOutput})
}

// apiModelInfo: GET /api/model-info — capabilities of every known model, so
// the UI can show reasoning controls only where they work.
func (a *App) apiModelInfo(w http.ResponseWriter, r *http.Request) {
	jsonWrite(w, http.StatusOK, anyMap{"ok": true, "models": a.ModelCapabilities()})
}
