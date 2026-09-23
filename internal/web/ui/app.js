'use strict';
// CarteLink UI — talks to /api/* on the same origin as the engine.

const $ = (id) => document.getElementById(id);
const NL = String.fromCharCode(10);

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
function toast(text, isErr) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  // Errors stay longer so they can actually be read.
  toastTimer = setTimeout(() => { t.className = 'toast hidden'; }, isErr ? 6000 : 2400);
}

async function copyVal(text, label) {
  if (!text) { toast('Нічого копіювати', true); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast((label || 'Скопійовано') + ' ✓');
  } catch (e) {
    window.prompt('Скопіюй вручну:', text);
  }
}

// ---------- api helpers ----------
async function api(path, opts) {
  opts = opts || {};
  if (opts.body && !opts.headers) opts.headers = { 'Content-Type': 'application/json' };
  const res = await fetch('/api' + path, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-json */ }
  if (!res.ok || (data && data.ok === false && data.error)) {
    throw new Error((data && data.error) || text || ('HTTP ' + res.status));
  }
  return data;
}

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

// Every config change goes through one queue: GET the fresh config, apply
// the change, PUT it back and check the answer. Queued so two quick edits
// never overwrite each other; a rejected save is reported, never "✓".
let CFG_CACHE = null;
let saveChain = Promise.resolve();
function saveConfig(mutate) {
  const run = async () => {
    const cfg = await api('/config');
    const r = mutate(cfg);
    if (r === false) return { cfg: cfg, skipped: true };
    const res = await api('/config', { method: 'PUT', body: JSON.stringify(cfg) });
    CFG_CACHE = cfg;
    return Object.assign({ cfg: cfg }, res || {});
  };
  const p = saveChain.then(run, run);
  saveChain = p.catch(() => {});
  return p;
}

async function getConfig() {
  CFG_CACHE = await api('/config');
  return CFG_CACHE;
}

function msg(el, text, ok) {
  if (!el) return;
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, ok ? 4000 : 9000);
}

function confirmDo(text) {
  return window.confirm(text);
}

// ---------- navigation ----------
let metricsPollTimer = null;
const PAGE_KEY = 'cl.page';

function showPage(name) {
  if (!$('page-' + name)) name = 'home';
  document.querySelectorAll('nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  document.querySelectorAll('.page').forEach((p) => {
    p.classList.toggle('active', p.id === 'page-' + name);
  });
  try { localStorage.setItem(PAGE_KEY, name); } catch (e) { /* ignore */ }
  const mainEl = document.querySelector('main');
  if (mainEl) mainEl.scrollTop = 0;

  if (metricsPollTimer && name !== 'metrics' && name !== 'home') {
    clearInterval(metricsPollTimer);
    metricsPollTimer = null;
  }
  if (name === 'home') refreshHome();
  if (name === 'clients') refreshClients();
  if (name === 'providers') refreshProviders();
  if (name === 'models') refreshModels();
  if (name === 'cliproxy') refreshCliproxy();
  if (name === 'metrics') {
    refreshMetrics();
    if (!metricsPollTimer) metricsPollTimer = setInterval(refreshMetrics, 3000);
  }
  if (name === 'settings') refreshSettings();
}

document.querySelectorAll('nav button').forEach((b) => {
  b.addEventListener('click', () => showPage(b.dataset.page));
});
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) showPage(g.dataset.goto);
});

// ---------- port-move banner ----------
(function initBanner() {
  try {
    const q = new URLSearchParams(location.search);
    const moved = q.get('moved');
    if (moved && $('port-banner')) {
      $('port-banner').textContent =
        'Порт ' + moved + ' зайнятий іншою програмою, тому зараз CarteLink працює на порту ' +
        (q.get('port') || '?') + '. Це лише на цей запуск — звільни порт ' + moved +
        ' (закрий іншу програму) і перезапусти CarteLink, щоб повернутись до звичної адреси.';
      $('port-banner').style.display = '';
    }
  } catch (e) { /* no banner */ }
})();

// ---------- shared status ----------
let LAST_STATUS = null;
let LAST_EP = null;

function displayHost(h) {
  h = String(h || '').trim();
  if (!h || h === '0.0.0.0' || h === '::' || h === '[::]') return '127.0.0.1';
  return h;
}

function fmtNum(n) {
  n = Number(n || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

async function loadStatus() {
  const st = await api('/status');
  LAST_STATUS = st;
  paintServerStatus(st);
  return st;
}

function paintServerStatus(st) {
  const eng = st.engine || {};
  const running = !!eng.running;
  const restarting = !!eng.restarting;
  const paused = !!eng.paused;
  const host = displayHost(eng.host);
  let headline = running ? 'Працює' : (paused ? 'Пауза' : 'Зупинено');
  let sub = running ? 'Програми можуть підключатись до http://' + host + ':' + eng.port : 'Шлюз не приймає запити.';
  if (restarting) { headline = 'Перезапуск…'; sub = 'Рушій перезапускається.'; }
  else if (paused) { sub = 'Запити від програм тимчасово не приймаються. Натисни «Запустити».'; }
  if (eng.lastError) { sub += ' Помилка: ' + eng.lastError; }
  $('bigDot').className = 'big-dot ' + (running ? 'on' : 'off');
  $('statusHeadline').textContent = headline;
  $('statusSub').textContent = sub;
  $('btnStart').disabled = running || restarting;
  $('btnStop').disabled = !running || restarting;
  $('btnRestart').disabled = restarting;
  $('tbStatus').className = 'tb-pill ' + (running ? 'on' : 'off');
  $('tbStatusText').textContent = running ? 'працює :' + eng.port : (paused ? 'пауза' : 'зупинено');
  if (st.version) $('sidebar-version').textContent = 'v' + st.version;
}

// After a restart the engine may come back on another port: poll its
// /api/status and move the window there.
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
          refreshHome();
          return;
        }
      }
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  toast('Рушій не відповів за 20 с — подивись app.log (Довідка → «Якщо щось не працює»)', true);
  refreshHome();
}

async function serverAction(kind) {
  if (kind === 'stop' && !confirmDo('Поставити шлюз на паузу? Програми отримуватимуть помилку, доки не натиснеш «Запустити».')) return;
  const map = { start: 'Запуск…', stop: 'Пауза…', restart: 'Перезапуск…' };
  toast(map[kind] || '…');
  try {
    const r = await api('/server/' + kind, { method: 'POST' });
    if (r.restarting) { followRestart(r.host, r.port); return; }
    toast(kind === 'stop' ? 'На паузі' : 'Працює ✓');
  } catch (e) {
    toast('Помилка: ' + e.message, true);
  }
  refreshHome();
}

$('btnStart').addEventListener('click', () => serverAction('start'));
$('btnStop').addEventListener('click', () => serverAction('stop'));
$('btnRestart').addEventListener('click', () => serverAction('restart'));

$('btnRevealKey').addEventListener('click', () => {
  const k = $('apiKey');
  k.type = k.type === 'password' ? 'text' : 'password';
});

// Sidebar status: a light poll so the pill stays honest everywhere.
setInterval(() => { if (document.body.classList.contains('authed')) loadStatus().catch(() => {}); }, 5000);

// ---------- model option lists (shared by every model <select>) ----------
let MODEL_OPTS = [];
let MODEL_GROUPS = [];
let MODEL_BLACKLIST = [];
let AUTH_FILES = [];

function isModelBlacklisted(id) {
  if (!id) return false;
  const low = String(id).toLowerCase().trim();
  return MODEL_BLACKLIST.some((b) => b && low === b);
}

function cleanModelName(s) {
  if (!s) return '';
  s = String(s);
  const i = s.indexOf(':');
  if (i > 0 && s.indexOf('://') < 0) return s.slice(i + 1);
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
      if (!found && cleanCur && cleanModelName(item.value) === cleanCur) {
        opt.selected = true;
        found = true;
      }
      optgroup.appendChild(opt);
    }
    sel.appendChild(optgroup);
  }
  // A saved value no longer offered (account removed…) stays visible.
  if (cleanCur && !found) {
    const opt = document.createElement('option');
    opt.value = cleanCur;
    opt.textContent = cleanCur + ' (недоступна зараз)';
    opt.selected = true;
    sel.appendChild(opt);
  }
}

// Candidate models: the real models of connected accounts (fetched from the
// engine, never a hard-coded guess) + OpenAI-compatible providers.
async function collectModelOptions() {
  const groups = [];
  const allOpts = new Set();

  try {
    const cfg = await getConfig();
    MODEL_BLACKLIST = (cfg.modelBlacklist || []).map((s) => String(s).toLowerCase().trim());
  } catch (e) { /* defaults */ }

  let authFiles = [];
  try {
    const resp = await mgmt('GET', 'auth-files');
    authFiles = Array.isArray(resp) ? resp : ((resp && resp.files) || []);
  } catch (e) { /* engine offline */ }
  AUTH_FILES = authFiles;

  const byProv = {};
  await Promise.all(authFiles.map(async (f) => {
    const name = f.name || f.filename || f.id || '';
    const prov = (f.provider || f.type || 'account').toLowerCase();
    if (!name) return;
    try {
      const mr = await mgmt('GET', 'auth-files/models?name=' + encodeURIComponent(name));
      for (const m of ((mr && mr.models) || [])) {
        if (m && m.id) {
          (byProv[prov] = byProv[prov] || new Set()).add(m.id);
        }
      }
    } catch (e) { /* per-file error tolerated */ }
  }));
  for (const prov of Object.keys(byProv).sort()) {
    const ids = Array.from(byProv[prov]).sort();
    const count = authFiles.filter((f) => (f.provider || f.type || '').toLowerCase() === prov).length;
    groups.push({
      label: '◆ ' + prov.charAt(0).toUpperCase() + prov.slice(1) + (count > 1 ? ' (' + count + ' акаунти, чергуються)' : ''),
      options: ids.map((id) => ({ value: id, text: id })),
    });
    ids.forEach((id) => allOpts.add(id));
  }

  // OpenAI-compatible providers living in the engine: clients call them by
  // alias (with the optional prefix), so offer exactly those names.
  try {
    const compat = await fetchCompatList();
    for (const p of compat) {
      if (p.disabled) continue;
      const pOpts = [];
      for (const m of (p.models || [])) {
        const alias = m.alias || m.name;
        if (!alias) continue;
        const names = p.prefix ? [alias, p.prefix + '/' + alias] : [alias];
        for (const n of names) {
          pOpts.push({ value: n, text: n });
          allOpts.add(n);
        }
      }
      if (pOpts.length) groups.push({ label: '≡ ' + (p.name || 'provider'), options: pOpts });
    }
  } catch (e) { /* engine offline */ }

  MODEL_GROUPS = groups;
  MODEL_OPTS = Array.from(allOpts);
}

// ---------- HOME ----------
const WIZ_KEY = 'cl.wizardHidden';

async function refreshHome() {
  let st = null;
  try { st = await loadStatus(); } catch (e) { return; }
  try {
    const ep = await api('/endpoints');
    LAST_EP = ep;
    $('epBase').value = ep.base || ep.anthropic;
    $('epOpenAI').value = (ep.base || ep.anthropic) + '/v1';
    $('apiKey').value = st.requireKey ? (ep.key || '') : 'будь-який (перевірку ключа вимкнено)';
  } catch (e) { /* keep */ }

  await collectModelOptions();
  const routing = st.routing || {};
  const main = cleanModelName(routing.tiers && (routing.tiers.sonnet || routing.tiers.main)) || cleanModelName(routing.defaultModel);
  $('homeModel').textContent = main || 'не обрано';
  populateModelSelect($('wizModel'), main, '— обери модель —');

  const okAccounts = AUTH_FILES.filter((f) => accountOk(f)).length;
  $('homeAccounts').textContent = String(AUTH_FILES.length);
  $('homeAccountsSub').textContent = AUTH_FILES.length ? (okAccounts + ' активні' + (AUTH_FILES.length - okAccounts ? ', ' + (AUTH_FILES.length - okAccounts) + ' на паузі/ліміті' : '')) : 'не підключено';

  try {
    const m = await api('/metrics');
    const s = (m && m.metrics) || {};
    $('homeReqs').textContent = fmtNum(s.total_requests || 0);
    $('homeReqsSub').textContent = (s.total_failed || 0) + ' помилок';
    $('homeTokens').textContent = fmtNum(s.total_tokens || 0);
  } catch (e) { /* ignore */ }

  // Wizard: steps tick off by themselves.
  const hasCompat = MODEL_GROUPS.some((g) => g.label.indexOf('≡') === 0);
  const step1 = AUTH_FILES.length > 0 || hasCompat;
  const step2 = !!main;
  let step3 = false;
  try { step3 = localStorage.getItem('cl.clientDone') === '1'; } catch (e) { /* ignore */ }
  $('wiz1').classList.toggle('done', step1);
  $('wiz2').classList.toggle('done', step2);
  $('wiz3').classList.toggle('done', step3);
  $('wiz1sub').textContent = step1 ? 'Готово: ' + AUTH_FILES.length + ' акаунт(ів).' : 'Наприклад, звичайний Google-акаунт (Gemini-Antigravity) — безкоштовно.';
  $('wiz2sub').textContent = step2 ? 'Зараз: ' + main + '. Можна змінити тут або на сторінці «Моделі».' : 'Вона обслуговуватиме всі запити. Тонко налаштувати можна на сторінці «Моделі».';
  let hidden = false;
  try { hidden = localStorage.getItem(WIZ_KEY) === '1'; } catch (e) { /* ignore */ }
  $('wizard').style.display = hidden ? 'none' : '';
}

function accountOk(f) {
  const status = f.status || '';
  const isError = status === 'error' || (f.cooldowns && f.cooldowns.length > 0);
  return !!status && !isError && status !== 'unavailable' && !f.disabled;
}

// One model for everything: all tiers + default model.
async function applyModelEverywhere(model, msgEl) {
  model = cleanModelName(model);
  if (!model) { toast('Спочатку обери модель зі списку', true); return false; }
  try {
    await saveConfig((cfg) => {
      cfg.routing = cfg.routing || {};
      const t = cfg.routing.tiers = cfg.routing.tiers || {};
      t.haiku = t.sonnet = t.opus = t.fast = t.main = t.max = model;
      cfg.routing.defaultModel = model;
      cfg.routing.defaultProviderId = '';
    });
    toast('Модель ' + model + ' тепер основна ✓');
    if (msgEl) msg(msgEl, 'Збережено ✓', true);
    return true;
  } catch (e) {
    toast('Не збережено: ' + e.message, true);
    return false;
  }
}

$('wizModelSave').addEventListener('click', async () => {
  if (await applyModelEverywhere($('wizModel').value)) refreshHome();
});
$('wizardHide').addEventListener('click', () => {
  try { localStorage.setItem(WIZ_KEY, '1'); } catch (e) { /* ignore */ }
  $('wizard').style.display = 'none';
});
$('wizardShow').addEventListener('click', () => {
  try { localStorage.removeItem(WIZ_KEY); } catch (e) { /* ignore */ }
  showPage('home');
});

// ---------- CLIENTS ----------
let CLIENT_SEL = null;
let CLIENT_SHELL = null;
let CLIENT_PERSIST = true;
const CLIENT_KIND = { cli: 'Термінал', ide: 'Редактор коду', app: 'Чат-застосунок', sdk: 'Для розробників' };

function defaultShell() {
  const p = (navigator.platform || '').toLowerCase();
  return p.indexOf('win') >= 0 ? 'ps' : 'bash';
}

function clientVars() {
  const st = LAST_STATUS || {};
  const ep = LAST_EP || {};
  const base = ep.base || ep.anthropic || ('http://127.0.0.1:' + ((st.engine && st.engine.port) || 8317));
  const tiers = (st.routing && st.routing.tiers) || {};
  const key = st.requireKey === false ? 'any' : (ep.key || '<ключ>');
  return {
    BASE: base,
    BASE_V1: base + '/v1',
    KEY: key,
    MODEL: $('clientModel') ? ($('clientModel').value || 'cartelink-main') : (tiers.main ? 'cartelink-main' : 'cartelink-main'),
    MODEL_FAST: $('clientModelFast') ? ($('clientModelFast').value || 'cartelink-fast') : 'cartelink-fast',
  };
}

function fillVars(s, v) {
  return String(s || '').replace(/\{\{(BASE_V1|BASE|KEY|MODEL_FAST|MODEL)\}\}/g, (m, k) => v[k]);
}

function envScript(env, shell, persist, v) {
  const lines = [];
  for (const [k, raw] of env) {
    const val = fillVars(raw, v);
    if (shell === 'ps') {
      lines.push(persist
        ? '[Environment]::SetEnvironmentVariable("' + k + '", "' + val + '", "User")'
        : '$env:' + k + ' = "' + val + '"');
    } else if (shell === 'cmd') {
      lines.push(persist ? 'setx ' + k + ' "' + val + '"' : 'set "' + k + '=' + val + '"');
    } else {
      lines.push('export ' + k + '="' + val + '"');
    }
  }
  if (persist && shell === 'bash') {
    lines.unshift('# додай ці рядки в кінець ~/.zshrc (macOS) або ~/.bashrc (Linux):');
  }
  if (persist && shell !== 'bash') {
    lines.push('');
    lines.push(shell === 'ps' ? '# потім закрий і знову відкрий термінал' : 'REM потім закрий і знову відкрий термінал');
  }
  return lines.join(NL);
}

function renderClientList() {
  const box = $('clientList');
  const list = window.CLIENTS || [];
  const q = ($('clientSearch').value || '').toLowerCase().trim();
  const kinds = ['cli', 'ide', 'app', 'sdk'];
  let html = '';
  for (const kind of kinds) {
    const items = list.filter((c) => c.kind === kind && (!q || c.name.toLowerCase().includes(q) || c.id.includes(q)));
    if (!items.length) continue;
    html += '<div class="client-kind">' + esc(CLIENT_KIND[kind] || kind) + '</div>';
    html += items.map((c) => '<button class="client-item' + (c.id === CLIENT_SEL ? ' active' : '') + '" data-client="' + esc(c.id) + '">' +
      esc(c.name) + (c.uncertain ? ' <span class="chip" title="Власна адреса підтримується частково — дивись примітку">!</span>' : '') + '</button>').join('');
  }
  box.innerHTML = html || '<div class="empty">Нічого не знайдено</div>';
  box.querySelectorAll('[data-client]').forEach((b) => {
    b.addEventListener('click', () => { CLIENT_SEL = b.dataset.client; renderClientList(); renderClientDetail(); });
  });
}

function codeBlock(id, title, text) {
  return '<div class="code-head"><span>' + esc(title) + '</span><button class="btn btn-mini" data-copy-block="' + id + '">Копіювати</button></div>' +
    '<pre class="snippet" id="' + id + '">' + esc(text) + '</pre>';
}

function renderClientDetail() {
  const box = $('clientDetail');
  const c = (window.CLIENTS || []).find((x) => x.id === CLIENT_SEL);
  if (!c) {
    box.innerHTML = '<div class="empty">Обери програму зліва.</div>';
    return;
  }
  const keepModel = $('clientModel') ? $('clientModel').value : null;
  const keepFast = $('clientModelFast') ? $('clientModelFast').value : null;
  const needsModel = JSON.stringify([c.env, c.file, c.steps]).indexOf('{{MODEL') >= 0;
  let html = '<div class="card-title">' + esc(c.name) +
    (c.docs ? ' <a class="hint" href="' + esc(c.docs) + '" target="_blank" rel="noopener">документація ↗</a>' : '') + '</div>';
  if (c.note) html += '<div class="notice-inline' + (c.uncertain ? ' warn' : '') + '">' + esc(c.note) + '</div>';
  if (needsModel) {
    html += '<div class="grid two" style="margin-top:12px">' +
      '<label>Модель <select id="clientModel"></select></label>' +
      '<label>Швидка модель <select id="clientModelFast"></select></label></div>';
  }
  html += '<div id="clientBody"></div>';
  html += '<div class="row-end" style="margin-top:14px"><button class="btn btn-sm btn-accent" id="clientDone">✓ Я підключив</button></div>';
  box.innerHTML = html;

  if (needsModel) {
    const aliasOpts = [
      { value: 'cartelink-main', text: 'cartelink-main — основна (рекомендовано)' },
      { value: 'cartelink-fast', text: 'cartelink-fast — швидка' },
      { value: 'cartelink-max', text: 'cartelink-max — потужна' },
    ];
    const fill = (sel, cur) => {
      sel.innerHTML = '';
      const g = document.createElement('optgroup');
      g.label = 'Рівні CarteLink (міняються на сторінці «Моделі»)';
      aliasOpts.forEach((o) => { const op = document.createElement('option'); op.value = o.value; op.textContent = o.text; g.appendChild(op); });
      sel.appendChild(g);
      for (const grp of MODEL_GROUPS) {
        const og = document.createElement('optgroup');
        og.label = grp.label;
        grp.options.forEach((o) => { const op = document.createElement('option'); op.value = cleanModelName(o.value); op.textContent = o.text; og.appendChild(op); });
        sel.appendChild(og);
      }
      if (cur) sel.value = cur;
    };
    fill($('clientModel'), keepModel || 'cartelink-main');
    fill($('clientModelFast'), keepFast || 'cartelink-fast');
    $('clientModel').addEventListener('change', renderClientBody);
    $('clientModelFast').addEventListener('change', renderClientBody);
  }
  $('clientDone').addEventListener('click', () => {
    try { localStorage.setItem('cl.clientDone', '1'); } catch (e) { /* ignore */ }
    toast('Готово! Якщо програма пише помилку — дивись Довідку.');
  });
  renderClientBody();
}

function renderClientBody() {
  const c = (window.CLIENTS || []).find((x) => x.id === CLIENT_SEL);
  const body = $('clientBody');
  if (!c || !body) return;
  const v = clientVars();
  let html = '';
  let step = 1;
  if (c.steps && c.steps.length) {
    html += '<ol class="client-steps">' + c.steps.map((s) => '<li>' + esc(fillVars(s, v)) + '</li>').join('') + '</ol>';
    step = c.steps.length + 1;
  }
  if (c.env && c.env.length) {
    const shell = CLIENT_SHELL || defaultShell();
    html += '<div class="step-title">' + (c.file ? 'Спосіб 1 — змінні середовища' : 'Виконай у терміналі') + '</div>';
    html += '<div class="seg" id="shellSeg">' +
      [['ps', 'PowerShell'], ['cmd', 'CMD'], ['bash', 'macOS / Linux']].map(([k, l]) =>
        '<button data-shell="' + k + '" class="' + (k === shell ? 'active' : '') + '">' + l + '</button>').join('') +
      '</div>';
    html += '<label class="check small" style="margin:8px 0"><input type="checkbox" id="persistChk"' + (CLIENT_PERSIST ? ' checked' : '') + '> Назавжди (а не лише для цього вікна терміналу)</label>';
    html += codeBlock('envCode', shell === 'bash' ? 'bash / zsh' : (shell === 'ps' ? 'PowerShell' : 'CMD'), envScript(c.env, shell, CLIENT_PERSIST, v));
  }
  if (c.file) {
    html += '<div class="step-title">' + (c.env && c.env.length ? 'Спосіб 2 — файл налаштувань' : 'Файл налаштувань') + '</div>';
    html += '<p class="hint" style="margin:0 0 6px">Створи або відкрий файл <code>' + esc(c.file.path) + '</code> (на Windows <code>~</code> — це <code>C:\\Users\\&lt;ім\'я&gt;</code>) і встав:</p>';
    html += codeBlock('fileCode', c.file.path, fillVars(c.file.content, v));
  }
  body.innerHTML = html;
  body.querySelectorAll('[data-shell]').forEach((b) => b.addEventListener('click', () => { CLIENT_SHELL = b.dataset.shell; renderClientBody(); }));
  if ($('persistChk')) $('persistChk').addEventListener('change', () => { CLIENT_PERSIST = $('persistChk').checked; renderClientBody(); });
  body.querySelectorAll('[data-copy-block]').forEach((b) => b.addEventListener('click', () => copyVal($(b.dataset.copyBlock).textContent)));
}

async function refreshClients() {
  try {
    await loadStatus();
    LAST_EP = await api('/endpoints');
  } catch (e) { /* keep */ }
  if (!MODEL_GROUPS.length) await collectModelOptions();
  if (!CLIENT_SEL) CLIENT_SEL = 'claude-code';
  renderClientList();
  renderClientDetail();
}
$('clientSearch').addEventListener('input', renderClientList);

// ---------- MODELS ----------
const OFFICIAL_MODELS = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-opus-3', label: 'Opus 3' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
];
const TIER_SELECTS = { haiku: 'tierHaiku', sonnet: 'tierSonnet', opus: 'tierOpus', fast: 'tierFast', main: 'tierMain', max: 'tierMax' };
let ROUTING_MODE = 'tiers';
let MAP_ROWS = [];

async function refreshModels() {
  await collectModelOptions();
  let routing = {};
  try { routing = (await getConfig()).routing || {}; } catch (e) { /* defaults */ }
  const tiers = routing.tiers || {};
  for (const [k, id] of Object.entries(TIER_SELECTS)) populateModelSelect($(id), tiers[k] || '', '— не вказано —');
  populateModelSelect($('applyAllTiersSelect'), '', '— обери модель —');
  populateModelSelect($('defaultModel'), routing.defaultModel || '', '— не вказано —');
  $('unmappedStrategySelect').value = routing.unmappedStrategy || 'smart';
  setRoutingMode(routing.mode === 'table' ? 'table' : 'tiers');

  const mm = routing.modelMap || {};
  const officialIds = new Set(OFFICIAL_MODELS.map((m) => m.id));
  renderOfficialList(mm);
  MAP_ROWS = Object.keys(mm).filter((k) => routing.mode === 'table' || !officialIds.has(k)).map((k) => ({ from: k, to: mm[k] }));
  if (routing.mode === 'table') MAP_ROWS = Object.keys(mm).map((k) => ({ from: k, to: mm[k] }));
  renderMapTable();
  refreshRoutingStrategy();
}

function setRoutingMode(mode) {
  ROUTING_MODE = mode;
  document.querySelectorAll('#routingMode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('mode-tiers').style.display = mode === 'tiers' ? '' : 'none';
  $('mode-table').style.display = mode === 'table' ? '' : 'none';
}
document.querySelectorAll('#routingMode button').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.mode === 'table' && !MAP_ROWS.length) {
      // Start the table from what the tiers currently do.
      MAP_ROWS = [
        { from: 'claude-*haiku*', to: cleanModelName($('tierHaiku').value) },
        { from: 'claude-*sonnet*', to: cleanModelName($('tierSonnet').value) },
        { from: 'claude-*opus*', to: cleanModelName($('tierOpus').value) },
      ].filter((r) => r.to);
      renderMapTable();
    }
    setRoutingMode(b.dataset.mode);
    msg($('tiers-msg'), 'Натисни «Зберегти», щоб застосувати режим', true);
  });
});

function renderOfficialList(mm) {
  const box = $('official-list');
  box.innerHTML = '';
  for (const m of OFFICIAL_MODELS) {
    const row = document.createElement('div');
    row.className = 'alias-item';
    row.innerHTML = '<span class="alias-id">' + esc(m.label) + '</span>' +
      '<span class="mono small muted">' + esc(m.id) + '</span>' +
      '<span class="alias-arrow">→</span>' +
      '<select data-official="' + esc(m.id) + '" style="margin-left:auto"></select>';
    populateModelSelect(row.querySelector('select'), mm[m.id] || '', '— за рівнем —');
    box.appendChild(row);
  }
}

function renderMapTable() {
  const box = $('mapTable');
  if (!MAP_ROWS.length) {
    box.innerHTML = '<div class="empty">Рядків ще немає. Натисни «Додати рядок».</div>';
    return;
  }
  box.innerHTML = '';
  MAP_ROWS.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'map-row';
    row.innerHTML = '<input class="mono" placeholder="назва від програми, напр. gpt-4o або claude-*" value="' + esc(r.from) + '">' +
      '<span class="alias-arrow">→</span><select></select>' +
      '<button class="btn btn-mini btn-danger" title="Видалити рядок">✕</button>';
    const [inp, sel, del] = [row.querySelector('input'), row.querySelector('select'), row.querySelector('button')];
    populateModelSelect(sel, r.to, '— обери модель —');
    inp.addEventListener('input', () => { MAP_ROWS[i].from = inp.value.trim(); });
    sel.addEventListener('change', () => { MAP_ROWS[i].to = cleanModelName(sel.value); });
    del.addEventListener('click', () => { MAP_ROWS.splice(i, 1); renderMapTable(); });
    box.appendChild(row);
  });
}
$('mapAdd').addEventListener('click', () => { MAP_ROWS.push({ from: '', to: '' }); renderMapTable(); });

$('btnSaveTiers').addEventListener('click', async () => {
  const bad = ROUTING_MODE === 'table' && MAP_ROWS.find((r) => (r.from && !r.to) || (!r.from && r.to));
  if (bad) { msg($('tiers-msg'), 'Заповни обидві колонки в кожному рядку (або видали порожній рядок)', false); return; }
  try {
    await saveConfig((cfg) => {
      const r = cfg.routing = cfg.routing || {};
      r.mode = ROUTING_MODE;
      r.unmappedStrategy = $('unmappedStrategySelect').value;
      r.defaultModel = cleanModelName($('defaultModel').value);
      r.defaultProviderId = '';
      r.tiers = r.tiers || {};
      for (const [k, id] of Object.entries(TIER_SELECTS)) r.tiers[k] = cleanModelName($(id).value);
      const mm = {};
      if (ROUTING_MODE === 'table') {
        MAP_ROWS.forEach((row) => { if (row.from && row.to) mm[row.from] = row.to; });
      } else {
        document.querySelectorAll('[data-official]').forEach((s) => {
          const v = cleanModelName(s.value);
          if (v) mm[s.dataset.official] = v;
        });
      }
      r.modelMap = mm;
    });
    msg($('tiers-msg'), 'Збережено — діє одразу ✓', true);
    toast('Правила моделей збережено ✓');
  } catch (e) {
    msg($('tiers-msg'), 'Не збережено: ' + e.message, false);
  }
});

$('btnApplyAllTiers').addEventListener('click', async () => {
  const v = cleanModelName($('applyAllTiersSelect').value);
  if (!v) { toast('Спочатку обери модель зі списку', true); return; }
  if (!confirmDo('Призначити ' + v + ' для всіх рівнів і як модель за замовчуванням?')) return;
  if (await applyModelEverywhere(v, $('tiers-msg'))) refreshModels();
});

$('btnResetAllOfficial').addEventListener('click', () => {
  if (!confirmDo('Скинути всі точкові підміни офіційних імен? (Збережеться після «Зберегти».)')) return;
  document.querySelectorAll('[data-official]').forEach((s) => { s.value = ''; });
  msg($('tiers-msg'), 'Скинуто — натисни «Зберегти»', true);
});

// ---------- routing strategy (round-robin vs fill-first) ----------
async function refreshRoutingStrategy() {
  try {
    const res = await mgmt('GET', 'routing/strategy');
    const strat = (res && res.strategy) || 'round-robin';
    $('strat-fill-first').checked = (strat === 'fill-first');
    $('strat-round-robin').checked = (strat !== 'fill-first');
  } catch (e) { /* engine offline */ }
}

async function setRoutingStrategy(strategy) {
  try {
    await mgmt('PUT', 'routing/strategy', { value: strategy });
    msg($('strat-msg'), 'Збережено: ' + (strategy === 'fill-first' ? 'спочатку перший акаунт' : 'по черзі'), true);
  } catch (e) {
    msg($('strat-msg'), 'Не збережено: ' + e.message, false);
    refreshRoutingStrategy();
  }
}
$('strat-round-robin').addEventListener('change', () => setRoutingStrategy('round-robin'));
$('strat-fill-first').addEventListener('change', () => setRoutingStrategy('fill-first'));

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
  await renderProvList();
  renderPresetGrid();
  await renderNativeList();
  await renderVgProviders();
}

// Account-provider entries (OAuth accounts mirrored from the Акаунти page).
async function renderVgProviders() {
  const el = $('vg-prov-list');
  let items = [];
  try { items = ((await getConfig()).providers || []); } catch (e) { /* ignore */ }
  if (!items.length) {
    el.innerHTML = '<div class="empty">Поки порожньо. Увійди в акаунт на сторінці «Акаунти» — він з\'явиться тут сам.</div>';
    return;
  }
  el.innerHTML = items.map((p) => {
    const isAccount = String(p.baseUrl || '').indexOf('embedded://') === 0;
    const models = (p.models || []).slice(0, 4).join(', ');
    const more = (p.models || []).length > 4 ? ' +ще ' + (p.models.length - 4) : '';
    const off = p.enabled === false;
    return '<div class="prov-card' + (off ? ' off' : '') + '">' +
      '<div class="prov-avatar">' + esc((p.label || p.id || '?').trim().charAt(0).toUpperCase()) + '</div>' +
      '<div class="prov-info">' +
      '<div class="prov-name">' + esc(p.label || p.id) +
      (isAccount ? ' <span class="badge account">АКАУНТ</span>' : ' <span class="badge openai">OPENAI</span>') +
      (off ? ' <span class="chip">вимк.</span>' : '') + '</div>' +
      '<div class="prov-url mono">' + esc(isAccount ? 'вбудований рушій (OAuth)' : (p.baseUrl || '')) + '</div>' +
      '<div class="prov-meta"><span><b>' + (p.models || []).length + '</b> моделей</span>' +
      '<span class="mono">' + esc(models) + esc(more) + '</span></div>' +
      '</div>' +
      '<div class="prov-actions">' +
      '<button class="btn btn-mini ' + (off ? 'btn-accent' : 'btn-warn') + '" data-toggle-vg="' + esc(p.id) + '">' + (off ? '▶ Увімкнути' : '⏸ Вимкнути') + '</button>' +
      '<button class="btn btn-mini btn-danger" data-del="' + esc(p.id) + '" data-account="' + (isAccount ? '1' : '') + '">Прибрати</button>' +
      '</div></div>';
  }).join('');
  el.querySelectorAll('[data-toggle-vg]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await saveConfig((cfg) => {
          const p = (cfg.providers || []).find((x) => x.id === b.dataset.toggleVg);
          if (!p) return false;
          p.enabled = p.enabled === false;
        });
        renderVgProviders();
      } catch (e) { toast('Не збережено: ' + e.message, true); }
    });
  });
  el.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirmDo('Прибрати «' + b.dataset.del + '» зі списку? (Сам акаунт залишиться на сторінці «Акаунти».)')) return;
      try {
        if (b.dataset.account) await api('/account-provider/hide', { method: 'POST', body: JSON.stringify({ id: b.dataset.del }) });
        await saveConfig((cfg) => { cfg.providers = (cfg.providers || []).filter((x) => x.id !== b.dataset.del); });
        toast('Прибрано');
        renderVgProviders();
      } catch (e) { toast('Не збережено: ' + e.message, true); }
    });
  });
}

// ---- OpenAI-compatible providers (engine-side, Management API) ----
// The engine returns {"openai-compatibility": [...]} and PUT *replaces* the
// whole list, so every mutation goes through fetchCompatList() first.
let COMPAT_LIST = [];
let PROV_EDITING = null; // name of the provider being edited, or null

async function fetchCompatList() {
  const res = await mgmt('GET', 'openai-compatibility');
  let arr = [];
  if (Array.isArray(res)) arr = res;
  else if (res && Array.isArray(res['openai-compatibility'])) arr = res['openai-compatibility'];
  else if (res && Array.isArray(res.items)) arr = res.items;
  COMPAT_LIST = arr;
  return arr;
}

// Strip the read-only auth-index fields the GET adds so the PUT body is a
// clean []config.OpenAICompatibility.
function compatForWrite(p) {
  const out = {};
  for (const k of Object.keys(p)) {
    if (k === 'auth-index') continue;
    out[k] = p[k];
  }
  if (Array.isArray(out['api-key-entries'])) {
    out['api-key-entries'] = out['api-key-entries'].map((e) => {
      const c = {};
      for (const k of Object.keys(e)) { if (k !== 'auth-index') c[k] = e[k]; }
      return c;
    });
  }
  return out;
}

function maskSecret(k) {
  k = String(k || '');
  return k.length > 10 ? k.slice(0, 5) + '…' + k.slice(-4) : (k ? '•••' : '');
}

async function renderProvList() {
  const el = $('prov-list');
  let items = [];
  try {
    items = await fetchCompatList();
  } catch (e) {
    el.innerHTML = '<div class="empty">Рушій недоступний: ' + esc(e.message) + '</div>';
    return;
  }
  if (!items.length) {
    el.innerHTML = '<div class="empty">Немає OpenAI-сумісних провайдерів. Обери пресет нижче — це 30 секунд.</div>';
    return;
  }
  el.innerHTML = items.map((p) => {
    const models = (p.models || []).map((m) => m.alias || m.name);
    const shown = models.slice(0, 5).join(', ') + (models.length > 5 ? ' +ще ' + (models.length - 5) : '');
    const keys = (p['api-key-entries'] || []).length;
    const off = !!p.disabled;
    const preset = presetByUrl(p['base-url']);
    return '<div class="prov-card' + (off ? ' off' : '') + '">' +
      '<div class="prov-avatar">' + esc((p.name || '?').trim().charAt(0).toUpperCase()) + '</div>' +
      '<div class="prov-info">' +
      '<div class="prov-name">' + esc(p.name) +
      (preset ? ' <span class="badge preset">' + esc(preset.label) + '</span>' : ' <span class="badge openai">OPENAI</span>') +
      (p.prefix ? ' <span class="chip">prefix: ' + esc(p.prefix) + '</span>' : '') +
      (off ? ' <span class="chip err">вимкнено</span>' : ' <span class="chip ok">активний</span>') + '</div>' +
      '<div class="prov-url mono">' + esc(p['base-url'] || '') + '</div>' +
      '<div class="prov-meta"><span><b>' + models.length + '</b> моделей</span><span><b>' + keys + '</b> ключ(ів)</span>' +
      '<span class="mono">' + esc(shown) + '</span></div>' +
      '</div>' +
      '<div class="prov-actions">' +
      '<button class="btn btn-mini" data-edit="' + esc(p.name) + '">✎ Редагувати</button>' +
      '<button class="btn btn-mini ' + (off ? 'btn-accent' : 'btn-warn') + '" data-toggle="' + esc(p.name) + '" data-off="' + (off ? '1' : '0') + '">' + (off ? '▶ Увімкнути' : '⏸ Вимкнути') + '</button>' +
      '<button class="btn btn-mini btn-danger" data-name="' + esc(p.name) + '">🗑</button>' +
      '</div></div>';
  }).join('');
  el.querySelectorAll('[data-name]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!window.confirm('Видалити провайдера ' + b.dataset.name + '?')) return;
      try {
        await mgmt('DELETE', 'openai-compatibility?name=' + encodeURIComponent(b.dataset.name));
        toast('Провайдера видалено');
        if (PROV_EDITING === b.dataset.name) resetProvForm();
        renderProvList();
        collectModelOptions();
      } catch (e) { toast('Помилка: ' + e.message, true); }
    });
  });
  el.querySelectorAll('[data-toggle]').forEach((b) => {
    b.addEventListener('click', async () => {
      const off = b.dataset.off === '1';
      try {
        await mgmt('PATCH', 'openai-compatibility', { name: b.dataset.toggle, value: { disabled: !off } });
        toast(off ? 'Провайдера увімкнено ✓' : 'Провайдера вимкнено');
        renderProvList();
      } catch (e) { toast('Помилка: ' + e.message, true); }
    });
  });
  el.querySelectorAll('[data-edit]').forEach((b) => {
    b.addEventListener('click', () => {
      const p = COMPAT_LIST.find((x) => x.name === b.dataset.edit);
      if (p) startEditProvider(p);
    });
  });
}

function presetByUrl(url) {
  url = String(url || '').replace(/\/+$/, '').toLowerCase();
  if (!url) return null;
  return (window.PROVIDER_PRESETS || []).find((p) => p.id !== 'custom' && p.url.replace(/\/+$/, '').toLowerCase() === url) || null;
}

// ---- presets ----
let PRESET_GROUP = 'all';

function renderPresetGroups() {
  const box = $('preset-groups');
  if (!box) return;
  const groups = Object.assign({ all: 'Усі' }, window.PRESET_GROUPS || {});
  box.innerHTML = Object.keys(groups).map((g) =>
    '<button data-g="' + esc(g) + '" class="' + (g === PRESET_GROUP ? 'active' : '') + '">' + esc(groups[g]) + '</button>').join('');
  box.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => { PRESET_GROUP = b.dataset.g; renderPresetGroups(); renderPresetGrid(); });
  });
}

function renderPresetGrid() {
  const grid = $('preset-grid');
  if (!grid) return;
  const q = ($('preset-search').value || '').toLowerCase().trim();
  const list = (window.PROVIDER_PRESETS || []).filter((p) =>
    (PRESET_GROUP === 'all' || p.group === PRESET_GROUP) &&
    (!q || p.label.toLowerCase().includes(q) || p.id.includes(q) || p.url.toLowerCase().includes(q) || (p.models || []).some((m) => m.toLowerCase().includes(q))));
  if (!list.length) {
    grid.innerHTML = '<span class="muted small" style="padding:6px">Нічого не знайдено — заповни поля вручну.</span>';
    return;
  }
  const existing = new Set(COMPAT_LIST.map((p) => String(p['base-url'] || '').replace(/\/+$/, '').toLowerCase()));
  grid.innerHTML = list.map((p) => {
    const have = existing.has(p.url.replace(/\/+$/, '').toLowerCase());
    return '<button class="preset-card' + (have ? ' have' : '') + '" data-preset="' + esc(p.id) + '" title="' + esc(p.url) + '">' +
      '<span class="preset-avatar g-' + esc(p.group) + '">' + esc(p.label.charAt(0).toUpperCase()) + '</span>' +
      '<span class="preset-body"><span class="preset-label">' + esc(p.label) + '</span>' +
      '<span class="preset-url">' + esc(p.url.replace(/^https?:\/\//, '')) + '</span></span>' +
      (have ? '<span class="preset-have">✓</span>' : '') +
      '</button>';
  }).join('');
  grid.querySelectorAll('[data-preset]').forEach((b) => {
    b.addEventListener('click', () => applyPreset(b.dataset.preset));
  });
}

function applyPreset(id) {
  const p = (window.PROVIDER_PRESETS || []).find((x) => x.id === id);
  if (!p) return;
  if (PROV_EDITING) resetProvForm();
  // A unique name if the preset was already added once.
  let name = p.id === 'custom' ? '' : p.id;
  if (name && COMPAT_LIST.some((x) => x.name === name)) {
    let n = 2;
    while (COMPAT_LIST.some((x) => x.name === name + '-' + n)) n++;
    name = name + '-' + n;
  }
  $('prov-name').value = name;
  $('prov-url').value = p.url;
  $('prov-models').value = (p.models || []).join(String.fromCharCode(10));
  $('prov-prefix').value = '';
  $('prov-headers').value = '';
  $('prov-key').value = '';
  const hint = $('preset-hint');
  let html = '<b>' + esc(p.label) + '</b>';
  if (p.hint) html += ' — ' + esc(p.hint);
  if (p.keyUrl) html += ' <a href="' + esc(p.keyUrl) + '" target="_blank" rel="noopener">Отримати ключ ↗</a>';
  if (/<[A-Z_]+>/.test(p.url)) html += '<br><span class="warn">⚠ Заміни плейсхолдер у Base URL на своє значення.</span>';
  hint.innerHTML = html;
  hint.style.display = '';
  $('prov-key').focus();
  $('prov-key').scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function parseModelsText(raw) {
  return String(raw || '')
    .split(String.fromCharCode(10))
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=');
      if (i > 0) return { name: l.slice(0, i).trim(), alias: l.slice(i + 1).trim() };
      return { name: l, alias: l };
    });
}

function parseHeadersText(raw) {
  const out = {};
  String(raw || '').split(String.fromCharCode(10)).forEach((l) => {
    const i = l.indexOf(':');
    if (i > 0) {
      const k = l.slice(0, i).trim();
      const v = l.slice(i + 1).trim();
      if (k) out[k] = v;
    }
  });
  return out;
}

function parseKeysText(raw) {
  return String(raw || '').split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean);
}

function readProvForm() {
  const name = $('prov-name').value.trim();
  const baseUrl = $('prov-url').value.trim().replace(/\/+$/, '');
  const keys = parseKeysText($('prov-key').value);
  return {
    name: name,
    baseUrl: baseUrl,
    keys: keys,
    prefix: $('prov-prefix').value.trim(),
    models: parseModelsText($('prov-models').value),
    headers: parseHeadersText($('prov-headers').value),
  };
}

function validateProvForm(f) {
  if (!f.name) return 'вкажи назву';
  if (!/^[A-Za-z0-9._-]+$/.test(f.name)) return 'назва: лише латиниця, цифри, . _ -';
  if (!/^https?:\/\//.test(f.baseUrl)) return 'Base URL має починатись з http:// або https://';
  if (/<[A-Z_]+>/.test(f.baseUrl)) return 'заміни плейсхолдер <…> у Base URL';
  if (!f.keys.length) return 'потрібен хоча б один API ключ (для локальних серверів — будь-який, напр. local)';
  if (!f.models.length) return 'додай хоча б одну модель або натисни «Підтягнути список моделей»';
  return '';
}

function toCompatEntry(f, prev) {
  const entry = prev ? compatForWrite(prev) : {};
  entry.name = f.name;
  entry['base-url'] = f.baseUrl;
  entry['api-key-entries'] = f.keys.map((k) => {
    const old = prev && (prev['api-key-entries'] || []).find((e) => e['api-key'] === k);
    const e = { 'api-key': k };
    if (old && old['proxy-url']) e['proxy-url'] = old['proxy-url'];
    if (old && old.weight != null) e.weight = old.weight;
    return e;
  });
  entry.models = f.models;
  if (f.prefix) entry.prefix = f.prefix; else delete entry.prefix;
  if (Object.keys(f.headers).length) entry.headers = f.headers; else delete entry.headers;
  return entry;
}

async function saveProvider() {
  const f = readProvForm();
  const bad = validateProvForm(f);
  if (bad) { msg($('prov-msg'), bad, false); return; }
  const btn = $('prov-add');
  btn.disabled = true;
  try {
    const list = await fetchCompatList();
    if (PROV_EDITING) {
      const prev = list.find((x) => x.name === PROV_EDITING);
      if (!prev) throw new Error('провайдера ' + PROV_EDITING + ' більше немає');
      if (f.name !== PROV_EDITING && list.some((x) => x.name === f.name)) throw new Error('назва ' + f.name + ' вже зайнята');
      const value = toCompatEntry(f, prev);
      await mgmt('PATCH', 'openai-compatibility', { name: PROV_EDITING, value: {
        name: value.name, 'base-url': value['base-url'], 'api-key-entries': value['api-key-entries'],
        models: value.models, prefix: f.prefix, headers: f.headers,
      } });
      msg($('prov-msg'), 'зміни збережено ✓', true);
      toast('Провайдера ' + f.name + ' оновлено ✓');
    } else {
      if (list.some((x) => x.name === f.name)) throw new Error('назва ' + f.name + ' вже зайнята — обери іншу або відредагуй наявного');
      const next = list.map(compatForWrite);
      next.push(toCompatEntry(f, null));
      await mgmt('PUT', 'openai-compatibility', next);
      msg($('prov-msg'), 'провайдера додано ✓', true);
      toast('Провайдера ' + f.name + ' додано ✓ (' + f.models.length + ' моделей)');
    }
    resetProvForm();
    await renderProvList();
    renderPresetGrid();
    collectModelOptions();
  } catch (e) {
    msg($('prov-msg'), 'не вдалось: ' + e.message, false);
  } finally {
    btn.disabled = false;
  }
}

function startEditProvider(p) {
  PROV_EDITING = p.name;
  $('prov-form-title').textContent = 'Редагувати провайдера: ' + p.name;
  $('prov-form-hint').textContent = 'зміни підхопляться рушієм одразу';
  $('prov-name').value = p.name || '';
  $('prov-url').value = p['base-url'] || '';
  $('prov-key').value = (p['api-key-entries'] || []).map((e) => e['api-key'] || '').filter(Boolean).join(String.fromCharCode(10));
  $('prov-prefix').value = p.prefix || '';
  $('prov-models').value = (p.models || []).map((m) => (m.alias && m.alias !== m.name) ? m.name + '=' + m.alias : m.name).join(String.fromCharCode(10));
  $('prov-headers').value = Object.entries(p.headers || {}).map(([k, v]) => k + ': ' + v).join(String.fromCharCode(10));
  $('prov-add').textContent = 'Зберегти зміни';
  $('prov-cancel').style.display = '';
  const preset = presetByUrl(p['base-url']);
  const hint = $('preset-hint');
  if (preset && preset.keyUrl) {
    hint.innerHTML = '<b>' + esc(preset.label) + '</b> <a href="' + esc(preset.keyUrl) + '" target="_blank" rel="noopener">Ключі ↗</a>';
    hint.style.display = '';
  } else {
    hint.style.display = 'none';
  }
  $('prov-form-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function resetProvForm() {
  PROV_EDITING = null;
  $('prov-form-title').textContent = 'Додати провайдера';
  $('prov-form-hint').textContent = 'обери пресет або заповни поля вручну';
  ['prov-name', 'prov-url', 'prov-key', 'prov-prefix', 'prov-models', 'prov-headers'].forEach((id) => { $(id).value = ''; });
  $('prov-add').textContent = 'Додати провайдера';
  $('prov-cancel').style.display = 'none';
  $('preset-hint').style.display = 'none';
  $('prov-fetch-msg').textContent = '';
}

async function fetchProviderModels() {
  const f = readProvForm();
  const out = $('prov-fetch-msg');
  if (!/^https?:\/\//.test(f.baseUrl)) { msg(out, 'спочатку вкажи Base URL', false); return; }
  const btn = $('prov-fetch-models');
  btn.disabled = true;
  out.textContent = 'запитую ' + f.baseUrl + '/models …';
  out.className = 'msg';
  try {
    const r = await api('/provider-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: f.baseUrl, apiKey: f.keys[0] || '', headers: f.headers }),
    });
    const models = r.models || [];
    if (!models.length) { msg(out, 'провайдер повернув порожній список', false); return; }
    // Keep aliases the user already typed.
    const existing = parseModelsText($('prov-models').value);
    const aliasByName = {};
    existing.forEach((m) => { if (m.alias && m.alias !== m.name) aliasByName[m.name] = m.alias; });
    $('prov-models').value = models.map((m) => aliasByName[m] ? m + '=' + aliasByName[m] : m).join(String.fromCharCode(10));
    msg(out, 'отримано ' + models.length + ' моделей ✓ (можна видалити зайві)', true);
  } catch (e) {
    msg(out, 'не вдалось: ' + e.message, false);
  } finally {
    btn.disabled = false;
  }
}

$('prov-add').addEventListener('click', saveProvider);
$('prov-cancel').addEventListener('click', resetProvForm);
$('prov-refresh').addEventListener('click', () => { renderProvList().then(renderPresetGrid); });
$('prov-fetch-models').addEventListener('click', fetchProviderModels);
$('preset-search').addEventListener('input', renderPresetGrid);
renderPresetGroups();
renderPresetGrid();

// ---------- accounts: OAuth login ----------
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
  if ($('statusHeadline') && $('statusHeadline').textContent.trim() === 'Зупинено') {
    st.textContent = 'Рушій зупинено! Спочатку натисніть кнопку "Запустити" на панелі вгорі.';
    st.className = 'msg err';
    return;
  }
  st.textContent = 'Запускаю вхід ' + provider + '…';
  st.className = 'msg';
  try {
    const r = await fetch('/api/cliproxy/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: provider }),
    });
    const text = await r.text();
    let j = null;
    try {
      j = text ? JSON.parse(text) : null;
    } catch (parseErr) { /* non-json response */ }
    if (!r.ok || !j || !j.url) {
      st.textContent = (j && (j.error || j.message)) || text || ('Не вдалось (' + r.status + ')');
      st.className = 'msg err';
      return;
    }
    st.innerHTML = '<a href="' + esc(j.url) + '" target="_blank" style="color:var(--accent-2)">Відкрити сторінку входу ↗</a>';
    if (j.state) pollOauth(j.state);
  } catch (e) {
    st.textContent = 'Помилка: ' + e.message;
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
      const text = await r.text();
      let j = null;
      try { j = text ? JSON.parse(text) : null; } catch (e) {}
      if (!j) return;
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

// ---- native API keys (claude-api-key, gemini-api-key, …) ----
// GET returns {"<kind>": [...]}; PUT replaces the WHOLE list with a bare
// array — so always GET → modify → PUT.
async function fetchNativeKeys(kind) {
  const res = await mgmt('GET', kind);
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res[kind])) return res[kind];
  if (res && Array.isArray(res.items)) return res.items;
  return [];
}

function nativeForWrite(e) {
  const out = {};
  for (const k of Object.keys(e)) { if (k !== 'auth-index') out[k] = e[k]; }
  return out;
}

async function renderNativeList() {
  const el = $('native-list');
  el.textContent = '…';
  try {
    const arr = await fetchNativeKeys(nativeTab);
    if (!arr.length) {
      el.innerHTML = '<span class="muted">' + esc(nativeLabels[nativeTab]) + ': ключів ще немає</span>';
      return;
    }
    el.innerHTML = arr.map((k, i) => {
      const key = k['api-key'] || '';
      const masked = key.length > 8 ? key.slice(0, 6) + '…' + key.slice(-4) : '•••';
      return '<div class="key-item"><span class="mono small">' + esc(masked) +
        '</span><span class="small muted mono">' + esc(k['base-url'] || '') +
        '</span><span class="del" data-idx="' + i + '" title="Видалити ключ">✕</span></div>';
    }).join('');
    el.querySelectorAll('.del').forEach((d) => {
      d.addEventListener('click', async () => {
        if (!confirmDo('Видалити цей ' + nativeLabels[nativeTab] + ' ключ?')) return;
        try {
          const cur = await fetchNativeKeys(nativeTab);
          const target = arr[Number(d.dataset.idx)];
          const next = cur.filter((e) => e['api-key'] !== target['api-key']).map(nativeForWrite);
          if (next.length) await mgmt('PUT', nativeTab, next);
          else await mgmt('DELETE', nativeTab + '?api-key=' + encodeURIComponent(target['api-key']));
          toast('Ключ видалено');
          renderNativeList();
        } catch (e) { toast('Не вдалось: ' + e.message, true); }
      });
    });
  } catch (e) {
    el.innerHTML = '<span class="muted">недоступно: ' + esc(e.message) + '</span>';
  }
}

async function addNativeKey() {
  const key = $('native-key').value.trim();
  const url = $('native-url').value.trim();
  if (!key) { msg($('native-msg'), 'введи ключ', false); return; }
  const entry = { 'api-key': key };
  if (url) entry['base-url'] = url;
  try {
    const cur = await fetchNativeKeys(nativeTab);
    if (cur.some((e) => e['api-key'] === key)) { msg($('native-msg'), 'такий ключ уже є', false); return; }
    await mgmt('PUT', nativeTab, cur.map(nativeForWrite).concat([entry]));
    $('native-key').value = '';
    $('native-url').value = '';
    msg($('native-msg'), nativeLabels[nativeTab] + ' ключ додано ✓', true);
    renderNativeList();
    collectModelOptions();
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

// ---------- accounts page ----------
async function refreshCliproxy() {
  try { await loadStatus(); } catch (e) { /* keep old */ }
  await renderAuthFiles();
}

let accountSyncBusy = false;

async function renderAuthFiles() {
  const el = $('auth-files');
  let arr = [];
  try {
    const resp = await mgmt('GET', 'auth-files');
    arr = Array.isArray(resp) ? resp : ((resp && resp.files) || []);
  } catch (e) {
    el.innerHTML = '<div class="empty">Недоступно: ' + esc(e.message) + '</div>';
    return;
  }
  AUTH_FILES = arr;
  if (!arr.length) {
    el.innerHTML = '<div class="empty">Акаунтів ще немає — натисни кнопку входу вище. Найпростіше почати з <b>Gemini-Antigravity</b> (безкоштовно, звичайний Google-акаунт).</div>';
    return;
  }
  el.innerHTML = arr.map((f) => {
    const name = f.email || f.account || f.label || f.name || f.filename || f.id || '';
    const fileKey = f.name || f.filename || f.id || '';
    const provider = (f.provider || f.type || '').toLowerCase();
    const ok = accountOk(f);
    const status = f.disabled ? 'вимкнено' : (ok ? 'активний' : (f.cooldowns && f.cooldowns.length ? 'ліміт' : (f.status || '—')));
    const authIndex = f.auth_index || '';
    return '<div class="auth-file-item">' +
      '<span class="st ' + (ok ? 'ok' : 'bad') + '"></span>' +
      '<span class="af-name"><b>' + esc(f.provider || f.type || 'account') + '</b> · ' + esc(name) + '</span>' +
      '<span class="chip ' + (ok ? '' : 'err') + '">' + esc(status) + '</span>' +
      '<div class="af-actions">' +
      (authIndex && !ok ? '<button class="btn btn-mini btn-ghost" data-reset-quota="' + esc(authIndex) + '" data-name="' + esc(name) + '" title="Зняти блокування після ліміту (429)">⚡ Скинути ліміт</button>' : '') +
      (provider ? '<button class="btn btn-mini btn-warn" data-reauth="' + esc(provider) + '" data-name="' + esc(name) + '" title="Увійти в цей акаунт заново">↻ Увійти знову</button>' : '') +
      '<button class="btn btn-mini btn-danger" data-delete-account="' + esc(fileKey) + '" data-name="' + esc(name) + '" title="Видалити акаунт">🗑</button>' +
      '</div></div>';
  }).join('');

  // New OK accounts become providers automatically (the backend skips ids the
  // user removed and never re-enables disabled ones).
  if (!accountSyncBusy) {
    accountSyncBusy = true;
    (async () => {
      let added = false;
      for (const f of arr) {
        const fileKey = f.name || f.filename || f.id || '';
        if (!fileKey || !accountOk(f)) continue;
        try {
          const r = await api('/account-to-provider', { method: 'POST', body: JSON.stringify({ name: fileKey, auto: true }) });
          if (r && !r.skipped) added = true;
        } catch (e) { /* non-fatal */ }
      }
      if (added) collectModelOptions();
    })().finally(() => { accountSyncBusy = false; });
  }

  el.querySelectorAll('[data-reset-quota]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await mgmt('POST', 'reset-quota', { auth_index: b.dataset.resetQuota });
        toast('Ліміт для ' + b.dataset.name + ' скинуто ✓');
        renderAuthFiles();
      } catch (e) {
        toast('Не вдалось: ' + e.message, true);
        b.disabled = false;
      }
    });
  });
  el.querySelectorAll('[data-reauth]').forEach((b) => {
    b.addEventListener('click', () => {
      toast('Вхід для ' + b.dataset.name + '…');
      startOauth(b.dataset.reauth);
    });
  });
  el.querySelectorAll('[data-delete-account]').forEach((b) => {
    b.addEventListener('click', async () => {
      const fileId = b.dataset.deleteAccount;
      const nm = b.dataset.name;
      if (!fileId) { toast('Не знайдено файл акаунта', true); return; }
      if (!confirmDo('Видалити акаунт ' + (nm || fileId) + '? Щоб повернути, доведеться увійти знову.')) return;
      b.disabled = true;
      try {
        await mgmt('DELETE', 'auth-files?name=' + encodeURIComponent(fileId));
        const base = String(fileId).replace(/\.json$/, '');
        const fam = base.indexOf('-') > 0 ? base.slice(0, base.indexOf('-')) : base;
        const short = (base.indexOf('-') > 0 ? base.slice(base.indexOf('-') + 1) : base).replace(/[^a-zA-Z0-9]/g, '-').slice(0, 24).replace(/^-+|-+$/g, '').toLowerCase();
        const pid = 'cp-' + fam + '-' + short;
        await saveConfig((cfg) => {
          const before = (cfg.providers || []).length;
          cfg.providers = (cfg.providers || []).filter((p) => p.id !== pid);
          if (cfg.providers.length === before) return false;
        }).catch(() => {});
        toast('Акаунт ' + nm + ' видалено ✓');
        await renderAuthFiles();
        collectModelOptions();
      } catch (e) {
        toast('Не вдалось видалити: ' + e.message, true);
        b.disabled = false;
      }
    });
  });
}
$('auth-refresh').addEventListener('click', renderAuthFiles);

// Extra client keys (engine api-keys), under Налаштування → Розширені.
async function renderClipKeys() {
  const el = $('clip-keys');
  const st = LAST_STATUS || {};
  if (st.requireKey === false) {
    el.innerHTML = '<span class="muted">Перевірку ключа вимкнено — шлюз приймає будь-який ключ. Увімкни «Вимагати API ключ», щоб керувати ключами.</span>';
    $('clip-key-add').disabled = true;
    return;
  }
  $('clip-key-add').disabled = false;
  try {
    const keys = await mgmt('GET', 'api-keys');
    const list = Array.isArray(keys) ? keys : (keys && keys['api-keys']) || [];
    const main = (LAST_EP && LAST_EP.key) || '';
    el.innerHTML = list.length
      ? list.map((k) => '<div class="key-item"><span class="mono small">' + esc(maskSecret(k)) + '</span>' +
        (k === main ? '<span class="chip">основний</span>' : '<span class="del" data-key="' + esc(k) + '" title="Видалити">✕</span>') + '</div>').join('')
      : '<span class="muted">ключів немає</span>';
    el.querySelectorAll('.del').forEach((d) => {
      d.addEventListener('click', async () => {
        if (!confirmDo('Видалити цей ключ? Програми з ним перестануть підключатись.')) return;
        try {
          const cur = await mgmt('GET', 'api-keys');
          const l = Array.isArray(cur) ? cur : (cur && cur['api-keys']) || [];
          await mgmt('PUT', 'api-keys', l.filter((x) => x !== d.dataset.key));
          renderClipKeys();
        } catch (e) { toast('Не вдалось: ' + e.message, true); }
      });
    });
  } catch (e) {
    el.innerHTML = '<span class="muted">недоступно: ' + esc(e.message) + '</span>';
  }
}

async function addClipKey() {
  const k = $('clip-new-key').value.trim();
  if (!k) { msg($('clip-msg'), 'введи ключ', false); return; }
  try {
    const cur = await mgmt('GET', 'api-keys');
    const list = Array.isArray(cur) ? cur : (cur && cur['api-keys']) || [];
    if (!list.includes(k)) list.push(k);
    await mgmt('PUT', 'api-keys', list);
    $('clip-new-key').value = '';
    msg($('clip-msg'), 'ключ додано ✓', true);
    renderClipKeys();
  } catch (e) {
    msg($('clip-msg'), 'не вдалось: ' + e.message, false);
  }
}
$('clip-key-add').addEventListener('click', addClipKey);

// ---------- metrics page (persistent store on the backend) ----------
async function refreshMetrics() {
  let s = {};
  let authFiles = [];
  try {
    const res = await api('/metrics');
    s = (res && res.metrics) || {};
    if (res && res.auth_files) authFiles = Array.isArray(res.auth_files) ? res.auth_files : (res.auth_files.files || []);
  } catch (e) { return; }

  const totalRequests = Number(s.total_requests || 0);
  const totalSuccess = Number(s.total_success || 0);
  const totalFailed = Number(s.total_failed || 0);
  const successRate = totalRequests > 0 ? Math.round((totalSuccess / totalRequests) * 100) : 100;

  $('metric-total-tokens').textContent = fmtNum(s.total_tokens || 0);
  $('metric-total-reqs').textContent = totalRequests.toLocaleString() + ' запитів';
  $('metric-input-tokens').textContent = fmtNum(s.total_input || 0);
  $('metric-cached-tokens').textContent = fmtNum(s.total_cached || 0) + ' з кешу';
  $('metric-output-tokens').textContent = fmtNum(s.total_output || 0);
  $('metric-reasoning-tokens').textContent = fmtNum(s.total_reasoning || 0) + ' на міркування';
  $('metric-success-rate').textContent = successRate + '%';
  $('metric-success-counts').textContent = totalSuccess + ' успішних / ' + totalFailed + ' помилок';

  renderAccountsQuotaTable(authFiles);
  renderModelsUsageTable(s.model_stats || {});
  renderRecentRequestsTable((s.history || []).slice(0, 50));
}

$('usage-refresh').addEventListener('click', refreshMetrics);
$('btnMetricsClear').addEventListener('click', async () => {
  if (!confirmDo('Скинути всю збережену статистику? Це не можна відмінити.')) return;
  try {
    await api('/metrics/clear', { method: 'POST' });
    await refreshMetrics();
    toast('Статистику очищено ✓');
  } catch (e) {
    toast('Не вдалось: ' + e.message, true);
  }
});

// ---------- settings page ----------
async function refreshSettings() {
  try {
    const cfg = await getConfig();
    $('set-host').value = cfg.cliproxy.host || '127.0.0.1';
    $('set-port').value = cfg.cliproxy.port || 8317;
    $('set-apikey').value = cfg.apiKey || '';
    $('set-require').checked = !!cfg.requireKey;
    $('set-extra').value = cfg.cliproxy.extraConfigYAML || '';
    renderBlacklistTags(cfg.modelBlacklist || []);
  } catch (e) { /* keep old */ }

  try {
    const a = await api('/app/settings');
    $('set-autostart').checked = !!a.autostart;
    $('set-tray').checked = !!a.closeToTray;
    $('set-tray-row').style.display = a.trayAvailable ? '' : 'none';
  } catch (e) { /* keep */ }

  try { await loadStatus(); LAST_EP = await api('/endpoints'); } catch (e) { /* keep */ }
  renderClipKeys();
  paintAuthSettings(currentAuthState);
}

async function saveAppSetting(patch) {
  try {
    const a = await api('/app/settings', { method: 'PUT', body: JSON.stringify(patch) });
    $('set-autostart').checked = !!a.autostart;
    $('set-tray').checked = !!a.closeToTray;
    msg($('set-app-msg'), 'Збережено ✓', true);
  } catch (e) {
    msg($('set-app-msg'), 'Не збережено: ' + e.message, false);
    refreshSettings();
  }
}
$('set-autostart').addEventListener('change', () => saveAppSetting({ autostart: $('set-autostart').checked }));
$('set-tray').addEventListener('change', () => saveAppSetting({ closeToTray: $('set-tray').checked }));

$('set-reveal').addEventListener('click', () => {
  const k = $('set-apikey');
  k.type = k.type === 'password' ? 'text' : 'password';
});

$('set-save').addEventListener('click', async () => {
  const port = parseInt($('set-port').value, 10);
  if (!(port >= 1 && port <= 65535)) { msg($('set-msg'), 'Невірний порт', false); return; }
  const host = $('set-host').value.trim() || '127.0.0.1';
  const key = $('set-apikey').value.trim();
  const require = $('set-require').checked;
  if (require && !key) { msg($('set-msg'), 'Ключ не може бути порожнім, коли перевірка увімкнена', false); return; }
  if (!require && host !== '127.0.0.1' && host !== 'localhost' &&
      !confirmDo('Host ' + host + ' відкриває шлюз для інших пристроїв, а перевірку ключа вимкнено. Точно зберегти?')) return;
  try {
    const cur = CFG_CACHE || await getConfig();
    if (cur.apiKey && key !== cur.apiKey && !confirmDo('Змінити API ключ? Старий ключ перестане працювати — його доведеться замінити в усіх програмах.')) return;
    const r = await saveConfig((cfg) => {
      cfg.cliproxy.host = host;
      cfg.cliproxy.port = port;
      cfg.apiKey = key;
      cfg.requireKey = require;
    });
    if (r.needsRestart) {
      msg($('set-msg'), 'Збережено. Порт/Host застосуються після перезапуску', true);
      if (confirmDo('Перезапустити шлюз зараз, щоб застосувати новий порт/Host? Не забудь оновити адресу у своїх програмах.')) serverAction('restart');
    } else {
      msg($('set-msg'), 'Збережено ✓', true);
    }
  } catch (e) {
    msg($('set-msg'), 'Не збережено: ' + e.message, false);
  }
});

$('btnGenKey').addEventListener('click', async () => {
  if (!confirmDo('Згенерувати новий API ключ? Старий одразу перестане працювати — у всіх програмах доведеться вставити новий.')) return;
  try {
    const r = await api('/generate-key', { method: 'POST' });
    $('set-apikey').value = r.key;
    toast('Новий ключ згенеровано ✓ — онови його у своїх програмах');
    refreshSettings();
  } catch (e) { toast('Не вдалось: ' + e.message, true); }
});

$('set-extra-save').addEventListener('click', async () => {
  try {
    await saveConfig((cfg) => { cfg.cliproxy.extraConfigYAML = $('set-extra').value; });
    msg($('set-extra-msg'), 'Збережено ✓ — рушій підхопить зміни сам', true);
  } catch (e) {
    msg($('set-extra-msg'), 'Не збережено: ' + e.message, false);
  }
});

// ---------- copy buttons (data-copy) ----------
document.querySelectorAll('[data-copy]').forEach((b) => {
  b.addEventListener('click', () => {
    const t = $(b.dataset.copy);
    if (t.id === 'apiKey' && LAST_STATUS && LAST_STATUS.requireKey === false) { copyVal('any'); return; }
    copyVal(t.value !== undefined && t.tagName !== 'PRE' ? t.value : t.textContent);
  });
});

// ---------- settings: model blacklist ----------
let ALL_CATALOG_MODELS = [];

async function removeBlacklistModel(modelId) {
  try {
    const r = await saveConfig((cfg) => {
      cfg.modelBlacklist = (cfg.modelBlacklist || []).filter((x) => x.toLowerCase().trim() !== modelId.toLowerCase().trim());
    });
    MODEL_BLACKLIST = (r.cfg.modelBlacklist || []).map((s) => s.toLowerCase().trim());
    renderBlacklistTags(r.cfg.modelBlacklist);
    renderAllModelsCatalog();
    toast(modelId + ' розблоковано ✓');
  } catch (e) {
    toast('Не збережено: ' + e.message, true);
  }
}

async function addBlacklistModel(modelId) {
  const val = (modelId || '').trim();
  if (!val) return;
  try {
    const r = await saveConfig((cfg) => {
      cfg.modelBlacklist = cfg.modelBlacklist || [];
      if (cfg.modelBlacklist.some((x) => x.toLowerCase().trim() === val.toLowerCase())) return false;
      cfg.modelBlacklist.push(val);
    });
    MODEL_BLACKLIST = (r.cfg.modelBlacklist || []).map((s) => s.toLowerCase().trim());
    renderBlacklistTags(r.cfg.modelBlacklist);
    renderAllModelsCatalog();
    toast(val + ' заблоковано');
  } catch (e) {
    toast('Не збережено: ' + e.message, true);
  }
}

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
    const cfg = await getConfig();
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

// ---------- metrics tables ----------
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
if ($('btnMetricsExport')) {
  $('btnMetricsExport').addEventListener('click', async () => {
    try {
      const data = await api('/metrics');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cartelink-metrics-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Статистику експортовано в JSON ✓');
    } catch (e) {
      toast('Помилка експорту: ' + e.message, true);
    }
  });
}

// ================= TELEGRAM ACCESS GATE =================
const SVG_TG = '<svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:currentColor;vertical-align:middle;margin-right:6px"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>';
let currentAuthState = null;
let authPollTimer = null;
let authPollDeadline = 0;
let wasAuthed = false;

function renderUserBox(user) {
  const box = $('userBox');
  if (!user) { box.style.display = 'none'; return; }
  const uEl = $('userName');
  if (user.username) {
    const u = user.username.replace(/^@/, '');
    uEl.innerHTML = '<a href="https://t.me/' + esc(u) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent-2);text-decoration:none;font-weight:600">@' + esc(u) + '</a>';
  } else {
    uEl.textContent = user.name || 'Учасник';
  }
  box.style.display = 'flex';
}

function renderGate(state) {
  const s = (state && state.status) || 'loading';
  let html = '';
  if (s === 'loading' || s === 'checking') {
    html = '<div class="gate-spin"></div><h1>Перевіряємо доступ…</h1><p>Підтверджуємо членство у спільноті Secret YT_cartel 🧠</p>';
  } else if (s === 'awaiting') {
    html = '<div class="gate-spin"></div><h1>Заверши вхід у браузері</h1><p>Відкрився браузер — увійди через Telegram і дозволь доступ. Це вікно оновиться саме.</p>'
      + '<button class="gate-btn alt" id="gLogin">Відкрити браузер ще раз</button>'
      + '<button class="gate-btn ghost" id="gCancel">Скасувати</button>';
  } else if (s === 'need_login') {
    const expired = state && state.reason === 'session_expired';
    html = '<h1>' + (expired ? 'Потрібно увійти знову' : 'Вхід для своїх') + '</h1><p>' +
      (expired ? 'Сесія Telegram закінчилась. Увійди ще раз — це займе кілька секунд.' : 'Увійди через Telegram. Доступ мають учасники закритої спільноти <b>Secret YT_cartel 🧠</b>.') + '</p>'
      + '<button class="gate-btn" id="gLogin">' + SVG_TG + '<span>Увійти через Telegram</span></button>'
      + '<div class="gate-note">Відкриється офіційне вікно Telegram. Ми не бачимо твій пароль чи номер — лише підтвердження від Telegram.</div>';
  } else if (s === 'denied') {
    html = '<h1>Доступ обмежено 🔒</h1><p>Твій акаунт Telegram не є учасником закритої групи <b>Secret YT_cartel 🧠</b>. CarteLink доступний лише учасникам групи.</p>'
      + '<a class="gate-btn gold" href="https://t.me/tribute/app?startapp=eUb" target="_blank" rel="noopener" style="text-decoration:none">🚀 <span>Отримати доступ</span></a>'
      + '<button class="gate-btn alt" id="gRecheck">Я вже вступив — перевірити</button>'
      + '<button class="gate-btn alt" id="gLogin">↺ Увійти іншим акаунтом Telegram</button>'
      + '<div class="gate-note">Щойно вступив? Зачекай кілька секунд і натисни «перевірити».</div>';
  } else if (s === 'offline') {
    html = '<h1>Немає зв\'язку з сервером перевірки</h1><p>Не вдається підтвердити доступ (немає інтернету або сервер недоступний). CarteLink спробує знову автоматично.</p>'
      + '<button class="gate-btn" id="gRecheck">Спробувати зараз</button>';
  } else {
    html = '<h1>Помилка перевірки доступу</h1><p>Не вдалося зв\'язатися з застосунком.</p>'
      + '<button class="gate-btn" id="gRecheck">Спробувати ще раз</button>'
      + (state && state.reason ? '<div class="gate-note" style="color:var(--red)">Причина: ' + esc(state.reason) + '</div>' : '');
  }
  $('gateBody').innerHTML = html;
  const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  bind('gLogin', startTelegramLogin);
  bind('gRecheck', recheckAuth);
  bind('gCancel', logoutTelegram);
}

function paintAuthSettings(st) {
  if (!st) return;
  const map = {
    authorized: ['✅ Доступ відкрито', 'var(--green)'],
    checking: ['⏳ Перевіряємо…', 'var(--amber)'],
    awaiting: ['⏳ Очікуємо вхід у браузері', 'var(--amber)'],
    denied: ['🔒 Не учасник групи', 'var(--red)'],
    offline: ['⚠ Немає зв\'язку з сервером перевірки', 'var(--amber)'],
    need_login: ['🔒 Потрібен вхід', 'var(--amber)'],
  };
  const [text, color] = map[st.status] || ['—', 'var(--muted)'];
  $('set-auth-status').textContent = text;
  $('set-auth-status').style.color = color;
  const u = st.user;
  $('set-auth-user').textContent = u ? ((u.name || '') + (u.username ? ' (@' + u.username + ')' : '')) : '—';
  $('set-btn-login').style.display = (st.status === 'need_login' || st.status === 'denied') ? '' : 'none';
  $('set-btn-logout').style.display = st.status === 'authorized' ? '' : 'none';
}

function stopAuthPoll() {
  if (authPollTimer) { clearInterval(authPollTimer); authPollTimer = null; }
}

// While the gate is up (login in the browser, first check, offline) poll the
// backend; every state change is applied — nothing can spin forever.
function startAuthPoll() {
  if (authPollTimer) return;
  authPollDeadline = Date.now() + 6 * 60 * 1000;
  authPollTimer = setInterval(async () => {
    try {
      const st = await api('/auth/status');
      if (st.status === 'awaiting' && Date.now() > authPollDeadline) {
        stopAuthPoll();
        applyAuth({ status: 'need_login', reason: 'timeout' });
        toast('Вхід не завершено за 6 хвилин — спробуй ще раз', true);
        return;
      }
      if (!currentAuthState || st.status !== currentAuthState.status) {
        if (st.status === 'authorized') toast('Доступ відкрито ✨');
        applyAuth(st);
      }
    } catch (e) { /* app restarting */ }
  }, 1500);
}

function applyAuth(state) {
  currentAuthState = state;
  const isAuthed = state.enabled === false || state.status === 'authorized';
  document.body.classList.toggle('authed', !!isAuthed);
  paintAuthSettings(state);
  if (isAuthed) {
    stopAuthPoll();
    renderUserBox(state.user);
    if (!wasAuthed) {
      wasAuthed = true;
      boot();
    }
    return;
  }
  renderUserBox(null);
  renderGate(state);
  if (state.status === 'awaiting' || state.status === 'checking' || state.status === 'offline') startAuthPoll();
  else stopAuthPoll();
}

async function checkAuthGate() {
  try {
    applyAuth(await api('/auth/status'));
  } catch (e) {
    applyAuth({ enabled: true, status: 'error', reason: e.message });
  }
}

async function startTelegramLogin() {
  try {
    renderGate({ status: 'awaiting' });
    const r = await api('/auth/login', { method: 'POST' });
    if (r && r.status === 'authorized') { applyAuth(r); return; }
    currentAuthState = { status: 'awaiting' };
    stopAuthPoll();
    startAuthPoll();
  } catch (e) {
    toast('Не вдалось почати вхід: ' + e.message, true);
    renderGate({ status: 'need_login' });
  }
}

async function recheckAuth() {
  try {
    renderGate({ status: 'loading' });
    const st = await api('/auth/recheck', { method: 'POST' });
    applyAuth(st);
    toast(st.status === 'authorized' ? 'Доступ підтверджено ✓' : 'Доступ не підтверджено', st.status !== 'authorized');
  } catch (e) {
    renderGate({ status: 'error', reason: e.message });
  }
}

async function logoutTelegram() {
  if (currentAuthState && currentAuthState.status === 'authorized' &&
      !confirmDo('Вийти з акаунта Telegram? Шлюз перестане обслуговувати програми, доки не увійдеш знову.')) return;
  stopAuthPoll();
  try {
    await api('/auth/logout', { method: 'POST' });
    wasAuthed = false;
    await checkAuthGate();
  } catch (e) {
    toast('Не вдалось вийти: ' + e.message, true);
  }
}

$('btnLogout').addEventListener('click', logoutTelegram);
$('set-btn-recheck').addEventListener('click', recheckAuth);
$('set-btn-login').addEventListener('click', startTelegramLogin);
$('set-btn-logout').addEventListener('click', logoutTelegram);

// Access can be revoked while the window is open (membership re-check every
// 5 min on the backend): keep the UI in sync and lock it when that happens.
setInterval(async () => {
  if (!document.body.classList.contains('authed')) return;
  try {
    const st = await api('/auth/status');
    if (st.status !== 'authorized') {
      wasAuthed = false;
      applyAuth(st);
    } else {
      currentAuthState = st;
    }
  } catch (e) { /* app restarting */ }
}, 30000);
window.addEventListener('focus', () => { if (document.body.classList.contains('authed')) checkAuthGate(); });

// ---------- boot ----------
function boot() {
  renderOauthButtons();
  loadStatus().catch(() => {});
  let start = 'home';
  try { start = localStorage.getItem(PAGE_KEY) || 'home'; } catch (e) { /* ignore */ }
  showPage(start);
}
checkAuthGate();
