import * as ui from './tool-ui.js';
import { t, getLang } from './i18n.js';
import { openReaderWorkspace } from './reader-workspace.js';
import { selectedHighlight } from './highlight-selection.js';
import { renderScenePdf } from './core/object-scene.js';
import { renderBoundedPage } from './core/bounded-renderer.js';
import { ensurePdfLib, ensurePdfJs, PDFJS_ASSET_URLS } from './lib-loader.js';

const node = (tag, id, text) => { const value = document.createElement(tag); if (id) value.id = id; if (text) value.textContent = text; return value; };
const button = (id, text) => { const value = node('button', id, text); value.type = 'button'; value.className = 'btn btn-ghost btn-small'; return value; };
let stylesheet;
function style() { return stylesheet ||= new Promise((resolve, reject) => { const link = node('link'); link.rel = 'stylesheet'; link.href = new URL('../css/highlight-workspace.css', import.meta.url).href; link.onload = resolve; link.onerror = () => { link.remove(); stylesheet = null; reject(new Error('Could not load Highlight. Try opening the PDF again.')); }; document.head.append(link); }); }
function host() {
  const section = node('section', 'viewerSection'); section.className = 'result-section'; section.hidden = true;
  const toolbar = node('div'); toolbar.className = 'result-toolbar';
  const pages = node('div'); pages.className = 'btn-row'; pages.append(button('prevPageBtn', 'Previous'), node('span', 'pageIndicator'), button('nextPageBtn', 'Next'));
  const zoom = node('div'); zoom.className = 'result-actions'; zoom.append(button('zoomOutBtn', 'Zoom out'), node('span', 'zoomLevel', '100%'), button('zoomInBtn', 'Zoom in'), button('fitWidthBtn', 'Fit width'), button('printBtn', 'Print'));
  toolbar.append(pages, zoom); const container = node('div', 'viewerContainer'); container.className = 'viewer-canvas-container'; container.append(node('canvas', 'pdfCanvas')); section.append(toolbar, container);
  document.getElementById('highlightSection').before(section); return section;
}
const colorArray = (value) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
const hexColor = (value) => '#' + value.map((number) => Math.round(number * 255).toString(16).padStart(2, '0')).join('');

export async function openHighlightWorkspace(parsed, { isCurrent, signal, onClear }) {
  await ui.ensureDocumentSession(); signal.throwIfAborted(); if (!isCurrent()) throw new DOMException('The document was replaced.', 'AbortError');
  ui.documentSession.beginScene(); await style(); signal.throwIfAborted(); if (!isCurrent()) throw new DOMException('The document was replaced.', 'AbortError');
  const section = host(), lifetime = new AbortController();
  let disposed = false, reader, readerOpening = true, selected = null, candidate = null, focusTransfer = false;
  let pending = false, applying = false, suspended = false, failed = false, dirty = false, hasEditedScene = false, epoch = 0, actionController;
  const defaults = { color: [1, .92, .23], opacity: .4, note: '' };
  const alive = () => !disposed && !lifetime.signal.aborted && isCurrent();
  const listen = (target, event, callback, options = {}) => target.addEventListener(event, callback, { ...options, signal: lifetime.signal });
  const highlights = () => ui.documentSession.scene()?.objects.filter((object) => object.kind === 'highlight') || [];
  const getSelected = () => highlights().find((object) => object.id === selected);
  const actions = node('div', 'highlightActions'), add = button('addHighlightBtn', t('highlight.add_selection', 'Add highlight'));
  const undo = button('highlightUndoBtn', t('workspace.undo', 'Undo')), redo = button('highlightRedoBtn', t('workspace.redo', 'Redo'));
  const apply = button('highlightApplyBtn', t('highlight.review', 'Review highlighted PDF')); apply.classList.add('btn-primary');
  const retry = button('highlightRetryBtn', t('highlight.retry', 'Retry preview')); retry.hidden = true; actions.append(add, undo, redo, apply, retry);
  const selectionStatus = node('p', 'highlightSelectionStatus', t('highlight.select_hint', 'Select text on the PDF, then choose Add highlight.')); selectionStatus.setAttribute('role', 'status');
  const panel = node('details', 'highlightPanel'), summary = node('summary'); panel.append(summary);
  const help = node('p', null, t('highlight.existing_help', 'Edit highlights added in this task. Existing PDF annotations are preserved. Angled, skewed, sideways and vertical writing are not supported.'));
  const list = node('select', 'highlightList'); list.setAttribute('aria-label', t('highlight.choose', 'Highlight'));
  const properties = node('form', 'highlightProperties');
  const color = node('input', 'highlightColor'); color.type = 'color';
  const opacity = node('input', 'highlightOpacity'); opacity.type = 'range'; opacity.min = '20'; opacity.max = '80';
  const note = node('textarea', 'highlightNote'); note.rows = 2; note.maxLength = 2000;
  for (const [control, text] of [[list, 'Highlight'], [color, 'Highlight color'], [opacity, 'Highlight opacity'], [note, 'Highlight note']]) {
    const label = node('label', null, t(`highlight.label_${control.id}`, text)); label.append(control); properties.append(label);
  }
  const save = button('highlightSaveBtn', t('highlight.save_properties', 'Save properties')); save.type = 'submit';
  const discard = button('highlightDiscardBtn', t('highlight.discard_changes', 'Discard changes'));
  const remove = button('highlightDeleteBtn', t('highlight.delete', 'Delete highlight'));
  const clearAll = button('highlightClearAllBtn', t('highlight.remove_added', 'Remove added highlights'));
  const propertyActions = node('div'); propertyActions.className = 'btn-row'; propertyActions.append(save, discard, remove, clearAll); properties.append(propertyActions); panel.append(help, properties);
  const clear = button('highlightClearDocumentBtn', t('workspace.clear_document', 'Clear document'));

  function syncProperties() {
    const value = getSelected() || defaults; color.value = hexColor(value.color); opacity.value = String(Math.round(value.opacity * 100)); note.value = value.note; dirty = false;
  }
  function controls() {
    if (!alive()) return;
    const values = highlights(), state = ui.documentSession.snapshot(), locked = pending || applying || suspended;
    list.replaceChildren(); const empty = node('option', null, t('highlight.new_properties', 'New highlight properties')); empty.value = ''; list.append(empty);
    for (const [index, value] of values.entries()) { const option = node('option', null, `${index + 1} · Page ${value.pageIndex + 1}: ${value.selectedText.slice(0, 70)}`); option.value = value.id; list.append(option); }
    if (!values.some((value) => value.id === selected)) selected = null; list.value = selected || '';
    summary.textContent = t('highlight.list_count', 'Highlights ({n})', { n: values.length });
    add.disabled = locked || dirty || failed || !reader?.ready || !candidate;
    undo.disabled = locked || dirty || !state.canUndo; redo.disabled = locked || dirty || !state.canRedo;
    apply.disabled = locked || dirty || failed || !reader?.ready || !hasEditedScene && !ui.documentSession.scene()?.objects.length && !Object.keys(ui.documentSession.scene()?.fields || {}).length && !ui.documentSession.scene()?.flatten;
    list.disabled = locked || dirty; save.disabled = locked || !dirty || !selected; discard.disabled = locked || !dirty;
    remove.disabled = locked || dirty || !selected; clearAll.disabled = locked || dirty || !values.length;
    color.disabled = opacity.disabled = note.disabled = applying || suspended;
    retry.hidden = !failed; retry.disabled = locked || dirty;
    reader?.setDisabled(locked || dirty || failed);
  }
  function clearCandidate(message) {
    candidate = null; focusTransfer = false;
    if (message) selectionStatus.textContent = message;
    else if (failed) { /* Keep the owned failure/recovery explanation visible. */ }
    else if (dirty) selectionStatus.textContent = t('highlight.unsaved_properties', 'Save properties or discard these changes before reviewing or continuing.');
    else if (pending || applying) selectionStatus.textContent = t('highlight.preparing_preview', 'Preparing the actual highlighted PDF preview…');
    else selectionStatus.textContent = t('highlight.select_hint', 'Select text on the PDF, then choose Add highlight.');
    controls();
  }
  function selection(value) {
    if (!alive() || pending || applying || suspended || dirty || failed) return;
    const collapsed = !value.selection || value.selection.isCollapsed;
    if (collapsed && focusTransfer && (actions.contains(document.activeElement) || panel.contains(document.activeElement))) { focusTransfer = false; return; }
    try {
      const picked = selectedHighlight(value);
      if (!picked) { clearCandidate(); return; }
      const state = ui.documentSession.snapshot(); candidate = { ...picked, taskId: state.taskId, revision: state.revision, generation: state.generation, viewport: value.viewport };
      selected = null; syncProperties(); selectionStatus.textContent = t('highlight.selection_ready', 'Selected text is ready. Add highlight keeps its current text position.'); controls();
    } catch (error) { clearCandidate(error.message); }
  }
  function operation() {
    const intent = ++epoch; actionController?.abort(); const controller = new AbortController(); actionController = controller;
    let owner = ui.documentSession.snapshot(); const taskId = owner.taskId;
    const intentCurrent = () => alive() && intent === epoch && !controller.signal.aborted && ui.documentSession.snapshot().taskId === taskId;
    return { signal: controller.signal, intentCurrent,
      isCurrent: () => { const now = ui.documentSession.snapshot(); return intentCurrent() && now.revision === owner.revision && now.generation === owner.generation; },
      // Only the synchronous result of this adapter's own verified commit may
      // rebase an operation. Unrelated same-task edits never acquire its owner.
      acceptCommit(snapshot) { const now = ui.documentSession.snapshot(); if (!intentCurrent() || now.taskId !== snapshot.taskId || now.revision !== snapshot.revision || now.generation !== snapshot.generation) throw new DOMException('The highlight operation was replaced.', 'AbortError'); owner = snapshot; },
    };
  }
  function finish(own) {
    if (!own.intentCurrent()) return;
    pending = applying = false;
    if (!own.isCurrent()) { candidate = null; failed = true; if (!dirty) syncProperties(); selectionStatus.textContent = t('highlight.document_changed', 'The document changed during this operation. Retry the current preview before reviewing or continuing.'); }
    controls();
  }
  async function refresh() {
    const own = operation(); pending = true; failed = false; candidate = null; controls();
    selectionStatus.textContent = t('highlight.preparing_preview', 'Preparing the actual highlighted PDF preview…');
    try { await reader.refresh({ operation: own }); if (own.isCurrent()) selectionStatus.textContent = t('highlight.preview_ready', 'The actual highlighted PDF preview is ready.'); }
    catch (error) { if (own.isCurrent() && error.name !== 'AbortError') { failed = true; ui.showError(error.message); selectionStatus.textContent = t('highlight.preview_failed', 'The previous preview is retained. Retry the current edits before reviewing or continuing.'); } }
    finally { finish(own); }
  }
  async function mutate(edit) {
    if (!alive() || applying || suspended || pending) return;
    const revision = ui.documentSession.snapshot().revision, next = ui.documentSession.scene(); edit(next);
    try { ui.documentSession.changeScene(next); }
    catch (error) { ui.showError(error.message); controls(); return; }
    if (ui.documentSession.snapshot().revision !== revision) hasEditedScene = true;
    dirty = false; ui.clearResult(); ui.showDocumentIdentity(); syncProperties(); await refresh();
  }
  async function applyScene() {
    if (!alive() || pending || applying || suspended || dirty || failed || !reader.ready) return;
    const own = operation(); applying = true; controls(); ui.hideError(); ui.clearResult();
    try {
      const input = await ui.getWorkspaceInput({ operation: own }); if (!own.isCurrent() || !input) return;
      const name = parsed.baseName + '-highlighted.pdf'; const published = ui.documentSession.publishScene(input.bytes, name, { capabilities: input.capabilities }); own.acceptCommit(published); ui.showDocumentIdentity();
      await ui.reviewResult(input.bytes, name, { operation: own, allowAdopt: false }); if (!own.isCurrent()) return;
      await ui.offerChain(input.bytes, name, [], { operation: own, continuationOperation: { signal: own.signal, isCurrent: () => own.isCurrent() && !dirty && !pending && !applying && !suspended && !failed } });
    } catch (error) { if (own.isCurrent() && error.name !== 'AbortError') ui.showError(error.message); }
    finally { finish(own); }
  }
  async function historyAction(kind) {
    if (!alive() || pending || applying || suspended || dirty) return;
    const own = operation(); applying = true; controls(); candidate = null;
    let temporary, task, committed = false, navigating = false;
    try {
      // This finite shared helper validates its own exact snapshots around the
      // deliberate composition Undo commit and returned handoff ownership.
      const composition = await ui.restoreCompositionHistory(kind, { operation: { signal: own.signal, isCurrent: own.intentCurrent } });
      if (composition) { if (own.intentCurrent() && composition.handoff.isCurrent()) { navigating = true; navigate(composition.targetSlug, composition.handoff); } return; }
      if (!own.isCurrent()) return;
      const target = ui.documentSession.historyTarget(kind); if (!target) return;
      const [pdfLib, pdfjs] = await Promise.all([ensurePdfLib(), ensurePdfJs()]); if (!own.isCurrent()) return;
      const output = target.scene ? await renderScenePdf({ scene: target.scene, resource: ui.documentSession.resource, pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, signal: own.signal }) : { bytes: target.artifact.bytes };
      if (!own.isCurrent()) return; task = pdfjs.getDocument({ data: output.bytes.slice(), ...PDFJS_ASSET_URLS });
      const pdf = await task.promise; if (!own.isCurrent()) return; temporary = node('canvas');
      await renderBoundedPage(await pdf.getPage(Math.min(reader.pageIndex + 1, pdf.numPages)), temporary, { maxDimension: 1200, maxPixels: 2000000, signal: own.signal });
      const state = ui.documentSession.snapshot(); if (!own.isCurrent() || state.revision !== target.revision || state.generation !== target.generation) return;
      const restored = ui.documentSession[kind](); if (!restored) return; own.acceptCommit(ui.documentSession.snapshot());
      if (!target.scene) {
        const handoff = await ui.stashForChain(output.bytes, restored.name, 'highlight', { ...restored, operation: own, onAdoptionOwner: (snapshot) => own.acceptCommit(snapshot) }); if (own.isCurrent() && handoff.isCurrent()) { navigating = true; navigate('highlight', handoff); } return;
      }
      const published = ui.documentSession.publishScene(output.bytes, restored.name, { ...restored, capabilities: { ...restored.capabilities, encrypted: false, forms: output.forms, searchable: target.scene.objects.some((object) => object.kind === 'text') ? true : restored.capabilities.searchable } }); own.acceptCommit(published); committed = true; hasEditedScene = true;
      selected = null; dirty = false; ui.clearResult(); ui.showDocumentIdentity(); syncProperties();
    } catch (error) { if (own.isCurrent() && error.name !== 'AbortError') ui.showError(error.message); }
    finally {
      if (task) await task.destroy().catch(() => {}); if (temporary) temporary.width = temporary.height = 0;
      if (own.intentCurrent() && !navigating) { const current = own.isCurrent(); finish(own); if (current && committed) await refresh(); }
    }
  }
  function navigate(slug, handoff) { const lang = getLang(); location.href = `${lang === 'en' ? '' : '/' + lang}/${slug}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`; }
  function dispose() {
    if (disposed) return; disposed = true; ++epoch; actionController?.abort(); lifetime.abort(); reader?.dispose(); actions.remove(); panel.remove(); selectionStatus.remove(); clear.remove();
    if (!readerOpening) section.remove(); document.body.classList.remove('highlight-loaded');
  }
  signal.addEventListener('abort', dispose, { once: true });
  try {
    reader = await openReaderWorkspace(parsed, { isCurrent: alive, signal: lifetime.signal, mode: 'highlight', onSelection: selection,
      onPage() { clearCandidate(); }, beforeContinueMode() { if (pending || applying || suspended || dirty || failed) { selectionStatus.textContent = t('highlight.finish_changes', 'Save or discard property changes and wait for the actual preview before continuing.'); if (dirty) save.focus(); else if (failed) retry.focus(); return false; } return true; } });
    readerOpening = false; if (!alive()) { reader.dispose(); section.remove(); throw new DOMException('The document was replaced.', 'AbortError'); }
    reader.generated.append(panel); section.insertBefore(actions, document.getElementById('viewerContainer')); actions.after(selectionStatus); document.getElementById('readerReplace').append(clear);
    document.body.classList.add('highlight-loaded'); syncProperties(); controls();
    listen(add, 'click', () => {
      if (!candidate || add.disabled) return;
      const state = ui.documentSession.snapshot(); if (candidate.taskId !== state.taskId || candidate.revision !== state.revision || candidate.generation !== state.generation || candidate.pageIndex !== reader.pageIndex || candidate.viewport !== reader.viewport) { clearCandidate(); return; }
      const value = { ...candidate, id: crypto.randomUUID(), kind: 'highlight', color: colorArray(color.value), opacity: Number(opacity.value) / 100, note: note.value };
      delete value.taskId; delete value.revision; delete value.generation; delete value.viewport; candidate = null; selected = value.id; defaults.note = '';
      void mutate((scene) => scene.objects.push(value));
    });
    listen(list, 'change', async () => { if (dirty || pending || applying) return; selected = list.value || null; clearCandidate(); syncProperties(); const value = getSelected(); if (value && value.pageIndex !== reader.pageIndex) await reader.render(value.pageIndex); controls(); });
    for (const control of [color, opacity, note]) listen(control, 'input', () => { if (selected) { dirty = true; ui.clearResult(); selectionStatus.textContent = t('highlight.unsaved_properties', 'Save properties or discard these changes before reviewing or continuing.'); } else { defaults.color = colorArray(color.value); defaults.opacity = Number(opacity.value) / 100; defaults.note = note.value; } controls(); });
    listen(properties, 'submit', (event) => { event.preventDefault(); if (save.disabled) return; const id = selected, value = { color: colorArray(color.value), opacity: Number(opacity.value) / 100, note: note.value }; void mutate((scene) => Object.assign(scene.objects.find((object) => object.id === id), value)); });
    listen(discard, 'click', () => { syncProperties(); selectionStatus.textContent = t('highlight.properties_retained', 'Saved highlight properties retained.'); controls(); });
    listen(remove, 'click', () => { const id = selected; selected = null; void mutate((scene) => { scene.objects = scene.objects.filter((object) => object.id !== id); }); });
    listen(clearAll, 'click', () => { selected = null; void mutate((scene) => { scene.objects = scene.objects.filter((object) => object.kind !== 'highlight'); }); });
    listen(undo, 'click', () => historyAction('undo')); listen(redo, 'click', () => historyAction('redo')); listen(apply, 'click', applyScene); listen(retry, 'click', refresh); listen(clear, 'click', onClear);
    listen(document, 'pointerdown', (event) => { if (actions.contains(event.target) || panel.contains(event.target)) focusTransfer = !!candidate && !window.getSelection()?.isCollapsed; else if (!reader.textContainer.contains(event.target)) clearCandidate(); }, { capture: true });
    listen(document, 'focusin', (event) => { if ((actions.contains(event.target) || panel.contains(event.target)) && candidate && !window.getSelection()?.isCollapsed) focusTransfer = true; });
    listen(reader.textContainer, 'selectstart', () => { candidate = null; focusTransfer = false; controls(); });
    return { dispose, suspend() { if (!alive()) return; suspended = true; ++epoch; actionController?.abort(); pending = applying = false; candidate = null; controls(); }, async resume() { if (!alive()) return; suspended = false; await refresh(); } };
  } catch (error) { readerOpening = false; dispose(); section.remove(); throw error; }
}
