'use strict';

import { scanPdfPrivacy, withPdfDocument } from './privacy-scan.js';
import { removeStandardMetadata } from './metadata-cleanup.js';
import { renderBoundedPage } from './bounded-renderer.js';

const INFO_KEYS = Object.freeze(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate']);
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason').get;
const apply = Reflect.apply;
function check(signal) { if (signal != null && apply(aborted, signal, [])) throw apply(reason, signal, []); }
function standardKeys(doc, pdfLib) {
  const ref = doc.context.trailerInfo.Info; if (!ref) return [];
  const dict = doc.context.lookup(ref); if (!(dict instanceof pdfLib.PDFDict)) throw new Error('The PDF information dictionary could not be inspected.');
  const keys = new Set(dict.keys().map(key => key.toString()));
  return INFO_KEYS.filter(key => keys.has('/' + key));
}
async function inspectStandardInfo(bytes, pdfLib, signal) {
  const doc = await pdfLib.PDFDocument.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false }); check(signal);
  return { fields: standardKeys(doc, pdfLib), pageCount: doc.getPageCount() };
}

export const SUPPORTED_PRIVACY_CLEANUP = Object.freeze(['standard-metadata']);

function assertCategories(categories) {
  if (!Array.isArray(categories) || categories.length !== 1 || categories[0] !== 'standard-metadata') {
    throw new TypeError('Only standard-metadata cleanup is supported.');
  }
}

function preservedSnapshot(report) {
  return JSON.stringify({
    xmp: report.xmp,
    catalogAttachments: report.catalogAttachments,
    pageAttachments: report.pageAttachments,
    annotations: report.annotations,
    linksAndActions: report.linksAndActions,
    javascript: report.javascript,
    forms: report.forms,
    invisibleText: report.invisibleText,
    sensitiveText: {
      count: report.sensitiveText.count,
      truncated: report.sensitiveText.truncated,
      categories: report.sensitiveText.categories,
    },
  });
}

async function verifyRepresentativeRender(bytes, { pdfjs, pdfjsAssets, createCanvas, signal, inspectPdf }) {
  if (typeof createCanvas !== 'function') throw new TypeError('A canvas factory is required for output verification.');
  await inspectPdf(pdfjs, bytes, { pdfjsAssets, signal }, async doc => {
    if (doc.numPages < 1) throw new Error('The cleaned PDF has no pages.');
    const page = await doc.getPage(1); check(signal);
    const canvas = createCanvas(1, 1);
    try { await renderBoundedPage(page, canvas, { signal, scale: 0.5, maxDimension: 900, maxPixels: 4000000 }); check(signal); }
    finally { canvas.width = canvas.height = 0; }
  });
}

export async function cleanPdfPrivacy(inputBytes, {
  categories,
  pdfLib,
  pdfjs,
  pdfjsAssets = {},
  createCanvas,
  signal,
  onProgress,
  limits,
  inspectPdf = withPdfDocument,
} = {}) {
  assertCategories(categories);
  if (typeof inspectPdf !== 'function') throw new TypeError('A PDF inspector is required.');
  if (!pdfLib?.PDFDocument || !pdfLib?.PDFName || !pdfLib?.PDFDict) throw new TypeError('A pdf-lib runtime is required.');
  const original = Uint8Array.from(inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes));
  check(signal);
  const before = await scanPdfPrivacy(original, { pdfjs, pdfjsAssets, signal, limits, inspectPdf });
  if (before.encryption.locked) throw new Error('Locked PDFs cannot be cleaned without a password.');
  if (!before.inspection.complete) throw new Error('Some required source observations are unknown or partial. A verified cleaned copy is unavailable.');
  const source = await inspectStandardInfo(original, pdfLib, signal), removedFields = source.fields;
  if (source.pageCount !== before.pageCount) throw new Error('Source page-count verification failed.');
  onProgress?.({ phase: 'clean' }); check(signal);

  const output = await removeStandardMetadata(original, pdfLib, { signal });
  check(signal);

  const reopened = await inspectStandardInfo(output, pdfLib, signal);
  if (reopened.fields.length) throw new Error('Standard Info key absence verification failed.');
  if (reopened.pageCount !== before.pageCount) throw new Error('Output page-count verification failed.');
  await verifyRepresentativeRender(output, { pdfjs, pdfjsAssets, createCanvas, signal, inspectPdf });
  onProgress?.({ phase: 'rescan' });
  const after = await scanPdfPrivacy(output, { pdfjs, pdfjsAssets, signal, limits, inspectPdf });
  check(signal);
  if (!after.inspection.complete) throw new Error('Some required result observations are unknown or partial. A verified cleaned copy is unavailable.');
  if (after.standardMetadata.count !== 0) throw new Error('Standard metadata cleanup verification failed.');
  if (preservedSnapshot(before) !== preservedSnapshot(after)) {
    throw new Error('Cleanup changed a category that was not selected.');
  }

  const warnings = [];
  if (before.forms.signatureFields) {
    warnings.push('A signature field was detected. Rewriting this PDF can invalidate an existing digital signature.');
  }
  return {
    bytes: output,
    before,
    report: after,
    verification: { standardInfoAbsent: true, sourceInfoFields: removedFields, pageCountUnchanged: true, representativePage: 1, comparedCategories: ['xmp', 'attachments', 'annotations', 'links-and-actions', 'javascript', 'forms', 'detectable-invisible-text', 'sensitive-text'], unverifiedCategories: [] },
    lossManifest: {
      categories: ['standard-metadata'],
      removedFields,
      removedCount: removedFields.length,
      preservedCategories: [
        'xmp', 'attachments', 'annotations', 'links-and-actions', 'javascript',
        'forms', 'detectable-invisible-text', 'sensitive-text',
      ],
      warnings,
      verified: true,
    },
  };
}
