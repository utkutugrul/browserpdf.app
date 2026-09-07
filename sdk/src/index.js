'use strict';

import { mergePdfFiles } from './core/merge-pdf.js';
import { scanPdfPrivacy } from './core/privacy-scan.js';
import { diagnosePdf } from './core/document-doctor.js';
import { normalizePdfStructure } from './core/document-doctor-output.js';

export const PACKAGE_VERSION = '0.1.0';
export const API_VERSION = 'v1';
export const PDFJS_VERSION = '6.1.200';
export const PDF_LIB_VERSION = '1.17.1';

function abort(signal) {
  if (!signal) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  else if (signal.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
}

async function ownBytes(input, signal) {
  abort(signal);
  let bytes;
  if (input instanceof Uint8Array) bytes = Uint8Array.from(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input.slice(0));
  else if (typeof Blob !== 'undefined' && input instanceof Blob) bytes = new Uint8Array(await input.arrayBuffer());
  else throw new TypeError('Input must be a Blob, ArrayBuffer, or Uint8Array.');
  abort(signal);
  if (!bytes.length) throw new TypeError('Input must not be empty.');
  return bytes;
}

function requirePdfLib(pdfLib) {
  if (!pdfLib?.PDFDocument) throw new TypeError('The exact pdf-lib 1.17.1 peer runtime is required.');
}

function requirePdfJs(pdfjs) {
  if (!pdfjs?.getDocument) throw new TypeError('The exact pdfjs-dist 6.1.200 peer runtime is required.');
  if (String(pdfjs.version || '') !== PDFJS_VERSION) {
    throw new RangeError(`PDF.js ${PDFJS_VERSION} is required; received ${String(pdfjs.version || 'unknown')}.`);
  }
}

function progress(operation, listener) {
  return listener ? (event) => listener({ operation, ...event }) : undefined;
}

export async function mergeV1(inputs, { pdfLib, signal, onProgress } = {}) {
  requirePdfLib(pdfLib);
  if (!Array.isArray(inputs) || inputs.length < 2) throw new TypeError('At least two PDF inputs are required.');
  const items = [];
  for (let index = 0; index < inputs.length; index++) {
    abort(signal);
    const candidate = inputs[index];
    const wrapped = candidate && typeof candidate === 'object' && 'data' in candidate;
    items.push({
      bytes: await ownBytes(wrapped ? candidate.data : candidate, signal),
      name: wrapped && typeof candidate.name === 'string' ? candidate.name.slice(0, 160) : `PDF ${index + 1}`,
    });
  }
  return Uint8Array.from(await mergePdfFiles(items, { pdfLib, signal, onProgress: progress('merge', onProgress) }));
}

export async function inspectV1(input, { pdfjs, pdfjsAssets = {}, signal, maxMatches, onProgress } = {}) {
  requirePdfJs(pdfjs);
  const bytes = await ownBytes(input, signal);
  return scanPdfPrivacy(bytes, {
    pdfjs, pdfjsAssets, signal, maxMatches,
    onProgress: progress('inspect', onProgress),
  });
}

export async function diagnoseV1(input, {
  pdfLib, pdfjs, pdfjsAssets = {}, mode = 'quick', createCanvas, signal, onProgress,
} = {}) {
  requirePdfLib(pdfLib); requirePdfJs(pdfjs);
  const bytes = await ownBytes(input, signal);
  return diagnosePdf(bytes, {
    mode, pdfLib, pdfjs, pdfjsAssets, createCanvas, signal,
    onProgress: progress('diagnose', onProgress),
  });
}

export async function normalizeV1(input, {
  pdfLib, pdfjs, pdfjsAssets = {}, createCanvas, signal, onProgress,
} = {}) {
  requirePdfLib(pdfLib); requirePdfJs(pdfjs);
  const bytes = await ownBytes(input, signal);
  return normalizePdfStructure(bytes, {
    pdfLib, pdfjs, pdfjsAssets, createCanvas, signal,
    onProgress: progress('normalize', onProgress),
  });
}
