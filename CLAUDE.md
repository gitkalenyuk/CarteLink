# CarteLink — instructions for Claude Code

Локальний AI-шлюз (Go) від YouTube Cartel. Вихідний код CLIProxyAPI вкомпільовано в
бінарник (`third_party/CLIProxyAPI`, `go.mod replace`). UI — вбудовані статичні файли в
`internal/web/ui`. Користувач пише українською, відповідай українською.

## Авторизація та захист (Telegram Gate)
- Доступ мають лише учасники закритої групи **Secret YT_cartel 🧠**.
- Брокер — живий `https://yt-cartel.vercel.app` (репо `gitkalenyuk/yt-cartel`, Next.js).
  CarteLink шле `POST /api/auth/verify` з `{"app":true,"appId":"cartelink"}`; брокер
  перевіряє групу зі змінної `APP_GROUP_CARTELINK`. Приймається лише `tier: "private"`.
- Гейт зашитий у збірку (`internal/web/auth_gate.go`); `config.json` його не вимикає.
  Для локальних тестів UI: `go build -tags devnoauth` (ніколи не роздавати).
- Фронтенд закритий оверлеєм `#gate`; бекенд дає 403 на `/v1/*` без входу.
- Вочдог кожні 5 хв; офлайн — 24 год пільги від останньої успішної перевірки.
- Оновлення роздаються вручну, авто-оновлювача немає.

## Що робити на macOS

Виконай кроки по порядку, не питаючи підтвердження на кожен крок:

1. **Залежності.** `git`, Go ≥ 1.27, `node` (перевірка JS), **Xcode Command Line Tools**
   (`xcode-select --install`) — потрібні для нативного вікна (cgo). Homebrew: `brew install go node`.
2. **Клонування** (якщо ще не клоновано):
   `git clone https://github.com/gitkalenyuk/CarteLink.git && cd CarteLink`
   (якщо вже є — `git pull`).
3. **Перевірка:** `bash scripts/mac-setup.sh` — build, vet, test, `node --check`, бінарник `./cartelink`.
4. **Реліз:** `bash scripts/build-mac-app.sh` → `dist/CarteLink.app` (universal, WKWebView,
   ad-hoc підпис) і `dist/CarteLink-<версія>.dmg` — його користувач роздає людям.
5. **Перевір наживо:** `open dist/CarteLink.app`, потім
   `curl -s http://127.0.0.1:8317/api/status` має повернути `"version":"2.3.0"`.
   Дані: `~/Library/Application Support/CarteLink`.

## Правила проєкту

- Збірка Windows: `go build -trimpath -ldflags "-s -w -H=windowsgui" -o CarteLink.exe .`
  Якщо запущений CarteLink використовується самою сесією Claude — збирай поруч під іншим іменем.
- Тести: `go test . ./internal/...` + `go vet . ./internal/...`; JS: `node --check internal/web/ui/*.js`.
  Крос-перевірка: `GOOS=darwin CGO_ENABLED=0 go vet . ./internal/...` (cgo-вікно Mac
  перевіряється тільки на маці).
- `third_party/CLIProxyAPI` не редагувати — це апстрім (MIT), усі зміни робити в
  `internal/`, `main.go`, `routing.go` через middleware/конфігуратор.
- Керовані ключі `config.yaml` рушія (host, port, secret, auth-dir, api-keys, claude-code)
  синхронізує `internal/cliproxy.SyncConfigYAML`; решту файлу пише Management API рушія —
  не перезаписувати.
- Management API: PUT для списків (`openai-compatibility`, `*-api-key`, `api-keys`)
  **замінює** весь список — завжди GET → змінити → PUT, або PATCH за `name`.
- Збереження конфігу з UI — тільки через `saveConfig()` в `app.js` (черга + перевірка відповіді).
- Маршрутизація моделей — `routing.go`: лише точні збіги/явні префікси, ніяких підрядків.
- Пресети провайдерів — `internal/web/ui/presets.js`; програми-клієнти — `internal/web/ui/clients.js`.
- Не комітити бінарники, `data/`, `dist/`, логи (див. `.gitignore`). Коміти на `main`,
  remote `origin` = приватний `gitkalenyuk/CarteLink`. `CartelGateGo` — архів.
  Публічний `gitkalenyuk/cartelgate` — тільки для релізних білдів, код туди не пушити.
- Зайві файли (тестові скрипти, картинки, старі збірки) тримати поза репо:
  `Desktop\CarteLink_extras\`.
