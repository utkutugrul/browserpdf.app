// Deliberate owned workflow transfers reuse the caller's session and store.
// Empty or unrelated URLs never load this module.

export async function stashForChain(bytes, name, targetSlug, options = {}, { ensureDocumentSession, documentSession, getSessionCore, loadWorkflowStore }) {
  await ensureDocumentSession();
  const sessionCore = getSessionCore();
  const store = await loadWorkflowStore();
  await store.cleanupExpired();
  const artifact = sessionCore.createArtifact(bytes, name, { capabilities: documentSession.snapshot().current?.capabilities, ...options });
  if (!sessionCore.acceptsArtifact(targetSlug, artifact)) throw new Error('This tool does not accept this result format.');
  if (documentSession.snapshot().current) documentSession.adopt(artifact.bytes, artifact.name, artifact);
  let snapshot = documentSession.transfer();
  if (!snapshot.taskId) { documentSession.begin(artifact.bytes, artifact.name, artifact); snapshot = documentSession.transfer(); }
  const workflowId = snapshot.taskId;
  const descriptor = (value) => ({ name: value.name, type: value.type, capabilities: { ...value.capabilities }, boundary: value.boundary });
  const files = [];
  function addFile(value, role) {
    const existing = files.find((file) => file.bytes === value.bytes || (file.bytes.length === value.bytes.length && file.bytes.every((byte, index) => byte === value.bytes[index])));
    if (existing) return existing.id;
    const file = { ...value, id: `${workflowId}:${role}` }; delete file.scene;
    files.push(file); return file.id;
  }
  const file = { id: addFile(artifact, 'input') };
  const originalRef = snapshot.original ? addFile(snapshot.original, 'original') : null;
  const resourceEntries = (snapshot.resources || []).map((value, index) => ({ resourceId: value.id, fileRef: addFile(value, `resource:${index}`), ...descriptor(value) }));
  const checkpoint = (value, role) => value.scene ? { name: value.name, type: value.type, capabilities: value.capabilities, boundary: value.boundary, sourceRef: value.sourceRef, scene: value.scene } : { fileRef: addFile(value, role), ...descriptor(value) };
  const historyCheckpoints = snapshot.history.map((value, index) => checkpoint(value, `past:${index}`));
  const futureCheckpoints = snapshot.future.map((value, index) => checkpoint(value, `future:${index}`));
  await store.putWorkflowBundle({
    id: workflowId, kind: 'handoff', orderedSteps: [{ id: `tool:${targetSlug}`, parameters: {} }], currentStep: 0,
    fileRefs: files.map((value) => value.id), inputDescriptor: descriptor(artifact), originalRef, originalDescriptor: snapshot.original ? descriptor(snapshot.original) : null, revision: snapshot.revision, selection: snapshot.selection,
    scene: snapshot.scene, resourceEntries, historyCheckpoints, futureCheckpoints,
    historyRefs: historyCheckpoints.map((value) => value.fileRef).filter(Boolean), futureRefs: futureCheckpoints.map((value) => value.fileRef).filter(Boolean),
    cleanup: { policy: 'expire', scope: workflowId },
  }, files);
  return { workflowId, fileId: file.id };
}

export async function takeChainedFile(workflowId, fileId, { ensureDocumentSession, documentSession, getSessionCore, loadWorkflowStore }) {
  try {
    await ensureDocumentSession();
    const sessionCore = getSessionCore();
    const store = await loadWorkflowStore();
    await store.cleanupExpired();
    const workflow = await store.getWorkflow(workflowId);
    if (!workflow || !workflow.fileRefs.includes(fileId)) return null;
    const owned = await store.getFiles(workflowId, workflow.fileRefs);
    const refs = new Map(owned.filter((value) => workflow.fileRefs.includes(value.id)).map((value) => [value.id, value]));
    const entry = refs.get(fileId);
    if (!entry || entry.workflowId !== workflowId) return null;
    const inputDescriptor = workflow.inputDescriptor || entry;
    const file = new File([entry.bytes], inputDescriptor.name, { type: inputDescriptor.type || 'application/pdf' });
    const original = workflow.originalRef && workflow.fileRefs.includes(workflow.originalRef) ? refs.get(workflow.originalRef) : null;
    const restoreCheckpoints = (newEntries, oldRefs, oldScenes) => Array.isArray(newEntries)
      ? newEntries.slice(-5).map((value) => value.scene ? value : refs.has(value.fileRef) ? { ...refs.get(value.fileRef), ...value } : null).filter(Boolean)
      : (oldRefs || []).slice(-5).map((id, index) => refs.has(id) ? { ...refs.get(id), scene: oldScenes?.[index] } : null).filter(Boolean);
    const resources = Array.isArray(workflow.resourceEntries)
      ? workflow.resourceEntries.map((value) => refs.has(value.fileRef) ? { ...refs.get(value.fileRef), ...value, id: value.resourceId } : null).filter(Boolean)
      : (workflow.resourceRefs || []).map((id) => refs.get(id)).filter(Boolean).map((a) => ({ ...a, id: a.resourceId }));
    const inherited = { taskId: workflow.kind === 'handoff' ? workflowId : undefined, revision: workflow.revision, type: inputDescriptor.type, capabilities: inputDescriptor.capabilities, boundary: inputDescriptor.boundary, selection: workflow.selection,
      history: restoreCheckpoints(workflow.historyCheckpoints, workflow.historyRefs, workflow.historyScenes), future: restoreCheckpoints(workflow.futureCheckpoints, workflow.futureRefs, workflow.futureScenes), scene: workflow.scene, resources };
    if (original?.workflowId === workflowId) inherited.original = sessionCore.createArtifact(original.bytes, workflow.originalDescriptor?.name || original.name, workflow.originalDescriptor || original);
    Object.defineProperty(file, 'browserpdfSession', { value: inherited });
    return file;
  } catch {
    return null;
  }
}
