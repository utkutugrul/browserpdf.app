import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { documentSession, documentOperations, clearResult, reviewResult, offerChain, stashForChain, showDocumentIdentity, showError, hideError, getWorkspaceInput } from './tool-ui.js';
import { getLang, t } from './i18n.js';
import { renderBoundedPage } from './core/bounded-renderer.js';
import { renderScenePdf, formModel, imageAsset } from './core/object-scene.js';
import { ensureUnicodePreviewFont } from './core/pdf-fonts.js';
import { pdfPointToViewport } from './core/page-geometry.js';
import { mountObjectShell } from './object-shell.js';

const $ = (id) => document.getElementById(id);
const COLORS = { black: [0, 0, 0], red: [.78, .16, .1], blue: [.12, .29, .65], gray: [.55, .55, .55] };
const action = (label, id, callback) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-small'; b.textContent = label; if (id) b.id = id; b.addEventListener('click', callback); return b; };
const labelInput = (label, input) => { const wrap = document.createElement('label'); wrap.textContent = label; wrap.append(input); return wrap; };

export async function openObjectWorkspace(mode, parsed, { isCurrent = () => true, signal: openingSignal } = {}) {
  const assertOwner = () => { openingSignal?.throwIfAborted(); if (!isCurrent()) throw new DOMException('Workspace opening was replaced.', 'AbortError'); };
  let imageQueue = Promise.resolve(), pendingImages = 0, zoom = 1, textDraft = null;
  const preparations = new Map();
  let textSequence = 0, pageSequence = 0, pageReady = false, visualPage = -1, thumbnailSequence = 0, thumbnailController;
  let disposed = false, selected = null, pageIndex = documentSession.snapshot().selection[0] || 0, pageWindow = 0;
  let pdfjs = await ensurePdfJs(), lib = await ensurePdfLib(), sourceTask, sourcePdf, renderedTask;
  let viewport, visual, selectedAsset = null, draftSignature = null, signatureId = null, sigMode = 'draw';
  const assetCleanups = [], imageWidths = new Map(); let imagePreviewUrl = null, resetSignatureDraft = () => {};
  assetCleanups.push(() => { if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl); });
  let drawing = false, pointerId, signatureSequence = 0, renderSequence = 0, timer, rendering = Promise.resolve(), busy = false;
  const disabledBeforeExport = new WeakMap();
  let controller = null, lastRendered = null, lastKey = null, fieldRows = new Map();
  assertOwner(); documentSession.beginScene();
  const scene = () => documentSession.scene();
  const source = documentSession.resource(scene().sourceRef);
  sourceTask = pdfjs.getDocument({ data: source.bytes.slice(), ...PDFJS_ASSET_URLS }); try { sourcePdf = await sourceTask.promise; assertOwner(); } catch (error) { await sourceTask.destroy(); throw error; }
  const sourceDoc = await lib.PDFDocument.load(source.bytes.slice(), { updateMetadata: false });
  try { assertOwner(); } catch (error) { await sourceTask.destroy(); throw error; }
  const fields = formModel(sourceDoc, lib);
  const root = mode === 'add-text' ? $('textOptionsSection') : mode === 'add-image' ? $('optionsSection') : $('signatureSection');
  root.hidden = false;
  if (mode === 'fill-sign') { $('applyRow').hidden = false; $('fieldsSection').hidden = !fields.length; $('noFieldsNote').hidden = fields.length > 0; }
  const canvas = mode === 'add-image' ? $('previewCanvas') : $('placementCanvas');
  const placement = mode === 'add-image' ? $('previewPanel') : $('placementSection'); placement.hidden = false;
  let wrap = mode === 'add-image' ? canvas.parentElement : $('placementWrap'); wrap.classList.add('scene-surface');
  let grid = mode === 'fill-sign' ? $('sigPageGrid') : $('pageGrid');
  if (!grid) { grid = document.createElement('div'); grid.id = 'pageGrid'; grid.className = 'page-grid'; root.after(grid); }
  const toolbar = document.createElement('div'); toolbar.id = 'workspaceModes'; toolbar.className = 'editor-toolbar';
  for (const [slug, name] of [['add-text', 'Add Text'], ['add-image', 'Add Image'], ['fill-sign', 'Fill & Sign'], ['organize', 'Organize']]) {
    const button = action(t(`workspace.mode_${slug}`, name), null, async () => {
      if (busy || pendingImages || preparations.size) return;
      try {
        busy = true; controls();
        const operation = documentOperations.begin();
        const input = await getWorkspaceInput({ operation }); if (!input) return;
        documentSession.publishScene(input.bytes, input.name);
        const handoff = await stashForChain(input.bytes, input.name, slug);
        if (!operation.isCurrent()) return;
        const lang = getLang(); location.href = `${lang === 'en' ? '' : '/' + lang}/${slug}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`;
      } catch (error) { showError(error.message); busy = false; controls(); }
    });
    button.setAttribute('aria-current', slug === mode ? 'page' : 'false'); toolbar.append(button);
  }
  ($('documentIdentity') || root).after(toolbar);
  document.body.classList.add('scene-loaded');
  const status = document.createElement('p'); status.id = 'sceneStatus'; status.setAttribute('role', 'status'); toolbar.after(status);
  const history = document.createElement('div'); history.className = 'editor-toolbar';
  const undo = action(t('workspace.undo', 'Undo'), 'undoEditBtn', () => historyAction('undo'));
  const redo = action(t('workspace.redo', 'Redo'), 'redoEditBtn', () => historyAction('redo'));
  const newObject = action(t('workspace.add_object', 'Add another object'), 'newObjectBtn', () => { ++textSequence; selected = null; signatureId = null; controls(); overlay(); });
  const remove = action(t('workspace.delete_object', 'Delete object'), 'deleteObjectBtn', () => { if (selected) change((s) => { s.objects = s.objects.filter((o) => o.id !== selected); }); selected = null; controls(); });
  history.append(undo, redo, newObject, remove); toolbar.after(history);
  const properties = document.createElement('div'); properties.id = 'objectProperties'; properties.className = 'scene-properties';
  const list = document.createElement('select'); list.id = 'objectList'; list.size = 4; list.setAttribute('aria-label', t('workspace.objects', 'Objects in this task'));
  list.addEventListener('change', () => selectObject(list.value)); properties.append(labelInput(t('workspace.objects', 'Objects in this task'), list));
  const numbers = {};
  for (const [key, name] of [['x', 'X position (pt)'], ['y', 'Y position (pt)'], ['width', 'Width (pt)'], ['height', 'Height (pt)']]) {
    const input = document.createElement('input'); input.type = 'number'; input.step = '0.5'; input.id = `object${key[0].toUpperCase() + key.slice(1)}`;
    if (['width', 'height'].includes(key)) input.min = '1';
    input.addEventListener('change', () => {
      const value = Number(input.value); if (!Number.isFinite(value)) return;
      change((s) => { const object = s.objects.find((o) => o.id === selected); if (!object) return;
        const old = object[key]; object[key] = ['width', 'height'].includes(key) ? Math.max(1, value) : value;
        if (['width', 'height'].includes(key)) { object[key === 'width' ? 'height' : 'width'] *= object[key] / old; if (object.kind === 'text') object.fontSize *= object[key] / old; }
      });
    }); numbers[key] = input; properties.append(labelInput(t(`workspace.object_${key}`, name), input));
  }
  placement.after(properties);
  const layer = document.createElement('div'); layer.className = 'scene-overlay'; wrap.append(layer);
  const widgetLayer = document.createElement('div'); widgetLayer.className = 'scene-widgets'; wrap.append(widgetLayer);
  const fieldEditor = document.createElement('div'); fieldEditor.className = 'scene-field-editor'; fieldEditor.id = 'pageFieldEditor'; fieldEditor.hidden = true; placement.after(fieldEditor);
  const pageNav = document.createElement('div'); pageNav.className = 'editor-toolbar';
  const pageNumber = document.createElement('input'); pageNumber.type = 'number'; pageNumber.min = '1'; pageNumber.max = String(sourcePdf.numPages); pageNumber.id = 'workspacePage'; pageNumber.setAttribute('aria-label', 'Current page');
  pageNav.append(action('Previous pages', 'previousThumbnailSet', () => { pageWindow = Math.max(0, pageWindow - 12); void thumbnails(); }), labelInput('Page', pageNumber), action('Next pages', 'nextThumbnailSet', () => { pageWindow = Math.min(Math.max(0, sourcePdf.numPages - 1), pageWindow + 12); void thumbnails(); })); grid.before(pageNav);
  pageNumber.addEventListener('change', () => { void selectPage(Number(pageNumber.value) - 1); });
  if (mode === 'add-image') {
    const select = $('pageSelect'); select.removeAttribute('data-i18n-aria'); select.setAttribute('aria-label', 'Page scope for new images');
    const pageScope = select.closest('.option-block').querySelector('.option-title span'); if (pageScope) { pageScope.removeAttribute('data-i18n'); pageScope.textContent = 'New image page scope'; }
    const scopeHelp = document.createElement('p'); scopeHelp.className = 'option-hint'; scopeHelp.textContent = 'Choose the page scope before adding an image. Changing this menu navigates; existing images keep their pages.'; select.after(scopeHelp);
    while (select.options.length > 1) select.remove(1);
    for (let i = 1; i <= sourcePdf.numPages; i++) { const option = document.createElement('option'); option.value = String(i); option.textContent = `Page ${i}`; select.append(option); }
    select.addEventListener('change', () => { if (select.value !== 'all') void selectPage(Number(select.value) - 1); });
    $('fileSummary').textContent = parsed.baseName + '.pdf';
    $('imageChooseBtn').addEventListener('click', () => $('imageInput').click());
    $('imageInput').addEventListener('change', () => {
      const file = $('imageInput').files[0]; if (!file) return;
      $('imageInput').value = '';
      if (pendingImages >= 8) { showError(t('workspace.image_queue_full', 'Wait for the current images to finish before adding more (eight pending images maximum).')); return; }
      const intent = imageIntent(); pendingImages++; invalidateDraftReview(); controls();
      // Preserve every accepted intake in event order. Each record owns its file,
      // page scope, geometry and task; a later upload cannot replace those values.
      imageQueue = imageQueue.catch(() => {}).then(async () => {
        if (!ownsImageIntent(intent)) return;
        const asset = await imageAsset(file); if (!ownsImageIntent(intent)) return;
        asset.assetId = await documentSession.addAsset(asset.bytes, asset.type, asset.name);
        if (!ownsImageIntent(intent)) return;
        if (!await addImageAtPosition(null, asset, intent)) return;
        selectedAsset = { assetId: asset.assetId, width: asset.width, height: asset.height }; imageWidths.set(asset.assetId, asset.width * .75); $('imageName').textContent = file.name;
        if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl); imagePreviewUrl = URL.createObjectURL(new Blob([asset.bytes], { type: asset.type })); $('imageThumb').src = imagePreviewUrl; $('imageThumb').hidden = false;
      }).catch((error) => { if (ownsImageIntent(intent)) showError(error.message); }).finally(() => { pendingImages--; if (!disposed && isCurrent()) controls(); });
    });
    $('positionSelect').addEventListener('change', () => { if (selectedAsset) void positionSelectedImage(); });
    for (const id of ['sizeSlider', 'opacitySlider']) $(id).addEventListener('input', () => { const o = scene().objects.find((o) => o.id === selected); if (o?.kind === 'image') change((s) => { const item = s.objects.find((o) => o.id === selected); if (id === 'opacitySlider') item.opacity = Number($(id).value) / 100; else { const width = Math.min(visual.width * .4, imageNativeWidth(item)) * Number($(id).value) / 100; item.height *= width / item.width; item.width = width; } }); $((id === 'sizeSlider' ? 'sizeValue' : 'opacityValue')).textContent = $(id).value + '%'; });
  }
  if (mode === 'add-text') {
    for (const [value, label] of [['helvetica', 'Sans'], ['helvetica-bold', 'Sans bold'], ['times-roman', 'Sans italic'], ['courier', 'Monospace']]) { const option = [...$('fontSelect').options].find((o) => o.value === value); if (option) { option.removeAttribute('data-i18n-opt'); option.textContent = label; } }
    for (const id of ['textInput', 'fontSelect', 'sizeSlider', 'colorSelect']) $(id).addEventListener(['textInput', 'sizeSlider'].includes(id) ? 'input' : 'change', () => { void updateText(); });
    $('charWarning').hidden = true;
  }
  let fillTextActive = false;
  if (mode === 'fill-sign') {
    const text = document.createElement('textarea'); text.id = 'textInput'; text.rows = 2; text.setAttribute('aria-label', 'Text to add to this PDF');
    const textRow = document.createElement('div'); textRow.className = 'option-block'; textRow.append(labelInput('Add text, including PDFs without form fields', text));
    textRow.append(action(t('workspace.place_text_page', 'Place text on current page'), 'fillTextMode', () => { fillTextActive = true; void placeObject(null, true); })); root.before(textRow);
    text.addEventListener('input', () => { fillTextActive = true; void updateText(); });
    setupSignature(); buildFields(); $('flattenInput').checked = scene().flatten;
    $('flattenInput').addEventListener('change', () => change((s) => { s.flatten = $('flattenInput').checked; }));
  }
  const placeDraft = action(t('workspace.place_draft_page', 'Place draft on current page'), 'placeDraftBtn', () => { void placeObject(); });
  placeDraft.className = 'btn btn-secondary'; placeDraft.hidden = mode === 'add-image'; root.append(placeDraft);
  canvas.addEventListener('click', (event) => {
    if (!visual) return;
    const rect = canvas.getBoundingClientRect();
    void placeObject({ x: (event.clientX - rect.left) * visual.width / rect.width, y: (event.clientY - rect.top) * visual.height / rect.height });
  });
  async function placeObject(point = null, forceText = false) {
    if (busy || pendingImages || preparations.size || !pageReady || !visual || disposed || !isCurrent()) return;
    try {
      if (mode === 'add-text' || fillTextActive || forceText) {
        const props = textDraft; if (!props?.text.trim() || props.text !== $('textInput').value) return;
        const id = crypto.randomUUID(), x = point ? point.x : (visual.width - props.width) / 2, y = point ? point.y - props.fontSize : (visual.height - props.height) / 2;
        if (change((s) => s.objects.push({ id, kind: 'text', pageIndex, x, y, ...props }))) selected = id;
      } else if (mode === 'fill-sign') {
        if (!draftSignature) { showError(t('workspace.signature_first', 'Draw, type, or upload a signature first.')); return; }
        const width = Math.min(140, visual.width * .7), height = width * draftSignature.height / draftSignature.width;
        const id = crypto.randomUUID(), x = point ? point.x - width / 2 : (visual.width - width) / 2, y = point ? point.y - height / 2 : (visual.height - height) / 2;
        if (change((s) => s.objects.push({ id, kind: 'signature', pageIndex, x, y, width, height, assetId: draftSignature.assetId, opacity: 1 }))) selected = signatureId = id;
      } else if (selectedAsset) {
        const token = beginPreparation('placement');
        try { await addImageAtPosition(point); } finally { finishPreparation(token); }
      }
      if (selected) shell.showObjectProperties(); controls(); overlay();
      if (!point && selected) {
        const object = layer.querySelector(`[data-object-id="${selected}"]`); object?.focus({ preventScroll: true });
        object?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
    } catch (error) { if (!disposed && isCurrent()) showError(error.message); }
  }
  $('applyBtn').addEventListener('click', apply);
  const shell = mountObjectShell({ mode, root, placement, grid, pageNav, toolbar, history, status, properties, fieldEditor, canvas, zoom(value) { zoom = value; setZoom(); overlay(); widgets(); void preview().catch((error) => { if (!disposed && isCurrent()) showError(error.message); }); } });
  const resizeObserver = new ResizeObserver(() => { overlay(); widgets(); }); resizeObserver.observe(canvas);
  document.addEventListener('keydown', keyboard);
  const lifecycle = { dispose() { disposed = true; preparations.clear(); ++textSequence; ++thumbnailSequence; clearTimeout(timer); controller?.abort(); thumbnailController?.abort(); resizeObserver.disconnect(); document.removeEventListener('keydown', keyboard); for (const cleanup of assetCleanups) cleanup(); void sourceTask.destroy().catch(() => {}); void renderedTask?.destroy().catch(() => {}); for (const old of grid.querySelectorAll('canvas')) old.width = old.height = 0; toolbar.remove(); properties.remove(); layer.remove(); widgetLayer.remove(); history.remove(); status.remove(); pageNav.remove(); fieldEditor.remove(); shell.dispose(); document.body.classList.remove('scene-loaded'); } };
  try { await thumbnails(); assertOwner(); await selectPage(pageIndex); assertOwner(); controls(); shell.reveal(); return lifecycle; }
  catch (error) { lifecycle.dispose(); throw error; }


  function invalidateDraftReview() {
    // The existing canvas still renders the canonical scene. A draft intent
    // invalidates reviewed exports, without interrupting that owned page render.
    lastKey = null; clearResult();
  }
  function beginPreparation(kind, targetId = null, restore = () => {}) {
    const token = { kind, targetId, taskId: documentSession.snapshot().taskId, sourceRef: scene().sourceRef, restore };
    preparations.set(kind, token); invalidateDraftReview(); controls(); return token;
  }
  function ownsPreparation(token) {
    return preparations.get(token.kind) === token && !disposed && isCurrent() && token.taskId === documentSession.snapshot().taskId && token.sourceRef === scene()?.sourceRef;
  }
  function finishPreparation(token) {
    if (preparations.get(token.kind) !== token) return;
    preparations.delete(token.kind); if (!disposed && isCurrent()) controls();
  }
  function cancelPreparation(kind, restore = true) {
    const token = preparations.get(kind); if (!token) return;
    if (restore && ownsPreparation(token)) token.restore(); finishPreparation(token);
  }
  function change(edit) {
    if (busy || disposed || !isCurrent()) return false;
    const next = scene(); edit(next);
    document.querySelectorAll('.field-error').forEach((node) => node.remove());
    try { documentSession.changeScene(next); } catch (error) { showError(error.message); controls(); return false; }
    controller?.abort(); lastKey = null; clearResult(); showDocumentIdentity(); controls(); overlay(); schedule(); return true;
  }
  function controls() {
    const taskControls = document.querySelectorAll('#fieldsSection input,#fieldsSection select,.scene-widgets input,.scene-widgets select,#pageFieldEditor input,#pageFieldEditor select,#textInput,#signatureSection input,#signatureSection select,#signatureSection button,#textOptionsSection input,#textOptionsSection textarea,#textOptionsSection select,#optionsSection input,#optionsSection select,#optionsSection button,#workspaceModes button,.editor-toolbar button,.scene-thumbnails button,#fillTextMode,#workspaceZoom,#workspacePage,#objectList');
    for (const input of taskControls) {
      if (busy) { if (!disabledBeforeExport.has(input)) disabledBeforeExport.set(input, input.disabled); input.disabled = true; }
      else if (disabledBeforeExport.has(input)) { input.disabled = disabledBeforeExport.get(input); disabledBeforeExport.delete(input); }
    }
    const preparing = preparations.size > 0, transitioning = busy || pendingImages > 0 || preparing;
    for (const button of toolbar.querySelectorAll('button')) button.disabled = transitioning;
    $('fileInput').disabled = busy; $('dropzone').setAttribute('aria-disabled', String(busy));
    const state = documentSession.snapshot(); undo.disabled = transitioning || !state.canUndo; redo.disabled = transitioning || !state.canRedo;
    const objects = scene().objects; list.replaceChildren();
    for (const [index, object] of objects.entries()) { const option = document.createElement('option'); option.value = object.id; option.textContent = `${object.kind === 'text' ? object.text.slice(0, 35) : object.kind} · Page ${object.pageIndex + 1} · ${index + 1}`; list.append(option); }
    if (selected && !objects.some((o) => o.id === selected)) selected = null;
    list.value = selected || ''; const object = objects.find((o) => o.id === selected);
    for (const [key, input] of Object.entries(numbers)) { input.disabled = busy || preparing || !object; input.value = object ? String(Math.round(object[key] * 100) / 100) : ''; }
    remove.disabled = transitioning || !object; newObject.disabled = transitioning || !pageReady;
    placeDraft.disabled = transitioning || !pageReady || (mode === 'add-text' || fillTextActive ? !textDraft?.text.trim() : !draftSignature);
    $('fillTextMode') && ($('fillTextMode').disabled = transitioning || !pageReady || !textDraft?.text.trim());
    pageNumber.disabled = list.disabled = busy || preparing;
    if (mode === 'add-image') $('pageSelect').disabled = busy || preparing;
    grid.querySelectorAll('button').forEach((button) => { button.disabled = busy || preparing; });
    $('previousThumbnailSet').disabled = busy || preparing || pageWindow === 0;
    $('nextThumbnailSet').disabled = busy || preparing || pageWindow + 12 >= sourcePdf.numPages;
    canvas.style.pointerEvents = pageReady && !preparing ? '' : 'none'; layer.hidden = !pageReady || preparing; widgetLayer.hidden = !pageReady;
    $('applyBtn').disabled = transitioning || !pageReady || (!objects.length && !Object.keys(scene().fields).length && !(scene().flatten && fields.length));
    status.textContent = preparing ? t('workspace.preparing_draft', 'Preparing the latest draft… Editing remains available; apply or place it when ready.') : !pageReady ? t('workspace.loading_page', 'Loading page…') : pendingImages ? t('workspace.adding_images', 'Adding images… {n} pending.', { n: pendingImages }) : t('workspace.scene_identity', '{n} editable objects · Revision {revision}. {state}', { n: objects.length, revision: state.revision, state: lastKey === JSON.stringify(scene()) ? t('workspace.scene_applied', 'Applied scene; current result is ready to review.') : t('workspace.scene_pending', 'Pending scene changes; apply to update the current document.') });
    const selectedKind = objects.find((o) => o.id === selected)?.kind;
    if (mode === 'add-image') shell.draftLabel.textContent = selectedKind === 'image' ? t('workspace.selected_image_properties', 'Selected image properties · upload adds another') : t('workspace.new_image_properties', 'New image · choose scope before upload');
    pageNumber.value = String(pageIndex + 1);
  }
  function selectObject(id) {
    if (busy || preparations.size) return;
    ++textSequence; selected = id; const o = scene().objects.find((o) => o.id === id); if (!o) return;
    if (o.pageIndex !== pageIndex) void selectPage(o.pageIndex);
    if (o.kind === 'text' && $('textInput')) { textDraft = { text: o.text, fontSize: o.fontSize, weight: o.weight, color: [...o.color], width: o.width, height: o.height }; $('textInput').value = o.text; if ($('sizeSlider') && mode === 'add-text') $('sizeSlider').value = String(o.fontSize); if ($('fontSelect')) $('fontSelect').value = { bold: 'helvetica-bold', italic: 'times-roman', code: 'courier' }[o.weight] || 'helvetica'; }
    if (o.kind === 'signature') { if (signatureId !== id) resetSignatureDraft(o); signatureId = id; }
    shell.showObjectProperties(); controls(); overlay();
  }
  async function textProperties(text) {
    const previous = scene().objects.find((o) => o.id === selected && o.kind === 'text');
    const size = mode === 'add-text' ? Number($('sizeSlider').value) : previous?.fontSize || 14, weight = $('fontSelect') ? ({ 'helvetica-bold': 'bold', 'times-roman': 'italic', courier: 'code' }[$('fontSelect').value] || 'regular') : previous?.weight || 'regular';
    const color = [...(COLORS[$('colorSelect')?.value] || previous?.color || COLORS.black)];
    const family = await ensureUnicodePreviewFont(weight, { text });
    const measure = document.createElement('canvas').getContext('2d'); measure.font = `${weight === 'italic' ? 'italic' : 'normal'} ${weight === 'bold' ? '700' : '400'} ${size}px "${family}"`;
    return { text, fontSize: size, weight, color, width: Math.max(4, ...text.split('\n').map((line) => measure.measureText(line).width)), height: size * 1.2 * text.split('\n').length };
  }
  function restoreText(props) {
    textDraft = props;
    $('textInput').value = props?.text || '';
    if ($('fontSelect')) $('fontSelect').value = { bold: 'helvetica-bold', italic: 'times-roman', code: 'courier' }[props?.weight] || 'helvetica';
    if ($('sizeSlider') && mode === 'add-text') $('sizeSlider').value = String(props?.fontSize || 14);
    if ($('colorSelect') && props) $('colorSelect').value = Object.keys(COLORS).find((key) => COLORS[key].every((value, i) => value === props.color[i])) || 'black';
  }
  async function updateText() {
    if (busy || disposed || !isCurrent()) return;
    const object = scene().objects.find((o) => o.id === selected && o.kind === 'text'), id = object?.id;
    const previous = object ? { text: object.text, fontSize: object.fontSize, weight: object.weight, color: [...object.color], width: object.width, height: object.height } : textDraft;
    const token = beginPreparation('text', id, () => restoreText(previous));
    try {
      const text = $('textInput').value;
      if (text.length > 10000) throw new RangeError(t('workspace.text_limit', 'Invalid object text. Use at most 10,000 characters per text object.'));
      const props = await textProperties(text); if (!ownsPreparation(token)) return;
      if (id && (!scene().objects.some((o) => o.id === id) || !change((s) => Object.assign(s.objects.find((o) => o.id === id), props)))) { restoreText(previous); return; }
      textDraft = props;
    } catch (error) { if (ownsPreparation(token)) { restoreText(previous); showError(`${error.message} ${t('workspace.previous_text_retained', 'Previous text was retained.')}`); } }
    finally { finishPreparation(token); if (!disposed && isCurrent() && $('sizeValue') && mode === 'add-text') $('sizeValue').textContent = $('sizeSlider').value + ' pt'; }
  }
  function imageIntent(point) {
    return { taskId: documentSession.snapshot().taskId, sourceRef: scene().sourceRef, pageIndex,
      targets: !point && $('pageSelect').value === 'all' ? Array.from({ length: sourcePdf.numPages }, (_, i) => i) : [pageIndex],
      size: Number($('sizeSlider').value) / 100, opacity: Number($('opacitySlider').value) / 100, position: $('positionSelect').value };
  }
  function ownsImageIntent(intent) { return !disposed && isCurrent() && intent.taskId === documentSession.snapshot().taskId && intent.sourceRef === scene()?.sourceRef; }
  function imageNativeWidth(object) {
    if (imageWidths.has(object.assetId)) return imageWidths.get(object.assetId);
    const resource = documentSession.resource(object.assetId); if (!resource) return object.width;
    // Normalized scene assets are PNG; the validated IHDR retains native size.
    const width = resource.bytes.length >= 24 ? new DataView(resource.bytes.buffer, resource.bytes.byteOffset).getUint32(16) * .75 : object.width;
    imageWidths.set(object.assetId, width); return width;
  }
  async function addImageAtPosition(point, asset = selectedAsset, intent = imageIntent(point)) {
    if (!asset || !ownsImageIntent(intent)) return false;
    const objects = [];
    for (const target of intent.targets) {
      const view = (await sourcePdf.getPage(target + 1)).getViewport({ scale: 1 });
      if (!ownsImageIntent(intent)) return false;
      const width = Math.min(view.width * .4, asset.width * .75) * intent.size, height = width * asset.height / asset.width;
      objects.push({ id: crypto.randomUUID(), kind: 'image', pageIndex: target, width, height, ...position(view, width, height, point, intent.position), assetId: asset.assetId, opacity: intent.opacity });
    }
    if (!ownsImageIntent(intent) || !change((s) => s.objects.push(...objects))) return false;
    selected = objects.find((o) => o.pageIndex === pageIndex)?.id || objects[0].id; controls(); overlay(); return true;
  }
  function position(view, width, height, point, value = $('positionSelect').value) {
    if (point) return { x: point.x - width / 2, y: point.y - height / 2 };
    return { x: value.includes('left') ? 28 : value.includes('right') ? view.width - width - 28 : (view.width - width) / 2, y: value.includes('top') ? 28 : value.includes('bottom') ? view.height - height - 28 : (view.height - height) / 2 };
  }
  async function positionSelectedImage() { const o = scene().objects.find((o) => o.id === selected); if (o?.kind === 'image') change((s) => Object.assign(s.objects.find((o) => o.id === selected), position(visual, o.width, o.height))); }
  async function selectPage(index) {
    if (busy || preparations.size || disposed || !isCurrent()) return;
    index = Math.max(0, Math.min(sourcePdf.numPages - 1, Number.isFinite(index) ? Math.floor(index) : pageIndex));
    if (index === pageIndex && pageReady && visualPage === index) return;
    const sequence = ++pageSequence; ++textSequence; pageReady = false; controller?.abort(); ++renderSequence; canvas.setAttribute('aria-busy','true'); fieldEditor.hidden = true; controls();
    pageIndex = Math.max(0, Math.min(sourcePdf.numPages - 1, index)); documentSession.setSelection([pageIndex]);
    const requestedPage = pageIndex; const loadedPage = await sourcePdf.getPage(requestedPage + 1); if (disposed || !isCurrent() || sequence !== pageSequence || requestedPage !== pageIndex) return;
    visual = loadedPage.getViewport({ scale: 1 }); visualPage = requestedPage;
    placement.hidden = false; pageNumber.value = String(pageIndex + 1);
    if (mode === 'add-image' && $('pageSelect').value !== 'all') $('pageSelect').value = String(pageIndex + 1);
    grid.querySelectorAll('.page-tile').forEach((e) => e.classList.toggle('selected', Number(e.dataset.pageIndex) === pageIndex));
    await preview(); controls();
  }
  async function thumbnails() {
    const sequence = ++thumbnailSequence, start = pageWindow, end = Math.min(sourcePdf.numPages, start + 12);
    thumbnailController?.abort(); thumbnailController = new AbortController(); const signal = thumbnailController.signal;
    for (const old of grid.querySelectorAll('canvas')) { old.width = old.height = 0; } grid.replaceChildren();
    try {
      for (let index = start; index < end; index++) {
        if (disposed || signal.aborted || sequence !== thumbnailSequence || !isCurrent()) return;
        const page = await sourcePdf.getPage(index + 1);
        if (disposed || signal.aborted || sequence !== thumbnailSequence || !isCurrent()) return;
        const thumbnail = document.createElement('canvas');
        await renderBoundedPage(page, thumbnail, { maxDimension: 150, maxPixels: 22500, signal });
        if (disposed || signal.aborted || sequence !== thumbnailSequence || !isCurrent()) { thumbnail.width = thumbnail.height = 0; return; }
        const tile = action(`Page ${index + 1}`, null, () => { void selectPage(index); }); tile.classList.add('page-tile'); tile.dataset.pageIndex = String(index); tile.prepend(thumbnail); grid.append(tile);
      }
      $('previousThumbnailSet').disabled = start === 0; $('nextThumbnailSet').disabled = end >= sourcePdf.numPages;
    } catch (error) { if (!signal.aborted && !disposed && isCurrent()) throw error; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { void preview().catch((error) => { if (error.name !== 'AbortError') showError(error.message); }); }, 100); }
  async function build(signal, state = scene()) { return renderScenePdf({ scene: state, resource: documentSession.resource, pdfLib: lib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, signal, onFieldError(name, error) { for (const row of fieldRows.get(name) || []) { let e = row.querySelector('.field-error'); if (!e) { e = document.createElement('span'); e.className = 'field-error'; e.setAttribute('role', 'alert'); row.append(e); } e.textContent = error.message; } } }); }
  async function preview() {
    if (disposed || !isCurrent() || visualPage !== pageIndex) return;
    canvas.setAttribute('aria-busy','true');
    const sequence = ++renderSequence, requestedPage = pageIndex, requestedScene = scene(), requestedRevision = documentSession.snapshot().revision; controller?.abort(); controller = new AbortController(); const signal = controller.signal;
    rendering = rendering.catch(() => {}).then(async () => {
      if (disposed || sequence !== renderSequence) return;
      if (requestedRevision !== documentSession.snapshot().revision) return;
      const output = await build(signal, requestedScene); signal.throwIfAborted();
      await renderedTask?.destroy(); renderedTask = pdfjs.getDocument({ data: output.bytes.slice(), ...PDFJS_ASSET_URLS }); const pdf = await renderedTask.promise;
      const page = await pdf.getPage(requestedPage + 1); const targetScale=Math.min(3.2,560 * zoom/page.getViewport({scale:1}).width);
      viewport = await renderBoundedPage(page, canvas, { scale: targetScale, signal });
      if (sequence !== renderSequence || requestedRevision !== documentSession.snapshot().revision || signal.aborted) return;
      if (requestedPage !== pageIndex) return;
      pageReady = true; canvas.setAttribute('aria-busy','false'); canvas.dataset.sceneRevision = String(requestedRevision);
      canvas.dataset.pdfPage = String(requestedPage + 1); canvas.dataset.pdfScale = String(viewport.scale); lastRendered = output; setZoom(); overlay(); widgets(); controls();
    });
    return rendering.catch((error) => { if (!signal.aborted && !disposed && error.name !== 'AbortError' && error.name !== 'RenderingCancelledException') throw error; });
  }
  function setZoom() {
    const width = Math.min(560, visual?.width * 1.6 || 560) * zoom;
    wrap.style.width = zoom > 1 ? `${width}px` : `min(100%, ${width}px)`; wrap.style.maxWidth = 'none';
    canvas.style.width = '100%'; canvas.style.maxWidth = '100%';
  }
  async function apply() {
    if (busy || pendingImages || preparations.size) return; clearTimeout(timer); hideError(); clearResult(); busy = true; controls(); const operation = documentOperations.begin();
    try {
      controller?.abort(); await rendering.catch(() => {});
      const output = await build(operation.signal); if (!operation.isCurrent()) return;
      const name = parsed.baseName + (mode === 'add-text' ? '-text.pdf' : mode === 'add-image' ? '-with-image.pdf' : '-signed.pdf');
      // Render the actual candidate before publishing the complete transaction.
      const task = pdfjs.getDocument({ data: output.bytes.slice(), ...PDFJS_ASSET_URLS });
      try { const doc = await task.promise; const verify = document.createElement('canvas'); await renderBoundedPage(await doc.getPage(pageIndex + 1), verify, { scale: .3, signal: operation.signal }); } finally { await task.destroy(); }
      if (!operation.isCurrent()) return;
      documentSession.publishScene(output.bytes, name, { capabilities: { ...documentSession.snapshot().current.capabilities, searchable: scene().objects.some((o) => o.kind === 'text') ? true : documentSession.snapshot().current.capabilities.searchable, forms: output.forms } });
      lastRendered = output; lastKey = JSON.stringify(scene()); showDocumentIdentity();
      await reviewResult(output.bytes, name, { operation, allowAdopt: false }); if (!operation.isCurrent()) return;
      await offerChain(output.bytes, name, [], { operation }); selected = null; signatureId = null;
    } catch (error) { if (operation.isCurrent()) showError(error.message); }
    finally { if (!disposed) { busy = false; controls(); void preview().catch(() => {}); } }
  }
  async function historyAction(kind) {
    if (busy || pendingImages || preparations.size) return;
    clearTimeout(timer); controller?.abort(); ++renderSequence;
    const operation = documentOperations.begin(); busy = true; controls(); let navigating = false;
    try {
      await rendering.catch(() => {});
      if (!operation.isCurrent()) return;
      const target = documentSession.historyTarget(kind); if (!target) return;
      // Render a read-only target first: a failed Undo keeps the complete
      // canonical source, draft, history and redo stacks unchanged.
      const output = target.scene ? await build(operation.signal, target.scene) : { bytes: target.artifact.bytes };
      const verifyTask = pdfjs.getDocument({ data: output.bytes.slice(), ...PDFJS_ASSET_URLS });
      let verifiedCanvas, verifiedViewport;
      try {
        const doc = await verifyTask.promise, page = await doc.getPage(Math.min(pageIndex + 1, doc.numPages));
        const view = page.getViewport({ scale: 1 }); verifiedCanvas = document.createElement('canvas');
        verifiedViewport = await renderBoundedPage(page, verifiedCanvas, { scale: Math.min(1.6, 560 / view.width), signal: operation.signal });
      } finally { await verifyTask.destroy(); }
      const state = documentSession.snapshot();
      if (!operation.isCurrent() || state.revision !== target.revision || state.generation !== target.generation) return;
      const artifact = documentSession[kind](); if (!artifact) return;
      if (target.scene) documentSession.publishScene(output.bytes, artifact.name, artifact);
      selected = null; showDocumentIdentity();
      if (!target.scene || target.scene.sourceRef !== source.id) {
        const handoff = await stashForChain(output.bytes, artifact.name, mode, artifact);
        if (operation.isCurrent()) { navigating = true; location.href = `${location.pathname}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`; }
        return;
      }
      if (mode === 'fill-sign') { buildFields(); $('flattenInput').checked = scene().flatten; }
      canvas.width = verifiedCanvas.width; canvas.height = verifiedCanvas.height; canvas.getContext('2d').drawImage(verifiedCanvas, 0, 0);
      pageReady = true; canvas.setAttribute('aria-busy','false'); canvas.dataset.sceneRevision=String(documentSession.snapshot().revision);
      viewport = verifiedViewport; canvas.dataset.pdfPage = String(pageIndex + 1); canvas.dataset.pdfScale = String(viewport.scale);
      lastRendered = output; lastKey = JSON.stringify(scene()); overlay(); widgets();
      await reviewResult(output.bytes, artifact.name, { operation, allowAdopt: false }); if (!operation.isCurrent()) return;
      await offerChain(output.bytes, artifact.name, [], { operation });
    } catch (error) { if (operation.isCurrent()) showError(error.message); }
    finally { if (!disposed && !navigating) { busy = false; controls(); } }
  }
  function overlay() {
    const focused = document.activeElement?.classList.contains('scene-object') ? document.activeElement.dataset.objectId : null;
    layer.replaceChildren(); if (!visual || !canvas.clientWidth) return;
    const sx = canvas.getBoundingClientRect().width / visual.width, sy = canvas.getBoundingClientRect().height / visual.height;
    for (const object of scene().objects.filter((o) => o.pageIndex === pageIndex)) {
      const box = document.createElement('div'); box.className = 'scene-object' + (object.id === selected ? ' is-selected' : ''); box.dataset.objectId = object.id; box.tabIndex = 0; box.setAttribute('role', 'button'); box.setAttribute('aria-label', `${object.kind} object on page ${pageIndex + 1}`);
      Object.assign(box.style, { left: object.x * sx + 'px', top: object.y * sy + 'px', width: object.width * sx + 'px', height: object.height * sy + 'px' });
      box.addEventListener('click', (e) => { e.stopPropagation(); selectObject(object.id); });
      box.addEventListener('focus', () => { selected = object.id; controls(); });
      const handle = document.createElement('span'); handle.className = 'scene-resize'; handle.setAttribute('aria-hidden', 'true'); box.append(handle);
      box.addEventListener('pointerdown', (event) => {
        if (busy) return; event.preventDefault(); event.stopPropagation(); selected = object.id; controls();
        box.setPointerCapture(event.pointerId); const start = { x: event.clientX, y: event.clientY }, initial = { ...object }, resize = event.target === handle; let moved = false;
        const move = (e) => { moved = true; const dx = (e.clientX - start.x) / sx, dy = (e.clientY - start.y) / sy;
          if (resize) { const factor = Math.max(.05, 1 + (Math.abs(dx) > Math.abs(dy) ? dx / initial.width : dy / initial.height)); box.style.width = initial.width * factor * sx + 'px'; box.style.height = initial.height * factor * sy + 'px'; }
          else { box.style.left = (initial.x + dx) * sx + 'px'; box.style.top = (initial.y + dy) * sy + 'px'; }
        };
        const end = (e) => { box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', end); box.removeEventListener('pointercancel', cancel); try { box.releasePointerCapture(e.pointerId); } catch {}
          if (moved) { const dx = (e.clientX - start.x) / sx, dy = (e.clientY - start.y) / sy; change((s) => { const target = s.objects.find((o) => o.id === object.id); if (resize) { const factor = Math.max(.05, 1 + (Math.abs(dx) > Math.abs(dy) ? dx / initial.width : dy / initial.height)); target.width = initial.width * factor; target.height = initial.height * factor; if (target.kind === 'text') target.fontSize = initial.fontSize * factor; } else { target.x = initial.x + dx; target.y = initial.y + dy; } }); } else selectObject(object.id);
        };
        const cancel = () => { box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', end); overlay(); };
        box.addEventListener('pointermove', move); box.addEventListener('pointerup', end); box.addEventListener('pointercancel', cancel);
      }); layer.append(box); if (focused === object.id) box.focus({ preventScroll: true });
    }
  }
  function keyboard(event) {
    if (busy || preparations.size || !selected || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
    const step = event.shiftKey ? 10 : 1;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace', '+', '=', '-'].includes(event.key)) return;
    event.preventDefault();
    change((s) => { const o = s.objects.find((o) => o.id === selected); if (!o) return;
      if (['Delete', 'Backspace'].includes(event.key)) s.objects = s.objects.filter((o) => o.id !== selected);
      if (event.key === 'ArrowLeft') o.x -= step; if (event.key === 'ArrowRight') o.x += step; if (event.key === 'ArrowUp') o.y -= step; if (event.key === 'ArrowDown') o.y += step;
      if (['+', '=', '-'].includes(event.key)) { const factor = event.key === '-' ? .95 : 1.05; o.width *= factor; o.height *= factor; if (o.kind === 'text') o.fontSize *= factor; }
    });
    // Rendering replaces hit targets; the document-level selected object keeps
    // subsequent keyboard actions working without stealing native input keys.
  }
  function buildFields() {
    $('fieldsList').replaceChildren(); fieldRows.clear();
    for (const field of fields) {
      const row = document.createElement('div'); row.className = 'field-row'; row.dataset.fieldName = field.name;
      row.append(document.createTextNode(field.name));
      const input = fieldControl(field); input.id = `form-field-${fieldRows.size + 1}`; input.setAttribute('aria-label', field.name); row.append(input);
      for (const widget of field.widgets) {
        if (widget.pageIndex < 0) { const e = document.createElement('span'); e.className = 'field-error'; e.textContent = 'This widget has no resolvable page.'; row.append(e); continue; }
        row.append(action(`Go to page ${widget.pageIndex + 1}`, null, () => { void selectPage(widget.pageIndex); }));
      }
      fieldRows.set(field.name, [row]); $('fieldsList').append(row);
    }
  }
  function fieldControl(field) {
    const stored = scene().fields[field.name]; const value = stored ? stored.value : field.value;
    let input;
    if (['dropdown', 'optionlist', 'radio'].includes(field.kind)) {
      input = document.createElement('select'); input.multiple = field.kind === 'optionlist';
      if (field.kind === 'radio') { const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Choose'; input.append(blank); }
      for (const option of field.options) { const el = document.createElement('option'); el.value = option; el.textContent = option; el.selected = Array.isArray(value) ? value.includes(option) : value === option; input.append(el); }
    } else {
      input = document.createElement('input'); input.type = field.kind === 'checkbox' ? 'checkbox' : 'text';
      if (field.kind === 'checkbox') input.checked = !!value; else input.value = String(value);
    }
    input.disabled = field.readOnly || field.kind === 'unsupported'; input.dataset.field = field.name; input.setAttribute('aria-label', field.name);
    input.addEventListener(input.tagName === 'SELECT' || field.kind === 'checkbox' ? 'change' : 'input', () => {
      let value = field.kind === 'checkbox' ? input.checked : field.kind === 'optionlist' ? [...input.selectedOptions].map((o) => o.value) : input.value;
      if (!change((s) => { s.fields[field.name] = { kind: field.kind, value }; })) { value = scene().fields[field.name]?.value ?? field.value; if (field.kind === 'checkbox') input.checked = value; else if (Array.isArray(value)) for (const option of input.options) option.selected = value.includes(option.value); else input.value = value; }
      for (const other of document.querySelectorAll('[data-field]')) {
        if (other === input || other.dataset.field !== field.name) continue;
        if (field.kind === 'checkbox') other.checked = value;
        else if (Array.isArray(value)) for (const option of other.options) option.selected = value.includes(option.value);
        else other.value = value;
      }
    });
    return input;
  }
  function widgets() {
    if (mode !== 'fill-sign' || !visual || !canvas.clientWidth) return;
    const retained = new Set();
    for (const field of fields) for (const [index, widget] of field.widgets.entries()) {
      if (widget.pageIndex !== pageIndex) continue;
      const key = `${field.name}:${index}`; retained.add(key);
      const points = [[widget.x, widget.y], [widget.x + widget.width, widget.y], [widget.x, widget.y + widget.height], [widget.x + widget.width, widget.y + widget.height]].map(([x, y]) => pdfPointToViewport(visual, x, y));
      const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
      let row = [...widgetLayer.children].find((element) => element.dataset.widget === key);
      if (!row) {
        row = document.createElement('label'); row.className = 'scene-widget'; row.dataset.widget = key; row.setAttribute('aria-label', `${field.name}, page ${pageIndex + 1}`);
        if (visual.rotation % 180) {
          const button = action(`Edit ${field.name}`, null, () => {
            fieldEditor.replaceChildren(); fieldEditor.hidden = false;
            const input = fieldControl(field); fieldEditor.append(labelInput(`${field.name} · Page ${pageIndex + 1}`, input), action('Close field editor', null, () => { fieldEditor.hidden = true; button.focus(); })); input.focus();
          }); button.classList.add('scene-widget-hotspot'); row.append(button);
        } else row.append(fieldControl(field));
        widgetLayer.append(row);
      }
      const rect = canvas.getBoundingClientRect(), sx = rect.width / visual.width, sy = rect.height / visual.height;
      Object.assign(row.style, { left: Math.min(...xs) * sx + 'px', top: Math.min(...ys) * sy + 'px', width: (Math.max(...xs) - Math.min(...xs)) * sx + 'px', height: (Math.max(...ys) - Math.min(...ys)) * sy + 'px' });
      fieldRows.set(field.name, [...new Set([...(fieldRows.get(field.name) || []).filter((r) => r.isConnected), row])]);
    }
    for (const row of [...widgetLayer.children]) if (!retained.has(row.dataset.widget)) row.remove();
  }
  function setupSignature() {
    $('typeSigInput').maxLength = 300;
    const canvas = $('sigCanvas'), ctx = canvas.getContext('2d'); canvas.style.touchAction = 'none';
    const fontStyle = document.createElement('select'); fontStyle.id = 'signatureFontStyle';
    for (const [value, label] of [['regular', t('workspace.regular_font', 'Regular')], ['italic', t('workspace.italic_font', 'Italic')]]) { const option = document.createElement('option'); option.value = value; option.textContent = label; fontStyle.append(option); }
    $('typeSigRow').append(labelInput(t('workspace.signature_font', 'Signature font'), fontStyle)); fontStyle.addEventListener('change', () => { void typed(); });
    const upload = document.createElement('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg'; upload.id = 'signatureInput'; upload.hidden = true;
    const uploadButton = action(t('workspace.upload_signature', 'Upload signature'), 'sigModeUpload', () => { setMode('upload'); upload.click(); }); uploadButton.setAttribute('role', 'tab'); uploadButton.setAttribute('aria-selected', 'false'); $('sigModeType').after(uploadButton, upload);
    const previewImage = document.createElement('img'); previewImage.id = 'signaturePreview'; previewImage.className = 'signature-asset-preview'; previewImage.alt = t('workspace.signature_bitmap', 'Signature image used in the PDF'); previewImage.hidden = true; canvas.after(previewImage);
    const note = document.createElement('p'); note.textContent = t('workspace.signature_scope', 'Electronic image signatures. This tool does not create or verify digital certificates.'); previewImage.after(note);
    let previewUrl = null, shownAssetId = null, drawToken = null;
    let validated = { asset: null, text: '', style: 'regular', pixels: null };
    const signatureLabels = new Map();
    assetCleanups.push(() => { if (previewUrl) URL.revokeObjectURL(previewUrl); });
    function showAsset(asset) {
      if (asset && asset.assetId === shownAssetId && previewUrl) { previewImage.hidden = false; return; }
      if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
      shownAssetId = asset?.assetId || null;
      previewImage.hidden = !asset;
      if (asset) { previewUrl = URL.createObjectURL(new Blob([asset.bytes], { type: asset.type })); previewImage.src = previewUrl; }
    }
    function restoreSignature() {
      draftSignature = validated.asset; $('typeSigInput').value = validated.text; fontStyle.value = validated.style;
      ctx.clearRect(0, 0, canvas.width, canvas.height); if (validated.pixels) ctx.putImageData(validated.pixels, 0, 0);
      showAsset(validated.asset); $('sigStatus').textContent = validated.asset ? t('workspace.signature_retained', 'Previous validated signature retained.') : '';
    }
    resetSignatureDraft = (object) => {
      cancelPreparation('signature', false); drawing = false;
      const asset = documentSession.resource(object.assetId), view = new DataView(asset.bytes.buffer, asset.bytes.byteOffset), label = signatureLabels.get(object.assetId);
      const pixels = validated.asset?.assetId === object.assetId ? validated.pixels : null;
      validated = { asset: { ...asset, assetId: object.assetId, width: view.getUint32(16), height: view.getUint32(20) }, text: label?.text || '', style: label?.style || 'regular', pixels };
      restoreSignature(); $('sigStatus').textContent = t('workspace.selected_signature', 'Selected signature image. Type, draw, or upload to replace it.');
    };
    const setMode = (mode) => {
      if (busy) return;
      cancelPreparation('signature'); cancelPreparation('text');
      sigMode = mode; fillTextActive = false; drawing = false; $('typeSigRow').hidden = mode !== 'type';
      try { canvas.releasePointerCapture(pointerId); } catch {}
      $('sigModeDraw').setAttribute('aria-selected', String(mode === 'draw')); $('sigModeType').setAttribute('aria-selected', String(mode === 'type')); uploadButton.setAttribute('aria-selected', String(mode === 'upload'));
      for (const button of [$('sigModeDraw'), $('sigModeType'), uploadButton]) button.classList.toggle('active', button.getAttribute('aria-selected') === 'true');
      if (mode === 'draw') { ctx.clearRect(0, 0, canvas.width, canvas.height); draftSignature = null; previewImage.hidden = true; }
      if (mode === 'type' && $('typeSigInput').value.trim()) void typed();
      controls();
    };
    $('sigModeDraw').addEventListener('click', () => setMode('draw')); $('sigModeType').addEventListener('click', () => setMode('type'));
    function startSignature() {
      const token = beginPreparation('signature', signatureId, restoreSignature);
      $('sigStatus').textContent = t('workspace.preparing_signature', 'Preparing the latest signature…'); return token;
    }
    async function accept(asset, token, typedText = '', typedStyle = 'regular') {
      if (!ownsPreparation(token)) return;
      asset.assetId = await documentSession.addAsset(asset.bytes, asset.type, asset.name);
      if (!ownsPreparation(token)) return;
      if (token.targetId) {
        if (signatureId !== token.targetId || !scene().objects.some((o) => o.id === token.targetId)) return;
        if (!change((s) => { const o = s.objects.find((o) => o.id === token.targetId); o.assetId = asset.assetId; o.height = o.width * asset.height / asset.width; })) throw new Error(t('workspace.signature_rejected', 'The signature change could not be accepted.'));
      }
      // Publish the same validated bitmap to both the scene and the draft UI.
      draftSignature = asset; validated = { asset, text: typedText, style: typedStyle, pixels: token.pixels || null };
      signatureLabels.set(asset.assetId, { text: typedText, style: typedStyle }); if (signatureLabels.size > 128) signatureLabels.delete(signatureLabels.keys().next().value);
      showAsset(asset); $('sigStatus').textContent = t('workspace.signature_ready', 'Signature ready. Place it on the current page.');
    }
    async function capture(token, typedText = '', typedStyle = 'regular') {
      token.pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error(t('workspace.signature_capture_failed', 'Signature capture failed.'))), 'image/png'));
      if (!ownsPreparation(token)) return;
      const asset = await imageAsset(new File([blob], 'signature.png', { type: 'image/png' }), { trim: true });
      if (ownsPreparation(token)) await accept(asset, token, typedText, typedStyle);
    }
    function rejectSignature(token, error) {
      if (ownsPreparation(token)) { restoreSignature(); showError(`${error.message} ${t('workspace.previous_signature_retained', 'Previous signature was retained.')}`); }
    }
    async function typed() {
      if (busy || disposed || !isCurrent()) return;
      const text = $('typeSigInput').value.trim(); fillTextActive = false;
      if (!text) { clearDraft(); return; }
      const token = startSignature(), weight = fontStyle.value, style = weight === 'italic' ? 'italic' : 'normal';
      try {
        const family = await ensureUnicodePreviewFont(weight, { text }); await document.fonts.ready;
        if (!ownsPreparation(token)) return;
        let size = 72; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `${style} ${size}px "${family}"`; const measured = ctx.measureText(text);
        size = Math.min(size, size * (canvas.width - 20) / Math.max(1, measured.width), (canvas.height - 20) / 1.5);
        if (size < 2) throw new Error(t('workspace.signature_shorter', 'Use a shorter signature name; the full text cannot fit legibly.'));
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.font = `${style} ${size}px "${family}"`; ctx.fillStyle = '#111'; ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        await capture(token, text, weight);
      } catch (error) { rejectSignature(token, error); }
      finally { finishPreparation(token); }
    }
    $('typeSigInput').addEventListener('input', typed);
    upload.addEventListener('change', async () => {
      const file = upload.files[0]; upload.value = ''; if (!file || busy || disposed || !isCurrent()) return;
      const token = startSignature();
      try { const asset = await imageAsset(file, { trim: true }); if (ownsPreparation(token)) await accept(asset, token); }
      catch (error) { rejectSignature(token, error); } finally { finishPreparation(token); }
    });
    function clearDraft() {
      cancelPreparation('signature', false); drawing = false; draftSignature = null;
      try { canvas.releasePointerCapture(pointerId); } catch {}
      validated = { asset: null, text: '', style: fontStyle.value, pixels: null }; invalidateDraftReview();
      ctx.clearRect(0, 0, canvas.width, canvas.height); previewImage.hidden = true; $('sigStatus').textContent = '';
      if (signatureId) { const id = signatureId; signatureId = null; if (selected === id) selected = null; change((s) => { s.objects = s.objects.filter((o) => o.id !== id); }); }
      controls();
    }
    $('clearSigBtn').addEventListener('click', () => { $('typeSigInput').value = ''; clearDraft(); });
    const point = (e) => { const rect = canvas.getBoundingClientRect(); return { x: (e.clientX - rect.left) * canvas.width / rect.width, y: (e.clientY - rect.top) * canvas.height / rect.height }; };
    canvas.addEventListener('pointerdown', (e) => {
      if (sigMode !== 'draw' || busy || drawing) return; e.preventDefault(); drawing = true; pointerId = e.pointerId; canvas.setPointerCapture(pointerId); fillTextActive = false;
      drawToken = startSignature(); ctx.strokeStyle = '#111'; ctx.lineWidth = 2.2; ctx.lineCap = ctx.lineJoin = 'round'; const p = point(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + .1, p.y + .1); ctx.stroke();
    });
    canvas.addEventListener('pointermove', (e) => { if (!drawing || e.pointerId !== pointerId) return; e.preventDefault(); const p = point(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    canvas.addEventListener('pointerup', async (e) => {
      if (!drawing || e.pointerId !== pointerId) return; drawing = false; try { canvas.releasePointerCapture(e.pointerId); } catch {}
      const token = drawToken;
      try { await capture(token); } catch (error) { rejectSignature(token, error); } finally { finishPreparation(token); }
    });
    canvas.addEventListener('pointercancel', (e) => { if (!drawing || e.pointerId !== pointerId || !ownsPreparation(drawToken)) return; drawing = false; cancelPreparation('signature'); try { canvas.releasePointerCapture(e.pointerId); } catch {} });
  }
}
