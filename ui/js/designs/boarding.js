'use strict';
// Посадковий талон — airline paperwork. Off-white paper on a terminal-grey
// ground, a navy livery sidebar, DIN-style type (Bahnschrift). The hero is a
// boarding pass for the active model: program → model as IATA codes, flight,
// gate = provider, seat = account, a tear line, a stub and a PDF417-like
// barcode. The signature is the dark gate board of recent requests; accounts
// are drawn as a cabin seat map.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  // ------------------------------------------------------------- helpers --
  const words = (s) => String(s || '').match(/\p{L}+/gu) || [];
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const strip = (m) => String(m || '').replace(/^[a-z0-9-]+\//i, '');
  /** Program → 3-letter code: "Claude Code" → CCO, "Cursor" → CUR. */
  const appCode = (name) => {
    const w = words(name);
    if (!w.length) return '———';
    const c = w.length >= 3 ? w[0][0] + w[1][0] + w[2][0] : w.length === 2 ? w[0][0] + w[1].slice(0, 2) : w[0].slice(0, 3);
    return c.toUpperCase().padEnd(3, 'X');
  };
  /** Model → 3-letter code from its family: "gemini-2.5-pro" → GEM. */
  const modelCode = (m) => { const w = words(strip(m)); return w.length ? w[0].slice(0, 3).toUpperCase().padEnd(3, 'X') : '———'; };
  const flightNo = (m) => (m ? modelCode(m).slice(0, 2) + ' ' + (100 + (hash(m) % 900)) : '—');
  const gateOf = (m) => (m ? modelCode(m)[0] + ((hash(m + '#') % 38) + 1) : '—');
  const seatCode = (i) => Math.floor(i / 6) + 1 + 'ABCDEF'[i % 6];
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || (r && r.path) || '—');
  const engine = () => ((CL.status || {}).engine || {});
  const boardState = () => {
    const e = engine();
    if (e.restarting) return ['wait', t('перезапуск')];
    if (e.paused) return ['paused', t('посадку призупинено')];
    if (e.engineUp) return ['ok', t('посадка відкрита')];
    return ['wait', t('підготовка до посадки')];
  };
  const field = (cls, label) => '<div class="bp-f ' + cls + '"><span class="bp-lbl">' + esc(t(label)) + '</span><b class="ellipsis">—</b></div>';
  const head = (title, extra) => '<div class="bp-h"><span>' + esc(t(title)) + '</span><span class="grow"></span>' + (extra || '') + '</div>';

  /** PDF417-like barcode: start/stop guards around rows of seeded modules. */
  const barcode = (text, rows, cols) => {
    let seed = hash(text) || 1;
    const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    const W = cols + 16;
    let d = 'M0 0h4v' + rows + 'h-4zM5 0h1v' + rows + 'h-1zM7 0h1v' + rows + 'h-1z';
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) if (rnd() > 0.5) d += 'M' + (9 + x) + ' ' + y + 'h1v1h-1z';
    }
    const e = W - 6;
    d += 'M' + e + ' 0h1v' + rows + 'h-1zM' + (e + 2) + ' 0h4v' + rows + 'h-4z';
    return '<svg class="bp-code" viewBox="0 0 ' + W + ' ' + rows + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '"/></svg>';
  };

  // Which provider serves a model (from the model catalogue), cached.
  const provCache = Object.create(null);
  const providerOf = (m, done) => {
    if (!m) return '';
    if (m in provCache) return provCache[m];
    provCache[m] = '';
    CL.models().then((cat) => {
      const low = m.toLowerCase();
      const p = Object.keys(cat.byProv || {}).find((k) => cat.byProv[k].some((id) => String(id).toLowerCase() === low));
      provCache[m] = p || '';
      if (p) done();
    }).catch(() => {});
    return '';
  };

  // -------------------------------------------------- hero: the pass --
  function pass(el, ctx) {
    el.innerHTML =
      '<article class="bp-pass">' +
        '<div class="bp-main">' +
          '<div class="bp-band"><span class="bp-air">' + ic('send', 'sm') + 'CARTELINK</span><span class="bp-doc">' + esc(t('Посадковий талон')) + '</span><span class="grow"></span><span class="bp-state"><i></i><span></span></span></div>' +
          '<div class="bp-route">' +
            '<div class="bp-pt"><span class="bp-lbl">' + esc(t('Звідки')) + '</span><b class="bp-iata bp-from">———</b><span class="bp-city bp-app ellipsis">—</span></div>' +
            '<div class="bp-path"><i></i>' + ic('send') + '<i></i></div>' +
            '<div class="bp-pt bp-to"><span class="bp-lbl">' + esc(t('Куди')) + '</span><b class="bp-iata bp-dest">———</b><span class="bp-city bp-model ellipsis">—</span></div>' +
          '</div>' +
          '<div class="bp-fields">' + field('f-pax', 'Пасажир') + field('f-flt', 'Рейс') + field('f-gate', 'Вихід') + field('f-seat', 'Місце') + field('f-time', 'Час посадки') + '</div>' +
          '<div class="bp-change"><div class="bp-pick"></div><button class="btn primary bp-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button>' +
            '<button class="btn bp-test">' + ic('activity', 'sm') + esc(t('Перевірити')) + '</button></div>' +
        '</div>' +
        '<aside class="bp-stub">' +
          '<div class="bp-band s"><span>' + esc(t('Посадковий талон')) + '</span></div>' +
          '<div class="bp-stub-in">' +
            '<div class="bp-mini"><b class="bp-s-from">———</b>' + ic('arrow', 'sm') + '<b class="bp-s-dest">———</b></div>' +
            '<div class="bp-sf">' + field('s-flt', 'Рейс') + field('s-gate', 'Вихід') + field('s-seat', 'Місце') + '</div>' +
            '<div class="bp-bars"></div>' +
            '<button class="bp-addr" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '<span class="mono ellipsis">—</span></button>' +
          '</div>' +
        '</aside>' +
      '</article>';
    const q = (s) => el.querySelector(s);
    const setF = (cls, v, tip) => { const b = q('.' + cls + ' b'); b.textContent = v; if (tip) b.dataset.tip = tip; else delete b.dataset.tip; };
    const picker = CL.ui.modelPicker(q('.bp-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();
    let codeFor = null;
    const paint = () => {
      const s = CL.status || {};
      const m = s.mainModel || '';
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
      const [st, word] = boardState();
      q('.bp-state').className = 'bp-state ' + st;
      q('.bp-state span').textContent = word;

      const r = CL.data.route();
      const pax = r.apps.length ? r.apps[0].name : '';
      const dest = modelCode(m);
      q('.bp-from').textContent = pax ? appCode(pax) : '———';
      q('.bp-app').textContent = pax || t('очікуємо перший запит');
      q('.bp-dest').textContent = dest;
      q('.bp-model').textContent = m || t('Модель не обрано');
      q('.bp-s-from').textContent = pax ? appCode(pax) : '———';
      q('.bp-s-dest').textContent = dest;

      const prov = providerOf(m, paint);
      const acc = K.summary(CL.data.get('accounts'));
      const provList = prov ? acc.list.filter((a) => a.provider === prov) : [];
      const gate = gateOf(m);
      const gateTip = prov ? CL.provTitle(prov) : '';
      let seat = '—';
      let seatTip = '';
      const row = CL.data.feed.find((x) => x.account && (!prov || !x.provider || x.provider === prov));
      if (row) {
        const list = prov ? provList : acc.list.filter((a) => a.provider === row.provider);
        const i = list.findIndex((a) => a.authIndex === row.account);
        if (i >= 0) { seat = seatCode(i); seatTip = list[i].label; }
      }
      const last1 = CL.data.feed[0];
      setF('f-pax', pax || '—');
      setF('f-flt', flightNo(m), m);
      setF('f-gate', gate + (gateTip ? ' · ' + gateTip : ''), gateTip);
      setF('f-seat', seat, seatTip);
      setF('f-time', last1 ? CL.fmtTime(last1.t) : '—');
      setF('s-flt', flightNo(m), m);
      setF('s-gate', gate, gateTip);
      setF('s-seat', seat, seatTip);
      if (codeFor !== m) { codeFor = m; q('.bp-bars').innerHTML = barcode(m || 'cartelink', 12, 46); }
      const ep = CL.data.get('endpoints');
      if (ep) {
        q('.bp-addr span').textContent = ep.base + '/v1';
        q('.bp-addr').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
      }
    };
    ctx.on('status', paint);
    CL.data.watch(['metrics', 'feed', 'accounts', 'endpoints'], paint, ctx);
    paint();
    q('.bp-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    q('.bp-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const m = picker.get() || CL.mainModel();
      const r = await CL.api.post('/test-model', { model: m || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // ------------------------------------------------ the control tower --
  function tower(el, ctx) {
    el.innerHTML = head('Диспетчерська', '<span class="bp-clock mono"></span>') +
      '<div class="bp-sign"><i></i><b></b></div>' +
      '<div class="bp-stats">' +
        '<div><b class="bp-n1">0</b><span>' + esc(t('рейсів за добу')) + '</span></div>' +
        '<div><b class="bp-n2">—</b><span>' + esc(t('вчасно')) + '</span></div>' +
        '<div><b class="bp-n3">0</b><span>' + esc(t('скасовано')) + '</span></div>' +
      '</div>' +
      '<div class="bp-gw"><span class="bp-lbl">' + esc(t('Адреса')) + '</span><span class="mono ellipsis bp-base">—</span>' +
        '<button class="btn sm icon bp-copy" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '</button>' +
        '<button class="btn sm icon bp-key" data-tip="' + esc(t('Копіювати ключ')) + '">' + ic('key', 'sm') + '</button></div>' +
      '<div class="row bp-acts"><button class="btn sm bp-start">' + ic('play', 'sm') + esc(t('Запустити')) + '</button><button class="btn sm bp-pause">' + ic('pause', 'sm') + esc(t('Пауза')) + '</button><button class="btn sm bp-restart">' + ic('rotate', 'sm') + esc(t('Перезапустити')) + '</button></div>' +
      '<div class="hint bp-note"></div>';
    const q = (s) => el.querySelector(s);
    const paint = () => {
      const s = CL.status;
      if (s) {
        const e = s.engine || {};
        const [st, word] = boardState();
        q('.bp-sign').className = 'bp-sign ' + st;
        q('.bp-sign b').textContent = word;
        q('.bp-start').disabled = !!(e.engineUp && !e.paused);
        q('.bp-pause').disabled = !e.engineUp || !!e.paused;
        q('.bp-restart').disabled = !!e.restarting;
        q('.bp-note').textContent = e.lastError ? t('Остання помилка: {e}', { e: e.lastError }) : '';
      }
      const m = CL.data.get('metrics');
      if (m) {
        const b = K.series(m, 24);
        const ok = b.reduce((x, y) => x + y.ok, 0);
        const bad = b.reduce((x, y) => x + y.failed, 0);
        CL.ui.countTo(q('.bp-n1'), ok + bad, CL.fmtInt);
        q('.bp-n2').textContent = ok + bad ? Math.round((ok / (ok + bad)) * 100) + '%' : '—';
        CL.ui.countTo(q('.bp-n3'), bad, CL.fmtInt);
      }
      const ep = CL.data.get('endpoints');
      if (ep) {
        q('.bp-base').textContent = ep.base + '/v1';
        q('.bp-copy').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
        q('.bp-key').onclick = () => CL.copy(ep.requireKey ? ep.key : 'any', 'Ключ скопійовано');
      }
    };
    const clock = () => { q('.bp-clock').textContent = CL.fmtTime(Date.now()); };
    clock();
    ctx.every(1000, clock);
    ctx.on('status', paint);
    CL.data.watch(['metrics', 'endpoints'], paint, ctx);
    paint();
    const act = (kind) => (e) => CL.ui.busy(e.currentTarget, async () => {
      if (kind === 'stop' && !(await CL.confirm('Поставити шлюз на паузу? Програми отримуватимуть помилку, доки не натиснеш «Запустити».'))) return;
      const r = await CL.api.post('/server/' + kind);
      if (r.restarting) { CL.followRestart(r.host, r.port); return; }
      await CL.loadStatus();
    });
    q('.bp-start').addEventListener('click', act('start'));
    q('.bp-pause').addEventListener('click', act('stop'));
    q('.bp-restart').addEventListener('click', act('restart'));
  }

  // ---------------------------------------------- the gate board (feed) --
  function board(el, ctx) {
    const COLS = ['Час', 'Рейс', 'Напрямок', 'Пасажир', 'Вихід', 'Відповідь', 'Статус'];
    el.innerHTML = '<div class="bp-board">' +
      '<div class="bp-bhead">' + ic('send') + '<b>' + esc(t('Табло вильоту')) + '</b><span class="grow"></span><span class="bp-bclock"></span></div>' +
      '<div class="bp-grid bp-cols">' + COLS.map((c, i) => '<span class="c' + i + '">' + esc(t(c)) + '</span>').join('') + '</div>' +
      '<div class="bp-rows"></div></div>';
    const box = el.querySelector('.bp-rows');
    const status = (r) => {
      if (!r.ok) return ['x', t('Скасовано')];
      if (Date.now() - r.t < 15000) return ['b', t('Посадка')];
      if (r.ms >= 20000) return ['d', t('Затримка')];
      return ['g', t('Вилетів')];
    };
    const rowHtml = (r, i) => {
      const m = served(r);
      const [k, word] = status(r);
      return '<div class="bp-grid bp-row' + (i === 0 ? ' first' : '') + '" data-k="' + k + '">' +
        '<span class="c0">' + CL.fmtTime(r.t) + '</span>' +
        '<span class="c1">' + esc(flightNo(m)) + '</span>' +
        '<span class="c2 ellipsis" data-tip="' + esc((r.model || '') + (r.resolved ? ' → ' + m : '')) + '">' + esc(m) + '</span>' +
        '<span class="c3 ellipsis">' + esc(r.app || t('Інше')) + '</span>' +
        '<span class="c4">' + esc(gateOf(m)) + '</span>' +
        '<span class="c5">' + (r.ms ? CL.fmtMs(r.ms) : '—') + '</span>' +
        '<span class="c6"><em class="st-' + k + '" data-tip="' + esc(String(r.status)) + '">' + esc(word) + '</em></span></div>';
    };
    let shown = '';
    const paint = (force) => {
      const rows = CL.data.feed.slice(0, 9);
      const sig = rows.map((r) => r.t + '' + r.status + status(r)[0]).join('|');
      if (sig === shown && force !== true) return;
      const fresh = shown && rows[0] && !shown.startsWith(rows[0].t + '' + rows[0].status);
      shown = sig;
      box.classList.toggle('fresh', !!fresh);
      box.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<div class="bp-none">' + esc(t('Рейсів ще не було')) + '<span>' + esc(t('Щойно програма надішле запит, він з’явиться тут миттєво.')) + '</span></div>';
    };
    const clock = () => { el.querySelector('.bp-bclock').textContent = CL.fmtTime(Date.now()); };
    clock();
    ctx.every(1000, clock);
    ctx.every(5000, () => paint()); // "Посадка" turns into "Вилетів"
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  }

  // ------------------------------------------------- seat map (accounts) --
  function seats(el, ctx) {
    const STATE = { ok: 'активний', warn: 'близько до ліміту', limited: 'ліміт', error: 'помилка', invalid: 'вхід відхилено', disabled: 'вимкнено' };
    el.innerHTML = head('Карта місць', K.goto('accounts', 'Усі акаунти')) + '<div class="bp-seatbody">' + CL.ui.skeleton(3) + '</div>';
    K.onGoto(el);
    const body = el.querySelector('.bp-seatbody');
    let sig = '';
    const paint = () => {
      const data = CL.data.get('accounts');
      if (!data) return;
      const a = K.summary(data);
      const s = JSON.stringify(a.list.map((x) => [x.label, x.state]));
      if (s === sig) return;
      sig = s;
      if (!a.total) {
        body.innerHTML = CL.ui.empty('users', 'Акаунтів ще немає', 'Почни зі звичайного Google-акаунта (Gemini-Antigravity) — це безкоштовно.', '<button class="btn primary sm" data-goto="accounts">' + ic('plus', 'sm') + esc(t('Додати акаунт')) + '</button>');
        return;
      }
      const groups = K.byProvider(a.list);
      const cabin = groups.map((p) => {
        const list = p.list.slice(0, 60);
        const nrows = Math.ceil(list.length / 6);
        let cols = '';
        for (let r = 0; r < nrows; r++) {
          let col = '';
          for (let k = 0; k < 6; k++) {
            const i = r * 6 + k;
            const x = list[i];
            if (k === 3) col += '<span class="bp-aisle">' + (r + 1) + '</span>';
            col += x ? '<i class="seat s-' + esc(x.state) + '" data-tip="' + esc(seatCode(i) + ' · ' + x.label + ' · ' + t(STATE[x.state] || x.state)) + '"></i>' : '<i class="seat none"></i>';
          }
          cols += '<div class="bp-srow">' + col + '</div>';
        }
        return '<div class="bp-sect"><span class="bp-sname ellipsis">' + esc(CL.provTitle(p.provider)) + '</span><div class="bp-srows"><div class="bp-letters"><span>A</span><span>B</span><span>C</span><span></span><span>D</span><span>E</span><span>F</span></div>' + cols + '</div></div>';
      }).join('<span class="bp-galley"></span>');
      body.innerHTML = '<div class="bp-plane"><div class="bp-cabin">' + cabin + '</div></div>' +
        '<div class="bp-legend"><span><i class="seat s-ok"></i>' + esc(t('працює')) + '</span><span><i class="seat s-limited"></i>' + esc(t('ліміт')) + '</span><span><i class="seat s-error"></i>' + esc(t('не працює')) + '</span><span><i class="seat s-disabled"></i>' + esc(t('вимкнено')) + '</span></div>' +
        '<div class="bp-plist">' + groups.map((p) => '<div class="bp-pl"><b class="ellipsis">' + esc(CL.provTitle(p.provider)) + '</b><span class="mono">' + p.ok + '/' + p.list.length + '</span>' + CL.ui.stateChip(p.ok === p.list.length ? 'ok' : p.ok ? 'warn' : 'error') + '</div>').join('') + '</div>' +
        (a.dead ? '<div class="card-foot">' + ic('broom', 'sm') + '<span class="grow">' + esc(t('{n} акаунт(ів) не працюють', { n: a.dead })) + '</span><button class="btn sm" data-goto="accounts">' + esc(t('Прибрати')) + '</button></div>' : '');
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  // ------------------------------------------- background: flight arcs --
  function fx(host, still) {
    const arcs = ['M-40 700 Q 420 260 980 520', 'M300 980 Q 760 380 1640 300', 'M120 140 Q 700 40 1260 210', 'M900 960 Q 1180 620 1660 760'];
    host.innerHTML = '<svg class="bp-fx" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      arcs.map((d, i) => '<path id="bpArc' + i + '" d="' + d + '"/>').join('') +
      (still ? '' : '<g class="bp-fx-plane"><path d="M-7 -4 L9 0 L-7 4 L-4 0 Z"/><animateMotion dur="70s" repeatCount="indefinite" rotate="auto"><mpath href="#bpArc1"/></animateMotion></g>') +
      '</svg>';
    return () => { host.innerHTML = ''; };
  }

  CL.design({
    id: 'boarding',
    name: 'Посадковий талон',
    desc: 'Паперовий посадковий талон на активну модель, табло вильоту запитів і карта місць акаунтів.',
    mode: 'light',
    shell: 'sidebar',
    sw: ['#dfe4e8', '#fbf8f1', '#c8102e', '#0b2545'],
    thumb: '<div class="th-bp"><div class="m"><em></em><b>NOD</b><b>GEM</b><i></i></div><div class="s"><u></u></div><div class="g"><s></s><s></s><s></s></div></div>',
    home: [
      { id: 'setup', w: 12 }, { id: 'bpPass', w: 8 }, { id: 'bpTower', w: 4 },
      { id: 'bpBoard', w: 12 }, { id: 'bpSeats', w: 7 }, { id: 'activity', w: 5 }, { id: 'errors', w: 12 },
    ],
    titles: { bpPass: 'Посадковий талон', bpTower: 'Диспетчерська', bpBoard: 'Табло вильоту', bpSeats: 'Карта місць' },
    widgets: { bpPass: pass, bpTower: tower, bpBoard: board, bpSeats: seats },
    fx,
  });
})();
