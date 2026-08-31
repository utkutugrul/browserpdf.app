'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { t } from './i18n.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, renderPdfThumbnails,
  takeChainedFile, offerChain,
} from './tool-ui.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const pageGridSection = document.getElementById('pageGridSection');
const pageGrid = document.getElementById('pageGrid');
const rotateAllLeftBtn = document.getElementById('rotateAllLeftBtn');
const rotateAllRightBtn = document.getElementById('rotateAllRightBtn');
const resetBtn = document.getElementById('resetBtn');
const applyBtn = document.getElementById('applyBtn');
const rotateHint = document.getElementById('rotateHint');

let currentBytes = null;
let currentFileName = 'document';
let rotations = []; // extra rotation per page, degrees clockwise (0/90/180/270)

function applyTileRotation(index) {
  const canvas = pageGrid.querySelector(`[data-page-index="${index}"] canvas`);
  if (!canvas) return;
  const deg = rotations[index];
  // Sideways pages get scaled down so the rotated canvas stays inside its tile.
  const scale = deg % 180 === 0 ? 1 : 0.72;
  canvas.style.setProperty('--tile-rotate', `${deg}deg`);
  canvas.style.setProperty('--tile-scale', String(scale));
}

function rotatePage(index, delta) {
  rotations[index] = ((rotations[index] + delta) % 360 + 360) % 360;
  applyTileRotation(index);
  updateHint();
}

function updateHint() {
  const changed = rotations.filter((r) => r !== 0).length;
  rotateHint.textContent = changed
    ? (changed === 1
        ? t('rotate.js_hint_rotated_one', '1 page will be rotated.')
        : t('rotate.js_hint_rotated_many', '{n} pages will be rotated.', { n: changed }))
    : t('rotate.js_hint_click', 'Click a page to rotate it 90°. Use the buttons above for all pages at once.');
  applyBtn.disabled = false;
}

async function handleFile(file) {
  hideError();
  pageGridSection.hidden = true;
  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;

  showProgress(t('common.js_loading_pdf', 'Loading PDF…'));
  try {
    const pdfjs = await ensurePdfJs((msg) => setProgress(0, msg));
    const loadingTask = pdfjs.getDocument({ data: parsed.bytes.slice(), ...PDFJS_ASSET_URLS });
    const pdfDoc = await loadingTask.promise;
    rotations = new Array(pdfDoc.numPages).fill(0);

    await renderPdfThumbnails(pdfDoc, pageGrid, (canvas, index) => {
      const tile = document.createElement('div');
      tile.className = 'page-tile page-tile-rotate';
      tile.dataset.pageIndex = String(index);
      tile.setAttribute('role', 'button');
      tile.setAttribute('tabindex', '0');
      tile.setAttribute('aria-label', t('rotate.js_tile_aria', 'Rotate page {n} by 90 degrees', { n: index + 1 }));
      tile.appendChild(canvas);
      const label = document.createElement('span');
      label.className = 'page-tile-label';
      label.textContent = t('rotate.js_page_label', 'Page {n}', { n: index + 1 });
      tile.appendChild(label);
      tile.addEventListener('click', () => rotatePage(index, 90));
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          rotatePage(index, 90);
        }
      });
      return tile;
    }, (i, n) => setProgress(Math.round((i / n) * 100), t('common.js_rendering_page', 'Rendering page {i}/{n}', { i, n })));

    pageGridSection.hidden = false;
    updateHint();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  } finally {
    hideProgress();
  }
}

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));

rotateAllLeftBtn.addEventListener('click', () => {
  rotations.forEach((_, i) => rotatePage(i, -90));
});
rotateAllRightBtn.addEventListener('click', () => {
  rotations.forEach((_, i) => rotatePage(i, 90));
});
resetBtn.addEventListener('click', () => {
  rotations.forEach((_, i) => {
    rotations[i] = 0;
    applyTileRotation(i);
  });
  updateHint();
});

applyBtn.addEventListener('click', async () => {
  if (!currentBytes) return;
  hideError();
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  applyBtn.disabled = true;
  try {
    const pdfLib = await ensurePdfLib((msg) => setProgress(0, msg));
    const doc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    setProgress(50, t('rotate.js_rotating', 'Rotating pages…'));
    doc.getPages().forEach((page, i) => {
      const extra = rotations[i] || 0;
      if (extra !== 0) {
        const existing = page.getRotation().angle;
        page.setRotation(pdfLib.degrees(((existing + extra) % 360 + 360) % 360));
      }
    });
    setProgress(85, t('common.js_saving', 'Saving…'));
    const outBytes = await doc.save();
    const outName = `${currentFileName}-rotated.pdf`;
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'organize', label: t('rotate.js_chain_organize', 'Organize') },
      { slug: 'compress', label: t('rotate.js_chain_compress', 'Compress') },
      { slug: 'ocr-pdf', label: t('rotate.js_chain_ocr', 'Make Searchable (OCR)') },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('rotate.js_err_rotate', 'Something went wrong while rotating this PDF.'));
    hideProgress();
  } finally {
    applyBtn.disabled = false;
  }
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
