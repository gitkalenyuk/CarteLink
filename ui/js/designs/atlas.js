'use strict';
// Зоряний атлас — a historic celestial chart. Deep ink-blue paper, fine gold
// engraving, a conic RA/Dec graticule and engraved serif labels. Every model
// is a star whose magnitude is its request volume; every program is a
// constellation joining the stars it used; the active model is the brightest
// named star with its own cartouche. Accounts read as a magnitude legend and
// the models as an engraved star catalogue.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  // ------------------------------------------------------------- helpers --
  const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω';
  const head = (title, extra) => '<div class="at-head"><span class="at-head-t">' + esc(t(title)) + '</span><span class="at-head-rule"></span>' + (extra || '') + '</div>';
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '');
  /** Stable 0..1 from a string (FNV-1a), salted. */
  const hash = (s, salt) => {
    let h = 2166136261 ^ (salt || 0);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  };
  const STAR4 = (r) => 'M0 ' + -r + 'Q' + r * 0.18 + ' ' + -r * 0.18 + ' ' + r + ' 0Q' + r * 0.18 + ' ' + r * 0.18 + ' 0 ' + r + 'Q' + -r * 0.18 + ' ' + r * 0.18 + ' ' + -r + ' 0Q' + -r * 0.18 + ' ' + -r * 0.18 + ' 0 ' + -r + 'Z';
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  /** Models with their request counts: catalogue stats, then the live feed, then the active model. */
  function stars() {
    const m = CL.data.get('metrics');
    const map = new Map();
    Object.entries((m && m.model_stats) || {}).forEach(([name, s]) => map.set(name, { name, n: s.requests || 0, tok: s.total || 0, fail: s.failed || 0 }));
    const seen = new Map();
    CL.data.feed.slice(0, 50).forEach((r) => {
      const name = served(r);
      if (!name || map.has(name)) return;
      const o = seen.get(name) || { name, n: 0, tok: 0, fail: 0 };
      o.n++;
      if (!r.ok) o.fail++;
      seen.set(name, o);
    });
    seen.forEach((o, k) => map.set(k, o));
    const main = CL.mainModel();
    let list = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 18);
    if (main && !list.some((o) => o.name === main)) list = list.concat({ name: main, n: 0, tok: 0, fail: 0 });
    return list;
  }

  // ---------------------------------------------------------------- hero --
  function hero(el, ctx) {
    el.innerHTML =
      '<div class="at-sky"><div class="at-svg"></div>' +
        '<div class="at-cart"><span class="at-cart-k">' + esc(t('Модель зараз')) + '</span>' +
          '<h2 class="at-model nowmodel"></h2><span class="at-cart-sub"></span>' +
          '<div class="at-pick"></div>' +
          '<div class="at-cart-act"><button class="btn primary at-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button>' +
          '<button class="btn at-test">' + ic('activity', 'sm') + esc(t('Перевірити')) + '</button></div></div>' +
      '</div>' +
      '<div class="at-key"><span class="at-key-mag"></span><span class="at-key-i"><svg viewBox="0 0 26 10"><path d="M1 8 13 2 25 6"/></svg>' + esc(t('лінії — програми')) + '</span>' +
        '<span class="at-key-i"><svg viewBox="0 0 12 12"><circle class="bad" cx="6" cy="6" r="4.5"/></svg>' + esc(t('кільце — збої')) + '</span>' +
        '<span class="grow"></span><span class="at-key-base mono"></span></div>';
    const q = (s) => el.querySelector(s);
    const sky = q('.at-sky');
    const box = q('.at-svg');
    const picker = CL.ui.modelPicker(q('.at-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();
    let sig = '';
    let nodes = {};
    let lastT = 0;

    const draw = () => {
      const W = Math.max(320, Math.round(sky.clientWidth || 900));
      const Hh = W < 700 ? 300 : 400;
      const wide = W >= 760;
      const list = stars();
      const main = CL.mainModel();
      const route = new Map();
      CL.data.feed.slice(0, 50).forEach((r) => {
        const app = r.app || t('Інше');
        const to = served(r);
        if (!to) return;
        const arr = route.get(app) || [];
        if (!arr.includes(to)) arr.push(to);
        route.set(app, arr);
      });
      const s = JSON.stringify([W, main, list.map((o) => o.name + ':' + o.n + ':' + (o.fail > 0)), [...route.entries()].slice(0, 5)]);
      if (s === sig) return;
      sig = s;

      // Conic projection: a pole above the plate, hour lines fan out, declination arcs.
      const P = { x: W / 2, y: -Hh * 1.15 };
      const r0 = Hh * 1.15 + Hh * 0.12;
      const r1 = Hh * 1.15 + Hh * 0.92;
      const A = Math.asin(Math.min(0.98, (W * 0.56) / r1));
      const at = (u, v) => { const a = -A + u * 2 * A; const r = r0 + v * (r1 - r0); return { x: P.x + r * Math.sin(a), y: P.y + r * Math.cos(a) }; };
      const uMin = wide ? Math.min(0.5, 380 / W) : 0.04;
      const vMin = wide ? 0.05 : 0.1;

      let svg = '<svg class="at-chart" viewBox="0 0 ' + W + ' ' + Hh + '" width="' + W + '" height="' + Hh + '" role="img" aria-label="' + esc(t('Карта моделей')) + '">' +
        '<defs><radialGradient id="atGlow"><stop offset="0" stop-color="#fff6d8" stop-opacity=".55"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></radialGradient>' +
        '<filter id="atBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>' +
        '<clipPath id="atClip"><rect x="10" y="10" width="' + (W - 20) + '" height="' + (Hh - 20) + '"/></clipPath></defs>';
      // Milky Way band
      svg += '<g class="at-milky" filter="url(#atBlur)" clip-path="url(#atClip)"><ellipse cx="' + W * 0.62 + '" cy="' + Hh * 0.55 + '" rx="' + W * 0.5 + '" ry="' + Hh * 0.12 + '" transform="rotate(-14 ' + W * 0.62 + ' ' + Hh * 0.55 + ')"/>' +
        '<ellipse cx="' + W * 0.8 + '" cy="' + Hh * 0.42 + '" rx="' + W * 0.18 + '" ry="' + Hh * 0.07 + '" transform="rotate(-14 ' + W * 0.8 + ' ' + Hh * 0.42 + ')"/></g>';
      // graticule
      let grid = '';
      for (let k = 0; k <= 12; k++) {
        const u = k / 12;
        const p0 = at(u, -0.2);
        const p1 = at(u, 1.2);
        grid += '<line x1="' + p0.x.toFixed(1) + '" y1="' + p0.y.toFixed(1) + '" x2="' + p1.x.toFixed(1) + '" y2="' + p1.y.toFixed(1) + '"/>';
      }
      const decs = [0, 0.33, 0.66, 1];
      decs.forEach((v) => {
        let d = '';
        for (let i = 0; i <= 40; i++) { const p = at(-0.1 + (i / 40) * 1.2, v); d += (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }
        grid += '<path d="' + d + '"/>';
      });
      svg += '<g class="at-grid" clip-path="url(#atClip)">' + grid + '</g>';
      // labels: RA increases to the left (east), as on a real chart
      let lab = '';
      for (let k = 1; k < 12; k++) {
        const p = at(k / 12, 1);
        if (p.x < 30 || p.x > W - 30 || p.y > Hh - 24) continue;
        lab += '<text x="' + p.x.toFixed(1) + '" y="' + (Math.min(Hh - 26, p.y + 14)).toFixed(1) + '" text-anchor="middle">' + (24 - k * 2) + 'ʰ</text>';
      }
      ['+60°', '+45°', '+30°', '+15°'].forEach((txt, i) => {
        const p = at(1, decs[i]);
        if (p.y > 26 && p.y < Hh - 26) lab += '<text x="' + (W - 22) + '" y="' + (p.y - 4).toFixed(1) + '" text-anchor="end">' + txt + '</text>';
      });
      svg += '<g class="at-glab">' + lab + '</g>';
      // field stars (static, seeded by width)
      let seed = 11 + W;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      let field = '';
      for (let i = 0; i < Math.round(W / 6); i++) field += '<circle cx="' + (12 + rnd() * (W - 24)).toFixed(1) + '" cy="' + (12 + rnd() * (Hh - 24)).toFixed(1) + '" r="' + (0.35 + rnd() * rnd() * 1.3).toFixed(2) + '"/>';
      svg += '<g class="at-field">' + field + '</g>';

      // the stars
      const max = Math.max(1, ...list.map((o) => o.n));
      const pos = {};
      list.forEach((o) => {
        const u = uMin + hash(o.name, 3) * (0.96 - uMin);
        const v = vMin + hash(o.name, 7) * (0.9 - vMin);
        const p = at(u, v);
        p.x = Math.max(24, Math.min(W - 24, p.x));
        p.y = Math.max(24, Math.min(Hh - 30, p.y));
        p.r = 1.6 + 5.6 * Math.sqrt(o.n / max);
        if (o.name === main) p.r = Math.max(p.r, 5.5);
        pos[o.name] = p;
      });
      // constellations
      let cons = '';
      [...route.entries()].slice(0, 5).forEach(([app, models]) => {
        const pts = models.map((n) => pos[n]).filter(Boolean);
        if (!pts.length) return;
        if (pts.length > 1) cons += '<polyline points="' + pts.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ') + '"/>';
        const a = pts[0];
        const b = pts[1] || { x: a.x + 46, y: a.y + 34 };
        const lx = (a.x + b.x) / 2;
        const ly = (a.y + b.y) / 2 + (pts.length > 1 ? -8 : 0);
        if (pts.length === 1) cons += '<line class="lead" x1="' + (a.x + a.r + 3).toFixed(1) + '" y1="' + (a.y + a.r + 2).toFixed(1) + '" x2="' + (lx - 4).toFixed(1) + '" y2="' + (ly - 4).toFixed(1) + '"/>';
        cons += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle">' + esc(short(app, 22)) + '</text>';
      });
      svg += '<g class="at-cons">' + cons + '</g>';
      let st = '';
      list.forEach((o, i) => {
        const p = pos[o.name];
        const on = o.name === main;
        const named = on || i < 6;
        st += '<g class="at-star' + (on ? ' on' : '') + (o.fail ? ' fail' : '') + '" data-name="' + esc(o.name) + '" transform="translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')">' +
          '<title>' + esc(o.name + ' · ' + t('{n} запитів', { n: o.n })) + '</title>' +
          (p.r > 4 || on ? '<circle class="halo" fill="url(#atGlow)" r="' + (p.r * 3.4).toFixed(1) + '"/>' : '') +
          (p.r > 5 || on ? '<path class="spike" d="M0 ' + (-p.r * 2.6).toFixed(1) + 'V' + (p.r * 2.6).toFixed(1) + 'M' + (-p.r * 2.6).toFixed(1) + ' 0H' + (p.r * 2.6).toFixed(1) + '"/>' : '') +
          (o.fail ? '<circle class="ring" r="' + (p.r + 3.5).toFixed(1) + '"/>' : '') +
          '<circle class="core" r="' + p.r.toFixed(1) + '"/>' +
          '<circle class="pulse" r="' + p.r.toFixed(1) + '"/>' +
          (named && !on ? '<text x="' + (p.r + 5).toFixed(1) + '" y="' + (p.r + 9).toFixed(1) + '"><tspan class="g">' + GREEK[i] + '</tspan> ' + esc(short(o.name, 26)) + '</text>' : '') +
          '</g>';
      });
      svg += '<g class="at-stars">' + st + '</g>';
      // the active star's cartouche label
      const mp = main && pos[main];
      if (mp) {
        const label = short(main, 30);
        const w = Math.max(80, label.length * 7.4 + 22);
        const right = mp.x + 26 + w < W - 14;
        const bx = right ? mp.x + 26 : mp.x - 26 - w;
        const by = Math.max(16, Math.min(Hh - 44, mp.y - 40));
        svg += '<g class="at-label"><line x1="' + mp.x.toFixed(1) + '" y1="' + mp.y.toFixed(1) + '" x2="' + (right ? bx : bx + w).toFixed(1) + '" y2="' + (by + 14).toFixed(1) + '"/>' +
          '<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + w.toFixed(1) + '" height="28" rx="2"/><rect class="in" x="' + (bx + 3).toFixed(1) + '" y="' + (by + 3).toFixed(1) + '" width="' + (w - 6).toFixed(1) + '" height="22" rx="1"/>' +
          '<text x="' + (bx + w / 2).toFixed(1) + '" y="' + (by + 18.5).toFixed(1) + '" text-anchor="middle">' + esc(label) + '</text></g>';
      }
      // graduated frame
      let ticks = '';
      for (let x = 14; x < W - 10; x += 8) {
        const len = (x - 14) % 40 === 0 ? 6 : 3;
        ticks += 'M' + x + ' 6v' + len + 'M' + x + ' ' + (Hh - 6) + 'v' + -len;
      }
      for (let y = 14; y < Hh - 10; y += 8) {
        const len = (y - 14) % 40 === 0 ? 6 : 3;
        ticks += 'M6 ' + y + 'h' + len + 'M' + (W - 6) + ' ' + y + 'h' + -len;
      }
      svg += '<g class="at-frame"><rect x="3" y="3" width="' + (W - 6) + '" height="' + (Hh - 6) + '"/><rect x="10" y="10" width="' + (W - 20) + '" height="' + (Hh - 20) + '"/><path d="' + ticks + '"/></g></svg>';
      box.innerHTML = svg;
      nodes = {};
      box.querySelectorAll('.at-star').forEach((g) => { nodes[g.dataset.name] = g; });
      // magnitude key
      const steps = [max, Math.round(max / 4), Math.round(max / 16), 1].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
      q('.at-key-mag').innerHTML = '<em>' + esc(t('Величина = запити')) + '</em>' + steps.map((v) => {
        const r = 1.6 + 5.6 * Math.sqrt(v / max);
        return '<span class="at-key-i"><svg viewBox="0 0 18 18"><circle class="core" cx="9" cy="9" r="' + r.toFixed(1) + '"/></svg>' + CL.fmtNum(v) + '</span>';
      }).join('');
    };

    const flash = () => {
      const r = CL.data.feed[0];
      if (!r || r.t === lastT) return;
      const first = !lastT;
      lastT = r.t;
      if (first || r.past) return;
      const g = nodes[served(r)];
      if (!g) return;
      g.classList.remove('flash');
      void g.getBoundingClientRect();
      g.classList.add('flash');
    };

    const paint = () => {
      const s = CL.status;
      if (s) {
        const m = s.mainModel || '';
        K.rollTo(q('.at-model'), m || t('Модель не обрано'));
        if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
        const e = s.engine || {};
        const up = e.engineUp && !e.paused;
        q('.at-cart-sub').textContent = !up ? t(e.paused ? 'Шлюз на паузі' : 'Рушій запускається')
          : m ? t('Найяскравіша зоря: відповідає на всі запити') : t('Обери модель — вона відповідатиме на запити всіх твоїх програм.');
        q('.at-cart').classList.toggle('dim', !up);
      }
      const ep = CL.data.get('endpoints');
      if (ep) q('.at-key-base').textContent = ep.base + '/v1';
      draw();
      flash();
    };
    ctx.on('status', paint);
    CL.data.watch(['metrics', 'feed', 'endpoints'], paint, ctx);
    if (window.ResizeObserver) {
      let tm = 0;
      const ro = new ResizeObserver(() => { clearTimeout(tm); tm = setTimeout(draw, 120); });
      ro.observe(sky);
      if (ctx.leave) ctx.leave(() => { ro.disconnect(); clearTimeout(tm); });
    }
    paint();
    q('.at-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    q('.at-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const m = picker.get() || CL.mainModel();
      const r = await CL.api.post('/test-model', { model: m || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // ------------------------------------------------------------- catalog --
  function catalog(el, ctx) {
    el.innerHTML = head('Каталог', '<button class="btn sm ghost" data-goto="stats">' + esc(t('Статистика')) + '</button>') +
      '<div class="at-cat-wrap"><table class="at-cat"><thead><tr><th>' + esc(t('Позн.')) + '</th><th>' + esc(t('Назва')) + '</th><th class="num">' + esc(t('Запити')) + '</th><th class="num">' + esc(t('Токени')) + '</th><th class="num">' + esc(t('Збої')) + '</th></tr></thead><tbody></tbody></table></div>';
    K.onGoto(el);
    const body = el.querySelector('tbody');
    let sig = '';
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const main = CL.mainModel();
      const list = Object.entries(m.model_stats || {}).sort((a, b) => b[1].requests - a[1].requests).slice(0, 10);
      const s = JSON.stringify([main, list.map(([n, x]) => [n, x.requests, x.total, x.failed])]);
      if (s === sig) return;
      sig = s;
      const max = Math.max(1, ...list.map(([, x]) => x.requests));
      body.innerHTML = list.length ? list.map(([name, x], i) => {
        const r = 1.4 + 4.6 * Math.sqrt((x.requests || 0) / max);
        return '<tr class="' + (name === main ? 'on' : '') + '"><td class="at-g">' + GREEK[i] + '</td>' +
          '<td><span class="at-cat-name"><svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="' + r.toFixed(1) + '"/></svg><span class="ellipsis">' + esc(name) + '</span></span></td>' +
          '<td class="num">' + CL.fmtInt(x.requests) + '</td><td class="num">' + CL.fmtNum(x.total || 0) + '</td>' +
          '<td class="num' + (x.failed ? ' bad' : '') + '">' + (x.failed ? CL.fmtInt(x.failed) : '—') + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="at-none">' + esc(t('Каталог порожній: ще жодного запиту.')) + '</td></tr>';
    };
    ctx.on('status', paint);
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // -------------------------------------------------- accounts as legend --
  function legend(el, ctx) {
    el.innerHTML = head('Акаунти', '<button class="btn sm ghost" data-goto="accounts">' + esc(t('Усі')) + '</button>') + '<div class="at-leg"></div>' +
      '<div class="at-leg-key"><span>' + glyph('ok') + esc(t('сяє')) + '</span><span>' + glyph('limited') + esc(t('ліміт')) + '</span><span>' + glyph('error') + esc(t('згасла')) + '</span><span>' + glyph('disabled') + esc(t('вимкнено')) + '</span></div>';
    K.onGoto(el);
    const box = el.querySelector('.at-leg');
    const paint = () => {
      const data = CL.data.get('accounts');
      if (!data) return;
      const a = K.summary(data);
      if (!a.total) {
        box.innerHTML = '<div class="at-none">' + esc(t('Акаунтів ще немає')) + '<br><button class="btn sm primary" data-goto="accounts">' + ic('plus', 'sm') + esc(t('Додати акаунт')) + '</button></div>';
        return;
      }
      box.innerHTML = K.byProvider(a.list).map((p) => '<div class="at-leg-row"><span class="at-leg-name ellipsis">' + esc(CL.provTitle(p.provider)) + '</span>' +
        '<span class="at-leg-stars">' + p.list.slice(0, 24).map((x) => '<span data-tip="' + esc(x.label) + '">' + glyph(x.state) + '</span>').join('') + '</span>' +
        '<span class="at-leg-n' + (p.ok ? '' : ' bad') + '">' + esc(t('{ok} з {n}', { ok: p.ok, n: p.list.length })) + '</span></div>').join('') +
        (a.dead ? '<div class="at-leg-foot">' + esc(t('{n} акаунт(ів) не працюють', { n: a.dead })) + ' <button class="linkbtn" data-goto="accounts">' + esc(t('Прибрати')) + '</button></div>' : '');
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }
  function glyph(state) {
    if (state === 'ok' || state === 'warn') return '<svg class="at-gl ' + state + '" viewBox="-8 -8 16 16"><path d="' + STAR4(7) + '"/></svg>';
    if (state === 'limited') return '<svg class="at-gl limited" viewBox="-8 -8 16 16"><circle r="4.5"/></svg>';
    if (state === 'error' || state === 'invalid') return '<svg class="at-gl dead" viewBox="-8 -8 16 16"><circle r="4.5"/><path d="M-6 6 6-6"/></svg>';
    return '<svg class="at-gl off" viewBox="-8 -8 16 16"><circle r="1.8"/></svg>';
  }

  // ----------------------------------------------------- observation log --
  function log(el, ctx) {
    el.innerHTML = head('Журнал спостережень', '<span class="at-sub at-log-n"></span>') + '<div class="at-log"></div>';
    const box = el.querySelector('.at-log');
    let shown = '';
    const paint = () => {
      const rows = CL.data.feed.slice(0, 8);
      const s = rows.map((r) => r.t + '' + r.status).join('|');
      if (s === shown) return;
      const fresh = !shown;
      shown = s;
      box.classList.toggle('still', fresh);
      el.querySelector('.at-log-n').textContent = rows.length ? t('останні {n}', { n: rows.length }) : '';
      box.innerHTML = rows.length ? rows.map((r) => '<div class="at-lrow' + (r.ok ? '' : ' bad') + '"><span class="at-lt">' + CL.fmtTime(r.t) + '</span>' +
        '<span class="at-lapp ellipsis">' + esc(r.app || t('Інше')) + '</span><span class="at-lto ellipsis"><i>→</i> ' + esc(served(r) || r.path || '—') + '</span>' +
        '<span class="at-lst">' + esc(String(r.status)) + '</span><span class="at-lms">' + (r.ms ? CL.fmtMs(r.ms) : '') + '</span></div>').join('')
        : '<div class="at-none">' + esc(t('Небо поки тихе. Щойно програма надішле запит, він з’явиться тут.')) + '</div>';
    };
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  }

  // ---------------------------------------------------------- background --
  /** A slowly twinkling star field, redrawn at ~6 fps and paused when hidden. */
  function fx(host, still) {
    const c = document.createElement('canvas');
    host.appendChild(c);
    const g = c.getContext('2d');
    let seed = 1977;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const starsBg = Array.from({ length: 170 }, () => ({ x: rnd(), y: rnd(), r: 0.3 + rnd() * rnd() * 1.4, a: 0.15 + rnd() * 0.45, p: rnd() * 6.28, s: 0.4 + rnd() * 1.2, warm: rnd() > 0.8 }));
    let w = 0;
    let h = 0;
    let dpr = 1;
    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = c.width = Math.floor(innerWidth * dpr);
      h = c.height = Math.floor(innerHeight * dpr);
    };
    const draw = (time) => {
      g.clearRect(0, 0, w, h);
      const k = time / 1000;
      starsBg.forEach((s) => {
        const tw = still ? 1 : 0.6 + 0.4 * Math.sin(k * s.s + s.p);
        g.globalAlpha = s.a * tw;
        g.fillStyle = s.warm ? '#f3dca0' : '#dfe6ff';
        g.beginPath();
        g.arc(s.x * w, s.y * h, s.r * dpr, 0, 6.2832);
        g.fill();
      });
      g.globalAlpha = 1;
    };
    size();
    draw(0);
    if (still) {
      const onR = () => { size(); draw(0); };
      addEventListener('resize', onR);
      return () => removeEventListener('resize', onR);
    }
    let tm = 0;
    const tick = () => { if (!document.hidden) draw(performance.now()); tm = setTimeout(tick, 160); };
    tm = setTimeout(tick, 160);
    const onR = () => { size(); draw(performance.now()); };
    addEventListener('resize', onR);
    return () => { clearTimeout(tm); removeEventListener('resize', onR); };
  }

  CL.design({
    id: 'atlas',
    name: 'Зоряний атлас',
    desc: 'Старовинна карта неба: моделі — зорі, програми — сузір’я, золоте гравіювання.',
    mode: 'dark',
    shell: 'sidebar',
    sw: ['#0a1030', '#121a44', '#d9b866', '#efe6cc'],
    thumb: '<div class="th-at"><svg viewBox="0 0 160 96" aria-hidden="true"><path class="g" d="M-10 30Q80 -10 170 30M-10 62Q80 22 170 62M40 0 30 96M80 0V96M120 0l10 96"/><polyline points="34,70 62,44 98,52 126,28"/><circle cx="34" cy="70" r="2"/><circle cx="62" cy="44" r="3.4"/><circle cx="98" cy="52" r="2.4"/><circle class="on" cx="126" cy="28" r="4.6"/><rect x="6" y="6" width="54" height="22"/></svg></div>',
    home: [{ id: 'setup', w: 12 }, { id: 'hero', w: 12 }, { id: 'atlasCatalog', w: 7 }, { id: 'atlasLegend', w: 5 }, { id: 'atlasLog', w: 7 }, { id: 'gateway', w: 5 }, { id: 'errors', w: 12 }],
    titles: { hero: 'Карта неба', atlasCatalog: 'Каталог', atlasLegend: 'Акаунти', atlasLog: 'Журнал спостережень' },
    viz: { hero },
    widgets: { atlasCatalog: catalog, atlasLegend: legend, atlasLog: log },
    fx,
  });
})();
