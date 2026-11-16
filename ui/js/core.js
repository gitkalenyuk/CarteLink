'use strict';
// CarteLink 3 UI core. Everything pages share lives on window.CL.
//
// Pages register with CL.page(id, def) — see the contract at CL.page below.
// Text: write Ukrainian source strings; i18n.js translates the DOM itself.
// Strings with values go through t('… {x} …', {x}) — never concatenate.

(function () {
  const CL = (window.CL = {});

  // ------------------------------------------------------------ helpers --

  CL.$ = (sel, root) => (root || document).querySelector(sel);
  CL.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  CL.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  /** Inline icon from the sprite in index.html: CL.ic('copy'), CL.ic('x','sm'). */
  CL.ic = (name, cls) => '<svg class="i' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  /** Runs fn inside a View Transition when the window can show one (never throws). */
  CL.transition = (fn) => {
    if (!document.startViewTransition || document.hidden || document.body.classList.contains('motion-off')) { fn(); return; }
    try {
      const vt = document.startViewTransition(fn);
      [vt.ready, vt.finished, vt.updateCallbackDone].forEach((p) => p && p.catch(() => {}));
    } catch (e) { fn(); }
  };
  CL.t = (s, v) => (typeof window.t === 'function' ? window.t(s, v) : s);
  CL.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  CL.debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
  CL.uid = () => Math.random().toString(36).slice(2, 9);

  /** Render HTML into an element (string). Returns the element. */
  CL.html = (el, s) => { el.innerHTML = s; return el; };
  /** Build one element from an HTML string. */
  CL.el = (s) => { const d = document.createElement('div'); d.innerHTML = s.trim(); return d.firstElementChild; };

  // ------------------------------------------------------------ formats --

  CL.fmtNum = (n) => {
    n = Number(n || 0);
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toLocaleString();
  };
  CL.fmtInt = (n) => Number(n || 0).toLocaleString();
  CL.fmtMs = (ms) => (ms >= 10000 ? (ms / 1000).toFixed(0) + ' s' : ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms');
  CL.fmtTime = (ms) => { const d = new Date(ms); const p = (x) => String(x).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
  CL.fmtDateTime = (ms) => { const d = new Date(ms); const p = (x) => String(x).padStart(2, '0'); return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  /** «щойно», «5 хв тому», «3 год тому», else date. */
  CL.relTime = (ms) => {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return CL.t('щойно');
    if (s < 3600) return CL.t('{n} хв тому', { n: Math.floor(s / 60) });
    if (s < 86400) return CL.t('{n} год тому', { n: Math.floor(s / 3600) });
    return CL.fmtDateTime(ms);
  };
  /** Time left: «менше хвилини», «12 хв», «2 год 5 хв», «3 д 4 год». */
  CL.fmtLeft = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return CL.t('менше хвилини');
    if (m < 60) return CL.t('{m} хв', { m });
    const h = Math.floor(m / 60);
    if (h < 24) return CL.t('{h} год {m} хв', { h, m: m % 60 });
    return CL.t('{d} д {h} год', { d: Math.floor(h / 24), h: h % 24 });
  };
  CL.mask = (k) => { k = String(k || ''); return k.length > 12 ? k.slice(0, 7) + '…' + k.slice(-4) : '•'.repeat(Math.min(8, k.length)); };
  /** Drop a legacy "provider:" prefix; "qwen3:32b" stays whole. */
  const TAGS = ['account', 'provider', 'compat', 'openai', 'anthropic', 'claude', 'codex', 'gemini', 'antigravity', 'vertex'];
  CL.cleanModel = (s) => {
    s = String(s || '').trim();
    const i = s.indexOf(':');
    if (i > 0 && i < s.length - 1 && s.indexOf('://') < 0 && TAGS.includes(s.slice(0, i).toLowerCase())) return s.slice(i + 1);
    return s;
  };
  CL.provTitle = (p) => {
    p = String(p || '');
    const known = { workbuddy: 'WorkBuddy', codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity', 'gemini-cli': 'Gemini CLI', xai: 'xAI', kimi: 'Kimi', kiro: 'Kiro', meta: 'Meta', devin: 'Devin', vertex: 'Vertex AI', gemini: 'Gemini' };
    return known[p] || p.charAt(0).toUpperCase() + p.slice(1);
  };

  // ---------------------------------------------------------------- API --

  /** fetch('/api'+path). Throws Error(message) on HTTP errors or {ok:false}. */
  async function api(path, opts) {
    opts = Object.assign({}, opts || {});
    if (opts.body !== undefined && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
      opts.body = JSON.stringify(opts.body);
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    }
    let res;
    try {
      res = await fetch('/api' + path, opts);
    } catch (e) {
      throw new Error(CL.t('CarteLink не відповідає'));
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
    if (!res.ok || (data && data.ok === false && data.error)) {
      const err = new Error((data && (data.error && (data.error.message || data.error)) || data && data.message) || text || 'HTTP ' + res.status);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }
  api.get = (p) => api(p);
  api.post = (p, body) => api(p, { method: 'POST', body: body === undefined ? {} : body });
  api.put = (p, body) => api(p, { method: 'PUT', body });
  api.patch = (p, body) => api(p, { method: 'PATCH', body });
  api.del = (p, body) => api(p, { method: 'DELETE', body });
  CL.api = api;

  /** The engine's Management API: CL.mgmt('GET','auth-files') → /v0/management/auth-files. */
  CL.mgmt = (method, path, body) => api('/cliproxy/api/' + path, { method, body });

  /** Config: read fresh, write only the changed fields (JSON merge patch). */
  CL.config = {
    cache: null,
    async get() { CL.config.cache = await api.get('/config'); return CL.config.cache; },
    /** CL.config.patch({routing:{defaultModel:'x'}}) — null removes a key. */
    async patch(p) { const r = await api.patch('/config', p); CL.emit('config'); return r; },
  };

  // ---------------------------------------------------------- event bus --

  const handlers = {};
  /** CL.on('status'|'live'|'changed'|'config'|'models', fn) → off(). */
  CL.on = (ev, fn) => { (handlers[ev] = handlers[ev] || new Set()).add(fn); return () => handlers[ev].delete(fn); };
  CL.emit = (ev, data) => { (handlers[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); };

  // ------------------------------------------------------------- status --

  CL.status = null; // last GET /api/status
  CL.endpoints = null; // last GET /api/endpoints
  CL.loadStatus = async () => {
    const st = await api.get('/status');
    CL.status = st;
    CL.emit('status', st);
    return st;
  };
  CL.loadEndpoints = async () => { CL.endpoints = await api.get('/endpoints'); return CL.endpoints; };
  CL.mainModel = () => (CL.status && CL.status.mainModel) || '';

  // Live updates from /api/events: {type:'request'|'error'|'changed', …}.
  function connectLive() {
    let es;
    try { es = new EventSource('/api/events'); } catch (e) { return; }
    es.onmessage = (m) => {
      let ev;
      try { ev = JSON.parse(m.data); } catch (e) { return; }
      CL.emit('live', ev);
      if (ev.type === 'changed') CL.emit('changed', ev.what);
    };
    es.onerror = () => { es.close(); setTimeout(connectLive, 3000); };
  }
  CL.connectLive = connectLive;

  // -------------------------------------------------------------- models --

  // Shared model catalogue: {groups:[{label, kind, options:[{value,text,prov}]}], flat:[ids], byProv:{prov:[ids]}, authFiles:[…], blacklist:Set}
  let modelsCache = null;
  let modelsAt = 0;
  let modelsBusy = null;
  CL.models = async (force) => {
    if (!force && modelsCache && Date.now() - modelsAt < 15000) return modelsCache;
    if (modelsBusy) return modelsBusy;
    modelsBusy = (async () => {
      const out = { groups: [], flat: [], byProv: {}, authFiles: [], blacklist: new Set() };
      const seen = new Set();
      const add = (g, id) => { const low = String(id).toLowerCase(); if (!id || seen.has(low)) return; seen.add(low); g.options.push({ value: id, text: id }); out.flat.push(id); };
      try { const cfg = await CL.config.get(); (cfg.modelBlacklist || []).forEach((b) => out.blacklist.add(String(b).toLowerCase().trim())); } catch (e) { /* offline */ }
      let files = [];
      try { const r = await CL.mgmt('GET', 'auth-files'); files = Array.isArray(r) ? r : (r && r.files) || []; } catch (e) { /* engine down */ }
      out.authFiles = files;
      const byProv = {};
      await Promise.all(files.map(async (f) => {
        const name = f.name || f.filename || f.id;
        const prov = String(f.provider || f.type || 'account').toLowerCase();
        if (!name || f.disabled) return;
        try {
          const mr = await CL.mgmt('GET', 'auth-files/models?name=' + encodeURIComponent(name));
          ((mr && mr.models) || []).forEach((m) => { if (m && m.id) (byProv[prov] = byProv[prov] || new Set()).add(m.id); });
        } catch (e) { /* tolerate one bad file */ }
      }));
      Object.keys(byProv).sort().forEach((prov) => {
        const ids = Array.from(byProv[prov]).sort();
        out.byProv[prov] = ids;
        const n = files.filter((f) => String(f.provider || f.type || '').toLowerCase() === prov).length;
        const g = { label: CL.provTitle(prov) + (n > 1 ? ' · ' + CL.t('{n} акаунти', { n }) : ''), kind: 'account', options: [] };
        ids.forEach((id) => add(g, id));
        if (g.options.length) out.groups.push(g);
      });
      try {
        const r = await CL.mgmt('GET', 'openai-compatibility');
        const list = Array.isArray(r) ? r : (r && (r['openai-compatibility'] || r.items)) || [];
        list.filter((p) => !p.disabled).forEach((p) => {
          const g = { label: p.name || 'provider', kind: 'provider', options: [] };
          (p.models || []).forEach((m) => { const a = m.alias || m.name; if (!a) return; add(g, a); if (p.prefix) add(g, p.prefix + '/' + a); });
          if (g.options.length) out.groups.push(g);
        });
      } catch (e) { /* engine down */ }
      try {
        const em = await api.get('/engine-models');
        const g = { label: CL.t('Інші моделі рушія'), kind: 'engine', options: [] };
        ((em && em.models) || []).filter((id) => !/^claude-cartelink-|^cartelink-/.test(id)).sort().forEach((id) => add(g, id));
        if (g.options.length) out.groups.push(g);
      } catch (e) { /* engine down */ }
      modelsCache = out;
      modelsAt = Date.now();
      CL.emit('models', out);
      return out;
    })().finally(() => { modelsBusy = null; });
    return modelsBusy;
  };
  CL.models.invalidate = () => { modelsAt = 0; };
  CL.isBlacklisted = (id, cat) => !!(cat && cat.blacklist.has(String(id || '').toLowerCase().trim()));

  // ------------------------------------------------------------- toasts --

  /** CL.toast('Збережено ✓') / CL.toast(msg, 'bad'). Errors stay longer. */
  CL.toast = (text, kind) => {
    const box = CL.$('#toasts');
    const el = CL.el('<div class="toast ' + (kind || 'ok') + '">' + CL.ic(kind === 'bad' ? 'alert' : kind === 'info' ? 'info' : 'check') + '<div>' + CL.esc(CL.t(String(text))) + '</div></div>');
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, kind === 'bad' ? 7000 : 2600);
  };
  CL.fail = (e) => CL.toast(CL.t('Не вдалось: {e}', { e: (e && e.message) || e }), 'bad');

  /** Copy text; toast confirms. */
  CL.copy = async (text, label) => {
    if (!text) { CL.toast('Нічого копіювати', 'bad'); return; }
    try { await navigator.clipboard.writeText(text); CL.toast(CL.t(label || 'Скопійовано') + ' ✓'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); CL.toast(CL.t(label || 'Скопійовано') + ' ✓'); } catch (e2) { CL.toast('Не вдалось скопіювати', 'bad'); }
      ta.remove();
    }
  };
  // Any [data-copy="text"] or [data-copy-from="#inputId"] button copies.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy],[data-copy-from]');
    if (!b) return;
    const v = b.hasAttribute('data-copy') ? b.getAttribute('data-copy') : ((CL.$(b.getAttribute('data-copy-from')) || {}).value || (CL.$(b.getAttribute('data-copy-from')) || {}).textContent);
    CL.copy(v);
  });

  // ------------------------------------------------------------ dialogs --

  /** A modal. opts: {title, html (body), wide, actions:[{label, kind:'primary'|'danger'|'', value, close:true}], onMount(dlgEl, close)} → Promise<value|null>. */
  const dlgStack = [];
  CL.dialog = (opts) => new Promise((resolve) => {
    const opener = document.activeElement;
    const back = CL.el('<div class="dlg-back" role="dialog" aria-modal="true"><div class="dlg' + (opts.wide ? ' wide' : '') + '">' +
      (opts.title ? '<h3>' + CL.esc(CL.t(opts.title)) + '</h3>' : '') + '<div class="dlg-body">' + (opts.html || '') + '</div>' +
      '<div class="dlg-actions"></div></div></div>');
    const dlg = back.firstElementChild;
    const acts = dlg.querySelector('.dlg-actions');
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      back.classList.add('out');
      document.removeEventListener('keydown', onKey, true);
      const i = dlgStack.indexOf(back);
      if (i >= 0) dlgStack.splice(i, 1);
      if (opener && opener.focus && document.contains(opener)) setTimeout(() => opener.focus(), 0);
      setTimeout(() => back.remove(), 170);
      resolve(v === undefined ? null : v);
    };
    (opts.actions || [{ label: 'Закрити', value: null }]).forEach((a) => {
      const b = CL.el('<button class="btn ' + (a.kind || '') + '">' + CL.esc(CL.t(a.label)) + '</button>');
      b.addEventListener('click', async () => {
        if (a.onClick) { const r = await a.onClick(dlg, close); if (r === false) return; }
        if (a.close !== false) close(a.value);
      });
      acts.appendChild(b);
    });
    if (!opts.actions || !opts.actions.length) acts.remove();
    const onKey = (e) => {
      if (e.key !== 'Escape' || dlgStack[dlgStack.length - 1] !== back) return;
      e.stopImmediatePropagation();
      if (!opts.sticky) close(null);
    };
    dlgStack.push(back);
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back && !opts.sticky) close(null); });
    document.body.appendChild(back);
    if (opts.onMount) opts.onMount(dlg, close);
    const first = dlg.querySelector('input,textarea,select') || dlg.querySelector('.btn.primary,.btn.danger') || acts.lastElementChild;
    if (first) setTimeout(() => first.focus(), 30);
  });

  /** Ask before a dangerous action. CL.confirm('Видалити?', {danger:true, ok:'Видалити', title}) → Promise<bool>. */
  CL.confirm = async (text, o) => {
    o = o || {};
    const v = await CL.dialog({
      title: o.title || (o.danger ? 'Підтвердіть дію' : 'Підтвердження'),
      html: '<div class="dlg-text">' + CL.esc(CL.t(text)) + '</div>',
      actions: [{ label: 'Скасувати', value: false }, { label: o.ok || (o.danger ? 'Так, видалити' : 'Так'), kind: o.danger ? 'danger solid' : 'primary', value: true }],
    });
    return v === true;
  };

  /** Ask for one value. CL.prompt('Регіон', {value:'us-central1', type:'text', title}) → Promise<string|null>. */
  CL.prompt = async (label, o) => {
    o = o || {};
    const id = 'p' + CL.uid();
    return CL.dialog({
      title: o.title || label,
      html: (o.text ? '<div class="dlg-text">' + CL.esc(CL.t(o.text)) + '</div>' : '') + '<div class="field"><label for="' + id + '">' + CL.esc(CL.t(label)) + '</label><input class="input' + (o.mono ? ' mono' : '') + '" id="' + id + '" type="' + (o.type || 'text') + '" value="' + CL.esc(o.value || '') + '" placeholder="' + CL.esc(o.placeholder || '') + '"></div>',
      actions: [{ label: 'Скасувати', value: null }, { label: o.ok || 'Готово', kind: 'primary', onClick: (d, close) => { close(d.querySelector('input').value.trim()); return false; } }],
      onMount: (d, close) => d.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') close(e.target.value.trim()); }),
    });
  };

  // ------------------------------------------------------------ tooltip --

  // One tooltip element, reused. It follows the [data-tip] element under the
  // pointer, appears after a short pause and never restarts while the pointer
  // moves between that element's children (2.x/3.0-beta rebuilt it on every
  // child, so it blinked).
  const tipEl = document.createElement('div');
  tipEl.className = 'tipbox';
  tipEl.setAttribute('role', 'tooltip');
  let tipFor = null;
  let tipTimer = 0;
  const hideTip = () => { clearTimeout(tipTimer); tipFor = null; tipEl.classList.remove('on'); };
  const placeTip = (t) => {
    const r = t.getBoundingClientRect();
    if (!r.width && !r.height) return hideTip();
    const w = tipEl.offsetWidth;
    const h = tipEl.offsetHeight;
    const x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    let y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    tipEl.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  };
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    const text = t && t.getAttribute('data-tip');
    if (t === tipFor) return;
    if (!t || !text || document.body.classList.contains('hide-tips')) { hideTip(); return; }
    clearTimeout(tipTimer);
    tipFor = t;
    const show = () => {
      if (tipFor !== t || !document.contains(t)) return;
      if (!tipEl.isConnected) document.body.appendChild(tipEl);
      tipEl.textContent = t.getAttribute('data-tip');
      placeTip(t);
      tipEl.classList.add('on');
    };
    // Moving from one tip to the next: no delay, no fade.
    if (tipEl.classList.contains('on')) show(); else tipTimer = setTimeout(show, 380);
  });
  document.addEventListener('mouseout', (e) => { if (tipFor && !e.relatedTarget) hideTip(); });
  ['mousedown', 'keydown', 'wheel', 'scroll', 'blur'].forEach((ev) => window.addEventListener(ev, hideTip, true));

  // ---------------------------------------------------- UI components --

  CL.ui = {};

  /** Busy state on a button while an async fn runs: CL.ui.busy(btn, async () => …). Shows .done on success. */
  CL.ui.busy = async (btn, fn) => {
    if (btn) { btn.classList.add('busy'); btn.disabled = true; }
    try { const r = await fn(); if (btn) { btn.classList.add('done'); setTimeout(() => btn.classList.remove('done'), 600); } return r; }
    catch (e) { CL.fail(e); return undefined; }
    finally { if (btn) { btn.classList.remove('busy'); btn.disabled = false; } }
  };

  /** Toggle switch HTML: CL.ui.switch('id', checked, 'Label?'). */
  CL.ui.switch = (id, on, label) => '<label class="switch"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '><span class="track"></span>' + (label ? '<span>' + CL.esc(CL.t(label)) + '</span>' : '') + '</label>';

  /** Segmented control HTML: CL.ui.seg('id', [[value,label],…], current). Listen with CL.ui.onSeg(el, fn). */
  CL.ui.seg = (id, items, cur) => '<div class="seg" id="' + id + '" role="tablist">' + items.map(([v, l]) => '<button type="button" data-v="' + CL.esc(v) + '"' + (String(v) === String(cur) ? ' class="on"' : '') + '>' + CL.esc(CL.t(l)) + '</button>').join('') + '</div>';
  CL.ui.onSeg = (el, fn) => el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    fn(b.dataset.v);
  });

  /** State chip for an account state (ok|warn|limited|error|invalid|disabled). */
  CL.ui.stateChip = (state) => {
    const m = { ok: ['активний', 'ok'], warn: ['близько до ліміту', 'warn'], limited: ['ліміт', 'warn'], error: ['помилка', 'bad'], invalid: ['вхід відхилено', 'bad'], disabled: ['вимкнено', ''] };
    const s = m[state] || [state || '—', ''];
    return '<span class="chip ' + s[1] + '">' + CL.esc(CL.t(s[0])) + '</span>';
  };

  /** Empty state: CL.ui.empty('users', 'Акаунтів ще немає', 'текст', '<button…>'). */
  CL.ui.empty = (icon, title, text, action) => '<div class="empty">' + CL.ic(icon) + '<b>' + CL.esc(CL.t(title)) + '</b>' + (text ? '<div>' + CL.esc(CL.t(text)) + '</div>' : '') + (action || '') + '</div>';
  CL.ui.skeleton = (n) => Array.from({ length: n || 3 }, (_, i) => '<span class="skel skel-line" style="width:' + (92 - i * 13) + '%"></span>').join('');

  /** Count a number up when it changes. */
  CL.ui.countTo = (el, to, fmt) => {
    if (!el) return;
    fmt = fmt || CL.fmtNum;
    const from = Number(el.dataset.v);
    el.dataset.v = String(to);
    if (!isFinite(from) || from === to || document.body.classList.contains('motion-off')) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 650);
      el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(2, -10 * k))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /** Usage ring HTML for 0..100. */
  CL.ui.ring = (pct, label) => {
    const C = 169.65;
    const p = Math.max(0, Math.min(100, pct || 0));
    const lvl = p >= 100 ? 'bad' : p >= 80 ? 'warn' : '';
    return '<div class="ring ' + lvl + '"><svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="27"/><circle class="fg" cx="32" cy="32" r="27" stroke-dasharray="' + C + '" stroke-dashoffset="' + (C * (1 - p / 100)).toFixed(2) + '"/></svg><b>' + (label != null ? CL.esc(label) : Math.round(p) + '%') + '</b></div>';
  };

  /** Usage bar HTML for 0..100. */
  CL.ui.bar = (pct, level) => {
    const p = Math.max(0, Math.min(100, pct || 0));
    return '<div class="bar ' + (level !== undefined ? level : p >= 100 ? 'bad' : p >= 80 ? 'warn' : '') + '"><i style="transform:scaleX(' + (p / 100).toFixed(3) + ')"></i></div>';
  };

  /** Code block with a copy button. */
  CL.ui.code = (text) => '<pre class="code">' + CL.esc(text) + '<button class="btn sm icon ghost copy-btn" data-copy="' + CL.esc(text) + '" data-tip="Копіювати">' + CL.ic('copy', 'sm') + '</button></pre>';

  /** Activity chart: buckets [{ok, failed, label}] → bars. */
  CL.ui.chart = (box, buckets, axis) => {
    const max = Math.max(1, ...buckets.map((b) => b.ok + b.failed));
    const total = buckets.reduce((s, b) => s + b.ok + b.failed, 0);
    const still = box.dataset.drawn === '1';
    box.dataset.drawn = '1';
    box.innerHTML = '<div class="chart' + (still ? ' still' : '') + '">' + buckets.map((b, i) => {
      const okH = (b.ok / max) * 100;
      const badH = (b.failed / max) * 100;
      return '<div class="col" style="--k:' + i + '" data-tip="' + CL.esc(CL.t('{when}: {ok} успішних / {bad} помилок', { when: b.label, ok: b.ok, bad: b.failed })) + '">' +
        (b.ok ? '<i style="height:' + okH.toFixed(2) + '%"></i>' : '') + (b.failed ? '<i class="b" style="height:' + badH.toFixed(2) + '%"></i>' : '') + '</div>';
    }).join('') + (total ? '' : '<div class="chart-empty">' + CL.esc(CL.t('Запитів ще не було')) + '</div>') + '</div>' +
      (axis ? '<div class="chart-axis">' + axis.map((a) => '<span>' + CL.esc(a) + '</span>').join('') + '</div>' : '');
  };

  /** Hourly buckets from metrics.hourly ({ "<hourMs>": {ok, failed, tokens} }) for the last `hours`. */
  CL.hourBuckets = (hourly, hours) => {
    const H = 3600000;
    const end = Math.floor(Date.now() / H) * H;
    const out = [];
    for (let i = hours - 1; i >= 0; i--) {
      const h = end - i * H;
      const b = (hourly || {})[String(h)] || {};
      const d = new Date(h);
      out.push({ ok: b.ok || 0, failed: b.failed || 0, tokens: b.tokens || 0, label: (hours > 48 ? d.getDate() + '.' + (d.getMonth() + 1) + ' ' : '') + String(d.getHours()).padStart(2, '0') + ':00', at: h });
    }
    return out;
  };
  /** Daily buckets from the same hourly map. */
  CL.dayBuckets = (hourly, days) => {
    const D = 86400000;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - (days - 1) * D;
    const out = Array.from({ length: days }, (_, i) => { const d = new Date(start + i * D); return { ok: 0, failed: 0, tokens: 0, label: d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0'), at: start + i * D }; });
    Object.entries(hourly || {}).forEach(([k, b]) => {
      const idx = Math.floor((Number(k) - start) / D);
      if (idx >= 0 && idx < days) { out[idx].ok += b.ok || 0; out[idx].failed += b.failed || 0; out[idx].tokens += b.tokens || 0; }
    });
    return out;
  };

  /**
   * Searchable model picker (replaces <select> for models).
   * const p = CL.ui.modelPicker(containerEl, {value, empty:'— не вказано —', extra:[{label, options:[{value,text}]}], onChange(v)})
   * p.set(v) / p.get(). The catalogue comes from CL.models().
   */
  let openPop = null;
  CL.ui.closePops = () => { if (openPop) openPop(); };
  ['resize', 'blur'].forEach((ev) => window.addEventListener(ev, () => CL.ui.closePops()));
  document.addEventListener('scroll', (e) => { if (openPop && !(e.target.closest && e.target.closest('.mp-pop'))) CL.ui.closePops(); }, true);
  CL.ui.modelPicker = (host, o) => {
    o = o || {};
    let value = CL.cleanModel(o.value || '');
    host.classList.add('mp');
    host.innerHTML = '<button type="button" class="mp-btn"></button>';
    const btn = host.firstElementChild;
    let cat = null;
    const paint = () => {
      const known = !value || !cat || cat.flat.some((x) => x.toLowerCase() === value.toLowerCase()) || (o.extra || []).some((g) => g.options.some((x) => x.value === value));
      btn.innerHTML = value
        ? '<span class="ellipsis grow">' + CL.esc(value) + '</span>' + (known ? '' : '<span class="warnmark" data-tip="' + CL.esc(CL.t('Зараз жоден акаунт не обслуговує цю модель')) + '">' + CL.ic('alert', 'sm') + '</span>')
        : '<span class="ph grow">' + CL.esc(CL.t(o.empty || '— обери модель —')) + '</span>';
      btn.insertAdjacentHTML('beforeend', CL.ic('chevron', 'sm'));
    };
    CL.models().then((c) => { cat = c; paint(); });
    paint();
    btn.addEventListener('click', async () => {
      if (openPop) { const was = host.contains(document.querySelector('.mp-pop')) || btn.classList.contains('open'); CL.ui.closePops(); if (was) return; }
      if (!cat) cat = await CL.models();
      else CL.models().then((c) => { cat = c; });
      btn.classList.add('open');
      const pop = CL.el('<div class="mp-pop"><div class="mp-search"><input class="input" placeholder="' + CL.esc(CL.t('Пошук моделі…')) + '"></div><div class="mp-list"></div></div>');
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect();
      const w = Math.max(r.width, 360);
      pop.style.width = w + 'px';
      pop.style.left = Math.min(window.innerWidth - w - 12, r.left) + 'px';
      const below = window.innerHeight - r.bottom;
      if (below < 300 && r.top > below) { pop.style.bottom = (window.innerHeight - r.top + 4) + 'px'; } else { pop.style.top = (r.bottom + 4) + 'px'; }
      const input = pop.querySelector('input');
      const list = pop.querySelector('.mp-list');
      let hl = -1;
      const groups = (o.extra || []).concat(cat.groups);
      const render = () => {
        const q = input.value.trim().toLowerCase();
        let h = '';
        let n = 0;
        if (o.empty !== false && !q) h += '<button class="mp-opt' + (!value ? ' sel' : '') + '" data-v="">' + CL.esc(CL.t(o.empty || '— не вказано —')) + '</button>';
        groups.forEach((g) => {
          const opts = g.options.filter((x) => !CL.isBlacklisted(x.value, cat) && (!q || x.value.toLowerCase().includes(q) || (x.text || '').toLowerCase().includes(q)));
          if (!opts.length) return;
          h += '<div class="mp-grp">' + CL.esc(CL.t(g.label)) + '</div>';
          opts.forEach((x) => { n++; h += '<button class="mp-opt' + (x.value.toLowerCase() === value.toLowerCase() ? ' sel' : '') + '" data-v="' + CL.esc(x.value) + '"><span class="ellipsis">' + CL.esc(x.text || x.value) + '</span>' + (x.value.toLowerCase() === value.toLowerCase() ? CL.ic('check', 'sm') : '') + '</button>'; });
        });
        if (q && !groups.some((g) => g.options.some((x) => x.value.toLowerCase() === q))) {
          h += '<div class="mp-grp">' + CL.esc(CL.t('Своя назва')) + '</div><button class="mp-opt" data-v="' + CL.esc(input.value.trim()) + '">' + CL.ic('plus', 'sm') + CL.esc(input.value.trim()) + '</button>';
        }
        if (!n && !q && !cat.flat.length) h += '<div class="mp-none">' + CL.esc(CL.t('Моделей ще немає — підключи акаунт або провайдера.')) + '</div>';
        list.innerHTML = h;
        hl = -1;
      };
      render();
      input.focus();
      const pick = (v) => { value = CL.cleanModel(v); paint(); close(); if (o.onChange) o.onChange(value); };
      list.addEventListener('click', (e) => { const b = e.target.closest('.mp-opt'); if (b) pick(b.dataset.v); });
      input.addEventListener('input', render);
      input.addEventListener('keydown', (e) => {
        const opts = Array.from(list.querySelectorAll('.mp-opt'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          hl = Math.max(0, Math.min(opts.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1)));
          opts.forEach((x, i) => x.classList.toggle('hl', i === hl));
          if (opts[hl]) opts[hl].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const b = opts[hl >= 0 ? hl : 0];
          if (b) pick(b.dataset.v);
        } else if (e.key === 'Escape') close();
      });
      const outside = (e) => { if (!pop.contains(e.target) && !host.contains(e.target)) close(); };
      setTimeout(() => document.addEventListener('mousedown', outside), 0);
      function close() { document.removeEventListener('mousedown', outside); pop.remove(); btn.classList.remove('open'); if (openPop === close) openPop = null; }
      openPop = close;
    });
    return { get: () => value, set: (v) => { value = CL.cleanModel(v || ''); paint(); } };
  };

  /** Apply one model to everything (tiers, default, swaps). */
  CL.applyModelEverywhere = async (model) => {
    model = CL.cleanModel(model);
    if (!model) { CL.toast('Спочатку обери модель', 'bad'); return false; }
    await api.post('/routing/apply-all', { model });
    await CL.loadStatus();
    CL.toast(CL.t('Модель {m} тепер основна ✓', { m: model }));
    return true;
  };

  /** Human hint for an error log entry (what to do). */
  CL.errorHint = (e) => {
    const m = String(e.message || '').toLowerCase();
    if (e.kind === 'gateway' && e.status === 503) return CL.t('Шлюз на паузі — натисни «Запустити».');
    if (m.includes('blacklist')) return CL.t('Модель у чорному списку (Налаштування → Моделі).');
    if (e.kind === 'auto') return CL.t('CarteLink виправив це сам. Повернути модель можна на сторінці «Акаунти».');
    if (m.includes('invalid_model_id')) return CL.t('Акаунт не має доступу до цієї моделі (тариф) — CarteLink сховав її для цього типу акаунтів.');
    if (m.includes('api_key_disabled')) return CL.t('Цей API-ключ вимкнено на сторінці «API-ключі».');
    if (e.status === 401) return CL.t('Ключ у програмі не збігається з ключем CarteLink — скопіюй ключ з Огляду.');
    if (e.status === 403 && m.includes('model_not_allowed')) return CL.t('Цьому API-ключу ця модель не дозволена — додай її на сторінці «API-ключі».');
    if (e.status === 429 || m.includes('quota') || m.includes('rate')) return CL.t('Ліміт акаунта: зачекай, додай ще акаунтів або скинь ліміт на сторінці «Акаунти».');
    if (m.includes('content_filter') || m.includes('content filter')) return CL.t('Фільтр провайдера відхилив вміст запиту (часто через AGENTS.md чи системний промпт). Ключ лишається робочим.');
    if (m.includes('auth_unavailable') && m.includes('last upstream error')) return CL.t('Акаунт на короткій паузі після попередньої помилки — справжня причина в рядку нижче.');
    if (/unknown provider|not found|not supported|no auth|unavailable/.test(m)) return CL.t('Цієї моделі немає у підключених акаунтах — обери іншу на сторінці «Моделі».');
    if (e.status === 400) return CL.t('Провайдер відхилив запит (формат або параметри) — спробуй іншу модель.');
    if (e.status >= 500) return CL.t('Збій на боці провайдера або мережі — зазвичай минає сам.');
    return '';
  };

  // -------------------------------------------------------------- pages --

  CL.pages = [];
  CL.pageMap = {};
  /**
   * Register a page.
   * CL.page('home', {
   *   title: 'Огляд', icon: 'home', group: 'gateway'|'manage', order: 10,
   *   render(root, ctx)  — fill `root` (a fresh div); may be async.
   *                        ctx.every(ms, fn) — interval cleared when leaving;
   *                        ctx.on(ev, fn)    — CL.on cleared when leaving;
   *                        ctx.alive()       — false once the user left the page.
   *   badge()            — optional: {text, kind:'soft'|''} | null for the nav.
   * })
   * Layout: put blocks in <div class="blocks" data-area="<page>"> with children
   * <section class="block card" data-block="<stable id>" data-w="6" data-title="Назва">.
   * Call CL.look.applyLayout(root) after rendering blocks — the user can then
   * move, resize and hide them in edit mode.
   */
  CL.page = (id, def) => {
    def.id = id;
    CL.pages.push(def);
    CL.pageMap[id] = def;
  };
})();
