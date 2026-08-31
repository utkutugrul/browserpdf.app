'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import {
  showError, hideError, showProgress, setProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, takeChainedFile, offerChain,
} from './tool-ui.js';
import { t } from './i18n.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const highlightSection = document.getElementById('highlightSection');
const colorSelect = document.getElementById('colorSelect');
const opacitySlider = document.getElementById('opacitySlider');
const opacityValue = document.getElementById('opacityValue');
const pageGrid = document.getElementById('pageGrid');
const placementSection = document.getElementById('placementSection');
const placementWrap = document.getElementById('placementWrap');
const placementCanvas = document.getElementById('placementCanvas');
const placementHint = document.getElementById('placementHint');
const highlightsList = document.getElementById('highlightsList');
const highlightCount = document.getElementById('highlightCount');
const clearAllBtn = document.getElementById('clearAllBtn');
const applyHint = document.getElementById('applyHint');
const applyBtn = document.getElementById('applyBtn');

placementCanvas.style.touchAction = 'none';

const COLORS = {
  yellow: [1, 0.92, 0.23],
  green: [0.3, 0.85, 0.3],
  blue: [0.3, 0.6, 1],
  pink: [1, 0.4, 0.6],
  orange: [1, 0.65, 0.2],
};

let currentBytes = null;
let currentFileName = 'document';
let pdfLibRef = null;
let currentDoc = null;
let pdfJsDocRef = null;
let numPages = 0;
let selectedPageIndex = null;
let placementScale = 1;
let placementPageHeightPt = 0;
let placementPageWidthPt = 0;
let highlights = [];
let placementBase = null;
let drawing = false;
let dragStart = null;
let dragCurrent = null;
let highlightIdCounter = 0;

function getCurrentColor() {
  return COLORS[colorSelect.value] || COLORS.yellow;
}
function getCurrentOpacity() {
  return Number(opacitySlider.value) / 100;
}
function cssColor(color, opacity) {
  const [r, g, b] = color;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${opacity})`;
}

function updateApplyState() {
  const hasHighlights = highlights.length > 0;
  applyBtn.disabled = !hasHighlights;
  clearAllBtn.disabled = !hasHighlights;
  highlightCount.textContent = t('highlight.js_count', '{n} drawn', { n: highlights.length });
  if (selectedPageIndex == null) {
    placementHint.textContent = t('highlight.js_hint_pick_page', 'Pick a page above to start drawing.');
  } else if (!hasHighlights) {
    placementHint.textContent = t('highlight.js_hint_drag', 'Click and drag on the page to draw a highlight over the text.');
  } else {
    placementHint.textContent = t('highlight.js_hint_ready', 'Ready. Draw more highlights or click "Add highlights & download".');
  }
}

function getCanvasPoint(e) {
  const rect = placementCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (placementCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (placementCanvas.height / rect.height),
  };
}

function highlightToCanvasPx(h) {
  return {
    x: h.x * placementScale,
    y: placementCanvas.height - (h.y + h.height) * placementScale,
    width: h.width * placementScale,
    height: h.height * placementScale,
  };
}

function drawHighlightOnCanvas(ctx, h) {
  const c = highlightToCanvasPx(h);
  ctx.fillStyle = cssColor(getCurrentColor(), getCurrentOpacity());
  ctx.fillRect(c.x, c.y, c.width, c.height);
}

function redrawPlacement(previewHighlight) {
  const ctx = placementCanvas.getContext('2d');
  if (!placementBase) return;
  ctx.putImageData(placementBase, 0, 0);
  for (const h of highlights) {
    if (h.pageIndex !== selectedPageIndex) continue;
    drawHighlightOnCanvas(ctx, h);
  }
  if (previewHighlight) {
    drawHighlightOnCanvas(ctx, previewHighlight);
  }
}

async function handleFile(file) {
  hideError();
  highlightSection.hidden = true;
  placementSection.hidden = true;
  pageGrid.textContent = '';
  highlightsList.textContent = '';
  selectedPageIndex = null;
  placementBase = null;
  highlights = [];
  drawing = false;
  dragStart = null;
  dragCurrent = null;

  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;

  showProgress(t('common.js_loading_pdf', 'Loading PDF…'));
  try {
    pdfLibRef = await ensurePdfLib((msg) => setProgress(0, msg));
    currentDoc = await pdfLibRef.PDFDocument.load(currentBytes, {
      ignoreEncryption: true,
    });

    const pdfjs = await ensurePdfJs((msg) => setProgress(0, msg));
    const loadingTask = pdfjs.getDocument({
      data: currentBytes.slice(),
      ...PDFJS_ASSET_URLS,
    });
    pdfJsDocRef = await loadingTask.promise;
    numPages = pdfJsDocRef.numPages;
    await renderPageGrid();

    highlightSection.hidden = false;
    updateApplyState();
    renderHighlightsList();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  } finally {
    hideProgress();
  }
}

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));

async function renderPageGrid() {
  pageGrid.textContent = '';
  for (let i = 1; i <= numPages; i++) {
    const page = await pdfJsDocRef.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = 150 / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    const tile = document.createElement('div');
    tile.className = 'page-tile';
    tile.dataset.pageIndex = String(i - 1);
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');
    tile.appendChild(canvas);
    const label = document.createElement('span');
    label.className = 'page-tile-label';
    label.textContent = t('highlight.js_page_label', 'Page {n}', { n: i });
    tile.appendChild(label);

    const index = i - 1;
    tile.addEventListener('click', () => selectPage(index));
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectPage(index);
      }
    });
    pageGrid.appendChild(tile);
  }
}

async function selectPage(index) {
  selectedPageIndex = index;
  pageGrid.querySelectorAll('.page-tile').forEach((tile) => {
    tile.classList.toggle('selected', Number(tile.dataset.pageIndex) === index);
  });

  const page = await pdfJsDocRef.getPage(index + 1);
  const baseViewport = page.getViewport({ scale: 1 });
  placementScale = Math.min(560 / baseViewport.width, 1.8);
  const viewport = page.getViewport({ scale: placementScale });
  placementCanvas.width = viewport.width;
  placementCanvas.height = viewport.height;
  await page.render({
    canvasContext: placementCanvas.getContext('2d'),
    viewport,
  }).promise;
  placementPageHeightPt = baseViewport.height;
  placementPageWidthPt = baseViewport.width;
  placementBase = placementCanvas.getContext('2d').getImageData(0, 0, placementCanvas.width, placementCanvas.height);

  placementSection.hidden = false;
  redrawPlacement();
  updateApplyState();
  renderHighlightsList();
}

function canvasToPdfHighlight(start, end) {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  return {
    x: left / placementScale,
    y: placementPageHeightPt - bottom / placementScale,
    width: (right - left) / placementScale,
    height: (bottom - top) / placementScale,
  };
}

placementCanvas.addEventListener('pointerdown', (e) => {
  if (selectedPageIndex == null) return;
  drawing = true;
  dragStart = getCanvasPoint(e);
  dragCurrent = { ...dragStart };
  placementCanvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});

placementCanvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  dragCurrent = getCanvasPoint(e);
  const previewHighlight = {
    pageIndex: selectedPageIndex,
    ...canvasToPdfHighlight(dragStart, dragCurrent),
  };
  redrawPlacement(previewHighlight);
});

placementCanvas.addEventListener('pointerup', (e) => {
  if (!drawing) return;
  drawing = false;
  try { placementCanvas.releasePointerCapture(e.pointerId); } catch {}
  dragCurrent = getCanvasPoint(e);
  const rect = canvasToPdfHighlight(dragStart, dragCurrent);
  const minCanvasPx = 4;
  const minPt = minCanvasPx / placementScale;
  if (rect.width >= minPt && rect.height >= minPt) {
    highlightIdCounter += 1;
    highlights.push({
      id: highlightIdCounter,
      pageIndex: selectedPageIndex,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }
  dragStart = null;
  dragCurrent = null;
  redrawPlacement();
  renderHighlightsList();
  updateApplyState();
});

placementCanvas.addEventListener('pointercancel', () => {
  drawing = false;
  dragStart = null;
  dragCurrent = null;
  redrawPlacement();
});

function renderHighlightsList() {
  highlightsList.textContent = '';
  if (!highlights.length) {
    const empty = document.createElement('div');
    empty.className = 'file-list-count';
    empty.textContent = t('highlight.js_empty', 'No highlights drawn yet. Drag on the page above to add one.');
    highlightsList.appendChild(empty);
    return;
  }
  let m = 0;
  for (const h of highlights) {
    m += 1;
    const item = document.createElement('div');
    item.className = 'file-item';

    const info = document.createElement('div');
    info.className = 'file-item-info';
    const name = document.createElement('span');
    name.className = 'file-item-name';
    name.textContent = t('highlight.js_item_name', 'Page {page}, highlight {n}', { page: h.pageIndex + 1, n: m });
    const meta = document.createElement('span');
    meta.className = 'file-item-meta';
    meta.textContent = t('highlight.js_item_meta', '{x}, {y} ({w} x {h} pt)', {
      x: Math.round(h.x),
      y: Math.round(h.y),
      w: Math.round(h.width),
      h: Math.round(h.height),
    });
    info.appendChild(name);
    info.appendChild(meta);
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'file-item-actions';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn icon-btn-danger';
    removeBtn.setAttribute('aria-label', t('highlight.js_remove_aria', 'Remove highlight {n}', { n: m }));
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    removeBtn.addEventListener('click', () => removeHighlight(h.id));
    actions.appendChild(removeBtn);
    item.appendChild(actions);

    highlightsList.appendChild(item);
  }
}

function removeHighlight(id) {
  highlights = highlights.filter((h) => h.id !== id);
  redrawPlacement();
  renderHighlightsList();
  updateApplyState();
}

clearAllBtn.addEventListener('click', () => {
  if (!highlights.length) return;
  highlights = [];
  redrawPlacement();
  renderHighlightsList();
  updateApplyState();
});

colorSelect.addEventListener('change', () => {
  redrawPlacement();
  updateApplyState();
});
opacitySlider.addEventListener('input', () => {
  opacityValue.textContent = t('highlight.js_opacity_pct', '{n}%', { n: opacitySlider.value });
  redrawPlacement();
  updateApplyState();
});

applyBtn.addEventListener('click', async () => {
  if (!currentDoc || !currentBytes) return;
  if (!highlights.length) {
    showError(t('highlight.js_err_none', 'Draw at least one highlight on a page first.'));
    return;
  }
  hideError();
  showProgress(t('highlight.js_applying', 'Burning highlights into the PDF…'));
  applyBtn.disabled = true;
  try {
    const pdfLib = pdfLibRef || (await ensurePdfLib((msg) => setProgress(0, msg)));
    const [r, g, b] = getCurrentColor();
    const color = pdfLib.rgb(r, g, b);
    const opacity = getCurrentOpacity();
    const pages = currentDoc.getPages();
    const total = highlights.length;
    highlights.forEach((h, i) => {
      setProgress(Math.round(((i + 1) / total) * 80), t('highlight.js_drawing_n', 'Drawing highlight {i}/{n}', { i: i + 1, n: total }));
      const page = pages[h.pageIndex];
      if (!page) return;
      page.drawRectangle({
        x: h.x,
        y: h.y,
        width: h.width,
        height: h.height,
        color,
        opacity,
      });
    });

    setProgress(90, t('common.js_saving', 'Saving…'));
    const outBytes = await currentDoc.save();
    const outName = `${currentFileName}-highlighted.pdf`;
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'compress', label: t('highlight.js_chain_compress', 'Compress') },
      { slug: 'watermark', label: t('highlight.js_chain_watermark', 'Add Watermark') },
    ]);
    finishProgress();
    currentDoc = await pdfLib.PDFDocument.load(currentBytes, {
      ignoreEncryption: true,
    });
  } catch (err) {
    console.error(err);
    showError(err?.message || t('highlight.js_err_save', 'Something went wrong while adding highlights.'));
    hideProgress();
  } finally {
    applyBtn.disabled = false;
    updateApplyState();
  }
});

opacityValue.textContent = t('highlight.js_opacity_pct', '{n}%', { n: opacitySlider.value });
renderHighlightsList();
updateApplyState();

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
