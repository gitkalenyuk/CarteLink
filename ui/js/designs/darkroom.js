'use strict';
// Фотолабораторія — a darkroom under the safelight. Requests are frames on a
// contact sheet: each frame is the model that answered, its exposure is the
// latency (slow = overexposed, failed = underexposed), and the active model's
// newest frame is circled in grease pencil. Account health is read on an
// Ansel Adams zone scale (0 = dead … X = fully fine), the gateway is a
// darkroom timer dial, and the request log is a typewritten exposure record.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  const FRAMES = 24;
  const STATE = { ok: 'активний', warn: 'близько до ліміту', limited: 'ліміт', error: 'помилка', invalid: 'вхід відхилено', disabled: 'вимкнено' };
  const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '');
  const norm = (m) => String(m || '').toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').replace(/\[[^\]]*\]$/, '').trim();
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const tape = (title, extra) => '<div class="dr-h"><h2 class="dr-tape">' + esc(t(title)) + '</h2><span class="grow"></span>' + (extra || '') + '</div>';
  const engineUp = () => { const e = (CL.status && CL.status.engine) || {}; return !!(e.engineUp && !e.paused); };
  const engineWord = () => {
    const e = (CL.status && CL.status.engine) || {};
    return t(e.restarting ? 'перезапуск' : e.paused ? 'пауза' : e.engineUp ? 'працює' : 'запуск…');
  };
  /** The frames on the sheet, oldest first, plus how each one was exposed. */
  const roll = () => {
    const rows = CL.data.feed.slice(0, FRAMES).slice().reverse();
    const lat = rows.filter((r) => r.ok && r.ms).map((r) => r.ms).sort((a, b) => a - b);
    const med = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
    const slowAt = Math.max(med * 2.5, 8000);
    return rows.map((r, i) => ({ r, n: i + 1, exp: !r.ok ? 'under' : r.ms && r.ms > slowAt ? 'over' : 'norm', e: !r.ok ? 0 : med && r.ms ? Math.max(-1, Math.min(1, Math.log2(r.ms / med))) : 0 }));
  };
  const GREASE = '<svg class="dr-grease" viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M58 6 C84 5 98 22 96 42 C94 62 74 76 48 75 C22 74 4 60 5 40 C6 20 24 7 50 6 C60 6 70 8 76 12"/></svg>';

  // ---------------------------------------------------------------- hero --
  function hero(el, ctx) {
    el.innerHTML =
      '<div class="dr-top">' +
        '<div class="dr-now"><span class="dr-tape">' + esc(t('Модель зараз')) + '</span><h2 class="dr-model nowmodel"></h2>' +
          '<div class="dr-type"><span class="dot dr-dot"></span><span>' + esc(t('Шлюз')) + '</span><b class="dr-eng"></b><span class="dr-base mono"></span></div></div>' +
        '<div class="dr-ctl"><div class="dr-pick"></div><div class="dr-btns"><button class="btn primary dr-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button>' +
          '<button class="btn dr-test">' + ic('activity', 'sm') + esc(t('Перевірити')) + '</button></div></div>' +
      '</div>' +
      '<div class="dr-sheet"></div>' +
      '<div class="dr-legend"><span><i class="lg norm"></i>' + esc(t('норма')) + '</span><span><i class="lg over"></i>' + esc(t('повільно')) + '</span><span><i class="lg under"></i>' + esc(t('помилка')) + '</span><span><i class="lg circ"></i>' + esc(t('Модель зараз')) + '</span></div>';
    const q = (s) => el.querySelector(s);
    const picker = CL.ui.modelPicker(q('.dr-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();
    let sig = '';
    let newest = 0;
    let circT = 0;
    let first = true;

    const frame = (f, circled, fresh, draw) => {
      const r = f.r;
      const m = served(r) || '—';
      const h = hash(m);
      const name = m.split('/').pop();
      const tip = CL.fmtTime(r.t) + ' · ' + m + ' · ' + r.status + (r.ms ? ' · ' + CL.fmtMs(r.ms) : '') + (r.app ? ' · ' + r.app : '');
      return '<div class="dr-fr ' + f.exp + (circled ? ' circ' : '') + (fresh ? ' new' : '') + (draw ? ' draw' : '') + '" data-tip="' + esc(tip) + '" style="--a:' + (h % 180) + 'deg;--x:' + (20 + (h >>> 8) % 60) + '%;--y:' + (20 + (h >>> 16) % 55) + '%;--s:' + (26 + (h >>> 4) % 40) + '%;--e:' + f.e.toFixed(2) + ';--k:' + f.n + '">' +
        '<span class="dr-no">' + f.n + '<em>▸ ' + f.n + 'A</em></span>' +
        '<span class="dr-pic"></span>' +
        '<span class="dr-cap"><b class="ellipsis">' + esc(name) + '</b><span>' + (r.ok ? (r.ms ? CL.fmtMs(r.ms) : '') : esc(String(r.status))) + '</span></span>' +
        (circled ? GREASE : '') + '</div>';
    };
    const blank = (n) => '<div class="dr-fr blank"><span class="dr-no">' + n + '<em>▸ ' + n + 'A</em></span><span class="dr-pic"></span><span class="dr-cap"><b>&nbsp;</b></span></div>';
    const strip = (cells, from) => '<div class="dr-strip"><span class="dr-edge">CL 3000 ▸ ' + from + '</span><div class="dr-frames">' + cells.join('') + '</div><span class="dr-edge b">◂ CL 3000 ◂</span></div>';

    const paintSheet = () => {
      const fr = roll();
      const main = norm(CL.mainModel());
      let circ = -1;
      for (let i = fr.length - 1; i >= 0; i--) if (main && (norm(served(fr[i].r)) === main || norm(fr[i].r.model) === main)) { circ = i; break; }
      const s = fr.map((f) => f.r.t + ':' + f.r.status).join('|') + '#' + circ;
      if (s === sig) return;
      sig = s;
      const top = fr.length ? fr[fr.length - 1].r.t : 0;
      const ct = circ >= 0 ? fr[circ].r.t : 0;
      const cells = fr.map((f, i) => frame(f, i === circ, !first && i === fr.length - 1 && top !== newest, i === circ && ct !== circT));
      newest = top;
      circT = ct;
      const total = Math.max(12, Math.ceil(cells.length / 12) * 12);
      for (let n = cells.length + 1; n <= total; n++) cells.push(blank(n));
      const strips = [];
      for (let i = 0; i < cells.length; i += 12) strips.push(strip(cells.slice(i, i + 12), i + 1));
      const sheet = q('.dr-sheet');
      sheet.classList.toggle('first', first);
      first = false;
      sheet.innerHTML = strips.join('') + (fr.length ? '' : '<div class="dr-unexposed">' + esc(t('Плівка ще чиста — запитів не було')) + '</div>');
    };
    const paintStatus = () => {
      const m = CL.mainModel();
      K.rollTo(q('.dr-model'), m || t('не обрано'));
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
      q('.dr-dot').className = 'dot dr-dot ' + (engineUp() ? 'ok' : 'warn');
      q('.dr-eng').textContent = engineWord();
      const ep = CL.data.get('endpoints');
      if (ep) q('.dr-base').textContent = ep.base + '/v1';
      paintSheet();
    };
    ctx.on('status', paintStatus);
    CL.data.watch(['metrics', 'feed'], paintSheet, ctx);
    CL.data.watch(['endpoints'], paintStatus, ctx);
    paintStatus();
    q('.dr-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    q('.dr-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const m = picker.get() || CL.mainModel();
      const r = await CL.api.post('/test-model', { model: m || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // --------------------------------------------------- timer (gateway) --
  function timer(el, ctx) {
    const ticks = Array.from({ length: 60 }, (_, i) => {
      const long = i % 5 === 0;
      return '<line x1="100" y1="' + (long ? 9 : 12) + '" x2="100" y2="18" transform="rotate(' + i * 6 + ' 100 100)" class="' + (long ? 'lt' : '') + '"/>';
    }).join('');
    const nums = Array.from({ length: 12 }, (_, i) => {
      const a = (i * 30 - 90) * (Math.PI / 180);
      return '<text x="' + (100 + Math.cos(a) * 72).toFixed(1) + '" y="' + (100 + Math.sin(a) * 72 + 3.5).toFixed(1) + '">' + i * 5 + '</text>';
    }).join('');
    el.innerHTML = tape('Шлюз') +
      '<div class="dr-timer"><svg viewBox="0 0 200 200" class="dr-dial" aria-hidden="true"><circle cx="100" cy="100" r="96" class="rim"/><circle cx="100" cy="100" r="86" class="face"/>' +
      '<g class="tk">' + ticks + '</g><g class="nm">' + nums + '</g><g class="hits"></g>' +
      '<line class="hand-m" x1="100" y1="100" x2="100" y2="34"/><line class="hand-s" x1="100" y1="112" x2="100" y2="16"/><circle cx="100" cy="100" r="4" class="pin"/></svg>' +
      '<div class="dr-tc"><b class="dr-tst"></b><span class="dr-tn"></span></div></div>' +
      '<div class="dr-addr"><span class="mono ellipsis dr-abase">—</span><button class="btn sm icon dr-acopy" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '</button><button class="btn sm icon dr-akey" data-tip="' + esc(t('Копіювати ключ')) + '">' + ic('key', 'sm') + '</button></div>' +
      '<div class="dr-tact"><button class="btn sm dr-start">' + ic('play', 'sm') + esc(t('Запустити')) + '</button><button class="btn sm dr-pause">' + ic('pause', 'sm') + esc(t('Пауза')) + '</button><button class="btn sm dr-restart">' + ic('rotate', 'sm') + esc(t('Перезапустити')) + '</button></div>' +
      '<p class="dr-tnote"></p>';
    const q = (s) => el.querySelector(s);
    const hands = () => {
      const d = new Date();
      q('.hand-m').setAttribute('transform', 'rotate(' + ((d.getMinutes() + d.getSeconds() / 60) * 6).toFixed(1) + ' 100 100)');
      q('.hand-s').setAttribute('transform', 'rotate(' + d.getSeconds() * 6 + ' 100 100)');
    };
    let hsig = '';
    const hits = () => {
      const now = Date.now();
      const rows = CL.data.feed.filter((r) => now - r.t < 3600000);
      q('.dr-tn').textContent = t('{n} запитів за годину', { n: rows.length });
      const s = rows.map((r) => r.t).join(',');
      if (s === hsig) return;
      hsig = s;
      q('.hits').innerHTML = rows.map((r) => {
        const d = new Date(r.t);
        const a = (d.getMinutes() + d.getSeconds() / 60) * 6;
        return '<line class="' + (r.ok ? 'ok' : 'bad') + '" x1="100" y1="' + (r.ok ? 22 : 20) + '" x2="100" y2="' + (r.ok ? 34 : 42) + '" transform="rotate(' + a.toFixed(1) + ' 100 100)"/>';
      }).join('');
    };
    const paint = () => {
      const s = CL.status;
      if (s) {
        const e = s.engine || {};
        q('.dr-tst').textContent = engineWord();
        q('.dr-timer').classList.toggle('off', !engineUp());
        q('.dr-start').disabled = engineUp();
        q('.dr-pause').disabled = !e.engineUp || e.paused;
        q('.dr-restart').disabled = !!e.restarting;
        q('.dr-tnote').textContent = e.lastError ? t('Остання помилка: {e}', { e: e.lastError }) : '';
      }
      const ep = CL.data.get('endpoints');
      if (ep) {
        q('.dr-abase').textContent = ep.base + '/v1';
        q('.dr-acopy').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
        q('.dr-akey').onclick = () => CL.copy(ep.requireKey ? ep.key : 'any', 'Ключ скопійовано');
      }
      hits();
    };
    const act = (kind) => (e) => CL.ui.busy(e.currentTarget, async () => {
      if (kind === 'stop' && !(await CL.confirm('Поставити шлюз на паузу? Програми отримуватимуть помилку, доки не натиснеш «Запустити».'))) return;
      const r = await CL.api.post('/server/' + kind);
      if (r.restarting) { CL.followRestart(r.host, r.port); return; }
      await CL.loadStatus();
    });
    q('.dr-start').addEventListener('click', act('start'));
    q('.dr-pause').addEventListener('click', act('stop'));
    q('.dr-restart').addEventListener('click', act('restart'));
    hands();
    ctx.every(1000, hands);
    ctx.every(30000, hits);
    ctx.on('status', paint);
    CL.data.watch(['endpoints', 'metrics', 'feed'], paint, ctx);
    paint();
  }

  // ---------------------------------------------- zone scale (accounts) --
  const zoneOf = (a) => {
    const used = Math.max(0, ...(a.windows || []).map((w) => w.usedPercent || 0));
    switch (a.state) {
      case 'invalid': return 0;
      case 'error': return 1;
      case 'disabled': return 2;
      case 'limited': return 4;
      case 'warn': return used >= 90 ? 6 : 7;
      default: return used >= 75 ? 8 : used >= 40 ? 9 : 10;
    }
  };
  function zones(el, ctx) {
    el.innerHTML = tape('Зонна шкала акаунтів', '<button class="linkbtn small" data-goto="accounts">' + esc(t('Усі акаунти')) + '</button>') +
      '<div class="dr-zscale">' + ROMAN.map((r, z) => '<div class="dr-z" style="--z:' + z + '"><b class="dr-zc"></b><i></i><span>' + r + '</span></div>').join('') + '</div>' +
      '<div class="dr-zkey"><span><b>0</b>' + esc(t('вхід відхилено')) + '</span><span><b>IV</b>' + esc(t('ліміт')) + '</span><span><b>X</b>' + esc(t('працює')) + '</span></div>' +
      '<div class="dr-zrows"></div><div class="dr-zfoot"></div>';
    K.onGoto(el);
    const paint = () => {
      const data = CL.data.get('accounts');
      if (!data) return;
      const a = K.summary(data);
      const counts = new Array(11).fill(0);
      a.list.forEach((x) => counts[zoneOf(x)]++);
      el.querySelectorAll('.dr-z').forEach((z, i) => {
        z.querySelector('.dr-zc').textContent = counts[i] ? String(counts[i]) : '';
        z.classList.toggle('has', counts[i] > 0);
      });
      el.querySelector('.dr-zrows').innerHTML = a.total ? K.byProvider(a.list).map((p) =>
        '<div class="dr-zrow"><span class="ellipsis">' + esc(CL.provTitle(p.provider)) + '</span><span class="dr-zcells">' +
        p.list.slice(0, 36).map((x) => '<i style="--z:' + zoneOf(x) + '" data-tip="' + esc(x.label + ' · ' + ROMAN[zoneOf(x)] + ' · ' + t(STATE[x.state] || x.state)) + '"></i>').join('') +
        '</span><span class="mono">' + p.ok + '/' + p.list.length + '</span></div>').join('')
        : CL.ui.empty('users', 'Акаунтів ще немає', 'Почни зі звичайного Google-акаунта (Gemini-Antigravity) — це безкоштовно.', '<button class="btn primary sm" data-goto="accounts">' + ic('plus', 'sm') + esc(t('Додати акаунт')) + '</button>');
      el.querySelector('.dr-zfoot').innerHTML = a.dead
        ? ic('broom', 'sm') + '<span class="grow">' + esc(t('{n} акаунт(ів) не працюють', { n: a.dead })) + '</span><button class="btn sm" data-goto="accounts">' + esc(t('Прибрати')) + '</button>' : '';
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------ exposure log --
  function log(el, ctx) {
    el.innerHTML = tape('Журнал експозицій', '<button class="linkbtn small" data-goto="stats">' + esc(t('Статистика')) + '</button>') +
      '<div class="dr-log"><div class="dr-lh"><span>' + esc(t('Кадр')) + '</span><span>' + esc(t('Час')) + '</span><span>' + esc(t('Модель')) + '</span><span>' + esc(t('Програма')) + '</span><span>' + esc(t('Експозиція')) + '</span><span></span></div><div class="dr-lb"></div></div>';
    K.onGoto(el);
    let sig = '';
    const paint = () => {
      const fr = roll().reverse().slice(0, 12);
      const s = fr.map((f) => f.r.t + ':' + f.r.status).join('|');
      if (s === sig) return;
      sig = s;
      el.querySelector('.dr-lb').innerHTML = fr.length ? fr.map((f) => {
        const r = f.r;
        return '<div class="dr-lr ' + f.exp + '"><span>' + String(f.n).padStart(2, '0') + '</span><span>' + CL.fmtTime(r.t) + '</span><span class="ellipsis">' + esc(served(r) || '—') + '</span><span class="ellipsis">' + esc(r.app || '—') + '</span>' +
          '<span>' + (r.ms ? CL.fmtMs(r.ms) : '—') + '</span><span class="dr-res">' + esc(r.ok ? (f.exp === 'over' ? '+2' : 'OK') : String(r.status)) + '</span></div>';
      }).join('') : '<div class="dr-lempty">' + esc(t('Тиша. Підключи програму — запити з’являться тут.')) + '</div>';
    };
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------ fx --
  function fx(host, still) {
    host.innerHTML = '<div class="dr-fx' + (still ? '' : ' live') + '"><i class="dr-glow"></i><i class="dr-grain"></i></div>';
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const g = c.getContext('2d');
      const img = g.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = v; img.data[i + 1] = v * 0.8; img.data[i + 2] = v * 0.7; img.data[i + 3] = Math.random() * 40;
      }
      g.putImageData(img, 0, 0);
      host.querySelector('.dr-grain').style.backgroundImage = 'url(' + c.toDataURL() + ')';
    } catch (e) { /* grain is decoration */ }
    return null;
  }

  CL.design({
    id: 'darkroom',
    name: 'Фотолабораторія',
    desc: 'Темна кімната під червоним ліхтарем: запити як контактний відбиток, зонна шкала акаунтів, журнал експозицій.',
    mode: 'dark',
    shell: 'sidebar',
    sw: ['#0e0505', '#1a0a09', '#ff3b2f', '#ffd23f'],
    thumb: '<div class="th-dr"><div class="s">' + '<i></i>'.repeat(5) + '<b></b></div><div class="z">' + '<i></i>'.repeat(11) + '</div></div>',
    home: [{ id: 'setup', w: 12 }, { id: 'hero', w: 12 }, { id: 'drTimer', w: 4 }, { id: 'drZones', w: 8 }, { id: 'drLog', w: 8 }, { id: 'errors', w: 4 }],
    titles: { drTimer: 'Шлюз', drZones: 'Зонна шкала акаунтів', drLog: 'Журнал експозицій' },
    viz: { hero },
    widgets: { drTimer: timer, drZones: zones, drLog: log },
    fx,
  });
})();
