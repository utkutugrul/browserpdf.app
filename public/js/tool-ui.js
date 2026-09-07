'use strict';

import { t, getLang } from './i18n.js';
import { createWorkflowStore } from './core/workflow-store.js';

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

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadBytes(bytes, filename, type = 'application/pdf') {
  downloadBlob(new Blob([bytes], { type }), filename);
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
export async function readPdfFile(file) {
  if (!looksLikePdfFile(file)) {
    showError(t('common.js_err_not_pdf', 'Please select a PDF file.'));
    return null;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!checkPdfMagicBytes(bytes)) {
    showError(t('common.js_err_invalid_pdf', 'This file does not look like a valid PDF.'));
    return null;
  }
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

async function stashForChain(bytes, name, targetSlug) {
  const store = createWorkflowStore();
  await store.cleanupExpired();
  const workflowId = crypto.randomUUID();
  const file = {
    id: `${workflowId}:input`, name, type: 'application/pdf', bytes: new Uint8Array(bytes),
  };
  await store.putWorkflowBundle({
    id: workflowId,
    kind: 'handoff',
    orderedSteps: [{ id: `tool:${targetSlug}`, parameters: {} }],
    currentStep: 0,
    fileRefs: [file.id],
    cleanup: { policy: 'expire', scope: workflowId },
  }, [file]);
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
    const store = createWorkflowStore();
    await store.cleanupExpired();
    const workflow = await store.getWorkflow(workflowId);
    if (!workflow || !workflow.fileRefs.includes(fileId)) return null;
    const entry = await store.getFile(fileId);
    if (!entry || entry.workflowId !== workflowId) return null;
    return new File([entry.bytes], entry.name, { type: entry.type || 'application/pdf' });
  } catch {
    return null;
  }
}

// Fills #chainRow with "Continue in ..." buttons for the given result.
// targets: [{ slug: 'compress', label: 'Compress' }, ...]
export function offerChain(bytes, name, targets) {
  const row = document.getElementById('chainRow');
  if (!row) return;
  row.textContent = '';
  const intro = document.createElement('span');
  intro.className = 'chain-intro';
  intro.textContent = t('common.js_chain_intro', 'Continue with this result:');
  row.appendChild(intro);
  for (const target of targets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-small';
    const hubKey = 'hub.tool_' + (target.slug === 'ocr-pdf' ? 'ocr' : target.slug.replace(/-/g, '_'));
    btn.textContent = t(hubKey, target.label);
    btn.addEventListener('click', async () => {
      try {
        const handoff = await stashForChain(bytes, name, target.slug);
        const lang = getLang();
        const path = lang === 'en' ? '/' + target.slug : `/${lang}/${target.slug}`;
        window.location.href = `${path}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`;
      } catch (err) {
        console.warn('Could not hand the file to the next tool:', err);
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
