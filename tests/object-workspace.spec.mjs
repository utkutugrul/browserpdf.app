import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, PDFDict, PDFName, PDFNumber, StandardFonts, degrees } from 'pdf-lib';
import { createDocumentSession } from '../public/js/core/document-session.js';
import { boundedViewport } from '../public/js/core/bounded-renderer.js';
let rootFixtures;
test.beforeAll(async () => {
  rootFixtures = (await mkdtemp(path.join(tmpdir(), 'browserpdf-objects-fixtures-'))) + '/';
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [doc.addPage([612, 792]), doc.addPage([500, 400]), doc.addPage([612, 792])]; pages[1].setCropBox(40, 30, 400, 300); pages[1].setRotation(degrees(90));
  pages.forEach((page, index) => page.drawText(`CHECKPOINT PAGE ${index + 1}`, { x: 60, y: index === 1 ? 290 : 730, size: 17, font }));
  const form = doc.getForm(), customer = form.createTextField('customer_name'); customer.addToPage(pages[0], { x: 65, y: 640, width: 350, height: 28, font }); customer.setText('Original Name');
  const check = form.createCheckBox('agreement'); check.addToPage(pages[0], { x: 65, y: 580, width: 20, height: 20 });
  const category = form.createDropdown('category'); category.addOptions(['Standard', 'Professional']); category.select('Standard'); category.addToPage(pages[1], { x: 90, y: 200, width: 170, height: 24, font });
  const repeated = form.createTextField('repeated_reference'); repeated.addToPage(pages[0], { x: 65, y: 520, width: 250, height: 25, font }); repeated.addToPage(pages[2], { x: 65, y: 620, width: 250, height: 25, font }); repeated.setText('LINKED FIELD');
  repeated.acroField.getWidgets()[1].dict.delete(PDFName.of('P'));
  const longField = form.createTextField('L'.repeat(306)); longField.addToPage(pages[2], {x:65,y:480,width:250,height:25,font}); longField.setText('LONG ORIGINAL');
  await writeFile(rootFixtures + 'form-rotated.pdf', await doc.save());
  const plain = await PDFDocument.create(); plain.addPage([612, 792]); plain.addPage([612, 792]); await writeFile(rootFixtures + 'non-form.pdf', await plain.save());
  const signature = createCanvas(800, 300), ink = signature.getContext('2d'); ink.strokeStyle = '#164ca3'; ink.lineWidth = 5; ink.beginPath(); ink.moveTo(270, 180); ink.bezierCurveTo(290, 90, 310, 215, 330, 145); ink.bezierCurveTo(350, 80, 350, 215, 390, 160); ink.bezierCurveTo(420, 120, 445, 180, 485, 135); ink.stroke(); ink.strokeStyle = '#af1717'; ink.lineWidth = 3; ink.beginPath(); ink.moveTo(265, 195); ink.lineTo(500, 185); ink.stroke(); await writeFile(rootFixtures + 'transparent-signature.png', signature.toBuffer('image/png'));
  const portrait = createCanvas(20, 40), color = portrait.getContext('2d'); color.fillStyle = '#e62727'; color.fillRect(0, 0, 20, 20); color.fillStyle = '#164ca3'; color.fillRect(0, 20, 20, 20);
  const jpeg = portrait.toBuffer('image/jpeg'); const exif = Buffer.from([0xff,0xe1,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  await writeFile(rootFixtures + 'oriented.jpg', Buffer.concat([jpeg.subarray(0,2), exif, jpeg.subarray(2)]));
});
async function open(page, mode, file = 'form-rotated.pdf') {
  await page.goto('/' + mode); await page.evaluate(() => { document.querySelector('.cookie-banner')?.remove(); });
  const reject = page.getByRole('button', { name: 'Reject', exact: true }); if (await reject.isVisible()) await reject.click();
  await page.setInputFiles('#fileInput', rootFixtures + file); await expect(page.locator('#workspaceModes')).toBeVisible();
  await expect(page.locator(mode === 'add-image' ? '#previewCanvas' : '#placementCanvas')).toHaveAttribute('data-pdf-page', '1');
}
async function download(page, testInfo, name) {
  await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]);
  const output = testInfo.outputPath(name); await download.saveAs(output); return new Uint8Array(await readFile(output));
}
async function extracted(page, bytes) {
  return page.evaluate(async (bytes) => { const runtime = await import('/js/lib-loader.js'); const task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS });
    try { const doc = await task.promise, text = []; for (let i = 1; i <= doc.numPages; i++) text.push((await (await doc.getPage(i)).getTextContent()).items.filter((i) => typeof i.str === 'string').map((i) => i.str).join(' ')); return text; } finally { await task.destroy(); }
  }, [...bytes]);
}
function imageSizes(doc, index) { const dict = doc.getPage(index).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict); return dict ? dict.keys().map((key) => doc.context.lookup(dict.get(key))).filter((o) => o.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image').map((o) => [o.dict.get(PDFName.of('Width')).asNumber(), o.dict.get(PDFName.of('Height')).asNumber()]) : []; }

test('scene history keeps one deduplicated asset, bounded JSON, boundary undo and transactional rejected intake', async () => {
  const session = createDocumentSession(); session.begin(Uint8Array.of(1, 2), 'source.pdf', {boundary:{kind:'pdf-rewrite',losses:['signature-rewrite']}}); session.beginScene();
  const assetId = await session.addAsset(Uint8Array.of(10, 20, 30), 'image/png'); expect(await session.addAsset(Uint8Array.of(10, 20, 30), 'image/png')).toBe(assetId);
  const state = session.scene(); state.fields.__proto__ = { kind: 'text', value: 'literal field name' }; state.objects.push({ id: 'image', kind: 'signature', pageIndex: 0, x: 1, y: 2, width: 30, height: 10, assetId }); session.changeScene(state); expect(Object.hasOwn(session.scene().fields, '__proto__')).toBe(true);
  for (let n = 0; n < 10; n++) { const next = session.scene(); next.objects[0].x++; session.changeScene(next); }
  expect(session.transfer().resources.filter((r) => r.id.startsWith('asset-'))).toHaveLength(1); expect(JSON.stringify(session.transfer().history)).not.toContain('"10":');
  expect(session.transfer().history).toHaveLength(5); expect(session.snapshot().historyBytes).toBe(0);
  session.publishScene(Uint8Array.of(3, 4), 'signed.pdf'); session.adopt(Uint8Array.of(5, 6), 'organized.pdf', { boundary: { kind: 'page-copy', losses: ['scene-baked', 'arbitrary secret'] } });
  expect(session.scene()).toBeNull(); const metadata=session.snapshot(); metadata.current.boundary.losses.push('private raw data'); expect(session.snapshot().current.boundary.losses).toEqual(['scene-baked']); session.undo();
  const exported=session.transfer(); exported.original.capabilities.forms=true; exported.original.boundary.losses.length=0; exported.resources[0].capabilities.forms=true; expect(session.snapshot().original.capabilities).toEqual({}); expect(session.snapshot().original.boundary.losses).toEqual(['signature-rewrite']); expect(session.resource(session.scene().sourceRef).capabilities).toEqual({}); expect(session.scene().objects).toHaveLength(1);
  const independent=session.current(); independent.bytes[0]=0; independent.capabilities.forms=true; expect(session.current().bytes[0]).toBe(1); expect(session.current().capabilities).toEqual({});
  const before = JSON.stringify(session.transfer());
  const fake=(mb)=>({byteLength:mb*1024*1024,[Symbol.iterator](){throw new Error('must not copy')}}); expect(()=>session.begin(fake(201),'over.pdf',{original:{bytes:fake(250),name:'original.pdf'},resources:[{id:'source-test',bytes:fake(80),name:'source.pdf'}]})).toThrow('512 MB'); expect(JSON.stringify(session.transfer())).toBe(before);
  for (const options of [{ resources: Array.from({ length: 129 }, () => ({ bytes: Uint8Array.of(1) })) }, { scene: { version: 999 } }, { scene: { version: 1, sourceRef: 'missing', objects: [], fields: {} } }]) { expect(() => session.begin(Uint8Array.of(9), 'rejected.pdf', options)).toThrow(); expect(JSON.stringify(session.transfer())).toBe(before); }
});

test('renderer rejects invalid budgets and bounds extreme aspect ratios including integer minimum', async () => {
  for (const dimensions of [[1, 1e8], [1e8, 1], [1e5, 1e5]]) { const page = { getViewport: ({ scale }) => ({ width: dimensions[0] * scale, height: dimensions[1] * scale }) }; const view = boundedViewport(page); const width = Math.max(1, Math.floor(view.width)), height = Math.max(1, Math.floor(view.height)); expect(Math.max(width, height)).toBeLessThanOrEqual(4096); expect(width * height).toBeLessThanOrEqual(16_000_000); for (const options of [{ scale: NaN }, { maxDimension: Infinity }, { maxPixels: NaN }, { maxPixels: 1 }]) expect(() => boundedViewport(page, options)).toThrow(); }
});

test('typed Turkish and uploaded colored ink survive editable route changes, move, proportional resize and idempotent output', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'fill-sign'); await page.locator('#fieldsList [data-field=customer_name]').fill('İpek Şahin');
  await page.fill('#workspacePage', '2'); await page.locator('#workspacePage').press('Tab'); await expect(page.locator('#placementCanvas')).toHaveAttribute('data-pdf-page', '2');
  await page.click('#sigModeType'); await page.fill('#typeSigInput', 'İpek Şahin Çağrı Öztürk'); await expect(page.locator('#signaturePreview')).toBeVisible();
  await page.locator('#placementCanvas').click({ position: { x: 100, y: 160 } }); await expect(page.locator('#objectList option')).toHaveCount(1);
  await page.click('#newObjectBtn'); await page.click('#sigModeUpload'); await page.setInputFiles('#signatureInput', rootFixtures + 'transparent-signature.png');
  await expect.poll(() => page.locator('#signaturePreview').evaluate((img) => img.naturalWidth)).toBeLessThan(300);
  await page.locator('#placementCanvas').click({ position: { x: 180, y: 230 } });
  await page.fill('#objectWidth', '170'); await page.locator('#objectWidth').press('Tab');
  const ratio = await page.locator('#objectWidth').inputValue(); expect(Number(ratio)).toBe(170);
  const first = await download(page, testInfo, 'signed-first.pdf'); const doc = await PDFDocument.load(first); expect(doc.getForm().getTextField('customer_name').getText()).toBe('İpek Şahin'); expect(imageSizes(doc, 1)).toHaveLength(2); expect(new Set(imageSizes(doc, 1).map((size) => size.join('x'))).size).toBe(2);
  const second = await download(page, testInfo, 'signed-repeat.pdf'); expect([...second]).toEqual([...first]);
  await page.locator('#workspaceModes').getByRole('button', { name: 'Add Text', exact: true }).click(); await expect(page).toHaveURL(/add-text\?workflow=/); await expect(page.locator('#objectList option')).toHaveCount(2);
  await page.fill('#textInput', 'İstanbul Dünya'); await page.locator('#placementCanvas').click({ position: { x: 75, y: 90 } }); await download(page, testInfo, 'with-text.pdf');
  await page.locator('#workspaceModes').getByRole('button', { name: 'Add Image', exact: true }).click(); await expect(page).toHaveURL(/add-image\?workflow=/); await expect(page.locator('#objectList option')).toHaveCount(3);
  await page.selectOption('#pageSelect', '2'); await page.setInputFiles('#imageInput', rootFixtures + 'transparent-signature.png'); await expect(page.locator('#objectList option')).toHaveCount(4);
  await page.locator('#objectList').selectOption({ label: (await page.locator('#objectList option').allTextContents()).find((text) => text.startsWith('İstanbul')) });
  const old = Number(await page.inputValue('#objectX')); await page.fill('#objectX', String(old + 12)); await page.locator('#objectX').press('Tab');
  const final = await download(page, testInfo, 'scene-final.pdf'); expect((await extracted(page, final))[1]).toContain('İstanbul Dünya'); expect((await extracted(page, final))[1].match(/İstanbul Dünya/g)).toHaveLength(1);
  await page.locator('#workspaceModes').getByRole('button', { name: 'Fill & Sign', exact: true }).click(); await expect(page.locator('#objectList option')).toHaveCount(4); expect(errors).toEqual([]);
});

test('draw uses pointer capture, Clear removes placed draft, keyboard undo restores one exact object', async ({ page }, testInfo) => {
  await open(page, 'fill-sign', 'non-form.pdf'); const canvas = page.locator('#sigCanvas'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 35, box.y + 65); await page.mouse.down(); await page.mouse.move(box.x + 170, box.y + 30, { steps: 10 }); await page.mouse.move(box.x + 260, box.y + 110, { steps: 10 }); await page.mouse.up(); await expect(page.locator('#signaturePreview')).toBeVisible();
  await page.locator('#placementCanvas').click({ position: { x: 210, y: 250 } }); await expect(page.locator('#objectList option')).toHaveCount(1);
  await page.click('#clearSigBtn'); await expect(page.locator('#objectList option')).toHaveCount(0);
  await page.evaluate(async()=>{const lib=await(await import('/js/lib-loader.js')).ensurePdfLib(), original=lib.PDFDocument.prototype.save;window.historyHeld=false;window.historyHold=new Promise((resolve)=>{window.releaseHistory=resolve});lib.PDFDocument.prototype.save=async function(...args){if(!window.historyHeld){window.historyHeld=true;await window.historyHold}return original.apply(this,args)};window.restoreHistorySave=()=>{lib.PDFDocument.prototype.save=original}});
  await page.click('#undoEditBtn'); await expect.poll(()=>page.evaluate(()=>window.historyHeld)).toBe(true); await expect(page.locator('#applyBtn')).toBeDisabled(); await expect(page.locator('#downloadResultBtn')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden(); await page.evaluate(()=>{window.releaseHistory();window.restoreHistorySave()}); await expect(page.locator('#objectList option')).toHaveCount(1);
  await page.locator('#objectList').selectOption({ index: 0 }); const oldX = Number(await page.inputValue('#objectX')); await page.locator('.scene-object').focus(); await page.keyboard.press('Shift+ArrowRight'); expect(Number(await page.inputValue('#objectX'))).toBe(oldX + 10);
  await page.keyboard.press('Delete'); await expect(page.locator('#objectList option')).toHaveCount(0); await page.click('#undoEditBtn'); await expect(page.locator('#objectList option')).toHaveCount(1);
  const bytes = await download(page, testInfo, 'drawn.pdf'); expect(imageSizes(await PDFDocument.load(bytes), 0)).toHaveLength(1);
  const beforeFailure=await page.evaluate(async()=>JSON.stringify((await import('/js/tool-ui.js')).documentSession.transfer()));
  await page.evaluate(async()=>{const lib=await(await import('/js/lib-loader.js')).ensurePdfLib();window.beforeHistorySave=lib.PDFDocument.prototype.save;lib.PDFDocument.prototype.save=async()=>{throw new Error('injected history verification failure')}}); await page.click('#undoEditBtn'); await expect(page.locator('#errorText')).toContainText('history verification failure'); expect(await page.evaluate(async()=>JSON.stringify((await import('/js/tool-ui.js')).documentSession.transfer()))).toBe(beforeFailure); await expect(page.locator('#documentResult')).toBeHidden(); await page.evaluate(async()=>{const lib=await(await import('/js/lib-loader.js')).ensurePdfLib();lib.PDFDocument.prototype.save=window.beforeHistorySave});
});

test('real page fields preserve focus, repeated widgets sync, rotated field editor is usable and failures do not publish', async ({ page }, testInfo) => {
  await open(page, 'fill-sign'); await page.check('#flattenInput'); const flattenOnly=await download(page,testInfo,'flatten-only.pdf'); expect((await PDFDocument.load(flattenOnly)).getForm().getFields()).toHaveLength(0); expect((await extracted(page,flattenOnly)).join(' ')).toContain('Original Name'); await page.uncheck('#flattenInput'); const input = page.locator('.scene-widgets input[data-field=customer_name]');
  const beforePixels = await page.locator('#placementCanvas').evaluate((c) => c.toDataURL()); await input.fill('İpek'); await expect.poll(() => page.locator('#placementCanvas').evaluate((c) => c.toDataURL())).not.toBe(beforePixels); await expect(input).toBeFocused(); await page.keyboard.type(' Sahin');
  await expect(page.locator('#fieldsList [data-field=customer_name]')).toHaveValue('İpek Sahin');
  await page.locator('.scene-widgets input[data-field=repeated_reference]').fill('REPEATED UPDATED'); await page.fill('#workspacePage', '3'); await page.locator('#workspacePage').press('Tab'); await expect(page.locator('.scene-widgets [data-field=repeated_reference]')).toHaveValue('REPEATED UPDATED');
  await page.fill('#workspacePage', '2'); await page.locator('#workspacePage').press('Tab'); await page.locator('.scene-widget-hotspot').click(); await expect(page.locator('#pageFieldEditor')).toBeVisible(); const select = page.locator('#pageFieldEditor select'); const options = await select.locator('option').allTextContents(); await select.selectOption({ label: options.at(-1) });
  const longName='L'.repeat(306); await page.locator(`#fieldsList [data-field="${longName}"]`).fill('LONG EDITED');
  const beforeReject=await page.evaluate(async()=>JSON.stringify((await import('/js/tool-ui.js')).documentSession.transfer())); await page.locator('#fieldsList [data-field=customer_name]').fill('X'.repeat(10001)); await expect(page.locator('#errorText')).toContainText('Previous values were retained'); await expect(page.locator('#fieldsList [data-field=customer_name]')).toHaveValue('İpek Sahin'); expect(await page.evaluate(async()=>JSON.stringify((await import('/js/tool-ui.js')).documentSession.transfer()))).toBe(beforeReject);
  const bytes = await download(page, testInfo, 'fields.pdf'); const doc = await PDFDocument.load(bytes); expect(doc.getForm().getTextField('repeated_reference').getText()).toBe('REPEATED UPDATED'); expect(doc.getForm().getDropdown('category').getSelected()).toContain(options.at(-1)); expect(doc.getForm().getTextField(longName).getText()).toBe('LONG EDITED');
  await page.evaluate(async () => { const lib = await (await import('/js/lib-loader.js')).ensurePdfLib(); window.savedFlatten = lib.PDFForm.prototype.flatten; lib.PDFForm.prototype.flatten = () => { throw new Error('injected flatten failure'); }; });
  await page.check('#flattenInput'); await page.click('#applyBtn'); await expect(page.locator('#errorText')).toContainText('could not be flattened'); await expect(page.locator('#documentResult')).toBeHidden();
  await page.evaluate(async () => { const lib = await (await import('/js/lib-loader.js')).ensurePdfLib(); lib.PDFForm.prototype.flatten = window.savedFlatten; });
  const flattened = await download(page, testInfo, 'flattened.pdf'); expect((await PDFDocument.load(flattened)).getForm().getFields()).toHaveLength(0); expect((await extracted(page, flattened)).join(' ')).toContain('İpek Sahin');
});

test('oversized replacement rejects before reading and leaves chosen scene and result intact', async ({ page }, testInfo) => {
  await open(page, 'add-text', 'non-form.pdf'); await page.fill('#textInput', 'Keep this draft'); await page.locator('#placementCanvas').click({ position: { x: 80, y: 150 } }); await download(page, testInfo, 'kept.pdf');
  const result = await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'); const before = JSON.stringify(ui.documentSession.transfer()); let read = false; const parsed = await ui.readPdfFile({name:'too-big.pdf',type:'application/pdf',size:81*1024*1024,arrayBuffer(){read=true;throw new Error('must not read')}},{validate:true,maxBytes:80*1024*1024}); return {read,parsed,same:JSON.stringify(ui.documentSession.transfer())===before}; });
  expect(result).toEqual({read:false,parsed:null,same:true}); await expect(page.locator('#downloadResultBtn')).toBeVisible(); await expect(page.locator('#objectList option')).toHaveCount(1);
});

test('80 MB scene transfer serializes history references once and stale image digest cannot repopulate Clear', async () => {
  const session = createDocumentSession(); session.begin(new Uint8Array(80 * 1024 * 1024).fill(1), 'large.pdf'); session.beginScene();
  for (let index = 0; index < 8; index++) { const next = session.scene(); next.fields.name = { kind: 'text', value: String(index) }; session.changeScene(next); }
  const transfer = session.transfer(); expect(transfer.history).toHaveLength(5); expect(transfer.history.every((value) => !Object.hasOwn(value, 'bytes'))).toBe(true);
  expect(transfer.current.bytes).toBe(transfer.original.bytes); expect(transfer.current.bytes).toBe(transfer.resources[0].bytes);
  expect(new Set([transfer.current.bytes, transfer.original.bytes, ...transfer.resources.map((value) => value.bytes)]).size).toBe(1);
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle); let release; const delayed = new Promise((resolve) => { release = resolve; });
  crypto.subtle.digest = async (...args) => { await delayed; return originalDigest(...args); };
  try { const pending = session.addAsset(Uint8Array.of(7, 8), 'image/png'); session.clear(); release(); await expect(pending).rejects.toThrow('cancelled'); expect(session.snapshot().resourceBytes).toBe(0); }
  finally { crypto.subtle.digest = originalDigest; }
});

test('EXIF portrait image normalizes once and actual preview equals the downloaded PDF', async ({ page }, testInfo) => {
  await open(page, 'add-image', 'non-form.pdf'); await page.evaluate(async () => { const ui=await import('/js/tool-ui.js'); const current=ui.documentSession.snapshot({includeBytes:true}).current; ui.documentSession.publishScene(current.bytes,current.name,{capabilities:{searchable:true}}); }); await page.selectOption('#pageSelect', '1'); await page.setInputFiles('#imageInput', rootFixtures + 'oriented.jpg'); await expect(page.locator('#objectList option')).toHaveCount(1);
  const bytes = await download(page, testInfo, 'oriented-image.pdf'); expect(imageSizes(await PDFDocument.load(bytes), 0)).toEqual([[40, 20]]); expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().current.capabilities.searchable)).toBe(true);
  await expect.poll(() => page.evaluate(async (bytes) => {
    const runtime = await import('/js/lib-loader.js'); const pdfjs = await runtime.ensurePdfJs(); const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS });
    try { const doc = await task.promise, page = await doc.getPage(1), actual = document.querySelector('#previewCanvas'), viewport = page.getViewport({ scale: Number(actual.dataset.pdfScale) }), expected = document.createElement('canvas'); expected.width = actual.width; expected.height = actual.height; await page.render({ canvasContext: expected.getContext('2d'), viewport }).promise;
      const a = actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data, b = expected.getContext('2d').getImageData(0,0,expected.width,expected.height).data; let different = 0; for (let i=0;i<a.length;i++) if(a[i]!==b[i]) different++; return different;
    } finally { await task.destroy(); }
  }, [...bytes])).toBe(0);
});

test('saved text geometry matches four rotations, nonzero CropBox and UserUnit', async ({ page }, testInfo) => {
  const source = await PDFDocument.create(); for (const rotation of [0, 90, 180, 270]) { const p = source.addPage([500, 600]); p.setCropBox(40, 60, 400, 480); p.setRotation(degrees(rotation)); if (rotation === 270) p.node.set(PDFName.of('UserUnit'), PDFNumber.of(2)); }
  await page.goto('/add-text'); const reject = page.getByRole('button', { name: 'Reject', exact: true }); if (await reject.isVisible()) await reject.click();
  await page.setInputFiles('#fileInput', { name: 'geometry.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) }); await expect(page.locator('#workspaceModes')).toBeVisible();
  const expected = [];
  for (let index=0;index<4;index++) {
    await page.locator('#pageGrid .page-tile').nth(index).click(); await page.fill('#textInput', `MARK${index}`); await page.locator('#placementCanvas').click({position:{x:120,y:150}}); const box = await page.locator('#placementCanvas').boundingBox(); expected.push({width:box.width,height:box.height}); if (index === 3) { const width = Number(await page.inputValue('#objectWidth')); await page.fill('#objectWidth', String(width * 1.5)); await page.locator('#objectWidth').press('Tab'); const validWidth=await page.inputValue('#objectWidth'); const revision=await page.evaluate(async()=>(await import('/js/tool-ui.js')).documentSession.snapshot().revision); await page.fill('#objectWidth','100000000'); await page.locator('#objectWidth').press('Tab'); await expect(page.locator('#objectWidth')).toHaveValue(validWidth); expect(await page.evaluate(async()=>(await import('/js/tool-ui.js')).documentSession.snapshot().revision)).toBe(revision); } await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  }
  const bytes = await download(page, testInfo, 'geometry.pdf');
  const placements = await page.evaluate(async (bytes) => { const runtime=await import('/js/lib-loader.js'), task=(await runtime.ensurePdfJs()).getDocument({data:Uint8Array.from(bytes),...runtime.PDFJS_ASSET_URLS});try{const doc=await task.promise, placements=[];for(let i=0;i<4;i++){const page=await doc.getPage(i+1), view=page.getViewport({scale:1}), item=(await page.getTextContent()).items.find((item)=>item.str===`MARK${i}`);placements.push({point:view.convertToViewportPoint(item.transform[4],item.transform[5]),width:view.width,height:view.height,fontSize:Math.hypot(item.transform[0],item.transform[1])*page.userUnit});}return placements;}finally{await task.destroy()}},[...bytes]);
  for(let i=0;i<4;i++){expect(placements[i].point[0]*expected[i].width/placements[i].width).toBeCloseTo(120,0);expect(placements[i].point[1]*expected[i].height/placements[i].height).toBeCloseTo(i===3?150+7*expected[i].height/placements[i].height:150,0);expect(placements[i].fontSize).toBeCloseTo(i===3?21:14,0)}
});

test('deduplicated route handoff retains original, current and source role descriptors', async ({ page }) => {
  await open(page, 'add-text', 'non-form.pdf');
  const handoff = await page.evaluate(async () => {
    const ui=await import('/js/tool-ui.js'), original=ui.documentSession.snapshot({includeBytes:true}).current;
    ui.documentSession.adopt(original.bytes,'renamed.pdf',{capabilities:{searchable:true},boundary:{kind:'pdf-rewrite',losses:['signature-rewrite']}});
    ui.documentSession.beginScene();
    return ui.stashForChain(original.bytes,'renamed.pdf','fill-sign',{capabilities:{searchable:true},boundary:{kind:'pdf-rewrite',losses:['signature-rewrite']}});
  });
  await page.goto(`/fill-sign?workflow=${handoff.workflowId}&file=${encodeURIComponent(handoff.fileId)}`); await expect(page.locator('#workspaceModes')).toBeVisible();
  const state=await page.evaluate(async()=>{const ui=await import('/js/tool-ui.js'),state=ui.documentSession.snapshot(),scene=ui.documentSession.scene(),resource=ui.documentSession.resource(scene.sourceRef);return{original:state.original,current:state.current,source:{name:resource.name,type:resource.type,capabilities:resource.capabilities,boundary:resource.boundary}}});
  expect(state.original.name).toBe('non-form.pdf'); expect(state.original.capabilities).toEqual({}); expect(state.current.name).toBe('renamed.pdf'); expect(state.current.capabilities.searchable).toBe(true); expect(state.current.boundary.losses).toEqual(['signature-rewrite']); expect(state.source.name).toBe('renamed.pdf'); expect(state.source.boundary.losses).toEqual(['signature-rewrite']);
});

test('Apply freezes all live field editors and preserves visible values through a delayed save', async ({ page }, testInfo) => {
  await open(page, 'fill-sign'); const input=page.locator('.scene-widgets [data-field=customer_name]'); const pixels=await page.locator('#placementCanvas').evaluate((c)=>c.toDataURL()); await input.fill('İpek before Apply'); await expect.poll(()=>page.locator('#placementCanvas').evaluate((c)=>c.toDataURL())).not.toBe(pixels);
  await page.evaluate(async()=>{const lib=await(await import('/js/lib-loader.js')).ensurePdfLib(), original=lib.PDFDocument.prototype.save;window.held=false;window.saveHold=new Promise((resolve)=>{window.releaseSave=resolve});lib.PDFDocument.prototype.save=async function(...args){if(!window.held){window.held=true;await window.saveHold}return original.apply(this,args)};window.restoreSave=()=>{lib.PDFDocument.prototype.save=original}});
  await page.click('#applyBtn'); await expect.poll(()=>page.evaluate(()=>window.held)).toBe(true); await expect(input).toBeDisabled(); await expect(page.locator('#fieldsList [data-field=customer_name]')).toBeDisabled(); await expect(page.locator('#textInput')).toBeDisabled(); await page.keyboard.type('MUST NOT ENTER');
  await expect(input).toHaveValue('İpek before Apply'); await page.evaluate(()=>{window.releaseSave();window.restoreSave()}); await expect(page.locator('#documentResultStatus')).toContainText('actual file'); await expect(input).toBeEnabled();
  const [result]=await Promise.all([page.waitForEvent('download'),page.click('#downloadResultBtn')]); const file=testInfo.outputPath('delayed.pdf');await result.saveAs(file);expect((await PDFDocument.load(await readFile(file))).getForm().getTextField('customer_name').getText()).toBe(await input.inputValue());
});
