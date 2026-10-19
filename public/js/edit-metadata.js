'use strict';

import { ensurePdfLib, ensurePdfJs, PDFJS_ASSET_URLS } from './lib-loader.js';
import * as ui from './tool-ui.js';
import { t } from './i18n.js';

const $ = id => document.getElementById(id);
const fields = ['title', 'author', 'subject', 'keywords', 'creator', 'producer'];
const allFields = [...fields, 'creationDate', 'modificationDate'];
const labels = { title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords', creator: 'Creator', producer: 'Producer', creationDate: 'Creation date', modificationDate: 'Modification date' };
const text = (key, fallback, values) => t(`metadata_workspace.${key}`, fallback, values);
const same = (a, b) => !!a && !!b && a.taskId === b.taskId && a.revision === b.revision && a.generation === b.generation;
const snapshot = () => ui.documentSession.snapshot();
const stale = () => new DOMException('Metadata work was replaced or canceled.', 'AbortError');
let corePromise, coreAttempt = 0, queue, preview, pendingRequest, unreadRequest;
let epoch = 0, localIntent = 0, acceptedOwner, currentModel, originalModel, resultModel;
let cachedReview = null;
let ready = false, busy = false, initialPending = false, prepared = false, postUsePending = false, needsFill = false;
let pageIndex = 0, resultDrain = Promise.resolve(), lastError = false;
const replaced = new Set();
const ownsAccepted = () => same(acceptedOwner, snapshot());
const getCore = () => corePromise ||= import(coreAttempt ? `./core/metadata-editor.js?retry=${coreAttempt}` : './core/metadata-editor.js').catch(error => { corePromise = null; coreAttempt++; throw error; });
function patch() {
  const out = {};
  if (!currentModel) return out;
  for (const key of fields) {
    const cell = currentModel.fields[key], value = $(`${key}Input`).value;
    if (replaced.has(key) || cell.status === 'value' && !cell.replaceRequired && cell.value !== value || cell.status === 'absent' && value !== '') out[key] = value;
  }
  return out;
}
const mode = () => $('clearMode').checked ? 'clear-standard' : 'edit';
const dirty = () => mode() === 'clear-standard' || Object.keys(patch()).length > 0;
function controls() {
  $('dropzone').classList?.toggle('metadata-selected-dropzone', ready);
  $('metadataWorkspace').setAttribute('aria-busy', String(busy || postUsePending));
  $('cancelBtn').disabled = !busy && !initialPending && !postUsePending;
  $('clearBtn').disabled = !acceptedOwner && !busy && !initialPending && !pendingRequest?.file;
  $('applyBtn').disabled = busy || postUsePending || !ready || !ownsAccepted() || !dirty() || prepared || !!cachedReview;
  $('undoBtn').disabled = busy || postUsePending || dirty() || !ownsAccepted() || !snapshot().canUndo;
  $('redoBtn').disabled = busy || postUsePending || dirty() || !ownsAccepted() || !snapshot().canRedo;
  $('previousPageBtn').disabled = busy || !ready || pageIndex < 1;
  $('nextPageBtn').disabled = busy || !ready || pageIndex >= (currentModel?.pageCount || 0) - 1;
  for (const key of fields) {
    const preserved = currentModel?.fields[key].replaceRequired && !replaced.has(key);
    $(`${key}Input`).disabled = busy || postUsePending || !ready || mode() !== 'edit' || !!preserved;
    $(`${key}Replace`).disabled = busy || postUsePending || !ready || mode() !== 'edit';
  }
  $('editMode').disabled = $('clearMode').disabled = busy || postUsePending || !ready;
}
function showFailure(error) {
  if (error?.name === 'AbortError') return;
  const message = String(error?.message || text('failed', 'The metadata operation could not be completed.')).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  lastError = true; ui.showError(message.slice(0, 512).replace(/[\ud800-\udbff]$/, '')); $('retryBtn').hidden = !acceptedOwner && !preview && !pendingRequest?.file;
}
function clearFailure() { lastError = false; ui.hideError(); $('retryBtn').hidden = true; }
function invalidate() {
  epoch++; queue?.cancel(); if (unreadRequest) unreadRequest.file = null; unreadRequest = null; pendingRequest = null; initialPending = false; prepared = false; postUsePending = false; resultModel = null; cachedReview = null;
  resultDrain = ui.clearResultAndDrain(); resultDrain.catch(() => {}); $('currentPreview').hidden = false; comparison(); return epoch;
}
function comparison() {
  const body = $('metadataComparison'); body.replaceChildren(); if (!currentModel) return;
  for (const key of allFields) {
    const row = document.createElement('tr'), heading = document.createElement('th'); heading.scope = 'row'; heading.textContent = text(`field_${key}`, labels[key]); row.append(heading);
    for (const model of [originalModel, currentModel, resultModel]) {
      const cell = document.createElement('td'), value = model?.fields[key];
      if (!value) cell.textContent = text('not_prepared', 'Not prepared');
      else if (value.status === 'absent') cell.textContent = text('absent', 'Not set');
      else if (value.status === 'unreadable' || value.status === 'not-inspected') cell.textContent = text('unavailable', 'Not inspected or unreadable');
      else {
        const description = value.status === 'oversized' ? text('oversized', 'Preserved stored value ({n} UTF-16 units); bounded display below.', { n: value.length }) : value.value === '' ? text('present_blank', 'Present, blank text') : value.value;
        if (description.length > 100 || value.status === 'oversized') {
          const details = document.createElement('details'), summary = document.createElement('summary'), content = document.createElement('span'); summary.textContent = value.status === 'oversized' ? description : text('show_value', 'Show stored text'); content.textContent = value.value; details.append(summary, content); cell.append(details);
        } else cell.textContent = description;
      }
      row.append(cell);
    }
    body.append(row);
  }
}
function fill(model) {
  replaced.clear();
  for (const key of fields) {
    const cell = model.fields[key], preserve = cell.replaceRequired || cell.status === 'oversized' || cell.status === 'unreadable';
    $(`${key}Input`).value = preserve ? '' : cell.value; $(`${key}Replace`).hidden = !preserve;
    $(`${key}Notice`).textContent = preserve ? text('preserved', 'The stored value is preserved. Replace it deliberately to write a new value of at most 4096 UTF-16 units.') : cell.status === 'absent' ? text('absent', 'Not set') : '';
  }
  $('editMode').checked = true; $('clearMode').checked = false;
}
function identity() {
  const state = snapshot(), label = value => value?.displayName || value?.name || '';
  $('fileSummary').textContent = `${t('workspace.original', 'Original')}: ${label(state.original)}\n${t('workspace.current', 'Current')}: ${label(state.current)}`; $('fileSummary').title = $('fileSummary').textContent;
  $('metadataCanvas').setAttribute('aria-label', label(state.current)); ui.showDocumentIdentity();
  const sharedIdentity = $('documentIdentity');
  if (sharedIdentity) $('metadataDocumentNames').append(sharedIdentity);
  $('fileSummary').hidden = !!sharedIdentity;
  const description = text('names_aria', 'Document names. Original: {original}. Current: {current}. Revision {revision}.', { original: label(state.original), current: label(state.current), revision: state.revision });
  $('metadataDocumentNamesSummary').setAttribute('aria-label', description); $('metadataDocumentNamesSummary').title = description;
}
function resetIdentity() {
  $('documentIdentity')?.remove(); $('metadataDocumentNames').open = false; $('metadataDocumentNamesSummary').setAttribute('aria-label', text('names', 'Document names')); $('metadataDocumentNamesSummary').title = '';
  $('fileSummary').textContent = ''; $('fileSummary').hidden = false; $('metadataCanvas').setAttribute('aria-label', text('canvas_empty', 'Current PDF preview'));
}
function disclosure(input, checkLimit = false) {
  const losses = [...new Set([...(snapshot().current?.boundary?.losses || []), ...(input.losses || []), 'signature-rewrite'])];
  if (checkLimit && losses.length > 12) throw new Error(text('boundary_limit', 'This task has too many rewrite disclosures. Keep the current copy or start a new task.'));
  $('metadataDisclosures').textContent = [input.losses?.includes('scene-baked') ? text('scene_baked', 'The prepared copy includes the current visible edits. Undo after Use restores the preceding editable state.') : '', input.losses?.includes('composition-baked') ? text('composition_baked', 'The prepared PDF includes the current image composition. Undo after Use restores that composition.') : '', text('rewrite_warning', 'Rewriting may invalidate a digital signature. Earlier task disclosures remain attached to the chosen copy.')].filter(Boolean).join(' ');
  return { kind: 'pdf-rewrite', losses };
}
async function effective(operation, core) {
  const input = await ui.getWorkspaceInput({ bakeScene: true, bakeComposition: true, operation }); operation.assertCurrent();
  if (!input || input.type !== 'application/pdf' || input.bytes.length > core.METADATA_LIMITS.inputBytes) throw new Error(text('effective_limit', 'The current PDF, including visible edits, must be at most 32 MiB.'));
  return input;
}
async function paint(input, operation) {
  operation.assertCurrent(); const value = await preview.open(input.bytes, { pageIndex, signal: operation.signal }); operation.assertCurrent();
  pageIndex = value.pageIndex; $('metadataPage').textContent = `${pageIndex + 1} / ${value.pageCount}`; $('metadataCanvas').setAttribute('aria-label', input.displayName || input.name);
}
async function hydrate(operation, core, { reset = false, retry = false } = {}) {
  reset ||= needsFill;
  await preview.drained({ retry }); operation.assertCurrent();
  const input = await effective(operation, core), lib = await ensurePdfLib(); operation.assertCurrent();
  const model = await core.inspectPdfMetadata(input.bytes, { pdfLib: lib, signal: operation.signal }); operation.assertCurrent();
  let original = originalModel;
  if (reset || !original) {
    const descriptor = snapshot().original; original = { fields: Object.fromEntries(allFields.map(key => [key, { status: 'not-inspected', value: '', length: 0 }])) };
    if (descriptor?.type === 'application/pdf' && descriptor.size <= core.METADATA_LIMITS.inputBytes) {
      try { original = await core.inspectPdfMetadata(ui.documentSession.original().bytes, { pdfLib: lib, signal: operation.signal }); } catch (error) { if (error.name === 'AbortError') throw error; }
      operation.assertCurrent();
    }
  }
  await paint(input, operation); operation.assertCurrent(); currentModel = model; originalModel = original; ready = true; if (reset) { fill(model); needsFill = false; }
  disclosure(input); identity(); comparison(); $('optionsSection').hidden = false; $('currentPreview').hidden = false; $('metadataStatus').textContent = text('ready', 'Current PDF ready. Change fields or choose standard Info cleanup.');
}
async function prepare(request, operation, core) {
  const input = await effective(operation, core), lib = await ensurePdfLib(); operation.assertCurrent();
  const boundary = disclosure(input, true), result = await core.applyPdfMetadata(input.bytes, request.change, { pdfLib: lib, signal: operation.signal }); operation.assertCurrent();
  const suffix = request.change.mode === 'clear-standard' ? '-info-cleared.pdf' : '-metadata.pdf', name = input.name.replace(/\.pdf$/i, '') + suffix;
  const descriptor = { type: 'application/pdf', name, displayName: (input.displayName || input.name).replace(/\.pdf$/i, '') + suffix, capabilities: { ...input.capabilities, encrypted: false }, boundary };
  const { createArtifact } = await import('./core/document-session.js'); operation.assertCurrent();
  const candidate = { artifact: createArtifact(result.bytes, name, descriptor), model: result.after, owner: { taskId: acceptedOwner.taskId, revision: acceptedOwner.revision, generation: acceptedOwner.generation }, phase: 'prepared' };
  await showCachedReview(candidate, operation);
}
function lockResultPanel() {
  let panel = $('documentResult');
  if (!panel) { panel = document.createElement('section'); panel.id = 'documentResult'; panel.className = 'document-result'; panel.setAttribute('aria-labelledby', 'documentResultHeading'); $('chainRow').before(panel); }
  panel.inert = true; panel.setAttribute('inert', '');
  return panel;
}
async function showCachedReview(candidate, operation) {
  operation.assertCurrent(); if (!same(candidate.owner, snapshot())) throw stale();
  cachedReview = candidate; resultModel = candidate.model; prepared = true; comparison(); $('currentPreview').hidden = true;
  const panel = lockResultPanel(), artifact = candidate.artifact;
  let used = false, reviewing;
  const adopt = (state, current) => {
    if (used || cachedReview !== candidate || operation.signal.aborted || !same(state, snapshot()) || state.taskId !== acceptedOwner?.taskId || current.type !== 'application/pdf' || current.bytes.length !== artifact.bytes.length || !current.bytes.every((value, index) => value === artifact.bytes[index])) return;
    used = true; operation.transfer(state); acceptedOwner = state; candidate.owner = { taskId: state.taskId, revision: state.revision, generation: state.generation }; candidate.phase = 'chosen'; candidate.artifact = current;
    currentModel = candidate.model; fill(currentModel); preview.clear(); identity(); comparison(); postUsePending = true; lockResultPanel(); controls();
    $('metadataStatus').textContent = text('checking_chosen', 'The chosen copy is current. Checking its actual preview before continuing.');
    void reviewing.then(() => {
      operation.assertCurrent(); return showCachedReview(candidate, operation);
    }).catch(error => { if (operation.isCurrent()) showFailure(error); }).finally(() => { if (operation.isCurrent()) { postUsePending = false; controls(); } });
  };
  try {
    reviewing = ui.reviewResult(artifact.bytes, artifact.name, { ...artifact, operation, allowAdopt: candidate.phase !== 'chosen', onAdopt: candidate.phase === 'prepared' ? adopt : undefined });
    const shown = await reviewing; operation.assertCurrent();
    // The shared helper also fulfills after a load/render error. Its fresh
    // canvas gets this page marker only after renderTask.promise succeeds.
    // Keep the whole reused panel inert so an Original switch cannot race it.
    const viewport = shown?.querySelector('#documentResultPreview'), canvas = viewport?.querySelector('canvas');
    const selected = Math.max(1, Math.min(candidate.model.pageCount, (Number.isSafeInteger(snapshot().selection[0]) ? snapshot().selection[0] : 0) + 1));
    if (shown !== panel || panel.hidden || viewport?.getAttribute('aria-busy') !== 'false' || !canvas || canvas.dataset.pdfPage !== String(selected) || canvas.getAttribute('aria-label') !== (artifact.displayName || artifact.name) || !(canvas.width > 0 && canvas.height > 0 && canvas.width <= 900 && canvas.height <= 900 && canvas.width * canvas.height <= 4000000)) throw new Error(text(candidate.phase === 'chosen' ? 'chosen_preview_failed' : 'prepared_preview_failed', candidate.phase === 'chosen' ? 'The chosen copy is retained, but its preview failed. Retry before continuing.' : 'The verified saved copy is retained, but its preview failed. Retry to review it.'));
    operation.assertCurrent();
    if (candidate.phase === 'chosen') {
      await ui.offerChain(artifact.bytes, artifact.name, [{ slug: 'privacy-scan', label: 'Privacy Scan' }, { slug: 'document-doctor', label: 'Document Doctor' }, { slug: 'view-pdf', label: 'Reader' }], { ...artifact, operation, continuationOperation: operation }); operation.assertCurrent(); ready = true;
      $('metadataStatus').textContent = text('chosen', 'This verified copy is current. Download or continue with these exact bytes.');
    } else $('metadataStatus').textContent = text('review_ready', 'The saved copy reopened and its standard fields were verified. Download is explicit. Use it before continuing.');
    panel.inert = false; panel.removeAttribute('inert'); clearFailure();
  } catch (error) {
    if (!operation.isCurrent()) throw error;
    if (candidate.phase === 'chosen') { ready = false; preview.clear(); }
    $('currentPreview').hidden = candidate.phase === 'chosen';
    $('metadataStatus').textContent = text(candidate.phase === 'chosen' ? 'chosen_preview_failed' : 'prepared_preview_failed', candidate.phase === 'chosen' ? 'The chosen copy is retained, but its preview failed. Retry before continuing.' : 'The verified saved copy is retained, but its preview failed. Retry to review it.');
    await ui.clearResultAndDrain(); operation.assertCurrent(); panel.replaceChildren();
    throw error;
  }
}
async function run(request, job) {
  const core = await getCore(); job.assertCurrent(); await request.drain; job.assertCurrent();
  preview ||= core.createMetadataPreview({ canvas: $('metadataCanvas'), ensurePdfJs, pdfjsAssets: PDFJS_ASSET_URLS }); await preview.drained({ retry: !!request.retry }); job.assertCurrent();
  let owner = request.expected;
  const operation = { signal: job.signal, isCurrent: () => request.epoch === epoch && !job.signal.aborted && same(owner, snapshot()), assertCurrent() { if (!this.isCurrent()) throw stale(); }, transfer(next) { owner = { taskId: next.taskId, revision: next.revision, generation: next.generation }; } };
  operation.assertCurrent();
  if (request.kind === 'file') {
    if (unreadRequest === request) unreadRequest = null;
    const file = request.file; request.file = null;
    const parsed = await ui.readPdfFile(file, { validate: true, maxBytes: core.METADATA_LIMITS.inputBytes, maxPages: core.METADATA_LIMITS.pages, operation }); job.assertCurrent();
    if (!parsed) { lastError = true; const message = $('errorText').textContent; if (message.length > 512) ui.showError(message.slice(0, 512).replace(/[\ud800-\udbff]$/, '')); if (ownsAccepted() && ready) await hydrate(operation, core); return; }
    if (!same(parsed.owner, snapshot())) throw stale(); operation.transfer(parsed.owner); acceptedOwner = parsed.owner; ready = false; needsFill = true; $('optionsSection').hidden = true; $('metadataDocumentNames').open = false; identity(); pageIndex = snapshot().selection[0] || 0;
    await hydrate(operation, core, { reset: true }); operation.assertCurrent(); clearFailure();
  } else if (request.kind === 'apply') { await prepare(request, operation, core); }
  else if (request.kind === 'review') { await showCachedReview(request.candidate, operation); }
  else if (request.kind === 'history') {
    const target = ui.documentSession.historyTarget(request.direction);
    if (!target || target.artifact.type !== 'application/pdf') throw new Error(text('history_unavailable', 'This history step is not a PDF. Open it in a compatible workspace.'));
    await core.inspectPdfMetadata(target.artifact.bytes, { pdfLib: await ensurePdfLib(), signal: operation.signal }); operation.assertCurrent(); ui.documentSession[request.direction](); operation.transfer(snapshot()); acceptedOwner = snapshot(); ready = false; needsFill = true; $('optionsSection').hidden = true; pageIndex = snapshot().selection[0] || 0;
    await hydrate(operation, core, { reset: true }); clearFailure();
  } else if (request.kind === 'cleanup') { clearFailure(); $('metadataStatus').textContent = text('empty', 'Choose a PDF of at most 32 MiB and 1000 pages.'); }
  else { await hydrate(operation, core, { retry: !!request.retry }); if (!request.preserveError) clearFailure(); }
}
function submit(kind, details = {}) {
  const ticket = invalidate(); busy = true; ui.hideProgress(); controls();
  const request = { kind, ...details, epoch: ticket, expected: snapshot(), drain: resultDrain }; pendingRequest = request; if (kind === 'file') unreadRequest = request;
  $('metadataStatus').textContent = text('working', 'Working locally. Cancel and Clear remain available; a newer selection waits for native work to finish.');
  const work = getCore().then(core => { if (ticket !== epoch || pendingRequest !== request) throw stale(); pendingRequest = null; queue ||= core.createMetadataWorkQueue(run); return queue.replace(request, { isCurrent: () => ticket === epoch }); });
  void work.catch(error => { if (ticket === epoch) showFailure(error); }).finally(() => { if (ticket === epoch) { busy = false; initialPending = false; controls(); } }); return work;
}
function nativeFile(file, initialIntent) {
  if (!file || initialIntent !== undefined && initialIntent !== localIntent) return;
  localIntent++; initialPending = false; clearFailure(); history.replaceState(null, '', location.pathname); void submit('file', { file }).catch(() => {});
}
function edited() {
  localIntent++; invalidate(); busy = false; clearFailure(); comparison(); controls();
  if (ready && ownsAccepted() && !$('metadataCanvas').width) void submit('preview').catch(() => {});
}
for (const key of fields) {
  $(`${key}Input`).addEventListener('input', edited);
  $(`${key}Replace`).addEventListener('click', () => { replaced.add(key); $(`${key}Input`).value = ''; $(`${key}Replace`).hidden = true; $(`${key}Notice`).textContent = text('replacement', 'This new value will replace the preserved stored value.'); edited(); $(`${key}Input`).focus(); });
}
$('editMode').addEventListener('change', edited); $('clearMode').addEventListener('change', edited);
$('applyBtn').addEventListener('click', () => { if (ready && ownsAccepted() && dirty() && !busy) void submit('apply', { change: { version: 1, mode: mode(), patch: mode() === 'edit' ? patch() : {} } }).catch(() => {}); });
for (const [id, direction] of [['undoBtn', 'undo'], ['redoBtn', 'redo']]) $(id).addEventListener('click', () => { if (!dirty() && ownsAccepted() && !busy) void submit('history', { direction }).catch(() => {}); });
for (const [id, delta] of [['previousPageBtn', -1], ['nextPageBtn', 1]]) $(id).addEventListener('click', () => { if (!ready || busy) return; pageIndex = Math.max(0, Math.min(currentModel.pageCount - 1, pageIndex + delta)); ui.documentSession.setSelection([pageIndex]); const candidate = cachedReview; void (candidate && same(candidate.owner, snapshot()) ? submit('review', { candidate }) : submit('preview', { preserveError: lastError })).catch(() => {}); });
$('retryBtn').addEventListener('click', () => { const file = pendingRequest?.file, candidate = cachedReview; if (file) nativeFile(file); else if (candidate && same(candidate.owner, snapshot())) void submit('review', { candidate, retry: true }).catch(() => {}); else if (ownsAccepted()) void submit('preview', { retry: true }).catch(() => {}); else if (preview) void submit('cleanup', { retry: true }).catch(() => {}); });
$('cancelBtn').addEventListener('click', () => {
  localIntent++; const candidate = cachedReview, ticket = invalidate(); if (candidate && same(candidate.owner, snapshot())) cachedReview = candidate; busy = true; preview?.clear(); controls();
  void Promise.all([queue?.drained(), resultDrain]).then(() => preview?.drained()).then(() => { if (ticket === epoch) { $('metadataStatus').textContent = text('canceled', 'Canceled. The accepted task and your draft are retained. Retry its preview when ready.'); $('retryBtn').hidden = !acceptedOwner; } }).catch(error => { if (ticket === epoch) showFailure(error); }).finally(() => { if (ticket === epoch) { busy = false; controls(); } });
});
$('clearBtn').addEventListener('click', () => {
  localIntent++; const owned = ownsAccepted(), ticket = invalidate(); busy = true; preview?.clear();
  if (owned) ui.documentSession.clear(); acceptedOwner = currentModel = originalModel = resultModel = null; ready = needsFill = false; replaced.clear(); $('optionsSection').hidden = true; resetIdentity(); $('metadataPage').textContent = ''; for (const key of fields) $(`${key}Input`).value = '';
  history.replaceState(null, '', location.pathname); clearFailure(); controls();
  void Promise.all([queue?.drained(), resultDrain]).then(() => preview?.drained()).catch(error => { if (ticket === epoch) showFailure(error); }).finally(() => { if (ticket === epoch) { const panel = $('documentResult'); if (panel) { panel.replaceChildren(); panel.inert = true; panel.setAttribute('inert', ''); } busy = false; $('metadataStatus').textContent = text('empty', 'Choose a PDF of at most 32 MiB and 1000 pages.'); controls(); } });
});
ui.wireDropzone($('dropzone'), $('fileInput'), files => nativeFile(files[0]));
const params = new URLSearchParams(location.search), workflow = params.get('workflow'), file = params.get('file');
if (workflow && file?.startsWith(`${workflow}:`)) {
  const initialIntent = localIntent; initialPending = true; controls(); $('metadataStatus').textContent = text('restoring', 'Restoring the chosen PDF. You can choose another file or clear this request.');
  void ui.takeChainedFile({ isCurrent: () => initialIntent === localIntent }).then(file => { if (file && initialIntent === localIntent) nativeFile(file, initialIntent); }).finally(() => { if (initialIntent === localIntent) { initialPending = false; controls(); } });
}
controls();
