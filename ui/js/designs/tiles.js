'use strict';
// Metro-плитки — the Modern UI tile language. Black ground, flat solid tiles
// in a tight grid, no borders, no shadows, no rounding; huge light lowercase
// type. The hero is a wide live tile that slides between the model, today's
// requests and the working accounts; small tiles flip to show their reverse.
// Accounts are a people-hub mosaic, the feed is a wall of request tiles.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  // ------------------------------------------------------------- helpers --
  const calm = () => document.body.classList.contains('motion-off') ||
    (matchMedia('(prefers-reduced-motion: reduce)').matches && !document.body.classList.contains('motion-force'));
  const head = (title, extra) => '<div class="tl-h"><span>' + esc(t(title)) + '</span><span class="grow"></span>' + (extra || '') + '</div>';
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || (r && r.path) || '—');
  const engine = () => ((CL.status || {}).engine || {});
  const isUp = () => { const e = engine(); return !!(e.engineUp && !e.paused); };
  const today = (m) => {
    const d = new Date();
    const mid = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return K.series(m, 24).filter((b) => b.at >= mid).reduce((s, b) => s + b.ok + b.failed, 0);
  };
  const median = (xs) => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const STATE = { ok: 'активний', warn: 'близько до ліміту', limited: 'ліміт', error: 'помилка', invalid: 'вхід відхилено', disabled: 'вимкнено' };
  const initials = (label) => {
    const w = (String(label || '').split('@')[0].match(/\p{L}+|\d+/gu) || ['?']);
    return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toLowerCase();
  };

  // ------------------------------------------------- hero: the live tile --
  function live(el, ctx) {
    const FACES = ['модель зараз', 'запитів сьогодні', 'акаунтів працює'];
    el.innerHTML =
      '<div class="tl-tile tl-live">' +
        '<div class="tl-view"><div class="tl-faces">' +
          '<div class="tl-face"><b class="tl-model"></b><span class="tl-sub tl-f0"></span></div>' +
          '<div class="tl-face"><b class="tl-num tl-today">0</b><span class="tl-sub tl-f1"></span></div>' +
          '<div class="tl-face"><b class="tl-num tl-acc">—</b><span class="tl-sub tl-f2"></span></div>' +
        '</div></div>' +
        '<div class="tl-foot"><span class="tl-name"></span><span class="grow"></span>' +
          FACES.map((f, i) => '<button class="tl-pip" data-f="' + i + '" aria-label="' + esc(t(f)) + '" data-tip="' + esc(t(f)) + '"></button>').join('') + '</div>' +
      '</div>' +
      '<div class="tl-appbar"><div class="tl-pick"></div>' +
        '<button class="btn primary tl-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button>' +
        '<button class="btn tl-test">' + ic('activity', 'sm') + esc(t('Перевірити')) + '</button></div>';
    const q = (s) => el.querySelector(s);
    const tile = q('.tl-live');
    let face = 0;
    const show = (i) => {
      face = i;
      tile.style.setProperty('--f', String(i));
      q('.tl-name').textContent = t(FACES[i]);
      el.querySelectorAll('.tl-pip').forEach((p) => p.classList.toggle('on', Number(p.dataset.f) === i));
    };
    show(0);
    el.querySelectorAll('.tl-pip').forEach((p) => p.addEventListener('click', () => show(Number(p.dataset.f))));
    ctx.every(5200, () => {
      if (calm() || document.hidden || tile.matches(':hover') || el.matches(':focus-within') || document.querySelector('.mp-pop')) return;
      show((face + 1) % FACES.length);
    });

    const picker = CL.ui.modelPicker(q('.tl-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();
    const paint = () => {
      const s = CL.status || {};
      const m = s.mainModel || '';
      const name = q('.tl-model');
      const text = m || t('не обрано');
      if (name.textContent !== text) { name.textContent = text; name.style.setProperty('--len', String(Math.max(9, text.length))); }
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
      q('.tl-f0').textContent = isUp() ? t('відповідає зараз на всі запити') : t('Шлюз на паузі або запускається');
      tile.classList.toggle('off', !isUp());
      const met = CL.data.get('metrics');
      if (met) {
        CL.ui.countTo(q('.tl-today'), today(met), CL.fmtInt);
        const b = K.series(met, 24);
        q('.tl-f1').textContent = t('{n} помилок', { n: CL.fmtInt(b.reduce((x, y) => x + y.failed, 0)) });
      }
      const acc = CL.data.get('accounts');
      if (acc) {
        const a = K.summary(acc);
        q('.tl-acc').textContent = a.total ? t('{ok} з {n}', { ok: a.ok, n: a.total }) : '0';
        q('.tl-f2').textContent = a.total ? t('{ok} працюють, {bad} ні', { ok: a.ok, bad: a.dead + a.limited }) : t('не підключено');
      }
    };
    ctx.on('status', paint);
    CL.data.watch(['metrics', 'accounts'], paint, ctx);
    paint();
    q('.tl-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    q('.tl-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const m = picker.get() || CL.mainModel();
      const r = await CL.api.post('/test-model', { model: m || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // ----------------------------------------------------- gateway cluster --
  function gate(el, ctx) {
    el.innerHTML = '<div class="tl-cluster">' +
      '<div class="tl-tile tl-sq tl-state"><span class="tl-ico">' + ic('power') + '</span><b class="tl-word"></b><span class="tl-label">' + esc(t('Шлюз')) + '</span></div>' +
      '<button class="tl-tile tl-sq tl-err" data-goto="stats"><span class="tl-ico">' + ic('alert') + '</span><b class="tl-big tl-errn">0</b><span class="tl-label">' + esc(t('Помилки')) + '</span></button>' +
      '<div class="tl-tile tl-addr"><span class="tl-label">' + esc(t('Адреса')) + '</span><span class="mono ellipsis tl-base">—</span>' +
        '<div class="tl-acts">' +
          '<button class="btn sm icon tl-copy" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '</button>' +
          '<button class="btn sm icon tl-key" data-tip="' + esc(t('Копіювати ключ')) + '">' + ic('key', 'sm') + '</button>' +
          '<span class="grow"></span>' +
          '<button class="btn sm icon tl-run"></button>' +
          '<button class="btn sm icon tl-restart" data-tip="' + esc(t('Перезапустити')) + '">' + ic('rotate', 'sm') + '</button>' +
        '</div><div class="tl-note"></div></div>' +
      '</div>';
    K.onGoto(el);
    const q = (s) => el.querySelector(s);
    const paint = () => {
      const s = CL.status;
      if (!s) return;
      const e = s.engine || {};
      const up = isUp();
      const st = q('.tl-state');
      st.className = 'tl-tile tl-sq tl-state ' + (up ? 'is-ok' : e.paused ? 'is-paused' : 'is-wait');
      q('.tl-word').textContent = t(e.restarting ? 'перезапуск' : e.paused ? 'пауза' : e.engineUp ? 'працює' : 'запуск…');
      const n = s.errors24h || 0;
      q('.tl-errn').textContent = CL.fmtInt(n);
      q('.tl-err').classList.toggle('is-bad', n > 0);
      const run = q('.tl-run');
      run.dataset.kind = up ? 'stop' : 'start';
      run.dataset.tip = t(up ? 'Пауза' : 'Запустити');
      run.setAttribute('aria-label', run.dataset.tip);
      run.innerHTML = ic(up ? 'pause' : 'play', 'sm');
      q('.tl-restart').disabled = !!e.restarting;
      q('.tl-note').textContent = e.lastError ? t('Остання помилка: {e}', { e: e.lastError }) : '';
    };
    ctx.on('status', paint);
    paint();
    CL.data.watch(['endpoints'], () => {
      const ep = CL.data.get('endpoints');
      if (!ep) return;
      q('.tl-base').textContent = ep.base + '/v1';
      q('.tl-copy').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
      q('.tl-key').onclick = () => CL.copy(ep.requireKey ? ep.key : 'any', 'Ключ скопійовано');
    }, ctx);
    const act = (btn, kind) => CL.ui.busy(btn, async () => {
      if (kind === 'stop' && !(await CL.confirm('Поставити шлюз на паузу? Програми отримуватимуть помилку, доки не натиснеш «Запустити».'))) return;
      const r = await CL.api.post('/server/' + kind);
      if (r.restarting) { CL.followRestart(r.host, r.port); return; }
      await CL.loadStatus();
    });
    q('.tl-run').addEventListener('click', (e) => act(e.currentTarget, e.currentTarget.dataset.kind));
    q('.tl-restart').addEventListener('click', (e) => act(e.currentTarget, 'restart'));
  }

  // ---------------------------------------------------- pulse (24 hours) --
  function pulse(el, ctx) {
    el.innerHTML = '<div class="tl-tile tl-pulse">' +
      '<div class="tl-pulse-l"><b class="tl-big tl-ptotal">0</b><span class="tl-label">' + esc(t('запитів · 24 год')) + '</span><span class="tl-sub tl-peak"></span></div>' +
      '<div class="tl-pulse-r"><div class="tl-cols">' + Array.from({ length: 24 }, (_, i) => '<i style="--k:' + i + '"><s class="a"></s><s class="b"></s></i>').join('') + '</div>' +
      '<div class="tl-axis"><span></span><span></span><span></span></div></div></div>';
    const cols = el.querySelectorAll('.tl-cols i');
    const axis = el.querySelectorAll('.tl-axis span');
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const b = K.series(m, 24);
      const max = Math.max(1, ...b.map((x) => x.ok + x.failed));
      b.forEach((x, i) => {
        const c = cols[i];
        c.firstChild.style.height = ((x.ok / max) * 100).toFixed(2) + '%';
        c.lastChild.style.height = ((x.failed / max) * 100).toFixed(2) + '%';
        c.dataset.tip = t('{when}: {ok} успішних / {bad} помилок', { when: x.label, ok: x.ok, bad: x.failed });
      });
      [0, 12, 23].forEach((k, i) => { axis[i].textContent = b[k].label; });
      CL.ui.countTo(el.querySelector('.tl-ptotal'), b.reduce((s, x) => s + x.ok + x.failed, 0), CL.fmtInt);
      el.querySelector('.tl-peak').textContent = t('пік {n}/год', { n: max === 1 && !b.some((x) => x.ok + x.failed) ? 0 : max });
    };
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // ------------------------------------------------ counters (flip tiles) --
  function count(el, ctx) {
    const tileHtml = (cls, icon, label) => '<button class="tl-tile tl-flip ' + cls + '"><span class="tl-card">' +
      '<span class="tl-side tl-front"><span class="tl-ico">' + ic(icon, 'sm') + '</span><b class="tl-big tl-v">—</b><span class="tl-label">' + esc(t(label)) + '</span></span>' +
      '<span class="tl-side tl-back"><span class="tl-bv"></span><span class="tl-label">' + esc(t(label)) + '</span></span>' +
      '</span></button>';
    el.innerHTML = '<div class="tl-quad">' +
      tileHtml('c-ok', 'gauge', 'Успішність') + tileHtml('c-tok', 'coins', 'Токени') +
      tileHtml('c-ms', 'clock', 'Час відповіді') + tileHtml('c-app', 'plug', 'Програми') + '</div>';
    const tiles = Array.from(el.querySelectorAll('.tl-flip'));
    tiles.forEach((b) => b.addEventListener('click', () => b.classList.toggle('back')));
    let turn = 0;
    ctx.every(3600, () => {
      if (calm() || document.hidden || el.matches(':hover')) return;
      const b = tiles[turn % tiles.length];
      b.classList.toggle('back');
      turn++;
    });
    const set = (cls, front, back) => {
      const b = el.querySelector('.' + cls);
      b.querySelector('.tl-v').textContent = front;
      b.querySelector('.tl-bv').textContent = back;
    };
    const paint = () => {
      const m = CL.data.get('metrics');
      if (m) {
        const total = m.total_requests || 0;
        set('c-ok', total ? Math.round(((m.total_success || 0) / total) * 100) + '%' : '—',
          t('{ok} успішних / {bad} помилок', { ok: CL.fmtInt(m.total_success), bad: CL.fmtInt(m.total_failed) }));
        set('c-tok', CL.fmtNum(m.total_tokens || 0), t('{i} вхідних · {o} вихідних', { i: CL.fmtNum(m.total_input), o: CL.fmtNum(m.total_output) }));
      }
      const rows = CL.data.feed.slice(0, 40);
      const ms = rows.map((r) => r.ms).filter((x) => x > 0);
      set('c-ms', ms.length ? CL.fmtMs(median(ms)) : '—', ms.length ? t('найдовша {ms}', { ms: CL.fmtMs(Math.max(...ms)) }) : t('Запитів ще не було'));
      const apps = CL.data.route().apps;
      set('c-app', String(apps.length), apps.length ? apps[0].name : t('Запитів ще не було'));
    };
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  }

  // ------------------------------------------------- accounts: the mosaic --
  function people(el, ctx) {
    el.innerHTML = '<div class="tl-tile tl-people">' + head('Акаунти', K.goto('accounts', 'Усі акаунти')) + '<div class="tl-pbody"></div></div>';
    K.onGoto(el);
    const body = el.querySelector('.tl-pbody');
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
      body.innerHTML = '<div class="tl-ptop"><b class="tl-big">' + a.ok + '<small>/' + a.total + '</small></b><span class="tl-label">' + esc(t('{ok} працюють, {bad} ні', { ok: a.ok, bad: a.dead + a.limited })) + '</span></div>' +
        K.byProvider(a.list).map((p) => '<div class="tl-prov"><span class="tl-pname ellipsis">' + esc(CL.provTitle(p.provider)) + ' <em>' + p.ok + '/' + p.list.length + '</em></span><div class="tl-mosaic">' +
          p.list.slice(0, 48).map((x) => '<i class="s-' + esc(x.state) + '" data-tip="' + esc(x.label + ' · ' + t(STATE[x.state] || x.state)) + '">' + esc(initials(x.label)) + '</i>').join('') + '</div></div>').join('') +
        '<div class="tl-legend"><span><i class="s-ok"></i>' + esc(t('працює')) + '</span><span><i class="s-limited"></i>' + esc(t('ліміт')) + '</span><span><i class="s-error"></i>' + esc(t('не працює')) + '</span><span><i class="s-disabled"></i>' + esc(t('вимкнено')) + '</span></div>' +
        (a.dead ? '<div class="tl-pfoot">' + ic('broom', 'sm') + '<span class="grow">' + esc(t('{n} акаунт(ів) не працюють', { n: a.dead })) + '</span><button class="btn sm" data-goto="accounts">' + esc(t('Прибрати')) + '</button></div>' : '');
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  // ------------------------------------------------- feed: request tiles --
  function stream(el, ctx) {
    el.innerHTML = '<div class="tl-tile tl-stream">' + head('Живий потік запитів', '<span class="tl-sub tl-sn"></span>') + '<div class="tl-wall"></div></div>';
    const wall = el.querySelector('.tl-wall');
    let shown = '';
    const tileOf = (r, i) => '<div class="tl-req ' + (r.ok ? 'ok' : 'bad') + (i === 0 ? ' first' : '') + '" data-tip="' + esc((r.model || '') + (r.resolved ? ' → ' + served(r) : '') + ' · ' + r.status) + '">' +
      '<span class="tl-rapp ellipsis">' + esc(r.app || t('Інше')) + '</span><span class="tl-rt">' + CL.fmtTime(r.t) + '</span>' +
      '<b class="tl-rv">' + esc(r.ok ? (r.ms ? CL.fmtMs(r.ms) : String(r.status)) : String(r.status)) + '</b>' +
      '<span class="tl-rm ellipsis">' + esc(served(r)) + '</span></div>';
    const paint = () => {
      const rows = CL.data.feed.slice(0, 8);
      const sig = rows.map((r) => r.t + '' + r.status).join('|');
      if (sig === shown) return;
      const fresh = shown && rows[0] && !shown.startsWith(rows[0].t + '' + rows[0].status);
      shown = sig;
      el.querySelector('.tl-sn').textContent = rows.length ? t('останні {n}', { n: rows.length }) : '';
      wall.classList.toggle('slide', !!fresh);
      wall.innerHTML = rows.length ? rows.map(tileOf).join('') : CL.ui.empty('radio', 'Тиша в ефірі', 'Щойно програма надішле запит, він з’явиться тут миттєво.');
    };
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  }

  // -------------------------------------------- background: the panorama --
  function fx(host, still) {
    host.innerHTML = '<div class="tl-pano' + (still ? ' still' : '') + '"><span>cartelink</span></div>';
    return () => { host.innerHTML = ''; };
  }

  CL.design({
    id: 'tiles',
    name: 'Metro-плитки',
    desc: 'Плаский світ живих плиток: суцільні кольори, тонкий великий шрифт, жодних рамок і тіней.',
    mode: 'dark',
    shell: 'rail',
    sw: ['#000000', '#1a1a1a', '#0050ef', '#c3006a'],
    thumb: '<div class="th-tl"><b><i></i><i></i></b><s class="a"></s><s class="b"></s><s class="c"></s><s class="d"></s><u></u></div>',
    home: [
      { id: 'setup', w: 12 }, { id: 'tlLive', w: 8 }, { id: 'tlGate', w: 4 },
      { id: 'tlPulse', w: 8 }, { id: 'tlCount', w: 4 },
      { id: 'tlPeople', w: 5 }, { id: 'tlStream', w: 7 }, { id: 'errors', w: 12 },
    ],
    titles: { tlLive: 'Жива плитка', tlGate: 'Шлюз', tlPulse: 'Пульс доби', tlCount: 'Лічильники', tlPeople: 'Акаунти', tlStream: 'Живий потік запитів' },
    widgets: { tlLive: live, tlGate: gate, tlPulse: pulse, tlCount: count, tlPeople: people, tlStream: stream },
    fx,
  });
})();
