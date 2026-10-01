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
	// ShowSwitcher reports whether the floating model switcher should open
	// together with the app (Windows only).
	ShowSwitcher func() bool
	// ToggleSwitcher flips the switcher option (tray menu item).
	ToggleSwitcher func()
	// Lang returns the UI language for tray texts.
	Lang func() string
}

// SwitcherOptions wires the floating model switcher window to the app.
type SwitcherOptions struct {
	// URL returns the switcher page address (read on every show, so a port
	// change after a restart is picked up).
	URL func() string
	// Pos returns the saved window position (ok=false: default corner).
	Pos func() (x, y int, ok bool)
	// OnClose runs when the user closes the window with its close button.
	OnClose func()
	// OnMove runs after the user dragged the window.
	OnMove func(x, y int)
}
