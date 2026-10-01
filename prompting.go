package main

import (
	"strconv"
	"strings"

	"cartelgate/internal/config"
	"cartelgate/internal/web"
)

// API families CarteLink rewrites. They differ in where the system prompt and
// the reasoning settings live inside the request body.
const (
	apiAnthropic = "anthropic" // POST /v1/messages        → "system", "thinking"
	apiChat      = "chat"      // POST /v1/chat|completions → system message, "reasoning_effort"
	apiResponses = "responses" // POST /v1/responses        → "instructions", "reasoning"
)

// apiFamily maps a request path onto one of the families above ("" = neither).
func apiFamily(path string) string {
	switch path {
	case "/v1/messages":
		return apiAnthropic
	case "/v1/chat/completions", "/v1/completions":
		return apiChat
	case "/v1/responses":
		return apiResponses
	}
	return ""
}

// promptText is the text to inject: the system prompt plus the AGENT.md file
// when one is enabled.
func promptText(p *config.Prompting) string {
	parts := make([]string, 0, 2)
	if t := strings.TrimSpace(p.Text); t != "" {
		parts = append(parts, t)
	}
	if p.AgentMDEnabled {
		if t := strings.TrimSpace(p.AgentMD); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, "\n\n")
}

// promptApplies reports whether the configured scope covers this API family.
func promptApplies(p *config.Prompting, api string) bool {
	switch p.Scope {
	case "anthropic":
		return api == apiAnthropic
	case "openai":
		return api == apiChat || api == apiResponses
	}
	return true
}

// applyPrompting injects the configured system prompt into a request body.
// Returns true when the payload changed.
func applyPrompting(cfg *config.Config, payload map[string]any, api string) bool {
	p := &cfg.Prompting
	if !p.Enabled || api == "" || !promptApplies(p, api) {
		return false
	}
	text := promptText(p)
	if text == "" {
		return false
	}
	switch api {
	case apiAnthropic:
		return injectAnthropicSystem(payload, text, p.Mode)
	case apiChat:
		return injectChatSystem(payload, text, p.Mode)
	case apiResponses:
		return injectInstructions(payload, text, p.Mode)
	}
	return false
}

// joinPrompt combines the client's own prompt with ours according to mode.
func joinPrompt(existing, injected, mode string) string {
	existing = strings.TrimSpace(existing)
	switch {
	case mode == "replace" || existing == "":
		return injected
	case mode == "append":
		return existing + "\n\n" + injected
	default:
		return injected + "\n\n" + existing
	}
}

// injectAnthropicSystem handles the Anthropic "system" field, which is either
// a string or a list of content blocks.
func injectAnthropicSystem(payload map[string]any, text, mode string) bool {
	block := func() map[string]any { return map[string]any{"type": "text", "text": text} }
	switch cur := payload["system"].(type) {
	case string:
		payload["system"] = joinPrompt(cur, text, mode)
	case []any:
		if mode == "replace" {
			payload["system"] = []any{block()}
		} else if mode == "append" {
			payload["system"] = append(append([]any{}, cur...), block())
		} else {
			payload["system"] = append([]any{block()}, cur...)
		}
	default:
		payload["system"] = text
	}
	return true
}

// injectChatSystem handles OpenAI chat "messages": the first system (or
// developer) message is extended, or a new one is put in front.
func injectChatSystem(payload map[string]any, text, mode string) bool {
	msgs, _ := payload["messages"].([]any)
	isSystem := func(m any) bool {
		mm, ok := m.(map[string]any)
		if !ok {
			return false
		}
		role, _ := mm["role"].(string)
		return role == "system" || role == "developer"
	}
	if mode == "replace" {
		kept := make([]any, 0, len(msgs))
		for _, m := range msgs {
			if !isSystem(m) {
				kept = append(kept, m)
			}
		}
		payload["messages"] = append([]any{map[string]any{"role": "system", "content": text}}, kept...)
		return true
	}
	for _, m := range msgs {
		mm, ok := m.(map[string]any)
		if !ok || !isSystem(m) {
			continue
		}
		switch cur := mm["content"].(type) {
		case string:
			mm["content"] = joinPrompt(cur, text, mode)
			return true
		case []any:
			blk := map[string]any{"type": "text", "text": text}
			if mode == "append" {
				mm["content"] = append(append([]any{}, cur...), blk)
			} else {
				mm["content"] = append([]any{blk}, cur...)
			}
			return true
		}
	}
	payload["messages"] = append([]any{map[string]any{"role": "system", "content": text}}, msgs...)
	return true
}

// injectInstructions handles the Responses API "instructions" field. Codex
// keeps its real system prompt ("You are Codex, …", permissions, app context)
// in developer messages inside "input", so "replace" removes those too —
// otherwise the program's own identity would still follow ours.
func injectInstructions(payload map[string]any, text, mode string) bool {
	cur, _ := payload["instructions"].(string)
	payload["instructions"] = joinPrompt(cur, text, mode)
	if mode != "replace" {
		return true
	}
	items, ok := payload["input"].([]any)
	if !ok {
		return true
	}
	kept := make([]any, 0, len(items))
	for _, it := range items {
		if m, ok := it.(map[string]any); ok {
			typ, _ := m["type"].(string)
			role, _ := m["role"].(string)
			if (typ == "" || typ == "message") && (role == "developer" || role == "system") {
				continue
			}
		}
		kept = append(kept, it)
	}
	payload["input"] = kept
	return true
}

// applyThinking asks a model to think harder or less. It uses the engine's
// own thinking layer: a suffix on the model name — "model(high)",
// "model(16384)", "model(none)", "model(auto)" — which the engine validates
// against the model's catalogue entry and converts to whatever that provider
// expects (a token budget for Gemini and older Claude, adaptive levels for
// Claude 5.5, reasoning effort for Codex/OpenAI). It is sent only to models
// the catalogue marks as thinking-capable, and the app's own reasoning
// settings win unless Override is on. Returns true when the payload changed.
func applyThinking(cfg *config.Config, payload map[string]any, api string, caps web.ModelCaps) bool {
	th := &cfg.Prompting.Thinking
	// Independent of the system-prompt switch: the thinking card has its own.
	if !th.Enabled || api == "" || !caps.Thinking {
		return false
	}
	model, _ := payload["model"].(string)
	if model == "" {
		return false
	}
	hasSuffix := strings.HasSuffix(model, ")") && strings.LastIndex(model, "(") > 0
	if !th.Override && (hasSuffix || clientSetsThinking(payload, api)) {
		return false
	}
	suffix := thinkingSuffix(th, caps)
	if suffix == "" {
		return false
	}
	if hasSuffix {
		model = model[:strings.LastIndex(model, "(")]
	}
	payload["model"] = model + "(" + suffix + ")"
	return true
}

// thinkingSuffix picks the value for the model-name suffix, or "" when the
// setting cannot be expressed for this model.
func thinkingSuffix(th *config.Thinking, caps web.ModelCaps) string {
	if th.Budget > 0 && caps.Max > 0 {
		b := th.Budget
		if b > caps.Max {
			b = caps.Max
		}
		if caps.Min > 0 && b < caps.Min {
			b = caps.Min
		}
		return strconv.Itoa(b)
	}
	level := th.Level
	switch level {
	case "off":
		if caps.ZeroAllowed || hasLevel(caps.Levels, "none") {
			return "none"
		}
		if hasLevel(caps.Levels, "minimal") {
			return "minimal"
		}
		if hasLevel(caps.Levels, "low") {
			return "low"
		}
		return ""
	case "dynamic":
		if caps.DynamicAllowed {
			return "auto"
		}
		level = "high"
	}
	if len(caps.Levels) == 0 || hasLevel(caps.Levels, level) {
		return level
	}
	// Level-based model without this exact level: nearest one it has.
	return nearestLevel(caps.Levels, level)
}

// effortOrder ranks reasoning levels, weakest first. The engine's thinking
// layer knows the first engineLevels of them; "ultra" (Codex Desktop 0.159+)
// is ranked only so it can be mapped down to something the engine accepts.
var effortOrder = []string{"minimal", "low", "medium", "high", "xhigh", "max", "ultra"}

const engineLevels = 6 // minimal … max

// nearestLevel picks the entry of levels closest to level in effortOrder (a
// tie goes to the lower one), or "" when either side cannot be ranked.
func nearestLevel(levels []string, level string) string {
	want := indexOf(effortOrder, strings.TrimSpace(level))
	if want < 0 {
		return ""
	}
	best, bestIdx, bestDist := "", -1, len(effortOrder)
	for _, l := range levels {
		i := indexOf(effortOrder, strings.TrimSpace(l))
		if i < 0 {
			continue
		}
		d := i - want
		if d < 0 {
			d = -d
		}
		if d < bestDist || (d == bestDist && i < bestIdx) {
			best, bestIdx, bestDist = l, i, d
		}
	}
	return best
}

// normalizeEffort maps a reasoning level sent by the client onto one the
// target model takes. The engine rejects a level it does not know ("ultra"
// from Codex Desktop) even when routing sends the request to another family,
// and a same-family request with a level missing from the model's list
// ("xhigh" to a model that stops at "high"). It runs on every request,
// independent of the thinking switch. Responses requests to models the
// engine serves natively (caps.ConfigUpdate) keep their body as sent: the
// engine forwards it unchecked and upstream takes "ultra" there. Returns
// true when the payload changed.
func normalizeEffort(payload map[string]any, api string, caps web.ModelCaps) bool {
	changed := false
	fix := func(obj map[string]any, key string) {
		v, ok := obj[key].(string)
		if !ok {
			return
		}
		if nv := effortFor(v, caps); nv != v {
			obj[key] = nv
			changed = true
		}
	}
	sub := func(obj map[string]any, key string) map[string]any {
		m, _ := obj[key].(map[string]any)
		return m
	}
	switch api {
	case apiResponses:
		if caps.ConfigUpdate {
			break // a suffix turns the native path off: it is still fixed below
		}
		fix(sub(payload, "reasoning"), "effort")
		// In-turn "configuration_update" items carry an effort too, and the
		// engine reads the last of them before the top-level one.
		items, _ := payload["input"].([]any)
		for _, it := range items {
			if m, ok := it.(map[string]any); ok && m["type"] == "configuration_update" {
				fix(sub(m, "reasoning"), "effort")
			}
		}
	case apiChat:
		fix(payload, "reasoning_effort")
		fix(sub(payload, "reasoning"), "effort")
	case apiAnthropic:
		fix(sub(payload, "output_config"), "effort")
	}
	// The "model(level)" suffix form.
	if model, ok := payload["model"].(string); ok && strings.HasSuffix(model, ")") {
		if i := strings.LastIndex(model, "("); i > 0 {
			raw := model[i+1 : len(model)-1]
			if nv := effortFor(raw, caps); nv != raw {
				payload["model"] = model[:i+1] + nv + ")"
				changed = true
			}
		}
	}
	return changed
}

// effortFor returns the level to send instead of v — v itself when it is
// empty, none/auto, a number, an unknown word or a level the model has.
func effortFor(v string, caps web.ModelCaps) string {
	want := indexOf(effortOrder, strings.TrimSpace(v))
	if want < 0 || hasLevel(caps.Levels, strings.TrimSpace(v)) {
		return v
	}
	if len(caps.Levels) == 0 {
		// Budget-based or unknown model: the engine converts any level it
		// knows into a budget itself; above that, its strongest one.
		if want < engineLevels {
			return v
		}
		return effortOrder[engineLevels-1]
	}
	if best := nearestLevel(caps.Levels, v); best != "" {
		return best
	}
	return v
}

// clientSetsThinking reports whether the request already carries its own
// reasoning settings (then they win unless Override is on).
func clientSetsThinking(payload map[string]any, api string) bool {
	switch api {
	case apiAnthropic:
		if _, ok := payload["thinking"]; ok {
			return true
		}
		if oc, ok := payload["output_config"].(map[string]any); ok {
			if _, ok := oc["effort"]; ok {
				return true
			}
		}
	case apiChat:
		if _, ok := payload["reasoning_effort"]; ok {
			return true
		}
		if _, ok := payload["reasoning"]; ok {
			return true
		}
	case apiResponses:
		if _, ok := payload["reasoning"]; ok {
			return true
		}
	}
	return false
}

func hasLevel(levels []string, l string) bool { return indexOf(levels, l) >= 0 }

func indexOf(list []string, v string) int {
	for i, x := range list {
		if strings.EqualFold(x, v) {
			return i
		}
	}
	return -1
}
