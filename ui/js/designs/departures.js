'use strict';
// Табло вокзалу — a split-flap departure board in a station concourse.
// Matte black housing, amber letters on dark tiles split by a hairline. The
// model now answering is the big flap row that clacks letter by letter when
// it changes; every request leaves as a departure (час · програма → модель ·
// платформа · статус); providers are platforms; the day's traffic is a
// segmented lamp timetable.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.:/';
  const calm = () => document.body.classList.contains('motion-off') ||
    (matchMedia('(prefers-reduced-motion: reduce)').matches && !document.body.classList.contains('motion-force'));
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '');
  const head = (title, extra) => '<div class="dep-h"><i class="dep-lamp"></i><span>' + esc(t(title)) + '</span><span class="grow"></span>' + (extra || '') + '</div>';
  const ACC_STATE = { ok: 'активний', warn: 'близько до ліміту', limited: 'ліміт', error: 'помилка', invalid: 'вхід відхилено', disabled: 'вимкнено' };
  const engineOn = (s) => !!(s && s.engine && s.engine.engineUp && !s.engine.paused);

  /**
   * Split-flap row: one tile per character. Only tiles whose letter changed
   * flip, running through a few random glyphs before landing (instant when
   * motion is off). `min` pads the row with blank tiles like a real board.
   */
  function flap(el, text, min) {
    const chars = Array.from(String(text).toUpperCase());
    const n = Math.max(min || 0, chars.length);
    while (chars.length < n) chars.push(' ');
    while (el.children.length < n) { const c = document.createElement('span'); c.className = 'dep-c'; c.innerHTML = '<b>&nbsp;</b>'; el.appendChild(c); }
    while (el.children.length > n) el.lastChild.remove();
    el.style.setProperty('--n', String(n));
    el.setAttribute('aria-label', String(text));
    const quiet = calm();
    chars.forEach((ch, i) => {
      const c = el.children[i];
      if (c.dataset.ch === ch) return;
      c.dataset.ch = ch;
      clearTimeout(c._tm);
      const b = c.firstChild;
      const put = (x) => { b.textContent = x === ' ' ? ' ' : x; };
      if (quiet) { put(ch); return; }
      let left = 1 + ((i * 7) % 4);
      const tick = () => {
        const land = left-- <= 0;
        put(land ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]);
        c.classList.toggle('alt');
        c.classList.add('go');
        if (!land) c._tm = setTimeout(tick, 64);
      };
      c._tm = setTimeout(tick, i * 26);
    });
  }

  // ---------------------------------------------------------------- hero --
  function hero(el, ctx) {
    el.innerHTML =
      '<div class="dep-top"><div class="dep-title"><span class="dep-sign">' + ic('send', 'sm') + '</span><b>CarteLink</b><span class="dep-where mono"></span></div>' +
      '<div class="dep-flaps dep-clock" role="timer"></div></div>' +
      '<div class="dep-cols"><span>' + esc(t('Модель зараз')) + '</span><span class="dep-state-l"></span></div>' +
      '<div class="dep-model-wrap"><div class="dep-flaps dep-model" role="heading" aria-level="2"></div></div>' +
      '<div class="dep-strip">' +
        '<div class="dep-cell"><span>' + esc(t('Шлюз')) + '</span><b class="dep-gw"><i class="dep-bulb"></i><em></em></b></div>' +
        '<div class="dep-cell"><span>' + esc(t('за годину')) + '</span><b class="dep-hour mono">0</b></div>' +
        '<div class="dep-cell"><span>' + esc(t('успішних')) + '</span><b class="dep-rate mono">—</b></div>' +
        '<div class="dep-cell dep-addr"><span>base_url</span><b class="mono ellipsis dep-base">—</b><button class="btn sm icon ghost dep-copy" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '</button></div>' +
      '</div>' +
      '<div class="dep-ctl"><div class="dep-pick"></div>' +
        '<button class="btn primary dep-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button>' +
        '<button class="btn dep-test">' + ic('activity', 'sm') + esc(t('Перевірити')) + '</button></div>';
    const q = (s) => el.querySelector(s);
    const picker = CL.ui.modelPicker(q('.dep-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();
    const paint = () => {
      const s = CL.status;
      if (!s) return;
      const m = s.mainModel || '';
      flap(q('.dep-model'), m || t('Модель не обрано'), 16);
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
      const e = s.engine || {};
      const on = engineOn(s);
      q('.dep-gw').className = 'dep-gw ' + (on ? 'ok' : e.restarting ? 'warn' : 'bad');
      q('.dep-gw em').textContent = t(e.restarting ? 'перезапуск' : e.paused ? 'пауза' : e.engineUp ? 'працює' : 'запуск…');
      q('.dep-state-l').textContent = on ? '' : t(e.paused ? 'пауза' : 'запуск…');
      const met = CL.data.get('metrics');
      if (met) {
        const h = K.series(met, 1)[0];
        q('.dep-hour').textContent = CL.fmtInt(h.ok + h.failed);
        const day = K.series(met, 24);
        const ok = day.reduce((a, x) => a + x.ok, 0);
        const all = ok + day.reduce((a, x) => a + x.failed, 0);
        q('.dep-rate').textContent = all ? Math.round((ok / all) * 100) + '%' : '—';
      }
      const ep = CL.data.get('endpoints');
      if (ep) {
        q('.dep-base').textContent = ep.base + '/v1';
        q('.dep-where').textContent = ep.base.replace(/^https?:\/\//, '');
        q('.dep-copy').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
      }
    };
    const clock = () => { const d = new Date(); flap(q('.dep-clock'), String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), 5); };
    clock();
    ctx.every(1000, clock);
    ctx.on('status', paint);
    CL.data.watch(['metrics', 'endpoints'], paint, ctx);
    paint();
    q('.dep-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    q('.dep-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const r = await CL.api.post('/test-model', { model: picker.get() || CL.mainModel() || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // --------------------------------------------------------------- board --
  const ROWS = 9;
  const stateOf = (r) => (!r.ok ? 'bad' : r.ms >= 20000 ? 'warn' : 'ok');
  const STATE_TEXT = { ok: 'Відправлено', warn: 'Затримка', bad: 'Скасовано' };
  const platform = (r) => {
    const p = r.provider ? CL.provTitle(r.provider) : r.account || r.key || '';
    return p || '—';
  };

  function board(el, ctx) {
    el.innerHTML = head('Відправлення', '<span class="dep-live mono"></span>') +
      '<div class="dep-board" role="table"><div class="dep-row dep-thead" role="row">' +
      ['Час', 'Програма', 'Модель', 'Платформа', 'Статус'].map((h) => '<span role="columnheader">' + esc(t(h)) + '</span>').join('') + '</div><div class="dep-rows"></div></div>';
    const box = el.querySelector('.dep-rows');
    let seen = null;
    const paint = () => {
      const rows = CL.data.feed.slice(0, ROWS);
      const sig = rows.map((r) => r.t + ':' + r.status).join('|');
      if (sig === seen) return;
      const known = new Set((seen || '').split('|'));
      const first = seen === null;
      seen = sig;
      const live = rows.filter((r) => !r.past && Date.now() - r.t < 3600000).length;
      el.querySelector('.dep-live').textContent = rows.length ? t('останні {n}', { n: rows.length }) : '';
      el.querySelector('.dep-live').classList.toggle('on', live > 0);
      let html = rows.map((r) => {
        const st = stateOf(r);
        const fresh = !first && !known.has(r.t + ':' + r.status);
        const tip = (r.model || '') + (served(r) && served(r) !== r.model ? ' → ' + served(r) : '') + ' · ' + r.status + (r.ms ? ' · ' + CL.fmtMs(r.ms) : '');
        return '<div class="dep-row' + (fresh ? ' fresh' : '') + '" role="row" data-tip="' + esc(tip) + '">' +
          '<span class="mono" style="--k:0">' + esc(CL.fmtTime(r.t).slice(0, 5)) + '</span>' +
          '<span class="ellipsis" style="--k:1">' + esc(r.app || t('Інше')) + '</span>' +
          '<span class="ellipsis dep-dest" style="--k:2">' + esc(served(r) || r.path || '—') + '</span>' +
          '<span class="ellipsis" style="--k:3">' + esc(platform(r)) + '</span>' +
          '<span class="dep-st ' + st + '" style="--k:4"><i></i>' + esc(t(STATE_TEXT[st])) + '</span></div>';
      }).join('');
      if (!rows.length) html = '<div class="dep-empty">' + esc(t('Тиша. Підключи програму — запити з’являться тут.')) + '</div>';
      for (let i = rows.length; i < ROWS && rows.length; i++) html += '<div class="dep-row dep-blank" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>';
      box.innerHTML = html;
    };
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------- gateway --
  function gate(el, ctx) {
    el.innerHTML = head('Шлюз') +
      '<div class="dep-flaps dep-gword"></div>' +
      '<div class="dep-nums">' +
        '<div><span>' + esc(t('запитів · 24 год')) + '</span><div class="dep-flaps dep-n1"></div></div>' +
        '<div><span>' + esc(t('помилок · 24 год')) + '</span><div class="dep-flaps dep-n2"></div></div>' +
      '</div>' +
      '<div class="gw-row"><span class="mono ellipsis gw-base">—</span><button class="btn sm icon dep-gcopy" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '</button><button class="btn sm icon dep-gkey" data-tip="' + esc(t('Копіювати ключ')) + '">' + ic('key', 'sm') + '</button></div>' +
      '<div class="row dep-gbtns"><button class="btn sm dep-start">' + ic('play', 'sm') + esc(t('Запустити')) + '</button><button class="btn sm dep-pause">' + ic('pause', 'sm') + esc(t('Пауза')) + '</button><button class="btn sm dep-restart">' + ic('rotate', 'sm') + esc(t('Перезапустити')) + '</button></div>' +
      '<div class="hint dep-gnote"></div>';
    const q = (s) => el.querySelector(s);
    const paint = () => {
      const s = CL.status;
      if (s) {
        const e = s.engine || {};
        const on = engineOn(s);
        flap(q('.dep-gword'), t(e.restarting ? 'перезапуск' : e.paused ? 'пауза' : e.engineUp ? 'працює' : 'запуск…'), 10);
        q('.dep-gword').dataset.state = on ? 'ok' : e.paused ? 'bad' : 'warn';
        q('.dep-start').disabled = on;
        q('.dep-pause').disabled = !e.engineUp || e.paused;
        q('.dep-restart').disabled = !!e.restarting;
        q('.dep-gnote').textContent = e.lastError ? t('Остання помилка: {e}', { e: e.lastError }) : '';
      }
      const met = CL.data.get('metrics');
      if (met) {
        const day = K.series(met, 24);
        flap(q('.dep-n1'), String(day.reduce((a, x) => a + x.ok + x.failed, 0)), 5);
        flap(q('.dep-n2'), String(day.reduce((a, x) => a + x.failed, 0)), 5);
        q('.dep-n2').classList.toggle('bad', day.some((x) => x.failed));
      }
      const ep = CL.data.get('endpoints');
      if (ep) {
        q('.gw-base').textContent = ep.base;
        q('.dep-gcopy').onclick = () => CL.copy(ep.base, 'Адресу скопійовано');
        q('.dep-gkey').onclick = () => CL.copy(ep.requireKey ? ep.key : 'any', 'Ключ скопійовано');
      }
    };
    ctx.on('status', paint);
    CL.data.watch(['metrics', 'endpoints'], paint, ctx);
    paint();
    const act = (kind) => (e) => CL.ui.busy(e.currentTarget, async () => {
      if (kind === 'stop' && !(await CL.confirm('Поставити шлюз на паузу? Програми отримуватимуть помилку, доки не натиснеш «Запустити».'))) return;
      const r = await CL.api.post('/server/' + kind);
      if (r.restarting) { CL.followRestart(r.host, r.port); return; }
      await CL.loadStatus();
    });
    q('.dep-start').addEventListener('click', act('start'));
    q('.dep-pause').addEventListener('click', act('stop'));
    q('.dep-restart').addEventListener('click', act('restart'));
  }

  // ----------------------------------------------------------- platforms --
  function platforms(el, ctx) {
    el.innerHTML = head('Акаунти', K.goto('accounts', 'Усі акаунти')) + '<div class="dep-plats">' + CL.ui.skeleton(3) + '</div><div class="dep-pfoot"></div>';
    K.onGoto(el);
    const STATE = { ok: 'на лінії', warn: 'частково', bad: 'не працює' };
    const paint = () => {
      const data = CL.data.get('accounts');
      if (!data) return;
      const a = K.summary(data);
      const box = el.querySelector('.dep-plats');
      if (!a.total) {
        box.innerHTML = CL.ui.empty('users', 'Акаунтів ще немає', 'Почни зі звичайного Google-акаунта (Gemini-Antigravity) — це безкоштовно.', '<button class="btn primary sm" data-goto="accounts">' + ic('plus', 'sm') + esc(t('Додати акаунт')) + '</button>');
        el.querySelector('.dep-pfoot').innerHTML = '';
        return;
      }
      box.innerHTML = K.byProvider(a.list).map((p, i) => {
        const st = p.ok === p.list.length ? 'ok' : p.ok ? 'warn' : 'bad';
        const use = Math.round(K.maxUse(p.list));
        return '<div class="dep-plat">' +
          '<span class="dep-pno">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="dep-pname ellipsis">' + esc(CL.provTitle(p.provider)) + '</span>' +
          '<span class="dep-cars">' + p.list.slice(0, 18).map((x) => '<i class="' + esc(x.state) + '" data-tip="' + esc(x.label + ' · ' + t(ACC_STATE[x.state] || x.state)) + '"></i>').join('') + '</span>' +
          '<span class="dep-use mono">' + (use ? use + '%' : '') + '</span>' +
          '<span class="mono dep-pn">' + p.ok + '/' + p.list.length + '</span>' +
          '<span class="dep-st ' + st + '"><i></i>' + esc(t(STATE[st])) + '</span></div>';
      }).join('');
      el.querySelector('.dep-pfoot').innerHTML = a.dead ? '<div class="card-foot">' + ic('broom', 'sm') + '<span class="grow">' + esc(t('{n} акаунт(ів) не працюють', { n: a.dead })) + '</span><button class="btn sm" data-goto="accounts">' + esc(t('Прибрати')) + '</button></div>' : '';
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  // --------------------------------------------------------------- hours --
  const SEG = 8;
  function hours(el, ctx) {
    el.innerHTML = head('Рух за добу', '<span class="dep-hsum mono"></span>') +
      '<div class="dep-hours">' + Array.from({ length: 24 }, (_, i) => '<div class="dep-hcol" style="--k:' + i + '">' + '<i></i>'.repeat(SEG) + '</div>').join('') + '</div>' +
      '<div class="dep-haxis mono"><span class="a0"></span><span class="a1"></span><span class="a2"></span><span>' + esc(t('зараз')) + '</span></div>';
    const cols = el.querySelectorAll('.dep-hcol');
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const b = K.series(m, 24);
      const max = Math.max(1, ...b.map((x) => x.ok + x.failed));
      b.forEach((x, i) => {
        const all = x.ok + x.failed;
        const lit = all ? Math.max(1, Math.round((all / max) * SEG)) : 0;
        const bad = x.failed ? Math.max(1, Math.round((x.failed / max) * SEG)) : 0;
        cols[i].querySelectorAll('i').forEach((seg, j) => {
          const n = SEG - j; // top segment first
          seg.className = n <= lit ? (n > lit - bad ? 'bad' : 'on') : '';
        });
        cols[i].dataset.tip = t('{when}: {ok} успішних / {bad} помилок', { when: x.label, ok: x.ok, bad: x.failed });
      });
      el.querySelector('.dep-hsum').textContent = t('{n} запитів за 24 год', { n: CL.fmtInt(b.reduce((s, x) => s + x.ok + x.failed, 0)) });
      el.querySelector('.a0').textContent = b[0].label;
      el.querySelector('.a1').textContent = b[8].label;
      el.querySelector('.a2').textContent = b[16].label;
    };
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // ---------------------------------------------------------- background --
  function fx(host) {
    host.innerHTML = '<div class="dep-fx"><i></i></div>';
  }

  CL.design({
    id: 'departures',
    name: 'Табло вокзалу',
    desc: 'Перекидне табло відправлень: модель гортається літерами, запити відходять рейсами, провайдери — платформи.',
    mode: 'dark',
    shell: 'sidebar',
    sw: ['#08090b', '#16191d', '#ffb000', '#3ccf7e'],
    thumb: '<div class="th-dep"><div class="th-dep-m">' + '<i></i>'.repeat(9) + '</div>' + '<p><s></s><s></s><s></s><u></u></p>'.repeat(3) + '</div>',
    home: [
      { id: 'setup', w: 12 }, { id: 'hero', w: 12 },
      { id: 'depBoard', w: 8 }, { id: 'depGate', w: 4 },
      { id: 'depPlatforms', w: 7 }, { id: 'depHours', w: 5 },
      { id: 'errors', w: 12 },
    ],
    titles: { hero: 'Модель зараз', depBoard: 'Відправлення', depGate: 'Шлюз', depPlatforms: 'Акаунти', depHours: 'Рух за добу' },
    viz: { hero },
    widgets: { depBoard: board, depGate: gate, depPlatforms: platforms, depHours: hours },
    fx,
  });
})();
