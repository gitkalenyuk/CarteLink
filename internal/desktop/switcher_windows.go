//go:build windows

package desktop

import (
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

// The floating model switcher: a small always-on-top tool window with its
// own WebView2 showing /ui/switcher.html. It lives on the main UI thread next
// to the main window and is never destroyed while the app runs — closing it
// only hides it (destroying a go-webview2 window would post WM_QUIT and end
// the whole app).

var (
	procSetWindowPos        = user32.NewProc("SetWindowPos")
	procGetWindowRect       = user32.NewProc("GetWindowRect")
	procGetSystemMetrics    = user32.NewProc("GetSystemMetrics")
	procSystemParametersInf = user32.NewProc("SystemParametersInfoW")
	procGetDpiForWindow     = user32.NewProc("GetDpiForWindow")
	procDwmSetWindowAttr    = syscall.NewLazyDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")

	swOpts    SwitcherOptions
	swView    webview2.WebView
	swHwnd    uintptr
	swOldProc uintptr
	swURL     string
)

const (
	gwlStyle          = ^uintptr(15) // -16
	gwlExStyle        = ^uintptr(19) // -20
	gwlpWndProc       = ^uintptr(3)  // -4
	wsPopup           = 0x80000000
	wsVisible         = 0x10000000
	wsCaption         = 0x00C00000
	wsSysMenu         = 0x00080000
	wsExToolWindow    = 0x00000080
	wsExTopmost       = 0x00000008
	swpNoActivate     = 0x0010
	swpFrameChanged   = 0x0020
	swpShowWindow     = 0x0040
	swShowNoActivate  = 4
	wmExitSizeMove    = 0x0232
	spiGetWorkArea    = 0x0030
	smXVirtualScreen  = 76
	smYVirtualScreen  = 77
	smCXVirtualScreen = 78
	smCYVirtualScreen = 79
	hwndTopmost       = ^uintptr(0) // -1

	switcherW = 316 // logical pixels (96 dpi)
	switcherH = 292
)

type rect struct{ Left, Top, Right, Bottom int32 }

// SwitcherSupported reports whether the floating switcher can be shown.
func SwitcherSupported() bool { return true }

// ConfigureSwitcher sets the switcher callbacks; call before RunMainWindow.
func ConfigureSwitcher(o SwitcherOptions) { swOpts = o }

// SetSwitcherVisible shows or hides the floating switcher. Safe from any
// goroutine; a no-op until the main window exists.
func SetSwitcherVisible(show bool) {
	mu.Lock()
	w := current
	mu.Unlock()
	if w == nil {
		return
	}
	w.Dispatch(func() {
		if show {
			openSwitcher()
		} else if swHwnd != 0 {
			_, _, _ = procShowWindow.Call(swHwnd, swHide)
		}
	})
}

// openSwitcher runs on the UI thread.
func openSwitcher() {
	u := ""
	if swOpts.URL != nil {
		u = swOpts.URL()
	}
	if swHwnd != 0 {
		if u != "" && u != swURL {
			swURL = u
			swView.Navigate(u)
		}
		_, _, _ = procShowWindow.Call(swHwnd, swShowNoActivate)
		_, _, _ = procSetWindowPos.Call(swHwnd, hwndTopmost, 0, 0, 0, 0, 0x0001|0x0002|swpNoActivate) // NOSIZE|NOMOVE
		return
	}
	v := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: false,
		DataPath:  opts.DataPath,
		WindowOptions: webview2.WindowOptions{
			Title:  "CarteLink",
			Width:  switcherW,
			Height: switcherH,
			IconId: 1,
		},
	})
	if v == nil {
		return
	}
	hwnd := uintptr(v.Window())
	swView, swHwnd = v, hwnd
	swOldProc, _, _ = procSetWindowLongPtrW.Call(hwnd, gwlpWndProc, syscall.NewCallback(switcherProc))
	_, _, _ = procSetWindowLongPtrW.Call(hwnd, gwlStyle, wsPopup|wsCaption|wsSysMenu|wsVisible)
	_, _, _ = procSetWindowLongPtrW.Call(hwnd, gwlExStyle, wsExToolWindow|wsExTopmost)
	dark := int32(1)
	_, _, _ = procDwmSetWindowAttr.Call(hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, uintptr(unsafe.Pointer(&dark)), 4)

	scale := 1.0
	if procGetDpiForWindow.Find() == nil {
		if dpi, _, _ := procGetDpiForWindow.Call(hwnd); dpi > 0 {
			scale = float64(dpi) / 96
		}
	}
	w, h := int32(float64(switcherW)*scale), int32(float64(switcherH)*scale)
	x, y := switcherPos(w, h)
	_, _, _ = procSetWindowPos.Call(hwnd, hwndTopmost, uintptr(x), uintptr(y), uintptr(w), uintptr(h),
		swpFrameChanged|swpShowWindow|swpNoActivate)
	swURL = u
	v.Navigate(u)
}

// switcherPos returns the saved position when it is still on a screen,
// otherwise the top-right corner of the work area.
func switcherPos(w, h int32) (int32, int32) {
	if swOpts.Pos != nil {
		if x, y, ok := swOpts.Pos(); ok {
			vx, _, _ := procGetSystemMetrics.Call(smXVirtualScreen)
			vy, _, _ := procGetSystemMetrics.Call(smYVirtualScreen)
			vw, _, _ := procGetSystemMetrics.Call(smCXVirtualScreen)
			vh, _, _ := procGetSystemMetrics.Call(smCYVirtualScreen)
			left, top := int32(vx), int32(vy)
			right, bottom := left+int32(vw), top+int32(vh)
			if int32(x) >= left-w/2 && int32(x)+w/2 <= right && int32(y) >= top && int32(y)+40 <= bottom {
				return int32(x), int32(y)
			}
		}
	}
	var wa rect
	_, _, _ = procSystemParametersInf.Call(spiGetWorkArea, 0, uintptr(unsafe.Pointer(&wa)), 0)
	if wa.Right <= wa.Left {
		return 40, 40
	}
	return wa.Right - w - 24, wa.Top + 24
}

func switcherProc(hwnd, msg, wp, lp uintptr) uintptr {
	switch msg {
	case wmClose:
		_, _, _ = procShowWindow.Call(hwnd, swHide)
		if swOpts.OnClose != nil {
			go swOpts.OnClose()
		}
		return 0
	case wmDestroy:
		// Never let go-webview2 see this: it would PostQuitMessage and
		// close the whole app.
		return 0
	case wmExitSizeMove:
		var r rect
		_, _, _ = procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
		if swOpts.OnMove != nil {
			x, y := int(r.Left), int(r.Top)
			go swOpts.OnMove(x, y)
		}
	}
	ret, _, _ := procCallWindowProcW.Call(swOldProc, hwnd, msg, wp, lp)
	return ret
}
