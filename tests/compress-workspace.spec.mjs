import { test, expect } from '@playwright/test';
import * as pdfLib from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture({ raw = true, pages = 1, name = 'Structural.pdf', label = 'STRUCTURAL RETAIN', size = [560, 725], rotation = 0, crop } = {}) {
  const doc = await pdfLib.PDFDocument.create({ updateMetadata: false }); doc.setTitle('Portable route title');
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  for (let index = 0; index < pages; index++) {
    const page = doc.addPage(size);
    if (rotation) page.setRotation(pdfLib.degrees(rotation));
    if (crop) page.setCropBox(...crop);
    page.drawText(`${label} PAGE ${index + 1}`, { x: 40, y: 640, font, size: 16 });
    if (raw) page.node.addContentStream(doc.context.register(doc.context.stream('q\n0.2 w\n' + '40 120 m 180 120 l S\n'.repeat(2400) + 'Q\n')));
  }
  const form = doc.getForm(), field = form.createTextField('portable-field'), check = form.createCheckBox('portable-check');
  field.setText('RETAINED VALUE'); field.addToPage(doc.getPage(0), { x: 40, y: 450, width: 180, height: 24 });
  check.addToPage(doc.getPage(0), { x: 40, y: 400, width: 20, height: 20 }); check.check(); form.updateFieldAppearances(font);
  doc.getPage(0).node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 300, 220, 320], A: { S: 'URI', URI: pdfLib.PDFString.of('https://example.invalid/compress-route') } })));
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save({ useObjectStreams: !raw, updateFieldAppearances: false })) };
}
function observe(page) { const errors = [], downloads = [], nonGet = []; page.on('pageerror', (error) => errors.push(error.message)); page.on('download', (value) => downloads.push(value.suggestedFilename())); page.on('request', (request) => { if (request.method() !== 'GET') nonGet.push(request.url()); }); return { errors, downloads, nonGet }; }
async function ready(page) { await expect(page.locator('#compressionSourceCanvas')).toHaveAttribute('data-pdf-page', '1'); await expect(page.locator('#compressBtn')).toBeEnabled(); }
async function reviewed(page) { await expect(page.locator('#compressionResultHost')).toBeVisible(); await expect(page.locator('#documentResultPreview')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#documentResult canvas')).toHaveAttribute('data-pdf-page', '1'); }
async function state(page) { return page.evaluate(async () => {
  const ui = await import('/js/tool-ui.js'), digest = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2, '0')).join('');
  return { snapshot: ui.documentSession.snapshot(), current: await digest(ui.documentSession.current().bytes), original: await digest(ui.documentSession.original().bytes) };
}); }
async function saved(page, testInfo, filename) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); const path = testInfo.outputPath(filename); await download.saveAs(path); return { bytes: await readFile(path), path, name: download.suggestedFilename() };
}

test('structural route reviews actual reduction, keeps fields/link/text/pixels and adopts only on native Use', async ({ page }, testInfo) => {
  const observed = observe(page), source = await fixture(); await page.goto('/compress'); await page.setInputFiles('#fileInput', source); await ready(page);
  const before = await state(page), sourcePng = await page.locator('#compressionSourceCanvas').evaluate((canvas) => canvas.toDataURL());
  await page.click('#compressBtn'); await reviewed(page); expect(observed.downloads).toEqual([]);
  expect((await state(page)).current).toBe(before.current); await expect(page.locator('#chainRow')).toHaveCount(0);
  expect(await page.locator('#documentResult canvas').evaluate((canvas) => canvas.toDataURL())).toBe(sourcePng);
  const result = await saved(page, testInfo, 'structural-actual.pdf'); expect(result.bytes.length).toBeLessThan(source.buffer.length); expect(result.name).toBe('Structural-optimized.pdf');
  const doc = await pdfLib.PDFDocument.load(result.bytes, { updateMetadata: false, throwOnInvalidObject: true });
  expect(doc.getTitle()).toBe('Portable route title'); expect(doc.getPageCount()).toBe(1); expect(doc.getForm().getTextField('portable-field').getText()).toBe('RETAINED VALUE'); expect(doc.getForm().getCheckBox('portable-check').isChecked()).toBe(true);
  const text = await page.evaluate(async (bytes) => {
    const runtime = await import('/js/lib-loader.js'), task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS });
    try { const pdf = await task.promise, page = await pdf.getPage(1); return { text: (await page.getTextContent()).items.map((item) => item.str).join(' '), annotations: (await page.getAnnotations({ intent: 'display' })).map((item) => ({ url: item.url, fieldValue: item.fieldValue })) }; } finally { await task.destroy(); }
  }, [...result.bytes]);
  expect(text.text).toContain('STRUCTURAL RETAIN PAGE 1'); expect(text.annotations.some((item) => item.url === 'https://example.invalid/compress-route')).toBe(true);
  await page.click('#useResultBtn'); await expect(page.locator('#chainRow')).toBeVisible(); const chosen = await state(page);
  expect(chosen.current).toBe(hash(result.bytes)); expect(chosen.original).toBe(hash(source.buffer)); expect(chosen.snapshot.taskId).toBe(before.snapshot.taskId); expect(chosen.snapshot.canUndo).toBe(true);
  await page.locator('#chainRow').getByRole('button', { name: /Reader|View PDF/, exact: true }).click();
  await expect(page.locator('#readerTextLayer')).toContainText('STRUCTURAL RETAIN PAGE 1');
  const readerState = await state(page); expect(readerState.current).toBe(chosen.current); expect(readerState.original).toBe(chosen.original); expect(readerState.snapshot.taskId).toBe(chosen.snapshot.taskId);
  expect(observed.errors).toEqual([]); expect(observed.nonGet).toEqual([]); expect(observed.downloads).toHaveLength(1);
});

for (const geometry of [
  { id: 'Letter612x792', size: [612, 792] },
  { id: 'rotated-fractional-A4', size: [595.28, 841.89], rotation: 90, crop: [10.25, 12.5, 574.625, 813.125] },
]) test(`structural preview and saved artifact retain strict ${geometry.id} geometry`, async ({ page }, testInfo) => {
  const observed = observe(page), source = await fixture({ ...geometry, name: `${geometry.id}.pdf` });
  await page.goto('/compress'); await page.setInputFiles('#fileInput', source); await ready(page);
  const sourcePreview = await page.locator('#compressionSourceCanvas').evaluate((canvas) => ({ width: canvas.width, height: canvas.height, png: canvas.toDataURL() }));
  await page.click('#compressBtn'); await reviewed(page);
  const resultPreview = await page.locator('#documentResult canvas').evaluate((canvas) => ({ width: canvas.width, height: canvas.height, png: canvas.toDataURL() }));
  expect(resultPreview).toEqual(sourcePreview); expect(sourcePreview.width).toBeLessThanOrEqual(900); expect(sourcePreview.height).toBeLessThanOrEqual(900); expect(sourcePreview.width * sourcePreview.height).toBeLessThanOrEqual(1000000);
  expect(observed.downloads).toEqual([]); expect((await state(page)).current).toBe(hash(source.buffer));
  const result = await saved(page, testInfo, `${geometry.id}-actual.pdf`); expect(result.bytes.length).toBeLessThan(source.buffer.length);
  const options = { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false };
  const input = await pdfLib.PDFDocument.load(source.buffer, options), output = await pdfLib.PDFDocument.load(result.bytes, options);
  expect(output.getPageCount()).toBe(1); expect(output.getPage(0).getMediaBox()).toEqual(input.getPage(0).getMediaBox()); expect(output.getPage(0).getCropBox()).toEqual(input.getPage(0).getCropBox()); expect(output.getPage(0).getRotation()).toEqual(input.getPage(0).getRotation());
  expect(output.getTitle()).toBe(input.getTitle()); expect(output.getForm().getTextField('portable-field').getText()).toBe('RETAINED VALUE'); expect(output.getForm().getCheckBox('portable-check').isChecked()).toBe(true);
  const content = await page.evaluate(async ({ source, result }) => {
    const runtime = await import('/js/lib-loader.js'), pdfjs = await runtime.ensurePdfJs();
    const inspect = async (bytes) => {
      const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS, stopAtErrors: true, enableXfa: false });
      try { const pdf = await task.promise, page = await pdf.getPage(1); return { text: (await page.getTextContent()).items.map((item) => item.str).join(' '), urls: (await page.getAnnotations({ intent: 'display' })).map((item) => item.url).filter(Boolean), view: page.view, rotation: page.rotate, userUnit: page.userUnit }; }
      finally { await task.destroy(); }
    };
    return { source: await inspect(source), result: await inspect(result) };
  }, { source: [...source.buffer], result: [...result.bytes] });
  expect(content.result).toEqual(content.source); expect(content.result.text).toContain('STRUCTURAL RETAIN PAGE 1'); expect(content.result.urls).toContain('https://example.invalid/compress-route');
  expect(observed.downloads).toHaveLength(1); expect(observed.errors).toEqual([]); expect(observed.nonGet).toEqual([]);
});

test('already compressed/no-op and second pass retain exact saved bytes, names and honest state', async ({ page }, testInfo) => {
  const observed = observe(page); await page.goto('/compress'); const source = await fixture(); await page.setInputFiles('#fileInput', source); await ready(page); await page.click('#compressBtn'); await reviewed(page);
  const first = await saved(page, testInfo, 'first-pass.pdf');
  await page.setInputFiles('#fileInput', { name: first.name, mimeType: 'application/pdf', buffer: first.bytes }); await ready(page); await page.click('#compressBtn'); await reviewed(page);
  await expect(page.locator('#resultSummary')).toContainText('No size reduction'); expect(observed.downloads).toHaveLength(1);
  const second = await saved(page, testInfo, 'second-pass.pdf'); expect(second.bytes).toEqual(first.bytes); expect(second.name).toBe(first.name); await expect(page.locator('#documentResultLosses')).toHaveCount(0);
  const noop = await fixture({ raw: false, name: 'Noop.pdf' }); await page.setInputFiles('#fileInput', noop); await ready(page); await page.click('#compressBtn'); await reviewed(page);
  const third = await saved(page, testInfo, 'noop.pdf'); expect(third.bytes).toEqual(noop.buffer); expect(third.name).toBe('Noop.pdf'); expect(observed.errors).toEqual([]);
});

test('invalid native B retains usable chosen A and a later valid B becomes the exact new task', async ({ page }) => {
  const observed = observe(page), a = await fixture(); await page.goto('/compress'); await page.setInputFiles('#fileInput', a); await ready(page); const old = await state(page);
  await page.setInputFiles('#fileInput', { name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nBAD\n%%EOF') });
  await expect(page.locator('#errorSection')).toBeVisible(); await ready(page); expect((await state(page)).current).toBe(old.current); expect((await state(page)).snapshot.taskId).toBe(old.snapshot.taskId);
  const b = await fixture({ pages: 2, name: 'B.pdf', label: 'NEW B' }); await page.setInputFiles('#fileInput', b); await ready(page);
  const next = await state(page); expect(next.current).toBe(hash(b.buffer)); expect(next.original).toBe(hash(b.buffer)); expect(next.snapshot.taskId).not.toBe(old.snapshot.taskId); expect(observed.errors).toEqual([]);
});

test('completed initial workflow READ loses to native B before old File bytes are read', async ({ page }) => {
  const observed = observe(page), a = await fixture({ name: 'OLD A.pdf' }); await page.goto('/compress'); await page.setInputFiles('#fileInput', a); await ready(page);
  const handoff = await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'), value = ui.documentSession.current(); const result = await ui.stashForChain(value.bytes, value.name, 'compress', value); return { workflowId: result.workflowId, fileId: result.fileId }; });
  await page.route('**/document-handoff.js*', async (route) => {
    const response = await route.fetch(), body = await response.text(), marker = 'export async function takeChainedFile(';
    if (!body.includes(marker)) throw Error('Public handoff entry not found.');
    await route.fulfill({ response, body: body.replace(marker, 'async function originalTakeChainedFile(') + '\nexport async function takeChainedFile(...args) { try { return await originalTakeChainedFile(...args); } finally { window.__handoffSettled = true; } }\n' });
  });
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete'), read = File.prototype.arrayBuffer; let claimed = false; window.__oldReads = 0;
    File.prototype.arrayBuffer = function () { if (this.name === 'OLD A.pdf') window.__oldReads++; return read.call(this); };
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { configurable: true, enumerable: descriptor.enumerable, get: descriptor.get, set(handler) {
      const tx = this;
      if (!claimed && tx.db.name === 'browserpdf-workflows' && tx.mode === 'readonly' && [...tx.objectStoreNames].includes('workflows')) { claimed = true; descriptor.set.call(tx, function (event) { window.__readHeld = true; window.__releaseRead = () => handler.call(tx, event); }); }
      else descriptor.set.call(tx, handler);
    } });
  });
  await page.goto(`/compress?workflow=${handoff.workflowId}&file=${encodeURIComponent(handoff.fileId)}`); await page.waitForFunction(() => window.__readHeld);
  const b = await fixture({ pages: 2, name: 'NATIVE B.pdf' }); await page.setInputFiles('#fileInput', b); await ready(page); const next = await state(page);
  await page.evaluate(() => window.__releaseRead()); await page.waitForFunction(() => window.__handoffSettled);
  expect(await page.evaluate(() => window.__oldReads)).toBe(0); expect((await state(page)).current).toBe(hash(b.buffer)); expect((await state(page)).snapshot.taskId).toBe(next.snapshot.taskId); expect(observed.errors).toEqual([]);
});

test('canceled held native stream drains before B and cannot publish its old result', async ({ page }) => {
  const observed = observe(page), a = await fixture(); await page.goto('/compress'); await page.setInputFiles('#fileInput', a); await ready(page);
  await page.evaluate(() => {
    const NativeStream = CompressionStream; let first = true; window.__streamHold = new Promise((resolve) => { window.__releaseStream = resolve; });
    window.CompressionStream = function (...args) {
      const stream = new NativeStream(...args); if (!first) return stream; first = false;
      return { writable: stream.writable, readable: { getReader() { const reader = stream.readable.getReader(); return { async read() { const value = await reader.read(); window.__streamHeld = true; await window.__streamHold; return value; }, cancel: (...args) => reader.cancel(...args), releaseLock: () => reader.releaseLock() }; } } };
    };
  });
  await page.click('#compressBtn'); await page.waitForFunction(() => window.__streamHeld);
  const b = await fixture({ pages: 2, name: 'AFTER CANCEL B.pdf' }); await page.setInputFiles('#fileInput', b); await expect(page.locator('#compressionResultHost')).toBeHidden();
  await page.evaluate(() => window.__releaseStream()); await ready(page); expect((await state(page)).current).toBe(hash(b.buffer));
  await page.click('#compressBtn'); await reviewed(page); await expect(page.locator('#documentResultIdentity')).toContainText('AFTER CANCEL B-optimized.pdf'); expect(observed.downloads).toEqual([]); expect(observed.errors).toEqual([]);
});

test('failed first actual result preview exposes no Use/download; Retry reuses verified output', async ({ page }, testInfo) => {
  const observed = observe(page);
  await page.route('**/lib-loader.js*', async (route) => {
    const response = await route.fetch(), body = await response.text(), marker = 'export async function ensurePdfJs(onStatus)';
    if (!body.includes(marker)) throw Error('Public runtime entry not found.');
    await route.fulfill({ response, body: body.replace(marker, 'async function originalEnsurePdfJs(onStatus)') + `
export async function ensurePdfJs(onStatus) {
  const runtime = await originalEnsurePdfJs(onStatus);
  return { ...runtime, getDocument(options) {
    const task = runtime.getDocument(options);
    if (options.stopAtErrors || window.__resultPreviewFailed) return task;
    window.__resultPreviewFailed = true;
    return { promise: task.promise.then((doc) => { doc.getPage = async () => { throw new Error('Controlled first result preview failure'); }; return doc; }), destroy: () => task.destroy() };
  } };
}
` });
  });
  await page.addInitScript(() => { const NativeStream = CompressionStream; window.__compressStreams = 0; window.CompressionStream = function (...args) { window.__compressStreams++; return new NativeStream(...args); }; });
  const source = await fixture(); await page.goto('/compress'); await page.setInputFiles('#fileInput', source); await ready(page); await page.click('#compressBtn');
  await expect(page.locator('#errorSection')).toBeVisible(); await expect(page.locator('#compressionResultHost')).toBeHidden(); await expect(page.locator('#downloadResultBtn')).toBeHidden(); await expect(page.locator('#useResultBtn')).toBeHidden();
  const streams = await page.evaluate(() => window.__compressStreams); expect(streams).toBeGreaterThan(0); expect(observed.downloads).toEqual([]);
  await page.click('#retryCompressBtn'); await reviewed(page); expect(await page.evaluate(() => window.__compressStreams)).toBe(streams);
  const result = await saved(page, testInfo, 'preview-retried.pdf'); expect(result.bytes.length).toBeLessThan(source.buffer.length); expect(observed.errors).toEqual([]);
});

test('guarded inherited 251-page task is read-only and Reader continuation retains the chosen task', async ({ page }) => {
  const observed = observe(page), source = await fixture({ pages: 251, name: 'Inherited many pages.pdf' }); await page.goto('/view-pdf'); await page.setInputFiles('#fileInput', source);
  await expect(page.locator('#readerTextLayer')).toContainText('STRUCTURAL RETAIN PAGE 1'); const original = await state(page);
  const handoff = await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'), current = ui.documentSession.current(); const value = await ui.stashForChain(current.bytes, current.name, 'compress', current); return { workflowId: value.workflowId, fileId: value.fileId }; });
  await page.goto(`/compress?workflow=${handoff.workflowId}&file=${encodeURIComponent(handoff.fileId)}`); await expect(page.locator('#compressionReadonly')).toBeVisible(); await expect(page.locator('#compressionReadonly')).toContainText('250 pages'); await expect(page.locator('#compressBtn')).toBeHidden();
  expect((await state(page)).current).toBe(original.current); expect((await state(page)).snapshot.taskId).toBe(original.snapshot.taskId); expect(await page.locator('#compressionSourceCanvas').evaluate((canvas) => canvas.width * canvas.height)).toBe(0);
  await page.click('#compressionReaderBtn'); await expect(page.locator('#readerTextLayer')).toContainText('STRUCTURAL RETAIN PAGE 1');
  const retained = await state(page); expect(retained.current).toBe(original.current); expect(retained.snapshot.taskId).toBe(original.snapshot.taskId); expect(observed.downloads).toEqual([]); expect(observed.errors).toEqual([]);
});

test('native empty-user encrypted B rejects; actual guarded inherited bytes restore locked read-only task', async ({ page }) => {
  const observed = observe(page), source = await fixture({ name: 'RETAINED A.pdf' }); await page.goto('/compress'); await page.setInputFiles('#fileInput', source); await ready(page);
  const before = await state(page);
  const encrypted = await page.evaluate(async () => {
    const runtime = await import('/js/lib-loader.js'), lib = await runtime.ensureCantooPdfLib();
    const doc = await lib.PDFDocument.create({ updateMetadata: false }); doc.addPage([300, 400]).drawText('EMPTY USER', { x: 20, y: 300, size: 12 });
    doc.encrypt({ userPassword: '', ownerPassword: crypto.randomUUID(), permissions: { printing: 'highResolution', copying: false, modifying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false } });
    const bytes = new Uint8Array(await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
    if (bytes.length > 1024 * 1024) throw Error('Synthetic encrypted control exceeds 1 MiB.');
    return [...bytes];
  });
  await page.setInputFiles('#fileInput', { name: 'Empty user.pdf', mimeType: 'application/pdf', buffer: Buffer.from(encrypted) });
  await expect(page.locator('#errorSection')).toBeVisible(); await ready(page); const rejected = await state(page);
  expect(rejected.current).toBe(before.current); expect(rejected.original).toBe(before.original); expect(rejected.snapshot.taskId).toBe(before.snapshot.taskId);
  const handoff = await page.evaluate(async (bytes) => {
    const ui = await import('/js/tool-ui.js'); ui.documentSession.adopt(Uint8Array.from(bytes), 'Empty user.pdf', { type: 'application/pdf', capabilities: { encrypted: true } });
    const chosen = ui.documentSession.current(), value = await ui.stashForChain(chosen.bytes, chosen.name, 'unlock', chosen);
    return { taskId: ui.documentSession.snapshot().taskId, workflowId: value.workflowId, fileId: value.fileId };
  }, encrypted);
  await page.goto(`/compress?workflow=${handoff.workflowId}&file=${encodeURIComponent(handoff.fileId)}`);
  await expect(page.locator('#compressionReadonly')).toBeVisible(); await expect(page.locator('#compressionReadonly')).toContainText('locked'); await expect(page.locator('#compressionReaderBtn')).toHaveText('Open current PDF in Unlock');
  await expect(page.locator('#compressBtn')).toBeHidden(); await expect(page.locator('#chainRow')).toHaveCount(0);
  const retained = await state(page); expect(retained.current).toBe(hash(Buffer.from(encrypted))); expect(retained.original).toBe(before.original); expect(retained.snapshot.taskId).toBe(handoff.taskId); expect(retained.snapshot.canUndo).toBe(true); expect(retained.snapshot.current.capabilities.encrypted).toBe(true);
  expect(observed.downloads).toEqual([]); expect(observed.errors).toEqual([]);
});

for (const [width, locale] of [[320, ''], [390, ''], [768, '/ar'], [1440, '']]) test(`structural Compress fits ${width}px ${locale || 'en'} with bounded names and actual previews`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto(`${locale}/compress`);
  const source = await fixture({ name: 'Long Unicode Ω label '.repeat(14) + '.pdf' }); await page.setInputFiles('#fileInput', source); await ready(page); await page.click('#compressBtn'); await reviewed(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const name = await page.locator('#documentResultIdentity').innerText(); expect(name).toContain('-optimized.pdf');
  if (locale) await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await page.locator('#compressionSourceCanvas').evaluate((canvas) => canvas.width <= 900 && canvas.height <= 900 && canvas.width * canvas.height <= 1000000)).toBe(true);
});
