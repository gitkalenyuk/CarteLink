'use strict';
// Designs: a design is not a colour scheme. It owns the shell (navigation
// layout), the composition of the Overview, how every live widget draws the
// gateway's data, the background and its own CSS (ui/css/designs/<id>.css,
// scoped by html[data-theme="<id>"]).
//
// CL.design({
//   id, name, desc, mode: 'dark'|'light', shell: 'sidebar'|'topbar'|'rail',
//   sw: [bg, surface, accent, second],          // gallery swatches
//   thumb: '<html>',                            // optional gallery preview body
//   home: [{ id: 'hero', w: 8 }, …],            // Overview composition
//   viz: { hero(el, ctx, base) { … }, … },      // widget overrides
//   widgets: { myWidget(el, ctx) { … } },       // extra widgets for `home`
//   titles: { myWidget: 'Назва' },           // their names (edit mode, hidden tray)
//   fx(host, still) → stop()                     // background, optional
// })
//
// Widgets (CL.viz.<id>(el, ctx)): hero gateway route feed accounts activity
// kpis errors setup. Each subscribes to CL.data itself and repaints in
// place. An override gets `base` = the default widget, so a design may wrap
// it instead of rewriting it.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  CL.designs = {};
  CL.designOrder = [];
  CL.design = (def) => {
    if (!CL.designs[def.id]) CL.designOrder.push(def.id);
    CL.designs[def.id] = def;
  };
  CL.currentDesign = () => {
    const P = CL.look ? CL.look.prefs() : {};
    const id = P.theme === 'custom' ? (P.custom && P.custom.base) || 'graphite' : P.theme || 'graphite';
    return CL.designs[id] || CL.designs.graphite || { id: 'graphite', viz: {} };
  };

  const DEFAULT_HOME = [
    { id: 'setup', w: 12 }, { id: 'hero', w: 8 }, { id: 'gateway', w: 4 }, { id: 'kpis', w: 12 },
    { id: 'route', w: 7 }, { id: 'accounts', w: 5 }, { id: 'feed', w: 7 }, { id: 'activity', w: 5 }, { id: 'errors', w: 12 },
  ];
  const TITLES = {
    setup: 'Швидке налаштування', hero: 'Модель зараз', gateway: 'Шлюз', kpis: 'Показники', route: 'Шлях запитів',
    accounts: 'Акаунти', feed: 'Живий потік', activity: 'Активність', errors: 'Останні помилки',
  };
  CL.homeLayout = () => (CL.currentDesign().home || DEFAULT_HOME);
  CL.widgetTitle = (id) => { const d = CL.currentDesign(); return (d.titles && d.titles[id]) || TITLES[id] || id; };

  // ------------------------------------------------------------- helpers --

  const H = (CL.vizKit = {});
  H.head = (title, extra) => '<div class="card-h"><h2>' + esc(t(title)) + '</h2><span class="grow"></span>' + (extra || '') + '</div>';
  H.goto = (page, label) => '<button class="btn sm ghost" data-goto="' + page + '">' + esc(t(label)) + ic('arrow', 'sm') + '</button>';
  H.onGoto = (el) => el.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) CL.go(g.dataset.goto); });
  /** Characters of a string as spans (for roll / flap animations). */
  H.chars = (text) => Array.from(text).map((c, i) => '<span class="ch" style="--k:' + i + '">' + (c === ' ' ? '&nbsp;' : esc(c)) + '</span>').join('');
  /** Writes text into el as animated characters, only when it changed. */
  H.rollTo = (el, text) => {
    if (el.dataset.text === text) return;
    el.dataset.text = text;
    el.style.setProperty('--len', String(Math.max(8, text.length)));
    el.classList.remove('rolling');
    el.innerHTML = H.chars(text);
    void el.offsetWidth;
    el.classList.add('rolling');
  };
  H.summary = (acc) => {
    const list = (acc && acc.accounts) || [];
    const s = (acc && acc.summary) || {};
    return { list, total: list.length, ok: (s.ok || 0) + (s.warn || 0), limited: s.limited || 0, dead: (s.error || 0) + (s.invalid || 0), disabled: s.disabled || 0 };
  };
  H.byProvider = (list) => {
    const m = {};
    list.forEach((a) => (m[a.provider] = m[a.provider] || []).push(a));
    return Object.keys(m).sort().map((p) => ({ provider: p, list: m[p], ok: m[p].filter((a) => a.state === 'ok' || a.state === 'warn').length }));
  };
  H.maxUse = (list) => Math.max(0, ...list.flatMap((a) => (a.windows || []).map((w) => w.usedPercent || 0)));
  H.series = (metrics, hours) => (hours <= 48 ? CL.hourBuckets((metrics || {}).hourly, hours) : CL.dayBuckets((metrics || {}).hourly, Math.round(hours / 24)));

  // ------------------------------------------------------------- widgets --

  const V = (CL.vizBase = {});

  V.hero = (el, ctx) => {
    el.innerHTML = '<div class="hero-top"><h2 class="nowmodel hero-model"></h2>' + H.goto('models', 'Правила моделей') + '</div>' +
      '<div class="hero-sub"><span class="dot ok hero-dot"></span><span class="hero-state">' + esc(t('відповідає зараз на всі запити')) + '</span></div>' +
      '<div class="hero-switch row"><div class="grow hero-pick" style="min-width:220px"></div><button class="btn primary hero-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button></div>' +
      '<div class="hero-presets row"></div>';
    H.onGoto(el);
    const picker = CL.ui.modelPicker(el.querySelector('.hero-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();
    const paint = (s) => {
      if (!s) return;
      const m = s.mainModel || '';
      H.rollTo(el.querySelector('.hero-model'), m || t('не обрано'));
      el.querySelector('.hero-dot').className = 'dot hero-dot ' + (s.engine && s.engine.engineUp && !s.engine.paused ? 'ok' : 'warn');
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
    };
    paint(CL.status);
    ctx.on('status', paint);
    el.querySelector('.hero-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => { if (await CL.applyModelEverywhere(picker.get())) presets(); }));
    const box = el.querySelector('.hero-presets');
    async function presets() {
      let sw;
      try { sw = await CL.api.get('/switcher'); } catch (e) { box.innerHTML = ''; return; }
      const slot = (n) => {
        const m = n === 1 ? sw.model1 : sw.model2;
        return '<button class="btn preset' + (sw.active === n ? ' primary' : '') + '" data-preset="' + n + '" data-tip="' + esc(m ? t('Застосувати модель {n} до всього', { n }) : t('Зберегти вибрану модель як {n}', { n })) + '"><b class="mono">' + n + '</b><span class="ellipsis">' + esc(m || t('зберегти сюди')) + '</span></button>';
      };
      box.innerHTML = slot(1) + slot(2) + '<button class="btn ghost sm hero-swap"' + (sw.model1 && sw.model2 ? '' : ' disabled') + '>' + ic('swap', 'sm') + esc(t('Перемкнути')) + '</button>';
      box.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => CL.ui.busy(b, async () => {
        const n = Number(b.dataset.preset);
        const m = n === 1 ? sw.model1 : sw.model2;
        if (m) { const r = await CL.api.post('/switcher/switch', { to: n }); CL.toast(t('Модель {m} тепер основна ✓', { m: r.current })); }
        else {
          const v = picker.get();
          if (!v) throw new Error(t('Спочатку обери модель зі списку'));
          await CL.api.put('/switcher', n === 1 ? { model1: v } : { model2: v });
        }
        await CL.loadStatus();
        presets();
      })));
      const swap = box.querySelector('.hero-swap');
      swap.addEventListener('click', () => CL.ui.busy(swap, async () => { const r = await CL.api.post('/switcher/switch', {}); CL.toast(t('Модель {m} тепер основна ✓', { m: r.current })); await CL.loadStatus(); presets(); }));
    }
    presets();
    ctx.on('changed', (w) => { if (w === 'config') presets(); });
  };

  V.gateway = (el, ctx) => {
    el.innerHTML = H.head('Шлюз', '<span class="chip gw-chip"></span>') +
      '<div class="gw-row"><span class="mono ellipsis gw-base"></span><button class="btn sm icon gw-copy" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '</button><button class="btn sm icon gw-key" data-tip="' + esc(t('Копіювати ключ')) + '">' + ic('key', 'sm') + '</button></div>' +
      '<div class="row gw-actions"><button class="btn sm gw-start">' + ic('play', 'sm') + esc(t('Запустити')) + '</button><button class="btn sm gw-pause">' + ic('pause', 'sm') + esc(t('Пауза')) + '</button><button class="btn sm gw-restart">' + ic('rotate', 'sm') + esc(t('Перезапустити')) + '</button></div>' +
      '<div class="hint gw-note"></div>';
    const paint = (s) => {
      if (!s) return;
      const e = s.engine || {};
      const chip = el.querySelector('.gw-chip');
      chip.className = 'chip gw-chip ' + (e.engineUp && !e.paused ? 'ok' : 'warn');
      chip.textContent = t(e.restarting ? 'перезапуск' : e.paused ? 'пауза' : e.engineUp ? 'працює' : 'запуск…');
      el.querySelector('.gw-start').disabled = e.engineUp && !e.paused;
      el.querySelector('.gw-pause').disabled = !e.engineUp || e.paused;
      el.querySelector('.gw-restart').disabled = !!e.restarting;
      el.querySelector('.gw-note').textContent = e.lastError ? t('Остання помилка: {e}', { e: e.lastError }) : '';
    };
    paint(CL.status);
    ctx.on('status', paint);
    CL.data.watch(['endpoints'], () => {
      const ep = CL.data.get('endpoints');
      if (!ep) return;
      el.querySelector('.gw-base').textContent = ep.base;
      el.querySelector('.gw-copy').onclick = () => CL.copy(ep.base, 'Адресу скопійовано');
      el.querySelector('.gw-key').onclick = () => CL.copy(ep.requireKey ? ep.key : 'any', 'Ключ скопійовано');
    }, ctx);
    const act = (kind) => (e) => CL.ui.busy(e.currentTarget, async () => {
      if (kind === 'stop' && !(await CL.confirm('Поставити шлюз на паузу? Програми отримуватимуть помилку, доки не натиснеш «Запустити».'))) return;
      const r = await CL.api.post('/server/' + kind);
      if (r.restarting) { CL.followRestart(r.host, r.port); return; }
      await CL.loadStatus();
    });
    el.querySelector('.gw-start').addEventListener('click', act('start'));
    el.querySelector('.gw-pause').addEventListener('click', act('stop'));
    el.querySelector('.gw-restart').addEventListener('click', act('restart'));
  };

  V.kpis = (el, ctx) => {
    const k = (cls, icon, label) => '<div class="kpi ' + cls + '"><div class="kpi-label">' + ic(icon, 'sm') + esc(t(label)) + '</div><div class="kpi-value">—</div><div class="kpi-sub">&nbsp;</div></div>';
    el.innerHTML = '<div class="kpis">' + k('k-req', 'activity', 'Запити') + k('k-tok', 'coins', 'Токени') + k('k-ok', 'gauge', 'Успішність') + k('k-acc', 'users', 'Акаунти') + '</div>';
    const q = (s) => el.querySelector(s);
    const paint = () => {
      const m = CL.data.get('metrics');
      if (m) {
        const total = m.total_requests || 0;
        CL.ui.countTo(q('.k-req .kpi-value'), total);
        q('.k-req .kpi-sub').textContent = t('{n} помилок', { n: CL.fmtInt(m.total_failed) });
        CL.ui.countTo(q('.k-tok .kpi-value'), m.total_tokens || 0);
        q('.k-tok .kpi-sub').textContent = t('{i} вхідних · {o} вихідних', { i: CL.fmtNum(m.total_input), o: CL.fmtNum(m.total_output) });
        const rate = total ? Math.round(((m.total_success || 0) / total) * 100) : 100;
        CL.ui.countTo(q('.k-ok .kpi-value'), rate, (v) => v + '%');
        q('.k-ok .kpi-sub').textContent = t('{ok} успішних / {bad} помилок', { ok: CL.fmtInt(m.total_success), bad: CL.fmtInt(m.total_failed) });
      }
      const a = H.summary(CL.data.get('accounts'));
      if (CL.data.get('accounts')) {
        CL.ui.countTo(q('.k-acc .kpi-value'), a.total, String);
        q('.k-acc .kpi-sub').textContent = a.total ? t('{ok} працюють, {bad} ні', { ok: a.ok, bad: a.dead + a.limited }) : t('не підключено');
      }
    };
    CL.data.watch(['metrics', 'accounts'], paint, ctx);
    paint();
  };

  V.feed = (el, ctx, opts) => {
    const limit = (opts && opts.limit) || 8;
    el.innerHTML = H.head('Живий потік запитів', '<span class="sub feed-n"></span>') + '<div class="feed"></div>';
    const box = el.querySelector('.feed');
    const row = (r) => '<div class="feed-row"><span class="faint num">' + CL.fmtTime(r.t) + '</span><span class="st ' + (r.ok ? 'ok' : 'bad') + '">' + esc(String(r.status)) + '</span>' +
      '<span class="ellipsis mono">' + esc(r.resolved ? r.model + ' → ' + r.resolved.split(' → ').pop() : r.model || r.path || '') + (r.app ? ' <span class="chip outline">' + esc(r.app) + '</span>' : '') + '</span><span class="faint num">' + (r.ms ? CL.fmtMs(r.ms) : '') + '</span></div>';
    let shown = '';
    const paint = () => {
      const rows = CL.data.feed.slice(0, limit);
      const sig = rows.map((r) => r.t + r.status).join('|');
      if (sig === shown) return;
      const fresh = !shown;
      shown = sig;
      box.innerHTML = rows.length ? rows.map(row).join('') : CL.ui.empty('radio', 'Тиша в ефірі', 'Щойно програма надішле запит, він з’явиться тут миттєво.');
      if (fresh) box.classList.add('still');
      el.querySelector('.feed-n').textContent = rows.length ? t('останні {n}', { n: rows.length }) : '';
    };
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  };

  V.accounts = (el, ctx) => {
    el.innerHTML = H.head('Акаунти', H.goto('accounts', 'Усі акаунти')) + '<div class="acc-body">' + CL.ui.skeleton(3) + '</div>';
    H.onGoto(el);
    const body = el.querySelector('.acc-body');
    const paint = () => {
      const data = CL.data.get('accounts');
      if (!data) return;
      const a = H.summary(data);
      if (!a.total) {
        body.innerHTML = CL.ui.empty('users', 'Акаунтів ще немає', 'Почни зі звичайного Google-акаунта (Gemini-Antigravity) — це безкоштовно.', '<button class="btn primary sm" data-goto="accounts">' + ic('plus', 'sm') + esc(t('Додати акаунт')) + '</button>');
        return;
      }
      body.innerHTML = '<div class="segbar">' + a.list.map((x) => '<i class="' + (x.state === 'ok' ? 'ok' : x.state === 'disabled' ? '' : x.state) + '" title="' + esc(x.label) + '"></i>').join('') + '</div>' +
        '<div class="list">' + H.byProvider(a.list).map((p) => '<div class="li"><span class="avatar">' + esc(p.provider.slice(0, 2)) + '</span><div class="grow"><b>' + esc(CL.provTitle(p.provider)) + '</b><span>' + esc(t('{ok} з {n} працюють', { ok: p.ok, n: p.list.length })) + '</span></div>' +
          (p.list.some((x) => x.percent) ? '<div style="width:110px">' + CL.ui.bar(H.maxUse(p.list)) + '</div>' : '') + CL.ui.stateChip(p.ok === p.list.length ? 'ok' : p.ok ? 'warn' : 'error') + '</div>').join('') + '</div>' +
        (a.dead ? '<div class="card-foot">' + ic('broom', 'sm') + '<span class="grow">' + esc(t('{n} акаунт(ів) не працюють', { n: a.dead })) + '</span><button class="btn sm" data-goto="accounts">' + esc(t('Прибрати')) + '</button></div>' : '');
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  };

  V.activity = (el, ctx) => {
    el.innerHTML = H.head('Активність', '<span class="sub act-sum"></span>') + '<div class="act-chart"></div>';
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const b = H.series(m, 24);
      const sum = b.reduce((s, x) => s + x.ok + x.failed, 0);
      el.querySelector('.act-sum').textContent = t('{n} запитів за 24 год', { n: CL.fmtInt(sum) });
      const box = el.querySelector('.act-chart');
      box.classList.toggle('sparse', sum < 20);
      CL.ui.chart(box, b, [b[0].label, b[12].label, b[23].label]);
    };
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  };

  V.errors = (el, ctx) => {
    el.innerHTML = H.head('Останні помилки', H.goto('stats', 'Журнал')) + '<div class="err-body">' + CL.ui.skeleton(2) + '</div>';
    H.onGoto(el);
    const paint = () => {
      const r = CL.data.get('errors');
      if (!r) return;
      const list = (r.errors || []).slice(0, 4);
      el.querySelector('.err-body').innerHTML = list.length ? '<div class="list">' + list.map((e) => '<div class="li" style="align-items:flex-start"><span class="chip ' + (e.kind === 'auto' ? 'info' : 'bad') + ' mono">' + esc(e.kind === 'auto' ? t('сам') : String(e.status || '—')) + '</span><div class="grow"><b style="white-space:normal;font-weight:500">' + esc(CL.errorHint(e) || e.message) + '</b><span>' + esc(CL.relTime(e.t)) + (e.count > 1 ? ' · ×' + e.count : '') + (e.model ? ' · ' + esc(e.model) : '') + '</span></div></div>').join('') + '</div>'
        : CL.ui.empty('check', 'Помилок немає', 'Усе працює як слід.');
    };
    CL.data.watch(['errors'], paint, ctx);
    paint();
  };

  /** The request path: programs → rule → model, drawn as weighted links. */
  V.route = (el, ctx) => {
    el.innerHTML = H.head('Шлях запитів', '<span class="sub route-n"></span>') + '<div class="route"></div>';
    const box = el.querySelector('.route');
    let sig = '';
    const paint = () => {
      const r = CL.data.route();
      const s = JSON.stringify([r.apps, r.models].map((l) => l.map((x) => x.name + x.n)));
      if (s === sig) return;
      sig = s;
      el.querySelector('.route-n').textContent = r.total ? t('останні {n} запитів', { n: r.total }) : '';
      if (!r.total) { box.innerHTML = CL.ui.empty('route', 'Запитів ще не було', 'Тут буде видно, яка програма що просить і яка модель відповідає.'); return; }
      box.innerHTML = H.routeSvg(r);
    };
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  };

  /** Default route drawing: three columns of nodes joined by curves. Designs reuse or replace it. */
  H.routeSvg = (r, opt) => {
    opt = opt || {};
    const cols = [r.apps.slice(0, 5), r.rules.slice(0, 4), r.models.slice(0, 5)];
    const heads = [t('Програма'), t('Правило'), t('Модель')];
    const W = 600;
    const rowH = 30;
    const H2 = Math.max(...cols.map((c) => c.length)) * rowH + 30;
    const colX = [0, 230, 430];
    const colW = [150, 130, 170];
    const pos = {};
    const nodes = cols.map((c, ci) => c.map((n, i) => {
      const y = 30 + i * rowH;
      pos[['a', 'r', 'm'][ci] + ':' + n.name] = { x: colX[ci], y: y + 11, w: colW[ci] };
      return '<g class="rnode' + (n.fail ? ' has-fail' : '') + '"><rect x="' + colX[ci] + '" y="' + y + '" width="' + colW[ci] + '" height="22" rx="5"/>' +
        '<text x="' + (colX[ci] + 9) + '" y="' + (y + 15) + '">' + esc(n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name) + '</text>' +
        '<text class="rn" x="' + (colX[ci] + colW[ci] - 8) + '" y="' + (y + 15) + '" text-anchor="end">' + n.n + '</text></g>';
    }).join('')).join('');
    const max = Math.max(1, ...r.links.map((l) => l.n));
    const links = r.links.filter((l) => pos[l.from] && pos[l.to]).map((l) => {
      const a = pos[l.from];
      const b = pos[l.to];
      const x1 = a.x + a.w;
      const x2 = b.x;
      const mx = (x1 + x2) / 2;
      return '<path class="rlink ' + l.kind + '" style="stroke-width:' + (1 + (l.n / max) * 5).toFixed(1) + 'px" d="M' + x1 + ' ' + a.y + ' C' + mx + ' ' + a.y + ' ' + mx + ' ' + b.y + ' ' + x2 + ' ' + b.y + '"/>';
    }).join('');
    const headers = heads.map((h, i) => '<text class="rhead" x="' + colX[i] + '" y="14">' + esc(h) + '</text>').join('');
    return '<svg class="route-svg' + (opt.cls ? ' ' + opt.cls : '') + '" viewBox="0 0 ' + W + ' ' + H2 + '" preserveAspectRatio="xMinYMin meet">' + headers + links + nodes + '</svg>';
  };

  V.setup = (el) => {
    const box = el.closest('.block') || el;
    let hidden = false;
    try { hidden = localStorage.getItem('cl.wizardHidden') === '1'; } catch (e) { /* ignore */ }
    const m = CL.data.get('metrics');
    const step3 = (m && m.total_requests > 0);
    CL.models().catch(() => ({ authFiles: [], groups: [] })).then((cat) => {
      const s1 = cat.authFiles.length > 0 || cat.groups.some((g) => g.kind === 'provider');
      const s2 = !!CL.mainModel();
      if (hidden || (s1 && s2 && step3)) { box.hidden = true; return; }
      const step = (n, done, title, text, page, label) => '<div class="li"><span class="avatar" style="' + (done ? 'background:var(--ok-soft);color:var(--ok)' : '') + '">' + (done ? ic('check', 'sm') : n) + '</span><div class="grow"><b>' + esc(t(title)) + '</b><span>' + esc(t(text)) + '</span></div>' + (done ? '' : H.goto(page, label)) + '</div>';
      box.hidden = false;
      el.innerHTML = H.head('Швидке налаштування: три кроки', '<button class="btn sm ghost st-hide">' + esc(t('Сховати')) + '</button>') + '<div class="list">' +
        step(1, s1, 'Підключи акаунт', 'Наприклад, звичайний Google-акаунт (Gemini-Antigravity) — безкоштовно.', 'accounts', 'Акаунти') +
        step(2, s2, 'Обери модель', 'Вона відповідатиме на всі запити. Можна змінити будь-коли.', 'models', 'Моделі') +
        step(3, step3, 'Підключи програму', 'Claude Code, Codex, Cursor, Cline… — один клік або покрокова інструкція.', 'connect', 'Підключити') + '</div>';
      H.onGoto(el);
      el.querySelector('.st-hide').onclick = () => { try { localStorage.setItem('cl.wizardHidden', '1'); } catch (e) { /* ignore */ } box.hidden = true; };
    });
  };

  /** Draws widget `id` into el with the current design's override if any. */
  CL.viz = new Proxy({}, {
    get: (_, id) => (el, ctx, opts) => {
      const d = CL.currentDesign();
      const base = (e2, c2, o2) => V[id] && V[id](e2, c2, o2);
      const f = (d.viz && d.viz[id]) || (d.widgets && d.widgets[id]);
      return f ? f(el, ctx, base, opts) : base(el, ctx, opts);
    },
  });
})();
