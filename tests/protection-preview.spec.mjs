import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
test.skip(process.env.BPDF_PROTECTION_WORKSPACES_NATIVE !== '1', 'Root allocates actual protection preview lifecycle');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(name, label) { const doc = await PDFDocument.create(); for (let n = 0; n < 2; n++) doc.addPage([320, 240]).drawText(label + ' ' + (n + 1), { x: 20, y: 170 }); return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }; }
async function ready(page, name) { await expect(page.locator('#protectionInputIdentity')).toHaveText(name); await expect(page.locator('#protectBtn')).toBeEnabled(); await expect(page.locator('#protectionCanvas canvas')).toHaveAttribute('data-pdf-page', '1'); }
async function current(page) { return page.evaluate(async () => { const ui = await import('/js/tool-ui.js'), value = ui.documentSession.current(); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value.bytes))].map(x => x.toString(16).padStart(2, '0')).join(''); }); }
async function installProbe(page, bytes, kind) {
  await page.evaluate(async ({ bytes, kind }) => {
    const runtime = await import('/js/lib-loader.js'), pdfjs = await runtime.ensurePdfJs(), probe = pdfjs.getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS });
    const doc = await probe.promise, pdfPage = await doc.getPage(1), taskPrototype = Object.getPrototypeOf(probe), pagePrototype = Object.getPrototypeOf(pdfPage), nativeDestroy = taskPrototype.destroy, nativeRender = pagePrototype.render;
    await probe.destroy();
    const state = window.__protectionPreviewProbe = { held: false, calls: 0, reads: [], release: null };
    const hold = new Promise(resolve => state.release = resolve), nativeRead = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () { state.reads.push(this.name); return nativeRead.call(this); };
    if (kind === 'render') pagePrototype.render = function (options) { const task = nativeRender.call(this, options); if (state.held) return task; state.held = true; return { cancel: () => task.cancel(), promise: task.promise.then(() => hold, error => hold.then(() => { throw error; })) }; };
    else taskPrototype.destroy = function () { state.calls++; if (state.calls !== 1) return nativeDestroy.call(this); state.held = true; if (kind === 'fail') return Promise.reject(new Error('Owned synthetic cleanup failure')); return Promise.resolve(nativeDestroy.call(this)).then(() => hold); };
  }, { bytes: [...bytes], kind });
}

for (const kind of ['render', 'destroy']) test(`actual ${kind} promise drains before C reads and old preview never repaints`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.name)); const a = await fixture('A.pdf', 'A'), b = await fixture('B.pdf', 'B'), c = await fixture('C.pdf', 'C');
  await page.goto('/protect'); await page.setInputFiles('#fileInput', a); await ready(page, 'A.pdf'); await installProbe(page, a.buffer, kind);
  if (kind === 'render') { await page.click('#nextProtectionPageBtn'); await expect.poll(() => page.evaluate(() => window.__protectionPreviewProbe.held)).toBe(true); }
  await page.setInputFiles('#fileInput', b); await expect.poll(() => page.evaluate(() => window.__protectionPreviewProbe.held)).toBe(true); await page.setInputFiles('#fileInput', c);
  expect(await current(page)).toBe(hash(a.buffer)); expect(await page.evaluate(() => window.__protectionPreviewProbe.reads)).toEqual([]); await expect(page.locator('#protectionCanvas canvas')).toHaveCount(0);
  await page.evaluate(() => window.__protectionPreviewProbe.release()); await ready(page, 'C.pdf'); expect(await current(page)).toBe(hash(c.buffer)); expect(await page.evaluate(() => window.__protectionPreviewProbe.reads)).toEqual(['C.pdf']); expect(errors).toEqual([]);
});
test('actual task destroy rejection fences intake until explicit Retry cleanup and a positive successor', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.name)); const a = await fixture('A.pdf', 'A'), b = await fixture('B.pdf', 'B'); await page.goto('/protect'); await page.setInputFiles('#fileInput', a); await ready(page, 'A.pdf'); await installProbe(page, a.buffer, 'fail');
  await page.setInputFiles('#fileInput', b); await expect(page.locator('#retryProtectionCleanupBtn')).toBeVisible(); expect(await current(page)).toBe(hash(a.buffer)); expect(await page.evaluate(() => window.__protectionPreviewProbe.reads)).toEqual([]);
  await page.setInputFiles('#fileInput', b); expect(await page.evaluate(() => window.__protectionPreviewProbe.reads)).toEqual([]); await page.click('#retryProtectionCleanupBtn'); await ready(page, 'A.pdf'); await expect(page.locator('#retryProtectionCleanupBtn')).toBeHidden(); await page.setInputFiles('#fileInput', b); await ready(page, 'B.pdf'); expect(await current(page)).toBe(hash(b.buffer)); expect(errors).toEqual([]);
});
