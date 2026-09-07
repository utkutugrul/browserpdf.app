import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';
const CACHE_NAME = 'bpdf-shell-v1';
const ALLOWLIST = [
  '/offline.html', '/css/offline.css', '/css/styles.css', '/favicon-32.png',
  '/apple-touch-icon.png', '/pwa/icon-192.png', '/pwa/icon-512.png',
  '/manifest.webmanifest', '/js/pwa.js',
];

async function allowedContext(browser, initScript) {
  const context = await browser.newContext({ baseURL: BASE_URL, serviceWorkers: 'allow' });
  if (initScript) await context.addInitScript(initScript);
  return context;
}

async function openControlled(page) {
  await page.goto('/');
  await expect(page.locator('#pwaPanel')).toBeVisible({ timeout: 20_000 });
  await page.locator('#pwaPanel details').evaluate((details) => { details.open = true; });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

function pngDimensions(bytes) {
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

async function createLifecycleServer() {
  let version = 1;
  const fixtureHtml = `<!doctype html><html><body>
    <aside id="pwaPanel" hidden><details><summary id="pwaTitle">Offline shell settings</summary>
    <p id="pwaStorage">Storage</p><button id="pwaPersist">Persist</button>
    <button id="pwaRemove">Remove</button><button id="pwaUpdate" hidden>Update</button>
    <p id="pwaStatus"></p></details></aside><script type="module" src="/js/pwa.js"></script>
  </body></html>`;
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(fixtureHtml);
      return;
    }
    try {
      const target = path.resolve(PUBLIC, `.${pathname}`);
      if (!target.startsWith(`${PUBLIC}${path.sep}`)) throw new Error('outside public');
      let body = readFileSync(target);
      if (pathname === '/sw.js') {
        const source = body.toString().replace("const SHELL_REVISION = 'v1';", `const SHELL_REVISION = 'v${version}';`);
        body = Buffer.from(`const FIXTURE_VERSION=${version};\n${source}\nself.addEventListener('message',(event)=>{if(event.data?.type==='GET_FIXTURE_VERSION')event.ports[0]?.postMessage(FIXTURE_VERSION);});`);
      } else if (pathname === '/css/styles.css' || pathname === '/css/offline.css') {
        body = Buffer.concat([body, Buffer.from(`\n/* DEPLOY${version} */\n`)]);
      }
      const type = pathname.endsWith('.js') ? 'text/javascript; charset=utf-8'
        : pathname.endsWith('.css') ? 'text/css; charset=utf-8'
          : pathname.endsWith('.html') ? 'text/html; charset=utf-8'
            : pathname.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/octet-stream';
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404); response.end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    nextVersion() { version += 1; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function controlledWorkerVersion(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('worker version timeout')), 5_000);
    channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
    navigator.serviceWorker.controller.postMessage({ type: 'GET_FIXTURE_VERSION' }, [channel.port2]);
  }));
}

test('manifest, decoded icons, fixed offline document, and normal nonce/no-store contract are exact', async ({ request, page }) => {
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    id: '/', start_url: '/', scope: '/', display: 'standalone',
    theme_color: '#5b52e0', background_color: '#f7f7fb',
  });
  expect(manifest.icons).toEqual([
    { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ]);
  for (const [src, size] of [['/pwa/icon-192.png', 192], ['/pwa/icon-512.png', 512]]) {
    const response = await request.get(src);
    expect(response.headers()['content-type']).toContain('image/png');
    expect(pngDimensions(Buffer.from(await response.body()))).toEqual([size, size]);
    await page.goto(src);
    expect(await page.locator('img').evaluate((image) => [image.naturalWidth, image.naturalHeight])).toEqual([size, size]);
  }

  const offline = await request.get('/offline.html');
  expect(offline.headers()['x-browserpdf-static-offline']).toBe('1');
  expect(offline.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
  expect(offline.headers()['content-security-policy']).toBe("default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  const offlineHtml = await offline.text();
  expect(offlineHtml).toContain('This is a static connection fallback.');
  expect(offlineHtml).not.toMatch(/<script|nonce=|document tools work offline/i);

  const normal = await page.goto('/');
  expect(normal.headers()['cache-control']).toBe('no-store');
  expect(normal.headers()['content-security-policy']).toMatch(/nonce-[^']+/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
});

test('SW waits for explicit update action, prunes only obsolete owned caches, and caches exactly the allowlist', async ({ browser }) => {
  const lifecycleServer = await createLifecycleServer();
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
  await page.goto(lifecycleServer.url);
  await expect(page.locator('#pwaPanel')).toBeVisible();
  await page.locator('#pwaPanel details').evaluate((details) => { details.open = true; });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  expect(await controlledWorkerVersion(page)).toBe(1);
  await page.evaluate(async () => {
    await caches.open('bpdf-shell-v0');
    await caches.open('unrelated-product-cache');
  });
  lifecycleServer.nextVersion();
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('/')).update(); });
  await page.waitForFunction(() => navigator.serviceWorker.getRegistration('/').then((entry) => Boolean(entry?.waiting)));
  await expect(page.locator('#pwaUpdate')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await controlledWorkerVersion(page)).toBe(1);
  const waitingState = await page.evaluate(async () => {
    const cache1 = await caches.open('bpdf-shell-v1');
    const cache2 = await caches.open('bpdf-shell-v2');
    return {
      names: await caches.keys(),
      activeFetch: await fetch('/css/styles.css', { cache: 'reload' }).then((response) => response.text()),
      cache1: await cache1.match('/css/styles.css').then((response) => response.text()),
      cache2: await cache2.match('/css/styles.css').then((response) => response.text()),
    };
  });
  expect(waitingState.names).toEqual(expect.arrayContaining(['bpdf-shell-v1', 'bpdf-shell-v2', 'unrelated-product-cache']));
  expect(waitingState.activeFetch).toContain('DEPLOY1');
  expect(waitingState.cache1).toContain('DEPLOY1');
  expect(waitingState.cache2).toContain('DEPLOY2');

  await page.locator('#pwaUpdate').click();
  await expect.poll(() => controlledWorkerVersion(page)).toBe(2);
  await page.waitForFunction(() => navigator.serviceWorker.getRegistration('/').then((entry) => entry?.active?.state === 'activated'));
  await expect(page.locator('#pwaStatus')).toContainText('Update activated');
  await expect.poll(() => page.evaluate(() => caches.keys().then((names) => names.includes('bpdf-shell-v0')))).toBe(false);
  const state = await page.evaluate(async (cacheName) => {
    const names = await caches.keys();
    const entries = await (await caches.open(cacheName)).keys();
    const servedCss = await fetch('/css/styles.css', { cache: 'reload' }).then((response) => response.text());
    return { names, paths: entries.map((entry) => new URL(entry.url).pathname).sort(), servedCss };
  }, 'bpdf-shell-v2');
  expect(state.names).toContain('bpdf-shell-v2');
  expect(state.names).toContain('unrelated-product-cache');
  expect(state.names).not.toContain('bpdf-shell-v0');
  expect(state.names).not.toContain('bpdf-shell-v1');
  expect(state.paths).toEqual([...ALLOWLIST].sort());
  expect(state.servedCss).toContain('DEPLOY2');
  expect(errors).toEqual([]);
  } finally {
    await context.close();
    await lifecycleServer.close();
  }
});

test('fetch policy excludes HTML, metrics, downloads, non-GET, cross-origin, blob, data, and query variants', async ({ browser }) => {
  const context = await allowedContext(browser);
  const page = await context.newPage();
  await openControlled(page);
  await page.evaluate(async () => {
    const attempts = [
      fetch('/merge').catch(() => null), fetch('/metrics/phase8').catch(() => null),
      fetch('/download/result.pdf').catch(() => null), fetch('/css/styles.css?user=1').catch(() => null),
      fetch('/css/styles.css', { method: 'POST' }).catch(() => null),
      fetch('https://example.invalid/file.pdf', { mode: 'no-cors' }).catch(() => null),
      fetch(URL.createObjectURL(new Blob(['private']))).catch(() => null),
      fetch('data:text/plain,private').catch(() => null),
    ];
    await Promise.all(attempts);
  });
  const paths = await page.evaluate(async (cacheName) => (await (await caches.open(cacheName)).keys())
    .map((entry) => `${new URL(entry.url).pathname}${new URL(entry.url).search}`).sort(), CACHE_NAME);
  expect(paths).toEqual([...ALLOWLIST].sort());
  // A planted Cache API decoy proves metrics are still network-only: offline
  // fetch must fail instead of returning the cached response.
  await page.evaluate(async (cacheName) => {
    await (await caches.open(cacheName)).put('/metrics/phase8-decoy', new Response('must-not-be-used'));
  }, CACHE_NAME);
  await context.setOffline(true);
  expect(await page.evaluate(() => fetch('/metrics/phase8-decoy').then(() => 'response', () => 'network-error'))).toBe('network-error');
  await context.setOffline(false);
  await page.evaluate(async (cacheName) => { await (await caches.open(cacheName)).delete('/metrics/phase8-decoy'); }, CACHE_NAME);
  await context.close();
});

test('uncached offline navigation shows only the intentional static connection fallback', async ({ browser }) => {
  const context = await allowedContext(browser);
  const page = await context.newPage();
  await openControlled(page);
  await context.setOffline(true);
  await page.goto('/merge?uncached-navigation=1');
  await expect(page.locator('h1')).toHaveText('You are offline');
  await expect(page.locator('main')).toContainText('document tools and their external processing libraries are not enabled for offline use');
  expect(await page.locator('script').count()).toBe(0);
  expect(await page.locator('input, textarea, [download]').count()).toBe(0);
  await context.close();
});

test('storage persistence is user-triggered, rejections stay console-clean, and remove is ownership-scoped', async ({ browser }) => {
  const context = await allowedContext(browser, () => {
    window.__persistCalls = 0;
    Object.defineProperty(navigator.storage, 'estimate', { configurable: true, value: async () => ({ usage: 1_500_000, quota: 9_000_000 }) });
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => { window.__persistCalls += 1; return true; } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await openControlled(page);
  await expect(page.locator('#pwaStorage')).toContainText('1.5 MB');
  expect(await page.evaluate(() => window.__persistCalls)).toBe(0);
  await page.locator('#pwaPersist').click();
  expect(await page.evaluate(() => window.__persistCalls)).toBe(1);

  await page.evaluate(async () => {
    await caches.open('unrelated-product-cache');
    await navigator.serviceWorker.register('/sw.js?unrelated=1', { scope: '/unrelated-scope/' });
  });
  await page.waitForFunction(() => navigator.serviceWorker.getRegistration('/unrelated-scope/').then((entry) => Boolean(entry?.active)));
  await page.evaluate(() => {
    const removeCache = caches.delete.bind(caches);
    Object.defineProperty(caches, 'delete', {
      configurable: true,
      value: async (name) => {
        const removed = await removeCache(name);
        if (name.startsWith('bpdf-')) await fetch('/css/styles.css');
        return removed;
      },
    });
  });
  await page.locator('#pwaRemove').click();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistration('/').then(Boolean))).toBe(false);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistration('/unrelated-scope/').then(Boolean))).toBe(true);
  expect(await page.evaluate(() => caches.keys())).toEqual(['unrelated-product-cache']);
  expect(errors).toEqual([]);
  await context.close();

  const rejectContext = await allowedContext(browser, () => {
    Object.defineProperty(navigator.storage, 'estimate', { configurable: true, value: async () => { throw new Error('denied'); } });
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => { throw new Error('denied'); } });
  });
  const rejectPage = await rejectContext.newPage();
  const rejectedErrors = [];
  rejectPage.on('console', (message) => { if (message.type() === 'error') rejectedErrors.push(message.text()); });
  rejectPage.on('pageerror', (error) => rejectedErrors.push(error.message));
  await openControlled(rejectPage);
  await expect(rejectPage.locator('#pwaStorage')).toHaveText('Browser storage estimate unavailable.');
  await rejectPage.locator('#pwaPersist').click();
  await expect(rejectPage.locator('#pwaStatus')).toHaveText('The browser could not complete this storage request.');
  await rejectPage.evaluate(() => {
    Object.defineProperty(caches, 'keys', { configurable: true, value: async () => { throw new Error('denied'); } });
  });
  await rejectPage.locator('#pwaRemove').click();
  await expect(rejectPage.locator('#pwaStatus')).toHaveText('The browser could not complete this storage request.');
  expect(rejectedErrors).toEqual([]);
  await rejectContext.close();
});

test('registration is progressive when blocked and all locale dictionaries carry bounded offline copy', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/merge');
  await expect(page.locator('h1')).toContainText('Merge');
  await expect(page.locator('#pwaPanel')).toBeHidden();
  expect(errors).toEqual([]);

  const translations = JSON.parse(readFileSync(path.join(PUBLIC, 'translations.json'), 'utf8'));
  const keys = [
    'pwa.title', 'pwa.capability', 'pwa.storage_unknown', 'pwa.persist', 'pwa.remove',
    'pwa.update', 'pwa.persisted', 'pwa.persist_denied', 'pwa.removed',
    'pwa.update_activated', 'pwa.action_failed',
  ];
  expect(Object.keys(translations)).toHaveLength(21);
  for (const [language, dictionary] of Object.entries(translations)) {
    for (const key of keys) expect(dictionary[key], `${language} ${key}`).toBeTruthy();
    expect(dictionary['pwa.capability'], language).not.toMatch(/^Only a small static shell/);
    expect(dictionary['pwa.storage_unknown'], language).not.toBe(dictionary['pwa.title']);
    expect(dictionary['pwa.persist_denied'], language).not.toBe(dictionary['pwa.persist']);
    expect(dictionary['pwa.persisted'], language).not.toBe(dictionary['pwa.persist']);
    expect(dictionary['pwa.removed'], language).not.toBe(dictionary['pwa.remove']);
    expect(dictionary['pwa.update_activated'], language).not.toBe(dictionary['pwa.update']);
  }
  execFileSync('python3', [path.join(ROOT, 'scripts/update-phase8-translations.py'), '--check']);
  const swSource = readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  expect(swSource.match(/skipWaiting\(/g)).toHaveLength(1);
  expect(swSource).not.toMatch(/addEventListener\('install'[\s\S]{0,300}skipWaiting/);
  const matrix = readFileSync(path.join(ROOT, 'docs/offline-vendoring-matrix.md'), 'utf8');
  expect((matrix.match(/^\| [a-z-]+ \|.*\| Unavailable \/ not enabled \|/gm) || [])).toHaveLength(29);
});
