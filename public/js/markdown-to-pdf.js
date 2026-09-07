'use strict';

import { ensurePdfLib } from './lib-loader.js';
import { layoutMarkdownToPdf } from './md-layout.js';
import { renderMarkdownPreview } from './md-render.js';
import { t } from './i18n.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');
const mdSource = document.getElementById('mdSource');
const previewContent = document.getElementById('previewContent');
const tabSource = document.getElementById('tabSource');
const tabPreview = document.getElementById('tabPreview');
const paneSource = document.getElementById('paneSource');
const panePreview = document.getElementById('panePreview');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const progressSection = document.getElementById('progressSection');
const progressStatus = document.getElementById('progressStatus');
const progressFill = document.getElementById('progressFill');

const SAMPLE = `# Project Notes

A short **Markdown to PDF** demo. Edit this text, then download it as a PDF.

## Highlights

- Headings, lists, and *emphasis* all lay out automatically
- Long paragraphs wrap and paginate on their own
- Document processing happens in this browser tab; BrowserPDF has no file-upload endpoint

1. Write your Markdown
2. Check the preview
3. Download the PDF
`;

let currentFileName = 'document';

function showError(message) {
  errorText.textContent = message;
  errorSection.hidden = false;
}
function hideError() {
  errorSection.hidden = true;
  errorText.textContent = '';
}
function setProgress(percent, text) {
  progressFill.style.setProperty('--progress', String(percent));
  progressStatus.textContent = text;
}

function updatePreview() {
  renderMarkdownPreview(mdSource.value, previewContent);
}
function setActiveTab(which) {
  const sourceActive = which === 'source';
  tabSource.classList.toggle('active', sourceActive);
  tabPreview.classList.toggle('active', !sourceActive);
  tabSource.setAttribute('aria-selected', String(sourceActive));
  tabPreview.setAttribute('aria-selected', String(!sourceActive));
  paneSource.hidden = !sourceActive;
  panePreview.hidden = sourceActive;
}
mdSource.value = SAMPLE;
updatePreview();
mdSource.addEventListener('input', updatePreview);
tabSource.addEventListener('click', () => setActiveTab('source'));
tabPreview.addEventListener('click', () => setActiveTab('preview'));

function looksLikeTextFile(file) {
  return file.type.startsWith('text/') || /\.(md|markdown|txt)$/i.test(file.name) || file.type === '';
}
async function loadFile(file) {
  hideError();
  if (!looksLikeTextFile(file)) {
    showError(t('markdown-to-pdf.js_err_not_text', 'Please choose a Markdown or plain text file.'));
    return;
  }
  currentFileName = file.name.replace(/\.(md|markdown|txt)$/i, '') || 'document';
  try {
    mdSource.value = await file.text();
    updatePreview();
  } catch (err) {
    console.error(err);
    showError(t('markdown-to-pdf.js_err_read_file', 'Could not read this file.'));
  }
}
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) loadFile(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
  fileInput.value = '';
});
clearBtn.addEventListener('click', () => {
  mdSource.value = '';
  currentFileName = 'document';
  updatePreview();
  mdSource.focus();
});
// (Markdown parsing lives in md-blocks.js, shared with PDF to Word.)

// (Layout engine lives in md-layout.js, shared with the Markdown Viewer.)

downloadBtn.addEventListener('click', async () => {
  const markdown = mdSource.value.trim();
  if (!markdown) {
    showError(t('markdown-to-pdf.js_err_no_markdown', 'There is no Markdown to convert yet.'));
    return;
  }
  hideError();
  progressSection.hidden = false;
  downloadBtn.disabled = true;
  try {
    setProgress(20, t('common.js_loading_pdflib', 'Loading pdf-lib…'));
    const pdfLib = await ensurePdfLib((msg) => setProgress(20, msg));
    setProgress(60, t('markdown-to-pdf.js_laying_out', 'Laying out pages…'));
    const doc = await layoutMarkdownToPdf(mdSource.value, pdfLib);
    setProgress(90, t('common.js_saving', 'Saving…'));
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentFileName}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setProgress(100, t('common.js_done', 'Done.'));
    setTimeout(() => {
      progressSection.hidden = true;
    }, 1200);
  } catch (err) {
    console.error(err);
    showError(err?.message || t('markdown-to-pdf.js_err_generic', 'Something went wrong while creating the PDF.'));
    progressSection.hidden = true;
  } finally {
    downloadBtn.disabled = false;
  }
});
