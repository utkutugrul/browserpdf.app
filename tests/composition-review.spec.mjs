import { test,expect } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

function image(width,height,color) { const canvas = createCanvas(width,height),ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0,0,width,height); return [...canvas.toBuffer('image/png')]; }
async function seedReview(page) {
  await page.addInitScript(() => localStorage.setItem('bpdf-consent','rejected')); await page.goto('/view-pdf');
  return page.evaluate(async (inputs) => {
    const ui = await import('/js/tool-ui.js'), runtime = await import('/js/lib-loader.js'), { imageAsset } = await import('/js/core/object-scene.js'), { composeImagesPdf } = await import('/js/core/image-composition.js');
    await ui.ensureDocumentSession(); const pairs = [];
    for (const [index,input] of inputs.entries()) { const bytes = Uint8Array.from(input), name = `Original-${index + 1}-full-accessible-image.png`, file = new File([bytes],name,{ type:'image/png' }); pairs.push({ id:`item-${index}`,original:{ bytes,name,type:'image/png' },asset:await imageAsset(file,{ trim:false }),rotation:0,fit:'fit' }); }
    const before = ui.documentSession.snapshot(); await ui.documentSession.beginComposition(pairs,{ expectedTaskId:before.taskId,expectedRevision:before.revision });
    const state = ui.documentSession.snapshot(), result = await composeImagesPdf(ui.documentSession.composition(),{ resource:ui.documentSession.resource,pdfLib:await runtime.ensurePdfLib() });
    await ui.reviewResult(result.bytes,'shared-composition.pdf',{ ...result,compositionRevision:state.revision });
    return { taskId:state.taskId,originals:ui.documentSession.compositionSources(),composition:ui.documentSession.composition() };
  },[image(4096,2048,'#2040f0'),image(80,40,'#f02040')]);
}

test('composition review shows all immutable originals in one bounded source canvas and returns to the actual PDF', async ({ page },testInfo) => {
  const seeded = await seedReview(page); await expect(page.locator('#documentResultOriginal option')).toHaveCount(2);
  await expect(page.locator('#documentResultOriginal option').first()).toHaveText('Original-1-full-accessible-image.png'); await page.click('#showOriginalImageBtn');
  await expect(page.locator('#documentResultStatus')).toContainText('Original: Original-1');
  const bounds = await page.locator('#documentResultPreview canvas').evaluate((canvas) => [canvas.width,canvas.height]); expect(bounds).toEqual([1200,600]); expect(bounds[0]*bounds[1]).toBeLessThanOrEqual(2000000); await expect(page.locator('#documentResultPreview img')).toHaveCount(0);
  await page.selectOption('#documentResultOriginal',seeded.originals.originals[1].originalRef); await page.click('#showOriginalImageBtn'); await expect(page.locator('#documentResultStatus')).toContainText('Original: Original-2');
  expect(await page.locator('#documentResultPreview canvas').evaluate((canvas) => [...canvas.getContext('2d').getImageData(20,20,1,1).data])).toEqual([240,32,64,255]);
  await page.click('#showCompositionResultBtn'); await expect(page.locator('#documentResultPreview canvas')).toHaveAttribute('data-pdf-page','1');
  const [download] = await Promise.all([page.waitForEvent('download'),page.click('#downloadResultBtn')]); await download.saveAs(testInfo.outputPath('reviewed-composition.pdf')); expect((await PDFDocument.load(await readFile(testInfo.outputPath('reviewed-composition.pdf')))).getPageCount()).toBe(2);
  expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().taskId)).toBe(seeded.taskId);
});

test('Clear during held original-image decode drains and closes the bitmap without restoring bytes or canvas pixels', async ({ page }) => {
  await seedReview(page);
  await page.evaluate(() => { const decode = createImageBitmap; window.closedOriginalBitmaps = 0; window.originalDecodeEntered = false; const hold = new Promise((resolve) => { window.releaseOriginalDecode = resolve; });
    window.restoreOriginalDecoder = () => { window.createImageBitmap = decode; };
    window.createImageBitmap = async (...args) => { const bitmap = await decode(...args), close = bitmap.close.bind(bitmap); bitmap.close = () => { window.closedOriginalBitmaps++; close(); }; window.originalDecodeEntered = true; await hold; return bitmap; };
  });
  await page.click('#showOriginalImageBtn'); await expect.poll(() => page.evaluate(() => window.originalDecodeEntered)).toBe(true);
  await page.evaluate(async () => { (await import('/js/tool-ui.js')).documentSession.clear(); window.releaseOriginalDecode(); }); await expect.poll(() => page.evaluate(() => window.closedOriginalBitmaps)).toBe(1);
  await expect(page.locator('#documentResult')).toBeHidden(); expect(await page.locator('#documentResultPreview canvas').evaluate((canvas) => [canvas.width,canvas.height])).toEqual([0,0]);
  expect(await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'); return { current:ui.documentSession.current(),sources:ui.documentSession.compositionSources(),resources:ui.documentSession.snapshot().resourceBytes }; })).toEqual({ current:null,sources:null,resources:0 });
  await page.evaluate(() => window.restoreOriginalDecoder());
});

test('composition PDF Use, PDF editor and native Undo reopen the same editable composition with all originals', async ({ page }) => {
  const seeded = await seedReview(page); await page.click('#useResultBtn');
  const handoff = await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'), artifact = ui.documentSession.current(), next = await ui.stashForChain(artifact.bytes,artifact.name,'add-text',artifact); return { workflowId:next.workflowId,fileId:next.fileId }; });
  await page.goto(`/add-text?workflow=${handoff.workflowId}&file=${encodeURIComponent(handoff.fileId)}`); await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy','false'); await expect(page.locator('#undoEditBtn')).toBeEnabled();
  expect(await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'); return { taskId:ui.documentSession.snapshot().taskId,composition:ui.documentSession.composition(),sources:ui.documentSession.compositionSources() }; })).toEqual({ taskId:seeded.taskId,composition:null,sources:seeded.originals });
  await page.click('#undoEditBtn'); await expect(page).toHaveURL(/\/jpg-to-pdf\?workflow=/); await expect(page.locator('#imageComposer')).toBeVisible();
  expect(await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'); return { taskId:ui.documentSession.snapshot().taskId,composition:ui.documentSession.composition(),sources:ui.documentSession.compositionSources() }; })).toEqual({ taskId:seeded.taskId,composition:seeded.composition,sources:seeded.originals });
  await expect(page.locator('#composerImageList li')).toHaveCount(2);
});

test('operation-aware PDF validation loses to a newer image task before begin', async ({ page }) => {
  const seeded = await seedReview(page);
  const result = await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), runtime = await import('/js/lib-loader.js'), lib = await runtime.ensurePdfLib(), doc = await lib.PDFDocument.create(); doc.addPage([200,200]); const bytes = await doc.save();
    let release, entered; const gate = new Promise((resolve) => { entered = resolve; }), held = new Promise((resolve) => { release = resolve; }); const controller = new AbortController();
    const file = new File([bytes],'pending-new-PDF.pdf',{ type:'application/pdf' }); file.arrayBuffer = async () => { entered(); await held; return bytes.slice().buffer; };
    const state = ui.documentSession.snapshot(), operation = { signal:controller.signal,isCurrent:() => !controller.signal.aborted && ui.documentSession.snapshot().taskId === state.taskId && ui.documentSession.snapshot().revision === state.revision && ui.documentSession.snapshot().generation === state.generation };
    const pending = ui.readPdfFile(file,{ validate:true,operation }); await gate; const chosen = ui.documentSession.resource(ui.documentSession.compositionSources().originals[1].originalRef); ui.documentSession.begin(chosen.bytes,'newer-image.png',{ type:'image/png' }); const retained = JSON.stringify(ui.documentSession.transfer()); release(); const parsed = await pending;
    return { parsed,retained:retained === JSON.stringify(ui.documentSession.transfer()),taskId:ui.documentSession.snapshot().taskId };
  });
  expect(result).toMatchObject({ parsed:null,retained:true }); expect(result.taskId).not.toBe(seeded.taskId);
});
