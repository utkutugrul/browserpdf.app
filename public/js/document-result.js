'use strict';

import { ensurePdfJs, ensureMammoth, ensureXlsx, PDFJS_ASSET_URLS } from './lib-loader.js';
import { t } from './i18n.js';
import { boundedViewport } from './core/bounded-renderer.js';

let currentGeneration = 0;
let activeTask = null;
let objectUrl = null;
let imageWork = Promise.resolve();
const previews = new Set();
const taskDestruction = new WeakMap();
function prune(record) {
  if (record.generation !== currentGeneration && !record.work.size && !record.cleanup.size && !record.tasks.size && !record.errors.length) previews.delete(record);
}
function track(record, value) {
  const promise = Promise.resolve(value); record.work.add(promise);
  const settled = () => { record.work.delete(promise); prune(record); };
  promise.then(settled, settled);
  return promise;
}
function retire(record, task) {
  if (!task) return Promise.resolve();
  let promise = taskDestruction.get(task);
  if (!promise) {
    promise = Promise.resolve().then(() => task.destroy()); taskDestruction.set(task, promise);
    record.cleanup.add(promise);
    promise.then(() => { record.tasks.delete(task); record.failedTasks.delete(task); record.cleanup.delete(promise); prune(record); }, (error) => { record.cleanup.delete(promise); record.failedTasks.add(task); record.errors.push(error); });
  }
  return promise;
}
function retryNativeCleanup(record) {
  if (record.retrying) return record.retrying;
  if (record.errors.length) {
    if (record.reporting) return Promise.reject(record.errors[0]);
    record.errors = [];
    for (const task of record.failedTasks) taskDestruction.delete(task);
    record.failedTasks.clear();
  }
  // This barrier waits for native destruction only. Waiting for record.work
  // here would include the event-driven load that is calling this function.
  const pending = Promise.all([...record.tasks].map((task) => retire(record, task)));
  record.retrying = pending;
  const settled = () => { if (record.retrying === pending) record.retrying = null; };
  pending.then(settled, settled);
  return pending;
}
function cleanupBeforeLoad(generation) {
  const captured = [...previews].filter((record) => record.generation <= generation && record.tasks.size);
  return Promise.all(captured.map(retryNativeCleanup));
}
function drainRecord(record, reportFailure) {
  if (reportFailure && record.reporting) return record.reporting;
  const pending = (async () => {
    while (record.work.size || record.cleanup.size) await Promise.allSettled([...record.work, ...record.cleanup]);
    if (!record.errors.length && !record.tasks.size) previews.delete(record);
    if (reportFailure && record.errors.length) {
      record.errors = [];
      for (const task of record.tasks) taskDestruction.delete(task);
      record.failedTasks.clear();
      const error = new Error('Native preview cleanup failed. Retry cleanup before starting another PDF.'); error.code = 'DOCUMENT_PREVIEW_CLEANUP'; throw error;
    }
  })();
  if (reportFailure) {
    // Concurrent explicit drains share this exact cleanup attempt and failure.
    // A subsequent retry starts only after this attempt has settled.
    record.reporting = pending;
    const settled = () => { if (record.reporting === pending) record.reporting = null; };
    pending.then(settled, settled);
  }
  return pending;
}
function invalidatePreviews(reportFailure) {
  currentGeneration++;
  const captured = [...previews];
  activeTask = null;
  for (const record of captured) {
    record.cancelRender?.();
    if (!record.reporting) for (const task of record.tasks) void retire(record, task).catch(() => {});
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
  const panel = document.getElementById('documentResult'); if (panel) panel.hidden = true;
  for (const canvas of panel?.querySelectorAll('canvas') || []) canvas.width = canvas.height = 0;
  // Capture only these generations. Never await an external lane tail or work
  // from a subsequent result; all already-started event work settles here.
  const drains = captured.map((record) => drainRecord(record, reportFailure));
  return Promise.allSettled(drains).then((settled) => { const failed = settled.find((value) => value.status === 'rejected'); if (failed) throw failed.reason; });
}

export function ensureWorkspaceStyles() {
  if (document.getElementById('documentWorkspaceStyles')) return;
  const link = document.createElement('link'); link.id = 'documentWorkspaceStyles'; link.rel = 'stylesheet'; link.href = '/css/document-workspace.css'; document.head.appendChild(link);
}

export function showDocumentResult(artifact, options = {}) {
  const record = { generation: null, work: new Set(), tasks: new Set(), cleanup: new Set(), failedTasks: new Set(), errors: [], reporting: null, retrying: null };
  previews.add(record);
  return track(record, showResult(artifact, options, record));
}

async function showResult(artifact, { session, download, adopt, imageWorkLane } = {}, record) {
  ensureWorkspaceStyles();
  const generation = ++currentGeneration;
  record.generation = generation;
  for (const previous of previews) prune(previous);
  const previousTask = activeTask;
  activeTask = null;
  const previousRecord = [...previews].find((value) => value.tasks.has(previousTask));
  if (previousTask) await retire(previousRecord || record, previousTask);
  if (generation !== currentGeneration) return null;
  await cleanupBeforeLoad(generation);
  if (generation !== currentGeneration) return null;
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  let panel = document.getElementById('documentResult');
  if (!panel) {
    panel = document.createElement('section'); panel.id = 'documentResult'; panel.className = 'document-result'; panel.setAttribute('aria-labelledby', 'documentResultHeading');
    const anchor = document.getElementById('chainRow');
    if (anchor) anchor.before(panel); else (document.querySelector('main') || document.body).appendChild(panel);
  }
  panel.hidden = false; panel.replaceChildren();
  const heading = document.createElement('h2'); heading.id = 'documentResultHeading'; heading.textContent = t('workspace.review_result', 'Review your result');
  const identity = document.createElement('p'); identity.id = 'documentResultIdentity';
  const source = session?.original;
  const displayName = (value) => value?.displayName || value?.name;
  identity.textContent = `${t('workspace.original', 'Original')}: ${displayName(source) || displayName(artifact)} · ${t('workspace.result', 'Result')}: ${displayName(artifact)} · ${t('workspace.revision', 'Revision')} ${session?.revision || 0} · ${(artifact.bytes.length / 1000).toFixed(1)} KB`;
  const status = document.createElement('p'); status.id = 'documentResultStatus'; status.setAttribute('role', 'status');
  const controls = document.createElement('div'); controls.className = 'btn-row';
  const preview = document.createElement('div'); preview.className = 'document-result-preview'; preview.id = 'documentResultPreview';
  panel.append(heading, identity, status, controls, preview);
  const lossLabels = {
    'page-copy-structures-unverified': 'Copied pages may lose document structures that this engine cannot verify.',
    'page-copy-document-metadata': 'Page copying may lose document metadata.',
    'page-copy-form-definitions': 'Page copying may lose interactive form definitions.', 'page-copy-bookmarks': 'Page copying may lose bookmarks.',
    'page-copy-tags': 'Page copying may lose accessibility tags.', 'page-copy-named-resources': 'Page copying may lose named document resources.',
    'page-copy-labels': 'Page copying may lose page labels.', 'signature-rewrite': 'Rewriting signed content can invalidate existing digital signatures.',
    'structure-inspection-incomplete': 'Some document structures could not be inspected.', 'crop-hidden-content': 'Cropping hides content; it does not securely remove it.',
    'scene-baked': 'This operation includes pending edits in the PDF. Undo restores the preceding editable state.',
    'composition-baked': 'This operation includes the image composition in the PDF. Undo restores the preceding editable state.',
    'redaction-selected-pages-rasterized': 'Pages with redaction masks become images and lose selectable/searchable text and vector detail. Other supported pages keep their text.',
    'redaction-document-rasterized': 'Every page becomes an image. Searchable text, editable fields and annotations, links, bookmarks, attachments, tags and vector detail are not retained. Any existing digital signature is invalidated.',
    'redaction-metadata-removed': 'Source Info and XMP metadata are omitted from this new PDF. The original remains separately available in this task.',
  };
  if (artifact.boundary?.losses?.length) {
    const losses = document.createElement('ul'); losses.id = 'documentResultLosses';
    for (const code of artifact.boundary.losses) if (lossLabels[code]) { const item = document.createElement('li'); item.textContent = t(`workspace.loss_${code}`, lossLabels[code]); losses.append(item); }
    identity.after(losses);
  }
  function button(label, onClick, id) { const element = document.createElement('button'); element.type = 'button'; element.className = 'btn btn-secondary'; element.textContent = label; if (id) element.id = id; element.addEventListener('click', onClick); controls.append(element); return element; }
  button(t('workspace.download_result', 'Download result'), () => download(artifact), 'downloadResultBtn');
  if (adopt) button(t('workspace.use_result', 'Use this result'), () => { try { const next = adopt(artifact); if (!next) return; identity.textContent = `${t('workspace.original', 'Original')}: ${displayName(source) || displayName(artifact)} · ${t('workspace.result', 'Result')}: ${displayName(artifact)} · ${t('workspace.revision', 'Revision')} ${next.revision || 0} · ${(artifact.bytes.length / 1000).toFixed(1)} KB`; status.textContent = t('workspace.current_result', 'This result is now the current document.'); } catch (error) { fail(error); } }, 'useResultBtn');
  let pageNumber = Math.max(1, (Number.isSafeInteger(session?.selection?.[0]) ? session.selection[0] : 0) + 1);
  let doc = null;
  let loadedValue = null;
  let previewGeneration = 0;
  let pageGeneration = 0;
  let renderTask = null;
  record.cancelRender = () => renderTask?.cancel();
  let rendering = Promise.resolve();
  const runImageWork = (work) => { if (imageWorkLane) return imageWorkLane.run(work); const next = imageWork.catch(() => {}).then(work); imageWork = next.catch(() => {}); return next; };
  const canvas = document.createElement('canvas');
  const pageStatus = document.createElement('span'); pageStatus.id = 'documentResultPage'; pageStatus.setAttribute('aria-live', 'polite');
  async function renderPage() {
    if (generation !== currentGeneration) return;
    const loadGeneration = previewGeneration, renderGeneration = ++pageGeneration, requestedPage = pageNumber, requestedDoc = doc;
    renderTask?.cancel(); preview.setAttribute('aria-busy', 'true');
    pageStatus.textContent = `${requestedPage} / ${requestedDoc?.numPages || '…'} · ${t('workspace.loading_page', 'Loading page…')}`;
    rendering = rendering.catch(() => {}).then(() => runImageWork(async () => {
      if (generation !== currentGeneration || loadGeneration !== previewGeneration || renderGeneration !== pageGeneration || !requestedDoc) return;
      const page = await requestedDoc.getPage(requestedPage);
      if (generation !== currentGeneration || loadGeneration !== previewGeneration || renderGeneration !== pageGeneration) return;
      const viewport = boundedViewport(page, { scale: 1.5, maxDimension: 900, maxPixels: 4000000 });
      canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
      renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      try { await renderTask.promise; } catch (error) { if (error.name !== 'RenderingCancelledException') throw error; }
      if (generation === currentGeneration && loadGeneration === previewGeneration && renderGeneration === pageGeneration) { pageStatus.textContent = `${requestedPage} / ${requestedDoc.numPages}`; preview.setAttribute('aria-busy', 'false'); canvas.dataset.pdfPage = String(requestedPage); }
    }));
    return track(record, rendering.catch((error) => { if (generation !== currentGeneration || loadGeneration !== previewGeneration || renderGeneration !== pageGeneration) return; throw error; }));
  }
  function loadPdf(value) { return track(record, loadPdfWork(value)); }
  async function loadPdfWork(value) {
    if (generation !== currentGeneration) return;
    if (loadedValue === value && doc) return;
    const loadGeneration = ++previewGeneration, previous = activeTask;
    activeTask = null; doc = null; loadedValue = null;
    preview.setAttribute('aria-busy', 'true'); status.textContent = t('workspace.loading_preview', 'Loading actual file preview…');
    renderTask?.cancel();
    await retire(record, previous);
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) return;
    await cleanupBeforeLoad(generation);
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) return;
    const pdfjs = await ensurePdfJs();
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) return;
    const task = pdfjs.getDocument({ data: value.bytes.slice(), ...PDFJS_ASSET_URLS }); activeTask = task; record.tasks.add(task);
    let loaded;
    try { loaded = await task.promise; } catch (error) { if (generation !== currentGeneration || loadGeneration !== previewGeneration) return; throw error; }
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) { await retire(record, task); return; }
    doc = loaded; loadedValue = value;
    pageNumber = Math.max(1, Math.min(doc.numPages, pageNumber)); canvas.setAttribute('aria-label',displayName(value)); preview.replaceChildren(canvas); await renderPage();
    if (generation === currentGeneration && loadGeneration === previewGeneration) status.textContent = `${value === artifact ? t('workspace.result', 'Result') : t('workspace.original', 'Original')}: ${displayName(value)}. ${t('workspace.preview_ready', 'The actual file is shown below. Download when ready.')}`;
  }
  function loadImage(getValue, original) { return track(record, loadImageWork(getValue, original)); }
  async function loadImageWork(getValue, original) {
    if (generation !== currentGeneration) return;
    const loadGeneration = ++previewGeneration, previous = activeTask; activeTask = null; doc = null; loadedValue = null;
    renderTask?.cancel(); preview.setAttribute('aria-busy', 'true');
    await retire(record, previous);
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) return;
    await cleanupBeforeLoad(generation);
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) return;
    await runImageWork(async () => {
      const current = () => generation === currentGeneration && loadGeneration === previewGeneration;
      if (!current()) return;
      const value = getValue(); if (!value || !['image/png','image/jpeg'].includes(value.type)) throw new Error('This image is unavailable.');
      const { imageDimensions } = await import('./core/composition-state.js'); imageDimensions(value.bytes,value.type); if (!current()) return;
      // Decode the immutable raw original with its EXIF orientation once. Only
      // the bounded selected canvas survives; codec work drains on replacement.
      const bitmap = await createImageBitmap(new Blob([value.bytes], { type: value.type }), { imageOrientation: 'from-image' });
      try {
        if (!current()) return;
        if (bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width * bitmap.height > 16000000) throw new RangeError('This original image exceeds the preview limits.');
        const scale = Math.min(1,1200 / Math.max(bitmap.width,bitmap.height),Math.sqrt(2000000 / (bitmap.width * bitmap.height)));
        canvas.width = Math.max(1,Math.floor(bitmap.width * scale)); canvas.height = Math.max(1,Math.floor(bitmap.height * scale)); canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        canvas.setAttribute('aria-label',displayName(value)); canvas.removeAttribute('data-pdf-page'); preview.replaceChildren(canvas);
        status.textContent = `${original ? t('workspace.original', 'Original') : t('workspace.result', 'Result')}: ${displayName(value)}${original ? '' : '. ' + t('workspace.preview_ready','The actual file is shown below. Download when ready.')}`; preview.setAttribute('aria-busy', 'false'); pageStatus.textContent = '';
      } finally { bitmap.close(); }
    });
  }
  try {
    if (artifact.type === 'application/pdf' && !artifact.capabilities.encrypted) {
      button(t('workspace.previous_page', 'Previous page'), () => { if (doc && pageNumber > 1) { pageNumber--; void renderPage().catch(fail); } });
      controls.appendChild(pageStatus);
      button(t('workspace.next_page', 'Next page'), () => { if (doc && pageNumber < doc.numPages) { pageNumber++; void renderPage().catch(fail); } });
      if (source?.type === 'application/pdf' && !source.capabilities?.encrypted) {
        button(t('workspace.show_original', 'Show original'), () => loadPdf(source).catch(fail));
        button(t('workspace.show_result', 'Show result'), () => loadPdf(artifact).catch(fail));
      }
      if (session?.compositionSources?.originals.length) {
        const label = document.createElement('label'), choose = document.createElement('select'); choose.id = 'documentResultOriginal';
        label.textContent = t('workspace.original_images', 'Original images ({n})', { n: session.compositionSources.originals.length });
        for (const original of session.compositionSources.originals) { const option = document.createElement('option'); option.value = original.originalRef; option.textContent = original.name; choose.append(option); }
        label.append(choose); controls.append(label);
        button(t('workspace.show_original_image', 'Show selected original image'), () => { const ref = choose.value, original = session.compositionSources.originals.find((item) => item.originalRef === ref); return loadImage(() => { const resource = session.resource?.(ref); return resource ? { ...resource,name:original.name } : null; },true).catch(fail); }, 'showOriginalImageBtn');
        button(t('workspace.show_result', 'Show result'), () => loadPdf(artifact).catch(fail), 'showCompositionResultBtn');
      }
      await loadPdf(artifact);
    } else if (artifact.type.startsWith('text/')) {
      const text = document.createElement('textarea'); text.readOnly = true; text.setAttribute('aria-label', t('workspace.text_result', 'Result text')); text.value = new TextDecoder().decode(artifact.bytes); preview.append(text);
    } else if (artifact.type.startsWith('image/')) {
      await loadImage(() => artifact,false);
    } else if (/wordprocessingml/.test(artifact.type)) {
      const mammoth = await ensureMammoth(); const result = await mammoth.extractRawText({ arrayBuffer: artifact.bytes.slice().buffer });
      if (generation !== currentGeneration) return;
      const text = document.createElement('pre'); text.textContent = result.value; preview.append(text);
      status.textContent = t('workspace.docx_preview', 'Text extracted from the generated Word file. Word controls its final page layout.');
    } else if (/spreadsheetml/.test(artifact.type)) {
      const xlsx = await ensureXlsx(); const workbook = xlsx.read(artifact.bytes, { type: 'array' });
      if (generation !== currentGeneration) return;
      for (const name of workbook.SheetNames.slice(0, 30)) { const title = document.createElement('h3'); title.textContent = name; const text = document.createElement('pre'); text.textContent = xlsx.utils.sheet_to_csv(workbook.Sheets[name]); preview.append(title, text); }
    } else {
      status.textContent = artifact.capabilities.encrypted ? t('workspace.encrypted_result', 'Password-protected result. Continue through Unlock to inspect or edit it.') : t('workspace.file_result', 'Result file ready. Review the output list before downloading.');
    }
  } catch (error) { fail(error); }
  function fail(error) { if (generation === currentGeneration) { preview.setAttribute('aria-busy', 'false'); status.textContent = `${t('workspace.preview_failed', 'Preview could not be displayed')}: ${error.message}`; } }
  return panel;
}

export function clearDocumentResult() {
  void invalidatePreviews(false).catch(() => {});
}

export function clearDocumentResultAndDrain() { return invalidatePreviews(true); }
