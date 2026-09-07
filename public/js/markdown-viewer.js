'use strict';

import { renderMarkdownPreview } from './md-render.js';
import { ensurePdfLib } from './lib-loader.js';
import { layoutMarkdownToPdf } from './md-layout.js';
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
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const resultSection = document.getElementById('resultSection');
const resultPanes = document.getElementById('resultPanes');
const paneGutter = document.getElementById('paneGutter');

const SAMPLE = `# Welcome to the Markdown Viewer

Start typing here, or drop a **.md** file above.

## Features

- Live preview as you type
- Document processing happens in this browser tab; BrowserPDF has no file-upload endpoint
- Supports *italic*, **bold**, and \`inline code\`

1. Write Markdown on the left
2. See it rendered on the right
3. Copy or download when you're done
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
  return (
    file.type.startsWith('text/') ||
    /\.(md|markdown|txt)$/i.test(file.name) ||
    file.type === ''
  );
}

async function loadFile(file) {
  hideError();
  if (!looksLikeTextFile(file)) {
    showError(t('markdown-viewer.js_err_not_text', 'Please choose a Markdown or plain text file.'));
    return;
  }
  currentFileName = file.name.replace(/\.(md|markdown|txt)$/i, '') || 'document';
  try {
    const text = await file.text();
    mdSource.value = text;
    updatePreview();
  } catch (err) {
    console.error(err);
    showError(t('markdown-viewer.js_err_read', 'Could not read this file.'));
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

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(mdSource.value);
  } catch {
    mdSource.select();
    document.execCommand('copy');
  }
  copyBtn.classList.add('copied');
  setTimeout(() => copyBtn.classList.remove('copied'), 1400);
});

downloadBtn.addEventListener('click', () => {
  const blob = new Blob([mdSource.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentFileName}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const downloadPdfLabel = document.getElementById('downloadPdfLabel');

downloadPdfBtn.addEventListener('click', async () => {
  if (!mdSource.value.trim()) {
    showError(t('markdown-viewer.js_err_empty', 'There is no Markdown to convert yet.'));
    return;
  }
  hideError();
  downloadPdfBtn.disabled = true;
  downloadPdfLabel.textContent = t('common.preparing', 'Preparing…');
  try {
    const pdfLib = await ensurePdfLib((msg) => {
      downloadPdfLabel.textContent = msg;
    });
    downloadPdfLabel.textContent = t('markdown-viewer.js_laying_out', 'Laying out pages…');
    const doc = await layoutMarkdownToPdf(mdSource.value, pdfLib);
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
  } catch (err) {
    console.error(err);
    showError(err?.message || t('markdown-viewer.js_err_pdf', 'Something went wrong while creating the PDF.'));
  } finally {
    downloadPdfBtn.disabled = false;
    downloadPdfLabel.textContent = t('markdown-viewer.btn_save_pdf', 'Save as PDF');
  }
});

clearBtn.addEventListener('click', () => {
  mdSource.value = '';
  currentFileName = 'document';
  updatePreview();
  mdSource.focus();
});

function isFullscreen() {
  return document.fullscreenElement === resultSection || document.webkitFullscreenElement === resultSection;
}

if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) {
  fullscreenBtn.hidden = true;
}

fullscreenBtn.addEventListener('click', async () => {
  try {
    if (!isFullscreen()) {
      if (resultSection.requestFullscreen) {
        await resultSection.requestFullscreen();
      } else if (resultSection.webkitRequestFullscreen) {
        resultSection.webkitRequestFullscreen();
      }
    } else if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } catch (err) {
    console.warn('Fullscreen toggle failed:', err);
  }
});

function clampSourcePercent(pct) {
  return Math.min(80, Math.max(20, pct));
}

function setSourcePercent(pct) {
  resultPanes.style.setProperty('--source-col', `${clampSourcePercent(pct)}%`);
}

let draggingGutter = false;

paneGutter.addEventListener('pointerdown', (e) => {
  draggingGutter = true;
  paneGutter.classList.add('dragging');
  paneGutter.setPointerCapture(e.pointerId);
});

paneGutter.addEventListener('pointermove', (e) => {
  if (!draggingGutter) return;
  const rect = resultPanes.getBoundingClientRect();
  setSourcePercent(((e.clientX - rect.left) / rect.width) * 100);
});

function stopDraggingGutter() {
  draggingGutter = false;
  paneGutter.classList.remove('dragging');
}
paneGutter.addEventListener('pointerup', stopDraggingGutter);
paneGutter.addEventListener('pointercancel', stopDraggingGutter);

paneGutter.addEventListener('dblclick', () => {
  resultPanes.style.removeProperty('--source-col');
});

paneGutter.addEventListener('keydown', (e) => {
  const current = parseFloat(getComputedStyle(resultPanes).getPropertyValue('--source-col')) || 50;
  if (e.key === 'ArrowLeft') {
    setSourcePercent(current - 5);
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    setSourcePercent(current + 5);
    e.preventDefault();
  }
});
