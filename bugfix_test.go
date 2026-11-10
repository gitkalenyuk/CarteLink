package main

import (
	"testing"

	"cartelgate/internal/config"
)

// Model ids with a colon of their own must reach the engine whole; only a
// legacy "provider:" tag is a prefix.
func TestColonModelIDsStayWhole(t *testing.T) {
	cfg := config.Defaults()
	cfg.Providers = []config.Provider{{ID: "myprov", Enabled: true}}
	cfg.Routing.Mode = "table"
	cfg.Routing.UnmappedStrategy = "always"
	for def, want := range map[string]string{
		"qwen3:32b":                        "qwen3:32b",
		"deepseek/deepseek-chat-v3.1:free": "deepseek/deepseek-chat-v3.1:free",
		"codex:gpt-5":                      "gpt-5",
		"myprov:llama-4":                   "llama-4",
		"MyProv:qwen3:32b":                 "qwen3:32b",
	} {
		cfg.Routing.DefaultModel = def
		if got := resolveModelName(cfg, "anything"); got != want {
			t.Errorf("default %q → %q, want %q", def, got, want)
		}
	}
}

func TestBlacklistIgnoresThinkingSuffix(t *testing.T) {
	cfg := config.Defaults()
	cfg.ModelBlacklist = []string{"gpt-x"}
	for _, m := range []string{"gpt-x", "GPT-X(high)", "gpt-x(16384)", "gpt-x[1m]", " gpt-x(none) "} {
		if !isBlacklisted(cfg, m) {
			t.Errorf("%q must be blocked", m)
		}
	}
	if isBlacklisted(cfg, "gpt-x-mini(high)") || isBlacklisted(cfg, "gpt-xl") {
		t.Error("a different model must not be blocked")
	}
}

// Overlapping table rules: the answer may not depend on map order.
func TestWildcardRulesAreDeterministic(t *testing.T) {
	mm := map[string]string{"claude-*": "a", "claude-opus-*": "b", "Claude-Opus-9": "c", "openrouter/*": "d", "*": "z"}
	for i := 0; i < 200; i++ {
		if v, _ := lookupMap(mm, "claude-opus-4"); v != "b" {
			t.Fatalf("longest wildcard must win, got %q", v)
		}
		if v, _ := lookupMap(mm, "claude-opus-9"); v != "c" {
			t.Fatalf("exact (case-insensitive) must beat wildcards, got %q", v)
		}
		if v, _ := lookupMap(mm, "claude-haiku"); v != "a" {
			t.Fatalf("got %q", v)
		}
		if v, _ := lookupMap(mm, "openrouter/meta/llama-4"); v != "d" {
			t.Fatalf("* must cross a slash, got %q", v)
		}
		if v, _ := lookupMap(mm, "gemini-3-pro"); v != "z" {
			t.Fatalf("got %q", v)
		}
	}
	if wildcardMatch("gemini", "gemini-3") || !wildcardMatch("gpt-*-mini", "gpt-5-mini") || wildcardMatch("gpt-*-mini", "gpt-5-minimal") {
		t.Fatal("wildcardMatch")
	}
}
