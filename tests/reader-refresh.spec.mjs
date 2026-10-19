import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

async function bytes(label) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 3; page++) doc.addPage([500, 400]).drawText(`${label} PAGE ${page}`, { x: 55, y: 250, font, size: 18 });
  return [...await doc.save()];
}
async function mount(page, source, { hook = false } = {}) {
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected')); await page.goto('/view-pdf');
  // Exercise the exported Reader API directly in its real retained host. The
  // scoped Highlight/Redact route suites separately cover native file intake.
  await page.evaluate(async ({ source, hook }) => {
    const entry = document.querySelector('script[type=module][src$="js/view-pdf.js"]'), ui = await import(new URL('./tool-ui.js', entry.src).href);
    const parsed = await ui.readPdfFile(new File([Uint8Array.from(source)], 'ORIGINAL.pdf', { type: 'application/pdf' }), { validate: true });
    const taskId = ui.documentSession.snapshot().taskId, { openReaderWorkspace } = await import(new URL('./reader-workspace.js', entry.src).href);
    window.readerApi = await openReaderWorkspace(parsed, { isCurrent: () => ui.documentSession.snapshot().taskId === taskId,
      beforeContinueMode: hook ? async () => { window.readerBeforeHeld = true; return new Promise((resolve) => { window.readerBeforeRelease = resolve; }); } : undefined });
  }, { source, hook });
  await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false');
}
async function picture(page, info, name) {
  const value = await page.locator('#pdfCanvas').evaluate((canvas) => ({ png: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height }));
  const data = Buffer.from(value.png, 'base64'); await writeFile(info.outputPath(name + '.png'), data);
  expect(Math.max(value.width, value.height)).toBeLessThanOrEqual(1200); expect(value.width * value.height).toBeLessThanOrEqual(2_000_000);
  return createHash('sha256').update(data).digest('hex');
}
async function adopt(page, values, label) {
  return page.evaluate(async ({ values, label }) => {
    const ui = await import(new URL('./tool-ui.js', document.querySelector('script[type=module][src$="js/view-pdf.js"]').src).href);
    ui.documentSession.adopt(Uint8Array.from(values), label + '.pdf', { capabilities: { searchable: true } }); return ui.documentSession.snapshot();
  }, { values, label });
}
async function holdRender(page) {
  await page.evaluate(() => {
    // Obtain the real PDFPageProxy prototype; getPage itself is not replaced.
    return window.readerApi.pdf.getPage(window.readerApi.pageIndex + 1).then((page) => {
      const owner = Object.getPrototypeOf(page), render = owner.render; let first = true;
      window.restoreReaderRender = () => { owner.render = render; };
      owner.render = function (...args) {
        const native = render.apply(this, args);
        if (!first) return native; first = false;
        return { cancel: () => native.cancel(), promise: native.promise.then(() => {
          window.readerRenderHeld = true; return new Promise((resolve, reject) => { window.releaseReaderRender = (fail = false) => fail ? reject(new Error('Candidate render verification failed')) : resolve(); });
        }) };
      };
    });
  });
}
async function startRefresh(page) {
  await page.evaluate(() => { window.readerRefreshResult = window.readerApi.refresh().then(() => 'ready', (error) => error.name + ':' + error.message); });
  await expect.poll(() => page.evaluate(() => window.readerRenderHeld)).toBe(true);
}

test('Reader refresh verifies actual candidate page before swapping and retains old PDF/cache/DOM on render failure', async ({ page }, info) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await mount(page, await bytes('ORIGINAL'));
  await page.evaluate(() => window.readerApi.render(1)); await expect(page.locator('#readerTextLayer')).toHaveText('ORIGINAL PAGE 2');
  await page.locator('#readerSearch>summary').click(); await page.fill('#readerSearchQuery', 'ORIGINAL'); await page.click('#readerSearchBtn'); await expect(page.locator('#readerSearchResults button')).toHaveCount(3);
  const old = await picture(page, info, 'old-page2');
  await page.evaluate(() => { window.readerOldPdf = window.readerApi.pdf; window.readerOldTextLayer = window.readerApi.textLayer; window.readerQuery = document.getElementById('readerSearchQuery'); window.readerQuery.focus(); window.readerQuery.setSelectionRange(2, 2); });
  await adopt(page, await bytes('CANDIDATE'), 'CANDIDATE'); await holdRender(page); await startRefresh(page);
  expect(await picture(page, info, 'old-page2-during-candidate')).toBe(old); await expect(page.locator('#readerTextLayer')).toHaveText('ORIGINAL PAGE 2');
  await page.evaluate(() => window.releaseReaderRender(true)); expect(await page.evaluate(() => window.readerRefreshResult)).toContain('Candidate render verification failed');
  expect(await picture(page, info, 'old-page2-after-failure')).toBe(old); await expect(page.locator('#readerSearchResults button')).toHaveCount(3);
  expect(await page.evaluate(() => window.readerApi.pdf === window.readerOldPdf && window.readerApi.textLayer === window.readerOldTextLayer && document.getElementById('readerSearchQuery') === window.readerQuery)).toBe(true);
  await page.evaluate(() => window.restoreReaderRender()); await page.evaluate(() => window.readerApi.refresh()); await expect(page.locator('#readerTextLayer')).toHaveText('CANDIDATE PAGE 2');
  expect(await picture(page, info, 'verified-candidate-page2')).not.toBe(old);
  await expect(page.locator('#readerSearchQuery')).toBeFocused(); expect(await page.locator('#readerSearchQuery').evaluate((node) => ({ same: node === window.readerQuery, start: node.selectionStart, end: node.selectionEnd }))).toEqual({ same: true, start: 2, end: 2 });
  expect(errors).toEqual([]);
});

test('disposed held Reader refresh cannot repaint a new chosen task after its native render finishes', async ({ page }, info) => {
  const original = await bytes('ORIGINAL'); await mount(page, original); await adopt(page, await bytes('ABANDONED'), 'ABANDONED'); await holdRender(page); await startRefresh(page);
  const replacement = await bytes('NEW TASK');
  await page.evaluate(async (values) => {
    const old = window.readerApi; old.dispose();
    const entry = document.querySelector('script[type=module][src$="js/view-pdf.js"]'), ui = await import(new URL('./tool-ui.js', entry.src).href);
    const parsed = await ui.readPdfFile(new File([Uint8Array.from(values)], 'NEW TASK.pdf', { type: 'application/pdf' }), { validate: true });
    const taskId = ui.documentSession.snapshot().taskId, { openReaderWorkspace } = await import(new URL('./reader-workspace.js', entry.src).href);
    window.readerApi = await openReaderWorkspace(parsed, { isCurrent: () => ui.documentSession.snapshot().taskId === taskId });
  }, replacement);
  await expect(page.locator('#readerTextLayer')).toHaveText('NEW TASK PAGE 1'); const current = await picture(page, info, 'new-task-before-old-release');
  await page.evaluate(() => window.releaseReaderRender()); expect(await page.evaluate(() => window.readerRefreshResult)).toMatch(/^AbortError:/);
  await expect(page.locator('#readerTextLayer')).toHaveText('NEW TASK PAGE 1'); expect(await picture(page, info, 'new-task-after-old-release')).toBe(current);
  for (const id of ['pdfCanvas', 'readerTools', 'readerTextLayer', 'fileInput']) await expect(page.locator('#' + id)).toHaveCount(1);
  await page.evaluate(() => window.restoreReaderRender());
});

test('Reader beforeContinueMode false or stale ownership restores controls without baking or storing a handoff', async ({ page }) => {
  const writerRequests = []; page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/js/core/object-scene.js')) writerRequests.push(request.url()); });
  await mount(page, await bytes('ORIGINAL'), { hook: true });
  const pending = await page.evaluate(async () => {
    const ui = await import(new URL('./tool-ui.js', document.querySelector('script[type=module][src$="js/view-pdf.js"]').src).href);
    ui.documentSession.beginScene(); const scene = ui.documentSession.scene(); scene.objects.push({ id: 'pending-highlight', kind: 'highlight', pageIndex: 0, quads: [[55, 246, 230, 246, 230, 270, 55, 270]], color: [1, 1, 0], opacity: .4, note: 'Pending edit', selectedText: 'ORIGINAL PAGE 1' }); ui.documentSession.changeScene(scene); return ui.documentSession.transfer();
  });
  expect(writerRequests).toEqual([]);
  await page.evaluate(() => {
    const native = IDBDatabase.prototype.transaction; window.readerWrites = 0;
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) { if (mode === 'readwrite') window.readerWrites++; return native.call(this, stores, mode, ...rest); };
  });
  await page.locator('#readerModes>summary').click();
  const control = page.locator('#workspaceModes button[data-mode="add-text"]'); await control.click(); await expect.poll(() => page.evaluate(() => window.readerBeforeHeld)).toBe(true); await expect(control).toBeDisabled();
  await page.evaluate(() => window.readerBeforeRelease(false)); await expect(control).toBeEnabled(); expect(page.url()).toMatch(/\/view-pdf$/); expect(await page.evaluate(() => window.readerWrites)).toBe(0);
  expect(await page.evaluate(async () => (await import(new URL('./tool-ui.js', document.querySelector('script[type=module][src$="js/view-pdf.js"]').src).href)).documentSession.transfer())).toEqual(pending); expect(writerRequests).toEqual([]);
  await page.evaluate(() => { window.readerBeforeHeld = false; }); await control.click(); await expect.poll(() => page.evaluate(() => window.readerBeforeHeld)).toBe(true);
  await adopt(page, await bytes('LATER SAME TASK'), 'LATER SAME TASK'); await page.evaluate(() => window.readerBeforeRelease(true)); await expect(control).toBeEnabled(); expect(page.url()).toMatch(/\/view-pdf$/); expect(await page.evaluate(() => window.readerWrites)).toBe(0); expect(writerRequests).toEqual([]);
});

test('repeated Reader unlocked state preserves a native in-progress page draft until its change commits', async ({ page }, info) => {
  await mount(page, await bytes('ORIGINAL')); await page.fill('#readerPage', '2');
  await page.evaluate(() => { window.readerApi.setDisabled(false); window.readerApi.setDisabled(false); });
  await expect(page.locator('#readerPage')).toHaveValue('2'); await expect(page.locator('#readerPage')).toBeFocused();
  await page.locator('#readerPage').press('Tab'); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#readerPage')).toHaveValue('2'); await expect(page.locator('#readerTextLayer')).toHaveText('ORIGINAL PAGE 2'); await picture(page, info, 'committed-native-page2');
});
