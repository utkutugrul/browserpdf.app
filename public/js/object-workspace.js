import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { documentSession, documentOperations, clearResult, reviewResult, offerChain, stashForChain, showDocumentIdentity, showError, hideError, getWorkspaceInput } from './tool-ui.js';
import { getLang, t } from './i18n.js';
import { renderBoundedPage } from './core/bounded-renderer.js';
import { renderScenePdf, formModel, imageAsset } from './core/object-scene.js';
import { ensureUnicodePreviewFont } from './core/pdf-fonts.js';
import { pdfPointToViewport } from './core/page-geometry.js';

const $ = (id) => document.getElementById(id);
const COLORS = { black: [0, 0, 0], red: [.78, .16, .1], blue: [.12, .29, .65], gray: [.55, .55, .55] };
const action = (label, id, callback) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-small'; b.textContent = label; if (id) b.id = id; b.addEventListener('click', callback); return b; };
const labelInput = (label, input) => { const wrap = document.createElement('label'); wrap.textContent = label; wrap.append(input); return wrap; };

export async function openObjectWorkspace(mode, parsed, { isCurrent = () => true, signal: openingSignal } = {}) {
  const assertOwner = () => { openingSignal?.throwIfAborted(); if (!isCurrent()) throw new DOMException('Workspace opening was replaced.', 'AbortError'); };
  let textSequence = 0, pageSequence = 0, pageReady = false, visualPage = -1, thumbnailSequence = 0, thumbnailController;
  let disposed = false, selected = null, pageIndex = documentSession.snapshot().selection[0] || 0, pageWindow = 0;
  let pdfjs = await ensurePdfJs(), lib = await ensurePdfLib(), sourceTask, sourcePdf, renderedTask;
  let viewport, visual, selectedAsset = null, draftSignature = null, signatureId = null, sigMode = 'draw';
  const assetCleanups = []; let resetSignatureDraft = () => {};
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
      if (busy) return;
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
  const properties = document.createElement('div'); properties.className = 'scene-properties';
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
    $('imageInput').addEventListener('change', async () => {
      const file = $('imageInput').files[0]; if (!file) return;
      try { selectedAsset = await imageAsset(file); selectedAsset.assetId = await documentSession.addAsset(selectedAsset.bytes, selectedAsset.type, selectedAsset.name);
        $('imageName').textContent = file.name; const url = URL.createObjectURL(new Blob([selectedAsset.bytes], { type: selectedAsset.type })); $('imageThumb').src = url; $('imageThumb').hidden = false; $('imageThumb').onload = () => URL.revokeObjectURL(url);
        selected = null; await addImageAtPosition();
      } catch (error) { showError(error.message); }
    });
    $('positionSelect').addEventListener('change', () => { if (selectedAsset) void positionSelectedImage(); });
    for (const id of ['sizeSlider', 'opacitySlider']) $(id).addEventListener('input', () => { const o = scene().objects.find((o) => o.id === selected); if (o?.kind === 'image') change((s) => { const item = s.objects.find((o) => o.id === selected); if (id === 'opacitySlider') item.opacity = Number($(id).value) / 100; else { const width = selectedAsset ? Math.min(visual.width * .4, selectedAsset.width * .75) * Number($(id).value) / 100 : item.width; item.height *= width / item.width; item.width = width; } }); $((id === 'sizeSlider' ? 'sizeValue' : 'opacityValue')).textContent = $(id).value + '%'; });
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
    textRow.append(action('Place text', 'fillTextMode', () => { fillTextActive = true; selected = null; status.textContent = 'Click on the page to add text.'; })); root.before(textRow);
    text.addEventListener('input', () => { fillTextActive = true; void updateText(); });
    setupSignature(); buildFields(); $('flattenInput').checked = scene().flatten;
    $('flattenInput').addEventListener('change', () => change((s) => { s.flatten = $('flattenInput').checked; }));
  }
  canvas.addEventListener('click', async (event) => {
    if (busy || !visual || disposed || !isCurrent()) return;
    const placementSequence = ++textSequence, placementPage = pageIndex;
    const rect = canvas.getBoundingClientRect(); const x = (event.clientX - rect.left) * visual.width / rect.width, y = (event.clientY - rect.top) * visual.height / rect.height;
    try {
      if (mode === 'add-text' || fillTextActive) {
        const text = $('textInput').value; if (!text.trim()) return;
        const props = await textProperties(text); if (disposed || !isCurrent() || placementSequence !== textSequence || placementPage !== pageIndex) return; const id = crypto.randomUUID();
        change((s) => s.objects.push({ id, kind: 'text', pageIndex, x, y: y - props.fontSize, ...props })); selected = id;
      } else if (mode === 'fill-sign') {
        if (!draftSignature) { showError('Draw, type, or upload a signature first.'); return; }
        const width = Math.min(140, visual.width * .7), height = width * draftSignature.height / draftSignature.width;
        draftSignature.assetId = await documentSession.addAsset(draftSignature.bytes, draftSignature.type, draftSignature.name);
        const id = crypto.randomUUID(); change((s) => s.objects.push({ id, kind: 'signature', pageIndex, x: x - width / 2, y: y - height / 2, width, height, assetId: draftSignature.assetId, opacity: 1 })); selected = signatureId = id;
      } else if (selectedAsset) { await addImageAtPosition({ x, y }); }
      controls(); overlay();
    } catch (error) { showError(error.message); }
  });
  $('applyBtn').addEventListener('click', apply);
  const resizeObserver = new ResizeObserver(() => { overlay(); widgets(); }); resizeObserver.observe(canvas);
  document.addEventListener('keydown', keyboard);
  const lifecycle = { dispose() { disposed = true; ++textSequence; ++thumbnailSequence; clearTimeout(timer); controller?.abort(); thumbnailController?.abort(); resizeObserver.disconnect(); document.removeEventListener('keydown', keyboard); for (const cleanup of assetCleanups) cleanup(); void sourceTask.destroy().catch(() => {}); void renderedTask?.destroy().catch(() => {}); for (const old of grid.querySelectorAll('canvas')) old.width = old.height = 0; toolbar.remove(); properties.remove(); layer.remove(); widgetLayer.remove(); history.remove(); status.remove(); pageNav.remove(); fieldEditor.remove(); } };
  try { await thumbnails(); assertOwner(); await selectPage(pageIndex); assertOwner(); controls(); return lifecycle; }
  catch (error) { lifecycle.dispose(); throw error; }


  function change(edit) {
    if (busy || disposed || !isCurrent()) return false;
    const next = scene(); edit(next);
    document.querySelectorAll('.field-error').forEach((node) => node.remove());
    try { documentSession.changeScene(next); } catch (error) { showError(error.message); controls(); return false; }
    controller?.abort(); lastKey = null; clearResult(); showDocumentIdentity(); controls(); overlay(); schedule(); return true;
  }
  function controls() {
    const taskControls = document.querySelectorAll('#fieldsSection input,#fieldsSection select,.scene-widgets input,.scene-widgets select,#pageFieldEditor input,#pageFieldEditor select,#textInput,#signatureSection input,#signatureSection button,#textOptionsSection input,#textOptionsSection textarea,#textOptionsSection select,#optionsSection input,#optionsSection select,#optionsSection button,#workspaceModes button,.editor-toolbar button,#fillTextMode');
    for (const input of taskControls) {
      if (busy) { if (!disabledBeforeExport.has(input)) disabledBeforeExport.set(input, input.disabled); input.disabled = true; }
      else if (disabledBeforeExport.has(input)) { input.disabled = disabledBeforeExport.get(input); disabledBeforeExport.delete(input); }
    }
    const state = documentSession.snapshot(); undo.disabled = busy || !state.canUndo; redo.disabled = busy || !state.canRedo;
    const objects = scene().objects; list.replaceChildren();
    for (const [index, object] of objects.entries()) { const option = document.createElement('option'); option.value = object.id; option.textContent = `${object.kind === 'text' ? object.text.slice(0, 35) : object.kind} · Page ${object.pageIndex + 1} · ${index + 1}`; list.append(option); }
    if (selected && !objects.some((o) => o.id === selected)) selected = null;
    list.value = selected || ''; const object = objects.find((o) => o.id === selected);
    for (const [key, input] of Object.entries(numbers)) { input.disabled = busy || !object; input.value = object ? String(Math.round(object[key] * 100) / 100) : ''; }
    remove.disabled = busy || !object; newObject.disabled = busy || !pageReady;
    canvas.style.pointerEvents = pageReady ? '' : 'none'; layer.hidden = widgetLayer.hidden = !pageReady;
    $('applyBtn').disabled = busy || !pageReady || (!objects.length && !Object.keys(scene().fields).length && !(scene().flatten && fields.length));
    status.textContent = `${objects.length} editable objects · Revision ${state.revision}. ${lastKey === JSON.stringify(scene()) ? 'Reviewed current scene.' : 'Pending scene changes; review before downloading.'}`;
    pageNumber.value = String(pageIndex + 1);
  }
  function selectObject(id) {
    ++textSequence; selected = id; const o = scene().objects.find((o) => o.id === id); if (!o) return;
    if (o.pageIndex !== pageIndex) void selectPage(o.pageIndex);
    if (o.kind === 'text' && $('textInput')) { $('textInput').value = o.text; if ($('sizeSlider') && mode === 'add-text') $('sizeSlider').value = String(o.fontSize); if ($('fontSelect')) $('fontSelect').value = { bold: 'helvetica-bold', italic: 'times-roman', code: 'courier' }[o.weight] || 'helvetica'; }
    if (o.kind === 'signature') { if (signatureId !== id) resetSignatureDraft(); signatureId = id; }
    controls(); overlay();
  }
  async function textProperties(text) {
    const previous = scene().objects.find((o) => o.id === selected && o.kind === 'text');
    const size = mode === 'add-text' ? Number($('sizeSlider').value) : previous?.fontSize || 14, weight = $('fontSelect') ? ({ 'helvetica-bold': 'bold', 'times-roman': 'italic', courier: 'code' }[$('fontSelect').value] || 'regular') : previous?.weight || 'regular';
    const color = [...(COLORS[$('colorSelect')?.value] || COLORS.black)];
    const family = await ensureUnicodePreviewFont(weight, { text });
    const measure = document.createElement('canvas').getContext('2d'); measure.font = `${weight === 'italic' ? 'italic' : 'normal'} ${weight === 'bold' ? '700' : '400'} ${size}px "${family}"`;
    return { text, fontSize: size, weight, color, width: Math.max(4, ...text.split('\n').map((line) => measure.measureText(line).width)), height: size * 1.2 * text.split('\n').length };
  }
  async function updateText() {
    const object = scene().objects.find((o) => o.id === selected), id = object?.id, sequence = ++textSequence, owner = documentSession.snapshot().taskId, sourceRef = scene().sourceRef;
    try { if (object?.kind === 'text') {
      const props = await textProperties($('textInput').value);
      if (disposed || !isCurrent() || sequence !== textSequence || selected !== id || owner !== documentSession.snapshot().taskId || sourceRef !== scene()?.sourceRef) return;
      if (!change((s) => Object.assign(s.objects.find((o) => o.id === id), props))) { const previous=scene().objects.find((o)=>o.id===id); if(previous) { $('textInput').value=previous.text; if($('fontSelect')) $('fontSelect').value={bold:'helvetica-bold',italic:'times-roman',code:'courier'}[previous.weight]||'helvetica'; if($('sizeSlider')&&mode==='add-text') $('sizeSlider').value=String(previous.fontSize); } }
    } } catch (error) { if (!disposed && isCurrent() && sequence === textSequence && selected === id && owner === documentSession.snapshot().taskId && sourceRef === scene()?.sourceRef) { const previous = scene().objects.find((o) => o.id === id); if (previous) { $('textInput').value = previous.text; if ($('fontSelect')) $('fontSelect').value = { bold:'helvetica-bold',italic:'times-roman',code:'courier' }[previous.weight] || 'helvetica'; if ($('sizeSlider') && mode === 'add-text') $('sizeSlider').value = String(previous.fontSize); } showError(`${error.message} Previous text was retained.`); } }
    if ($('sizeValue') && mode === 'add-text') $('sizeValue').textContent = $('sizeSlider').value + ' pt';
  }
  async function addImageAtPosition(point) {
    if (!visual) return;
    selectedAsset.assetId = await documentSession.addAsset(selectedAsset.bytes, selectedAsset.type, selectedAsset.name);
    const targets = !point && $('pageSelect').value === 'all' ? Array.from({ length: sourcePdf.numPages }, (_, i) => i) : [pageIndex];
    const objects = [];
    for (const target of targets) {
      const view = (await sourcePdf.getPage(target + 1)).getViewport({ scale: 1 });
      const width = Math.min(view.width * .4, selectedAsset.width * .75) * Number($('sizeSlider').value) / 100, height = width * selectedAsset.height / selectedAsset.width;
      objects.push({ id: crypto.randomUUID(), kind: 'image', pageIndex: target, width, height, ...position(view, width, height, point), assetId: selectedAsset.assetId, opacity: Number($('opacitySlider').value) / 100 });
    }
    change((s) => s.objects.push(...objects)); selected = objects.find((o) => o.pageIndex === pageIndex)?.id || objects[0].id; controls(); overlay();
  }
  function position(view, width, height, point) {
    if (point) return { x: point.x - width / 2, y: point.y - height / 2 };
    const value = $('positionSelect').value;
    return { x: value.includes('left') ? 28 : value.includes('right') ? view.width - width - 28 : (view.width - width) / 2, y: value.includes('top') ? 28 : value.includes('bottom') ? view.height - height - 28 : (view.height - height) / 2 };
  }
  async function positionSelectedImage() { const o = scene().objects.find((o) => o.id === selected); if (o?.kind === 'image') change((s) => Object.assign(s.objects.find((o) => o.id === selected), position(visual, o.width, o.height))); }
  async function selectPage(index) {
    if (disposed || !isCurrent()) return;
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
      const page = await pdf.getPage(requestedPage + 1); const targetScale=Math.min(1.6,560/page.getViewport({scale:1}).width);
      viewport = await renderBoundedPage(page, canvas, { scale: targetScale, signal });
      if (sequence !== renderSequence || requestedRevision !== documentSession.snapshot().revision || signal.aborted) return;
      if (requestedPage !== pageIndex) return;
      pageReady = true; canvas.setAttribute('aria-busy','false'); canvas.dataset.sceneRevision = String(requestedRevision);
      canvas.dataset.pdfPage = String(requestedPage + 1); canvas.dataset.pdfScale = String(viewport.scale); lastRendered = output; overlay(); widgets(); controls();
    });
    return rendering.catch((error) => { if (!signal.aborted && !disposed && error.name !== 'AbortError' && error.name !== 'RenderingCancelledException') throw error; });
  }
  async function apply() {
    if (busy) return; clearTimeout(timer); hideError(); clearResult(); busy = true; controls(); const operation = documentOperations.begin();
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
      await reviewResult(output.bytes, name, { operation }); if (!operation.isCurrent()) return;
      await offerChain(output.bytes, name, [], { operation }); selected = null; signatureId = null;
    } catch (error) { if (operation.isCurrent()) showError(error.message); }
    finally { if (!disposed) { busy = false; controls(); void preview().catch(() => {}); } }
  }
  async function historyAction(kind) {
    if (busy) return;
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
      await reviewResult(output.bytes, artifact.name, { operation }); if (!operation.isCurrent()) return;
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
    if (busy || !selected || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
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
    const upload = document.createElement('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg'; upload.id = 'signatureInput'; upload.hidden = true;
    const uploadButton = action('Upload signature', 'sigModeUpload', () => { sigMode = 'upload'; fillTextActive = false; upload.click(); }); $('sigModeType').after(uploadButton, upload);
    const previewImage = document.createElement('img'); previewImage.id = 'signaturePreview'; previewImage.className = 'signature-asset-preview'; previewImage.alt = 'Trimmed signature used in the PDF'; previewImage.hidden = true; canvas.after(previewImage);
    const note = document.createElement('p'); note.textContent = 'Electronic image signatures. This tool does not create or verify digital certificates.'; previewImage.after(note);
    let previewUrl = null, draftTypedText = null;
    assetCleanups.push(() => { if (previewUrl) URL.revokeObjectURL(previewUrl); });
    resetSignatureDraft = () => { ++signatureSequence; draftSignature = null; draftTypedText = null; $('typeSigInput').value = ''; ctx.clearRect(0, 0, canvas.width, canvas.height); previewImage.hidden = true; $('sigStatus').textContent = 'Selected signature image. Type, draw, or upload to replace it.'; };
    const setMode = (mode) => {
      sigMode = mode; fillTextActive = false; drawing = false; $('typeSigRow').hidden = mode !== 'type';
      $('sigModeDraw').setAttribute('aria-selected', String(mode === 'draw')); $('sigModeType').setAttribute('aria-selected', String(mode === 'type'));
      if (mode === 'draw') { ctx.clearRect(0, 0, canvas.width, canvas.height); draftSignature = null; previewImage.hidden = true; }
      if (mode === 'type' && $('typeSigInput').value.trim()) void typed();
    };
    $('sigModeDraw').addEventListener('click', () => setMode('draw')); $('sigModeType').addEventListener('click', () => setMode('type'));
    async function accept(asset, sequence, targetId, typedText = null) {
      if (sequence !== signatureSequence || disposed) return;
      asset.assetId = await documentSession.addAsset(asset.bytes, asset.type, asset.name);
      if (sequence !== signatureSequence || disposed) return;
      draftSignature = asset; draftTypedText = typedText; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(new Blob([asset.bytes], { type: asset.type })); previewImage.src = previewUrl; previewImage.hidden = false;
      $('sigStatus').textContent = 'Signature ready. Click on the page to place it.';
      const object = scene().objects.find((o) => o.id === targetId);
      if (object && signatureId === targetId) change((s) => { const o = s.objects.find((o) => o.id === targetId); o.assetId = asset.assetId; o.height = o.width * asset.height / asset.width; });
    }
    async function capture(sequence, targetId, typedText = null) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) await accept(await imageAsset(new File([blob], 'signature.png', { type: 'image/png' }), { trim: true }), sequence, targetId, typedText);
    }
    async function typed() {
      const sequence = ++signatureSequence, targetId = signatureId; const text = $('typeSigInput').value.trim(); fillTextActive = false;
      if (!text) { clearDraft(); return; }
      try {
        const family = await ensureUnicodePreviewFont('italic', { text }); await document.fonts.ready;
        if (sequence !== signatureSequence || disposed || !isCurrent() || targetId !== signatureId) return;
        let size = 72; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `italic ${size}px "${family}"`; const measured = ctx.measureText(text);
        size = Math.min(size, size * (canvas.width - 20) / Math.max(1, measured.width), (canvas.height - 20) / 1.5);
        if (size < 2) throw new Error('Use a shorter signature name; the full text cannot fit legibly.');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `italic ${size}px "${family}"`; ctx.fillStyle = '#111'; ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        await capture(sequence, targetId, text);
      } catch (error) { if (!disposed && isCurrent() && sequence === signatureSequence && targetId === signatureId) { $('typeSigInput').value = draftTypedText || ''; showError(`${error.message} Previous signature was retained.`); } }
    }
    $('typeSigInput').addEventListener('input', typed);
    upload.addEventListener('change', async () => { const file = upload.files[0]; if (!file) return; const sequence = ++signatureSequence, targetId = signatureId;
      try { await accept(await imageAsset(file, { trim: true }), sequence, targetId); } catch (error) { showError(error.message); } upload.value = ''; });
    function clearDraft() {
      ++signatureSequence; drawing = false; draftSignature = null; draftTypedText = null; ctx.clearRect(0, 0, canvas.width, canvas.height); previewImage.hidden = true; $('sigStatus').textContent = '';
      if (signatureId) { const id = signatureId; signatureId = null; if (selected === id) selected = null; change((s) => { s.objects = s.objects.filter((o) => o.id !== id); }); }
    }
    $('clearSigBtn').addEventListener('click', () => { $('typeSigInput').value = ''; clearDraft(); });
    const point = (e) => { const rect = canvas.getBoundingClientRect(); return { x: (e.clientX - rect.left) * canvas.width / rect.width, y: (e.clientY - rect.top) * canvas.height / rect.height }; };
    canvas.addEventListener('pointerdown', (e) => {
      if (sigMode !== 'draw' || busy || drawing) return; e.preventDefault(); drawing = true; pointerId = e.pointerId; canvas.setPointerCapture(pointerId); fillTextActive = false;
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2.2; ctx.lineCap = ctx.lineJoin = 'round'; const p = point(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + .1, p.y + .1); ctx.stroke();
    });
    canvas.addEventListener('pointermove', (e) => { if (!drawing || e.pointerId !== pointerId) return; e.preventDefault(); const p = point(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    canvas.addEventListener('pointerup', async (e) => { if (!drawing || e.pointerId !== pointerId) return; drawing = false; try { canvas.releasePointerCapture(e.pointerId); } catch {} const sequence = ++signatureSequence, targetId = signatureId; try { await capture(sequence, targetId); } catch (error) { showError(error.message); } });
    canvas.addEventListener('pointercancel', (e) => { drawing = false; try { canvas.releasePointerCapture(e.pointerId); } catch {} });
  }
}
