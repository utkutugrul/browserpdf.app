'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { takeChainedFile } from './tool-ui.js';
import { t } from './i18n.js';

const LOW = { scale: 0.85, quality: 0.55 };
const MED = { scale: 1.3, quality: 0.78 };
const HIGH = { scale: 2.0, quality: 0.9 };

function levelForSlider(value) {
  if (value <= 50) {
    const t = value / 50;
    return { scale: LOW.scale + (MED.scale - LOW.scale) * t, quality: LOW.quality + (MED.quality - LOW.quality) * t };
  }
  const t = (value - 50) / 50;
  return { scale: MED.scale + (HIGH.scale - MED.scale) * t, quality: MED.quality + (HIGH.quality - MED.quality) * t };
}

function labelForSlider(value) {
  if (value < 20) return t('compress.level_smallest', 'Smallest file');
  if (value < 40) return t('compress.level_smaller', 'Smaller file');
  if (value <= 60) return t('compress.level_balanced', 'Balanced');
  if (value < 80) return t('compress.level_good', 'Good quality');
  return t('compress.level_highest', 'Highest quality');
}

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const optionsSection = document.getElementById('optionsSection');
const fileSummary = document.getElementById('fileSummary');
const compressBtn = document.getElementById('compressBtn');
const levelSlider = document.getElementById('levelSlider');
const levelLabel = document.getElementById('levelLabel');
const estimateLabel = document.getElementById('estimateLabel');
const resultSummary = document.getElementById('resultSummary');
const progressSection = document.getElementById('progressSection');
const progressStatus = document.getElementById('progressStatus');
const progressFill = document.getElementById('progressFill');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');

let currentBytes = null;
let currentFileName = 'document';
let currentPdfDoc = null;
let numPages = 0;
let estimateToken = 0;
let estimateDebounceTimer = null;

function showError(message) {
  errorText.textContent = message;
  errorSection.hidden = false;
}
function hideError() {
  errorSection.hidden = true;
  errorText.textContent = '';
}
function setProgress(percent, text) {
  progressFill.style.setProperty('--progress', String(percent));
  progressStatus.textContent = text;
}
function formatBytes(bytes) {
  if (bytes < 1000) return t('compress.js_size_b', '{size} B', { size: bytes });
  if (bytes < 1000 * 1000) return t('compress.js_size_kb', '{size} KB', { size: (bytes / 1000).toFixed(1) });
  return t('compress.js_size_mb', '{size} MB', { size: (bytes / (1000 * 1000)).toFixed(1) });
}
function checkPdfMagicBytes(bytes) {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
}

// Estimating from page 1 alone was wildly wrong on real documents (a light
// cover page in front of dense scans understated the output size 30x), so
// sample several pages spread across the document instead.
const ESTIMATE_SAMPLE_PAGES = 5;
// What pdf-lib adds around the raw JPEGs: page + XObject dictionaries and the
// content stream per page, header/xref/trailer per document. Measured against
// real output, not guessed.
const ESTIMATE_PAGE_OVERHEAD = 300;
const ESTIMATE_DOC_OVERHEAD = 1000;

function samplePageNumbers(total) {
  if (total <= ESTIMATE_SAMPLE_PAGES) return Array.from({ length: total }, (_, i) => i + 1);
  const picks = new Set();
  for (let k = 0; k < ESTIMATE_SAMPLE_PAGES; k++) {
    picks.add(1 + Math.round((k * (total - 1)) / (ESTIMATE_SAMPLE_PAGES - 1)));
  }
  return [...picks].sort((a, b) => a - b);
}

async function pageJpegSize(pageNum, level) {
  const page = await currentPdfDoc.getPage(pageNum);
  const renderViewport = page.getViewport({ scale: level.scale });
  const canvas = document.createElement('canvas');
  canvas.width = renderViewport.width;
  canvas.height = renderViewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: renderViewport }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', level.quality));
  return blob.size;
}

async function estimateSize() {
  if (!currentPdfDoc) return;
  const myToken = ++estimateToken;
  const level = levelForSlider(Number(levelSlider.value));
  estimateLabel.textContent = t('compress.js_estimating', 'Estimating…');
  try {
    const samples = samplePageNumbers(numPages);
    const sizes = [];
    for (const pageNum of samples) {
      sizes.push(await pageJpegSize(pageNum, level));
      if (myToken !== estimateToken) return; // superseded by a newer drag position
    }

    let jpegTotal;
    if (samples.length >= numPages) {
      jpegTotal = sizes.reduce((a, b) => a + b, 0);
    } else {
      // Page 1 only stands for itself (covers are unrepresentative); the other
      // samples stand in for the rest of the document.
      const rest = sizes.slice(1);
      const restMean = rest.reduce((a, b) => a + b, 0) / rest.length;
      jpegTotal = sizes[0] + restMean * (numPages - 1);
    }
    const estimatedTotal = Math.round(jpegTotal + ESTIMATE_PAGE_OVERHEAD * numPages + ESTIMATE_DOC_OVERHEAD);
    const originalSize = currentBytes.length;
    const change = Math.round((1 - estimatedTotal / originalSize) * 100);
    estimateLabel.textContent =
      change > 0
        ? t('compress.js_estimate_smaller', 'Estimated: ~{size} (~{change}% smaller)', { size: formatBytes(estimatedTotal), change })
        : t('compress.js_estimate_no_shrink', 'Estimated: ~{size} (may not shrink at this level)', { size: formatBytes(estimatedTotal) });
  } catch (err) {
    console.warn('Size estimate failed:', err);
    if (myToken === estimateToken) estimateLabel.textContent = '';
  }
}

levelSlider.addEventListener('input', () => {
  levelLabel.textContent = labelForSlider(Number(levelSlider.value));
  if (!currentPdfDoc) return;
  // Invalidate any in-flight estimate immediately: it was started for an older
  // slider position and would otherwise overwrite the label with a stale value
  // while the debounced re-estimate is still pending.
  estimateToken++;
  estimateLabel.textContent = t('compress.js_estimating', 'Estimating…');
  clearTimeout(estimateDebounceTimer);
  estimateDebounceTimer = setTimeout(estimateSize, 250);
});

async function handleFile(file) {
  hideError();
  optionsSection.hidden = true;
  resultSummary.hidden = true;
  estimateToken++; // a previous file's in-flight estimate must not write here
  estimateLabel.textContent = '';
  currentPdfDoc = null;

  const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) {
    showError(t('common.js_err_not_pdf', 'Please select a PDF file.'));
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!checkPdfMagicBytes(bytes)) {
    showError(t('common.js_err_invalid_pdf', 'This file does not look like a valid PDF.'));
    return;
  }
  currentBytes = bytes;
  currentFileName = file.name.replace(/\.pdf$/i, '') || 'document';
  fileSummary.textContent = t('compress.js_file_summary', '{name} ({size})', { name: file.name, size: formatBytes(file.size) });

  progressSection.hidden = false;
  setProgress(0, t('common.js_loading_pdf', 'Loading PDF…'));
  try {
    const pdfjs = await ensurePdfJs((msg) => setProgress(0, msg));
    const loadingTask = pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_ASSET_URLS });
    currentPdfDoc = await loadingTask.promise;
    numPages = currentPdfDoc.numPages;
    optionsSection.hidden = false;
    estimateSize();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  } finally {
    progressSection.hidden = true;
  }
}

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
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
  fileInput.value = '';
});

compressBtn.addEventListener('click', async () => {
  if (!currentBytes || !currentPdfDoc) return;
  hideError();
  resultSummary.hidden = true;
  progressSection.hidden = false;
  compressBtn.disabled = true;
  levelSlider.disabled = true;
  const originalSize = currentBytes.length;

  try {
    setProgress(0, t('common.js_loading_pdflib', 'Loading pdf-lib…'));
    const pdfDoc = currentPdfDoc;

    const pdfLib = await ensurePdfLib((msg) => setProgress(0, msg));
    const outDoc = await pdfLib.PDFDocument.create();
    const level = levelForSlider(Number(levelSlider.value));

    for (let i = 1; i <= numPages; i++) {
      setProgress(Math.round((i / numPages) * 90), t('compress.js_compressing_page', 'Compressing page {i}/{n}', { i, n: numPages }));
      const page = await pdfDoc.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const renderViewport = page.getViewport({ scale: level.scale });
      const canvas = document.createElement('canvas');
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: renderViewport }).promise;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', level.quality));
      const jpgBytes = new Uint8Array(await blob.arrayBuffer());
      const embedded = await outDoc.embedJpg(jpgBytes);
      const outPage = outDoc.addPage([baseViewport.width, baseViewport.height]);
      outPage.drawImage(embedded, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
    }

    setProgress(95, t('common.js_saving', 'Saving…'));
    const outBytes = await outDoc.save();

    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentFileName}-compressed.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const change = Math.round((1 - outBytes.length / originalSize) * 100);
    resultSummary.textContent =
      change > 0
        ? t('compress.js_result_smaller', '{from} → {to} ({change}% smaller)', { from: formatBytes(originalSize), to: formatBytes(outBytes.length), change })
        : t('compress.js_result_no_shrink', '{from} → {to} (this file didn\'t get smaller at this level; try "Smaller file")', { from: formatBytes(originalSize), to: formatBytes(outBytes.length) });
    resultSummary.hidden = false;

    setProgress(100, t('common.js_done', 'Done.'));
    setTimeout(() => {
      progressSection.hidden = true;
    }, 1200);
  } catch (err) {
    console.error(err);
    showError(err?.message || t('compress.js_err_compress', 'Something went wrong while compressing this PDF.'));
    progressSection.hidden = true;
  } finally {
    compressBtn.disabled = false;
    levelSlider.disabled = false;
  }
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
