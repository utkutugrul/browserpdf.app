import { normalizePageSelection, validatePageCount } from './page-selection.js';
import { visualTransform } from './page-geometry.js';
import { inspectPageOperationStructures, pageOperationBoundary, MAX_PAGE_OPERATION_BYTES } from './page-operations.js';

function finite(value, min, max, label) { value = Number(value); if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${label} must be between ${min} and ${max}.`); return value; }
export function numberLabel(format, number, last) { return format === 'page-n' ? `Page ${number}` : format === 'page-n-of-m' ? `Page ${number} of ${last}` : String(number); }
// The scene renderer uses the same PDF.js viewport / visualTransform contract.
// Fonts and runtimes are injected so Workflows can call this core without DOM.
export async function applyPageEffect(bytes, options, { pdfLib, pdfjs, pdfjsAssets = {}, embedFont, signal, onProgress } = {}) {
  signal?.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_PAGE_OPERATION_BYTES) throw new RangeError('Choose a PDF smaller than 250 MiB.');
  const doc = await pdfLib.PDFDocument.load(bytes.slice(), { updateMetadata: false, ignoreEncryption: false });
  const pageCount = validatePageCount(doc.getPageCount());
  let selected = normalizePageSelection(options.pages, pageCount);
  const kind = options.kind;
  if (!['numbers', 'watermark'].includes(kind)) throw new TypeError('Choose numbers or watermark.');
  const size = finite(options.size ?? (kind === 'numbers' ? 11 : 56), 4, 200, 'Font size');
  let texts = [], marginX, marginY, start;
  if (kind === 'numbers') {
    const startPage = finite(options.startPage ?? 1, 1, pageCount, 'Start page');
    start = finite(options.startNumber ?? 1, 0, 1000000, 'Start number');
    if (!Number.isInteger(startPage) || !Number.isInteger(start)) throw new RangeError('Start page and number must be integers.');
    selected = selected.filter((index) => index >= startPage - 1);
    marginX = finite(options.marginX ?? 28, 0, 1000, 'Horizontal margin'); marginY = finite(options.marginY ?? 28, 0, 1000, 'Vertical margin');
    texts = selected.map((_, index) => numberLabel(options.format, start + index, start + selected.length - 1));
  } else if (options.mode !== 'logo') {
    const text = String(options.text ?? '').trim();
    if (!text || text.length > 1000) throw new RangeError('Enter between 1 and 1,000 watermark characters.');
    texts = [text];
  }
  if (!selected.length) throw new RangeError('Select at least one page within the chosen scope.');
  const structures = inspectPageOperationStructures(doc, pdfLib);
  const font = texts.length ? await embedFont(doc, { text: texts.join(' '), weight: options.font ?? (kind === 'numbers' ? 'regular' : 'bold'), signal }) : null;
  let logo = null;
  if (kind === 'watermark' && options.mode === 'logo') {
    if (!(options.logo?.bytes instanceof Uint8Array) || options.logo.bytes.length > 16 * 1024 * 1024) throw new RangeError('Choose a normalized PNG or JPEG logo smaller than 16 MiB.');
    logo = options.logo.type === 'image/jpeg' ? await doc.embedJpg(options.logo.bytes) : await doc.embedPng(options.logo.bytes);
  }
  const opacity = finite(options.opacity ?? 0.15, 0.01, 1, 'Opacity');
  const rotation = finite(options.rotation ?? 45, -360, 360, 'Rotation');
  const colorValues = options.color ?? [0.55, 0.55, 0.55];
  if (!Array.isArray(colorValues) || colorValues.length !== 3) throw new RangeError('Choose an RGB color.');
  const color = pdfLib.rgb(...colorValues.map((n) => finite(n, 0, 1, 'Color')));
  const task = pdfjs.getDocument({ data: bytes.slice(), ...pdfjsAssets });
  const cancel = () => { void task.destroy().catch(() => {}); }; signal?.addEventListener('abort', cancel, { once: true });
  try {
    const pdf = await task.promise, viewports = new Map(); let totalStamps = 0;
    // Inspect the complete placement budget before writing any page operators.
    for (const index of selected) {
      signal?.throwIfAborted(); const viewport = (await pdf.getPage(index + 1)).getViewport({ scale: 1 }); viewports.set(index, viewport);
      if (kind === 'watermark') {
        const width = logo ? finite(options.logoWidth ?? 140, 4, 2000, 'Logo width') : font.widthOfTextAtSize(texts[0], size), height = logo ? width * logo.height / logo.width : size;
        const gap = finite(options.gap ?? 60, 10, 1000, 'Tile spacing');
        const count = options.tile ? Math.max(1, Math.ceil(viewport.width / (width + gap) - 0.5)) * Math.max(1, Math.ceil(viewport.height / (height + gap) - 0.5)) : 1;
        totalStamps += count;
        if (count > 1000 || totalStamps > 100000) throw new RangeError('Tile settings exceed 1,000 stamps per page or 100,000 per operation. Increase spacing.');
      }
    }
    let stamps = 0, textPlacements = 0;
    for (const [ordinal, index] of selected.entries()) {
      signal?.throwIfAborted();
      const viewport = viewports.get(index), page = doc.getPage(index);
      page.pushOperators(pdfLib.pushGraphicsState(), pdfLib.concatTransformationMatrix(...visualTransform(viewport)));
      if (kind === 'numbers') {
        const text = texts[ordinal], width = font.widthOfTextAtSize(text, size), [vertical, horizontal] = String(options.position || 'bottom-center').split('-');
        if (width + marginX * 2 > viewport.width || marginY * 2 + size > viewport.height) throw new RangeError('The number and margins do not fit this page.');
        const x = horizontal === 'left' ? marginX : horizontal === 'right' ? viewport.width - marginX - width : (viewport.width - width) / 2;
        const y = vertical === 'top' ? viewport.height - marginY - size : marginY;
        page.drawText(text, { x, y, size, font, color: pdfLib.rgb(0.25, 0.25, 0.25) }); textPlacements++;
      } else {
        const width = logo ? finite(options.logoWidth ?? 140, 4, 2000, 'Logo width') : font.widthOfTextAtSize(texts[0], size), height = logo ? width * logo.height / logo.width : size;
        const centers = [];
        if (options.tile) {
          const gap = finite(options.gap ?? 60, 10, 1000, 'Tile spacing'), stepX = width + gap, stepY = height + gap;
          const columns = Math.max(1, Math.ceil(viewport.width / stepX - 0.5)), rows = Math.max(1, Math.ceil(viewport.height / stepY - 0.5));
          for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) { if (++stamps > 100000 || centers.length >= 1000) throw new RangeError('Tile settings exceed 1,000 stamps per page or 100,000 per operation. Increase spacing.'); centers.push([stepX / 2 >= viewport.width ? viewport.width / 2 : stepX * (column + 0.5), stepY / 2 >= viewport.height ? viewport.height / 2 : stepY * (row + 0.5)]); }
        } else centers.push([viewport.width * finite(options.x ?? 50, 0, 100, 'Horizontal position') / 100, viewport.height * (1 - finite(options.y ?? 50, 0, 100, 'Vertical position') / 100)]);
        const angle = rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
        for (const [cx, cy] of centers) {
          signal?.throwIfAborted();
          const placement = { x: cx - width / 2 * cos + height / 2 * sin, y: cy - width / 2 * sin - height / 2 * cos, rotate: pdfLib.degrees(rotation), opacity };
          if (logo) page.drawImage(logo, { ...placement, width, height }); else { page.drawText(texts[0], { ...placement, size, font, color }); textPlacements++; }
        }
      }
      page.pushOperators(pdfLib.popGraphicsState());
      onProgress?.({ percent: Math.round((ordinal + 1) / selected.length * 90), page: index + 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted(); const output = new Uint8Array(await doc.save({ updateFieldAppearances: false })); signal?.throwIfAborted();
    if (output.length > MAX_PAGE_OPERATION_BYTES) throw new RangeError('The saved PDF exceeds 250 MiB.');
    const verified = await pdfLib.PDFDocument.load(output.slice(), { updateMetadata: false, throwOnInvalidObject: true }); signal?.throwIfAborted();
    if (verified.getPageCount() !== pageCount) throw new Error('Saved page count verification failed.');
    const capabilities = { ...options.capabilities, encrypted: false };
    if (textPlacements > 0) capabilities.searchable = true;
    try { capabilities.forms = verified.getForm().getFields().length > 0; } catch { delete capabilities.forms; }
    return { bytes: output, type: 'application/pdf', capabilities, boundary: pageOperationBoundary('pdf-rewrite', [structures]), summary: { pages: selected.map((n) => n + 1) } };
  } finally { signal?.removeEventListener('abort', cancel); try { await task.destroy(); } catch (error) { if (!signal?.aborted) throw error; } }
}
