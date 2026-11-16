'use strict';
// Підключити програму: pick an app, get its exact settings with the real
// address, key and model filled in, plus a one-line connection check.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  const KINDS = [['cli', 'Термінал'], ['ide', 'Редактор коду'], ['app', 'Чат-застосунок'], ['sdk', 'Для розробників']];
  const API_NAME = { anthropic: 'Anthropic API', openai: 'OpenAI API', gemini: 'Gemini API' };
  const SHELLS = [['ps', 'PowerShell'], ['cmd', 'CMD'], ['bash', 'macOS / Linux']];
  const TIERS = {
    label: 'Рівні CarteLink (міняються на сторінці «Моделі»)',
    options: [
      { value: 'cartelink-main', text: 'cartelink-main — основна (рекомендовано)' },
      { value: 'cartelink-fast', text: 'cartelink-fast — швидка' },
      { value: 'cartelink-max', text: 'cartelink-max — потужна' },
    ],
  };
  const CTX = {}; // model → context window (0 = unknown)
  // Programs CarteLink can configure itself (client id → /api/connect id).
  const AUTO = { 'claude-code': 'claude-code', 'codex-cli': 'codex', opencode: 'opencode', 'qwen-code': 'qwen-code', 'gemini-cli': 'gemini-cli' };
  const AUTO_HINT = 'CarteLink сам впише адресу й ключ у налаштування програми. Решта твоїх налаштувань не зміниться.';

  const STYLE = '<style>' +
    '.pg-connect .cl-list{display:flex;flex-direction:column;gap:2px;max-height:calc(100vh - 260px);min-height:240px;overflow:auto;margin:0 -6px;padding:0 6px}' +
    '.pg-connect .cl-grp{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);padding:12px 8px 4px}' +
    '.pg-connect .cl-grp:first-child{padding-top:2px}' +
    '.pg-connect .cl-item{display:flex;align-items:center;gap:10px;width:100%;padding:7px 8px;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--text-2);cursor:pointer;text-align:start;transition:background var(--dur) var(--ease),color var(--dur)}' +
    '.pg-connect .cl-item:hover{background:var(--surface-2);color:var(--text)}' +
    '.pg-connect .cl-item.on{background:var(--accent-soft);color:var(--text)}' +
    '.pg-connect .cl-item .avatar{width:26px;height:26px;border-radius:7px;font-size:10.5px}' +
    '.pg-connect .cl-item.on .avatar{background:var(--accent);color:var(--accent-ink)}' +
    '.pg-connect .sec{margin-top:22px}' +
    '.pg-connect .sec-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}' +
    '.pg-connect .sec-h h3{margin:0;font:600 13.5px/1.3 var(--font);text-transform:var(--caps)}' +
    '.pg-connect .num-b{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--surface-3);color:var(--text-2);font:700 11px/1 var(--font)}' +
    '.pg-connect ol.steps{margin:0;padding-inline-start:20px;display:flex;flex-direction:column;gap:6px;color:var(--text)}' +
    '.pg-connect ol.steps li::marker{color:var(--text-3);font-weight:600}' +
    '.pg-connect .check-list{margin:8px 0 0;padding-inline-start:18px;color:var(--text-2);font-size:12.5px;display:flex;flex-direction:column;gap:3px}' +
    '.pg-connect .done-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:22px;padding-top:16px;border-top:var(--border-w) solid var(--line)}' +
    '.pg-connect .auto{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:14px 0 4px;padding:12px 14px;border:var(--border-w) solid color-mix(in srgb,var(--accent) 40%,var(--line));border-radius:var(--radius);background:var(--accent-soft)}' +
    '.pg-connect .auto b{display:block}' +
    '.pg-connect .auto .hint{margin:2px 0 0}' +
    '.pg-connect .dev-qr{display:grid;place-items:center;margin:10px 0;padding:10px;background:#fff;border-radius:var(--radius-sm)}' +
    '.pg-connect .dev-qr img{width:180px;height:180px}' +
    '</style>';

  CL.page('connect', {
    title: 'Підключити програму', icon: 'plug', group: 'manage', order: 60,

    async render(root, ctx) {
      root.classList.add('pg-connect');
      const list = window.CLIENTS || [];
      const S = loadState();
      if (!list.some((c) => c.id === S.client)) S.client = 'claude-code';

      root.innerHTML = STYLE +
        '<div class="blocks" data-area="connect">' +
        '<section class="block card" data-block="apps" data-w="4" data-title="Програми">' +
          '<div class="card-h"><div class="card-icon">' + ic('list') + '</div><h2>' + esc(t('Програми')) + '</h2><span class="grow"></span><span class="sub">' + esc(t('{n} програм', { n: list.length })) + '</span></div>' +
          '<input class="input" id="cSearch" type="search" placeholder="' + esc(t('Знайти програму…')) + '" aria-label="' + esc(t('Знайти програму…')) + '" style="margin-bottom:10px">' +
          '<div class="cl-list" id="cList" role="listbox" aria-label="' + esc(t('Програми')) + '"></div>' +
        '</section>' +
        '<section class="block card" data-block="guide" data-w="8" data-title="Інструкція"><div id="cDetail">' + CL.ui.skeleton(6) + '</div></section>' +
        '<section class="block card" data-block="device" data-w="4" data-title="Інший пристрій">' +
          '<div class="card-h"><div class="card-icon">' + ic('globe') + '</div><h2>' + esc(t('Інший пристрій')) + '</h2></div><div id="cDev">' + CL.ui.skeleton(3) + '</div></section>' +
        '</div>';

      const $ = (s) => root.querySelector(s);
      root.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) CL.go(g.dataset.goto); });

      let st = CL.status;
      let ep = CL.endpoints;
      if (!S.shell) S.shell = defaultShell(st);

      // ---- list ----
      let query = '';
      function paintList() {
        const q = query.toLowerCase();
        const html = KINDS.map(([kind, label]) => {
          const items = list.filter((c) => c.kind === kind && (!q || c.name.toLowerCase().includes(q) || c.id.includes(q)));
          if (!items.length) return '';
          return '<div class="cl-grp">' + esc(t(label)) + '</div>' + items.map((c) =>
            '<button class="cl-item' + (c.id === S.client ? ' on' : '') + '" role="option" aria-selected="' + (c.id === S.client) + '" data-client="' + esc(c.id) + '">' +
            '<span class="avatar">' + esc(initials(c.name)) + '</span><span class="grow ellipsis">' + esc(c.name) + '</span>' +
            (c.uncertain ? '<span class="chip warn" data-tip="' + esc(t('Власна адреса підтримується частково — дивись примітку')) + '">!</span>' : '') + '</button>').join('');
        }).join('');
        $('#cList').innerHTML = html || CL.ui.empty('search', 'Нічого не знайдено', 'Спробуй іншу назву. Якщо програми немає у списку, але вона вміє «OpenAI-сумісний» або «Anthropic» сервер — обери SDK або curl.');
      }
      $('#cSearch').addEventListener('input', (e) => { query = e.target.value.trim(); paintList(); });
      $('#cSearch').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const b = $('#cList .cl-item'); if (b) b.click(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); const b = $('#cList .cl-item'); if (b) b.focus(); }
      });
      $('#cList').addEventListener('click', (e) => {
        const b = e.target.closest('[data-client]');
        if (!b) return;
        S.client = b.dataset.client;
        saveState(S);
        paintList();
        paintDetail();
        const again = $('#cList [data-client="' + S.client + '"]');
        if (again) again.focus();
      });
      $('#cList').addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const items = Array.from(root.querySelectorAll('#cList .cl-item'));
        const i = items.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        const n = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (n) n.focus();
      });

      // ---- vars ----
      function vars() {
        const base = (ep && (ep.base || ep.anthropic)) || 'http://127.0.0.1:' + ((st && st.engine && st.engine.port) || 8317);
        const requireKey = ep ? ep.requireKey !== false : !(st && st.requireKey === false);
        const key = !requireKey ? 'any' : (ep && ep.key) || '<' + t('ключ') + '>';
        return { BASE: base, BASE_V1: base + '/v1', KEY: key, MODEL: S.model || 'cartelink-main', MODEL_FAST: S.fast || 'cartelink-fast' };
      }
      function fill(s, v) {
        const c = CTX[v.MODEL] || 0;
        let out = String(s || '');
        if (!c) out = out.split('\n').filter((l) => l.indexOf('{{CTX') < 0).join('\n');
        const vals = Object.assign({}, v, { CTX: String(c), CTX_COMPACT: String(Math.floor(c * 0.9)) });
        return out.replace(/\{\{(BASE_V1|BASE|KEY|MODEL_FAST|MODEL|CTX_COMPACT|CTX)\}\}/g, (m, k) => vals[k]);
      }
      async function loadCtx(model) {
        if (!model || model in CTX) return;
        CTX[model] = 0;
        try { const r = await CL.api.get('/model-context?model=' + encodeURIComponent(model)); CTX[model] = (r && r.context) || 0; } catch (e) { /* unknown */ }
        if (CTX[model] && ctx.alive() && S.model === model) paintBody();
      }

      // ---- detail ----
      const current = () => list.find((c) => c.id === S.client);
      function paintDetail() {
        const box = $('#cDetail');
        const c = current();
        if (!c) { box.innerHTML = CL.ui.empty('plug', 'Обери програму', 'Ліворуч — список програм, які вміють працювати через CarteLink.'); return; }
        const tpl = JSON.stringify([c.env, c.file, c.steps]);
        const needModel = tpl.indexOf('{{MODEL}}') >= 0;
        const needFast = tpl.indexOf('{{MODEL_FAST}}') >= 0;
        const v = vars();
        box.innerHTML =
          '<div class="card-h"><span class="avatar">' + esc(initials(c.name)) + '</span><div class="grow"><h2>' + esc(c.name) + '</h2>' +
            '<div class="row" style="gap:6px;margin-top:4px"><span class="chip outline">' + esc(t(kindLabel(c.kind))) + '</span><span class="chip outline mono">' + esc(API_NAME[c.api] || c.api) + '</span>' +
            (c.uncertain ? '<span class="chip warn">' + esc(t('підтримка часткова')) + '</span>' : '') + '</div></div>' +
            (c.docs ? '<a class="btn sm ghost" href="' + esc(c.docs) + '" target="_blank" rel="noopener">' + esc(t('Документація')) + ic('external', 'sm') + '</a>' : '') + '</div>' +
          (c.note ? '<div class="banner' + (c.uncertain ? '' : ' info') + '">' + ic(c.uncertain ? 'alert' : 'info') + '<div>' + esc(fill(t(c.note), v)) + '</div></div>' : '') +
          (AUTO[c.id] ? '<div class="auto" id="cAuto"><div class="grow"><b>' + esc(t('Підключити одним кліком')) + '</b><div class="hint" id="cAutoNote">' + esc(t(AUTO_HINT)) + '</div></div>' +
            '<button class="btn primary" id="cAutoGo">' + ic('zap', 'sm') + esc(t('Підключити')) + '</button><button class="btn ghost" id="cAutoUndo" hidden>' + esc(t('Повернути як було')) + '</button></div>' : '') +
          '<dl class="kv" style="margin-top:4px">' +
            '<dt>' + esc(t('Адреса')) + '</dt><dd><div class="input-group"><input class="input mono" id="cAddr" readonly><button class="btn icon" data-copy-from="#cAddr" data-tip="Копіювати">' + ic('copy', 'sm') + '</button></div></dd>' +
            '<dt>' + esc(t('API-ключ')) + '</dt><dd><div class="input-group"><input class="input mono" id="cKey" type="password" readonly><button class="btn icon" id="cKeyEye" data-tip="Показати / сховати">' + ic('eye', 'sm') + '</button><button class="btn icon" data-copy-from="#cKey" data-tip="Копіювати">' + ic('copy', 'sm') + '</button></div></dd>' +
          '</dl>' +
          (needModel || needFast ? '<div class="' + (needModel && needFast ? 'cols-2' : '') + '" style="margin-top:16px">' +
            (needModel ? '<div class="field"><label>' + esc(t('Модель')) + '</label><div id="cModel"></div></div>' : '') +
            (needFast ? '<div class="field"><label>' + esc(t('Швидка модель')) + '</label><div id="cFast"></div></div>' : '') +
            '</div><div class="hint" style="margin-top:6px">' + esc(t('Рівні cartelink-main / fast / max зручні: модель за ними міняєш на сторінці «Моделі», а налаштування програми лишаються ті самі.')) + '</div>' : '') +
          '<div id="cBody"></div>' +
          '<div class="done-row"><button class="btn primary" id="cDone">' + ic('check', 'sm') + esc(t('Я підключив')) + '</button>' +
            '<span class="hint grow">' + esc(isDone() ? t('Позначено: крок «Підключи програму» на Огляді виконано.') : t('Познач, коли програма запрацює, — крок 3 «Швидкого налаштування» на Огляді стане виконаним.')) + '</span></div>';

        const addr = $('#cAddr');
        addr.value = c.api === 'openai' ? v.BASE_V1 : v.BASE;
        const key = $('#cKey');
        key.value = v.KEY;
        if (v.KEY === 'any') key.type = 'text';
        $('#cKeyEye').addEventListener('click', () => { key.type = key.type === 'password' ? 'text' : 'password'; });
        const pick = (host, val, set) => CL.ui.modelPicker(host, { value: val, empty: false, extra: [{ label: t(TIERS.label), options: TIERS.options.map((o) => ({ value: o.value, text: t(o.text) })) }], onChange: (m) => { set(m); saveState(S); paintBody(); } });
        if (needModel) pick($('#cModel'), S.model || 'cartelink-main', (m) => { S.model = m || 'cartelink-main'; });
        if (needFast) pick($('#cFast'), S.fast || 'cartelink-fast', (m) => { S.fast = m || 'cartelink-fast'; });
        $('#cDone').addEventListener('click', () => {
          try { localStorage.setItem('cl.clientDone', '1'); } catch (e) { /* ignore */ }
          CL.toast('Готово! Якщо програма пише помилку — відкрий «Перевірити з’єднання» або Довідку.');
          root.querySelector('.done-row .hint').textContent = t('Позначено: крок «Підключи програму» на Огляді виконано.');
        });
        if (AUTO[c.id]) wireAuto(c);
        paintBody();
      }

      let autoInfo = null;
      async function wireAuto(c) {
        const id = AUTO[c.id];
        const note = $('#cAutoNote');
        const go = $('#cAutoGo');
        const undo = $('#cAutoUndo');
        const show = () => {
          const p = autoInfo && (autoInfo.programs || []).find((x) => x.id === id);
          if (!p || !go || !document.contains(go)) return;
          go.innerHTML = ic(p.configured ? 'rotate' : 'zap', 'sm') + esc(t(p.configured ? 'Підключити знову' : 'Підключити'));
          undo.hidden = !p.backup;
          if (p.configured) note.textContent = t('Уже підключено: {path} вказує на CarteLink.', { path: p.path });
        };
        go.addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
          const body = {};
          if (S.model && S.model !== 'cartelink-main') body.model = S.model;
          if (S.fast && S.fast !== 'cartelink-fast') body.fastModel = S.fast;
          const r = await CL.api.post('/connect/' + id, body);
          autoInfo = await CL.api.get('/connect').catch(() => autoInfo);
          show();
          note.textContent = (r.note || '') + (r.exportLine ? ' ' + r.exportLine : '');
          CL.toast(t('Підключено: {path}', { path: r.path }));
          try { localStorage.setItem('cl.clientDone', '1'); } catch (x) { /* ignore */ }
        }));
        undo.addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
          if (!(await CL.confirm('Повернути файл налаштувань програми до стану, який був до CarteLink?'))) return;
          const r = await CL.api.post('/connect/' + id + '/undo');
          CL.toast(r.note || t('Готово'));
          autoInfo = await CL.api.get('/connect').catch(() => autoInfo);
          note.textContent = t(AUTO_HINT);
          show();
        }));
        if (!autoInfo) autoInfo = await CL.api.get('/connect').catch(() => null);
        if (ctx.alive() && current() === c) show();
      }

      async function paintDevice() {
        const box = $('#cDev');
        let d = null;
        try { d = await CL.api.get('/devices/lan'); } catch (e) { /* offline */ }
        if (!ctx.alive()) return;
        if (!d) { box.innerHTML = '<div class="hint">' + esc(t('Не вдалося отримати адресу.')) + '</div>'; return; }
        if (!d.lan || !d.urls || !d.urls.length) {
          box.innerHTML = '<p class="hint" style="margin:0 0 10px">' + esc(t('Зараз CarteLink приймає запити лише з цього комп’ютера. Щоб підключити телефон чи інший ПК у тій самій мережі, увімкни доступ з локальної мережі.')) + '</p>' +
            '<button class="btn" data-goto="settings">' + ic('sliders', 'sm') + esc(t('Налаштування шлюзу')) + '</button>';
          return;
        }
        const url = d.urls[0];
        const key = (ep && ep.requireKey !== false && ep.key) || '';
        box.innerHTML = '<p class="hint" style="margin:0">' + esc(t('Скануй камерою телефона — отримаєш адресу для програми на іншому пристрої в цій мережі.')) + '</p>' +
          '<div class="dev-qr"><img alt="QR" src="/api/qr?text=' + encodeURIComponent(url) + '"></div>' +
          '<div class="input-group"><input class="input mono" readonly value="' + esc(url) + '"><button class="btn icon" data-copy-text="' + esc(url) + '" data-tip="Копіювати">' + ic('copy', 'sm') + '</button></div>' +
          (key ? '<div class="hint" style="margin-top:6px">' + esc(t('Ключ той самий, що й тут. Для іншої людини краще створи окремий ключ на сторінці «API-ключі».')) + '</div>' : '') +
          (d.urls.length > 1 ? '<div class="hint" style="margin-top:6px">' + esc(t('Інші адреси: {list}', { list: d.urls.slice(1).join(', ') })) + '</div>' : '');
        box.querySelector('[data-copy-text]').addEventListener('click', (e) => CL.copy(e.currentTarget.dataset.copyText, 'Адресу скопійовано'));
      }

      function paintBody() {
        const c = current();
        const body = $('#cBody');
        if (!c || !body) return;
        const v = vars();
        if (JSON.stringify([c.env, c.file, c.steps]).indexOf('{{CTX') >= 0) loadCtx(v.MODEL);
        let n = 0;
        let html = '';
        const sec = (title, inner, extra) => '<div class="sec"><div class="sec-h"><span class="num-b">' + ++n + '</span><h3>' + esc(t(title)) + '</h3>' + (extra || '') + '</div>' + inner + '</div>';
        if (c.steps && c.steps.length) {
          html += sec('Кроки', '<ol class="steps">' + c.steps.map((s) => '<li>' + esc(fill(t(s), v)) + '</li>').join('') + '</ol>');
        }
        if (c.env && c.env.length) {
          html += sec(c.file ? 'Спосіб 1 — змінні середовища' : 'Виконай у терміналі',
            '<div class="row" style="margin-bottom:10px">' + CL.ui.seg('cShell', SHELLS, S.shell) + CL.ui.switch('cPersist', S.persist, 'Назавжди (а не лише для цього вікна терміналу)') + '</div>' +
            CL.ui.code(envScript(c.env, S.shell, S.persist, (x) => fill(x, v))) +
            (S.persist ? '<div class="hint" style="margin-top:6px">' + esc(t('Після цього закрий і знову відкрий термінал (і саму програму), щоб вона побачила нові змінні.')) + '</div>' : ''));
        }
        if (c.file) {
          const term = c.file.path === 'terminal';
          let hint = '';
          if (!term) {
            if (c.file.path.indexOf('~') === 0) {
              hint = esc(t('Створи або відкрий файл {path} (на Windows {tilde} — це {home}) і встав:', { path: '\u0001', tilde: '\u0002', home: '\u0003' }))
                .replace('\u0001', '<code>' + esc(c.file.path) + '</code>').replace('\u0002', '<code>~</code>').replace('\u0003', '<code>C:\\Users\\&lt;' + esc(t('ім\'я')) + '&gt;</code>');
            } else {
              hint = esc(t('Створи файл {path} і встав у нього:', { path: '\u0001' })).replace('\u0001', '<code>' + esc(c.file.path) + '</code>');
            }
          }
          html += sec(term ? 'Виконай у терміналі' : c.env && c.env.length ? 'Спосіб 2 — файл налаштувань' : 'Файл налаштувань',
            (hint ? '<p class="hint" style="margin:0 0 8px">' + hint + '</p>' : '') + CL.ui.code(fill(c.file.content, v)));
        }
        html += sec('Перевірити з’єднання', S.check ? checkHtml(c, v) : '<p class="hint" style="margin:0">' + esc(t('Одна команда в терміналі покаже, чи CarteLink приймає ключ і відповідає моделлю — ще до того, як налаштовувати програму.')) + '</p>',
          '<span class="grow"></span><button class="btn sm" id="cCheck" aria-expanded="' + !!S.check + '">' + ic(S.check ? 'x' : 'terminal', 'sm') + esc(t(S.check ? 'Сховати' : 'Показати команду')) + '</button>');
        body.innerHTML = html;

        const seg = body.querySelector('#cShell');
        if (seg) CL.ui.onSeg(seg, (s) => { S.shell = s; saveState(S); paintBody(); });
        const seg2 = body.querySelector('#cShell2');
        if (seg2) CL.ui.onSeg(seg2, (s) => { S.shell = s; saveState(S); paintBody(); });
        const per = body.querySelector('#cPersist');
        if (per) per.addEventListener('change', () => { S.persist = per.checked; saveState(S); paintBody(); });
        body.querySelector('#cCheck').addEventListener('click', () => { S.check = !S.check; saveState(S); paintBody(); });
      }

      function checkHtml(c, v) {
        const usesModel = JSON.stringify([c.env, c.file, c.steps]).indexOf('{{MODEL}}') >= 0;
        const model = usesModel ? v.MODEL : 'cartelink-main';
        return '<div class="row" style="margin-bottom:10px">' + CL.ui.seg('cShell2', SHELLS, S.shell) + '</div>' +
          CL.ui.code(checkCmd(c.api, S.shell, v, model)) +
          '<ul class="check-list">' +
            '<li>' + esc(t('Прийшла відповідь з текстом — усе працює, можна налаштовувати програму.')) + '</li>' +
            '<li>' + esc(t('401 — ключ не той: скопіюй його ще раз з Огляду.')) + '</li>' +
            '<li>' + esc(t('404 або «unknown model» — такої моделі немає в акаунтах: обери іншу на сторінці «Моделі».')) + '</li>' +
            '<li>' + esc(t('429 — ліміт акаунта: зачекай або додай ще акаунт.')) + '</li>' +
            '<li>' + esc(t('Не вдалося з’єднатися — CarteLink не запущено або шлюз на паузі.')) + '</li>' +
          '</ul>' +
          (S.shell === 'ps' ? '<div class="hint" style="margin-top:6px">' + esc(t('У PowerShell використано вбудовану команду Invoke-RestMethod — окремий curl не потрібен.')) + '</div>' : '');
      }

      // ---- live data ----
      paintList();
      paintDetail();
      paintDevice();
      const [st2, ep2] = await Promise.all([CL.loadStatus().catch(() => null), CL.loadEndpoints().catch(() => null)]);
      if (!ctx.alive()) return;
      let changed = false;
      if (st2) { if (!st && !loadState().shell) S.shell = defaultShell(st2); st = st2; changed = true; }
      if (ep2) { ep = ep2; changed = true; }
      if (changed) paintDetail();
      ctx.on('changed', async (w) => {
        if (w !== 'config') return;
        try { ep = await CL.loadEndpoints(); } catch (e) { return; }
        if (!ctx.alive() || document.querySelector('.mp-pop')) return;
        const a = $('#cAddr');
        const k = $('#cKey');
        const v = vars();
        const c = current();
        if (a && c) a.value = c.api === 'openai' ? v.BASE_V1 : v.BASE;
        if (k) { k.value = v.KEY; if (v.KEY === 'any') k.type = 'text'; }
        paintBody();
      });
    },
  });

  // ------------------------------------------------------------ helpers --

  function loadState() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('cl.connect') || '{}') || {}; } catch (e) { /* defaults */ }
    return { client: s.client || 'claude-code', shell: s.shell || '', persist: s.persist !== false, model: s.model || 'cartelink-main', fast: s.fast || 'cartelink-fast', check: !!s.check };
  }
  function saveState(s) {
    try { localStorage.setItem('cl.connect', JSON.stringify(s)); } catch (e) { /* private mode */ }
  }
  function isDone() {
    try { return localStorage.getItem('cl.clientDone') === '1'; } catch (e) { return false; }
  }

  function defaultShell(st) {
    const p = (st && st.platform) || '';
    if (p) return p === 'windows' ? 'ps' : 'bash';
    return /win/i.test(navigator.platform || '') ? 'ps' : 'bash';
  }

  const kindLabel = (k) => ({ cli: 'Термінал', ide: 'Редактор коду', app: 'Чат-застосунок', sdk: 'Для розробників' })[k] || k;

  function initials(name) {
    const w = String(name).replace(/\(.*?\)/g, '').trim().split(/[\s-]+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '')[1] || '')).toUpperCase();
  }

  function envScript(env, shell, persist, f) {
    const lines = [];
    env.forEach(([k, raw]) => {
      const val = f(raw);
      if (shell === 'ps') lines.push(persist ? '[Environment]::SetEnvironmentVariable("' + k + '", "' + val + '", "User")' : '$env:' + k + ' = "' + val + '"');
      else if (shell === 'cmd') lines.push(persist ? 'setx ' + k + ' "' + val + '"' : 'set "' + k + '=' + val + '"');
      else lines.push('export ' + k + '="' + val + '"');
    });
    if (persist && shell === 'bash') lines.unshift('# ' + t('додай ці рядки в кінець ~/.zshrc (macOS) або ~/.bashrc (Linux):'));
    if (persist && shell !== 'bash') { lines.push(''); lines.push((shell === 'ps' ? '# ' : 'REM ') + t('потім закрий і знову відкрий термінал')); }
    return lines.join('\n');
  }

  /** The exact test request for an API family in the chosen shell. */
  function checkCmd(api, shell, v, model) {
    let url;
    let headers;
    let body;
    if (api === 'anthropic') {
      url = v.BASE + '/v1/messages';
      headers = [['x-api-key', v.KEY], ['anthropic-version', '2023-06-01']];
      body = { model, max_tokens: 32, messages: [{ role: 'user', content: 'Reply with the single word: OK' }] };
    } else if (api === 'gemini') {
      url = v.BASE + '/v1beta/models/' + model + ':generateContent';
      headers = [['x-goog-api-key', v.KEY]];
      body = { contents: [{ parts: [{ text: 'Reply with the single word: OK' }] }] };
    } else {
      url = v.BASE_V1 + '/chat/completions';
      headers = [['Authorization', 'Bearer ' + v.KEY]];
      body = { model, max_tokens: 32, messages: [{ role: 'user', content: 'Reply with the single word: OK' }] };
    }
    const json = JSON.stringify(body);
    if (shell === 'ps') {
      return 'Invoke-RestMethod -Method Post -Uri "' + url + '" `\n' +
        '  -Headers @{ ' + headers.map(([k, x]) => '"' + k + '" = "' + x + '"').join('; ') + ' } `\n' +
        '  -ContentType "application/json" `\n' +
        "  -Body '" + json + "' | ConvertTo-Json -Depth 8";
    }
    if (shell === 'cmd') {
      return 'curl "' + url + '" ^\n' +
        headers.map(([k, x]) => '  -H "' + k + ': ' + x + '" ^\n').join('') +
        '  -H "Content-Type: application/json" ^\n' +
        '  -d "' + json.replace(/"/g, '\\"') + '"';
    }
    return 'curl "' + url + '" \\\n' +
      headers.map(([k, x]) => '  -H "' + k + ': ' + x + '" \\\n').join('') +
      '  -H "Content-Type: application/json" \\\n' +
      "  -d '" + json + "'";
  }
})();
