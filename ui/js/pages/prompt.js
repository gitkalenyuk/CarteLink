'use strict';
// Системний промпт: the user's own instructions and AGENT.md injected into
// every request, plus reasoning ("thinking") settings for capable models.
// Save writes only the fields changed on this page (3-way, like Models).

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  const MD_MAX = 512 * 1024;
  const CLIENT_SAMPLE = 'Ти — Claude Code, офіційний CLI від Anthropic. Допомагай користувачеві з завданнями програмування: читай файли, запускай команди, пиши й виправляй код. Відповідай стисло.';

  const STYLE = '<style>' +
    '.pr-page .pr-text{min-height:240px}' +
    '.pr-page .pr-md{min-height:180px}' +
    '.pr-savebar{position:sticky;bottom:14px;z-index:6;margin-top:var(--gap);display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px 10px 16px;border-radius:var(--radius);background:var(--surface-3);border:var(--border-w) solid var(--line-strong);box-shadow:var(--shadow-pop);opacity:0;visibility:hidden;transform:translateY(14px);transition:opacity var(--dur) var(--ease),transform var(--dur) var(--ease),visibility 0s var(--dur)}' +
    '.pr-savebar.on{opacity:1;visibility:visible;transform:none;transition:opacity var(--dur) var(--ease),transform var(--dur) var(--ease)}' +
    '.pr-savebar .dot{background:var(--warn)}' +
    '.pr-prev{display:flex;flex-direction:column;gap:8px}' +
    '.pr-seg{border-radius:var(--radius-sm);border:var(--border-w) solid var(--line);background:var(--surface-2);padding:9px 11px;font-size:12.5px;line-height:1.5}' +
    '.pr-seg .pr-lab{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-3);margin-bottom:4px}' +
    '.pr-seg .pr-body{white-space:pre-wrap;word-break:break-word;max-height:190px;overflow:auto;color:var(--text-2)}' +
    '.pr-seg.mine{border-color:color-mix(in srgb,var(--accent) 45%,var(--line));background:var(--accent-soft)}' +
    '.pr-seg.mine .pr-body{color:var(--text)}' +
    '.pr-seg.mine .pr-lab{color:var(--accent)}' +
    '.pr-seg.gone{opacity:.55}' +
    '.pr-seg.gone .pr-body{text-decoration:line-through;text-decoration-color:var(--bad)}' +
    '.pr-caps .chip{height:auto;min-height:24px;padding:3px 9px;font-weight:500;white-space:normal}' +
    '.pr-caps .chip b{font-family:var(--font-mono);font-weight:600}' +
    '.pr-page .dropping{outline:2px dashed var(--accent);outline-offset:4px}' +
    '</style>';

  const opt = (v, label, cur) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + esc(t(label)) + '</option>';

  CL.page('prompt', {
    title: 'Системний промпт', icon: 'edit', group: 'manage', order: 90,
    badge: () => (CL.status && CL.status.prompting ? { text: t('увімк.'), kind: 'soft' } : null),

    async render(root, ctx) {
      root.classList.add('pr-page');
      root.innerHTML = STYLE + '<div class="blocks" data-area="prompt">' + CL.ui.skeleton(6) + '</div>';
      let cfg;
      try { cfg = await CL.config.get(); } catch (e) {
        root.innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Не вдалось прочитати налаштування: {e}. Перезапусти CarteLink, якщо це повторюється.', { e: e.message })) + '</div></div>';
        return;
      }
      if (!ctx.alive()) return;

      root.innerHTML = STYLE +
        '<div class="blocks" data-area="prompt">' +
        '<section class="block card" data-block="text" data-w="8" data-title="Текст промпту">' +
          '<div class="card-h"><div class="card-icon">' + ic('edit') + '</div><h2>' + esc(t('Текст промпту')) + '</h2><span class="sub">' + esc(t('діє одразу, без перезапуску')) + '</span><span class="grow"></span><span class="chip outline" id="prSize" hidden></span></div>' +
          '<div class="setting" style="padding-top:0"><div class="grow"><b>' + esc(t('Застосовувати системний промпт')) + '</b><span>' + esc(t('Поки вимкнено, запити йдуть без змін.')) + '</span></div>' + CL.ui.switch('prOn', false) + '</div>' +
          '<div class="field" style="margin-top:12px"><label for="prText" class="sr">' + esc(t('Текст промпту')) + '</label>' +
            '<textarea class="textarea prose pr-text" id="prText" spellcheck="true" placeholder="' + esc(t('Наприклад: Ти — інженер-помічник у проєкті X. Відповідай стисло, українською. Спершу план, потім код.')) + '"></textarea></div>' +
          '<div class="cols-2" style="margin-top:12px">' +
            '<div class="field"><label for="prMode">' + esc(t('Як поєднувати з промптом програми')) + '</label><select class="select" id="prMode">' +
              opt('prepend', 'Спочатку мій промпт, далі промпт програми') + opt('append', 'Спочатку промпт програми, далі мій') + opt('replace', 'Замінити промпт програми повністю') + '</select></div>' +
            '<div class="field"><label for="prScope">' + esc(t('До яких запитів застосовувати')) + '</label><select class="select" id="prScope">' +
              opt('all', 'До всіх') + opt('anthropic', 'Лише Anthropic (Claude Code)') + opt('openai', 'Лише OpenAI (Codex, Cursor…)') + '</select>' +
              '<span class="hint">' + esc(t('Anthropic — Claude Code і сумісні. OpenAI — Codex, Cursor, Cline та інші через /v1/chat/completions і /v1/responses.')) + '</span></div>' +
          '</div>' +
          '<div class="banner" id="prReplace" style="margin:12px 0 0" hidden>' + ic('alert') + '<div>' + esc(t('Режим «Замінити» прибирає інструкції програми — зокрема ті, що нав’язують моделі чужу роль, але й ті, що пояснюють їй інструменти програми. Користуйся ним, якщо хочеш повністю свою поведінку.')) + '</div></div>' +
        '</section>' +
        '<section class="block card" data-block="preview" data-w="4" data-title="Як побачить модель">' +
          '<div class="card-h"><div class="card-icon">' + ic('eye') + '</div><h2>' + esc(t('Як побачить модель')) + '</h2></div>' +
          '<p class="hint" style="margin-top:-6px">' + esc(t('Приклад: системний промпт запиту від Claude Code після обробки в CarteLink. Оновлюється, поки ти пишеш.')) + '</p>' +
          '<div class="pr-prev" id="prPrev"></div>' +
        '</section>' +
        '<section class="block card" data-block="agentmd" data-w="6" data-title="AGENT.md">' +
          '<div class="card-h"><div class="card-icon">' + ic('code') + '</div><h2>AGENT.md</h2><span class="sub">' + esc(t('правила проєкту — додаються після промпту')) + '</span></div>' +
          '<div class="setting" style="padding-top:0"><div class="grow"><b>' + esc(t('Додавати AGENT.md')) + '</b><span id="prMdName"></span></div>' + CL.ui.switch('prMdOn', false) + '</div>' +
          '<div class="row" style="margin:12px 0 10px"><button class="btn sm" id="prMdPick">' + ic('upload', 'sm') + esc(t('Завантажити файл')) + '</button>' +
            '<button class="btn sm ghost" id="prMdBig">' + ic('maximize', 'sm') + esc(t('Розгорнути')) + '</button>' +
            '<button class="btn sm ghost" id="prMdClear">' + ic('x', 'sm') + esc(t('Прибрати')) + '</button>' +
            '<span class="grow"></span><span class="hint">' + esc(t('.md, .markdown або .txt, до 512 КБ — або перетягни файл сюди')) + '</span></div>' +
          '<input type="file" id="prMdFile" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden>' +
          '<textarea class="textarea pr-md" id="prMd" spellcheck="false" placeholder="' + esc(t('Опиши тут правила проєкту — їх бачитиме кожна модель.')) + '"></textarea>' +
        '</section>' +
        '<section class="block card" data-block="thinking" data-w="6" data-title="Рівень думання">' +
          '<div class="card-h"><div class="card-icon">' + ic('bulb') + '</div><h2>' + esc(t('Рівень думання')) + '</h2><span class="sub">' + esc(t('лише для моделей, які це вміють')) + '</span></div>' +
          '<div class="setting" style="padding-top:0"><div class="grow"><b>' + esc(t('Керувати думанням моделі')) + '</b><span>' + esc(t('Моделям без підтримки нічого не надсилається — CarteLink визначає це сам.')) + '</span></div>' + CL.ui.switch('prThOn', false) + '</div>' +
          '<div class="cols-2" style="margin:12px 0" id="prThBox">' +
            '<div class="field"><label for="prThLevel">' + esc(t('Рівень')) + '</label><select class="select" id="prThLevel">' +
              opt('off', 'Вимкнути думання') + opt('low', 'Низький') + opt('medium', 'Середній') + opt('high', 'Високий') + opt('max', 'Максимальний') + opt('dynamic', 'Динамічний (модель вирішує сама)') + '</select>' +
              '<span class="hint">' + esc(t('скільки модель думає перед відповіддю')) + '</span></div>' +
            '<div class="field"><label for="prThBudget">' + esc(t('Бюджет, токенів')) + '</label><input class="input num" id="prThBudget" type="number" min="0" max="200000" step="1024" placeholder="' + esc(t('0 — за рівнем')) + '">' +
              '<span class="hint">' + esc(t('0 — за рівнем. CarteLink обрізає значення до меж моделі й до max_tokens запиту.')) + '</span></div>' +
          '</div>' +
          '<div class="setting"><div class="grow"><b>' + esc(t('Перекривати вибір програми')) + '</b><span>' + esc(t('Інакше власні налаштування думання програми лишаються.')) + '</span></div>' + CL.ui.switch('prThOver', false) + '</div>' +
          '<div class="label" style="margin:14px 0 8px">' + esc(t('Що підтримують твої моделі')) + '</div>' +
          '<div class="tags pr-caps" id="prCaps">' + CL.ui.skeleton(2) + '</div>' +
        '</section>' +
        '</div>' +
        '<div class="pr-savebar" id="prBar" role="region" aria-label="' + esc(t('Незбережені зміни')) + '"><span class="dot"></span><span class="grow" id="prBarText">' + esc(t('Є незбережені зміни')) + '</span>' +
          '<span class="hint" style="margin-inline-end:4px"><kbd>Ctrl</kbd> + <kbd>S</kbd></span>' +
          '<button class="btn sm ghost" id="prRevert">' + ic('restore', 'sm') + esc(t('Скасувати зміни')) + '</button>' +
          '<button class="btn sm primary" id="prSave">' + ic('check', 'sm') + esc(t('Зберегти')) + '</button></div>';

      const $ = (s) => root.querySelector(s);
      let snap = null; // form state as last filled from the server
      let pendingName = ''; // a file picked since then
      let loaded = null; // prompting object as last filled

      const state = () => ({
        enabled: $('#prOn').checked,
        mode: $('#prMode').value,
        scope: $('#prScope').value,
        text: $('#prText').value,
        agentMd: $('#prMd').value,
        agentMdEnabled: $('#prMdOn').checked,
        thEnabled: $('#prThOn').checked,
        thLevel: $('#prThLevel').value,
        thBudget: Math.max(0, Math.min(200000, parseInt($('#prThBudget').value, 10) || 0)),
        thOverride: $('#prThOver').checked,
      });
      const same = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
      const dirty = () => !!snap && (!same(state(), snap) || !!pendingName);

      function fill(p) {
        p = p || {};
        const th = p.thinking || {};
        loaded = p;
        $('#prOn').checked = !!p.enabled;
        $('#prText').value = p.text || '';
        $('#prMode').value = p.mode || 'prepend';
        $('#prScope').value = p.scope || 'all';
        $('#prMd').value = p.agentMd || '';
        $('#prMdOn').checked = !!p.agentMdEnabled;
        $('#prThOn').checked = !!th.enabled;
        $('#prThLevel').value = th.level || 'medium';
        $('#prThBudget').value = th.budget || '';
        $('#prThOver').checked = !!th.override;
        pendingName = '';
        snap = state();
        paint();
      }

      function mdName() {
        return pendingName || (loaded && loaded.agentMdName) || '';
      }

      function paint() {
        const s = state();
        const chars = s.text.length + (s.agentMdEnabled ? s.agentMd.length : 0);
        const size = $('#prSize');
        size.hidden = !chars;
        size.textContent = t('{n} символів · ~{k} токенів', { n: chars.toLocaleString(), k: Math.round(chars / 3.6).toLocaleString() });
        $('#prReplace').hidden = s.mode !== 'replace';
        const nm = mdName();
        $('#prMdName').textContent = nm ? t('Файл: {name} · {n} символів', { name: nm, n: s.agentMd.length.toLocaleString() })
          : s.agentMd.trim() ? t('Текст введено вручну · {n} символів', { n: s.agentMd.length.toLocaleString() }) : t('Файл не завантажено.');
        $('#prThBox').style.opacity = s.thEnabled ? '' : '0.55';
        $('#prBar').classList.toggle('on', dirty());
        preview(s);
      }

      // ---- live preview: what the model receives ----
      function seg(kind, label, icon, text, extra) {
        const max = 900;
        const body = text.length > max ? text.slice(0, max) + '…' : text;
        return '<div class="pr-seg ' + kind + '"><div class="pr-lab">' + ic(icon, 'sm') + esc(t(label)) + (extra ? '<span class="grow"></span>' + extra : '') + '</div><div class="pr-body">' + esc(body) +
          (text.length > max ? '<div class="faint" style="margin-top:4px">' + esc(t('…ще {n} символів', { n: (text.length - max).toLocaleString() })) + '</div>' : '') + '</div></div>';
      }
      function preview(s) {
        const box = $('#prPrev');
        const client = t(CLIENT_SAMPLE);
        const mine = [];
        if (s.text.trim()) mine.push(seg('mine', 'Твій промпт', 'edit', s.text.trim()));
        if (s.agentMdEnabled && s.agentMd.trim()) mine.push(seg('mine', 'AGENT.md', 'code', s.agentMd.trim()));
        let note = '';
        let parts;
        if (!s.enabled) {
          note = t('Вимкнено: модель отримує лише промпт програми.');
          parts = [seg('', 'Промпт програми', 'window', client)];
        } else if (s.scope === 'openai') {
          note = t('Claude Code говорить через API Anthropic, тож із цим обмеженням він промпт не отримає — лише Codex, Cursor та інші OpenAI-програми.');
          parts = [seg('', 'Промпт програми', 'window', client)];
        } else if (!mine.length) {
          note = t('Текст ще порожній — нічого не додається.');
          parts = [seg('', 'Промпт програми', 'window', client)];
        } else if (s.mode === 'replace') {
          parts = mine.concat([seg('gone', 'Промпт програми', 'window', client, '<span class="chip bad">' + esc(t('прибрано')) + '</span>')]);
        } else if (s.mode === 'append') {
          parts = [seg('', 'Промпт програми', 'window', client)].concat(mine);
        } else {
          parts = mine.concat([seg('', 'Промпт програми', 'window', client)]);
        }
        box.innerHTML = (note ? '<div class="hint" style="display:flex;gap:6px">' + ic('info', 'sm') + '<span>' + esc(note) + '</span></div>' : '') + parts.join('');
      }

      fill(cfg.prompting);

      // ---- events ----
      root.addEventListener('input', (e) => { if (e.target.closest('.blocks')) paint(); });
      root.addEventListener('change', (e) => { if (e.target.closest('.blocks')) paint(); });

      // AGENT.md file
      async function takeFile(f) {
        if (!f) return;
        if (!/\.(md|markdown|txt)$/i.test(f.name) && !/^text\//.test(f.type || '')) { CL.toast('Підходять лише файли .md, .markdown або .txt', 'bad'); return; }
        if (f.size > MD_MAX) { CL.toast('Файл завеликий — до 512 КБ', 'bad'); return; }
        $('#prMd').value = await f.text();
        $('#prMdOn').checked = true;
        pendingName = f.name;
        paint();
        CL.toast(t('{name} завантажено — натисни «Зберегти»', { name: f.name }), 'info');
      }
      $('#prMdPick').addEventListener('click', () => $('#prMdFile').click());
      $('#prMdFile').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; await takeFile(f); });
      const mdCard = root.querySelector('[data-block="agentmd"]');
      mdCard.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); mdCard.classList.add('dropping'); } });
      mdCard.addEventListener('dragleave', (e) => { if (!mdCard.contains(e.relatedTarget)) mdCard.classList.remove('dropping'); });
      mdCard.addEventListener('drop', (e) => {
        mdCard.classList.remove('dropping');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        e.preventDefault();
        takeFile(f);
      });
      $('#prMdClear').addEventListener('click', () => {
        $('#prMd').value = '';
        $('#prMdOn').checked = false;
        pendingName = '';
        if (loaded) loaded = Object.assign({}, loaded, { agentMdName: '' });
        paint();
      });
      $('#prMdBig').addEventListener('click', async () => {
        const v = await CL.dialog({
          title: 'AGENT.md',
          wide: true,
          sticky: true,
          html: '<textarea class="textarea" id="prMdBigText" spellcheck="false" style="min-height:60vh">' + esc($('#prMd').value) + '</textarea>',
          actions: [{ label: 'Скасувати', value: null }, { label: 'Готово', kind: 'primary', onClick: (d, close) => { close(d.querySelector('#prMdBigText').value); return false; } }],
        });
        if (v == null || !ctx.alive()) return;
        $('#prMd').value = v;
        if (v.trim() && !$('#prMdOn').checked && !snap.agentMd) $('#prMdOn').checked = true;
        paint();
      });

      // ---- save / revert ----
      async function save() {
        if (!dirty()) return;
        const btn = $('#prSave');
        const base = snap;
        const cur = state();
        if (cur.enabled && cur.mode === 'replace' && !(base.enabled && base.mode === 'replace')) {
          if (!(await CL.confirm('Режим «Замінити» прибирає системний промпт програми повністю. Програма може гірше працювати з власними інструментами. Продовжити?', { ok: 'Так, замінювати' }))) return;
        }
        await CL.ui.busy(btn, async () => {
          const p = {};
          const th = {};
          const set = (obj, field, k) => { if (cur[k] !== base[k]) obj[field] = cur[k]; };
          set(p, 'enabled', 'enabled');
          set(p, 'mode', 'mode');
          set(p, 'scope', 'scope');
          set(p, 'text', 'text');
          set(p, 'agentMd', 'agentMd');
          set(p, 'agentMdEnabled', 'agentMdEnabled');
          if (pendingName) p.agentMdName = pendingName;
          if ('agentMd' in p && !p.agentMd.trim()) { p.agentMd = ''; p.agentMdEnabled = false; p.agentMdName = ''; }
          set(th, 'enabled', 'thEnabled');
          set(th, 'level', 'thLevel');
          set(th, 'budget', 'thBudget');
          set(th, 'override', 'thOverride');
          if (Object.keys(th).length) p.thinking = th;
          await CL.config.patch({ prompting: p });
          let fresh = null;
          try { fresh = await CL.config.get(); } catch (e) { /* keep the form */ }
          if (!ctx.alive()) return;
          // Show the saved result, unless the form was edited again meanwhile.
          if (fresh && same(cur, state())) fill(fresh.prompting);
          else { snap = cur; pendingName = ''; paint(); }
          CL.loadStatus().catch(() => {});
          CL.toast('Системний промпт збережено — діє одразу ✓');
        });
      }
      $('#prSave').addEventListener('click', save);
      $('#prRevert').addEventListener('click', async () => {
        try { const fresh = await CL.config.get(); if (ctx.alive()) fill(fresh.prompting); } catch (e) { fill(loaded); }
      });
      const onKey = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !document.querySelector('.dlg-back')) { e.preventDefault(); save(); }
      };
      document.addEventListener('keydown', onKey);
      ctx.leave(() => {
        document.removeEventListener('keydown', onKey);
        if (dirty()) CL.toast('Незбережені зміни системного промпту скасовано', 'info');
      });

      // Changed elsewhere (another window, the tray): refill when nothing is being edited.
      ctx.on('changed', async (w) => {
        if (w !== 'config' || dirty()) return;
        try { const fresh = await CL.config.get(); if (ctx.alive() && !dirty() && JSON.stringify(fresh.prompting) !== JSON.stringify(loaded)) fill(fresh.prompting); } catch (e) { /* ignore */ }
      });

      // ---- what the models in use support ----
      async function caps() {
        const box = $('#prCaps');
        let info = {};
        let sw = null;
        let c = cfg;
        try { info = ((await CL.api.get('/model-info')) || {}).models || {}; } catch (e) { /* engine down */ }
        try { sw = await CL.api.get('/switcher'); } catch (e) { /* optional */ }
        try { c = await CL.config.get(); } catch (e) { /* use first */ }
        if (!ctx.alive()) return;
        const r = (c && c.routing) || {};
        const tr = r.tiers || {};
        const used = [tr.haiku, tr.sonnet, tr.opus, tr.fast, tr.main, tr.max, r.defaultModel, sw && sw.model1, sw && sw.model2].concat(Object.values(r.modelMap || {}));
        const models = Array.from(new Set(used.map((m) => CL.cleanModel(m || '')).filter(Boolean)));
        if (!models.length) {
          box.innerHTML = '<span class="hint">' + esc(t('Спочатку обери моделі на сторінці «Моделі».')) + '</span>';
          return;
        }
        const capsOf = (m) => {
          const k = m.toLowerCase();
          if (info[k]) return info[k];
          const sl = k.lastIndexOf('/');
          if (sl >= 0 && info[k.slice(sl + 1)]) return info[k.slice(sl + 1)];
          const par = k.indexOf('(');
          if (par > 0 && info[k.slice(0, par).trim()]) return info[k.slice(0, par).trim()];
          return null;
        };
        const fmtTok = (n) => (n >= 1000000 ? (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
        box.innerHTML = models.map((m) => {
          const k = capsOf(m);
          const can = !!(k && k.thinking);
          const levels = k && k.levels && k.levels.length;
          const how = !k ? t('невідомо') : !k.thinking ? t('не підтримує') : levels && k.max ? t('бюджет + зусилля') : levels ? t('зусилля') : t('бюджет думання');
          const tip = [];
          if (k && levels) tip.push(t('Рівні: {l}', { l: k.levels.join(', ') }));
          if (k && k.max) tip.push(t('Бюджет: {a}–{b} токенів', { a: (k.min || 0).toLocaleString(), b: k.max.toLocaleString() }));
          if (k && k.context) tip.push(t('Контекст: {n}', { n: fmtTok(k.context) }));
          if (k && k.maxOutput) tip.push(t('Відповідь до {n} токенів', { n: fmtTok(k.maxOutput) }));
          if (!k) tip.push(t('Рушій нічого не знає про цю модель — налаштування думання їй не надсилаються.'));
          return '<span class="chip ' + (can ? 'ok' : k ? '' : 'outline') + '" data-tip="' + esc(tip.join(' · ')) + '">' + ic(can ? 'check' : 'x', 'sm') + '<b>' + esc(m) + '</b> · ' + esc(how) + '</span>';
        }).join('');
      }
      caps();
      ctx.on('changed', (w) => { if (w === 'config' || w === 'engine') caps(); });
    },
  });
})();
