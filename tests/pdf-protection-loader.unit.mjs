import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
import { runProtectionJob, PROTECTION_ASSETS } from '../public/js/pdf-protection-loader.js';
globalThis.crypto ??= webcrypto; globalThis.Blob ??= NodeBlob;
const ownerToken = { taskId: 'loader-test', revision: 2, generation: 5 };
const request = () => ({ operation: 'unlock', bytes: new Uint8Array([37, 80, 68, 70]), password: '', ownerToken });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
const pins = await Promise.all(PROTECTION_ASSETS.map(pin => readFile(new URL('../public' + pin.path, import.meta.url))));

async function harness(run) {
  const original = { fetch: globalThis.fetch, Worker: globalThis.Worker, location: globalThis.location, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const state = { fetches: [], workers: [], urls: [], revoked: [], terminated: 0, active: 0, maximum: 0, readStarts: 0, canceledReaders: 0, behavior: 'auto' };
  URL.createObjectURL = blob => { assert.ok(blob instanceof Blob); const value = 'blob:owned-' + (state.urls.length + 1); state.urls.push(value); return value; };
  URL.revokeObjectURL = url => { state.revoked.push(url); state.onRevoke?.(); if (state.throwRevoke && state.revoked.length === 1) throw new Error('Private revoke detail'); };
  globalThis.location = { origin: 'https://protection.invalid' };
  globalThis.fetch = async (path, options) => {
    state.fetches.push(path); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'same-origin'); assert.ok(options.signal instanceof AbortSignal);
    const index = PROTECTION_ASSETS.findIndex(pin => pin.path === path); assert.ok(index >= 0);
    const data = new Uint8Array(pins[index]); if (state.corrupt && index === 0) data[0] ^= 1;
    let sent = false;
    return { ok: true, status: 200, url: 'https://protection.invalid' + path, headers: { get: key => key === 'content-length' ? String(data.length) : null }, body: { getReader() { return {
      async read() { if (sent) return { done: true }; sent = true; state.readStarts++; if (state.holdRead && index === 0) { state.readBegan?.resolve(); await state.holdRead.promise; } return { done: false, value: data }; },
      async cancel() { state.canceledReaders++; }, releaseLock() {},
    }; } } };
  };
  class FakeWorker {
    constructor(url, options) { assert.ok(url.pathname.endsWith('/js/pdf-protection-worker.js')); assert.deepEqual(options, { type: 'module', name: 'pdf-protection' }); this.stopped = false; state.active++; state.maximum = Math.max(state.maximum, state.active); state.workers.push(this); }
    terminate() { assert.equal(arguments.length, 0); assert.equal(this.stopped, false); if (state.throwStop) throw new Error('Private stop detail'); this.stopped = true; state.terminated++; state.active--; /* Native browser termination returns void. */ }
    postMessage(message, transfer) {
      assert.deepEqual(transfer, [message.request.bytes.buffer]); assert.deepEqual(message.bootstrap, { moduleUrl: state.urls.at(-2), wasmUrl: state.urls.at(-1) });
      this.message = message;
      this.respond = override => {
        const input = message.request, bytes = new Uint8Array([37, 80, 68, 70]);
        this.onmessage?.({ data: { type: 'result', id: message.id, ownerToken: input.ownerToken, operationRevision: input.operationRevision, bytes, facts: { operation: input.operation, encrypted: input.operation === 'protect', algorithm: input.operation === 'protect' ? input.algorithm : 'none', engineVersion: '12.3.2', inputBytes: input.bytes.byteLength, outputBytes: bytes.length, pages: 1, objects: 4, normalizedNameTokens: 0 }, ...override } });
      };
      state.workerBegan?.resolve();
      if (state.behavior === 'auto') queueMicrotask(() => this.respond());
      if (state.behavior === 'error') queueMicrotask(() => this.onerror?.({ message: 'Private synthetic detail' }));
      if (state.behavior === 'protocol') queueMicrotask(() => this.respond({ operationRevision: -1 }));
      if (state.behavior === 'finite-error') queueMicrotask(() => this.onmessage?.({ data: { type: 'error', id: message.id, code: 'credential-rejected' } }));
    }
  }
  globalThis.Worker = FakeWorker;
  try { await run(state); assert.equal(state.active, 0); assert.equal(state.maximum <= 1, true); assert.deepEqual(state.revoked, state.urls); }
  finally { globalThis.fetch = original.fetch; globalThis.Worker = original.Worker; if (original.location === undefined) delete globalThis.location; else globalThis.location = original.location; URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; }
}

test('fixed verified assets and one worker own their URLs through successful cleanup', async () => harness(async state => {
  const input = request(), before = new Uint8Array(input.bytes), result = await runProtectionJob(input);
  assert.deepEqual(input.bytes, before); assert.equal(result.facts.operation, 'unlock'); assert.equal(state.terminated, 1); assert.deepEqual(state.fetches, PROTECTION_ASSETS.map(pin => pin.path)); assert.equal(state.urls.length, 2);
}));
test('overlap is rejected before request access, byte copy, fetch or worker launch', async () => harness(async state => {
  state.behavior = 'hold'; state.workerBegan = deferred(); const pending = runProtectionJob(request()); await state.workerBegan.promise;
  let accessed = false; const hostile = { get operation() { accessed = true; throw new Error('Caller getter'); } };
  await assert.rejects(runProtectionJob(hostile), { code: 'busy' }); assert.equal(accessed, false); assert.equal(state.fetches.length, 2); assert.equal(state.workers.length, 1);
  state.workers[0].respond(); await pending; state.behavior = 'auto'; assert.equal((await runProtectionJob(request())).facts.pages, 1);
}));
test('unknown URL fields and null typed options fail before asset work', async () => harness(async state => {
  await assert.rejects(runProtectionJob({ ...request(), moduleUrl: 'https://invalid.example/' }), { code: 'invalid-request' });
  await assert.rejects(runProtectionJob(request(), { signal: null }), { code: 'invalid-request' });
  await assert.rejects(runProtectionJob(request(), { isCurrent: null }), { code: 'invalid-request' });
  await assert.rejects(runProtectionJob(request(), { signal: { aborted: false, addEventListener() {} } }), { code: 'invalid-request' });
  assert.equal(state.fetches.length, 0); await runProtectionJob(request());
}));
test('integrity failure creates no bootstrap URLs and permits a positive successor', async () => harness(async state => {
  state.corrupt = true; await assert.rejects(runProtectionJob(request()), { code: 'asset-integrity' }); assert.equal(state.urls.length, 0); assert.equal(state.workers.length, 0);
  state.corrupt = false; await runProtectionJob(request());
}));
test('abort during an owned asset read waits for read cleanup before successor admission', async () => harness(async state => {
  state.holdRead = deferred(); state.readBegan = deferred(); const stop = new AbortController(); let settled = false;
  const pending = runProtectionJob(request(), { signal: stop.signal }); pending.then(() => settled = true, () => settled = true); await state.readBegan.promise; stop.abort(); await tick();
  assert.equal(settled, false); await assert.rejects(runProtectionJob(request()), { code: 'busy' }); assert.equal(state.workers.length, 0);
  state.holdRead.resolve(); await assert.rejects(pending, { code: 'canceled' }); assert.ok(state.canceledReaders >= 1); state.holdRead = null; await runProtectionJob(request());
}));
test('hard cancellation uses void termination, revokes owned blobs and admits a clean successor', async () => harness(async state => {
  state.behavior = 'hold'; state.workerBegan = deferred(); const stop = new AbortController(); const pending = runProtectionJob(request(), { signal: stop.signal }); await state.workerBegan.promise;
  stop.abort(); await assert.rejects(pending, { code: 'canceled' }); assert.equal(state.terminated, 1); assert.equal(state.revoked.length, 2);
  state.behavior = 'auto'; await runProtectionJob(request()); assert.equal(state.maximum, 1);
}));
test('deadline termination withholds output and completes cleanup before successor admission', async () => harness(async state => {
  const nativeTimeout = globalThis.setTimeout; state.behavior = 'hold';
  try { globalThis.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 20000 ? 5 : delay, ...args); await assert.rejects(runProtectionJob(request()), { code: 'timeout' }); }
  finally { globalThis.setTimeout = nativeTimeout; }
  assert.equal(state.terminated, 1); assert.equal(state.revoked.length, 2); state.behavior = 'auto'; await runProtectionJob(request());
}));
test('worker errors, malformed ownership and finite credential errors all drain before successor', async () => harness(async state => {
  for (const [behavior, code] of [['error', 'worker-error'], ['protocol', 'worker-protocol'], ['finite-error', 'credential-rejected']]) { state.behavior = behavior; await assert.rejects(runProtectionJob(request()), { code }); assert.equal(state.active, 0); state.behavior = 'auto'; await runProtectionJob(request()); }
}));
test('stale ownership before result and during final cleanup never publishes bytes', async () => harness(async state => {
  state.behavior = 'hold'; state.workerBegan = deferred(); let current = true;
  const pending = runProtectionJob(request(), { isCurrent: () => current }); await state.workerBegan.promise; current = false; state.workers[0].respond(); await assert.rejects(pending, { code: 'stale' });
  current = true; state.behavior = 'auto'; state.onRevoke = () => { current = false; }; await assert.rejects(runProtectionJob(request(), { isCurrent: () => current }), { code: 'stale' });
  state.onRevoke = null; current = true; await runProtectionJob(request(), { isCurrent: () => current });
}));
test('original duck cleanup failure rejects before fetch and does not block a successful successor', async () => harness(async state => {
  let calls = 0; const signal = { aborted: false, addEventListener() { calls++; }, removeEventListener() { calls++; throw new Error('Private cleanup detail'); } };
  await assert.rejects(runProtectionJob(request(), { signal }), error => error.code === 'invalid-request' && error.message === 'invalid-request');
  assert.equal(calls, 0); assert.equal(state.fetches.length, 0); await runProtectionJob(request());
}));
test('genuine throwing listener overrides are bypassed through rejection cleanup and successful successor', async () => harness(async state => {
  let calls = 0; const signal = new AbortController().signal;
  Object.defineProperty(signal, 'addEventListener', { value() { calls++; throw new Error('Private add detail'); } });
  Object.defineProperty(signal, 'removeEventListener', { value() { calls++; throw new Error('Private cleanup detail'); } });
  state.corrupt = true; await assert.rejects(runProtectionJob(request(), { signal }), error => error.code === 'asset-integrity' && error.message === 'asset-integrity');
  assert.equal(calls, 0); assert.equal(state.active, 0); state.corrupt = false; await runProtectionJob(request(), { signal }); assert.equal(calls, 0);
}));
test('pre-aborted and late-aborted genuine signals ignore all public signal accessors', async () => harness(async state => {
  let calls = 0;
  function shadow(signal) { for (const key of ['aborted', 'addEventListener', 'removeEventListener']) Object.defineProperty(signal, key, { get() { calls++; throw new Error('Private signal detail'); } }); return signal; }
  const early = new AbortController(); early.abort(); await assert.rejects(runProtectionJob(request(), { signal: shadow(early.signal) }), { code: 'canceled' }); assert.equal(state.fetches.length, 0);
  const stop = new AbortController(); state.behavior = 'hold'; state.workerBegan = deferred(); const pending = runProtectionJob(request(), { signal: shadow(stop.signal) }); await state.workerBegan.promise;
  stop.abort(); await assert.rejects(pending, { code: 'canceled' }); assert.equal(state.terminated, 1); assert.equal(state.revoked.length, 2); assert.equal(calls, 0);
  state.behavior = 'auto'; await runProtectionJob(request(), { signal: shadow(new AbortController().signal) }); assert.equal(calls, 0);
}));
test('option mutation after admission cannot introduce a cleanup signal accessor', async () => harness(async state => {
  let calls = 0; const options = { signal: new AbortController().signal }; state.behavior = 'hold'; state.workerBegan = deferred(); const pending = runProtectionJob(request(), options); await state.workerBegan.promise;
  Object.defineProperty(options, 'signal', { get() { calls++; throw new Error('Private option detail'); } }); state.workers[0].respond(); await pending; assert.equal(calls, 0); state.behavior = 'auto'; await runProtectionJob(request());
}));
test('a cleanup step failure stays finite while other URL cleanup and successor admission continue', async () => harness(async state => {
  state.throwRevoke = true; await assert.rejects(runProtectionJob(request()), error => error.code === 'asset-error' && error.message === 'asset-error');
  assert.equal(state.terminated, 1); assert.equal(state.revoked.length, 2); assert.equal(state.active, 0); state.throwRevoke = false; await runProtectionJob(request());
}));
test('an actual worker stop failure keeps the active fence while other cleanup still runs', async () => harness(async state => {
  const { runProtectionJob: isolated } = await import('../public/js/pdf-protection-loader.js?stop-failure-correction'); state.throwStop = true;
  await assert.rejects(isolated(request()), error => error.code === 'worker-error' && error.message === 'worker-error'); assert.equal(state.revoked.length, 2); assert.equal(state.active, 1);
  await assert.rejects(isolated(request()), { code: 'busy' }); assert.equal(state.workers.length, 1);
  // The harness separately stops its fake worker; the fenced production slot is never released.
  state.throwStop = false; state.workers[0].terminate(); assert.equal(state.active, 0);
}));
