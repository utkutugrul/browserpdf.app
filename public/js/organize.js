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
const organizeHint = document.getElementById('organizeHint');
const applyBtn = document.getElementById('applyBtn');

let currentBytes = null;
let currentFileName = 'document';
// Working order of pages. Each entry: { srcIndex, rotation, deleted, tile }
let items = [];
let dragItem = null;

function updateHint() {
  const kept = items.filter((it) => !it.deleted).length;
  const rotated = items.filter((it) => !it.deleted && it.rotation !== 0).length;
  const parts = [t('organize.js_hint_kept', '{kept} of {total} pages kept', { kept, total: items.length })];
  if (rotated) parts.push(t('organize.js_hint_rotated', '{rotated} rotated', { rotated }));
  organizeHint.textContent = parts.join(', ') + '.';
  applyBtn.disabled = kept === 0;
}

function refreshTile(item, position) {
  const canvas = item.tile.querySelector('canvas');
  const scale = item.rotation % 180 === 0 ? 1 : 0.72;
  canvas.style.setProperty('--tile-rotate', `${item.rotation}deg`);
  canvas.style.setProperty('--tile-scale', String(scale));
  item.tile.classList.toggle('deleted', item.deleted);
  item.tile.querySelector('.page-tile-label').textContent = item.deleted
    ? t('organize.js_tile_label_removed', '{pos} (was {src}) – removed', { pos: position + 1, src: item.srcIndex + 1 })
    : t('organize.js_tile_label', '{pos} (was {src})', { pos: position + 1, src: item.srcIndex + 1 });
  const delBtn = item.tile.querySelector('[data-action="delete"]');
  delBtn.textContent = item.deleted ? '+' : '×';
  delBtn.setAttribute('aria-label', item.deleted
    ? t('organize.js_restore_page', 'Restore page {n}', { n: item.srcIndex + 1 })
    : t('organize.js_remove_page', 'Remove page {n}', { n: item.srcIndex + 1 }));
}

function reflow() {
  items.forEach((item, position) => {
    pageGrid.appendChild(item.tile); // re-append in array order
    const [left, , , right] = item.tile.querySelectorAll('.icon-btn');
    left.disabled = position === 0;
    right.disabled = position === items.length - 1;
    refreshTile(item, position);
  });
  updateHint();
}

function moveItem(item, delta) {
  const index = items.indexOf(item);
  const target = index + delta;
  if (target < 0 || target >= items.length) return;
  [items[index], items[target]] = [items[target], items[index]];
  reflow();
}

function makeActionBtn(symbol, label, onClick, extraClass = '', action = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `icon-btn ${extraClass}`.trim();
  btn.textContent = symbol;
  btn.setAttribute('aria-label', label);
  if (action) btn.dataset.action = action;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
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
    items = [];

    await renderPdfThumbnails(pdfDoc, pageGrid, (canvas, index) => {
      const tile = document.createElement('div');
      tile.className = 'page-tile page-tile-organize';
      tile.draggable = true;
      tile.appendChild(canvas);

      const label = document.createElement('span');
      label.className = 'page-tile-label';
      tile.appendChild(label);

      const item = { srcIndex: index, rotation: 0, deleted: false, tile };

      const actions = document.createElement('div');
      actions.className = 'tile-actions';
      actions.appendChild(makeActionBtn('←', t('organize.js_move_earlier', 'Move page {n} earlier', { n: index + 1 }), () => moveItem(item, -1)));
      actions.appendChild(makeActionBtn('⟳', t('organize.js_rotate_page', 'Rotate page {n}', { n: index + 1 }), () => {
        item.rotation = (item.rotation + 90) % 360;
        reflow();
      }));
      actions.appendChild(makeActionBtn('×', t('organize.js_remove_page', 'Remove page {n}', { n: index + 1 }), () => {
        item.deleted = !item.deleted;
        reflow();
      }, 'icon-btn-danger', 'delete'));
      actions.appendChild(makeActionBtn('→', t('organize.js_move_later', 'Move page {n} later', { n: index + 1 }), () => moveItem(item, 1)));
      tile.appendChild(actions);

      tile.addEventListener('dragstart', (e) => {
        dragItem = item;
        tile.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      tile.addEventListener('dragend', () => {
        dragItem = null;
        pageGrid.querySelectorAll('.dragging, .drag-over').forEach((el) =>
          el.classList.remove('dragging', 'drag-over'));
      });
      tile.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (dragItem && dragItem !== item) tile.classList.add('drag-over');
      });
      tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
      tile.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!dragItem || dragItem === item) return;
        const from = items.indexOf(dragItem);
        const to = items.indexOf(item);
        items.splice(from, 1);
        items.splice(to, 0, dragItem);
        reflow();
      });

      items.push(item);
      return tile;
    }, (i, n) => setProgress(Math.round((i / n) * 100), t('common.js_rendering_page', 'Rendering page {i}/{n}', { i, n })));

    pageGridSection.hidden = false;
    reflow();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  } finally {
    hideProgress();
  }
}

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));

applyBtn.addEventListener('click', async () => {
  const kept = items.filter((it) => !it.deleted);
  if (!currentBytes || !kept.length) return;
  hideError();
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  applyBtn.disabled = true;
  try {
    const pdfLib = await ensurePdfLib((msg) => setProgress(0, msg));
    const srcDoc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const outDoc = await pdfLib.PDFDocument.create();
    setProgress(40, t('organize.js_rebuilding', 'Rebuilding document…'));
    const copied = await outDoc.copyPages(srcDoc, kept.map((it) => it.srcIndex));
    copied.forEach((page, i) => {
      if (kept[i].rotation !== 0) {
        const existing = page.getRotation().angle;
        page.setRotation(pdfLib.degrees(((existing + kept[i].rotation) % 360 + 360) % 360));
      }
      outDoc.addPage(page);
    });
    setProgress(85, t('common.js_saving', 'Saving…'));
    const outBytes = await outDoc.save();
    const outName = `${currentFileName}-organized.pdf`;
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'compress', label: 'Compress' },
      { slug: 'page-numbers', label: 'Add Page Numbers' },
      { slug: 'watermark', label: 'Add Watermark' },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('organize.js_err_rebuild', 'Something went wrong while rebuilding this PDF.'));
    hideProgress();
  } finally {
    applyBtn.disabled = items.filter((it) => !it.deleted).length === 0;
  }
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
