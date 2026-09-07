'use strict';

import { t } from './i18n.js';
import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { checkPdfMagicBytes, createTaskState, downloadBytes, formatBytes, looksLikePdfFile, wireDropzone } from './tool-ui.js';
import { cleanPdfPrivacy } from './core/privacy-cleanup.js';
import { scanPdfPrivacy, summarizePrivacyReport } from './core/privacy-scan.js';
import { setupPrivacyScanWebMcp } from './webmcp.js';

const MAX_FILE_BYTES = 250 * 1000 * 1000;
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

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

function invalidate() {
  generation++;
  active?.abort();
  active = null;
  workspace.setAttribute('aria-busy', 'false');
}

function setBusy(busy) {
  workspace.setAttribute('aria-busy', String(busy));
  scanBtn.disabled = busy || !selection;
  clearBtn.disabled = !selection && !importing;
  metadataCleanup.disabled = busy || !report?.standardMetadata?.count;
  cleanupBtn.disabled = busy || !metadataCleanup.checked || !report?.standardMetadata?.count;
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
  const runGeneration = generation;
  const snapshot = { ...selection, bytes: Uint8Array.from(selection.bytes) };
  const controller = new AbortController();
  active = controller;
  const abort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', abort, { once: true });
  setBusy(true); state.hideError(); state.hideSuccess();
  state.showProgress(t('privacy_scan.loading', 'Loading verified inspection runtime…'));
  try {
    const pdfjs = await ensurePdfJs((message) => state.setProgress(2, message));
    const value = await scanPdfPrivacy(snapshot.bytes, {
      pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, signal: controller.signal,
      onProgress: ({ page, pageCount }) => state.setProgress(5 + (page / pageCount) * 90, t('privacy_scan.scanning_page', 'Inspecting page {page} of {pages}…', { page, pages: pageCount })),
    });
    if (controller.signal.aborted || runGeneration !== generation) throw new DOMException('Scan cancelled.', 'AbortError');
    if (active !== controller) throw new DOMException('Scan superseded.', 'AbortError');
    active = null;
    report = value; cleaned = null; renderReport(value);
    state.setProgress(100, t('common.js_done', 'Done.'));
    state.hideProgress();
    return summarizePrivacyReport(value);
  } finally {
    externalSignal?.removeEventListener('abort', abort);
    if (active === controller) {
      active = null;
      state.hideProgress(); setBusy(false);
    }
  }
}

async function addFile(files) {
  invalidate(); resetOutput(); state.hideError();
  const file = files[0];
  if (!file) return;
  const importGeneration = generation;
  selection = null; selectedFile.hidden = true; importing = true; setBusy(true); webmcp.refresh();
  try {
    if (!looksLikePdfFile(file)) {
      if (generation === importGeneration) state.showError(t('common.js_err_not_pdf', 'Please select a PDF file.'));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      if (generation === importGeneration) state.showError(t('privacy_scan.too_large', 'Choose a PDF smaller than 250 MB.'));
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (generation !== importGeneration) return;
    if (!checkPdfMagicBytes(bytes)) { state.showError(t('common.js_err_invalid_pdf', 'This file does not look like a valid PDF.')); return; }
    selection = { name: file.name.slice(0, 160), size: file.size, bytes: Uint8Array.from(bytes) };
    selectedFileName.textContent = selection.name;
    selectedFileSize.textContent = formatBytes(selection.size);
    selectedFile.hidden = false;
    webmcp.refresh();
  } catch {
    if (generation === importGeneration) state.showError(t('privacy_scan.failed', 'The PDF could not be read.'));
  } finally {
    if (generation === importGeneration) { importing = false; setBusy(false); }
  }
}

function clearSelection() {
  invalidate(); importing = false; selection = null; selectedFile.hidden = true; resetOutput(); state.hideError();
  state.hideProgress();
  scanBtn.disabled = true; clearBtn.disabled = true; webmcp.refresh();
}

scanBtn.addEventListener('click', () => runScan().catch((error) => {
  if (error.name !== 'AbortError') state.showError(t('privacy_scan.failed', 'The PDF could not be inspected.'));
}));
clearBtn.addEventListener('click', clearSelection);
metadataCleanup.addEventListener('change', () => { if (!active && !importing) setBusy(false); });
cleanupBtn.addEventListener('click', async () => {
  if (!selection || active || importing) return;
  const runGeneration = generation;
  const snapshot = { ...selection, bytes: Uint8Array.from(selection.bytes) };
  const controller = new AbortController(); active = controller; setBusy(true); state.hideError();
  state.showProgress(t('privacy_scan.cleaning', 'Creating and verifying a cleaned copy…'));
  try {
    const [pdfLib, pdfjs] = await Promise.all([ensurePdfLib(), ensurePdfJs()]);
    const result = await cleanPdfPrivacy(snapshot.bytes, {
      categories: ['standard-metadata'], pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS,
      createCanvas, signal: controller.signal,
      onProgress: ({ phase }) => state.setProgress(phase === 'rescan' ? 85 : 35, t('privacy_scan.cleaning', 'Creating and verifying a cleaned copy…')),
    });
    if (controller.signal.aborted || runGeneration !== generation) throw new DOMException('Cleanup cancelled.', 'AbortError');
    cleaned = { bytes: result.bytes, name: snapshot.name.replace(/\.pdf$/i, '') + '-metadata-cleaned.pdf' };
    lossManifest.textContent = '';
    const removed = document.createElement('li');
    removed.textContent = t('privacy_scan.removed', 'Removed {n} standard metadata fields.', { n: result.lossManifest.removedCount });
    lossManifest.appendChild(removed);
    for (const warning of result.lossManifest.warnings) { const item = document.createElement('li'); item.textContent = warning; lossManifest.appendChild(item); }
    successText.textContent = t('privacy_scan.verified', 'The new copy reopened in two PDF engines, rendered, and passed a category-preservation rescan. Download starts only when you choose it.');
    state.showSuccess(); state.setProgress(100, t('common.js_done', 'Done.'));
  } catch (error) {
    if (error.name !== 'AbortError') state.showError(t('privacy_scan.cleanup_failed', 'The cleaned copy could not be verified, so download remains unavailable.'));
  } finally {
    if (active === controller) {
      active = null;
      state.hideProgress(); setBusy(false);
    }
  }
});
downloadBtn.addEventListener('click', () => { if (cleaned) downloadBytes(cleaned.bytes, cleaned.name); });
wireDropzone(dropzone, fileInput, addFile);

const webmcp = setupPrivacyScanWebMcp({
  getSelectedFile: () => selection ? { name: selection.name, size: selection.size } : null,
  scanSelected: ({ signal } = {}) => runScan({ signal }),
});
