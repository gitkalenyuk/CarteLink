# CarteLink

**Локальний AI-шлюз від YouTube Cartel.** Один файл, один порт, одне вікно.

Збирає твої акаунти й ключі (Google Antigravity, OpenAI Codex, Claude, Kimi, xAI, Meta,
плагіни Kiro / Copilot / Cursor / WorkBuddy… + 70 OpenAI-сумісних API: OpenRouter, Groq,
DeepSeek, Ollama…) в одну адресу `http://127.0.0.1:8317` з ротацією акаунтів, підміною
моделей і чорним списком. Claude Code, Codex, Cursor, Cline, Aider і ще ~20 програм
підключаються за готовими інструкціями. Вхід не потрібен: запустив — і працює.

## Architecture (3.0)

CarteLink 3 is written in **Rust** (edition 2024): tokio + axum + hyper for the gateway,
wry + tao + tray-icon for the native window (WebView2 on Windows, WKWebView on macOS).

The original [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) engine (Go, MIT)
is **compiled into the same executable**: `build.rs` builds `enginehost/` (a ~300-line
Go host around the unmodified `third_party/CLIProxyAPI`) for the target, compresses it
with zstd and embeds it. At start the engine is written to `data/bin/` (once per build)
and supervised as a hidden child process on a private loopback port:

```
programs ──▶ CarteLink (Rust, :8317)                 ──▶ engine (Go, 127.0.0.1:<random>)
             · local-only gate, pause                     · OAuth accounts, plugins,
             · client keys (full + scoped)                  format translation, rotation
             · model mapping, blacklist, prompt, thinking   · accepts only CarteLink's
             · /v1/models, live events, statistics            internal key
             · UI + control API (/ui, /api)
```

The engine dies with the app (stdin pipe + Windows Job Object) and is restarted with
backoff if it ever exits on its own.

| Path | What it is |
|---|---|
| `src/main.rs` | Start-up: single instance, config, logging, port, engine, window or headless |
| `src/proxy.rs` | The gateway: gates, key checks, body rewrite, streaming pass-through, WebSocket upgrade |
| `src/routing.rs` | Model mapping (tiers / table / smart fallback) |
| `src/scoped.rs` | Client keys: full-access and scoped (`cl-api-…`) |
| `src/prompting.rs` | System prompt / AGENT.md injection, reasoning (thinking) settings |
| `src/engine.rs` | Embedded engine: extraction, config.yaml sync, supervision |
| `src/api.rs` | Control API `/api/*` (config, accounts, keys, switcher, metrics, events…) |
| `src/limits.rs` | Account states and limits (incl. "sign-in rejected") |
| `src/metrics.rs`, `src/errlog.rs` | Statistics (hourly, 31 days) and the error log |
| `src/gui.rs` | Window, tray, floating switcher (Windows + macOS) |
| `enginehost/main.go` | Go host of the engine (+ model catalog/Antigravity updaters, `/_cartelink/caps`) |
| `ui/` | The UI: `index.html`, `css/`, `js/core.js` (shared API), `js/look.js` (themes, layout editing), `js/pages/*`, `i18n/` |

## Run

Windows: `CarteLink.exe`. macOS: `CarteLink.app`.

- The window opens by itself. Closing it hides CarteLink to the tray (Windows and macOS menu
  bar; switchable in Налаштування). Quit: tray → «Вийти».
- Only one copy runs; launching it again brings the window up.
- The port is fixed (8317). If it is busy, CarteLink uses the next free port **for this run
  only** and shows a banner.
- `--headless` (server only), `--port N` (this run only), `--minimized` (start in the tray).
- Development: `CARTELINK_UI_DIR=<repo>/ui` serves the UI from disk (edit + reload, no rebuild).

## Data

`CARTELINK_HOME` moves the whole data dir. Default: `%AppData%\CarteLink` (Windows),
`~/Library/Application Support/CarteLink` (macOS). 2.x data is used as is.

- `config.json` — gateway settings, routing, keys, UI look and layout (`ui`)
- `data/cliproxy/config.yaml` — engine config (managed keys rewritten, the rest kept; `.bak` copy)
- `data/cliproxy/auths/` — accounts; `data/cliproxy/plugins/` — engine plugins
- `data/cliproxy/logs/app.log` — app + engine log, rotates at 5 MB
- `data/metrics.json`, `data/errors.jsonl`, `data/account-health.json`
- `data/bin/` — the extracted engine; `data/webview/` — the window's browser profile

## Build

Needs Rust (stable, ≥ 1.90) and Go (see `go.mod`).

```
cargo build --release
```

Windows output: `target/release/cartelink.exe` (icon and version info embedded). macOS:
`bash scripts/build-mac-app.sh` → `dist/CarteLink.app` + three `.dmg` (universal, Apple
Silicon, Intel). `CARTELINK_ENGINE_BIN=<path>` uses a prebuilt engine instead of running Go.

## Checks

```
cargo test
cargo clippy -- -D warnings
go vet ./enginehost
node --check ui/js/core.js
```

Installing on a Mac (the build is not notarized): [`INSTALL-MACOS.md`](INSTALL-MACOS.md),
[`INSTALL-MACOS-AI.md`](INSTALL-MACOS-AI.md).
