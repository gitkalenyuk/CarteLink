package cliproxy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func readDoc(t *testing.T, path string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var doc map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse %s: %v\n%s", path, err, raw)
	}
	return doc
}

func TestSyncConfigYAML_FreshFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	m := Managed{Host: "127.0.0.1", Port: 8317, Secret: "s3cret", AuthDir: `C:\auths`, APIKeys: []string{"vg-abc"}, RequireKey: true}
	if err := SyncConfigYAML(path, m); err != nil {
		t.Fatal(err)
	}
	doc := readDoc(t, path)
	if doc["port"] != 8317 || doc["host"] != "127.0.0.1" || doc["auth-dir"] != `C:\auths` {
		t.Errorf("basics not written: %v", doc)
	}
	if keys := stringList(doc["api-keys"]); len(keys) != 1 || keys[0] != "vg-abc" {
		t.Errorf("api-keys = %v", keys)
	}
	rm := doc["remote-management"].(map[string]any)
	if rm["secret-key"] != "s3cret" {
		t.Errorf("secret not written: %v", rm)
	}
}

func TestSyncConfigYAML_KeepsManagementEditsAndUpdatesManagedKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	// Simulate what the engine's Management API persists: extra sections we
	// must not lose, plus a stale api-keys list and port.
	engineWritten := `host: "127.0.0.1"
port: 8317
remote-management:
  allow-remote: false
  secret-key: "old"
  disable-control-panel: false
auth-dir: "C:\\auths"
api-keys:
  - "vg-abc"
claude-code:
  disable-cloaking-model-list: true
openai-compatibility:
  - name: openrouter
    base-url: https://openrouter.ai/api/v1
    api-key-entries:
      - api-key: sk-or-1
routing:
  strategy: fill-first
`
	if err := os.WriteFile(path, []byte(engineWritten), 0o644); err != nil {
		t.Fatal(err)
	}
	// User turns "require key" off and changes the port in the UI.
	m := Managed{Host: "0.0.0.0", Port: 9000, Secret: "old", AuthDir: `C:\auths`, APIKeys: []string{"vg-abc"}, RequireKey: false}
	if err := SyncConfigYAML(path, m); err != nil {
		t.Fatal(err)
	}
	doc := readDoc(t, path)
	if doc["port"] != 9000 || doc["host"] != "0.0.0.0" {
		t.Errorf("managed keys not updated: port=%v host=%v", doc["port"], doc["host"])
	}
	if keys := stringList(doc["api-keys"]); len(keys) != 0 {
		t.Errorf("requireKey=false must clear api-keys, got %v", keys)
	}
	if _, ok := doc["openai-compatibility"]; !ok {
		t.Errorf("management-added provider lost: %v", doc)
	}
	if r, _ := doc["routing"].(map[string]any); r == nil || r["strategy"] != "fill-first" {
		t.Errorf("routing strategy lost: %v", doc["routing"])
	}
}

func TestSyncConfigYAML_ExtraYAMLMergedAndValidated(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	base := Managed{Host: "127.0.0.1", Port: 8317, Secret: "s", AuthDir: "a", RequireKey: true}
	if err := SyncConfigYAML(path, base); err != nil {
		t.Fatal(err)
	}
	withExtra := base
	withExtra.ExtraYAML = "debug: true\nrequest-log: true\n"
	if err := SyncConfigYAML(path, withExtra); err != nil {
		t.Fatal(err)
	}
	doc := readDoc(t, path)
	if doc["debug"] != true || doc["request-log"] != true {
		t.Errorf("extra YAML not merged: %v", doc)
	}
	bad := base
	bad.ExtraYAML = "this: [is: not: valid"
	if err := SyncConfigYAML(path, bad); err == nil || !strings.Contains(err.Error(), "extra config YAML") {
		t.Errorf("invalid extra YAML must be rejected, got %v", err)
	}
}

func TestSyncConfigYAML_NoRewriteWhenUnchanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	m := Managed{Host: "127.0.0.1", Port: 8317, Secret: "s", AuthDir: "a", RequireKey: true, APIKeys: []string{"k"}}
	if err := SyncConfigYAML(path, m); err != nil {
		t.Fatal(err)
	}
	fi1, _ := os.Stat(path)
	// Second sync with identical input must not touch the file.
	if err := SyncConfigYAML(path, m); err != nil {
		t.Fatal(err)
	}
	fi2, _ := os.Stat(path)
	if !fi1.ModTime().Equal(fi2.ModTime()) {
		t.Errorf("file rewritten although nothing changed")
	}
}

func TestReadAPIKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	_ = os.WriteFile(path, []byte("api-keys:\n  - a\n  - \" b \"\n  - \"\"\n"), 0o644)
	got := ReadAPIKeys(path)
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Errorf("ReadAPIKeys = %v", got)
	}
	if ReadAPIKeys(filepath.Join(t.TempDir(), "missing.yaml")) != nil {
		t.Errorf("missing file must yield nil")
	}
}

func TestSyncConfigYAML_PluginsEnabledConfigsKept(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	seed := "plugins:\n  enabled: false\n  dir: plugins\n  configs:\n    kiro:\n      enabled: true\n      idc_region: us-east-1\n"
	if err := os.WriteFile(path, []byte(seed), 0o644); err != nil {
		t.Fatal(err)
	}
	m := Managed{Host: "127.0.0.1", Port: 8317, Secret: "s", AuthDir: "a", PluginsDir: `C:\home\data\cliproxy\plugins`}
	if err := SyncConfigYAML(path, m); err != nil {
		t.Fatal(err)
	}
	pl := readDoc(t, path)["plugins"].(map[string]any)
	if pl["enabled"] != true || pl["dir"] != `C:\home\data\cliproxy\plugins` {
		t.Fatalf("plugins not enabled/dir: %v", pl)
	}
	kiro := pl["configs"].(map[string]any)["kiro"].(map[string]any)
	if kiro["idc_region"] != "us-east-1" {
		t.Fatalf("plugin configs lost: %v", pl)
	}
}

func TestSyncConfigYAML_RestoresFromBackupWhenTruncated(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	good := "openai-compatibility:\n  - name: routeway\n    base-url: https://example.com/v1\nport: 8317\n"
	if err := os.WriteFile(path, []byte(good), 0o644); err != nil {
		t.Fatal(err)
	}
	m := Managed{Host: "127.0.0.1", Port: 8317, Secret: "s", AuthDir: "a"}
	if err := SyncConfigYAML(path, m); err != nil { // creates config.yaml.bak
		t.Fatal(err)
	}
	// The engine was killed mid-write: empty file, then a half-written one.
	for _, bad := range []string{"", "openai-compatibility:\n  - name: \"rout"} {
		if err := os.WriteFile(path, []byte(bad), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := SyncConfigYAML(path, m); err != nil {
			t.Fatal(err)
		}
		oc, _ := readDoc(t, path)["openai-compatibility"].([]any)
		if len(oc) != 1 {
			t.Fatalf("provider lost after %q: %v", bad, readDoc(t, path))
		}
	}
	if matches, _ := filepath.Glob(path + ".broken-*"); len(matches) != 1 {
		t.Fatalf("broken file not kept aside: %v", matches)
	}
}
