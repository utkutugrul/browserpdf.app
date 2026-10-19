import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, PDFDict, PDFName, StandardFonts, degrees } from 'pdf-lib';

async function input(name = 'shell.pdf') {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [doc.addPage([612, 792]), doc.addPage([500, 400])]; pages[1].setCropBox(40, 30, 400, 300); pages[1].setRotation(degrees(90));
  pages.forEach((p, i) => p.drawText(`SHELL PAGE ${i + 1}`, { x: 60, y: 250, font, size: 16 }));
  const field = doc.getForm().createTextField('name'); field.addToPage(pages[0], { x: 65, y: 640, width: 350, height: 28, font }); field.setText('Original');
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}
function image(name, width, height, color) { const canvas = createCanvas(width, height), ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, width, height); return { name, mimeType: 'image/png', buffer: canvas.toBuffer('image/png') }; }
function sizes(doc, index) { const dict = doc.getPage(index).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict); return dict ? dict.keys().map((key) => doc.context.lookup(dict.get(key))).filter((o) => o.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image').map((o) => [o.dict.get(PDFName.of('Width')).asNumber(), o.dict.get(PDFName.of('Height')).asNumber()]) : []; }
async function open(page, mode = 'add-image', locale = '', filename) {
  await page.goto('/' + (locale ? locale + '/' : '') + mode); const reject = page.getByRole('button', { name: 'Reject', exact: true }); if (await reject.isVisible()) await reject.click();
  await page.setInputFiles('#fileInput', await input(filename)); await expect(page.locator(mode === 'add-image' ? '#previewCanvas' : '#placementCanvas')).toHaveAttribute('data-pdf-page', '1');
}
async function save(page, testInfo, name) {
  await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  const [result] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); const file = testInfo.outputPath(name); await result.saveAs(file); return PDFDocument.load(await readFile(file));
}

test('rapid image intakes retain their own asset dimensions, page scope and insertion order', async ({ page }, testInfo) => {
  await open(page);
  await page.evaluate(() => { const digest = crypto.subtle.digest.bind(crypto.subtle); let first = true; window.assetHeld = false; const hold = new Promise((resolve) => { window.releaseAsset = resolve; }); crypto.subtle.digest = async (...args) => { const algorithm = typeof args[0] === 'string' ? args[0] : args[0]?.name; if (first && algorithm === 'SHA-256') { first = false; window.assetHeld = true; await hold; } return digest(...args); }; window.restoreDigest = () => { crypto.subtle.digest = digest; }; });
  await page.selectOption('#pageSelect', '1'); await page.setInputFiles('#imageInput', image('wide-red.png', 80, 20, '#ff0000')); await expect.poll(() => page.evaluate(() => window.assetHeld)).toBe(true);
  await page.selectOption('#pageSelect', '2'); await page.setInputFiles('#imageInput', image('tall-blue.png', 20, 80, '#0000ff')); await page.evaluate(() => { window.releaseAsset(); window.restoreDigest(); });
  await expect(page.locator('#objectList option')).toHaveCount(2);
  const order = await page.locator('#objectList option').allTextContents();
  const doc = await save(page, testInfo, 'two-intakes.pdf');
  const drawn = await page.evaluate(async (bytes) => {
    const runtime = await import('/js/lib-loader.js'), pdfjs = await runtime.ensurePdfJs(), task = pdfjs.getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS });
    try { const doc = await task.promise, output = [];
      for (let i = 1; i <= doc.numPages; i++) { const pdfPage = await doc.getPage(i), ops = await pdfPage.getOperatorList(), stack = [], images = []; let matrix = [1, 0, 0, 1, 0, 0];
        for (let j = 0; j < ops.fnArray.length; j++) { const op = ops.fnArray[j], args = ops.argsArray[j]; if (op === pdfjs.OPS.save) stack.push(matrix); if (op === pdfjs.OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0]; if (op === pdfjs.OPS.transform) matrix = pdfjs.Util.transform(matrix, args); if (op === pdfjs.OPS.paintImageXObject) { const actual = pdfjs.Util.transform(pdfPage.getViewport({ scale: 1 }).transform, matrix); images.push({ width: Math.hypot(actual[0], actual[1]), height: Math.hypot(actual[2], actual[3]) }); } }
        output.push(images);
      } return output;
    } finally { await task.destroy(); }
  }, [...await readFile(testInfo.outputPath('two-intakes.pdf'))]);
  const actual = { pages: [sizes(doc, 0), sizes(doc, 1)], order, drawn };
  await testInfo.attach('saved-image-intakes', { body: JSON.stringify(actual, null, 2), contentType: 'application/json' });
  expect(actual.pages).toEqual([[[80, 20]], [[20, 80]]]); expect(order[0]).toContain('Page 1'); expect(order[1]).toContain('Page 2');
  expect(drawn[0]).toHaveLength(1); expect(drawn[1]).toHaveLength(1); expect(drawn[0][0].width / drawn[0][0].height).toBeCloseTo(4, 6); expect(drawn[1][0].width / drawn[1][0].height).toBeCloseTo(.25, 6);
});

test('result review begins on the edited page, preserves it for source toggles and skips a ready page reselect', async ({ page }, testInfo) => {
  await open(page, 'add-text');
  await page.fill('#workspacePage', '2'); await page.locator('#workspacePage').press('Tab'); await expect(page.locator('#placementCanvas')).toHaveAttribute('data-pdf-page', '2');
  await page.fill('#textInput', 'SELECTED PAGE REVIEW'); await page.locator('#placementCanvas').click({ position: { x: 100, y: 120 } });
  await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy', 'false');
  const before = await page.locator('#placementCanvas').evaluate((canvas) => { window.readyMutations = []; const observer = new MutationObserver((records) => window.readyMutations.push(...records.map((r) => r.attributeName))); observer.observe(canvas, { attributes: true }); window.readyObserver = observer; return canvas.toDataURL(); });
  await page.locator('#pageGrid .page-tile').nth(1).click(); await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy', 'false');
  const same = await page.locator('#placementCanvas').evaluate((canvas) => { window.readyObserver.disconnect(); return { mutations: window.readyMutations, pixels: canvas.toDataURL() }; }); expect(same.mutations).not.toContain('aria-busy'); expect(same.pixels).toBe(before);
  const doc = await save(page, testInfo, 'selected-page.pdf'); expect(doc.getPageCount()).toBe(2);
  await expect(page.locator('#useResultBtn')).toHaveCount(0); expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.scene().objects.length)).toBe(1);
  await expect(page.locator('#documentResultPage')).toHaveText('2 / 2'); await expect(page.locator('#documentResultPreview canvas')).toHaveAttribute('data-pdf-page', '2');
  await page.getByRole('button', { name: 'Show original', exact: true }).click(); await expect(page.locator('#documentResultStatus')).toContainText('Original:'); await expect(page.locator('#documentResultPage')).toHaveText('2 / 2');
  await page.getByRole('button', { name: 'Show result', exact: true }).click(); await expect(page.locator('#documentResultStatus')).toContainText('Result:'); await expect(page.locator('#documentResultPage')).toHaveText('2 / 2');
  await page.getByRole('button', { name: 'Previous page', exact: true }).click(); await expect(page.locator('#documentResultPage')).toHaveText('1 / 2');
  await page.locator('#workspaceModes').getByRole('button', { name: 'Add Image', exact: true }).click(); await expect(page).toHaveURL(/add-image\?workflow=/); await expect(page.locator('#objectList option')).toHaveCount(1);
  await page.locator('#objectList').selectOption({ index: 0 }); const x = Number(await page.inputValue('#objectX')); await page.fill('#objectX', String(x + 10)); await page.locator('#objectX').press('Tab');
  await page.locator('#workspaceModes').getByRole('button', { name: 'Add Text', exact: true }).click(); await expect(page.locator('#objectList option')).toHaveCount(1); await page.locator('#objectList').selectOption({ index: 0 }); expect(Number(await page.inputValue('#objectX'))).toBeCloseTo(x + 10, 2);
});

for (const width of [320, 390, 768, 1440]) test(`compact task controls fit ${width}px in light and dark RTL without losing field focus`, async ({ page }, testInfo) => {
  const height = width <= 390 ? 720 : 900; await page.setViewportSize({ width, height });
  for (const [locale, theme] of [['', 'light'], ['ar', 'dark']]) {
    await open(page, 'fill-sign', locale, `Document-${'review-and-sign-'.repeat(8)}.pdf`); await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await expect(page.locator('#objectWorkspace')).toBeVisible(); await expect(page.locator('.scene-replace')).not.toHaveAttribute('open', '');
    await expect(page.locator('#dropzone')).toBeHidden();
    const layout = await page.evaluate(() => { const byId = (id) => document.getElementById(id).getBoundingClientRect(), scroller = document.querySelector('.scene-canvas-scroll'), canvas = byId('placementCanvas'); return { width: document.documentElement.clientWidth, height: innerHeight, scroll: document.documentElement.scrollWidth, canvasTop: canvas.top, canvasHeight: canvas.height, visibleCanvas: Math.max(0, Math.min(innerHeight, canvas.bottom) - Math.max(0, canvas.top)), toolbarTop: byId('workspaceModes').top, applyTop: byId('applyBtn').top, identityTop: byId('documentIdentity').top, pageWidth: scroller.clientWidth, pageScroll: scroller.scrollWidth, rtl: document.documentElement.dir }; });
    await testInfo.attach(`${width}-${theme}-layout`, { body: JSON.stringify(layout), contentType: 'application/json' });
    expect(layout.scroll).toBeLessThanOrEqual(layout.width); expect(layout.canvasTop).toBeGreaterThanOrEqual(0); expect(layout.canvasTop).toBeLessThan(550); expect(layout.visibleCanvas).toBeGreaterThanOrEqual(Math.min(layout.height * .35, layout.canvasHeight / 2)); expect(layout.toolbarTop).toBeLessThan(400); expect(layout.applyTop).toBeLessThan(550); expect(layout.identityTop).toBeLessThan(320); expect(layout.pageScroll).toBeLessThanOrEqual(layout.pageWidth + 1); if (locale) expect(layout.rtl).toBe('rtl');
    await expect(page.locator('.document-identity-revision')).toBeVisible(); expect(await page.locator('#documentIdentity').getAttribute('title')).toContain('Document-review-and-sign');
    if (width <= 390) await expect(page.locator('.scene-thumbnails')).not.toHaveAttribute('open', '');
    const pixels = await page.locator('#placementCanvas').evaluate((canvas) => canvas.toDataURL());
    const input = page.locator('.scene-widgets input[data-field=name]'); await input.fill('Caret survives'); await input.press('Home'); await input.press('ArrowRight');
    const identity = await input.evaluate((input) => { window.focusedWidget = input; return { start: input.selectionStart, end: input.selectionEnd }; });
    const owner = await page.evaluate(async () => {
      const entry = document.querySelector('script[type=module][src$="js/fill-sign.js"]'), moduleUrl = new URL('./tool-ui.js', entry.src).href;
      const { taskId, revision } = (await import(moduleUrl)).documentSession.snapshot(); return { moduleUrl, taskId, revision };
    }); expect(owner.taskId).toBeTruthy(); expect(owner.revision).toBeGreaterThan(0);
    await expect.poll(() => page.locator('#placementCanvas').evaluate((canvas) => canvas.toDataURL())).not.toBe(pixels);
    await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#placementCanvas')).toHaveAttribute('data-scene-revision', String(owner.revision)); await expect(input).toBeFocused();
    const retained = await input.evaluate((input) => ({ same: input === window.focusedWidget, start: input.selectionStart, end: input.selectionEnd }));
    await testInfo.attach(`${width}-${theme}-caret`, { body: JSON.stringify({ owner, before: identity, after: retained }), contentType: 'application/json' }); expect(retained).toEqual({ same: true, ...identity });
    const resolution = await page.locator('#placementCanvas').evaluate((canvas) => canvas.width); await page.locator('#workspaceZoom').selectOption('2');
    await expect.poll(() => page.locator('#placementCanvas').evaluate((canvas) => canvas.width)).toBe(resolution * 2); await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy', 'false'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.locator('#workspaceZoom').selectOption('1'); await expect.poll(() => page.locator('#placementCanvas').evaluate((canvas) => canvas.width)).toBe(resolution); await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy', 'false');
    await page.screenshot({ path: testInfo.outputPath(`${width}-${theme}-${locale || 'en'}.png`), fullPage: true });
  }
});

test('external PDF validation and explicit adoption callback leave task ownership deliberate', async ({ page }) => {
  await open(page, 'add-text');
  const result = await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), bytes = ui.documentSession.current().bytes;
    const scene = ui.documentSession.scene(); scene.fields.name = { kind: 'text', value: 'Field only' }; ui.documentSession.changeScene(scene);
    const fieldInput = await ui.getWorkspaceInput(), before = JSON.stringify(ui.documentSession.transfer());
    const external = await ui.readExternalPdfFile(new File([bytes], 'extra.pdf', { type: 'application/pdf' }));
    let rejected = false; try { await ui.readExternalPdfFile(new File(['%PDF-1.7\nbroken structure'], 'broken.pdf', { type: 'application/pdf' })); } catch { rejected = true; }
    let aborted = false; const controller = new AbortController(); controller.abort(); try { await ui.readExternalPdfFile(new File([bytes], 'abort.pdf', { type: 'application/pdf' }), { signal: controller.signal }); } catch (error) { aborted = error.name === 'AbortError'; }
    const active = new AbortController(), post = Worker.prototype.postMessage; let duringRead = false;
    Worker.prototype.postMessage = function(message, ...args) { const result = post.call(this, message, ...args); if (message?.action === 'GetDocRequest') { duringRead = true; active.abort(); } return result; };
    let readAborted = false; try { await ui.readExternalPdfFile(new File([bytes], 'abort-read.pdf', { type: 'application/pdf' }), { signal: active.signal }); } catch (error) { readAborted = error.name === 'AbortError'; } finally { Worker.prototype.postMessage = post; }
    const limited = await ui.readPdfFile(new File([bytes], 'two-pages.pdf', { type: 'application/pdf' }), { validate: true, maxPages: 1 });
    window.adoptionCount = 0; await ui.reviewResult(bytes, 'chosen.pdf', { onAdopt(snapshot, artifact) { window.adoptionCount++; window.adopted = { name: artifact.name, taskId: snapshot.taskId }; artifact.bytes.fill(0); } });
    return { untouched: before === JSON.stringify(ui.documentSession.transfer()), rejected, aborted, duringRead, readAborted, limited, losses: fieldInput.losses, pages: external.pageCount, beforeCount: window.adoptionCount };
  }); expect(result).toEqual({ untouched: true, rejected: true, aborted: true, duringRead: true, readAborted: true, limited: null, losses: ['scene-baked'], pages: 2, beforeCount: 0 });
  await page.click('#useResultBtn'); expect(await page.evaluate(async () => ({ count: window.adoptionCount, name: window.adopted.name, magic: String.fromCharCode(...(await import('/js/tool-ui.js')).documentSession.current().bytes.slice(0, 4)) }))).toEqual({ count: 1, name: 'chosen.pdf', magic: '%PDF' });
  const stale = await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), bytes = ui.documentSession.current().bytes;
    await ui.reviewResult(bytes, 'stale.pdf', { onAdopt() { window.adoptionCount++; } }); const button = document.getElementById('useResultBtn');
    ui.documentSession.clear(); button.click(); return { count: window.adoptionCount, current: ui.documentSession.current() };
  }); expect(stale).toEqual({ count: 1, current: null });
  const standalone = await page.evaluate(async (bytes) => {
    const ui = await import('/js/tool-ui.js'), pdf = Uint8Array.from(bytes);
    let rejected = false; try { ui.documentSession.adopt(new Uint8Array(), 'invalid.pdf'); } catch { rejected = true; }
    const empty = ui.documentSession.snapshot(), first = ui.documentSession.adopt(pdf, 'standalone.pdf'), repeated = ui.documentSession.adopt(pdf, 'standalone.pdf');
    await ui.stashForChain(pdf, 'standalone.pdf', 'fill-sign'); const stashed = ui.documentSession.snapshot();
    return { rejected, emptyTask: empty.taskId, task: first.taskId, revision: first.revision, repeatedTask: repeated.taskId, repeatedRevision: repeated.revision, stashedTask: stashed.taskId, stashedRevision: stashed.revision };
  }, [...(await input()).buffer]); expect(standalone.rejected).toBe(true); expect(standalone.emptyTask).toBeNull(); expect(standalone.task).toBeTruthy(); expect(standalone.repeatedTask).toBe(standalone.task); expect(standalone.stashedTask).toBe(standalone.task); expect(standalone.repeatedRevision).toBe(standalone.revision); expect(standalone.stashedRevision).toBe(standalone.revision);
});
