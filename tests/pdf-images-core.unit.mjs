import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfLib from 'pdf-lib';
import { createCanvas, DOMMatrix, ImageData, Path2D, loadImage } from '@napi-rs/canvas';
import { estimatePdfImages, exportPdfImages } from '../public/js/core/pdf-images.js';
globalThis.DOMMatrix = DOMMatrix; globalThis.ImageData = ImageData; globalThis.Path2D = Path2D;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
async function fixture() { const doc = await pdfLib.PDFDocument.create(); for (const color of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) { const page = doc.addPage([128, 72]); page.drawRectangle({ x: 0, y: 0, width: 128, height: 72, color: pdfLib.rgb(...color) }); } return new Uint8Array(await doc.save()); }
const environment = { pdfjs, canvasFactory: () => createCanvas(1, 1), encodeCanvas: async (canvas, type) => new Uint8Array(canvas.toBuffer(type)) };
function trackedCanvas() { const native = createCanvas(1, 1); let width = 1, height = 1; return { get width() { return width; }, set width(value) { width = value; native.width = Math.max(1, value); }, get height() { return height; }, set height(value) { height = value; native.height = Math.max(1, value); }, getContext: (...args) => native.getContext(...args), toBuffer: (...args) => native.toBuffer(...args) }; }

test('actual PDF-to-images preserves chosen page identities, complete bytes, resolution and source', async () => {
  const bytes = await fixture(), before = bytes.slice(), options = { pages: [0, 2], scale: 2, format: 'png', name: 'chosen' };
  const estimate = await estimatePdfImages(bytes, options, environment); assert.equal(estimate.count, 2); assert.equal(estimate.peakCanvasBytes, 256 * 144 * 4); assert.equal(estimate.minDpi, 144);
  const results = await exportPdfImages(bytes, options, environment); assert.deepEqual(results.map((value) => value.name), ['chosen-page-1.png', 'chosen-page-3.png']);
  for (const [index, result] of results.entries()) { const image = await loadImage(result.bytes), canvas = createCanvas(image.width, image.height); canvas.getContext('2d').drawImage(image, 0, 0); assert.equal(image.width, 256); assert.equal(image.height, 144); assert.deepEqual([...canvas.getContext('2d').getImageData(64, 36, 1, 1).data], index ? [0, 0, 255, 255] : [255, 0, 0, 255]); }
  assert.deepEqual(bytes, before);
});

test('held noncancelable encoder loses publication after Cancel and clears its canvas', async () => {
  const bytes = await fixture(), controller = new AbortController(); let release, held = false, canvas;
  const running = exportPdfImages(bytes, { pages: [0, 1], scale: 1, format: 'png' }, { ...environment, signal: controller.signal, canvasFactory: () => (canvas = trackedCanvas()), encodeCanvas: async (value) => { held = true; await new Promise((resolve) => { release = resolve; }); return new Uint8Array(value.toBuffer('image/png')); } });
  while (!held) await new Promise(setImmediate); controller.abort(); release(); await assert.rejects(running, { name: 'AbortError' }); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
});

test('extreme-page estimates disclose effective pixel caps without creating canvases', async () => {
  const doc = await pdfLib.PDFDocument.create(); doc.addPage([14000, 7000]); const bytes = new Uint8Array(await doc.save());
  const measured = await estimatePdfImages(bytes, { pages: [0], scale: 3, format: 'jpg' }, environment); assert.equal(measured.limited, 1); assert.equal(measured.first[0].width, 4096); assert.ok(measured.first[0].pixels <= 16_000_000); assert.ok(measured.maxDpi < 216);
});
