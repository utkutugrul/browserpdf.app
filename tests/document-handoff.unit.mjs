import test from 'node:test';
import assert from 'node:assert/strict';
import * as sessionCore from '../public/js/core/document-session.js';
import { stashForChain, takeChainedFile } from '../public/js/document-handoff.js';
import { restoreCompositionHistory } from '../public/js/document-workspace-support.js';

const bytes = (name) => new TextEncoder().encode(`%PDF-1.7\n${name}`);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function environment(store) { const documentSession = sessionCore.createDocumentSession(); documentSession.begin(bytes('A'), 'A.pdf'); return { ensureDocumentSession: async () => {}, documentSession, getSessionCore: () => sessionCore, loadWorkflowStore: async () => store }; }

for (const phase of ['cleanup', 'bundle']) test(`held ${phase} cannot adopt or return navigation ownership over replacement B`, async () => {
  const entered = deferred(), release = deferred(); let stored;
  const store = { async cleanupExpired() { if (phase === 'cleanup') { entered.resolve(); await release.promise; } }, async putWorkflowBundle(workflow, files) { stored = { workflow, files }; if (phase === 'bundle') { entered.resolve(); await release.promise; } } };
  const env = environment(store), pending = stashForChain(bytes('edited A'), 'A-edited.pdf', 'add-image', {}, env); await entered.promise;
  env.documentSession.begin(bytes('B'), 'B.pdf'); const expected = env.documentSession.transfer(); release.resolve();
  await assert.rejects(pending, /replaced|cancelled/); assert.deepEqual(env.documentSession.transfer(), expected);
  if (stored) assert.notEqual(stored.workflow.id, expected.taskId);
});

test('a held old bundle never deletes the newer same-task bundle', async () => {
  const entered = deferred(), release = deferred(); let latest, calls = 0, deletes = 0;
  const store = { async cleanupExpired() {}, async putWorkflowBundle(workflow, files) { latest = { workflow, files }; if (++calls === 1) { entered.resolve(); await release.promise; } }, async deleteWorkflow() { deletes++; } };
  const env = environment(store), old = stashForChain(bytes('old A'), 'old.pdf', 'add-image', {}, env); await entered.promise;
  env.documentSession.adopt(bytes('new A'), 'new.pdf');
  const newer = await stashForChain(bytes('new A'), 'new.pdf', 'add-image', {}, env), task = env.documentSession.snapshot().taskId;
  release.resolve(); await assert.rejects(old, /replaced|cancelled/);
  assert.equal(latest.workflow.id, task); assert.equal(deletes, 0); assert.equal(newer.isCurrent(), true);
  const file = latest.files.find((file) => file.id === newer.fileId); assert.deepEqual(file.bytes, bytes('new A'));
});

test('typed composition handoff round-trips originals, normalized assets, history and chosen PDF', async () => {
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  let stored;
  const store = { async cleanupExpired() {}, async putWorkflowBundle(workflow, files) { stored = { workflow, files }; }, async getWorkflow() { return stored.workflow; }, async getFiles(owner) { return stored.files.map((file) => ({ ...file, workflowId: owner })); } };
  const env = environment(store), state = env.documentSession.snapshot();
  await env.documentSession.beginComposition([{ id: 'image', original: { bytes: png, name: 'original.png', type: 'image/png' }, asset: { bytes: png, name: 'normalized.png', type: 'image/png', width: 1, height: 1 } }], { expectedTaskId: state.taskId, expectedRevision: state.revision });
  let expected = env.documentSession.snapshot(); env.documentSession.publishComposition(bytes('composed'), 'composed.pdf', { expectedTaskId: expected.taskId, expectedRevision: expected.revision });
  expected = env.documentSession.snapshot();
  const handoff = await stashForChain(bytes('composed'), 'composed.pdf', 'jpg-to-pdf', { type: 'application/pdf', compositionRevision: expected.revision }, env);
  const file = await takeChainedFile(handoff.workflowId, handoff.fileId, env), restored = sessionCore.createDocumentSession();
  restored.begin(new Uint8Array(await file.arrayBuffer()), file.name, file.browserpdfSession);
  assert.deepEqual(restored.composition(), env.documentSession.composition()); assert.deepEqual(restored.compositionSources(), env.documentSession.compositionSources()); assert.deepEqual(restored.current().bytes, bytes('composed')); assert.equal(restored.snapshot().compositionPublishedRevision, expected.revision);
});

test('empty composition history opens a compatible mode without attempting PDF export; failed storage rolls back', async () => {
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')), session = sessionCore.createDocumentSession();
  await session.beginComposition([{ id:'one',original:{ bytes:png,name:'one.png',type:'image/png' },asset:{ bytes:png,name:'one.png',type:'image/png',width:1,height:1 } }],{ expectedTaskId:null,expectedRevision:0 });
  let state = session.snapshot(); session.publishComposition(bytes('chosen'),'chosen.pdf',{ expectedTaskId:state.taskId,expectedRevision:state.revision }); const empty = session.composition(); empty.items = []; empty.selectedId = null;
  state = session.snapshot(); session.changeComposition(empty,{ expectedTaskId:state.taskId,expectedRevision:state.revision }); session.adopt(bytes('chosen'),'chosen.pdf');
  const env = { ensureDocumentSession:async () => {},documentSession:session,stashCompositionForChain:async (target) => { assert.equal(target,'jpg-to-pdf'); return { isCurrent:() => true }; } };
  const restored = await restoreCompositionHistory('undo',{},env); assert.equal(restored.targetSlug,'jpg-to-pdf'); assert.equal(session.composition().items.length,0); assert.equal(session.compositionSources().originals.length,1);
  session.redo(); env.stashCompositionForChain = async () => { throw new Error('Storage unavailable'); };
  await assert.rejects(restoreCompositionHistory('undo',{},env),/Storage unavailable/); assert.equal(session.composition(),null); assert.deepEqual(session.current().bytes,bytes('chosen')); assert.equal(session.historyTarget('undo').composition.items.length,0);
});
