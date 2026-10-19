import { t, getLang } from './i18n.js';
import { ensurePdfLib, ensurePdfJs, PDFJS_ASSET_URLS } from './lib-loader.js';
import { documentSession, documentOperations, getWorkspaceInput, reviewResult, clearResult,
  showDocumentIdentity, showError, hideError, stashForChain, showProgress, setProgress, hideProgress, restoreCompositionHistory } from './tool-ui.js';
import { createPageWorkspace } from './page-workspace.js';
import { createPagePlan, createPagePlanHistory, movePageGroup, duplicatePageGroup, deletePageGroup,
  rotatePageGroup, cropPageGroup, insertPageSource } from './core/page-plan.js';
import { parsePageRanges, formatPageRanges } from './core/page-selection.js';
import { applyPagePlan } from './core/page-operations.js';
import { renderBoundedPage } from './core/bounded-renderer.js';
import { viewportRectToPdf, pdfPointToViewport } from './core/page-geometry.js';

const $ = (id) => document.getElementById(id);
function node(tag, className, text) { const out = document.createElement(tag); if (className) out.className = className; if (text !== undefined) out.textContent = text; return out; }
function button(label, id, run) { const out = node('button', 'btn btn-ghost btn-small', label); out.type = 'button'; if (id) out.id = id; out.addEventListener('click', () => { Promise.resolve().then(run).catch((error) => { if (error.name !== 'AbortError') showError(error.message); }); }); return out; }
function label(text, input) { const out = node('label', 'page-task-field', text); out.append(input); return out; }
function number(id, value, min = 0) { const out = node('input', 'text-input'); out.type = 'number'; out.id = id; out.value = value; out.min = min; out.step = '1'; return out; }

export async function openPageTask(mode, { isCurrent = () => true } = {}) {
  let disposed = false, busy = true, panel = null, sources = [], history = null, initial = null, input = null;
  let currentPage = 0, previewEpoch = 0, previewTask = null, previewController = null, viewport = null, drag = null;
  let sourceSequence = 0, intakeEpoch = 0, operation = null, cropDraft = false, cropIntent = 0, hydrationEpoch = 0, hydrating = false, hydrationFailed = false;
  let insertQueue = Promise.resolve(), reservedBytes = 0, reservedSources = 0;
  let planEpoch = 0, planPending = false, planFailed = false, previewReady = Promise.resolve(false);
  const insertIntents = new Set();
  const owns = () => !disposed && isCurrent();
  const lib = await ensurePdfLib();
  if (!owns()) throw new DOMException('The document task changed.', 'AbortError');
  for (const id of ['pageGridSection', 'optionsSection', 'pageTask']) { const old = $(id); if (old) { for (const canvas of old.querySelectorAll('canvas')) { canvas.width = canvas.height = 0; } old.remove(); } }
  const root = node('section', 'page-task'); root.id = 'pageTask'; root.setAttribute('aria-label', t('pages.task', 'Document pages'));
  $('dropzone').after(root); document.body.classList.add('page-task-loaded');
  const identity = node('p', 'page-task-identity'); identity.id = 'pageTaskIdentity'; identity.setAttribute('role', 'status');
  const modes = node('nav', 'page-task-modes'); modes.id = 'workspaceModes'; modes.setAttribute('aria-label', t('workspace.modes', 'Document tools'));
  for (const [slug, text] of [['add-text', 'Add Text'], ['add-image', 'Add Image'], ['fill-sign', 'Fill & Sign'], ['organize', 'Organize'], ['rotate', 'Rotate'], ['delete-pages', 'Delete Pages'], ['crop', 'Crop'], ['merge', 'Merge'], ['ocr-pdf', 'OCR']]) {
    const control = button(t(`workspace.mode_${slug}`, text), null, () => changeMode(slug)); control.dataset.mode = slug;
    if (slug === mode) control.setAttribute('aria-current', 'page'); modes.append(control);
  }
  const artifactHistory = node('div', 'page-task-actions');
  const undoCurrent = button(t('pages.undo_current', 'Undo current document'), 'undoDocumentBtn', () => documentHistory('undo'));
  const redoCurrent = button(t('pages.redo_current', 'Redo current document'), 'redoDocumentBtn', () => documentHistory('redo'));
  const replace = button(t('pages.replace', 'Choose another PDF'), 'replacePageInputBtn', () => { if (pending() && !hydrationFailed && !planFailed) { pendingWarning(); return; } $('fileInput').click(); });
  const retry = button(t('pages.retry_current', 'Retry current workspace'), 'retryPageWorkspaceBtn', () => planFailed && input?.revision === documentSession.snapshot().revision ? presentPlan(history.current()) : hydrateCurrent()); retry.hidden = true;
  artifactHistory.append(undoCurrent, redoCurrent, replace, retry);
  const status = node('p', 'page-task-status'); status.id = 'pageTaskStatus'; status.setAttribute('role', 'status');
  const planHistory = node('div', 'page-task-actions');
  const undoPlan = button(t('pages.undo_plan', 'Undo page edit'), 'undoPageEditBtn', () => restorePlan('undo'));
  const redoPlan = button(t('pages.redo_plan', 'Redo page edit'), 'redoPageEditBtn', () => restorePlan('redo'));
  const discard = button(t('pages.discard_plan', 'Discard pending page edits'), 'discardPageEditsBtn', () => setPlan(initial, { reset: true }));
  planHistory.append(undoPlan, redoPlan, discard);
  const body = node('div', 'page-task-layout');
  const sidebar = node('aside', 'page-task-sidebar'), preview = node('section', 'page-task-preview');
  const selection = node('div'); selection.id = 'pageSelection'; sidebar.append(selection);
  const previewNav = node('div', 'page-task-actions');
  const previous = button(t('workspace.previous_page', 'Previous page'), 'previousPageBtn', () => navigate(currentPage - 1));
  const pageNumber = number('pagePreviewNumber', '1', 1); pageNumber.setAttribute('aria-label', t('pages.preview_page', 'Preview page')); pageNumber.addEventListener('change', () => { if (!busy && !planPending && !planFailed) void navigate(Number(pageNumber.value) - 1); });
  const next = button(t('workspace.next_page', 'Next page'), 'nextPageBtn', () => navigate(currentPage + 1));
  const pageStatus = node('span'); pageStatus.id = 'pagePreviewStatus'; pageStatus.setAttribute('aria-live', 'polite'); previewNav.append(previous, pageNumber, next, pageStatus);
  const surface = node('div', 'page-task-surface'); surface.id = 'pagePreviewSurface';
  surface.classList.toggle('is-crop', mode === 'crop');
  const canvas = node('canvas'); canvas.id = 'previewCanvas'; canvas.setAttribute('aria-label', t('pages.actual_preview', 'Selected page preview'));
  const cropOverlay = node('div', 'page-task-crop'); cropOverlay.id = 'cropOverlay'; cropOverlay.hidden = mode !== 'crop'; cropOverlay.setAttribute('aria-hidden', 'true');
  surface.append(canvas, cropOverlay); preview.append(previewNav, surface);
  const previewNote = node('p', 'option-hint', t('pages.preview_note', 'Preview follows the current page order. Pending rotations are shown; review the generated PDF to check the saved result.'));
  preview.append(previewNote); body.append(sidebar, preview);
  const actions = node('div', 'page-task-actions'); actions.id = 'pageTaskActions';
  const options = node('div', 'page-task-options'); options.id = 'pageTaskOptions';
  const apply = button(t('pages.review_changes', 'Review PDF result'), 'applyBtn', review); apply.className = 'btn btn-primary';
  const cancel = button(t('common.cancel', 'Cancel'), 'cancelPageOperationBtn', () => { if (planPending) return; invalidate(); busy = false; hideProgress(); update(); }); cancel.hidden = true;
  root.append(identity, modes, artifactHistory, status, planHistory, actions, options, body, apply, cancel);

  const selectedIds = () => panel.selection().map((index) => history.current().pages[index].id);
  const pending = () => reservedSources > 0 || cropDraft || (history && JSON.stringify(history.current()) !== JSON.stringify(initial));
  const requireSelection = () => { const ids = selectedIds(); if (!ids.length) throw new Error(t('pages.choose_scope', 'Select at least one page first.')); return ids; };
  function invalidate() { documentOperations.cancel(); clearResult(); }
  function pendingWarning() { status.textContent = t('pages.review_before_mode', 'You have pending page edits. Review and use the result before changing tools, or discard the edits explicitly.'); status.classList.add('needs-attention'); }
  async function changeMode(slug) {
    if (busy || planPending || planFailed || slug === mode || !owns()) return;
    if (pending()) { pendingWarning(); return; }
    busy = true; update();
    try {
      const request = documentOperations.begin(); const value = await getWorkspaceInput({ operation: request });
      if (!value || !owns()) return;
      // Preserve an existing editable scene across modes. Page results themselves
      // enter the canonical session only through explicit result adoption.
      if (value.hasScene) documentSession.publishScene(value.bytes, value.name, { name: value.name, displayName: value.displayName, type: value.type, capabilities: value.capabilities });
      const handoff = await stashForChain(value.bytes, value.name, slug, { name: value.name, displayName: value.displayName, type: value.type, capabilities: value.capabilities, operation: request });
      if (!request.isCurrent() || !owns() || !handoff.isCurrent()) return;
      const lang = getLang(); location.href = `${lang === 'en' ? '' : '/' + lang}/${slug}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`;
    } catch (error) { busy = false; update(); throw error; }
  }
  async function documentHistory(kind) {
    if (busy || planPending || planFailed || !owns()) return;
    if (pending()) { pendingWarning(); return; }
    busy = true; update(); invalidate();
    try {
      const request = documentOperations.begin(), compositionTarget = await restoreCompositionHistory(kind,{ operation:request });
      if (compositionTarget) { if (owns() && compositionTarget.handoff.isCurrent()) { const { handoff,targetSlug } = compositionTarget,lang = getLang(); location.href = `${lang === 'en' ? '' : '/' + lang}/${targetSlug}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`; } return; }
      documentSession[kind](); showDocumentIdentity(); await hydrateCurrent();
    } catch (error) { if (owns()) { busy = false; showDocumentIdentity(); update(); } throw error; }
  }
  function update() {
    if (!owns()) return;
    const presenting = busy || planPending || planFailed, locked = presenting || reservedSources > 0;
    root.setAttribute('aria-busy', String(locked));
    retry.hidden = !hydrationFailed && !planFailed;
    replace.disabled = presenting && !hydrationFailed && !planFailed;
    options.inert = presenting; selection.inert = presenting; previewNav.inert = presenting;
    for (const control of Object.values(insets)) control.disabled = presenting;
    for (const control of actions.querySelectorAll('button,input')) control.disabled = locked;
    for (const control of modes.querySelectorAll('button')) control.disabled = locked;
    if (!history) {
      for (const control of [undoPlan, redoPlan, discard, undoCurrent, redoCurrent, previous, next, pageNumber, apply]) control.disabled = true;
      cancel.hidden = true;
      const snapshot = documentSession.snapshot();
      identity.textContent = `${t('workspace.current', 'Current')}: ${snapshot.current?.name || ''} · ${t('workspace.revision', 'Revision')} ${snapshot.revision}`;
      status.textContent = t('pages.opening_current', 'Opening the current document workspace…');
      return;
    }
    const plan = history.current(), state = history.snapshot(), snapshot = documentSession.snapshot(), selected = panel?.selection() || [];
    const rotated = plan.pages.filter((entry) => entry.rotation).length, cropped = plan.pages.filter((entry) => entry.crop).length;
    identity.textContent = `${t('workspace.current', 'Current')}: ${snapshot.current.name} · ${t('workspace.revision', 'Revision')} ${snapshot.revision} · ${plan.pages.length} ${t('pages.pages', 'pages')}`;
    status.classList.remove('needs-attention');
    status.textContent = `${pending() ? t('pages.pending', 'Pending page edits') : t('pages.current_ready', 'Current document')}: ${plan.pages.length} ${t('pages.pages', 'pages')} · ${selected.length} ${t('pages.selected', 'selected')} · ${rotated} ${t('pages.rotated', 'rotated')} · ${cropped} ${t('pages.cropped', 'cropped')}`;
    undoPlan.disabled = locked || !state.canUndo; redoPlan.disabled = locked || !state.canRedo; discard.disabled = busy || planPending || !pending();
    undoCurrent.disabled = locked || !snapshot.canUndo; redoCurrent.disabled = locked || !snapshot.canRedo;
    apply.disabled = locked || (mode === 'delete-pages' && !pending() && (!selected.length || selected.length === plan.pages.length)); cancel.hidden = !busy || hydrating || planPending;
    pageNumber.disabled = presenting; pageNumber.max = String(plan.pages.length); previous.disabled = presenting || currentPage <= 0; next.disabled = presenting || currentPage >= plan.pages.length - 1;
    if (mode === 'delete-pages' && !pending()) status.textContent += ` · ${t('pages.delete_help', 'Select pages, then Delete selected or Keep selected. Review the remaining pages before use.')}`;
  }
  async function setPlan(plan, { reset = false } = {}) {
    if (!owns() || busy || planPending) return false;
    invalidate();
    if (reset) { cancelInsertIntents(); cropDraft = false; ++cropIntent; for (const control of Object.values(insets)) control.value = '0'; history = createPagePlanHistory(plan); sources = sources.filter((source) => plan.sources.some((item) => item.id === source.id)); }
    else history.commit(plan);
    if (mode === 'crop') return presentPlan(history.current());
    await panel.setPlan(history.current(), sources); update(); return true;
  }
  async function restorePlan(kind) {
    if (busy || planPending || planFailed || !history[kind]()) return;
    invalidate(); cropDraft = false; ++cropIntent;
    if (mode === 'crop') await presentPlan(history.current());
    else { await panel.setPlan(history.current(), sources); update(); }
  }
  async function presentPlan(target) {
    const token = ++planEpoch, revision = input.revision;
    planPending = true; planFailed = false; drag = null; hideError(); update();
    try {
      if (revision !== documentSession.snapshot().revision) throw new Error('The current document changed.');
      const thumbnails = panel.setPlan(target, sources);
      // The panel owns thumbnails only. Its navigation callback starts a
      // separate actual-page render and numeric-property rehydration.
      const selectedPreview = previewReady, selectedEpoch = previewEpoch;
      await thumbnails;
      const shown = await selectedPreview;
      if (!owns() || token !== planEpoch) return false;
      if (!shown || selectedEpoch !== previewEpoch || history.current() !== target || revision !== documentSession.snapshot().revision) throw new Error('The chosen page plan could not be displayed.');
      planPending = false; update(); return true;
    } catch (error) {
      if (owns() && token === planEpoch) { planPending = false; planFailed = true; update(); showError(t('pages.plan_preview_failed', 'The chosen pending pages could not be displayed. Retry the workspace, discard pending edits, or choose another PDF.')); }
      return false;
    }
  }
  function transform(run) { return async () => { if (!busy) await setPlan(run(history.current(), requireSelection())); }; }
  const rotate = (degrees) => transform((plan, ids) => rotatePageGroup(plan, ids, degrees));
  if (mode === 'organize' || mode === 'rotate') {
    actions.append(button(t('pages.rotate_left', 'Rotate selected left'), 'rotateSelectedLeftBtn', rotate(-90)), button(t('pages.rotate_right', 'Rotate selected right'), 'rotateSelectedRightBtn', rotate(90)),
      button(t('pages.reset_rotation', 'Reset selected rotation'), 'resetBtn', transform((plan, ids) => rotatePageGroup(plan, ids, 0, { reset: true }))));
    if (mode === 'rotate') {
      actions.append(button(t('pages.all_left', 'All left'), 'rotateAllLeftBtn', () => setPlan(rotatePageGroup(history.current(), history.current().pages.map((p) => p.id), -90))),
        button(t('pages.all_right', 'All right'), 'rotateAllRightBtn', () => setPlan(rotatePageGroup(history.current(), history.current().pages.map((p) => p.id), 90))));
    }
  }
  if (mode === 'organize' || mode === 'delete-pages') {
    actions.append(button(t('pages.delete_selected', 'Delete selected'), 'deleteSelectedBtn', transform((plan, ids) => deletePageGroup(plan, ids))),
      button(t('pages.keep_selected', 'Keep selected'), 'keepSelectedBtn', transform((plan, ids) => deletePageGroup(plan, ids, { keepSelected: true }))));
  }
  let insertFile, insertRange;
  if (mode === 'organize') {
    const position = number('moveBeforePage', '1', 1); actions.append(label(t('pages.before_page', 'Before page (last + 1 appends)'), position));
    const before = () => { const index = Number(position.value) - 1; if (!Number.isInteger(index) || index < 0 || index > history.current().pages.length) throw new Error(t('pages.invalid_position', 'Choose a position between 1 and the last page plus 1.')); return index; };
    actions.append(button(t('pages.move_group', 'Move selected group'), 'moveSelectedBtn', transform((plan, ids) => movePageGroup(plan, ids, before()))),
      button(t('pages.duplicate_group', 'Duplicate selected'), 'duplicateSelectedBtn', transform((plan, ids) => duplicatePageGroup(plan, ids, before()))));
    insertFile = node('input'); insertFile.type = 'file'; insertFile.id = 'insertPdfInput'; insertFile.accept = '.pdf,application/pdf';
    insertRange = node('input', 'text-input'); insertRange.type = 'text'; insertRange.id = 'insertPageRanges'; insertRange.placeholder = '1-5,8';
    options.append(label(t('pages.insert_file', 'Insert pages from another PDF'), insertFile), label(t('pages.insert_range', 'Source ranges (empty means all)'), insertRange));
    insertFile.addEventListener('change', () => {
      const file = insertFile.files[0]; insertFile.value = ''; if (!file || busy) return;
      const token = intakeEpoch, task = documentSession.snapshot().taskId, ranges = insertRange.value, positionValue = Number(position.value) - 1;
      if (!Number.isInteger(positionValue) || positionValue < 0 || positionValue > history.current().pages.length) { showError(t('pages.invalid_position', 'Choose a position between 1 and the last page plus 1.')); return; }
      const targetId = history.current().pages[positionValue]?.id || null;
      if (sources.length + reservedSources >= 20 || sources.reduce((n, s) => n + s.bytes.length, file.size + reservedBytes) > 250 * 1024 * 1024) { showError(t('pages.source_budget', 'Use at most 20 PDF sources and 250 MB combined.')); return; }
      const intent = { controller: new AbortController(), bytes: file.size, released: false }; insertIntents.add(intent);
      reservedBytes += file.size; reservedSources++; invalidate(); update();
      insertQueue = insertQueue.catch(() => {}).then(async () => {
        try {
          if (!owns() || token !== intakeEpoch || task !== documentSession.snapshot().taskId) return;
          const { readExternalPdfFile } = await import('./tool-ui.js');
          const parsed = await readExternalPdfFile(file, { maxBytes: 250 * 1024 * 1024, maxPages: 10000, signal: intent.controller.signal });
          if (!owns() || token !== intakeEpoch || task !== documentSession.snapshot().taskId) return;
          const indices = ranges.trim() ? parsePageRanges(ranges, parsed.pageCount) : undefined;
          const sourceId = `insert-${++sourceSequence}`;
          const foundTarget = targetId ? history.current().pages.findIndex((page) => page.id === targetId) : -1;
          const plan = insertPageSource(history.current(), { sourceId, pageCount: parsed.pageCount, pageIndices: indices }, foundTarget < 0 ? history.current().pages.length : foundTarget);
          sources.push({ id: sourceId, bytes: parsed.bytes }); await setPlan(plan);
        } catch (error) { if (owns() && token === intakeEpoch) showError(error.message); }
        finally { releaseInsertIntent(intent); update(); }
      });
    });
  }
  function releaseInsertIntent(intent) { if (intent.released) return; intent.released = true; reservedBytes -= intent.bytes; reservedSources--; insertIntents.delete(intent); }
  function cancelInsertIntents() { ++intakeEpoch; for (const intent of insertIntents) { intent.controller.abort(); releaseInsertIntent(intent); } insertQueue = Promise.resolve(); }
  const insets = {};
  if (mode === 'crop') {
    previewNote.textContent = t('pages.crop_warning', 'Crop hides content outside the visible box. Hidden content remains recoverable; use Redact to remove sensitive content. Drag a box on the preview or enter visible edge insets.');
    for (const [key, text] of [['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom'], ['left', 'Left']]) {
      const control = number(`crop${key[0].toUpperCase() + key.slice(1)}`, '0'); control.step = '0.1'; insets[key] = control;
      control.addEventListener('input', () => { if (busy || planPending || planFailed) return; cropDraft = true; ++cropIntent; invalidate(); drawCrop(); update(); }); options.append(label(t(`crop.${key}`, text) + ' (pt)', control));
    }
    actions.append(button(t('pages.crop_selected', 'Set crop on selected pages'), 'cropSelectedBtn', commitCrop),
      button(t('pages.reset_crop', 'Reset selected crop'), 'resetCropBtn', () => { const ids = requireSelection(); cropDraft = false; ++cropIntent; return setPlan(cropPageGroup(history.current(), ids, null)); }));
    surface.addEventListener('pointerdown', (event) => {
      if (busy || planPending || planFailed || !viewport || event.button !== 0) return; event.preventDefault();
      surface.setPointerCapture(event.pointerId); const p = point(event); drag = { pointerId: event.pointerId, start: p, end: p }; drawCrop();
    });
    surface.addEventListener('pointermove', (event) => { if (drag?.pointerId !== event.pointerId) return; drag.end = point(event); dragToInsets(); drawCrop(); });
    const finish = (event) => { if (drag?.pointerId !== event.pointerId) return; drag.end = point(event); dragToInsets(); drag = null; cropDraft = true; ++cropIntent; invalidate(); drawCrop(); update(); };
    surface.addEventListener('pointerup', finish); surface.addEventListener('pointercancel', () => { drag = null; drawCrop(); });
  }
  function readInsets() { const values = Object.fromEntries(Object.entries(insets).map(([key, control]) => [key, Number(control.value)])); if (Object.values(values).some((v) => !Number.isFinite(v) || v < 0)) throw new RangeError(t('pages.invalid_crop', 'Crop insets must be finite positive values or zero.')); return values; }
  function point(event) { const rect = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(viewport.width, (event.clientX - rect.left) / rect.width * viewport.width)), y: Math.max(0, Math.min(viewport.height, (event.clientY - rect.top) / rect.height * viewport.height)) }; }
  function dragToInsets() {
    const { start, end } = drag;
    const ratio = 1 / viewport.scale;
    const values = { top: Math.min(start.y, end.y) * ratio, left: Math.min(start.x, end.x) * ratio, right: (viewport.width - Math.max(start.x, end.x)) * ratio, bottom: (viewport.height - Math.max(start.y, end.y)) * ratio };
    for (const [key, value] of Object.entries(values)) insets[key].value = value.toFixed(2);
  }
  function drawCrop() {
    if (mode !== 'crop' || !viewport) return;
    try {
      const i = readInsets(), scale = viewport.scale, width = viewport.width - (i.left + i.right) * scale, height = viewport.height - (i.top + i.bottom) * scale;
      cropOverlay.hidden = width <= 0 || height <= 0;
      Object.assign(cropOverlay.style, { left: `${i.left * scale / viewport.width * 100}%`, top: `${i.top * scale / viewport.height * 100}%`, width: `${Math.max(0, width) / viewport.width * 100}%`, height: `${Math.max(0, height) / viewport.height * 100}%` });
    } catch { cropOverlay.hidden = true; }
  }
  async function commitCrop() {
    if (busy || planPending || planFailed) return false;
    const ids = requireSelection(), chosen = new Set(ids), i = readInsets(), intent = cropIntent, originalPlan = history.current(); let plan = originalPlan;
    const pdfjs = await ensurePdfJs(); const tasks = new Map();
    try {
      for (const entry of plan.pages.filter((page) => chosen.has(page.id))) {
        if (!owns() || intent !== cropIntent) return false;
        let task = tasks.get(entry.sourceId);
        if (!task) { for (const previous of tasks.values()) await previous.destroy(); tasks.clear(); task = pdfjs.getDocument({ data: sources.find((s) => s.id === entry.sourceId).bytes.slice(), ...PDFJS_ASSET_URLS }); tasks.set(entry.sourceId, task); }
        const page = await (await task.promise).getPage(entry.pageIndex + 1);
        const view = page.getViewport({ scale: 1, rotation: (page.rotate + entry.rotation) % 360 });
        if (i.left + i.right >= view.width || i.top + i.bottom >= view.height) throw new RangeError(t('pages.crop_empty', 'These insets would hide an entire selected page. Reduce them or choose a different scope.'));
        const box = viewportRectToPdf(view, { x: i.left, y: i.top, width: view.width - i.left - i.right, height: view.height - i.top - i.bottom });
        plan = cropPageGroup(plan, [entry.id], box);
      }
    } finally { await Promise.allSettled([...tasks.values()].map((task) => task.destroy())); }
    if (!owns() || history.current() !== originalPlan || intent !== cropIntent) return false;
    cropDraft = false; const shown = await setPlan(plan);
    return shown && owns() && intent === cropIntent;
  }
  async function navigate(index) {
    if (!owns() || !history || !Number.isInteger(index) || index < 0 || index >= history.current().pages.length) return;
    currentPage = index; pageNumber.value = String(index + 1); update();
    previewReady = renderPreview(); return previewReady;
  }
  async function renderPreview() {
    const token = ++previewEpoch; previewController?.abort(); previewController = new AbortController();
    const signal = previewController.signal, old = previewTask; previewTask = null; viewport = null;
    try { await old?.destroy(); } catch { /* owned preview replaced */ }
    if (!owns() || token !== previewEpoch) return false;
    const entry = history.current().pages[currentPage];
    try {
      const pdfjs = await ensurePdfJs(); if (!owns() || token !== previewEpoch) return false;
      const task = pdfjs.getDocument({ data: sources.find((source) => source.id === entry.sourceId).bytes.slice(), ...PDFJS_ASSET_URLS }); previewTask = task;
      const doc = await task.promise; if (!owns() || token !== previewEpoch) return false;
      const page = await doc.getPage(entry.pageIndex + 1);
      const rotation = (page.rotate + entry.rotation) % 360;
      const renderPage = { getViewport: (options) => page.getViewport({ ...options, rotation }), render: (options) => page.render(options) };
      viewport = await renderBoundedPage(renderPage, canvas, { signal, maxDimension: 1200, maxPixels: 2000000 });
      if (!owns() || token !== previewEpoch) return false;
      pageStatus.textContent = `${currentPage + 1} / ${history.current().pages.length} · ${t('pages.source_page', 'Source page {n}', { n: entry.pageIndex + 1 })}`;
      if (mode === 'crop' && !cropDraft && !drag) {
        let values = { top: 0, right: 0, bottom: 0, left: 0 };
        if (entry.crop) {
          const a = pdfPointToViewport(viewport, entry.crop.x, entry.crop.y), b = pdfPointToViewport(viewport, entry.crop.x + entry.crop.width, entry.crop.y + entry.crop.height);
          values = { left: Math.min(a[0], b[0]) / viewport.scale, top: Math.min(a[1], b[1]) / viewport.scale, right: (viewport.width - Math.max(a[0], b[0])) / viewport.scale, bottom: (viewport.height - Math.max(a[1], b[1])) / viewport.scale };
        }
        for (const [key, value] of Object.entries(values)) insets[key].value = Math.max(0, value).toFixed(2);
      }
      drawCrop();
      return true;
    } catch (error) { if (owns() && token === previewEpoch && !signal.aborted && error.name !== 'AbortError') showError(error.message); return false; }
    finally { if (previewTask && token === previewEpoch) { const task = previewTask; previewTask = null; await task.destroy(); } }
  }
  async function resetFromCurrent() {
    ++planEpoch; planPending = false; planFailed = false;
    cancelInsertIntents(); cropDraft = false; ++cropIntent; for (const control of Object.values(insets)) control.value = '0';
    invalidate(); panel?.dispose(); panel = null; viewport = null;
    const request = documentOperations.begin(); input = await getWorkspaceInput({ operation: request });
    if (!input || !owns()) return false;
    const doc = await lib.PDFDocument.load(input.bytes.slice(), { updateMetadata: false }); if (!owns() || !request.isCurrent()) return false;
    initial = createPagePlan({ sourceId: 'current', pageCount: doc.getPageCount() }); history = createPagePlanHistory(initial); sources = [{ id: 'current', bytes: input.bytes }];
    currentPage = Math.min(documentSession.snapshot().selection[0] || 0, initial.pages.length - 1);
    if (!documentSession.snapshot().selection.length && ['rotate', 'crop'].includes(mode)) documentSession.setSelection(initial.pages.map((_, index) => index));
    panel = await createPageWorkspace({ container: selection, plan: initial, sources,
      onSelectionChange: () => update(), onNavigate: (index) => { void navigate(index); } });
    update(); await navigate(currentPage); showDocumentIdentity(); return owns() && request.isCurrent();
  }
  async function hydrateCurrent() {
    const token = ++hydrationEpoch; hydrating = true; hydrationFailed = false; busy = true; hideError(); update();
    try { if (!await resetFromCurrent()) throw new DOMException('The document workspace changed while opening.', 'AbortError'); if (owns() && token === hydrationEpoch) { hydrating = false; busy = false; update(); } }
    catch (error) { if (owns() && token === hydrationEpoch) { hydrationFailed = true; busy = true; update(); showError(t('pages.reload_failed', 'The current document changed, but its page workspace could not be opened. Retry the current workspace or choose another PDF.')); } }
  }
  async function review() {
    if (busy || planPending || planFailed || !owns()) return;
    if (reservedSources) throw new Error(t('pages.wait_insert', 'Wait for inserted PDF pages to finish loading.'));
    if (mode === 'delete-pages' && !pending()) await setPlan(deletePageGroup(history.current(), requireSelection()));
    if (mode === 'crop' && cropDraft && !await commitCrop()) return;
    busy = true; hideError(); update();
    const reviewHydration = hydrationEpoch;
    const request = documentOperations.begin(); operation = request;
    const plan = history.current(), sourceRevision = documentSession.snapshot().revision;
    const stillCurrent = () => owns() && request.isCurrent() && sourceRevision === documentSession.snapshot().revision;
    const guarded = { signal: request.signal, isCurrent: stillCurrent };
    showProgress(t('pages.building', 'Building the selected page result…'));
    try {
      const result = await applyPagePlan(sources, plan, { pdfLib: lib, signal: request.signal, onProgress: (event) => { if (stillCurrent()) setProgress(event.percent, t('pages.building', 'Building the selected page result…')); } });
      if (!stillCurrent()) return;
      const boundary = { ...result.boundary, losses: [...new Set([...result.boundary.losses, ...input.losses])] };
      const caps = { ...(input.capabilities || documentSession.snapshot().current.capabilities) };
      caps.encrypted = false;
      if (typeof result.capabilities.forms === 'boolean') caps.forms = result.boundary.kind === 'pdf-rewrite' && result.capabilities.forms;
      else delete caps.forms;
      await reviewResult(result.bytes, `${input.name.replace(/\.pdf$/i, '')}-${mode}.pdf`, { operation: guarded, adopt: false, boundary, capabilities: caps,
        onAdopt: () => { if (owns()) { busy = true; update(); void hydrateCurrent(); } } });
      if (stillCurrent()) status.textContent = t('pages.review_ready', 'Result ready below. Use this result to make it current; the current document and pending edits stay available until then.');
    } finally { if (owns()) { if (reviewHydration === hydrationEpoch) busy = false; hideProgress(); update(); } }
  }
  // Leaving a pending plan through an ordinary tool link is also deliberate.
  // Keep it in place and explain the available explicit choices.
  const guardLinks = (event) => {
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || !pending()) return;
    const url = new URL(link.href, location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin === location.origin && url.pathname !== location.pathname && !link.target) { event.preventDefault(); pendingWarning(); }
  };
  document.addEventListener('click', guardLinks, true);
  await hydrateCurrent();
  return { dispose() { if (disposed) return; disposed = true; ++planEpoch; cancelInsertIntents(); ++previewEpoch; previewController?.abort(); void previewTask?.destroy(); panel?.dispose(); documentOperations.cancel(); document.removeEventListener('click', guardLinks, true); canvas.width = canvas.height = 0; root.remove(); sources = []; document.body.classList.remove('page-task-loaded'); } };
}
