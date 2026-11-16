'use strict';
// API-ключі: a separate key per app, each limited to the models picked for it.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  const STYLE = '<style>' +
    '.pg-keys .key{display:flex;gap:12px;align-items:flex-start;padding:14px 2px;border-bottom:var(--border-w) solid var(--line);min-width:0}' +
    '.pg-keys .key:last-child{border-bottom:0}' +
    '.pg-keys .key.off .key-main{opacity:.6}' +
    '.pg-keys .key-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}' +
    '.pg-keys .key-title{display:flex;align-items:center;gap:8px;min-width:0}' +
    '.pg-keys .key-title b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pg-keys .key-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;font-size:12px;color:var(--text-3)}' +
    '.pg-keys .key-meta .mono{color:var(--text-2)}' +
    '.pg-keys .key-meta .bad{color:var(--bad)}' +
    '.pg-keys .key-acts{display:flex;align-items:center;gap:4px;flex:none}' +
    '.pg-keys .tag.off{border-color:color-mix(in srgb,var(--warn) 55%,transparent);color:var(--warn);background:var(--warn-soft)}' +
    '.pg-keys .stat{display:flex;flex-direction:column;gap:2px}' +
    '.pg-keys .stat b{font:var(--fw-display) 20px/1.15 var(--font-display);font-variant-numeric:tabular-nums}' +
    '.pg-keys .stat span{font-size:12px;color:var(--text-3)}' +
    '@media (max-width:760px){.pg-keys .key{flex-wrap:wrap}.pg-keys .key-acts{width:100%;justify-content:flex-end}}' +
    // dialog (rendered outside the page root)
    '.kd-list{max-height:min(46vh,420px);overflow:auto;border:var(--border-w) solid var(--line);border-radius:var(--radius-sm);padding:4px 10px 8px;margin-top:8px}' +
    '.kd-grp{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-3);padding:10px 0 4px;position:sticky;top:-4px;background:var(--surface);z-index:1}' +
    '.kd-grp .grow{flex:1}' +
    '.kd-grp .linkbtn{text-transform:none;letter-spacing:0;font-weight:500;font-size:12px}' +
    '.kd-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:2px 12px}' +
    '.kd-items .check{padding:4px 0;min-width:0}' +
    '.kd-items .check span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);font-size:12.5px}' +
    '.kd-warn{color:var(--warn)}' +
    '.kd-err{color:var(--bad);font-size:12.5px;min-height:18px;margin-top:8px}' +
    '.kd-lim{margin-top:14px}.kd-lim summary{cursor:pointer;font-weight:600;font-size:13px;color:var(--text-2)}' +
    '</style>';

  const isoDay = (ms) => { const d = new Date(ms); const p = (x) => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

  CL.page('keys', {
    title: 'API-ключі', icon: 'key', group: 'gateway', order: 40,

    async render(root, ctx) {
      root.classList.add('pg-keys');
      root.innerHTML = STYLE +
        '<div id="kNoCheck"></div>' +
        '<div class="blocks" data-area="keys">' +
        '<section class="block card" data-block="address" data-w="7" data-title="Адреса для всіх ключів">' +
          '<div class="card-h"><div class="card-icon">' + ic('globe') + '</div><h2>' + esc(t('Адреса для всіх ключів')) + '</h2></div>' +
          '<p class="muted small">' + esc(t('Окремий ключ для кожної програми: вона бачить і може використовувати лише обрані для неї моделі. Усі ключі працюють одночасно з тією самою адресою.')) + '</p>' +
          '<div class="stack" style="gap:10px">' +
            '<div class="field"><label for="kBase">' + esc(t('Адреса (Anthropic, Gemini)')) + '</label><div class="input-group"><input class="input mono" id="kBase" readonly><button class="btn icon" data-copy-from="#kBase" data-tip="Копіювати">' + ic('copy', 'sm') + '</button></div></div>' +
            '<div class="field"><label for="kOpenAI">' + esc(t('Адреса для OpenAI-сумісних програм')) + '</label><div class="input-group"><input class="input mono" id="kOpenAI" readonly><button class="btn icon" data-copy-from="#kOpenAI" data-tip="Копіювати">' + ic('copy', 'sm') + '</button></div></div>' +
          '</div>' +
        '</section>' +
        '<section class="block card" data-block="mainkey" data-w="5" data-title="Основний ключ">' +
          '<div class="card-h"><div class="card-icon">' + ic('shield') + '</div><h2>' + esc(t('Основний ключ шлюзу')) + '</h2></div>' +
          '<p class="muted small">' + esc(t('Бачить усі моделі. Його показує сторінка «Підключити програму».')) + '</p>' +
          '<div class="field"><div class="input-group"><input class="input mono" id="kMain" type="password" readonly><button class="btn icon" id="kMainEye" data-tip="Показати / сховати">' + ic('eye', 'sm') + '</button><button class="btn icon" id="kMainCopy" data-tip="Копіювати">' + ic('copy', 'sm') + '</button></div></div>' +
          '<div class="cols-3" style="margin-top:14px" id="kMainStats">' + CL.ui.skeleton(1) + '</div>' +
          '<div class="card-foot"><span class="grow">' + esc(t('Змінити ключ або вимкнути перевірку можна в Налаштуваннях.')) + '</span><button class="btn sm ghost" data-goto="settings">' + esc(t('Налаштування')) + ic('arrow', 'sm') + '</button></div>' +
        '</section>' +
        '<section class="block card" data-block="list" data-w="12" data-title="Мої API-ключі">' +
          '<div class="card-h"><div class="card-icon">' + ic('key') + '</div><h2>' + esc(t('Мої API-ключі')) + '</h2><span class="sub" id="kCount"></span><span class="grow"></span><button class="btn primary sm" id="kNew">' + ic('plus', 'sm') + esc(t('Новий ключ')) + '</button></div>' +
          '<div id="kList">' + CL.ui.skeleton(4) + '</div>' +
        '</section>' +
        '</div>';

      const $ = (s) => root.querySelector(s);
      root.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) CL.go(g.dataset.goto); });

      let data = null; // GET /api/scoped-keys
      let ep = null; // GET /api/endpoints
      let cat = null; // CL.models()

      const served = (m) => {
        const low = String(m || '').toLowerCase().trim();
        if (cat && cat.blacklist.has(low)) return 'black';
        if (!cat || !cat.flat.length) return 'ok'; // nothing known yet: do not cry wolf
        return cat.flat.some((x) => x.toLowerCase() === low) ? 'ok' : 'gone';
      };

      function statLine(s) {
        if (!s || !s.requests) return '<span>' + esc(t('ще не використовувався')) + '</span>';
        return '<span class="num">' + esc(t('{n} запитів', { n: CL.fmtInt(s.requests) })) + '</span>' +
          (s.failed ? '<span class="num bad">' + esc(t('{n} помилок', { n: CL.fmtInt(s.failed) })) + '</span>' : '') +
          (s.last ? '<span data-tip="' + esc(CL.fmtDateTime(s.last)) + '">' + esc(t('востаннє {when}', { when: CL.relTime(s.last) })) + '</span>' : '');
      }

      function keyRow(k) {
        const on = k.enabled !== false;
        const models = k.models || [];
        return '<div class="key' + (on ? '' : ' off') + '" data-id="' + esc(k.id) + '">' +
          '<span class="avatar">' + ic('key', 'sm') + '</span>' +
          '<div class="key-main">' +
            '<div class="key-title"><b>' + esc(k.name) + '</b>' + (on ? '' : '<span class="chip">' + esc(t('вимкнено')) + '</span>') + limitChips(k) + '</div>' +
            (k.note ? '<div class="hint" style="margin:2px 0 4px">' + esc(k.note) + '</div>' : '') +
            '<div class="key-meta"><span class="mono">' + esc(CL.mask(k.key)) + '</span>' +
              '<button class="btn sm ghost" data-act="copy">' + ic('copy', 'sm') + esc(t('Скопіювати ключ')) + '</button>' +
              statLine(k.stats) +
              (k.created ? '<span>' + esc(t('створено {d}', { d: CL.fmtDateTime(k.created) })) + '</span>' : '') + '</div>' +
            '<div class="tags">' + models.map((m) => {
              const s = served(m);
              const tip = s === 'black' ? t('Модель у чорному списку (Налаштування)') : s === 'gone' ? t('Зараз жоден акаунт не обслуговує цю модель') : '';
              return '<span class="tag' + (s === 'ok' ? '' : ' off') + '"' + (tip ? ' data-tip="' + esc(tip) + '"' : '') + '>' + (s === 'ok' ? '' : ic('alert', 'sm')) + '<span class="ellipsis">' + esc(m) + '</span></span>';
            }).join('') + '</div>' +
          '</div>' +
          '<div class="key-acts">' +
            '<label class="switch" data-tip="' + esc(t(on ? 'Увімкнено — вимкнути' : 'Вимкнено — увімкнути')) + '"><input type="checkbox" data-act="toggle" aria-label="' + esc(t('Ключ увімкнено')) + '"' + (on ? ' checked' : '') + '><span class="track"></span></label>' +
            '<button class="btn sm icon ghost" data-act="edit" data-tip="Змінити">' + ic('edit', 'sm') + '</button>' +
            '<button class="btn sm icon ghost" data-act="qr" data-tip="' + esc(t('QR-код для телефона')) + '">' + ic('maximize', 'sm') + '</button>' +
            '<button class="btn sm icon ghost" data-act="rotate" data-tip="' + esc(t('Видати новий секрет')) + '">' + ic('rotate', 'sm') + '</button>' +
            '<button class="btn sm icon ghost" data-act="delete" data-tip="Видалити">' + ic('trash', 'sm') + '</button>' +
          '</div></div>';
      }

      function limitChips(k) {
        const u = k.usage || {};
        const out = [];
        if (u.expired) out.push('<span class="chip bad">' + esc(t('термін минув')) + '</span>');
        else if (k.expires) out.push('<span class="chip outline" data-tip="' + esc(CL.fmtDateTime(k.expires)) + '">' + esc(t('діє до {d}', { d: new Date(k.expires).toLocaleDateString() })) + '</span>');
        if (k.dailyRequests) {
          const full = (u.today || 0) >= k.dailyRequests;
          out.push('<span class="chip ' + (full ? 'warn' : 'outline') + '" data-tip="' + esc(t('Запитів сьогодні з денного ліміту')) + '">' + esc(t('{n} / {max} за день', { n: CL.fmtInt(u.today || 0), max: CL.fmtInt(k.dailyRequests) })) + '</span>');
        }
        if (k.rpm) out.push('<span class="chip outline" data-tip="' + esc(t('Не більше запитів за хвилину')) + '">' + esc(t('{n}/хв', { n: k.rpm })) + '</span>');
        return out.join('');
      }

      function paintList() {
        const box = $('#kList');
        const keys = (data && data.keys) || [];
        $('#kCount').textContent = keys.length ? t('{n} шт.', { n: keys.length }) : '';
        if (!keys.length) {
          box.innerHTML = CL.ui.empty('key', 'Ключів ще немає', 'Створи ключ для програми й обери, які моделі їй можна. Наприклад, окремий ключ для Cursor лише з дешевими моделями.',
            '<button class="btn primary sm" data-act="new">' + ic('plus', 'sm') + esc(t('Створити перший ключ')) + '</button>');
          return;
        }
        box.innerHTML = '<div>' + keys.map(keyRow).join('') + '</div>';
      }

      function paintMain() {
        const s = data && data.main;
        $('#kMainStats').innerHTML =
          '<div class="stat"><b>' + esc(CL.fmtNum((s && s.requests) || 0)) + '</b><span>' + esc(t('запитів')) + '</span></div>' +
          '<div class="stat"><b' + (s && s.failed ? ' style="color:var(--bad)"' : '') + '>' + esc(CL.fmtNum((s && s.failed) || 0)) + '</b><span>' + esc(t('помилок')) + '</span></div>' +
          '<div class="stat"><b style="font-size:14px;line-height:1.9">' + esc(s && s.last ? CL.relTime(s.last) : '—') + '</b><span>' + esc(t('востаннє')) + '</span></div>';
      }

      function paintEndpoints() {
        if (!ep) return;
        $('#kBase').value = ep.base || ep.anthropic || '';
        $('#kOpenAI').value = ep.openai || (ep.base ? ep.base + '/v1' : '');
        const k = $('#kMain');
        if (ep.requireKey) { k.value = ep.key || ''; } else { k.value = t('будь-який (перевірку ключа вимкнено)'); k.type = 'text'; }
        const req = data ? data.requireKey : ep.requireKey;
        $('#kNoCheck').innerHTML = req === false
          ? '<div class="banner">' + ic('alert') + '<div class="grow">' + esc(t('Перевірку ключа вимкнено: програма без ключа бачить усі моделі. Обмеження діють лише для запитів із цими ключами. Увімкни «Вимагати API-ключ від програм» у Налаштуваннях.')) + '</div><button class="btn sm" data-goto="settings">' + esc(t('Налаштування')) + ic('arrow', 'sm') + '</button></div>'
          : '';
      }
      $('#kMainEye').onclick = () => { const k = $('#kMain'); if (ep && ep.requireKey) k.type = k.type === 'password' ? 'text' : 'password'; };
      $('#kMainCopy').onclick = () => CL.copy(ep && ep.requireKey ? ep.key : 'any', 'Ключ скопійовано');

      async function load() {
        try {
          const [d, e] = await Promise.all([CL.api.get('/scoped-keys'), CL.loadEndpoints().catch(() => ep)]);
          if (!ctx.alive()) return;
          data = d;
          ep = e;
          paintEndpoints();
          paintMain();
          paintList();
        } catch (e) {
          if (!ctx.alive()) return;
          if (!data) $('#kList').innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Не вдалось завантажити ключі: {e}. Перевір, що CarteLink запущений, і онови сторінку.', { e: e.message })) + '</div></div>';
        }
      }
      async function loadCatalog(force) {
        try { cat = await CL.models(force); } catch (e) { return; }
        if (ctx.alive() && data) paintList();
      }

      const find = (id) => ((data && data.keys) || []).find((k) => k.id === id);

      // ------------------------------------------------------------ actions --
      $('#kNew').addEventListener('click', () => editDialog(null));
      $('#kList').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b || b.dataset.act === 'toggle') return;
        if (b.dataset.act === 'new') { editDialog(null); return; }
        const k = find(b.closest('[data-id]').dataset.id);
        if (!k) return;
        if (b.dataset.act === 'copy') CL.copy(k.key, 'Ключ скопійовано');
        else if (b.dataset.act === 'edit') editDialog(k);
        else if (b.dataset.act === 'qr') {
          CL.dialog({
            title: t('Ключ «{name}»', { name: k.name }),
            html: '<div class="dlg-text">' + esc(t('Скануй телефоном, щоб не переписувати ключ вручну. Не показуй цей код стороннім.')) + '</div>' +
              '<div style="display:grid;place-items:center;padding:12px;background:#fff;border-radius:var(--radius-sm)"><img alt="QR" width="220" height="220" src="/api/qr?text=' + encodeURIComponent(k.key) + '"></div>',
            actions: [{ label: 'Готово', kind: 'primary', value: true }],
          });
        }
        else if (b.dataset.act === 'rotate') {
          if (!(await CL.confirm(t('Видати новий секрет для «{name}»? Старий ключ перестане працювати одразу — програми з ним отримуватимуть помилку, доки ти не вставиш у них новий.', { name: k.name }), { danger: true, ok: 'Видати новий', title: 'Новий секрет' }))) return;
          await CL.ui.busy(b, async () => {
            const r = await CL.api.post('/scoped-keys/' + encodeURIComponent(k.id) + '/rotate');
            await load();
            if (r && r.key) showKey(r.key, 'Новий секрет готовий');
          });
        } else if (b.dataset.act === 'delete') {
          if (!(await CL.confirm(t('Видалити ключ «{name}»? Програми з цим ключем перестануть працювати. Скасувати це не можна.', { name: k.name }), { danger: true }))) return;
          await CL.ui.busy(b, async () => {
            await CL.api.del('/scoped-keys/' + encodeURIComponent(k.id));
            CL.toast(t('Ключ «{name}» видалено', { name: k.name }));
            await load();
          });
        }
      });
      $('#kList').addEventListener('change', async (e) => {
        const x = e.target.closest('[data-act="toggle"]');
        if (!x) return;
        const k = find(x.closest('[data-id]').dataset.id);
        if (!k) return;
        x.disabled = true;
        try {
          await CL.api.patch('/scoped-keys/' + encodeURIComponent(k.id), { enabled: x.checked });
          CL.toast(x.checked ? t('Ключ «{name}» увімкнено', { name: k.name }) : t('Ключ «{name}» вимкнено — програми з ним отримають помилку', { name: k.name }));
          await load();
        } catch (er) {
          x.checked = !x.checked;
          x.disabled = false;
          CL.fail(er);
        }
      });

      // ----------------------------------------------------------- dialogs --
      async function editDialog(k) {
        cat = await CL.models().catch(() => cat);
        if (!ctx.alive()) return;
        const picked = new Set((k ? k.models : []).map((m) => m.toLowerCase()));
        const pickedRaw = (k ? k.models : []).slice();
        // Groups of the catalogue (deduped, blacklist removed) + picked models no longer served.
        const seen = new Set();
        const groups = [];
        ((cat && cat.groups) || []).forEach((g) => {
          const opts = g.options.map((o) => o.value).filter((v) => {
            const l = v.toLowerCase();
            if (seen.has(l) || (cat && cat.blacklist.has(l))) return false;
            seen.add(l);
            return true;
          });
          if (opts.length) groups.push({ label: g.label, ids: opts });
        });
        const gone = pickedRaw.filter((m) => !seen.has(m.toLowerCase()));
        if (gone.length) groups.push({ label: t('Зараз недоступні'), ids: gone, warn: true });

        const listHtml = groups.length
          ? groups.map((g, gi) => '<div class="kd-g" data-g="' + gi + '"><div class="kd-grp' + (g.warn ? ' kd-warn' : '') + '">' + (g.warn ? ic('alert', 'sm') : '') + '<span>' + esc(t(g.label)) + '</span><span class="grow"></span><button type="button" class="linkbtn" data-all="' + gi + '">' + esc(t('Обрати всі')) + '</button></div>' +
              '<div class="kd-items">' + g.ids.map((id) => '<label class="check" data-m="' + esc(id.toLowerCase()) + '"' + (g.warn ? ' data-tip="' + esc(t('Зараз жоден акаунт не обслуговує цю модель')) + '"' : '') + '><input type="checkbox" value="' + esc(id) + '"' + (picked.has(id.toLowerCase()) ? ' checked' : '') + '><span title="' + esc(id) + '">' + esc(id) + '</span></label>').join('') + '</div></div>').join('')
          : CL.ui.empty('cpu', 'Моделей ще немає', 'Спочатку підключи акаунт або провайдера — тоді тут з’являться моделі.');

        const nameId = 'kd' + CL.uid();
        await CL.dialog({
          title: k ? 'Змінити ключ' : 'Новий API-ключ',
          wide: true,
          html: '<div class="field"><label for="' + nameId + '">' + esc(t('Назва')) + '</label><input class="input" id="' + nameId + '" maxlength="80" placeholder="' + esc(t('напр. Cursor на ноутбуці')) + '" value="' + esc(k ? k.name : '') + '"></div>' +
            '<div class="field" style="margin-top:14px"><label>' + esc(t('Моделі, які можна цьому ключу')) + '</label>' +
              '<div class="row nw"><input class="input grow" data-q type="search" placeholder="' + esc(t('Пошук моделі…')) + '"><span class="chip accent" data-count></span></div>' +
              '<div class="kd-list">' + listHtml + '</div>' +
              '<div class="hint" style="margin-top:6px">' + esc(t('Програма з цим ключем бачитиме в списку моделей лише обрані й не зможе попросити іншу.')) + '</div></div>' +
            '<details class="kd-lim"' + (k && (k.rpm || k.dailyRequests || k.expires || k.note) ? ' open' : '') + '><summary>' + esc(t('Обмеження (необов’язково)')) + '</summary>' +
              '<div class="cols-3" style="margin-top:10px">' +
                '<div class="field"><label for="' + nameId + 'r">' + esc(t('Запитів за хвилину')) + '</label><input class="input" id="' + nameId + 'r" type="number" min="0" max="100000" placeholder="' + esc(t('без ліміту')) + '" value="' + (k && k.rpm ? k.rpm : '') + '"></div>' +
                '<div class="field"><label for="' + nameId + 'd">' + esc(t('Запитів за день')) + '</label><input class="input" id="' + nameId + 'd" type="number" min="0" max="10000000" placeholder="' + esc(t('без ліміту')) + '" value="' + (k && k.dailyRequests ? k.dailyRequests : '') + '"></div>' +
                '<div class="field"><label for="' + nameId + 'e">' + esc(t('Діє до')) + '</label><input class="input" id="' + nameId + 'e" type="date" value="' + (k && k.expires ? isoDay(k.expires) : '') + '"></div>' +
              '</div>' +
              '<div class="field" style="margin-top:10px"><label for="' + nameId + 'n">' + esc(t('Примітка')) + '</label><input class="input" id="' + nameId + 'n" maxlength="500" placeholder="' + esc(t('напр. для Олега, до кінця місяця')) + '" value="' + esc((k && k.note) || '') + '"></div>' +
              '<div class="hint" style="margin-top:6px">' + esc(t('Понад ліміт програма отримає помилку 429 з часом, коли можна знову. Після дати ключ перестане працювати.')) + '</div>' +
            '</details>' +
            '<div class="kd-err" data-err aria-live="polite"></div>',
          actions: [
            { label: 'Скасувати', value: null },
            {
              label: k ? 'Зберегти' : 'Створити ключ', kind: 'primary',
              onClick: async (dlg, close) => {
                const err = dlg.querySelector('[data-err]');
                const name = dlg.querySelector('#' + nameId).value.trim();
                const models = Array.from(dlg.querySelectorAll('.kd-items input:checked')).map((x) => x.value);
                if (!name) { err.textContent = t('Вкажи назву'); dlg.querySelector('#' + nameId).focus(); return false; }
                if (!models.length) { err.textContent = t('Обери хоча б одну модель'); return false; }
                const num = (sfx) => Math.max(0, Math.floor(Number(dlg.querySelector('#' + nameId + sfx).value) || 0));
                const day = dlg.querySelector('#' + nameId + 'e').value;
                // A key is valid through the whole chosen day (local time).
                const expires = day ? new Date(day + 'T23:59:59').getTime() : 0;
                if (expires && expires < Date.now()) { err.textContent = t('Дата вже минула'); return false; }
                const extra = { rpm: num('r'), dailyRequests: num('d'), expires, note: dlg.querySelector('#' + nameId + 'n').value.trim() };
                const btn = dlg.querySelector('.dlg-actions .btn.primary');
                let res;
                try {
                  btn.classList.add('busy');
                  btn.disabled = true;
                  res = k ? await CL.api.put('/scoped-keys/' + encodeURIComponent(k.id), Object.assign({ name, models }, extra))
                    : await CL.api.post('/scoped-keys', Object.assign({ name, models }, extra));
                } catch (er) {
                  err.textContent = t('Не вдалось зберегти: {e}', { e: er.message });
                  return false;
                } finally {
                  btn.classList.remove('busy');
                  btn.disabled = false;
                }
                close(true);
                await load();
                if (k) CL.toast('Збережено ✓');
                else if (res && res.key) showKey(res.key, 'Ключ створено ✓');
                return false;
              },
            },
          ],
          onMount: (dlg) => {
            const q = dlg.querySelector('[data-q]');
            const count = () => { dlg.querySelector('[data-count]').textContent = t('Обрано: {n}', { n: dlg.querySelectorAll('.kd-items input:checked').length }); };
            const allLabel = (g) => {
              const b = g.querySelector('[data-all]');
              if (!b) return;
              const vis = Array.from(g.querySelectorAll('.check')).filter((c) => !c.classList.contains('hidden'));
              b.textContent = t(vis.length && vis.every((c) => c.querySelector('input').checked) ? 'Зняти всі' : 'Обрати всі');
            };
            const filter = () => {
              const s = q.value.trim().toLowerCase();
              dlg.querySelectorAll('.kd-g').forEach((g) => {
                let any = false;
                g.querySelectorAll('.check').forEach((c) => { const hit = !s || c.dataset.m.indexOf(s) >= 0; c.classList.toggle('hidden', !hit); any = any || hit; });
                g.classList.toggle('hidden', !any);
                allLabel(g);
              });
            };
            q.addEventListener('input', filter);
            q.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
            dlg.addEventListener('change', (e) => { if (e.target.matches('.kd-items input')) { count(); allLabel(e.target.closest('.kd-g')); dlg.querySelector('[data-err]').textContent = ''; } });
            dlg.addEventListener('click', (e) => {
              const b = e.target.closest('[data-all]');
              if (!b) return;
              const g = b.closest('.kd-g');
              const boxes = Array.from(g.querySelectorAll('.check')).filter((c) => !c.classList.contains('hidden')).map((c) => c.querySelector('input'));
              const val = !boxes.every((x) => x.checked);
              boxes.forEach((x) => { x.checked = val; });
              count();
              allLabel(g);
            });
            count();
            dlg.querySelectorAll('.kd-g').forEach(allLabel);
          },
        });
      }

      // The full key with everything an app needs, right after create / rotate.
      function showKey(key, title) {
        const base = (ep && (ep.base || ep.anthropic)) || '';
        const row = (label, value, id) => '<div class="field"><label for="' + id + '">' + esc(t(label)) + '</label><div class="input-group"><input class="input mono" id="' + id + '" readonly value="' + esc(value) + '"><button class="btn icon" data-copy="' + esc(value) + '" data-tip="Копіювати">' + ic('copy', 'sm') + '</button></div></div>';
        const u = CL.uid();
        CL.dialog({
          title,
          html: '<div class="dlg-text">' + esc(t('Встав ці значення в налаштування програми «{name}». Ключ завжди можна скопіювати знову зі списку.', { name: key.name })) + '</div>' +
            '<div class="stack" style="gap:10px">' + row('Адреса', base, 'sa' + u) + row('Адреса для OpenAI-сумісних програм', (ep && ep.openai) || (base ? base + '/v1' : ''), 'so' + u) + row('API-ключ', key.key, 'sk' + u) + '</div>',
          actions: [{ label: 'Готово', kind: 'primary', value: true }],
        });
      }

      // -------------------------------------------------------------- load --
      await load();
      loadCatalog();
      ctx.every(20000, load);
      const soon = CL.debounce(load, 1500);
      ctx.on('live', (ev) => { if (ev && ev.type === 'request' && ev.key) soon(); });
      ctx.on('changed', (w) => {
        if (w === 'config') load();
        if (w === 'accounts' || w === 'engine') { CL.models.invalidate(); loadCatalog(true); }
      });
    },
  });
})();
