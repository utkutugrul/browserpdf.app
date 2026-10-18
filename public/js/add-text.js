'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import {
  showError, hideError, showProgress, setProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, takeChainedFile, offerChain, documentSession, clearResult, showDocumentIdentity,
} from './tool-ui.js';
import { t } from './i18n.js';
import { embedUnicodeFont, ensureUnicodePreviewFont } from './core/pdf-fonts.js';
import { visualTransform } from './core/page-geometry.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const textOptionsSection = document.getElementById('textOptionsSection');
const textInput = document.getElementById('textInput');
const fontSelect = document.getElementById('fontSelect');
const sizeSlider = document.getElementById('sizeSlider');
const sizeValue = document.getElementById('sizeValue');
const colorSelect = document.getElementById('colorSelect');
const pageGrid = document.getElementById('pageGrid');
const placementSection = document.getElementById('placementSection');
const placementWrap = document.getElementById('placementWrap');
const placementCanvas = document.getElementById('placementCanvas');
const placementHint = document.getElementById('placementHint');
const charWarning = document.getElementById('charWarning');
const applyBtn = document.getElementById('applyBtn');

const WEB_FONT_MAP = {
  helvetica: 'sans-serif',
  'helvetica-bold': 'sans-serif',
  'times-roman': 'serif',
  courier: 'monospace',
};

const COLOR_MAP = {
  black: [0, 0, 0],
  red: [0.78, 0.16, 0.1],
  blue: [0.12, 0.29, 0.65],
  gray: [0.55, 0.55, 0.55],
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
let placementPoint = null;
let placementViewport = null;
let generation = 0;
let cachedExport = null;
let busy = false;
let renderReady = false;
let pageGeneration = 0;
let ghostGeneration = 0;
const historyRow = document.createElement('div'); historyRow.className = 'editor-toolbar';
for (const [id, label, action] of [['undoEditBtn', 'Undo', 'undo'], ['redoEditBtn', 'Redo', 'redo']]) {
  const btn = document.createElement('button'); btn.id = id; btn.type = 'button'; btn.className = 'btn btn-ghost btn-small'; btn.textContent = t(`workspace.${action}`, label);
  btn.addEventListener('click', async () => {
    if (busy) return;
    const artifact = documentSession[action](); if (!artifact) return;
    const token = generation; busy = true; clearResult(); showDocumentIdentity(); updateApplyState();
    currentBytes = artifact.bytes; cachedExport = artifact; placementPoint = null;
    try {
      await reloadCurrent(); if (token !== generation) return;
      await downloadBytes(artifact.bytes, artifact.name, artifact.type, { capabilities: artifact.capabilities, operation: { isCurrent: () => token === generation } });
      if (token === generation) await offerChain(artifact.bytes, artifact.name, [], artifact);
    } catch (error) { if (token === generation) showError(error.message); }
    finally { if (token === generation) { busy = false; updateApplyState(); } }
  }); historyRow.append(btn);
}
placementSection.append(historyRow);

async function reloadCurrent() {
  renderReady = false; placementSection.hidden = true; updateApplyState();
  const lib = pdfLibRef || await ensurePdfLib();
  currentDoc = await lib.PDFDocument.load(currentBytes);
  await pdfJsDocRef?.loadingTask?.destroy();
  const pdfjs = await ensurePdfJs(); pdfJsDocRef = await pdfjs.getDocument({ data: currentBytes.slice(), ...PDFJS_ASSET_URLS }).promise;
  await renderPageGrid(); if (selectedPageIndex !== null) await selectPage(selectedPageIndex);
}

const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d');

function estimateTextSize(text, fontValue, sizePt, family) {
  const fontSizePx = sizePt * placementScale;
  measureCtx.font = `${fontValue === 'helvetica-bold' ? '700' : '400'} ${fontSizePx}px "${family}"`;
  const lines = text.split('\n');
  let maxWidth = 0;
  for (const line of lines) {
    const w = measureCtx.measureText(line || ' ').width;
    if (w > maxWidth) maxWidth = w;
  }
  return {
    widthCanvasPx: maxWidth,
    heightCanvasPx: fontSizePx * 1.2 * lines.length,
  };
}

function updateApplyState() {
  const hasText = textInput.value.trim().length > 0;
  const hasPlacement = placementPoint != null && selectedPageIndex != null;
  applyBtn.disabled = busy || !renderReady || !(hasText && (hasPlacement || cachedExport));
  for (const input of [textInput, fontSelect, sizeSlider, colorSelect]) input.disabled = busy;
  placementCanvas.style.pointerEvents = busy || !renderReady ? 'none' : '';
  const snapshot = documentSession.snapshot();
  document.getElementById('undoEditBtn').disabled = busy || !snapshot.canUndo;
  document.getElementById('redoEditBtn').disabled = busy || !snapshot.canRedo;
  if (!hasText) {
    placementHint.textContent = t('add-text.js_hint_type', 'Type some text above to place.');
  } else if (selectedPageIndex == null) {
    placementHint.textContent = t('add-text.js_hint_pick_page', 'Pick a page above.');
  } else if (placementPoint == null) {
    placementHint.textContent = t('add-text.js_hint_click', 'Click on the page to place your text.');
  } else {
    placementHint.textContent = t('workspace.text_ready', 'Ready. Apply text, then review the result.');
  }
}

async function updateGhost() {
  const token = ++ghostGeneration;
  document.getElementById('textGhost')?.remove();
  if (!placementPoint) return;
  const text = textInput.value;
  if (!text.trim()) return;
  const rect = placementCanvas.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = rect.width / placementCanvas.width;
  let family;
  try { family = await ensureUnicodePreviewFont(fontSelect.value === 'helvetica-bold' ? 'bold' : 'regular', { text }); }
  catch (error) { if (token === ghostGeneration) showError(error.message); return; }
  if (token !== ghostGeneration || !placementPoint) return;
  const { widthCanvasPx, heightCanvasPx } = estimateTextSize(
    text,
    fontSelect.value,
    Number(sizeSlider.value), family
  );
  const ghost = document.createElement('div');
  ghost.id = 'textGhost';
  ghost.className = 'text-preview-object';
  ghost.style.left = `${placementPoint.pdfX * placementScale * ratio}px`;
  ghost.style.top = `${placementPoint.cssY - heightCanvasPx * ratio}px`;
  ghost.style.width = `${Math.max(widthCanvasPx * ratio, 8)}px`;
  ghost.style.height = `${heightCanvasPx * ratio}px`;
  ghost.textContent = text;
  ghost.style.fontFamily = family;
  if (token !== ghostGeneration || !placementPoint) return;
  ghost.style.fontSize = `${Number(sizeSlider.value) * placementScale * ratio}px`;
  ghost.style.fontWeight = fontSelect.value === 'helvetica-bold' ? '700' : '400';
  ghost.style.color = `rgb(${(COLOR_MAP[colorSelect.value] || COLOR_MAP.black).map((n) => n * 255).join(',')})`;
  const visualY = (placementViewport.height / placementScale - placementPoint.pdfY) * placementScale * ratio;
  ghost.style.top = `${visualY - Number(sizeSlider.value) * placementScale * ratio}px`;
  ghost.setAttribute('aria-label', t('workspace.text_preview', 'Text preview'));
  placementWrap.appendChild(ghost);
}

async function handleFile(file) {
  const token = ++generation; busy = true; updateApplyState();
  hideError();
  const parsed = await readPdfFile(file, { validate: true });
  if (!parsed || token !== generation) { if (token === generation) { busy = false; updateApplyState(); } return; }
  busy = false;
  cachedExport = null;
  textOptionsSection.hidden = true;
  placementSection.hidden = true;
  charWarning.hidden = true;
  pageGrid.textContent = '';
  selectedPageIndex = null;
  renderReady = false;
  placementPoint = null;
  document.getElementById('textGhost')?.remove();
  textInput.value = '';

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
    const loaded = await loadingTask.promise;
    if (token !== generation) { await loadingTask.destroy(); return; }
    pdfJsDocRef = loaded;
    numPages = pdfJsDocRef.numPages;
    await renderPageGrid();

    textOptionsSection.hidden = false;
    updateApplyState();
  } catch (err) {
    if (token === generation) showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  } finally {
    if (token === generation) hideProgress();
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
    label.textContent = t('add-text.js_page_label', 'Page {n}', { n: i });
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
  const token = ++pageGeneration;
  renderReady = false; placementSection.hidden = true; updateApplyState();
  selectedPageIndex = index;
  placementPoint = null;
  document.getElementById('textGhost')?.remove();
  pageGrid.querySelectorAll('.page-tile').forEach((tile) => {
    tile.classList.toggle('selected', Number(tile.dataset.pageIndex) === index);
  });

  const page = await pdfJsDocRef.getPage(index + 1);
  const baseViewport = page.getViewport({ scale: 1 });
  placementScale = Math.min(560 / baseViewport.width, 1.8);
  const viewport = page.getViewport({ scale: placementScale });
  placementViewport = viewport;
  placementCanvas.width = viewport.width;
  placementCanvas.height = viewport.height;
  await page.render({
    canvasContext: placementCanvas.getContext('2d'),
    viewport,
  }).promise;
  if (token !== pageGeneration) return;
  placementPageHeightPt = baseViewport.height;

  placementSection.hidden = false;
  renderReady = true;
  updateApplyState();
  updateGhost();
}

placementCanvas.addEventListener('click', (e) => {
  if (selectedPageIndex == null) return;
  const rect = placementCanvas.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;
  const canvasX = cssX * (placementCanvas.width / rect.width);
  const canvasY = cssY * (placementCanvas.height / rect.height);
  placementPoint = {
    pdfX: canvasX / placementScale,
    pdfY: (placementViewport.height - canvasY) / placementScale,
    cssX,
    cssY,
  };
  updateGhost();
  cachedExport = null;
  updateApplyState();
});

textInput.addEventListener('input', () => {
  cachedExport = null;
  updateGhost();
  updateApplyState();
});
fontSelect.addEventListener('change', () => {
  cachedExport = null;
  updateGhost();
});
sizeSlider.addEventListener('input', () => {
  cachedExport = null;
  sizeValue.textContent = t('add-text.js_size_pt', '{n} pt', { n: sizeSlider.value });
  updateGhost();
});
colorSelect.addEventListener('change', () => { cachedExport = null; updateGhost(); });

sizeValue.textContent = t('add-text.js_size_pt', '{n} pt', { n: sizeSlider.value });

applyBtn.addEventListener('click', async () => {
  if (!currentDoc || !currentBytes || busy) return;
  if (cachedExport) { await downloadBytes(cachedExport.bytes, cachedExport.name); return; }
  const rawText = textInput.value;
  if (!rawText.trim()) {
    showError(t('add-text.js_err_no_text', 'Enter the text to add first.'));
    return;
  }
  if (placementPoint == null || selectedPageIndex == null) {
    showError(
      t('add-text.js_err_no_placement', 'Pick a page and click where the text should go.')
    );
    return;
  }
  hideError();
  const token = generation;
  clearResult();
  busy = true;
  updateApplyState();
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  applyBtn.disabled = true;
  try {
    const pdfLib = pdfLibRef || (await ensurePdfLib((msg) => setProgress(0, msg)));
    const outputDoc = await pdfLib.PDFDocument.load(currentBytes);
    const font = await embedUnicodeFont(outputDoc, { text: rawText, weight: fontSelect.value === 'helvetica-bold' ? 'bold' : 'regular' });
    const text = rawText;
    if (!text) {
      showError(
        t(
          'add-text.js_err_no_chars',
          'None of these characters are supported by the built-in PDF fonts. Try plain A-Z letters.'
        )
      );
      hideProgress();
      return;
    }
    setProgress(50, t('add-text.js_adding_text', 'Adding text…'));
    const size = Number(sizeSlider.value);
    const [r, g, b] = COLOR_MAP[colorSelect.value] || COLOR_MAP.black;
    const color = pdfLib.rgb(r, g, b);
    const pages = outputDoc.getPages();
    const targetPage = pages[selectedPageIndex];
    const originalPage = await pdfJsDocRef.getPage(selectedPageIndex + 1);
    targetPage.pushOperators(pdfLib.pushGraphicsState(), pdfLib.concatTransformationMatrix(...visualTransform(originalPage.getViewport({ scale: 1 }))));
    const lines = text.split('\n');
    const lineHeight = size * 1.2;
    lines.forEach((line, i) => {
      if (!line) return;
      targetPage.drawText(line, {
        x: placementPoint.pdfX,
        y: placementPoint.pdfY - i * lineHeight,
        size,
        font,
        color,
      });
    });
    targetPage.pushOperators(pdfLib.popGraphicsState());

    setProgress(90, t('common.js_saving', 'Saving…'));
    const outBytes = await outputDoc.save();
    if (token !== generation) return;
    const outName = `${currentFileName}-text.pdf`;
    cachedExport = { bytes: outBytes.slice(), name: outName };
    currentBytes = outBytes.slice();
    documentSession.adopt(outBytes, outName, { type: 'application/pdf', capabilities: { ...documentSession.snapshot().current?.capabilities, searchable: true } });
    placementPoint = null;
    await reloadCurrent();
    if (token !== generation) return;
    await downloadBytes(outBytes, outName, 'application/pdf', { operation: { isCurrent: () => token === generation } });
    if (token !== generation) return;
    offerChain(outBytes, outName, [
      { slug: 'compress', label: t('add-text.js_chain_compress', 'Compress') },
      { slug: 'page-numbers', label: t('add-text.js_chain_page_numbers', 'Add Page Numbers') },
    ]);
    finishProgress();
  } catch (err) {
    if (token === generation) showError(
      err?.message || t('add-text.js_err_generic', 'Something went wrong while adding text.')
    );
    if (token === generation) hideProgress();
  } finally {
    if (token === generation) { busy = false; applyBtn.disabled = false; updateApplyState(); }
  }
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
new ResizeObserver(() => { if (placementPoint) void updateGhost(); }).observe(placementCanvas);
