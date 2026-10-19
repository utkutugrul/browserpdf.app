import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sha = (bytes) => createHash('sha256').update(Uint8Array.from(bytes)).digest('hex');
async function pdf(label, width = 400) {
  const doc = await PDFDocument.create(), page = doc.addPage([width, 500]);
  if (label) page.drawText(label, { x: 30, y: 450, size: 16, font: await doc.embedFont(StandardFonts.Helvetica) });
  return new Uint8Array(await doc.save());
}
async function open(page, route) {
  await page.addInitScript(() => {
    localStorage.setItem('bpdf-consent', 'rejected'); window.ownerContinuations = [];
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type !== 'click' || typeof listener !== 'function') return add.call(this, type, listener, options);
      return add.call(this, type, function (event) {
        const chain = this instanceof Element && this.closest('#chainRow');
        const value = listener.call(this, event);
        if (chain && value && typeof value.then === 'function') {
          const call = { settled: false, trusted: event.isTrusted, label: this.textContent }; window.ownerContinuations.push(call);
          Promise.resolve(value).then(() => { call.settled = true; }, () => { call.settled = true; });
        }
        return value;
      }, options);
    };
  });
  await page.goto('/' + route);
}
async function task(page) {
  return page.evaluate(async () => {
    const entry = document.querySelector('script[type=module][src^="js/"]'), ui = await import(new URL('./tool-ui.js', entry.src).href);
    const copy = (artifact) => artifact ? { ...artifact, bytes: [...artifact.bytes] } : null;
    return { owner: ui.documentSession.snapshot(), original: copy(ui.documentSession.original()), current: copy(ui.documentSession.current()) };
  });
}
async function records(page) {
  return page.evaluate(async () => {
    const entry = document.querySelector('script[type=module][src^="js/"]'), { openWorkflowDb } = await import(new URL('./core/workflow-store.js', entry.src).href), db = await openWorkflowDb();
    try {
      const tx = db.transaction(['workflows', 'files'], 'readonly'), done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error); });
      const get = (name) => new Promise((resolve, reject) => { const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const [workflows, files] = await Promise.all([get('workflows'), get('files')]); await done;
      return { workflows, files: files.map((file) => ({ ...file, bytes: [...file.bytes] })) };
    } finally { db.close(); }
  });
}
async function emptyStore(page) { expect(await records(page)).toEqual({ workflows: [], files: [] }); }
async function settled(page, count) {
  await expect.poll(() => page.evaluate(() => window.ownerContinuations.filter((call) => call.settled).length)).toBe(count);
  expect(await page.evaluate(() => window.ownerContinuations.every((call) => call.trusted))).toBe(true);
}
const organize = (page) => page.locator('#chainRow').getByRole('button', { name: 'Organize', exact: true });
async function continued(page, bytes, name, expectedTask = null) {
  await expect(page).toHaveURL(/\/organize\?workflow=.*&file=/);
  await expect(page.locator('#pageTaskIdentity')).toContainText(`${(await PDFDocument.load(bytes)).getPageCount()} pages`);
  await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  const current = await task(page), params = new URL(page.url()).searchParams, stored = await records(page);
  expect(current.owner.taskId).toBe(params.get('workflow')); if (expectedTask) expect(current.owner.taskId).toBe(expectedTask);
  expect(sha(current.current.bytes)).toBe(sha(bytes)); expect(sha(current.original.bytes)).toBe(sha(bytes)); expect(current.current.type).toBe('application/pdf'); expect(current.current.name).toBe(name);
  const workflow = stored.workflows.find((value) => value.id === params.get('workflow')), file = stored.files.find((value) => value.id === params.get('file'));
  expect(workflow).toBeDefined(); expect(file.workflowId).toBe(workflow.id); expect(workflow.fileRefs).toContain(file.id); expect(sha(file.bytes)).toBe(sha(bytes)); expect(file.type).toBe('application/pdf'); expect(file.name).toBe(name);
  expect(sha(stored.files.find((value) => value.id === workflow.originalRef).bytes)).toBe(sha(bytes));
  return { taskId: current.owner.taskId, revision: current.owner.revision, sha: sha(bytes), workflowId: workflow.id, fileId: file.id };
}
async function mergeResult(page, info, label) {
  await open(page, 'merge');
  const first = await pdf('DIRECT MERGE A', 400), second = await pdf('DIRECT MERGE B', 450);
  await page.setInputFiles('#fileInput', [{ name: 'owner-A.pdf', mimeType: 'application/pdf', buffer: Buffer.from(first) }, { name: 'owner-B.pdf', mimeType: 'application/pdf', buffer: Buffer.from(second) }]);
  await expect(page.locator('#mergeBtn')).toBeEnabled(); expect((await task(page)).owner.taskId).toBeNull();
  await page.click('#mergeBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file'); await expect(organize(page)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); const path = info.outputPath(`${label}-actual-merged.pdf`); await download.saveAs(path); const bytes = new Uint8Array(await readFile(path));
  expect((await PDFDocument.load(bytes)).getPages().map((value) => value.getSize().width)).toEqual([400, 450]);
  expect(await task(page)).toMatchObject({ owner: { taskId: null }, current: null, original: null }); await emptyStore(page); return bytes;
}

test('fresh Merge continues the actual reviewed PDF directly without Use or a preexisting task', async ({ page }, info) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); const bytes = await mergeResult(page, info, 'direct');
  await organize(page).click(); const proof = await continued(page, bytes, 'merged.pdf'); expect(proof.revision).toBe(0); expect(errors).toEqual([]);
  await info.attach('direct-no-Use-owned-actual-PDF', { body: JSON.stringify(proof), contentType: 'application/json' });
});

test('a default rail retains its exact newly adopted task after actual bundle failure and native retry', async ({ page }, info) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); const bytes = await mergeResult(page, info, 'retry');
  await page.evaluate(() => {
    const native = IDBDatabase.prototype.transaction; let writes = 0;
    IDBDatabase.prototype.transaction = function (names, mode, ...options) {
      const stores = typeof names === 'string' ? [names] : [...names];
      if (this.name === 'browserpdf-workflows' && mode === 'readwrite' && stores.includes('workflows') && stores.includes('files') && ++writes === 2) { window.ownerBundleFailed = true; throw new DOMException('Default owner bundle quota test', 'QuotaExceededError'); }
      return native.call(this, names, mode, ...options);
    };
    window.restoreOwnerStorage = () => { IDBDatabase.prototype.transaction = native; };
  });
  let adopted;
  try {
    await organize(page).click(); await settled(page, 1); await expect(page.locator('#errorText')).toContainText('Default owner bundle quota test'); expect(await page.evaluate(() => window.ownerBundleFailed)).toBe(true);
    await expect(page).toHaveURL(/\/merge$/); adopted = await task(page); expect(adopted.owner.taskId).toEqual(expect.any(String)); expect(adopted.owner.revision).toBe(0);
    expect(sha(adopted.current.bytes)).toBe(sha(bytes)); expect(sha(adopted.original.bytes)).toBe(sha(bytes)); await emptyStore(page); await expect(organize(page)).toBeEnabled();
  } finally { await page.evaluate(() => window.restoreOwnerStorage()); }
  await organize(page).click(); const proof = await continued(page, bytes, 'merged.pdf', adopted.owner.taskId); expect(proof.revision).toBe(adopted.owner.revision); expect(errors).toEqual([]);
  await info.attach('default-post-adoption-retry', { body: JSON.stringify(proof), contentType: 'application/json' });
});

test('native Use of a reviewed PDF cannot authorize a different same-name rail and a fresh exact rail recovers', async ({ page }, info) => {
  const chosen = await pdf('CHOSEN REVIEW A', 400), unrelated = await pdf('DIFFERENT RAIL B', 450); await open(page, 'view-pdf');
  await page.evaluate(async ({ chosen, unrelated }) => {
    const entry = document.querySelector('script[type=module][src^="js/"]'), ui = await import(new URL('./tool-ui.js', entry.src).href);
    await ui.reviewResult(Uint8Array.from(chosen), 'same-name.pdf', { type: 'application/pdf' });
    await ui.offerChain(Uint8Array.from(unrelated), 'same-name.pdf', [{ slug: 'organize', label: 'Organize' }], { type: 'application/pdf' });
  }, { chosen: [...chosen], unrelated: [...unrelated] });
  expect((await task(page)).owner.taskId).toBeNull(); await page.click('#useResultBtn'); const adopted = await task(page);
  expect(sha(adopted.current.bytes)).toBe(sha(chosen)); expect(sha(adopted.original.bytes)).toBe(sha(chosen)); expect(adopted.owner.revision).toBe(1);
  await organize(page).click(); await settled(page, 1); await expect(page).toHaveURL(/\/view-pdf$/); expect(await task(page)).toEqual(adopted); await emptyStore(page); await expect(organize(page)).toBeEnabled();
  await page.evaluate(async (bytes) => { const entry = document.querySelector('script[type=module][src^="js/"]'), ui = await import(new URL('./tool-ui.js', entry.src).href); await ui.offerChain(Uint8Array.from(bytes), 'same-name.pdf', [{ slug: 'organize', label: 'Organize' }], { type: 'application/pdf' }); }, [...chosen]);
  await organize(page).click(); const proof = await continued(page, chosen, 'same-name.pdf', adopted.owner.taskId); expect(proof.revision).toBe(adopted.owner.revision);
  await info.attach('mismatched-rail-denied-fresh-exact-rail', { body: JSON.stringify({ ...proof, unrelatedSHA: sha(unrelated) }), contentType: 'application/json' });
});

test('PDF to Excel empty text offers native OCR continuation with no pending review and exact source ownership', async ({ page }, info) => {
  const errors = [], downloads = []; page.on('pageerror', (error) => errors.push(error.message)); page.on('download', (download) => downloads.push(download)); const bytes = await pdf('');
  await open(page, 'pdf-to-excel'); await page.setInputFiles('#fileInput', { name: 'empty-text-owner.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) }); await expect(page.locator('#optionsSection')).toBeVisible();
  const before = await task(page); expect(before.owner.taskId).toEqual(expect.any(String)); expect(sha(before.current.bytes)).toBe(sha(bytes));
  await page.click('#convertBtn'); await expect(page.locator('#errorText')).toContainText('No selectable table text'); await expect(page.locator('#chainRow').getByRole('button', { name: 'OCR PDF', exact: true })).toBeVisible();
  await expect(page.locator('#useResultBtn')).toHaveCount(0); expect(await task(page)).toEqual(before); await emptyStore(page);
  await page.locator('#chainRow').getByRole('button', { name: 'OCR PDF', exact: true }).click(); await expect(page).toHaveURL(/\/ocr-pdf\?workflow=.*&file=/); await expect(page.locator('#optionsSection')).toBeVisible(); await expect(page.locator('#applyBtn')).toBeEnabled();
  const after = await task(page), params = new URL(page.url()).searchParams, stored = await records(page), workflow = stored.workflows.find((value) => value.id === params.get('workflow')), file = stored.files.find((value) => value.id === params.get('file'));
  expect(after.owner.taskId).toBe(before.owner.taskId); expect(sha(after.current.bytes)).toBe(sha(bytes)); expect(sha(after.original.bytes)).toBe(sha(bytes)); expect(after.current.type).toBe('application/pdf');
  expect(workflow.id).toBe(before.owner.taskId); expect(file.workflowId).toBe(workflow.id); expect(workflow.fileRefs).toContain(file.id); expect(sha(file.bytes)).toBe(sha(bytes)); expect(file.name).toBe('empty-text-owner.pdf'); expect(file.type).toBe('application/pdf'); expect(downloads).toHaveLength(0); expect(errors).toEqual([]);
  await info.attach('standalone-no-pending-review-native-OCR', { body: JSON.stringify({ taskId: after.owner.taskId, sha: sha(bytes), workflowId: workflow.id, fileId: file.id }), contentType: 'application/json' });
});
