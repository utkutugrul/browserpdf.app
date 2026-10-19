import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function source(label, count) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= count; index++) doc.addPage([600,800]).drawText(`${label} PAGE ${index}`, { x: 50, y: 700, font, size: 18 });
  return { name: `${label}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}
async function details(locator) { for (const item of await locator.locator('xpath=ancestor::details[not(@open)]').all()) await item.locator('summary').first().click(); }
async function ready(page, name) { await expect(page.locator('#objectWorkspace')).toBeVisible(); await expect(page.locator('#placementCanvas, #previewCanvas')).toHaveAttribute('aria-busy', 'false'); if (name) await expect(page.locator('#documentIdentity')).toContainText(name); }
async function open(page) {
  await page.addInitScript(() => {
    localStorage.setItem('bpdf-consent','rejected');
    // Observe the actual native click handler's returned promise; detached DOM
    // state is not a completion oracle. The listener/action itself is unchanged.
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (type !== 'click' || typeof listener !== 'function') return add.call(this,type,listener,options);
      return add.call(this,type,function(event) {
        const chain = this instanceof Element && this.closest('#chainRow'), result = listener.call(this,event);
        if (chain && result && typeof result.then === 'function') { window.handoffHandlerSettled = false; Promise.resolve(result).then(() => { window.handoffHandlerSettled = true; }, () => { window.handoffHandlerSettled = true; }); }
        return result;
      },options);
    };
  }); await page.goto('/add-text');
  await expect(page.locator('#fileInput')).toBeEnabled(); await page.setInputFiles('#fileInput', await source('OLD TASK A', 1)); await ready(page, 'OLD TASK A.pdf');
  await edit(page, 'OLD EDIT A');
}
async function edit(page, text) {
  if (await page.locator('#objectList option').count()) { await expect(page.locator('#objectList')).toBeEnabled(); await page.selectOption('#objectList',{ index: 0 }); }
  await details(page.locator('#textInput')); await page.fill('#textInput', text);
  if (await page.locator('#objectList option').count() === 0) { await expect(page.locator('#placeDraftBtn')).toBeEnabled(); await page.click('#placeDraftBtn'); }
  await expect(page.locator('#applyBtn')).toBeEnabled(); await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  await expect(page.locator('#chainRow button').filter({ hasText: 'Add Image' })).toBeVisible(); await expect(page.locator('#fileInput')).toBeEnabled();
}
async function snapshot(page) { return page.evaluate(async () => { const entry = document.querySelector('script[type=module][src^="js/"]'), ui = await import(new URL('./tool-ui.js',entry.src).href); return { snapshot: ui.documentSession.snapshot(), bytes: [...ui.documentSession.current().bytes] }; }); }
async function hold(page, target) {
  await page.evaluate((target) => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    if (!descriptor?.set || !descriptor.get) throw new Error('Native transaction completion descriptor is unavailable.');
    window.restoreHandoffHold = () => Object.defineProperty(IDBTransaction.prototype, 'oncomplete', descriptor); let count = 0;
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { configurable: true, enumerable: descriptor.enumerable, get: descriptor.get, set(handler) {
      const tx = this, stores = [...tx.objectStoreNames], eligible = tx.db.name === 'browserpdf-workflows' && tx.mode === 'readwrite' && stores.includes('workflows') && stores.includes('files');
      if (eligible && ++count === target) descriptor.set.call(tx, function(event) { window.heldHandoff = { count, completedNativeTransaction: true }; window.releaseHandoff = () => handler.call(tx,event); });
      else descriptor.set.call(tx,handler);
    } });
  }, target);
}
async function saved(page, testInfo, name) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); const path = testInfo.outputPath(name); await download.saveAs(path);
  const bytes = await readFile(path), pdf = await PDFDocument.load(bytes), text = await page.evaluate(async (bytes) => {
    const entry = document.querySelector('script[type=module][src^="js/"]'), runtime = await import(new URL('./lib-loader.js',entry.src).href), task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS });
    try { const doc = await task.promise, pages = []; for (let index = 1; index <= doc.numPages; index++) pages.push((await (await doc.getPage(index)).getTextContent()).items.map((item) => item.str).join(' ')); return pages; } finally { await task.destroy(); }
  }, [...bytes]);
  return { bytes, pages: pdf.getPageCount(), text };
}

for (const transaction of [1,2]) test(`held native IDB ${transaction === 1 ? 'cleanup' : 'bundle'} cannot replace or navigate away from new task B`, async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await open(page);
  const old = await saved(page,testInfo,'old-A-actual.pdf'), oldTask = (await snapshot(page)).snapshot.taskId;
  await hold(page,transaction); const button = await page.locator('#chainRow button').filter({ hasText: 'Add Image' }).elementHandle(); await button.click();
  await expect.poll(() => page.evaluate(() => !!window.heldHandoff)).toBe(true);
  const replacement = await source('NEW TASK B',2), input = page.locator('#fileInput'); await details(input); await expect(input).toBeEnabled(); await input.setInputFiles(replacement); await ready(page,'NEW TASK B.pdf');
  const before = await snapshot(page); expect(before.snapshot.taskId).not.toBe(oldTask); expect(sha(Buffer.from(before.bytes))).toBe(sha(replacement.buffer));
  await page.evaluate(() => window.releaseHandoff()); await expect.poll(() => page.evaluate(() => window.handoffHandlerSettled)).toBe(true);
  const after = await snapshot(page); expect(page.url()).toMatch(/\/add-text$/); expect(after).toEqual(before); expect(sha(Buffer.from(after.bytes))).not.toBe(sha(old.bytes));
  await edit(page,'NEW B SURVIVING EDIT'); const result = await saved(page,testInfo,`new-B-after-held-${transaction}.pdf`);
  expect(result.pages).toBe(2); expect(result.text[0]).toContain('NEW TASK B PAGE 1'); expect(result.text[0]).toContain('NEW B SURVIVING EDIT'); expect(result.text[1]).toContain('NEW TASK B PAGE 2'); expect(result.text.join('\n')).not.toContain('OLD EDIT A');
  expect((await snapshot(page)).snapshot.taskId).toBe(before.snapshot.taskId); expect(errors).toEqual([]); await page.evaluate(() => window.restoreHandoffHold());
});

test('a held old native bundle preserves a newer explicit same-task handoff and its actual PDF', async ({ page }, testInfo) => {
  await open(page); const initial = await snapshot(page); await hold(page,2);
  await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'), current = ui.documentSession.current(); window.oldHandoff = ui.stashForChain(current.bytes,current.name,'add-image').then(() => 'returned', (error) => error.name); });
  await expect.poll(() => page.evaluate(() => !!window.heldHandoff)).toBe(true);
  await edit(page,'LATEST SAME TASK EDIT'); const actual = await saved(page,testInfo,'newer-same-task-actual.pdf');
  const latest = await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'), current = ui.documentSession.current(), next = await ui.stashForChain(current.bytes,current.name,'add-image'); return { workflowId: next.workflowId, fileId: next.fileId }; });
  expect(latest.workflowId).toBe(initial.snapshot.taskId); await page.evaluate(() => window.releaseHandoff()); expect(await page.evaluate(() => window.oldHandoff)).toBe('AbortError');
  const stored = await page.evaluate(async ({ workflowId, fileId }) => { const { createWorkflowStore } = await import('/js/core/workflow-store.js'), store = createWorkflowStore(), workflow = await store.getWorkflow(workflowId), file = await store.getFile(fileId); return { refs: workflow?.fileRefs, bytes: file ? [...file.bytes] : null }; }, latest);
  expect(stored.refs).toContain(latest.fileId); expect(sha(Buffer.from(stored.bytes))).toBe(sha(actual.bytes));
  await page.evaluate(() => window.restoreHandoffHold()); await page.goto(`/add-image?workflow=${latest.workflowId}&file=${encodeURIComponent(latest.fileId)}`); await ready(page); expect((await snapshot(page)).snapshot.taskId).toBe(initial.snapshot.taskId);
  await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file'); const reopened = await saved(page,testInfo,'newer-same-task-reopened.pdf');
  expect(reopened.text.join('\n')).toContain('LATEST SAME TASK EDIT'); expect(reopened.text.join('\n')).not.toContain('OLD EDIT A'); expect(reopened.pages).toBe(1);
});

test('canceled explicit continuation aborts after native cleanup without adopting its result', async ({ page }) => {
  await open(page); const before = await snapshot(page); await hold(page,1);
  await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'), current = ui.documentSession.current(), operation = ui.documentOperations.begin(); window.canceledHandoff = ui.stashForChain(current.bytes,current.name,'add-image',{ operation }).then(() => 'returned',(error) => error.name); });
  await expect.poll(() => page.evaluate(() => !!window.heldHandoff)).toBe(true); await page.evaluate(async () => { (await import('/js/tool-ui.js')).documentOperations.cancel(); window.releaseHandoff(); });
  expect(await page.evaluate(() => window.canceledHandoff)).toBe('AbortError'); expect(await snapshot(page)).toEqual(before); expect(page.url()).toMatch(/\/add-text$/); await page.evaluate(() => window.restoreHandoffHold());
});
