'use strict';
// Теплий застосунок — a friendly consumer surface for people who never want
// to read a log. Warm off-white ground, big soft cards, plain words: a
// greeting by the time of day, one sentence that says whether everything
// works, the model as a card with a large soft avatar, accounts as people,
// today's activity as soft rounded bars.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '');
  const hash = (s) => Array.from(String(s)).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11);
  const family = (m) => {
    m = String(m || '').toLowerCase();
    if (/claude|opus|sonnet|haiku/.test(m)) return 'claude';
    if (/gpt|codex|^o\d/.test(m)) return 'gpt';
    if (/gemini|gemma/.test(m)) return 'gemini';
    if (/qwen|kimi|glm|deepseek/.test(m)) return 'east';
    if (/grok/.test(m)) return 'grok';
    return 'other';
  };
  const initials = (s) => {
    const w = String(s || '?').replace(/^.*\//, '').replace(/@.*$/, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (!w.length) return '?';
    const a = w[0].charAt(0).toUpperCase();
    const b = w[1] ? w[1].charAt(0) : w[0].charAt(1) || '';
    return a + b.toLowerCase();
  };
  const todayCount = (m) => {
    const mid = new Date(); mid.setHours(0, 0, 0, 0);
    return K.series(m, 24).filter((x) => x.at >= mid.getTime()).reduce((s, x) => s + x.ok, 0);
  };

  // -------------------------------------------------------------- hello --
  function hello(el, ctx) {
    el.innerHTML =
      '<div class="wm-scene" aria-hidden="true"><i class="wm-sky"></i><i class="wm-orb"></i><i class="wm-cloud"></i><i class="wm-hill a"></i><i class="wm-hill b"></i></div>' +
      '<div class="wm-hello"><div class="wm-greet"></div><h2 class="wm-say"></h2><p class="wm-sub"></p><div class="wm-acts"></div></div>';
    const q = (s) => el.querySelector(s);
    let acts = '';
    const greet = () => {
      const h = new Date().getHours();
      q('.wm-greet').textContent = t(h >= 5 && h < 12 ? 'Доброго ранку' : h >= 12 && h < 18 ? 'Доброго дня' : h >= 18 && h < 23 ? 'Доброго вечора' : 'Доброї ночі');
      q('.wm-scene').classList.toggle('night', h < 6 || h >= 20);
    };
    const paint = () => {
      greet();
      const s = CL.status;
      if (!s) return;
      const e = s.engine || {};
      const acc = CL.data.get('accounts');
      const a = K.summary(acc);
      let mood = 'ok';
      let say;
      let kind = 'connect';
      if (e.paused) { mood = 'off'; say = t('Шлюз на паузі — програми зараз не отримують відповідей'); kind = 'start'; }
      else if (!e.engineUp || e.restarting) { mood = 'wait'; say = t('Шлюз прокидається…'); kind = ''; }
      else if (!s.mainModel) { mood = 'wait'; say = t('Обери модель — і можна починати'); kind = ''; }
      else if (acc && !a.total) { mood = 'wait'; say = t('Додай акаунт, щоб програми отримували відповіді'); kind = 'accounts'; }
      else if (a.dead) { mood = 'warn'; say = t('Майже все добре: {n} акаунт(ів) потребують уваги', { n: a.dead }); kind = 'accounts'; }
      else say = t('Усе працює — твої програми отримують відповіді');
      const say$ = q('.wm-say');
      if (say$.textContent !== say) say$.textContent = say;
      el.closest('.block') && el.closest('.block').setAttribute('data-mood', mood);
      q('.wm-scene').dataset.mood = mood;
      const m = CL.data.get('metrics');
      q('.wm-sub').textContent = m ? t('Відповідей сьогодні: {n}', { n: CL.fmtInt(todayCount(m)) }) + (s.errors24h ? ' · ' + t('{n} помилок за добу', { n: s.errors24h }) : '') : '';
      if (kind !== acts) {
        acts = kind;
        const box = q('.wm-acts');
        box.innerHTML = kind === 'start' ? '<button class="btn primary lg" data-act="start">' + ic('play', 'sm') + esc(t('Запустити')) + '</button>'
          : kind === 'accounts' ? '<button class="btn primary lg" data-goto="accounts">' + ic('users', 'sm') + esc(t('Акаунти')) + '</button>'
          : kind === 'connect' ? '<button class="btn lg" data-goto="connect">' + ic('plug', 'sm') + esc(t('Підключити')) + '</button>' : '';
        const st = box.querySelector('[data-act="start"]');
        if (st) st.addEventListener('click', () => CL.ui.busy(st, async () => { await CL.api.post('/server/start'); await CL.loadStatus(); }));
      }
    };
    K.onGoto(el);
    ctx.on('status', paint);
    CL.data.watch(['accounts', 'metrics'], paint, ctx);
    ctx.every(60000, greet);
    paint();
  }

  // -------------------------------------------------------------- model --
  function model(el, ctx) {
    el.innerHTML = '<div class="wm-model"><div class="wm-ava"><span></span></div><div class="wm-mtext"><small>' + esc(t('Модель зараз')) + '</small><h3 class="nowmodel wm-mname"></h3>' +
      '<div class="wm-mstate"><span class="dot ok"></span><span>' + esc(t('відповідає зараз на всі запити')) + '</span></div></div></div>' +
      '<div class="wm-pick"></div><div class="wm-mbtns"><button class="btn primary wm-apply">' + ic('check', 'sm') + esc(t('Застосувати до всього')) + '</button>' +
      '<button class="btn wm-test">' + ic('activity', 'sm') + esc(t('Перевірити')) + '</button></div>';
    const picker = CL.ui.modelPicker(el.querySelector('.wm-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = null;
    const paint = () => {
      const s = CL.status;
      if (!s) return;
      const m = s.mainModel || '';
      K.rollTo(el.querySelector('.wm-mname'), m || t('Модель не обрано'));
      const ava = el.querySelector('.wm-ava');
      ava.dataset.fam = m ? family(m) : 'none';
      ava.querySelector('span').textContent = m ? initials(m) : '?';
      const e = s.engine || {};
      el.querySelector('.wm-mstate').hidden = !m;
      el.querySelector('.wm-mstate .dot').className = 'dot ' + (e.engineUp && !e.paused ? 'ok' : 'warn');
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
    };
    ctx.on('status', paint);
    paint();
    el.querySelector('.wm-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    el.querySelector('.wm-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const r = await CL.api.post('/test-model', { model: picker.get() || CL.mainModel() || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // ---------------------------------------------------------------- day --
  function day(el, ctx) {
    el.innerHTML = K.head('Активність', '<span class="wm-rate chip ok"></span>') +
      '<div class="wm-big"><b class="wm-total">0</b><span>' + esc(t('запитів · 24 год')) + '</span></div>' +
      '<div class="wm-bars">' + Array.from({ length: 24 }, (_, i) => '<div class="wm-col" style="--k:' + i + '"><i class="ok"></i><i class="bad"></i></div>').join('') + '</div>' +
      '<div class="chart-axis wm-axis"><span></span><span></span><span></span></div>';
    const cols = el.querySelectorAll('.wm-col');
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const b = K.series(m, 24);
      const max = Math.max(1, ...b.map((x) => x.ok + x.failed));
      let ok = 0;
      let bad = 0;
      b.forEach((x, i) => {
        ok += x.ok; bad += x.failed;
        const c = cols[i];
        const tot = x.ok + x.failed;
        c.style.setProperty('--h', ((tot / max) * 100).toFixed(1) + '%');
        c.style.setProperty('--f', tot ? ((x.failed / tot) * 100).toFixed(1) + '%' : '0%');
        c.classList.toggle('now', i === 23);
        c.classList.toggle('zero', !tot);
        c.dataset.tip = t('{when}: {ok} успішних / {bad} помилок', { when: x.label, ok: x.ok, bad: x.failed });
      });
      CL.ui.countTo(el.querySelector('.wm-total'), ok + bad, CL.fmtInt);
      const rate = el.querySelector('.wm-rate');
      rate.hidden = !(ok + bad);
      rate.className = 'wm-rate chip ' + (bad / Math.max(1, ok + bad) > 0.1 ? 'warn' : 'ok');
      rate.textContent = t('Успішність') + ' ' + Math.round((ok / Math.max(1, ok + bad)) * 100) + '%';
      el.querySelectorAll('.wm-axis span').forEach((s, i) => (s.textContent = b[[0, 12, 23][i]].label));
    };
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------- people --
  const STATE = { ok: ['працює', 'ok'], warn: ['близько до ліміту', 'warn'], limited: ['відпочиває', 'warn'], error: ['помилка', 'bad'], invalid: ['потрібен вхід', 'bad'], disabled: ['вимкнено', 'off'] };
  function people(el, ctx) {
    el.innerHTML = K.head('Твої акаунти', K.goto('accounts', 'Усі акаунти')) + '<div class="wm-psum"></div><div class="wm-people"></div>';
    K.onGoto(el);
    let sig = '';
    const paint = () => {
      const data = CL.data.get('accounts');
      if (!data) return;
      const a = K.summary(data);
      const s = JSON.stringify(a.list.map((x) => x.label + x.state));
      if (s === sig) return;
      sig = s;
      const box = el.querySelector('.wm-people');
      if (!a.total) {
        el.querySelector('.wm-psum').textContent = '';
        box.innerHTML = CL.ui.empty('users', 'Акаунтів ще немає', 'Почни зі звичайного Google-акаунта (Gemini-Antigravity) — це безкоштовно.', '<button class="btn primary sm" data-goto="accounts">' + ic('plus', 'sm') + esc(t('Додати акаунт')) + '</button>');
        return;
      }
      el.querySelector('.wm-psum').innerHTML = '<b>' + esc(t('{ok} з {n} працюють', { ok: a.ok, n: a.total })) + '</b>';
      const order = { error: 0, invalid: 0, limited: 1, warn: 2, ok: 3, disabled: 4 };
      const list = a.list.slice().sort((x, y) => (order[x.state] ?? 5) - (order[y.state] ?? 5));
      const shown = list.slice(0, 8);
      box.innerHTML = shown.map((x) => {
        const st = STATE[x.state] || [x.state || '—', 'off'];
        const name = String(x.label || '').replace(/@.*$/, '') || CL.provTitle(x.provider);
        return '<div class="wm-person ' + st[1] + '" data-tip="' + esc(x.label) + '"><span class="wm-face" style="--hue:' + (hash(x.label) % 360) + '">' + esc(initials(x.label)) + '</span>' +
          '<span class="wm-pn"><b class="ellipsis">' + esc(name) + '</b><span class="ellipsis">' + esc(CL.provTitle(x.provider)) + '</span></span><span class="wm-pill ' + st[1] + '">' + esc(t(st[0])) + '</span></div>';
      }).join('') + (list.length > shown.length ? '<button class="wm-more" data-goto="accounts">+' + (list.length - shown.length) + '</button>' : '');
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  // --------------------------------------------------------------- apps --
  function apps(el, ctx) {
    el.innerHTML = K.head('Хто звертався', K.goto('stats', 'Статистика')) + '<div class="wm-apps"></div>';
    K.onGoto(el);
    const paint = () => {
      const by = new Map();
      CL.data.feed.forEach((r) => { const k = r.app || t('невідома'); if (!by.has(k)) by.set(k, r); });
      const rows = [...by.entries()].slice(0, 5);
      el.querySelector('.wm-apps').innerHTML = rows.length ? rows.map(([app, r]) => '<div class="wm-app"><span class="wm-appic" style="--hue:' + (hash(app) % 360) + '">' + ic('plug', 'sm') + '</span>' +
        '<span class="wm-pn"><b class="ellipsis">' + esc(app) + '</b><span class="ellipsis">' + esc(CL.relTime(r.t) + ' · ' + served(r)) + '</span></span>' +
        '<span class="wm-pill ' + (r.ok ? 'ok' : 'bad') + '">' + esc(r.ok ? t('Успіх') : t('Помилка')) + '</span></div>').join('')
        : CL.ui.empty('plug', 'Тиша. Підключи програму — запити з’являться тут.', '', '<button class="btn sm" data-goto="connect">' + esc(t('Підключити')) + '</button>');
    };
    CL.data.watch(['feed', 'metrics'], paint, ctx);
    ctx.every(20000, paint);
    paint();
  }

  // ----------------------------------------------------------------- fx --
  function fx(host, still) {
    host.innerHTML = '<div class="wm-fx' + (still ? ' still' : '') + '"><i></i><i></i><i></i></div>';
    return null;
  }

  CL.design({
    id: 'warm',
    name: 'Теплий застосунок',
    desc: 'Привітний світлий застосунок: прості слова, великі м’які картки, акаунти як люди.',
    mode: 'light',
    shell: 'topbar',
    sw: ['#fbf3ea', '#ffffff', '#c4431a', '#f2a27c'],
    thumb: '<div class="th-wm"><span class="o"></span><b></b><i></i><em><s></s><s></s><s></s><s></s><s></s><s></s><s></s></em><u></u></div>',
    home: [{ id: 'setup', w: 12 }, { id: 'hero', w: 8 }, { id: 'warmModel', w: 4 }, { id: 'warmDay', w: 7 }, { id: 'warmPeople', w: 5 }, { id: 'warmApps', w: 6 }, { id: 'gateway', w: 6 }, { id: 'errors', w: 12 }],
    titles: { hero: 'Привітання', warmModel: 'Модель зараз', warmDay: 'Активність', warmPeople: 'Твої акаунти', warmApps: 'Хто звертався' },
    viz: { hero: hello },
    widgets: { warmModel: model, warmDay: day, warmPeople: people, warmApps: apps },
    fx,
  });
})();
