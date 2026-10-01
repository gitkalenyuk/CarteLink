//go:build !windows

package desktop

// SwitcherSupported reports whether the floating switcher can be shown. Only
// the Windows build has it; elsewhere the UI hides the option.
func SwitcherSupported() bool { return false }

// ConfigureSwitcher is a no-op without the Windows window.
func ConfigureSwitcher(o SwitcherOptions) {}

// SetSwitcherVisible is a no-op without the Windows window.
func SetSwitcherVisible(show bool) {}
