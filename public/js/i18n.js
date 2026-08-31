'use strict';

const SUPPORTED_LANGS = [
  'en','es','fr','de','pt','it','ru','ja','ko','zh','zh-TW',
  'ar','hi','tr','nl','pl','id','vi','th','uk','cs','sv',
];

const LANG_NAMES = {
  en:'English', es:'Español', fr:'Français', de:'Deutsch', pt:'Português',
  it:'Italiano', ru:'Русский', ja:'日本語', ko:'한국어', zh:'简体中文',
  'zh-TW':'繁體中文', ar:'العربية', hi:'हिन्दी', tr:'Türkçe', nl:'Nederlands',
  pl:'Polski', id:'Bahasa Indonesia', vi:'Tiếng Việt', th:'ไทย',
  uk:'Українська', cs:'Čeština', sv:'Svenska',
};

let currentLang = 'en';
let dict = {};
let loaded = false;
const waitingCallbacks = [];

function detectLang() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length > 0 && SUPPORTED_LANGS.includes(parts[0])) return parts[0];
  const saved = (() => { try { return localStorage.getItem('browserpdf-lang'); } catch(e) { return null; } })();
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  const nav = navigator.language || 'en';
  const base = nav.split('-')[0];
  if (SUPPORTED_LANGS.includes(base)) return base;
  if (nav === 'zh-TW' || nav === 'zh-Hant') return 'zh-TW';
  return 'en';
}

async function loadTranslations(lang) {
  if (lang === 'en') return {};
  try {
    const res = await fetch('/translations.json');
    if (!res.ok) return {};
    const all = await res.json();
    return all[lang] || {};
  } catch (e) {
    console.warn('i18n: failed to load translations', e);
    return {};
  }
}

function applyToElement(el) {
  const k = el.getAttribute('data-i18n');
  if (k && dict[k]) el.textContent = dict[k];
  const kh = el.getAttribute('data-i18n-html');
  if (kh && dict[kh]) el.innerHTML = dict[kh];
  const kp = el.getAttribute('data-i18n-placeholder');
  if (kp && dict[kp]) el.setAttribute('placeholder', dict[kp]);
  const ka = el.getAttribute('data-i18n-aria');
  if (ka && dict[ka]) el.setAttribute('aria-label', dict[ka]);
  const kt = el.getAttribute('data-i18n-title');
  if (kt && dict[kt]) el.setAttribute('title', dict[kt]);
  const ko = el.getAttribute('data-i18n-opt');
  if (ko && dict[ko]) el.textContent = dict[ko];
}

function applyTranslations(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-placeholder],[data-i18n-aria],[data-i18n-title],[data-i18n-opt]').forEach(applyToElement);
}

function rewriteLinks() {
  if (currentLang === 'en') return;
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('//') || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('data:')) return;
    // Already localized
    if (href === `/${currentLang}` || href === `/${currentLang}/` || href.startsWith(`/${currentLang}/`)) return;
    // Absolute site path: /privacy -> /tr/privacy
    if (href.startsWith('/')) {
      a.setAttribute('href', href === '/' ? `/${currentLang}/` : `/${currentLang}${href}`);
      return;
    }
    // Relative path: privacy, terms, unlock, pdf-to-word, ...
    // (without this, /tr without trailing slash resolves privacy to /privacy)
    if (!href.includes(':') && !href.startsWith('?') && !href.startsWith('.')) {
      a.setAttribute('href', `/${currentLang}/${href}`);
    }
  });
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    const ch = canonical.getAttribute('href');
    if (ch && ch.startsWith('https://browserpdf.app/') && !ch.includes(`/${currentLang}/`)) {
      const path = ch.substring('https://browserpdf.app'.length) || '/';
      canonical.setAttribute('href', `https://browserpdf.app/${currentLang}${path === '/' ? '/' : path}`);
    }
  }
}

function createLangSwitcher() {
  const header = document.querySelector('.site-header');
  if (!header || header.querySelector('.lang-switcher')) return;
  const wrap = document.createElement('div');
  wrap.className = 'lang-switcher';
  const sel = document.createElement('select');
  sel.className = 'lang-select';
  sel.id = 'lang-switcher';
  sel.name = 'lang-switcher';
  sel.setAttribute('aria-label', 'Language');
  for (const code of SUPPORTED_LANGS) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = LANG_NAMES[code];
    if (code === currentLang) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    const lang = sel.value;
    try { localStorage.setItem('browserpdf-lang', lang); } catch(e) {}
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length > 0 && SUPPORTED_LANGS.includes(parts[0])) parts.shift();
    const base = '/' + parts.join('/');
    window.location.href = lang === 'en' ? base : `/${lang}${base}`;
  });
  wrap.appendChild(sel);
  header.appendChild(wrap);
}

function setupObserver() {
  if (currentLang === 'en') return;
  const obs = new MutationObserver(mutations => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          if (node.hasAttribute && (node.hasAttribute('data-i18n') || node.hasAttribute('data-i18n-html'))) {
            applyToElement(node);
          }
          if (node.querySelectorAll) {
            applyTranslations(node);
          }
        }
      });
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

export function t(key, fallback, params) {
  const str = dict[key] || fallback || key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (match, k) => (k in params ? String(params[k]) : match));
}

export function getLang() { return currentLang; }
export function isLoaded() { return loaded; }
export function onReady(cb) { loaded ? cb() : waitingCallbacks.push(cb); }

export async function init() {
  currentLang = detectLang();
  document.documentElement.setAttribute('lang', currentLang);
  if (currentLang !== 'en') {
    document.documentElement.setAttribute('dir', currentLang === 'ar' ? 'rtl' : 'ltr');
    dict = await loadTranslations(currentLang);
    applyTranslations();
    rewriteLinks();
    setupObserver();
  }
  createLangSwitcher();
  loaded = true;
  waitingCallbacks.forEach(cb => cb());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
