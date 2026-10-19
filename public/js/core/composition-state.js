// Finite image-composition state shared by the session and both image routes.
export const COMPOSITION_LIMITS = Object.freeze({ entries: 48, pending: 16, originals: 48, assets: 48, rawBytes: 48 * 1024 * 1024, normalizedBytes: 48 * 1024 * 1024, imageBytes: 16 * 1024 * 1024, dimension: 4096, pixels: 16000000 });
const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
const ref = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}-[a-zA-Z0-9-]{1,80}$`).test(value);
const name = (value) => typeof value === 'string' && value.length > 0 && value.length <= 260 && !/[\u0000-\u001f]/.test(value);

export function imageDimensions(bytes, type) {
  let width, height;
  if (type === 'image/png' && bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v) && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); width = view.getUint32(16); height = view.getUint32(20);
  } else if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) { height = bytes[offset + 3] * 256 + bytes[offset + 4]; width = bytes[offset + 5] * 256 + bytes[offset + 6]; break; }
      offset += length;
    }
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > COMPOSITION_LIMITS.dimension || height > COMPOSITION_LIMITS.dimension || width * height > COMPOSITION_LIMITS.pixels) throw new RangeError('Choose a valid PNG/JPEG at most 4096 pixels per edge and 16 million pixels.');
  return { width, height };
}

export function safeComposition(value) {
  if (value == null) return null;
  if (value.version !== 1 || !Array.isArray(value.items) || value.items.length > COMPOSITION_LIMITS.entries || !['image', 'a4', 'letter'].includes(value.paper) || !['portrait', 'landscape'].includes(value.orientation) || !Number.isFinite(value.margin) || value.margin < 0 || value.margin > 72) throw new RangeError('Invalid image composition or paper settings.');
  const ids = new Set();
  const items = value.items.map((item) => {
    if (!id(item.id) || ids.has(item.id) || !ref(item.originalRef, 'source') || !ref(item.assetId, 'asset') || !Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width < 1 || item.height < 1 || item.width > 4096 || item.height > 4096 || item.width * item.height > 16000000 || ![0,90,180,270].includes(item.rotation) || !['fit', 'fill'].includes(item.fit)) throw new Error('Invalid composition image.');
    if (item.name !== undefined && (typeof item.name !== 'string' || !item.name.length || item.name.length > 260 || /[\u0000-\u001f]/.test(item.name))) throw new Error('Invalid composition image name (at most 260 characters).');
    ids.add(item.id);
    const rotated = item.rotation % 180 !== 0, width = rotated ? item.height : item.width, height = rotated ? item.width : item.height;
    if (value.paper === 'image' && Math.min(width, height) * 842 / Math.max(width, height) <= value.margin * 2) throw new RangeError('Margins leave no room for this image. Reduce the margin.');
    return { id: item.id, originalRef: item.originalRef, assetId: item.assetId, width: item.width, height: item.height, rotation: item.rotation, fit: item.fit, ...(item.name === undefined ? {} : { name:item.name }) };
  });
  if (value.selectedId !== null && !ids.has(value.selectedId)) throw new Error('Invalid selected composition image.');
  return { version: 1, items, paper: value.paper, orientation: value.orientation, margin: value.margin, selectedId: value.selectedId };
}

export function safeCompositionSources(value) {
  if (value == null) return null;
  if (value.version !== 1 || !Array.isArray(value.originals) || !value.originals.length || value.originals.length > COMPOSITION_LIMITS.originals) throw new RangeError('A task retains at most 48 original images. Start a new task to release its originals.');
  const ids = new Set();
  const originals = value.originals.map((item) => {
    if (!ref(item.originalRef, 'source') || ids.has(item.originalRef) || !name(item.name) || !['image/png', 'image/jpeg'].includes(item.type)) throw new Error('Invalid original image group.');
    ids.add(item.originalRef); return { originalRef: item.originalRef, name: item.name, type: item.type };
  });
  return { version: 1, originals };
}

export function validateCompositionResources(sources, states, resources) {
  const originals = new Set(sources?.originals.map((item) => item.originalRef) || []), assets = new Set();
  let rawBytes = 0, normalizedBytes = 0;
  for (const item of sources?.originals || []) {
    const resource = resources.get(item.originalRef);
    if (!resource || resource.type !== item.type || !resource.bytes.length || resource.bytes.length > COMPOSITION_LIMITS.imageBytes) throw new Error('An original image is missing or exceeds 16 MB.');
    imageDimensions(resource.bytes, resource.type); rawBytes += resource.bytes.length;
  }
  for (const state of states.filter(Boolean)) for (const item of state.items) {
    const asset = resources.get(item.assetId);
    if (!originals.has(item.originalRef) || !asset || asset.type !== 'image/png' || !asset.bytes.length || asset.bytes.length > COMPOSITION_LIMITS.imageBytes) throw new Error('A normalized composition image is missing or exceeds 16 MB.');
    const dimensions = imageDimensions(asset.bytes, asset.type);
    if (dimensions.width !== item.width || dimensions.height !== item.height) throw new Error('Normalized image dimensions do not match its composition.');
    assets.add(item.assetId);
  }
  for (const key of assets) normalizedBytes += resources.get(key).bytes.length;
  if (assets.size > COMPOSITION_LIMITS.assets || rawBytes > COMPOSITION_LIMITS.rawBytes || normalizedBytes > COMPOSITION_LIMITS.normalizedBytes) throw new RangeError('Retained image originals or normalized images exceed the 48-image/48 MB limit. Start a new task to release originals.');
  return { rawBytes, normalizedBytes };
}
