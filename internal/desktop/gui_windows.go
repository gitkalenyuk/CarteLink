//go:build windows

// Package desktop opens the native app window. On Windows it hosts the UI in
// an embedded WebView2 (pure Go bindings — no cgo, no shipped DLL) and keeps
// a tray icon, so closing the window can hide the app instead of quitting.
package desktop

import (
	"errors"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

// Supported reports whether this platform can open a real window.
func Supported() bool { return true }

// TraySupported reports whether closing the window can hide it to a tray icon.
func TraySupported() bool { return true }

var (
	user32  = syscall.NewLazyDLL("user32.dll")
	shell32 = syscall.NewLazyDLL("shell32.dll")

	procMessageBoxW            = user32.NewProc("MessageBoxW")
	procSetWindowLongPtrW      = user32.NewProc("SetWindowLongPtrW")
	procCallWindowProcW        = user32.NewProc("CallWindowProcW")
	procShowWindow             = user32.NewProc("ShowWindow")
	procIsIconic               = user32.NewProc("IsIconic")
	procSetForegroundWindow    = user32.NewProc("SetForegroundWindow")
	procAllowSetForegroundWin  = user32.NewProc("AllowSetForegroundWindow")
	procPostMessageW           = user32.NewProc("PostMessageW")
	procCreatePopupMenu        = user32.NewProc("CreatePopupMenu")
	procAppendMenuW            = user32.NewProc("AppendMenuW")
	procTrackPopupMenu         = user32.NewProc("TrackPopupMenu")
	procDestroyMenu            = user32.NewProc("DestroyMenu")
	procGetCursorPos           = user32.NewProc("GetCursorPos")
	procLoadImageW             = user32.NewProc("LoadImageW")
	procRegisterWindowMessageW = user32.NewProc("RegisterWindowMessageW")
	procShellNotifyIconW       = shell32.NewProc("Shell_NotifyIconW")
	procGetModuleHandleW       = syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW")
)

const (
	wmClose        = 0x0010
	wmDestroy      = 0x0002
	wmApp          = 0x8000
	wmTray         = wmApp + 7
	wmLButtonUp    = 0x0202
	wmLButtonDbl   = 0x0203
	wmRButtonUp    = 0x0205
	swHide         = 0
	swShow         = 5
	swRestore      = 9
	nimAdd         = 0
	nimModify      = 1
	nimDelete      = 2
	nifMessage     = 0x1
	nifIcon        = 0x2
	nifTip         = 0x4
	nifInfo        = 0x10
	tpmReturnCmd   = 0x0100
	tpmRightButton = 0x0002
	mfString       = 0x0
	mfSeparator    = 0x800
	menuOpen       = 1
	menuQuit       = 2
)

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         [16]byte
	HBalloonIcon     uintptr
}

type point struct{ X, Y int32 }

var (
	mu             sync.Mutex
	current        webview2.WebView
	mainHwnd       uintptr
	oldProc        uintptr
	trayOn         bool
	quitting       atomic.Bool
	hintShown      atomic.Bool
	taskbarCreated uintptr
	opts           Options
)

// RunMainWindow opens the desktop window and blocks until the app quits.
// Call it from the locked main OS thread.
func RunMainWindow(o Options) error {
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     true, // keeps the right-click Copy/Paste menu
		AutoFocus: true,
		DataPath:  o.DataPath,
		WindowOptions: webview2.WindowOptions{
			Title:  o.Title,
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
	hwnd := uintptr(w.Window())
	mu.Lock()
	current, mainHwnd, opts = w, hwnd, o
	mu.Unlock()

	name, _ := syscall.UTF16PtrFromString("TaskbarCreated")
	taskbarCreated, _, _ = procRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(name)))
	oldProc, _, _ = procSetWindowLongPtrW.Call(hwnd, ^uintptr(3) /* GWLP_WNDPROC = -4 */, syscall.NewCallback(subclassProc))
	trayOn = addTrayIcon(hwnd)

	w.Navigate(o.URL)
	if o.StartHidden && trayOn {
		_, _, _ = procShowWindow.Call(hwnd, swHide)
	}
	w.Run()
	removeTrayIcon(hwnd)
	mu.Lock()
	current, mainHwnd = nil, 0
	mu.Unlock()
	return ErrClosed
}

// ShowMainWindow brings the window back (from the tray or behind other
// windows). Safe to call from any goroutine.
func ShowMainWindow() {
	mu.Lock()
	w, hwnd := current, mainHwnd
	mu.Unlock()
	if w == nil {
		return
	}
	w.Dispatch(func() { showWindow(hwnd) })
}

// Quit closes the window and ends RunMainWindow. Safe from any goroutine.
func Quit() {
	mu.Lock()
	hwnd := mainHwnd
	mu.Unlock()
	if hwnd != 0 {
		quitting.Store(true)
		_, _, _ = procPostMessageW.Call(hwnd, wmClose, 0, 0)
	}
}

// DetachConsole frees any console window the process inherited.
func DetachConsole() {
	_, _, _ = syscall.NewLazyDLL("kernel32.dll").NewProc("FreeConsole").Call()
}

// AllowForeground lets the process pid (an already running CarteLink) take
// the foreground when a second copy asks it to show its window.
func AllowForeground(pid int) {
	_, _, _ = procAllowSetForegroundWin.Call(uintptr(pid))
}

func showWindow(hwnd uintptr) {
	if r, _, _ := procIsIconic.Call(hwnd); r != 0 {
		_, _, _ = procShowWindow.Call(hwnd, swRestore)
	} else {
		_, _, _ = procShowWindow.Call(hwnd, swShow)
	}
	_, _, _ = procSetForegroundWindow.Call(hwnd)
}

func subclassProc(hwnd, msg, wp, lp uintptr) uintptr {
	switch {
	case msg == wmClose:
		if !quitting.Load() && trayOn && opts.CloseToTray != nil && opts.CloseToTray() {
			_, _, _ = procShowWindow.Call(hwnd, swHide)
			if hintShown.CompareAndSwap(false, true) {
				balloon(hwnd, "CarteLink працює у фоні", "Шлюз далі працює. Відкрити вікно — клік по значку в треї; вийти — правий клік → «Вийти».")
			}
			return 0
		}
	case msg == wmDestroy:
		removeTrayIcon(hwnd)
	case msg == wmTray:
		switch lp & 0xffff {
		case wmLButtonUp, wmLButtonDbl:
			showWindow(hwnd)
		case wmRButtonUp:
			trayMenu(hwnd)
		}
		return 0
	case taskbarCreated != 0 && msg == taskbarCreated:
		// Explorer restarted — the icon has to be added again.
		trayOn = addTrayIcon(hwnd)
	}
	r, _, _ := procCallWindowProcW.Call(oldProc, hwnd, msg, wp, lp)
	return r
}

func trayMenu(hwnd uintptr) {
	menu, _, _ := procCreatePopupMenu.Call()
	if menu == 0 {
		return
	}
	defer procDestroyMenu.Call(menu)
	open, _ := syscall.UTF16PtrFromString("Відкрити CarteLink")
	quit, _ := syscall.UTF16PtrFromString("Вийти")
	_, _, _ = procAppendMenuW.Call(menu, mfString, menuOpen, uintptr(unsafe.Pointer(open)))
	_, _, _ = procAppendMenuW.Call(menu, mfSeparator, 0, 0)
	_, _, _ = procAppendMenuW.Call(menu, mfString, menuQuit, uintptr(unsafe.Pointer(quit)))
	var pt point
	_, _, _ = procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	// The owner must be foreground or the menu will not close on click-away.
	_, _, _ = procSetForegroundWindow.Call(hwnd)
	cmd, _, _ := procTrackPopupMenu.Call(menu, tpmReturnCmd|tpmRightButton, uintptr(pt.X), uintptr(pt.Y), 0, hwnd, 0)
	switch cmd {
	case menuOpen:
		showWindow(hwnd)
	case menuQuit:
		quitting.Store(true)
		_, _, _ = procPostMessageW.Call(hwnd, wmClose, 0, 0)
	}
}

func iconData(hwnd uintptr) *notifyIconData {
	nid := &notifyIconData{HWnd: hwnd, UID: 1}
	nid.CbSize = uint32(unsafe.Sizeof(*nid))
	return nid
}

func addTrayIcon(hwnd uintptr) bool {
	hinst, _, _ := procGetModuleHandleW.Call(0)
	icon, _, _ := procLoadImageW.Call(hinst, 1 /* resource id */, 1 /* IMAGE_ICON */, 16, 16, 0)
	nid := iconData(hwnd)
	nid.UFlags = nifMessage | nifIcon | nifTip
	nid.UCallbackMessage = wmTray
	nid.HIcon = icon
	copyUTF16(nid.SzTip[:], "CarteLink — AI-шлюз працює")
	r, _, _ := procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(nid)))
	return r != 0
}

func removeTrayIcon(hwnd uintptr) {
	if !trayOn {
		return
	}
	trayOn = false
	_, _, _ = procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(iconData(hwnd))))
}

func balloon(hwnd uintptr, title, text string) {
	nid := iconData(hwnd)
	nid.UFlags = nifInfo
	copyUTF16(nid.SzInfoTitle[:], title)
	copyUTF16(nid.SzInfo[:], text)
	_, _, _ = procShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(nid)))
}

func copyUTF16(dst []uint16, s string) {
	u, _ := syscall.UTF16FromString(s)
	if len(u) > len(dst) {
		u = u[:len(dst)]
		u[len(u)-1] = 0
	}
	copy(dst, u)
}

// Alert shows a blocking message box (GUI builds have no console to print to).
func Alert(title, text string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	_, _, _ = procMessageBoxW.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0)
}
