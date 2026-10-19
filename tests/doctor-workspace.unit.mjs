import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentSession } from '../public/js/core/document-session.js';
import { DOCTOR_LIMITS, assertDoctorBudget, createDoctorWorkBudget, doctorView, recommendDoctor, rebuildPagePolicy } from '../public/js/core/doctor-policy.js';
import { createDoctorPdfLifetime, createDoctorWorkQueue } from '../public/js/core/doctor-lifetime.js';

// All PDF.js shapes below are explicit synthetic portable facades. No PDF
// engine, asset, browser, canvas, font, encoder or saved artifact is exercised.
const MiB = 1024 * 1024;
const input = () => new Uint8Array([37, 80, 68, 70, 45, 49]); // Opaque session bytes, not a parsed PDF fixture.
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let n = 0; n < 100 && !predicate(); n++) await new Promise(resolve => setTimeout(resolve, 1)); assert.ok(predicate(), 'portable operation reached its held boundary'); }
function rejected(promise) { return promise.then(() => { assert.fail('expected rejection'); }, value => value); }
function metadata() {
  const session = createDocumentSession();
  return { session, live: { expandedBytes: 2 * MiB, expandedCount: 1 }, admissions: [], get snapshot() { return session.snapshot(); } };
}
function controls(state, extra = {}) {
  return { expectedOwner: state.snapshot, isCurrent: () => true, getUsage: () => ({ snapshot: state.snapshot, live: state.live }), admitUsage: next => state.admissions.push(next), ...extra };
}
function facade(options = {}) {
  const count = { open: 0, destroy: 0, page: 0, cleanup: 0, render: 0, cancel: 0 };
  const pages = [], tasks = [], configs = [];
  const pdfjs = {
    getDocument(config) {
      count.open++; configs.push(config);
      const page = {
        cleanup() { count.cleanup++; return options.cleanup ? options.cleanup(count) : true; },
        render(renderOptions) {
          count.render++;
          const render = { promise: options.render ? options.render(count) : Promise.resolve(), cancel() { count.cancel++; } };
          if (options.renderTask) return options.renderTask(render, count);
          return render;
        },
      };
      pages.push(page);
      const doc = { numPages: 2, getPage(n) { count.page++; return options.page ? options.page(page, count) : Promise.resolve(page); } };
      const task = { promise: options.load ? options.load(doc, count) : Promise.resolve(doc), destroy() { count.destroy++; return options.destroy ? options.destroy(count) : Promise.resolve(); } };
      tasks.push(task);
      return options.task ? options.task(task, count) : task;
    },
  };
  return { pdfjs, count, pages, tasks, configs };
}
const checks = ['pageTree', 'boxes', 'metadata', 'attachments', 'annotations', 'actions', 'forms', 'signatures', 'tags', 'language', 'title', 'alt', 'operators', 'text', 'render'];
function report() {
  return { version: 2, mode: 'deep', status: 'complete', pageCount: 2,
    parsers: { strict: { status: 'ok', reason: 'none' }, tolerant: { status: 'skipped', reason: 'not-requested' }, pdfjs: { status: 'ok', reason: 'none' } },
    checks: Object.fromEntries(checks.map(key => [key, { status: 'complete', count: key === 'render' ? 2 : 0, lowerBound: false, pages: [] }])),
    recommendation: { remedy: 'inspect', reason: 'none' }, coverage: { pagesChecked: 2, renderedPages: [1, 2], omitted: 0, complete: true } };
}

test('real empty and populated nineteen-field session metadata is admitted without byte access', () => {
  const session = createDocumentSession(), empty = session.snapshot();
  assert.equal(Object.keys(empty).length, 19);
  assert.equal(assertDoctorBudget(empty).retainedBytes, 0);
  session.begin(input(), 'opaque-session.pdf');
  const populated = session.snapshot();
  assert.equal(Object.keys(populated).length, 19);
  Object.defineProperty(populated, 'current', { get() { assert.fail('unneeded metadata getter read'); } });
  assert.equal(assertDoctorBudget(populated).retainedBytes, input().length);
});
test('budget projects required own data, rejects forged getters and exact usage extras without invoking them', () => {
  const snapshot = metadata().snapshot;
  const inherited = Object.create({ retainedBytes: 0, resourceBytes: 0, resourceCount: 0 });
  assert.throws(() => assertDoctorBudget(inherited), TypeError);
  for (const key of ['retainedBytes', 'resourceBytes', 'resourceCount']) {
    const value = { ...snapshot }; Object.defineProperty(value, key, { get() { assert.fail('required getter invoked'); } });
    assert.throws(() => assertDoctorBudget(value), TypeError);
  }
  const value = {}; Object.defineProperty(value, 'expandedBytes', { get() { assert.fail('usage getter invoked'); }, enumerable: true });
  assert.throws(() => assertDoctorBudget(snapshot, value), TypeError);
  assert.throws(() => assertDoctorBudget(snapshot, { extra: 1 }), TypeError);
  assert.throws(() => assertDoctorBudget(snapshot, { artifactBytes: Number.MAX_SAFE_INTEGER }, { artifactBytes: 1 }), TypeError);
});
for (const [name, snapshot, extra] of [
  ['512MiB', { retainedBytes: 512 * MiB - 1, resourceBytes: 0, resourceCount: 0 }, { artifactBytes: 1 }],
  ['96MiB', { retainedBytes: 96 * MiB - 1, resourceBytes: 96 * MiB - 1, resourceCount: 1 }, { expandedBytes: 1 }],
  ['128entries', { retainedBytes: 0, resourceBytes: 0, resourceCount: 127 }, { expandedCount: 1 }],
]) test(`joint ${name} exact arithmetic boundary has no private allowance`, () => {
  assert.doesNotThrow(() => assertDoctorBudget(snapshot, {}, extra));
  const key = Object.keys(extra)[0];
  assert.throws(() => assertDoctorBudget(snapshot, {}, { [key]: 2 }), { code: 'DOCTOR_BUDGET' });
});
test('work deltas are finite cumulative and failed multikey admission is atomic', () => {
  const budget = createDoctorWorkBudget({ nodes: 2, edges: 3 });
  budget.admit({ nodes: 1 });
  assert.throws(() => budget.admit({ edges: 4, nodes: 1 }), { code: 'DOCTOR_WORK_LIMIT' });
  assert.equal(budget.usage().nodes, 1); assert.equal(budget.usage().edges, 0);
  assert.throws(() => budget.admit({ nodes: -1 }), TypeError);
  assert.throws(() => budget.admit({ pixels: Infinity }), TypeError);
  assert.throws(() => budget.admit({ refund: 1 }), TypeError);
  assert.throws(() => createDoctorWorkBudget({ nodes: DOCTOR_LIMITS.nodes + 1 }), TypeError);
  assert.throws(() => createDoctorWorkBudget({ depth: 0 }), TypeError);
});
test('physical page policy preserves fractional visible dimensions and rejects scale/shrink/getter traps', () => {
  const policy = rebuildPagePolicy({ width: 14400, height: 31.25, scale: 1, other: 'ignored' });
  assert.deepEqual(policy.cropBox, [0, 0, 14400, 31.25]); assert.equal(policy.userUnit, 1); assert.equal(policy.rotation, 0);
  for (const viewport of [{ width: 14401, height: 2, scale: 1 }, { width: 100, height: 100, scale: 0.5 }, { width: NaN, height: 1, scale: 1 }, { width: 0, height: 1, scale: 1 }]) assert.throws(() => rebuildPagePolicy(viewport), { code: 'DOCTOR_GEOMETRY' });
  const viewport = { height: 1, scale: 1 }; Object.defineProperty(viewport, 'width', { get() { assert.fail('viewport getter invoked'); } });
  assert.throws(() => rebuildPagePolicy(viewport), TypeError);
});
test('advice is inspect/normalize and rebuild only when normalizer unavailable plus full deep render evidence', () => {
  const r = report(); assert.equal(recommendDoctor(r).remedy, 'inspect');
  r.parsers.strict = { status: 'failed', reason: 'strict-rejected' }; r.parsers.tolerant = { status: 'ok', reason: 'tolerant-opened' };
  assert.equal(recommendDoctor(r).remedy, 'normalize');
  r.recommendation.remedy = 'rebuild'; r.parsers.tolerant.status = 'skipped';
  assert.equal(recommendDoctor(r).remedy, 'unknown');
  r.parsers.tolerant = { status: 'failed', reason: 'strict-rejected' };
  assert.deepEqual(recommendDoctor(r), { remedy: 'rebuild', reason: 'strict-rejected' });
  assert.equal('consent' in recommendDoctor(r), false);
});
for (const alter of [r => { r.coverage.renderedPages = [1]; }, r => { r.coverage.pagesChecked = 1; }, r => { r.coverage.omitted = 1; }, r => { r.checks.render.count = 1; }, r => { r.status = 'partial'; }, r => { r.checks.forms = { status: 'unknown', count: null, lowerBound: true, pages: [] }; }]) test('misleading complete label or omitted required evidence cannot recommend a repair', () => {
  const r = report(); alter(r); assert.equal(recommendDoctor(r).remedy, 'unknown');
});
test('unknown counts cannot be forged as zero; locked requires finite typed password reason', () => {
  const r = report(); r.checks.metadata.status = 'unknown';
  assert.throws(() => recommendDoctor(r), TypeError);
  r.checks.metadata.count = null; assert.equal(recommendDoctor(r).remedy, 'unknown');
  r.parsers.pdfjs = { status: 'locked', reason: 'native-failed' }; assert.throws(() => recommendDoctor(r), TypeError);
  r.parsers.pdfjs.reason = 'password-required'; assert.equal(recommendDoctor(r).remedy, 'unlock');
});
test('view copies bounded own data, validates pages/getters and never forwards arbitrary properties or consent', () => {
  const r = report(); r.checks.annotations.pages = [2]; r.checks.annotations.count = 1;
  const view = doctorView(r, { page: 2 }); assert.equal(view.rows[0].page, 2);
  view.categories[4].pages.push(1); assert.deepEqual(r.checks.annotations.pages, [2]);
  r.checks.annotations.pages = [3]; assert.throws(() => doctorView(r), TypeError);
  r.checks.annotations.pages = []; r.recommendation.consent = true; assert.throws(() => doctorView(r), TypeError);
  delete r.recommendation.consent; Object.defineProperty(r.coverage, 'complete', { get() { assert.fail('DTO getter invoked'); } });
  assert.throws(() => doctorView(r), TypeError);
});

test('synthetic load owns one input copy, uses strict parsing, drains task and keeps registered recipient report lease', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime(); let recipient;
  const shown = await lifetime.inspect(native.pdfjs, input(), controls(state), doc => { recipient = { pageCount: doc.numPages }; return recipient; });
  assert.equal(shown, recipient); assert.ok(Object.isFrozen(shown)); assert.equal(native.count.destroy, 1);
  assert.equal(native.configs[0].stopAtErrors, true); assert.equal(lifetime.getUsage().artifactBytes, 0);
  assert.equal(state.live.expandedBytes, 2 * MiB);
  assert.ok(state.admissions.some(value => value.artifactBytes === input().length));
});
test('synthetic held load plus cancel cannot release usage or admit a successor after destroy alone', async () => {
  const load = deferred(), state = metadata(), lifetime = createDoctorPdfLifetime(); let doc;
  const native = facade({ load(value) { doc = value; return load.promise; } });
  const operation = rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null));
  await until(() => native.count.open === 1); lifetime.cancel(false);
  await until(() => native.count.destroy === 1);
  let drained = false; const barrier = lifetime.drained().then(() => { drained = true; });
  await turn(); assert.equal(drained, false); assert.equal(lifetime.getUsage().artifactBytes, input().length);
  assert.equal((await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null))).name, 'InvalidStateError');
  load.resolve(doc); assert.equal(await operation, false); await barrier;
  assert.equal(lifetime.getUsage().artifactBytes, 0);
});
for (const value of [null, false, 0, '']) for (const rejects of [false, true]) test(`synthetic held native ${rejects ? 'rejection' : 'fulfillment'} preserves genuine falsy cancel ${String(value)}`, async () => {
  const held = deferred(), state = metadata(), lifetime = createDoctorPdfLifetime(); let doc;
  const native = facade({ load(d) { doc = d; return held.promise; } });
  const result = rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null));
  await until(() => native.count.open === 1); lifetime.cancel(value);
  if (rejects) held.reject(new Error('synthetic native rejection')); else held.resolve(doc);
  assert.ok(Object.is(await result, value)); assert.equal(native.count.destroy, 1); await lifetime.drained();
});
test('synthetic cleanup FIRST remains pending after work rejects and prevents successor/capacity release', async () => {
  const held = deferred(), native = facade({ load: () => Promise.reject(new Error('load failed')), destroy: () => held.promise });
  const state = metadata(), lifetime = createDoctorPdfLifetime(); let settled = false;
  const operation = rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null)).then(value => { settled = true; return value; });
  await until(() => native.count.destroy === 1); await turn(); assert.equal(settled, false);
  assert.equal(lifetime.getUsage().artifactBytes, input().length);
  held.resolve(); assert.equal((await operation).message, 'load failed'); await lifetime.drained();
});
test('synthetic false destroy rejection wins over null cancel; stable error/usage survive exact held Retry without reparse', async () => {
  const retry = deferred(), state = metadata(), lifetime = createDoctorPdfLifetime();
  const native = facade({ destroy: count => count.destroy === 1 ? Promise.reject(false) : retry.promise });
  const result = rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => { lifetime.cancel(null); return null; }));
  const failure = await result; assert.equal(failure.code, 'DOCTOR_CLEANUP'); assert.equal(failure.cause, false);
  assert.equal(await rejected(lifetime.drained()), failure);
  assert.equal(await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null)), failure);
  let closed = false; const recovery = lifetime.drained({ retry: true }).then(() => { closed = true; });
  await until(() => native.count.destroy === 2); await turn(); assert.equal(closed, false); assert.equal(native.count.open, 1);
  assert.equal(lifetime.getUsage().artifactBytes, input().length); retry.resolve(); await recovery;
  assert.equal(native.count.open, 1); assert.equal(lifetime.getUsage().artifactBytes, 0);
});
test('synthetic page cleanup false retains exact page; explicit retry accepts successful task context acknowledgment', async () => {
  const native = facade({ cleanup: count => count.cleanup > 1 }), state = metadata(), lifetime = createDoctorPdfLifetime();
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), async (_, scope) => scope.withPage(2, () => null)));
  assert.equal(failure.code, 'DOCTOR_CLEANUP'); assert.equal(failure.cause, false);
  assert.equal(native.count.cleanup, 1); assert.equal(native.count.destroy, 1);
  await lifetime.drained({ retry: true }); assert.equal(native.count.cleanup, 1); assert.equal(native.count.destroy, 1); assert.equal(native.count.open, 1);
});
test('synthetic held render remains FIRST after cancel, page cleanup waits and original render cancel happens once', async () => {
  const held = deferred(), native = facade({ render: () => held.promise }), state = metadata(), lifetime = createDoctorPdfLifetime();
  const operation = rejected(lifetime.inspect(native.pdfjs, input(), controls(state), async (_, scope) => scope.withPage(1, async (_page, page) => { await page.render({}); return null; })));
  await until(() => native.count.render === 1); lifetime.cancel(0); lifetime.cancel(0);
  await turn(); assert.equal(native.count.cancel, 1); assert.equal(native.count.cleanup, 0);
  assert.equal(lifetime.getUsage().artifactBytes, input().length); held.reject(new Error('render canceled')); assert.equal(await operation, 0);
  assert.equal(native.count.cleanup, 0); assert.equal(native.count.destroy, 1);
});
for (const missing of ['false', 'throw']) test(`synthetic task.promise ${missing} cannot fabricate physical exit after successful destroy`, async () => {
  const native = facade({ task(task) { Object.defineProperty(task, 'promise', { get() { if (missing === 'throw') throw new Error('FIRST getter failed'); return false; } }); return task; } });
  const state = metadata(), lifetime = createDoctorPdfLifetime();
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null));
  assert.equal(failure.code, 'DOCTOR_CLEANUP'); assert.equal(native.count.destroy, 1);
  assert.equal(await rejected(lifetime.drained({ retry: true })), failure); assert.equal(native.count.destroy, 1);
  assert.equal(lifetime.getUsage().artifactBytes, input().length);
});
test('synthetic render promise getter reentry sees cached handle/FIRST and remains fenced when getter returns false', async () => {
  const state = metadata(), lifetime = createDoctorPdfLifetime(); let reentry;
  const native = facade({ renderTask(task) { Object.defineProperty(task, 'promise', { get() { reentry = rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null)); lifetime.cancel(false); return false; } }); return task; } });
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), async (_, scope) => scope.withPage(1, async (_page, page) => { await page.render({}); return null; })));
  assert.equal((await reentry).name, 'InvalidStateError'); assert.equal(failure.code, 'DOCTOR_CLEANUP');
  assert.equal(native.count.cancel, 1); assert.equal(native.count.destroy, 1); assert.equal(native.count.open, 1);
  assert.equal(await rejected(lifetime.drained({ retry: true })), failure);
});
test('synthetic native Promise own then getter is bypassed while genuine FIRST still drains', async () => {
  const promise = Promise.resolve(); Object.defineProperty(promise, 'then', { get() { assert.fail('own then read'); } });
  const native = facade({ destroy: () => promise }), state = metadata(), lifetime = createDoctorPdfLifetime();
  await lifetime.inspect(native.pdfjs, input(), controls(state), () => null); assert.equal(native.count.destroy, 1);
});
test('admission callback mutation of actual canonical owner is checked after callbacks before native load', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime();
  const result = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state, { admitUsage() { state.session.begin(input(), 'new-owner.pdf'); } }), () => null));
  assert.equal(result.name, 'AbortError'); assert.equal(native.count.open, 0);
});
test('genuine falsy signal after throwing admission callback survives with intrinsic own overrides ignored', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime(), external = new AbortController();
  for (const key of ['aborted', 'reason', 'addEventListener', 'removeEventListener']) Object.defineProperty(external.signal, key, { get() { assert.fail(`own ${key} read`); } });
  const result = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state, { signal: external.signal, admitUsage() { external.abort(''); throw new Error('admission threw'); } }), () => null));
  assert.equal(result, ''); assert.equal(native.count.open, 0); await lifetime.drained();
});
test('callback reentry observes cached FIRST; held diagnostic getter cannot release lifetime or original parser copy', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime(), held = deferred(); let barrierClosed = false, scopeSaved;
  const op = lifetime.inspect(native.pdfjs, input(), controls(state), async (_doc, scope) => {
    scopeSaved = scope;
    void lifetime.drained().then(() => { barrierClosed = true; });
    await scope.work(() => held.promise, {}); return null;
  });
  await until(() => !!scopeSaved); await turn(); assert.equal(barrierClosed, false); assert.equal(lifetime.getUsage().artifactBytes, input().length);
  held.resolve(42); await op; await lifetime.drained();
  assert.equal((await rejected(scopeSaved.work(() => Promise.resolve(), {}))).name, 'InvalidStateError');
});
test('native cleanup callback owner mutation loses publication despite successful physical cleanup', async () => {
  const state = metadata(), lifetime = createDoctorPdfLifetime(), native = facade({ destroy() { state.session.begin(input(), 'later.pdf'); return Promise.resolve(); } });
  const result = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null)); assert.equal(result.name, 'AbortError');
  assert.equal(native.count.destroy, 1); assert.equal(lifetime.getUsage().artifactBytes, 0);
});
test('deadline cancels/fences held synthetic load without claiming exit or capacity; eventual native rejection preserves timeout', async () => {
  const held = deferred(), native = facade({ load: () => held.promise }), state = metadata(), lifetime = createDoctorPdfLifetime(); let settled = false;
  const op = rejected(lifetime.inspect(native.pdfjs, input(), controls(state, { timeoutMs: 5 }), () => null)).then(value => { settled = true; return value; });
  await until(() => native.count.destroy === 1); assert.equal(settled, false); assert.equal(lifetime.getUsage().artifactBytes, input().length);
  held.reject(new Error('late load')); assert.equal((await op).code, 'DOCTOR_TIMEOUT'); await lifetime.drained();
});
test('all required usage callbacks and own scalar owner are validated without bypassing near-full joint admission', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime();
  const opts = controls(state); delete opts.getUsage;
  assert.ok(await rejected(lifetime.inspect(native.pdfjs, input(), opts, () => null)) instanceof TypeError);
  const snapshot = { ...state.snapshot, retainedBytes: 512 * MiB - input().length + 1 };
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state, { getUsage: () => ({ snapshot, live: {} }) }), () => null));
  assert.equal(failure.code, 'DOCTOR_BUDGET'); assert.equal(native.count.open, 0);
  assert.equal(lifetime.getUsage().artifactBytes, 0);
});
test('fixed typed backing uses intrinsic fields, rejects shared/resizable/detached and different element arrays', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime(), bytes = input();
  for (const key of ['buffer', 'byteLength', Symbol.iterator]) Object.defineProperty(bytes, key, { get() { assert.fail('own typed getter invoked'); } });
  await lifetime.inspect(native.pdfjs, bytes, controls(state), () => null);
  const cases = [new Uint16Array(4), new Uint8Array(new SharedArrayBuffer(8))];
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) cases.push(new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 })));
  const detached = input(); structuredClone(detached.buffer, { transfer: [detached.buffer] }); cases.push(detached);
  for (const value of cases) assert.ok(await rejected(lifetime.inspect(native.pdfjs, value, controls(state), () => null)) instanceof TypeError);
  assert.equal(native.count.open, 1);
});
test('native handles/getters cannot leave in diagnostic results and unreserved result handoff is refused', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime();
  assert.ok(await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), doc => ({ doc }))) instanceof TypeError);
  const value = {}; Object.defineProperty(value, 'unsafe', { get() { assert.fail('result getter invoked'); }, enumerable: true });
  assert.ok(await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => value)) instanceof TypeError);
  state.live = {};
  assert.equal((await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => ({ pages: 2 })))).code, 'DOCTOR_HANDOFF');
});

test('queue caches original run FIRST before reentry and keeps only latest unread descriptor', async () => {
  const held = deferred(), started = [], tokens = []; let closed = false;
  let queue;
  queue = createDoctorWorkQueue(async (request, job) => { started.push(request); tokens.push(job); if (request === 'A') { void queue.drained().then(() => { closed = true; }); await held.promise; } return request; });
  const a = rejected(queue.submit('A')); await until(() => started.length === 1);
  const b = rejected(queue.submit('B')), c = queue.submit('C'); await turn();
  assert.deepEqual(started, ['A']); assert.equal(closed, false); assert.equal((await b).name, 'AbortError');
  held.resolve(); assert.equal((await a).name, 'AbortError'); assert.equal(await c, 'C'); await queue.drained();
  assert.deepEqual(started, ['A', 'C']); assert.equal(tokens[1].isCurrent(), true); queue.cancel(0); assert.equal(tokens[1].isCurrent(), false);
});
for (const value of [null, false, 0, '']) for (const rejects of [false, true]) test(`queue ${rejects ? 'rejecting' : 'fulfilled'} FIRST maps exact falsy cancel ${String(value)}`, async () => {
  const held = deferred(); let started = false;
  const queue = createDoctorWorkQueue(async () => { started = true; return await held.promise; });
  const result = rejected(queue.submit('A')); await until(() => started); queue.cancel(value);
  if (rejects) held.reject(new Error('original rejected')); else held.resolve(false);
  assert.ok(Object.is(await result, value)); await queue.drained();
});
test('queue retains branded failed cleanup and usage until exact lifetime Retry, never reparses to acknowledge cleanup', async () => {
  const state = metadata(), retry = deferred(), lifetime = createDoctorPdfLifetime();
  const native = facade({ destroy: count => count.destroy === 1 ? Promise.reject(0) : retry.promise });
  const queue = createDoctorWorkQueue(async (_, job) => lifetime.inspect(native.pdfjs, input(), controls(state, { signal: job.signal }), () => null));
  const failure = await rejected(queue.submit('A')); assert.equal(failure.code, 'DOCTOR_CLEANUP'); assert.equal(failure.cause, 0);
  await turn(); assert.equal(await rejected(queue.submit('B')), failure); assert.equal(await rejected(queue.drained()), failure);
  const recovery = queue.drained({ retry: true }); await until(() => native.count.destroy === 2);
  assert.equal(native.count.open, 1); assert.equal(lifetime.getUsage().artifactBytes, input().length);
  retry.resolve(); await recovery; assert.equal(native.count.open, 1); assert.equal(lifetime.getUsage().artifactBytes, 0);
});
test('unowned external cleanup cannot be acknowledged as a physical exit', async () => {
  const failure = Object.assign(new Error('external cleanup'), { code: 'PRIVACY_CLEANUP' }); let runs = 0;
  const queue = createDoctorWorkQueue(async () => { runs++; throw failure; });
  assert.equal(await rejected(queue.submit('A')), failure); await turn();
  assert.equal(await rejected(queue.drained({ retry: true })), failure);
  assert.equal(await rejected(queue.submit('B')), failure); assert.equal(runs, 1);
});
test('synthetic missing page FIRST retains task/input even if task destruction fulfills', async () => {
  const native = facade({ page: () => false }), state = metadata(), lifetime = createDoctorPdfLifetime();
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), async (_, scope) => scope.withPage(1, () => null)));
  assert.equal(failure.code, 'DOCTOR_CLEANUP'); assert.equal(native.count.destroy, 1);
  assert.equal(await rejected(lifetime.drained({ retry: true })), failure); assert.equal(lifetime.getUsage().artifactBytes, input().length);
});
test('synthetic synchronous destroy throw is missing native FIRST, not acknowledgement on a second invocation', async () => {
  const native = facade({ destroy() { throw 0; } }), state = metadata(), lifetime = createDoctorPdfLifetime();
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null));
  assert.equal(failure.code, 'DOCTOR_CLEANUP'); assert.equal(failure.cause, 0);
  assert.equal(await rejected(lifetime.drained({ retry: true })), failure); assert.equal(native.count.destroy, 1);
});
test('synthetic cleanup raw false is not a fulfilled destroy promise or retryable physical proof', async () => {
  const native = facade({ destroy: () => false }), state = metadata(), lifetime = createDoctorPdfLifetime();
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null));
  assert.equal(failure.code, 'DOCTOR_CLEANUP'); assert.equal(await rejected(lifetime.drained({ retry: true })), failure);
  assert.equal(native.count.destroy, 1); assert.ok(lifetime.getUsage().expandedBytes > 0);
});
test('synthetic stable cleanup failure retains earlier FIRSTs through a second rejected Retry and succeeds without reparse', async () => {
  const native = facade({ destroy: count => count.destroy < 3 ? Promise.reject(count.destroy === 1 ? null : false) : Promise.resolve() }), state = metadata(), lifetime = createDoctorPdfLifetime();
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null));
  assert.equal(failure.cause, null); assert.equal(await rejected(lifetime.drained({ retry: true })), failure);
  assert.equal(failure.cause, null); assert.equal(native.count.destroy, 2); assert.equal(native.count.open, 1);
  await lifetime.drained({ retry: true }); assert.equal(native.count.destroy, 3); assert.equal(native.count.open, 1);
});
test('fallible task destroy getter reentry observes a cached FIRST before actual native cleanup invocation', async () => {
  const held = deferred(), state = metadata(), lifetime = createDoctorPdfLifetime(); let barrier, closed = false, reads = 0, calls = 0;
  const native = facade({ task(task) { Object.defineProperty(task, 'destroy', { get() { reads++; barrier = lifetime.drained().then(() => { closed = true; }); return () => { calls++; return held.promise; }; } }); return task; } });
  const operation = lifetime.inspect(native.pdfjs, input(), controls(state), () => null);
  await until(() => calls === 1); assert.equal(closed, false); assert.equal(reads, 1); assert.equal(lifetime.getUsage().artifactBytes, input().length);
  held.resolve(); await operation; await barrier; assert.equal(reads, 1); assert.equal(calls, 1);
});
test('diagnostic getter rejection after falsy cancel drains and preserves reason while its usage cannot shrink', async () => {
  const held = deferred(), native = facade(), state = metadata(), lifetime = createDoctorPdfLifetime(); let entered = false;
  const operation = rejected(lifetime.inspect(native.pdfjs, input(), controls(state), async (_, scope) => { entered = true; await scope.work(() => held.promise, {}); return null; }));
  await until(() => entered); lifetime.cancel(''); assert.equal(lifetime.getUsage().artifactBytes, input().length);
  held.reject(new Error('getter failed')); assert.equal(await operation, ''); assert.equal(native.count.destroy, 1);
});
test('final authoritative usage callback own metadata projection rejects getters without invoking them', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime();
  const snapshot = { ...state.snapshot }; Object.defineProperty(snapshot, 'generation', { get() { assert.fail('owner getter read'); } });
  assert.ok(await rejected(lifetime.inspect(native.pdfjs, input(), controls(state, { getUsage: () => ({ snapshot, live: {} }) }), () => null)) instanceof TypeError);
  assert.equal(native.count.open, 0);
});
test('guard callback reentry observes FIRST before admission, and scalar refusal cannot start loader', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime(); let reentry, drained = false, barrier;
  const fail = new Error('authoritative admission refused');
  const operation = rejected(lifetime.inspect(native.pdfjs, input(), controls(state, { admitUsage() { reentry = rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null)); barrier = lifetime.drained().then(() => { drained = true; }); assert.equal(drained, false); throw fail; } }), () => null));
  assert.equal(await operation, fail); assert.equal((await reentry).name, 'InvalidStateError'); await barrier;
  assert.equal(native.count.open, 0);
});
test('128-resource admission includes prospective diagnostic/native lease before any load', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime();
  const snapshot = { ...state.snapshot, resourceCount: 127 };
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state, { getUsage: () => ({ snapshot, live: {} }) }), () => null));
  assert.equal(failure.code, 'DOCTOR_BUDGET'); assert.equal(native.count.open, 0);
});
test('retained page/render scope is revoked after physical closure and cannot create a second render', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime(); let saved;
  await lifetime.inspect(native.pdfjs, input(), controls(state), async (_, scope) => scope.withPage(1, async (_page, page) => { saved = page; await page.render({}); return null; }));
  assert.equal((await rejected(saved.render({}))).name, 'InvalidStateError'); assert.equal(native.count.render, 1);
});
test('queue uses intrinsic observation of actual returned FIRST despite own then getter and cancellation', async () => {
  const held = deferred(); Object.defineProperty(held.promise, 'then', { get() { assert.fail('own queue FIRST then read'); } }); let runs = 0;
  const queue = createDoctorWorkQueue(() => { runs++; return held.promise; });
  const operation = rejected(queue.submit('A')); await until(() => runs === 1); queue.cancel(false);
  let closed = false; const drain = queue.drained().then(() => { closed = true; }); await turn(); assert.equal(closed, false);
  held.resolve(null); assert.equal(await operation, false); await drain;
});
for (const mode of ['false', 'throw']) test(`queue missing returned FIRST (${mode}) stays reload-fenced instead of fabricating a drained job`, async () => {
  let runs = 0;
  const queue = createDoctorWorkQueue(() => { runs++; if (mode === 'throw') throw false; return false; });
  const failure = await rejected(queue.submit('A')); assert.equal(failure.code, 'DOCTOR_CLEANUP'); await turn();
  assert.equal(await rejected(queue.drained({ retry: true })), failure); assert.equal(await rejected(queue.submit('B')), failure); assert.equal(runs, 1);
});
test('queue drain following active A and unread C rejects C cleanup fence instead of hanging in a waiter', async () => {
  const held = deferred(), state = metadata(), native = facade({ destroy: () => Promise.reject(false) }), lifetime = createDoctorPdfLifetime(); let first = false;
  const queue = createDoctorWorkQueue(async (request, job) => { if (request === 'A') { first = true; await held.promise; return null; } return lifetime.inspect(native.pdfjs, input(), controls(state, { signal: job.signal }), () => null); });
  const a = rejected(queue.submit('A')); await until(() => first);
  const c = rejected(queue.submit('C')), drain = rejected(queue.drained()); held.resolve(); await a;
  const failure = await c; assert.equal(failure.code, 'DOCTOR_CLEANUP'); assert.equal(await drain, failure);
});
test('final guard microtask cannot start a successor before the original inspect FIRST is settled', async () => {
  const state = metadata(), lifetime = createDoctorPdfLifetime(); let cleaning = false, queued = false, reentry;
  const native = facade({ destroy() { cleaning = true; return Promise.resolve(); } });
  const getUsage = () => {
    if (cleaning && !queued) { queued = true; queueMicrotask(() => { reentry = rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null)); }); }
    return { snapshot: state.snapshot, live: state.live };
  };
  await lifetime.inspect(native.pdfjs, input(), controls(state, { getUsage }), () => null);
  assert.equal((await reentry).name, 'InvalidStateError'); assert.equal(native.count.open, 1);
});
test('historical cleanup error contains bounded cause rather than a native handle after exact successful Retry', async () => {
  const state = metadata(), lifetime = createDoctorPdfLifetime(); let nativeTask;
  const native = facade({ task(task) { nativeTask = task; return task; }, destroy: count => count.destroy === 1 ? Promise.reject(nativeTask) : Promise.resolve() });
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => null));
  assert.equal(failure.code, 'DOCTOR_CLEANUP'); assert.deepEqual(failure.cause, { name: 'NativeFailure' });
  await lifetime.drained({ retry: true }); assert.equal(lifetime.getUsage().artifactBytes, 0);
  assert.deepEqual(failure.cause, { name: 'NativeFailure' }); assert.equal(native.count.open, 1); assert.equal(native.count.destroy, 2);
});
test('a registered native handle thrown by inspection cannot escape as the public failure', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime();
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), doc => { throw doc; }));
  assert.equal(failure.code, 'DOCTOR_NATIVE'); assert.equal(native.count.destroy, 1);
});
test('escaped diagnostic text and key units are bounded before any JSON allocation', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime();
  const failure = await rejected(lifetime.inspect(native.pdfjs, input(), controls(state), () => ({ data: '\u0000'.repeat(50000) })));
  assert.ok(failure instanceof RangeError); assert.equal(native.count.destroy, 1); assert.equal(lifetime.getUsage().expandedBytes, 0);
});
test('resource/timeout/password parser evidence cannot be relabeled as a complete rebuild candidate', () => {
  for (const reason of ['work-limit', 'timeout', 'cleanup-failed', 'password-required']) {
    const r = report(); r.parsers.strict = { status: 'failed', reason }; r.parsers.tolerant = { status: 'failed', reason: 'strict-rejected' };
    assert.equal(recommendDoctor(r).remedy, 'unknown');
  }
});

// Correction controls use a fresh import-time timer seam, restored before any
// operation. The synthetic clock advances; no real minute/native engine runs.
let correctionModule = 0;
async function correctionClock() {
  let now = 0; const timers = [], real = { now: Date.now, later: globalThis.setTimeout, stop: globalThis.clearTimeout };
  let module;
  try {
    Date.now = () => now;
    globalThis.setTimeout = (fn, ms) => { const timer = { fn, ms, stopped: false }; timers.push(timer); return timer; };
    globalThis.clearTimeout = timer => { timer.stopped = true; };
    module = await import(`../public/js/core/doctor-lifetime.js?doctor-correction=${++correctionModule}`);
  } finally { Date.now = real.now; globalThis.setTimeout = real.later; globalThis.clearTimeout = real.stop; }
  return { ...module, timers, at(value) { now = value; }, fire(ms) { const found = timers.find(timer => timer.ms === ms && !timer.stopped); if (found) found.fn(); return !!found; } };
}
const observation = promise => promise.then(value => ({ fulfilled: true, value }), reason => ({ fulfilled: false, reason }));

test('Doctor correction page cleanup waits registered unawaited getter FIRST without awaiting its own page wrapper', async () => {
  const held = deferred(), state = metadata(), lifetime = createDoctorPdfLifetime(); let getterStarted = false, getterExited = false, early = false, cleans = 0;
  const page = { getTextContent() { getterStarted = true; return held.promise; }, cleanup() { cleans++; early ||= !getterExited; return true; } };
  const native = facade({ page: () => Promise.resolve(page) });
  const operation = lifetime.inspect(native.pdfjs, input(), controls(state), async (_, scope) => { await scope.withPage(1, actual => { void scope.work(() => actual.getTextContent(), {}); return null; }); return null; });
  await until(() => getterStarted); await turn(); const before = cleans;
  getterExited = true; held.resolve({ items: [] }); await operation;
  assert.equal(before, 0); assert.equal(early, false); assert.equal(cleans, 1); assert.equal(native.count.destroy, 1);
});
for (const value of [null, false, 0, '']) test(`Doctor correction canceled render preserves ${String(value)} after successful task teardown makes page cleanup unavailable`, async () => {
  const render = deferred(), state = metadata(), lifetime = createDoctorPdfLifetime(); let destroyed = false, renders = 0, cancels = 0, cleans = 0;
  const page = { render() { renders++; return { promise: render.promise, cancel() { cancels++; } }; }, cleanup() { cleans++; return !destroyed; } };
  const native = facade({ page: () => Promise.resolve(page), destroy() { destroyed = true; return render.promise.then(() => {}, () => {}); } });
  const operation = observation(lifetime.inspect(native.pdfjs, input(), controls(state), async (_, scope) => scope.withPage(1, async (_actual, pageScope) => { await pageScope.render({}); return null; })));
  await until(() => renders === 1); lifetime.cancel(value); await until(() => native.count.destroy === 1);
  render.reject(new Error('synthetic canceled render exits')); const result = await operation;
  const retry = await observation(lifetime.drained({ retry: true }));
  assert.ok(Object.is(result.reason, value)); assert.equal(retry.fulfilled, true); assert.equal(cancels, 1); assert.equal(cleans, 0);
  assert.equal(native.count.destroy, 1); assert.equal(lifetime.getUsage().artifactBytes, 0);
});
test('Doctor correction validated tree is immutable before later callback can insert a native handle', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime(); let result, doc, reads = 0;
  const options = controls(state, { getUsage() { if (result && ++reads === 2) result.native = doc; return { snapshot: state.snapshot, live: state.live }; } });
  const outcome = await observation(lifetime.inspect(native.pdfjs, input(), options, actual => { doc = actual; result = { count: 1 }; return result; }));
  assert.equal(outcome.fulfilled, false); assert.ok(outcome.reason instanceof TypeError); assert.ok(Object.isFrozen(result));
  assert.equal(result.native, undefined); assert.equal(Object.isFrozen(doc), false); assert.equal(native.count.destroy, 1);
});
test('Doctor correction nested validated data resists Reflect mutation while final falsy signal guard remains authoritative', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime(), controller = new AbortController(); let result, doc, reads = 0, inserted;
  const options = controls(state, { signal: controller.signal, getUsage() {
    if (result && ++reads === 2) { inserted = Reflect.set(result.rows[0], 'native', doc); controller.abort(0); }
    return { snapshot: state.snapshot, live: state.live };
  } });
  const outcome = await observation(lifetime.inspect(native.pdfjs, input(), options, actual => { doc = actual; result = { rows: [{ count: 1 }] }; return result; }));
  assert.equal(outcome.reason, 0); assert.equal(inserted, false); assert.equal(result.rows[0].native, undefined);
  assert.equal(native.count.destroy, 1); assert.equal(lifetime.getUsage().artifactBytes, 0);
});
test('Doctor correction standalone 60s envelope rejects while actual load and lease stay held; late exit cannot acknowledge deadline', async () => {
  const timed = await correctionClock(), held = deferred(), state = metadata(), lifetime = timed.createDoctorPdfLifetime(), native = facade({ load: () => held.promise }); let publicResult;
  const operation = observation(lifetime.inspect(native.pdfjs, input(), controls(state), () => null)).then(value => { publicResult = value; return value; });
  await until(() => native.count.open === 1); timed.at(20000); timed.fire(20000); await until(() => native.count.destroy === 1);
  timed.at(60001); const hasUpperTimer = timed.fire(60000); await turn(); const upperResult = publicResult, before = lifetime.getUsage();
  held.reject(new Error('late synthetic load exit')); const final = await operation; await turn();
  const barrier = await observation(lifetime.drained({ retry: true }));
  assert.equal(hasUpperTimer, true); assert.equal(upperResult?.fulfilled, false); assert.equal(upperResult.reason.code, 'DOCTOR_TIMEOUT');
  assert.equal(final.reason, upperResult.reason); assert.equal(barrier.reason, upperResult.reason);
  assert.equal(before.artifactBytes, input().length); assert.equal(lifetime.getUsage().artifactBytes, input().length);
  assert.equal((await observation(lifetime.inspect(native.pdfjs, input(), controls(state), () => null))).reason, upperResult.reason); assert.equal(native.count.open, 1);
});
test('Doctor correction queue 60s envelope is distinct from child FIRST and retains same failed barrier after late completion', async () => {
  const timed = await correctionClock(), held = deferred(), state = metadata(), lifetime = timed.createDoctorPdfLifetime(), native = facade({ load: () => held.promise }); let publicResult;
  const queue = timed.createDoctorWorkQueue((_request, job) => lifetime.inspect(native.pdfjs, input(), controls(state, { signal: job.signal }), () => null));
  const operation = observation(queue.submit('A')).then(value => { publicResult = value; return value; });
  await until(() => native.count.open === 1); timed.at(20000); timed.fire(20000); await until(() => native.count.destroy === 1);
  timed.at(60001); timed.fire(60000); await turn(); const upperResult = publicResult, before = lifetime.getUsage();
  const barrier = observation(queue.drained());
  held.reject(new Error('late original FIRST')); const final = await operation; const drained = await barrier; await turn();
  assert.equal(upperResult?.fulfilled, false); assert.equal(upperResult.reason.code, 'DOCTOR_TIMEOUT'); assert.equal(final.reason, upperResult.reason);
  assert.equal(drained.reason, upperResult.reason); assert.equal((await observation(queue.submit('B'))).reason, upperResult.reason);
  assert.equal(before.artifactBytes, input().length); assert.equal(lifetime.getUsage().artifactBytes, input().length); assert.equal(native.count.open, 1);
});
test('Doctor correction opaque queued work cannot grant successor or lease acknowledgement after deadline and late fulfillment', async () => {
  const timed = await correctionClock(), held = deferred(); const starts = []; let publicResult;
  const queue = timed.createDoctorWorkQueue(request => { starts.push(request); return request === 'A' ? held.promise : Promise.resolve(null); });
  const operation = observation(queue.submit('A')).then(value => { publicResult = value; return value; }); await until(() => starts.length === 1);
  const pending = observation(queue.submit('C')); timed.at(60001); timed.fire(60000); await turn(); const upperResult = publicResult;
  held.resolve(null); const final = await operation, unread = await pending; await turn(); const retry = await observation(queue.drained({ retry: true }));
  assert.equal(upperResult?.fulfilled, false); assert.equal(upperResult.reason.code, 'DOCTOR_TIMEOUT'); assert.equal(final.reason, upperResult.reason);
  assert.equal(unread.reason, upperResult.reason); assert.equal(retry.reason, upperResult.reason); assert.deepEqual(starts, ['A']);
});
test('Doctor correction earlier authoritative falsy cleanup error keeps identity at deadline and exact owned Retry uses task acknowledgment', async () => {
  const timed = await correctionClock(), held = deferred(), state = metadata(), lifetime = timed.createDoctorPdfLifetime(); let cleanups = 0, started = false, publicResult;
  const page = { cleanup() { cleanups++; return false; } };
  const native = facade({ page: () => Promise.resolve(page) });
  const queue = timed.createDoctorWorkQueue(async (_request, job) => lifetime.inspect(native.pdfjs, input(), controls(state, { signal: job.signal }), async (_, scope) => {
    void scope.work(() => { started = true; return held.promise; }, {});
    await scope.withPage(1, () => null); return null;
  }));
  const operation = observation(queue.submit('A')).then(value => { publicResult = value; return value; });
  await until(() => started && cleanups === 1); timed.at(60001); timed.fire(60000); await turn(); const upperResult = publicResult;
  held.resolve(null); const final = await operation; await turn();
  const beforeRetry = lifetime.getUsage(); const retry = await observation(queue.drained({ retry: true }));
  assert.equal(upperResult?.fulfilled, false); assert.equal(upperResult.reason.code, 'DOCTOR_CLEANUP'); assert.equal(upperResult.reason.cause, false);
  assert.equal(final.reason, upperResult.reason); assert.equal(beforeRetry.artifactBytes, input().length); assert.equal(retry.fulfilled, true);
  assert.equal(cleanups, 1); assert.equal(native.count.destroy, 1); assert.equal(native.count.open, 1); assert.equal(lifetime.getUsage().artifactBytes, 0);
});


test('Doctor correction held successful destroy remains authoritative and page cleanup never races its FIRST', async () => {
  const rendered = deferred(), destroyed = deferred(), state = metadata(), lifetime = createDoctorPdfLifetime(); let result;
  const native = facade({ render: () => rendered.promise, destroy: () => destroyed.promise });
  const operation = observation(lifetime.inspect(native.pdfjs, input(), controls(state), async (_, scope) => scope.withPage(1, async (_actual, pageScope) => { await pageScope.render({}); return null; }))).then(value => { result = value; return value; });
  await until(() => native.count.render === 1); lifetime.cancel(false); await until(() => native.count.destroy === 1);
  rendered.reject(null); await turn(); assert.equal(result, undefined); assert.equal(native.count.cleanup, 0);
  assert.equal(lifetime.getUsage().artifactBytes, input().length);
  destroyed.resolve(); assert.equal((await operation).reason, false); assert.equal(native.count.cleanup, 0); assert.equal(native.count.destroy, 1);
  assert.equal(lifetime.getUsage().artifactBytes, 0);
});
test('Doctor correction page getter registered during render completion guard is drained before cleanup', async () => {
  const rendered = deferred(), getter = deferred(), state = metadata(), lifetime = createDoctorPdfLifetime(); let scope, renderExit = false, inserted = false, getterStart = false, clean = 0;
  const native = facade({ render: () => rendered.promise, cleanup() { clean++; return true; } });
  const options = controls(state, { getUsage() {
    if (scope && renderExit && !inserted) { inserted = true; void scope.work(() => { getterStart = true; return getter.promise; }, {}); }
    return { snapshot: state.snapshot, live: state.live };
  } });
  const operation = lifetime.inspect(native.pdfjs, input(), options, async (_, actualScope) => { scope = actualScope; await scope.withPage(1, (_page, pageScope) => { void pageScope.render({}); return null; }); return null; });
  await until(() => native.count.render === 1); renderExit = true; rendered.resolve(); await until(() => getterStart); await turn();
  const before = clean; getter.resolve(null); await operation;
  assert.equal(before, 0); assert.equal(clean, 1); assert.equal(native.count.destroy, 1);
});
test('Doctor correction rejected destroy is retried on its exact handle before page context acknowledgment', async () => {
  const rendered = deferred(), retry = deferred(), state = metadata(), lifetime = createDoctorPdfLifetime();
  const native = facade({ render: () => rendered.promise, destroy: count => count.destroy === 1 ? Promise.reject(false) : retry.promise });
  const operation = observation(lifetime.inspect(native.pdfjs, input(), controls(state), async (_, scope) => scope.withPage(1, async (_page, pageScope) => { await pageScope.render({}); return null; })));
  await until(() => native.count.render === 1); lifetime.cancel(0); rendered.reject(null);
  const failed = await operation; assert.equal(failed.reason.code, 'DOCTOR_CLEANUP'); assert.equal(failed.reason.cause, false);
  assert.equal(native.count.cleanup, 0); const recovery = lifetime.drained({ retry: true }); await until(() => native.count.destroy === 2);
  assert.equal(lifetime.getUsage().artifactBytes, input().length); retry.resolve(); await recovery;
  assert.equal(native.count.cleanup, 0); assert.equal(native.count.destroy, 2); assert.equal(native.count.open, 1); assert.equal(lifetime.getUsage().artifactBytes, 0);
});
test('Doctor correction frozen diagnostic graph retains final canonical owner check after usage callbacks', async () => {
  const state = metadata(), native = facade(), lifetime = createDoctorPdfLifetime(); let report, reads = 0;
  const options = controls(state, { getUsage() {
    if (report && ++reads === 2) state.session.begin(input(), 'replacement.pdf');
    return { snapshot: state.snapshot, live: state.live };
  } });
  const outcome = await observation(lifetime.inspect(native.pdfjs, input(), options, () => { report = { rows: [{ count: 1 }] }; return report; }));
  assert.equal(outcome.reason.name, 'AbortError'); assert.equal(Object.isFrozen(report.rows[0]), true);
  assert.equal(native.count.destroy, 1); assert.equal(lifetime.getUsage().artifactBytes, 0);
});
test('Doctor correction deadline retains held render and failed destroy, then Retry uses only the exact failed destroy FIRST', async () => {
  const timed = await correctionClock(), render = deferred(), destroy = deferred(), retry = deferred(), state = metadata(), lifetime = timed.createDoctorPdfLifetime();
  const native = facade({ render: () => render.promise, destroy: count => count.destroy === 1 ? destroy.promise : retry.promise });
  const queue = timed.createDoctorWorkQueue((_request, job) => lifetime.inspect(native.pdfjs, input(), controls(state, { signal: job.signal }), async (_, scope) => scope.withPage(1, async (_page, pageScope) => { await pageScope.render({}); return null; })));
  const operation = observation(queue.submit('A')); await until(() => native.count.render === 1);
  timed.at(20000); timed.fire(20000); await until(() => native.count.destroy === 1);
  timed.at(60001); timed.fire(60000); const failure = (await operation).reason;
  assert.equal(failure.code, 'DOCTOR_TIMEOUT'); assert.equal((await observation(queue.drained({ retry: true }))).reason, failure);
  assert.equal(native.count.cleanup, 0); assert.equal(lifetime.getUsage().artifactBytes, input().length);
  render.reject(false); destroy.reject(false); await turn(); await turn();
  assert.equal((await observation(lifetime.inspect(native.pdfjs, input(), controls(state), () => null))).reason, failure);
  const recovery = queue.drained({ retry: true }); await until(() => native.count.destroy === 2);
  assert.equal(native.count.open, 1); assert.equal(native.count.cleanup, 0); assert.equal(lifetime.getUsage().artifactBytes, input().length);
  retry.resolve(); await recovery; assert.equal(native.count.open, 1); assert.equal(native.count.destroy, 2); assert.equal(lifetime.getUsage().artifactBytes, 0);
});
test('Doctor correction phase timeout that drains before 60s preserves its reason and admits the next queue job', async () => {
  const timed = await correctionClock(), held = deferred(), state = metadata(), lifetime = timed.createDoctorPdfLifetime(); let doc;
  const native = facade({ load: actual => { doc = actual; return held.promise; } });
  const queue = timed.createDoctorWorkQueue((request, job) => request === 'B' ? Promise.resolve('B-ready') : lifetime.inspect(native.pdfjs, input(), controls(state, { signal: job.signal }), () => null));
  const operation = observation(queue.submit('A')); await until(() => native.count.open === 1);
  timed.at(20000); timed.fire(20000); await until(() => native.count.destroy === 1); held.resolve(doc);
  const outcome = await operation; assert.equal(outcome.reason.code, 'DOCTOR_TIMEOUT'); assert.equal(outcome.reason.message, 'Doctor phase deadline elapsed.');
  await queue.drained(); assert.equal(lifetime.getUsage().artifactBytes, 0); assert.equal(await queue.submit('B'), 'B-ready'); await queue.drained();
});
test('Doctor correction delayed child deadline shares the earlier queue cutoff even when child timer fires first', async () => {
  const timed = await correctionClock(), started = deferred(), held = deferred(), state = metadata(), lifetime = timed.createDoctorPdfLifetime(), native = facade({ load: () => held.promise }); let child;
  const queue = timed.createDoctorWorkQueue(async (_request, job) => { await started.promise; child = lifetime.inspect(native.pdfjs, input(), controls(state, { signal: job.signal }), () => null); return child; });
  const operation = observation(queue.submit('A')); await turn(); timed.at(10000); started.resolve(); await until(() => native.count.open === 1);
  timed.at(60001); assert.equal(timed.fire(50000), true); const failure = (await operation).reason;
  assert.equal((await observation(child)).reason, failure); assert.equal((await observation(queue.drained())).reason, failure);
  held.reject(false); await turn(); await turn(); assert.equal((await observation(queue.drained({ retry: true }))).reason, failure); assert.equal(native.count.open, 1);
  assert.equal(lifetime.getUsage().artifactBytes, input().length);
});
test('Doctor correction elapsed final guard enforces 60s without relying on timer callback ordering', async () => {
  const timed = await correctionClock(), state = metadata(), lifetime = timed.createDoctorPdfLifetime(), native = facade(); let returned = false;
  const options = controls(state, { getUsage() { if (returned) timed.at(60001); return { snapshot: state.snapshot, live: state.live }; } });
  const outcome = await observation(lifetime.inspect(native.pdfjs, input(), options, () => { returned = true; return null; }));
  assert.equal(outcome.reason.code, 'DOCTOR_TIMEOUT'); await turn(); assert.equal((await observation(lifetime.drained({ retry: true }))).reason, outcome.reason);
  assert.equal(native.count.destroy, 1); assert.equal(lifetime.getUsage().artifactBytes, input().length);
});
test('Doctor correction queue unread supersession with omitted reason preserves intrinsic AbortError', async () => {
  const held = deferred(), starts = [], queue = createDoctorWorkQueue(request => { starts.push(request); return request === 'A' ? held.promise : Promise.resolve(request); });
  const a = observation(queue.submit('A')); await until(() => starts.length === 1); const b = observation(queue.submit('B')), c = observation(queue.submit('C'));
  assert.equal((await b).reason.name, 'AbortError'); held.resolve(null); assert.equal((await a).reason.name, 'AbortError'); assert.equal((await c).value, 'C'); await queue.drained();
  assert.deepEqual(starts, ['A', 'C']);
});


test('Doctor correction destroy rejection recorded before held load exit has authoritative priority at 60s', async () => {
  const timed = await correctionClock(), load = deferred(), state = metadata(), lifetime = timed.createDoctorPdfLifetime();
  const native = facade({ load: () => load.promise, destroy: count => count.destroy === 1 ? Promise.reject(false) : Promise.resolve() });
  const queue = timed.createDoctorWorkQueue((_request, job) => lifetime.inspect(native.pdfjs, input(), controls(state, { signal: job.signal }), () => null));
  const operation = observation(queue.submit('A')); await until(() => native.count.open === 1);
  timed.at(20000); timed.fire(20000); await until(() => native.count.destroy === 1); await turn();
  timed.at(60001); timed.fire(60000); const failure = (await operation).reason;
  assert.equal(failure.code, 'DOCTOR_CLEANUP'); assert.equal(failure.cause, false); assert.equal((await observation(lifetime.drained({ retry: true }))).reason, failure);
  assert.equal(native.count.destroy, 1); assert.equal(lifetime.getUsage().artifactBytes, input().length);
  load.reject(null); await turn(); await turn(); await queue.drained({ retry: true });
  assert.equal(native.count.destroy, 2); assert.equal(native.count.open, 1); assert.equal(lifetime.getUsage().artifactBytes, 0);
});
test('Doctor correction child envelope still has its own deadline if a trusted queue callback returns without awaiting it', async () => {
  const timed = await correctionClock(), load = deferred(), state = metadata(), lifetime = timed.createDoctorPdfLifetime(), native = facade({ load: () => load.promise }); let child;
  // Deliberately violate the trusted run await contract: this is an envelope
  // fallback check, not permission to treat the queue result as native exit.
  const queue = timed.createDoctorWorkQueue((_request, job) => { child = observation(lifetime.inspect(native.pdfjs, input(), controls(state, { signal: job.signal }), () => null)); return Promise.resolve(null); });
  assert.equal(await queue.submit('A'), null); await queue.drained(); await until(() => native.count.open === 1);
  timed.at(60001); timed.fire(60000); const failure = (await child).reason; assert.equal(failure.code, 'DOCTOR_TIMEOUT');
  load.reject(false); await turn(); await turn(); assert.equal((await observation(lifetime.drained({ retry: true }))).reason, failure); assert.equal(lifetime.getUsage().artifactBytes, input().length);
});
