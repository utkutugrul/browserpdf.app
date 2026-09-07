import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { FIXTURE_DIR } from './make-fixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let server;
let baseURL;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
};

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const requested = path.resolve(ROOT, `.${pathname === '/' ? '/sdk/example/index.html' : pathname}`);
      if (requested !== ROOT && !requested.startsWith(`${ROOT}${path.sep}`)) throw new Error('outside root');
      const target = (await stat(requested)).isDirectory() ? path.join(requested, 'index.html') : requested;
      response.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(await readFile(target));
    } catch {
      response.writeHead(404); response.end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

async function javascriptSources(directory) {
  const sources = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) sources.push(...await javascriptSources(target));
    else if (/\.m?js$/.test(entry.name)) sources.push(await readFile(target, 'utf8'));
  }
  return sources;
}

test('site pins the patched PDF.js API and matching worker', async ({ page }) => {
  await page.goto(`${baseURL}/public/index.html`);
  const configuration = await page.evaluate(async () => {
    const { LIBS, PDFJS_ASSET_URLS } = await import('/public/js/lib-loader.js');
    return {
      api: LIBS.pdfjs.url,
      worker: LIBS.pdfjsWorker.url,
      assets: PDFJS_ASSET_URLS,
    };
  });
  expect(configuration.api).toContain('pdfjs-dist@6.2.108/');
  expect(configuration.worker).toContain('pdfjs-dist@6.2.108/');
  expect(configuration.assets.cMapPacked).toBe(true);
});

test('site does not instantiate PDF.js viewer scripting or rich annotation layers', async () => {
  const source = (await javascriptSources(path.join(ROOT, 'public/js'))).join('\n');
  expect(source).not.toMatch(/web\/pdf_viewer|AnnotationLayer|XfaLayer|PDFScriptingManager|renderRichText/);
});

test('clean browser consumer runs all four SDK APIs with local matched worker/assets and manual download', async ({ page }) => {
  const requests = [];
  let downloads = 0;
  page.on('request', (request) => requests.push(request.url()));
  page.on('download', () => { downloads++; });
  await page.goto(`${baseURL}/sdk/example/`);
  await page.setInputFiles('#files', [
    path.join(FIXTURE_DIR, 'report.pdf'), path.join(FIXTURE_DIR, 'appendix.pdf'),
  ]);
  await page.click('#run');
  await expect(page.locator('#status')).toHaveText('Complete. Download remains manual.', { timeout: 60_000 });
  const result = JSON.parse(await page.locator('#result').textContent());
  expect(result).toEqual({
    packageVersion: '0.1.0', apiVersion: 'v1', pdfjsVersion: '6.2.108', mergedPages: 5, privacyPages: 3, quickPages: 3,
    deepPages: 3, normalizedPages: 3, normalizedVerified: true,
    normalizeInputUnchanged: true,
    progressOperations: ['merge', 'inspect', 'diagnose', 'normalize'],
    lifecycle: { tasksCreated: 5, tasksDestroyed: 5, documentsDestroyed: 5 },
  });
  expect(downloads).toBe(0);
  expect(requests.some((url) => url.includes('/node_modules/pdfjs-dist/build/pdf.worker.min.mjs'))).toBe(true);
  expect(requests.some((url) => /cdn\.jsdelivr\.net|unpkg\.com/i.test(url))).toBe(false);
  const downloadPromise = page.waitForEvent('download');
  await page.click('#download');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('normalized.pdf');
  expect(downloads).toBe(1);
});
