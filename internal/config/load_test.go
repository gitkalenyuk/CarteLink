package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func withHome(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("CARTELGATE_HOME", dir)
	return dir
}

func TestLoad_CorruptFileIsBackedUp(t *testing.T) {
	dir := withHome(t)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load()
	if !errors.Is(err, ErrCorrupt) {
		t.Fatalf("want ErrCorrupt, got %v", err)
	}
	if cfg == nil || cfg.Cliproxy.Port != 8317 {
		t.Errorf("defaults expected after corrupt load, got %+v", cfg)
	}
	entries, _ := os.ReadDir(dir)
	backups := 0
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "config.json.corrupt-") {
			backups++
		}
	}
	if backups != 1 {
		t.Errorf("expected one backup file, found %d", backups)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "config.json")); !os.IsNotExist(statErr) {
		t.Errorf("corrupt config.json should have been moved aside")
	}
}

func TestLoad_ValidFileRoundTrip(t *testing.T) {
	withHome(t)
	c := Defaults()
	c.Cliproxy.Port = 9999
	c.ModelBlacklist = []string{"gpt-4o"}
	if err := c.Save(); err != nil {
		t.Fatal(err)
	}
	got, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.Cliproxy.Port != 9999 || len(got.ModelBlacklist) != 1 {
		t.Errorf("round trip lost data: %+v", got)
	}
}

func TestDisplayHost(t *testing.T) {
	cases := map[string]string{
		"": "127.0.0.1", "0.0.0.0": "127.0.0.1", "::": "127.0.0.1", "[::]": "127.0.0.1",
		"127.0.0.1": "127.0.0.1", "192.168.1.5": "192.168.1.5", " localhost ": "localhost",
	}
	for in, want := range cases {
		if got := DisplayHost(in); got != want {
			t.Errorf("DisplayHost(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestClone_IsDeep(t *testing.T) {
	c := Defaults()
	c.Routing.ModelMap["a"] = "b"
	c.Cliproxy.APIKeys = []string{"k1"}
	cp := c.Clone()
	cp.Routing.ModelMap["a"] = "changed"
	cp.Cliproxy.APIKeys[0] = "changed"
	if c.Routing.ModelMap["a"] != "b" || c.Cliproxy.APIKeys[0] != "k1" {
		t.Errorf("Clone shares memory with the original")
	}
}

func TestMigrateLegacyHome_CopiesOnce(t *testing.T) {
	base := t.TempDir()
	from := filepath.Join(base, "old")
	to := filepath.Join(base, "new")
	_ = os.MkdirAll(filepath.Join(from, "data", "cliproxy", "auths"), 0o755)
	_ = os.MkdirAll(filepath.Join(from, "data", "EBWebView"), 0o755)
	_ = os.WriteFile(filepath.Join(from, "config.json"), []byte(`{"apiKey":"vg-1"}`), 0o644)
	_ = os.WriteFile(filepath.Join(from, "data", "cliproxy", "auths", "a.json"), []byte(`{}`), 0o644)
	_ = os.WriteFile(filepath.Join(from, "data", "EBWebView", "big"), []byte(`x`), 0o644)
	_ = os.WriteFile(filepath.Join(from, "app.log"), []byte(`log`), 0o644)
	migrateLegacyHome(from, to)
	if _, err := os.Stat(filepath.Join(to, "data", "cliproxy", "auths", "a.json")); err != nil {
		t.Fatalf("auth file not migrated: %v", err)
	}
	if _, err := os.Stat(filepath.Join(to, "data", "EBWebView")); !os.IsNotExist(err) {
		t.Errorf("webview profile should be skipped")
	}
	if _, err := os.Stat(filepath.Join(to, "app.log")); !os.IsNotExist(err) {
		t.Errorf("logs should be skipped")
	}
	// Second run must not overwrite the new location.
	_ = os.WriteFile(filepath.Join(to, "config.json"), []byte(`{"apiKey":"cg-2"}`), 0o644)
	migrateLegacyHome(from, to)
	b, _ := os.ReadFile(filepath.Join(to, "config.json"))
	if !strings.Contains(string(b), "cg-2") {
		t.Errorf("migration overwrote an existing home")
	}
}

func TestNormalize_GeneratesPrefixedSecrets(t *testing.T) {
	c := Defaults()
	Normalize(c)
	if !strings.HasPrefix(c.APIKey, KeyPrefix) || !strings.HasPrefix(c.Cliproxy.ManagementSecret, SecretPrefix) {
		t.Errorf("prefixes: key=%s secret=%s", c.APIKey, c.Cliproxy.ManagementSecret)
	}
	if len(c.Cliproxy.APIKeys) != 1 || c.Cliproxy.APIKeys[0] != c.APIKey {
		t.Errorf("engine key should mirror the gateway key: %v", c.Cliproxy.APIKeys)
	}
}
