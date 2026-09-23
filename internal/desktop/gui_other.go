//go:build !windows && !(darwin && cgo)

package desktop

import (
	"errors"
	"fmt"
	"os"
)

// Supported reports whether this platform can open a real window. This build
// has no window implementation — the app falls back to a console plus the
// default browser. (macOS gets a native window when built with cgo.)
func Supported() bool { return false }

// TraySupported reports whether closing the window can hide it to a tray icon.
func TraySupported() bool { return false }

// RunMainWindow is unavailable on this platform; the caller falls back.
func RunMainWindow(o Options) error {
	return errors.New("desktop window requires a GUI build")
}

// ShowMainWindow is a no-op without a window.
func ShowMainWindow() {}

// Quit is a no-op without a window.
func Quit() {}

// DetachConsole is a no-op outside Windows.
func DetachConsole() {}

// AllowForeground is a no-op outside Windows.
func AllowForeground(pid int) {}

// Alert prints to stderr (non-GUI builds still have a console).
func Alert(title, text string) {
	fmt.Fprintf(os.Stderr, "%s: %s\n", title, text)
}
