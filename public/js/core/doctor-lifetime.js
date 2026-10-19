import { assertDoctorBudget, DOCTOR_LIMITS } from './doctor-policy.js';

const apply = Reflect.apply, own = Object.getOwnPropertyDescriptor, has = Object.hasOwn;
const then = Promise.prototype.then;
const aborted = own(AbortSignal.prototype, 'aborted').get, reason = own(AbortSignal.prototype, 'reason').get;
const controllerSignal = own(AbortController.prototype, 'signal').get, abort = AbortController.prototype.abort;
const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
const arrayType = Object.getPrototypeOf(Uint8Array.prototype);
const buffer = own(arrayType, 'buffer').get, offset = own(arrayType, 'byteOffset').get, length = own(arrayType, 'byteLength').get;
const backingLength = own(ArrayBuffer.prototype, 'byteLength').get, resizable = own(ArrayBuffer.prototype, 'resizable')?.get;
const copyBytes = Uint8Array.prototype.set;
const arrayTag = own(arrayType, Symbol.toStringTag).get;
const usageKeys = ['resourceBytes', 'resourceCount', 'artifactBytes', 'expandedBytes', 'expandedCount'];
const cleanupRecords = new WeakMap(), operationScopes = new WeakMap();
function rememberCleanup(cause, key, proof) {
  let group = cleanupRecords.get(cause);
  if (!group) {
    const owners = new Map();
    group = { owners, async retry() {
      const results = await Promise.allSettled([...owners.values()].map(value => value.retry()));
      if (results.some(value => value.status === 'rejected')) throw cause;
    }, ready: () => [...owners.values()].every(value => value.ready()) };
    cleanupRecords.set(cause, group);
  }
  group.owners.set(key, proof);
}
const clock = Date.now, later = globalThis.setTimeout, stopTimer = globalThis.clearTimeout;
const zero = () => Object.fromEntries(usageKeys.map(key => [key, 0]));
const plain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function safeCause(cause) {
  // Native rejection objects/handles and message contents are never published.
  if (cause == null || typeof cause === 'boolean' || typeof cause === 'number' && Number.isFinite(cause) || cause === '') return cause;
  return Object.freeze({ name: 'NativeFailure' });
}
const error = (code, message, cause) => Object.assign(new Error(message), { code: `DOCTOR_${code}`, cause: safeCause(cause) });
const replaced = () => new DOMException('Doctor work was replaced or canceled.', 'AbortError');
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function data(value, key) { const d = value && own(value, key); if (!d || !has(d, 'value')) throw new TypeError('Doctor controls require own data properties.'); return d.value; }
function record(value, allowed, required = allowed) {
  if (!plain(value) || Reflect.ownKeys(value).some(key => !allowed.includes(key)) || required.some(key => !has(value, key))) throw new TypeError('Invalid finite Doctor controls.');
  for (const key of Reflect.ownKeys(value)) data(value, key);
  return value;
}
function scalar(value) { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid Doctor usage.'); return value; }
function usage(value) { record(value, usageKeys, []); return Object.freeze(Object.fromEntries(usageKeys.map(key => [key, has(value, key) ? scalar(data(value, key)) : 0]))); }
function owner(value) {
  if (!plain(value)) throw new TypeError('A metadata owner is required.');
  const taskId = data(value, 'taskId');
  if (taskId !== null && (typeof taskId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(taskId))) throw new TypeError('Invalid Doctor task owner.');
  return Object.freeze({ taskId, revision: scalar(data(value, 'revision')), generation: scalar(data(value, 'generation')) });
}
const same = (a, b) => a.taskId === b.taskId && a.revision === b.revision && a.generation === b.generation;
function check(signal) { if (signal != null && apply(aborted, signal, [])) throw apply(reason, signal, []); }
function brand(signal) { if (signal != null) apply(aborted, signal, []); }
function nativeFirst(value) {
  // A thenable or false is not evidence of the native operation finishing.
  const gate = deferred();
  apply(then, value, [gate.resolve, gate.reject]);
  return gate.promise;
}
function safeResult(value, handles) {
  const seen = new Set(), objects = []; let nodes = 0, units = 0;
  function charge(n) { units += n; if (units > DOCTOR_LIMITS.reportUnits) throw new RangeError('Doctor serialized diagnostic data exceeds its bound.'); }
  function quoted(text) {
    charge(2);
    for (let n = 0; n < text.length; n++) {
      const code = text.charCodeAt(n);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) charge(2);
      else if (code < 32) charge(6);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(n + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { charge(2); n++; } else charge(6);
      } else charge(code >= 0xdc00 && code <= 0xdfff ? 6 : 1);
    }
  }
  function walk(item, depth) {
    if (++nodes > 10000 || depth > 32) throw new RangeError('Doctor diagnostic data exceeds its bound.');
    if (item === null) { charge(4); return; }
    if (typeof item === 'boolean') { charge(item ? 4 : 5); return; }
    if (typeof item === 'number' && Number.isFinite(item)) { charge(String(item).length); return; }
    if (typeof item === 'string') { quoted(item); return; }
    if (handles.has(item) || !plain(item) && !Array.isArray(item) || seen.has(item)) throw new TypeError('Only owned acyclic diagnostic data may leave inspection.');
    seen.add(item); objects.push(item);
    const fields = Reflect.ownKeys(item);
    const array = Array.isArray(item);
    if (fields.length > (array ? 1001 : 1000) || array && (item.length > 1000 || fields.length !== item.length + 1)) throw new RangeError('Doctor diagnostic entries exceed their bound.');
    charge(2); let count = 0;
    for (const key of fields) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || key.length > 128) throw new TypeError('Invalid diagnostic key.');
      if (array && !/^(0|[1-9]\d*)$/.test(key)) throw new TypeError('Doctor diagnostic arrays must be dense data.');
      if (count++) charge(1);
      if (!array) { quoted(key); charge(1); }
      walk(data(item, key), depth + 1);
    }
  }
  walk(value, 0);
  // Count escaping before any serialized allocation; hidden own data is
  // conservatively counted too. Caller retains the output representation.
  return { objects, bytes: units * 2 + nodes * 64 };
}

export function createDoctorPdfLifetime() {
  let active = null;
  function release(rec) {
    // Drop strong native/FIRST references before returning their reservation.
    // The historical branded error keeps only the completed proof record.
    rec.closed = true; rec.doc = null; rec.task = null; rec.load = null;
    rec.native.length = rec.rawFirsts.length = rec.works.length = rec.getters.length = rec.renders.length = rec.cleanups.length = 0;
    rec.handles = new WeakSet(); rec.lease = usage({});
  }
  function failed(rec, cause) {
    if (!rec.cleanupError) {
      rec.cleanupError = rec.fenceError || error('CLEANUP', 'Doctor native cleanup is fenced. Retry the exact cleanup or reload.', cause);
      rememberCleanup(rec.cleanupError, rec, { retry: () => retry(rec), ready: () => rec.closed });
      rec.parent?.failures.set(rec, rec.cleanupError);
    }
    return rec.cleanupError;
  }
  function unavailable(rec, cause) { if (!rec.unavailable) rec.unavailable = { cause }; return failed(rec, cause); }
  function attempt(rec, entry, retrying = false) {
    if (entry.first && (!retrying || !entry.failed)) return entry.first;
    if (entry.unavailable) return Promise.reject(failed(rec, entry.error));
    if (entry.first) (entry.attempts ||= []).push({ first: entry.first, raw: entry.raw, native: entry.native, error: entry.error });
    if (++rec.attemptCount > DOCTOR_LIMITS.pageVisits) return Promise.reject(unavailable(rec, error('WORK_LIMIT', 'Cleanup attempt limit reached.')));
    const gate = deferred(); entry.first = gate.promise; entry.failed = false;
    // Cache before touching fallible method getters or invoking native code.
    Promise.resolve().then(async () => {
      let value;
      try {
        const method = entry.handle[entry.method];
        if (typeof method !== 'function') throw new TypeError('Native cleanup method unavailable.');
        value = apply(method, entry.handle, []);
      } catch (cause) { entry.failed = true; entry.error = cause; if (entry.method === 'destroy') entry.unavailable = true; throw cause; }
      if (entry.method === 'cleanup') {
        if (value !== true) { entry.failed = true; entry.error = value; throw value; }
      } else {
        entry.raw = value;
        try { entry.native = nativeFirst(value); }
        catch (cause) { entry.unavailable = true; entry.failed = true; entry.error = cause; throw cause; }
        try { await entry.native; } catch (cause) { entry.failed = true; entry.error = cause; throw cause; }
      }
      entry.done = true;
    }).then(gate.resolve, cause => { entry.failed = true; entry.error = cause; failed(rec, cause); gate.reject(cause); });
    // Cleanup may be initiated by an abort event before the finalizer awaits it.
    gate.promise.catch(() => {});
    return gate.promise;
  }
  function cleanupEntry(rec, handle, method) {
    let entry = rec.cleanups.find(value => value.handle === handle && value.method === method);
    if (!entry) { entry = { handle, method, first: null, failed: false, done: false, unavailable: false }; rec.cleanups.push(entry); }
    return entry;
  }
  async function pageCleanup(rec, entry, retrying = false) {
    if (entry.contextAck) return entry.contextAck;
    // A failed page FIRST retains its identity until an explicit Retry. Once
    // the loading task really destroyed its context, cleanup on that destroyed
    // page cannot be demanded again. The tracked destroy FIRST supplies the ack.
    if (entry.first && (entry.done || entry.failed && !retrying)) return entry.first;
    const destroy = rec.cleanups.find(value => value.handle === rec.task && value.method === 'destroy');
    if (destroy?.first) {
      await destroy.first;
      if (destroy.done) { entry.contextAck = destroy.first; return entry.contextAck; }
    }
    return attempt(rec, entry, retrying);
  }
  async function cleanup(rec, retrying = false) {
    const settled = await Promise.allSettled(rec.cleanups.map(entry => entry.method === 'cleanup' ? pageCleanup(rec, entry, retrying) : entry.done ? entry.first : attempt(rec, entry, retrying)));
    const bad = settled.find(value => value.status === 'rejected');
    if (rec.unavailable || bad) throw failed(rec, rec.unavailable ? rec.unavailable.cause : bad.reason);
  }
  function cancelNative(rec) {
    for (const render of rec.renders) if (!render.canceled) {
      render.canceled = true;
      try { const method = render.handle.cancel; if (typeof method !== 'function') throw new TypeError('Render cancellation unavailable.'); apply(method, render.handle, []); }
      catch (cause) { unavailable(rec, cause); }
    }
    if (rec.task) void attempt(rec, cleanupEntry(rec, rec.task, 'destroy')).catch(() => {});
  }
  async function retry(rec) {
    if (rec.retryFirst) return rec.retryFirst;
    const gate = deferred(); rec.retryFirst = gate.promise;
    Promise.resolve().then(async () => {
      if (rec.closed) return;
      if (!rec.actualSettled || rec.unavailable || !rec.cleanups.some(entry => entry.failed && !entry.unavailable)) throw rec.fenceError || rec.cleanupError;
      await cleanup(rec, true);
      release(rec); rec.first = null;
      if (active === rec) active = null;
    }).then(gate.resolve, gate.reject).finally(() => { if (rec.retryFirst === gate.promise) rec.retryFirst = null; });
    return gate.promise;
  }
  function inspect(pdfjs, bytes, options, callback) {
    if (active) return Promise.reject(active.fenceError || active.cleanupError || new DOMException('Another Doctor native operation is active.', 'InvalidStateError'));
    const gate = deferred(), envelope = deferred(), controller = new AbortController(), signal = apply(controllerSignal, controller, []);
    const rec = { first: gate.promise, envelope: envelope.promise, controller, signal, started: clock(), task: null, handles: new WeakSet(), native: [], rawFirsts: [], works: [], getters: [], renders: [], cleanups: [], attemptCount: 0, lease: usage({}), unavailable: null, cleanupError: null, fenceError: null, retryFirst: null, closed: false, finishing: false, actualSettled: false };
    gate.promise.catch(() => {});
    rec.expire = chosen => {
      if (rec.closed || rec.actualSettled || rec.fenceError) return;
      if (!chosen && rec.parent) { rec.parent.expire(); if (rec.fenceError) return; }
      rec.fenceError = rec.cleanupError || chosen || error('TIMEOUT', 'Doctor operation deadline elapsed. Native finalization remains fenced.');
      envelope.reject(rec.fenceError);
      apply(abort, controller, [rec.fenceError]);
    };
    active = rec; // Both envelopes exist before caller callbacks/native getters.
    rec.operationDeadline = rec.started + DOCTOR_LIMITS.operationMs;
    let operationTimer = later(() => rec.expire(), DOCTOR_LIMITS.operationMs);
    Promise.resolve().then(async () => {
      let external, listener, timer, result, caught, rejected = false;
      let expected, isCurrent, getUsage, admitUsage, assets, deadline = Infinity;
      function guard(next = rec.lease) {
        next = usage(Object.fromEntries(usageKeys.map(key => [key, Math.max(rec.lease[key], next[key])])));
        let current, captured;
        try { current = isCurrent(); admitUsage(next); captured = getUsage(); }
        catch (cause) { check(signal); throw cause; }
        record(captured, ['snapshot', 'live']);
        const snapshot = data(captured, 'snapshot'), live = data(captured, 'live');
        const actual = owner(snapshot);
        assertDoctorBudget(snapshot, live, next);
        if (clock() >= rec.operationDeadline) rec.expire();
        if (clock() >= deadline) apply(abort, controller, [error('TIMEOUT', 'Doctor phase deadline elapsed.')]);
        check(signal);
        if (current !== true || !same(expected, actual)) throw replaced();
        rec.lease = next;
      }
      function work(start, next) {
        if (rec.closed || rec.finishing) return Promise.reject(new DOMException('Doctor inspection scope is closed.', 'InvalidStateError'));
        if (typeof start !== 'function') return Promise.reject(new TypeError('A native work producer is required.'));
        if (rec.works.length >= DOCTOR_LIMITS.pageVisits) return Promise.reject(error('WORK_LIMIT', 'Doctor native operation limit reached.'));
        const first = deferred(); rec.works.push(first.promise); rec.getters.push(first.promise);
        Promise.resolve().then(async () => {
          guard(usage(next));
          let raw;
          try { raw = start(); }
          catch (cause) { throw unavailable(rec, cause); }
          let native;
          rec.rawFirsts.push(raw);
          try { native = nativeFirst(raw); rec.native.push(native); }
          catch (cause) { throw unavailable(rec, cause); }
          const value = await native; guard(); return value;
        }).then(first.resolve, cause => { try { if (cleanupRecords.has(cause)) throw cause; check(signal); throw cause; } catch (mapped) { first.reject(mapped); } });
        first.promise.catch(() => {}); return first.promise;
      }
      function withPage(number, fn) {
        if (rec.closed || rec.finishing) return Promise.reject(new DOMException('Doctor inspection scope is closed.', 'InvalidStateError'));
        if (rec.works.length >= DOCTOR_LIMITS.pageVisits) return Promise.reject(error('WORK_LIMIT', 'Doctor page visit limit reached.'));
        const first = deferred(); rec.works.push(first.promise);
        Promise.resolve().then(async () => {
          if (!Number.isSafeInteger(number) || number < 1 || number > rec.pageCount || typeof fn !== 'function') throw new TypeError('A validated Doctor page is required.');
          guard();
          let page = await work(() => rec.doc.getPage(number), rec.lease);
          if (!page || typeof page !== 'object') throw unavailable(rec, new TypeError('Native page unavailable.'));
          rec.handles.add(page); const release = cleanupEntry(rec, page, 'cleanup'), renders = [], getterStart = rec.getters.length;
          let pageClosed = false;
          const pageScope = Object.freeze({
            render(renderOptions) {
              if (rec.closed || rec.finishing || pageClosed) return Promise.reject(new DOMException('Doctor inspection scope is closed.', 'InvalidStateError'));
              if (rec.works.length >= DOCTOR_LIMITS.pageVisits) return Promise.reject(error('WORK_LIMIT', 'Doctor render limit reached.'));
              const firstRender = deferred(); rec.works.push(firstRender.promise); renders.push(firstRender.promise);
              Promise.resolve().then(async () => {
                guard(); let task;
                try { task = page.render(renderOptions); }
                catch (cause) { throw unavailable(rec, cause); }
                if (!task || typeof task !== 'object') throw unavailable(rec, new TypeError('Native render task unavailable.'));
                const entry = { handle: task, canceled: false }; rec.renders.push(entry); rec.handles.add(task);
                let native;
                try { native = task.promise; entry.raw = native; rec.rawFirsts.push(native); entry.first = nativeFirst(native); rec.native.push(entry.first); }
                catch (cause) { throw unavailable(rec, cause); }
                if (apply(aborted, signal, [])) cancelNative(rec);
                await entry.first; guard();
              }).then(firstRender.resolve, cause => { try { if (cleanupRecords.has(cause)) throw cause; check(signal); throw cause; } catch (mapped) { firstRender.reject(mapped); } });
              firstRender.promise.catch(() => {}); return firstRender.promise;
            },
          });
          try { guard(); const value = await fn(page, pageScope); guard(); return value; }
          finally {
            try {
              // Only registered getter FIRSTs belong in this window: including
              // withPage's own wrapper here would await this finalizer itself.
              let getters = -1, rendered = -1;
              while (getters !== rec.getters.length || rendered !== renders.length) {
                getters = rec.getters.length; rendered = renders.length;
                await Promise.allSettled([...rec.getters.slice(getterStart), ...renders]);
              }
              pageClosed = true;
              await pageCleanup(rec, release).catch(cause => { throw failed(rec, cause); });
            } finally { pageClosed = true; page = null; }
          }
        }).then(first.resolve, first.reject);
        first.promise.catch(() => {}); return first.promise;
      }
      try {
        record(options, ['signal', 'pdfjsAssets', 'expectedOwner', 'isCurrent', 'getUsage', 'admitUsage', 'timeoutMs'], ['expectedOwner', 'isCurrent', 'getUsage', 'admitUsage']);
        expected = owner(data(options, 'expectedOwner'));
        isCurrent = data(options, 'isCurrent'); getUsage = data(options, 'getUsage'); admitUsage = data(options, 'admitUsage');
        if ([isCurrent, getUsage, admitUsage, callback].some(value => typeof value !== 'function')) throw new TypeError('Owned Doctor usage callbacks are required.');
        external = has(options, 'signal') ? data(options, 'signal') : undefined; brand(external);
        rec.parent = external == null ? null : operationScopes.get(external);
        if (rec.parent) {
          rec.parent.children.add(rec); stopTimer(operationTimer);
          rec.operationDeadline = Math.min(rec.operationDeadline, rec.parent.deadline);
          operationTimer = later(() => rec.expire(), Math.max(0, rec.operationDeadline - clock()));
        }
        assets = has(options, 'pdfjsAssets') ? data(options, 'pdfjsAssets') : {};
        record(assets, ['standardFontDataUrl', 'cMapUrl', 'cMapPacked', 'wasmUrl'], []);
        assets = Object.fromEntries(Object.keys(assets).map(key => [key, data(assets, key)]));
        for (const [key, value] of Object.entries(assets)) if (key === 'cMapPacked' ? typeof value !== 'boolean' : typeof value !== 'string' || value.length > 2048) throw new TypeError('Invalid PDF asset declaration.');
        const timeout = has(options, 'timeoutMs') ? data(options, 'timeoutMs') : DOCTOR_LIMITS.phaseMs;
        if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > DOCTOR_LIMITS.phaseMs) throw new TypeError('Invalid Doctor deadline.');
        listener = () => apply(abort, controller, [apply(reason, external, [])]);
        if (external != null) apply(add, external, ['abort', listener, { once: true }]);
        apply(add, signal, ['abort', () => cancelNative(rec), { once: true }]);
        if (external != null && apply(aborted, external, [])) listener();
        deadline = rec.started + timeout;
        timer = later(() => apply(abort, controller, [error('TIMEOUT', 'Doctor phase deadline elapsed.')]), timeout);
        const backing = apply(buffer, bytes, []), start = apply(offset, bytes, []), count = apply(length, bytes, []);
        apply(backingLength, backing, []);
        if (apply(arrayTag, bytes, []) !== 'Uint8Array' || resizable && apply(resizable, backing, []) || !count || count > DOCTOR_LIMITS.inputBytes) throw new TypeError('Doctor input requires bounded fixed nonempty Uint8Array backing.');
        // Bounded diagnostic traversal/serialization scratch is reserved before
        // loading, alongside the caller's separately retained report lease.
        guard(usage({ artifactBytes: count, expandedBytes: DOCTOR_LIMITS.reportUnits * 2 + 10000 * 64, expandedCount: 2 }));
        const input = new Uint8Array(count); apply(copyBytes, input, [new Uint8Array(backing, start, count)]); bytes = null;
        let method;
        try { method = pdfjs.getDocument; if (typeof method !== 'function') throw new TypeError('PDF.js loading method unavailable.'); }
        catch (cause) { throw unavailable(rec, cause); }
        guard(); let task;
        try { task = apply(method, pdfjs, [{ data: input, ...assets, stopAtErrors: true }]); }
        catch (cause) { throw unavailable(rec, cause); }
        if (!task || typeof task !== 'object') throw unavailable(rec, new TypeError('PDF.js loading task unavailable.'));
        rec.task = task; rec.handles.add(task); cleanupEntry(rec, task, 'destroy');
        let first;
        try { first = task.promise; rec.rawFirsts.push(first); rec.load = nativeFirst(first); rec.native.push(rec.load); }
        catch (cause) { throw unavailable(rec, cause); }
        if (apply(aborted, signal, [])) cancelNative(rec);
        rec.doc = await rec.load;
        if (!rec.doc || typeof rec.doc !== 'object') throw unavailable(rec, new TypeError('PDF.js document unavailable.'));
        rec.handles.add(rec.doc);
        rec.pageCount = rec.doc.numPages;
        if (!Number.isSafeInteger(rec.pageCount) || rec.pageCount < 1 || rec.pageCount > DOCTOR_LIMITS.pages) throw new RangeError('Doctor page limit reached.');
        guard();
        const scope = Object.freeze({ work, withPage }); rec.handles.add(scope);
        result = await callback(rec.doc, scope); guard();
        const bounded = safeResult(result, rec.handles);
        // No caller callback may alter the validated graph after this point.
        for (const object of bounded.objects) Object.freeze(object);
        const captured = getUsage(); record(captured, ['snapshot', 'live']);
        const retained = usage(data(captured, 'live'));
        if (bounded.objects.length && (retained.expandedBytes < bounded.bytes || !retained.expandedCount)) throw error('HANDOFF', 'Register the diagnostic result lease before returning it.');
        guard();
      } catch (cause) { rejected = true; caught = rec.handles.has(cause) ? error('NATIVE', 'A native handle cannot be published as an inspection failure.') : cause; }
      finally {
        // A callback may forget to await a registered operation. Its FIRST still
        // belongs to this lifetime and prevents physical-release claims.
        let count = -1;
        while (count !== rec.works.length) { count = rec.works.length; await Promise.allSettled(rec.works); }
        await Promise.allSettled(rec.native);
        rec.finishing = true;
        try { await cleanup(rec); }
        catch (cause) { rejected = true; caught = cause; }
        if (timer) stopTimer(timer);
        if (external != null && listener) apply(remove, external, ['abort', listener]);
      }
      if (rec.cleanupError) throw rec.cleanupError;
      if (rec.fenceError) throw rec.fenceError;
      if (!rejected) guard();
      release(rec);
      check(signal); if (rejected) throw caught; return result;
    }).then(value => {
      rec.actualSettled = true; stopTimer(operationTimer); gate.resolve(value);
      if (!rec.fenceError) { envelope.resolve(value); if (active === rec) active = null; rec.first = null; }
    }, cause => {
      rec.actualSettled = true; stopTimer(operationTimer);
      if (!rec.cleanupError && !rec.fenceError) release(rec);
      const failure = rec.fenceError || rec.cleanupError || cause;
      gate.reject(failure); envelope.reject(failure);
      if (!rec.cleanupError && !rec.fenceError) { if (active === rec) active = null; rec.first = null; }
    });
    return envelope.promise;
  }
  return Object.freeze({
    inspect,
    cancel(value) { if (active) apply(abort, active.controller, [value]); },
    getUsage: () => Object.freeze({ ...(active?.lease || zero()) }),
    async drained(options = {}) {
      record(options, ['retry'], []); const again = has(options, 'retry') ? data(options, 'retry') : false;
      if (typeof again !== 'boolean') throw new TypeError('Cleanup retry is boolean.');
      const rec = active; if (!rec) return;
      await Promise.allSettled([rec.envelope]);
      if (rec.fenceError || rec.cleanupError) {
        if (again && rec.cleanupError) return retry(rec);
        throw rec.fenceError || rec.cleanupError;
      }
      await Promise.allSettled([rec.first]);
    },
  });
}

export function createDoctorWorkQueue(run) {
  if (typeof run !== 'function') throw new TypeError('A Doctor work function is required.');
  let generation = 0, active = null, pending = null;
  function rejectPending(cause) {
    if (pending) { apply(abort, pending.controller, [cause]); pending.reject(apply(reason, pending.signal, [])); pending = null; }
  }
  function cancel(value) {
    generation++;
    if (active) apply(abort, active.controller, [value]);
    rejectPending(value);
  }
  function pump() {
    if (active || !pending) return;
    const rec = pending; pending = null; active = rec;
    const first = deferred(), finalized = deferred(); rec.first = first.promise; rec.finalized = finalized.promise;
    rec.started = clock(); rec.actualSettled = false;
    rec.scope = { deadline: rec.started + DOCTOR_LIMITS.operationMs, children: new Set(), failures: new Map() };
    operationScopes.set(rec.signal, rec.scope);
    const expire = () => {
      if (rec.actualSettled || rec.fence) return;
      const earlier = [...rec.scope.failures].find(([child]) => !child.closed)?.[1];
      rec.fence = rec.cleanup || earlier || error('TIMEOUT', 'Doctor operation deadline elapsed. Native finalization remains fenced.');
      // Settle public callers before cancellation callbacks, retaining every
      // actual job/child FIRST and its charged finalization barrier.
      rec.reject(rec.fence); rejectPending(rec.fence);
      for (const child of rec.scope.children) child.expire(rec.fence);
      apply(abort, rec.controller, [rec.fence]);
    };
    rec.scope.expire = expire;
    const current = () => generation === rec.generation && !apply(aborted, rec.signal, []);
    const assertCurrent = () => { if (clock() >= rec.scope.deadline) expire(); check(rec.signal); if (!current()) throw replaced(); };
    const timer = later(expire, DOCTOR_LIMITS.operationMs);
    Promise.resolve().then(() => {
      assertCurrent();
      try { rec.raw = run(rec.request, Object.freeze({ signal: rec.signal, isCurrent: current, assertCurrent })); }
      catch (cause) { rec.cleanup = error('CLEANUP', 'The work callback threw before an observable FIRST. Reload before another job.', cause); throw rec.cleanup; }
      try { rec.native = nativeFirst(rec.raw); }
      catch (cause) { rec.cleanup = error('CLEANUP', 'The work callback supplied no observable genuine FIRST. Reload before another job.', cause); throw rec.cleanup; }
      return rec.native;
    }).then(first.resolve, first.reject);
    first.promise.then(value => { assertCurrent(); if (!rec.fence) rec.resolve(value); }, cause => {
      if (rec.fence) throw rec.fence;
      if (cleanupRecords.has(cause) || rec.cleanup === cause) { rec.cleanup = cause; throw cause; }
      // External cleanup cannot be converted to cancellation or acknowledged.
      if (cause && typeof cause === 'object' && own(cause, 'code')?.value === 'PRIVACY_CLEANUP') { rec.cleanup = cause; throw cause; }
      assertCurrent(); throw cause;
    }).catch(rec.reject).finally(() => {
      stopTimer(timer); rec.request = null; rec.actualSettled = true;
      if (rec.fence || rec.cleanup) rejectPending(rec.fence || rec.cleanup);
      else { rec.first = rec.raw = rec.native = null; operationScopes.delete(rec.signal); active = null; pump(); }
      finalized.resolve();
    });
  }
  return Object.freeze({
    submit(request) {
      if (active?.fence || active?.cleanup) return Promise.reject(active.fence || active.cleanup);
      cancel();
      const envelope = deferred(), controller = new AbortController();
      pending = { request, resolve: envelope.resolve, reject: envelope.reject, envelope: envelope.promise, controller, signal: apply(controllerSignal, controller, []), generation };
      pump(); return envelope.promise;
    },
    cancel,
    async drained(options = {}) {
      record(options, ['retry'], []); const again = has(options, 'retry') ? data(options, 'retry') : false;
      if (typeof again !== 'boolean') throw new TypeError('Cleanup retry is boolean.');
      while (active || pending) {
        if (!active) pump();
        const held = active;
        await Promise.allSettled([held.envelope]);
        if (held.fence && !held.actualSettled) throw held.fence;
        await held.finalized;
        if (active === held && (held.fence || held.cleanup)) {
          const failure = held.fence || held.cleanup, proof = cleanupRecords.get(failure);
          if (!again || !proof) throw failure;
          await proof.retry();
          if (!proof.ready() || [...held.scope.children].some(child => !child.closed)) throw failure;
          if (active === held) { held.first = held.raw = held.native = null; operationScopes.delete(held.signal); active = null; pump(); }
        }
      }
    },
  });
}
