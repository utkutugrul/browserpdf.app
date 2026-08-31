'use strict';

import { ensurePdfLib } from './lib-loader.js';
import { t } from './i18n.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBytes, formatBytes, offerChain,
} from './tool-ui.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const listSection = document.getElementById('fileListSection');
const listEl = document.getElementById('fileList');
const countEl = document.getElementById('fileCount');
const createBtn = document.getElementById('createBtn');
const clearBtn = document.getElementById('clearBtn');

let items = [];
let nextId = 1;

function render() {
  listEl.textContent = '';
  listSection.hidden = items.length === 0;
  countEl.textContent = items.length === 1
    ? t('images.js_image_count_one', '{n} image', { n: items.length })
    : t('images.js_image_count_many', '{n} images', { n: items.length });
  createBtn.disabled = items.length === 0;
  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'file-item';
    const info = document.createElement('div');
    info.className = 'file-item-info';
    const name = document.createElement('span');
    name.className = 'file-item-name';
    name.textContent = item.file.name;
    const meta = document.createElement('span');
    meta.className = 'file-item-meta';
    meta.textContent = formatBytes(item.file.size);
    info.appendChild(name);
    info.appendChild(meta);
    li.appendChild(info);
    const actions = document.createElement('div');
    actions.className = 'file-item-actions';
    const up = document.createElement('button');
    up.type = 'button'; up.className = 'icon-btn'; up.textContent = '↑';
    up.disabled = index === 0;
    up.setAttribute('aria-label', t('images.js_move_up', 'Move {name} up', { name: item.file.name }));
    up.addEventListener('click', () => move(item.id, -1));
    const down = document.createElement('button');
    down.type = 'button'; down.className = 'icon-btn'; down.textContent = '↓';
    down.disabled = index === items.length - 1;
    down.setAttribute('aria-label', t('images.js_move_down', 'Move {name} down', { name: item.file.name }));
    down.addEventListener('click', () => move(item.id, 1));
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'icon-btn icon-btn-danger'; rm.textContent = '×';
    rm.setAttribute('aria-label', t('images.js_remove', 'Remove {name}', { name: item.file.name }));
    rm.addEventListener('click', () => { items = items.filter((x) => x.id !== item.id); render(); });
    actions.appendChild(up); actions.appendChild(down); actions.appendChild(rm);
    li.appendChild(actions);
    listEl.appendChild(li);
  });
}

function move(id, d) {
  const i = items.findIndex((x) => x.id === id);
  const j = i + d;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  render();
}

function addFiles(files) {
  hideError();
  const imgs = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name));
  if (!imgs.length) {
    showError(t('jpg-to-pdf.js_err_not_images', 'Please select JPG or PNG images.'));
    return;
  }
  imgs.forEach((file) => items.push({ id: nextId++, file }));
  render();
}

async function toPngBytes(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error(t('images.js_err_decode', 'Could not decode "{name}"', { name: file.name })));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

createBtn.addEventListener('click', async () => {
  if (!items.length) return;
  hideError();
  createBtn.disabled = true;
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  try {
    const pdfLib = await ensurePdfLib((m) => setProgress(5, m));
    const outDoc = await pdfLib.PDFDocument.create();
    const targetLongEdge = 842;
    for (let i = 0; i < items.length; i++) {
      const { file } = items[i];
      setProgress(Math.round(((i + 1) / items.length) * 85), t('images.js_adding_image', 'Adding {name} ({i}/{n})', { name: file.name, i: i + 1, n: items.length }));
      let embedded;
      if (/jpe?g$/i.test(file.name) || file.type === 'image/jpeg') {
        embedded = await outDoc.embedJpg(new Uint8Array(await file.arrayBuffer()));
      } else if (/png$/i.test(file.name) || file.type === 'image/png') {
        embedded = await outDoc.embedPng(new Uint8Array(await file.arrayBuffer()));
      } else {
        embedded = await outDoc.embedPng(await toPngBytes(file));
      }
      const scale = targetLongEdge / Math.max(embedded.width, embedded.height);
      const page = outDoc.addPage([embedded.width * scale, embedded.height * scale]);
      page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    }
    setProgress(95, t('common.js_saving', 'Saving…'));
    const bytes = await outDoc.save();
    downloadBytes(bytes, 'images.pdf');
    offerChain(bytes, 'images.pdf', [
      { slug: 'compress', label: 'Compress' },
      { slug: 'merge', label: 'Merge' },
      { slug: 'protect', label: 'Protect' },
    ]);
    finishProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err?.message || t('images.js_err_create', 'Something went wrong while creating the PDF.'));
  } finally {
    createBtn.disabled = items.length === 0;
  }
});

clearBtn.addEventListener('click', () => { items = []; hideError(); render(); });
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
['dragenter','dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
['dragleave','drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
dropzone.addEventListener('drop', (e) => addFiles(Array.from(e.dataTransfer.files || [])));
fileInput.addEventListener('change', () => { addFiles(Array.from(fileInput.files || [])); fileInput.value = ''; });
