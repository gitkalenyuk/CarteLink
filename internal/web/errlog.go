package web

import (
	"bufio"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ErrorEntry is one failed request (or app-level error) in the error log.
type ErrorEntry struct {
	Time     int64  `json:"t"` // unix milliseconds of the last occurrence
	First    int64  `json:"first,omitempty"`
	Count    int    `json:"count"`
	Status   int    `json:"status"`
	Kind     string `json:"kind"` // "upstream" (engine/provider answered an error) | "gateway" (CarteLink refused) | "app"
	Method   string `json:"method,omitempty"`
	Path     string `json:"path,omitempty"`
	Model    string `json:"model,omitempty"`    // what the client asked for
	Resolved string `json:"resolved,omitempty"` // what CarteLink sent to the engine
	Client   string `json:"client,omitempty"`   // short User-Agent
	Message  string `json:"message"`
}

// ErrorLog keeps the most recent errors in memory and appends every one to
// data/errors.jsonl, so the log survives restarts. Repeats of the same error
// within a minute are folded into one entry with a counter.
type ErrorLog struct {
	mu        sync.Mutex
	path      string
	entries   []ErrorEntry
	fileLines int
}

const (
	errLogKeep    = 500
	errLogCompact = 2000
	errLogMerge   = int64(60 * 1000)
)

// NewErrorLog loads the tail of the log file (if any).
func NewErrorLog(path string) *ErrorLog {
	l := &ErrorLog{path: path}
	f, err := os.Open(path)
	if err != nil {
		return l
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		var e ErrorEntry
		if json.Unmarshal(sc.Bytes(), &e) == nil && e.Time > 0 {
			l.fileLines++
			// Merged repeats are appended again with the new count — keep
			// only the latest copy of an entry.
			if n := len(l.entries); n > 0 && e.First != 0 && l.entries[n-1].First == e.First && sameError(l.entries[n-1], e) {
				l.entries[n-1] = e
				continue
			}
			l.entries = append(l.entries, e)
			if len(l.entries) > errLogKeep*2 {
				l.entries = append([]ErrorEntry(nil), l.entries[len(l.entries)-errLogKeep:]...)
			}
		}
	}
	if len(l.entries) > errLogKeep {
		l.entries = append([]ErrorEntry(nil), l.entries[len(l.entries)-errLogKeep:]...)
	}
	return l
}

func sameError(a, b ErrorEntry) bool {
	return a.Status == b.Status && a.Kind == b.Kind && a.Path == b.Path &&
		a.Model == b.Model && a.Resolved == b.Resolved && a.Message == b.Message
}

// Add records an error. Safe for concurrent use.
func (l *ErrorLog) Add(e ErrorEntry) {
	if l == nil {
		return
	}
	now := time.Now().UnixMilli()
	e.Time = now
	e.Message = truncateRunes(strings.TrimSpace(e.Message), 1000)
	if e.Message == "" {
		e.Message = "HTTP " + itoa(e.Status)
	}
	if e.Count < 1 {
		e.Count = 1
	}
	e.Client = truncateRunes(e.Client, 80)
	log.Printf("[error] %d %s %s model=%q→%q: %s", e.Status, e.Kind, e.Path, e.Model, e.Resolved, e.Message)

	l.mu.Lock()
	defer l.mu.Unlock()
	if n := len(l.entries); n > 0 {
		last := &l.entries[n-1]
		if sameError(*last, e) && now-last.Time < errLogMerge {
			last.Count++
			last.Time = now
			l.appendLocked(*last)
			return
		}
	}
	e.First = now
	l.entries = append(l.entries, e)
	if len(l.entries) > errLogKeep {
		l.entries = append([]ErrorEntry(nil), l.entries[len(l.entries)-errLogKeep:]...)
	}
	l.appendLocked(e)
}

func (l *ErrorLog) appendLocked(e ErrorEntry) {
	if l.path == "" {
		return
	}
	if l.fileLines >= errLogCompact {
		l.rewriteLocked()
		return
	}
	b, err := json.Marshal(e)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(l.path), 0o755)
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	_, _ = f.Write(append(b, '\n'))
	_ = f.Close()
	l.fileLines++
}

// rewriteLocked replaces the file with the in-memory entries (compaction).
func (l *ErrorLog) rewriteLocked() {
	var sb strings.Builder
	for _, e := range l.entries {
		if b, err := json.Marshal(e); err == nil {
			sb.Write(b)
			sb.WriteByte('\n')
		}
	}
	_ = os.MkdirAll(filepath.Dir(l.path), 0o755)
	tmp := l.path + ".tmp"
	if os.WriteFile(tmp, []byte(sb.String()), 0o644) == nil {
		_ = os.Rename(tmp, l.path)
	}
	l.fileLines = len(l.entries)
}

// List returns up to limit entries, newest first.
func (l *ErrorLog) List(limit int) []ErrorEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := len(l.entries)
	if limit <= 0 || limit > n {
		limit = n
	}
	out := make([]ErrorEntry, 0, limit)
	for i := n - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, l.entries[i])
	}
	return out
}

// Total is the number of kept entries.
func (l *ErrorLog) Total() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.entries)
}

// Clear drops every entry and truncates the file.
func (l *ErrorLog) Clear() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = nil
	l.fileLines = 0
	if l.path != "" {
		_ = os.WriteFile(l.path, nil, 0o644)
	}
}

// ErrorMessageFromBody extracts a readable message from an error response
// body: OpenAI/Anthropic/Gemini JSON shapes, else the raw text.
func ErrorMessageFromBody(body []byte) string {
	s := strings.TrimSpace(string(body))
	if s == "" {
		return ""
	}
	var v any
	if json.Unmarshal(body, &v) == nil {
		if m := findMessage(v, 0); m != "" {
			return m
		}
	}
	return truncateRunes(s, 600)
}

func findMessage(v any, depth int) string {
	if depth > 4 {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case []any:
		for _, it := range t {
			if m := findMessage(it, depth+1); m != "" {
				return m
			}
		}
	case map[string]any:
		for _, k := range []string{"message", "error", "detail", "msg"} {
			if x, ok := t[k]; ok {
				if m := findMessage(x, depth+1); m != "" {
					if typ, ok := t["type"].(string); ok && typ != "" && typ != "error" && k == "message" {
						return typ + ": " + m
					}
					return m
				}
			}
		}
	}
	return ""
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
