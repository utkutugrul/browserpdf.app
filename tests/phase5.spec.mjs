import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FIXTURE_DIR } from './make-fixtures.mjs';
import { scanPdfPrivacy, withPdfDocument } from '../public/js/core/privacy-scan.js';
import { createPrivacyScanTools } from '../public/js/webmcp.js';

const fixture = (name) => path.join(FIXTURE_DIR, name);

async function installTestModelContext(page) {
  await page.addInitScript(() => {
    const tools = new Map();
    Object.defineProperty(window, '__privacyTools', { value: tools });
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      async registerTool(tool, { signal } = {}) {
        tools.set(tool.name, tool);
        signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true });
      },
    } });
  });
}

test('PDF.js lifecycle destroys task and document on success, error, and abort', async () => {
  const makeRuntime = ({ wait = false } = {}) => {
    const calls = { task: 0, doc: 0 };
    let rejectPromise;
    const doc = { destroy: async () => { calls.doc++; } };
    const task = {
      promise: wait ? new Promise((resolve, reject) => { rejectPromise = reject; }) : Promise.resolve(doc),
      destroy: async () => { calls.task++; rejectPromise?.(new DOMException('cancelled', 'AbortError')); },
    };
    return { runtime: { getDocument: () => task }, calls };
  };
  const success = makeRuntime();
  await expect(withPdfDocument(success.runtime, new Uint8Array([1]), {}, async () => 7)).resolves.toBe(7);
  expect(success.calls).toEqual({ task: 1, doc: 1 });
  const failure = makeRuntime();
  await expect(withPdfDocument(failure.runtime, new Uint8Array([1]), {}, async () => { throw new Error('inspect'); })).rejects.toThrow('inspect');
  expect(failure.calls).toEqual({ task: 1, doc: 1 });
  const aborted = makeRuntime({ wait: true });
  const controller = new AbortController();
  const pending = withPdfDocument(aborted.runtime, new Uint8Array([1]), { signal: controller.signal }, async () => 1);
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(aborted.calls.task).toBeGreaterThanOrEqual(1);
  expect(aborted.calls.doc).toBe(0);
});

test('successfully opened permissioned input is marked encrypted and sensitive storage is capped', async () => {
  const calls = { task: 0, doc: 0 };
  const page = {
    getAnnotations: async () => [], getJSActions: async () => null,
    getTextContent: async () => ({ items: [{ str: Array.from({ length: 12 }, (_, i) => `p${i}@example.test`).join(' ') }] }),
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
  };
  const doc = {
    numPages: 1, getMetadata: async () => ({ info: {}, metadata: null }),
    getAttachments: async () => new Map(), getJSActions: async () => null,
    getOpenAction: async () => null, getFieldObjects: async () => null,
    getCalculationOrderIds: async () => null, getPermissions: async () => [4, 8],
    getPage: async () => page, destroy: async () => { calls.doc++; },
  };
  const runtime = { OPS: {}, getDocument: () => ({ promise: Promise.resolve(doc), destroy: async () => { calls.task++; } }) };
  const report = await scanPdfPrivacy(new Uint8Array([1]), { pdfjs: runtime, maxMatches: 3 });
  expect(report.encryption).toEqual({ encrypted: true, locked: false });
  expect(report.sensitiveText.count).toBe(3);
  expect(report.sensitiveText.findings).toHaveLength(3);
  expect(report.sensitiveText.truncated).toBe(true);
  expect(calls).toEqual({ task: 1, doc: 1 });

  let destroyed = 0;
  const locked = await scanPdfPrivacy(new Uint8Array([1]), {
    pdfjs: { getDocument: () => ({ promise: Promise.reject(Object.assign(new Error('Password required'), { name: 'PasswordException' })), destroy: async () => { destroyed++; } }) },
  });
  expect(locked.encryption).toEqual({ encrypted: true, locked: true });
  expect(destroyed).toBe(1);
});

test('rich fixture reports bounded detectable structures without executing or following them', async ({ page }) => {
  const consoleMessages = [];
  const requested = [];
  const richBytes = await readFile(fixture('privacy-rich.pdf'));
  page.on('console', (message) => consoleMessages.push(message.text()));
  page.on('request', (request) => requested.push({ url: request.url(), body: request.postDataBuffer() }));
  await page.goto('/privacy-scan');
  await page.setInputFiles('#fileInput', fixture('privacy-rich.pdf'));
  await page.click('#scanBtn');
  await expect(page.locator('#scanResults')).toBeVisible();
  const report = await page.evaluate(() => window.__privacyReportForTest);
  const counts = await page.locator('#findingList li').allTextContents();
  expect(counts.join(' ')).toContain('Standard document metadata');
  expect(counts.join(' ')).toContain('XMP metadata');
  expect(counts.join(' ')).toContain('Catalog attachments');
  expect(counts.join(' ')).toContain('Page attachments');
  expect(counts.join(' ')).toContain('Links and actions');
  expect(counts.join(' ')).toContain('Document JavaScript actions');
  expect(counts.join(' ')).toContain('Page JavaScript actions');
  expect(counts.join(' ')).toContain('Form fields');
  expect(counts.join(' ')).toContain('Form calculation order');
  expect(counts.join(' ')).toContain('Detectable invisible-text operations');
  await expect(page.locator('#sensitiveDetails')).not.toHaveAttribute('open', '');
  expect(consoleMessages.join('\n')).not.toContain('qa@example.test');
  expect(consoleMessages.join('\n')).not.toContain('123-45-6789');
  expect(requested.some((request) => request.url.includes('example.invalid'))).toBe(false);
  for (const request of requested) {
    expect(decodeURIComponent(request.url)).not.toMatch(/privacy-rich\.pdf|qa@example\.test|123-45-6789/i);
    expect(request.body?.toString().match(/qa@example\.test|123-45-6789/i) || null).toBeNull();
    expect(request.body?.includes(richBytes.subarray(0, 64)) || false).toBe(false);
  }
  expect(report).toBeUndefined();

  const coreReport = await page.evaluate(async (values) => {
    const [{ ensurePdfJs, PDFJS_ASSET_URLS }, { scanPdfPrivacy }] = await Promise.all([
      import('/js/lib-loader.js'), import('/js/core/privacy-scan.js'),
    ]);
    return scanPdfPrivacy(new Uint8Array(values), { pdfjs: await ensurePdfJs(), pdfjsAssets: PDFJS_ASSET_URLS });
  }, Array.from(richBytes));
  expect(coreReport.standardMetadata.count).toBe(8);
  expect(coreReport.xmp.present).toBe(true);
  expect(coreReport.catalogAttachments.count).toBe(1);
  expect(coreReport.pageAttachments.count).toBe(1);
  expect(coreReport.annotations.count).toBeGreaterThanOrEqual(3);
  expect(coreReport.linksAndActions.count).toBeGreaterThanOrEqual(1);
  expect(coreReport.javascript).toEqual({ documentActions: 1, pageActions: 1, locations: [{ page: 1, count: 1 }] });
  expect(coreReport.forms.fieldCount).toBe(1);
  expect(coreReport.forms.calculationOrderCount).toBe(1);
  expect(coreReport.invisibleText.operations).toBe(1);
  expect(coreReport.sensitiveText.categories.email).toBe(1);
  expect(coreReport.sensitiveText.findings.every((finding) =>
    finding.page === 1 && finding.item >= 0 && finding.offset >= 0 && finding.match.length <= 120 && ['high', 'medium'].includes(finding.confidence))).toBe(true);
  for (const value of Object.values(coreReport)) {
    if (Array.isArray(value?.locations)) expect(value.locations.length).toBeLessThanOrEqual(100);
  }
});

test('cleanup is explicit, produces a real verified artifact, and leaves original bytes unchanged', async ({ page }) => {
  const original = await readFile(fixture('privacy-rich.pdf'));
  await page.goto('/privacy-scan');
  await page.setInputFiles('#fileInput', fixture('privacy-rich.pdf'));
  await page.click('#scanBtn');
  await expect(page.locator('#cleanupPanel')).toBeVisible();
  await expect(page.locator('#metadataCleanup')).toBeEnabled();
  await page.check('#metadataCleanup');
  await page.click('#cleanupBtn');
  await expect(page.locator('#successSection')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.click('#downloadBtn');
  const download = await downloadPromise;
  const output = await readFile(await download.path());
  expect(Buffer.compare(original, await readFile(fixture('privacy-rich.pdf')))).toBe(0);
  expect(output.length).toBeGreaterThan(500);
  expect(Buffer.compare(original, output)).not.toBe(0);
  await page.setInputFiles('#fileInput', { name: 'cleaned.pdf', mimeType: 'application/pdf', buffer: output });
  await page.click('#scanBtn');
  await expect(page.locator('#findingList')).not.toContainText('Standard document metadata');
  await expect(page.locator('#findingList')).toContainText('XMP metadata');
  await expect(page.locator('#findingList')).toContainText('Catalog attachments');
});

test('WebMCP privacy tool is selected-file dependent, strict, bounded, and metadata-only', async () => {
  const raw = 'qa@example.test 123-45-6789';
  const absent = createPrivacyScanTools({ getSelectedFile: () => null });
  expect(absent).toEqual([]);
  const tools = createPrivacyScanTools({
    getSelectedFile: () => ({ name: 'private.pdf', size: 42 }),
    scanSelected: async () => ({
      version: 1, pageCount: 1, counts: { sensitivePatterns: 2 },
      sensitiveCategories: { email: 1, 'us-ssn': 1 }, warningCount: 0,
      findings: [{ match: raw }], bytes: new Uint8Array([1]), blobUrl: 'blob:secret', path: '/private.pdf',
    }),
  });
  expect(tools).toHaveLength(1);
  expect(tools[0].annotations.untrustedContentHint).toBe(true);
  expect(tools[0].inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
  await expect(tools[0].execute({ extra: true })).rejects.toThrow('Unknown input property');
  const result = await tools[0].execute({});
  expect(JSON.stringify(result)).not.toContain(raw);
  expect(JSON.stringify(result)).not.toMatch(/bytes|base64|blob:|\/private\.pdf/);
  const controller = new AbortController(); controller.abort();
  await expect(tools[0].execute({}, { signal: controller.signal })).rejects.toThrow();
});

test('page registration exposes one selected-file tool and returns no raw matches or bytes', async ({ page }) => {
  await installTestModelContext(page);
  await page.goto('/privacy-scan');
  expect(await page.evaluate(() => [...window.__privacyTools.keys()])).toEqual([]);
  await page.setInputFiles('#fileInput', fixture('privacy-rich.pdf'));
  await expect.poll(() => page.evaluate(() => [...window.__privacyTools.keys()])).toEqual(['scan-selected-document-privacy']);
  const result = await page.evaluate(() => window.__privacyTools.get('scan-selected-document-privacy').execute({}, { signal: new AbortController().signal }));
  expect(result.counts.sensitivePatterns).toBeGreaterThan(0);
  expect(JSON.stringify(result)).not.toMatch(/qa@example|123-45-6789|bytes|base64|blob:|path/i);
  await page.click('#clearBtn');
  await expect.poll(() => page.evaluate(() => [...window.__privacyTools.keys()])).toEqual([]);
});

test('clear invalidates a delayed file read so stale selection and tools cannot reappear', async ({ page }) => {
  await installTestModelContext(page);
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/privacy-scan');
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    window.__originalPrivacyArrayBuffer = original;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    window.__releasePrivacyRead = release;
    File.prototype.arrayBuffer = async function delayedRead() { await gate; return original.call(this); };
  });
  await page.setInputFiles('#fileInput', fixture('privacy-rich.pdf'));
  await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#clearBtn')).toBeEnabled();
  await page.click('#clearBtn');
  await page.evaluate(() => window.__releasePrivacyRead());
  await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#selectedFile')).toBeHidden();
  await expect.poll(() => page.evaluate(() => [...window.__privacyTools.keys()])).toEqual([]);
  await expect(page.locator('#errorSection')).toBeHidden();
  expect(consoleErrors).toEqual([]);

  await page.evaluate(() => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    window.__releaseFailedPrivacyRead = release;
    File.prototype.arrayBuffer = async function failedRead() { await gate; throw new Error('delayed read failure'); };
  });
  await page.setInputFiles('#fileInput', fixture('privacy-rich.pdf'));
  await page.click('#clearBtn');
  await page.evaluate(() => window.__releaseFailedPrivacyRead());
  await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#errorSection')).toBeHidden();
  await expect.poll(() => page.evaluate(() => [...window.__privacyTools.keys()])).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('clear during delayed runtime loading suppresses stale scan and cleanup completion', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await installTestModelContext(page);
  await page.route('**/pdf.min.mjs', async (route) => { await new Promise((resolve) => setTimeout(resolve, 300)); await route.continue(); });
  await page.route('**/pdf-lib.min.js', async (route) => { await new Promise((resolve) => setTimeout(resolve, 300)); await route.continue(); });
  await page.goto('/privacy-scan');
  await page.setInputFiles('#fileInput', fixture('privacy-rich.pdf'));
  await page.click('#scanBtn');
  await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'true');
  await page.click('#clearBtn');
  await page.waitForTimeout(500);
  await expect(page.locator('#scanResults')).toBeHidden();
  await expect(page.locator('#errorSection')).toBeHidden();
  await expect(page.locator('#successSection')).toBeHidden();
  await expect.poll(() => page.evaluate(() => [...window.__privacyTools.keys()])).toEqual([]);

  await page.setInputFiles('#fileInput', fixture('privacy-rich.pdf'));
  await page.click('#scanBtn');
  await expect(page.locator('#scanResults')).toBeVisible();
  await page.check('#metadataCleanup');
  await page.click('#cleanupBtn');
  await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#metadataCleanup')).toBeDisabled();
  await expect(page.locator('#scanBtn')).toBeDisabled();
  await page.evaluate(() => {
    const option = document.getElementById('metadataCleanup');
    option.checked = false;
    option.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#progressSection')).toBeVisible();
  const concurrent = await page.evaluate(async () => {
    try {
      await window.__privacyTools.get('scan-selected-document-privacy').execute({}, { signal: new AbortController().signal });
      return 'completed';
    } catch (error) { return error.name; }
  });
  expect(concurrent).toBe('InvalidStateError');
  await page.click('#clearBtn');
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    window.__releaseReplacementRead = release;
    File.prototype.arrayBuffer = async function delayedReplacement() { await gate; return original.call(this); };
  });
  await page.setInputFiles('#fileInput', fixture('privacy-clean.pdf'));
  await page.waitForTimeout(500);
  await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#progressSection')).toBeHidden();
  await expect(page.locator('#successSection')).toBeHidden();
  await expect(page.locator('#errorSection')).toBeHidden();
  await expect.poll(() => page.evaluate(() => [...window.__privacyTools.keys()])).toEqual([]);
  await page.evaluate(() => window.__releaseReplacementRead());
  await expect(page.locator('#selectedFile')).toContainText('privacy-clean.pdf');
  await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => page.evaluate(() => [...window.__privacyTools.keys()])).toEqual(['scan-selected-document-privacy']);
  expect(consoleErrors).toEqual([]);
});

test('signed fixture surfaces an explicit rewrite warning and layout has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/privacy-scan');
  await page.setInputFiles('#fileInput', fixture('privacy-signed.pdf'));
  await page.click('#scanBtn');
  await expect(page.locator('#signatureWarning')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('clean fixture yields no bounded findings without claiming privacy safety', async ({ page }) => {
  await page.goto('/privacy-scan');
  await page.setInputFiles('#fileInput', fixture('privacy-clean.pdf'));
  await page.click('#scanBtn');
  await expect(page.locator('#resultSummary')).toContainText('does not prove');
  await expect(page.locator('#findingList li')).toHaveCount(0);
  await expect(page.locator('#cleanupPanel')).toBeVisible();
  await expect(page.locator('#cleanupBtn')).toBeDisabled();
});

test('privacy scan stays localized and overflow-free across the responsive theme matrix', async ({ page }) => {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/tr/privacy-scan');
    await expect(page.locator('h1')).toHaveText('Algılanabilir PDF gizlilik risklerini denetleyin');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('Phase 5 migration is complete, localized, and idempotent', async () => {
  const translations = JSON.parse(await readFile(path.resolve('public/translations.json'), 'utf8'));
  const required = ['privacy_scan.h1', 'privacy_scan.intro', 'privacy_scan.scan', 'privacy_scan.limits', 'privacy_scan.category_sensitivePatterns', 'hub.open_privacy_scan'];
  expect(Object.keys(translations)).toHaveLength(21);
  for (const [language, copy] of Object.entries(translations)) {
    for (const key of required) expect(copy[key], `${language}:${key}`).toBeTruthy();
    expect(copy['privacy_scan.h1']).not.toBe('Check detectable PDF privacy risks');
    expect(copy['privacy_scan.limits']).not.toBe(copy['privacy_scan.intro']);
  }
});

test('privacy service is discoverable without changing the 29-tool catalog and cores stay DOM-free', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#toolGroups .tool-card')).toHaveCount(29);
  const details = page.locator('#toolCatalog');
  await details.evaluate((element) => { element.open = true; });
  await expect(details.locator('a[href="privacy-scan"]')).toBeVisible();
  const [scanSource, cleanupSource, sitemap, llms] = await Promise.all([
    readFile(path.resolve('public/js/core/privacy-scan.js'), 'utf8'),
    readFile(path.resolve('public/js/core/privacy-cleanup.js'), 'utf8'),
    readFile(path.resolve('public/sitemap.xml'), 'utf8'),
    readFile(path.resolve('public/llms.txt'), 'utf8'),
  ]);
  expect(scanSource).not.toMatch(/\b(?:window|navigator|globalThis)\s*[.[]|\bdocument\s*[.[]|createObjectURL|\.click\(/);
  expect(scanSource).not.toContain('hasJSActions');
  expect(cleanupSource).not.toMatch(/\b(?:window|navigator|globalThis)\s*[.[]|\bdocument\s*[.[]|createObjectURL|\.click\(/);
  expect((sitemap.match(/<loc>https:\/\/browserpdf\.app\/(?:[\w-]+\/)?privacy-scan<\/loc>/g) || [])).toHaveLength(22);
  expect(llms).toContain('[PDF Privacy Scan](/privacy-scan)');
  expect(Buffer.byteLength(scanSource) + Buffer.byteLength(cleanupSource) + (await readFile(path.resolve('public/js/privacy-scan.js'))).length).toBeLessThan(100_000);
});
