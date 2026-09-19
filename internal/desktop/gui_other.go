//go:build !windows

package desktop

import (
	"errors"
	"fmt"
	"os"
)

// Supported reports whether this platform can open a real window. Non-Windows
// builds have no window implementation here — the app falls back to a console
// plus the default browser.
func Supported() bool { return false }

// ErrClosed mirrors the Windows variant (never returned on this platform).
var ErrClosed = errors.New("window closed")

// RunMainWindow is unavailable on this platform; the caller falls back.
func RunMainWindow(url, title, dataPath string) error {
	return errors.New("desktop window requires a GUI build (Windows)")
}

// Alert prints to stderr (non-GUI builds still have a console).
func Alert(title, text string) {
	fmt.Fprintf(os.Stderr, "%s: %s\n", title, text)
}
