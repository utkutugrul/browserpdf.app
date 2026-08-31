'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { zipStore } from './zip-writer.js';
import { takeChainedFile, offerChain } from './tool-ui.js';
import { t } from './i18n.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const pageGridSection = document.getElementById('pageGridSection');
const pageGrid = document.getElementById('pageGrid');
const modeExtract = document.getElementById('modeExtract');
const modeEach = document.getElementById('modeEach');
const selectAllBtn = document.getElementById('selectAllBtn');
const selectNoneBtn = document.getElementById('selectNoneBtn');
const pageSelectionCount = document.getElementById('pageSelectionCount');
const splitActionBtn = document.getElementById('splitActionBtn');
const splitActionLabel = document.getElementById('splitActionLabel');
const splitHint = document.getElementById('splitHint');
const progressSection = document.getElementById('progressSection');
const progressStatus = document.getElementById('progressStatus');
const progressFill = document.getElementById('progressFill');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');

let currentBytes = null;
let currentFileName = 'document';
let numPages = 0;
let selected = new Set();
let mode = 'extract';

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

function looksLikePdfName(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function checkPdfMagicBytes(bytes) {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
}

function downloadBytes(bytes, filename, type = 'application/pdf') {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function handleFile(file) {
  hideError();
  pageGridSection.hidden = true;

  if (!looksLikePdfName(file)) {
    showError(t('common.js_err_not_pdf', 'Please select a PDF file.'));
    return;
  }

  currentFileName = file.name.replace(/\.pdf$/i, '') || 'document';
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!checkPdfMagicBytes(bytes)) {
    showError(t('common.js_err_invalid_pdf', 'This file does not look like a valid PDF.'));
    return;
  }
  currentBytes = bytes;

  progressSection.hidden = false;
  setProgress(0, t('common.js_loading_pdf', 'Loading PDF…'));
  try {
    const pdfjs = await ensurePdfJs((msg) => setProgress(0, msg));
    // pdf.js may transfer/detach the buffer it's given, so hand it a copy
    // and keep `currentBytes` intact for pdf-lib to use later.
    const loadingTask = pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_ASSET_URLS });
    const pdfDoc = await loadingTask.promise;
    numPages = pdfDoc.numPages;
    selected = new Set();

    pageGrid.textContent = '';
    pageGridSection.hidden = false;
    for (let i = 1; i <= numPages; i++) {
      setProgress(Math.round((i / numPages) * 100), t('common.js_rendering_page', 'Rendering page {i}/{n}', { i, n: numPages }));
      const page = await pdfDoc.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = (220 / baseViewport.width) * (window.devicePixelRatio > 1 ? 1.6 : 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

      const tile = document.createElement('div');
      tile.className = 'page-tile';
      tile.dataset.pageIndex = String(i - 1);
      tile.setAttribute('role', 'checkbox');
      tile.setAttribute('aria-checked', 'false');
      tile.setAttribute('tabindex', '0');
      tile.appendChild(canvas);
      const label = document.createElement('span');
      label.className = 'page-tile-label';
      label.textContent = t('split.js_page_label', 'Page {n}', { n: i });
      tile.appendChild(label);

      const index = i - 1;
      tile.addEventListener('click', () => togglePage(index));
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          togglePage(index);
        }
      });

      pageGrid.appendChild(tile);
    }
    updateSelectionUI();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
    pageGridSection.hidden = true;
  } finally {
    progressSection.hidden = true;
  }
}

function togglePage(index) {
  const tile = pageGrid.querySelector(`[data-page-index="${index}"]`);
  if (selected.has(index)) {
    selected.delete(index);
    tile?.classList.remove('selected');
    tile?.setAttribute('aria-checked', 'false');
  } else {
    selected.add(index);
    tile?.classList.add('selected');
    tile?.setAttribute('aria-checked', 'true');
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  pageSelectionCount.textContent = t('split.js_pages_selected', '{selected} of {total} pages selected', { selected: selected.size, total: numPages });
  if (mode === 'extract') {
    splitActionLabel.textContent = t('split.btn_extract', 'Extract selected pages');
    splitActionBtn.disabled = selected.size === 0;
    splitHint.textContent = t('split.hint_extract', 'Click pages to select them, then extract.');
  } else {
    splitActionLabel.textContent = t('split.js_btn_split_all', 'Split all {n} pages into files', { n: numPages });
    splitActionBtn.disabled = numPages === 0;
    splitHint.textContent = t('split.js_hint_each', 'Every page becomes its own PDF, downloaded together as one ZIP (selection is ignored in this mode).');
  }
}

function setMode(next) {
  mode = next;
  modeExtract.classList.toggle('active', mode === 'extract');
  modeEach.classList.toggle('active', mode === 'each');
  modeExtract.setAttribute('aria-selected', String(mode === 'extract'));
  modeEach.setAttribute('aria-selected', String(mode === 'each'));
  updateSelectionUI();
}

modeExtract.addEventListener('click', () => setMode('extract'));
modeEach.addEventListener('click', () => setMode('each'));

selectAllBtn.addEventListener('click', () => {
  selected = new Set(Array.from({ length: numPages }, (_, i) => i));
  pageGrid.querySelectorAll('.page-tile').forEach((tile) => {
    tile.classList.add('selected');
    tile.setAttribute('aria-checked', 'true');
  });
  updateSelectionUI();
});

selectNoneBtn.addEventListener('click', () => {
  selected = new Set();
  pageGrid.querySelectorAll('.page-tile').forEach((tile) => {
    tile.classList.remove('selected');
    tile.setAttribute('aria-checked', 'false');
  });
  updateSelectionUI();
});

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

splitActionBtn.addEventListener('click', () => {
  if (mode === 'extract') {
    doExtract();
  } else {
    doSplitEach();
  }
});

async function doExtract() {
  if (!selected.size) return;
  hideError();
  progressSection.hidden = false;
  splitActionBtn.disabled = true;
  try {
    setProgress(10, t('common.js_loading_pdflib', 'Loading pdf-lib…'));
    const pdfLib = await ensurePdfLib((msg) => setProgress(10, msg));
    const srcDoc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const outDoc = await pdfLib.PDFDocument.create();
    const sortedIndices = Array.from(selected).sort((a, b) => a - b);
    setProgress(50, t('split.js_extracting', 'Extracting pages…'));
    const copiedPages = await outDoc.copyPages(srcDoc, sortedIndices);
    copiedPages.forEach((page) => outDoc.addPage(page));
    setProgress(85, t('common.js_saving', 'Saving…'));
    const outBytes = await outDoc.save();
    const outName = `${currentFileName}-extracted.pdf`;
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'compress', label: 'Compress' },
      { slug: 'page-numbers', label: 'Add Page Numbers' },
      { slug: 'watermark', label: 'Add Watermark' },
    ]);
    setProgress(100, t('common.js_done', 'Done.'));
    setTimeout(() => {
      progressSection.hidden = true;
    }, 1200);
  } catch (err) {
    console.error(err);
    showError(err?.message || t('split.js_err_extract', 'Something went wrong while extracting pages.'));
    progressSection.hidden = true;
  } finally {
    splitActionBtn.disabled = selected.size === 0;
  }
}

async function doSplitEach() {
  if (!numPages) return;
  hideError();
  progressSection.hidden = false;
  splitActionBtn.disabled = true;
  try {
    setProgress(5, t('common.js_loading_pdflib', 'Loading pdf-lib…'));
    const pdfLib = await ensurePdfLib((msg) => setProgress(5, msg));
    const srcDoc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const entries = [];
    for (let i = 0; i < numPages; i++) {
      setProgress(Math.round(((i + 1) / numPages) * 95), t('split.js_creating_page', 'Creating page {i}/{n}', { i: i + 1, n: numPages }));
      const outDoc = await pdfLib.PDFDocument.create();
      const [page] = await outDoc.copyPages(srcDoc, [i]);
      outDoc.addPage(page);
      entries.push({ name: `${currentFileName}-page-${i + 1}.pdf`, data: await outDoc.save() });
    }
    if (entries.length === 1) {
      downloadBytes(entries[0].data, entries[0].name);
    } else {
      setProgress(98, t('split.js_packing_zip', 'Packing ZIP…'));
      downloadBytes(zipStore(entries), `${currentFileName}-pages.zip`, 'application/zip');
    }
    setProgress(100, t('common.js_done', 'Done.'));
    setTimeout(() => {
      progressSection.hidden = true;
    }, 1200);
  } catch (err) {
    console.error(err);
    showError(err?.message || t('split.js_err_split', 'Something went wrong while splitting pages.'));
    progressSection.hidden = true;
  } finally {
    splitActionBtn.disabled = false;
  }
}

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
