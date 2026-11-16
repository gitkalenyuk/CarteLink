'use strict';
// The app shell: navigation, routing, the status pill, the command palette,
// edit mode, live updates and the boot sequence. Loaded last.

(function () {
  const CL = window.CL;
  const { esc, ic, t, $ } = CL;

  const GROUPS = [['gateway', 'Шлюз'], ['manage', 'Керування']];
  let current = null;
  let leaveFns = [];
  let renderGen = 0;

  // ---------------------------------------------------------------- nav --

  function navPages() {
    const P = CL.look.prefs();
    const order = (P.nav && P.nav.order) || [];
    const pos = (id) => { const i = order.indexOf(id); return i < 0 ? 1000 + (CL.pageMap[id].order || 0) : i; };
    return CL.pages.slice().sort((a, b) => pos(a.id) - pos(b.id) || (a.order || 0) - (b.order || 0));
  }

  function renderNav() {
    const P = CL.look.prefs();
    const hidden = (P.nav && P.nav.hidden) || [];
    const groupOf = (p) => ((P.nav && P.nav.groups) || {})[p.id] || p.group || 'manage';
    const editing = CL.look.editing();
    $('#nav').innerHTML = GROUPS.map(([g, title]) => '<div class="nav-group" data-group="' + g + '"><div class="nav-group-title">' + esc(t(title)) + '</div>' +
      navPages().filter((p) => groupOf(p) === g).map((p) => {
        const b = p.badge ? p.badge() : null;
        const off = hidden.includes(p.id);
        return '<button class="nav-item' + (p.id === current ? ' active' : '') + (off ? ' off' : '') + '" data-page="' + p.id + '"' + (editing ? ' draggable="true"' : '') + ' title="' + esc(t(p.title)) + '">' + ic(p.icon) +
          '<span class="nav-label">' + esc(t(p.title)) + '</span>' + (b ? '<span class="nav-badge ' + (b.kind || '') + '">' + esc(b.text) + '</span>' : '') +
          '<span class="nav-eye" data-eye="' + p.id + '" role="button" data-tip="' + esc(t(off ? 'Показати в меню' : 'Сховати з меню')) + '">' + ic(off ? 'eye' : 'eyeoff', 'sm') + '</span></button>';
      }).join('') + '</div>').join('');
  }
  CL.renderNav = renderNav;

  $('#nav').addEventListener('click', (e) => {
    const eye = e.target.closest('[data-eye]');
    if (eye) {
      e.stopPropagation();
      const P = CL.look.prefs();
      const id = eye.dataset.eye;
      const h = new Set(P.nav.hidden || []);
      if (h.has(id)) h.delete(id); else if (id !== 'settings') h.add(id);
      P.nav.hidden = Array.from(h);
      CL.look.save();
      renderNav();
      return;
    }
    const b = e.target.closest('.nav-item');
    if (b) go(b.dataset.page);
  });
  // Dropping a nav item into another group (look.js reorders; this keeps groups).
  document.addEventListener('drop', () => setTimeout(() => { if (CL.look.editing()) renderNav(); }, 0));

  // -------------------------------------------------------------- routing --

  function go(id, opts) {
    if (!CL.pageMap[id]) id = 'home';
    if (location.hash !== '#/' + id) history.replaceState(null, '', '#/' + id);
    try { localStorage.setItem('cl.page', id); } catch (e) { /* ignore */ }
    const swap = () => render(id);
    if (current && !(opts && opts.instant)) CL.transition(swap);
    else swap();
  }
  CL.go = go;

  function render(id) {
    leaveFns.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    leaveFns = [];
    if (CL.ui.closePops) CL.ui.closePops();
    current = id;
    const gen = ++renderGen;
    const page = CL.pageMap[id];
    $('#pageTitle').textContent = t(page.title);
    document.title = 'CarteLink — ' + t(page.title);
    renderNav();
    const inner = $('#viewInner');
    inner.classList.remove('enter');
    inner.innerHTML = '';
    const root = document.createElement('div');
    inner.appendChild(root);
    $('#view').scrollTop = 0;
    void inner.offsetWidth;
    inner.classList.add('enter');
    const mine = leaveFns;
    const keep = (fn) => { if (gen === renderGen) mine.push(fn); else { try { fn(); } catch (e) { /* ignore */ } } };
    const ctx = {
      alive: () => gen === renderGen,
      every: (ms, fn) => { const h = setInterval(() => { if (!document.hidden && gen === renderGen) fn(); }, ms); keep(() => clearInterval(h)); return h; },
      on: (ev, fn) => { const off = CL.on(ev, fn); keep(off); return off; },
      leave: (fn) => keep(fn),
    };
    Promise.resolve()
      .then(() => page.render(root, ctx))
      .then(() => { if (ctx.alive()) { CL.look.applyLayout(root); if (CL.look.editing()) CL.look.toggleEdit(true); } })
      .catch((e) => { console.error(e); root.innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Сторінка не відкрилась: {e}', { e: e.message })) + '</div></div>'; });
  }

  CL.shell = { rerender: () => render(current), current: () => current };
  window.addEventListener('hashchange', () => { const id = location.hash.replace(/^#\/?/, ''); if (id && id !== current) go(id, { instant: true }); });

  // ---------------------------------------------------------- status pill --

  function paintStatus(st) {
    const e = (st && st.engine) || {};
    const dot = $('#statusDot');
    const txt = $('#statusText');
    if (!st) { dot.className = 'dot bad'; txt.textContent = t('CarteLink не відповідає'); return; }
    if (e.restarting) { dot.className = 'dot warn'; txt.textContent = t('перезапуск…'); }
    else if (e.paused) { dot.className = 'dot warn'; txt.textContent = t('пауза'); }
    else if (!e.engineUp) { dot.className = 'dot warn'; txt.textContent = e.lastError ? t('рушій: помилка') : t('рушій запускається…'); }
    else { dot.className = 'dot ok'; txt.textContent = t('працює :{port}', { port: e.port }); }
    $('#sideVersion').textContent = 'v' + (st.version || '3');
    renderNavBadges();
  }
  let badgeSig = '';
  function renderNavBadges() {
    const sig = CL.pages.map((p) => JSON.stringify(p.badge ? p.badge() : null)).join('|');
    if (sig === badgeSig) return;
    badgeSig = sig;
    if (document.querySelector('#nav .nav-item') && !CL.look.editing()) renderNav();
  }
  CL.on('status', paintStatus);
  $('#statusPill').addEventListener('click', () => go('home'));

  async function pollStatus() {
    try { await CL.loadStatus(); } catch (e) { paintStatus(null); }
  }
  setInterval(() => { if (!document.hidden) pollStatus(); }, 5000);
  CL.on('changed', (what) => { if (what === 'status' || what === 'config') pollStatus(); });

  /** After a restart the gateway may come back on another port: follow it. */
  CL.followRestart = async (host, port) => {
    const next = (host && host !== '0.0.0.0' ? host : '127.0.0.1') + ':' + port;
    const base = location.protocol + '//' + next;
    CL.toast('Перезапуск…', 'info');
    await CL.sleep(1200);
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(base + '/api/alive', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j.running && !j.restarting) {
            if (next !== location.host) { location.href = base + '/ui/' + location.hash; return; }
            CL.toast('Працює ✓');
            pollStatus();
            CL.shell.rerender();
            return;
          }
        }
      } catch (e) { /* not up yet */ }
      await CL.sleep(600);
    }
    CL.toast('Рушій не відповів за 45 с — подивись журнал (Налаштування → Діагностика).', 'bad');
  };

  // ------------------------------------------------------- command palette --

  async function commands() {
    const list = navPages().map((p) => ({ label: t(p.title), hint: t('Сторінка'), icon: p.icon, run: () => go(p.id) }));
    list.push({ label: t('Налаштувати вигляд (перетягнути блоки)'), hint: t('Дія'), icon: 'layout', run: () => CL.look.toggleEdit(true) });
    list.push({ label: t('Свій дизайн — редактор теми'), hint: t('Дія'), icon: 'palette', run: () => CL.look.openEditor() });
    CL.look.THEMES.forEach((th) => list.push({ label: t('Тема: {n}', { n: t(th.name) }), hint: t('Дизайн'), icon: 'palette', run: () => CL.look.setTheme(th.id) }));
    list.push({ label: t('Перезапустити шлюз'), hint: t('Дія'), icon: 'rotate', run: async () => { const r = await CL.api.post('/server/restart'); CL.followRestart(r.host, r.port); } });
    list.push({ label: t('Копіювати API-ключ'), hint: t('Дія'), icon: 'key', run: async () => { const ep = await CL.loadEndpoints(); CL.copy(ep.key, 'Ключ скопійовано'); } });
    list.push({ label: t('Копіювати адресу шлюзу'), hint: t('Дія'), icon: 'link', run: async () => { const ep = await CL.loadEndpoints(); CL.copy(ep.base, 'Адресу скопійовано'); } });
    try {
      const cat = await CL.models();
      cat.flat.slice(0, 400).forEach((m) => list.push({ label: m, hint: t('Зробити основною моделлю'), icon: 'swap', run: () => CL.applyModelEverywhere(m) }));
    } catch (e) { /* engine offline */ }
    return list;
  }

  let paletteOpen = false;
  async function openPalette() {
    if (paletteOpen) return;
    paletteOpen = true;
    let all;
    try { all = await commands(); } catch (e) { paletteOpen = false; return; }
    CL.dialog({
      html: '<div class="cmdk"><input placeholder="' + esc(t('Сторінка, дія, модель…')) + '"><div class="cmdk-list"></div></div>',
      actions: [],
      onMount: (d, close) => {
        d.classList.add('cmdk');
        d.style.padding = '0';
        const input = d.querySelector('input');
        const box = d.querySelector('.cmdk-list');
        let hl = 0;
        let shown = [];
        const paint = () => {
          const q = input.value.trim().toLowerCase();
          shown = all.filter((c) => !q || c.label.toLowerCase().includes(q)).slice(0, 60);
          hl = Math.min(hl, Math.max(0, shown.length - 1));
          box.innerHTML = shown.map((c, i) => '<div class="cmdk-item' + (i === hl ? ' hl' : '') + '" data-i="' + i + '">' + ic(c.icon) + '<span class="ellipsis">' + esc(c.label) + '</span><span class="r">' + esc(c.hint) + '</span></div>').join('') ||
            '<div class="mp-none">' + esc(t('Нічого не знайдено')) + '</div>';
        };
        const run = (i) => { const c = shown[i]; if (!c) return; close(); Promise.resolve(c.run()).catch(CL.fail); };
        input.addEventListener('input', () => { hl = 0; paint(); });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            hl = Math.max(0, Math.min(shown.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1)));
            paint();
            const el = box.querySelector('.hl');
            if (el) el.scrollIntoView({ block: 'nearest' });
          } else if (e.key === 'Enter') { e.preventDefault(); run(hl); }
        });
        box.addEventListener('click', (e) => { const it = e.target.closest('[data-i]'); if (it) run(Number(it.dataset.i)); });
        paint();
      },
    }).finally(() => { paletteOpen = false; });
  }
  $('#cmdkBtn').addEventListener('click', openPalette);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    if (e.key === 'Escape' && CL.look.editing() && !$('.dlg-back')) CL.look.toggleEdit(false);
  });

  // ------------------------------------------------------- top bar buttons --

  $('#editBtn').addEventListener('click', () => { CL.look.toggleEdit(); renderNav(); });
  CL.on('editmode', () => renderNav());
  $('#navCompact').addEventListener('click', () => { const P = CL.look.prefs(); CL.look.set({ navCompact: !P.navCompact }); });
  const mq = matchMedia('(max-width: 760px)');
  const syncMobile = () => $('#navToggle').classList.toggle('hidden', !mq.matches);
  mq.addEventListener('change', syncMobile);
  syncMobile();
  $('#navToggle').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#nav').addEventListener('click', () => document.body.classList.remove('nav-open'));

  // ------------------------------------------------------------------ boot --

  async function boot() {
    const t0 = performance.now();
    await CL.look.load();
    // Language: the app's saved one wins when this origin has none yet.
    try {
      const s = await CL.api.get('/app/settings');
      let stored = null;
      try { stored = localStorage.getItem('cl.lang'); } catch (e) { /* ignore */ }
      if (!stored && s.lang && s.lang !== LANG && I18N_LANGS.some((l) => l.code === s.lang)) { setLang(s.lang); return; }
    } catch (e) { /* offline */ }
    await pollStatus();
    CL.connectLive();
    let start = location.hash.replace(/^#\/?/, '');
    if (!start) { try { start = localStorage.getItem('cl.page') || 'home'; } catch (e) { start = 'home'; } }
    render(CL.pageMap[start] ? start : 'home');
    const wait = Math.max(0, 600 - (performance.now() - t0));
    setTimeout(() => document.body.classList.add('ready'), wait);
  }
  boot();
})();
