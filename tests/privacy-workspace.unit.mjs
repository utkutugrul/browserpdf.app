import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as lib from 'pdf-lib';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { scanPdfPrivacy, summarizePrivacyReport, withPdfDocument, PRIVACY_SCAN_LIMITS } from '../public/js/core/privacy-scan.js';
import { cleanPdfPrivacy } from '../public/js/core/privacy-cleanup.js';
import { assertPrivacyWorkspaceBudget, createPrivacyWorkQueue, createPrivacyPdfLifetime, createPrivacyPreview, privacyView, privacyBoundary } from '../public/js/core/privacy-workspace.js';
import { createDocumentSession, BOUNDARY_LOSSES } from '../public/js/core/document-session.js';
import { createPrivacyScanTools } from '../public/js/webmcp.js';

globalThis.DOMMatrix = DOMMatrix; globalThis.ImageData = ImageData; globalThis.Path2D = Path2D;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdfjsAssets = { standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname };
const output = process.env.BROWSERPDF_PRIVACY_ARTIFACT_DIR || await mkdtemp(join(tmpdir(), 'browserpdf-privacy-pure-'));
await mkdir(output, { recursive: true });
const records = [], M = 1024 * 1024, N = lib.PDFName.of;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function artifact(name, bytes) { await writeFile(join(output, name), bytes); records.push({ name, bytes: bytes.length, sha256: digest(bytes) }); }
async function rejectValue(promise, value) { let rejected = false; await promise.then(() => {}, error => { rejected = true; assert.equal(error, value); }); assert.equal(rejected, true); }
function canvas() { const value = createCanvas(1, 1); value.dataset = {}; return value; }
async function fixture({ raw = false, extreme = false } = {}) {
  const doc = await lib.PDFDocument.create({ updateMetadata: false }), font = await doc.embedFont(lib.StandardFonts.Helvetica);
  for (const [index, rotation] of (extreme ? [0] : [0, 90, 180, 270]).entries()) {
    const page = doc.addPage(extreme ? [100000, 1] : [420, 330]);
    if (!extreme) { page.setCropBox(20, 25, 360, 275); page.setRotation(lib.degrees(rotation)); page.node.set(N('UserUnit'), lib.PDFNumber.of(index % 2 + 1));
      page.drawText(`PRIVACY PAGE ${index + 1} qa@example.test 123-45-6789`, { x: 30, y: 260, size: 10, font }); page.drawRectangle({ x: 80, y: 100, width: 45, height: 70, color: lib.rgb(0.2, 0.7, 0.4) }); }
  }
  doc.setTitle('Private title'); doc.setAuthor('Private author'); doc.setSubject('Subject'); doc.setKeywords(['literal,,commas']); doc.setCreator('Creator'); doc.setProducer('Producer'); doc.setCreationDate(new Date('2001-02-03T04:05:06Z')); doc.setModificationDate(new Date('2002-03-04T05:06:07Z'));
  const info = doc.context.lookup(doc.context.trailerInfo.Info, lib.PDFDict); info.set(N('Company'), lib.PDFHexString.fromText('KEEP CUSTOM İstanbul'));
  if (raw) { info.set(N('Title'), lib.PDFString.of('')); info.set(N('Author'), lib.PDFNumber.of(7)); info.set(N('Subject'), lib.PDFNull); }
  const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>KEEP XMP İstanbul</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>';
  doc.catalog.set(N('Metadata'), doc.context.register(doc.context.flateStream(new TextEncoder().encode(xml), { Type: 'Metadata', Subtype: 'XML' })));
  if (!extreme) {
    const field = doc.getForm().createTextField('kept-note'); field.setText('KEEP FORM VALUE'); field.addToPage(doc.getPage(0), { x: 35, y: 40, width: 190, height: 28 }); doc.getForm().updateFieldAppearances();
    doc.getPage(1).node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [35, 80, 200, 100], A: { Type: 'Action', S: 'URI', URI: lib.PDFString.of('https://example.invalid/private?do-not-open=1') } })));
    await doc.attach(new TextEncoder().encode('KEEP PAYLOAD İstanbul'), 'kept.txt', { mimeType: 'text/plain' });
  }
  return new Uint8Array(await doc.save({ updateFieldAppearances: false }));
}
async function reopen(bytes) { return lib.PDFDocument.load(bytes.slice(), { updateMetadata: false, throwOnInvalidObject: true }); }
function graph(doc) {
  const xml = doc.catalog.lookup(N('Metadata')), names = doc.catalog.lookup(N('Names'), lib.PDFDict).lookup(N('EmbeddedFiles'), lib.PDFDict).lookup(N('Names'), lib.PDFArray), file = names.lookup(1, lib.PDFDict), stream = file.lookup(N('EF'), lib.PDFDict).lookup(N('F'));
  const field = doc.getForm().getTextField('kept-note'), appearance = field.acroField.getWidgets()[0].dict.lookup(N('AP'), lib.PDFDict).lookup(N('N'));
  const annotations = doc.getPage(1).node.Annots(), uri = annotations.lookup(0, lib.PDFDict).lookup(N('A'), lib.PDFDict).lookup(N('URI')).decodeText();
  return { xmp: digest(lib.decodePDFRawStream(xml).decode()), payload: digest(lib.decodePDFRawStream(stream).decode()), mime: stream.dict.lookup(N('Subtype')).decodeText(), value: field.getText(), appearance: digest(lib.decodePDFRawStream(appearance).decode()), uri, company: doc.context.lookup(doc.context.trailerInfo.Info).lookup(N('Company')).decodeText(), pages: doc.getPages().map(page => ({ media: page.getMediaBox(), crop: page.getCropBox(), rotation: page.getRotation(), userUnit: page.node.get(N('UserUnit'))?.toString() })) };
}
const nativeOptions = { pdfLib: lib, pdfjs, pdfjsAssets, categories: ['standard-metadata'], createCanvas };
function runtime({ pages = 1, page = {}, doc = {}, destroy } = {}) {
  const calls = { task: 0, doc: 0, load: 0 };
  const document = { numPages: pages, getMetadata: async () => ({ info: {}, metadata: null }), getAttachments: async () => null, getJSActions: async () => null, getOpenAction: async () => null, getFieldObjects: async () => null, getCalculationOrderIds: async () => null, getPermissions: async () => null, getPage: async () => ({ getAnnotations: async () => [], getJSActions: async () => null, getTextContent: async () => ({ items: [] }), getOperatorList: async () => ({ fnArray: [], argsArray: [] }), ...page }), destroy: async () => { calls.doc++; }, ...doc };
  return { calls, document, pdfjs: { OPS: { setTextRenderingMode: 7 }, AnnotationType: { FILEATTACHMENT: 17 }, getDocument() { calls.load++; return { promise: Promise.resolve(document), async destroy() { calls.task++; await destroy?.(calls.task); } }; } } };
}

test('real session joint budget includes known private artifact/resource/expanded copies and all three exact boundaries', async () => {
  const bytes = await fixture(), session = createDocumentSession(); session.begin(bytes, 'ordinary.pdf', { type: 'application/pdf' }); const snapshot = session.snapshot();
  const value = assertPrivacyWorkspaceBudget(snapshot, { artifactBytes: bytes.length }, { resourceBytes: 1024, resourceCount: 1, expandedBytes: 4096, expandedCount: 1 }); assert.equal(value.retainedBytes, snapshot.retainedBytes + bytes.length + 5120); assert.equal(value.resourceCount, 2);
  // Boundary-only scalar snapshots exercise arithmetic; real positive uses the
  // actual session above. These do not pretend to allocate a 512 MiB PDF.
  for (const [key, max, extra] of [['retainedBytes', 512 * M, { artifactBytes: 1 }], ['resourceBytes', 96 * M, { resourceBytes: 1 }], ['resourceCount', 128, { resourceCount: 1 }]]) {
    const at = { ...snapshot, retainedBytes: 0, resourceBytes: 0, resourceCount: 0, [key]: max }; assert.doesNotThrow(() => assertPrivacyWorkspaceBudget(at)); assert.throws(() => assertPrivacyWorkspaceBudget(at, {}, extra), { code: 'PRIVACY_BUDGET' });
  }
  assert.throws(() => assertPrivacyWorkspaceBudget(snapshot, { artifactBytes: Number.MAX_SAFE_INTEGER }, { artifactBytes: 1 })); assert.throws(() => assertPrivacyWorkspaceBudget(snapshot, { extra: 0 })); assert.throws(() => assertPrivacyWorkspaceBudget(snapshot, { resourceCount: -1 }));
  const prior = session.snapshot(); assert.throws(() => assertPrivacyWorkspaceBudget(prior, { artifactBytes: 512 * M })); assert.deepEqual(session.snapshot(), prior);
});
test('fixed rewrite boundary preserves prior union and rejects unsupported or thirteenth losses', () => {
  const prior = { kind: 'raster-redaction', losses: ['redaction-document-rasterized', 'redaction-metadata-removed'] };
  assert.deepEqual(privacyBoundary(prior, ['scene-baked'], { rewrite: true, incomplete: true }), { kind: 'pdf-rewrite', losses: [...prior.losses, 'scene-baked', 'signature-rewrite', 'structure-inspection-incomplete'] }); assert.deepEqual(prior.losses, ['redaction-document-rasterized', 'redaction-metadata-removed']);
  assert.equal(privacyBoundary(), undefined); assert.throws(() => privacyBoundary(prior, ['unknown'])); assert.throws(() => privacyBoundary({ kind: 'pdf-rewrite', losses: BOUNDARY_LOSSES.slice(0, 12) }, [BOUNDARY_LOSSES[12]]), { code: 'PRIVACY_BOUNDARY_LIMIT' });
});
test('legacy helper success/error/quiet cleanup and default permissioned capped scanner remain explicitly compatible', async () => {
  const env = runtime({ destroy: async () => { throw false; } }); assert.equal(await withPdfDocument(env.pdfjs, new Uint8Array([1]), {}, async () => 7), 7); assert.deepEqual(env.calls, { load: 1, task: 1, doc: 1 });
  const failed = runtime(); await rejectValue(withPdfDocument(failed.pdfjs, new Uint8Array([1]), {}, async () => { throw null; }), null); assert.equal(failed.calls.doc, 1); assert.equal(failed.calls.task, 1);
  const permissioned = runtime({ doc: { getPermissions: async () => [4, 8] }, page: { getTextContent: async () => ({ items: [{ str: Array.from({ length: 12 }, (_, i) => `p${i}@example.test`).join(' ') }] }) } });
  const report = await scanPdfPrivacy(new Uint8Array([1]), { pdfjs: permissioned.pdfjs, maxMatches: 3 }); assert.deepEqual(report.encryption, { encrypted: true, locked: false }); assert.equal(report.sensitiveText.count, 3); assert.equal(report.sensitiveText.truncated, true); assert.equal(permissioned.calls.task, 1);
});
test('strict actual password exception differs from a message mentioning encryption, including abort reasons', async () => {
  const locked = { getDocument: () => ({ promise: Promise.reject(Object.assign(new Error('locked'), { name: 'PasswordException' })), destroy: async () => {} }) };
  const report = await scanPdfPrivacy(new Uint8Array([1]), { pdfjs: locked }); assert.equal(report.encryption.locked, true); assert.equal(report.inspection.categories.annotations.status, 'locked');
  await assert.rejects(scanPdfPrivacy(new Uint8Array([1]), { pdfjs: { getDocument: () => ({ promise: Promise.reject(new Error('encrypted password parser failure')), destroy: async () => {} }) } }), /parser failure/);
  const controller = new AbortController(); controller.abort(Object.assign(new Error('abort is not a password'), { name: 'PasswordException' })); await rejectValue(scanPdfPrivacy(new Uint8Array([1]), { pdfjs: locked, signal: controller.signal }), controller.signal.reason);
});
test('inspection failures are unknown, page work caps are partial, locations are bounded and legacy members persist', async () => {
  const env = runtime({ pages: 3, doc: { getMetadata: async () => { throw new Error('private detail'); }, getAttachments: async () => { throw null; } }, page: { getTextContent: async () => ({ items: [{ str: 'qa@example.test extra text' }, { str: 'second@example.test' }] }), getAnnotations: async () => Array.from({ length: 3 }, () => ({ subtype: 'Link', annotationType: 2, url: 'https://example.invalid' })), getOperatorList: async () => ({ fnArray: [7, 7, 7], argsArray: [[3], [3], [3]] }) } });
  const report = await scanPdfPrivacy(new Uint8Array([1]), { pdfjs: env.pdfjs, limits: { pages: 2, textItemsPerPage: 1, textUnitsPerPage: 16, textUnits: 20, annotationsPerPage: 1, annotations: 1, operatorsPerPage: 1, operators: 1 } });
  assert.equal(report.standardMetadata.count, 0); assert.equal(report.inspection.categories.standardMetadata.status, 'unknown'); assert.equal(report.inspection.categories.catalogAttachments.status, 'unknown'); assert.equal(report.inspection.complete, false); assert.equal(report.annotations.count, 1); assert.equal(report.invisibleText.operations, 1); assert.equal(report.pageCount, 3); assert.equal(report.linksAndActions.locations[0].page, 1); assert.equal(report.pageAttachments.count, 0); assert.ok(JSON.stringify(report).length <= 256000); assert.equal(JSON.stringify(report).includes('private detail'), false);
  const many = runtime({ pages: 105, page: { getAnnotations: async () => [{ subtype: 'Link', annotationType: 2, url: 'javascript:never-open' }] } }); const limited = await scanPdfPrivacy(new Uint8Array([1]), { pdfjs: many.pdfjs }); assert.equal(limited.linksAndActions.count, 105); assert.equal(limited.linksAndActions.locations.length, 100); assert.equal(limited.linksAndActions.locationsOmitted, 5); assert.equal(limited.linksAndActions.locationsTruncated, true);
  await assert.rejects(scanPdfPrivacy(new Uint8Array([1]), { pdfjs: env.pdfjs, limits: { pages: 0 } }), RangeError); await assert.rejects(scanPdfPrivacy(new Uint8Array([1]), { pdfjs: env.pdfjs, limits: { arbitrary: 1 } }), TypeError);
  const fields = runtime({ doc: { getFieldObjects: async () => ({ one: [{ type: 'text' }], two: [{ type: 'sig' }] }) } }); const bounded = await scanPdfPrivacy(new Uint8Array([1]), { pdfjs: fields.pdfjs, limits: { fields: 1 } }); assert.equal(bounded.forms.fieldCount, 1); assert.equal(bounded.inspection.categories.signatureFields.status, 'partial');
  const unreadable = runtime({ doc: { getMetadata: async () => ({ info: {}, metadata: { getRaw() { throw false; } } }) } }); assert.equal((await scanPdfPrivacy(new Uint8Array([1]), { pdfjs: unreadable.pdfjs })).inspection.categories.xmp.status, 'unknown');
});
test('local page view has bounded what/where/action/unknown rows and WebMCP summary excludes all raw matches and locations', async () => {
  const env = runtime({ doc: { getMetadata: async () => { throw 0; } }, page: { getTextContent: async () => ({ items: [{ str: 'private-person@example.test' }] }), getAnnotations: async () => [{ subtype: 'Link', annotationType: 2, unsafeUrl: 'javascript:never' }] } });
  const report = await scanPdfPrivacy(new Uint8Array([1]), { pdfjs: env.pdfjs }); const view = privacyView(report); assert.equal(view.categories.length, 13); assert.equal(view.categories[0].status, 'unknown'); assert.equal(view.categories[0].action, 'standard-metadata'); assert.ok(view.rows.some(row => row.page === 1)); assert.equal(JSON.stringify(view).includes('private-person'), false); assert.equal(JSON.stringify(view).includes('javascript:'), false);
  const tools = createPrivacyScanTools({ getSelectedFile: () => ({ name: 'private.pdf', size: 1 }), scanSelected: async () => summarizePrivacyReport(report) }); const summary = await tools[0].execute({}); assert.equal(JSON.stringify(summary).includes('private-person'), false); assert.equal(JSON.stringify(summary).includes('locations'), false); assert.equal(summary.truncated, true);
  report.sensitiveText.findings = Array.from({ length: 100 }, () => ({ page: 1, category: 'email', match: 'raw' })); assert.equal(privacyView(report).rows.length, 25); assert.equal(privacyView(report).totalRows, 102); assert.equal(privacyView(report, { offset: 100 }).rows.length, 2);
});

for (const value of [null, false, 0, '']) test(`genuine falsy abort ${JSON.stringify(value)} survives first held load and disposal drain in scanner and lifetime`, async () => {
  const load = deferred(), destroy = deferred(), started = deferred(), destroying = deferred(), controller = new AbortController();
  const doc = { destroy: async () => {} }; let loads = 0;
  const runtime = { getDocument() { loads++; started.resolve(); return { promise: load.promise, async destroy() { destroying.resolve(); await destroy.promise; } }; } };
  const lifetime = createPrivacyPdfLifetime(); let settled = false;
  const promise = scanPdfPrivacy(new Uint8Array([1]), { pdfjs: runtime, signal: controller.signal, inspectPdf: lifetime.inspect }); promise.then(() => { settled = true; }, () => { settled = true; });
  await started.promise; controller.abort(value); await destroying.promise; await tick(); assert.equal(settled, false); load.resolve(doc); await tick(); assert.equal(settled, false); destroy.resolve(); await rejectValue(promise, value); await lifetime.drained(); assert.equal(loads, 1);
});
test('owned cleanup failure with a falsy reason takes precedence and retains the exact handle for explicit Retry', async () => {
  const lifetime = createPrivacyPdfLifetime(), env = runtime({ destroy: async count => { if (count === 1) throw false; } });
  await assert.rejects(lifetime.inspect(env.pdfjs, new Uint8Array([1]), {}, async () => 7), { code: 'PRIVACY_CLEANUP' });
  await assert.rejects(lifetime.inspect(env.pdfjs, new Uint8Array([2]), {}, async () => 8), { code: 'PRIVACY_CLEANUP' }); assert.equal(env.calls.load, 1); assert.equal(env.calls.task, 1);
  await lifetime.drained({ retry: true }); assert.equal(env.calls.task, 2); assert.equal(await lifetime.inspect(env.pdfjs, new Uint8Array([3]), {}, async () => 9), 9); assert.equal(env.calls.load, 2);
});
test('owned disposal failure takes precedence over a genuine falsy canceled scan after first load drains', async () => {
  const load = deferred(), began = deferred(), controller = new AbortController(), lifetime = createPrivacyPdfLifetime(); let failed = true;
  const pdfjs = { getDocument() { began.resolve(); return { promise: load.promise, async destroy() { if (failed) { failed = false; throw false; } } }; } };
  const pending = scanPdfPrivacy(new Uint8Array([1]), { pdfjs, signal: controller.signal, inspectPdf: lifetime.inspect }); pending.catch(() => {}); await began.promise; controller.abort(null); load.resolve({ destroy: async () => {} });
  await assert.rejects(pending, { code: 'PRIVACY_CLEANUP' }); await lifetime.drained({ retry: true });
});
for (const method of ['addEventListener', 'removeEventListener']) for (const kind of ['lifetime', 'preview']) test(`signal intrinsic ${kind} bypasses own throwing ${method} and admits successors`, async () => {
  const controller = new AbortController(); let touched = 0;
  Object.defineProperty(controller.signal, method, { value() { touched++; throw new Error('own listener method must not run'); } });
  const env = runtime({ page: { getViewport: ({ scale }) => ({ width: 300 * scale, height: 200 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }) } }), lifetime = createPrivacyPdfLifetime();
  if (kind === 'lifetime') {
    assert.equal(await lifetime.inspect(env.pdfjs, new Uint8Array([1]), { signal: controller.signal }, async () => 7), 7); await lifetime.drained(); assert.equal(await lifetime.inspect(env.pdfjs, new Uint8Array([2]), {}, async () => 8), 8);
  } else {
    const preview = createPrivacyPreview({ canvas: canvas(), ensurePdfJs: async () => env.pdfjs, lifetime }); await preview.open(new Uint8Array([1]), { signal: controller.signal }); await preview.drained(); await preview.open(new Uint8Array([2]));
  }
  assert.equal(touched, 0); assert.equal(env.calls.load, 2); assert.equal(env.calls.task, 2); assert.equal(env.calls.doc, 2);
});
test('signal intrinsic brand rejects ducks before registration and ignores own getter overrides for both owners', async () => {
  let touched = 0; const duck = Object.defineProperties({}, { aborted: { get() { touched++; return false; } }, addEventListener: { get() { touched++; throw new Error('duck'); } } });
  const env = runtime({ page: { getViewport: ({ scale }) => ({ width: 300 * scale, height: 200 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }) } }), lifetime = createPrivacyPdfLifetime(), preview = createPrivacyPreview({ canvas: canvas(), ensurePdfJs: async () => env.pdfjs });
  await assert.rejects(lifetime.inspect(env.pdfjs, new Uint8Array([1]), { signal: duck }, async () => 7), TypeError); await lifetime.drained(); await assert.rejects(preview.open(new Uint8Array([1]), { signal: duck }), TypeError); await preview.drained(); assert.equal(env.calls.load, 0); assert.equal(touched, 0);
  const controller = new AbortController(); for (const key of ['aborted', 'reason', 'addEventListener', 'removeEventListener']) Object.defineProperty(controller.signal, key, { get() { touched++; throw new Error('own getter must not run'); } });
  assert.equal(await lifetime.inspect(env.pdfjs, new Uint8Array([2]), { signal: controller.signal }, async () => 8), 8); await preview.open(new Uint8Array([2]), { signal: controller.signal }); assert.equal(touched, 0); assert.equal(env.calls.load, 2);
});
test('signal intrinsic overridden listeners preserve held first promise, falsy reason and drained successor', async () => {
  const load = deferred(), destroy = deferred(), began = deferred(), destroying = deferred(), controller = new AbortController(), lifetime = createPrivacyPdfLifetime(); let first = true, loads = 0, touched = 0;
  for (const key of ['addEventListener', 'removeEventListener']) Object.defineProperty(controller.signal, key, { get() { touched++; throw new Error('own getter must not run'); } });
  const env = { getDocument() { loads++; if (!first) return { promise: Promise.resolve({ numPages: 1 }), destroy: async () => {} }; first = false; began.resolve(); return { promise: load.promise, async destroy() { destroying.resolve(); await destroy.promise; } }; } };
  const pending = lifetime.inspect(env, new Uint8Array([1]), { signal: controller.signal }, async () => 7); pending.catch(() => {}); await began.promise; controller.abort(0); await destroying.promise; await assert.rejects(lifetime.inspect(env, new Uint8Array([2]), {}, async () => 8), { name: 'InvalidStateError' });
  let drained = false; const barrier = lifetime.drained().then(() => { drained = true; }); load.resolve({ numPages: 1 }); await tick(); assert.equal(drained, false); assert.equal(loads, 1); destroy.resolve(); await rejectValue(pending, 0); await barrier; assert.equal(await lifetime.inspect(env, new Uint8Array([3]), {}, async () => 9), 9); assert.equal(touched, 0); assert.equal(loads, 2);
});
test('signal intrinsic preview listener overrides retain failed handle Retry and do not poison its successor', async () => {
  let touched = 0; const controller = new AbortController(); Object.defineProperty(controller.signal, 'removeEventListener', { value() { touched++; throw new Error('own remove must not run'); } });
  const env = runtime({ destroy: async count => { if (count === 1) throw false; }, page: { getViewport: ({ scale }) => ({ width: 300 * scale, height: 200 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }) } }), lifetime = createPrivacyPdfLifetime(), value = canvas(), preview = createPrivacyPreview({ canvas: value, ensurePdfJs: async () => env.pdfjs, lifetime });
  await assert.rejects(preview.open(new Uint8Array([1]), { signal: controller.signal }), { code: 'PRIVACY_CLEANUP' }); assert.equal(value.dataset.pdfPage, undefined); await assert.rejects(preview.open(new Uint8Array([2])), { code: 'PRIVACY_CLEANUP' }); assert.equal(env.calls.load, 1); await preview.drained({ retry: true }); await preview.open(new Uint8Array([3])); assert.equal(env.calls.load, 2); assert.equal(touched, 0); assert.equal(value.dataset.pdfPage, '1');
});
for (const cancelReason of [null, false, 0, '']) for (const stage of ['load', 'inspection', 'preview-load', 'preview-render', 'queue']) test(`rejected first ${stage} preserves genuine ${JSON.stringify(cancelReason)} only after disposal and recovers`, async () => {
  const started = deferred(), disposal = deferred(); let rejectWork;
  const work = new Promise((resolve, reject) => { rejectWork = reject; }), controller = new AbortController(), lifetime = createPrivacyPdfLifetime(), nativeError = new Error('native rejection'); let destroyed = 0, settled = false, queue, preview;
  const value = { width: 0, height: 0, dataset: {}, getContext: () => ({}) };
  const doc = { numPages: 1, async getPage() { return { getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }), render() { started.resolve(); return { promise: work, cancel() { rejectWork(nativeError); } }; } }; } };
  const env = { getDocument() { if (stage.includes('load')) { started.resolve(); return { promise: work, async destroy() { destroyed++; rejectWork(nativeError); await disposal.promise; } }; } return { promise: Promise.resolve(doc), async destroy() { destroyed++; await disposal.promise; } }; } };
  let pending;
  if (stage === 'queue') { queue = createPrivacyWorkQueue(async name => { if (name !== 'A') return 9; started.resolve(); try { return await work; } finally { await disposal.promise; } }); pending = queue.submit('A'); }
  else if (stage.startsWith('preview')) { preview = createPrivacyPreview({ canvas: value, ensurePdfJs: async () => env, lifetime }); pending = preview.open(new Uint8Array([1]), { signal: controller.signal }); }
  else pending = lifetime.inspect(env, new Uint8Array([1]), { signal: controller.signal }, async () => { if (stage === 'inspection') { started.resolve(); return work; } return 1; });
  pending.then(() => { settled = true; }, () => { settled = true; }); await started.promise;
  if (stage === 'queue') queue.cancel(cancelReason); else controller.abort(cancelReason); rejectWork(nativeError); await tick(); assert.equal(settled, false); disposal.resolve(); await rejectValue(pending, cancelReason);
  if (queue) { await queue.drained(); assert.equal(await queue.submit('B'), 9); }
  else { await lifetime.drained(); assert.equal(destroyed, 1); if (preview) { assert.deepEqual([value.width, value.height, value.dataset.pdfPage], [0, 0, undefined]); } assert.equal(await lifetime.inspect(runtime().pdfjs, new Uint8Array([1]), {}, async () => 9), 9); }
});
for (const cancelReason of [null, false, 0, '']) test(`rejected first cleanup fence wins genuine ${JSON.stringify(cancelReason)} and retries the same handle`, async () => {
  const started = deferred(), disposal = deferred(), controller = new AbortController(), lifetime = createPrivacyPdfLifetime(); let rejectLoad, destroys = 0;
  const promise = new Promise((resolve, reject) => { rejectLoad = reject; }), env = { getDocument() { started.resolve(); return { promise, async destroy() { destroys++; await disposal.promise; if (destroys === 1) throw false; } }; } };
  const pending = lifetime.inspect(env, new Uint8Array([1]), { signal: controller.signal }, async () => 7); pending.catch(() => {}); await started.promise; controller.abort(cancelReason); rejectLoad(new Error('native rejection')); disposal.resolve();
  await assert.rejects(pending, error => error?.code === 'PRIVACY_CLEANUP' && error.cause === false); await assert.rejects(lifetime.inspect(runtime().pdfjs, new Uint8Array([1]), {}, async () => 8), { code: 'PRIVACY_CLEANUP' }); assert.equal(destroys, 1); await lifetime.drained({ retry: true }); assert.equal(destroys, 2); assert.equal(await lifetime.inspect(runtime().pdfjs, new Uint8Array([1]), {}, async () => 9), 9);
});
for (const cancelReason of [null, false, 0, '']) test(`rejected first actual PDF.js immediate loading cancel preserves ${JSON.stringify(cancelReason)}`, async () => {
  const doc = await lib.PDFDocument.create({ updateMetadata: false }); doc.addPage([300, 400]); const bytes = new Uint8Array(await doc.save({ updateFieldAppearances: false })), started = deferred(), controller = new AbortController(), lifetime = createPrivacyPdfLifetime(); let destroyed = 0, nativeRejected = false;
  const observed = { getDocument(options) { const task = pdfjs.getDocument(options); started.resolve(); return { promise: task.promise.catch(error => { nativeRejected = true; throw error; }), async destroy() { destroyed++; await task.destroy(); } }; } };
  const pending = lifetime.inspect(observed, bytes, { signal: controller.signal, pdfjsAssets }, async () => 7); pending.catch(() => {}); await started.promise; controller.abort(cancelReason); await rejectValue(pending, cancelReason); await lifetime.drained(); assert.equal(nativeRejected, true); assert.equal(destroyed, 1); assert.equal(await lifetime.inspect(pdfjs, bytes, { pdfjsAssets }, async value => value.numPages), 1);
  if (cancelReason === null) await artifact('rejected-native-source.pdf', bytes);
});
test('rejected first queue preserves the owned cleanup fence through null cancellation, Retry and successors', async () => {
  const started = deferred(), disposal = deferred(), lifetime = createPrivacyPdfLifetime(); let rejectLoad, destroys = 0;
  const load = new Promise((resolve, reject) => { rejectLoad = reject; }), failing = { getDocument() { started.resolve(); return { promise: load, async destroy() { destroys++; await disposal.promise; if (destroys === 1) throw false; } }; } };
  const queue = createPrivacyWorkQueue((name, job) => lifetime.inspect(name === 'A' ? failing : runtime().pdfjs, new Uint8Array([1]), { signal: job.signal }, async () => 9));
  const first = queue.submit('A'); first.catch(() => {}); await started.promise; queue.cancel(null); rejectLoad(new Error('native rejection')); disposal.resolve(); await assert.rejects(first, error => error?.code === 'PRIVACY_CLEANUP' && error.cause === false); await queue.drained();
  await assert.rejects(queue.submit('B'), { code: 'PRIVACY_CLEANUP' }); assert.equal(destroys, 1); await lifetime.drained({ retry: true }); assert.equal(destroys, 2); assert.equal(await queue.submit('C'), 9); await queue.drained();
});
test('widget work bounds aggregate records while preserving logical field counts and partial unknown coverage', async () => {
  let visits = 0; const entries = Array.from({ length: 1001 }, () => Object.defineProperty({}, 'type', { get() { visits++; return 'text'; } }));
  const env = runtime({ doc: { getFieldObjects: async () => ({ one: entries }) } }), report = await scanPdfPrivacy(new Uint8Array([1]), { pdfjs: env.pdfjs, limits: { fields: 1 } }); assert.equal(visits, 1); assert.equal(report.forms.fieldCount, 1); assert.equal(report.inspection.categories.forms.status, 'partial'); assert.equal(report.inspection.categories.signatureFields.status, 'partial'); assert.equal(report.inspection.complete, false);
  visits = 0; const entry = Object.defineProperty({}, 'type', { get() { visits++; return 'text'; } }); const aggregate = runtime({ doc: { getFieldObjects: async () => ({ one: [entry, entry], two: [entry, entry] }) } }), bounded = await scanPdfPrivacy(new Uint8Array([1]), { pdfjs: aggregate.pdfjs, limits: { fields: 2 } }); assert.equal(visits, 2); assert.equal(bounded.forms.fieldCount, 2); assert.equal(bounded.inspection.categories.signatureFields.status, 'partial');
  const exact = runtime({ doc: { getFieldObjects: async () => ({ one: [{ type: 'sig' }], two: [{ type: 'text' }] }) } }), complete = await scanPdfPrivacy(new Uint8Array([1]), { pdfjs: exact.pdfjs, limits: { fields: 2 } }); assert.equal(complete.forms.fieldCount, 2); assert.equal(complete.forms.signatureFields, 1); assert.equal(complete.inspection.categories.signatureFields.status, 'complete');
});
test('widget work loop cooperatively preserves genuine abort after the current record and drains its owner', async () => {
  let visits = 0; const controller = new AbortController(), lifetime = createPrivacyPdfLifetime(), entries = Array.from({ length: 10 }, () => Object.defineProperty({}, 'type', { get() { if (++visits === 2) controller.abort(false); return 'text'; } }));
  const env = runtime({ doc: { getFieldObjects: async () => ({ one: entries }) } }); await rejectValue(scanPdfPrivacy(new Uint8Array([1]), { pdfjs: env.pdfjs, limits: { fields: 10 }, signal: controller.signal, inspectPdf: lifetime.inspect }), false); await lifetime.drained(); assert.equal(visits, 2); assert.equal(env.calls.task, 1); assert.equal(await lifetime.inspect(runtime().pdfjs, new Uint8Array([1]), {}, async () => 9), 9);
});
test('queue retains successful ownership, latest unread C only, and falsy Cancel after actual held work', async () => {
  const held = deferred(), started = deferred(), events = []; let token;
  const queue = createPrivacyWorkQueue(async (name, job) => { events.push(name); token = job; if (name === 'A') { started.resolve(); await held.promise; } return name; });
  const a = queue.submit('A'); a.catch(() => {}); await started.promise; const b = queue.submit('B'); b.catch(() => {}); const c = queue.submit('C'); await assert.rejects(b, { name: 'AbortError' }); await tick(); assert.deepEqual(events, ['A']); held.resolve(); await assert.rejects(a, { name: 'AbortError' }); assert.equal(await c, 'C'); await queue.drained(); assert.equal(token.isCurrent(), true); queue.cancel(); assert.equal(token.isCurrent(), false);
  for (const value of [null, false, 0, '']) { const hold = deferred(), began = deferred(); const lane = createPrivacyWorkQueue(async () => { began.resolve(); await hold.promise; return 1; }); const pending = lane.submit('held'); pending.catch(() => {}); await began.promise; lane.cancel(value); let drained = false; const drain = lane.drained().then(() => { drained = true; }); await tick(); assert.equal(drained, false); hold.resolve(); await rejectValue(pending, value); await drain; }
});
test('actual first File read drains on Clear and only the latest unread File starts', async () => {
  const bytes = await fixture(), held = deferred(), began = deferred(), names = [], a = new File([bytes], 'A.pdf'), b = new File([bytes], 'B.pdf'), c = new File([bytes], 'C.pdf');
  const session = createDocumentSession(); session.begin(bytes, 'accepted.pdf', { type: 'application/pdf' }); const accepted = session.snapshot();
  const lane = createPrivacyWorkQueue(async (file, job) => { names.push(file.name); const owned = new Uint8Array(await file.arrayBuffer()); if (file === a) { began.resolve(); await held.promise; } job.assertCurrent(); return owned; });
  const first = lane.submit(a); first.catch(() => {}); await began.promise; const unread = lane.submit(b); unread.catch(() => {}); const latest = lane.submit(c); latest.catch(() => {}); await assert.rejects(unread, { name: 'AbortError' }); await tick(); assert.deepEqual(names, ['A.pdf']);
  lane.cancel(null); await rejectValue(latest, null); assert.deepEqual(session.snapshot(), accepted); held.resolve(); await assert.rejects(first, { name: 'AbortError' }); await lane.drained(); assert.deepEqual(names, ['A.pdf']); assert.equal(digest(await lane.submit(c)), digest(bytes)); assert.deepEqual(names, ['A.pdf', 'C.pdf']);
});
test('actual PDF.js failed task disposal is retained and retries that exact handle before another load', async () => {
  const source = await fixture(), lifetime = createPrivacyPdfLifetime(); let loads = 0, destroys = 0, fail = true;
  const observed = { getDocument(options) { loads++; const task = pdfjs.getDocument(options); return { promise: task.promise, async destroy() { destroys++; await task.destroy(); if (fail) { fail = false; throw 0; } } }; } };
  await assert.rejects(lifetime.inspect(observed, source, { pdfjsAssets }, async doc => doc.numPages), { code: 'PRIVACY_CLEANUP' });
  await assert.rejects(lifetime.inspect(observed, source, { pdfjsAssets }, async doc => doc.numPages), { code: 'PRIVACY_CLEANUP' }); assert.equal(loads, 1); assert.equal(destroys, 1);
  await lifetime.drained({ retry: true }); assert.equal(destroys, 2); assert.equal(await lifetime.inspect(observed, source, { pdfjsAssets }, async doc => doc.numPages), 4); assert.equal(loads, 2); await lifetime.drained();
});
test('genuine cancellation during actual saved-output await preserves null after save drains', async () => {
  const source = await fixture(), held = deferred(), began = deferred(), controller = new AbortController(); let first = true, settled = false;
  const injected = { ...lib, PDFDocument: { async load(...args) { const doc = await lib.PDFDocument.load(...args), save = doc.save.bind(doc); doc.save = async (...options) => { const bytes = await save(...options); if (first) { first = false; began.resolve(); await held.promise; } return bytes; }; return doc; } } };
  const pending = cleanPdfPrivacy(source, { ...nativeOptions, pdfLib: injected, signal: controller.signal }); pending.then(() => { settled = true; }, () => { settled = true; }); await began.promise; controller.abort(null); await tick(); assert.equal(settled, false); held.resolve(); await rejectValue(pending, null);
});
test('genuine encrypted fixture produces actual native PasswordException and remains locked/unknown with no cleanup', async () => {
  const { default: factory } = await import('../public/vendor/pdfstudio-0.4.0/qpdf.js');
  const module = await factory({ locateFile: path => new URL('../public/vendor/pdfstudio-0.4.0/' + path, import.meta.url).pathname, print() {}, printErr() {} });
  module.FS.writeFile('/source.pdf', await fixture());
  try {
    const code = module.callMain(['--suppress-recovery', '--encrypt', '--user-password=fixture-password', '--owner-password=fixture-owner', '--bits=256', '--', '/source.pdf', '/locked.pdf']); assert.equal(code, 0);
    const bytes = Uint8Array.from(module.FS.readFile('/locked.pdf')), lifetime = createPrivacyPdfLifetime(), report = await scanPdfPrivacy(bytes, { pdfjs, pdfjsAssets, inspectPdf: lifetime.inspect }); assert.equal(report.encryption.locked, true); assert.equal(report.inspection.categories.sensitivePatterns.status, 'locked'); assert.equal(report.sensitiveText.findings.length, 0); await lifetime.drained(); await assert.rejects(cleanPdfPrivacy(bytes, nativeOptions), /Locked PDFs/); await artifact('locked-source.pdf', bytes);
  } finally { for (const path of ['/source.pdf', '/locked.pdf']) { try { module.FS.unlink(path); } catch {} } }
});

test('genuine rich PDF cleanup returns actual before/verification and removes raw blank/nontext/null Info keys only', async () => {
  const source = await fixture({ raw: true }), lifetime = createPrivacyPdfLifetime(), result = await cleanPdfPrivacy(source, { ...nativeOptions, inspectPdf: lifetime.inspect, limits: PRIVACY_SCAN_LIMITS }); await lifetime.drained();
  assert.equal(result.before.pageCount, 4); assert.equal(result.report.standardMetadata.count, 0); assert.equal(result.lossManifest.removedCount, 8); assert.deepEqual(result.verification.sourceInfoFields, ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate']); assert.equal(result.verification.standardInfoAbsent, true); assert.equal(result.verification.pageCountUnchanged, true);
  const before = await reopen(source), after = await reopen(result.bytes); assert.deepEqual(graph(after), graph(before)); assert.deepEqual(after.context.lookup(after.context.trailerInfo.Info).keys().map(key => key.toString()), ['/Company']); assert.equal(result.report.xmp.present, true); assert.equal(result.report.catalogAttachments.count, 1); assert.equal(result.report.forms.fieldCount, 1); assert.equal(result.report.sensitiveText.count > 0, true);
  await artifact('rich-source.pdf', source); await artifact('rich-info-cleared.pdf', result.bytes); await artifact('rich-before-after.json', Buffer.from(JSON.stringify({ before: result.before, after: result.report, verification: result.verification, lossManifest: result.lossManifest }, null, 2)));
  for (let index = 0; index < 4; index++) { const a = canvas(), b = canvas(), first = createPrivacyPreview({ canvas: a, ensurePdfJs: async () => pdfjs, pdfjsAssets }), second = createPrivacyPreview({ canvas: b, ensurePdfJs: async () => pdfjs, pdfjsAssets }); await first.open(source, { pageIndex: index }); await second.open(result.bytes, { pageIndex: index }); assert.deepEqual([a.width, a.height], [b.width, b.height]); assert.deepEqual(a.getContext('2d').getImageData(0, 0, a.width, a.height).data, b.getContext('2d').getImageData(0, 0, b.width, b.height).data); await artifact(`page-${index + 1}-result.png`, b.toBuffer('image/png')); first.clear(); second.clear(); await first.drained(); await second.drained(); }
});
test('legacy actual cleanup default inspector still works and unknown source observations block verified cleanup', async () => {
  const source = await fixture(), result = await cleanPdfPrivacy(source, nativeOptions); assert.equal(result.report.standardMetadata.count, 0); assert.equal(result.before.inspection.complete, true); await artifact('legacy-cleaned.pdf', result.bytes);
  const env = runtime({ doc: { getMetadata: async () => { throw new Error('unavailable'); } } }); await assert.rejects(cleanPdfPrivacy(source, { ...nativeOptions, pdfjs: env.pdfjs }), /unknown or partial/);
});
test('actual extreme-page representative verification and selected page use bounded canvases and release them', async () => {
  const source = await fixture({ extreme: true }), releases = []; const result = await cleanPdfPrivacy(source, { ...nativeOptions, createCanvas(w, h) {
    const value = canvas(), last = { width: w, height: h }; releases.push(last);
    // napi-rs resets zero dimensions to 350x150. Record the actual browser-
    // shaped release setters while retaining the real native render context.
    return new Proxy(value, { get(target, key) { const entry = Reflect.get(target, key, target); return typeof entry === 'function' ? entry.bind(target) : entry; }, set(target, key, size) { if (key === 'width' || key === 'height') last[key] = size; return Reflect.set(target, key, size, target); } });
  } }); assert.ok(releases.length); assert.ok(releases.every(value => value.width === 0 && value.height === 0));
  const value = canvas(), preview = createPrivacyPreview({ canvas: value, ensurePdfJs: async () => pdfjs, pdfjsAssets }); await preview.open(result.bytes, { pageIndex: 50 }); assert.equal(value.dataset.pdfPage, '1'); assert.ok(value.width <= 900 && value.height <= 900 && value.width * value.height <= 4000000); await artifact('extreme-info-cleared.pdf', result.bytes); preview.clear(); await preview.drained();
});
test('preview rejects invalid input before runtime and actual 1001-page input before selected-page rendering', async () => {
  let loads = 0; const value = canvas(), preview = createPrivacyPreview({ canvas: value, ensurePdfJs: async () => { loads++; return pdfjs; }, pdfjsAssets });
  await assert.rejects(preview.open(new Uint8Array()), { code: 'PRIVACY_PREVIEW_INPUT' }); await assert.rejects(preview.open(new Uint8Array([1]), { pageIndex: -1 }), { code: 'PRIVACY_PREVIEW_INPUT' }); assert.equal(loads, 0);
  const doc = await lib.PDFDocument.create({ updateMetadata: false }); for (let index = 0; index < 1001; index++) doc.addPage([10, 10]); await assert.rejects(preview.open(new Uint8Array(await doc.save())), { code: 'PRIVACY_PAGE_LIMIT' }); await preview.drained(); assert.equal(loads, 1); assert.equal(value.dataset.pdfPage, undefined);
});

for (const phase of ['load', 'render', 'save', 'destroy']) test(`first actual native ${phase} promise drains before C and unread B never starts`, async () => {
  const source = await fixture(), held = deferred(), began = deferred(), events = []; let first = true, loads = 0;
  const observed = { ...pdfjs, getDocument(options) { const task = pdfjs.getDocument(options); loads++; const promise = task.promise.then(async doc => {
    if (phase === 'load' && first) { first = false; began.resolve(); await held.promise; }
    if (phase !== 'render') return doc;
    return { numPages: doc.numPages, destroy: () => doc.destroy?.(), async getPage(page) { const native = await doc.getPage(page); return { getViewport: value => native.getViewport(value), render(value) { const render = native.render(value); return { cancel: () => render.cancel(), promise: render.promise.then(async () => { if (first) { first = false; began.resolve(); await held.promise; } }) }; } }; } };
  }); return { promise, async destroy() { await task.destroy(); if (phase === 'destroy' && first) { first = false; began.resolve(); await held.promise; } } }; } };
  const injected = { ...lib, PDFDocument: { async load(...args) { const doc = await lib.PDFDocument.load(...args), save = doc.save.bind(doc); doc.save = async (...options) => { const bytes = await save(...options); if (phase === 'save' && first) { first = false; began.resolve(); await held.promise; } return bytes; }; return doc; } } };
  const lifetime = createPrivacyPdfLifetime(), target = canvas(), preview = createPrivacyPreview({ canvas: target, ensurePdfJs: async () => observed, pdfjsAssets, lifetime });
  const queue = createPrivacyWorkQueue(async (name, job) => { events.push(name); if (phase === 'save') return cleanPdfPrivacy(source, { ...nativeOptions, pdfLib: injected, signal: job.signal, inspectPdf: lifetime.inspect }); if (phase === 'render') return preview.open(source, { signal: job.signal }); return lifetime.inspect(observed, source, { signal: job.signal, pdfjsAssets }, async doc => doc.numPages); });
  const a = queue.submit('A'); a.catch(() => {}); await began.promise; const b = queue.submit('B'); b.catch(() => {}); const c = queue.submit('C'); c.catch(() => {}); await assert.rejects(b, { name: 'AbortError' }); await tick(); assert.deepEqual(events, ['A']); let drained = false; const drain = queue.drained().then(() => { drained = true; }); await tick(); assert.equal(drained, false); held.resolve(); await assert.rejects(a, { name: 'AbortError' }); await c; await drain; assert.deepEqual(events, ['A', 'C']); if (phase !== 'save') assert.equal(loads, 2); await lifetime.drained();
});

test.after(async () => { await writeFile(join(output, 'artifacts.json'), JSON.stringify(records, null, 2) + '\n'); });
