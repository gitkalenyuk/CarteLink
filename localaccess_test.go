package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// gateEngine stands in for the engine: every route answers 200 unless the gate
// stops the request, and NoRoute goes through the gate like a real route.
func gateEngine() *gin.Engine {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(func(c *gin.Context) {
		if !localOnlyGate(c) {
			return
		}
		c.Next()
	})
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	e.Any("/api/*path", ok)
	e.Any("/ui/*path", ok)
	e.Any("/v0/management/*path", ok)
	e.Any("/v1/*path", ok)
	e.Any("/v1beta/*path", ok)
	e.GET("/healthz", ok)
	e.GET("/", ok)
	e.NoRoute(ok)
	return e
}

func gateStatus(e *gin.Engine, method, path, remote, local string, hdr map[string]string) int {
	r := httptest.NewRequest(method, "http://192.168.1.50:8317"+path, nil)
	r.RemoteAddr = remote
	if local != "" {
		addr, err := net.ResolveTCPAddr("tcp", local)
		if err != nil {
			panic(err)
		}
		r = r.WithContext(context.WithValue(r.Context(), http.LocalAddrContextKey, addr))
	}
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.ServeHTTP(w, r)
	return w.Code
}

func TestLocalOnlyGateFromAnotherComputer(t *testing.T) {
	e := gateEngine()
	const remote, local = "192.168.1.77:50000", "192.168.1.50:8317"
	closed := []string{
		"/", "/api/config", "/api/scoped-keys", "/api/app/ping", "/ui/", "/ui/index.html",
		"/ui/switcher.html", "/v0/management/config", "/v0/management/oauth-callback",
		"/v0/resource/plugins/x/console", "/management.html", "/keep-alive",
		"/anthropic/callback", "/codex/callback", "/callback", "/some-future-route",
		"/%61pi/config", "/API/config", "//api/config", "/v1x/api", "/v1betax/api",
	}
	for _, p := range closed {
		for _, m := range []string{http.MethodGet, http.MethodPost, http.MethodOptions} {
			if got := gateStatus(e, m, p, remote, local, nil); got != http.StatusForbidden {
				t.Errorf("%s %s: got %d, want 403", m, p, got)
			}
		}
	}
	open := []string{
		"/v1/chat/completions", "/v1/messages", "/v1/models", "/v1/responses", "/v1beta/models",
		"/models", "/openai/v1/videos", "/backend-api/codex/responses", "/healthz",
	}
	for _, p := range open {
		if got := gateStatus(e, http.MethodGet, p, remote, local, nil); got != http.StatusOK {
			t.Errorf("GET %s: got %d, want 200", p, got)
		}
	}
}

func TestLocalOnlyGateIgnoresClientHeaders(t *testing.T) {
	e := gateEngine()
	hdr := map[string]string{
		"Host": "127.0.0.1:8317", "X-Forwarded-For": "127.0.0.1", "X-Real-IP": "127.0.0.1",
		"Forwarded": "for=127.0.0.1", "Origin": "http://127.0.0.1:8317", "Sec-Fetch-Site": "same-origin",
	}
	if got := gateStatus(e, http.MethodGet, "/api/config", "192.168.1.77:50000", "192.168.1.50:8317", hdr); got != http.StatusForbidden {
		t.Fatalf("spoofed headers: got %d, want 403", got)
	}
}

// The local callers that must keep working: the window, the second launch
// (instance.Existing/Show), refreshModelCatalog and the management proxy.
func TestLocalOnlyGateFromThisComputer(t *testing.T) {
	e := gateEngine()
	locals := []struct{ remote, local string }{
		{"127.0.0.1:50000", "127.0.0.1:8317"},
		{"[::1]:50000", "[::1]:8317"},
		{"[::ffff:127.0.0.1]:50000", "127.0.0.1:8317"},
		{"127.0.0.2:50000", "127.0.0.1:8317"},
		// Host set to one LAN address: the client side is that address as well.
		{"192.168.1.50:50000", "192.168.1.50:8317"},
		{"[2001:db8::5]:50000", "[2001:db8::5]:8317"},
	}
	for _, c := range locals {
		for _, p := range []string{"/", "/ui/", "/api/app/ping", "/api/config", "/v0/management/config", "/v1/models"} {
			if got := gateStatus(e, http.MethodGet, p, c.remote, c.local, nil); got != http.StatusOK {
				t.Errorf("%s -> %s %s: got %d, want 200", c.remote, c.local, p, got)
			}
		}
	}
}

// The engine decides "local" by c.ClientIP(): only this computer may look local
// to it, and only when it really is this computer.
func TestLocalOnlyGateClientIPSeenByEngine(t *testing.T) {
	gin.SetMode(gin.TestMode)
	seen := ""
	e := gin.New()
	e.Use(func(c *gin.Context) {
		if !localOnlyGate(c) {
			return
		}
		c.Next()
	})
	e.GET("/v0/management/config", func(c *gin.Context) { seen = c.ClientIP() })
	e.GET("/v1/models", func(c *gin.Context) { seen = c.ClientIP() })

	cases := []struct{ path, remote, local, want string }{
		{"/v0/management/config", "192.168.1.50:50000", "192.168.1.50:8317", "127.0.0.1"},
		{"/v0/management/config", "[2001:db8::5]:50000", "[2001:db8::5]:8317", "127.0.0.1"},
		{"/v0/management/config", "127.0.0.1:50000", "127.0.0.1:8317", "127.0.0.1"},
		{"/v0/management/config", "[::1]:50000", "[::1]:8317", "::1"},
		{"/v1/models", "192.168.1.50:50000", "192.168.1.50:8317", "127.0.0.1"},
		{"/v1/models", "192.168.1.77:50000", "192.168.1.50:8317", "192.168.1.77"},
		{"/v0/management/config", "192.168.1.77:50000", "192.168.1.50:8317", ""},
	}
	for _, c := range cases {
		seen = ""
		gateStatus(e, http.MethodGet, c.path, c.remote, c.local, nil)
		if seen != c.want {
			t.Errorf("%s from %s: engine saw %q, want %q", c.path, c.remote, seen, c.want)
		}
	}
}

func TestIsLocalClientFailsClosed(t *testing.T) {
	cases := []struct{ name, remote, local string }{
		{"another computer", "192.168.1.77:50000", "192.168.1.50:8317"},
		{"another address of this subnet over IPv6", "[2001:db8::6]:50000", "[2001:db8::5]:8317"},
		{"no local address known", "192.168.1.50:50000", ""},
		{"empty remote address", "", "192.168.1.50:8317"},
		{"remote address without a port", "127.0.0.1", "127.0.0.1:8317"},
		{"remote address is not an IP", "localhost:50000", "127.0.0.1:8317"},
	}
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodGet, "/api/config", nil)
		r.RemoteAddr = c.remote
		if c.local != "" {
			addr, err := net.ResolveTCPAddr("tcp", c.local)
			if err != nil {
				t.Fatal(err)
			}
			r = r.WithContext(context.WithValue(r.Context(), http.LocalAddrContextKey, addr))
		}
		if isLocalClient(r) {
			t.Errorf("%s: treated as local", c.name)
		}
	}
}

// The real server fills the socket addresses itself: nothing here is set by hand.
func TestLocalOnlyGateOverRealSocket(t *testing.T) {
	srv := httptest.NewServer(gateEngine())
	defer srv.Close()
	for _, p := range []string{"/api/app/ping", "/ui/", "/v1/models"} {
		resp, err := http.Get(srv.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("loopback %s: got %d, want 200", p, resp.StatusCode)
		}
	}
}
