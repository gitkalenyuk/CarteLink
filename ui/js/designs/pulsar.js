'use strict';
// Пульсар — a record sleeve. Pure black, one stack of white ridge lines in
// the middle and tiny catalogue type in the corners. Each ridge is one hour
// of real traffic (oldest at the top, the current hour at the bottom): quiet
// hours lie flat, busy hours rise, every recent request is a spike at its
// minute. Lower ridges are filled black and hide the ones behind, like the
// plot on the sleeve. Everything else is a quiet panel of credits.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  const HOUR = 3600000;
  const STATE = { ok: 'активний', warn: 'близько до ліміту', limited: 'ліміт', error: 'помилка', invalid: 'вхід відхилено', disabled: 'вимкнено' };
  const PTS = 112;
  const RIDGES = 24;
  const still = () => {
    const b = document.body.classList;
    return b.contains('motion-off') || (matchMedia('(prefers-reduced-motion: reduce)').matches && !b.contains('motion-force'));
  };
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '');
  const head = (title, extra) => '<div class="psr-h"><span class="psr-code"></span><h2>' + esc(t(title)) + '</h2><span class="grow"></span>' + (extra || '') + '</div>';
  const rng = (seed) => {
    let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
    return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  };
  const engineUp = () => { const e = (CL.status && CL.status.engine) || {}; return !!(e.engineUp && !e.paused); };
  const engineWord = () => {
    const e = (CL.status && CL.status.engine) || {};
    return t(e.restarting ? 'перезапуск' : e.paused ? 'пауза' : e.engineUp ? 'працює' : 'запуск…');
  };

  /** One ridge profile (0…~1 per point) for an hour bucket. */
  function profile(b, rows, max) {
    const out = new Float32Array(PTS);
    const r = rng(Math.floor(b.at / HOUR) * 7919 + 13);
    const v = b.ok + b.failed;
    const amp = v ? 0.25 + 0.75 * Math.sqrt(v / max) : 0;
    const sum = new Float32Array(PTS);
    const bump = (c, w, h) => { for (let k = 0; k < PTS; k++) { const d = (k / (PTS - 1) - c) / w; if (d > -4 && d < 4) sum[k] += h * Math.exp(-d * d); } };
    const n = v ? Math.min(16, 3 + Math.round(Math.sqrt(v) * 1.6)) : 0;
    for (let i = 0; i < n; i++) bump(0.32 + r() * 0.36, 0.012 + r() * 0.045, (0.35 + r() * 0.9) * amp);
    rows.forEach((x) => bump(0.24 + ((x.t - b.at) / HOUR) * 0.52, 0.008, x.ok ? 0.55 : 0.85));
    for (let k = 0; k < PTS; k++) {
      const x = k / (PTS - 1);
      const env = Math.exp(-Math.pow((x - 0.5) / 0.23, 4));
      out[k] = r() * 0.022 + (1 - Math.exp(-sum[k] * 1.25)) * env;
    }
    return out;
  }

  // ---------------------------------------------------------------- hero --
  function hero(el, ctx) {
    el.innerHTML =
      '<div class="psr-hero">' +
        '<figure class="psr-sleeve">' +
          '<span class="psr-c tl">CL-300</span><span class="psr-c tr psr-range"></span>' +
          '<div class="psr-plot"><canvas></canvas></div>' +
          '<figcaption class="psr-c bl psr-cap"></figcaption><span class="psr-c br psr-ed"></span>' +
        '</figure>' +
        '<div class="psr-info">' +
          '<div class="psr-label">' + esc(t('Модель зараз')) + '</div>' +
          '<h2 class="psr-model nowmodel"></h2>' +
          '<div class="psr-state"><span class="dot psr-dot"></span><span class="psr-k">' + esc(t('Шлюз')) + '</span><span class="psr-v psr-eng"></span></div>' +
          '<div class="psr-pick"></div>' +
          '<div class="psr-act"><button class="btn primary psr-apply">' + esc(t('Застосувати до всього')) + '</button>' +
          '<button class="btn psr-test">' + ic('activity', 'sm') + esc(t('Перевірити')) + '</button></div>' +
          '<dl class="psr-mini">' +
            '<div><dt>' + esc(t('Запити')) + '</dt><dd class="psr-n-req">—</dd></div>' +
            '<div><dt>' + esc(t('Успішність')) + '</dt><dd class="psr-n-ok">—</dd></div>' +
            '<div><dt>' + esc(t('Токени')) + '</dt><dd class="psr-n-tok">—</dd></div>' +
          '</dl>' +
        '</div>' +
      '</div>';
    const q = (s) => el.querySelector(s);
    const picker = CL.ui.modelPicker(q('.psr-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();

    const paintStatus = () => {
      const m = CL.mainModel();
      K.rollTo(q('.psr-model'), m || t('не обрано'));
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
      q('.psr-dot').className = 'dot psr-dot ' + (engineUp() ? 'ok' : 'warn');
      q('.psr-eng').textContent = engineWord();
      q('.psr-ed').textContent = (CL.status && CL.status.version) || '';
    };

    // ------------------------------------------------ ridge plot (canvas)
    const wrap = q('.psr-plot');
    const cv = wrap.querySelector('canvas');
    const g = cv.getContext('2d');
    let buckets = [];
    let cur = new Map();
    let from = new Map();
    let to = new Map();
    let t0 = 0;
    let stagger = false;
    let raf = 0;
    let hover = -1;
    let geo = null;
    let defaultCap = '';

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(10, wrap.clientWidth);
      const h = Math.max(10, wrap.clientHeight);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      geo = { w, h, dpr };
    };
    const draw = () => {
      if (!geo) size();
      const { w, h, dpr } = geo;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!buckets.length) return;
      const n = buckets.length;
      const x0 = w * 0.1;
      const x1 = w * 0.9;
      const rise = Math.min(h * 0.24, 92);
      const top = rise * 0.82 + 6;
      const gap = (h - top - 8) / (n - 1);
      geo.top = top;
      geo.gap = gap;
      g.lineJoin = 'round';
      buckets.forEach((b, i) => {
        const p = cur.get(b.at);
        if (!p) return;
        const base = top + i * gap;
        g.beginPath();
        for (let k = 0; k < PTS; k++) {
          const x = x0 + ((x1 - x0) * k) / (PTS - 1);
          const y = base - p[k] * rise;
          if (k) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.lineTo(x1, base + 1.5);
        g.lineTo(x0, base + 1.5);
        g.closePath();
        g.fillStyle = '#000';
        g.fill();
        g.beginPath();
        for (let k = 0; k < PTS; k++) {
          const x = x0 + ((x1 - x0) * k) / (PTS - 1);
          const y = base - p[k] * rise;
          if (k) g.lineTo(x, y); else g.moveTo(x, y);
        }
        const on = i === hover;
        g.strokeStyle = on ? '#fff' : hover >= 0 ? 'rgba(236,235,230,0.55)' : 'rgba(236,235,230,0.92)';
        g.lineWidth = on ? 2 : 1.15;
        g.stroke();
        if (b.failed) {
          g.fillStyle = '#ff5a36';
          g.fillRect(x0 - 14, base - 1, Math.min(10, 3 + b.failed), 2);
        }
        if (i === n - 1) {
          g.fillStyle = '#ecebe6';
          g.fillRect(x1 + 6, base - 1, 6, 2);
        }
      });
    };
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    const step = (now) => {
      raf = 0;
      let done = true;
      buckets.forEach((b, i) => {
        const a = from.get(b.at) || new Float32Array(PTS);
        const z = to.get(b.at);
        if (!z) return;
        const delay = stagger ? i * 38 : 0;
        const p = Math.max(0, Math.min(1, (now - t0 - delay) / 720));
        if (p < 1) done = false;
        const e = ease(p);
        const c = new Float32Array(PTS);
        for (let k = 0; k < PTS; k++) c[k] = a[k] + (z[k] - a[k]) * e;
        cur.set(b.at, c);
      });
      draw();
      if (!done && ctx.alive()) raf = requestAnimationFrame(step);
    };

    const paintPlot = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      buckets = K.series(m, RIDGES);
      const max = Math.max(1, ...buckets.map((b) => b.ok + b.failed));
      const first = !to.size;
      const next = new Map();
      buckets.forEach((b) => next.set(b.at, profile(b, CL.data.feed.filter((r) => r.t >= b.at && r.t < b.at + HOUR), max)));
      const sig = (mp) => [...mp.entries()].map(([k, v]) => k + ':' + v.reduce((s, x) => s + x, 0).toFixed(3)).join('|');
      if (!first && sig(next) === sig(to)) return;
      from = new Map(cur);
      to = next;
      const total = buckets.reduce((s, b) => s + b.ok + b.failed, 0);
      const ok = buckets.reduce((s, b) => s + b.ok, 0);
      defaultCap = t('{n} запитів за 24 год', { n: CL.fmtInt(total) });
      if (hover < 0) q('.psr-cap').textContent = defaultCap;
      q('.psr-range').textContent = buckets[0].label + ' — ' + buckets[buckets.length - 1].label;
      q('.psr-n-req').textContent = CL.fmtInt(total);
      q('.psr-n-ok').textContent = total ? Math.round((ok / total) * 1000) / 10 + '%' : '—';
      q('.psr-n-tok').textContent = CL.fmtNum(buckets.reduce((s, b) => s + b.tokens, 0));
      if (still()) { cur = new Map(to); draw(); return; }
      stagger = first;
      t0 = performance.now();
      if (!raf) raf = requestAnimationFrame(step);
    };

    cv.addEventListener('mousemove', (e) => {
      if (!geo || !geo.gap || !buckets.length) return;
      const r = cv.getBoundingClientRect();
      const i = Math.max(0, Math.min(buckets.length - 1, Math.round((e.clientY - r.top - geo.top) / geo.gap)));
      if (i === hover) return;
      hover = i;
      const b = buckets[i];
      q('.psr-cap').textContent = t('{h} · {n} запитів · {f} помилок', { h: b.label, n: CL.fmtInt(b.ok + b.failed), f: CL.fmtInt(b.failed) });
      draw();
    });
    cv.addEventListener('mouseleave', () => { hover = -1; q('.psr-cap').textContent = defaultCap; draw(); });
    const ro = new ResizeObserver(() => { size(); draw(); });
    ro.observe(wrap);
    ctx.leave(() => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); });

    ctx.on('status', paintStatus);
    CL.data.watch(['metrics', 'feed'], paintPlot, ctx);
    paintStatus();
    paintPlot();

    q('.psr-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    q('.psr-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const m = picker.get() || CL.mainModel();
      const r = await CL.api.post('/test-model', { model: m || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // --------------------------------------------------------- sleeve notes --
  function notes(el, ctx) {
    el.innerHTML = head('Шлюз') +
      '<dl class="psr-dl">' +
        '<div><dt>' + esc(t('Стан')) + '</dt><dd><span class="dot psr-ndot"></span><span class="psr-nst"></span></dd></div>' +
        '<div><dt>' + esc(t('Адреса')) + '</dt><dd><span class="mono ellipsis psr-nbase">—</span><button class="btn sm icon ghost psr-ncopy" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '</button><button class="btn sm icon ghost psr-nkey" data-tip="' + esc(t('Копіювати ключ')) + '">' + ic('key', 'sm') + '</button></dd></div>' +
        '<div><dt>' + esc(t('Помилки')) + '</dt><dd class="psr-nerr">—</dd></div>' +
        '<div><dt>' + esc(t('Акаунти')) + '</dt><dd class="psr-nacc">—</dd></div>' +
      '</dl>' +
      '<div class="psr-nact"><button class="btn sm psr-start">' + ic('play', 'sm') + esc(t('Запустити')) + '</button><button class="btn sm psr-pause">' + ic('pause', 'sm') + esc(t('Пауза')) + '</button><button class="btn sm psr-restart">' + ic('rotate', 'sm') + esc(t('Перезапустити')) + '</button></div>' +
      '<p class="psr-note"></p>';
    const q = (s) => el.querySelector(s);
    const paint = () => {
      const s = CL.status;
      if (s) {
        const e = s.engine || {};
        q('.psr-ndot').className = 'dot psr-ndot ' + (engineUp() ? 'ok' : 'warn');
        q('.psr-nst').textContent = engineWord();
        q('.psr-nerr').textContent = t('{n} помилок за добу', { n: CL.fmtInt(s.errors24h || 0) });
        q('.psr-nerr').classList.toggle('bad', !!s.errors24h);
        q('.psr-start').disabled = engineUp();
        q('.psr-pause').disabled = !e.engineUp || e.paused;
        q('.psr-restart').disabled = !!e.restarting;
        q('.psr-note').textContent = e.lastError ? t('Остання помилка: {e}', { e: e.lastError }) : '';
      }
      const acc = CL.data.get('accounts');
      if (acc) {
        const a = K.summary(acc);
        q('.psr-nacc').textContent = a.total ? t('{ok} з {n} працюють', { ok: a.ok, n: a.total }) : t('Акаунтів ще немає');
      }
      const ep = CL.data.get('endpoints');
      if (ep) {
        q('.psr-nbase').textContent = ep.base + '/v1';
        q('.psr-ncopy').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
        q('.psr-nkey').onclick = () => CL.copy(ep.requireKey ? ep.key : 'any', 'Ключ скопійовано');
      }
    };
    const act = (kind) => (e) => CL.ui.busy(e.currentTarget, async () => {
      if (kind === 'stop' && !(await CL.confirm('Поставити шлюз на паузу? Програми отримуватимуть помилку, доки не натиснеш «Запустити».'))) return;
      const r = await CL.api.post('/server/' + kind);
      if (r.restarting) { CL.followRestart(r.host, r.port); return; }
      await CL.loadStatus();
    });
    q('.psr-start').addEventListener('click', act('start'));
    q('.psr-pause').addEventListener('click', act('stop'));
    q('.psr-restart').addEventListener('click', act('restart'));
    ctx.on('status', paint);
    CL.data.watch(['accounts', 'endpoints'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------ tracklist --
  function tracks(el, ctx) {
    el.innerHTML = head('Трекліст моделей', '<button class="linkbtn small" data-goto="stats">' + esc(t('Статистика')) + '</button>') + '<ol class="psr-tracks"></ol>';
    K.onGoto(el);
    let sig = '';
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const list = Object.entries(m.model_stats || {}).sort((x, y) => y[1].requests - x[1].requests).slice(0, 8);
      const main = CL.mainModel();
      const s = JSON.stringify([main, list.map(([k, v]) => k + v.requests)]);
      if (s === sig) return;
      sig = s;
      const max = Math.max(1, ...list.map((x) => x[1].requests));
      el.querySelector('.psr-tracks').innerHTML = list.length ? list.map(([name, st], i) =>
        '<li class="' + (name === main ? 'on' : '') + '" style="--p:' + (st.requests / max).toFixed(3) + '"><span class="psr-no">' + (i < 4 ? 'A' : 'B') + ((i % 4) + 1) + '</span>' +
        '<span class="ellipsis mono">' + esc(name) + '</span><span class="psr-len num">' + CL.fmtInt(st.requests) + '</span></li>').join('')
        : '<li class="psr-empty">' + esc(t('Ще немає даних')) + '</li>';
    };
    ctx.on('status', paint);
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------ pressings --
  function press(el, ctx) {
    el.innerHTML = head('Акаунти', '<button class="linkbtn small" data-goto="accounts">' + esc(t('Усі акаунти')) + '</button>') +
      '<div class="psr-pbig"><b class="psr-pok">—</b><span class="psr-ptot"></span></div><div class="psr-prows"></div><div class="psr-pfoot"></div>';
    K.onGoto(el);
    const paint = () => {
      const data = CL.data.get('accounts');
      if (!data) return;
      const a = K.summary(data);
      el.querySelector('.psr-pok').textContent = a.total ? String(a.ok) : '0';
      el.querySelector('.psr-ptot').textContent = a.total ? '/ ' + a.total : t('Акаунтів ще немає');
      el.querySelector('.psr-prows').innerHTML = K.byProvider(a.list).map((p) =>
        '<div class="psr-prow"><span class="ellipsis">' + esc(CL.provTitle(p.provider)) + '</span><span class="psr-lines">' +
        p.list.slice(0, 40).map((x) => '<i class="' + esc(x.state) + '" data-tip="' + esc(x.label + ' · ' + t(STATE[x.state] || x.state)) + '"></i>').join('') +
        '</span><span class="num">' + p.ok + '/' + p.list.length + '</span></div>').join('');
      el.querySelector('.psr-pfoot').innerHTML = a.dead
        ? '<span class="grow">' + esc(t('{n} акаунт(ів) не працюють', { n: a.dead })) + '</span><button class="btn sm" data-goto="accounts">' + ic('broom', 'sm') + esc(t('Прибрати')) + '</button>' : '';
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------ gallery --
  const thumb = (() => {
    const r = rng(42);
    let s = '';
    for (let i = 0; i < 11; i++) {
      const y = 14 + i * 6.2;
      let d = 'M10 ' + y.toFixed(1);
      for (let k = 1; k <= 20; k++) {
        const x = 10 + k * 4;
        const env = Math.exp(-Math.pow((k / 20 - 0.5) / 0.22, 4));
        d += ' L' + x + ' ' + (y - env * r() * 13).toFixed(1);
      }
      s += '<path d="' + d + ' L90 ' + (y + 1) + ' L10 ' + (y + 1) + 'Z"/>';
    }
    return '<div class="th-psr"><svg viewBox="0 0 100 90">' + s + '</svg><span>CL-300</span></div>';
  })();

  CL.design({
    id: 'pulsar',
    name: 'Пульсар',
    desc: 'Конверт платівки: хребти трафіку по годинах на чорному, каталожні підписи, багато тиші.',
    mode: 'dark',
    shell: 'rail',
    sw: ['#000000', '#0e0e0e', '#ecebe6', '#ff5a36'],
    thumb,
    home: [{ id: 'setup', w: 12 }, { id: 'hero', w: 12 }, { id: 'psrNotes', w: 4 }, { id: 'psrTracks', w: 4 }, { id: 'psrPress', w: 4 }, { id: 'feed', w: 7 }, { id: 'errors', w: 5 }],
    titles: { psrNotes: 'Шлюз', psrTracks: 'Трекліст моделей', psrPress: 'Акаунти' },
    viz: { hero },
    widgets: { psrNotes: notes, psrTracks: tracks, psrPress: press },
    fx: (host, still2) => {
      host.innerHTML = '<div class="psr-fx' + (still2 ? '' : ' live') + '"><i class="psr-beam"></i><i class="psr-stars"></i></div>';
      return null;
    },
  });
})();
