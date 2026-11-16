'use strict';
// Акаунти: who answers requests, which ones are dead, bulk clean-up, sign-in
// (built-in OAuth, plugin services, Vertex JSON) and per-provider model lists.
// The plugin constants and helpers live on window.CL_PLUGINS for plugins.js.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;

  // ------------------------------------------------------------ constants --

  const OAUTH_PROVIDERS = [
    { id: 'anthropic', label: 'Claude', badge: 'Підписка', badgeClass: 'sub', tip: 'Підписка обов’язкова. Потрібен акаунт Anthropic з активною підпискою Pro, Team або API кредитами.' },
    { id: 'codex', label: 'Codex', badge: 'Підписка / API', badgeClass: 'sub', tip: 'Підписка обов’язкова. Потрібен акаунт OpenAI з активною підпискою ChatGPT Plus або Team.' },
    { id: 'antigravity', label: 'Gemini-Antigravity', badge: 'Безкоштовно', badgeClass: 'free', tip: 'Безкоштовно! Працює з будь-яким звичайним Google-акаунтом без підписок. Найвигідніший варіант для безліміту.' },
    { id: 'kimi', label: 'Kimi', badge: 'Freemium', badgeClass: 'freemium', tip: 'Freemium. Підтримує реєстрацію за номером телефону або поштою. Моделі k2/k3.' },
    { id: 'xai', label: 'xAI', badge: 'Підписка X', badgeClass: 'sub', tip: 'Підписка обов’язкова. Потрібен акаунт X (Twitter) з активною підпискою Premium або Premium+.' },
    { id: 'devin', label: 'Devin', badge: 'Freemium', badgeClass: 'freemium', tip: 'Акаунт розробника Devin або активна сесія.' },
    { id: 'meta', label: 'Meta', badge: 'Безкоштовно', badgeClass: 'free', tip: 'Безкоштовно! Потрібен звичайний акаунт Meta (Facebook / Instagram) без жодної плати.' },
  ];

  const PLUGIN_SERVICES = [
    { id: 'workbuddy', label: 'WorkBuddy', badge: 'Кредити', badgeClass: 'freemium', tip: 'Акаунт Tencent WorkBuddy / CodeBuddy → моделі GLM, DeepSeek, Kimi, Hunyuan. Доступ неофіційний: краще окремий акаунт.', plugins: ['workbuddy', 'freetier2api'] },
    { id: 'gemini-cli', label: 'Gemini CLI', badge: 'Безкоштовно', badgeClass: 'free', tip: 'Звичайний Google-акаунт через вхід Gemini CLI — окремі від Antigravity безкоштовні ліміти.', plugins: ['gemini-cli'] },
    { id: 'kiro', label: 'Kiro (AWS)', badge: 'Безкоштовно', badgeClass: 'free', tip: 'Акаунт Kiro / AWS Builder ID → моделі Claude. Після натискання введи показаний код підтвердження на сторінці AWS.', plugins: ['kiro', 'kiro-ha', 'kiro4cpa'] },
    { id: 'mirasim', label: 'Mirasim', badge: 'Акаунт', badgeClass: 'freemium', tip: 'Акаунт Mirasim → моделі Claude і GPT.', plugins: ['mirasim', 'mirasim-proxy'] },
    { id: 'clinepass', label: 'Cline Pass', badge: 'Підписка', badgeClass: 'sub', tip: 'Підписка Cline Pass. Відкриється консоль плагіна: додай API-ключ Cline Pass і завантаж моделі.', plugins: ['clinepassbridge'] },
    { id: 'commandcode', label: 'CommandCode', badge: 'API-ключ', badgeClass: 'sub', tip: 'Ключ commandcode.ai (user_…) → моделі DeepSeek і GLM (commandcode/…).', plugins: ['commandcode', 'commandcode-cliproxyapi', 'commandcode-go-cliproxyapi'] },
    { id: 'copilot', label: 'GitHub Copilot', badge: 'Підписка', badgeClass: 'sub', tip: 'Підписка GitHub Copilot.', plugins: ['github-copilot', 'cliproxyapi-copilot'] },
    { id: 'cursor', label: 'Cursor', badge: 'Підписка', badgeClass: 'sub', tip: 'Підписка Cursor.', plugins: ['spx-cursor', 'cursor-agent', 'cursor'] },
    { id: 'freetier', label: 'Qoder, Trae, MiniMax, CodeArts', badge: 'Безкоштовно', badgeClass: 'free', tip: 'Кілька сервісів з безкоштовними квотами в одному плагіні.', plugins: ['freetier2api'] },
    { id: 'opencode-go', label: 'OpenCode Go', badge: 'Підписка', badgeClass: 'sub', tip: 'Підписка OpenCode Go → 44 моделі. Вхід через браузер або ключ, залежно від плагіна.', plugins: ['opencode-go-oauth', 'opencode-go-provider', 'opencode-go-cliproxyapi'] },
    { id: 'opencode-zen', label: 'OpenCode Zen', badge: 'Безкоштовно', badgeClass: 'free', tip: 'Безкоштовні моделі OpenCode Zen. Деякі плагіни працюють без ключа.', plugins: ['oc2cpa', 'cpa-freetier-plugin', 'freetier2api'] },
    { id: 'vertex', label: 'Vertex AI', kind: 'vertex', badge: 'Google Cloud', badgeClass: 'sub', tip: 'JSON-ключ сервісного акаунта Google Cloud з увімкненим Vertex AI. Оплата — за тарифами Google Cloud.', plugins: [] },
  ];

  const PLUGIN_LOGIN = { clinepassbridge: 'console', freetier2api: 'console', commandcode: 'apikey' };
  const PLUGIN_SAFE_CONFIG = { workbuddy: { lifecycle_auto: false, daily_bonus: false, checkin_auto: false } };
  const PLUGIN_NOTES = {
    workbuddy: 'CarteLink вимикає в цьому плагіні автовидалення акаунта без кредитів і автоотримання щоденних кредитів.',
    freetier2api: 'Цей плагін сам щодня відмічається й виконує завдання сервісів, а ще підключає OpenCode Zen. Це може порушувати умови сервісів.',
  };
  const PLUGIN_NO_BUILD = { cursor: 'windows', 'cliproxyapi-copilot': 'windows', 'mirasim-proxy': 'all', 'opencode-go-pool': 'all', 'opencode-go-quota': 'all' };
  const NOT_A_SERVICE = { 'kimi-tools': true };
  const HIDDEN_PLUGINS = { 'opencode-cloak': true }; // disguises traffic as Claude Code — never offered
  const PLUGIN_STORE_TTL = 2 * 60 * 1000;
  const NO_ALIAS_PROVIDERS = { gemini: true };
  const MODEL_SUGGEST = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-opus-5', 'claude-sonnet-5', 'gpt-5.5', 'gemini-3.8-pro'];

  const BADGE_CHIP = { free: 'ok', freemium: 'info', sub: 'accent' };
  const OPEN_PROV = new Set(); // expanded provider blocks in «Моделі акаунтів»
  const enc = encodeURIComponent;

  // -------------------------------------------------- shared plugin helpers --

  const P = {
    OAUTH_PROVIDERS, PLUGIN_SERVICES, PLUGIN_LOGIN, PLUGIN_SAFE_CONFIG, PLUGIN_NOTES, PLUGIN_NO_BUILD,
    NOT_A_SERVICE, HIDDEN_PLUGINS, PLUGIN_STORE_TTL, NO_ALIAS_PROVIDERS, MODEL_SUGGEST, BADGE_CHIP,
    store: null,
    at: 0,
  };
  window.CL_PLUGINS = P;

  /** The engine HTML-escapes every store string; esc() escapes again when rendering. */
  P.unhtml = (s) => String(s == null ? '' : s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#34;/g, '"').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

  let storeBusy = null;
  /** {id: entry} of the engine's plugin store (2 min cache). */
  P.loadStore = async (force) => {
    if (!force && P.store && Date.now() - P.at < PLUGIN_STORE_TTL) return P.store;
    if (storeBusy) return storeBusy;
    storeBusy = (async () => {
      const r = (await CL.mgmt('GET', 'plugin-store')) || {};
      const byId = {};
      (r.plugins || []).forEach((p) => {
        const e = {
          id: p.id, name: P.unhtml(p.name) || p.id, description: P.unhtml(p.description), author: P.unhtml(p.author),
          version: P.unhtml(p.version), repository: P.unhtml(p.repository), tags: (p.tags || []).map(P.unhtml),
          installed: !!p.installed, enabled: !!p.enabled, registered: !!p.registered, update: !!p.update_available,
        };
        if (e.id && !HIDDEN_PLUGINS[e.id]) byId[e.id] = e;
      });
      P.store = byId;
      P.at = Date.now();
      CL.emit('plugins', byId);
      return byId;
    })().finally(() => { storeBusy = null; });
    return storeBusy;
  };

  P.isProvider = (p) => !NOT_A_SERVICE[p.id] && (p.tags || []).some((x) => String(x).toLowerCase() === 'provider');

  /** Curated services, then one service per provider plugin they don't cover. */
  P.services = () => {
    const out = PLUGIN_SERVICES.map((s) => Object.assign({}, s));
    if (!P.store) return out;
    const known = {};
    out.forEach((s) => s.plugins.forEach((id) => { known[id] = true; }));
    Object.values(P.store).filter((p) => P.isProvider(p) && !known[p.id])
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((p) => out.push({ id: 'plugin:' + p.id, label: p.name, badge: 'Плагін', badgeClass: 'sub', tip: p.description, plugins: [p.id] }));
    return out;
  };
  P.serviceOf = (id) => P.services().find((s) => s.plugins.indexOf(id) >= 0) || null;
  P.noBuild = (id) => {
    const v = PLUGIN_NO_BUILD[id];
    return v === 'all' || (v === 'windows' && /win/i.test(navigator.platform || ''));
  };
  P.onDisk = (p) => !!(p && (p.installed || p.registered));

  P.chips = (p) => {
    if (P.noBuild(p.id)) return '<span class="chip outline">' + esc(t(PLUGIN_NO_BUILD[p.id] === 'all' ? 'Немає збірки' : 'Немає для Windows')) + '</span>';
    let h = '';
    if (P.onDisk(p)) h += p.enabled ? '<span class="chip ok">' + esc(t('Встановлено')) + '</span>' : '<span class="chip">' + esc(t('Вимкнено')) + '</span>';
    if (p.update) h += ' <span class="chip info">' + esc(t('Є оновлення {version}', { version: p.version })) + '</span>';
    return h;
  };
  P.meta = (p) => {
    const bits = [];
    if (p.version) bits.push('v' + esc(p.version.replace(/^v/, '')));
    if (p.author) bits.push(esc(p.author));
    if (/^https:\/\//.test(p.repository)) bits.push('<a href="' + esc(p.repository) + '" target="_blank" rel="noopener">GitHub ' + ic('external', 'sm') + '</a>');
    return bits.join(' · ');
  };

  /** The engine's loaded plugins: [{id, registered, enabled, path, supports_oauth, oauth_provider, menus, config_fields}]. */
  P.list = async () => (((await CL.mgmt('GET', 'plugins')) || {}).plugins || []);
  P.info = async (id) => (await P.list()).find((x) => x.id === id) || {};

  /** Install (once) and load a store plugin; resolves when the engine has it. */
  P.ensure = async (id, label, onStatus) => {
    let cur = (await P.list()).find((x) => x.id === id);
    if (cur && cur.registered && cur.enabled) return cur;
    if (!cur || !(cur.path || cur.registered)) {
      const yes = await CL.confirm(t('Встановити плагін «{name}» з магазину плагінів рушія? Це сторонній код із GitHub, він працюватиме всередині CarteLink.', { name: label }), { ok: 'Встановити', title: 'Встановити плагін' });
      if (!yes) { const e = new Error(t('Скасовано')); e.cancelled = true; throw e; }
      if (onStatus) onStatus(t('Завантажую плагін {name}…', { name: label }));
      await CL.mgmt('POST', 'plugin-store/' + enc(id) + '/install', {});
    } else if (!cur.enabled) {
      if (onStatus) onStatus(t('Вмикаю плагін {name}…', { name: label }));
      await CL.mgmt('PATCH', 'plugins/' + enc(id) + '/enabled', { enabled: true });
    }
    for (let i = 0; i < 20; i++) {
      await CL.sleep(1000);
      cur = (await P.list()).find((x) => x.id === id);
      if (cur && cur.registered && cur.enabled) return cur;
    }
    throw new Error(t('Плагін {name} не запустився — подивись app.log', { name: label }));
  };

  /** Safe defaults for keys the user never set (user-changed values are kept). */
  P.safeConfig = async (id) => {
    const safe = PLUGIN_SAFE_CONFIG[id];
    if (!safe) return;
    const cfg = (await CL.mgmt('GET', 'plugins/' + enc(id) + '/config')) || {};
    const patch = {};
    Object.keys(safe).forEach((k) => { if (cfg[k] === undefined) patch[k] = safe[k]; });
    if (Object.keys(patch).length) await CL.mgmt('PATCH', 'plugins/' + enc(id) + '/config', patch);
  };

  P.consoleUrl = (id, info) => {
    const menu = info && info.menus && info.menus[0];
    return location.origin + (menu ? P.unhtml(menu.path) : '/v0/resource/plugins/' + id + '/console');
  };

  P.errorText = (e) => {
    const m = String((e && e.message) || e);
    if (/restart/i.test(m)) return t('Плагін зараз завантажений. Перезапусти CarteLink і спробуй ще раз.');
    return t('Не вдалось: {e}', { e: m });
  };

  /** Confirm + delete a plugin. Resolves true when it was removed. */
  P.remove = async (id) => {
    const name = P.store && P.store[id] ? P.store[id].name : id;
    if (!(await CL.confirm(t('Видалити плагін «{name}»? Акаунти, додані через нього, не працюватимуть, поки не встановиш його знову.', { name }), { danger: true, ok: 'Видалити плагін' }))) return false;
    try {
      await CL.mgmt('DELETE', 'plugins/' + enc(id));
      CL.toast(t('Плагін {name} видалено ✓', { name }));
    } catch (e) {
      CL.toast(P.errorText(e), 'bad');
      return false;
    }
    await P.loadStore(true).catch(() => {});
    return true;
  };

  // --------------------------------------------------- sign-in flow state --
  // Lives outside the page so an OAuth wait survives switching pages.

  const flow = { state: 'idle' };
  let flowHost = null; // element of the currently rendered page
  let pageApi = null; // {alive, reload, reloadModels}
  let flowTimer = null;
  let tick = null;

  function setFlow(next) {
    if (flowTimer && next.state !== 'wait') { clearTimeout(flowTimer); flowTimer = null; }
    Object.keys(flow).forEach((k) => delete flow[k]);
    Object.assign(flow, next);
    paintFlow();
  }

  function paintFlow() {
    if (!flowHost || !document.contains(flowHost)) return;
    clearInterval(tick);
    const f = flow;
    if (f.state === 'idle') { flowHost.innerHTML = ''; flowHost.hidden = true; return; }
    flowHost.hidden = false;
    let h = '';
    if (f.state === 'busy') {
      h = '<div class="acc-flow"><div class="row nw"><span class="acc-spin"></span><b class="grow">' + esc(f.text || t('Зачекай…')) + '</b></div></div>';
    } else if (f.state === 'wait') {
      h = '<div class="acc-flow wait"><div class="row nw top"><span class="acc-spin" style="margin-top:3px"></span><div class="grow">' +
        '<b>' + esc(t('Чекаю, поки ти увійдеш у {name}', { name: f.name || '' })) + '</b>' +
        '<div class="muted small" style="margin-top:3px">' + esc(f.note || t('Сторінка входу відкрилась в окремому чистому вікні браузера. Увійди там — акаунт з’явиться в списку сам, а вікно закриється.')) + '</div>' +
        (f.code ? '<div class="row" style="margin-top:12px"><span class="small muted">' + esc(t('Код підтвердження')) + '</span><span class="acc-code">' + esc(f.code) + '</span><button class="btn sm ghost" data-copy="' + esc(f.code) + '">' + ic('copy', 'sm') + esc(t('Копіювати')) + '</button></div>' : '') +
        '<div class="row" style="margin-top:12px">' +
          (f.url ? '<a class="btn sm" href="' + esc(f.url) + '" target="_blank" rel="noopener">' + ic('external', 'sm') + esc(t('Відкрити сторінку входу')) + '</a><button class="btn sm ghost" data-copy="' + esc(f.url) + '">' + ic('link', 'sm') + esc(t('Копіювати посилання')) + '</button>' : '') +
          '<span class="grow"></span><span class="small faint num" id="aFlowLeft"></span>' +
          (f.oauthState ? '<button class="btn sm danger" id="aFlowCancel">' + ic('x', 'sm') + esc(t('Скасувати вхід')) + '</button>' : '<button class="btn sm" id="aFlowDone">' + ic('check', 'sm') + esc(t('Я увійшов')) + '</button>') +
        '</div></div></div></div>';
    } else if (f.state === 'console') {
      h = '<div class="acc-flow"><div class="row nw top">' + ic('external') + '<div class="grow"><b>' + esc(t('Консоль плагіна {name} відкрито', { name: f.name || '' })) + '</b>' +
        '<div class="muted small" style="margin-top:3px">' + esc(t('Додай там акаунт або ключ — моделі з’являться у списках за хвилину.')) + '</div>' +
        '<div class="row" style="margin-top:10px"><a class="btn sm" href="' + esc(f.url) + '" target="_blank" rel="noopener">' + ic('external', 'sm') + esc(t('Відкрити консоль ще раз')) + '</a></div></div>' +
        '<button class="btn sm icon ghost" data-flow-close aria-label="' + esc(t('Закрити')) + '">' + ic('x', 'sm') + '</button></div></div>';
    } else {
      const ok = f.state === 'ok';
      h = '<div class="acc-flow ' + (ok ? 'ok' : 'err') + '"><div class="row nw top">' + ic(ok ? 'check' : 'alert') + '<div class="grow"><b style="white-space:normal">' + esc(f.text || '') + '</b>' +
        (f.hint ? '<div class="muted small" style="margin-top:3px">' + esc(f.hint) + '</div>' : '') +
        (f.goHome ? '<div class="row" style="margin-top:10px"><button class="btn sm" data-goto="home">' + esc(t('На Огляд')) + ic('arrow', 'sm') + '</button></div>' : '') +
        '</div><button class="btn sm icon ghost" data-flow-close aria-label="' + esc(t('Закрити')) + '">' + ic('x', 'sm') + '</button></div></div>';
    }
    flowHost.innerHTML = h;
    const c = flowHost.querySelector('#aFlowCancel');
    if (c) c.onclick = () => cancelFlow(true);
    const d = flowHost.querySelector('#aFlowDone');
    if (d) d.onclick = () => { setFlow({ state: 'idle' }); reloadPage(); };
    const x = flowHost.querySelector('[data-flow-close]');
    if (x) x.onclick = () => setFlow({ state: 'idle' });
    if (f.state === 'wait' && f.deadline) {
      const left = () => { const el = flowHost.querySelector('#aFlowLeft'); if (el) el.textContent = t('залишилось {t}', { t: CL.fmtLeft(f.deadline - Date.now()) }); };
      left();
      tick = setInterval(left, 15000);
    }
  }

  function reloadPage() { if (pageApi && pageApi.alive()) pageApi.reload(true); }

  async function cancelFlow(userAsked) {
    const st = flow.oauthState;
    setFlow({ state: 'idle' });
    if (st) await CL.api.del('/cliproxy/oauth/cancel?state=' + enc(st)).catch(() => {});
    if (userAsked) CL.toast('Вхід скасовано', 'info');
  }

  /** Built-in OAuth (and plugin logins that use it): open, then wait for the account. */
  async function startOauth(provider, name) {
    name = name || CL.provTitle(provider);
    if (flow.state === 'wait') {
      if (!(await CL.confirm(t('Зараз уже триває вхід у {name}. Скасувати його й почати новий?', { name: flow.name || '' }), { ok: 'Почати новий' }))) return;
      await cancelFlow(false);
    }
    let st = CL.status;
    try { st = await CL.loadStatus(); } catch (e) { /* use the last one */ }
    if (!st || !st.engine || !st.engine.engineUp) {
      setFlow({ state: 'err', text: t('Рушій зараз не працює, тому вхід неможливий.'), hint: t('Натисни «Запустити» на Огляді й спробуй ще раз за кілька секунд.'), goHome: true });
      return;
    }
    setFlow({ state: 'busy', text: t('Запускаю вхід {name}…', { name }) });
    if (flowHost && document.contains(flowHost)) flowHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    let r;
    try { r = await CL.api.post('/cliproxy/oauth/start', { provider }); } catch (e) {
      setFlow({ state: 'err', text: t('Не вдалось почати вхід {name}: {e}', { name, e: e.message }), hint: t('Спробуй ще раз. Якщо повторюється — перезапусти шлюз на Огляді.') });
      return;
    }
    if (!r || !r.url) {
      setFlow({ state: 'err', text: t('Не вдалось почати вхід {name}: {e}', { name, e: (r && (r.error || r.message)) || t('сервіс не дав посилання') }) });
      return;
    }
    let code = '';
    try { code = new URL(r.url, location.href).searchParams.get('user_code') || ''; } catch (e) { /* no code */ }
    const stateId = r.state || '';
    setFlow({ state: 'wait', name, provider, url: r.url, code, oauthState: stateId, deadline: Date.now() + 10 * 60 * 1000, unknown: 0 });
    if (stateId) flowTimer = setTimeout(() => pollOauth(stateId), 2500);
  }

  async function pollOauth(stateId) {
    if (flow.state !== 'wait' || flow.oauthState !== stateId) return;
    if (Date.now() > flow.deadline) {
      setFlow({ state: 'err', text: t('Час очікування входу вичерпано (10 хв).'), hint: t('Спробуй ще раз — посилання для входу діє обмежений час.') });
      CL.api.del('/cliproxy/oauth/cancel?state=' + enc(stateId)).catch(() => {});
      return;
    }
    let j = null;
    try { j = await CL.api.get('/cliproxy/oauth/status?state=' + enc(stateId)); } catch (e) { j = e.data || null; /* network errors are transient */ }
    if (flow.state !== 'wait' || flow.oauthState !== stateId) return;
    if (j) {
      const s = j.status || '';
      if (s === 'ok' || s === 'success' || j.completed === true) {
        const name = flow.name;
        setFlow({ state: 'ok', text: t('Акаунт {name} додано ✓', { name }), hint: t('Список оновлюється. Моделі акаунта з’являться за кілька секунд.') });
        CL.toast(t('Акаунт {name} додано ✓', { name }));
        CL.api.post('/cliproxy/oauth/close-browser').catch(() => {});
        CL.models.invalidate();
        reloadPage();
        return;
      }
      if (s === 'error' || j.error) {
        const em = String((j.error && (j.error.message || j.error)) || j.message || '');
        if (em.indexOf('unknown or expired') >= 0) {
          flow.unknown = (flow.unknown || 0) + 1;
          if (flow.unknown === 1) {
            flow.note = t('Перевіряю результат входу…');
            paintFlow();
            reloadPage();
          } else {
            setFlow({ state: 'ok', text: t('Готово: сесію входу завершено.'), hint: t('Якщо акаунта немає у списку — спробуй увійти ще раз.') });
            reloadPage();
            return;
          }
        } else {
          setFlow({ state: 'err', text: t('Вхід не вдався: {e}', { e: em }), hint: t('Спробуй ще раз. Якщо помилка повторюється — перевір, чи акаунт має потрібну підписку.') });
          return;
        }
      }
    }
    flowTimer = setTimeout(() => pollOauth(stateId), 2500);
  }

  // -------------------------------------------------- plugin sign-in flow --

  async function openPicker(svcId, preselect) {
    let store;
    try { store = await P.loadStore(); } catch (e) { CL.toast(t('Не вдалось завантажити магазин плагінів: {e}', { e: e.message }), 'bad'); return; }
    const svc = P.services().find((s) => s.id === svcId);
    if (!svc) { CL.toast('Цього сервісу немає в магазині плагінів', 'bad'); return; }
    if (svc.kind === 'vertex') { pickVertexFile(); return; }
    const entries = svc.plugins.map((id) => store[id]).filter(Boolean);
    if (!entries.length) { CL.toast(t('У магазині немає плагіна для {name}', { name: svc.label }), 'bad'); return; }
    const usable = entries.filter((p) => !P.noBuild(p.id));
    let sel = preselect && usable.some((p) => p.id === preselect) ? preselect : ((usable.find((p) => p.enabled) || usable[0] || {}).id || '');
    const goLabel = (id) => { const p = store[id]; if (!p) return t('Увійти'); return p.enabled && P.onDisk(p) ? t('Увійти') : P.onDisk(p) ? t('Увімкнути й увійти') : t('Встановити й увійти'); };
    const html =
      '<div class="banner" style="margin-bottom:14px">' + ic('shield') + '<div class="small">' + esc(t('Плагіни — це сторонній код із GitHub. Він працює всередині CarteLink з повним доступом. Вхід через плагін зазвичай неофіційний і може порушувати умови сервісу, тому для нових сервісів краще брати окремий акаунт.')) + '</div></div>' +
      '<div class="acc-choices" role="radiogroup">' + entries.map((p) => {
        const off = P.noBuild(p.id);
        return '<label class="acc-choice' + (off ? ' off' : '') + (p.id === sel ? ' on' : '') + '"><input type="radio" name="accPlug" value="' + esc(p.id) + '"' + (p.id === sel ? ' checked' : '') + (off ? ' disabled' : '') + '>' +
          '<div class="grow"><div class="row" style="gap:8px"><b>' + esc(p.name) + '</b>' + P.chips(p) + '</div>' +
          (p.description ? '<div class="small muted" style="margin-top:3px">' + esc(p.description) + '</div>' : '') +
          (PLUGIN_NOTES[p.id] ? '<div class="small" style="margin-top:4px;color:var(--warn)">' + esc(t(PLUGIN_NOTES[p.id])) + '</div>' : '') +
          '<div class="row small faint" style="margin-top:4px;gap:6px">' + P.meta(p) +
          (P.onDisk(p) ? '<span class="grow"></span><button type="button" class="linkbtn small" data-rm="' + esc(p.id) + '" style="color:var(--bad)">' + esc(t('Видалити плагін')) + '</button>' : '') + '</div>' +
          '</div></label>';
      }).join('') + '</div>';
    const choice = await CL.dialog({
      title: t('Обери плагін для {name}', { name: svc.label }),
      wide: true,
      html,
      actions: [{ label: 'Скасувати', value: null }, { label: 'Увійти', kind: 'primary', onClick: (d, close) => { if (sel) close(sel); return false; } }],
      onMount: (d, close) => {
        const go = d.querySelector('.dlg-actions .btn.primary');
        const paintGo = () => { go.innerHTML = ic('login', 'sm') + esc(goLabel(sel)); go.disabled = !sel; };
        paintGo();
        d.querySelectorAll('input[name="accPlug"]').forEach((r) => r.addEventListener('change', () => {
          sel = r.value;
          d.querySelectorAll('.acc-choice').forEach((l) => l.classList.toggle('on', l.contains(r)));
          paintGo();
        }));
        d.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); close('rm:' + b.dataset.rm); }));
      },
    });
    if (!choice) return;
    if (choice.indexOf('rm:') === 0) {
      await P.remove(choice.slice(3));
      paintPluginTiles();
      openPicker(svcId);
      return;
    }
    await connectPlugin(svc, choice);
  }

  async function connectPlugin(svc, id) {
    const store = P.store || {};
    const label = store[id] ? store[id].name : id;
    try {
      // One active plugin per service: two of them may claim the same provider.
      for (const other of svc.plugins) {
        const o = store[other];
        if (other === id || !o || !o.enabled) continue;
        const yes = await CL.confirm(t('Для {service} зараз працює плагін «{name}». Вимкнути його й підключатись через вибраний? Акаунти старого плагіна не працюватимуть, поки його не ввімкнути.', { service: svc.label, name: o.name }), { ok: 'Вимкнути й продовжити' });
        if (!yes) return;
        await CL.mgmt('PATCH', 'plugins/' + enc(other) + '/enabled', { enabled: false });
      }
      setFlow({ state: 'busy', text: t('Готую плагін {name}…', { name: label }) });
      if (flowHost && document.contains(flowHost)) flowHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const info = await P.ensure(id, label, (text) => setFlow({ state: 'busy', text }));
      await P.safeConfig(id);
      const how = PLUGIN_LOGIN[id];
      if (how === 'apikey') await addPluginKey(id, label);
      else if (how === 'console') openConsole(id, label, info);
      else if (info.supports_oauth && info.oauth_provider) await startOauth(P.unhtml(info.oauth_provider), svc.label);
      else if (info.menus && info.menus.length) openConsole(id, label, info);
      else await pluginConfigForm(id, label, info);
    } catch (e) {
      if (e && e.cancelled) setFlow({ state: 'idle' });
      else setFlow({ state: 'err', text: P.errorText(e), hint: t('Якщо плагін щойно встановлено, зачекай кілька секунд і спробуй ще раз.') });
    }
    P.loadStore(true).then(paintPluginTiles).catch(() => {});
  }

  function openConsole(id, label, info) {
    const url = P.consoleUrl(id, info);
    setFlow({ state: 'console', name: label, url });
    window.open(url, '_blank');
  }

  async function addPluginKey(id, label) {
    const key = await CL.prompt(t('API-ключ {name}', { name: label }), { type: 'password', mono: true, text: 'Ключ збережеться в налаштуваннях плагіна. Моделі з’являться у списках за хвилину.', ok: 'Додати ключ' });
    if (!key) { setFlow({ state: 'idle' }); return; }
    const cfg = (await CL.mgmt('GET', 'plugins/' + enc(id) + '/config')) || {};
    const keys = Array.isArray(cfg.api_keys) ? cfg.api_keys.filter((k) => k && k.key !== key) : [];
    keys.push({ key, weight: 10 });
    await CL.mgmt('PATCH', 'plugins/' + enc(id) + '/config', { api_keys: keys });
    setFlow({ state: 'ok', text: t('Ключ {name} додано ✓', { name: label }), hint: t('Моделі з’являться у списках за хвилину.') });
    CL.models.invalidate();
    setTimeout(reloadPage, 3000);
  }

  /** A plugin with no sign-in page of its own: edit the settings it declares. */
  async function pluginConfigForm(id, label, info) {
    const fields = info.config_fields || [];
    if (!fields.length) { setFlow({ state: 'ok', text: t('Плагін {name} готовий. Вхід не потрібен.', { name: label }) }); return; }
    const cfg = (await CL.mgmt('GET', 'plugins/' + enc(id) + '/config')) || {};
    const isJson = (f) => f.type === 'array' || f.type === 'object';
    const html = '<div class="dlg-text">' + esc(t('Плагін не має власної сторінки входу. Заповни його налаштування — порожнє поле означає значення за замовчуванням.')) + '</div><div class="stack" style="gap:12px">' +
      fields.map((f, i) => {
        const name = P.unhtml(f.name);
        const val = cfg[name];
        const fid = 'apf' + i;
        let input;
        if (f.type === 'boolean') input = '<label class="check"><input type="checkbox" id="' + fid + '" data-i="' + i + '"' + (val ? ' checked' : '') + '><span class="mono">' + esc(name) + '</span></label>';
        else if (f.type === 'enum') input = '<select class="select" id="' + fid + '" data-i="' + i + '"><option value=""></option>' + (f.enum_values || []).map((o) => { const v = P.unhtml(o); return '<option' + (v === val ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select>';
        else if (isJson(f)) input = '<textarea class="textarea" rows="3" id="' + fid + '" data-i="' + i + '">' + esc(val === undefined ? '' : JSON.stringify(val, null, 2)) + '</textarea>';
        else input = '<input class="input mono" id="' + fid + '" type="' + (/key|token|secret|password/i.test(name) ? 'password' : 'text') + '" data-i="' + i + '" value="' + esc(val === undefined || val === null ? '' : val) + '">';
        return '<div class="field">' + (f.type === 'boolean' ? '' : '<label class="mono" for="' + fid + '">' + esc(name) + '</label>') + input + (f.description ? '<span class="hint">' + esc(P.unhtml(f.description)) + '</span>' : '') + '</div>';
      }).join('') + '</div><div class="hint" id="apfErr" style="color:var(--bad);margin-top:10px"></div>';
    const saved = await CL.dialog({
      title: t('Налаштування плагіна {name}', { name: label }),
      wide: true,
      sticky: true,
      html,
      actions: [{ label: 'Скасувати', value: null }, {
        label: 'Зберегти', kind: 'primary', onClick: async (d, close) => {
          const err = d.querySelector('#apfErr');
          err.textContent = '';
          const patch = {};
          try {
            d.querySelectorAll('[data-i]').forEach((el) => {
              const f = fields[Number(el.dataset.i)];
              const name = P.unhtml(f.name);
              if (f.type === 'boolean') { patch[name] = el.checked; return; }
              const raw = el.value.trim();
              if (!raw) { patch[name] = null; return; }
              if (isJson(f)) { try { patch[name] = JSON.parse(raw); } catch (e) { throw new Error(t('Невірний JSON у полі {name}', { name })); } }
              else if (f.type === 'number' || f.type === 'integer') { const n = Number(raw); if (!isFinite(n)) throw new Error(t('У полі {name} має бути число', { name })); patch[name] = n; }
              else patch[name] = raw;
            });
            await CL.mgmt('PATCH', 'plugins/' + enc(id) + '/config', patch);
          } catch (e) { err.textContent = P.errorText(e); return false; }
          close(true);
          return false;
        },
      }],
    });
    if (!saved) { setFlow({ state: 'idle' }); return; }
    setFlow({ state: 'ok', text: t('Плагін {name} налаштовано ✓', { name: label }), hint: t('Моделі з’являться у списках за хвилину.') });
    CL.models.invalidate();
    setTimeout(reloadPage, 3000);
  }

  // --------------------------------------------------------- Vertex AI --

  function pickVertexFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.addEventListener('change', () => { if (inp.files && inp.files[0]) importVertex(inp.files[0]); });
    inp.click();
  }

  async function importVertex(file) {
    const loc = await CL.prompt('Регіон Vertex AI', { value: 'us-central1', mono: true, title: 'Імпорт ключа Vertex AI', text: 'Регіон, у якому ввімкнено Vertex AI. Якщо не знаєш — залиш us-central1.', ok: 'Імпортувати' });
    if (loc === null) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('location', loc || 'us-central1');
    setFlow({ state: 'busy', text: t('Імпортую ключ Vertex AI…') });
    try {
      const r = await CL.api('/cliproxy/api/vertex/import', { method: 'POST', body: fd });
      setFlow({ state: 'ok', text: t('Vertex AI підключено ✓ ({p})', { p: (r && r.project_id) || file.name }) });
      CL.models.invalidate();
      reloadPage();
    } catch (e) {
      setFlow({ state: 'err', text: t('Не вдалось імпортувати ключ Vertex AI: {e}', { e: e.message }), hint: t('Потрібен JSON-ключ сервісного акаунта Google Cloud з увімкненим Vertex AI.') });
    }
  }

  // ------------------------------------------------------- tiles (add) --

  let tilesHost = null;
  function tile(attr, label, verb, badge, badgeClass, tip) {
    return '<button type="button" class="acc-tile" ' + attr + ' data-tip="' + esc(t(tip || '')) + '">' +
      '<span class="acc-tile-h"><span class="avatar">' + esc(String(label).replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?') + '</span><b>' + esc(label) + '</b><span class="chip ' + (BADGE_CHIP[badgeClass] || '') + '">' + esc(t(badge)) + '</span></span>' +
      '<span class="acc-tile-v">' + ic(verb === 'json' ? 'upload' : 'login', 'sm') + esc(verb === 'json' ? t('Імпорт JSON-ключа') : t('Увійти')) + '</span></button>';
  }
  function paintPluginTiles() {
    if (!tilesHost || !document.contains(tilesHost)) return;
    tilesHost.innerHTML = P.services().map((s) => tile('data-svc="' + esc(s.id) + '"', s.label, s.kind === 'vertex' ? 'json' : 'login', s.badge, s.badgeClass, s.tip)).join('');
  }

  // ----------------------------------------------------------- helpers --

  const RANK = { invalid: 0, error: 1, limited: 2, warn: 3, ok: 4, disabled: 5 };
  const pct = (p) => (p < 10 && p !== 0 ? Number(p).toFixed(1) : String(Math.round(p))) + '%';
  const winName = (w) => (w.key === '5h' ? t('5 годин') : w.key === 'week' ? t('Тиждень') : w.label || t('Ліміт'));
  const isBroken = (a) => a.state === 'invalid' || a.state === 'error';
  const accName = (a) => a.label || a.name;

  function stateText(a) {
    const m = a.message ? String(a.message) : '';
    const base = {
      invalid: 'Сервіс відхилив вхід: токен відкликано, прострочено або акаунт заблоковано. Само це не мине — увійди знову або видали акаунт.',
      error: 'Запити через цей акаунт зараз закінчуються помилкою. Якщо це повторюється — увійди знову.',
      limited: 'Вичерпано ліміт провайдера. Акаунт відпочиває й повернеться сам.',
      warn: 'Акаунт майже вичерпав ліміт.',
      disabled: 'Акаунт вимкнено — запити на нього не йдуть.',
      ok: 'Акаунт працює.',
    }[a.state] || '';
    return t(base) + (m ? ' ' + t('Відповідь сервісу: {m}', { m }) : '');
  }

  // ------------------------------------------------------------- page --

  CL.page('accounts', {
    title: 'Акаунти', icon: 'users', group: 'gateway', order: 30,

    async render(root, ctx) {
      const STYLE = '<style>' +
        '.acc-page .acc-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}' +
        '.acc-page .acc-n{margin-inline-start:6px;font-size:11px;color:var(--text-3);font-variant-numeric:tabular-nums}' +
        '.acc-page .seg button.on .acc-n{color:var(--text-2)}' +
        '.acc-page .acc-selbar{position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;margin-bottom:10px;border-radius:var(--radius-sm);border:var(--border-w) solid color-mix(in srgb,var(--accent) 45%,transparent);background:color-mix(in srgb,var(--accent) 13%,var(--surface));box-shadow:var(--shadow);animation:accin calc(260ms*var(--t)) var(--ease)}' +
        '@keyframes accin{from{opacity:0;transform:translateY(-6px)}}' +
        '.acc-page .acc-tablewrap{max-height:min(70vh,780px);border:var(--border-w) solid var(--line)}' +
        '.acc-page .table td.acc-cb,.acc-page .table th.acc-cb{width:38px;padding-inline-end:0}' +
        '.acc-page .table input[type=checkbox]{width:16px;height:16px;accent-color:var(--accent);margin:0;cursor:pointer;vertical-align:middle}' +
        '.acc-page .table tbody tr{cursor:pointer}' +
        '.acc-page .acc-who{min-width:0}.acc-page .acc-who b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px}' +
        '.acc-page .acc-who span{display:block;color:var(--text-3);font-size:12px;white-space:nowrap}' +
        '.acc-page .acc-lim{display:grid;grid-template-columns:62px minmax(70px,1fr) 42px;align-items:center;gap:8px;font-size:12px;min-width:180px}' +
        '.acc-page .acc-lim+.acc-lim{margin-top:5px}' +
        '.acc-page .acc-flow{margin-bottom:16px;padding:14px;border-radius:var(--radius);border:var(--border-w) solid var(--line-strong);background:var(--surface-2);animation:accin calc(260ms*var(--t)) var(--ease)}' +
        '.acc-page .acc-flow.wait{border-color:color-mix(in srgb,var(--accent) 55%,transparent)}' +
        '.acc-page .acc-flow.ok{border-color:color-mix(in srgb,var(--ok) 50%,transparent);background:var(--ok-soft)}.acc-page .acc-flow.ok>.row>svg{color:var(--ok)}' +
        '.acc-page .acc-flow.err{border-color:color-mix(in srgb,var(--bad) 50%,transparent);background:var(--bad-soft)}.acc-page .acc-flow.err>.row>svg{color:var(--bad)}' +
        '.acc-spin{width:16px;height:16px;flex:none;border-radius:50%;border:2px solid var(--accent);border-inline-end-color:transparent;animation:spin .8s linear infinite}' +
        '.acc-code{font:650 20px/1.2 var(--font-mono);letter-spacing:.12em;padding:6px 12px;border-radius:var(--radius-sm);background:var(--surface);border:1px dashed var(--line-strong)}' +
        '.acc-page .acc-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}' +
        '.acc-page table.no-lim th:nth-child(4),.acc-page table.no-lim td:nth-child(4){display:none}' + '.acc-page .acc-tile{display:flex;flex-direction:column;gap:8px;padding:11px 12px;border-radius:var(--radius);border:var(--border-w) solid transparent;background:transparent;color:var(--text);cursor:pointer;text-align:start;transition:border-color var(--dur),transform var(--dur) var(--ease),background var(--dur)}' +
        '.acc-page .acc-tile:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--line));background:var(--surface-3);transform:translateY(-1px)}' +
        '.acc-page .acc-tile-h{display:flex;align-items:center;gap:9px;min-width:0}.acc-page .acc-tile-h b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}' +
        '.acc-page .acc-tile .avatar{width:28px;height:28px;font-size:11px}' +
        '.acc-page .acc-tile-v{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-3)}.acc-page .acc-tile:hover .acc-tile-v{color:var(--accent)}' +
        '.acc-page .acc-h3{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-3);margin:18px 0 9px}' +
        '.acc-page .acc-h3:first-of-type{margin-top:0}' +
        '.acc-page .acc-prov{border:var(--border-w) solid var(--line);border-radius:var(--radius);background:var(--surface-2);margin-bottom:10px}' +
        '.acc-page .acc-prov>summary{list-style:none;display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-radius:var(--radius)}' +
        '.acc-page .acc-prov>summary::-webkit-details-marker{display:none}' +
        '.acc-page .acc-prov>summary .acc-chev{transition:transform var(--dur) var(--ease)}.acc-page .acc-prov[open]>summary .acc-chev{transform:rotate(180deg)}' +
        '.acc-page .acc-prov-b{padding:2px 12px 14px}' +
        '.acc-page .tag .acc-x{border:0;background:none;color:var(--text-3);cursor:pointer;padding:0;display:grid;place-items:center}.acc-page .tag .acc-x:hover{color:var(--bad)}' +
        '.acc-page .tag.acc-alias{border-color:color-mix(in srgb,var(--accent) 50%,transparent);background:var(--accent-soft)}' +
        '.acc-page .tag.acc-hidden{cursor:pointer;color:var(--text-3);border-style:dashed}.acc-page .tag.acc-hidden:hover{color:var(--text);border-color:var(--accent)}' +
        '.acc-page .acc-add{display:grid;grid-template-columns:minmax(160px,1fr) auto minmax(200px,1.2fr) auto;gap:8px;align-items:center;margin-top:12px}' +
        '@media (max-width:900px){.acc-page .acc-add{grid-template-columns:1fr}}' +
        '.acc-menu{position:fixed;z-index:960;min-width:210px;padding:4px;background:var(--surface);border:var(--border-w) solid var(--line-strong);border-radius:var(--radius);box-shadow:var(--shadow-pop);animation:dlgin calc(180ms*var(--t)) var(--ease)}' +
        '.acc-mi{display:flex;align-items:center;gap:9px;width:100%;border:0;background:none;padding:8px 10px;border-radius:6px;text-align:start;cursor:pointer;color:var(--text);font-size:13px}' +
        '.acc-mi:hover,.acc-mi:focus-visible{background:var(--surface-2);box-shadow:none}.acc-mi.bad{color:var(--bad)}' +
        '.acc-menu hr{border:0;height:1px;background:var(--line);margin:4px 2px}' +
        '.acc-choices{display:flex;flex-direction:column;gap:8px}' +
        '.acc-choice{display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:var(--radius);border:var(--border-w) solid var(--line);background:var(--surface-2);cursor:pointer;transition:border-color var(--dur)}' +
        '.acc-choice.on{border-color:var(--accent);background:var(--accent-soft)}.acc-choice.off{opacity:.5;cursor:not-allowed}' +
        '.acc-choice input{margin-top:3px;accent-color:var(--accent)}' +
        '</style>';

      root.classList.add('acc-page');
      root.innerHTML = STYLE +
        '<div class="blocks" data-area="accounts">' +
        '<section class="block card" data-block="list" data-w="12" data-title="Підключені акаунти">' +
          '<div class="card-h"><div class="card-icon">' + ic('users') + '</div><h2>' + esc(t('Підключені акаунти')) + '</h2><span class="sub" id="aCount"></span><span class="grow"></span>' +
            '<button class="btn sm ghost icon" id="aRefresh" data-tip="Оновити стан акаунтів">' + ic('rotate', 'sm') + '</button>' +
            '<button class="btn sm" id="aCheck" data-tip="' + esc(t('Оновлює вхід кожного акаунта в сервісі й показує, які вже не працюють')) + '">' + ic('shield', 'sm') + esc(t('Перевірити вхід')) + '</button>' +
            '<button class="btn sm ghost" id="aDelAll" style="color:var(--bad)" disabled>' + ic('trash', 'sm') + esc(t('Видалити всі акаунти')) + '</button>' +
          '</div>' +
          '<div id="aBroken"></div>' +
          '<div class="acc-bar"><div class="seg" id="aFilter" role="tablist">' +
            [['all', 'Усі'], ['ok', 'Працюють'], ['limited', 'Ліміт'], ['broken', 'Не працюють'], ['disabled', 'Вимкнені']].map(([v, l]) => '<button type="button" data-v="' + v + '"' + (v === 'all' ? ' class="on"' : '') + '>' + esc(t(l)) + '<span class="acc-n" data-n="' + v + '">0</span></button>').join('') +
          '</div>' +
          '<select class="select" id="aProv" style="width:auto;min-width:170px" aria-label="' + esc(t('Провайдер')) + '"></select>' +
          '<div class="grow" style="min-width:200px;max-width:360px;position:relative"><input class="input" id="aSearch" type="search" placeholder="' + esc(t('Пошук: пошта, провайдер, помилка…')) + '"></div>' +
          '</div>' +
          '<div id="aSel" hidden></div>' +
          '<div id="aList">' + CL.ui.skeleton(5) + '</div>' +
        '</section>' +
        '<section class="block card" data-block="add" data-w="8" data-title="Додати акаунт">' +
          '<div class="card-h"><div class="card-icon">' + ic('plus') + '</div><h2>' + esc(t('Додати акаунт')) + '</h2><span class="grow"></span><span class="sub">' + esc(t('Вхід відкривається в окремому чистому вікні браузера')) + '</span></div>' +
          '<div id="aFlow" hidden></div>' +
          '<div class="acc-h3">' + esc(t('Вбудовані')) + '</div>' +
          '<div class="acc-tiles" id="aOauth">' + OAUTH_PROVIDERS.map((p) => tile('data-oauth="' + p.id + '"', p.label, 'login', p.badge, p.badgeClass, p.tip)).join('') + '</div>' +
          '<div class="acc-h3">' + esc(t('Більше сервісів (через плагіни)')) + '</div>' +
          '<div class="acc-tiles" id="aPlug"></div>' +
          '<div class="hint" style="margin-top:12px">' + ic('info', 'sm') + ' ' + esc(t('Плагіни — сторонній код. Усі плагіни, їх оновлення й видалення — на сторінці «Плагіни».')) + ' <button class="linkbtn" data-goto="plugins">' + esc(t('Відкрити')) + '</button></div>' +
        '</section>' +
        '<section class="block card" data-block="autoclean" data-w="4" data-title="Перевірка й очищення">' +
          '<div class="card-h"><div class="card-icon">' + ic('shield') + '</div><h2>' + esc(t('Перевірка й очищення')) + '</h2></div>' +
          '<div id="aClean">' + CL.ui.skeleton(3) + '</div>' +
        '</section>' +
        '<section class="block card" data-block="models" data-w="12" data-title="Моделі акаунтів">' +
          '<div class="card-h"><div class="card-icon">' + ic('cpu') + '</div><h2>' + esc(t('Моделі акаунтів')) + '</h2><span class="sub">' + esc(t('сховай зайві моделі або дай моделі ще одну назву')) + '</span><span class="grow"></span>' +
            '<button class="btn sm ghost icon" id="amRefresh" data-tip="Оновити">' + ic('rotate', 'sm') + '</button></div>' +
          '<div id="aModels">' + CL.ui.skeleton(4) + '</div>' +
          '<datalist id="accSuggest">' + MODEL_SUGGEST.map((m) => '<option value="' + esc(m) + '">').join('') + '</datalist>' +
        '</section>' +
        '</div>';

      const $ = (s) => root.querySelector(s);
      root.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) CL.go(g.dataset.goto); });

      // ---- add account ----
      flowHost = $('#aFlow');
      tilesHost = $('#aPlug');
      pageApi = { alive: ctx.alive, reload: (force) => { load(force); renderModels(true); }, reloadModels: () => renderModels(true) };
      ctx.leave(() => { clearInterval(tick); closeMenu(); });
      paintFlow();
      paintPluginTiles();
      P.loadStore().then(() => { if (ctx.alive()) paintPluginTiles(); }).catch(() => {});
      $('#aOauth').addEventListener('click', (e) => {
        const b = e.target.closest('[data-oauth]');
        if (!b) return;
        const p = OAUTH_PROVIDERS.find((x) => x.id === b.dataset.oauth);
        startOauth(p.id, p.label);
      });
      tilesHost.addEventListener('click', (e) => { const b = e.target.closest('[data-svc]'); if (b) openPicker(b.dataset.svc); });

      // Which account providers can sign in again (built-in OAuth or a plugin with OAuth).
      const oauthProv = new Set();
      P.list().then((l) => l.forEach((p) => { if (p.supports_oauth && p.oauth_provider) oauthProv.add(P.unhtml(p.oauth_provider).toLowerCase()); })).catch(() => {});
      const reloginId = (a) => {
        const p = String(a.provider || '').toLowerCase();
        if (p === 'claude') return 'anthropic';
        if (OAUTH_PROVIDERS.some((x) => x.id === p) || oauthProv.has(p)) return p;
        return '';
      };

      // ---- account list ----
      let data = null;
      let loadErr = '';
      const sel = new Set();
      let filter = 'all';
      let prov = '';
      let query = '';
      let visible = [];
      let lastIdx = null;
      let busy = false;

      const all = () => (data && data.accounts) || [];
      const matches = (a, f) => (f === 'all' ? true : f === 'ok' ? a.state === 'ok' || a.state === 'warn' : f === 'broken' ? isBroken(a) : a.state === f);
      const filtered = () => {
        const q = query.toLowerCase();
        return all().filter((a) => matches(a, filter) && (!prov || a.provider === prov) &&
          (!q || [a.label, a.name, a.provider, a.plan, a.message].some((x) => x && String(x).toLowerCase().includes(q))))
          .sort((x, y) => (RANK[x.state] ?? 9) - (RANK[y.state] ?? 9) || String(x.provider).localeCompare(String(y.provider)) || String(accName(x)).localeCompare(String(accName(y))));
      };

      async function load(force) {
        if (busy && !force) return;
        try {
          data = await CL.api.get('/accounts' + (force ? '?refresh=1' : ''));
          loadErr = '';
        } catch (e) {
          loadErr = e.message;
        }
        if (!ctx.alive()) return;
        paintList();
      }

      function limitsCell(a) {
        const wins = (a.windows || []).filter((w) => w.key !== 'other').slice(0, 2);
        const others = (a.windows || []).filter((w) => w.key === 'other').slice(0, 1);
        const now = Date.now();
        let h = wins.concat(others).map((w) => {
          const tip = w.rolled ? t('вікно оновилось') : w.resetAt ? t('скидання через {x}', { x: CL.fmtLeft(w.resetAt - now) }) : '';
          return '<div class="acc-lim"' + (tip ? ' data-tip="' + esc(tip) + '"' : '') + '><span class="faint ellipsis">' + esc(winName(w)) + '</span>' + CL.ui.bar(w.usedPercent) + '<span class="num" style="text-align:end">' + pct(w.usedPercent || 0) + '</span></div>';
        }).join('');
        h += (a.metrics || []).slice(0, 2).map((m) => {
          const v = typeof m.value === 'number' ? Math.round(m.value * 100) / 100 : m.value;
          return '<div class="small"><span class="faint">' + esc(m.label) + ':</span> <b class="num">' + esc(v) + '</b>' + (m.currency || m.unit ? ' <span class="faint">' + esc(m.currency || m.unit) + '</span>' : '') + '</div>';
        }).join('');
        return h || '<span class="faint" data-tip="' + esc(t('Цей провайдер не повідомляє ліміти — видно лише, чи акаунт працює.')) + '">—</span>';
      }

      function prioBadge(a) {
        const p = Number(a.priority || 0);
        const w = a.weight == null ? 1 : Number(a.weight);
        if (!p && w === 1) return '';
        return ' <span class="chip outline" data-tip="' + esc(t('Пріоритет {p} · вага {w}', { p, w })) + '">' + (p ? (p > 0 ? '↑' : '↓') + Math.abs(p) : '') + (w !== 1 ? (p ? ' · ' : '') + '×' + w : '') + '</span>';
      }

      function rowHtml(a, i) {
        const on = sel.has(a.name);
        const now = Date.now();
        const pause = a.retryAt && a.retryAt > now ? '<div class="small faint" style="margin-top:4px" data-retry="' + a.retryAt + '">' + esc(t('пауза ще {x}', { x: CL.fmtLeft(a.retryAt - now) })) + '</div>' : '';
        const chip = a.pending ? '<span class="chip info">' + esc(t('перевіряю…')) + '</span>' : CL.ui.stateChip(a.state);
        const sub = CL.provTitle(a.provider) + (a.plan ? ' · ' + a.plan : '');
        return '<tr data-i="' + i + '"' + (on ? ' class="sel"' : '') + '>' +
          '<td class="acc-cb"><input type="checkbox" data-i="' + i + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(t('Вибрати {name}', { name: accName(a) })) + '"></td>' +
          '<td><div class="row nw"><span class="avatar">' + esc(String(a.provider || '?').slice(0, 2)) + '</span><div class="acc-who"><b title="' + esc(a.name) + '">' + esc(accName(a)) + prioBadge(a) + '</b><span>' + esc(sub) + '</span></div></div></td>' +
          '<td><span data-tip="' + esc(stateText(a)) + '">' + chip + '</span>' + pause + '</td>' +
          '<td>' + limitsCell(a) + '</td>' +
          '<td class="nowrap faint num"' + (a.createdAt ? ' data-tip="' + esc(CL.relTime(a.createdAt)) + '"' : '') + '>' + (a.createdAt ? esc(CL.fmtDateTime(a.createdAt)) : '—') + '</td>' +
          '<td class="num nowrap" data-tip="' + esc(t('{ok} успішних / {bad} помилок', { ok: a.success || 0, bad: a.failed || 0 })) + '"><span style="color:var(--ok)">' + CL.fmtNum(a.success || 0) + '</span><span class="faint"> / </span><span style="color:' + (a.failed ? 'var(--bad)' : 'var(--text-3)') + '">' + CL.fmtNum(a.failed || 0) + '</span></td>' +
          '<td style="width:44px"><button class="btn sm icon ghost" data-menu="' + i + '" aria-haspopup="menu" aria-label="' + esc(t('Дії з акаунтом {name}', { name: accName(a) })) + '">' + ic('dots', 'sm') + '</button></td>' +
          '</tr>';
      }

      function paintList() {
        closeMenu();
        const list = all();
        const box = $('#aList');
        // counts
        const n = { all: list.length, ok: 0, limited: 0, broken: 0, disabled: 0 };
        list.forEach((a) => ['ok', 'limited', 'broken', 'disabled'].forEach((f) => { if (matches(a, f)) n[f]++; }));
        Object.keys(n).forEach((k) => { const el = root.querySelector('[data-n="' + k + '"]'); if (el) el.textContent = String(n[k]); });
        $('#aCount').textContent = list.length ? t('{n} всього', { n: list.length }) : '';
        $('#aDelAll').disabled = !list.length;
        // providers
        const provs = Array.from(new Set(list.map((a) => a.provider))).sort();
        if (prov && !provs.includes(prov)) prov = '';
        $('#aProv').innerHTML = '<option value="">' + esc(t('Усі провайдери')) + '</option>' + provs.map((p) => '<option value="' + esc(p) + '"' + (p === prov ? ' selected' : '') + '>' + esc(CL.provTitle(p)) + ' (' + list.filter((a) => a.provider === p).length + ')</option>').join('');
        // broken banner
        $('#aBroken').innerHTML = n.broken ? '<div class="banner bad">' + ic('alert') + '<div class="grow"><b>' + esc(t('Не працюють: {n}', { n: n.broken })) + '</b><div class="small muted">' + esc(t('Сервіс відхилив вхід або запити закінчуються помилкою. Такі акаунти самі не відновляться — увійди знову або видали їх. Акаунти на ліміті сюди не входять.')) + '</div></div>' +
          '<div class="row" style="flex:none">' + (filter !== 'broken' ? '<button class="btn sm" id="aShowBroken">' + ic('filter', 'sm') + esc(t('Показати')) + '</button>' : '') + '<button class="btn sm danger" id="aDelBroken">' + ic('broom', 'sm') + esc(t('Видалити всі, що не працюють ({n})', { n: n.broken })) + '</button></div></div>' : '';
        const sb = $('#aShowBroken');
        if (sb) sb.onclick = () => setFilter('broken');
        const db = $('#aDelBroken');
        if (db) db.onclick = (e) => delBroken(e.currentTarget, n.broken);
        // selection cleanup
        Array.from(sel).forEach((name) => { if (!list.some((a) => a.name === name)) sel.delete(name); });
        visible = filtered();
        const focused = document.activeElement && box.contains(document.activeElement) ? document.activeElement : null;
        const focusKey = focused ? (focused.matches('input[type=checkbox]') ? 'cb' : focused.dataset.menu !== undefined ? 'menu' : '') + ':' + ((visible[Number(focused.dataset.i || focused.dataset.menu)] || {}).name || '') : '';
        if (loadErr && !data) {
          box.innerHTML = '<div class="banner bad">' + ic('alert') + '<div class="grow">' + esc(t('Не вдалось отримати список акаунтів: {e}', { e: loadErr })) + '<div class="small muted">' + esc(t('Перевір, чи шлюз працює (Огляд), і натисни «Спробувати ще».')) + '</div></div><button class="btn sm" id="aRetry">' + esc(t('Спробувати ще')) + '</button></div>';
          $('#aRetry').onclick = (e) => CL.ui.busy(e.currentTarget, () => load(true));
          paintSel();
          return;
        }
        if (data && data.running === false && !list.length) {
          box.innerHTML = CL.ui.empty('pause', 'Рушій не запущений', 'Список акаунтів з’явиться, щойно шлюз запуститься.', '<button class="btn sm" data-goto="home">' + esc(t('На Огляд')) + ic('arrow', 'sm') + '</button>');
        } else if (!list.length) {
          box.innerHTML = CL.ui.empty('users', 'Акаунтів ще немає', 'Додай перший нижче. Найпростіше почати з Gemini-Antigravity — це безкоштовно, підійде звичайний Google-акаунт.', '<button class="btn primary sm" id="aGoAdd">' + ic('plus', 'sm') + esc(t('Додати акаунт')) + '</button>');
          $('#aGoAdd').onclick = () => root.querySelector('[data-block="add"]').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (!visible.length) {
          box.innerHTML = CL.ui.empty('filter', 'Нічого не знайдено', 'Зміни фільтр або пошук.', '<button class="btn sm" id="aReset">' + esc(t('Показати всі')) + '</button>');
          $('#aReset').onclick = () => { query = ''; prov = ''; $('#aSearch').value = ''; setFilter('all'); };
        } else {
          box.innerHTML = '<div class="table-wrap acc-tablewrap"><table class="table' + (visible.some((a) => (a.windows && a.windows.length) || (a.metrics && a.metrics.length)) ? '' : ' no-lim') + '"><thead><tr>' +
            '<th class="acc-cb"><input type="checkbox" id="aAll" aria-label="' + esc(t('Вибрати всі показані')) + '"></th>' +
            '<th>' + esc(t('Акаунт')) + '</th><th>' + esc(t('Стан')) + '</th><th>' + esc(t('Ліміти')) + '</th><th>' + esc(t('Додано')) + '</th><th class="num">' + esc(t('Запити')) + '</th><th><span class="sr">' + esc(t('Дії')) + '</span></th>' +
            '</tr></thead><tbody>' + visible.map(rowHtml).join('') + '</tbody></table></div>' +
            '<div class="hint" style="margin-top:8px">' + esc(t('Порада: клікни рядок, щоб вибрати; Shift+клік вибирає діапазон.')) + '</div>';
          if (focusKey) {
            const [kind, name] = focusKey.split(/:(.*)/);
            const i = visible.findIndex((a) => a.name === name);
            const el = i >= 0 && box.querySelector(kind === 'cb' ? 'input[data-i="' + i + '"]' : '[data-menu="' + i + '"]');
            if (el) el.focus();
          }
        }
        paintSel();
      }

      function setFilter(f) {
        filter = f;
        root.querySelectorAll('#aFilter button').forEach((b) => b.classList.toggle('on', b.dataset.v === f));
        lastIdx = null;
        paintList();
      }

      function paintSel() {
        const box = $('#aList');
        box.querySelectorAll('tbody tr').forEach((tr) => {
          const a = visible[Number(tr.dataset.i)];
          const on = !!a && sel.has(a.name);
          tr.classList.toggle('sel', on);
          const cb = tr.querySelector('input[type=checkbox]');
          if (cb) cb.checked = on;
        });
        const head = $('#aAll');
        if (head) {
          const k = visible.filter((a) => sel.has(a.name)).length;
          head.checked = k > 0 && k === visible.length;
          head.indeterminate = k > 0 && k < visible.length;
        }
        const bar = $('#aSel');
        const n = sel.size;
        if (!n) { bar.hidden = true; bar.innerHTML = ''; return; }
        const wasHidden = bar.hidden;
        bar.hidden = false;
        const hiddenSel = all().filter((a) => sel.has(a.name) && !visible.includes(a)).length;
        bar.innerHTML = '<div class="acc-selbar" role="toolbar" aria-label="' + esc(t('Дії з вибраними')) + '">' +
          '<b class="nowrap">' + esc(t('Вибрано: {n}', { n })) + '</b>' + (hiddenSel ? '<span class="small faint" data-tip="' + esc(t('Деякі вибрані акаунти зараз сховані фільтром — дії стосуються й їх.')) + '">' + esc(t('(з них поза фільтром: {n})', { n: hiddenSel })) + '</span>' : '') +
          '<span class="grow"></span>' +
          '<button class="btn sm" data-bulk="off">' + ic('power', 'sm') + esc(t('Вимкнути')) + '</button>' +
          '<button class="btn sm" data-bulk="on">' + ic('play', 'sm') + esc(t('Увімкнути')) + '</button>' +
          '<button class="btn sm" data-bulk="reset">' + ic('restore', 'sm') + esc(t('Скинути ліміт')) + '</button>' +
          '<button class="btn sm danger solid" data-bulk="del">' + ic('trash', 'sm') + esc(t('Видалити вибрані ({n})', { n })) + '</button>' +
          '<button class="btn sm ghost icon" data-bulk="clear" data-tip="Зняти вибір" aria-label="' + esc(t('Зняти вибір')) + '">' + ic('x', 'sm') + '</button></div>';
        if (!wasHidden) bar.firstElementChild.style.animation = 'none';
      }

      // selection events
      $('#aList').addEventListener('click', (e) => {
        const menuBtn = e.target.closest('[data-menu]');
        if (menuBtn) { openMenu(menuBtn, visible[Number(menuBtn.dataset.menu)]); return; }
        if (e.target.id === 'aAll') {
          const on = e.target.checked;
          visible.forEach((a) => (on ? sel.add(a.name) : sel.delete(a.name)));
          lastIdx = null;
          paintSel();
          return;
        }
        const tr = e.target.closest('tbody tr');
        if (!tr) return;
        if (e.target.closest('a,button') || (e.target.closest('input') && e.target.type !== 'checkbox')) return;
        const i = Number(tr.dataset.i);
        const a = visible[i];
        if (!a) return;
        const isCb = e.target.matches('input[type=checkbox]');
        const want = isCb ? e.target.checked : !sel.has(a.name);
        if (e.shiftKey && lastIdx !== null && lastIdx !== i) {
          const [from, to] = lastIdx < i ? [lastIdx, i] : [i, lastIdx];
          for (let k = from; k <= to; k++) if (visible[k]) (want ? sel.add(visible[k].name) : sel.delete(visible[k].name));
        } else {
          want ? sel.add(a.name) : sel.delete(a.name);
        }
        lastIdx = i;
        paintSel();
      });
      // Shift-click should select rows, not text.
      $('#aList').addEventListener('mousedown', (e) => { if (e.shiftKey && e.target.closest('tbody tr')) e.preventDefault(); });

      $('#aSel').addEventListener('click', (e) => {
        const b = e.target.closest('[data-bulk]');
        if (!b) return;
        const picked = all().filter((a) => sel.has(a.name));
        const k = b.dataset.bulk;
        if (k === 'clear') { sel.clear(); lastIdx = null; paintSel(); return; }
        if (k === 'del') bulkDelete(b, picked);
        else if (k === 'off' || k === 'on') bulkToggle(b, picked, k === 'off');
        else if (k === 'reset') bulkReset(b, picked);
      });

      CL.ui.onSeg($('#aFilter'), (v) => { filter = v; lastIdx = null; paintList(); });
      $('#aProv').addEventListener('change', (e) => { prov = e.target.value; lastIdx = null; paintList(); });
      $('#aSearch').addEventListener('input', CL.debounce((e) => { query = e.target.value.trim(); lastIdx = null; paintList(); }, 150));
      $('#aRefresh').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => load(true)));
      $('#aDelAll').addEventListener('click', (e) => delAll(e.currentTarget));

      // ---- actions ----
      async function afterChange() {
        CL.models.invalidate();
        await load(true);
        setTimeout(() => { if (ctx.alive()) renderModels(true); }, 900);
      }

      function reportFailed(title, failed) {
        if (!failed || !failed.length) return;
        CL.dialog({
          title,
          html: '<div class="dlg-text">' + esc(t('Ці акаунти не вдалось змінити. Спробуй ще раз; якщо не допомагає — перезапусти шлюз на Огляді.')) + '</div>' +
            '<div class="list">' + failed.map((f) => '<div class="li"><div class="grow"><b>' + esc(f.name || '') + '</b><span style="white-space:normal">' + esc((f.error && (f.error.message || f.error)) || '') + '</span></div></div>').join('') + '</div>',
          actions: [{ label: 'Зрозуміло', kind: 'primary', value: true }],
        });
      }

      async function runDelete(btn, body) {
        busy = true;
        try {
          await CL.ui.busy(btn, async () => {
            let r;
            try { r = await CL.api.post('/accounts/delete', body); } catch (e) {
              if (e.data && e.data.deleted !== undefined) r = e.data; else throw e;
            }
            const failed = r.failed || [];
            const deleted = r.deleted || 0;
            (r.files || []).forEach((f) => sel.delete(f));
            if (body.names) body.names.forEach((nm) => { if (!failed.some((f) => f.name === nm)) sel.delete(nm); });
            if (body.filter === 'all') sel.clear();
            if (deleted || !failed.length) CL.toast(t('Видалено акаунтів: {n}', { n: deleted }));
            reportFailed(t('Не вдалось видалити: {n}', { n: failed.length }), failed);
          });
        } finally { busy = false; }
        await afterChange();
      }

      async function bulkDelete(btn, picked) {
        if (!picked.length) return;
        const text = picked.length === 1
          ? t('Видалити акаунт {name}? Щоб повернути його, доведеться увійти знову.', { name: accName(picked[0]) })
          : t('Видалити вибрані акаунти ({n})? Щоб повернути їх, доведеться увійти в кожен знову.', { n: picked.length });
        if (!(await CL.confirm(text, { danger: true, ok: t('Видалити ({n})', { n: picked.length }) }))) return;
        await runDelete(btn, { names: picked.map((a) => a.name) });
      }

      async function delBroken(btn, n) {
        if (!(await CL.confirm(t('Видалити всі акаунти, що не працюють ({n})? Це акаунти з відхиленим входом або з помилкою. Акаунти на ліміті залишаться. Щоб повернути видалені, доведеться увійти знову.', { n }), { danger: true, ok: t('Видалити ({n})', { n }) }))) return;
        await runDelete(btn, { filter: 'broken' });
      }

      async function delAll(btn) {
        const n = all().length;
        if (!n) return;
        if (!(await CL.confirm(t('Видалити всі акаунти ({n})? Шлюз не зможе відповідати, доки не додаси нові. Щоб повернути їх, доведеться увійти в кожен знову.', { n }), { danger: true, ok: 'Далі' }))) return;
        const word = 'ВИДАЛИТИ';
        const v = await CL.prompt(t('Введи кількість акаунтів ({n}) або слово {word}', { n, word: t(word) }), { title: 'Остаточне підтвердження', text: 'Цю дію не можна скасувати.', ok: 'Видалити все' });
        if (v === null) return;
        const ok = v === String(n) || v.toUpperCase() === word || v.toLowerCase() === String(t(word)).toLowerCase();
        if (!ok) { CL.toast('Підтвердження не збіглося — нічого не видалено.', 'bad'); return; }
        await runDelete(btn, { filter: 'all' });
      }

      async function bulkToggle(btn, picked, off) {
        const names = picked.filter((a) => (off ? !a.disabled && a.state !== 'disabled' : a.disabled || a.state === 'disabled')).map((a) => a.name);
        if (!names.length) { CL.toast(off ? 'Вибрані акаунти вже вимкнені' : 'Вибрані акаунти вже увімкнені', 'info'); return; }
        busy = true;
        try {
          await CL.ui.busy(btn, async () => {
            const r = await CL.api.post('/accounts/toggle', { names, disabled: off });
            const failed = r.failed || [];
            const done = names.length - failed.length;
            if (done) CL.toast(t(off ? 'Вимкнено акаунтів: {n}' : 'Увімкнено акаунтів: {n}', { n: done }));
            reportFailed(t('Не вдалось змінити: {n}', { n: failed.length }), failed);
          });
        } finally { busy = false; }
        await afterChange();
      }

      async function bulkReset(btn, picked) {
        const idx = picked.filter((a) => a.authIndex && a.state !== 'ok' && a.state !== 'disabled').map((a) => a.authIndex);
        if (!idx.length) { CL.toast('Серед вибраних немає акаунтів на ліміті чи з помилкою', 'info'); return; }
        busy = true;
        try {
          await CL.ui.busy(btn, async () => {
            const r = await CL.api.post('/accounts/reset', { authIndexes: idx });
            CL.toast(t('Ліміт скинуто: {n} з {total}', { n: r.reset || 0, total: idx.length }), r.reset === idx.length ? 'ok' : 'bad');
          });
        } finally { busy = false; }
        await afterChange();
      }

      // ---- row menu ----
      let menu = null;
      function closeMenu() {
        if (!menu) return;
        menu.el.remove();
        document.removeEventListener('mousedown', menu.outside, true);
        document.removeEventListener('keydown', menu.key, true);
        window.removeEventListener('resize', closeMenu);
        const v = document.getElementById('view');
        if (v) v.removeEventListener('scroll', closeMenu);
        const tw = root.querySelector('.acc-tablewrap');
        if (tw) tw.removeEventListener('scroll', closeMenu);
        const back = menu.btn;
        menu = null;
        if (back && document.contains(back)) back.focus();
      }
      function openMenu(btn, a) {
        if (!a) return;
        const same = menu && menu.btn === btn;
        closeMenu();
        if (same) return;
        const rid = reloginId(a);
        const disabled = a.disabled || a.state === 'disabled';
        const canReset = a.authIndex && a.state !== 'ok' && a.state !== 'disabled';
        const el = CL.el('<div class="acc-menu" role="menu">' +
          (rid ? '<button class="acc-mi" role="menuitem" data-act="relogin">' + ic('login', 'sm') + esc(t('Увійти знову')) + '</button>' : '') +
          '<button class="acc-mi" role="menuitem" data-act="toggle">' + ic(disabled ? 'play' : 'power', 'sm') + esc(t(disabled ? 'Увімкнути' : 'Вимкнути')) + '</button>' +
          (canReset ? '<button class="acc-mi" role="menuitem" data-act="reset">' + ic('restore', 'sm') + esc(t('Скинути ліміт')) + '</button>' : '') +
          '<button class="acc-mi" role="menuitem" data-act="history">' + ic('chart', 'sm') + esc(t('Історія й швидкість')) + '</button>' +
          '<button class="acc-mi" role="menuitem" data-act="prio">' + ic('sliders', 'sm') + esc(t('Пріоритет і вага')) + '</button>' +
          '<button class="acc-mi" role="menuitem" data-act="copy">' + ic('copy', 'sm') + esc(t('Копіювати назву файлу')) + '</button>' +
          '<hr><button class="acc-mi bad" role="menuitem" data-act="del">' + ic('trash', 'sm') + esc(t('Видалити')) + '</button></div>');
        document.body.appendChild(el);
        const r = btn.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
        el.style.top = (r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
        const items = () => Array.from(el.querySelectorAll('.acc-mi'));
        const outside = (e) => { if (!el.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeMenu(); };
        const key = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const l = items();
            const i = l.indexOf(document.activeElement);
            l[(i + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length].focus();
          }
          if (e.key === 'Tab') closeMenu();
        };
        menu = { el, btn, outside, key };
        document.addEventListener('mousedown', outside, true);
        document.addEventListener('keydown', key, true);
        window.addEventListener('resize', closeMenu);
        const v = document.getElementById('view');
        if (v) v.addEventListener('scroll', closeMenu, { passive: true });
        const tw = root.querySelector('.acc-tablewrap');
        if (tw) tw.addEventListener('scroll', closeMenu, { passive: true });
        items()[0].focus();
        el.addEventListener('click', async (e) => {
          const it = e.target.closest('[data-act]');
          if (!it) return;
          const act = it.dataset.act;
          menu.btn = null; // don't steal focus back after a dialog
          closeMenu();
          if (act === 'relogin') { CL.toast(t('Відкриваю вхід {name}…', { name: CL.provTitle(a.provider) }), 'info'); startOauth(rid, CL.provTitle(a.provider)); }
          else if (act === 'toggle') bulkToggle(btn, [a], !disabled);
          else if (act === 'reset') bulkReset(btn, [a]);
          else if (act === 'copy') CL.copy(a.name, 'Назву скопійовано');
          else if (act === 'prio') prioDialog(a);
          else if (act === 'history') historyDialog(a);
          else if (act === 'del') bulkDelete(btn, [a]);
        });
      }

      // countdowns
      ctx.every(30000, () => {
        const now = Date.now();
        let expired = false;
        root.querySelectorAll('[data-retry]').forEach((el) => {
          const at = Number(el.dataset.retry);
          if (at <= now) expired = true;
          else el.textContent = t('пауза ще {x}', { x: CL.fmtLeft(at - now) });
        });
        if (expired) load();
      });
      ctx.every(20000, () => { if (!menu && !document.querySelector('.dlg-back')) load(); });
      const reloadSoon = CL.debounce(() => { if (ctx.alive() && !busy) load(); }, 500);
      const modelsSoon = CL.debounce(() => { if (ctx.alive()) renderModels(true); }, 1500);
      ctx.on('changed', (w) => { if (w === 'accounts' || w === 'engine') { reloadSoon(); if (w === 'accounts') modelsSoon(); } });

      // ---- check & auto-clean ----
      async function paintClean() {
        const box = $('#aClean');
        let p;
        try { p = await CL.api.get('/accounts/policy'); } catch (e) { box.innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Не вдалось прочитати налаштування: {e}', { e: e.message })) + '</div></div>'; return; }
        if (!ctx.alive()) return;
        box.innerHTML =
          '<div class="setting" style="padding-top:0"><div class="grow"><b>' + esc(t('Перевіряти вхід акаунтів')) + '</b><span>' + esc(t('Фоном, щоб мертвий акаунт знайшовся раніше, ніж на ньому впаде запит.')) + '</span></div>' +
            '<select class="select" id="aCheckH" style="width:auto" aria-label="' + esc(t('Як часто')) + '">' + [[0, 'ніколи'], [1, 'щогодини'], [3, 'кожні 3 год'], [6, 'кожні 6 год'], [12, 'кожні 12 год'], [24, 'раз на добу']].map(([v, l]) => '<option value="' + v + '"' + (Number(p.checkHours) === v ? ' selected' : '') + '>' + esc(t(l)) + '</option>').join('') +
            ([0, 1, 3, 6, 12, 24].includes(Number(p.checkHours)) ? '' : '<option value="' + Number(p.checkHours) + '" selected>' + esc(t('кожні {n} год', { n: p.checkHours })) + '</option>') + '</select></div>' +
          '<div class="setting"><div class="grow"><b>' + esc(t('Автоматично видаляти акаунти, вхід яких відхилено')) + '</b><span>' + esc(t('Коли сервіс відкликав, прострочив або заблокував вхід, а акаунт так і не запрацював за вказаний час.')) + '</span></div>' + CL.ui.switch('aAuto', p.autoClean) + '</div>' +
          '<div class="setting"><div class="grow"><b>' + esc(t('Чекати перед видаленням')) + '</b><span>' + esc(t('Від 1 до 720 годин (30 днів).')) + '</span></div>' +
            '<div class="row nw" style="gap:6px"><input class="input num" id="aHours" type="number" min="1" max="720" step="1" style="width:84px" value="' + Number(p.autoCleanHours || 24) + '"' + (p.autoClean ? '' : ' disabled') + ' aria-label="' + esc(t('Годин')) + '"><span class="small muted">' + esc(t('год')) + '</span></div></div>' +
          '<div class="hint row nw top" style="gap:8px;margin-top:10px">' + ic('shield', 'sm') + '<span>' + esc(t('Акаунти на ліміті ніколи не видаляються автоматично — ліміт минає сам. Акаунти з помилкою теж лишаються: видалити їх можна кнопкою вище.')) + '</span></div>';
        const sw = $('#aAuto');
        const hrs = $('#aHours');
        const put = async (patch) => {
          try {
            const r = await CL.api.put('/accounts/policy', patch);
            sw.checked = !!r.autoClean;
            hrs.value = r.autoCleanHours || hrs.value;
            hrs.disabled = !sw.checked;
            CL.toast('Збережено ✓');
          } catch (e) { CL.fail(e); paintClean(); }
        };
        $('#aCheckH').addEventListener('change', (e) => put({ checkHours: Number(e.target.value) }));
        sw.addEventListener('change', () => { hrs.disabled = !sw.checked; put({ autoClean: sw.checked }); });
        hrs.addEventListener('change', () => {
          const v = Math.round(Number(hrs.value));
          if (!isFinite(v) || v < 1 || v > 720) { CL.toast('Вкажи від 1 до 720 годин', 'bad'); hrs.focus(); return; }
          put({ autoCleanHours: v });
        });
      }

      $('#aCheck').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, async () => {
        const r = await CL.api.post('/accounts/check');
        await load(true);
        const bad = (r.invalid || []).length;
        const lim = (r.limited || []).length;
        CL.toast(bad ? t('Перевірено {n}: не працюють {bad}, на ліміті {lim}', { n: r.checked, bad, lim }) : t('Перевірено {n}: вхід працює в усіх', { n: r.checked }), bad ? 'bad' : undefined);
        if (bad) setFilter('broken');
      }));

      async function prioDialog(a) {
        const id = 'pr' + CL.uid();
        const r = await CL.dialog({
          title: t('Пріоритет і вага: {name}', { name: accName(a) }),
          html: '<div class="dlg-text">' + esc(t('Шлюз спершу бере акаунти з вищим пріоритетом. Вага діє, коли на сторінці «Моделі» обрано «За вагою»: акаунт з вагою 3 отримає втричі більше запитів, ніж з вагою 1; вага 0 — не брати.')) + '</div>' +
            '<div class="cols-2"><div class="field"><label for="' + id + 'p">' + esc(t('Пріоритет')) + '</label><input class="input" id="' + id + 'p" type="number" min="-1000" max="1000" value="' + Number(a.priority || 0) + '"><div class="hint">' + esc(t('0 — звичайний, більше — раніше')) + '</div></div>' +
            '<div class="field"><label for="' + id + 'w">' + esc(t('Вага')) + '</label><input class="input" id="' + id + 'w" type="number" min="0" max="1000000" value="' + (a.weight == null ? 1 : Number(a.weight)) + '"></div></div>',
          actions: [{ label: 'Скасувати', value: null }, { label: 'Зберегти', kind: 'primary', onClick: (d, close) => {
            const p = Math.round(Number(d.querySelector('#' + id + 'p').value));
            const w = Math.round(Number(d.querySelector('#' + id + 'w').value));
            if (!isFinite(p) || p < -1000 || p > 1000 || !isFinite(w) || w < 0 || w > 1000000) return false;
            close({ priority: p, weight: w });
            return false;
          } }],
        });
        if (!r) return;
        try {
          await CL.api.post('/accounts/priority', Object.assign({ name: a.name }, r));
          CL.toast('Збережено ✓');
          load(true);
        } catch (e) { CL.fail(e); }
      }

      async function historyDialog(a) {
        let st = null;
        try { st = await CL.api.get('/stats/accounts'); } catch (e) { CL.fail(e); return; }
        const x = ((st && st.accounts) || []).find((y) => y.name === a.name || (a.authIndex && y.authIndex === a.authIndex));
        const DAY = 86400000;
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const days = Array.from({ length: 7 }, (_, i) => { const at = start.getTime() - (6 - i) * DAY; const d = new Date(at); return { at, ok: 0, failed: 0, label: d.getDate() + '.' + (d.getMonth() + 1) }; });
        ((x && x.hourly) || []).forEach((h) => { const b = days.find((d) => h.t >= d.at && h.t < d.at + DAY); if (b) { b.ok += h.ok || 0; b.failed += h.failed || 0; } });
        const stat = (v, l) => '<div class="stat"><b class="num">' + esc(v) + '</b><span>' + esc(t(l)) + '</span></div>';
        await CL.dialog({
          title: accName(a),
          wide: true,
          html: '<div class="small muted" style="margin-bottom:10px">' + esc(CL.provTitle(a.provider)) + ' · ' + CL.ui.stateChip(a.state) + '</div>' +
            (x ? '<div class="cols-4" style="margin-bottom:14px">' + stat(CL.fmtInt(x.requests || 0), 'запитів') + stat(CL.fmtInt(x.failed || 0), 'помилок') + stat(x.avgMs ? CL.fmtMs(x.avgMs) : '—', 'середня відповідь') + stat(CL.fmtNum(x.tokens || 0), 'токенів') + '</div>' +
              '<div class="acc-hist"></div>' + (x.last ? '<div class="hint" style="margin-top:8px">' + esc(t('Востаннє: {when}', { when: CL.fmtDateTime(x.last) })) + '</div>' : '')
              : CL.ui.empty('chart', 'Цей акаунт ще не відповідав', 'Статистика з’явиться після перших запитів через нього.')),
          onMount: (d) => { const box = d.querySelector('.acc-hist'); if (box) CL.ui.chart(box, days, [days[0].label, days[3].label, t('сьогодні')]); },
        });
      }

      // ---- account models (hide / extra names) ----
      const openProv = OPEN_PROV;
      let amBusy = false;
      async function fetchExcluded() { const r = (await CL.mgmt('GET', 'oauth-excluded-models')) || {}; return r['oauth-excluded-models'] || {}; }
      async function fetchAliases() { const r = (await CL.mgmt('GET', 'oauth-model-alias')) || {}; return r['oauth-model-alias'] || {}; }
      async function patchExcluded(p, models) {
        try { await CL.mgmt('PATCH', 'oauth-excluded-models', { provider: p, models }); } catch (e) { if (!(models.length === 0 && e.status === 404)) throw e; }
      }
      async function patchAliases(p, aliases) {
        try { await CL.mgmt('PATCH', 'oauth-model-alias', { channel: p, aliases }); } catch (e) { if (!(aliases.length === 0 && e.status === 404)) throw e; }
      }

      async function renderModels(force) {
        const box = $('#aModels');
        let cat;
        try { cat = await CL.models(force); } catch (e) { cat = null; }
        if (!ctx.alive()) return;
        const files = (cat && cat.authFiles) || [];
        const provs = Array.from(new Set(files.map((f) => String(f.provider || f.type || '').toLowerCase()).filter(Boolean))).sort();
        if (!provs.length) { box.innerHTML = CL.ui.empty('cpu', 'Спочатку підключи акаунт', 'Тут можна буде сховати зайві моделі акаунта або дати моделі ще одну назву.'); return; }
        let excluded = {};
        let aliases = {};
        try { [excluded, aliases] = await Promise.all([fetchExcluded(), fetchAliases()]); } catch (e) {
          if (!ctx.alive()) return;
          box.innerHTML = '<div class="banner bad">' + ic('alert') + '<div>' + esc(t('Списки моделей зараз недоступні: {e}', { e: e.message })) + '<div class="small muted">' + esc(t('Перевір, чи шлюз працює, і натисни «Оновити».')) + '</div></div></div>';
          return;
        }
        if (!ctx.alive()) return;
        if (!openProv.size && provs.length <= 2) provs.forEach((p) => openProv.add(p));
        box.innerHTML = '<div class="hint" style="margin-bottom:12px">' + esc(t('Сховані моделі зникають зі списків і не використовуються для цього типу акаунтів. Своя назва — ще одне ім’я для наявної моделі, щоб програма, яка просить, наприклад, claude-opus-5-5, отримала модель цього акаунта.')) + '</div>' +
          provs.map((p) => {
            const models = (cat.byProv && cat.byProv[p]) || [];
            const hid = excluded[p] || [];
            const al = aliases[p] || [];
            const aliasOf = (id) => al.find((x) => String(x.alias).toLowerCase() === id.toLowerCase());
            const n = files.filter((f) => String(f.provider || f.type || '').toLowerCase() === p).length;
            return '<details class="acc-prov" data-prov="' + esc(p) + '"' + (openProv.has(p) ? ' open' : '') + '><summary><span class="avatar">' + esc(p.slice(0, 2)) + '</span><div class="grow"><b>' + esc(CL.provTitle(p)) + '</b> <span class="small faint">' + esc(t('{n} акаунт(ів)', { n })) + '</span></div>' +
              '<span class="chip">' + esc(t('{n} моделей', { n: models.length })) + '</span>' + (hid.length ? '<span class="chip outline">' + esc(t('сховано: {n}', { n: hid.length })) + '</span>' : '') + ic('chevron', 'sm acc-chev') + '</summary>' +
              '<div class="acc-prov-b">' +
              (models.length ? '<div class="tags">' + models.map((id) => {
                const a = aliasOf(id);
                return a
                  ? '<span class="tag acc-alias" data-tip="' + esc(t('своя назва → {m}', { m: a.name })) + '">' + esc(id) + ' <span class="faint">→ ' + esc(a.name) + '</span><button class="acc-x" data-unalias="' + esc(id) + '" aria-label="' + esc(t('Видалити свою назву {m}', { m: id })) + '">' + ic('x', 'sm') + '</button></span>'
                  : '<span class="tag">' + esc(id) + '<button class="acc-x" data-hide="' + esc(id) + '" data-tip="Сховати модель" aria-label="' + esc(t('Сховати модель {m}', { m: id })) + '">' + ic('eyeoff', 'sm') + '</button></span>';
              }).join('') + '</div>' : '<div class="small faint">' + esc(t('Рушій ще не повідомив моделі цього акаунта. Якщо акаунт вимкнено — увімкни його.')) + '</div>') +
              (hid.length ? '<div class="acc-h3" style="margin-top:14px">' + esc(t('Сховані — клікни, щоб повернути')) + '</div><div class="tags">' + hid.map((id) => '<button class="tag acc-hidden" data-unhide="' + esc(id) + '" data-tip="Повернути модель">' + ic('restore', 'sm') + esc(id) + '</button>').join('') + '</div>' : '') +
              (!NO_ALIAS_PROVIDERS[p] && models.length ? '<div class="acc-add"><input class="input mono" data-new placeholder="' + esc(t('нова назва, напр. claude-opus-5-5')) + '" list="accSuggest" aria-label="' + esc(t('Нова назва моделі')) + '"><span class="faint">' + ic('arrow', 'sm') + '</span><div data-base></div><button class="btn sm primary" data-add>' + ic('plus', 'sm') + esc(t('Додати назву')) + '</button></div>' : '') +
              '</div></details>';
          }).join('');
        box.querySelectorAll('details.acc-prov').forEach((d) => {
          const p = d.dataset.prov;
          d.addEventListener('toggle', () => (d.open ? openProv.add(p) : openProv.delete(p)));
          const host = d.querySelector('[data-base]');
          if (!host) return;
          const models = (cat.byProv && cat.byProv[p]) || [];
          const al = aliases[p] || [];
          const bases = models.filter((id) => !al.some((x) => String(x.alias).toLowerCase() === id.toLowerCase()));
          const picker = CL.ui.modelPicker(host, { value: bases[0] || '', empty: false, extra: [{ label: t('Моделі {p}', { p: CL.provTitle(p) }), options: bases.map((v) => ({ value: v, text: v })) }] });
          d.querySelector('[data-add]').addEventListener('click', (e) => {
            const name = d.querySelector('[data-new]').value.trim();
            const base = picker.get();
            if (!name) { CL.toast('Вкажи нову назву моделі', 'bad'); return; }
            if (!/^[A-Za-z0-9._:/-]+$/.test(name)) { CL.toast('Назва: лише латиниця, цифри та . _ - / :', 'bad'); return; }
            if (models.some((id) => id.toLowerCase() === name.toLowerCase())) { CL.toast(t('Модель {m} вже є у списку', { m: name }), 'bad'); return; }
            const realBase = bases.find((b) => b.toLowerCase() === String(base).toLowerCase());
            if (!realBase) { CL.toast(t('Обери модель саме цього акаунта (група «{g}» у списку)', { g: t('Моделі {p}', { p: CL.provTitle(p) }) }), 'bad'); return; }
            amAct(e.currentTarget, async () => {
              const cur = (await fetchAliases())[p] || [];
              cur.push({ name: realBase, alias: name, fork: true });
              await patchAliases(p, cur);
            }, t('Назву {m} додано ✓ (відповідає {b})', { m: name, b: realBase }));
          });
        });
      }

      async function amAct(btn, fn, okText) {
        if (amBusy) return;
        amBusy = true;
        try {
          const r = await CL.ui.busy(btn, async () => { await fn(); return true; });
          if (r) {
            CL.toast(okText);
            CL.models.invalidate();
            setTimeout(() => { if (ctx.alive()) renderModels(true); }, 700);
            setTimeout(() => { if (ctx.alive()) { CL.models.invalidate(); renderModels(true); } }, 2500);
          }
        } finally { amBusy = false; }
      }

      $('#aModels').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-hide],[data-unhide],[data-unalias]');
        if (!b) return;
        e.preventDefault();
        const p = b.closest('details').dataset.prov;
        if (b.dataset.hide) {
          const id = b.dataset.hide;
          amAct(b, async () => { const cur = (await fetchExcluded())[p] || []; if (!cur.includes(id)) cur.push(id); await patchExcluded(p, cur); }, t('Модель {m} схована ✓', { m: id }));
        } else if (b.dataset.unhide) {
          const id = b.dataset.unhide;
          amAct(b, async () => { const cur = ((await fetchExcluded())[p] || []).filter((x) => x !== id); await patchExcluded(p, cur); }, t('Модель {m} повернуто ✓', { m: id }));
        } else if (b.dataset.unalias) {
          const id = b.dataset.unalias;
          if (!(await CL.confirm(t('Видалити свою назву моделі {m}? Програми, які просять цю назву, перестануть її отримувати.', { m: id }), { danger: true, ok: 'Видалити назву' }))) return;
          amAct(b, async () => { const cur = ((await fetchAliases())[p] || []).filter((a) => String(a.alias).toLowerCase() !== id.toLowerCase()); await patchAliases(p, cur); }, t('Назву {m} видалено ✓', { m: id }));
        }
      });
      $('#amRefresh').addEventListener('click', (e) => CL.ui.busy(e.currentTarget, () => renderModels(true)));

      // ---- go ----
      await Promise.all([load(), paintClean()]);
      renderModels(false);

      // Opened from the Plugins page («Підключити»): show that service's picker.
      let want = null;
      try { want = JSON.parse(sessionStorage.getItem('cl.openPicker') || 'null'); sessionStorage.removeItem('cl.openPicker'); } catch (e) { want = null; }
      if (want && want.svc) setTimeout(() => { if (ctx.alive()) openPicker(want.svc, want.plugin); }, 120);
    },
  });

  /** For plugins.js and the command palette: open the plugin picker for a service. */
  CL.accountsOpenPicker = (svcId, pluginId) => openPicker(svcId, pluginId);
  CL.accountsStartOauth = (provider, name) => startOauth(provider, name);
})();
