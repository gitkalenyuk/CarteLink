# VisionGateGo

One process. One port. One window.

The original [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) source code
is compiled directly into this binary — the engine IS the server. VisionGate's dark
UI is mounted on the same Gin engine, and on Windows the exe opens a native desktop
window (WebView2) pointed at it. Closing the window quits the app.

## What's inside

| Path | What it is |
|---|---|
| `third_party/CLIProxyAPI/` | The full CLIProxyAPI source (unmodified, MIT) |
| `internal/cliproxy/embedded.go` | SDK embedding: `NewBuilder()…Build()` + `Run(ctx)` |
| `internal/desktop/` | Native window (WebView2 on Windows; browser fallback elsewhere) |
| `internal/web/` | VisionGate dark UI (embedded assets) + control API |
| `main.go` | Wiring: config → window or console + embedded service |

## Run

```
VisionGateGo.exe
```

- The desktop window opens by itself, showing the UI at `/ui/`. Root (`/`) now
  redirects to the UI (302) instead of the upstream JSON blob.
- Швидкий старт: 1) додай ключі/провайдерів на «Провайдери» або увійди через OAuth на
  «Акаунти», 2) скопіюй адресу й ключ, 3) встав у Claude Code — усе на головній.
- If the configured port is busy (e.g. the user's other tools), the app moves to the
  next free port, saves it, and shows a banner in the UI explaining the move.
- `--headless` runs server-only (no window); on non-Windows the default console mode
  opens the default browser automatically.
- Fatal errors open a message box in GUI mode (no console in a windowsgui build).

## Config

`VISIONGATE_HOME` env var moves the whole data dir (config.json, data/cliproxy/config.yaml,
auths/, logs/, WebView2 profile) — run a second copy beside the first with an isolated home.

- `config.json` — VisionGate settings (port, api key, providers echo)
- `data/cliproxy/config.yaml` — the engine config (generated, management-editable)
- `data/cliproxy/logs/app.log` — app + engine log (GUI builds have no console)

## Building

```
set GOCACHE=C:\Users\<you>\AppData\Local\go-portable\gocache
go build -trimpath -ldflags "-s -w -H=windowsgui" -o VisionGateGo.exe .
```

The icon lives in `build/icon.ico` and is embedded via `rsrc_windows_amd64.syso`
(regenerate: `rsrc.exe -ico build/icon.ico -o rsrc_windows_amd64.syso`).

## Cross-compile

```bash
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o vgate-mac-arm64 .
GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -o vgate-mac-amd64 .
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o vgate-linux-amd64 .
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o vgate-linux-arm64 .
```

## Notes

- The engine's config watcher hot-reloads api-keys, providers, auth files — no restart
  needed. Host/port changes need an app restart (Settings page says so).
- Upstream `/management.html` still exists (upstream surface) but the UI no longer
  links to it — it demands the auto-generated management secret, which confused users.
- `internal/desktop` uses github.com/jchv/go-webview2 — pure Go WebView2 bindings
  (embedded loader DLL, no cgo), so cross-compilation still works.
