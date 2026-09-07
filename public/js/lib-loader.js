'use strict';

import { t } from './i18n.js';

// Shared verified-loading helpers used by every tool page. Libraries are
// fetched, SHA-384 verified against a pinned hash, and only then executed
// from a Blob, defending the entry points against a compromised CDN
// response. A hash mismatch throws instead of silently loading.

export const LIBS = {
  pdfjs: {
    url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs',
    hash: 'sha384-iFreJLYJz3yZXDcGivJRXeHAo/NHOLP/QIK1neoV/fI0muPBJGNUhorvDzwNiIF/',
  },
  pdfjsWorker: {
    url: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs',
    hash: 'sha384-TP/IyAALg2YIe4jQVEJ6WwbztilE5pDhTVEmz5gPXnu3JwDPws/1dWcJwLnX/+GJ',
  },
  tesseract: {
    url: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js',
    hash: 'sha384-fDdNU3AFf+hEiUiSjD96lSEFawtCYOWQFSrFyHZOkX2jhwuUQKiSOAgWNfuKg4B6',
  },
  tesseractWorker: {
    url: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    hash: 'sha384-iUyp1FxLBc4DYaSwxT1/G6elMdSh3vvQffNSmMiySoXDpk2XfS9ZcM4RjPSiqiw3',
  },
  pdflib: {
    url: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    hash: 'sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI',
  },
  cantooPdfLib: {
    url: 'https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib@2.7.4/dist/pdf-lib.min.js',
    hash: 'sha384-9fXSBSIwZP0IWlHYSoPN0i8ISluab/j1ePT7k+pqwlTIJkjJMusE6/NXT691X6yG',
  },
  mammoth: {
    url: 'https://cdn.jsdelivr.net/npm/mammoth@1.9.0/mammoth.browser.min.js',
    hash: 'sha384-F9c4WGfCRfzaY1ngABA8Z7qHFDuWabKbcwCb2Tk3Qf4njoUVhOChtw0UrXJmSp1y',
  },
  xlsx: {
    url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    hash: 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw',
  },
};

const PDFJS_VERSION = '6.2.108';

export const PDFJS_ASSET_URLS = {
  standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`,
  cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/cmaps/`,
  cMapPacked: true,
  wasmUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/wasm/`,
};

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sha384Base64(buffer) {
  const digest = await crypto.subtle.digest('SHA-384', buffer);
  return bufferToBase64(digest);
}

export async function verifiedFetch({ url, hash }) {
  if (!window.isSecureContext || !crypto.subtle) {
    throw new Error('crypto.subtle is not available. Make sure this page is served from a local server (http://localhost:...); opening the file directly by double-clicking disables some browser security features.');
  }
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`Failed to download library (network error): ${url}`);
  }
  if (!response.ok) {
    throw new Error(`Failed to download library: ${url} (HTTP ${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  const actualHash = `sha384-${await sha384Base64(buffer)}`;
  if (actualHash !== hash) {
    throw new Error(
      `Integrity check failed, aborting for safety.\n` +
      `Source: ${url}\nExpected: ${hash}\nGot: ${actualHash}`
    );
  }
  const blob = new Blob([buffer], { type: 'text/javascript' });
  return URL.createObjectURL(blob);
}

// For real ES modules with named exports (pdf.js, tesseract.js's default export).
export async function loadVerifiedModule(lib) {
  const blobUrl = await verifiedFetch(lib);
  try {
    return await import(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

// For UMD bundles with no ESM exports (pdf-lib): the script's only observable
// effect is attaching a global (e.g. self.PDFLib), so run it for that
// side effect and hand back the global it created.
export async function loadVerifiedGlobal(lib, globalName) {
  const blobUrl = await verifiedFetch(lib);
  try {
    await import(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
  const value = self[globalName];
  if (!value) {
    throw new Error(`${globalName} was not found on the global scope after loading ${lib.url}.`);
  }
  return value;
}

let pdfjsModule = null;
let createWorkerFn = null;
let tesseractWorkerScriptUrl = null;
let pdfLibModule = null;
let cantooPdfLibModule = null;
let mammothModule = null;
let xlsxModule = null;

export async function ensurePdfJs(onStatus) {
  if (pdfjsModule) return pdfjsModule;
  onStatus?.(t('common.js_verifying', 'Verifying and loading {lib}…', { lib: 'pdf.js' }));
  const mod = await loadVerifiedModule(LIBS.pdfjs);
  const workerBlobUrl = await verifiedFetch(LIBS.pdfjsWorker);
  mod.GlobalWorkerOptions.workerSrc = workerBlobUrl;
  pdfjsModule = mod;
  return pdfjsModule;
}

export async function ensureTesseract(onStatus) {
  if (createWorkerFn) return createWorkerFn;
  onStatus?.(t('common.js_verifying', 'Verifying and loading {lib}…', { lib: 'Tesseract.js' }));
  // tesseract.esm.min.js is a CJS-to-ESM interop wrapper: it only exports
  // a single `default` (the whole module.exports object), no named exports.
  const mod = await loadVerifiedModule(LIBS.tesseract);
  tesseractWorkerScriptUrl = await verifiedFetch(LIBS.tesseractWorker);
  createWorkerFn = mod.default.createWorker;
  return createWorkerFn;
}

export function getTesseractWorkerScriptUrl() {
  return tesseractWorkerScriptUrl;
}

export async function ensurePdfLib(onStatus) {
  if (pdfLibModule) return pdfLibModule;
  onStatus?.(t('common.js_verifying', 'Verifying and loading {lib}…', { lib: 'pdf-lib' }));
  pdfLibModule = await loadVerifiedGlobal(LIBS.pdflib, 'PDFLib');
  return pdfLibModule;
}

export async function ensureCantooPdfLib(onStatus) {
  if (cantooPdfLibModule) return cantooPdfLibModule;
  onStatus?.(t('common.js_verifying', 'Verifying and loading {lib}…', { lib: 'pdf-lib (encryption build)' }));
  cantooPdfLibModule = await loadVerifiedGlobal(LIBS.cantooPdfLib, 'PDFLib');
  return cantooPdfLibModule;
}

export async function ensureMammoth(onStatus) {
  if (mammothModule) return mammothModule;
  onStatus?.(t('common.js_verifying', 'Verifying and loading {lib}…', { lib: 'mammoth' }));
  mammothModule = await loadVerifiedGlobal(LIBS.mammoth, 'mammoth');
  return mammothModule;
}

export async function ensureXlsx(onStatus) {
  if (xlsxModule) return xlsxModule;
  onStatus?.(t('common.js_verifying', 'Verifying and loading {lib}…', { lib: 'SheetJS' }));
  xlsxModule = await loadVerifiedGlobal(LIBS.xlsx, 'XLSX');
  return xlsxModule;
}
