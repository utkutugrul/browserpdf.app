'use strict';
import { DOCTOR_LIMITS, assertDoctorBudget, createDoctorWorkBudget, doctorView, recommendDoctor } from './doctor-policy.js';
import { createDoctorWorkQueue, createDoctorPdfLifetime } from './doctor-lifetime.js';

const own = Object.getOwnPropertyDescriptor, apply = Reflect.apply, then = Promise.prototype.then;
const signalAborted = own(AbortSignal.prototype, 'aborted').get, signalReason = own(AbortSignal.prototype, 'reason').get;
const typed = Object.getPrototypeOf(Uint8Array.prototype), typedBuffer = own(typed, 'buffer').get, typedOffset = own(typed, 'byteOffset').get, typedLength = own(typed, 'byteLength').get;
const tag = own(typed, Symbol.toStringTag).get, backingLength = own(ArrayBuffer.prototype, 'byteLength').get, resizable = own(ArrayBuffer.prototype, 'resizable')?.get, set = Uint8Array.prototype.set;
const clock = Date.now, later = globalThis.setTimeout, stopTimer = globalThis.clearTimeout;
const usageKeys = ['resourceBytes', 'resourceCount', 'artifactBytes', 'expandedBytes', 'expandedCount'];
const checks = ['pageTree', 'boxes', 'metadata', 'attachments', 'annotations', 'actions', 'forms', 'signatures', 'tags', 'language', 'title', 'alt', 'operators', 'text', 'render'];
const emptyUsage = () => Object.fromEntries(usageKeys.map(key => [key, 0]));
const failure = (code, message) => Object.assign(new Error(message), { code: `DOCTOR_${code}` });
function data(value, key) { const d = value && own(value, key); if (!d || !Object.hasOwn(d, 'value')) throw new TypeError('Doctor requires own data controls.'); return d.value; }
function usage(value = {}) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => !usageKeys.includes(key))) throw new TypeError('Invalid Doctor lease.');
  return Object.fromEntries(usageKeys.map(key => { const n = Object.hasOwn(value, key) ? data(value, key) : 0; if (!Number.isSafeInteger(n) || n < 0) throw new TypeError('Invalid Doctor lease scalar.'); return [key, n]; }));
}
const addUsage = (...values) => usage(Object.fromEntries(usageKeys.map(key => [key, values.reduce((sum, value) => sum + value[key], 0)])));
const owner = value => ({ taskId: data(value, 'taskId'), revision: data(value, 'revision'), generation: data(value, 'generation') });
const same = (a, b) => a.taskId === b.taskId && a.revision === b.revision && a.generation === b.generation;
function abort(signal) { if (signal && apply(signalAborted, signal, [])) throw apply(signalReason, signal, []); }
function genuine(value) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); apply(then, value, [resolve, reject]); return promise; }
export function doctorByteLength(bytes, max = DOCTOR_LIMITS.inputBytes) {
  const buffer = apply(typedBuffer, bytes, []), count = apply(typedLength, bytes, []); apply(backingLength, buffer, []);
  if (apply(tag, bytes, []) !== 'Uint8Array' || resizable && apply(resizable, buffer, []) || !count || count > max) throw new RangeError('Doctor input must be a fixed nonempty Uint8Array within 32 MiB.');
  return count;
}
export function doctorInput(bytes, max = DOCTOR_LIMITS.inputBytes) {
  const count = doctorByteLength(bytes, max);
  for (let n = 0; n < Math.min(count - 4, 1024); n++) if (bytes[n] === 37 && bytes[n + 1] === 80 && bytes[n + 2] === 68 && bytes[n + 3] === 70 && bytes[n + 4] === 45) return count;
  throw new TypeError('Doctor input has no bounded PDF header.');
}
function clone(bytes) { const count = doctorByteLength(bytes), out = new Uint8Array(count); apply(set, out, [new Uint8Array(apply(typedBuffer, bytes, []), apply(typedOffset, bytes, []), count)]); return out; }
function observeSize(value) {
  const seen = new Set(), buffers = new Set(), pending = [[value, 0]]; let bytes = 0, nodes = 0;
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (++nodes > DOCTOR_LIMITS.nodes || depth > DOCTOR_LIMITS.depth) throw failure('WORK_LIMIT', 'Native response traversal is incomplete.');
    if (typeof item === 'string') { bytes += item.length * 2; continue; }
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item); bytes += 64;
    if (ArrayBuffer.isView(item)) { const b = item.buffer; if (!buffers.has(b)) { buffers.add(b); bytes += b.byteLength; } continue; }
    if (item instanceof ArrayBuffer) { if (!buffers.has(item)) { buffers.add(item); bytes += item.byteLength; } continue; }
    if (item instanceof Map) { for (const [key, child] of item) { if (pending.length >= DOCTOR_LIMITS.edges - 2) throw failure('WORK_LIMIT', 'Native response traversal is incomplete.'); pending.push([key, depth + 1], [child, depth + 1]); } }
    else for (const key of Reflect.ownKeys(item)) { if (pending.length >= DOCTOR_LIMITS.edges) throw failure('WORK_LIMIT', 'Native response traversal is incomplete.'); const d = own(item, key); if (Object.hasOwn(d, 'value')) pending.push([d.value, depth + 1]); }
    if (pending.length > DOCTOR_LIMITS.edges || !Number.isSafeInteger(bytes)) throw failure('WORK_LIMIT', 'Native response traversal is incomplete.');
  }
  return bytes;
}

// Trusted producer API. Joint callbacks describe all other live owners. SDK
// callers must explicitly select isolated accounting, never a browser default.
export function createDoctorOperationContext(controls) {
  if (!controls || ![Object.prototype, null].includes(Object.getPrototypeOf(controls))) throw new TypeError('Doctor context controls are required.');
  const isolated = Object.hasOwn(controls, 'kind') && data(controls, 'kind') === 'isolated';
  let isolatedRecipient = emptyUsage();
  const localSnapshot = Object.freeze({ taskId: null, revision: 0, generation: 0, retainedBytes: 0, resourceBytes: 0, resourceCount: 0 });
  const callbacks = isolated ? { expectedOwner: localSnapshot, isCurrent: () => true, getUsage: () => ({ snapshot: localSnapshot, live: isolatedRecipient }), admitUsage() {}, registerResult(_value, next) { isolatedRecipient = usage(next); } }
    : Object.fromEntries(['expectedOwner', 'isCurrent', 'getUsage', 'admitUsage', 'registerResult'].map(key => [key, data(controls, key)]));
  if (['isCurrent', 'getUsage', 'admitUsage', 'registerResult'].some(key => typeof callbacks[key] !== 'function')) throw new TypeError('Complete Doctor joint callbacks are required.');
  let active = null, retained = [], opaque = null, publicFailure = null, opaqueLifetime = emptyUsage();
  const isFence = value => value && typeof value === 'object' && ['DOCTOR_CLEANUP', 'DOCTOR_TIMEOUT'].includes(own(value, 'code')?.value);
  function cleanupFence() {
    const held = usage(lifetime.getUsage());
    opaqueLifetime = usage(Object.fromEntries(usageKeys.map(key => [key, Math.max(opaqueLifetime[key], held[key])])));
    opaque ||= failure('CLEANUP', 'Owned cleanup did not acknowledge release. Reload before another operation.');
    queue.cancel(publicFailure || opaque); return publicFailure || opaque;
  }
  function publicationFailure(cause) {
    // An already published deadline or accepted lifetime cleanup stays stable.
    if (publicFailure) return publicFailure;
    const chosen = own(cause || {}, 'code')?.value === 'DOCTOR_CLEANUP' ? cause : opaque || cause;
    if (isFence(chosen)) publicFailure = chosen;
    return chosen;
  }
  const lifetime = createDoctorPdfLifetime();
  const ownUsage = rec => addUsage(...[...rec.leases.values()].map(entry => entry.usage));
  const allUsage = () => { const live = usage(lifetime.getUsage()); return addUsage(...[...retained, ...(active ? [active] : [])].map(ownUsage), usage(Object.fromEntries(usageKeys.map(key => [key, Math.max(live[key], opaqueLifetime[key])])))); };
  function guard(rec, next = allUsage()) {
    if (opaque) throw publicFailure || opaque;
    let current, captured;
    try { current = callbacks.isCurrent(); if (requestCurrent(rec)) current = current && requestCurrent(rec)(); callbacks.admitUsage(next); captured = callbacks.getUsage(); }
    catch (cause) { abort(rec.job.signal); throw cause; }
    const snapshot = data(captured, 'snapshot'), live = usage(data(captured, 'live'));
    assertDoctorBudget(snapshot, live, next); abort(rec.job.signal); rec.job.assertCurrent();
    if (current !== true || !same(rec.expected, owner(snapshot))) throw new DOMException('Doctor ownership changed.', 'AbortError');
    return { snapshot, live };
  }
  const requestCurrent = rec => rec.current;
  const queue = createDoctorWorkQueue(async (request, job) => {
    const rec = { job, current: request.current, started: clock(), expected: owner(request.expected || callbacks.expectedOwner), leases: new Map(), firsts: [], handles: [], resets: [], fenced: false, work: createDoctorWorkBudget(request.limits || DOCTOR_LIMITS) }; active = rec;
    // This observer records actual native FIRSTs without a publication guard.
    // Text cleanup may need it after the operation signal has been revoked.
    async function observeFirst(start, cleanup = false) {
      const started = clock(); let raw, first;
      try { raw = start(); rec.handles.push(raw); first = genuine(raw); rec.firsts.push(first); }
      catch { throw cleanupFence(); }
      const expire = () => { if (!apply(signalAborted, job.signal, [])) queue.cancel(failure('TIMEOUT', 'Doctor phase deadline elapsed.')); };
      const timer = later(expire, DOCTOR_LIMITS.phaseMs);
      try { const value = await first; if (clock() - started >= DOCTOR_LIMITS.phaseMs) expire(); return value; }
      catch (cause) { if (cleanup) throw cleanupFence(); throw cause; }
      finally { stopTimer(timer); }
    }
    function retainResponse(key, value) {
      let bytes;
      try { bytes = observeSize(value); }
      catch (cause) { rec.leases.set(key, { usage: usage({ expandedBytes: 96 * 1024 * 1024, expandedCount: 1 }), handle: value }); throw cause; }
      rec.leases.set(key, { usage: usage({ expandedBytes: bytes, expandedCount: bytes ? 1 : 0 }), handle: value });
      return value;
    }
    const api = Object.freeze({
      signal: job.signal, limits: doctorLimits(request.limits), work: rec.work, guard: () => guard(rec),
      reserve(key, next, handle) {
        next = usage(next); const prior = rec.leases.get(key);
        const old = prior?.usage || emptyUsage(), current = allUsage(), proposed = usage(Object.fromEntries(usageKeys.map(name => [name, current[name] - old[name] + next[name]])));
        guard(rec, proposed); rec.leases.set(key, { usage: next, handle: handle ?? prior?.handle }); return key;
      },
      capture(key, value) { const entry = rec.leases.get(key); if (!entry) throw new TypeError('Reserve a handle before capture.'); entry.handle = value; return value; },
      cleanup(fn) { try { fn(); } catch { opaque ||= failure('CLEANUP', 'Owned cleanup did not acknowledge release. Reload before another operation.'); throw opaque; } },
      hold(key, value, next) {
        // Native return values already exist. Keep them charged even on refusal.
        rec.leases.set(key, { usage: usage(next), handle: value }); guard(rec); return value;
      },
      async copy(bytes, key = Symbol('input')) { const count = doctorByteLength(bytes); api.reserve(key, { artifactBytes: count }); const out = clone(bytes); rec.leases.get(key).handle = out; return out; },
      async first(start, key = Symbol('native'), next = {}) {
        api.reserve(key, next); const value = await observeFirst(start); guard(rec); return value;
      },
      async readText(page) {
        const entry = { stream: null, reader: null, hasStream: false, eof: false, unlockAck: false, cancelAck: false };
        api.reserve(Symbol('text reader'), { expandedBytes: 512, expandedCount: 1 }, entry);
        let items = 0, units = 0;
        try {
          const streamMethod = page.streamTextContent; api.guard();
          if (typeof streamMethod !== 'function') throw failure('UNAVAILABLE', 'Text streaming is unavailable.');
          entry.stream = apply(streamMethod, page, []); entry.hasStream = true;
          const getReader = entry.stream.getReader; api.guard();
          if (typeof getReader !== 'function') throw failure('UNAVAILABLE', 'Text reader is unavailable.');
          entry.reader = apply(getReader, entry.stream, []); api.guard();
          for (;;) {
            const key = Symbol('text chunk'); api.reserve(key, {});
            const read = entry.reader.read; api.guard();
            if (typeof read !== 'function') throw failure('UNAVAILABLE', 'Text reader cannot read.');
            const chunk = await observeFirst(() => apply(read, entry.reader, []));
            rec.leases.get(key).handle = chunk; retainResponse(key, chunk);
            // Validate EOF before any post-ACK signal/owner callback can throw.
            const done = data(chunk, 'done'), value = data(chunk, 'value');
            if (done !== true && done !== false || done && value !== undefined) throw failure('UNAVAILABLE', 'Text reader returned invalid end evidence.');
            entry.eof = done; api.guard();
            if (done) break;
            if (!Array.isArray(value?.items)) throw failure('UNAVAILABLE', 'Text chunk items are unavailable.');
            for (const item of value.items) {
              const text = data(item, 'str');
              if (typeof text !== 'string') throw failure('UNAVAILABLE', 'Text item is unsupported.');
              items++; units += text.length;
              if (items > api.limits.textItemsPerPage || units > api.limits.textUnitsPerPage) throw failure('WORK_LIMIT', 'Text page limit reached.');
              api.work.admit({ textItems: 1, textUnits: text.length });
            }
          }
          return { items, units };
        } finally {
          // Cancel and unlock are independent acknowledgements. Neither an
          // aborted signal nor rejected cancel FIRST can bypass lock release.
          try {
            if (entry.hasStream && !entry.eof) {
              const handle = entry.reader || entry.stream, cancel = handle.cancel;
              if (typeof cancel !== 'function') throw cleanupFence();
              const reason = Object.freeze(new Error('Doctor text stream stopped before validated EOF.'));
              await observeFirst(() => apply(cancel, handle, [reason]), true); entry.cancelAck = true;
            }
          } catch { throw cleanupFence(); }
          finally {
            if (entry.reader) {
              try { const release = entry.reader.releaseLock; if (typeof release !== 'function') throw cleanupFence(); apply(release, entry.reader, []); entry.unlockAck = true; }
              catch { throw cleanupFence(); }
            }
          }
        }
      },
      sync(handle, methodName, args = []) { const method = handle[methodName]; api.guard(); if (typeof method !== 'function') throw failure('UNAVAILABLE', 'This public operation is unavailable.'); const value = apply(method, handle, args); api.guard(); return value; },
      async call(handle, methodName, args = [], scope) {
        const method = handle[methodName]; api.guard();
        if (typeof method !== 'function') throw failure('UNAVAILABLE', 'This public native operation is unavailable.');
        return scope ? scope.work(() => apply(method, handle, args), {}) : api.first(() => apply(method, handle, args));
      },
      async response(start) {
        const key = Symbol('response'); const value = await api.first(start, key, {});
        retainResponse(key, value); guard(rec); return value;
      },
      resetAfterDrain(fn) { if (typeof fn !== 'function') throw new TypeError('Reset callback required.'); rec.resets.push(fn); },
      async inspectPdf(pdfjs, bytes, assets, fn) {
        return lifetime.inspect(pdfjs, bytes, { signal: job.signal, pdfjsAssets: assets, expectedOwner: rec.expected,
          isCurrent: () => callbacks.isCurrent() && (!rec.current || rec.current()),
          admitUsage: next => callbacks.admitUsage(addUsage(ownUsage(rec), ...retained.map(ownUsage), usage(next))),
          getUsage: () => { const captured = callbacks.getUsage(); return { snapshot: data(captured, 'snapshot'), live: addUsage(usage(data(captured, 'live')), ownUsage(rec), ...retained.map(ownUsage)) }; },
        }, fn);
      },
      registerResult(value, next) { guard(rec); callbacks.registerResult(value, Object.freeze(usage(next))); guard(rec); return value; },
    });
    let result, rejected = false, cause;
    try { guard(rec); result = await request.start(job, api); guard(rec); }
    catch (error) { rejected = true; cause = error; }
    finally {
      await Promise.allSettled(rec.firsts);
      try { await lifetime.drained(); } catch (error) { rejected = true; cause = error; rec.fenced = true; }
      if (opaque) { rejected = true; cause = publicationFailure(cause); }
      if (opaque || cause?.code === 'DOCTOR_CLEANUP' || clock() - rec.started >= DOCTOR_LIMITS.operationMs) rec.fenced = true;
      if (rec.fenced) retained.push(rec);
      else {
        try { for (const reset of rec.resets) reset(); }
        catch { opaque ||= failure('CLEANUP', 'Owned surface cleanup failed. Reload before another operation.'); rec.fenced = true; retained.push(rec); rejected = true; cause = opaque; }
        if (!rec.fenced) { rec.leases.clear(); rec.handles.length = rec.firsts.length = 0; }
      }
      if (active === rec) active = null;
    }
    if (rejected) throw cause; guard(rec); return result;
  });
  return Object.freeze({
    run(start, { expectedOwner, limits, signal, isCurrent } = {}) {
      if (opaque) return Promise.reject(publicationFailure(opaque));
      if (typeof start !== 'function') return Promise.reject(new TypeError('Doctor run requires an async producer.'));
      try { if (signal != null) apply(signalAborted, signal, []); } catch (cause) { return Promise.reject(cause); }
      if (isCurrent !== undefined && typeof isCurrent !== 'function') return Promise.reject(new TypeError('Doctor intent guard must be callable.'));
      const first = queue.submit({ start, expected: expectedOwner, limits, current: isCurrent });
      const listener = () => queue.cancel(apply(signalReason, signal, []));
      if (signal != null) { apply(EventTarget.prototype.addEventListener, signal, ['abort', listener, { once: true }]); if (apply(signalAborted, signal, [])) listener(); }
      return first.catch(cause => { throw publicationFailure(cause); }).finally(() => { if (signal != null) apply(EventTarget.prototype.removeEventListener, signal, ['abort', listener]); });
    },
    cancel: reason => queue.cancel(reason), getUsage: () => Object.freeze(allUsage()),
    async drained(options = {}) {
      if (opaque) throw publicationFailure(opaque);
      try { await queue.drained(options); await lifetime.drained(options); }
      catch (cause) { throw publicationFailure(cause); }
      if (options.retry) { for (const rec of retained) { for (const reset of rec.resets) reset(); rec.leases.clear(); rec.handles.length = rec.firsts.length = 0; } retained = []; publicFailure = null; }
    },
  });
}

export function doctorLimits(limits = {}) { createDoctorWorkBudget(limits); return Object.freeze({ ...DOCTOR_LIMITS, ...limits }); }
export async function doctorParse(bytes, pdfLib, api, limits = DOCTOR_LIMITS) {
  const parse = async strict => { const copy = await api.copy(bytes); return api.call(pdfLib.PDFDocument, 'load', [copy, { ignoreEncryption: false, throwOnInvalidObject: strict, updateMetadata: false, parseSpeed: 100 }]); };
  let strict, tolerant, doc, locked = false;
  try { doc = await parse(true); strict = { status: 'ok', reason: 'none' }; tolerant = { status: 'skipped', reason: 'not-requested' }; }
  catch (cause) {
    api.guard(); if (cause?.code?.startsWith('DOCTOR_')) throw cause;
    locked = typeof pdfLib.EncryptedPDFError === 'function' && cause instanceof pdfLib.EncryptedPDFError;
    strict = { status: locked ? 'locked' : 'failed', reason: locked ? 'password-required' : 'strict-rejected' }; tolerant = { status: 'skipped', reason: 'not-requested' };
    if (!locked) { try { doc = await parse(false); tolerant = { status: 'ok', reason: 'tolerant-opened' }; } catch (error) { api.guard(); if (error?.code?.startsWith('DOCTOR_')) throw error; locked = typeof pdfLib.EncryptedPDFError === 'function' && error instanceof pdfLib.EncryptedPDFError; tolerant = { status: locked ? 'locked' : 'failed', reason: locked ? 'password-required' : 'strict-rejected' }; } }
  }
  if (doc && (!Number.isSafeInteger(api.sync(doc, 'getPageCount')) || api.sync(doc, 'getPageCount') < 1 || api.sync(doc, 'getPageCount') > limits.pages)) throw failure('WORK_LIMIT', 'Doctor page limit reached.');
  return { doc, strict, tolerant, locked };
}
function state(status = 'complete', count = 0) { return { status, count, lowerBound: status === 'partial', pages: [] }; }
function graph(doc, pdfLib, api) {
  if (!pdfLib.PDFName || !pdfLib.PDFDict || !pdfLib.PDFArray || !pdfLib.PDFRef || !doc?.catalog || !doc.context) return null;
  const name = key => api.sync(pdfLib.PDFName, 'of', [key]), get = (dict, key) => api.sync(dict, 'get', [name(key)]);
  const present = raw => {
    if (raw == null) return false;
    const value = api.sync(raw, 'decodeText');
    if (typeof value !== 'string' || value.length > api.limits.textUnitsPerPage) throw failure('WORK_LIMIT', 'Structure string limit reached.');
    api.work.admit({ textUnits: value.length }); return !!value.trim();
  };
  const root = get(doc.catalog, 'StructTreeRoot');
  const result = { tags: root ? 1 : 0, language: Number(present(get(doc.catalog, 'Lang'))), alt: 0, figures: 0, withAlt: 0 };
  const seen = new Set(), refs = new Set(), stack = [[root, 0]];
  while (stack.length) {
    const [value, depth] = stack.pop(); if (!value || typeof value !== 'object') continue;
    if (depth > api.limits.depth) throw failure('WORK_LIMIT', 'Structure depth limit reached.');
    if (value instanceof pdfLib.PDFRef) { const key = String(value); if (refs.has(key)) continue; refs.add(key); api.work.admit({ nodes: 1, edges: 1 }); stack.push([api.sync(doc.context, 'lookup', [value]), depth + 1]); continue; }
    if (seen.has(value)) continue; seen.add(value); api.work.admit({ nodes: 1 });
    if (value instanceof pdfLib.PDFArray) { for (let n = 0; n < api.sync(value, 'size'); n++) { api.work.admit({ edges: 1 }); stack.push([api.sync(value, 'get', [n]), depth + 1]); } }
    else if (value instanceof pdfLib.PDFDict) {
      if (String(get(value, 'S')) === '/Figure') { result.figures++; if (present(get(value, 'Alt'))) result.withAlt++; else result.alt++; }
      for (const [, child] of api.sync(value, 'entries')) { api.work.admit({ edges: 1 }); stack.push([child, depth + 1]); }
    }
    api.guard();
  }
  return result;
}
function legacy(inspection, features, readiness, errors, parsedCount) {
  const ok = key => inspection.parsers[key].status === 'ok';
  const warnings = [];
  if (errors.length) warnings.push('Some checks are incomplete. Read inspection coverage; zero legacy values do not establish absence.');
  if (!ok('strict') && ok('tolerant')) warnings.push('Strict parsing failed; tolerant parsing opened the input.');
  if (inspection.checks.pageTree.count) warnings.push('The parsers disagree about page count.');
  if (inspection.checks.boxes.count) warnings.push('Invalid or inconsistent page boxes were detected.');
  if (features.signatureFields) warnings.push('Any rewrite can invalidate digital signatures; validity is not checked.');
  return { version: 1, mode: inspection.mode, pageCount: inspection.pageCount || 0,
    parses: { pdfLibStrict: { ok: ok('strict') }, pdfLibTolerant: { ok: ok('tolerant') }, pdfjsStrict: { ok: ok('pdfjs') } },
    pageTree: { pdfLibCount: parsedCount, pdfjsCount: ok('pdfjs') ? inspection.pageCount || 0 : 0, consistent: inspection.checks.pageTree.status === 'complete' && inspection.checks.pageTree.count === 0 },
    pageBoxes: { issueCount: inspection.checks.boxes.count || 0, locations: inspection.checks.boxes.pages.map(page => ({ page })), truncated: inspection.checks.boxes.lowerBound },
    features, accessibilityReadiness: readiness, inspectionErrors: { count: errors.length, categories: [...new Set(errors)].slice(0, 30), locations: [], truncated: false },
    deep: { performed: inspection.mode === 'deep', pagesChecked: inspection.coverage.pagesChecked, operatorErrors: errors.filter(key => key === 'operators').length, textErrors: errors.filter(key => key === 'text').length, renderErrors: errors.filter(key => key === 'render').length, locations: [] },
    warnings,
    limitations: ['Bounded diagnostic signals only; no repair, accessibility, security or signature-validity guarantee.'], inspection };
}
export async function diagnoseDoctorWithin(bytes, options, api) {
  const { mode = 'quick', pdfLib, pdfjs, pdfjsAssets = {}, createCanvas, onProgress } = options, limits = doctorLimits(options.limits);
  if (!['quick', 'deep'].includes(mode) || !pdfLib?.PDFDocument || !pdfjs?.getDocument) throw new TypeError('Doctor mode and peer runtimes are required.');
  doctorInput(bytes, limits.inputBytes); api.reserve(Symbol('report'), { expandedBytes: 2304000, expandedCount: 2 });
  const parsed = await doctorParse(bytes, pdfLib, api, limits), parsedCount = parsed.doc ? api.sync(parsed.doc, 'getPageCount') : 0, errors = [];
  const report = { version: 2, mode, status: 'unknown', pageCount: null, parsers: { strict: parsed.strict, tolerant: parsed.tolerant, pdfjs: { status: 'unknown', reason: 'native-failed' } }, checks: Object.fromEntries(checks.map(key => [key, state('unknown', null)])), recommendation: { remedy: 'unknown', reason: 'native-failed' }, coverage: { pagesChecked: 0, renderedPages: [], omitted: 0, complete: false } };
  const features = { encrypted: parsed.locked, locked: false, permissions: 0, standardMetadata: 0, xmp: 0, catalogAttachments: 0, pageAttachments: 0, annotations: 0, linksAndActions: 0, documentJavaScript: 0, pageJavaScript: 0, forms: 0, calculationOrder: 0, signatureFields: 0 };
  const readiness = { structureTreePresent: false, markInfoMarked: false, languagePresent: false, titlePresent: false, figureCount: 0, figuresWithAlt: 0, figuresMissingAlt: 0, graphTruncated: false };
  const incomplete = key => { errors.push(key); report.checks[key] = state('unknown', null); };
  const mark = (key, page) => { const check = report.checks[key], list = check.pages; if (list.includes(page)) return; if (list.length < limits.locations) list.push(page); else { report.coverage.omitted++; if (check.status === 'complete' || check.status === 'partial') { check.status = 'partial'; check.lowerBound = true; } } };
  async function read(key, start, use) { try { const value = await api.response(start); use(value); api.guard(); } catch (cause) { api.guard(); if (cause?.code === 'DOCTOR_CLEANUP' || cause?.code === 'DOCTOR_TIMEOUT' || cause?.code === 'DOCTOR_BUDGET') throw cause; incomplete(key); } }
  if (parsed.doc) {
    const pages = api.sync(parsed.doc, 'getPages'); if (!Array.isArray(pages) || pages.length !== api.sync(parsed.doc, 'getPageCount') || pages.length > limits.pages) throw failure('WORK_LIMIT', 'Parser pages are inconsistent.'); let boxes = 0;
    for (let n = 0; n < pages.length; n++) { api.work.admit({ pageVisits: 1 }); const media = api.sync(pages[n], 'getMediaBox'), crop = api.sync(pages[n], 'getCropBox'); if (![media.x, media.y, media.width, media.height, crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || media.width <= 0 || media.height <= 0 || crop.width <= 0 || crop.height <= 0 || crop.x < media.x || crop.y < media.y || crop.x + crop.width > media.x + media.width || crop.y + crop.height > media.y + media.height) { boxes++; if (report.checks.boxes.pages.length < limits.locations) report.checks.boxes.pages.push(n + 1); else report.coverage.omitted++; } api.guard(); }
    const affected = report.checks.boxes.pages; report.checks.boxes = { ...state(boxes > limits.locations ? 'partial' : 'complete', boxes), pages: affected };
    try { const g = graph(parsed.doc, pdfLib, api); if (g) { for (const key of ['tags', 'language', 'alt']) report.checks[key] = state('complete', g[key]); readiness.structureTreePresent = !!g.tags; readiness.languagePresent = !!g.language; readiness.figuresMissingAlt = g.alt; readiness.figureCount = g.figures; readiness.figuresWithAlt = g.withAlt; } } catch (cause) { api.guard(); for (const key of ['tags', 'language', 'alt']) incomplete(key); readiness.graphTruncated = true; }
  }
  try {
    await api.inspectPdf(pdfjs, bytes, pdfjsAssets, async (doc, scope) => {
      if (doc.numPages > limits.pages) throw failure('WORK_LIMIT', 'Doctor page limit reached.');
      report.pageCount = doc.numPages; report.parsers.pdfjs = { status: 'ok', reason: 'none' };
      report.checks.pageTree = parsed.doc ? state('complete', api.sync(parsed.doc, 'getPageCount') === doc.numPages ? 0 : 1) : state('unknown', null);
      await read('metadata', () => api.call(doc, 'getMetadata', [], scope), value => { features.standardMetadata = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'].filter(key => value?.info?.[key] != null && String(value.info[key]).trim()).length; features.xmp = value?.metadata?.getRaw?.()?.trim() ? 1 : 0; report.checks.metadata = state('complete', features.standardMetadata + features.xmp); readiness.titlePresent = !!value?.info?.Title; report.checks.title = state('complete', Number(readiness.titlePresent)); });
      await read('attachments', () => api.call(doc, 'getAttachments', [], scope), value => { features.catalogAttachments = value instanceof Map ? value.size : value ? Object.keys(value).length : 0; report.checks.attachments = state('complete', features.catalogAttachments); });
      await read('actions', () => api.call(doc, 'getJSActions', [], scope), value => { features.documentJavaScript = value ? Object.values(value).reduce((n, list) => n + (Array.isArray(list) ? list.length : 1), 0) : 0; report.checks.actions = state('complete', features.documentJavaScript); });
      await read('actions', () => api.call(doc, 'getOpenAction', [], scope), value => { if (value) { features.linksAndActions++; if (report.checks.actions.count !== null) report.checks.actions.count++; } });
      await read('forms', () => api.call(doc, 'getFieldObjects', [], scope), value => { const entries = value instanceof Map ? [...value.values()] : Object.values(value || {}); let widgets = 0; for (const group of entries) { const fields = Array.isArray(group) ? group : [group]; widgets += fields.length; features.signatureFields += fields.filter(field => ['Sig', 'signature'].includes(field?.type)).length; } api.work.admit({ widgets }); if (widgets > limits.widgets || entries.length > limits.widgets) throw failure('WORK_LIMIT', 'Field limit reached.'); features.forms = entries.length; report.checks.forms = state('complete', entries.length); report.checks.signatures = state('complete', features.signatureFields); });
      await read('forms', () => api.call(doc, 'getCalculationOrderIds', [], scope), value => { if (value != null && (!Array.isArray(value) || value.length > limits.widgets)) throw failure('WORK_LIMIT', 'Calculation order limit reached.'); features.calculationOrder = value?.length || 0; });
      if (typeof doc.getMarkInfo === 'function') await read('tags', () => api.call(doc, 'getMarkInfo', [], scope), value => { readiness.markInfoMarked = value?.Marked === true; });
      await read('actions', () => api.call(doc, 'getPermissions', [], scope), value => { features.permissions = Array.isArray(value) ? value.length : 0; features.encrypted ||= Array.isArray(value); });
      for (const key of ['annotations']) report.checks[key] = state('complete', 0);
      if (mode === 'quick') for (const key of ['operators', 'text', 'render']) report.checks[key] = state('skipped', null);
      else for (const key of ['operators', 'text', 'render']) report.checks[key] = state('complete', 0);
      for (let n = 1; n <= doc.numPages; n++) {
        api.work.admit({ pageVisits: 1 });
        await scope.withPage(n, async (page, pageScope) => {
          await read('annotations', () => api.call(page, 'getAnnotations', [{ intent: 'display' }], scope), list => { if (!Array.isArray(list) || list.length > limits.annotationsPerPage) throw failure('WORK_LIMIT', 'Annotation limit reached.'); api.work.admit({ annotations: list.length }); features.annotations += list.length; if (list.length) mark('annotations', n); if (report.checks.annotations.count !== null) report.checks.annotations.count += list.length; for (const item of list) { if (item.subtype === 'FileAttachment') { features.pageAttachments++; mark('attachments', n); if (report.checks.attachments.count !== null) report.checks.attachments.count++; } if (item.url || item.unsafeUrl || item.action || item.dest) { features.linksAndActions++; mark('actions', n); if (report.checks.actions.count !== null) report.checks.actions.count++; } } });
          await read('actions', () => api.call(page, 'getJSActions', [], scope), value => { const count = value ? Object.values(value).reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 1), 0) : 0; features.pageJavaScript += count; if (count) mark('actions', n); if (report.checks.actions.count !== null) report.checks.actions.count += count; });
          if (typeof page.getStructTree === 'function') await read('tags', () => api.call(page, 'getStructTree', [], scope), value => { if (value && report.checks.tags.count === 0) { incomplete('tags'); incomplete('alt'); } });
          if (options.verifyPage) { await options.verifyPage(page, pageScope, n); api.guard(); }
          if (mode === 'deep') {
            await read('operators', () => api.call(page, 'getOperatorList', [], scope), list => { const count = list?.fnArray?.length; if (!Number.isSafeInteger(count) || count > limits.operatorsPerPage) throw failure('WORK_LIMIT', 'Operator limit reached.'); api.work.admit({ operators: count }); if (report.checks.operators.count !== null) report.checks.operators.count += count; });
            await read('text', () => scope.work(() => api.readText(page), {}), value => { if (report.checks.text.count !== null) report.checks.text.count += value.items; });
            await read('render', async () => { const base = api.sync(page, 'getViewport', [{ scale: 1 }]), scale = Math.min(0.35, limits.renderDimension / base.width, limits.renderDimension / base.height, Math.sqrt(limits.renderPixels / (Math.ceil(base.width) * Math.ceil(base.height)))); const viewport = api.sync(page, 'getViewport', [{ scale }]), width = Math.ceil(viewport.width), height = Math.ceil(viewport.height); if (!Number.isSafeInteger(width * height) || width < 1 || height < 1 || width > limits.renderDimension || height > limits.renderDimension || width * height > limits.renderPixels) throw failure('GEOMETRY', 'Diagnostic canvas is out of bounds.'); api.work.admit({ pixels: width * height }); const key = Symbol('canvas'); api.reserve(key, { expandedBytes: width * height * 4, expandedCount: 1 }); if (typeof createCanvas !== 'function') throw new TypeError('Deep diagnosis needs a canvas factory.'); const canvas = createCanvas(width, height); api.capture(key, canvas); api.resetAfterDrain(() => { canvas.width = canvas.height = 0; }); const actualWidth = canvas.width, actualHeight = canvas.height; if (!Number.isSafeInteger(actualWidth) || !Number.isSafeInteger(actualHeight) || actualWidth < 1 || actualHeight < 1 || !Number.isSafeInteger(actualWidth * actualHeight * 4)) throw failure('GEOMETRY', 'Canvas factory returned invalid backing dimensions.'); api.hold(key, canvas, { expandedBytes: actualWidth * actualHeight * 4, expandedCount: 1 }); if (actualWidth !== width || actualHeight !== height) throw failure('GEOMETRY', 'Canvas factory changed the requested backing size.'); await pageScope.render({ canvasContext: canvas.getContext('2d'), viewport }); return null; }, () => { if (report.checks.render.count !== null) report.checks.render.count++; if (report.coverage.renderedPages.length < limits.locations) report.coverage.renderedPages.push(n); else { report.coverage.omitted++; report.checks.render.status = 'partial'; report.checks.render.lowerBound = true; } });
          }
        });
        report.coverage.pagesChecked++; api.guard(); onProgress?.({ page: n, pageCount: doc.numPages, mode }); api.guard();
      }
      const incompleteChecks = Object.values(report.checks).some(check => !['complete', 'skipped'].includes(check.status));
      report.coverage.complete = errors.length === 0 && report.coverage.omitted === 0 && report.coverage.pagesChecked === doc.numPages && !incompleteChecks;
      report.status = report.coverage.complete ? 'complete' : 'partial';
      report.recommendation = recommendDoctor(report); doctorView(report); return report;
    });
  } catch (cause) {
    api.guard(); if (cause?.code?.startsWith('DOCTOR_')) throw cause;
    const locked = typeof pdfjs.PasswordException === 'function' && cause instanceof pdfjs.PasswordException;
    report.parsers.pdfjs = { status: locked ? 'locked' : 'failed', reason: locked ? 'password-required' : 'pdfjs-rejected' }; features.locked = locked; features.encrypted ||= locked; report.status = locked ? 'locked' : 'unknown';
  }
  if (!Object.isFrozen(report)) { report.recommendation = recommendDoctor(report); doctorView(report); }
  return legacy(report, features, readiness, errors, parsedCount);
}
export function diagnosePdf(bytes, options = {}) {
  if (!options.context) return Promise.reject(new TypeError('Doctor requires an explicit joint or SDK isolated context.'));
  return options.context.run(async (_job, api) => { const result = await diagnoseDoctorWithin(bytes, options, api); api.registerResult(result, { expandedBytes: 2304000, expandedCount: 2 }); return result; }, { limits: options.limits, expectedOwner: options.expectedOwner, signal: options.signal });
}
export function summarizeDoctorReport(report) {
  return { version: report.version, mode: report.mode, pageCount: report.pageCount, parses: Object.fromEntries(Object.entries(report.parses).map(([key, value]) => [key, !!value.ok])), pageTreeConsistent: !!report.pageTree.consistent, pageBoxIssues: report.pageBoxes.issueCount, features: { ...report.features }, readiness: { ...report.accessibilityReadiness }, inspectionErrors: { count: report.inspectionErrors.count, categories: [...report.inspectionErrors.categories], truncated: report.inspectionErrors.truncated }, deep: { ...report.deep }, warningCount: report.warnings.length, inspection: report.inspection };
}
