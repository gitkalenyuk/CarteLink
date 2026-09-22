//go:build windows

// Package desktop opens the native app window. On Windows it hosts the UI in
// an embedded WebView2 (pure Go bindings — no cgo, no shipped DLL); elsewhere
// the caller falls back to opening the default browser.
package desktop

import (
	"errors"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

// Supported reports whether this platform can open a real window.
func Supported() bool { return true }

// ErrClosed is returned by RunMainWindow when the user simply closed the window.
var ErrClosed = errors.New("window closed")

// RunMainWindow opens the desktop window pointed at url and blocks until the
// user closes it. Call it from the locked main OS thread.
func RunMainWindow(url, title, dataPath string) error {
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     true,
		AutoFocus: true,
		DataPath:  dataPath,
		WindowOptions: webview2.WindowOptions{
			Title:  title,
			Width:  1180,
			Height: 800,
			Center: true,
			IconId: 1,
		},
	})
	if w == nil {
		// WebView2 runtime missing or window creation failed — caller falls
		// back to the browser.
		return errors.New("webview window unavailable (WebView2 runtime missing?)")
	}
	defer w.Destroy()
	w.Navigate(url)
	w.Run()
	return ErrClosed
}

// Alert shows a blocking message box (GUI builds have no console to print to).
func Alert(title, text string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	_, _, _ = user32MessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(m)),
		uintptr(unsafe.Pointer(t)),
		0, // MB_OK
	)
}

var user32MessageBoxW = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
