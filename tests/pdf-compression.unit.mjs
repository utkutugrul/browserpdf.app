import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as pdfLib from 'pdf-lib';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { optimizePdfStructure, COMPRESSION_LIMITS } from '../public/js/core/pdf-compression.js';

globalThis.DOMMatrix = DOMMatrix; globalThis.ImageData = ImageData; globalThis.Path2D = Path2D;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdfjsAssets = { standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname };
const canvases = [];
function canvasFactory() {
  const native = createCanvas(1, 1); let width = 1, height = 1;
  const wrapper = { get width() { return width; }, set width(value) { width = value; native.width = Math.max(1, value); }, get height() { return height; }, set height(value) { height = value; native.height = Math.max(1, value); }, getContext: (...args) => native.getContext(...args) };
  canvases.push(wrapper); return wrapper;
}
const environment = { pdfLib, pdfjs, pdfjsAssets, canvasFactory };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const artifactDirectory = process.env.BPDF_COMPRESSION_ARTIFACT_DIR;
async function artifact(name, bytes) { if (artifactDirectory) { await mkdir(artifactDirectory, { recursive: true }); await writeFile(`${artifactDirectory}/${name}`, bytes); } }

// Portable fixtures are generated here. No /tmp Root corpus or shared mutable
// test-fixtures/generated file is a dependency of this gate.
async function fixture({ raw = true, rotations = [0], small = false } = {}) {
  const doc = await pdfLib.PDFDocument.create({ updateMetadata: false });
  doc.setTitle('Portable structural compression corpus'); doc.setAuthor('Portable fixture');
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  doc.context.trailerInfo.ID = doc.context.obj([pdfLib.PDFHexString.of('00112233445566778899aabbccddeeff'), pdfLib.PDFHexString.of('ffeeddccbbaa99887766554433221100')]);
  for (const [index, rotation] of rotations.entries()) {
    const page = doc.addPage([560, 725]); page.setCropBox(20, 25, 510, 665); page.setRotation(pdfLib.degrees(rotation)); page.node.set(pdfLib.PDFName.of('UserUnit'), pdfLib.PDFNumber.of(index % 2 + 1));
    page.drawText(`COMPRESS PAGE ${index + 1} retain 2 * 3 * 4`, { x: 45, y: 640, size: 14, font });
    page.drawRectangle({ x: 48, y: 48, width: 100, height: 50, color: pdfLib.rgb(0.2, 0.5, 0.7) });
    if (raw) {
      const operators = small ? 'q Q\n' : 'q\n0.3 w\n' + '40 120 m 180 120 l S\n'.repeat(3500) + 'Q\n';
      page.node.addContentStream(doc.context.register(doc.context.stream(new TextEncoder().encode(operators))));
    }
  }
  const form = doc.getForm(), text = form.createTextField('retained-field'), check = form.createCheckBox('retained-check');
  text.setText('PREFILLED VALUE'); text.addToPage(doc.getPage(0), { x: 50, y: 400, width: 180, height: 25 });
  check.addToPage(doc.getPage(0), { x: 50, y: 350, width: 20, height: 20 }); check.check(); form.updateFieldAppearances(font);
  const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 270, 220, 292], A: { Type: 'Action', S: 'URI', URI: pdfLib.PDFString.of('https://example.invalid/portable-retained-link') } });
  doc.getPage(0).node.addAnnot(doc.context.register(link));
  const outline = doc.context.register(doc.context.obj({ Type: 'Outlines', Count: 1 }));
  const item = doc.context.register(doc.context.obj({ Title: pdfLib.PDFString.of('Retained outline'), Parent: outline, Dest: [doc.getPage(0).ref, 'Fit'] }));
  doc.context.lookup(outline).set(pdfLib.PDFName.of('First'), item); doc.context.lookup(outline).set(pdfLib.PDFName.of('Last'), item); doc.catalog.set(pdfLib.PDFName.of('Outlines'), outline);
  return new Uint8Array(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }));
}
async function fieldValues(bytes) {
  const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
  return { title: doc.getTitle(), field: doc.getForm().getTextField('retained-field').getText(), check: doc.getForm().getCheckBox('retained-check').isChecked() };
}

async function oversizedTextFixture() {
  const doc = await pdfLib.PDFDocument.create({ updateMetadata: false }), page = doc.addPage([100, 100]);
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica); page.drawText('START', { font, x: 1, y: 1, size: 1 });
  const name = page.node.Resources().lookup(pdfLib.PDFName.of('Font')).keys()[0].asString();
  const line = `BT ${name} 1 Tf 1 0 0 1 1 1 Tm (${'A'.repeat(100)}) Tj ET\n`;
  page.node.addContentStream(doc.context.register(doc.context.stream(line.repeat(15000))));
  return new Uint8Array(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }));
}
function observePdfjs({ onTextRead, onTextCancel, onAnnotations } = {}) {
  const pages = new WeakSet(), stats = { created: 0, destroyStarted: 0, destroyed: 0, textItems: 0, textCharacters: 0, cancelReasons: [], cancelResolved: 0, cancelDrained: 0 };
  const runtime = { ...pdfjs, getDocument(options) {
    const task = pdfjs.getDocument(options); stats.created++;
    return { promise: task.promise.then((doc) => {
      const getPage = doc.getPage.bind(doc);
      doc.getPage = async (number) => {
        const page = await getPage(number); if (pages.has(page)) return page; pages.add(page);
        const extract = page.streamTextContent.bind(page), annotations = page.getAnnotations.bind(page);
        page.getAnnotations = async (options) => { const value = await annotations(options); onAnnotations?.(value); return value; };
        page.streamTextContent = (options) => {
          const stream = extract(options), getReader = stream.getReader.bind(stream);
          stream.getReader = () => {
            const reader = getReader(), read = reader.read.bind(reader), cancel = reader.cancel.bind(reader);
            reader.read = async () => {
              const value = await read();
              for (const item of value.value?.items || []) if (typeof item.str === 'string') { stats.textItems++; stats.textCharacters += item.str.length; }
              onTextRead?.(value); return value;
            };
            reader.cancel = (reason) => {
              stats.cancelReasons.push(reason);
              return cancel(reason).then(async (value) => { stats.cancelResolved++; await onTextCancel?.(); stats.cancelDrained++; return value; });
            };
            return reader;
          };
          return stream;
        };
        return page;
      };
      return doc;
    }), async destroy() { stats.destroyStarted++; await task.destroy(); stats.destroyed++; } };
  } };
  return { runtime, stats };
}

test('real oversized PDF.js text rejects cleanly, drains its Error cancellation and parser tasks, then succeeds on a fresh document', { timeout: 15000 }, async () => {
  const input = await oversizedTextFixture(), immutable = input.slice(), observed = observePdfjs(); let allocations = 0;
  await assert.rejects(optimizePdfStructure(input, { ...environment, pdfjs: observed.runtime, canvasFactory() { allocations++; assert.fail('over-budget text must not render'); } }), { name: 'RangeError', message: /1M-character/ });
  assert.ok(observed.stats.textCharacters > COMPRESSION_LIMITS.textCharacters);
  assert.equal(observed.stats.cancelReasons.length, 1); assert.ok(observed.stats.cancelReasons[0] instanceof Error); assert.equal(observed.stats.cancelReasons[0].name, 'RangeError');
  assert.equal(observed.stats.cancelResolved, 1); assert.equal(observed.stats.cancelDrained, 1); assert.equal(observed.stats.created, 2); assert.equal(observed.stats.destroyStarted, 2); assert.equal(observed.stats.destroyed, 2); assert.equal(allocations, 0); assert.deepEqual(input, immutable);
  const next = await optimizePdfStructure(await fixture(), { ...environment, pdfjs: observed.runtime });
  assert.equal(next.reduced, true); assert.equal(next.verification.pixels, true); assert.equal(observed.stats.created, 4); assert.equal(observed.stats.destroyed, 4); assert.ok(canvases.every((canvas) => !canvas.width && !canvas.height));
  await artifact('text-limit-source.pdf', input); await artifact('text-limit-successor.pdf', next.bytes);
  await artifact('text-limit-report.json', JSON.stringify({ ...observed.stats, cancelReasons: observed.stats.cancelReasons.map((reason) => ({ name: reason.name, message: reason.message })), allocations, successorReduced: next.reduced }, null, 2));
});

test('a custom non-Error abort reason cancels actual PDF.js text once with an Error and awaits its held drain before recovery', { timeout: 15000 }, async () => {
  const input = await oversizedTextFixture(), control = new AbortController(); let abortSent = false, released, cancelled;
  const draining = new Promise((resolve) => { released = resolve; }), entered = new Promise((resolve) => { cancelled = resolve; });
  const observed = observePdfjs({ onTextRead(value) { if (!abortSent && value.value?.items?.length) { abortSent = true; control.abort('custom text cancellation'); } }, onTextCancel() { cancelled(); return draining; } });
  let settled = false;
  const operation = optimizePdfStructure(input, { ...environment, pdfjs: observed.runtime, signal: control.signal }).finally(() => { settled = true; });
  const rejected = assert.rejects(operation, (reason) => reason === 'custom text cancellation');
  await entered; await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(observed.stats.cancelReasons.length, 1); assert.ok(observed.stats.cancelReasons[0] instanceof Error); assert.equal(observed.stats.cancelDrained, 0);
  released(); await rejected;
  assert.equal(observed.stats.cancelDrained, 1); assert.equal(observed.stats.created, 2); assert.equal(observed.stats.destroyed, 2);
  const next = await optimizePdfStructure(await fixture(), environment); assert.equal(next.reduced, true); assert.equal(next.verification.pixels, true);
  await artifact('custom-text-cancel-report.json', JSON.stringify({ ...observed.stats, cancelReasons: observed.stats.cancelReasons.map((reason) => reason.name), successorReduced: next.reduced }, null, 2));
});

test('actual quoted and control-character annotations reject before oversized JSON serialization or canvas allocation', { timeout: 15000 }, async () => {
  const reports = [];
  for (const [name, payload] of [['quotes', '"'.repeat(4300000)], ['controls', '\u0001'.repeat(1450000)]]) {
    const doc = await pdfLib.PDFDocument.create({ updateMetadata: false }), page = doc.addPage([100, 100]);
    page.node.addContentStream(doc.context.register(doc.context.stream('q Q\n'.repeat(18000))));
    page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: pdfLib.PDFString.of(payload) })));
    const input = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
    let seen = 0, serializations = 0, allocations = 0;
    const observed = observePdfjs({ onAnnotations(values) { seen += values.filter((value) => value.contentsObj?.str === payload).length; } });
    const stringify = JSON.stringify;
    JSON.stringify = function (value, ...args) { if (value === payload) { serializations++; throw new Error('Oversized annotation serialization was attempted'); } return stringify(value, ...args); };
    try {
      await assert.rejects(optimizePdfStructure(input, { ...environment, pdfjs: observed.runtime, canvasFactory() { allocations++; assert.fail('over-budget annotation must not render'); } }), { name: 'RangeError', message: /8 MiB/ });
    } finally { JSON.stringify = stringify; }
    assert.ok(seen >= 1); assert.equal(serializations, 0); assert.equal(allocations, 0); assert.equal(observed.stats.created, 2); assert.equal(observed.stats.destroyed, 2);
    reports.push({ name, payloadCharacters: payload.length, inputBytes: input.length, seen, serializations, allocations, destroyed: observed.stats.destroyed });
    await artifact(`annotation-${name}-source.pdf`, input);
  }
  const next = await optimizePdfStructure(await fixture(), environment); assert.equal(next.reduced, true);
  await artifact('annotation-string-preflight-report.json', JSON.stringify({ cases: reports, successorReduced: next.reduced }, null, 2));
});

test('ordinary Buffer inputs and no-op outputs have independent plain byte ownership through actual parsers', async () => {
  for (const raw of [true, false]) {
    const original = await fixture({ raw }), input = Buffer.from(original);
    const result = await optimizePdfStructure(input, environment);
    assert.equal(result.reduced, raw); assert.deepEqual(input, Buffer.from(original));
    assert.equal(Object.getPrototypeOf(result.bytes), Uint8Array.prototype); assert.equal(Buffer.isBuffer(result.bytes), false); assert.notEqual(result.bytes.buffer, input.buffer);
    const inputByte = input[0]; result.bytes[0] ^= 255; assert.equal(input[0], inputByte);
    if (!raw) { const resultByte = result.bytes[1]; input[1] ^= 255; assert.equal(result.bytes[1], resultByte); }
  }
});

test('intrinsic input copying ignores a Uint8Array subclass slice, species, iterator and shadowed byteLength', async () => {
  const source = await fixture(); let methodCalls = 0;
  class HostileBytes extends Uint8Array {
    slice() { methodCalls++; return this; }
    static get [Symbol.species]() { methodCalls++; throw new Error('Input species must not run'); }
    [Symbol.iterator]() { methodCalls++; throw new Error('Input iterator must not run'); }
  }
  const input = new HostileBytes(source.length); Uint8Array.prototype.set.call(input, source);
  Object.defineProperty(input, 'byteLength', { get() { methodCalls++; throw new Error('Input byteLength getter must not run'); } });
  Object.defineProperty(input, 'length', { get() { methodCalls++; throw new Error('Input length getter must not run'); } });
  const result = await optimizePdfStructure(input, environment);
  assert.equal(result.reduced, true); assert.equal(methodCalls, 0); assert.equal(result.verification.pixels, true); assert.equal(Object.getPrototypeOf(result.bytes), Uint8Array.prototype);
  assert.deepEqual(new Uint8Array(input.buffer, input.byteOffset, source.length), source); assert.notEqual(result.bytes.buffer, input.buffer);
});

test('real structural optimization retains application refs, forms, links, fonts, decoded operators and identical bounded pixels', async () => {
  const input = await fixture(), immutable = input.slice();
  const result = await optimizePdfStructure(input, { ...environment, capabilities: { searchable: true, forms: true, rasterized: false } });
  assert.equal(result.reduced, true); assert.equal(result.retainedOriginal, false); assert.ok(result.bytes.length < input.length * 0.2); assert.equal(result.optimizedStreams, 1);
  assert.deepEqual(result.capabilities, { searchable: true, forms: true, rasterized: false, encrypted: false });
  assert.deepEqual(await fieldValues(result.bytes), await fieldValues(input)); assert.deepEqual(input, immutable);
  assert.equal(result.verification.text, true); assert.equal(result.verification.annotations, true); assert.equal(result.verification.pixels, true);
  assert.ok(result.verification.annotationCount >= 3); assert.equal(result.verification.untouchedEncodedBytes, true); assert.equal(result.verification.optimizedDecodedBytes, true);
  assert.deepEqual(result.verification.renderedPages, [1]); assert.ok(result.verification.renderedPixels <= COMPRESSION_LIMITS.verificationPixels);
  const before = await pdfLib.PDFDocument.load(input, { updateMetadata: false }), after = await pdfLib.PDFDocument.load(result.bytes, { updateMetadata: false });
  assert.deepEqual(before.context.enumerateIndirectObjects().map(([ref]) => ref.toString()), after.context.enumerateIndirectObjects().map(([ref]) => ref.toString()));
  for (const [ref, stream] of before.context.enumerateIndirectObjects().filter(([, object]) => object instanceof pdfLib.PDFRawStream)) {
    const target = after.context.lookup(ref);
    assert.deepEqual(pdfLib.decodePDFRawStream(target).decode(), pdfLib.decodePDFRawStream(stream).decode());
    if (stream.dict.has(pdfLib.PDFName.of('Filter'))) assert.deepEqual(target.getContents(), stream.getContents());
  }
  assert.ok(canvases.every((canvas) => !canvas.width && !canvas.height));
  await artifact('structural-source.pdf', input); await artifact('structural-result.pdf', result.bytes);
  await artifact('structural-report.json', JSON.stringify({ ...result, bytes: undefined, sourceSha256: hash(input), resultSha256: hash(result.bytes) }, null, 2));
});

test('a second pass and already-filtered/small/no-gain PDFs return byte-identical originals without a signature loss', async () => {
  const first = await optimizePdfStructure(await fixture(), environment);
  const second = await optimizePdfStructure(first.bytes, environment);
  assert.equal(second.reduced, false); assert.equal(second.retainedOriginal, true); assert.deepEqual(second.bytes, first.bytes); assert.equal(second.boundary, undefined);
  for (const input of [await fixture({ raw: false }), await fixture({ small: true })]) {
    const result = await optimizePdfStructure(input, environment);
    assert.equal(result.reduced, false); assert.deepEqual(result.bytes, input); assert.equal(result.optimizedStreams, 0); assert.equal(result.boundary, undefined);
  }
  await artifact('second-pass.pdf', second.bytes);
});

test('an eligible high-entropy stream and a larger serialized candidate both retain the exact input bytes', async () => {
  const doc = await pdfLib.PDFDocument.load(await fixture({ raw: false }), { updateMetadata: false });
  const noise = new Uint8Array(4096); let seed = 0x7162a301;
  for (let index = 0; index < noise.length; index++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; noise[index] = seed & 255; }
  doc.context.register(doc.context.stream(noise));
  const input = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  const noGain = await optimizePdfStructure(input, environment);
  assert.equal(noGain.skipped.nonReducing, 1); assert.equal(noGain.attemptedStreams, 1); assert.equal(noGain.reduced, false); assert.deepEqual(noGain.bytes, input); assert.equal(noGain.boundary, undefined);
  const reducible = await fixture(); let saves = 0;
  const runtime = { ...pdfLib, PDFDocument: { async load(bytes, options) { const source = await pdfLib.PDFDocument.load(bytes, options); source.save = async () => { saves++; return new Uint8Array(reducible.length + 1); }; return source; } } };
  const larger = await optimizePdfStructure(reducible, { ...environment, pdfLib: runtime });
  assert.equal(saves, 1); assert.equal(larger.reduced, false); assert.deepEqual(larger.bytes, reducible); assert.equal(larger.boundary, undefined);
});

test('four rotations, nonzero CropBox and UserUnit retain exact all-page text, annotations and same-context pixels', async () => {
  const input = await fixture({ rotations: [0, 90, 180, 270] });
  const result = await optimizePdfStructure(input, environment);
  assert.equal(result.reduced, true); assert.deepEqual(result.verification.renderedPages, [1, 2, 3, 4]); assert.equal(result.optimizedStreams, 4);
  assert.equal(result.verification.geometry, true); assert.equal(result.verification.pixels, true);
  await artifact('rotations-source.pdf', input); await artifact('rotations-result.pdf', result.bytes);
});

test('filtered/DecodeParms/external streams remain encoded-identical and unsupported linearization rejects', async () => {
  const doc = await pdfLib.PDFDocument.load(await fixture(), { updateMetadata: false });
  for (const dict of [{ Filter: 'ASCIIHexDecode' }, { DecodeParms: { Predictor: 1 } }, { F: pdfLib.PDFString.of('external-not-opened.bin'), FFilter: 'FlateDecode' }]) doc.context.register(doc.context.stream('41424344>\n'.repeat(20), dict));
  const input = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  const result = await optimizePdfStructure(input, environment);
  assert.equal(result.reduced, true); assert.ok(result.skipped.filtered); assert.equal(result.skipped.decodeParams, 1); assert.equal(result.skipped.external, 1);
  doc.context.register(doc.context.obj({ Linearized: 1, L: input.length }));
  await assert.rejects(optimizePdfStructure(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }), environment), /Linearized/);
});

test('input, page, object and raw-stream budgets reject without creating a verification canvas', async () => {
  let allocations = 0;
  const guarded = { ...environment, canvasFactory() { allocations++; assert.fail('rejected admission must not allocate a canvas'); } };
  await assert.rejects(optimizePdfStructure(new Uint8Array(), guarded), /80 MiB/);
  await assert.rejects(optimizePdfStructure(new Uint8Array(COMPRESSION_LIMITS.inputBytes + 1), guarded), /80 MiB/);
  const doc = await pdfLib.PDFDocument.create({ updateMetadata: false }); for (let index = 0; index < 251; index++) doc.addPage([100, 100]);
  await assert.rejects(optimizePdfStructure(await doc.save(), guarded), /1–250/);
  const streamDoc = await pdfLib.PDFDocument.load(await fixture(), { updateMetadata: false });
  streamDoc.context.register(streamDoc.context.stream(new Uint8Array(COMPRESSION_LIMITS.streamBytes + 1)));
  await assert.rejects(optimizePdfStructure(await streamDoc.save({ useObjectStreams: false, updateFieldAppearances: false }), guarded), /16 MiB/);
  const objectDoc = await pdfLib.PDFDocument.create({ updateMetadata: false }); objectDoc.addPage([100, 100]);
  for (let index = 0; index < COMPRESSION_LIMITS.objects; index++) objectDoc.context.register(pdfLib.PDFNumber.of(index));
  await assert.rejects(optimizePdfStructure(await objectDoc.save(), guarded), /25,000/);
  assert.equal(allocations, 0);
});

test('descriptor accounting rejects a graph near 8MiB including serialized keys, delimiters and prefixes', async () => {
  const doc = await pdfLib.PDFDocument.load(await fixture(), { updateMetadata: false });
  // These 50,000 empty dictionaries add 149,999 braces/separators but no
  // primitive payload. Omitting structural bytes would wrongly admit the text.
  doc.catalog.set(pdfLib.PDFName.of('AEmptyDescriptors'), doc.context.obj(Array.from({ length: 50000 }, () => ({}))));
  doc.catalog.set(pdfLib.PDFName.of('ZLargeDescriptor'), pdfLib.PDFString.of('x'.repeat(COMPRESSION_LIMITS.graphBytes - 140000)));
  let allocations = 0;
  await assert.rejects(optimizePdfStructure(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }), { ...environment, canvasFactory() { allocations++; assert.fail('oversized descriptor cannot render'); } }), /8 MiB|oversized/);
  assert.equal(allocations, 0);
});

test('oversized annotation typed arrays reject before iteration or copying and release both parser tasks', async () => {
  const input = await fixture(); let indexedReads = 0, destroyed = 0;
  class TrackedBytes extends Uint8Array { [Symbol.iterator]() { indexedReads++; return super[Symbol.iterator](); } }
  const payload = new TrackedBytes(COMPRESSION_LIMITS.graphNodes + 1);
  const largeArray = new Proxy(new Array(COMPRESSION_LIMITS.graphNodes + 1), { get(target, property) { if (/^\d+$/.test(String(property))) indexedReads++; return Reflect.get(target, property); } });
  for (const value of [payload, largeArray]) {
    const wrapped = { ...pdfjs, getDocument(options) {
      const task = pdfjs.getDocument(options), destroy = task.destroy.bind(task);
      return { promise: task.promise.then((doc) => { const getPage = doc.getPage.bind(doc); doc.getPage = async (number) => { const page = await getPage(number); page.getAnnotations = async () => [{ id: 'bounded', payload: value }]; return page; }; return doc; }), async destroy() { destroyed++; return destroy(); } };
    } };
    await assert.rejects(optimizePdfStructure(input, { ...environment, pdfjs: wrapped }), /Annotation array exceeds/);
  }
  assert.equal(indexedReads, 0); assert.equal(destroyed, 4);
});

test('native corruption, failed save, bad reopen and changed graph cannot publish a candidate', async () => {
  const input = await fixture(), immutable = input.slice();
  const badNative = { ...environment, compressionStreamFactory: () => new TransformStream({ transform(_chunk, controller) { controller.enqueue(new Uint8Array([0, 1])); } }) };
  await assert.rejects(optimizePdfStructure(input, badNative));
  for (const scenario of ['save-throw', 'bad-reopen', 'changed-value']) {
    let loads = 0;
    const runtime = { ...pdfLib, PDFDocument: { async load(bytes, options) {
      loads++; const doc = await pdfLib.PDFDocument.load(bytes, options);
      if (loads === 1) {
        const save = doc.save.bind(doc);
        doc.save = async (options) => {
          if (scenario === 'save-throw') throw new Error('Injected serializer failure');
          if (scenario === 'bad-reopen') return new TextEncoder().encode('%PDF-broken');
          doc.setTitle('Tampered title'); return save(options);
        };
      }
      return doc;
    } } };
    await assert.rejects(optimizePdfStructure(input, { ...environment, pdfLib: runtime }), scenario === 'save-throw' ? /Injected serializer/ : scenario === 'changed-value' ? /object graph changed/ : undefined);
  }
  assert.deepEqual(input, immutable);
});

test('cancellation aborts and drains held native stream work before a positive successor', async () => {
  const input = await fixture(), control = new AbortController();
  let entered, release, cancelled = 0, aborted = 0, drained = false;
  const started = new Promise((resolve) => { entered = resolve; });
  const draining = new Promise((resolve) => { release = resolve; });
  const held = {
    readable: new ReadableStream({ cancel() { cancelled++; return draining; } }),
    writable: new WritableStream({ write() { entered(); return draining; }, abort() { aborted++; drained = true; } }),
  };
  let settled = false;
  const operation = optimizePdfStructure(input, { ...environment, signal: control.signal, compressionStreamFactory: () => held }).finally(() => { settled = true; });
  await started; control.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(cancelled, 1); assert.equal(drained, false);
  release(); await assert.rejects(operation, { name: 'AbortError' });
  assert.equal(cancelled, 1); assert.equal(aborted, 1); assert.equal(drained, true);
  const successor = await optimizePdfStructure(input, environment); assert.equal(successor.reduced, true); assert.equal(successor.verification.pixels, true);
});

test('all-page paired render plan stays below 48M pixels for 250 pages before canvas allocation', async () => {
  const input = await fixture(); let planned = false, allocated = false;
  const fakePage = { userUnit: 1, rotate: 0, view: [0, 0, 1000, 1000], getViewport: ({ scale }) => ({ width: 1000 * scale, height: 1000 * scale, transform: [scale, 0, 0, -scale, 0, 1000 * scale] }), cleanup() {}, streamTextContent: () => new ReadableStream({ start(controller) { controller.close(); } }), getAnnotations: async () => [], render({ viewport }) { planned = true; assert.ok(viewport.width * viewport.height * 250 * 2 <= COMPRESSION_LIMITS.verificationPixels); throw new Error('Plan observed before actual rendering'); } };
  // Source and output page counts agree with one-page pdf-lib input. 250-page
  // planning is exercised separately through a public-runtime injected source
  // facade whose strict pdf-lib count is the same bounded value.
  const runtime = { ...pdfLib, PDFDocument: { async load(bytes, options) { const doc = await pdfLib.PDFDocument.load(bytes, options); doc.getPageCount = () => 250; return doc; } } };
  const fakePdfjs = { AnnotationMode: pdfjs.AnnotationMode, getDocument() { return { promise: Promise.resolve({ numPages: 250, getPage: async () => fakePage }), destroy: async () => {} }; } };
  await assert.rejects(optimizePdfStructure(input, { ...environment, pdfLib: runtime, pdfjs: fakePdfjs, canvasFactory() { allocated = true; return canvasFactory(); } }), /Plan observed/);
  assert.equal(planned, true); assert.equal(allocated, true);
});
