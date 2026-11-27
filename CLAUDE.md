# CarteLink — instructions for Claude Code

Локальний AI-шлюз від YouTube Cartel, версія **3.0.0**, написаний на **Rust** (edition 2024).
Рушій CLIProxyAPI (Go, `third_party/CLIProxyAPI`) вшитий у той самий exe: `build.rs` збирає
`enginehost/` під ціль, стискає zstd і вбудовує; при старті рушій розпаковується в `data/bin/`
і працює прихованим дочірнім процесом на внутрішньому loopback-порту. UI — статичні файли `ui/`
(вбудовуються `include_dir`). Користувач пише українською — відповідай українською.
Історія назв: VisionGateGo → CartelGate (2.0) → CarteLink (2.1+), Go → Rust у 3.0. Змін див. `CHANGELOG.md`.

## Карта коду

| Шлях | Що там |
|---|---|
| `src/main.rs` | Старт: аргументи, одна копія, конфіг, лог (`app.log`), порт на запуск, запуск рушія, вікно або headless, `shutdown()` |
| `src/proxy.rs` | Шлюз (fallback-хендлер): `local_gate`, `/healthz`, пауза, ключі, scoped-обмеження, переписування тіла, `/v1/models`, стрімінг без буферизації (`Tee`), WebSocket upgrade, живі події |
| `src/routing.rs` | Мапінг моделей: рівні / таблиця / «розумний» fallback. **Лише точні збіги та явні `*`** |
| `src/scoped.rs` | Ключі клієнтів: `identify` (повні, scoped `cl-api-`, відкритий режим), білий список шляхів scoped-ключа |
| `src/prompting.rs` | Системний промпт / AGENT.md, `normalize_effort`, думання суфіксом `model(level)` |
| `src/engine.rs` | Рушій: розпаковка, запуск (`CREATE_NO_WINDOW`, Job Object), healthz, супервізор з backoff, `sync_config_yaml` |
| `src/app.rs` | Спільний стан `App` (`app()`): конфіг (`ArcSwap` + `update_config`), `mgmt()`, каталог моделей, події (broadcast) |
| `src/api.rs` | Control API `/api/*` (див. `router()`), `delete_accounts`, `switcher_auto_advance`, інспектор, engine-tuning, stats |
| `src/api2.rs` | `/api/connect` (+undo), `/backup`, `/restore`, `/accounts/check`, `/accounts/policy`, `/notify`, `/devices/lan`, `/qr` |
| `src/connect.rs` / `src/backup.rs` / `src/apps.rs` | Підключення програм одним кліком (`CARTELINK_CLIENT_HOME` — інша папка для тестів) / zip-бекап / назва програми з User-Agent |
| `src/limits.rs` | Стани й ліміти акаунтів (`ok warn limited error invalid disabled`), квоти плагінів |
| `src/metrics.rs` / `src/errlog.rs` | Статистика (`usage-queue` → погодинно 31 день, `key_stats`) / журнал помилок `errors.jsonl` |
| `src/caps.rs` | Можливості моделей з `/_cartelink/caps` рушія (фоном, без мережі на шляху запиту) |
| `src/tasks.rs` | Фонові цикли: usage-queue, каталог/caps, бекап `config.yaml`, автосинхронізація акаунт→провайдер, автоочищення акаунтів |
| `src/gui.rs` | Вікно (wry/tao), трей (tray-icon), плаваючий перемикач; меню Edit на macOS (інакше Cmd+C/V не працюють) |
| `src/server.rs` / `src/routes.rs` | Слухач (перезапуск на іншу адресу без простою), маршрути `/`, `/ui/*`, `/api/*`, fallback → proxy |
| `src/config.rs` / `src/paths.rs` | `config.json` (schema 3, невідомі ключі зберігаються), шляхи даних, атомарний запис |
| `enginehost/main.go` | Go-хост рушія: SDK-сервіс, linkname-апдейтери каталогу моделей і версії Antigravity, `/_cartelink/{info,caps}` за секретом |
| `ui/js/core.js` | Спільне API UI (`CL.api`, `CL.mgmt`, `CL.config.patch`, `CL.models`, `CL.ui.*`, діалоги, контракт `CL.page`) |
| `ui/js/look.js` | Теми, редактор «Свій дизайн», ефекти фону, режим «Налаштувати вигляд» (перетягування/ширина/приховування блоків і пунктів меню) |
| `ui/js/shell.js` | Меню, маршрутизація (`#/page`), статус, Ctrl+K, завантаження |
| `ui/js/pages/*.js` | Сторінки; `ui/switcher.*` — плаваючий перемикач; `ui/js/data/` — `presets.js`, `clients.js`, `prices.js` (ціни API для «Скільки б коштувало») |
| `scripts/` | `mac-setup.sh`, `build-mac-app.sh` (`.app` + 3 `.dmg`) |

## UI: правила
- Дизайн-система: `ui/css/app.css` (токени на `:root` = «Графіт», компоненти, оболонки `data-shell` sidebar/topbar/rail).
  **Дизайн ≠ тема**: 14 дизайнів, кожен — композиція: `ui/js/designs/<id>.js` (`CL.design({id, shell, mode, home, viz,
  widgets, titles, fx, thumb})`, контракт у `ui/js/design.js`) + `ui/css/designs/<id>.css` (усе під `html[data-theme="<id>"]`).
  Віджети беруть дані з `CL.data` (`ui/js/data.js`) і перемальовуються на місці, без перебудови DOM.
  Новий дизайн = 2 файли + теги в `index.html` + `config::THEMES`. Іконки — спрайт `#i-*` в `index.html` через `CL.ic()`, без емодзі.
- Сторінка = `CL.page(id, {title, icon, group, order, render(root, ctx)})`; вміст — `.blocks[data-area]` з
  `.block[data-block][data-w][data-title]` (користувач переставляє/ховає). Таймери й підписки — через `ctx`.
- Конфіг з UI — лише `CL.config.patch(...)` (JSON merge patch, `null` видаляє ключ мапи) або окремі ендпоінти.
  Ніяких `window.confirm/alert/prompt` — `CL.confirm/CL.prompt/CL.dialog`. Моделі — `CL.ui.modelPicker`.
- Вигляд і розташування: `config.json → ui` (`/api/ui-prefs`) + дзеркало в localStorage (`cl.prefs`, `cl.look`).
- Розробка UI без перезбірки: `CARTELINK_UI_DIR=<repo>\ui` (в `.claude/launch.json` → `cartelink-dev`).

## Локалізація
- Джерело — українські рядки прямо в HTML/JS; вони ж ключі словника `ui/i18n/<lang>.js`
  (`window.I18N_DICT = {"<uk>": "<переклад>"}`). `ui/js/i18n.js` перекладає DOM сам (MutationObserver).
  Рядки зі значеннями — лише `t('… {name} …', {name})`, ніколи не склеювати.
- 16 мов: en zh hi es fr ar bn pt ur id de ja tr ko vi pl (ar/ur — RTL). Російської немає й не додавати.
- Після зміни текстів: оновити переклади всіх мов. Скрипти: `Desktop\CarteLink_extras\i18n\extract.js`
  (які рядки відсутні) і `merge.js` (злиття з перевіркою плейсхолдерів).
- Трей: `src/traytext.rs`; мова — `config.json → desktop.lang`.

## Ключі
- Рушій приймає **лише** внутрішній ключ CarteLink (`cl-internal-…`, новий на кожен запуск). Ключ клієнта
  (основний `apiKey`, додаткові `cliproxy.apiKeys`, scoped `scopedKeys`) перевіряє `scoped::identify`, потім
  проксі прибирає `Authorization/x-api-key/x-goog-api-key/?key=/?auth_token=` і ставить внутрішній.
- Scoped-ключ має пріоритет над повним у тому ж запиті; без запису — 401; `enabled:false` — 401.
- `scoped_allowed_path` — білий список; тіло scoped-запиту завжди кодується заново (дублікат `model`).

## Системний промпт і думання
- `config.json → prompting`. Інжекцію робить `proxy::rewrite_body` → `prompting.rs`, per request.
- Думання лише для моделей з підтримкою (`caps.thinking`); значення суфіксом `model(level|budget|none|auto)`,
  рушій сам валідує. Не писати поля thinking/reasoning у тіло вручну.
- Автоперемикання пресетів: `Switcher.autoSwitch/autoArmed` → `api::switcher_auto_advance` (порівнює базові імена).
- Контекст: `ModelCaps.context/maxOutput`; Claude Code бачить `[1m]` (ставить `claude_picker_entries` при ≥1M).

## Плагіни рушія
- `sync_config_yaml` пише `plugins.enabled: true` і `plugins.dir`; `plugins.configs` належить рушію — не чіпати.
- Встановлення через Management API (`/plugin-store/:id/install`), вхід — `/<provider>-auth-url`.
- UI: `PLUGIN_SERVICES`, `PLUGIN_LOGIN`, `PLUGIN_SAFE_CONFIG`, `HIDDEN_PLUGINS` (`opencode-cloak`), `PLUGIN_NO_BUILD`
  — у `ui/js/pages/accounts.js` (`window.CL_PLUGINS`). Один активний плагін на сервіс.
- Kiro відповідає `INVALID_MODEL_ID` на моделі поза тарифом — `autofix::auto_hide_model` ховає її для провайдера.
- Робоча папка рушія = `data/cliproxy`.

## Акаунти
- `GET /api/accounts` (= `/api/limits`): стан `invalid` = вхід відхилено (401/403/invalid_grant/revoked…) — сам не мине.
- `POST /api/accounts/delete {names[] | filter: broken|invalid|error|disabled|limited|all}` → DELETE `auth-files` рушія
  одним запитом + прибирає провайдер-записи `cp-<fam>-<short>`. `POST /api/accounts/toggle`, `/api/accounts/reset`.
- Автоочищення (`config.json → accounts.autoClean/autoCleanHours`, типово вимкнено): лише стан `invalid`,
  тривалість — `data/account-health.json`. Акаунти на ліміті не видаляються ніколи.

## Доступ без входу
- Вхід через Telegram прибрано (2026-11-12, рішення користувача). Не повертати. Ключ `auth` у `config.json` прибирається.

## Поведінка «налаштував і забув»
- Порт фіксований **8317**. Зайнятий → інший порт лише на цей запуск; `--port N` теж лише на запуск.
- Host може бути конкретною адресою. Панель і `/api` — лише з цього комп'ютера (`proxy::local_gate`,
  `network_allowed_path` — білий список), control API — лише same-origin (`proxy::same_origin`).
- Одна копія: `instance.json` + `/api/app/ping`, `/api/app/show`.
- Закриття вікна → трей (Windows і macOS), вимикається в Налаштуваннях. Плаваючий перемикач — Windows і macOS.
- Автозапуск: Windows `HKCU\…\Run` (`--minimized`), macOS LaunchAgent, Linux XDG (`src/autostart.rs`).
- Рушій упав → супервізор перезапускає (1→30 с), запис у журнал помилок.

## Дані користувача (не в репо)
`%AppData%\CarteLink` (Windows), `~/Library/Application Support/CarteLink` (macOS); `CARTELINK_HOME` переносить папку.
`config.json`, `data/cliproxy/{config.yaml,auths,plugins,logs}`, `data/metrics.json`, `data/errors.jsonl`,
`data/account-health.json`, `data/bin/` (розпакований рушій), `data/webview/`, `instance.json`.
Файли не шифруються — не просити користувача пересилати цю папку.

## Що робити на macOS

Без Mac: `gh workflow run mac-build.yml` збирає `.dmg` на GitHub Actions (артефакт `CarteLink-mac`).

1. **Залежності.** `git`, Rust (rustup), Go ≥ 1.27, `node`, Xcode Command Line Tools (`xcode-select --install`).
2. **Код:** `git clone https://github.com/gitkalenyuk/CarteLink.git && cd CarteLink` (якщо вже є — `git pull`).
3. **Перевірка:** `bash scripts/mac-setup.sh` — тести, clippy, `node --check`, `./cartelink`.
4. **Реліз:** `bash scripts/build-mac-app.sh` → `dist/CarteLink.app` (universal) і три `.dmg`. Реліз — у публічний
   `gitkalenyuk/CarteLink`, тег `v<версія>-mac`, разом з `INSTALL-MACOS.md` і `INSTALL-MACOS-AI.md`.
5. **Перевір наживо:** `open dist/CarteLink.app`, потім `curl -s http://127.0.0.1:8317/api/status` → `"version":"3.0.0"`.
   Перевір Cmd+C/Cmd+V у вікні.

## Правила проєкту

- Збірка: `cargo build --release` (потрібні Rust і Go). Exe: `target/release/cartelink.exe` → копіювати в
  `Desktop\CarteLink_extras\builds\CarteLink_v<версія>.exe`. Якщо запущений CarteLink використовується сесією
  Claude — тестуй окрему копію з ізольованим `CARTELINK_HOME` і `--port`.
- Швидка збірка без Go: `CARTELINK_ENGINE_BIN=<готовий engine.exe> cargo build`.
- Перевірки: `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check`, `go vet ./enginehost`, `node --check ui/js/**/*.js`.
- Сучасний Rust: let-chains, `jiff` для часу, `getrandom` для ключів, `serde_norway` для YAML (не `serde_yaml`/`serde_yml`).
- Тест UI наживо: `.claude/launch.json` → `cartelink-dev` (білд у `%TEMP%\cl-dev`, ізольовані `CARTELINK_HOME` і
  `CARTELINK_CLIENT_HOME` — «Підключити одним кліком» не чіпає справжні ~/.claude і ~/.codex; порт 8419). Наскрізні тести:
  `node Desktop\CarteLink_extras\tests\e2e3.js` (проти 8419, 66 перевірок).
- `third_party/CLIProxyAPI` — чистий реліз апстріму (зараз **7.3.20**); оновлення = заміна теки + `UpstreamVersion`
  в `enginehost/main.go`. Рушій 8.x — шлях модуля `/v8` (імпорти, go.mod, linkname). Не редагувати апстрім.
- `config.yaml` має страховку `config.yaml.bak`; порожній/зламаний файл відновлюється (`sync_config_yaml`).
  Керовані ключі: host, port, remote-management, auth-dir, api-keys, claude-code.disable-cloaking-model-list,
  plugins.enabled/dir, usage-statistics, redis-usage-queue-retention-seconds. Bcrypt-хеш секрету рушія не
  перезаписується, поки секрет той самий (`.secret-mark`).
- Management API: PUT для списків замінює весь список — завжди GET → змінити → PUT (або PATCH за `name`).
- Префікс `провайдер:` знімає лише `config::strip_provider_prefix` (відомі провайдери): `qwen3:32b` лишається.
- Мапінг: ніяких підрядків. Нові аліаси — у `config::TIER_ALIASES`. Провайдери з API-ключем — у `presets.js`, програми — у `clients.js`.
- `usage-queue` вичитує **лише** бекенд (`tasks::metrics_loop`).
- Не комітити бінарники, `target/`, `data/`, `dist/`, логи, `.py`, картинки (див. `.gitignore`).
- Git: коміти на `main`, `origin` = публічний `gitkalenyuk/CarteLink` (MIT, сайт у `docs/` → GitHub Pages). `CartelGateGo` — архів (не пушити).
  Публічний `gitkalenyuk/cartelgate` — лише для релізних білдів. Авто-оновлювача немає.
- JevRouter видалено назавжди (2026-09-22) — не повертати. OpenCode (Zen/Go) — лише через плагіни магазину.
- Зайве (тестові скрипти, картинки, старі збірки) — поза репо: `Desktop\CarteLink_extras\`.
