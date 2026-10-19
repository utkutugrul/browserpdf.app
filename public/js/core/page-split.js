import { normalizePageSelection, validatePageCount } from './page-selection.js';
import { inspectPageOperationStructures, pageOperationBoundary, MAX_PAGE_OPERATION_BYTES } from './page-operations.js';

export const MAX_OUTPUT_COUNT = 10000;
export const MAX_OUTPUT_BYTES = 96 * 1024 * 1024;
export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
export function outputBudget(results) {
  if (!Array.isArray(results) || !results.length || results.length > MAX_OUTPUT_COUNT) throw new RangeError('Choose between 1 and 10,000 output files.');
  let total = 0;
  for (const result of results) {
    if (!(result.bytes instanceof Uint8Array) || !result.bytes.length) throw new TypeError('Each output needs non-empty bytes.');
    total += result.bytes.length;
    if (total > MAX_OUTPUT_BYTES) throw new RangeError('The complete output group exceeds 96 MiB. Select fewer pages. No partial group was published.');
  }
  return total;
}
// Injected, DOM-free operation; the adapter owns review, naming and download.
export async function splitPdfPages(bytes, { pages, each = false, name = 'document', capabilities = {} }, { pdfLib, signal, onProgress } = {}) {
  signal?.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_PAGE_OPERATION_BYTES) throw new RangeError('Choose a PDF smaller than 250 MiB.');
  const source = await pdfLib.PDFDocument.load(bytes.slice(), { updateMetadata: false, ignoreEncryption: false });
  signal?.throwIfAborted();
  const pageCount = validatePageCount(source.getPageCount()), selected = normalizePageSelection(pages, pageCount);
  if (!selected.length) throw new RangeError('Select at least one page.');
  const groups = each ? selected.map((index) => [index]) : [selected];
  const boundary = pageOperationBoundary('page-copy', [inspectPageOperationStructures(source, pdfLib)]);
  const results = []; let total = 0;
  for (const [index, group] of groups.entries()) {
    signal?.throwIfAborted();
    const output = await pdfLib.PDFDocument.create();
    for (const page of await output.copyPages(source, group)) output.addPage(page);
    signal?.throwIfAborted();
    const saved = new Uint8Array(await output.save()); signal?.throwIfAborted();
    total += saved.length;
    if (total > MAX_OUTPUT_BYTES) throw new RangeError('The complete output group exceeds 96 MiB. Select fewer pages. No partial group was published.');
    const verified = await pdfLib.PDFDocument.load(saved.slice(), { updateMetadata: false, throwOnInvalidObject: true });
    signal?.throwIfAborted();
    if (verified.getPageCount() !== group.length) throw new Error('The split output page count could not be verified.');
    results.push({ bytes: saved, name: each ? `${name}-page-${group[0] + 1}.pdf` : `${name}-extracted.pdf`, type: 'application/pdf', pages: group.map((n) => n + 1), boundary, capabilities: { ...capabilities, encrypted: false, forms: false } });
    onProgress?.({ percent: Math.round((index + 1) / groups.length * 100), completed: index + 1, total: groups.length });
    // Yield between files so cancellation and replacement can own the next step.
    await new Promise((resolve) => setTimeout(resolve, 0)); signal?.throwIfAborted();
  }
  return results;
}
