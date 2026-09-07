import { chromium, expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { FIXTURE_DIR } from './make-fixtures.mjs';
import { createDocumentDoctorTools } from '../public/js/webmcp.js';

const fixture = (name) => path.join(FIXTURE_DIR, name);
const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';

function waitForInvocation(client, invocationId) {
  return new Promise((resolve) => {
    const listener = (event) => {
      if (event.invocationId !== invocationId) return;
      client.off('WebMCP.toolResponded', listener); resolve(event);
    };
    client.on('WebMCP.toolResponded', listener);
  });
}

async function invokeTool(client, tool, input) {
  const { invocationId } = await client.send('WebMCP.invokeTool', {
    frameId: tool.frameId, toolName: tool.name, input,
  });
  return waitForInvocation(client, invocationId);
}

async function installModelContext(page) {
  await page.addInitScript(() => {
    const tools = new Map();
    Object.defineProperty(window, '__doctorTools', { value: tools });
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      async registerTool(tool, { signal } = {}) {
        tools.set(tool.name, tool);
        signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true });
      },
    } });
  });
}

test('quick diagnosis reports real parser, structure, feature, and signature signals', async ({ page }) => {
  await page.goto('/document-doctor');
  await page.setInputFiles('#fileInput', fixture('privacy-rich.pdf'));
  await page.click('#diagnoseBtn');
  await expect(page.locator('#doctorResults')).toBeVisible();
  await expect(page.locator('#doctorFindingList')).toContainText('Strict pdf-lib parsePassed');
  await expect(page.locator('#doctorFindingList')).toContainText('Catalog attachments1');
  await expect(page.locator('#doctorFindingList')).toContainText('Page attachments1');
  await expect(page.locator('#doctorFindingList')).toContainText('Document JavaScript actions1');
  await expect(page.locator('#doctorFindingList')).toContainText('Form fields1');
  await expect(page.locator('#doctorActions')).toBeVisible();

  await page.setInputFiles('#fileInput', fixture('privacy-signed.pdf'));
  await page.click('#diagnoseBtn');
  await expect(page.locator('#signatureWarning')).toBeVisible();
  await expect(page.locator('#doctorFindingList')).toContainText('Signature fields1');
});

test('fixture corpus proves readiness, invalid boxes, malformed parsing, and render failures', async ({ page }) => {
  await page.goto('/document-doctor');
  const results = {};
  for (const name of ['doctor-tagged.pdf', 'doctor-truncated-tree.pdf', 'privacy-clean.pdf', 'doctor-broken-box.pdf', 'doctor-malformed.pdf', 'doctor-render-failure.pdf']) {
    const bytes = await readFile(fixture(name));
    results[name] = await page.evaluate(async ({ values, mode }) => {
      const [{ ensurePdfLib, ensurePdfJs, PDFJS_ASSET_URLS }, { diagnosePdf }] = await Promise.all([
        import('/js/lib-loader.js'), import('/js/core/document-doctor.js'),
      ]);
      const createCanvas = (width, height) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
      };
      return diagnosePdf(new Uint8Array(values), {
        mode, pdfLib: await ensurePdfLib(), pdfjs: await ensurePdfJs(), pdfjsAssets: PDFJS_ASSET_URLS, createCanvas,
      });
    }, { values: Array.from(bytes), mode: name === 'doctor-render-failure.pdf' ? 'deep' : 'quick' });
  }
  expect(results['doctor-tagged.pdf'].accessibilityReadiness).toMatchObject({
    structureTreePresent: true, markInfoMarked: true, languagePresent: true, titlePresent: true,
    figureCount: 1, figuresWithAlt: 1, figuresMissingAlt: 0,
  });
  expect(results['privacy-clean.pdf'].accessibilityReadiness).toMatchObject({
    structureTreePresent: false, markInfoMarked: false, languagePresent: false, figuresMissingAlt: 0,
  });
  expect(results['doctor-truncated-tree.pdf'].accessibilityReadiness.graphTruncated).toBe(true);
  expect(results['doctor-truncated-tree.pdf'].warnings.join(' ')).toContain('1,000 referenced objects');
  expect(results['doctor-broken-box.pdf'].pageBoxes.issueCount).toBe(1);
  expect(results['doctor-malformed.pdf'].parses.pdfLibStrict.ok).toBe(false);
  expect(results['doctor-malformed.pdf'].parses.pdfLibTolerant.ok).toBe(true);
  expect(results['doctor-render-failure.pdf'].deep.pagesChecked).toBe(1);
  expect(results['doctor-render-failure.pdf'].deep.renderErrors + results['doctor-render-failure.pdf'].deep.operatorErrors).toBeGreaterThan(0);

  await page.setInputFiles('#fileInput', fixture('doctor-truncated-tree.pdf'));
  await page.click('#diagnoseBtn');
  await expect(page.locator('#doctorFindingList')).toContainText('Structure-tree traversal incomplete at the 1,000-object bound');
});

test('optional PDF.js inspection failures are bounded unknown signals, never verified absence', async ({ page }) => {
  await page.goto('/document-doctor');
  const bytes = await readFile(fixture('privacy-clean.pdf'));
  const result = await page.evaluate(async (values) => {
    const [{ ensurePdfLib }, { diagnosePdf, summarizeDoctorReport }] = await Promise.all([
      import('/js/lib-loader.js'), import('/js/core/document-doctor.js'),
    ]);
    const failure = (category) => { throw new Error(`private-${category}-detail`); };
    const fakePage = {
      getAnnotations: async () => failure('annotations'),
      getJSActions: async () => failure('page-js'),
      getStructTree: async () => failure('struct-tree'),
    };
    const fakeDocument = {
      numPages: 1,
      getMetadata: async () => failure('metadata'),
      getAttachments: async () => failure('attachments'),
      getJSActions: async () => failure('document-js'),
      getOpenAction: async () => failure('open-action'),
      getFieldObjects: async () => failure('forms'),
      getCalculationOrderIds: async () => failure('calculation-order'),
      getPermissions: async () => failure('permissions'),
      getMarkInfo: async () => failure('mark-info'),
      getPage: async () => fakePage,
      destroy: async () => {},
    };
    const fakePdfJs = { getDocument: () => ({ promise: Promise.resolve(fakeDocument), destroy: async () => {} }) };
    const report = await diagnosePdf(new Uint8Array(values), { mode: 'quick', pdfLib: await ensurePdfLib(), pdfjs: fakePdfJs });
    return { report, summary: summarizeDoctorReport(report) };
  }, Array.from(bytes));
  expect(result.report.parses.pdfjsStrict.ok).toBe(true);
  expect(result.report.inspectionErrors.categories.sort()).toEqual([
    'calculation-order', 'catalog-attachments', 'document-forms', 'document-javascript',
    'document-mark-info', 'document-metadata', 'document-open-action', 'document-permissions',
    'page-annotations', 'page-javascript', 'page-structure-tree',
  ]);
  expect(result.report.inspectionErrors.count).toBe(11);
  expect(result.report.inspectionErrors.locations).toHaveLength(11);
  expect(result.report.inspectionErrors.locations.every((entry) => entry.error === 'Error' && !JSON.stringify(entry).includes('private-'))).toBe(true);
  expect(result.report.warnings.join(' ')).toContain('zero values must not be read as verified absence');
  expect(result.summary.inspectionErrors).toEqual({ count: 11, categories: expect.any(Array), truncated: false });
});

test('normalize and lossy rebuild make verified manual-download artifacts with explicit access-control loss', async ({ page }) => {
  const normalizeOriginal = await readFile(fixture('privacy-rich.pdf'));
  const rebuildOriginal = await readFile(fixture('report.pdf'));
  await page.goto('/document-doctor');
  const traffic = [];
  page.on('request', (request) => traffic.push({ url: request.url(), body: request.postDataBuffer() }));
  await page.setInputFiles('#fileInput', fixture('privacy-rich.pdf'));
  await page.click('#diagnoseBtn');
  await expect(page.locator('#normalizeBtn')).toBeEnabled();
  await page.click('#normalizeBtn');
  await expect(page.locator('#successSection')).toBeVisible();
  await expect(page.locator('#lossManifest')).toContainText('Encryption, passwords, permissions, and other access controls are not preserved');
  let downloadPromise = page.waitForEvent('download');
  await page.click('#downloadBtn');
  let output = await readFile(await (await downloadPromise).path());
  expect((await PDFDocument.load(output, { throwOnInvalidObject: true })).getPageCount()).toBe(1);
  expect(Buffer.compare(normalizeOriginal, await readFile(fixture('privacy-rich.pdf')))).toBe(0);

  await page.setInputFiles('#fileInput', fixture('report.pdf'));
  await page.check('input[value="deep"]');
  await page.click('#diagnoseBtn');
  await expect(page.locator('#rebuildBtn')).toBeEnabled();
  await page.click('#rebuildBtn');
  await expect(page.locator('#successSection')).toBeVisible();
  await expect(page.locator('#lossManifest')).toContainText('Searchable/selectable text');
  await expect(page.locator('#lossManifest')).toContainText('encryption, passwords, permissions, and other access controls');
  downloadPromise = page.waitForEvent('download');
  await page.click('#downloadBtn');
  output = await readFile(await (await downloadPromise).path());
  expect((await PDFDocument.load(output, { throwOnInvalidObject: true })).getPageCount()).toBe(3);
  expect(Buffer.compare(rebuildOriginal, await readFile(fixture('report.pdf')))).toBe(0);

  const callerInputsUnchanged = await page.evaluate(async ({ normalizeValues, rebuildValues }) => {
    const [{ ensurePdfLib, ensurePdfJs, PDFJS_ASSET_URLS }, outputs] = await Promise.all([
      import('/js/lib-loader.js'), import('/js/core/document-doctor-output.js'),
    ]);
    const [pdfLib, pdfjs] = await Promise.all([ensurePdfLib(), ensurePdfJs()]);
    const createCanvas = (width, height) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
    };
    const normalizeInput = new Uint8Array(normalizeValues);
    const normalizeBefore = normalizeInput.slice();
    await outputs.normalizePdfStructure(normalizeInput, { pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, createCanvas });
    const rebuildInput = new Uint8Array(rebuildValues);
    const rebuildBefore = rebuildInput.slice();
    await outputs.rebuildPdfPageContent(rebuildInput, { pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, createCanvas });
    return {
      normalize: normalizeInput.every((value, index) => value === normalizeBefore[index]),
      rebuild: rebuildInput.every((value, index) => value === rebuildBefore[index]),
    };
  }, { normalizeValues: Array.from(normalizeOriginal), rebuildValues: Array.from(rebuildOriginal) });
  expect(callerInputsUnchanged).toEqual({ normalize: true, rebuild: true });
  for (const request of traffic) {
    expect(decodeURIComponent(request.url)).not.toMatch(/privacy-rich\.pdf|report\.pdf|Quarterly Report 2026|qa@example\.test/i);
    for (const prefix of [normalizeOriginal.subarray(0, 64), rebuildOriginal.subarray(0, 64)]) {
      expect(request.body?.includes(prefix) || false).toBe(false);
    }
  }
});

test('password-encrypted input is diagnosed as locked and transform actions stay unavailable', async ({ page }) => {
  await installModelContext(page);
  await page.goto('/document-doctor');
  const raw = await readFile(fixture('report.pdf'));
  const protectedBytes = await page.evaluate(async (values) => {
    const { ensureCantooPdfLib } = await import('/js/lib-loader.js');
    const pdfLib = await ensureCantooPdfLib();
    const doc = await pdfLib.PDFDocument.load(new Uint8Array(values));
    doc.encrypt({ userPassword: 'doctor-pass', ownerPassword: 'doctor-pass', permissions: { printing: 'lowResolution', copying: false } });
    return Array.from(await doc.save());
  }, Array.from(raw));
  await page.setInputFiles('#fileInput', { name: 'protected.pdf', mimeType: 'application/pdf', buffer: Buffer.from(protectedBytes) });
  await page.click('#diagnoseBtn');
  await expect(page.locator('#doctorFindingList')).toContainText('Encryption detectedYes');
  await expect(page.locator('#doctorActions')).toBeHidden();
  await expect.poll(() => page.evaluate(() => [...window.__doctorTools.keys()])).toEqual(['diagnose-document']);
});

test('Document Doctor WebMCP tools are strict, state-dependent, bounded, abortable, and metadata-only', async () => {
  expect(createDocumentDoctorTools({ getSelectedFile: () => null })).toEqual([]);
  const sensitive = 'raw-secret@example.test';
  const adapter = {
    getSelectedFile: () => ({ name: 'private.pdf', size: 44 }),
    getState: () => ({ canNormalize: true, canRebuild: true }),
    diagnose: async () => ({
      version: 1, mode: 'deep', pageCount: 2, parses: { pdfLibStrict: true, pdfLibTolerant: true, pdfjsStrict: true },
      features: { forms: 1 }, readiness: { structureTreePresent: true, graphTruncated: true },
      inspectionErrors: { count: 2, categories: ['document-metadata', 'page-annotations'], truncated: false },
      deep: { performed: true, pagesChecked: 2 },
      warnings: [sensitive], bytes: new Uint8Array([1]), path: '/private.pdf',
    }),
    normalize: async () => ({ ready: true, name: 'new.pdf', size: 100, pageCount: 2, verified: true, lossItemCount: 3, bytes: [1], text: sensitive }),
    rebuild: async () => ({ ready: true, name: 'new.pdf', size: 90, pageCount: 2, verified: true, lossItemCount: 9 }),
  };
  const tools = createDocumentDoctorTools(adapter);
  expect(tools.map((tool) => tool.name)).toEqual(['diagnose-document', 'normalize-document-structure', 'rebuild-document-page-content']);
  expect(tools[0].annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true, consequentialHint: false });
  expect(tools[1].annotations).toEqual({ readOnlyHint: false, untrustedContentHint: true, consequentialHint: true });
  await expect(tools[0].execute({ mode: 'quick', extra: true })).rejects.toThrow('Unknown input property');
  await expect(tools[1].execute({ extra: true })).rejects.toThrow('Unknown input property');
  const diagnosis = await tools[0].execute({ mode: 'deep' });
  const transformed = await tools[1].execute({});
  expect(JSON.stringify({ diagnosis, transformed })).not.toMatch(/raw-secret|bytes|base64|blob:|\/private\.pdf/i);
  expect(diagnosis.readiness.graphTruncated).toBe(true);
  expect(diagnosis.inspectionErrors).toEqual({ count: 2, categories: ['document-metadata', 'page-annotations'], truncated: false });
  const controller = new AbortController(); controller.abort();
  await expect(tools[0].execute({ mode: 'quick' }, { signal: controller.signal })).rejects.toThrow();
});

test('WebMCPTesting discovers and invokes diagnosis and state-dependent verified output without download', async () => {
  const browser = await chromium.launch({ args: ['--enable-features=WebMCPTesting'] });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const response = await page.goto(`${BASE_URL}/document-doctor`);
    expect(response.headers()['permissions-policy']).toContain('tools=(self)');
    const client = await context.newCDPSession(page);
    const tools = new Map();
    client.on('WebMCP.toolsAdded', ({ tools: added }) => added.forEach((tool) => tools.set(tool.name, tool)));
    client.on('WebMCP.toolsRemoved', ({ tools: removed }) => removed.forEach((tool) => tools.delete(tool.name)));
    await client.send('WebMCP.enable');
    await expect.poll(() => [...tools.keys()]).toEqual([]);
    await page.setInputFiles('#fileInput', fixture('privacy-clean.pdf'));
    await expect.poll(() => [...tools.keys()]).toEqual(['diagnose-document']);
    expect(tools.get('diagnose-document').inputSchema.additionalProperties).toBe(false);
    const rejected = await invokeTool(client, tools.get('diagnose-document'), { mode: 'quick', unknown: true });
    expect(rejected.status).toBe('Error');
    const diagnosis = await invokeTool(client, tools.get('diagnose-document'), { mode: 'quick' });
    expect(diagnosis.status).toBe('Completed');
    expect(diagnosis.output.pageCount).toBe(1);
    expect(JSON.stringify(diagnosis.output)).not.toMatch(/"(?:bytes|base64|blobUrl|path|rawText)"|blob:/i);
    await expect.poll(() => [...tools.keys()].sort()).toEqual([
      'diagnose-document', 'normalize-document-structure', 'rebuild-document-page-content',
    ]);
    let downloads = 0; page.on('download', () => { downloads++; });
    const normalized = await invokeTool(client, tools.get('normalize-document-structure'), {});
    expect(normalized.status).toBe('Completed');
    expect(normalized.output).toMatchObject({ action: 'normalize-structure', ready: true, verified: true, pageCount: 1 });
    expect(JSON.stringify(normalized.output)).not.toMatch(/"(?:bytes|base64|blobUrl|path|rawText)"|blob:/i);
    expect(downloads).toBe(0);
    await expect(page.locator('#successSection')).toBeVisible();
    await context.close();
  } finally {
    await browser.close();
  }
});

test('clear and replacement invalidate delayed imports and active diagnosis without stale UI or tools', async ({ page }) => {
  await installModelContext(page);
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/document-doctor');
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    window.__releaseDoctorRead = release;
    window.__doctorOriginalArrayBuffer = original;
    File.prototype.arrayBuffer = async function delayed() { await gate; return original.call(this); };
  });
  await page.setInputFiles('#fileInput', fixture('privacy-rich.pdf'));
  await expect(page.locator('.doctor-workspace')).toHaveAttribute('aria-busy', 'true');
  await page.click('#clearBtn');
  await page.evaluate(() => window.__releaseDoctorRead());
  await expect(page.locator('#selectedFile')).toBeHidden();
  await expect.poll(() => page.evaluate(() => [...window.__doctorTools.keys()])).toEqual([]);
  await expect(page.locator('#errorSection')).toBeHidden();

  await page.evaluate(() => { File.prototype.arrayBuffer = window.__doctorOriginalArrayBuffer; });
  await page.setInputFiles('#fileInput', fixture('report.pdf'));
  await page.route('**/pdf.min.mjs', async (route) => { await new Promise((resolve) => setTimeout(resolve, 300)); await route.continue(); });
  await page.click('#diagnoseBtn');
  await page.click('#clearBtn');
  await page.waitForTimeout(450);
  await expect(page.locator('#doctorResults')).toBeHidden();
  await expect(page.locator('#successSection')).toBeHidden();
  await expect(page.locator('#errorSection')).toBeHidden();
  expect(errors).toEqual([]);
});

test('one owned operation blocks concurrent tools and Clear suppresses a delayed transform before recovery', async ({ page }) => {
  await installModelContext(page);
  const errors = [];
  let downloads = 0;
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('download', () => { downloads++; });
  await page.goto('/document-doctor');
  await page.setInputFiles('#fileInput', fixture('report.pdf'));
  await expect.poll(() => page.evaluate(() => [...window.__doctorTools.keys()])).toEqual(['diagnose-document']);
  await page.evaluate(() => window.__doctorTools.get('diagnose-document').execute(
    { mode: 'quick' }, { signal: new AbortController().signal },
  ));
  await expect.poll(() => page.evaluate(() => [...window.__doctorTools.keys()].sort())).toEqual([
    'diagnose-document', 'normalize-document-structure', 'rebuild-document-page-content',
  ]);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    let delayed = true;
    HTMLCanvasElement.prototype.toBlob = function delayedBlob(callback, ...args) {
      if (!delayed) return original.call(this, callback, ...args);
      delayed = false;
      const canvas = this;
      window.__releaseDoctorBlob = () => original.call(canvas, callback, ...args);
    };
    const tool = window.__doctorTools.get('rebuild-document-page-content');
    window.__doctorTransformOutcome = tool.execute({}, { signal: new AbortController().signal })
      .then((value) => ({ status: 'completed', value }), (error) => ({ status: 'rejected', name: error.name }));
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseDoctorBlob)).toBe('function');
  const concurrent = await page.evaluate(() => window.__doctorTools.get('diagnose-document')
    .execute({ mode: 'quick' }, { signal: new AbortController().signal })
    .then(() => 'completed', (error) => error.name));
  expect(concurrent).toBe('InvalidStateError');
  await expect(page.locator('.doctor-workspace')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#diagnoseBtn')).toBeDisabled();
  await page.click('#clearBtn');
  await page.evaluate(() => window.__releaseDoctorBlob());
  await expect.poll(() => page.evaluate(() => window.__doctorTransformOutcome)).toEqual({ status: 'rejected', name: 'AbortError' });
  await expect(page.locator('#successSection')).toBeHidden();
  await expect(page.locator('#progressSection')).toBeHidden();
  await expect.poll(() => page.evaluate(() => [...window.__doctorTools.keys()])).toEqual([]);
  expect(downloads).toBe(0);
  expect(errors).toEqual([]);

  await page.setInputFiles('#fileInput', fixture('privacy-clean.pdf'));
  await page.click('#diagnoseBtn');
  await expect(page.locator('#doctorResults')).toBeVisible();
  await expect(page.locator('#normalizeBtn')).toBeEnabled();
});

test('page is localized, responsive, no-overflow, and separate from the 29-tool catalog', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/tr/document-doctor');
  await expect(page.locator('h1')).toContainText('PDF yapısını');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/');
  await page.locator('#toolCatalog').evaluate((element) => { element.open = true; });
  await expect(page.locator('#toolGroups .tool-card')).toHaveCount(29);
  await expect(page.locator('a[href="document-doctor"]')).toHaveCount(1);
});
