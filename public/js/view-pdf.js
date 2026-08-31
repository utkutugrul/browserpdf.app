'use strict';

import { ensurePdfJs, PDFJS_ASSET_URLS } from './lib-loader.js';
import { t } from './i18n.js';
import {
  showError, hideError, showProgress, setProgress, hideProgress,
  wireDropzone, readPdfFile, takeChainedFile,
} from './tool-ui.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const viewerSection = document.getElementById('viewerSection');
const viewerContainer = document.getElementById('viewerContainer');
const pdfCanvas = document.getElementById('pdfCanvas');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageIndicator = document.getElementById('pageIndicator');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomLevel = document.getElementById('zoomLevel');
const fitWidthBtn = document.getElementById('fitWidthBtn');
const printBtn = document.getElementById('printBtn');

const MIN_SCALE = 0.25;
const MAX_SCALE = 5.0;
const ZOOM_STEP = 0.25;

let currentFileName = 'document';
let currentBytes = null;
let pdfJsDocRef = null;
let currentPageNum = 1;
let numPages = 0;
let currentScale = 1.0;
let activeRenderTask = null;

function clampScale(scale) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function updatePageIndicator() {
  pageIndicator.textContent = t('view-pdf.js_page_of', 'Page {x} of {n}', { x: currentPageNum, n: numPages });
  prevPageBtn.disabled = currentPageNum <= 1;
  nextPageBtn.disabled = currentPageNum >= numPages;
  zoomLevel.textContent = Math.round(currentScale * 100) + '%';
}

async function renderPage(pageNum) {
  if (!pdfJsDocRef) return;
  const page = await pdfJsDocRef.getPage(pageNum);
  const dpr = window.devicePixelRatio || 1;
  const renderScale = currentScale * dpr;
  const viewport = page.getViewport({ scale: renderScale });
  const cssViewport = page.getViewport({ scale: currentScale });
  const ctx = pdfCanvas.getContext('2d');
  pdfCanvas.width = Math.floor(viewport.width);
  pdfCanvas.height = Math.floor(viewport.height);
  pdfCanvas.style.width = Math.floor(cssViewport.width) + 'px';
  pdfCanvas.style.height = Math.floor(cssViewport.height) + 'px';
  if (activeRenderTask) {
    try { activeRenderTask.cancel(); } catch {}
  }
  activeRenderTask = page.render({ canvasContext: ctx, viewport });
  try {
    await activeRenderTask.promise;
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') throw err;
    return;
  } finally {
    activeRenderTask = null;
  }
  currentPageNum = pageNum;
  updatePageIndicator();
  viewerContainer.scrollTop = 0;
}

async function goToPage(pageNum) {
  if (!pdfJsDocRef) return;
  const target = Math.min(Math.max(1, pageNum), numPages);
  if (target === currentPageNum) return;
  try {
    await renderPage(target);
  } catch (err) {
    console.error(err);
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  }
}

function prevPage() {
  goToPage(currentPageNum - 1);
}

function nextPage() {
  goToPage(currentPageNum + 1);
}

async function reRender() {
  if (!pdfJsDocRef) return;
  try {
    await renderPage(currentPageNum);
  } catch (err) {
    console.error(err);
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  }
}

function zoomIn() {
  currentScale = clampScale(Math.round((currentScale + ZOOM_STEP) * 100) / 100);
  reRender();
}

function zoomOut() {
  currentScale = clampScale(Math.round((currentScale - ZOOM_STEP) * 100) / 100);
  reRender();
}

async function fitWidth() {
  if (!pdfJsDocRef) return;
  try {
    const page = await pdfJsDocRef.getPage(currentPageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const available = viewerContainer.clientWidth - 36;
    if (baseViewport.width > 0 && available > 0) {
      currentScale = clampScale(available / baseViewport.width);
      await renderPage(currentPageNum);
    }
  } catch (err) {
    console.error(err);
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  }
}

function printPdf() {
  if (!currentBytes) return;
  const blob = new Blob([currentBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    showError(t('view-pdf.js_err_popup', 'Could not open the print window. Please allow popups for this site.'));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function handleFile(file) {
  hideError();
  viewerSection.hidden = true;
  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;

  showProgress(t('common.js_loading_pdf', 'Loading PDF…'));
  try {
    const pdfjs = await ensurePdfJs((msg) => setProgress(0, msg));
    if (pdfJsDocRef) {
      try { await pdfJsDocRef.destroy(); } catch {}
      pdfJsDocRef = null;
    }
    const loadingTask = pdfjs.getDocument({ data: parsed.bytes.slice(), ...PDFJS_ASSET_URLS });
    const pdfDoc = await loadingTask.promise;
    pdfJsDocRef = pdfDoc;
    numPages = pdfDoc.numPages;
    currentPageNum = 1;
    currentScale = 1.0;

    setProgress(50, t('view-pdf.js_rendering', 'Rendering page…'));
    viewerSection.hidden = false;
    await renderPage(currentPageNum);
  } catch (err) {
    console.error(err);
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
    viewerSection.hidden = true;
  } finally {
    hideProgress();
  }
}

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));

prevPageBtn.addEventListener('click', prevPage);
nextPageBtn.addEventListener('click', nextPage);
zoomInBtn.addEventListener('click', zoomIn);
zoomOutBtn.addEventListener('click', zoomOut);
fitWidthBtn.addEventListener('click', fitWidth);
printBtn.addEventListener('click', printPdf);

document.addEventListener('keydown', (e) => {
  if (!pdfJsDocRef) return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prevPage();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    nextPage();
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    zoomIn();
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    zoomOut();
  }
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
