---
name: CarteLink 3
description: A local AI gateway console that the user arranges and dresses themselves — one component system, ten worlds and a custom one.
themes: [graphite, datamatics, departures, aurora, paper, synthwave, phosphor, nord, sunset, swiss, custom]
default-theme: graphite
colors:
  bg: "#16171a"
  bg-2: "#121316"
  surface: "#1c1d21"
  surface-2: "#222328"
  surface-3: "#2a2c32"
  line: "#2c2e34"
  line-strong: "#3a3d45"
  text: "#e6e7ea"
  text-2: "#a4a7b0"
  text-3: "#80838d"
  accent: "#7aa2f7"
  accent-ink: "#0d1220"
  ok: "#9ece6a"
  warn: "#e0af68"
  bad: "#f7768e"
  info: "#7dcfff"
typography:
  body: { fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, SF Pro Text, system-ui, sans-serif", fontSize: "13.5px (× user scale 85–125%)", lineHeight: 1.5 }
  display: { fontFamily: "Segoe UI Variable Display, Segoe UI, SF Pro Display, system-ui", fontWeight: 650, letterSpacing: "-0.02em" }
  mono: { fontFamily: "Cascadia Code, JetBrains Mono, SF Mono, Menlo, Consolas, monospace", use: "model ids, keys, addresses, numbers in feeds" }
rounded: { control: "7px", panel: "10px", dialog: "14px", chip: "999px" }
spacing: { pad: "18px", gap: "14px", page-x: "32px", density: "dense 14/10 · normal 18/14 · roomy 22/18" }
motion: { ease: "cubic-bezier(0.16, 1, 0.3, 1)", base: "220ms × --t", slow: "520ms × --t", levels: "full · reduced (--t 0.55) · off" }
---

# CarteLink 3 — design system

## Principle

One component system, many worlds. Every colour, radius, font and motion value is a token
on `:root` (`ui/css/app.css`); a theme (`ui/css/themes.css`, `html[data-theme=…]`) only
redefines tokens, plus at most a few world-specific touches. Nothing about a component's
structure changes per theme, so every page works in every theme, including the user's own.

The user owns the layout: every page is a 12-column grid of blocks
(`.blocks[data-area] > .block[data-block][data-w]`) they can drag, resize (3–12 columns) and
hide in edit mode (top-bar layout button or Ctrl+K); menu items can be reordered, moved
between groups and hidden. Interface parts can be switched off in Налаштування → Інтерфейс.
All of it lives in `config.json → ui` and is mirrored in localStorage to avoid a flash at start.

## Worlds

A design is a composition, not a palette: it owns the shell, the Overview layout, its widgets and background
(`ui/js/designs/<id>.js` + `ui/css/designs/<id>.css`, scoped by `html[data-theme="<id>"]`; contract in `ui/js/design.js`).

| Design | Shell · mode | Signature |
|---|---|---|
| Графіт (default) | sidebar · dark | Dev console; request pipeline Програма → Ключ → Правило → Модель → Відповідь lights up per request |
| Datamatics | topbar · dark | Pure B/W mono field; monumental uppercase model; barcode activity; states by glyph, never colour |
| Табло вокзалу | sidebar · dark | Split-flap departures board; requests leave as departures, providers are platforms |
| Нічна схема метро | sidebar · dark | Route map: programs are stations, providers are lines, the active model is the interchange; a train runs per request |
| Жовта навігація | topbar · light | Airport signage: yellow/black sign panels, arrows, gate boxes; every program a direction sign |
| Японський щільний | topbar · light | Dense portal modules with coloured header bars, rankings, ticker, ○△× account table |
| Metro-плитки | rail · dark | Flat solid tiles, huge light lowercase type, live tiles that cycle |
| Пульсар | rail · dark | Record-sleeve ridge plot of 24 h traffic, tiny catalogue type, crop marks |
| Зоряний атлас | sidebar · dark | Celestial chart: models are stars (magnitude = requests), programs are constellations |
| Посадковий талон | sidebar · light | Boarding pass for the active model plus a departures gate board and seat map of accounts |
| Касета | rail · light | J-card insert: reels turn while requests stream, track list side A/B, VU meters |
| Спектральні лінії | rail · dark | Emission-line spectrum of model traffic, spectrogram waterfall |
| Фотолабораторія | sidebar · dark | Safelight darkroom: contact sheet of requests, zone scale of account health |
| Теплий застосунок | topbar · light | Friendly consumer app: greeting, one plain status sentence, people-like account chips |
| Свій дизайн | base design | Any base + edited tokens, font, radius, glass; export/import (cartelink-theme.json) |

## Components (classes)

`card` / `card-h` / `card-icon` / `card-foot`, `btn` (`primary`, `ghost`, `danger`, `sm`, `icon`, busy/done states),
`input` / `select` / `textarea`, `field` + `hint`, `switch`, `seg`, `chip` (`ok warn bad info accent outline`),
`table`, `list` + `li` + `avatar`, `kpis` + `kpi`, `bar`, `segbar`, `ring`, `chart` (+ `chart-axis`), `code`,
`kv`, `tags` + `tag`, `banner` (`info`, `bad`), `empty`, `skel`, dialogs (`CL.dialog`, `CL.confirm`, `CL.prompt`),
`mp` (searchable model picker), command palette (`cmdk`), toasts, tooltips (`data-tip`).

Icons: one stroked 24px sprite (`#i-*` in `ui/index.html`), 1.8 stroke, round caps. No emoji.

## Motion

Exponential ease-out from an already-visible default: page content rises in (staggered per
block, starting at partial opacity so a hidden window never shows an empty page), the model
name rolls (or flips on the board), numbers count up, live feed rows slide in, rings and bars
glide to new values, theme changes cross-fade through View Transitions. `--t` scales every
duration; "off" sets them to 1 ms; `prefers-reduced-motion` is honoured unless the user forces motion.

## States

Account states map to one chip vocabulary everywhere: `ok` активний, `warn` близько до ліміту,
`limited` ліміт, `error` помилка, `invalid` вхід відхилено, `disabled` вимкнено. Every error
shown to the user carries a plain-language hint (`CL.errorHint`) — what happened and what to do.
