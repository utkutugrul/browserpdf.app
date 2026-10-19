import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfLib from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { composeImagesPdf, compositionPageLayout } from '../public/js/core/image-composition.js';
import { createImageIntake, IMAGE_INTAKE_LIMITS } from '../public/js/core/image-intake.js';
import * as sessionCore from '../public/js/core/document-session.js';
import { stashForChain } from '../public/js/document-handoff.js';

const item = (id, width = 40, height = 20) => ({ id, originalRef: `source-${id}`, assetId: `asset-${id}`, width, height, rotation: 0, fit: 'fit' });
const state = (items = [item('one')], extra = {}) => ({ version: 1, items, paper: 'image', orientation: 'portrait', margin: 0, selectedId: items[0]?.id || null, ...extra });
function png(color = 'red', alpha = false) { const canvas = createCanvas(40, 20), ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 20, 20); ctx.fillStyle = alpha ? 'rgba(0,0,255,0.5)' : 'blue'; ctx.fillRect(20, 0, 20, 20); return new Uint8Array(canvas.toBuffer('image/png')); }
function images(doc, index) { const resources = doc.getPage(index).node.Resources().lookup(pdfLib.PDFName.of('XObject')); return [...resources.entries()].map(([, ref]) => doc.context.lookup(ref)); }
const decode = (stream) => pdfLib.decodePDFRawStream(stream).decode();

test('saved image PDF keeps ordered RGB, alpha, exact paper/clip/rotation and immutable input', async () => {
  const red = png('red', true), green = png('lime'), before = red.slice(), inputs = new Map([['asset-one', red], ['asset-two', green]]);
  const composition = state([item('two'), { ...item('one'), rotation: 90, fit: 'fill' }], { paper: 'letter', orientation: 'landscape', margin: 36 });
  const result = await composeImagesPdf(composition, { pdfLib, resource: (id) => ({ type: 'image/png', bytes: inputs.get(id) }) });
  const saved = await pdfLib.PDFDocument.load(result.bytes); assert.equal(saved.getPageCount(), 2);
  assert.deepEqual(saved.getPages().map((page) => page.getSize()), [{ width: 792, height: 612 }, { width: 792, height: 612 }]);
  const first = images(saved, 0)[0], second = images(saved, 1)[0];
  assert.deepEqual([...decode(first).subarray(0, 3)], [0, 255, 0]); assert.deepEqual([...decode(second).subarray(0, 3)], [255, 0, 0]);
  const alpha = saved.context.lookup(second.dict.get(pdfLib.PDFName.of('SMask'))); assert.ok(alpha); assert.equal(decode(alpha)[0], 255); assert.ok(Math.abs(decode(alpha)[39] - 128) <= 1);
  const operators = saved.getPage(1).node.Contents(); const content = Array.from({ length: operators.size() }, (_, i) => new TextDecoder().decode(decode(saved.context.lookup(operators.get(i))))).join('\n');
  assert.match(content, /36 36 720 540 re\nW\nn/);
  const matrices = content.split('\n').filter((line) => line.endsWith(' cm')).map((line) => line.split(' ').slice(0, 6).map(Number));
  assert.ok(matrices.some((matrix) => matrix.every((n, i) => Math.abs(n - [0, -1, 1, 0, 0, 0][i]) < 1e-12)));
  assert.deepEqual(red, before); assert.deepEqual(result.capabilities, { encrypted: false, searchable: false, forms: false, rasterized: true });
});

test('Image paper preserves 842-point sizing, repeated export is identical, and unique decoded pixels are bounded', async () => {
  for (const rotation of [0, 90, 180, 270]) { const layout = compositionPageLayout(state(), { ...item('one'), rotation }); assert.equal(Math.max(layout.pageWidth, layout.pageHeight), 842); assert.equal(Math.min(layout.pageWidth, layout.pageHeight), 421); }
  const bytes = png(), options = { pdfLib, resource: () => ({ bytes, type: 'image/png' }) };
  assert.deepEqual((await composeImagesPdf(state(), options)).bytes, (await composeImagesPdf(state(), options)).bytes);
  let created = 0;
  await assert.rejects(composeImagesPdf(state(Array.from({ length: 4 }, (_, i) => item(String(i), 4000, 4000))), { ...options, pdfLib: { PDFDocument: { create: () => { created++; } } } }), /48 million/); assert.equal(created, 0);
  const repeated = await composeImagesPdf(state([item('one'), { ...item('copy'), assetId: 'asset-one' }]), options), doc = await pdfLib.PDFDocument.load(repeated.bytes);
  assert.equal(doc.getPageCount(), 2); assert.equal(images(doc, 0)[0], images(doc, 1)[0]);
  const controller = new AbortController(); controller.abort(); await assert.rejects(composeImagesPdf(state(), { ...options, signal: controller.signal }), { name: 'AbortError' });
});

test('fit/fill respect margin area and invalid narrow Image margins fail visibly', () => {
  const fit = compositionPageLayout(state([item('one')], { paper: 'letter', margin: 36 }), item('one'));
  const fill = compositionPageLayout(state([item('one')], { paper: 'letter', margin: 36 }), { ...item('one'), fit: 'fill' });
  assert.equal(fit.display.width, 540); assert.equal(fill.display.height, 720); assert.ok(fill.display.width > fill.clip.width);
  assert.throws(() => compositionPageLayout(state([], { margin: 72 }), item('narrow', 1, 4096)), /no image area/);
});

test('cancelled noncancelable normalization retains reservation, drains, and never accepts stale bytes', async () => {
  let release, started = 0; const accepted = [], errors = [];
  const usage = () => ({ entries: accepted.length, originals: accepted.length, rawBytes: accepted.length, normalizedBytes: accepted.length });
  const intake = createImageIntake({ usage, normalize: async () => { started++; if (started === 1) await new Promise((resolve) => { release = resolve; }); return { bytes: new Uint8Array([1]), type: 'image/png' }; }, accept: async (file) => { accepted.push(file.name); }, onError: (error) => errors.push(error) });
  intake.enqueue([{ name: 'old.png', size: 1, type: 'image/png' }]); await new Promise(setImmediate); assert.equal(started, 1);
  intake.cancel(); assert.equal(intake.state().pending, 1); assert.equal(intake.state().rawReserved, 1);
  intake.enqueue([{ name: 'fresh.png', size: 1, type: 'image/png' }]); await new Promise(setImmediate); assert.equal(started, 1);
  release(); await intake.drained(); assert.deepEqual(accepted, ['fresh.png']); assert.equal(started, 2); assert.equal(intake.state().pending, 0); assert.equal(errors.length, 0);
});

test('intake rejects queued-count and task-lifetime raw bounds without touching accepted state', async () => {
  let release; const errors = [], accepted = [];
  const intake = createImageIntake({ usage: () => ({ entries: 0, originals: 47, rawBytes: 0, normalizedBytes: 0 }), normalize: async () => { await new Promise((resolve) => { release = resolve; }); return { bytes: new Uint8Array([1]) }; }, accept: async (file) => accepted.push(file.name), onError: (error) => errors.push(error.message) });
  intake.enqueue([{ name: 'last.png', type: 'image/png', size: 1 }, { name: 'over.png', type: 'image/png', size: 1 }]); await new Promise(setImmediate); assert.equal(intake.state().pending, 1); assert.equal(errors.length, 1); assert.match(errors[0], /retains at most 48/); release(); await intake.drained(); assert.deepEqual(accepted, ['last.png']);
  assert.equal(IMAGE_INTAKE_LIMITS.normalizationLivePixels, 48_000_000);
});

test('pending reservations stop at16 and48MiB even while a native job cannot be cancelled', async () => {
  let release; const errors = [];
  const intake = createImageIntake({ usage: () => ({ entries: 0, originals: 0, rawBytes: 0, normalizedBytes: 0 }), normalize: () => new Promise((resolve) => { release = () => resolve({ bytes: new Uint8Array([1]) }); }), accept: () => assert.fail('cancelled work must not be accepted'), onError: (error) => errors.push(error.message) });
  intake.enqueue(Array.from({ length: 17 }, (_, i) => ({ name: `${i}.png`, type: 'image/png', size: 1 }))); assert.equal(intake.state().pending, 16); assert.match(errors[0], /16 images/); await new Promise(setImmediate); intake.cancel(); assert.equal(intake.state().pending, 1); release(); await intake.drained(); assert.equal(intake.state().pending, 0);
  const rawErrors = [], raw = createImageIntake({ usage: () => ({ entries: 0, originals: 0, rawBytes: 0, normalizedBytes: 0 }), normalize: () => new Promise((resolve) => { release = () => resolve({ bytes: new Uint8Array([1]) }); }), accept: () => assert.fail(), onError: (error) => rawErrors.push(error.message) });
  raw.enqueue(Array.from({ length: 4 }, (_, i) => ({ name: `${i}.png`, type: 'image/png', size: 16 * 1024 * 1024 }))); assert.equal(raw.state().rawReserved, 48 * 1024 * 1024); assert.match(rawErrors[0], /48 MiB/); await new Promise(setImmediate); raw.cancel(); release(); await raw.drained();
});

test('forged normalized dimensions reject before any PDF document or decoded channels are allocated', async () => {
  const encoded = png(); new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).setUint32(16, 4000); let created = 0;
  await assert.rejects(composeImagesPdf(state(), { pdfLib: { PDFDocument: { create: () => { created++; } } }, resource: () => ({ bytes: encoded, type: 'image/png' }) }), /header does not match/); assert.equal(created, 0);
});

test('verified post-adoption owner survives storage retry but never a later same-task edit or serialized callback', async () => {
  const source = await pdfLib.PDFDocument.create(); source.addPage([40,20]); const sourceBytes = await source.save(), imageBytes = png();
  const documentSession = sessionCore.createDocumentSession(); documentSession.begin(sourceBytes,'original.pdf');
  let owner = documentSession.snapshot(), notifications = 0, writes = 0, stored;
  const operation = { isCurrent: () => { const now = documentSession.snapshot(); return now.taskId === owner.taskId && now.revision === owner.revision && now.generation === owner.generation; } };
  const options = { type:'image/png', operation, onAdoptionOwner(next) { assert.deepEqual(Object.keys(next).sort(),['generation','revision','taskId']); owner = next; notifications++; } };
  const env = { documentSession, ensureDocumentSession:async () => {}, getSessionCore:() => sessionCore,
    loadWorkflowStore:async () => ({ cleanupExpired:async () => {}, putWorkflowBundle:async (workflow,files) => { if (++writes === 1) throw new Error('post-adoption quota'); stored = {workflow,files}; } }) };
  await assert.rejects(stashForChain(imageBytes,'chosen.png','jpg-to-pdf',options,env),/post-adoption quota/);
  assert.equal(notifications,1); assert.equal(operation.isCurrent(),true); assert.equal(documentSession.current().type,'image/png'); assert.deepEqual(documentSession.current().bytes,imageBytes); assert.deepEqual(documentSession.original().bytes,new Uint8Array(sourceBytes));
  const handoff = await stashForChain(imageBytes,'chosen.png','jpg-to-pdf',options,env); assert.equal(handoff.isCurrent(),true); assert.equal(notifications,2);
  assert.equal(Object.hasOwn(stored.workflow,'onAdoptionOwner'),false); assert.equal(stored.files.some((file) => Object.hasOwn(file,'onAdoptionOwner')),false); assert.equal(JSON.stringify(stored).includes('onAdoptionOwner'),false);
  const edited = await pdfLib.PDFDocument.create(); edited.addPage([80,40]); documentSession.adopt(await edited.save(),'newer.pdf'); const expected = documentSession.transfer();
  await assert.rejects(stashForChain(imageBytes,'chosen.png','jpg-to-pdf',options,env),{name:'AbortError'}); assert.equal(writes,2); assert.equal(notifications,2); assert.deepEqual(documentSession.transfer(),expected);
  const copied = await stashForChain(imageBytes,'chosen-again.png','jpg-to-pdf',{type:'image/png',onAdoptionOwner(next) { next.taskId = 'mutated-observer-copy'; next.revision = -1; next.generation = -1; }},env);
  assert.equal(copied.isCurrent(),true); assert.equal(documentSession.snapshot().taskId,expected.taskId); assert.notEqual(documentSession.snapshot().revision,-1);
});
