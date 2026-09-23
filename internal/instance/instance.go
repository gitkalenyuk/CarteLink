// Package instance keeps CarteLink single-instance: the running copy writes
// instance.json (pid + port) into its data dir; a second launch asks it to show
// its window over the control API and exits instead of starting a second
// gateway on another port.
package instance

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"cartelgate/internal/config"
)

type record struct {
	PID  int    `json:"pid"`
	Port int    `json:"port"`
	Home string `json:"home"`
}

func path() string { return filepath.Join(config.Home(), "instance.json") }

// Existing returns the pid and port of a live CarteLink using the same data
// dir, or ok=false.
func Existing() (pid, port int, ok bool) {
	raw, err := os.ReadFile(path())
	if err != nil {
		return 0, 0, false
	}
	var r record
	if json.Unmarshal(raw, &r) != nil || r.Port <= 0 {
		return 0, 0, false
	}
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := client.Get("http://127.0.0.1:" + strconv.Itoa(r.Port) + "/api/app/ping")
	if err != nil {
		return 0, 0, false
	}
	defer resp.Body.Close()
	var ping struct {
		App  string `json:"app"`
		Home string `json:"home"`
	}
	if json.NewDecoder(resp.Body).Decode(&ping) != nil || ping.App != config.AppName || ping.Home != config.Home() {
		return 0, 0, false
	}
	return r.PID, r.Port, true
}

// Show asks the running copy on port to bring its window to the front.
func Show(port int) bool {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Post("http://127.0.0.1:"+strconv.Itoa(port)+"/api/app/show", "application/json", nil)
	if err != nil {
		return false
	}
	_ = resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// Register records this process as the running instance.
func Register(port int) {
	b, _ := json.Marshal(record{PID: os.Getpid(), Port: port, Home: config.Home()})
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
