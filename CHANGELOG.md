# Changelog

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
