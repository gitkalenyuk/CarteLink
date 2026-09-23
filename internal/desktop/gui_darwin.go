//go:build darwin && cgo

// macOS: the UI runs in a native WKWebView window (github.com/webview/webview_go,
// cgo — needs the Xcode Command Line Tools). There is no tray here: closing
// the window quits the app, the Dock icon and Cmd+Q behave as usual.
package desktop

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>
#import <Cocoa/Cocoa.h>

static void cl_show(void *win) {
	[NSApp activateIgnoringOtherApps:YES];
	NSWindow *w = (NSWindow *)win;
	if ([w isMiniaturized]) [w deminiaturize:nil];
	[w makeKeyAndOrderFront:nil];
}

static void cl_minimize(void *win) {
	[(NSWindow *)win miniaturize:nil];
}

// WKWebView only gets Cmd+C / Cmd+V / Cmd+A when the app has an Edit menu —
// webview creates none, so build the standard App + Edit menus.
static void cl_menus(const char *appName) {
	NSString *name = [NSString stringWithUTF8String:appName];
	NSMenu *bar = [[NSMenu alloc] init];

	NSMenuItem *appItem = [[NSMenuItem alloc] init];
	NSMenu *appMenu = [[NSMenu alloc] initWithTitle:name];
	[appMenu addItemWithTitle:[@"Сховати " stringByAppendingString:name] action:@selector(hide:) keyEquivalent:@"h"];
	[appMenu addItem:[NSMenuItem separatorItem]];
	[appMenu addItemWithTitle:[@"Вийти з " stringByAppendingString:name] action:@selector(terminate:) keyEquivalent:@"q"];
	[appItem setSubmenu:appMenu];
	[bar addItem:appItem];

	NSMenuItem *editItem = [[NSMenuItem alloc] init];
	NSMenu *edit = [[NSMenu alloc] initWithTitle:@"Редагування"];
	[edit addItemWithTitle:@"Скасувати" action:@selector(undo:) keyEquivalent:@"z"];
	[edit addItemWithTitle:@"Повторити" action:@selector(redo:) keyEquivalent:@"Z"];
	[edit addItem:[NSMenuItem separatorItem]];
	[edit addItemWithTitle:@"Вирізати" action:@selector(cut:) keyEquivalent:@"x"];
	[edit addItemWithTitle:@"Копіювати" action:@selector(copy:) keyEquivalent:@"c"];
	[edit addItemWithTitle:@"Вставити" action:@selector(paste:) keyEquivalent:@"v"];
	[edit addItemWithTitle:@"Виділити все" action:@selector(selectAll:) keyEquivalent:@"a"];
	[editItem setSubmenu:edit];
	[bar addItem:editItem];

	[NSApp setMainMenu:bar];
}
*/
import "C"

import (
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"unsafe"

	webview "github.com/webview/webview_go"
)

// Supported reports whether this platform can open a real window.
func Supported() bool { return true }

// TraySupported: no tray on macOS (the Dock icon plays that role).
func TraySupported() bool { return false }

var (
	mu      sync.Mutex
	current webview.WebView
)

// RunMainWindow opens the native window and blocks until it is closed.
// Must be called on the main thread (main.go locks it in init).
func RunMainWindow(o Options) error {
	w := webview.New(false)
	if w == nil {
		return fmt.Errorf("could not create the WebKit window")
	}
	defer w.Destroy()
	w.SetTitle(o.Title)
	w.SetSize(1180, 800, webview.HintNone)
	name := C.CString(o.Title)
	C.cl_menus(name)
	C.free(unsafe.Pointer(name))
	mu.Lock()
	current = w
	mu.Unlock()
	w.Navigate(o.URL)
	if o.StartHidden {
		C.cl_minimize(w.Window())
	}
	w.Run()
	mu.Lock()
	current = nil
	mu.Unlock()
	return ErrClosed
}

// ShowMainWindow brings the window to the front. Safe from any goroutine.
func ShowMainWindow() {
	mu.Lock()
	w := current
	mu.Unlock()
	if w == nil {
		return
	}
	w.Dispatch(func() { C.cl_show(w.Window()) })
}

// Quit ends RunMainWindow. Safe from any goroutine.
func Quit() {
	mu.Lock()
	w := current
	mu.Unlock()
	if w != nil {
		w.Dispatch(func() { w.Terminate() })
	}
}

// DetachConsole is a no-op on macOS.
func DetachConsole() {}

// AllowForeground is a no-op on macOS.
func AllowForeground(pid int) {}

// Alert shows a modal dialog through osascript (safe from any goroutine,
// works before the window exists).
func Alert(title, text string) {
	q := func(s string) string {
		return `"` + strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `"`, `\"`) + `"`
	}
	_ = exec.Command("osascript", "-e",
		"display dialog "+q(text)+" with title "+q(title)+` buttons {"OK"} default button "OK"`).Run()
}
