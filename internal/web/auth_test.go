package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"cartelgate/internal/config"
)

// fakeBroker answers /api/auth/verify with the given JSON and records the
// appId the client sent.
func fakeBroker(t *testing.T, status int, reply string, gotApp *string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if gotApp != nil {
			*gotApp, _ = body["appId"].(string)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(reply))
	}))
}

func authApp(t *testing.T, lastVerified int64) *App {
	t.Helper()
	t.Setenv("CARTELINK_HOME", t.TempDir())
	cfg := config.Defaults()
	config.Normalize(cfg)
	cfg.Auth.Session = "sess"
	cfg.Auth.LastVerified = lastVerified
	cfg.Auth.User = &config.AuthUser{ID: "1", Name: "Ivan", Username: "ivan"}
	a := NewApp(cfg)
	a.InitAuth()
	return a
}

func withBroker(t *testing.T, url string) {
	old := config.BrokerURL
	config.BrokerURL = url
	t.Cleanup(func() { config.BrokerURL = old })
}

func TestVerifyPrivateKeepsUsername(t *testing.T) {
	var app string
	srv := fakeBroker(t, 200, `{"ok":true,"tier":"private","user":{"id":1,"first_name":null,"username":null}}`, &app)
	defer srv.Close()
	withBroker(t, srv.URL)
	a := authApp(t, 0)
	if !a.VerifyAuthLive() || !a.IsAuthenticated() {
		t.Fatal("private member must be authorized")
	}
	if app != config.AuthAppID {
		t.Errorf("appId sent = %q, want %q", app, config.AuthAppID)
	}
	_, _, u, _ := a.AuthStatus()
	if u == nil || u.Username != "ivan" || u.Name != "Ivan" {
		t.Errorf("user lost after verify: %+v", u)
	}
	if a.snapshotConfig().Auth.LastVerified == 0 {
		t.Error("LastVerified not recorded")
	}
}

func TestVerifyTrialDenied(t *testing.T) {
	srv := fakeBroker(t, 200, `{"ok":true,"tier":"trial","user":{"id":1}}`, nil)
	defer srv.Close()
	withBroker(t, srv.URL)
	a := authApp(t, time.Now().Unix())
	if a.VerifyAuthLive() || a.IsAuthenticated() {
		t.Fatal("trial tier must not be authorized")
	}
	if st, _, _, _ := a.AuthStatus(); st != "denied" {
		t.Errorf("status = %s, want denied", st)
	}
}

func TestVerifyNotMember(t *testing.T) {
	srv := fakeBroker(t, 401, `{"ok":false,"reason":"not_member"}`, nil)
	defer srv.Close()
	withBroker(t, srv.URL)
	a := authApp(t, time.Now().Unix())
	if a.VerifyAuthLive() {
		t.Fatal("non-member authorized")
	}
	if st, _, _, _ := a.AuthStatus(); st != "denied" {
		t.Errorf("status = %s, want denied", st)
	}
}

func TestOfflineGrace(t *testing.T) {
	srv := fakeBroker(t, 502, `bad gateway`, nil)
	defer srv.Close()
	withBroker(t, srv.URL)

	recent := authApp(t, time.Now().Add(-2*time.Hour).Unix())
	if !recent.VerifyAuthLive() {
		t.Error("verified 2h ago + broker down → should stay authorized")
	}
	old := authApp(t, time.Now().Add(-25*time.Hour).Unix())
	if old.VerifyAuthLive() || old.IsAuthenticated() {
		t.Error("verified 25h ago + broker down → must lock")
	}
	if st, _, _, _ := old.AuthStatus(); st != "offline" {
		t.Errorf("status = %s, want offline", st)
	}
	future := authApp(t, time.Now().Add(48*time.Hour).Unix())
	if future.VerifyAuthLive() {
		t.Error("a LastVerified in the future must not grant grace")
	}
}

func TestConfigCannotDisableGate(t *testing.T) {
	cfg := config.Defaults()
	cfg.Auth.Enabled = false
	cfg.Auth.BrokerURL = "http://evil.local"
	config.Normalize(cfg)
	if !cfg.Auth.Enabled || cfg.Auth.BrokerURL != "" {
		t.Fatalf("gate fields not forced: %+v", cfg.Auth)
	}
	t.Setenv("CARTELINK_HOME", t.TempDir())
	a := NewApp(cfg)
	a.InitAuth() // no session
	if a.IsAuthenticated() {
		t.Fatal("no session must not be authorized")
	}
}
