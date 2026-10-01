---
name: CarteLink
description: Local AI gateway desktop console — calm, dark, data-first.
colors:
  ink-bg: "#09090b"
  sidebar-bg: "#0c0c0f"
  surface: "#111114"
  surface-raised: "#16161a"
  surface-overlay: "#1d1d22"
  text-primary: "#ededf0"
  text-secondary: "#a8a8b3"
  text-tertiary: "#8a8a96"
  coral: "#ff6a55"
  status-ok: "#3ecf8e"
  status-warn: "#f2b33d"
  status-bad: "#f26b6b"
  status-info: "#74a7ff"
typography:
  display:
    fontFamily: "Segoe UI Variable Display, Segoe UI, -apple-system, SF Pro Display, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Segoe UI Variable Display, Segoe UI, -apple-system, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.4
  mono:
    fontFamily: "Cascadia Code, Cascadia Mono, JetBrains Mono, SF Mono, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  chip: "999px"
  control-sm: "6px"
  control: "8px"
  panel: "12px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  page-x: "36px"
components:
  button-primary:
    backgroundColor: "{colors.text-primary}"
    textColor: "{colors.ink-bg}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  button-default:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  button-brand:
    backgroundColor: "{colors.coral}"
    textColor: "#1a0703"
    rounded: "{rounded.control}"
    height: "32px"
  input:
    backgroundColor: "{colors.ink-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    height: "34px"
    padding: "0 11px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "18px 20px"
  chip-ok:
    textColor: "{colors.status-ok}"
    rounded: "{rounded.chip}"
    height: "20px"
---

# Design System: CarteLink

## Overview

**Creative North Star: "The Quiet Control Room"** (provisional name, recorded from the build)

CarteLink is a tool people open rarely and briefly: to see which model answers, switch it,
check accounts and errors, and copy the address and key. The system is a calm dark console
in the Linear / Vercel / Raycast / Stripe tradition (the user's chosen quality bar):
near-black neutrals, hairline borders, one coral accent, and status colours that only ever
mean status. Information sits in a short, grouped sidebar (Gateway: Overview, Models,
Accounts, Statistics; Manage: Connect an app, Providers, Settings, Help) and in panels on a
single content column.

**Key Characteristics:**
- Restrained palette: neutrals + one coral accent; status hues reserved for state.
- Tonal layering instead of heavy shadows; 1px borders at 7.5–20% white.
- Real data as the hero: the model answering now, KPIs, a 24-hour activity chart.
- Short, eased-out motion on state changes, plus one launch sequence.
- Lucide-style inline SVG icons (1.75 stroke) from one sprite; no emoji as icons.

## Colors

Near-black, cool-neutral grounds stepping up in lightness per layer, with a single warm coral.

### Primary
- **Signal Coral** (#ff6a55): brand mark, active navigation icon, selected preset, focus
  ring, switched-on toggles, links. Never a large fill except the brand tile and the
  `btn-brand` action.

### Neutral
- **Ink** (#09090b): app background and input wells.
- **Sidebar Ink** (#0c0c0f): the navigation column.
- **Panel** (#111114): panels (`.card`).
- **Raised** (#16161a) / **Overlay** (#1d1d22): rows, chips, hovered controls, tooltips.
- **Text** (#ededf0) / **Secondary** (#a8a8b3) / **Tertiary** (#8a8a96).

### Status
- **Ok** (#3ecf8e), **Warn** (#f2b33d), **Bad** (#f26b6b), **Info** (#74a7ff), each with a
  ~12% soft fill for chips and notices.

### Named Rules
**The One Accent Rule.** Coral marks the current thing (selection, focus, brand) and nothing
else; primary actions are light-on-dark (`button-primary`), not coral.
**The Status Means Status Rule.** Green/amber/red appear only for live state (running,
limit, error), never for decoration.

## Typography

**Body/UI:** Segoe UI Variable Text (system stack fallbacks). **Display:** Segoe UI Variable
Display. **Mono:** Cascadia Code — only for model ids, keys, URLs, code and numbers in tables.

### Hierarchy
- **Display** (650, 30px, 1.15, -0.025em): the model answering now.
- **Headline** (650, 24px, 1.2, -0.02em): page titles.
- **Title** (600, 14px): panel titles, always led by an icon.
- **Body** (400, 13.5px, 1.5): copy; hints 12.5px in Secondary/Tertiary.
- **KPI value** (650, 24px, tabular numerals).

**The Mono Is Data Rule.** Monospace marks identifiers and measurements, never decoration.

## Layout

Two-column shell: 236px sidebar + content column (max 1180px, 28px/36px padding). Overview:
a 1.55fr/1fr row ("answering now" + gateway/address), a four-up KPI row, a full-width
activity chart, then a two-up row (accounts, recent errors). Panels gap 16px, KPI gap 12px.
Below 1100px the hero row stacks and KPIs go two-up; below 900px the sidebar collapses to a
64px icon rail and all two-column grids stack. RTL (Arabic, Urdu) mirrors the layout.

## Elevation & Depth

Depth is tonal: each layer is a step lighter with a 1px border. Panels carry only an inset
top highlight and a 1–2px shadow (`--shadow-1`); popovers and toasts use `--shadow-pop`
(18px 48px blur + 1px ring). No glows, no coloured halos.

## Shapes

Radii: 6px small controls, 8px controls, 12px panels, pills for chips and badges. Icons are
round-capped 1.75 strokes on a 24px grid.

## Components

- **Buttons:** 32px; default = raised neutral, primary = light fill, ghost = text-only,
  danger/warn = outlined text colour; press scales to 0.97.
- **Inputs/selects:** 34px ink wells, coral focus ring (3px soft) — custom chevron.
- **Toggle:** 34×20 track, coral when on, knob springs across (transform only).
- **Chips:** 20px pills with a status dot for ok/warn/err.
- **Presets 1/2:** outlined pills; the active one takes the coral soft fill and number badge.
- **Activity chart:** 24 hourly bars, neutral for success, red for errors, grow-in on load.
- **Skeletons:** shimmer bars while lists load; never spinners inside content.
- **Launch:** the access gate doubles as splash — logo strokes draw, wordmark rises, a
  coral sweep bar runs; on access the gate blurs out and the shell assembles
  (sidebar slides in, nav items and panels rise with 30–40ms stagger).

## Do's and Don'ts

- Do lead every panel title with its icon; do keep copy plain and action-named.
- Do animate only state changes (150–350ms, `cubic-bezier(0.16, 1, 0.3, 1)`), with
  `prefers-reduced-motion` honoured.
- Don't use emoji or Unicode glyphs as icons; don't add eyebrow labels above headings.
- Don't use coloured side stripes, gradient text, glows, or hard offset shadows.
- Don't introduce a second accent colour or a display face other than Segoe UI Variable.
