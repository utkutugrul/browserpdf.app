'use strict';
import { DOCTOR_LIMITS, rebuildPagePolicy } from './doctor-policy.js';
import { doctorByteLength, doctorInput, doctorLimits, doctorParse, diagnoseDoctorWithin, summarizeDoctorReport } from './document-doctor.js';
const fail = (code, message) => Object.assign(new Error(message), { code: `DOCTOR_${code}` });
const tolerance = 1e-6;
function dimensions(page, api) {
  const view = api.sync(page, 'getViewport', [{ scale: 1 }]);
  if (![view.width, view.height, page.rotate, page.userUnit].every(Number.isFinite) || view.width <= 0 || view.height <= 0 || page.userUnit <= 0) throw fail('GEOMETRY', 'The physical page geometry is unavailable.');
  return { width: view.width, height: view.height, rotation: page.rotate, userUnit: page.userUnit };
}
async function render(page, pageScope, api, createCanvas, limits, source = false) {
  const base = api.sync(page, 'getViewport', [{ scale: 1 }]);
  if (![base.width, base.height].every(Number.isFinite) || base.width <= 0 || base.height <= 0) throw fail('GEOMETRY', 'Page dimensions are invalid.');
  const scale = Math.min(source ? 1.25 : 0.35, limits.renderDimension / base.width, limits.renderDimension / base.height, Math.sqrt(limits.renderPixels / (Math.ceil(base.width) * Math.ceil(base.height))));
  const viewport = api.sync(page, 'getViewport', [{ scale }]), width = Math.ceil(viewport.width), height = Math.ceil(viewport.height), pixels = width * height;
  if (!Number.isSafeInteger(pixels) || width < 1 || height < 1 || width > limits.renderDimension || height > limits.renderDimension || pixels > limits.renderPixels) throw fail('GEOMETRY', 'The bounded canvas cannot represent this page.');
  api.work.admit({ pixels, ...(source ? { sourcePixels: pixels } : {}) });
  const key = Symbol('canvas'); api.reserve(key, { expandedBytes: pixels * 4, expandedCount: 1 });
  if (typeof createCanvas !== 'function') throw new TypeError('Verified output requires a canvas factory.');
  const canvas = createCanvas(width, height); api.capture(key, canvas); api.resetAfterDrain(() => { canvas.width = canvas.height = 0; });
  const actualWidth = canvas.width, actualHeight = canvas.height;
  if (!Number.isSafeInteger(actualWidth) || !Number.isSafeInteger(actualHeight) || actualWidth < 1 || actualHeight < 1 || !Number.isSafeInteger(actualWidth * actualHeight * 4)) throw fail('GEOMETRY', 'Canvas factory returned invalid backing dimensions.');
  api.hold(key, canvas, { expandedBytes: actualWidth * actualHeight * 4, expandedCount: 1 });
  if (actualWidth !== width || actualHeight !== height) throw fail('GEOMETRY', 'Canvas factory changed backing size.'); api.guard();
  await pageScope.render({ canvasContext: canvas.getContext('2d'), viewport }); api.guard(); return { canvas, pixels };
}
async function geometries(bytes, options, api, rebuild) {
  api.reserve(Symbol('geometry'), { expandedBytes: 1152000, expandedCount: 1 });
  return api.inspectPdf(options.pdfjs, bytes, options.pdfjsAssets || {}, async (doc, scope) => {
    if (doc.numPages > (rebuild ? options.limits.rebuildPages : options.limits.pages)) throw fail('WORK_LIMIT', 'Doctor page limit reached.');
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) { api.work.admit({ pageVisits: 1 }); await scope.withPage(n, page => { const geometry = dimensions(page, api); if (rebuild) rebuildPagePolicy(api.sync(page, 'getViewport', [{ scale: 1 }])); pages.push(geometry); return null; }); }
    return pages;
  });
}
async function save(document, options, api) {
  const key = Symbol('saved'); api.reserve(key, { artifactBytes: options.limits.outputBytes });
  const bytes = await api.call(document, 'save', [{ updateFieldAppearances: false }]);
  // Native save allocates first; charge its real backing before refusing it.
  const actual = bytes instanceof Uint8Array ? bytes.buffer.byteLength : 0;
  api.hold(key, bytes, { artifactBytes: actual });
  doctorByteLength(bytes, options.limits.outputBytes); return bytes;
}
async function verify(bytes, expected, options, api, everyPage) {
  const renderedPages = [], selected = options.selectedPage ?? 1;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > expected.length) throw new RangeError('Selected verification page is out of range.');
  const representatives = new Set(everyPage ? expected.map((_value, n) => n + 1) : [1, expected.length, selected]);
  let checked = 0;
  const diagnosis = await diagnoseDoctorWithin(bytes, { ...options, mode: 'quick', verifyPage: async (page, pageScope, n) => {
    const actual = dimensions(page, api), wanted = expected[n - 1];
    if (!wanted || Math.abs(actual.width - wanted.width) > tolerance || Math.abs(actual.height - wanted.height) > tolerance || actual.rotation !== wanted.rotation || actual.userUnit !== wanted.userUnit) throw fail('VERIFY', 'Saved physical page geometry changed.');
    checked++;
    if (representatives.has(n)) { await render(page, pageScope, api, options.createCanvas, options.limits); renderedPages.push(n); }
  } }, api);
  if (!diagnosis.parses.pdfLibStrict.ok || !diagnosis.parses.pdfjsStrict.ok || !diagnosis.pageTree.consistent || diagnosis.pageCount !== expected.length || checked !== expected.length || renderedPages.length !== representatives.size) throw fail('VERIFY', 'Saved output did not pass strict count, geometry and rendering verification.');
  return { diagnosis: summarizeDoctorReport(diagnosis), verification: { pdfLibStrict: true, pdfjsStrict: true, renderedPages, geometryPages: checked, complete: true } };
}
function optionsFor(options) { if (!options.pdfLib?.PDFDocument || !options.pdfjs?.getDocument) throw new TypeError('Pinned peer runtimes are required.'); return { ...options, limits: doctorLimits(options.limits) }; }
export async function normalizeDoctorWithin(input, rawOptions, api) {
  const options = optionsFor(rawOptions); doctorInput(input, options.limits.inputBytes);
  const parsed = await doctorParse(input, options.pdfLib, api, options.limits);
  if (!parsed.doc || parsed.locked) throw fail('LOCKED', 'Normalization needs a usable unlocked PDF. Open protected files in Unlock.');
  const expected = await geometries(input, options, api, false);
  if (api.sync(parsed.doc, 'getPageCount') !== expected.length) throw fail('VERIFY', 'Source parsers disagree about page count.');
  api.guard(); options.onProgress?.({ phase: 'serialize' }); api.guard();
  const bytes = await save(parsed.doc, options, api); api.guard(); options.onProgress?.({ phase: 'verify' }); api.guard();
  const checked = await verify(bytes, expected, options, api, false);
  const result = { bytes, ...checked, lossManifest: { action: 'normalize-structure', changes: ['Rewrites PDF serialization into a new copy.'], preservationIntent: ['Attempts to retain page content', 'page order', 'metadata', 'attachments', 'actions', 'forms', 'and structure tags'], losses: [], risks: ['Unsupported or malformed structures may be omitted.', 'Any rewrite can invalidate digital signatures; signature validity is not checked.'] } };
  api.registerResult(result, { artifactBytes: bytes.buffer.byteLength, expandedBytes: 2304000, expandedCount: 2 }); return result;
}
export async function rebuildDoctorWithin(input, rawOptions, api) {
  const options = optionsFor(rawOptions); doctorInput(input, options.limits.inputBytes);
  if (options.executionIntent !== 'rebuild-page-content') throw fail('EXECUTION', 'Raster rebuilding needs a separate explicit execution request after loss review.');
  const expectedSource = await geometries(input, options, api, true), expected = expectedSource.map(value => ({ width: value.width, height: value.height, rotation: 0, userUnit: 1 }));
  const output = await api.call(options.pdfLib.PDFDocument, 'create', [{ updateMetadata: false }]);
  await api.inspectPdf(options.pdfjs, input, options.pdfjsAssets || {}, async (doc, scope) => {
    if (doc.numPages !== expected.length) throw fail('VERIFY', 'Source page count changed.');
    for (let n = 1; n <= doc.numPages; n++) {
      api.work.admit({ pageVisits: 1 });
      await scope.withPage(n, async (page, pageScope) => {
        const policy = rebuildPagePolicy(api.sync(page, 'getViewport', [{ scale: 1 }])), surface = await render(page, pageScope, api, options.createCanvas, options.limits, true);
        const pngKey = Symbol('PNG'); api.reserve(pngKey, { expandedBytes: options.limits.encodedPageBytes, expandedCount: 1 });
        const toBlob = surface.canvas.toBlob; api.guard(); if (typeof toBlob !== 'function') throw new TypeError('A PNG encoder is required.');
        const blob = await api.first(() => new Promise((resolve, reject) => Reflect.apply(toBlob, surface.canvas, [value => value ? resolve(value) : reject(fail('ENCODE', 'Page rasterization failed.')), 'image/png'])));
        if (!(blob instanceof Blob)) throw new TypeError('The encoder did not return a Blob.');
        api.hold(pngKey, blob, { expandedBytes: blob.size, expandedCount: 1 });
        if (blob.size > options.limits.encodedPageBytes) throw fail('WORK_LIMIT', 'Encoded page limit reached.');
        api.work.admit({ encodedBytes: blob.size });
        const readKey = Symbol('PNG read'); api.reserve(readKey, { expandedBytes: blob.size, expandedCount: 1 });
        const buffer = await api.call(blob, 'arrayBuffer'); api.hold(readKey, buffer, { expandedBytes: buffer.byteLength, expandedCount: 1 });
        if (buffer.byteLength !== blob.size) throw fail('ENCODE', 'Encoded page length changed.');
        api.reserve(Symbol('decoded PNG'), { expandedBytes: surface.pixels * 4, expandedCount: 1 });
        const image = await api.call(output, 'embedPng', [new Uint8Array(buffer)]);
        const target = api.sync(output, 'addPage', [[policy.width, policy.height]]); api.sync(target, 'setMediaBox', [0, 0, policy.width, policy.height]); api.sync(target, 'setCropBox', [0, 0, policy.width, policy.height]); api.sync(target, 'setRotation', [api.sync(options.pdfLib, 'degrees', [0])]); api.sync(target, 'drawImage', [image, { x: 0, y: 0, width: policy.width, height: policy.height }]);
      });
      api.guard(); options.onProgress?.({ phase: 'page', page: n, pageCount: doc.numPages }); api.guard();
    }
    return null;
  });
  const bytes = await save(output, options, api); api.guard(); options.onProgress?.({ phase: 'verify' }); api.guard();
  const checked = await verify(bytes, expected, options, api, true);
  const result = { bytes, ...checked, lossManifest: { action: 'rebuild-page-content', changes: ['Rasterizes every visible physical page into a new PDF.'], losses: ['Searchable/selectable text', 'links and actions', 'forms and annotations', 'attachments', 'original metadata', 'structure tags and alternative text', 'vector detail', 'existing digital signatures'], risks: ['Rasterization can reduce visual detail and increase size.'] } };
  api.registerResult(result, { artifactBytes: bytes.buffer.byteLength, expandedBytes: 2304000, expandedCount: 2 }); return result;
}
function run(input, options, producer) {
  if (!options.context) return Promise.reject(new TypeError('Doctor requires an explicit joint or SDK isolated context.'));
  return options.context.run((_job, api) => producer(input, options, api), { expectedOwner: options.expectedOwner, limits: options.limits, signal: options.signal });
}
export function normalizePdfStructure(input, options = {}) { return run(input, options, normalizeDoctorWithin); }
export function rebuildPdfPageContent(input, options = {}) { return run(input, options, rebuildDoctorWithin); }
