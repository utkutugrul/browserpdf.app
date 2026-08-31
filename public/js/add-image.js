'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, formatBytes,
  renderPdfPageToCanvas, takeChainedFile, offerChain,
} from './tool-ui.js';
import { t } from './i18n.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const optionsSection = document.getElementById('optionsSection');
const fileSummary = document.getElementById('fileSummary');
const imageChooseBtn = document.getElementById('imageChooseBtn');
const imageInput = document.getElementById('imageInput');
const imageName = document.getElementById('imageName');
const imageThumb = document.getElementById('imageThumb');
const positionSelect = document.getElementById('positionSelect');
const pageSelect = document.getElementById('pageSelect');
const sizeSlider = document.getElementById('sizeSlider');
const sizeValue = document.getElementById('sizeValue');
const opacitySlider = document.getElementById('opacitySlider');
const opacityValue = document.getElementById('opacityValue');
const applyBtn = document.getElementById('applyBtn');
const previewPanel = document.getElementById('previewPanel');
const previewCanvas = document.getElementById('previewCanvas');

const MARGIN = 28;

let currentBytes = null;
let currentFileName = 'document';
let srcPageCount = 0;
let imageBytes = null;
let imageKind = null;
let imageThumbUrl = null;
let previewDebounce = null;
let previewToken = 0;

function detectImageKind(bytes) {
  if (bytes.length >= 4 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return 'jpg';
  }
  return null;
}

async function handleFile(file) {
  hideError();
  optionsSection.hidden = true;
  previewPanel.hidden = true;
  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;
  fileSummary.textContent = `${file.name} (${formatBytes(file.size)})`;
  await populatePageSelect();
  optionsSection.hidden = false;
  schedulePreview();
}

async function populatePageSelect() {
  const prev = pageSelect.value;
  while (pageSelect.options.length > 1) pageSelect.remove(1);
  let count = 0;
  try {
    const pdfLib = await ensurePdfLib(() => {});
    const doc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    count = doc.getPageCount();
  } catch (err) {
    console.warn('Could not read page count for page select:', err);
  }
  srcPageCount = count;
  for (let i = 1; i <= count; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = t('add-image.js_page_n', 'Page {n}', { n: i });
    pageSelect.appendChild(opt);
  }
  if (prev === 'all' || !prev) {
    pageSelect.value = 'all';
  } else if (pageSelect.querySelector(`option[value="${prev}"]`)) {
    pageSelect.value = prev;
  }
}

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));

imageChooseBtn.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', () => {
  const file = imageInput.files && imageInput.files[0];
  if (file) handleImageFile(file);
  imageInput.value = '';
});

async function handleImageFile(file) {
  hideError();
  const looksLikeImage = file.type === 'image/png' || file.type === 'image/jpeg' ||
    /\.png$/i.test(file.name) || /\.jpe?g$/i.test(file.name);
  if (!looksLikeImage) {
    showError(t('add-image.js_err_not_image', 'Please select a PNG or JPEG image.'));
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectImageKind(bytes);
  if (!kind) {
    showError(t('add-image.js_err_image_magic', 'This file does not look like a valid PNG or JPEG image.'));
    return;
  }
  imageBytes = bytes;
  imageKind = kind;
  imageName.textContent = `${file.name} (${formatBytes(file.size)})`;
  if (imageThumbUrl) URL.revokeObjectURL(imageThumbUrl);
  imageThumbUrl = URL.createObjectURL(file);
  imageThumb.src = imageThumbUrl;
  imageThumb.alt = file.name;
  imageThumb.hidden = false;
  schedulePreview();
}

function positionFor(value, pw, ph, w, h) {
  switch (value) {
    case 'top-left': return { x: MARGIN, y: ph - h - MARGIN };
    case 'top-right': return { x: pw - w - MARGIN, y: ph - h - MARGIN };
    case 'bottom-left': return { x: MARGIN, y: MARGIN };
    case 'bottom-right': return { x: pw - w - MARGIN, y: MARGIN };
    case 'top-center': return { x: (pw - w) / 2, y: ph - h - MARGIN };
    case 'bottom-center': return { x: (pw - w) / 2, y: MARGIN };
    case 'center':
    default: return { x: (pw - w) / 2, y: (ph - h) / 2 };
  }
}

function drawImageOnPage(page, pdfLib, embedded) {
  const sizePct = Number(sizeSlider.value) / 100;
  const opacity = Number(opacitySlider.value) / 100;
  const { width: pw, height: ph } = page.getSize();
  let baseW = embedded.width;
  let baseH = embedded.height;
  if (baseW > pw || baseH > ph) {
    const s = Math.min(pw / baseW, ph / baseH);
    baseW *= s;
    baseH *= s;
  }
  const w = baseW * sizePct;
  const h = baseH * sizePct;
  const { x, y } = positionFor(positionSelect.value, pw, ph, w, h);
  page.drawImage(embedded, { x, y, width: w, height: h, opacity });
}

async function embedImage(doc) {
  if (imageKind === 'jpg') return doc.embedJpg(imageBytes);
  return doc.embedPng(imageBytes);
}

async function renderPreview() {
  if (!currentBytes) return;
  if (!imageBytes) {
    previewPanel.hidden = true;
    return;
  }
  const myToken = ++previewToken;
  try {
    const pdfLib = await ensurePdfLib(() => {});
    const srcDoc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    srcPageCount = srcDoc.getPageCount();
    const previewDoc = await pdfLib.PDFDocument.create();
    const [firstPage] = await previewDoc.copyPages(srcDoc, [0]);
    previewDoc.addPage(firstPage);
    const embedded = await embedImage(previewDoc);
    drawImageOnPage(previewDoc.getPages()[0], pdfLib, embedded);
    const bytes = await previewDoc.save();
    if (myToken !== previewToken) return;
    const pdfjs = await ensurePdfJs(() => {});
    await renderPdfPageToCanvas(pdfjs, bytes, 1, previewCanvas, 340, PDFJS_ASSET_URLS);
    if (myToken === previewToken) previewPanel.hidden = false;
  } catch (err) {
    console.warn('Preview failed:', err);
  }
}

function schedulePreview() {
  clearTimeout(previewDebounce);
  previewDebounce = setTimeout(renderPreview, 350);
}

positionSelect.addEventListener('change', schedulePreview);
pageSelect.addEventListener('change', schedulePreview);
sizeSlider.addEventListener('input', () => {
  sizeValue.textContent = t('add-image.js_size_pct', '{n}%', { n: sizeSlider.value });
  schedulePreview();
});
opacitySlider.addEventListener('input', () => {
  opacityValue.textContent = t('add-image.js_opacity_pct', '{n}%', { n: opacitySlider.value });
  schedulePreview();
});

applyBtn.addEventListener('click', async () => {
  if (!currentBytes) return;
  if (!imageBytes) {
    showError(t('add-image.js_err_no_image', 'Choose an image to stamp first.'));
    return;
  }
  hideError();
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  applyBtn.disabled = true;
  try {
    const pdfLib = await ensurePdfLib((msg) => setProgress(0, msg));
    const doc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const embedded = await embedImage(doc);
    const pages = doc.getPages();
    srcPageCount = pages.length;
    const target = pageSelect.value === 'all'
      ? pages.map((_, i) => i)
      : [Math.min(Math.max(parseInt(pageSelect.value, 10) || 1, 1), pages.length) - 1];
    target.forEach((idx, n) => {
      setProgress(Math.round(((n + 1) / target.length) * 90), t('add-image.js_stamping_page', 'Stamping page {i}/{n}', { i: idx + 1, n: target.length }));
      drawImageOnPage(pages[idx], pdfLib, embedded);
    });
    setProgress(95, t('common.js_saving', 'Saving…'));
    const outBytes = await doc.save();
    const outName = `${currentFileName}-with-image.pdf`;
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'compress', label: t('add-image.js_chain_compress', 'Compress') },
      { slug: 'watermark', label: t('add-image.js_chain_watermark', 'Add Watermark') },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('add-image.js_err_generic', 'Something went wrong while adding the image.'));
    hideProgress();
  } finally {
    applyBtn.disabled = false;
  }
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
