'use strict';

function throwIfAborted(signal) {
  if (!signal) return;
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted();
    return;
  }
  if (signal.aborted) {
    const error = signal.reason || new Error('Aborted');
    if (!signal.reason) error.name = 'AbortError';
    throw error;
  }
}

let PDFDocumentApi = null;

export function configureMergePdf(pdfLib) {
  if (!pdfLib?.PDFDocument) throw new TypeError('A pdf-lib module is required.');
  PDFDocumentApi = pdfLib.PDFDocument;
}

/**
 * Merge PDF byte arrays without touching the DOM or triggering a download.
 * Items are `{ bytes: Uint8Array, name?: string }`; the result is a Uint8Array.
 */
export async function mergePdfFiles(items, { pdfLib, signal, onProgress } = {}) {
  if (!Array.isArray(items) || items.length < 2) {
    throw new TypeError('At least two PDF items are required.');
  }
  const PDFDocument = pdfLib?.PDFDocument || PDFDocumentApi;
  if (!PDFDocument) throw new Error('pdf-lib must be configured or provided before merging.');
  throwIfAborted(signal);
  const mergedPdf = await PDFDocument.create();
  throwIfAborted(signal);

  for (let fileIndex = 0; fileIndex < items.length; fileIndex += 1) {
    throwIfAborted(signal);
    const item = items[fileIndex];
    if (!(item?.bytes instanceof Uint8Array)) {
      throw new TypeError(`Item ${fileIndex + 1} has no PDF byte array.`);
    }
    onProgress?.({
      phase: 'adding',
      percent: Math.round(((fileIndex + 1) / items.length) * 90),
      fileName: String(item.name || `PDF ${fileIndex + 1}`),
      fileIndex,
      fileCount: items.length,
    });
    const source = await PDFDocument.load(item.bytes, { ignoreEncryption: true });
    throwIfAborted(signal);
    const copiedPages = await mergedPdf.copyPages(source, source.getPageIndices());
    for (const page of copiedPages) {
      throwIfAborted(signal);
      mergedPdf.addPage(page);
    }
  }

  throwIfAborted(signal);
  onProgress?.({ phase: 'saving', percent: 95 });
  const output = await mergedPdf.save();
  throwIfAborted(signal);
  onProgress?.({ phase: 'done', percent: 100 });
  return output;
}
