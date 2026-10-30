# Changelog

## 2.6.0 — магазин плагінів і вибір плагіна для входу, WorkBuddy

- **Нова сторінка «Плагіни».** Увесь магазин плагінів рушія: пошук, фільтри «Сервіси», «Інструменти», «Встановлені», встановлення, оновлення, вимкнення, консоль і видалення. Список береться з магазину наживо. Не показується лише `opencode-cloak`: він маскує трафік OpenCode під Claude Code.
- **Вибір плагіна для входу.** На сторінці «Акаунти» кнопка сервісу відкриває список плагінів, що його підтримують: автор, версія, опис, посилання на GitHub. Обраний плагін завантажується, і вхід іде через нього. Для одного сервісу працює один плагін: перед перемиканням CarteLink питає, чи вимкнути попередній.
- **WorkBuddy / CodeBuddy.** Плагін на вибір: `workbuddy` (CodeBuddy Intl CPA) або `freetier2api`. Для `workbuddy` CarteLink одразу вимикає автовидалення акаунта без кредитів, автоотримання щоденних кредитів і щоденні відмітки.
- **Більше сервісів.** З'явилися GitHub Copilot і Cursor для Windows через плагіни з такою збіркою, а також OpenCode Go та безкоштовний OpenCode Zen. Нові плагіни-провайдери з магазину додаються до списку самі.
- **Плагіни без своєї сторінки входу.** Для них CarteLink показує форму з їхніми налаштуваннями.

## 2.5.3 — окремі API-ключі з власними моделями, панель лише на цьому комп'ютері

- **Нова сторінка «API-ключі» і кнопка «Додати API».** Назва, вибір однієї чи кількох моделей — і окремий ключ (`cl-api-…`) зі спільною адресою. Список, перейменування, зміна моделей, копіювання ключа, видалення.
- **Кожен ключ показує й приймає лише свої моделі.** `/v1/models`, список Gemini і каталог Codex показують тільки їх; запит до іншої моделі отримує 403 `model_not_allowed`. Перевіряються всі місця, де можна передати ключ, і дублікат `model` у тілі запиту.
- **Ключі незалежні.** Обрана модель іде напряму, без рівнів, моделі за замовчуванням і перемикача; такі запити не чіпають автоперемикання пресетів. Чорний список і системний промпт діють і для цих ключів.
- **Лише маршрути, де модель можна перевірити.** WebSocket `/v1/responses`, realtime, відео, `/backend-api/codex` тощо для таких ключів закриті (403 `endpoint_not_allowed`). Видалений ключ відхиляється одразу (401).

**Безпека: панель і control API лише на цьому комп'ютері**
- **Закрито витік ключів у мережу.** З Host `0.0.0.0` будь-хто в мережі міг без авторизації прочитати `GET /api/config` (ключ шлюзу, секрет Management API) і змінити налаштування. Якщо ти вмикав такий режим у ненадійній мережі, заміни ключ шлюзу.
- **Іншим пристроям тепер доступне лише API моделей.** `/v1/*`, `/v1beta/*`, `/models`, `/openai/v1/*`, `/backend-api/codex/*` за ключем і `/healthz`. Решта, зокрема `/api/*`, `/ui/`, Management API, OAuth-колбеки й нові маршрути рушія, відповідає 403 `local_only`.
- **Закрито DNS rebinding.** Сторінка з будь-якого сайту могла підмінити DNS свого домену на `127.0.0.1` і прочитати `/api/config` прямо з браузера користувача. Тепер `/api/*` і консолі плагінів приймають лише `localhost`, IP-адресу або Host із Налаштувань.
- **Зміна поведінки:** панель більше не відкривається з іншого комп'ютера. На самому комп'ютері все працює як раніше: вікно, друга копія, адреси `127.0.0.1` і власна адреса машини.

**Host = конкретна адреса (наприклад, `192.168.1.50`)**
- **Сторінки «Акаунти» і «Статистика» знову працюють.** Рушій відмовляв панелі з 403 `remote management disabled`, бо вона приходила не з `127.0.0.1`. Для інших адрес Management API так само закритий.
- **Друга копія й каталог моделей знаходять шлюз.** Вони ходили лише на `127.0.0.1`, де шлюз у цьому режимі не слухає. Тому повторний запуск не бачив першу копію, а «розумний» fallback лишався без списку моделей.
- **Після перезапуску шлюзу з новим Host чи портом** повторний запуск теж знаходить запущену копію (`instance.json` оновлюється).

## 2.5.2 — рівень «Ультра» з Codex, фільтри провайдерів, збереження сторінки «Моделі»

- **Рівень думання підганяється під модель.** Codex 0.159 шле рівень `ultra`, якого рушій не знає (400
  `level "ultra" not supported`). CarteLink завжди (незалежно від перемикача думання) замінює рівень, якого
  немає в цільової моделі, на найближчий наявний: `reasoning.effort`, `configuration_update`,
  `reasoning_effort`, `output_config.effort`, суфікс `model(…)`. Моделі Codex, яким рушій пересилає
  запит як є (gpt-6-astra/sol/luna), отримують `ultra` без змін.
- **Відмова фільтра вмісту більше не блокує ключ.** Рушій ставив ключ на паузу після `content_filter`, і
  наступні запити падали з `auth_unavailable`. Тепер CarteLink одразу знімає паузу з ключа, що обслужив
  відхилений запит. Підказки журналу помилок для `content_filter` і `auth_unavailable` стали точними.
- **Сторінка «Моделі» не перезаписує чужих змін.** «Зберегти» пише лише поля, які ти змінив на формі;
  те, що змінилось деінде (перемикач, пресети на Огляді, інше вікно), лишається. Так само для сторінки
  системного промпту й налаштувань шлюзу. Раніше так «Невідомі моделі» тихо ставали «Передавати як є».

## 2.5.1 — Kiro, контекстне вікно, «Замінити» для Codex

**Kiro: моделі, яких немає в тарифі акаунта**
- Безкоштовні акаунти Kiro (AWS Builder ID) не можуть запитати в Kiro список своїх моделей, тому плагін
  показує всі 10, а Kiro відхиляє їх з `INVALID_MODEL_ID`. Ті самі назви роздає й акаунт Claude, тож
  частина запитів по черзі падала на Kiro. Тепер CarteLink після першої такої відмови сам ховає модель
  для Kiro (той самий список, що «Акаунти → моделі → сховати», повертається там же) і пише про це в
  журнал помилок; наступні запити йдуть на акаунти, де модель є.

**Контекстне вікно**
- Claude Code для незнайомих назв завжди рахує 200K і не читає ліміти з `/v1/models`; єдине, що він
  враховує, — суфікс `[1m]`. Тепер пункт «CarteLink: …» у `/model` отримує `[1m]` (і позначку «· 1M»),
  якщо реальне вікно моделі 1M+. CarteLink прибирає `[1m]` з назви, якщо програма пришле його.
- Codex показує своє вікно (272K × 95% ≈ 258K). Інструкція на сторінці «Підключити програму» тепер
  пише в `config.toml` `model_context_window` і `model_auto_compact_token_limit` зі справжнім вікном
  обраної моделі (новий `GET /api/model-context?model=…`).
- `/v1/models` для Anthropic-клієнтів повертає реальні `max_input_tokens` / `max_tokens` моделі, на яку
  веде назва, замість фіксованих 200000/64000. Запит Codex-каталогу (`?client_version=`) більше не
  переробляється у формат OpenAI — віддається каталог рушія як є.

**Системний промпт → «Замінити промпт програми повністю» для Codex**
- Codex тримає свій справжній системний промпт («You are Codex…», дозволи, контекст застосунку) не в
  `instructions`, а в developer-повідомленнях у `input`. Режим «Замінити» тепер прибирає і їх — інакше
  ідентичність Codex ішла одразу після твого промпту.

## 2.5.0 — системний промпт, AGENT.md, рівень думання, новий перемикач

**Системний промпт** (нова сторінка в меню «Керування»)
- Свій системний промпт до кожного запиту — з будь-якої програми (Claude Code, Codex, Cursor…).
  Режими: спочатку мій / спочатку програми / замінити повністю; для всіх, лише Anthropic чи лише OpenAI.
- **AGENT.md**: завантаж файл із правилами проєкту — додається після промпту.
- Працює для всіх трьох форматів: `/v1/messages` (system), `/v1/chat/completions` (system-повідомлення),
  `/v1/responses` (instructions).
- **Рівень думання** (вимкнено / низький / середній / високий / максимальний / динамічний) або свій бюджет
  токенів — окремий перемикач, працює й без системного промпту. Надсилається **лише моделям, які це
  підтримують**: CarteLink визначає це сам з каталогу моделей рушія (`/api/model-info`) — і бюджетні моделі
  (Gemini, Haiku 4.5, Opus 4.6), і моделі з рівнями (Opus/Sonnet 5.5, Codex). Передається суфіксом моделі
  `model(high)` у єдиний шар думання рушія, який сам перекладає його під кожного провайдера. Власний вибір
  програми лишається, якщо не ввімкнено «Перекривати». Перевірено наживо на 8 моделях.

**Перемикач моделей поверх вікон** — редизайн
- Компактніший: рядок пресета = номер (застосувати) + список моделей; активний пресет підсвічений.
- Новий перемикач **«Змінити модель після першого вдалого запиту до моделі 1»**: після першої
  успішної відповіді моделі 1 усе автоматично переходить на модель 2 (одноразово; повернення на 1
  знову «заряджає» перемикач).

## 2.4.0 — перемикач моделей, моделі акаунтів, нові акаунти, журнал помилок, 17 мов

**Новий дизайн**
- Повний редизайн: спокійна темна консоль рівня Linear / Vercel / Raycast / Stripe. Сайдбар із
  двох груп (Шлюз / Керування), іконки замість емодзі, нова сторінка «Огляд»: модель, що відповідає
  зараз, швидке перемикання й пресети 1/2, стан шлюзу з адресою та ключем, KPI, графік активності
  за 24 години, акаунти й останні помилки. Сцена запуску, плавна поява сторінок, скелетони,
  анімовані лічильники, мікроанімації. Система задокументована в `DESIGN.md`, продукт — у `PRODUCT.md`.

**Надійність** (знайдено живим тестуванням)
- `config.yaml`: обрізаний/порожній файл більше не стирає провайдерів і плагіни — CarteLink тримає
  останню справну копію `config.yaml.bak` і відновлюється з неї (зламаний файл зберігається окремо).
- Порожні `cartelink-fast/main/max` тепер беруть модель з Haiku/Sonnet/Opus або моделі за
  замовчуванням (раніше пункт для Claude Code `/model` не з'являвся).

**Рушій**
- CLIProxyAPI оновлено 7.3.5 → **7.3.20**: маскування під Claude Code **2.1.280** (Anthropic
  пускає до Opus 5.5 лише з цієї версії — раніше було 400 «Claude Code 2.1.258 does not support
  this model»). Окрема збірка на рушії 8.0.4 (`CarteLink_v2.4.0_engine8.exe`) — як запасний варіант.

**Моделі**
- Нові моделі Claude: **Opus 5.5** (`claude-opus-5-5`), **Sonnet 5.5** (`claude-sonnet-5-5`),
  Haiku 4.5 (20251001) — у точкових підмінах, у `/v1/models` і в пресеті Anthropic.
- **«Одна модель для всього»** тепер міняє все: рівні, модель за замовчуванням, **точкові
  підміни** і рядки таблиці (раніше точкові підміни лишались старими).
- **Свої точкові підміни**: назва + модель від програми → заміна (сторінка «Моделі»).
  Порожня підміна показує, яку модель дасть рівень («— за рівнем: … —»).
- **Моделі акаунтів** (сторінка «Акаунти»): сховати модель ✕ (зникає з усіх списків і
  не обслуговується, повертається одним кліком) і **додати свою назву моделі**, на яку
  відповідає обрана модель акаунта (рушій: `oauth-excluded-models` / `oauth-model-alias`).

- **Каталог моделей рушія оновлюється з мережі** (при старті й кожні 3 год): нові моделі
  акаунтів (Claude Opus 5.5 / Sonnet 5.5 тощо) з'являються без нової збірки CarteLink.
  Раніше вбудований рушій знав лише список, зашитий у бінарник.
- **Claude Code `/model`**: пункт «CarteLink: <основна модель>» (та fast/max, якщо
  відрізняються) через `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` — змінна додана в
  інструкцію Claude Code. Аліаси `claude-cartelink-main/fast/max`.
- Списки вибору моделей містять і «Інші моделі рушія» (плагіни, рідні ключі).

**Нові акаунти через плагіни рушія** (сторінка «Акаунти» → «Більше акаунтів»)
- Gemini CLI, Kiro (AWS, код підтвердження показується), Mirasim — вхід через браузер;
  Cline Pass — консоль плагіна; CommandCode — API-ключ; Vertex AI — імпорт JSON-ключа.
  Плагін завантажується з офіційного магазину при першому підключенні (з підтвердженням),
  без перезапуску. Copilot і Cursor показані, але недоступні: їхні плагіни є лише для Linux.

**Перемикач моделей поверх усіх вікон** (Windows)
- Вмикається на Головній (або з меню трею). Маленьке вікно, яке можна перетягувати:
  дві моделі зі списку всіх акаунтів/провайдерів і кнопка **⇄ Перемкнути** — модель
  міняється одразу для всього. Працює, навіть коли CarteLink згорнутий у трей;
  позиція запам'ятовується, хрестик ховає вікно.

**Журнал помилок**
- Кожна помилка запиту від програм (код, модель запиту → фактична, текст провайдера)
  пишеться в `data/errors.jsonl` і в `app.log`; «Статистика → Журнал помилок» з
  підказками, що робити, експортом і очищенням. Однакові помилки підряд зливаються.

**Мови**
- Головна: «Основна модель» оновлюється сама (після перемикача), виправлено вигляд перемикачів.
- Інтерфейс, перемикач і трей перекладені на 16 мов: English, 中文, हिन्दी, Español,
  Français, العربية, বাংলা, Português, اردو, Bahasa Indonesia, Deutsch, 日本語, Türkçe,
  한국어, Tiếng Việt, Polski (+ українська). Вибір — унизу бічної панелі або в Налаштуваннях.

## 2.3.0 — «налаштував і забув»

**Зручність**
- Нова **Головна**: статус, адреса й ключ в одному місці, майстер «3 кроки» (акаунт →
  основна модель → програма), що сам відмічає виконані кроки.
- Сторінка **«Підключити програму»**: ~24 програми (Claude Code, Codex CLI, Gemini CLI,
  Cursor, Cline, Roo, Kilo, Continue, Aider, OpenCode, Zed, Copilot, JetBrains, Open WebUI…)
  з готовими командами для PowerShell / CMD / macOS-Linux (на сеанс або назавжди) і
  файлами налаштувань з уже підставленими адресою та ключем.
- **Трей** (Windows): закриття вікна ховає програму, шлюз працює далі; «Вийти» — з меню трею.
- **Автозапуск** разом із системою (Windows / macOS / Linux), старт згорнутим.
- **Одна копія**: повторний запуск показує вже відкрите вікно замість другого шлюзу.
- **Порт більше не «пливе»**: якщо 8317 зайнятий, інший порт використовується лише на
  цей запуск і не зберігається; збережений раніше авто-порт (8318…8417) повертається на 8317.
- Налаштування зібрані в одному місці (без дублів на «Сервері» та «Акаунтах»),
  небезпечні дії питають підтвердження, помилки збереження показуються (раніше завжди «✓»).
- Прибрано сленг і старі назви з інтерфейсу; «Про програму» → коротка «Довідка».

**Моделі**
- Два режими на вибір: **Рівні** (Claude Code Haiku/Sonnet/Opus + універсальні
  `cartelink-fast/main/max` для інших програм) і **Таблиця** («модель від програми → реальна
  модель», з `*`). Старі поля Cursor/Codex/Windsurf переносяться автоматично.
- Виправлено: правило `mini` перехоплювало **всі** `gemini-*` моделі (а `fast`, `small`,
  `o1`, `o3`, `reason` — інші). Тепер лише точні аліаси.
- «Невідомі моделі»: **розумний** режим — на модель за замовчуванням лише якщо такої
  моделі немає в рушії. Раніше опція «перенаправляти» нічого не робила.
- Мапінг діє також для `/v1/responses` (Codex), `/v1/completions`, `count_tokens`.
- `/v1/models` показує лише моделі, що реально працюють.

**Доступ**
- Гейт Telegram зашитий у програму: його не вимкнути й не перенаправити через `config.json`.
- Перевіряється окрема група CarteLink (`appId: cartelink` → `APP_GROUP_CARTELINK` на брокері),
  тріал не пускається.
- Без інтернету сесія, перевірена за останні 24 год, працює далі; потім — екран «Немає зв'язку».
- Нескінченний спінер входу виправлено; UI блокується, якщо доступ відкликали.
- `@username` більше не губиться після перевірки на брокері.

**Інше**
- Статистику збирає лише бекенд (UI більше не «з'їдає» записи з черги); запис атомарний.
- Рідні API-ключі (Claude/Gemini/Codex/xAI/Meta) — додавання й список знову працюють.
- Зміна ключа в налаштуваннях вимикає старий ключ; видалені акаунт-провайдери не
  повертаються самі й не вмикаються примусово.
- macOS: нативне вікно (WKWebView, cgo) з меню «Редагування», `scripts/build-mac-app.sh`
  збирає універсальний `CarteLink.app` і `.dmg`.
- `--port N` діє лише на поточний запуск (раніше зберігався в config.json).
- Міграція старих даних більше не копіює кеші браузера й файли Electron-епохи.
- Видалено: невикористовуваний `broker/`, код JevRouter, що лишився.

## 2.2.0

- Мапінг рівнів для Cursor / Codex / Windsurf (замінено в 2.3.0).
- Постійне сховище статистики `data/metrics.json`, кнопки «Очистити» та «Експорт».
- Заборона кешування UI у WebView2; `@username` у боковій панелі.
- JevRouter додано й повністю видалено.

## 2.1.0 — CarteLink

- Ребрендинг CartelGate → **CarteLink** (ключі `cl-`, дані `%AppData%\CarteLink` з міграцією).
- Вхід через Telegram для учасників Secret YT_cartel 🧠, 403 для `/v1/*` без входу,
  перевірка членства кожні 5 хв.
- Без вікна консолі; стійкіша обробка OAuth; автооновлення прибрано — оновлення роздаються вручну.

## 2.0.0 — CartelGate

Rebrand of VisionGateGo to **CartelGate** (by YouTube Cartel) plus the Providers rework.

- **Rebrand:** new name, logo, crimson/amber dark theme, `CartelGate.exe`,
  `CARTELGATE_HOME` (the legacy `VISIONGATE_HOME` still works), data dir
  `%AppData%\CartelGate` with automatic one-time migration from `VisionGateGo`
  (auths + settings; logs and the WebView2 cache are skipped). Generated keys
  are `cg-…`, management secrets `cg-mgmt-…`; old `vg-…` keys keep working.
- **Provider presets:** 70+ OpenAI-compatible endpoints (OpenAI, Anthropic
  compat, Gemini compat, xAI, Mistral, DeepSeek, OpenRouter, Groq, Cerebras,
  SambaNova, Together, Fireworks, DeepInfra, NVIDIA NIM, GitHub Models,
  Hugging Face, Vercel AI Gateway, Azure, Bedrock, Cloudflare, Qwen, GLM, Kimi,
  MiniMax, SiliconFlow, Ollama, LM Studio, vLLM, llama.cpp…) with search,
  groups, key links and starter model lists.
- **Providers are editable:** edit name/URL/keys/models/prefix/headers, enable/
  disable, delete. «Підтягнути список моделей» fetches `<base-url>/models`
  through the new `/api/provider-models` endpoint. Several keys per provider
  (one per line) rotate inside the engine.
- **Bug fixes (Providers):** the engine returns `{"openai-compatibility": […]}`,
  so the list never rendered; adding a provider used PUT (which *replaces* the
  list) and silently wiped the previous ones. Both fixed; engine providers'
  aliases now show up in the Models page dropdowns.
- **OAuth window:** Edge/Chrome is launched with a dedicated temporary
  `--user-data-dir` in private mode, so it is a separate process — clean
  session every time and the window really closes when the login completes
  (before, the kill hit a stub process when the browser was already open).
  The About text now describes the real behaviour.
- **Config cleanup:** dead Electron-era fields (port, autoStart, startMinimized,
  theme, accent, vision, provider binaryPath) removed from `config.json`.

## 1.0.0

Clean restart of the Go project (VisionGateGo2). Fixes on top of the last 1.0.4 build:

- **Security:** the control API (`/api/*`) rejects cross-origin browser requests
  (Origin/Sec-Fetch-Site + Host check). Before, any web page could read the
  API key or drive the Management API passthrough through CORS `*`.
- **config.yaml sync:** only the keys VisionGate owns (host, port, secret,
  auth-dir, api-keys, claude-code cloaking) are rewritten; everything the
  engine's Management API persisted (providers, keys, routing strategy) is kept.
  "Require key", key changes and the extra YAML now reach the engine even after
  management edits. Invalid extra YAML is rejected on save.
- **Real restart:** "Перезапустити" tears the engine down and rebuilds it, so a
  saved port/host change applies without restarting the exe; the UI follows the
  engine to the new port.
- **Pause mode:** the Management API stays reachable while API traffic is paused,
  so the Accounts/Providers pages keep working when "stopped".
- **Wildcard hosts:** `0.0.0.0` / `::` no longer break startup, endpoints or
  the management passthrough (`DisplayHost`).
- **Model blacklist** is enforced on `/v1/messages` and `/v1/chat/completions`
  (400), not only hidden from `/v1/models`.
- **Statistics page** decodes the engine's usage records (they arrive as JSON
  strings) and keeps history in localStorage across reloads.
- Corrupt `config.json` is backed up as `config.json.corrupt-<time>` and the
  user is warned instead of silently regenerating keys.
- `app.log` rotates at 5 MB; `--port` override is no longer persisted after a
  port move; "Generate key" retires the old key and no longer mutates live config.
- UI: `esc()` escapes quotes, snippet keeps the key after changing the default
  model, OAuth polling times out after 10 min, port texts say 8317.
