package cliproxy

import (
	"context"
	"sync"
	_ "unsafe" // go:linkname

	_ "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy"
)

// Google gates Antigravity models by client version: the engine sends
// "antigravity/hub/<version>" and an old version gets new models (Gemini 4
// Argon / Carbon / Hydrogen) neither listed nor served (404 NOT_FOUND).
// The upstream server binary starts the version updater from its own main();
// the SDK service does not, so the embedded engine stayed on the compiled-in
// fallback version forever. Reached by linkname instead of editing third_party.

//go:linkname refreshAntigravityVersion github.com/router-for-me/CLIProxyAPI/v7/internal/misc.refreshAntigravityVersion
func refreshAntigravityVersion(ctx context.Context)

//go:linkname startAntigravityVersionUpdater github.com/router-for-me/CLIProxyAPI/v7/internal/misc.StartAntigravityVersionUpdater
func startAntigravityVersionUpdater(ctx context.Context)

//go:linkname antigravityLatestVersion github.com/router-for-me/CLIProxyAPI/v7/internal/misc.AntigravityLatestVersion
func antigravityLatestVersion() string

var antigravityVersionOnce sync.Once

// StartAntigravityVersionUpdater fetches the current Antigravity client
// version now (bounded by the engine's own fetch timeout) and keeps it fresh in
// the background. Call it before the engine starts, so accounts are registered
// and their model lists probed with the current version. Starts once per process.
func StartAntigravityVersionUpdater(ctx context.Context) {
	antigravityVersionOnce.Do(func() {
		refreshAntigravityVersion(ctx)
		startAntigravityVersionUpdater(ctx)
	})
}

// AntigravityClientVersion is the version the engine currently presents.
func AntigravityClientVersion() string { return antigravityLatestVersion() }
