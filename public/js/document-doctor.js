'use strict';

import { t } from './i18n.js';
import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import {
  checkPdfMagicBytes, createTaskState, downloadBytes, formatBytes, looksLikePdfFile, wireDropzone,
} from './tool-ui.js';
import { setupDocumentDoctorWebMcp } from './webmcp.js';

const MAX_FILE_BYTES = 250 * 1000 * 1000;
const FEATURE_LABELS = Object.freeze({
  standardMetadata: 'Standard metadata fields', xmp: 'XMP metadata', catalogAttachments: 'Catalog attachments',
  pageAttachments: 'Page attachments', annotations: 'Annotations', linksAndActions: 'Links and actions',
  documentJavaScript: 'Document JavaScript actions', pageJavaScript: 'Page JavaScript actions', forms: 'Form fields',
  calculationOrder: 'Calculation-order entries', signatureFields: 'Signature fields', permissions: 'Permission entries',
});

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const workspace = document.querySelector('.doctor-workspace');
const selectedFile = document.getElementById('selectedFile');
const selectedFileName = document.getElementById('selectedFileName');
const selectedFileSize = document.getElementById('selectedFileSize');
const modeInputs = [...document.querySelectorAll('input[name="doctorMode"]')];
const diagnoseBtn = document.getElementById('diagnoseBtn');
const clearBtn = document.getElementById('clearBtn');
const doctorResults = document.getElementById('doctorResults');
const doctorSummary = document.getElementById('doctorSummary');
const doctorFindingList = document.getElementById('doctorFindingList');
const signatureWarning = document.getElementById('signatureWarning');
const doctorActions = document.getElementById('doctorActions');
const normalizeBtn = document.getElementById('normalizeBtn');
const rebuildBtn = document.getElementById('rebuildBtn');
const successText = document.getElementById('successText');
const lossManifest = document.getElementById('lossManifest');
const downloadBtn = document.getElementById('downloadBtn');
const state = createTaskState();

let selection = null;
let report = null;
let output = null;
let generation = 0;
let active = null;
let importing = false;
let doctorCorePromise;
let doctorOutputPromise;

function loadDoctorCore() {
  doctorCorePromise ||= import('./core/document-doctor.js');
  return doctorCorePromise;
}

function loadDoctorOutput() {
  doctorOutputPromise ||= import('./core/document-doctor-output.js');
  return doctorOutputPromise;
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

function canNormalize() { return Boolean(report?.parses?.pdfLibTolerant?.ok && !report?.features?.locked); }
function canRebuild() { return Boolean(report?.parses?.pdfjsStrict?.ok && !report?.features?.locked); }

function setBusy(busy) {
  workspace.setAttribute('aria-busy', String(busy));
  for (const input of modeInputs) input.disabled = busy;
  diagnoseBtn.disabled = busy || !selection;
  clearBtn.disabled = !selection && !importing;
  normalizeBtn.disabled = busy || !canNormalize();
  rebuildBtn.disabled = busy || !canRebuild();
}

function scheduleToolRefresh() { queueMicrotask(() => webmcp.refresh()); }

function resetOutput() {
  report = null; output = null;
  doctorResults.hidden = true; doctorActions.hidden = true;
  state.hideSuccess();
}

function invalidate() {
  generation++;
  active?.abort();
  active = null;
  workspace.setAttribute('aria-busy', 'false');
}

function appendFinding(label, value) {
  const item = document.createElement('li');
  const name = document.createElement('span'); name.textContent = label;
  const count = document.createElement('strong'); count.textContent = String(value);
  item.append(name, count); doctorFindingList.appendChild(item);
}

function renderReport(value, summarizeDoctorReport) {
  const summary = summarizeDoctorReport(value);
  doctorSummary.textContent = t('doctor.summary', '{pages} pages checked in {mode} mode; {warnings} warnings.', {
    pages: summary.pageCount, mode: summary.mode, warnings: summary.warningCount,
  });
  doctorFindingList.textContent = '';
  appendFinding(t('doctor.strict_parse', 'Strict pdf-lib parse'), summary.parses.pdfLibStrict ? t('doctor.pass', 'Passed') : t('doctor.not_confirmed', 'Not confirmed'));
  appendFinding(t('doctor.tolerant_parse', 'Tolerant pdf-lib parse'), summary.parses.pdfLibTolerant ? t('doctor.pass', 'Passed') : t('doctor.not_confirmed', 'Not confirmed'));
  appendFinding(t('doctor.pdfjs_parse', 'Strict PDF.js load'), summary.parses.pdfjsStrict ? t('doctor.pass', 'Passed') : t('doctor.not_confirmed', 'Not confirmed'));
  appendFinding(t('doctor.page_boxes', 'Page-box issues'), summary.pageBoxIssues);
  for (const [key, count] of Object.entries(summary.features)) {
    if (typeof count === 'number' && count > 0 && FEATURE_LABELS[key]) {
      appendFinding(t(`doctor.feature_${key}`, FEATURE_LABELS[key]), count);
    }
  }
  if (summary.features.encrypted) appendFinding(t('doctor.encrypted', 'Encryption detected'), t('doctor.yes', 'Yes'));
  appendFinding(t('doctor.structure_tree', 'Structure tree present'), summary.readiness.structureTreePresent ? t('doctor.yes', 'Yes') : t('doctor.no', 'No'));
  appendFinding(t('doctor.mark_info', 'MarkInfo marked'), summary.readiness.markInfoMarked ? t('doctor.yes', 'Yes') : t('doctor.no', 'No'));
  appendFinding(t('doctor.language', 'Document language present'), summary.readiness.languagePresent ? t('doctor.yes', 'Yes') : t('doctor.no', 'No'));
  appendFinding(t('doctor.title', 'Document title present'), summary.readiness.titlePresent ? t('doctor.yes', 'Yes') : t('doctor.no', 'No'));
  appendFinding(t('doctor.alt_missing', 'Detected figures missing alternative text'), summary.readiness.figuresMissingAlt);
  if (summary.readiness.graphTruncated) {
    appendFinding(t('doctor.graph_truncated', 'Structure-tree traversal incomplete at the 1,000-object bound'), t('doctor.yes', 'Yes'));
  }
  if (summary.inspectionErrors.count) {
    appendFinding(t('doctor.inspection_errors', 'Inspection categories not confirmed'), summary.inspectionErrors.categories.length);
  }
  if (summary.deep.performed) {
    appendFinding(t('doctor.deep_pages', 'Pages deeply checked'), summary.deep.pagesChecked);
    appendFinding(t('doctor.deep_errors', 'Operator, text, or render errors'), summary.deep.operatorErrors + summary.deep.textErrors + summary.deep.renderErrors);
  }
  signatureWarning.hidden = !value.features.signatureFields;
  doctorResults.hidden = false;
  doctorActions.hidden = value.features.locked;
  setBusy(false);
  scheduleToolRefresh();
}

function selectedMode() { return modeInputs.find((input) => input.checked)?.value === 'deep' ? 'deep' : 'quick'; }

async function runtimes() {
  return Promise.all([
    ensurePdfLib((message) => state.setProgress(2, message)),
    ensurePdfJs((message) => state.setProgress(3, message)),
  ]);
}

async function runDiagnosis({ mode = selectedMode(), signal: externalSignal } = {}) {
  if (!selection) throw new Error('Select a PDF first.');
  if (active || importing) throw new DOMException('Another document operation is active.', 'InvalidStateError');
  const runGeneration = generation;
  const snapshot = { ...selection, bytes: Uint8Array.from(selection.bytes) };
  const controller = new AbortController(); active = controller;
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  setBusy(true); state.hideError(); state.hideSuccess(); output = null;
  state.showProgress(t('doctor.loading', 'Loading verified diagnostic runtimes…'));
  try {
    const [[pdfLib, pdfjs], { diagnosePdf, summarizeDoctorReport }] = await Promise.all([
      runtimes(), loadDoctorCore(),
    ]);
    controller.signal.throwIfAborted();
    const value = await diagnosePdf(snapshot.bytes, {
      mode, pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, createCanvas, signal: controller.signal,
      onProgress: ({ page, pageCount }) => state.setProgress(10 + (page / pageCount) * 85,
        t('doctor.checking_page', 'Checking page {page} of {pages}…', { page, pages: pageCount })),
    });
    if (controller.signal.aborted || runGeneration !== generation || active !== controller) {
      throw new DOMException('Diagnosis cancelled.', 'AbortError');
    }
    active = null;
    report = value;
    renderReport(value, summarizeDoctorReport);
    state.setProgress(100, t('common.js_done', 'Done.'));
    state.hideProgress();
    return summarizeDoctorReport(value);
  } finally {
    externalSignal?.removeEventListener('abort', forwardAbort);
    if (active === controller) {
      active = null; state.hideProgress(); setBusy(false);
    }
  }
}

function outputName(name, kind) {
  return name.replace(/\.pdf$/i, '') + (kind === 'normalize' ? '-normalized.pdf' : '-rebuilt-pages.pdf');
}

async function runTransform(kind, { signal: externalSignal } = {}) {
  if (!selection || !report) throw new DOMException('Run a diagnosis first.', 'InvalidStateError');
  if (active || importing) throw new DOMException('Another document operation is active.', 'InvalidStateError');
  if (kind === 'normalize' ? !canNormalize() : !canRebuild()) throw new DOMException('This output is unavailable for the current diagnosis.', 'InvalidStateError');
  const runGeneration = generation;
  const snapshot = { ...selection, bytes: Uint8Array.from(selection.bytes) };
  const controller = new AbortController(); active = controller;
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  setBusy(true); state.hideError(); state.hideSuccess(); output = null;
  state.showProgress(t('doctor.transforming', 'Creating and verifying a new copy…'));
  try {
    const [[pdfLib, pdfjs], transforms] = await Promise.all([runtimes(), loadDoctorOutput()]);
    controller.signal.throwIfAborted();
    const transform = kind === 'normalize' ? transforms.normalizePdfStructure : transforms.rebuildPdfPageContent;
    const result = await transform(snapshot.bytes, {
      pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, createCanvas, signal: controller.signal,
      onProgress: ({ phase, page, pageCount }) => state.setProgress(
        phase === 'verify' ? 85 : pageCount ? 10 + (page / pageCount) * 70 : 35,
        t('doctor.transforming', 'Creating and verifying a new copy…'),
      ),
    });
    if (controller.signal.aborted || runGeneration !== generation || active !== controller) {
      throw new DOMException('Output cancelled.', 'AbortError');
    }
    active = null;
    const name = outputName(snapshot.name, kind);
    output = { bytes: Uint8Array.from(result.bytes), name, result };
    lossManifest.textContent = '';
    for (const entry of [...(result.lossManifest.changes || []), ...(result.lossManifest.losses || []), ...(result.lossManifest.risks || [])]) {
      const item = document.createElement('li'); item.textContent = entry; lossManifest.appendChild(item);
    }
    successText.textContent = t('doctor.verified', 'The new copy reopened in strict pdf-lib and PDF.js checks and representative pages rendered. Download starts only when you choose it.');
    state.showSuccess(); state.setProgress(100, t('common.js_done', 'Done.')); state.hideProgress(); setBusy(false);
    scheduleToolRefresh();
    return {
      ready: true, name, size: result.bytes.length, pageCount: result.diagnosis.pageCount,
      verified: Boolean(result.verification.pdfLibStrict && result.verification.pdfjsStrict),
      lossItemCount: lossManifest.children.length,
    };
  } finally {
    externalSignal?.removeEventListener('abort', forwardAbort);
    if (active === controller) { active = null; state.hideProgress(); setBusy(false); }
  }
}

async function addFile(files) {
  invalidate(); resetOutput(); state.hideError(); scheduleToolRefresh();
  const file = files[0];
  if (!file) return;
  const importGeneration = generation;
  selection = null; selectedFile.hidden = true; importing = true; setBusy(true);
  try {
    if (!looksLikePdfFile(file)) {
      if (generation === importGeneration) state.showError(t('common.js_err_not_pdf', 'Please select a PDF file.'));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      if (generation === importGeneration) state.showError(t('doctor.too_large', 'Choose a PDF smaller than 250 MB.'));
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (generation !== importGeneration) return;
    if (!checkPdfMagicBytes(bytes)) { state.showError(t('common.js_err_invalid_pdf', 'This file does not look like a valid PDF.')); return; }
    selection = { name: file.name.slice(0, 160), size: file.size, bytes: Uint8Array.from(bytes) };
    selectedFileName.textContent = selection.name; selectedFileSize.textContent = formatBytes(selection.size);
    selectedFile.hidden = false; scheduleToolRefresh();
  } catch {
    if (generation === importGeneration) state.showError(t('doctor.read_failed', 'The PDF could not be read.'));
  } finally {
    if (generation === importGeneration) { importing = false; setBusy(false); }
  }
}

function clearSelection() {
  invalidate(); importing = false; selection = null; selectedFile.hidden = true; resetOutput();
  state.hideError(); state.hideProgress(); setBusy(false); scheduleToolRefresh();
}

diagnoseBtn.addEventListener('click', () => runDiagnosis().catch((error) => {
  if (error.name !== 'AbortError') state.showError(t('doctor.diagnose_failed', 'The PDF could not be diagnosed.'));
}));
normalizeBtn.addEventListener('click', () => runTransform('normalize').catch((error) => {
  if (error.name !== 'AbortError') state.showError(t('doctor.transform_failed', 'The new copy could not be verified, so download remains unavailable.'));
}));
rebuildBtn.addEventListener('click', () => runTransform('rebuild').catch((error) => {
  if (error.name !== 'AbortError') state.showError(t('doctor.transform_failed', 'The new copy could not be verified, so download remains unavailable.'));
}));
clearBtn.addEventListener('click', clearSelection);
downloadBtn.addEventListener('click', () => { if (output) downloadBytes(output.bytes, output.name); });
wireDropzone(dropzone, fileInput, addFile);

const webmcp = setupDocumentDoctorWebMcp({
  getSelectedFile: () => selection ? { name: selection.name, size: selection.size } : null,
  getState: () => ({ canNormalize: canNormalize(), canRebuild: canRebuild() }),
  diagnose: ({ mode, signal }) => runDiagnosis({ mode, signal }),
  normalize: ({ signal }) => runTransform('normalize', { signal }),
  rebuild: ({ signal }) => runTransform('rebuild', { signal }),
});
