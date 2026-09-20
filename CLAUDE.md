# CartelGate — instructions for Claude Code

Локальний AI-шлюз (Go) від YouTube Cartel. Вихідний код CLIProxyAPI вкомпільовано в
бінарник (`third_party/CLIProxyAPI`, `go.mod replace`). UI — вбудовані статичні файли в
`internal/web/ui`. Користувач пише українською, відповідай українською.

## Що робити на macOS (перший запуск)

Виконай кроки по порядку, не питаючи підтвердження на кожен крок:

1. **Залежності.** Потрібні `git`, Go ≥ 1.27, `node` (лише для генерації іконки).
   Якщо чогось немає: `brew install go node` (Homebrew: https://brew.sh). Перевір `go version`.
2. **Клонування** (якщо ще не клоновано):
   `git clone https://github.com/gitkalenyuk/CartelGateGo.git && cd CartelGateGo`
3. **Швидка перевірка:** `bash scripts/mac-setup.sh` — ставить залежності через brew (якщо
   треба), робить `go build`, `go vet`, `go test ./...` і кладе бінарник `./cartelgate`.
4. **Запуск:** `./cartelgate` — на macOS зараз стартує консольний режим і відкриває UI у
   стандартному браузері на `http://127.0.0.1:8317/ui/` (`--headless` — без браузера,
   `--port N` — інший порт). Дані живуть у `~/Library/Application Support/CartelGate`
   (`CARTELGATE_HOME` переносить папку).
5. **Перевір наживо:** `curl -s http://127.0.0.1:8317/api/status` має повернути
   `"version":"2.0.0"` і `"running":true`.

## Мак-версія: що треба дописати

Сьогодні `internal/desktop/gui_other.go` — заглушка (`Supported() == false`), тому на маці
немає нативного вікна. Задача для мак-версії:

- Додати `internal/desktop/gui_darwin.go` з нативним вікном (WKWebView). Варіанти:
  `github.com/webview/webview_go` (cgo, потрібен Xcode CLT: `xcode-select --install`) або
  залишити браузерний режим і зробити лише `.app`-бандл. Перевага: cgo-варіант з WKWebView,
  якщо CLT доступні; інакше — бандл + браузер.
- Зібрати `.app`: `CartelGate.app/Contents/MacOS/cartelgate`, `Info.plist`
  (`CFBundleIdentifier` = `cartel.gate`, `LSMinimumSystemVersion` 12.0), іконку
  `.icns` зробити з `build/icon256.png` через `sips` + `iconutil`.
- `main.go`: тег `useGUI` зараз тільки для Windows — розширити на darwin, коли є
  `desktop.Supported()`. Лог-файл у GUI-режимі на маці теж має йти в `app.log`.
- Оновити README (розділ Run/Building для macOS) і CHANGELOG (2.1.0).
- Крос-компіляція під Windows з мака не потрібна: Windows-білд робиться на Windows
  (`rsrc_windows_amd64.syso` вже в репо).

## Правила проєкту

- Збірка Windows: `go build -trimpath -ldflags "-s -w -H=windowsgui" -o CartelGate.exe .`
- Тести: `go test . ./internal/...` (4 пакети з тестами) + `go vet . ./internal/...`.
  JS перевіряй `node --check internal/web/ui/app.js`.
- `third_party/CLIProxyAPI` не редагувати — це апстрім (MIT), усі зміни робити в
  `internal/` і `main.go` через middleware/конфігуратор.
- Керовані ключі `config.yaml` рушія (host, port, secret, auth-dir, api-keys, claude-code)
  синхронізує `internal/cliproxy.SyncConfigYAML`; решту файлу пише Management API рушія —
  не перезаписувати.
- Провайдери в UI: PUT `openai-compatibility` **замінює** список — завжди GET → змінити →
  PUT, або PATCH за `name`.
- Пресети провайдерів — `internal/web/ui/presets.js`.
- Не комітити бінарники, `data/`, логи (див. `.gitignore`). Коміти на `main`, remote
  `origin` = приватний репо `gitkalenyuk/CartelGateGo`. Публічний `gitkalenyuk/cartelgate` —
  тільки для релізних білдів, код туди не пушити.
