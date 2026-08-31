'use strict';

import { ensurePdfLib } from './lib-loader.js';
import { takeChainedFile, offerChain } from './tool-ui.js';
import { t } from './i18n.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileIconTpl = document.getElementById('fileIconTpl');
const fileListSection = document.getElementById('fileListSection');
const fileListEl = document.getElementById('fileList');
const fileListCount = document.getElementById('fileListCount');
const clearBtn = document.getElementById('clearBtn');
const mergeBtn = document.getElementById('mergeBtn');
const progressSection = document.getElementById('progressSection');
const progressStatus = document.getElementById('progressStatus');
const progressFill = document.getElementById('progressFill');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');

let items = [];
let nextId = 0;
let dragId = null;

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

function formatBytes(bytes) {
  if (bytes < 1000) return t('merge.js_size_b', '{n} B', { n: bytes });
  if (bytes < 1000 * 1000) return t('merge.js_size_kb', '{n} KB', { n: (bytes / 1000).toFixed(1) });
  return t('merge.js_size_mb', '{n} MB', { n: (bytes / (1000 * 1000)).toFixed(1) });
}

function looksLikePdfName(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function checkPdfMagicBytes(bytes) {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
}

function renderList() {
  fileListEl.textContent = '';
  fileListSection.hidden = items.length === 0;
  fileListCount.textContent = items.length === 1
    ? t('merge.js_file_count_one', '{n} file', { n: items.length })
    : t('merge.js_file_count_other', '{n} files', { n: items.length });
  mergeBtn.disabled = items.length < 2;

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.draggable = true;
    li.addEventListener('dragstart', (e) => {
      dragId = item.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragend', () => {
      dragId = null;
      fileListEl.querySelectorAll('.dragging, .drag-over').forEach((el) =>
        el.classList.remove('dragging', 'drag-over'));
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragId !== null && dragId !== item.id) li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragId === null || dragId === item.id) return;
      const from = items.findIndex((it) => it.id === dragId);
      const to = items.findIndex((it) => it.id === item.id);
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      renderList();
    });

    const iconWrap = document.createElement('div');
    iconWrap.className = 'file-item-icon';
    iconWrap.appendChild(fileIconTpl.content.cloneNode(true));
    li.appendChild(iconWrap);

    const info = document.createElement('div');
    info.className = 'file-item-info';
    const name = document.createElement('span');
    name.className = 'file-item-name';
    name.textContent = item.file.name;
    const meta = document.createElement('span');
    meta.className = 'file-item-meta';
    const pagesLabel = item.pageCount === 1
      ? t('merge.js_page_count_one', '{n} page', { n: item.pageCount })
      : t('merge.js_page_count_other', '{n} pages', { n: item.pageCount });
    meta.textContent = `${pagesLabel} · ${formatBytes(item.file.size)}`;
    info.appendChild(name);
    info.appendChild(meta);
    li.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'file-item-actions';

    const upBtn = document.createElement('button');
    upBtn.className = 'icon-btn';
    upBtn.type = 'button';
    upBtn.textContent = '↑';
    upBtn.setAttribute('aria-label', t('merge.js_move_up', 'Move {name} up', { name: item.file.name }));
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => moveItem(item.id, -1));

    const downBtn = document.createElement('button');
    downBtn.className = 'icon-btn';
    downBtn.type = 'button';
    downBtn.textContent = '↓';
    downBtn.setAttribute('aria-label', t('merge.js_move_down', 'Move {name} down', { name: item.file.name }));
    downBtn.disabled = index === items.length - 1;
    downBtn.addEventListener('click', () => moveItem(item.id, 1));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'icon-btn icon-btn-danger';
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', t('merge.js_remove', 'Remove {name}', { name: item.file.name }));
    removeBtn.addEventListener('click', () => removeItem(item.id));

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(removeBtn);
    li.appendChild(actions);

    fileListEl.appendChild(li);
  });
}

function moveItem(id, delta) {
  const index = items.findIndex((it) => it.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return;
  [items[index], items[target]] = [items[target], items[index]];
  renderList();
}

function removeItem(id) {
  items = items.filter((it) => it.id !== id);
  renderList();
}

async function addFiles(fileArray) {
  hideError();
  const pdfFiles = fileArray.filter((f) => looksLikePdfName(f));
  if (pdfFiles.length < fileArray.length) {
    showError(t('merge.js_err_skipped_non_pdf', 'Some selected files were skipped because they are not PDFs.'));
  }
  if (!pdfFiles.length) return;

  progressSection.hidden = false;
  const pdfLib = await ensurePdfLib((text) => setProgress(0, text));

  for (let i = 0; i < pdfFiles.length; i++) {
    const file = pdfFiles[i];
    setProgress(Math.round(((i + 1) / pdfFiles.length) * 100), t('merge.js_reading', 'Reading {name} ({i}/{n})', { name: file.name, i: i + 1, n: pdfFiles.length }));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!checkPdfMagicBytes(bytes)) {
        showError(t('merge.js_err_skipped_invalid', 'Skipped "{name}": doesn\'t look like a valid PDF.', { name: file.name }));
        continue;
      }
      const doc = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      items.push({ id: nextId++, file, bytes, pageCount: doc.getPageCount() });
    } catch (err) {
      showError(t('merge.js_err_read_file', 'Couldn\'t read "{name}": {message}.', { name: file.name, message: err?.message || t('merge.js_err_unknown', 'unknown error') }));
    }
  }

  progressSection.hidden = true;
  renderList();
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
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length) addFiles(files);
});
fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  if (files.length) addFiles(files);
  fileInput.value = '';
});

clearBtn.addEventListener('click', () => {
  items = [];
  hideError();
  renderList();
});

mergeBtn.addEventListener('click', async () => {
  if (items.length < 2) return;
  hideError();
  progressSection.hidden = false;
  mergeBtn.disabled = true;

  try {
    setProgress(0, t('common.js_loading_pdflib', 'Loading pdf-lib…'));
    const pdfLib = await ensurePdfLib((text) => setProgress(2, text));
    const mergedPdf = await pdfLib.PDFDocument.create();

    for (let i = 0; i < items.length; i++) {
      setProgress(Math.round(((i + 1) / items.length) * 90), t('merge.js_adding', 'Adding {name} ({i}/{n})', { name: items[i].file.name, i: i + 1, n: items.length }));
      const srcDoc = await pdfLib.PDFDocument.load(items[i].bytes, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    setProgress(95, t('common.js_saving', 'Saving…'));
    const mergedBytes = await mergedPdf.save();
    const blob = new Blob([mergedBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'merged.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    offerChain(mergedBytes, 'merged.pdf', [
      { slug: 'organize', label: 'Organize' },
      { slug: 'compress', label: 'Compress' },
      { slug: 'page-numbers', label: 'Add Page Numbers' },
      { slug: 'watermark', label: 'Add Watermark' },
    ]);

    setProgress(100, t('common.js_done', 'Done.'));
    setTimeout(() => {
      progressSection.hidden = true;
    }, 1200);
  } catch (err) {
    console.error(err);
    showError(err?.message || t('merge.js_err_merge', 'Something went wrong while merging.'));
    progressSection.hidden = true;
  } finally {
    mergeBtn.disabled = items.length < 2;
  }
});

takeChainedFile().then((file) => {
  if (file) addFiles([file]);
});
