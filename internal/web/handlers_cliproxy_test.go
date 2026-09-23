package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseModelIDs(t *testing.T) {
	cases := map[string][]string{
		`{"object":"list","data":[{"id":"b"},{"id":"a"},{"id":"a"}]}`: {"a", "b"},
		`{"models":[{"name":"llama3"},{"id":"qwen"}]}`:                {"llama3", "qwen"},
		`["x","y"]`: {"x", "y"},
		`not json`:  {},
	}
	for in, want := range cases {
		got := parseModelIDs([]byte(in))
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("parseModelIDs(%s) = %v, want %v", in, got, want)
		}
	}
}

func TestApiProviderModels(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer k1" || r.Header.Get("X-Extra") != "1" {
			w.WriteHeader(401)
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"m2"},{"id":"m1"}]}`))
	}))
	defer up.Close()
	a := &App{}
	body := `{"baseUrl":"` + up.URL + `/v1/","apiKey":"k1","headers":{"X-Extra":"1"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/provider-models", strings.NewReader(body))
	rec := httptest.NewRecorder()
	a.apiProviderModels(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var out providerModelsResp
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.OK || strings.Join(out.Models, ",") != "m1,m2" {
		t.Errorf("unexpected response: %+v", out)
	}

	// Bad scheme is rejected before any request is made.
	req = httptest.NewRequest(http.MethodPost, "/api/provider-models", strings.NewReader(`{"baseUrl":"ftp://x"}`))
	rec = httptest.NewRecorder()
	a.apiProviderModels(rec, req)
	if rec.Code != 400 {
		t.Errorf("ftp scheme should be 400, got %d", rec.Code)
	}
}
