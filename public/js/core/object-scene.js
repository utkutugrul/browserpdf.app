import { embedUnicodeFont } from './pdf-fonts.js';
import { visualTransform } from './page-geometry.js';

export function formModel(doc, lib) {
  const pages = doc.getPages();
  return doc.getForm().getFields().map((field) => {
    const password = typeof field.isPassword === 'function' && field.isPassword();
    const kind = password ? 'unsupported' : field instanceof lib.PDFTextField ? 'text' : field instanceof lib.PDFCheckBox ? 'checkbox' : field instanceof lib.PDFDropdown ? 'dropdown' : field instanceof lib.PDFRadioGroup ? 'radio' : field instanceof lib.PDFOptionList ? 'optionlist' : 'unsupported';
    let value = kind === 'text' ? field.getText() || '' : kind === 'checkbox' ? field.isChecked() : ['dropdown', 'optionlist'].includes(kind) ? field.getSelected() : kind === 'radio' ? field.getSelected() || '' : '';
    const widgets = field.acroField.getWidgets().map((widget) => {
      let page = pages.findIndex((page) => page.ref === widget.P());
      if (page < 0) {
        const ref = doc.context.getObjectRef(widget.dict);
        const found = ref && doc.findPageForAnnotationRef(ref);
        page = pages.indexOf(found);
      }
      return { pageIndex: page, ...widget.getRectangle() };
    });
    return { name: field.getName(), kind, value, password, options: typeof field.getOptions === 'function' ? field.getOptions() : [], widgets, readOnly: field.isReadOnly() };
  });
}

// Every export starts from the same immutable scene source. Applying the same
// objects a second time cannot stamp them twice into their own baked result.
export async function renderScenePdf({ scene, resource, pdfLib, pdfjs, pdfjsAssets = {}, signal, onFieldError }) {
  signal?.throwIfAborted();
  const source = resource(scene.sourceRef);
  if (!source) throw new Error('The editable source is unavailable. Reopen the task.');
  const doc = await pdfLib.PDFDocument.load(source.bytes.slice(), { updateMetadata: false });
  const form = doc.getForm();
  for (const [name, data] of Object.entries(scene.fields)) {
    try {
      const field = form.getField(name);
      if (data.kind === 'text') field.setText(data.value);
      else if (data.kind === 'checkbox') data.value ? field.check() : field.uncheck();
      else if (['dropdown', 'optionlist', 'radio'].includes(data.kind)) {
        if (data.value?.length) field.select(data.value);
        else if (typeof field.clear === 'function') field.clear();
      }
    } catch (error) { onFieldError?.(name, error); throw new Error(`${name}: ${error.message}`); }
  }
  if (Object.keys(scene.fields).length || scene.flatten) {
    const values = scene.flatten ? formModel(doc, pdfLib).filter((field) => !field.password && field.kind !== 'unsupported').map((field) => ({kind:field.kind,value:field.value})) : Object.values(scene.fields);
    const text = values.filter((f) => f.kind !== 'checkbox').map((f) => Array.isArray(f.value) ? f.value.join('\n') : f.value || '').join('\n');
    form.updateFieldAppearances(await embedUnicodeFont(doc, { text, signal }));
  }
  if (scene.flatten) {
    try { form.flatten({ updateFieldAppearances: false }); }
    catch (error) { throw new Error(`The form could not be flattened. No result was created: ${error.message}`); }
  }
  const task = pdfjs.getDocument({ data: source.bytes.slice(), ...pdfjsAssets });
  const cancel = () => { void task.destroy().catch(() => {}); }; signal?.addEventListener('abort', cancel, { once: true });
  try {
    const pdf = await task.promise; signal?.throwIfAborted();
    const viewports = new Map(); const embedded = new Map();
    for (const object of scene.objects) {
      signal?.throwIfAborted();
      const page = doc.getPages()[object.pageIndex];
      if (!page) throw new Error('An object refers to a missing page.');
      if (!viewports.has(object.pageIndex)) viewports.set(object.pageIndex, (await pdf.getPage(object.pageIndex + 1)).getViewport({ scale: 1 }));
      const viewport = viewports.get(object.pageIndex);
      page.pushOperators(pdfLib.pushGraphicsState(), pdfLib.concatTransformationMatrix(...visualTransform(viewport)));
      if (object.kind === 'text') {
        const font = await embedUnicodeFont(doc, { text: object.text, weight: object.weight || 'regular', signal });
        for (const [index, line] of object.text.split('\n').entries()) if (line) page.drawText(line, { x: object.x, y: viewport.height - object.y - object.fontSize - index * object.fontSize * 1.2, size: object.fontSize, font, color: pdfLib.rgb(...object.color) });
      } else if (['image', 'signature'].includes(object.kind)) {
        if (!embedded.has(object.assetId)) {
          const asset = resource(object.assetId);
          if (!asset) throw new Error('An object image is unavailable.');
          embedded.set(object.assetId, asset.type === 'image/jpeg' ? await doc.embedJpg(asset.bytes) : await doc.embedPng(asset.bytes));
        }
        page.drawImage(embedded.get(object.assetId), { x: object.x, y: viewport.height - object.y - object.height, width: object.width, height: object.height, opacity: object.opacity ?? 1 });
      }
      page.pushOperators(pdfLib.popGraphicsState());
    }
    const bytes = Uint8Array.from(await doc.save({ updateFieldAppearances: false }));
    signal?.throwIfAborted();
    const verified = await pdfLib.PDFDocument.load(bytes.slice(), { throwOnInvalidObject: true, updateMetadata: false });
    if (verified.getPageCount() !== pdf.numPages) throw new Error('Page count verification failed.');
    return { bytes, forms: verified.getForm().getFields().length > 0 };
  } catch (error) { if (signal?.aborted) signal.throwIfAborted(); throw error; }
  finally { signal?.removeEventListener('abort', cancel); try { await task.destroy(); } catch (error) { if (!signal?.aborted) throw error; } }
}

export async function imageAsset(file, { trim = false } = {}) {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 16 * 1024 * 1024) throw new Error('Choose a PNG or JPEG smaller than 16 MB.');
  const encoded = new Uint8Array(await file.arrayBuffer());
  let width, height;
  if (encoded.length >= 24 && encoded[0] === 137 && encoded[1] === 80 && encoded[2] === 78 && encoded[3] === 71) {
    const view = new DataView(encoded.buffer); width = view.getUint32(16); height = view.getUint32(20);
  } else if (encoded[0] === 255 && encoded[1] === 216) {
    let offset = 2;
    while (offset + 9 < encoded.length) {
      if (encoded[offset++] !== 255) break;
      while (encoded[offset] === 255) offset++;
      const marker = encoded[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = encoded[offset] * 256 + encoded[offset + 1];
      if (length < 2 || offset + length > encoded.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        height = encoded[offset + 3] * 256 + encoded[offset + 4]; width = encoded[offset + 5] * 256 + encoded[offset + 6]; break;
      }
      offset += length;
    }
  }
  if (!(width > 0 && height > 0) || width > 4096 || height > 4096 || width * height > 16_000_000) throw new RangeError('Choose a PNG or JPEG at most 4096 pixels wide or tall and 16 million pixels.');
  const bitmap = await createImageBitmap(new Blob([encoded], { type: file.type }), { imageOrientation: 'from-image' });
  try {
    if (bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width * bitmap.height > 16_000_000) throw new RangeError('Choose an image at most 4096 pixels wide or tall and 16 million pixels.');
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0);
    let left = 0, top = 0, right = canvas.width - 1, bottom = canvas.height - 1;
    if (trim) {
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      left = canvas.width; top = canvas.height; right = bottom = -1;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (data[i + 3] > 8 && (file.type !== 'image/jpeg' || Math.min(data[i], data[i + 1], data[i + 2]) < 245)) {
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      if (right < left) throw new Error('Draw, type, or upload a visible signature first.');
      left = Math.max(0, left - 3); top = Math.max(0, top - 3); right = Math.min(canvas.width - 1, right + 3); bottom = Math.min(canvas.height - 1, bottom + 3);
    }
    const cropped = document.createElement('canvas'); cropped.width = right - left + 1; cropped.height = bottom - top + 1;
    cropped.getContext('2d').drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    const blob = await new Promise((resolve, reject) => cropped.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image capture failed.')), 'image/png'));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: cropped.width, height: cropped.height, type: 'image/png', name: trim ? 'signature.png' : file.name };
  } finally { bitmap.close(); }
}
