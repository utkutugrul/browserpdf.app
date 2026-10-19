// DOM-free image layout/writer. Adapters inject bytes, the PDF runtime and ownership.
export const COMPOSITION_IMAGE_LIMIT = 48;
export const COMPOSITION_OUTPUT_BYTES = 96 * 1024 * 1024;
export const COMPOSITION_DECODED_PIXELS = 48_000_000;
const PAPERS = Object.freeze({ a4: [595.275590551, 841.88976378], letter: [612, 792] });

export function normalizedPngDimensions(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') throw new TypeError('A valid normalized PNG header is required.');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = header.getUint32(16), height = header.getUint32(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16_000_000) throw new RangeError('Normalized PNGs are limited to 4096 pixels per edge and 16 million pixels.');
  return { width, height };
}

export function compositionPageLayout(state, item) {
  if (!state || !['image', 'a4', 'letter'].includes(state.paper) || !['portrait', 'landscape'].includes(state.orientation) || !Number.isFinite(state.margin) || state.margin < 0 || state.margin > 72) throw new RangeError('Choose Image, A4 or Letter paper and a margin from 0 to 72 points.');
  if (!item || ![0, 90, 180, 270].includes(item.rotation) || !['fit', 'fill'].includes(item.fit) || !Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height) || item.width < 1 || item.height < 1 || item.width > 4096 || item.height > 4096 || item.width * item.height > 16_000_000) throw new RangeError('Invalid normalized image dimensions or layout.');
  const swapped = item.rotation % 180 !== 0, width = swapped ? item.height : item.width, height = swapped ? item.width : item.height;
  let pageWidth, pageHeight;
  if (state.paper === 'image') { const scale = 842 / Math.max(width, height); pageWidth = width * scale; pageHeight = height * scale; }
  else { [pageWidth, pageHeight] = PAPERS[state.paper]; if (state.orientation === 'landscape') [pageWidth, pageHeight] = [pageHeight, pageWidth]; }
  const innerWidth = pageWidth - state.margin * 2, innerHeight = pageHeight - state.margin * 2;
  if (innerWidth <= 0 || innerHeight <= 0) throw new RangeError('This margin leaves no image area. Reduce the margin or choose fixed paper.');
  const scale = (item.fit === 'fill' ? Math.max : Math.min)(innerWidth / width, innerHeight / height);
  const displayWidth = width * scale, displayHeight = height * scale;
  const left = state.margin + (innerWidth - displayWidth) / 2, bottom = state.margin + (innerHeight - displayHeight) / 2;
  // UI rotations are clockwise; PDF drawImage rotations are counterclockwise.
  const [x, y] = item.rotation === 90 ? [left, bottom + displayHeight] : item.rotation === 180 ? [left + displayWidth, bottom + displayHeight] : item.rotation === 270 ? [left + displayWidth, bottom] : [left, bottom];
  return { pageWidth, pageHeight, clip: { x: state.margin, y: state.margin, width: innerWidth, height: innerHeight }, image: { x, y, width: item.width * scale, height: item.height * scale, rotation: -item.rotation }, display: { x: left, y: bottom, width: displayWidth, height: displayHeight } };
}

export async function composeImagesPdf(state, { resource, pdfLib, signal, onProgress } = {}) {
  signal?.throwIfAborted();
  if (!Array.isArray(state?.items) || !state.items.length || state.items.length > COMPOSITION_IMAGE_LIMIT || new Set(state.items.map((item) => item.id)).size !== state.items.length) throw new RangeError('Choose between 1 and 48 images.');
  const layouts = state.items.map((item) => compositionPageLayout(state, item));
  const unique = new Map(state.items.map((item) => [item.assetId, item.width * item.height]));
  if ([...unique.values()].reduce((sum, pixels) => sum + pixels, 0) > COMPOSITION_DECODED_PIXELS) throw new RangeError('These images exceed the 48 million decoded-pixel PDF budget. Remove images or create smaller separate PDFs.');
  const assets = new Map(); let encodedBytes = 0;
  for (const item of state.items) {
    if (!assets.has(item.assetId)) {
      const asset = await resource(item.assetId); signal?.throwIfAborted();
      if (!asset || asset.type !== 'image/png' || !(asset.bytes instanceof Uint8Array) || !asset.bytes.length || asset.bytes.length > 16 * 1024 * 1024) throw new RangeError('A normalized PNG is unavailable or exceeds 16 MiB. Reopen this image task.');
      encodedBytes += asset.bytes.length;
      if (encodedBytes > 48 * 1024 * 1024) throw new RangeError('Normalized PNGs exceed 48 MiB.');
      assets.set(item.assetId, { ...asset, ...normalizedPngDimensions(asset.bytes) });
    }
    const asset = assets.get(item.assetId);
    if (asset.width !== item.width || asset.height !== item.height) throw new Error('The normalized PNG header does not match the saved image dimensions.');
  }
  const doc = await pdfLib.PDFDocument.create(); signal?.throwIfAborted();
  // Stable metadata makes repeated exports of unchanged edit state identical.
  doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0)); doc.setProducer('BrowserPDF'); doc.setCreator('BrowserPDF');
  const embedded = new Map();
  for (const [index, item] of state.items.entries()) {
    signal?.throwIfAborted();
    if (!embedded.has(item.assetId)) {
      const asset = assets.get(item.assetId); signal?.throwIfAborted();
      const image = await doc.embedPng(asset.bytes.slice()); signal?.throwIfAborted();
      if (image.width !== item.width || image.height !== item.height) throw new Error('The normalized image dimensions do not match the saved composition.');
      // PDFImage.embed() is public and releases its native PNG embedder. The
      // PDF context still retains channel data, covered by the aggregate bound.
      await image.embed(); signal?.throwIfAborted();
      embedded.set(item.assetId, image);
      assets.delete(item.assetId);
    }
    const layout = layouts[index], page = doc.addPage([layout.pageWidth, layout.pageHeight]), box = layout.clip;
    // Installed pdf-lib api/operators.d.ts: rectangle, clip, endPath and saved graphics state.
    page.pushOperators(pdfLib.pushGraphicsState(), pdfLib.rectangle(box.x, box.y, box.width, box.height), pdfLib.clip(), pdfLib.endPath());
    const { rotation, ...placement } = layout.image;
    page.drawImage(embedded.get(item.assetId), { ...placement, rotate: pdfLib.degrees(rotation) });
    page.pushOperators(pdfLib.popGraphicsState());
    onProgress?.({ completed: index + 1, total: state.items.length, percent: Math.round((index + 1) / state.items.length * 90) });
    await new Promise((resolve) => setTimeout(resolve, 0)); signal?.throwIfAborted();
  }
  const bytes = new Uint8Array(await doc.save({ useObjectStreams: true })); signal?.throwIfAborted();
  if (bytes.length > COMPOSITION_OUTPUT_BYTES) throw new RangeError('The PDF exceeds 96 MiB. Remove images or start a smaller task.');
  const verified = await pdfLib.PDFDocument.load(bytes.slice(), { updateMetadata: false, throwOnInvalidObject: true }); signal?.throwIfAborted();
  if (verified.getPageCount() !== state.items.length || verified.getPages().some((page, index) => Math.abs(page.getWidth() - layouts[index].pageWidth) > .001 || Math.abs(page.getHeight() - layouts[index].pageHeight) > .001)) throw new Error('The saved image PDF could not be verified.');
  return { bytes, type: 'application/pdf', capabilities: { encrypted: false, searchable: false, forms: false, rasterized: true } };
}
