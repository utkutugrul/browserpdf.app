import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedText, findTextMatches, foldSearchText, resolveDestination, createTextCache } from '../public/js/core/reader-text.js';
import { createDocumentSession } from '../public/js/core/document-session.js';

const item = (str, hasEOL = false) => ({ str, hasEOL, width: 100, height: 12, transform: [12,0,0,12,10,100], fontName: 'font', dir: 'ltr' });
const page = (items, hooks = {}) => ({ streamTextContent() { return new ReadableStream({ start(controller) { controller.enqueue({ items, styles: { font: { fontFamily: 'sans-serif' } } }); if (!hooks.hold) controller.close(); }, cancel() { hooks.cancelled = true; } }); } });

test('Turkish dotted I, decomposed accents and cross-span matches retain original offsets', async () => {
  const model = await readBoundedText(page([item('İstan'), item('bul cafe\u0301'), item(' Café', true), item('tail')]));
  const [istanbul] = findTextMatches(model, 'istanbul');
  assert.equal(model.raw.slice(istanbul.start, istanbul.end), 'İstanbul');
  assert.deepEqual(istanbul.ranges, [{ index: 0, start: 0, end: 5 }, { index: 1, start: 0, end: 3 }]);
  const accents = findTextMatches(model, 'cafe');
  assert.deepEqual(accents.map((match) => model.raw.slice(match.start, match.end)), ['cafe\u0301', 'Café']);
  assert.equal(findTextMatches(model, 'cafe tail').length, 1);
  const surrogate = foldSearchText('😀 Café'); assert.equal(surrogate.starts.length, surrogate.text.length);
});
test('text budget is enforced before TextLayer DOM and cancels the source stream', async () => {
  const hooks = { hold: true };
  await assert.rejects(readBoundedText(page([item('too long')], hooks), { limits: { runs: 1, characters: 2, styles: 1 } }), /text limit/);
  assert.equal(hooks.cancelled, true);
});
test('abort cancels an outstanding text stream rather than only ignoring results', async () => {
  const controller = new AbortController(), hooks = { hold: true };
  const result = readBoundedText(page([], hooks), { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 0)); controller.abort();
  await assert.rejects(result, /abort/i); assert.equal(hooks.cancelled, true);
});
test('destinations validate integer page indices and named/ref targets', async () => {
  const pdf = { numPages: 3, getDestination: async () => [{ num: 10, gen: 0 }, { name: 'Fit' }], getPageIndex: async () => 2 };
  assert.equal(await resolveDestination(pdf, 'last'), 2); assert.equal(await resolveDestination(pdf, [1]), 1);
  assert.equal(await resolveDestination(pdf, [1.5]), null); assert.equal(await resolveDestination(pdf, [-1]), null); assert.equal(await resolveDestination(pdf, [3]), null);
});
test('cache evicts pages and retained text; match list is bounded', async () => {
  const cache = createTextCache(); for (let i = 0; i < 5; i++) cache.put(i, { characters: 400000 });
  assert.equal(cache.get(0), undefined); assert.equal(cache.get(1), undefined); assert.ok(cache.get(4)); cache.clear(); assert.equal(cache.get(4), undefined);
  const model = await readBoundedText(page([item('hit '.repeat(250))])); assert.equal(findTextMatches(model, 'hit').length, 200);
});
test('invalid inherited scene sources and image resources leave the entire chosen task unchanged', () => {
  const session = createDocumentSession(), bytes = new TextEncoder().encode('%PDF-1.7\nowned'); session.begin(bytes, 'current.pdf'); session.beginScene();
  const before = session.transfer(), scene = { version: 1, sourceRef: 'source-invalid', objects: [], fields: {}, flatten: false };
  assert.throws(() => session.begin(bytes, 'replacement.pdf', { taskId: 'replacement', scene, resources: [{ id: scene.sourceRef, name: 'too-large.pdf', type: 'application/pdf', bytes: new Uint8Array(80 * 1024 * 1024 + 1) }] }), /80 MB/);
  assert.deepEqual(session.transfer(), before);
  scene.objects.push({ id: 'image', kind: 'image', pageIndex: 0, x: 0, y: 0, width: 10, height: 10, assetId: 'asset-invalid' });
  assert.throws(() => session.begin(bytes, 'replacement.pdf', { scene, resources: [{ id: scene.sourceRef, name: 'source.pdf', type: 'application/pdf', bytes }, { id: 'asset-invalid', name: 'wrong.pdf', type: 'application/pdf', bytes }] }), /image resource/);
  assert.deepEqual(session.transfer(), before);
});
