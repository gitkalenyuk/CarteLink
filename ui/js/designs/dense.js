'use strict';
// Японський щільний — a Japanese high-density portal: white ground, many
// small boxed modules with coloured header bars, 12px type, rule lines and
// blue links. Density is the design: a ticker of the newest requests runs
// across the top; models and programs are ranked with numbered badges and
// movement arrows; accounts read as an availability table (○ △ × －); the
// last 24 hours are a heat-tinted timetable.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  // ------------------------------------------------------------- helpers --
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '');
  /** Module header bar: c = red | blue | green | orange | navy | gray. */
  const head = (c, title, extra) => '<div class="jp-h jp-' + c + '"><b>' + esc(t(title)) + '</b><span class="grow"></span>' + (extra || '') + '</div>';
  const more = (page) => '<button class="jp-more" data-goto="' + page + '">' + esc(t('Усі')) + ' ›</button>';
  const badge = (i) => '<span class="jp-no' + (i < 3 ? ' n' + (i + 1) : '') + '">' + (i + 1) + '</span>';
  const sum = (b, k) => b.reduce((s, x) => s + (k === 'all' ? x.ok + x.failed : x[k]), 0);

  // -------------------------------------------------------------- ticker --
  function ticker(el, ctx) {
    el.innerHTML = '<div class="jp-tick"><span class="jp-tick-l">' + esc(t('Щойно')) + '</span>' +
      '<div class="jp-tick-win"><div class="jp-tick-track"></div></div><span class="jp-tick-r"></span></div>';
    const track = el.querySelector('.jp-tick-track');
    const item = (r) => '<span class="jp-ti ' + (r.ok ? 'ok' : 'bad') + '"><i class="mono">' + CL.fmtTime(r.t) + '</i><b>' + esc(r.app || t('Програма')) + '</b><span>→</span><u>' + esc(served(r) || r.path || '—') + '</u>' +
      '<em>' + esc(String(r.status)) + '</em>' + (r.ms ? '<s>' + esc(CL.fmtMs(r.ms)) + '</s>' : '') + '</span>';
    let sig = '';
    const paint = () => {
      const rows = CL.data.feed.slice(0, 12);
      const s = rows.map((r) => r.t + ':' + r.status).join('|');
      if (s !== sig) {
        const fresh = sig !== '';
        sig = s;
        if (!rows.length) {
          track.classList.remove('run');
          track.innerHTML = '<span class="jp-ti idle">' + esc(t('Запитів ще не було')) + '</span>';
        } else {
          const html = rows.map(item).join('');
          track.classList.remove('run');
          track.innerHTML = html + '<span class="jp-dup" aria-hidden="true">' + html + '</span>';
          track.style.setProperty('--n', String(rows.length));
          void track.offsetWidth;
          track.classList.add('run');
          if (fresh) track.firstElementChild.classList.add('new');
        }
      }
      const m = CL.data.get('metrics');
      if (m) { const h = K.series(m, 1)[0]; el.querySelector('.jp-tick-r').textContent = t('{n} за годину', { n: CL.fmtInt(h.ok + h.failed) }); }
    };
    CL.data.watch(['feed', 'metrics'], paint, ctx);
    paint();
  }

  // ---------------------------------------------------------------- hero --
  function hero(el, ctx) {
    el.innerHTML = head('red', 'Модель зараз', '<span class="jp-live"><span class="dot ok jp-dot"></span><span class="jp-state"></span></span>') +
      '<div class="jp-now-m nowmodel"></div>' +
      '<div class="jp-now-sub">' + esc(t('відповідає зараз на всі запити')) + '</div>' +
      '<div class="jp-now-ctl"><div class="jp-pick"></div>' +
      '<button class="btn primary sm jp-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button>' +
      '<button class="btn sm jp-test">' + esc(t('Перевірити')) + '</button></div>' +
      '<table class="jp-quote"><thead><tr><th>' + esc(t('Запити')) + '</th><th>' + esc(t('Успішність')) + '</th><th>' + esc(t('Сер. час')) + '</th><th>' + esc(t('Токени')) + '</th></tr></thead>' +
      '<tbody><tr><td><b class="q-req">—</b><small class="q-d"></small></td><td><b class="q-ok">—</b></td><td><b class="q-ms">—</b></td><td><b class="q-tok">—</b></td></tr></tbody>' +
      '<caption>' + esc(t('за 24 год')) + '</caption></table>' +
      '<div class="jp-base"><span>' + esc(t('Адреса')) + '</span><code class="mono ellipsis q-base">—</code>' +
      '<button class="btn sm icon jp-copy" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '</button></div>';
    const q = (s) => el.querySelector(s);
    const picker = CL.ui.modelPicker(q('.jp-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();
    const paintStatus = () => {
      const s = CL.status;
      if (!s) return;
      const m = s.mainModel || '';
      K.rollTo(q('.jp-now-m'), m || t('Модель не обрано'));
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
      const e = s.engine || {};
      const up = e.engineUp && !e.paused;
      q('.jp-dot').className = 'dot jp-dot ' + (up ? 'ok' : 'warn');
      q('.jp-state').textContent = t(e.restarting ? 'перезапуск' : e.paused ? 'пауза' : e.engineUp ? 'працює' : 'запуск…');
    };
    const paintNums = () => {
      const m = CL.data.get('metrics');
      if (m) {
        const b = K.series(m, 24);
        const all = sum(b, 'all');
        q('.q-req').textContent = CL.fmtInt(all);
        const d = (b[23].ok + b[23].failed) - (b[22].ok + b[22].failed);
        const dEl = q('.q-d');
        dEl.textContent = d ? (d > 0 ? '▲' : '▼') + Math.abs(d) : '';
        dEl.className = 'q-d ' + (d > 0 ? 'up' : 'dn');
        q('.q-ok').textContent = all ? Math.round((sum(b, 'ok') / all) * 100) + '%' : '—';
        q('.q-tok').textContent = CL.fmtNum(sum(b, 'tokens'));
        let ls = 0;
        let ln = 0;
        Object.values(m.model_stats || {}).forEach((x) => { ls += x.latency_sum || 0; ln += x.latency_n || 0; });
        q('.q-ms').textContent = ln ? CL.fmtMs(ls / ln) : '—';
      }
      const ep = CL.data.get('endpoints');
      if (ep) {
        q('.q-base').textContent = ep.base + '/v1';
        q('.jp-copy').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
      }
    };
    ctx.on('status', paintStatus);
    CL.data.watch(['metrics', 'endpoints'], paintNums, ctx);
    paintStatus();
    paintNums();
    q('.jp-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    q('.jp-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const m = picker.get() || CL.mainModel();
      const r = await CL.api.post('/test-model', { model: m || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // ------------------------------------------------------- model ranking --
  function rank(el, ctx) {
    let by = 'requests';
    el.innerHTML = head('blue', 'Рейтинг моделей', more('stats')) +
      '<div class="jp-tabs" role="tablist">' + [['requests', 'Запити'], ['total', 'Токени'], ['failed', 'Помилки']].map(([k, n]) =>
        '<button role="tab" data-by="' + k + '" class="' + (k === by ? 'on' : '') + '" aria-selected="' + (k === by) + '">' + esc(t(n)) + '</button>').join('') + '</div>' +
      '<ol class="jp-rank"></ol>';
    K.onGoto(el);
    const box = el.querySelector('.jp-rank');
    let sig = '';
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const list = Object.entries(m.model_stats || {}).filter(([, s]) => (s[by] || 0) > 0).sort((x, y) => (y[1][by] || 0) - (x[1][by] || 0)).slice(0, 8);
      // movement: rank among the last 40 requests vs the overall rank
      const recent = new Map();
      CL.data.feed.slice(0, 40).forEach((r) => { const k = served(r); if (k) recent.set(k, (recent.get(k) || 0) + 1); });
      const rOrder = [...recent.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
      const main = CL.mainModel();
      const s = by + JSON.stringify(list.map(([n, x]) => [n, x[by]])) + rOrder.join() + main;
      if (s === sig) return;
      sig = s;
      if (!list.length) { box.innerHTML = '<li class="jp-none">' + esc(t('Ще немає даних')) + '</li>'; return; }
      const top = Math.max(1, list.reduce((a, x) => a + (x[1][by] || 0), 0));
      box.innerHTML = list.map(([name, x], i) => {
        const j = rOrder.indexOf(name);
        const mv = j < 0 ? ['eq', '－'] : j < i ? ['up', '↑'] : j > i ? ['dn', '↓'] : ['eq', '→'];
        const tags = (name === main ? '<span class="jp-tag main">' + esc(t('зараз')) + '</span>' : '') +
          (j === 0 && recent.get(name) >= 3 ? '<span class="jp-tag hot">' + esc(t('хіт')) + '</span>' : '') +
          ((x.requests || 0) <= 3 ? '<span class="jp-tag new">' + esc(t('нова')) + '</span>' : '');
        const v = x[by] || 0;
        return '<li class="jp-r' + (name === main ? ' cur' : '') + '">' + badge(i) + '<span class="jp-mv ' + mv[0] + '" data-tip="' + esc(t('Рух за останніми запитами')) + '">' + mv[1] + '</span>' +
          '<span class="jp-name ellipsis" title="' + esc(name) + '">' + esc(name) + '</span><span class="jp-tags">' + tags + '</span>' +
          '<span class="jp-val num">' + esc(by === 'total' ? CL.fmtNum(v) : CL.fmtInt(v)) + '<small>' + Math.round((v / top) * 100) + '%</small></span></li>';
      }).join('');
    };
    el.querySelector('.jp-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-by]');
      if (!b) return;
      by = b.dataset.by;
      el.querySelectorAll('.jp-tabs button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
      paint();
    });
    ctx.on('status', paint);
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  }

  // ----------------------------------------------------- program ranking --
  function apps(el, ctx) {
    el.innerHTML = head('orange', 'Рейтинг програм', more('connect')) + '<ol class="jp-rank"></ol>';
    K.onGoto(el);
    const box = el.querySelector('.jp-rank');
    let sig = '';
    const paint = () => {
      const m = CL.data.get('metrics');
      let list = Object.entries((m && m.app_stats) || {}).map(([name, s]) => ({ name, n: s.requests || 0, fail: s.failed || 0, last: s.last || 0 }));
      if (!list.length) list = CL.data.route().apps.map((a) => ({ name: a.name, n: a.n, fail: a.fail, last: 0 }));
      list = list.filter((a) => a.n > 0).sort((a, b) => b.n - a.n).slice(0, 7);
      const s = JSON.stringify(list.map((a) => [a.name, a.n, a.fail]));
      if (s === sig) return;
      sig = s;
      box.innerHTML = list.length ? list.map((a, i) => '<li class="jp-r app">' + badge(i) + '<span class="jp-name ellipsis">' + esc(a.name) + '</span>' +
        (a.fail ? '<span class="jp-fail num" data-tip="' + esc(t('{n} помилок', { n: CL.fmtInt(a.fail) })) + '">×' + CL.fmtInt(a.fail) + '</span>' : '<span></span>') +
        '<span class="jp-val num">' + CL.fmtInt(a.n) + '</span></li>').join('')
        : '<li class="jp-none">' + esc(t('Тиша. Підключи програму — запити з’являться тут.')) + '</li>';
    };
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  }

  // ------------------------------------------- accounts availability --
  const SYM = { ok: ['s-ok', '○'], warn: ['s-warn', '○'], limited: ['s-lim', '△'], error: ['s-bad', '×'], invalid: ['s-bad', '×'], disabled: ['s-off', '－'] };
  function accounts(el, ctx) {
    el.innerHTML = head('green', 'Акаунти', more('accounts')) + '<div class="jp-acc"></div>' +
      '<div class="jp-legend"><span><i class="s-ok">○</i>' + esc(t('працює')) + '</span><span><i class="s-lim">△</i>' + esc(t('ліміт')) + '</span>' +
      '<span><i class="s-bad">×</i>' + esc(t('не працює')) + '</span><span><i class="s-off">－</i>' + esc(t('вимкнено')) + '</span></div>';
    K.onGoto(el);
    const box = el.querySelector('.jp-acc');
    let sig = '';
    const paint = () => {
      const data = CL.data.get('accounts');
      if (!data) return;
      const a = K.summary(data);
      const s = JSON.stringify(a.list.map((x) => [x.label, x.state]));
      if (s === sig) return;
      sig = s;
      if (!a.total) {
        box.innerHTML = CL.ui.empty('users', 'Акаунтів ще немає', 'Почни зі звичайного Google-акаунта (Gemini-Antigravity) — це безкоштовно.', '<button class="btn primary sm" data-goto="accounts">' + ic('plus', 'sm') + esc(t('Додати акаунт')) + '</button>');
        return;
      }
      const cnt = (l, st) => l.filter((x) => st.includes(x.state)).length;
      box.innerHTML = '<div class="jp-sum"><b class="num">' + a.ok + '<small>/' + a.total + '</small></b><span>' + esc(t('{ok} з {n} працюють', { ok: a.ok, n: a.total })) + '</span></div>' +
        '<table class="jp-av"><thead><tr><th>' + esc(t('Провайдер')) + '</th><th class="sy"></th><th class="c s-ok">○</th><th class="c s-lim">△</th><th class="c s-bad">×</th></tr></thead><tbody>' +
        K.byProvider(a.list).map((p) => '<tr><th scope="row" class="ellipsis">' + esc(CL.provTitle(p.provider)) + '</th><td class="sy">' +
          p.list.slice(0, 40).map((x) => { const y = SYM[x.state] || SYM.disabled; return '<i class="' + y[0] + '" data-tip="' + esc(x.label + ' · ' + x.state) + '">' + y[1] + '</i>'; }).join('') + '</td>' +
          '<td class="c s-ok num">' + cnt(p.list, ['ok', 'warn']) + '</td><td class="c s-lim num">' + cnt(p.list, ['limited']) + '</td><td class="c s-bad num">' + cnt(p.list, ['error', 'invalid']) + '</td></tr>').join('') +
        '</tbody></table>';
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------ hourly table --
  function hours(el, ctx) {
    const ROWS = [['all', 'Запити'], ['failed', 'Помилки'], ['tokens', 'Токени']];
    const band = (k) => '<table class="jp-ht"><thead><tr><th></th>' + '<th class="hh"></th>'.repeat(12) + '</tr></thead><tbody>' +
      ROWS.map(([key, name]) => '<tr data-k="' + key + '"><th scope="row">' + esc(t(name)) + '</th>' + '<td></td>'.repeat(12) + '</tr>').join('') + '</tbody></table>';
    el.innerHTML = head('navy', 'Погодинно', '<span class="jp-hs"></span>') + '<div class="jp-hrs">' + band(0) + band(1) + '</div>';
    const tables = el.querySelectorAll('.jp-ht');
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const b = K.series(m, 24);
      const val = (x, k) => (k === 'all' ? x.ok + x.failed : x[k]);
      const max = {};
      ROWS.forEach(([k]) => { max[k] = Math.max(1, ...b.map((x) => val(x, k))); });
      el.querySelector('.jp-hs').textContent = t('{n} запитів за 24 год', { n: CL.fmtInt(sum(b, 'all')) });
      tables.forEach((tb, half) => {
        const part = b.slice(half * 12, half * 12 + 12);
        tb.querySelectorAll('thead .hh').forEach((th, i) => {
          th.textContent = part[i].label.slice(0, 2);
          th.classList.toggle('cur', half === 1 && i === 11);
        });
        ROWS.forEach(([k]) => {
          tb.querySelectorAll('tr[data-k="' + k + '"] td').forEach((td, i) => {
            const v = val(part[i], k);
            const h = v / max[k];
            td.textContent = v ? (k === 'tokens' ? CL.fmtNum(v) : CL.fmtInt(v)) : '·';
            td.className = (v ? '' : 'z') + (half === 1 && i === 11 ? ' cur' : '');
            td.style.background = v ? (k === 'failed' ? 'rgba(200,0,11,' : k === 'tokens' ? 'rgba(26,79,160,' : 'rgba(21,122,46,') + (0.06 + h * 0.3).toFixed(3) + ')' : '';
            td.dataset.tip = t('{when}: {ok} успішних / {bad} помилок', { when: part[i].label, ok: part[i].ok, bad: part[i].failed });
          });
        });
      });
    };
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------ gateway --
  function gate(el, ctx) {
    el.innerHTML = head('gray', 'Шлюз', '<span class="chip jp-gchip"></span>') +
      '<table class="jp-kv"><tbody>' +
      '<tr><th>' + esc(t('Адреса')) + '</th><td><div class="jp-gb"><span class="mono ellipsis jp-gbase">—</span><button class="btn sm icon ghost jp-gcopy" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '</button></div></td></tr>' +
      '<tr><th>' + esc(t('Ключ')) + '</th><td><button class="linkbtn jp-gkey">' + esc(t('Копіювати ключ')) + '</button></td></tr>' +
      '<tr><th>' + esc(t('Помилки')) + '</th><td class="jp-gerr num">—</td></tr>' +
      '<tr><th>' + esc(t('Акаунти')) + '</th><td class="jp-gacc">—</td></tr>' +
      '</tbody></table>' +
      '<div class="jp-gbtn"><button class="btn sm gw-start">' + ic('play', 'sm') + esc(t('Запустити')) + '</button><button class="btn sm gw-pause">' + ic('pause', 'sm') + esc(t('Пауза')) + '</button>' +
      '<button class="btn sm icon gw-restart" data-tip="' + esc(t('Перезапустити')) + '">' + ic('rotate', 'sm') + '</button></div><div class="hint jp-gnote"></div>';
    const q = (s) => el.querySelector(s);
    const paint = () => {
      const s = CL.status;
      if (s) {
        const e = s.engine || {};
        const chip = q('.jp-gchip');
        chip.className = 'chip jp-gchip ' + (e.engineUp && !e.paused ? 'ok' : 'warn');
        chip.textContent = t(e.restarting ? 'перезапуск' : e.paused ? 'пауза' : e.engineUp ? 'працює' : 'запуск…');
        q('.gw-start').disabled = e.engineUp && !e.paused;
        q('.gw-pause').disabled = !e.engineUp || e.paused;
        q('.gw-restart').disabled = !!e.restarting;
        q('.jp-gnote').textContent = e.lastError ? t('Остання помилка: {e}', { e: e.lastError }) : '';
        q('.jp-gerr').textContent = t('{n} помилок за добу', { n: s.errors24h || 0 });
        q('.jp-gerr').classList.toggle('bad', !!s.errors24h);
      }
      const acc = CL.data.get('accounts');
      if (acc) { const a = K.summary(acc); q('.jp-gacc').textContent = a.total ? t('{ok} з {n} працюють', { ok: a.ok, n: a.total }) : t('не підключено'); }
      const ep = CL.data.get('endpoints');
      if (ep) {
        q('.jp-gbase').textContent = ep.base + '/v1';
        q('.jp-gcopy').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
        q('.jp-gkey').onclick = () => CL.copy(ep.requireKey ? ep.key : 'any', 'Ключ скопійовано');
      }
    };
    ctx.on('status', paint);
    CL.data.watch(['accounts', 'endpoints'], paint, ctx);
    paint();
    const act = (kind) => (e) => CL.ui.busy(e.currentTarget, async () => {
      if (kind === 'stop' && !(await CL.confirm('Поставити шлюз на паузу? Програми отримуватимуть помилку, доки не натиснеш «Запустити».'))) return;
      const r = await CL.api.post('/server/' + kind);
      if (r.restarting) { CL.followRestart(r.host, r.port); return; }
      await CL.loadStatus();
    });
    q('.gw-start').addEventListener('click', act('start'));
    q('.gw-pause').addEventListener('click', act('stop'));
    q('.gw-restart').addEventListener('click', act('restart'));
  }

  // --------------------------------------------------------- quick links --
  function links(el) {
    const ids = ['accounts', 'models', 'connect', 'keys', 'providers', 'prompt', 'plugins', 'stats', 'settings', 'help'];
    const pages = ids.map((id) => CL.pageMap && CL.pageMap[id]).filter(Boolean);
    el.innerHTML = head('red', 'Швидкі посилання') + '<div class="jp-links">' +
      pages.map((p) => '<button class="jp-link" data-goto="' + p.id + '">' + esc(t(p.title)) + '</button>').join('') + '</div>';
    K.onGoto(el);
  }

  CL.design({
    id: 'dense',
    name: 'Японський щільний',
    desc: 'Щільний портал: кольорові модулі, рейтинги з номерами, рядок новин запитів і таблиця годин.',
    mode: 'light',
    shell: 'topbar',
    sw: ['#eef0f3', '#ffffff', '#c8000b', '#1a4fa0'],
    thumb: '<div class="th-jp"><b></b><u><s></s><s></s><s></s><s></s><s></s></u><em><i></i><i></i><i></i><i></i><i></i><i></i></em></div>',
    home: [
      { id: 'setup', w: 12 }, { id: 'denseTicker', w: 12 },
      { id: 'hero', w: 5 }, { id: 'denseRank', w: 4 }, { id: 'denseGate', w: 3 },
      { id: 'denseAcc', w: 5 }, { id: 'denseHours', w: 7 },
      { id: 'denseApps', w: 4 }, { id: 'errors', w: 5 }, { id: 'denseLinks', w: 3 },
    ],
    titles: {
      denseTicker: 'Щойно', denseRank: 'Рейтинг моделей', denseApps: 'Рейтинг програм', denseAcc: 'Акаунти',
      denseHours: 'Погодинно', denseGate: 'Шлюз', denseLinks: 'Швидкі посилання',
    },
    viz: { hero },
    widgets: { denseTicker: ticker, denseRank: rank, denseApps: apps, denseAcc: accounts, denseHours: hours, denseGate: gate, denseLinks: links },
  });
})();
