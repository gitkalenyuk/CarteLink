# CarteLink

[![Release](https://img.shields.io/github/v/release/gitkalenyuk/CarteLink?label=%D0%B2%D0%B5%D1%80%D1%81%D1%96%D1%8F)](https://github.com/gitkalenyuk/CarteLink/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Site](https://img.shields.io/badge/%D1%81%D0%B0%D0%B9%D1%82-gitkalenyuk.github.io%2FCarteLink-111)](https://gitkalenyuk.github.io/CarteLink/)

**Локальний AI-шлюз від YouTube Cartel.** Один файл, один порт, одне вікно. Безкоштовно й з
відкритим кодом (MIT).

Збирає твої акаунти й ключі (Google Antigravity, OpenAI Codex, Claude, Kimi, xAI, Meta,
плагіни Kiro / Copilot / Cursor / WorkBuddy… + 70 OpenAI-сумісних API: OpenRouter, Groq,
DeepSeek, Ollama…) в одну адресу `http://127.0.0.1:8317` з ротацією акаунтів, підміною
моделей і чорним списком. Claude Code, Codex, Cursor, Cline, Aider і ще ~20 програм
підключаються за готовими інструкціями. Вхід не потрібен: запустив — і працює.

**Сайт:** <https://gitkalenyuk.github.io/CarteLink/>

## Завантажити

| Система | Файл |
|---|---|
| macOS, Apple Silicon (M1…M5) | [CarteLink-3.0.0-apple-silicon.dmg](https://github.com/gitkalenyuk/CarteLink/releases/download/v3.0.0-mac/CarteLink-3.0.0-apple-silicon.dmg) |
| macOS, Intel | [CarteLink-3.0.0-intel.dmg](https://github.com/gitkalenyuk/CarteLink/releases/download/v3.0.0-mac/CarteLink-3.0.0-intel.dmg) |
| macOS, не знаю який (universal) | [CarteLink-3.0.0.dmg](https://github.com/gitkalenyuk/CarteLink/releases/download/v3.0.0-mac/CarteLink-3.0.0.dmg) |
| Windows | готової збірки поки немає — [збери з коду](#зібрати-з-коду) |

Усі версії: [Releases](https://github.com/gitkalenyuk/CarteLink/releases). Потрібна macOS 13 Ventura або новіша.

## Встановлення

### macOS

1. Відкрий `.dmg` і перетягни **CarteLink** у **Applications** (Програми).
2. Запусти CarteLink з Програм. Збірка не нотаризована Apple, тому macOS попередить про
   «невідомого розробника» — це нормально і робиться один раз:
   - **macOS 15 і новіші:** натисни «Готово» → меню  → Системні параметри →
     Конфіденційність і безпека → внизу «CarteLink заблоковано…» → **Усе одно відкрити** →
     пароль Mac → ще раз відкрий CarteLink → **Відкрити**.
   - **macOS 13–14:** у Програмах клацни CarteLink правою кнопкою → **Відкрити** → **Відкрити**.
   - **Пише «програма пошкоджена»:** у Терміналі
     `xattr -dr com.apple.quarantine /Applications/CarteLink.app`, потім відкрий звичайно.
3. Відкриється вікно CarteLink — шлюз уже працює на `http://127.0.0.1:8317`.

Покроково з картинками й відповідями на питання: [INSTALL-MACOS.md](INSTALL-MACOS.md).
Хочеш, щоб усе встановив ШІ-агент (Claude Code, Codex): дай йому [INSTALL-MACOS-AI.md](INSTALL-MACOS-AI.md).

### Windows

Готового `.exe` у релізах поки немає. Збери його сам (розділ [нижче](#зібрати-з-коду)) і запусти
`target\release\cartelink.exe` — відкриється вікно, а CarteLink сховається в трей біля годинника.

## Перший запуск

1. **Додай акаунт або ключ.** Сторінка «Акаунти»: вхід у Google Antigravity, Claude, Codex,
   Kiro… через браузер. Або «Провайдери»: встав API-ключ OpenRouter, Groq, DeepSeek тощо.
2. **Підключи програму.** Сторінка «Підключити програму» → вибери Claude Code, Codex, Cursor,
   Cline… Більшість підключаються одним кліком, для інших є покрокова інструкція.
3. **Готово.** На сторінці «Огляд» видно, яка модель відповідає зараз, стан акаунтів і лімітів,
   адресу й ключ.

### Claude Code вручну

Якщо не хочеш одним кліком — додай у `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8317",
    "ANTHROPIC_AUTH_TOKEN": "<ключ зі сторінки «Огляд»>",
    "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY": "1"
  }
}
```

Будь-яка OpenAI-сумісна програма: адреса `http://127.0.0.1:8317/v1`, ключ — той самий.

## Зібрати з коду

Потрібні Rust (stable, ≥ 1.90) і Go (версія в `go.mod`).

```
git clone https://github.com/gitkalenyuk/CarteLink.git
cd CarteLink
cargo build --release
```

Windows: `target\release\cartelink.exe`. macOS: `bash scripts/build-mac-app.sh` → `dist/CarteLink.app`
і три `.dmg`. Подробиці — у розділах [Build](#build) і [Checks](#checks) нижче.

## Ліцензія

[MIT](LICENSE) © YouTube Cartel. Вбудований рушій [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
(`third_party/CLIProxyAPI`) — окремий проєкт під власною ліцензією MIT.

---

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
