package desktop

import "errors"

// ErrClosed is returned by RunMainWindow when the user closed the app.
var ErrClosed = errors.New("window closed")

// Options configures the main window.
type Options struct {
	URL, Title, DataPath string
	// CloseToTray is consulted on every close: true hides the window to the
	// tray icon, false quits. Read live so the Settings toggle applies at once.
	// Ignored where there is no tray (TraySupported() == false).
	CloseToTray func() bool
	// StartHidden starts in the tray (autostart); ignored without a tray.
	StartHidden bool
}
