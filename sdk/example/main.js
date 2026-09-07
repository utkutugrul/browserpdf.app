import * as pdfLib from '/node_modules/pdf-lib/dist/pdf-lib.esm.min.js';
import * as pdfjs from '/node_modules/pdfjs-dist/build/pdf.mjs';
import { API_VERSION, PACKAGE_VERSION, diagnoseV1, inspectV1, mergeV1, normalizeV1 } from '/sdk/dist/index.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
const pdfjsAssets = {
  standardFontDataUrl: '/node_modules/pdfjs-dist/standard_fonts/',
  cMapUrl: '/node_modules/pdfjs-dist/cmaps/', cMapPacked: true,
  wasmUrl: '/node_modules/pdfjs-dist/wasm/',
};
const lifecycle = { tasksCreated: 0, tasksDestroyed: 0, documentsDestroyed: 0 };
const pdfjsRuntime = {
  ...pdfjs,
  getDocument(options) {
    lifecycle.tasksCreated++;
    const task = pdfjs.getDocument(options);
    return {
      promise: task.promise.then((pdfDocument) => new Proxy(pdfDocument, {
        get(target, property) {
          if (property === 'destroy') return async () => { lifecycle.documentsDestroyed++; return target.destroy(); };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      })),
      async destroy() { lifecycle.tasksDestroyed++; return task.destroy(); },
    };
  },
};

const files = document.getElementById('files');
const run = document.getElementById('run');
const status = document.getElementById('status');
const result = document.getElementById('result');
const download = document.getElementById('download');
let normalized = null;

function createCanvas(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}

files.addEventListener('change', () => { run.disabled = files.files.length < 2; });
run.addEventListener('click', async () => {
  run.disabled = true; download.hidden = true; normalized = null;
  const progress = [];
  const onProgress = (event) => { progress.push(event); status.textContent = `${event.operation}: ${event.phase || 'working'}`; };
  try {
    const selected = [...files.files];
    const merged = await mergeV1(selected.map((data) => ({ data, name: data.name })), { pdfLib, onProgress });
    const privacy = await inspectV1(selected[0], { pdfjs: pdfjsRuntime, pdfjsAssets, onProgress });
    const buffer = await selected[0].arrayBuffer();
    const quick = await diagnoseV1(buffer, { pdfLib, pdfjs: pdfjsRuntime, pdfjsAssets, mode: 'quick', onProgress });
    const deep = await diagnoseV1(new Uint8Array(buffer), { pdfLib, pdfjs: pdfjsRuntime, pdfjsAssets, mode: 'deep', createCanvas, onProgress });
    const normalizeInput = new Uint8Array(buffer);
    const normalizeBefore = normalizeInput.slice();
    normalized = await normalizeV1(normalizeInput, { pdfLib, pdfjs: pdfjsRuntime, pdfjsAssets, createCanvas, onProgress });
    const mergedDoc = await pdfLib.PDFDocument.load(merged, { throwOnInvalidObject: true });
    const summary = {
      packageVersion: PACKAGE_VERSION, apiVersion: API_VERSION,
      pdfjsVersion: pdfjs.version,
      mergedPages: mergedDoc.getPageCount(), privacyPages: privacy.pageCount,
      quickPages: quick.pageCount, deepPages: deep.deep.pagesChecked,
      normalizedPages: normalized.diagnosis.pageCount,
      normalizedVerified: normalized.verification.pdfLibStrict && normalized.verification.pdfjsStrict,
      normalizeInputUnchanged: normalizeInput.every((value, index) => value === normalizeBefore[index]),
      progressOperations: [...new Set(progress.map((entry) => entry.operation))],
      lifecycle: { ...lifecycle },
    };
    result.textContent = JSON.stringify(summary, null, 2);
    status.textContent = 'Complete. Download remains manual.';
    download.hidden = false;
  } catch (error) {
    status.textContent = `Failed: ${error.name}`;
  } finally {
    run.disabled = files.files.length < 2;
  }
});

download.addEventListener('click', () => {
  if (!normalized) return;
  const url = URL.createObjectURL(new Blob([normalized.bytes], { type: 'application/pdf' }));
  const link = document.createElement('a'); link.href = url; link.download = 'normalized.pdf'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
