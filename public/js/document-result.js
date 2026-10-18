'use strict';

import { ensurePdfJs, ensureMammoth, ensureXlsx, PDFJS_ASSET_URLS } from './lib-loader.js';
import { t } from './i18n.js';

let currentGeneration = 0;
let activeTask = null;
let objectUrl = null;

export function ensureWorkspaceStyles() {
  if (document.getElementById('documentWorkspaceStyles')) return;
  const link = document.createElement('link'); link.id = 'documentWorkspaceStyles'; link.rel = 'stylesheet'; link.href = '/css/document-workspace.css'; document.head.appendChild(link);
}

export async function showDocumentResult(artifact, { session, download, adopt } = {}) {
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
  identity.textContent = `${t('workspace.original', 'Original')}: ${source?.name || artifact.name} · ${t('workspace.result', 'Result')}: ${artifact.name} · ${t('workspace.revision', 'Revision')} ${session?.revision || 0} · ${(artifact.bytes.length / 1000).toFixed(1)} KB`;
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
    'scene-baked': 'This operation bakes editable objects into page content. Undo restores the preceding editable scene.',
  };
  if (artifact.boundary?.losses?.length) {
    const losses = document.createElement('ul'); losses.id = 'documentResultLosses';
    for (const code of artifact.boundary.losses) if (lossLabels[code]) { const item = document.createElement('li'); item.textContent = t(`workspace.loss_${code}`, lossLabels[code]); losses.append(item); }
    identity.after(losses);
  }
  function button(label, onClick, id) { const element = document.createElement('button'); element.type = 'button'; element.className = 'btn btn-secondary'; element.textContent = label; if (id) element.id = id; element.addEventListener('click', onClick); controls.append(element); return element; }
  button(t('workspace.download_result', 'Download result'), () => download(artifact), 'downloadResultBtn');
  if (adopt) button(t('workspace.use_result', 'Use this result'), () => { const next = adopt(artifact); identity.textContent = `${t('workspace.original', 'Original')}: ${source?.name || artifact.name} · ${t('workspace.result', 'Result')}: ${artifact.name} · ${t('workspace.revision', 'Revision')} ${next?.revision || 0} · ${(artifact.bytes.length / 1000).toFixed(1)} KB`; status.textContent = t('workspace.current_result', 'This result is now the current document.'); }, 'useResultBtn');
  let pageNumber = 1;
  let doc = null;
  let previewGeneration = 0;
  let renderTask = null;
  let rendering = Promise.resolve();
  const canvas = document.createElement('canvas');
  const pageStatus = document.createElement('span'); pageStatus.setAttribute('aria-live', 'polite');
  async function renderPage() {
    const pageGeneration = previewGeneration, requestedPage = pageNumber, requestedDoc = doc;
    rendering = rendering.catch(() => {}).then(async () => {
      if (generation !== currentGeneration || pageGeneration !== previewGeneration || !requestedDoc) return;
      const page = await requestedDoc.getPage(requestedPage);
      if (generation !== currentGeneration || pageGeneration !== previewGeneration) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1.5, 900 / Math.max(base.width, base.height), Math.sqrt(4000000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale }); canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
      renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      try { await renderTask.promise; } catch (error) { if (error.name !== 'RenderingCancelledException') throw error; }
      if (generation === currentGeneration && pageGeneration === previewGeneration) pageStatus.textContent = `${requestedPage} / ${requestedDoc.numPages}`;
    });
    return rendering;
  }
  async function loadPdf(value) {
    const loadGeneration = ++previewGeneration, previous = activeTask;
    activeTask = null; doc = null;
    renderTask?.cancel();
    try { await previous?.destroy(); } catch { /* old preview */ }
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) return;
    const pdfjs = await ensurePdfJs();
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) return;
    const task = pdfjs.getDocument({ data: value.bytes.slice(), ...PDFJS_ASSET_URLS }); activeTask = task;
    const loaded = await task.promise;
    if (generation !== currentGeneration || loadGeneration !== previewGeneration) { await task.destroy(); return; }
    doc = loaded;
    pageNumber = 1; preview.replaceChildren(canvas); await renderPage();
    if (generation === currentGeneration && loadGeneration === previewGeneration) status.textContent = `${value === artifact ? t('workspace.result', 'Result') : t('workspace.original', 'Original')}: ${value.name}. ${t('workspace.preview_ready', 'The actual file is shown below. Download when ready.')}`;
  }
  try {
    if (artifact.type === 'application/pdf' && !artifact.capabilities.encrypted) {
      button(t('workspace.previous_page', 'Previous page'), () => { if (pageNumber > 1) { pageNumber--; void renderPage(); } });
      controls.appendChild(pageStatus);
      button(t('workspace.next_page', 'Next page'), () => { if (doc && pageNumber < doc.numPages) { pageNumber++; void renderPage(); } });
      if (source?.type === 'application/pdf' && !source.capabilities?.encrypted) {
        button(t('workspace.show_original', 'Show original'), () => loadPdf(source).catch(fail));
        button(t('workspace.show_result', 'Show result'), () => loadPdf(artifact).catch(fail));
      }
      await loadPdf(artifact);
    } else if (artifact.type.startsWith('text/')) {
      const text = document.createElement('textarea'); text.readOnly = true; text.setAttribute('aria-label', t('workspace.text_result', 'Result text')); text.value = new TextDecoder().decode(artifact.bytes); preview.append(text);
    } else if (artifact.type.startsWith('image/')) {
      objectUrl = URL.createObjectURL(new Blob([artifact.bytes], { type: artifact.type })); const image = document.createElement('img'); image.src = objectUrl; image.alt = artifact.name; preview.append(image);
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
  function fail(error) { if (generation === currentGeneration) status.textContent = `${t('workspace.preview_failed', 'Preview could not be displayed')}: ${error.message}`; }
  return panel;
}

export function clearDocumentResult() {
  currentGeneration++;
  void activeTask?.destroy().catch(() => {}); activeTask = null;
  if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
  const panel = document.getElementById('documentResult'); if (panel) panel.hidden = true;
}
