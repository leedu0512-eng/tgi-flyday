// EST / ENG on every screen (Janno 17.11.2026: a switch on each screen, one language at a time;
// voice callouts stay English). Each device remembers its own choice.
//
// The pages are written in English. In Estonian, every piece of text that matches a key in
// i18n-et.js (exactly, or one of its patterns) is swapped as it appears on the page, so most
// markup needs no changes. Sentences that carry markup or values use tr() instead.

import { ET, ET_PATTERNS } from './i18n-et.js';

const KEY = 'tgiflyday.lang';
export const LANG = (() => {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'et' || q === 'en') return q;
    return localStorage.getItem(KEY) === 'et' ? 'et' : 'en';
  } catch { return 'en'; }
})();
document.documentElement.lang = LANG;

/** Estonian for this English text, or null. */
function lookup(en) {
  const hit = ET[en];
  if (hit !== undefined) return hit;
  for (const [re, to] of ET_PATTERNS) {
    const m = en.match(re);
    if (m) return typeof to === 'function' ? to(...m) : en.replace(re, to);
  }
  return null;
}

/** Text in this screen's language; {name} style values filled in. */
export function tr(en, vars) {
  let s = LANG === 'et' ? (lookup(en) ?? en) : en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch {}
  location.reload();
}

/** The EST / ENG switch (any element with data-lang switches when clicked). */
export function langSwitch(extra = '') {
  return `<span class="lang-sw ${extra}" role="group" aria-label="Language">`
    + `<button type="button" data-lang="et" class="${LANG === 'et' ? 'on' : ''}">EST</button>`
    + `<button type="button" data-lang="en" class="${LANG === 'en' ? 'on' : ''}">ENG</button></span>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-lang]');
  if (b && b.dataset.lang !== LANG) setLang(b.dataset.lang);
}, true);

// ---------- swapping text as it appears ----------

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

function swapText(node) {
  const v = node.nodeValue;
  const s = v.trim();
  if (!s || s.length > 400) return;
  const et = lookup(s);
  if (et === null || et === s) return;
  const i = v.indexOf(s);
  node.nodeValue = v.slice(0, i) + et + v.slice(i + s.length);
}

function swapAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (!v) continue;
    const et = lookup(v.trim());
    if (et !== null && et !== v) el.setAttribute(a, et);
  }
}

function swapTree(root) {
  if (root.nodeType === 3) {
    if (!SKIP.has(root.parentNode?.nodeName) && !root.parentNode?.closest?.('[data-no-i18n]')) swapText(root);
    return;
  }
  if (root.nodeType !== 1 || SKIP.has(root.nodeName) || root.closest('[data-no-i18n]')) return;
  swapAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && (SKIP.has(n.nodeName) || n.hasAttribute('data-no-i18n')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) swapText(n);
    else swapAttrs(n);
  }
}

if (LANG === 'et') {
  const start = () => {
    swapTree(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach(swapTree);
        else if (m.type === 'characterData') swapTree(m.target);
        else if (m.type === 'attributes') swapAttrs(m.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
}
