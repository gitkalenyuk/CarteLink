//go:build windows

package desktop

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`
const runValue = "CarteLink"

func autostartCommand() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if abs, err := filepath.EvalSymlinks(exe); err == nil {
		exe = abs
	}
	return `"` + exe + `" --minimized`, nil
}

// AutostartEnabled reports whether CarteLink starts with Windows (HKCU Run).
func AutostartEnabled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	_, _, err = k.GetStringValue(runValue)
	return err == nil
}

// SetAutostart adds or removes the per-user Run entry (no admin rights).
func SetAutostart(on bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !on {
		if err := k.DeleteValue(runValue); err != nil && err != registry.ErrNotExist {
			return err
		}
		return nil
	}
	cmd, err := autostartCommand()
	if err != nil {
		return err
	}
	return k.SetStringValue(runValue, cmd)
}

// RefreshAutostart re-points an existing entry at the running exe (the user
// may have moved or renamed it). No-op when autostart is off.
func RefreshAutostart() {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return
	}
	defer k.Close()
	cur, _, err := k.GetStringValue(runValue)
	if err != nil {
		return
	}
	if want, err := autostartCommand(); err == nil && cur != want {
		_ = k.SetStringValue(runValue, want)
	}
}
