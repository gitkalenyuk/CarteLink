package web

import "testing"

func TestEngineBaseURL(t *testing.T) {
	cases := map[string]string{
		"":             "http://127.0.0.1:8317",
		"0.0.0.0":      "http://127.0.0.1:8317",
		"::":           "http://127.0.0.1:8317",
		"[::]":         "http://127.0.0.1:8317",
		"127.0.0.1":    "http://127.0.0.1:8317",
		"192.168.1.50": "http://192.168.1.50:8317",
		"localhost":    "http://localhost:8317",
		"::1":          "http://[::1]:8317",
		"[::1]":        "http://[::1]:8317",
	}
	for host, want := range cases {
		if got := engineBaseURL(host, 8317); got != want {
			t.Errorf("host %q: got %q, want %q", host, got, want)
		}
	}
}
