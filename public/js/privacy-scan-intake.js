import { ensurePdfJs, PDFJS_ASSET_URLS } from './lib-loader.js';
import { withPdfDocument } from './core/privacy-scan.js';
import { checkPdfMagicBytes, looksLikePdfFile, documentSession, ensureDocumentSession } from './tool-ui.js';

const MAX_BYTES = 250 * 1000 * 1000;
const cancelled = () => new DOMException('This PDF selection was replaced or cleared.', 'AbortError');
const sameOwner = (a, b) => a.taskId === b.taskId && a.revision === b.revision && a.generation === b.generation;

/**
 * Lazy, transactionally admitted Privacy intake.
 * createPrivacyIntake().stage(file, { signal, isCurrent, expectedOwner }) resolves
 * { name, size, bytes, owner } after its own guarded synchronous begin only.
 * One active File read/parser must drain before the latest pending descriptor
 * starts; replacing pending work never allocates its bytes. Initial workflow
 * descriptor retrieval belongs outside this lane, so it cannot delay native B.
 */
export function createPrivacyIntake() {
  let running = false, pending = null;
  async function validate(file, { signal, isCurrent, expectedOwner }) {
    const check = () => { signal?.throwIfAborted(); if (!isCurrent() || !sameOwner(documentSession.snapshot(), expectedOwner)) throw cancelled(); };
    check();
    if (!looksLikePdfFile(file)) throw new TypeError('Please select a PDF file.');
    if (file.size > MAX_BYTES) throw new RangeError('Choose a PDF smaller than 250 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer()); check();
    if (bytes.length > MAX_BYTES) throw new RangeError('Choose a PDF smaller than 250 MB.');
    if (!checkPdfMagicBytes(bytes)) throw new TypeError('This file does not look like a valid PDF.');
    const pdfjs = await ensurePdfJs(); check();
    let locked = false;
    try {
      // Reuse the scanner's documented task/document destruction on all paths.
      await withPdfDocument(pdfjs, bytes, { signal, pdfjsAssets: PDFJS_ASSET_URLS }, (doc) => {
        check(); if (!Number.isSafeInteger(doc.numPages) || doc.numPages < 1) throw new Error('This PDF has no readable pages.');
      });
      check();
    } catch (error) {
      check();
      // An error message mentioning encryption is not proof of a locked PDF.
      if (error?.name !== 'PasswordException' && !(pdfjs.PasswordException && error instanceof pdfjs.PasswordException)) throw error;
      locked = true;
    }
    await ensureDocumentSession(); check();
    const inherited = file.browserpdfSession || {};
    const capabilities = { ...inherited.capabilities, ...(locked ? { encrypted: true } : {}) };
    // begin validates the entire inherited original/history/scene/resources and
    // joint limits before replacing the last usable task. No workspace rebake.
    const owner = documentSession.begin(bytes, file.name, { ...inherited, type: 'application/pdf', capabilities });
    return { name: file.name.slice(0, 160), size: bytes.length, bytes, owner };
  }
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const job = pending; pending = null;
        try { job.resolve(await validate(job.file, job.options)); } catch (error) { job.reject(error); }
        finally { job.detach(); }
      }
    } finally { running = false; }
  }
  return {
    stage(file, options) {
      if (!file || typeof options?.isCurrent !== 'function' || !options.expectedOwner) return Promise.reject(new TypeError('An owned PDF selection is required.'));
      if (pending) { pending.detach(); pending.reject(cancelled()); pending = null; }
      return new Promise((resolve, reject) => {
        const abort = () => { if (pending === job) { pending = null; job.detach(); reject(cancelled()); } };
        const job = { file, options, resolve, reject, detach: () => options.signal?.removeEventListener('abort', abort) };
        pending = job; options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        void drain();
      });
    },
  };
}
