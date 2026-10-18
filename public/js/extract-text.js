'use strict';

import { extractPdfTextModel, textModelToPlainText } from './pdf-convert.js';
import { t } from './i18n.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBlob, wireDropzone, looksLikePdfFile, initLangChips, getSelectedOcrLangs, takeChainedFile, offerChain,
} from './tool-ui.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const resultSection = document.getElementById('resultSection');
const textOutput = document.getElementById('textOutput');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const pageBreaksInput = document.getElementById('pageBreaks');

let currentFileName = 'document';

initLangChips();

async function handleFile(file) {
  hideError();
  resultSection.hidden = true;
  if (!looksLikePdfFile(file)) {
    showError(t('extract-text.js_err_pdf', 'Please select a PDF file.'));
    return;
  }
  currentFileName = file.name.replace(/\.pdf$/i, '') || 'document';

  showProgress(t('common.js_reading_pdf', 'Reading PDF…'));
  try {
    const model = await extractPdfTextModel(
      file,
      { ocrLangs: getSelectedOcrLangs(), pageBreaks: pageBreaksInput.checked },
      {
        onProgress: (page, total, what) =>
          setProgress(Math.round((page / total) * 100), `Page ${page}/${total}: ${what}`),
        onStatus: (t) => setProgress(0, t),
      }
    );
    textOutput.value = textModelToPlainText(model, { pageBreaks: pageBreaksInput.checked });
    resultSection.dataset.textSources = model.pages.map((page) => `${page.pageNumber}:${page.source}`).join(',');
    let sourceSummary = document.getElementById('textSourceSummary');
    if (!sourceSummary) { sourceSummary = document.createElement('p'); sourceSummary.id = 'textSourceSummary'; sourceSummary.setAttribute('role', 'status'); resultSection.prepend(sourceSummary); }
    sourceSummary.textContent = t('extract-text.js_sources', '{pages} pages · {ocr} read with OCR', { pages: model.pageCount, ocr: model.pages.filter((page) => page.source === 'ocr').length });
    resultSection.hidden = false;
    offerChain(new TextEncoder().encode(textOutput.value), `${currentFileName}.txt`, [], { type: 'text/plain' });
    finishProgress();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('extract-text.js_err_extract', 'Could not extract text from this PDF.'));
    hideProgress();
  }
}

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(textOutput.value);
  } catch {
    textOutput.select();
    document.execCommand('copy');
  }
  copyBtn.classList.add('copied');
  setTimeout(() => copyBtn.classList.remove('copied'), 1400);
});

downloadBtn.addEventListener('click', () => {
  downloadBlob(
    new Blob([textOutput.value], { type: 'text/plain;charset=utf-8' }),
    `${currentFileName}.txt`, { download: true }
  );
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
