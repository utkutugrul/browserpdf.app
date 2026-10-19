import { BOUNDARY_LOSSES } from './document-session.js';
import { renderBoundedPage } from './bounded-renderer.js';
import { PRIVACY_CATEGORY_KEYS, PRIVACY_SCAN_LIMITS, summarizePrivacyReport } from './privacy-scan.js';

export const PRIVACY_LIMITS = Object.freeze({ inputBytes: 32 * 1024 * 1024, outputBytes: 32 * 1024 * 1024, pages: 1000, reportUnits: 256000, rows: 25, previewDimension: 900, previewPixels: 4000000, ...PRIVACY_SCAN_LIMITS });
const abortError = () => new DOMException('Privacy work was replaced or canceled.', 'AbortError');
const failure = (code, message, cause) => Object.assign(new Error(message), { code: `PRIVACY_${code}`, cause });
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason').get;
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;
const apply = Reflect.apply;
const brandSignal = signal => { if (signal != null) apply(aborted, signal, []); };
const checkSignal = signal => { if (signal != null && apply(aborted, signal, [])) throw apply(reason, signal, []); };
const listen = (signal, callback) => { if (signal != null) apply(addListener, signal, ['abort', callback, { once: true }]); };
const unlisten = (signal, callback) => { if (signal != null) apply(removeListener, signal, ['abort', callback]); };
const plain = value => !!value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function scalar(value) { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Expected finite nonnegative budget scalars.'); return value; }
function sum(...values) { return scalar(values.reduce((total, value) => total + scalar(value), 0)); }
function field(value, key) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Expected an own scalar budget field.'); return scalar(descriptor.value); }
function usage(value) {
  if (!plain(value) || Reflect.ownKeys(value).some(key => !['resourceBytes', 'resourceCount', 'artifactBytes', 'expandedBytes', 'expandedCount'].includes(key))) throw new TypeError('Expected a finite workspace usage descriptor.');
  return Object.fromEntries(['resourceBytes', 'resourceCount', 'artifactBytes', 'expandedBytes', 'expandedCount'].map(key => [key, Object.hasOwn(value, key) ? field(value, key) : 0]));
}
export function assertPrivacyWorkspaceBudget(snapshot, live = {}, extra = {}) {
  if (!plain(snapshot)) throw new TypeError('A metadata session snapshot is required.');
  const a = usage(live), b = usage(extra);
  const resourceBytes = sum(field(snapshot, 'resourceBytes'), a.resourceBytes, a.expandedBytes, b.resourceBytes, b.expandedBytes);
  const resourceCount = sum(field(snapshot, 'resourceCount'), a.resourceCount, a.expandedCount, b.resourceCount, b.expandedCount);
  const retainedBytes = sum(field(snapshot, 'retainedBytes'), a.resourceBytes, a.expandedBytes, a.artifactBytes, b.resourceBytes, b.expandedBytes, b.artifactBytes);
  if (resourceBytes > 96 * 1024 * 1024 || resourceCount > 128 || retainedBytes > 512 * 1024 * 1024) throw failure('BUDGET', 'This operation and retained task exceed the joint 96 MiB/128-resource or 512 MiB limit.');
  return { resourceBytes, resourceCount, retainedBytes, remainingResourceBytes: 96 * 1024 * 1024 - resourceBytes, remainingResourceCount: 128 - resourceCount, remainingRetainedBytes: 512 * 1024 * 1024 - retainedBytes };
}

// Successful tokens stay live until the next explicit intent. Native work owns
// its whole first promise, even when cancellation has revoked publication.
export function createPrivacyWorkQueue(run) {
  if (typeof run !== 'function') throw new TypeError('A native work function is required.');
  let generation = 0, active = null, pending = null;
  const waiters = new Set();
  function pump() {
    if (active) return;
    if (!pending) { for (const resolve of waiters) resolve(); waiters.clear(); return; }
    const record = pending; pending = null; active = record;
    const isCurrent = () => record.generation === generation && !record.controller.signal.aborted;
    const job = { signal: record.controller.signal, isCurrent, assertCurrent() { checkSignal(record.controller.signal); if (!isCurrent()) throw abortError(); } };
    Promise.resolve().then(() => { job.assertCurrent(); return run(record.request, job); }).then(value => { job.assertCurrent(); record.resolve(value); }, error => {
      if (error?.code === 'PRIVACY_CLEANUP') throw error;
      job.assertCurrent(); throw error;
    }).catch(record.reject).finally(() => { record.request = null; active = null; pump(); });
  }
  function cancel(value) {
    generation++; active?.controller.abort(value);
    if (pending) { pending.controller.abort(value); pending.reject(pending.controller.signal.reason); pending.request = null; pending = null; }
  }
  return {
    submit(request) { cancel(); return new Promise((resolve, reject) => { pending = { request, resolve, reject, generation, controller: new AbortController() }; pump(); }); },
    cancel,
    drained() { return active || pending ? new Promise(resolve => waiters.add(resolve)) : Promise.resolve(); },
  };
}

// Keep actual failed handles and every first destroy promise. No successor
// getDocument is allowed until explicit Retry has proved cleanup succeeded.
export function createPrivacyPdfLifetime() {
  let active = null;
  const handles = new Map();
  const cleanupFailure = cause => failure('CLEANUP', 'Native PDF cleanup failed. Retry cleanup before opening another PDF.', cause);
  function destroy(handle, retry = false) {
    if (!handle) return Promise.resolve();
    let entry = handles.get(handle);
    if (!entry) { entry = { promise: null, error: null, failed: false }; handles.set(handle, entry); }
    if (entry.failed && !retry) return Promise.reject(cleanupFailure(entry.error));
    if (retry && entry.failed) { entry.failed = false; entry.error = null; entry.promise = null; }
    if (!entry.promise) {
      entry.promise = Promise.resolve().then(() => { if (typeof handle.destroy !== 'function') throw new TypeError('The native PDF handle has no disposal method.'); return handle.destroy(); });
      entry.promise.then(() => { handles.delete(handle); }, error => { entry.failed = true; entry.error = error; });
    }
    return entry.promise;
  }
  async function cleanup(retry = false) {
    const settled = await Promise.allSettled([...handles.keys()].map(handle => destroy(handle, retry)));
    const rejected = settled.find(value => value.status === 'rejected');
    if (rejected) throw cleanupFailure(rejected.reason);
  }
  function inspect(pdfjs, bytes, { signal, pdfjsAssets = {} } = {}, callback) {
    try { brandSignal(signal); } catch (error) { return Promise.reject(error); }
    if (active) return Promise.reject(new DOMException('Another native PDF operation is active.', 'InvalidStateError'));
    if (!pdfjs?.getDocument || typeof callback !== 'function') return Promise.reject(new TypeError('A PDF runtime and inspector are required.'));
    const record = { controller: new AbortController(), promise: null, task: null };
    active = record;
    const relay = () => record.controller.abort(apply(reason, signal, []));
    const ownSignal = record.controller.signal;
    const cancel = () => { if (record.task) void destroy(record.task).catch(() => {}); };
    record.promise = (async () => {
      let doc;
      try {
        listen(signal, relay); listen(ownSignal, cancel);
        if (signal != null && apply(aborted, signal, [])) relay();
        await cleanup(); ownSignal.throwIfAborted();
        const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), ...pdfjsAssets }); record.task = task; handles.set(task, { promise: null, error: null });
        if (ownSignal.aborted) cancel();
        doc = await task.promise;
        if (!doc || typeof doc !== 'object') throw new TypeError('The native PDF document is unavailable.');
        if (doc !== task && typeof doc.destroy === 'function') handles.set(doc, { promise: null, error: null });
        ownSignal.throwIfAborted();
        const value = await callback(doc); ownSignal.throwIfAborted(); return value;
      } finally {
        try { unlisten(signal, relay); }
        finally {
          try { unlisten(ownSignal, cancel); }
          finally { try { await cleanup(); } finally { if (active === record) active = null; } }
        }
      }
    })().catch(error => {
      // Native loading/rendering may reject with its own cancellation error.
      // This reaction runs only after the first work and cleanup finalizers.
      if (error?.code === 'PRIVACY_CLEANUP') throw error;
      checkSignal(ownSignal); throw error;
    });
    return record.promise;
  }
  return {
    inspect,
    cancel(value) { active?.controller.abort(value); },
    async drained({ retry = false } = {}) { if (active) await Promise.allSettled([active.promise]); await cleanup(retry); },
  };
}

export function createPrivacyPreview({ canvas, ensurePdfJs, pdfjsAssets = {}, lifetime = createPrivacyPdfLifetime() }) {
  if (!canvas?.getContext || typeof ensurePdfJs !== 'function') throw new TypeError('A canvas and PDF loader are required.');
  let controller = null, opening = null;
  function clear() { controller?.abort(); canvas.width = canvas.height = 0; if (canvas.dataset) delete canvas.dataset.pdfPage; }
  return {
    clear,
    async drained(options) { if (opening) await Promise.allSettled([opening]); await lifetime.drained(options); },
    open(bytes, { pageIndex = 0, signal } = {}) {
      try { brandSignal(signal); } catch (error) { return Promise.reject(error); }
      if (opening) return Promise.reject(new DOMException('Another page preview is active.', 'InvalidStateError'));
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > PRIVACY_LIMITS.inputBytes || !Number.isSafeInteger(pageIndex) || pageIndex < 0) return Promise.reject(failure('PREVIEW_INPUT', 'Choose a bounded PDF and page.'));
      controller = new AbortController(); const own = controller, relay = () => own.abort(apply(reason, signal, []));
      const work = (async () => {
        try {
          listen(signal, relay); if (signal != null && apply(aborted, signal, [])) relay();
          await lifetime.drained(); own.signal.throwIfAborted(); const pdfjs = await ensurePdfJs(); own.signal.throwIfAborted();
          const result = await lifetime.inspect(pdfjs, bytes, { signal: own.signal, pdfjsAssets }, async doc => {
            if (!Number.isSafeInteger(doc.numPages) || doc.numPages < 1 || doc.numPages > PRIVACY_LIMITS.pages) throw failure('PAGE_LIMIT', 'Choose a PDF with 1 to 1000 readable pages.');
            const selected = Math.min(pageIndex, doc.numPages - 1), page = await doc.getPage(selected + 1); own.signal.throwIfAborted();
            await renderBoundedPage(page, canvas, { signal: own.signal, scale: 1.5, maxDimension: 900, maxPixels: 4000000 });
            return { pageIndex: selected, pageCount: doc.numPages };
          });
          own.signal.throwIfAborted(); if (canvas.dataset) canvas.dataset.pdfPage = String(result.pageIndex + 1); return result;
        } catch (error) {
          canvas.width = canvas.height = 0; if (canvas.dataset) delete canvas.dataset.pdfPage;
          if (error?.code === 'PRIVACY_CLEANUP') throw error;
          checkSignal(own.signal); throw error;
        }
        finally { try { unlisten(signal, relay); } finally { if (controller === own) controller = null; } }
      })();
      opening = work; work.then(() => { if (opening === work) opening = null; }, () => { if (opening === work) opening = null; }); return work;
    },
  };
}

export function privacyBoundary(priorBoundary, inputLosses = [], { rewrite = false, incomplete = false } = {}) {
  if (priorBoundary && (!plain(priorBoundary) || !['page-copy', 'pdf-rewrite', 'raster-redaction'].includes(priorBoundary.kind) || !Array.isArray(priorBoundary.losses))) throw new TypeError('A finite prior boundary is required.');
  const values = [...(priorBoundary?.losses || []), ...inputLosses, ...(rewrite ? ['signature-rewrite'] : []), ...(incomplete ? ['structure-inspection-incomplete'] : [])];
  if (!Array.isArray(inputLosses) || values.some(code => !BOUNDARY_LOSSES.includes(code))) throw new TypeError('An unsupported rewrite disclosure was supplied.');
  const losses = [...new Set(values)]; if (losses.length > 12) throw failure('BOUNDARY_LIMIT', 'This task exceeds the twelve rewrite disclosures. Keep the current copy.');
  return priorBoundary || losses.length || rewrite ? { kind: rewrite ? 'pdf-rewrite' : priorBoundary?.kind || 'pdf-rewrite', losses } : undefined;
}

export function privacyView(report, { page = 1, offset = 0 } = {}) {
  if (!plain(report) || !Number.isSafeInteger(report.pageCount) || report.pageCount < 0 || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset) || offset < 0) throw new TypeError('A finite privacy report and page are required.');
  const summary = summarizePrivacyReport(report), rows = [];
  const groups = { pageAttachments: report.pageAttachments, annotations: report.annotations, linksAndActions: report.linksAndActions, pageJavaScript: report.javascript, invisibleTextOperations: report.invisibleText };
  for (const [category, group] of Object.entries(groups)) for (const value of (group?.locations || []).slice(0, 100)) {
    if (value.page === page) rows.push({ category, page, ...(Number.isSafeInteger(value.count) && value.count >= 0 ? { count: value.count } : {}) });
  }
  for (const value of (report.sensitiveText?.findings || []).slice(0, 100)) if (value.page === page) rows.push({ category: 'sensitivePatterns', page, pattern: ['email', 'us-ssn', 'payment-card', 'phone'].includes(value.category) ? value.category : 'unknown' });
  const categories = PRIVACY_CATEGORY_KEYS.map(category => {
    const entry = report.inspection?.categories?.[category], status = entry && ['complete', 'partial', 'unknown', 'locked', 'not-inspected'].includes(entry.status) ? entry.status : 'not-inspected';
    return { category, count: Number.isSafeInteger(summary.counts[category]) && summary.counts[category] >= 0 ? summary.counts[category] : 0, status, lowerBound: status !== 'complete', scope: Object.hasOwn(groups, category) || category === 'sensitivePatterns' ? 'page' : 'document', action: category === 'standardMetadata' ? 'standard-metadata' : Object.hasOwn(groups, category) || category === 'sensitivePatterns' ? 'inspect-page' : 'inspect-only' };
  });
  const value = { version: 1, page, pageCount: report.pageCount, categories, rows: rows.slice(offset, offset + PRIVACY_LIMITS.rows), totalRows: rows.length, more: offset + PRIVACY_LIMITS.rows < rows.length, complete: report.inspection?.complete === true };
  if (JSON.stringify(value).length > PRIVACY_LIMITS.reportUnits) throw failure('REPORT_LIMIT', 'The local report exceeds its display limit.');
  return value;
}
