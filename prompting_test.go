package main

import (
	"encoding/json"
	"testing"

	"cartelgate/internal/config"
	"cartelgate/internal/web"
)

func promptCfg() *config.Config {
	c := config.Defaults()
	c.Prompting.Enabled = true
	c.Prompting.Text = "Ти — CarteLink."
	c.Prompting.Mode = "prepend"
	c.Prompting.Scope = "all"
	return c
}

func decode(t *testing.T, raw string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestApplyPromptingAnthropic(t *testing.T) {
	cfg := promptCfg()
	cfg.Prompting.AgentMDEnabled = true
	cfg.Prompting.AgentMD = "# AGENT.md\nПравила."

	// string system
	p := decode(t, `{"system":"Ти Codex.","messages":[]}`)
	if !applyPrompting(cfg, p, apiAnthropic) {
		t.Fatal("no change")
	}
	if got := p["system"].(string); got != "Ти — CarteLink.\n\n# AGENT.md\nПравила.\n\nТи Codex." {
		t.Fatalf("prepend = %q", got)
	}

	// block list system, append mode
	cfg.Prompting.Mode = "append"
	p = decode(t, `{"system":[{"type":"text","text":"A"}]}`)
	applyPrompting(cfg, p, apiAnthropic)
	blocks := p["system"].([]any)
	if len(blocks) != 2 || blocks[1].(map[string]any)["text"] == "A" {
		t.Fatalf("append blocks = %v", blocks)
	}

	// replace drops the client's prompt
	cfg.Prompting.Mode = "replace"
	p = decode(t, `{"system":"Ти Codex."}`)
	applyPrompting(cfg, p, apiAnthropic)
	if got := p["system"].(string); got == "Ти Codex." || len(got) == 0 {
		t.Fatalf("replace = %q", got)
	}

	// missing system field
	p = decode(t, `{}`)
	applyPrompting(cfg, p, apiAnthropic)
	if _, ok := p["system"].(string); !ok {
		t.Fatalf("system not added: %v", p)
	}
}

func TestApplyPromptingOpenAI(t *testing.T) {
	cfg := promptCfg()

	// existing system message is extended
	p := decode(t, `{"messages":[{"role":"system","content":"S"},{"role":"user","content":"hi"}]}`)
	applyPrompting(cfg, p, apiChat)
	msgs := p["messages"].([]any)
	if len(msgs) != 2 || msgs[0].(map[string]any)["content"] != "Ти — CarteLink.\n\nS" {
		t.Fatalf("messages = %v", msgs)
	}

	// no system message → one is put in front
	p = decode(t, `{"messages":[{"role":"user","content":"hi"}]}`)
	applyPrompting(cfg, p, apiChat)
	msgs = p["messages"].([]any)
	if len(msgs) != 2 || msgs[0].(map[string]any)["role"] != "system" {
		t.Fatalf("messages = %v", msgs)
	}

	// replace removes developer/system messages
	cfg.Prompting.Mode = "replace"
	p = decode(t, `{"messages":[{"role":"developer","content":"D"},{"role":"user","content":"hi"}]}`)
	applyPrompting(cfg, p, apiChat)
	msgs = p["messages"].([]any)
	if len(msgs) != 2 || msgs[0].(map[string]any)["content"] != "Ти — CarteLink." || msgs[1].(map[string]any)["role"] != "user" {
		t.Fatalf("replace messages = %v", msgs)
	}

	// responses API
	cfg.Prompting.Mode = "prepend"
	p = decode(t, `{"instructions":"I","input":"hi"}`)
	applyPrompting(cfg, p, apiResponses)
	if p["instructions"] != "Ти — CarteLink.\n\nI" {
		t.Fatalf("instructions = %v", p["instructions"])
	}
}

func TestPromptingScopeAndDisabled(t *testing.T) {
	cfg := promptCfg()
	cfg.Prompting.Scope = "anthropic"
	p := decode(t, `{"messages":[]}`)
	if applyPrompting(cfg, p, apiChat) {
		t.Fatal("openai request touched while scope=anthropic")
	}
	cfg.Prompting.Enabled = false
	cfg.Prompting.Scope = "all"
	p = decode(t, `{"system":"S"}`)
	if applyPrompting(cfg, p, apiAnthropic) {
		t.Fatal("applied while disabled")
	}
}

func TestApplyThinkingSuffix(t *testing.T) {
	cfg := promptCfg()
	cfg.Prompting.Thinking = config.Thinking{Enabled: true, Level: "high"}
	budgetModel := web.ModelCaps{Thinking: true, Min: 1024, Max: 128000, ZeroAllowed: true}
	levelModel := web.ModelCaps{Thinking: true, ZeroAllowed: true, DynamicAllowed: true, Levels: []string{"low", "medium", "high", "xhigh", "max"}}

	cases := []struct {
		name  string
		level string
		caps  web.ModelCaps
		in    string
		want  string
	}{
		{"budget model, level", "high", budgetModel, "claude-opus-4-8", "claude-opus-4-8(high)"},
		{"level model, level", "max", levelModel, "claude-opus-5-5", "claude-opus-5-5(max)"},
		{"off with zero allowed", "off", levelModel, "claude-opus-5-5", "claude-opus-5-5(none)"},
		{"dynamic allowed", "dynamic", levelModel, "claude-sonnet-5-5", "claude-sonnet-5-5(auto)"},
		{"dynamic not allowed → high", "dynamic", budgetModel, "claude-opus-4-8", "claude-opus-4-8(high)"},
		{"nearest level", "medium", web.ModelCaps{Thinking: true, Levels: []string{"low", "high"}}, "codex-x", "codex-x(low)"},
	}
	for _, c := range cases {
		cfg.Prompting.Thinking.Level = c.level
		p := map[string]any{"model": c.in}
		if !applyThinking(cfg, p, apiAnthropic, c.caps) || p["model"] != c.want {
			t.Errorf("%s: model = %v, want %s", c.name, p["model"], c.want)
		}
	}

	// explicit budget, clamped to the model's range
	cfg.Prompting.Thinking = config.Thinking{Enabled: true, Level: "high", Budget: 500000}
	p := map[string]any{"model": "claude-opus-4-8"}
	applyThinking(cfg, p, apiAnthropic, budgetModel)
	if p["model"] != "claude-opus-4-8(128000)" {
		t.Fatalf("budget suffix = %v", p["model"])
	}

	// unsupported model: untouched
	p = map[string]any{"model": "gpt-oss-120b-medium"}
	if applyThinking(cfg, p, apiChat, web.ModelCaps{}) {
		t.Fatalf("suffix added to a model without thinking: %v", p)
	}

	// the app's own settings win unless Override
	cfg.Prompting.Thinking = config.Thinking{Enabled: true, Level: "high"}
	for api, body := range map[string]map[string]any{
		apiAnthropic: {"model": "m", "thinking": map[string]any{"type": "enabled"}},
		apiChat:      {"model": "m", "reasoning_effort": "low"},
		apiResponses: {"model": "m", "reasoning": map[string]any{"effort": "low"}},
	} {
		if applyThinking(cfg, body, api, budgetModel) {
			t.Errorf("%s: overrode the app's own reasoning setting", api)
		}
	}
	p = map[string]any{"model": "m(low)"}
	if applyThinking(cfg, p, apiChat, budgetModel) {
		t.Fatal("replaced an existing suffix without Override")
	}
	cfg.Prompting.Thinking.Override = true
	applyThinking(cfg, p, apiChat, budgetModel)
	if p["model"] != "m(high)" {
		t.Fatalf("override suffix = %v", p["model"])
	}

	// works without the system prompt, stops when its own switch is off
	cfg.Prompting.Enabled = false
	cfg.Prompting.Thinking.Override = false
	p = map[string]any{"model": "m"}
	if !applyThinking(cfg, p, apiChat, budgetModel) {
		t.Fatal("thinking needs the system prompt switch")
	}
	cfg.Prompting.Thinking.Enabled = false
	p = map[string]any{"model": "m"}
	if applyThinking(cfg, p, apiChat, budgetModel) {
		t.Fatal("applied while its switch is off")
	}
}

func TestAPIFamily(t *testing.T) {
	cases := map[string]string{
		"/v1/messages":              apiAnthropic,
		"/v1/chat/completions":      apiChat,
		"/v1/completions":           apiChat,
		"/v1/responses":             apiResponses,
		"/v1/messages/count_tokens": "",
		"/v1/models":                "",
	}
	for path, want := range cases {
		if got := apiFamily(path); got != want {
			t.Errorf("apiFamily(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestReplaceDropsCodexDeveloperMessages(t *testing.T) {
	cfg := promptCfg()
	cfg.Prompting.Mode = "replace"
	payload := map[string]any{
		"instructions": "",
		"input": []any{
			map[string]any{"type": "message", "role": "developer", "content": "You are Codex, an agent based on GPT-6."},
			map[string]any{"role": "system", "content": "app context"},
			map[string]any{"type": "message", "role": "user", "content": "hi"},
			map[string]any{"type": "function_call_output", "call_id": "c1", "output": "ok"},
		},
	}
	if !applyPrompting(cfg, payload, apiResponses) {
		t.Fatal("not applied")
	}
	items := payload["input"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["role"] != "user" {
		t.Fatalf("input after replace: %+v", items)
	}
	if payload["instructions"] != promptText(&cfg.Prompting) {
		t.Fatalf("instructions = %v", payload["instructions"])
	}

	// prepend keeps the program's developer messages
	cfg.Prompting.Mode = "prepend"
	payload = map[string]any{"input": []any{map[string]any{"type": "message", "role": "developer", "content": "x"}}}
	applyPrompting(cfg, payload, apiResponses)
	if len(payload["input"].([]any)) != 1 {
		t.Fatal("prepend removed a developer message")
	}
}

func TestNormalizeEffort(t *testing.T) {
	codex := web.ModelCaps{Thinking: true, Effort: true, Levels: []string{"low", "medium", "high"}}
	claude := web.ModelCaps{Thinking: true, Levels: []string{"low", "medium", "high", "xhigh", "max"}}
	withUltra := web.ModelCaps{Thinking: true, Levels: []string{"low", "high", "ultra"}}
	budget := web.ModelCaps{Thinking: true, Min: 128, Max: 32768}

	cases := []struct {
		name string
		caps web.ModelCaps
		in   string
		want string
	}{
		{"ultra → high", codex, "ultra", "high"},
		{"ultra → max", claude, "ultra", "max"},
		{"ultra kept when supported", withUltra, "ultra", "ultra"},
		{"xhigh → high", codex, "xhigh", "high"},
		{"minimal → low", codex, "minimal", "low"},
		{"case-insensitive match kept", codex, "HIGH", "HIGH"},
		{"supported kept", codex, "medium", "medium"},
		{"tie → lower", withUltra, "medium", "low"},
		{"no levels: ultra → max", budget, "ultra", "max"},
		{"no levels: high kept", budget, "high", "high"},
		{"no levels: xhigh kept", budget, "xhigh", "xhigh"},
		{"unknown model: ultra → max", web.ModelCaps{}, "ultra", "max"},
		{"none kept", codex, "none", "none"},
		{"auto kept", codex, "auto", "auto"},
		{"empty kept", codex, "", ""},
		{"numeric kept", codex, "8192", "8192"},
		{"unknown word kept", codex, "extreme", "extreme"},
	}
	for _, c := range cases {
		changed := c.in != c.want

		p := map[string]any{"model": "m", "reasoning": map[string]any{"effort": c.in, "summary": "auto"}}
		if got := normalizeEffort(p, apiResponses, c.caps); got != changed {
			t.Errorf("%s: responses changed = %v", c.name, got)
		}
		r := p["reasoning"].(map[string]any)
		if r["effort"] != c.want || r["summary"] != "auto" {
			t.Errorf("%s: responses reasoning = %v, want effort %q", c.name, r, c.want)
		}

		p = map[string]any{"model": "m", "reasoning_effort": c.in}
		if got := normalizeEffort(p, apiChat, c.caps); got != changed || p["reasoning_effort"] != c.want {
			t.Errorf("%s: chat reasoning_effort = %v (changed %v), want %q", c.name, p["reasoning_effort"], got, c.want)
		}
		p = map[string]any{"model": "m", "reasoning": map[string]any{"effort": c.in}}
		if got := normalizeEffort(p, apiChat, c.caps); got != changed || p["reasoning"].(map[string]any)["effort"] != c.want {
			t.Errorf("%s: chat reasoning.effort = %v (changed %v), want %q", c.name, p["reasoning"], got, c.want)
		}

		p = map[string]any{"model": "m", "thinking": map[string]any{"type": "adaptive"}, "output_config": map[string]any{"effort": c.in}}
		if got := normalizeEffort(p, apiAnthropic, c.caps); got != changed || p["output_config"].(map[string]any)["effort"] != c.want {
			t.Errorf("%s: anthropic output_config = %v (changed %v), want %q", c.name, p["output_config"], got, c.want)
		}

		if c.in == "" {
			continue // "m()" is not a suffix the engine parses
		}
		p = map[string]any{"model": "gpt-6-codex(" + c.in + ")"}
		if got := normalizeEffort(p, apiChat, c.caps); got != changed || p["model"] != "gpt-6-codex("+c.want+")" {
			t.Errorf("%s: suffix model = %v (changed %v), want %q", c.name, p["model"], got, c.want)
		}
	}
}

func TestNormalizeEffortShapes(t *testing.T) {
	codex := web.ModelCaps{Thinking: true, Levels: []string{"low", "medium", "high"}}

	// Codex in-turn configuration updates are fixed too.
	p := decode(t, `{"model":"m","reasoning":{"effort":"ultra"},"input":[
		{"type":"message","role":"user","content":"hi"},
		{"type":"configuration_update","reasoning":{"effort":"ultra"}}]}`)
	if !normalizeEffort(p, apiResponses, codex) {
		t.Fatal("no change")
	}
	upd := p["input"].([]any)[1].(map[string]any)["reasoning"].(map[string]any)
	if upd["effort"] != "high" || p["reasoning"].(map[string]any)["effort"] != "high" {
		t.Fatalf("configuration_update not normalized: %v", p)
	}

	// Nothing to fix: no reasoning fields, a non-string effort, fields of
	// another API family, no suffix.
	for api, raw := range map[string]string{
		apiResponses: `{"model":"m","reasoning_effort":"ultra","input":"hi"}`,
		apiChat:      `{"model":"m","reasoning_effort":3,"output_config":{"effort":"ultra"}}`,
		apiAnthropic: `{"model":"m","thinking":{"type":"enabled","budget_tokens":2048},"reasoning_effort":"ultra"}`,
	} {
		if normalizeEffort(decode(t, raw), api, codex) {
			t.Errorf("%s: changed %s", api, raw)
		}
	}
	if normalizeEffort(map[string]any{"model": "gemini-3.8-flash-high"}, apiChat, codex) {
		t.Error("changed a model without suffix")
	}

	// Independent of the thinking switch, and applyThinking keeps the
	// client's (now valid) setting.
	cfg := promptCfg()
	cfg.Prompting.Thinking = config.Thinking{Enabled: false}
	p = map[string]any{"model": "m", "reasoning": map[string]any{"effort": "ultra"}}
	normalizeEffort(p, apiResponses, codex)
	applyThinking(cfg, p, apiResponses, codex)
	if p["reasoning"].(map[string]any)["effort"] != "high" || p["model"] != "m" {
		t.Fatalf("with thinking switch off: %v", p)
	}
}

func TestNormalizeEffortConfigUpdate(t *testing.T) {
	// gpt-6-astra: the engine forwards Responses bodies natively, unchecked.
	astra := web.ModelCaps{Thinking: true, Effort: true, ConfigUpdate: true,
		Levels: []string{"low", "medium", "high", "xhigh", "max"}}

	raw := `{"model":"gpt-6-astra","reasoning":{"effort":"ultra"},"input":[
		{"type":"message","role":"user","content":"hi"},
		{"type":"configuration_update","reasoning":{"effort":"ultra"}}]}`
	p := decode(t, raw)
	if normalizeEffort(p, apiResponses, astra) {
		t.Fatalf("native responses body changed: %v", p)
	}
	upd := p["input"].([]any)[1].(map[string]any)["reasoning"].(map[string]any)
	if p["reasoning"].(map[string]any)["effort"] != "ultra" || upd["effort"] != "ultra" {
		t.Fatalf("native responses body changed: %v", p)
	}

	// A suffix turns the native path off: the engine validates it.
	p = decode(t, `{"model":"gpt-6-astra(ultra)","reasoning":{"effort":"ultra"}}`)
	if !normalizeEffort(p, apiResponses, astra) || p["model"] != "gpt-6-astra(max)" {
		t.Fatalf("suffix not normalized: %v", p)
	}

	// Other API families go through the engine's validation.
	p = map[string]any{"model": "gpt-6-astra", "reasoning_effort": "ultra"}
	if !normalizeEffort(p, apiChat, astra) || p["reasoning_effort"] != "max" {
		t.Fatalf("chat not normalized: %v", p)
	}
	p = map[string]any{"model": "gpt-6-astra", "output_config": map[string]any{"effort": "ultra"}}
	if !normalizeEffort(p, apiAnthropic, astra) || p["output_config"].(map[string]any)["effort"] != "max" {
		t.Fatalf("anthropic not normalized: %v", p)
	}

	// Without the flag (gpt-5.6-sol) the Responses body is fixed as before.
	sol := astra
	sol.ConfigUpdate = false
	p = decode(t, raw)
	if !normalizeEffort(p, apiResponses, sol) || p["reasoning"].(map[string]any)["effort"] != "max" {
		t.Fatalf("responses not normalized: %v", p)
	}
}
