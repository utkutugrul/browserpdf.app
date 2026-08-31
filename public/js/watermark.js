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
const watermarkText = document.getElementById('watermarkText');
const styleSelect = document.getElementById('styleSelect');
const colorSelect = document.getElementById('colorSelect');
const sizeSlider = document.getElementById('sizeSlider');
const sizeValue = document.getElementById('sizeValue');
const opacitySlider = document.getElementById('opacitySlider');
const opacityValue = document.getElementById('opacityValue');
const applyBtn = document.getElementById('applyBtn');
const charWarning = document.getElementById('charWarning');
const previewPanel = document.getElementById('previewPanel');
const previewCanvas = document.getElementById('previewCanvas');

const COLORS = {
  gray: [0.55, 0.55, 0.55],
  red: [0.78, 0.16, 0.1],
  blue: [0.12, 0.29, 0.65],
};

let currentBytes = null;
let currentFileName = 'document';
let previewDebounce = null;
let previewToken = 0;

async function handleFile(file) {
  hideError();
  optionsSection.hidden = true;
  previewPanel.hidden = true;
  charWarning.hidden = true;
  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;
  fileSummary.textContent = `${file.name} (${formatBytes(file.size)})`;
  optionsSection.hidden = false;
  schedulePreview();
}

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));

// Filters the text to what the built-in PDF fonts can encode; shows a
// warning when characters get dropped. Returns null if nothing survives.
function encodableText(font, rawText) {
  const supported = new Set(font.getCharacterSet());
  const text = [...rawText].filter((ch) => supported.has(ch.codePointAt(0))).join('');
  if (!text.trim()) return null;
  if (text !== rawText) {
    charWarning.textContent = t('watermark.js_char_warning', 'Some characters aren\'t supported by the built-in PDF fonts and were skipped; the watermark will read "{text}".', { text });
    charWarning.hidden = false;
  } else {
    charWarning.hidden = true;
  }
  return text;
}

function stampPage(page, pdfLib, font, text) {
  const size = Number(sizeSlider.value);
  const opacity = Number(opacitySlider.value) / 100;
  const [r, g, b] = COLORS[colorSelect.value] || COLORS.gray;
  const color = pdfLib.rgb(r, g, b);
  const { width: pw, height: ph } = page.getSize();
  const w = font.widthOfTextAtSize(text, size);
  if (styleSelect.value === 'diagonal') {
    const cos = Math.SQRT1_2;
    page.drawText(text, {
      x: pw / 2 - (w / 2) * cos,
      y: ph / 2 - (w / 2) * cos,
      size, font, color, opacity,
      rotate: pdfLib.degrees(45),
    });
  } else {
    page.drawText(text, {
      x: (pw - w) / 2,
      y: ph / 2 - size / 2,
      size, font, color, opacity,
    });
  }
}

async function renderPreview() {
  if (!currentBytes) return;
  const myToken = ++previewToken;
  const rawText = watermarkText.value.trim();
  try {
    const pdfLib = await ensurePdfLib(() => {});
    const srcDoc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const previewDoc = await pdfLib.PDFDocument.create();
    const [firstPage] = await previewDoc.copyPages(srcDoc, [0]);
    previewDoc.addPage(firstPage);
    if (rawText) {
      const font = await previewDoc.embedFont(pdfLib.StandardFonts.HelveticaBold);
      const text = encodableText(font, rawText);
      if (text) stampPage(previewDoc.getPages()[0], pdfLib, font, text);
    }
    const bytes = await previewDoc.save();
    if (myToken !== previewToken) return; // superseded by newer settings
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

watermarkText.addEventListener('input', schedulePreview);
styleSelect.addEventListener('change', schedulePreview);
colorSelect.addEventListener('change', schedulePreview);
sizeSlider.addEventListener('input', () => {
  sizeValue.textContent = t('watermark.js_size_pt', '{n} pt', { n: sizeSlider.value });
  schedulePreview();
});
opacitySlider.addEventListener('input', () => {
  opacityValue.textContent = t('watermark.js_opacity_pct', '{n}%', { n: opacitySlider.value });
  schedulePreview();
});

applyBtn.addEventListener('click', async () => {
  if (!currentBytes) return;
  const rawText = watermarkText.value.trim();
  if (!rawText) {
    showError(t('watermark.js_err_no_text', 'Enter the watermark text first.'));
    return;
  }
  hideError();
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  applyBtn.disabled = true;
  try {
    const pdfLib = await ensurePdfLib((msg) => setProgress(0, msg));
    const doc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const font = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
    const text = encodableText(font, rawText);
    if (!text) {
      showError(t('watermark.js_err_no_chars', 'None of these characters are supported by the built-in PDF fonts. Try plain A-Z letters.'));
      hideProgress();
      return;
    }
    const pages = doc.getPages();
    pages.forEach((page, i) => {
      setProgress(Math.round(((i + 1) / pages.length) * 90), t('watermark.js_stamping_page', 'Watermarking page {i}/{n}', { i: i + 1, n: pages.length }));
      stampPage(page, pdfLib, font, text);
    });
    setProgress(95, t('common.js_saving', 'Saving…'));
    const outBytes = await doc.save();
    const outName = `${currentFileName}-watermarked.pdf`;
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'compress', label: t('watermark.js_chain_compress', 'Compress') },
      { slug: 'page-numbers', label: t('watermark.js_chain_page_numbers', 'Add Page Numbers') },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('watermark.js_err_generic', 'Something went wrong while adding the watermark.'));
    hideProgress();
  } finally {
    applyBtn.disabled = false;
  }
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
