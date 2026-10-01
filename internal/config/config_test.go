package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHome_PortableMode(t *testing.T) {
	// Test CARTELGATE_HOME override
	orig := os.Getenv("CARTELGATE_HOME")
	defer os.Setenv("CARTELGATE_HOME", orig)

	tempDir := t.TempDir()
	os.Setenv("CARTELGATE_HOME", tempDir)
	if got := Home(); got != tempDir {
		t.Errorf("Home() with CARTELGATE_HOME = %q, want %q", got, tempDir)
	}

	// Test default or portable
	os.Unsetenv("CARTELGATE_HOME")
	gotDefault := Home()
	if gotDefault == "" {
		t.Errorf("Home() returned empty string")
	}

	exePath, err := os.Executable()
	if err == nil {
		exeDir := filepath.Dir(exePath)
		markerPath := filepath.Join(exeDir, ".portable")
		// If marker exists, Home() should return exeDir
		_ = os.WriteFile(markerPath, []byte(""), 0o644)
		if got := Home(); got != exeDir {
			t.Errorf("Home() with .portable = %q, want %q", got, exeDir)
		}
		_ = os.Remove(markerPath)
	}
}

func TestApplyAllCoversSwapsAndCustomRows(t *testing.T) {
	c := Defaults()
	c.Routing.ModelMap["claude-sonnet-4-6"] = "old"
	c.Routing.CustomPoints = []CustomPoint{{Label: "My", Model: "my-model"}}
	c.Routing.ApplyAll("gemini-3.8-flash-high")
	r := c.Routing
	for _, v := range []string{r.Tiers.Haiku, r.Tiers.Sonnet, r.Tiers.Opus, r.Tiers.Fast, r.Tiers.Main, r.Tiers.Max, r.DefaultModel,
		r.ModelMap["claude-sonnet-4-6"], r.ModelMap["my-model"]} {
		if v != "gemini-3.8-flash-high" {
			t.Fatalf("ApplyAll left %q in %+v", v, r)
		}
	}
}

func TestNormalizeCustomPoints(t *testing.T) {
	c := Defaults()
	c.Routing.CustomPoints = []CustomPoint{{Label: " ", Model: " a "}, {Label: "dup", Model: "A"}, {Model: ""}}
	Normalize(c)
	if len(c.Routing.CustomPoints) != 1 || c.Routing.CustomPoints[0].Model != "a" || c.Routing.CustomPoints[0].Label != "a" {
		t.Fatalf("unexpected custom points: %+v", c.Routing.CustomPoints)
	}
}
