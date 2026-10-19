import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createDocumentSession } from '../public/js/core/document-session.js';

const png = (tag = 0) => { const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')); return Uint8Array.from([...bytes, tag]); };
const pair = (id, tag = 0) => ({ id, original: { bytes: png(tag), name: `${id}.png`, type: 'image/png' }, asset: { bytes: png(tag), name: `${id}.png`, type: 'image/png', width: 1, height: 1 }, rotation: 0, fit: 'fit' });
const guards = (session) => { const { taskId: expectedTaskId, revision: expectedRevision } = session.snapshot(); return { expectedTaskId, expectedRevision }; };
const pdf = new TextEncoder().encode('%PDF-1.7\nchosen');

test('composition originals survive generic same-byte adoption, history pruning and owned transfer', async () => {
  const session = createDocumentSession(); await session.beginComposition([pair('first'), pair('second', 1)], guards(session));
  const id = session.snapshot().taskId, refs = session.compositionSources().originals.map((item) => item.originalRef);
  session.publishComposition(pdf, 'chosen.pdf', guards(session));
  const before = session.snapshot(); session.publishComposition(pdf, 'chosen.pdf', guards(session)); assert.deepEqual(session.snapshot(), before);
  session.adopt(pdf, 'same.pdf'); assert.equal(session.composition(), null); assert.equal(session.snapshot().taskId, id); assert.ok(session.historyTarget('undo').composition);
  for (let i = 0; i < 8; i++) session.adopt(Uint8Array.from([...pdf, i]), `boundary-${i}.pdf`);
  assert.equal(session.composition(), null); for (const ref of refs) assert.ok(session.resource(ref));
  const transfer = session.transfer(), restored = createDocumentSession(); restored.begin(transfer.current.bytes, transfer.current.name, { ...transfer, original: transfer.original });
  assert.deepEqual(restored.compositionSources(), session.compositionSources()); for (const ref of refs) assert.ok(restored.resource(ref));
  transfer.resources[0].bytes[0] = 0; assert.equal(session.resource(refs[0]).bytes[0], 137);
});

test('edits, selection and undo/redo preserve canonical state and normalized assets', async () => {
  const session = createDocumentSession(); await session.beginComposition([pair('first')], guards(session));
  await session.appendCompositionInputs([pair('second', 1)], guards(session));
  const before = session.composition(), revision = session.snapshot().revision;
  session.setCompositionSelection('first', guards(session)); assert.equal(session.snapshot().revision, revision);
  const next = session.composition(); next.items.reverse(); next.items[0].rotation = 90; next.paper = 'letter'; next.margin = 24;
  session.changeComposition(next, guards(session)); session.undo(); assert.deepEqual(session.composition().items, before.items); session.redo(); assert.deepEqual(session.composition(), next);
  const transfer = session.transfer(), restored = createDocumentSession(); restored.begin(transfer.current.bytes, transfer.current.name, transfer); assert.deepEqual(restored.composition(), next);
});

test('identical source bytes keep distinct item filenames while deduplicating immutable resources', async () => {
  const session = createDocumentSession(); await session.beginComposition([pair('first'),pair('second')],guards(session));
  assert.deepEqual(session.composition().items.map((item) => item.name),['first.png','second.png']); assert.equal(session.compositionSources().originals.length,1); assert.equal(new Set(session.composition().items.map((item) => item.assetId)).size,1);
  const next = session.composition(); next.items[0].name = 'x'.repeat(261); const before = session.transfer(); assert.throws(() => session.changeComposition(next,guards(session)),/image name/); assert.deepEqual(session.transfer(),before);
});

test('invalid references, dimensions and inherited state reject without changing the chosen task', async () => {
  const session = createDocumentSession(); await session.beginComposition([pair('first')], guards(session)); const before = session.transfer();
  const next = session.composition(); next.items[0].assetId = 'asset-missing'; assert.throws(() => session.changeComposition(next, guards(session)), /missing/);
  const invalid = pair('second'); invalid.asset.width = 2; await assert.rejects(session.appendCompositionInputs([invalid], guards(session)), /dimensions/);
  const inherited = session.transfer(); inherited.compositionSources.originals = []; assert.throws(() => session.begin(pdf, 'invalid.pdf', inherited), /48 original/);
  assert.deepEqual(session.transfer(), before);
});

test('chosen image bootstrap preserves original PDF/task/history; last removal is undoable', async () => {
  const session = createDocumentSession(); session.begin(pdf, 'original.pdf'); session.beginScene();
  session.adopt(png(), 'chosen.png', { type: 'image/png' }); const taskId = session.snapshot().taskId;
  await session.startCompositionFromCurrent(pair('chosen'), guards(session));
  assert.equal(session.snapshot().taskId, taskId); assert.deepEqual(session.original().bytes, pdf); assert.ok(session.historyTarget('undo'));
  const empty = session.composition(); empty.items = []; empty.selectedId = null; session.changeComposition(empty, guards(session));
  assert.equal(session.composition().items.length, 0); assert.equal(session.compositionSources().originals.length, 1); session.undo(); assert.equal(session.composition().items.length, 1);
  session.undo(); assert.equal(session.composition(), null); session.undo(); assert.deepEqual(session.current().bytes, pdf);
});

test('48 task-lifetime originals and shared resources include removed/history sources', async () => {
  const session = createDocumentSession(); await session.beginComposition(Array.from({ length: 48 }, (_, i) => pair(`image-${i}`, i)), guards(session));
  const next = session.composition(); next.items = [next.items[0]]; next.selectedId = next.items[0].id; session.changeComposition(next, guards(session)); const before = session.transfer();
  await assert.rejects(session.appendCompositionInputs([pair('extra', 100)], guards(session)), /48 original/); assert.deepEqual(session.transfer(), before);
  const smaller = createDocumentSession(); await smaller.beginComposition([pair('small')], guards(smaller));
  const inherited = smaller.transfer(); inherited.resources.push({ id: 'source-pdf', name: 'archived.pdf', type: 'application/pdf', bytes: new Uint8Array(80 * 1024 * 1024) });
  inherited.history = [{ name: 'archived.pdf', type: 'application/pdf', scene: { version: 1, sourceRef: 'source-pdf', objects: [], fields: {}, flatten: false } }];
  const restored = createDocumentSession(); restored.begin(inherited.current.bytes, inherited.current.name, inherited);
  const large = pair('large'); large.original.bytes = new Uint8Array(16 * 1024 * 1024); large.original.bytes.set(png()); large.asset.bytes = new Uint8Array(16 * 1024 * 1024); large.asset.bytes.set(png());
  const baseline = restored.transfer(); await assert.rejects(restored.appendCompositionInputs([large], guards(restored)), /96 MB/); assert.deepEqual(restored.transfer(), baseline);
});

test('held image hashing cannot repopulate a canceled or replaced task', async () => {
  const session = createDocumentSession(); await session.beginComposition([pair('first')], guards(session)); const before = session.transfer();
  const digest = crypto.subtle.digest.bind(crypto.subtle); let release, entered;
  const held = new Promise((resolve) => { entered = resolve; });
  crypto.subtle.digest = async (...args) => { entered(); await new Promise((resolve) => { release = resolve; }); return digest(...args); };
  try {
    const pending = session.appendCompositionInputs([pair('second', 1)], guards(session)); await held; session.invalidate(); release(); await assert.rejects(pending, /replaced|cancelled/);
    const after = session.transfer(); before.generation = after.generation; assert.deepEqual(after, before);
  } finally { crypto.subtle.digest = digest; }
});

test('opening a PDF scene rejects joint original-image plus PDF resources transactionally', async () => {
  const session = createDocumentSession(), pairs = [0,1,2].map((n) => { const value = pair(`large-${n}`, n); value.original.bytes = new Uint8Array(8 * 1024 * 1024); value.original.bytes.set(png(n)); return value; });
  await session.beginComposition(pairs, guards(session));
  const current = new Uint8Array(75 * 1024 * 1024); current.set(pdf);
  session.publishComposition(current, 'large.pdf', guards(session)); session.adopt(current, 'chosen-large.pdf');
  for (let i = 0; i < 6; i++) session.adopt(Uint8Array.from([...pdf, i]), `small-${i}.pdf`);
  session.adopt(current, 'large-current.pdf');
  assert.equal(session.snapshot().originalImageCount, 3); const before = session.transfer();
  assert.throws(() => session.beginScene(), /96 MB/); assert.deepEqual(session.transfer(), before);
});

test('core stops before later pairs once incremental unique resource admission fails', async () => {
  const session = createDocumentSession(); session.begin(pdf, 'retained.pdf'); const before = session.transfer(); let laterRead = false;
  const pairs = Array.from({ length: 4 }, (_, n) => { const value = pair(`large-${n}`, n); value.original.bytes = new Uint8Array(16 * 1024 * 1024); value.original.bytes.set(png(n)); return value; });
  pairs.push({ id: 'unread', get original() { laterRead = true; throw new Error('Later image must not be read'); } });
  await assert.rejects(session.beginComposition(pairs, guards(session)), /48 original\/48 MB/);
  assert.equal(laterRead, false); assert.deepEqual(session.transfer(), before);
});

test('valid 75 MiB PDF scene source aliases across five inherited history entries before validation', async () => {
  const doc = await PDFDocument.create(); doc.addPage([100,100]); doc.catalog.set(PDFName.of('PortablePadding'),doc.context.register(doc.context.stream(new Uint8Array(75 * 1024 * 1024))));
  const bytes = await doc.save({ useObjectStreams: false }); assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
  const session = createDocumentSession(); session.begin(bytes,'large-valid.pdf'); session.beginScene();
  for (let index = 0; index < 6; index++) { const state = session.scene(); state.flatten = !state.flatten; session.changeScene(state); }
  session.publishScene(bytes,'reviewed-valid.pdf'); const transfer = session.transfer(), restored = createDocumentSession();
  restored.begin(transfer.current.bytes,transfer.current.name,transfer);
  assert.equal(restored.snapshot().resourceBytes,session.snapshot().resourceBytes); assert.equal(restored.snapshot().retainedBytes,session.snapshot().retainedBytes); assert.equal(restored.transfer().history.length,5);
  const fingerprint = (value) => JSON.stringify(value,(_key,item) => item instanceof Uint8Array ? { size:item.length,sha:createHash('sha256').update(item).digest('hex') } : item);
  const content = ({ current,original,scene,history,resources }) => ({ current,original,scene,history,resources });
  assert.equal(fingerprint(content(restored.transfer())),fingerprint(content(transfer)));
});
