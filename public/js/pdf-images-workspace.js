import { t } from './i18n.js';
import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { createPageWorkspace } from './page-workspace.js';
import { createPagePlan } from './core/page-plan.js';
import { createOutputGroup } from './page-output-group.js';
import { estimatePdfImages, exportPdfImages } from './core/pdf-images.js';
import { createImageWorkLane } from './core/image-intake.js';

export async function createPdfImagesWorkspace({ container, ui, onAdopt }) {
  if (!document.getElementById('imageComposerStyles')) { const link = document.createElement('link'); link.id = 'imageComposerStyles'; link.rel = 'stylesheet'; link.href = '/css/image-composer.css'; document.head.append(link); }
  const session = ui.documentSession, owner = session.snapshot().taskId, revision = session.snapshot().revision, lane = createImageWorkLane();
  let disposed = false, epoch = 0, controller = null, group = null, timer = null, estimating = false, processing = false, estimate = null, panel = null;
  const root = document.createElement('section'); root.className = 'pdf-images-workspace'; root.id = 'pdfImagesWorkspace'; root.inert = true;
  const heading = document.createElement('h2'); heading.textContent = t('images.selected_pages', 'Export selected PDF pages');
  const settings = document.createElement('div'); settings.className = 'pdf-images-settings';
  function select(id, label, values, selected) { const wrapper = document.createElement('label'); wrapper.textContent = label; const input = document.createElement('select'); input.id = id; input.className = 'select-input'; for (const [value, text] of values) input.add(new Option(text, value)); input.value = selected; wrapper.append(input); settings.append(wrapper); input.addEventListener('change', changed); return input; }
  const format = select('formatSelect', t('images.format', 'Image format'), [['png', 'PNG'], ['jpg', 'JPG']], 'png');
  const scale = select('resolutionSelect', t('images.resolution', 'Requested resolution'), [['1', '1× · 72 DPI'], ['2', '2× · 144 DPI'], ['3', '3× · 216 DPI']], '2');
  const help = document.createElement('p'); help.className = 'option-hint'; help.textContent = t('images.bounds', 'Each image is capped at 4096 pixels per edge and 16 million pixels. Large pages use a lower effective DPI, shown below. Size is an estimate; the complete output must fit within 96 MiB. All files remain available in a paged list; ZIP is limited to 100 MiB.');
  const detail = document.createElement('p'); detail.id = 'pdfImagesEstimate'; detail.className = 'pdf-images-estimate'; detail.setAttribute('role', 'status');
  const selection = document.createElement('div'); selection.id = 'pdfImageSelection';
  const actions = document.createElement('div'); actions.className = 'composer-actions';
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'btn btn-primary'; exportButton.id = 'exportImagesBtn'; exportButton.textContent = t('images.export_review', 'Export and review selected images'); exportButton.addEventListener('click', () => { void run().catch(fail); });
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.id = 'cancelImageExportBtn'; cancel.className = 'btn btn-ghost'; cancel.textContent = t('common.cancel', 'Cancel'); cancel.addEventListener('click', () => { invalidate(); processing = estimating = false; ui.hideProgress(); schedule(); });
  actions.append(exportButton, cancel); root.append(heading, settings, help, detail, selection, actions); container.replaceChildren(root);
  const request = ui.documentOperations.begin(), value = await ui.getWorkspaceInput({ operation: request });
  if (!value || !owns()) { root.remove(); throw new DOMException('The PDF task changed while opening.', 'AbortError'); }
  const source = await (await ensurePdfLib()).PDFDocument.load(value.bytes.slice(), { updateMetadata: false });
  if (!owns()) { root.remove(); throw new DOMException('The PDF task changed while opening.', 'AbortError'); }
  if (!session.snapshot().selection.length) session.setSelection(Array.from({ length: source.getPageCount() }, (_, i) => i));
  panel = await createPageWorkspace({ container: selection, plan: createPagePlan({ sourceId: 'image-export', pageCount: source.getPageCount() }), sources: [{ id: 'image-export', bytes: value.bytes }], onSelectionChange: changed });
  await panel.ready(); if (!owns()) { panel.dispose(); root.remove(); throw new DOMException('The PDF task changed while opening.', 'AbortError'); }
  root.inert = false;
  document.body.classList.add('image-task-loaded');
  function owns() { return !disposed && session.snapshot().taskId === owner && session.snapshot().revision === revision && session.snapshot().current?.type === 'application/pdf'; }
  function fail(error) { if (owns() && error.name !== 'AbortError') ui.showError(error.message); }
  function invalidate() { epoch++; controller?.abort(); controller = null; group?.dispose(); group = null; clearTimeout(timer); estimate = null; if (owns()) { ui.documentOperations.cancel(); ui.clearResult(); } }
  function update() { if (!owns()) return; root.setAttribute('aria-busy', String(estimating || processing)); panel?.setDisabled(processing); format.disabled = scale.disabled = processing; exportButton.disabled = processing || estimating || !estimate || !panel?.selection().length; cancel.hidden = !processing && !estimating; }
  function options() { return { pages: panel.selection(), scale: Number(scale.value), format: format.value, name: value.name.replace(/\.pdf$/i, '') || 'document' }; }
  function changed() { if (!owns()) return; invalidate(); schedule(); }
  function schedule() { if (!owns()) return; estimating = true; detail.textContent = t('images.estimating', 'Estimating selected output dimensions and memory…'); update(); const token = epoch; timer = setTimeout(() => { void measure(token).catch(fail); }, 100); }
  async function measure(token) {
    if (!owns() || token !== epoch) return; const request = new AbortController(); controller = request;
    try {
      const measured = await lane.run(async () => estimatePdfImages(value.bytes, options(), { pdfjs: await ensurePdfJs(), pdfjsAssets: PDFJS_ASSET_URLS, signal: request.signal }), { signal: request.signal });
      if (!owns() || token !== epoch || request.signal.aborted) return; estimate = measured;
      const sizes = measured.first.map((entry) => `${entry.page}: ${entry.width}×${entry.height}`).join(' · ');
      detail.textContent = `${measured.count} ${t('images.files', 'files')} · ${measured.minDpi === measured.maxDpi ? measured.minDpi : measured.minDpi + '–' + measured.maxDpi} DPI · ${t('images.peak_canvas', 'peak canvas')} ${ui.formatBytes(measured.peakCanvasBytes)} · ${t('images.estimated_size', 'estimated output')} ${ui.formatBytes(measured.estimatedBytes)} (${t('images.actual_size_varies', 'actual size varies')}) · ${sizes}${measured.count > 12 ? ' …' : ''}${measured.limited ? ` · ${measured.limited} ${t('images.capped', 'pages capped to the pixel limit')}` : ''}`;
    } catch (error) { if (owns() && token === epoch) { estimate = null; detail.textContent = error.message; fail(error); } }
    finally { if (owns() && token === epoch) { estimating = false; update(); } }
  }
  async function run() {
    if (!owns() || exportButton.disabled) return; const measured = estimate; invalidate(); estimate = measured; processing = true; estimating = false; ui.hideError(); ui.showProgress(t('images.exporting', 'Rendering selected images…')); update();
    const token = epoch, operation = ui.documentOperations.begin(); controller = { abort: () => ui.documentOperations.cancel() };
    const current = () => owns() && token === epoch && operation.isCurrent();
    const continuationIsCurrent = () => !disposed && session.snapshot().taskId === owner && token === epoch && operation.isCurrent();
    try {
      let results = await lane.run(async () => exportPdfImages(value.bytes, options(), { pdfjs: await ensurePdfJs(), pdfjsAssets: PDFJS_ASSET_URLS, signal: operation.signal, canvasFactory: () => document.createElement('canvas'), encodeCanvas: async (canvas, type, quality) => { const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('The image encoder failed.')), type, quality)); operation.signal.throwIfAborted(); return new Uint8Array(await blob.arrayBuffer()); }, onProgress: (event) => { if (current()) ui.setProgress(event.percent, `${event.completed} / ${event.total}`); } }), { signal: operation.signal });
      if (!current()) return;
      group = createOutputGroup(results, { container: root, signal: operation.signal, isCurrent: current, continuationIsCurrent, onAdopt, imageWorkLane: lane, zipName: `${options().name}-images.zip` }); results = null; await group.ready;
    } finally { if (current()) { processing = false; ui.hideProgress(); update(); } }
  }
  schedule();
  return { element: root, async settled() { await lane.drained(); }, dispose() { if (disposed) return; const owned = owns(); invalidate(); disposed = true; panel?.dispose(); root.remove(); if (owned) document.body.classList.remove('image-task-loaded'); } };
}
