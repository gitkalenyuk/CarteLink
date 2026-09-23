//go:build !windows

package desktop

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// macOS: a LaunchAgent in ~/Library/LaunchAgents. Other Unix: an XDG
// autostart .desktop entry in ~/.config/autostart.

const launchAgentLabel = "link.cartel.cartelink"

func autostartPath() string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	}
	return filepath.Join(home, ".config", "autostart", "cartelink.desktop")
}

func exePath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if abs, err := filepath.EvalSymlinks(exe); err == nil {
		exe = abs
	}
	return exe
}

func xmlEsc(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

func autostartContent() string {
	exe := exePath()
	if runtime.GOOS == "darwin" {
		args := []string{exe, "--minimized"}
		// Inside a .app bundle, launch the bundle so macOS treats it as the app.
		if i := strings.Index(exe, ".app/Contents/MacOS/"); i > 0 {
			args = []string{"/usr/bin/open", "-a", exe[:i+4], "--args", "--minimized"}
		}
		var b strings.Builder
		b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>` + launchAgentLabel + `</string>
	<key>ProgramArguments</key>
	<array>
`)
		for _, a := range args {
			b.WriteString("\t\t<string>" + xmlEsc(a) + "</string>\n")
		}
		b.WriteString(`	</array>
	<key>RunAtLoad</key><true/>
</dict>
</plist>
`)
		return b.String()
	}
	return "[Desktop Entry]\nType=Application\nName=CarteLink\nExec=\"" + exe + "\" --minimized\nX-GNOME-Autostart-enabled=true\n"
}

// AutostartEnabled reports whether CarteLink starts at login.
func AutostartEnabled() bool {
	_, err := os.Stat(autostartPath())
	return err == nil
}

// SetAutostart writes or removes the login item.
func SetAutostart(on bool) error {
	p := autostartPath()
	if !on {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, []byte(autostartContent()), 0o644)
}

// RefreshAutostart re-points an existing entry at the running executable.
func RefreshAutostart() {
	if !AutostartEnabled() {
		return
	}
	if cur, err := os.ReadFile(autostartPath()); err == nil && string(cur) != autostartContent() {
		_ = SetAutostart(true)
	}
}
