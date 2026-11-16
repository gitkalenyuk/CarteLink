'use strict';
// Графіт — the dark developer console. Graphite ground, hairline seams, one
// step of elevation, monospaced display type. Its signature is the request
// pipeline: every request walks Програма → Ключ → Правило → Модель →
// Відповідь, and the newest one lights the stages as it passes.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const K = CL.vizKit;

  // ------------------------------------------------------------- helpers --
  const panelHead = (title, extra) => '<div class="g-head"><span>' + esc(t(title)) + '</span><span class="grow"></span>' + (extra || '') + '</div>';
  const ruleOf = (r) => {
    if (!r) return '—';
    if (!r.resolved) return t('як є');
    if (/\(запасна\)/.test(r.resolved)) return t('запасна модель');
    if (/^claude-.*(haiku|sonnet|opus)/i.test(r.model || '')) return t('рівень Claude');
    if (/^cartelink-/i.test(r.model || '')) return t('рівень CarteLink');
    return t('підміна');
  };
  const served = (r) => (r && r.resolved ? r.resolved.replace(/\s*\(запасна\)/, '').split(' → ').pop() : (r && r.model) || '—');

  // ---------------------------------------------------------------- hero --
  function hero(el, ctx) {
    el.innerHTML =
      '<h2 class="g-title nowmodel"></h2>' +
      '<p class="g-lead"></p>' +
      '<div class="row g-hero-actions"><div class="grow g-pick" style="min-width:220px;max-width:420px"></div>' +
      '<button class="btn primary g-apply">' + ic('zap', 'sm') + esc(t('Застосувати до всього')) + '</button>' +
      '<button class="btn g-test">' + ic('activity', 'sm') + esc(t('Перевірити')) + '</button></div>' +
      '<div class="g-cmd"><span class="dot ok"></span><code class="g-cmd-line"></code><button class="btn ghost sm icon g-cmd-copy" data-tip="' + esc(t('Копіювати')) + '">' + ic('copy', 'sm') + '</button>' +
      '<div class="g-cmd-sub"></div></div>';
    const picker = CL.ui.modelPicker(el.querySelector('.g-pick'), { value: CL.mainModel(), empty: '— обери модель —' });
    let last = CL.mainModel();
    const paint = () => {
      const s = CL.status;
      if (!s) return;
      const m = s.mainModel || '';
      K.rollTo(el.querySelector('.g-title'), m || t('Модель не обрано'));
      if (m !== last) { last = m; if (!document.querySelector('.mp-pop')) picker.set(m); }
      const met = CL.data.get('metrics');
      const hour = met ? K.series(met, 1)[0] : null;
      el.querySelector('.g-lead').textContent = m
        ? t('Відповідає на всі запити твоїх програм. За останню годину: {n} запитів.', { n: hour ? hour.ok + hour.failed : 0 })
        : t('Обери модель — вона відповідатиме на запити всіх твоїх програм.');
      const ep = CL.data.get('endpoints');
      if (ep) {
        el.querySelector('.g-cmd-line').textContent = 'base_url = ' + ep.base + '/v1';
        el.querySelector('.g-cmd-sub').textContent = s.engine && s.engine.engineUp && !s.engine.paused ? t('Шлюз приймає запити · ключ скопіюй на сторінці «Підключити програму»') : t('Шлюз на паузі або запускається');
        el.querySelector('.g-cmd-copy').onclick = () => CL.copy(ep.base + '/v1', 'Адресу скопійовано');
      }
    };
    ctx.on('status', paint);
    CL.data.watch(['metrics', 'endpoints'], paint, ctx);
    paint();
    el.querySelector('.g-apply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => CL.applyModelEverywhere(picker.get())));
    el.querySelector('.g-test').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
      const m = picker.get() || CL.mainModel();
      const r = await CL.api.post('/test-model', { model: m || 'cartelink-main' });
      if (r.ok) CL.toast(t('{m} відповіла за {ms}', { m: r.resolved, ms: CL.fmtMs(r.ms) }));
      else throw new Error(r.error || 'error');
    }));
  }

  // -------------------------------------------------------------- status --
  function status(el, ctx) {
    el.innerHTML = panelHead('Стан системи') + '<div class="g-ok"></div>' + panelHead('Останні запити', '<button class="linkbtn small" data-goto="stats">' + esc(t('Усі')) + '</button>') +
      '<div class="g-recent"></div>' + panelHead('Ліміти акаунтів', '<button class="linkbtn small" data-goto="accounts">' + esc(t('Акаунти')) + '</button>') + '<div class="g-res"></div>';
    K.onGoto(el);
    const paint = () => {
      const s = CL.status;
      const acc = K.summary(CL.data.get('accounts'));
      const e = (s && s.engine) || {};
      const up = e.engineUp && !e.paused;
      const problems = [];
      if (!up) problems.push(e.paused ? t('Шлюз на паузі') : t('Рушій запускається'));
      if (acc.dead) problems.push(t('{n} акаунт(ів) не працюють', { n: acc.dead }));
      if (s && s.errors24h) problems.push(t('{n} помилок за добу', { n: s.errors24h }));
      el.querySelector('.g-ok').innerHTML = '<div class="g-ok-line ' + (problems.length ? 'warn' : 'ok') + '"><span class="dot ' + (problems.length ? 'warn' : 'ok') + '"></span><b>' +
        esc(problems.length ? t('Потребує уваги') : t('Усе працює')) + '</b></div>' + (problems.length ? '<div class="g-ok-sub">' + problems.map(esc).join(' · ') + '</div>' : '<div class="g-ok-sub">' + esc(t('Шлюз, рушій і акаунти в порядку')) + '</div>');
      const rows = CL.data.feed.slice(0, 5);
      el.querySelector('.g-recent').innerHTML = rows.length ? rows.map((r) => '<div class="g-rrow"><span class="mono faint">' + CL.fmtTime(r.t) + '</span><span class="mono ellipsis">' + esc(served(r)) + '</span><span class="g-st ' + (r.ok ? 'ok' : 'bad') + '">' + esc(r.ok ? t('Успіх') : t('Помилка')) + '</span><span class="mono faint">' + (r.ms ? CL.fmtMs(r.ms) : '') + '</span></div>').join('')
        : '<div class="hint">' + esc(t('Запитів ще не було')) + '</div>';
      const used = acc.list.filter((a) => (a.windows || []).length).slice(0, 4);
      el.querySelector('.g-res').innerHTML = used.length ? used.map((a) => {
        const w = a.windows[0];
        const p = Math.round(w.usedPercent || 0);
        return '<div class="g-bar"><span class="ellipsis">' + esc(a.label) + '</span><div class="g-track"><i class="' + (p >= 100 ? 'bad' : p >= 80 ? 'warn' : '') + '" style="transform:scaleX(' + (p / 100).toFixed(3) + ')"></i></div><span class="mono">' + p + '%</span></div>';
      }).join('') : '<div class="hint">' + esc(acc.total ? t('Твої провайдери не повідомляють відсотки лімітів') : t('Акаунтів ще немає')) + '</div>';
    };
    ctx.on('status', paint);
    CL.data.watch(['accounts', 'feed', 'metrics'], paint, ctx);
    paint();
  }

  // ------------------------------------------------------------ pipeline --
  function pipeline(el, ctx) {
    const STAGES = [['plug', 'Програма'], ['key', 'Ключ'], ['route', 'Правило'], ['cpu', 'Модель'], ['send', 'Відповідь']];
    el.innerHTML = panelHead('Шлях запиту', '<span class="g-pipe-meta mono faint"></span>') +
      '<div class="g-pipe">' + STAGES.map(([icon, name], i) => (i ? '<span class="g-link"><i></i></span>' : '') +
        '<div class="g-stage" data-i="' + i + '"><div class="g-stage-h">' + ic(icon, 'sm') + '<span>' + esc(t(name)) + '</span></div><div class="g-stage-v mono ellipsis">—</div></div>').join('') + '</div>';
    let lastT = 0;
    const paint = () => {
      const r = CL.data.feed[0];
      if (!r) { el.querySelector('.g-pipe-meta').textContent = t('чекаю на перший запит'); return; }
      const vals = [r.app || t('невідома'), r.key || t('основний'), ruleOf(r), served(r), r.ok ? (r.status + ' · ' + (r.ms ? CL.fmtMs(r.ms) : '')) : String(r.status)];
      el.querySelectorAll('.g-stage').forEach((s, i) => {
        s.querySelector('.g-stage-v').textContent = vals[i];
        s.classList.toggle('bad', !r.ok && i === 4);
      });
      el.querySelector('.g-pipe-meta').textContent = CL.relTime(r.t) + ' · ' + (r.model || '');
      if (r.t !== lastT) {
        const first = !lastT;
        lastT = r.t;
        if (!first) {
          const pipe = el.querySelector('.g-pipe');
          pipe.classList.remove('run');
          void pipe.offsetWidth;
          pipe.classList.add('run');
        }
      }
    };
    CL.data.watch(['feed', 'metrics'], paint, ctx);
    paint();
  }

  // -------------------------------------------------------- bottom row --
  function activity(el, ctx) {
    el.innerHTML = panelHead('Остання активність') + '<div class="g-act"></div>';
    const paint = () => {
      const rows = CL.data.feed.slice(0, 6);
      el.querySelector('.g-act').innerHTML = rows.length ? rows.map((r) => '<div class="g-arow"><span class="g-ico ' + (r.ok ? 'ok' : 'bad') + '">' + ic(r.ok ? 'check' : 'x', 'sm') + '</span><span class="ellipsis">' +
        esc(r.ok ? t('{app} → {m}', { app: r.app || t('Програма'), m: served(r) }) : t('Помилка {s}: {m}', { s: r.status, m: served(r) })) + '</span><span class="mono faint">' + esc(CL.relTime(r.t)) + '</span></div>').join('')
        : '<div class="hint">' + esc(t('Тиша. Підключи програму — запити з’являться тут.')) + '</div>';
    };
    CL.data.watch(['feed', 'metrics'], paint, ctx);
    paint();
  }

  function deploy(el, ctx) {
    el.innerHTML = panelHead('Акаунти', '<button class="linkbtn small" data-goto="accounts">' + esc(t('Усі')) + '</button>') + '<div class="g-dep"></div>';
    K.onGoto(el);
    const paint = () => {
      const a = K.summary(CL.data.get('accounts'));
      el.querySelector('.g-dep').innerHTML = a.total ? K.byProvider(a.list).map((p) => {
        const st = p.ok === p.list.length ? 'ok' : p.ok ? 'warn' : 'bad';
        return '<div class="g-drow"><span class="ellipsis">' + esc(CL.provTitle(p.provider)) + '</span><span class="g-state ' + st + '"><span class="dot ' + st + '"></span>' + esc(st === 'ok' ? t('працює') : st === 'warn' ? t('частково') : t('не працює')) + '</span><span class="mono faint">' + p.ok + '/' + p.list.length + '</span></div>';
      }).join('') : '<div class="hint">' + esc(t('Акаунтів ще немає')) + '</div>';
    };
    CL.data.watch(['accounts'], paint, ctx);
    paint();
  }

  function models(el, ctx) {
    el.innerHTML = panelHead('Моделі', '<button class="linkbtn small" data-goto="stats">' + esc(t('Статистика')) + '</button>') + '<div class="g-mods"></div>';
    K.onGoto(el);
    const paint = () => {
      const m = CL.data.get('metrics');
      if (!m) return;
      const list = Object.entries(m.model_stats || {}).sort((x, y) => y[1].total - x[1].total).slice(0, 5);
      el.querySelector('.g-mods').innerHTML = list.length ? list.map(([name, s]) => '<div class="g-mrow">' + ic('cpu', 'sm') + '<span class="mono ellipsis">' + esc(name) + '</span><span class="mono faint">' + CL.fmtNum(s.total) + '</span><span class="mono faint">' + CL.fmtInt(s.requests) + '×</span></div>').join('')
        : '<div class="hint">' + esc(t('Ще немає даних')) + '</div>';
    };
    CL.data.watch(['metrics'], paint, ctx);
    paint();
  }

  CL.design({
    id: 'graphite',
    name: 'Графіт',
    desc: 'Консоль розробника: конвеєр запиту, стан системи, щільні панелі.',
    mode: 'dark',
    shell: 'sidebar',
    sw: ['#0b1018', '#101722', '#5b8def', '#3fb950'],
    thumb: '<div class="th-g"><b></b><i></i><em><s></s><s></s><s></s><s></s><s></s></em><u></u></div>',
    home: [{ id: 'setup', w: 12 }, { id: 'hero', w: 8 }, { id: 'status', w: 4 }, { id: 'pipeline', w: 12 }, { id: 'gact', w: 4 }, { id: 'deploy', w: 4 }, { id: 'gmodels', w: 4 }, { id: 'activity', w: 7 }, { id: 'errors', w: 5 }],
    titles: { status: 'Стан системи', pipeline: 'Шлях запиту', gact: 'Остання активність', deploy: 'Акаунти', gmodels: 'Моделі' },
    viz: { hero },
    widgets: { status, pipeline, gact: activity, deploy, gmodels: models },
    fx: (host) => { host.innerHTML = '<div class="fx-dots"></div>'; },
  });
})();
