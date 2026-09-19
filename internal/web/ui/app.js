'use strict';
// VisionGateGo UI — talks to /api/* on the same origin as the engine.

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- toast + copy ----------
let toastTimer = null;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast hidden'; }, 2200);
}

async function copyVal(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast((label || 'Скопійовано') + ' ✓');
  } catch (e) {
    window.prompt('Скопіюйте вручну:', text);
  }
}

// ---------- navigation ----------
function showPage(name) {
  document.querySelectorAll('nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  document.querySelectorAll('.page').forEach((p) => {
    p.classList.toggle('active', p.id === 'page-' + name);
  });
  if (name === 'server') refreshServer();
  if (name === 'providers') refreshProviders();
  if (name === 'models') refreshModels();
  if (name === 'cliproxy') refreshCliproxy();
  if (name === 'metrics') refreshMetrics();
  if (name === 'settings') refreshSettings();
  if (name === 'about') {
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.scrollTop = 0;
  }
}

document.querySelectorAll('nav button').forEach((b) => {
  b.addEventListener('click', () => showPage(b.dataset.page));
});

// ---------- api helpers ----------
async function api(path, opts) {
  const res = await fetch('/api' + path, opts);
  if (!res.ok) {
    let msg = res.status;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch (e) { /* keep status */ }
    throw new Error(msg);
  }
  return res.json();
}

function msg(el, text, ok) {
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  setTimeout(() => { el.textContent = ''; }, 4000);
}

// ---------- port-move banner ----------
(function initBanner() {
  try {
    const q = new URLSearchParams(location.search);
    const moved = q.get('moved');
    if (moved && $('port-banner')) {
      $('port-banner').textContent =
        'Порт ' + moved + ' був зайнятий іншою програмою, тому VisionGate запустився на порту ' +
        (q.get('port') || '(див. Endpoints нижче)') + '. Все працює — просто адреса інша.';
      $('port-banner').style.display = '';
    }
  } catch (e) { /* no banner */ }
})();

// ---------- server page: status card ----------
let LAST_STATUS = null;
let LAST_EP = null;

async function refreshServer() {
  try {
    const st = await api('/status');
    LAST_STATUS = st;
    paintServerStatus(st);
    const ep = await api('/endpoints');
    paintEndpoints(ep);
  } catch (e) { /* keep old values */ }
  updateFoot();
}

function paintServerStatus(st) {
  const eng = st.engine || {};
  const running = !!eng.running;
  const restarting = !!eng.restarting;
  const paused = !!eng.paused;
  const host = displayHost(eng.host);
  let headline = running ? 'Працює' : 'Зупинено';
  let sub = running ? 'Слухаю http://' + host + ':' + eng.port : 'Шлюз не працює.';
  if (restarting) { headline = 'Перезапуск…'; sub = 'Рушій перезапускається.'; }
  else if (paused) { sub = 'Пауза: запити до API отримують 503, панель працює.'; }
  if (eng.lastError) { sub += ' Помилка: ' + eng.lastError; }
  $('bigDot').className = 'big-dot ' + (running ? 'on' : 'off');
  $('statusHeadline').textContent = headline;
  $('statusSub').textContent = sub;
  $('btnStart').disabled = running || restarting;
  $('btnStop').disabled = !running || restarting;
  $('btnRestart').disabled = restarting;
  // The Акаунти page mirrors the same engine state.
  $('cpBigDot').className = 'big-dot ' + (running ? 'on' : 'off');
  $('cpStatusHeadline').textContent = headline;
  $('cpStatusSub').textContent = running
    ? 'Рушій CLIProxyAPI v' + (eng.version || '') + ' слухає ' + host + ':' + eng.port + '.'
    : (restarting ? 'Рушій перезапускається.' : 'Рушій CLIProxyAPI не працює.');
  $('cpBtnStart').disabled = running || restarting;
  $('cpBtnStop').disabled = !running || restarting;
  $('cpBtnRestart').disabled = restarting;
}

function displayHost(h) {
  h = String(h || '').trim();
  if (!h || h === '0.0.0.0' || h === '::' || h === '[::]') return '127.0.0.1';
  return h;
}

// After a restart the engine may come back on another port: poll its
// /healthz and move the window there.
async function followRestart(host, port) {
  const cur = location.host;
  const next = displayHost(host) + ':' + port;
  const base = location.protocol + '//' + next;
  const deadline = Date.now() + 20000;
  await new Promise((r) => setTimeout(r, 900));
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/api/status', { cache: 'no-store' });
      if (res.ok) {
        const st = await res.json();
        if (st.engine && st.engine.running && !st.engine.restarting) {
          if (next !== cur) { location.href = base + '/ui/'; return; }
          toast('Працює ✓');
          refreshServer();
          return;
        }
      }
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  toast('Рушій не відповів за 20 с — перевір лог app.log', true);
  refreshServer();
}

function paintEndpoints(ep) {
  LAST_EP = ep;
  $('epOpenAI').value = ep.openai;
  $('epAnthropic').value = ep.anthropic;
  $('apiKey').value = ep.key || '';
  $('portInput').value = (LAST_STATUS && LAST_STATUS.engine && LAST_STATUS.engine.port) || '';
  $('requireKey').checked = !!LAST_STATUS.requireKey;
  fillDefaultModelSelect(ep);
  renderSnippet(ep);
}

// ---------- default model select ----------
let MODEL_OPTS = [];
let MODEL_GROUPS = [];
let MODEL_BLACKLIST = [];

function isModelBlacklisted(id) {
  if (!id) return false;
  const low = String(id).toLowerCase().trim();
  return MODEL_BLACKLIST.some((b) => b && (low === b || low === b.trim()));
}

function cleanModelName(s) {
  if (!s) return '';
  if (s.startsWith('cp-') && s.includes(':')) {
    return s.slice(s.indexOf(':') + 1);
  }
  return s;
}

function populateModelSelect(sel, curValue, emptyLabel) {
  if (!sel) return;
  sel.innerHTML = '';
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = emptyLabel || '— не вказано —';
  sel.appendChild(emptyOpt);

  const cleanCur = cleanModelName(curValue);
  let found = false;

  for (const grp of MODEL_GROUPS) {
    if (!grp.options || !grp.options.length) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = grp.label;
    for (const item of grp.options) {
      if (isModelBlacklisted(item.value)) continue;
      const opt = document.createElement('option');
      opt.value = item.value;
      opt.textContent = item.text || item.value;
      if (item.value === curValue || (cleanCur && item.value === cleanCur)) {
        opt.selected = true;
        found = true;
      }
      optgroup.appendChild(opt);
    }
    sel.appendChild(optgroup);
  }

  // If there's an existing value that wasn't found in any group, append it (using clean model name)
  const effectiveCur = cleanCur || curValue;
  if (effectiveCur && !found) {
    const opt = document.createElement('option');
    opt.value = effectiveCur;
    opt.textContent = effectiveCur;
    opt.selected = true;
    sel.appendChild(opt);
  }
}

function fillDefaultModelSelect(ep) {
  const sel = $('defaultModel');
  const cfg = (LAST_STATUS && LAST_STATUS.routing) || null;
  let cur = '';
  if (cfg) {
    if (cfg.defaultProviderId && !cfg.defaultProviderId.startsWith('cp-') && cfg.defaultModel) {
      cur = cfg.defaultProviderId + ':' + cfg.defaultModel;
    } else if (cfg.defaultModel) {
      cur = cleanModelName(cfg.defaultModel);
    }
  }
  populateModelSelect(sel, cur, '— не вказано —');
}

// ---------- Claude Code snippet ----------
function renderSnippet(ep) {
  ep = ep || LAST_EP;
  const port = (LAST_STATUS && LAST_STATUS.engine && LAST_STATUS.engine.port) || 8317;
  const base = (ep && ep.anthropic) || ('http://127.0.0.1:' + port);
  const requireKey = LAST_STATUS ? LAST_STATUS.requireKey !== false : true;
  const key = (ep && ep.key) || '';
  const tiers = (LAST_STATUS && LAST_STATUS.routing && LAST_STATUS.routing.tiers) || {};
  const sonnetModel = cleanModelName(tiers.sonnet || 'claude-sonnet-4-6');
  const tok = requireKey ? (key || '<встав свій ключ>') : 'any';
  const lines = [];
  lines.push('# Claude Code (Anthropic-сумісний)');
  lines.push('export ANTHROPIC_BASE_URL="' + base + '"');
  lines.push('export ANTHROPIC_AUTH_TOKEN="' + tok + '"');
  lines.push('export ANTHROPIC_MODEL="' + sonnetModel + '"');
  lines.push('export ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-haiku-4-5"');
  lines.push('export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-6"');
  lines.push('export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-8"');
  lines.push('');
  lines.push('# OpenAI SDK (OpenAI-compatible)');
  lines.push('export OPENAI_BASE_URL="' + base + '/v1"');
  lines.push('export OPENAI_API_KEY="' + tok + '"');
  document.getElementById('snippet').textContent = lines.join(String.fromCharCode(10));
}

// ---------- server controls ----------
async function serverAction(kind) {
  const map = { start: 'Запуск…', stop: 'Зупинка…', restart: 'Перезапуск…' };
  toast(map[kind] || '…');
  try {
    const r = await api('/server/' + kind, { method: 'POST' });
    if (r.ok === false) { toast(r.error || 'Не вдалось', true); }
    else if (r.restarting) { followRestart(r.host, r.port); return; }
    else { toast(kind === 'stop' ? 'Зупинено' : 'Працює ✓'); }
  } catch (e) {
    toast('Помилка: ' + e.message, true);
  }
  refreshServer();
}

$('btnStart').addEventListener('click', () => serverAction('start'));
$('btnStop').addEventListener('click', () => serverAction('stop'));
$('btnRestart').addEventListener('click', () => serverAction('restart'));
$('cpBtnStart').addEventListener('click', () => serverAction('start'));
$('cpBtnStop').addEventListener('click', () => serverAction('stop'));
$('cpBtnRestart').addEventListener('click', () => serverAction('restart'));

$('btnRevealKey').addEventListener('click', () => {
  const k = $('apiKey');
  k.type = k.type === 'password' ? 'text' : 'password';
});

$('btnGenKey').addEventListener('click', async () => {
  try {
    const r = await api('/generate-key', { method: 'POST' });
    if (r.ok) {
      $('apiKey').value = r.key;
      toast('Новий ключ згенеровано ✓');
      refreshServer();
    }
  } catch (e) { toast('Помилка: ' + e.message, true); }
});

$('requireKey').addEventListener('change', async () => {
  try {
    const cfg = await api('/config');
    cfg.requireKey = $('requireKey').checked;
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    toast('Збережено ✓');
    refreshServer();
  } catch (e) { toast('Помилка: ' + e.message, true); }
});

$('btnApplyPort').addEventListener('click', async () => {
  const port = Number($('portInput').value);
  if (!(port >= 1 && port <= 65535)) { toast('Невірний порт', true); return; }
  try {
    const cfg = await api('/config');
    cfg.cliproxy.port = port;
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    toast('Порт ' + port + ' збережено — натисни «Перезапустити», щоб застосувати.');
    refreshServer();
  } catch (e) { toast('Помилка: ' + e.message, true); }
});

$('defaultModel').addEventListener('change', async () => {
  const v = $('defaultModel').value;
  const ci = v.indexOf(':');
  try {
    const cfg = await api('/config');
    cfg.routing = cfg.routing || {};
    cfg.routing.defaultProviderId = ci > 0 ? v.slice(0, ci) : '';
    cfg.routing.defaultModel = ci > 0 ? v.slice(ci + 1) : v;
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    toast('Модель за замовчуванням збережена ✓');
    renderSnippet();
  } catch (e) { toast('Помилка: ' + e.message, true); }
});

// ---------- status polling (sidebar dot + periodic refresh) ----------
let footTimer = null;
function updateFoot() {
  clearInterval(footTimer);
  const tick = async () => {
    try {
      const st = await api('/status');
      const running = !!(st.engine && st.engine.running);
      $('tbStatus').className = 'tb-pill ' + (running ? 'on' : 'off');
      $('tbStatusText').textContent = running ? 'працює :' + st.engine.port : 'зупинено';
      if (st && st.version) {
        const verEl = document.querySelector('.sidebar-foot .ver');
        if (verEl) verEl.textContent = 'v' + st.version;
      }
    } catch (e) { /* silent */ }
  };
  tick();
  footTimer = setInterval(tick, 3000);
}

// ---------- models page ----------
const TIERS = [
  { key: 'haiku', alias: 'claude-haiku-4-5', sel: 'tierHaiku' },
  { key: 'sonnet', alias: 'claude-sonnet-4-6', sel: 'tierSonnet' },
  { key: 'opus', alias: 'claude-opus-4-8', sel: 'tierOpus' },
];

const PROVIDER_KNOWN_MODELS = {
  'antigravity': [
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-pro-high', label: 'Gemini 3.8 Pro (High)' },
    { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
    { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
    { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
    { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    { id: 'claude-sonnet-4-6', label: 'Claude 4.6 Sonnet (Antigravity)' },
    { id: 'claude-opus-4-6-thinking', label: 'Claude 4.6 Opus Thinking' },
    { id: 'gpt-oss-120b-medium', label: 'GPT OSS 120B Medium' },
  ],
  'codex': [
    { id: 'gpt-5.5', label: 'GPT 5.5' },
    { id: 'gpt-6-astra', label: 'GPT 6 Astra' },
    { id: 'gpt-5.6-sol', label: 'GPT 5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT 5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna' },
    { id: 'gpt-5.3-codex-spark', label: 'GPT 5.3 Codex Spark' },
    { id: 'codex-auto-review', label: 'Codex Auto Review' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'o3-mini', label: 'o3-mini' },
  ],
  'kimi': [
    { id: 'kimi-k2.8-code', label: 'Kimi K2.8 Code' },
    { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
    { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code Highspeed' },
    { id: 'kimi-k2.6', label: 'Kimi K2.6' },
    { id: 'kimi-k2.5', label: 'Kimi K2.5' },
    { id: 'kimi-k3', label: 'Kimi K3' },
    { id: 'kimi-k2', label: 'Kimi K2' },
    { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
  ],
  'claude': [
    { id: 'claude-sonnet-4-6', label: 'Claude 4.6 Sonnet' },
    { id: 'claude-opus-4-6', label: 'Claude 4.6 Opus' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude 4.5 Haiku' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude 4.5 Sonnet' },
  ],
  'xai': [
    { id: 'grok-3', label: 'Grok 3' },
    { id: 'grok-3-mini', label: 'Grok 3 Mini' },
    { id: 'grok-2-1212', label: 'Grok 2 1212' },
  ],
  'meta': [
    { id: 'llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
  ],
};

async function refreshModels() {
  await collectModelOptions();
  let routing = null;
  try {
    const cfg = await api('/config');
    routing = cfg.routing || null;
  } catch (e) { /* defaults */ }
  fillTiers(routing);
  renderOfficialList();
  refreshRoutingStrategy();

  if ($('applyAllTiersSelect')) {
    populateModelSelect($('applyAllTiersSelect'), '', '— обрати модель для всіх 3 рівнів —');
  }
  if ($('applyAllOfficialSelect')) {
    populateModelSelect($('applyAllOfficialSelect'), '', '— обрати модель для всіх офіційних —');
  }
}

// Collect candidate model names: provider pooled rotation options ("сушити всі акки")
// + individual accounts + custom OpenAI providers.
async function collectModelOptions() {
  const groups = [];
  const allOpts = new Set();

  try {
    const cfg = await api('/config');
    MODEL_BLACKLIST = (cfg.modelBlacklist || []).map((s) => String(s).toLowerCase().trim());
  } catch (e) { /* defaults */ }

  let authFiles = [];
  try {
    const resp = await mgmt('GET', 'auth-files');
    authFiles = Array.isArray(resp) ? resp : ((resp && resp.files) || []);
  } catch (e) { /* engine offline */ }

  const activeProviders = new Set();
  const providerModelsMap = {};

  for (const f of authFiles) {
    const prov = (f.provider || f.type || '').toLowerCase();
    if (prov) {
      activeProviders.add(prov);
      if (!providerModelsMap[prov]) providerModelsMap[prov] = new Set();
    }
  }

  // Dynamic models for each auth file if available
  for (const f of authFiles.slice(0, 10)) {
    const name = f.name || f.filename || f.id || '';
    const prov = (f.provider || f.type || '').toLowerCase();
    if (!name) continue;
    try {
      const mr = await mgmt('GET', 'auth-files/models?name=' + encodeURIComponent(name));
      const models = (mr && mr.models) || [];
      for (const m of models) {
        if (m && m.id) {
          if (prov && providerModelsMap[prov]) providerModelsMap[prov].add(m.id);
          allOpts.add(m.id);
        }
      }
    } catch (e) { /* per-file error tolerated */ }
  }

  // 1. Pooled Provider Rotation groups ("сушити всі акки" / round-robin)
  for (const prov of activeProviders) {
    const known = PROVIDER_KNOWN_MODELS[prov] || [];
    const dynamicSet = providerModelsMap[prov] || new Set();
    const opts = [];
    const added = new Set();

    for (const km of known) {
      opts.push({
        value: km.id,
        text: km.id + ' — ' + km.label + ' (ротація)',
      });
      added.add(km.id);
      allOpts.add(km.id);
    }
    for (const mid of dynamicSet) {
      if (!added.has(mid)) {
        opts.push({
          value: mid,
          text: mid + ' (ротація)',
        });
        added.add(mid);
        allOpts.add(mid);
      }
    }

    if (opts.length > 0) {
      const pTitle = prov.charAt(0).toUpperCase() + prov.slice(1);
      groups.push({
        label: '🔄 ' + pTitle + ' (ротація всіх акаунтів)',
        options: opts,
      });
    }
  }

  // If no auth accounts connected yet, offer known providers as preview options
  if (!activeProviders.size) {
    for (const [prov, models] of Object.entries(PROVIDER_KNOWN_MODELS)) {
      const pTitle = prov.charAt(0).toUpperCase() + prov.slice(1);
      const opts = models.map((m) => ({
        value: m.id,
        text: m.id + ' — ' + m.label + ' (ротація)',
      }));
      models.forEach((m) => allOpts.add(m.id));
      groups.push({
        label: '🔄 ' + pTitle + ' (ротація всіх акаунтів)',
        options: opts,
      });
    }
  }

  // 2. Custom OpenAI providers from VisionGate configuration
  try {
    const cfg = await api('/config');
    for (const p of (cfg.providers || [])) {
      // Filter out internal account copies (cp-*)
      if (String(p.id).startsWith('cp-') || String(p.baseUrl || '').startsWith('embedded://')) {
        continue;
      }
      const pOpts = [];
      for (const m of (p.models || [])) {
        const fullVal = p.id + ':' + m;
        pOpts.push({ value: fullVal, text: m });
        allOpts.add(fullVal);
      }
      if (pOpts.length > 0) {
        groups.push({
          label: '🌐 ' + (p.label || p.id),
          options: pOpts,
        });
      }
    }
  } catch (e) { /* ignore */ }

  MODEL_GROUPS = groups;
  MODEL_OPTS = Array.from(allOpts);
}

function fillTiers(routing) {
  const tiers = (routing && routing.tiers) || {};
  for (const t of TIERS) {
    const sel = $(t.sel);
    const cur = tiers[t.key] || '';
    populateModelSelect(sel, cur, '— не вказано —');
  }
  renderAliases(routing);
}

function renderAliases(routing) {
  const box = $('aliasList');
  const tiers = (routing && routing.tiers) || {};
  const fallback = routing && routing.defaultModel ? routing.defaultModel : '';
  box.innerHTML = '';
  for (const t of TIERS) {
    const target = cleanModelName(tiers[t.key] || fallback);
    const row = document.createElement('div');
    row.className = 'alias-item';
    row.innerHTML = '<span class="tier-badge ' + t.key + '">' + t.key + '</span>' +
      '<span class="alias-id" data-copy-text="' + esc(t.alias) + '" title="Клікни, щоб скопіювати">' + esc(t.alias) + '</span>' +
      '<span class="alias-arrow">→</span>' +
      '<span class="alias-target ' + (target ? '' : 'unset') + '">' + esc(target || 'не призначено') + '</span>';
    box.appendChild(row);
  }
  box.querySelectorAll('[data-copy-text]').forEach((n) => {
    n.addEventListener('click', () => copyVal(n.dataset.copyText, 'ID моделі скопійовано'));
  });
}

$('btnSaveTiers').addEventListener('click', async () => {
  try {
    const cfg = await api('/config');
    cfg.routing = cfg.routing || {};
    cfg.routing.tiers = {
      haiku: cleanModelName($('tierHaiku').value),
      sonnet: cleanModelName($('tierSonnet').value),
      opus: cleanModelName($('tierOpus').value),
    };
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    msg($('tiers-msg'), 'Мапінг збережено — діє одразу ✓', true);
    renderAliases(cfg.routing);
  } catch (e) {
    msg($('tiers-msg'), 'Помилка: ' + e.message, false);
  }
});

$('btnCopyAliases').addEventListener('click', () => {
  copyVal(TIERS.map((t) => t.alias).join(String.fromCharCode(10)), 'Усі ID скопійовано');
});
// ---------- official Claude model picker mapping ----------
// Every model name the official Claude Code / Claude Desktop picker can send
// (screenshot spec): tiers + the "More models" list. Any of them can be
// swapped for a real model — stored in routing.modelMap, applied by the
// gateway middleware per request.
const OFFICIAL_MODELS = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1', hint: 'найскладніші задачі' },
  { id: 'claude-opus-5', label: 'Opus 5', hint: 'складні задачі' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'щоденні задачі' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'швидкі відповіді' },
  { id: 'claude-fable-5', label: 'Fable 5', hint: 'More models' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', hint: 'More models' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', hint: 'More models' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', hint: 'More models' },
  { id: 'claude-opus-3', label: 'Opus 3', hint: 'More models' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'More models' },
];

async function renderOfficialList() {
  const box = $('official-list');
  if (!box) return;
  let modelMap = {};
  try {
    const cfg = await api('/config');
    modelMap = (cfg.routing && cfg.routing.modelMap) || {};
  } catch (e) { /* defaults */ }
  box.innerHTML = '';
  for (const m of OFFICIAL_MODELS) {
    const row = document.createElement('div');
    row.className = 'alias-item';
    row.innerHTML = '<span class="alias-id" data-copy-text="' + esc(m.id) + '" title="Клікни, щоб скопіювати">' + esc(m.label) + '</span>' +
      '<span class="alias-arrow">→</span>' +
      '<span class="mono small muted">' + esc(m.id) + '</span>' +
      '<select data-official="' + esc(m.id) + '" style="margin-left:auto"></select>';
    const sel = row.querySelector('select');
    const cur = modelMap[m.id] || '';
    populateModelSelect(sel, cur, '— йде як є —');
    sel.addEventListener('change', () => saveOfficialMapping(m.id, sel.value));
    box.appendChild(row);
  }
  box.querySelectorAll('[data-copy-text]').forEach((n) => {
    n.addEventListener('click', () => copyVal(n.dataset.copyText, 'ID моделі скопійовано'));
  });
}

async function saveOfficialMapping(officialId, target) {
  try {
    const cfg = await api('/config');
    cfg.routing = cfg.routing || {};
    cfg.routing.modelMap = cfg.routing.modelMap || {};
    const cleanTarget = cleanModelName(target);
    if (cleanTarget) cfg.routing.modelMap[officialId] = cleanTarget;
    else delete cfg.routing.modelMap[officialId];
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    toast('Підміну для ' + officialId + ' збережено ✓');
  } catch (e) {
    toast('Помилка: ' + e.message, true);
  }
}

$('btnCopyAliasMap').addEventListener('click', async () => {
  try {
    const cfg = await api('/config');
    const mm = (cfg.routing && cfg.routing.modelMap) || {};
    const rows = OFFICIAL_MODELS
      .filter((m) => mm[m.id])
      .map((m) => '  "' + m.id + '": "' + mm[m.id] + '"');
    copyVal('model-map:' + String.fromCharCode(10) + rows.join(String.fromCharCode(10)), 'YAML мапінгу скопійовано');
  } catch (e) {
    copyVal('', '');
  }
});

// ---------- routing strategy (round-robin vs fill-first) ----------
async function refreshRoutingStrategy() {
  try {
    const res = await mgmt('GET', 'routing/strategy');
    const strat = (res && res.strategy) || 'round-robin';
    if ($('strat-fill-first')) {
      $('strat-fill-first').checked = (strat === 'fill-first');
      $('strat-round-robin').checked = (strat !== 'fill-first');
    }
  } catch (e) { /* engine offline */ }
}

async function setRoutingStrategy(strategy) {
  try {
    await mgmt('PUT', 'routing/strategy', { value: strategy });
    msg($('strat-msg'), 'Стратегію збережено: ' + (strategy === 'fill-first' ? '⚡ Fill-First (сушити всі акки)' : '🔄 Round-Robin (по черзі)'), true);
    toast('Стратегію ротації збережено ✓');
  } catch (e) {
    msg($('strat-msg'), 'Помилка: ' + e.message, false);
    toast('Помилка: ' + e.message, true);
  }
}

if ($('strat-round-robin')) {
  $('strat-round-robin').addEventListener('change', () => setRoutingStrategy('round-robin'));
}
if ($('strat-fill-first')) {
  $('strat-fill-first').addEventListener('change', () => setRoutingStrategy('fill-first'));
}


// ---------- management passthrough ----------
async function mgmt(method, path, body) {
  const res = await fetch('/api/cliproxy/api/' + path, {
    method: method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* non-json */ }
  if (!res.ok) {
    throw new Error((data && data.error) || text || res.status);
  }
  return data;
}

// ---------- providers page ----------
let nativeTab = 'claude-api-key';
const nativeLabels = {
  'claude-api-key': 'Claude',
  'gemini-api-key': 'Gemini',
  'codex-api-key': 'Codex',
  'xai-api-key': 'xAI',
  'meta-api-key': 'Meta',
};

async function refreshProviders() {
  await renderVgProviders();
  await renderProvList();
  await renderNativeList();
}

// VisionGate-side provider entries (accounts transferred from the Акаунти
// page + any manual entries) — shown as cards with model counts.
async function renderVgProviders() {
  const el = $('vg-prov-list');
  let items = [];
  try {
    const cfg = await api('/config');
    items = cfg.providers || [];
  } catch (e) { /* ignore */ }
  if (!items.length) {
    el.innerHTML = '<div class="empty">Ще немає акаунтів-провайдерів. Перенеси акаунт зі сторінки «Акаунти» — натисни «→ Провайдер» на ньому.</div>';
    return;
  }
  el.innerHTML = items.map((p) => {
    const isAccount = String(p.baseUrl || '').indexOf('embedded://') === 0;
    const models = (p.models || []).slice(0, 4).join(', ');
    const more = (p.models || []).length > 4 ? ' +ще ' + (p.models.length - 4) : '';
    return '<div class="prov-card">' +
      '<div class="prov-info">' +
      '<div class="prov-name">' + esc(p.label || p.id) +
      (isAccount ? ' <span class="badge account">АКАУНТ</span>' : ' <span class="badge openai">OPENAI</span>') +
      (p.enabled === false ? ' <span class="chip">вимк.</span>' : '') + '</div>' +
      '<div class="prov-url mono">' + esc(isAccount ? 'рушій CLIProxyAPI (вбудований)' : (p.baseUrl || '')) + '</div>' +
      '<div class="prov-meta"><span><b>' + (p.models || []).length + '</b> моделей</span>' +
      '<span class="mono">' + esc(models) + esc(more) + '</span></div>' +
      '</div>' +
      '<div class="prov-actions">' +
      '<button class="btn btn-mini" data-del="' + esc(p.id) + '">Видалити</button>' +
      '</div></div>';
  }).join('');
  el.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        const cfg = await api('/config');
        cfg.providers = (cfg.providers || []).filter((x) => x.id !== b.dataset.del);
        await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg),
        });
        toast('Провайдера видалено');
        renderVgProviders();
      } catch (e) { toast('Помилка: ' + e.message, true); }
    });
  });
}

async function renderProvList() {
  let items = [];
  try {
    const list = await mgmt('GET', 'openai-compatibility');
    items = Array.isArray(list) ? list : (list && list.items) || [];
  } catch (e) { /* engine not running or none */ }
  const el = $('prov-list');
  if (!items.length) {
    el.innerHTML = '<div class="empty">Немає OpenAI-сумісних провайдерів у рушії.</div>';
    return;
  }
  el.innerHTML = items.map((p) => {
    const models = (p.models || []).map((m) => m.alias || m.name).join(', ');
    return '<div class="prov-card">' +
      '<div class="prov-info">' +
      '<div class="prov-name">' + esc(p.name) + ' <span class="badge openai">OPENAI</span></div>' +
      '<div class="prov-url mono">' + esc(p['base-url'] || '') + '</div>' +
      '<div class="prov-meta"><span><b>' + (p.models || []).length + '</b> моделей</span>' +
      '<span class="mono">' + esc(models) + '</span></div>' +
      '</div>' +
      '<div class="prov-actions"><button class="btn btn-mini" data-name="' + esc(p.name) + '">Видалити</button></div>' +
      '</div>';
  }).join('');
  el.querySelectorAll('[data-name]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await mgmt('DELETE', 'openai-compatibility?name=' + encodeURIComponent(b.dataset.name));
        toast('Провайдера видалено');
        renderProvList();
      } catch (e) { toast('Помилка: ' + e.message, true); }
    });
  });
}

async function addProvider() {
  const name = $('prov-name').value.trim();
  const baseUrl = $('prov-url').value.trim();
  const key = $('prov-key').value.trim();
  const modelsRaw = $('prov-models').value.trim();
  if (!name || !baseUrl || !key) {
    msg($('prov-msg'), 'назва, base URL і ключ обовʼязкові', false);
    return;
  }
  const models = modelsRaw
    .split(String.fromCharCode(10))
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=');
      if (i > 0) return { name: l.slice(0, i).trim(), alias: l.slice(i + 1).trim() };
      return { name: l, alias: l };
    });
  const payload = [{
    name: name,
    'base-url': baseUrl,
    'api-key-entries': [{ 'api-key': key }],
    models: models,
  }];
  try {
    await mgmt('PUT', 'openai-compatibility', payload);
    $('prov-name').value = '';
    $('prov-url').value = '';
    $('prov-key').value = '';
    $('prov-models').value = '';
    msg($('prov-msg'), 'провайдера додано', true);
    renderProvList();
  } catch (e) {
    msg($('prov-msg'), 'не вдалось: ' + e.message, false);
  }
}
$('prov-add').addEventListener('click', addProvider);

async function renderNativeList() {
  const el = $('native-list');
  el.textContent = '…';
  try {
    const keys = await mgmt('GET', nativeTab);
    const arr = Array.isArray(keys) ? keys : [];
    if (!arr.length) {
      el.innerHTML = '<span class="muted">ключів немає</span>';
      return;
    }
    el.innerHTML = arr.map((k) => {
      const key = k['api-key'] || '';
      const masked = key.length > 8 ? key.slice(0, 6) + '…' + key.slice(-4) : '•••';
      const url = k['base-url'] || '';
      return '<div class="key-item"><span class="mono small">' + esc(masked) +
        '</span><span class="small muted mono">' + esc(url) +
        '</span><span class="del" data-key="' + esc(key) + '">✕</span></div>';
    }).join('');
    el.querySelectorAll('.del').forEach((d) => {
      d.addEventListener('click', async () => {
        try {
          await mgmt('DELETE', nativeTab + '?api-key=' + encodeURIComponent(d.dataset.key));
          renderNativeList();
        } catch (e) { toast('Помилка: ' + e.message, true); }
      });
    });
  } catch (e) {
    el.innerHTML = '<span class="muted">недоступно: ' + esc(e.message) + '</span>';
  }
}

async function addNativeKey() {
  const key = $('native-key').value.trim();
  const url = $('native-url').value.trim();
  if (!key) {
    msg($('native-msg'), 'введи ключ', false);
    return;
  }
  const entry = { 'api-key': key };
  if (url) entry['base-url'] = url;
  const payload = {};
  payload[nativeTab] = [entry];
  try {
    await mgmt('PUT', nativeTab, payload);
    $('native-key').value = '';
    $('native-url').value = '';
    msg($('native-msg'), nativeLabels[nativeTab] + ' ключ додано', true);
    renderNativeList();
  } catch (e) {
    msg($('native-msg'), 'не вдалось: ' + e.message, false);
  }
}

document.querySelectorAll('#native-tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#native-tabs button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    nativeTab = b.dataset.k;
    renderNativeList();
  });
});
$('native-add').addEventListener('click', addNativeKey);

// ---------- accounts page (OAuth) ----------
const OAUTH_PROVIDERS = [
  { id: 'anthropic', label: 'Claude', badge: 'Підписка', badgeClass: 'sub', tip: 'Підписка обов’язкова. Потрібен акаунт Anthropic з активною підпискою Pro, Team або API кредитами.' },
  { id: 'codex', label: 'Codex', badge: 'Підписка / API', badgeClass: 'sub', tip: 'Підписка обов’язкова. Потрібен акаунт OpenAI з активною підпискою ChatGPT Plus або Team.' },
  { id: 'antigravity', label: 'Gemini-Antigravity', badge: 'Безкоштовно', badgeClass: 'free', tip: 'Безкоштовно! Працює з будь-яким звичайним Google-акаунтом без підписок. Найвигідніший варіант для безліміту.' },
  { id: 'kimi', label: 'Kimi', badge: 'Freemium', badgeClass: 'freemium', tip: 'Freemium. Підтримує реєстрацію за номером телефону або поштою. Моделі k2/k3.' },
  { id: 'xai', label: 'xAI', badge: 'Підписка X', badgeClass: 'sub', tip: 'Підписка обов’язкова. Потрібен акаунт X (Twitter) з активною підпискою Premium або Premium+.' },
  { id: 'devin', label: 'Devin', badge: 'Freemium', badgeClass: 'freemium', tip: 'Акаунт розробника Devin або активна сесія.' },
  { id: 'meta', label: 'Meta', badge: 'Безкоштовно', badgeClass: 'free', tip: 'Безкоштовно! Потрібен звичайний акаунт Meta (Facebook / Instagram) без жодної плати.' },
];

let oauthTimer = null;

function renderOauthButtons() {
  $('oauth-buttons').innerHTML = OAUTH_PROVIDERS
    .map((p) => '<div class="oauth-btn-wrap">' +
      '<button class="btn btn-sm" data-p="' + p.id + '">' + p.label + ' — увійти</button>' +
      '<span class="oauth-badge ' + p.badgeClass + '">' + p.badge + '</span>' +
      '<span class="help-tip" data-tip="' + esc(p.tip) + '">?</span>' +
      '</div>')
    .join('');
  $('oauth-buttons').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => startOauth(b.dataset.p));
  });
}

async function startOauth(provider) {
  const st = $('oauth-status');
  st.textContent = 'Запускаю вхід ' + provider + '…';
  st.className = 'msg';
  try {
    const r = await fetch('/api/cliproxy/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: provider }),
    });
    const j = await r.json();
    if (j.url) {
      st.innerHTML = '<a href="' + esc(j.url) + '" target="_blank" style="color:var(--accent-2)">Відкрити сторінку входу ↗</a>';
      if (j.state) pollOauth(j.state);
    } else {
      st.textContent = j.error || ('не вдалось (' + r.status + ')');
      st.className = 'msg err';
    }
  } catch (e) {
    st.textContent = 'помилка: ' + e.message;
    st.className = 'msg err';
  }
}

function pollOauth(state) {
  clearInterval(oauthTimer);
  const st = $('oauth-status');
  let unknownErrors = 0;
  const deadline = Date.now() + 10 * 60 * 1000;
  oauthTimer = setInterval(async () => {
    if (Date.now() > deadline) {
      clearInterval(oauthTimer);
      st.textContent = 'Час очікування входу вичерпано (10 хв). Спробуй ще раз.';
      st.className = 'msg err';
      fetch('/api/cliproxy/oauth/cancel?state=' + encodeURIComponent(state), { method: 'DELETE' }).catch(() => {});
      return;
    }
    try {
      const r = await fetch('/api/cliproxy/oauth/status?state=' + encodeURIComponent(state));
      const j = await r.json();
      const status = j.status || '';
      if (status === 'ok' || status === 'success' || j.completed === true) {
        clearInterval(oauthTimer);
        st.textContent = '✓ Акаунт додано! Список оновлюється…';
        st.className = 'msg ok';
        fetch('/api/cliproxy/oauth/close-browser', { method: 'POST' }).catch(() => {});
        refreshCliproxy();
      } else if (status === 'error' || j.error) {
        if ((j.error || '').indexOf('unknown or expired') >= 0) {
          unknownErrors++;
          if (unknownErrors === 1) {
            st.textContent = 'Перевіряю результат входу…';
            st.className = 'msg';
            refreshCliproxy();
            return;
          }
          clearInterval(oauthTimer);
          st.textContent = '✓ Готово (сесію входу завершено). Якщо акаунта немає у списку — спробуй ще раз.';
          st.className = 'msg ok';
          return;
        }
        clearInterval(oauthTimer);
        st.textContent = 'вхід не вдався: ' + (j.error || status);
        st.className = 'msg err';
      }
    } catch (e) { /* transient */ }
  }, 2500);
}

async function refreshCliproxy() {
  try {
    const st = await api('/status');
    paintServerStatus(st);
  } catch (e) { /* keep old */ }
  await renderAuthFiles();
  await renderClipKeys();
}

async function renderAuthFiles() {
  const el = $('auth-files');
  try {
    const resp = await mgmt('GET', 'auth-files');
    const arr = Array.isArray(resp) ? resp : ((resp && resp.files) || []);
    if (!arr.length) {
      el.innerHTML = '<div class="empty">Акаунтів ще немає — увійди через кнопки вище.</div>';
      return;
    }
    el.innerHTML = arr.map((f) => {
      const name = f.email || f.account || f.label || f.name || f.filename || f.id || '';
      const fileKey = f.name || f.filename || f.id || '';
      const provider = (f.provider || f.type || '').toLowerCase();
      const status = f.status || '';
      const isError = status === 'error' || (f.cooldowns && f.cooldowns.length > 0);
      const ok = status && !isError && status !== 'unavailable';
      const authIndex = f.auth_index || '';
      return '<div class="auth-file-item">' +
        '<span class="st ' + (ok ? 'ok' : 'bad') + '"></span>' +
        '<span class="af-name"><b>' + esc(f.provider || f.type || 'account') + '</b> · ' + esc(name) + '</span>' +
        '<span class="chip ' + (ok ? '' : 'err') + '">' + esc(status || '—') + '</span>' +
        '<div class="af-actions">' +
        (fileKey ? '<button class="btn btn-mini btn-accent" data-to-provider="' + esc(fileKey) + '" data-name="' + esc(name) + '" title="Додати цей акаунт у список провайдерів">→ Провайдер</button>' : '') +
        (authIndex ? '<button class="btn btn-mini btn-ghost" data-reset-quota="' + esc(authIndex) + '" data-name="' + esc(name) + '" title="Скинути ліміти та 429 блокування">⚡ Скинути ліміт</button>' : '') +
        (provider ? '<button class="btn btn-mini btn-warn" data-reauth="' + esc(provider) + '" data-name="' + esc(name) + '" title="Переавторизувати акаунт через браузер">↻ Переавторизувати</button>' : '') +
        '<button class="btn btn-mini btn-danger" data-delete-account="' + esc(fileKey) + '" data-name="' + esc(name) + '" title="Видалити цей акаунт">🗑 Видалити</button>' +
        '</div></div>';
    }).join('');

    el.querySelectorAll('[data-to-provider]').forEach((b) => {
      b.addEventListener('click', async () => {
        const fileId = b.dataset.toProvider;
        const nm = b.dataset.name;
        b.disabled = true;
        try {
          const res = await api('/account-to-provider', {
            method: 'POST',
            body: JSON.stringify({ name: fileId }),
          });
          toast('Акаунт ' + nm + ' додано в провайдери ✓ (' + (res.models || 0) + ' моделей)');
          await collectModelOptions();
          refreshModels();
          if (document.getElementById("page-providers") && document.getElementById("page-providers").classList.contains('active')) {
            renderVgProviders();
          }
        } catch (e) {
          toast('Помилка додавання: ' + e.message, true);
        } finally {
          b.disabled = false;
        }
      });
    });

    // Auto-sync active OK accounts into app providers
    (async () => {
      try {
        const cfg = await api('/config');
        const provs = cfg.providers || [];
        let addedAny = false;
        for (const f of arr) {
          const fileKey = f.name || f.filename || f.id || '';
          const status = f.status || '';
          const isError = status === 'error' || (f.cooldowns && f.cooldowns.length > 0);
          const ok = status && !isError && status !== 'unavailable';
          if (ok && fileKey) {
            const exists = provs.some((p) => {
              const pid = String(p.id || '');
              const plabel = String(p.label || '');
              return pid.includes(fileKey.replace('.json', '')) || plabel.includes(f.name || '') || (f.email && plabel.includes(f.email));
            });
            if (!exists) {
              await api('/account-to-provider', {
                method: 'POST',
                body: JSON.stringify({ name: fileKey }),
              });
              addedAny = true;
            }
          }
        }
        if (addedAny) {
          await collectModelOptions();
          refreshModels();
          if (document.getElementById("page-providers") && document.getElementById("page-providers").classList.contains('active')) {
            renderVgProviders();
          }
        }
      } catch (e) { /* background auto-sync non-fatal */ }
    })();

    el.querySelectorAll('[data-reset-quota]').forEach((b) => {
      b.addEventListener('click', async () => {
        const idx = b.dataset.resetQuota;
        const nm = b.dataset.name;
        b.disabled = true;
        try {
          await mgmt('POST', 'reset-quota', { auth_index: idx });
          toast('Ліміт для ' + nm + ' успішно скинуто ✓');
          renderAuthFiles();
        } catch (e) {
          toast('Помилка скидання: ' + e.message, true);
          b.disabled = false;
        }
      });
    });

    el.querySelectorAll('[data-reauth]').forEach((b) => {
      b.addEventListener('click', () => {
        const prov = b.dataset.reauth;
        const nm = b.dataset.name;
        toast('Запуск переавторизації для ' + nm + '…');
        startOauth(prov);
      });
    });

    el.querySelectorAll('[data-delete-account]').forEach((b) => {
      b.addEventListener('click', async () => {
        const fileId = b.dataset.deleteAccount;
        const nm = b.dataset.name;
        if (!fileId) {
          toast('Не знайдено ID файлу акаунта', true);
          return;
        }
        if (!window.confirm('Ви дійсно хочете видалити акаунт ' + (nm || fileId) + '?')) {
          return;
        }
        b.disabled = true;
        try {
          await mgmt('DELETE', 'auth-files?name=' + encodeURIComponent(fileId));
          // Also clean up any legacy provider entry in cfg.providers if present
          try {
            const cfg = await api('/config');
            if (cfg.providers && cfg.providers.length) {
              const beforeLen = cfg.providers.length;
              const cleanKey = String(fileId || '').replace('.json', '').toLowerCase();
              const cleanNm = String(nm || '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
              cfg.providers = cfg.providers.filter((p) => {
                const pid = String(p.id || '').toLowerCase();
                if (pid === ('cp-' + String(fileId).toLowerCase()) || pid === ('cp-' + String(nm).toLowerCase())) return false;
                if (cleanKey && pid.includes(cleanKey)) return false;
                if (cleanNm && pid.includes(cleanNm)) return false;
                return true;
              });
              if (cfg.providers.length !== beforeLen) {
                await fetch('/api/config', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(cfg),
                });
              }
            }
          } catch (e) { /* non-fatal */ }

          toast('Акаунт ' + nm + ' успішно видалено ✓');
          await renderAuthFiles();
          await collectModelOptions();
          refreshModels();
          refreshMetrics();
        } catch (e) {
          toast('Помилка видалення: ' + e.message, true);
          b.disabled = false;
        }
      });
    });
  } catch (e) {
    el.innerHTML = '<div class="empty">недоступно: ' + esc(e.message) + '</div>';
  }
}

async function renderClipKeys() {
  const el = $('clip-keys');
  try {
    const keys = await mgmt('GET', 'api-keys');
    const list = Array.isArray(keys) ? keys : (keys && keys['api-keys']) || [];
    el.innerHTML = list.length
      ? list.map((k) => '<div class="key-item"><span class="mono small">' + esc(k) + '</span></div>').join('')
      : '<span class="muted">ключів немає — рушій приймає будь-який</span>';
  } catch (e) {
    el.innerHTML = '<span class="muted">недоступно: ' + esc(e.message) + '</span>';
  }
}

async function setClipKeys() {
  const k = $('clip-new-key').value.trim();
  if (!k) {
    msg($('clip-msg'), 'введи ключ', false);
    return;
  }
  try {
    const cur = await mgmt('GET', 'api-keys');
    const list = Array.isArray(cur) ? cur : (cur && cur['api-keys']) || [];
    const next = list.slice();
    if (!next.includes(k)) next.push(k);
    await mgmt('PUT', 'api-keys', next);
    $('clip-new-key').value = '';
    msg($('clip-msg'), 'ключ додано', true);
    renderClipKeys();
  } catch (e) {
    msg($('clip-msg'), 'не вдалось: ' + e.message, false);
  }
}
$('clip-key-add').addEventListener('click', setClipKeys);
$('auth-refresh').addEventListener('click', renderAuthFiles);

// ---------- metrics page (live usage-queue + auth-files quotas) ----------
const USAGE_STORE_KEY = 'vg.usageHistory';
let usageHistory = loadUsageHistory();

function loadUsageHistory() {
  try {
    const raw = localStorage.getItem(USAGE_STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveUsageHistory() {
  try { localStorage.setItem(USAGE_STORE_KEY, JSON.stringify(usageHistory.slice(0, 500))); } catch (e) { /* quota */ }
}

// The engine pops records off its queue (each one is delivered exactly
// once) and encodes every record as a JSON string — decode before use.
function parseUsageRecord(item) {
  if (item && typeof item === 'object') return item;
  if (typeof item === 'string') {
    try { const o = JSON.parse(item); if (o && typeof o === 'object') return o; } catch (e) { /* skip */ }
  }
  return null;
}

async function refreshMetrics() {
  let authFiles = [];
  try {
    const afResp = await mgmt('GET', 'auth-files');
    authFiles = Array.isArray(afResp) ? afResp : ((afResp && afResp.files) || []);
  } catch (e) { /* ignore */ }

  try {
    const queue = await mgmt('GET', 'usage-queue?count=100');
    if (Array.isArray(queue) && queue.length > 0) {
      const fresh = queue.map(parseUsageRecord).filter(Boolean);
      // Newest first; the queue itself is oldest-first.
      fresh.reverse();
      usageHistory = fresh.concat(usageHistory).slice(0, 500);
      saveUsageHistory();
    }
  } catch (e) { /* ignore */ }

  let totalInput = 0, totalOutput = 0, totalCached = 0, totalReasoning = 0, totalTokens = 0;
  const modelStats = {};

  for (const r of usageHistory) {
    const tok = r.tokens || {};
    const inp = Number(tok.input_tokens || 0);
    const out = Number(tok.output_tokens || 0);
    const cac = Number(tok.cached_tokens || tok.cache_read_tokens || 0);
    const rea = Number(tok.reasoning_tokens || 0);
    const tot = Number(tok.total_tokens || (inp + out));

    totalInput += inp;
    totalOutput += out;
    totalCached += cac;
    totalReasoning += rea;
    totalTokens += tot;

    const mName = r.model || 'unknown';
    if (!modelStats[mName]) {
      modelStats[mName] = { requests: 0, input: 0, output: 0, cached: 0, reasoning: 0, total: 0, failed: 0 };
    }
    modelStats[mName].requests++;
    modelStats[mName].input += inp;
    modelStats[mName].output += out;
    modelStats[mName].cached += cac;
    modelStats[mName].reasoning += rea;
    modelStats[mName].total += tot;
    if (r.failed) modelStats[mName].failed++;
  }

  let totalSuccess = 0, totalFailed = 0;
  for (const f of authFiles) {
    totalSuccess += Number(f.success || 0);
    totalFailed += Number(f.failed || 0);
  }
  const totalRequests = totalSuccess + totalFailed;
  const successRate = totalRequests > 0 ? Math.round((totalSuccess / totalRequests) * 100) : 100;

  function fmtNum(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  if ($('metric-total-tokens')) $('metric-total-tokens').textContent = fmtNum(totalTokens);
  if ($('metric-total-reqs')) $('metric-total-reqs').textContent = (totalRequests || usageHistory.length) + ' запитів';
  if ($('metric-input-tokens')) $('metric-input-tokens').textContent = fmtNum(totalInput);
  if ($('metric-cached-tokens')) $('metric-cached-tokens').textContent = fmtNum(totalCached) + ' кешовано';
  if ($('metric-output-tokens')) $('metric-output-tokens').textContent = fmtNum(totalOutput);
  if ($('metric-reasoning-tokens')) $('metric-reasoning-tokens').textContent = fmtNum(totalReasoning) + ' міркування';
  if ($('metric-success-rate')) $('metric-success-rate').textContent = successRate + '%';
  if ($('metric-success-counts')) $('metric-success-counts').textContent = totalSuccess + ' успішних / ' + totalFailed + ' помилок';

  renderAccountsQuotaTable(authFiles);
  renderModelsUsageTable(modelStats);
  renderRecentRequestsTable(usageHistory.slice(0, 30));
}

function renderAccountsQuotaTable(authFiles) {
  const el = $('accounts-quota-table');
  if (!el) return;
  if (!authFiles || !authFiles.length) {
    el.innerHTML = '<div class="empty">Немає підключених акаунтів. Додай акаунти на сторінці «Акаунти».</div>';
    return;
  }

  let html = '<table class="data-table"><thead><tr>' +
    '<th>Акаунт / Email</th>' +
    '<th>Провайдер</th>' +
    '<th>Статус квоти</th>' +
    '<th>Запити (OK / Помилки)</th>' +
    '<th>Дії</th>' +
    '</tr></thead><tbody>';

  for (const f of authFiles) {
    const name = f.email || f.account || f.label || f.name || f.id || 'акаунт';
    const provider = f.provider || f.type || '—';
    const isError = f.status === 'error' || (f.cooldowns && f.cooldowns.length > 0);
    const statusClass = isError ? 'error' : 'active';
    const statusText = isError ? '⚠ Ліміт / 429' : '● Активний (OK)';
    const authIndex = f.auth_index || '';

    let errMsg = '';
    if (f.status_message) {
      errMsg = f.status_message;
    } else if (f.cooldowns && f.cooldowns.length > 0) {
      const cd = f.cooldowns[0];
      errMsg = '429 Quota cooldown: ' + (cd.remaining_seconds || 0) + 's remaining (' + (cd.model_key || '') + ')';
    }

    html += '<tr>' +
      '<td><b>' + esc(name) + '</b></td>' +
      '<td><span class="chip">' + esc(provider) + '</span></td>' +
      '<td>' +
        '<span class="badge-quota ' + statusClass + '">' + esc(statusText) + '</span>' +
        (errMsg ? '<div class="quota-err-text" title="' + esc(errMsg) + '">' + esc(errMsg) + '</div>' : '') +
      '</td>' +
      '<td><b>' + (f.success || 0) + '</b> / <span style="color:' + (f.failed ? '#ef4444' : 'var(--muted)') + '">' + (f.failed || 0) + '</span></td>' +
      '<td>' +
        (authIndex
          ? '<button class="btn btn-mini btn-reset-quota" data-auth-index="' + esc(authIndex) + '" data-name="' + esc(name) + '">⚡ Скинути ліміт</button>'
          : '<span class="muted">—</span>') +
      '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;

  el.querySelectorAll('.btn-reset-quota').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = btn.dataset.authIndex;
      const nm = btn.dataset.name;
      btn.disabled = true;
      try {
        await mgmt('POST', 'reset-quota', { auth_index: idx });
        toast('Квоту акаунта ' + nm + ' успішно скинуто ✓');
        refreshMetrics();
      } catch (e) {
        toast('Не вдалося скинути квоту: ' + e.message, true);
        btn.disabled = false;
      }
    });
  });
}

function renderModelsUsageTable(modelStats) {
  const el = $('models-usage-table');
  if (!el) return;
  const keys = Object.keys(modelStats);
  if (!keys.length) {
    el.innerHTML = '<div class="empty">Ще немає даних про використання моделей. Запити з\'являться тут автоматично.</div>';
    return;
  }
  keys.sort((a, b) => modelStats[b].total - modelStats[a].total);

  let html = '<table class="data-table"><thead><tr>' +
    '<th>Модель</th>' +
    '<th>Запити</th>' +
    '<th>Вхідні токени</th>' +
    '<th>Кешовані токени</th>' +
    '<th>Вихідні токени</th>' +
    '<th>Всього токенів</th>' +
    '</tr></thead><tbody>';

  function fmt(n) { return (n || 0).toLocaleString(); }

  for (const k of keys) {
    const m = modelStats[k];
    html += '<tr>' +
      '<td><span class="mono"><b>' + esc(k) + '</b></span></td>' +
      '<td>' + m.requests + (m.failed ? ' <span style="color:#ef4444">(' + m.failed + ' помилок)</span>' : '') + '</td>' +
      '<td class="mono">' + fmt(m.input) + '</td>' +
      '<td class="mono">' + fmt(m.cached) + '</td>' +
      '<td class="mono">' + fmt(m.output) + (m.reasoning ? ' <span class="muted">(+' + fmt(m.reasoning) + ')</span>' : '') + '</td>' +
      '<td class="mono"><b>' + fmt(m.total) + '</b></td>' +
      '</tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderRecentRequestsTable(records) {
  const el = $('recent-requests-table');
  if (!el) return;
  if (!records || !records.length) {
    el.innerHTML = '<div class="empty">Черга останніх запитів порожня.</div>';
    return;
  }

  let html = '<table class="data-table"><thead><tr>' +
    '<th>Час</th>' +
    '<th>Акаунт / Джерело</th>' +
    '<th>Модель</th>' +
    '<th>Токени (In / Out)</th>' +
    '<th>Час (Latency)</th>' +
    '<th>Статус</th>' +
    '</tr></thead><tbody>';

  for (const r of records) {
    const t = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '—';
    const src = r.source || r.auth_index || '—';
    const m = r.model || '—';
    const tok = r.tokens || {};
    const inp = Number(tok.input_tokens || 0);
    const out = Number(tok.output_tokens || 0);
    const lat = r.latency_ms ? (r.latency_ms + ' ms') : '—';
    const ok = !r.failed;

    html += '<tr>' +
      '<td class="mono small">' + esc(t) + '</td>' +
      '<td>' + esc(src) + '</td>' +
      '<td class="mono small">' + esc(m) + '</td>' +
      '<td class="mono small">' + inp.toLocaleString() + ' / ' + out.toLocaleString() + '</td>' +
      '<td class="mono small">' + esc(lat) + '</td>' +
      '<td><span class="badge ' + (ok ? 'account' : 'openai') + '" style="' + (ok ? '' : 'background:rgba(239,68,68,0.2);color:#ef4444') + '">' + (ok ? 'OK' : 'Помилка') + '</span></td>' +
      '</tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

$('usage-refresh').addEventListener('click', refreshMetrics);

// ---------- settings page ----------
async function refreshSettings() {
  try {
    const cfg = await api('/config');
    $('set-host').value = cfg.cliproxy.host || '127.0.0.1';
    $('set-port').value = cfg.cliproxy.port || 8317;
    $('set-apikey').value = cfg.apiKey || '';
    $('set-require').checked = !!cfg.requireKey;
    $('set-extra').value = cfg.cliproxy.extraConfigYAML || '';
    renderBlacklistTags(cfg.modelBlacklist || []);
  } catch (e) { /* keep old */ }
}

async function saveSettings() {
  try {
    const cfg = await api('/config');
    cfg.cliproxy.host = $('set-host').value.trim() || '127.0.0.1';
    cfg.cliproxy.port = parseInt($('set-port').value, 10) || 8317;
    cfg.apiKey = $('set-apikey').value.trim();
    cfg.requireKey = $('set-require').checked;
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    msg($('set-msg'), 'збережено (порт/хост застосуються після «Перезапустити» на сторінці «Сервер»)', true);
  } catch (e) {
    msg($('set-msg'), 'помилка: ' + e.message, false);
  }
}

async function saveExtraYAML() {
  try {
    const cfg = await api('/config');
    cfg.cliproxy.extraConfigYAML = $('set-extra').value;
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    msg($('set-extra-msg'), 'збережено — рушій підхопить зміни сам (або натисни «Перезапустити»)', true);
  } catch (e) {
    msg($('set-extra-msg'), 'помилка: ' + e.message, false);
  }
}
$('set-save').addEventListener('click', saveSettings);
$('set-extra-save').addEventListener('click', saveExtraYAML);

// ---------- copy buttons (data-copy) ----------
document.querySelectorAll('[data-copy]').forEach((b) => {
  b.addEventListener('click', () => {
    const t = $(b.dataset.copy);
    const val = t.value !== undefined && t.tagName !== 'PRE' ? t.value : t.textContent;
    copyVal(val);
  });
});

// Mass model assignment: All Tiers
if ($('btnApplyAllTiers')) {
  $('btnApplyAllTiers').addEventListener('click', async () => {
    const selVal = cleanModelName($('applyAllTiersSelect').value);
    if (!selVal) {
      toast('Будь ласка, спочатку обери модель зі списку', true);
      return;
    }
    try {
      const cfg = await api('/config');
      cfg.routing = cfg.routing || {};
      cfg.routing.tiers = {
        haiku: selVal,
        sonnet: selVal,
        opus: selVal,
      };
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      $('tierHaiku').value = selVal;
      $('tierSonnet').value = selVal;
      $('tierOpus').value = selVal;
      renderAliases(cfg.routing);
      toast('Модель ' + selVal + ' призначено для Haiku, Sonnet та Opus ✓');
    } catch (e) {
      toast('Помилка: ' + e.message, true);
    }
  });
}

// Mass model assignment: All Official models
if ($('btnApplyAllOfficial')) {
  $('btnApplyAllOfficial').addEventListener('click', async () => {
    const selVal = cleanModelName($('applyAllOfficialSelect').value);
    if (!selVal) {
      toast('Будь ласка, спочатку обери модель зі списку', true);
      return;
    }
    try {
      const cfg = await api('/config');
      cfg.routing = cfg.routing || {};
      cfg.routing.modelMap = cfg.routing.modelMap || {};
      for (const m of OFFICIAL_MODELS) {
        cfg.routing.modelMap[m.id] = selVal;
      }
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      await renderOfficialList();
      toast('Модель ' + selVal + ' призначено для ВСІХ офіційних моделей Claude ✓');
    } catch (e) {
      toast('Помилка: ' + e.message, true);
    }
  });
}

if ($('btnResetAllOfficial')) {
  $('btnResetAllOfficial').addEventListener('click', async () => {
    try {
      const cfg = await api('/config');
      cfg.routing = cfg.routing || {};
      cfg.routing.modelMap = {};
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      await renderOfficialList();
      toast('Усі офіційні моделі скинуто до (йде як є) ✓');
    } catch (e) {
      toast('Помилка: ' + e.message, true);
    }
  });
}

// ---------- settings: model blacklist ----------
let ALL_CATALOG_MODELS = [];

function renderBlacklistTags(list) {
  const box = $('set-blacklist-tags');
  if (!box) return;
  box.innerHTML = '';
  if (!list || !list.length) {
    box.innerHTML = '<span class="muted small" style="padding:4px">Чорний список порожній (усі моделі дозволені).</span>';
    return;
  }
  for (const item of list) {
    const tag = document.createElement('span');
    tag.className = 'blacklist-tag';
    tag.title = 'Клікни, щоб видалити ' + item + ' з чорного списку';
    tag.innerHTML = '<span>' + esc(item) + '</span>' +
      '<span class="blacklist-remove" data-id="' + esc(item) + '" title="Видалити з чорного списку">✕</span>';
    tag.addEventListener('click', (e) => {
      e.stopPropagation();
      removeBlacklistModel(item);
    });
    box.appendChild(tag);
  }
}

async function removeBlacklistModel(modelId) {
  try {
    const cfg = await api('/config');
    cfg.modelBlacklist = (cfg.modelBlacklist || []).filter((x) => x.toLowerCase().trim() !== modelId.toLowerCase().trim());
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    MODEL_BLACKLIST = cfg.modelBlacklist.map((s) => s.toLowerCase().trim());
    renderBlacklistTags(cfg.modelBlacklist);
    renderAllModelsCatalog();
    toast('Модель ' + modelId + ' видалено з чорного списку ✓');
    await collectModelOptions();
    refreshModels();
  } catch (e) {
    toast('Помилка: ' + e.message, true);
  }
}

async function addBlacklistModel(modelId) {
  const val = (modelId || '').trim();
  if (!val) return;
  try {
    const cfg = await api('/config');
    cfg.modelBlacklist = cfg.modelBlacklist || [];
    const exists = cfg.modelBlacklist.some((x) => x.toLowerCase().trim() === val.toLowerCase());
    if (!exists) {
      cfg.modelBlacklist.push(val);
    }
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    MODEL_BLACKLIST = cfg.modelBlacklist.map((s) => s.toLowerCase().trim());
    renderBlacklistTags(cfg.modelBlacklist);
    renderAllModelsCatalog();
    toast('Модель ' + val + ' додано до чорного списку ✓');
    await collectModelOptions();
    refreshModels();
  } catch (e) {
    toast('Помилка: ' + e.message, true);
  }
}

async function toggleBlacklistModel(modelId) {
  if (isModelBlacklisted(modelId)) {
    await removeBlacklistModel(modelId);
  } else {
    await addBlacklistModel(modelId);
  }
}

async function loadAllAvailableModels() {
  const btn = $('set-blacklist-load');
  const filterInput = $('set-blacklist-filter');
  const catalogBox = $('set-blacklist-catalog');
  if (btn) btn.textContent = '⏳ Завантаження моделей…';

  await collectModelOptions();

  const set = new Set();

  // 1. From PROVIDER_KNOWN_MODELS
  for (const prov in PROVIDER_KNOWN_MODELS) {
    for (const m of PROVIDER_KNOWN_MODELS[prov]) {
      if (m && m.id) set.add(m.id);
    }
  }

  // 2. From OFFICIAL_MODELS
  for (const m of OFFICIAL_MODELS) {
    if (m && m.id) set.add(m.id);
  }

  // 3. From MODEL_OPTS (collected from accounts + custom providers)
  for (const opt of MODEL_OPTS) {
    const clean = cleanModelName(opt);
    if (clean) set.add(clean);
  }

  // 4. From current config mappings and blacklist
  try {
    const cfg = await api('/config');
    if (cfg.routing && cfg.routing.tiers) {
      for (const k in cfg.routing.tiers) {
        if (cfg.routing.tiers[k]) set.add(cleanModelName(cfg.routing.tiers[k]));
      }
    }
    if (cfg.routing && cfg.routing.modelMap) {
      for (const k in cfg.routing.modelMap) {
        if (cfg.routing.modelMap[k]) set.add(cleanModelName(cfg.routing.modelMap[k]));
      }
    }
    if (cfg.modelBlacklist) {
      for (const b of cfg.modelBlacklist) {
        if (b) set.add(b.trim());
      }
    }
  } catch (e) { /* ignore */ }

  ALL_CATALOG_MODELS = Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b));

  if (filterInput) filterInput.style.display = 'inline-block';
  if (catalogBox) catalogBox.style.display = 'flex';
  if (btn) btn.textContent = '↻ Оновити весь список (' + ALL_CATALOG_MODELS.length + ')';

  renderAllModelsCatalog();
}

function renderAllModelsCatalog() {
  const catalogBox = $('set-blacklist-catalog');
  const countEl = $('set-blacklist-count');
  const filterInput = $('set-blacklist-filter');
  if (!catalogBox || !ALL_CATALOG_MODELS.length) return;

  const q = (filterInput && filterInput.value ? filterInput.value.toLowerCase().trim() : '');
  const filtered = ALL_CATALOG_MODELS.filter((m) => !q || m.toLowerCase().includes(q));

  if (countEl) {
    countEl.textContent = 'Показано: ' + filtered.length + ' із ' + ALL_CATALOG_MODELS.length;
  }

  catalogBox.innerHTML = '';
  if (!filtered.length) {
    catalogBox.innerHTML = '<span class="muted small" style="padding:4px">За запитом «' + esc(q) + '» нічого не знайдено.</span>';
    return;
  }

  for (const m of filtered) {
    const blacklisted = isModelBlacklisted(m);
    const chip = document.createElement('span');
    chip.className = 'model-chip ' + (blacklisted ? 'blacklisted' : 'available');
    chip.title = blacklisted
      ? 'У чорному списку. Клікни, щоб РОЗБЛОКУВАТИ'
      : 'Клікни, щоб ДОДАТИ в чорний список';
    chip.innerHTML = (blacklisted ? '🚫 ' : '+ ') + esc(m);
    chip.addEventListener('click', () => toggleBlacklistModel(m));
    catalogBox.appendChild(chip);
  }
}

if ($('set-blacklist-load')) {
  $('set-blacklist-load').addEventListener('click', loadAllAvailableModels);
}
if ($('set-blacklist-filter')) {
  $('set-blacklist-filter').addEventListener('input', renderAllModelsCatalog);
}

if ($('set-blacklist-add')) {
  $('set-blacklist-add').addEventListener('click', async () => {
    const input = $('set-blacklist-input');
    const val = (input.value || '').trim();
    if (!val) {
      msg($('set-blacklist-msg'), 'Введи назву або ID моделі', false);
      return;
    }
    await addBlacklistModel(val);
    input.value = '';
    msg($('set-blacklist-msg'), 'Модель ' + val + ' додано до чорного списку ✓', true);
  });
}

// ---------- boot ----------
renderOauthButtons();
updateFoot();
collectModelOptions().then(() => {
  if (LAST_STATUS) {
    const ep = { openai: $('epOpenAI').value, anthropic: $('epAnthropic').value, key: $('apiKey').value };
    fillDefaultModelSelect(ep);
  }
});
showPage('server');
