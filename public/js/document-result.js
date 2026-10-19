'use strict';

import { ensurePdfJs, ensureMammoth, ensureXlsx, PDFJS_ASSET_URLS } from './lib-loader.js';
import { t } from './i18n.js';

let currentGeneration = 0;
let activeTask = null;
let objectUrl = null;
let imageWork = Promise.resolve();

export function ensureWorkspaceStyles() {
  if (document.getElementById('documentWorkspaceStyles')) return;
  const link = document.createElement('link'); link.id = 'documentWorkspaceStyles'; link.rel = 'stylesheet'; link.href = '/css/document-workspace.css'; document.head.appendChild(link);
}

export async function showDocumentResult(artifact, { session, download, adopt, imageWorkLane } = {}) {
  ensureWorkspaceStyles();
  const generation = ++currentGeneration;
  const previousTask = activeTask;
  activeTask = null;
  try { await previousTask?.destroy(); } catch { /* previous preview cleanup */ }
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
  let rendering = Promise.resolve();
  const runImageWork = (work) => { if (imageWorkLane) return imageWorkLane.run(work); const next = imageWork.catch(() => {}).then(work); imageWork = next.catch(() => {}); return next; };
  const canvas = document.createElement('canvas');
  const pageStatus = document.createElement('span'); pageStatus.id = 'documentResultPage'; pageStatus.setAttribute('aria-live', 'polite');
  async function renderPage() {
    const loadGeneration = previewGeneration, renderGeneration = ++pageGeneration, requestedPage = pageNumber, requestedDoc = doc;
    renderTask?.cancel(); preview.setAttribute('aria-busy', 'true');
    pageStatus.textContent = `${requestedPage} / ${requestedDoc?.numPages || '…'} · ${t('workspace.loading_page', 'Loading page…')}`;
    rendering = rendering.catch(() => {}).then(() => runImageWork(async () => {
      if (generation !== currentGeneration || loadGeneration !== previewGeneration || renderGeneration !== pageGeneration || !requestedDoc) return;
      const page = await requestedDoc.getPage(requestedPage);
      if (generation !== currentGeneration || loadGeneration !== previewGeneration || renderGeneration !== pageGeneration) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1.5, 900 / Math.max(base.width, base.height), Math.sqrt(4000000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale }); canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
      renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      try { await renderTask.promise; } catch (error) { if (error.name !== 'RenderingCancelledException') throw error; }
      if (generation === currentGeneration && loadGeneration === previewGeneration && renderGeneration === pageGeneration) { pageStatus.textContent = `${requestedPage} / ${requestedDoc.numPages}`; preview.setAttribute('aria-busy', 'false'); canvas.dataset.pdfPage = String(requestedPage); }
    }));
    return rendering.catch((error) => { if (generation !== currentGeneration || loadGeneration !== previewGeneration || renderGeneration !== pageGeneration) return; throw error; });
  }
  async function loadPdf(value) {
    if (loadedValue === value && doc) return;
    const loadGeneration = ++previewGeneration, previous = activeTask;
    activeTask = null; doc = null; loadedValue = null;
    preview.setAttribute('aria-busy', 'true'); status.textContent = t('workspace.loading_preview', 'Loading actual file preview…');
    renderTask?.cancel();
    try { await previous?.destroy(); } catch { /* old preview */ }
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) return;
    const pdfjs = await ensurePdfJs();
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) return;
    const task = pdfjs.getDocument({ data: value.bytes.slice(), ...PDFJS_ASSET_URLS }); activeTask = task;
    let loaded;
    try { loaded = await task.promise; } catch (error) { if (generation !== currentGeneration || loadGeneration !== previewGeneration) return; throw error; }
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) { await task.destroy(); return; }
    doc = loaded; loadedValue = value;
    pageNumber = Math.max(1, Math.min(doc.numPages, pageNumber)); canvas.setAttribute('aria-label',displayName(value)); preview.replaceChildren(canvas); await renderPage();
    if (generation === currentGeneration && loadGeneration === previewGeneration) status.textContent = `${value === artifact ? t('workspace.result', 'Result') : t('workspace.original', 'Original')}: ${displayName(value)}. ${t('workspace.preview_ready', 'The actual file is shown below. Download when ready.')}`;
  }
  async function loadImage(getValue, original) {
    const loadGeneration = ++previewGeneration, previous = activeTask; activeTask = null; doc = null; loadedValue = null;
    renderTask?.cancel(); preview.setAttribute('aria-busy', 'true');
    try { await previous?.destroy(); } catch { /* previous PDF preview */ }
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
  currentGeneration++;
  void activeTask?.destroy().catch(() => {}); activeTask = null;
  if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
  const panel = document.getElementById('documentResult'); if (panel) panel.hidden = true;
  for (const canvas of panel?.querySelectorAll('canvas') || []) canvas.width = canvas.height = 0;
}
