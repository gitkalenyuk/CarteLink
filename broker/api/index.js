'use strict'
// CarteLink — Telegram OAuth broker (dependency-free). FULL implementation lives
// here (in the Vercel function file itself) so every code change invalidates the
// function build and Vercel never serves a stale bundle. server.js just launches
// this handler for standalone hosts.
//
// Why this exists: the oauth.telegram.org login flow (account picker, "Login via
// Telegram") is bound to a domain pre-registered with the bot in @BotFather. It
// cannot run from 127.0.0.1/file://, so this hosted broker performs the OAuth code
// exchange + membership check and hands a SIGNED session back to the local Cartel
// Code app over a loopback callback. The bot token & OAuth client secret live ONLY
// here (server env), never in the distributed desktop app.
//
// Routes:
//   GET  /app-auth.html?cb=<loopback>   -> branded page with "Login via Telegram"
//   GET  /api/auth/start?cb=<loopback>  -> 302 to oauth.telegram.org (PKCE + signed state)
//   GET  /api/auth/app-oidc?code&state  -> token exchange, membership check, 302 back to cb
//   POST /api/auth/verify {session}     -> live re-check (powers auto-kick / restart gate)
//   GET  /healthz
//
// Env: TG_BOT_TOKEN, TG_OAUTH_CLIENT_SECRET, TG_GROUPS(csv), SESSION_SECRET,
//      PUBLIC_URL(https origin of THIS broker), [TG_BOT_ID], [BRAND]
const crypto = require('crypto')
const { URL } = require('url')

const ENV = process.env
const TOKEN = ENV.TG_BOT_TOKEN || ''
const BOT_ID = ENV.TG_BOT_ID || (TOKEN.split(':')[0] || '')
const CLIENT_SECRET = ENV.TG_OAUTH_CLIENT_SECRET || ''
const GROUPS = (ENV.TG_GROUPS || '').split(',').map((s) => s.trim()).filter(Boolean)
const SECRET = ENV.SESSION_SECRET || ''
// On Vercel, VERCEL_PROJECT_PRODUCTION_URL is the stable production domain — use
// it automatically so PUBLIC_URL usually needs no manual value.
const PUBLIC_URL = (ENV.PUBLIC_URL || (ENV.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + ENV.VERCEL_PROJECT_PRODUCTION_URL : '')).replace(/\/+$/, '')
const BRAND = ENV.BRAND || 'CarteLink'
const MEMBER = ['member', 'administrator', 'creator', 'restricted']
const SESSION_TTL = 400 * 24 * 3600 // seconds; membership is re-checked live anyway

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function b64urlJson(o) { return b64url(Buffer.from(JSON.stringify(o), 'utf8')) }
function fromB64url(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64') }
function hmac(data) { return b64url(crypto.createHmac('sha256', SECRET).update(data).digest()) }
// compact signed token: <b64url(json)>.<b64url(hmac)>
function sign(payload) { const body = b64urlJson(payload); return body + '.' + hmac(body) }
function unsign(tok, maxAgeSec) {
  if (!tok || typeof tok !== 'string' || !tok.includes('.')) return null
  const [body, sig] = tok.split('.')
  if (!body || !sig) return null
  const good = hmac(body)
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null
  let o; try { o = JSON.parse(fromB64url(body).toString('utf8')) } catch { return null }
  if (maxAgeSec && o.iat && (Date.now() / 1000 - o.iat) > maxAgeSec) return null
  return o
}

async function tg(method, params) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params || {}),
    })
    return await r.json()
  } catch (e) { return { ok: false, description: String((e && e.message) || e) } }
}
async function checkMembership(userId) {
  const missing = []
  for (const g of GROUPS) {
    const r = await tg('getChatMember', { chat_id: g, user_id: Number(userId) })
    const rr = r && r.result
    const st = rr && rr.status
    // 'restricted' can mean a user who was restricted and then LEFT — Telegram
    // still returns status:'restricted' but with is_member:false. Require the flag.
    const valid = r.ok && MEMBER.includes(st) && (st !== 'restricted' || rr.is_member === true)
    if (!valid) missing.push({ group: g, status: st || null, err: r && r.description })
  }
  return { ok: missing.length === 0, missing }
}

// ---- id_token (JWT) verification via Telegram JWKS ----
let _jwks = { at: 0, keys: [] }
async function jwks() {
  if (Date.now() - _jwks.at < 3600_000 && _jwks.keys.length) return _jwks.keys
  const r = await fetch('https://oauth.telegram.org/.well-known/jwks.json')
  const j = await r.json()
  _jwks = { at: Date.now(), keys: (j && j.keys) || [] }
  return _jwks.keys
}
const ALG = { RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512' }
async function verifyIdToken(idt) {
  const parts = String(idt).split('.')
  if (parts.length !== 3) throw new Error('bad jwt')
  const header = JSON.parse(fromB64url(parts[0]).toString('utf8'))
  const payload = JSON.parse(fromB64url(parts[1]).toString('utf8'))
  const keys = await jwks()
  const jwk = keys.find((k) => k.kid === header.kid) || keys[0]
  if (!jwk) throw new Error('no jwk')
  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' })
  const signingInput = parts[0] + '.' + parts[1]
  const sig = fromB64url(parts[2])
  let ok = false
  if (ALG[header.alg]) ok = crypto.verify(ALG[header.alg], Buffer.from(signingInput), pub, sig)
  else if (header.alg === 'ES256') ok = crypto.verify('SHA256', Buffer.from(signingInput), { key: pub, dsaEncoding: 'ieee-p1363' }, sig)
  else if (header.alg === 'EdDSA') ok = crypto.verify(null, Buffer.from(signingInput), pub, sig)
  else throw new Error('unsupported alg ' + header.alg)
  if (!ok) throw new Error('bad signature')
  if (payload.iss !== 'https://oauth.telegram.org') throw new Error('bad iss')
  if (String(payload.aud) !== String(BOT_ID)) throw new Error('bad aud')
  if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('expired')
  return payload
}

// ---- helpers ----
function send(res, code, headers, body) { res.writeHead(code, headers || {}); res.end(body || '') }
function redirect(res, url) { send(res, 302, { Location: url }) }
function json(res, code, obj) { send(res, code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, JSON.stringify(obj)) }
function configOk() { return TOKEN && BOT_ID && CLIENT_SECRET && GROUPS.length && SECRET && PUBLIC_URL }
function appendParams(cb, params) {
  const u = new URL(cb)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}
function readBody(req) {
  return new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy() }); req.on('end', () => resolve(d)) })
}
function parseCookies(h) { const o = {}; String(h || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()) }); return o }
function eqConst(a, b) { a = String(a || ''); b = String(b || ''); if (a.length !== b.length || !a.length) return false; return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)) }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function authPageHtml(cb) {
  const start = '/api/auth/start?cb=' + encodeURIComponent(cb)
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(BRAND)}</title>
<style>:root{--bg:#0b0e14;--card:#151a23;--line:#262e3b;--txt:#e9edf5;--muted:#8b93a1;--tg:#2aabee}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:grid;place-items:center;background:
radial-gradient(1000px 480px at 50% -10%,#1a2130,#0b0e14 60%);color:var(--txt);font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px}
.card{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:34px 30px;box-shadow:0 24px 60px rgba(0,0,0,.5);text-align:center}
.logo{width:66px;height:66px;border-radius:18px;margin:0 auto 16px;background:linear-gradient(135deg,#2aabee,#229ed9);display:grid;place-items:center}
.logo svg{width:38px;height:38px}
h1{font-size:22px;font-weight:800;margin:4px 0 6px}p{color:var(--muted);margin:8px 0 0}
a.btn{display:block;margin-top:22px;background:linear-gradient(180deg,#2aabee,#229ed9);color:#fff;text-decoration:none;border-radius:12px;padding:14px;font-size:16px;font-weight:700}
a.btn:hover{filter:brightness(1.06)}.small{font-size:12px;color:var(--muted);margin-top:16px}</style></head>
<body><div class="card">
<div class="logo"><svg viewBox="0 0 24 24" fill="#fff"><path d="M9.8 16.6l-.4 4c.5 0 .8-.2 1.1-.5l2.6-2.5 5.4 4c1 .5 1.7.3 1.9-.9l3.5-16.4c.3-1.4-.5-2-1.5-1.7L1.2 9.3C-.1 9.8 0 10.6 1 10.9l5.4 1.7L18.7 5c.6-.4 1.1-.2.7.2z"/></svg></div>
<h1>Вхід у ${esc(BRAND)}</h1>
<p>Підтверди акаунт Telegram — і повертайся в застосунок. Доступ надається учасникам обох спільнот YT Cartel.</p>
<a class="btn" href="${esc(start)}">Увійти через Telegram</a>
<div class="small">Ми не бачимо твій пароль — лише підтвердження від Telegram.</div>
</div></body></html>`
}
function doneHtml(title, msg, ok) {
  const accent = ok ? '#2aabee' : '#f87171'
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"/><title>${esc(BRAND)}</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#0b0e14;color:#e9edf5;font-family:Segoe UI,system-ui,sans-serif}
.c{max-width:420px;text-align:center;padding:34px 30px;border:1px solid #262e3b;border-radius:20px;background:#151a23}
.d{width:56px;height:56px;border-radius:16px;margin:0 auto 14px;background:${accent};display:grid;place-items:center;font-size:28px;color:#fff}
.h{font-size:22px;font-weight:800;margin:6px 0}.m{color:#8b93a1}</style></head>
<body><div class="c"><div class="d">${ok ? '✓' : '×'}</div><div class="h">${esc(title)}</div><div class="m">${esc(msg)}</div></div></body></html>`
}

const BUILD = '2'  // bump to force a fresh function build when needed

async function handler(req, res) {
  let u
  try { u = new URL(req.url, PUBLIC_URL || 'http://localhost') } catch { return send(res, 400, {}, 'bad url') }
  const path = u.pathname

  if (path === '/healthz') {
    const missing = []
    if (!TOKEN) missing.push('TG_BOT_TOKEN')
    if (!BOT_ID) missing.push('TG_BOT_ID(or token)')
    if (!CLIENT_SECRET) missing.push('TG_OAUTH_CLIENT_SECRET')
    if (!GROUPS.length) missing.push('TG_GROUPS')
    if (!SECRET) missing.push('SESSION_SECRET')
    if (!PUBLIC_URL) missing.push('PUBLIC_URL')
    return json(res, 200, { ok: true, build: BUILD, configured: missing.length === 0, missing, groups: GROUPS.length, bot: BOT_ID, publicUrl: PUBLIC_URL || null })
  }

  if (path === '/' || path === '/app-auth.html') {
    const cb = u.searchParams.get('cb') || ''
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(cb) && !/^http:\/\/localhost:\d+\//.test(cb)) return send(res, 400, { 'content-type': 'text/html; charset=utf-8' }, doneHtml('Помилка', 'Некоректний параметр cb.', false))
    return send(res, 200, { 'content-type': 'text/html; charset=utf-8' }, authPageHtml(cb))
  }

  if (path === '/api/auth/start') {
    if (!configOk()) return send(res, 200, { 'content-type': 'text/html; charset=utf-8' }, doneHtml('Гейт не налаштований', 'Адміністратор ще не задав змінні бота на сервері.', false))
    const cb = u.searchParams.get('cb') || ''
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(cb)) return send(res, 400, {}, 'bad cb')
    const verifier = b64url(crypto.randomBytes(32))
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
    const flow = b64url(crypto.randomBytes(18)) // login-CSRF binding: also set as a cookie
    const state = sign({ cb, v: verifier, n: flow, iat: Math.floor(Date.now() / 1000) })
    const auth = new URL('https://oauth.telegram.org/auth')
    auth.searchParams.set('client_id', BOT_ID)
    auth.searchParams.set('redirect_uri', PUBLIC_URL + '/api/auth/app-oidc')
    auth.searchParams.set('response_type', 'code')
    auth.searchParams.set('scope', 'openid profile telegram:bot_access')
    auth.searchParams.set('state', state)
    auth.searchParams.set('code_challenge', challenge)
    auth.searchParams.set('code_challenge_method', 'S256')
    const secure = PUBLIC_URL.startsWith('https') ? 'Secure; ' : ''
    return send(res, 302, { Location: auth.toString(), 'Set-Cookie': `cl_flow=${flow}; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=900` })
  }

  if (path === '/api/auth/app-oidc') {
    const code = u.searchParams.get('code')
    const st = unsign(u.searchParams.get('state'), 900) // 15-min state window
    if (!st || !st.cb) return send(res, 400, { 'content-type': 'text/html; charset=utf-8' }, doneHtml('Вхід не вдався', 'Прострочений або недійсний запит. Спробуй ще раз із застосунку.', false))
    // Login-CSRF: the flow must be completed in the SAME browser that started it.
    const cookies = parseCookies(req.headers.cookie)
    if (!eqConst(cookies.cl_flow, st.n)) return send(res, 400, { 'content-type': 'text/html; charset=utf-8' }, doneHtml('Вхід не вдався', 'Сесію входу не підтверджено. Почни вхід із застосунку заново.', false))
    if (!code) {
      const err = u.searchParams.get('error') || 'no_code'
      return redirect(res, appendParams(st.cb, { ok: '0', reason: err }))
    }
    try {
      const basic = Buffer.from(`${BOT_ID}:${CLIENT_SECRET}`).toString('base64')
      const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: PUBLIC_URL + '/api/auth/app-oidc', client_id: BOT_ID, code_verifier: st.v })
      const tr = await fetch('https://oauth.telegram.org/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + basic }, body: form.toString() })
      const tj = await tr.json().catch(() => ({}))
      if (!tj || !tj.id_token) return redirect(res, appendParams(st.cb, { ok: '0', reason: 'token_' + (tr.status) }))
      const claims = await verifyIdToken(tj.id_token)
      const uid = claims.id || claims.sub
      const name = claims.name || claims.given_name || claims.preferred_username || String(uid)
      const username = claims.preferred_username || ''
      const m = await checkMembership(uid)
      if (!m.ok) return redirect(res, appendParams(st.cb, { ok: '0', reason: 'not_member', name, missing: JSON.stringify(m.missing.map((x) => x.group)) }))
      const session = sign({ uid: String(uid), name, username, iat: Math.floor(Date.now() / 1000) })
      return redirect(res, appendParams(st.cb, { ok: '1', session, name }))
    } catch (e) {
      return redirect(res, appendParams(st.cb, { ok: '0', reason: 'exchange', detail: String((e && e.message) || e).slice(0, 80) }))
    }
  }

  if (path === '/api/auth/verify') {
    if (req.method === 'OPTIONS') return send(res, 204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST,OPTIONS' })
    if (!configOk()) return json(res, 200, { ok: false, reason: 'config' })
    let body = {}; try { body = JSON.parse(await readBody(req) || '{}') } catch {}
    const sess = unsign(body.session, SESSION_TTL)
    if (!sess || !sess.uid) return json(res, 200, { ok: false, reason: 'no_auth' })
    const m = await checkMembership(sess.uid)
    if (!m.ok) return json(res, 200, { ok: false, reason: 'not_member', user: { id: sess.uid, name: sess.name, username: sess.username }, missing: m.missing.map((x) => x.group) })
    return json(res, 200, { ok: true, user: { id: sess.uid, name: sess.name, username: sess.username } })
  }

  return send(res, 404, {}, 'not found')
}

module.exports = handler          // Vercel: default export is the (req,res) function
module.exports.handler = handler
module.exports.configOk = configOk
