import { test, expect } from '@playwright/test';
import * as lib from 'pdf-lib';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function source({ count = 5, label = 'SELECTED TEXT PAGE' } = {}) {
  const doc = await lib.PDFDocument.create(), font = await doc.embedFont(lib.StandardFonts.Helvetica);
  for (let index = 0; index < count; index++) {
    const page = doc.addPage([500, 400]); page.setCropBox(30, 25, 420, 330); page.setRotation(lib.degrees([0, 90, 180, 270, 0][index % 5])); page.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(index % 2 ? 2 : 1));
    page.drawText(`${label} ${index + 1}`, { x: 55, y: 250, font, size: 16 }); page.drawText('SECOND LINE FOR MULTILINE SELECTION', { x: 55, y: 220, font, size: 13 }); page.drawText('UNTOUCHED SOURCE TEXT', { x: 55, y: 100, font, size: 12 });
    if (index === 4) {
      page.drawText('ANGLED UNSUPPORTED', { x: 55, y: 180, font, size: 14, rotate: lib.degrees(20) });
      page.drawText('SKEWED UNSUPPORTED', { x: 55, y: 135, font, size: 14, xSkew: lib.degrees(18) });
      page.drawText('SIDEWAYS UNSUPPORTED', { x: 410, y: 60, font, size: 13, rotate: lib.degrees(90) });
    }
  }
  const context = doc.context, gs = context.register(context.obj({ Type: 'ExtGState', ca: .55, CA: .55, BM: 'Multiply' }));
  const appearance = context.register(context.flateStream('q /ExistingGS gs 0 1 0 rg 54 96 200 20 re f Q', { Type: 'XObject', Subtype: 'Form', BBox: [54, 96, 254, 116], Resources: { ExtGState: { ExistingGS: gs } } }));
  doc.getPage(0).node.addAnnot(context.register(context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [54, 96, 254, 116], QuadPoints: [54, 96, 254, 96, 254, 116, 54, 116], Contents: lib.PDFHexString.fromText('Original – Yeşil not İstanbul'), NM: lib.PDFHexString.fromText('original-green'), C: [0, 1, 0], AP: { N: appearance }, F: 4 })));
  return { name: 'native-highlights.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}
async function open(page, locale = '') { await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected')); await page.goto(`/${locale ? locale + '/' : ''}highlight`); }
const uiCall = (page, fn) => page.evaluate(fn);
const state = (page) => uiCall(page, async () => (await import(new URL('./tool-ui.js', document.querySelector('script[type=module][src$="js/highlight.js"]').src).href)).documentSession.snapshot());
async function ready(page) { await expect(page.locator('#addHighlightBtn')).toBeVisible(); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false'); }
async function load(page, file) { const previous = (await state(page)).taskId; await expect(page.locator('#fileInput')).toBeEnabled(); await page.setInputFiles('#fileInput', file); await expect.poll(async () => (await state(page)).taskId).not.toBe(previous); await ready(page); }
async function pageNumber(page, index) { await page.fill('#readerPage', String(index)); await page.locator('#readerPage').press('Tab'); await ready(page); await expect(page.locator('#readerPage')).toHaveValue(String(index)); }
async function selectNative(page, phrase) {
  const span = page.locator('#readerTextLayer span').filter({ hasText: phrase }).first(); await span.scrollIntoViewIfNeeded();
  const points = await span.evaluate((element) => {
    const text = element.firstChild;
    const clip = document.getElementById('viewerContainer').getBoundingClientRect(), bounds = element.getBoundingClientRect();
    // Measure actual one-character hit boxes. A collapsed caret's geometric
    // midpoint (and points outside a transformed span) need not hit its text.
    // These measuring ranges never enter the browser's native Selection.
    const endpoint = (offset) => {
      const range = document.createRange(); range.setStart(text, offset ? text.length - 1 : 0); range.setEnd(text, offset ? text.length : 1);
      const rect = range.getBoundingClientRect(), samples = [];
      // A preflight caret hit does not guarantee the actual mouse-down affinity.
      // Prefer the proven leading part of the first glyph. For the last glyph,
      // the upward-text control requires .1 before .5 despite both preflighting len.
      const fractions = offset === 0 ? [.1, .01, .25, .5, .75, .9, .99] : [.5, .25, .75, .1, .9, .01, .99];
      const verticalFractions = offset === 0 ? [.5, .25, .75, .1, .9, .01, .99] : [.1, .5, .25, .75, .9, .01, .99];
      for (const fx of fractions) for (const fy of verticalFractions) {
        const point = [rect.left + rect.width * fx, rect.top + rect.height * fy], caret = document.caretRangeFromPoint(...point), target = document.elementFromPoint(...point);
        const sample = { point, text: caret?.startContainer.textContent, offset: caret?.startOffset, expectedNode: caret?.startContainer === text, element: target ? `${target.tagName}#${target.id}.${target.className}` : null }; samples.push(sample);
        if (sample.expectedNode && sample.offset === offset) return { point, samples, hit: sample };
      }
      return { point: null, samples, characterBounds: [rect.left, rect.top, rect.right, rect.bottom] };
    };
    const first = endpoint(0), last = endpoint(text.length);
    return { start: first.point, end: last.point, first, last, bounds: [bounds.left, bounds.top, bounds.right, bounds.bottom], clip: [Math.max(0, clip.left), Math.max(0, clip.top), Math.min(innerWidth, clip.right), Math.min(innerHeight, clip.bottom)] };
  });
  await test.info().attach(`native-endpoints-${phrase}`, { body: JSON.stringify(points), contentType: 'application/json' });
  expect(points.start, JSON.stringify(points)).not.toBeNull(); expect(points.end, JSON.stringify(points)).not.toBeNull();
  for (const point of [points.start, points.end]) { expect(point[0]).toBeGreaterThan(points.clip[0]); expect(point[0]).toBeLessThan(points.clip[2]); expect(point[1]).toBeGreaterThan(points.clip[1]); expect(point[1]).toBeLessThan(points.clip[3]); }
  for (const hit of [points.first.hit, points.last.hit]) { expect(hit.expectedNode).toBe(true); expect(hit.text).toBe(phrase); }
  expect(points.first.hit.offset).toBe(0); expect(points.last.hit.offset).toBe(phrase.length);
  await page.mouse.move(...points.start); await page.mouse.down();
  let down;
  try {
    down = await span.evaluate((element) => { const value = getSelection(), text = element.firstChild; return { connected: text.isConnected, targetText: text.textContent, collapsed: value.isCollapsed, anchorIsTarget: value.anchorNode === text, focusIsTarget: value.focusNode === text, anchorOffset: value.anchorOffset, focusOffset: value.focusOffset }; });
    expect(down).toEqual({ connected: true, targetText: phrase, collapsed: true, anchorIsTarget: true, focusIsTarget: true, anchorOffset: 0, focusOffset: 0 });
    await page.mouse.move(...points.end, { steps: 8 });
  } finally {
    await page.mouse.up();
    if (down) await test.info().attach(`native-mousedown-${phrase}`, { body: JSON.stringify(down), contentType: 'application/json' });
  }
  await test.info().attach(`native-selection-${phrase}`, { body: JSON.stringify(await page.evaluate(() => { const value = getSelection(); return { text: value.toString(), collapsed: value.isCollapsed, anchorText: value.anchorNode?.textContent, anchorOffset: value.anchorOffset, focusText: value.focusNode?.textContent, focusOffset: value.focusOffset }; })), contentType: 'application/json' });
  await expect.poll(() => page.evaluate(() => getSelection().toString())).toBe(phrase);
}
async function addNative(page, phrase, keyboard = false) {
  await selectNative(page, phrase); await expect(page.locator('#addHighlightBtn')).toBeEnabled();
  if (keyboard) {
    for (let index = 0; index < 10 && !await page.locator('#addHighlightBtn').evaluate((element) => element === document.activeElement); index++) await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#addHighlightBtn')).toBeFocused(); await page.keyboard.press('Enter');
  } else await page.click('#addHighlightBtn');
  await ready(page); await expect(page.locator('#addHighlightBtn')).toBeDisabled();
}
async function saved(page, info, name) {
  await expect(page.locator('#highlightApplyBtn')).toBeEnabled(); await page.click('#highlightApplyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); const path = info.outputPath(name); await download.saveAs(path); return new Uint8Array(await readFile(path));
}
function annotations(doc, index) { return doc.getPage(index).node.Annots()?.asArray().map((ref) => doc.context.lookup(ref)) || []; }
const lookup = (dict, key) => dict.lookup(lib.PDFName.of(key));
const numbers = (dict, key) => lookup(dict, key).asArray().map((value) => value.asNumber());
async function textOf(page, bytes) {
  return page.evaluate(async (values) => {
    const entry = document.querySelector('script[type=module][src^="js/"]'), runtime = await import(new URL('./lib-loader.js', entry.src).href), task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(values), ...runtime.PDFJS_ASSET_URLS });
    try { const doc = await task.promise, text = []; for (let index = 1; index <= doc.numPages; index++) text.push((await (await doc.getPage(index)).getTextContent()).items.map((item) => item.str).join(' ')); return text; } finally { await task.destroy(); }
  }, [...bytes]);
}
async function holdNextRender(page) {
  await page.evaluate(async () => {
    const entry = document.querySelector('script[type=module][src$="js/highlight.js"]'), ui = await import(new URL('./tool-ui.js', entry.src).href), runtime = await import(new URL('./lib-loader.js', entry.src).href);
    const task = (await runtime.ensurePdfJs()).getDocument({ data: ui.documentSession.current().bytes.slice(), ...runtime.PDFJS_ASSET_URLS });
    try {
      const prototype = Object.getPrototypeOf(await (await task.promise).getPage(1)), render = prototype.render; let first = true;
      window.restoreHighlightRender = () => { prototype.render = render; };
      prototype.render = function (...args) {
        const native = render.apply(this, args); if (!first) return native; first = false;
        return { cancel: () => native.cancel(), promise: native.promise.then(() => { window.highlightRenderHeld = true; return new Promise((resolve) => { window.releaseHighlightRender = resolve; }); }) };
      };
    } finally { await task.destroy(); }
  });
}

test('native text selections at four rotations export exact persistent quads/AP once and preserve original annotation/text', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  const downloads = [], errors = []; page.on('download', (download) => downloads.push(download)); page.on('pageerror', (error) => errors.push(error.message));
  await open(page); const file = await source(); await load(page, file); const original = await lib.PDFDocument.load(file.buffer), originalAP = lib.decodePDFRawStream(lookup(lookup(annotations(original, 0)[0], 'AP'), 'N')).decode();
  const expected = [];
  for (let index = 0; index < 4; index++) {
    if (index) await pageNumber(page, index + 1);
    await selectNative(page, `SELECTED TEXT PAGE ${index + 1}`);
    expected.push(await page.evaluate(async ({ bytes, index }) => {
      const range = getSelection().getRangeAt(0), rect = range.getBoundingClientRect(), surface = document.getElementById('readerPageSurface').getBoundingClientRect();
      const entry = document.querySelector('script[type=module][src$="js/highlight.js"]'), runtime = await import(new URL('./lib-loader.js', entry.src).href), task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS });
      try { const viewport = (await (await task.promise).getPage(index + 1)).getViewport({ scale: 1 }); const corners = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]].map(([x, y]) => viewport.convertToPdfPoint((x - surface.left) * viewport.width / surface.width, (y - surface.top) * viewport.height / surface.height)); return [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))]; } finally { await task.destroy(); }
    }, { bytes: [...file.buffer], index }));
    if (!index) {
      for (let step = 0; step < 10 && !await page.locator('#addHighlightBtn').evaluate((element) => element === document.activeElement); step++) await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#addHighlightBtn')).toBeFocused(); await page.keyboard.press('Enter');
    } else await page.click('#addHighlightBtn');
    await ready(page); await expect(page.locator('#highlightList option[value]:not([value=""])')).toHaveCount(index + 1);
  }
  expect(downloads).toHaveLength(0); const bytes = await saved(page, info, 'four-native-highlights.pdf'), doc = await lib.PDFDocument.load(bytes); expect(downloads).toHaveLength(1);
  for (let index = 0; index < 4; index++) {
    const values = annotations(doc, index); expect(values).toHaveLength(index ? 1 : 2); const added = values.at(-1), rect = numbers(added, 'Rect');
    for (let coordinate = 0; coordinate < 4; coordinate++) expect(rect[coordinate]).toBeCloseTo(expected[index][coordinate], 4);
    expect(numbers(added, 'QuadPoints')).toEqual([rect[0], rect[1], rect[2], rect[1], rect[2], rect[3], rect[0], rect[3]]);
    expect(lookup(added, 'Subtype').toString()).toBe('/Highlight'); const ap = lookup(lookup(added, 'AP'), 'N'), gs = lookup(lookup(lookup(ap.dict, 'Resources'), 'ExtGState'), 'GS0'); expect(lookup(gs, 'ca').asNumber()).toBe(.4); expect(lookup(gs, 'BM').toString()).toBe('/Multiply');
  }
  const existing = annotations(doc, 0)[0]; expect(lookup(existing, 'Contents').decodeText()).toBe('Original – Yeşil not İstanbul'); expect(lib.decodePDFRawStream(lookup(lookup(existing, 'AP'), 'N')).decode()).toEqual(originalAP);
  const text = await textOf(page, bytes); for (let index = 0; index < 5; index++) { expect(text[index]).toContain(`SELECTED TEXT PAGE ${index + 1}`); expect(text[index]).toContain('UNTOUCHED SOURCE TEXT'); }
  await page.click('#highlightApplyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file'); const repeated = await page.evaluate(async () => [...(await import(new URL('./tool-ui.js', document.querySelector('script[type=module][src$="js/highlight.js"]').src).href)).documentSession.current().bytes]);
  expect(new Uint8Array(repeated)).toEqual(bytes); expect(downloads).toHaveLength(1); expect(errors).toEqual([]); await info.attach('native-selected-source-rectangles', { body: JSON.stringify(expected), contentType: 'application/json' });
});

test('unsupported native angled/skew/sideways and collapsed/outside selections clear a previous unadded candidate', async ({ page }) => {
  await open(page); await load(page, await source()); await pageNumber(page, 5);
  for (const phrase of ['ANGLED UNSUPPORTED', 'SKEWED UNSUPPORTED', 'SIDEWAYS UNSUPPORTED']) {
    await selectNative(page, 'SELECTED TEXT PAGE 5'); await expect(page.locator('#addHighlightBtn')).toBeEnabled();
    await selectNative(page, phrase); await expect(page.locator('#addHighlightBtn')).toBeDisabled(); await expect(page.locator('#highlightSelectionStatus')).toContainText('not supported'); await expect(page.locator('#highlightApplyBtn')).toBeDisabled();
  }
  await selectNative(page, 'SELECTED TEXT PAGE 5'); await expect(page.locator('#addHighlightBtn')).toBeEnabled(); await page.locator('#readerTextLayer span').filter({ hasText: 'SELECTED TEXT PAGE 5' }).first().click(); await expect.poll(() => page.evaluate(() => getSelection().isCollapsed)).toBe(true); await expect(page.locator('#addHighlightBtn')).toBeDisabled(); await expect(page.locator('#readerPage')).toHaveValue('5');
  await selectNative(page, 'SELECTED TEXT PAGE 5'); await expect(page.locator('#addHighlightBtn')).toBeEnabled(); await page.locator('#readerModes>summary').click(); await expect(page.locator('#addHighlightBtn')).toBeDisabled();
  await expect(page.locator('#highlightList option[value]:not([value=""])')).toHaveCount(0); await expect(page.locator('#highlightApplyBtn')).toBeDisabled();
});

test('per-highlight note/color/opacity, delete and Undo use actual refreshed appearance with no early Apply/Continue', async ({ page }, info) => {
  await open(page); await load(page, await source()); await addNative(page, 'SELECTED TEXT PAGE 1'); await page.locator('#highlightPanel>summary').click();
  const oldPreview = await page.locator('#pdfCanvas').evaluate((canvas) => canvas.toDataURL());
  await page.fill('#highlightNote', 'İstanbul – Çağrı annotation 😀'); await page.locator('#highlightColor').evaluate((input) => { input.value = '#3366ff'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#highlightOpacity').focus(); await page.keyboard.press('ArrowRight'); await expect(page.locator('#highlightApplyBtn')).toBeDisabled();
  await page.locator('#readerModes>summary').click(); await expect(page.locator('#workspaceModes button[data-mode="add-text"]')).toBeDisabled();
  await holdNextRender(page); await page.click('#highlightSaveBtn'); await expect.poll(() => page.evaluate(() => window.highlightRenderHeld)).toBe(true);
  const beforeForced = await state(page); await expect(page.locator('#highlightApplyBtn')).toBeDisabled();
  await page.dispatchEvent('#highlightApplyBtn', 'click'); await page.dispatchEvent('#workspaceModes button[data-mode="add-text"]', 'click');
  expect(await state(page)).toEqual(beforeForced); expect(page.url()).toMatch(/\/highlight$/); await expect(page.locator('#documentResult')).not.toBeVisible(); expect(await page.locator('#pdfCanvas').evaluate((canvas) => canvas.toDataURL())).toBe(oldPreview);
  await page.evaluate(() => window.releaseHighlightRender()); await ready(page); await page.evaluate(() => window.restoreHighlightRender()); await expect(page.locator('#highlightApplyBtn')).toBeEnabled(); expect(await page.locator('#pdfCanvas').evaluate((canvas) => canvas.toDataURL())).not.toBe(oldPreview);
  await page.click('#highlightDeleteBtn'); await ready(page); await expect(page.locator('#highlightList option[value]:not([value=""])')).toHaveCount(0);
  await page.click('#highlightUndoBtn'); await ready(page); await expect(page.locator('#highlightList option[value]:not([value=""])')).toHaveCount(1);
  const bytes = await saved(page, info, 'edited-restored-highlight.pdf'), doc = await lib.PDFDocument.load(bytes), value = annotations(doc, 0).at(-1);
  expect(lookup(value, 'Contents').decodeText()).toBe('İstanbul – Çağrı annotation 😀'); expect(numbers(value, 'C')).toEqual([.2, .4, 1]); expect(lookup(value, 'CA').asNumber()).toBe(.41);
});

test('held Highlight review publication loses to an unrelated same-task edit and recovers through the current preview', async ({ page }, info) => {
  await open(page); await load(page, await source()); await addNative(page, 'SELECTED TEXT PAGE 1');
  let release, held = false; await page.route('**/js/document-result.js', async (route) => { held = true; await new Promise((resolve) => { release = resolve; }); await route.continue(); });
  await page.click('#highlightApplyBtn'); await expect.poll(() => held).toBe(true);
  const newer = await page.evaluate(async () => {
    const ui = await import(new URL('./tool-ui.js', document.querySelector('script[type=module][src$="js/highlight.js"]').src).href), scene = ui.documentSession.scene(); scene.objects.find((object) => object.kind === 'highlight').note = 'LATEST unrelated same-task note'; ui.documentSession.changeScene(scene); return ui.documentSession.snapshot();
  });
  release(); await expect(page.locator('#highlightRetryBtn')).toBeVisible(); await expect(page.locator('#highlightRetryBtn')).toBeEnabled(); await expect(page.locator('#highlightSelectionStatus')).toContainText('document changed');
  await expect(page.locator('#documentResult')).not.toBeVisible(); expect(await state(page)).toEqual(newer); await expect(page.locator('#highlightApplyBtn')).toBeDisabled();
  await page.click('#highlightRetryBtn'); await ready(page); await expect(page.locator('#highlightApplyBtn')).toBeEnabled(); const output = await saved(page, info, 'latest-owned-highlight-review.pdf'), pdf = await lib.PDFDocument.load(output);
  expect(lookup(annotations(pdf, 0).at(-1), 'Contents').decodeText()).toBe('LATEST unrelated same-task note'); expect((await state(page)).taskId).toBe(newer.taskId);
});

test('native property intent invalidates old review download and a held native continuation before saving the changed annotation', async ({ page }, info) => {
  const downloads = []; page.on('download', (download) => downloads.push(download));
  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type !== 'click' || typeof listener !== 'function') return add.call(this, type, listener, options);
      return add.call(this, type, function (event) {
        const rail = this instanceof Element && this.closest('#chainRow'), value = listener.call(this, event);
        if (rail && value?.then) { window.highlightChainSettled = false; Promise.resolve(value).then(() => { window.highlightChainSettled = true; }, () => { window.highlightChainSettled = true; }); }
        return value;
      }, options);
    };
  });
  await open(page); await load(page, await source()); await addNative(page, 'SELECTED TEXT PAGE 1'); await page.locator('#highlightPanel>summary').click();
  await page.click('#highlightApplyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  await expect(page.locator('#chainRow button').filter({ hasText: 'Add Text' })).toBeVisible();
  const priorDownload = await page.locator('#downloadResultBtn').elementHandle(), before = await state(page);
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete'); let first = true;
    window.restoreHighlightChainHold = () => Object.defineProperty(IDBTransaction.prototype, 'oncomplete', descriptor);
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { configurable: true, enumerable: descriptor.enumerable, get: descriptor.get, set(handler) {
      const tx = this, names = [...tx.objectStoreNames];
      if (first && tx.db.name === 'browserpdf-workflows' && tx.mode === 'readwrite' && names.includes('workflows') && names.includes('files')) { first = false; descriptor.set.call(tx, function (event) { window.highlightChainHeld = true; window.releaseHighlightChain = () => handler.call(tx, event); }); }
      else descriptor.set.call(tx, handler);
    } });
  });
  await page.locator('#chainRow button').filter({ hasText: 'Add Text' }).click(); await expect.poll(() => page.evaluate(() => window.highlightChainHeld)).toBe(true);
  await page.fill('#highlightNote', 'NEW property intent invalidates old rail'); await expect(page.locator('#documentResult')).not.toBeVisible(); await expect(page.locator('#chainRow')).not.toBeVisible();
  await expect(page.locator('#highlightApplyBtn')).toBeDisabled();
  // The actual retained old download callback must also reject a stale event.
  await priorDownload.evaluate((button) => button.click());
  await page.evaluate(() => window.releaseHighlightChain()); await expect.poll(() => page.evaluate(() => window.highlightChainSettled)).toBe(true);
  expect(page.url()).toMatch(/\/highlight$/); expect(await state(page)).toEqual(before); expect(downloads).toHaveLength(0); await expect(page.locator('#errorSection')).not.toBeVisible();
  await page.evaluate(() => window.restoreHighlightChainHold());
  await page.click('#highlightSaveBtn'); await ready(page); const output = await saved(page, info, 'new-property-after-held-rail.pdf'), pdf = await lib.PDFDocument.load(output);
  expect(lookup(annotations(pdf, 0).at(-1), 'Contents').decodeText()).toBe('NEW property intent invalidates old rail'); expect(downloads).toHaveLength(1);
});

test('invalid native B while first A preview is opening restores the retained A workspace and actual annotation actions', async ({ page }, info) => {
  let release, held = false; await page.route('**/css/highlight-workspace.css', async (route) => { held = true; await new Promise((resolve) => { release = resolve; }); await route.continue(); });
  await open(page); const original = await source({ count: 1 }); await page.setInputFiles('#fileInput', original); await expect.poll(() => held).toBe(true);
  const before = await state(page); expect(before.taskId).toBeTruthy();
  await page.setInputFiles('#fileInput', { name: 'invalid-B.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nnot a readable PDF') });
  await expect(page.locator('#errorSection')).toBeVisible(); expect(await state(page)).toEqual(before);
  release(); await ready(page); await expect(page.locator('#readerPage')).toBeEnabled(); expect((await state(page)).taskId).toBe(before.taskId);
  await addNative(page, 'SELECTED TEXT PAGE 1'); const output = await saved(page, info, 'retained-A-after-invalid-B.pdf'), pdf = await lib.PDFDocument.load(output);
  expect(pdf.getPageCount()).toBe(1); expect(annotations(pdf, 0)).toHaveLength(2); expect((await textOf(page, output))[0]).toContain('SELECTED TEXT PAGE 1');
});

test('native long document labels survive mode handoff and Undo/Redo while actual exports retain bounded filenames', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.addInitScript(() => document.addEventListener('click', (event) => { const anchor = event.target.closest?.('a[download]'); if (anchor) window.requestedDownloadName = anchor.download; }, true));
  const errors = [], downloads = []; page.on('pageerror', (error) => errors.push(error.message)); page.on('download', (download) => downloads.push(download.suggestedFilename()));
  const sha = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  const snapshot = () => page.evaluate(async () => {
    const entry = document.querySelector('script[type=module][src^="js/"]'), ui = await import(new URL('./tool-ui.js', entry.src).href), transfer = ui.documentSession.transfer();
    return { state: ui.documentSession.snapshot(), original: [...ui.documentSession.original().bytes], current: [...ui.documentSession.current().bytes], historyNames: transfer.history.map((value) => value.displayName), futureNames: transfer.future.map((value) => value.displayName) };
  });
  async function identity(originalName, currentName) {
    const names = page.locator('#documentIdentity .document-identity-name'); await expect(names).toHaveText([originalName, currentName]);
    await expect(names.nth(0)).toHaveAttribute('title', originalName); await expect(names.nth(1)).toHaveAttribute('title', currentName);
    for (const attribute of ['title', 'aria-label']) { const value = await page.locator('#documentIdentity').getAttribute(attribute); expect(value).toContain(originalName); expect(value).toContain(currentName); }
  }
  async function mode(slug) {
    const control = page.locator(`#workspaceModes button[data-mode="${slug}"]`);
    for (const panel of await control.locator('xpath=ancestor::details[not(@open)]').all()) await panel.locator('summary').first().click();
    await expect(control).toBeEnabled(); await control.click(); await expect(page).toHaveURL(new RegExp(`/${slug}\\?`));
    if (slug === 'highlight') await ready(page); else { await expect(page.locator('#objectWorkspace')).toBeVisible(); await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy', 'false'); }
  }
  async function history(kind, enabled) {
    const before = await state(page); await page.click(`#highlight${kind}Btn`); await expect.poll(async () => (await state(page)).revision).toBeGreaterThan(before.revision); await ready(page); await expect(page.locator(enabled)).toBeEnabled();
  }
  await open(page); const file = await source({ count: 1 }); file.name = `İstanbul-highlight-full-name-${'meaningful-document-'.repeat(8)}.pdf`;
  const originalName = file.name, outputName = originalName.replace(/\.pdf$/i, '') + '-highlighted.pdf';
  expect(originalName.length).toBeGreaterThan(160); expect(outputName.length).toBeLessThanOrEqual(260);
  await load(page, file); await identity(originalName, originalName); const initial = await snapshot();
  expect(initial.state.original.name).toBe(originalName.slice(0, 160)); expect(initial.state.current.displayName).toBe(originalName);
  await addNative(page, 'SELECTED TEXT PAGE 1'); const first = await saved(page, info, 'full-name-first-highlight.pdf');
  await identity(originalName, outputName); const published = await snapshot(); expect(published.state.current.displayName).toBe(outputName); expect(published.state.current.name).toBe(outputName.slice(0, 160));
  expect(await page.evaluate(() => window.requestedDownloadName)).toBe(published.state.current.name);
  await expect(page.locator('#documentResultIdentity')).toContainText(originalName); await expect(page.locator('#documentResultIdentity')).toContainText(outputName); await expect(page.locator('#documentResultPreview canvas')).toHaveAttribute('aria-label', outputName);
  expect(sha(published.current)).toBe(sha(first)); expect(sha(published.original)).toBe(sha(file.buffer)); expect(annotations(await lib.PDFDocument.load(first), 0)).toHaveLength(2);
  await mode('add-text'); await identity(originalName, outputName); const inherited = await snapshot(); expect(inherited.state.taskId).toBe(initial.state.taskId); expect(sha(inherited.current)).toBe(sha(first)); expect(sha(inherited.original)).toBe(sha(file.buffer));
  await mode('highlight'); await identity(originalName, outputName); expect((await snapshot()).state.taskId).toBe(initial.state.taskId);
  await page.locator('#highlightPanel>summary').click(); await page.selectOption('#highlightList', { index: 1 }); await page.fill('#highlightNote', 'Full-name handoff note – Çağrı'); await page.click('#highlightSaveBtn'); await ready(page); await expect(page.locator('#highlightUndoBtn')).toBeEnabled();
  await history('Undo', '#highlightUndoBtn'); await identity(originalName, outputName);
  await history('Undo', '#highlightRedoBtn'); await identity(originalName, originalName); await expect(page.locator('#highlightList option[value]:not([value=""])')).toHaveCount(0);
  await history('Redo', '#highlightRedoBtn'); await identity(originalName, outputName);
  await history('Redo', '#highlightApplyBtn'); await identity(originalName, outputName); await expect(page.locator('#highlightList option[value]:not([value=""])')).toHaveCount(1);
  const finalDisplayName = published.state.current.name + '-highlighted.pdf', final = await saved(page, info, 'full-name-after-handoff-history.pdf'), document = await lib.PDFDocument.load(final), added = annotations(document, 0).at(-1);
  await identity(originalName, finalDisplayName); expect(finalDisplayName).not.toBe(outputName); await expect(page.locator('#documentResultPreview canvas')).toHaveAttribute('aria-label', finalDisplayName);
  const last = await snapshot(); expect(await page.evaluate(() => window.requestedDownloadName)).toBe(last.state.current.name); expect(last.state.current.name.length).toBeLessThanOrEqual(160);
  expect(last.state.taskId).toBe(initial.state.taskId); expect(sha(last.original)).toBe(sha(file.buffer)); expect(sha(last.current)).toBe(sha(final));
  expect(annotations(document, 0)).toHaveLength(2); expect(lookup(added, 'Contents').decodeText()).toBe('Full-name handoff note – Çağrı'); expect(lookup(added, 'Subtype').toString()).toBe('/Highlight'); expect(lookup(lookup(added, 'AP'), 'N')).toBeDefined();
  expect((await textOf(page, final))[0]).toContain('SELECTED TEXT PAGE 1'); expect((await textOf(page, final))[0]).toContain('UNTOUCHED SOURCE TEXT'); expect(errors).toEqual([]); expect(downloads).toHaveLength(2);
  await info.attach('full-name-artifact-contract', { body: JSON.stringify({ originalName, outputName, finalDisplayName, safeName: last.state.current.name, originalSHA: sha(last.original), firstSHA: sha(first), finalSHA: sha(final), taskId: last.state.taskId, historyNames: last.historyNames, futureNames: last.futureNames, suggestedDownloads: downloads }), contentType: 'application/json' });
});

const remainingSha = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
async function remainingDetails(control) { for (const item of await control.locator('xpath=ancestor::details[not(@open)]').all()) await item.locator('summary').first().click(); }
async function remainingSnapshot(page) {
  return page.evaluate(async () => {
    const entry = document.querySelector('script[type=module][src^="js/"]'), ui = await import(new URL('./tool-ui.js', entry.src).href);
    return { state: ui.documentSession.snapshot(), bytes: [...ui.documentSession.current().bytes], original: [...ui.documentSession.original().bytes], scene: ui.documentSession.scene() };
  });
}
async function observeRemainingReviews(page) {
  await page.addInitScript(() => {
    if (window.highlightReviewObserverInstalled) return; window.highlightReviewObserverInstalled = true; window.highlightReviewCalls = [];
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type !== 'click' || typeof listener !== 'function') return add.call(this, type, listener, options);
      return add.call(this, type, function (event) {
        const result = listener.call(this, event);
        if (this instanceof Element && this.id === 'highlightApplyBtn' && result?.then) {
          const call = { settled: false }; window.highlightReviewCalls.push(call);
          Promise.resolve(result).then(() => { call.settled = true; call.outcome = 'resolved'; }, (error) => { call.settled = true; call.outcome = error.name; });
        }
        return result;
      }, options);
    };
  });
}
async function holdRemainingNative(page, kind) {
  await page.evaluate(async (kind) => {
    const entry = document.querySelector('script[type=module][src^="js/"]'), runtime = await import(new URL('./lib-loader.js', entry.src).href);
    let claimed = false;
    const hold = async (details) => {
      window.remainingHighlightHeld = { kind, nativeCompleted: true, ...details };
      await new Promise((resolve) => { window.releaseRemainingHighlight = resolve; }); window.remainingHighlightHeld.released = true;
    };
    if (kind === 'save') {
      const lib = await runtime.ensurePdfLib(), owner = lib.PDFDocument.prototype, save = owner.save;
      window.restoreRemainingHighlight = () => { owner.save = save; };
      owner.save = async function (...args) {
        const bytes = await save.apply(this, args);
        if (!claimed) { claimed = true; await hold({ bytes: bytes.length }); }
        return bytes;
      };
    } else {
      const ui = await import(new URL('./tool-ui.js', entry.src).href), pdfjs = await runtime.ensurePdfJs(), task = pdfjs.getDocument({ data: ui.documentSession.current().bytes.slice(), ...runtime.PDFJS_ASSET_URLS });
      try {
        const owner = Object.getPrototypeOf(await (await task.promise).getPage(1)), render = owner.render;
        window.restoreRemainingHighlight = () => { owner.render = render; };
        owner.render = function (...args) {
          const native = render.apply(this, args), canvas = args[0]?.canvasContext?.canvas;
          if (claimed || !canvas?.closest('#documentResultPreview')) return native;
          claimed = true;
          return { cancel: () => native.cancel(), promise: native.promise.then(() => hold({ parent: canvas.parentElement.id, width: canvas.width, height: canvas.height })) };
        };
      } finally { await task.destroy(); }
    }
  }, kind);
}
async function releaseRemainingNative(page) {
  await page.evaluate(() => { window.restoreRemainingHighlight?.(); window.releaseRemainingHighlight?.(); });
  await expect.poll(() => page.evaluate(() => window.highlightReviewCalls.every((call) => call.settled))).toBe(true);
}
async function remainingPicture(page, info, name) {
  const image = await page.locator('#pdfCanvas').evaluate((canvas) => ({ png: canvas.toDataURL().split(',')[1], width: canvas.width, height: canvas.height }));
  expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(1200); expect(image.width * image.height).toBeLessThanOrEqual(2000000);
  const bytes = Buffer.from(image.png, 'base64'); await writeFile(info.outputPath(name + '.png'), bytes); return remainingSha(bytes);
}
async function remainingDownload(page, info, name) {
  await expect(page.locator('#highlightApplyBtn')).toBeEnabled(); await page.click('#highlightApplyBtn');
  await expect(page.locator('#documentResultPreview')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => page.evaluate(() => window.highlightReviewCalls.at(-1)?.settled)).toBe(true);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]);
  const path = info.outputPath(name); await download.saveAs(path); return new Uint8Array(await readFile(path));
}

for (const { label, kind, clear } of [
  { label: 'Clear and fresh B defeat held actual PDF save', kind: 'save', clear: true },
  { label: 'valid B defeats held actual result render', kind: 'render', clear: false },
  { label: 'valid B defeats held actual PDF save', kind: 'save', clear: false },
]) test(`remaining Highlight lifecycle: ${label}`, async ({ page }, info) => {
  const errors = [], downloads = []; page.on('pageerror', (error) => errors.push(error.message)); page.on('download', (download) => downloads.push(download));
  await page.setViewportSize({ width: 1440, height: 1200 }); await observeRemainingReviews(page); await open(page);
  const original = await source({ count: 1, label: 'OLD A PAGE' }); await load(page, original); await addNative(page, 'OLD A PAGE 1');
  const old = await remainingSnapshot(page); await remainingDetails(page.locator('#fileInput')); await remainingDetails(page.locator('#highlightClearDocumentBtn'));
  await holdRemainingNative(page, kind);
  try {
    await page.click('#highlightApplyBtn'); await expect.poll(() => page.evaluate(() => !!window.remainingHighlightHeld?.nativeCompleted)).toBe(true);
    const held = await page.evaluate(() => window.remainingHighlightHeld); expect(held.kind).toBe(kind);
    if (kind === 'render') { expect(held.parent).toBe('documentResultPreview'); expect(held.width * held.height).toBeGreaterThan(0); }
    else expect(held.bytes).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.highlightReviewCalls[0].settled)).toBe(false);
    if (clear) {
      await expect(page.locator('#highlightClearDocumentBtn')).toBeEnabled(); await page.click('#highlightClearDocumentBtn');
      expect((await state(page)).taskId).toBeNull(); await expect(page.locator('#documentIdentity')).toHaveCount(0); await expect(page.locator('#viewerSection')).toHaveCount(0);
      await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden();
    }
    const file = await source({ count: 2, label: 'NEW B PAGE' }); await expect(page.locator('#fileInput')).toBeEnabled(); await load(page, file);
    await expect(page.locator('#readerTextLayer')).toContainText('NEW B PAGE 1'); await pageNumber(page, 2); await expect(page.locator('#readerTextLayer')).toContainText('NEW B PAGE 2');
    const chosen = await remainingSnapshot(page), picture = await remainingPicture(page, info, `${kind}-${clear ? 'clear' : 'replace'}-B-before-release`);
    expect(chosen.state.taskId).not.toBe(old.state.taskId); expect(remainingSha(chosen.bytes)).toBe(remainingSha(file.buffer)); expect(remainingSha(chosen.original)).toBe(remainingSha(file.buffer)); expect(chosen.state.selection).toEqual([1]); expect(chosen.scene.objects).toHaveLength(0);
    expect(await page.evaluate(() => window.highlightReviewCalls[0].settled)).toBe(false); await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden();
    await releaseRemainingNative(page); await ready(page);
    expect(await remainingSnapshot(page)).toEqual(chosen); expect(await remainingPicture(page, info, `${kind}-${clear ? 'clear' : 'replace'}-B-after-release`)).toBe(picture);
    await expect(page.locator('#readerTextLayer')).toContainText('NEW B PAGE 2'); await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden(); await expect(page.locator('#errorSection')).toBeHidden();
    for (const id of ['pdfCanvas', 'readerTextLayer', 'documentIdentity', 'fileInput']) await expect(page.locator('#' + id)).toHaveCount(1); expect(downloads).toHaveLength(0);
    await addNative(page, 'NEW B PAGE 2'); const output = await remainingDownload(page, info, `${kind}-${clear ? 'clear' : 'replace'}-new-B-actual.pdf`), pdf = await lib.PDFDocument.load(output), text = await textOf(page, output);
    expect(pdf.getPageCount()).toBe(2); expect(annotations(pdf, 0)).toHaveLength(1); expect(annotations(pdf, 1)).toHaveLength(1); expect(lookup(annotations(pdf, 1)[0], 'Subtype').toString()).toBe('/Highlight'); expect(lookup(lookup(annotations(pdf, 1)[0], 'AP'), 'N')).toBeDefined();
    expect(text[0]).toContain('NEW B PAGE 1'); expect(text[1]).toContain('NEW B PAGE 2'); expect(text.join(' ')).not.toContain('OLD A');
    const final = await remainingSnapshot(page); expect(final.state.taskId).toBe(chosen.state.taskId); expect(remainingSha(final.original)).toBe(remainingSha(file.buffer)); expect(remainingSha(final.bytes)).toBe(remainingSha(output)); expect(downloads).toHaveLength(1); expect(errors).toEqual([]);
    await info.attach('actual-completion-held-successor-ownership', { body: JSON.stringify({ held, oldTask: old.state.taskId, newTask: final.state.taskId, originalSHA: remainingSha(final.original), finalSHA: remainingSha(output), canvasSHA: picture, handlerCalls: await page.evaluate(() => window.highlightReviewCalls) }), contentType: 'application/json' });
  } finally { if (!page.isClosed()) await releaseRemainingNative(page); }
});

async function remainingLayoutSource(width) {
  const pdf = await lib.PDFDocument.create(), font = await pdf.embedFont(lib.StandardFonts.Helvetica);
  for (let index = 0; index < 2; index++) {
    const page = pdf.addPage([612, 792]); page.drawText(`LAYOUT ${width} PAGE ${index + 1}`, { x: 55, y: 720, font, size: 16 }); page.drawText('UNTOUCHED SOURCE TEXT', { x: 55, y: 100, font, size: 12 });
  }
  // Copy the existing source() fixture's retained AP pattern; only the page
  // proportions/text position differ for the natural default-fit layout gate.
  const context = pdf.context, gs = context.register(context.obj({ Type: 'ExtGState', ca: .55, CA: .55, BM: 'Multiply' }));
  const appearance = context.register(context.flateStream('q /ExistingGS gs 0 1 0 rg 54 96 200 20 re f Q', { Type: 'XObject', Subtype: 'Form', BBox: [54, 96, 254, 116], Resources: { ExtGState: { ExistingGS: gs } } }));
  pdf.getPage(0).node.addAnnot(context.register(context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [54, 96, 254, 116], QuadPoints: [54, 96, 254, 96, 254, 116, 54, 116], Contents: lib.PDFHexString.fromText('Original – Yeşil not İstanbul'), NM: lib.PDFHexString.fromText('original-green'), C: [0, 1, 0], AP: { N: appearance }, F: 4 })));
  return { name: `İstanbul-highlight-review-${'meaningful-document-'.repeat(8)}${width}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function remainingArtifactPixels(page, bytes) {
  return page.evaluate(async (bytes) => {
    const entry = document.querySelector('script[type=module][src^="js/"]'), runtime = await import(new URL('./lib-loader.js', entry.src).href), { renderBoundedPage } = await import(new URL('./core/bounded-renderer.js', entry.src).href);
    const task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS }), surface = document.getElementById('readerPageSurface'), visible = document.getElementById('pdfCanvas'), probe = document.createElement('canvas');
    // Reader transactionally renders its candidate while detached, where the
    // body's antialiased font smoothing is absent. Match that render context.
    probe.style.cssText = visible.style.cssText; Object.assign(probe.style, { position: 'absolute', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none', webkitFontSmoothing: 'auto' }); surface.append(probe);
    try {
      const pdf = await task.promise, page = await pdf.getPage(Number(document.getElementById('readerPage').value)), scale = Number(surface.style.getPropertyValue('--total-scale-factor')) / page.userUnit, displayViewport = page.getViewport({ scale });
      await renderBoundedPage(page, probe, { scale, displayViewport, maxDimension: 1200, maxPixels: 2000000 });
      const old = visible.getContext('2d').getImageData(0, 0, visible.width, visible.height), actual = probe.getContext('2d').getImageData(0, 0, probe.width, probe.height); let changed = 0;
      if (old.data.length === actual.data.length) for (let index = 0; index < actual.data.length; index++) if (old.data[index] !== actual.data[index]) changed++;
      const css = visible.getBoundingClientRect(), other = probe.getBoundingClientRect();
      return { changed, width: probe.width, height: probe.height, previewWidth: visible.width, previewHeight: visible.height, css: [css.width, css.height], artifactCSS: [other.width, other.height], renderSmoothing: getComputedStyle(probe).webkitFontSmoothing, scale, displayViewport: [displayViewport.width, displayViewport.height], sameLength: old.data.length === actual.data.length };
    } finally { probe.width = probe.height = 0; probe.remove(); await task.destroy(); }
  }, [...bytes]);
}

for (const width of [320, 390, 768, 1440]) test(`Highlight native task fits ${width}px in English light and Arabic RTL dark with exact saved annotations`, async ({ page }, info) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await page.setViewportSize({ width, height: width < 500 ? 720 : 900 });
  await observeRemainingReviews(page); await page.addInitScript(() => localStorage.setItem('pdf2md-theme', location.pathname.startsWith('/ar/') ? 'dark' : 'light'));
  for (const [locale, theme] of [['', 'light'], ['ar', 'dark']]) {
    await open(page, locale); const file = await remainingLayoutSource(width); await load(page, file);
    // Capture natural intake/default-fit geometry before any harness focus,
    // scroll, zoom, selection helper or property interaction.
    const layout = await page.evaluate(() => {
      const canvas = document.getElementById('pdfCanvas'), r = canvas.getBoundingClientRect(), container = document.getElementById('viewerContainer');
      return { width: innerWidth, scroll: document.documentElement.scrollWidth, canvasTop: r.top, canvasHeight: r.height, canvasWidth: r.width, visible: Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top)), required: Math.min(innerHeight * .35, r.height / 2), surface: container.clientWidth, surfaceScroll: container.scrollWidth, native: [canvas.width, canvas.height], direction: getComputedStyle(document.documentElement).direction, declaredDirection: document.documentElement.dir, theme: document.documentElement.dataset.theme, zoom: document.getElementById('zoomLevel').textContent, controls: [...document.querySelectorAll('#highlightActions button:not([hidden])')].map((button) => { const r = button.getBoundingClientRect(); return { id: button.id, left: r.left, right: r.right }; }) };
    });
    expect(layout.scroll).toBeLessThanOrEqual(width); expect(layout.surfaceScroll).toBeLessThanOrEqual(layout.surface + 1); expect(layout.visible).toBeGreaterThanOrEqual(layout.required); expect(layout.canvasWidth / layout.canvasHeight).toBeCloseTo(612 / 792, 2); expect(layout.zoom).toBe('100%'); expect(Math.max(...layout.native)).toBeLessThanOrEqual(1200); expect(layout.native[0] * layout.native[1]).toBeLessThanOrEqual(2000000);
    expect(layout.direction).toBe(locale ? 'rtl' : 'ltr'); if (locale) expect(layout.declaredDirection).toBe('rtl'); expect(layout.theme).toBe(theme);
    for (const control of layout.controls) { expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(width); }
    const identity = page.locator('#documentIdentity'), names = identity.locator('.document-identity-name'); await expect(names).toHaveText([file.name, file.name]);
    for (const name of await names.all()) await expect(name).toHaveAttribute('title', file.name); expect(await identity.getAttribute('aria-label')).toContain(file.name);
    await info.attach(`${width}-${locale || 'en'}-natural-initial-layout`, { body: JSON.stringify(layout), contentType: 'application/json' }); await page.screenshot({ path: info.outputPath(`${width}-${locale || 'en'}-${theme}-natural-initial.png`) });
    const original = await remainingSnapshot(page), sourcePdf = await lib.PDFDocument.load(file.buffer), sourceAP = lib.decodePDFRawStream(lookup(lookup(annotations(sourcePdf, 0)[0], 'AP'), 'N')).decode();
    await addNative(page, `LAYOUT ${width} PAGE 1`, true); await page.locator('#highlightPanel>summary').click();
    const note = page.locator('#highlightNote'), expectedNote = `İstanbul — ملاحظة 😀 ${width} ${locale || 'en'} X`;
    await note.focus(); const position = await page.evaluate(() => ({ top: scrollY, x: document.getElementById('viewerContainer').scrollLeft, y: document.getElementById('viewerContainer').scrollTop }));
    await note.press('ControlOrMeta+A'); await page.keyboard.type(expectedNote); await expect(note).toBeFocused(); await expect(note).toHaveValue(expectedNote);
    expect(await note.evaluate((control) => [control.selectionStart, control.selectionEnd])).toEqual([expectedNote.length, expectedNote.length]);
    await note.press('Backspace'); await expect(note).toHaveValue(expectedNote.slice(0, -1)); expect(await note.evaluate((control) => [control.selectionStart, control.selectionEnd])).toEqual([expectedNote.length - 1, expectedNote.length - 1]); await page.keyboard.type('X');
    await expect(note).toHaveValue(expectedNote); await expect(note).toBeFocused(); expect(await note.evaluate((control) => [control.selectionStart, control.selectionEnd])).toEqual([expectedNote.length, expectedNote.length]);
    expect(await page.evaluate(() => ({ top: scrollY, x: document.getElementById('viewerContainer').scrollLeft, y: document.getElementById('viewerContainer').scrollTop }))).toEqual(position); await expect(page.locator('#readerPage')).toHaveValue('1'); await expect(page.locator('#highlightApplyBtn')).toBeDisabled();
    const opacity = page.locator('#highlightOpacity'), previousOpacity = await opacity.inputValue(); await opacity.focus(); await opacity.press('ArrowRight');
    const expectedOpacity = Number(await opacity.inputValue()) / 100; expect(await opacity.inputValue()).not.toBe(previousOpacity); expect(expectedOpacity).toBeGreaterThanOrEqual(.2); expect(expectedOpacity).toBeLessThanOrEqual(.8);
    const color = await page.locator('#highlightColor').inputValue(), expectedColor = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
    await page.click('#highlightSaveBtn'); await ready(page); await expect(page.locator('#highlightApplyBtn')).toBeEnabled();
    const edited = await remainingSnapshot(page), expected = edited.scene.objects.find((object) => object.kind === 'highlight'); expect(expected.note).toBe(expectedNote); expect(expected.opacity).toBe(expectedOpacity);
    const output = await remainingDownload(page, info, `${width}-${locale || 'en'}-native-highlight.pdf`), pdf = await lib.PDFDocument.load(output), values = annotations(pdf, 0), added = values.at(-1), ap = lookup(lookup(added, 'AP'), 'N'), gs = lookup(lookup(lookup(ap.dict, 'Resources'), 'ExtGState'), 'GS0');
    expect(values).toHaveLength(2); expect(annotations(pdf, 1)).toHaveLength(0); expect(lookup(added, 'Subtype').toString()).toBe('/Highlight'); expect(lookup(added, 'Contents').decodeText()).toBe(expectedNote); expect(numbers(added, 'QuadPoints')).toEqual(expected.quads.flat()); expect(numbers(added, 'C')).toEqual(expectedColor); expect(lookup(added, 'CA').asNumber()).toBe(expectedOpacity); expect(lookup(gs, 'ca').asNumber()).toBe(expectedOpacity); expect(lookup(gs, 'BM').toString()).toBe('/Multiply');
    expect(lib.decodePDFRawStream(lookup(lookup(values[0], 'AP'), 'N')).decode()).toEqual(sourceAP); const text = await textOf(page, output); expect(text[0]).toContain(`LAYOUT ${width} PAGE 1`); expect(text[1]).toContain(`LAYOUT ${width} PAGE 2`);
    const final = await remainingSnapshot(page); expect(final.state.taskId).toBe(original.state.taskId); expect(remainingSha(final.original)).toBe(remainingSha(file.buffer)); expect(remainingSha(final.bytes)).toBe(remainingSha(output));
    const outputName = file.name.replace(/\.pdf$/i, '') + '-highlighted.pdf'; await expect(names).toHaveText([file.name, outputName]); await expect(names.nth(0)).toHaveAttribute('title', file.name); await expect(names.nth(1)).toHaveAttribute('title', outputName); expect(await identity.getAttribute('aria-label')).toContain(outputName); await expect(page.locator('#documentResultPreview canvas')).toHaveAttribute('aria-label', outputName);
    const pixels = await remainingArtifactPixels(page, output); expect(pixels.sameLength).toBe(true); expect([pixels.width, pixels.height]).toEqual([pixels.previewWidth, pixels.previewHeight]); expect(pixels.artifactCSS).toEqual(pixels.css); expect(pixels.changed).toBe(0); expect(Math.max(pixels.width, pixels.height)).toBeLessThanOrEqual(1200); expect(pixels.width * pixels.height).toBeLessThanOrEqual(2000000);
    await info.attach(`${width}-${locale || 'en'}-native-property-artifact`, { body: JSON.stringify({ expectedNote, expectedOpacity, expectedColor, caretLength: expectedNote.length, scrollPosition: position, originalSHA: remainingSha(final.original), outputSHA: remainingSha(output), quads: expected.quads, pixels }), contentType: 'application/json' }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect(errors).toEqual([]);
});


test('Highlight Delete-last reviews an edited empty scene directly and retains idempotent artifacts and Undo Redo', async ({ page }, info) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const file = await source({ count: 1 }), original = await lib.PDFDocument.load(file.buffer), originalAP = lib.decodePDFRawStream(lookup(lookup(annotations(original, 0)[0], 'AP'), 'N')).decode();
  await open(page); await load(page, file); await expect(page.locator('#highlightApplyBtn')).toBeDisabled();
  const initial = await remainingSnapshot(page);
  await addNative(page, 'SELECTED TEXT PAGE 1');
  const withHighlight = await saved(page, info, 'delete-last-highlight-before.pdf'); expect(annotations(await lib.PDFDocument.load(withHighlight), 0)).toHaveLength(2);
  await page.locator('#highlightPanel>summary').click(); await page.selectOption('#highlightList', (await remainingSnapshot(page)).scene.objects[0].id);
  await page.click('#highlightDeleteBtn'); await ready(page); await expect(page.locator('#highlightApplyBtn')).toBeEnabled(); await expect(page.locator('#documentResult')).toBeHidden();
  expect((await remainingSnapshot(page)).scene.objects).toHaveLength(0);
  const empty = await saved(page, info, 'delete-last-highlight-empty.pdf'), repeated = await saved(page, info, 'delete-last-highlight-empty-repeat.pdf'); expect(remainingSha(repeated)).toBe(remainingSha(empty));
  const checkEmpty = async (bytes) => {
    const pdf = await lib.PDFDocument.load(bytes), values = annotations(pdf, 0); expect(values).toHaveLength(1); expect(lookup(values[0], 'Contents').decodeText()).toBe('Original – Yeşil not İstanbul');
    expect(lib.decodePDFRawStream(lookup(lookup(values[0], 'AP'), 'N')).decode()).toEqual(originalAP);
    const text = (await textOf(page, bytes))[0]; expect(text).toContain('SELECTED TEXT PAGE 1'); expect(text).toContain('UNTOUCHED SOURCE TEXT');
    const current = await remainingSnapshot(page); expect(current.state.taskId).toBe(initial.state.taskId); expect(remainingSha(current.original)).toBe(remainingSha(file.buffer)); expect(remainingSha(current.bytes)).toBe(remainingSha(bytes));
  };
  await checkEmpty(empty);
  await page.click('#highlightUndoBtn'); await ready(page); expect((await remainingSnapshot(page)).scene.objects).toHaveLength(1);
  const restored = await saved(page, info, 'delete-last-highlight-undo.pdf'); expect(annotations(await lib.PDFDocument.load(restored), 0)).toHaveLength(2);
  await page.click('#highlightRedoBtn'); await ready(page); expect((await remainingSnapshot(page)).scene.objects).toHaveLength(0); await expect(page.locator('#highlightApplyBtn')).toBeEnabled();
  const redone = await saved(page, info, 'delete-last-highlight-redo.pdf'); expect(remainingSha(redone)).toBe(remainingSha(empty)); await checkEmpty(redone);
  await info.attach('delete-last-highlight-artifacts', { body: JSON.stringify({ taskId: initial.state.taskId, originalSHA: remainingSha(file.buffer), firstSHA: remainingSha(withHighlight), emptySHA: remainingSha(empty), repeatSHA: remainingSha(repeated), undoSHA: remainingSha(restored), redoSHA: remainingSha(redone) }), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
