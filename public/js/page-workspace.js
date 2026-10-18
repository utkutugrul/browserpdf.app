import { t } from './i18n.js';
import { documentSession, ensureDocumentSession } from './tool-ui.js';
import { renderBoundedPage } from './core/bounded-renderer.js';
import { validatePagePlan } from './core/page-plan.js';
import { changePageSelection, parsePageRanges, pagesByParity, formatPageRanges, normalizePageSelection } from './core/page-selection.js';

export const PAGE_THUMBNAIL_WINDOW = 12;
export const PAGE_THUMBNAIL_DOCUMENTS = 2;

function element(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text; return node;
}
function ensureStyles() {
  if (document.getElementById('pageWorkspaceStyles')) return;
  const link = document.createElement('link'); link.id = 'pageWorkspaceStyles'; link.rel = 'stylesheet'; link.href = '/css/page-workspace.css'; document.head.append(link);
}

// A route supplies its plan/sources and owns operation/review actions. Selection
// lives solely in the warmed shared session, never in a second adapter Set.
export async function createPageWorkspace({ container, plan: initialPlan, sources: initialSources,
  pdfjs, pdfjsAssets, onSelectionChange, onNavigate,
} = {}) {
  if (!(container instanceof Element)) throw new TypeError('A page workspace container is required.');
  const requestedTaskId = documentSession.snapshot().taskId;
  await ensureDocumentSession(); ensureStyles();
  const ownerTaskId = documentSession.snapshot().taskId;
  if (requestedTaskId && requestedTaskId !== ownerTaskId) throw new DOMException('The document task changed while its page workspace was opening.', 'AbortError');
  if (!ownerTaskId || documentSession.snapshot().current?.type !== 'application/pdf') throw new Error('Open a PDF before creating its page workspace.');
  let plan = validatePagePlan(initialPlan), sources = new Map(), windowStart = 0, anchor = null, currentPage = 0;
  let epoch = 0, active = null, disposed = false, ready = Promise.resolve();
  const root = element('section', 'page-workspace'); root.setAttribute('aria-label', t('pages.workspace', 'Page selection'));
  const controls = element('div', 'page-workspace-controls'), rangeRow = element('div', 'page-workspace-range');
  const rangeLabel = element('label', '', t('pages.range_label', 'Page ranges'));
  const rangeInput = element('input', 'text-input'); rangeInput.type = 'text'; rangeInput.placeholder = '1-5,8'; rangeInput.setAttribute('aria-label', t('pages.range_label', 'Page ranges'));
  rangeLabel.append(rangeInput);
  const rangeApply = button(t('pages.apply_range', 'Select range'), () => {
    try { setSelection(parsePageRanges(rangeInput.value, plan.pages.length)); clearError(); }
    catch (error) { showError(error.message); }
  });
  rangeRow.append(rangeLabel, rangeApply); controls.append(rangeRow);
  const selectionControls = element('div', 'page-workspace-buttons');
  for (const [value, label] of [['all', t('pages.all', 'All')], ['none', t('pages.none', 'None')], ['odd', t('pages.odd', 'Odd')], ['even', t('pages.even', 'Even')]]) {
    const control = button(label, () => { setSelection(pagesByParity(plan.pages.length, value)); clearError(); }); control.dataset.selection = value; selectionControls.append(control);
  }
  controls.append(selectionControls);
  const status = element('p', 'page-workspace-status'); status.setAttribute('role', 'status');
  const help = element('p', 'option-hint', t('pages.shift_help', 'Use Shift with a page to select a range. Page ranges and odd/even choices refer to the current page order.'));
  const errorBox = element('p', 'page-workspace-error'); errorBox.hidden = true; errorBox.setAttribute('role', 'alert');
  const navigation = element('div', 'page-workspace-navigation');
  const previous = button(t('pages.previous_set', 'Previous pages'), () => { windowStart = Math.max(0, windowStart - PAGE_THUMBNAIL_WINDOW); void renderWindow(); });
  const windowStatus = element('span'); windowStatus.setAttribute('aria-live', 'polite');
  const next = button(t('pages.next_set', 'Next pages'), () => { if (windowStart + PAGE_THUMBNAIL_WINDOW < plan.pages.length) { windowStart += PAGE_THUMBNAIL_WINDOW; void renderWindow(); } });
  const jumpLabel = element('label', '', t('pages.go_to_page', 'Go to page'));
  const jumpInput = element('input', 'select-input'); jumpInput.type = 'number'; jumpInput.min = '1'; jumpInput.max = String(plan.pages.length); jumpInput.value = '1'; jumpInput.setAttribute('aria-label', t('pages.go_to_page', 'Go to page')); jumpLabel.append(jumpInput);
  const go = button(t('pages.go', 'Go'), () => { const index = Number(jumpInput.value) - 1; if (!Number.isInteger(index) || index < 0 || index >= plan.pages.length) { showError(t('pages.invalid_page', 'Choose a page in this document.')); return; } clearError(); currentPage = index; windowStart = Math.floor(index / PAGE_THUMBNAIL_WINDOW) * PAGE_THUMBNAIL_WINDOW; void renderWindow(); if (ownsTask()) onNavigate?.(index, plan.pages[index]); });
  navigation.append(previous, windowStatus, next, jumpLabel, go);
  const grid = element('div', 'page-workspace-grid'); grid.setAttribute('aria-label', t('pages.thumbnails', 'Page thumbnails'));
  root.append(controls, status, help, errorBox, navigation, grid); container.replaceChildren(root);

  function dispose() { if (disposed) return; disposed = true; epoch++; active?.abort(); disposeCanvases(); sources.clear(); root.remove(); }
  function ownsTask() {
    if (disposed) return false;
    const snapshot = documentSession.snapshot();
    if (snapshot.taskId !== ownerTaskId || snapshot.current?.type !== 'application/pdf') { dispose(); return false; }
    return true;
  }
  function button(label, onClick) { const node = element('button', 'btn btn-ghost btn-small', label); node.type = 'button'; node.addEventListener('click', (event) => { if (ownsTask()) onClick(event); }); return node; }
  function clearError() { errorBox.textContent = ''; errorBox.hidden = true; rangeInput.removeAttribute('aria-invalid'); }
  function showError(message) { errorBox.textContent = message; errorBox.hidden = false; rangeInput.setAttribute('aria-invalid', 'true'); }
  function selected() { return ownsTask() ? normalizePageSelection(documentSession.snapshot().selection.filter((index) => index < plan.pages.length), plan.pages.length) : []; }
  function updateSelection() {
    if (!ownsTask()) return;
    const pages = selected(); status.textContent = t('pages.selected_count', '{selected} of {total} pages selected', { selected: pages.length, total: plan.pages.length });
    rangeInput.value = formatPageRanges(pages, plan.pages.length);
    for (const tile of grid.querySelectorAll('[data-page-index]')) {
      const index = Number(tile.dataset.pageIndex), isSelected = pages.includes(index);
      tile.setAttribute('aria-pressed', String(isSelected)); tile.classList.toggle('is-selected', isSelected);
      if (index === currentPage) tile.setAttribute('aria-current', 'page'); else tile.removeAttribute('aria-current');
    }
  }
  function setSelection(pages) {
    if (!ownsTask()) return;
    const normalized = normalizePageSelection(pages, plan.pages.length); documentSession.setSelection(normalized); updateSelection(); onSelectionChange?.([...normalized]);
  }
  function replaceSources(values) {
    if (!Array.isArray(values) || !values.length || values.length > 20) throw new TypeError('Choose between 1 and 20 PDF sources.');
    const nextSources = new Map();
    let total = 0;
    for (const value of values) {
      if (!value?.id || !(value.bytes instanceof Uint8Array) || !value.bytes.length || nextSources.has(value.id)) throw new TypeError('Unique non-empty PDF sources are required.');
      total += value.bytes.length; if (total > 250 * 1024 * 1024) throw new RangeError('The combined PDF sources are limited to 250 MB.');
      nextSources.set(value.id, value.bytes);
    }
    for (const source of plan.sources) if (!nextSources.has(source.id)) throw new RangeError('A page source is unavailable.');
    for (const [id, bytes] of nextSources) nextSources.set(id, bytes.slice());
    sources = nextSources;
  }
  function disposeCanvases() { for (const canvas of grid.querySelectorAll('canvas')) { canvas.width = 0; canvas.height = 0; } }
  function renderWindow() {
    if (!ownsTask()) return Promise.resolve();
    const renderEpoch = ++epoch; active?.abort(); active = new AbortController(); const signal = active.signal;
    disposeCanvases(); grid.replaceChildren(); root.setAttribute('aria-busy', 'true');
    const end = Math.min(plan.pages.length, windowStart + PAGE_THUMBNAIL_WINDOW);
    previous.disabled = windowStart === 0; next.disabled = end >= plan.pages.length;
    windowStatus.textContent = t('pages.window_count', 'Pages {first}-{last} of {total}', { first: windowStart + 1, last: end, total: plan.pages.length });
    const pending = [];
    for (let index = windowStart; index < end; index++) {
      const entry = plan.pages[index], tile = element('button', 'page-workspace-tile'); tile.type = 'button'; tile.dataset.pageIndex = String(index); tile.dataset.pageId = entry.id;
      tile.setAttribute('aria-label', t('pages.select_page', 'Select page {n}', { n: index + 1 }));
      const canvas = element('canvas'); canvas.setAttribute('aria-hidden', 'true');
      const label = element('span', 'page-workspace-page-label', t('pages.page_label', 'Page {n}', { n: index + 1 }));
      const sourceLabel = element('span', 'page-workspace-source-label', t('pages.source_page', 'Source page {n}', { n: entry.pageIndex + 1 }));
      tile.append(canvas, label, sourceLabel);
      if (entry.rotation || entry.crop) { const changes = [entry.rotation ? `+${entry.rotation}°` : '', entry.crop ? t('pages.crop_pending', 'Crop pending') : ''].filter(Boolean); tile.append(element('span', 'page-workspace-pending', changes.join(' · '))); }
      tile.addEventListener('click', (event) => {
        if (!ownsTask() || renderEpoch !== epoch) return;
        const changed = changePageSelection({ selected: selected(), anchor }, index, { pageCount: plan.pages.length, shiftKey: event.shiftKey, additive: event.ctrlKey || event.metaKey });
        anchor = changed.anchor; currentPage = index; jumpInput.value = String(index + 1); setSelection(changed.selected); clearError(); if (ownsTask()) onNavigate?.(index, entry);
      });
      grid.append(tile); pending.push({ entry, canvas });
    }
    updateSelection();
    ready = (async () => {
      const documents = new Map();
      const destroyDocuments = async () => { const tasks = [...documents.values()]; documents.clear(); await Promise.allSettled(tasks.map((value) => value.task.destroy())); };
      const cancelDocuments = () => { void destroyDocuments(); };
      signal.addEventListener('abort', cancelDocuments, { once: true });
      try {
        if (!pdfjs) { const runtime = await import('./lib-loader.js'); pdfjs = await runtime.ensurePdfJs(); pdfjsAssets = runtime.PDFJS_ASSET_URLS; }
        for (const { entry, canvas } of pending) {
          if (!ownsTask() || renderEpoch !== epoch || signal.aborted) return;
          let owned = documents.get(entry.sourceId);
          if (!owned) {
            if (documents.size >= PAGE_THUMBNAIL_DOCUMENTS) { const oldest = documents.keys().next().value, removed = documents.get(oldest); documents.delete(oldest); await removed.task.destroy(); }
            if (!ownsTask() || renderEpoch !== epoch || signal.aborted) return;
            const task = pdfjs.getDocument({ data: sources.get(entry.sourceId).slice(), ...pdfjsAssets });
            owned = { task, promise: task.promise }; documents.set(entry.sourceId, owned);
          } else { documents.delete(entry.sourceId); documents.set(entry.sourceId, owned); }
          const sourceDocument = await owned.promise;
          if (!ownsTask() || renderEpoch !== epoch || signal.aborted) { canvas.width = 0; canvas.height = 0; return; }
          await renderBoundedPage(await sourceDocument.getPage(entry.pageIndex + 1), canvas, { signal, maxDimension: 220, maxPixels: 220000 });
          if (!ownsTask() || renderEpoch !== epoch || signal.aborted) { canvas.width = 0; canvas.height = 0; return; }
          canvas.style.setProperty('--page-thumbnail-rotation', `${entry.rotation}deg`);
        }
      } catch (error) { if (!signal.aborted && ownsTask() && renderEpoch === epoch && error.name !== 'AbortError') showError(t('pages.thumbnail_failed', 'A page thumbnail could not be displayed. Try opening the page preview.')); }
      finally { signal.removeEventListener('abort', cancelDocuments); await destroyDocuments(); if (renderEpoch === epoch) root.setAttribute('aria-busy', 'false'); }
    })();
    return ready;
  }
  replaceSources(initialSources);
  documentSession.setSelection(selected()); updateSelection(); void renderWindow();
  return {
    element: root,
    ready: () => { ownsTask(); return ready; },
    selection: selected,
    setSelection,
    refreshSelection: updateSelection,
    async setPlan(nextPlan, nextSources) {
      if (!ownsTask()) throw new DOMException('This page workspace belongs to a closed or replaced document task.', 'AbortError');
      const previous = plan, previousSelection = selected(), selectedIds = new Set(previousSelection.map((index) => previous.pages[index].id)), currentId = previous.pages[currentPage].id;
      const candidate = validatePagePlan(nextPlan);
      const previousSources = sources; plan = candidate;
      try { if (nextSources) replaceSources(nextSources); else for (const source of plan.sources) if (!sources.has(source.id)) throw new RangeError('A page source is unavailable.'); }
      catch (error) { plan = previous; sources = previousSources; throw error; }
      const retainedIndex = plan.pages.findIndex((entry) => entry.id === currentId);
      // Keep the same page identity after moves. If removed, use the page now at
      // its previous output position, or the last remaining page when necessary.
      currentPage = retainedIndex >= 0 ? retainedIndex : Math.min(currentPage, plan.pages.length - 1); windowStart = Math.floor(currentPage / PAGE_THUMBNAIL_WINDOW) * PAGE_THUMBNAIL_WINDOW; anchor = null; jumpInput.max = String(plan.pages.length); jumpInput.value = String(currentPage + 1);
      setSelection(plan.pages.flatMap((entry, index) => selectedIds.has(entry.id) ? [index] : []));
      const rendering = renderWindow(); if (ownsTask()) onNavigate?.(currentPage, plan.pages[currentPage]); return rendering;
    },
    dispose,
  };
}
