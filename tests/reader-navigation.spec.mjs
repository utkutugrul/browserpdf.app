import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

async function source(label = 'NAVIGATION', count = 3, heading = false) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), pages = [];
  for (let index = 1; index <= count; index++) {
    const page = doc.addPage([500, 400]); pages.push(page);
    page.setCropBox(30, 25, 420, 330);
    page.drawText(`${label} PAGE ${index}`, { x: 55, y: 250, size: 18, font });
    page.drawRectangle({ x: 55 + index * 25, y: 100, width: 50 + index * 20, height: 35, color: rgb(index / 4, .2, .7) });
  }
  if (count >= 3) {
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: { Names: [PDFString.of('navigation-third'), [pages[2].ref, 'Fit']] } }));
    const outline = doc.context.obj({ Type: 'Outlines', Count: 1 }), outlineRef = doc.context.register(outline);
    let parent = outlineRef, headingDict, headingRef;
    if (heading) { headingDict = doc.context.obj({ Title: PDFString.of('Heading without destination'), Parent: outlineRef, Count: 1 }); headingRef = doc.context.register(headingDict); parent = headingRef; outline.set(PDFName.of('Count'), doc.context.obj(2)); }
    const item = doc.context.register(doc.context.obj({ Title: PDFString.of('Held third page'), Parent: parent, Dest: PDFString.of('navigation-third') }));
    if (heading) { headingDict.set(PDFName.of('First'), item); headingDict.set(PDFName.of('Last'), item); }
    outline.set(PDFName.of('First'), headingRef || item); outline.set(PDFName.of('Last'), headingRef || item); doc.catalog.set(PDFName.of('Outlines'), outlineRef);
  }
  return { name: `${label}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

async function open(page) {
  await page.addInitScript(() => {
    localStorage.setItem('bpdf-consent', 'rejected');
    // Observe the real native outline handler through completion, including
    // its destination await and any resulting page render. No quiet-time guess.
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type !== 'click' || typeof listener !== 'function') return add.call(this, type, listener, options);
      return add.call(this, type, function (event) {
        const outline = this instanceof Element && this.closest('#readerOutlineItems');
        const result = listener.call(this, event);
        if (outline && result && typeof result.then === 'function') {
          window.readerDestinationSettled = false;
          Promise.resolve(result).then(() => { window.readerDestinationSettled = true; }, () => { window.readerDestinationSettled = true; });
        }
        return result;
      }, options);
    };
  });
  await page.goto('/view-pdf');
}

const state = (page) => page.evaluate(async () => (await import(new URL('./tool-ui.js', document.querySelector('script[type=module][src$="js/view-pdf.js"]').src).href)).documentSession.snapshot());
async function load(page, file) {
  const before = await state(page);
  await expect(page.locator('#fileInput')).toBeEnabled(); await page.setInputFiles('#fileInput', file);
  await expect.poll(async () => (await state(page)).taskId).not.toBe(before.taskId);
  await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#readerTextLayer')).toContainText(file.name.replace('.pdf', '') + ' PAGE 1');
}
async function ready(page, index, label = 'NAVIGATION') {
  await expect(page.locator('#readerPage')).toHaveValue(String(index));
  await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#readerTextLayer')).toHaveText(`${label} PAGE ${index}`);
}
async function direct(page, index) {
  await expect(page.locator('#readerPage')).toBeEnabled(); await page.fill('#readerPage', String(index)); await page.locator('#readerPage').press('Tab'); await ready(page, index);
}
async function picture(page, info, name) {
  const image = await page.locator('#pdfCanvas').evaluate((canvas) => ({ png: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height }));
  const bytes = Buffer.from(image.png, 'base64'); await writeFile(info.outputPath(name + '.png'), bytes);
  expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(1200); expect(image.width * image.height).toBeLessThanOrEqual(2_000_000);
  return { sha: createHash('sha256').update(bytes).digest('hex'), width: image.width, height: image.height };
}
async function hold(page, bytes) {
  await page.evaluate(async (bytes) => {
    const entry = document.querySelector('script[type=module][src$="js/view-pdf.js"]'), runtime = await import(new URL('./lib-loader.js', entry.src).href);
    const task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS });
    try {
      const prototype = Object.getPrototypeOf(await task.promise), original = prototype.getDestination;
      window.restoreReaderDestination = () => { prototype.getDestination = original; };
      prototype.getDestination = async function (name) {
        if (name === 'navigation-third') { window.readerDestinationHeld = true; await new Promise((resolve) => { window.releaseReaderDestination = resolve; }); }
        return original.call(this, name);
      };
    } finally { await task.destroy(); }
  }, [...bytes]);
  await page.locator('#readerOutline>summary').click(); await expect(page.locator('#readerOutlineItems button')).toHaveCount(1);
  await page.locator('#readerOutlineItems button').click();
  await expect.poll(() => page.evaluate(() => window.readerDestinationHeld)).toBe(true);
  expect(await page.evaluate(() => window.readerDestinationSettled)).toBe(false);
}
async function release(page) {
  await page.evaluate(() => window.releaseReaderDestination());
  await expect.poll(() => page.evaluate(() => window.readerDestinationSettled)).toBe(true);
  await page.evaluate(() => window.restoreReaderDestination());
}

for (const choice of ['direct page', 'search result', 'thumbnail']) test(`held named Reader destination loses to newer ${choice} with exact rendered page`, async ({ page }, info) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await open(page); const file = await source(); await load(page, file);
  await writeFile(info.outputPath('navigation-source.pdf'), file.buffer);
  await direct(page, 3); const obsolete = await picture(page, info, 'obsolete-page3-reference'); await direct(page, 1);
  // Prepare the actual native navigation control before holding the resolver.
  if (choice === 'search result') {
    await page.locator('#readerSearch>summary').click(); await page.fill('#readerSearchQuery', 'NAVIGATION PAGE 2'); await page.click('#readerSearchBtn');
    await expect(page.locator('#readerSearchResults button')).toHaveCount(1);
  } else if (choice === 'thumbnail') {
    await page.locator('#readerThumbnails>summary').click(); await expect(page.locator('#readerThumbnailItems button')).toHaveCount(3);
  }
  await hold(page, file.buffer);
  if (choice === 'direct page') await direct(page, 2);
  else if (choice === 'search result') await page.locator('#readerSearchResults button').click();
  else await page.locator('#readerThumbnailItems button[data-page-index="1"]').click();
  await ready(page, 2); const before = await state(page), newer = await picture(page, info, 'newer-page2');
  expect(newer.sha).not.toBe(obsolete.sha);
  await release(page); await ready(page, 2); const after = await picture(page, info, 'after-held-destination');
  expect(after).toEqual(newer); expect(await state(page)).toEqual(before); expect(errors).toEqual([]);
  if (choice === 'search result') await expect(page.locator('#readerSearchPaint span')).not.toHaveCount(0);
  await info.attach('native-held-destination-artifacts', { body: JSON.stringify({ choice, obsolete, newer, after, before }), contentType: 'application/json' });
});

test('incidental Reader resize preserves a held named destination until actual page render completes', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page); const file = await source(); await load(page, file); await hold(page, file.buffer);
  const oldWidth = await page.locator('#pdfCanvas').evaluate((canvas) => canvas.getBoundingClientRect().width);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(() => page.locator('#pdfCanvas').evaluate((canvas) => canvas.getBoundingClientRect().width)).not.toBe(oldWidth);
  await ready(page, 1); expect(await page.evaluate(() => window.readerDestinationSettled)).toBe(false);
  await release(page); await ready(page, 3); const resolved = await picture(page, info, 'resolved-after-resize');
  await direct(page, 3); expect(await picture(page, info, 'explicit-resized-page3-reference')).toEqual(resolved);
  expect((await state(page)).selection).toEqual([2]);
});

test('replacing the Reader source cancels a held named destination and retains exact new-page pixels', async ({ page }, info) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await open(page); const old = await source(); await load(page, old); const oldTask = (await state(page)).taskId; await hold(page, old.buffer);
  await page.locator('#readerReplace>summary').click(); const replacement = await source('REPLACEMENT', 2); await load(page, replacement); await ready(page, 1, 'REPLACEMENT');
  const before = await state(page), newer = await picture(page, info, 'new-source-before-release'); expect(before.taskId).not.toBe(oldTask);
  await release(page); await ready(page, 1, 'REPLACEMENT'); expect(await state(page)).toEqual(before); expect(await picture(page, info, 'new-source-after-release')).toEqual(newer); expect(errors).toEqual([]);
  await writeFile(info.outputPath('replacement-source.pdf'), replacement.buffer);
});

test('Reader outline heading without destination stays disabled through page, search and zoom updates', async ({ page }, info) => {
  await open(page); await load(page, await source('NAVIGATION', 3, true)); await page.locator('#readerOutline>summary').click();
  const heading = page.locator('#readerOutlineItems button').first(), child = page.locator('#readerOutlineItems button').last();
  await expect(page.locator('#readerOutlineItems button')).toHaveCount(2); await expect(heading).toBeDisabled(); await expect(child).toBeEnabled();
  await direct(page, 2); await expect(heading).toBeDisabled();
  await page.locator('#readerSearch>summary').click(); await page.fill('#readerSearchQuery', 'PAGE'); await page.click('#readerSearchBtn'); await expect(page.locator('#readerSearchResults button')).toHaveCount(3); await expect(heading).toBeDisabled();
  await page.click('#zoomInBtn'); await ready(page, 2); await expect(heading).toBeDisabled(); await expect(child).toBeEnabled();
  await child.click(); await ready(page, 3); await expect(heading).toBeDisabled(); await picture(page, info, 'valid-child-page3');
});
