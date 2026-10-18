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
  original: () => sessionDelegate?.original() || null,
  transfer: () => sessionDelegate?.transfer() || { ...emptySession(), history: [], future: [] },
  begin: (...args) => sessionDelegate ? sessionDelegate.begin(...args) : ensureDocumentSession().then((delegate) => delegate.begin(...args)),
  adopt: (...args) => sessionDelegate ? sessionDelegate.adopt(...args) : ensureDocumentSession().then((delegate) => delegate.adopt(...args)),
  undo: () => sessionDelegate?.undo() || null,
  redo: () => sessionDelegate?.redo() || null,
  setSelection: (pages) => sessionDelegate?.setSelection(pages),
  invalidate: () => sessionDelegate?.invalidate(),
  clear: () => { sessionDelegate?.clear(); documentOperations.cancel(); clearResult(); document.getElementById('documentIdentity')?.remove(); },
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
let intakeGeneration = 0;
const loadResultModule = retryableModule('./document-result.js');
const loadResultUi = () => (resultModule ||= loadResultModule().catch((error) => { resultModule = null; throw error; }));

export function showDocumentIdentity() {
  const snapshot = documentSession.snapshot();
  if (!snapshot.current) return;
  let identity = document.getElementById('documentIdentity');
  if (!identity) {
    identity = document.createElement('p'); identity.id = 'documentIdentity'; identity.className = 'option-hint'; identity.setAttribute('role', 'status');
    const dropzone = document.getElementById('dropzone');
    if (dropzone) dropzone.after(identity); else document.querySelector('main')?.prepend(identity);
  }
  identity.textContent = `${t('workspace.original', 'Original')}: ${snapshot.original.name} · ${t('workspace.current', 'Current')}: ${snapshot.current.name} · ${t('workspace.revision', 'Revision')} ${snapshot.revision}`;
}

export async function reviewResult(bytes, name, options = {}) {
  if (options.operation && !options.operation.isCurrent()) return Promise.resolve(null);
  if (options.groupOwner !== undefined && options.groupOwner !== resultGroupGeneration) return null;
  if (options.groupOwner === undefined) { resultGroupGeneration++; document.getElementById('documentResultGroup')?.remove(); }
  const generation = ++resultGeneration;
  await ensureDocumentSession();
  if (generation !== resultGeneration || (options.operation && !options.operation.isCurrent())) return null;
  const artifact = sessionCore.createArtifact(bytes, name, { ...options, capabilities: options.capabilities || documentSession.snapshot().current?.capabilities });
  pendingResult = artifact;
  if (options.adopt) documentSession.adopt(artifact.bytes, artifact.name, artifact);
  showDocumentIdentity();
  return loadResultUi().then((ui) => generation !== resultGeneration || (options.operation && !options.operation.isCurrent()) ? null : ui.showDocumentResult(artifact, {
    session: { ...documentSession.snapshot(), original: documentSession.original() },
    download: (value) => downloadBlob(new Blob([value.bytes], { type: value.type }), value.name, { download: true }),
    adopt: (value) => { const snapshot = documentSession.adopt(value.bytes, value.name, value); showDocumentIdentity(); return snapshot; },
  }));
}

export function clearResult() {
  pendingResult = null;
  resultGeneration++;
  resultGroupGeneration++;
  if (resultModule) void resultModule.then((ui) => ui.clearDocumentResult()).catch(() => {});
  const row = document.getElementById('chainRow'); if (row) row.hidden = true;
  document.getElementById('documentResultGroup')?.remove();
}

export async function reviewResults(results) {
  if (!Array.isArray(results) || !results.length || results.length > 20) throw new RangeError('Review between 1 and 20 result files.');
  const total = results.reduce((sum, value) => sum + value.bytes.byteLength, 0);
  if (total > 250 * 1024 * 1024) throw new RangeError('This result group is limited to 250 MB.');
  clearResult();
  const owner = resultGroupGeneration, generation = resultGeneration;
  const ownsGroup = () => owner === resultGroupGeneration;
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
export async function readPdfFile(file, options = {}) {
  const intake = ++intakeGeneration;
  documentOperations.cancel();
  if (file.size > 250 * 1024 * 1024) { showError(t('workspace.file_too_large', 'Choose a PDF smaller than 250 MB.')); return null; }
  if (!looksLikePdfFile(file)) {
    showError(t('common.js_err_not_pdf', 'Please select a PDF file.'));
    return null;
  }
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch (error) { if (intake === intakeGeneration) showError(t('workspace.read_failed', 'Could not read this PDF: {message}', { message: error.message })); return null; }
  if (intake !== intakeGeneration) return null;
  if (!checkPdfMagicBytes(bytes)) {
    showError(t('common.js_err_invalid_pdf', 'This file does not look like a valid PDF.'));
    return null;
  }
  if (intake !== intakeGeneration) return null;
  if (options.validate) {
    try {
      const runtime = await import('./lib-loader.js');
      const [lib, pdfjs] = await Promise.all([runtime.ensurePdfLib(), runtime.ensurePdfJs()]);
      await lib.PDFDocument.load(bytes.slice());
      const task = pdfjs.getDocument({ data: bytes.slice(), ...runtime.PDFJS_ASSET_URLS });
      try { const doc = await task.promise; if (!doc.numPages) throw new Error('This PDF has no readable pages.'); }
      finally { await task.destroy(); }
    } catch (error) {
      if (intake === intakeGeneration) showError(t('workspace.parse_failed', 'Could not open this PDF: {message}', { message: error.message }));
      return null;
    }
  }
  if (intake !== intakeGeneration) return null;
  try { await ensureDocumentSession(); if (intake !== intakeGeneration) return null; documentSession.begin(bytes, file.name, { ...file.browserpdfSession, type: 'application/pdf' }); }
  catch (error) { showError(error.message); return null; }
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

// Renders one page of a PDF (given as bytes) into a canvas, scaled to
// targetWidth CSS pixels. Used for live result previews.
export async function renderPdfPageToCanvas(pdfjs, bytes, pageNumber, canvas, targetWidth, assetUrls) {
  const loadingTask = pdfjs.getDocument({ data: bytes.slice(), ...assetUrls });
  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(Math.min(pageNumber, doc.numPages));
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = (targetWidth / baseViewport.width) * (window.devicePixelRatio > 1 ? 1.6 : 1);
    const viewport = page.getViewport({ scale });
    canvas.dataset.pdfScale = String(scale);
    canvas.dataset.pdfPage = String(pageNumber);
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  } finally {
    await loadingTask.destroy();
  }
}

/* ---------- Cross-tool workflow handoff ----------
Outputs are stored in BrowserPDF's versioned workflow database. References in
the URL make each handoff page-local and resumable; expiry cleanup touches only
records owned by that workflow, never another database or origin store. */

export async function stashForChain(bytes, name, targetSlug, options = {}) {
  await ensureDocumentSession();
  const store = await loadWorkflowStore();
  await store.cleanupExpired();
  const artifact = sessionCore.createArtifact(bytes, name, options);
  if (!sessionCore.acceptsArtifact(targetSlug, artifact)) throw new Error('This tool does not accept this result format.');
  if (documentSession.snapshot().current) documentSession.adopt(artifact.bytes, artifact.name, artifact);
  let snapshot = documentSession.transfer();
  if (!snapshot.taskId) { documentSession.begin(artifact.bytes, artifact.name, artifact); snapshot = documentSession.transfer(); }
  const workflowId = snapshot.taskId;
  const file = { ...artifact, id: `${workflowId}:input` };
  const original = snapshot.original ? { ...snapshot.original, id: `${workflowId}:original` } : null;
  const past = snapshot.history.map((value, index) => ({ ...value, id: `${workflowId}:past:${index}` }));
  const future = snapshot.future.map((value, index) => ({ ...value, id: `${workflowId}:future:${index}` }));
  await store.putWorkflowBundle({
    id: workflowId,
    kind: 'handoff',
    orderedSteps: [{ id: `tool:${targetSlug}`, parameters: {} }],
    currentStep: 0,
    fileRefs: [file.id, ...(original ? [original.id] : []), ...past.map((a) => a.id), ...future.map((a) => a.id)],
    originalRef: original?.id || null,
    revision: snapshot.revision,
    selection: snapshot.selection,
    historyRefs: past.map((a) => a.id), futureRefs: future.map((a) => a.id),
    cleanup: { policy: 'expire', scope: workflowId },
  }, [file, ...(original ? [original] : []), ...past, ...future]);
  return { workflowId, fileId: file.id };
}

// Loads the URL-addressed handoff without deleting it, allowing reload or back
// navigation until the workflow's bounded expiry.
export async function takeChainedFile() {
  try {
    const params = new URLSearchParams(window.location.search);
    const workflowId = params.get('workflow');
    const fileId = params.get('file');
    if (!workflowId || !fileId || !fileId.startsWith(`${workflowId}:`)) return null;
    await ensureDocumentSession();
    const store = await loadWorkflowStore();
    await store.cleanupExpired();
    const workflow = await store.getWorkflow(workflowId);
    if (!workflow || !workflow.fileRefs.includes(fileId)) return null;
    const entry = await store.getFile(fileId);
    if (!entry || entry.workflowId !== workflowId) return null;
    const file = new File([entry.bytes], entry.name, { type: entry.type || 'application/pdf' });
    const original = workflow.originalRef && workflow.fileRefs.includes(workflow.originalRef) ? await store.getFile(workflow.originalRef) : null;
    const owned = await store.listFiles(workflowId);
    const refs = new Map(owned.filter((value) => workflow.fileRefs.includes(value.id)).map((value) => [value.id, value]));
    const inherited = { taskId: workflow.kind === 'handoff' ? workflowId : undefined, revision: workflow.revision, type: entry.type, capabilities: entry.capabilities, selection: workflow.selection,
      history: (workflow.historyRefs || []).slice(-5).map((id) => refs.get(id)).filter(Boolean), future: (workflow.futureRefs || []).slice(-5).map((id) => refs.get(id)).filter(Boolean) };
    if (original?.workflowId === workflowId) inherited.original = sessionCore.createArtifact(original.bytes, original.name, original);
    Object.defineProperty(file, 'browserpdfSession', { value: inherited });
    return file;
  } catch {
    return null;
  }
}

// Fills #chainRow with "Continue in ..." buttons for the given result.
// targets: [{ slug: 'compress', label: 'Compress' }, ...]
export async function offerChain(bytes, name, targets, options = {}) {
  const generation = resultGeneration;
  if (options.operation && !options.operation.isCurrent()) return;
  await ensureDocumentSession();
  if (generation !== resultGeneration || (options.operation && !options.operation.isCurrent())) return;
  const artifact = sessionCore.createArtifact(bytes, name, { ...(pendingResult?.name === name ? pendingResult : {}), ...options });
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
        btn.disabled = true;
        const handoff = await stashForChain(artifact.bytes, artifact.name, target.slug, artifact);
        const lang = getLang();
        const path = lang === 'en' ? '/' + target.slug : `/${lang}/${target.slug}`;
        window.location.href = `${path}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`;
      } catch (err) {
        showError(t('workspace.handoff_failed', 'Could not continue with this result: {message}', { message: err?.message || 'local storage is unavailable' }));
        btn.disabled = false;
      }
    });
    row.appendChild(btn);
  }
  row.hidden = false;
}

// Renders one thumbnail canvas per page into containerEl. makeTile receives
// (canvas, pageIndex) and must return the tile element to append.
export async function renderPdfThumbnails(pdfDoc, containerEl, makeTile, onEachProgress) {
  containerEl.textContent = '';
  const numPages = pdfDoc.numPages;
  for (let i = 1; i <= numPages; i++) {
    onEachProgress?.(i, numPages);
    const page = await pdfDoc.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = (220 / baseViewport.width) * (window.devicePixelRatio > 1 ? 1.6 : 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    containerEl.appendChild(makeTile(canvas, i - 1));
  }
}
