// CarteLink — каталог програм для сторінки «Підключити програму».
// Плейсхолдери: {{BASE}} = http://127.0.0.1:8317, {{BASE_V1}} = http://127.0.0.1:8317/v1,
// {{KEY}} = API-ключ, {{MODEL}} = обрана модель, {{MODEL_FAST}} = швидка модель.
// uncertain: true — кастомний ендпоінт не підтримується офіційно або не перевірено.
const CLIENTS = [
  // ───────────── CLI ─────────────
  {
    id: 'claude-code', name: 'Claude Code', kind: 'cli', api: 'anthropic',
    docs: 'https://docs.anthropic.com/en/docs/claude-code/settings#environment-variables',
    note: 'Моделі не міняй: Haiku/Sonnet/Opus автоматично йдуть у тири CarteLink.',
    env: [
      ['ANTHROPIC_BASE_URL', '{{BASE}}'],
      ['ANTHROPIC_AUTH_TOKEN', '{{KEY}}'],
    ],
    file: {
      path: '~/.claude/settings.json', lang: 'json',
      content: '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "{{BASE}}",\n    "ANTHROPIC_AUTH_TOKEN": "{{KEY}}"\n  }\n}\n',
    },
  },
  {
    id: 'codex-cli', name: 'Codex CLI (OpenAI)', kind: 'cli', api: 'openai',
    docs: 'https://developers.openai.com/codex/config-advanced',
    note: 'Працює через /v1/responses. Провайдер задається лише в ~/.codex/config.toml.',
    env: [
      ['CARTELINK_API_KEY', '{{KEY}}'],
    ],
    file: {
      path: '~/.codex/config.toml', lang: 'toml',
      content: 'model = "{{MODEL}}"\nmodel_provider = "cartelink"\n\n[model_providers.cartelink]\nname = "CarteLink"\nbase_url = "{{BASE_V1}}"\nenv_key = "CARTELINK_API_KEY"\nwire_api = "responses"\n',
    },
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', kind: 'cli', api: 'gemini',
    docs: 'https://geminicli.com/docs/reference/configuration/',
    note: 'При першому запуску обери вхід через «Gemini API key».',
    env: [
      ['GOOGLE_GEMINI_BASE_URL', '{{BASE}}'],
      ['GEMINI_API_KEY', '{{KEY}}'],
      ['GEMINI_MODEL', '{{MODEL}}'],
    ],
    file: {
      path: '~/.gemini/.env', lang: 'bash',
      content: 'GOOGLE_GEMINI_BASE_URL={{BASE}}\nGEMINI_API_KEY={{KEY}}\nGEMINI_MODEL={{MODEL}}\n',
    },
  },
  {
    id: 'qwen-code', name: 'Qwen Code', kind: 'cli', api: 'openai',
    docs: 'https://qwenlm.github.io/qwen-code-docs/en/users/configuration/model-providers/',
    note: 'Модель можна змінити командою /model.',
    env: [
      ['OPENAI_BASE_URL', '{{BASE_V1}}'],
      ['OPENAI_API_KEY', '{{KEY}}'],
      ['OPENAI_MODEL', '{{MODEL}}'],
    ],
    file: {
      path: '~/.qwen/settings.json', lang: 'json',
      content: '{\n  "modelProviders": {\n    "openai": [\n      { "id": "{{MODEL}}", "name": "CarteLink {{MODEL}}", "baseUrl": "{{BASE_V1}}", "envKey": "CARTELINK_API_KEY" },\n      { "id": "{{MODEL_FAST}}", "name": "CarteLink {{MODEL_FAST}}", "baseUrl": "{{BASE_V1}}", "envKey": "CARTELINK_API_KEY" }\n    ]\n  },\n  "env": { "CARTELINK_API_KEY": "{{KEY}}" },\n  "security": { "auth": { "selectedType": "openai" } },\n  "model": { "name": "{{MODEL}}" }\n}\n',
    },
  },
  {
    id: 'aider', name: 'Aider', kind: 'cli', api: 'openai',
    docs: 'https://aider.chat/docs/llms/openai-compat.html',
    note: 'Перед назвою моделі обов’язково префікс openai/ (напр. openai/cartelink-main).',
    env: [
      ['OPENAI_API_BASE', '{{BASE_V1}}'],
      ['OPENAI_API_KEY', '{{KEY}}'],
      ['AIDER_MODEL', 'openai/{{MODEL}}'],
      ['AIDER_WEAK_MODEL', 'openai/{{MODEL_FAST}}'],
    ],
    file: {
      path: '~/.aider.conf.yml', lang: 'yaml',
      content: 'openai-api-base: {{BASE_V1}}\nopenai-api-key: {{KEY}}\nmodel: openai/{{MODEL}}\nweak-model: openai/{{MODEL_FAST}}\n',
    },
  },
  {
    id: 'opencode', name: 'OpenCode', kind: 'cli', api: 'openai',
    docs: 'https://opencode.ai/docs/providers/',
    note: 'Після збереження перезапусти OpenCode і вибери модель командою /models.',
    env: [
      ['CARTELINK_API_KEY', '{{KEY}}'],
    ],
    file: {
      path: '~/.config/opencode/opencode.json', lang: 'json',
      content: '{\n  "$schema": "https://opencode.ai/config.json",\n  "provider": {\n    "cartelink": {\n      "npm": "@ai-sdk/openai-compatible",\n      "name": "CarteLink",\n      "options": {\n        "baseURL": "{{BASE_V1}}",\n        "apiKey": "{env:CARTELINK_API_KEY}"\n      },\n      "models": {\n        "{{MODEL}}": { "name": "{{MODEL}}" },\n        "{{MODEL_FAST}}": { "name": "{{MODEL_FAST}}" }\n      }\n    }\n  },\n  "model": "cartelink/{{MODEL}}",\n  "small_model": "cartelink/{{MODEL_FAST}}"\n}\n',
    },
  },
  {
    id: 'crush', name: 'Crush (Charm)', kind: 'cli', api: 'openai',
    docs: 'https://github.com/charmbracelet/crush#custom-providers',
    note: 'На Windows файл лежить у %LOCALAPPDATA%\\crush\\crush.json. Модель — Ctrl+L.',
    env: [
      ['CARTELINK_API_KEY', '{{KEY}}'],
    ],
    file: {
      path: '~/.config/crush/crush.json', lang: 'json',
      content: '{\n  "$schema": "https://charm.land/crush.json",\n  "providers": {\n    "cartelink": {\n      "name": "CarteLink",\n      "type": "openai-compat",\n      "base_url": "{{BASE_V1}}",\n      "api_key": "$CARTELINK_API_KEY",\n      "models": [\n        { "id": "{{MODEL}}", "name": "{{MODEL}}", "context_window": 200000, "default_max_tokens": 16000 },\n        { "id": "{{MODEL_FAST}}", "name": "{{MODEL_FAST}}", "context_window": 200000, "default_max_tokens": 8000 }\n      ]\n    }\n  },\n  "models": {\n    "large": { "model": "{{MODEL}}", "provider": "cartelink" },\n    "small": { "model": "{{MODEL_FAST}}", "provider": "cartelink" }\n  }\n}\n',
    },
  },
  {
    id: 'goose', name: 'Goose (Block)', kind: 'cli', api: 'openai',
    docs: 'https://block.github.io/goose/docs/getting-started/providers',
    note: 'OPENAI_HOST — без /v1, Goose сам додає шлях. Перевірка: goose info -v.',
    env: [
      ['GOOSE_PROVIDER', 'openai'],
      ['OPENAI_HOST', '{{BASE}}'],
      ['OPENAI_BASE_PATH', 'v1/chat/completions'],
      ['OPENAI_API_KEY', '{{KEY}}'],
      ['GOOSE_MODEL', '{{MODEL}}'],
    ],
  },

  // ───────────── IDE / розширення ─────────────
  {
    id: 'cline', name: 'Cline', kind: 'ide', api: 'openai',
    docs: 'https://docs.cline.bot/provider-config/openai-compatible',
    note: 'Для складних задач бери cartelink-max, для звичайних — cartelink-main.',
    steps: [
      'Відкрий панель Cline → іконка шестерні (Settings).',
      'API Provider: «OpenAI Compatible».',
      'Base URL: {{BASE_V1}}',
      'API Key: {{KEY}}',
      'Model ID: {{MODEL}} → Save / Done.',
    ],
  },
  {
    id: 'roo-code', name: 'Roo Code', kind: 'ide', api: 'openai',
    docs: 'https://docs.roocode.com/providers/openai-compatible',
    note: 'Можна зробити кілька профілів (fast/main/max) і перемикати їх.',
    steps: [
      'Відкрий панель Roo Code → Settings (шестерня) → Providers.',
      'API Provider: «OpenAI Compatible».',
      'Base URL: {{BASE_V1}}',
      'API Key: {{KEY}}',
      'Model: {{MODEL}} → Save.',
    ],
  },
  {
    id: 'kilo-code', name: 'Kilo Code', kind: 'ide', api: 'openai',
    docs: 'https://kilocode.ai/docs/providers/openai-compatible',
    note: 'Налаштування такі самі, як у Roo Code / Cline.',
    steps: [
      'Відкрий панель Kilo Code → Settings (шестерня) → Providers.',
      'API Provider: «OpenAI Compatible».',
      'Base URL: {{BASE_V1}}',
      'API Key: {{KEY}}',
      'Model: {{MODEL}} → Save.',
    ],
  },
  {
    id: 'continue', name: 'Continue', kind: 'ide', api: 'openai',
    docs: 'https://docs.continue.dev/customize/model-providers/top-level/openai',
    note: 'Відкрий config через шестерню в панелі Continue → «Open config file».',
    file: {
      path: '~/.continue/config.yaml', lang: 'yaml',
      content: 'name: CarteLink\nversion: 1.0.0\nschema: v1\n\nmodels:\n  - name: CarteLink {{MODEL}}\n    provider: openai\n    model: {{MODEL}}\n    apiBase: {{BASE_V1}}\n    apiKey: {{KEY}}\n    useResponsesApi: false\n    roles: [chat, edit, apply]\n    capabilities: [tool_use]\n  - name: CarteLink {{MODEL_FAST}}\n    provider: openai\n    model: {{MODEL_FAST}}\n    apiBase: {{BASE_V1}}\n    apiKey: {{KEY}}\n    useResponsesApi: false\n    roles: [chat, summarize]\n',
    },
  },
  {
    id: 'zed', name: 'Zed', kind: 'ide', api: 'openai',
    docs: 'https://zed.dev/docs/ai/use-api-access',
    note: 'Ключ береться зі змінної CARTELINK_API_KEY або з поля в Agent Settings.',
    env: [
      ['CARTELINK_API_KEY', '{{KEY}}'],
    ],
    file: {
      path: '~/.config/zed/settings.json', lang: 'json',
      content: '{\n  "language_models": {\n    "openai_compatible": {\n      "CarteLink": {\n        "api_url": "{{BASE_V1}}",\n        "available_models": [\n          { "name": "{{MODEL}}", "display_name": "{{MODEL}}", "max_tokens": 200000,\n            "capabilities": { "tools": true, "images": true, "parallel_tool_calls": false, "prompt_cache_key": false, "chat_completions": true } },\n          { "name": "{{MODEL_FAST}}", "display_name": "{{MODEL_FAST}}", "max_tokens": 200000,\n            "capabilities": { "tools": true, "images": true, "parallel_tool_calls": false, "prompt_cache_key": false, "chat_completions": true } }\n        ]\n      }\n    }\n  }\n}\n',
    },
  },
  {
    id: 'copilot-vscode', name: 'GitHub Copilot у VS Code (BYOK)', kind: 'ide', api: 'openai',
    uncertain: true,
    docs: 'https://code.visualstudio.com/docs/agent-customization/language-models',
    note: 'Лише чат (не автодоповнення). Провайдер «Custom Endpoint» може бути тільки в Insiders.',
    steps: [
      'Відкрий Copilot Chat → список моделей → «Manage Models…».',
      'Натисни «Add Models» і обери «Custom Endpoint» (у старих версіях — «OpenAI Compatible»).',
      'URL: {{BASE_V1}} (тип API: Chat Completions).',
      'API Key: {{KEY}}',
      'Додай модель {{MODEL}} (увімкни Tool calling) і обери її в чаті.',
    ],
  },
  {
    id: 'jetbrains-ai', name: 'JetBrains AI Assistant', kind: 'ide', api: 'openai',
    uncertain: true,
    docs: 'https://www.jetbrains.com/help/ai-assistant/use-custom-models.html',
    note: 'Якщо тест дає 404 — спробуй адресу без /v1: {{BASE}}.',
    steps: [
      'Settings → Tools → AI Assistant → Providers & API keys.',
      'У «Third-party AI providers» обери Provider: «OpenAI-compatible».',
      'URL: {{BASE_V1}}',
      'API Key: {{KEY}} → Test Connection → Apply.',
      'У чаті AI Assistant обери модель {{MODEL}}.',
    ],
  },
  {
    id: 'cursor', name: 'Cursor', kind: 'ide', api: 'openai',
    uncertain: true,
    docs: 'https://docs.cursor.com/settings/api-keys',
    note: 'Cursor шле запити зі своїх серверів — 127.0.0.1 не спрацює, потрібен тунель і план Pro.',
    steps: [
      'Зроби публічну адресу для CarteLink (напр. cloudflared / ngrok на порт 8317).',
      'Cursor Settings → Models → API Keys → OpenAI API Key: {{KEY}}.',
      'Увімкни «Override OpenAI Base URL» і встав адресу тунелю з /v1 на кінці.',
      'Натисни «Verify», потім «+ Add model» → {{MODEL}} і увімкни її.',
    ],
  },
  {
    id: 'windsurf', name: 'Windsurf', kind: 'ide', api: 'openai',
    uncertain: true,
    docs: 'https://docs.windsurf.com/plugins/cascade/models',
    note: 'Власну адресу API Windsurf офіційно не підтримує — лише свої ключі для окремих моделей.',
    steps: [
      'Cascade не дозволяє вказати свій Base URL, тому напряму підключити CarteLink не вийде.',
      'Встанови в Windsurf розширення Cline, Roo Code або Kilo Code з маркетплейсу.',
      'Налаштуй його: Base URL {{BASE_V1}}, API Key {{KEY}}, Model {{MODEL}}.',
    ],
  },

  // ───────────── Додатки (чат) ─────────────
  {
    id: 'open-webui', name: 'Open WebUI', kind: 'app', api: 'openai',
    docs: 'https://docs.openwebui.com/getting-started/quick-start/starting-with-openai-compatible',
    note: 'Якщо Open WebUI у Docker — пиши http://host.docker.internal:8317/v1 замість 127.0.0.1.',
    steps: [
      'Admin Panel → Settings → Connections.',
      'У розділі «OpenAI API» натисни «+» (Add Connection).',
      'URL: {{BASE_V1}}',
      'Key: {{KEY}} → Save.',
      'У новому чаті обери модель {{MODEL}} зі списку.',
    ],
  },
  {
    id: 'librechat', name: 'LibreChat', kind: 'app', api: 'openai',
    docs: 'https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/custom_endpoint',
    note: 'Після зміни файлу перезапусти LibreChat. У Docker заміни 127.0.0.1 на host.docker.internal.',
    file: {
      path: 'librechat.yaml', lang: 'yaml',
      content: 'version: 1.2.1\nendpoints:\n  custom:\n    - name: "CarteLink"\n      apiKey: "{{KEY}}"\n      baseURL: "{{BASE_V1}}"\n      models:\n        default: ["{{MODEL}}", "{{MODEL_FAST}}"]\n        fetch: true\n      titleConvo: true\n      titleModel: "{{MODEL_FAST}}"\n      modelDisplayLabel: "CarteLink"\n',
    },
  },
  {
    id: 'cherry-studio', name: 'Cherry Studio', kind: 'app', api: 'openai',
    docs: 'https://docs.cherry-ai.com/pre-basic/providers/zi-ding-yi-fu-wu-shang',
    note: 'Адресу вводь без /v1 — Cherry Studio додає його сама.',
    steps: [
      'Налаштування → Постачальники моделей → «+ Додати».',
      'Назва: CarteLink, тип: OpenAI.',
      'API ключ: {{KEY}}',
      'API адреса: {{BASE}}',
      'Натисни «Керувати» / «Додати модель» → {{MODEL}}, увімкни провайдера.',
    ],
  },
  {
    id: 'chatbox', name: 'Chatbox', kind: 'app', api: 'openai',
    uncertain: true,
    docs: 'https://docs.chatboxai.app/en/guides/providers',
    note: 'Якщо не з’єднується — спробуй адресу без /v1: {{BASE}}.',
    steps: [
      'Settings → Model Provider → «Add» (Custom Provider).',
      'API Mode: OpenAI API Compatible.',
      'API Host: {{BASE_V1}}',
      'API Key: {{KEY}}',
      'Model: {{MODEL}} → Save.',
    ],
  },

  // ───────────── SDK / інше ─────────────
  {
    id: 'openai-sdk', name: 'OpenAI SDK (Python / JS)', kind: 'sdk', api: 'openai',
    docs: 'https://github.com/openai/openai-python#configuring-the-http-client',
    note: 'Обидва SDK самі читають OPENAI_BASE_URL і OPENAI_API_KEY.',
    env: [
      ['OPENAI_BASE_URL', '{{BASE_V1}}'],
      ['OPENAI_API_KEY', '{{KEY}}'],
    ],
    file: {
      path: 'example.py', lang: 'python',
      content: 'from openai import OpenAI\n\nclient = OpenAI(base_url="{{BASE_V1}}", api_key="{{KEY}}")\nr = client.chat.completions.create(\n    model="{{MODEL}}",\n    messages=[{"role": "user", "content": "Привіт!"}],\n)\nprint(r.choices[0].message.content)\n\n# JS: new OpenAI({ baseURL: "{{BASE_V1}}", apiKey: "{{KEY}}" })\n',
    },
  },
  {
    id: 'anthropic-sdk', name: 'Anthropic SDK (Python / JS)', kind: 'sdk', api: 'anthropic',
    docs: 'https://github.com/anthropics/anthropic-sdk-python',
    note: 'Адреса без /v1. Будь-яка claude-*-назва потрапить у відповідний тир.',
    env: [
      ['ANTHROPIC_BASE_URL', '{{BASE}}'],
      ['ANTHROPIC_API_KEY', '{{KEY}}'],
    ],
    file: {
      path: 'example.py', lang: 'python',
      content: 'import anthropic\n\nclient = anthropic.Anthropic(base_url="{{BASE}}", api_key="{{KEY}}")\nr = client.messages.create(\n    model="{{MODEL}}",\n    max_tokens=1024,\n    messages=[{"role": "user", "content": "Привіт!"}],\n)\nprint(r.content[0].text)\n',
    },
  },
  {
    id: 'curl', name: 'curl (перевірка)', kind: 'sdk', api: 'openai',
    docs: 'https://platform.openai.com/docs/api-reference/chat/create',
    note: 'Швидка перевірка, що ключ і модель працюють.',
    file: {
      path: 'terminal', lang: 'bash',
      content: 'curl {{BASE_V1}}/models -H "Authorization: Bearer {{KEY}}"\n\ncurl {{BASE_V1}}/chat/completions \\\n  -H "Authorization: Bearer {{KEY}}" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"model":"{{MODEL}}","messages":[{"role":"user","content":"Привіт!"}]}\'\n\ncurl {{BASE}}/v1/messages \\\n  -H "x-api-key: {{KEY}}" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"model":"{{MODEL}}","max_tokens":256,"messages":[{"role":"user","content":"Привіт!"}]}\'\n',
    },
  },
];

window.CLIENTS = CLIENTS;
