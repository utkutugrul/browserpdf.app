'use strict';

import { diagnosePdf, summarizeDoctorReport } from './document-doctor.js';
import { withPdfDocument } from './privacy-scan.js';

const MAX_CANVAS_DIMENSION = 4096;
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_OUTPUT_PAGE_DIMENSION = 14400;

function abort(signal) { signal?.throwIfAborted(); }

function boundedViewport(page, requestedScale) {
  let viewport = page.getViewport({ scale: requestedScale });
  const pixelScale = Math.min(
    1,
    MAX_CANVAS_DIMENSION / Math.max(1, viewport.width),
    MAX_CANVAS_DIMENSION / Math.max(1, viewport.height),
    Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height)),
  );
  if (pixelScale < 1) viewport = page.getViewport({ scale: requestedScale * pixelScale });
  return viewport;
}

function makeCanvas(createCanvas, viewport) {
  if (typeof createCanvas !== 'function') throw new TypeError('A canvas factory is required.');
  return createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
}

async function renderPage(page, createCanvas, signal, scale = 0.5) {
  abort(signal);
  const viewport = boundedViewport(page, scale);
  const canvas = makeCanvas(createCanvas, viewport);
  const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
  const cancel = () => task.cancel?.();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await task.promise;
    abort(signal);
    return canvas;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

async function canvasPng(canvas) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('Page rasterization failed.')),
    'image/png',
  ));
  return new Uint8Array(await blob.arrayBuffer());
}

async function verifyOutput(bytes, expectedPages, { pdfLib, pdfjs, pdfjsAssets, createCanvas, signal }) {
  abort(signal);
  const strict = await pdfLib.PDFDocument.load(bytes.slice(), {
    ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false, parseSpeed: 100,
  });
  if (strict.getPageCount() !== expectedPages) throw new Error('Output page-count verification failed.');
  const renderedPages = [];
  await withPdfDocument(pdfjs, bytes, { signal, pdfjsAssets: { ...pdfjsAssets, stopAtErrors: true } }, async (document) => {
    if (document.numPages !== expectedPages) throw new Error('PDF.js output page-count verification failed.');
    const representatives = document.numPages > 1 ? [1, document.numPages] : [1];
    for (const pageNumber of representatives) {
      await renderPage(await document.getPage(pageNumber), createCanvas, signal, 0.35);
      renderedPages.push(pageNumber);
    }
  });
  return { pdfLibStrict: true, pdfjsStrict: true, renderedPages };
}

export async function normalizePdfStructure(inputBytes, {
  pdfLib, pdfjs, pdfjsAssets = {}, createCanvas, signal, onProgress,
} = {}) {
  if (!pdfLib?.PDFDocument || !pdfjs?.getDocument) throw new TypeError('pdf-lib and PDF.js runtimes are required.');
  const original = Uint8Array.from(inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes));
  abort(signal);
  const source = await pdfLib.PDFDocument.load(original.slice(), {
    ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false,
  });
  const expectedPages = source.getPageCount();
  onProgress?.({ phase: 'serialize' });
  abort(signal);
  const bytes = Uint8Array.from(await source.save({ updateFieldAppearances: false }));
  abort(signal);
  onProgress?.({ phase: 'verify' });
  const verification = await verifyOutput(bytes, expectedPages, { pdfLib, pdfjs, pdfjsAssets, createCanvas, signal });
  const diagnosis = await diagnosePdf(bytes, { mode: 'quick', pdfLib, pdfjs, pdfjsAssets, signal });
  if (!diagnosis.parses.pdfLibStrict.ok || !diagnosis.parses.pdfjsStrict.ok || !diagnosis.pageTree.consistent) {
    throw new Error('Normalized output did not pass strict verification.');
  }
  return {
    bytes,
    diagnosis: summarizeDoctorReport(diagnosis),
    verification,
    lossManifest: {
      action: 'normalize-structure',
      changes: ['Rewrites the PDF object graph, cross-reference data, and serialization into a new file.'],
      preservationIntent: ['Attempts to retain page content', 'page order', 'metadata', 'attachments', 'actions', 'forms', 'and structure tags'],
      losses: ['Encryption, passwords, permissions, and other access controls are not preserved; the new copy is unencrypted.'],
      risks: [
        'Unsupported or malformed structures may be omitted by reserialization.',
        'Any existing digital signature can be invalidated. Signature validity is not checked.',
      ],
    },
  };
}

export async function rebuildPdfPageContent(inputBytes, {
  pdfLib, pdfjs, pdfjsAssets = {}, createCanvas, signal, onProgress,
} = {}) {
  if (!pdfLib?.PDFDocument || !pdfjs?.getDocument) throw new TypeError('pdf-lib and PDF.js runtimes are required.');
  const original = Uint8Array.from(inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes));
  const output = await pdfLib.PDFDocument.create({ updateMetadata: false });
  let expectedPages = 0;
  await withPdfDocument(pdfjs, original, { signal, pdfjsAssets: { ...pdfjsAssets, stopAtErrors: true } }, async (document) => {
    expectedPages = document.numPages;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      abort(signal);
      const sourcePage = await document.getPage(pageNumber);
      const base = sourcePage.getViewport({ scale: 1 });
      const rendered = await renderPage(sourcePage, createCanvas, signal, 1.25);
      const image = await output.embedPng(await canvasPng(rendered));
      const pageScale = Math.min(1, MAX_OUTPUT_PAGE_DIMENSION / Math.max(1, base.width), MAX_OUTPUT_PAGE_DIMENSION / Math.max(1, base.height));
      const outputWidth = Math.max(1, base.width * pageScale);
      const outputHeight = Math.max(1, base.height * pageScale);
      const page = output.addPage([outputWidth, outputHeight]);
      page.drawImage(image, { x: 0, y: 0, width: outputWidth, height: outputHeight });
      onProgress?.({ phase: 'page', page: pageNumber, pageCount: document.numPages });
    }
  });
  abort(signal);
  const bytes = Uint8Array.from(await output.save({ updateFieldAppearances: false }));
  onProgress?.({ phase: 'verify' });
  const verification = await verifyOutput(bytes, expectedPages, { pdfLib, pdfjs, pdfjsAssets, createCanvas, signal });
  const diagnosis = await diagnosePdf(bytes, { mode: 'quick', pdfLib, pdfjs, pdfjsAssets, signal });
  if (!diagnosis.parses.pdfLibStrict.ok || !diagnosis.parses.pdfjsStrict.ok || !diagnosis.pageTree.consistent) {
    throw new Error('Rebuilt output did not pass strict verification.');
  }
  return {
    bytes,
    diagnosis: summarizeDoctorReport(diagnosis),
    verification,
    lossManifest: {
      action: 'rebuild-page-content',
      changes: ['Rasterizes every page into a fresh PDF document.'],
      losses: [
        'Searchable/selectable text', 'links and actions', 'forms and annotations', 'attachments',
        'original metadata', 'structure tags and alternative text', 'vector detail', 'existing digital signatures',
        'encryption, passwords, permissions, and other access controls',
      ],
      risks: ['Image rendering can reduce visual fidelity and increase file size.', 'Very large page render surfaces and output page dimensions are bounded.'],
    },
  };
}
