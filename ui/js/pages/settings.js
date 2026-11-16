'use strict';
// Налаштування: look, what the interface shows, app behaviour, the gateway,
// the model blacklist, raw engine YAML and diagnostics.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  const OFFICIAL = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5',
    'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-3', 'claude-sonnet-4-6'];
  const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];

  const STYLE = '<style>' +
    '.st-page .theme-tile.custom .prev{display:grid;place-items:center;grid-template-columns:1fr;background:repeating-linear-gradient(135deg,var(--surface-2) 0 10px,var(--surface-3) 10px 20px);color:var(--accent)}' +
    '.st-page .theme-tile.custom .prev .i{width:28px;height:28px}' +
    '.st-page .st-range{display:flex;align-items:center;gap:12px;min-width:220px}' +
    '.st-page .st-range output{min-width:44px;text-align:end;font-variant-numeric:tabular-nums;color:var(--text-2)}' +
    '.st-page .st-cat{display:flex;flex-wrap:wrap;gap:6px;max-height:260px;overflow:auto;padding:2px}' +
    '.st-page button.chip{cursor:pointer;font-family:var(--font-mono);font-weight:500}' +
    '.st-page button.chip:hover{border-color:var(--line-strong)}' +
    '.st-page .st-log{white-space:pre;word-break:normal;min-height:160px;padding-inline-end:14px}' +
    '.st-page .st-msg{min-height:18px}.st-page .st-msg.ok{color:var(--ok)}.st-page .st-msg.bad{color:var(--bad)}' +
    '.st-page .st-nav .setting{padding:8px 0}' +
    '</style>';

  const setting = (title, sub, ctrl, id) => '<div class="setting"' + (id ? ' id="' + id + '"' : '') + '><div class="grow"><b>' + esc(t(title)) + '</b>' + (sub ? '<span>' + esc(t(sub)) + '</span>' : '') + '</div>' + ctrl + '</div>';
  const head = (icon, title, extra) => '<div class="card-h"><div class="card-icon">' + ic(icon) + '</div><h2>' + esc(t(title)) + '</h2><span class="grow"></span>' + (extra || '') + '</div>';
  const msg = (el, text, kind) => { if (!el) return; el.textContent = text || ''; el.className = 'hint st-msg ' + (kind || ''); };

  CL.page('settings', {
    title: 'Налаштування', icon: 'sliders', group: 'manage', order: 100,

    async render(root, ctx) {
      root.classList.add('st-page');
      root.innerHTML = STYLE +
        '<div class="blocks" data-area="settings">' +
        '<section class="block card" data-block="look" data-w="12" data-title="Вигляд" id="stLook"></section>' +
        '<section class="block card" data-block="iface" data-w="6" data-title="Інтерфейс: що показувати" id="stIface"></section>' +
        '<section class="block card" data-block="app" data-w="6" data-title="Програма">' + head('window', 'Програма') + '<div id="stApp">' + CL.ui.skeleton(4) + '</div></section>' +
        '<section class="block card" data-block="gateway" data-w="6" data-title="Шлюз">' + head('radio', 'Шлюз') + '<div id="stGw">' + CL.ui.skeleton(5) + '</div></section>' +
        '<section class="block card" data-block="blacklist" data-w="6" data-title="Чорний список моделей">' + head('ban', 'Чорний список моделей', '<span class="sub" id="stBlCount"></span>') + '<div id="stBl">' + CL.ui.skeleton(3) + '</div></section>' +
        '<section class="block card" data-block="notify" data-w="6" data-title="Сповіщення">' + head('bulb', 'Сповіщення', '<span class="sub">' + esc(t('у системному треї')) + '</span>') + '<div id="stNotify">' + CL.ui.skeleton(4) + '</div></section>' +
        '<section class="block card" data-block="backup" data-w="6" data-title="Резервна копія">' + head('download', 'Резервна копія') + '<div id="stBackup"></div></section>' +
        '<section class="block card" data-block="advanced" data-w="5" data-title="Розширені">' + head('code', 'Розширені') + '<div id="stAdv">' + CL.ui.skeleton(3) + '</div></section>' +
        '<section class="block card" data-block="diag" data-w="7" data-title="Діагностика">' + head('activity', 'Діагностика') + '<div id="stDiag">' + CL.ui.skeleton(4) + '</div></section>' +
        '</div>';
      const $ = (s) => root.querySelector(s);

      // ========================================================= notify ==
      async function paintNotify() {
        const box = $('#stNotify');
        let n;
        try { n = await CL.api.get('/notify'); } catch (e) { box.innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(e.message) + '</div></div>'; return; }
        if (!ctx.alive()) return;
        const ROWS = [
          ['accountDead', 'Акаунт перестав працювати', 'Сервіс відхилив вхід — потрібно увійти знову або видалити акаунт.'],
          ['limit', 'Акаунт на ліміті', 'Запити тимчасово йдуть іншими акаунтами.'],
          ['fallback', 'Відповіла запасна модель', 'Основна модель не відповіла, і CarteLink перемкнувся на запасну.'],
          ['engine', 'Рушій перезапущено', 'Внутрішній рушій зупинився, і CarteLink підняв його знову.'],
        ];
        box.innerHTML = setting('Показувати сповіщення', 'Однакове сповіщення — не частіше ніж раз на 30 хвилин.', CL.ui.switch('nOn', n.enabled)) +
          '<div id="nRows">' + ROWS.map(([k, title, sub]) => setting(title, sub, CL.ui.switch('n_' + k, n[k]))).join('') + '</div>';
        const rows = $('#nRows');
        const sync = (on) => rows.querySelectorAll('input').forEach((x) => { x.disabled = !on; });
        sync(n.enabled);
        box.addEventListener('change', async (e) => {
          const x = e.target;
          if (!x.matches('input[type=checkbox]')) return;
          const key = x.id === 'nOn' ? 'enabled' : x.id.slice(2);
          if (key === 'enabled') sync(x.checked);
          try { await CL.api.put('/notify', { [key]: x.checked }); CL.toast('Збережено ✓'); } catch (er) { x.checked = !x.checked; if (key === 'enabled') sync(x.checked); CL.fail(er); }
        });
      }

      // ========================================================= backup ==
      function paintBackup() {
        const box = $('#stBackup');
        box.innerHTML = '<p class="muted small" style="margin-top:0">' + esc(t('Один файл з усім: налаштування, акаунти, ключі, статистика і список плагінів. Зручно для переїзду на інший комп’ютер.')) + '</p>' +
          '<div class="banner" style="margin-bottom:12px">' + ic('shield') + '<div>' + esc(t('У файлі є входи в акаунти й ключі — зберігай його як пароль і нікому не пересилай.')) + '</div></div>' +
          '<div class="row"><button class="btn primary" id="bkSave">' + ic('download', 'sm') + esc(t('Зберегти копію')) + '</button>' +
          '<button class="btn" id="bkLoad">' + ic('upload', 'sm') + esc(t('Відновити з файлу…')) + '</button><input type="file" id="bkFile" accept=".zip,application/zip" hidden></div>' +
          '<div class="hint st-msg" id="bkMsg" style="margin-top:8px"></div>';
        $('#bkSave').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
          const res = await fetch('/api/backup');
          if (!res.ok) throw new Error(t('Не вдалось створити копію (HTTP {s})', { s: res.status }));
          const blob = await res.blob();
          const cd = res.headers.get('content-disposition') || '';
          const name = (cd.match(/filename="?([^";]+)"?/) || [])[1] || 'cartelink-backup.zip';
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
          msg($('#bkMsg'), t('Збережено: {name}', { name }), 'ok');
        }));
        $('#bkLoad').addEventListener('click', () => $('#bkFile').click());
        $('#bkFile').addEventListener('change', async (e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!f) return;
          if (!(await CL.confirm(t('Відновити CarteLink з файлу «{name}»? Поточні налаштування, ключі й статистика заміняться тими, що у файлі (акаунти з файлу додадуться до наявних). Поточний стан спершу збережеться в data/backups. CarteLink перезапуститься.', { name: f.name }), { ok: 'Відновити', title: 'Відновлення' }))) return;
          msg($('#bkMsg'), t('Відновлюю…'), '');
          let r;
          try {
            const res = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: f });
            r = await res.json().catch(() => null);
            if (!res.ok || !r || r.ok === false) throw new Error((r && r.error) || 'HTTP ' + res.status);
          } catch (er) { msg($('#bkMsg'), t('Не вдалось: {e}', { e: er.message }), 'bad'); return; }
          CL.dialog({ title: 'CarteLink перезапускається', sticky: true, html: '<div class="dlg-text">' + esc(t('Відновлено файлів: {n}. Сторінка оновиться сама, щойно CarteLink запуститься знову.', { n: r.files || 0 })) + '</div>' + CL.ui.skeleton(2), actions: [] });
          await CL.sleep(4000);
          for (let i = 0; i < 60; i++) {
            try { const p = await fetch('/api/status', { cache: 'no-store' }); if (p.ok) { location.reload(); return; } } catch (er) { /* still restarting */ }
            await CL.sleep(1000);
          }
          location.reload();
        });
      }

      // =========================================================== look ==
      function paintLook() {
        const P = CL.look.prefs();
        const box = $('#stLook');
        box.innerHTML = head('palette', 'Вигляд', '<span class="sub">' + esc(t('змінюється одразу, нічого перезапускати не треба')) + '</span>') +
          '<div class="themes" role="radiogroup" aria-label="' + esc(t('Дизайн')) + '">' +
            CL.look.THEMES.map((th) => CL.look.tile(th, P.theme === th.id)).join('') +
            '<button class="theme-tile custom' + (P.theme === 'custom' ? ' on' : '') + '" id="stCustom" role="radio" aria-checked="' + (P.theme === 'custom') + '"><div class="prev">' + ic('palette') + '</div>' +
              '<div class="name"><span>' + esc(t('Свій дизайн')) + '</span><span class="faint small">' + esc(t(P.theme === 'custom' ? 'змінити' : 'створити')) + '</span></div></button>' +
          '</div>' +
          '<div class="cols-2" style="margin-top:16px;column-gap:32px">' +
            '<div>' +
              setting('Щільність', 'Скільки повітря між елементами.', CL.ui.seg('stDensity', [['dense', 'Щільно'], ['normal', 'Звичайно'], ['roomy', 'Просторо']], P.density || 'normal')) +
              setting('Анімації', 'Менше руху — спокійніше для очей.', CL.ui.seg('stMotion', [['full', 'Усі'], ['reduced', 'Менше'], ['off', 'Вимкнено']], P.motion === 'full-force' ? 'full' : P.motion || 'full')) +
              setting('Розмір тексту', '', '<label class="st-range"><input type="range" id="stFont" min="85" max="125" step="5" value="' + (P.fontScale || 100) + '" aria-label="' + esc(t('Розмір тексту')) + '"><output id="stFontV">' + (P.fontScale || 100) + '%</output></label>') +
            '</div><div>' +
              setting('Ефекти фону', 'Фон дизайну: зорі, табло, плівка тощо. Вимкнений — спокійніше й економніше.', CL.ui.switch('stFx', P.fx !== false)) +
              setting('Компактне меню', 'Лише іконки в боковому меню.', CL.ui.switch('stNavC', !!P.navCompact)) +
              '<div class="row" style="padding-top:14px"><button class="btn sm" id="stLayout">' + ic('layout', 'sm') + esc(t('Налаштувати розташування')) + '</button>' +
                '<button class="btn sm ghost" id="stLookReset">' + ic('restore', 'sm') + esc(t('Скинути весь вигляд')) + '</button></div>' +
              '<p class="hint" style="margin-top:8px">' + esc(t('У режимі розташування блоки на будь-якій сторінці можна перетягувати, міняти їм ширину й ховати.')) + '</p>' +
            '</div>' +
          '</div>';
        box.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => CL.look.setTheme(b.dataset.themePick)));
        $('#stCustom').addEventListener('click', () => CL.look.openEditor());
        CL.ui.onSeg($('#stDensity'), (v) => CL.look.set({ density: v }));
        CL.ui.onSeg($('#stMotion'), (v) => CL.look.set({ motion: v }));
        const f = $('#stFont');
        f.addEventListener('input', () => { $('#stFontV').textContent = f.value + '%'; CL.look.set({ fontScale: Number(f.value) }); });
        $('#stFx').addEventListener('change', (e) => CL.look.set({ fx: e.target.checked }));
        $('#stNavC').addEventListener('change', (e) => CL.look.set({ navCompact: e.target.checked }));
        $('#stLayout').addEventListener('click', () => { CL.look.toggleEdit(true); CL.renderNav(); });
        $('#stLookReset').addEventListener('click', async () => {
          if (!(await CL.confirm('Скинути весь вигляд? Повернуться стандартний дизайн, розмір тексту, розташування блоків на всіх сторінках і пункти меню. Свій дизайн буде втрачено.', { danger: true, ok: 'Скинути' }))) return;
          CL.look.resetAll();
          CL.renderNav();
          CL.toast('Вигляд скинуто ✓');
        });
      }

      // ===================================================== interface ==
      function paintIface() {
        const P = CL.look.prefs();
        const hidden = (P.nav && P.nav.hidden) || [];
        const pages = CL.pages.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        $('#stIface').innerHTML = head('eye', 'Інтерфейс: що показувати') +
          CL.look.TOGGLES.map(([k, label]) => setting(label, '', CL.ui.switch('stTg-' + k, !P.hide[k]))).join('') +
          '<div class="label" style="margin:18px 0 4px">' + esc(t('Пункти меню')) + '</div>' +
          '<div class="st-nav">' + pages.map((p) => '<div class="setting"><span class="card-icon" style="width:24px;height:24px">' + ic(p.icon, 'sm') + '</span><div class="grow"><b>' + esc(t(p.title)) + '</b>' +
            (p.id === 'settings' ? '<span>' + esc(t('Завжди в меню — інакше сюди не повернутись.')) + '</span>' : '') + '</div>' +
            '<label class="switch"><input type="checkbox" data-navp="' + esc(p.id) + '"' + (hidden.includes(p.id) ? '' : ' checked') + (p.id === 'settings' ? ' disabled' : '') + ' aria-label="' + esc(t(p.title)) + '"><span class="track"></span></label></div>').join('') + '</div>' +
          '<p class="hint" style="margin-top:8px">' + esc(t('Схована сторінка лишається доступною через пошук (Ctrl+K).')) + '</p>';
        CL.look.TOGGLES.forEach(([k]) => $('#stTg-' + k).addEventListener('change', (e) => { CL.look.set({ hide: { [k]: !e.target.checked } }); CL.renderNav(); }));
        $('#stIface').querySelectorAll('[data-navp]').forEach((inp) => inp.addEventListener('change', () => {
          const P2 = CL.look.prefs();
          P2.nav = P2.nav || { order: [], hidden: [] };
          const h = new Set(P2.nav.hidden || []);
          if (inp.checked) h.delete(inp.dataset.navp); else if (inp.dataset.navp !== 'settings') h.add(inp.dataset.navp);
          P2.nav.hidden = Array.from(h);
          CL.look.save();
          CL.renderNav();
        }));
      }

      paintLook();
      paintIface();
      ctx.on('look', () => { if (ctx.alive()) { paintLook(); paintIface(); } });

      // ========================================================== app ==
      let appS = null;
      function paintApp() {
        const s = appS;
        $('#stApp').innerHTML =
          setting('Запускати разом із системою', 'Стартує згорнутим, шлюз одразу працює.', CL.ui.switch('stAuto', !!s.autostart)) +
          (s.trayAvailable ? setting('Закриття вікна згортає в трей', 'Шлюз працює далі; вийти — правий клік по значку в треї.', CL.ui.switch('stTray', !!s.closeToTray)) : '') +
          (s.trayAvailable ? setting('Стартувати без вікна', 'Після запуску CarteLink одразу ховається в трей.', CL.ui.switch('stHidden', !!s.startHidden)) : '') +
          (s.switcherAvailable ? setting('Плаваючий перемикач моделей', 'Маленьке вікно поверх усіх вікон: дві моделі й перемикання одним кліком.', CL.ui.switch('stSwitcher', !!s.switcher)) : '') +
          setting('Мова інтерфейсу', 'І меню в треї теж.', '<select class="select" id="stLang" style="width:auto;min-width:170px" aria-label="' + esc(t('Мова інтерфейсу')) + '"></select>');
        if (typeof fillLangSelect === 'function') fillLangSelect($('#stLang'));
        const bind = (id, field) => {
          const el = $('#' + id);
          if (!el) return;
          el.addEventListener('change', async () => {
            el.disabled = true;
            try {
              appS = await CL.api.put('/app/settings', { [field]: el.checked });
              CL.toast('Збережено ✓');
            } catch (e) { el.checked = !el.checked; CL.fail(e); }
            finally { el.disabled = false; }
          });
        };
        bind('stAuto', 'autostart');
        bind('stTray', 'closeToTray');
        bind('stHidden', 'startHidden');
        bind('stSwitcher', 'switcher');
      }
      async function loadApp() {
        try { appS = await CL.api.get('/app/settings'); } catch (e) {
          if (ctx.alive()) $('#stApp').innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Не вдалось прочитати налаштування програми: {e}', { e: e.message })) + '</div></div>';
          return null;
        }
        if (ctx.alive()) paintApp();
        return appS;
      }

      // ====================================================== gateway ==
      let cfg = null;
      let gwSnap = null;
      const gwState = () => ({
        port: Number($('#stPort').value),
        host: $('#stHost').value.trim() || '127.0.0.1',
        requireKey: $('#stReq').checked,
        apiKey: $('#stKey').value.trim(),
      });
      const gwDirty = () => !!gwSnap && JSON.stringify(gwState()) !== JSON.stringify(gwSnap);

      function paintGw() {
        const st = CL.status || {};
        const eng = st.engine || {};
        const tempPort = eng.port && eng.configPort && eng.port !== eng.configPort;
        $('#stGw').innerHTML =
          '<div class="cols-2">' +
            '<div class="field"><label for="stPort">' + esc(t('Порт')) + '</label><input class="input num" id="stPort" type="number" min="1" max="65535"><span class="hint">' + esc(t('Змінюй, лише якщо 8317 зайнятий іншою програмою.')) + '</span></div>' +
            '<div class="field"><label for="stHost">Host</label><input class="input mono" id="stHost" placeholder="127.0.0.1" spellcheck="false"><span class="hint">' + esc(t('127.0.0.1 — лише цей комп’ютер (рекомендовано).')) + '</span></div>' +
          '</div>' +
          (tempPort ? '<div class="banner info" style="margin:12px 0 0">' + ic('info') + '<div>' + esc(t('Зараз шлюз працює на порту {p} лише на цей запуск — порт {c} був зайнятий.', { p: eng.port, c: eng.configPort })) + '</div></div>' : '') +
          '<div class="banner" id="stLan" style="margin:12px 0 0" hidden>' + ic('alert') + '<div>' + esc(t('API моделей буде доступний з інших пристроїв у мережі. Панель керування все одно відкривається лише на цьому комп’ютері. Тримай перевірку ключа увімкненою.')) + '</div></div>' +
          setting('Вимагати API-ключ від програм', 'Якщо вимкнено — шлюз приймає будь-який ключ.', CL.ui.switch('stReq', false)) +
          '<div class="field"><label for="stKey">' + esc(t('Ключ шлюзу')) + '</label><div class="input-group"><input class="input mono" id="stKey" type="password" autocomplete="off" spellcheck="false">' +
            '<button class="btn icon" id="stKeyEye" data-tip="Показати / сховати" aria-label="' + esc(t('Показати / сховати')) + '">' + ic('eye', 'sm') + '</button>' +
            '<button class="btn icon" id="stKeyCopy" data-tip="Копіювати" aria-label="' + esc(t('Копіювати')) + '">' + ic('copy', 'sm') + '</button>' +
            '<button class="btn" id="stKeyGen">' + ic('rotate', 'sm') + esc(t('Новий')) + '</button></div></div>' +
          '<div class="row" style="margin-top:14px"><button class="btn primary" id="stGwSave" disabled>' + ic('check', 'sm') + esc(t('Зберегти')) + '</button><span class="hint st-msg" id="stGwMsg"></span></div>' +
          '<div class="sep"></div>' +
          '<div class="label">' + esc(t('Додаткові ключі з повним доступом')) + '</div>' +
          '<p class="hint" style="margin:4px 0 8px">' + esc(t('Працюють так само, як ключ шлюзу. Ключі з обмеженим набором моделей — на сторінці «API-ключі».')) + '</p>' +
          '<div id="stXKeys"></div>' +
          '<div class="input-group" style="margin-top:8px"><input class="input mono" id="stXNew" placeholder="sk-…" autocomplete="off" spellcheck="false" aria-label="' + esc(t('Новий додатковий ключ')) + '"><button class="btn" id="stXAdd">' + ic('plus', 'sm') + esc(t('Додати')) + '</button></div>' +
          '<span class="hint st-msg" id="stXMsg"></span>';
        fillGw();
        const onEdit = () => {
          const s = gwState();
          $('#stLan').hidden = LOOPBACK.includes(s.host.toLowerCase());
          $('#stGwSave').disabled = !gwDirty();
        };
        ['#stPort', '#stHost', '#stKey'].forEach((s) => $(s).addEventListener('input', onEdit));
        $('#stReq').addEventListener('change', () => { onEdit(); paintXKeys(); });
        $('#stKeyEye').addEventListener('click', () => { const k = $('#stKey'); k.type = k.type === 'password' ? 'text' : 'password'; });
        $('#stKeyCopy').addEventListener('click', () => CL.copy($('#stKey').value.trim(), 'Ключ скопійовано'));
        $('#stKeyGen').addEventListener('click', (e) => genKey(e.currentTarget));
        $('#stGwSave').addEventListener('click', (e) => saveGw(e.currentTarget));
        $('#stGw').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('#stPort,#stHost,#stKey') && gwDirty()) saveGw($('#stGwSave')); });
        $('#stXAdd').addEventListener('click', (e) => addXKey(e.currentTarget));
        $('#stXNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') addXKey($('#stXAdd')); });
        onEdit();
      }
      function fillGw() {
        $('#stPort').value = (cfg.cliproxy && cfg.cliproxy.port) || 8317;
        $('#stHost').value = (cfg.cliproxy && cfg.cliproxy.host) || '127.0.0.1';
        $('#stReq').checked = !!cfg.requireKey;
        $('#stKey').value = cfg.apiKey || '';
        gwSnap = gwState();
        $('#stLan').hidden = LOOPBACK.includes(gwSnap.host.toLowerCase());
        $('#stGwSave').disabled = true;
        paintXKeys();
      }

      async function saveGw(btn) {
        const base = gwSnap;
        const cur = gwState();
        const m = $('#stGwMsg');
        if (!Number.isInteger(cur.port) || cur.port < 1 || cur.port > 65535) { msg(m, t('Невірний порт: потрібне число від 1 до 65535.'), 'bad'); $('#stPort').focus(); return; }
        if (cur.requireKey && !cur.apiKey) { msg(m, t('Перевірка ключа увімкнена, а ключ порожній. Впиши ключ або натисни «Новий».'), 'bad'); $('#stKey').focus(); return; }
        const lan = !LOOPBACK.includes(cur.host.toLowerCase());
        if (lan && !cur.requireKey && (cur.host !== base.host || cur.requireKey !== base.requireKey)) {
          if (!(await CL.confirm(t('Host {h} відкриває шлюз для інших пристроїв у мережі, а перевірку ключа вимкнено — будь-хто в мережі зможе користуватися твоїми акаунтами. Продовжити?', { h: cur.host }), { danger: true, ok: 'Так, відкрити' }))) return;
        }
        if (cur.apiKey !== base.apiKey && base.apiKey) {
          if (!(await CL.confirm('Змінити ключ шлюзу? Програми зі старим ключем перестануть працювати, доки не впишеш їм новий.', { ok: 'Змінити ключ' }))) return;
        }
        const p = {};
        if (cur.port !== base.port || cur.host !== base.host) {
          p.cliproxy = {};
          if (cur.port !== base.port) p.cliproxy.port = cur.port;
          if (cur.host !== base.host) p.cliproxy.host = cur.host;
        }
        if (cur.apiKey !== base.apiKey) p.apiKey = cur.apiKey;
        if (cur.requireKey !== base.requireKey) p.requireKey = cur.requireKey;
        if (!Object.keys(p).length) return;
        const r = await CL.ui.busy(btn, () => CL.config.patch(p));
        if (!r) { msg(m, t('Не збережено — дивись повідомлення вище.'), 'bad'); return; }
        try { cfg = await CL.config.get(); } catch (e) { /* keep */ }
        if (!ctx.alive()) return;
        fillGw();
        CL.loadEndpoints().catch(() => {});
        msg(m, r.needsRestart ? t('Збережено. Нова адреса запрацює після перезапуску шлюзу.') : t('Збережено — діє одразу ✓'), 'ok');
        if (r.needsRestart && (await CL.confirm('Перезапустити шлюз зараз, щоб застосувати нову адресу? Програми на кілька секунд втратять зв’язок.', { ok: 'Перезапустити' }))) {
          try { const rr = await CL.api.post('/server/restart'); CL.followRestart(rr.host, rr.port); } catch (e) { CL.fail(e); }
        }
      }

      async function genKey(btn) {
        if (!(await CL.confirm('Згенерувати новий ключ шлюзу? Старий одразу перестане діяти — у кожній програмі доведеться вписати новий.', { danger: true, ok: 'Згенерувати' }))) return;
        await CL.ui.busy(btn, async () => {
          const r = await CL.api.post('/generate-key');
          if (!ctx.alive()) return;
          cfg.apiKey = r.key;
          const k = $('#stKey');
          k.value = r.key;
          k.type = 'text';
          gwSnap = Object.assign({}, gwSnap, { apiKey: r.key });
          $('#stGwSave').disabled = !gwDirty();
          CL.loadEndpoints().catch(() => {});
          CL.toast('Новий ключ збережено — скопіюй його в свої програми');
        });
      }

      // extra full-access keys (config.cliproxy.apiKeys)
      function paintXKeys() {
        const box = $('#stXKeys');
        if (!box) return;
        const keys = ((cfg.cliproxy && cfg.cliproxy.apiKeys) || []).filter((k) => !/^cl-api-/.test(k));
        const off = !$('#stReq').checked;
        $('#stXNew').disabled = off;
        $('#stXAdd').disabled = off;
        box.innerHTML = (off ? '<div class="hint" style="margin-bottom:6px">' + ic('info', 'sm') + ' ' + esc(t('Перевірку ключа вимкнено — шлюз і так приймає будь-який ключ.')) + '</div>' : '') +
          (keys.length ? '<div class="list">' + keys.map((k, i) => '<div class="li" style="padding:6px 2px"><span class="grow mono">' + esc(CL.mask(k)) + '</span>' +
            '<button class="btn sm icon ghost" data-xcopy="' + i + '" data-tip="Копіювати" aria-label="' + esc(t('Копіювати')) + '">' + ic('copy', 'sm') + '</button>' +
            '<button class="btn sm icon danger" data-xdel="' + i + '" data-tip="' + esc(t('Видалити ключ')) + '" aria-label="' + esc(t('Видалити ключ')) + '">' + ic('trash', 'sm') + '</button></div>').join('') + '</div>'
            : '<div class="hint">' + esc(t('Додаткових ключів немає.')) + '</div>');
        box.querySelectorAll('[data-xcopy]').forEach((b) => b.addEventListener('click', () => CL.copy(keys[Number(b.dataset.xcopy)], 'Ключ скопійовано')));
        box.querySelectorAll('[data-xdel]').forEach((b) => b.addEventListener('click', async () => {
          const k = keys[Number(b.dataset.xdel)];
          if (!(await CL.confirm(t('Видалити ключ {k}? Програми з ним перестануть працювати.', { k: CL.mask(k) }), { danger: true }))) return;
          CL.ui.busy(b, async () => {
            const fresh = await CL.config.get();
            const list = ((fresh.cliproxy && fresh.cliproxy.apiKeys) || []).filter((x) => x !== k);
            await CL.config.patch({ cliproxy: { apiKeys: list } });
            cfg = await CL.config.get();
            if (ctx.alive()) paintXKeys();
            CL.toast('Ключ видалено');
          });
        }));
      }
      const addXKey = (btn) => CL.ui.busy(btn, async () => {
        const inp = $('#stXNew');
        const m = $('#stXMsg');
        const k = inp.value.trim();
        if (!k) { msg(m, t('Впиши ключ у поле.'), 'bad'); inp.focus(); return; }
        if (/^cl-api-/.test(k)) { msg(m, t('Ключі з префіксом cl-api- створюються лише на сторінці «API-ключі».'), 'bad'); return; }
        if (/\s/.test(k)) { msg(m, t('Ключ не може містити пробілів.'), 'bad'); return; }
        const fresh = await CL.config.get();
        const list = (fresh.cliproxy && fresh.cliproxy.apiKeys) || [];
        if (k === fresh.apiKey || list.includes(k)) { msg(m, t('Такий ключ уже є.'), 'bad'); return; }
        await CL.config.patch({ cliproxy: { apiKeys: list.concat([k]) } });
        cfg = await CL.config.get();
        inp.value = '';
        msg(m, t('Ключ додано ✓'), 'ok');
        if (ctx.alive()) paintXKeys();
      });

      // ===================================================== blacklist ==
      let catalogue = null; // null until "Показати всі моделі"
      function paintBl() {
        const bl = cfg.modelBlacklist || [];
        const low = new Set(bl.map((x) => String(x).toLowerCase().trim()));
        $('#stBlCount').textContent = bl.length ? t('{n} заблоковано', { n: bl.length }) : '';
        const box = $('#stBl');
        const keepQ = $('#stBlFilter') ? $('#stBlFilter').value : '';
        box.innerHTML = '<p class="hint" style="margin-top:-6px">' + esc(t('Заблоковані моделі не показуються програмам і не обслуговуються — навіть якщо акаунт їх має.')) + '</p>' +
          '<div class="input-group" style="margin:10px 0"><input class="input mono" id="stBlIn" placeholder="' + esc(t('назва моделі, наприклад gpt-3.5-turbo')) + '" spellcheck="false" aria-label="' + esc(t('Назва моделі')) + '"><button class="btn" id="stBlAdd">' + ic('ban', 'sm') + esc(t('Заблокувати')) + '</button></div>' +
          '<span class="hint st-msg" id="stBlMsg"></span>' +
          (bl.length ? '<div class="tags" style="margin:6px 0 12px">' + bl.map((m) => '<button class="tag mono" data-unbl="' + esc(m) + '" data-tip="' + esc(t('Розблокувати')) + '">' + ic('ban', 'sm') + esc(m) + ic('x', 'sm') + '</button>').join('') + '</div>'
            : '<div class="hint" style="margin:6px 0 12px">' + esc(t('Список порожній — усі моделі доступні.')) + '</div>') +
          '<div class="row"><button class="btn sm" id="stBlLoad">' + ic('list', 'sm') + esc(catalogue ? t('Оновити весь список ({n})', { n: catalogue.length }) : t('Показати всі моделі')) + '</button>' +
            (catalogue ? '<input class="input" id="stBlFilter" style="flex:1;min-width:160px;height:28px" placeholder="' + esc(t('Пошук моделі…')) + '" value="' + esc(keepQ) + '"><span class="hint" id="stBlShown"></span>' : '') + '</div>' +
          (catalogue ? '<div class="st-cat" id="stBlCat" style="margin-top:10px"></div>' : '');
        const add = (btn) => CL.ui.busy(btn, async () => {
          const v = CL.cleanModel($('#stBlIn').value);
          if (!v) { msg($('#stBlMsg'), t('Впиши назву моделі.'), 'bad'); return; }
          await setBlocked(v, true);
        });
        $('#stBlAdd').addEventListener('click', (e) => add(e.currentTarget));
        $('#stBlIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') add($('#stBlAdd')); });
        box.querySelectorAll('[data-unbl]').forEach((b) => b.addEventListener('click', () => CL.ui.busy(b, () => setBlocked(b.dataset.unbl, false))));
        $('#stBlLoad').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, buildCatalogue));
        if (catalogue) {
          const paintCat = () => {
            const q = $('#stBlFilter').value.trim().toLowerCase();
            const shown = catalogue.filter((m) => !q || m.toLowerCase().includes(q));
            $('#stBlShown').textContent = t('Показано: {n} із {m}', { n: shown.length, m: catalogue.length });
            $('#stBlCat').innerHTML = shown.map((m) => {
              const on = low.has(m.toLowerCase());
              return '<button class="chip ' + (on ? 'bad' : 'outline') + '" data-tbl="' + esc(m) + '" aria-pressed="' + on + '" data-tip="' + esc(t(on ? 'Заблоковано — натисни, щоб розблокувати' : 'Натисни, щоб заблокувати')) + '">' + ic(on ? 'ban' : 'plus', 'sm') + esc(m) + '</button>';
            }).join('') || '<span class="hint">' + esc(t('Нічого не знайдено')) + '</span>';
          };
          $('#stBlFilter').addEventListener('input', paintCat);
          $('#stBlCat').addEventListener('click', (e) => {
            const b = e.target.closest('[data-tbl]');
            if (b) CL.ui.busy(b, () => setBlocked(b.dataset.tbl, !low.has(b.dataset.tbl.toLowerCase())));
          });
          paintCat();
        }
      }
      async function buildCatalogue() {
        const cat = await CL.models(true);
        const fresh = await CL.config.get();
        const r = fresh.routing || {};
        const all = OFFICIAL.concat(cat.flat.map(CL.cleanModel), Object.values(r.tiers || {}), Object.values(r.modelMap || {}), r.defaultModel ? [r.defaultModel] : [], fresh.modelBlacklist || []);
        const seen = new Map();
        all.map((m) => CL.cleanModel(m || '')).filter(Boolean).forEach((m) => { if (!seen.has(m.toLowerCase())) seen.set(m.toLowerCase(), m); });
        catalogue = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
        cfg = fresh;
        if (ctx.alive()) paintBl();
      }
      async function setBlocked(model, on) {
        const fresh = await CL.config.get();
        const cur = fresh.modelBlacklist || [];
        const lowM = model.toLowerCase().trim();
        let next;
        if (on) {
          if (cur.some((x) => String(x).toLowerCase().trim() === lowM)) { cfg = fresh; if (ctx.alive()) { paintBl(); msg($('#stBlMsg'), t('{m} уже в списку.', { m: model }), 'bad'); } return; }
          next = cur.concat([model]);
        } else next = cur.filter((x) => String(x).toLowerCase().trim() !== lowM);
        await CL.config.patch({ modelBlacklist: next });
        CL.models.invalidate();
        cfg = await CL.config.get();
        if (!ctx.alive()) return;
        paintBl();
        CL.toast(on ? t('{m} заблоковано', { m: model }) : t('{m} розблоковано ✓', { m: model }));
      }

      // ===================================================== advanced ==
      let advSnap = '';
      function paintAdv() {
        advSnap = (cfg.cliproxy && cfg.cliproxy.extraConfigYAML) || '';
        $('#stAdv').innerHTML =
          '<div class="field"><label for="stYaml">' + esc(t('Свій config.yaml рушія')) + ' <span class="faint">' + esc(t('для досвідчених')) + '</span></label>' +
          '<textarea class="textarea" id="stYaml" rows="10" spellcheck="false" placeholder="' + esc(t('# сирий YAML, що додається до конфігу рушія')) + '">' + esc(advSnap) + '</textarea>' +
          '<span class="hint">' + esc(t('Додається до конфігу CLIProxyAPI. Ключі, якими керує CarteLink (host, port, api-keys, auth-dir, remote-management та інші), лишаються під його контролем — їх тут буде проігноровано.')) + '</span></div>' +
          '<div class="banner bad hidden" id="stYamlErr" style="margin:10px 0 0">' + ic('alert') + '<div id="stYamlErrT"></div></div>' +
          '<div class="row" style="margin-top:12px"><button class="btn" id="stYamlSave" disabled>' + ic('check', 'sm') + esc(t('Зберегти YAML')) + '</button><span class="hint st-msg" id="stYamlMsg"></span></div>';
        const ta = $('#stYaml');
        ta.addEventListener('input', () => { $('#stYamlSave').disabled = ta.value === advSnap; });
        $('#stYamlSave').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          $('#stYamlErr').classList.add('hidden');
          btn.classList.add('busy');
          btn.disabled = true;
          try {
            await CL.config.patch({ cliproxy: { extraConfigYAML: ta.value } });
            advSnap = ta.value;
            msg($('#stYamlMsg'), t('Збережено ✓ — рушій підхопить зміни сам.'), 'ok');
          } catch (er) {
            $('#stYamlErrT').textContent = t('YAML не збережено: {e}. Перевір відступи й двокрапки.', { e: er.message });
            $('#stYamlErr').classList.remove('hidden');
          } finally {
            btn.classList.remove('busy');
            btn.disabled = ta.value === advSnap;
          }
        });
      }

      // ===================================================== diagnostics ==
      async function paintDiag(s) {
        const st = CL.status || (await CL.loadStatus().catch(() => null)) || {};
        const eng = st.engine || {};
        const home = (s && s.home) || '';
        $('#stDiag').innerHTML =
          '<dl class="kv">' +
            '<dt>' + esc(t('Версія CarteLink')) + '</dt><dd class="mono">' + esc(st.version || '—') + '</dd>' +
            '<dt>' + esc(t('Рушій CLIProxyAPI')) + '</dt><dd class="mono">' + esc(eng.version || '—') + (eng.lastError ? ' <span class="chip bad" data-tip="' + esc(eng.lastError) + '">' + esc(t('помилка')) + '</span>' : '') + '</dd>' +
            '<dt>' + esc(t('Папка даних')) + '</dt><dd><div class="row nw"><span class="mono ellipsis grow" title="' + esc(home) + '">' + esc(home || '—') + '</span>' +
              (home ? '<button class="btn sm icon ghost" data-copy="' + esc(home) + '" data-tip="Копіювати" aria-label="' + esc(t('Копіювати')) + '">' + ic('copy', 'sm') + '</button>' : '') + '</div></dd>' +
          '</dl>' +
          '<div class="row" style="margin:12px 0 16px"><button class="btn sm" data-open="data">' + ic('folder', 'sm') + esc(t('Відкрити папку')) + '</button><button class="btn sm" data-open="logs">' + ic('folder', 'sm') + esc(t('Відкрити логи')) + '</button></div>' +
          '<div class="row" style="margin-bottom:8px"><span class="label grow">' + esc(t('Журнал рушія — останні 300 рядків')) + '</span>' +
            '<button class="btn sm ghost" id="stLogRe">' + ic('rotate', 'sm') + esc(t('Оновити')) + '</button><button class="btn sm ghost" id="stLogCopy">' + ic('copy', 'sm') + esc(t('Копіювати')) + '</button></div>' +
          '<pre class="code st-log" id="stLog" tabindex="0" aria-label="app.log">' + esc(t('Завантаження…')) + '</pre>' +
          '<div class="hint" id="stLogPath" style="margin-top:6px"></div>' +
          '<div class="sep"></div>' +
          '<div class="row"><div class="grow"><b>' + esc(t('Вийти з CarteLink')) + '</b><div class="hint">' + esc(t('Шлюз зупиниться, програми втратять доступ до моделей.')) + '</div></div><button class="btn danger" id="stQuit">' + ic('power', 'sm') + esc(t('Вийти')) + '</button></div>';
        $('#stDiag').querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => CL.ui.busy(b, () => CL.api.post('/app/open', { what: b.dataset.open }))));
        $('#stLogRe').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, loadLog));
        $('#stLogCopy').addEventListener('click', () => CL.copy($('#stLog').textContent, 'Журнал скопійовано'));
        $('#stQuit').addEventListener('click', async () => {
          if (!(await CL.confirm('Вийти з CarteLink? Шлюз зупиниться, і програми не зможуть звертатися до моделей, доки не запустиш його знову.', { danger: true, ok: 'Вийти' }))) return;
          try { await CL.api.post('/app/quit'); CL.toast('CarteLink закривається…', 'info'); } catch (e) { CL.fail(e); }
        });
        loadLog();
      }
      let logText = '';
      async function loadLog() {
        let r;
        try { r = await CL.api.get('/logs?lines=300'); } catch (e) {
          if (ctx.alive()) $('#stLog').textContent = t('Не вдалось прочитати журнал: {e}', { e: e.message });
          return;
        }
        if (!ctx.alive()) return;
        const el = $('#stLog');
        const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 30 || !logText;
        logText = r.text || '';
        el.textContent = logText || t('Журнал порожній.');
        if (atEnd) el.scrollTop = el.scrollHeight;
        $('#stLogPath').textContent = r.path ? t('Файл: {p}', { p: r.path }) : '';
      }

      // ========================================================== load ==
      try { cfg = await CL.config.get(); } catch (e) {
        ['#stGw', '#stBl', '#stAdv'].forEach((s) => { $(s).innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Не вдалось прочитати налаштування: {e}. Перезапусти CarteLink, якщо це повторюється.', { e: e.message })) + '</div></div>'; });
        const s = await loadApp();
        paintDiag(s);
        return;
      }
      if (!ctx.alive()) return;
      paintGw();
      paintBl();
      paintAdv();
      paintNotify();
      paintBackup();
      const s = await loadApp();
      if (!ctx.alive()) return;
      paintDiag(s);

      // Changed elsewhere: refresh what isn't being edited.
      ctx.on('changed', async (w) => {
        if (w !== 'config') return;
        let fresh;
        try { fresh = await CL.config.get(); } catch (e) { return; }
        if (!ctx.alive()) return;
        cfg = fresh;
        if (!gwDirty() && !root.querySelector('#stGw').contains(document.activeElement)) fillGw(); else paintXKeys();
        if (!root.querySelector('#stBl').contains(document.activeElement)) paintBl();
        const ta = $('#stYaml');
        if (ta && ta.value === advSnap && document.activeElement !== ta) paintAdv();
      });
    },
  });
})();
