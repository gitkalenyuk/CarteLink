package config

import (
	"os"
	"path/filepath"
	"strings"
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

func TestNormalizeScopedKeys(t *testing.T) {
	c := Defaults()
	c.APIKey = "cl-main"
	c.Cliproxy.APIKeys = []string{"cl-api-stale", "cl-extra"}
	c.ScopedKeys = []ScopedKey{
		{Name: " Сайт ", Key: "cl-api-one", Models: []string{" a ", "A", "b"}},
		{Name: "порожній ключ", Key: "  "},
		{Name: "без моделей", Key: "cl-api-two"},
	}
	Normalize(c)
	if got := strings.Join(c.Cliproxy.APIKeys, ","); got != "cl-extra,cl-api-one,cl-api-two" {
		t.Errorf("engine keys = %s", got)
	}
	if len(c.ScopedKeys) != 2 || c.ScopedKeys[0].Name != "Сайт" || c.ScopedKeys[0].ID == "" {
		t.Errorf("scoped keys = %+v", c.ScopedKeys)
	}
	if got := strings.Join(c.ScopedKeys[0].Models, ","); got != "a,b" {
		t.Errorf("models = %s", got)
	}
	// A key without models stays on record (it gets nothing, not everything).
	if c.FindScopedKey("cl-api-two") == nil || c.FindScopedKey("cl-api-none") != nil {
		t.Error("FindScopedKey")
	}

	// The main key stays first even if only scoped keys were listed.
	c = Defaults()
	c.APIKey = "cl-main"
	c.Cliproxy.APIKeys = []string{"cl-api-one"}
	c.ScopedKeys = []ScopedKey{{Name: "x", Key: "cl-api-one", Models: []string{"a"}}}
	Normalize(c)
	if got := strings.Join(c.Cliproxy.APIKeys, ","); got != "cl-main,cl-api-one" {
		t.Errorf("engine keys = %s", got)
	}

	// Key check off: the engine must get no keys (it then accepts anything).
	c = Defaults()
	c.RequireKey = false
	c.ScopedKeys = []ScopedKey{{Name: "x", Key: "cl-api-one", Models: []string{"a"}}}
	Normalize(c)
	if len(c.Cliproxy.APIKeys) != 0 {
		t.Errorf("requireKey=false: engine keys = %v", c.Cliproxy.APIKeys)
	}
}
