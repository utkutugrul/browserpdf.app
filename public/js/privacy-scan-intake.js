import { ensurePdfJs, PDFJS_ASSET_URLS } from './lib-loader.js';
import { withPdfDocument } from './core/privacy-scan.js';
import { checkPdfMagicBytes, looksLikePdfFile, documentSession, ensureDocumentSession } from './tool-ui.js';

const MAX_BYTES = 250 * 1000 * 1000;
const cancelled = () => new DOMException('This PDF selection was replaced or cleared.', 'AbortError');
const sameOwner = (a, b) => a.taskId === b.taskId && a.revision === b.revision && a.generation === b.generation;
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason').get;
const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
const checkSignal = signal => { if (signal != null && Reflect.apply(aborted, signal, [])) throw Reflect.apply(reason, signal, []); };
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const typedBuffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;
const typedOffset = Object.getOwnPropertyDescriptor(typedArray, 'byteOffset').get;
const typedLength = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const byteValues = typedArray.values;
function captureAdmission(value) {
  const captured = new Map(), buffers = new Map(); let nodes = 0;
  function copy(input, depth = 0) {
    if (++nodes > 262144 || depth > 32) throw new RangeError('Inherited document metadata exceeds its capture limit.');
    if (input === null || ['undefined', 'string', 'number', 'boolean'].includes(typeof input)) return input;
    if (captured.has(input)) return captured.get(input);
    if (input instanceof Uint8Array) {
      const buffer = Reflect.apply(typedBuffer, input, []), offset = Reflect.apply(typedOffset, input, []), length = Reflect.apply(typedLength, input, []);
      const backing = Reflect.apply(bufferLength, buffer, []);
      if (!length || resizable && Reflect.apply(resizable, buffer, [])) throw new TypeError('Inherited buffers require fixed nonempty ArrayBuffer backing.');
      const view = new Uint8Array(buffer, offset, length);
      Object.defineProperty(view, Symbol.iterator, { value: byteValues });
      Object.defineProperty(view, 'byteLength', { value: length });
      Object.preventExtensions(view); captured.set(input, view); buffers.set(buffer, backing); return view;
    }
    const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new TypeError('Inherited document metadata must contain plain data.');
    if (array && input.length > 10000) throw new RangeError('Inherited document metadata has too many array entries.');
    const output = array ? [] : Object.create(null); captured.set(input, output);
    for (const key of Reflect.ownKeys(input)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || array && !/^(0|[1-9]\d*)$/.test(key)) throw new TypeError('Inherited document metadata requires own data entries.');
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Inherited document metadata requires own data entries.');
      Object.defineProperty(output, key, { value: copy(descriptor.value, depth + 1), enumerable: true });
    }
    if (array && output.length !== input.length) throw new TypeError('Inherited document arrays must contain dense data entries.');
    return Object.freeze(output);
  }
  return { value: copy(value), checkBuffers() { for (const [buffer, length] of buffers) if (Reflect.apply(bufferLength, buffer, []) !== length) throw new TypeError('An inherited document buffer changed before admission.'); } };
}

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
  async function validate(file, { signal, isCurrent, expectedOwner, maxBytes = MAX_BYTES, maxPages, inspectPdf = withPdfDocument, assertAdmission }) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES || maxPages !== undefined && (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10000) || typeof inspectPdf !== 'function' || assertAdmission !== undefined && typeof assertAdmission !== 'function') throw new TypeError('Invalid owned PDF intake limits.');
    const check = () => {
      checkSignal(signal); let current, owned, stillCurrent;
      // Caller callbacks must finish before the final canonical owner snapshot.
      try { current = isCurrent(); stillCurrent = isCurrent(); owned = sameOwner(documentSession.snapshot(), expectedOwner); }
      catch (error) { checkSignal(signal); throw error; }
      checkSignal(signal); if (!current || !owned || !stillCurrent) throw cancelled();
    };
    check();
    const name = file.name; if (typeof name !== 'string') throw new TypeError('A PDF filename is required.');
    if (!looksLikePdfFile(file)) throw new TypeError('Please select a PDF file.');
    if (file.size > maxBytes) throw new RangeError('This PDF exceeds the selected workspace input limit.');
    const bytes = new Uint8Array(await file.arrayBuffer()); check();
    if (bytes.length > maxBytes) throw new RangeError('This PDF exceeds the selected workspace input limit.');
    if (!checkPdfMagicBytes(bytes)) throw new TypeError('This file does not look like a valid PDF.');
    const pdfjs = await ensurePdfJs(); check();
    let locked = false;
    try {
      // Reuse the scanner's documented task/document destruction on all paths.
      await inspectPdf(pdfjs, bytes, { signal, pdfjsAssets: PDFJS_ASSET_URLS }, (doc) => {
        check(); if (!Number.isSafeInteger(doc.numPages) || doc.numPages < 1) throw new Error('This PDF has no readable pages.');
        if (maxPages !== undefined && doc.numPages > maxPages) throw new RangeError('This PDF exceeds the selected workspace page limit.');
      });
      check();
    } catch (error) {
      if (error?.code === 'PRIVACY_CLEANUP') throw error;
      check();
      // An error message mentioning encryption is not proof of a locked PDF.
      if (error?.name !== 'PasswordException' && !(pdfjs.PasswordException && error instanceof pdfjs.PasswordException)) throw error;
      locked = true;
    }
    await ensureDocumentSession(); check();
    const captured = assertAdmission ? captureAdmission(file.browserpdfSession || {}) : null;
    const inherited = captured ? captured.value : file.browserpdfSession || {};
    const capabilities = { ...inherited.capabilities, ...(locked ? { encrypted: true } : {}) };
    const beginOptions = { ...inherited, type: 'application/pdf', capabilities };
    if (assertAdmission) {
      Object.freeze(capabilities); Object.freeze(beginOptions);
      try { assertAdmission(Object.freeze({ inherited: beginOptions, size: bytes.length })); }
      catch (error) { if (error?.code === 'PRIVACY_CLEANUP') throw error; check(); throw error; }
      check(); captured.checkBuffers();
    } else check();
    // begin validates the entire inherited original/history/scene/resources and
    // joint limits before replacing the last usable task. No workspace rebake.
    const owner = documentSession.begin(bytes, name, beginOptions);
    return { name: name.slice(0, 160), size: bytes.length, bytes, owner, locked };
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
      try { if (options.signal != null) Reflect.apply(aborted, options.signal, []); } catch (error) { return Promise.reject(error); }
      if (pending) { pending.detach(); pending.reject(cancelled()); pending = null; }
      return new Promise((resolve, reject) => {
        const abort = () => { if (pending === job) { pending = null; job.detach(); reject(Reflect.apply(reason, options.signal, [])); } };
        const job = { file, options, resolve, reject, detach: () => { if (options.signal != null) Reflect.apply(remove, options.signal, ['abort', abort]); } };
        pending = job; if (options.signal != null) Reflect.apply(add, options.signal, ['abort', abort, { once: true }]);
        if (options.signal != null && Reflect.apply(aborted, options.signal, [])) abort();
        void drain();
      });
    },
  };
}
