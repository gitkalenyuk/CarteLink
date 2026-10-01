package cliproxy

import (
	"context"
	"sync"
	_ "unsafe" // go:linkname

	// The registry package must be linked in for the linkname below; the SDK
	// already depends on it, this import only documents it.
	_ "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy"
)

// The upstream server binary starts the remote model-catalog updater from its
// own main(); the SDK service does not. Without it the embedded engine only
// knows the models.json compiled into the binary, so new models (Claude Opus
// 5.5, Sonnet 5.5, …) never show up for accounts until CarteLink is rebuilt.
// The updater lives in an internal package, so it is reached by linkname
// instead of editing third_party.
//
//go:linkname startModelsUpdater github.com/router-for-me/CLIProxyAPI/v7/internal/registry.StartModelsUpdater
func startModelsUpdater(ctx context.Context)

var modelsUpdaterOnce sync.Once

// StartModelCatalogUpdater fetches the latest model catalog now and every few
// hours; accounts of providers whose models changed are re-registered by the
// engine. Safe to call more than once (engine restarts): it starts once per
// process.
func StartModelCatalogUpdater(ctx context.Context) {
	modelsUpdaterOnce.Do(func() { startModelsUpdater(ctx) })
}
