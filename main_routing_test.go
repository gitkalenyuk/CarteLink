package main

import (
	"net/http"
	"testing"

	"cartelgate/internal/config"
)

func routingCfg() *config.Config {
	c := config.Defaults()
	c.Routing.Tiers.Sonnet = "antigravity:gemini-3.8-flash-high"
	c.Routing.Tiers.Opus = "claude-opus-4-6-thinking"
	c.Routing.ModelMap["claude-sonnet-5"] = "kimi-k2.8-code"
	c.Routing.DefaultModel = "gemini-3-flash"
	return c
}

func TestResolveModelName(t *testing.T) {
	cfg := routingCfg()
	cases := []struct{ in, want string }{
		{"claude-sonnet-5", "kimi-k2.8-code"},                            // exact map wins over tier word
		{"claude-sonnet-4-6", "gemini-3.8-flash-high"},                   // tier, provider prefix stripped
		{"claude-opus-4-8", "claude-opus-4-6-thinking"},                  // tier
		{"claude-haiku-4-5", "claude-haiku-4-5"},                         // no haiku tier → unchanged
		{"", "gemini-3-flash"},                                           // empty → default
		{"*", "gemini-3-flash"},                                          // generic → default
		{"gpt-4o", "gpt-4o"},                                             // unrelated name passes through
		{"claude-fable-5-dd-6-4-tennos-edualc", "gemini-3.8-flash-high"}, // cloaked sonnet → tier
	}
	for _, c := range cases {
		if got := resolveModelName(cfg, c.in); got != c.want {
			t.Errorf("resolveModelName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestMultiClientTiersAndUnmappedStrategy(t *testing.T) {
	cfg := config.Defaults()
	// Cursor tiers
	cfg.Routing.Tiers.CursorSmall = "provider:gemini-3.8-flash"
	cfg.Routing.Tiers.CursorSonnet = "anthropic:claude-3-7-sonnet"
	cfg.Routing.Tiers.CursorPrimary = "openai:gpt-4o"

	// Codex tiers
	cfg.Routing.Tiers.CodexMini = "openrouter:gpt-4o-mini"
	cfg.Routing.Tiers.CodexSmart = "openai:gpt-4o"
	cfg.Routing.Tiers.CodexReason = "openai:o3-mini"

	// Windsurf tiers
	cfg.Routing.Tiers.WindsurfFast = "gemini-3.7-flash"
	cfg.Routing.Tiers.WindsurfBase = "claude-3-5-sonnet"
	cfg.Routing.Tiers.WindsurfAdv = "claude-3-7-sonnet"

	cfg.Routing.DefaultModel = "fallback-default-model"

	// Test Cursor matches
	if got := resolveModelName(cfg, "cursor-small"); got != "gemini-3.8-flash" {
		t.Errorf("expected cursor-small -> gemini-3.8-flash, got %s", got)
	}
	if got := resolveModelName(cfg, "cursor-sonnet"); got != "claude-3-7-sonnet" {
		t.Errorf("expected cursor-sonnet -> claude-3-7-sonnet, got %s", got)
	}
	if got := resolveModelName(cfg, "cursor-primary"); got != "gpt-4o" {
		t.Errorf("expected cursor-primary -> gpt-4o, got %s", got)
	}

	// Test Codex matches
	if got := resolveModelName(cfg, "codex-mini"); got != "gpt-4o-mini" {
		t.Errorf("expected codex-mini -> gpt-4o-mini, got %s", got)
	}
	if got := resolveModelName(cfg, "codex-smart"); got != "gpt-4o" {
		t.Errorf("expected codex-smart -> gpt-4o, got %s", got)
	}
	if got := resolveModelName(cfg, "codex-reason"); got != "o3-mini" {
		t.Errorf("expected codex-reason -> o3-mini, got %s", got)
	}

	// Test Windsurf matches
	if got := resolveModelName(cfg, "cascade-fast"); got != "gemini-3.7-flash" {
		t.Errorf("expected cascade-fast -> gemini-3.7-flash, got %s", got)
	}
	if got := resolveModelName(cfg, "cascade-base"); got != "claude-3-5-sonnet" {
		t.Errorf("expected cascade-base -> claude-3-5-sonnet, got %s", got)
	}
	if got := resolveModelName(cfg, "cascade-advanced"); got != "claude-3-7-sonnet" {
		t.Errorf("expected cascade-advanced -> claude-3-7-sonnet, got %s", got)
	}

	// Test UnmappedStrategy: passthrough
	cfg.Routing.UnmappedStrategy = "passthrough"
	if got := resolveModelName(cfg, "custom-unmapped-model"); got != "custom-unmapped-model" {
		t.Errorf("expected passthrough, got %s", got)
	}

	// Test UnmappedStrategy: fallback
	cfg.Routing.UnmappedStrategy = "fallback"
	if got := resolveModelName(cfg, "custom-unmapped-model"); got != "fallback-default-model" {
		t.Errorf("expected fallback-default-model, got %s", got)
	}
}

func TestIsBlacklisted(t *testing.T) {
	cfg := config.Defaults()
	cfg.ModelBlacklist = []string{" GPT-4o ", "gemini-3-flash"}
	if !isBlacklisted(cfg, "gpt-4o") || !isBlacklisted(cfg, "Gemini-3-Flash") {
		t.Errorf("case/space-insensitive match expected")
	}
	if isBlacklisted(cfg, "gpt-4o-mini") || isBlacklisted(cfg, "") || isBlacklisted(nil, "gpt-4o") {
		t.Errorf("unexpected blacklist hit")
	}
}

func TestSameOriginRequest(t *testing.T) {
	mk := func(host string, hdr map[string]string) *http.Request {
		r, _ := http.NewRequest(http.MethodGet, "http://"+host+"/api/config", nil)
		r.Host = host
		for k, v := range hdr {
			r.Header.Set(k, v)
		}
		return r
	}
	cases := []struct {
		name string
		req  *http.Request
		want bool
	}{
		{"local process, no browser headers", mk("127.0.0.1:8317", nil), true},
		{"embedded window same-origin GET", mk("127.0.0.1:8317", map[string]string{"Sec-Fetch-Site": "same-origin"}), true},
		{"embedded window same-origin PUT", mk("127.0.0.1:8317", map[string]string{"Origin": "http://127.0.0.1:8317", "Sec-Fetch-Site": "same-origin"}), true},
		{"localhost name", mk("localhost:8317", map[string]string{"Origin": "http://localhost:8317"}), true},
		{"evil website", mk("127.0.0.1:8317", map[string]string{"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"}), false},
		{"origin mismatch without fetch metadata", mk("127.0.0.1:8317", map[string]string{"Origin": "http://evil.example"}), false},
		{"dns rebinding: public host name", mk("evil.example:8317", map[string]string{"Origin": "http://evil.example:8317"}), false},
		{"lan ip", mk("192.168.1.5:8317", map[string]string{"Origin": "http://192.168.1.5:8317"}), true},
	}
	for _, c := range cases {
		if got := sameOriginRequest(c.req); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
