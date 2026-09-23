# Changelog

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
