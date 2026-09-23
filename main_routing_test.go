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
		{"gpt-4o", "gpt-4o"},                                             // unrelated name passes through (no catalog)
		{"claude-fable-5-dd-6-4-tennos-edualc", "gemini-3.8-flash-high"}, // cloaked sonnet → tier
	}
	for _, c := range cases {
		if got := resolveModelName(cfg, c.in); got != c.want {
			t.Errorf("resolveModelName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestUniversalTiersExactAliasesOnly(t *testing.T) {
	cfg := config.Defaults()
	cfg.Routing.Tiers.Fast = "provider:gemini-3.8-flash"
	cfg.Routing.Tiers.Main = "claude-sonnet-4-6"
	cfg.Routing.Tiers.Max = "openai:o3-mini"
	cfg.Routing.UnmappedStrategy = "passthrough"
	cases := []struct{ in, want string }{
		{"cartelink-fast", "gemini-3.8-flash"},
		{"cursor-small", "gemini-3.8-flash"}, // legacy alias
		{"codex-mini", "gemini-3.8-flash"},
		{"cartelink-main", "claude-sonnet-4-6"},
		{"codex-smart", "claude-sonnet-4-6"},
		{"cascade-base", "claude-sonnet-4-6"},
		{"cartelink-max", "o3-mini"},
		{"cascade-advanced", "o3-mini"},
		// Regressions from 2.2.0: substring rules hijacked real models.
		{"gemini-3.8-flash-high", "gemini-3.8-flash-high"}, // "gemini" contains "mini"
		{"gpt-4o-mini", "gpt-4o-mini"},
		{"grok-4-fast", "grok-4-fast"},
		{"o3-pro", "o3-pro"},
		{"deepseek-reasoner", "deepseek-reasoner"},
		{"my-small-model", "my-small-model"},
	}
	for _, c := range cases {
		if got := resolveModelName(cfg, c.in); got != c.want {
			t.Errorf("resolveModelName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestLegacyTierFieldsFolded(t *testing.T) {
	cfg := config.Defaults()
	cfg.Routing.Tiers.CodexMini = "gpt-4o-mini"
	cfg.Routing.Tiers.CursorPrimary = "claude-sonnet-4-6"
	cfg.Routing.Tiers.WindsurfAdv = "o3"
	config.Normalize(cfg)
	tr := cfg.Routing.Tiers
	if tr.Fast != "gpt-4o-mini" || tr.Main != "claude-sonnet-4-6" || tr.Max != "o3" || tr.CodexMini != "" {
		t.Fatalf("legacy tiers not folded: %+v", tr)
	}
}

func TestTableMode(t *testing.T) {
	cfg := routingCfg()
	cfg.Routing.Mode = "table"
	cfg.Routing.UnmappedStrategy = "passthrough"
	cfg.Routing.ModelMap["gpt-4o"] = "gemini-3-flash"
	cfg.Routing.ModelMap["claude-*"] = "kimi-k2.8-code"
	cases := []struct{ in, want string }{
		{"gpt-4o", "gemini-3-flash"},
		{"GPT-4o", "gemini-3-flash"},          // case-insensitive
		{"claude-sonnet-5", "kimi-k2.8-code"}, // exact entry
		{"claude-opus-4-8", "kimi-k2.8-code"}, // wildcard; tiers are off in table mode
		{"gemini-2.5-pro", "gemini-2.5-pro"},  // unmapped → passthrough
	}
	for _, c := range cases {
		if got := resolveModelName(cfg, c.in); got != c.want {
			t.Errorf("table resolve(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestUnmappedStrategies(t *testing.T) {
	cfg := config.Defaults()
	cfg.Routing.DefaultModel = "prov:fallback-model"
	known := func(m string) bool { return m == "served-model" }

	cfg.Routing.UnmappedStrategy = "smart"
	if got := resolveModel(cfg, "served-model", known); got != "served-model" {
		t.Errorf("smart: served model rewritten to %q", got)
	}
	if got := resolveModel(cfg, "gpt-4o", known); got != "fallback-model" {
		t.Errorf("smart: unknown model = %q, want fallback-model", got)
	}
	if got := resolveModel(cfg, "gpt-4o", nil); got != "gpt-4o" {
		t.Errorf("smart without catalog must pass through, got %q", got)
	}
	cfg.Routing.UnmappedStrategy = "always"
	if got := resolveModel(cfg, "served-model", known); got != "fallback-model" {
		t.Errorf("always: got %q", got)
	}
	cfg.Routing.UnmappedStrategy = "passthrough"
	if got := resolveModel(cfg, "gpt-4o", known); got != "gpt-4o" {
		t.Errorf("passthrough: got %q", got)
	}
	// Legacy values normalise to smart.
	for _, legacy := range []string{"default", "fallback", "default_model", ""} {
		c := config.Defaults()
		c.Routing.UnmappedStrategy = legacy
		config.Normalize(c)
		if c.Routing.UnmappedStrategy != "smart" {
			t.Errorf("legacy %q → %q, want smart", legacy, c.Routing.UnmappedStrategy)
		}
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
