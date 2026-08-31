'use strict';

import { convertPdfToMarkdown } from './pdf-convert.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBlob, wireDropzone, looksLikePdfFile, initLangChips, getSelectedOcrLangs, takeChainedFile,
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

// Strips the Markdown tokens the conversion engine emits, leaving plain text.
function markdownToPlainText(markdown) {
  return markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^\*\(Page scanned via OCR\)\*$/, '[Page scanned via OCR]')
        .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
    )
    .join('\n');
}

async function handleFile(file) {
  hideError();
  resultSection.hidden = true;
  if (!looksLikePdfFile(file)) {
    showError('Please select a PDF file.');
    return;
  }
  currentFileName = file.name.replace(/\.pdf$/i, '') || 'document';

  showProgress('Reading PDF…');
  try {
    const markdown = await convertPdfToMarkdown(
      file,
      { ocrLangs: getSelectedOcrLangs(), pageBreaks: pageBreaksInput.checked },
      {
        onProgress: (page, total, what) =>
          setProgress(Math.round((page / total) * 100), `Page ${page}/${total}: ${what}`),
        onStatus: (t) => setProgress(0, t),
      }
    );
    textOutput.value = markdownToPlainText(markdown);
    resultSection.hidden = false;
    finishProgress();
  } catch (err) {
    console.error(err);
    showError(err?.message || 'Could not extract text from this PDF.');
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
    `${currentFileName}.txt`
  );
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
