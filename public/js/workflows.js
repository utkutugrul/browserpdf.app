'use strict';

import { ensureCantooPdfLib, ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { t, onReady } from './i18n.js';
import { LocalBatchQueue } from './core/batch-queue.js';
import { executeWorkflow } from './core/workflow-engine.js';
import { STARTER_RECIPES, getStarterRecipe, getWorkflowStep, materializeRecipe } from './core/workflow-manifest.js';
import { createWorkflowStore } from './core/workflow-store.js';
import { setupWorkflowWebMcp } from './webmcp.js';
import { zipStore } from './zip-writer.js';

const MAX_FILES = 20;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const recipeChoices = document.getElementById('recipeChoices');
const recipeOptions = document.getElementById('recipeOptions');
const workflowSteps = document.getElementById('workflowSteps');
const dropzone = document.getElementById('workflowDropzone');
const fileInput = document.getElementById('workflowFileInput');
const queueBody = document.getElementById('queueBody');
const runBtn = document.getElementById('runWorkflowBtn');
const cancelBtn = document.getElementById('cancelWorkflowBtn');
const clearBtn = document.getElementById('clearWorkflowBtn');
const zipBtn = document.getElementById('downloadZipBtn');
const live = document.getElementById('queueLive');
const errorBox = document.getElementById('workflowError');

const store = createWorkflowStore();
let workflowId = null;
let recipeId = STARTER_RECIPES[0].id;
let pendingReads = 0;
let reservedFileCount = 0;
let reservedBytes = 0;
let importGeneration = 0;
let clearing = false;
let hydrating = true;
let workflowCurrentStep = 0;
const activeReservations = new Set();
let webMcp = { refresh() {} };
let persistChain = Promise.resolve();
let persistenceGeneration = 0;

function defaultParameterState(id) {
  return Object.fromEntries(materializeRecipe(id).map((step) => [
    step.id,
    Object.fromEntries(Object.entries(step.parameters).filter(([key]) => key !== 'password')),
  ]));
}

let workflowParameters = defaultParameterState(recipeId);

function createId() { return crypto.randomUUID(); }
function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
function hideError() { errorBox.textContent = ''; errorBox.hidden = true; }
function createCanvas(width, height) { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }

function isValidStoredParameter(rule, value) {
  if (rule.type === 'string' && typeof value !== 'string') return false;
  if (rule.type === 'number' && (typeof value !== 'number' || value < rule.minimum || value > rule.maximum)) return false;
  if (rule.type === 'integer' && (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum)) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.minLength !== undefined && value.length < rule.minLength) return false;
  if (rule.maxLength !== undefined && value.length > rule.maxLength) return false;
  return true;
}

function hydrateParameterState(savedSteps) {
  const next = defaultParameterState(recipeId);
  for (const saved of Array.isArray(savedSteps) ? savedSteps : []) {
    const definition = getWorkflowStep(saved?.id);
    if (!definition || !(saved.id in next) || !saved.parameters || typeof saved.parameters !== 'object') continue;
    for (const [key, value] of Object.entries(saved.parameters)) {
      const rule = definition.parameterSchema.properties[key];
      if (key !== 'password' && rule && isValidStoredParameter(rule, value)) next[saved.id][key] = value;
    }
  }
  workflowParameters = next;
}

function selectedSteps({ includePassword = true } = {}) {
  const steps = materializeRecipe(recipeId);
  for (const step of steps) {
    step.parameters = { ...step.parameters, ...(workflowParameters[step.id] || {}) };
    if (step.id === 'protect-password-v1') {
      if (includePassword) step.parameters.password = document.getElementById('workflowPassword')?.value || '';
      else delete step.parameters.password;
    }
  }
  return steps;
}

function persist() {
  if (!workflowId || hydrating) return;
  const targetWorkflowId = workflowId;
  const generation = persistenceGeneration;
  const files = queue.items.map((item) => ({
    id: item.id, name: item.name, type: 'application/pdf', bytes: item.bytes,
    status: item.status, step: item.step, error: item.error, output: item.output,
    outputName: item.outputName, report: item.report, recipeId: item.recipeId,
  }));
  const record = {
    id: targetWorkflowId, kind: 'batch', recipeId,
    // Secret parameters are omitted entirely; they exist only in the live input.
    orderedSteps: selectedSteps({ includePassword: false }),
    currentStep: Math.max(workflowCurrentStep, 0, ...queue.items.map((item) => item.step || 0)),
    fileRefs: files.map((file) => file.id),
    cleanup: { policy: 'expire', scope: targetWorkflowId },
  };
  persistChain = persistChain.then(async () => {
    if (generation !== persistenceGeneration) return;
    await store.putWorkflowBundle(record, files);
  }).catch((error) => showError(error?.message || 'Could not save the local workflow.'));
  if (queue.items.length && new URLSearchParams(location.search).get('workflow') !== targetWorkflowId) {
    history.replaceState(null, '', `${location.pathname}?workflow=${encodeURIComponent(targetWorkflowId)}`);
  }
}

function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}

async function processItem(item, queueContext) {
  const steps = selectedSteps();
  const passwordStep = steps.find((step) => step.id === 'protect-password-v1');
  if (passwordStep && passwordStep.parameters.password.length < 4) throw new Error(t('workflows.password_error', 'Enter a password of at least 4 characters before running this recipe.'));
  const pdfLib = await ensurePdfLib();
  const needsCompression = steps.some((step) => step.id === 'compress-raster-v1');
  const needsProtection = steps.some((step) => step.id === 'protect-password-v1');
  const [pdfjs, cantooPdfLib] = await Promise.all([
    needsCompression ? ensurePdfJs() : null,
    needsProtection ? ensureCantooPdfLib() : null,
  ]);
  return executeWorkflow({ bytes: item.bytes, name: item.name, recipeId, steps }, {
    pdfLib, pdfjs, cantooPdfLib, pdfjsAssets: PDFJS_ASSET_URLS, createCanvas,
    isCancelled: queueContext.isCancelled,
    onStep: (step) => queueContext.onStep(step),
  });
}

const queue = new LocalBatchQueue({
  process: processItem,
  onChange: () => { renderQueue(); persist(); webMcp.refresh(); },
});

function statusLabel(status) {
  return t(`workflows.status_${status}`, ({ queued: 'Queued', running: 'Running', success: 'Success', error: 'Error', canceled: 'Canceled' })[status] || status);
}

function renderQueue() {
  queueBody.textContent = '';
  if (!queue.items.length) {
    const row = queueBody.insertRow(); const cell = row.insertCell(); cell.colSpan = 4; cell.className = 'queue-empty';
    cell.textContent = t('workflows.empty', 'No PDFs added yet.');
  }
  for (const item of queue.items) {
    const row = queueBody.insertRow();
    const fileCell = row.insertCell(); fileCell.textContent = item.name;
    const statusCell = row.insertCell();
    const status = document.createElement('span'); status.className = 'queue-status'; status.textContent = statusLabel(item.status); statusCell.appendChild(status);
    if (item.error) { const detail = document.createElement('span'); detail.className = 'queue-error'; detail.textContent = item.error; statusCell.appendChild(detail); }
    if (item.report) {
      const scan = item.report['privacy-metadata-scan-v1'];
      const detail = document.createElement('span'); detail.className = 'queue-report';
      detail.textContent = scan ? t('workflows.scan_result', 'Standard metadata fields found: {n}. Cleanup was limited to these fields.', { n: scan.count }) : '';
      statusCell.appendChild(detail);
    }
    const outputCell = row.insertCell(); outputCell.textContent = item.outputName || '—';
    const actionCell = row.insertCell();
    if (item.status === 'success' && item.output) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-ghost btn-small';
      button.textContent = t('workflows.download', 'Download'); button.addEventListener('click', () => download(item.output, item.outputName, 'application/pdf')); actionCell.appendChild(button);
    } else if (item.status === 'error' || item.status === 'canceled') {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-ghost btn-small';
      button.textContent = t('workflows.retry', 'Retry'); button.addEventListener('click', () => queue.retry(item.id)); actionCell.appendChild(button);
    } else actionCell.textContent = '—';
  }
  const running = queue.running || queue.items.some((item) => item.status === 'running');
  const queued = queue.items.some((item) => item.status === 'queued');
  runBtn.disabled = pendingReads > 0 || running || !queued;
  cancelBtn.disabled = !running && !queued;
  clearBtn.disabled = running || clearing || (!queue.items.length && pendingReads === 0);
  fileInput.disabled = clearing;
  dropzone.setAttribute('aria-busy', String(pendingReads > 0 || clearing));
  zipBtn.hidden = !queue.items.some((item) => item.status === 'success' && item.output);
  recipeChoices.disabled = Boolean(queue.items.length);
}

function renderRecipe() {
  const recipe = getStarterRecipe(recipeId);
  workflowSteps.textContent = '';
  for (const stepId of recipe.stepIds) {
    const step = getWorkflowStep(stepId);
    const key = step.id.replace(/-/g, '_');
    const li = document.createElement('li');
    const title = document.createElement('strong'); title.textContent = t(`workflows.step_${key}_title`, step.title); li.appendChild(title);
    const loss = document.createElement('span'); loss.textContent = t(`workflows.step_${key}_loss`, step.loss); li.appendChild(loss);
    const privacy = document.createElement('span'); privacy.textContent = t(`workflows.step_${key}_privacy`, step.privacy); li.appendChild(privacy);
    workflowSteps.appendChild(li);
  }
  recipeOptions.textContent = '';
  const appendControl = (labelText, control) => {
    const label = document.createElement('label');
    label.append(document.createTextNode(labelText), control);
    recipeOptions.appendChild(label);
    return control;
  };
  const input = (id, type = 'text') => {
    const control = document.createElement('input');
    control.className = 'text-input'; control.id = id; control.type = type;
    return control;
  };
  if (recipeId === 'compress-watermark-protect-v1') {
    const quality = input('workflowQuality', 'number'); quality.min = '.45'; quality.max = '.9'; quality.step = '.01'; quality.value = String(workflowParameters['compress-raster-v1'].quality);
    quality.addEventListener('input', () => { workflowParameters['compress-raster-v1'].quality = Number(quality.value); persist(); });
    appendControl(t('workflows.quality', 'JPEG quality'), quality);
    const watermark = input('workflowWatermark'); watermark.maxLength = 40; watermark.value = workflowParameters['watermark-text-v1'].text;
    watermark.addEventListener('input', () => { workflowParameters['watermark-text-v1'].text = watermark.value; persist(); });
    appendControl(t('workflows.watermark', 'Watermark text'), watermark);
    const password = input('workflowPassword', 'password'); password.minLength = 4; password.maxLength = 128; password.autocomplete = 'new-password';
    appendControl(t('workflows.password', 'Open password (not saved)'), password);
  } else if (recipeId === 'organize-page-numbers-v1') {
    const order = document.createElement('select'); order.className = 'text-input'; order.id = 'workflowOrder';
    for (const [value, label] of [['reverse', t('workflows.reverse', 'Reverse all pages')], ['keep', t('workflows.keep', 'Keep current order')]]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; order.appendChild(option);
    }
    order.value = workflowParameters['organize-pages-v1'].order;
    order.addEventListener('change', () => { workflowParameters['organize-pages-v1'].order = order.value; persist(); });
    appendControl(t('workflows.page_order', 'Page order'), order);
    const start = input('workflowStart', 'number'); start.min = '1'; start.max = '100000'; start.value = String(workflowParameters['page-numbers-v1'].start);
    start.addEventListener('input', () => { workflowParameters['page-numbers-v1'].start = Number(start.value); persist(); });
    appendControl(t('workflows.start_number', 'Start number'), start);
  } else {
    const scope = document.createElement('p'); scope.textContent = t('workflows.scan_scope', 'Scan and cleanup are limited to standard document-info metadata fields.'); recipeOptions.appendChild(scope);
  }
}

function renderRecipeChoices() {
  recipeChoices.textContent = '';
  STARTER_RECIPES.forEach((recipe, index) => {
    const label = document.createElement('label'); label.className = 'recipe-choice';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'recipe'; input.value = recipe.id; input.checked = recipe.id === recipeId;
    input.addEventListener('change', () => {
      recipeId = recipe.id;
      workflowParameters = defaultParameterState(recipeId);
      workflowCurrentStep = 0;
      renderRecipe(); persist();
    });
    const title = document.createElement('strong'); title.textContent = t(`workflows.recipe_${index + 1}`, recipe.title);
    const description = document.createElement('span'); description.textContent = t(`workflows.recipe_${index + 1}_desc`, recipe.description);
    label.append(input, title, description); recipeChoices.appendChild(label);
  });
}

function queuedInputBytes() {
  return queue.items.reduce((sum, item) => sum + item.bytes.length, 0);
}

function reserveImports(candidates) {
  let projectedBytes = queuedInputBytes() + reservedBytes;
  let projectedCount = queue.items.length + reservedFileCount;
  const entries = [];
  let hitCountLimit = false;
  let hitByteLimit = false;
  for (const file of candidates) {
    if (projectedCount >= MAX_FILES) { hitCountLimit = true; continue; }
    if (projectedBytes + file.size > MAX_TOTAL_BYTES) { hitByteLimit = true; continue; }
    entries.push({ file, bytes: file.size, reserved: true });
    projectedCount++;
    projectedBytes += file.size;
  }
  if (hitCountLimit) showError(t('workflows.too_many', 'This local queue accepts at most 20 files.'));
  else if (hitByteLimit) showError(t('workflows.too_large', 'This queue is limited to 250 MB of input on this device.'));
  if (!entries.length) return null;
  const reservation = { generation: importGeneration, entries, active: true, pending: true };
  reservedFileCount += entries.length;
  reservedBytes += entries.reduce((sum, entry) => sum + entry.bytes, 0);
  pendingReads++;
  activeReservations.add(reservation);
  return reservation;
}

function releaseReservedEntry(reservation, entry) {
  if (!reservation.active || !entry.reserved) return;
  entry.reserved = false;
  reservedFileCount--;
  reservedBytes -= entry.bytes;
}

function finishReservation(reservation) {
  if (reservation.active) {
    reservation.entries.forEach((entry) => releaseReservedEntry(reservation, entry));
    reservation.active = false;
  }
  if (reservation.pending) { reservation.pending = false; pendingReads--; }
  activeReservations.delete(reservation);
}

function cancelImportReservations() {
  importGeneration++;
  for (const reservation of activeReservations) finishReservation(reservation);
  reservedFileCount = 0;
  reservedBytes = 0;
}

async function addFiles(files) {
  if (clearing) return;
  hideError();
  const candidates = Array.from(files).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!candidates.length) { showError(t('common.js_err_not_pdf', 'Please select a PDF file.')); return; }
  const reservation = reserveImports(candidates);
  if (!reservation) { renderQueue(); return; }
  renderQueue();
  try {
    for (const entry of reservation.entries) {
      if (!reservation.active || reservation.generation !== importGeneration) break;
      let bytes;
      try { bytes = new Uint8Array(await entry.file.arrayBuffer()); }
      catch (error) {
        if (!reservation.active || reservation.generation !== importGeneration) break;
        releaseReservedEntry(reservation, entry);
        showError(`Could not read "${entry.file.name}": ${error?.message || 'read failed'}.`);
        continue;
      }
      if (!reservation.active || reservation.generation !== importGeneration) break;
      const sizeDelta = bytes.length - entry.bytes;
      if (sizeDelta > 0 && queuedInputBytes() + reservedBytes + sizeDelta > MAX_TOTAL_BYTES) {
        releaseReservedEntry(reservation, entry);
        showError(t('workflows.too_large', 'This queue is limited to 250 MB of input on this device.'));
        continue;
      }
      reservedBytes += sizeDelta;
      entry.bytes = bytes.length;
      if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
        releaseReservedEntry(reservation, entry);
        showError(t('common.js_err_invalid_pdf', 'This file does not look like a valid PDF.'));
        continue;
      }
      releaseReservedEntry(reservation, entry);
      queue.add([{ id: `${workflowId}:${createId()}`, name: entry.file.name, bytes, recipeId }]);
    }
  } finally { finishReservation(reservation); renderQueue(); }
}

function wireDropzone() {
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); } });
  dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('dragover'); addFiles(event.dataTransfer.files); });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
}

async function clearQueue() {
  if (queue.running) return;
  hideError();
  clearing = true;
  const oldId = workflowId;
  persistenceGeneration++;
  cancelImportReservations();
  queue.items = []; queue.usedNames.clear();
  renderQueue();
  try {
    await persistChain;
    await store.deleteWorkflow(oldId);
  } catch (error) {
    showError(error?.message || 'Could not clear the local workflow store.');
  } finally {
    workflowId = createId();
    workflowCurrentStep = 0;
    history.replaceState(null, '', location.pathname);
    live.textContent = t('workflows.cleared', 'Local queue cleared.');
    clearing = false;
    renderQueue(); persist();
  }
}

async function restore() {
  await store.cleanupExpired();
  const requestedId = new URLSearchParams(location.search).get('workflow');
  const saved = requestedId ? await store.getWorkflow(requestedId) : null;
  workflowId = saved?.kind === 'batch' ? saved.id : createId();
  if (!saved || saved.kind !== 'batch') return;
  recipeId = getStarterRecipe(saved.recipeId) ? saved.recipeId : recipeId;
  const stepCount = getStarterRecipe(recipeId).stepIds.length;
  workflowCurrentStep = Number.isInteger(saved.currentStep)
    ? Math.max(0, Math.min(stepCount, saved.currentStep))
    : 0;
  // Hydrate non-secret parameters before queue.restore(), whose onChange
  // callback would otherwise persist recipe defaults over the saved values.
  hydrateParameterState(saved.orderedSteps);
  const files = await store.listFiles(workflowId);
  const byId = new Map(files.map((file) => [file.id, file]));
  queue.restore(saved.fileRefs.map((id) => byId.get(id)).filter(Boolean).map((file) => ({
    ...file, recipeId, status: file.status === 'running' ? 'canceled' : file.status,
  })));
  live.textContent = t('workflows.resumed', 'Resumed a local workflow. Passwords are not restored.');
}

async function init() {
  try { await restore(); } catch (error) { showError(error?.message || 'Could not restore the workflow.'); workflowId ||= createId(); }
  renderRecipeChoices(); renderRecipe(); renderQueue(); wireDropzone();
  hydrating = false;
  persist();
  runBtn.addEventListener('click', async () => { hideError(); await queue.run(); live.textContent = t('workflows.run_complete', 'Queue run finished. Successful outputs are ready; errors can be retried.'); });
  cancelBtn.addEventListener('click', () => { queue.cancel(); live.textContent = t('workflows.cancelled', 'Cancellation requested. Completed outputs were kept.'); });
  clearBtn.addEventListener('click', clearQueue);
  zipBtn.addEventListener('click', () => {
    const files = queue.items.filter((item) => item.status === 'success' && item.output).map((item) => ({ name: item.outputName, data: item.output }));
    if (files.length) download(zipStore(files), 'browserpdf-workflow-results.zip', 'application/zip');
  });
  webMcp = setupWorkflowWebMcp({
    getQueueState: () => queue.snapshot(),
    recommend: (recommendedId) => {
      const recipe = getStarterRecipe(recommendedId);
      return { recipeId: recipe.id, title: recipe.title, steps: recipe.stepIds, requiresUserFileSelection: true };
    },
    cancel: () => queue.cancel(),
    retry: (id) => queue.retry(id),
  });
  webMcp.refresh();
}

onReady(init);
