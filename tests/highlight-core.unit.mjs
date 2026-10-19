import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfLib from 'pdf-lib';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { createDocumentSession } from '../public/js/core/document-session.js';
import { renderScenePdf } from '../public/js/core/object-scene.js';
import { validateHighlight } from '../public/js/core/highlight-annotations.js';
globalThis.DOMMatrix = DOMMatrix; globalThis.ImageData = ImageData; globalThis.Path2D = Path2D;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const pdfjsAssets = { standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname };
const highlight = (id = 'highlight-one', pageIndex = 0) => ({ id, kind: 'highlight', pageIndex, quads: [[54, 216, 260, 216, 260, 235, 54, 235]], color: [1, .9, .1], opacity: .4, note: 'İstanbul – Özgün not 😀', selectedText: 'SELECTED TEXT RETAINED' });
const lookup = (dict, key) => dict.lookup(pdfLib.PDFName.of(key));
const array = (dict, key) => lookup(dict, key).asArray().map((value) => value.asNumber());
const decode = (stream) => new TextDecoder().decode(pdfLib.decodePDFRawStream(stream).decode());
function annotations(doc, index) { const values = doc.getPage(index).node.Annots(); return values ? values.asArray().map((ref) => doc.context.lookup(ref)) : []; }
async function fixture() {
  const doc = await pdfLib.PDFDocument.create(), font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  for (const rotation of [0, 90, 180, 270]) {
    const page = doc.addPage([500, 400]); page.setCropBox(30, 25, 420, 330); page.setRotation(pdfLib.degrees(rotation));
    page.node.set(pdfLib.PDFName.of('UserUnit'), pdfLib.PDFNumber.of(rotation % 180 ? 2 : 1));
    page.drawText('SELECTED TEXT RETAINED', { x: 55, y: 220, size: 14, font });
    page.drawText('UNTOUCHED SOURCE TEXT', { x: 55, y: 100, size: 14, font });
  }
  // Independent existing annotation, deliberately not built with the writer
  // being tested. Its appearance and Unicode note must survive unchanged.
  const context = doc.context, state = context.register(context.obj({ Type: 'ExtGState', ca: .55, CA: .55, BM: 'Multiply' }));
  const appearance = context.register(context.flateStream('q /OriginalGS gs 0 1 0 rg 54 96 200 20 re f Q', { Type: 'XObject', Subtype: 'Form', BBox: [54, 96, 254, 116], Resources: { ExtGState: { OriginalGS: state } } }));
  doc.getPage(0).node.addAnnot(context.register(context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [54, 96, 254, 116], QuadPoints: [54, 96, 254, 96, 254, 116, 54, 116], Contents: pdfLib.PDFHexString.fromText('PRESERVED – Yeşil not'), C: [0, 1, 0], CA: .55, AP: { N: appearance }, F: 4 })));
  return new Uint8Array(await doc.save());
}

test('real saved highlights retain four rotations, CropBox/UserUnit, source text, original AP/note and explicit native appearance', async () => {
  const bytes = await fixture(), original = await pdfLib.PDFDocument.load(bytes), oldAppearance = decode(lookup(lookup(annotations(original, 0)[0], 'AP'), 'N'));
  const session = createDocumentSession(); session.begin(bytes, 'source.pdf', { capabilities: { searchable: true } }); session.beginScene();
  const scene = session.scene(); for (let index = 0; index < 4; index++) scene.objects.push(highlight(`highlight-${index}`, index)); session.changeScene(scene);
  const build = () => renderScenePdf({ scene: session.scene(), resource: session.resource, pdfLib, pdfjs, pdfjsAssets });
  const result = await build(), again = await build(); assert.deepEqual(result.bytes, again.bytes); assert.deepEqual(session.original().bytes, bytes);
  const saved = await pdfLib.PDFDocument.load(result.bytes), old = annotations(saved, 0)[0];
  assert.equal(lookup(old, 'Contents').decodeText(), 'PRESERVED – Yeşil not'); assert.equal(decode(lookup(lookup(old, 'AP'), 'N')), oldAppearance);
  const task = pdfjs.getDocument({ data: result.bytes.slice(), ...pdfjsAssets });
  try {
    const document = await task.promise;
    for (let index = 0; index < 4; index++) {
      const annots = annotations(saved, index); assert.equal(annots.length, index ? 1 : 2);
      const dict = annots.at(-1), expected = highlight(`highlight-${index}`, index);
      assert.equal(lookup(dict, 'Subtype').toString(), '/Highlight'); assert.deepEqual(array(dict, 'Rect'), [54, 216, 260, 235]); assert.deepEqual(array(dict, 'QuadPoints'), expected.quads.flat());
      assert.equal(lookup(dict, 'Contents').decodeText(), expected.note); assert.equal(lookup(dict, 'NM').decodeText(), expected.id);
      const ap = lookup(lookup(dict, 'AP'), 'N'), gs = lookup(lookup(lookup(ap.dict, 'Resources'), 'ExtGState'), 'GS0');
      assert.equal(lookup(ap.dict, 'Subtype').toString(), '/Form'); assert.deepEqual(array(ap.dict, 'BBox'), [54, 216, 260, 235]);
      assert.equal(lookup(gs, 'ca').asNumber(), .4); assert.equal(lookup(gs, 'CA').asNumber(), .4); assert.equal(lookup(gs, 'BM').toString(), '/Multiply'); assert.match(decode(ap), /\/GS0 gs/);
      const page = await document.getPage(index + 1), text = (await page.getTextContent()).items.map((item) => item.str).join(' ');
      assert.match(text, /SELECTED TEXT RETAINED/); assert.match(text, /UNTOUCHED SOURCE TEXT/); assert.equal(page.rotate, [0, 90, 180, 270][index]); assert.equal(page.userUnit, index % 2 ? 2 : 1);
      const viewport = page.getViewport({ scale: 1 }), canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height)); await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const [x, y] = viewport.convertToViewportPoint(250, 225), pixel = canvas.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      // Independently known white-background Multiply result: yellow at 40%.
      assert.ok(pixel[0] >= 250 && Math.abs(pixel[1] - 245) <= 2 && Math.abs(pixel[2] - 163) <= 2, `page ${index + 1} actual AP pixel ${[...pixel]}`);
    }
  } finally { await task.destroy(); }
});

test('annotation color/note/delete/Undo/Redo and inherited transfer keep exact finite quads without image resources', async () => {
  const session = createDocumentSession(); session.begin(await fixture(), 'source.pdf'); session.beginScene();
  const sourceBytes = session.snapshot().resourceBytes, next = session.scene(); next.objects.push(highlight()); session.changeScene(next);
  const edit = session.scene(); edit.objects[0].color = [.2, .5, 1]; edit.objects[0].note = 'Changed – Çağrı'; session.changeScene(edit);
  const changed = session.scene(); session.undo(); assert.equal(session.scene().objects[0].note, highlight().note); session.redo(); assert.deepEqual(session.scene(), changed);
  const removed = session.scene(); removed.objects = []; session.changeScene(removed); session.undo(); assert.deepEqual(session.scene(), changed);
  assert.equal(session.snapshot().resourceBytes, sourceBytes); assert.equal(session.scene().objects[0].assetId, undefined);
  const transfer = session.transfer(), restored = createDocumentSession(); restored.begin(transfer.current.bytes, transfer.current.name, transfer); assert.deepEqual(restored.scene(), changed);
  transfer.scene.objects[0].quads[0][0] = -999; assert.deepEqual(restored.scene(), changed);
});

test('forged, empty, duplicate, angled and over-budget annotation states reject transactionally', async () => {
  const session = createDocumentSession(); session.begin(await fixture(), 'source.pdf'); session.beginScene(); const before = session.transfer();
  for (const mutate of [
    (h) => { h.quads = []; }, (h) => { h.quads[0][0] = NaN; }, (h) => { h.quads[0][0] += 1; },
    (h) => { h.quads.push([...h.quads[0]]); }, (h) => { h.note = 'n'.repeat(2001); }, (h) => { h.selectedText = ' '; },
    (h) => { h.opacity = .9; }, (h) => { h.quads = Array.from({ length: 129 }, () => [...h.quads[0]]); },
  ]) {
    const value = highlight(); mutate(value); assert.throws(() => validateHighlight(value)); const scene = session.scene(); scene.objects.push(value); assert.throws(() => session.changeScene(scene)); assert.deepEqual(session.transfer(), before);
  }
  const count = session.scene(); count.objects = Array.from({ length: 301 }, (_, index) => highlight(String(index))); assert.throws(() => session.changeScene(count), /limit/); assert.deepEqual(session.transfer(), before);
  const json = session.scene(); json.objects = Array.from({ length: 300 }, (_, index) => ({ ...highlight(String(index)), selectedText: 'x'.repeat(2000) })); assert.throws(() => session.changeScene(json), /limit/); assert.deepEqual(session.transfer(), before);
});
