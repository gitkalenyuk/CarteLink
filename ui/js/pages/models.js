'use strict';
// Моделі: which real model answers each model name a client asks for.
// The form is a local copy of config.routing; saving writes only what the
// user changed (3-way against the snapshot taken when the form was filled), so
// the floating switcher, presets or another window are never overwritten.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  // Exact swaps offered for well-known Claude model ids (newest first).
  const OFFICIAL = [
    { id: 'claude-fable-5-2', label: 'Fable 5.2' },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
    { id: 'claude-opus-5-5', label: 'Opus 5.5' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
    { id: 'claude-fable-5-1', label: 'Fable 5.1' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (20251001)' },
    { id: 'claude-opus-5', label: 'Opus 5' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5' },
    { id: 'claude-fable-5', label: 'Fable 5' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8' },
    { id: 'claude-opus-4-7', label: 'Opus 4.7' },
    { id: 'claude-opus-4-6', label: 'Opus 4.6' },
    { id: 'claude-opus-3', label: 'Opus 3' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  ];
  const OFFICIAL_IDS = new Set(OFFICIAL.map((m) => m.id));
  const TIER_KEYS = ['haiku', 'sonnet', 'opus', 'fast', 'main', 'max'];
  const CLAUDE_TIERS = [
    ['haiku', 'Haiku', 'швидка · дрібні та фонові задачі'],
    ['sonnet', 'Sonnet', 'основна · код і чат'],
    ['opus', 'Opus', 'найрозумніша · складні задачі'],
  ];
  // [tier, client name, description, Claude counterpart, its label]
  const UNIVERSAL = [
    ['fast', 'cartelink-fast', 'швидка', 'haiku', 'Haiku'],
    ['main', 'cartelink-main', 'основна', 'sonnet', 'Sonnet'],
    ['max', 'cartelink-max', 'потужна', 'opus', 'Opus'],
  ];
  // Same as TIER_ALIASES in src/config.rs (exact, case-insensitive names).
  const TIER_ALIASES = {
    fast: ['cartelink-fast', 'claude-cartelink-fast', 'cursor-small', 'codex-mini', 'windsurf-fast', 'cascade-fast'],
    main: ['cartelink-main', 'claude-cartelink-main', 'cursor-sonnet', 'cursor-primary', 'cursor-default', 'codex-smart', 'codex-default', 'windsurf-base', 'cascade-base'],
    max: ['cartelink-max', 'claude-cartelink-max', 'codex-reason', 'windsurf-adv', 'cascade-adv', 'cascade-advanced'],
  };
  const STRATEGIES = [
    ['smart', 'Розумно', 'Якщо такої моделі немає в жодному акаунті — відповідає модель за замовчуванням. Рекомендовано.'],
    ['passthrough', 'Передавати як є', 'Назва йде до рушія без змін. Якщо моделі немає — програма отримає помилку.'],
    ['always', 'Завжди за замовчуванням', 'Будь-яка назва без правила — на модель за замовчуванням.'],
  ];
  const EXAMPLES = ['claude-sonnet-4-6', 'claude-haiku-4-5', 'cartelink-main', 'gpt-4o'];

  const STYLE = '<style>' +
    '.pg-models .tier-row{display:grid;grid-template-columns:minmax(130px,190px) minmax(0,1fr);gap:12px;align-items:center;padding:8px 0;border-bottom:var(--border-w) solid var(--line)}' +
    '.pg-models .tier-row:last-child{border-bottom:0}' +
    '.pg-models .tier-name b{display:block;font-weight:600}' +
    '.pg-models .tier-name b.mono{font-weight:500}' +
    '.pg-models .tier-name span{display:block;font-size:12px;color:var(--text-3)}' +
    '.pg-models .grp-title{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin:16px 0 4px}' +
    '.pg-models .swap{display:grid;grid-template-columns:minmax(100px,150px) minmax(0,1fr) 16px minmax(0,1.3fr) 62px;gap:10px;align-items:center;padding:5px 0}' +
    '.pg-models .swap .lbl{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pg-models .swap .id{color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pg-models .swap > .i{color:var(--text-3)}' +
    '.pg-models .swap .acts{display:flex;gap:2px;justify-content:flex-end}' +
    '.pg-models .maprow{display:grid;grid-template-columns:minmax(0,1fr) 16px minmax(0,1fr) 32px;gap:10px;align-items:center;padding:5px 0}' +
    '.pg-models .maprow > .i{color:var(--text-3)}' +
    '.pg-models details.swaps{margin-top:16px;border-top:var(--border-w) solid var(--line);padding-top:12px}' +
    '.pg-models details.swaps > summary{cursor:pointer;font-weight:600;list-style:none;display:flex;align-items:center;gap:8px;padding:4px 0}' +
    '.pg-models details.swaps > summary::-webkit-details-marker{display:none}' +
    '.pg-models details.swaps > summary .i:first-child{transition:transform var(--dur) var(--ease)}' +
    '.pg-models details.swaps[open] > summary .i:first-child{transform:rotate(90deg)}' +
    '.pg-models .opts{display:flex;flex-direction:column;gap:8px}' +
    '.pg-models .opt{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:var(--radius-sm);border:var(--border-w) solid var(--line);cursor:pointer;transition:border-color var(--dur),background var(--dur)}' +
    '.pg-models .opt:hover{border-color:var(--line-strong)}' +
    '.pg-models .opt:has(input:checked){border-color:color-mix(in srgb,var(--accent) 60%,transparent);background:var(--accent-soft)}' +
    '.pg-models .opt input{margin:3px 0 0;accent-color:var(--accent);flex:none}' +
    '.pg-models .opt b{display:block;font-weight:600}' +
    '.pg-models .opt span{display:block;font-size:12px;color:var(--text-3)}' +
    '.pg-models .mtest{margin-top:8px;font-size:12.5px;display:flex;gap:8px;align-items:flex-start;min-width:0}' +
    '.pg-models .mtest:empty{display:none}' +
    '.pg-models .mtest.ok > .i{color:var(--ok)}' +
    '.pg-models .mtest.bad > .i{color:var(--bad)}' +
    '.pg-models .mtest .grow > div{overflow-wrap:anywhere}' +
    '.pg-models .flow{display:flex;align-items:stretch;gap:6px;margin-top:12px}' +
    '.pg-models .flow .node{flex:1;min-width:0;padding:10px 12px;border-radius:var(--radius-sm);border:var(--border-w) solid var(--line);background:var(--surface-2)}' +
    '.pg-models .flow .node small{display:block;font-size:11px;color:var(--text-3);margin-bottom:3px}' +
    '.pg-models .flow .node b{display:block;font-weight:500;overflow-wrap:anywhere}' +
    '.pg-models .flow .node.rule{background:var(--accent-soft);border-color:transparent}' +
    '.pg-models .flow .node.out b{color:var(--accent);font-weight:600}' +
    '.pg-models .flow > .i{align-self:center;color:var(--text-3)}' +
    '[dir="rtl"] .pg-models .flow > .i,[dir="rtl"] .pg-models .swap > .i,[dir="rtl"] .pg-models .maprow > .i{transform:scaleX(-1)}' +
    '.pg-models .savebar{position:sticky;bottom:14px;z-index:6;margin:var(--gap) auto 0;width:max-content;max-width:100%;display:flex;align-items:center;gap:10px;padding:8px 8px 8px 16px;border-radius:999px;background:var(--surface-3);border:var(--border-w) solid var(--line-strong);box-shadow:var(--shadow-pop);animation:dlgin calc(260ms * var(--t)) var(--ease)}' +
    '.pg-models .savebar .dot{background:var(--warn)}' +
    '@media (max-width:900px){.pg-models .swap{grid-template-columns:1fr 1fr;}.pg-models .swap > .i{display:none}.pg-models .tier-row{grid-template-columns:1fr}.pg-models .flow{flex-direction:column}.pg-models .flow > .i{transform:rotate(90deg)}}' +
    '.pg-models .fb-row,.pg-models .ar-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:var(--border-w) solid var(--line)}' +
    '.pg-models .fb-row:last-child,.pg-models .ar-row:last-child{border-bottom:0}' +
    '.pg-models .fb-src{flex:0 1 34%;min-width:0;font-size:12.5px}' +
    '.pg-models .fb-chain{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:6px;align-items:center}' +
    '.pg-models .fb-chain .tag{display:inline-flex;align-items:center;gap:6px;max-width:100%}' +
    '.pg-models .fb-n{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:var(--surface-3);font-size:10px;font-weight:700}' +
    '.pg-models .ar-row.off{opacity:.55}' +
    '.pg-models .ar-model{max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '[dir="rtl"] .pg-models .fb-row > .i,[dir="rtl"] .pg-models .ar-row > .i{transform:scaleX(-1)}' +
    '</style>';

  CL.page('models', {
    title: 'Моделі', icon: 'route', group: 'gateway', order: 20,

    async render(root, ctx) {
      root.classList.add('pg-models');
      root.innerHTML = STYLE +
        '<div class="blocks" data-area="models">' +
        '<section class="block card" data-block="main" data-w="7" data-title="Основна модель">' +
          '<div class="card-h"><div class="card-icon">' + ic('zap') + '</div><h2>' + esc(t('Основна модель')) + '</h2></div>' +
          '<div class="field"><label>' + esc(t('Одна модель для всього')) + '</label>' +
            '<div class="row nw"><div class="grow" id="mAll"></div>' +
            '<button class="btn" id="mAllTest" data-tip="' + esc(t('Надіслати короткий запит і подивитись, чи модель відповідає')) + '">' + ic('play', 'sm') + esc(t('Перевірити модель')) + '</button>' +
            '<button class="btn primary" id="mAllApply">' + esc(t('Застосувати до всього')) + '</button></div>' +
            '<div class="hint">' + esc(t('Ставить модель на всі рівні, точкові підміни й як модель за замовчуванням. Діє одразу.')) + '</div>' +
            '<div class="mtest" id="mAllOut" aria-live="polite"></div></div>' +
          '<hr class="sep">' +
          '<div class="field"><label>' + esc(t('Модель за замовчуванням')) + '</label>' +
            '<div class="row nw"><div class="grow" id="mDef"></div>' +
            '<button class="btn" id="mDefTest" data-tip="' + esc(t('Надіслати короткий запит і подивитись, чи модель відповідає')) + '">' + ic('play', 'sm') + esc(t('Перевірити модель')) + '</button></div>' +
            '<div class="hint">' + esc(t('Відповідає, коли програма не вказала модель або просить модель без правила (див. «Невідомі моделі»).')) + '</div>' +
            '<div class="mtest" id="mDefOut" aria-live="polite"></div></div>' +
          '<hr class="sep">' +
          '<div class="field"><label>' + esc(t('Невідомі моделі')) + '</label>' +
            '<div class="hint" style="margin-bottom:4px">' + esc(t('Що робити, коли програма просить модель, для якої немає правила.')) + '</div>' +
            '<div class="opts" id="mStrat" role="radiogroup">' + STRATEGIES.map(([v, title, text]) =>
              '<label class="opt"><input type="radio" name="mStrat" value="' + v + '"><div><b>' + esc(t(title)) + '</b><span>' + esc(t(text)) + '</span></div></label>').join('') + '</div></div>' +
        '</section>' +
        '<section class="block card" data-block="explain" data-w="5" data-title="Як це працює">' +
          '<div class="card-h"><div class="card-icon">' + ic('bulb') + '</div><h2>' + esc(t('Як це працює')) + '</h2></div>' +
          '<p class="muted small">' + esc(t('Програма називає модель, CarteLink знаходить перше правило, яке підходить, і передає запит реальній моделі. Порядок: точна підміна або шаблон з * (довший шаблон важливіший), потім рівні, потім модель за замовчуванням.')) + '</p>' +
          '<div class="field"><label for="mTry">' + esc(t('Перевір назву моделі')) + '</label><input class="input mono" id="mTry" placeholder="' + esc(t('напр. claude-sonnet-4-6')) + '" autocomplete="off" spellcheck="false"></div>' +
          '<div class="row" style="margin-top:8px;gap:6px" id="mTryEx">' + EXAMPLES.map((x) => '<button class="btn sm ghost mono" data-ex="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</div>' +
          '<div id="mFlow"></div>' +
          '<div class="hint" style="margin-top:10px">' + esc(t('Показує правила з форми, включно з незбереженими змінами.')) + '</div>' +
        '</section>' +
        '<section class="block card" data-block="rules" data-w="12" data-title="Правила підміни">' +
          '<div class="card-h"><div class="card-icon">' + ic('route') + '</div><h2>' + esc(t('Правила підміни')) + '</h2><span class="grow"></span>' +
            CL.ui.seg('mMode', [['tiers', 'Рівні (просто)'], ['table', 'Таблиця (гнучко)']], 'tiers') + '</div>' +
          '<div id="mTiersBox">' +
            '<p class="muted small">' + esc(t('Claude Code сам просить Haiku, Sonnet або Opus. Іншим програмам вкажи модель cartelink-fast, cartelink-main або cartelink-max — шлюз підставить обрану тут.')) + '</p>' +
            '<div class="cols-2">' +
              '<div><div class="grp-title">Claude Code</div><div id="mClaude"></div></div>' +
              '<div><div class="grp-title">' + esc(t('Інші програми (Cursor, Codex, Cline, Aider…)')) + '</div><div id="mUniv"></div></div>' +
            '</div>' +
            '<details class="swaps" id="mSwaps"><summary>' + ic('chevron', 'sm') + esc(t('Точкові підміни імен моделей (необов\'язково)')) + '<span class="chip outline hidden" id="mSwapN"></span></summary>' +
              '<p class="hint" style="margin:6px 0 10px">' + esc(t('Мають пріоритет над рівнями. Порожнє — працює правило рівня.')) + '</p>' +
              '<div id="mOfficial"></div>' +
              '<div class="grp-title">' + esc(t('Свої рядки')) + '</div>' +
              '<div id="mPoints"></div>' +
              '<div class="swap" style="margin-top:6px">' +
                '<input class="input" id="cpLabel" placeholder="' + esc(t('Назва (як показувати)')) + '" maxlength="80">' +
                '<input class="input mono" id="cpModel" placeholder="' + esc(t('модель від програми, напр. claude-opus-6')) + '" spellcheck="false">' +
                ic('arrow', 'sm') + '<div id="cpTo"></div>' +
                '<div class="acts"><button class="btn sm" id="cpAdd">' + ic('plus', 'sm') + esc(t('Додати')) + '</button></div>' +
              '</div>' +
              '<div class="row" style="margin-top:12px"><button class="btn sm ghost" id="mReset">' + ic('rotate', 'sm') + esc(t('Скинути всі точкові підміни')) + '</button></div>' +
            '</details>' +
          '</div>' +
          '<div id="mTableBox" class="hidden">' +
            '<p class="muted small">' + esc(t('Кожен рядок: яку назву моделі надсилає програма → яка модель відповідає. Зірочка * означає будь-які символи: gpt-4* спрацює на всі моделі, що починаються з gpt-4. Рівні в цьому режимі вимкнені.')) + '</p>' +
            '<div id="mRows"></div>' +
            '<button class="btn sm ghost" id="mRowAdd" style="margin-top:8px">' + ic('plus', 'sm') + esc(t('Додати рядок')) + '</button>' +
          '</div>' +
        '</section>' +
        '<section class="block card" data-block="fallback" data-w="6" data-title="Запасні моделі">' +
          '<div class="card-h"><div class="card-icon">' + ic('swap') + '</div><h2>' + esc(t('Запасні моделі')) + '</h2><span class="grow"></span><button class="btn sm" id="fbAdd">' + ic('plus', 'sm') + esc(t('Додати')) + '</button></div>' +
          '<p class="muted small">' + esc(t('Якщо модель не відповіла (ліміт, збій, модель зникла), CarteLink непомітно для програми пробує наступну зі списку.')) + '</p>' +
          '<div id="fbList"></div>' +
        '</section>' +
        '<section class="block card" data-block="apprules" data-w="6" data-title="Модель для програми">' +
          '<div class="card-h"><div class="card-icon">' + ic('plug') + '</div><h2>' + esc(t('Модель для програми')) + '</h2><span class="grow"></span><button class="btn sm" id="arAdd">' + ic('plus', 'sm') + esc(t('Додати')) + '</button></div>' +
          '<p class="muted small">' + esc(t('Окрема модель для конкретної програми — незалежно від того, яку модель вона просить. Діє для основного ключа; окремі API-ключі мають власний список моделей.')) + '</p>' +
          '<div id="arList"></div>' +
        '</section>' +
        '<section class="block card" data-block="rotation" data-w="12" data-title="Акаунти й повтори">' +
          '<div class="card-h"><div class="card-icon">' + ic('rotate') + '</div><h2>' + esc(t('Акаунти й повтори')) + '</h2><span class="grow"></span><span class="sub">' + esc(t('Як шлюз розподіляє запити між акаунтами одного провайдера і що робить при помилці.')) + '</span></div>' +
          '<div class="cols-3 opts" id="mRot" role="radiogroup">' +
            '<label class="opt"><input type="radio" name="mRot" value="round-robin"><div><b>' + esc(t('По черзі')) + '</b><span>' + esc(t('Кожен наступний запит іде на наступний акаунт — ліміти витрачаються рівномірно.')) + '</span></div></label>' +
            '<label class="opt"><input type="radio" name="mRot" value="weighted-round-robin"><div><b>' + esc(t('За вагою')) + '</b><span>' + esc(t('Акаунт з більшою вагою отримує більше запитів. Вагу задаєш на сторінці «Акаунти».')) + '</span></div></label>' +
            '<label class="opt"><input type="radio" name="mRot" value="fill-first"><div><b>' + esc(t('Спочатку перший')) + '</b><span>' + esc(t('Використовує перший акаунт до вичерпання ліміту, потім автоматично переходить на наступний.')) + '</span></div></label>' +
          '</div>' +
          '<div class="cols-2" style="margin-top:14px">' +
            '<div class="field"><label for="tRetry">' + esc(t('Повторів при помилці')) + '</label><input class="input" id="tRetry" type="number" min="0" max="10"><div class="hint">' + esc(t('Скільки разів повторити запит, якщо акаунт відповів помилкою.')) + '</div></div>' +
            '<div class="field"><label for="tCreds">' + esc(t('Скільки інших акаунтів спробувати')) + '</label><input class="input" id="tCreds" type="number" min="0" max="50"><div class="hint">' + esc(t('0 — усі доступні.')) + '</div></div>' +
          '</div>' +
          '<div class="stack" style="gap:8px;margin-top:10px">' +
            CL.ui.switch('tProj', false, 'На ліміті перемикатись на інший проєкт того самого акаунта') +
            CL.ui.switch('tPrev', false, 'На ліміті пробувати preview-версію моделі') +
          '</div>' +
          '<div class="hint" id="tNote" style="margin-top:8px"></div>' +
        '</section>' +
        '</div>' +
        '<div class="savebar hidden" id="mSaveBar" role="status"><span class="dot"></span><span>' + esc(t('Є незбережені зміни')) + '</span>' +
          '<button class="btn sm ghost" id="mCancel">' + esc(t('Скасувати')) + '</button><button class="btn sm primary" id="mSave">' + ic('check', 'sm') + esc(t('Зберегти')) + '</button></div>';

      const $ = (s) => root.querySelector(s);

      // ------------------------------------------------------------ state --
      let S = null; // the form: {mode, unmappedStrategy, defaultModel, tiers, official, points, rows}
      let snap = null; // formState() right after the last fill
      let loaded = ''; // JSON of the server routing the form was filled from
      let known = null; // Set of lower-case ids the accounts serve (for the preview)
      let emptyRefs = []; // pickers whose empty label follows the rules: {o, p, label()}

      const clean = (m) => {
        m = CL.cleanModel(m || '');
        const i = m.indexOf(':');
        if (i > 0 && m.indexOf('://') < 0) {
          const pre = m.slice(0, i).trim().toLowerCase();
          const provs = (CL.status && CL.status.providers) || [];
          if (provs.some((p) => p.id && String(p.id).trim().toLowerCase() === pre)) return m.slice(i + 1);
        }
        return m;
      };

      function fill(routing) {
        routing = routing || {};
        const tiers = routing.tiers || {};
        const mm = {};
        Object.entries(routing.modelMap || {}).forEach(([k, v]) => { if (v) mm[k] = v; });
        S = {
          mode: routing.mode === 'table' ? 'table' : 'tiers',
          unmappedStrategy: routing.unmappedStrategy || 'smart',
          defaultModel: CL.cleanModel(routing.defaultModel || ''),
          tiers: {},
          official: {},
          points: [],
          rows: [],
        };
        TIER_KEYS.forEach((k) => { S.tiers[k] = CL.cleanModel(tiers[k] || ''); });
        OFFICIAL.forEach((m) => { S.official[m.id] = mm[m.id] || ''; });
        S.points = (routing.customPoints || []).filter((c) => c.model && !OFFICIAL_IDS.has(c.model))
          .map((c) => ({ label: c.label || c.model, model: c.model, to: mm[c.model] || '' }));
        if (S.mode === 'table') {
          S.rows = Object.keys(mm).map((k) => ({ from: k, to: mm[k] }));
        } else {
          // Swaps that are neither official nor own rows (older configs) stay visible as own rows.
          const own = new Set(S.points.map((c) => c.model));
          Object.keys(mm).forEach((k) => { if (!OFFICIAL_IDS.has(k) && !own.has(k)) S.points.push({ label: k, model: k, to: mm[k] }); });
        }
        snap = formState();
        loaded = JSON.stringify(routing);
        paintAll();
      }

      // The routing as the form represents it.
      function formState() {
        const s = { mode: S.mode, unmappedStrategy: S.unmappedStrategy, defaultModel: S.defaultModel, tiers: Object.assign({}, S.tiers), map: {}, points: S.points.map((c) => ({ label: c.label, model: c.model })) };
        if (S.mode === 'table') S.rows.forEach((r) => { if (r.from && r.to) s.map[r.from] = r.to; });
        else {
          OFFICIAL.forEach((m) => { if (S.official[m.id]) s.map[m.id] = S.official[m.id]; });
          S.points.forEach((c) => { if (c.to) s.map[c.model] = c.to; });
        }
        return s;
      }

      // What changed between two form states (null = nothing).
      function diff(base, cur) {
        const e = { fields: {}, tiers: {}, map: {}, points: [], drop: [] };
        let n = 0;
        ['mode', 'unmappedStrategy', 'defaultModel'].forEach((f) => { if (cur[f] !== base[f]) { e.fields[f] = cur[f]; n++; } });
        TIER_KEYS.forEach((k) => { if (cur.tiers[k] !== base.tiers[k]) { e.tiers[k] = cur.tiers[k]; n++; } });
        Object.keys(base.map).forEach((k) => { if (!(k in cur.map)) { e.map[k] = null; n++; } });
        Object.keys(cur.map).forEach((k) => { if (cur.map[k] !== base.map[k]) { e.map[k] = cur.map[k]; n++; } });
        const low = (c) => String(c.model).toLowerCase();
        const had = new Map(base.points.map((c) => [low(c), c.label]));
        const has = new Set(cur.points.map(low));
        e.points = cur.points.filter((c) => had.get(low(c)) !== c.label);
        e.drop = base.points.map(low).filter((m) => !has.has(m));
        n += e.points.length + e.drop.length;
        return n ? e : null;
      }

      const dirty = () => !!(S && snap && diff(snap, formState()));
      const halfRows = () => S && S.mode === 'table' && S.rows.some((r) => !!r.from !== !!r.to);

      // Unsaved work, or the user is on a control right now: never refill under them.
      function busy() {
        if (!S || dirty() || halfRows()) return true;
        if (document.querySelector('.mp-pop') || document.querySelector('.dlg-back')) return true;
        const a = document.activeElement;
        return !!(a && /^(SELECT|INPUT|TEXTAREA)$/.test(a.tagName) && root.contains(a));
      }

      function changed() {
        if (!S) return;
        $('#mSaveBar').classList.toggle('hidden', !dirty() && !halfRows());
        refreshEmptyLabels();
        paintFlow();
        const n = OFFICIAL.filter((m) => S.official[m.id]).length + S.points.filter((c) => c.to).length;
        const chip = $('#mSwapN');
        chip.classList.toggle('hidden', !n);
        chip.textContent = t('{n} активних', { n });
      }

      // ------------------------------------------------------------ paint --
      function paintAll() {
        emptyRefs = [];
        segSet(root.querySelector('#mMode'), S.mode);
        $('#mTiersBox').classList.toggle('hidden', S.mode !== 'tiers');
        $('#mTableBox').classList.toggle('hidden', S.mode !== 'table');
        root.querySelectorAll('input[name="mStrat"]').forEach((r) => { r.checked = r.value === S.unmappedStrategy; });
        defPick.set(S.defaultModel);
        paintTiers();
        paintOfficial();
        paintPoints();
        paintRows();
        changed();
      }

      function picker(el, value, empty, onChange) {
        const o = { value, empty, onChange };
        const p = CL.ui.modelPicker(el, o);
        return { o, p, el };
      }

      function paintTiers() {
        $('#mClaude').innerHTML = CLAUDE_TIERS.map(([k, name, desc]) => '<div class="tier-row"><div class="tier-name"><b>' + esc(name) + '</b><span>' + esc(t(desc)) + '</span></div><div data-tier="' + k + '"></div></div>').join('');
        $('#mUniv').innerHTML = UNIVERSAL.map(([k, name, desc]) => {
          const also = TIER_ALIASES[k].filter((a) => a !== name && a !== 'claude-' + name).join(', ');
          return '<div class="tier-row"><div class="tier-name" data-tip="' + esc(t('Також спрацьовує на старі імена: {list}', { list: also })) + '"><b class="mono">' + esc(name) + '</b><span>' + esc(t(desc)) + ' ' + ic('info', 'sm') + '</span></div><div data-tier="' + k + '"></div></div>';
        }).join('');
        root.querySelectorAll('[data-tier]').forEach((el) => {
          const k = el.dataset.tier;
          const u = UNIVERSAL.find((x) => x[0] === k);
          const ref = picker(el, S.tiers[k], u ? followLabel(u) : '— не вказано —', (v) => { S.tiers[k] = v; changed(); });
          if (u) emptyRefs.push({ o: ref.o, p: ref.p, el: ref.el, label: () => followLabel(u) });
        });
      }

      // An empty universal tier follows its Claude counterpart (routing.rs universal_tier).
      function followLabel(u) {
        const m = S.tiers[u[3]] || S.defaultModel;
        return m ? t('— як {t}: {m} —', { t: u[4], m }) : t('— як {t} —', { t: u[4] });
      }

      // What the rules give a name when its own swap is empty.
      function byRuleLabel(id) {
        const r = resolve(id, { skip: id });
        return r.to && r.to.toLowerCase() !== id.toLowerCase() ? t('— за рівнем: {m} —', { m: r.to }) : t('— за рівнем —');
      }

      function swapRow(label, id, extra) {
        return '<div class="swap"><span class="lbl" title="' + esc(label) + '">' + esc(label) + '</span><span class="id mono small" title="' + esc(id) + '">' + esc(id) + '</span>' + ic('arrow', 'sm') + '<div data-pick></div><div class="acts">' + (extra || '') + '</div></div>';
      }

      function paintOfficial() {
        const box = $('#mOfficial');
        box.innerHTML = OFFICIAL.map((m) => swapRow(m.label, m.id)).join('');
        Array.from(box.children).forEach((row, i) => {
          const id = OFFICIAL[i].id;
          const ref = picker(row.querySelector('[data-pick]'), S.official[id], byRuleLabel(id), (v) => { S.official[id] = v; changed(); });
          emptyRefs.push({ o: ref.o, p: ref.p, el: ref.el, label: () => byRuleLabel(id) });
        });
      }

      function paintPoints() {
        const box = $('#mPoints');
        if (!S.points.length) {
          box.innerHTML = '<div class="hint" style="padding:6px 0">' + esc(t('Своїх рядків ще немає — додай нижче будь-яку назву моделі, яку надсилає програма.')) + '</div>';
          return;
        }
        box.innerHTML = S.points.map((c) => swapRow(c.label, c.model,
          '<button class="btn sm icon ghost" data-ren data-tip="' + esc(t('Перейменувати')) + '">' + ic('edit', 'sm') + '</button>' +
          '<button class="btn sm icon ghost" data-del data-tip="' + esc(t('Видалити рядок')) + '">' + ic('x', 'sm') + '</button>')).join('');
        Array.from(box.children).forEach((row, i) => {
          const c = S.points[i];
          const ref = picker(row.querySelector('[data-pick]'), c.to, byRuleLabel(c.model), (v) => { c.to = v; changed(); });
          emptyRefs.push({ o: ref.o, p: ref.p, el: ref.el, label: () => byRuleLabel(c.model) });
          row.querySelector('[data-del]').addEventListener('click', () => { S.points.splice(S.points.indexOf(c), 1); paintPoints(); changed(); });
          row.querySelector('[data-ren]').addEventListener('click', async () => {
            const v = await CL.prompt('Назва рядка', { value: c.label, title: 'Перейменувати', text: t('Як показувати рядок для моделі {m}.', { m: c.model }), ok: 'Зберегти' });
            if (v == null) return;
            c.label = v || c.model;
            paintPoints();
            changed();
          });
        });
      }

      function paintRows() {
        const box = $('#mRows');
        if (!S.rows.length) {
          box.innerHTML = CL.ui.empty('list', 'Рядків ще немає', 'Натисни «Додати рядок», щоб задати першу підміну.');
          return;
        }
        box.innerHTML = S.rows.map((r) => '<div class="maprow"><input class="input mono" placeholder="' + esc(t('назва від програми, напр. gpt-4o або claude-*')) + '" value="' + esc(r.from) + '" spellcheck="false">' + ic('arrow', 'sm') + '<div data-pick></div><button class="btn icon ghost" data-del data-tip="' + esc(t('Видалити рядок')) + '">' + ic('x', 'sm') + '</button></div>').join('');
        Array.from(box.children).forEach((row, i) => {
          const r = S.rows[i];
          const inp = row.querySelector('input');
          inp.addEventListener('input', () => { r.from = inp.value.trim(); changed(); });
          picker(row.querySelector('[data-pick]'), r.to, '— обери модель —', (v) => { r.to = v; changed(); });
          row.querySelector('[data-del]').addEventListener('click', () => { S.rows.splice(S.rows.indexOf(r), 1); paintRows(); changed(); });
        });
      }

      function refreshEmptyLabels() {
        emptyRefs = emptyRefs.filter((x) => x.el.isConnected);
        emptyRefs.forEach((x) => {
          const l = x.label();
          if (l !== x.o.empty) { x.o.empty = l; if (!x.p.get()) x.p.set(''); }
        });
      }

      // ----------------------------------------------- resolve (preview) --
      // Mirrors resolve_model in src/routing.rs, on the form's (unsaved) rules.
      function wildcard(p, n) {
        if (p.indexOf('*') < 0) return false;
        const parts = p.split('*');
        if (!n.startsWith(parts[0])) return false;
        let rest = n.slice(parts[0].length);
        const last = parts[parts.length - 1];
        for (const mid of parts.slice(1, -1)) {
          const i = rest.indexOf(mid);
          if (i < 0) return false;
          rest = rest.slice(i + mid.length);
        }
        return rest.length >= last.length && rest.endsWith(last);
      }
      function uncloak(id) {
        const P = 'claude-fable-5-dd-';
        if (!id.startsWith(P)) return id;
        let base = id.slice(P.length);
        let suffix = '';
        const open = base.lastIndexOf('(');
        if (open >= 0 && base.endsWith(')')) { suffix = base.slice(open); base = base.slice(0, open); }
        return Array.from(base).reverse().join('') + suffix;
      }
      function universal(tier) {
        const T = S.tiers;
        const pick = (vals) => vals.map((v) => (v || '').trim()).find((v) => v) || '';
        if (tier === 'fast') return pick([T.fast, T.haiku, S.defaultModel]);
        if (tier === 'main') return pick([T.main, T.sonnet, S.defaultModel]);
        if (tier === 'max') return pick([T.max, T.opus, S.defaultModel]);
        return '';
      }
      function resolve(name, opt) {
        opt = opt || {};
        const mm = Object.assign({}, formState().map);
        if (opt.skip) delete mm[opt.skip];
        let want = String(name || '').trim();
        if (want.length > 4 && want.slice(-4).toLowerCase() === '[1m]') want = want.slice(0, -4).trim();
        const unc = uncloak(want);
        const lw = unc.trim().toLowerCase();
        // 1. model map: exact, then case-insensitive, then the longest wildcard.
        for (const n of [want, unc]) if (mm[n]) return { to: clean(mm[n]), rule: 'exact', key: n };
        const keys = Object.keys(mm).sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
        for (const n of [want, unc]) { const k = keys.find((x) => x.toLowerCase() === n.toLowerCase()); if (k) return { to: clean(mm[k]), rule: 'exact', key: k }; }
        for (const n of [want, unc]) { const k = keys.find((x) => wildcard(x.toLowerCase(), n.toLowerCase())); if (k) return { to: clean(mm[k]), rule: 'wild', key: k }; }
        // 2. tiers (mode "tiers" only).
        if (S.mode !== 'table') {
          let hit = null;
          if (lw.startsWith('claude')) {
            for (const [k, label] of [['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus']]) {
              if (lw.indexOf(k) >= 0 && S.tiers[k]) { hit = { to: S.tiers[k], rule: 'claude', key: label }; break; }
            }
          }
          if (!hit) {
            for (const tier of ['fast', 'main', 'max']) {
              if (TIER_ALIASES[tier].indexOf(lw) >= 0) {
                const m = universal(tier);
                if (m) hit = { to: m, rule: 'universal', key: 'cartelink-' + tier };
                break;
              }
            }
          }
          if (hit) {
            if (mm[hit.to]) { hit.via = hit.to; hit.to = mm[hit.to]; }
            hit.to = clean(hit.to);
            return hit;
          }
        }
        // 3. unmapped.
        const def = clean(S.defaultModel.trim());
        if (!lw || lw === '*') return def ? { to: def, rule: 'empty' } : { to: unc, rule: 'pass' };
        if (def) {
          if (S.unmappedStrategy === 'always') return { to: def, rule: 'always' };
          if (S.unmappedStrategy === 'smart') {
            const served = known ? known.has(lw) : true;
            return served ? { to: unc, rule: 'smart-ok', def } : { to: def, rule: 'smart-def', def };
          }
        }
        return { to: unc, rule: 'pass' };
      }

      function ruleText(r) {
        switch (r.rule) {
          case 'exact': return t('Точна підміна «{k}»', { k: r.key });
          case 'wild': return t('Шаблон «{k}»', { k: r.key });
          case 'claude': return t('Рівень Claude Code: {tier}', { tier: r.key });
          case 'universal': return t('Рівень {tier}', { tier: r.key });
          case 'empty': return t('Назву не вказано → модель за замовчуванням');
          case 'always': return t('Немає правила → завжди модель за замовчуванням');
          case 'smart-ok': return t('Немає правила, модель є в акаунтах → як є');
          case 'smart-def': return t('Немає правила, моделі немає в акаунтах → за замовчуванням');
          default: return t('Немає правила → передається як є');
        }
      }

      function paintFlow() {
        const box = $('#mFlow');
        const name = $('#mTry').value.trim() || EXAMPLES[0];
        const r = resolve(name);
        let note = '';
        if (r.via) note = t('Спершу рівень дав {a}, а для неї є точна підміна.', { a: r.via });
        else if (r.rule === 'smart-ok' || r.rule === 'smart-def') note = t('Розумний режим: як є, якщо рушій обслуговує цю модель, інакше — {m}. Точно знає лише рушій у момент запиту.', { m: r.def });
        else if (r.rule === 'pass' && known && !known.has(String(r.to).toLowerCase())) note = t('Жоден підключений акаунт не обслуговує цю модель — програма отримає помилку.');
        box.innerHTML = '<div class="flow">' +
          '<div class="node"><small>' + esc(t('Програма просить')) + '</small><b class="mono">' + esc(name) + '</b></div>' + ic('arrow') +
          '<div class="node rule"><small>' + esc(t('Правило')) + '</small><b>' + esc(ruleText(r)) + '</b></div>' + ic('arrow') +
          '<div class="node out"><small>' + esc(t('Відповідає')) + '</small><b class="mono">' + esc(r.to || '—') + '</b></div>' +
          '</div>' + (note ? '<div class="hint" style="margin-top:8px">' + esc(note) + '</div>' : '');
      }

      $('#mTry').addEventListener('input', paintFlow);
      $('#mTryEx').addEventListener('click', (e) => { const b = e.target.closest('[data-ex]'); if (!b) return; $('#mTry').value = b.dataset.ex; paintFlow(); });

      // ---------------------------------------------------- main controls --
      const allPick = CL.ui.modelPicker($('#mAll'), { value: CL.mainModel(), empty: '— обери модель —' });
      const defPick = CL.ui.modelPicker($('#mDef'), { value: '', empty: '— не вказано —', onChange: (v) => { if (S) { S.defaultModel = v; changed(); } } });

      $('#mAllApply').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
        const v = allPick.get();
        if (!v) throw new Error(t('Спочатку обери модель зі списку'));
        const text = dirty()
          ? t('Призначити {m} для всіх рівнів, точкових підмін і як модель за замовчуванням? Незбережені зміни у формі буде скасовано.', { m: v })
          : t('Призначити {m} для всіх рівнів, точкових підмін і як модель за замовчуванням?', { m: v });
        if (!(await CL.confirm(text, { ok: 'Застосувати' }))) return;
        if (await CL.applyModelEverywhere(v)) fill((await CL.config.get()).routing || {});
      }));

      root.querySelectorAll('input[name="mStrat"]').forEach((r) => r.addEventListener('change', () => { if (S && r.checked) { S.unmappedStrategy = r.value; changed(); } }));

      async function testModel(btn, model, out) {
        if (!model) { CL.toast('Спочатку обери модель', 'bad'); return; }
        btn.classList.add('busy');
        btn.disabled = true;
        out.className = 'mtest';
        out.innerHTML = '<span class="hint">' + esc(t('Надсилаю короткий запит до {m}…', { m: model })) + '</span>';
        let d;
        let err = null;
        try { d = await CL.api.post('/test-model', { model }); } catch (e) { err = e; d = e.data || null; }
        btn.classList.remove('busy');
        btn.disabled = false;
        if (!ctx.alive()) return;
        const via = d && d.resolved && d.resolved !== model ? ' · ' + t('насправді відповідає {m}', { m: d.resolved }) : '';
        if (!err && d && d.ok !== false) {
          out.className = 'mtest ok';
          out.innerHTML = ic('check') + '<div class="grow"><div><b>' + esc(t('Працює за {ms}', { ms: CL.fmtMs(d.ms || 0) })) + '</b>' + esc(via) + '</div>' +
            (d.reply ? '<div class="muted">' + esc(t('Відповідь: «{r}»', { r: d.reply })) + '</div>' : '') + '</div>';
          return;
        }
        const msg = (d && d.error) || (err && err.message) || t('немає відповіді');
        const hint = CL.errorHint({ status: d && d.status, message: msg, kind: '' }) || t('Перевір, що акаунт з цією моделлю підключений і працює (сторінка «Акаунти»), або обери іншу модель.');
        out.className = 'mtest bad';
        out.innerHTML = ic('alert') + '<div class="grow"><div><b>' + esc(t('Не відповідає')) + '</b>' + (d && d.status ? ' · ' + esc(t('код {c}', { c: d.status })) : '') + esc(via) + '</div>' +
          '<div class="muted">' + esc(msg) + '</div><div>' + ic('bulb', 'sm') + ' ' + esc(hint) + '</div></div>';
      }
      $('#mAllTest').addEventListener('click', (e) => testModel(e.currentTarget, allPick.get(), $('#mAllOut')));
      $('#mDefTest').addEventListener('click', (e) => testModel(e.currentTarget, defPick.get(), $('#mDefOut')));

      // ----------------------------------------------------- rules editor --
      CL.ui.onSeg($('#mMode'), (v) => {
        if (!S) return;
        if (v === 'table' && !S.rows.length) {
          // Start the table from what the tiers do now.
          S.rows = [['claude-*haiku*', S.tiers.haiku], ['claude-*sonnet*', S.tiers.sonnet], ['claude-*opus*', S.tiers.opus]]
            .filter((x) => x[1]).map(([from, to]) => ({ from, to }));
          paintRows();
        }
        S.mode = v;
        $('#mTiersBox').classList.toggle('hidden', v !== 'tiers');
        $('#mTableBox').classList.toggle('hidden', v !== 'table');
        changed();
      });

      const cpTo = CL.ui.modelPicker($('#cpTo'), { value: '', empty: '— за рівнем —' });
      $('#cpAdd').addEventListener('click', () => {
        if (!S) return;
        const model = $('#cpModel').value.trim();
        const label = $('#cpLabel').value.trim() || model;
        if (!model) { CL.toast('Вкажи назву моделі, яку надсилає програма', 'bad'); $('#cpModel').focus(); return; }
        const low = model.toLowerCase();
        if (OFFICIAL.some((m) => m.id === low) || S.points.some((c) => c.model.toLowerCase() === low)) {
          CL.toast(t('Модель {m} вже є у списку', { m: model }), 'bad');
          return;
        }
        S.points.push({ label, model, to: cpTo.get() });
        $('#cpModel').value = '';
        $('#cpLabel').value = '';
        cpTo.set('');
        paintPoints();
        changed();
      });
      $('#cpModel').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#cpAdd').click(); });

      $('#mReset').addEventListener('click', async () => {
        if (!S) return;
        if (!(await CL.confirm('Скинути всі точкові підміни? Усі імена знову підуть за правилами рівнів. Зміна запишеться після «Зберегти».', { ok: 'Скинути' }))) return;
        OFFICIAL.forEach((m) => { S.official[m.id] = ''; });
        S.points.forEach((c) => { c.to = ''; });
        paintOfficial();
        paintPoints();
        changed();
      });

      $('#mRowAdd').addEventListener('click', () => {
        if (!S) return;
        S.rows.push({ from: '', to: '' });
        paintRows();
        changed();
        const inputs = root.querySelectorAll('#mRows input');
        if (inputs.length) inputs[inputs.length - 1].focus();
      });

      // ------------------------------------------------------------- save --
      async function save(btn) {
        if (!S || !snap) return;
        if (halfRows()) throw new Error(t('Заповни обидві колонки в кожному рядку (або видали порожній рядок)'));
        if (S.mode === 'table') {
          const seen = new Set();
          for (const r of S.rows) {
            if (!r.from) continue;
            const l = r.from.toLowerCase();
            if (seen.has(l)) throw new Error(t('Назва {m} повторюється в таблиці', { m: r.from }));
            seen.add(l);
          }
        }
        const cur = formState();
        const e = diff(snap, cur);
        if (!e) { $('#mSaveBar').classList.add('hidden'); return; }
        const r = Object.assign({}, e.fields);
        if ('defaultModel' in e.fields) r.defaultProviderId = '';
        if (Object.keys(e.tiers).length) r.tiers = e.tiers;
        if (Object.keys(e.map).length) r.modelMap = e.map;
        if (e.points.length || e.drop.length) {
          // customPoints is a list (a merge patch replaces it whole): apply the
          // edits on the server's current list.
          const fresh = ((await CL.config.get()).routing || {}).customPoints || [];
          const low = (c) => String(c.model || '').toLowerCase();
          const pts = fresh.filter((c) => e.drop.indexOf(low(c)) < 0).map((c) => ({ label: c.label, model: c.model }));
          e.points.forEach((c) => {
            const old = pts.find((p) => low(p) === low(c));
            if (old) old.label = c.label; else pts.push({ label: c.label, model: c.model });
          });
          r.customPoints = pts;
        }
        await CL.config.patch({ routing: r });
        let fresh = null;
        try { fresh = (await CL.config.get()).routing || {}; } catch (er) { /* keep the form */ }
        if (!ctx.alive()) return;
        if (fresh && !diff(cur, formState())) fill(fresh);
        else { snap = cur; changed(); }
        CL.toast('Правила моделей збережено ✓');
        CL.loadStatus().catch(() => {});
      }
      $('#mSave').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => save(e.currentTarget)));
      $('#mCancel').addEventListener('click', async () => {
        try { fill((await CL.config.get()).routing || {}); } catch (e) { CL.fail(e); }
      });

      // ------------------------------------------- account rotation, retries --
      let tuning = null;
      async function loadRotation() {
        try { tuning = await CL.api.get('/engine-tuning'); } catch (e) { tuning = null; }
        if (!ctx.alive()) return;
        const on = !!tuning;
        root.querySelectorAll('#mRot input, #tRetry, #tCreds, #tProj, #tPrev').forEach((x) => { x.disabled = !on; });
        $('#tNote').textContent = on ? '' : t('Рушій ще запускається — налаштування з’являться за кілька секунд.');
        if (!on) return;
        root.querySelectorAll('input[name="mRot"]').forEach((x) => { x.checked = x.value === (tuning.routingStrategy || 'round-robin'); });
        if (document.activeElement !== $('#tRetry')) $('#tRetry').value = tuning.requestRetry == null ? '' : tuning.requestRetry;
        if (document.activeElement !== $('#tCreds')) $('#tCreds').value = tuning.maxRetryCredentials == null ? '' : tuning.maxRetryCredentials;
        $('#tProj').checked = !!tuning.switchProject;
        $('#tPrev').checked = !!tuning.switchPreviewModel;
      }
      async function putTuning(patch, msg) {
        try {
          tuning = await CL.api.put('/engine-tuning', patch);
          CL.toast(msg || 'Збережено ✓');
        } catch (e) { CL.fail(e); }
        loadRotation();
      }
      const STRAT_MSG = { 'round-robin': 'Збережено: по черзі', 'weighted-round-robin': 'Збережено: за вагою', 'fill-first': 'Збережено: спочатку перший акаунт' };
      root.querySelectorAll('input[name="mRot"]').forEach((x) => x.addEventListener('change', () => { if (x.checked) putTuning({ routingStrategy: x.value }, STRAT_MSG[x.value]); }));
      const numIn = (id, key, max) => $(id).addEventListener('change', (e) => {
        const v = Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0)));
        e.target.value = v;
        putTuning({ [key]: v });
      });
      numIn('#tRetry', 'requestRetry', 10);
      numIn('#tCreds', 'maxRetryCredentials', 50);
      $('#tProj').addEventListener('change', (e) => putTuning({ switchProject: e.target.checked }));
      $('#tPrev').addEventListener('change', (e) => putTuning({ switchPreviewModel: e.target.checked }));

      // Pick one model in a small dialog (fallbacks, app rules).
      function pickModel(title, text, value) {
        let picker = null;
        return CL.dialog({
          title,
          html: (text ? '<div class="dlg-text">' + esc(t(text)) + '</div>' : '') + '<div data-pick></div>',
          actions: [{ label: 'Скасувати', value: null }, { label: 'Готово', kind: 'primary', onClick: (d, close) => { close(picker.get() || null); return false; } }],
          onMount: (d) => { picker = CL.ui.modelPicker(d.querySelector('[data-pick]'), { value: value || '', empty: '— обери модель —' }); },
        });
      }

      // ---------------------------------------------------------- fallbacks --
      let fallbacks = {};
      function paintFallbacks() {
        const box = $('#fbList');
        const keys = Object.keys(fallbacks);
        if (!keys.length) {
          box.innerHTML = CL.ui.empty('swap', 'Запасних моделей ще немає', 'Наприклад: якщо gemini-3-pro на ліміті — відповість gemini-3-flash.');
          return;
        }
        box.innerHTML = keys.map((k) => '<div class="fb-row" data-k="' + esc(k) + '"><span class="mono ellipsis fb-src" title="' + esc(k) + '">' + esc(k) + '</span>' + ic('arrow', 'sm') +
          '<div class="fb-chain">' + fallbacks[k].map((m, i) => '<span class="tag"><span class="fb-n">' + (i + 1) + '</span><span class="ellipsis mono">' + esc(m) + '</span><button class="linkbtn" data-fb-del="' + i + '" aria-label="' + esc(t('Прибрати')) + '">' + ic('x', 'sm') + '</button></span>').join('') +
          '<button class="btn sm ghost" data-fb-more>' + ic('plus', 'sm') + esc(t('ще одна')) + '</button></div>' +
          '<button class="btn sm icon ghost" data-fb-rm data-tip="' + esc(t('Видалити ланцюжок')) + '">' + ic('trash', 'sm') + '</button></div>').join('');
      }
      async function saveFallback(k, list) {
        try {
          await CL.config.patch({ routing: { fallbacks: { [k]: list && list.length ? list : null } } });
          if (list && list.length) fallbacks[k] = list; else delete fallbacks[k];
          paintFallbacks();
          CL.toast('Збережено ✓');
        } catch (e) { CL.fail(e); }
      }
      $('#fbAdd').addEventListener('click', async () => {
        const src = await pickModel('Запасна модель', 'Для якої моделі? Якщо вона не відповість…');
        if (!src) return;
        const to = await pickModel('Запасна модель', t('…то відповість ця модель замість {m}:', { m: src }));
        if (!to || to.toLowerCase() === src.toLowerCase()) return;
        saveFallback(src, (fallbacks[src] || []).concat([to]));
      });
      $('#fbList').addEventListener('click', async (e) => {
        const row = e.target.closest('[data-k]');
        if (!row) return;
        const k = row.dataset.k;
        const cur = (fallbacks[k] || []).slice();
        const del = e.target.closest('[data-fb-del]');
        if (del) { cur.splice(Number(del.dataset.fbDel), 1); saveFallback(k, cur); return; }
        if (e.target.closest('[data-fb-more]')) {
          const to = await pickModel('Запасна модель', t('Наступна запасна для {m}:', { m: k }));
          if (to && to.toLowerCase() !== k.toLowerCase() && !cur.some((x) => x.toLowerCase() === to.toLowerCase())) saveFallback(k, cur.concat([to]));
          return;
        }
        if (e.target.closest('[data-fb-rm]')) saveFallback(k, null);
      });

      // ---------------------------------------------------------- app rules --
      const KNOWN_APPS = [['Claude Code', 'claude-cli'], ['Codex', 'codex'], ['Cursor', 'cursor'], ['Cline', 'cline'], ['Roo Code', 'roocode'], ['Kilo Code', 'kilo'], ['OpenCode', 'opencode'], ['Qwen Code', 'qwencode'], ['Gemini CLI', 'geminicli'], ['Aider', 'aider'], ['Continue', 'continue'], ['Zed', 'zed'], ['Windsurf', 'windsurf'], ['JetBrains', 'jetbrains'], ['Open WebUI', 'open-webui'], ['LibreChat', 'librechat'], ['Cherry Studio', 'cherrystudio'], ['Chatbox', 'chatbox'], ['Goose', 'goose'], ['Crush', 'crush']];
      let rules = [];
      function paintRules() {
        const box = $('#arList');
        if (!rules.length) {
          box.innerHTML = CL.ui.empty('plug', 'Правил ще немає', 'Наприклад: Cursor завжди отримує швидку модель, а Claude Code — потужну.');
          return;
        }
        box.innerHTML = rules.map((r, i) => '<div class="ar-row' + (r.enabled === false ? ' off' : '') + '" data-i="' + i + '"><div class="grow" style="min-width:0"><b>' + esc(r.name || r.matcher) + '</b>' +
          '<div class="hint mono ellipsis">' + esc(t('User-Agent містить «{m}»', { m: r.matcher })) + '</div></div>' + ic('arrow', 'sm') +
          '<button class="btn sm mono ar-model" data-ar-model>' + esc(r.model || t('звичайні правила')) + '</button>' +
          '<label class="switch"><input type="checkbox" data-ar-on' + (r.enabled === false ? '' : ' checked') + ' aria-label="' + esc(t('Правило увімкнено')) + '"><span class="track"></span></label>' +
          '<button class="btn sm icon ghost" data-ar-rm data-tip="Видалити">' + ic('trash', 'sm') + '</button></div>').join('');
      }
      async function saveRules(next) {
        try {
          await CL.config.patch({ routing: { appRules: next } });
          rules = next;
          paintRules();
          CL.toast('Збережено ✓');
        } catch (e) { CL.fail(e); paintRules(); }
      }
      $('#arAdd').addEventListener('click', async () => {
        let picker = null;
        const id = 'ar' + CL.uid();
        const r = await CL.dialog({
          title: 'Модель для програми',
          html: '<div class="field"><label for="' + id + 'a">' + esc(t('Програма')) + '</label><select class="input" id="' + id + 'a">' + KNOWN_APPS.map(([n, m]) => '<option value="' + esc(m) + '">' + esc(n) + '</option>').join('') + '<option value="">' + esc(t('Інша…')) + '</option></select></div>' +
            '<div class="field hidden" id="' + id + 'o" style="margin-top:10px"><label for="' + id + 'm">' + esc(t('Частина User-Agent програми')) + '</label><input class="input mono" id="' + id + 'm" placeholder="my-app"><div class="hint">' + esc(t('Його видно в «Інспекторі запитів».')) + '</div></div>' +
            '<div class="field" style="margin-top:10px"><label>' + esc(t('Модель')) + '</label><div data-pick></div></div>',
          actions: [{ label: 'Скасувати', value: null }, {
            label: 'Додати', kind: 'primary', onClick: (d, close) => {
              const sel = d.querySelector('#' + id + 'a');
              const matcher = sel.value || d.querySelector('#' + id + 'm').value.trim();
              const model = picker.get();
              if (!matcher || !model) return false;
              const name = sel.value ? sel.options[sel.selectedIndex].text : matcher;
              close({ id: '', name, matcher, model, enabled: true });
              return false;
            },
          }],
          onMount: (d) => {
            picker = CL.ui.modelPicker(d.querySelector('[data-pick]'), { value: '', empty: '— обери модель —' });
            d.querySelector('#' + id + 'a').addEventListener('change', (e) => d.querySelector('#' + id + 'o').classList.toggle('hidden', !!e.target.value));
          },
        });
        if (r) saveRules(rules.concat([r]));
      });
      $('#arList').addEventListener('click', async (e) => {
        const row = e.target.closest('[data-i]');
        if (!row) return;
        const i = Number(row.dataset.i);
        if (e.target.closest('[data-ar-rm]')) { saveRules(rules.filter((_, j) => j !== i)); return; }
        if (e.target.closest('[data-ar-model]')) {
          const m = await pickModel('Модель для програми', t('Яка модель відповідає програмі {name}?', { name: rules[i].name || rules[i].matcher }), rules[i].model);
          if (m) saveRules(rules.map((r, j) => (j === i ? Object.assign({}, r, { model: m }) : r)));
        }
      });
      $('#arList').addEventListener('change', (e) => {
        const x = e.target.closest('[data-ar-on]');
        if (!x) return;
        const i = Number(x.closest('[data-i]').dataset.i);
        saveRules(rules.map((r, j) => (j === i ? Object.assign({}, r, { enabled: x.checked }) : r)));
      });
      function fillExtras(r) {
        fallbacks = JSON.parse(JSON.stringify((r && r.fallbacks) || {}));
        rules = JSON.parse(JSON.stringify((r && r.appRules) || []));
        paintFallbacks();
        paintRules();
      }

      // ------------------------------------------------------------- load --
      async function loadCatalog() {
        try {
          const cat = await CL.models();
          if (!ctx.alive()) return;
          known = new Set(cat.flat.map((x) => String(x).toLowerCase()));
          if (!cat.flat.length) known = null; // engine down or no accounts: do not guess
          if (S) { refreshEmptyLabels(); paintFlow(); }
        } catch (e) { /* preview stays neutral */ }
      }

      let routing = null;
      try { routing = (await CL.config.get()).routing || {}; } catch (e) {
        root.querySelector('[data-block="rules"]').insertAdjacentHTML('afterbegin', '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Не вдалось прочитати налаштування: {e}. Перевір, що CarteLink запущений, і онови сторінку.', { e: e.message })) + '</div></div>');
        routing = {};
      }
      if (!ctx.alive()) return;
      fill(routing);
      fillExtras(routing);
      loadCatalog();
      loadRotation();

      // Live sync: the switcher, presets or another window may change routing.
      const sync = (r) => {
        if (!r || !ctx.alive()) return;
        if (!document.querySelector('.dlg-back') && (JSON.stringify(r.fallbacks || {}) !== JSON.stringify(fallbacks) || JSON.stringify(r.appRules || []) !== JSON.stringify(rules))) fillExtras(r);
        if (JSON.stringify(r) === loaded || busy()) return;
        fill(r);
      };
      // The one-model picker follows the main model only when that changes, never over the user's pick.
      let lastMain = CL.mainModel();
      ctx.on('status', (st) => {
        if (!st) return;
        sync(st.routing);
        if (st.mainModel && st.mainModel !== lastMain) { lastMain = st.mainModel; if (!document.querySelector('.mp-pop')) allPick.set(st.mainModel); }
      });
      ctx.on('changed', (w) => {
        if (w === 'accounts' || w === 'engine') { CL.models.invalidate(); loadCatalog(); }
        if (w === 'engine') loadRotation();
      });
    },
  });

  // Mark a segmented control's current value without firing its handler.
  function segSet(el, v) { if (el) el.querySelectorAll('button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); }
})();
