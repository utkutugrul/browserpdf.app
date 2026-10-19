import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';

async function source(name = 'preparation.pdf') {
  const doc = await PDFDocument.create(); doc.addPage([612, 792]); doc.addPage([612, 792]);
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}
async function open(page, mode = 'fill-sign') {
  await page.goto('/' + mode); const reject = page.getByRole('button', { name: 'Reject', exact: true }); if (await reject.isVisible()) await reject.click();
  await page.setInputFiles('#fileInput', await source()); await expect(page.locator('#placementCanvas')).toHaveAttribute('data-pdf-page', '1');
}
async function save(page, testInfo, name) {
  await expect(page.locator('#applyBtn')).toBeEnabled(); await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); const file = testInfo.outputPath(name); await download.saveAs(file); return new Uint8Array(await readFile(file));
}
function imageHashes(bytes) { return PDFDocument.load(bytes).then((doc) => doc.context.enumerateIndirectObjects().filter(([, object]) => object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image').map(([, object]) => createHash('sha256').update(object.getContents()).digest('hex'))); }
async function text(page, bytes, number = 1) { return page.evaluate(async ({bytes,number}) => { const runtime = await import('/js/lib-loader.js'), task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS }); try { const doc = await task.promise; return (await (await doc.getPage(number)).getTextContent()).items.filter((item) => typeof item.str === 'string').map((item) => item.str).join(' '); } finally { await task.destroy(); } }, { bytes: [...bytes], number }); }
async function alpha(page, testInfo, mode) {
  await open(page, mode);
  if (mode === 'fill-sign') { await page.click('#sigModeType'); await page.fill('#typeSigInput', 'ALPHA'); await expect(page.locator('#placeDraftBtn')).toBeEnabled(); }
  else { await page.fill('#textInput', 'ALPHA'); await expect(page.locator('#placeDraftBtn')).toBeEnabled(); }
  await page.locator('#placementCanvas').click({ position: { x: 180, y: 180 } }); await expect(page.locator('#objectList option')).toHaveCount(1);
  const bytes = await save(page, testInfo, mode + '-alpha.pdf');
  await page.locator('.scene-object').click();
  await page.evaluate(() => { window.previousDownload = document.getElementById('downloadResultBtn'); }); return bytes;
}
async function gated(page) {
  await expect(page.locator('#applyBtn')).toBeDisabled(); await expect(page.locator('#placeDraftBtn')).toBeDisabled(); await expect(page.locator('#workspaceModes button')).toHaveCount(7);
  expect(await page.locator('#workspaceModes button').evaluateAll((buttons) => buttons.map((button) => button.dataset.mode))).toEqual(['add-text', 'add-image', 'fill-sign', 'organize', 'view-pdf', 'highlight', 'redact']);
  for (const button of await page.locator('#workspaceModes button').all()) await expect(button).toBeDisabled();
  await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#downloadResultBtn')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden(); await expect(page.locator('#sceneStatus')).toContainText('Preparing');
  const url = page.url(); await page.evaluate(() => { window.previousDownload?.click(); document.getElementById('applyBtn').click(); document.querySelector('#workspaceModes button').click(); }); expect(page.url()).toBe(url);
}
async function holdCaptures(page) {
  await page.evaluate(() => { const proto = HTMLCanvasElement.prototype, original = proto.toBlob; window.captureHolds = []; window.captureReleased = 0;
    proto.toBlob = function(callback, ...args) { if (this.id !== 'sigCanvas') return original.call(this, callback, ...args); const canvas = this, entry = { text: document.getElementById('typeSigInput').value, released: false }; entry.release = () => { if (entry.released) return; entry.released = true; original.call(canvas, (blob) => { window.captureReleased++; callback(blob); }, ...args); }; window.captureHolds.push(entry); };
    window.releaseCaptureText = (text) => window.captureHolds.filter((entry) => entry.text === text).forEach((entry) => entry.release()); window.releaseAllCaptures = () => window.captureHolds.forEach((entry) => entry.release()); window.restoreCaptures = () => { proto.toBlob = original; };
  });
}
async function waitCapture(page, text) { await expect.poll(() => page.evaluate((text) => window.captureHolds.some((entry) => entry.text === text), text)).toBe(true); }
async function signatureId(page) { return page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.scene().objects.find((object) => object.kind === 'signature')?.assetId); }

test('selected cold-font text blocks old results and mode changes until the latest validated text is exportable', async ({ page }, testInfo) => {
  const errors = [], downloads = []; page.on('pageerror', (error) => errors.push(error.message)); page.on('download', (item) => downloads.push(item));
  await alpha(page, testInfo, 'add-text'); downloads.length = 0;
  let release, held = false; const gate = new Promise((resolve) => { release = resolve; }); await page.route('**/fonts/NotoSans-Bold.ttf', async (route) => { held = true; await gate; await route.continue(); });
  await page.selectOption('#fontSelect', 'helvetica-bold'); await page.fill('#textInput', 'BETA'); await expect.poll(() => held).toBe(true); await gated(page); await expect(page.locator('#textInput')).toBeEnabled();
  release(); await expect(page.locator('#applyBtn')).toBeEnabled(); await expect.poll(() => page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.scene().objects[0].text)).toBe('BETA'); expect(downloads).toHaveLength(0);
  const beta = await save(page, testInfo, 'bold-beta.pdf'); expect(await text(page, beta)).toBe('BETA'); const fonts = (await PDFDocument.load(beta)).context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFDict).map(([, object]) => object.get(PDFName.of('BaseFont'))?.toString()).filter(Boolean); expect(fonts.some((name) => name.includes('NotoSans-Bold'))).toBe(true);
  await page.locator('.scene-object').click(); await page.fill('#textInput', '😀'); await expect(page.locator('#errorText')).toContainText('Previous text was retained'); await expect(page.locator('#textInput')).toHaveValue('BETA'); await expect(page.locator('#applyBtn')).toBeEnabled(); await expect(page.locator('#documentResult')).toBeHidden();
  const restored = await save(page, testInfo, 'rejected-restored-beta.pdf'); expect([...restored]).toEqual([...beta]); expect(errors).toEqual([]);
});

test('selected signature holds capture atomically and an older completion cannot unlock a superseding signature', async ({ page }, testInfo) => {
  const errors = [], downloads = []; page.on('pageerror', (error) => errors.push(error.message)); page.on('download', (item) => downloads.push(item));
  const original = await alpha(page, testInfo, 'fill-sign'), originalId = await signatureId(page); downloads.length = 0;
  await holdCaptures(page); await page.fill('#typeSigInput', 'BETA'); await waitCapture(page, 'BETA'); await gated(page); expect(await signatureId(page)).toBe(originalId);
  await page.evaluate(() => window.releaseCaptureText('BETA')); await expect(page.locator('#applyBtn')).toBeEnabled(); await expect.poll(() => signatureId(page)).not.toBe(originalId); expect(downloads).toHaveLength(0);
  const beta = await save(page, testInfo, 'signature-beta.pdf'); expect(await imageHashes(beta)).not.toEqual(await imageHashes(original));
  await page.locator('.scene-object').click(); await page.fill('#typeSigInput', 'GAMMA'); await waitCapture(page, 'GAMMA'); await page.fill('#typeSigInput', 'DELTA'); await waitCapture(page, 'DELTA');
  await page.evaluate(() => window.releaseCaptureText('GAMMA')); await expect.poll(() => page.evaluate(() => window.captureReleased)).toBe(2); await gated(page); await expect(page.locator('#typeSigInput')).toHaveValue('DELTA');
  const betaId = await signatureId(page); await page.evaluate(() => window.releaseCaptureText('DELTA')); await expect.poll(() => signatureId(page)).not.toBe(betaId); await expect(page.locator('#applyBtn')).toBeEnabled();
  const delta = await save(page, testInfo, 'signature-delta.pdf'); expect(await imageHashes(delta)).not.toEqual(await imageHashes(beta)); await page.evaluate(() => { window.restoreCaptures(); window.releaseAllCaptures(); }); expect(errors).toEqual([]);
});

for (const kind of ['draw', 'upload']) test(`${kind} signature preparation cancels when its source changes and does not unlock the next pending draft`, async ({ page }, testInfo) => {
  const original = await alpha(page, testInfo, 'fill-sign'); await holdCaptures(page);
  if (kind === 'draw') { await page.click('#sigModeDraw'); const box = await page.locator('#sigCanvas').boundingBox(); await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + box.width * .6, box.y + box.height * .6, { steps: 5 }); await page.mouse.up(); await expect.poll(() => page.evaluate(() => window.captureHolds.length)).toBeGreaterThan(0); }
  else {
    await page.evaluate(() => { const digest = crypto.subtle.digest.bind(crypto.subtle); let first = true; const gate = new Promise((resolve) => { window.releaseSignatureHash = resolve; }); window.signatureHashHeld = false; crypto.subtle.digest = async (...args) => { const name = typeof args[0] === 'string' ? args[0] : args[0]?.name; if (first && name === 'SHA-256') { first = false; window.signatureHashHeld = true; await gate; } return digest(...args); }; window.restoreSignatureHash = () => { crypto.subtle.digest = digest; }; });
    const image = createCanvas(80, 30); image.getContext('2d').fillRect(5, 5, 65, 15); await page.click('#sigModeUpload'); await page.setInputFiles('#signatureInput', { name: 'uploaded.png', mimeType: 'image/png', buffer: image.toBuffer('image/png') }); await expect.poll(() => page.evaluate(() => window.signatureHashHeld)).toBe(true);
  }
  await gated(page); await page.click('#sigModeType'); await page.fill('#typeSigInput', 'LATEST'); await waitCapture(page, 'LATEST');
  if (kind === 'draw') await page.evaluate(() => window.captureHolds.filter((entry) => entry.text !== 'LATEST').forEach((entry) => entry.release())); else await page.evaluate(() => window.releaseSignatureHash());
  await gated(page); await expect(page.locator('#typeSigInput')).toHaveValue('LATEST');
  await page.evaluate(() => window.releaseCaptureText('LATEST')); await expect(page.locator('#applyBtn')).toBeEnabled(); const latest = await save(page, testInfo, kind + '-latest.pdf'); expect(await imageHashes(latest)).not.toEqual(await imageHashes(original));
  await page.evaluate(() => { window.restoreCaptures(); window.releaseAllCaptures(); window.restoreSignatureHash?.(); });
});

for (const mode of ['add-text', 'fill-sign']) test(`keyboard creates, nudges and saves an initial ${mode} object`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 }); await open(page, mode);
  if (mode === 'fill-sign') { await page.locator('#sigModeType').focus(); await page.keyboard.press('Enter'); await page.locator('#typeSigInput').focus(); await page.keyboard.type('Keyboard Signature'); }
  else { await page.locator('#textInput').focus(); await page.keyboard.type('KEYBOARD TEXT'); }
  const place = page.locator('#placeDraftBtn'); await expect(place).toBeEnabled(); await place.focus(); await page.keyboard.press('Enter'); await expect(page.locator('#objectList option')).toHaveCount(1); await expect(page.locator('.scene-object')).toBeFocused();
  const x = Number(await page.inputValue('#objectX')), y = Number(await page.inputValue('#objectY')); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('ArrowDown'); expect(Number(await page.inputValue('#objectX'))).toBeCloseTo(x + 10, 2); expect(Number(await page.inputValue('#objectY'))).toBeCloseTo(y + 1, 2);
  const bytes = await save(page, testInfo, mode + '-keyboard.pdf');
  if (mode === 'add-text') { expect(await text(page, bytes)).toBe('KEYBOARD TEXT'); const point = await page.evaluate(async (bytes) => { const runtime = await import('/js/lib-loader.js'), task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS }); try { const doc = await task.promise, p = await doc.getPage(1), item = (await p.getTextContent()).items.find((item) => item.str === 'KEYBOARD TEXT'); return p.getViewport({ scale: 1 }).convertToViewportPoint(item.transform[4], item.transform[5]); } finally { await task.destroy(); } }, [...bytes]); expect(point[0]).toBeCloseTo(x + 10, 1); expect(point[1]).toBeCloseTo(y + 1 + 14, 1); }
  else expect(await imageHashes(bytes)).toHaveLength(2);
});

for (const rejected of [false, true]) test(`current page render completes after an unplaced ${rejected ? 'rejected' : 'valid'} draft intent`, async ({ page }, testInfo) => {
  await open(page, 'add-text');
  await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'), runtime = await import('/js/lib-loader.js'), task = (await runtime.ensurePdfJs()).getDocument({ data: ui.documentSession.current().bytes, ...runtime.PDFJS_ASSET_URLS }); const doc = await task.promise, p = await doc.getPage(2), proto = Object.getPrototypeOf(p), original = proto.render; await task.destroy(); let held = false; const gate = new Promise((resolve) => { window.releasePageRender = resolve; }); window.pageRenderHeld = false; proto.render = function(...args) { const job = original.apply(this, args); if (!held && this.pageNumber === 2) { held = true; window.pageRenderHeld = true; return { promise: Promise.all([job.promise, gate]), cancel: (...args) => job.cancel(...args) }; } return job; }; window.restorePageRender = () => { proto.render = original; }; });
  await page.fill('#workspacePage', '2'); await page.locator('#workspacePage').press('Tab'); await expect.poll(() => page.evaluate(() => window.pageRenderHeld)).toBe(true);
  await page.fill('#textInput', rejected ? '😀' : 'UNPLACED');
  if (rejected) await expect(page.locator('#errorText')).toContainText('Previous text was retained');
  await page.evaluate(() => { window.releasePageRender(); window.restorePageRender(); }); await expect(page.locator('#placementCanvas')).toHaveAttribute('data-pdf-page', '2'); await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy', 'false');
  if (rejected) await page.fill('#textInput', 'RECOVERED'); await expect(page.locator('#placeDraftBtn')).toBeEnabled(); await page.locator('#placeDraftBtn').press('Enter');
  const bytes = await save(page, testInfo, rejected ? 'rejected-render-recovery.pdf' : 'unplaced-render-recovery.pdf'); expect(await text(page, bytes, 2)).toBe(rejected ? 'RECOVERED' : 'UNPLACED');
});
