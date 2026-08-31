'use strict';

import { t } from './i18n.js';
import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, renderPdfThumbnails,
  takeChainedFile, offerChain,
} from './tool-ui.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const pageGridSection = document.getElementById('pageGridSection');
const pageGrid = document.getElementById('pageGrid');
const hint = document.getElementById('deleteHint');
const applyBtn = document.getElementById('applyBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const selectNoneBtn = document.getElementById('selectNoneBtn');

let currentBytes = null;
let currentFileName = 'document';
let selected = new Set(); // pages marked for DELETE (0-based)
let numPages = 0;

function updateHint() {
  const del = selected.size;
  const keep = numPages - del;
  hint.textContent = t('delete-pages.js_hint', '{del} marked for deletion, {keep} will remain', { del, keep });
  applyBtn.disabled = keep === 0 || del === 0;
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
    const pdfjs = await ensurePdfJs((m) => setProgress(0, m));
    const loadingTask = pdfjs.getDocument({ data: parsed.bytes.slice(), ...PDFJS_ASSET_URLS });
    const pdfDoc = await loadingTask.promise;
    numPages = pdfDoc.numPages;
    selected = new Set();
    await renderPdfThumbnails(pdfDoc, pageGrid, (canvas, index) => {
      const tile = document.createElement('div');
      tile.className = 'page-tile';
      tile.dataset.pageIndex = String(index);
      tile.setAttribute('role', 'checkbox');
      tile.setAttribute('aria-checked', 'false');
      tile.setAttribute('tabindex', '0');
      tile.setAttribute('aria-label', t('delete-pages.js_tile_aria', 'Mark page {n} for deletion', { n: index + 1 }));
      tile.appendChild(canvas);
      const label = document.createElement('span');
      label.className = 'page-tile-label';
      label.textContent = t('delete-pages.js_page_label', 'Page {n}', { n: index + 1 });
      tile.appendChild(label);
      const toggle = () => {
        if (selected.has(index)) {
          selected.delete(index);
          tile.classList.remove('selected', 'deleted');
          tile.setAttribute('aria-checked', 'false');
        } else {
          selected.add(index);
          tile.classList.add('selected', 'deleted');
          tile.setAttribute('aria-checked', 'true');
        }
        updateHint();
      };
      tile.addEventListener('click', toggle);
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      return tile;
    }, (i, n) => setProgress(Math.round((i / n) * 100), t('common.js_rendering_page', 'Rendering page {i}/{n}', { i, n })));
    pageGridSection.hidden = false;
    updateHint();
    hideProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  }
}

applyBtn.addEventListener('click', async () => {
  if (!currentBytes || selected.size === 0) return;
  const keep = [];
  for (let i = 0; i < numPages; i++) if (!selected.has(i)) keep.push(i);
  if (!keep.length) {
    showError(t('delete-pages.js_err_none', 'Keep at least one page.'));
    return;
  }
  hideError();
  applyBtn.disabled = true;
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  try {
    const pdfLib = await ensurePdfLib((m) => setProgress(10, m));
    const src = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const out = await pdfLib.PDFDocument.create();
    setProgress(50, t('delete-pages.js_building', 'Building PDF…'));
    const pages = await out.copyPages(src, keep);
    pages.forEach((p) => out.addPage(p));
    setProgress(90, t('common.js_saving', 'Saving…'));
    const bytes = await out.save();
    const name = currentFileName + '-deleted-pages.pdf';
    downloadBytes(bytes, name);
    offerChain(bytes, name, [
      { slug: 'organize', label: 'Organize' },
      { slug: 'compress', label: 'Compress' },
      { slug: 'merge', label: 'Merge' },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err?.message || t('delete-pages.js_err', 'Could not delete pages from this PDF.'));
  } finally {
    applyBtn.disabled = false;
  }
});

selectAllBtn.addEventListener('click', () => {
  selected = new Set(Array.from({ length: numPages }, (_, i) => i));
  pageGrid.querySelectorAll('.page-tile').forEach((tile) => {
    tile.classList.add('selected', 'deleted');
    tile.setAttribute('aria-checked', 'true');
  });
  updateHint();
});
selectNoneBtn.addEventListener('click', () => {
  selected.clear();
  pageGrid.querySelectorAll('.page-tile').forEach((tile) => {
    tile.classList.remove('selected', 'deleted');
    tile.setAttribute('aria-checked', 'false');
  });
  updateHint();
});

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));
takeChainedFile().then((f) => { if (f) handleFile(f); });
