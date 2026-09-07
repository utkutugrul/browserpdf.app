import {
  API_VERSION, PACKAGE_VERSION, diagnoseV1, inspectV1, mergeV1, normalizeV1,
  type PdfJsRuntime, type PdfLibRuntime, type ProgressEvent,
} from '@browserpdf/sdk/v1';

const packageVersion: "0.1.0" = PACKAGE_VERSION;
const apiVersion: "v1" = API_VERSION;
void [packageVersion, apiVersion];

declare const pdfjs: PdfJsRuntime;
declare const pdfLib: PdfLibRuntime;
declare const blob: Blob;
declare const signal: AbortSignal;
const progress = (event: ProgressEvent): void => { void event.operation; };

const merged: Promise<Uint8Array> = mergeV1([blob, { data: new Uint8Array([1]), name: 'one.pdf' }], { pdfLib, signal, onProgress: progress });
const inspected = inspectV1(blob, { pdfjs, signal, maxMatches: 10, onProgress: progress });
const diagnosed = diagnoseV1(new ArrayBuffer(8), { pdfLib, pdfjs, mode: 'deep', createCanvas: (width, height) => Object.assign(document.createElement('canvas'), { width, height }) });
const normalized = normalizeV1(new Uint8Array([1]), { pdfLib, pdfjs, createCanvas: (width, height) => Object.assign(document.createElement('canvas'), { width, height }) });
void [merged, inspected, diagnosed, normalized];

// @ts-expect-error strings are not accepted as PDF input
inspectV1('file.pdf', { pdfjs });
// @ts-expect-error modes are a closed versioned union
diagnoseV1(blob, { pdfLib, pdfjs, mode: 'complete' });
// @ts-expect-error deep diagnosis requires an explicit canvas factory
diagnoseV1(blob, { pdfLib, pdfjs, mode: 'deep' });
// @ts-expect-error normalization verifies a render and requires a canvas factory
normalizeV1(blob, { pdfLib, pdfjs });
