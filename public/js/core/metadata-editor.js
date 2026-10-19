'use strict';

import { removeStandardMetadata } from './metadata-cleanup.js';
import { boundedViewport } from './bounded-renderer.js';

export const METADATA_LIMITS = Object.freeze({ inputBytes: 32 * 1024 * 1024, outputBytes: 32 * 1024 * 1024, pages: 1000, fieldUnits: 4096, aggregateUnits: 24576, dateDisplayUnits: 128 });
export const METADATA_FIELDS = Object.freeze(['title', 'author', 'subject', 'keywords', 'creator', 'producer']);
const KEYS = Object.freeze({ title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords', creator: 'Creator', producer: 'Producer', creationDate: 'CreationDate', modificationDate: 'ModDate' });
const fail = (code, message) => Object.assign(new Error(message), { code });
const abort = signal => signal?.throwIfAborted();
const plain = value => value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const prefix = (value, limit) => value.length <= limit ? value : value.slice(0, limit - 1).replace(/[\ud800-\udbff]$/, '') + '…';
function validUnicode(value) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
export function validateMetadataChange(change) {
  if (!plain(change) || Object.keys(change).some(key => !['version', 'mode', 'patch'].includes(key)) || change.version !== 1 || !['edit', 'clear-standard'].includes(change.mode) || !plain(change.patch)) throw fail('metadata-input', 'Choose a supported metadata operation.');
  let units = 0;
  for (const [key, value] of Object.entries(change.patch)) {
    if (!METADATA_FIELDS.includes(key) || typeof value !== 'string' || !validUnicode(value)) throw fail('metadata-input', 'Metadata edits must contain supported text fields and valid Unicode.');
    if (value.length > METADATA_LIMITS.fieldUnits || (units += value.length) > METADATA_LIMITS.aggregateUnits) throw fail('metadata-field-limit', 'Each edited field supports 4096 UTF-16 units, with 24576 units across all six fields.');
  }
  if (change.mode === 'clear-standard' && Object.keys(change.patch).length) throw fail('metadata-input', 'Standard cleanup cannot also contain field edits.');
  return { version: 1, mode: change.mode, patch: { ...change.patch } };
}
function ownedInput(input) {
  const size = input?.byteLength;
  if (!(input instanceof Uint8Array || input instanceof ArrayBuffer) || !size || size > METADATA_LIMITS.inputBytes) throw fail('metadata-input-limit', 'Choose a PDF of at most 32 MiB.');
  return input instanceof Uint8Array ? input.slice() : new Uint8Array(input.slice(0));
}
function runtime(lib) { if (!lib?.PDFDocument || !lib?.PDFName || !lib?.PDFDict || !lib?.PDFString || !lib?.PDFHexString) throw new TypeError('The pinned pdf-lib runtime is required.'); }
async function load(bytes, lib, signal) {
  abort(signal);
  const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  abort(signal);
  const pages = doc.getPageCount();
  if (pages < 1 || pages > METADATA_LIMITS.pages) throw fail('metadata-page-limit', 'Choose a PDF with 1 to 1000 readable pages.');
  return doc;
}
function dictionary(doc, lib) {
  const ref = doc.context.trailerInfo.Info;
  if (!ref) return null;
  const info = doc.context.lookup(ref);
  if (!(info instanceof lib.PDFDict)) throw fail('metadata-info', 'The PDF information dictionary could not be read.');
  return info;
}
function raw(doc, lib, key) {
  const info = dictionary(doc, lib), name = lib.PDFName.of(KEYS[key]);
  if (!info?.has(name)) return undefined;
  return info.lookup(name)?.toString();
}
function snapshot(doc, lib) {
  const fields = {};
  for (const [field, key] of Object.entries(KEYS)) {
    try {
      const info = dictionary(doc, lib), name = lib.PDFName.of(key);
      if (!info?.has(name)) { fields[field] = { status: 'absent', value: '', length: 0 }; continue; }
      const value = info.lookup(name);
      if (!(value instanceof lib.PDFString || value instanceof lib.PDFHexString)) throw new Error('Non-text Info value');
      const text = value.decodeText(), date = !METADATA_FIELDS.includes(field), limit = date ? METADATA_LIMITS.dateDisplayUnits : METADATA_LIMITS.fieldUnits;
      if (date) {
        const parsed = value.decodeDate();
        if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid date');
        fields[field] = { status: 'value', value: parsed.toISOString(), length: text.length };
      } else fields[field] = { status: text.length > limit ? 'oversized' : 'value', value: prefix(text, limit), length: text.length, replaceRequired: text.length > limit || /\r|\u0000/.test(text) || !validUnicode(text) };
    } catch { fields[field] = { status: 'unreadable', value: '', length: 0, replaceRequired: true }; }
  }
  return { version: 1, pageCount: doc.getPageCount(), fields };
}
export async function inspectPdfMetadata(input, { pdfLib, signal } = {}) {
  runtime(pdfLib);
  return snapshot(await load(ownedInput(input), pdfLib, signal), pdfLib);
}
export async function applyPdfMetadata(input, change, { pdfLib, signal, now = () => new Date() } = {}) {
  runtime(pdfLib);
  const request = validateMetadataChange(change), bytes = ownedInput(input), doc = await load(bytes, pdfLib, signal), before = snapshot(doc, pdfLib);
  const untouched = Object.fromEntries(Object.keys(KEYS).map(key => [key, raw(doc, pdfLib, key)]));
  let output, stamp;
  const changedFields = Object.keys(request.patch).filter(key => before.fields[key].status !== 'value' || before.fields[key].value !== request.patch[key]);
  if (request.mode === 'clear-standard') output = await removeStandardMetadata(bytes, pdfLib, { signal });
  else {
    if (!changedFields.length) throw fail('metadata-no-change', 'Change at least one metadata field before preparing a copy.');
    for (const key of changedFields) {
      const setter = 'set' + key[0].toUpperCase() + key.slice(1);
      doc[setter](key === 'keywords' ? [request.patch[key]] : request.patch[key]);
    }
    stamp = now();
    if (!(stamp instanceof Date) || !Number.isFinite(stamp.getTime())) throw fail('metadata-input', 'A valid modification time is required.');
    doc.setModificationDate(stamp);
    abort(signal);
    output = new Uint8Array(await doc.save({ updateFieldAppearances: false }));
  }
  abort(signal);
  if (!output.length || output.length > METADATA_LIMITS.outputBytes) throw fail('metadata-output-limit', 'The prepared copy exceeds the 32 MiB workspace limit.');
  const reopened = await load(output.slice(), pdfLib, signal), after = snapshot(reopened, pdfLib);
  if (after.pageCount !== before.pageCount) throw fail('metadata-verification', 'The saved page count changed.');
  for (const key of Object.keys(KEYS)) {
    const actual = raw(reopened, pdfLib, key);
    if (request.mode === 'clear-standard') {
      if (actual !== undefined) throw fail('metadata-verification', 'A standard Info field remains in the saved copy.');
    } else if (changedFields.includes(key)) {
      if (after.fields[key].status !== 'value' || after.fields[key].value !== request.patch[key]) throw fail('metadata-verification', 'A saved metadata field differs from the requested text.');
    } else if (key === 'modificationDate') {
      if (actual !== pdfLib.PDFString.fromDate(stamp).toString()) throw fail('metadata-verification', 'The saved modification date could not be verified.');
    } else if (actual !== untouched[key]) throw fail('metadata-verification', 'An untouched Info field changed.');
  }
  abort(signal);
  return { bytes: output, before, after, pageCount: after.pageCount, changedFields: request.mode === 'clear-standard' ? Object.keys(KEYS).filter(key => untouched[key] !== undefined) : [...changedFields, 'modificationDate'], mode: request.mode };
}

// A canceled job keeps its native promise until it actually settles. Only the
// latest unread descriptor survives while that promise drains.
export function createMetadataWorkQueue(run) {
  let active, pending;
  const waiters = new Set();
  const canceled = () => new DOMException('Metadata work was canceled or replaced.', 'AbortError');
  function pump() {
    if (active) return;
    if (!pending) { for (const resolve of waiters) resolve(); waiters.clear(); return; }
    const record = pending; pending = null; active = record;
    const operation = { signal: record.controller.signal, isCurrent: () => active === record && !record.controller.signal.aborted && (!record.options.isCurrent || record.options.isCurrent()) };
    operation.assertCurrent = () => { if (!operation.isCurrent()) throw canceled(); };
    Promise.resolve().then(() => { operation.assertCurrent(); return run(record.value, operation); }).then(value => { operation.assertCurrent(); record.resolve(value); }, record.reject).catch(record.reject).finally(() => { record.value = null; active = null; pump(); });
  }
  const cancel = () => { active?.controller.abort(); if (pending) { pending.reject(canceled()); pending.value = null; pending = null; } };
  return {
    replace(value, options = {}) { cancel(); return new Promise((resolve, reject) => { pending = { value, options, resolve, reject, controller: new AbortController() }; pump(); }); },
    cancel,
    drained() { return active || pending ? new Promise(resolve => waiters.add(resolve)) : Promise.resolve(); },
  };
}

// No DOM globals: the route supplies one canvas and the existing runtime.
// Failed task destruction is retained and must be retried before another load.
export function createMetadataPreview({ canvas, ensurePdfJs, pdfjsAssets = {} }) {
  let task, render, destruction, cleanupError;
  async function destroy(retry = false) {
    if (!task) return;
    if (cleanupError && !retry) throw cleanupError;
    if (retry) { cleanupError = null; destruction = null; }
    destruction ||= Promise.resolve().then(() => task.destroy());
    try { await destruction; task = null; destruction = null; }
    catch (error) { cleanupError = fail('metadata-cleanup', 'Preview cleanup failed. Choose Retry before opening another PDF.'); cleanupError.cause = error; throw cleanupError; }
  }
  return {
    clear() { render?.cancel(); canvas.width = canvas.height = 0; },
    async drained({ retry = false } = {}) { await destroy(retry); },
    async open(bytes, { pageIndex = 0, signal } = {}) {
      await destroy(); abort(signal);
      const pdfjs = await ensurePdfJs(); abort(signal);
      task = pdfjs.getDocument({ data: bytes.slice(), ...pdfjsAssets });
      const cancel = () => { render?.cancel(); void destroy().catch(() => {}); };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const pdf = await task.promise; abort(signal);
        if (pdf.numPages < 1 || pdf.numPages > METADATA_LIMITS.pages) throw fail('metadata-page-limit', 'Choose a PDF with 1 to 1000 readable pages.');
        const selected = Math.max(0, Math.min(pdf.numPages - 1, pageIndex)), page = await pdf.getPage(selected + 1); abort(signal);
        const viewport = boundedViewport(page, { scale: 1.5, maxDimension: 900, maxPixels: 4000000 });
        canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
        render = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        await render.promise; abort(signal); canvas.dataset.pdfPage = String(selected + 1);
        return { pageIndex: selected, pageCount: pdf.numPages };
      } finally { signal?.removeEventListener('abort', cancel); render = null; await destroy(); if (signal?.aborted) canvas.width = canvas.height = 0; }
    },
  };
}
