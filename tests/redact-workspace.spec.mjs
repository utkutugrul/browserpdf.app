import { test, expect } from '@playwright/test';
import * as lib from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const SECRET = 'ROUTE-REDACT-UNIQUE-SECRET-2026';
const INFO = 'ROUTE-PRIVATE-INFO-2026', XMP = 'ROUTE-PRIVATE-XMP-2026';
const MASK = { x: 50, y: 590, width: 490, height: 45 };
const sha = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
async function source(kind = 'plain', label = 'SAFE', geometry = false) {
  const doc = await lib.PDFDocument.create(), font = await doc.embedFont(lib.StandardFonts.Helvetica), count = geometry ? 4 : 3;
  for (let index = 0; index < count; index++) {
    const page = doc.addPage(geometry ? [400.75, 320.75] : [600, 800]);
    if (geometry) { page.setCropBox(20.1, 30.1, 320.1375, 240.2375); page.setRotation(lib.degrees(index * 90)); page.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(index % 2 + 1)); page.drawText(SECRET, { x: 50.1, y: 165, size: 10, font }); page.drawRectangle({ x: 45.2, y: 55.3, width: 60.4, height: 40.2, color: lib.rgb(0, 1, 0) }); page.drawRectangle({ x: 260.3, y: 220.2, width: 50.1, height: 30.2, color: lib.rgb(0, 0, 1) }); }
    else { page.drawText(`${label} PAGE ${index + 1}`, { x: 50, y: 720, font, size: 18 }); if (!index) page.drawText(SECRET, { x: 50, y: 605, font, size: 18 }); }
  }
  doc.setTitle(INFO); doc.catalog.set(lib.PDFName.of('Metadata'), doc.context.register(doc.context.flateStream(`<x:xmpmeta xmlns:x="adobe:ns:meta/">${XMP}</x:xmpmeta>`, { Type: 'Metadata', Subtype: 'XML' })));
  if (kind === 'form') { const field = doc.getForm().createTextField('REPEATED'); field.setText('Visible field'); for (const index of [0, 1]) field.addToPage(doc.getPage(index), { x: 50, y: 300, width: 130, height: 25 }); }
  if (kind === 'link') doc.getPage(1).node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 100, 160, 130], Dest: [doc.getPage(0).ref, 'Fit'] })));
  const bytes = Buffer.from(await doc.save()); return { name: `${label}-${kind}.pdf`, mimeType: 'application/pdf', buffer: bytes };
}
async function details(control) { for (const item of await control.locator('xpath=ancestor::details[not(@open)]').all()) await item.locator('summary').first().click(); }
async function boot(page, route = '/redact') {
  await page.addInitScript(() => {
    localStorage.setItem('bpdf-consent', 'rejected');
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (type !== 'click' || typeof listener !== 'function') return add.call(this, type, listener, options);
      return add.call(this, type, function(event) { const result = listener.call(this, event); if (this instanceof Element && this.id === 'redactApplyBtn' && result?.then) { window.redactReviewSettled = false; Promise.resolve(result).then(() => { window.redactReviewSettled = true; }, () => { window.redactReviewSettled = true; }); } return result; }, options);
    };
  });
  await page.goto(route); await expect(page.locator('#fileInput')).toBeEnabled();
}
async function ready(page, name) { await expect(page.locator('#viewerSection')).toBeVisible(); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-busy', 'false'); await expect(page.locator('#pdfCanvas')).toBeVisible(); if (name) await expect(page.locator('#documentIdentity')).toContainText(name); }
async function intake(page, file) { await details(page.locator('#fileInput')); await expect(page.locator('#fileInput')).toBeEnabled(); await page.setInputFiles('#fileInput', file); await ready(page, file.name); }
async function snapshot(page) { return page.evaluate(async () => { const entry = document.querySelector('script[type=module][src^="js/"]'), ui = await import(new URL('./tool-ui.js', entry.src).href); return { state: ui.documentSession.snapshot(), bytes: [...ui.documentSession.current().bytes], original: [...ui.documentSession.original().bytes], scene: ui.documentSession.scene() }; }); }
async function saveMask(page, mask) { await details(page.locator('#redactMaskX')); for (const [key, value] of Object.entries(mask)) await page.fill(`#redactMask${key[0].toUpperCase() + key.slice(1)}`, String(value)); await expect(page.locator('#redactSaveMaskBtn')).toBeEnabled(); await page.click('#redactSaveMaskBtn'); await expect(page.locator('#redactSaveMaskBtn')).toBeDisabled(); }
async function addMask(page, mask = MASK) { await expect(page.locator('#redactAddMaskBtn')).toBeEnabled(); await page.click('#redactAddMaskBtn'); await saveMask(page, mask); }
async function review(page) { await expect(page.locator('#redactApplyBtn')).toBeEnabled(); await page.click('#redactApplyBtn'); await expect(page.locator('#documentResultPreview')).toHaveAttribute('aria-busy', 'false', { timeout: 60000 }); await expect(page.locator('#downloadResultBtn')).toBeVisible(); }
async function download(page, info, name) { const [file] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); const path = info.outputPath(name); await file.saveAs(path); return new Uint8Array(await readFile(path)); }
async function inspect(bytes) { const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); const parts = [Buffer.from(bytes).toString('latin1')]; let pages = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) { parts.push(object.toString()); if (object instanceof lib.PDFPageLeaf) pages++; if (object instanceof lib.PDFRawStream) { parts.push(Buffer.from(object.getContents()).toString('latin1')); parts.push(Buffer.from(lib.decodePDFRawStream(object).decode()).toString('latin1')); } }
  const content = parts.join('\n').toLowerCase(); for (const secret of [SECRET, INFO, XMP]) for (const form of [secret, Buffer.from(secret).toString('hex'), [...secret].map((char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')]) expect(content).not.toContain(form.toLowerCase());
  expect(pages).toBe(doc.getPageCount()); expect(doc.context.trailerInfo.Info).toBeUndefined(); expect(doc.catalog.get(lib.PDFName.of('Metadata'))).toBeUndefined(); return doc;
}
async function pdfFacts(page, bytes) { return page.evaluate(async (bytes) => { const entry = document.querySelector('script[type=module][src^="js/"]'), runtime = await import(new URL('./lib-loader.js', entry.src).href), task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS }); try { const doc = await task.promise, text = []; for (let index = 1; index <= doc.numPages; index++) text.push((await (await doc.getPage(index)).getTextContent()).items.map((item) => item.str).join(' ')); return { count: doc.numPages, text }; } finally { await task.destroy(); } }, [...bytes]); }
async function sessionState(page) { return page.evaluate(async () => (await import(new URL('./tool-ui.js', document.querySelector('script[type=module][src^="js/"]').src).href)).documentSession.snapshot()); }
async function maskedPixels(page, input, output, mask = MASK) {
  return page.evaluate(async ({ input, output, mask }) => {
    const runtime = await import(new URL('./lib-loader.js', document.querySelector('script[type=module][src^="js/"]').src).href), pdfjs = await runtime.ensurePdfJs(), tasks = [input, output].map((bytes) => pdfjs.getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS }));
    try {
      const images = []; let viewport;
      for (const task of tasks) { const pdf = await task.promise, page = await pdf.getPage(1); viewport = page.getViewport({ scale: 2 }); const canvas = document.createElement('canvas'); canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height); await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; images.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)); canvas.width = canvas.height = 0; }
      const points = [[mask.x, mask.y], [mask.x + mask.width, mask.y + mask.height]].map(([x, y]) => viewport.convertToViewportPoint(x, y)), left = Math.floor(Math.min(...points.map((p) => p[0]))), right = Math.ceil(Math.max(...points.map((p) => p[0]))), top = Math.floor(Math.min(...points.map((p) => p[1]))), bottom = Math.ceil(Math.max(...points.map((p) => p[1]))); let nonblack = 0, outside = 0;
      for (let y = 0; y < images[1].height; y++) for (let x = 0; x < images[1].width; x++) { const offset = (y * images[1].width + x) * 4; if (x >= left && x < right && y >= top && y < bottom) { if (images[1].data[offset] || images[1].data[offset + 1] || images[1].data[offset + 2] || images[1].data[offset + 3] !== 255) nonblack++; } else for (let channel = 0; channel < 4; channel++) if (images[0].data[offset + channel] !== images[1].data[offset + channel]) { outside++; break; } }
      return { nonblack, outside };
    } finally { await Promise.all(tasks.map((task) => task.destroy())); }
  }, { input: [...input], output: [...output], mask });
}
function watchErrors(page) { const errors = []; page.on('pageerror', (error) => errors.push(error.message)); return errors; }
async function holdEncoder(page) {
  await page.evaluate(() => { const native = HTMLCanvasElement.prototype.toBlob; let claimed = false; window.restoreRedactEncoder = () => { HTMLCanvasElement.prototype.toBlob = native; }; HTMLCanvasElement.prototype.toBlob = function(callback, ...args) { if (claimed) return native.call(this, callback, ...args); claimed = true; return native.call(this, (blob) => { window.redactEncoderHeld = true; window.releaseRedactEncoder = () => callback(blob); }, ...args); }; });
}
async function freshArtifact(page, info, file, name) {
  await addMask(page); await review(page); const output = await download(page, info, name); await inspect(output); const facts = await pdfFacts(page, output); expect(facts.text[1]).toContain('NEW B PAGE 2'); expect(facts.text.join(' ')).not.toContain('OLD A'); expect(await maskedPixels(page, file.buffer, output)).toEqual({ nonblack: 0, outside: 0 }); return output;
}

test('Redact native masks, dirty coordinates, selected-copy history and actual clean hybrid download', async ({ page }, info) => {
  const errors = [], downloads = []; page.on('pageerror', (error) => errors.push(error.message)); page.on('download', (file) => downloads.push(file.suggestedFilename())); await boot(page); const file = await source(); await intake(page, file); const original = await snapshot(page);
  await page.click('#redactAddMaskBtn'); const mask = page.locator('.redact-mask'); await expect(mask).toHaveCount(1); const x = Number(await page.locator('#redactMaskX').inputValue()), width = Number(await page.locator('#redactMaskWidth').inputValue());
  await mask.focus(); await page.keyboard.press('ArrowRight'); expect(Number(await page.locator('#redactMaskX').inputValue())).toBeCloseTo(x + 1, 3); await page.keyboard.press('Shift+ArrowRight'); expect(Number(await page.locator('#redactMaskWidth').inputValue())).toBeCloseTo(width + 1, 3); await expect(page.locator('#readerPage')).toHaveValue('1');
  await page.keyboard.press('Delete'); await expect(mask).toHaveCount(0); await page.click('#redactUndoMaskBtn'); await expect(mask).toHaveCount(1); await mask.click();
  await details(page.locator('#redactMaskX')); const savedX = await page.locator('#redactMaskX').inputValue(); await page.fill('#redactMaskX', '90');
  for (const id of ['redactApplyBtn', 'readerPage', 'redactOutputMode', 'redactMaskList', 'redactUndoMaskBtn']) await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.click('#redactDiscardCoordinatesBtn'); await expect(page.locator('#redactMaskX')).toHaveValue(savedX); await saveMask(page, MASK);
  await details(page.locator('#workspaceModes')); await page.locator('#workspaceModes button[data-mode="fill-sign"]').click(); await expect(page).toHaveURL(/\/redact$/); await expect(page.locator('#redactStatus')).toContainText('discard mask');
  await review(page); expect(downloads).toHaveLength(0); const output = await download(page, info, 'native-hybrid-redacted.pdf'), doc = await inspect(output), facts = await pdfFacts(page, output); expect(doc.getPageCount()).toBe(3); expect(facts.text[0]).toBe(''); expect(facts.text[1]).toContain('SAFE PAGE 2'); expect(facts.text[2]).toContain('SAFE PAGE 3'); expect(await snapshot(page)).toEqual(original);
  await page.click('#useResultBtn'); await ready(page); const chosen = await snapshot(page); expect(sha(chosen.bytes)).toBe(sha(output)); expect(chosen.state.taskId).toBe(original.state.taskId); expect(sha(chosen.original)).toBe(sha(file.buffer)); expect(chosen.scene).toBeNull(); await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-masks', '0');
  await page.click('#redactUndoDocumentBtn'); await ready(page, file.name); expect(sha((await snapshot(page)).bytes)).toBe(sha(file.buffer)); await page.click('#redactRedoDocumentBtn'); await ready(page); await expect(page.locator('#documentResultPreview')).toHaveAttribute('aria-busy', 'false'); expect(sha((await snapshot(page)).bytes)).toBe(sha(output)); await expect(page.locator('#chainRow').getByRole('button', { name: 'Privacy Scan', exact: true })).toBeVisible(); const redone = await download(page, info, 'native-redone-current.pdf'); expect(sha(redone)).toBe(sha(output)); expect(errors).toEqual([]);
});

for (const kind of ['form', 'link']) test(`Redact ${kind} graph requires explicit whole-document loss consent and actual fresh raster artifact`, async ({ page }, info) => {
  await boot(page); const file = await source(kind); await intake(page, file); const original = await snapshot(page); await addMask(page); await expect(page.locator('#redactFallbackPanel')).toBeVisible(); await expect(page.locator('#redactUnsupportedReason')).not.toHaveText('');
  await page.click('#redactChooseRasterBtn'); await expect(page.locator('#redactOutputMode')).toHaveValue('raster'); await expect(page.locator('#redactRasterConsent')).not.toBeChecked(); await expect(page.locator('#redactApplyBtn')).toBeDisabled(); await page.check('#redactRasterConsent'); await expect(page.locator('#redactEstimate')).toContainText('3 raster pages'); await review(page);
  const output = await download(page, info, `${kind}-whole-raster.pdf`); await inspect(output); expect((await pdfFacts(page, output)).text).toEqual(['', '', '']); expect(await snapshot(page)).toEqual(original); await expect(page.locator('#documentResultLosses')).toContainText('Every page becomes an image'); await page.click('#useResultBtn'); await ready(page); expect((await snapshot(page)).state.current.capabilities).toEqual({ encrypted: false, searchable: false, forms: false, rasterized: true });
});

test('Redact native pointer and numeric masks export exact fractional four-rotation CropBox/UserUnit geometry', async ({ page }, info) => {
  await boot(page); const file = await source('plain', 'GEOMETRY', true); await intake(page, file); const target = { x: 50.1, y: 150.1, width: 200, height: 40 };
  const targets = await page.evaluate(async ({ bytes, target }) => { const runtime = await import(new URL('./lib-loader.js', document.querySelector('script[type=module][src^="js/"]').src).href), task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS }); try { const pdf = await task.promise, result = []; for (let index = 1; index <= 4; index++) { const page = await pdf.getPage(index), viewport = page.getViewport({ scale: 1 }), origin = viewport.convertToPdfPoint(0, 0), right = viewport.convertToPdfPoint(page.userUnit, 0); result.push({ ...target, x: target.x + Math.round(right[0] - origin[0]), y: target.y + Math.round(right[1] - origin[1]) }); } return result; } finally { await task.destroy(); } }, { bytes: [...file.buffer], target });
  for (let index = 0; index < 4; index++) {
    if (index) { await page.fill('#readerPage', String(index + 1)); await page.locator('#readerPage').press('Enter'); await expect(page.locator('#pageIndicator')).toContainText(`Page ${index + 1} of 4`); await ready(page); }
    const box = await page.locator('#pdfCanvas').boundingBox(); await page.mouse.move(box.x + box.width * .2, box.y + box.height * .3); await page.mouse.down(); await page.mouse.move(box.x + box.width * .65, box.y + box.height * .5, { steps: 4 }); await page.mouse.up(); await expect(page.locator('.redact-mask')).toHaveCount(1); await saveMask(page, target);
    await page.locator('.redact-mask').scrollIntoViewIfNeeded(); await page.locator('.redact-mask').focus(); await page.keyboard.press('ArrowRight');
    await expect(page.locator('#readerPage')).toHaveValue(String(index + 1)); for (const [key, value] of Object.entries(targets[index])) await expect(page.locator(`#redactMask${key[0].toUpperCase() + key.slice(1)}`)).toHaveValue(String(value));
  }
  await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-masks', '4'); await review(page); const output = await download(page, info, 'fractional-four-rotation-redacted.pdf'), sourceDoc = await lib.PDFDocument.load(file.buffer), saved = await inspect(output);
  for (let index = 0; index < 4; index++) { expect(saved.getPage(index).getMediaBox()).toEqual(sourceDoc.getPage(index).getMediaBox()); expect(saved.getPage(index).getCropBox()).toEqual(sourceDoc.getPage(index).getCropBox()); expect(saved.getPage(index).getRotation()).toEqual(sourceDoc.getPage(index).getRotation()); expect(saved.getPage(index).node.lookup(lib.PDFName.of('UserUnit')).asNumber()).toBe(index % 2 + 1); }
  const comparisons = await page.evaluate(async ({ input, output, masks }) => {
    const runtime = await import(new URL('./lib-loader.js', document.querySelector('script[type=module][src^="js/"]').src).href), pdfjs = await runtime.ensurePdfJs(), tasks = [input, output].map((bytes) => pdfjs.getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS }));
    try { const [source, result] = await Promise.all(tasks.map((task) => task.promise)), rows = [];
      for (let index = 1; index <= 4; index++) { const images = [], mask = masks[index - 1]; let viewport;
        for (const pdf of [source, result]) { const page = await pdf.getPage(index); viewport = page.getViewport({ scale: 2 }); const canvas = document.createElement('canvas'); canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height); await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; images.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)); canvas.width = canvas.height = 0; }
        const points = [[mask.x, mask.y], [mask.x + mask.width, mask.y], [mask.x + mask.width, mask.y + mask.height], [mask.x, mask.y + mask.height]].map(([x, y]) => viewport.convertToViewportPoint(x, y)), left = Math.floor(Math.min(...points.map((point) => point[0]))), right = Math.ceil(Math.max(...points.map((point) => point[0]))), top = Math.floor(Math.min(...points.map((point) => point[1]))), bottom = Math.ceil(Math.max(...points.map((point) => point[1]))); let nonblack = 0, outside = 0;
        for (let y = 0; y < images[1].height; y++) for (let x = 0; x < images[1].width; x++) { const offset = (y * images[1].width + x) * 4; if (x >= left && x < right && y >= top && y < bottom) { if (images[1].data[offset] || images[1].data[offset + 1] || images[1].data[offset + 2] || images[1].data[offset + 3] !== 255) nonblack++; } else for (let channel = 0; channel < 4; channel++) if (images[0].data[offset + channel] !== images[1].data[offset + channel]) { outside++; break; } }
        rows.push({ nonblack, outside, width: images[1].width, height: images[1].height }); }
      return rows;
    } finally { await Promise.all(tasks.map((task) => task.destroy())); }
  }, { input: [...file.buffer], output: [...output], masks: targets });
  expect(comparisons.map(({ nonblack, outside }) => ({ nonblack, outside }))).toEqual(Array.from({ length: 4 }, () => ({ nonblack: 0, outside: 0 })));
});

test('Redact Cancel drains a held native encoder and preserves drafts/current before a fresh successful download', async ({ page }, info) => {
  await boot(page); const file = await source(); await intake(page, file); await addMask(page); const before = await snapshot(page);
  await page.evaluate(() => { const native = HTMLCanvasElement.prototype.toBlob; let claimed = false; window.restoreRedactEncoder = () => { HTMLCanvasElement.prototype.toBlob = native; }; HTMLCanvasElement.prototype.toBlob = function(callback, ...args) { if (claimed) return native.call(this, callback, ...args); claimed = true; return native.call(this, (blob) => { window.redactEncoderHeld = true; window.releaseRedactEncoder = () => callback(blob); }, ...args); }; });
  await page.click('#redactApplyBtn'); await expect.poll(() => page.evaluate(() => !!window.redactEncoderHeld)).toBe(true); await page.click('#redactCancelBtn'); await expect(page.locator('#redactStatus')).toContainText('Finishing abandoned'); await expect(page.locator('#redactAddMaskBtn')).toBeDisabled(); await page.evaluate(() => window.releaseRedactEncoder()); await expect.poll(() => page.evaluate(() => window.redactReviewSettled)).toBe(true); await ready(page); await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-masks', '1'); expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => window.restoreRedactEncoder()); await review(page); const output = await download(page, info, 'recovered-after-cancel.pdf'); await inspect(output); expect((await pdfFacts(page, output)).text[1]).toContain('SAFE PAGE 2');
});

test('Redact initial held native handoff READ cannot replace a ready newer native document', async ({ page }, info) => {
  await boot(page); const old = await source('plain', 'OLD A'), fresh = await source('plain', 'NEW B'); await intake(page, old);
  await page.addInitScript(() => { const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete'), NativeFile = File; let claimed = false; window.File = class extends NativeFile { constructor(parts, name, options) { super(parts, name, options); if (name === 'OLD A-plain.pdf') window.oldInitialReadReturned = true; } };
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { configurable: true, enumerable: descriptor.enumerable, get: descriptor.get, set(handler) { const tx = this, eligible = !claimed && tx.db.name === 'browserpdf-workflows' && tx.mode === 'readonly' && [...tx.objectStoreNames].includes('workflows'); if (eligible) { claimed = true; descriptor.set.call(tx, function(event) { window.initialReadHeld = true; window.releaseInitialRead = () => handler.call(tx, event); }); } else descriptor.set.call(tx, handler); } }); });
  await details(page.locator('#workspaceModes')); await page.locator('#workspaceModes button[data-mode="redact"]').click(); await expect.poll(() => page.evaluate(() => !!window.initialReadHeld)).toBe(true); await expect(page.locator('#fileInput')).toBeEnabled(); await page.setInputFiles('#fileInput', fresh); await ready(page, fresh.name); const before = await snapshot(page); expect(sha(before.bytes)).toBe(sha(fresh.buffer)); await page.evaluate(() => window.releaseInitialRead()); await expect.poll(() => page.evaluate(() => !!window.oldInitialReadReturned)).toBe(true); expect(await snapshot(page)).toEqual(before); await addMask(page); await review(page); const output = await download(page, info, 'new-B-after-old-read.pdf'); await inspect(output); const facts = await pdfFacts(page, output); expect(facts.text[1]).toContain('NEW B PAGE 2'); expect(facts.text.join(' ')).not.toContain('OLD A');
});

test('Redact rejected replacement preserves one-field decimal mask drafts and never republishes a prior clean-result rail', async ({ page }, info) => {
  await boot(page); const file = await source(); await intake(page, file); await addMask(page); await review(page); const output = await download(page, info, 'chosen-before-new-mask.pdf'); await inspect(output); await page.click('#useResultBtn'); await ready(page);
  await page.click('#redactAddMaskBtn'); await details(page.locator('#redactMaskX'));
  const untouched = await page.locator('#redactProperties').evaluate((form) => Object.fromEntries(['Y', 'Width', 'Height'].map((key) => [key, form.querySelector(`#redactMask${key}`).value])));
  await page.fill('#redactMaskX', '123.4567'); expect(await page.locator('#redactProperties').evaluate((form) => form.checkValidity())).toBe(true); await page.click('#redactSaveMaskBtn'); await expect(page.locator('#redactSaveMaskBtn')).toBeDisabled(); await expect(page.locator('#redactMaskX')).toHaveValue('123.4567');
  for (const [key, value] of Object.entries(untouched)) await expect(page.locator(`#redactMask${key}`)).toHaveValue(value);
  const before = await snapshot(page); await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden();
  await details(page.locator('#fileInput')); await expect(page.locator('#fileInput')).toBeEnabled(); await page.setInputFiles('#fileInput', { name: 'rejected-replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-invalid replacement') });
  await expect(page.locator('#errorSection')).toBeVisible(); await ready(page); expect(await snapshot(page)).toEqual(before); await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-masks', '1'); await expect(page.locator('#redactMaskX')).toHaveValue('123.4567'); await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden();
});

test('Redact held native encoder loses to Clear and a fresh document without reviving the cleared identity or result', async ({ page }, info) => {
  const errors = watchErrors(page); await boot(page); await intake(page, await source('plain', 'OLD A')); const old = await sessionState(page); await addMask(page); await details(page.locator('#redactClearDocumentBtn')); await holdEncoder(page);
  await page.click('#redactApplyBtn'); await expect.poll(() => page.evaluate(() => !!window.redactEncoderHeld)).toBe(true); await page.click('#redactClearDocumentBtn');
  await expect(page.locator('#viewerSection')).toHaveCount(0); await expect(page.locator('#documentIdentity')).toHaveCount(0); expect((await sessionState(page)).taskId).toBeNull(); await expect(page.locator('#documentResult')).toBeHidden();
  const file = await source('plain', 'NEW B'); await page.setInputFiles('#fileInput', file); await expect.poll(async () => (await sessionState(page)).current?.name).toBe(file.name); const committed = await snapshot(page); expect(committed.state.taskId).not.toBe(old.taskId); expect(sha(committed.bytes)).toBe(sha(file.buffer)); await expect(page.locator('#redactTransitionStatus')).toBeVisible();
  await page.evaluate(() => { window.restoreRedactEncoder(); window.releaseRedactEncoder(); }); await expect.poll(() => page.evaluate(() => window.redactReviewSettled)).toBe(true); await ready(page, file.name); expect(await snapshot(page)).toEqual({ ...committed, state: { ...committed.state, selection: [0] } }); await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-masks', '0'); await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden();
  await freshArtifact(page, info, file, 'fresh-B-after-held-clear.pdf'); expect(errors).toEqual([]);
});

test('Redact held actual PDF save loses to a valid replacement and opens the latest document after draining', async ({ page }, info) => {
  const errors = watchErrors(page); await boot(page); await intake(page, await source('plain', 'OLD A')); const old = await sessionState(page); await addMask(page); await details(page.locator('#fileInput'));
  await page.evaluate(async () => { const runtime = await import(new URL('./lib-loader.js', document.querySelector('script[type=module][src^="js/"]').src).href), lib = await runtime.ensurePdfLib(), native = lib.PDFDocument.prototype.save; let claimed = false; window.restoreRedactSave = () => { lib.PDFDocument.prototype.save = native; }; lib.PDFDocument.prototype.save = async function(...args) { const bytes = await native.apply(this, args); if (!claimed) { claimed = true; window.redactSaveHeld = true; await new Promise((resolve) => { window.releaseRedactSave = resolve; }); } return bytes; }; });
  await page.click('#redactApplyBtn'); await expect.poll(() => page.evaluate(() => !!window.redactSaveHeld)).toBe(true);
  const file = await source('plain', 'NEW B'); await page.setInputFiles('#fileInput', file); await expect.poll(async () => (await sessionState(page)).current?.name).toBe(file.name); const committed = await snapshot(page); expect(committed.state.taskId).not.toBe(old.taskId); expect(sha(committed.bytes)).toBe(sha(file.buffer)); await expect(page.locator('#redactTransitionStatus')).toBeVisible(); await expect(page.locator('#documentResult')).toBeHidden();
  await page.evaluate(() => { window.restoreRedactSave(); window.releaseRedactSave(); }); await expect.poll(() => page.evaluate(() => window.redactReviewSettled)).toBe(true); await ready(page, file.name); expect(await snapshot(page)).toEqual({ ...committed, state: { ...committed.state, selection: [0] } }); await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-masks', '0'); await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden();
  await freshArtifact(page, info, file, 'fresh-B-after-held-save.pdf'); expect(errors).toEqual([]);
});

async function touchMaskAndCancel(page) {
  await page.click('#redactDeleteMaskBtn'); await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-masks', '0'); await page.click('#fitWidthBtn'); await ready(page); await page.locator('#viewerContainer').scrollIntoViewIfNeeded();
  const clipped = (selector) => page.locator(selector).evaluate((element) => { const r = element.getBoundingClientRect(), c = document.getElementById('viewerContainer').getBoundingClientRect(); return { left: Math.max(0, r.left, c.left + 2), top: Math.max(0, r.top, c.top + 2), right: Math.min(innerWidth, r.right, c.right - 2), bottom: Math.min(innerHeight, r.bottom, c.bottom - 2) }; });
  const box = await clipped('#pdfCanvas'); expect(box.right - box.left).toBeGreaterThan(40); expect(box.bottom - box.top).toBeGreaterThan(40); const point = (x, y) => ({ x: box.left + (box.right - box.left) * x, y: box.top + (box.bottom - box.top) * y, id: 1 });
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(.2, .2)] }); await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(.65, .6)] }); await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await expect(page.locator('.redact-mask')).toHaveCount(1);
    const coordinates = await page.locator('#redactProperties input').evaluateAll((inputs) => inputs.map((input) => input.value)), placed = await clipped('.redact-mask'), center = { x: (placed.left + placed.right) / 2, y: (placed.top + placed.bottom) / 2, id: 2 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] }); await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...center, x: center.x + 10, y: center.y + 10 }] }); await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(page.locator('.redact-mask')).toHaveCount(1); expect(await page.locator('#redactProperties input').evaluateAll((inputs) => inputs.map((input) => input.value))).toEqual(coordinates); await expect(page.locator('.redact-mask-draft')).toHaveCount(0);
  } finally { await client.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await client.detach(); }
  await saveMask(page, MASK);
}

for (const width of [320, 390, 768, 1440]) test(`Redact native mask task fits ${width}px in English light and Arabic RTL dark with exact saved artifacts`, async ({ page }, info) => {
  const errors = watchErrors(page); await page.setViewportSize({ width, height: width < 500 ? 720 : 900 });
  for (const [locale, theme] of [['', 'light'], ['ar', 'dark']]) {
    await page.addInitScript((theme) => localStorage.setItem('pdf2md-theme', theme), theme); await boot(page, locale ? '/ar/redact' : '/redact');
    const file = await source('plain', `LAYOUT ${width}`); file.name = `İstanbul-redaction-review-${'meaningful-document-'.repeat(8)}${width}.pdf`; await intake(page, file); const original = await snapshot(page);
    const layout = await page.evaluate(() => { const canvas = document.getElementById('pdfCanvas').getBoundingClientRect(), container = document.getElementById('viewerContainer'), controls = [...document.querySelectorAll('#redactActions button')].map((button) => { const r = button.getBoundingClientRect(); return { id: button.id, left: r.left, right: r.right }; }); return { width: innerWidth, scroll: document.documentElement.scrollWidth, canvasTop: canvas.top, canvasHeight: canvas.height, visible: Math.max(0, Math.min(innerHeight, canvas.bottom) - Math.max(0, canvas.top)), required: Math.min(innerHeight * .35, canvas.height / 2), surface: container.clientWidth, surfaceScroll: container.scrollWidth, dir: getComputedStyle(document.documentElement).direction, declaredDir: document.documentElement.dir, theme: document.documentElement.dataset.theme, controls }; });
    expect(layout.scroll).toBeLessThanOrEqual(width); expect(layout.surfaceScroll).toBeLessThanOrEqual(layout.surface + 1); expect(layout.visible).toBeGreaterThanOrEqual(layout.required); expect(layout.dir).toBe(locale ? 'rtl' : 'ltr'); if (locale) expect(layout.declaredDir).toBe('rtl'); expect(layout.theme).toBe(theme); for (const control of layout.controls) { expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(width); }
    await expect(page.locator('#documentIdentity')).toHaveAttribute('aria-label', new RegExp(file.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); for (const name of await page.locator('.document-identity-name').all()) await expect(name).toHaveAttribute('title', file.name);
    await info.attach(`${width}-${locale || 'en'}-initial-layout`, { body: JSON.stringify(layout), contentType: 'application/json' }); await page.screenshot({ path: info.outputPath(`${width}-${locale || 'en'}-${theme}-initial.png`) });
    // Predict the real default mask in client coordinates, so the page's
    // existing scroll offsets and the viewport/container clip both count.
    const placementVisibility = (predicted) => page.evaluate((predicted) => {
      const surface = document.getElementById('readerPageSurface'), s = surface.getBoundingClientRect(), container = document.getElementById('viewerContainer'), c = container.getBoundingClientRect();
      const clip = { left: Math.max(0, c.left + container.clientLeft), top: Math.max(0, c.top + container.clientTop), right: Math.min(innerWidth, c.left + container.clientLeft + container.clientWidth), bottom: Math.min(innerHeight, c.top + container.clientTop + container.clientHeight) };
      const r = predicted ? { left: s.left + surface.clientWidth * .2, right: s.left + surface.clientWidth * .8, top: s.top + surface.clientHeight * .35, bottom: s.top + surface.clientHeight * .45, width: surface.clientWidth * .6, height: surface.clientHeight * .1 } : document.querySelector('.redact-mask').getBoundingClientRect();
      return { mask: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }, clip, horizontal: Math.max(0, Math.min(r.right, clip.right) - Math.max(r.left, clip.left)), vertical: Math.max(0, Math.min(r.bottom, clip.bottom) - Math.max(r.top, clip.top)), clippedVertical: r.top < clip.top || r.bottom > clip.bottom };
    }, predicted);
    let anticipated;
    for (let step = 0; step < 12; step++) { await page.click('#zoomInBtn'); await ready(page); await page.locator('#redactAddMaskBtn').focus(); anticipated = await placementVisibility(true); if (anticipated.clippedVertical) break; }
    expect(anticipated.clip.bottom).toBeGreaterThan(anticipated.clip.top); expect(anticipated.clippedVertical).toBe(true); await page.keyboard.press('Enter'); await expect(page.locator('.redact-mask')).toBeFocused();
    const reveal = await placementVisibility(false), clipWidth = reveal.clip.right - reveal.clip.left, clipHeight = reveal.clip.bottom - reveal.clip.top;
    expect(reveal.horizontal).toBeGreaterThanOrEqual(reveal.mask.width <= clipWidth ? reveal.mask.width : Math.min(reveal.mask.width, clipWidth / 2)); expect(reveal.vertical).toBeGreaterThanOrEqual(reveal.mask.height <= clipHeight ? reveal.mask.height : Math.min(reveal.mask.height, clipHeight / 2));
    await info.attach(`${width}-${locale || 'en'}-keyboard-placement-reveal`, { body: JSON.stringify({ anticipated, reveal }), contentType: 'application/json' });
    const x = Number(await page.locator('#redactMaskX').inputValue()); await page.keyboard.press('ArrowRight'); await expect(page.locator('#readerPage')).toHaveValue('1'); expect(Number(await page.locator('#redactMaskX').inputValue())).toBeCloseTo(x + 1, 3);
    await details(page.locator('#redactMaskX')); const control = page.locator('#redactMaskX'); await control.focus(); await control.press('ControlOrMeta+A'); const position = await page.evaluate(() => ({ top: scrollY, x: document.getElementById('viewerContainer').scrollLeft, y: document.getElementById('viewerContainer').scrollTop })); await page.keyboard.type('50'); await expect(control).toBeFocused(); expect(await page.evaluate(() => ({ top: scrollY, x: document.getElementById('viewerContainer').scrollLeft, y: document.getElementById('viewerContainer').scrollTop }))).toEqual(position);
    for (const [key, value] of Object.entries(MASK).filter(([key]) => key !== 'x')) await page.fill(`#redactMask${key[0].toUpperCase() + key.slice(1)}`, String(value)); await page.click('#redactSaveMaskBtn'); await expect(page.locator('#redactSaveMaskBtn')).toBeDisabled();
    if (width === 390) await touchMaskAndCancel(page);
    await review(page); const output = await download(page, info, `${width}-${locale || 'en'}-redacted.pdf`); await inspect(output); const facts = await pdfFacts(page, output); expect(facts.text[1]).toContain(`LAYOUT ${width} PAGE 2`); expect(facts.text[2]).toContain(`LAYOUT ${width} PAGE 3`); expect(await maskedPixels(page, file.buffer, output)).toEqual({ nonblack: 0, outside: 0 }); expect(await snapshot(page)).toEqual(original); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect(errors).toEqual([]);
});

test('Redact deliberately chosen actual clean download continues to Privacy Scan with the exact current bytes', async ({ page }, info) => {
  const errors = watchErrors(page); await page.route('**/js/core/privacy-scan.js', async (route) => { const response = await route.fetch(), body = await response.text(); expect(body).toContain('export async function scanPdfPrivacy('); await route.fulfill({ response, body: body.replace('export async function scanPdfPrivacy(', 'async function nativeScanPdfPrivacy(') + '\nexport async function scanPdfPrivacy(inputBytes, options) { const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", inputBytes))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); const report = await nativeScanPdfPrivacy(inputBytes, options); window.redactPrivacyObserved = { sha: hash, length: inputBytes.length, summary: summarizePrivacyReport(report) }; return report; }\n' }); });
  await boot(page); const file = await source(); await intake(page, file); const original = await snapshot(page); await addMask(page); await review(page); const output = await download(page, info, 'chosen-cleaned-before-privacy.pdf'); await inspect(output); await page.click('#useResultBtn'); await ready(page); const chosen = await snapshot(page); expect(sha(chosen.bytes)).toBe(sha(output)); expect(sha(chosen.original)).toBe(sha(file.buffer)); expect(chosen.state.taskId).toBe(original.state.taskId); expect(chosen.scene).toBeNull();
  await page.locator('#chainRow').getByRole('button', { name: 'Privacy Scan', exact: true }).click(); await expect(page).toHaveURL(/\/privacy-scan\?workflow=/); await expect(page.locator('#selectedFileName')).toHaveText(chosen.state.current.name); await expect(page.locator('#scanBtn')).toBeEnabled(); const arrived = await snapshot(page); expect(sha(arrived.bytes)).toBe(sha(output)); expect(sha(arrived.original)).toBe(sha(file.buffer)); expect(arrived.state.taskId).toBe(chosen.state.taskId); expect(arrived.scene).toBeNull();
  await page.click('#scanBtn'); await expect(page.locator('#scanResults')).toBeVisible(); const observed = await page.evaluate(() => window.redactPrivacyObserved); expect(observed.sha).toBe(sha(output)); expect(observed.length).toBe(output.length); expect(observed.summary.pageCount).toBe(3); expect(observed.summary.counts.standardMetadata).toBe(0); expect(observed.summary.counts.xmp).toBe(0); expect(observed.summary.counts.forms).toBe(0); expect(await snapshot(page)).toEqual(arrived); await info.attach('actual-chosen-privacy-digests', { body: JSON.stringify({ downloadedSha: sha(output), currentSha: sha(arrived.bytes), scanned: observed }), contentType: 'application/json' }); expect(errors).toEqual([]);
});

async function observePreviewHandlers(page) {
  await page.addInitScript(() => {
    window.redactPreviewHandlers = []; const native = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (type !== 'click' || typeof listener !== 'function') return native.call(this, type, listener, options);
      return native.call(this, type, function(event) {
        if (!(this instanceof Element) || !['redactCancelBtn', 'redactRetryBtn', 'redactUndoDocumentBtn', 'redactRedoDocumentBtn'].includes(this.id)) return listener.call(this, event);
        const record = { id: this.id, settled: false }; window.redactPreviewHandlers.push(record); const result = listener.call(this, event); record.promise = !!result?.then;
        Promise.resolve(result).then(() => { record.settled = true; }, (error) => { record.settled = true; record.error = error.name; }); return result;
      }, options);
    };
  });
}
async function previewAction(page, id, held = false) {
  const index = await page.evaluate(() => window.redactPreviewHandlers.length); await page.click(`#${id}`);
  await expect.poll(() => page.evaluate((index) => window.redactPreviewHandlers[index]?.promise, index)).toBe(true);
  if (held) expect(await page.evaluate((index) => window.redactPreviewHandlers[index].settled, index)).toBe(false);
  return index;
}
async function handlerSettled(page, index) { await expect.poll(() => page.evaluate((index) => window.redactPreviewHandlers[index]?.settled, index)).toBe(true); }
async function holdCompletedPreview(page, bytes, { connected = false, reject = false } = {}) {
  await page.evaluate(async ({ bytes, connected, reject }) => {
    const runtime = await import(new URL('./lib-loader.js', document.querySelector('script[type=module][src^="js/"]').src).href), task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS }); let prototype;
    try { prototype = Object.getPrototypeOf(await (await task.promise).getPage(1)); } finally { await task.destroy(); }
    const render = prototype.render; let claimed = false; window.redactPreviewHeld = null; window.restoreRedactPreviewRender = () => { prototype.render = render; };
    prototype.render = function(...args) {
      const native = render.apply(this, args), canvas = args[0]?.canvasContext?.canvas; if (claimed || !canvas || canvas.isConnected !== connected) return native; claimed = true;
      const promise = native.promise.then(async (value) => { window.redactPreviewHeld = { completed: true, connected: canvas.isConnected, width: canvas.width, height: canvas.height, released: false, settled: false }; await new Promise((resolve) => { window.releaseRedactPreviewRender = resolve; }); window.redactPreviewHeld.released = true; if (reject) throw new Error('Injected completed current-preview failure'); return value; });
      void promise.then(() => { if (window.redactPreviewHeld) window.redactPreviewHeld.settled = true; }, () => { if (window.redactPreviewHeld) window.redactPreviewHeld.settled = true; });
      return { promise, cancel: () => native.cancel() };
    };
  }, { bytes: [...bytes], connected, reject });
}
async function previewHeld(page, connected = false) { await expect.poll(() => page.evaluate(() => window.redactPreviewHeld?.completed)).toBe(true); const held = await page.evaluate(() => window.redactPreviewHeld); expect(held.connected).toBe(connected); expect(held.width * held.height).toBeGreaterThan(0); }
async function releasePreview(page) { await page.evaluate(() => { window.restoreRedactPreviewRender(); window.releaseRedactPreviewRender(); }); await expect.poll(() => page.evaluate(() => window.redactPreviewHeld.released)).toBe(true); }
async function inaccessiblePreview(page, phase) {
  await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-preview-state', phase); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'true');
  for (const id of ['readerPageSurface', 'readerPanels', 'readerStatus']) { const item = page.locator(`#${id}`); await expect(item).toBeHidden(); await expect(item).toHaveAttribute('aria-hidden', 'true'); expect(await item.evaluate((node) => node.inert)).toBe(true); }
  for (const id of ['redactAddMaskBtn', 'redactApplyBtn', 'redactUndoDocumentBtn', 'redactRedoDocumentBtn', 'readerPage', 'printBtn']) await expect(page.locator(`#${id}`)).toBeDisabled();
  for (const mode of await page.locator('#workspaceModes button').all()) await expect(mode).toBeDisabled();
  expect(await page.locator('#readerSearchQuery').evaluate((input) => { input.focus(); return document.activeElement === input; })).toBe(false);
  await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden();
  if (phase === 'blocked') { await expect(page.locator('#redactRetryBtn')).toBeVisible(); await expect(page.locator('#redactRetryBtn')).toBeEnabled(); await expect(page.locator('#redactStatus')).toContainText('current document remains selected'); }
}
async function previewPixels(page, bytes, fontSmoothing = 'auto') {
  return page.evaluate(async ({ bytes, fontSmoothing }) => {
    const runtime = await import(new URL('./lib-loader.js', document.querySelector('script[type=module][src^="js/"]').src).href), renderer = await import(new URL('./core/bounded-renderer.js', document.querySelector('script[type=module][src^="js/"]').src).href), task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS }), visible = document.getElementById('pdfCanvas'), surface = document.getElementById('readerPageSurface'), probe = document.createElement('canvas');
    probe.style.cssText = visible.style.cssText; probe.style.webkitFontSmoothing = fontSmoothing; Object.assign(probe.style, { position: 'absolute', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none' }); surface.append(probe);
    try { const pdf = await task.promise, page = await pdf.getPage(Number(document.getElementById('readerPage').value)), scale = Number(surface.style.getPropertyValue('--total-scale-factor')) / page.userUnit, displayViewport = page.getViewport({ scale }); await renderer.renderBoundedPage(page, probe, { scale, displayViewport, maxDimension: 1200, maxPixels: 2000000 }); const a = visible.getContext('2d').getImageData(0, 0, visible.width, visible.height).data, b = probe.getContext('2d').getImageData(0, 0, probe.width, probe.height).data; let changed = 0; if (a.length === b.length) for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) changed++; return { sameLength: a.length === b.length, changed }; }
    finally { probe.remove(); probe.width = probe.height = 0; await task.destroy(); }
  }, { bytes: [...bytes], fontSmoothing });
}
async function retryPreview(page, expected, bytes) {
  const action = await previewAction(page, 'redactRetryBtn'); await handlerSettled(page, action); await ready(page); await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-preview-state', 'ready'); expect(await snapshot(page)).toEqual(expected); expect(await previewPixels(page, bytes)).toEqual({ sameLength: true, changed: 0 }); await expect(page.locator('#readerPage')).toHaveValue('1');
  for (const id of ['readerPageSurface', 'readerPanels', 'readerStatus']) { expect(await page.locator(`#${id}`).evaluate((node) => node.inert)).toBe(false); await expect(page.locator(`#${id}`)).toHaveAttribute('aria-hidden', 'false'); }
}
async function preparePreviewCase(page, info) {
  await observePreviewHandlers(page); await boot(page); const file = await source(); await intake(page, file);
  await page.locator('#readerSearch>summary').click(); await page.fill('#readerSearchQuery', SECRET); await page.click('#readerSearchBtn'); await expect(page.locator('#readerSearchResults li')).toHaveCount(1);
  await page.locator('#readerThumbnails>summary').click(); await expect(page.locator('#readerThumbnailItems canvas')).toHaveCount(3);
  await addMask(page); await review(page); const output = await download(page, info, 'clean-before-preview-transition.pdf'); await inspect(output); const before = await snapshot(page); return { file, output, before };
}
async function chosenPreviewCase(page, info) { const value = await preparePreviewCase(page, info); await page.click('#useResultBtn'); await ready(page); const chosen = await snapshot(page); expect(sha(chosen.bytes)).toBe(sha(value.output)); return { ...value, chosen }; }
async function cancelPreview(page, expected) {
  const cancel = await previewAction(page, 'redactCancelBtn', true); await inaccessiblePreview(page, 'pending'); expect(await snapshot(page)).toEqual(expected); await releasePreview(page); await handlerSettled(page, cancel); await inaccessiblePreview(page, 'blocked'); expect(await snapshot(page)).toEqual(expected);
}

test('Redact continuation requires explicit Use and verified current preview before native Privacy handoff', async ({ page }, info) => {
  const errors = watchErrors(page); await boot(page); const file = await source(); await intake(page, file); const original = await snapshot(page); await addMask(page);
  const drafts = () => page.locator('#redactMaskLayer').evaluate((layer) => ({ masks: [...layer.querySelectorAll('[data-mask-id]')].map((mask) => ({ id: mask.dataset.maskId, style: mask.getAttribute('style') })), coordinates: Object.fromEntries([...document.querySelectorAll('#redactProperties input')].map((input) => [input.id, input.value])) }));
  const masks = await drafts(); expect(masks.masks).toHaveLength(1); await expect(page.locator('#readerTextLayer')).toContainText(SECRET);
  await review(page); await expect.poll(() => page.evaluate(() => window.redactReviewSettled)).toBe(true); await ready(page); await expect(page.locator('#redactStatus')).toContainText('Use this cleaned result to continue'); await expect(page.locator('#useResultBtn')).toBeEnabled(); await expect(page.locator('#chainRow')).toBeHidden(); await expect(page.locator('#chainRow button:visible:enabled')).toHaveCount(0);
  const output = await download(page, info, 'cleaned-before-use-prerequisite.pdf'); await inspect(output); const facts = await pdfFacts(page, output); expect(facts.text[0]).toBe(''); expect(facts.text[1]).toContain('SAFE PAGE 2'); expect(await maskedPixels(page, file.buffer, output)).toEqual({ nonblack: 0, outside: 0 });
  expect(await snapshot(page)).toEqual(original); expect(await drafts()).toEqual(masks); await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-masks', '1'); await expect(page.locator('#chainRow')).toBeHidden(); await expect(page.locator('#chainRow button:visible:enabled')).toHaveCount(0);
  await holdCompletedPreview(page, output); await page.click('#useResultBtn'); await previewHeld(page); expect(await page.evaluate(() => window.redactPreviewHeld.settled)).toBe(false); await inaccessiblePreview(page, 'pending'); await expect(page.locator('#chainRow button:visible:enabled')).toHaveCount(0);
  const chosen = await snapshot(page); expect(sha(chosen.bytes)).toBe(sha(output)); expect(chosen.original).toEqual(original.original); expect(chosen.state.taskId).toBe(original.state.taskId); expect(chosen.state.revision).toBe(original.state.revision + 1); expect(chosen.state.generation).toBe(original.state.generation + 1); expect(chosen.scene).toBeNull(); await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-masks', '0');
  await releasePreview(page); await expect.poll(() => page.evaluate(() => window.redactPreviewHeld.settled)).toBe(true); await ready(page); await expect(page.locator('#viewerSection')).toHaveAttribute('data-redact-preview-state', 'ready'); expect(await snapshot(page)).toEqual(chosen); expect(await previewPixels(page, output)).toEqual({ sameLength: true, changed: 0 }); await expect(page.locator('#readerTextLayer')).not.toContainText(SECRET); await expect(page.locator('#documentResultPreview')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#useResultBtn')).toHaveCount(0);
  const privacy = page.locator('#chainRow').getByRole('button', { name: 'Privacy Scan', exact: true }); await expect(privacy).toBeVisible(); await expect(privacy).toBeEnabled(); await privacy.click(); await expect(page).toHaveURL(/\/privacy-scan\?workflow=/); await expect(page.locator('#selectedFileName')).toHaveText(chosen.state.current.name); await expect(page.locator('#scanBtn')).toBeEnabled();
  const arrived = await snapshot(page); expect(sha(arrived.bytes)).toBe(sha(output)); expect(arrived.original).toEqual(original.original); expect(arrived.state.taskId).toBe(chosen.state.taskId); expect(arrived.state.revision).toBe(chosen.state.revision); expect(arrived.scene).toBeNull(); await info.attach('use-prerequisite-privacy-digests', { body: JSON.stringify({ downloadedSha: sha(output), chosenSha: sha(chosen.bytes), privacySha: sha(arrived.bytes), originalSha: sha(arrived.original), taskId: arrived.state.taskId, revision: arrived.state.revision }), contentType: 'application/json' }); expect(errors).toEqual([]);
});

test('Redact current preview Use Cancel drains without exposing source pixels text or side panels and Retry verifies chosen bytes', async ({ page }, info) => {
  const errors = watchErrors(page), { file, output, before } = await preparePreviewCase(page, info); await holdCompletedPreview(page, output); await page.click('#useResultBtn'); await previewHeld(page); const chosen = await snapshot(page); expect(sha(chosen.bytes)).toBe(sha(output)); expect(sha(chosen.original)).toBe(sha(file.buffer)); expect(chosen.state.taskId).toBe(before.state.taskId); await inaccessiblePreview(page, 'pending');
  await cancelPreview(page, chosen); await retryPreview(page, chosen, output); await expect(page.locator('#readerTextLayer')).not.toContainText(SECRET); const privacy = page.locator('#chainRow').getByRole('button', { name: 'Privacy Scan', exact: true }); await expect(privacy).toBeVisible(); await expect(privacy).toBeEnabled(); const recovered = await download(page, info, 'verified-current-after-use-cancel.pdf'); expect(sha(recovered)).toBe(sha(output)); await inspect(recovered); expect((await snapshot(page)).state.current.boundary.losses).toEqual(chosen.state.current.boundary.losses); expect(errors).toEqual([]);
});

test('Redact current preview Retry Cancel retains a failed chosen preview lock until an actual successful Retry', async ({ page }, info) => {
  const errors = watchErrors(page), { output } = await preparePreviewCase(page, info); await holdCompletedPreview(page, output, { reject: true }); await page.click('#useResultBtn'); await previewHeld(page); const chosen = await snapshot(page); await releasePreview(page); await inaccessiblePreview(page, 'blocked'); await expect(page.locator('#errorText')).toContainText('Injected completed current-preview failure');
  await holdCompletedPreview(page, output); const retry = await previewAction(page, 'redactRetryBtn', true); await previewHeld(page); await inaccessiblePreview(page, 'pending'); await cancelPreview(page, chosen); await handlerSettled(page, retry); await retryPreview(page, chosen, output); const recovered = await download(page, info, 'verified-current-after-retry-cancel.pdf'); expect(sha(recovered)).toBe(sha(output)); expect(errors).toEqual([]);
});

test('Redact current preview Undo and Redo Cancel retain the deliberately requested canonical history version until Retry', async ({ page }, info) => {
  const errors = watchErrors(page), { file, output, chosen } = await chosenPreviewCase(page, info);
  for (const [kind, bytes] of [['Undo', file.buffer], ['Redo', output]]) { await holdCompletedPreview(page, bytes); const action = await previewAction(page, `redact${kind}DocumentBtn`, true); await previewHeld(page); const requested = await snapshot(page); expect(sha(requested.bytes)).toBe(sha(bytes)); expect(sha(requested.original)).toBe(sha(file.buffer)); expect(requested.state.taskId).toBe(chosen.state.taskId); await inaccessiblePreview(page, 'pending'); await cancelPreview(page, requested); await handlerSettled(page, action); await retryPreview(page, requested, bytes); if (kind === 'Undo') await expect(page.locator('#readerTextLayer')).toContainText(SECRET); else await expect(page.locator('#readerTextLayer')).not.toContainText(SECRET); }
  const redone = await download(page, info, 'verified-redone-after-history-cancel.pdf'); expect(sha(redone)).toBe(sha(output)); expect(errors).toEqual([]);
});

test('Redact current preview non-Abort Undo and Redo failures preserve requested history and recover exact pixels through Retry', async ({ page }, info) => {
  const errors = watchErrors(page), { file, output, chosen } = await chosenPreviewCase(page, info);
  for (const [kind, bytes] of [['Undo', file.buffer], ['Redo', output]]) { await holdCompletedPreview(page, bytes, { reject: true }); const action = await previewAction(page, `redact${kind}DocumentBtn`, true); await previewHeld(page); const requested = await snapshot(page); expect(sha(requested.bytes)).toBe(sha(bytes)); expect(requested.state.taskId).toBe(chosen.state.taskId); await releasePreview(page); await handlerSettled(page, action); await inaccessiblePreview(page, 'blocked'); expect(await snapshot(page)).toEqual(requested); await expect(page.locator('#errorText')).toContainText('Injected completed current-preview failure'); await retryPreview(page, requested, bytes); }
  const redone = await download(page, info, 'verified-redone-after-history-failure.pdf'); expect(sha(redone)).toBe(sha(output)); expect(errors).toEqual([]);
});

test('Redact current preview held adoption cannot publish over a valid replacement while its old native job drains', async ({ page }, info) => {
  const errors = watchErrors(page), { output } = await preparePreviewCase(page, info); await details(page.locator('#fileInput')); await holdCompletedPreview(page, output); await page.click('#useResultBtn'); await previewHeld(page); await inaccessiblePreview(page, 'pending');
  const file = await source('plain', 'NEW B'); await page.setInputFiles('#fileInput', file); await expect.poll(async () => (await sessionState(page)).current?.name).toBe(file.name); const committed = await snapshot(page); expect(sha(committed.bytes)).toBe(sha(file.buffer)); await expect(page.locator('#redactTransitionStatus')).toBeVisible(); await releasePreview(page); await ready(page, file.name); expect(await snapshot(page)).toEqual({ ...committed, state: { ...committed.state, selection: [0] } }); expect(await previewPixels(page, file.buffer, 'antialiased')).toEqual({ sameLength: true, changed: 0 }); await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden(); await freshArtifact(page, info, file, 'new-B-after-held-current-preview.pdf'); expect(errors).toEqual([]);
});

test('Redact current preview Clear abandons held adoption and leaves fresh native B as the only usable document', async ({ page }, info) => {
  const errors = watchErrors(page), { output } = await preparePreviewCase(page, info); await details(page.locator('#redactClearDocumentBtn')); await holdCompletedPreview(page, output); await page.click('#useResultBtn'); await previewHeld(page); await page.click('#redactClearDocumentBtn'); expect((await sessionState(page)).taskId).toBeNull(); await expect(page.locator('#documentIdentity')).toHaveCount(0); await expect(page.locator('#viewerSection')).toHaveCount(0); await releasePreview(page);
  const file = await source('plain', 'NEW B'); await intake(page, file); expect(sha((await snapshot(page)).bytes)).toBe(sha(file.buffer)); expect(await previewPixels(page, file.buffer, 'antialiased')).toEqual({ sameLength: true, changed: 0 }); await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden(); await freshArtifact(page, info, file, 'new-B-after-cleared-current-preview.pdf'); expect(errors).toEqual([]);
});

test('Redact current preview initial completed render failure exposes owned Retry and recovers the actual source before export', async ({ page }, info) => {
  const errors = watchErrors(page); await observePreviewHandlers(page); await boot(page); const file = await source(); await holdCompletedPreview(page, file.buffer, { connected: true, reject: true }); await page.setInputFiles('#fileInput', file); await previewHeld(page, true); await releasePreview(page); await inaccessiblePreview(page, 'blocked'); const failed = await snapshot(page); expect(sha(failed.bytes)).toBe(sha(file.buffer));
  await retryPreview(page, { ...failed, state: { ...failed.state, selection: [0] } }, file.buffer); await expect(page.locator('#readerTextLayer')).toContainText(SECRET); await addMask(page); await review(page); const output = await download(page, info, 'clean-after-initial-preview-retry.pdf'); await inspect(output); expect(await maskedPixels(page, file.buffer, output)).toEqual({ nonblack: 0, outside: 0 }); expect(errors).toEqual([]);
});
