'use strict';
// API list prices, USD per 1M tokens. Checked 2026-11-16 from the official pricing pages.
// Matched by model id: the first entry whose `match` regexp matches the lower-cased model id wins
// (put more specific entries first). `cached` = price of cached-input (cache read) tokens; omit if the
// vendor has no separate price. Estimates only — shown to the user as approximate.
// Where a price depends on prompt size, the lowest (short-prompt) tier is used and noted.
// `(?!-\d\b)` after a version keeps e.g. `claude-opus-5` from matching `claude-opus-5-5`
// while still allowing date suffixes like `claude-opus-4-20250514`.
window.CL_PRICES = {
  checked: '2026-11-16',
  sources: {
    anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
    openai: 'https://developers.openai.com/api/docs/pricing',
    google: 'https://aistudio.google.com/docs/pricing',
    xai: 'https://docs.x.ai/docs/models',
    deepseek: 'https://api-docs.deepseek.com/quick_start/pricing',
    zai: 'https://docs.z.ai/guides/overview/pricing',
    qwen: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    moonshot: 'https://kimi.com/resources/kimi-k3-pricing',
  },
  models: [
    // ── Anthropic ── (1M context at standard price for 4.6+; cache read = 0.1x input unless noted)
    { match: '^claude-(fable|mythos)-5-2', vendor: 'anthropic', name: 'Claude Fable/Mythos 5.2', input: 8, output: 40, cached: 0.2 },
    { match: '^claude-(fable|mythos)-5-1', vendor: 'anthropic', name: 'Claude Fable/Mythos 5.1', input: 10, output: 50, cached: 0.25 },
    { match: '^claude-(fable|mythos)-5(?!-\\d\\b)', vendor: 'anthropic', name: 'Claude Fable/Mythos 5', input: 10, output: 50, cached: 1 },
    { match: '^claude-opus-5-5', vendor: 'anthropic', name: 'Claude Opus 5.5', input: 4, output: 20, cached: 0.2 },
    { match: '^claude-opus-5(?!-\\d\\b)', vendor: 'anthropic', name: 'Claude Opus 5', input: 5, output: 25, cached: 0.5 },
    { match: '^claude-opus-4-[5-8]', vendor: 'anthropic', name: 'Claude Opus 4.5–4.8', input: 5, output: 25, cached: 0.5 },
    { match: '^claude-opus-4-1', vendor: 'anthropic', name: 'Claude Opus 4.1', input: 15, output: 75, cached: 1.5 },
    { match: '^claude-opus-4(?!-\\d\\b)', vendor: 'anthropic', name: 'Claude Opus 4', input: 15, output: 75, cached: 1.5 },
    { match: '^claude-sonnet-5-5', vendor: 'anthropic', name: 'Claude Sonnet 5.5', input: 2, output: 10, cached: 0.1 },
    { match: '^claude-sonnet-5(?!-\\d\\b)', vendor: 'anthropic', name: 'Claude Sonnet 5', input: 2, output: 10, cached: 0.2 },
    { match: '^claude-sonnet-4-[56]', vendor: 'anthropic', name: 'Claude Sonnet 4.5/4.6', input: 3, output: 15, cached: 0.3 },
    { match: '^claude-sonnet-4(?!-\\d\\b)', vendor: 'anthropic', name: 'Claude Sonnet 4', input: 3, output: 15, cached: 0.3 },
    // Haiku 5.5: prompts ≤100K tokens (over 100K: 0.50 / 2.50 / 0.05).
    { match: '^claude-haiku-5-5', vendor: 'anthropic', name: 'Claude Haiku 5.5', input: 0.1, output: 0.5, cached: 0.01 },
    { match: '^claude-haiku-4-5', vendor: 'anthropic', name: 'Claude Haiku 4.5', input: 1, output: 5, cached: 0.1 },

    // ── OpenAI ── (short-context tier, ≤272K input; long-context tier is ~2x input)
    { match: '^gpt-6-astra', vendor: 'openai', name: 'GPT-6 Astra', input: 10, output: 50, cached: 1 },
    { match: '^gpt-6\\.1-sol', vendor: 'openai', name: 'GPT-6.1 Sol', input: 2, output: 10, cached: 0.1 },
    { match: '^gpt-6\\.1-terra', vendor: 'openai', name: 'GPT-6.1 Terra', input: 1, output: 5, cached: 0.05 },
    { match: '^gpt-6-sol', vendor: 'openai', name: 'GPT-6 Sol', input: 2, output: 10, cached: 0.2 },
    { match: '^gpt-6-luna', vendor: 'openai', name: 'GPT-6 Luna', input: 0.1, output: 0.5, cached: 0.01 },
    { match: '^gpt-5\\.6-sol', vendor: 'openai', name: 'GPT-5.6 Sol', input: 4, output: 20, cached: 0.4 },
    { match: '^gpt-5\\.6-terra', vendor: 'openai', name: 'GPT-5.6 Terra', input: 2, output: 12, cached: 0.2 },
    { match: '^gpt-5\\.6-luna', vendor: 'openai', name: 'GPT-5.6 Luna', input: 0.2, output: 1.2, cached: 0.02 },
    { match: '^gpt-5\\.5-pro', vendor: 'openai', name: 'GPT-5.5 Pro', input: 30, output: 180 },
    { match: '^gpt-5\\.5', vendor: 'openai', name: 'GPT-5.5', input: 5, output: 30, cached: 0.5 },
    { match: '^chat-latest', vendor: 'openai', name: 'ChatGPT chat-latest', input: 5, output: 30, cached: 0.5 },
    { match: '^gpt-5\\.4-pro', vendor: 'openai', name: 'GPT-5.4 Pro', input: 30, output: 180 },
    { match: '^gpt-5\\.4-mini', vendor: 'openai', name: 'GPT-5.4 mini', input: 0.75, output: 4.5, cached: 0.075 },
    { match: '^gpt-5\\.4-nano', vendor: 'openai', name: 'GPT-5.4 nano', input: 0.2, output: 1.25, cached: 0.02 },
    { match: '^gpt-5\\.4', vendor: 'openai', name: 'GPT-5.4', input: 2.5, output: 15, cached: 0.25 },
    { match: '^gpt-5\\.3-codex', vendor: 'openai', name: 'GPT-5.3 Codex', input: 1.75, output: 14, cached: 0.175 },
    { match: '^gpt-5\\.2-pro', vendor: 'openai', name: 'GPT-5.2 Pro', input: 21, output: 168 },
    // gpt-5.2 / gpt-5.1 / gpt-5 below also catch their -codex / -codex-max / -chat variants
    // (no longer listed separately; they launched at the base model's price).
    { match: '^gpt-5\\.2', vendor: 'openai', name: 'GPT-5.2', input: 1.75, output: 14, cached: 0.175 },
    { match: '^gpt-5\\.1', vendor: 'openai', name: 'GPT-5.1', input: 1.25, output: 10, cached: 0.125 },
    { match: '^gpt-5-mini', vendor: 'openai', name: 'GPT-5 mini', input: 0.25, output: 2, cached: 0.025 },
    { match: '^gpt-5-nano', vendor: 'openai', name: 'GPT-5 nano', input: 0.05, output: 0.4, cached: 0.005 },
    { match: '^gpt-5-pro', vendor: 'openai', name: 'GPT-5 Pro', input: 15, output: 120 },
    { match: '^gpt-5(?![.\\d])', vendor: 'openai', name: 'GPT-5', input: 1.25, output: 10, cached: 0.125 },
    { match: '^gpt-4\\.1-mini', vendor: 'openai', name: 'GPT-4.1 mini', input: 0.4, output: 1.6, cached: 0.1 },
    { match: '^gpt-4\\.1(?!-nano)', vendor: 'openai', name: 'GPT-4.1', input: 2, output: 8, cached: 0.5 },
    { match: '^gpt-4o-mini', vendor: 'openai', name: 'GPT-4o mini', input: 0.15, output: 0.6, cached: 0.075 },
    { match: '^gpt-4o', vendor: 'openai', name: 'GPT-4o', input: 2.5, output: 10, cached: 1.25 },
    { match: '^o3-pro', vendor: 'openai', name: 'o3-pro', input: 20, output: 80 },
    { match: '^o3(?!-mini)', vendor: 'openai', name: 'o3', input: 2, output: 8, cached: 0.5 },

    // ── Google Gemini ── (paid tier, Standard; output includes thinking; cached = context-cache read)
    // Gemini 4 Carbon/Argon: introductory price through 2026-11-30, then 4 / 20 / 0.20.
    { match: '^gemini-4-carbon', vendor: 'google', name: 'Gemini 4 Carbon', input: 2, output: 10, cached: 0.1 },
    { match: '^gemini-4-argon', vendor: 'google', name: 'Gemini 4 Argon', input: 2, output: 10, cached: 0.1 },
    { match: '^gemini-4-hydrogen', vendor: 'google', name: 'Gemini 4 Hydrogen', input: 1.5, output: 7.5, cached: 0.075 },
    // 3.8 / 3.6 Flash: price through 2026-12-31, then 1.50 / 7.50 / 0.15.
    { match: '^gemini-3\\.8-flash(?!-lite)', vendor: 'google', name: 'Gemini 3.8 Flash', input: 0.75, output: 3.75, cached: 0.075 },
    { match: '^gemini-3\\.6-flash(?!-lite)', vendor: 'google', name: 'Gemini 3.6 Flash', input: 0.75, output: 3.75, cached: 0.075 },
    { match: '^gemini-3\\.5-flash-lite', vendor: 'google', name: 'Gemini 3.5 Flash-Lite', input: 0.3, output: 2.5, cached: 0.03 },
    // 3.1 Pro: prompts ≤200K tokens (higher price above 200K).
    { match: '^gemini-3\\.1-pro', vendor: 'google', name: 'Gemini 3.1 Pro', input: 2, output: 12, cached: 0.2 },
    { match: '^gemini-3\\.1-flash-lite', vendor: 'google', name: 'Gemini 3.1 Flash-Lite', input: 0.25, output: 1.5, cached: 0.025 },
    { match: '^gemini-3-flash', vendor: 'google', name: 'Gemini 3 Flash', input: 0.5, output: 3, cached: 0.05 },
    // 2.5 Pro: prompts ≤200K tokens (higher price above 200K).
    { match: '^gemini-2\\.5-pro', vendor: 'google', name: 'Gemini 2.5 Pro', input: 1.25, output: 10, cached: 0.125 },
    { match: '^gemini-2\\.5-flash-lite', vendor: 'google', name: 'Gemini 2.5 Flash-Lite', input: 0.1, output: 0.4, cached: 0.01 },
    { match: '^gemini-2\\.5-flash', vendor: 'google', name: 'Gemini 2.5 Flash', input: 0.3, output: 2.5, cached: 0.03 },

    // ── xAI Grok ── (prompts <200K tokens; ≥200K is 2x for the whole request)
    { match: '^grok-4\\.7', vendor: 'xai', name: 'Grok 4.7', input: 2, output: 6, cached: 0.5 },
    { match: '^grok-4\\.6', vendor: 'xai', name: 'Grok 4.6', input: 2, output: 6, cached: 0.5 },
    { match: '^grok-4\\.5', vendor: 'xai', name: 'Grok 4.5', input: 2, output: 6, cached: 0.3 },
    { match: '^grok-4\\.3', vendor: 'xai', name: 'Grok 4.3', input: 1.25, output: 2.5, cached: 0.2 },
    { match: '^grok-4\\.20', vendor: 'xai', name: 'Grok 4.20', input: 1.25, output: 2.5, cached: 0.2 },
    { match: '^grok-build', vendor: 'xai', name: 'Grok Build', input: 1, output: 2, cached: 0.2 },

    // ── DeepSeek ── (off-peak price; peak hours, 01–04 and 06–10 UTC on weekdays, cost 2x)
    { match: '^deepseek-v4-pro', vendor: 'deepseek', name: 'DeepSeek V4 Pro', input: 0.66, output: 1.98, cached: 0.022 },
    { match: '^deepseek-(v4-)?flash', vendor: 'deepseek', name: 'DeepSeek Flash', input: 0.15, output: 0.6, cached: 0.003 },

    // ── Z.ai GLM ──
    { match: '^glm-5\\.3-flashx', vendor: 'zai', name: 'GLM-5.3 FlashX', input: 0.37, output: 1.25, cached: 0.075 },
    { match: '^glm-5\\.3-flash', vendor: 'zai', name: 'GLM-5.3 Flash', input: 0.15, output: 0.5, cached: 0.03 },
    { match: '^glm-5\\.[123]', vendor: 'zai', name: 'GLM-5.1–5.3', input: 1.4, output: 4.4, cached: 0.26 },
    { match: '^glm-5(?![.\\d])', vendor: 'zai', name: 'GLM-5', input: 1, output: 3.2, cached: 0.2 },
    { match: '^glm-4\\.7-flashx', vendor: 'zai', name: 'GLM-4.7 FlashX', input: 0.07, output: 0.4, cached: 0.01 },
    { match: '^glm-4\\.[57]-flash', vendor: 'zai', name: 'GLM-4.5/4.7 Flash (free)', input: 0, output: 0, cached: 0 },
    { match: '^glm-4\\.5-airx', vendor: 'zai', name: 'GLM-4.5 AirX', input: 1.1, output: 4.5, cached: 0.22 },
    { match: '^glm-4\\.5-air', vendor: 'zai', name: 'GLM-4.5 Air', input: 0.2, output: 1.1, cached: 0.03 },
    { match: '^glm-4\\.5-x', vendor: 'zai', name: 'GLM-4.5 X', input: 2.2, output: 8.9, cached: 0.45 },
    { match: '^glm-4\\.[567]', vendor: 'zai', name: 'GLM-4.5–4.7', input: 0.6, output: 2.2, cached: 0.11 },

    // ── Alibaba Qwen ── (Model Studio, international/Singapore, lowest input-length tier;
    // output = non-thinking price; cache-read price only where listed)
    { match: '^qwen4-max', vendor: 'qwen', name: 'Qwen4 Max', input: 1.5, output: 4.5, cached: 0.075 },
    { match: '^qwen3\\.8-max', vendor: 'qwen', name: 'Qwen3.8 Max', input: 2, output: 6 },
    { match: '^qwen3\\.7-max', vendor: 'qwen', name: 'Qwen3.7 Max', input: 2.5, output: 7.5 },
    { match: '^qwen-max', vendor: 'qwen', name: 'Qwen Max', input: 1.6, output: 6.4 },
    { match: '^qwen3\\.7-plus', vendor: 'qwen', name: 'Qwen3.7 Plus', input: 0.4, output: 1.6 },
    { match: '^qwen3\\.6-plus', vendor: 'qwen', name: 'Qwen3.6 Plus', input: 0.5, output: 3 },
    { match: '^qwen3\\.5-plus', vendor: 'qwen', name: 'Qwen3.5 Plus', input: 0.4, output: 2.4 },
    { match: '^qwen-plus', vendor: 'qwen', name: 'Qwen Plus', input: 0.4, output: 1.2 },
    { match: '^qwen3\\.8-flash', vendor: 'qwen', name: 'Qwen3.8 Flash', input: 0.15, output: 0.47 },
    { match: '^qwen3\\.7-flash', vendor: 'qwen', name: 'Qwen3.7 Flash', input: 0.03, output: 0.13 },
    { match: '^qwen3\\.6-flash', vendor: 'qwen', name: 'Qwen3.6 Flash', input: 0.25, output: 1.5 },
    { match: '^qwen3\\.5-flash', vendor: 'qwen', name: 'Qwen3.5 Flash', input: 0.1, output: 0.4 },
    { match: '^qwen-flash', vendor: 'qwen', name: 'Qwen Flash', input: 0.05, output: 0.4 },
    { match: '^qwen3-coder-flash', vendor: 'qwen', name: 'Qwen3 Coder Flash', input: 0.3, output: 1.5 },

    // ── Moonshot Kimi ──
    { match: '^kimi-k3(?![.\\d])', vendor: 'moonshot', name: 'Kimi K3', input: 3, output: 15, cached: 0.3 },
  ],
};
