import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { WORKFLOW_MANIFEST, materializeRecipe } from '../public/js/core/workflow-manifest.js';
import { LocalBatchQueue, allocateOutputName } from '../public/js/core/batch-queue.js';
import { zipStore } from '../public/js/zip-writer.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FIXTURES = path.join(ROOT, 'test-fixtures/generated');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';

function centralZipNames(bytes) {
  const names = [];
  for (let index = 0; index <= bytes.length - 46; index++) {
    if (bytes[index] !== 0x50 || bytes[index + 1] !== 0x4b || bytes[index + 2] !== 0x01 || bytes[index + 3] !== 0x02) continue;
    const length = bytes[index + 28] | (bytes[index + 29] << 8);
    names.push(new TextDecoder().decode(bytes.subarray(index + 46, index + 46 + length)));
  }
  return names;
}

async function rejectConsent(page) {
  const reject = page.locator('#consent-reject');
  if (await reject.isVisible()) await reject.click();
}

async function installModelContext(page) {
  await page.addInitScript(() => {
    const tools = new Map();
    Object.defineProperty(window, '__workflowTools', { value: tools });
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      async registerTool(tool, { signal } = {}) {
        tools.set(tool.name, tool);
        signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true });
      },
    } });
  });
}

test('manifest is versioned, strict, stable, and explicit about loss and privacy', () => {
  expect(WORKFLOW_MANIFEST.schemaVersion).toBe(1);
  expect(WORKFLOW_MANIFEST.steps.map((step) => step.id)).toEqual([
    'compress-raster-v1', 'watermark-text-v1', 'protect-password-v1',
    'organize-pages-v1', 'page-numbers-v1', 'privacy-metadata-scan-v1', 'metadata-cleanup-v1',
  ]);
  expect(WORKFLOW_MANIFEST.recipes).toHaveLength(3);
  for (const step of WORKFLOW_MANIFEST.steps) {
    expect(step.accepts).toEqual(['application/pdf']);
    expect(step.produces).toEqual(['application/pdf']);
    expect(step.parameterSchema.additionalProperties).toBe(false);
    expect(step.loss.length).toBeGreaterThan(20);
    expect(step.privacy.length).toBeGreaterThan(20);
  }
  expect(materializeRecipe('compress-watermark-protect-v1').map((step) => step.id)).toHaveLength(3);
});

test('batch queue is concurrency one, keeps partial success, cancels, retries, and allocates unique names', async () => {
  let active = 0;
  let maximum = 0;
  let failOnce = true;
  const queue = new LocalBatchQueue({ process: async (item, context) => {
    active++; maximum = Math.max(maximum, active);
    context.onStep(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    if (item.name === 'bad.pdf' && failOnce) { failOnce = false; throw new Error('deliberate'); }
    return { bytes: new Uint8Array([1]), name: 'ignored.pdf' };
  } });
  queue.add([
    { id: '1', name: 'same.pdf', bytes: new Uint8Array([1]), recipeId: 'privacy-scan-cleanup-v1' },
    { id: '2', name: 'same.pdf', bytes: new Uint8Array([2]), recipeId: 'privacy-scan-cleanup-v1' },
    { id: '3', name: 'bad.pdf', bytes: new Uint8Array([3]), recipeId: 'privacy-scan-cleanup-v1' },
  ]);
  await queue.run();
  expect(maximum).toBe(1);
  expect(queue.items.map((item) => item.status)).toEqual(['success', 'success', 'error']);
  expect(new Set(queue.items.map((item) => item.outputName)).size).toBe(3);
  expect(queue.retry('3')).toBe(true);
  await queue.run();
  expect(queue.items[2].status).toBe('success');
  queue.add([{ id: '4', name: 'later.pdf', bytes: new Uint8Array([4]), recipeId: 'privacy-scan-cleanup-v1' }]);
  queue.cancel();
  expect(queue.items[3].status).toBe('canceled');
  expect(queue.items.slice(0, 3).map((item) => item.status)).toEqual(['success', 'success', 'success']);
  expect(queue.retry('4')).toBe(true);
  await queue.run();
  expect(queue.items.map((item) => item.status)).toEqual(['success', 'success', 'success', 'success']);
  const archiveNames = centralZipNames(zipStore(queue.items.map((item) => ({ name: item.outputName, data: item.output }))));
  expect(archiveNames).toHaveLength(4);
  expect(new Set(archiveNames).size).toBe(4);
  const names = new Set();
  expect(allocateOutputName('a.pdf', 'x-v1', names)).toBe('a-x.pdf');
  expect(allocateOutputName('A.pdf', 'x-v1', names)).toBe('A-x-2.pdf');
});

test('retry during a canceled active run stays queued until a later explicit run', async () => {
  let releaseDelayed;
  let delayOnce = true;
  const processed = [];
  const queue = new LocalBatchQueue({ process: async (item, context) => {
    processed.push(item.id);
    if (item.id === 'active' && delayOnce) {
      delayOnce = false;
      await new Promise((resolve) => { releaseDelayed = resolve; });
    }
    if (context.isCancelled()) throw new DOMException('Canceled', 'AbortError');
    return { bytes: new Uint8Array([1]), name: `${item.id}.pdf` };
  } });
  queue.add([{ id: 'kept', name: 'kept.pdf', bytes: new Uint8Array([1]), recipeId: 'privacy-scan-cleanup-v1' }]);
  await queue.run();
  queue.add([
    { id: 'active', name: 'active.pdf', bytes: new Uint8Array([1]), recipeId: 'privacy-scan-cleanup-v1' },
    { id: 'waiting', name: 'waiting.pdf', bytes: new Uint8Array([1]), recipeId: 'privacy-scan-cleanup-v1' },
  ]);
  const activeRun = queue.run();
  await expect.poll(() => queue.items.find((item) => item.id === 'active').status).toBe('running');
  queue.cancel();
  expect(queue.retry('waiting')).toBe(true);
  expect(queue.items.find((item) => item.id === 'waiting').status).toBe('queued');
  await queue.run(); // active run owns the slot: this must be a no-op
  releaseDelayed();
  await activeRun;
  expect(queue.items.map((item) => item.status)).toEqual(['success', 'canceled', 'queued']);
  expect(processed).toEqual(['kept', 'active']);
  await queue.run();
  expect(queue.items.map((item) => item.status)).toEqual(['success', 'canceled', 'success']);
  expect(processed).toEqual(['kept', 'active', 'waiting']);
});

test('workflow page is responsive, keyboard operable, bounded, and has complete locale keys', async ({ page }) => {
  await page.goto('/workflows');
  await rejectConsent(page);
  await expect(page.locator('h1')).toHaveText('PDF workflows');
  await expect(page.locator('.recipe-choice')).toHaveCount(3);
  await expect(page.locator('#runWorkflowBtn')).toBeDisabled();
  await page.locator('#workflowDropzone').focus();
  expect(await page.locator('#workflowDropzone').getAttribute('role')).toBe('button');
  expect(await page.locator('#queueLive').getAttribute('aria-live')).toBe('polite');
  await page.setViewportSize({ width: 390, height: 844 });
  const columns = await page.locator('.workflow-builder').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(1);
  const dictionaries = JSON.parse(readFileSync(path.join(PUBLIC, 'translations.json'), 'utf8'));
  const keys = ['hub.tool_workflows', 'hub.tool_workflows_desc', 'workflows.h1', 'workflows.intro', 'workflows.run', 'workflows.cancel', 'workflows.clear', 'workflows.device_limit', 'workflows.scope_body'];
  expect(Object.keys(dictionaries)).toHaveLength(21);
  for (const [locale, dictionary] of Object.entries(dictionaries)) for (const key of keys) expect(dictionary[key], `${locale}:${key}`).toBeTruthy();
  for (const dictionary of Object.values(dictionaries)) {
    expect(dictionary['workflows.device_limit']).not.toBe('PDFs are held in local browser storage and processed with concurrency 1. Large or image-heavy batches may exhaust your device\'s memory or storage.');
    expect(dictionary['workflows.scope_body']).not.toBe('The privacy recipe scans and clears only standard PDF document-info fields. It does not claim to remove hidden content, attachments, scripts, annotations, or identifying pixels.');
  }
});

test('workflow hydration retains non-secret parameters before persistence and Clear cannot resurrect records', async ({ page }) => {
  await page.goto('/workflows'); await rejectConsent(page);
  await page.fill('#workflowQuality', '0.51');
  await page.fill('#workflowWatermark', 'PRIVATE COPY');
  await page.fill('#workflowPassword', 'never-persist-this');
  await page.setInputFiles('#workflowFileInput', path.join(FIXTURES, 'appendix.pdf'));
  await expect(page.locator('#queueBody tr')).toHaveCount(1);
  await expect.poll(() => new URL(page.url()).searchParams.get('workflow')).toBeTruthy();
  const oldId = new URL(page.url()).searchParams.get('workflow');
  await expect.poll(() => page.evaluate(async (id) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('browserpdf-workflows'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(['workflows', 'files'], 'readonly');
    const workflow = await new Promise((resolve) => { const request = tx.objectStore('workflows').get(id); request.onsuccess = () => resolve(request.result); });
    const files = await new Promise((resolve) => { const request = tx.objectStore('files').getAll(); request.onsuccess = () => resolve(request.result); });
    db.close(); return { serialized: JSON.stringify({ workflow, files }), steps: workflow?.orderedSteps };
  }, oldId)).toEqual(expect.objectContaining({
    serialized: expect.not.stringMatching(/never-persist-this|"password"/i),
    steps: expect.arrayContaining([
      expect.objectContaining({ id: 'compress-raster-v1', parameters: expect.objectContaining({ quality: .51 }) }),
      expect.objectContaining({ id: 'watermark-text-v1', parameters: expect.objectContaining({ text: 'PRIVATE COPY' }) }),
    ]),
  }));
  await page.evaluate(async (id) => {
    const db = await new Promise((resolve) => { const request = indexedDB.open('browserpdf-workflows'); request.onsuccess = () => resolve(request.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('workflows', 'readwrite');
      const store = tx.objectStore('workflows');
      const request = store.get(id);
      request.onsuccess = () => { const workflow = request.result; workflow.currentStep = 2; store.put(workflow); };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, oldId);
  await page.reload();
  await expect(page.locator('#queueBody')).toContainText('appendix.pdf');
  await expect(page.locator('#workflowQuality')).toHaveValue('0.51');
  await expect(page.locator('#workflowWatermark')).toHaveValue('PRIVATE COPY');
  await expect(page.locator('#workflowPassword')).toHaveValue('');
  await expect.poll(() => page.evaluate(async (id) => {
    const db = await new Promise((resolve) => { const request = indexedDB.open('browserpdf-workflows'); request.onsuccess = () => resolve(request.result); });
    const request = db.transaction('workflows').objectStore('workflows').get(id);
    const workflow = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); });
    db.close(); return workflow?.currentStep;
  }, oldId)).toBe(2);
  await page.click('#clearWorkflowBtn');
  await expect.poll(() => page.evaluate(async (id) => {
    const db = await new Promise((resolve) => { const request = indexedDB.open('browserpdf-workflows'); request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['workflows', 'files'], 'readonly');
    const workflow = await new Promise((resolve) => { const request = tx.objectStore('workflows').get(id); request.onsuccess = () => resolve(request.result); });
    const files = await new Promise((resolve) => { const request = tx.objectStore('files').index('workflowId').getAll(id); request.onsuccess = () => resolve(request.result); });
    db.close(); return { workflow: Boolean(workflow), files: files.length };
  }, oldId)).toEqual({ workflow: false, files: 0 });
  expect(new URL(page.url()).searchParams.has('workflow')).toBe(false);

  await page.locator('input[name="recipe"][value="organize-page-numbers-v1"]').check();
  await page.selectOption('#workflowOrder', 'keep');
  await page.fill('#workflowStart', '9');
  await page.setInputFiles('#workflowFileInput', path.join(FIXTURES, 'report.pdf'));
  await expect.poll(() => new URL(page.url()).searchParams.get('workflow')).toBeTruthy();
  const organizedId = new URL(page.url()).searchParams.get('workflow');
  expect(organizedId).not.toBeNull();
  await expect.poll(() => page.evaluate(async (id) => {
    const db = await new Promise((resolve) => { const request = indexedDB.open('browserpdf-workflows'); request.onsuccess = () => resolve(request.result); });
    const request = db.transaction('workflows').objectStore('workflows').get(id);
    const workflow = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); });
    db.close(); return workflow?.orderedSteps;
  }, organizedId)).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'organize-pages-v1', parameters: { order: 'keep' } }),
    expect.objectContaining({ id: 'page-numbers-v1', parameters: expect.objectContaining({ start: 9 }) }),
  ]));
  await page.reload();
  await expect(page.locator('#workflowOrder')).toHaveValue('keep');
  await expect(page.locator('#workflowStart')).toHaveValue('9');
});

test('simultaneous imports reserve file and byte limits atomically and Clear releases delayed reads', async ({ page }) => {
  const raw = Array.from(readFileSync(path.join(FIXTURES, 'appendix.pdf')));
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    window.__pendingWorkflowReads = [];
    File.prototype.arrayBuffer = function delayedArrayBuffer() {
      const file = this;
      return new Promise((resolve, reject) => window.__pendingWorkflowReads.push({
        name: file.name,
        resolve: () => original.call(file).then(resolve, reject),
        reject,
      }));
    };
    window.__dispatchWorkflowFiles = (bytes, prefix, count, reportedSize) => {
      const transfer = new DataTransfer();
      for (let index = 0; index < count; index++) {
        const file = new File([new Uint8Array(bytes)], `${prefix}-${index}.pdf`, { type: 'application/pdf' });
        if (reportedSize !== undefined) Object.defineProperty(file, 'size', { configurable: true, value: reportedSize });
        transfer.items.add(file);
      }
      const input = document.getElementById('workflowFileInput');
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
  });
  await page.goto('/workflows'); await rejectConsent(page);

  await page.evaluate(([bytes]) => {
    window.__dispatchWorkflowFiles(bytes, 'first', 12);
    window.__dispatchWorkflowFiles(bytes, 'second', 12);
  }, [raw]);
  await expect(page.locator('#workflowError')).toContainText('at most 20 files');
  for (let index = 0; index < 20; index++) {
    await expect.poll(() => page.evaluate(() => window.__pendingWorkflowReads.length)).toBeGreaterThan(0);
    await page.evaluate(() => window.__pendingWorkflowReads.shift().resolve());
  }
  await expect(page.locator('#queueBody tr')).toHaveCount(20);
  await expect(page.locator('#workflowDropzone')).toHaveAttribute('aria-busy', 'false');
  await page.click('#clearWorkflowBtn');
  await expect.poll(() => new URL(page.url()).searchParams.has('workflow')).toBe(false);
  await expect(page.locator('#queueBody')).toContainText('No PDFs added yet');

  await page.evaluate(([bytes]) => {
    const size = 140 * 1024 * 1024;
    window.__dispatchWorkflowFiles(bytes, 'large-a', 1, size);
    window.__dispatchWorkflowFiles(bytes, 'large-b', 1, size);
  }, [raw]);
  await expect(page.locator('#workflowError')).toContainText('250 MB');
  await expect.poll(() => page.evaluate(() => window.__pendingWorkflowReads.length)).toBe(1);
  await page.evaluate(() => window.__pendingWorkflowReads.shift().resolve());
  await expect(page.locator('#queueBody')).toContainText('large-a-0.pdf');
  await page.click('#clearWorkflowBtn');
  await expect.poll(() => new URL(page.url()).searchParams.has('workflow')).toBe(false);

  await page.evaluate(([bytes]) => window.__dispatchWorkflowFiles(bytes, 'stale', 1), [raw]);
  await expect.poll(() => page.evaluate(() => window.__pendingWorkflowReads.length)).toBe(1);
  await expect(page.locator('#clearWorkflowBtn')).toBeEnabled();
  await page.click('#clearWorkflowBtn');
  await page.evaluate(() => window.__pendingWorkflowReads.shift().reject(new Error('late read failure')));
  await expect(page.locator('#workflowError')).toBeHidden();
  await expect(page.locator('#queueBody')).not.toContainText('stale-0.pdf');
  await page.evaluate(([bytes]) => window.__dispatchWorkflowFiles(bytes, 'fresh', 1), [raw]);
  await expect.poll(() => page.evaluate(() => window.__pendingWorkflowReads.length)).toBe(1);
  await page.evaluate(() => window.__pendingWorkflowReads.shift().resolve());
  await expect(page.locator('#queueBody')).toContainText('fresh-0.pdf');
});

test('expiry cleanup is scoped and preserves unrelated IndexedDB data', async ({ page }) => {
  await page.goto('/workflows'); await rejectConsent(page);
  const result = await page.evaluate(async () => {
    const { createWorkflowStore } = await import('/js/core/workflow-store.js');
    let clock = 10_000;
    const oldStore = createWorkflowStore({ now: () => clock });
    await oldStore.putWorkflowBundle(
      { id: 'expired', expiresAt: 9_999, orderedSteps: [], currentStep: 0, fileRefs: ['expired:file'] },
      [{ id: 'expired:file', name: 'old.pdf', bytes: new Uint8Array([1]) }],
    );
    await oldStore.putWorkflowBundle(
      { id: 'fresh', expiresAt: 20_000, orderedSteps: [], currentStep: 0, fileRefs: ['fresh:file'] },
      [{ id: 'fresh:file', name: 'fresh.pdf', bytes: new Uint8Array([2]) }],
    );
    await oldStore.putFile('missing-owner', { id: 'orphan:file', name: 'orphan.pdf', bytes: new Uint8Array([3]), expiresAt: 9_999 });
    await oldStore.putFile('fresh', { id: 'unreferenced:file', name: 'interrupted.pdf', bytes: new Uint8Array([4]), expiresAt: 9_999 });
    let rolledBack = false;
    try {
      await oldStore.putWorkflowBundle(
        { id: 'rollback', orderedSteps: [], currentStep: 0, fileRefs: ['rollback:file'], uncloneable: () => {} },
        [{ id: 'rollback:file', name: 'rollback.pdf', bytes: new Uint8Array([5]) }],
      );
    } catch { rolledBack = true; }
    const unrelated = await new Promise((resolve, reject) => {
      const request = indexedDB.open('unrelated-app-data', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => { const tx = unrelated.transaction('records', 'readwrite'); tx.objectStore('records').put('keep', 'key'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    unrelated.close();
    const removed = await oldStore.cleanupExpired();
    const expired = await oldStore.getWorkflow('expired');
    const expiredFile = await oldStore.getFile('expired:file');
    const fresh = await oldStore.getWorkflow('fresh');
    const freshFile = await oldStore.getFile('fresh:file');
    const orphan = await oldStore.getFile('orphan:file');
    const unreferenced = await oldStore.getFile('unreferenced:file');
    const rollback = await oldStore.getWorkflow('rollback');
    const rollbackFile = await oldStore.getFile('rollback:file');
    const checkDb = await new Promise((resolve) => { const request = indexedDB.open('unrelated-app-data'); request.onsuccess = () => resolve(request.result); });
    const kept = await new Promise((resolve) => { const request = checkDb.transaction('records').objectStore('records').get('key'); request.onsuccess = () => resolve(request.result); });
    checkDb.close();
    return {
      removed, expired, expiredFile, fresh: fresh?.id, freshFile: freshFile?.id,
      orphan, unreferenced, rollback, rollbackFile, rolledBack, kept,
    };
  });
  expect(result).toEqual({
    removed: { workflows: 1, files: 3 }, expired: null, expiredFile: undefined,
    fresh: 'fresh', freshFile: 'fresh:file', orphan: undefined, unreferenced: undefined,
    rollback: null, rollbackFile: undefined, rolledBack: true, kept: 'keep',
  });
});

test('WebMCP exposes one recommendation plus state-dependent metadata-only queue actions', async ({ page }) => {
  await installModelContext(page);
  const response = await page.goto('/workflows'); await rejectConsent(page);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(response.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(response.headers()['permissions-policy']).toContain('tools=(self)');
  await expect.poll(() => page.evaluate(() => [...window.__workflowTools.keys()])).toEqual(['recommend-document-workflow']);
  const recommended = await page.evaluate(() => window.__workflowTools.get('recommend-document-workflow').execute({ goal: 'remove-standard-metadata' }, { signal: new AbortController().signal }));
  expect(recommended).toEqual({ recipeId: 'privacy-scan-cleanup-v1', title: expect.any(String), steps: expect.any(Array), requiresUserFileSelection: true });
  await page.setInputFiles('#workflowFileInput', path.join(FIXTURES, 'report.pdf'));
  await expect.poll(() => page.evaluate(() => [...window.__workflowTools.keys()].sort())).toEqual(['cancel-workflow-queue', 'get-workflow-queue-status', 'recommend-document-workflow']);
  const status = await page.evaluate(() => window.__workflowTools.get('get-workflow-queue-status').execute({}, { signal: new AbortController().signal }));
  expect(status.count).toBe(1);
  expect(JSON.stringify(status)).not.toMatch(/bytes|base64|blob:|password|(?:^|["'])path["']/i);
  const contracts = await page.evaluate(() => [...window.__workflowTools.values()].map((tool) => ({ name: tool.name, strict: tool.inputSchema.additionalProperties, annotationKeys: Object.keys(tool.annotations).sort() })));
  for (const contract of contracts) {
    expect(contract.strict).toBe(false);
    expect(contract.annotationKeys).toEqual(['consequentialHint', 'readOnlyHint', 'untrustedContentHint']);
  }
});

test('WebMCPTesting discovers and invokes the workflow recommendation tool', async () => {
  const browser = await chromium.launch({ args: ['--enable-features=WebMCPTesting'] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/workflows`); await rejectConsent(page);
    const client = await context.newCDPSession(page);
    const tools = new Map();
    client.on('WebMCP.toolsAdded', ({ tools: added }) => added.forEach((tool) => tools.set(tool.name, tool)));
    await client.send('WebMCP.enable');
    await expect.poll(() => [...tools.keys()]).toEqual(['recommend-document-workflow']);
    const tool = tools.get('recommend-document-workflow');
    const responsePromise = new Promise((resolve) => client.on('WebMCP.toolResponded', resolve));
    await client.send('WebMCP.invokeTool', { frameId: tool.frameId, toolName: tool.name, input: { goal: 'reorder-and-number' } });
    const response = await responsePromise;
    expect(response.status).toBe('Completed');
    expect(response.output.recipeId).toBe('organize-page-numbers-v1');
    expect(JSON.stringify(response.output)).not.toMatch(/bytes|base64|blob:|password/i);
  } finally { await browser.close(); }
});

test('three starter recipes produce real PDF artifacts; protection requires its password', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/workflows'); await rejectConsent(page);
  const traffic = [];
  page.on('request', (request) => traffic.push({ url: request.url(), body: request.postDataBuffer() }));

  await page.fill('#workflowPassword', 'workflow-secret');
  await page.setInputFiles('#workflowFileInput', path.join(FIXTURES, 'appendix.pdf'));
  await page.click('#runWorkflowBtn');
  await expect(page.locator('.queue-status')).toHaveText('Success', { timeout: 90_000 });
  const protectedDownload = page.waitForEvent('download'); await page.click('#queueBody button');
  const protectedFile = await protectedDownload; const protectedPath = testInfo.outputPath('protected.pdf'); await protectedFile.saveAs(protectedPath);
  await expect(PDFDocument.load(readFileSync(protectedPath))).rejects.toThrow(/encrypted/i);
  expect((await PDFDocument.load(readFileSync(protectedPath), { ignoreEncryption: true })).getPageCount()).toBe(2);

  await page.click('#clearWorkflowBtn');
  await page.locator('input[name="recipe"][value="organize-page-numbers-v1"]').check();
  await page.setInputFiles('#workflowFileInput', path.join(FIXTURES, 'report.pdf'));
  await page.click('#runWorkflowBtn');
  await expect(page.locator('.queue-status')).toHaveText('Success', { timeout: 60_000 });
  const numberedDownload = page.waitForEvent('download'); await page.click('#queueBody button');
  const numberedFile = await numberedDownload; const numberedPath = testInfo.outputPath('numbered.pdf'); await numberedFile.saveAs(numberedPath);
  expect((await PDFDocument.load(readFileSync(numberedPath))).getPageCount()).toBe(3);
  expect(readFileSync(numberedPath).equals(readFileSync(path.join(FIXTURES, 'report.pdf')))).toBe(false);
  const organizedText = await page.evaluate(async (raw) => {
    const { ensurePdfJs, PDFJS_ASSET_URLS } = await import('/js/lib-loader.js');
    const pdfjs = await ensurePdfJs(); const task = pdfjs.getDocument({ data: new Uint8Array(raw), ...PDFJS_ASSET_URLS }); const doc = await task.promise;
    const page1 = await doc.getPage(1); const content = await page1.getTextContent(); const text = content.items.map((item) => item.str).join(' '); await task.destroy(); return text;
  }, Array.from(readFileSync(numberedPath)));
  expect(organizedText).toContain('Notes');
  expect(organizedText.split(/\s+/)).toContain('1');

  await page.click('#clearWorkflowBtn');
  await page.locator('input[name="recipe"][value="privacy-scan-cleanup-v1"]').check();
  await page.setInputFiles('#workflowFileInput', path.join(FIXTURES, 'report.pdf'));
  await page.click('#runWorkflowBtn');
  await expect(page.locator('.queue-status')).toHaveText('Success', { timeout: 60_000 });
  await expect(page.locator('.queue-report')).toContainText('Standard metadata fields found:');
  const scanCount = Number((await page.locator('.queue-report').textContent()).match(/found: (\d+)/)?.[1]);
  expect(scanCount).toBeGreaterThan(0);
  const cleanedDownload = page.waitForEvent('download'); await page.click('#queueBody button');
  const cleanedFile = await cleanedDownload; const cleanedPath = testInfo.outputPath('cleaned.pdf'); await cleanedFile.saveAs(cleanedPath);
  const cleaned = await PDFDocument.load(readFileSync(cleanedPath), { updateMetadata: false });
  expect(cleaned.getPageCount()).toBe(3);
  expect([cleaned.getTitle(), cleaned.getAuthor(), cleaned.getSubject(), cleaned.getKeywords(), cleaned.getCreator(), cleaned.getProducer()].filter(Boolean)).toEqual([]);
  const cleanedText = await page.evaluate(async (raw) => {
    const { ensurePdfJs, PDFJS_ASSET_URLS } = await import('/js/lib-loader.js');
    const pdfjs = await ensurePdfJs(); const task = pdfjs.getDocument({ data: new Uint8Array(raw), ...PDFJS_ASSET_URLS }); const doc = await task.promise;
    const page1 = await doc.getPage(1); const content = await page1.getTextContent(); const text = content.items.map((item) => item.str).join(' '); await task.destroy(); return text;
  }, Array.from(readFileSync(cleanedPath)));
  expect(cleanedText).toContain('Quarterly Report 2026');
  const sourcePrefixes = ['appendix.pdf', 'report.pdf'].map((name) => readFileSync(path.join(FIXTURES, name)).subarray(0, 64));
  for (const request of traffic) {
    expect(decodeURIComponent(request.url)).not.toMatch(/appendix\.pdf|report\.pdf|workflow-secret|Quarterly Report 2026/i);
    for (const prefix of sourcePrefixes) expect(request.body?.includes(prefix) || false).toBe(false);
  }
});

test('Phase 4 source avoids unbounded execution and WebMCP binary/file side effects', () => {
  const webmcp = readFileSync(path.join(PUBLIC, 'js/webmcp.js'), 'utf8');
  const workflows = readFileSync(path.join(PUBLIC, 'js/workflows.js'), 'utf8');
  const batchQueue = readFileSync(path.join(PUBLIC, 'js/core/batch-queue.js'), 'utf8');
  expect(webmcp).not.toMatch(/navigator\.modelContext|unregisterTool|updateTool|outputSchema/);
  expect(webmcp).not.toMatch(/arrayBuffer\(|FileReader|createObjectURL|\.click\(/);
  expect(batchQueue).toContain("concurrency !== 1");
  expect(workflows).not.toMatch(/Promise\.all\(\s*(?:files|queue)/);
});
