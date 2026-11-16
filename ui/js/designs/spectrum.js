'use strict';
// Спектральні лінії — a spectroscope readout. Every model is an emission line
// on a 400–700 nm rail: its position (λ) is a stable hash of its name, its
// colour is the colour of that wavelength, its height is how many requests it
// served. The active model's line is labelled and pulses; a new request makes
// its line flash. Below: the "Лінії" readout table, an hours × intensity
// spectrogram on canvas, accounts as source strips and the detector log.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  // ------------------------------------------------------------- physics --
  const L0 = 400;
  const L1 = 700;
  const norm = (m) => String(m || '').trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, '');
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '');
  /** FNV-1a → [0,1): a model keeps its wavelength forever. */
  const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const lam = (name) => 406 + hash(norm(name)) * 288;
  const pos = (l) => ((l - L0) / (L1 - L0)) * 100;
  /** Visible wavelength → rgb (after Bruton), lifted so the ends stay visible on black. */
  const rgb = (l) => {
    let r = 0; let g = 0; let b = 0;
    if (l < 440) { r = (440 - l) / 60; b = 1; } else if (l < 490) { g = (l - 440) / 50; b = 1; } else if (l < 510) { g = 1; b = (510 - l) / 20; }
    else if (l < 580) { r = (l - 510) / 70; g = 1; } else if (l < 645) { r = 1; g = (645 - l) / 65; } else { r = 1; }
    const f = l < 420 ? 0.6 + 0.4 * ((l - 380) / 40) : l > 680 ? 0.6 + 0.4 * ((780 - l) / 100) : 1;
    const c = (v) => Math.round(255 * Math.min(1, 0.12 + Math.pow(v * f, 0.8) * 0.88));
    return 'rgb(' + c(r) + ',' + c(g) + ',' + c(b) + ')';
  };
  const nm = (l) => l.toFixed(1);
  /** Models from metrics merged by normalised name: [{name, l, req, tok, fail, ms}]. */
  const linesOf = (m) => {
    const by = new Map();
    Object.entries((m && m.model_stats) || {}).forEach(([name, s]) => {
      const k = norm(name);
      if (!k) return;
      const o = by.get(k) || { name, key: k, l: lam(k), req: 0, tok: 0, fail: 0, ls: 0, ln: 0 };
      o.req += s.requests || 0; o.tok += s.total || 0; o.fail += s.failed || 0; o.ls += s.latency_sum || 0; o.ln += s.latency_n || 0;
      by.set(k, o);
    });
    return [...by.values()].filter((x) => x.req > 0);
  };
  const head = (code, title, extra) => '<div class="sp-hh"><span class="sp-code">' + esc(code) + '</span><span class="sp-ttl">' + esc(t(title)) + '</span><span class="grow"></span>' + (extra || '') + '</div>';

  // ---------------------------------------------------------------- hero --
  function hero(el, ctx) {
    const ticks = [];
    for (let l = L0; l <= L1; l += 10) {
      const major = l % 50 === 0;
      ticks.push('<i class="sp-tk' + (major ? ' mj' : '') + '" style="left:' + pos(l) + '%"></i>' + (major ? '<span class="sp-nm" style="left:' + pos(l) + '%">' + l + '</span>' : ''));
    }
    const cont = [];
    for (let l = L0; l <= L1; l += 15) cont.push(rgb(l) + ' ' + pos(l).toFixed(1) + '%');
    // Fraunhofer calibration marks: F (Hβ), D (Na), C (Hα)
    const cal = [['F', 486.1], ['D', 589.3], ['C', 656.3]].map(([k, l]) => '<span class="sp-cal" style="left:' + pos(l) + '%"><b>' + k + '</b></span>').join('');
    el.innerHTML = head('Λ-01', 'Спектр трафіку', '<span class="sp-read mono"></span>') +
      '<div class="sp-field"><div class="sp-cont" style="background:linear-gradient(90deg,' + cont.join(',') + ')"></div>' + cal +
      '<div class="sp-lines"></div><div class="sp-lbl"></div></div>' +
      '<div class="sp-scale">' + ticks.join('') + '</div>' +
      '<div class="sp-ctl"><div class="sp-act"><div class="sp-act-l">' + esc(t('Активна лінія')) + '</div>' +
      '<div class="sp-act-m nowmodel"></div><div class="sp-act-r mono"><i></i><span></span></div></div>' +
      '<div class="sp-ctl-r"><div class="sp-pick"></div>' +
      '<button class="btn primary sp-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button>' +
      '<button class="btn sp-test">' + ic('activity', 'sm') + esc(t('Перевірити')) + '</button></div></div>';
    const q = (s) => el.querySelector(s);
    const field = q('.sp-field');
    const box = q('.sp-lines');
    const lbl = q('.sp-lbl');
    const picker = CL.ui.modelPicker(q('.sp-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    const els = new Map();
    let last = CL.mainModel();
    const lineEl = (key) => {
      let e = els.get(key);
      if (!e) { e = document.createElement('i'); e.className = 'sp-ln'; box.appendChild(e); els.set(key, e); }
      return e;
    };
    const paint = () => {
      const m = CL.data.get('metrics');
      const main = CL.mainModel();
      const mk = norm(main);
      const lines = linesOf(m);
      if (mk && !lines.some((x) => x.key === mk)) lines.push({ name: main, key: mk, l: lam(mk), req: 0, tok: 0, fail: 0 });
      const max = Math.max(1, ...lines.map((x) => x.req));
      const keep = new Set();
      lines.forEach((x) => {
        keep.add(x.key);
        const e = lineEl(x.key);
        const h = x.req ? 0.1 + 0.9 * (Math.log1p(x.req) / Math.log1p(max)) : 0.06;
        e.style.left = pos(x.l).toFixed(2) + '%';
        e.style.setProperty('--c', rgb(x.l));
        e.style.setProperty('--h', h.toFixed(3));
        e.classList.toggle('on', x.key === mk);
        e.dataset.tip = x.name + ' · λ ' + nm(x.l) + ' ' + t('нм') + ' · ' + t('{n} запитів', { n: CL.fmtInt(x.req) });
      });
      els.forEach((e, k) => { if (!keep.has(k)) { e.remove(); els.delete(k); } });
      const total = lines.reduce((s, x) => s + x.req, 0);
      q('.sp-read').textContent = t('ліній {n}', { n: lines.filter((x) => x.req).length }) + ' · Σ ' + CL.fmtInt(total);
      // active line label + readout
      H_roll(main);
      if (mk) {
        const l = lam(mk);
        const p = pos(l);
        lbl.hidden = false;
        lbl.style.left = p.toFixed(2) + '%';
        lbl.style.setProperty('--c', rgb(l));
        lbl.classList.toggle('r', p > 72);
        lbl.textContent = main + ' · λ ' + nm(l);
        q('.sp-act-r i').style.background = rgb(l);
        q('.sp-act-r span').textContent = 'λ ' + nm(l) + ' ' + t('нм');
        q('.sp-act').style.setProperty('--c', rgb(l));
      } else {
        lbl.hidden = true;
        q('.sp-act-r span').textContent = '';
      }
      if (main !== last) { last = main; if (!document.querySelector('.mp-pop')) picker.set(main); }
    };
    const H_roll = (main) => K.rollTo(q('.sp-act-m'), main || t('Модель не обрано'));
    // a new request: a burst at its line
    let lastT = 0;
    const burst = () => {
      const rows = CL.data.feed;
      if (!rows.length) return;
      if (!lastT) { lastT = rows[0].t; return; }
      const fresh = rows.filter((r) => r.t > lastT && !r.past).slice(0, 4);
      lastT = Math.max(lastT, rows[0].t);
      fresh.forEach((r) => {
        const name = served(r);
        if (!name) return;
        const l = lam(name);
        const b = document.createElement('i');
        b.className = 'sp-burst' + (r.ok ? '' : ' bad');
        b.style.left = pos(l).toFixed(2) + '%';
        b.style.setProperty('--c', rgb(l));
        field.appendChild(b);
        setTimeout(() => b.remove(), 1400);
        const e = els.get(norm(name));
        if (e) { e.classList.remove('hit'); void e.offsetWidth; e.classList.add('hit'); }
      });
    };
    ctx.on('status', paint);
    CL.data.watch(['metrics'], paint, ctx);
    CL.data.watch(['feed'], burst, ctx);
    paint();
    burst();
    q('.sp-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    q('.sp-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const m = picker.get() || CL.mainModel();
      const r = await CL.api.post('/test-model', { model: m || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // ------------------------------------------------------ readout table --
  function lines(el, ctx) {
    el.innerHTML = head('Λ-02', 'Лінії', '<button class="linkbtn small" data-goto="stats">' + esc(t('Статистика')) + '</button>') +
      '<div class="sp-tabw"><table class="sp-tab"><colgroup><col class="c-l"><col><col class="c-i"><col class="c-t"><col class="c-e"></colgroup>' +
      '<thead><tr><th>' + esc(t('λ, нм')) + '</th><th>' + esc(t('Лінія')) + '</th><th>' + esc(t('Інтенсивність')) + '</th><th class="r">' + esc(t('Токени')) + '</th><th class="r">' + esc(t('Помилки')) + '</th></tr></thead><tbody></tbody></table></div>';
    K.onGoto(el);
    const body = el.querySelector('tbody');
    let sig = '';
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const mk = norm(CL.mainModel());
      const list = linesOf(m).sort((a, b) => b.req - a.req).slice(0, 10).sort((a, b) => a.l - b.l);
      const s = JSON.stringify(list.map((x) => [x.key, x.req, x.tok, x.fail])) + mk;
      if (s === sig) return;
      sig = s;
      const max = Math.max(1, ...list.map((x) => x.req));
      body.innerHTML = list.length ? list.map((x) => {
        const er = x.req ? (x.fail / x.req) * 100 : 0;
        return '<tr class="' + (x.key === mk ? 'on' : '') + '" style="--c:' + rgb(x.l) + '"><td class="l mono"><i></i>' + nm(x.l) + '</td>' +
          '<td class="n mono ellipsis" title="' + esc(x.name) + '">' + esc(x.name) + '</td>' +
          '<td class="i"><span class="mono">' + CL.fmtInt(x.req) + '</span><b><i style="transform:scaleX(' + (x.req / max).toFixed(3) + ')"></i></b></td>' +
          '<td class="r mono">' + CL.fmtNum(x.tok) + '</td><td class="r mono' + (er >= 5 ? ' bad' : '') + '">' + er.toFixed(1) + '%</td></tr>';
      }).join('') : '<tr><td colspan="5" class="sp-none">' + esc(t('Ще немає даних')) + '</td></tr>';
    };
    ctx.on('status', paint);
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------- spectrogram --
  const MAP = [[0, [22, 12, 52]], [0.3, [81, 18, 124]], [0.55, [183, 55, 121]], [0.78, [252, 137, 97]], [1, [252, 253, 191]]];
  const cmap = (v) => {
    for (let i = 1; i < MAP.length; i++) {
      if (v <= MAP[i][0]) {
        const [a, ca] = MAP[i - 1];
        const [b, cb] = MAP[i];
        const k = (v - a) / (b - a);
        return 'rgb(' + ca.map((c, j) => Math.round(c + (cb[j] - c) * k)).join(',') + ')';
      }
    }
    return 'rgb(252,253,191)';
  };
  function fall(el, ctx) {
    el.innerHTML = head('Λ-03', 'Спектрограма', '<span class="sp-read mono sp-peak"></span>') +
      '<div class="sp-fall"><canvas></canvas><div class="sp-hit"></div></div>' +
      '<div class="sp-ax mono"><span class="a0"></span><span class="a1"></span><span>' + esc(t('зараз')) + '</span></div>' +
      '<div class="sp-cbar mono"><span>0</span><i></i><span class="cmax"></span><em><i></i>' + esc(t('Помилки')) + '</em></div>';
    const cv = el.querySelector('canvas');
    const hit = el.querySelector('.sp-hit');
    hit.innerHTML = '<i></i>'.repeat(24);
    el.querySelector('.sp-cbar > i').style.background = 'linear-gradient(90deg,' + [0, 0.25, 0.5, 0.75, 1].map((v) => cmap(v) + ' ' + v * 100 + '%').join(',') + ')';
    const ROWS = 14;
    const draw = () => {
      const m = CL.data.get('metrics');
      const b = K.series(m, 24);
      const vals = b.map((x) => x.ok + x.failed);
      const max = Math.max(1, ...vals);
      el.querySelector('.sp-peak').textContent = t('пік {n}/год', { n: CL.fmtInt(Math.max(0, ...vals)) });
      el.querySelector('.cmax').textContent = CL.fmtInt(max);
      el.querySelector('.a0').textContent = b[0].label;
      el.querySelector('.a1').textContent = b[12].label;
      hit.querySelectorAll('i').forEach((h, i) => { h.dataset.tip = t('{when}: {ok} успішних / {bad} помилок', { when: b[i].label, ok: b[i].ok, bad: b[i].failed }); });
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, Math.floor(cv.clientWidth * dpr));
      const Hh = Math.max(1, Math.floor(cv.clientHeight * dpr));
      if (cv.width !== W) cv.width = W;
      if (cv.height !== Hh) cv.height = Hh;
      const g = cv.getContext('2d');
      g.clearRect(0, 0, W, Hh);
      const gap = Math.max(1, Math.round(dpr));
      const cw = (W - gap * 23) / 24;
      const ch = (Hh - gap * (ROWS - 1)) / ROWS;
      b.forEach((x, i) => {
        const v = vals[i] / max;
        const lit = vals[i] ? Math.max(1, Math.round(v * ROWS)) : 0;
        const bad = x.failed ? Math.max(1, Math.round(lit * (x.failed / vals[i]))) : 0;
        for (let r = 0; r < ROWS; r++) {
          const y = Hh - (r + 1) * ch - r * gap;
          const xx = i * (cw + gap);
          if (r < lit) g.fillStyle = r >= lit - bad ? '#ff6a5c' : cmap((r + 1) / ROWS);
          else g.fillStyle = i === 23 ? '#161b27' : '#0d1018';
          g.fillRect(xx, y, cw, ch);
        }
      });
    };
    CL.data.watch(['metrics'], draw, ctx);
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => draw());
      ro.observe(cv);
      if (ctx.leave) ctx.leave(() => ro.disconnect());
    }
    draw();
  }

  // ---------------------------------------------------- account sources --
  function sources(el, ctx) {
    el.innerHTML = head('Λ-04', 'Джерела', '<button class="linkbtn small" data-goto="accounts">' + esc(t('Акаунти')) + '</button>') + '<div class="sp-src-b"></div>' +
      '<div class="sp-leg mono"><span><i class="ok"></i>' + esc(t('працює')) + '</span><span><i class="limited"></i>' + esc(t('ліміт')) + '</span><span><i class="error"></i>' + esc(t('не працює')) + '</span><span><i class="disabled"></i>' + esc(t('вимкнено')) + '</span></div>';
    K.onGoto(el);
    const box = el.querySelector('.sp-src-b');
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
      box.innerHTML = '<div class="sp-big"><b>' + a.ok + '<small>/' + a.total + '</small></b><span>' + esc(t('{ok} з {n} працюють', { ok: a.ok, n: a.total })) + '</span></div>' +
        K.byProvider(a.list).map((p) => '<div class="sp-src"><span class="mono ellipsis">' + esc(CL.provTitle(p.provider)) + '</span><span class="sp-strip">' +
          p.list.slice(0, 48).map((x) => '<i class="' + esc(x.state) + '" data-tip="' + esc(x.label + ' · ' + x.state) + '"></i>').join('') + '</span><span class="mono r">' + p.ok + '/' + p.list.length + '</span></div>').join('');
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------- detector log --
  function log(el, ctx) {
    el.innerHTML = head('Λ-05', 'Живий потік', '<span class="sp-read mono sp-ln-n"></span>') + '<div class="sp-log"></div>';
    const box = el.querySelector('.sp-log');
    let sig = '';
    const paint = () => {
      const rows = CL.data.feed.slice(0, 9);
      const s = rows.map((r) => r.t + ':' + r.status).join('|');
      if (s === sig) return;
      const first = !sig;
      sig = s;
      el.querySelector('.sp-ln-n').textContent = rows.length ? t('останні {n}', { n: rows.length }) : '';
      box.classList.toggle('still', first);
      box.innerHTML = rows.length ? rows.map((r) => {
        const name = served(r) || r.path || '—';
        const l = lam(name);
        return '<div class="sp-lg" style="--c:' + rgb(l) + '"><span class="faint">' + CL.fmtTime(r.t) + '</span><span class="sp-lam"><i></i>' + nm(l) + '</span>' +
          '<span class="ellipsis">' + esc(name) + (r.app ? ' <em>' + esc(r.app) + '</em>' : '') + '</span><span class="' + (r.ok ? 'ok' : 'bad') + '">' + esc(String(r.status)) + '</span><span class="faint r">' + (r.ms ? esc(CL.fmtMs(r.ms)) : '') + '</span></div>';
      }).join('') : '<div class="sp-none">' + esc(t('Тиша. Підключи програму — запити з’являться тут.')) + '</div>';
    };
    CL.data.watch(['feed', 'metrics'], paint, ctx);
    paint();
  }

  // ---------------------------------------------------------- background --
  function fx(host, still) {
    host.innerHTML = '<div class="sp-fx' + (still ? ' still' : '') + '"><i></i></div>';
    return null;
  }

  CL.design({
    id: 'spectrum',
    name: 'Спектральні лінії',
    desc: 'Спектроскоп: кожна модель — лінія випромінювання, яскравість — запити, активність — спектрограма.',
    mode: 'dark',
    shell: 'rail',
    sw: ['#040509', '#0e1118', '#7fd4ff', '#ff6a5c'],
    thumb: '<div class="th-sp"><em></em>' + [[12, 55, '#7a5cff'], [27, 82, '#3fa0ff'], [41, 40, '#2ff0c8'], [55, 96, '#9dff3a'], [63, 30, '#ffe33a'], [78, 66, '#ff8a2a'], [90, 48, '#ff3a2a']]
      .map(([x, h, c]) => '<i style="left:' + x + '%;height:' + h + '%;--c:' + c + '"></i>').join('') + '<b></b></div>',
    home: [
      { id: 'setup', w: 12 }, { id: 'hero', w: 12 },
      { id: 'spectrumLines', w: 7 }, { id: 'spectrumFall', w: 5 },
      { id: 'spectrumSources', w: 4 }, { id: 'spectrumLog', w: 5 }, { id: 'gateway', w: 3 },
      { id: 'errors', w: 12 },
    ],
    titles: { spectrumLines: 'Лінії', spectrumFall: 'Спектрограма', spectrumSources: 'Джерела', spectrumLog: 'Живий потік' },
    viz: { hero },
    widgets: { spectrumLines: lines, spectrumFall: fall, spectrumSources: sources, spectrumLog: log },
    fx,
  });
})();
