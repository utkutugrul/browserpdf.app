import { t, getLang } from './i18n.js';
import { ensurePdfLib, ensurePdfJs, PDFJS_ASSET_URLS } from './lib-loader.js';
import { composeImagesPdf, COMPOSITION_DECODED_PIXELS } from './core/image-composition.js';
import { createImageIntake, createImageWorkLane } from './core/image-intake.js';
import { renderBoundedPage } from './core/bounded-renderer.js';

const node = (tag, className, text) => { const value = document.createElement(tag); if (className) value.className = className; if (text !== undefined) value.textContent = text; return value; };
const aborted = () => new DOMException('This image task was replaced or cancelled.', 'AbortError');
function styles() { if (!document.getElementById('imageComposerStyles')) { const link = node('link'); link.id = 'imageComposerStyles'; link.rel = 'stylesheet'; link.href = '/css/image-composer.css'; document.head.append(link); } }

// Both retained entry URLs instantiate this one adapter with their native input.
export async function createImageComposer({ container, fileInput, dropzone, reviewButtonId = 'createBtn', ui, onClear = () => {} }) {
  await ui.ensureDocumentSession(); styles();
  const session = ui.documentSession, lane = createImageWorkLane();
  const inheritedFiles = new WeakSet();
  let disposed = false, owner = session.snapshot().taskId, epoch = 0, candidate = null, controller = null, timer = null, busy = false, displayedId = null, windowStart = 0, thumbController = null, sourceRef = null;
  let previewEpoch = 0, previewController = null;
  const root = node('section', 'image-composer'); root.id = 'imageComposer'; root.setAttribute('aria-label', t('composer.title', 'Image PDF composer'));
  const identity = node('p', 'composer-identity'); identity.id = 'composerIdentity';
  const status = node('p', 'composer-status'); status.id = 'composerStatus'; status.setAttribute('role', 'status');
  const limits = node('p', 'option-hint', t('composer.limits', 'PNG/JPEG only: 16 MiB and 4096 pixels per edge, 16 million pixels each. This task retains up to 48 original images and 48 MiB of originals, including removed images; Clear starts a new task. Up to 16 pending inputs. Normalized images: 48 MiB. PDF export: 48 million unique image pixels and 96 MiB.'));
  const limitDetails = node('details', 'composer-details'); limitDetails.append(node('summary', '', t('composer.resource_limits', 'Image limits and memory')), limits);
  const actions = node('div', 'composer-actions');
  function button(text, id, run) { const value = node('button', 'btn btn-ghost btn-small', text); value.type = 'button'; if (id) value.id = id; value.addEventListener('click', () => { Promise.resolve(run()).catch(fail); }); return value; }
  const undo = button(t('workspace.undo', 'Undo'), 'composerUndoBtn', () => history('undo')), redo = button(t('workspace.redo', 'Redo'), 'composerRedoBtn', () => history('redo'));
  const clear = button(t('composer.clear', 'Clear image task'), 'composerClearBtn', clearTask), cancel = button(t('common.cancel', 'Cancel pending work'), 'composerCancelBtn', cancelPending);
  const openPdf = button(t('composer.open_current_pdf', 'Open current PDF in Add Text'), 'composerOpenPdfBtn', async () => {
    if (session.composition() || !owns()) return; const current = session.current(); if (current?.type !== 'application/pdf') return;
    const operation = ui.documentOperations.begin(), handoff = await ui.stashForChain(current.bytes, current.name, 'add-text', { ...current, operation });
    if (!handoff.isCurrent()) return; location.href = `${getLang() === 'en' ? '' : '/' + getLang()}/add-text?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`;
  });
  const switchUrl = button(t('composer.other_entry', 'Open this composition in the other image tool'), 'composerOtherEntryBtn', async () => {
    const current = session.snapshot(), target = location.pathname.replace(/\/$/, '').endsWith('/jpg-to-pdf') ? 'images' : 'jpg-to-pdf';
    const handoff = await ui.stashCompositionForChain(target, guards(current));
    if (!handoff?.isCurrent()) return;
    const prefix = getLang() === 'en' ? '/' : `/${getLang()}/`;
    location.href = `${prefix}${target}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`;
  });
  actions.append(undo, redo, clear, cancel, switchUrl, openPdf);
  const actionDetails = node('details', 'composer-details'); actionDetails.append(node('summary', '', t('composer.task_actions', 'History, Clear and tool switch')), actions);
  const primaryActions = node('div', 'composer-actions'); primaryActions.append(button(t('composer.add', 'Add PNG / JPEG images'), 'composerAddImagesBtn', () => fileInput.click()), cancel, actionDetails);
  const layout = node('div', 'composer-layout'), sidebar = node('div', 'composer-sidebar'), preview = node('div', 'composer-preview');
  const options = node('div', 'composer-options');
  function select(id, values) { const select = node('select', 'select-input'); select.id = id; for (const [value, text] of values) { const option = node('option', '', text); option.value = value; select.append(option); } return select; }
  function field(text, control) { const label = node('label', 'composer-field'); label.append(node('span', '', text), control); options.append(label); return control; }
  const paper = field(t('composer.paper', 'Paper'), select('composerPaper', [['image', t('composer.image_paper', 'Image / Auto (842 pt longest edge)')], ['a4', 'A4'], ['letter', 'Letter']]));
  const orientation = field(t('composer.orientation', 'Fixed-paper orientation'), select('composerOrientation', [['portrait', t('composer.portrait', 'Portrait')], ['landscape', t('composer.landscape', 'Landscape')]]));
  const margin = node('input', 'select-input'); margin.id = 'composerMargin'; margin.type = 'number'; margin.min = '0'; margin.max = '72'; margin.step = '1'; field(t('composer.margin', 'Margin (pt, 0–72)'), margin);
  const fit = field(t('composer.fit_label', 'Selected image placement'), select('composerFit', [['fit', t('composer.fit', 'Fit: keep the whole image')], ['fill', t('composer.fill', 'Fill: crop to the available area')]]));
  const rotate = button(t('composer.rotate', 'Rotate selected image 90° clockwise'), 'composerRotateBtn', () => changeItem((item) => ({ ...item, rotation: (item.rotation + 90) % 360 })));
  options.append(rotate, node('p', 'option-hint', t('composer.orientation_help', 'Image / Auto follows each rotated image’s proportions. Orientation applies to A4 and Letter.')));
  paper.addEventListener('change', () => edit({ paper: paper.value })); orientation.addEventListener('change', () => edit({ orientation: orientation.value })); margin.addEventListener('input', () => { if (margin.value !== '') edit({ margin: Number(margin.value) }); else invalidate(); }); fit.addEventListener('change', () => changeItem((item) => ({ ...item, fit: fit.value })));
  const paging = node('div', 'composer-actions');
  const previous = button(t('composer.previous', 'Previous images'), 'composerPreviousBtn', () => { windowStart = Math.max(0, windowStart - 12); renderList(); }), next = button(t('composer.next', 'Next images'), 'composerNextBtn', () => { windowStart += 12; renderList(); });
  const count = node('span'); count.id = 'composerWindow'; paging.append(previous, count, next);
  const list = node('ol', 'composer-list'); list.id = 'composerImageList'; sidebar.append(options, paging, list);
  const sourceLabel = node('label', 'composer-field', t('composer.source_compare', 'Compare with an immutable original'));
  const sources = select('composerSource', [['', t('composer.actual_pdf', 'Actual saved PDF preview')]]); sourceLabel.append(sources);
  sources.addEventListener('change', () => { sourceRef = sources.value || null; void renderPreview(); });
  const canvas = node('canvas'); canvas.id = 'composerPreviewCanvas'; canvas.width = canvas.height = 0; canvas.setAttribute('aria-label', t('composer.actual_pdf', 'Actual saved PDF preview'));
  const previewStatus = node('p'); previewStatus.id = 'composerPreviewStatus'; previewStatus.setAttribute('role', 'status');
  const review = button(t('composer.review', 'Review PDF result'), reviewButtonId, reviewCandidate); review.className = 'btn btn-primary';
  preview.append(sourceLabel, previewStatus, canvas, review); layout.append(sidebar, preview); root.append(identity, primaryActions, status, limitDetails, layout); container.replaceChildren(root);
  fileInput.accept = 'image/png,image/jpeg,.png,.jpg,.jpeg';
  const intake = createImageIntake({
    usage: () => { const snapshot = session.snapshot(); return { entries: session.composition()?.items.length || 0, originals: snapshot.originalImageCount || 0, rawBytes: snapshot.compositionRawBytes || 0, normalizedBytes: snapshot.compositionNormalizedBytes || 0 }; },
    normalize: (file, options) => lane.run(async () => (await import('./core/object-scene.js')).imageAsset(file, options), options),
    accept: acceptImage,
    onChange: ({ pending }) => { update(); if (!pending && owns() && session.composition()?.items.length && !candidate && !busy) schedule(); },
    onError: (error, file) => fail(new Error(`${file.name}: ${error.message}`)),
  });
  function guards(snapshot = session.snapshot(), signal) { return { expectedTaskId: snapshot.taskId, expectedRevision: snapshot.revision, ...(signal ? { signal } : {}) }; }
  function owns() { return !disposed && session.snapshot().taskId === owner; }
  function fail(error) { if (owns() && error.name !== 'AbortError') { ui.showError(error.message); update(); } }
  function invalidate() { epoch++; previewEpoch++; previewController?.abort(); previewController = null; controller?.abort(); controller = null; candidate = null; displayedId = null; busy = false; clearTimeout(timer); if (owns()) { ui.documentOperations.cancel(); ui.clearResult(); } update(); }
  function schedule() { invalidate(); busy = true; update(); const token = epoch; timer = setTimeout(() => { void prepare(token).catch(fail); }, 120); }
  function edit(patch) {
    try { const current = session.composition(); if (!current || !owns()) return; session.changeComposition({ ...current, ...patch }, guards()); syncControls(false); schedule(); ui.hideError(); }
    catch (error) { invalidate(); fail(error); }
  }
  function changeItem(change) { const state = session.composition(); if (!state) return; edit({ items: state.items.map((item) => item.id === state.selectedId ? change(item) : item) }); renderList(); }
  function choose(id) { if (!owns()) return; session.setCompositionSelection(id, guards()); sourceRef = null; sources.value = ''; syncControls(); renderSelection(); void renderPreview().catch(fail); }
  function move(id, delta) { const state = session.composition(), index = state.items.findIndex((item) => item.id === id), target = index + delta; if (target < 0 || target >= state.items.length) return; const items = [...state.items]; [items[index], items[target]] = [items[target], items[index]]; edit({ items, selectedId: id }); windowStart = Math.floor(target / 12) * 12; renderList(id); }
  function remove(id) { const state = session.composition(), index = state.items.findIndex((item) => item.id === id), items = state.items.filter((item) => item.id !== id), selectedId = state.selectedId === id ? items[Math.min(index, items.length - 1)]?.id || null : state.selectedId; edit({ items, selectedId }); renderList(selectedId); }
  function history(kind) { invalidate(); session[kind](); owner = session.snapshot().taskId; sourceRef = null; syncControls(); renderList(); if (session.composition()) schedule(); else { canvas.width = canvas.height = 0; previewStatus.textContent = t('composer.pdf_boundary', 'The current task is a PDF. Open it in a PDF tool, or use history to restore its editable image composition.'); } }
  function clearTask() { onClear(); intake.cancel(); invalidate(); thumbController?.abort(); session.clear(); owner = session.snapshot().taskId; busy = false; fileInput.value = ''; canvas.width = canvas.height = 0; renderList(); syncControls(); update(); ui.hideError(); }
  function cancelPending() { intake.cancel(); invalidate(); if (owns()) session.invalidate(); busy = false; syncControls(); update(); if (owns() && session.composition()?.items.length) schedule(); }
  async function acceptImage(file, normalized, operation) {
    if (!owns() || !operation.isCurrent()) throw aborted();
    const bytes = new Uint8Array(await file.arrayBuffer()); operation.signal.throwIfAborted();
    const pair = { id: crypto.randomUUID(), original: { bytes, name: file.name, type: file.type }, asset: normalized, rotation: 0, fit: 'fit' };
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!owns() || !operation.isCurrent()) throw aborted();
      const before = session.snapshot();
      try {
        if (session.composition()) await session.appendCompositionInputs([pair], guards(before, operation.signal));
        else if (inheritedFiles.has(file)) await session.startCompositionFromCurrent(pair, guards(before, operation.signal));
        else await session.beginComposition([pair], guards(before, operation.signal));
        owner = session.snapshot().taskId; syncControls(); renderList(); schedule(); ui.showDocumentIdentity(); if (session.composition().items.length === 1) root.scrollIntoView({ block: 'start' }); return;
      } catch (error) { if (error.name !== 'AbortError' || !operation.isCurrent() || !owns() || attempt === 2) throw error; }
    }
  }
  function syncControls(all = true) {
    const state = session.composition();
    if (state) { if (all || document.activeElement !== paper) paper.value = state.paper; if (all || document.activeElement !== orientation) orientation.value = state.orientation; if (all || document.activeElement !== margin) margin.value = String(state.margin); const selected = state.items.find((item) => item.id === state.selectedId); if (selected) fit.value = selected.fit; }
    update();
  }
  function update() {
    if (disposed) return; const snapshot = session.snapshot(), state = session.composition(), pending = intake?.state().pending || 0;
    identity.textContent = `${t('workspace.current', 'Current')}: ${snapshot.current?.name || t('composer.empty', 'No image task')} · ${snapshot.originalImageCount || 0}/48 ${t('composer.originals', 'retained originals')} · ${state?.items.length || 0} ${t('composer.pages', 'pages')}`;
    identity.title = identity.textContent; identity.setAttribute('aria-label', identity.textContent);
    if (owns()) document.body.classList.toggle('image-task-loaded', !!state || !!pending || !!snapshot.originalImageCount);
    root.hidden = !state && !pending && !snapshot.current; root.setAttribute('aria-busy', String(busy || pending > 0));
    status.textContent = pending ? `${pending} ${t('composer.pending', 'images pending; settings remain editable. Review waits for the queue.')}` : busy ? t('composer.preparing', 'Preparing the actual saved PDF preview…') : !state && snapshot.current ? t('composer.retained_artifact', 'The chosen artifact is retained. Add compatible images, use history, or open the current PDF in a PDF tool.') : t('composer.ready', 'Choose an image to edit its placement. Original files stay immutable.');
    for (const control of [paper, orientation, margin, fit, rotate]) control.disabled = !state;
    orientation.disabled = !state || state.paper === 'image'; fit.disabled = rotate.disabled = !state?.selectedId;
    undo.disabled = !snapshot.canUndo; redo.disabled = !snapshot.canRedo; cancel.hidden = !busy && !pending; switchUrl.disabled = !state || !!pending; clear.disabled = !snapshot.current && !pending;
    openPdf.hidden = !!state || snapshot.current?.type !== 'application/pdf';
    const pixels = new Map((state?.items || []).map((item) => [item.assetId, item.width * item.height]));
    review.disabled = !candidate || candidate.revision !== snapshot.revision || displayedId !== state?.selectedId || sourceRef !== null || busy || !!pending || [...pixels.values()].reduce((sum, value) => sum + value, 0) > COMPOSITION_DECODED_PIXELS;
    fileInput.disabled = false;
  }
  function renderSelection() { const state = session.composition(); for (const row of list.children) row.querySelector('[data-choose-image]')?.setAttribute('aria-current', String(row.dataset.imageId === state?.selectedId)); }
  function releaseThumbs() { for (const value of list.querySelectorAll('canvas')) value.width = value.height = 0; }
  function renderList(focusId) {
    thumbController?.abort(); thumbController = new AbortController(); const signal = thumbController.signal;
    releaseThumbs(); list.replaceChildren(); const state = session.composition(), items = state?.items || [];
    windowStart = Math.min(windowStart, Math.max(0, Math.floor((items.length - 1) / 12) * 12)); const end = Math.min(items.length, windowStart + 12);
    count.textContent = items.length ? `${windowStart + 1}–${end} / ${items.length}` : '0'; previous.disabled = windowStart === 0; next.disabled = end >= items.length;
    const originals = session.compositionSources()?.originals || [], labels = new Map(originals.map((value) => [value.originalRef, value.name]));
    sources.replaceChildren(new Option(t('composer.actual_pdf', 'Actual saved PDF preview'), '')); for (const value of originals) sources.add(new Option(value.name, value.originalRef)); sources.value = sourceRef || '';
    for (let index = windowStart; index < end; index++) {
      const item = items[index], name = item.name || labels.get(item.originalRef) || t('composer.image', 'Image'), row = node('li', 'composer-row'); row.dataset.imageId = item.id;
      const choose = button(`${index + 1}. ${name}`, '', () => chooseItem(item.id)); choose.dataset.chooseImage = item.id; choose.title = name;
      const thumb = node('canvas'); thumb.width = thumb.height = 0; thumb.setAttribute('aria-hidden', 'true');
      const rowActions = node('div', 'composer-actions');
      const up = button('↑', '', () => move(item.id, -1)), down = button('↓', '', () => move(item.id, 1)), removeButton = button('×', '', () => remove(item.id));
      up.setAttribute('aria-label', `${t('composer.move_up', 'Move up')}: ${name}`); down.setAttribute('aria-label', `${t('composer.move_down', 'Move down')}: ${name}`); removeButton.setAttribute('aria-label', `${t('composer.remove', 'Remove')}: ${name}`); up.disabled = index === 0; down.disabled = index === items.length - 1;
      rowActions.append(up, down, removeButton); row.append(thumb, choose, rowActions); list.append(row);
      row.addEventListener('keydown', (event) => { if (event.target instanceof HTMLInputElement) return; if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); move(item.id, event.key === 'ArrowUp' ? -1 : 1); } else if (event.key === 'Delete') { event.preventDefault(); remove(item.id); } });
      void lane.run(async () => {
        if (signal.aborted || !owns()) return; const asset = session.resource(item.assetId); if (!asset) return;
        const bitmap = await createImageBitmap(new Blob([asset.bytes], { type: 'image/png' }));
        try { if (signal.aborted || !owns()) return; const scale = Math.min(1, 220 / Math.max(bitmap.width, bitmap.height)); thumb.width = Math.max(1, Math.floor(bitmap.width * scale)); thumb.height = Math.max(1, Math.floor(bitmap.height * scale)); thumb.getContext('2d').drawImage(bitmap, 0, 0, thumb.width, thumb.height); thumb.style.setProperty('--image-rotation', `${item.rotation}deg`); }
        finally { bitmap.close(); }
      }, { signal }).catch((error) => { if (!signal.aborted) fail(error); });
    }
    renderSelection(); if (focusId) list.querySelector(`[data-choose-image="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true }); update();
  }
  function chooseItem(id) { choose(id); }
  async function prepare(token) {
    if (!owns() || token !== epoch) return; const composition = session.composition(); if (!composition?.items.length) { busy = false; update(); return; }
    const before = session.snapshot(), request = new AbortController(); controller = request;
    try {
      const result = await lane.run(async () => composeImagesPdf(composition, { resource: (id) => session.resource(id), pdfLib: await ensurePdfLib(), signal: request.signal }), { signal: request.signal });
      if (!owns() || token !== epoch || request.signal.aborted || before.revision !== session.snapshot().revision) return;
      candidate = { ...result, revision: before.revision }; busy = false; await renderPreview();
    } catch (error) { if (owns() && token === epoch) { busy = false; fail(error); } }
    finally { if (owns() && token === epoch) update(); }
  }
  async function renderPreview() {
    const token = ++previewEpoch; previewController?.abort(); const request = new AbortController(); previewController = request; const signal = request.signal;
    const state = session.composition(), snapshot = session.snapshot(), requestedId = state?.selectedId, requestedSource = sourceRef, requestedCandidate = candidate, current = () => owns() && token === previewEpoch && !signal.aborted && session.snapshot().taskId === snapshot.taskId && session.snapshot().revision === snapshot.revision;
    displayedId = null; update(); if (!state || (!requestedSource && !candidate)) return;
    canvas.removeAttribute('data-pdf-page'); previewStatus.textContent = t('composer.preview_loading', 'Loading the chosen preview…');
    try {
      await lane.run(async () => {
        const temporary = document.createElement('canvas'); temporary.dataset.composerPreview = requestedId;
        try {
          if (requestedSource) {
            const asset = session.resource(requestedSource); if (!asset) throw new Error('The selected original is unavailable.');
            const bitmap = await createImageBitmap(new Blob([asset.bytes], { type: asset.type }), { imageOrientation: 'from-image' });
            try { if (!current()) return; const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height)); temporary.width = Math.max(1, Math.floor(bitmap.width * scale)); temporary.height = Math.max(1, Math.floor(bitmap.height * scale)); temporary.getContext('2d').drawImage(bitmap, 0, 0, temporary.width, temporary.height); } finally { bitmap.close(); }
          } else {
            const index = state.items.findIndex((item) => item.id === requestedId); if (index < 0) return;
            const runtime = await ensurePdfJs(); signal.throwIfAborted(); const task = runtime.getDocument({ data: requestedCandidate.bytes.slice(), ...PDFJS_ASSET_URLS });
            const cancel = () => { void task.destroy().catch(() => {}); }; signal.addEventListener('abort', cancel, { once: true });
            try { const doc = await task.promise; signal.throwIfAborted(); await renderBoundedPage(await doc.getPage(index + 1), temporary, { signal, maxDimension: 1000, maxPixels: 1_000_000 }); }
            finally { signal.removeEventListener('abort', cancel); try { await task.destroy(); } catch (error) { if (!signal.aborted) throw error; } }
          }
          if (!current()) return; canvas.width = temporary.width; canvas.height = temporary.height; canvas.getContext('2d').drawImage(temporary, 0, 0); displayedId = requestedId;
          canvas.dataset.pdfPage = requestedSource ? 'source' : String(state.items.findIndex((item) => item.id === requestedId) + 1);
          previewStatus.textContent = requestedSource ? `${t('workspace.original', 'Original')}: ${sources.selectedOptions[0]?.textContent || ''}` : `${t('composer.saved_page', 'Actual saved PDF page')} ${state.items.findIndex((item) => item.id === requestedId) + 1} / ${state.items.length}`;
        } finally { temporary.width = temporary.height = 0; }
      }, { signal });
    } catch (error) { if (current()) fail(error); }
    finally { if (current()) update(); }
  }
  async function reviewCandidate() {
    if (review.disabled || !candidate) return; const before = session.snapshot(), artifact = candidate, operation = ui.documentOperations.begin();
    session.setSelection([session.composition().items.findIndex((item) => item.id === session.composition().selectedId)]);
    await ui.reviewResult(artifact.bytes, 'images.pdf', { ...artifact, operation, compositionRevision: before.revision, imageWorkLane: lane, onAdopt: () => { syncControls(); update(); } });
    if (operation.isCurrent()) {
      await ui.offerChain(artifact.bytes, 'images.pdf', [{ slug: 'add-text', label: 'Add Text' }, { slug: 'organize', label: 'Organize' }], { ...artifact, operation });
      const row = document.getElementById('chainRow');
      if (row && !row.querySelector('.composer-boundary')) { const boundary = node('p', 'option-hint composer-boundary', t('composer.continue_boundary', 'Continue with the reviewed PDF to make it current and archive the editable image composition in history. Original images remain available; Undo restores the composition.')); row.append(boundary); }
    }
  }
  function addFiles(files) { if (disposed) return; if (session.snapshot().taskId !== owner) { intake.cancel(); invalidate(); owner = session.snapshot().taskId; } ui.hideError(); const before = intake.state().pending; intake.enqueue(files); if (intake.state().pending > before) invalidate(); }
  syncControls(); renderList(); if (session.composition()?.items.length) schedule();
  return { element: root, addFiles, pending: () => intake.state(), startFromCurrent() { if (session.composition()) { syncControls(); renderList(); schedule(); return; } const current = session.current(); if (!current?.type.startsWith('image/')) return; const file = new File([current.bytes], current.name, { type: current.type }); inheritedFiles.add(file); intake.enqueue([file]); }, cancel: cancelPending, pause() { intake.cancel(); invalidate(); previewController?.abort(); thumbController?.abort(); }, async settled() { await intake.drained(); await lane.drained(); }, dispose() { if (disposed) return; intake.dispose(); invalidate(); previewController?.abort(); thumbController?.abort(); disposed = true; releaseThumbs(); canvas.width = canvas.height = 0; root.remove(); }, refresh() { owner = session.snapshot().taskId; syncControls(); renderList(); if (session.composition()?.items.length) schedule(); } };
}
