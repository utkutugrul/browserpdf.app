import * as ui from './tool-ui.js';
import { t, getLang } from './i18n.js';
import { openReaderWorkspace } from './reader-workspace.js';
import { ensurePdfLib, ensurePdfJs, PDFJS_ASSET_URLS } from './lib-loader.js';
import { viewportRectToPdf, pdfPointToViewport } from './core/page-geometry.js';
import { inspectRedaction, redactPdf, REDACTION_LIMITS } from './core/redaction.js';
import { createImageWorkLane } from './core/image-intake.js';

const node = (tag, id, text) => { const value = document.createElement(tag); if (id) value.id = id; if (text) value.textContent = text; return value; };
const button = (id, text) => { const value = node('button', id, text); value.type = 'button'; value.className = 'btn btn-ghost btn-small'; return value; };
let stylesheet;
function style() { return stylesheet ||= new Promise((resolve, reject) => { const link = node('link'); link.rel = 'stylesheet'; link.href = new URL('../css/redact-workspace.css', import.meta.url).href; link.onload = resolve; link.onerror = () => { link.remove(); stylesheet = null; reject(new Error('Could not load Redact. Try opening the PDF again.')); }; document.head.append(link); }); }
function host() {
  const section = node('section', 'viewerSection'); section.className = 'result-section'; section.hidden = true;
  const toolbar = node('div'); toolbar.className = 'result-toolbar'; const pages = node('div'); pages.className = 'btn-row';
  pages.append(button('prevPageBtn', 'Previous'), node('span', 'pageIndicator'), button('nextPageBtn', 'Next'));
  const zoom = node('div'); zoom.className = 'result-actions'; zoom.append(button('zoomOutBtn', 'Zoom out'), node('span', 'zoomLevel', '100%'), button('zoomInBtn', 'Zoom in'), button('fitWidthBtn', 'Fit width'), button('printBtn', 'Print'));
  toolbar.append(pages, zoom); const container = node('div', 'viewerContainer'); container.className = 'viewer-canvas-container'; container.append(node('canvas', 'pdfCanvas')); section.append(toolbar, container);
  document.getElementById('redactSection').before(section); return section;
}
const clone = (value) => value.map((mask) => ({ ...mask }));
const sameOwner = (a, b) => a.taskId === b.taskId && a.revision === b.revision && a.generation === b.generation;

export async function openRedactWorkspace(parsed, { isCurrent, signal, onClear }) {
  await style(); signal.throwIfAborted(); if (!isCurrent()) throw new DOMException('The document was replaced.', 'AbortError');
  const section = host(), lifetime = new AbortController(), lane = createImageWorkLane(), work = new Set();
  let reader, pageModel, disposed = false, opening = true, masks = [], past = [], future = [], selected = null, drag = null;
  let epoch = 0, controller, estimateTimer, busy = false, estimating = false, draining = false, suspended = false, dirty = false;
  let verifiedPreviewOwner = null, previewAttempt = 0, preview = { phase: 'pending', target: null, cause: 'opening', attempt: 0 };
  const alive = () => !disposed && !lifetime.signal.aborted && isCurrent();
  const listen = (target, event, handler, options = {}) => target.addEventListener(event, handler, { ...options, signal: lifetime.signal });
  const track = (promise) => { work.add(promise); void promise.then(() => work.delete(promise), () => work.delete(promise)); return promise; };
  const layer = node('div', 'redactMaskLayer'); layer.setAttribute('aria-label', t('redact.mask_surface', 'Draw redaction masks on this PDF page')); layer.tabIndex = 0;
  const actions = node('div', 'redactActions'), add = button('redactAddMaskBtn', t('redact.add_mask', 'Add mask'));
  const apply = button('redactApplyBtn', t('redact.review', 'Review redacted PDF')); apply.classList.add('btn-primary');
  const cancel = button('redactCancelBtn', t('common.cancel', 'Cancel')), undo = button('redactUndoMaskBtn', t('redact.undo_mask', 'Undo mask')), redo = button('redactRedoMaskBtn', t('redact.redo_mask', 'Redo mask'));
  actions.append(add, apply, undo, redo, cancel);
  const status = node('p', 'redactStatus', t('redact.draw_help', 'Drag on the PDF to add a mask. Select a mask to move or resize it.')); status.setAttribute('role', 'status');
  const estimate = node('p', 'redactEstimate'); estimate.setAttribute('role', 'status');
  const panel = node('details', 'redactPanel'), summary = node('summary'); panel.append(summary);
  const help = node('p', null, t('redact.keyboard_help', 'Arrow keys move a selected mask; Shift + arrows resize; Delete removes it. Mask Undo keeps the last five changes. Masks are drafts until you review and use the result.'));
  const list = node('select', 'redactMaskList'); list.setAttribute('aria-label', t('redact.choose_mask', 'Redaction mask'));
  const properties = node('form', 'redactProperties'), values = {}, coordinateDraft = new Set();
  for (const [key, label] of [['X', 'X'], ['Y', 'Y'], ['Width', 'Width'], ['Height', 'Height']]) { const control = node('input', `redactMask${key}`); control.type = 'number'; control.step = 'any'; values[key.toLowerCase()] = control; const wrapper = node('label', null, t(`redact.mask_${key.toLowerCase()}`, `${label} (PDF units)`)); wrapper.append(control); properties.append(wrapper); }
  const save = button('redactSaveMaskBtn', t('redact.save_mask', 'Save mask')); save.type = 'submit';
  const discardCoordinates = button('redactDiscardCoordinatesBtn', t('redact.discard_coordinates', 'Discard coordinate changes'));
  const remove = button('redactDeleteMaskBtn', t('redact.delete_mask', 'Delete mask')), discard = button('redactDiscardMasksBtn', t('redact.discard_masks', 'Discard masks'));
  const propertyActions = node('div'); propertyActions.className = 'btn-row'; propertyActions.append(save, discardCoordinates, remove, discard); properties.append(propertyActions); panel.append(help, list, properties);
  const output = node('details', 'redactOutputOptions'); output.append(node('summary', null, t('redact.output_options', 'Output and loss settings')));
  const mode = node('select', 'redactOutputMode'); for (const [value, label] of [['hybrid', 'Keep text on supported untouched pages'], ['raster', 'Rebuild every page as an image']]) { const option = node('option', null, t(`redact.mode_${value}`, label)); option.value = value; mode.append(option); }
  const resolution = node('select', 'redactResolution'); for (const [value, label] of [['2', '2× · 144 dpi'], ['1', '1× · 72 dpi']]) { const option = node('option', null, label); option.value = value; resolution.append(option); }
  for (const [control, label] of [[mode, 'Output mode'], [resolution, 'Raster resolution']]) { const wrapper = node('label', null, t(`redact.label_${control.id}`, label)); wrapper.append(control); output.append(wrapper); }
  const losses = node('p', 'redactLossSummary');
  const consentLabel = node('label', 'redactRasterConsentLabel'), consent = node('input', 'redactRasterConsent'); consent.type = 'checkbox'; consentLabel.append(consent, document.createTextNode(t('redact.consent', 'I understand that every page loses searchable text, editable fields and annotations, links, bookmarks, attachments, tags and vector detail. Existing digital signatures are invalidated.'))); output.append(losses, consentLabel);
  const fallback = node('div', 'redactFallbackPanel'), reason = node('p', 'redactUnsupportedReason'), chooseRaster = button('redactChooseRasterBtn', t('redact.choose_raster', 'Choose whole-document raster mode')); fallback.hidden = true; fallback.append(reason, chooseRaster);
  const documentActions = node('div', 'redactDocumentActions'), undoDocument = button('redactUndoDocumentBtn', t('redact.undo_document', 'Undo chosen result')), redoDocument = button('redactRedoDocumentBtn', t('redact.redo_document', 'Redo chosen result')), retry = button('redactRetryBtn', t('redact.retry', 'Retry current preview')), clear = button('redactClearDocumentBtn', t('workspace.clear_document', 'Clear document'));
  documentActions.className = 'btn-row'; documentActions.append(undoDocument, redoDocument, retry);
  const selectedMask = () => masks.find((mask) => mask.id === selected);
  const previewMatchesCurrent = () => !!verifiedPreviewOwner && sameOwner(verifiedPreviewOwner, ui.documentSession.snapshot());
  const previewAvailable = () => preview.phase === 'ready' && previewMatchesCurrent();
  const locked = () => busy || suspended || draining || !previewAvailable();
  function controls() {
    if (!alive()) return;
    if (preview.phase === 'ready' && !previewMatchesCurrent()) { preview = { phase: 'blocked', target: ui.documentSession.snapshot(), cause: 'changed', attempt: ++previewAttempt }; ui.clearResult(); }
    const state = ui.documentSession.snapshot(), value = selectedMask(), disabled = locked();
    add.disabled = disabled || dirty || !reader?.ready || masks.length >= REDACTION_LIMITS.masks;
    apply.disabled = disabled || dirty || !reader?.ready || !masks.length || mode.value === 'raster' && !consent.checked;
    undo.disabled = disabled || dirty || !past.length; redo.disabled = disabled || dirty || !future.length; cancel.disabled = suspended || !busy && !estimating && !draining && preview.phase !== 'pending';
    list.disabled = disabled || dirty; remove.disabled = disabled || dirty || !value; discard.disabled = disabled || dirty || !masks.length;
    for (const control of Object.values(values)) control.disabled = disabled || !value; save.disabled = disabled || !dirty || !value; discardCoordinates.disabled = disabled || !dirty;
    mode.disabled = resolution.disabled = consent.disabled = disabled || dirty;
    undoDocument.disabled = disabled || dirty || !!masks.length || !state.canUndo; redoDocument.disabled = disabled || dirty || !!masks.length || !state.canRedo;
    retry.hidden = preview.phase !== 'blocked'; retry.disabled = busy || suspended || draining;
    consentLabel.hidden = mode.value !== 'raster';
    losses.textContent = mode.value === 'raster' ? t('redact.full_loss', 'Every page becomes an image. Source Info/XMP and interactive/document structures are omitted. Review the actual copy before using it.') : t('redact.selected_loss', 'Pages with masks become images and lose selectable text and vector detail. Supported untouched pages keep their text. Source Info/XMP is omitted. Unsupported graphs require an explicit whole-document raster choice.');
    summary.textContent = t('redact.mask_count', 'Masks ({n})', { n: masks.length });
    reader?.setDisabled(busy || suspended || draining || !previewAvailable() || dirty);
    for (const target of [reader?.surface, reader?.panels, reader?.status]) if (target) { target.inert = !previewAvailable(); target.setAttribute('aria-hidden', String(!previewAvailable())); }
    layer.setAttribute('aria-disabled', String(disabled || dirty));
    section.dataset.redactBusy = String(busy || suspended || draining || preview.phase === 'pending'); section.dataset.redactMasks = String(masks.length); section.dataset.redactPreviewState = preview.phase;
  }
  function propertiesSync() {
    list.replaceChildren(); const empty = node('option', null, t('redact.select_mask', 'Select a mask')); empty.value = ''; list.append(empty);
    masks.forEach((mask, index) => { const option = node('option', null, t('redact.mask_label', 'Page {page}, mask {n}', { page: mask.pageIndex + 1, n: index + 1 })); option.value = mask.id; list.append(option); }); list.value = selected || '';
    const value = selectedMask(); if (!dirty) { coordinateDraft.clear(); for (const [key, control] of Object.entries(values)) control.value = value ? String(Math.round(value[key] * 10000) / 10000) : ''; }
    controls();
  }
  function size() { return { width: pageModel.surface.clientWidth, height: pageModel.surface.clientHeight }; }
  function visual(mask) {
    const points = [[mask.x, mask.y], [mask.x + mask.width, mask.y + mask.height]].map(([x, y]) => pdfPointToViewport(pageModel.viewport, x, y, size()));
    return { x: Math.min(points[0][0], points[1][0]), y: Math.min(points[0][1], points[1][1]), width: Math.abs(points[0][0] - points[1][0]), height: Math.abs(points[0][1] - points[1][1]) };
  }
  function paint(preview) {
    if (!pageModel || !alive()) return;
    const focused = layer.contains(document.activeElement) && document.activeElement.dataset.maskId;
    layer.replaceChildren();
    for (const mask of masks) {
      if (mask.pageIndex !== pageModel.pageIndex) continue;
      const value = preview?.id === mask.id ? preview : mask, rect = visual(value), control = button(null, ''); control.className = 'redact-mask'; control.dataset.maskId = mask.id; control.setAttribute('aria-label', t('redact.mask_page', 'Redaction mask on page {page}', { page: mask.pageIndex + 1 })); control.setAttribute('aria-pressed', String(selected === mask.id));
      Object.assign(control.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      const handle = node('span'); handle.className = 'redact-resize'; handle.dataset.resize = 'true'; handle.setAttribute('aria-hidden', 'true'); control.append(handle); layer.append(control);
    }
    if (preview && !preview.id) { const rect = visual(preview), box = node('div'); box.className = 'redact-mask redact-mask-draft'; Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }); layer.append(box); }
    if (focused) layer.querySelector(`[data-mask-id="${focused}"]`)?.focus({ preventScroll: true });
  }
  function invalidate() { clearTimeout(estimateTimer); epoch++; controller?.abort(); ui.clearResult(); estimating = false; }
  function operation() { clearTimeout(estimateTimer); controller?.abort(); const id = ++epoch, control = new AbortController(); controller = control; return { signal: control.signal, isCurrent: () => alive() && id === epoch && !control.signal.aborted && !suspended }; }
  function commit(next, id = selected) {
    if (!alive() || locked()) return;
    const counts = new Map(); for (const mask of next) counts.set(mask.pageIndex, (counts.get(mask.pageIndex) || 0) + 1);
    if (next.length > 300 || [...counts.values()].some((count) => count > 100)) { ui.showError(t('redact.mask_limit', 'This task supports 300 masks and 100 per page. Previous masks were retained.')); return; }
    const history = [...past, clone(masks)].slice(-5);
    if (JSON.stringify({ next, history }).length > 1024 * 1024) { ui.showError('The mask history exceeds its 1 MiB limit. Previous masks were retained.'); return; }
    invalidate(); dirty = false; past = history; future = []; masks = clone(next); selected = id && next.some((mask) => mask.id === id) ? id : null; fallback.hidden = true; paint(); propertiesSync(); scheduleEstimate();
  }
  function clamp(rect) {
    const bounds = size(), minimum = 1; const width = Math.min(bounds.width, Math.max(minimum, rect.width)), height = Math.min(bounds.height, Math.max(minimum, rect.height));
    return { x: Math.max(0, Math.min(bounds.width - width, rect.x)), y: Math.max(0, Math.min(bounds.height - height, rect.y)), width, height };
  }
  function fromVisual(rect, id) { const pdf = viewportRectToPdf(pageModel.viewport, clamp(rect), size()); return { id, pageIndex: pageModel.pageIndex, x: pdf.x, y: pdf.y, width: pdf.width, height: pdf.height }; }
  function point(event) { const box = layer.getBoundingClientRect(); return { x: Math.max(0, Math.min(box.width, event.clientX - box.left)), y: Math.max(0, Math.min(box.height, event.clientY - box.top)) }; }
  function onPage(value) { pageModel = value; drag = null; value.surface.append(layer); if (!dirty && selectedMask()?.pageIndex !== value.pageIndex) selected = null; paint(); propertiesSync(); }
  function describe(inspection) {
    if (!inspection.supported) { fallback.hidden = false; reason.textContent = inspection.reason; estimate.textContent = t('redact.unsupported_estimate', 'The text-preserving path is unsupported. Choose and acknowledge whole-document raster losses to continue.'); return; }
    fallback.hidden = true;
    const first = inspection.rasterPages.slice(0, 3).map((page) => `${page.pageIndex + 1}: ${page.width}×${page.height}`).join(' · ');
    estimate.textContent = t('redact.estimate', '{n} raster pages · {pixels} pixels · {dpi} dpi · about {memory} MiB decoded channels, plus one canvas and codec memory. Page pixels: {sizes}. Maximum 48 million pixels / 96 MiB output.', { n: inspection.rasterPages.length, pixels: inspection.totalPixels.toLocaleString(), dpi: 72 * Number(resolution.value), memory: (inspection.totalPixels * 4 / 1024 / 1024).toFixed(1), sizes: first });
  }
  async function environment(op) { const [pdfLib, pdfjs] = await Promise.all([ensurePdfLib(), ensurePdfJs()]); op.signal.throwIfAborted(); return { pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, signal: op.signal, canvasFactory: () => node('canvas'), encodeCanvas: async (canvas) => { const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Page image encoding failed.')), 'image/png')); return new Uint8Array(await blob.arrayBuffer()); } }; }
  function chosenOptions() { return { masks: masks.map(({ id, ...mask }) => mask), mode: mode.value, scale: Number(resolution.value) }; }
  function scheduleEstimate() {
    clearTimeout(estimateTimer); if (!masks.length) { estimate.textContent = ''; return; }
    estimateTimer = setTimeout(() => { if (alive() && !locked()) void track(estimateNow()); }, 120);
  }
  async function estimateNow() {
    const op = operation(), owner = ui.documentSession.snapshot(), owns = () => op.isCurrent() && sameOwner(owner, ui.documentSession.snapshot()); estimating = true; controls();
    try { const input = await lane.run(() => ui.getWorkspaceInput({ operation: { ...op, isCurrent: owns } }), { signal: op.signal }); if (!owns() || !input) return; const env = await environment(op); if (!owns()) return; const result = await lane.run(() => inspectRedaction(input.bytes, chosenOptions(), env), { signal: op.signal }); if (owns()) describe(result); }
    catch (error) { if (owns() && error.name !== 'AbortError') estimate.textContent = error.message; }
    finally { if (op.isCurrent()) { estimating = false; controls(); } }
  }
  async function rail(artifact, op) { if (!previewAvailable()) return; await ui.offerChain(artifact.bytes, artifact.name, [{ slug: 'privacy-scan', label: 'Privacy Scan' }, { slug: 'view-pdf', label: 'Reader' }], { ...artifact, operation: op, continuationOperation: { signal: op.signal, isCurrent: () => alive() && !suspended && previewAvailable() && !op.signal.aborted && controller?.signal === op.signal } }); }
  async function presentChosen(op) {
    const owner = ui.documentSession.snapshot(), current = ui.documentSession.current();
    if (!previewAvailable() || masks.length || dirty || current?.boundary?.kind !== 'raster-redaction') return;
    const owned = { signal: op.signal, isCurrent: () => op.isCurrent() && previewAvailable() && !masks.length && !dirty && sameOwner(owner, ui.documentSession.snapshot()) };
    await ui.reviewResult(current.bytes, current.name, { ...current, allowAdopt: false, operation: owned, imageWorkLane: lane });
    if (owned.isCurrent()) await rail(current, owned);
  }
  function pendingPreview(cause) {
    preview = { phase: 'pending', target: ui.documentSession.snapshot(), cause, attempt: ++previewAttempt };
    ui.clearResult(); status.textContent = t('redact.preview_preparing', 'Preparing the actual current PDF preview…'); controls(); return preview;
  }
  function blockedPreview() {
    preview = { ...preview, phase: 'blocked', target: ui.documentSession.snapshot() };
    status.textContent = t('redact.preview_paused', 'The current document remains selected. Its preview is not ready. Retry current preview, replace the PDF or clear the document.'); controls();
  }
  async function synchronizePreview(op, cause, message) {
    const attempt = pendingPreview(cause);
    try {
      const refreshed = await reader.refresh({ operation: op });
      if (!op.isCurrent() || preview !== attempt) return false;
      if (!sameOwner(attempt.target, ui.documentSession.snapshot())) { blockedPreview(); return false; }
      if (refreshed !== true) throw new Error('The current PDF preview was not verified. Retry current preview.');
      // The refresh promise includes candidate preparation, swap and cleanup.
      // A generic busy/cancel finally must never acknowledge a different PDF.
      verifiedPreviewOwner = attempt.target; preview = { ...attempt, phase: 'ready' }; ui.hideError(); controls(); status.textContent = message;
    } catch (error) {
      if (op.isCurrent() && preview === attempt) { blockedPreview(); if (error.name !== 'AbortError') ui.showError(error.message); }
      return false;
    }
    try { if (op.isCurrent() && previewAvailable()) await presentChosen(op); }
    catch (error) { if (op.isCurrent() && error.name !== 'AbortError') ui.showError(error.message); }
    return true;
  }
  async function review() {
    if (apply.disabled) return;
    const base = operation(); let owner = ui.documentSession.snapshot(); const op = { signal: base.signal, isCurrent: () => base.isCurrent() && sameOwner(owner, ui.documentSession.snapshot()) };
    busy = true; estimating = false; ui.hideError(); ui.clearResult(); controls(); status.textContent = t('redact.preparing', 'Checking scope and preparing the redacted copy…');
    try {
      const input = await lane.run(() => ui.getWorkspaceInput({ operation: op }), { signal: op.signal }); if (!op.isCurrent() || !input) return;
      const env = await environment(op); if (!op.isCurrent()) return; const options = chosenOptions();
      const inspection = await lane.run(() => inspectRedaction(input.bytes, options, env), { signal: op.signal }); if (!op.isCurrent()) return; describe(inspection); if (!inspection.supported) { output.open = true; chooseRaster.focus(); return; }
      if (options.mode === 'raster' && !consent.checked) return;
      const result = await lane.run(() => redactPdf(input.bytes, options, { ...env, onProgress(value) { if (op.isCurrent()) status.textContent = t('redact.progress', 'Rebuilding page {page} of {total}…', { page: value.completed, total: value.total }); } }), { signal: op.signal });
      if (!op.isCurrent()) return;
      const artifact = { ...result, name: `${parsed.baseName}-redacted.pdf`, boundary: { ...result.boundary, losses: [...new Set([...result.boundary.losses, ...input.losses])] } };
      await ui.reviewResult(artifact.bytes, artifact.name, { ...artifact, operation: op, imageWorkLane: lane, onAdopt(next) {
        if (!base.isCurrent()) return; owner = { taskId: next.taskId, revision: next.revision, generation: next.generation }; masks = []; past = []; future = []; selected = null; dirty = false; consent.checked = false; busy = true;
        const refreshing = synchronizePreview(op, 'adopt', t('redact.chosen', 'The reviewed redacted copy is current. Undo chosen result restores the preceding editable task.')); paint(); propertiesSync();
        void track(refreshing.finally(() => { if (base.isCurrent()) { busy = false; controls(); } }));
      } }); if (!op.isCurrent()) return;
      // Continuation requires deliberate Use and the owned current-preview refresh.
      if (op.isCurrent()) status.textContent = t('redact.review_ready', 'Review the actual result below. Use this cleaned result to continue. Download saves only the cleaned PDF.');
    } catch (error) { if (op.isCurrent() && error.name !== 'AbortError') { if (error.name === 'RedactionUnsupportedError') { fallback.hidden = false; reason.textContent = error.message; output.open = true; } else ui.showError(error.message); } }
    finally { if (base.isCurrent()) { busy = false; controls(); } }
  }
  async function refreshCurrent() {
    const op = operation(); busy = true;
    try { await synchronizePreview(op, 'retry', t('redact.preview_ready', 'The actual current PDF is ready.')); }
    finally { if (op.isCurrent()) { busy = false; controls(); } }
  }
  async function documentHistory(kind) {
    if (locked() || dirty || masks.length) return;
    const op = operation(); busy = true; const attempt = pendingPreview(kind);
    try {
      const composition = await ui.restoreCompositionHistory(kind, { operation: op }); if (!op.isCurrent()) return;
      if (composition) { if (composition.handoff.isCurrent()) { const lang = getLang(); location.href = `${lang === 'en' ? '' : '/' + lang}/${composition.targetSlug}?workflow=${encodeURIComponent(composition.handoff.workflowId)}&file=${encodeURIComponent(composition.handoff.fileId)}`; } else blockedPreview(); return; }
      if (!ui.documentSession.historyTarget(kind)) { if (preview === attempt && previewMatchesCurrent()) preview = { ...attempt, phase: 'ready' }; else blockedPreview(); return; }
      ui.documentSession[kind](); ui.showDocumentIdentity();
      await synchronizePreview(op, kind, t('redact.history_restored', 'The preceding chosen document and its editable task state were restored.'));
    } catch (error) { if (op.isCurrent()) { blockedPreview(); if (error.name !== 'AbortError') ui.showError(error.message); } }
    finally { if (op.isCurrent()) { busy = false; controls(); } }
  }
  async function cancelWork() {
    invalidate(); drag = null; busy = estimating = false; draining = true; const canceled = epoch; controls(); paint(); status.textContent = t('redact.draining', 'Canceled. Finishing abandoned native image work before continuing…');
    await Promise.allSettled([lane.drained(), ...work]);
    if (alive() && canceled === epoch) {
      draining = false;
      // Preserve an already verified same-current preview. A chosen/history
      // version that never completed refresh stays inaccessible until Retry.
      if (previewMatchesCurrent()) { preview = { ...preview, phase: 'ready', target: verifiedPreviewOwner }; controls(); status.textContent = t('redact.canceled', 'Canceled. Your document and mask drafts were retained.'); }
      else blockedPreview();
    }
  }
  function maskHistory(kind) {
    if (locked() || dirty) return; const source = kind === 'undo' ? past : future, target = kind === 'undo' ? future : past; if (!source.length) return;
    invalidate(); target.push(clone(masks)); if (target.length > 5) target.shift(); masks = source.pop(); selected = null; paint(); propertiesSync(); scheduleEstimate();
  }
  function dispose() { if (disposed) return; disposed = true; invalidate(); lifetime.abort(); reader?.dispose(); layer.remove(); actions.remove(); status.remove(); estimate.remove(); panel.remove(); output.remove(); fallback.remove(); documentActions.remove(); clear.remove(); if (!opening) section.remove(); document.body.classList.remove('redact-loaded'); }
  signal.addEventListener('abort', dispose, { once: true });
  try {
    const initialOwner = ui.documentSession.snapshot();
    reader = await openReaderWorkspace(parsed, { isCurrent: alive, signal: lifetime.signal, mode: 'redact', onPage, beforeContinueMode() { if (!previewAvailable()) { blockedPreview(); return false; } if (masks.length || busy || suspended || draining || dirty) { status.textContent = dirty ? t('redact.finish_coordinates', 'Save or discard coordinate changes before reviewing, changing pages or continuing.') : t('redact.finish_masks', 'Use the reviewed result or explicitly discard mask drafts before changing tools.'); if (masks.length) { panel.open = true; (dirty ? save : discard).focus(); } return false; } return true; } });
    opening = false; if (!alive()) { dispose(); section.remove(); throw new DOMException('The document was replaced.', 'AbortError'); }
    // Bootstrap from Reader's completed initial open; subsequent versions are
    // acknowledged only by synchronizePreview after refresh returns true.
    if (reader.ready === true && sameOwner(initialOwner, ui.documentSession.snapshot())) { verifiedPreviewOwner = initialOwner; preview = { phase: 'ready', target: initialOwner, cause: 'opening', attempt: ++previewAttempt }; } else blockedPreview();
    reader.generated.append(panel, output); document.getElementById('viewerContainer').after(actions, status, estimate, fallback, documentActions); document.getElementById('readerReplace').append(clear); document.body.classList.add('redact-loaded');
    propertiesSync(); paint();
    listen(layer, 'pointerdown', (event) => {
      if (locked() || dirty || !reader.ready || event.button !== 0) return; event.preventDefault(); event.stopPropagation(); const target = event.target.closest('[data-mask-id]'), value = target && masks.find((mask) => mask.id === target.dataset.maskId), start = point(event);
      selected = value?.id || null; drag = { pointerId: event.pointerId, start, original: value && { ...value }, rect: value && visual(value), resize: !!event.target.dataset.resize, pageIndex: pageModel.pageIndex, viewport: pageModel.viewport }; layer.setPointerCapture(event.pointerId); paint(); propertiesSync();
    });
    function dragged(event) { const end = point(event), start = drag.start; if (drag.original) { const rect = { ...drag.rect }; if (drag.resize) { rect.width += end.x - start.x; rect.height += end.y - start.y; } else { rect.x += end.x - start.x; rect.y += end.y - start.y; } return fromVisual(rect, drag.original.id); } return fromVisual({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) }); }
    listen(layer, 'pointermove', (event) => { if (drag && event.pointerId === drag.pointerId && pageModel.viewport === drag.viewport) { event.preventDefault(); paint(dragged(event)); } });
    listen(layer, 'pointerup', (event) => { if (!drag || event.pointerId !== drag.pointerId) return; event.preventDefault(); event.stopPropagation(); const previous = drag, next = dragged(event); drag = null; try { layer.releasePointerCapture(event.pointerId); } catch {} if (pageModel.viewport !== previous.viewport || previous.pageIndex !== pageModel.pageIndex) { paint(); return; } if (previous.original && Math.abs(point(event).x - previous.start.x) < .5 && Math.abs(point(event).y - previous.start.y) < .5) { paint(); propertiesSync(); return; } if (!previous.original && Math.abs(point(event).x - previous.start.x) < 3 && Math.abs(point(event).y - previous.start.y) < 3) { paint(); return; } if (previous.original) commit(masks.map((mask) => mask.id === next.id ? next : mask), next.id); else { next.id = crypto.randomUUID(); commit([...masks, next], next.id); } layer.querySelector(`[data-mask-id="${next.id}"]`)?.focus({ preventScroll: true }); });
    listen(layer, 'pointercancel', () => { drag = null; paint(); });
    listen(layer, 'lostpointercapture', () => { if (drag) { drag = null; paint(); } });
    listen(layer, 'keydown', (event) => {
      const target = event.target.closest('[data-mask-id]'); if (target) selected = target.dataset.maskId; const value = selectedMask(); if (!value || locked() || dirty) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace', 'Escape'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
      if (event.key === 'Delete' || event.key === 'Backspace') { commit(masks.filter((mask) => mask.id !== selected), null); return; }
      if (event.key === 'Escape') { selected = null; layer.focus(); paint(); propertiesSync(); return; }
      if (!event.key.startsWith('Arrow')) return;
      // Reader's onPage viewport is logical; its CSS dimensions are floored
      // independently (docs/reader-checkpoint.md, controlled refresh contract).
      // Project default-space unit vectors through that exact CSS viewport.
      const origin = pdfPointToViewport(pageModel.viewport, 0, 0, size()), unitX = pdfPointToViewport(pageModel.viewport, 1, 0, size()), unitY = pdfPointToViewport(pageModel.viewport, 0, 1, size());
      const amount = event.altKey ? 10 : 1, stepX = Math.max(Math.abs(unitX[0] - origin[0]), Math.abs(unitY[0] - origin[0])) * amount, stepY = Math.max(Math.abs(unitX[1] - origin[1]), Math.abs(unitY[1] - origin[1])) * amount;
      const rect = visual(value), dx = event.key === 'ArrowLeft' ? -stepX : event.key === 'ArrowRight' ? stepX : 0, dy = event.key === 'ArrowUp' ? -stepY : event.key === 'ArrowDown' ? stepY : 0;
      if (event.shiftKey) { rect.width += dx; rect.height += dy; } else { rect.x += dx; rect.y += dy; }
      const next = fromVisual(rect, value.id);
      // Inverse transforms can add floating noise to an exact one-unit key
      // action. Snap only that noise; retain genuinely clamped partial steps.
      for (const key of ['x', 'y', 'width', 'height']) { const delta = next[key] - value[key], exact = Math.round(delta / amount) * amount; if (Math.abs(delta - exact) < 1e-7) next[key] = value[key] + exact; }
      commit(masks.map((mask) => mask.id === value.id ? next : mask), value.id);
    });
    listen(layer, 'focusin', (event) => { if (event.target.dataset.maskId) { selected = event.target.dataset.maskId; propertiesSync(); } });
    listen(add, 'click', () => { const bounds = size(), value = fromVisual({ x: bounds.width * .2, y: bounds.height * .35, width: bounds.width * .6, height: bounds.height * .1 }, crypto.randomUUID()); commit([...masks, value], value.id); const placed = layer.querySelector(`[data-mask-id="${value.id}"]`); placed?.focus({ preventScroll: true }); placed?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
    listen(list, 'change', () => { selected = list.value || null; const value = selectedMask(); if (value && value.pageIndex !== reader.pageIndex) void reader.render(value.pageIndex); else { paint(); propertiesSync(); } });
    listen(properties, 'submit', (event) => { event.preventDefault(); if (save.disabled) return; if (Object.values(values).some((control) => !control.value.trim())) { ui.showError(t('redact.invalid_mask', 'Enter a nonempty mask fully inside this visible PDF page. Previous masks were retained.')); return; } const value = selectedMask(), next = { ...value, ...Object.fromEntries([...coordinateDraft].map((key) => [key, Number(values[key].value)])) }, view = pageModel.page.view;
      if (![next.x, next.y, next.width, next.height].every(Number.isFinite) || next.width <= 0 || next.height <= 0 || next.x < view[0] || next.y < view[1] || next.x + next.width > view[2] || next.y + next.height > view[3]) { ui.showError(t('redact.invalid_mask', 'Enter a nonempty mask fully inside this visible PDF page. Previous masks were retained.')); return; } commit(masks.map((mask) => mask.id === value.id ? next : mask), value.id); });
    for (const [key, control] of Object.entries(values)) listen(control, 'input', () => { if (locked() || !selectedMask()) return; if (!reader.ready) { propertiesSync(); status.textContent = t('redact.wait_page', 'Wait for the current page before editing mask coordinates.'); return; } invalidate(); dirty = true; coordinateDraft.add(key); status.textContent = t('redact.finish_coordinates', 'Save or discard coordinate changes before reviewing, changing pages or continuing.'); controls(); });
    listen(discardCoordinates, 'click', () => { dirty = false; propertiesSync(); status.textContent = t('redact.coordinates_retained', 'Saved mask coordinates retained.'); scheduleEstimate(); });
    listen(remove, 'click', () => commit(masks.filter((mask) => mask.id !== selected), null)); listen(discard, 'click', () => commit([], null));
    listen(undo, 'click', () => maskHistory('undo')); listen(redo, 'click', () => maskHistory('redo')); listen(apply, 'click', () => track(review())); listen(cancel, 'click', cancelWork);
    listen(mode, 'change', () => { invalidate(); consent.checked = false; controls(); scheduleEstimate(); }); listen(resolution, 'change', () => { invalidate(); controls(); scheduleEstimate(); }); listen(consent, 'change', controls);
    listen(chooseRaster, 'click', () => { invalidate(); mode.value = 'raster'; consent.checked = false; output.open = true; controls(); consent.focus(); scheduleEstimate(); });
    listen(undoDocument, 'click', () => track(documentHistory('undo'))); listen(redoDocument, 'click', () => track(documentHistory('redo'))); listen(retry, 'click', () => track(refreshCurrent())); listen(clear, 'click', onClear);
    return { dispose, settled: () => Promise.allSettled([lane.drained(), ...work]), suspend() { if (!alive()) return; suspended = true; invalidate(); drag = null; busy = estimating = false; controls(); paint(); }, async resume() { await Promise.allSettled([lane.drained(), ...work]); if (!alive()) return; suspended = draining = false; await track(refreshCurrent()); if (alive() && masks.length) scheduleEstimate(); } };
  } catch (error) { opening = false; dispose(); section.remove(); throw error; }
}
