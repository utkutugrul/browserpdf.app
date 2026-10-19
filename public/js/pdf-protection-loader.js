import { PROTECTION_LIMITS, PdfProtectionError, protectionError, exactRecord, validateProtectionRequest, validateOwnerToken, copyProtectionBytes, sameProtectionOwner, checkProtectionOwner, validateProtectionSignal, addProtectionAbortListener, removeProtectionAbortListener } from './core/pdf-protection-policy.js';

export const PROTECTION_ASSETS = Object.freeze([
  Object.freeze({ path: '/vendor/pdfstudio-0.4.0/qpdf.js', bytes: 62770, integrity: 'SwmYYv6pk3pPUYNbUbKu/7Eo0FAJkWd3mjGw5OQOle+uOtStGwvLRt9PzAcpOXfP', type: 'text/javascript' }),
  Object.freeze({ path: '/vendor/pdfstudio-0.4.0/qpdf.wasm', bytes: 2244725, integrity: 'UemhVPGx1Rw4X1L+XFylC8BC8tdxGItz6QoomcZo8GI/S+kgSaAQ4pvhDGAS5AAu', type: 'application/wasm' }),
]);
let active = null, sequence = 0;
const nativeAbort = AbortController.prototype.abort;
const applyNative = Reflect.apply;
function base64(bytes) { let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); }

export async function runProtectionJob(request, options = {}) {
  // This test precedes validation, byte copying, fetch and worker construction.
  if (active) throw protectionError('busy');
  const job = { worker: null, terminated: false, urls: [], controller: new AbortController(), reject: null, cancelCode: null, readers: new Set() }; active = job;
  let timer, abortListener, owned, completed = false, cleanupCode = null, ownership = {};
  const abortFetch = () => { try { applyNative(nativeAbort, job.controller, []); } catch { cleanupCode ||= 'asset-error'; } };
  const cancel = code => { if (!job.cancelCode) job.cancelCode = code; abortFetch(); try { stopWorker(); } catch { job.cancelCode = 'worker-error'; } job.reject?.(protectionError(job.cancelCode)); };
  function stopWorker() { if (!job.worker || job.terminated) return; job.worker.onmessage = job.worker.onerror = job.worker.onmessageerror = null; job.worker.terminate(); job.terminated = true; }
  const guard = () => { if (job.cancelCode) throw protectionError(job.cancelCode); checkProtectionOwner(ownership); };
  async function asset(pin) {
    guard(); const response = await fetch(pin.path, { signal: job.controller.signal, redirect: 'error', credentials: 'same-origin', cache: 'force-cache' }); guard();
    if (!response.ok || response.status !== 200 || (response.url && new URL(response.url).origin !== globalThis.location.origin) || !response.body?.getReader) throw protectionError('asset-error');
    const declared = response.headers.get('content-length'); if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) !== pin.bytes)) throw protectionError('asset-integrity');
    const bytes = new Uint8Array(pin.bytes), reader = response.body.getReader(); job.readers.add(reader); let offset = 0, complete = false;
    try {
      while (true) { guard(); const chunk = await reader.read(); guard(); if (chunk.done) { complete = true; break; } if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > pin.bytes - offset) throw protectionError('asset-integrity'); bytes.set(chunk.value, offset); offset += chunk.value.byteLength; }
      if (offset !== pin.bytes) throw protectionError('asset-integrity'); guard(); const hash = await crypto.subtle.digest('SHA-384', bytes); guard(); if (base64(new Uint8Array(hash)) !== pin.integrity) throw protectionError('asset-integrity'); return bytes;
    } finally { if (!complete) try { await reader.cancel(protectionError(job.cancelCode || 'asset-error')); } catch {} job.readers.delete(reader); try { reader.releaseLock(); } catch {} }
  }
  try {
    exactRecord(options, ['signal', 'isCurrent']);
    const signal = validateProtectionSignal(Object.getOwnPropertyDescriptor(options, 'signal')?.value), isCurrent = Object.getOwnPropertyDescriptor(options, 'isCurrent')?.value;
    if (isCurrent !== undefined && typeof isCurrent !== 'function') throw protectionError('invalid-request');
    ownership = Object.freeze({ signal, isCurrent });
    guard(); const checked = validateProtectionRequest(request); owned = { ...checked, bytes: copyProtectionBytes(checked.bytes) }; job.inputBytes = owned.bytes.byteLength; guard();
    abortListener = () => cancel('canceled'); addProtectionAbortListener(ownership.signal, abortListener);
    timer = setTimeout(() => cancel('timeout'), PROTECTION_LIMITS.deadlineMs); guard();
    let firstFailure;
    const verified = await Promise.allSettled(PROTECTION_ASSETS.map(pin => asset(pin).catch(error => { firstFailure ??= error; abortFetch(); throw error; }))); guard();
    if (firstFailure) throw firstFailure; const buffers = verified.map(value => { if (value.status !== 'fulfilled') throw protectionError('asset-error'); return value.value; });
    for (let index = 0; index < buffers.length; index++) { guard(); job.urls.push(URL.createObjectURL(new Blob([buffers[index]], { type: PROTECTION_ASSETS[index].type }))); }
    guard(); const id = ++sequence; job.worker = new Worker(new URL('./pdf-protection-worker.js', import.meta.url), { type: 'module', name: 'pdf-protection' });
    const result = await new Promise((resolve, reject) => {
      job.reject = reject;
      job.worker.onerror = job.worker.onmessageerror = () => reject(protectionError('worker-error'));
      job.worker.onmessage = event => {
        try {
          guard(); const message = event.data; if (!message || message.id !== id) throw protectionError('worker-protocol');
          if (message.type === 'phase') { exactRecord(message, ['type', 'id', 'phase']); if (!['native', 'verifying'].includes(message.phase)) throw protectionError('worker-protocol'); return; }
          if (message.type === 'error') { exactRecord(message, ['type', 'id', 'code']); throw protectionError(message.code); }
          exactRecord(message, ['type', 'id', 'ownerToken', 'operationRevision', 'bytes', 'facts']);
          if (message.type !== 'result' || !sameProtectionOwner(validateOwnerToken(message.ownerToken), owned.ownerToken) || message.operationRevision !== owned.operationRevision) throw protectionError('worker-protocol');
          exactRecord(message.facts, ['operation', 'encrypted', 'algorithm', 'engineVersion', 'inputBytes', 'outputBytes', 'pages', 'objects', 'normalizedNameTokens']);
          const f = message.facts; if (f.operation !== owned.operation || f.encrypted !== (owned.operation === 'protect') || f.algorithm !== (owned.operation === 'protect' ? owned.algorithm : 'none') || f.engineVersion !== '12.3.2' || ![f.inputBytes, f.outputBytes, f.pages, f.objects, f.normalizedNameTokens].every(Number.isSafeInteger) || f.pages < 1 || f.pages > PROTECTION_LIMITS.pages || f.objects < 1 || f.objects > PROTECTION_LIMITS.objects || f.normalizedNameTokens < 0 || f.normalizedNameTokens > PROTECTION_LIMITS.tokens) throw protectionError('worker-protocol');
          const bytes = copyProtectionBytes(message.bytes, PROTECTION_LIMITS.outputBytes); if (f.outputBytes !== bytes.byteLength || f.inputBytes !== job.inputBytes) throw protectionError('worker-protocol'); guard(); resolve({ bytes, facts: Object.freeze({ ...f }) });
        } catch (error) { reject(error); }
      };
      job.worker.postMessage({ type: 'run', id, request: owned, bootstrap: { moduleUrl: job.urls[0], wasmUrl: job.urls[1] } }, [owned.bytes.buffer]);
    });
    guard(); completed = true; return result;
  } catch (error) { if (job.cancelCode) throw protectionError(job.cancelCode); throw error instanceof PdfProtectionError ? error : protectionError('asset-error'); }
  finally {
    // One cleanup failure must not bypass any other owned cleanup step.
    try { clearTimeout(timer); } catch { cleanupCode ||= 'asset-error'; }
    if (abortListener) try { removeProtectionAbortListener(ownership.signal, abortListener); } catch { cleanupCode ||= 'asset-error'; }
    abortFetch();
    let stopped = true; try { stopWorker(); } catch { stopped = false; cleanupCode = 'worker-error'; }
    const readers = await Promise.allSettled([...job.readers].map(reader => Promise.resolve().then(() => reader.cancel(protectionError('canceled')))));
    if (readers.some(value => value.status === 'rejected')) cleanupCode ||= 'asset-error';
    for (const url of job.urls) try { URL.revokeObjectURL(url); } catch { cleanupCode ||= 'asset-error'; } job.urls.length = 0; job.reject = null; owned = null;
    if (stopped && active === job) active = null;
    if (cleanupCode) throw protectionError(cleanupCode === 'worker-error' ? cleanupCode : job.cancelCode || cleanupCode);
    if (completed) guard();
  }
}
