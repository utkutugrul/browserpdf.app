import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as P from 'pdf-lib';
import factory from '../public/vendor/pdfstudio-0.4.0/qpdf.js';
import { runProtectionEngine } from '../public/js/core/pdf-protection-engine.js';
globalThis.crypto ??= webcrypto;
const ownerToken = { taskId: 'engine-test', revision: 1, generation: 4 };
const hash = value => createHash('sha256').update(value).digest('hex');
const name = P.PDFName.of;

if (!isMainThread) {
  let outputReads = 0, current = true; const stop = new AbortController();
  const createModule = async init => {
    init.locateFile = path => { assert.equal(path, 'qpdf.wasm'); return fileURLToPath(new URL('../public/vendor/pdfstudio-0.4.0/qpdf.wasm', import.meta.url)); };
    const module = await factory(init), nativeCall = module.callMain, nativeRead = module.FS.readFile;
    module.FS.readFile = (...args) => { if (args[0] === '/job/out.pdf') outputReads++; return nativeRead(...args); };
    if (workerData.mode === 'mutate') workerData.request.bytes.fill(0);
    if (workerData.mode === 'abort-after-factory') stop.abort();
    module.callMain = args => {
      if (args.includes('--encrypt') && ['zero-diagnostic', 'warning', 'diagnostic-cap'].includes(workerData.mode)) {
        if (workerData.mode !== 'warning') init.print('x'.repeat(workerData.mode === 'diagnostic-cap' ? 5000 : 1));
        return workerData.mode === 'warning' ? 3 : 0;
      }
      return nativeCall(args);
    };
    return module;
  };
  try {
    const result = await runProtectionEngine(workerData.request, { createModule, signal: stop.signal, isCurrent: () => current, onPhase: () => { if (workerData.mode === 'stale-phase') current = false; } });
    parentPort.postMessage({ ok: true, result, outputReads }, [result.bytes.buffer]);
  } catch (error) { parentPort.postMessage({ ok: false, code: error.code || 'unclassified', outputReads }); }
} else {
  let active = 0, maximum = 0;
  async function job(request, mode) {
    const worker = new Worker(new URL(import.meta.url), { workerData: { request, mode }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    active++; maximum = Math.max(maximum, active); let timer;
    try { return await new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Finite engine deadline exceeded')), 20000); worker.once('message', resolve); worker.once('error', () => reject(new Error('Worker error'))); worker.once('exit', code => { if (code) reject(new Error('Worker exited')); }); }); }
    finally { clearTimeout(timer); await worker.terminate(); active--; }
  }
  async function source() {
    const doc = await P.PDFDocument.create(); doc.setTitle('Preserved title é'); doc.setAuthor('Synthetic author'); doc.setCreationDate(new Date('2020-01-02T03:04:05Z')); doc.setModificationDate(new Date('2021-02-03T04:05:06Z'));
    const page = doc.addPage([320, 240]); page.setCropBox(7, 11, 290, 210); page.setRotation(P.degrees(90)); page.node.set(name('UserUnit'), P.PDFNumber.of(1.25)); page.drawText('Protection round trip', { x: 24, y: 160, size: 14 });
    const field = doc.getForm().createTextField('retained-field'); field.setText('Retained value'); field.addToPage(page, { x: 20, y: 90, width: 180, height: 24 }); doc.getForm().updateFieldAppearances();
    const context = doc.context;
    page.node.addAnnot(context.register(context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [20, 20, 80, 40], A: { Type: 'Action', S: 'URI', URI: P.PDFString.of('https://example.org/retained') } })));
    const outline = context.obj({ Type: 'Outlines', Count: 1 }), outlineRef = context.register(outline), itemRef = context.register(context.obj({ Title: P.PDFHexString.fromText('Retained bookmark'), Parent: outlineRef, Dest: [page.ref, 'Fit'] })); outline.set(name('First'), itemRef); outline.set(name('Last'), itemRef); doc.catalog.set(name('Outlines'), outlineRef);
    doc.catalog.set(name('Lang'), P.PDFString.of('en-US')); doc.catalog.set(name('MarkInfo'), context.obj({ Marked: true }));
    doc.catalog.set(name('StructTreeRoot'), context.register(context.obj({ Type: 'StructTreeRoot', K: [] })));
    doc.catalog.set(name('PageLabels'), context.register(context.obj({ Nums: [0, { S: 'D', P: P.PDFString.of('Page-'), St: 3 }] })));
    doc.catalog.set(name('Extensions'), context.obj({ ACME: { BaseVersion: '1.7', ExtensionLevel: 1 } }));
    doc.catalog.set(name('Metadata'), context.register(context.stream('<x:xmpmeta xmlns:x="adobe:ns:meta/"><value>retained</value></x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })));
    await doc.attach(new Uint8Array([0, 128, 255, 35, 47]), 'retained.txt', { mimeType: 'text/plain', description: 'Retained attachment', creationDate: new Date('2020-01-02T03:04:05Z'), modificationDate: new Date('2021-02-03T04:05:06Z') });
    return doc.save({ updateFieldAppearances: false });
  }
  async function semantics(bytes) {
    const doc = await P.PDFDocument.load(bytes.slice(), { updateMetadata: false, throwOnInvalidObject: true });
    const ids = new Map(), nodes = {};
    function read(value) {
      if (value instanceof P.PDFRef) { const key = value.toString(); if (!ids.has(key)) { const id = String(ids.size + 1); ids.set(key, id); nodes[id] = null; nodes[id] = read(doc.context.lookup(value)); } return { ref: ids.get(key) }; }
      if (value instanceof P.PDFString || value instanceof P.PDFHexString) return { string: Buffer.from(value.asBytes()).toString('hex') };
      if (value instanceof P.PDFRawStream) return { dictionary: dictionary(value.dict, true), decoded: hash(P.decodePDFRawStream(value).decode()) };
      if (value instanceof P.PDFDict) return dictionary(value);
      if (value instanceof P.PDFArray) return Array.from({ length: value.size() }, (_, index) => read(value.get(index)));
      if (value instanceof P.PDFName) return value.decodeText();
      if (value instanceof P.PDFNumber) return value.asNumber();
      if (value instanceof P.PDFBool) return value.asBoolean();
      if (value === P.PDFNull) return null;
      return value === undefined ? 'undefined' : String(value);
    }
    function dictionary(value, stream = false) {
      if (stream) { const filter = value.lookupMaybe(name('Filter'), P.PDFName); assert.ok(!filter || filter.decodeText() === 'FlateDecode'); assert.equal(value.has(name('DecodeParms')), false); }
      const entries = value.entries().filter(([key]) => !(stream && ['Length', 'Filter', 'DecodeParms'].includes(key.decodeText())));
      // QPDF may retain its encryption extension after decryption. Preserve every original extension.
      return Object.fromEntries(entries.sort(([a], [b]) => a.asString().localeCompare(b.asString())).map(([key, item]) => [key.decodeText(), read(item)]));
    }
    const root = read(doc.context.trailerInfo.Root), info = read(doc.context.trailerInfo.Info);
    const catalog = nodes[root.ref], extensions = catalog.Extensions;
    if (extensions?.ADBE) { assert.deepEqual(extensions.ADBE, { BaseVersion: '1.7', ExtensionLevel: 8 }); delete extensions.ADBE; }
    return { root, info, nodes, title: doc.getTitle(), field: doc.getForm().getTextField('retained-field').getText(), geometry: doc.getPages().map(page => [page.getMediaBox(), page.getCropBox(), page.getRotation().angle, page.node.lookup(name('UserUnit'), P.PDFNumber).asNumber()]) };
  }
  async function reader(bytes, password) {
    const require = createRequire(import.meta.url), cv = require('@napi-rs/canvas');
    globalThis.DOMMatrix ??= cv.DOMMatrix; globalThis.ImageData ??= cv.ImageData; globalThis.Path2D ??= cv.Path2D;
    const J = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = J.getDocument({ data: bytes.slice(), password, verbosity: 0, isEvalSupported: false, standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)), wasmUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/wasm/', import.meta.url)) });
    try {
      const doc = await task.promise, page = await doc.getPage(1), viewport = page.getViewport({ scale: 0.5 }), canvas = cv.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try { await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise; return { text: (await page.getTextContent()).items.map(item => item.str || '').join(' '), pixels: hash(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data), permissions: await doc.getPermissions() }; }
      finally { canvas.width = canvas.height = 1; }
    } finally { await task.destroy(); }
  }
  test('actual pinned Protect and Unlock preserve the reachable graph and ordinary writer interoperability', async () => {
    const input = await source(), before = await semantics(input), original = hash(input), baseline = await reader(input);
    for (const algorithm of ['aes256', 'aes128']) {
      const password = randomUUID().slice(0, 24), protectedJob = await job({ operation: 'protect', bytes: input, userPassword: password, algorithm, permissions: { print: 'none', modify: 'none', extract: false }, ownerToken });
      assert.equal(protectedJob.ok, true); const protectedBytes = protectedJob.result.bytes;
      const encryptedDoc = await P.PDFDocument.load(protectedBytes.slice(), { ignoreEncryption: true, updateMetadata: false }), dict = encryptedDoc.context.lookup(encryptedDoc.context.trailerInfo.Encrypt, P.PDFDict);
      assert.equal(dict.lookup(name('V'), P.PDFNumber).asNumber(), algorithm === 'aes256' ? 5 : 4); assert.equal(dict.lookup(name('R'), P.PDFNumber).asNumber(), algorithm === 'aes256' ? 6 : 4);
      const protectedView = await reader(protectedBytes, password); assert.equal(protectedView.text, baseline.text); assert.equal(protectedView.pixels, baseline.pixels); assert.ok(Array.isArray(protectedView.permissions));
      assert.equal((await job({ operation: 'unlock', bytes: protectedBytes, password: randomUUID(), ownerToken })).code, 'credential-rejected');
      assert.equal((await job({ operation: 'unlock', bytes: protectedBytes, password: '', ownerToken })).code, 'credential-rejected');
      const unlocked = await job({ operation: 'unlock', bytes: protectedBytes, password, ownerToken }); assert.equal(unlocked.ok, true); assert.deepEqual(await semantics(unlocked.result.bytes), before);
      const ordinary = await P.PDFDocument.load(unlocked.result.bytes, { updateMetadata: false }), saved = await ordinary.save({ updateFieldAppearances: false }); assert.deepEqual(await semantics(saved), before);
      const view = await reader(saved); assert.equal(view.text, baseline.text); assert.equal(view.pixels, baseline.pixels); assert.equal(hash(input), original);
    }
    assert.equal(active, 0); assert.equal(maximum, 1);
  });
  test('strict engine status and diagnostics gates run before the output read', async () => {
    const bytes = await source(), request = { operation: 'protect', bytes, userPassword: randomUUID(), ownerToken };
    for (const [mode, code] of [['zero-diagnostic', 'unexpected-diagnostics'], ['warning', 'engine-warning'], ['diagnostic-cap', 'diagnostic-limit']]) { const result = await job(request, mode); assert.equal(result.code, code); assert.equal(result.outputReads, 0); }
    assert.equal((await job(request)).ok, true); assert.equal(active, 0);
  });
  test('owned input survives caller mutation and ownership checks withhold stale results', async () => {
    const input = await source(), request = { operation: 'protect', bytes: input, userPassword: randomUUID(), ownerToken };
    const mutation = await job(request, 'mutate'); assert.equal(mutation.ok, true);
    const unlocked = await job({ operation: 'unlock', bytes: mutation.result.bytes, password: request.userPassword, ownerToken }); assert.equal(unlocked.ok, true); assert.deepEqual(await semantics(unlocked.result.bytes), await semantics(input));
    assert.equal((await job(request, 'abort-after-factory')).code, 'canceled'); assert.equal((await job(request, 'stale-phase')).code, 'stale');
    assert.equal((await job({ operation: 'unlock', bytes: input, password: '', ownerToken })).code, 'already-unlocked');
    assert.equal((await job(request)).ok, true); assert.equal(active, 0);
  });
}
