'use strict';

import { deterministicOutputName } from './batch-queue.js';
import { getStarterRecipe, getWorkflowStep, materializeRecipe, PDF_MIME } from './workflow-manifest.js';
import { removeStandardMetadata } from './metadata-cleanup.js';

function abortError() {
  return new DOMException('Workflow cancelled.', 'AbortError');
}

function checkCancelled(context) {
  context.signal?.throwIfAborted();
  if (context.isCancelled?.()) throw abortError();
}

function validateParameters(definition, parameters) {
  const schema = definition.parameterSchema;
  const value = parameters || {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${definition.id} parameters must be an object.`);
  const unknown = Object.keys(value).filter((key) => !(key in schema.properties));
  if (unknown.length) throw new TypeError(`Unknown ${definition.id} parameter: ${unknown[0]}`);
  for (const required of schema.required || []) {
    if (!(required in value)) throw new TypeError(`Missing ${definition.id} parameter: ${required}`);
  }
  for (const [name, rule] of Object.entries(schema.properties)) {
    const candidate = value[name];
    if (candidate === undefined) continue;
    if (rule.type === 'string' && (typeof candidate !== 'string' || candidate.length < (rule.minLength || 0) || candidate.length > (rule.maxLength ?? Infinity))) throw new TypeError(`Invalid ${name}.`);
    if (rule.type === 'number' && (typeof candidate !== 'number' || candidate < rule.minimum || candidate > rule.maximum)) throw new TypeError(`Invalid ${name}.`);
    if (rule.type === 'integer' && (!Number.isInteger(candidate) || candidate < rule.minimum || candidate > rule.maximum)) throw new TypeError(`Invalid ${name}.`);
    if (rule.enum && !rule.enum.includes(candidate)) throw new TypeError(`Invalid ${name}.`);
  }
  return { ...definition.defaults, ...value };
}

async function compressRaster(bytes, parameters, context) {
  const { pdfjs, pdfLib, createCanvas, pdfjsAssets = {} } = context;
  if (!pdfjs || !pdfLib || !createCanvas) throw new Error('Compression runtime is unavailable.');
  const task = pdfjs.getDocument({ data: bytes.slice(), ...pdfjsAssets });
  const source = await task.promise;
  try {
    const output = await pdfLib.PDFDocument.create();
    for (let number = 1; number <= source.numPages; number++) {
      checkCancelled(context);
      const page = await source.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not rasterize a PDF page.')), 'image/jpeg', parameters.quality));
      const image = await output.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const outPage = output.addPage([base.width, base.height]);
      outPage.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
      context.onProgress?.({ phase: 'page', page: number, pageCount: source.numPages });
    }
    checkCancelled(context);
    return { bytes: await output.save() };
  } finally {
    await task.destroy();
  }
}

async function watermark(bytes, parameters, context) {
  const { pdfLib } = context;
  const doc = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
  const text = parameters.text.replace(/[^\x20-\x7e]/g, '').slice(0, 40);
  if (!text) throw new Error('Watermark must contain printable Latin characters.');
  const pages = doc.getPages();
  for (let index = 0; index < pages.length; index++) {
    checkCancelled(context);
    const page = pages[index];
    const { width, height } = page.getSize();
    const size = Math.max(18, Math.min(54, width / Math.max(5, text.length * 0.55)));
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: (width - textWidth) / 2, y: height / 2, size, font,
      color: pdfLib.rgb(0.55, 0.12, 0.12), opacity: parameters.opacity,
      rotate: pdfLib.degrees(30),
    });
    context.onProgress?.({ phase: 'page', page: index + 1, pageCount: pages.length });
  }
  return { bytes: await doc.save() };
}

async function protect(bytes, parameters, context) {
  const pdfLib = context.cantooPdfLib;
  if (!pdfLib?.PDFDocument) throw new Error('PDF encryption runtime is unavailable.');
  const doc = await pdfLib.PDFDocument.load(bytes);
  checkCancelled(context);
  doc.encrypt({
    userPassword: parameters.password,
    ownerPassword: parameters.password,
    permissions: { printing: 'highResolution', copying: false, modifying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false },
  });
  const output = await doc.save();
  let rejectedWithoutPassword = false;
  try { await pdfLib.PDFDocument.load(output); } catch (error) {
    rejectedWithoutPassword = Boolean(error && ((pdfLib.EncryptedPDFError && error instanceof pdfLib.EncryptedPDFError) || /encrypt|password/i.test(error.message)));
  }
  if (!rejectedWithoutPassword) throw new Error('Password protection verification failed.');
  const reopened = await pdfLib.PDFDocument.load(output, { password: parameters.password });
  if (reopened.getPageCount() !== doc.getPageCount()) throw new Error('Password protection verification failed.');
  return { bytes: output };
}

async function organize(bytes, parameters, context) {
  const { pdfLib } = context;
  const source = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  const output = await pdfLib.PDFDocument.create();
  const indices = source.getPageIndices();
  if (parameters.order === 'reverse') indices.reverse();
  const pages = await output.copyPages(source, indices);
  for (const page of pages) { checkCancelled(context); output.addPage(page); }
  return { bytes: await output.save() };
}

async function pageNumbers(bytes, parameters, context) {
  const { pdfLib } = context;
  const doc = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (let index = 0; index < pages.length; index++) {
    checkCancelled(context);
    const text = String(parameters.start + index);
    const page = pages[index];
    const { width } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, 11);
    const x = parameters.position === 'bottom-right' ? width - 28 - textWidth : (width - textWidth) / 2;
    page.drawText(text, { x, y: 28, size: 11, font, color: pdfLib.rgb(0.25, 0.25, 0.25) });
  }
  return { bytes: await doc.save() };
}

function readStandardMetadata(doc) {
  const safe = (getter) => { try { const value = getter(); return value == null ? '' : String(value); } catch { return ''; } };
  return {
    title: safe(() => doc.getTitle()), author: safe(() => doc.getAuthor()),
    subject: safe(() => doc.getSubject()), keywords: safe(() => doc.getKeywords()),
    creator: safe(() => doc.getCreator()), producer: safe(() => doc.getProducer()),
    creationDate: safe(() => doc.getCreationDate()?.toISOString()),
    modificationDate: safe(() => doc.getModificationDate()?.toISOString()),
  };
}

async function metadataScan(bytes, parameters, context) {
  const doc = await context.pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const fields = readStandardMetadata(doc);
  const present = Object.entries(fields).filter(([, value]) => value).map(([field]) => field);
  return { bytes, report: { scope: 'standard-document-info', present, count: present.length } };
}

async function metadataCleanup(bytes, parameters, context) {
  const { pdfLib } = context;
  checkCancelled(context);
  const output = await removeStandardMetadata(bytes, pdfLib, { signal: context.signal });
  checkCancelled(context);
  const verified = await pdfLib.PDFDocument.load(output, { ignoreEncryption: true, updateMetadata: false });
  const remaining = Object.values(readStandardMetadata(verified)).filter(Boolean);
  if (remaining.length) throw new Error('Standard metadata cleanup verification failed.');
  return { bytes: output, report: { scope: 'standard-document-info', removed: true } };
}

const PROCESSORS = {
  'compress-raster-v1': compressRaster,
  'watermark-text-v1': watermark,
  'protect-password-v1': protect,
  'organize-pages-v1': organize,
  'page-numbers-v1': pageNumbers,
  'privacy-metadata-scan-v1': metadataScan,
  'metadata-cleanup-v1': metadataCleanup,
};

export async function executeWorkflow({ bytes, name, recipeId, steps }, context = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5) throw new TypeError('PDF bytes are required.');
  const recipe = getStarterRecipe(recipeId);
  if (!recipe) throw new RangeError('Unknown workflow recipe.');
  const selectedSteps = steps || materializeRecipe(recipeId);
  if (selectedSteps.map((step) => step.id).join('|') !== recipe.stepIds.join('|')) throw new TypeError('Workflow steps do not match the selected recipe.');
  let current = bytes;
  let report = null;
  for (let index = 0; index < selectedSteps.length; index++) {
    checkCancelled(context);
    const selected = selectedSteps[index];
    const definition = getWorkflowStep(selected.id);
    if (!definition || !definition.accepts.includes(PDF_MIME) || !definition.produces.includes(PDF_MIME)) throw new TypeError('Unsupported workflow step.');
    const parameters = validateParameters(definition, selected.parameters);
    context.onStep?.(index + 1, definition);
    const result = await PROCESSORS[selected.id](current, parameters, context);
    current = result.bytes;
    if (result.report) report = { ...(report || {}), [selected.id]: result.report };
  }
  checkCancelled(context);
  return { bytes: current, name: deterministicOutputName(name, recipeId), report };
}
