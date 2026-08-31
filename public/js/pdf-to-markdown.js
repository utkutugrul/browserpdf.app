'use strict';

import { renderMarkdownPreview } from './md-render.js';
import { convertPdfToMarkdown } from './pdf-convert.js';

// ---------- UI wiring ----------

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const progressSection = document.getElementById('progressSection');
const progressStatus = document.getElementById('progressStatus');
const progressFill = document.getElementById('progressFill');
const pageCanvas = document.getElementById('pageCanvas');
const cancelBtn = document.getElementById('cancelBtn');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');
const resultSection = document.getElementById('resultSection');
const markdownOutput = document.getElementById('markdownOutput');
const previewContent = document.getElementById('previewContent');
const tabSource = document.getElementById('tabSource');
const tabPreview = document.getElementById('tabPreview');
const paneSource = document.getElementById('paneSource');
const panePreview = document.getElementById('panePreview');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const langChips = document.querySelector('.lang-chips');
const langCountEl = document.getElementById('langCount');
const pageBreaksInput = document.getElementById('pageBreaks');

let currentAbortController = null;
let currentFileName = 'document';

// Tabs (narrow-screen layout)

function setActiveTab(which) {
  const sourceActive = which === 'source';
  tabSource.classList.toggle('active', sourceActive);
  tabPreview.classList.toggle('active', !sourceActive);
  tabSource.setAttribute('aria-selected', String(sourceActive));
  tabPreview.setAttribute('aria-selected', String(!sourceActive));
  paneSource.hidden = !sourceActive;
  panePreview.hidden = sourceActive;
}

tabSource.addEventListener('click', () => setActiveTab('source'));
tabPreview.addEventListener('click', () => setActiveTab('preview'));

// Dropzone + file input

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
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
  fileInput.value = '';
});

cancelBtn.addEventListener('click', () => {
  currentAbortController?.abort();
});

function updateLangCount() {
  const n = langChips.querySelectorAll('.lang-chip[aria-pressed="true"]').length;
  langCountEl.textContent = `${n} selected`;
}

langChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.lang-chip');
  if (!chip) return;
  const pressed = chip.getAttribute('aria-pressed') === 'true';
  chip.setAttribute('aria-pressed', String(!pressed));
  updateLangCount();
});

updateLangCount();

// Main flow

async function handleFile(file) {
  hideError();
  resultSection.hidden = true;
  dropzone.classList.add('has-file');
  currentFileName = file.name.replace(/\.pdf$/i, '') || 'document';

  const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) {
    showError('Please select a PDF file.');
    return;
  }

  const MAX_SIZE = 150 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    showError('File is too large (over 150MB). The browser tab may slow down or become unresponsive.');
    return;
  }

  const ocrLangs = Array.from(langChips.querySelectorAll('.lang-chip[aria-pressed="true"]')).map(
    (chip) => chip.dataset.lang
  );
  if (!ocrLangs.length) ocrLangs.push('eng');

  currentAbortController = new AbortController();
  progressSection.hidden = false;
  pageCanvas.hidden = true;
  setProgress(0, 'Preparing…');

  try {
    const markdown = await convertPdfToMarkdown(
      file,
      { ocrLangs, pageBreaks: pageBreaksInput.checked },
      {
        signal: currentAbortController.signal,
        onStatus: (text) => {
          progressStatus.textContent = text;
        },
        onProgress: (current, total, phase) => {
          setProgress(Math.round((current / total) * 100), `Processing page ${current}/${total} (${phase})`);
        },
        onPageImage: () => {
          pageCanvas.hidden = false;
          return pageCanvas;
        },
      }
    );
    showResult(markdown);
  } catch (err) {
    if (err?.name === 'AbortError') {
      setProgress(0, 'Canceled.');
      setTimeout(() => {
        progressSection.hidden = true;
      }, 1200);
    } else {
      console.error(err);
      showError(err?.message || 'An unexpected error occurred.');
      progressSection.hidden = true;
    }
  } finally {
    currentAbortController = null;
    pageCanvas.hidden = true;
  }
}

function setProgress(percent, statusText) {
  progressFill.style.setProperty('--progress', String(percent));
  progressStatus.textContent = statusText;
}

function showError(message) {
  errorText.textContent = message;
  errorSection.hidden = false;
}

function hideError() {
  errorSection.hidden = true;
  errorText.textContent = '';
}

function showResult(markdown) {
  progressSection.hidden = true;
  markdownOutput.value = markdown;
  renderMarkdownPreview(markdown, previewContent);
  resultSection.hidden = false;
  setActiveTab('source');
}

// Copy / download

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(markdownOutput.value);
  } catch {
    markdownOutput.select();
    document.execCommand('copy');
  }
  copyBtn.classList.add('copied');
  setTimeout(() => copyBtn.classList.remove('copied'), 1400);
});

downloadBtn.addEventListener('click', () => {
  const blob = new Blob([markdownOutput.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentFileName}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
