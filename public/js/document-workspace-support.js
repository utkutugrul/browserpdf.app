// Loaded only for workspace input, extra local sources, or PDF previews.
// Dependencies use the caller's existing session and validation helpers.

export async function getWorkspaceInput({ bakeScene = true, bakeComposition = true, operation } = {}, { ensureDocumentSession, documentSession }) {
  await ensureDocumentSession();
  operation?.signal?.throwIfAborted();
  if (operation && !operation.isCurrent()) return null;
  const snapshot = documentSession.snapshot();
  if (!snapshot.current) throw new Error('Open a document first.');
  const scene = documentSession.scene();
  const composition = documentSession.composition();
  let bytes;
  let capabilities = { ...snapshot.current.capabilities };
  if (composition && bakeComposition) {
    const [{ composeImagesPdf }, runtime] = await Promise.all([import('./core/image-composition.js'), import('./lib-loader.js')]);
    const rendered = await composeImagesPdf(composition, { resource: documentSession.resource, pdfLib: await runtime.ensurePdfLib(), signal: operation?.signal });
    bytes = rendered.bytes; capabilities = rendered.capabilities;
  }
  if (scene && bakeScene) {
    const [{ renderScenePdf }, runtime] = await Promise.all([import('./core/object-scene.js'), import('./lib-loader.js')]);
    const [pdfLib, pdfjs] = await Promise.all([runtime.ensurePdfLib(), runtime.ensurePdfJs()]);
    const rendered = await renderScenePdf({ scene, resource: documentSession.resource, pdfLib, pdfjs, pdfjsAssets: runtime.PDFJS_ASSET_URLS, signal: operation?.signal });
    bytes = rendered.bytes;
    // The verified rewrite preserves known searchability for image-only edits,
    // adds searchable text, and reports actual surviving fields after flatten.
    capabilities = { ...capabilities, encrypted: false, forms: rendered.forms };
    if (scene.objects.some((object) => object.kind === 'text')) capabilities.searchable = true;
  }
  if (!bytes) bytes = documentSession.current().bytes;
  if (operation && !operation.isCurrent()) return null;
  const now = documentSession.snapshot();
  if (now.taskId !== snapshot.taskId || now.revision !== snapshot.revision || now.generation !== snapshot.generation) return null;
  return { bytes, capabilities, name: composition && bakeComposition ? snapshot.current.name.replace(/\.[^.]+$/, '') + '.pdf' : snapshot.current.name, type: composition && bakeComposition ? 'application/pdf' : snapshot.current.type, revision: snapshot.revision, selection: snapshot.selection, hasScene: !!scene, hasComposition: !!composition,
    losses: composition && bakeComposition ? ['composition-baked'] : scene && (scene.objects.length || Object.keys(scene.fields).length || scene.flatten) ? ['scene-baked'] : [] };
}

// PDF-mode history must reopen editable image state through a compatible mode.
export async function restoreCompositionHistory(kind, { operation } = {}, { ensureDocumentSession, documentSession, stashCompositionForChain }) {
  if (!['undo','redo'].includes(kind)) throw new TypeError('Choose Undo or Redo.');
  await ensureDocumentSession(); operation?.signal?.throwIfAborted();
  const target = documentSession.historyTarget(kind); if (!target?.composition) return null;
  const initial = documentSession.snapshot(), owns = () => { const now = documentSession.snapshot(); return now.taskId === initial.taskId && now.revision === initial.revision && now.generation === initial.generation && (!operation || operation.isCurrent()); };
  let rendered;
  if (target.composition.items.length) {
    const [{ composeImagesPdf }, runtime] = await Promise.all([import('./core/image-composition.js'),import('./lib-loader.js')]);
    if (!owns()) throw new DOMException('History was replaced or cancelled.','AbortError');
    rendered = await composeImagesPdf(target.composition,{ resource:documentSession.resource,pdfLib:await runtime.ensurePdfLib(),signal:operation?.signal });
  }
  if (!owns()) throw new DOMException('History was replaced or cancelled.','AbortError');
  documentSession[kind](); let committed = documentSession.snapshot();
  try {
    if (rendered) { documentSession.publishComposition(rendered.bytes,target.artifact.name.replace(/\.[^.]+$/,'') + '.pdf',{ ...rendered,expectedTaskId:committed.taskId,expectedRevision:committed.revision }); committed = documentSession.snapshot(); }
    const handoff = await stashCompositionForChain('jpg-to-pdf',{ expectedTaskId:committed.taskId,expectedRevision:committed.revision,operation,signal:operation?.signal });
    return { targetSlug:'jpg-to-pdf',handoff };
  } catch (error) {
    const now = documentSession.snapshot();
    if (now.taskId === committed.taskId && now.revision === committed.revision && now.generation === committed.generation) documentSession[kind === 'undo' ? 'redo' : 'undo']();
    throw error;
  }
}

export async function readExternalPdfFile(file, { maxBytes = 80 * 1024 * 1024, maxPages = 5000, signal } = {}, { t, looksLikePdfFile, checkPdfMagicBytes }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 250 * 1024 * 1024 || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10000) throw new RangeError('Invalid PDF intake limits.');
  signal?.throwIfAborted();
  if (file.size > maxBytes) throw new RangeError(t('workspace.editor_too_large', 'Choose an editable PDF smaller than {n} MB.', { n: Math.round(maxBytes / 1024 / 1024) }));
  if (!looksLikePdfFile(file)) throw new TypeError(t('common.js_err_not_pdf', 'Please select a PDF file.'));
  const bytes = new Uint8Array(await file.arrayBuffer()); signal?.throwIfAborted();
  if (bytes.length > maxBytes) throw new RangeError('This PDF exceeds the intake limit.');
  if (!checkPdfMagicBytes(bytes)) throw new TypeError(t('common.js_err_invalid_pdf', 'This file does not look like a valid PDF.'));
  const runtime = await import('./lib-loader.js');
  const [lib, pdfjs] = await Promise.all([runtime.ensurePdfLib(), runtime.ensurePdfJs()]); signal?.throwIfAborted();
  await lib.PDFDocument.load(bytes.slice(), { updateMetadata: false }); signal?.throwIfAborted();
  const task = pdfjs.getDocument({ data: bytes.slice(), ...runtime.PDFJS_ASSET_URLS });
  const abort = () => { void task.destroy().catch(() => {}); }; signal?.addEventListener('abort', abort, { once: true });
  try {
    const doc = await task.promise; signal?.throwIfAborted();
    if (!doc.numPages || doc.numPages > maxPages) throw new RangeError(t('workspace.page_limit', 'Choose a PDF with 1–{n} readable pages.', { n: maxPages }));
    return { bytes, baseName: file.name.replace(/\.pdf$/i, '') || 'document', name: file.name, pageCount: doc.numPages };
  } catch (error) { signal?.throwIfAborted(); throw error; }
  finally { signal?.removeEventListener('abort', abort); await task.destroy(); }
}

export async function renderPdfPageToCanvas(pdfjs, bytes, pageNumber, canvas, targetWidth, assetUrls) {
  const loadingTask = pdfjs.getDocument({ data: bytes.slice(), ...assetUrls });
  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(Math.min(pageNumber, doc.numPages));
    const baseViewport = page.getViewport({ scale: 1 });
    const { renderBoundedPage } = await import('./core/bounded-renderer.js');
    const viewport = await renderBoundedPage(page, canvas, { scale: (targetWidth / baseViewport.width) * (window.devicePixelRatio > 1 ? 1.6 : 1) });
    canvas.dataset.pdfScale = String(viewport.scale); canvas.dataset.pdfPage = String(pageNumber);
  } finally {
    await loadingTask.destroy();
  }
}

export async function renderPdfThumbnails(pdfDoc, containerEl, makeTile, onEachProgress) {
  containerEl.textContent = '';
  const numPages = pdfDoc.numPages;
  for (let i = 1; i <= numPages; i++) {
    onEachProgress?.(i, numPages);
    const page = await pdfDoc.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    const { renderBoundedPage } = await import('./core/bounded-renderer.js');
    await renderBoundedPage(page, canvas, { scale: 220 / baseViewport.width, maxDimension: 352, maxPixels: 100000 });
    containerEl.appendChild(makeTile(canvas, i - 1));
  }
}
