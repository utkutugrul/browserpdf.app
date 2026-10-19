'use strict';

import { t } from './i18n.js';
import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { createTaskState, documentSession, downloadBytes, formatBytes, showDocumentIdentity, takeChainedFile, wireDropzone } from './tool-ui.js';
import { scanPdfPrivacy, summarizePrivacyReport } from './core/privacy-scan.js';
import { setupPrivacyScanWebMcp } from './webmcp.js';

const CATEGORY_LABELS = Object.freeze({
  standardMetadata: 'Standard document metadata', xmp: 'XMP metadata',
  catalogAttachments: 'Catalog attachments', pageAttachments: 'Page attachments',
  annotations: 'Annotations', linksAndActions: 'Links and actions',
  documentJavaScript: 'Document JavaScript actions', pageJavaScript: 'Page JavaScript actions',
  forms: 'Form fields', calculationOrder: 'Form calculation order', signatureFields: 'Signature fields',
  invisibleTextOperations: 'Detectable invisible-text operations', sensitivePatterns: 'Sensitive text patterns',
});

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const workspace = document.querySelector('.privacy-scan-workspace');
const selectedFile = document.getElementById('selectedFile');
const selectedFileName = document.getElementById('selectedFileName');
const selectedFileSize = document.getElementById('selectedFileSize');
const scanBtn = document.getElementById('scanBtn');
const clearBtn = document.getElementById('clearBtn');
const scanResults = document.getElementById('scanResults');
const resultSummary = document.getElementById('resultSummary');
const findingList = document.getElementById('findingList');
const sensitiveDetails = document.getElementById('sensitiveDetails');
const sensitiveMatches = document.getElementById('sensitiveMatches');
const cleanupPanel = document.getElementById('cleanupPanel');
const metadataCleanup = document.getElementById('metadataCleanup');
const cleanupBtn = document.getElementById('cleanupBtn');
const signatureWarning = document.getElementById('signatureWarning');
const successText = document.getElementById('successText');
const lossManifest = document.getElementById('lossManifest');
const downloadBtn = document.getElementById('downloadBtn');
const state = createTaskState();

let selection = null;
let report = null;
let cleaned = null;
let generation = 0;
let active = null;
let importing = false;
let localIntent = 0, intakeController, intakePromise, intakeAttempt = 0, initialPending = false;
let cleanupPromise, cleanupAttempt = 0;
const getCleanup = () => cleanupPromise ||= import(cleanupAttempt ? `./core/privacy-cleanup.js?retry=${cleanupAttempt}` : './core/privacy-cleanup.js')
  .catch((error) => { cleanupPromise = null; cleanupAttempt++; throw error; });
const getIntake = () => intakePromise ||= import(intakeAttempt ? `./privacy-scan-intake.js?retry=${intakeAttempt}` : './privacy-scan-intake.js')
  .then((module) => module.createPrivacyIntake()).catch((error) => { intakePromise = null; intakeAttempt++; throw error; });
const ownsSelection = (value = selection) => {
  const now = documentSession.snapshot(), owner = value?.owner;
  return !!owner && now.taskId === owner.taskId && now.revision === owner.revision && now.generation === owner.generation;
};

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

function invalidate() {
  generation++;
  active?.abort();
  active = null;
  intakeController?.abort(); intakeController = null;
  initialPending = false;
  state.hideProgress();
  workspace.setAttribute('aria-busy', 'false');
}

function setBusy(busy) {
  workspace.setAttribute('aria-busy', String(busy));
  scanBtn.disabled = busy || !ownsSelection();
  clearBtn.disabled = !selection && !importing && !initialPending;
  downloadBtn.disabled = busy || !cleaned || !ownsSelection(cleaned);
  metadataCleanup.disabled = busy || !ownsSelection() || !report?.standardMetadata?.count;
  cleanupBtn.disabled = busy || !ownsSelection() || !metadataCleanup.checked || !report?.standardMetadata?.count;
}

function resetOutput() {
  report = null; cleaned = null;
  scanResults.hidden = true; cleanupPanel.hidden = true; state.hideSuccess();
  sensitiveDetails.hidden = true; sensitiveDetails.open = false;
}

function renderReport(value) {
  const summary = summarizePrivacyReport(value);
  const entries = Object.entries(summary.counts).filter(([, count]) => count > 0);
  resultSummary.textContent = entries.length
    ? t('privacy_scan.summary', '{n} detectable finding categories across {pages} pages.', { n: entries.length, pages: summary.pageCount })
    : t('privacy_scan.no_findings', 'No findings in this bounded scan. This does not prove the PDF is privacy-safe.');
  findingList.textContent = '';
  for (const [id, count] of entries) {
    const item = document.createElement('li');
    const label = t(`privacy_scan.category_${id}`, CATEGORY_LABELS[id]);
    const name = document.createElement('span'); name.textContent = label;
    const value = document.createElement('strong'); value.textContent = String(count);
    item.append(name, value);
    findingList.appendChild(item);
  }
  sensitiveMatches.textContent = '';
  for (const finding of value.sensitiveText.findings) {
    const item = document.createElement('li');
    item.textContent = `${t(`privacy_scan.sensitive_${finding.category}`, finding.label)}, ${t('privacy_scan.page', 'page')} ${finding.page}: ${finding.match}`;
    sensitiveMatches.appendChild(item);
  }
  sensitiveDetails.hidden = value.sensitiveText.findings.length === 0;
  signatureWarning.hidden = value.forms.signatureFields === 0;
  scanResults.hidden = false;
  cleanupPanel.hidden = value.encryption.locked;
  metadataCleanup.checked = false;
  setBusy(false);
}

async function runScan({ signal: externalSignal } = {}) {
  if (!selection) throw new Error('Select a PDF first.');
  if (active || importing) throw new DOMException('Another document operation is active.', 'InvalidStateError');
  if (!ownsSelection()) throw new DOMException('The selected document changed. Select a PDF again.', 'AbortError');
  const runGeneration = generation;
  const snapshot = { ...selection, bytes: Uint8Array.from(selection.bytes) };
  const controller = new AbortController();
  active = controller;
  const owns = () => active === controller && runGeneration === generation && !controller.signal.aborted && ownsSelection(snapshot);
  const check = () => { if (!owns()) throw new DOMException('Scan cancelled or replaced.', 'AbortError'); };
  const abort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) abort();
  setBusy(true); state.hideError(); state.hideSuccess();
  state.showProgress(t('privacy_scan.loading', 'Loading verified inspection runtime…'));
  try {
    const pdfjs = await ensurePdfJs((message) => { if (owns()) state.setProgress(2, message); });
    check();
    const value = await scanPdfPrivacy(snapshot.bytes, {
      pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, signal: controller.signal,
      onProgress: ({ page, pageCount }) => { if (owns()) state.setProgress(5 + (page / pageCount) * 90, t('privacy_scan.scanning_page', 'Inspecting page {page} of {pages}…', { page, pages: pageCount })); },
    });
    check();
    active = null;
    report = value; cleaned = null; renderReport(value);
    state.setProgress(100, t('common.js_done', 'Done.'));
    state.hideProgress();
    return summarizePrivacyReport(value);
  } catch (error) {
    if (!owns()) throw new DOMException('Scan cancelled or replaced.', 'AbortError');
    throw error;
  } finally {
    externalSignal?.removeEventListener('abort', abort);
    if (active === controller) {
      active = null;
      state.hideProgress(); setBusy(false); webmcp.refresh();
    }
  }
}

async function addFile(files, initialIntent) {
  const file = files[0];
  if (!file || initialIntent !== undefined && initialIntent !== localIntent) return;
  const intent = ++localIntent; invalidate(); state.hideError();
  const importGeneration = generation, expectedOwner = documentSession.snapshot(), controller = new AbortController(); intakeController = controller;
  const isCurrent = () => intent === localIntent && importGeneration === generation && intakeController === controller && !controller.signal.aborted;
  importing = true; setBusy(true);
  try {
    const intake = await getIntake(); if (!isCurrent()) return;
    const candidate = await intake.stage(file, { signal: controller.signal, isCurrent, expectedOwner }); if (!isCurrent() || !ownsSelection(candidate)) return;
    // All parser/inherited-session validation completed before replacing UI.
    resetOutput(); selection = candidate; showDocumentIdentity();
    if (initialIntent === undefined) history.replaceState(null, '', location.pathname);
    selectedFileName.textContent = selection.name;
    selectedFileSize.textContent = formatBytes(selection.size);
    selectedFile.hidden = false;
    webmcp.refresh();
  } catch (error) {
    if (isCurrent() && error.name !== 'AbortError') state.showError(t('privacy_scan.failed', 'The PDF could not be read.') + ' ' + error.message);
  } finally {
    if (isCurrent()) { intakeController = null; importing = false; setBusy(false); webmcp.refresh(); }
  }
}

function clearSelection() {
  localIntent++;
  if (ownsSelection()) documentSession.clear();
  invalidate(); importing = false; selection = null; selectedFile.hidden = true; resetOutput(); state.hideError();
  fileInput.value = '';
  history.replaceState(null, '', location.pathname);
  state.hideProgress();
  scanBtn.disabled = true; clearBtn.disabled = true; webmcp.refresh();
}

scanBtn.addEventListener('click', () => runScan().catch((error) => {
  if (error.name !== 'AbortError') state.showError(t('privacy_scan.failed', 'The PDF could not be inspected.'));
}));
clearBtn.addEventListener('click', clearSelection);
metadataCleanup.addEventListener('change', () => { if (!active && !importing) setBusy(false); });
cleanupBtn.addEventListener('click', async () => {
  if (!ownsSelection() || active || importing) return;
  const runGeneration = generation;
  const snapshot = { ...selection, bytes: Uint8Array.from(selection.bytes) };
  const controller = new AbortController(); active = controller; setBusy(true); state.hideError();
  const owns = () => active === controller && runGeneration === generation && !controller.signal.aborted && ownsSelection(snapshot);
  const check = () => { if (!owns()) throw new DOMException('Cleanup cancelled or replaced.', 'AbortError'); };
  state.showProgress(t('privacy_scan.cleaning', 'Creating and verifying a cleaned copy…'));
  try {
    const [cleanup, pdfLib, pdfjs] = await Promise.all([getCleanup(), ensurePdfLib(), ensurePdfJs()]);
    check();
    const result = await cleanup.cleanPdfPrivacy(snapshot.bytes, {
      categories: ['standard-metadata'], pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS,
      createCanvas, signal: controller.signal,
      onProgress: ({ phase }) => { if (owns()) state.setProgress(phase === 'rescan' ? 85 : 35, t('privacy_scan.cleaning', 'Creating and verifying a cleaned copy…')); },
    });
    check();
    cleaned = { bytes: result.bytes, name: snapshot.name.replace(/\.pdf$/i, '') + '-metadata-cleaned.pdf', owner: snapshot.owner };
    lossManifest.textContent = '';
    const removed = document.createElement('li');
    removed.textContent = t('privacy_scan.removed', 'Removed {n} standard metadata fields.', { n: result.lossManifest.removedCount });
    lossManifest.appendChild(removed);
    for (const warning of result.lossManifest.warnings) { const item = document.createElement('li'); item.textContent = warning; lossManifest.appendChild(item); }
    successText.textContent = t('privacy_scan.verified', 'The new copy reopened in two PDF engines, rendered, and passed a category-preservation rescan. Download starts only when you choose it.');
    state.showSuccess(); state.setProgress(100, t('common.js_done', 'Done.'));
  } catch (error) {
    if (owns() && error.name !== 'AbortError') state.showError(t('privacy_scan.cleanup_failed', 'The cleaned copy could not be verified, so download remains unavailable.'));
  } finally {
    if (active === controller) {
      active = null;
      state.hideProgress(); setBusy(false); webmcp.refresh();
    }
  }
});
downloadBtn.addEventListener('click', () => { if (cleaned && ownsSelection(cleaned) && !active && !importing) downloadBytes(cleaned.bytes, cleaned.name, 'application/pdf', { download: true }); });
wireDropzone(dropzone, fileInput, addFile);

const webmcp = setupPrivacyScanWebMcp({
  getSelectedFile: () => ownsSelection() ? { name: selection.name, size: selection.size } : null,
  scanSelected: ({ signal } = {}) => runScan({ signal }),
});

// Empty URLs do not request optional intake, handoff or session modules.
const params = new URLSearchParams(location.search), workflow = params.get('workflow'), file = params.get('file');
if (workflow && file?.startsWith(`${workflow}:`)) {
  const initialIntent = localIntent;
  initialPending = true; setBusy(false); state.showProgress(t('privacy_scan.loading_chosen', 'Restoring the chosen PDF… You can select another file or clear this request.'));
  void takeChainedFile().then((file) => { if (file && localIntent === initialIntent) return addFile([file], initialIntent); })
    .finally(() => { if (localIntent === initialIntent) { initialPending = false; state.hideProgress(); setBusy(false); } });
}
