'use strict';
// Інспектор запитів: what exactly each program sent and what came back.
// Off by default (it keeps request bodies in memory); secrets are masked by
// the server before anything is stored.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  const STYLE = '<style>' +
    '.pg-insp .ins{display:grid;grid-template-columns:minmax(260px,38%) 1fr;gap:var(--gap);align-items:start}' +
    '.pg-insp .ins-list{max-height:calc(100vh - 230px);overflow:auto;margin:0 -6px;padding:0 6px}' +
    '.pg-insp .ins-row{display:grid;grid-template-columns:auto auto 1fr auto;gap:10px;align-items:center;width:100%;padding:8px;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--text-2);text-align:start;cursor:pointer;font-size:12.5px}' +
    '.pg-insp .ins-row:hover{background:var(--surface-2);color:var(--text)}' +
    '.pg-insp .ins-row.on{background:var(--accent-soft);color:var(--text)}' +
    '.pg-insp .ins-row .st{font:600 11px/1 var(--font-mono);padding:3px 5px;border-radius:4px;background:var(--ok-soft);color:var(--ok)}' +
    '.pg-insp .ins-row .st.bad{background:var(--bad-soft);color:var(--bad)}' +
    '.pg-insp .ins-d h3{margin:16px 0 8px;font:600 12px/1.3 var(--font);text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)}' +
    '.pg-insp .ins-d h3:first-child{margin-top:0}' +
    '.pg-insp .ins-d pre.code{max-height:360px;overflow:auto;white-space:pre-wrap;word-break:break-word}' +
    '.pg-insp .hdrs{display:grid;grid-template-columns:auto 1fr;gap:3px 14px;font:12px/1.5 var(--font-mono)}' +
    '.pg-insp .hdrs dt{color:var(--text-3)}' +
    '.pg-insp .hdrs dd{margin:0;overflow-wrap:anywhere}' +
    '@media (max-width:900px){.pg-insp .ins{grid-template-columns:1fr}.pg-insp .ins-list{max-height:50vh}}' +
    '</style>';

  CL.page('inspector', {
    title: 'Інспектор запитів', icon: 'search', group: 'gateway', order: 55,

    async render(root, ctx) {
      root.classList.add('pg-insp');
      root.innerHTML = STYLE +
        '<div class="blocks" data-area="inspector">' +
        '<section class="block card" data-block="ins" data-w="12" data-title="Інспектор запитів">' +
          '<div class="card-h"><div class="card-icon">' + ic('search') + '</div><h2>' + esc(t('Інспектор запитів')) + '</h2><span class="sub" id="iN"></span><span class="grow"></span>' +
            CL.ui.switch('iOn', false, 'Записувати') +
            '<button class="btn sm ghost" id="iClear">' + ic('trash', 'sm') + esc(t('Очистити')) + '</button></div>' +
          '<p class="muted small" id="iHint"></p>' +
          '<div id="iBody"></div>' +
        '</section></div>';
      const $ = (s) => root.querySelector(s);
      let state = null;
      let picked = '';
      let sig = '';

      const hint = (on) => t(on
        ? 'Записує останні запити в пам’ять: що надіслала програма й що відповіла модель. Ключі й паролі в заголовках приховано. Після перезапуску CarteLink записи зникають.'
        : 'Увімкни запис, щоб бачити повний текст запитів і відповідей — зручно, коли програма поводиться дивно. Типово вимкнено: текст запитів може містити приватні дані.');

      function paint() {
        const on = !!(state && state.enabled);
        $('#iOn').checked = on;
        $('#iHint').textContent = hint(on);
        const items = (state && state.items) || [];
        $('#iN').textContent = items.length ? t('{n} записів', { n: items.length }) : '';
        $('#iClear').disabled = !items.length;
        const s = JSON.stringify([on, items.map((x) => x.id), picked]);
        if (s === sig) return;
        sig = s;
        if (!on && !items.length) { $('#iBody').innerHTML = CL.ui.empty('search', 'Запис вимкнено', 'Увімкни «Записувати» вгорі й надішли запит з програми.'); return; }
        if (!items.length) { $('#iBody').innerHTML = CL.ui.empty('search', 'Чекаю на запити', 'Надішли запит з будь-якої підключеної програми — він з’явиться тут.'); return; }
        if (!items.some((x) => x.id === picked)) picked = items[0].id;
        const list = '<div class="ins-list" role="listbox" aria-label="' + esc(t('Запити')) + '">' + items.map((x) => {
          const bad = x.status >= 400;
          return '<button class="ins-row' + (x.id === picked ? ' on' : '') + '" role="option" aria-selected="' + (x.id === picked) + '" data-id="' + esc(x.id) + '">' +
            '<span class="faint num">' + CL.fmtTime(x.t) + '</span><span class="st' + (bad ? ' bad' : '') + '">' + esc(String(x.status || '…')) + '</span>' +
            '<span class="ellipsis"><b class="mono">' + esc(x.resolved || x.model || x.path) + '</b><span class="faint"> · ' + esc(x.app || '') + '</span></span>' +
            '<span class="faint num">' + (x.ms ? CL.fmtMs(x.ms) : '') + '</span></button>';
        }).join('') + '</div>';
        const scroll = $('.ins-list') ? $('.ins-list').scrollTop : 0;
        $('#iBody').innerHTML = '<div class="ins">' + list + '<div class="ins-d" id="iDetail">' + CL.ui.skeleton(6) + '</div></div>';
        $('.ins-list').scrollTop = scroll;
        detail(picked);
      }

      const pretty = (txt) => {
        if (!txt) return '';
        try { return JSON.stringify(JSON.parse(txt), null, 2); } catch (e) { return txt; }
      };
      async function detail(id) {
        let r;
        try { r = (await CL.api.get('/inspector/' + encodeURIComponent(id))).item; } catch (e) {
          if (ctx.alive() && picked === id) $('#iDetail').innerHTML = '<div class="hint">' + esc(t('Запис уже витіснено новішими.')) + '</div>';
          return;
        }
        if (!ctx.alive() || picked !== id || !$('#iDetail')) return;
        const kv = [['Час', CL.fmtDateTime(r.t)], ['Програма', (r.app || '—') + (r.client ? ' (' + r.client + ')' : '')], ['Ключ', r.key || t('основний')], ['Модель', r.model || '—'], ['Відповіла', r.resolved || r.model || '—'], ['Статус', String(r.status)], ['Час відповіді', r.ms ? CL.fmtMs(r.ms) : '—'], ['Шлях', r.method + ' ' + r.path]];
        $('#iDetail').innerHTML =
          '<h3>' + esc(t('Загальне')) + '</h3><dl class="kv">' + kv.map(([k, v]) => '<dt>' + esc(t(k)) + '</dt><dd class="' + (k === 'Модель' || k === 'Відповіла' || k === 'Шлях' ? 'mono' : '') + '">' + esc(v) + '</dd>').join('') + '</dl>' +
          (r.fallback ? '<div class="banner info" style="margin-top:10px">' + ic('swap') + '<div>' + esc(t('Відповіла запасна модель.')) + '</div></div>' : '') +
          '<h3>' + esc(t('Заголовки запиту')) + '</h3><dl class="hdrs">' + (r.requestHeaders || []).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' +
          '<h3>' + esc(t('Запит')) + (r.requestTruncated ? ' · ' + esc(t('перші 64 КБ')) : '') + '</h3>' + (r.requestBody ? CL.ui.code(pretty(r.requestBody)) : '<div class="hint">—</div>') +
          '<h3>' + esc(t('Відповідь')) + (r.responseTruncated ? ' · ' + esc(t('перші 64 КБ')) : '') + '</h3>' + (r.responseBody ? CL.ui.code(pretty(r.responseBody)) : '<div class="hint">—</div>');
      }

      async function load() {
        try { state = await CL.api.get('/inspector'); } catch (e) { return; }
        if (ctx.alive()) paint();
      }
      $('#iBody').addEventListener('click', (e) => {
        const b = e.target.closest('.ins-row');
        if (!b) return;
        picked = b.dataset.id;
        root.querySelectorAll('.ins-row').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
        sig = JSON.stringify([!!(state && state.enabled), ((state && state.items) || []).map((x) => x.id), picked]);
        $('#iDetail').innerHTML = CL.ui.skeleton(6);
        detail(picked);
      });
      $('#iOn').addEventListener('change', async (e) => {
        const on = e.target.checked;
        try {
          await CL.config.patch({ inspector: { enabled: on } });
          CL.toast(on ? 'Інспектор записує запити' : 'Запис вимкнено, записи стерто');
        } catch (er) { CL.fail(er); }
        load();
      });
      $('#iClear').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
        await CL.api.post('/inspector/clear');
        picked = '';
        await load();
      }));
      $('#iBody').innerHTML = CL.ui.skeleton(5);
      await load();
      const soon = CL.debounce(() => { if (ctx.alive() && state && state.enabled) load(); }, 700);
      ctx.on('live', (ev) => { if (ev && ev.type === 'request') soon(); });
      ctx.every(15000, load);
    },
  });
})();
