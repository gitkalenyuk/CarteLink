package web

import (
	"encoding/json"
	"testing"
	"time"
)

func entry(t *testing.T, js string) authFileEntry {
	t.Helper()
	var f authFileEntry
	if err := json.Unmarshal([]byte(js), &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestCodexWindows(t *testing.T) {
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	f := entry(t, `{"provider":"codex","status":"active","email":"a@b.c","id_token":{"plan_type":"plus"},
	 "quota":{"observed_at":"2026-11-10T11:00:00Z","signals":{
	  "X-Codex-Primary-Used-Percent":"42","X-Codex-Primary-Window-Minutes":"300","X-Codex-Primary-Reset-After-Seconds":"7200",
	  "X-Codex-Secondary-Used-Percent":"85.5","X-Codex-Secondary-Window-Minutes":"10080","X-Codex-Secondary-Reset-At":"1800000000"}}}`)
	a := buildAccountLimit(f, now)
	if len(a.Windows) != 2 || a.Windows[0].Key != "5h" || a.Windows[1].Key != "week" {
		t.Fatalf("windows: %+v", a.Windows)
	}
	if a.Windows[0].UsedPercent != 42 || a.Windows[0].ResetAt != now.Add(time.Hour).UnixMilli() {
		t.Fatalf("primary: %+v", a.Windows[0])
	}
	if a.Windows[1].UsedPercent != 85.5 || a.Windows[1].ResetAt != 1800000000000 {
		t.Fatalf("secondary: %+v", a.Windows[1])
	}
	if a.State != "warn" || a.Plan != "plus" || a.Label != "a@b.c" || !a.Percent {
		t.Fatalf("account: %+v", a)
	}
}

func TestWindowRolledOver(t *testing.T) {
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	f := entry(t, `{"provider":"codex","status":"active",
	 "quota":{"observed_at":"2026-11-10T01:00:00Z","signals":{
	  "X-Codex-Primary-Used-Percent":"100","X-Codex-Primary-Window-Minutes":"300","X-Codex-Primary-Reset-After-Seconds":"60"}}}`)
	a := buildAccountLimit(f, now)
	if !a.Windows[0].Rolled || a.Windows[0].UsedPercent != 0 || a.State != "ok" {
		t.Fatalf("expected a rolled window and ok state: %+v", a)
	}
}

func TestClaudeWindowsAndLimit(t *testing.T) {
	now := time.Unix(1794000000, 0)
	f := entry(t, `{"provider":"claude","status":"error","unavailable":true,"status_message":"quota exceeded",
	 "next_retry_after":"2026-11-07T00:00:00Z",
	 "quota":{"observed_at":"2026-11-06T00:00:00Z","signals":{
	  "Anthropic-Ratelimit-Unified-5h-Utilization":"1.02","Anthropic-Ratelimit-Unified-5h-Reset":"1794003600",
	  "Anthropic-Ratelimit-Unified-7d-Utilization":"0.314","Anthropic-Ratelimit-Unified-7d-Reset":"1794500000",
	  "Anthropic-Ratelimit-Unified-Status":"rejected"}}}`)
	a := buildAccountLimit(f, now)
	if len(a.Windows) != 2 || a.Windows[0].Key != "5h" || a.Windows[0].UsedPercent != 100 {
		t.Fatalf("5h: %+v", a.Windows)
	}
	if a.Windows[1].Key != "week" || a.Windows[1].UsedPercent != 31.4 {
		t.Fatalf("week: %+v", a.Windows[1])
	}
	if a.State != "limited" {
		t.Fatalf("state = %q", a.State)
	}
}

func TestStatesWithoutPercent(t *testing.T) {
	now := time.Now()
	cases := []struct{ js, want string }{
		{`{"provider":"antigravity","status":"active"}`, "ok"},
		{`{"provider":"antigravity","status":"active","disabled":true}`, "disabled"},
		{`{"provider":"antigravity","status":"error","unavailable":true,"status_message":"token expired"}`, "error"},
		{`{"provider":"antigravity","status":"error","unavailable":true,"status_message":"429 RESOURCE_EXHAUSTED"}`, "limited"},
		{`{"provider":"antigravity","status":"error","unavailable":true,"next_retry_after":"` + now.Add(time.Hour).UTC().Format(time.RFC3339) + `"}`, "limited"},
	}
	for _, c := range cases {
		a := buildAccountLimit(entry(t, c.js), now)
		if a.State != c.want || a.Percent {
			t.Errorf("%s → %q (percent=%v), want %q", c.js, a.State, a.Percent, c.want)
		}
	}
}

func TestPluginQuota(t *testing.T) {
	now := time.Now()
	a := buildAccountLimit(entry(t, `{"provider":"kiro","status":"active"}`), now)
	var q pluginQuota
	if err := json.Unmarshal([]byte(`{"subscription":{"plan":"Free"},"summary":[{"label":"Credits","value":12.5,"unit":"cr"}],
	 "groups":[{"displayName":"Usage","buckets":[{"window":"month","remainingFraction":0.1,"resetTime":"`+now.Add(48*time.Hour).UTC().Format(time.RFC3339)+`"}]}]}`), &q); err != nil {
		t.Fatal(err)
	}
	applyPluginQuota(&a, &q, now)
	if a.Plan != "Free" || len(a.Metrics) != 1 || len(a.Windows) != 1 {
		t.Fatalf("plugin quota: %+v", a)
	}
	if a.Windows[0].UsedPercent != 90 || a.Windows[0].Label != "month" || a.Windows[0].ResetAt == 0 || a.State != "warn" {
		t.Fatalf("bucket: %+v state=%s", a.Windows[0], a.State)
	}
}

func TestParseAuthFilesShapes(t *testing.T) {
	if n := len(parseAuthFiles([]byte(`{"files":[{"id":"a"},{"id":"b"}]}`))); n != 2 {
		t.Fatalf("wrapped: %d", n)
	}
	if n := len(parseAuthFiles([]byte(`[{"id":"a"}]`))); n != 1 {
		t.Fatalf("bare: %d", n)
	}
	if n := len(parseAuthFiles([]byte(`not json`))); n != 0 {
		t.Fatalf("garbage: %d", n)
	}
}
