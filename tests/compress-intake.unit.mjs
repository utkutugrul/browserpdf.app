import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfLib from 'pdf-lib';
import { createCompressIntake, COMPRESS_INTAKE_LIMITS, sameCompressOwner } from '../public/js/compress-intake.js';
import { createDocumentSession } from '../public/js/core/document-session.js';
import { createImageWorkLane } from '../public/js/core/image-intake.js';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';

globalThis.DOMMatrix = DOMMatrix; globalThis.ImageData = ImageData; globalThis.Path2D = Path2D;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const original = await makePdf('ORIGINAL A');
async function makePdf(label, pages = 1) {
  const doc = await pdfLib.PDFDocument.create();
  for (let index = 0; index < pages; index++) doc.addPage([300, 400]).drawText(`${label} ${index + 1}`, { x: 30, y: 320 });
  return new Uint8Array(await doc.save());
}
function file(bytes, name = 'selection.pdf', extra = {}) {
  const value = new File([bytes], name, { type: 'application/pdf' }); Object.assign(value, extra); return value;
}
function setup({ runtime = pdfjs, lib = pdfLib } = {}) {
  const session = createDocumentSession(); session.begin(original, 'A.pdf', { capabilities: { searchable: true, forms: false } });
  const lane = createImageWorkLane();
  const intake = createCompressIntake({ session, ensureSession: async () => session, ensurePdfLib: async () => lib, ensurePdfJs: async () => runtime, lane });
  return { session, lane, intake, stage(value, options = {}) { return intake.stage(value, { expectedOwner: session.snapshot(), isCurrent: () => true, ...options }); } };
}
function observe({ beforeLoad, beforeDestroy, loadError } = {}) {
  const stats = { created: 0, destroyed: 0, active: 0, maximum: 0, options: [] };
  return { stats, runtime: { ...pdfjs, getDocument(options) {
    stats.created++; stats.active++; stats.maximum = Math.max(stats.maximum, stats.active); stats.options.push(options);
    const task = pdfjs.getDocument(options); let destroyed = false;
    return { promise: task.promise.then(async (doc) => { await beforeLoad?.(doc); if (loadError) throw loadError; return doc; }),
      async destroy() { await beforeDestroy?.(); await task.destroy(); if (!destroyed) { stats.destroyed++; stats.active--; destroyed = true; } },
    };
  } } };
}

test('real strict intake commits exactly its returned owner, preserves bytes and drains PDF.js', async () => {
  const seen = observe(), env = setup({ runtime: seen.runtime }), bytes = await makePdf('NEW B', 2);
  const result = await env.stage(file(bytes, 'B.pdf'));
  assert.equal(result.pageCount, 2); assert.equal(result.readOnly, false); assert.deepEqual(result.bytes, bytes);
  assert(sameCompressOwner(result.owner, env.session.snapshot())); assert.equal(result.owner.taskId, env.session.snapshot().taskId);
  assert.equal(result.capabilities.encrypted, false); assert.equal(result.capabilities.searchable, undefined);
  assert.equal(seen.stats.created, 1); assert.equal(seen.stats.destroyed, 1); assert.equal(seen.stats.active, 0);
  assert.equal(seen.stats.options[0].stopAtErrors, true); assert.equal(seen.stats.options[0].enableXfa, false);
});
test('malformed real PDF rejects B transactionally and then accepts a valid successor', async () => {
  const env = setup(), before = env.session.transfer();
  await assert.rejects(env.stage(file(new TextEncoder().encode('%PDF-1.7\ninvalid structure\n%%EOF'))));
  assert.deepEqual(env.session.transfer(), before);
  const result = await env.stage(file(await makePdf('RECOVERED'))); assert.equal(result.readOnly, false);
});
test('native metadata oversize rejects without reading and keeps inherited A', async () => {
  const env = setup(), before = env.session.transfer(); let reads = 0;
  await assert.rejects(env.stage({ name: 'large.pdf', type: 'application/pdf', size: COMPRESS_INTAKE_LIMITS.bytes + 1, arrayBuffer() { reads++; throw Error('must not read'); } }), /80 MiB/);
  assert.equal(reads, 0); assert.deepEqual(env.session.transfer(), before);
});
test('actual bytes above metadata budget reject before engine load', async () => {
  const env = setup({ lib: { PDFDocument: { load() { throw Error('parser must not start'); } } } });
  await assert.rejects(env.stage({ name: 'large.pdf', type: 'application/pdf', size: 100, async arrayBuffer() { return new ArrayBuffer(COMPRESS_INTAKE_LIMITS.bytes + 1); } }), /selection limit/);
  assert.deepEqual(env.session.current().bytes, original);
});
test('held File read abort drains before latest descriptor and never reads superseded B', async () => {
  const env = setup(), hold = deferred(), started = deferred(), bytes = await makePdf('LATEST C'); let bReads = 0, cReads = 0;
  const controller = new AbortController(), a = env.stage({ name: 'held.pdf', type: 'application/pdf', size: original.length, async arrayBuffer() { started.resolve(); await hold.promise; return original.slice().buffer; } }, { signal: controller.signal });
  const rejectedA = assert.rejects(a, { name: 'AbortError' }); await started.promise; controller.abort();
  const b = env.stage({ name: 'B.pdf', type: 'application/pdf', size: original.length, arrayBuffer() { bReads++; return original.slice().buffer; } });
  const rejectedB = assert.rejects(b, { name: 'AbortError' });
  const c = env.stage({ name: 'C.pdf', type: 'application/pdf', size: bytes.length, arrayBuffer() { cReads++; return Promise.resolve(bytes.slice().buffer); } });
  assert.equal(cReads, 0); hold.resolve(); await rejectedA; await rejectedB;
  const result = await c; assert.equal(bReads, 0); assert.equal(cReads, 1); assert.equal(result.name, 'C.pdf'); assert.deepEqual(result.bytes, bytes);
});
test('held real PDF.js completion loses ownership without committing over newer task', async () => {
  const held = deferred(), reached = deferred(), seen = observe({ async beforeLoad() { reached.resolve(); await held.promise; } });
  const env = setup({ runtime: seen.runtime }), before = env.session.snapshot();
  const pending = env.stage(file(await makePdf('STALE'))), rejected = assert.rejects(pending, { name: 'AbortError' });
  await reached.promise; env.session.begin(await makePdf('EXTERNAL C'), 'C.pdf'); const committed = env.session.transfer(); held.resolve(); await rejected;
  assert.notEqual(committed.taskId, before.taskId); assert.deepEqual(env.session.transfer(), committed); assert.equal(seen.stats.active, 0);
});
test('held task destruction blocks a successor read and active native jobs stay serial', async () => {
  const held = deferred(), reached = deferred(); let once = true, reads = 0;
  const seen = observe({ async beforeDestroy() { if (once) { once = false; reached.resolve(); await held.promise; } } }), env = setup({ runtime: seen.runtime });
  const controller = new AbortController(), first = env.stage(file(await makePdf('HELD')), { signal: controller.signal });
  const rejected = assert.rejects(first, { name: 'AbortError' }); await reached.promise; controller.abort();
  const second = env.stage({ name: 'SUCCESSOR.pdf', type: 'application/pdf', size: original.length, async arrayBuffer() { reads++; return original.slice().buffer; } });
  assert.equal(reads, 0); held.resolve(); await rejected; await second;
  assert.equal(reads, 1); assert.equal(seen.stats.maximum, 1); assert.equal(seen.stats.active, 0);
});
test('native cleanup failure retains A, blocks work, retries real destroy and allows successor', async () => {
  let fails = true, reads = 0; const seen = observe({ beforeDestroy() { if (fails) throw new Error('controlled native cleanup rejection'); } }), env = setup({ runtime: seen.runtime });
  const before = env.session.transfer();
  await assert.rejects(env.stage(file(await makePdf('REJECTED'))), (error) => error.code === 'COMPRESS_NATIVE_CLEANUP'); assert.deepEqual(env.session.transfer(), before);
  const successor = { name: 'SUCCESSOR.pdf', type: 'application/pdf', size: original.length, async arrayBuffer() { reads++; return original.slice().buffer; } };
  await assert.rejects(env.stage(successor), /cleanup failed/); assert.equal(reads, 0);
  fails = false; await env.intake.drained(); const result = await env.stage(successor);
  assert.equal(reads, 1); assert.equal(result.name, 'SUCCESSOR.pdf'); assert.equal(seen.stats.active, 0);
});
test('cleanup failure during an obsolete aborted intake is reported by drain before the successor can read', async () => {
  const held = deferred(), reached = deferred(); let firstDestroy = true, reads = 0;
  const seen = observe({ async beforeLoad() { reached.resolve(); await held.promise; }, beforeDestroy() { if (firstDestroy) { firstDestroy = false; throw new Error('Aborted native cleanup rejection'); } } });
  const env = setup({ runtime: seen.runtime }), before = env.session.transfer(), controller = new AbortController();
  const first = env.stage(file(await makePdf('OBSOLETE')), { signal: controller.signal });
  const rejected = assert.rejects(first, (error) => error.code === 'COMPRESS_NATIVE_CLEANUP');
  await reached.promise; controller.abort(); held.resolve(); await rejected; assert.deepEqual(env.session.transfer(), before);
  await assert.rejects(env.intake.drained(), (error) => error.code === 'COMPRESS_NATIVE_CLEANUP'); assert.equal(seen.stats.destroyed, 0);
  await env.intake.drained(); assert.equal(seen.stats.destroyed, 1);
  await env.stage({ name: 'AFTER CLEANUP.pdf', type: 'application/pdf', size: original.length, async arrayBuffer() { reads++; return original.slice().buffer; } });
  assert.equal(reads, 1); assert.equal(seen.stats.active, 0);
});
test('real 251-page native replacement rejects; guarded inherited transfer stays read-only and keeps history', async () => {
  const env = setup(), many = await makePdf('MANY', 251), before = env.session.transfer();
  await assert.rejects(env.stage(file(many)), /250-page/); assert.deepEqual(env.session.transfer(), before);
  env.session.adopt(many, 'Many.pdf', { type: 'application/pdf', capabilities: { searchable: true, forms: false } });
  const transfer = env.session.transfer(), received = file(many, 'Many.pdf', { browserpdfSession: { ...transfer, ...transfer.current } });
  const result = await env.stage(received, { allowInheritedReadonly: true });
  assert.equal(result.reason, 'pages'); assert.equal(result.readOnly, true); assert.equal(result.pageCount, 251);
  assert.equal(result.owner.taskId, transfer.taskId); assert.deepEqual(env.session.original().bytes, original); assert.equal(env.session.snapshot().canUndo, true); assert.equal(result.capabilities.searchable, true);
});
test('inherited typed name, capabilities, original and exact committed task are preserved', async () => {
  const env = setup(), bytes = await makePdf('CHOSEN');
  env.session.adopt(bytes, 'bounded.pdf', { name: 'bounded.pdf', displayName: 'Full original chosen label.pdf', type: 'application/pdf', capabilities: { searchable: true, forms: true, rasterized: false }, boundary: { kind: 'pdf-rewrite', losses: ['scene-baked'] } });
  const transfer = env.session.transfer(); const result = await env.stage(file(bytes, 'bounded.pdf', { browserpdfSession: { ...transfer, ...transfer.current } }), { allowInheritedReadonly: true });
  assert.equal(result.displayName, 'Full original chosen label.pdf'); assert.equal(result.type, 'application/pdf'); assert.deepEqual(result.capabilities, { searchable: true, forms: true, rasterized: false, encrypted: false });
  assert.deepEqual(result.boundary, transfer.current.boundary); assert.deepEqual(env.session.original().bytes, original); assert.equal(result.owner.taskId, transfer.taskId);
});
test('guarded inherited 80–250 MiB policy uses actual bytes and exact session; native path refuses', async () => {
  // A controlled public parser seam isolates byte admission without making the
  // native parsers scan 81 MiB of synthetic padding. Actual parsers are used in
  // all ordinary and page-boundary cases above; this is a budget-policy test.
  const bytes = new Uint8Array(COMPRESS_INTAKE_LIMITS.bytes + 1); bytes.set(new TextEncoder().encode('%PDF-'));
  const lib = { PDFDocument: { async load() { return { getPageCount: () => 1 }; } } }, runtime = { getDocument() { return { promise: Promise.resolve({ numPages: 1 }), destroy: async () => {} }; } };
  const env = setup({ lib, runtime }), inherited = { taskId: 'inherited-large', original: env.session.original(), capabilities: { searchable: true } };
  const value = { name: 'large.pdf', type: 'application/pdf', size: bytes.length, browserpdfSession: inherited, async arrayBuffer() { return bytes.slice().buffer; } };
  await assert.rejects(env.stage(value), /80 MiB/);
  const result = await env.stage(value, { allowInheritedReadonly: true });
  assert.equal(result.reason, 'bytes'); assert.equal(result.readOnly, true); assert.equal(result.bytes.length, bytes.length); assert.equal(result.owner.taskId, inherited.taskId); assert.deepEqual(env.session.original().bytes, original);
});
test('invalid inherited resources reject transactionally after parser cleanup', async () => {
  const seen = observe(), env = setup({ runtime: seen.runtime }), before = env.session.transfer();
  const received = file(await makePdf('BAD RESTORE'), 'bad.pdf', { browserpdfSession: { taskId: 'bad-restore', scene: { version: 1, sourceRef: 'missing', objects: [], fields: {}, flatten: false } } });
  await assert.rejects(env.stage(received, { allowInheritedReadonly: true }), /resource/);
  assert.deepEqual(env.session.transfer(), before); assert.equal(seen.stats.active, 0);
});
test('malformed inherited input and a non-encrypted fallback probe preserve A and permit a positive successor', async () => {
  const env = setup(), before = env.session.transfer(), descriptor = { taskId: 'malformed-inherited', original: env.session.original() };
  await assert.rejects(env.stage(file(new TextEncoder().encode('%PDF-1.7\nBAD\n%%EOF'), 'bad.pdf', { browserpdfSession: descriptor }), { allowInheritedReadonly: true }));
  assert.deepEqual(env.session.transfer(), before);
  const originalError = new Error('Controlled strict load failure'); let strict = true, probes = 0;
  const lib = { ...pdfLib, PDFDocument: { async load(bytes, options) {
    if (!options.ignoreEncryption && strict) throw originalError;
    if (options.ignoreEncryption) probes++;
    return pdfLib.PDFDocument.load(bytes, options);
  } } };
  const controlled = setup({ lib }), originalTask = controlled.session.transfer();
  await assert.rejects(controlled.stage(file(original, 'not-encrypted.pdf', { browserpdfSession: { taskId: 'not-encrypted' } }), { allowInheritedReadonly: true }), (error) => error === originalError);
  assert.equal(probes, 1); assert.deepEqual(controlled.session.transfer(), originalTask);
  strict = false; await controlled.stage(file(await makePdf('AFTER NON-ENCRYPTED REJECTION'))); assert.equal(controlled.session.current().capabilities.encrypted, false);
});
test('held inherited fallback parse is owned after its await and cannot commit over a newer task', async () => {
  const reached = deferred(), held = deferred(); let first = true;
  const lib = { ...pdfLib, PDFDocument: { async load(bytes, options) {
    if (!options.ignoreEncryption && first) throw new Error('Controlled initial strict rejection');
    if (options.ignoreEncryption && first) { first = false; reached.resolve(); await held.promise; return { isEncrypted: true }; }
    return pdfLib.PDFDocument.load(bytes, options);
  } } };
  const env = setup({ lib }), pending = env.stage(file(original, 'held-fallback.pdf', { browserpdfSession: { taskId: 'held-fallback' } }), { allowInheritedReadonly: true });
  const rejected = assert.rejects(pending, { name: 'AbortError' }); await reached.promise;
  env.session.begin(await makePdf('EXTERNAL NEW TASK'), 'new.pdf'); const next = env.session.transfer(); held.resolve(); await rejected;
  assert.deepEqual(env.session.transfer(), next); await env.stage(file(await makePdf('POSITIVE SUCCESSOR')));
});
