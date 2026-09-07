// Redirects www.browserpdf.app to the apex domain (301) so search engines
// see exactly one canonical host, then serves everything else from the
// static assets binding. HTML responses get a preload Link header (which
// Cloudflare surfaces as a 103 Early Hint) plus the security headers that
// can't live in a <meta> tag, including the Content-Security-Policy, which
// is the only CSP source (the old per-page <meta> duplicate was removed:
// it went stale independently of this one and silently blocked index.html's
// JSON-LD). CSP script-src is nonce-based, not hash-based: a fresh
// crypto.randomUUID() per request goes on every <script> tag via the
// HTMLRewriter 'script' handler below, so no hash ever needs updating when
// inline content changes.
//
// Every page gets a Consent Mode default (denied) bootstrap plus the gtag.js
// bootstrap (via Google Tag Gateway's first-party /metrics proxy) prepended
// to <head> ourselves — Google Tag Gateway's own zone-level auto-injection is
// turned OFF in the dashboard, since injecting it here instead means the
// loading <script> tag can carry the request's nonce, which browsers then
// propagate to any inline scripts gtag.js creates dynamically at runtime
// (content that differs per load, so it could never be hash-allowlisted).
// A cookie consent banner is appended to <body> (consent.js) that calls
// gtag('consent','update', ...) once the visitor picks accept/reject.
//
// i18n: URL paths like /es/rotate are detected, the language prefix is
// stripped, and the underlying file (rotate.html) is served from assets.
// For localized pages, HTMLRewriter sets <html lang>, injects hreflang
// <link> tags, updates the canonical URL, and injects the i18n.js module.

const SUPPORTED_LANGS = new Set([
  'es','fr','de','pt','it','ru','ja','ko','zh','zh-TW',
  'ar','hi','tr','nl','pl','id','vi','th','uk','cs','sv',
]);

const ALL_LANGS = ['en','es','fr','de','pt','it','ru','ja','ko','zh','zh-TW',
  'ar','hi','tr','nl','pl','id','vi','th','uk','cs','sv'];

const LOCALIZED_SERVICE_META = Object.freeze({
  '/workflows': 'workflows',
  '/privacy-scan': 'privacy_scan',
  '/document-doctor': 'doctor',
});

function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function replaceMetaContent(html, attribute, name, value) {
  const pattern = new RegExp(`(<meta\\s+${attribute}="${name}"\\s+content=")[^"]*(")`, 'i');
  return html.replace(pattern, `$1${escapeAttribute(value)}$2`);
}

function localizeServiceMetadata(html, lang, pagePath, dictionary) {
  const prefix = LOCALIZED_SERVICE_META[pagePath];
  if (!prefix) return html;
  const title = dictionary[`${prefix}.meta_title`];
  const description = dictionary[`${prefix}.meta_description`];
  const jsonName = dictionary[`${prefix}.jsonld_name`];
  const jsonDescription = dictionary[`${prefix}.jsonld_description`];
  const breadcrumbName = dictionary[`${prefix}.breadcrumb_name`];
  const homeName = dictionary['common.home'];
  if (![title, description, jsonName, jsonDescription, breadcrumbName, homeName].every(Boolean)) return html;

  const localizedUrl = `https://browserpdf.app/${lang}${pagePath}`;
  const localizedHome = `https://browserpdf.app/${lang}/`;
  let output = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttribute(title)}</title>`);
  output = replaceMetaContent(output, 'name', 'description', description);
  output = replaceMetaContent(output, 'property', 'og:title', title);
  output = replaceMetaContent(output, 'property', 'og:description', description);
  output = replaceMetaContent(output, 'property', 'og:url', localizedUrl);
  output = replaceMetaContent(output, 'name', 'twitter:title', title);
  output = replaceMetaContent(output, 'name', 'twitter:description', description);
  return output.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/i, (match, open, raw, close) => {
    try {
      const data = JSON.parse(raw);
      const application = data['@graph']?.find((item) => item['@type'] === 'SoftwareApplication');
      const breadcrumbs = data['@graph']?.find((item) => item['@type'] === 'BreadcrumbList');
      if (!application || !breadcrumbs?.itemListElement?.[0] || !breadcrumbs.itemListElement[1]) return match;
      application.name = jsonName;
      application.description = jsonDescription;
      application.url = localizedUrl;
      breadcrumbs.itemListElement[0].name = homeName;
      breadcrumbs.itemListElement[0].item = localizedHome;
      breadcrumbs.itemListElement[1].name = breadcrumbName;
      breadcrumbs.itemListElement[1].item = localizedUrl;
      return `${open}${JSON.stringify(data)}${close}`;
    } catch {
      return match;
    }
  });
}

function buildHreflang(pagePath) {
  let html = '';
  for (const lang of ALL_LANGS) {
    const href = lang === 'en'
      ? `https://browserpdf.app${pagePath}`
      : `https://browserpdf.app/${lang}${pagePath === '/' ? '/' : pagePath}`;
    html += `<link rel="alternate" hreflang="${lang}" href="${href}">`;
  }
  html += `<link rel="alternate" hreflang="x-default" href="https://browserpdf.app${pagePath}">`;
  return html;
}

function withSecurityHeaders(response, csp) {
  // HTMLRewriter and ASSETS responses can have immutable headers.
  // Always clone into a fresh Response before mutating headers.
  const out = new Response(response.body, response);
  out.headers.set('Content-Type', 'text/html; charset=utf-8');
  out.headers.append('Link', '</css/styles.css>; rel=preload; as=style');
  out.headers.set('Content-Security-Policy', csp);
  // Every HTML response bakes in a fresh, one-time nonce: caching it (edge
  // or browser) would mean serving that same "one-time" nonce to many
  // different visitors, defeating its entire purpose (an attacker who
  // observes a cached response gets a nonce that's still valid for anyone
  // else served the same cached copy). Must never be cached, anywhere.
  out.headers.set('Cache-Control', 'no-store');
  out.headers.set('X-Frame-Options', 'DENY');
  out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  out.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), tools=(self)');
  out.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  out.headers.set('Cross-Origin-Resource-Policy', 'same-site');
  out.headers.set('X-Content-Type-Options', 'nosniff');
  return out;
}

// Hybrid CSP: fixed sha256 hashes for our own scripts whose content never
// varies (theme detection, Consent Mode defaults) - stricter than a nonce,
// since only that exact approved content can ever run, not just anything
// carrying a valid nonce. The nonce is reserved for what genuinely needs
// it: Google's tag (loaded ourselves so the loading tag can carry it) and
// whatever inline scripts it creates dynamically at runtime, whose content
// differs per load and could never be hash-pinned. Per-page JSON-LD also
// rides the nonce via the HTMLRewriter 'script' handler below, a deliberate
// (low-risk: inert structured data, not executable logic) exception to
// avoid going back to per-page hash maintenance.
const THEME_SCRIPT_HASH = 'sha256-MBX6KQWOTYI9yYLhxVE8dsfAxsfjKXII4zjTukS/HyI=';
const CONSENT_DEFAULT_SCRIPT_HASH = 'sha256-ognkPwlPhnqDRznHMFTFetXSSrn2YYKXAZXZxPst454=';
// gtag.js, once loaded, injects two of its OWN inline init snippets into <head>
// without our nonce (the Tag Gateway first-party bootstrap, and gtag's js/set
// developer_id init). Our strict CSP was blocking them - harmless (our own
// nonce'd gtag('config') still fires, so GA works) but it logged two console
// CSP errors on every page. Their content is fixed, so we allow them by hash.
// If Google ever changes these snippets the hashes go stale and the two console
// errors return (no functional impact); update them from the DevTools console
// message, which prints the exact expected sha256.
const GTAG_TAGGATEWAY_HASH = 'sha256-fuxqsG3Gv5BUqOqtbuWAMkyKtWVCJl2HBufVue5Q//k=';
const GTAG_INIT_HASH = 'sha256-n8EGvd+f0qUCWGy8Y7UVeKDrBiP6td4UjWKroJeastE=';
function buildCsp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' blob: https://cdn.jsdelivr.net https://www.googletagmanager.com https://static.cloudflareinsights.com 'wasm-unsafe-eval' 'nonce-${nonce}' '${THEME_SCRIPT_HASH}' '${CONSENT_DEFAULT_SCRIPT_HASH}' '${GTAG_TAGGATEWAY_HASH}' '${GTAG_INIT_HASH}'`,
    "worker-src 'self' blob:",
    "connect-src 'self' https://cdn.jsdelivr.net https://www.google-analytics.com https://region1.google-analytics.com https://region2.google-analytics.com https://cloudflareinsights.com",
    "img-src 'self' data: blob: https://www.googletagmanager.com https://www.google-analytics.com https://cloudflareinsights.com",
    "style-src 'self'",
    "font-src 'self' https://cdn.jsdelivr.net",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

// Fixed content -> allowed via CONSENT_DEFAULT_SCRIPT_HASH above, not a
// nonce. Must stay byte-for-byte identical to what that hash was computed
// from (the exact script content between the tags, nothing more).
const CONSENT_DEFAULT_SCRIPT = `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('consent','default',{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'denied','wait_for_update':500});</script>`;

// Loaded ourselves (Google Tag Gateway's own auto-injection is turned off in
// the dashboard) so this tag can carry a nonce, which browsers then propagate
// to any inline scripts gtag.js creates dynamically at runtime.
// The loader is `async` so the ~150 KiB gtag.js never blocks first paint: the
// inline gtag('config') call below only queues into dataLayer (defined by the
// consent-default script that runs first), and async gtag.js drains the queue
// once it loads. This is exactly how Google's canonical snippet behaves.
//
// The measurement ID is a Worker secret (`wrangler secret put GTAG_MEASUREMENT_ID`),
// not a literal in this file, so a fork deployed as-is sends no analytics anywhere
// rather than silently reporting to this project's GA property. See README.
function gtagBootstrapScript(nonce, measurementId) {
  if (!measurementId) return '';
  return `<script async nonce="${nonce}" src="/metrics/gtag/js?id=${measurementId}"></script><script nonce="${nonce}">gtag('js', new Date());gtag('config', '${measurementId}');</script>`;
}

const CONSENT_BANNER_HTML = `<div id="consent-banner" class="consent-banner" hidden role="region" aria-label="Analytics preferences" data-i18n-aria="consent.region_aria"><p class="consent-banner-text"><span data-i18n="consent.text">Allow analytics storage to help us understand site traffic? Analytics never receives your document files. Advertising storage stays disabled either way.</span> <a href="/privacy" data-i18n="consent.learn_more" data-i18n-aria="consent.learn_more_aria" aria-label="Learn more about how BrowserPDF uses Google Analytics">Learn more</a></p><div class="consent-banner-actions"><button type="button" class="btn btn-secondary" id="consent-reject" data-i18n="consent.reject">Reject</button><button type="button" class="btn btn-secondary" id="consent-accept" data-i18n="consent.accept">Accept</button></div></div><script src="/js/consent.js" defer></script>`;

const CONSENT_MANAGE_HTML = `<p class="site-footer-credits"><button type="button" id="consent-manage" class="consent-manage-btn" data-i18n="consent.manage">Cookie preferences</button></p>`;
const PWA_HEAD_HTML = `<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#5b52e0">`;
const PWA_PANEL_HTML = `<aside id="pwaPanel" class="pwa-panel" hidden aria-labelledby="pwaTitle"><details><summary id="pwaTitle" data-i18n="pwa.title">Offline shell settings</summary><p data-i18n="pwa.capability">Only a small static shell and an intentional connection fallback are cached. Document tools and external processing libraries are not enabled for offline use.</p><p id="pwaStorage" data-i18n="pwa.storage_unknown">Browser storage estimate unavailable.</p><div class="pwa-actions"><button id="pwaPersist" class="btn btn-ghost btn-small" type="button" data-i18n="pwa.persist">Ask browser to keep shell data</button><button id="pwaRemove" class="btn btn-ghost btn-small" type="button" data-i18n="pwa.remove">Remove offline shell data</button><button id="pwaUpdate" class="btn btn-secondary btn-small" type="button" hidden data-i18n="pwa.update">Activate available update</button></div><p id="pwaStatus" role="status" aria-live="polite"></p></details></aside><script type="module" src="/js/pwa.js"></script>`;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.hostname === 'www.browserpdf.app') {
        url.hostname = 'browserpdf.app';
        return Response.redirect(url.toString(), 301);
      }

      // IndexNow ownership proof. Served from a Worker secret instead of a file
      // in the repo, so the key never ships in source control; set it with
      // `wrangler secret put INDEXNOW_KEY`.
      if (env.INDEXNOW_KEY && url.pathname === `/${env.INDEXNOW_KEY}.txt`) {
        return new Response(env.INDEXNOW_KEY, {
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }

      // The offline fallback is the sole cacheable HTML document. It is a
      // fixed, script-free asset and deliberately bypasses nonce injection;
      // every normal page continues through the no-store HTMLRewriter path.
      if (url.pathname === '/offline.html') {
        // Static Assets canonicalizes `.html` paths with a 307. Fetch its
        // canonical internal path so this public endpoint stays a cacheable
        // 200 and cannot fall through to the normal nonce-rewrite pipeline.
        const assetUrl = new URL(url);
        assetUrl.pathname = '/offline';
        const staticResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
        const offline = new Response(staticResponse.body, staticResponse);
        offline.headers.set('Content-Type', 'text/html; charset=utf-8');
        offline.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
        offline.headers.set('Content-Security-Policy', "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        offline.headers.set('X-Content-Type-Options', 'nosniff');
        offline.headers.set('X-BrowserPDF-Static-Offline', '1');
        return offline;
      }

      const pathParts = url.pathname.split('/').filter(Boolean);
      let lang = 'en';
      // Captured before the language-prefix strip below, whose split/join
      // silently drops a trailing slash from prefixed paths.
      const hadTrailingSlash = url.pathname.length > 1 && url.pathname.endsWith('/');

      // /es or /es/ -> keep trailing slash for relative link resolution
      if (pathParts.length === 1 && SUPPORTED_LANGS.has(pathParts[0]) && !url.pathname.endsWith('/')) {
        url.pathname = `/${pathParts[0]}/`;
        return Response.redirect(url.toString(), 301);
      }

      if (pathParts.length > 0 && SUPPORTED_LANGS.has(pathParts[0])) {
        lang = pathParts[0];
        pathParts.shift();
        url.pathname = '/' + pathParts.join('/');
      }

      // Normalize empty asset path
      if (!url.pathname || url.pathname === '') url.pathname = '/';

      // Duplicate-URL hygiene: /merge/ serves the same page as /merge. Left to
      // the assets binding this is a temporary 307, and behind a language
      // prefix it used to slip through as a 200 (the split/join above already
      // dropped the slash), so redirect permanently here instead. Language
      // roots like /es/ keep their slash: the path is '/' after the strip.
      if (hadTrailingSlash && url.pathname.length > 1) {
        const canonical = url.pathname.replace(/\/+$/, '');
        return Response.redirect(
          `${url.origin}${lang === 'en' ? '' : `/${lang}`}${canonical}${url.search}`,
          301,
        );
      }

      const pagePath = url.pathname === '' ? '/' : url.pathname;
      const assetRequest = new Request(url.toString(), request);
      let response = await env.ASSETS.fetch(assetRequest);
      const type = response.headers.get('content-type') || '';

      // The assets binding answers /merge.html with a temporary 307 whose
      // Location also lacks any language prefix, dropping /tr/merge.html
      // visitors into English. Re-anchor the target in the visitor's language
      // and make the redirect permanent.
      if (response.status >= 300 && response.status < 400) {
        const loc = response.headers.get('Location');
        if (loc) {
          const target = new URL(loc, url);
          if (target.origin === url.origin) {
            const path = lang === 'en'
              ? target.pathname
              : `/${lang}${target.pathname === '/' ? '/' : target.pathname}`;
            return Response.redirect(`${url.origin}${path}${target.search}`, 301);
          }
        }
        return response;
      }

      if (!type.includes('text/html')) {
        return response;
      }

      if (lang !== 'en' && LOCALIZED_SERVICE_META[pagePath]) {
        const translationsUrl = new URL('/translations.json', url.origin);
        const translationsResponse = await env.ASSETS.fetch(new Request(translationsUrl.toString()));
        if (translationsResponse.ok) {
          const translations = await translationsResponse.json();
          const localized = localizeServiceMetadata(await response.text(), lang, pagePath, translations[lang] || {});
          response = new Response(localized, response);
        }
      }

      const nonce = crypto.randomUUID();
      const headInject = CONSENT_DEFAULT_SCRIPT + gtagBootstrapScript(nonce, env.GTAG_MEASUREMENT_ID);

      // Don't rewrite error shells if assets returned non-HTML; only transform HTML.
      let rewritten;
      if (lang !== 'en') {
        rewritten = new HTMLRewriter()
          .on('html', {
            element(el) {
              el.setAttribute('lang', lang);
              if (lang === 'ar') el.setAttribute('dir', 'rtl');
            },
          })
          .on('head', {
            element(el) {
              el.prepend(headInject, { html: true });
              el.append(buildHreflang(pagePath), { html: true });
              el.append(PWA_HEAD_HTML, { html: true });
            },
          })
          .on('link[rel="canonical"]', {
            element(el) {
              const href = el.getAttribute('href');
              if (href && href.startsWith('https://browserpdf.app/')) {
                const path = href.substring('https://browserpdf.app'.length) || '/';
                el.setAttribute('href', `https://browserpdf.app/${lang}${path === '/' ? '/' : path}`);
              }
            },
          })
          .on('body', {
            element(el) {
              el.prepend('<script type="module" src="/js/i18n.js"></script>', { html: true });
              el.append(PWA_PANEL_HTML + CONSENT_BANNER_HTML, { html: true });
            },
          })
          .on('footer.site-footer', {
            element(el) {
              el.append(CONSENT_MANAGE_HTML, { html: true });
            },
          })
          .on('script', {
            element(el) {
              el.setAttribute('nonce', nonce);
            },
          })
          .transform(response);
      } else {
        rewritten = new HTMLRewriter()
          .on('head', {
            element(el) {
              el.prepend(headInject, { html: true });
              el.append(PWA_HEAD_HTML, { html: true });
            },
          })
          .on('body', {
            element(el) {
              el.prepend('<script type="module" src="/js/i18n.js"></script>', { html: true });
              el.append(PWA_PANEL_HTML + CONSENT_BANNER_HTML, { html: true });
            },
          })
          .on('footer.site-footer', {
            element(el) {
              el.append(CONSENT_MANAGE_HTML, { html: true });
            },
          })
          .on('script', {
            element(el) {
              el.setAttribute('nonce', nonce);
            },
          })
          .transform(response);
      }

      return withSecurityHeaders(rewritten, buildCsp(nonce));
    } catch (err) {
      // Never leak a raw Worker exception page without a body.
      console.error('worker fetch failed', err);
      return new Response('Internal Error', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  },
};
