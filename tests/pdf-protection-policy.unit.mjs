import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProtectionRequest, validateCredential, copyProtectionBytes, checkProtectionOwner, validateProtectionSignal, protectionSignalAborted, addProtectionAbortListener, removeProtectionAbortListener } from '../public/js/core/pdf-protection-policy.js';

const ownerToken = Object.freeze({ taskId: 'policy-test', revision: 3, generation: 2 });
const request = extra => ({ operation: 'protect', bytes: new Uint8Array([37, 80]), userPassword: 'synthetic', ownerToken, ...extra });
const rejects = (value, code) => assert.throws(() => validateProtectionRequest(value), { code });

test('defaults apply only to missing or undefined values and explicit false is preserved', () => {
  const value = validateProtectionRequest(request({ algorithm: undefined, ownerPassword: undefined, permissions: { extract: false } }));
  assert.equal(value.algorithm, 'aes256'); assert.equal(value.ownerPassword, value.userPassword);
  assert.deepEqual(value.permissions, { print: 'full', modify: 'all', extract: false, accessibility: true });
  for (const key of ['algorithm', 'ownerPassword', 'permissions', 'ownerToken', 'operationRevision']) rejects(request({ [key]: null }), key === 'ownerPassword' ? 'credential-type' : 'invalid-request');
  for (const key of ['print', 'modify', 'extract', 'accessibility']) rejects(request({ permissions: { [key]: null } }), 'invalid-permission');
  rejects(request({ permissions: { accessibility: false } }), 'invalid-permission');
  rejects(request({ ownerPassword: '' }), 'empty-owner');
});
test('one exact byte DTO rejects ambiguous keys, accessor records and operation mixing', () => {
  rejects(request({ options: { bytes: new Uint8Array([1]) } }), 'invalid-request');
  rejects(request({ bytes: new Uint8Array() }), 'input-limit');
  rejects(request({ password: 'synthetic' }), 'invalid-request');
  rejects({ operation: 'unlock', bytes: new Uint8Array([1]), ownerToken, password: '', algorithm: undefined }, 'invalid-request');
  const accessor = request(); Object.defineProperty(accessor, 'permissions', { get() { throw new Error('Accessor invoked'); } }); rejects(accessor, 'invalid-request');
  const symbol = request(); symbol[Symbol('extra')] = true; rejects(symbol, 'invalid-request');
  rejects(request({ ownerToken: { ...ownerToken, arbitrary: true } }), 'invalid-request');
  assert.equal(validateProtectionRequest({ operation: 'unlock', bytes: new Uint8Array([1]), ownerToken, password: '' }).password, '');
});
test('credential bounds count UTF-8 bytes and reject controls and malformed surrogates', () => {
  assert.equal(validateCredential('é'.repeat(63) + 'a', 'aes256').length, 64);
  assert.throws(() => validateCredential('é'.repeat(64), 'aes256'), { code: 'credential-length' });
  assert.equal(validateCredential('a'.repeat(32), 'aes128').length, 32);
  assert.throws(() => validateCredential('a'.repeat(33), 'aes128'), { code: 'credential-length' });
  assert.throws(() => validateCredential('é', 'aes128'), { code: 'credential-encoding' });
  for (const value of ['\0', '\n', '\u007f', '\u0080', '\u009f']) assert.throws(() => validateCredential(value, 'aes256'), { code: 'credential-control' });
  for (const value of ['\ud800', '\udc00', '\ud800x']) assert.throws(() => validateCredential(value, 'aes256'), { code: 'credential-surrogate' });
  assert.equal(validateCredential('😀'.repeat(31), 'aes256').length, 62);
  assert.throws(() => validateCredential(null, 'aes256'), { code: 'credential-type' });
});
test('owned byte copies use intrinsic storage and never caller slice, iterator or species', () => {
  let calls = 0;
  class Hostile extends Uint8Array { static get [Symbol.species]() { calls++; throw new Error('Species invoked'); } slice() { calls++; throw new Error('Slice invoked'); } *[Symbol.iterator]() { calls++; throw new Error('Iterator invoked'); } }
  const input = new Hostile([1, 2, 128, 255]);
  for (const key of ['length', 'byteLength', 'buffer']) Object.defineProperty(input, key, { get() { calls++; throw new Error('Getter invoked'); } });
  const output = copyProtectionBytes(input); assert.deepEqual([...output], [1, 2, 128, 255]); assert.equal(calls, 0); assert.equal(output.constructor, Uint8Array);
  input[0] = 9; assert.equal(output[0], 1);
  if (typeof SharedArrayBuffer === 'function') assert.throws(() => copyProtectionBytes(new Uint8Array(new SharedArrayBuffer(4))), { code: 'input-limit' });
});
test('ownership rejects canceled, stale and throwing current checks with finite codes', () => {
  const stop = new AbortController(); stop.abort(new Error('Private reason'));
  assert.throws(() => checkProtectionOwner({ signal: stop.signal }), { code: 'canceled' });
  assert.throws(() => checkProtectionOwner({ isCurrent: () => false }), { code: 'stale' });
  assert.throws(() => checkProtectionOwner({ isCurrent: () => { throw new Error('Private reason'); } }), { code: 'stale' });
  checkProtectionOwner({ isCurrent: () => true });
});
test('native signal admission rejects ducks without reading their public accessors', () => {
  let calls = 0; const duck = {};
  for (const key of ['aborted', 'addEventListener', 'removeEventListener']) Object.defineProperty(duck, key, { get() { calls++; throw new Error('Private accessor detail'); } });
  for (const input of [duck, null, new EventTarget(), Object.create(AbortSignal.prototype)]) assert.throws(() => validateProtectionSignal(input), { code: 'invalid-request' });
  assert.equal(calls, 0); assert.equal(validateProtectionSignal(undefined), undefined);
});
test('genuine signal overrides cannot replace native aborted storage or native listener operations', () => {
  const controller = new AbortController(), signal = controller.signal; let calls = 0, events = 0;
  for (const key of ['aborted', 'addEventListener', 'removeEventListener']) Object.defineProperty(signal, key, { get() { calls++; throw new Error('Private accessor detail'); } });
  assert.equal(validateProtectionSignal(signal), signal); assert.equal(protectionSignalAborted(signal), false);
  const removed = () => { events += 100; }, retained = () => { events++; };
  addProtectionAbortListener(signal, removed); removeProtectionAbortListener(signal, removed); addProtectionAbortListener(signal, retained); controller.abort();
  assert.equal(protectionSignalAborted(signal), true); assert.equal(events, 1); assert.equal(calls, 0);
  assert.throws(() => checkProtectionOwner({ signal }), { code: 'canceled' });
});
