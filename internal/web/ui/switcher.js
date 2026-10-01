'use strict';
// CarteLink floating model switcher: two presets, one button, and an optional
// hand-off ("answer once on model 1, then move everything to model 2").
// Every change goes through the control API, so the main window and the
// gateway see it at once.

const $ = (id) => document.getElementById(id);
let STATE = null;
let GROUPS = [];
let GROUPS_VER = 0;
let BUSY = false;

async function api(path, opts) {
  opts = opts || {};
  if (opts.body) opts.headers = { 'Content-Type': 'application/json' };
  const res = await fetch('/api' + path, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-json */ }
  if (!res.ok || (data && data.ok === false && data.error)) {
    throw new Error((data && data.error) || text || ('HTTP ' + res.status));
  }
  return data;
}

const mgmt = (path) => api('/cliproxy/api/' + path);

// Same sources as the main window's model lists: models of connected
// accounts + OpenAI-compatible providers, minus the blacklist.
async function loadModels() {
  let black = [];
  try { black = ((await api('/config')).modelBlacklist || []).map((s) => String(s).toLowerCase().trim()); } catch (e) { /* none */ }
  const blocked = (id) => black.indexOf(String(id).toLowerCase().trim()) >= 0;
  const groups = [];
  let files = [];
  try {
    const r = await mgmt('auth-files');
    files = Array.isArray(r) ? r : ((r && r.files) || []);
  } catch (e) { /* engine offline */ }
  const byProv = {};
  await Promise.all(files.map(async (f) => {
    const name = f.name || f.filename || f.id || '';
    const prov = (f.provider || f.type || 'account').toLowerCase();
    if (!name) return;
    try {
      const mr = await mgmt('auth-files/models?name=' + encodeURIComponent(name));
      for (const m of ((mr && mr.models) || [])) {
        if (m && m.id) (byProv[prov] = byProv[prov] || new Set()).add(m.id);
      }
    } catch (e) { /* skip */ }
  }));
  for (const prov of Object.keys(byProv).sort()) {
    const ids = Array.from(byProv[prov]).sort().filter((id) => !blocked(id));
    if (ids.length) groups.push({ label: '◆ ' + prov.charAt(0).toUpperCase() + prov.slice(1), ids: ids });
  }
  try {
    const r = await mgmt('openai-compatibility');
    const arr = Array.isArray(r) ? r : ((r && r['openai-compatibility']) || []);
    for (const p of arr) {
      if (p.disabled) continue;
      const ids = [];
      for (const m of (p.models || [])) {
        const alias = m.alias || m.name;
        if (!alias) continue;
        ids.push(alias);
        if (p.prefix) ids.push(p.prefix + '/' + alias);
      }
      const ok = ids.filter((id) => !blocked(id));
      if (ok.length) groups.push({ label: '≡ ' + (p.name || 'provider'), ids: ok });
    }
  } catch (e) { /* engine offline */ }
  try {
    const em = await api('/engine-models');
    const seen = new Set(groups.flatMap((g) => g.ids).map((x) => x.toLowerCase()));
    const rest = ((em && em.models) || []).filter((id) => id && !seen.has(id.toLowerCase()) &&
      !/^claude-cartelink-|^cartelink-/.test(id) && !blocked(id)).sort();
    if (rest.length) groups.push({ label: '◇ ' + t('Інші моделі рушія'), ids: rest });
  } catch (e) { /* engine offline */ }
  if (JSON.stringify(groups) !== JSON.stringify(GROUPS)) GROUPS_VER++;
  GROUPS = groups;
}

function fill(sel, cur) {
  // Rebuild only when something changed (keeps an open dropdown alive).
  const sig = GROUPS_VER + '|' + cur;
  if (sel.dataset.sig === sig) return;
  sel.dataset.sig = sig;
  sel.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = t('— обери модель —');
  sel.appendChild(empty);
  let found = false;
  for (const g of GROUPS) {
    const og = document.createElement('optgroup');
    og.label = g.label;
    for (const id of g.ids) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = id;
      if (id === cur) { o.selected = true; found = true; }
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  if (cur && !found) {
    const o = document.createElement('option');
    o.value = cur;
    o.textContent = cur + ' ' + t('(недоступна зараз)');
    o.selected = true;
    sel.appendChild(o);
  }
}

function paint(st) {
  const prev = STATE;
  STATE = st;
  $('locked').style.display = st.authed ? 'none' : '';
  $('sw').style.display = st.authed ? '' : 'none';

  for (const n of [1, 2]) {
    const m = n === 1 ? st.model1 : st.model2;
    const slot = $('slot' + n);
    slot.classList.toggle('active', st.active === n);
    slot.classList.toggle('empty', !m);
    if (document.activeElement !== $('m' + n)) fill($('m' + n), m || '');
  }
  $('swap').disabled = !(st.model1 && st.model2);

  const cur = $('current');
  if (prev && prev.current !== st.current) {
    cur.classList.remove('flash');
    void cur.offsetWidth;
    cur.classList.add('flash');
  }
  cur.textContent = st.current || t('не обрано');
  cur.title = st.current || '';
  $('dot').className = 'live ' + (st.current ? 'on' : '');

  $('auto').checked = !!st.autoSwitch;
  const armed = !!(st.autoSwitch && st.autoArmed && st.active === 1 && st.model2);
  $('autoRow').classList.toggle('armed', armed);
  $('autoState').textContent = !st.autoSwitch ? t('вимкнено')
    : armed ? t('чекає на перший вдалий запит до моделі 1')
      : st.active === 1 ? t('уже спрацювало — поверни модель 1, щоб знову')
        : t('спрацює, коли буде активна модель 1');
}

async function refresh(withModels) {
  try {
    if (withModels || !GROUPS.length) await loadModels();
    paint(await api('/switcher'));
  } catch (e) {
    $('dot').className = 'live err';
    $('current').textContent = t('CarteLink не відповідає');
  }
}

async function run(fn) {
  if (BUSY) return;
  BUSY = true;
  try {
    paint(await fn());
  } catch (e) {
    $('dot').className = 'live err';
    $('current').textContent = e.message;
  } finally {
    BUSY = false;
  }
}

$('m1').addEventListener('change', () => run(() => api('/switcher', { method: 'PUT', body: JSON.stringify({ model1: $('m1').value }) })));
$('m2').addEventListener('change', () => run(() => api('/switcher', { method: 'PUT', body: JSON.stringify({ model2: $('m2').value }) })));
$('swap').addEventListener('click', () => run(() => api('/switcher/switch', { method: 'POST', body: '{}' })));
$('auto').addEventListener('change', () => run(() => api('/switcher', { method: 'PUT', body: JSON.stringify({ autoSwitch: $('auto').checked }) })));
// A click anywhere on a preset row (except its select) applies that preset.
document.querySelectorAll('.slot').forEach((b) => b.addEventListener('click', (e) => {
  if (e.target.closest('select')) return;
  const to = Number(b.dataset.to);
  if (!(STATE && (to === 1 ? STATE.model1 : STATE.model2))) return;
  run(() => api('/switcher/switch', { method: 'POST', body: JSON.stringify({ to: to }) }));
}));

refresh(true);
// State is cheap to poll (the main window and the auto-switch change it too);
// the model list is refreshed less often.
setInterval(() => { if (!document.hidden && !BUSY) refresh(false); }, 2500);
setInterval(() => { if (!document.hidden) refresh(true); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
