'use strict';
// Look and layout: themes, the custom theme editor, background effects,
// interface toggles, and edit mode (drag, resize, hide any block or nav item).
// Saved in config.json (PUT /api/ui-prefs) and mirrored in localStorage so
// the window never flashes the wrong theme at start.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  // The designs themselves register in ui/js/designs/*.js (CL.design).
  const designList = () => CL.designOrder.map((id) => CL.designs[id]);

  // Tokens the custom theme editor exposes.
  const EDIT_VARS = [
    ['--bg', 'Фон'], ['--bg-2', 'Бокова панель'], ['--surface', 'Картки'], ['--surface-2', 'Поля й кнопки'], ['--surface-3', 'Підсвічування'],
    ['--line', 'Лінії'], ['--line-strong', 'Рамки полів'], ['--text', 'Текст'], ['--text-2', 'Другорядний текст'], ['--text-3', 'Підписи'],
    ['--accent', 'Акцент'], ['--accent-ink', 'Текст на акценті'], ['--ok', 'Успіх'], ['--warn', 'Попередження'], ['--bad', 'Помилка'], ['--info', 'Інформація'],
  ];
  const FONTS = [
    ['', 'Системний'], ['"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif', 'Segoe UI'], ['"Bahnschrift", "DIN Alternate", sans-serif', 'Bahnschrift'],
    ['"Helvetica Neue", Arial, sans-serif', 'Helvetica'], ['Georgia, "Times New Roman", serif', 'Georgia'], ['"Cascadia Mono", Consolas, monospace', 'Cascadia Mono'],
    ['"Trebuchet MS", sans-serif', 'Trebuchet'], ['Verdana, sans-serif', 'Verdana'],
  ];

  /** Interface elements the user can turn off (Settings → Інтерфейс). */
  const TOGGLES = [
    ['statusPill', 'Статус шлюзу вгорі'],
    ['cmdk', 'Кнопка пошуку й команд'],
    ['editBtn', 'Кнопка «Налаштувати вигляд»'],
    ['navGroups', 'Заголовки груп у меню'],
    ['navBadges', 'Лічильники в меню'],
    ['sideVersion', 'Версія внизу меню'],
    ['brand', 'Логотип у меню'],
    ['toasts', 'Спливаючі повідомлення про успіх'],
    ['tips', 'Підказки при наведенні'],
  ];

  const DEFAULT = {
    theme: 'graphite', custom: { base: 'graphite', vars: {}, font: '', radius: null, glass: false },
    density: 'normal', motion: 'full', fontScale: 100, fx: true, navCompact: false,
    nav: { order: [], hidden: [] }, layout: {}, hide: {},
  };
  let P = JSON.parse(JSON.stringify(DEFAULT));

  function merge(base, over) {
    const out = JSON.parse(JSON.stringify(base));
    Object.keys(over || {}).forEach((k) => {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && out[k] && typeof out[k] === 'object') out[k] = merge(out[k], over[k]);
      else out[k] = over[k];
    });
    return out;
  }

  const look = (CL.look = { TOGGLES, FONTS, EDIT_VARS });
  Object.defineProperty(look, 'THEMES', { get: designList });
  look.prefs = () => P;

  // -------------------------------------------------------------- store --

  try { P = merge(DEFAULT, JSON.parse(localStorage.getItem('cl.prefs') || '{}')); } catch (e) { /* defaults */ }

  const pushServer = CL.debounce(() => { CL.api.put('/ui-prefs', P).catch(() => {}); }, 600);
  function saveLocal() {
    try {
      localStorage.setItem('cl.prefs', JSON.stringify(P));
      localStorage.setItem('cl.look', JSON.stringify({ theme: P.theme === 'custom' ? P.custom.base : P.theme, vars: P.theme === 'custom' ? P.custom.vars : {} }));
    } catch (e) { /* private mode */ }
  }
  look.save = () => {
    try {
      localStorage.setItem('cl.prefs', JSON.stringify(P));
      localStorage.setItem('cl.look', JSON.stringify({ theme: P.theme === 'custom' ? P.custom.base : P.theme, vars: P.theme === 'custom' ? P.custom.vars : {} }));
    } catch (e) { /* private mode */ }
    pushServer();
  };
  look.set = (patch) => { P = merge(P, patch); look.apply(); look.save(); };

  /** The server copy wins at start (localStorage is per port). */
  look.load = async () => {
    try {
      const r = await CL.api.get('/ui-prefs');
      if (r && r.prefs && Object.keys(r.prefs).length) { P = merge(DEFAULT, r.prefs); saveLocal(); }
      else look.save();
    } catch (e) { /* keep local */ }
    look.apply();
  };

  // -------------------------------------------------------------- apply --

  const root = document.documentElement;
  let appliedVars = [];
  let lastFx = '';
  let lastDesign = null;
  look.apply = () => {
    let theme = P.theme === 'custom' ? P.custom.base || 'graphite' : P.theme;
    if (!CL.designs || !CL.designs[theme]) theme = 'graphite';
    const design = (CL.designs && CL.designs[theme]) || {};
    if (theme !== 'graphite') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    root.setAttribute('data-shell', design.shell || 'sidebar');
    root.setAttribute('data-mode', design.mode || 'dark');
    if (lastDesign !== null && lastDesign !== theme) queueMicrotask(() => CL.emit('design', theme));
    lastDesign = theme;
    appliedVars.forEach((k) => root.style.removeProperty(k));
    appliedVars = [];
    const setVar = (k, v) => { root.style.setProperty(k, v); appliedVars.push(k); };
    if (P.theme === 'custom') {
      Object.entries(P.custom.vars || {}).forEach(([k, v]) => { if (v) setVar(k, v); });
      if (P.custom.vars && P.custom.vars['--accent']) setVar('--accent-soft', 'color-mix(in srgb, ' + P.custom.vars['--accent'] + ' 14%, transparent)');
      if (P.custom.font) { setVar('--font', P.custom.font); setVar('--font-display', P.custom.font); }
      if (P.custom.radius != null) { setVar('--radius', P.custom.radius + 'px'); setVar('--radius-sm', Math.max(0, P.custom.radius - 3) + 'px'); setVar('--radius-lg', P.custom.radius + 4 + 'px'); }
      if (P.custom.glass) { setVar('--glass', 'blur(20px) saturate(1.3)'); setVar('--surface-alpha', '0.6'); }
    }
    setVar('--fs', (13.5 * (P.fontScale || 100) / 100).toFixed(2) + 'px');
    const b = document.body;
    if (!b) return;
    b.classList.toggle('dense', P.density === 'dense');
    b.classList.toggle('roomy', P.density === 'roomy');
    b.classList.toggle('motion-off', P.motion === 'off');
    b.classList.toggle('motion-force', P.motion === 'full-force');
    root.style.setProperty('--t', P.motion === 'reduced' ? '0.55' : '1');
    b.classList.toggle('nav-compact', !!P.navCompact);
    TOGGLES.forEach(([k]) => b.classList.toggle('hide-' + k, !!P.hide[k]));
    // The background is rebuilt only when what it depends on changes (a text
    // size slider or a colour picker must not restart it).
    const fxSig = [theme, P.fx, P.motion].join('|');
    if (fxSig !== lastFx) { lastFx = fxSig; fx(); }
  };

  // ------------------------------------------------- background effects --

  let fxStop = null;
  function fx() {
    const host = CL.$('#fx');
    if (!host) return;
    if (fxStop) { fxStop(); fxStop = null; }
    host.innerHTML = '';
    const theme = P.theme === 'custom' ? P.custom.base : P.theme;
    if (!P.fx) return;
    // Motion off or reduced: the design draws one still frame.
    const reduce = P.motion === 'off' || (matchMedia('(prefers-reduced-motion: reduce)').matches && P.motion !== 'full-force');
    const design = (CL.designs && CL.designs[theme]) || CL.designs.graphite;
    if (design && design.fx) {
      try { fxStop = design.fx(host, reduce) || null; } catch (e) { console.error(e); }
    }
  }

  // Datamatics: a field of hairline bars at the bottom edge, stepping frames
  // from a seeded sequence; a sine trace runs through it. Frozen when reduced.
  look.barcode = (host, still) => barcode(host, still);
  function barcode(host, still) {
    const c = document.createElement('canvas');
    host.appendChild(c);
    const ctx = c.getContext('2d');
    let raf = 0;
    let frame = 0;
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = (c.width = Math.floor(innerWidth * dpr));
      const h = (c.height = Math.floor(innerHeight * dpr));
      ctx.clearRect(0, 0, w, h);
      seed = 7 + (frame >> 3);
      const band = Math.floor(h * 0.16);
      const y0 = h - band;
      let x = 0;
      ctx.fillStyle = '#fff';
      while (x < w) {
        const bw = Math.max(1, Math.floor(rnd() * 3 * dpr));
        if (rnd() > 0.55) ctx.globalAlpha = 0.07 + rnd() * 0.16, ctx.fillRect(x, y0 + Math.floor(rnd() * band * 0.5), bw, band);
        x += bw + Math.floor(rnd() * 5 * dpr);
      }
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      for (let i = 0; i <= w; i += 4 * dpr) {
        const y = y0 - band * 0.6 + Math.sin(i / (90 * dpr) + frame / 40) * band * 0.25;
        if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    const loop = () => { frame++; if (frame % 2 === 0) draw(); raf = requestAnimationFrame(loop); };
    draw();
    if (!still) raf = requestAnimationFrame(loop);
    const onR = () => draw();
    addEventListener('resize', onR);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onR); };
  }

  // -------------------------------------------------------------- layout --

  function areaPrefs(area) {
    P.layout[area] = P.layout[area] || { order: [], hidden: [], w: {} };
    const a = P.layout[area];
    a.order = a.order || []; a.hidden = a.hidden || []; a.w = a.w || {};
    return a;
  }

  /** Arrange every .blocks[data-area] inside root per the user's layout. */
  look.applyLayout = (scope) => {
    (scope || document).querySelectorAll('.blocks[data-area]').forEach((box) => {
      const area = box.dataset.area;
      const a = areaPrefs(area);
      const blocks = Array.from(box.children).filter((b) => b.dataset && b.dataset.block);
      const idx = (id) => { const i = a.order.indexOf(id); return i < 0 ? 1000 + blocks.findIndex((b) => b.dataset.block === id) : i; };
      blocks.sort((x, y) => idx(x.dataset.block) - idx(y.dataset.block)).forEach((b, i) => {
        box.appendChild(b);
        b.style.setProperty('--k', i);
        if (!b.dataset.w0) b.dataset.w0 = b.dataset.w || '12';
        b.dataset.w = a.w[b.dataset.block] || b.dataset.w0;
        b.classList.toggle('hidden', a.hidden.includes(b.dataset.block));
        if (!b.querySelector(':scope > .block-tools')) b.insertAdjacentHTML('afterbegin', toolsHTML());
      });
      tray(box);
    });
  };

  function toolsHTML() {
    return '<div class="block-tools"><button data-act="narrow" data-tip="' + esc(t('Вужче')) + '">' + ic('minus', 'sm') + '</button>' +
      '<button data-act="wide" data-tip="' + esc(t('Ширше')) + '">' + ic('plus', 'sm') + '</button>' +
      '<button data-act="hide" data-tip="' + esc(t('Сховати блок')) + '">' + ic('eyeoff', 'sm') + '</button></div>';
  }

  // Hidden blocks wait in a tray above the grid while editing.
  function tray(box) {
    let tr = box.previousElementSibling;
    if (!tr || !tr.classList.contains('hidden-tray')) {
      tr = CL.el('<div class="hidden-tray"></div>');
      box.parentNode.insertBefore(tr, box);
    }
    const a = areaPrefs(box.dataset.area);
    const hidden = Array.from(box.children).filter((b) => b.dataset.block && a.hidden.includes(b.dataset.block));
    tr.innerHTML = document.body.classList.contains('editing') && hidden.length
      ? '<span class="small muted" style="align-self:center">' + esc(t('Сховані блоки:')) + '</span>' + hidden.map((b) => '<button class="btn sm" data-show="' + esc(b.dataset.block) + '">' + ic('eye', 'sm') + esc(t(b.dataset.title || b.dataset.block)) + '</button>').join('')
      : '';
    tr.onclick = (e) => {
      const s = e.target.closest('[data-show]');
      if (!s) return;
      a.hidden = a.hidden.filter((x) => x !== s.dataset.show);
      look.save();
      look.applyLayout(box.parentNode);
    };
  }

  const WIDTHS = [3, 4, 5, 6, 7, 8, 9, 12];
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.block-tools button');
    if (!b) return;
    const block = b.closest('.block');
    const box = block.parentNode;
    const a = areaPrefs(box.dataset.area);
    const id = block.dataset.block;
    if (b.dataset.act === 'hide') {
      a.hidden = Array.from(new Set(a.hidden.concat(id)));
    } else {
      const cur = Number(block.dataset.w || 12);
      let i = WIDTHS.indexOf(cur);
      if (i < 0) i = WIDTHS.length - 1;
      i = Math.max(0, Math.min(WIDTHS.length - 1, i + (b.dataset.act === 'wide' ? 1 : -1)));
      a.w[id] = String(WIDTHS[i]);
    }
    look.save();
    look.applyLayout(box.parentNode);
  });

  // Drag and drop (blocks within their grid, nav items within the menu).
  let drag = null;
  document.addEventListener('dragstart', (e) => {
    if (!document.body.classList.contains('editing')) return;
    const el = e.target.closest && e.target.closest('.block, .nav-item');
    if (!el) return;
    drag = el;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', el.dataset.block || el.dataset.page || ''); } catch (er) { /* ignore */ }
  });
  document.addEventListener('dragover', (e) => {
    if (!drag) return;
    const over = e.target.closest && e.target.closest(drag.classList.contains('block') ? '.block' : '.nav-item');
    document.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    if (!over || over === drag || over.parentNode !== drag.parentNode && !drag.classList.contains('nav-item')) return;
    e.preventDefault();
    const r = over.getBoundingClientRect();
    const after = drag.classList.contains('block') ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    over.classList.add(after ? 'drop-after' : 'drop-before');
  });
  document.addEventListener('drop', (e) => {
    if (!drag) return;
    const tgt = document.querySelector('.drop-before,.drop-after');
    if (tgt) {
      e.preventDefault();
      const after = tgt.classList.contains('drop-after');
      tgt.parentNode.insertBefore(drag, after ? tgt.nextSibling : tgt);
      if (drag.classList.contains('block')) {
        const box = drag.parentNode;
        areaPrefs(box.dataset.area).order = Array.from(box.children).filter((b) => b.dataset.block).map((b) => b.dataset.block);
      } else {
        P.nav.order = Array.from(document.querySelectorAll('#nav .nav-item')).map((n) => n.dataset.page);
        // A nav item dropped into another group changes group.
        P.nav.groups = P.nav.groups || {};
        P.nav.groups[drag.dataset.page] = drag.closest('.nav-group') ? drag.closest('.nav-group').dataset.group : undefined;
      }
      look.save();
    }
    end();
  });
  document.addEventListener('dragend', end);
  function end() {
    if (drag) drag.classList.remove('dragging');
    drag = null;
    document.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  }

  // ----------------------------------------------------------- edit mode --

  look.editing = () => document.body.classList.contains('editing');
  look.toggleEdit = (on) => {
    const b = document.body;
    on = on === undefined ? !b.classList.contains('editing') : on;
    b.classList.toggle('editing', on);
    document.querySelectorAll('.block, .nav-item').forEach((el) => { el.draggable = on; });
    document.querySelectorAll('.blocks[data-area]').forEach((box) => tray(box));
    let bar = CL.$('#editbar');
    if (on && !bar) {
      bar = CL.el('<div class="editbar" id="editbar"><span>' + ic('layout') + ' ' + esc(t('Режим налаштування: перетягуй блоки й пункти меню, міняй ширину, ховай зайве.')) + '</span>' +
        '<button class="btn sm ghost" id="editReset">' + ic('restore', 'sm') + esc(t('Скинути цю сторінку')) + '</button>' +
        '<button class="btn sm primary" id="editDone">' + ic('check', 'sm') + esc(t('Готово')) + '</button></div>');
      document.body.appendChild(bar);
      bar.querySelector('#editDone').onclick = () => look.toggleEdit(false);
      bar.querySelector('#editReset').onclick = async () => {
        if (!(await CL.confirm('Повернути розташування блоків цієї сторінки як було спочатку?'))) return;
        document.querySelectorAll('#viewInner .blocks[data-area]').forEach((box) => { delete P.layout[box.dataset.area]; });
        look.save();
        CL.shell && CL.shell.rerender();
      };
    } else if (!on && bar) bar.remove();
    CL.emit('editmode', on);
  };

  // -------------------------------------------------------- theme editor --

  /** The custom theme editor: starts from a theme, every token editable live. */
  look.openEditor = () => {
    const base = P.theme === 'custom' ? P.custom.base : P.theme;
    const start = P.theme === 'custom' ? JSON.parse(JSON.stringify(P.custom)) : { base, vars: {}, font: '', radius: null, glass: false };
    const read = (k) => getComputedStyle(root).getPropertyValue(k).trim();
    const toHex = (v) => {
      const c = document.createElement('canvas').getContext('2d');
      c.fillStyle = '#000';
      c.fillStyle = v || '#000';
      return c.fillStyle.startsWith('#') ? c.fillStyle : '#000000';
    };
    let draft = start;
    const preview = () => { P.theme = 'custom'; P.custom = draft; look.apply(); };
    const rows = EDIT_VARS.map(([k, label]) => {
      const v = toHex(draft.vars[k] || read(k));
      return '<div class="color-row"><span>' + esc(t(label)) + '</span><input type="color" data-k="' + k + '" value="' + v + '"><input class="input mono" data-hex="' + k + '" value="' + v + '" style="height:28px"></div>';
    }).join('');
    CL.dialog({
      title: 'Свій дизайн',
      wide: true,
      sticky: true,
      html: '<div class="cols-2"><div><div class="field" style="margin-bottom:12px"><label>' + esc(t('Основа')) + '</label><select class="select" id="edBase">' + designList().map((x) => '<option value="' + x.id + '"' + (x.id === draft.base ? ' selected' : '') + '>' + esc(t(x.name)) + '</option>').join('') + '</select></div>' + rows + '</div>' +
        '<div class="stack"><div class="field"><label>' + esc(t('Шрифт')) + '</label><select class="select" id="edFont">' + FONTS.map(([v, n]) => '<option value="' + esc(v) + '"' + (v === (draft.font || '') ? ' selected' : '') + '>' + esc(t(n)) + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>' + esc(t('Заокруглення кутів')) + ' <span class="faint" id="edRv"></span></label><input type="range" min="0" max="24" id="edRadius" value="' + (draft.radius == null ? parseInt(read('--radius'), 10) || 10 : draft.radius) + '"></div>' +
        '<div class="setting"><div class="grow"><b>' + esc(t('Скло')) + '</b><span>' + esc(t('Напівпрозорі картки з розмиттям фону')) + '</span></div>' + CL.ui.switch('edGlass', draft.glass) + '</div>' +
        '<div class="card inset"><div class="row"><span class="chip ok">' + esc(t('активний')) + '</span><span class="chip warn">' + esc(t('ліміт')) + '</span><span class="chip bad">' + esc(t('помилка')) + '</span></div><div class="row" style="margin-top:12px"><button class="btn primary sm">' + esc(t('Головна дія')) + '</button><button class="btn sm">' + esc(t('Звичайна')) + '</button></div>' + CL.ui.bar(64) + '</div>' +
        '<div class="row"><button class="btn sm" id="edExport">' + ic('download', 'sm') + esc(t('Експорт')) + '</button><button class="btn sm" id="edImport">' + ic('upload', 'sm') + esc(t('Імпорт')) + '</button><button class="btn sm ghost" id="edClear">' + ic('restore', 'sm') + esc(t('Скинути кольори')) + '</button></div>' +
        '<p class="hint">' + esc(t('Зміни видно одразу. «Зберегти» робить цей дизайн твоїм; «Скасувати» повертає попередній.')) + '</p></div></div>',
      actions: [{ label: 'Скасувати', value: false }, { label: 'Зберегти дизайн', kind: 'primary', value: true }],
      onMount: (d) => {
        const sync = (k, v) => { draft.vars[k] = v; d.querySelector('[data-k="' + k + '"]').value = v; d.querySelector('[data-hex="' + k + '"]').value = v; preview(); };
        d.querySelectorAll('input[type=color]').forEach((inp) => inp.addEventListener('input', () => sync(inp.dataset.k, inp.value)));
        d.querySelectorAll('[data-hex]').forEach((inp) => inp.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(inp.value.trim())) sync(inp.dataset.hex, inp.value.trim()); }));
        d.querySelector('#edBase').addEventListener('change', (e) => {
          draft.base = e.target.value;
          draft.vars = {};
          preview();
          requestAnimationFrame(() => d.querySelectorAll('input[type=color]').forEach((inp) => { const v = toHex(read(inp.dataset.k)); inp.value = v; d.querySelector('[data-hex="' + inp.dataset.k + '"]').value = v; }));
        });
        d.querySelector('#edFont').addEventListener('change', (e) => { draft.font = e.target.value; preview(); });
        const rv = d.querySelector('#edRv');
        const rr = d.querySelector('#edRadius');
        const showR = () => { rv.textContent = rr.value + 'px'; };
        showR();
        rr.addEventListener('input', () => { draft.radius = Number(rr.value); showR(); preview(); });
        d.querySelector('#edGlass').addEventListener('change', (e) => { draft.glass = e.target.checked; preview(); });
        d.querySelector('#edClear').onclick = () => { draft.vars = {}; draft.font = ''; draft.radius = null; draft.glass = false; preview(); };
        d.querySelector('#edExport').onclick = () => {
          const blob = new Blob([JSON.stringify({ cartelinkTheme: 1, ...draft }, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'cartelink-theme.json';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        };
        d.querySelector('#edImport').onclick = () => {
          const f = document.createElement('input');
          f.type = 'file';
          f.accept = '.json,application/json';
          f.onchange = async () => {
            try {
              const j = JSON.parse(await f.files[0].text());
              if (!j || typeof j.vars !== 'object') throw new Error(t('це не файл теми CarteLink'));
              draft = { base: designList().some((x) => x.id === j.base) ? j.base : 'graphite', vars: j.vars, font: j.font || '', radius: j.radius == null ? null : Number(j.radius), glass: !!j.glass };
              preview();
              CL.toast('Тему імпортовано — натисни «Зберегти дизайн»');
            } catch (e) { CL.fail(e); }
          };
          f.click();
        };
        preview();
      },
    }).then((ok) => {
      if (ok) { P.theme = 'custom'; P.custom = draft; look.save(); look.apply(); CL.toast('Свій дизайн збережено ✓'); CL.api.put('/app/settings', { theme: 'custom' }).catch(() => {}); }
      else { const saved = JSON.parse(localStorage.getItem('cl.prefs') || '{}'); P = merge(DEFAULT, saved); look.apply(); }
      CL.emit('look');
    });
  };

  look.setTheme = (id) => {
    const go = () => {
      root.classList.add('theme-swap');
      P.theme = id;
      look.apply();
      look.save();
      CL.emit('look');
      setTimeout(() => root.classList.remove('theme-swap'), 400);
    };
    if (P.motion !== 'off') CL.transition(go); else go();
    CL.api.put('/app/settings', { theme: id === 'graphite' ? 'console' : id }).catch(() => {});
  };

  look.resetAll = () => { P = JSON.parse(JSON.stringify(DEFAULT)); look.apply(); look.save(); CL.emit('look'); };

  /** Theme preview tile HTML. */
  look.tile = (th, on) => {
    const [bg, sf, ac, ok] = th.sw || ['#16171a', '#1c1d21', '#7aa2f7', '#9ece6a'];
    const prev = th.thumb
      ? '<div class="prev prev-own" style="background:' + bg + '">' + th.thumb + '</div>'
      : '<div class="prev" style="background:' + bg + '"><div class="s" style="background:' + bg + '"><i style="background:' + ac + '"></i><i style="background:' + sf + '"></i><i style="background:' + sf + '"></i></div>' +
        '<div class="m"><b style="background:' + ac + '"></b><em style="background:' + sf + ';border:1px solid ' + ok + '33"></em><em style="background:' + sf + '"></em></div></div>';
    return '<button class="theme-tile' + (on ? ' on' : '') + '" data-theme-pick="' + th.id + '" role="radio" aria-checked="' + !!on + '" data-tip="' + esc(t(th.desc || '')) + '">' + prev +
      '<div class="name"><span>' + esc(t(th.name)) + '</span><span class="swatches">' + (th.sw || []).slice(2).map((c) => '<i style="background:' + c + '"></i>').join('') + '</span></div></button>';
  };


  look.apply();
})();
