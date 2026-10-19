'use strict';

import { t, getLang } from './i18n.js';
import { createOperationScope } from './core/operation-scope.js';

let sessionCore, sessionDelegate, sessionPromise;
function retryableModule(path) {
  let pending = null, attempt = 0;
  return () => {
    pending ||= import(attempt ? `${path}?retry=${attempt}` : path).catch((error) => { pending = null; attempt++; throw error; });
    return pending;
  };
}
const loadSessionModule = retryableModule('./core/document-session.js');
export function ensureDocumentSession() {
  sessionPromise ||= loadSessionModule().then((module) => { sessionCore = module; sessionDelegate = module.createDocumentSession(); return sessionDelegate; }).catch((error) => { sessionPromise = null; throw error; });
  return sessionPromise;
}
const emptySession = () => ({ taskId: null, original: null, current: null, revision: 0, generation: 0, selection: [], canUndo: false, canRedo: false, historyBytes: 0, retainedBytes: 0 });
// Empty pages need no document bytes or history implementation. File intake and
// result publication await initialization before using the synchronous delegate.
export const documentSession = {
  snapshot: (options) => sessionDelegate?.snapshot(options) || emptySession(),
  current: () => sessionDelegate?.current() || null,
  original: () => sessionDelegate?.original() || null,
  beginScene: () => sessionDelegate.beginScene(),
  scene: () => sessionDelegate?.scene() || null,
  composition: () => sessionDelegate?.composition() || null,
  compositionSources: () => sessionDelegate?.compositionSources() || null,
  beginComposition: (...args) => sessionDelegate.beginComposition(...args),
  startCompositionFromCurrent: (...args) => sessionDelegate.startCompositionFromCurrent(...args),
  appendCompositionInputs: (...args) => sessionDelegate.appendCompositionInputs(...args),
  changeComposition: (...args) => sessionDelegate.changeComposition(...args),
  setCompositionSelection: (...args) => sessionDelegate.setCompositionSelection(...args),
  publishComposition: (...args) => sessionDelegate.publishComposition(...args),
  resource: (id) => sessionDelegate?.resource(id) || null,
  addAsset: (...args) => sessionDelegate.addAsset(...args),
  changeScene: (state) => sessionDelegate.changeScene(state),
  publishScene: (...args) => sessionDelegate.publishScene(...args),
  transfer: () => sessionDelegate?.transfer() || { ...emptySession(), history: [], future: [] },
  begin: (...args) => sessionDelegate ? sessionDelegate.begin(...args) : ensureDocumentSession().then((delegate) => delegate.begin(...args)),
  adopt: (...args) => sessionDelegate ? sessionDelegate.adopt(...args) : ensureDocumentSession().then((delegate) => delegate.adopt(...args)),
  historyTarget: (kind) => sessionDelegate?.historyTarget(kind) || null,
  undo: () => sessionDelegate?.undo() || null,
  redo: () => sessionDelegate?.redo() || null,
  setSelection: (pages) => sessionDelegate?.setSelection(pages),
  invalidate: () => sessionDelegate?.invalidate(),
  clear: () => { intakeGeneration++; sessionDelegate?.clear(); documentOperations.cancel(); clearResult(); document.getElementById('documentIdentity')?.remove(); },
};
const operationScope = createOperationScope();
export const documentOperations = {
  cancel: () => operationScope.cancel(),
  begin() { clearResult(); return operationScope.begin(); },
};
export { createOperationScope };
const loadStoreModule = retryableModule('./core/workflow-store.js');
const loadWorkflowStore = async () => (await loadStoreModule()).createWorkflowStore();
let resultModule;
let pendingResult = null;
let resultGeneration = 0;
let resultGroupGeneration = 0;
let activeRail = null, railIntent = 0;
const sameOwner = (a, b) => a.taskId === b.taskId && a.revision === b.revision && a.generation === b.generation;
let intakeGeneration = 0;
const loadResultModule = retryableModule('./document-result.js');
const loadResultUi = () => (resultModule ||= loadResultModule().catch((error) => { resultModule = null; throw error; }));
const loadWorkspaceSupport = retryableModule('./document-workspace-support.js');
const loadHandoffSupport = retryableModule('./document-handoff.js');
const workspaceEnvironment = { ensureDocumentSession, documentSession, t, looksLikePdfFile, checkPdfMagicBytes, stashCompositionForChain };
const handoffEnvironment = { ensureDocumentSession, documentSession, getSessionCore: () => sessionCore, loadWorkflowStore };

export function showDocumentIdentity() {
  const snapshot = documentSession.snapshot();
  if (!snapshot.current) return;
  let identity = document.getElementById('documentIdentity');
  if (!identity) {
    identity = document.createElement('p'); identity.id = 'documentIdentity'; identity.className = 'option-hint'; identity.setAttribute('role', 'status');
    const dropzone = document.getElementById('dropzone');
    if (dropzone) dropzone.after(identity); else document.querySelector('main')?.prepend(identity);
  }
  identity.classList.add('document-identity'); identity.replaceChildren();
  const originalName = snapshot.original.displayName || snapshot.original.name, currentName = snapshot.current.displayName || snapshot.current.name;
  const description = `${t('workspace.original', 'Original')}: ${originalName} · ${t('workspace.current', 'Current')}: ${currentName} · ${t('workspace.revision', 'Revision')} ${snapshot.revision}`;
  identity.title = description; identity.setAttribute('aria-label', description);
  for (const [key, label, name] of [['original', t('workspace.original', 'Original'), originalName], ['current', t('workspace.current', 'Current'), currentName]]) {
    const item = document.createElement('span'); item.className = 'document-identity-item';
    const labelElement = document.createElement('span'); labelElement.className = 'document-identity-label'; labelElement.textContent = `${label}: `;
    const nameElement = document.createElement('span'); nameElement.className = 'document-identity-name'; nameElement.title = name; nameElement.textContent = name;
    item.append(labelElement, nameElement, document.createTextNode(' · ')); identity.append(item);
  }
  const revision = document.createElement('span'); revision.className = 'document-identity-revision'; revision.textContent = `${t('workspace.revision', 'Revision')} ${snapshot.revision}`; identity.append(revision);
}

export async function getWorkspaceInput(options = {}) {
  return (await loadWorkspaceSupport()).getWorkspaceInput(options, workspaceEnvironment);
}
export async function restoreCompositionHistory(kind, options = {}) {
  return (await loadWorkspaceSupport()).restoreCompositionHistory(kind, options, workspaceEnvironment);
}

export async function reviewResult(bytes, name, options = {}) {
  if (options.operation && !options.operation.isCurrent()) return Promise.resolve(null);
  if (options.groupOwner !== undefined && options.groupOwner !== resultGroupGeneration) return null;
  activeRail = null; railIntent++;
  if (options.groupOwner === undefined) { resultGroupGeneration++; document.getElementById('documentResultGroup')?.remove(); }
  const generation = ++resultGeneration;
  await ensureDocumentSession();
  if (generation !== resultGeneration || (options.operation && !options.operation.isCurrent())) return null;
  const artifact = sessionCore.createArtifact(bytes, name, { ...options, capabilities: options.capabilities || documentSession.snapshot().current?.capabilities });
  const compositionOwner = options.compositionRevision === undefined ? null : documentSession.snapshot();
  if (compositionOwner && (!compositionOwner.hasComposition || options.compositionRevision !== compositionOwner.revision)) return null;
  pendingResult = artifact;
  if (options.adopt) documentSession.adopt(artifact.bytes, artifact.name, artifact);
  showDocumentIdentity();
  return loadResultUi().then((ui) => generation !== resultGeneration || (options.operation && !options.operation.isCurrent()) ? null : ui.showDocumentResult(artifact, {
    imageWorkLane: options.imageWorkLane,
    session: { ...documentSession.snapshot(), original: documentSession.original(), compositionSources: documentSession.compositionSources(), resource: documentSession.resource },
    download: (value) => { if (generation !== resultGeneration || (options.operation && !options.operation.isCurrent())) return; downloadBlob(new Blob([value.bytes], { type: value.type }), value.name, { download: true }); },
    adopt: options.allowAdopt === false ? null : (value) => {
      if (generation !== resultGeneration || (options.operation && !options.operation.isCurrent())) return null;
      const now = documentSession.snapshot();
      if (compositionOwner && (now.taskId !== compositionOwner.taskId || now.revision !== compositionOwner.revision || now.generation !== compositionOwner.generation)) return null;
      const snapshot = compositionOwner ? documentSession.publishComposition(value.bytes, value.name, { ...value, expectedTaskId: compositionOwner.taskId, expectedRevision: compositionOwner.revision }) : documentSession.adopt(value.bytes, value.name, value);
      if (value === artifact && pendingResult === artifact) activeRail?.adopt(value, now, snapshot);
      showDocumentIdentity();
      // Synchronous notification. Consumers own cancellation/busy/errors for any
      // subsequent asynchronous hydration; this callback does not delay adoption.
      options.onAdopt?.(snapshot, documentSession.current()); return snapshot;
    },
  }));
}

export function clearResult() {
  pendingResult = null;
  activeRail = null; railIntent++;
  resultGeneration++;
  resultGroupGeneration++;
  const panel = document.getElementById('documentResult'); if (panel) panel.hidden = true;
  if (resultModule) void resultModule.then((ui) => ui.clearDocumentResult()).catch(() => {});
  const row = document.getElementById('chainRow'); if (row) row.hidden = true;
  document.getElementById('documentResultGroup')?.remove();
}

export async function reviewResults(results, options = {}) {
  if (options.operation && !options.operation.isCurrent()) return null;
  if (!Array.isArray(results) || !results.length || results.length > 20) throw new RangeError('Review between 1 and 20 result files.');
  const total = results.reduce((sum, value) => sum + value.bytes.byteLength, 0);
  if (total > 250 * 1024 * 1024) throw new RangeError('This result group is limited to 250 MB.');
  clearResult();
  const owner = resultGroupGeneration, generation = resultGeneration;
  const ownsGroup = () => owner === resultGroupGeneration && (!options.operation || options.operation.isCurrent());
  let selection = 0;
  async function selectArtifact(artifact) {
    const selected = ++selection;
    const ownsSelection = () => ownsGroup() && selected === selection;
    if (!ownsSelection()) return;
    const operation = { isCurrent: ownsSelection };
    await reviewResult(artifact.bytes, artifact.name, { ...artifact, groupOwner: owner, operation });
    if (ownsSelection()) await offerChain(artifact.bytes, artifact.name, [], { ...artifact, operation });
  }
  await ensureDocumentSession();
  if (!ownsGroup() || generation !== resultGeneration) return null;
  const artifacts = results.map((value) => sessionCore.createArtifact(value.bytes, value.name, value));
  await loadResultUi();
  if (!ownsGroup() || generation !== resultGeneration) return null;
  let group = document.getElementById('documentResultGroup');
  if (!group) { group = document.createElement('section'); group.id = 'documentResultGroup'; group.className = 'document-result'; (document.querySelector('main') || document.body).append(group); }
  group.replaceChildren();
  const heading = document.createElement('h2'); heading.textContent = t('workspace.choose_result', 'Choose a result to review'); group.append(heading);
  const list = document.createElement('ul'); group.append(list);
  for (const artifact of artifacts) {
    const item = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-ghost btn-small'; button.textContent = artifact.name;
    button.addEventListener('click', () => selectArtifact(artifact)); item.append(button); list.append(item);
  }
  await selectArtifact(artifacts[0]);
  if (!ownsGroup()) return null;
  return artifacts;
}

// Shared page-scaffolding helpers for tool pages. Every tool page uses the
// same ids for its dropzone, progress, and error elements, so these helpers
// bind to those ids directly.

export const errorSection = document.getElementById('errorSection');
export const errorText = document.getElementById('errorText');
export const progressSection = document.getElementById('progressSection');
const progressStatus = document.getElementById('progressStatus');
const progressFill = document.getElementById('progressFill');

// Shared semantic state contract for tool workspaces. Adapters supply their
// existing elements, while processing code remains independent of the DOM.
export function createTaskState(elements = {}) {
  const errorRegion = elements.errorSection || document.getElementById('errorSection');
  const errorMessage = elements.errorText || document.getElementById('errorText');
  const progressRegion = elements.progressSection || document.getElementById('progressSection');
  const status = elements.progressStatus || document.getElementById('progressStatus');
  const track = elements.progressTrack || document.getElementById('progressTrack');
  const fill = elements.progressFill || document.getElementById('progressFill');
  const successRegion = elements.successSection || document.getElementById('successSection');

  return {
    showError(message) {
      if (errorMessage) errorMessage.textContent = message;
      if (errorRegion) errorRegion.hidden = false;
    },
    hideError() {
      if (errorRegion) errorRegion.hidden = true;
      if (errorMessage) errorMessage.textContent = '';
    },
    setProgress(percent, text) {
      const value = Math.max(0, Math.min(100, Math.round(percent)));
      if (fill) fill.style.setProperty('--progress', String(value));
      if (track) track.setAttribute('aria-valuenow', String(value));
      if (status) status.textContent = text;
    },
    showProgress(text) {
      if (progressRegion) progressRegion.hidden = false;
      this.setProgress(0, text);
    },
    hideProgress() {
      if (progressRegion) progressRegion.hidden = true;
    },
    showSuccess() {
      if (successRegion) successRegion.hidden = false;
    },
    hideSuccess() {
      if (successRegion) successRegion.hidden = true;
    },
  };
}

export function showError(message) {
  errorText.textContent = message;
  errorSection.hidden = false;
}

export function hideError() {
  errorSection.hidden = true;
  errorText.textContent = '';
}

export function setProgress(percent, text) {
  progressFill.style.setProperty('--progress', String(percent));
  progressStatus.textContent = text;
}

export function showProgress(text) {
  progressSection.hidden = false;
  setProgress(0, text);
}

export function finishProgress() {
  setProgress(100, t('common.js_done', 'Done.'));
  setTimeout(() => {
    progressSection.hidden = true;
  }, 1200);
}

export function hideProgress() {
  progressSection.hidden = true;
}

export function checkPdfMagicBytes(bytes) {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
}

export function looksLikePdfFile(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function formatBytes(bytes) {
  if (bytes < 1000) return t('common.js_size_b', '{n} B', { n: bytes });
  if (bytes < 1000 * 1000) return t('common.js_size_kb', '{n} KB', { n: (bytes / 1000).toFixed(1) });
  return t('common.js_size_mb', '{n} MB', { n: (bytes / (1000 * 1000)).toFixed(1) });
}

export function downloadBlob(blob, filename, options = {}) {
  if (!options.download) return blob.arrayBuffer().then((bytes) => reviewResult(bytes, filename, { ...options, type: blob.type }));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadBytes(bytes, filename, type = 'application/pdf', options = {}) {
  if (options.download) return downloadBlob(new Blob([bytes], { type }), filename, options);
  return reviewResult(bytes, filename, { ...options, type });
}

// Wires the full dropzone interaction pattern (click, keyboard, drag
// highlight, drop, file input change) and calls onFiles(FileList-like array).
export function wireDropzone(dropzone, fileInput, onFiles) {
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onFiles(files);
  });
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    if (files.length) onFiles(files);
    fileInput.value = '';
  });
}

// Reads a dropped/selected file as PDF bytes with validation; returns
// { bytes, baseName } or null after showing an error.
// Extra Merge/Insert sources do not replace the current task or pending result.
export async function readExternalPdfFile(file, options = {}) {
  return (await loadWorkspaceSupport()).readExternalPdfFile(file, options, workspaceEnvironment);
}

export async function readPdfFile(file, options = {}) {
  const operation = options.operation;
  if (operation?.signal?.aborted || (operation && !operation.isCurrent())) return null;
  // Owned handoffs can have a baked current PDF larger than the editable
  // source. begin() validates every inherited source/resource before commit.
  const inheritedScene = options.allowInheritedScene && file.browserpdfSession?.scene;
  const limit = inheritedScene ? 250 * 1024 * 1024 : options.maxBytes || 250 * 1024 * 1024;
  if (options.maxPages !== undefined && (!Number.isSafeInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 10000)) { showError(t('workspace.invalid_page_limit', 'Invalid PDF page limit.')); return null; }
  if (options.maxBytes && file.size > limit) { showError(t('workspace.editor_too_large', 'Choose an editable PDF smaller than {n} MB.', { n: Math.round(limit / 1024 / 1024) })); return null; }
  const intake = ++intakeGeneration;
  const ownsIntake = () => intake === intakeGeneration && !operation?.signal?.aborted && (!operation || operation.isCurrent());
  documentOperations.cancel();
  if (file.size > 250 * 1024 * 1024) { showError(t('workspace.file_too_large', 'Choose a PDF smaller than 250 MB.')); return null; }
  if (!looksLikePdfFile(file)) {
    showError(t('common.js_err_not_pdf', 'Please select a PDF file.'));
    return null;
  }
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch (error) { if (ownsIntake()) showError(t('workspace.read_failed', 'Could not read this PDF: {message}', { message: error.message })); return null; }
  if (!ownsIntake()) return null;
  if (bytes.length > limit) { showError(t('workspace.editor_too_large', 'Choose an editable PDF smaller than {n} MB.', { n: Math.round(limit / 1024 / 1024) })); return null; }
  if (!checkPdfMagicBytes(bytes)) {
    showError(t('common.js_err_invalid_pdf', 'This file does not look like a valid PDF.'));
    return null;
  }
  if (!ownsIntake()) return null;
  if (options.validate) {
    try {
      const runtime = await import('./lib-loader.js');
      if (!ownsIntake()) return null;
      const [lib, pdfjs] = await Promise.all([runtime.ensurePdfLib(), runtime.ensurePdfJs()]);
      if (!ownsIntake()) return null;
      await lib.PDFDocument.load(bytes.slice());
      if (!ownsIntake()) return null;
      const task = pdfjs.getDocument({ data: bytes.slice(), ...runtime.PDFJS_ASSET_URLS });
      const cancel = () => { void task.destroy().catch(() => {}); }; operation?.signal?.addEventListener('abort',cancel,{ once: true });
      try { const doc = await task.promise; if (!doc.numPages) throw new Error('This PDF has no readable pages.'); if (options.maxPages && doc.numPages > options.maxPages) throw new RangeError(t('workspace.page_limit', 'Choose a PDF with 1–{n} readable pages.', { n: options.maxPages })); }
      finally { operation?.signal?.removeEventListener('abort',cancel); await task.destroy(); }
    } catch (error) {
      if (ownsIntake()) showError(t('workspace.parse_failed', 'Could not open this PDF: {message}', { message: error.message }));
      return null;
    }
  }
  if (!ownsIntake()) return null;
  try { await ensureDocumentSession(); if (!ownsIntake()) return null; documentSession.begin(bytes, file.name, { ...file.browserpdfSession, type: 'application/pdf' }); }
  catch (error) { if (ownsIntake()) showError(error.message); return null; }
  clearResult();
  showDocumentIdentity();
  return { bytes, baseName: file.name.replace(/\.pdf$/i, '') || 'document' };
}

// Wires the multi-select OCR language chip row (same pattern as the
// PDF to Markdown page). Call once at startup; read the selection with
// getSelectedOcrLangs().
export function initLangChips() {
  const wrap = document.querySelector('.lang-chips');
  if (!wrap) return;
  const count = document.getElementById('langCount');
  const update = () => {
    if (count) count.textContent = t('common.js_n_selected', '{n} selected', {
      n: wrap.querySelectorAll('.lang-chip[aria-pressed="true"]').length,
    });
  };
  wrap.addEventListener('click', (e) => {
    const chip = e.target.closest('.lang-chip');
    if (!chip) return;
    const pressed = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', String(!pressed));
    update();
  });
  update();
}

export function getSelectedOcrLangs() {
  const langs = Array.from(document.querySelectorAll('.lang-chip[aria-pressed="true"]')).map(
    (chip) => chip.dataset.lang
  );
  return langs.length ? langs : ['eng'];
}

export async function renderPdfPageToCanvas(pdfjs, bytes, pageNumber, canvas, targetWidth, assetUrls) {
  return (await loadWorkspaceSupport()).renderPdfPageToCanvas(pdfjs, bytes, pageNumber, canvas, targetWidth, assetUrls);
}

export async function stashForChain(bytes, name, targetSlug, options = {}) {
  const owner = documentSession.snapshot(), operation = options.operation;
  const owns = () => { const now = documentSession.snapshot(); return now.taskId === owner.taskId && now.revision === owner.revision && now.generation === owner.generation && (!operation || operation.isCurrent()); };
  const module = await loadHandoffSupport();
  if (!owns()) throw new DOMException('This continuation was replaced or cancelled.', 'AbortError');
  // Module loading and storage have separate ownership boundaries. The module
  // captures any deliberate adoption itself; preserve only the caller's token.
  return module.stashForChain(bytes, name, targetSlug, options, handoffEnvironment);
}

export async function stashCompositionForChain(targetSlug, options = {}) {
  const state = documentSession.snapshot();
  if (state.taskId !== options.expectedTaskId || state.revision !== options.expectedRevision || !state.hasComposition) throw new DOMException('This composition was replaced.', 'AbortError');
  const current = documentSession.current();
  return stashForChain(current.bytes, current.name, targetSlug, { ...current, ...options, compositionRevision: state.revision, operation: { signal: options.signal || options.operation?.signal, isCurrent: () => !options.signal?.aborted && (!options.operation || options.operation.isCurrent()) } });
}

// Keep empty-page handoff checks ahead of the optional module request.
export async function takeChainedFile() {
  try {
    const params = new URLSearchParams(window.location.search);
    const workflowId = params.get('workflow'), fileId = params.get('file');
    if (!workflowId || !fileId || !fileId.startsWith(`${workflowId}:`)) return null;
    return await (await loadHandoffSupport()).takeChainedFile(workflowId, fileId, handoffEnvironment);
  } catch { return null; }
}

// Fills #chainRow with "Continue in ..." buttons for the given result.
// targets: [{ slug: 'compress', label: 'Compress' }, ...]
export async function offerChain(bytes, name, targets, options = {}) {
  const generation = resultGeneration;
  if (options.operation && !options.operation.isCurrent()) return;
  const intent = ++railIntent; activeRail = null;
  await ensureDocumentSession();
  if (intent !== railIntent || generation !== resultGeneration || (options.operation && !options.operation.isCurrent())) return;
  const artifact = sessionCore.createArtifact(bytes, name, { ...(pendingResult?.name === name ? pendingResult : {}), ...options });
  const reviewed = pendingResult;
  const paired = reviewed && ['name', 'displayName', 'type', 'capabilities', 'boundary'].every((key) => JSON.stringify(artifact[key]) === JSON.stringify(reviewed[key])) && artifact.bytes.length === reviewed.bytes.length && artifact.bytes.every((byte, index) => byte === reviewed.bytes[index]);
  let continuationOwner = documentSession.snapshot();
  const continuationOperation = options.continuationOperation || options.operation;
  const rail = {};
  const owns = (now) => {
    return activeRail === rail && intent === railIntent && generation === resultGeneration && now.taskId === continuationOwner.taskId && (!continuationOperation || continuationOperation.isCurrent()) &&
      (!options.continuationOperation || (now.revision === continuationOwner.revision && now.generation === continuationOwner.generation));
  };
  const ownsContinuation = () => owns(documentSession.snapshot());
  // Only this rail's guarded synchronous Use/stash commit can move its owner.
  const transfer = (before, next) => { if (owns(before) && sameOwner(next, documentSession.snapshot())) continuationOwner = next; };
  rail.adopt = (value, before, next) => { if (paired && value === reviewed && pendingResult === reviewed) transfer(before, next); };
  activeRail = rail;
  let row = document.getElementById('chainRow');
  if (!row) { row = document.createElement('div'); row.id = 'chainRow'; row.className = 'chain-row'; (document.getElementById('documentResult') || document.querySelector('main') || document.body).appendChild(row); }
  row.textContent = '';
  const intro = document.createElement('span');
  intro.className = 'chain-intro';
  intro.textContent = t('common.js_chain_intro', 'Continue with this result:');
  row.appendChild(intro);
  const defaults = artifact.type === 'application/pdf' ? [
    { slug: 'add-text', label: 'Add Text' }, { slug: 'add-image', label: 'Add Image' },
    { slug: 'fill-sign', label: 'Fill & Sign' }, { slug: 'organize', label: 'Organize' },
    { slug: 'privacy-scan', label: 'Privacy Scan' }, { slug: 'document-doctor', label: 'Document Doctor' }, { slug: 'workflows', label: 'Workflows' },
  ] : artifact.type === 'text/markdown' || artifact.type === 'text/plain' ? [{ slug: 'markdown-viewer', label: 'Markdown Viewer' }, { slug: 'markdown-to-pdf', label: 'Markdown to PDF' }] : [];
  const unique = new Map([...targets, ...defaults].map((target) => [target.slug, target]));
  if (artifact.capabilities.encrypted) unique.set('unlock', { slug: 'unlock', label: 'Unlock' });
  for (const target of [...unique.values()].filter((target) => sessionCore.acceptsArtifact(target.slug, artifact))) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-small';
    const hubKey = 'hub.tool_' + (target.slug === 'ocr-pdf' ? 'ocr' : target.slug.replace(/-/g, '_'));
    btn.textContent = t(hubKey, target.label);
    btn.addEventListener('click', async () => {
      try {
        if (!ownsContinuation()) return;
        btn.disabled = true;
        const before = documentSession.snapshot();
        const handoff = await stashForChain(artifact.bytes, artifact.name, target.slug, { ...artifact,
          operation: { signal: continuationOperation?.signal, isCurrent: ownsContinuation },
          onAdoptionOwner: (next) => transfer(before, next),
        });
        if (!handoff.isCurrent()) return;
        const lang = getLang();
        const path = lang === 'en' ? '/' + target.slug : `/${lang}/${target.slug}`;
        window.location.href = `${path}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`;
      } catch (err) {
        if (err?.name === 'AbortError') { if (btn.isConnected) btn.disabled = false; return; }
        if (options.continuationOperation && !ownsContinuation()) return;
        showError(t('workspace.handoff_failed', 'Could not continue with this result: {message}', { message: err?.message || 'local storage is unavailable' }));
        btn.disabled = false;
      }
    });
    row.appendChild(btn);
  }
  row.hidden = false;
}

export async function renderPdfThumbnails(pdfDoc, containerEl, makeTile, onEachProgress) {
  return (await loadWorkspaceSupport()).renderPdfThumbnails(pdfDoc, containerEl, makeTile, onEachProgress);
}
