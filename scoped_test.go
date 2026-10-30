package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cartelgate/internal/config"
)

func scopedTestConfig() *config.Config {
	cfg := config.Defaults()
	cfg.ScopedKeys = []config.ScopedKey{{ID: "k1", Name: "Сайт", Key: "cl-api-aaa", Models: []string{"gemini-3-flash", "claude-haiku-4-5"}}}
	return cfg
}

func TestScopedKeyOfChecksEveryCredentialPlace(t *testing.T) {
	cfg := scopedTestConfig()
	set := []func(r *http.Request){
		func(r *http.Request) { r.Header.Set("Authorization", "Bearer cl-api-aaa") },
		func(r *http.Request) { r.Header.Set("Authorization", "bearer  cl-api-aaa ") },
		func(r *http.Request) { r.Header.Set("Authorization", "cl-api-aaa") },
		func(r *http.Request) { r.Header.Set("X-Api-Key", "cl-api-aaa") },
		func(r *http.Request) { r.Header.Set("X-Goog-Api-Key", "cl-api-aaa") },
		func(r *http.Request) { r.URL.RawQuery = "key=cl-api-aaa" },
		func(r *http.Request) { r.URL.RawQuery = "auth_token=cl-api-aaa" },
	}
	for i, f := range set {
		r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		f(r)
		if sk, known := scopedKeyOf(cfg, r); sk == nil || !known {
			t.Errorf("case %d: scoped key not recognised", i)
		}
	}
	// A wrong key in the first place cannot hide the scoped one in another.
	r := httptest.NewRequest(http.MethodPost, "/v1/messages?key=cl-api-aaa", nil)
	r.Header.Set("Authorization", "Bearer something-else")
	if sk, _ := scopedKeyOf(cfg, r); sk == nil {
		t.Error("scoped key behind a wrong bearer was missed")
	}
}

func TestScopedKeyOfDeletedKeyIsRefused(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	r.Header.Set("Authorization", "Bearer cl-api-gone")
	if sk, known := scopedKeyOf(scopedTestConfig(), r); sk != nil || known {
		t.Errorf("deleted key: sk=%v known=%v", sk, known)
	}
	r = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	r.Header.Set("Authorization", "Bearer cl-mainkey")
	if sk, known := scopedKeyOf(scopedTestConfig(), r); sk != nil || !known {
		t.Errorf("plain key: sk=%v known=%v", sk, known)
	}
}

func TestScopedModelMatch(t *testing.T) {
	sk := &scopedTestConfig().ScopedKeys[0]
	cases := []struct {
		in, want string
		ok       bool
	}{
		{"gemini-3-flash", "gemini-3-flash", true},
		{"GEMINI-3-FLASH", "gemini-3-flash", true},
		{"gemini-3-flash(high)", "gemini-3-flash(high)", true},
		{"claude-haiku-4-5[1m]", "claude-haiku-4-5", true},
		{"claude-fable-5-dd-hsalf-3-inimeg", "gemini-3-flash", true},
		{"", "", false},
		{"*", "", false},
		{"gemini-3-flash-lite", "", false},
		{"mini", "", false},
		{"gpt-5(gemini-3-flash)", "", false},
		{"cartelink-main", "", false},
		{"claude-sonnet-5-5", "", false},
	}
	for _, c := range cases {
		got, ok := scopedModelMatch(sk, c.in)
		if got != c.want || ok != c.ok {
			t.Errorf("scopedModelMatch(%q) = %q, %v; want %q, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestScopedAllowedPathDeniesByDefault(t *testing.T) {
	allowed := [][2]string{
		{"GET", "/v1/models"}, {"GET", "/models"}, {"GET", "/v1beta/models"}, {"GET", "/v1beta/models/x"},
		{"POST", "/v1/messages"}, {"POST", "/v1/messages/count_tokens"}, {"POST", "/v1/chat/completions"},
		{"POST", "/v1/completions"}, {"POST", "/v1/responses"}, {"POST", "/v1/responses/compact"},
		{"POST", "/v1/images/generations"}, {"POST", "/v1beta/models/x:generateContent"},
	}
	for _, a := range allowed {
		if !scopedAllowedPath(a[0], a[1]) {
			t.Errorf("%s %s should be allowed", a[0], a[1])
		}
	}
	denied := [][2]string{
		{"GET", "/v1/responses"}, {"GET", "/v1/realtime"}, {"POST", "/v1/realtime"}, {"POST", "/v1/live"},
		{"POST", "/v1/videos"}, {"POST", "/v1/images/edits"}, {"POST", "/v1/alpha/search"},
		{"POST", "/backend-api/codex/responses"}, {"POST", "/openai/v1/videos"}, {"POST", "/v1beta/interactions"},
		{"POST", "/v1internal:generateContent"}, {"DELETE", "/v1/models"}, {"GET", "/V1/MODELS"},
	}
	for _, d := range denied {
		if scopedAllowedPath(d[0], d[1]) {
			t.Errorf("%s %s should be denied", d[0], d[1])
		}
	}
}

func TestScopedGeminiModel(t *testing.T) {
	for in, want := range map[string]string{
		"/v1beta/models/gemini-3-flash:generateContent": "gemini-3-flash",
		"/v1beta/models/gemini-3-flash":                 "gemini-3-flash",
		"/v1beta/models/a:b:c":                          "",
	} {
		if got := scopedGeminiModel(in); got != want {
			t.Errorf("scopedGeminiModel(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestScopedCatalogAndFilter(t *testing.T) {
	cfg := scopedTestConfig()
	sk := &cfg.ScopedKeys[0]
	got := scopedCatalog(sk, []map[string]any{{"id": "gemini-3-flash", "owned_by": "google"}, {"id": "gpt-6"}})
	if len(got) != 2 || got[0].OwnedBy != "google" || got[1].ID != "claude-haiku-4-5" {
		t.Errorf("scopedCatalog = %+v", got)
	}
	cfg.ModelBlacklist = []string{"claude-haiku-4-5"}
	out := scopedFilterModelList(cfg, sk, []byte(`{"etag":"x","models":[{"name":"models/gemini-3-flash"},{"slug":"gpt-6"},{"slug":"claude-haiku-4-5"}]}`))
	var doc struct {
		Etag   string           `json:"etag"`
		Models []map[string]any `json:"models"`
	}
	if err := json.Unmarshal(out, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Etag != "x" || len(doc.Models) != 1 || !strings.Contains(string(out), "gemini-3-flash") {
		t.Errorf("filter = %s", out)
	}
	if got := scopedFilterModelList(cfg, sk, []byte("not json")); string(got) != `{"models":[]}` {
		t.Errorf("unreadable list leaked: %s", got)
	}
}
