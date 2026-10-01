# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Members of the closed creators' community "Secret YT_cartel" (YouTube Cartel) — mostly
non-technical people who use AI coding/chat tools (Claude Code, Codex, Cursor, Cline…).
They set CarteLink up once with a wizard and then open it rarely: to switch the model that
answers, add or re-login an account, check limits, or see why a tool shows an error.
The UI is used in Ukrainian by default and in 16 other languages (incl. RTL Arabic/Urdu).

## Product Purpose
A local desktop AI gateway: it collects the user's own AI accounts (Google Antigravity,
Claude, Codex, Kiro, Gemini CLI…) and API keys behind one local address and key, rotates
accounts, and substitutes models so any tool works with whatever the user has. Success:
the user's tools just work, and when something breaks the app says what and what to do.

## Positioning
One local address for every account the user already has, with model substitution rules
("the tool asks for X, the gateway answers with Y") and account rotation — gated to the
community through Telegram membership.

## Operating Context
- Windows desktop window (WebView2) plus tray; macOS window; a small always-on-top model
  switcher window (two models + one switch button).
- Runs in the background for days ("set and forget"); the main window is opened on demand.
- First screen priorities (confirmed): the model that answers now and switching it;
  state of accounts and limits; traffic and errors; the address and key to paste into tools.

## Capabilities and Constraints
- Pages: Home, Connect an app (per-tool instructions), Accounts (OAuth + plugin accounts,
  per-account model lists), Models (tiers / table, exact swaps), Providers (API-key
  providers, native keys), Statistics (tokens, limits, error log), Settings, Help.
- Static UI embedded in the Go binary (`internal/web/ui`): plain HTML/CSS/JS, no build step,
  no external network assets (fonts/icons must be local/inline). Talks to `/api/*`.
- i18n: Ukrainian source strings in HTML/JS are the dictionary keys (`i18n/<lang>.js`);
  new or changed text needs translation into 16 languages.
- Access gate overlay (`#gate`) until Telegram membership is confirmed.

## Brand Commitments
- Name **CarteLink** is binding (echoes "YouTube Cartel"). Logo and colours may change.
- Visual direction chosen by the user (2026-09-30, after two re-rolls): the category
  standard — a dark, calm desktop admin console, executed at the craft level of Linear,
  Vercel Dashboard, Raycast and Stripe Dashboard, with smooth purposeful motion
  (launch sequence, page transitions, staggered reveal, skeletons, micro-interactions).

## Evidence on Hand
Real live data from the local engine (accounts, models, metrics, errors). No testimonials,
customers or benchmarks — do not fabricate any.

## Product Principles
1. Set up once, then it runs itself — the UI answers "is it working, and with what?" at a glance.
2. Plain language for non-technical people; technical detail only on demand.
3. Every error comes with what happened and what to do next.
4. The current model and one-click switching are always within reach.
