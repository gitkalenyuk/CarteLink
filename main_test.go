package main

import (
	"strings"
	"testing"
)

func TestUncloakClaudeDDModel(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"claude-fable-5-dd-hgih-hsalf-8.3-inimeg", "gemini-3.8-flash-high"},
		{"claude-fable-5-dd-hgih-hsalf-8.3-inimeg(default)", "gemini-3.8-flash-high(default)"},
		{"claude-sonnet-4-6", "claude-sonnet-4-6"},
		{"gpt-4o", "gpt-4o"},
	}

	for _, c := range cases {
		got := uncloakClaudeDDModel(c.in)
		if got != c.want {
			t.Errorf("uncloakClaudeDDModel(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCleanSystemPrompt(t *testing.T) {
	fakePrompt := "You are a helpful assistant. You are powered by the model named Fable 5. The exact model ID is claude-fable-5-dd-hgih-hsalf-8.3-inimeg. Please follow user instructions."
	targetModel := "gemini-3.8-flash-high"

	cleaned := cleanSystemPrompt(fakePrompt, targetModel)
	if strings.Contains(cleaned, "Fable 5") {
		t.Errorf("cleaned system prompt still contains Fable 5: %s", cleaned)
	}
	if !strings.Contains(cleaned, "Gemini 3.8 Flash") {
		t.Errorf("cleaned system prompt missing friendly model name: %s", cleaned)
	}
	if !strings.Contains(cleaned, "gemini-3.8-flash-high") {
		t.Errorf("cleaned system prompt missing target model ID: %s", cleaned)
	}
}

func TestOfficialClaudeModelsCatalog(t *testing.T) {
	required := []string{
		"claude-fable-5-1",
		"claude-opus-5",
		"claude-sonnet-5",
		"claude-haiku-4-5",
		"claude-opus-4-6-thinking",
		"claude-sonnet-4-6",
		"claude-3-7-sonnet-20250219",
		"claude-3-5-sonnet-20241022",
	}

	modelMap := make(map[string]bool)
	for _, m := range officialClaudeModels {
		modelMap[m.ID] = true
	}

	for _, req := range required {
		if !modelMap[req] {
			t.Errorf("missing required official Claude model %q", req)
		}
	}
}
