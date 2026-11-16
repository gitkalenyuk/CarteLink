'use strict';
// Datamatics — pure black and white data field. No colour, no rounding,
// uppercase mono. The model name is set as a monumental multiline title;
// traffic becomes barcodes and a sine field; health is read from glyphs
// (■ live, □ idle, ▨ failing), never from colour.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  const head = (code, title, extra) => '<div class="dm-head"><span class="dm-code">' + esc(code) + '</span><span>' + esc(t(title)) + '</span><span class="grow"></span>' + (extra || '') + '</div>';
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '');

  /** Barcode: one bar per value, width/height encode magnitude. */
  const barcode = (vals, cls) => {
    const max = Math.max(1, ...vals);
    return '<div class="dm-code-bars ' + (cls || '') + '">' + vals.map((v) => '<i style="--v:' + (v / max).toFixed(3) + '"></i>').join('') + '</div>';
  };

  // ---------------------------------------------------------------- hero --
  function hero(el, ctx) {
    el.innerHTML = head('00', 'Модель зараз', '<span class="dm-clock mono"></span>') +
      '<h2 class="dm-title"></h2>' +
      '<div class="dm-hero-foot"><div class="dm-pick"></div>' +
      '<button class="btn primary dm-apply">' + esc(t('Застосувати до всього')) + '</button>' +
      '<button class="btn dm-copy">' + ic('copy', 'sm') + '<span class="dm-base mono">—</span></button></div>';
    const picker = CL.ui.modelPicker(el.querySelector('.dm-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();
    const paint = () => {
      const m = CL.mainModel();
      const title = el.querySelector('.dm-title');
      const text = (m || t('Модель не обрано')).toUpperCase();
      if (title.dataset.text !== text) {
        title.dataset.text = text;
        // break on separators so long ids stack as monumental lines
        const lines = [];
        text.split(/(?<=[-/:])/).forEach((p) => { const l = lines.length - 1; if (l >= 0 && (lines[l] + p).length <= 13) lines[l] += p; else lines.push(p); });
        title.innerHTML = lines.map((p) => '<span>' + esc(p) + '</span>').join('');
      }
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
      const ep = CL.data.get('endpoints');
      if (ep) {
        el.querySelector('.dm-base').textContent = ep.base + '/v1';
        el.querySelector('.dm-copy').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
      }
    };
    const clock = () => { el.querySelector('.dm-clock').textContent = CL.fmtTime(Date.now()); };
    clock();
    ctx.every(1000, clock);
    ctx.on('status', paint);
    CL.data.watch(['endpoints'], paint, ctx);
    paint();
    el.querySelector('.dm-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
  }

  // -------------------------------------------------------------- signal --
  function signal(el, ctx) {
    el.innerHTML = head('01', 'Огляд сигналу') +
      '<div class="dm-big"><b class="dm-total">0</b><span>' + esc(t('запитів · 24 год')) + '</span></div>' +
      '<div class="dm-big"><b class="dm-rate">—</b><span>' + esc(t('успішних')) + '</span></div>' +
      '<div class="dm-big"><b class="dm-tok">0</b><span>' + esc(t('токенів · 24 год')) + '</span></div>' +
      '<div class="dm-sline mono"></div>';
    const paint = () => {
      const m = CL.data.get('metrics');
      const b = K.series(m, 24);
      const ok = b.reduce((s, x) => s + x.ok, 0);
      const bad = b.reduce((s, x) => s + x.failed, 0);
      el.querySelector('.dm-total').textContent = CL.fmtInt(ok + bad);
      el.querySelector('.dm-rate').textContent = ok + bad ? pct(ok, ok + bad) + '%' : '—';
      el.querySelector('.dm-tok').textContent = CL.fmtNum(b.reduce((s, x) => s + x.tokens, 0));
      const s = CL.status || {};
      const e = s.engine || {};
      el.querySelector('.dm-sline').textContent = [
        (e.engineUp && !e.paused ? '■ ' + t('шлюз') : '□ ' + t('шлюз')),
        t('помилок {n}', { n: s.errors24h || 0 }),
      ].join('   ').toUpperCase();
    };
    ctx.on('status', paint);
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------ waveform --
  function wave(el, ctx) {
    el.innerHTML = head('02', 'Активність', '<span class="dm-meta mono"></span>') + '<div class="dm-wave"></div><div class="dm-axis mono"><span>-24H</span><span>-12H</span><span>' + esc(t('зараз')) + '</span></div>';
    const paint = () => {
      const b = K.series(CL.data.get('metrics'), 24);
      const vals = b.map((x) => x.ok + x.failed);
      const fails = b.map((x) => x.failed);
      el.querySelector('.dm-wave').innerHTML = barcode(vals, 'tall') + barcode(fails, 'neg');
      el.querySelector('.dm-meta').textContent = t('пік {n}/год', { n: Math.max(0, ...vals) }).toUpperCase();
    };
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // -------------------------------------------------------------- models --
  function topModels(el, ctx) {
    el.innerHTML = head('03', 'Топ моделей') + '<div class="dm-rows"></div>';
    const paint = () => {
      const m = CL.data.get('metrics');
      const list = Object.entries((m && m.model_stats) || {}).sort((x, y) => y[1].requests - x[1].requests).slice(0, 6);
      const total = list.reduce((s, x) => s + x[1].requests, 0);
      el.querySelector('.dm-rows').innerHTML = list.length ? list.map(([name, s], i) => {
        const p = pct(s.requests, total);
        return '<div class="dm-row"><span class="dm-n">' + String(i + 1).padStart(2, '0') + '</span><span class="ellipsis">' + esc(name.toUpperCase()) + '</span><span class="dm-pbar"><i style="transform:scaleX(' + (p / 100).toFixed(3) + ')"></i></span><span class="mono">' + p.toFixed(1) + '%</span></div>';
      }).join('') : '<div class="dm-empty">' + esc(t('Ще немає даних')) + '</div>';
    };
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------- streams --
  function streams(el, ctx) {
    el.innerHTML = head('04', 'Живі потоки') + '<div class="dm-rows"></div>';
    const paint = () => {
      const now = Date.now();
      const by = new Map();
      CL.data.feed.forEach((r) => { const k = r.app || t('невідома'); if (!by.has(k)) by.set(k, r); });
      const rows = [...by.entries()].slice(0, 6);
      el.querySelector('.dm-rows').innerHTML = rows.length ? rows.map(([app, r]) => {
        const live = now - r.t < 60000;
        const st = !r.ok ? 'ERR' : live ? 'LIVE' : 'IDLE';
        return '<div class="dm-row s"><span class="dm-g">' + (!r.ok ? '▨' : live ? '■' : '□') + '</span><span class="ellipsis">' + esc(app.toUpperCase()) + '</span><span class="ellipsis faint">' + esc(served(r).toUpperCase()) + '</span><span class="dm-tag' + (live ? ' on' : '') + '">' + st + '</span></div>';
      }).join('') : '<div class="dm-empty">' + esc(t('Тиша. Підключи програму — запити з’являться тут.')) + '</div>';
    };
    CL.data.watch(['feed', 'metrics'], paint, ctx);
    ctx.every(15000, paint);
    paint();
  }

  // -------------------------------------------------------------- health --
  function health(el, ctx) {
    el.innerHTML = head('05', 'Стан провайдерів', '<button class="linkbtn small" data-goto="accounts">' + esc(t('Акаунти')) + '</button>') + '<div class="dm-rows"></div>';
    K.onGoto(el);
    const paint = () => {
      const a = K.summary(CL.data.get('accounts'));
      el.querySelector('.dm-rows').innerHTML = a.total ? K.byProvider(a.list).map((p) => {
        const cells = p.list.slice(0, 24).map((x) => '<i class="' + esc(x.state) + '" data-tip="' + esc(x.label + ' · ' + x.state) + '"></i>').join('');
        return '<div class="dm-row h"><span class="ellipsis">' + esc(CL.provTitle(p.provider).toUpperCase()) + '</span><span class="dm-cells">' + cells + '</span><span class="mono">' + p.ok + '/' + p.list.length + '</span></div>';
      }).join('') : '<div class="dm-empty">' + esc(t('Акаунтів ще немає')) + '</div>';
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  CL.design({
    id: 'datamatics',
    name: 'Datamatics',
    desc: 'Чисте чорно-біле поле даних: штрихкоди, синусоїда, моноширинні великі літери.',
    mode: 'dark',
    shell: 'topbar',
    sw: ['#000000', '#0b0b0b', '#ffffff', '#8f8f8f'],
    thumb: '<div class="th-dm"><b></b><b></b><em>' + '<i></i>'.repeat(28) + '</em></div>',
    home: [{ id: 'setup', w: 12 }, { id: 'hero', w: 8 }, { id: 'signal', w: 4 }, { id: 'wave', w: 12 }, { id: 'dmodels', w: 4 }, { id: 'streams', w: 4 }, { id: 'health', w: 4 }, { id: 'errors', w: 12 }],
    titles: { signal: 'Огляд сигналу', wave: 'Активність', dmodels: 'Топ моделей', streams: 'Живі потоки', health: 'Стан провайдерів' },
    viz: { hero },
    widgets: { signal, wave, dmodels: topModels, streams, health },
    fx: (host, still) => CL.look.barcode(host, still),
  });
})();
