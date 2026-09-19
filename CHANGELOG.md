# Changelog

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
