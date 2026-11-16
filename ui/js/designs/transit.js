'use strict';
// Нічна схема метро — a midnight transit diagram. Programs are stations on
// the left, every provider is a coloured line, models are terminal stations
// and the active model is the big interchange. The newest request runs as a
// train along its line. Accounts are stations on their provider's line in
// the «Лінії» legend: on time, delays or closed.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  // --------------------------------------------------------------- lines --
  const KNOWN = {
    claude: ['#ff7a1a', 'Cl'], codex: ['#19b45f', 'Cx'], antigravity: ['#2f7cf6', 'Ag'], 'gemini-cli': ['#00b5c8', 'GC'],
    gemini: ['#5b6bff', 'Ge'], vertex: ['#00a39a', 'Vx'], kiro: ['#a160f0', 'Ki'], xai: ['#e8352c', 'xA'], kimi: ['#f0569b', 'Km'],
    qwen: ['#7a5cff', 'Qw'], workbuddy: ['#ffcd00', 'WB'], devin: ['#b5773a', 'Dv'], meta: ['#3d8bff', 'Me'], other: ['#8a96b4', '—'],
  };
  const SPARE = ['#e8352c', '#ffcd00', '#f0569b', '#b5773a', '#8fd400', '#00b5c8', '#ff9f1c', '#c77dff'];
  const hash = (s) => Array.from(String(s)).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const lineOf = (p) => {
    p = String(p || 'other').toLowerCase();
    const k = KNOWN[p];
    const color = k ? k[0] : SPARE[hash(p) % SPARE.length];
    const code = k ? k[1] : (CL.provTitle(p).replace(/[^A-Za-z0-9]/g, '') || p).slice(0, 2);
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    const ink = 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0a0f1e' : '#ffffff';
    return { id: p, color, code, ink, title: p === 'other' ? t('Інше') : CL.provTitle(p) };
  };
  const badge = (p, cls) => { const l = lineOf(p); return '<span class="tr-badge' + (cls ? ' ' + cls : '') + '" style="--c:' + l.color + ';--ink:' + l.ink + '" title="' + esc(l.title) + '">' + esc(l.code) + '</span>'; };
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '');

  // Which provider (line) a model runs on: history rows, the catalogue, a guess.
  let catalog = null;
  const seenProv = {};
  const loadCatalog = (then) => CL.models().then((c) => { catalog = c; then(); }).catch(() => {});
  const provOf = (model) => {
    if (!model) return 'other';
    if (seenProv[model]) return seenProv[model];
    if (catalog && catalog.byProv) for (const p of Object.keys(catalog.byProv)) if (catalog.byProv[p].includes(model)) return p;
    const m = model.toLowerCase();
    if (/claude|opus|sonnet|haiku/.test(m)) return 'claude';
    if (/gpt|codex|^o\d/.test(m)) return 'codex';
    if (/gemini/.test(m)) return 'antigravity';
    if (/grok/.test(m)) return 'xai';
    if (/kimi/.test(m)) return 'kimi';
    if (/qwen/.test(m)) return 'qwen';
    return 'other';
  };
  const learn = () => CL.data.feed.forEach((r) => { if (r.provider && r.model && !seenProv[served(r)]) seenProv[served(r)] = r.provider; });

  // ---------------------------------------------------------------- map --
  const W = 1040;
  const APP_X = 220;
  const HUB_X = 450;
  const MOD_X = 735;
  const ROW = 50;
  const SLOT = 13;
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  /** Orthogonal + 45° path from (x1,y1) to (x2,y2), bending near `near`. */
  const metro = (x1, y1, x2, y2, bendAtStart) => {
    const dy = Math.abs(y2 - y1);
    if (dy < 0.5) return 'M' + x1 + ' ' + y1 + ' H' + x2;
    if (bendAtStart) { const xb = x1 + 26; return 'M' + x1 + ' ' + y1 + ' H' + xb + ' L' + (xb + dy) + ' ' + y2 + ' H' + x2; }
    const xe = x2 - 26;
    return 'M' + x1 + ' ' + y1 + ' H' + (xe - dy) + ' L' + xe + ' ' + y2 + ' H' + x2;
  };

  function layout() {
    learn();
    const r = CL.data.route();
    const main = CL.mainModel();
    const apps = r.apps.slice(0, 6);
    let models = r.models.slice(0, 7).map((m) => Object.assign({ prov: provOf(m.name) }, m));
    if (main && !models.some((m) => m.name === main)) models = models.slice(0, 6).concat([{ name: main, n: 0, fail: 0, prov: provOf(main) }]);
    // keep a line's stations together, busiest line first
    const weight = {};
    models.forEach((m) => (weight[m.prov] = (weight[m.prov] || 0) + m.n));
    models.sort((a, b) => (weight[b.prov] - weight[a.prov]) || a.prov.localeCompare(b.prov) || b.n - a.n);
    return { apps, models, main, total: r.total };
  }

  function mapSvg(L, base) {
    const nL = Math.max(L.apps.length, 1);
    const nR = Math.max(L.models.length, 1);
    const n = Math.max(nL, nR, 3);
    const Hh = n * ROW + 92;
    const cy = 50 + (n * ROW) / 2 - 10;
    const max = Math.max(1, ...L.apps.map((a) => a.n), ...L.models.map((m) => m.n));
    const hubH = Math.max(nL, nR) * SLOT + 24;
    const ay = (i) => cy + (i - (L.apps.length - 1) / 2) * ROW;
    const my = (i) => cy + (i - (L.models.length - 1) / 2) * ROW;
    const ls = (i) => cy + (i - (L.apps.length - 1) / 2) * SLOT;
    const rs = (i) => cy + (i - (L.models.length - 1) / 2) * SLOT;
    const width = (k) => (5 + (k / max) * 6).toFixed(1);
    let lines = '';
    let stations = '';
    L.apps.forEach((a, i) => {
      const y = ay(i);
      lines += '<path id="tr-a' + i + '" class="tr-feed" style="stroke-width:' + width(a.n) + '" d="' + metro(APP_X, y, HUB_X - 17, ls(i)) + '"/>';
      stations += '<g class="tr-st' + (a.fail ? ' fail' : '') + '"><title>' + esc(t('{ok} успішних / {bad} помилок', { ok: a.n - a.fail, bad: a.fail })) + '</title><circle cx="' + APP_X + '" cy="' + y + '" r="8"/>' +
        '<text class="tr-lbl" x="' + (APP_X - 18) + '" y="' + (y + 5) + '" text-anchor="end">' + esc(cut(a.name, 22)) + '</text>' +
        '<text class="tr-cnt" x="' + (APP_X - 18) + '" y="' + (y + 21) + '" text-anchor="end">' + a.n + (a.fail ? ' · ×' + a.fail : '') + '</text></g>';
    });
    L.models.forEach((m, i) => {
      const y = my(i);
      const l = lineOf(m.prov);
      const on = m.name === L.main;
      lines += '<path id="tr-m' + i + '" class="tr-line' + (m.n ? '' : ' plan') + '" style="stroke:' + l.color + ';stroke-width:' + width(m.n || max * 0.3) + '" d="' + metro(HUB_X + 17, rs(i), MOD_X, y, true) + '"/>';
      stations += '<g class="tr-term' + (on ? ' on' : '') + (m.fail ? ' fail' : '') + '" data-i="' + i + '" style="--c:' + l.color + '"><title>' + esc(l.title + ' · ' + t('{ok} успішних / {bad} помилок', { ok: m.n - m.fail, bad: m.fail })) + '</title>' +
        (on ? '<circle class="tr-ring" cx="' + MOD_X + '" cy="' + y + '" r="19"/><circle class="tr-ix" cx="' + MOD_X + '" cy="' + y + '" r="12"/>' : '<rect class="tr-end" x="' + (MOD_X - 3) + '" y="' + (y - 12) + '" width="6" height="24" rx="2"/><circle cx="' + MOD_X + '" cy="' + y + '" r="7"/>') +
        '<g transform="translate(' + (MOD_X + (on ? 32 : 22)) + ' ' + y + ')"><rect class="tr-code" x="0" y="-10" width="26" height="20" rx="10"/><text class="tr-codet" x="13" y="4.5" text-anchor="middle" style="fill:' + l.ink + '">' + esc(l.code) + '</text>' +
        '<text class="tr-lbl' + (on ? ' big' : '') + '" x="34" y="5">' + esc(cut(m.name, on ? 22 : 27)) + '</text>' +
        '<text class="tr-cnt" x="34" y="' + (on ? 23 : 21) + '">' + (on ? esc(t('зараз')) + ' · ' : '') + m.n + (m.fail ? ' · ×' + m.fail : '') + '</text></g></g>';
    });
    const hub = '<g class="tr-hub"><rect x="' + (HUB_X - 17) + '" y="' + (cy - hubH / 2) + '" width="34" height="' + hubH + '" rx="17"/>' +
      '<text class="tr-lbl big" x="' + HUB_X + '" y="' + (cy + hubH / 2 + 26) + '" text-anchor="middle">CarteLink</text>' +
      '<text class="tr-cnt" x="' + HUB_X + '" y="' + (cy + hubH / 2 + 43) + '" text-anchor="middle">' + esc(base || '') + '</text></g>';
    const heads = '<text class="tr-head" x="' + (APP_X - 18) + '" y="22" text-anchor="end">' + esc(t('Програма')) + '</text><text class="tr-head" x="' + (MOD_X + 22) + '" y="22">' + esc(t('Модель')) + '</text>';
    const none = L.apps.length ? '' : '<text class="tr-cnt" x="' + (APP_X - 18) + '" y="' + (cy + 5) + '" text-anchor="end">' + esc(t('Запитів ще не було')) + '</text>';
    return '<svg class="tr-svg" viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="xMidYMin meet" role="img" aria-label="' + esc(t('Схема ліній')) + '">' + heads + '<g class="tr-lines">' + lines + '</g>' + hub + stations + none + '<g class="tr-trains"></g></svg>';
  }

  // ---------------------------------------------------------------- hero --
  function hero(el, ctx) {
    el.innerHTML =
      '<div class="tr-sign"><span class="tr-sign-badge"></span><div class="tr-sign-t"><small>' + esc(t('відповідає зараз на всі запити')) + '</small><h2 class="nowmodel tr-model"></h2></div>' +
      '<div class="tr-sign-act"><div class="tr-pick"></div><button class="btn primary tr-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button></div></div>' +
      '<div class="tr-map"></div>' +
      '<div class="tr-foot"><span class="tr-state"><span class="dot"></span><b></b></span><span class="tr-today"></span></div>';
    const picker = CL.ui.modelPicker(el.querySelector('.tr-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    const map = el.querySelector('.tr-map');
    let last = CL.mainModel();
    let sig = '';
    let lastT = 0;
    let L = null;
    let lastBadge = '';

    const train = () => {
      const r = CL.data.feed[0];
      if (!r || !L || r.t === lastT) return;
      lastT = r.t;
      const ai = L.apps.findIndex((a) => a.name === (r.app || t('Інше')));
      const mi = L.models.findIndex((m) => m.name === (served(r) || r.model));
      const g = map.querySelector('.tr-trains');
      if (!g || document.body.classList.contains('motion-off')) return;
      const a = ai >= 0 && map.querySelector('#tr-a' + ai);
      const m = mi >= 0 && map.querySelector('#tr-m' + mi);
      g.innerHTML = (a ? '<path class="tr-train a' + (r.ok ? '' : ' bad') + '" pathLength="100" d="' + a.getAttribute('d') + '"/>' : '') +
        (m ? '<path class="tr-train b' + (r.ok ? '' : ' bad') + '" pathLength="100" d="' + m.getAttribute('d') + '"/>' : '');
      map.querySelectorAll('.tr-term.arr').forEach((x) => x.classList.remove('arr'));
      const term = mi >= 0 && map.querySelector('.tr-term[data-i="' + mi + '"]');
      if (term) { void term.getBoundingClientRect(); term.classList.add('arr'); }
    };

    const paint = () => {
      L = layout();
      const ep = CL.data.get('endpoints');
      const base = ep ? ep.base.replace(/^https?:\/\//, '') : '';
      const s = JSON.stringify([L.apps.map((a) => a.name + a.n + a.fail), L.models.map((m) => m.name + m.n + m.fail + m.prov), L.main, base]);
      if (s !== sig) { sig = s; map.innerHTML = mapSvg(L, base); }
      train();
    };

    const sign = () => {
      const st = CL.status;
      if (!st) return;
      const m = st.mainModel || '';
      K.rollTo(el.querySelector('.tr-model'), m || t('Модель не обрано'));
      const bp = m ? provOf(m) : 'other';
      if (bp !== lastBadge) { lastBadge = bp; el.querySelector('.tr-sign-badge').outerHTML = badge(bp, 'tr-sign-badge big'); }
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); paint(); }
      const e = st.engine || {};
      const up = e.engineUp && !e.paused;
      el.querySelector('.tr-state').className = 'tr-state ' + (up ? 'ok' : 'warn');
      el.querySelector('.tr-state .dot').className = 'dot ' + (up ? 'ok' : 'warn');
      el.querySelector('.tr-state b').textContent = t(e.restarting ? 'перезапуск' : e.paused ? 'пауза' : e.engineUp ? 'працює' : 'запуск…');
      const met = CL.data.get('metrics');
      if (met) el.querySelector('.tr-today').textContent = t('{n} запитів за 24 год', { n: CL.fmtInt(K.series(met, 24).reduce((a, x) => a + x.ok + x.failed, 0)) });
    };

    ctx.on('status', sign);
    CL.data.watch(['metrics', 'feed', 'endpoints'], () => { paint(); sign(); }, ctx);
    loadCatalog(() => { sig = ''; lastBadge = ''; paint(); sign(); });
    sign();
    paint();
    el.querySelector('.tr-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
  }

  // ------------------------------------------------------------- legend --
  function lines(el, ctx) {
    el.innerHTML = K.head('Лінії', K.goto('accounts', 'Усі акаунти')) + '<div class="tr-lines-list"></div>';
    K.onGoto(el);
    const box = el.querySelector('.tr-lines-list');
    let sig = '';
    const paint = () => {
      const data = CL.data.get('accounts');
      if (!data) return;
      const a = K.summary(data);
      const s = JSON.stringify(a.list.map((x) => x.provider + x.state + x.label));
      if (s === sig) return;
      sig = s;
      if (!a.total) {
        box.innerHTML = CL.ui.empty('users', 'Акаунтів ще немає', 'Почни зі звичайного Google-акаунта (Gemini-Antigravity) — це безкоштовно.', '<button class="btn primary sm" data-goto="accounts">' + ic('plus', 'sm') + esc(t('Додати акаунт')) + '</button>');
        return;
      }
      box.innerHTML = K.byProvider(a.list).map((p) => {
        const l = lineOf(p.provider);
        const live = p.list.filter((x) => x.state !== 'disabled').length;
        const st = p.ok === live && live ? 'ok' : p.ok ? 'warn' : 'bad';
        const word = st === 'ok' ? t('вчасно') : st === 'warn' ? t('із затримками') : t('закрито');
        const stops = p.list.slice(0, 14).map((x) => '<i class="' + esc(x.state) + '" data-tip="' + esc(x.label + ' · ' + x.state) + '"></i>').join('');
        return '<div class="tr-row" style="--c:' + l.color + '">' + badge(p.provider) + '<div class="tr-row-m"><b class="ellipsis">' + esc(l.title) + '</b><span class="tr-track">' + stops + '</span></div>' +
          '<span class="tr-svc ' + st + '">' + ic(st === 'ok' ? 'check' : st === 'warn' ? 'clock' : 'ban', 'sm') + esc(word) + '</span><span class="tr-frac num">' + p.ok + '/' + p.list.length + '</span></div>';
      }).join('');
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  // -------------------------------------------------------------- board --
  function board(el, ctx) {
    el.innerHTML = K.head('Табло прибуття', '<span class="sub tr-board-n"></span>') + '<div class="tr-board"></div>';
    const box = el.querySelector('.tr-board');
    let sig = '';
    const paint = () => {
      learn();
      const rows = CL.data.feed.slice(0, 8);
      const s = rows.map((r) => r.t + '' + r.status).join('|') + (catalog ? 1 : 0);
      if (s === sig) return;
      sig = s;
      if (!rows.length) { box.innerHTML = CL.ui.empty('radio', 'Тиша в ефірі', 'Щойно програма надішле запит, він з’явиться тут миттєво.'); return; }
      box.innerHTML = rows.map((r, i) => {
        const m = served(r) || r.path || '';
        return '<div class="tr-brow' + (i === 0 ? ' first' : '') + (r.ok ? '' : ' bad') + '"><span class="tr-time num">' + CL.fmtTime(r.t) + '</span>' + badge(provOf(m)) +
          '<span class="tr-dest ellipsis"><b>' + esc(m) + '</b><span>' + esc(r.app || t('невідома')) + '</span></span>' +
          '<span class="tr-bst">' + esc(r.ok ? t('прибув') : t('збій {s}', { s: r.status })) + '</span><span class="tr-ms num">' + (r.ms ? CL.fmtMs(r.ms) : '') + '</span></div>';
      }).join('');
      el.querySelector('.tr-board-n').textContent = t('останні {n}', { n: rows.length });
    };
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  }

  // ----------------------------------------------------------------- fx --
  // Ghost lines of a night map; once in a while a train crosses one of them.
  function fx(host, still) {
    const P = [
      'M-40 760 H420 L620 560 H1180 L1380 360 H1700',
      'M-40 220 H260 L520 480 H980 L1240 740 H1700',
      'M760 -40 V300 L960 500 V1100',
      'M-40 420 H140 L340 620 V1100',
    ];
    host.innerHTML = '<svg class="tr-fx" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">' +
      P.map((d, i) => '<path class="g g' + i + '" d="' + d + '"/>').join('') + '<path class="run" pathLength="100" d="' + P[0] + '"/></svg>';
    if (still) return null;
    const run = host.querySelector('.run');
    let k = 0;
    const go = () => {
      if (document.hidden) return;
      run.setAttribute('d', P[k++ % P.length]);
      run.classList.remove('on');
      void run.getBoundingClientRect();
      run.classList.add('on');
    };
    const first = setTimeout(go, 1500);
    const h = setInterval(go, 22000);
    return () => { clearTimeout(first); clearInterval(h); };
  }

  CL.design({
    id: 'transit',
    name: 'Нічна схема метро',
    desc: 'Нічна схема метро: програми — станції, провайдери — кольорові лінії, активна модель — пересадковий вузол.',
    mode: 'dark',
    shell: 'sidebar',
    sw: ['#070b18', '#0c1326', '#ffcd00', '#2f7cf6'],
    thumb: '<div class="th-tr"><svg viewBox="0 0 160 96"><path d="M8 30 H50 L70 50 H150" style="stroke:#2f7cf6"/><path d="M8 70 H40 L60 50 H110 L130 30 H150" style="stroke:#ff7a1a"/><path d="M90 6 V40 L100 50 V92" style="stroke:#19b45f"/>' +
      '<circle cx="70" cy="50" r="7" class="ix"/><circle cx="8" cy="30" r="4"/><circle cx="8" cy="70" r="4"/><circle cx="150" cy="50" r="4"/><circle cx="150" cy="30" r="4"/><circle cx="90" cy="6" r="4"/></svg></div>',
    home: [{ id: 'setup', w: 12 }, { id: 'hero', w: 12 }, { id: 'transitLines', w: 5 }, { id: 'transitBoard', w: 7 }, { id: 'gateway', w: 4 }, { id: 'activity', w: 8 }, { id: 'errors', w: 12 }],
    titles: { hero: 'Схема ліній', transitLines: 'Лінії', transitBoard: 'Табло прибуття' },
    viz: { hero },
    widgets: { transitLines: lines, transitBoard: board },
    fx,
  });
})();
