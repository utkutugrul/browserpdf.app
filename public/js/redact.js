'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import {
  showError, hideError, showProgress, setProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, takeChainedFile, offerChain,
} from './tool-ui.js';
import { t } from './i18n.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const redactSection = document.getElementById('redactSection');
const pageGrid = document.getElementById('pageGrid');
const placementSection = document.getElementById('placementSection');
const placementWrap = document.getElementById('placementWrap');
const placementCanvas = document.getElementById('placementCanvas');
const placementHint = document.getElementById('placementHint');
const rectList = document.getElementById('rectList');
const rectCount = document.getElementById('rectCount');
const clearAllBtn = document.getElementById('clearAllBtn');
const applyHint = document.getElementById('applyHint');
const applyBtn = document.getElementById('applyBtn');

placementCanvas.style.touchAction = 'none';

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
let rectangles = [];
let placementBase = null;
let drawing = false;
let dragStart = null;
let dragCurrent = null;
let rectIdCounter = 0;

function updateApplyState() {
  const hasRects = rectangles.length > 0;
  applyBtn.disabled = !hasRects;
  clearAllBtn.disabled = !hasRects;
  rectCount.textContent = t('redact.js_rect_count', '{n} drawn', { n: rectangles.length });
  if (selectedPageIndex == null) {
    placementHint.textContent = t('redact.js_hint_pick_page', 'Pick a page above to start drawing.');
  } else if (!hasRects) {
    placementHint.textContent = t('redact.js_hint_drag', 'Click and drag on the page to draw a black rectangle over the text you want to redact.');
  } else {
    placementHint.textContent = t('redact.js_hint_ready', 'Ready. Draw more boxes or click "Redact & download".');
  }
}

function getCanvasPoint(e) {
  const rect = placementCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (placementCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (placementCanvas.height / rect.height),
  };
}

function rectToCanvasPx(r) {
  return {
    x: r.x * placementScale,
    y: placementCanvas.height - (r.y + r.height) * placementScale,
    width: r.width * placementScale,
    height: r.height * placementScale,
  };
}

function drawRectOnCanvas(ctx, r, preview) {
  const c = rectToCanvasPx(r);
  if (preview) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(c.x, c.y, c.width, c.height);
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(c.x, c.y, c.width, c.height);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(c.x, c.y, c.width, c.height);
  }
}

function redrawPlacement(previewRect) {
  const ctx = placementCanvas.getContext('2d');
  if (!placementBase) return;
  ctx.putImageData(placementBase, 0, 0);
  for (const r of rectangles) {
    if (r.pageIndex !== selectedPageIndex) continue;
    drawRectOnCanvas(ctx, r, false);
  }
  if (previewRect) {
    drawRectOnCanvas(ctx, previewRect, true);
  }
}

async function handleFile(file) {
  hideError();
  redactSection.hidden = true;
  placementSection.hidden = true;
  pageGrid.textContent = '';
  rectList.textContent = '';
  selectedPageIndex = null;
  placementBase = null;
  rectangles = [];
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

    redactSection.hidden = false;
    updateApplyState();
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
    label.textContent = t('redact.js_page_label', 'Page {n}', { n: i });
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
  renderRectList();
}

function canvasToPdfRect(start, end) {
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
  const previewRect = {
    pageIndex: selectedPageIndex,
    ...canvasToPdfRect(dragStart, dragCurrent),
  };
  redrawPlacement(previewRect);
});

placementCanvas.addEventListener('pointerup', (e) => {
  if (!drawing) return;
  drawing = false;
  try { placementCanvas.releasePointerCapture(e.pointerId); } catch { void e.pointerId; }
  dragCurrent = getCanvasPoint(e);
  const rect = canvasToPdfRect(dragStart, dragCurrent);
  const minCanvasPx = 4;
  const minPt = minCanvasPx / placementScale;
  if (rect.width >= minPt && rect.height >= minPt) {
    rectIdCounter += 1;
    rectangles.push({
      id: rectIdCounter,
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
  renderRectList();
  updateApplyState();
});

placementCanvas.addEventListener('pointercancel', () => {
  drawing = false;
  dragStart = null;
  dragCurrent = null;
  redrawPlacement();
});

function renderRectList() {
  rectList.textContent = '';
  if (!rectangles.length) {
    const empty = document.createElement('div');
    empty.className = 'file-list-count';
    empty.textContent = t('redact.js_rect_empty', 'No rectangles drawn yet. Drag on the page above to add one.');
    rectList.appendChild(empty);
    return;
  }
  let m = 0;
  for (const r of rectangles) {
    m += 1;
    const item = document.createElement('div');
    item.className = 'file-item';

    const info = document.createElement('div');
    info.className = 'file-item-info';
    const name = document.createElement('span');
    name.className = 'file-item-name';
    name.textContent = t('redact.js_rect_name', 'Page {page}, rectangle {n}', { page: r.pageIndex + 1, n: m });
    const meta = document.createElement('span');
    meta.className = 'file-item-meta';
    meta.textContent = t('redact.js_rect_meta', '{x}, {y} ({w} x {h} pt)', {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
    info.appendChild(name);
    info.appendChild(meta);
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'file-item-actions';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn icon-btn-danger';
    removeBtn.setAttribute('aria-label', t('redact.js_remove_aria', 'Remove rectangle {n}', { n: m }));
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    removeBtn.addEventListener('click', () => removeRect(r.id));
    actions.appendChild(removeBtn);
    item.appendChild(actions);

    rectList.appendChild(item);
  }
}

function removeRect(id) {
  rectangles = rectangles.filter((r) => r.id !== id);
  redrawPlacement();
  renderRectList();
  updateApplyState();
}

clearAllBtn.addEventListener('click', () => {
  if (!rectangles.length) return;
  rectangles = [];
  redrawPlacement();
  renderRectList();
  updateApplyState();
});

applyBtn.addEventListener('click', async () => {
  if (!currentDoc || !currentBytes) return;
  if (!rectangles.length) {
    showError(t('redact.js_err_no_rects', 'Draw at least one rectangle on a page first.'));
    return;
  }
  hideError();
  showProgress(t('redact.js_redacting', 'Burning redaction boxes into the PDF…'));
  applyBtn.disabled = true;
  try {
    const pdfLib = pdfLibRef || (await ensurePdfLib((msg) => setProgress(0, msg)));
    const black = pdfLib.rgb(0, 0, 0);
    const pages = currentDoc.getPages();
    const total = rectangles.length;
    rectangles.forEach((r, i) => {
      setProgress(Math.round(((i + 1) / total) * 20), t('redact.js_redacting_n', 'Redacting box {i}/{n}', { i: i + 1, n: total }));
      const page = pages[r.pageIndex];
      if (!page) return;
      page.drawRectangle({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        color: black,
      });
    });

    // A drawn rectangle only covers the content: the text underneath would
    // still be selectable and extractable from the file. Re-render every page
    // that carries a box to a flat image and rebuild it from those pixels, so
    // the covered content is actually removed. Pages without a box are copied
    // through untouched and keep their selectable text.
    const boxedBytes = await currentDoc.save();
    const pdfjs = await ensurePdfJs((msg) => setProgress(20, msg));
    const boxedTask = pdfjs.getDocument({ data: boxedBytes, ...PDFJS_ASSET_URLS });
    const boxedDoc = await boxedTask.promise;
    const redactedPages = new Set(rectangles.map((r) => r.pageIndex));
    const outDoc = await pdfLib.PDFDocument.create();
    for (let i = 0; i < pages.length; i++) {
      if (!redactedPages.has(i)) {
        const [copied] = await outDoc.copyPages(currentDoc, [i]);
        outDoc.addPage(copied);
        continue;
      }
      setProgress(20 + Math.round(((i + 1) / pages.length) * 65), t('redact.js_flattening_page', 'Removing covered content on page {i}…', { i: i + 1 }));
      const page = await boxedDoc.getPage(i + 1);
      const baseViewport = page.getViewport({ scale: 1 });
      const renderViewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: renderViewport }).promise;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      const jpgBytes = new Uint8Array(await blob.arrayBuffer());
      const embedded = await outDoc.embedJpg(jpgBytes);
      const outPage = outDoc.addPage([baseViewport.width, baseViewport.height]);
      outPage.drawImage(embedded, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
    }
    boxedTask.destroy().catch(() => {});
    // The rebuild starts from an empty document, so carry the basics over.
    if (currentDoc.getTitle()) outDoc.setTitle(currentDoc.getTitle());
    if (currentDoc.getAuthor()) outDoc.setAuthor(currentDoc.getAuthor());
    if (currentDoc.getSubject()) outDoc.setSubject(currentDoc.getSubject());
    if (currentDoc.getCreator()) outDoc.setCreator(currentDoc.getCreator());
    if (currentDoc.getProducer()) outDoc.setProducer(currentDoc.getProducer());

    setProgress(90, t('common.js_saving', 'Saving…'));
    const outBytes = await outDoc.save();
    const outName = `${currentFileName}-redacted.pdf`;
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'compress', label: t('redact.js_chain_compress', 'Compress') },
      { slug: 'organize', label: t('redact.js_chain_organize', 'Organize') },
      { slug: 'delete-pages', label: t('redact.js_chain_delete', 'Delete pages') },
    ]);
    finishProgress();
    currentDoc = await pdfLib.PDFDocument.load(currentBytes, {
      ignoreEncryption: true,
    });
  } catch (err) {
    console.error(err);
    showError(err?.message || t('redact.js_err_save', 'Something went wrong while redacting this PDF.'));
    hideProgress();
  } finally {
    applyBtn.disabled = false;
    updateApplyState();
  }
});

renderRectList();

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
