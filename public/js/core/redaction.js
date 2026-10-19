import { visualTransform } from './page-geometry.js';
import { parseRedactionPrimitives, writeRedactionPrimitives, RedactionUnsupportedError } from './redaction-primitives.js';
export { RedactionUnsupportedError } from './redaction-primitives.js';

export const REDACTION_LIMITS = Object.freeze({ inputBytes: 250 * 1024 * 1024, pages: 10000, masks: 300, masksPerPage: 100, maskPlanBytes: 128 * 1024, decodedPageBytes: 2 * 1024 * 1024, decodedDocumentBytes: 16 * 1024 * 1024, primitivePlanBytes: 16 * 1024 * 1024, pageOperators: 100000, dimension: 4096, pagePixels: 16000000, rasterPixels: 48000000, outputBytes: 96 * 1024 * 1024 });
const FONTS = new Set(['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic']);
const PAGE_KEYS = new Set(['Type', 'Parent', 'MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'Rotate', 'UserUnit', 'Resources', 'Contents', 'Metadata', 'Annots']);
const CATALOG_KEYS = new Set(['Type', 'Pages', 'Metadata', 'Version']);
const failUnsupported = (message) => { throw new RedactionUnsupportedError(message); };
function check(signal) { signal?.throwIfAborted(); }
async function destroyTask(task, signal, primaryError) {
  let cleanupError;
  try { await task.destroy(); } catch (error) { cleanupError = error; }
  // Cleanup must drain, but cannot replace the operation's primary cancellation
  // or failure. A cancellation during otherwise successful cleanup still wins.
  if (primaryError?.name === 'AbortError') return;
  check(signal);
  if (cleanupError && !primaryError) throw cleanupError;
}

// WHATWG Compression §5: a streaming native inflater. Input writes are small and
// backpressured, output is counted before retention, and BOTH ends drain on error.
// The native compression context is opaque: this is not a process-heap guarantee.
export async function inflateRedactionStream(bytes, { limit, signal } = {}) {
  check(signal);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > REDACTION_LIMITS.decodedPageBytes) throw new RangeError('Invalid content decode budget.');
  if (typeof DecompressionStream !== 'function') failUnsupported('Bounded native decompression is unavailable. Choose explicit whole-document raster mode.');
  let stream;
  try { stream = new DecompressionStream('deflate'); } catch { failUnsupported('Bounded native decompression is unavailable. Choose explicit whole-document raster mode.'); }
  const writer = stream.writable.getWriter(), reader = stream.readable.getReader(), chunks = [];
  let length = 0, completed = false;
  const aborted = () => { void reader.cancel(signal.reason).catch(() => {}); void writer.abort(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', aborted, { once: true });
  const writing = (async () => { for (let offset = 0; offset < bytes.length; offset += 256) { check(signal); await writer.write(bytes.subarray(offset, offset + 256)); } await writer.close(); })();
  void writing.catch(() => {});
  try {
    while (true) {
      check(signal); const { value, done } = await reader.read(); check(signal); if (done) break;
      if (!(value instanceof Uint8Array) || length + value.length > limit) failUnsupported('Untouched-page decoded content exceeds the redaction budget.');
      chunks.push(value.slice()); length += value.length;
    }
    await writing; check(signal);
    const result = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    completed = true; return result;
  } catch (error) { check(signal); if (error.name === 'RedactionUnsupportedError') throw error; failUnsupported('Untouched-page compressed content is invalid or unsupported.'); }
  finally {
    signal?.removeEventListener('abort', aborted);
    if (!completed) await Promise.allSettled([reader.cancel(), writer.abort()]);
    await Promise.allSettled([writing]); chunks.length = 0; reader.releaseLock(); writer.releaseLock();
  }
}

function options(value) {
  if (!value || !['hybrid', 'raster'].includes(value.mode) || ![1, 2].includes(value.scale)) throw new RangeError('Choose text-preserving or whole-document raster mode, at explicit 1× or 2× resolution.');
  if (!Array.isArray(value.masks) || !value.masks.length || value.masks.length > REDACTION_LIMITS.masks) throw new RangeError('Choose between 1 and 300 redaction masks.');
  const counts = new Map(), masks = value.masks.map((mask) => {
    if (!mask || !Number.isInteger(mask.pageIndex) || mask.pageIndex < 0 || ![mask.x, mask.y, mask.width, mask.height].every(Number.isFinite) || mask.width <= 0 || mask.height <= 0) throw new RangeError('Every mask needs a valid page and a finite positive rectangle.');
    counts.set(mask.pageIndex, (counts.get(mask.pageIndex) || 0) + 1);
    if (counts.get(mask.pageIndex) > REDACTION_LIMITS.masksPerPage) throw new RangeError('A page supports at most 100 redaction masks.');
    return { pageIndex: mask.pageIndex, x: mask.x, y: mask.y, width: mask.width, height: mask.height };
  });
  if (JSON.stringify(masks).length > REDACTION_LIMITS.maskPlanBytes) throw new RangeError('The serialized mask plan exceeds 128 KiB.');
  return { masks, mode: value.mode, scale: value.scale };
}
function numericBox(box) { return box && [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0 && Object.values(box).every((number) => Math.abs(number) <= 1e9); }
function name(value, lib) { return value instanceof lib.PDFName ? value.decodeText() : null; }
function inspectKeys(dict, allowed, label) { for (const [key] of dict.entries()) if (!allowed.has(key.decodeText())) failUnsupported(`${label} contains unsupported ${key.decodeText().slice(0, 30)} structure. Choose explicit whole-document raster mode.`); }
function pageFonts(sourcePage, lib) {
  const resource = sourcePage.node.Resources(), result = new Map();
  if (!resource) return result;
  inspectKeys(resource, new Set(['Font', 'ProcSet', 'XObject', 'ExtGState']), 'Page resources');
  // pdf-lib normalisation emits empty buckets; only an actually empty bucket
  // is accepted. No object graph from either bucket is transferred.
  for (const key of ['XObject', 'ExtGState']) { const bucket = resource.lookup(lib.PDFName.of(key)); if (bucket !== undefined && (!(bucket instanceof lib.PDFDict) || bucket.keys().length)) failUnsupported(`Unsupported ${key} page resources. Choose explicit whole-document raster mode.`); }
  const procSet = resource.lookup(lib.PDFName.of('ProcSet'));
  if (procSet !== undefined && (!(procSet instanceof lib.PDFArray) || procSet.size() > 5 || procSet.asArray().some((entry) => !['PDF', 'Text', 'ImageB', 'ImageC', 'ImageI'].includes(name(entry, lib))))) failUnsupported('Unsupported page procedure resources.');
  const fonts = resource.lookup(lib.PDFName.of('Font'));
  if (!fonts) return result;
  if (!(fonts instanceof lib.PDFDict) || fonts.keys().length > 12) failUnsupported('Page fonts exceed the supported standard-font subset.');
  for (const [key, ref] of fonts.entries()) {
    const font = sourcePage.doc.context.lookup(ref);
    if (!(font instanceof lib.PDFDict)) failUnsupported('Unsupported font reference.');
    inspectKeys(font, new Set(['Type', 'Subtype', 'BaseFont', 'Encoding']), 'Font');
    const getName = (key) => name(font.lookup(lib.PDFName.of(key)), lib);
    const base = getName('BaseFont');
    if (getName('Type') !== 'Font' || getName('Subtype') !== 'Type1' || !FONTS.has(base) || getName('Encoding') !== 'WinAnsiEncoding') failUnsupported('Untouched pages require standard Latin Type1 fonts with explicit WinAnsiEncoding. Choose explicit whole-document raster mode.');
    result.set(key.decodeText(), base);
  }
  return result;
}
async function pageContent(page, lib, inflate, remaining, signal) {
  const value = page.node.Contents(), streams = value instanceof lib.PDFArray ? value.asArray().map((entry) => page.doc.context.lookup(entry)) : value ? [value] : [];
  if (streams.length > 64) failUnsupported('A page has more than 64 content streams.');
  const pieces = []; let length = 0;
  for (const stream of streams) {
    check(signal);
    if (!(stream instanceof lib.PDFRawStream)) failUnsupported('Unsupported page content object.');
    inspectKeys(stream.dict, new Set(['Length', 'Filter']), 'Content stream');
    const filter = stream.dict.lookup(lib.PDFName.of('Filter')), encoded = stream.getContents();
    const limit = Math.min(REDACTION_LIMITS.decodedPageBytes - length, remaining - length);
    if (limit < 1 || encoded.length > REDACTION_LIMITS.decodedPageBytes) failUnsupported('Untouched-page content exceeds the redaction byte budget.');
    let decoded;
    if (!filter) decoded = encoded;
    else if (name(filter, lib) === 'FlateDecode') decoded = await inflate(encoded, { limit, signal });
    else failUnsupported('Unsupported untouched-page compression. Choose explicit whole-document raster mode.');
    check(signal);
    if (!(decoded instanceof Uint8Array) || decoded.length > limit) failUnsupported('Untouched-page decoded content exceeds the redaction byte budget.');
    pieces.push(decoded); length += decoded.length + 1;
    if (length > REDACTION_LIMITS.decodedPageBytes || length > remaining) failUnsupported('Untouched-page decoded content exceeds the redaction byte budget.');
  }
  const joined = new Uint8Array(length); let offset = 0;
  for (const piece of pieces) { joined.set(piece, offset); offset += piece.length; joined[offset++] = 10; }
  return joined;
}
function maskPixels(mask, viewport, width, height) {
  const points = [[mask.x, mask.y], [mask.x + mask.width, mask.y], [mask.x + mask.width, mask.y + mask.height], [mask.x, mask.y + mask.height]].map(([x, y]) => viewport.convertToViewportPoint(x, y));
  const left = Math.max(0, Math.floor(Math.min(...points.map((point) => point[0])))), top = Math.max(0, Math.floor(Math.min(...points.map((point) => point[1]))));
  const right = Math.min(width, Math.ceil(Math.max(...points.map((point) => point[0])))), bottom = Math.min(height, Math.ceil(Math.max(...points.map((point) => point[1]))));
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) throw new RangeError('A mask has no nonempty black region on its visible page.');
  return { x: left, y: top, width: right - left, height: bottom - top };
}
function geometry(page, proxy, lib) {
  const media = page.getMediaBox(), crop = page.getCropBox(), rotation = page.getRotation().angle, unit = page.node.lookup(lib.PDFName.of('UserUnit'));
  const userUnit = unit === undefined ? 1 : unit instanceof lib.PDFNumber ? unit.asNumber() : NaN;
  if (!numericBox(media) || !numericBox(crop) || ![0, 90, 180, 270].includes(rotation) || !(userUnit > 0 && userUnit <= 75000) || userUnit !== proxy.userUnit) throw new RangeError('Unsupported page boxes, rotation or UserUnit.');
  const boxes = {};
  for (const key of ['BleedBox', 'TrimBox', 'ArtBox']) {
    const raw = page.node.lookup(lib.PDFName.of(key));
    if (raw !== undefined) { if (!(raw instanceof lib.PDFArray) || raw.size() !== 4) throw new RangeError('Invalid page boundary.'); const values = raw.asArray().map((entry) => page.doc.context.lookup(entry)); if (values.some((entry) => !(entry instanceof lib.PDFNumber) || !Number.isFinite(entry.asNumber()))) throw new RangeError('Invalid page boundary.'); boxes[key] = values.map((entry) => entry.asNumber()); }
  }
  return { media, crop, rotation, userUnit, boxes };
}
function freshPage(doc, shape, lib) {
  const page = doc.addPage([shape.media.width, shape.media.height]);
  page.setMediaBox(shape.media.x, shape.media.y, shape.media.width, shape.media.height);
  page.setCropBox(shape.crop.x, shape.crop.y, shape.crop.width, shape.crop.height);
  page.setRotation(lib.degrees(shape.rotation)); page.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(shape.userUnit));
  for (const [key, values] of Object.entries(shape.boxes)) page.node.set(lib.PDFName.of(key), doc.context.obj(values));
  return page;
}
async function withInput(bytes, env, work) {
  check(env.signal);
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > REDACTION_LIMITS.inputBytes) throw new RangeError('Choose a nonempty PDF smaller than 250 MiB.');
  const source = await env.pdfLib.PDFDocument.load(bytes.slice(), { updateMetadata: false, throwOnInvalidObject: true }); check(env.signal);
  const task = env.pdfjs.getDocument({ data: bytes.slice(), ...env.pdfjsAssets, stopAtErrors: true });
  const abort = () => { void task.destroy().catch(() => {}); }; env.signal?.addEventListener('abort', abort, { once: true });
  let primaryError;
  try { const pdf = await task.promise; check(env.signal); if (!pdf.numPages || pdf.numPages > REDACTION_LIMITS.pages || source.getPageCount() !== pdf.numPages) throw new RangeError('The PDF must have 1–10,000 consistent pages.'); return await work(source, pdf); }
  catch (error) { primaryError = error; throw error; }
  finally { env.signal?.removeEventListener('abort', abort); await destroyTask(task, env.signal, primaryError); }
}
async function planInput(source, pdf, value, env) {
  const lib = env.pdfLib, affected = new Set(value.masks.map((mask) => mask.pageIndex)), pages = [];
  if (value.masks.some((mask) => mask.pageIndex >= pdf.numPages)) throw new RangeError('A mask refers to a missing page.');
  let decodedBytes = 0, planBytes = JSON.stringify(value.masks).length, totalPixels = 0, searchable = false;
  if (value.mode === 'hybrid') inspectKeys(source.catalog, CATALOG_KEYS, 'Document catalog');
  for (let index = 0; index < pdf.numPages; index++) {
    check(env.signal); const proxy = await pdf.getPage(index + 1); check(env.signal);
    const page = source.getPage(index), shape = geometry(page, proxy, lib), masks = value.masks.filter((mask) => mask.pageIndex === index), visible = proxy.view;
    for (const mask of masks) if (mask.x < visible[0] - 1e-7 || mask.y < visible[1] - 1e-7 || mask.x + mask.width > visible[2] + 1e-7 || mask.y + mask.height > visible[3] + 1e-7) throw new RangeError('Every mask must lie inside its actual visible CropBox.');
    const raster = value.mode === 'raster' || affected.has(index), base = proxy.getViewport({ scale: 1 }), viewport = proxy.getViewport({ scale: value.scale });
    const width = Math.floor(viewport.width), height = Math.floor(viewport.height);
    if (raster && (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > REDACTION_LIMITS.dimension || height > REDACTION_LIMITS.dimension || width * height > REDACTION_LIMITS.pagePixels)) throw new RangeError('Requested raster resolution exceeds 4096 pixels per edge or 16 million pixels per page. Explicitly choose a lower resolution.');
    if (raster) { totalPixels += width * height; if (totalPixels > REDACTION_LIMITS.rasterPixels) throw new RangeError('Raster pages exceed the aggregate 48 million decoded-pixel budget. Explicitly choose a lower resolution or smaller document.'); }
    const pixelMasks = masks.map((mask) => maskPixels(mask, viewport, width, height));
    let fonts = new Map(), primitives = null;
    if (value.mode === 'hybrid') {
      inspectKeys(page.node, PAGE_KEYS, 'Page');
      const annotations = page.node.lookup(lib.PDFName.of('Annots'));
      if (annotations !== undefined && (!(annotations instanceof lib.PDFArray) || annotations.size())) failUnsupported('Page contains unsupported annotations or links. Choose explicit whole-document raster mode.');
      fonts = pageFonts(page, lib);
      if (!raster) {
        const decoded = await pageContent(page, lib, env.inflate || inflateRedactionStream, REDACTION_LIMITS.decodedDocumentBytes - decodedBytes, env.signal); decodedBytes += decoded.length;
        primitives = parseRedactionPrimitives(decoded, new Set(fonts.keys()), { maxOperators: REDACTION_LIMITS.pageOperators, maxPlanBytes: REDACTION_LIMITS.primitivePlanBytes - planBytes });
        planBytes += primitives.planBytes; searchable ||= primitives.hasText;
      }
    }
    planBytes += JSON.stringify(shape).length;
    if (planBytes > REDACTION_LIMITS.primitivePlanBytes) failUnsupported('The serialized redaction plan exceeds 16 MiB.');
    pages.push({ index, shape, raster, width, height, baseWidth: base.width, baseHeight: base.height, pixelMasks, fonts, primitives });
  }
  return { pages, decodedBytes, planBytes, totalPixels, searchable, affected: [...affected].sort((a, b) => a - b) };
}
function publicPlan(plan, value) {
  return { supported: true, mode: value.mode, scale: value.scale, pageCount: plan.pages.length, affectedPages: plan.affected, rasterPages: plan.pages.filter((page) => page.raster).map((page) => ({ pageIndex: page.index, width: page.width, height: page.height, pixels: page.width * page.height, dpi: 72 * value.scale })), totalPixels: plan.totalPixels, decodedBytes: plan.decodedBytes, serializedPlanBytes: plan.planBytes,
    capabilities: { encrypted: false, searchable: value.mode === 'hybrid' && plan.searchable, forms: false, rasterized: true }, boundary: { kind: 'raster-redaction', losses: [value.mode === 'raster' ? 'redaction-document-rasterized' : 'redaction-selected-pages-rasterized', 'redaction-metadata-removed'] } };
}

export async function inspectRedaction(bytes, supplied, env) {
  const value = options(supplied);
  try { return await withInput(bytes, env, async (source, pdf) => publicPlan(await planInput(source, pdf, value, env), value)); }
  catch (error) { check(env.signal); if (error.name !== 'RedactionUnsupportedError') throw error; return { supported: false, mode: value.mode, reason: error.message, fallback: 'raster' }; }
}

export async function redactPdf(bytes, supplied, env) {
  const value = options(supplied);
  return withInput(bytes, env, async (source, pdf) => {
    const plan = await planInput(source, pdf, value, env), summary = publicPlan(plan, value), lib = env.pdfLib;
    check(env.signal); const doc = await lib.PDFDocument.create({ updateMetadata: false }); check(env.signal); let encodedTotal = 0;
    for (const item of plan.pages) {
      check(env.signal); const page = freshPage(doc, item.shape, lib);
      if (!item.raster) {
        const names = new Map(); let serial = 0;
        for (const [original, base] of item.fonts) { const key = `F${serial++}`; names.set(original, key); page.node.setFontDictionary(lib.PDFName.of(key), doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: base, Encoding: 'WinAnsiEncoding' }))); }
        writeRedactionPrimitives(item.primitives, page, names, lib); item.primitives = null;
      } else {
        const proxy = await pdf.getPage(item.index + 1); check(env.signal); const canvas = env.canvasFactory();
        try {
          canvas.width = item.width; canvas.height = item.height;
          const viewport = proxy.getViewport({ scale: value.scale }), context = canvas.getContext('2d');
          const task = proxy.render({ canvasContext: context, viewport, background: '#ffffff' }); const abort = () => task.cancel(); env.signal?.addEventListener('abort', abort, { once: true });
          try { await task.promise; check(env.signal); } finally { env.signal?.removeEventListener('abort', abort); }
          context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; context.fillStyle = '#000000';
          for (const mask of item.pixelMasks) context.fillRect(mask.x, mask.y, mask.width, mask.height);
          const encoded = await env.encodeCanvas(canvas, 'image/png'); check(env.signal);
          if (!(encoded instanceof Uint8Array) || !encoded.length) throw new RangeError('The raster page could not be encoded.');
          encodedTotal += encoded.length;
          if (encodedTotal > REDACTION_LIMITS.outputBytes) throw new RangeError('Raster pages exceed the aggregate 96 MiB encoded output budget.');
          const image = await doc.embedPng(encoded); check(env.signal);
          if (image.width !== item.width || image.height !== item.height) throw new Error('Raster encoder dimensions do not match the verified page.');
          await image.embed(); check(env.signal);
          // Installed PageViewport inverse plus verified shared visualTransform
          // maps displayed pixels into the preserved default-user-space boxes.
          page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(...visualTransform(proxy.getViewport({ scale: 1 }))));
          // The requested viewport may be fractional while the backing canvas
          // is floored. Preserve one source pixel per requested-scale pixel:
          // anchor at visual top-left instead of stretching to the full box.
          const imageWidth = item.width / value.scale, imageHeight = item.height / value.scale;
          page.drawImage(image, { x: 0, y: item.baseHeight - imageHeight, width: imageWidth, height: imageHeight }); page.pushOperators(lib.popGraphicsState());
        } finally { canvas.width = canvas.height = 0; proxy.cleanup(); }
      }
      env.onProgress?.({ completed: item.index + 1, total: plan.pages.length });
      await new Promise((resolve) => setTimeout(resolve, 0)); check(env.signal);
    }
    const output = new Uint8Array(await doc.save({ useObjectStreams: true, updateFieldAppearances: false })); check(env.signal);
    if (output.length > REDACTION_LIMITS.outputBytes) throw new RangeError('The redacted PDF exceeds 96 MiB. Choose a lower resolution or smaller document.');
    const reopened = await lib.PDFDocument.load(output.slice(), { updateMetadata: false, throwOnInvalidObject: true }); check(env.signal);
    const allPages = reopened.context.enumerateIndirectObjects().filter(([, object]) => object instanceof lib.PDFPageLeaf);
    if (reopened.getPageCount() !== plan.pages.length || allPages.length !== plan.pages.length || reopened.context.trailerInfo.Info || reopened.catalog.get(lib.PDFName.of('Metadata'))) throw new Error('The saved redaction did not pass fresh-document verification.');
    const verification = env.pdfjs.getDocument({ data: output.slice(), ...env.pdfjsAssets, stopAtErrors: true });
    const cancelVerification = () => { void verification.destroy().catch(() => {}); }; env.signal?.addEventListener('abort', cancelVerification, { once: true });
    let verificationError;
    try {
      const verified = await verification.promise; check(env.signal);
      if (verified.numPages !== plan.pages.length) throw new Error('The saved redaction page count changed.');
      for (const item of plan.pages) {
        const proxy = await verified.getPage(item.index + 1); check(env.signal); const base = proxy.getViewport({ scale: 1 });
        if (Math.abs(base.width - item.baseWidth) > 1e-7 || Math.abs(base.height - item.baseHeight) > 1e-7 || JSON.stringify(geometry(reopened.getPage(item.index), proxy, lib)) !== JSON.stringify(item.shape)) throw new Error('The saved redaction page geometry changed.');
        if (item.index === 0 || item.index === plan.pages.length - 1) {
          const canvas = env.canvasFactory();
          try {
            const scale = Math.min(1, 1200 / Math.max(base.width, base.height), Math.sqrt(2000000 / (base.width * base.height))), viewport = proxy.getViewport({ scale });
            canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
            const render = proxy.render({ canvasContext: canvas.getContext('2d'), viewport }); const cancel = () => render.cancel(); env.signal?.addEventListener('abort', cancel, { once: true });
            try { await render.promise; check(env.signal); } finally { env.signal?.removeEventListener('abort', cancel); }
          } finally { canvas.width = canvas.height = 0; proxy.cleanup(); }
        }
      }
    } catch (error) { verificationError = error; throw error; }
    finally { env.signal?.removeEventListener('abort', cancelVerification); await destroyTask(verification, env.signal, verificationError); }
    return { ...summary, bytes: output, type: 'application/pdf' };
  });
}
