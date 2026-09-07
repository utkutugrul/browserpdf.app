'use strict';

import { ensurePdfLib } from './lib-loader.js';
import { configureMergePdf, mergePdfFiles } from './core/merge-pdf.js';
import { setupMergeWebMcp } from './webmcp.js';
import {
  createTaskState,
  downloadBytes,
  formatBytes,
  looksLikePdfFile,
  checkPdfMagicBytes,
  offerChain,
  takeChainedFile,
  wireDropzone,
} from './tool-ui.js';
import { t } from './i18n.js';

const dropzone = document.getElementById('dropzone');
const mergeWorkspace = document.querySelector('.merge-workspace');
const fileInput = document.getElementById('fileInput');
const fileIconTpl = document.getElementById('fileIconTpl');
const fileListSection = document.getElementById('fileListSection');
const fileListEl = document.getElementById('fileList');
const fileListCount = document.getElementById('fileListCount');
const fileOrderStatus = document.getElementById('fileOrderStatus');
const mergeActionHint = document.getElementById('mergeActionHint');
const clearBtn = document.getElementById('clearBtn');
const mergeBtn = document.getElementById('mergeBtn');
const downloadAgainBtn = document.getElementById('downloadAgainBtn');
const progressSection = document.getElementById('progressSection');
const progressStatus = document.getElementById('progressStatus');
const progressTrack = document.getElementById('progressTrack');
const progressFill = document.getElementById('progressFill');
const successSection = document.getElementById('successSection');
const successText = document.getElementById('successText');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');

let items = [];
let nextId = 0;
let dragId = null;
let lastMergedBytes = null;
let mergeInProgress = false;
let mergeWebMcp = { refresh() {} };
let selectionGeneration = 0;
let activeMerge = null;
let pendingImports = 0;
let importEpoch = 0;
const activeImportBatches = new Set();

const taskState = createTaskState({
  errorSection,
  errorText,
  progressSection,
  progressStatus,
  progressTrack,
  progressFill,
  successSection,
});
const showError = (message) => taskState.showError(message);
const hideError = () => taskState.hideError();
const setProgress = (percent, text) => taskState.setProgress(percent, text);

function hideSuccess() {
  lastMergedBytes = null;
  taskState.hideSuccess();
}

function selectionWillChange() {
  selectionGeneration += 1;
  if (activeMerge && !activeMerge.controller.signal.aborted) {
    const operation = activeMerge;
    activeMerge = null;
    operation.controller.abort();
    taskState.hideProgress();
    fileOrderStatus.textContent = t(
      'merge.js_canceled_selection_changed',
      'Merge canceled because the selected files changed.',
    );
  }
  hideSuccess();
}

function renderList(focusTarget = null) {
  fileListEl.textContent = '';
  fileListSection.hidden = items.length === 0;
  fileListCount.textContent = items.length === 1
    ? t('merge.js_file_count_one', '{n} file', { n: items.length })
    : t('merge.js_file_count_other', '{n} files', { n: items.length });
  mergeBtn.disabled = items.length < 2 || mergeInProgress || pendingImports > 0;
  mergeWorkspace.setAttribute('aria-busy', String(pendingImports > 0));
  clearBtn.disabled = items.length === 0;
  mergeActionHint.hidden = items.length >= 2;

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.dataset.fileId = String(item.id);
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
      selectionWillChange();
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
    upBtn.dataset.action = 'up';
    upBtn.textContent = '↑';
    upBtn.setAttribute('aria-label', t('merge.js_move_up', 'Move {name} up', { name: item.file.name }));
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => moveItem(item.id, -1, 'up'));

    const downBtn = document.createElement('button');
    downBtn.className = 'icon-btn';
    downBtn.type = 'button';
    downBtn.dataset.action = 'down';
    downBtn.textContent = '↓';
    downBtn.setAttribute('aria-label', t('merge.js_move_down', 'Move {name} down', { name: item.file.name }));
    downBtn.disabled = index === items.length - 1;
    downBtn.addEventListener('click', () => moveItem(item.id, 1, 'down'));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'icon-btn icon-btn-danger';
    removeBtn.type = 'button';
    removeBtn.dataset.action = 'remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', t('merge.js_remove', 'Remove {name}', { name: item.file.name }));
    removeBtn.addEventListener('click', () => removeItem(item.id));

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(removeBtn);
    li.appendChild(actions);

    fileListEl.appendChild(li);
  });

  if (focusTarget) {
    const row = fileListEl.querySelector(`[data-file-id="${focusTarget.id}"]`);
    const preferred = row?.querySelector(`[data-action="${focusTarget.action}"]`);
    const alternateAction = focusTarget.action === 'up' ? 'down' : 'up';
    const alternate = row?.querySelector(`[data-action="${alternateAction}"]`);
    const target = preferred && !preferred.disabled ? preferred : alternate && !alternate.disabled ? alternate : row?.querySelector('[data-action="remove"]');
    target?.focus();
  }
  mergeWebMcp.refresh();
}

function moveItem(id, delta, action) {
  const index = items.findIndex((it) => it.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return;
  selectionWillChange();
  [items[index], items[target]] = [items[target], items[index]];
  const moved = items[target];
  renderList({ id, action });
  fileOrderStatus.textContent = t(
    'merge.js_order_changed',
    'Moved {name} to position {position} of {total}.',
    { name: moved.file.name, position: target + 1, total: items.length },
  );
}

function removeItem(id) {
  selectionWillChange();
  items = items.filter((it) => it.id !== id);
  renderList();
}

function selectedFilesForWebMcp() {
  return items.map((item) => ({
    id: item.id,
    name: item.file.name,
    size: item.file.size,
    pageCount: item.pageCount,
  }));
}

function selectionIsStable() {
  return pendingImports === 0 && !mergeInProgress;
}

function importBatchIsCurrent(batch) {
  return batch.epoch === importEpoch && !batch.controller.signal.aborted;
}

function invalidatePendingImports() {
  importEpoch += 1;
  activeImportBatches.forEach((batch) => batch.controller.abort());
}

function setFileOrder(order) {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (order.length !== items.length || order.some((id) => !byId.has(id))) {
    throw new RangeError('order must contain every currently selected file ID exactly once.');
  }
  selectionWillChange();
  items = order.map((id) => byId.get(id));
  renderList();
}

function removeSelectedFile(id) {
  if (!items.some((item) => item.id === id)) throw new RangeError('Unknown selected file ID.');
  removeItem(id);
}

async function addFiles(fileArray) {
  hideError();
  const pdfFiles = fileArray.filter((f) => looksLikePdfFile(f));
  if (pdfFiles.length < fileArray.length) {
    showError(t('merge.js_err_skipped_non_pdf', 'Some selected files were skipped because they are not PDFs.'));
  }
  if (!pdfFiles.length) return;
  const batch = { epoch: importEpoch, controller: new AbortController() };
  activeImportBatches.add(batch);
  pendingImports = activeImportBatches.size;
  selectionWillChange();
  renderList();

  try {
    progressSection.hidden = false;
    const pdfLib = await ensurePdfLib((text) => {
      if (importBatchIsCurrent(batch)) setProgress(0, text);
    });
    if (!importBatchIsCurrent(batch)) return;

    for (let i = 0; i < pdfFiles.length; i++) {
      if (!importBatchIsCurrent(batch)) break;
      const file = pdfFiles[i];
      setProgress(Math.round(((i + 1) / pdfFiles.length) * 100), t('merge.js_reading', 'Reading {name} ({i}/{n})', { name: file.name, i: i + 1, n: pdfFiles.length }));
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!importBatchIsCurrent(batch)) break;
        if (!checkPdfMagicBytes(bytes)) {
          showError(t('merge.js_err_skipped_invalid', 'Skipped "{name}": doesn\'t look like a valid PDF.', { name: file.name }));
          continue;
        }
        const doc = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        if (!importBatchIsCurrent(batch)) break;
        selectionWillChange();
        items.push({ id: nextId++, file, bytes, pageCount: doc.getPageCount() });
      } catch (err) {
        if (!importBatchIsCurrent(batch)) break;
        showError(t('merge.js_err_read_file', 'Couldn\'t read "{name}": {message}.', { name: file.name, message: err?.message || t('merge.js_err_unknown', 'unknown error') }));
      }
    }
  } finally {
    activeImportBatches.delete(batch);
    pendingImports = activeImportBatches.size;
    if (pendingImports === 0) progressSection.hidden = true;
    renderList();
  }
}

wireDropzone(dropzone, fileInput, addFiles);

clearBtn.addEventListener('click', () => {
  invalidatePendingImports();
  selectionWillChange();
  items = [];
  hideError();
  taskState.hideProgress();
  renderList();
});

async function mergeSelectedFiles({ signal, autoDownload = true } = {}) {
  if (items.length < 2) return;
  if (pendingImports > 0) throw new Error('Wait for selected files to finish loading before merging.');
  if (mergeInProgress) throw new Error('A merge is already in progress.');
  mergeInProgress = true;
  const operationController = new AbortController();
  const generation = selectionGeneration;
  const snapshot = items.map((item) => ({
    bytes: item.bytes,
    name: item.file.name,
    pageCount: item.pageCount,
  }));
  const snapshotPageCount = snapshot.reduce((total, item) => total + item.pageCount, 0);
  const forwardAbort = () => operationController.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  activeMerge = { controller: operationController, generation };
  hideError();
  hideSuccess();
  progressSection.hidden = false;
  mergeBtn.disabled = true;

  try {
    operationController.signal.throwIfAborted();
    setProgress(0, t('common.js_loading_pdflib', 'Loading pdf-lib…'));
    const pdfLib = await ensurePdfLib((text) => setProgress(2, text));
    configureMergePdf(pdfLib);
    operationController.signal.throwIfAborted();
    const mergedBytes = await mergePdfFiles(snapshot, {
      signal: operationController.signal,
      onProgress(event) {
        if (event.phase === 'adding') {
          setProgress(event.percent, t('merge.js_adding', 'Adding {name} ({i}/{n})', {
            name: event.fileName,
            i: event.fileIndex + 1,
            n: event.fileCount,
          }));
        } else if (event.phase === 'saving') {
          setProgress(event.percent, t('common.js_saving', 'Saving…'));
        }
      },
    });
    operationController.signal.throwIfAborted();
    if (selectionGeneration !== generation || activeMerge?.controller !== operationController) {
      const staleError = new Error('Selected files changed during merge.');
      staleError.name = 'AbortError';
      throw staleError;
    }
    lastMergedBytes = mergedBytes;
    if (autoDownload) downloadBytes(mergedBytes, 'merged.pdf');
    offerChain(mergedBytes, 'merged.pdf', [
      { slug: 'organize', label: 'Organize' },
      { slug: 'compress', label: 'Compress' },
      { slug: 'page-numbers', label: 'Add Page Numbers' },
      { slug: 'watermark', label: 'Add Watermark' },
    ]);

    setProgress(100, t('common.js_done', 'Done.'));
    taskState.hideProgress();
    successText.textContent = autoDownload
      ? t('merge.success', 'Merge complete. Your PDF has been downloaded.')
      : t('merge.result_title', 'Your merged PDF is ready');
    taskState.showSuccess();
    return {
      ready: true,
      fileName: 'merged.pdf',
      size: mergedBytes.length,
      pageCount: snapshotPageCount,
    };
  } catch (err) {
    if (activeMerge?.controller === operationController) taskState.hideProgress();
    if (err?.name !== 'AbortError') {
      showError(err?.message || t('merge.js_err_merge', 'Something went wrong while merging.'));
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', forwardAbort);
    if (activeMerge?.controller === operationController) activeMerge = null;
    mergeInProgress = false;
    renderList();
  }
}

mergeBtn.addEventListener('click', () => {
  mergeSelectedFiles({ autoDownload: true }).catch((err) => {
    if (err?.name !== 'AbortError') console.error(err);
  });
});

downloadAgainBtn.addEventListener('click', () => {
  if (lastMergedBytes) downloadBytes(lastMergedBytes, 'merged.pdf');
});

mergeWebMcp = setupMergeWebMcp({
  getSelectedFiles: selectedFilesForWebMcp,
  canMerge: selectionIsStable,
  setFileOrder,
  removeSelectedFile,
  mergeSelectedFiles,
});

takeChainedFile().then((file) => {
  if (file) addFiles([file]);
});
