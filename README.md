# CarteLink

**Локальний AI-шлюз від YouTube Cartel.** Один процес, один порт, одне вікно.

Збирає твої акаунти й ключі (Google Antigravity, OpenAI Codex, Kimi, Claude, xAI,
Meta + 70 OpenAI-сумісних API: OpenRouter, Groq, DeepSeek, Ollama…) в одну адресу
`http://127.0.0.1:8317` з ротацією акаунтів, підміною моделей і чорним списком.
Claude Code, Codex, Cursor, Cline, Aider і ще ~20 програм підключаються за готовими
інструкціями зі сторінки «Підключити програму».

Доступ — лише для учасників закритої групи **Secret YT_cartel 🧠** (вхід через Telegram).

The original [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) source code is
compiled directly into this binary — the engine IS the server. The CarteLink UI is
mounted on the same Gin engine; Windows gets a WebView2 window with a tray icon, macOS
(cgo build) a native WKWebView window.

## What's inside

| Path | What it is |
|---|---|
| `third_party/CLIProxyAPI/` | The full CLIProxyAPI source (unmodified, MIT) |
| `internal/cliproxy/embedded.go` | SDK embedding: `NewBuilder()…Build()` + `Run(ctx)`, `config.yaml` sync |
| `internal/desktop/` | Native window + tray (Windows), WKWebView (macOS), autostart (all OS) |
| `internal/instance/` | Single instance: a second launch shows the running window |
| `internal/web/` | CarteLink UI (embedded assets) + control API + Telegram auth |
| `internal/web/ui/presets.js` | 70+ provider presets for the Providers page |
| `internal/web/ui/clients.js` | ~24 client apps with setup instructions |
| `routing.go` | Model mapping (tiers / table / smart fallback) |
| `main.go` | Wiring: config → window or console + embedded service, gateway middleware |

## Run

Windows: `CarteLink.exe`. macOS: `CarteLink.app` (see *Building for macOS*).

- The window opens by itself (`/ui/`). Closing it hides CarteLink to the tray
  (Windows; switchable in Налаштування) — the gateway keeps running. Quit: tray → «Вийти».
- «Налаштування → Запускати разом із системою» adds a per-user login item
  (Windows `HKCU\…\Run`, macOS LaunchAgent, Linux XDG autostart); it starts minimized.
- Only one copy runs: launching it again brings the existing window up.
- The port is fixed (8317). If another program holds it, CarteLink uses the next free
  port **for this run only** and shows a banner; it is never saved.
- `--headless` runs server-only (no window); `--port N` overrides the port for this run;
  `--minimized` starts hidden in the tray (used by autostart).

## Access (Telegram gate)

- Model traffic (`/v1/*`) returns 403 until the user logs in with Telegram and the broker
  confirms membership. The gate is compiled in: `config.json` cannot switch it off or
  point it at another broker (the broker URL can only be changed at build time with
  `-ldflags "-X cartelgate/internal/config.BrokerURL=https://…"`).
- The broker (`https://yt-cartel.vercel.app`, repo `gitkalenyuk/yt-cartel`) checks the
  group configured for `appId: "cartelink"` (`APP_GROUP_CARTELINK` on Vercel). Only the
  `private` tier is accepted — no trial.
- Membership is re-checked every 5 minutes. If the broker is unreachable, a session that
  was verified within the last 24 h keeps working; after that the UI shows «Немає зв'язку».
- Development builds without the gate: `go build -tags devnoauth` (never ship these).

## Models

«Моделі» has two modes:

- **Рівні** (default): Claude Code's Haiku/Sonnet/Opus (any `claude-*` name containing the
  tier word) + universal tiers for every other app, selected by exact alias —
  `cartelink-fast`, `cartelink-main`, `cartelink-max` (legacy `cursor-small`,
  `codex-mini`, `cascade-*`… still work). Optional exact swaps for official Claude names.
- **Таблиця**: an explicit «client model → real model» list; keys may end with `*`.

Matching is exact or explicit prefix only (2.2.0 used substrings, so e.g. every `gemini-*`
request was caught by the `mini` rule). Unknown models: **smart** (default — a model the
engine does not serve goes to the default model), passthrough, or always-default.
`/v1/models` lists only models that really work (served models, provider models, set aliases).

## Config

`CARTELINK_HOME` (legacy `CARTELGATE_HOME` / `VISIONGATE_HOME`) moves the whole data dir.
Default: `%AppData%\CarteLink` (Windows), `~/Library/Application Support/CarteLink` (macOS).
On first start the previous product's directory (`CartelGate`, `VisionGateGo`) is copied
over (auths and settings; logs, browser caches and Electron-era leftovers are skipped).

- `config.json` — gateway settings (key, routing, blacklist, window prefs, session)
- `data/cliproxy/config.yaml` — the engine config (managed keys rewritten, management edits kept)
- `data/cliproxy/logs/app.log` — app + engine log in GUI mode, rotates at 5 MB
- `data/metrics.json` — persistent usage statistics
- `instance.json` — pid/port of the running copy (single instance)

## Building for Windows

```
go build -trimpath -ldflags "-s -w -H=windowsgui" -o CarteLink.exe .
```

The icon lives in `build/icon.ico` and is embedded via `rsrc_windows_amd64.syso`
(regenerate: `rsrc -ico build/icon.ico -o rsrc_windows_amd64.syso`).

## Building for macOS

Needs Go ≥ 1.27 and the Xcode Command Line Tools (`xcode-select --install`).

```bash
bash scripts/build-mac-app.sh
```

Produces `dist/CarteLink.app` (universal arm64 + x86_64, native window, ad-hoc signed) and
three `.dmg` to hand out: `CarteLink-<version>.dmg` (universal), `…-apple-silicon.dmg`
(arm64) and `…-intel.dmg` (x86_64). The app needs macOS 13 Ventura or later (Go 1.27).
Without the Command Line Tools `bash scripts/mac-setup.sh` still builds `./cartelink`,
which opens the UI in the browser.

Installing (the build is not notarized, so the first launch needs a Gatekeeper
permission): [`INSTALL-MACOS.md`](INSTALL-MACOS.md) for people,
[`INSTALL-MACOS-AI.md`](INSTALL-MACOS-AI.md) as a prompt for an AI agent.

## Tests

```
go vet . ./internal/...
go test . ./internal/...
node --check internal/web/ui/app.js
```

## Notes

- The engine's config watcher hot-reloads api-keys, providers, auth files — no restart
  needed. Host/port changes apply after «Перезапустити» (a real in-process restart).
- The control API (`/api/*`) accepts same-origin browser requests and local processes
  only; cross-origin pages get 403.
- OAuth logins open Edge/Chrome/Brave with a dedicated `--user-data-dir` in private mode,
  so the window is a separate process and closes itself when the login completes.
