'use strict';
// Статистика: what went through the gateway, how many tokens, which accounts
// are near a limit, and the error log with a plain-language hint per entry.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  const STYLE = '<style>' +
    '.pg-stats .tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}' +
    '.pg-stats .tools .input{width:auto;flex:1;min-width:160px;max-width:320px}' +
    '.pg-stats .tools .select{width:auto;min-width:150px}' +
    '.pg-stats .t-scroll{max-height:560px;overflow:auto;border:var(--border-w) solid var(--line);border-radius:var(--radius-sm)}' +
    '.pg-stats .cell-sub{display:block;color:var(--text-3);font-size:12px;margin-top:2px;white-space:normal}' +
    '.pg-stats th .sort{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px}' +
    '.pg-stats th .sort:hover{color:var(--text)}' +
    '.pg-stats th .sort:focus-visible{box-shadow:var(--focus);border-radius:4px}' +
    '.pg-stats th[aria-sort] .sort{color:var(--text)}' +
    '.pg-stats th .sort .i{transition:transform var(--dur) var(--ease)}' +
    '.pg-stats th[aria-sort="ascending"] .sort .i{transform:rotate(180deg)}' +
    '.pg-stats .live{margin-bottom:14px;padding:6px 12px;border-radius:var(--radius-sm);background:var(--surface-2);border:var(--border-w) solid var(--line)}' +
    '.pg-stats .live-h{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-3);padding:4px 0}' +
    '.pg-stats .live .feed-row:last-child{border-bottom:0}' +
    '.pg-stats tr.err-row{cursor:pointer}' +
    '.pg-stats tr.err-row .chev{transition:transform var(--dur) var(--ease);color:var(--text-3)}' +
    '.pg-stats tr.err-row[aria-expanded="true"] .chev{transform:rotate(180deg)}' +
    '.pg-stats tr.err-detail > td{background:var(--surface-2)}' +
    '.pg-stats .lim-cell{min-width:130px}' +
    '.pg-stats .lim-cell .bar{margin-bottom:4px}' +
    '.pg-stats .wrap-text{white-space:normal;word-break:break-word}' +
    '.pg-stats .more{display:flex;justify-content:center;margin-top:12px}' +
    '</style>';

  CL.page('stats', {
    title: 'Статистика', icon: 'chart', group: 'gateway', order: 50,

    async render(root, ctx) {
      root.classList.add('pg-stats');
      root.innerHTML = STYLE +
        '<div class="row" style="margin-bottom:var(--gap)">' +
          '<span class="chip outline hidden" id="sSince">' + ic('clock', 'sm') + '<span></span></span>' +
          '<span class="grow"></span>' +
          '<button class="btn sm" id="sExport">' + ic('download', 'sm') + esc(t('Експорт статистики')) + '</button>' +
          '<button class="btn sm danger" id="sClear">' + ic('trash', 'sm') + esc(t('Очистити статистику')) + '</button>' +
        '</div>' +
        '<div class="blocks" data-area="stats">' +
        '<section class="block" data-block="kpis" data-w="12" data-title="Показники"><div class="kpis">' +
          kpi('sTok', 'coins', 'Всього токенів') + kpi('sIn', 'upload', 'Вхідні токени') + kpi('sOut', 'download', 'Вихідні токени') + kpi('sOk', 'gauge', 'Успішність') +
        '</div></section>' +
        '<section class="block card" data-block="activity" data-w="12" data-title="Активність">' +
          '<div class="card-h"><div class="card-icon">' + ic('chart') + '</div><h2>' + esc(t('Активність')) + '</h2><span class="grow"></span>' +
            CL.ui.seg('sMetric', [['req', 'Запити'], ['tok', 'Токени']], 'req') +
            CL.ui.seg('sRange', [['24', '24 год'], ['168', '7 днів'], ['720', '30 днів']], '24') + '</div>' +
          '<div id="sChart">' + CL.ui.skeleton(3) + '</div>' +
          '<div class="hint" id="sChartSum" style="margin-top:10px"></div>' +
        '</section>' +
        '<section class="block card" data-block="requests" data-w="12" data-title="Запити">' +
          '<div class="card-h"><div class="card-icon">' + ic('activity') + '</div><h2>' + esc(t('Запити')) + '</h2><span class="grow"></span><span class="sub" id="sReqCount"></span></div>' +
          '<div class="live"><div class="live-h"><span class="dot ok"></span><span>' + esc(t('Наживо')) + '</span></div><div class="feed" id="sLive"></div></div>' +
          '<div class="tools">' + CL.ui.seg('sReqFilter', [['all', 'Усі'], ['err', 'Лише помилки']], 'all') +
            '<input class="input" id="sReqSearch" type="search" placeholder="' + esc(t('Пошук за моделлю або акаунтом…')) + '" aria-label="' + esc(t('Пошук за моделлю або акаунтом…')) + '"></div>' +
          '<div id="sReq">' + CL.ui.skeleton(5) + '</div>' +
        '</section>' +
        '<section class="block card" data-block="models" data-w="8" data-title="За моделями">' +
          '<div class="card-h"><div class="card-icon">' + ic('cpu') + '</div><h2>' + esc(t('За моделями')) + '</h2><span class="grow"></span><span class="sub" id="sModelsN"></span></div>' +
          '<div id="sModels">' + CL.ui.skeleton(4) + '</div>' +
        '</section>' +
        '<section class="block card" data-block="keys" data-w="4" data-title="За ключами">' +
          '<div class="card-h"><div class="card-icon">' + ic('key') + '</div><h2>' + esc(t('За API-ключами')) + '</h2><span class="grow"></span><button class="btn sm ghost" data-goto="keys">' + esc(t('Ключі')) + ic('arrow', 'sm') + '</button></div>' +
          '<div id="sKeys">' + CL.ui.skeleton(3) + '</div>' +
        '</section>' +
        '<section class="block card" data-block="apps" data-w="6" data-title="За програмами">' +
          '<div class="card-h"><div class="card-icon">' + ic('plug') + '</div><h2>' + esc(t('За програмами')) + '</h2><span class="grow"></span><span class="sub" id="sAppsN"></span></div>' +
          '<div id="sApps">' + CL.ui.skeleton(4) + '</div>' +
        '</section>' +
        '<section class="block card" data-block="cost" data-w="6" data-title="Скільки б коштувало">' +
          '<div class="card-h"><div class="card-icon">' + ic('coins') + '</div><h2>' + esc(t('Скільки б коштувало')) + '</h2><span class="grow"></span><b class="num" id="sCostTotal"></b></div>' +
          '<div id="sCost">' + CL.ui.skeleton(4) + '</div>' +
          '<div class="hint" id="sCostNote" style="margin-top:10px"></div>' +
        '</section>' +
        '<section class="block card" data-block="errors" data-w="12" data-title="Журнал помилок">' +
          '<div class="card-h"><div class="card-icon">' + ic('alert') + '</div><h2>' + esc(t('Журнал помилок')) + '</h2><span class="sub" id="sErrCount"></span><span class="grow"></span>' +
            '<button class="btn sm icon ghost" id="sErrRefresh" data-tip="Оновити">' + ic('rotate', 'sm') + '</button>' +
            '<button class="btn sm" id="sErrExport">' + ic('download', 'sm') + esc(t('Експорт JSON')) + '</button>' +
            '<button class="btn sm danger" id="sErrClear">' + ic('trash', 'sm') + esc(t('Очистити')) + '</button></div>' +
          '<div class="tools">' +
            '<select class="select" id="sErrKind" aria-label="' + esc(t('Звідки помилка')) + '"></select>' +
            '<select class="select" id="sErrStatus" aria-label="' + esc(t('Код відповіді')) + '"></select>' +
            '<input class="input" id="sErrSearch" type="search" placeholder="' + esc(t('Пошук у тексті, моделі, програмі…')) + '" aria-label="' + esc(t('Пошук у тексті, моделі, програмі…')) + '"></div>' +
          '<div id="sErrors">' + CL.ui.skeleton(5) + '</div>' +
          '<div class="hint" style="margin-top:10px">' + esc(t('Журнал зберігається у файлі data/errors.jsonl і переживає перезапуск. Однакові помилки протягом хвилини складаються в один рядок з лічильником.')) + '</div>' +
        '</section>' +
        '</div>';

      root.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) CL.go(g.dataset.goto); });
      const $ = (s) => root.querySelector(s);

      // ------------------------------------------------------ metrics --
      let sum = null; // last /metrics/summary
      let full = null; // full history once loaded
      let hist = []; // what the requests table shows from
      let lastSince = null;
      let fullBusy = null;

      async function loadSummary() {
        let m;
        try { m = (await CL.api.get('/metrics/summary')).metrics; } catch (e) {
          if (!sum && ctx.alive()) {
            $('#sChart').innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Не вдалось отримати статистику: {e}. Перевір, чи запущено CarteLink, і онови сторінку.', { e: e.message })) + '</div></div>';
            $('#sReq').innerHTML = '';
          }
          return;
        }
        if (!ctx.alive()) return;
        if (lastSince !== null && m.since !== lastSince) full = null; // cleared elsewhere
        lastSince = m.since;
        sum = m;
        paintKpis();
        paintChart();
        paintModels();
        paintCost();
        paintKeys();
        paintSince();
        mergeHistory(m.history || []);
        paintReq();
      }
      const loadSummarySoon = CL.debounce(loadSummary, 1200);

      async function loadFull() {
        if (fullBusy) return fullBusy;
        fullBusy = (async () => {
          const m = (await CL.api.get('/metrics')).metrics;
          full = m.history || [];
          hist = full;
          return m;
        })().finally(() => { fullBusy = null; });
        return fullBusy;
      }

      const recKey = (r) => (r.timestamp || '') + '|' + (r.execution_id || r.request_id || '') + '|' + (r.auth_index || '');
      function mergeHistory(list) {
        if (!full) { hist = list.slice(); return; }
        const have = new Set(full.slice(0, 300).map(recKey));
        const fresh = list.filter((r) => !have.has(recKey(r)));
        if (fresh.length) full = fresh.concat(full).slice(0, 1000);
        hist = full;
      }

      function paintSince() {
        const el = $('#sSince');
        if (!sum || !sum.since) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        el.querySelector('span').textContent = t('Рахується з {date}', { date: new Date(sum.since).toLocaleString() });
      }

      function paintKpis() {
        const m = sum;
        CL.ui.countTo($('#sTok .kpi-value'), m.total_tokens || 0);
        $('#sTok .kpi-sub').textContent = t('{n} запитів', { n: CL.fmtInt(m.total_requests) });
        CL.ui.countTo($('#sIn .kpi-value'), m.total_input || 0);
        $('#sIn .kpi-sub').textContent = t('{n} з кешу', { n: CL.fmtNum(m.total_cached) });
        CL.ui.countTo($('#sOut .kpi-value'), m.total_output || 0);
        $('#sOut .kpi-sub').textContent = t('{n} на міркування', { n: CL.fmtNum(m.total_reasoning) });
        const total = m.total_requests || 0;
        const rate = total ? Math.round(((m.total_success || 0) / total) * 100) : 100;
        CL.ui.countTo($('#sOk .kpi-value'), rate, (v) => v + '%');
        $('#sOk .kpi-sub').textContent = t('{ok} успішних / {bad} помилок', { ok: CL.fmtInt(m.total_success), bad: CL.fmtInt(m.total_failed) });
      }

      // ---- activity chart ----
      let range = 24;
      let metric = 'req';
      function paintChart() {
        const box = $('#sChart');
        const hourly = (sum && sum.hourly) || {};
        const b = range <= 24 ? CL.hourBuckets(hourly, 24) : CL.dayBuckets(hourly, range / 24);
        const n = b.length;
        const axis = [b[0].label, b[Math.floor(n / 2)].label, b[n - 1].label];
        if (metric === 'tok') {
          CL.ui.chart(box, b.map((x) => ({ ok: x.tokens, failed: 0, label: x.label })), axis);
          box.querySelectorAll('.chart .col').forEach((c, i) => c.setAttribute('data-tip', t('{when}: {n} токенів', { when: b[i].label, n: CL.fmtInt(b[i].tokens) })));
          const tok = b.reduce((s, x) => s + x.tokens, 0);
          $('#sChartSum').textContent = t('За цей час: {n} токенів.', { n: CL.fmtInt(tok) });
        } else {
          CL.ui.chart(box, b, axis);
          const ok = b.reduce((s, x) => s + x.ok, 0);
          const bad = b.reduce((s, x) => s + x.failed, 0);
          $('#sChartSum').textContent = t('За цей час: {n} запитів, з них {bad} з помилкою.', { n: CL.fmtInt(ok + bad), bad: CL.fmtInt(bad) });
        }
      }
      CL.ui.onSeg($('#sRange'), (v) => { range = Number(v); paintChart(); });
      CL.ui.onSeg($('#sMetric'), (v) => { metric = v; paintChart(); });

      // ---- per-model table (sortable) ----
      const MCOLS = [['model', 'Модель'], ['requests', 'Запити'], ['failed', 'Помилки'], ['avg_latency_ms', 'Відповідь'], ['avg_ttft_ms', 'Перший токен'], ['input', 'Вхідні'], ['cached', 'Кешовані'], ['output', 'Вихідні'], ['total', 'Всього']];
      let msort = { key: 'total', dir: -1 };
      function paintModels() {
        const box = $('#sModels');
        const rows = Object.entries((sum && sum.model_stats) || {}).map(([model, s]) => Object.assign({ model }, s));
        $('#sModelsN').textContent = rows.length ? t('{n} моделей', { n: rows.length }) : '';
        if (!rows.length) { box.innerHTML = CL.ui.empty('cpu', 'Ще немає даних', 'Щойно програми почнуть надсилати запити, тут з’явиться розподіл за моделями.'); return; }
        const k = msort.key;
        rows.sort((a, b) => (k === 'model' ? String(a.model).localeCompare(String(b.model)) : (a[k] || 0) - (b[k] || 0)) * msort.dir);
        box.innerHTML = '<div class="t-scroll"><table class="table"><thead><tr>' + MCOLS.map(([key, label]) =>
          '<th' + (key !== 'model' ? ' class="num"' : '') + (msort.key === key ? ' aria-sort="' + (msort.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button class="sort" data-sort="' + key + '">' + esc(t(label)) + (msort.key === key ? ic('chevron', 'sm') : '') + '</button></th>').join('') +
          '</tr></thead><tbody>' + rows.map((r) =>
          '<tr><td class="mono wrap-text">' + esc(r.model) + '</td>' +
          '<td class="num">' + CL.fmtInt(r.requests) + '</td>' +
          '<td class="num">' + (r.failed ? '<span style="color:var(--bad)">' + CL.fmtInt(r.failed) + '</span>' : '<span class="faint">0</span>') + '</td>' +
          '<td class="num">' + (r.avg_latency_ms ? CL.fmtMs(r.avg_latency_ms) : '<span class="faint">—</span>') + '</td>' +
          '<td class="num">' + (r.avg_ttft_ms ? CL.fmtMs(r.avg_ttft_ms) : '<span class="faint">—</span>') + '</td>' +
          '<td class="num">' + CL.fmtNum(r.input) + '</td>' +
          '<td class="num">' + CL.fmtNum(r.cached) + '</td>' +
          '<td class="num">' + CL.fmtNum(r.output) + (r.reasoning ? '<span class="cell-sub">' + esc(t('{n} міркування', { n: CL.fmtNum(r.reasoning) })) + '</span>' : '') + '</td>' +
          '<td class="num"><b>' + CL.fmtNum(r.total) + '</b></td></tr>').join('') + '</tbody></table></div>';
      }
      $('#sModels').addEventListener('click', (e) => {
        const b = e.target.closest('[data-sort]');
        if (!b) return;
        const key = b.dataset.sort;
        msort = msort.key === key ? { key, dir: -msort.dir } : { key, dir: key === 'model' ? 1 : -1 };
        paintModels();
        const again = $('#sModels [data-sort="' + key + '"]');
        if (again) again.focus();
      });

      // ---- per-key usage ----
      let keyNames = null;
      async function loadKeyNames() {
        try {
          const r = await CL.api.get('/scoped-keys');
          keyNames = {};
          (r.keys || []).forEach((k) => { keyNames[k.id] = k.name; });
        } catch (e) { keyNames = keyNames || {}; }
        if (ctx.alive()) paintKeys();
      }
      function paintKeys() {
        const box = $('#sKeys');
        if (!sum) return;
        const list = Object.entries(sum.key_stats || {}).filter(([, s]) => s.requests > 0).sort((a, b) => (b[1].last || 0) - (a[1].last || 0));
        if (!list.length) { box.innerHTML = CL.ui.empty('key', 'Ще немає запитів', 'Тут видно, скільки запитів прийшло з кожним API-ключем.'); return; }
        box.innerHTML = '<div class="list">' + list.map(([id, s]) => {
          const name = id === 'main' ? t('Основний ключ') : (keyNames && keyNames[id]) || id;
          return '<div class="li"><span class="avatar">' + ic('key', 'sm') + '</span><div class="grow"><b>' + esc(name) + '</b><span>' +
            esc(t('{n} запитів · {bad} помилок', { n: CL.fmtInt(s.requests), bad: CL.fmtInt(s.failed) })) + '</span></div>' +
            (s.last ? '<span class="small faint nowrap">' + esc(CL.relTime(s.last)) + '</span>' : '') + '</div>';
        }).join('') + '</div>';
      }

      // ---- recent requests + live strip ----
      let reqFilter = 'all';
      let reqQuery = '';
      let reqShown = 50;
      function reqMatches(r) {
        if (reqFilter === 'err' && !r.failed) return false;
        if (!reqQuery) return true;
        return [r.model, r.alias, r.source, r.auth_index, r.provider].some((x) => x && String(x).toLowerCase().includes(reqQuery));
      }
      function paintReq() {
        const box = $('#sReq');
        if (!sum) return;
        const list = hist.filter(reqMatches);
        const shown = list.slice(0, reqShown);
        $('#sReqCount').textContent = sum.total_requests ? t('усього {n}', { n: CL.fmtInt(sum.total_requests) }) : '';
        if (!shown.length) {
          box.innerHTML = hist.length || full
            ? CL.ui.empty('search', 'Нічого не знайдено', reqFilter === 'err' ? 'Серед останніх запитів помилок немає.' : 'Спробуй іншу назву моделі або акаунта.')
            : CL.ui.empty('activity', 'Запитів ще не було', 'Підключи програму — і кожен її запит з’явиться тут.', '<button class="btn sm primary" data-goto="connect">' + ic('plug', 'sm') + esc(t('Підключити програму')) + '</button>');
          return;
        }
        const today = new Date().toDateString();
        box.innerHTML = '<div class="t-scroll"><table class="table"><thead><tr><th>' + esc(t('Час')) + '</th><th>' + esc(t('Модель')) + '</th><th>' + esc(t('Акаунт')) + '</th><th class="num">' + esc(t('Токени')) + '</th><th class="num">' + esc(t('Відповідь за')) + '</th><th>' + esc(t('Статус')) + '</th></tr></thead><tbody>' +
          shown.map((r) => {
            const ts = Date.parse(r.timestamp);
            const d = isFinite(ts) ? new Date(ts) : null;
            const when = d ? (d.toDateString() === today ? CL.fmtTime(ts) : CL.fmtDateTime(ts)) : '—';
            const tk = r.tokens || {};
            const model = r.alias && r.alias !== r.model ? r.alias + ' → ' + r.model : r.model || '—';
            const code = r.fail && r.fail.status_code;
            const why = r.failed ? failText(r) : '';
            return '<tr><td class="nowrap num faint">' + esc(when) + '</td>' +
              '<td class="mono wrap-text">' + esc(model) + '</td>' +
              '<td><span class="ellipsis" style="display:block;max-width:240px">' + esc(r.source || r.auth_index || '—') + '</span>' + (r.provider ? '<span class="cell-sub">' + esc(CL.provTitle(r.provider)) + '</span>' : '') + '</td>' +
              '<td class="num nowrap">' + CL.fmtNum(tk.input_tokens) + ' <span class="faint">/</span> ' + CL.fmtNum(tk.output_tokens) + '</td>' +
              '<td class="num nowrap">' + (r.latency_ms != null ? CL.fmtMs(r.latency_ms) : '—') + '</td>' +
              '<td>' + (r.failed ? '<span class="chip bad"' + (why ? ' data-tip="' + esc(why) + '"' : '') + '>' + esc(code ? String(code) : t('Помилка')) + '</span>' : '<span class="chip ok">OK</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="more"><span class="hint" style="align-self:center;margin-inline-end:10px">' + esc(t('Показано {n} з {m}', { n: shown.length, m: full ? list.length : t('останніх') })) + '</span>' +
          ((!full && hist.length >= 50) || shown.length < list.length ? '<button class="btn sm" id="sReqMore">' + esc(t('Показати ще')) + '</button>' : '') + '</div>';
        const more = $('#sReqMore');
        if (more) more.addEventListener('click', () => CL.ui.busy(more, async () => { if (!full) await loadFull(); reqShown += 100; paintReq(); }));
      }
      const needFull = async () => { if (!full) { try { await loadFull(); } catch (e) { CL.fail(e); } } if (ctx.alive()) paintReq(); };
      CL.ui.onSeg($('#sReqFilter'), (v) => { reqFilter = v; reqShown = 50; needFull(); });
      $('#sReqSearch').addEventListener('input', CL.debounce((e) => { reqQuery = e.target.value.trim().toLowerCase(); reqShown = 50; needFull(); }, 200));

      const live = $('#sLive');
      let liveRows = 0;
      const liveEmpty = () => { live.innerHTML = '<div class="small faint" style="padding:6px 0">' + esc(t('Чекаю на запити — нові з’являться тут миттєво.')) + '</div>'; };
      liveEmpty();
      ctx.on('live', (ev) => {
        if (ev.type === 'request') {
          if (!liveRows) live.innerHTML = '';
          liveRows++;
          live.insertAdjacentHTML('afterbegin', feedRow(ev));
          while (live.children.length > 6) live.lastElementChild.remove();
          loadSummarySoon();
        } else if (ev.type === 'error') {
          loadErrorsSoon();
        }
      });

      // ---- export / clear metrics ----
      $('#sExport').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
        const m = await loadFull();
        const out = Object.assign({}, m, { history: (m.history || []).map(stripSecrets) });
        download('cartelink-metrics-' + today() + '.json', out);
        if (ctx.alive()) paintReq();
      }));
      $('#sClear').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
        if (!(await CL.confirm('Очистити всю статистику? Лічильники, графік, розподіл за моделями й історія запитів почнуться з нуля. Журнал помилок і ліміти акаунтів це не зачепить.', { danger: true, ok: 'Очистити' }))) return;
        await CL.api.post('/metrics/clear');
        full = null;
        hist = [];
        CL.toast('Статистику очищено ✓');
        await loadSummary();
      }));

      // ---------------------------------------------------- programs --
      let apps = null;
      async function loadApps() {
        try { apps = (await CL.api.get('/stats/apps')).apps || []; } catch (e) { return; }
        if (ctx.alive()) paintApps();
      }
      function paintApps() {
        const box = $('#sApps');
        const list = (apps || []).filter((a) => a.requests > 0);
        $('#sAppsN').textContent = list.length ? t('{n} програм', { n: list.length }) : '';
        if (!list.length) { box.innerHTML = CL.ui.empty('plug', 'Ще немає даних', 'Тут видно, яка програма скільки запитів надіслала і як швидко їй відповідали.'); return; }
        const max = Math.max(1, ...list.map((a) => a.requests));
        box.innerHTML = '<div class="list">' + list.map((a) => '<div class="li"><span class="avatar">' + esc(String(a.name).slice(0, 2)) + '</span><div class="grow" style="min-width:0"><b>' + esc(a.name) + '</b>' +
          '<span>' + esc(t('{n} запитів · {bad} помилок', { n: CL.fmtInt(a.requests), bad: CL.fmtInt(a.failed || 0) })) + (a.avgMs ? ' · ' + esc(t('відповідь {ms}', { ms: CL.fmtMs(a.avgMs) })) : '') + (a.tokens ? ' · ' + esc(t('{n} токенів', { n: CL.fmtNum(a.tokens) })) : '') + '</span>' +
          CL.ui.bar(a.requests / max * 100, a.failed && a.failed / a.requests > 0.2 ? 'warn' : '') + '</div>' +
          (a.last ? '<span class="small faint nowrap">' + esc(CL.relTime(a.last)) + '</span>' : '') + '</div>').join('') + '</div>';
      }

      // -------------------------------------------------------- cost --
      const priceOf = (model) => {
        const P = window.CL_PRICES;
        if (!P || !P.models) return null;
        const id = CL.cleanModel(String(model || '')).toLowerCase();
        return P.models.find((p) => { try { return new RegExp(p.match).test(id); } catch (e) { return false; } }) || null;
      };
      function paintCost() {
        const box = $('#sCost');
        const rows = Object.entries((sum && sum.model_stats) || {}).map(([model, st]) => {
          const p = priceOf(model);
          if (!p) return { model, st, p: null, usd: 0 };
          const cached = Math.min(st.cached || 0, st.input || 0);
          const fresh = Math.max(0, (st.input || 0) - (p.cached != null ? cached : 0));
          const usd = (fresh * p.input + (p.cached != null ? cached * p.cached : 0) + (st.output || 0) * p.output) / 1e6;
          return { model, st, p, usd };
        });
        const priced = rows.filter((r) => r.p).sort((a, b) => b.usd - a.usd);
        const unpriced = rows.filter((r) => !r.p && (r.st.total || 0) > 0);
        const total = priced.reduce((x, r) => x + r.usd, 0);
        const fmt = (v) => '$' + (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(v >= 1 ? 2 : 3));
        $('#sCostTotal').textContent = rows.length ? fmt(total) : '';
        if (!rows.length) { box.innerHTML = CL.ui.empty('coins', 'Ще немає даних', 'Покаже, скільки коштували б ці запити за офіційними цінами API.'); $('#sCostNote').textContent = ''; return; }
        const max = Math.max(0.000001, ...priced.map((r) => r.usd));
        box.innerHTML = '<div class="list">' + priced.slice(0, 8).map((r) => '<div class="li"><div class="grow" style="min-width:0"><b class="mono ellipsis">' + esc(r.model) + '</b>' +
          '<span>' + esc(t('{in} вх. · {out} вих. · ціна {name}', { in: CL.fmtNum(r.st.input || 0), out: CL.fmtNum(r.st.output || 0), name: r.p.name })) + '</span>' + CL.ui.bar(r.usd / max * 100, '') + '</div>' +
          '<b class="num nowrap">' + fmt(r.usd) + '</b></div>').join('') + '</div>' +
          (unpriced.length ? '<div class="hint" style="margin-top:8px">' + esc(t('Без ціни (не враховано): {list}', { list: unpriced.map((r) => r.model).slice(0, 6).join(', ') + (unpriced.length > 6 ? '…' : '') })) + '</div>' : '');
        const P = window.CL_PRICES;
        $('#sCostNote').textContent = t('Приблизно, за публічними цінами API{d}, за весь період статистики. Через CarteLink ти платиш лише за свої підписки й акаунти.', { d: P && P.checked ? ' ' + t('на {d}', { d: P.checked }) : '' });
      }

      // ------------------------------------------------------- errors --
      const KINDS = [['', 'Усі джерела'], ['upstream', 'Відповідь провайдера'], ['gateway', 'Відхилив CarteLink'], ['auto', 'CarteLink виправив сам'], ['app', 'Робота програми']];
      let errs = [];
      let errShown = 100;
      const openErr = new Set();
      const ef = { kind: '', status: '', q: '' };
      $('#sErrKind').innerHTML = KINDS.map(([v, l]) => '<option value="' + v + '">' + esc(t(l)) + '</option>').join('');

      async function loadErrors() {
        let r;
        try { r = await CL.api.get('/errors?limit=500'); } catch (e) {
          if (ctx.alive() && !errs.length) $('#sErrors').innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Не вдалось прочитати журнал: {e}', { e: e.message })) + '</div></div>';
          return;
        }
        if (!ctx.alive()) return;
        errs = r.errors || [];
        $('#sErrCount').textContent = errs.length ? t('{n} записів · {d} за добу', { n: CL.fmtInt(r.total != null ? r.total : errs.length), d: CL.fmtInt(r.last24h || 0) }) : '';
        const sel = $('#sErrStatus');
        const codes = Array.from(new Set(errs.map((e) => e.status).filter(Boolean))).sort((a, b) => a - b);
        if (ef.status && !codes.includes(Number(ef.status))) ef.status = '';
        sel.innerHTML = '<option value="">' + esc(t('Усі коди')) + '</option>' + codes.map((c) => '<option value="' + c + '"' + (String(c) === ef.status ? ' selected' : '') + '>' + c + ' · ' + esc(t(codeName(c))) + '</option>').join('');
        paintErrors();
      }
      const loadErrorsSoon = CL.debounce(loadErrors, 800);
      const errKey = (e) => (e.first || e.t) + '|' + e.status + '|' + (e.path || '') + '|' + (e.model || '') + '|' + String(e.message || '').slice(0, 40);

      function paintErrors() {
        const box = $('#sErrors');
        const q = ef.q;
        const list = errs.filter((e) => (!ef.kind || e.kind === ef.kind) && (!ef.status || String(e.status) === ef.status) &&
          (!q || [e.message, e.model, e.resolved, e.client, e.path, e.key].some((x) => x && String(x).toLowerCase().includes(q))));
        if (!errs.length) { box.innerHTML = CL.ui.empty('check', 'Помилок немає', 'Усе працює як слід. Якщо щось піде не так, причина й порада з’являться тут.'); return; }
        if (!list.length) { box.innerHTML = CL.ui.empty('search', 'Нічого не знайдено', 'Зміни фільтр або пошук.'); return; }
        const shown = list.slice(0, errShown);
        box.innerHTML = '<div class="t-scroll"><table class="table"><thead><tr><th>' + esc(t('Коли')) + '</th><th>' + esc(t('Код')) + '</th><th>' + esc(t('Модель')) + '</th><th>' + esc(t('Що сталось')) + '</th><th></th></tr></thead><tbody>' +
          shown.map((e) => {
            const k = errKey(e);
            const open = openErr.has(k);
            const hint = CL.errorHint(e);
            return '<tr class="err-row" tabindex="0" data-k="' + esc(k) + '" aria-expanded="' + open + '">' +
              '<td class="nowrap"><span data-tip="' + esc(new Date(e.t).toLocaleString()) + '">' + esc(CL.relTime(e.t)) + '</span>' + (e.count > 1 ? ' <span class="chip outline">×' + e.count + '</span>' : '') + '</td>' +
              '<td class="nowrap">' + codeChips(e) + '</td>' +
              '<td class="mono wrap-text" style="max-width:260px">' + esc(e.model ? (e.resolved && e.resolved !== e.model ? e.model + ' → ' + e.resolved : e.model) : '—') + '</td>' +
              '<td class="wrap-text"><b style="font-weight:500">' + esc(hint || e.message || '—') + '</b>' + (hint ? '<span class="cell-sub">' + esc(trim(e.message, 180)) + '</span>' : '') + '</td>' +
              '<td>' + ic('chevron', 'sm chev') + '</td></tr>' +
              '<tr class="err-detail"' + (open ? '' : ' hidden') + '><td colspan="5">' + (open ? errDetail(e, hint) : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          (shown.length < list.length ? '<div class="more"><button class="btn sm" id="sErrMore">' + esc(t('Показати ще ({n})', { n: list.length - shown.length })) + '</button></div>' : '');
        const more = $('#sErrMore');
        if (more) more.addEventListener('click', () => { errShown += 100; paintErrors(); });
      }
      function toggleErr(row) {
        const k = row.dataset.k;
        const det = row.nextElementSibling;
        const e = errs.find((x) => errKey(x) === k);
        if (!e || !det) return;
        const open = !openErr.has(k);
        if (open) openErr.add(k); else openErr.delete(k);
        row.setAttribute('aria-expanded', String(open));
        det.hidden = !open;
        det.firstElementChild.innerHTML = open ? errDetail(e, CL.errorHint(e)) : '';
      }
      $('#sErrors').addEventListener('click', (ev) => {
        if (ev.target.closest('.copy-btn, a, button')) return;
        const row = ev.target.closest('tr.err-row');
        if (row) toggleErr(row);
      });
      $('#sErrors').addEventListener('keydown', (ev) => {
        const row = ev.target.closest('tr.err-row');
        if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); toggleErr(row); }
      });
      $('#sErrKind').addEventListener('change', (e) => { ef.kind = e.target.value; errShown = 100; paintErrors(); });
      $('#sErrStatus').addEventListener('change', (e) => { ef.status = e.target.value; errShown = 100; paintErrors(); });
      $('#sErrSearch').addEventListener('input', CL.debounce((e) => { ef.q = e.target.value.trim().toLowerCase(); errShown = 100; paintErrors(); }, 200));
      $('#sErrRefresh').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, loadErrors));
      $('#sErrExport').addEventListener('click', () => {
        if (!errs.length) { CL.toast('Журнал порожній — нічого експортувати', 'info'); return; }
        download('cartelink-errors-' + today() + '.json', errs);
      });
      $('#sErrClear').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
        if (!(await CL.confirm('Очистити журнал помилок? Усі записи зникнуть, також із файлу data/errors.jsonl.', { danger: true, ok: 'Очистити' }))) return;
        await CL.api.post('/errors/clear');
        openErr.clear();
        CL.toast('Журнал помилок очищено ✓');
        await loadErrors();
      }));

      // ------------------------------------------------------- start --
      await Promise.all([loadSummary(), loadApps(), loadErrors(), loadKeyNames()]);
      ctx.every(5000, loadSummary);
      ctx.every(20000, loadApps);
      ctx.every(30000, loadErrors);
      ctx.on('changed', (w) => {
        if (w === 'metrics') loadSummarySoon();
        else if (w === 'errors') loadErrorsSoon();
        else if (w === 'config') loadKeyNames();
        else if (w === 'all') { loadSummarySoon(); loadErrorsSoon(); loadApps(); }
      });
    },
  });

  // ------------------------------------------------------------ helpers --

  function kpi(id, icon, label) {
    return '<div class="kpi" id="' + id + '"><div class="kpi-label">' + ic(icon, 'sm') + esc(t(label)) + '</div><div class="kpi-value">—</div><div class="kpi-sub">&nbsp;</div></div>';
  }

  function feedRow(ev) {
    const ok = ev.status < 400;
    const model = ev.resolved && ev.resolved !== ev.model ? ev.model + ' → ' + ev.resolved : ev.model || ev.path;
    return '<div class="feed-row"><span class="faint num">' + CL.fmtTime(ev.t) + '</span><span class="st ' + (ok ? 'ok' : 'bad') + '">' + esc(ev.status) + '</span>' +
      '<span class="ellipsis mono" title="' + esc(model + (ev.client ? ' · ' + ev.client : '')) + '">' + esc(model) + (ev.key ? ' <span class="chip outline">' + esc(ev.key) + '</span>' : '') + '</span><span class="faint num">' + CL.fmtMs(ev.ms || 0) + '</span></div>';
  }

  const pct = (v) => { v = Number(v) || 0; return v > 0 && v < 10 ? v.toFixed(1) : String(Math.round(v)); };

  function failText(r) {
    const f = r.fail || {};
    let msg = '';
    try { const j = JSON.parse(f.body); msg = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (e) { msg = f.body || ''; }
    return trim(typeof msg === 'string' ? msg : JSON.stringify(msg), 240);
  }

  const trim = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  function codeName(c) {
    return ({ 400: 'неправильний запит', 401: 'невірний ключ', 403: 'доступ заборонено', 404: 'не знайдено', 408: 'час вийшов', 413: 'запит завеликий', 429: 'ліміт', 500: 'збій провайдера', 502: 'збій зв’язку', 503: 'недоступно', 504: 'час вийшов' })[c] || 'інша помилка';
  }

  function codeChips(e) {
    if (e.kind === 'auto') return '<span class="chip info">' + esc(t('виправлено')) + '</span>';
    if (e.kind === 'app') return '<span class="chip warn">CarteLink</span>';
    return '<span class="chip bad mono">' + esc(e.status || '—') + '</span>' + (e.kind === 'gateway' ? ' <span class="chip outline">CarteLink</span>' : '');
  }

  function errDetail(e, hint) {
    const KIND = { upstream: 'Відповідь провайдера', gateway: 'Відхилив CarteLink', auto: 'CarteLink виправив сам', app: 'Робота програми' };
    const row = (label, v, mono) => (v ? '<dt>' + esc(t(label)) + '</dt><dd' + (mono ? ' class="mono wrap-text"' : ' class="wrap-text"') + '>' + esc(v) + '</dd>' : '');
    return '<div class="stack" style="gap:12px;padding:4px 0">' +
      (hint ? '<div class="row nw top">' + ic('bulb', 'sm') + '<span>' + esc(hint) + '</span></div>' : '') +
      '<dl class="kv">' +
        row('Звідки', t(KIND[e.kind] || e.kind || '—')) +
        row('Уперше', e.first && e.first !== e.t ? new Date(e.first).toLocaleString() : '') +
        row('Востаннє', new Date(e.t).toLocaleString()) +
        row('Скільки разів', e.count > 1 ? String(e.count) : '') +
        row('Запит', [e.method, e.path].filter(Boolean).join(' '), true) +
        row('Модель', e.model ? (e.resolved && e.resolved !== e.model ? e.model + ' → ' + e.resolved : e.model) : '', true) +
        row('Програма', e.client) +
        row('API-ключ', e.key) +
      '</dl>' +
      (e.message ? '<div class="field"><label>' + esc(t('Повний текст помилки')) + '</label>' + CL.ui.code(e.message) + '</div>' : '') +
      '</div>';
  }

  function stripSecrets(r) {
    const o = Object.assign({}, r);
    delete o.api_key;
    delete o.access_token_sha256;
    return o;
  }

  const today = () => { const d = new Date(); const p = (x) => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    CL.toast(t('Збережено файл {name}', { name }));
  }
})();
