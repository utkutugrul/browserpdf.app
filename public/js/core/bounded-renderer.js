// Canvas budgets apply to both dimensions and area, including extreme page ratios.
export function boundedViewport(page, { scale = 1, maxDimension = 4096, maxPixels = 16_000_000 } = {}) {
  if (![scale, maxDimension, maxPixels].every((value) => Number.isFinite(value) && value > 0) || maxDimension < 1 || maxPixels < maxDimension) throw new RangeError('Canvas budgets must be finite positive values.');
  const base = page.getViewport({ scale });
  if (!(base.width > 0 && base.height > 0 && Number.isFinite(base.width * base.height))) throw new RangeError('Invalid page dimensions.');
  const factor = Math.min(1, maxDimension / base.width, maxDimension / base.height, Math.sqrt(maxPixels / (Math.ceil(base.width) * Math.ceil(base.height))));
  return factor < 1 ? page.getViewport({ scale: scale * factor }) : base;
}
export async function renderBoundedPage(page, canvas, { signal, ...options } = {}) {
  signal?.throwIfAborted();
  const viewport = boundedViewport(page, options);
  canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
  const cancel = () => task.cancel(); signal?.addEventListener('abort', cancel, { once: true });
  try { await task.promise; signal?.throwIfAborted(); return viewport; }
  finally { signal?.removeEventListener('abort', cancel); }
}
export async function renderThumbnail({ bytes, pageIndex, canvas, signal, maxDimension = 220, maxPixels = 220_000, pdfjs, pdfjsAssets = {} }) {
  if (!pdfjs) { const runtime = await import('../lib-loader.js'); pdfjs = await runtime.ensurePdfJs(); pdfjsAssets = runtime.PDFJS_ASSET_URLS; }
  signal?.throwIfAborted();
  const task = pdfjs.getDocument({ data: bytes.slice(), ...pdfjsAssets });
  const cancel = () => { void task.destroy().catch(() => {}); }; signal?.addEventListener('abort', cancel, { once: true });
  try { const doc = await task.promise; return await renderBoundedPage(await doc.getPage(pageIndex + 1), canvas, { signal, maxDimension, maxPixels }); }
  finally { signal?.removeEventListener('abort', cancel); try { await task.destroy(); } catch (error) { if (!signal?.aborted) throw error; } }
}
