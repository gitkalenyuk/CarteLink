'use strict';
// CL.data — one place for the live numbers every design draws: status,
// metrics, accounts, errors and the request feed. Pages and design widgets
// subscribe; the hub polls only what someone is looking at and refreshes
// on live events, so two widgets never ask the server for the same thing.
//
//   const off = CL.data.watch(['metrics', 'accounts'], () => paint(), ctx)
//   CL.data.get('metrics')  → last value (or null)
//   CL.data.feed            → newest-first request rows (live + recent history)
//   CL.data.route()         → program → rule → provider → model flow summary
//   CL.appName(userAgent)   → friendly program name

(function () {
  const CL = window.CL;
  const store = { status: null, metrics: null, accounts: null, errors: null, endpoints: null };
  const at = {};
  const busy = {};
  const subs = { status: 0, metrics: 0, accounts: 0, errors: 0, endpoints: 0 };
  const EVERY = { metrics: 6000, accounts: 20000, errors: 30000, endpoints: 60000, status: 5000 };

  const load = {
    status: () => CL.loadStatus(),
    metrics: async () => (await CL.api.get('/metrics/summary')).metrics,
    accounts: () => CL.api.get('/limits'),
    errors: () => CL.api.get('/errors?limit=60'),
    endpoints: () => CL.loadEndpoints(),
  };

  async function refresh(key, force) {
    if (busy[key]) return busy[key];
    if (!force && store[key] && Date.now() - (at[key] || 0) < 1500) return store[key];
    busy[key] = (async () => {
      try {
        const v = await load[key]();
        store[key] = v;
        at[key] = Date.now();
        if (key === 'metrics') prefillFeed(v);
        CL.emit('data:' + key, v);
        CL.emit('data', key);
      } catch (e) { /* keep the last value; the shell shows the offline state */ }
      return store[key];
    })().finally(() => { busy[key] = null; });
    return busy[key];
  }

  // Polling only for watched keys, paused while the window is hidden.
  setInterval(() => {
    if (document.hidden) return;
    Object.keys(subs).forEach((k) => {
      if (k !== 'status' && subs[k] > 0 && Date.now() - (at[k] || 0) >= EVERY[k]) refresh(k);
    });
  }, 1000);
  CL.on('status', (s) => { store.status = s; at.status = Date.now(); CL.emit('data:status', s); CL.emit('data', 'status'); });

  CL.on('changed', (what) => {
    if (what === 'metrics' && subs.metrics) refresh('metrics', true);
    if ((what === 'accounts' || what === 'engine') && subs.accounts) refresh('accounts', true);
    if (what === 'errors' && subs.errors) refresh('errors', true);
    if (what === 'all') Object.keys(subs).forEach((k) => subs[k] && refresh(k, true));
  });

  // ---------------------------------------------------------------- feed --

  const feed = [];
  const FEED_MAX = 60;
  function pushRow(r) {
    feed.unshift(r);
    if (feed.length > FEED_MAX) feed.length = FEED_MAX;
  }
  let prefilled = false;
  function prefillFeed(m) {
    if (prefilled || !m || !Array.isArray(m.history)) return;
    prefilled = true;
    m.history.slice(0, 40).reverse().forEach((h) => pushRow({
      t: Date.parse(h.timestamp) || Date.now(),
      ok: !h.failed,
      status: h.failed ? 'ERR' : 'OK',
      ms: Number(h.latency_ms) || 0,
      model: h.model || '',
      resolved: '',
      app: CL.appName(h.user_agent || h.source || ''),
      account: h.auth_index || '',
      provider: String(h.provider || h.source || '').toLowerCase(),
      tokens: (h.tokens && (h.tokens.total_tokens || (h.tokens.input_tokens || 0) + (h.tokens.output_tokens || 0))) || 0,
      past: true,
    }));
    CL.emit('data:feed', feed);
  }
  CL.on('live', (ev) => {
    if (ev.type === 'request') {
      pushRow({ t: ev.t, ok: ev.status < 400, status: ev.status, ms: ev.ms, model: ev.model, resolved: ev.resolved, app: CL.appName(ev.client), key: ev.key, path: ev.path });
      CL.emit('data:feed', feed);
      CL.emit('data', 'feed');
    }
    if (ev.type === 'error' && subs.errors) refresh('errors', true);
  });

  // --------------------------------------------------------------- watch --

  /** Subscribe to keys; fn runs on every update of any of them. Returns off(). */
  function watch(keys, fn, ctx) {
    const offs = [];
    keys.forEach((k) => {
      if (k === 'feed') { offs.push(CL.on('data:feed', fn)); return; }
      subs[k] = (subs[k] || 0) + 1;
      offs.push(CL.on('data:' + k, fn));
      if (!store[k] || Date.now() - (at[k] || 0) > (EVERY[k] || 5000)) refresh(k);
    });
    const off = () => {
      keys.forEach((k) => { if (k !== 'feed') subs[k] = Math.max(0, (subs[k] || 0) - 1); });
      offs.forEach((o) => o());
    };
    if (ctx && ctx.leave) ctx.leave(off);
    return off;
  }

  // --------------------------------------------------------------- route --

  /**
   * Who asks for what and where it goes, from the recent feed:
   * { apps:[{name,n,fail}], rules:[{name,n}], models:[{name,n,fail}], links:[{from,to,n,kind}], total }
   */
  function route() {
    const rows = feed.slice(0, 50);
    const count = (map, k, fail) => { const o = map.get(k) || { name: k, n: 0, fail: 0 }; o.n++; if (fail) o.fail++; map.set(k, o); };
    const apps = new Map();
    const rules = new Map();
    const models = new Map();
    const links = new Map();
    const link = (a, b, kind) => { const k = a + '\u0000' + b; const o = links.get(k) || { from: a, to: b, n: 0, kind }; o.n++; links.set(k, o); };
    rows.forEach((r) => {
      const app = r.app || CL.t('Інше');
      const asked = r.model || '—';
      const served = (r.resolved || '').split(' → ').pop() || asked;
      const rule = !r.resolved ? CL.t('як є') : /^claude-.*(haiku|sonnet|opus)/i.test(asked) ? CL.t('рівень Claude') : /^cartelink-/i.test(asked) ? CL.t('рівень CarteLink') : CL.t('підміна');
      count(apps, app, !r.ok);
      count(rules, rule, !r.ok);
      count(models, served, !r.ok);
      link('a:' + app, 'r:' + rule, r.ok ? 'ok' : 'bad');
      link('r:' + rule, 'm:' + served, r.ok ? 'ok' : 'bad');
    });
    const sort = (m) => Array.from(m.values()).sort((x, y) => y.n - x.n);
    return { apps: sort(apps), rules: sort(rules), models: sort(models), links: Array.from(links.values()), total: rows.length };
  }

  // ----------------------------------------------------------- app names --

  const APPS = [
    [/claude-cli|claude-code|claude code/i, 'Claude Code'], [/codex/i, 'Codex'], [/cursor/i, 'Cursor'], [/roo-?code|roocode/i, 'Roo Code'],
    [/kilo/i, 'Kilo Code'], [/cline/i, 'Cline'], [/continue/i, 'Continue'], [/aider/i, 'Aider'], [/opencode/i, 'OpenCode'], [/zed/i, 'Zed'],
    [/goose/i, 'Goose'], [/crush|charm/i, 'Crush'], [/qwen/i, 'Qwen Code'], [/gemini-cli|geminicli/i, 'Gemini CLI'], [/open-?webui/i, 'Open WebUI'],
    [/librechat/i, 'LibreChat'], [/cherry/i, 'Cherry Studio'], [/chatbox/i, 'Chatbox'], [/windsurf|codeium/i, 'Windsurf'], [/jetbrains|intellij/i, 'JetBrains'],
    [/copilot/i, 'GitHub Copilot'], [/anthropic/i, 'Anthropic SDK'], [/openai/i, 'OpenAI SDK'], [/^curl/i, 'curl'], [/powershell/i, 'PowerShell'],
    [/mozilla|chrome|safari|edg\//i, 'Браузер'],
  ];
  CL.appName = (ua) => {
    ua = String(ua || '').trim();
    if (!ua) return '';
    for (const [re, name] of APPS) if (re.test(ua)) return name;
    const first = ua.split(/[\s/;(]/)[0];
    return first && first.length < 24 ? first : CL.t('Інше');
  };

  CL.data = { store, refresh, watch, get: (k) => store[k], feed, route };
})();
