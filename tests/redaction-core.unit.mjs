import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import * as lib from 'pdf-lib';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { inspectRedaction, redactPdf, inflateRedactionStream, REDACTION_LIMITS } from '../public/js/core/redaction.js';
import { parseRedactionPrimitives } from '../public/js/core/redaction-primitives.js';
import { createDocumentSession } from '../public/js/core/document-session.js';
globalThis.DOMMatrix = DOMMatrix; globalThis.ImageData = ImageData; globalThis.Path2D = Path2D;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const assets = { standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname };
const SECRET = 'REDACTION-UNIQUE-SECRET-2026-88';
const INFO = 'PRIVATE-INFO-SECRET-2026-22', XMP = 'PRIVATE-XMP-SECRET-2026-33';
const MASK = { pageIndex: 0, x: 50, y: 590, width: 490, height: 45 };
function trackedCanvas() {
  const native = createCanvas(1, 1); let width = 1, height = 1;
  return { get width() { return width; }, set width(value) { width = value; native.width = Math.max(1, value); }, get height() { return height; }, set height(value) { height = value; native.height = Math.max(1, value); }, getContext: (...args) => native.getContext(...args), toBuffer: (...args) => native.toBuffer(...args) };
}
const environment = { pdfLib: lib, pdfjs, pdfjsAssets: assets, canvasFactory: trackedCanvas, encodeCanvas: async (canvas) => new Uint8Array(canvas.toBuffer('image/png')) };
function metadata(doc) { doc.setTitle(INFO); doc.setAuthor(INFO); doc.catalog.set(lib.PDFName.of('Metadata'), doc.context.register(doc.context.flateStream(new TextEncoder().encode(`<x:xmpmeta xmlns:x="adobe:ns:meta/">${XMP}</x:xmpmeta>`), { Type: 'Metadata', Subtype: 'XML' }))); }
async function fixture(kind = 'plain') {
  const doc = await lib.PDFDocument.create(), font = await doc.embedFont(lib.StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) { const page = doc.addPage([600, 800]); page.drawText(`SAFE PAGE ${i + 1}`, { x: 50, y: 720, size: 18, font }); if (!i) page.drawText(SECRET, { x: 50, y: 605, size: 18, font }); }
  metadata(doc);
  if (kind === 'form') { const field = doc.getForm().createTextField('REPEATED'); field.setText('field'); for (const index of [0, 1]) field.addToPage(doc.getPage(index), { x: 50, y: 300, width: 120, height: 24 }); }
  if (kind === 'link') doc.getPage(1).node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 200, 100, 220], Dest: [doc.getPage(0).ref, 'Fit'] })));
  return new Uint8Array(await doc.save());
}
async function allObjects(bytes) {
  const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }), parts = [Buffer.from(bytes).toString('latin1')]; let pages = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) { parts.push(object.toString()); if (object instanceof lib.PDFPageLeaf) pages++; if (object instanceof lib.PDFRawStream) { parts.push(Buffer.from(object.getContents()).toString('latin1')); parts.push(Buffer.from(lib.decodePDFRawStream(object).decode()).toString('latin1')); } }
  return { doc, pages, content: parts.join('\n').toLowerCase() };
}
function absent(content, secret) { for (const form of [secret, Buffer.from(secret).toString('hex'), [...secret].map((char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')]) assert.equal(content.includes(form.toLowerCase()), false, `secret must be absent from every raw/decoded object: ${secret}`); }
async function withPdf(bytes, inspect) { const task = pdfjs.getDocument({ data: bytes.slice(), ...assets }); try { return await inspect(await task.promise); } finally { await task.destroy(); } }
async function textPages(bytes) { return withPdf(bytes, async (pdf) => { const pages = []; for (let i = 1; i <= pdf.numPages; i++) pages.push((await (await pdf.getPage(i)).getTextContent()).items.map((item) => item.str).join(' ')); return pages; }); }
async function render(bytes, index, scale = 1) { return withPdf(bytes, async (pdf) => { const page = await pdf.getPage(index + 1), viewport = page.getViewport({ scale }), canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height)); await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; return { width: canvas.width, height: canvas.height, data: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, transform: viewport.transform, view: page.view, unit: page.userUnit, rotation: page.rotate }; }); }

test('strict fresh reconstruction removes all-object secrets/Info/XMP while untouched pages retain actual selectable text', async () => {
  const bytes = await fixture(), before = bytes.slice(), session = createDocumentSession(); session.begin(bytes, 'immutable.pdf'); const original = session.transfer();
  const options = { mode: 'hybrid', scale: 1, masks: [MASK] }, inspection = await inspectRedaction(bytes, options, environment);
  assert.equal(inspection.supported, true); assert.equal(inspection.rasterPages.length, 1); assert.equal(inspection.totalPixels, 480000);
  const output = await redactPdf(bytes, options, environment), found = await allObjects(output.bytes);
  for (const secret of [SECRET, INFO, XMP]) absent(found.content, secret);
  assert.equal(found.pages, 3); assert.equal(found.doc.context.trailerInfo.Info, undefined); assert.equal(found.doc.catalog.get(lib.PDFName.of('Metadata')), undefined);
  const text = await textPages(output.bytes); assert.equal(text[0], ''); assert.match(text[1], /SAFE PAGE 2/); assert.match(text[2], /SAFE PAGE 3/);
  assert.deepEqual(output.capabilities, { encrypted: false, searchable: true, forms: false, rasterized: true });
  assert.deepEqual(bytes, before); assert.deepEqual(session.transfer(), original);
  session.adopt(output.bytes, 'cleaned.pdf', output); assert.equal(session.scene(), null); assert.deepEqual(session.original().bytes, before); session.undo(); assert.deepEqual(session.current().bytes, before);
  assert.deepEqual((await redactPdf(bytes, options, environment)).bytes, output.bytes);
});

test('source orphans, private resource names/comments and unreferenced metadata never enter the fresh graph', async () => {
  const original = await lib.PDFDocument.load(await fixture(), { updateMetadata: false }), safe = original.getPage(1), font = await original.embedFont(lib.StandardFonts.Courier);
  safe.node.setFontDictionary(lib.PDFName.of(SECRET), font.ref);
  safe.node.addContentStream(original.context.register(original.context.flateStream(`% ${SECRET}\n`)));
  const orphan = lib.PDFPage.create(original); orphan.drawText(SECRET, { x: 20, y: 20, size: 12 });
  original.context.register(original.context.flateStream(`<secret>${SECRET}</secret>`, { Type: 'Metadata', Subtype: 'XML' }));
  const bytes = new Uint8Array(await original.save()), source = await allObjects(bytes); assert.equal(source.pages, 4);
  const output = await redactPdf(bytes, { mode: 'hybrid', scale: 1, masks: [MASK] }, environment), found = await allObjects(output.bytes);
  assert.equal(found.pages, 3); for (const secret of [SECRET, INFO, XMP]) absent(found.content, secret); assert.match((await textPages(output.bytes))[1], /SAFE PAGE 2/);
});

test('unknown font encodings and nonprimitive resources fail closed without changing the selected source', async () => {
  for (const change of ['encoding', 'resource', 'operator']) {
    const doc = await lib.PDFDocument.load(await fixture(), { updateMetadata: false }), page = doc.getPage(1);
    if (change === 'encoding') { const fonts = page.node.Resources().lookup(lib.PDFName.of('Font')); doc.context.lookup(fonts.values()[0]).set(lib.PDFName.of('Encoding'), doc.context.obj({ BaseEncoding: 'WinAnsiEncoding', Differences: [65, 'secret'] })); }
    if (change === 'resource') page.node.Resources().set(lib.PDFName.of('ExtGState'), doc.context.obj({ private: doc.getPage(0).ref }));
    if (change === 'operator') page.node.addContentStream(doc.context.register(doc.context.flateStream('/private Do')));
    const bytes = new Uint8Array(await doc.save()), before = bytes.slice(), value = { mode: 'hybrid', scale: 1, masks: [MASK] };
    assert.equal((await inspectRedaction(bytes, value, environment)).supported, false); await assert.rejects(redactPdf(bytes, value, environment), { name: 'RedactionUnsupportedError' }); assert.deepEqual(bytes, before);
  }
});

for (const kind of ['form', 'link']) test(`${kind} reference graphs require explicit full raster and cannot reintroduce replaced/orphan pages`, async () => {
  const bytes = await fixture(kind), before = bytes.slice(), options = { mode: 'hybrid', scale: 1, masks: [MASK] };
  const inspection = await inspectRedaction(bytes, options, environment); assert.equal(inspection.supported, false); assert.equal(inspection.fallback, 'raster'); assert.match(inspection.reason, /unsupported/i);
  await assert.rejects(redactPdf(bytes, options, environment), { name: 'RedactionUnsupportedError' }); assert.deepEqual(bytes, before);
  const output = await redactPdf(bytes, { ...options, mode: 'raster' }, environment), found = await allObjects(output.bytes);
  assert.equal(found.pages, 3); for (const secret of [SECRET, INFO, XMP]) absent(found.content, secret);
  assert.deepEqual(await textPages(output.bytes), ['', '', '']); assert.deepEqual(output.capabilities, { encrypted: false, searchable: false, forms: false, rasterized: true });
  assert.ok(output.boundary.losses.includes('redaction-document-rasterized'));
});

test('four rotations preserve all boxes/UserUnit/physical size and exact opaque mask pixels in the saved PDF', async () => {
  const doc = await lib.PDFDocument.create(), font = await doc.embedFont(lib.StandardFonts.Helvetica), masks = [];
  for (const [index, rotation] of [0, 90, 180, 270].entries()) {
    const page = doc.addPage([400, 320]); page.setCropBox(20, 30, 320, 240); page.setRotation(lib.degrees(rotation)); page.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(index % 2 + 1));
    page.drawText(SECRET, { x: 50, y: 165, size: 12, font }); page.drawRectangle({ x: 45, y: 55, width: 60, height: 40, color: lib.rgb(0, 1, 0) }); page.drawRectangle({ x: 240, y: 220, width: 50, height: 30, color: lib.rgb(0, 0, 1) });
    masks.push({ pageIndex: index, x: 50, y: 150, width: 280, height: 40 });
  }
  metadata(doc); const bytes = new Uint8Array(await doc.save()), output = await redactPdf(bytes, { masks, mode: 'hybrid', scale: 2 }, environment), found = await allObjects(output.bytes);
  for (const secret of [SECRET, INFO, XMP]) absent(found.content, secret); assert.equal(found.pages, 4);
  await withPdf(bytes, async (source) => {
    for (let index = 0; index < 4; index++) {
      const before = await render(bytes, index, 2), after = await render(output.bytes, index, 2); assert.deepEqual([after.width, after.height, after.transform, after.view, after.unit, after.rotation], [before.width, before.height, before.transform, before.view, before.unit, before.rotation]);
      const viewport = (await source.getPage(index + 1)).getViewport({ scale: 2 }), mask = masks[index], points = [[mask.x, mask.y], [mask.x + mask.width, mask.y + mask.height]].map(([x, y]) => viewport.convertToViewportPoint(x, y));
      const left = Math.floor(Math.min(points[0][0], points[1][0])), right = Math.ceil(Math.max(points[0][0], points[1][0])), top = Math.floor(Math.min(points[0][1], points[1][1])), bottom = Math.ceil(Math.max(points[0][1], points[1][1]));
      for (let y = 0; y < after.height; y++) for (let x = 0; x < after.width; x++) {
        const offset = (y * after.width + x) * 4;
        if (x >= left && x < right && y >= top && y < bottom) assert.deepEqual([...after.data.subarray(offset, offset + 4)], [0, 0, 0, 255]);
        else assert.deepEqual([...after.data.subarray(offset, offset + 4)], [...before.data.subarray(offset, offset + 4)], `saved/source pixel ${index}:${x},${y}`);
      }
      assert.deepEqual(found.doc.getPage(index).getMediaBox(), doc.getPage(index).getMediaBox()); assert.deepEqual(found.doc.getPage(index).getCropBox(), doc.getPage(index).getCropBox());
    }
  });
});

test('fractional CropBoxes keep exact requested-scale pixels at visual top-left for all rotations and UserUnit 1/2', async () => {
  const doc = await lib.PDFDocument.create(), font = await doc.embedFont(lib.StandardFonts.Helvetica), masks = [], shapes = [];
  for (const rotation of [0, 90, 180, 270]) for (const unit of [1, 2]) {
    const index = masks.length, page = doc.addPage([400.75, 320.75]); page.setCropBox(20.1, 30.1, 320.1375, 240.2375); page.setRotation(lib.degrees(rotation)); page.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(unit));
    page.drawRectangle({ x: 20.1, y: 30.1, width: 320.1375, height: 240.2375, color: lib.rgb(1, 1, 1) });
    page.drawText(SECRET, { x: 50.1, y: 165, size: 10, font }); page.drawRectangle({ x: 45.2, y: 55.3, width: 60.4, height: 40.2, color: lib.rgb(0, 1, 0) }); page.drawRectangle({ x: 260.3, y: 220.2, width: 50.1, height: 30.2, color: lib.rgb(0, 0, 1) });
    masks.push({ pageIndex: index, x: 50.1, y: 150.1, width: 200, height: 40 }); shapes.push({ media: page.getMediaBox(), crop: page.getCropBox(), rotation, unit });
  }
  metadata(doc); const bytes = new Uint8Array(await doc.save());
  await withPdf(bytes, async (source) => {
    for (const scale of [1, 2]) {
      const output = await redactPdf(bytes, { masks, mode: 'hybrid', scale }, environment), found = await allObjects(output.bytes);
      assert.equal(found.pages, 8); for (const secret of [SECRET, INFO, XMP]) absent(found.content, secret);
      for (let index = 0; index < masks.length; index++) {
        const before = await render(bytes, index, scale), after = await render(output.bytes, index, scale), viewport = (await source.getPage(index + 1)).getViewport({ scale });
        assert.notEqual(viewport.width, Math.floor(viewport.width)); assert.notEqual(viewport.height, Math.floor(viewport.height));
        assert.deepEqual([after.width, after.height, after.transform, after.view, after.unit, after.rotation], [before.width, before.height, before.transform, before.view, before.unit, before.rotation]);
        const saved = found.doc.getPage(index); assert.deepEqual(saved.getMediaBox(), shapes[index].media); assert.deepEqual(saved.getCropBox(), shapes[index].crop); assert.equal(saved.getRotation().angle, shapes[index].rotation); assert.equal(saved.node.lookup(lib.PDFName.of('UserUnit')).asNumber(), shapes[index].unit);
        const mask = masks[index], points = [[mask.x, mask.y], [mask.x + mask.width, mask.y], [mask.x + mask.width, mask.y + mask.height], [mask.x, mask.y + mask.height]].map(([x, y]) => viewport.convertToViewportPoint(x, y));
        const left = Math.floor(Math.min(...points.map((point) => point[0]))), right = Math.ceil(Math.max(...points.map((point) => point[0]))), top = Math.floor(Math.min(...points.map((point) => point[1]))), bottom = Math.ceil(Math.max(...points.map((point) => point[1])));
        let insideNonblack = 0, outsideChanged = 0;
        for (let y = 0; y < after.height; y++) for (let x = 0; x < after.width; x++) { const offset = (y * after.width + x) * 4; if (x >= left && x < right && y >= top && y < bottom) { if (after.data[offset] || after.data[offset + 1] || after.data[offset + 2] || after.data[offset + 3] !== 255) insideNonblack++; } else { for (let channel = 0; channel < 4; channel++) if (after.data[offset + channel] !== before.data[offset + channel]) { outsideChanged++; break; } } }
        assert.equal(insideNonblack, 0, `opaque fractional mask: scale${scale}/rot${shapes[index].rotation}/unit${shapes[index].unit}`); assert.equal(outsideChanged, 0, `unchanged fractional source pixels: scale${scale}/rot${shapes[index].rotation}/unit${shapes[index].unit}`);
      }
    }
  });
});

test('mask validation is finite, page scoped, nonempty, count/plan bounded and rejects without allocating output', async () => {
  const bytes = await fixture(); let allocated = 0;
  const guarded = { ...environment, pdfLib: { ...lib, PDFDocument: { load: lib.PDFDocument.load, create: () => { allocated++; assert.fail('invalid masks cannot allocate output'); } } } };
  for (const masks of [[], [{ ...MASK, pageIndex: 3 }], [{ ...MASK, x: -1 }], [{ ...MASK, x: Infinity }], [{ ...MASK, width: 0 }], [{ ...MASK, x: 599, width: 2 }], Array.from({ length: 101 }, () => MASK), Array.from({ length: 301 }, (_, i) => ({ ...MASK, pageIndex: i % 3 }))]) await assert.rejects(redactPdf(bytes, { masks, mode: 'hybrid', scale: 1 }, guarded), RangeError);
  assert.equal(allocated, 0); assert.ok(REDACTION_LIMITS.maskPlanBytes < REDACTION_LIMITS.primitivePlanBytes);
});

test('per-page and aggregate requested resolution rejects before canvas/PDF embedding and never silently rescales', async () => {
  let canvases = 0, creates = 0;
  const guarded = { ...environment, canvasFactory: () => { canvases++; assert.fail('preflight must allocate no canvas'); }, pdfLib: { ...lib, PDFDocument: { load: lib.PDFDocument.load, create: () => { creates++; assert.fail('preflight must allocate no output'); } } } };
  for (const [width, height, count, scale, expected] of [[3000, 100, 1, 2, /4096/], [4000, 4000, 4, 1, /48 million/]]) {
    const doc = await lib.PDFDocument.create(); for (let i = 0; i < count; i++) doc.addPage([width, height]); const bytes = new Uint8Array(await doc.save());
    await assert.rejects(redactPdf(bytes, { mode: 'raster', scale, masks: [{ pageIndex: 0, x: 10, y: 10, width: 20, height: 20 }] }, guarded), expected);
  }
  assert.equal(canvases, 0); assert.equal(creates, 0);
});

test('strict lexical reconstruction drops comments and rejects references/unknown operators/fonts/malformed state and plan overflow', () => {
  const parse = (text, limits) => parseRedactionPrimitives(new TextEncoder().encode(text), new Set(['F1']), limits);
  const result = parse('% hidden private comment\nq BT /F1 12 Tf 1 0 0 1 20 20 Tm (safe\\(text\\)\\040ABC) Tj ET Q'); assert.equal(result.hasText, true); assert.equal(JSON.stringify(result).includes('hidden'), false); assert.equal(result.operators[4].args[0].value, '7361666528746578742920414243');
  for (const bad of ['1 0 R', 'BI', '/F1 12 Tf', 'BT BT ET ET', 'Q', 'q', 'BT /F2 12 Tf (secret) Tj ET', 'BT /F1 12 Tf <xy> Tj ET', 'BT /F1 12 Tf (missing Tj ET', 'BT /F1 12 Tf [<< /secret /value >>] TJ ET', '0 0 /secret rg']) assert.throws(() => parse(bad), { name: 'RedactionUnsupportedError' });
  assert.throws(() => parse('q Q', { maxPlanBytes: 1 }), /plan exceeds/); assert.throws(() => parse('q Q', { maxOperators: 1 }), /plan exceeds/);
});

test('bounded native inflation rejects expansion/corruption/unavailability and propagates cancellation distinctly', async () => {
  const decoded = new TextEncoder().encode('q BT /F1 12 Tf (SAFE) Tj ET Q'); assert.deepEqual(await inflateRedactionStream(new Uint8Array(deflateSync(decoded)), { limit: 1024 }), decoded);
  await assert.rejects(inflateRedactionStream(new Uint8Array(deflateSync(Buffer.alloc(8 * 1024 * 1024, 65))), { limit: 1024 }), /decoded content exceeds/);
  await assert.rejects(inflateRedactionStream(new Uint8Array([1, 2, 3]), { limit: 1024 }), { name: 'RedactionUnsupportedError' });
  const controller = new AbortController(); const pending = inflateRedactionStream(new Uint8Array(deflateSync(Buffer.alloc(1024 * 1024, 65))), { limit: 2 * 1024 * 1024, signal: controller.signal }); controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  const native = globalThis.DecompressionStream; try { globalThis.DecompressionStream = undefined; await assert.rejects(inflateRedactionStream(new Uint8Array([1]), { limit: 1024 }), /unavailable/); } finally { globalThis.DecompressionStream = native; }
});

test('held noncancelable encoder drains after Cancel, clears canvas and cannot return output or alter canonical state', async () => {
  const bytes = await fixture(), session = createDocumentSession(); session.begin(bytes, 'before.pdf'); const before = session.transfer(), controller = new AbortController(); let release, held, settled = false, canvas;
  const running = redactPdf(bytes, { mode: 'hybrid', scale: 1, masks: [MASK] }, { ...environment, signal: controller.signal, canvasFactory: () => (canvas = trackedCanvas()), encodeCanvas: async (value) => { held = true; await new Promise((resolve) => { release = resolve; }); return new Uint8Array(value.toBuffer('image/png')); } });
  void running.finally(() => { settled = true; }).catch(() => {}); while (!held && !settled) await new Promise(setImmediate); if (settled) await running; controller.abort(); await new Promise(setImmediate); assert.equal(settled, false); release(); await assert.rejects(running, { name: 'AbortError' }); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0); assert.deepEqual(session.transfer(), before);
});

for (const stage of ['embedPng', 'save']) test(`held native ${stage} completion drains and loses publication after cancellation`, async () => {
  const bytes = await fixture(), controller = new AbortController(); let held = false, settled = false, release;
  const guarded = { ...environment, signal: controller.signal, pdfLib: { ...lib, PDFDocument: { load: lib.PDFDocument.load, async create(options) {
    const doc = await lib.PDFDocument.create(options), native = doc[stage].bind(doc);
    doc[stage] = async (...args) => { const result = await native(...args); held = true; await new Promise((resolve) => { release = resolve; }); return result; }; return doc;
  } } } };
  const running = redactPdf(bytes, { mode: 'hybrid', scale: 1, masks: [MASK] }, guarded); void running.finally(() => { settled = true; }).catch(() => {});
  while (!held && !settled) await new Promise(setImmediate); if (settled) await running;
  controller.abort(); await new Promise(setImmediate); assert.equal(settled, false); release(); await assert.rejects(running, { name: 'AbortError' });
});

for (const stage of ['loading', 'verification']) test(`${stage} cleanup drains and preserves primary AbortError when destroy rejects`, async () => {
  const bytes = await fixture(), controller = new AbortController(); let calls = 0, cleanupCalls = 0, held = false, release, settled = false;
  const wrapped = { ...pdfjs, getDocument(options) {
    const native = pdfjs.getDocument(options), selected = ++calls === (stage === 'loading' ? 1 : 2);
    if (!selected) return native;
    const promise = native.promise.then(async (pdf) => { held = true; await new Promise((resolve) => { release = resolve; }); return pdf; });
    return { promise, async destroy() { cleanupCalls++; await native.destroy(); throw new Error(`injected ${stage} cleanup rejection`); } };
  } };
  const running = redactPdf(bytes, { mode: 'hybrid', scale: 1, masks: [MASK] }, { ...environment, pdfjs: wrapped, signal: controller.signal }); void running.finally(() => { settled = true; }).catch(() => {});
  while (!held && !settled) await new Promise(setImmediate); if (settled) await running;
  controller.abort(); await new Promise(setImmediate); assert.equal(settled, false); release(); await assert.rejects(running, (error) => { assert.equal(error, controller.signal.reason); return true; }); assert.ok(cleanupCalls >= 1);
});

test('an unsupported primary failure survives rejecting loading cleanup without publishing a result', async () => {
  const bytes = await fixture('link'); let destroys = 0;
  const wrapped = { ...pdfjs, getDocument(options) { const native = pdfjs.getDocument(options); return { promise: native.promise, async destroy() { destroys++; await native.destroy(); throw new Error('injected failure cleanup rejection'); } }; } };
  const value = { mode: 'hybrid', scale: 1, masks: [MASK] };
  await assert.rejects(redactPdf(bytes, value, { ...environment, pdfjs: wrapped }), { name: 'RedactionUnsupportedError' }); assert.equal(destroys, 1);
  const inspection = await inspectRedaction(bytes, value, { ...environment, pdfjs: wrapped }); assert.equal(inspection.supported, false); assert.match(inspection.reason, /annotations or links/); assert.equal(destroys, 2);
});
