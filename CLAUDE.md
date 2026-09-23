# CarteLink — instructions for Claude Code

Локальний AI-шлюз (Go) від YouTube Cartel, версія **2.3.0**. Вихідний код CLIProxyAPI
вкомпільовано в бінарник (`third_party/CLIProxyAPI`, `go.mod replace`). UI — вбудовані
статичні файли в `internal/web/ui`. Користувач пише українською — відповідай українською.
Історія назв: VisionGateGo → CartelGate (2.0) → **CarteLink** (2.1+). Змін див. `CHANGELOG.md`.

## Карта коду

| Шлях | Що там |
|---|---|
| `main.go` | Старт: одна копія, конфіг, лог, порт на сесію, root-middleware (гейт, пауза, мапінг, `/v1/models`), вікно/консоль |
| `routing.go` | Мапінг моделей: рівні / таблиця / «розумний» fallback. **Лише точні збіги та явні префікси** |
| `internal/config/` | `config.json`: схема, міграції (schema 2), `Normalize`, атомарний `Save`, `TierAliases` |
| `internal/cliproxy/` | Вбудований рушій + `SyncConfigYAML` (керовані ключі `config.yaml`) |
| `internal/web/server.go` | `App`: стан, порт сесії (`EffectivePort`), кеш моделей (`IsKnownModel`) |
| `internal/web/auth*.go` | Telegram-гейт: `auth.go` логіка, `auth_gate.go` / `auth_gate_dev.go` (тег `devnoauth`) |
| `internal/web/handlers_*.go`, `routes.go` | Control API `/api/*` (конфіг, сервер, OAuth, метрики, `/app/*`) |
| `internal/web/metrics_store.go` | Статистика: бекенд сам вичитує `usage-queue` → `data/metrics.json` |
| `internal/desktop/` | Вікно: WebView2 + трей (Windows), WKWebView cgo (`gui_darwin.go`), автозапуск (`autostart_*.go`) |
| `internal/instance/` | Одна копія: `instance.json` + `/api/app/ping`, `/api/app/show` |
| `internal/web/ui/` | `index.html`, `app.js`, `style.css`, `presets.js` (70+ провайдерів), `clients.js` (24 програми) |
| `scripts/` | `mac-setup.sh` (перевірка), `build-mac-app.sh` (`.app` + `.dmg`) |

## Сторінки UI
Головна (статус, адреса+ключ, майстер «3 кроки») · Підключити програму (інструкції
PowerShell/CMD/bash + файли) · Акаунти (OAuth) · Моделі (режими «Рівні»/«Таблиця»,
модель за замовчуванням, «Невідомі моделі», черговість акаунтів) · Провайдери (OpenAI-сумісні,
рідні ключі, акаунти-провайдери) · Статистика · Налаштування (автозапуск, трей, доступ,
шлюз, чорний список, розширені) · Довідка.

## Авторизація (Telegram Gate)
- Доступ — лише учасникам закритої групи **Secret YT_cartel 🧠** (ID `-100xxxxxxxxxx`).
- Брокер: `https://yt-cartel.vercel.app`, репо `gitkalenyuk/yt-cartel` (Next.js, спільний з
  іншими застосунками). CarteLink шле `POST /api/auth/verify` з
  `{"app":true,"appId":"cartelink"}` + кука `ytc_session`; брокер перевіряє групу зі змінної
  Vercel `APP_GROUP_CARTELINK` (бот `@ytcartelappbot` — адмін групи). Приймається лише
  `tier: "private"`, тріалу немає. Інші застосунки на брокері працюють як раніше.
- Гейт зашитий у збірку: `config.json` не вимикає і не перенаправляє його (`auth.enabled`,
  `auth.brokerUrl` ігноруються). URL брокера — лише `-ldflags -X cartelgate/internal/config.BrokerURL=…`.
- Локальні тести UI без гейта: `go build -tags devnoauth` — **ніколи не роздавати**.
- Стани: authorized / checking / need_login / awaiting / denied / offline. Вочдог — 5 хв;
  без зв'язку з брокером — 24 год пільги від `auth.lastVerified`.
- 403 на `/v1/*` без входу; UI закритий оверлеєм `#gate` і сам блокується при відкликанні.

## Поведінка «налаштував і забув»
- Порт фіксований **8317**. Зайнятий → інший порт лише на цей запуск (не зберігається);
  `--port N` теж лише на запуск. Змінити назавжди — Налаштування → Шлюз.
- Одна копія: повторний запуск показує вікно першої й виходить.
- Windows: закриття вікна → трей (вимикається в Налаштуваннях); вийти — трей → «Вийти».
- Автозапуск: Windows `HKCU\…\Run` (`--minimized`), macOS LaunchAgent, Linux XDG.
- Mac: трею немає — закриття вікна завершує програму.

## Дані користувача (не в репо)
`%AppData%\CarteLink` (Windows), `~/Library/Application Support/CarteLink` (macOS);
`CARTELINK_HOME` переносить папку. Міграція з `CartelGate` / `VisionGateGo` (без кешів і
Electron-мотлоху).
- `config.json` — ключ шлюзу, маршрутизація, чорний список, вікно, сесія Telegram
- `data/cliproxy/config.yaml` — ключі провайдерів і рідні ключі (рушій)
- `data/cliproxy/auths/*.json` — OAuth-акаунти; `data/cliproxy/logs/app.log` — лог
- `data/metrics.json` — статистика; `instance.json` — запущена копія
Файли не шифруються — не просити користувача пересилати цю папку.

## Що робити на macOS

Виконай кроки по порядку, не питаючи підтвердження на кожен крок:

1. **Залежності.** `git`, Go ≥ 1.27, `node` (перевірка JS), **Xcode Command Line Tools**
   (`xcode-select --install`) — потрібні для нативного вікна (cgo). Homebrew: `brew install go node`.
2. **Код:** `git clone https://github.com/gitkalenyuk/CarteLink.git && cd CarteLink`
   (якщо вже є — `git pull`).
3. **Перевірка:** `bash scripts/mac-setup.sh` — build, vet, test, `node --check`, бінарник `./cartelink`.
4. **Реліз:** `bash scripts/build-mac-app.sh` → `dist/CarteLink.app` (universal, WKWebView,
   ad-hoc підпис) і `dist/CarteLink-<версія>.dmg` — його користувач роздає людям.
   `gui_darwin.go` (cgo) на Windows не компілюється — перша реальна перевірка саме тут;
   якщо збірка падає, виправляй `internal/desktop/gui_darwin.go`.
5. **Перевір наживо:** `open dist/CarteLink.app`, потім
   `curl -s http://127.0.0.1:8317/api/status` → `"version":"2.3.0"`. Перевір Cmd+C/Cmd+V у вікні.

## Правила проєкту

- Збірка Windows: `go build -trimpath -ldflags "-s -w -H=windowsgui" -o CarteLink.exe .`
  Якщо запущений CarteLink використовується самою сесією Claude — збирай поруч під іншим іменем.
  Готові збірки класти в `Desktop\CarteLink_extras\builds\`.
- Перевірки: `go vet . ./internal/...`, `go test . ./internal/...`,
  `GOOS=darwin CGO_ENABLED=0 go vet . ./internal/...`, `node --check internal/web/ui/*.js`.
- Тест UI наживо: `.claude/launch.json` → `cartelink-dev` (devnoauth-білд у `%TEMP%\cl-dev`,
  ізольований `CARTELINK_HOME`, порт 8419). GUI-тести — теж з ізольованим `CARTELINK_HOME`;
  реєстр (автозапуск) після тесту повертати як було.
- `third_party/CLIProxyAPI` не редагувати — це апстрім (MIT); зміни лише в `internal/`,
  `main.go`, `routing.go` через middleware/конфігуратор.
- Керовані ключі `config.yaml` (host, port, secret, auth-dir, api-keys, claude-code,
  redis-usage-queue-retention-seconds) пише `SyncConfigYAML`; решту — Management API рушія.
- Management API: PUT для списків (`openai-compatibility`, `*-api-key`, `api-keys`)
  **замінює** весь список — завжди GET → змінити → PUT (або PATCH за `name`). GET рідних
  ключів повертає `{"<kind>": [...]}`, PUT приймає голий масив.
- Конфіг з UI — тільки через `saveConfig()` в `app.js` (черга + перевірка відповіді);
  небезпечні дії — через `confirmDo()`.
- Мапінг: ніяких підрядків (баг 2.2.0: правило `mini` ловило всі `gemini-*`). Нові аліаси —
  у `config.TierAliases`. Нових провайдерів з API-ключем — у `presets.js`, нових програм — у `clients.js`.
- `usage-queue` вичитує **лише** бекенд (`metrics_store.go`) — UI не має туди ходити.
- Не комітити бінарники, `data/`, `dist/`, логи, `.py`, картинки (див. `.gitignore`).
- Git: коміти на `main`, `origin` = приватний `gitkalenyuk/CarteLink`. `CartelGateGo` —
  архів (remote `cartelgatego`, не пушити). Публічний `gitkalenyuk/cartelgate` — лише для
  релізних білдів, код туди не пушити. Оновлення роздаються вручну, авто-оновлювача немає.
- JevRouter видалено назавжди (2026-09-22) — не повертати.
- Зайве (тестові скрипти, картинки, старі збірки, бекапи) — поза репо: `Desktop\CarteLink_extras\`.
- OpenCode (Zen/Go) не додавати — користувач відмовився (2026-09-23).
