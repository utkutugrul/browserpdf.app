import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import * as pdfLib from 'pdf-lib';
import * as sdk from '../dist/index.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const RUNTIME_EXPORTS = ['API_VERSION', 'PACKAGE_VERSION', 'PDFJS_VERSION', 'PDF_LIB_VERSION', 'diagnoseV1', 'inspectV1', 'mergeV1', 'normalizeV1'];

async function pdf(text) {
  const document = await pdfLib.PDFDocument.create();
  document.addPage([200, 100]).drawText(text, { x: 20, y: 60, size: 12 });
  return Uint8Array.from(await document.save());
}

test('runtime exports match declarations and import without browser globals or network', async () => {
  assert.deepEqual(Object.keys(sdk).sort(), RUNTIME_EXPORTS);
  const declaration = await readFile(path.join(ROOT, 'dist/index.d.ts'), 'utf8');
  for (const name of RUNTIME_EXPORTS) assert.match(declaration, new RegExp(`\\b${name}\\b`));
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(sdk.PACKAGE_VERSION, manifest.version);
  assert.match(declaration, new RegExp(`PACKAGE_VERSION: ["']${manifest.version.replaceAll('.', '\\.')}["']`));
  assert.equal(sdk.API_VERSION, 'v1');
  assert.match(declaration, /API_VERSION: ["']v1["']/);
  assert.equal('document' in globalThis, false);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('SDK import attempted network access'); };
  try { await import(`../dist/index.js?side-effect-check=${Date.now()}`); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal('document' in globalThis, false);
});

test('merge accepts Uint8Array, ArrayBuffer, and Blob, owns inputs, reports progress, and recovers after abort', async () => {
  const first = await pdf('First');
  const second = await pdf('Second');
  const firstBefore = first.slice(); const secondBefore = second.slice();
  const events = [];
  const output = await sdk.mergeV1([
    { data: first, name: 'first.pdf' }, second.buffer.slice(second.byteOffset, second.byteOffset + second.byteLength), new Blob([first]),
  ], { pdfLib, onProgress: (event) => events.push(event) });
  assert.equal((await pdfLib.PDFDocument.load(output)).getPageCount(), 3);
  assert.deepEqual(first, firstBefore); assert.deepEqual(second, secondBefore);
  assert.ok(events.every((event) => event.operation === 'merge'));
  assert.equal(events.at(-1).phase, 'done');

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const delayedPdfLib = { PDFDocument: {
    create: async () => ({ copyPages: async () => [], addPage() {}, save: async () => new Uint8Array([1]) }),
    load: async () => { await gate; return { getPageIndices: () => [] }; },
  } };
  const controller = new AbortController();
  const pending = sdk.mergeV1([first, second], { pdfLib: delayedPdfLib, signal: controller.signal });
  controller.abort(); release();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
  assert.equal((await pdfLib.PDFDocument.load(await sdk.mergeV1([first, second], { pdfLib }))).getPageCount(), 2);
});

function fakePdfJs({ failPage = false, wait = false, waitPage = false } = {}) {
  const calls = { task: 0, doc: 0 };
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let markPageStarted;
  let releasePage;
  const pageStarted = new Promise((resolve) => { markPageStarted = resolve; });
  const pageGate = new Promise((resolve) => { releasePage = resolve; });
  let rejectLoad;
  const page = {
    getAnnotations: async () => [], getJSActions: async () => null,
    getTextContent: async () => { if (failPage) throw new Error('page failure'); return { items: [] }; },
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
  };
  const doc = {
    numPages: 1, getMetadata: async () => ({ info: {}, metadata: null }), getAttachments: async () => null,
    getJSActions: async () => null, getOpenAction: async () => null, getFieldObjects: async () => null,
    getCalculationOrderIds: async () => null, getPermissions: async () => null,
    getPage: async () => { if (waitPage) { markPageStarted(); await pageGate; } return page; },
    destroy: async () => { calls.doc++; },
  };
  const task = {
    promise: wait ? new Promise((resolve, reject) => { rejectLoad = reject; }) : Promise.resolve(doc),
    destroy: async () => { calls.task++; rejectLoad?.(new DOMException('Aborted', 'AbortError')); },
  };
  return {
    runtime: { version: '6.2.108', OPS: {}, getDocument: () => { markStarted(); return task; } },
    calls, started, pageStarted, releasePage,
  };
}

test('inspection owns Blob input and destroys PDF.js task/document on success, error, and abort', async () => {
  const input = await pdf('Inspect');
  const before = input.slice();
  const success = fakePdfJs();
  const events = [];
  const report = await sdk.inspectV1(new Blob([input]), { pdfjs: success.runtime, onProgress: (event) => events.push(event) });
  assert.equal(report.pageCount, 1); assert.equal(success.calls.task, 1); assert.equal(success.calls.doc, 1);
  assert.deepEqual(input, before); assert.equal(events[0].operation, 'inspect');
  const failure = fakePdfJs({ failPage: true });
  await assert.rejects(sdk.inspectV1(input.buffer.slice(0), { pdfjs: failure.runtime }), /page failure/);
  assert.equal(failure.calls.task, 1); assert.equal(failure.calls.doc, 1);
  const waiting = fakePdfJs({ wait: true });
  const controller = new AbortController();
  const pending = sdk.inspectV1(input, { pdfjs: waiting.runtime, signal: controller.signal });
  await waiting.started; controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
  assert.ok(waiting.calls.task >= 1); assert.equal(waiting.calls.doc, 0);
});

test('all APIs reject pre-aborted signals, enforce the PDF.js version, and remain recoverable', async () => {
  const input = await pdf('Abort');
  const runtime = fakePdfJs().runtime;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(sdk.mergeV1([input, input], { pdfLib, signal: controller.signal }), (error) => error.name === 'AbortError');
  await assert.rejects(sdk.inspectV1(input, { pdfjs: runtime, signal: controller.signal }), (error) => error.name === 'AbortError');
  await assert.rejects(sdk.diagnoseV1(input, { pdfLib, pdfjs: runtime, signal: controller.signal }), (error) => error.name === 'AbortError');
  await assert.rejects(sdk.normalizeV1(input, { pdfLib, pdfjs: runtime, createCanvas: () => ({}), signal: controller.signal }), (error) => error.name === 'AbortError');
  await assert.rejects(sdk.inspectV1(input, { pdfjs: { ...runtime, version: '6.2.107' } }), /6\.2\.108 is required/);
  assert.equal((await pdfLib.PDFDocument.load(await sdk.mergeV1([input, input], { pdfLib }))).getPageCount(), 2);
});

test('diagnosis and normalization suppress in-flight completion after abort and recover cleanly', async () => {
  const input = await pdf('Cooperative abort');
  const before = input.slice();
  const delayedDiagnosis = fakePdfJs({ waitPage: true });
  const diagnosisController = new AbortController();
  const diagnosis = sdk.diagnoseV1(input, {
    pdfLib, pdfjs: delayedDiagnosis.runtime, mode: 'quick', signal: diagnosisController.signal,
  });
  await delayedDiagnosis.pageStarted; diagnosisController.abort(); delayedDiagnosis.releasePage();
  await assert.rejects(diagnosis, (error) => error.name === 'AbortError');
  assert.equal(delayedDiagnosis.calls.doc, 1);
  assert.ok(delayedDiagnosis.calls.task >= 1);

  let releaseLoad;
  let markLoadStarted;
  const loadStarted = new Promise((resolve) => { markLoadStarted = resolve; });
  const loadGate = new Promise((resolve) => { releaseLoad = resolve; });
  const delayedPdfLib = {
    ...pdfLib,
    PDFDocument: {
      load: async (...args) => { markLoadStarted(); await loadGate; return pdfLib.PDFDocument.load(...args); },
    },
  };
  const normalizeController = new AbortController();
  const normalization = sdk.normalizeV1(input, {
    pdfLib: delayedPdfLib, pdfjs: fakePdfJs().runtime, createCanvas: () => ({}), signal: normalizeController.signal,
  });
  await loadStarted; normalizeController.abort(); releaseLoad();
  await assert.rejects(normalization, (error) => error.name === 'AbortError');
  assert.deepEqual(input, before);
  const recovered = await sdk.diagnoseV1(input, { pdfLib, pdfjs: fakePdfJs().runtime, mode: 'quick' });
  assert.equal(recovered.pageCount, 1);
});

test('built runtime has no site-bound imports, CDN URLs, or browser-shell access', async () => {
  const files = ['index.js', 'core/merge-pdf.js', 'core/privacy-scan.js', 'core/document-doctor.js', 'core/document-doctor-output.js'];
  const source = (await Promise.all(files.map((name) => readFile(path.join(ROOT, 'dist', name), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /tool-ui|i18n|webmcp|consent|analytics|jsdelivr|unpkg/i);
  assert.doesNotMatch(source, /querySelector|getElementById|localStorage|navigator\.|window\./);
  assert.doesNotMatch(source, /AnnotationLayer|PDFScriptingManager|renderRichText/);
});

test('build check rejects unexpected output and deterministic build removes only SDK output', async () => {
  const stale = path.join(ROOT, 'dist/unexpected.tmp');
  await writeFile(stale, 'stale');
  const rejected = spawnSync(process.execPath, ['scripts/build.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stdout}${rejected.stderr}`, /allowlist mismatch/);
  const rebuilt = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  const checked = spawnSync(process.execPath, ['scripts/build.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});

test('package dry-run contains only the declared runtime, declarations, docs, and unchanged license copy', () => {
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const manifest = JSON.parse(packed.stdout)[0];
  assert.deepEqual(manifest.files.map((entry) => entry.path).sort(), [
    'LICENSE.md', 'README.md', 'THIRD_PARTY_NOTICES.md',
    'dist/core/document-doctor-output.js', 'dist/core/document-doctor.js',
    'dist/core/merge-pdf.js', 'dist/core/privacy-scan.js',
    'dist/index.d.ts', 'dist/index.js', 'package.json',
  ]);
});
