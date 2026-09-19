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
	t.Setenv("VISIONGATE_HOME", dir)
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
