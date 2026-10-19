import { test, expect } from '@playwright/test';
import * as pdfLib from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';

function image(name, color = 'red', alpha = false) {
  const canvas = createCanvas(80, 40), ctx = canvas.getContext('2d');
  for (const [x, y, value] of [[0, 0, color], [40, 0, 'lime'], [0, 20, 'blue'], [40, 20, alpha ? 'rgba(255,255,0,0.5)' : 'yellow']]) { ctx.fillStyle = value; ctx.fillRect(x, y, 40, 20); }
  return { name, mimeType: 'image/png', buffer: canvas.toBuffer('image/png') };
}
function exif(orientation) {
  const fixture = image(`orientation-${orientation}.jpg`), canvas = createCanvas(80, 40), ctx = canvas.getContext('2d');
  for (const [x, y, color] of [[0, 0, 'red'], [40, 0, 'lime'], [0, 20, 'blue'], [40, 20, 'yellow']]) { ctx.fillStyle = color; ctx.fillRect(x, y, 40, 20); }
  const jpeg = canvas.toBuffer('image/jpeg'), segment = Buffer.alloc(36); segment.writeUInt16BE(0xffe1, 0); segment.writeUInt16BE(34, 2); segment.write('Exif\0\0', 4, 'binary'); segment.write('II', 10); segment.writeUInt16LE(42, 12); segment.writeUInt32LE(8, 14); segment.writeUInt16LE(1, 18); segment.writeUInt16LE(0x112, 20); segment.writeUInt16LE(3, 22); segment.writeUInt32LE(1, 24); segment.writeUInt16LE(orientation, 28);
  return { name: fixture.name, mimeType: 'image/jpeg', buffer: Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]) };
}
async function open(page, route) {
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
  const requests = [], listener = (request) => requests.push(request.url()); page.on('request', listener); await page.goto('/' + route); await page.waitForLoadState('domcontentloaded'); page.off('request', listener);
  const graph = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource').map((entry) => new URL(entry.name)).filter((url) => url.origin === location.origin && url.pathname.startsWith('/js/') && url.pathname.endsWith('.js')).map((url) => url.pathname))]);
  const bytes = graph.reduce((sum, pathname) => sum + statSync(path.join(path.resolve(import.meta.dirname,'../public'),pathname)).size,0);
  expect(requests.length,`${route} idle requests`).toBeLessThanOrEqual(16); expect(bytes,`${route} boot JavaScript`).toBeLessThan(100000); expect(graph).not.toContain('/js/image-composer.js'); expect(graph).not.toContain('/js/pdf-images-workspace.js'); expect(graph).not.toContain('/js/core/image-intake.js');
  await test.info().attach(`${route}-boot-graph`,{body:JSON.stringify({route,requests:requests.length,bytes,graph},null,2),contentType:'application/json'});
  if (route === 'images') await page.click('#modeImgToPdf');
}
async function choose(page, selector, files) { await expect(page.locator(selector)).toBeEnabled(); await page.setInputFiles(selector, files); }
async function taskAction(page, selector) { const details = page.locator('.composer-details').filter({ has: page.locator(selector) }); if (await details.count() && !(await details.evaluate((value) => value.open))) await details.locator('summary').click(); await page.click(selector); }
const inputFor = (route) => route === 'images' ? '#imgFileInput' : '#fileInput';
const actionFor = (route) => route === 'images' ? '#createPdfBtn' : '#createBtn';
async function readyComposer(page, route, selectedPage) { await expect(page.locator('#imageComposer')).toBeVisible(); await expect(page.locator('#imageComposer')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#composerPreviewCanvas')).toHaveAttribute('data-pdf-page', selectedPage ? String(selectedPage) : /^\d+$/); await expect(page.locator(`#imageComposer ${actionFor(route)}`)).toBeEnabled(); }
async function task(page) { return page.evaluate(async () => { const entry = [...document.querySelectorAll('script[type="module"][src]')].map((value) => value.src).find((value) => /\/(images|jpg-to-pdf)\.js$/.test(value)), ui = await import(new URL('./tool-ui.js', entry).href), current = ui.documentSession.current(), original = ui.documentSession.original(); return { state: ui.documentSession.snapshot(), composition: ui.documentSession.composition(), current: current ? { ...current, bytes: Array.from(current.bytes) } : null, original: original ? { ...original, bytes: Array.from(original.bytes) } : null }; }); }
async function saved(page, testInfo, route, name) { await readyComposer(page, route); await page.click(actionFor(route)); await expect(page.locator('#documentResultStatus')).toContainText('actual file'); const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); await download.saveAs(testInfo.outputPath(name)); return new Uint8Array(await readFile(testInfo.outputPath(name))); }
function embedded(doc, index) { const entries = doc.getPage(index).node.Resources().lookup(pdfLib.PDFName.of('XObject')).entries(); return doc.context.lookup(entries[0][1]); }
function rgbAt(stream, x, y) { const width = stream.dict.lookup(pdfLib.PDFName.of('Width')).asNumber(), values = pdfLib.decodePDFRawStream(stream).decode(), offset = (y * width + x) * 3; return [...values.subarray(offset, offset + 3)]; }
function closeRgb(actual, expected) { actual.forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(8)); }
async function samePreview(page, bytes, pageIndex) { const result = await page.evaluate(async ({ values, pageIndex }) => { const runtime = await import('/js/lib-loader.js'), { renderBoundedPage } = await import('/js/core/bounded-renderer.js'), original = document.getElementById('composerPreviewCanvas'), oracle = document.createElement('canvas'); original.parentElement.append(oracle); const loading = (await runtime.ensurePdfJs()).getDocument({ data: new Uint8Array(values), ...runtime.PDFJS_ASSET_URLS }); try { const doc = await loading.promise; await renderBoundedPage(await doc.getPage(pageIndex + 1), oracle, { maxDimension: 1000, maxPixels: 1_000_000 }); const expected = oracle.getContext('2d').getImageData(0, 0, oracle.width, oracle.height).data, actual = original.getContext('2d').getImageData(0, 0, original.width, original.height).data; let different = 0; for (let i = 0; i < expected.length; i++) different += Number(expected[i] !== actual[i]); return { different, equalSize: original.width === oracle.width && original.height === oracle.height, length: expected.length }; } finally { await loading.destroy(); oracle.width = oracle.height = 0; oracle.remove(); } }, { values: Array.from(bytes), pageIndex }); expect(result.equalSize).toBe(true); expect(result.length).toBeGreaterThan(1000); expect(result.different).toBe(0); }

for (const route of ['images', 'jpg-to-pdf']) test(`${route}: shared composer saves EXIF once, alpha, order, paper, actual preview and retained editable task`, async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await open(page, route);
  await choose(page, inputFor(route), [1, 3, 6, 8].map(exif).concat(image('transparent.png', 'red', true)));
  const bytes = await saved(page, testInfo, route, `${route}-exif-alpha.pdf`), doc = await pdfLib.PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(5); const corners = [[[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]], [[255, 255, 0], [0, 0, 255], [0, 255, 0], [255, 0, 0]], [[0, 0, 255], [255, 0, 0], [255, 255, 0], [0, 255, 0]], [[0, 255, 0], [255, 255, 0], [255, 0, 0], [0, 0, 255]]];
  for (let index = 0; index < 4; index++) { const stream = embedded(doc, index), width = stream.dict.lookup(pdfLib.PDFName.of('Width')).asNumber(), height = stream.dict.lookup(pdfLib.PDFName.of('Height')).asNumber(); expect([width, height]).toEqual(index < 2 ? [80, 40] : [40, 80]); for (const [corner, [x, y]] of [[width / 4, height / 4], [width * .75, height / 4], [width / 4, height * .75], [width * .75, height * .75]].entries()) closeRgb(rgbAt(stream, Math.floor(x), Math.floor(y)), corners[index][corner]); expect(Math.max(doc.getPage(index).getWidth(), doc.getPage(index).getHeight())).toBe(842); }
  const alphaImage = embedded(doc, 4), alpha = doc.context.lookup(alphaImage.dict.get(pdfLib.PDFName.of('SMask'))); expect(alpha).toBeTruthy(); const alphaBytes = pdfLib.decodePDFRawStream(alpha).decode(); expect(alphaBytes[30 * 80 + 60]).toBeGreaterThanOrEqual(127); expect(alphaBytes[30 * 80 + 60]).toBeLessThanOrEqual(128);
  await page.locator('[data-choose-image]').nth(4).click(); await page.locator('[data-choose-image]').nth(4).press('Alt+ArrowUp'); await expect(page.locator('[data-choose-image]').nth(3)).toContainText('transparent.png'); await page.click('#composerRotateBtn'); await page.selectOption('#composerPaper', 'letter'); await page.selectOption('#composerOrientation', 'landscape'); await page.locator('#composerMargin').fill('36'); await page.selectOption('#composerFit', 'fill');
  await expect(page.locator('#composerPreviewCanvas')).toHaveAttribute('data-pdf-page', '4'); const composed = await saved(page, testInfo, route, `${route}-ordered-letter.pdf`), ordered = await pdfLib.PDFDocument.load(composed); expect(ordered.getPages().map((value) => value.getSize())).toEqual(Array(5).fill({ width: 792, height: 612 })); expect(embedded(ordered, 3).dict.has(pdfLib.PDFName.of('SMask'))).toBe(true); await samePreview(page, composed, 3);
  const before = await task(page); expect(before.current.type).toBe('image/jpeg'); expect(before.state.originalImageCount).toBe(5);
  await page.click('#useResultBtn'); const chosen = await task(page); expect(chosen.state.taskId).toBe(before.state.taskId); expect(chosen.current.type).toBe('application/pdf'); expect(chosen.original.bytes).toEqual(before.original.bytes); expect(chosen.composition).toEqual(before.composition);
  const repeated = await saved(page, testInfo, route, `${route}-idempotent.pdf`); expect(repeated).toEqual(composed);
  await Promise.all([page.waitForURL(/workflow=/), taskAction(page, '#composerOtherEntryBtn')]); const other = route === 'images' ? 'jpg-to-pdf' : 'images'; await readyComposer(page, other, 4); const restored = await task(page); expect(restored.state.taskId).toBe(chosen.state.taskId); expect(restored.composition).toEqual(chosen.composition); expect(restored.state.originalImageCount).toBe(5); const retained = await saved(page, testInfo, other, `${route}-retained.pdf`); expect(retained).toEqual(composed);
  await page.selectOption('#composerPaper', 'a4'); await expect(page.locator(actionFor(other))).toBeEnabled(); await taskAction(page, '#composerUndoBtn'); await expect(page.locator('#composerPaper')).toHaveValue('letter'); await expect(page.locator(actionFor(other))).toBeEnabled(); expect(errors).toEqual([]);
});

test('held normalization drains across Clear; invalid intake preserves the good chosen task and fresh artifact', async ({ page }, testInfo) => {
  await open(page, 'jpg-to-pdf'); await page.evaluate(() => { const original = window.createImageBitmap; window.imageHeld = false; window.imageReserved = false; window.imageHold = new Promise((resolve) => { window.releaseImage = resolve; }); window.createImageBitmap = async (...args) => { const bitmap = await original(...args); if (!window.imageReserved) { window.imageReserved = true; window.imageHeld = true; await window.imageHold; } return bitmap; }; });
  await choose(page, '#fileInput', image('abandoned-red.png')); await expect.poll(() => page.evaluate(() => window.imageHeld)).toBe(true); await taskAction(page, '#composerClearBtn'); await choose(page, '#fileInput', image('fresh-blue.png', 'blue')); await expect(page.locator('#createBtn')).toBeDisabled(); await page.evaluate(() => window.releaseImage());
  const bytes = await saved(page, testInfo, 'jpg-to-pdf', 'fresh-after-drained-normalization.pdf'), doc = await pdfLib.PDFDocument.load(bytes); closeRgb(rgbAt(embedded(doc, 0), 10, 10), [0, 0, 255]); const before = await task(page); expect(before.state.originalImageCount).toBe(1);
  await choose(page, '#fileInput', { name: 'invalid-image.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') }); await expect(page.locator('#errorText')).toContainText('invalid-image.png'); await expect(page.locator('#createBtn')).toBeEnabled(); expect((await task(page)).composition).toEqual(before.composition); expect((await task(page)).original.bytes).toEqual(before.original.bytes);
  await page.locator('[data-choose-image]').first().focus(); await page.locator('[data-choose-image]').first().press('Delete'); await expect(page.locator('#composerImageList li')).toHaveCount(0); await expect(page.locator('#createBtn')).toBeDisabled(); await taskAction(page, '#composerUndoBtn'); await expect(page.locator('#createBtn')).toBeEnabled(); const recovered = await saved(page, testInfo, 'jpg-to-pdf', 'undo-restored-image.pdf'); expect(recovered).toEqual(bytes);
});

async function pdfFixture(count, prefix = 'PAGE') { const doc = await pdfLib.PDFDocument.create(); for (let index = 0; index < count; index++) { const page = doc.addPage([96, 72]); page.drawRectangle({ x: 0, y: 0, width: 96, height: 72, color: pdfLib.rgb(index / Math.max(1, count - 1), 0, 1 - index / Math.max(1, count - 1)) }); } doc.setTitle(prefix); return new Uint8Array(await doc.save()); }
function unzip(bytes) { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = []; let offset = 0; while (view.getUint32(offset, true) === 0x04034b50) { const size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true), start = offset + 30 + nameLength + extra; result.push({ name: new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength)), bytes: bytes.subarray(start, start + size) }); offset = start + size; } return result; }
test('PDF images lists all25 outputs and ZIP, then continues exactly the chosen image in the same PDF task', async ({ page }, testInfo) => {
  const source = await pdfFixture(25); await open(page, 'images'); await page.click('#modePdfToImg'); await choose(page, '#pdfFileInput', { name: 'twenty-five.pdf', mimeType: 'application/pdf', buffer: Buffer.from(source) }); await expect(page.locator('#exportImagesBtn')).toBeEnabled(); const before = await task(page); await expect(page.locator('#pdfImageSelection canvas')).toHaveCount(12); await expect(page.locator('#pdfImagesEstimate')).toContainText('25 files'); await page.click('#exportImagesBtn'); await expect(page.locator('#outputListStatus')).toContainText('25 files'); await expect(page.locator('#outputList li')).toHaveCount(12); await page.click('#outputNextBtn'); await page.click('#outputNextBtn'); await expect(page.locator('#outputList li')).toHaveCount(1); await page.click('[data-output-index="24"]'); await expect(page.locator('#documentResultIdentity')).toContainText('page-25.png');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadZipBtn')]); await download.saveAs(testInfo.outputPath('all25-images.zip')); const entries = unzip(new Uint8Array(await readFile(testInfo.outputPath('all25-images.zip')))); expect(entries).toHaveLength(25);
  for (const [index, entry] of entries.entries()) { expect(entry.name).toBe(`twenty-five-page-${index + 1}.png`); const image = await loadImage(entry.bytes), canvas = createCanvas(image.width, image.height); canvas.getContext('2d').drawImage(image, 0, 0); expect([image.width, image.height]).toEqual([192, 144]); closeRgb([...canvas.getContext('2d').getImageData(80, 50, 1, 1).data].slice(0, 3), [Math.round(index / 24 * 255), 0, Math.round((1 - index / 24) * 255)]); }
  expect((await task(page)).current.bytes).toEqual(before.current.bytes); await Promise.all([page.waitForURL(/\/jpg-to-pdf\?workflow=/), page.locator('#chainRow').getByRole('button', { name: /JPG/ }).click()]); await readyComposer(page, 'jpg-to-pdf', 1); const chosen = await task(page); expect(chosen.state.taskId).toBe(before.state.taskId); expect(chosen.original.bytes).toEqual(before.original.bytes); expect(chosen.current.bytes).toEqual([...entries[24].bytes]); const pdf = await saved(page, testInfo, 'jpg-to-pdf', 'chosen-page25-composed.pdf'), doc = await pdfLib.PDFDocument.load(pdf); expect(doc.getPageCount()).toBe(1); closeRgb(rgbAt(embedded(doc, 0), 80, 50), [255, 0, 0]);
});

test('held image encoding Cancel and replacement cannot publish stale outputs', async ({ page }, testInfo) => {
  await open(page, 'images'); await page.click('#modePdfToImg'); const first = await pdfFixture(3); await choose(page, '#pdfFileInput', { name: 'old.pdf', mimeType: 'application/pdf', buffer: Buffer.from(first) }); await expect(page.locator('#exportImagesBtn')).toBeEnabled();
  await page.evaluate(() => { const original = HTMLCanvasElement.prototype.toBlob; window.encodingHeld = false; window.encodingReserved = false; window.encodingHold = new Promise((resolve) => { window.releaseEncoding = resolve; }); HTMLCanvasElement.prototype.toBlob = function(callback, ...args) { return original.call(this, async (blob) => { if (!window.encodingReserved) { window.encodingReserved = true; window.encodingHeld = true; await window.encodingHold; } callback(blob); }, ...args); }; });
  await page.click('#exportImagesBtn'); await expect.poll(() => page.evaluate(() => window.encodingHeld)).toBe(true); await page.click('#cancelImageExportBtn'); const replacement = await pdfFixture(2, 'REPLACEMENT'); await choose(page, '#pdfFileInput', { name: 'replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from(replacement) }); await expect.poll(async () => (await task(page)).current.name).toBe('replacement.pdf'); await page.evaluate(() => window.releaseEncoding()); await expect(page.locator('#exportImagesBtn')).toBeEnabled(); await page.click('#exportImagesBtn'); await expect(page.locator('#outputListStatus')).toContainText('2 files'); await expect(page.locator('#documentResultIdentity')).toContainText('replacement-page-1.png'); expect((await task(page)).current.bytes).toEqual([...replacement]); await expect(page.locator('#pageOutputGroup')).toHaveCount(1);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadZipBtn')]); await download.saveAs(testInfo.outputPath('replacement-images.zip')); expect(unzip(new Uint8Array(await readFile(testInfo.outputPath('replacement-images.zip')))).map((entry) => entry.name)).toEqual(['replacement-page-1.png', 'replacement-page-2.png']);
});

test('held actual PDF preview cannot repaint Clear or replace a newer chosen image', async ({ page }, testInfo) => {
  await open(page, 'jpg-to-pdf'); await choose(page, '#fileInput', image('first-red.png')); await expect(page.locator('#createBtn')).toBeEnabled();
  await page.evaluate(async () => { const runtime = await import('/js/lib-loader.js'), pdfjs = await runtime.ensurePdfJs(), session = (await import('/js/tool-ui.js')).documentSession; const lib = await runtime.ensurePdfLib(), doc = await lib.PDFDocument.create(); doc.addPage([100,100]); const task = pdfjs.getDocument({ data: await doc.save(), ...runtime.PDFJS_ASSET_URLS }), proxy = await task.promise, prototype = Object.getPrototypeOf(await proxy.getPage(1)); await task.destroy(); const original = prototype.render; window.previewHeld = false; window.previewReserved = false; window.previewArmed = false; window.previewHold = new Promise((resolve) => { window.releasePreview = resolve; }); document.getElementById('composerRotateBtn').addEventListener('click', () => { window.previewArmed = true; }, { once:true }); prototype.render = function(options) { const rendered = original.call(this, options), target = options.canvasContext?.canvas; if (window.previewArmed && !window.previewReserved && target?.dataset.composerPreview === session.composition()?.selectedId && document.getElementById('composerPreviewCanvas')) { window.previewReserved = true; return { cancel: () => rendered.cancel(), promise: rendered.promise.then(async () => { window.previewGeometry = [target.width,target.height]; window.previewHeld = true; await window.previewHold; window.previewReleased = true; }) }; } return rendered; }; });
  await page.click('#composerRotateBtn'); await expect.poll(() => page.evaluate(() => window.previewHeld)).toBe(true); expect(await page.evaluate(() => window.previewGeometry)).toEqual([421,842]); await taskAction(page, '#composerClearBtn'); expect(await page.locator('#composerPreviewCanvas').evaluate((canvas) => [canvas.width,canvas.height])).toEqual([0,0]); await choose(page, '#fileInput', image('new-blue.png', 'blue')); await expect(page.locator('#createBtn')).toBeDisabled(); await page.evaluate(() => window.releasePreview()); await expect.poll(() => page.evaluate(() => window.previewReleased)).toBe(true);
  const bytes = await saved(page, testInfo, 'jpg-to-pdf', 'fresh-after-held-preview-clear.pdf'), doc = await pdfLib.PDFDocument.load(bytes); expect(doc.getPageCount()).toBe(1); closeRgb(rgbAt(embedded(doc, 0), 10, 10), [0, 0, 255]); await samePreview(page, bytes, 0); expect((await task(page)).state.originalImageCount).toBe(1);
});

test('mixed-mode held PDF intake loses to Clear and a fresh image artifact before its read finishes', async ({ page }, testInfo) => {
  await open(page, 'images'); await choose(page, '#imgFileInput', image('retained-red.png')); await expect(page.locator('#createPdfBtn')).toBeEnabled();
  await page.evaluate(() => { const original = File.prototype.arrayBuffer; window.pdfReadHeld = false; window.pdfReadHold = new Promise((resolve) => { window.releasePdfRead = resolve; }); File.prototype.arrayBuffer = async function() { if (this.name === 'pending.pdf') { window.pdfReadHeld = true; await window.pdfReadHold; } return original.call(this); }; });
  await page.click('#modePdfToImg'); const pending = await pdfFixture(2); await choose(page, '#pdfFileInput', { name: 'pending.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pending) }); await expect.poll(() => page.evaluate(() => window.pdfReadHeld)).toBe(true); await page.click('#modeImgToPdf'); await taskAction(page, '#composerClearBtn'); await choose(page, '#imgFileInput', image('chosen-blue.png', 'blue'));
  const bytes = await saved(page, testInfo, 'images', 'fresh-before-old-pdf-read-release.pdf'), doc = await pdfLib.PDFDocument.load(bytes); closeRgb(rgbAt(embedded(doc, 0), 10, 10), [0,0,255]); const before = await task(page); await page.evaluate(() => window.releasePdfRead()); await expect(page.locator('#createPdfBtn')).toBeEnabled(); const after = await task(page); expect(after.state.taskId).toBe(before.state.taskId); expect(after.current.bytes).toEqual(before.current.bytes); expect(after.composition).toEqual(before.composition); await expect(page.locator('#documentResultIdentity')).toContainText('images.pdf');
});

test('loaded composer filenames and controls remain visible at320/390/768/1440 in English light and Arabic dark', async ({ page }, testInfo) => {
  const filename = 'meaningful-long-original-name-'.repeat(4) + '.png';
  for (const locale of ['en', 'ar']) {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.addInitScript((locale) => { localStorage.setItem('bpdf-consent', 'rejected'); localStorage.setItem('pdf2md-theme', locale === 'ar' ? 'dark' : 'light'); }, locale);
    await page.goto(locale === 'en' ? '/jpg-to-pdf' : '/ar/jpg-to-pdf'); await choose(page, '#fileInput', image(filename)); await expect(page.locator('#createBtn')).toBeEnabled();
    const natural = await page.locator('#composerPreviewCanvas').evaluate((canvas) => { const rect = canvas.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height, viewport: innerHeight }; }); expect(natural.height).toBeGreaterThan(60); expect(natural.top).toBeGreaterThanOrEqual(0); expect(natural.bottom).toBeLessThanOrEqual(natural.viewport); await page.screenshot({ path: testInfo.outputPath(`${locale}-natural-320x720.png`) });
    for (const width of [320,390,768,1440]) { await page.setViewportSize({ width, height: 900 }); await expect(page.locator('[data-choose-image]')).toHaveAttribute('title', filename); await expect(page.locator('#createBtn')).toBeVisible(); const bounds = await page.locator('#imageComposer').evaluate((root) => { const rect = root.getBoundingClientRect(); return { left: rect.left, right: rect.right, scroll: document.documentElement.scrollWidth, width: innerWidth, canvas: [...root.querySelectorAll('canvas')].map((canvas) => [canvas.width,canvas.height]) }; }); expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width + 1); expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1); expect(bounds.canvas.length).toBeLessThanOrEqual(13); for (const [w,h] of bounds.canvas) { expect(w).toBeLessThanOrEqual(1200); expect(h).toBeLessThanOrEqual(1200); expect(w*h).toBeLessThanOrEqual(2_000_000); } await page.screenshot({ path: testInfo.outputPath(`${locale}-${width}.png`) }); }
  }
});

test('identical bytes retain distinct full input filenames through order, Remove, Undo and saved PDF deduplication', async ({ page }, testInfo) => {
  await open(page, 'jpg-to-pdf'); const first = image('shared-prefix-'.repeat(13) + 'A.png'), second = { ...first, name: 'shared-prefix-'.repeat(13) + 'B.png' };
  await choose(page, '#fileInput', [first, second]); await expect(page.locator('#createBtn')).toBeEnabled(); await expect(page.locator('[data-choose-image]').nth(0)).toHaveAttribute('title', first.name); await expect(page.locator('[data-choose-image]').nth(1)).toHaveAttribute('title', second.name); expect((await task(page)).state.originalImageCount).toBe(1);
  await page.locator('[data-choose-image]').nth(1).focus(); await page.locator('[data-choose-image]').nth(1).press('Alt+ArrowUp'); await expect(page.locator('[data-choose-image]').nth(0)).toHaveAttribute('title', second.name); await page.locator('[data-choose-image]').nth(0).press('Delete'); await expect(page.locator('[data-choose-image]')).toHaveAttribute('title', first.name); await taskAction(page, '#composerUndoBtn'); await expect(page.locator('[data-choose-image]').nth(0)).toHaveAttribute('title', second.name);
  const bytes = await saved(page, testInfo, 'jpg-to-pdf', 'distinct-names-shared-bytes.pdf'), doc = await pdfLib.PDFDocument.load(bytes); expect(doc.getPageCount()).toBe(2); expect(embedded(doc, 0)).toBe(embedded(doc, 1));
});

test('an actual oversized chosen PNG retains visible Undo/Clear and a usable original PDF mode', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const canvas = createCanvas(4096, 2048), ctx = canvas.getContext('2d'), pixels = ctx.createImageData(4096, 2048); let seed = 0x13579bdf;
  for (let index = 0; index < pixels.data.length; index += 4) { for (let channel = 0; channel < 3; channel++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels.data[index + channel] = seed >>> 24; } pixels.data[index + 3] = 255; }
  ctx.putImageData(pixels, 0, 0); const png = canvas.toBuffer('image/png'); expect(png.length).toBeGreaterThan(16 * 1024 * 1024);
  const doc = await pdfLib.PDFDocument.create(), embeddedImage = await doc.embedPng(png); doc.addPage([2048, 1024]).drawImage(embeddedImage, { x: 0, y: 0, width: 2048, height: 1024 }); const source = await doc.save();
  await open(page, 'images'); await page.click('#modePdfToImg'); await choose(page, '#pdfFileInput', { name: 'retained-noise-original.pdf', mimeType: 'application/pdf', buffer: Buffer.from(source) }); await expect(page.locator('#exportImagesBtn')).toBeEnabled();
  const original = await page.evaluate(async () => { const session = (await import('/js/tool-ui.js')).documentSession; return { taskId: session.snapshot().taskId, hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', session.original().bytes))].map((value) => value.toString(16).padStart(2,'0')).join('') }; });
  await page.click('#exportImagesBtn'); await expect(page.locator('#outputListStatus')).toContainText('1 files'); await expect(page.locator('#documentResultStatus')).toContainText('actual file'); const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); await download.saveAs(testInfo.outputPath('actual-oversized-selected.png')); const actual = new Uint8Array(await readFile(testInfo.outputPath('actual-oversized-selected.png'))); expect(actual.length).toBeGreaterThan(16 * 1024 * 1024); const reopened = await loadImage(actual); expect([reopened.width,reopened.height]).toEqual([4096,2048]);
  await page.click('#useResultBtn'); await expect(page.locator('#errorText')).toContainText('16 MiB'); await expect(page.locator('#imageComposer')).toBeVisible(); await taskAction(page, '#composerUndoBtn'); await expect(page.locator('#composerClearBtn')).toBeEnabled(); await expect(page.locator('#composerOpenPdfBtn')).toBeVisible();
  const retained = await page.evaluate(async () => { const session = (await import('/js/tool-ui.js')).documentSession; return { taskId: session.snapshot().taskId, type: session.snapshot().current.type, hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', session.original().bytes))].map((value) => value.toString(16).padStart(2,'0')).join('') }; }); expect(retained.taskId).toBe(original.taskId); expect(retained.hash).toBe(original.hash); expect(retained.type).toBe('application/pdf');
  await Promise.all([page.waitForURL(/\/add-text\?workflow=/), page.click('#composerOpenPdfBtn')]); await expect(page.locator('#objectWorkspace')).toBeVisible(); await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy','false');
});

test('held selected-image decoder drains before queued native composer intake and releases stale publication', async ({ page }, testInfo) => {
  await open(page, 'images'); await page.click('#modePdfToImg'); const source = await pdfFixture(2); await choose(page, '#pdfFileInput', { name: 'decoder-source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(source) }); await expect(page.locator('#exportImagesBtn')).toBeEnabled();
  await page.evaluate(() => { const original = window.createImageBitmap; window.decodeHeld = false; window.decodeReserved = false; window.decodeEvents = []; window.activeDecoders = 0; window.maxDecoders = 0; window.decoderHold = new Promise((resolve) => { window.releaseDecoder = resolve; }); window.createImageBitmap = async (...args) => { const id = window.decodeEvents.filter((value) => value.kind === 'start').length; window.decodeEvents.push({ kind:'start', id }); window.activeDecoders++; window.maxDecoders = Math.max(window.maxDecoders,window.activeDecoders); try { const bitmap = await original(...args); if (!window.decodeReserved) { window.decodeReserved = true; window.decodeHeld = true; await window.decoderHold; } return bitmap; } finally { window.activeDecoders--; window.decodeEvents.push({kind:'end',id}); } }; document.getElementById('imgFileInput').addEventListener('change', () => { window.freshImageChosen = true; }); });
  await page.click('#exportImagesBtn'); await expect.poll(() => page.evaluate(() => window.decodeHeld)).toBe(true); await page.click('#modeImgToPdf'); await expect(page.locator('#imageTransitionStatus')).toBeVisible(); const fresh = image('fresh-blue-after-decoder.png','blue'); await choose(page, '#imgFileInput', fresh); await expect.poll(() => page.evaluate(() => window.freshImageChosen)).toBe(true); await expect(page.locator('#imageTransitionStatus')).toBeVisible();
  await page.evaluate(() => window.releaseDecoder()); const bytes = await saved(page, testInfo, 'images', 'fresh-after-selected-decoder-drain.pdf'), doc = await pdfLib.PDFDocument.load(bytes), imageObject = embedded(doc,0); expect(doc.getPageCount()).toBe(1); expect(imageObject.dict.lookup(pdfLib.PDFName.of('Width')).asNumber()).toBe(80); expect(imageObject.dict.lookup(pdfLib.PDFName.of('Height')).asNumber()).toBe(40); closeRgb(rgbAt(imageObject,10,10),[0,0,255]); closeRgb(rgbAt(imageObject,60,30),[255,255,0]); expect((await task(page)).original.bytes).toEqual([...fresh.buffer]);
  const evidence = await page.evaluate(() => ({ events:window.decodeEvents,max:window.maxDecoders })); expect(evidence.max).toBe(1); expect(evidence.events.filter((value) => value.kind === 'start').length).toBeGreaterThanOrEqual(3); expect(evidence.events.findIndex((value) => value.kind === 'end' && value.id === 0)).toBeLessThan(evidence.events.findIndex((value) => value.kind === 'start' && value.id === 1)); await expect(page.locator('#imageTransitionStatus')).toHaveCount(0); await expect(page.locator('#pageOutputGroup')).toHaveCount(0); await samePreview(page,bytes,0);
});


async function observeNativeContinuation(page) {
  await page.addInitScript(() => {
    window.chosenContinuationSettled = 0;
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (type !== 'click' || typeof listener !== 'function') return add.call(this,type,listener,options);
      return add.call(this,type,function(event) {
        const chain = this instanceof Element && this.closest('#chainRow'), result = listener.call(this,event);
        if (chain && result && typeof result.then === 'function') Promise.resolve(result).then(() => { window.chosenContinuationSettled++; }, () => { window.chosenContinuationSettled++; });
        return result;
      },options);
    };
  });
}
async function chosenExport(page, testInfo, label) {
  await observeNativeContinuation(page); await open(page,'images'); await page.click('#modePdfToImg');
  const source = await pdfFixture(2,label); await choose(page,'#pdfFileInput',{ name:label+'.pdf',mimeType:'application/pdf',buffer:Buffer.from(source) });
  await expect(page.locator('#exportImagesBtn')).toBeEnabled(); const before = await task(page);
  await page.click('#exportImagesBtn'); await expect(page.locator('#outputListStatus')).toContainText('2 files'); await page.click('[data-output-index="1"]');
  await expect(page.locator('#documentResultIdentity')).toContainText('page-2.png'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  const [download] = await Promise.all([page.waitForEvent('download'),page.click('#downloadResultBtn')]); await download.saveAs(testInfo.outputPath(label+'-chosen.png'));
  const bytes = new Uint8Array(await readFile(testInfo.outputPath(label+'-chosen.png'))), bitmap = await loadImage(bytes), canvas = createCanvas(bitmap.width,bitmap.height); canvas.getContext('2d').drawImage(bitmap,0,0);
  expect([bitmap.width,bitmap.height]).toEqual([192,144]); closeRgb([...canvas.getContext('2d').getImageData(80,50,1,1).data].slice(0,3),[255,0,0]);
  return { before,bytes };
}
const chosenContinue = (page) => page.locator('#chainRow').getByRole('button',{ name:/JPG/ });
async function failChosenBundleOnce(page) {
  await page.evaluate(() => {
    const native = IDBDatabase.prototype.transaction; let writes = 0;
    IDBDatabase.prototype.transaction = function(names,mode,...options) {
      const stores = typeof names === 'string' ? [names] : [...names];
      if (this.name === 'browserpdf-workflows' && mode === 'readwrite' && stores.includes('workflows') && stores.includes('files')) {
        window.chosenBundleWrites = ++writes;
        if (writes === 2) { window.chosenBundleFailed = true; throw new DOMException('Chosen image bundle quota test','QuotaExceededError'); }
      }
      return native.call(this,names,mode,...options);
    };
    window.restoreChosenStorage = () => { IDBDatabase.prototype.transaction = native; };
  });
}
async function holdChosenTransaction(page, target) {
  await page.evaluate((target) => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete'); let count = 0;
    if (!descriptor?.set || !descriptor.get) throw new Error('Native transaction completion descriptor is unavailable.');
    Object.defineProperty(IDBTransaction.prototype,'oncomplete',{ configurable:true,enumerable:descriptor.enumerable,get:descriptor.get,set(handler) {
      const tx = this, stores = [...tx.objectStoreNames], eligible = tx.db.name === 'browserpdf-workflows' && tx.mode === 'readwrite' && stores.includes('workflows') && stores.includes('files');
      if (eligible && ++count === target) descriptor.set.call(tx,function(event) { window.chosenTransactionHeld = { count,completedNativeTransaction:true }; window.releaseChosenTransaction = () => handler.call(tx,event); });
      else descriptor.set.call(tx,handler);
    } });
    window.restoreChosenTransaction = () => Object.defineProperty(IDBTransaction.prototype,'oncomplete',descriptor);
  },target);
}

for (const outcome of ['retry','newer same-task edit']) test(`chosen PNG post-adoption storage failure preserves exact ${outcome} ownership`,async ({ page },testInfo) => {
  const { before,bytes } = await chosenExport(page,testInfo,'typed-storage'); await failChosenBundleOnce(page); await chosenContinue(page).click();
  await expect.poll(() => page.evaluate(() => window.chosenContinuationSettled)).toBe(1); await expect(page.locator('#errorText')).toContainText('Chosen image bundle quota test');
  expect(await page.evaluate(() => window.chosenBundleFailed)).toBe(true); const adopted = await task(page); expect(adopted.current.type).toBe('image/png'); expect(adopted.current.bytes).toEqual([...bytes]); expect(adopted.state.taskId).toBe(before.state.taskId); expect(adopted.original.bytes).toEqual(before.original.bytes); await expect(chosenContinue(page)).toBeEnabled();
  await page.evaluate(() => window.restoreChosenStorage());
  if (outcome === 'retry') {
    await Promise.all([page.waitForURL(/\/jpg-to-pdf\?workflow=/),chosenContinue(page).click()]); await readyComposer(page,'jpg-to-pdf',1);
    const restored = await task(page); expect(restored.state.taskId).toBe(before.state.taskId); expect(restored.original.bytes).toEqual(before.original.bytes); expect(restored.current.bytes).toEqual([...bytes]);
    const actual = await saved(page,testInfo,'jpg-to-pdf','typed-retry-chosen-page2.pdf'), doc = await pdfLib.PDFDocument.load(actual); expect(doc.getPageCount()).toBe(1); closeRgb(rgbAt(embedded(doc,0),80,50),[255,0,0]); await samePreview(page,actual,0);
  } else {
    const newer = await pdfFixture(3,'NEWER SAME TASK'); await page.evaluate(async (values) => { const ui = await import('/js/tool-ui.js'); ui.documentSession.adopt(new Uint8Array(values),'newer-same-task.pdf',{ type:'application/pdf' }); ui.showDocumentIdentity(); },[...newer]);
    const expected = await task(page); expect(expected.state.taskId).toBe(before.state.taskId); expect(expected.current.bytes).toEqual([...newer]);
    await chosenContinue(page).click(); await expect.poll(() => page.evaluate(() => window.chosenContinuationSettled)).toBe(2);
    expect(page.url()).toMatch(/\/images$/); expect(await task(page)).toEqual(expected); expect(await page.evaluate(() => window.chosenBundleWrites)).toBe(2);
    const uiBytes = await page.evaluate(async () => [...(await import('/js/tool-ui.js')).documentSession.current().bytes]); const reopened = await pdfLib.PDFDocument.load(new Uint8Array(uiBytes)); expect(reopened.getPageCount()).toBe(3);
  }
});

test('held chosen-image cleanup loses to a natively reviewed sibling and its exact fresh continuation',async ({ page },testInfo) => {
  const { before } = await chosenExport(page,testInfo,'typed-sibling'); await holdChosenTransaction(page,1); await chosenContinue(page).click();
  await expect.poll(() => page.evaluate(() => !!window.chosenTransactionHeld?.completedNativeTransaction)).toBe(true); expect((await task(page)).current.bytes).toEqual(before.current.bytes);
  await page.click('[data-output-index="0"]'); await expect(page.locator('#documentResultIdentity')).toContainText('page-1.png'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  const [download] = await Promise.all([page.waitForEvent('download'),page.click('#downloadResultBtn')]); await download.saveAs(testInfo.outputPath('sibling-page1.png')); const chosen = new Uint8Array(await readFile(testInfo.outputPath('sibling-page1.png')));
  await page.evaluate(() => window.releaseChosenTransaction()); await expect.poll(() => page.evaluate(() => window.chosenContinuationSettled)).toBe(1); expect(page.url()).toMatch(/\/images$/); expect((await task(page)).current.bytes).toEqual(before.current.bytes);
  await page.evaluate(() => window.restoreChosenTransaction()); await Promise.all([page.waitForURL(/\/jpg-to-pdf\?workflow=/),chosenContinue(page).click()]); await readyComposer(page,'jpg-to-pdf',1);
  const restored = await task(page); expect(restored.state.taskId).toBe(before.state.taskId); expect(restored.current.bytes).toEqual([...chosen]); expect(restored.original.bytes).toEqual(before.original.bytes);
  const actual = await saved(page,testInfo,'jpg-to-pdf','fresh-sibling-page1.pdf'), doc = await pdfLib.PDFDocument.load(actual); expect(doc.getPageCount()).toBe(1); closeRgb(rgbAt(embedded(doc,0),80,50),[0,0,255]); await samePreview(page,actual,0);
});

for (const replacement of ['Clear','new PDF B']) test(`held adopted-image bundle cannot navigate after ${replacement}`,async ({ page },testInfo) => {
  const { before,bytes } = await chosenExport(page,testInfo,'typed-replacement'); await holdChosenTransaction(page,2); await chosenContinue(page).click();
  await expect.poll(() => page.evaluate(() => !!window.chosenTransactionHeld?.completedNativeTransaction)).toBe(true); const adopted = await task(page); expect(adopted.current.bytes).toEqual([...bytes]); expect(adopted.state.taskId).toBe(before.state.taskId);
  let expected;
  if (replacement === 'Clear') {
    await page.click('#modeImgToPdf'); await readyComposer(page,'images',1); await taskAction(page,'#composerClearBtn'); expect((await task(page)).current).toBeNull();
    const fresh = image('fresh-after-chosen-Clear.png','blue'); await choose(page,'#imgFileInput',fresh); const actual = await saved(page,testInfo,'images','fresh-after-chosen-clear.pdf'), doc = await pdfLib.PDFDocument.load(actual); closeRgb(rgbAt(embedded(doc,0),10,10),[0,0,255]); await samePreview(page,actual,0); expected = await task(page); expect(expected.original.bytes).toEqual([...fresh.buffer]);
  } else {
    const source = await pdfFixture(3,'FRESH B'); await choose(page,'#pdfFileInput',{ name:'fresh-B.pdf',mimeType:'application/pdf',buffer:Buffer.from(source) }); await expect(page.locator('#documentIdentity')).toContainText('fresh-B.pdf'); await expect(page.locator('#pdfImagesEstimate')).toContainText('3 files'); await expect(page.locator('#pdfImagesWorkspace')).toHaveAttribute('aria-busy','false'); await expect(page.locator('#pdfImagesWorkspace #exportImagesBtn')).toBeEnabled(); expected = await task(page); expect(expected.current.bytes).toEqual([...source]); expect(expected.original.bytes).toEqual([...source]);
    await page.click('#exportImagesBtn'); await expect(page.locator('#outputListStatus')).toContainText('3 files'); await expect(page.locator('#documentResultIdentity')).toContainText('fresh-B-page-1.png'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
    const [download] = await Promise.all([page.waitForEvent('download'),page.click('#downloadResultBtn')]); await download.saveAs(testInfo.outputPath('fresh-B-page1.png')); const bitmap = await loadImage(await readFile(testInfo.outputPath('fresh-B-page1.png'))), canvas = createCanvas(bitmap.width,bitmap.height); canvas.getContext('2d').drawImage(bitmap,0,0); expect([bitmap.width,bitmap.height]).toEqual([192,144]); closeRgb([...canvas.getContext('2d').getImageData(80,50,1,1).data].slice(0,3),[0,0,255]);
  }
  expect(expected.state.taskId).not.toBe(before.state.taskId); await page.evaluate(() => window.releaseChosenTransaction()); await expect.poll(() => page.evaluate(() => window.chosenContinuationSettled)).toBe(1);
  expect(page.url()).toMatch(/\/images$/); expect(await task(page)).toEqual(expected); await page.evaluate(() => window.restoreChosenTransaction());
});
