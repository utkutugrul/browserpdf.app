'use strict';

export const COMPRESS_INTAKE_LIMITS = Object.freeze({ bytes: 80 * 1024 * 1024, inheritedBytes: 250 * 1024 * 1024, pages: 250, inheritedPages: 10000 });
export const sameCompressOwner = (a, b) => a?.taskId === b?.taskId && a?.revision === b?.revision && a?.generation === b?.generation;
const cancelled = () => new DOMException('This PDF selection was replaced or cleared.', 'AbortError');
const copy = (bytes) => { const owned = new Uint8Array(bytes.byteLength); Uint8Array.prototype.set.call(owned, bytes); return owned; };
const knownCapabilities = (value) => Object.fromEntries(['encrypted', 'searchable', 'forms', 'rasterized'].filter((key) => typeof value?.[key] === 'boolean').map((key) => [key, value[key]]));

// Runtime and canonical session are injected. No engine, DOM, descriptor store,
// or shared fixture belongs to the idle entry graph.
export function createCompressIntake({ session, ensureSession, ensurePdfLib, ensurePdfJs, pdfjsAssets = {}, lane }) {
  let running = false, pending = null;
  let cleanupFailure = null;
  const retainedTasks = new Map();
  async function release(task) {
    let promise = retainedTasks.get(task);
    if (!promise) { promise = Promise.resolve().then(() => task.destroy()); retainedTasks.set(task, promise); promise.catch(() => {}); }
    try { await promise; retainedTasks.delete(task); }
    catch (cause) { retainedTasks.set(task, null); const error = new Error(`PDF preview cleanup failed: ${cause.message}`, { cause }); error.code = 'COMPRESS_NATIVE_CLEANUP'; cleanupFailure = error; throw error; }
  }
  async function drainRetained() { for (const task of [...retainedTasks.keys()]) await release(task); }
  function reportCleanupFailure() { if (cleanupFailure) { const error = cleanupFailure; cleanupFailure = null; throw error; } }
  async function validate(file, options) {
    const { signal, isCurrent, expectedOwner, allowInheritedReadonly = false } = options;
    const check = () => { signal?.throwIfAborted(); if (!isCurrent() || !sameCompressOwner(session.snapshot(), expectedOwner)) throw cancelled(); };
    check();
    reportCleanupFailure();
    await drainRetained(); check();
    const inherited = allowInheritedReadonly && typeof file.browserpdfSession?.taskId === 'string' ? file.browserpdfSession : null;
    const maxBytes = inherited ? COMPRESS_INTAKE_LIMITS.inheritedBytes : COMPRESS_INTAKE_LIMITS.bytes;
    if (file.type !== 'application/pdf' && !String(file.name).toLowerCase().endsWith('.pdf')) throw new TypeError('Please select a PDF file.');
    if (!Number.isSafeInteger(file.size) || file.size < 5 || file.size > maxBytes) throw new RangeError(`Choose a non-empty PDF of at most ${inherited ? 250 : 80} MiB. The current task was retained.`);
    const buffer = await file.arrayBuffer(); check();
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 5 || buffer.byteLength > maxBytes) throw new RangeError('The PDF bytes exceed this selection limit. The current task was retained.');
    const bytes = new Uint8Array(buffer);
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new TypeError('This file does not contain a PDF header. The current task was retained.');
    const pdfLib = await ensurePdfLib(); check();
    let libDocument, libLocked = false;
    try { libDocument = await pdfLib.PDFDocument.load(copy(bytes), { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false }); }
    catch (error) {
      check(); if (!inherited) throw error;
      // Pinned pdf-lib's ES5 Error subclass does not preserve instanceof.
      // Establish encryption through the public parsed-document flag instead
      // of class identity or matching an exception message.
      let probe;
      try { probe = await pdfLib.PDFDocument.load(copy(bytes), { ignoreEncryption: true, throwOnInvalidObject: true, updateMetadata: false }); }
      catch { check(); throw error; }
      check(); if (probe.isEncrypted !== true) throw error;
      libLocked = true;
    }
    check();
    const pdfjs = await ensurePdfJs(); check();
    let task, destruction, pageCount = null, locked = false, failure;
    const destroy = () => { if (task) destruction ||= release(task); destruction?.catch(() => {}); return destruction; };
    const abort = () => { void destroy(); };
    try {
      task = pdfjs.getDocument({ data: copy(bytes), ...pdfjsAssets, stopAtErrors: true, enableXfa: false });
      retainedTasks.set(task, null);
      signal?.addEventListener('abort', abort, { once: true });
      check();
      const doc = await task.promise; check();
      pageCount = doc.numPages;
      if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('The PDF does not have a finite readable page count. The current task was retained.');
      // Encrypt is still proof of encryption when PDF.js can derive the empty
      // user-password key. Such inherited bytes are retained, never optimized.
      if (libLocked) locked = true;
      else if (!libDocument || pageCount !== libDocument.getPageCount()) throw new Error('The PDF parsers disagree about its page structure. The current task was retained.');
      if (pageCount > (inherited ? COMPRESS_INTAKE_LIMITS.inheritedPages : COMPRESS_INTAKE_LIMITS.pages)) throw new RangeError(`This PDF exceeds the ${inherited ? 10000 : 250}-page selection limit. The current task was retained.`);
    } catch (error) {
      // A matching public PasswordException is evidence; message text is not.
      if (inherited && (error?.name === 'PasswordException' || (pdfjs.PasswordException && error instanceof pdfjs.PasswordException))) locked = true;
      else failure = error;
    } finally {
      signal?.removeEventListener('abort', abort);
      try { await destroy(); } catch (error) { failure = error; }
    }
    if (failure) throw failure;
    check();
    await ensureSession(); check();
    const capabilities = { ...knownCapabilities((inherited || file.browserpdfSession)?.capabilities), encrypted: locked };
    const restored = inherited || file.browserpdfSession || {};
    // begin performs the inherited original/history/resource admission before
    // its synchronous commit. There is no speculative owner or adoption.
    const owner = session.begin(bytes, file.name, { ...restored, type: 'application/pdf', capabilities });
    if (!owner || typeof owner.then === 'function') throw new Error('Compression requires the initialized synchronous document session.');
    const current = session.current();
    const reason = locked ? 'locked' : bytes.byteLength > COMPRESS_INTAKE_LIMITS.bytes ? 'bytes' : pageCount > COMPRESS_INTAKE_LIMITS.pages ? 'pages' : null;
    return { bytes: current.bytes, name: current.name, displayName: current.displayName, type: current.type, capabilities: current.capabilities, boundary: current.boundary, pageCount, owner, readOnly: !!reason, reason };
  }
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const job = pending; pending = null;
        try { job.resolve(await lane.run(() => validate(job.file, job.options), { signal: job.options.signal })); }
        catch (error) { job.reject(error); }
        finally { job.detach(); }
      }
    } finally { running = false; }
  }
  return {
    async drained() { await lane.drained(); reportCleanupFailure(); await drainRetained(); },
    stage(file, options) {
      if (!file || typeof options?.isCurrent !== 'function' || !options.expectedOwner) return Promise.reject(new TypeError('An owned PDF selection is required.'));
      if (pending) { pending.detach(); pending.reject(cancelled()); pending = null; }
      return new Promise((resolve, reject) => {
        const abort = () => { if (pending === job) { pending = null; job.detach(); reject(cancelled()); } };
        const job = { file, options, resolve, reject, detach: () => options.signal?.removeEventListener('abort', abort) };
        pending = job; options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        void pump();
      });
    },
  };
}
