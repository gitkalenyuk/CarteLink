package instance

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"sync/atomic"
	"testing"

	"cartelgate/internal/config"
)

// fakeCopy answers like a running CarteLink and counts /api/app/show calls.
func fakeCopy(t *testing.T) (port int, shows *atomic.Int32) {
	t.Helper()
	shows = &atomic.Int32{}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/app/ping", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"app": config.AppName, "home": config.Home()})
	})
	mux.HandleFunc("/api/app/show", func(w http.ResponseWriter, r *http.Request) { shows.Add(1) })
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	_, p, err := net.SplitHostPort(srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, _ = strconv.Atoi(p)
	return port, shows
}

func TestExistingAndShowUseTheRegisteredHost(t *testing.T) {
	cases := []struct{ host, wantHost string }{
		{"127.0.0.1", "127.0.0.1"},
		{"0.0.0.0", "127.0.0.1"},
		{"::", "127.0.0.1"},
		{"", "127.0.0.1"},
		{"localhost", "localhost"},
	}
	for _, c := range cases {
		t.Setenv("CARTELINK_HOME", t.TempDir())
		port, shows := fakeCopy(t)
		Register(c.host, port)
		_, addr, ok := Existing()
		if !ok {
			t.Fatalf("host %q: running copy not found", c.host)
		}
		if want := net.JoinHostPort(c.wantHost, strconv.Itoa(port)); addr != want {
			t.Errorf("host %q: addr %q, want %q", c.host, addr, want)
		}
		if !Show(addr) || shows.Load() != 1 {
			t.Errorf("host %q: show did not reach the copy", c.host)
		}
	}
}

// instance.json of an older version has no host: such a copy is on loopback.
func TestExistingReadsOldRecord(t *testing.T) {
	t.Setenv("CARTELINK_HOME", t.TempDir())
	port, _ := fakeCopy(t)
	raw, _ := json.Marshal(map[string]any{"pid": 1, "port": port, "home": config.Home()})
	if err := os.WriteFile(path(), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := Existing(); !ok {
		t.Fatal("copy from an old record not found")
	}
}

func TestExistingNothingRunning(t *testing.T) {
	t.Setenv("CARTELINK_HOME", t.TempDir())
	if _, _, ok := Existing(); ok {
		t.Fatal("no record, yet a copy was found")
	}
	Register("127.0.0.1", 1)
	if _, _, ok := Existing(); ok {
		t.Fatal("nothing listens, yet a copy was found")
	}
}
