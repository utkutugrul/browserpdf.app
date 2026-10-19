import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as lib from 'pdf-lib';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { METADATA_FIELDS, METADATA_LIMITS, inspectPdfMetadata, applyPdfMetadata, validateMetadataChange, createMetadataWorkQueue, createMetadataPreview } from '../public/js/core/metadata-editor.js';
import { createDocumentSession, BOUNDARY_LOSSES } from '../public/js/core/document-session.js';
globalThis.DOMMatrix = DOMMatrix; globalThis.ImageData = ImageData; globalThis.Path2D = Path2D;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const assets = { standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname };
const output = process.env.BROWSERPDF_METADATA_ARTIFACT_DIR || await mkdtemp(join(tmpdir(), 'browserpdf-metadata-unit-'));
await mkdir(output, { recursive: true });
const artifacts = [];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const request = patch => ({ version: 1, mode: 'edit', patch });
const time = () => new Date('2026-10-19T12:34:56Z');
const options = { pdfLib: lib, now: time };
const N = lib.PDFName.of;
const info = doc => doc.context.lookup(doc.context.trailerInfo.Info, lib.PDFDict);
const raw = (doc, key) => info(doc)?.lookup(N(key))?.toString();
async function save(name, bytes) { await writeFile(join(output, name), bytes); artifacts.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
async function fixture() {
  const doc = await lib.PDFDocument.create({ updateMetadata: false }), font = await doc.embedFont(lib.StandardFonts.Helvetica);
  for (const [index, rotation] of [0, 90, 180, 270].entries()) {
    const page = doc.addPage([400, 320]); page.setCropBox(20, 30, 320, 240); page.setRotation(lib.degrees(rotation)); page.node.set(N('UserUnit'), lib.PDFNumber.of(index % 2 + 1));
    page.drawText(`METADATA PAGE ${index + 1}`, { x: 35, y: 225, size: 12, font }); page.drawRectangle({ x: 80, y: 100, width: 45, height: 60, color: lib.rgb(0.2, 0.7, 0.4) });
  }
  doc.setTitle('Original İstanbul 🙂'); doc.setAuthor('  author  '); doc.setSubject('Subject'); doc.setKeywords(['literal,comma,,keywords']); doc.setCreator('Creator'); doc.setProducer('P'.repeat(4100));
  doc.setCreationDate(new Date('2001-02-03T04:05:06Z')); doc.setModificationDate(new Date('2002-03-04T05:06:07Z'));
  info(doc).set(N('Company'), lib.PDFHexString.fromText('KEEP CUSTOM INFO'));
  doc.catalog.set(N('Metadata'), doc.context.register(doc.context.flateStream(new TextEncoder().encode('<x:xmpmeta xmlns:x="adobe:ns:meta/">KEEP XMP PAYLOAD İstanbul</x:xmpmeta>'), { Type: 'Metadata', Subtype: 'XML' })));
  const form = doc.getForm(), field = form.createTextField('KEEP-FIELD'); field.setText('KEEP FORM VALUE'); field.addToPage(doc.getPage(0), { x: 40, y: 60, width: 160, height: 30 }); form.updateFieldAppearances();
  doc.getPage(1).node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 90, 200, 110], A: { Type: 'Action', S: 'URI', URI: lib.PDFString.of('https://example.invalid/keep?literal=1') } })));
  await doc.attach(new TextEncoder().encode('KEEP ATTACHMENT PAYLOAD İstanbul'), 'keep.txt', { mimeType: 'text/plain' });
  return new Uint8Array(await doc.save({ updateFieldAppearances: false }));
}
async function reopened(bytes) { return lib.PDFDocument.load(bytes.slice(), { updateMetadata: false, throwOnInvalidObject: true }); }
function graph(doc) {
  const decode = value => Buffer.from(lib.decodePDFRawStream(value).decode()).toString('hex');
  const embedded = doc.catalog.lookup(N('Names'), lib.PDFDict).lookup(N('EmbeddedFiles'), lib.PDFDict).lookup(N('Names'), lib.PDFArray).lookup(1, lib.PDFDict);
  const file = embedded.lookup(N('EF'), lib.PDFDict).lookup(N('F'), lib.PDFRawStream);
  return { xmp: decode(doc.catalog.lookup(N('Metadata'), lib.PDFRawStream)), attachment: decode(file), mime: file.dict.lookup(N('Subtype')).toString(), filename: embedded.lookup(N('UF')).decodeText(), form: doc.getForm().getTextField('KEEP-FIELD').getText(), customInfo: raw(doc, 'Company'), pages: doc.getPages().map(page => ({ media: page.getMediaBox(), crop: page.getCropBox(), rotate: page.getRotation().angle, unit: page.node.get(N('UserUnit')).toString(), annotations: (page.node.Annots()?.asArray() || []).map(ref => doc.context.lookup(ref).toString()) })) };
}

test('absent Info inspection neither invents default fields nor mutates the input', async () => {
  const doc = await lib.PDFDocument.create({ updateMetadata: false }); doc.addPage(); const bytes = new Uint8Array(await doc.save()), before = bytes.slice();
  const model = await inspectPdfMetadata(bytes, { pdfLib: lib }); assert.equal(Object.keys(model.fields).length, 8); assert.ok(Object.values(model.fields).every(cell => cell.status === 'absent')); assert.deepEqual(bytes, before); assert.equal((await reopened(bytes)).context.trailerInfo.Info, undefined);
});
test('six dirty values roundtrip exact Unicode, commas, tabs, CR and whitespace as real UTF-16 Info', async () => {
  const source = await fixture(), patch = Object.fromEntries(METADATA_FIELDS.map((key, i) => [key, `  ${i} İstanbul,α,,中文,🙂\tline\r\nnext  `]));
  const result = await applyPdfMetadata(source, request(patch), options), doc = await reopened(result.bytes);
  for (const key of METADATA_FIELDS) { assert.equal(result.after.fields[key].value, patch[key]); assert.ok(info(doc).lookup(N(key[0].toUpperCase() + key.slice(1))) instanceof lib.PDFHexString); }
  assert.deepEqual(result.changedFields, [...METADATA_FIELDS, 'modificationDate']); await save('literal-six-fields.pdf', result.bytes);
});
test('dirty-only editing preserves a 4100-unit Producer and raw dates and leaves present-empty distinct from absent', async () => {
  const source = await fixture(), before = await reopened(source), result = await applyPdfMetadata(source, request({ title: '' }), options), after = await reopened(result.bytes);
  assert.equal(result.before.fields.producer.status, 'oversized'); assert.ok(result.before.fields.producer.value.length <= 4096); assert.equal(raw(after, 'Producer'), raw(before, 'Producer')); assert.equal(raw(after, 'CreationDate'), raw(before, 'CreationDate')); assert.equal(raw(after, 'Author'), raw(before, 'Author')); assert.equal(after.getModificationDate().toISOString(), time().toISOString()); assert.equal(result.after.fields.title.status, 'value'); assert.equal(result.after.fields.title.value, ''); assert.equal(result.after.fields.producer.length, 4100); await save('dirty-title-blank.pdf', result.bytes);
});
test('exact 4096-unit fields and 24576-unit aggregate succeed; malformed and oversized edits reject before loading', async () => {
  const source = await fixture(), patch = Object.fromEntries(METADATA_FIELDS.map(key => [key, 'İ'.repeat(4096)])); assert.equal(Object.values(patch).reduce((n, v) => n + v.length, 0), 24576);
  const result = await applyPdfMetadata(source, request(patch), options); assert.ok(METADATA_FIELDS.every(key => result.after.fields[key].value === patch[key]));
  for (const change of [request({ title: 'a'.repeat(4097) }), request({ arbitrary: 'secret' }), request({ title: '\ud800' }), { ...request({ title: 'x' }), password: 'secret' }, { version: 1, mode: 'clear-standard', patch: { title: 'x' } }, { version: 2, mode: 'edit', patch: {} }]) assert.throws(() => validateMetadataChange(change));
  let loads = 0; await assert.rejects(applyPdfMetadata(source, request({ title: 'x'.repeat(4097) }), { pdfLib: { ...lib, PDFDocument: { load() { loads++; } } } }), { code: 'metadata-field-limit' }); assert.equal(loads, 0);
});
test('unchanged patch is rejected without advancing ModDate or modifying input', async () => {
  const source = await fixture(), before = source.slice(); await assert.rejects(applyPdfMetadata(source, request({ title: 'Original İstanbul 🙂' }), options), { code: 'metadata-no-change' }); assert.deepEqual(source, before); await assert.rejects(applyPdfMetadata(source, request({}), options), { code: 'metadata-no-change' });
});
test('malformed dates and non-text Info remain explicit and untouched by another field edit', async () => {
  const doc = await reopened(await fixture()); info(doc).set(N('CreationDate'), lib.PDFString.of('not-a-date')); info(doc).set(N('Subject'), lib.PDFNumber.of(123)); info(doc).set(N('Creator'), lib.PDFHexString.fromText('keep\rcarriage'));
  const source = await doc.save({ updateFieldAppearances: false }), model = await inspectPdfMetadata(source, { pdfLib: lib }); assert.equal(model.fields.creationDate.status, 'unreadable'); assert.equal(model.fields.subject.status, 'unreadable'); assert.equal(model.fields.creator.replaceRequired, true);
  const after = await reopened((await applyPdfMetadata(source, request({ author: 'new author' }), options)).bytes); for (const key of ['CreationDate', 'Subject', 'Creator']) assert.equal(raw(after, key), raw(doc, key));
});
test('eight-key cleanup removes all standard entries and preserves actual XMP, form/AP, URI, attachment payload/MIME and geometry', async () => {
  const source = await fixture(), before = await reopened(source), result = await applyPdfMetadata(source, { version: 1, mode: 'clear-standard', patch: {} }, options), after = await reopened(result.bytes);
  assert.ok(Object.values(result.after.fields).every(cell => cell.status === 'absent')); assert.equal(result.changedFields.length, 8); assert.deepEqual(graph(after), graph(before)); await save('rich-source.pdf', source); await save('rich-info-cleared.pdf', result.bytes);
});
test('ordinary edit preserves the rich graph and independently rendered pixels on four rotated cropped pages', async () => {
  const source = await fixture(), result = await applyPdfMetadata(source, request({ title: 'NEW TITLE' }), options); assert.deepEqual(graph(await reopened(result.bytes)), graph(await reopened(source)));
  for (let index = 0; index < 4; index++) {
    const a = createCanvas(1, 1), b = createCanvas(1, 1); a.dataset = {}; b.dataset = {};
    const first = createMetadataPreview({ canvas: a, ensurePdfJs: async () => pdfjs, pdfjsAssets: assets }), second = createMetadataPreview({ canvas: b, ensurePdfJs: async () => pdfjs, pdfjsAssets: assets });
    await first.open(source, { pageIndex: index }); await second.open(result.bytes, { pageIndex: index }); assert.deepEqual([a.width, a.height, a.dataset.pdfPage], [b.width, b.height, b.dataset.pdfPage]); assert.deepEqual(a.getContext('2d').getImageData(0, 0, a.width, a.height).data, b.getContext('2d').getImageData(0, 0, b.width, b.height).data); await save(`page-${index + 1}-result.png`, b.toBuffer('image/png')); first.clear(); second.clear();
  }
  await save('rich-edited.pdf', result.bytes);
});
test('input and page bounds fail before publishing an output', async () => {
  await assert.rejects(inspectPdfMetadata(new Uint8Array(METADATA_LIMITS.inputBytes + 1), { pdfLib: lib }), { code: 'metadata-input-limit' });
  const doc = await lib.PDFDocument.create({ updateMetadata: false }); for (let i = 0; i < 1001; i++) doc.addPage([10, 10]); await assert.rejects(inspectPdfMetadata(await doc.save(), { pdfLib: lib }), { code: 'metadata-page-limit' });
  const canceled = new AbortController(); canceled.abort(); await assert.rejects(inspectPdfMetadata(await fixture(), { pdfLib: lib, signal: canceled.signal }), { name: 'AbortError' });
});
for (const phase of ['file-read', 'load', 'save']) test(`real ${phase} promise drains before latest C; unread B never starts`, async () => {
  const bytes = await fixture(), held = deferred(), began = deferred(), events = []; let first = true;
  const injected = { ...lib, PDFDocument: { async load(...args) { const doc = await lib.PDFDocument.load(...args); if (phase === 'load' && first) { first = false; began.resolve(); await held.promise; } if (phase === 'save' && first) { const save = doc.save.bind(doc); doc.save = async (...saveArgs) => { const saved = await save(...saveArgs); first = false; began.resolve(); await held.promise; return saved; }; } return doc; } } };
  const queue = createMetadataWorkQueue(async (name, operation) => { events.push(name); if (name === 'A' && phase === 'file-read') { began.resolve(); await held.promise; operation.assertCurrent(); } return phase === 'save' ? applyPdfMetadata(bytes, request({ title: name }), { pdfLib: injected, signal: operation.signal, now: time }) : inspectPdfMetadata(bytes, { pdfLib: injected, signal: operation.signal }); });
  const a = queue.replace('A'); a.catch(() => {}); await began.promise; const b = queue.replace('B'); b.catch(() => {}); const c = queue.replace('C'); await assert.rejects(b, { name: 'AbortError' }); await tick(); assert.deepEqual(events, ['A']); let drained = false; const drain = queue.drained().then(() => { drained = true; }); await tick(); assert.equal(drained, false); held.resolve(); await assert.rejects(a, { name: 'AbortError' }); await c; await drain; assert.deepEqual(events, ['A', 'C']);
});
function previewEnvironment({ destroy, render, width = 9000, height = 1 } = {}) {
  let loads = 0, destroys = 0, cancels = 0;
  const canvas = { width: 0, height: 0, dataset: {}, getContext: () => ({}) };
  const preview = createMetadataPreview({ canvas, ensurePdfJs: async () => ({ getDocument() { loads++; return { promise: Promise.resolve({ numPages: 3, getPage: async () => ({ getViewport: ({ scale }) => ({ width: width * scale, height: height * scale }), render: () => ({ promise: render ? render() : Promise.resolve(), cancel() { cancels++; } }) }) }), async destroy() { destroys++; await destroy?.(destroys); } }; } }) });
  return { preview, canvas, loads: () => loads, destroys: () => destroys, cancels: () => cancels };
}
test('extreme-aspect selected-page preview bounds both dimensions and pixels and clears its canvas', async () => {
  const env = previewEnvironment(); await env.preview.open(new Uint8Array([1]), { pageIndex: 2 }); assert.equal(env.canvas.dataset.pdfPage, '3'); assert.ok(env.canvas.width <= 900); assert.ok(env.canvas.height <= 900); assert.ok(env.canvas.width * env.canvas.height <= 4000000); assert.equal(env.destroys(), 1); env.preview.clear(); assert.equal(env.canvas.width, 0);
});
test('held render and actual cleanup promises drain before successor and a failed destruction fences new loads until retry', async () => {
  const renderHold = deferred(), destroyHold = deferred(), renderBegan = deferred(), destroyBegan = deferred(); let renders = 0;
  const env = previewEnvironment({ render() { if (++renders === 1) { renderBegan.resolve(); return renderHold.promise; } }, async destroy(count) { if (count === 1) { destroyBegan.resolve(); await destroyHold.promise; } } });
  const queue = createMetadataWorkQueue((_, operation) => env.preview.open(new Uint8Array([1]), { signal: operation.signal }));
  const a = queue.replace('A'); a.catch(() => {}); await renderBegan.promise; const b = queue.replace('B'); await destroyBegan.promise; await tick(); assert.equal(env.loads(), 1); renderHold.resolve(); await tick(); assert.equal(env.loads(), 1); destroyHold.resolve(); await assert.rejects(a, { name: 'AbortError' }); await b; await queue.drained(); assert.ok(env.cancels() > 0); assert.equal(env.loads(), 2);
  const failed = previewEnvironment({ destroy: async count => { if (count === 1) throw new Error('synthetic cleanup failure'); } }); await assert.rejects(failed.preview.open(new Uint8Array([1])), { code: 'metadata-cleanup' }); await assert.rejects(failed.preview.open(new Uint8Array([2])), { code: 'metadata-cleanup' }); assert.equal(failed.loads(), 1); await failed.preview.drained({ retry: true }); await failed.preview.open(new Uint8Array([3])); assert.equal(failed.loads(), 2);
});
async function until(check) { for (let i = 0; i < 300; i++) { if (check()) return; await tick(); } throw new Error('The route did not reach its expected state.'); }
async function routeHarness() {
  // Executes the actual entry body with injected public seams and a tiny DOM.
  // This is protocol/ownership evidence; native layout belongs to Playwright.
  const old = Object.fromEntries(['document', 'history', 'location', '__metadataHarness'].map(key => [key, globalThis[key]]));
  const elements = new Map();
  class Element {
    constructor(tag = '') { this.tagName = tag.toUpperCase(); this.attributes = {}; this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; this.width = 0; this.height = 0; this.dataset = {}; this.children = []; this.listeners = new Map(); this.textContent = ''; this.parentElement = null; this.open = false; this.inert = false; }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'inert') this.inert = true; else this[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? this[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; if (key === 'inert') this.inert = false; }
    replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children); }
    append(...children) { for (const child of children) { if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(value => value !== child); this.children.push(child); child.parentElement = this; } }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; if (this.id) elements.delete(this.id); }
    before(...children) { if (!this.parentElement) element('nativeHost').append(this); const parent = this.parentElement; for (const child of children) { if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(value => value !== child); parent.children.splice(parent.children.indexOf(this), 0, child); child.parentElement = parent; } }
    querySelector(selector) { for (const child of this.children) { if (selector.startsWith('#') ? child.id === selector.slice(1) : child.tagName === selector.toUpperCase()) return child; const nested = child.querySelector(selector); if (nested) return nested; } return null; }
    getContext() { return {}; }
    focus() {}
    fire(name = 'click') { this.listeners.get(name)?.({ target: this }); }
  }
  const element = id => { if (!elements.has(id)) { const node = new Element(); node.id = id; elements.set(id, node); } return elements.get(id); };
  for (const match of (await readFile(new URL('../public/edit-metadata.html', import.meta.url), 'utf8')).matchAll(/\bid="([^"]+)"/g)) element(match[1]);
  const session = createDocumentSession(), resultWork = new Set(); let choose, review, generation = 0, rail, reads = 0, previewFailures = 0, chosenFailure = null, initialFailure = null, reviewCount = 0, saves = 0, downloads = 0, nextHold, reviewSHA;
  const ui = {
    documentSession: session, showDocumentIdentity() { const state = session.snapshot(); if (!state.current) return; const identity = element('documentIdentity'), original = state.original.displayName || state.original.name, current = state.current.displayName || state.current.name; identity.textContent = `Original: ${original} · Current: ${current} · Revision ${state.revision}`; identity.title = identity.textContent; identity.setAttribute('aria-label', identity.textContent); if (!identity.parentElement) element('outsideNames').append(identity); }, hideProgress() {},
    hideError() { element('errorSection').hidden = true; element('errorText').textContent = ''; },
    showError(value) { element('errorSection').hidden = false; element('errorText').textContent = value; },
    clearResultAndDrain() { generation++; review = null; rail = null; element('chainRow').hidden = true; const panel = elements.get('documentResult'); if (panel) panel.hidden = true; return Promise.allSettled([...resultWork]); },
    wireDropzone(_zone, _input, handler) { choose = handler; }, takeChainedFile: async () => null,
    async getWorkspaceInput({ operation }) { operation.assertCurrent(); const current = session.current(); return { ...current, losses: [], selection: session.snapshot().selection }; },
    async readPdfFile(file, { operation, maxBytes, maxPages, validate }) {
      assert.equal(validate, true); assert.equal(maxBytes, METADATA_LIMITS.inputBytes); assert.equal(maxPages, 1000); reads++;
      try { const bytes = new Uint8Array(await file.arrayBuffer()); if (!operation.isCurrent()) return null; await inspectPdfMetadata(bytes, { pdfLib: lib }); if (!operation.isCurrent()) return null; const state = session.begin(bytes, file.name, { ...file.browserpdfSession, type: 'application/pdf' }); return { bytes, baseName: file.name, owner: { taskId: state.taskId, revision: state.revision, generation: state.generation } }; }
      catch (error) { if (operation.isCurrent()) ui.showError(error.message); return null; }
    },
    reviewResult(bytes, name, options) {
      const work = (async () => {
      const artifact = { bytes: bytes.slice(), name, ...options }, version = ++generation; reviewCount++; reviewSHA = createHash('sha256').update(bytes).digest('hex'); ui.showDocumentIdentity();
      const panel = element('documentResult'), preview = element('documentResultPreview'), canvas = new Element('canvas'); panel.hidden = false; panel.replaceChildren(preview); preview.replaceChildren(); preview.setAttribute('aria-busy', 'true'); canvas.width = 600; canvas.height = 450; canvas.setAttribute('aria-label', artifact.displayName || artifact.name);
      review = { artifact, options, use() { if (panel.inert || version !== generation || !options.operation.isCurrent() || options.allowAdopt === false) return; const next = session.adopt(artifact.bytes, name, artifact); options.onAdopt?.(next, session.current()); }, download() { if (!panel.inert && version === generation && options.operation.isCurrent()) downloads++; } };
      const hold = nextHold; nextHold = null; if (hold) { hold.began.resolve(); await hold.release.promise; }
      const failure = options.allowAdopt === false ? chosenFailure : initialFailure;
      if (failure) { if (failure === 'render') preview.append(canvas); chosenFailure = initialFailure = null; element('documentResultStatus').textContent = 'Preview could not be displayed: injected preview failure'; }
      else { canvas.dataset.pdfPage = String((session.snapshot().selection[0] || 0) + 1); preview.append(canvas); }
      preview.setAttribute('aria-busy', 'false');
      return panel;
      })(); resultWork.add(work); work.finally(() => resultWork.delete(work)); return work;
    },
    async offerChain(bytes, name, targets, options) { if (options.operation.isCurrent()) { rail = { bytes: bytes.slice(), name, targets, options }; element('chainRow').hidden = false; } },
  };
  const routeLib = { ...lib, PDFDocument: { async load(...args) { const doc = await lib.PDFDocument.load(...args), save = doc.save.bind(doc); doc.save = async (...saveArgs) => { saves++; return save(...saveArgs); }; return doc; } } };
  const runtime = { ensurePdfLib: async () => routeLib, PDFJS_ASSET_URLS: {}, ensurePdfJs: async () => ({ getDocument({ data }) { return { promise: previewFailures > 0 ? (previewFailures--, Promise.reject(new Error('synthetic preview load failure'))) : reopened(data).then(doc => ({ numPages: doc.getPageCount(), getPage: async () => ({ getViewport: ({ scale }) => ({ width: 400 * scale, height: 300 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }) }) })), destroy: async () => {} }; } }) };
  globalThis.document = { getElementById: id => elements.get(id) || null, createElement: tag => new Element(tag) }; globalThis.history = { replaceState() {} }; globalThis.location = { pathname: '/edit-metadata', search: '' }; globalThis.__metadataHarness = { ui, runtime, t: (_key, fallback, values = {}) => fallback.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '') };
  element('editMode').checked = true; element('clearMode').checked = false;
  let source = await readFile(new URL('../public/js/edit-metadata.js', import.meta.url), 'utf8');
  source = source.replace("import { ensurePdfLib, ensurePdfJs, PDFJS_ASSET_URLS } from './lib-loader.js';", 'const {ensurePdfLib,ensurePdfJs,PDFJS_ASSET_URLS}=globalThis.__metadataHarness.runtime;').replace("import * as ui from './tool-ui.js';", 'const ui=globalThis.__metadataHarness.ui;').replace("import { t } from './i18n.js';", 'const {t}=globalThis.__metadataHarness;').replaceAll('./core/metadata-editor.js', new URL('../public/js/core/metadata-editor.js', import.meta.url).href).replaceAll('./core/document-session.js', new URL('../public/js/core/document-session.js', import.meta.url).href);
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
  return { element, find: id => elements.get(id), session, choose: file => choose([file]), review: () => review, rail: () => rail, reads: () => reads, reviews: () => reviewCount, reviewSHA: () => reviewSHA, saves: () => saves, downloads: () => downloads, failNextPreview() { previewFailures++; }, failChosenPreview(kind) { chosenFailure = kind; }, failInitialPreview(kind) { initialFailure = kind; }, holdNextReview() { nextHold = { began: deferred(), release: deferred() }; const value = nextHold; return { began: value.began.promise, release: () => value.release.resolve() }; }, async close() { element('clearBtn').fire(); await until(() => element('metadataWorkspace')['aria-busy'] === 'false'); for (const [key, value] of Object.entries(old)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } };
}
function nativeFile(bytes, name = 'SOURCE.pdf', read = async () => bytes.slice().buffer) { return { name, type: 'application/pdf', size: bytes.length, arrayBuffer: read }; }
test('actual route keeps a successful result token alive, transfers only verified Use, reopens chosen bytes and revokes its rail on edit', async () => {
  const env = await routeHarness();
  try {
    const bytes = await fixture(); env.choose(nativeFile(bytes)); await until(() => env.element('titleInput').value === 'Original İstanbul 🙂' && env.element('metadataWorkspace')['aria-busy'] === 'false'); const task = env.session.snapshot().taskId;
    env.element('titleInput').value = '  Changed İstanbul,🙂  '; env.element('titleInput').fire('input'); env.element('applyBtn').fire(); await until(() => !!env.review() && env.element('metadataWorkspace')['aria-busy'] === 'false');
    const reviewed = env.review(); assert.equal(reviewed.options.operation.isCurrent(), true); assert.equal(env.session.current().name, 'SOURCE.pdf'); assert.equal(env.rail(), null); assert.equal((await reopened(reviewed.artifact.bytes)).getTitle(), '  Changed İstanbul,🙂  ');
    reviewed.use(); await until(() => !!env.rail() && env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.equal(env.session.snapshot().taskId, task); assert.deepEqual(env.session.original().bytes, bytes); assert.deepEqual(env.rail().bytes, env.session.current().bytes); assert.equal(env.review().options.allowAdopt, false); assert.equal(env.session.current().boundary.kind, 'pdf-rewrite'); assert.ok(env.session.current().boundary.losses.includes('signature-rewrite'));
    env.element('authorInput').value = 'new draft'; env.element('authorInput').fire('input'); assert.equal(env.rail(), null); assert.equal(env.element('chainRow').hidden, true); const chosen = env.session.current().bytes; reviewed.use(); assert.deepEqual(env.session.current().bytes, chosen);
    await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false');
  } finally { await env.close(); }
});
test('actual route preserves accepted A draft after rejected B and leaves oversized Producer out until deliberate Replace', async () => {
  const env = await routeHarness();
  try {
    const bytes = await fixture(); env.choose(nativeFile(bytes)); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false' && env.element('titleInput').value !== ''); const before = env.session.transfer();
    assert.equal(env.element('producerInput').disabled, true); env.element('titleInput').value = 'retained draft'; env.element('titleInput').fire('input'); env.choose(nativeFile(new TextEncoder().encode('%PDF-invalid'), 'BAD.pdf')); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.equal(env.element('titleInput').value, 'retained draft'); assert.deepEqual(env.session.transfer(), before); assert.equal(env.element('applyBtn').disabled, false); assert.equal(env.element('errorSection').hidden, false);
    env.element('producerReplace').fire(); env.element('producerInput').value = 'explicit replacement'; env.element('producerInput').fire('input'); env.element('applyBtn').fire(); await until(() => !!env.review() && env.element('metadataWorkspace')['aria-busy'] === 'false'); const saved = await reopened(env.review().artifact.bytes); assert.equal(saved.getTitle(), 'retained draft'); assert.equal(saved.getProducer(), 'explicit replacement');
  } finally { await env.close(); }
});
test('actual route Clear drains an unabortable first File read before ready B can commit', async () => {
  const env = await routeHarness();
  try {
    const bytes = await fixture(), hold = deferred(), began = deferred(); env.choose(nativeFile(bytes, 'HELD.pdf', async () => { began.resolve(); await hold.promise; return bytes.slice().buffer; })); await began.promise;
    env.element('clearBtn').fire(); env.choose(nativeFile(bytes, 'FRESH.pdf')); await tick(); assert.equal(env.reads(), 1); assert.equal(env.session.current(), null); hold.resolve(); await until(() => env.session.current()?.name === 'FRESH.pdf' && env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.equal(env.reads(), 2); assert.equal(env.element('titleInput').value, 'Original İstanbul 🙂');
  } finally { await env.close(); }
});
test('actual route Retry hydrates accepted B after preview failure without restoring A values', async () => {
  const env = await routeHarness();
  try {
    const a = await fixture(), bDoc = await reopened(a); bDoc.setTitle('ACCEPTED B'); const b = await bDoc.save({ updateFieldAppearances: false }); env.choose(nativeFile(a)); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false' && env.element('titleInput').value !== ''); env.failNextPreview(); env.choose(nativeFile(b, 'B.pdf')); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.equal(env.session.current().name, 'B.pdf'); assert.equal(env.element('optionsSection').hidden, true); assert.equal(env.element('retryBtn').hidden, false); env.element('retryBtn').fire(); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false' && !env.element('optionsSection').hidden); assert.equal(env.element('titleInput').value, 'ACCEPTED B'); assert.equal(env.element('applyBtn').disabled, true);
  } finally { await env.close(); }
});
test('actual route can inspect a full finite prior boundary and rejects disclosure overflow before rewriting', async () => {
  const env = await routeHarness();
  try {
    const bytes = await fixture(), file = nativeFile(bytes); file.browserpdfSession = { boundary: { kind: 'pdf-rewrite', losses: BOUNDARY_LOSSES.filter(code => code !== 'signature-rewrite').slice(0, 12) } }; env.choose(file); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false' && env.element('titleInput').value !== ''); const before = env.session.transfer(); env.element('titleInput').value = 'new draft'; env.element('titleInput').fire('input'); env.element('applyBtn').fire(); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.equal(env.review(), null); assert.match(env.element('errorText').textContent, /too many rewrite disclosures/); assert.deepEqual(env.session.transfer(), before); assert.equal(env.element('titleInput').value, 'new draft');
  } finally { await env.close(); }
});
for (const kind of ['load', 'render']) test(`actual route chosen ${kind} failure retains the adopted bytes without a rail until positive Retry`, async () => {
  const env = await routeHarness();
  try {
    const bytes = await fixture(); env.choose(nativeFile(bytes)); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false' && env.element('titleInput').value !== ''); env.element('titleInput').value = `Chosen ${kind} retry`; env.element('titleInput').fire('input'); env.element('applyBtn').fire(); await until(() => env.review() && env.element('metadataWorkspace')['aria-busy'] === 'false'); const reviewed = env.review(), prepared = reviewed.artifact.bytes.slice(); env.failChosenPreview(kind); reviewed.use(); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false');
    assert.equal(env.rail(), null); assert.equal(env.element('chainRow').hidden, true); assert.equal(env.element('documentResult').hidden, true); assert.equal(env.element('retryBtn').hidden, false); assert.equal(env.element('documentResult').inert, true); assert.match(env.element('errorText').textContent, /chosen.*preview|preview.*chosen/i); assert.deepEqual(env.session.current().bytes, prepared); assert.deepEqual(env.session.original().bytes, bytes); const chosen = env.session.transfer();
    env.element('retryBtn').fire(); await until(() => env.rail() && env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.deepEqual(env.session.transfer(), chosen); assert.deepEqual(env.rail().bytes, prepared); assert.equal(env.review().options.allowAdopt, false); assert.equal(env.element('documentResultPreview').querySelector('canvas').dataset.pdfPage, '1'); assert.equal(env.reviews(), 3); assert.equal(env.reads(), 1); assert.equal(env.saves(), 1); assert.equal(env.element('errorSection').hidden, true); await save(`chosen-${kind}-retry.pdf`, prepared);
  } finally { await env.close(); }
});
test('actual route owns one compact names identity through Use, history and accepted Clear', async () => {
  const env = await routeHarness();
  try {
    const bytes = await fixture(); env.choose(nativeFile(bytes, 'İstanbul العربية compact.pdf')); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false' && env.element('titleInput').value !== ''); const names = env.element('metadataDocumentNames'), identity = env.find('documentIdentity'); assert.equal(identity.parentElement, names); assert.equal(env.element('fileSummary').hidden, true); assert.match(identity.getAttribute('aria-label'), /İstanbul العربية compact.pdf/); names.open = true;
    env.element('titleInput').value = 'Used names'; env.element('titleInput').fire('input'); env.element('applyBtn').fire(); await until(() => env.review() && env.element('metadataWorkspace')['aria-busy'] === 'false'); env.review().use(); await until(() => env.rail() && env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.equal(env.find('documentIdentity'), identity); assert.equal(identity.parentElement, names); assert.match(identity.getAttribute('aria-label'), /metadata.pdf/);
    env.element('undoBtn').fire(); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.equal(identity.parentElement, names); assert.equal(identity.textContent, `Original: İstanbul العربية compact.pdf · Current: İstanbul العربية compact.pdf · Revision ${env.session.snapshot().revision}`); env.element('clearBtn').fire(); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.equal(env.session.current(), null); assert.equal(env.find('documentIdentity'), undefined); assert.equal(names.open, false); assert.equal(env.element('fileSummary').textContent, ''); assert.equal(env.element('fileSummary').hidden, false); assert.equal(env.element('metadataCanvas').getAttribute('aria-label'), 'Current PDF preview');
  } finally { await env.close(); }
});
for (const kind of ['load', 'render']) test(`actual route initial ${kind} failure keeps verified bytes cached for positive Retry without saving again`, async () => {
  const env = await routeHarness();
  try {
    const bytes = await fixture(); env.choose(nativeFile(bytes)); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false' && env.element('titleInput').value !== ''); const original = env.session.transfer(); env.failInitialPreview(kind); env.element('titleInput').value = `Initial ${kind} retry`; env.element('titleInput').fire('input'); env.element('applyBtn').fire(); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.equal(env.element('documentResult').hidden, true); assert.equal(env.element('documentResult').inert, true); assert.equal(env.element('retryBtn').hidden, false); assert.equal(env.rail(), null); assert.equal(env.saves(), 1); assert.deepEqual(env.session.transfer(), original); env.element('retryBtn').fire(); await until(() => env.review() && !env.element('documentResult').inert && env.element('metadataWorkspace')['aria-busy'] === 'false'); const prepared = env.review().artifact.bytes.slice(); assert.equal((await reopened(prepared)).getTitle(), `Initial ${kind} retry`); assert.equal(env.saves(), 1); assert.deepEqual(env.session.transfer(), original); env.review().use(); await until(() => env.rail() && env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.deepEqual(env.session.current().bytes, prepared); assert.equal(env.saves(), 1); await save(`initial-${kind}-retry.pdf`, prepared);
  } finally { await env.close(); }
});
test('actual route initial held preview locks Use and Download until a positive canvas is ready', async () => {
  const env = await routeHarness(); let hold;
  try {
    const bytes = await fixture(); env.choose(nativeFile(bytes)); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false' && env.element('titleInput').value !== ''); const original = env.session.transfer(); hold = env.holdNextReview(); env.element('titleInput').value = 'Held initial preview'; env.element('titleInput').fire('input'); env.element('applyBtn').fire(); await hold.began; assert.equal(env.element('documentResult').inert, true); env.review().use(); env.review().download(); assert.deepEqual(env.session.transfer(), original); assert.equal(env.downloads(), 0); assert.equal(env.rail(), null); hold.release(); await until(() => env.review() && !env.element('documentResult').inert && env.element('metadataWorkspace')['aria-busy'] === 'false'); env.review().download(); assert.equal(env.downloads(), 1); assert.equal(env.saves(), 1);
  } finally { hold?.release(); await env.close(); }
});
test('actual route selected-page Retry preserves cached bytes and modification time without another save', async () => {
  const env = await routeHarness();
  try {
    const bytes = await fixture(); env.choose(nativeFile(bytes)); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false' && env.element('titleInput').value !== ''); env.failInitialPreview('load'); env.element('titleInput').value = 'Cached page Retry'; env.element('titleInput').fire('input'); env.element('applyBtn').fire(); await until(() => env.element('metadataWorkspace')['aria-busy'] === 'false'); const savedSHA = env.reviewSHA(); assert.equal(env.saves(), 1); env.element('nextPageBtn').fire(); await until(() => env.review() && env.element('metadataWorkspace')['aria-busy'] === 'false'); assert.equal(env.reviewSHA(), savedSHA); assert.equal(env.saves(), 1); assert.equal(env.element('documentResultPreview').querySelector('canvas').dataset.pdfPage, '2'); assert.equal(env.element('applyBtn').disabled, true);
  } finally { await env.close(); }
});
test.after(async () => { await writeFile(join(output, 'artifacts.json'), JSON.stringify({ artifacts }, null, 2) + '\n'); process.stdout.write(`# metadata artifacts: ${output}\n`); });
