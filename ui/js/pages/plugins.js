'use strict';
// Плагіни: the whole engine plugin store — install, update, turn on/off,
// remove, open a plugin's console. Sign-in for provider plugins happens on
// the Accounts page (its picker); helpers come from window.CL_PLUGINS.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const enc = encodeURIComponent;

  CL.page('plugins', {
    title: 'Плагіни', icon: 'puzzle', group: 'manage', order: 80,

    async render(root, ctx) {
      const P = window.CL_PLUGINS;
      if (!P || !P.loadStore) {
        root.innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Модуль плагінів не завантажився. Перезапусти CarteLink; якщо не допоможе — перевстанови програму.')) + '</div></div>';
        return;
      }
      const STYLE = '<style>' +
        '.plg-page .plg-row{display:flex;gap:14px;align-items:flex-start;padding:14px 2px;border-bottom:var(--border-w) solid var(--line)}' +
        '.plg-page .plg-row:last-child{border-bottom:0}' +
        '.plg-page .plg-main{flex:1;min-width:0}' +
        '.plg-page .plg-desc{color:var(--text-2);font-size:12.5px;margin-top:4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}' +
        '.plg-page .plg-btns{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;flex:none;max-width:48%}' +
        '@media (max-width:760px){.plg-page .plg-row{flex-direction:column}.plg-page .plg-btns{max-width:none;justify-content:flex-start}}' +
        '</style>';
      root.classList.add('plg-page');
      root.innerHTML = STYLE +
        '<div class="blocks" data-area="plugins">' +
        '<section class="block card" data-block="store" data-w="12" data-title="Магазин плагінів">' +
          '<div class="card-h"><div class="card-icon">' + ic('puzzle') + '</div><h2>' + esc(t('Магазин плагінів')) + '</h2><span class="chip" id="pgCount">—</span><span class="sub" id="pgInstalled"></span><span class="grow"></span>' +
            '<button class="btn sm ghost" id="pgRefresh">' + ic('rotate', 'sm') + esc(t('Оновити')) + '</button></div>' +
          '<div class="banner">' + ic('shield') + '<div class="small">' + esc(t('Плагіни — це сторонній код із GitHub. Він працює всередині CarteLink з повним доступом. Вхід через плагін зазвичай неофіційний і може порушувати умови сервісу, тому для нових сервісів краще брати окремий акаунт.')) + '</div></div>' +
          '<div class="row" style="margin-bottom:6px">' +
            '<div class="grow" style="min-width:220px;max-width:420px"><input class="input" id="pgSearch" type="search" placeholder="' + esc(t('Пошук плагіна: назва, опис, тег…')) + '"></div>' +
            CL.ui.seg('pgFilter', [['all', 'Усі'], ['services', 'Сервіси'], ['tools', 'Інструменти'], ['installed', 'Встановлені']], 'all') +
          '</div>' +
          '<div id="pgList">' + CL.ui.skeleton(6) + '</div>' +
        '</section>' +
        '</div>';

      const $ = (s) => root.querySelector(s);
      let filter = 'all';
      let query = '';
      let err = '';

      const isService = (p) => P.isProvider(p) || !!P.serviceOf(p.id);

      function paint() {
        if (!ctx.alive()) return;
        const box = $('#pgList');
        if (!P.store) {
          if (err) {
            box.innerHTML = '<div class="banner bad">' + ic('alert') + '<div class="grow">' + esc(t('Не вдалось завантажити магазин плагінів: {e}', { e: err })) + '<div class="small muted">' + esc(t('Магазин береться з GitHub — перевір інтернет і чи працює шлюз, потім натисни «Оновити».')) + '</div></div></div>';
          }
          return;
        }
        const all = Object.values(P.store);
        const q = query.toLowerCase();
        const items = all.filter((p) => {
          const svc = isService(p);
          if (filter === 'services' && !svc) return false;
          if (filter === 'tools' && svc) return false;
          if (filter === 'installed' && !P.onDisk(p)) return false;
          return !q || (p.id + ' ' + p.name + ' ' + p.description + ' ' + p.tags.join(' ')).toLowerCase().includes(q);
        }).sort((a, b) => a.name.localeCompare(b.name));
        $('#pgCount').textContent = String(items.length);
        const inst = all.filter(P.onDisk).length;
        $('#pgInstalled').textContent = inst ? t('встановлено: {n}', { n: inst }) : '';
        if (!items.length) {
          box.innerHTML = CL.ui.empty('search', 'Нічого не знайдено', filter === 'installed' && !q ? 'Ще жоден плагін не встановлено.' : 'Зміни пошук або фільтр.');
          return;
        }
        box.innerHTML = '<div>' + items.map((p) => {
          const svc = P.serviceOf(p.id);
          const onDisk = P.onDisk(p);
          const noBuild = P.noBuild(p.id);
          const b = [];
          if (svc && !noBuild) b.push('<button class="btn sm primary" data-act="connect" data-id="' + esc(p.id) + '">' + ic('login', 'sm') + esc(t('Підключити')) + '</button>');
          if (!svc && !onDisk && !noBuild) b.push('<button class="btn sm primary" data-act="install" data-id="' + esc(p.id) + '">' + ic('download', 'sm') + esc(t('Встановити')) + '</button>');
          if (onDisk) {
            if (p.update) b.push('<button class="btn sm" data-act="update" data-id="' + esc(p.id) + '">' + ic('rotate', 'sm') + esc(t('Оновити')) + '</button>');
            if (p.registered && p.enabled) b.push('<button class="btn sm" data-act="console" data-id="' + esc(p.id) + '">' + ic('external', 'sm') + esc(t('Консоль')) + '</button>');
            b.push('<button class="btn sm" data-act="toggle" data-id="' + esc(p.id) + '">' + ic(p.enabled ? 'power' : 'play', 'sm') + esc(t(p.enabled ? 'Вимкнути' : 'Увімкнути')) + '</button>');
            b.push('<button class="btn sm icon danger" data-act="remove" data-id="' + esc(p.id) + '" data-tip="Видалити плагін" aria-label="' + esc(t('Видалити плагін {name}', { name: p.name })) + '">' + ic('trash', 'sm') + '</button>');
          }
          const note = P.PLUGIN_NOTES && P.PLUGIN_NOTES[p.id];
          return '<div class="plg-row"><span class="avatar">' + esc(p.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?') + '</span><div class="plg-main">' +
            '<div class="row" style="gap:8px"><b>' + esc(p.name) + '</b>' + (svc ? '<span class="chip outline">' + esc(t('сервіс: {s}', { s: svc.label })) + '</span>' : '') + P.chips(p) + '</div>' +
            (p.description ? '<div class="plg-desc" title="' + esc(p.description) + '">' + esc(p.description) + '</div>' : '') +
            (note ? '<div class="small" style="margin-top:4px;color:var(--warn)">' + esc(t(note)) + '</div>' : '') +
            '<div class="small faint" style="margin-top:5px">' + P.meta(p) + (p.tags.length ? ' · ' + esc(p.tags.join(', ')) : '') + '</div>' +
            '</div><div class="plg-btns">' + b.join('') + '</div></div>';
        }).join('') + '</div>';
      }

      async function load(force) {
        try { await P.loadStore(force); err = ''; } catch (e) { err = e.message; }
        paint();
      }

      async function act(btn) {
        const id = btn.dataset.id;
        const kind = btn.dataset.act;
        const p = (P.store || {})[id];
        if (!p) return;
        if (kind === 'connect') {
          const svc = P.serviceOf(id);
          if (!svc) return;
          try { sessionStorage.setItem('cl.openPicker', JSON.stringify({ svc: svc.id, plugin: id })); } catch (e) { /* fall back below */ }
          CL.go('accounts');
          // If storage is blocked, ask the Accounts page directly once it has rendered.
          let stored = false;
          try { stored = !!sessionStorage.getItem('cl.openPicker'); } catch (e) { stored = false; }
          if (!stored && CL.accountsOpenPicker) setTimeout(() => CL.accountsOpenPicker(svc.id, id), 400);
          return;
        }
        if (kind === 'remove') {
          if (await P.remove(id)) paint();
          return;
        }
        await CL.ui.busy(btn, async () => {
          try {
            if (kind === 'install') {
              CL.toast(t('Завантажую плагін {name}…', { name: p.name }), 'info');
              await P.ensure(id, p.name);
              await P.safeConfig(id);
              CL.toast(t('Плагін {name} встановлено ✓', { name: p.name }));
            } else if (kind === 'update') {
              CL.toast(t('Завантажую плагін {name}…', { name: p.name }), 'info');
              await CL.mgmt('POST', 'plugin-store/' + enc(id) + '/install', {});
              CL.toast(t('Плагін {name} оновлено ✓', { name: p.name }));
            } else if (kind === 'console') {
              const info = await P.info(id);
              if (info.menus && info.menus.length) window.open(P.consoleUrl(id, info), '_blank');
              else CL.toast(t('У плагіна {name} немає своєї консолі', { name: p.name }), 'info');
              return;
            } else if (kind === 'toggle') {
              await CL.mgmt('PATCH', 'plugins/' + enc(id) + '/enabled', { enabled: !p.enabled });
              CL.toast(t(p.enabled ? 'Плагін {name} вимкнено ✓' : 'Плагін {name} увімкнено ✓', { name: p.name }));
              await CL.sleep(1500);
            }
          } catch (e) {
            if (!(e && e.cancelled)) CL.toast(P.errorText(e), 'bad');
          }
          CL.models.invalidate();
          await load(true);
        });
      }

      $('#pgList').addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b) act(b); });
      $('#pgSearch').addEventListener('input', CL.debounce((e) => { query = e.target.value.trim(); paint(); }, 120));
      CL.ui.onSeg($('#pgFilter'), (v) => { filter = v; paint(); });
      $('#pgRefresh').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => load(true)));
      ctx.on('plugins', () => paint());

      await load(false);
    },
  });
})();
