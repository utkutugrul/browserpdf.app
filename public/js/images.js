'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { zipStore } from './zip-writer.js';
import { t } from './i18n.js';

const modePdfToImg = document.getElementById('modePdfToImg');
const modeImgToPdf = document.getElementById('modeImgToPdf');
const pdfToImgSection = document.getElementById('pdfToImgSection');
const imgToPdfSection = document.getElementById('imgToPdfSection');

const progressSection = document.getElementById('progressSection');
const progressStatus = document.getElementById('progressStatus');
const progressFill = document.getElementById('progressFill');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');

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
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function checkPdfMagicBytes(bytes) {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
}

function setMode(mode) {
  const isPdfToImg = mode === 'pdf-to-img';
  modePdfToImg.classList.toggle('active', isPdfToImg);
  modeImgToPdf.classList.toggle('active', !isPdfToImg);
  modePdfToImg.setAttribute('aria-selected', String(isPdfToImg));
  modeImgToPdf.setAttribute('aria-selected', String(!isPdfToImg));
  pdfToImgSection.hidden = !isPdfToImg;
  imgToPdfSection.hidden = isPdfToImg;
  hideError();
}
modePdfToImg.addEventListener('click', () => setMode('pdf-to-img'));
modeImgToPdf.addEventListener('click', () => setMode('img-to-pdf'));

/* ---------- PDF to Images ---------- */

const pdfDropzone = document.getElementById('pdfDropzone');
const pdfFileInput = document.getElementById('pdfFileInput');
const imgPageGridSection = document.getElementById('imgPageGridSection');
const imgPageGrid = document.getElementById('imgPageGrid');
const imgSelectionCount = document.getElementById('imgSelectionCount');
const imgSelectAllBtn = document.getElementById('imgSelectAllBtn');
const imgSelectNoneBtn = document.getElementById('imgSelectNoneBtn');
const exportImagesBtn = document.getElementById('exportImagesBtn');
const formatSelect = document.getElementById('formatSelect');
const resolutionSelect = document.getElementById('resolutionSelect');

let pdfDocRef = null;
let pdfNumPages = 0;
let pdfSelected = new Set();
let pdfFileBaseName = 'document';

async function handlePdfFile(file) {
  hideError();
  imgPageGridSection.hidden = true;
  const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) {
    showError(t('common.js_err_not_pdf', 'Please select a PDF file.'));
    return;
  }
  pdfFileBaseName = file.name.replace(/\.pdf$/i, '') || 'document';
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!checkPdfMagicBytes(bytes)) {
    showError(t('common.js_err_invalid_pdf', 'This file does not look like a valid PDF.'));
    return;
  }

  progressSection.hidden = false;
  setProgress(0, t('common.js_loading_pdf', 'Loading PDF…'));
  try {
    const pdfjs = await ensurePdfJs((msg) => setProgress(0, msg));
    const loadingTask = pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_ASSET_URLS });
    pdfDocRef = await loadingTask.promise;
    pdfNumPages = pdfDocRef.numPages;
    pdfSelected = new Set(Array.from({ length: pdfNumPages }, (_, i) => i));

    imgPageGrid.textContent = '';
    imgPageGridSection.hidden = false;
    for (let i = 1; i <= pdfNumPages; i++) {
      setProgress(Math.round((i / pdfNumPages) * 100), t('common.js_rendering_page', 'Rendering page {i}/{n}', { i, n: pdfNumPages }));
      const page = await pdfDocRef.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = (220 / baseViewport.width) * (window.devicePixelRatio > 1 ? 1.6 : 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

      const tile = document.createElement('div');
      tile.className = 'page-tile selected';
      tile.dataset.pageIndex = String(i - 1);
      tile.setAttribute('role', 'checkbox');
      tile.setAttribute('aria-checked', 'true');
      tile.setAttribute('tabindex', '0');
      tile.appendChild(canvas);
      const label = document.createElement('span');
      label.className = 'page-tile-label';
      label.textContent = t('images.js_page_label', 'Page {n}', { n: i });
      tile.appendChild(label);

      const index = i - 1;
      tile.addEventListener('click', () => togglePdfPage(index));
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          togglePdfPage(index);
        }
      });
      imgPageGrid.appendChild(tile);
    }
    updatePdfSelectionUI();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
    imgPageGridSection.hidden = true;
  } finally {
    progressSection.hidden = true;
  }
}

function togglePdfPage(index) {
  const tile = imgPageGrid.querySelector(`[data-page-index="${index}"]`);
  if (pdfSelected.has(index)) {
    pdfSelected.delete(index);
    tile?.classList.remove('selected');
    tile?.setAttribute('aria-checked', 'false');
  } else {
    pdfSelected.add(index);
    tile?.classList.add('selected');
    tile?.setAttribute('aria-checked', 'true');
  }
  updatePdfSelectionUI();
}

function updatePdfSelectionUI() {
  imgSelectionCount.textContent = t('images.js_pages_selected', '{sel} of {total} pages selected', { sel: pdfSelected.size, total: pdfNumPages });
  exportImagesBtn.disabled = pdfSelected.size === 0;
}

imgSelectAllBtn.addEventListener('click', () => {
  pdfSelected = new Set(Array.from({ length: pdfNumPages }, (_, i) => i));
  imgPageGrid.querySelectorAll('.page-tile').forEach((tile) => {
    tile.classList.add('selected');
    tile.setAttribute('aria-checked', 'true');
  });
  updatePdfSelectionUI();
});
imgSelectNoneBtn.addEventListener('click', () => {
  pdfSelected = new Set();
  imgPageGrid.querySelectorAll('.page-tile').forEach((tile) => {
    tile.classList.remove('selected');
    tile.setAttribute('aria-checked', 'false');
  });
  updatePdfSelectionUI();
});

pdfDropzone.addEventListener('click', () => pdfFileInput.click());
pdfDropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    pdfFileInput.click();
  }
});
['dragenter', 'dragover'].forEach((evt) =>
  pdfDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    pdfDropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  pdfDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    pdfDropzone.classList.remove('dragover');
  })
);
pdfDropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) handlePdfFile(file);
});
pdfFileInput.addEventListener('change', () => {
  const file = pdfFileInput.files?.[0];
  if (file) handlePdfFile(file);
  pdfFileInput.value = '';
});

exportImagesBtn.addEventListener('click', async () => {
  if (!pdfDocRef || !pdfSelected.size) return;
  hideError();
  progressSection.hidden = false;
  exportImagesBtn.disabled = true;
  try {
    const sortedIndices = Array.from(pdfSelected).sort((a, b) => a - b);
    const entries = [];
    for (let n = 0; n < sortedIndices.length; n++) {
      const pageNum = sortedIndices[n] + 1;
      setProgress(Math.round(((n + 1) / sortedIndices.length) * 100), t('images.js_exporting_page', 'Exporting page {p} ({i}/{n})', { p: pageNum, i: n + 1, n: sortedIndices.length }));
      const page = await pdfDocRef.getPage(pageNum);
      const viewport = page.getViewport({ scale: Number(resolutionSelect.value) || 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      // JPEG has no alpha channel: without a white fill, transparent page
      // backgrounds would come out black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const asJpg = formatSelect.value === 'jpg';
      const blob = await new Promise((resolve) =>
        asJpg ? canvas.toBlob(resolve, 'image/jpeg', 0.92) : canvas.toBlob(resolve, 'image/png')
      );
      entries.push({
        name: `${pdfFileBaseName}-page-${pageNum}.${asJpg ? 'jpg' : 'png'}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    if (entries.length === 1) {
      downloadBlob(new Blob([entries[0].data]), entries[0].name);
    } else {
      setProgress(98, t('images.js_packing_zip', 'Packing ZIP…'));
      downloadBlob(new Blob([zipStore(entries)], { type: 'application/zip' }), `${pdfFileBaseName}-images.zip`);
    }
    setProgress(100, t('common.js_done', 'Done.'));
    setTimeout(() => {
      progressSection.hidden = true;
    }, 1200);
  } catch (err) {
    console.error(err);
    showError(err?.message || t('images.js_err_export', 'Something went wrong while exporting images.'));
    progressSection.hidden = true;
  } finally {
    exportImagesBtn.disabled = pdfSelected.size === 0;
  }
});

/* ---------- Images to PDF ---------- */

const imgDropzone = document.getElementById('imgDropzone');
const imgFileInput = document.getElementById('imgFileInput');
const imgIconTpl = document.getElementById('imgIconTpl');
const imgListSection = document.getElementById('imgListSection');
const imgListEl = document.getElementById('imgList');
const imgListCount = document.getElementById('imgListCount');
const imgClearBtn = document.getElementById('imgClearBtn');
const createPdfBtn = document.getElementById('createPdfBtn');

let imageItems = [];
let nextImgId = 0;

function formatBytes(bytes) {
  if (bytes < 1000) return t('images.js_size_b', '{n} B', { n: bytes });
  if (bytes < 1000 * 1000) return t('images.js_size_kb', '{n} KB', { n: (bytes / 1000).toFixed(1) });
  return t('images.js_size_mb', '{n} MB', { n: (bytes / (1000 * 1000)).toFixed(1) });
}

function renderImgList() {
  imgListEl.textContent = '';
  imgListSection.hidden = imageItems.length === 0;
  imgListCount.textContent = imageItems.length === 1
    ? t('images.js_image_count_one', '{n} image', { n: imageItems.length })
    : t('images.js_image_count_many', '{n} images', { n: imageItems.length });
  createPdfBtn.disabled = imageItems.length === 0;

  imageItems.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'file-item';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'file-item-icon';
    iconWrap.appendChild(imgIconTpl.content.cloneNode(true));
    li.appendChild(iconWrap);

    const info = document.createElement('div');
    info.className = 'file-item-info';
    const name = document.createElement('span');
    name.className = 'file-item-name';
    name.textContent = item.file.name;
    const meta = document.createElement('span');
    meta.className = 'file-item-meta';
    meta.textContent = formatBytes(item.file.size);
    info.appendChild(name);
    info.appendChild(meta);
    li.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'file-item-actions';

    const upBtn = document.createElement('button');
    upBtn.className = 'icon-btn';
    upBtn.type = 'button';
    upBtn.textContent = '↑';
    upBtn.setAttribute('aria-label', t('images.js_move_up', 'Move {name} up', { name: item.file.name }));
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => moveImg(item.id, -1));

    const downBtn = document.createElement('button');
    downBtn.className = 'icon-btn';
    downBtn.type = 'button';
    downBtn.textContent = '↓';
    downBtn.setAttribute('aria-label', t('images.js_move_down', 'Move {name} down', { name: item.file.name }));
    downBtn.disabled = index === imageItems.length - 1;
    downBtn.addEventListener('click', () => moveImg(item.id, 1));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'icon-btn icon-btn-danger';
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', t('images.js_remove', 'Remove {name}', { name: item.file.name }));
    removeBtn.addEventListener('click', () => removeImg(item.id));

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(removeBtn);
    li.appendChild(actions);

    imgListEl.appendChild(li);
  });
}

function moveImg(id, delta) {
  const index = imageItems.findIndex((it) => it.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= imageItems.length) return;
  [imageItems[index], imageItems[target]] = [imageItems[target], imageItems[index]];
  renderImgList();
}
function removeImg(id) {
  imageItems = imageItems.filter((it) => it.id !== id);
  renderImgList();
}

function addImageFiles(fileArray) {
  hideError();
  const images = fileArray.filter((f) => f.type.startsWith('image/'));
  if (images.length < fileArray.length) {
    showError(t('images.js_err_not_images', 'Some selected files were skipped because they are not images.'));
  }
  images.forEach((file) => imageItems.push({ id: nextImgId++, file }));
  renderImgList();
}

imgDropzone.addEventListener('click', () => imgFileInput.click());
imgDropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    imgFileInput.click();
  }
});
['dragenter', 'dragover'].forEach((evt) =>
  imgDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    imgDropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  imgDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    imgDropzone.classList.remove('dragover');
  })
);
imgDropzone.addEventListener('drop', (e) => {
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length) addImageFiles(files);
});
imgFileInput.addEventListener('change', () => {
  const files = Array.from(imgFileInput.files || []);
  if (files.length) addImageFiles(files);
  imgFileInput.value = '';
});
imgClearBtn.addEventListener('click', () => {
  imageItems = [];
  hideError();
  renderImgList();
});

async function loadImageBitmap(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error(t('images.js_err_decode', 'Could not decode "{name}"', { name: file.name })));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function toPngBytes(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

createPdfBtn.addEventListener('click', async () => {
  if (!imageItems.length) return;
  hideError();
  progressSection.hidden = false;
  createPdfBtn.disabled = true;
  try {
    setProgress(0, t('common.js_loading_pdflib', 'Loading pdf-lib…'));
    const pdfLib = await ensurePdfLib((msg) => setProgress(0, msg));
    const outDoc = await pdfLib.PDFDocument.create();
    const targetLongEdge = 842; // roughly A4's long edge, in points

    for (let i = 0; i < imageItems.length; i++) {
      const { file } = imageItems[i];
      setProgress(Math.round(((i + 1) / imageItems.length) * 90), t('images.js_adding_image', 'Adding {name} ({i}/{n})', { name: file.name, i: i + 1, n: imageItems.length }));
      const bitmap = await loadImageBitmap(file);

      let embedded;
      if (file.type === 'image/jpeg') {
        embedded = await outDoc.embedJpg(new Uint8Array(await file.arrayBuffer()));
      } else if (file.type === 'image/png') {
        embedded = await outDoc.embedPng(new Uint8Array(await file.arrayBuffer()));
      } else {
        embedded = await outDoc.embedPng(await toPngBytes(bitmap));
      }

      const scale = targetLongEdge / Math.max(embedded.width, embedded.height);
      const pageWidth = embedded.width * scale;
      const pageHeight = embedded.height * scale;
      const page = outDoc.addPage([pageWidth, pageHeight]);
      page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    }

    setProgress(95, t('common.js_saving', 'Saving…'));
    const outBytes = await outDoc.save();
    downloadBlob(new Blob([outBytes], { type: 'application/pdf' }), 'images.pdf');
    setProgress(100, t('common.js_done', 'Done.'));
    setTimeout(() => {
      progressSection.hidden = true;
    }, 1200);
  } catch (err) {
    console.error(err);
    showError(err?.message || t('images.js_err_create', 'Something went wrong while creating the PDF.'));
    progressSection.hidden = true;
  } finally {
    createPdfBtn.disabled = imageItems.length === 0;
  }
});
