import { boundedViewport, renderBoundedPage } from './bounded-renderer.js';
import { normalizePageSelection, validatePageCount } from './page-selection.js';
import { MAX_OUTPUT_BYTES, MAX_OUTPUT_COUNT } from './page-split.js';

export const PDF_IMAGE_LIMITS = Object.freeze({ dimension: 4096, pixels: 16_000_000 });
async function withPdf(bytes, { pdfjs, pdfjsAssets = {}, signal }, inspect) {
  signal?.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 250 * 1024 * 1024) throw new RangeError('Choose a non-empty PDF smaller than 250 MiB.');
  const task = pdfjs.getDocument({ data: bytes.slice(), ...pdfjsAssets });
  const cancel = () => { void task.destroy().catch(() => {}); }; signal?.addEventListener('abort', cancel, { once: true });
  try { const doc = await task.promise; signal?.throwIfAborted(); validatePageCount(doc.numPages); return await inspect(doc); }
  finally { signal?.removeEventListener('abort', cancel); try { await task.destroy(); } catch (error) { if (!signal?.aborted) throw error; } }
}
function options(value, count) {
  if (![1, 2, 3].includes(value.scale) || !['png', 'jpg'].includes(value.format)) throw new RangeError('Choose PNG or JPG at 1×, 2× or 3× resolution.');
  const pages = normalizePageSelection(value.pages, count);
  if (!pages.length || pages.length > MAX_OUTPUT_COUNT) throw new RangeError('Select between 1 and 10,000 pages.');
  return pages;
}
function dimensions(page, scale) {
  const base = page.getViewport({ scale: 1 }), viewport = boundedViewport(page, { scale, maxDimension: PDF_IMAGE_LIMITS.dimension, maxPixels: PDF_IMAGE_LIMITS.pixels });
  const width = Math.max(1, Math.floor(viewport.width)), height = Math.max(1, Math.floor(viewport.height));
  return { width, height, pixels: width * height, dpi: Math.round(72 * viewport.width / base.width), limited: viewport.width < base.width * scale - .01 };
}

// DOM-free: metadata estimation never allocates an output canvas.
export async function estimatePdfImages(bytes, value, environment) {
  return withPdf(bytes, environment, async (doc) => {
    const pages = options(value, doc.numPages); let totalPixels = 0, peakPixels = 0, limited = 0, minDpi = Infinity, maxDpi = 0; const first = [];
    for (const index of pages) {
      environment.signal?.throwIfAborted(); const size = dimensions(await doc.getPage(index + 1), value.scale);
      totalPixels += size.pixels; peakPixels = Math.max(peakPixels, size.pixels); limited += Number(size.limited); minDpi = Math.min(minDpi, size.dpi); maxDpi = Math.max(maxDpi, size.dpi);
      if (first.length < 12) first.push({ page: index + 1, ...size });
      if (first.length % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { count: pages.length, first, totalPixels, peakCanvasBytes: peakPixels * 4, estimatedBytes: Math.ceil(totalPixels * (value.format === 'png' ? 1.5 : .3)), rawPixelBytes: totalPixels * 4, limited, minDpi, maxDpi, outputByteLimit: MAX_OUTPUT_BYTES };
  });
}

// A single canvas and one codec completion exist at a time. The injected encoder
// may not be cancellable; its completion is checked before any bytes are retained.
export async function exportPdfImages(bytes, value, { canvasFactory, encodeCanvas, onProgress, ...environment }) {
  return withPdf(bytes, environment, async (doc) => {
    const pages = options(value, doc.numPages), results = []; let total = 0;
    try {
      for (const [ordinal, index] of pages.entries()) {
        environment.signal?.throwIfAborted(); const page = await doc.getPage(index + 1); environment.signal?.throwIfAborted();
        const canvas = canvasFactory();
        try {
          await renderBoundedPage(page, canvas, { signal: environment.signal, scale: value.scale, maxDimension: PDF_IMAGE_LIMITS.dimension, maxPixels: PDF_IMAGE_LIMITS.pixels });
          environment.signal?.throwIfAborted();
          const encoded = await encodeCanvas(canvas, value.format === 'jpg' ? 'image/jpeg' : 'image/png', .92); environment.signal?.throwIfAborted();
          if (!(encoded instanceof Uint8Array) || !encoded.length) throw new Error('An image could not be encoded. No partial output group was published.');
          total += encoded.length;
          if (total > MAX_OUTPUT_BYTES) throw new RangeError('The complete image output exceeds 96 MiB. Select fewer pages or lower the resolution. No partial output group was published.');
          results.push({ bytes: encoded, name: `${value.name || 'document'}-page-${index + 1}.${value.format}`, type: value.format === 'jpg' ? 'image/jpeg' : 'image/png', pages: [index + 1], capabilities: { encrypted: false, searchable: false, forms: false, rasterized: true }, dimensions: dimensions(page, value.scale) });
          onProgress?.({ completed: ordinal + 1, total: pages.length, percent: Math.round((ordinal + 1) / pages.length * 100) });
        } finally { canvas.width = canvas.height = 0; page.cleanup?.(); }
        await new Promise((resolve) => setTimeout(resolve, 0)); environment.signal?.throwIfAborted();
      }
      return results;
    } catch (error) { results.length = 0; throw error; }
  });
}
