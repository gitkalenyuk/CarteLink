'use strict';
// Провайдери: OpenAI-compatible APIs (engine Management API), presets, the
// engine's native API keys, and accounts turned into providers (config.json).

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  const NL = String.fromCharCode(10);
  const NATIVE = [
    ['claude-api-key', 'Claude'], ['gemini-api-key', 'Gemini'], ['codex-api-key', 'Codex'], ['xai-api-key', 'xAI'], ['meta-api-key', 'Meta'],
  ];

  const STYLE = '<style>' +
    '.pv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;max-height:460px;overflow:auto;padding:2px}' +
    '.pv-card{display:flex;align-items:center;gap:10px;min-width:0;padding:9px 10px;border-radius:var(--radius-sm);border:var(--border-w) solid var(--line);background:var(--surface-2);color:var(--text);cursor:pointer;text-align:start;transition:border-color var(--dur),background var(--dur),transform calc(120ms * var(--t)) var(--ease)}' +
    '.pv-card:hover{border-color:var(--line-strong);background:var(--surface-3)}' +
    '.pv-card:active{transform:scale(.985)}' +
    '.pv-card .avatar{width:28px;height:28px;border-radius:8px;font-size:11px}' +
    '.pv-card.have .avatar{background:var(--accent-soft);color:var(--accent)}' +
    '.pv-card .grow b{display:block;font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pv-card .grow span{display:block;color:var(--text-3);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono)}' +
    '.pv-card .have-mark{color:var(--ok)}' +
    '.pv-tabs{overflow-x:auto;max-width:100%}' +
    '.pv-search{position:relative;min-width:200px;flex:1;max-width:340px}' +
    '.pv-search .i{position:absolute;inset-inline-start:10px;top:9px;color:var(--text-3)}' +
    '.pv-search .input{padding-inline-start:32px}' +
    '.pv-row .tags{margin-top:6px}' +
    '.pv-row .tag{height:22px;font-size:11.5px;font-family:var(--font-mono)}' +
    '.pv-row.off{opacity:.62}' +
    '.pv-row .grow > .row{gap:6px}' +
    '.pv-msg{min-height:18px}' +
    '.pv-msg.ok{color:var(--ok)}.pv-msg.bad{color:var(--bad)}' +
    '.pv-form details > summary{cursor:pointer;color:var(--text-2);font-size:12.5px;font-weight:600;padding:4px 0;list-style-position:inside}' +
    '</style>';

  CL.page('providers', {
    title: 'Провайдери', icon: 'globe', group: 'manage', order: 70,

    async render(root, ctx) {
      root.innerHTML = STYLE +
        '<div class="blocks" data-area="providers">' +
        '<section class="block card" data-block="compat" data-w="12" data-title="OpenAI-сумісні провайдери">' +
          '<div class="card-h"><div class="card-icon">' + ic('globe') + '</div><h2>' + esc(t('OpenAI-сумісні провайдери')) + '</h2><span class="sub" id="pvCount"></span><span class="grow"></span>' +
            '<button class="btn sm ghost" id="pvReload" data-tip="Оновити">' + ic('rotate', 'sm') + '</button>' +
            '<button class="btn sm primary" id="pvAdd">' + ic('plus', 'sm') + esc(t('Додати провайдера')) + '</button></div>' +
          '<p class="hint" style="margin-top:-6px">' + esc(t('Будь-який сервіс з API у форматі OpenAI: хмарні API, роутери на кшталт OpenRouter, локальні Ollama чи LM Studio. Їхні моделі з’являться в усіх списках CarteLink.')) + '</p>' +
          '<div id="pvList">' + CL.ui.skeleton(3) + '</div>' +
        '</section>' +
        '<section class="block card" data-block="presets" data-w="12" data-title="Готові пресети">' +
          '<div class="card-h"><div class="card-icon">' + ic('list') + '</div><h2>' + esc(t('Готові пресети')) + '</h2><span class="sub" id="pvPresetCount"></span><span class="grow"></span>' +
            '<label class="pv-search">' + ic('search', 'sm') + '<input class="input" id="pvSearch" type="search" placeholder="' + esc(t('Назва, адреса або модель…')) + '" aria-label="' + esc(t('Пошук пресета')) + '"></label></div>' +
          '<div class="pv-tabs" style="margin-bottom:12px">' + CL.ui.seg('pvGroups', [['all', 'Усі']].concat(Object.entries(window.PRESET_GROUPS || {})), 'all') + '</div>' +
          '<div class="pv-grid" id="pvGrid"></div>' +
          '<p class="hint" style="margin-top:10px">' + ic('check', 'sm') + ' ' + esc(t('— такий провайдер уже додано. Натисни пресет, щоб відкрити форму з готовою адресою та моделями — лишиться вставити ключ.')) + '</p>' +
        '</section>' +
        '<section class="block card" data-block="native" data-w="6" data-title="Рідні API-ключі">' +
          '<div class="card-h"><div class="card-icon">' + ic('key') + '</div><h2>' + esc(t('Рідні API-ключі')) + '</h2></div>' +
          '<p class="hint" style="margin-top:-6px">' + esc(t('Офіційні ключі Claude, Gemini, Codex, xAI чи Meta — рушій говорить з ними їхнім власним форматом, без OpenAI-шару.')) + '</p>' +
          '<div style="margin:10px 0 6px">' + CL.ui.seg('pvNative', NATIVE, NATIVE[0][0]) + '</div>' +
          '<div id="pvNativeList">' + CL.ui.skeleton(2) + '</div>' +
          '<div class="stack" style="gap:8px;margin-top:12px">' +
            '<div class="field"><label for="pvNKey">' + esc(t('Новий ключ')) + '</label><input class="input mono" id="pvNKey" type="password" autocomplete="off" placeholder="sk-…"></div>' +
            '<div class="field"><label for="pvNUrl">' + esc(t('Base URL (необов’язково)')) + '</label><input class="input mono" id="pvNUrl" placeholder="' + esc(t('порожньо — офіційна адреса')) + '"></div>' +
            '<div class="row"><button class="btn primary sm" id="pvNAdd">' + ic('plus', 'sm') + '<span id="pvNAddLabel"></span></button><span class="hint pv-msg" id="pvNMsg"></span></div>' +
          '</div>' +
        '</section>' +
        '<section class="block card" data-block="accprov" data-w="6" data-title="Акаунти як провайдери">' +
          '<div class="card-h"><div class="card-icon">' + ic('users') + '</div><h2>' + esc(t('Акаунти як провайдери')) + '</h2><span class="sub" id="pvAccCount"></span></div>' +
          '<p class="hint" style="margin-top:-6px">' + esc(t('Кожен робочий акаунт CarteLink сам додає сюди як джерело моделей. Вимкни, щоб тимчасово не використовувати, або прибери зовсім.')) + '</p>' +
          '<div id="pvAcc">' + CL.ui.skeleton(3) + '</div>' +
        '</section>' +
        '</div>';

      let compat = [];
      let group = 'all';
      let nativeKind = NATIVE[0][0];

      // ------------------------------------------------ OpenAI-compatible --

      async function fetchCompat() {
        const r = await CL.mgmt('GET', 'openai-compatibility');
        return Array.isArray(r) ? r : (r && (r['openai-compatibility'] || r.items)) || [];
      }

      async function loadCompat() {
        const box = root.querySelector('#pvList');
        try {
          compat = await fetchCompat();
        } catch (e) {
          if (!ctx.alive()) return;
          box.innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Рушій не відповідає: {e}. Перевір, чи шлюз запущено (Огляд → Шлюз).', { e: e.message })) + '</div></div>';
          return;
        }
        if (!ctx.alive()) return;
        paintCompat();
        paintPresets();
      }

      function paintCompat() {
        const box = root.querySelector('#pvList');
        root.querySelector('#pvCount').textContent = compat.length ? t('{n} шт.', { n: compat.length }) : '';
        if (!compat.length) {
          box.innerHTML = CL.ui.empty('globe', 'Провайдерів ще немає', 'Обери готовий пресет нижче або додай свій — знадобиться лише адреса API та ключ.',
            '<button class="btn primary sm" data-act="add">' + ic('plus', 'sm') + esc(t('Додати провайдера')) + '</button>');
          return;
        }
        box.innerHTML = '<div class="list">' + compat.map((p, i) => {
          const preset = presetByUrl(p['base-url']);
          const models = (p.models || []).map((m) => m.alias || m.name).filter(Boolean);
          const keys = (p['api-key-entries'] || []).length;
          const off = !!p.disabled;
          return '<div class="li pv-row' + (off ? ' off' : '') + '" style="align-items:flex-start">' +
            '<span class="avatar">' + esc(String(p.name || '?').charAt(0)) + '</span>' +
            '<div class="grow">' +
              '<div class="row"><b style="display:inline">' + esc(p.name) + '</b><span class="chip outline">' + esc(preset ? preset.label : 'OpenAI') + '</span>' +
                (p.prefix ? '<span class="chip info mono" data-tip="' + esc(t('Моделі цього провайдера доступні також як {p}/назва', { p: p.prefix })) + '">' + esc(p.prefix) + '/</span>' : '') +
                '<span class="chip ' + (off ? '' : 'ok') + '">' + esc(t(off ? 'вимкнено' : 'активний')) + '</span></div>' +
              '<span class="mono">' + esc(p['base-url'] || '') + ' · ' + esc(t('{n} моделей', { n: models.length })) + ' · ' + esc(t('{n} ключ(ів)', { n: keys })) + '</span>' +
              (models.length ? '<div class="tags">' + models.slice(0, 5).map((m) => '<span class="tag">' + esc(m) + '</span>').join('') + (models.length > 5 ? '<span class="tag">' + esc(t('+ще {n}', { n: models.length - 5 })) + '</span>' : '') + '</div>' : '') +
            '</div>' +
            '<div class="row nw">' +
              '<span data-tip="' + esc(t(off ? 'Увімкнути' : 'Вимкнути')) + '">' + CL.ui.switch('pvOn' + i, !off) + '</span>' +
              '<button class="btn sm" data-act="edit" data-i="' + i + '">' + ic('edit', 'sm') + esc(t('Змінити')) + '</button>' +
              '<button class="btn sm icon danger" data-act="del" data-i="' + i + '" data-tip="' + esc(t('Видалити провайдера')) + '" aria-label="' + esc(t('Видалити провайдера')) + '">' + ic('trash', 'sm') + '</button>' +
            '</div></div>';
        }).join('') + '</div>';
        compat.forEach((p, i) => {
          const sw = box.querySelector('#pvOn' + i);
          sw.addEventListener('change', async () => {
            sw.disabled = true;
            try {
              await CL.mgmt('PATCH', 'openai-compatibility', { name: p.name, value: { disabled: !sw.checked } });
              CL.toast(sw.checked ? t('Провайдера {name} увімкнено ✓', { name: p.name }) : t('Провайдера {name} вимкнено', { name: p.name }));
              CL.models.invalidate();
              await loadCompat();
            } catch (e) { sw.checked = !sw.checked; CL.fail(e); }
            finally { sw.disabled = false; }
          });
        });
      }

      root.querySelector('#pvList').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const p = compat[Number(b.dataset.i)];
        if (b.dataset.act === 'add') openForm(null, null);
        else if (b.dataset.act === 'edit' && p) openForm(p, null);
        else if (b.dataset.act === 'del' && p) {
          if (!(await CL.confirm(t('Видалити провайдера {name}? Його моделі зникнуть зі списків, а програми, що їх використовують, отримають помилку.', { name: p.name }), { danger: true }))) return;
          CL.ui.busy(b, async () => {
            await CL.mgmt('DELETE', 'openai-compatibility?name=' + encodeURIComponent(p.name));
            CL.toast(t('Провайдера {name} видалено', { name: p.name }));
            CL.models.invalidate();
            await loadCompat();
          });
        }
      });
      root.querySelector('#pvAdd').addEventListener('click', () => openForm(null, null));
      root.querySelector('#pvReload').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => { await Promise.all([loadCompat(), loadNative(), loadAcc()]); }));

      // ----------------------------------------------------------- presets --

      const presets = () => window.PROVIDER_PRESETS || [];
      const normUrl = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
      function presetByUrl(u) {
        const n = normUrl(u);
        return n ? presets().find((x) => x.id !== 'custom' && normUrl(x.url) === n) : null;
      }

      function paintPresets() {
        const q = root.querySelector('#pvSearch').value.trim().toLowerCase();
        const have = new Set(compat.map((p) => normUrl(p['base-url'])));
        const list = presets().filter((p) => (group === 'all' || p.group === group) &&
          (!q || [p.label, p.id, p.url].concat(p.models || []).some((s) => String(s || '').toLowerCase().includes(q))));
        root.querySelector('#pvPresetCount').textContent = t('{n} із {m}', { n: list.length, m: presets().length });
        const grid = root.querySelector('#pvGrid');
        grid.innerHTML = list.length ? list.map((p) => {
          const on = have.has(normUrl(p.url));
          return '<button type="button" class="pv-card' + (on ? ' have' : '') + '" data-preset="' + esc(p.id) + '" title="' + esc(p.url) + '">' +
            '<span class="avatar">' + esc(String(t(p.label)).charAt(0)) + '</span>' +
            '<span class="grow"><b>' + esc(t(p.label)) + '</b><span>' + esc(p.url.replace(/^https?:\/\//, '')) + '</span></span>' +
            (on ? '<span class="have-mark" data-tip="' + esc(t('Уже додано')) + '">' + ic('check', 'sm') + '</span>' : '') + '</button>';
        }).join('') : '<div style="grid-column:1/-1">' + CL.ui.empty('search', 'Нічого не знайдено', 'Спробуй іншу назву або обери «Свій» і заповни поля вручну.') + '</div>';
      }
      root.querySelector('#pvSearch').addEventListener('input', CL.debounce(paintPresets, 120));
      CL.ui.onSeg(root.querySelector('#pvGroups'), (v) => { group = v; paintPresets(); });
      root.querySelector('#pvGrid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-preset]');
        if (!b) return;
        const p = presets().find((x) => x.id === b.dataset.preset);
        if (p) openForm(null, p);
      });
      paintPresets();

      // ------------------------------------------------- add / edit dialog --

      function presetHint(p, full) {
        let h = '<div class="banner info" style="margin-bottom:14px">' + ic('info') + '<div class="grow"><b>' + esc(t(p.label)) + '</b>' +
          (full && p.hint ? ' — ' + esc(t(p.hint)) : '') +
          (p.keyUrl ? ' <a href="' + esc(p.keyUrl) + '" target="_blank" rel="noopener">' + esc(t('Отримати ключ')) + ' ' + ic('external', 'sm') + '</a>' : '');
        if (full && /<[A-Z_]+>/.test(p.url)) h += '<div style="margin-top:6px;color:var(--warn)">' + ic('alert', 'sm') + ' ' + esc(t('Заміни частину в кутових дужках <…> у Base URL на своє значення.')) + '</div>';
        return h + '</div></div>';
      }

      function parseModels(raw) {
        return String(raw || '').split(NL).map((l) => l.trim()).filter(Boolean).map((l) => {
          const i = l.indexOf('=');
          return i > 0 ? { name: l.slice(0, i).trim(), alias: l.slice(i + 1).trim() || l.slice(0, i).trim() } : { name: l, alias: l };
        });
      }
      function parseHeaders(raw) {
        const out = {};
        String(raw || '').split(NL).forEach((l) => {
          const i = l.indexOf(':');
          if (i > 0) { const k = l.slice(0, i).trim(); if (k) out[k] = l.slice(i + 1).trim(); }
        });
        return out;
      }
      const parseKeys = (raw) => String(raw || '').split(NL).map((l) => l.trim()).filter(Boolean);

      async function openForm(edit, preset) {
        // Fresh list so the unique-name check and "have" marks are current.
        try { compat = await fetchCompat(); } catch (e) { /* use what we have */ }
        let name = '';
        let url = '';
        let keys = '';
        let prefix = '';
        let models = '';
        let headers = '';
        let hint = '';
        if (edit) {
          name = edit.name || '';
          url = edit['base-url'] || '';
          keys = (edit['api-key-entries'] || []).map((k) => k['api-key'] || '').filter(Boolean).join(NL);
          prefix = edit.prefix || '';
          models = (edit.models || []).map((m) => (m.alias && m.alias !== m.name ? m.name + '=' + m.alias : m.name)).join(NL);
          headers = Object.entries(edit.headers || {}).map(([k, v]) => k + ': ' + v).join(NL);
          const pr = presetByUrl(url);
          if (pr && pr.keyUrl) hint = presetHint(pr, false);
        } else if (preset) {
          name = preset.id === 'custom' ? '' : preset.id;
          if (name && compat.some((x) => x.name === name)) {
            let n = 2;
            while (compat.some((x) => x.name === name + '-' + n)) n++;
            name = name + '-' + n;
          }
          url = preset.url || '';
          models = (preset.models || []).join(NL);
          hint = presetHint(preset, true);
        }
        const more = !!(prefix || headers);
        const html = '<div class="pv-form">' + hint +
          '<div class="cols-2">' +
            '<div class="stack" style="gap:12px">' +
              '<div class="field"><label for="pfName">' + esc(t('Назва')) + '</label><input class="input mono" id="pfName" value="' + esc(name) + '" placeholder="my-provider" autocomplete="off"><span class="hint">' + esc(t('Латиниця, цифри, крапка, _ або -. Так провайдер зветься в рушії.')) + '</span></div>' +
              '<div class="field"><label for="pfUrl">Base URL</label><input class="input mono" id="pfUrl" value="' + esc(url) + '" placeholder="https://api.example.com/v1"><span class="hint">' + esc(t('Адреса до /chat/completions, зазвичай закінчується на /v1.')) + '</span></div>' +
              '<div class="field"><label for="pfKeys">' + esc(t('API-ключі')) + '</label><textarea class="textarea" id="pfKeys" rows="3" style="min-height:74px" placeholder="sk-…" spellcheck="false">' + esc(keys) + '</textarea><span class="hint">' + esc(t('По одному в рядку — кілька ключів чергуються. Локальним серверам підійде будь-який, наприклад local.')) + '</span></div>' +
              '<details' + (more ? ' open' : '') + '><summary>' + esc(t('Додатково: префікс і заголовки')) + '</summary><div class="stack" style="gap:12px;margin-top:10px">' +
                '<div class="field"><label for="pfPrefix">' + esc(t('Префікс (необов’язково)')) + '</label><input class="input mono" id="pfPrefix" value="' + esc(prefix) + '" placeholder="or"><span class="hint">' + esc(t('Моделі будуть доступні й як префікс/назва — зручно, коли в двох провайдерів однакові назви.')) + '</span></div>' +
                '<div class="field"><label for="pfHeaders">' + esc(t('Заголовки HTTP')) + '</label><textarea class="textarea" id="pfHeaders" rows="3" style="min-height:64px" placeholder="X-Title: CarteLink" spellcheck="false">' + esc(headers) + '</textarea><span class="hint">' + esc(t('Формат: Назва: значення, по одному в рядку.')) + '</span></div>' +
              '</div></details>' +
            '</div>' +
            '<div class="stack" style="gap:8px">' +
              '<div class="field"><div class="row"><label for="pfModels" class="label grow">' + esc(t('Моделі')) + ' <span class="faint" id="pfModelsN"></span></label>' +
                '<button type="button" class="btn sm" id="pfFetch">' + ic('download', 'sm') + esc(t('Підтягнути список моделей')) + '</button></div>' +
                '<textarea class="textarea" id="pfModels" rows="12" style="min-height:250px" placeholder="gpt-5.5' + NL + 'llama-4=llama" spellcheck="false">' + esc(models) + '</textarea>' +
                '<span class="hint">' + esc(t('По одній у рядку. Щоб програми бачили іншу назву, напиши назва=псевдонім.')) + '</span></div>' +
              '<div class="hint pv-msg" id="pfFetchMsg" aria-live="polite"></div>' +
            '</div>' +
          '</div>' +
          '<div class="banner bad hidden" id="pfErr" style="margin:14px 0 0">' + ic('alert') + '<div id="pfErrText"></div></div>' +
          '</div>';

        await CL.dialog({
          title: edit ? t('Змінити провайдера {name}', { name: edit.name }) : preset && preset.id !== 'custom' ? t('Додати: {name}', { name: t(preset.label) }) : 'Новий провайдер',
          wide: true,
          sticky: true,
          html,
          actions: [
            { label: 'Скасувати', value: null },
            { label: edit ? 'Зберегти зміни' : 'Додати провайдера', kind: 'primary', onClick: (d) => save(d, edit) },
          ],
          onMount: (d) => {
            const mN = () => { const n = parseModels(d.querySelector('#pfModels').value).length; d.querySelector('#pfModelsN').textContent = n ? '· ' + n : ''; };
            d.querySelector('#pfModels').addEventListener('input', mN);
            mN();
            d.querySelector('#pfUrl').addEventListener('blur', (e) => { e.target.value = e.target.value.trim().replace(/\/+$/, ''); });
            d.querySelector('#pfFetch').addEventListener('click', (e) => fetchModels(d, e.currentTarget, mN));
            if (preset) setTimeout(() => d.querySelector(name ? '#pfKeys' : '#pfName').focus(), 60);
            d.addEventListener('keydown', (e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); d.querySelector('.dlg-actions .btn.primary').click(); }
            });
          },
        });
      }

      function readForm(d) {
        return {
          name: d.querySelector('#pfName').value.trim(),
          baseUrl: d.querySelector('#pfUrl').value.trim().replace(/\/+$/, ''),
          keys: parseKeys(d.querySelector('#pfKeys').value),
          prefix: d.querySelector('#pfPrefix').value.trim(),
          models: parseModels(d.querySelector('#pfModels').value),
          headers: parseHeaders(d.querySelector('#pfHeaders').value),
        };
      }

      function validate(f) {
        if (!f.name) return ['#pfName', t('Вкажи назву провайдера.')];
        if (!/^[A-Za-z0-9._-]+$/.test(f.name)) return ['#pfName', t('Назва: лише латиниця, цифри, крапка, _ або -.')];
        if (!/^https?:\/\//i.test(f.baseUrl)) return ['#pfUrl', t('Base URL має починатися з http:// або https://.')];
        if (/<[A-Z_]+>/.test(f.baseUrl)) return ['#pfUrl', t('Заміни частину в кутових дужках <…> у Base URL на своє значення.')];
        if (!f.keys.length) return ['#pfKeys', t('Потрібен хоча б один API-ключ. Для локальних серверів підійде будь-який, наприклад local.')];
        if (!f.models.length) return ['#pfModels', t('Додай хоча б одну модель або натисни «Підтягнути список моделей».')];
        return null;
      }

      function compatForWrite(p) {
        const out = {};
        Object.keys(p).forEach((k) => { if (k !== 'auth-index') out[k] = p[k]; });
        if (Array.isArray(out['api-key-entries'])) {
          out['api-key-entries'] = out['api-key-entries'].map((e) => { const c = {}; Object.keys(e).forEach((k) => { if (k !== 'auth-index') c[k] = e[k]; }); return c; });
        }
        return out;
      }

      function toEntry(f, prev) {
        const entry = prev ? compatForWrite(prev) : {};
        entry.name = f.name;
        entry['base-url'] = f.baseUrl;
        entry['api-key-entries'] = f.keys.map((k) => {
          const old = prev && (prev['api-key-entries'] || []).find((e) => e['api-key'] === k);
          const e = { 'api-key': k };
          if (old && old['proxy-url']) e['proxy-url'] = old['proxy-url'];
          if (old && old.weight != null) e.weight = old.weight;
          return e;
        });
        entry.models = f.models;
        if (f.prefix) entry.prefix = f.prefix; else delete entry.prefix;
        if (Object.keys(f.headers).length) entry.headers = f.headers; else delete entry.headers;
        return entry;
      }

      async function save(d, edit) {
        const err = (sel, text) => {
          d.querySelector('#pfErrText').textContent = text;
          d.querySelector('#pfErr').classList.remove('hidden');
          if (sel) { const el = d.querySelector(sel); const det = el.closest('details'); if (det) det.open = true; el.focus(); }
          return false;
        };
        d.querySelector('#pfErr').classList.add('hidden');
        const f = readForm(d);
        const bad = validate(f);
        if (bad) return err(bad[0], bad[1]);
        const btn = d.querySelector('.dlg-actions .btn.primary');
        btn.classList.add('busy');
        btn.disabled = true;
        try {
          const list = await fetchCompat();
          if (edit) {
            const prev = list.find((x) => x.name === edit.name);
            if (!prev) return err(null, t('Провайдера {name} уже немає в рушії — можливо, його видалили в іншому вікні. Закрий форму й додай його знову.', { name: edit.name }));
            if (f.name !== edit.name && list.some((x) => x.name === f.name)) return err('#pfName', t('Назва {name} уже зайнята — обери іншу.', { name: f.name }));
            const v = toEntry(f, prev);
            await CL.mgmt('PATCH', 'openai-compatibility', { name: edit.name, value: {
              name: v.name, 'base-url': v['base-url'], 'api-key-entries': v['api-key-entries'], models: v.models, prefix: f.prefix, headers: f.headers,
            } });
            CL.toast(t('Провайдера {name} оновлено ✓', { name: f.name }));
          } else {
            if (list.some((x) => x.name === f.name)) return err('#pfName', t('Назва {name} уже зайнята — обери іншу або зміни наявного провайдера.', { name: f.name }));
            const next = list.map(compatForWrite);
            next.push(toEntry(f, null));
            await CL.mgmt('PUT', 'openai-compatibility', next);
            CL.toast(t('Провайдера {name} додано ✓ ({n} моделей)', { name: f.name, n: f.models.length }));
          }
        } catch (e) {
          return err(null, t('Не вдалось зберегти: {e}', { e: e.message }));
        } finally {
          btn.classList.remove('busy');
          btn.disabled = false;
        }
        CL.models.invalidate();
        loadCompat();
        return true;
      }

      async function fetchModels(d, btn, after) {
        const f = readForm(d);
        const out = d.querySelector('#pfFetchMsg');
        const say = (text, kind) => { out.textContent = text; out.className = 'hint pv-msg ' + (kind || ''); };
        if (!/^https?:\/\//i.test(f.baseUrl)) { say(t('Спочатку вкажи Base URL.'), 'bad'); d.querySelector('#pfUrl').focus(); return; }
        say(t('Запитую {url} …', { url: f.baseUrl + '/models' }));
        btn.classList.add('busy');
        btn.disabled = true;
        try {
          const r = await CL.api.post('/provider-models', { baseUrl: f.baseUrl, apiKey: f.keys[0] || '', headers: f.headers });
          const ids = (r && r.models) || [];
          if (!ids.length) { say(t('Провайдер повернув порожній список. Впиши моделі вручну.'), 'bad'); return; }
          const alias = {};
          f.models.forEach((m) => { if (m.alias && m.alias !== m.name) alias[m.name] = m.alias; });
          d.querySelector('#pfModels').value = ids.map((m) => (alias[m] ? m + '=' + alias[m] : m)).join(NL);
          after();
          say(t('Отримано {n} моделей ✓ Зайві можна просто видалити.', { n: ids.length }), 'ok');
        } catch (e) {
          say(t('Не вдалось отримати список: {e}. Перевір адресу й ключ.', { e: e.message }), 'bad');
        } finally {
          btn.classList.remove('busy');
          btn.disabled = false;
        }
      }

      // -------------------------------------------------------- native keys --

      const nativeLabel = () => (NATIVE.find((x) => x[0] === nativeKind) || NATIVE[0])[1];
      async function fetchNative(kind) {
        const r = await CL.mgmt('GET', kind);
        return Array.isArray(r) ? r : (r && (r[kind] || r.items)) || [];
      }
      const nativeForWrite = (e) => { const o = {}; Object.keys(e).forEach((k) => { if (k !== 'auth-index') o[k] = e[k]; }); return o; };
      const maskKey = (k) => { k = String(k || ''); return k.length > 8 ? k.slice(0, 6) + '…' + k.slice(-4) : '•••'; };
      let nativeList = [];

      async function loadNative() {
        const kind = nativeKind;
        const box = root.querySelector('#pvNativeList');
        root.querySelector('#pvNAddLabel').textContent = t('Додати ключ {name}', { name: nativeLabel() });
        try {
          const arr = await fetchNative(kind);
          if (!ctx.alive() || kind !== nativeKind) return;
          nativeList = arr;
        } catch (e) {
          if (!ctx.alive()) return;
          box.innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Не вдалось прочитати ключі: {e}', { e: e.message })) + '</div></div>';
          return;
        }
        box.innerHTML = nativeList.length ? '<div class="list">' + nativeList.map((k, i) =>
          '<div class="li"><span class="avatar">' + ic('key', 'sm') + '</span><div class="grow"><b class="mono">' + esc(maskKey(k['api-key'])) + '</b><span class="mono">' + esc(k['base-url'] || t('офіційна адреса')) + '</span></div>' +
          '<button class="btn sm icon danger" data-ndel="' + i + '" data-tip="' + esc(t('Видалити ключ')) + '" aria-label="' + esc(t('Видалити ключ')) + '">' + ic('trash', 'sm') + '</button></div>').join('') + '</div>'
          : CL.ui.empty('key', t('{name}: ключів ще немає', { name: nativeLabel() }), 'Встав ключ нижче — моделі цього провайдера з’являться за кілька секунд.');
      }
      CL.ui.onSeg(root.querySelector('#pvNative'), (v) => {
        nativeKind = v;
        root.querySelector('#pvNMsg').textContent = '';
        root.querySelector('#pvNativeList').innerHTML = CL.ui.skeleton(2);
        loadNative();
      });
      root.querySelector('#pvNativeList').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-ndel]');
        if (!b) return;
        const target = nativeList[Number(b.dataset.ndel)];
        if (!target) return;
        const kind = nativeKind;
        if (!(await CL.confirm(t('Видалити цей ключ {name} ({key})?', { name: nativeLabel(), key: maskKey(target['api-key']) }), { danger: true }))) return;
        CL.ui.busy(b, async () => {
          const cur = await fetchNative(kind);
          const next = cur.filter((x) => x['api-key'] !== target['api-key']).map(nativeForWrite);
          if (next.length) await CL.mgmt('PUT', kind, next);
          else await CL.mgmt('DELETE', kind + '?api-key=' + encodeURIComponent(target['api-key']));
          CL.toast('Ключ видалено');
          CL.models.invalidate();
          await loadNative();
        });
      });
      const nMsg = (text, kind) => { const m = root.querySelector('#pvNMsg'); m.textContent = text; m.className = 'hint pv-msg ' + (kind || ''); };
      const addNative = (btn) => CL.ui.busy(btn, async () => {
        const keyEl = root.querySelector('#pvNKey');
        const urlEl = root.querySelector('#pvNUrl');
        const key = keyEl.value.trim();
        const url = urlEl.value.trim().replace(/\/+$/, '');
        if (!key) { nMsg(t('Встав ключ у поле вище.'), 'bad'); keyEl.focus(); return; }
        if (url && !/^https?:\/\//i.test(url)) { nMsg(t('Base URL має починатися з http:// або https://.'), 'bad'); urlEl.focus(); return; }
        const kind = nativeKind;
        const cur = await fetchNative(kind);
        if (cur.some((x) => x['api-key'] === key)) { nMsg(t('Такий ключ уже додано.'), 'bad'); return; }
        const entry = { 'api-key': key };
        if (url) entry['base-url'] = url;
        await CL.mgmt('PUT', kind, cur.map(nativeForWrite).concat([entry]));
        keyEl.value = '';
        urlEl.value = '';
        nMsg(t('Ключ {name} додано ✓', { name: nativeLabel() }), 'ok');
        CL.models.invalidate();
        await loadNative();
      });
      root.querySelector('#pvNAdd').addEventListener('click', (e) => addNative(e.currentTarget));
      ['#pvNKey', '#pvNUrl'].forEach((s) => root.querySelector(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') addNative(root.querySelector('#pvNAdd')); }));

      // ------------------------------------------------ account-providers --

      let accList = [];
      async function loadAcc() {
        const box = root.querySelector('#pvAcc');
        let cfg;
        try { cfg = await CL.config.get(); } catch (e) {
          if (ctx.alive()) box.innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Не вдалось прочитати налаштування: {e}', { e: e.message })) + '</div></div>';
          return;
        }
        if (!ctx.alive()) return;
        accList = cfg.providers || [];
        root.querySelector('#pvAccCount').textContent = accList.length ? t('{n} шт.', { n: accList.length }) : '';
        if (!accList.length) {
          box.innerHTML = CL.ui.empty('users', 'Тут порожньо', 'Щойно підключиш акаунт на сторінці «Акаунти», він з’явиться тут сам.', '<button class="btn sm" data-goto="accounts">' + esc(t('Акаунти')) + ic('arrow', 'sm') + '</button>');
          return;
        }
        box.innerHTML = '<div class="list">' + accList.map((p, i) => {
          const acc = String(p.baseUrl || '').startsWith('embedded://');
          const on = p.enabled !== false;
          const models = p.models || [];
          return '<div class="li pv-row' + (on ? '' : ' off') + '" style="align-items:flex-start"><span class="avatar">' + (acc ? ic('users', 'sm') : esc(String(p.label || p.id || '?').charAt(0))) + '</span>' +
            '<div class="grow"><div class="row"><b style="display:inline">' + esc(p.label || p.id) + '</b><span class="chip ' + (acc ? 'accent' : 'outline') + '">' + esc(t(acc ? 'акаунт' : 'OpenAI')) + '</span></div>' +
            '<span>' + esc(acc ? t('вбудований рушій (OAuth)') : p.baseUrl || '') + ' · ' + esc(t('{n} моделей', { n: models.length })) + '</span>' +
            (models.length ? '<div class="tags">' + models.slice(0, 4).map((m) => '<span class="tag">' + esc(m) + '</span>').join('') + (models.length > 4 ? '<span class="tag">' + esc(t('+ще {n}', { n: models.length - 4 })) + '</span>' : '') + '</div>' : '') + '</div>' +
            '<div class="row nw"><span data-tip="' + esc(t(on ? 'Вимкнути' : 'Увімкнути')) + '">' + CL.ui.switch('pvAccOn' + i, on) + '</span>' +
            '<button class="btn sm icon danger" data-adel="' + i + '" data-tip="' + esc(t('Прибрати')) + '" aria-label="' + esc(t('Прибрати')) + '">' + ic('trash', 'sm') + '</button></div></div>';
        }).join('') + '</div>';
        accList.forEach((p, i) => {
          const sw = box.querySelector('#pvAccOn' + i);
          sw.addEventListener('change', async () => {
            sw.disabled = true;
            try {
              const fresh = (await CL.config.get()).providers || [];
              if (!fresh.some((x) => x.id === p.id)) throw new Error(t('цього провайдера вже немає в налаштуваннях'));
              await CL.config.patch({ providers: fresh.map((x) => (x.id === p.id ? Object.assign({}, x, { enabled: sw.checked }) : x)) });
              CL.toast(sw.checked ? t('{name} увімкнено ✓', { name: p.label || p.id }) : t('{name} вимкнено', { name: p.label || p.id }));
              CL.models.invalidate();
            } catch (e) { sw.checked = !sw.checked; CL.fail(e); }
            finally { sw.disabled = false; }
            loadAcc();
          });
        });
      }
      root.querySelector('#pvAcc').addEventListener('click', async (e) => {
        const g = e.target.closest('[data-goto]');
        if (g) { CL.go(g.dataset.goto); return; }
        const b = e.target.closest('[data-adel]');
        if (!b) return;
        const p = accList[Number(b.dataset.adel)];
        if (!p) return;
        const acc = String(p.baseUrl || '').startsWith('embedded://');
        const text = acc
          ? t('Прибрати {name} зі списку провайдерів? Сам акаунт лишиться підключеним, але CarteLink більше не додаватиме його сюди автоматично.', { name: p.label || p.id })
          : t('Прибрати провайдера {name}?', { name: p.label || p.id });
        if (!(await CL.confirm(text, { danger: true, ok: 'Прибрати' }))) return;
        CL.ui.busy(b, async () => {
          if (acc) await CL.api.post('/account-provider/hide', { id: p.id });
          else {
            const fresh = (await CL.config.get()).providers || [];
            await CL.config.patch({ providers: fresh.filter((x) => x.id !== p.id) });
          }
          CL.toast(t('{name} прибрано', { name: p.label || p.id }));
          CL.models.invalidate();
          await loadAcc();
        });
      });

      await Promise.all([loadCompat(), loadNative(), loadAcc()]);
      ctx.on('changed', (w) => {
        if (w === 'config') loadAcc();
        if (w === 'engine') { loadCompat(); loadNative(); }
        if (w === 'accounts') loadAcc();
      });
    },
  });
})();
