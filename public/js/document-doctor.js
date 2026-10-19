'use strict';

import { t } from './i18n.js';
import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import {
  checkPdfMagicBytes, createTaskState, downloadBlob, formatBytes, looksLikePdfFile, wireDropzone, ensureDocumentSession, documentSession,
} from './tool-ui.js';
import { setupDocumentDoctorWebMcp } from './webmcp.js';

const MAX_FILE_BYTES = 32 * 1024 * 1024;
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
let active = false;
let contextPromise, contextRef, scheduledTicket = 0, cleanupFailed = false, cleanupBlocked = false;
const recipients = new Map();
let importing = false;
let doctorCorePromise;
let doctorOutputPromise;

function loadDoctorCore() {
  doctorCorePromise ||= import('./core/document-doctor.js').catch(error => { doctorCorePromise = null; throw error; });
  return doctorCorePromise;
}

function loadDoctorOutput() {
  doctorOutputPromise ||= import('./core/document-doctor-output.js').catch(error => { doctorOutputPromise = null; throw error; });
  return doctorOutputPromise;
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

function canNormalize() { return Boolean((report?.parses?.pdfLibStrict?.ok || report?.parses?.pdfLibTolerant?.ok) && !report?.features?.encrypted && !report?.features?.locked); }
function canRebuild() { return false; }

function setBusy(busy) {
  workspace.setAttribute('aria-busy', String(busy));
  for (const input of modeInputs) input.disabled = busy;
  diagnoseBtn.disabled = busy || !selection;
  clearBtn.disabled = !selection && !importing && !cleanupBlocked;
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
  generation++; contextRef?.cancel();
  active = false; workspace.setAttribute('aria-busy', 'false'); return generation;
}
const usageKeys = ['resourceBytes', 'resourceCount', 'artifactBytes', 'expandedBytes', 'expandedCount'];
function liveUsage() { return Object.fromEntries(usageKeys.map(key => [key, [...recipients.values()].reduce((sum, value) => sum + (value[key] || 0), 0)])); }
async function operationContext() {
  contextPromise ||= Promise.all([ensureDocumentSession(), loadDoctorCore(), import('./core/doctor-policy.js')]).then(([_session, core, policy]) => (contextRef = core.createDoctorOperationContext({
    expectedOwner: documentSession.snapshot(), isCurrent: () => scheduledTicket === generation,
    getUsage: () => ({ snapshot: documentSession.snapshot(), live: liveUsage() }),
    admitUsage: next => policy.assertDoctorBudget(documentSession.snapshot(), liveUsage(), next),
    registerResult: (value, next) => { policy.assertDoctorBudget(documentSession.snapshot(), liveUsage(), next); recipients.set(value, next); },
  }))).catch(error => { contextPromise = null; throw error; });
  return contextPromise;
}
async function prune(context) {
  await context.drained();
  const kept = new Set([selection, report, output?.result, ...(output?.downloads || [])]);
  for (const value of recipients.keys()) if (!kept.has(value)) recipients.delete(value);
}
function owned(ticket) { if (ticket !== generation) throw new DOMException('Doctor selection changed.', 'AbortError'); }
function showFailure(error, fallback) {
  if (error?.name === 'AbortError') return;
  const fenced = error?.code === 'DOCTOR_CLEANUP' || error?.code === 'DOCTOR_TIMEOUT';
  if (fenced) { cleanupBlocked = true; clearBtn.disabled = false; }
  state.showError(fenced ? t('doctor.cleanup_pending', 'Work is still fenced. Clear again to retry acknowledged cleanup; unresolved work may require reloading this page.') : fallback);
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
  const observed = (key, value) => ['complete', 'partial'].includes(summary.inspection.checks[key].status) ? value : t('doctor.not_confirmed', 'Not confirmed');
  appendFinding(t('doctor.coverage_status', 'Inspection coverage'), summary.inspection.status);
  appendFinding(t('doctor.page_boxes', 'Page-box issues'), observed('boxes', summary.pageBoxIssues));
  for (const [key, count] of Object.entries(summary.features)) {
    if (typeof count === 'number' && count > 0 && FEATURE_LABELS[key]) {
      appendFinding(t(`doctor.feature_${key}`, FEATURE_LABELS[key]), count);
    }
  }
  if (summary.features.encrypted) appendFinding(t('doctor.encrypted', 'Encryption detected'), t('doctor.yes', 'Yes'));
  appendFinding(t('doctor.structure_tree', 'Structure tree present'), observed('tags', summary.readiness.structureTreePresent ? t('doctor.yes', 'Yes') : t('doctor.no', 'No')));
  appendFinding(t('doctor.mark_info', 'MarkInfo marked'), observed('tags', summary.readiness.markInfoMarked ? t('doctor.yes', 'Yes') : t('doctor.no', 'No')));
  appendFinding(t('doctor.language', 'Document language present'), observed('language', summary.readiness.languagePresent ? t('doctor.yes', 'Yes') : t('doctor.no', 'No')));
  appendFinding(t('doctor.title', 'Document title present'), observed('title', summary.readiness.titlePresent ? t('doctor.yes', 'Yes') : t('doctor.no', 'No')));
  appendFinding(t('doctor.alt_missing', 'Detected figures missing alternative text'), observed('alt', summary.readiness.figuresMissingAlt));
  if (summary.readiness.graphTruncated) {
    appendFinding(t('doctor.graph_bounded', 'Structure-tree inspection is incomplete at its work bound'), t('doctor.yes', 'Yes'));
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

async function runDiagnosis({ mode = selectedMode(), signal } = {}) {
  if (!selection) throw new DOMException('Select a valid PDF first.', 'InvalidStateError');
  if (active || importing) throw new DOMException('Another Doctor operation is active.', 'InvalidStateError');
  const ticket = generation, source = selection; scheduledTicket = ticket; active = true; setBusy(true); state.hideError();
  try {
    const context = await operationContext();
    await prune(context); owned(ticket);
    const [[pdfLib, pdfjs], core] = await Promise.all([runtimes(), loadDoctorCore()]); owned(ticket);
    const value = await context.run(async (_job, api) => {
      const result = await core.diagnoseDoctorWithin(source.bytes, { mode, pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, createCanvas,
        onProgress: ({ page, pageCount }) => { api.guard(); state.setProgress(10 + page / pageCount * 85, t('doctor.checking_page', 'Checking page {page} of {pages}…', { page, pages: pageCount })); },
      }, api);
      api.registerResult(result, { expandedBytes: 2304000, expandedCount: 2 }); return result;
    }, { expectedOwner: documentSession.snapshot(), signal, isCurrent: () => ticket === generation });
    owned(ticket); report = value; output = null; renderReport(value, core.summarizeDoctorReport); await prune(context); return core.summarizeDoctorReport(value);
  } finally { if (ticket === generation) { active = false; state.hideProgress(); setBusy(false); } }
}
function outputName(name) { return name.replace(/\.pdf$/i, '') + '-normalized.pdf'; }
async function runTransform(kind, { signal } = {}) {
  if (kind !== 'normalize') throw new DOMException('Page rebuilding is held until a separate loss review.', 'InvalidStateError');
  if (!selection || !canNormalize() || active || importing) throw new DOMException('Run a complete supported diagnosis first.', 'InvalidStateError');
  const ticket = generation, source = selection; scheduledTicket = ticket; active = true; setBusy(true); state.hideError();
  try {
    const context = await operationContext();
    await prune(context); owned(ticket);
    const [[pdfLib, pdfjs], transforms] = await Promise.all([runtimes(), loadDoctorOutput()]); owned(ticket);
    const result = await context.run((_job, api) => transforms.normalizeDoctorWithin(source.bytes, {
      pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, createCanvas,
      onProgress: () => { api.guard(); state.setProgress(50, t('doctor.transforming', 'Creating and verifying a new copy…')); },
    }, api), { expectedOwner: documentSession.snapshot(), signal, isCurrent: () => ticket === generation });
    owned(ticket); output = { bytes: result.bytes, name: outputName(source.name), result, downloads: [] };
    lossManifest.replaceChildren();
    for (const entry of [...result.lossManifest.changes, ...result.lossManifest.losses, ...result.lossManifest.risks]) { const li = document.createElement('li'); li.textContent = entry; lossManifest.appendChild(li); }
    successText.textContent = t('doctor.geometry_verified', 'The new copy passed strict page-count, physical-size and selected-page render checks. Download starts only when you choose it.');
    state.showSuccess(); await prune(context); scheduleToolRefresh();
    return { ready: true, name: output.name, size: result.bytes.length, pageCount: result.diagnosis.pageCount, verified: true, lossItemCount: lossManifest.children.length };
  } finally { if (ticket === generation) { active = false; state.hideProgress(); setBusy(false); } }
}
async function addFile(files) {
  const file = files[0]; if (!file) return;
  const ticket = invalidate(); scheduledTicket = ticket; importing = true; setBusy(true); state.hideError();
  let context;
  try {
    context = await operationContext(); owned(ticket);
    const value = await context.run(async (_job, api) => {
      if (!looksLikePdfFile(file) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) throw new RangeError('Choose a PDF no larger than 32 MiB.');
      const key = Symbol('File read'); api.reserve(key, { artifactBytes: file.size }, file);
      const backing = await api.first(() => file.arrayBuffer()); api.hold(key, backing, { artifactBytes: backing.byteLength });
      if (backing.byteLength !== file.size || backing.byteLength > MAX_FILE_BYTES) throw new RangeError('The PDF exceeds 32 MiB or changed length.');
      const bytes = new Uint8Array(backing); if (!checkPdfMagicBytes(bytes)) throw new TypeError('Invalid PDF header.');
      const [[pdfLib, pdfjs], core] = await Promise.all([runtimes(), loadDoctorCore()]); api.guard();
      const validated = await core.diagnoseDoctorWithin(bytes, { mode: 'quick', pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS }, api);
      if (!validated.parses.pdfLibStrict.ok || !validated.parses.pdfjsStrict.ok || !validated.pageTree.consistent || validated.features.encrypted) throw new TypeError('This browser intake accepts only supported unlocked valid PDFs.');
      const candidate = { bytes, name: file.name.slice(0, 160), size: bytes.length };
      api.registerResult(candidate, { artifactBytes: backing.byteLength }); return candidate;
    }, { expectedOwner: documentSession.snapshot(), isCurrent: () => ticket === generation });
    owned(ticket); selection = value; resetOutput(); selectedFileName.textContent = selection.name; selectedFileSize.textContent = formatBytes(selection.size); selectedFile.hidden = false;
    await prune(context); scheduleToolRefresh();
  } catch (error) {
    if (ticket === generation) showFailure(error, t('doctor.input_limit32', 'Choose a supported unlocked PDF no larger than 32 MiB. Your previous document remains available.'));
  } finally { if (ticket === generation) { importing = false; setBusy(false); } }
}
async function clearSelection() {
  const ticket = invalidate(); scheduledTicket = ticket; importing = false; setBusy(true);
  try {
    const context = await operationContext(); context.cancel(); await context.drained({ retry: cleanupFailed }); owned(ticket);
    recipients.clear(); selection = report = output = null; cleanupFailed = cleanupBlocked = false; selectedFile.hidden = true; resetOutput(); state.hideError(); state.hideProgress();
  } catch (error) { cleanupFailed = true; if (ticket === generation) showFailure(error, t('doctor.cleanup_retry', 'Cleanup is still pending. Choose Clear again to retry, or reload if it cannot finish.')); }
  finally { if (ticket === generation) { setBusy(false); scheduleToolRefresh(); } }
}
diagnoseBtn.addEventListener('click', () => runDiagnosis().catch(error => showFailure(error, t('doctor.diagnose_failed', 'The PDF could not be diagnosed.'))));
normalizeBtn.addEventListener('click', () => runTransform('normalize').catch(error => showFailure(error, t('doctor.transform_failed', 'The new copy could not be verified, so download remains unavailable.'))));
rebuildBtn.textContent = t('doctor.rebuild_held', 'Rebuild pages: loss review required'); rebuildBtn.disabled = true;
clearBtn.addEventListener('click', () => { void clearSelection(); });
downloadBtn.addEventListener('click', () => {
  if (!output || active || importing) return;
  const chosen = output, ticket = generation; scheduledTicket = ticket; active = true; setBusy(true);
  void operationContext().then(context => context.run(async (_job, api) => {
    owned(ticket); const key = Symbol('download Blob'); api.reserve(key, { artifactBytes: chosen.bytes.length });
    const blob = new Blob([chosen.bytes], { type: 'application/pdf' }); api.hold(key, blob, { artifactBytes: blob.size });
    api.registerResult(blob, { artifactBytes: blob.size }); chosen.downloads.push(blob); api.guard(); downloadBlob(blob, chosen.name, { download: true }); return null;
  }, { expectedOwner: documentSession.snapshot(), isCurrent: () => ticket === generation })).catch(error => showFailure(error, t('doctor.download_failed', 'Download could not be prepared.'))).finally(() => { if (ticket === generation) { active = false; setBusy(false); } });
});
wireDropzone(dropzone, fileInput, addFile);
const webmcp = setupDocumentDoctorWebMcp({ getSelectedFile: () => selection ? { name: selection.name, size: selection.size } : null,
  getState: () => ({ canNormalize: canNormalize(), canRebuild: false }), diagnose: ({ mode, signal }) => runDiagnosis({ mode, signal }), normalize: ({ signal }) => runTransform('normalize', { signal }), rebuild: () => runTransform('rebuild'),
});
