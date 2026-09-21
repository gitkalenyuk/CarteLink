'use strict'
// Standalone launcher for non-Vercel hosts (VPS / Render / Railway / Fly / Docker).
const http = require('http')
const handler = require('./api/index.js')
const PORT = Number(process.env.PORT || 8080)

http.createServer(handler).listen(PORT, () => {
  const configured = handler.configOk && handler.configOk()
  console.log(`[cartelink-broker] listening on :${PORT}  configured=${!!configured}`)
  if (!configured) {
    console.log('[cartelink-broker] MISSING env — set TG_BOT_TOKEN, TG_OAUTH_CLIENT_SECRET, TG_GROUPS, SESSION_SECRET, PUBLIC_URL')
  }
})
