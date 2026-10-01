package web

import (
	"path/filepath"
	"testing"
)

func TestErrorLogMergeAndPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "errors.jsonl")
	l := NewErrorLog(path)
	e := ErrorEntry{Status: 429, Kind: "upstream", Path: "/v1/messages", Model: "claude-sonnet-5-5", Message: "quota exceeded"}
	l.Add(e)
	l.Add(e) // same error right away -> merged
	l.Add(ErrorEntry{Status: 401, Kind: "upstream", Path: "/v1/messages", Message: "bad key"})

	got := l.List(10)
	if len(got) != 2 {
		t.Fatalf("want 2 entries (one merged), got %d", len(got))
	}
	if got[0].Status != 401 || got[1].Count != 2 {
		t.Fatalf("unexpected order/count: %+v", got)
	}

	// Reload from disk: merged repeats must not come back as duplicates.
	l2 := NewErrorLog(path)
	got2 := l2.List(10)
	if len(got2) != 2 || got2[1].Count != 2 {
		t.Fatalf("reloaded log differs: %+v", got2)
	}

	l2.Clear()
	if n := NewErrorLog(path).Total(); n != 0 {
		t.Fatalf("clear did not truncate the file: %d entries", n)
	}
}

func TestErrorMessageFromBody(t *testing.T) {
	cases := map[string]string{
		`{"error":{"type":"rate_limit_error","message":"slow down"}}`: "rate_limit_error: slow down",
		`{"error":{"message":"model not found","code":404}}`:          "model not found",
		`{"error":"unknown provider for model x"}`:                    "unknown provider for model x",
		`[{"error":{"message":"gemini says no"}}]`:                    "gemini says no",
		`plain text failure`:                                          "plain text failure",
		``:                                                            "",
	}
	for in, want := range cases {
		if got := ErrorMessageFromBody([]byte(in)); got != want {
			t.Errorf("ErrorMessageFromBody(%q) = %q, want %q", in, got, want)
		}
	}
}
