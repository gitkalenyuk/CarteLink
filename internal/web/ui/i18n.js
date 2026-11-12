'use strict';
// CarteLink UI translations. The Ukrainian text in the HTML/JS is the source
// and the dictionary key: i18n/<lang>.js sets window.I18N_DICT = { "<uk>": "<tr>" }.
// Static text is translated in place (text nodes + title/placeholder/data-tip/
// label attributes), including anything the UI renders later (a
// MutationObserver). Strings with values inside use t('… {name} …', {name}).

const I18N_LANGS = [
  { code: 'uk', name: 'Українська' },
  { code: 'en', name: 'English' },
  { code: 'zh', name: '中文' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'ar', name: 'العربية', rtl: true },
  { code: 'bn', name: 'বাংলা' },
  { code: 'pt', name: 'Português' },
  { code: 'ur', name: 'اردو', rtl: true },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ja', name: '日本語' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ko', name: '한국어' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'pl', name: 'Polski' },
];
const I18N_KEY = 'cl.lang';

let LANG = 'uk';
try { LANG = localStorage.getItem(I18N_KEY) || 'uk'; } catch (e) { /* default */ }
if (!I18N_LANGS.some((l) => l.code === LANG)) LANG = 'uk';

window.I18N_DICT = null;
if (LANG !== 'uk') {
  // Synchronous on purpose: the dictionary must be there before app.js runs.
  document.write('<script src="i18n/' + LANG + '.js?v=2.8.0"><\/script>');
}

const I18N_ATTRS = ['title', 'placeholder', 'data-tip', 'label', 'aria-label'];
const I18N_CYR = /[А-Яа-яІіЇїЄєҐґ]/;
const I18N_MISS = new Set(); // debugging aid: window.I18N_MISS in the console

function i18nNorm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

function i18nLookup(s) {
  const d = window.I18N_DICT;
  if (!d) return null;
  const k = i18nNorm(s);
  if (!k || !I18N_CYR.test(k)) return null;
  const v = d[k];
  if (typeof v === 'string' && v) return v;
  I18N_MISS.add(k);
  return null;
}

// t('Збережено ✓') / t('Модель {m} тепер основна ✓', { m: 'x' })
function t(s, vars) {
  let out = i18nLookup(s) || s;
  if (vars) {
    // A value that is itself a known UI string (an error thrown by our own
    // code, say) is translated too.
    out = out.replace(/\{(\w+)\}/g, (m, k) => {
      if (!Object.prototype.hasOwnProperty.call(vars, k)) return m;
      const v = String(vars[k]);
      return i18nLookup(v) || v;
    });
  }
  return out;
}

function i18nText(node) {
  const raw = node.nodeValue;
  if (!raw || !I18N_CYR.test(raw)) return;
  const tr = i18nLookup(raw);
  if (tr == null) return;
  const lead = raw.match(/^\s*/)[0];
  const trail = raw.match(/\s*$/)[0];
  node.nodeValue = lead + tr + trail;
}

function i18nAttrs(el) {
  for (const a of I18N_ATTRS) {
    const v = el.getAttribute && el.getAttribute(a);
    if (v && I18N_CYR.test(v)) {
      const tr = i18nLookup(v);
      if (tr != null) el.setAttribute(a, tr);
    }
  }
}

function translateTree(root) {
  if (!window.I18N_DICT || !root) return;
  if (root.nodeType === 3) { i18nText(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) {
    if (root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
    i18nAttrs(root);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === 3) {
      const p = n.parentNode;
      if (!p || (p.tagName !== 'SCRIPT' && p.tagName !== 'STYLE' && p.tagName !== 'TEXTAREA')) i18nText(n);
    } else {
      i18nAttrs(n);
    }
    n = walker.nextNode();
  }
}

function i18nStart() {
  const lang = I18N_LANGS.find((l) => l.code === LANG) || I18N_LANGS[0];
  document.documentElement.lang = lang.code;
  document.documentElement.dir = lang.rtl ? 'rtl' : 'ltr';
  if (!window.I18N_DICT) return;
  translateTree(document.body);
  document.title = t(document.title);
  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => translateTree(n));
      } else if (m.type === 'characterData') {
        i18nText(m.target);
      } else if (m.type === 'attributes') {
        i18nAttrs(m.target);
      }
    }
  });
  obs.observe(document.body, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: I18N_ATTRS,
  });
}

// Switch language: remember it (this window and the app's tray), reload.
async function setLang(code) {
  if (!I18N_LANGS.some((l) => l.code === code)) return;
  try { localStorage.setItem(I18N_KEY, code); } catch (e) { /* ignore */ }
  try {
    await fetch('/api/app/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: code }),
    });
  } catch (e) { /* the window still switches */ }
  location.reload();
}

// Fill a <select> with the languages.
function fillLangSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '';
  for (const l of I18N_LANGS) {
    const o = document.createElement('option');
    o.value = l.code;
    o.textContent = l.name;
    if (l.code === LANG) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => setLang(sel.value));
}

window.I18N_MISS = I18N_MISS;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', i18nStart);
} else {
  i18nStart();
}
