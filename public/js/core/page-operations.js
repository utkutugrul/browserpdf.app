import { validatePagePlan, createPagePlan, rotatePageGroup, cropPageGroup } from './page-plan.js';
import { normalizePageSelection } from './page-selection.js';

export const MAX_PAGE_OPERATION_BYTES = 250 * 1024 * 1024;

function abort(signal) { signal?.throwIfAborted(); }
function ownedBytes(value) {
  if (!(value instanceof Uint8Array) || !value.length || value.length > MAX_PAGE_OPERATION_BYTES) throw new RangeError('Choose non-empty PDF inputs smaller than 250 MB.');
  return value.slice();
}
function runtime(pdfLib) {
  if (!pdfLib?.PDFDocument || !pdfLib?.PDFName || !pdfLib?.PDFDict || !pdfLib?.degrees) throw new TypeError('A pdf-lib runtime is required.');
  return pdfLib;
}

export function inspectPageOperationStructures(doc, pdfLib) {
  const key = (value) => pdfLib.PDFName.of(value), has = (name) => doc.catalog.has(key(name));
  let signatures = false, incomplete = false;
  const objects = doc.context.enumerateIndirectObjects();
  for (let index = 0; index < Math.min(objects.length, 50000); index++) {
    const object = objects[index][1];
    if (object instanceof pdfLib.PDFDict && (object.get(key('FT')) === key('Sig') || object.get(key('Type')) === key('Sig'))) { signatures = true; break; }
  }
  incomplete = objects.length > 50000;
  return Object.freeze({ forms: has('AcroForm'), outlines: has('Outlines'), tags: has('StructTreeRoot'), names: has('Names'), pageLabels: has('PageLabels'), signatures: signatures || has('Perms'), incomplete });
}

function boundaryFor(kind, structures) {
  const losses = [];
  if (kind === 'page-copy') {
    losses.push('page-copy-structures-unverified');
    losses.push('page-copy-document-metadata');
    if (structures.some((item) => item.forms)) losses.push('page-copy-form-definitions');
    if (structures.some((item) => item.outlines)) losses.push('page-copy-bookmarks');
    if (structures.some((item) => item.tags)) losses.push('page-copy-tags');
    if (structures.some((item) => item.names)) losses.push('page-copy-named-resources');
    if (structures.some((item) => item.pageLabels)) losses.push('page-copy-labels');
  }
  losses.push('signature-rewrite');
  if (structures.some((item) => item.incomplete)) losses.push('structure-inspection-incomplete');
  return Object.freeze({ kind, losses: Object.freeze(losses) });
}

function checkCrop(page, crop) {
  if (!crop) return;
  const visible = page.getCropBox(), epsilon = 0.001;
  if (crop.x < visible.x - epsilon || crop.y < visible.y - epsilon || crop.x + crop.width > visible.x + visible.width + epsilon || crop.y + crop.height > visible.y + visible.height + epsilon) {
    throw new RangeError('The crop box must stay within the source page’s visible box.');
  }
}

function editPage(page, entry, pdfLib) {
  if (entry.rotation) page.setRotation(pdfLib.degrees(((page.getRotation().angle + entry.rotation) % 360 + 360) % 360));
  if (entry.crop) { checkCrop(page, entry.crop); page.setCropBox(entry.crop.x, entry.crop.y, entry.crop.width, entry.crop.height); }
}

// The same executor powers merge/split/organize and selected page rotation/crop.
// Source inputs remain immutable. A caller owns review/adoption/download policy.
export async function applyPagePlan(inputs, inputPlan, { pdfLib, signal, onProgress } = {}) {
  runtime(pdfLib); abort(signal);
  const plan = validatePagePlan(inputPlan);
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 20) throw new RangeError('Choose between 1 and 20 PDF sources.');
  const sources = new Map(); let total = 0;
  for (const input of inputs) {
    if (!input || sources.has(input.id)) throw new TypeError('Input source IDs must be unique.');
    if (!(input.bytes instanceof Uint8Array) || !input.bytes.length || input.bytes.length > MAX_PAGE_OPERATION_BYTES) throw new RangeError('Choose non-empty PDF inputs smaller than 250 MB.');
    total += input.bytes.length;
    if (total > MAX_PAGE_OPERATION_BYTES) throw new RangeError('The combined PDF sources are limited to 250 MB.');
    sources.set(input.id, { bytes: input.bytes });
  }
  for (const input of sources.values()) input.bytes = input.bytes.slice();
  const usedIds = [...new Set(plan.pages.map((entry) => entry.sourceId))], structures = [];
  for (let index = 0; index < usedIds.length; index++) {
    abort(signal);
    const id = usedIds[index], input = sources.get(id), expected = plan.sources.find((item) => item.id === id);
    if (!input) throw new RangeError(`The source ${id} is unavailable.`);
    onProgress?.({ phase: 'loading', percent: Math.round(index / usedIds.length * 20), sourceIndex: index, sourceCount: usedIds.length });
    abort(signal);
    input.doc = await pdfLib.PDFDocument.load(input.bytes.slice(), { ignoreEncryption: false, updateMetadata: false });
    abort(signal);
    if (input.doc.getPageCount() !== expected.pageCount) throw new RangeError('The page plan no longer matches its source document.');
    structures.push(inspectPageOperationStructures(input.doc, pdfLib));
  }
  const single = usedIds.length === 1 ? sources.get(usedIds[0]) : null;
  const originalOrder = single && plan.pages.length === single.doc.getPageCount() && plan.pages.every((entry, index) => entry.pageIndex === index);
  const kind = originalOrder ? 'pdf-rewrite' : 'page-copy';
  const output = originalOrder ? single.doc : await pdfLib.PDFDocument.create();
  abort(signal);
  if (originalOrder) {
    for (let index = 0; index < plan.pages.length; index++) {
      abort(signal); editPage(output.getPage(index), plan.pages[index], pdfLib);
      onProgress?.({ phase: 'page', percent: 20 + Math.round((index + 1) / plan.pages.length * 65), page: index + 1, pageCount: plan.pages.length });
    }
  } else {
    const copiedById = new Map();
    for (const sourceId of usedIds) {
      abort(signal);
      const entries = plan.pages.filter((entry) => entry.sourceId === sourceId);
      const copied = await output.copyPages(sources.get(sourceId).doc, entries.map((entry) => entry.pageIndex));
      abort(signal);
      copied.forEach((page, index) => copiedById.set(entries[index].id, page));
    }
    for (let index = 0; index < plan.pages.length; index++) {
      abort(signal); const entry = plan.pages[index], page = copiedById.get(entry.id);
      editPage(page, entry, pdfLib); output.addPage(page);
      onProgress?.({ phase: 'page', percent: 20 + Math.round((index + 1) / plan.pages.length * 65), page: index + 1, pageCount: plan.pages.length });
    }
  }
  abort(signal); onProgress?.({ phase: 'saving', percent: 90 }); abort(signal);
  const bytes = ownedBytes(await output.save()); abort(signal);
  const verified = await pdfLib.PDFDocument.load(bytes.slice(), { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true });
  abort(signal);
  if (verified.getPageCount() !== plan.pages.length) throw new Error('The output page count could not be verified.');
  // An empty AcroForm dictionary can remain after flattening. Capabilities refer
  // to real output fields, while structure-loss detection still records catalogs.
  const capabilities = { encrypted: false };
  try { capabilities.forms = verified.getForm().getFields().length > 0; }
  catch { /* Unknown/malformed fields have no verified interactive capability. */ }
  const boundary = boundaryFor(kind, structures);
  const losses = [...boundary.losses];
  if (plan.pages.some((entry) => entry.crop)) losses.push('crop-hidden-content');
  onProgress?.({ phase: 'done', percent: 100 }); abort(signal);
  return {
    bytes, boundary: { kind, losses }, structures, capabilities,
    pageMap: plan.pages.map((entry, outputIndex) => ({ id: entry.id, sourceId: entry.sourceId, pageIndex: entry.pageIndex, outputIndex })),
    summary: { pageCount: plan.pages.length, sourceCount: usedIds.length, rotatedPages: plan.pages.filter((entry) => entry.rotation).length, croppedPages: plan.pages.filter((entry) => entry.crop).length },
  };
}

export async function rotatePdfPages(bytes, { pages, degrees = 90, pageCount }, context) {
  const plan = createPagePlan({ sourceId: 'source', pageCount });
  const selection = normalizePageSelection(pages, pageCount);
  return applyPagePlan([{ id: 'source', bytes }], rotatePageGroup(plan, selection.map((index) => plan.pages[index].id), degrees), context);
}

export async function cropPdfPages(bytes, { pages, box, pageCount }, context) {
  const plan = createPagePlan({ sourceId: 'source', pageCount });
  const selection = normalizePageSelection(pages, pageCount);
  return applyPagePlan([{ id: 'source', bytes }], cropPageGroup(plan, selection.map((index) => plan.pages[index].id), box), context);
}
