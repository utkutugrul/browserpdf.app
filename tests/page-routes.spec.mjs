import { test, expect } from '@playwright/test';
import * as pdfLib from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function makePdf(markers, { rotations = false, structures = false, userUnit = false } = {}) {
  const doc = await pdfLib.PDFDocument.create(), font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  doc.setTitle('Page route source title');
  for (const [index, marker] of markers.entries()) {
    const page = doc.addPage([360, 300]); page.setCropBox(20, 30, 320, 240);
    if (rotations) page.setRotation(pdfLib.degrees(index % 4 * 90));
    if (userUnit) page.node.set(pdfLib.PDFName.of('UserUnit'), pdfLib.PDFNumber.of(2));
    page.drawText(marker, { x: 60, y: 150, size: 14, font });
    page.drawText('HIDDEN_EDGE_' + index, { x: 25, y: 250, size: 8, font });
  }
  if (structures) {
    const field = doc.getForm().createTextField('routeField'); field.setText('KEEP_FORM_VALUE'); field.addToPage(doc.getPage(1), { x: 70, y: 65, width: 120, height: 24 });
    doc.catalog.set(pdfLib.PDFName.of('Outlines'), doc.context.obj({ Type: 'Outlines', Count: 0 }));
  }
  return new Uint8Array(await doc.save());
}
async function open(page, mode, bytes) {
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
  await page.goto('/' + mode);
  await page.setInputFiles('#fileInput', { name: 'route-source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await expect(page.locator('#pageTask')).toBeVisible();
  await expect.poll(() => page.locator('#previewCanvas').evaluate((canvas) => canvas.width)).toBeGreaterThan(0);
}
async function range(page, value) { await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill(value); await page.getByRole('button', { name: 'Select range', exact: true }).click(); }
async function result(page, testInfo, name) {
  await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('The actual file is shown below.');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]);
  await download.saveAs(testInfo.outputPath(name)); return new Uint8Array(await readFile(testInfo.outputPath(name)));
}
async function textPages(page, bytes) {
  return page.evaluate(async (values) => {
    const { ensurePdfJs, PDFJS_ASSET_URLS } = await import('/js/lib-loader.js'); const task = (await ensurePdfJs()).getDocument({ data: new Uint8Array(values), ...PDFJS_ASSET_URLS });
    try { const doc = await task.promise, out = []; for (let n = 1; n <= doc.numPages; n++) out.push((await (await doc.getPage(n)).getTextContent()).items.map((v) => v.str).join(' ')); return out; }
    finally { await task.destroy(); }
  }, Array.from(bytes));
}
async function formSceneHandoff(page, source, mode, { flatten = false, edit = true } = {}) {
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
  await page.goto('/merge');
  const handoff = await page.evaluate(async ({ values, mode, flatten, edit }) => {
    const ui = await import('/js/tool-ui.js'); await ui.ensureDocumentSession();
    ui.documentSession.begin(new Uint8Array(values), 'form-scene.pdf', { capabilities: { forms: true } });
    const scene = ui.documentSession.beginScene();
    if (edit) scene.fields.routeField = { kind: 'text', value: 'EDITED_FORM_VALUE' };
    scene.flatten = flatten; ui.documentSession.changeScene(scene);
    const input = await ui.getWorkspaceInput(); ui.documentSession.publishScene(input.bytes, input.name);
    return ui.stashForChain(input.bytes, input.name, mode);
  }, { values: Array.from(source), mode, flatten, edit });
  await page.goto(`/${mode}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`);
}

async function letterPdf(markers = ['HISTORY_SOURCE', 'UNCHANGED_SECOND']) {
  const doc = await pdfLib.PDFDocument.create();
  for (const marker of markers) doc.addPage([612, 792]).drawText(marker, { x: 100, y: 600 });
  return new Uint8Array(await doc.save());
}
async function holdSelectedCropRender(page, { fail = false } = {}) {
  await page.evaluate(async ({ fail }) => {
    const ui = await import('/js/tool-ui.js'), runtime = await import('/js/lib-loader.js');
    const task = (await runtime.ensurePdfJs()).getDocument({ data: ui.documentSession.current().bytes, ...runtime.PDFJS_ASSET_URLS });
    const proxy = await (await task.promise).getPage(1), proto = Object.getPrototypeOf(proxy), original = proto.render;
    await task.destroy(); window.cropHistoryRender = { held: false, settled: false };
    proto.render = function (options) {
      if (options.canvasContext.canvas.id !== 'previewCanvas') return original.call(this, options);
      proto.render = original; const actual = original.call(this, options);
      return { cancel: () => actual.cancel(), promise: actual.promise.then(async () => {
        window.cropHistoryRender.held = true;
        await new Promise((resolve) => { window.cropHistoryRender.release = resolve; });
        window.cropHistoryRender.settled = true;
        if (fail) throw new Error('Owned selected-page render failed for recovery probe');
      }) };
    };
  }, { fail });
}
async function setLetterCrop(page) {
  await range(page, '1'); await page.fill('#cropLeft', '20'); await page.fill('#cropTop', '10');
  await page.click('#cropSelectedBtn'); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#pageTaskStatus')).toContainText('1 cropped');
}
async function expectHeldCropControls(page) {
  await expect.poll(() => page.evaluate(() => window.cropHistoryRender.held)).toBe(true);
  await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'true');
  // Thumbnails are already ready: the actual selected-page presentation owns
  // the remaining lock, rather than an incidental thumbnail delay.
  await expect(page.locator('.page-workspace')).toHaveAttribute('aria-busy', 'false');
  for (const id of ['applyBtn', 'cropSelectedBtn', 'resetCropBtn', 'cropTop', 'cropRight', 'cropBottom', 'cropLeft']) await expect(page.locator('#' + id)).toBeDisabled();
  await expect(page.locator('#cancelPageOperationBtn')).toBeHidden();
  await page.evaluate(() => {
    document.getElementById('cancelPageOperationBtn').click();
    document.getElementById('applyBtn').click();
    document.getElementById('cropSelectedBtn').click();
  });
  await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#applyBtn')).toBeDisabled();
  await expect(page.locator('#documentResult')).toBeHidden();
}

test('Organize actual route moves groups, duplicates, deletes, inserts ranges and reviews chosen adoption with document undo', async ({ page }, testInfo) => {
  const source = await makePdf(['PAGE_A', 'PAGE_B', 'PAGE_C', 'PAGE_D'], { structures: true }), external = await makePdf(['EXT_ONE', 'EXT_TWO']);
  await open(page, 'organize', source); let downloads = 0; page.on('download', () => downloads++);
  await range(page, '2-3'); await page.fill('#moveBeforePage', '1'); await page.click('#moveSelectedBtn');
  await expect(page.locator('.page-workspace-tile').first()).toHaveAttribute('data-page-id', 'current-2');
  await page.fill('#moveBeforePage', '5'); await page.click('#duplicateSelectedBtn');
  await expect(page.locator('#pageTaskIdentity')).toContainText('6 pages');
  await page.click('#deleteSelectedBtn'); await expect(page.locator('#pageTaskIdentity')).toContainText('4 pages');
  await page.click('#undoPageEditBtn'); await expect(page.locator('#pageTaskIdentity')).toContainText('6 pages');
  await page.click('#redoPageEditBtn'); await expect(page.locator('#pageTaskIdentity')).toContainText('4 pages');
  await page.fill('#moveBeforePage', '2'); await page.fill('#insertPageRanges', '2');
  await page.setInputFiles('#insertPdfInput', { name: 'external.pdf', mimeType: 'application/pdf', buffer: Buffer.from(external) });
  await expect(page.locator('#pageTaskIdentity')).toContainText('5 pages');
  await page.locator('#workspaceModes [data-mode="rotate"]').click();
  await expect(page.locator('#pageTaskStatus')).toContainText('Review and use the result'); expect(new URL(page.url()).pathname).toBe('/organize');
  // A genuine page-navigation link still protects the pending plan. The actual
  // blob download below must pass the same capture listener and save the PDF.
  await page.locator('.related-tools a[href="rotate"]').click();
  expect(new URL(page.url()).pathname).toBe('/organize'); await expect(page.locator('#pageTaskStatus')).toContainText('Review and use the result');
  await page.click('#applyBtn'); await expect(page.locator('#documentResultLosses')).toContainText('interactive form');
  await expect(page.locator('#documentResultStatus')).toContainText('The actual file is shown below.'); expect(downloads).toBe(0);
  expect(await page.evaluate(async () => Array.from((await import('/js/tool-ui.js')).documentSession.current().bytes))).toEqual(Array.from(source));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); await download.saveAs(testInfo.outputPath('organized-ranges.pdf'));
  const bytes = new Uint8Array(await readFile(testInfo.outputPath('organized-ranges.pdf')));
  expect((await textPages(page, bytes)).map((text) => text.match(/PAGE_\w+|EXT_\w+/)?.[0])).toEqual(['PAGE_A', 'EXT_TWO', 'PAGE_D', 'PAGE_B', 'PAGE_C']);
  await page.click('#useResultBtn'); await expect(page.locator('#pageTaskStatus')).toContainText('Current document');
  await expect(page.locator('#pageTaskIdentity')).toContainText('5 pages');
  await page.click('#undoDocumentBtn'); await expect(page.locator('#pageTaskIdentity')).toContainText('4 pages');
  expect(await page.evaluate(async () => Array.from((await import('/js/tool-ui.js')).documentSession.current().bytes))).toEqual(Array.from(source));
});

test('Rotate actual route selected scope and reset preserve verified catalog/form and expose OCR continuation', async ({ page }, testInfo) => {
  const source = await makePdf(['ROT_A', 'ROT_B', 'ROT_C', 'ROT_D'], { structures: true }); await open(page, 'rotate', source);
  await range(page, '2,4'); await page.click('#rotateSelectedRightBtn'); await range(page, '4'); await page.click('#resetBtn');
  const bytes = await result(page, testInfo, 'selected-rotation.pdf'), doc = await pdfLib.PDFDocument.load(bytes);
  expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0, 0]);
  expect(doc.getTitle()).toBe('Page route source title'); expect(doc.getForm().getTextField('routeField').getText()).toBe('KEEP_FORM_VALUE');
  expect(doc.catalog.has(pdfLib.PDFName.of('Outlines'))).toBe(true);
  await page.click('#useResultBtn'); await expect(page.locator('#pageTaskStatus')).toContainText('Current document');
  await page.locator('#workspaceModes [data-mode="ocr-pdf"]').click(); await expect(page).toHaveURL(/\/ocr-pdf\?workflow=/);
});

test('Delete actual route prevents all-page removal and keep-selected previews remaining order with local undo', async ({ page }, testInfo) => {
  await open(page, 'delete-pages', await makePdf(['DEL_A', 'DEL_B', 'DEL_C', 'DEL_D']));
  await page.locator('[data-selection="all"]').click(); await page.click('#deleteSelectedBtn'); await expect(page.locator('#errorText')).toContainText('Keep between 1');
  await range(page, '2,4'); await page.click('#keepSelectedBtn'); await expect(page.locator('#pageTaskIdentity')).toContainText('2 pages');
  await expect(page.locator('.page-workspace-tile').first()).toHaveAttribute('data-page-id', 'current-2');
  await page.click('#undoPageEditBtn'); await expect(page.locator('#pageTaskIdentity')).toContainText('4 pages');
  await page.click('#redoPageEditBtn'); const bytes = await result(page, testInfo, 'kept-pages.pdf');
  expect((await textPages(page, bytes)).map((text) => text.match(/DEL_\w+/)?.[0])).toEqual(['DEL_B', 'DEL_D']);
});

test('Crop actual route maps all rotations/CropBox/UserUnit, preserves MediaBox and recoverable hidden content', async ({ page }, testInfo) => {
  const source = await makePdf(['CROP_A', 'CROP_B', 'CROP_C', 'CROP_D'], { rotations: true, userUnit: true }); await open(page, 'crop', source);
  await range(page, '1-4'); await page.fill('#cropTop', '20'); await page.fill('#cropRight', '30'); await page.fill('#cropBottom', '40'); await page.fill('#cropLeft', '50');
  // Independent physical-point oracle: UserUnit 2 halves each visible inset in
  // raw page coordinates. Rotation changes which raw edge receives each inset.
  const expected = [{x:45,y:50,width:280,height:210},{x:30,y:55,width:290,height:200},{x:35,y:40,width:280,height:210},{x:40,y:45,width:290,height:200}];
  const bytes = await result(page, testInfo, 'cropped-rotations-userunit.pdf'), doc = await pdfLib.PDFDocument.load(bytes);
  for (const [index, p] of doc.getPages().entries()) { expect(p.getCropBox()).toEqual(expected[index]); expect(p.getMediaBox()).toEqual({ x:0,y:0,width:360,height:300 }); expect(p.node.get(pdfLib.PDFName.of('UserUnit')).asNumber()).toBe(2); }
  await expect(page.locator('#documentResultLosses')).toContainText('does not securely remove');
  for (const p of doc.getPages()) p.setCropBox(0,0,360,300);
  const restored = new Uint8Array(await doc.save()); expect((await textPages(page, restored)).every((text, index) => text.includes('HIDDEN_EDGE_' + index))).toBe(true);
});

test('Crop drag and keyboard insets target only selected page, and failed external intake leaves canonical source intact', async ({ page }, testInfo) => {
  const source = await makePdf(['ONE', 'TWO']); await open(page, 'crop', source); await range(page, '2');
  await page.fill('#pagePreviewNumber', '2'); await page.locator('#pagePreviewNumber').press('Tab'); await expect(page.locator('#pagePreviewStatus')).toContainText('2 / 2');
  const box = await page.locator('#previewCanvas').boundingBox();
  await page.mouse.move(box.x + box.width*.1, box.y + box.height*.15); await page.mouse.down(); await page.mouse.move(box.x + box.width*.85, box.y + box.height*.8); await page.mouse.up();
  expect(Number(await page.inputValue('#cropLeft'))).toBeGreaterThan(0);
  const bytes = await result(page, testInfo, 'selected-drag-crop.pdf'), doc = await pdfLib.PDFDocument.load(bytes);
  expect(doc.getPage(0).getCropBox()).toEqual({x:20,y:30,width:320,height:240}); expect(doc.getPage(1).getCropBox().width).toBeCloseTo(240,0);
  const unchanged = await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'); const before = ui.documentSession.snapshot();
    let rejected = false; try { await ui.readExternalPdfFile(new File(['not a pdf'], 'bad.pdf', {type:'application/pdf'})); } catch { rejected = true; }
    return { rejected, same: JSON.stringify(before) === JSON.stringify(ui.documentSession.snapshot()) };
  }); expect(unchanged).toEqual({rejected:true,same:true});
});

test('Merge actual source ranges/keyboard order review real page order without changing original/current on external intake', async ({ page }, testInfo) => {
  const first = await makePdf(['MERGE_A1','MERGE_A2','MERGE_A3']), second = await makePdf(['MERGE_B1','MERGE_B2']);
  await page.addInitScript(() => localStorage.setItem('bpdf-consent','rejected')); await page.goto('/merge');
  await page.setInputFiles('#fileInput',[{name:'first.pdf',mimeType:'application/pdf',buffer:Buffer.from(first)},{name:'second.pdf',mimeType:'application/pdf',buffer:Buffer.from(second)}]);
  await expect(page.locator('#mergeBtn')).toBeEnabled(); await expect(page.locator('.merge-source-thumbnail')).toHaveCount(2);
  await page.getByRole('textbox',{name:'Pages from first.pdf'}).fill('2-3'); await page.getByRole('textbox',{name:'Pages from second.pdf'}).fill('2');
  await page.locator('.file-item').nth(1).locator('[data-action="up"]').focus(); await page.keyboard.press('Enter');
  await page.click('#mergeBtn'); await expect(page.locator('#documentResultStatus')).toContainText('The actual file is shown below.');
  const [download] = await Promise.all([page.waitForEvent('download'),page.click('#downloadResultBtn')]); await download.saveAs(testInfo.outputPath('merged-source-ranges.pdf'));
  const bytes = new Uint8Array(await readFile(testInfo.outputPath('merged-source-ranges.pdf')));
  expect((await textPages(page,bytes)).map((text)=>text.match(/MERGE_\w+/)?.[0])).toEqual(['MERGE_B2','MERGE_A2','MERGE_A3']);
  await expect(page.locator('#documentResultLosses')).toContainText('Copied pages');
  await page.click('#useResultBtn');
  const chosen = await page.evaluate(async () => { const snapshot=(await import('/js/tool-ui.js')).documentSession.snapshot(); return {taskId:snapshot.taskId,revision:snapshot.revision,name:snapshot.current.name}; });
  expect(chosen.taskId).toEqual(expect.any(String)); expect(chosen.revision).toBe(1);
  await page.locator('#chainRow').getByRole('button',{name:'Organize',exact:true}).click(); await expect(page).toHaveURL(/\/organize\?workflow=/);
  await expect(page.locator('#pageTaskIdentity')).toContainText('3 pages');
  expect(await page.evaluate(async () => { const snapshot=(await import('/js/tool-ui.js')).documentSession.snapshot();return {taskId:snapshot.taskId,revision:snapshot.revision,name:snapshot.current.name}; })).toEqual(chosen);
});

test('page route cancelled processing cannot publish a stale result', async ({ page }) => {
  await open(page,'rotate',await makePdf(['CANCEL_A','CANCEL_B'])); await range(page,'2'); await page.click('#rotateSelectedRightBtn');
  await page.evaluate(() => { const original=window.PDFLib.PDFDocument.load; let held=false;window.PDFLib.PDFDocument.load=async function(...args){if(!held){held=true;await new Promise((resolve)=>{window.releaseCancelledPageLoad=resolve;});}return original.apply(this,args);}; });
  await page.click('#applyBtn'); await expect.poll(()=>page.evaluate(()=>typeof window.releaseCancelledPageLoad)).toBe('function');
  await page.click('#cancelPageOperationBtn'); await page.evaluate(()=>window.releaseCancelledPageLoad());
  await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy','false'); await expect(page.locator('#documentResult')).toHaveCount(0);
  expect(await page.evaluate(async()=> (await import('/js/tool-ui.js')).documentSession.snapshot().revision)).toBe(0);
});

test('early result adoption keeps old page actions disabled through owned asynchronous hydration', async ({ page }) => {
  await open(page,'rotate',await makePdf(['ADOPT_A','ADOPT_B'])); await range(page,'2'); await page.click('#rotateSelectedRightBtn');
  await page.locator('.page-workspace').evaluate(async (root) => {
    if (root.getAttribute('aria-busy') !== 'true') return;
    await new Promise((resolve) => {
      const watch = new MutationObserver(() => { if (root.getAttribute('aria-busy') === 'false') { watch.disconnect(); resolve(); } });
      watch.observe(root, { attributes: true });
    });
  });
  await page.evaluate(async()=>{
    const ui=await import('/js/tool-ui.js'),runtime=await import('/js/lib-loader.js'),task=(await runtime.ensurePdfJs()).getDocument({data:ui.documentSession.current().bytes,...runtime.PDFJS_ASSET_URLS});
    try{const proxy=await (await task.promise).getPage(1),proto=Object.getPrototypeOf(proxy),original=proto.render;proto.render=function(options){const actual=original.call(this,options);if(!options.canvasContext.canvas.closest('#documentResultPreview'))return actual;proto.render=original;return{cancel:()=>actual.cancel(),promise:actual.promise.then(()=>new Promise((resolve)=>{window.releaseEarlyResultRender=resolve;}))};};}finally{await task.destroy();}
  });
  await page.click('#applyBtn'); await expect.poll(()=>page.evaluate(()=>typeof window.releaseEarlyResultRender)).toBe('function');
  await page.evaluate(()=>{const original=window.PDFLib.PDFDocument.load;let held=false;window.PDFLib.PDFDocument.load=async function(...args){if(!held){held=true;await new Promise((resolve)=>{window.releaseAdoptionHydration=resolve;});}return original.apply(this,args);};});
  await page.click('#useResultBtn'); await expect.poll(()=>page.evaluate(()=>typeof window.releaseAdoptionHydration)).toBe('function');
  await page.evaluate(()=>window.releaseEarlyResultRender());
  await expect(page.locator('#applyBtn')).toBeDisabled(); await expect(page.locator('#rotateSelectedRightBtn')).toBeDisabled(); await expect(page.locator('#cancelPageOperationBtn')).toBeHidden();
  await page.evaluate(()=>window.releaseAdoptionHydration()); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy','false'); await expect(page.locator('#applyBtn')).toBeEnabled();
  await expect(page.locator('#pageTaskStatus')).toContainText('Current document');
});

test('Merge Clear cancels a held initial read and permits fresh intake before the abandoned read finishes', async ({ page }, testInfo) => {
  const held = await makePdf(['ABANDONED']), first = await makePdf(['FRESH_ONE']), second = await makePdf(['FRESH_TWO']);
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected')); await page.goto('/merge');
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== 'held.pdf') return original.call(this);
      const file = this; return new Promise((resolve, reject) => {
        window.releaseHeldInitialRead = () => original.call(file).then((value) => { window.heldInitialReadSettled = true; resolve(value); }, reject);
      });
    };
  });
  await page.setInputFiles('#fileInput', { name: 'held.pdf', mimeType: 'application/pdf', buffer: Buffer.from(held) });
  await expect.poll(() => page.evaluate(() => typeof window.releaseHeldInitialRead)).toBe('function');
  await expect(page.locator('#clearBtn')).toBeEnabled(); await page.click('#clearBtn');
  await expect(page.locator('.merge-workspace')).toHaveAttribute('aria-busy', 'false');
  await page.setInputFiles('#fileInput', [{ name: 'fresh-one.pdf', mimeType: 'application/pdf', buffer: Buffer.from(first) }, { name: 'fresh-two.pdf', mimeType: 'application/pdf', buffer: Buffer.from(second) }]);
  await expect(page.locator('#mergeBtn')).toBeEnabled(); expect(await page.evaluate(() => !!window.heldInitialReadSettled)).toBe(false);
  await page.click('#mergeBtn'); await expect(page.locator('#documentResultStatus')).toContainText('The actual file is shown below.');
  await page.evaluate(() => window.releaseHeldInitialRead()); await expect.poll(() => page.evaluate(() => window.heldInitialReadSettled)).toBe(true);
  await expect(page.locator('.file-item-name')).toHaveText(['fresh-one.pdf', 'fresh-two.pdf']);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); await download.saveAs(testInfo.outputPath('fresh-after-cancel.pdf'));
  const bytes = new Uint8Array(await readFile(testInfo.outputPath('fresh-after-cancel.pdf')));
  expect((await textPages(page, bytes)).map((text) => text.match(/FRESH_\w+/)?.[0])).toEqual(['FRESH_ONE', 'FRESH_TWO']);
});

test('failed page adoption hydration keeps stale actions disabled and offers working retry and replacement recovery', async ({ page }) => {
  await open(page, 'rotate', await makePdf(['RETRY_A', 'RETRY_B'])); await range(page, '2'); await page.click('#rotateSelectedRightBtn');
  const failNextHydration = () => page.evaluate(() => {
    const original = window.PDFLib.PDFDocument.load;
    window.PDFLib.PDFDocument.load = async function (...args) { window.PDFLib.PDFDocument.load = original; throw new Error('Intentional hydration failure'); };
  });
  await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('The actual file is shown below.'); await failNextHydration(); await page.click('#useResultBtn');
  await expect(page.locator('#retryPageWorkspaceBtn')).toBeVisible(); await expect(page.locator('#applyBtn')).toBeDisabled();
  await page.click('#retryPageWorkspaceBtn'); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#applyBtn')).toBeEnabled();
  await page.click('#rotateSelectedLeftBtn'); await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('The actual file is shown below.'); await failNextHydration(); await page.click('#useResultBtn');
  await expect(page.locator('#retryPageWorkspaceBtn')).toBeVisible();
  const chooserPromise = page.waitForEvent('filechooser'); await page.click('#replacePageInputBtn'); const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await makePdf(['REPLACED'])) });
  await expect(page.locator('#pageTaskIdentity')).toContainText('replacement.pdf'); await expect(page.locator('#pageTaskIdentity')).toContainText('1 pages');
  await expect(page.locator('#applyBtn')).toBeEnabled();
});

test('Rotate after a flattened form-only scene derives forms capability from real saved fields', async ({ page }, testInfo) => {
  await formSceneHandoff(page, await makePdf(['FORM_A', 'FORM_B'], { structures: true }), 'rotate', { flatten: true });
  await expect(page.locator('#pageTask')).toBeVisible(); await range(page, '2'); await page.click('#rotateSelectedRightBtn');
  const bytes = await result(page, testInfo, 'flattened-form-rotated.pdf'), saved = await pdfLib.PDFDocument.load(bytes);
  expect(saved.getForm().getFields()).toHaveLength(0); expect((await textPages(page, bytes)).join(' ')).toContain('EDITED_FORM_VALUE');
  await expect(page.locator('#documentResultLosses')).toContainText('pending edits');
  await page.click('#useResultBtn'); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().current.capabilities.forms)).toBe(false);
});

test('Merge form-only and flatten-only scene boundaries disclose included pending edits without a false flattening claim', async ({ page }, testInfo) => {
  const source = await makePdf(['FORM_SOURCE_A', 'FORM_SOURCE_B'], { structures: true }), extra = await makePdf(['EXTRA']);
  for (const [name, options] of [['field-only', { edit: true, flatten: false }], ['flatten-only', { edit: false, flatten: true }]]) {
    await formSceneHandoff(page, source, 'merge', options); await expect(page.locator('.file-item')).toHaveCount(1);
    await page.setInputFiles('#fileInput', { name: 'extra.pdf', mimeType: 'application/pdf', buffer: Buffer.from(extra) }); await expect(page.locator('#mergeBtn')).toBeEnabled();
    await page.click('#mergeBtn'); await expect(page.locator('#documentResultStatus')).toContainText('The actual file is shown below.');
    await expect(page.locator('#documentResultLosses')).toContainText('pending edits'); await expect(page.locator('#documentResultLosses')).not.toContainText('bakes editable');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); await download.saveAs(testInfo.outputPath(`merge-${name}.pdf`));
    expect((await pdfLib.PDFDocument.load(await readFile(testInfo.outputPath(`merge-${name}.pdf`)))).getPageCount()).toBe(3);
  }
});

test('initial page workspace controls stay inert until owned input parsing completes, then the actual saved operation works', async ({ page }, testInfo) => {
  const source = await makePdf(['READY_A', 'READY_B']);
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected')); await page.goto('/rotate');
  await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), lib = await (await import('/js/lib-loader.js')).ensurePdfLib();
    const original = lib.PDFDocument.load; let held = false;
    lib.PDFDocument.load = async function (...args) {
      const loaded = await original.apply(this, args);
      // Initial intake validation runs before canonical begin. Hold only the
      // adapter's subsequent owned parsing, when its controls already exist.
      if (!held && ui.documentSession.snapshot().current) {
        held = true; lib.PDFDocument.load = original;
        await new Promise((resolve) => { window.releaseInitialPageParsing = resolve; });
      }
      return loaded;
    };
  });
  await page.setInputFiles('#fileInput', { name: 'readiness.pdf', mimeType: 'application/pdf', buffer: Buffer.from(source) });
  await expect.poll(() => page.evaluate(() => typeof window.releaseInitialPageParsing)).toBe('function');
  await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'true'); await expect(page.locator('#applyBtn')).toBeDisabled();
  await expect(page.locator('#workspaceModes [data-mode="organize"]')).toBeDisabled();
  const before = await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot());
  await page.locator('#workspaceModes [data-mode="organize"]').evaluate((control) => control.click());
  await page.locator('#applyBtn').evaluate((control) => control.click());
  expect(new URL(page.url()).pathname).toBe('/rotate');
  expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot())).toEqual(before);
  await page.evaluate(() => window.releaseInitialPageParsing());
  await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  await range(page, '2'); await page.click('#rotateSelectedRightBtn');
  const bytes = await result(page, testInfo, 'ready-selected-rotation.pdf');
  expect((await pdfLib.PDFDocument.load(bytes)).getPages().map((p) => p.getRotation().angle)).toEqual([0, 90]);
});

test('Crop native controls reject input during held initialization, then keyboard insets save the exact visible box', async ({ page }, testInfo) => {
  const doc = await pdfLib.PDFDocument.create(); const p = doc.addPage([612, 792]); p.drawText('CROP_READY', { x: 100, y: 600 });
  const source = new Uint8Array(await doc.save());
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected')); await page.goto('/crop');
  await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), lib = await (await import('/js/lib-loader.js')).ensurePdfLib(), original = lib.PDFDocument.load;
    let held = false;
    lib.PDFDocument.load = async function (...args) {
      const loaded = await original.apply(this, args);
      if (!held && ui.documentSession.snapshot().current) { held = true; lib.PDFDocument.load = original; await new Promise((resolve) => { window.releaseInitialCropParsing = resolve; }); }
      return loaded;
    };
  });
  await page.setInputFiles('#fileInput', { name: 'crop-readiness.pdf', mimeType: 'application/pdf', buffer: Buffer.from(source) });
  await expect.poll(() => page.evaluate(() => typeof window.releaseInitialCropParsing)).toBe('function');
  for (const id of ['cropTop', 'cropRight', 'cropBottom', 'cropLeft']) await expect(page.locator('#' + id)).toBeDisabled();
  expect(await page.locator('#cropTop').evaluate((control) => { control.focus(); return document.activeElement === control; })).toBe(false);
  await page.keyboard.type('9'); await expect(page.locator('#cropTop')).toHaveValue('0');
  await page.evaluate(() => window.releaseInitialCropParsing()); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#cropTop').focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('100');
  await expect(page.locator('#cropTop')).toHaveValue('100');
  await page.locator('#cropLeft').fill('50');
  const saved = await pdfLib.PDFDocument.load(await result(page, testInfo, 'crop-ready-562x692.pdf'));
  expect(saved.getPage(0).getCropBox()).toEqual({ x: 50, y: 0, width: 562, height: 692 });
  expect(saved.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
});

test('Crop keeps a newer numeric draft through a held page render and Undo restores the actual source box', async ({ page }, testInfo) => {
  await open(page, 'crop', await makePdf(['DRAFT_A', 'DRAFT_B'])); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  await range(page, '1'); await page.fill('#cropLeft', '20'); await page.fill('#cropTop', '10'); await page.click('#cropSelectedBtn');
  await expect(page.locator('#pageTaskStatus')).toContainText('1 cropped');
  await page.fill('#pagePreviewNumber', '2'); await page.locator('#pagePreviewNumber').press('Tab'); await expect(page.locator('#pagePreviewStatus')).toContainText('2 / 2');
  await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), runtime = await import('/js/lib-loader.js'), task = (await runtime.ensurePdfJs()).getDocument({ data: ui.documentSession.current().bytes, ...runtime.PDFJS_ASSET_URLS });
    try {
      const page = await (await task.promise).getPage(1), proto = Object.getPrototypeOf(page), original = proto.render;
      proto.render = function (options) {
        const actual = original.call(this, options);
        if (options.canvasContext.canvas.id !== 'previewCanvas' || this.pageNumber !== 1) return actual;
        proto.render = original;
        return { cancel: () => actual.cancel(), promise: actual.promise.then(() => new Promise((resolve) => { window.releaseDraftCropRender = resolve; })) };
      };
    } finally { await task.destroy(); }
  });
  await page.fill('#pagePreviewNumber', '1'); await page.locator('#pagePreviewNumber').press('Tab');
  await expect.poll(() => page.evaluate(() => typeof window.releaseDraftCropRender)).toBe('function');
  await page.fill('#cropLeft', '60'); await page.fill('#cropTop', '30'); await page.evaluate(() => window.releaseDraftCropRender());
  await expect(page.locator('#pagePreviewStatus')).toContainText('1 / 2');
  await expect(page.locator('#cropLeft')).toHaveValue('60'); await expect(page.locator('#cropTop')).toHaveValue('30');
  const saved = await pdfLib.PDFDocument.load(await result(page, testInfo, 'crop-newer-draft.pdf'));
  expect(saved.getPage(0).getCropBox()).toEqual({ x: 80, y: 30, width: 260, height: 210 });
  expect(saved.getPage(1).getCropBox()).toEqual({ x: 20, y: 30, width: 320, height: 240 });
  await page.click('#undoPageEditBtn'); await expect(page.locator('#cropLeft')).toHaveValue('20.00');
  await page.click('#undoPageEditBtn'); await expect(page.locator('#cropLeft')).toHaveValue('0.00'); await expect(page.locator('#cropTop')).toHaveValue('0.00');
  const restored = await pdfLib.PDFDocument.load(await result(page, testInfo, 'crop-after-local-undo.pdf'));
  expect(restored.getPage(0).getCropBox()).toEqual({ x: 20, y: 30, width: 320, height: 240 });
});

test('Crop superseded asynchronous review cannot commit or publish its older inset intent', async ({ page }, testInfo) => {
  const source = await makePdf(['OBSOLETE_A', 'OBSOLETE_B']); await open(page, 'crop', source); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.page-workspace')).toHaveAttribute('aria-busy', 'false');
  await range(page, '1'); await page.fill('#cropLeft', '20'); await page.fill('#cropTop', '10');
  await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), runtime = await import('/js/lib-loader.js'), task = (await runtime.ensurePdfJs()).getDocument({ data: ui.documentSession.current().bytes, ...runtime.PDFJS_ASSET_URLS });
    const doc = await task.promise, proto = Object.getPrototypeOf(doc), originalPage = proto.getPage, taskProto = Object.getPrototypeOf(task), originalDestroy = taskProto.destroy;
    proto.getPage = async function (...args) {
      proto.getPage = originalPage;
      await new Promise((resolve) => { window.releaseObsoleteCropPage = resolve; });
      const page = await originalPage.apply(this, args); window.obsoleteCropPageReturned = true; return page;
    };
    taskProto.destroy = async function (...args) {
      const value = await originalDestroy.apply(this, args);
      if (window.obsoleteCropPageReturned) { taskProto.destroy = originalDestroy; window.obsoleteCropTaskSettled = true; }
      return value;
    };
    await task.destroy();
  });
  await page.click('#applyBtn'); await expect.poll(() => page.evaluate(() => typeof window.releaseObsoleteCropPage)).toBe('function');
  await page.fill('#cropLeft', '50'); await page.evaluate(() => window.releaseObsoleteCropPage());
  await expect.poll(() => page.evaluate(() => window.obsoleteCropTaskSettled)).toBe(true);
  await expect(page.locator('#documentResult')).toHaveCount(0); await expect(page.locator('#pageTaskStatus')).toContainText('0 cropped');
  expect(await page.evaluate(async () => Array.from((await import('/js/tool-ui.js')).documentSession.current().bytes))).toEqual(Array.from(source));
  const saved = await pdfLib.PDFDocument.load(await result(page, testInfo, 'crop-latest-after-obsolete.pdf'));
  expect(saved.getPage(0).getCropBox()).toEqual({ x: 70, y: 30, width: 270, height: 230 });
  expect(saved.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 360, height: 300 });
});

for (const [kind, control, cropped] of [['Undo', 'undoPageEditBtn', false], ['Reset', 'resetCropBtn', false], ['Redo', 'redoPageEditBtn', true]]) {
  test(`Crop ${kind} locks immediate Review until the chosen actual preview and insets are ready`, async ({ page }, testInfo) => {
    const source = await letterPdf(); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await open(page, 'crop', source); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
    await setLetterCrop(page);
    if (kind === 'Redo') { await page.click('#undoPageEditBtn'); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#cropLeft')).toHaveValue('0.00'); }
    const before = await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot());
    await holdSelectedCropRender(page); await page.click('#' + control); await expectHeldCropControls(page);
    await expect(page.locator('#pageTaskStatus')).toContainText(cropped ? '1 cropped' : '0 cropped');
    expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot())).toEqual(before);
    await page.evaluate(() => window.cropHistoryRender.release());
    await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#cropLeft')).toHaveValue(cropped ? '20.00' : '0.00');
    await expect(page.locator('#cropTop')).toHaveValue(cropped ? '10.00' : '0.00');
    const saved = await pdfLib.PDFDocument.load(await result(page, testInfo, `crop-fast-${kind.toLowerCase()}-chosen.pdf`));
    expect(saved.getPage(0).getCropBox()).toEqual(cropped ? { x: 20, y: 0, width: 592, height: 782 } : { x: 0, y: 0, width: 612, height: 792 });
    expect(saved.getPage(1).getCropBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
    for (const item of saved.getPages()) expect(item.getMediaBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
    expect(await page.evaluate(async () => Array.from((await import('/js/tool-ui.js')).documentSession.current().bytes))).toEqual(Array.from(source));
    expect(errors).toEqual([]);
  });
}

test('Crop late history presentation cannot unlock or publish over a replacement still parsing', async ({ page }, testInfo) => {
  await open(page, 'crop', await letterPdf()); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false'); await setLetterCrop(page);
  await holdSelectedCropRender(page); await page.click('#undoPageEditBtn'); await expectHeldCropControls(page);
  await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), lib = await (await import('/js/lib-loader.js')).ensurePdfLib(), original = lib.PDFDocument.load;
    lib.PDFDocument.load = async function (...args) {
      const doc = await original.apply(this, args);
      if (ui.documentSession.snapshot().current?.name === 'replacement-history.pdf') {
        lib.PDFDocument.load = original;
        await new Promise((resolve) => { window.releaseReplacementHistoryParsing = resolve; });
      }
      return doc;
    };
  });
  const replacement = await letterPdf(['REPLACEMENT_HISTORY']);
  // The retained intake remains the deliberate source/task replacement path.
  await page.setInputFiles('#fileInput', { name: 'replacement-history.pdf', mimeType: 'application/pdf', buffer: Buffer.from(replacement) });
  await expect.poll(() => page.evaluate(() => typeof window.releaseReplacementHistoryParsing)).toBe('function');
  const current = await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot());
  expect(current.current.name).toBe('replacement-history.pdf');
  await page.evaluate(() => window.cropHistoryRender.release());
  await expect.poll(() => page.evaluate(() => window.cropHistoryRender.settled)).toBe(true);
  await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'true'); await expect(page.locator('#applyBtn')).toBeDisabled(); await expect(page.locator('#cropLeft')).toBeDisabled();
  await expect(page.locator('#documentResult')).toHaveCount(0);
  expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot())).toEqual(current);
  await page.evaluate(() => window.releaseReplacementHistoryParsing()); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  const savedBytes = await result(page, testInfo, 'crop-replacement-after-stale-history.pdf'), saved = await pdfLib.PDFDocument.load(savedBytes);
  expect(saved.getPageCount()).toBe(1); expect(saved.getPage(0).getCropBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
  expect((await textPages(page, savedBytes)).join(' ')).toContain('REPLACEMENT_HISTORY');
});

test('Crop failed chosen-plan presentation retries that plan and allows explicit discard or replacement', async ({ page }, testInfo) => {
  await open(page, 'crop', await letterPdf()); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false'); await setLetterCrop(page);
  await page.click('#undoPageEditBtn'); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  await holdSelectedCropRender(page, { fail: true }); await page.click('#redoPageEditBtn'); await expectHeldCropControls(page); await page.evaluate(() => window.cropHistoryRender.release());
  await expect(page.locator('#retryPageWorkspaceBtn')).toBeVisible(); await expect(page.locator('#applyBtn')).toBeDisabled(); await expect(page.locator('#replacePageInputBtn')).toBeEnabled(); await expect(page.locator('#discardPageEditsBtn')).toBeEnabled();
  await page.click('#retryPageWorkspaceBtn'); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#pageTaskStatus')).toContainText('1 cropped'); await expect(page.locator('#cropLeft')).toHaveValue('20.00');
  const retried = await pdfLib.PDFDocument.load(await result(page, testInfo, 'crop-retried-chosen-plan.pdf'));
  expect(retried.getPage(0).getCropBox()).toEqual({ x: 20, y: 0, width: 592, height: 782 });
  await page.click('#undoPageEditBtn'); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  await holdSelectedCropRender(page, { fail: true }); await page.click('#redoPageEditBtn'); await expectHeldCropControls(page); await page.evaluate(() => window.cropHistoryRender.release());
  await expect(page.locator('#retryPageWorkspaceBtn')).toBeVisible(); await page.click('#discardPageEditsBtn'); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#pageTaskStatus')).toContainText('0 cropped'); await expect(page.locator('#cropLeft')).toHaveValue('0.00');
  await setLetterCrop(page); await page.click('#undoPageEditBtn'); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  await holdSelectedCropRender(page, { fail: true }); await page.click('#redoPageEditBtn'); await expectHeldCropControls(page); await page.evaluate(() => window.cropHistoryRender.release());
  await expect(page.locator('#retryPageWorkspaceBtn')).toBeVisible();
  const chosen = page.waitForEvent('filechooser'); await page.click('#replacePageInputBtn');
  await (await chosen).setFiles({ name: 'recovered-replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await letterPdf(['RECOVERED_REPLACEMENT'])) });
  await expect(page.locator('#pageTaskIdentity')).toContainText('recovered-replacement.pdf'); await expect(page.locator('#pageTask')).toHaveAttribute('aria-busy', 'false');
  const replaced = await pdfLib.PDFDocument.load(await result(page, testInfo, 'crop-failed-plan-replacement.pdf'));
  expect(replaced.getPageCount()).toBe(1); expect(replaced.getPage(0).getCropBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
});
