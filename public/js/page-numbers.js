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
const positionSelect = document.getElementById('positionSelect');
const formatSelect = document.getElementById('formatSelect');
const startInput = document.getElementById('startInput');
const skipFirstInput = document.getElementById('skipFirstInput');
const applyBtn = document.getElementById('applyBtn');
const previewPanel = document.getElementById('previewPanel');
const previewCanvas = document.getElementById('previewCanvas');
const previewTitle = document.getElementById('previewTitle');

const FONT_SIZE = 11;
const MARGIN = 28;

let currentBytes = null;
let currentFileName = 'document';
let srcPageCount = 0;
let previewDebounce = null;
let previewToken = 0;

async function handleFile(file) {
  hideError();
  optionsSection.hidden = true;
  previewPanel.hidden = true;
  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;
  srcPageCount = 0;
  fileSummary.textContent = `${file.name} (${formatBytes(file.size)})`;
  optionsSection.hidden = false;
  schedulePreview();
}

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));

function labelFor(format, number, total) {
  if (format === 'page-n') return `Page ${number}`;
  if (format === 'page-n-of-m') return `Page ${number} of ${total}`;
  return String(number);
}

function drawNumber(page, pdfLib, font, text) {
  const width = font.widthOfTextAtSize(text, FONT_SIZE);
  const { width: pw, height: ph } = page.getSize();
  const [vPos, hPos] = positionSelect.value.split('-');
  const x = hPos === 'left' ? MARGIN : hPos === 'right' ? pw - MARGIN - width : (pw - width) / 2;
  const y = vPos === 'top' ? ph - MARGIN : MARGIN - FONT_SIZE / 2 + 6;
  page.drawText(text, { x, y, size: FONT_SIZE, font, color: pdfLib.rgb(0.25, 0.25, 0.25) });
}

function numberingPlan() {
  const skipFirst = skipFirstInput.checked && srcPageCount > 1;
  const start = Math.max(1, parseInt(startInput.value, 10) || 1);
  const numberedCount = skipFirst ? srcPageCount - 1 : srcPageCount;
  return { skipFirst, start, total: numberedCount + start - 1 };
}

async function renderPreview() {
  if (!currentBytes) return;
  const myToken = ++previewToken;
  try {
    const pdfLib = await ensurePdfLib(() => {});
    const srcDoc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    srcPageCount = srcDoc.getPageCount();

    const { skipFirst, start, total } = numberingPlan();
    const previewIndex = skipFirst ? 1 : 0; // first page that receives a number
    const previewDoc = await pdfLib.PDFDocument.create();
    const [page] = await previewDoc.copyPages(srcDoc, [previewIndex]);
    previewDoc.addPage(page);
    const font = await previewDoc.embedFont(pdfLib.StandardFonts.Helvetica);
    drawNumber(previewDoc.getPages()[0], pdfLib, font, labelFor(formatSelect.value, start, total));

    const bytes = await previewDoc.save();
    if (myToken !== previewToken) return;
    const pdfjs = await ensurePdfJs(() => {});
    await renderPdfPageToCanvas(pdfjs, bytes, 1, previewCanvas, 340, PDFJS_ASSET_URLS);
    if (myToken === previewToken) {
      previewTitle.textContent = skipFirst
        ? t('page-numbers.preview_page2', 'Live preview (page 2, the first numbered page)')
        : t('page-numbers.preview_first', 'Live preview (first page)');
      previewPanel.hidden = false;
    }
  } catch (err) {
    console.warn('Preview failed:', err);
  }
}

function schedulePreview() {
  clearTimeout(previewDebounce);
  previewDebounce = setTimeout(renderPreview, 350);
}

positionSelect.addEventListener('change', schedulePreview);
formatSelect.addEventListener('change', schedulePreview);
startInput.addEventListener('input', schedulePreview);
skipFirstInput.addEventListener('change', schedulePreview);

applyBtn.addEventListener('click', async () => {
  if (!currentBytes) return;
  hideError();
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  applyBtn.disabled = true;
  try {
    const pdfLib = await ensurePdfLib((msg) => setProgress(0, msg));
    const doc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
    const pages = doc.getPages();
    srcPageCount = pages.length;

    const { skipFirst, start, total } = numberingPlan();
    const numbered = skipFirst ? pages.slice(1) : pages;
    numbered.forEach((page, i) => {
      setProgress(Math.round(((i + 1) / numbered.length) * 90), t('page-numbers.js_numbering_page', 'Numbering page {i}/{n}', { i: i + 1, n: numbered.length }));
      drawNumber(page, pdfLib, font, labelFor(formatSelect.value, start + i, total));
    });

    setProgress(95, t('common.js_saving', 'Saving…'));
    const outBytes = await doc.save();
    const outName = `${currentFileName}-numbered.pdf`;
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [
      { slug: 'compress', label: t('page-numbers.js_chain_compress', 'Compress') },
      { slug: 'watermark', label: t('page-numbers.js_chain_watermark', 'Add Watermark') },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('page-numbers.js_err_generic', 'Something went wrong while adding page numbers.'));
    hideProgress();
  } finally {
    applyBtn.disabled = false;
  }
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
