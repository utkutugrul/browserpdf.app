import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as sessionCore from '../public/js/core/document-session.js';
import { stashForChain, takeChainedFile } from '../public/js/document-handoff.js';
import { getWorkspaceInput } from '../public/js/document-workspace-support.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const longName = (label, extension = 'pdf') => `İstanbul-مراجعة-${label}-${'meaningful-document-'.repeat(9)}.${extension}`;
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
async function pdf(label) {
  const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([300, 200]).drawText(label, { x: 30, y: 100, size: 12, font });
  return document.save();
}
function environment(documentSession) {
  let stored;
  const store = {
    async cleanupExpired() {},
    async putWorkflowBundle(workflow, files, { isCurrent } = {}) {
      assert.equal(isCurrent(), true); stored = structuredClone({ workflow, files });
    },
    async getWorkflow() { return structuredClone(stored.workflow); },
    async getFiles(owner) { return structuredClone(stored.files).map((file) => ({ ...file, workflowId: owner })); },
  };
  return { documentSession, ensureDocumentSession: async () => {}, getSessionCore: () => sessionCore, loadWorkflowStore: async () => store, stored: () => stored };
}

test('real PDF labels preserve bounded Unicode while legacy safe filenames and metadata whitelist stay unchanged', async () => {
  const bytes = await pdf('BOUNDED LABEL'), name = longName('original'), artifact = sessionCore.createArtifact(bytes, name);
  assert.ok(name.length > 160 && name.length <= 260);
  assert.equal(artifact.name, name.slice(0, 160)); assert.equal(artifact.displayName, name); assert.equal(artifact.type, 'application/pdf');
  assert.equal(sha(artifact.bytes), sha(bytes)); assert.equal((await PDFDocument.load(artifact.bytes)).getPageCount(), 1);
  const controls = sessionCore.createArtifact(bytes, '\u0000İstanbul\u0085\n.pdf', { password: 'never-retain', metadata: { secret: 'never-retain' } });
  assert.equal(controls.name, 'İstanbul\u0085.pdf'); assert.equal(controls.displayName, 'İstanbul.pdf');
  assert.equal('password' in controls, false); assert.equal('metadata' in controls, false);
  assert.equal(sessionCore.createArtifact(bytes, '\u0000\u0085\n ').displayName, 'document.pdf');
  assert.equal(sessionCore.createArtifact(bytes, 'fallback.pdf', { name: 'fallback.pdf', displayName: '\u0000\u0085' }).displayName, 'fallback.pdf');
  const oversized = sessionCore.createArtifact(bytes, `${'a'.repeat(258)}😀oversized.pdf`);
  assert.ok(oversized.displayName.length <= sessionCore.MAX_ARTIFACT_DISPLAY_NAME_LENGTH); assert.ok(oversized.displayName.endsWith('…'));
  assert.equal(/\p{Surrogate}/u.test(oversized.displayName), false); assert.equal(oversized.name.length, 160);
});

test('renamed real outputs derive their own display label despite spread source options; legacy descriptors fall back', async () => {
  const source = sessionCore.createArtifact(await pdf('SOURCE'), longName('source'));
  const outputBytes = await pdf('DIFFERENT OUTPUT'), outputName = longName('new-output');
  const output = sessionCore.createArtifact(outputBytes, outputName, { ...source });
  assert.equal(output.displayName, outputName); assert.notEqual(output.displayName, source.displayName); assert.equal(sha(output.bytes), sha(outputBytes));
  assert.equal(sessionCore.createArtifact(source.bytes, source.name, source).displayName, source.displayName);
  assert.equal(sessionCore.createArtifact(source.bytes, source.name, { name: source.name, type: source.type }).displayName, source.name);
  assert.equal(sessionCore.createArtifact(outputBytes, 'new.pdf', { displayName: source.displayName }).displayName, 'new.pdf');
});

test('real original/current names survive ordinary history, transfer and same-byte adoption without changing task or revisions', async () => {
  const session = sessionCore.createDocumentSession(), originalBytes = await pdf('ORIGINAL'), outputBytes = await pdf('CURRENT');
  const originalName = longName('original'), outputName = longName('output'), renamed = longName('renamed');
  session.begin(originalBytes, originalName); const task = session.snapshot().taskId;
  session.adopt(outputBytes, outputName); const beforeRename = session.snapshot();
  session.adopt(outputBytes, renamed, { ...session.current() });
  const afterRename = session.snapshot();
  assert.equal(afterRename.taskId, task); assert.equal(afterRename.revision, beforeRename.revision); assert.equal(afterRename.generation, beforeRename.generation);
  assert.equal(afterRename.current.displayName, renamed); assert.equal(afterRename.original.displayName, originalName);
  assert.equal(sha(session.original().bytes), sha(originalBytes)); assert.equal(sha(session.current().bytes), sha(outputBytes));
  assert.equal(session.undo().displayName, originalName); assert.equal(session.redo().displayName, renamed);
  const transfer = session.transfer(), restored = sessionCore.createDocumentSession(); restored.begin(transfer.current.bytes, transfer.current.name, transfer);
  assert.equal(restored.current().displayName, renamed); assert.equal(restored.original().displayName, originalName); assert.equal(restored.snapshot().taskId, task);
  assert.equal(restored.historyTarget('undo').artifact.displayName, originalName); assert.equal(sha(restored.current().bytes), sha(outputBytes));
});

test('real scene-history/future and resource transfer retain full labels with the existing byte accounting', async () => {
  const session = sessionCore.createDocumentSession(), originalBytes = await pdf('SCENE SOURCE'), outputBytes = await pdf('SCENE OUTPUT');
  const originalName = longName('scene-source'), outputName = longName('scene-output'), imageName = longName('image', 'png');
  session.begin(originalBytes, originalName); session.beginScene();
  const assetId = await session.addAsset(png, 'image/png', imageName), scene = session.scene();
  scene.objects.push({ id: 'image', kind: 'image', pageIndex: 0, x: 10, y: 10, width: 10, height: 10, assetId, opacity: 1 }); session.changeScene(scene);
  session.publishScene(outputBytes, outputName); const changed = session.scene(); changed.objects[0].opacity = .5; session.changeScene(changed); session.undo();
  const input = await getWorkspaceInput({ bakeScene: false }, { ensureDocumentSession: async () => {}, documentSession: session });
  assert.equal(input.name, session.current().name); assert.equal(input.displayName, outputName); assert.equal(input.name.endsWith('.pdf'), false); assert.equal(input.type, 'application/pdf');
  const transfer = session.transfer(), restored = sessionCore.createDocumentSession(); restored.begin(transfer.current.bytes, transfer.current.name, transfer);
  assert.equal(restored.current().displayName, outputName); assert.equal(restored.original().displayName, originalName);
  assert.equal(restored.resource(restored.scene().sourceRef).displayName, originalName); assert.equal(restored.resource(assetId).displayName, imageName);
  assert.equal(transfer.history[0].displayName, originalName); assert.equal(transfer.future[0].displayName, outputName);
  assert.equal(restored.snapshot().resourceBytes, session.snapshot().resourceBytes); assert.equal(restored.snapshot().retainedBytes, session.snapshot().retainedBytes);
  assert.deepEqual(restored.scene(), session.scene()); assert.equal(restored.redo().displayName, outputName); assert.equal(restored.scene().objects[0].opacity, .5);
});

test('real handoff descriptors preserve different labels for deduplicated bytes, originals, scene history/future and resources', async () => {
  const session = sessionCore.createDocumentSession(), originalBytes = await pdf('ORIGINAL HANDOFF'), currentBytes = await pdf('CURRENT HANDOFF');
  const originalName = longName('handoff-original'), resourceName = longName('handoff-resource'), currentName = longName('handoff-current'), imageName = longName('handoff-image', 'png');
  session.begin(originalBytes, originalName); session.adopt(currentBytes, resourceName); session.beginScene();
  const assetId = await session.addAsset(png, 'image/png', imageName), scene = session.scene();
  scene.objects.push({ id: 'image', kind: 'image', pageIndex: 0, x: 10, y: 10, width: 10, height: 10, assetId, opacity: 1 }); session.changeScene(scene);
  session.publishScene(currentBytes, currentName); const changed = session.scene(); changed.objects[0].opacity = .5; session.changeScene(changed); session.undo();
  const env = environment(session), current = await getWorkspaceInput({ bakeScene: false }, env), handoff = await stashForChain(current.bytes, current.name, 'highlight', current, env), stored = env.stored();
  assert.equal(current.name.endsWith('.pdf'), false); assert.equal(current.type, 'application/pdf'); assert.equal(stored.workflow.inputDescriptor.type, 'application/pdf');
  assert.equal(stored.files.length, 3); assert.equal(stored.workflow.inputDescriptor.displayName, currentName); assert.equal(stored.workflow.originalDescriptor.displayName, originalName);
  const sourceDescriptor = stored.workflow.resourceEntries.find((value) => value.resourceId === session.scene().sourceRef);
  assert.equal(sourceDescriptor.fileRef, handoff.fileId); assert.equal(sourceDescriptor.displayName, resourceName);
  assert.equal(stored.workflow.historyCheckpoints[0].displayName, originalName); assert.equal(stored.workflow.futureCheckpoints[0].displayName, currentName);
  const file = await takeChainedFile(handoff.workflowId, handoff.fileId, env), restored = sessionCore.createDocumentSession();
  assert.equal(file.name, current.name); assert.equal(file.name.length, 160); assert.equal(file.browserpdfSession.name, file.name); assert.equal(file.browserpdfSession.displayName, currentName);
  restored.begin(new Uint8Array(await file.arrayBuffer()), file.name, file.browserpdfSession);
  assert.equal(restored.snapshot().taskId, session.snapshot().taskId); assert.equal(restored.current().displayName, currentName); assert.equal(restored.original().displayName, originalName); assert.equal(restored.current().type, 'application/pdf');
  assert.equal(restored.resource(restored.scene().sourceRef).displayName, resourceName); assert.equal(restored.resource(assetId).displayName, imageName);
  assert.equal(sha(restored.original().bytes), sha(originalBytes)); assert.equal(sha(restored.current().bytes), sha(currentBytes));
  assert.deepEqual(restored.scene(), session.scene()); assert.equal(restored.redo().displayName, currentName);
});

test('image composition keeps its full first original label through real PDF publication and transfer', async () => {
  const session = sessionCore.createDocumentSession(), originalName = longName('composition-original', 'png'), normalizedName = longName('normalized', 'png');
  await session.beginComposition([{ id: 'first', original: { bytes: png, name: originalName, type: 'image/png' }, asset: { bytes: png, name: normalizedName, type: 'image/png', width: 1, height: 1 } }], { expectedTaskId: null, expectedRevision: 0 });
  assert.equal(session.original().displayName, originalName); assert.equal(session.current().displayName, originalName); assert.equal(session.original().name.length, 160);
  assert.equal(session.composition().items[0].name, originalName); assert.equal(session.compositionSources().originals[0].name, originalName);
  const output = await pdf('COMPOSITION PDF'), outputName = longName('composition-output'), state = session.snapshot();
  session.publishComposition(output, outputName, { expectedTaskId: state.taskId, expectedRevision: state.revision }); const published = session.snapshot();
  session.publishComposition(output, outputName, { expectedTaskId: published.taskId, expectedRevision: published.revision }); assert.deepEqual(session.snapshot(), published);
  const transfer = session.transfer(), restored = sessionCore.createDocumentSession(); restored.begin(transfer.current.bytes, transfer.current.name, transfer);
  assert.equal(restored.original().displayName, originalName); assert.equal(restored.current().displayName, outputName); assert.equal(sha(restored.current().bytes), sha(output));
  assert.equal(restored.resource(restored.composition().items[0].assetId).displayName, normalizedName); assert.deepEqual(restored.compositionSources(), session.compositionSources());
});
