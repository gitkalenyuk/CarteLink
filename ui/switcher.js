'use strict';
// The floating model switcher: two presets, one click to apply either,
// a swap button and the one-shot auto switch (1 → 2 after the first good
// answer from model 1). Same /api as the main window; no shell, no sidebar.

(function () {
  const CL = window.CL;
  const { esc, t } = CL;
  const $ = (id) => document.getElementById(id);

  const THEMES = ['graphite', 'datamatics', 'departures', 'aurora', 'paper', 'synthwave', 'phosphor', 'nord', 'sunset', 'swiss'];

  // ------------------------------------------------------------- look --

  /** Apply the user's theme from their saved UI prefs (or a plain theme id). */
  function applyLook(P) {
    const root = document.documentElement;
    if (!P) return;
    const custom = P.theme === 'custom' ? P.custom || {} : null;
    const theme = custom ? custom.base || 'graphite' : P.theme;
    if (!THEMES.includes(theme)) return;
    for (let i = root.style.length - 1; i >= 0; i--) { const k = root.style[i]; if (k.startsWith('--')) root.style.removeProperty(k); }
    if (theme !== 'graphite') root.setAttribute('data-theme', theme); else root.removeAttribute('data-theme');
    if (custom) {
      const v = custom.vars || {};
      Object.keys(v).forEach((k) => { if (v[k]) root.style.setProperty(k, v[k]); });
      if (v['--accent']) root.style.setProperty('--accent-soft', 'color-mix(in srgb, ' + v['--accent'] + ' 14%, transparent)');
      if (custom.font) { root.style.setProperty('--font', custom.font); root.style.setProperty('--font-display', custom.font); }
      if (custom.radius != null) { root.style.setProperty('--radius', custom.radius + 'px'); root.style.setProperty('--radius-sm', Math.max(0, custom.radius - 3) + 'px'); root.style.setProperty('--radius-lg', custom.radius + 4 + 'px'); }
      if (custom.glass) { root.style.setProperty('--glass', 'blur(20px) saturate(1.3)'); root.style.setProperty('--surface-alpha', '0.6'); }
    }
    document.body.classList.toggle('motion-off', P.motion === 'off');
    document.body.classList.toggle('motion-force', P.motion === 'full-force');
    root.style.setProperty('--t', P.motion === 'reduced' ? '0.55' : '1');
  }

  let lookKey = '';
  async function loadLook(fallbackTheme) {
    try {
      const r = await CL.api.get('/ui-prefs');
      const P = r && r.prefs;
      if (P && Object.keys(P).length) {
        const k = JSON.stringify([P.theme, P.custom, P.motion]);
        if (k !== lookKey) { lookKey = k; applyLook(P); }
        return;
      }
    } catch (e) { /* keep what the head script applied */ }
    if (fallbackTheme && !lookKey) applyLook({ theme: fallbackTheme === 'console' ? 'graphite' : fallbackTheme });
  }
  // The main window saves cl.look on every theme change: follow it at once.
  window.addEventListener('storage', (e) => { if (e.key === 'cl.prefs' || e.key === 'cl.look') loadLook(); });

  // ------------------------------------------------------------ state --

  let S = null; // last GET /api/switcher
  let busy = false;
  let shown = null;

  const picker1 = CL.ui.modelPicker($('m1'), { value: '', empty: '— обери модель —', onChange: (v) => setModel(1, v) });
  const picker2 = CL.ui.modelPicker($('m2'), { value: '', empty: '— обери модель —', onChange: (v) => setModel(2, v) });

  function showNow(m) {
    if (m === shown) return;
    shown = m;
    const el = $('current');
    const text = m || t('не обрано');
    el.classList.remove('rolling');
    el.style.fontSize = (text.length <= 14 ? 20 : text.length <= 22 ? 16 : 14) + 'px';
    el.innerHTML = Array.from(text).map((c, i) => '<span class="ch" style="--k:' + i + '">' + (c === ' ' ? '&nbsp;' : esc(c)) + '</span>').join('');
    el.title = text;
    void el.offsetWidth;
    el.classList.add('rolling');
    el.classList.toggle('faint', !m);
  }

  function paint(st) {
    S = st;
    $('sw').classList.remove('off');
    $('sw').setAttribute('aria-busy', 'false');
    $('err').classList.add('hidden');
    $('dot').className = 'dot ok';
    showNow(st.current || '');
    [1, 2].forEach((n) => {
      const m = n === 1 ? st.model1 : st.model2;
      const slot = $('slot' + n);
      slot.classList.toggle('active', st.active === n && !!m);
      slot.classList.toggle('empty', !m);
      slot.querySelector('.sw-num').disabled = !m;
      const p = n === 1 ? picker1 : picker2;
      if (!document.querySelector('.mp-pop') && p.get() !== (m || '')) p.set(m || '');
    });
    $('swap').disabled = !(st.model1 && st.model2);
    $('auto').checked = !!st.autoSwitch;
    const armed = st.autoSwitch && st.autoArmed && st.active === 1 && !!st.model2;
    $('autoRow').classList.toggle('armed', !!armed);
    $('autoState').textContent = t(!st.autoSwitch ? 'вимкнено'
      : armed ? 'чекає на перший вдалий запит до моделі 1'
        : st.active === 1 ? 'уже спрацювало — поверни модель 1, щоб знову'
          : 'спрацює, коли буде активна модель 1');
  }

  function paintError(e) {
    $('sw').classList.add('off');
    $('dot').className = 'dot bad';
    $('err').classList.remove('hidden');
    const msg = (e && e.message) || '';
    $('errText').textContent = !msg || msg === t('CarteLink не відповідає') ? t('CarteLink не відповідає') : t('CarteLink не відповідає: {e}', { e: msg });
    shown = null;
    const el = $('current');
    el.classList.add('faint');
    el.textContent = '—';
  }

  async function refresh() {
    try { paint(await CL.api.get('/switcher')); } catch (e) { paintError(e); }
  }

  /** One action at a time; the answer is the new state. */
  async function act(fn, btn) {
    if (busy) return;
    busy = true;
    if (btn) { btn.classList.add('busy'); btn.disabled = true; }
    try {
      const st = await fn();
      if (st && typeof st === 'object' && 'model1' in st) paint(st);
      else await refresh();
    } catch (e) {
      CL.fail(e);
      await refresh();
    } finally {
      busy = false;
      if (btn) {
        btn.classList.remove('busy');
        btn.disabled = false;
        // Re-derive which buttons are usable (slot numbers, swap) from the state.
        if (S && !$('sw').classList.contains('off')) paint(S);
      }
    }
  }

  function setModel(n, v) {
    act(() => CL.api.put('/switcher', n === 1 ? { model1: v } : { model2: v }));
  }

  function switchTo(n, btn) {
    const m = S && (n === 1 ? S.model1 : S.model2);
    if (!m) return;
    if (S.active === n && S.current && CL.cleanModel(S.current).toLowerCase() === CL.cleanModel(m).toLowerCase()) return;
    act(async () => {
      const st = await CL.api.post('/switcher/switch', { to: n });
      CL.toast(t('Модель {m} тепер основна ✓', { m: st.current || m }));
      return st;
    }, btn);
  }

  // A click anywhere on a slot row (except its model picker) applies it.
  [1, 2].forEach((n) => {
    $('slot' + n).addEventListener('click', (e) => {
      if (e.target.closest('.mp')) return;
      switchTo(n, $('slot' + n).querySelector('.sw-num'));
    });
  });
  $('swap').addEventListener('click', (e) => act(async () => {
    const st = await CL.api.post('/switcher/switch', {});
    CL.toast(t('Модель {m} тепер основна ✓', { m: st.current }));
    return st;
  }, e.currentTarget));
  $('auto').addEventListener('change', (e) => act(() => CL.api.put('/switcher', { autoSwitch: e.target.checked })));
  $('openMain').addEventListener('click', () => CL.api.post('/app/show').catch(CL.fail));
  $('retry').addEventListener('click', (e) => act(refresh, e.currentTarget));

  // ------------------------------------------------------------- live --

  const refreshSoon = CL.debounce(() => { if (!busy) refresh(); }, 300);
  const lookSoon = CL.debounce(() => loadLook(), 500);
  function connect() {
    let es;
    try { es = new EventSource('/api/events'); } catch (e) { return; }
    es.onmessage = (m) => {
      let ev;
      try { ev = JSON.parse(m.data); } catch (e) { return; }
      if (ev.type !== 'changed') return;
      if (ev.what === 'config' || ev.what === 'status' || ev.what === 'all') { refreshSoon(); if (ev.what !== 'status') lookSoon(); }
      if (ev.what === 'accounts' || ev.what === 'engine') CL.models.invalidate();
    };
    es.onerror = () => { es.close(); setTimeout(connect, 3000); };
  }

  setInterval(() => { if (!document.hidden && !busy) refresh(); }, 2500);
  setInterval(() => { if (!document.hidden) CL.models(true).catch(() => {}); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refresh();
    CL.models(true).catch(() => {});
    loadLook();
  });

  // ------------------------------------------------------------ start --

  (async () => {
    let st = null;
    try { st = await CL.api.get('/switcher'); } catch (e) { paintError(e); }
    // Language: the app's saved one wins when this window has none yet.
    if (st && st.lang && st.lang !== LANG && I18N_LANGS.some((l) => l.code === st.lang)) {
      let stored = null;
      try { stored = localStorage.getItem('cl.lang'); } catch (e) { /* ignore */ }
      if (!stored) { try { localStorage.setItem('cl.lang', st.lang); location.reload(); return; } catch (e) { /* stay */ } }
    }
    await loadLook(st && st.theme);
    if (st) paint(st);
    connect();
  })();
})();
