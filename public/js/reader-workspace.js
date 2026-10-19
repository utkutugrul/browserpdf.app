import { ensurePdfJs, PDFJS_ASSET_URLS } from './lib-loader.js';
import { documentSession, getWorkspaceInput, stashForChain, showDocumentIdentity, showError, hideError } from './tool-ui.js';
import { t, getLang } from './i18n.js';
import { renderBoundedPage } from './core/bounded-renderer.js';
import { createTextCache, readBoundedText, findTextMatches, resolveDestination, TEXT_LIMITS } from './core/reader-text.js';

const $ = (id) => document.getElementById(id);
const element = (tag, id, text) => { const node = document.createElement(tag); if (id) node.id = id; if (text) node.textContent = text; return node; };
const button = (id, text) => { const node = element('button', id, text); node.type = 'button'; node.className = 'btn btn-ghost btn-small'; return node; };
let stylesheet;
function style() {
  stylesheet ||= new Promise((resolve, reject) => { const link = element('link'); link.rel = 'stylesheet'; link.href = new URL('../css/reader-workspace.css', import.meta.url).href; link.onload = resolve; link.onerror = () => { link.remove(); stylesheet = null; reject(new Error('Could not load the Reader layout. Try opening the PDF again.')); }; document.head.append(link); });
  return stylesheet;
}

export async function openReaderWorkspace(parsed, { isCurrent = () => true, signal: openingSignal, mode = 'view-pdf', onSelection, onReady, onPage, beforeContinueMode } = {}) {
  const lifetime = new AbortController(), cache = createTextCache();
  let disposed = false, task, pdf, textLayer, renderController, searchController, thumbnailController;
  let pageIndex = 0, zoom = 1, fitted = true, renderEpoch = 0, searchEpoch = 0, thumbnailsEpoch = 0, navigationEpoch = 0;
  let rendering = Promise.resolve(), thumbnailRendering = Promise.resolve(), viewport, currentModel, selectionMatch, busy = false, pageReady = false, revealed = false, fittedWidth = 0;
  let refreshing = Promise.resolve(), refreshController, refreshEpoch = 0, refreshPending = false, disabled = false, sourceEpoch = 0, outlineEpoch = 0, outlineLoaded = false, searchActive = false;
  const alive = () => !disposed && !lifetime.signal.aborted && isCurrent();
  const assert = () => { openingSignal?.throwIfAborted(); lifetime.signal.throwIfAborted(); if (!alive()) throw new DOMException('The document was replaced.', 'AbortError'); };
  const listen = (node, event, handler) => node.addEventListener(event, handler, { signal: lifetime.signal });
  const blocked = () => busy || disabled || refreshPending;
  const section = $('viewerSection'), container = $('viewerContainer'), canvas = $('pdfCanvas'), toolbar = section.querySelector('.result-toolbar');
  const originalToolbar = toolbar.innerHTML;
  const generated = element('div', 'readerTools'), status = element('p', 'readerStatus'); status.setAttribute('role', 'status');
  const surface = element('div', 'readerPageSurface'); surface.className = 'reader-page-surface';
  const textContainer = element('div', 'readerTextLayer'); textContainer.className = 'reader-text-layer';
  const searchPaint = element('div', 'readerSearchPaint'); searchPaint.className = 'reader-search-paint'; searchPaint.setAttribute('aria-hidden', 'true');
  const linkLayer = element('div', 'readerLinkLayer'); linkLayer.className = 'reader-link-layer';
  const replacement = element('details', 'readerReplace'), modes = element('details', 'readerModes');
  replacement.append(element('summary', null, t('workspace.replace_pdf', 'Replace PDF'))); modes.append(element('summary', null, t('workspace.modes', 'Document tools')));
  const modeNav = element('nav', 'workspaceModes'); modeNav.setAttribute('aria-label', t('workspace.modes', 'Document tools')); modes.append(modeNav);
  const searchPanel = element('details', 'readerSearch'), outlinePanel = element('details', 'readerOutline'), thumbnailsPanel = element('details', 'readerThumbnails');
  searchPanel.append(element('summary', null, t('reader.search', 'Search text'))); outlinePanel.append(element('summary', null, t('reader.outline', 'Outline'))); thumbnailsPanel.append(element('summary', null, t('reader.thumbnails', 'Pages')));
  const form = element('form', 'readerSearchForm'), query = element('input', 'readerSearchQuery'); query.type = 'search'; query.maxLength = 256; query.placeholder = t('reader.search_placeholder', 'Find text in this PDF'); query.setAttribute('aria-label', t('reader.search', 'Search text'));
  const find = button('readerSearchBtn', t('reader.find', 'Find')), cancel = button('readerCancelSearchBtn', t('common.cancel', 'Cancel')); find.type = 'submit'; cancel.disabled = true;
  const searchStatus = element('p', 'readerSearchStatus'), results = element('ol', 'readerSearchResults'); searchStatus.setAttribute('role', 'status');
  const searchHelp = element('p', null, t('reader.search_limits', 'Case and diacritic insensitive; first 200 matches. Search follows extracted text order. Some scripts, ligatures, scans and unusual text encodings may need OCR or Extract Text.')); searchHelp.className = 'reader-help';
  form.append(query, find, cancel); searchPanel.append(form, searchStatus, results, searchHelp);
  const outline = element('ol', 'readerOutlineItems'), outlineStatus = element('p', 'readerOutlineStatus'); outlinePanel.append(outlineStatus, outline);
  const thumbs = element('div', 'readerThumbnailItems'), thumbControls = element('div'), previousThumbs = button('readerPreviousThumbnails', 'Previous pages'), nextThumbs = button('readerNextThumbnails', 'Next pages'); thumbControls.append(previousThumbs, nextThumbs); thumbnailsPanel.append(thumbControls, thumbs); let thumbnailStart = 0;
  const panels = element('div', 'readerPanels'); panels.append(searchPanel, outlinePanel, thumbnailsPanel);
  const pageInput = element('input', 'readerPage'); pageInput.type = 'number'; pageInput.min = '1'; pageInput.setAttribute('aria-label', t('workspace.current_page', 'Current page'));
  const pageLabel = element('label', null, t('reader.page', 'Page')); pageLabel.append(pageInput);
  const controls = () => {
    if (!alive() || !pdf) return;
    const locked = blocked();
    $('pageIndicator').textContent = t('view-pdf.js_page_of', 'Page {x} of {n}', { x: pageIndex + 1, n: pdf.numPages });
    pageInput.value = String(pageIndex + 1); $('zoomLevel').textContent = `${Math.round(zoom * 100)}%`;
    $('prevPageBtn').disabled = locked || pageIndex === 0; $('nextPageBtn').disabled = locked || pageIndex === pdf.numPages - 1;
    for (const id of ['zoomInBtn', 'zoomOutBtn', 'fitWidthBtn', 'printBtn']) $(id).disabled = locked;
    pageInput.disabled = locked;
    for (const control of modeNav.querySelectorAll('button')) control.disabled = locked || !pageReady;
    for (const control of panels.querySelectorAll('ol button, #readerThumbnailItems button')) control.disabled = locked || control.dataset.readerUnsupported === 'true';
    previousThumbs.disabled = locked || thumbnailStart === 0; nextThumbs.disabled = locked || thumbnailStart + 8 >= pdf.numPages;
    find.disabled = locked || searchActive; cancel.disabled = locked || !searchActive;
    section.setAttribute('aria-busy', String(!pageReady || refreshPending || disabled));
  };
  function clearSearchPaint() { selectionMatch = null; searchPaint.replaceChildren(); }
  function displayMatch(match) {
    if (!textLayer || !pageReady) return;
    searchPaint.replaceChildren();
    const range = document.createRange(), first = match.ranges[0], last = match.ranges.at(-1);
    if (!first || !last) return;
    const start = textLayer.textDivs[first.index]?.firstChild, end = textLayer.textDivs[last.index]?.firstChild;
    if (!start || !end) return;
    range.setStart(start, first.start); range.setEnd(end, last.end);
    const box = surface.getBoundingClientRect();
    for (const rect of range.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      const mark = element('span'); mark.style.cssText = `left:${rect.left - box.left}px;top:${rect.top - box.top}px;width:${rect.width}px;height:${rect.height}px`; searchPaint.append(mark);
    }
    selectionMatch = match;
    const firstMark = searchPaint.firstElementChild; if (firstMark) firstMark.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  async function modelFor(index, signal) {
    const cached = cache.get(index); if (cached) return cached;
    const document = pdf, epoch = sourceEpoch, page = await document.getPage(index + 1); assert(); signal?.throwIfAborted();
    const model = await readBoundedText(page, { signal }); assert(); signal?.throwIfAborted();
    if (document !== pdf || epoch !== sourceEpoch) throw new DOMException('The Reader source changed.', 'AbortError');
    return cache.put(index, model);
  }
  async function linksFor(page, displayViewport, signal, epoch, prepared) {
    // Plain internal destinations only. External URLs, actions, scripts, XFA
    // and form rendering are deliberately outside this direct reader.
    const annotations = prepared || await page.getAnnotations({ intent: 'display' }); assert(); signal.throwIfAborted();
    if (epoch !== renderEpoch) return;
    linkLayer.replaceChildren();
    let count = 0;
    for (const annotation of annotations) {
      if (annotation.subtype !== 'Link' || !annotation.dest || !Array.isArray(annotation.rect) || annotation.rect.length !== 4 || !annotation.rect.every(Number.isFinite)) continue;
      if (++count > 200) { status.textContent += ' Only the first 200 internal links on this page are available.'; break; }
      const [x1, y1] = displayViewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]), [x2, y2] = displayViewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
      const link = button(null, ''); link.className = 'reader-internal-link'; link.setAttribute('aria-label', t('reader.internal_destination', 'Go to linked page'));
      link.style.cssText = `left:${Math.min(x1, x2)}px;top:${Math.min(y1, y2)}px;width:${Math.abs(x2 - x1)}px;height:${Math.abs(y2 - y1)}px`;
      listen(link, 'click', () => destination(annotation.dest)); linkLayer.append(link);
    }
  }
  function render(index, { fit = fitted, match } = {}) {
    if (!alive() || !pdf || !Number.isInteger(index) || index < 0 || index >= pdf.numPages) return Promise.resolve();
    const epoch = ++renderEpoch; pageIndex = index; pageReady = false; controls();
    renderController?.abort(); textLayer?.cancel(); textLayer = null; clearSearchPaint();
    const control = new AbortController(); renderController = control;
    const abort = () => control.abort(); lifetime.signal.addEventListener('abort', abort, { once: true });
    rendering = rendering.catch(() => {}).then(async () => {
      assert(); control.signal.throwIfAborted();
      const page = await pdf.getPage(index + 1); assert(); control.signal.throwIfAborted();
      const base = page.getViewport({ scale: 1 });
      const width = Math.max(40, container.clientWidth - 16);
      const scale = Math.min(8, (width / base.width) * (fit ? 1 : zoom));
      // Display geometry remains logical even after the bitmap reaches its
      // budget. PDF.js's output transform bounds only the backing resolution;
      // text, links, range selection and onPage/onSelection use this viewport.
      viewport = page.getViewport({ scale });
      const nativeViewport = await renderBoundedPage(page, canvas, { scale, displayViewport: viewport, maxDimension: 1200, maxPixels: 2000000, signal: control.signal });
      assert(); control.signal.throwIfAborted(); if (epoch !== renderEpoch) return;
      const displayWidth = Math.max(1, Math.floor(viewport.width)), displayHeight = Math.max(1, Math.floor(viewport.height));
      surface.style.width = `${displayWidth}px`; surface.style.height = `${displayHeight}px`;
      canvas.style.width = `${displayWidth}px`; canvas.style.height = `${displayHeight}px`;
      textContainer.replaceChildren(); linkLayer.replaceChildren();
      surface.style.setProperty('--total-scale-factor', String(viewport.scale * page.userUnit));
      let textError;
      try {
        currentModel = await modelFor(index, control.signal); assert(); control.signal.throwIfAborted();
        // Pinned constructor/render signatures: pdfjs-dist/types/src/display/text_layer.d.ts.
        const runtime = await ensurePdfJs(); assert(); control.signal.throwIfAborted();
        textLayer = new runtime.TextLayer({ textContentSource: currentModel.content, container: textContainer, viewport });
        await textLayer.render(); assert(); control.signal.throwIfAborted();
      } catch (error) { if (control.signal.aborted || !alive()) throw error; textError = error.message; currentModel = null; textLayer?.cancel(); textLayer = null; textContainer.replaceChildren(); }
      if (epoch !== renderEpoch) return;
      pageReady = true; fitted = fit; fittedWidth = width; documentSession.setSelection([index]);
      // Moving the intake into its compact closed panel can trigger document
      // scroll anchoring. Reveal the owned loaded task before readiness unlocks.
      if (!revealed) { section.scrollIntoView({ block: 'start', behavior: 'instant' }); revealed = true; }
      status.textContent = textError || t('reader.ready', 'Select text on the page.');
      if (nativeViewport.scale < viewport.scale) status.textContent += ' Preview resolution is limited to 1,200 pixels per dimension.';
      controls(); if (match) displayMatch(match); else container.scrollTop = 0;
      onPage?.({ page, pageIndex: index, viewport, model: currentModel, textLayer, surface });
      await linksFor(page, viewport, control.signal, epoch);
    }).catch((error) => { if (alive() && !control.signal.aborted && epoch === renderEpoch) { pageReady = false; status.textContent = error.message; showError(error.message); controls(); } }).finally(() => lifetime.signal.removeEventListener('abort', abort));
    return rendering;
  }
  // Explicit page/zoom choices share ownership with asynchronous PDF
  // destinations. Incidental reflow calls render directly and keeps that intent.
  function navigate(index, options) {
    if (!alive() || blocked() || !pdf || !Number.isInteger(index) || index < 0 || index >= pdf.numPages) return Promise.resolve();
    ++navigationEpoch;
    return render(index, options);
  }
  async function destination(value) {
    if (blocked()) return;
    const epoch = ++navigationEpoch;
    try { const index = await resolveDestination(pdf, value); assert(); if (epoch !== navigationEpoch) return; if (index === null) throw new Error('This outline or link has no supported page destination.'); await render(index); }
    catch (error) { if (alive() && epoch === navigationEpoch) showError(error.message); }
  }
  async function search() {
    if (blocked()) return;
    searchController?.abort(); const epoch = ++searchEpoch, control = new AbortController(); searchController = control;
    results.replaceChildren(); clearSearchPaint(); const value = query.value.trim();
    if (!value) { searchStatus.textContent = t('reader.enter_query', 'Enter text to search.'); return; }
    searchActive = true; controls(); let count = 0, skipped = 0, scanned = 0;
    try {
      for (let i = 0; i < pdf.numPages && count < TEXT_LIMITS.results; i++) {
        assert(); control.signal.throwIfAborted(); if (epoch !== searchEpoch) return;
        searchStatus.textContent = t('reader.search_page', 'Searching page {x} of {n}…', { x: i + 1, n: pdf.numPages });
        let model;
        try { model = await modelFor(i, control.signal); } catch (error) { control.signal.throwIfAborted(); if (error instanceof RangeError) { skipped++; scanned++; continue; } throw error; }
        assert(); control.signal.throwIfAborted(); if (epoch !== searchEpoch) return;
        for (const match of findTextMatches(model, value, TEXT_LIMITS.results - count)) {
          const item = element('li'), result = button(null, t('reader.match', 'Page {n}: {text}', { n: i + 1, text: match.excerpt })); result.dataset.pageIndex = String(i);
          listen(result, 'click', () => navigate(i, { match })); item.append(result); results.append(item); count++;
        }
        scanned++;
        // Yield between pages so cancellation and keyboard input remain usable.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (alive() && epoch === searchEpoch) searchStatus.textContent = `${count} ${t('reader.matches', 'matches')}. ${scanned}/${pdf.numPages} ${t('reader.pages_searched', 'pages searched')}.${count === TEXT_LIMITS.results ? ' First 200 matches shown; search stopped at the limit.' : ''}${skipped ? ` ${skipped} pages exceeded the text budget and were skipped.` : ''}`;
    } catch (error) { if (alive() && epoch === searchEpoch) searchStatus.textContent = control.signal.aborted ? `Search canceled. ${count} matches from ${scanned}/${pdf.numPages} pages searched.` : error.message; }
    finally { if (alive() && epoch === searchEpoch) { searchActive = false; controls(); } }
  }
  async function outlineItems() {
    const document = pdf, epoch = ++outlineEpoch, items = await document.getOutline(); assert();
    if (document !== pdf || epoch !== outlineEpoch) return;
    outline.replaceChildren();
    let count = 0, limited = (items || []).length > 300; const queue = (items || []).slice(0, 300).map((item) => ({ item, depth: 0 }));
    while (queue.length && count < 300) {
      const { item, depth } = queue.shift(); count++;
      const li = element('li'), control = button(null, String(item.title || 'Untitled outline').slice(0, 500)); control.disabled = !item.dest; control.dataset.readerUnsupported = String(!item.dest); control.style.paddingInlineStart = `${.5 + Math.min(depth, 8) * .6}rem`;
      listen(control, 'click', () => destination(item.dest)); li.append(control); outline.append(li);
      if (Array.isArray(item.items) && item.items.length) {
        if (depth < 16) { const room = Math.max(0, 300 - count - queue.length); if (item.items.length > room) limited = true; queue.unshift(...item.items.slice(0, room).map((child) => ({ item: child, depth: depth + 1 }))); }
        else limited = true;
      }
    }
    outlineStatus.textContent = !count ? t('reader.no_outline', 'This PDF has no outline.') : limited || queue.length ? 'First 300 outline items shown (up to 16 levels).' : `${count} outline items.`;
  }
  function thumbnails() {
    thumbnailController?.abort(); const control = new AbortController(); thumbnailController = control;
    const epoch = ++thumbnailsEpoch;
    thumbnailRendering = thumbnailRendering.catch(() => {}).then(async () => {
      if (!thumbnailsPanel.open) return;
      thumbs.replaceChildren();
      for (let i = thumbnailStart; i < Math.min(pdf.numPages, thumbnailStart + 8); i++) {
        assert(); control.signal.throwIfAborted(); if (epoch !== thumbnailsEpoch) return;
        const page = await pdf.getPage(i + 1); assert(); control.signal.throwIfAborted();
        const tile = button(null, ''), image = element('canvas'); tile.setAttribute('aria-label', `Page ${i + 1}`); tile.dataset.pageIndex = String(i);
        await renderBoundedPage(page, image, { scale: 100 / page.getViewport({ scale: 1 }).width, maxDimension: 220, maxPixels: 100000, signal: control.signal });
        assert(); control.signal.throwIfAborted(); if (epoch !== thumbnailsEpoch) return;
        tile.append(image, element('span', null, String(i + 1))); listen(tile, 'click', () => navigate(i)); thumbs.append(tile);
      }
      previousThumbs.disabled = thumbnailStart === 0; nextThumbs.disabled = thumbnailStart + 8 >= pdf.numPages;
    }).catch((error) => { if (alive() && !control.signal.aborted) showError(error.message); });
    return thumbnailRendering;
  }
  function refresh({ operation } = {}) {
    if (!alive()) return Promise.reject(new DOMException('The document was replaced.', 'AbortError'));
    const epoch = ++refreshEpoch, owner = documentSession.snapshot(), requestedPage = pageIndex;
    const exactOwner = () => { const now = documentSession.snapshot(); return now.taskId === owner.taskId && now.revision === owner.revision && now.generation === owner.generation; };
    refreshController?.abort(); const control = new AbortController(); refreshController = control;
    const owns = () => alive() && epoch === refreshEpoch && exactOwner() && !control.signal.aborted && (!operation || operation.isCurrent());
    const check = () => { assert(); control.signal.throwIfAborted(); operation?.signal?.throwIfAborted(); if (!owns()) throw new DOMException('The Reader refresh was replaced.', 'AbortError'); };
    const abort = () => control.abort(); lifetime.signal.addEventListener('abort', abort, { once: true }); operation?.signal?.addEventListener('abort', abort, { once: true });
    ++navigationEpoch; renderController?.abort(); searchController?.abort(); thumbnailController?.abort(); ++searchEpoch; ++thumbnailsEpoch; searchActive = false;
    refreshPending = true; controls();
    refreshing = refreshing.catch(() => {}).then(async () => {
      let candidateTask, candidateLayer, retiredTask;
      const candidateCanvas = element('canvas'), candidateText = element('div'); candidateText.className = 'reader-text-layer';
      const cancelCandidate = () => { candidateLayer?.cancel(); void candidateTask?.destroy().catch(() => {}); };
      control.signal.addEventListener('abort', cancelCandidate, { once: true });
      try {
        check(); await Promise.all([rendering.catch(() => {}), thumbnailRendering.catch(() => {})]); check();
        const input = await getWorkspaceInput({ operation: { signal: control.signal, isCurrent: owns } }); check();
        if (!input) throw new DOMException('The Reader input changed.', 'AbortError');
        const runtime = await ensurePdfJs(); check(); candidateTask = runtime.getDocument({ data: input.bytes.slice(), ...PDFJS_ASSET_URLS });
        const candidatePdf = await candidateTask.promise; check();
        if (!candidatePdf.numPages || candidatePdf.numPages > 10000) throw new RangeError('Reader supports up to 10,000 pages.');
        const index = Math.min(candidatePdf.numPages - 1, requestedPage), page = await candidatePdf.getPage(index + 1); check();
        const base = page.getViewport({ scale: 1 }), width = Math.max(40, container.clientWidth - 16), scale = Math.min(8, (width / base.width) * (fitted ? 1 : zoom));
        const display = page.getViewport({ scale });
        const native = await renderBoundedPage(page, candidateCanvas, { scale, displayViewport: display, maxDimension: 1200, maxPixels: 2000000, signal: control.signal }); check();
        let model, textError;
        try {
          model = await readBoundedText(page, { signal: control.signal }); check();
          candidateLayer = new runtime.TextLayer({ textContentSource: model.content, container: candidateText, viewport: display });
          await candidateLayer.render(); check();
        } catch (error) {
          check(); textError = error.message; model = null; candidateLayer?.cancel(); candidateLayer = null; candidateText.replaceChildren();
          if (!(error instanceof RangeError)) throw error;
        }
        const annotations = await page.getAnnotations({ intent: 'display' }); check();
        // The old PDF/cache/DOM stay intact until the selected candidate page
        // has actually rendered and its bounded native text layer is prepared.
        // One serial candidate temporarily adds at most one 1200-edge/2M canvas.
        retiredTask = task; task = candidateTask; candidateTask = null; pdf = candidatePdf; sourceEpoch++;
        textLayer?.cancel(); textLayer = candidateLayer; candidateLayer = null;
        viewport = display; currentModel = model; pageIndex = index; fittedWidth = width;
        cache.clear(); if (model) cache.put(index, model);
        canvas.width = candidateCanvas.width; canvas.height = candidateCanvas.height; canvas.getContext('2d').drawImage(candidateCanvas, 0, 0);
        const displayWidth = Math.max(1, Math.floor(display.width)), displayHeight = Math.max(1, Math.floor(display.height));
        surface.style.width = canvas.style.width = `${displayWidth}px`; surface.style.height = canvas.style.height = `${displayHeight}px`;
        surface.style.setProperty('--total-scale-factor', String(display.scale * page.userUnit));
        textContainer.style.cssText = candidateText.style.cssText;
        if (candidateText.hasAttribute('data-main-rotation')) textContainer.setAttribute('data-main-rotation', candidateText.getAttribute('data-main-rotation')); else textContainer.removeAttribute('data-main-rotation');
        textContainer.replaceChildren(...candidateText.childNodes); clearSearchPaint(); results.replaceChildren(); searchStatus.textContent = '';
        ++outlineEpoch; outlineLoaded = false; outline.replaceChildren(); outlineStatus.textContent = '';
        for (const image of thumbs.querySelectorAll('canvas')) image.width = image.height = 0; thumbs.replaceChildren();
        pageInput.max = String(pdf.numPages); pageReady = true; documentSession.setSelection([index]);
        status.textContent = textError || t('reader.ready', 'Select text on the page.');
        if (native.scale < display.scale) status.textContent += ' Preview resolution is limited to 1,200 pixels per dimension.';
        await linksFor(page, display, control.signal, renderEpoch, annotations); check();
        onPage?.({ page, pageIndex: index, viewport, model: currentModel, textLayer, surface });
        if (outlinePanel.open) { outlineLoaded = true; const document = pdf; void outlineItems().catch((error) => { if (alive() && pdf === document) { outlineLoaded = false; outlineStatus.textContent = error.message; } }); }
        if (thumbnailsPanel.open) { thumbnailStart = Math.floor(index / 8) * 8; void thumbnails(); }
        return true;
      } finally {
        control.signal.removeEventListener('abort', cancelCandidate); lifetime.signal.removeEventListener('abort', abort); operation?.signal?.removeEventListener('abort', abort);
        candidateLayer?.cancel(); if (candidateTask) await candidateTask.destroy().catch(() => {}); if (retiredTask) await retiredTask.destroy().catch(() => {});
        candidateCanvas.width = candidateCanvas.height = 0; candidateText.replaceChildren();
        if (epoch === refreshEpoch && alive()) { refreshPending = false; controls(); }
      }
    });
    return refreshing;
  }
  async function continueMode(slug) {
    if (!pageReady || blocked()) return;
    const epoch = ++navigationEpoch; let owner = documentSession.snapshot();
    const owns = () => { const now = documentSession.snapshot(); return alive() && epoch === navigationEpoch && now.taskId === owner.taskId && now.revision === owner.revision && now.generation === owner.generation; };
    busy = true; controls();
    try {
      if (beforeContinueMode && await beforeContinueMode(slug) === false) return;
      assert(); if (!owns()) return;
      const operation = { signal: lifetime.signal, isCurrent: owns }, input = await getWorkspaceInput({ operation }); assert(); if (!owns() || !input) return;
      if (input.hasScene) { documentSession.publishScene(input.bytes, input.name, { name: input.name, displayName: input.displayName, type: input.type, capabilities: input.capabilities }); owner = documentSession.snapshot(); }
      const handoff = await stashForChain(input.bytes, input.name, slug, { name: input.name, displayName: input.displayName, type: input.type, capabilities: input.capabilities, operation }); assert(); if (!owns() || !handoff.isCurrent()) return;
      const lang = getLang(); location.href = `${lang === 'en' ? '' : '/' + lang}/${slug}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`;
    } catch (error) { if (owns() && error.name !== 'AbortError') showError(error.message); }
    finally { if (alive()) { busy = false; controls(); } }
  }
  function dispose() {
    if (disposed) return; disposed = true; lifetime.abort(); refreshController?.abort(); renderController?.abort(); searchController?.abort(); thumbnailController?.abort(); textLayer?.cancel(); cache.clear();
    void task?.destroy().catch(() => {});
    const dropzone = $('dropzone'); if (dropzone) section.before(dropzone); const identity = $('documentIdentity'); if (identity) section.before(identity);
    generated.remove(); panels.remove(); status.remove(); pageLabel.remove();
    surface.replaceWith(canvas); toolbar.innerHTML = originalToolbar; section.hidden = true; document.body.classList.remove('reader-loaded');
  }
  openingSignal?.addEventListener('abort', dispose, { once: true });
  try {
    await style(); assert();
    const input = await getWorkspaceInput({ operation: { signal: lifetime.signal, isCurrent: alive } }); assert();
    if (!input) throw new DOMException('The document was replaced.', 'AbortError');
    const pdfjs = await ensurePdfJs(); assert(); task = pdfjs.getDocument({ data: input.bytes.slice(), ...PDFJS_ASSET_URLS }); pdf = await task.promise; assert();
    if (!pdf.numPages || pdf.numPages > 10000) throw new RangeError('Reader supports up to 10,000 pages.');
    pageIndex = Math.min(pdf.numPages - 1, Math.max(0, documentSession.snapshot().selection[0] || 0)); pageInput.max = String(pdf.numPages);
    for (const [slug, name] of [['view-pdf', 'Reader'], ['highlight', 'Highlight'], ['redact', 'Redact'], ['fill-sign', 'Fill & Sign'], ['add-text', 'Add Text'], ['add-image', 'Add Image'], ['organize', 'Organize']]) { const control = button(null, t(`workspace.mode_${slug}`, name)); control.dataset.mode = slug; control.setAttribute('aria-current', slug === mode ? 'page' : 'false'); listen(control, 'click', () => continueMode(slug)); modeNav.append(control); }
    modes.append(element('p', null, t('reader.form_help', 'Continue to Fill & Sign to edit page-linked form fields.')));
    replacement.append($('dropzone')); generated.append(modes, replacement); section.prepend(generated); showDocumentIdentity(); const identity = $('documentIdentity'); if (identity) section.prepend(identity);
    section.insertBefore(panels, toolbar); toolbar.querySelector('.btn-row').append(pageLabel); toolbar.after(status);
    canvas.replaceWith(surface); surface.append(canvas, textContainer, searchPaint, linkLayer); container.tabIndex = 0; container.setAttribute('aria-label', 'PDF page; scroll to inspect when zoomed');
    document.body.classList.add('reader-loaded'); section.hidden = false;
    listen($('prevPageBtn'), 'click', () => navigate(pageIndex - 1)); listen($('nextPageBtn'), 'click', () => navigate(pageIndex + 1));
    listen(pageInput, 'change', () => { const target = Number(pageInput.value); if (Number.isInteger(target)) return navigate(target - 1); controls(); });
    listen($('zoomInBtn'), 'click', () => { if (blocked()) return; zoom = Math.min(4, zoom + .25); return navigate(pageIndex, { fit: false }); }); listen($('zoomOutBtn'), 'click', () => { if (blocked()) return; zoom = Math.max(.25, zoom - .25); return navigate(pageIndex, { fit: false }); });
    listen($('fitWidthBtn'), 'click', () => { if (blocked()) return; zoom = 1; return navigate(pageIndex, { fit: true }); });
    listen($('printBtn'), 'click', async () => {
      if (blocked() || !pageReady) return;
      const value = await getWorkspaceInput({ operation: { signal: lifetime.signal, isCurrent: alive } }); if (!alive() || !value) return;
      const url = URL.createObjectURL(new Blob([value.bytes], { type: 'application/pdf' })); const win = window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); if (!win) showError(t('view-pdf.js_err_popup', 'Could not open the print window. Please allow popups for this site.'));
    });
    listen(form, 'submit', (event) => { event.preventDefault(); void search(); }); listen(cancel, 'click', () => searchController?.abort());
    listen(query, 'input', () => { searchController?.abort(); ++searchEpoch; searchActive = false; controls(); results.replaceChildren(); clearSearchPaint(); searchStatus.textContent = ''; });
    listen(outlinePanel, 'toggle', () => { if (outlinePanel.open && !outlineLoaded) { outlineLoaded = true; const document = pdf; void outlineItems().catch((error) => { if (alive() && pdf === document) { outlineLoaded = false; outlineStatus.textContent = error.message; } }); } });
    listen(thumbnailsPanel, 'toggle', () => { if (thumbnailsPanel.open) { thumbnailStart = Math.floor(pageIndex / 8) * 8; void thumbnails(); } else { thumbnailController?.abort(); thumbs.replaceChildren(); } });
    listen(previousThumbs, 'click', () => { thumbnailStart = Math.max(0, thumbnailStart - 8); void thumbnails(); }); listen(nextThumbs, 'click', () => { thumbnailStart = Math.min(pdf.numPages - 1, thumbnailStart + 8); void thumbnails(); });
    listen(document, 'selectionchange', () => { if (alive() && pageReady) onSelection?.({ selection: window.getSelection(), textContainer, textLayer, viewport, model: currentModel, pageIndex, surface }); });
    listen(document, 'keydown', (event) => {
      const selection = window.getSelection();
      if (!alive() || blocked() || /^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY)$/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || (selection?.rangeCount && !selection.isCollapsed && textContainer.contains(selection.anchorNode))) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); void navigate(pageIndex - 1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); void navigate(pageIndex + 1); }
    });
    let resizeTimer; const observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (alive() && !blocked() && fitted && pageReady && Math.abs(fittedWidth - (container.clientWidth - 16)) > 1) void render(pageIndex); }, 120); }); observer.observe(container); lifetime.signal.addEventListener('abort', () => { observer.disconnect(); clearTimeout(resizeTimer); }, { once: true });
    hideError(); await render(pageIndex); assert();
    const api = { dispose, render: navigate, refresh, setDisabled(value) { if (typeof value !== 'boolean') throw new TypeError('Choose whether Reader controls are disabled.'); if (disabled === value) return; disabled = value; if (disabled) ++navigationEpoch; controls(); }, continueMode, get pageIndex() { return pageIndex; }, get ready() { return pageReady && !refreshPending; }, get viewport() { return viewport; }, get textLayer() { return textLayer; }, get model() { return currentModel; }, get pdf() { return pdf; }, surface, textContainer, generated, panels, status, canvas, controls };
    onReady?.(api); return api;
  } catch (error) { dispose(); throw error; }
}
