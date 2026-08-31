'use strict';

import { t } from './i18n.js';
import { convertPdfToMarkdown } from './pdf-convert.js';
import { parseMarkdownBlocks } from './md-blocks.js';
import { buildDocx } from './docx-writer.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBlob, wireDropzone, looksLikePdfFile, initLangChips, getSelectedOcrLangs, takeChainedFile,
} from './tool-ui.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const resultSummary = document.getElementById('resultSummary');

initLangChips();

async function handleFile(file) {
  hideError();
  resultSummary.hidden = true;
  if (!looksLikePdfFile(file)) {
    showError(t('common.js_err_not_pdf', 'Please select a PDF file.'));
    return;
  }
  const baseName = file.name.replace(/\.pdf$/i, '') || 'document';

  showProgress(t('pdf-to-word.js_reading_pdf', 'Reading PDF…'));
  try {
    // Reuse the PDF -> Markdown engine (headings, lists, bold/italic, OCR
    // fallback for scanned pages), then re-parse its output into the block
    // model the docx writer consumes.
    const markdown = await convertPdfToMarkdown(
      file,
      { ocrLangs: getSelectedOcrLangs(), pageBreaks: false },
      {
        onProgress: (page, total, what) =>
          setProgress(Math.round((page / total) * 90), t('pdf-to-word.js_page_progress', 'Page {page}/{total}: {what}', { page, total, what })),
        onStatus: (msg) => setProgress(0, msg),
      }
    );
    setProgress(95, t('pdf-to-word.js_building_docx', 'Building Word document…'));
    const blocks = parseMarkdownBlocks(markdown);
    if (!blocks.length) {
      showError(t('pdf-to-word.js_err_no_text', 'No text could be extracted from this PDF.'));
      hideProgress();
      return;
    }
    const blob = buildDocx(blocks);
    downloadBlob(blob, `${baseName}.docx`);
    resultSummary.textContent = t('pdf-to-word.js_converted_summary', 'Converted to {name}.docx. Headings, lists, and bold/italic formatting are preserved; complex layouts (tables, columns, images) are not.', { name: baseName });
    resultSummary.hidden = false;
    finishProgress();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('pdf-to-word.js_err_convert', 'Could not convert this PDF.'));
    hideProgress();
  }
}

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
