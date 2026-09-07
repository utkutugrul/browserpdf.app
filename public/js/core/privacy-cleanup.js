'use strict';

import { scanPdfPrivacy, withPdfDocument } from './privacy-scan.js';
import { removeStandardMetadata } from './metadata-cleanup.js';

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

async function verifyRepresentativeRender(bytes, { pdfjs, pdfjsAssets, createCanvas, signal }) {
  if (typeof createCanvas !== 'function') throw new TypeError('A canvas factory is required for output verification.');
  await withPdfDocument(pdfjs, bytes, { pdfjsAssets, signal }, async (doc) => {
    if (doc.numPages < 1) throw new Error('The cleaned PDF has no pages.');
    const page = await doc.getPage(1);
    signal?.throwIfAborted();
    const viewport = page.getViewport({ scale: 0.5 });
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    const renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    const cancel = () => renderTask.cancel?.();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await renderTask.promise;
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
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
} = {}) {
  assertCategories(categories);
  if (!pdfLib?.PDFDocument || !pdfLib?.PDFName) throw new TypeError('A pdf-lib runtime is required.');
  const original = Uint8Array.from(inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes));
  signal?.throwIfAborted();
  const before = await scanPdfPrivacy(original, { pdfjs, pdfjsAssets, signal });
  if (before.encryption.locked) throw new Error('Locked PDFs cannot be cleaned without a password.');
  onProgress?.({ phase: 'clean' });

  const output = await removeStandardMetadata(original, pdfLib, { signal });
  signal?.throwIfAborted();

  const reopened = await pdfLib.PDFDocument.load(output.slice(), { ignoreEncryption: true, updateMetadata: false });
  if (reopened.getPageCount() !== before.pageCount) throw new Error('Output page-count verification failed.');
  await verifyRepresentativeRender(output, { pdfjs, pdfjsAssets, createCanvas, signal });
  onProgress?.({ phase: 'rescan' });
  const after = await scanPdfPrivacy(output, { pdfjs, pdfjsAssets, signal });
  if (after.standardMetadata.count !== 0) throw new Error('Standard metadata cleanup verification failed.');
  if (preservedSnapshot(before) !== preservedSnapshot(after)) {
    throw new Error('Cleanup changed a category that was not selected.');
  }

  const removedFields = before.standardMetadata.fields.slice(0, 8);
  const warnings = [];
  if (before.forms.signatureFields) {
    warnings.push('A signature field was detected. Rewriting this PDF can invalidate an existing digital signature.');
  }
  return {
    bytes: output,
    report: after,
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
