import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { configureMergePdf, mergePdfFiles } from '../public/js/core/merge-pdf.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURES = path.join(ROOT, 'test-fixtures/generated');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';

async function rejectConsent(page) {
  const reject = page.locator('#consent-reject');
  if (await reject.isVisible()) await reject.click();
}

async function installTestModelContext(page) {
  await page.addInitScript(() => {
    const tools = new Map();
    Object.defineProperty(window, '__registeredWebMcpTools', { value: tools });
    Object.defineProperty(window, '__abortedWebMcpTools', { value: [] });
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        async registerTool(tool, options = {}) {
          tools.set(tool.name, tool);
          options.signal?.addEventListener('abort', () => {
            window.__abortedWebMcpTools.push(tool.name);
            tools.delete(tool.name);
          }, { once: true });
        },
      },
    });
  });
}

test('merge core is DOM-free, preserves order, reports progress, and aborts', async () => {
  const source = readFileSync(path.join(ROOT, 'public/js/core/merge-pdf.js'), 'utf8');
  expect(source).not.toMatch(/\b(?:document|window|navigator|globalThis)\b|createObjectURL|\.click\(/);
  configureMergePdf({ PDFDocument });
  const progress = [];
  const output = await mergePdfFiles([
    { name: 'appendix.pdf', bytes: new Uint8Array(readFileSync(path.join(FIXTURES, 'appendix.pdf'))) },
    { name: 'report.pdf', bytes: new Uint8Array(readFileSync(path.join(FIXTURES, 'report.pdf'))) },
  ], { onProgress: (event) => progress.push(event.phase) });
  expect((await PDFDocument.load(output)).getPageCount()).toBe(5);
  expect(progress).toEqual(['adding', 'adding', 'saving', 'done']);
  const controller = new AbortController();
  controller.abort();
  await expect(mergePdfFiles([
    { bytes: new Uint8Array(readFileSync(path.join(FIXTURES, 'report.pdf'))) },
    { bytes: new Uint8Array(readFileSync(path.join(FIXTURES, 'appendix.pdf'))) },
  ], { signal: controller.signal })).rejects.toHaveProperty('name', 'AbortError');
  const midRunController = new AbortController();
  await expect(mergePdfFiles([
    { bytes: new Uint8Array(readFileSync(path.join(FIXTURES, 'report.pdf'))) },
    { bytes: new Uint8Array(readFileSync(path.join(FIXTURES, 'appendix.pdf'))) },
  ], {
    signal: midRunController.signal,
    onProgress(event) { if (event.phase === 'adding') midRunController.abort(); },
  })).rejects.toHaveProperty('name', 'AbortError');
});

test('default browser has no WebMCP dependency or console regression', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await rejectConsent(page);
  await expect(page.locator('#popularGrid .tool-card')).toHaveCount(6);
  expect(await page.evaluate(() => Boolean(document.modelContext))).toBe(false);
  await page.goto('/merge');
  await expect(page.locator('#dropzone')).toBeVisible();
  expect(errors).toEqual([]);
});

test('fallback registrations are state-scoped, bounded, abortable, and byte-free', async ({ page }) => {
  await installTestModelContext(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()].sort())).toEqual([
    'find-document-tools', 'open-document-tool',
  ]);
  const homeContracts = await page.evaluate(() => [...window.__registeredWebMcpTools.values()].map((tool) => ({
    name: tool.name,
    schema: tool.inputSchema,
    annotationKeys: Object.keys(tool.annotations).sort(),
  })));
  for (const contract of homeContracts) {
    expect(contract.schema.additionalProperties, `${contract.name} strict schema`).toBe(false);
    expect(contract.annotationKeys).toEqual(['consequentialHint', 'readOnlyHint', 'untrustedContentHint']);
  }
  const homeResult = await page.evaluate(async () => {
    const tool = window.__registeredWebMcpTools.get('find-document-tools');
    return tool.execute({ query: 'merge', limit: 2 }, { signal: new AbortController().signal });
  });
  expect(homeResult.count).toBeGreaterThan(0);
  expect(homeResult.tools.length).toBeLessThanOrEqual(2);
  await expect(page.evaluate(async () => {
    const tool = window.__registeredWebMcpTools.get('find-document-tools');
    try { await tool.execute({ query: 'merge', extra: true }, { signal: new AbortController().signal }); }
    catch (error) { return error.message; }
  })).resolves.toMatch(/Unknown input property/);
  await expect(page.evaluate(async () => {
    const tool = window.__registeredWebMcpTools.get('find-document-tools');
    const controller = new AbortController();
    controller.abort();
    try { await tool.execute({ query: 'merge' }, { signal: controller.signal }); }
    catch (error) { return error.name; }
  })).resolves.toBe('AbortError');
  await expect(page.evaluate(async () => {
    const tool = window.__registeredWebMcpTools.get('find-document-tools');
    try { await tool.execute({ query: 'x'.repeat(81) }, { signal: new AbortController().signal }); }
    catch (error) { return error.message; }
  })).resolves.toMatch(/between 1 and 80/);

  await page.goto('/merge');
  await rejectConsent(page);
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()])).toEqual(['get-selected-files']);
  await page.setInputFiles('#fileInput', [path.join(FIXTURES, 'report.pdf'), path.join(FIXTURES, 'appendix.pdf')]);
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()].sort())).toEqual([
    'get-selected-files', 'merge-selected-files', 'remove-selected-file', 'set-file-order',
  ]);
  expect(await page.evaluate(() => window.__abortedWebMcpTools)).toContain('get-selected-files');
  const mergeContracts = await page.evaluate(() => [...window.__registeredWebMcpTools.values()].map((tool) => ({
    name: tool.name,
    strict: tool.inputSchema.additionalProperties,
    annotationKeys: Object.keys(tool.annotations).sort(),
  })));
  for (const contract of mergeContracts) {
    expect(contract.strict, `${contract.name} strict schema`).toBe(false);
    expect(contract.annotationKeys).toEqual(['consequentialHint', 'readOnlyHint', 'untrustedContentHint']);
  }
  const selected = await page.evaluate(() => window.__registeredWebMcpTools.get('get-selected-files').execute({}, { signal: new AbortController().signal }));
  expect(selected.count).toBe(2);
  expect(JSON.stringify(selected)).not.toMatch(/bytes|base64|blob:|(?:^|["'])path["']/i);

  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  const merged = await page.evaluate(() => window.__registeredWebMcpTools.get('merge-selected-files').execute({}, { signal: new AbortController().signal }));
  expect(merged).toEqual({ ready: true, fileName: 'merged.pdf', size: expect.any(Number), pageCount: 5 });
  expect(downloads).toBe(0);
  await expect(page.locator('#successSection')).toBeVisible();
  await expect(page.locator('#downloadAgainBtn')).toBeVisible();
  await expect(page.locator('#documentResultPreview canvas')).toBeVisible();
  expect(JSON.stringify(merged)).not.toMatch(/bytes|base64|blob:|path|text/i);
});

function waitForInvocation(client, invocationId) {
  return new Promise((resolve) => {
    const listener = (event) => {
      if (event.invocationId !== invocationId) return;
      client.off('WebMCP.toolResponded', listener);
      resolve(event);
    };
    client.on('WebMCP.toolResponded', listener);
  });
}

async function invokeTool(client, tool, input) {
  const { invocationId } = await client.send('WebMCP.invokeTool', {
    frameId: tool.frameId,
    toolName: tool.name,
    input,
  });
  return waitForInvocation(client, invocationId);
}

test('WebMCPTesting discovers and invokes exactly the current page tools', async () => {
  const browser = await chromium.launch({ args: ['--enable-features=WebMCPTesting'] });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const homeResponse = await page.goto(`${BASE_URL}/`);
    expect(homeResponse.headers()['permissions-policy']).toContain('tools=(self)');
    await rejectConsent(page);
    const client = await context.newCDPSession(page);
    const tools = new Map();
    client.on('WebMCP.toolsAdded', ({ tools: added }) => added.forEach((tool) => tools.set(tool.name, tool)));
    client.on('WebMCP.toolsRemoved', ({ tools: removed }) => removed.forEach((tool) => tools.delete(tool.name)));
    await client.send('WebMCP.enable');
    await expect.poll(() => [...tools.keys()].sort()).toEqual(['find-document-tools', 'open-document-tool']);
    const find = tools.get('find-document-tools');
    const found = await invokeTool(client, find, { query: 'merge' });
    expect(found.status).toBe('Completed');
    expect(found.output.tools[0].name).toBe('merge');
    const rejected = await invokeTool(client, find, { query: 'merge', unknown: 'x' });
    expect(rejected.status).toBe('Error');

    await page.goto(`${BASE_URL}/merge`);
    await expect(page.locator('#dropzone')).toBeVisible();
    tools.clear();
    await client.send('WebMCP.disable');
    await client.send('WebMCP.enable');
    await expect.poll(() => [...tools.keys()]).toEqual(['get-selected-files']);
    await page.setInputFiles('#fileInput', path.join(FIXTURES, 'report.pdf'));
    await expect.poll(() => [...tools.keys()].sort()).toEqual([
      'get-selected-files', 'remove-selected-file', 'set-file-order',
    ]);
    await page.setInputFiles('#fileInput', path.join(FIXTURES, 'appendix.pdf'));
    await expect.poll(() => [...tools.keys()].sort()).toEqual([
      'get-selected-files', 'merge-selected-files', 'remove-selected-file', 'set-file-order',
    ]);
    const listed = await invokeTool(client, tools.get('get-selected-files'), {});
    expect(listed.status).toBe('Completed');
    expect(listed.output.count).toBe(2);
    expect(JSON.stringify(listed.output)).not.toMatch(/bytes|base64|blob:|path|text/i);
    expect(tools.get('set-file-order').inputSchema.additionalProperties).toBe(false);
    expect(tools.get('set-file-order').inputSchema.properties.order.maxItems).toBe(50);
    const ids = listed.output.files.map((file) => file.id);
    const reordered = await invokeTool(client, tools.get('set-file-order'), { order: [...ids].reverse() });
    expect(reordered.status).toBe('Completed');
    await expect(page.locator('.file-item-name').first()).toHaveText('appendix.pdf');

    let downloads = 0;
    page.on('download', () => { downloads += 1; });
    const merged = await invokeTool(client, tools.get('merge-selected-files'), {});
    expect(merged.status).toBe('Completed');
    expect(merged.output).toEqual({ ready: true, fileName: 'merged.pdf', size: expect.any(Number), pageCount: 5 });
    expect(downloads).toBe(0);
    await expect(page.locator('#successSection')).toBeVisible();

    const removed = await invokeTool(client, tools.get('remove-selected-file'), { id: ids[0] });
    expect(removed.status).toBe('Completed');
    await expect.poll(() => [...tools.keys()].sort()).toEqual([
      'get-selected-files', 'remove-selected-file', 'set-file-order',
    ]);
    await context.close();
  } finally {
    await browser.close();
  }
});

test('selection mutation aborts a delayed merge without publishing stale state', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await installTestModelContext(page);
  await page.goto('/merge');
  await rejectConsent(page);
  await page.setInputFiles('#fileInput', [path.join(FIXTURES, 'report.pdf'), path.join(FIXTURES, 'appendix.pdf')]);
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()].sort())).toEqual([
    'get-selected-files', 'merge-selected-files', 'remove-selected-file', 'set-file-order',
  ]);

  await page.evaluate(() => {
    const originalLoad = window.PDFLib.PDFDocument.load;
    let delayNextLoad = true;
    window.PDFLib.PDFDocument.load = async function delayedLoad(...args) {
      if (delayNextLoad) {
        delayNextLoad = false;
        await new Promise((resolve) => { window.__releaseDelayedMerge = resolve; });
      }
      return originalLoad.apply(this, args);
    };
    const controller = new AbortController();
    window.__delayedMergeOutcome = window.__registeredWebMcpTools.get('merge-selected-files')
      .execute({}, { signal: controller.signal })
      .then((value) => ({ status: 'completed', value }), (error) => ({ status: 'rejected', name: error.name }));
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseDelayedMerge)).toBe('function');

  const selected = await page.evaluate(() => window.__registeredWebMcpTools.get('get-selected-files').execute({}, { signal: new AbortController().signal }));
  const removeId = selected.files.find((file) => file.name === 'report.pdf').id;
  await page.evaluate((id) => window.__registeredWebMcpTools.get('remove-selected-file').execute({ id }, { signal: new AbortController().signal }), removeId);
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()].sort())).toEqual([
    'get-selected-files', 'remove-selected-file', 'set-file-order',
  ]);
  await page.evaluate(() => window.__releaseDelayedMerge());
  await expect.poll(() => page.evaluate(() => window.__delayedMergeOutcome)).toEqual({ status: 'rejected', name: 'AbortError' });
  await expect(page.locator('#successSection')).toBeHidden();
  await expect(page.locator('#progressSection')).toBeHidden();
  await expect(page.locator('#fileOrderStatus')).toHaveText('Merge canceled because the selected files changed.');
  expect(downloads).toBe(0);
  expect(consoleErrors).toEqual([]);

  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'report.pdf'));
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()].sort())).toEqual([
    'get-selected-files', 'merge-selected-files', 'remove-selected-file', 'set-file-order',
  ]);

  await page.evaluate(() => {
    const currentLoad = window.PDFLib.PDFDocument.load;
    let delayNextLoad = true;
    window.PDFLib.PDFDocument.load = async function externallyCanceledLoad(...args) {
      if (delayNextLoad) {
        delayNextLoad = false;
        await new Promise((resolve) => { window.__releaseExternallyCanceledMerge = resolve; });
      }
      return currentLoad.apply(this, args);
    };
    window.__externalMergeController = new AbortController();
    window.__externalMergeOutcome = window.__registeredWebMcpTools.get('merge-selected-files')
      .execute({}, { signal: window.__externalMergeController.signal })
      .then((value) => ({ status: 'completed', value }), (error) => ({ status: 'rejected', name: error.name }));
  });
  await expect.poll(() => page.evaluate(() => typeof window.__releaseExternallyCanceledMerge)).toBe('function');
  await page.evaluate(() => {
    window.__externalMergeController.abort();
    window.__releaseExternallyCanceledMerge();
  });
  await expect.poll(() => page.evaluate(() => window.__externalMergeOutcome)).toEqual({ status: 'rejected', name: 'AbortError' });
  await expect(page.locator('#successSection')).toBeHidden();
  await expect(page.locator('#progressSection')).toBeHidden();

  const validResult = await page.evaluate(() => window.__registeredWebMcpTools.get('merge-selected-files').execute({}, { signal: new AbortController().signal }));
  expect(validResult).toEqual({ ready: true, fileName: 'merged.pdf', size: expect.any(Number), pageCount: 5 });
  await expect(page.locator('#successSection')).toBeVisible();
  expect(downloads).toBe(0);
  expect(consoleErrors).toEqual([]);
});

test('pending file import disables merge and invalidates an older two-file result', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await installTestModelContext(page);
  await page.goto('/merge');
  await rejectConsent(page);
  await page.setInputFiles('#fileInput', [path.join(FIXTURES, 'report.pdf'), path.join(FIXTURES, 'appendix.pdf')]);
  await expect(page.locator('#mergeBtn')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()].sort())).toEqual([
    'get-selected-files', 'merge-selected-files', 'remove-selected-file', 'set-file-order',
  ]);

  await page.evaluate(() => {
    window.__staleMergeTool = window.__registeredWebMcpTools.get('merge-selected-files');
    const originalLoad = window.PDFLib.PDFDocument.load;
    let delayNextLoad = true;
    window.PDFLib.PDFDocument.load = async function delayedMergeLoad(...args) {
      if (delayNextLoad) {
        delayNextLoad = false;
        await new Promise((resolve) => { window.__releasePendingImportMerge = resolve; });
      }
      return originalLoad.apply(this, args);
    };
    const originalArrayBuffer = window.File.prototype.arrayBuffer;
    let delayNextArrayBuffer = true;
    window.File.prototype.arrayBuffer = function delayedArrayBuffer() {
      if (!delayNextArrayBuffer) return originalArrayBuffer.call(this);
      delayNextArrayBuffer = false;
      const file = this;
      return new Promise((resolve, reject) => {
        window.__releasePendingFileRead = () => originalArrayBuffer.call(file).then(resolve, reject);
      });
    };
  });

  await page.locator('#mergeBtn').click();
  await expect.poll(() => page.evaluate(() => typeof window.__releasePendingImportMerge)).toBe('function');
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'appendix.pdf'));
  await expect.poll(() => page.evaluate(() => typeof window.__releasePendingFileRead)).toBe('function');
  await expect(page.locator('#mergeBtn')).toBeDisabled();
  await expect(page.locator('.merge-workspace')).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()].sort())).toEqual([
    'get-selected-files', 'remove-selected-file', 'set-file-order',
  ]);
  const staleInvocation = await page.evaluate(async () => {
    try { await window.__staleMergeTool.execute({}, { signal: new AbortController().signal }); }
    catch (error) { return { name: error.name, message: error.message }; }
    return { name: 'UnexpectedSuccess', message: '' };
  });
  expect(staleInvocation.name).toBe('Error');
  expect(staleInvocation.message).toMatch(/finish loading/);

  await page.evaluate(() => window.__releasePendingImportMerge());
  await expect(page.locator('#successSection')).toBeHidden();
  expect(downloads).toBe(0);
  await page.evaluate(() => window.__releasePendingFileRead());
  await expect(page.locator('.file-item')).toHaveCount(3);
  await expect(page.locator('#mergeBtn')).toBeEnabled();
  await expect(page.locator('.merge-workspace')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()].sort())).toEqual([
    'get-selected-files', 'merge-selected-files', 'remove-selected-file', 'set-file-order',
  ]);

  const validResult = await page.evaluate(() => window.__registeredWebMcpTools.get('merge-selected-files').execute({}, { signal: new AbortController().signal }));
  expect(validResult).toEqual({ ready: true, fileName: 'merged.pdf', size: expect.any(Number), pageCount: 7 });
  await expect(page.locator('#documentResultPreview canvas')).toBeVisible();
  expect(downloads).toBe(0);
  const download = page.waitForEvent('download');
  await page.locator('#downloadAgainBtn').click();
  const artifact = await download;
  expect((await PDFDocument.load(readFileSync(await artifact.path()))).getPageCount()).toBe(7);
  expect(downloads).toBe(1);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Clear invalidates a delayed file import without restoring stale state', async ({ page }, testInfo) => {
  const consoleErrors = [], pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let downloads = 0; page.on('download', () => { downloads++; });
  await installTestModelContext(page); await page.goto('/merge'); await rejectConsent(page);
  await page.setInputFiles('#fileInput', [path.join(FIXTURES, 'report.pdf'), path.join(FIXTURES, 'appendix.pdf')]);
  await expect(page.locator('.file-item')).toHaveCount(2);
  const oldIds = await page.evaluate(async () => (await window.__registeredWebMcpTools.get('get-selected-files').execute({}, { signal: new AbortController().signal })).files.map((file) => file.id));
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer, intents = new WeakMap();
    window.__clearReadCalls = []; window.__clearIntakeIntent = 'old-held';
    document.addEventListener('change', (event) => {
      if (event.target.id === 'fileInput') for (const file of event.target.files) intents.set(file, window.__clearIntakeIntent);
    }, true);
    File.prototype.arrayBuffer = function () {
      const intent = intents.get(this), file = this; window.__clearReadCalls.push({ intent, name: file.name });
      if (intent !== 'old-held') return original.call(file);
      return new Promise((resolve, reject) => {
        window.__releaseClearHeldRead = () => original.call(file).then((value) => { window.__clearHeldReadReleased = true; resolve(value); }, reject);
      });
    };
  });
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'appendix.pdf'));
  await expect.poll(() => page.evaluate(() => typeof window.__releaseClearHeldRead)).toBe('function');
  await page.evaluate(() => { window.__clearIntakeIntent = 'old-queued-report'; });
  await page.setInputFiles('#fileInput', path.join(FIXTURES, 'report.pdf'));
  await page.evaluate(() => { window.__clearIntakeIntent = 'old-queued-invalid'; });
  await page.setInputFiles('#fileInput', { name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  expect(await page.evaluate(() => window.__clearReadCalls)).toEqual([{ intent: 'old-held', name: 'appendix.pdf' }]);
  await expect(page.locator('.merge-workspace')).toHaveAttribute('aria-busy', 'true'); await page.click('#clearBtn');
  await expect(page.locator('.file-item')).toHaveCount(0); await expect(page.locator('.merge-workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#progressSection')).toBeHidden(); await expect(page.locator('#successSection')).toBeHidden(); await expect(page.locator('#errorSection')).toBeHidden();
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()])).toEqual(['get-selected-files']);
  // A new user intent runs while the abandoned native read is still held. The
  // queued old report/invalid inputs must never get their own arrayBuffer call.
  await page.evaluate(() => { window.__clearIntakeIntent = 'fresh'; });
  await page.setInputFiles('#fileInput', [path.join(FIXTURES, 'report.pdf'), path.join(FIXTURES, 'appendix.pdf')]);
  await expect(page.locator('#mergeBtn')).toBeEnabled(); expect(await page.evaluate(() => !!window.__clearHeldReadReleased)).toBe(false);
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()].sort())).toEqual(['get-selected-files', 'merge-selected-files', 'remove-selected-file', 'set-file-order']);
  const merged = await page.evaluate(() => window.__registeredWebMcpTools.get('merge-selected-files').execute({}, { signal: new AbortController().signal }));
  expect(merged).toEqual({ ready: true, fileName: 'merged.pdf', size: expect.any(Number), pageCount: 5 });
  await expect(page.locator('#documentResultStatus')).toContainText('The actual file is shown below.'); expect(downloads).toBe(0);
  await page.click('#useResultBtn');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]);
  await download.saveAs(testInfo.outputPath('cleared-import-fresh.pdf'));
  const bytes = readFileSync(testInfo.outputPath('cleared-import-fresh.pdf')); expect((await PDFDocument.load(bytes)).getPageCount()).toBe(5);
  const text = await page.evaluate(async (values) => {
    const runtime = await import('/js/lib-loader.js'), task = (await runtime.ensurePdfJs()).getDocument({ data: new Uint8Array(values), ...runtime.PDFJS_ASSET_URLS });
    try { const doc = await task.promise, out = []; for (let n = 1; n <= doc.numPages; n++) out.push((await (await doc.getPage(n)).getTextContent()).items.map((item) => item.str).join(' ')); return out; }
    finally { await task.destroy(); }
  }, Array.from(bytes));
  expect(text.map((value) => value.match(/Quarterly Report 2026|Regional Breakdown|Notes|Appendix A|Appendix B/)?.[0])).toEqual(['Quarterly Report 2026', 'Regional Breakdown', 'Notes', 'Appendix A', 'Appendix B']);
  const snapshot = () => page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), selected = await window.__registeredWebMcpTools.get('get-selected-files').execute({}, { signal: new AbortController().signal });
    return { files: selected.files, session: ui.documentSession.snapshot(), bytes: Array.from(ui.documentSession.current().bytes), result: document.getElementById('documentResultIdentity').textContent, resultStatus: document.getElementById('documentResultStatus').textContent,
      progress: document.getElementById('progressTrack').getAttribute('aria-valuenow'), progressHidden: document.getElementById('progressSection').hidden, successHidden: document.getElementById('successSection').hidden, errorHidden: document.getElementById('errorSection').hidden, error: document.getElementById('errorText').textContent,
      tools: [...window.__registeredWebMcpTools.keys()].sort(), busy: document.querySelector('.merge-workspace').getAttribute('aria-busy') };
  });
  const beforeLateRead = await snapshot(); expect(beforeLateRead.files.map((file) => file.id).some((id) => oldIds.includes(id))).toBe(false);
  expect(beforeLateRead).toMatchObject({ progress: '100', progressHidden: true, successHidden: false, errorHidden: true, error: '', busy: 'false' });
  expect(downloads).toBe(1);
  await page.evaluate(() => window.__releaseClearHeldRead());
  await expect.poll(() => page.evaluate(() => [...window.__registeredWebMcpTools.keys()].sort())).toEqual(beforeLateRead.tools);
  expect(await snapshot()).toEqual(beforeLateRead);
  expect(await page.evaluate(() => window.__clearReadCalls)).toEqual([{ intent: 'old-held', name: 'appendix.pdf' }, { intent: 'fresh', name: 'report.pdf' }, { intent: 'fresh', name: 'appendix.pdf' }]);
  expect(downloads).toBe(1); expect(consoleErrors).toEqual([]); expect(pageErrors).toEqual([]);
});

test('WebMCP implementation excludes draft anti-pattern APIs and binary transport', () => {
  const source = readFileSync(path.join(ROOT, 'public/js/webmcp.js'), 'utf8');
  expect(source).not.toMatch(/navigator\.modelContext|unregisterTool|updateTool|outputSchema|base64|Blob|ArrayBuffer|Uint8Array/);
  expect(source).not.toMatch(/querySelector\([^)]*fileInput|\.click\(/);
  expect(source).toContain('document.modelContext');
  expect(source).toContain('registerTool(tool, { signal: controller.signal })');
});
