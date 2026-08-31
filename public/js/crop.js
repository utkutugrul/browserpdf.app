'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { t } from './i18n.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, offerChain, takeChainedFile, renderPdfPageToCanvas,
} from './tool-ui.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const panel = document.getElementById('optionsSection');
const applyBtn = document.getElementById('applyBtn');
const fileSummary = document.getElementById('fileSummary');
const previewCanvas = document.getElementById('previewCanvas');
const topIn = document.getElementById('cropTop');
const rightIn = document.getElementById('cropRight');
const bottomIn = document.getElementById('cropBottom');
const leftIn = document.getElementById('cropLeft');
const topVal = document.getElementById('cropTopVal');
const rightVal = document.getElementById('cropRightVal');
const bottomVal = document.getElementById('cropBottomVal');
const leftVal = document.getElementById('cropLeftVal');

let currentBytes = null;
let currentFileName = 'document';
let pageW = 612;
let pageH = 792;

function readInsets() {
  return {
    top: Number(topIn.value) || 0,
    right: Number(rightIn.value) || 0,
    bottom: Number(bottomIn.value) || 0,
    left: Number(leftIn.value) || 0,
  };
}

function updateLabels() {
  const i = readInsets();
  topVal.textContent = i.top + ' pt';
  rightVal.textContent = i.right + ' pt';
  bottomVal.textContent = i.bottom + ' pt';
  leftVal.textContent = i.left + ' pt';
  drawOverlay();
}

function drawOverlay() {
  if (!previewCanvas.width) return;
  const ctx = previewCanvas.getContext('2d');
  // redraw base image stored on canvas dataset via css background-ish - keep last frame
  // simple shade: full fade then redraw needs base. Better: store base ImageData
  if (!previewCanvas._base) return;
  ctx.putImageData(previewCanvas._base, 0, 0);
  const i = readInsets();
  const sx = previewCanvas.width / pageW;
  const sy = previewCanvas.height / pageH;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  // top
  ctx.fillRect(0, 0, previewCanvas.width, i.top * sy);
  // bottom
  ctx.fillRect(0, previewCanvas.height - i.bottom * sy, previewCanvas.width, i.bottom * sy);
  // left
  ctx.fillRect(0, i.top * sy, i.left * sx, previewCanvas.height - (i.top + i.bottom) * sy);
  // right
  ctx.fillRect(previewCanvas.width - i.right * sx, i.top * sy, i.right * sx, previewCanvas.height - (i.top + i.bottom) * sy);
  ctx.strokeStyle = '#5b5bd6';
  ctx.lineWidth = 2;
  ctx.strokeRect(
    i.left * sx,
    i.top * sy,
    previewCanvas.width - (i.left + i.right) * sx,
    previewCanvas.height - (i.top + i.bottom) * sy
  );
}

async function handleFile(file) {
  hideError();
  panel.hidden = true;
  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;
  showProgress(t('common.js_loading_pdf', 'Loading PDF…'));
  try {
    const pdfjs = await ensurePdfJs((m) => setProgress(10, m));
    const loadingTask = pdfjs.getDocument({ data: parsed.bytes.slice(), ...PDFJS_ASSET_URLS });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    pageW = vp1.width;
    pageH = vp1.height;
    topIn.max = Math.floor(pageH / 2 - 10);
    bottomIn.max = Math.floor(pageH / 2 - 10);
    leftIn.max = Math.floor(pageW / 2 - 10);
    rightIn.max = Math.floor(pageW / 2 - 10);
    await renderPdfPageToCanvas(pdfjs, parsed.bytes, 1, previewCanvas, 480, PDFJS_ASSET_URLS);
    previewCanvas._base = previewCanvas.getContext('2d').getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    fileSummary.textContent = `${file.name} · ${pageW.toFixed(0)}×${pageH.toFixed(0)} pt`;
    panel.hidden = false;
    updateLabels();
    hideProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  }
}

applyBtn.addEventListener('click', async () => {
  if (!currentBytes) return;
  hideError();
  applyBtn.disabled = true;
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  try {
    const pdfLib = await ensurePdfLib((m) => setProgress(20, m));
    const doc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const i = readInsets();
    setProgress(60, t('crop.js_cropping', 'Cropping pages…'));
    doc.getPages().forEach((page) => {
      // The insets were chosen against the rotation-aware preview (pdf.js swaps
      // width/height for a 90/270 page rotation, matching what the user saw), but
      // pdf-lib's box here is always in the page's raw, unrotated coordinate
      // space. Compute the crop in visual space first, then map it back.
      const { width: rawW, height: rawH } = page.getSize();
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;
      const swapped = rotation === 90 || rotation === 270;
      const visW = swapped ? rawH : rawW;
      const visH = swapped ? rawW : rawH;
      const visLeft = Math.min(i.left, visW / 2 - 5);
      const visRight = Math.min(i.right, visW / 2 - 5);
      const visTop = Math.min(i.top, visH / 2 - 5);
      const visBottom = Math.min(i.bottom, visH / 2 - 5);
      const visX = visLeft;
      const visY = visBottom;
      const visCropW = Math.max(10, visW - visLeft - visRight);
      const visCropH = Math.max(10, visH - visTop - visBottom);

      let x, y, w, h;
      if (rotation === 90) {
        x = rawW - visY - visCropH; y = visX; w = visCropH; h = visCropW;
      } else if (rotation === 180) {
        x = rawW - visX - visCropW; y = rawH - visY - visCropH; w = visCropW; h = visCropH;
      } else if (rotation === 270) {
        x = visY; y = rawH - visX - visCropW; w = visCropH; h = visCropW;
      } else {
        x = visX; y = visY; w = visCropW; h = visCropH;
      }
      page.setCropBox(x, y, w, h);
      page.setMediaBox(x, y, w, h);
    });
    setProgress(90, t('common.js_saving', 'Saving…'));
    const out = await doc.save();
    const name = currentFileName + '-cropped.pdf';
    downloadBytes(out, name);
    offerChain(out, name, [
      { slug: 'compress', label: 'Compress' },
      { slug: 'organize', label: 'Organize' },
      { slug: 'delete-pages', label: 'Delete pages' },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err?.message || t('crop.js_err', 'Could not crop this PDF.'));
  } finally {
    applyBtn.disabled = false;
  }
});

[topIn, rightIn, bottomIn, leftIn].forEach((el) => el.addEventListener('input', updateLabels));
wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));
takeChainedFile().then((f) => { if (f) handleFile(f); });
