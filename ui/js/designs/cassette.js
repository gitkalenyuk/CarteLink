'use strict';
// Касета — a 70s/80s audio cassette and its J-card insert. Cream card
// stock, typewriter track lists, orange/red/brown/mustard stripes. The model
// now answering is written by hand on the cassette label; its reels turn
// while requests stream and a mechanical tape counter shows today's
// requests. Programs and models become a track list: Side A plays what
// worked, Side B what failed, durations are latencies. Traffic moves a pair
// of VU needles over a strip of tape.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  const ACC_STATE = { ok: 'активний', warn: 'близько до ліміту', limited: 'ліміт', error: 'помилка', invalid: 'вхід відхилено', disabled: 'вимкнено' };
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '');
  const head = (title, extra) => '<div class="cas-h"><i class="cas-stripe"></i><span>' + esc(t(title)) + '</span><span class="grow"></span>' + (extra || '') + '</div>';
  const engineOn = (s) => !!(s && s.engine && s.engine.engineUp && !s.engine.paused);
  const pad2 = (n) => String(n).padStart(2, '0');
  /** Latency as a track duration: 0:02.4, 0:34, 1:07. */
  const dur = (ms) => {
    const ds = Math.round((ms || 0) / 100);
    if (ds < 600) { const s = Math.floor(ds / 10); return '0:' + pad2(s) + (s < 10 ? '.' + (ds % 10) : ''); }
    return Math.floor(ds / 600) + ':' + pad2(Math.floor((ds % 600) / 10));
  };
  const todayCount = (m) => {
    const d = new Date();
    const mid = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return K.series(m, 24).filter((b) => b.at >= mid).reduce((s, b) => s + b.ok + b.failed, 0);
  };
  const streaming = () => { const r = CL.data.feed[0]; return !!(r && !r.past && Date.now() - r.t < 9000); };

  const reel = (side) => {
    const teeth = Array.from({ length: 6 }, (_, k) => '<rect x="-2.4" y="-11" width="4.8" height="4.6" rx="0.8" transform="rotate(' + k * 60 + ')"/>').join('');
    return '<svg class="cas-reel ' + side + '" viewBox="-50 -50 100 100" aria-hidden="true"><circle class="cas-pack" r="30"/><circle class="cas-rim" r="44"/>' +
      '<g class="cas-hub"><circle class="cas-hub-o" r="17"/><circle class="cas-hub-i" r="11"/><g class="cas-teeth">' + teeth + '</g><circle class="cas-hub-dot" cx="0" cy="-14" r="1.6"/></g></svg>';
  };
  const digits = (n) => '<span class="cas-dg" style="--d:' + n + '"><i>' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => '<b>' + x + '</b>').join('') + '</i></span>';

  // ---------------------------------------------------------------- hero --
  function hero(el, ctx) {
    el.innerHTML =
      '<div class="cas-hero">' +
        '<div class="cas-tape">' +
          '<div class="cas-label">' +
            '<div class="cas-lt"><b class="cas-sideA">A</b><span class="cas-lk">' + esc(t('Модель зараз')) + '</span><span class="grow"></span><span class="cas-stamp">' + esc(t('пауза')) + '</span></div>' +
            '<div class="cas-title" role="heading" aria-level="2"></div>' +
            '<div class="cas-band"><div class="cas-win">' + reel('l') + '<span class="cas-glass"></span>' + reel('r') + '</div></div>' +
          '</div>' +
          '<div class="cas-foot"><i></i><i></i><i></i><i></i></div>' +
        '</div>' +
        '<div class="cas-panel">' +
          '<div class="cas-ctr"><div class="cas-counter" aria-hidden="true">' + digits(0) + digits(0) + digits(0) + '</div><div class="cas-ctr-l"></div></div>' +
          '<div class="cas-pick"></div>' +
          '<div class="cas-acts"><button class="btn primary cas-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button><button class="btn cas-test">' + ic('play', 'sm') + esc(t('Перевірити')) + '</button></div>' +
          '<div class="cas-addr"><span class="mono ellipsis cas-base">—</span><button class="btn sm icon ghost cas-copy" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '</button></div>' +
        '</div>' +
      '</div>';
    const q = (s) => el.querySelector(s);
    const picker = CL.ui.modelPicker(q('.cas-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();
    const tape = q('.cas-tape');
    const paint = () => {
      const s = CL.status;
      if (s) {
        const m = s.mainModel || '';
        const title = q('.cas-title');
        const text = m || t('Модель не обрано');
        if (title.dataset.text !== text) {
          title.dataset.text = text;
          title.textContent = text;
          title.classList.remove('ink');
          void title.offsetWidth;
          title.classList.add('ink');
          title.style.setProperty('--len', String(Math.max(10, text.length)));
        }
        title.classList.toggle('none', !m);
        if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
        tape.classList.toggle('paused', !engineOn(s));
      }
      const met = CL.data.get('metrics');
      if (met) {
        const n = todayCount(met);
        const w = n % 1000;
        el.querySelectorAll('.cas-dg').forEach((d, i) => d.style.setProperty('--d', String(Math.floor(w / [100, 10, 1][i]) % 10)));
        q('.cas-counter').parentElement.setAttribute('aria-label', t('{n} запитів сьогодні', { n: CL.fmtInt(n) }));
        q('.cas-ctr-l').textContent = t('{n} запитів сьогодні', { n: CL.fmtInt(n) });
      }
      const ep = CL.data.get('endpoints');
      if (ep) {
        q('.cas-base').textContent = ep.base + '/v1';
        q('.cas-copy').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
      }
    };
    // Tape position = time of day: at midnight all tape sits on the left reel.
    const packs = () => {
      const d = new Date();
      const f = (d.getHours() * 60 + d.getMinutes()) / 1440;
      q('.cas-reel.l .cas-pack').setAttribute('r', (19 + 23 * Math.sqrt(1 - f)).toFixed(1));
      q('.cas-reel.r .cas-pack').setAttribute('r', (19 + 23 * Math.sqrt(f)).toFixed(1));
    };
    const play = () => tape.classList.toggle('playing', streaming() && engineOn(CL.status));
    packs();
    ctx.every(60000, packs);
    ctx.every(2000, play);
    ctx.on('status', paint);
    CL.data.watch(['metrics', 'endpoints'], paint, ctx);
    CL.data.watch(['feed'], play, ctx);
    paint();
    play();
    q('.cas-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    q('.cas-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const r = await CL.api.post('/test-model', { model: picker.get() || CL.mainModel() || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // ---------------------------------------------------------------- deck --
  function deck(el, ctx) {
    el.innerHTML = head('Шлюз') +
      '<div class="cas-mode"><i class="cas-led"></i><b></b></div>' +
      '<div class="cas-addr"><span class="mono ellipsis gw-base">—</span><button class="btn sm icon ghost cas-dcopy" data-tip="' + esc(t('Копіювати адресу')) + '">' + ic('copy', 'sm') + '</button><button class="btn sm icon ghost cas-dkey" data-tip="' + esc(t('Копіювати ключ')) + '">' + ic('key', 'sm') + '</button></div>' +
      '<div class="cas-keys">' +
        '<button class="cas-key k-start">' + ic('play') + '<span>' + esc(t('Запустити')) + '</span></button>' +
        '<button class="cas-key k-pause">' + ic('pause') + '<span>' + esc(t('Пауза')) + '</span></button>' +
        '<button class="cas-key k-restart">' + ic('rotate') + '<span>' + esc(t('Перезапустити')) + '</span></button>' +
      '</div><div class="hint cas-note"></div>';
    const q = (s) => el.querySelector(s);
    const paint = () => {
      const s = CL.status;
      if (s) {
        const e = s.engine || {};
        const on = engineOn(s);
        const mode = q('.cas-mode');
        mode.className = 'cas-mode ' + (on ? 'ok' : e.paused ? 'bad' : 'warn');
        mode.querySelector('b').textContent = t(e.restarting ? 'перезапуск' : e.paused ? 'пауза' : e.engineUp ? 'працює' : 'запуск…');
        q('.k-start').setAttribute('aria-pressed', String(on));
        q('.k-pause').setAttribute('aria-pressed', String(!!e.paused));
        q('.k-start').disabled = on;
        q('.k-pause').disabled = !e.engineUp || e.paused;
        q('.k-restart').disabled = !!e.restarting;
        q('.cas-note').textContent = e.lastError ? t('Остання помилка: {e}', { e: e.lastError }) : '';
      }
      const ep = CL.data.get('endpoints');
      if (ep) {
        q('.gw-base').textContent = ep.base;
        q('.cas-dcopy').onclick = () => CL.copy(ep.base, 'Адресу скопійовано');
        q('.cas-dkey').onclick = () => CL.copy(ep.requireKey ? ep.key : 'any', 'Ключ скопійовано');
      }
    };
    ctx.on('status', paint);
    CL.data.watch(['endpoints'], paint, ctx);
    paint();
    const act = (kind) => (e) => CL.ui.busy(e.currentTarget, async () => {
      if (kind === 'stop' && !(await CL.confirm('Поставити шлюз на паузу? Програми отримуватимуть помилку, доки не натиснеш «Запустити».'))) return;
      const r = await CL.api.post('/server/' + kind);
      if (r.restarting) { CL.followRestart(r.host, r.port); return; }
      await CL.loadStatus();
    });
    q('.k-start').addEventListener('click', act('start'));
    q('.k-pause').addEventListener('click', act('stop'));
    q('.k-restart').addEventListener('click', act('restart'));
  }

  // ---------------------------------------------------------- track list --
  function tracks(el, ctx) {
    const side = (k, title, sub) => '<div class="cas-sd cas-sd-' + k + '"><div class="cas-sd-h"><b>' + k.toUpperCase() + '</b><div><span>' + esc(t(title)) + '</span><em>' + esc(t(sub)) + '</em></div><span class="grow"></span><span class="mono cas-sd-n"></span></div><ol class="cas-list"></ol></div>';
    el.innerHTML = head('Трек-лист', '<span class="cas-sub mono"></span>') +
      '<div class="cas-jcard">' + side('a', 'Сторона А', 'успішні') + side('b', 'Сторона Б', 'помилки') + '</div>';
    let sig = '';
    const paint = () => {
      const rows = CL.data.feed.slice(0, 60);
      const s = rows.map((r) => r.t + ':' + r.status).join('|');
      if (s === sig) return;
      sig = s;
      const A = new Map();
      const B = new Map();
      rows.forEach((r) => {
        const app = r.app || t('Інше');
        const model = served(r) || r.path || '—';
        const map = r.ok ? A : B;
        const key = app + '\u0000' + model + (r.ok ? '' : '\u0000' + r.status);
        const o = map.get(key) || { app, model, status: r.status, n: 0, ms: 0, k: 0 };
        o.n++;
        if (r.ms) { o.ms += r.ms; o.k++; }
        map.set(key, o);
      });
      const list = (map, bad) => {
        const items = Array.from(map.values()).sort((x, y) => y.n - x.n).slice(0, 7);
        if (!items.length) return '<li class="cas-none">' + esc(t(bad ? 'Помилок немає' : 'Запитів ще не було')) + '</li>';
        return items.map((o, i) => '<li data-tip="' + esc(o.app + ' → ' + o.model + ' · ×' + o.n) + '"><span class="cas-tn">' + pad2(i + 1) + '</span>' +
          '<span class="cas-tt">' + esc(t('{app} → {m}', { app: o.app, m: o.model })) + '</span><span class="cas-dots"></span>' +
          (bad ? '<span class="cas-code">' + esc(String(o.status)) + '</span>' : '') +
          '<span class="cas-tx">×' + o.n + '</span><span class="cas-td">' + (o.k ? dur(o.ms / o.k) : '—') + '</span></li>').join('');
      };
      el.querySelector('.cas-sd-a .cas-list').innerHTML = list(A, false);
      el.querySelector('.cas-sd-b .cas-list').innerHTML = list(B, true);
      const okN = rows.filter((r) => r.ok).length;
      el.querySelector('.cas-sd-a .cas-sd-n').textContent = okN ? '×' + okN : '';
      el.querySelector('.cas-sd-b .cas-sd-n').textContent = rows.length - okN ? '×' + (rows.length - okN) : '';
      el.querySelector('.cas-sub').textContent = rows.length ? t('останні {n} запитів', { n: rows.length }) : '';
    };
    CL.data.watch(['metrics', 'feed'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------ VU meter --
  const meter = (cls, label) => {
    const ticks = Array.from({ length: 11 }, (_, i) => {
      const a = ((-48 + i * 9.6) * Math.PI) / 180;
      const r1 = i % 5 === 0 ? 70 : 74;
      return '<line class="' + (i >= 8 ? 'hot' : '') + '" x1="' + (100 + r1 * Math.sin(a)).toFixed(1) + '" y1="' + (112 - r1 * Math.cos(a)).toFixed(1) + '" x2="' + (100 + 82 * Math.sin(a)).toFixed(1) + '" y2="' + (112 - 82 * Math.cos(a)).toFixed(1) + '"/>';
    }).join('');
    const arc = (from, to, r) => {
      const p = (d) => { const a = (d * Math.PI) / 180; return (100 + r * Math.sin(a)).toFixed(1) + ' ' + (112 - r * Math.cos(a)).toFixed(1); };
      return 'M' + p(from) + ' A' + r + ' ' + r + ' 0 0 1 ' + p(to);
    };
    return '<div class="cas-vu ' + cls + '"><svg viewBox="0 0 200 120" aria-hidden="true">' +
      '<path class="cas-arc" d="' + arc(-48, 48, 82) + '"/><path class="cas-arc hot" d="' + arc(28.8, 48, 82) + '"/>' + ticks +
      '<text x="100" y="74" text-anchor="middle">VU</text>' +
      '<g class="cas-needle" style="--a:-48"><line x1="100" y1="112" x2="100" y2="24"/></g><circle class="cas-pivot" cx="100" cy="112" r="7"/></svg>' +
      '<div class="cas-vu-l"><span>' + esc(t(label)) + '</span><b class="mono"></b></div></div>';
  };

  function vu(el, ctx) {
    el.innerHTML = head('Рівень', '<span class="cas-sub mono cas-vsum"></span>') +
      '<div class="cas-meters">' + meter('l', 'успішні') + meter('r', 'помилки') + '</div>' +
      '<div class="cas-strip"><svg viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true"><path class="cas-w-ok"/><path class="cas-w-bad"/><line x1="0" y1="30" x2="240" y2="30"/></svg></div>' +
      '<div class="cas-axis mono"><span class="a0"></span><span class="a1"></span><span>' + esc(t('зараз')) + '</span></div>';
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const b = K.series(m, 24);
      const peak = Math.max(1, ...b.map((x) => x.ok + x.failed));
      const now = b[b.length - 1];
      const set = (cls, v) => {
        const box = el.querySelector('.cas-vu.' + cls);
        box.querySelector('.cas-needle').style.setProperty('--a', String(-48 + Math.min(1, v / peak) * 96));
        box.querySelector('b').textContent = t('{n} за годину', { n: CL.fmtInt(v) });
      };
      set('l', now.ok);
      set('r', now.failed);
      const xs = (i) => (i * 240) / 23;
      const area = (sign, key) => 'M0 30 ' + b.map((x, i) => 'L' + xs(i).toFixed(1) + ' ' + (30 + sign * (x[key] / peak) * 27).toFixed(1)).join(' ') + ' L240 30 Z';
      el.querySelector('.cas-w-ok').setAttribute('d', area(-1, 'ok'));
      el.querySelector('.cas-w-bad').setAttribute('d', area(1, 'failed'));
      el.querySelector('.cas-vsum').textContent = t('{n} запитів за 24 год', { n: CL.fmtInt(b.reduce((s, x) => s + x.ok + x.failed, 0)) });
      el.querySelector('.a0').textContent = b[0].label;
      el.querySelector('.a1').textContent = b[12].label;
    };
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------- account shelf --
  function shelf(el, ctx) {
    el.innerHTML = head('Акаунти', K.goto('accounts', 'Усі акаунти')) + '<div class="cas-shelf">' + CL.ui.skeleton(3) + '</div><div class="cas-sfoot"></div>';
    K.onGoto(el);
    const STATE = { ok: 'працює', warn: 'частково', bad: 'не працює' };
    const paint = () => {
      const data = CL.data.get('accounts');
      if (!data) return;
      const a = K.summary(data);
      const box = el.querySelector('.cas-shelf');
      if (!a.total) {
        box.innerHTML = CL.ui.empty('users', 'Акаунтів ще немає', 'Почни зі звичайного Google-акаунта (Gemini-Antigravity) — це безкоштовно.', '<button class="btn primary sm" data-goto="accounts">' + ic('plus', 'sm') + esc(t('Додати акаунт')) + '</button>');
        el.querySelector('.cas-sfoot').innerHTML = '';
        return;
      }
      box.innerHTML = K.byProvider(a.list).map((p, i) => {
        const st = p.ok === p.list.length ? 'ok' : p.ok ? 'warn' : 'bad';
        const use = Math.round(K.maxUse(p.list));
        return '<div class="cas-spine" style="--c:var(--s' + ((i % 4) + 1) + ')"><span class="cas-sp-band">' + pad2(i + 1) + '</span>' +
          '<b class="cas-sp-name ellipsis">' + esc(CL.provTitle(p.provider)) + '</b>' +
          '<span class="cas-sp-tapes">' + p.list.slice(0, 16).map((x) => '<i class="' + esc(x.state) + '" data-tip="' + esc(x.label + ' · ' + t(ACC_STATE[x.state] || x.state)) + '"></i>').join('') + '</span>' +
          '<span class="mono cas-sp-n">' + (use ? use + '% · ' : '') + p.ok + '/' + p.list.length + '</span>' +
          '<span class="cas-sp-st ' + st + '">' + esc(t(STATE[st])) + '</span></div>';
      }).join('');
      el.querySelector('.cas-sfoot').innerHTML = a.dead ? '<div class="card-foot">' + ic('broom', 'sm') + '<span class="grow">' + esc(t('{n} акаунт(ів) не працюють', { n: a.dead })) + '</span><button class="btn sm" data-goto="accounts">' + esc(t('Прибрати')) + '</button></div>' : '';
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  // ---------------------------------------------------------- background --
  function fx(host) {
    host.innerHTML = '<div class="cas-fx"><i></i></div>';
  }

  CL.design({
    id: 'cassette',
    name: 'Касета',
    desc: 'Аудіокасета й вкладиш: модель підписана від руки, котушки крутяться під час запитів, трек-лист і стрілки VU.',
    mode: 'light',
    shell: 'rail',
    sw: ['#efe5cf', '#fbf5e7', '#b5501b', '#e8a33a'],
    thumb: '<div class="th-cas"><div class="th-cas-t"><em></em><p><i></i><i></i></p></div><div class="th-cas-s"><s></s><s></s><s></s><s></s></div></div>',
    home: [
      { id: 'setup', w: 12 }, { id: 'hero', w: 8 }, { id: 'castDeck', w: 4 },
      { id: 'castTracks', w: 7 }, { id: 'castVu', w: 5 },
      { id: 'castShelf', w: 7 }, { id: 'errors', w: 5 },
    ],
    titles: { hero: 'Модель зараз', castDeck: 'Шлюз', castTracks: 'Трек-лист', castVu: 'Рівень', castShelf: 'Акаунти' },
    viz: { hero },
    widgets: { castDeck: deck, castTracks: tracks, castVu: vu, castShelf: shelf },
    fx,
  });
})();
