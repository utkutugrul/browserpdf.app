import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import * as pdfLib from 'pdf-lib';
import { createDocumentSession, BOUNDARY_LOSSES } from '../public/js/core/document-session.js';
import { createProtectionIntake, createProtectionFileQueue, sameProtectionOwner, localIntakeOwner, protectionGuard, protectionBoundary, protectionLossMessages } from '../public/js/protection-intake.js';
import { createProtectionPreview } from '../public/js/protection-preview.js';
globalThis.crypto ??= webcrypto;
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const guard = () => ({ signal: new AbortController().signal, isCurrent: () => true });

test('boundary admission retains prior and baked disclosures through actual SDK Use, handoff and history', async () => {
  const original = await pdf(), rewritten = await pdf(), session = createDocumentSession();
  const prior = { kind: 'page-copy', losses: ['structure-inspection-incomplete', 'signature-rewrite'] };
  session.begin(original, 'Original.pdf', { boundary: prior, capabilities: { encrypted: false } });
  session.beginScene(); const scene = session.scene(); scene.fields.retained = { kind: 'text', value: 'Changed' }; session.changeScene(scene);
  const boundary = protectionBoundary(session.current().boundary, ['scene-baked', 'signature-rewrite']);
  session.adopt(rewritten, 'Protected.pdf', { boundary, capabilities: { encrypted: true } });
  assert.deepEqual(session.current().boundary, { kind: 'pdf-rewrite', losses: ['structure-inspection-incomplete', 'signature-rewrite', 'scene-baked'] });
  const transfer = session.transfer(), resumed = createDocumentSession(); resumed.begin(transfer.current.bytes, transfer.current.name, { ...transfer, ...transfer.current });
  resumed.adopt(original, 'Unlocked.pdf', { boundary: protectionBoundary(resumed.current().boundary), capabilities: { encrypted: false } });
  assert.deepEqual(resumed.current().boundary, boundary); assert.deepEqual(resumed.original().boundary, prior); assert.deepEqual(resumed.original().bytes, original);
  resumed.undo(); assert.deepEqual(resumed.current().boundary, boundary); assert.equal(resumed.current().capabilities.encrypted, true);
  resumed.undo(); assert.deepEqual(resumed.current().boundary, prior); assert.equal(resumed.scene().fields.retained.value, 'Changed');
  resumed.redo(); assert.deepEqual(resumed.current().boundary, boundary);
});
test('boundary unchanged-byte no-op preserves each accepted kind without adding rewrite losses', async () => {
  const source = await pdf();
  for (const kind of ['page-copy', 'pdf-rewrite', 'raster-redaction']) {
    const prior = { kind, losses: ['crop-hidden-content'] }, session = createDocumentSession(); session.begin(source, 'Plain.pdf', { boundary: prior });
    const before = session.snapshot(), copied = protectionBoundary(session.current().boundary, [], { rewrite: false });
    assert.deepEqual(copied, prior); copied.losses.push('scene-baked'); assert.deepEqual(session.current().boundary, prior);
    session.adopt(source, 'Plain.pdf', { boundary: protectionBoundary(prior, [], { rewrite: false }) });
    assert.deepEqual(session.current().bytes, source); assert.deepEqual(session.current().boundary, prior); assert.equal(session.snapshot().revision, before.revision);
  }
  assert.equal(protectionBoundary(undefined, [], { rewrite: false }), undefined);
});
test('boundary finite disclosure copy covers SDK losses, filters unknowns and rejects SDK overflow before adoption', async () => {
  const messages = protectionLossMessages({ losses: [...BOUNDARY_LOSSES, 'private-unknown'] }); assert.equal(messages.length, BOUNDARY_LOSSES.length);
  assert.ok(messages.every(message => message.length > 20 && !BOUNDARY_LOSSES.some(code => message.includes(code))));
  const translated = []; protectionLossMessages({ losses: ['scene-baked'] }, (key, fallback) => { translated.push(key); return fallback; }); assert.deepEqual(translated, ['workspace.loss_scene-baked']);
  assert.deepEqual(protectionBoundary(undefined, ['unknown']), { kind: 'pdf-rewrite', losses: ['signature-rewrite'] });
  const source = await pdf(), session = createDocumentSession(), losses = BOUNDARY_LOSSES.filter(code => code !== 'signature-rewrite').slice(0, 12);
  session.begin(source, 'Prior.pdf', { boundary: { kind: 'pdf-rewrite', losses } }); const before = session.transfer();
  assert.throws(() => protectionBoundary(session.current().boundary), { code: 'boundary-limit' }); assert.deepEqual(session.transfer(), before);
  assert.equal(protectionBoundary(session.current().boundary, [], { rewrite: false }).losses.length, 12);
});
async function pdf() { const doc = await pdfLib.PDFDocument.create(); doc.setTitle('Owned source'); doc.addPage([320, 240]); return doc.save(); }
function file(bytes, read = async () => bytes.slice().buffer) { return { name: 'Owned.pdf', type: 'application/pdf', size: bytes.length, arrayBuffer: read }; }
function intakeWith({ pages = 1, password = false, destroy = async () => {} } = {}) {
  let loads = 0, destroys = 0;
  const value = createProtectionIntake({ ensurePdfLib: async () => pdfLib, ensurePdfJs: async () => ({ getDocument() { loads++; return { promise: password ? Promise.reject(Object.assign(new Error('private'), { name: 'PasswordException' })) : Promise.resolve({ numPages: pages }), destroy: async () => { destroys++; await destroy(destroys); } }; } }) });
  return { value, loads: () => loads, destroys: () => destroys };
}
test('owned validation preserves source and drains its actual parser before returning', async () => {
  const bytes = await pdf(), before = bytes.slice(), hold = deferred(); const { value, destroys } = intakeWith({ destroy: () => hold.promise });
  const staged = await value.read(file(bytes), guard()); let settled = false; const pending = value.validatePlain(staged.bytes, guard()); pending.finally(() => settled = true).catch(() => {}); await tick(); await tick();
  assert.equal(settled, false); assert.equal(destroys(), 1); hold.resolve(); assert.equal((await pending).pages, 1); assert.deepEqual(bytes, before); await value.drained();
});
test('bad header/size, parser page disagreement and encrypted classification never commit a session', async () => {
  const source = await pdf(), { value } = intakeWith({ pages: 2 });
  await assert.rejects(value.read(file(new Uint8Array([1, 2, 3, 4, 5])), guard()), { code: 'invalid-pdf' });
  await assert.rejects(value.read({ ...file(source), size: 32 * 1024 * 1024 + 1 }, guard()), { code: 'input-limit' });
  await assert.rejects(value.validatePlain(source, guard()), { code: 'invalid-pdf' });
  const locked = intakeWith({ password: true }); await assert.rejects(locked.value.validatePlain(source, guard()), { code: 'requires-unlock' }); assert.equal(locked.destroys(), 1);
});
test('destroy failure is retained until an explicit cleanup retry and blocks another parser', async () => {
  const source = await pdf(), { value, loads, destroys } = intakeWith({ destroy: async number => { if (number === 1) throw new Error('private cleanup'); } });
  await assert.rejects(value.validatePlain(source, guard()), { code: 'cleanup-failed' });
  await assert.rejects(value.validatePlain(source, guard()), { code: 'cleanup-failed' }); assert.equal(loads(), 1); assert.equal(destroys(), 1);
  await value.drained({ retry: true }); assert.equal(destroys(), 2); assert.equal((await value.validatePlain(source, guard())).pages, 1);
});
test('noncancelable File read drains, drops queued B and reads only latest C before a clean successor', async () => {
  const hold = deferred(), began = deferred(), reads = []; let active = 0, maximum = 0;
  const queue = createProtectionFileQueue(async (descriptor, options) => { active++; maximum = Math.max(maximum, active); reads.push(descriptor); try { if (descriptor === 'A') { began.resolve(); await hold.promise; } protectionGuard(options); return descriptor; } finally { active--; } });
  const a = queue.replace('A', { isCurrent: () => true }); a.catch(() => {}); await began.promise;
  const b = queue.replace('B', { isCurrent: () => true }); b.catch(() => {}); const c = queue.replace('C', { isCurrent: () => true });
  await assert.rejects(b, { code: 'stale' }); assert.deepEqual(reads, ['A']); hold.resolve(); await assert.rejects(a, { code: 'canceled' }); assert.equal((await c).data, 'C'); await queue.drained();
  assert.deepEqual(reads, ['A', 'C']); assert.equal(maximum, 1); assert.equal((await queue.replace('successor', { isCurrent: () => true })).data, 'successor');
});
test('pending intake identity is local and unchanged empty/same-task canonical ownership fences completion', async () => {
  for (const populated of [false, true]) {
    const session = createDocumentSession(); if (populated) session.begin(new Uint8Array([1]), 'A.pdf');
    const expected = session.snapshot(), hold = deferred(), began = deferred(), local = localIntakeOwner(7);
    assert.ok(local.taskId.startsWith('intake:')); assert.notEqual(local.taskId, expected.taskId);
    const queue = createProtectionFileQueue(async (_, options) => { began.resolve(); await hold.promise; protectionGuard(options); return 'validated'; });
    const pending = queue.replace('private B', { isCurrent: () => sameProtectionOwner(expected, session.snapshot()) }); pending.catch(() => {}); await began.promise;
    if (populated) session.adopt(new Uint8Array([2]), 'newer.pdf'); else session.clear(); hold.resolve(); await assert.rejects(pending, { code: 'stale' });
    assert.equal(session.current()?.name || null, populated ? 'newer.pdf' : null);
  }
});
test('cancel never commits held input and awaited drain allows a positive successor', async () => {
  const hold = deferred(), start = deferred(); let reads = 0;
  const queue = createProtectionFileQueue(async (_, options) => { reads++; start.resolve(); if (reads === 1) await hold.promise; protectionGuard(options); return reads; });
  const pending = queue.replace({}, { isCurrent: () => true }); pending.catch(() => {}); await start.promise; queue.cancel(); let drained = false; const cleanup = queue.drained().then(() => drained = true); await tick(); assert.equal(drained, false);
  hold.resolve(); await assert.rejects(pending, { code: 'canceled' }); await cleanup; assert.equal((await queue.replace({}, { isCurrent: () => true })).data, 2);
});

function previewEnvironment(render, destroy = async () => {}) {
  const original = globalThis.document, canvases = [], host = { children: [], querySelectorAll() { return this.children; }, replaceChildren(...values) { for (const old of this.children) old.isConnected = false; this.children = values; for (const next of values) next.isConnected = true; } };
  globalThis.document = { createElement() { const canvas = { width: 0, height: 0, dataset: {}, isConnected: false, getContext: () => ({}), setAttribute() {} }; canvases.push(canvas); return canvas; } };
  let loads = 0, destroys = 0;
  const preview = createProtectionPreview({ host, ensurePdfJs: async () => ({ getDocument(options) { loads++; assert.equal(options.data.constructor, Uint8Array); return { promise: Promise.resolve({ numPages: 2, getPage: async () => ({ getViewport: ({ scale }) => ({ width: 320 * scale, height: 240 * scale }), render }) }), destroy: async () => { destroys++; await destroy(destroys); } }; } }) });
  return { preview, host, canvases, loads: () => loads, destroys: () => destroys, restore: () => { globalThis.document = original; } };
}
test('private preview bounds actual canvas and retains only the selected page', async () => {
  const env = previewEnvironment(() => ({ promise: Promise.resolve(), cancel() {} }));
  try { await env.preview.open({ bytes: new Uint8Array([1]), credential: 'synthetic-live', ...guard() }); assert.equal(env.host.children.length, 1); assert.ok(env.host.children[0].width <= 900); await env.preview.selectPage(2); assert.equal(env.host.children[0].dataset.pdfPage, '2'); assert.equal(env.canvases[0].width, 1); env.preview.pause(); await env.preview.drained(); assert.equal(env.host.children.length, 0); assert.equal(env.destroys(), 1); }
  finally { env.restore(); }
});
test('held render cancellation drains before a preview successor and stale canvas never paints', async () => {
  const renderHold = deferred(), began = deferred(); let renders = 0, canceled = 0;
  const env = previewEnvironment(() => { renders++; began.resolve(); return { promise: renders === 1 ? renderHold.promise : Promise.resolve(), cancel() { canceled++; } }; });
  try { const pending = env.preview.open({ bytes: new Uint8Array([1]), ...guard() }); pending.catch(() => {}); await began.promise; env.preview.pause(); const next = env.preview.open({ bytes: new Uint8Array([2]), ...guard() }); await tick(); assert.equal(env.loads(), 1); assert.equal(env.host.children.length, 0); renderHold.resolve(); await assert.rejects(pending); await next; assert.ok(canceled >= 1); assert.equal(env.loads(), 2); assert.equal(env.host.children.length, 1); env.preview.pause(); await env.preview.drained(); }
  finally { env.restore(); }
});
test('private preview destroy failure fences all new loads until explicit retry', async () => {
  const env = previewEnvironment(() => ({ promise: Promise.resolve(), cancel() {} }), async number => { if (number === 1) throw new Error('private destroy'); });
  try { await env.preview.open({ bytes: new Uint8Array([1]), ...guard() }); env.preview.pause(); await assert.rejects(env.preview.drained(), { code: 'cleanup-failed' }); await assert.rejects(env.preview.open({ bytes: new Uint8Array([2]), ...guard() }), { code: 'cleanup-failed' }); assert.equal(env.loads(), 1); await env.preview.drained({ retry: true }); await env.preview.open({ bytes: new Uint8Array([3]), ...guard() }); assert.equal(env.loads(), 2); env.preview.pause(); await env.preview.drained(); }
  finally { env.restore(); }
});
test('newest page request survives the superseded render cancellation and paints once', async () => {
  let calls = 0, rejectRender; const began = deferred();
  const env = previewEnvironment(() => { calls++; if (calls !== 2) return { promise: Promise.resolve(), cancel() {} }; began.resolve(); return { promise: new Promise((_, reject) => rejectRender = reject), cancel() { rejectRender(Object.assign(new Error('canceled render'), { name: 'RenderingCancelledException' })); } }; });
  try { await env.preview.open({ bytes: new Uint8Array([1]), ...guard() }); const second = env.preview.selectPage(2); await began.promise; await env.preview.selectPage(1); await second; assert.equal(env.host.children[0].dataset.pdfPage, '1'); assert.equal(calls, 3); env.preview.pause(); await env.preview.drained(); }
  finally { env.restore(); }
});
