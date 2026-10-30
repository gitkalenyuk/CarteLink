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

func TestSameOriginRequestDNSRebinding(t *testing.T) {
	mk := func(host string, hdr map[string]string) *http.Request {
		r, _ := http.NewRequest(http.MethodGet, "http://"+host+"/api/config", nil)
		r.Host = host
		for k, v := range hdr {
			r.Header.Set(k, v)
		}
		return r
	}
	sameOrigin := map[string]string{"Sec-Fetch-Site": "same-origin"}
	rejected := []*http.Request{
		mk("evil.example:8317", sameOrigin), // a rebound page reading /api/config
		mk("evil.example:8317", nil),
		mk("evil.example", nil),
		mk("evil.example:8317", map[string]string{"Sec-Fetch-Site": "none"}),
		mk("evil.localhost:8317", sameOrigin),
		mk("localhost.evil.example:8317", sameOrigin),
		mk("127.0.0.1.evil.example:8317", sameOrigin),
		mk("", nil),
	}
	for _, r := range rejected {
		if sameOriginRequest(r, "127.0.0.1", "0.0.0.0") {
			t.Errorf("Host %q (%v): allowed", r.Host, r.Header)
		}
	}
	allowed := []*http.Request{
		mk("127.0.0.1:8317", sameOrigin),
		mk("LOCALHOST:8317", sameOrigin),
		mk("[::1]:8317", sameOrigin),
		mk("192.168.1.50:8317", sameOrigin),
		mk("127.0.0.1:8317", nil), // second launch, catalog refresh
	}
	for _, r := range allowed {
		if !sameOriginRequest(r, "127.0.0.1") {
			t.Errorf("Host %q: refused", r.Host)
		}
	}
	// Host set to a machine name in Settings: the window opens on that name.
	if !sameOriginRequest(mk("mypc.local:8317", sameOrigin), "mypc.local") {
		t.Error("configured host name refused")
	}
	if sameOriginRequest(mk("mypc.local:8317", sameOrigin), "other.local", "  ") {
		t.Error("a name that is not configured allowed")
	}
}

func TestClaudePickerEntries(t *testing.T) {
	cfg := config.Defaults()
	if got := claudePickerEntries(cfg, nil); len(got) != 0 {
		t.Fatalf("no main model -> no entries, got %+v", got)
	}
	cfg.Routing.ApplyAll("gemini-3.8-flash-high")
	got := claudePickerEntries(cfg, nil)
	if len(got) != 1 || got[0].ID != "claude-cartelink-main" || got[0].DisplayName != "CarteLink: gemini-3.8-flash-high" {
		t.Fatalf("one model everywhere -> only main entry, got %+v", got)
	}
	cfg.Routing.Tiers.Max = "claude-opus-5-5"
	if got := claudePickerEntries(cfg, nil); len(got) != 2 || got[1].ID != "claude-cartelink-max" {
		t.Fatalf("different max tier -> extra entry, got %+v", got)
	}
	if m := resolveModelName(cfg, "claude-cartelink-main"); m != "gemini-3.8-flash-high" {
		t.Fatalf("claude-cartelink-main resolves to %q", m)
	}
}

func TestClaudePickerEntries1M(t *testing.T) {
	cfg := config.Defaults()
	cfg.Routing.ApplyAll("gemini-3.8-flash-high")
	cfg.Routing.Tiers.Max = "claude-opus-4-8"
	ctx := map[string]int{"gemini-3.8-flash-high": 1048576, "claude-opus-4-8": 200000}
	got := claudePickerEntries(cfg, func(m string) int { return ctx[m] })
	if len(got) != 2 || got[0].ID != "claude-cartelink-main[1m]" || got[1].ID != "claude-cartelink-max" {
		t.Fatalf("1M main gets the [1m] id, 200K max does not: %+v", got)
	}
	// The marker never reaches the engine.
	for in, want := range map[string]string{
		"claude-cartelink-main[1m]": "gemini-3.8-flash-high",
		"claude-sonnet-5-5[1M]":     "gemini-3.8-flash-high",
	} {
		if m := resolveModelName(cfg, in); m != want {
			t.Errorf("%s -> %q, want %q", in, m, want)
		}
	}
	cfg.Routing.Mode = "table"
	cfg.Routing.ModelMap = map[string]string{}
	cfg.Routing.DefaultModel = ""
	cfg.Routing.UnmappedStrategy = "passthrough"
	if m := resolveModelName(cfg, "claude-opus-5-5[1m]"); m != "claude-opus-5-5" {
		t.Errorf("passthrough keeps the marker: %q", m)
	}
}

func TestUniversalTiersFollowClaudeTiers(t *testing.T) {
	cfg := config.Defaults()
	cfg.Routing.Tiers.Sonnet = "gemini-3.8-flash-high"
	cfg.Routing.Tiers.Opus = "claude-opus-5-5"
	cfg.Routing.DefaultModel = "gemini-3-flash"
	cases := map[string]string{
		"cartelink-main":        "gemini-3.8-flash-high", // main empty → Sonnet
		"claude-cartelink-main": "gemini-3.8-flash-high",
		"cartelink-max":         "claude-opus-5-5", // max empty → Opus
		"cartelink-fast":        "gemini-3-flash",  // fast and Haiku empty → default
	}
	for in, want := range cases {
		if got := resolveModelName(cfg, in); got != want {
			t.Errorf("%s -> %q, want %q", in, got, want)
		}
	}
	if got := claudePickerEntries(cfg, nil); len(got) != 3 || got[0].DisplayName != "CarteLink: gemini-3.8-flash-high" {
		t.Fatalf("picker entries: %+v", got)
	}
}
