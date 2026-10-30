// Package instance keeps CarteLink single-instance: the running copy writes
// instance.json (pid + port) into its data dir; a second launch asks it to show
// its window over the control API and exits instead of starting a second
// gateway on another port.
package instance

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"cartelgate/internal/config"
)

type record struct {
	PID  int    `json:"pid"`
	Host string `json:"host,omitempty"` // empty in records of older versions
	Port int    `json:"port"`
	Home string `json:"home"`
}

func path() string { return filepath.Join(config.Home(), "instance.json") }

// Existing returns the pid and address of a live CarteLink using the same data
// dir, or ok=false.
func Existing() (pid int, addr string, ok bool) {
	raw, err := os.ReadFile(path())
	if err != nil {
		return 0, "", false
	}
	var r record
	if json.Unmarshal(raw, &r) != nil || r.Port <= 0 {
		return 0, "", false
	}
	addr = net.JoinHostPort(strings.Trim(config.DisplayHost(r.Host), "[]"), strconv.Itoa(r.Port))
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := client.Get("http://" + addr + "/api/app/ping")
	if err != nil {
		return 0, "", false
	}
	defer resp.Body.Close()
	var ping struct {
		App  string `json:"app"`
		Home string `json:"home"`
	}
	if json.NewDecoder(resp.Body).Decode(&ping) != nil || ping.App != config.AppName || ping.Home != config.Home() {
		return 0, "", false
	}
	return r.PID, addr, true
}

// Show asks the running copy at addr to bring its window to the front.
func Show(addr string) bool {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Post("http://"+addr+"/api/app/show", "application/json", nil)
	if err != nil {
		return false
	}
	_ = resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// Register records this process as the running instance, reachable on the
// configured bind host (the engine listens on nothing else) and port.
func Register(host string, port int) {
	b, _ := json.Marshal(record{PID: os.Getpid(), Host: host, Port: port, Home: config.Home()})
	_ = os.MkdirAll(config.Home(), 0o755)
	_ = config.WriteFileAtomic(path(), b)
}

// Unregister removes the record if it still points at this process.
func Unregister() {
	raw, err := os.ReadFile(path())
	if err != nil {
		return
	}
	var r record
	if json.Unmarshal(raw, &r) == nil && r.PID == os.Getpid() {
		_ = os.Remove(path())
	}
}
