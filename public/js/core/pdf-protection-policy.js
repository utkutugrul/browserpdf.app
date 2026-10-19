export const PROTECTION_LIMITS = Object.freeze({ inputBytes: 32 * 1024 * 1024, outputBytes: 64 * 1024 * 1024, pages: 1000, objects: 100000, tokens: 1000000, depth: 64, diagnosticBytes: 4096, deadlineMs: 20000 });
const CODES = new Set(['busy', 'canceled', 'stale', 'invalid-request', 'input-limit', 'credential-type', 'credential-control', 'credential-surrogate', 'credential-length', 'credential-encoding', 'credential-rejected', 'empty-owner', 'invalid-permission', 'asset-error', 'asset-integrity', 'worker-error', 'worker-protocol', 'timeout', 'engine-error', 'engine-warning', 'diagnostic-limit', 'unexpected-diagnostics', 'output-limit', 'unsupported-serialization', 'verification-failed', 'requires-unlock', 'already-unlocked']);
export class PdfProtectionError extends Error {
  constructor(code) { super(CODES.has(code) ? code : 'engine-error'); this.name = 'PdfProtectionError'; this.code = this.message; }
}
export function protectionError(code) { return new PdfProtectionError(code); }
const applyNative = Reflect.apply;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const nativeAddListener = EventTarget.prototype.addEventListener;
const nativeRemoveListener = EventTarget.prototype.removeEventListener;
export function validateProtectionSignal(signal) {
  if (signal !== undefined) protectionSignalAborted(signal);
  return signal;
}
export function protectionSignalAborted(signal) {
  if (signal === undefined) return false;
  try { return applyNative(nativeAborted, signal, []); } catch { throw protectionError('invalid-request'); }
}
export function addProtectionAbortListener(signal, listener) {
  if (signal === undefined) return;
  try { applyNative(nativeAddListener, signal, ['abort', listener, { once: true }]); } catch { throw protectionError('invalid-request'); }
}
export function removeProtectionAbortListener(signal, listener) {
  if (signal === undefined) return;
  try { applyNative(nativeRemoveListener, signal, ['abort', listener]); } catch { throw protectionError('invalid-request'); }
}
export function exactRecord(value, allowed) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw protectionError('invalid-request');
  for (const key of Reflect.ownKeys(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (typeof key !== 'string' || !allowed.includes(key) || !('value' in descriptor)) throw protectionError('invalid-request'); }
}
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const lengthOf = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
const bufferOf = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;
const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const setBytes = Uint8Array.prototype.set;
export function byteLength(bytes, maximum = PROTECTION_LIMITS.inputBytes) {
  try { if (!(bytes instanceof Uint8Array)) throw 0; const length = lengthOf.call(bytes); arrayBufferLength.call(bufferOf.call(bytes)); if (!length || length > maximum) throw 0; return length; } catch { throw protectionError('input-limit'); }
}
export function copyProtectionBytes(bytes, maximum = PROTECTION_LIMITS.inputBytes) { const copy = new Uint8Array(byteLength(bytes, maximum)); setBytes.call(copy, bytes); return copy; }
export function validateCredential(value, algorithm, allowEmpty = false) {
  if (typeof value !== 'string') throw protectionError('credential-type');
  const limit = algorithm === 'aes128' ? 32 : 127; if ((!allowEmpty && !value.length) || value.length > limit) throw protectionError('credential-length');
  let count = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index); if (code < 32 || (code >= 127 && code <= 159)) throw protectionError('credential-control');
    if (algorithm === 'aes128' && code > 126) throw protectionError('credential-encoding');
    if (code >= 0xd800 && code <= 0xdbff) { const low = value.charCodeAt(++index); if (!(low >= 0xdc00 && low <= 0xdfff)) throw protectionError('credential-surrogate'); count += 4; }
    else if (code >= 0xdc00 && code <= 0xdfff) throw protectionError('credential-surrogate');
    else { if (algorithm === 'aes128' && code > 126) throw protectionError('credential-encoding'); count += code < 128 ? 1 : code < 2048 ? 2 : 3; }
  }
  if (count > limit) throw protectionError('credential-length'); return value;
}
export function validateOwnerToken(value) {
  exactRecord(value, ['taskId', 'revision', 'generation']);
  if (typeof value.taskId !== 'string' || !value.taskId.length || value.taskId.length > 160 || /[\u0000-\u001f\u007f]/.test(value.taskId) || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.generation) || value.generation < 0) throw protectionError('invalid-request');
  return Object.freeze({ taskId: value.taskId, revision: value.revision, generation: value.generation });
}
export function sameProtectionOwner(a, b) { return a?.taskId === b?.taskId && a?.revision === b?.revision && a?.generation === b?.generation; }
export function validateProtectionRequest(value) {
  exactRecord(value, ['operation', 'bytes', 'algorithm', 'userPassword', 'ownerPassword', 'permissions', 'password', 'ownerToken', 'operationRevision']);
  if (!['protect', 'unlock'].includes(value.operation)) throw protectionError('invalid-request'); byteLength(value.bytes);
  const ownerToken = validateOwnerToken(value.ownerToken), operationRevision = value.operationRevision === undefined ? 0 : value.operationRevision;
  if (!Number.isSafeInteger(operationRevision) || operationRevision < 0) throw protectionError('invalid-request');
  if (value.operation === 'unlock') {
    if (['algorithm', 'userPassword', 'ownerPassword', 'permissions'].some(key => Object.hasOwn(value, key))) throw protectionError('invalid-request');
    return Object.freeze({ operation: 'unlock', bytes: value.bytes, password: validateCredential(value.password, 'aes256', true), ownerToken, operationRevision });
  }
  if (Object.hasOwn(value, 'password')) throw protectionError('invalid-request');
  const algorithm = value.algorithm === undefined ? 'aes256' : value.algorithm; if (!['aes256', 'aes128'].includes(algorithm)) throw protectionError('invalid-request');
  const userPassword = validateCredential(value.userPassword, algorithm); if (value.ownerPassword === '') throw protectionError('empty-owner');
  const ownerPassword = value.ownerPassword === undefined ? userPassword : validateCredential(value.ownerPassword, algorithm);
  const input = value.permissions === undefined ? {} : value.permissions; exactRecord(input, ['print', 'modify', 'extract', 'accessibility']);
  const permissions = { print: input.print === undefined ? 'full' : input.print, modify: input.modify === undefined ? 'all' : input.modify, extract: input.extract === undefined ? true : input.extract, accessibility: input.accessibility === undefined ? true : input.accessibility };
  if (!['full', 'low', 'none'].includes(permissions.print) || !['all', 'annotate', 'form', 'assembly', 'none'].includes(permissions.modify) || typeof permissions.extract !== 'boolean' || permissions.accessibility !== true) throw protectionError('invalid-permission');
  return Object.freeze({ operation: 'protect', bytes: value.bytes, algorithm, userPassword, ownerPassword, permissions: Object.freeze(permissions), ownerToken, operationRevision });
}
export function checkProtectionOwner({ signal, isCurrent = () => true } = {}) {
  if (protectionSignalAborted(signal)) throw protectionError('canceled'); let current = false; try { current = isCurrent() === true; } catch {} if (!current) throw protectionError('stale');
}
