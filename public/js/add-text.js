'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import {
  showError, hideError, showProgress, setProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, takeChainedFile, offerChain,
} from './tool-ui.js';
import { t } from './i18n.js';

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

const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d');

function getStandardFont(pdfLib, value) {
  switch (value) {
    case 'helvetica':
      return pdfLib.StandardFonts.Helvetica;
    case 'helvetica-bold':
      return pdfLib.StandardFonts.HelveticaBold;
    case 'times-roman':
      return pdfLib.StandardFonts.TimesRoman;
    case 'courier':
      return pdfLib.StandardFonts.Courier;
    default:
      return pdfLib.StandardFonts.Helvetica;
  }
}

function encodableText(font, rawText) {
  const supported = new Set(font.getCharacterSet());
  const lines = rawText.split('\n');
  const encodedLines = lines.map((line) =>
    [...line].filter((ch) => supported.has(ch.codePointAt(0))).join('')
  );
  const text = encodedLines.join('\n');
  if (!text.trim()) return null;
  if (text !== rawText) {
    charWarning.textContent = t(
      'add-text.js_char_warning',
      'Some characters aren\'t supported by the built-in PDF fonts and were skipped.'
    );
    charWarning.hidden = false;
  } else {
    charWarning.hidden = true;
  }
  return text;
}

function estimateTextSize(text, fontValue, sizePt) {
  const webFont = WEB_FONT_MAP[fontValue] || 'sans-serif';
  const fontSizePx = sizePt * placementScale;
  measureCtx.font = `${fontSizePx}px ${webFont}`;
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
  applyBtn.disabled = !(hasText && hasPlacement);
  if (!hasText) {
    placementHint.textContent = t('add-text.js_hint_type', 'Type some text above to place.');
  } else if (selectedPageIndex == null) {
    placementHint.textContent = t('add-text.js_hint_pick_page', 'Pick a page above.');
  } else if (placementPoint == null) {
    placementHint.textContent = t('add-text.js_hint_click', 'Click on the page to place your text.');
  } else {
    placementHint.textContent = t('add-text.js_hint_ready', 'Ready. Click "Add text & download".');
  }
}

function updateGhost() {
  document.getElementById('textGhost')?.remove();
  if (!placementPoint) return;
  const text = textInput.value;
  if (!text.trim()) return;
  const rect = placementCanvas.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = rect.width / placementCanvas.width;
  const { widthCanvasPx, heightCanvasPx } = estimateTextSize(
    text,
    fontSelect.value,
    Number(sizeSlider.value)
  );
  const ghost = document.createElement('div');
  ghost.id = 'textGhost';
  ghost.className = 'sig-ghost';
  ghost.style.left = `${placementPoint.cssX}px`;
  ghost.style.top = `${placementPoint.cssY - heightCanvasPx * ratio}px`;
  ghost.style.width = `${Math.max(widthCanvasPx * ratio, 8)}px`;
  ghost.style.height = `${heightCanvasPx * ratio}px`;
  placementWrap.appendChild(ghost);
}

async function handleFile(file) {
  hideError();
  textOptionsSection.hidden = true;
  placementSection.hidden = true;
  charWarning.hidden = true;
  pageGrid.textContent = '';
  selectedPageIndex = null;
  placementPoint = null;
  document.getElementById('textGhost')?.remove();
  textInput.value = '';

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

    textOptionsSection.hidden = false;
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
  placementCanvas.width = viewport.width;
  placementCanvas.height = viewport.height;
  await page.render({
    canvasContext: placementCanvas.getContext('2d'),
    viewport,
  }).promise;
  placementPageHeightPt = baseViewport.height;

  placementSection.hidden = false;
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
    pdfY: placementPageHeightPt - canvasY / placementScale,
    cssX,
    cssY,
  };
  updateGhost();
  updateApplyState();
});

textInput.addEventListener('input', () => {
  updateGhost();
  updateApplyState();
});
fontSelect.addEventListener('change', () => {
  updateGhost();
});
sizeSlider.addEventListener('input', () => {
  sizeValue.textContent = t('add-text.js_size_pt', '{n} pt', { n: sizeSlider.value });
  updateGhost();
});

sizeValue.textContent = t('add-text.js_size_pt', '{n} pt', { n: sizeSlider.value });

applyBtn.addEventListener('click', async () => {
  if (!currentDoc || !currentBytes) return;
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
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  applyBtn.disabled = true;
  try {
    const pdfLib = pdfLibRef || (await ensurePdfLib((msg) => setProgress(0, msg)));
    const font = await currentDoc.embedFont(getStandardFont(pdfLib, fontSelect.value));
    const text = encodableText(font, rawText);
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
    const pages = currentDoc.getPages();
    const targetPage = pages[selectedPageIndex];
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

    setProgress(90, t('common.js_saving', 'Saving…'));
    const outBytes = await currentDoc.save();
    const outName = `${currentFileName}-text.pdf`;
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'compress', label: t('add-text.js_chain_compress', 'Compress') },
      { slug: 'page-numbers', label: t('add-text.js_chain_page_numbers', 'Add Page Numbers') },
    ]);
    finishProgress();
    currentDoc = await pdfLib.PDFDocument.load(currentBytes, {
      ignoreEncryption: true,
    });
  } catch (err) {
    console.error(err);
    showError(
      err?.message || t('add-text.js_err_generic', 'Something went wrong while adding text.')
    );
    hideProgress();
  } finally {
    applyBtn.disabled = false;
    updateApplyState();
  }
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
