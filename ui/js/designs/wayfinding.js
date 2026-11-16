'use strict';
// Жовта навігація — airport wayfinding. Everything is a sign: signal-yellow
// panels with black type, black panels with yellow type, pictogram arrows and
// gate boxes on a strict grid. The active model is the destination on a giant
// overhead sign; every program gets its own direction sign
// «Програма → Модель · Вихід N», where the gate is the provider (account
// group) that served it. Problems are black/yellow warning signs.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  // ------------------------------------------------------------- helpers --
  /** Pictogram arrow (pointing right; CSS rotates it for RTL). */
  const ARROW = '<svg class="wf-pict-arrow" viewBox="0 0 100 100" aria-hidden="true"><path d="M8 41h52L38 19l13-13 44 44-44 44-13-13 22-22H8z"/></svg>';
  const WARN = '<svg class="wf-pict-warn" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6 97 90H3z"/><path class="wf-pw-mark" d="M45 36h10l-2 30h-6zM45 72h10v10H45z"/></svg>';
  const head = (title, extra) => '<div class="wf-head"><span class="wf-head-sq"></span><span>' + esc(t(title)) + '</span><span class="grow"></span>' + (extra || '') + '</div>';
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '');

  /** Gates: one number per provider, in the stable order of the accounts list. */
  const gateMap = () => {
    const m = {};
    K.byProvider(K.summary(CL.data.get('accounts')).list).forEach((p, i) => { m[p.provider] = i + 1; });
    return m;
  };
  const FAMILY = [
    [/claude|opus|sonnet|haiku/i, ['claude', 'antigravity', 'kiro']],
    [/gemini/i, ['antigravity', 'gemini-cli', 'gemini', 'vertex']],
    [/gpt|codex|^o\d/i, ['codex', 'workbuddy']],
    [/grok/i, ['xai']], [/kimi/i, ['kimi']], [/qwen/i, ['qwen']], [/glm/i, ['glm', 'zai']], [/deepseek/i, ['deepseek']],
  ];
  /** {n, prov} for a model: the provider that served it recently, else a guess by model family. */
  const gateOf = (model, gates) => {
    if (!model) return { n: '', prov: '' };
    const hit = CL.data.feed.find((r) => r.provider && served(r) === model);
    let prov = hit ? hit.provider : '';
    if (!prov || !gates[prov]) {
      const fam = FAMILY.find(([re]) => re.test(model));
      prov = (fam && fam[1].find((p) => gates[p])) || prov;
    }
    return { n: gates[prov] ? String(gates[prov]) : '', prov };
  };
  const gateBox = (g, cls) => '<span class="wf-gate-box ' + (cls || '') + '"' + (g.prov ? ' data-tip="' + esc(CL.provTitle(g.prov)) + '"' : '') + '><small>' + esc(t('Вихід')) + '</small><b>' + esc(g.n || '·') + '</b></span>';

  // ---------------------------------------------------------------- hero --
  function hero(el, ctx) {
    el.innerHTML =
      '<div class="wf-sign">' +
        '<div class="wf-arrow">' + ARROW + '</div>' +
        '<div class="wf-dest"><span class="wf-kicker">' + esc(t('Модель зараз')) + '</span><h2 class="wf-model nowmodel"></h2><span class="wf-sub"></span></div>' +
        '<div class="wf-hgate"><small>' + esc(t('Вихід')) + '</small><b class="wf-hgate-n">·</b><em class="wf-hgate-p"></em></div>' +
      '</div>' +
      '<div class="wf-strip"><span class="wf-strip-ic">' + ic('plug', 'sm') + '</span><code class="wf-base">—</code>' +
        '<button class="btn sm wf-copy">' + ic('copy', 'sm') + esc(t('Копіювати адресу')) + '</button></div>' +
      '<div class="wf-ctrl"><div class="wf-pick"></div>' +
        '<button class="btn primary wf-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button>' +
        '<button class="btn wf-test">' + ic('activity', 'sm') + esc(t('Перевірити')) + '</button></div>';
    const q = (s) => el.querySelector(s);
    const picker = CL.ui.modelPicker(q('.wf-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();
    const paint = () => {
      const s = CL.status;
      if (!s) return;
      const m = s.mainModel || '';
      const title = q('.wf-model');
      const before = title.dataset.text;
      K.rollTo(title, m || t('Модель не обрано'));
      if (before !== undefined && before !== title.dataset.text) {
        const a = q('.wf-arrow');
        a.classList.remove('go');
        void a.offsetWidth;
        a.classList.add('go');
      }
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
      const e = s.engine || {};
      const up = e.engineUp && !e.paused;
      q('.wf-sign').classList.toggle('closed', !up);
      q('.wf-sub').textContent = !up ? t(e.paused ? 'Шлюз на паузі' : 'Рушій запускається')
        : m ? t('Відповідає на всі запити твоїх програм') : t('Обери модель — вона відповідатиме на запити всіх твоїх програм.');
      const g = gateOf(m, gateMap());
      q('.wf-hgate-n').textContent = g.n || '·';
      q('.wf-hgate-p').textContent = g.prov ? CL.provTitle(g.prov) : '';
      const ep = CL.data.get('endpoints');
      if (ep) {
        q('.wf-base').textContent = ep.base + '/v1';
        q('.wf-copy').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
      }
    };
    ctx.on('status', paint);
    CL.data.watch(['endpoints', 'accounts', 'feed'], paint, ctx);
    paint();
    q('.wf-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    q('.wf-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const m = picker.get() || CL.mainModel();
      const r = await CL.api.post('/test-model', { model: m || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // -------------------------------------------------------------- status --
  function status(el, ctx) {
    el.innerHTML = head('Стан') +
      '<div class="wf-st-main"><span class="wf-st-pict"></span><b class="wf-st-text"></b></div>' +
      '<dl class="wf-st-rows">' +
        '<dt>' + esc(t('Шлюз')) + '</dt><dd class="wf-st-gw">—</dd>' +
        '<dt>' + esc(t('Акаунти')) + '</dt><dd class="wf-st-acc">—</dd>' +
        '<dt>' + esc(t('Запити за 24 год')) + '</dt><dd class="wf-st-req">—</dd>' +
        '<dt>' + esc(t('Помилки за 24 год')) + '</dt><dd class="wf-st-err">—</dd>' +
      '</dl>' +
      '<div class="wf-st-act"><button class="btn sm wf-start">' + ic('play', 'sm') + esc(t('Запустити')) + '</button><button class="btn sm wf-pause">' + ic('pause', 'sm') + esc(t('Пауза')) + '</button><button class="btn sm wf-restart">' + ic('rotate', 'sm') + esc(t('Перезапустити')) + '</button></div>' +
      '<div class="wf-st-note"></div>';
    const q = (s) => el.querySelector(s);
    const paint = () => {
      const s = CL.status || {};
      const e = s.engine || {};
      const up = e.engineUp && !e.paused;
      const acc = K.summary(CL.data.get('accounts'));
      const bad = !up || acc.dead > 0 || (acc.total > 0 && acc.ok === 0);
      q('.wf-st-main').classList.toggle('warn', bad);
      q('.wf-st-pict').innerHTML = bad ? WARN : ic('check');
      q('.wf-st-text').textContent = t(bad ? 'Потребує уваги' : 'Усе працює');
      q('.wf-st-gw').textContent = t(e.restarting ? 'перезапуск' : e.paused ? 'пауза' : e.engineUp ? 'працює' : 'запуск…');
      q('.wf-st-acc').textContent = CL.data.get('accounts') ? (acc.total ? acc.ok + ' / ' + acc.total : t('не підключено')) : '—';
      const b = K.series(CL.data.get('metrics'), 24);
      q('.wf-st-req').textContent = CL.fmtInt(b.reduce((n, x) => n + x.ok + x.failed, 0));
      q('.wf-st-err').textContent = CL.fmtInt(s.errors24h || 0);
      q('.wf-st-err').classList.toggle('hot', !!s.errors24h);
      q('.wf-start').disabled = !!up;
      q('.wf-pause').disabled = !e.engineUp || !!e.paused;
      q('.wf-restart').disabled = !!e.restarting;
      q('.wf-st-note').textContent = e.lastError ? t('Остання помилка: {e}', { e: e.lastError }) : '';
    };
    ctx.on('status', paint);
    CL.data.watch(['accounts', 'metrics'], paint, ctx);
    paint();
    const act = (kind) => (ev) => CL.ui.busy(ev.currentTarget, async () => {
      if (kind === 'stop' && !(await CL.confirm('Поставити шлюз на паузу? Програми отримуватимуть помилку, доки не натиснеш «Запустити».'))) return;
      const r = await CL.api.post('/server/' + kind);
      if (r.restarting) { CL.followRestart(r.host, r.port); return; }
      await CL.loadStatus();
    });
    q('.wf-start').addEventListener('click', act('start'));
    q('.wf-pause').addEventListener('click', act('stop'));
    q('.wf-restart').addEventListener('click', act('restart'));
  }

  // ---------------------------------------------------------- directions --
  function directions(el, ctx) {
    el.innerHTML = head('Напрямки', '<span class="wf-meta wf-dir-meta"></span>') + '<div class="wf-dirs"></div>';
    const box = el.querySelector('.wf-dirs');
    let sig = '';
    const paint = () => {
      const now = Date.now();
      const by = new Map();
      CL.data.feed.slice(0, 60).forEach((r) => {
        const app = r.app || t('Інше');
        const o = by.get(app) || { app, last: r, n: 0, fail: 0 };
        o.n++;
        if (!r.ok) o.fail++;
        by.set(app, o);
      });
      const rows = [...by.values()].slice(0, 6);
      const gates = gateMap();
      const s = JSON.stringify(rows.map((o) => [o.app, served(o.last), o.n, o.last.ok, now - o.last.t < 60000])) + Object.keys(gates).join();
      if (s === sig) return;
      sig = s;
      el.querySelector('.wf-dir-meta').textContent = rows.length ? t('{n} програм', { n: rows.length }) : '';
      box.innerHTML = rows.length ? rows.map((o) => {
        const to = served(o.last) || '—';
        const live = now - o.last.t < 60000;
        return '<div class="wf-dir' + (o.last.ok ? '' : ' bad') + (live ? ' live' : '') + '">' +
          '<span class="wf-dir-app ellipsis">' + esc(o.app) + '</span>' +
          '<span class="wf-dir-arrow">' + (o.last.ok ? ARROW : WARN) + '</span>' +
          '<span class="wf-dir-to ellipsis mono">' + esc(to) + '</span>' +
          '<span class="wf-dir-n num" data-tip="' + esc(t('{n} запитів, {f} з помилкою', { n: o.n, f: o.fail })) + '">' + o.n + '×</span>' +
          gateBox(gateOf(to, gates)) + '</div>';
      }).join('') : '<div class="wf-none">' + ARROW + '<div><b>' + esc(t('Напрямків ще немає')) + '</b><span>' + esc(t('Підключи програму — для неї з’явиться свій вказівник.')) + '</span></div>' +
        '<button class="btn sm primary" data-goto="connect">' + esc(t('Підключити')) + '</button></div>';
    };
    K.onGoto(el);
    CL.data.watch(['feed', 'metrics', 'accounts'], paint, ctx);
    ctx.every(15000, paint);
    paint();
  }

  // --------------------------------------------------------------- gates --
  function gates(el, ctx) {
    el.innerHTML = head('Виходи', '<button class="btn sm ghost" data-goto="accounts">' + esc(t('Акаунти')) + ic('arrow', 'sm') + '</button>') + '<div class="wf-gates"></div>';
    K.onGoto(el);
    const box = el.querySelector('.wf-gates');
    const paint = () => {
      const data = CL.data.get('accounts');
      if (!data) return;
      const a = K.summary(data);
      if (!a.total) {
        box.innerHTML = '<div class="wf-none">' + ARROW + '<div><b>' + esc(t('Акаунтів ще немає')) + '</b><span>' + esc(t('Почни зі звичайного Google-акаунта (Gemini-Antigravity) — це безкоштовно.')) + '</span></div>' +
          '<button class="btn sm primary" data-goto="accounts">' + esc(t('Додати акаунт')) + '</button></div>';
        return;
      }
      box.innerHTML = K.byProvider(a.list).map((p, i) => {
        const st = p.ok === p.list.length ? 'open' : p.ok ? 'part' : 'closed';
        const use = H_use(p.list);
        return '<div class="wf-gt ' + st + '"><b class="wf-gt-n">' + (i + 1) + '</b><div class="wf-gt-body">' +
          '<span class="wf-gt-name ellipsis">' + esc(CL.provTitle(p.provider)) + '</span>' +
          '<span class="wf-gt-st">' + esc(st === 'closed' ? t('зачинено') : t('{ok} з {n} відкрито', { ok: p.ok, n: p.list.length })) + (use ? ' · ' + esc(t('ліміт {p}%', { p: use })) : '') + '</span>' +
          '<span class="wf-gt-cells">' + p.list.slice(0, 20).map((x) => '<i class="' + esc(x.state) + '" data-tip="' + esc(x.label) + '"></i>').join('') + '</span></div></div>';
      }).join('');
    };
    const H_use = (list) => { const u = Math.round(K.maxUse(list)); return u > 0 ? u : 0; };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  // ---------------------------------------------------------------- flow --
  function flow(el, ctx) {
    el.innerHTML = head('Потік за добу', '<span class="wf-meta wf-flow-sum"></span>') +
      '<div class="wf-flow">' + '<span class="wf-fb"><i class="o"></i><i class="b"></i></span>'.repeat(24) + '</div>' +
      '<div class="wf-axis"><span>' + esc(t('−24 год')) + '</span><span>' + esc(t('−12 год')) + '</span><span>' + esc(t('зараз')) + '</span></div>';
    const bars = el.querySelectorAll('.wf-fb');
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const b = K.series(m, 24);
      const max = Math.max(1, ...b.map((x) => x.ok + x.failed));
      b.forEach((x, i) => {
        const el2 = bars[i];
        if (!el2) return;
        el2.children[0].style.height = ((x.ok / max) * 100).toFixed(1) + '%';
        el2.children[1].style.height = ((x.failed / max) * 100).toFixed(1) + '%';
        el2.dataset.tip = x.label + ' · ' + t('{n} запитів', { n: x.ok + x.failed });
      });
      el.querySelector('.wf-flow-sum').textContent = t('{n} запитів за 24 год', { n: CL.fmtInt(b.reduce((s, x) => s + x.ok + x.failed, 0)) });
    };
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // -------------------------------------------------------------- errors --
  function errors(el, ctx) {
    el.innerHTML = head('Попередження', '<button class="btn sm ghost" data-goto="stats">' + esc(t('Журнал')) + ic('arrow', 'sm') + '</button>') + '<div class="wf-errs">' + CL.ui.skeleton(2) + '</div>';
    K.onGoto(el);
    const paint = () => {
      const r = CL.data.get('errors');
      if (!r) return;
      const list = (r.errors || []).slice(0, 4);
      el.querySelector('.wf-errs').innerHTML = list.length ? list.map((e) => '<div class="wf-err' + (e.kind === 'auto' ? ' auto' : '') + '"><span class="wf-err-ic">' + (e.kind === 'auto' ? ic('info') : WARN) + '</span>' +
        '<div class="grow"><b>' + esc(CL.errorHint(e) || e.message) + '</b><span>' + esc(e.kind === 'auto' ? t('сам') : String(e.status || '—')) + ' · ' + esc(CL.relTime(e.t)) + (e.count > 1 ? ' · ×' + e.count : '') + (e.model ? ' · ' + esc(e.model) : '') + '</span></div></div>').join('')
        : '<div class="wf-clear">' + ic('check') + '<b>' + esc(t('Помилок немає')) + '</b></div>';
    };
    CL.data.watch(['errors'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------ background --
  /** A tactile floor guide strip with chevrons drifting toward the exit. */
  function fx(host, still) {
    host.innerHTML = '<div class="wf-fx' + (still ? ' still' : '') + '"><i></i></div>';
    const vis = () => host.classList.toggle('wf-fx-pause', document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); host.classList.remove('wf-fx-pause'); };
  }

  CL.design({
    id: 'wayfinding',
    name: 'Жовта навігація',
    desc: 'Аеропортні вказівники: жовті табло, стрілки-піктограми, номери виходів.',
    mode: 'light',
    shell: 'topbar',
    sw: ['#e4e4de', '#ffd200', '#111111', '#08702f'],
    thumb: '<div class="th-wf"><div class="th-wf-bar"></div><div class="th-wf-sign"><i></i><b></b><u></u></div><div class="th-wf-rows"><s></s><s></s><s></s></div></div>',
    home: [{ id: 'setup', w: 12 }, { id: 'hero', w: 8 }, { id: 'wfStatus', w: 4 }, { id: 'wfDirections', w: 7 }, { id: 'wfGates', w: 5 }, { id: 'wfFlow', w: 7 }, { id: 'errors', w: 5 }],
    titles: { errors: 'Попередження', wfStatus: 'Стан',wfDirections: 'Напрямки', wfGates: 'Виходи', wfFlow: 'Потік за добу' },
    viz: { hero, errors },
    widgets: { wfStatus: status, wfDirections: directions, wfGates: gates, wfFlow: flow },
    fx,
  });
})();
