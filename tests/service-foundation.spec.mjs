import { test, expect } from '@playwright/test';
import { PDFDocument, degrees } from 'pdf-lib';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createArtifact, createDocumentSession, acceptsArtifact, MAX_HISTORY_ENTRIES } from '../public/js/core/document-session.js';
import { createOperationScope } from '../public/js/core/operation-scope.js';

const fixtures = path.resolve(import.meta.dirname, '../test-fixtures/generated');
async function open(page, route) { await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected')); await page.goto(`/${route}`); }
async function currentText(page, bytes) {
  return page.evaluate(async (provided) => {
    const { documentSession } = await import('/js/tool-ui.js'); const { ensurePdfJs, PDFJS_ASSET_URLS } = await import('/js/lib-loader.js');
    const artifact = documentSession.snapshot({ includeBytes: true }).current;
    const pdfjs = await ensurePdfJs(); const task = pdfjs.getDocument({ data: provided ? new Uint8Array(provided) : artifact.bytes, ...PDFJS_ASSET_URLS });
    const doc = await task.promise, pages = [];
    try { for (let n = 1; n <= doc.numPages; n++) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((item) => item.str).join(' ')); }
    finally { await task.destroy(); }
    return pages.join('\n');
  }, bytes ? Array.from(bytes) : null);
}
async function applyText(page, text, x = 120, y = 120) { const revision = await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().revision); await page.click('#newObjectBtn'); await page.fill('#textInput', text); await page.locator('#placementCanvas').click({ position: { x, y } }); await page.click('#applyBtn'); await expect.poll(() => page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().revision)).toBeGreaterThan(revision); await expect(page.locator('#applyBtn')).toBeEnabled(); await expect(page.locator('#downloadResultBtn')).toBeVisible(); await expect(page.locator('#documentResultStatus')).toContainText('actual file'); }

test('document sessions are typed, bounded, immutable, secret-free and idempotent', () => {
  const session = createDocumentSession(); const input = new Uint8Array([1, 2, 3]);
  session.begin(input, 'original.pdf', { password: 'never-save', capabilities: { encrypted: false, password: 'never-save' } }); input[0] = 9;
  expect(session.snapshot({ includeBytes: true }).original.bytes[0]).toBe(1);
  for (let n = 1; n <= 12; n++) session.adopt(new Uint8Array([n, n]), `revision-${n}.pdf`);
  const revision = session.snapshot().revision; session.adopt(new Uint8Array([12, 12]), 'same.pdf');
  expect(session.snapshot().revision).toBe(revision); expect(session.transfer().history).toHaveLength(MAX_HISTORY_ENTRIES);
  const metadata = session.snapshot(); expect(metadata.original.bytes).toBeUndefined(); expect(JSON.stringify(session.transfer())).not.toContain('never-save');
  const taskId = metadata.taskId; const inherited = session.transfer(); const resumed = createDocumentSession(); resumed.begin(inherited.current.bytes, inherited.current.name, inherited);
  expect(resumed.snapshot().taskId).toBe(taskId); expect(resumed.undo()).toBeTruthy(); expect(resumed.redo()).toBeTruthy();
  expect(acceptsArtifact('unknown-tool', createArtifact(new Uint8Array([1]), 'x.pdf'))).toBe(false);
  expect(acceptsArtifact('compress', createArtifact(new Uint8Array([1]), 'x.pdf', { capabilities: { searchable: true } }))).toBe(false);
  expect(acceptsArtifact('add-text', createArtifact(new Uint8Array([1]), 'x.pdf', { capabilities: { encrypted: true } }))).toBe(false);
  expect(acceptsArtifact('unlock', createArtifact(new Uint8Array([1]), 'x.pdf', { capabilities: { encrypted: true } }))).toBe(true);
  const identity = createDocumentSession(); identity.begin(new Uint8Array([1, 2]), 'original.pdf'); identity.adopt(new Uint8Array([1, 2]), 'renamed.pdf'); expect(identity.snapshot().original.name).toBe('original.pdf'); expect(identity.snapshot().current.name).toBe('renamed.pdf');
  expect(createArtifact(new Uint8Array([1]), 'misleading.txt', { type: 'application/pdf' }).type).toBe('application/pdf');
  expect(JSON.stringify(createArtifact(new Uint8Array([1]), 'safe.pdf', { type: { password: 'never-save' } }))).not.toContain('never-save');
  identity.clear(); expect(identity.snapshot().taskId).toBeNull(); expect(identity.snapshot().current).toBeNull();
});

test('operation ownership cancels stale publishers and recovers', () => {
  const scope = createOperationScope(), first = scope.begin(), second = scope.begin();
  expect(first.signal.aborted).toBe(true); expect(first.isCurrent()).toBe(false); expect(() => first.assertCurrent()).toThrow();
  second.assertCurrent(); scope.cancel(); expect(second.isCurrent()).toBe(false); scope.begin().assertCurrent();
});

test('Add Text preserves Unicode and successive edits before an explicit idempotent download', async ({ page }) => {
  await open(page, 'add-text'); let downloads = 0; page.on('download', () => downloads++);
  await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#pageGrid .page-tile')).toHaveCount(3);
  await page.locator('#pageGrid .page-tile').first().click();
  await page.fill('#textInput', 'İstanbul ığüşöç'); await page.locator('#placementCanvas').click({ position: { x: 100, y: 150 } });
  await expect(page.locator('#objectList option')).toHaveText(/İstanbul ığüşöç/);
  await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  expect(downloads).toBe(0); expect(await currentText(page)).toContain('İstanbul ığüşöç');
  await applyText(page, 'Second edit', 100, 220); const text = await currentText(page);
  expect(text).toContain('İstanbul ığüşöç'); expect(text).toContain('Second edit'); expect(downloads).toBe(0);
  await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  const unchanged = await currentText(page); expect(unchanged.match(/Second edit/g)).toHaveLength(1);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]);
  const downloaded = await readFile(await download.path()); expect((await PDFDocument.load(downloaded)).getPageCount()).toBe(3);
  const savedText = await currentText(page, downloaded); expect(savedText).toContain('İstanbul ığüşöç'); expect(savedText.match(/Second edit/g)).toHaveLength(1);
});

test('Add Text placement matches all four rotated cropped page viewports', async ({ page }) => {
  const source = await PDFDocument.create(); for (const rotation of [0, 90, 180, 270]) { const p = source.addPage([500, 600]); p.setCropBox(40, 60, 400, 480); p.setRotation(degrees(rotation)); }
  await open(page, 'add-text'); await page.setInputFiles('#fileInput', { name: 'rotated.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) });
  await expect(page.locator('#pageGrid .page-tile')).toHaveCount(4);
  for (let index = 0; index < 4; index++) { await page.locator('#pageGrid .page-tile').nth(index).click(); await applyText(page, `MARK${index}`, 120, 150); }
  const placements = await page.evaluate(async () => {
    const { documentSession } = await import('/js/tool-ui.js'); const { ensurePdfJs, PDFJS_ASSET_URLS } = await import('/js/lib-loader.js');
    const task = (await ensurePdfJs()).getDocument({ data: documentSession.snapshot({ includeBytes: true }).current.bytes, ...PDFJS_ASSET_URLS }); const doc = await task.promise; const values = [];
    try { for (let n = 1; n <= 4; n++) { const p = await doc.getPage(n), viewport = p.getViewport({ scale: 1 }); const item = (await p.getTextContent()).items.find((item) => item.str === `MARK${n - 1}`); const point = viewport.convertToViewportPoint(item.transform[4], item.transform[5]); values.push({ point, width: viewport.width }); } } finally { await task.destroy(); } return values;
  });
  for (const value of placements) { const scale = Math.min(560 / value.width, 1.8); expect(value.point[0] * scale).toBeCloseTo(120, 0); expect(value.point[1] * scale).toBeCloseTo(150, 0); }
});

test('explicit editor handoff keeps one bounded task and never restores into an unrelated tab', async ({ page, context }) => {
  await open(page, 'add-text'); await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#pageGrid .page-tile')).toHaveCount(3); await page.locator('#pageGrid .page-tile').first().click();
  await applyText(page, 'Carried edit');
  await page.locator('#chainRow button', { hasText: 'Add Image' }).click(); await expect(page).toHaveURL(/add-image\?workflow=.*&file=/); await expect(page.locator('#optionsSection')).toBeVisible();
  const firstId = new URL(page.url()).searchParams.get('workflow');
  const fresh = await context.newPage(); await fresh.goto('/add-image'); await expect(fresh.locator('#optionsSection')).toBeHidden(); await fresh.close();
  await page.setInputFiles('#imageInput', path.join(fixtures, 'photo.png')); await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  expect(await currentText(page)).toContain('Carried edit');
  await page.locator('#chainRow button', { hasText: 'Fill & Sign' }).click(); await expect(page.locator('#signatureSection')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('workflow')).toBe(firstId);
  const retained = await page.evaluate(async () => { const { createWorkflowStore } = await import('/js/core/workflow-store.js'); const id = new URLSearchParams(location.search).get('workflow'); const workflow = await createWorkflowStore().getWorkflow(id); return { files: workflow.fileRefs.length, history: (workflow.historyCheckpoints || workflow.historyRefs).length }; });
  expect(retained.files).toBeLessThanOrEqual(12); expect(retained.history).toBeGreaterThan(0);
});

test('Fill & Sign Unicode values are transactional and repeated Apply never duplicates signatures', async ({ page }) => {
  await open(page, 'fill-sign'); await page.setInputFiles('#fileInput', path.join(fixtures, 'form.pdf')); await expect(page.locator('#fieldsSection')).toBeVisible();
  await page.locator('#fieldsList .field-row').filter({ hasText: 'full_name' }).locator('input').fill('İpek Şahin');
  await page.click('#sigModeType'); await page.fill('#typeSigInput', 'İpek'); await expect(page.locator('#signaturePreview')).toBeVisible(); await page.locator('#sigPageGrid .page-tile').first().click(); await page.locator('#placementCanvas').click({ position: { x: 220, y: 350 } });
  await expect(page.locator('#objectList option')).toHaveText(/signature/); await expect.poll(() => page.locator('#signaturePreview').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  expect(await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'), lib = await (await import('/js/lib-loader.js')).ensurePdfLib(); const doc = await lib.PDFDocument.load(ui.documentSession.snapshot({ includeBytes: true }).current.bytes); return doc.getForm().getTextField('full_name').getText(); })).toBe('İpek Şahin');
  const before = await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().revision);
  await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().revision)).toBe(before);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]);
  const downloaded = await readFile(await download.path()); const saved = await PDFDocument.load(downloaded);
  expect(saved.getForm().getTextField('full_name').getText()).toBe('İpek Şahin');
  expect(saved.getPage(0).node.Resources().lookupMaybe((await import('pdf-lib')).PDFName.of('XObject'), (await import('pdf-lib')).PDFDict)?.keys()).toHaveLength(1);
});

test('form and flatten failures preserve chosen bytes and draft revision and visibly block success', async ({ page }) => {
  await open(page, 'fill-sign'); await page.setInputFiles('#fileInput', path.join(fixtures, 'form.pdf')); await expect(page.locator('#fieldsSection')).toBeVisible();
  const canvas = page.locator('#placementCanvas'), apply = page.locator('#applyBtn');
  const revision = () => page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().revision);
  const readyScene = async (expectedRevision) => {
    await expect(canvas).toHaveAttribute('data-scene-revision', String(expectedRevision));
    await expect(canvas).toHaveAttribute('aria-busy', 'false');
    await expect(canvas).toHaveAttribute('data-pdf-page', '1');
  };
  await readyScene(await revision());
  const input = page.locator('#fieldsList .field-row').filter({ hasText: 'full_name' }).locator('input');
  const chosen = await page.evaluate(async () => [...(await import('/js/tool-ui.js')).documentSession.snapshot({includeBytes:true}).current.bytes]);
  await input.fill('FAIL FIELD'); const fieldRevision = await revision();
  // Preview and Apply share the same PDF builder. Prepare this native draft
  // successfully before injecting a fault into the explicit Apply transaction.
  await readyScene(fieldRevision); await expect(apply).toBeEnabled();
  await page.evaluate(async () => { const lib = await (await import('/js/lib-loader.js')).ensurePdfLib(); window.originalSetText = lib.PDFTextField.prototype.setText; lib.PDFTextField.prototype.setText = function (value) { if (value === 'FAIL FIELD') throw new Error('injected field failure'); return window.originalSetText.call(this, value); }; });
  await apply.click();
  await expect(page.locator('.field-error').first()).toContainText('injected field failure'); await expect(page.locator('#errorSection')).toBeVisible(); await expect(page.locator('#documentResult')).toHaveCount(0);
  await expect(apply).toBeEnabled();
  expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().revision)).toBe(fieldRevision); expect(await page.evaluate(async () => [...(await import('/js/tool-ui.js')).documentSession.snapshot({includeBytes:true}).current.bytes])).toEqual(chosen);
  await page.evaluate(async () => { const lib = await (await import('/js/lib-loader.js')).ensurePdfLib(); lib.PDFTextField.prototype.setText = window.originalSetText; });
  await input.fill('İpek'); await page.check('#flattenInput'); const flattenRevision = await revision();
  await readyScene(flattenRevision); await expect(apply).toBeEnabled();
  await page.evaluate(async () => { const lib = await (await import('/js/lib-loader.js')).ensurePdfLib(); window.originalFlatten = lib.PDFForm.prototype.flatten; lib.PDFForm.prototype.flatten = () => { throw new Error('injected flatten failure'); }; });
  await apply.click(); await expect(page.locator('#errorText')).toContainText('could not be flattened');
  await expect(page.locator('#documentResult')).toHaveCount(0); await expect(apply).toBeEnabled();
  expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().revision)).toBe(flattenRevision); expect(await page.evaluate(async () => [...(await import('/js/tool-ui.js')).documentSession.snapshot({includeBytes:true}).current.bytes])).toEqual(chosen);
  await page.evaluate(async () => { const lib = await (await import('/js/lib-loader.js')).ensurePdfLib(); lib.PDFForm.prototype.flatten = window.originalFlatten; lib.PDFTextField.prototype.setText = window.originalSetText; });
  await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file'); expect(await currentText(page)).toContain('İpek'); expect(await currentText(page)).not.toContain('FAIL FIELD');
});

test('typed multi-results and cancelled publication use actual content and recover preview toggles', async ({ page }) => {
  await open(page, 'view-pdf');
  const outcome = await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'); const op = ui.documentOperations.begin(); ui.documentOperations.cancel();
    await ui.reviewResult(new TextEncoder().encode('stale'), 'stale.txt', { operation: op });
    const stale = Boolean(document.getElementById('documentResult'));
    await ui.reviewResults([{ bytes: new TextEncoder().encode('# Actual Markdown'), name: 'result.md' }, { bytes: new TextEncoder().encode('Actual text'), name: 'result.txt' }]); return stale;
  });
  expect(outcome).toBe(false); await expect(page.locator('#documentResult textarea')).toHaveValue('# Actual Markdown');
  await page.locator('#documentResultGroup button', { hasText: 'result.txt' }).click(); await expect(page.locator('#documentResult textarea')).toHaveValue('Actual text');
  await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'); ui.documentOperations.begin(); });
  await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden();
  await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#viewerSection')).toBeVisible();
  await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'); const current = ui.documentSession.snapshot({ includeBytes: true }).current; await ui.reviewResult(current.bytes, 'review.pdf'); });
  await page.getByRole('button', { name: 'Show original', exact: true }).click(); await page.getByRole('button', { name: 'Show result', exact: true }).click(); await page.getByRole('button', { name: 'Show original', exact: true }).click(); await page.getByRole('button', { name: 'Show result', exact: true }).click();
  await expect(page.locator('#documentResultStatus')).toContainText('Result: review.pdf'); await expect.poll(() => page.locator('#documentResultPreview canvas').evaluate((canvas) => canvas.width)).toBeGreaterThan(0);
});

test('Add Image previews selected page 2 and saves exactly the reviewed selected-page stamp', async ({ page }, testInfo) => {
  await open(page, 'add-image'); await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#optionsSection')).toBeVisible();
  await page.selectOption('#pageSelect', '2'); await expect(page.locator('#previewCanvas')).toHaveAttribute('data-pdf-page', '2');
  await page.setInputFiles('#imageInput', path.join(fixtures, 'photo.png')); await expect(page.locator('#objectList option')).toHaveCount(1);
  await expect.poll(() => page.evaluate(async () => { const ui=await import('/js/tool-ui.js'),canvas=document.querySelector('#previewCanvas'); return canvas.getAttribute('aria-busy')==='false' && Number(canvas.dataset.sceneRevision)===ui.documentSession.snapshot().revision; })).toBe(true);
  const before = await page.evaluate(async () => { const ui=await import('/js/tool-ui.js'), input=await ui.getWorkspaceInput(),canvas=document.querySelector('#previewCanvas'); return { url:canvas.toDataURL(),scale:Number(canvas.dataset.pdfScale),bytes:[...input.bytes],smoothing:getComputedStyle(canvas).webkitFontSmoothing,context:canvas.getContext('2d').getContextAttributes() }; });
  await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  const comparison = await page.evaluate(async (before) => {
    const ui=await import('/js/tool-ui.js'),runtime=await import('/js/lib-loader.js'),pdfjs=await runtime.ensurePdfJs(),bytes=ui.documentSession.current().bytes;
    const image = new Image(); image.src=before.url; await image.decode(); const preview=document.createElement('canvas');preview.width=image.width;preview.height=image.height;preview.getContext('2d').drawImage(image,0,0);
    const metrics = (a,b) => { const x=a.getContext('2d').getImageData(0,0,a.width,a.height).data,y=b.getContext('2d').getImageData(0,0,b.width,b.height).data;let maxTextDifference=0,stampDifferences=0,totalDifference=0;for(let row=0;row<a.height;row++)for(let column=0;column<a.width;column++)for(let channel=0;channel<3;channel++){const i=(row*a.width+column)*4+channel,difference=Math.abs(x[i]-y[i]);totalDifference+=difference;if(row>a.height*.35)stampDifferences+=difference;else maxTextDifference=Math.max(maxTextDifference,difference);}return{stampDifferences,maxTextDifference,meanDifference:totalDifference/(a.width*a.height*3)}; };
    const task=pdfjs.getDocument({data:bytes.slice(),...runtime.PDFJS_ASSET_URLS}),canvas=document.createElement('canvas');
    // Canvas text rasterization inherits the body's font smoothing. Match the
    // actual preview's DOM environment instead of comparing a detached canvas.
    canvas.style.position='fixed';canvas.style.left='-2000px';document.body.append(canvas);
    try { const doc=await task.promise,p=await doc.getPage(2),viewport=p.getViewport({scale:before.scale});canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));await p.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      return {full:metrics(preview,canvas),smoothing:getComputedStyle(canvas).webkitFontSmoothing,previewSmoothing:before.smoothing,context:canvas.getContext('2d').getContextAttributes(),previewContext:before.context,viewport:{scale:viewport.scale,transform:viewport.transform,width:viewport.width,height:viewport.height,rotation:viewport.rotation,userUnit:p.userUnit},sameSceneBytes:bytes.length===before.bytes.length&&bytes.every((byte,index)=>byte===before.bytes[index]),text:(await p.getTextContent()).items.map((item)=>item.str).join(' '),width:preview.width,height:preview.height};
    } finally { await task.destroy();canvas.remove();canvas.width=canvas.height=0; }
  },before);
  await testInfo.attach('preview-render-diagnostics',{body:JSON.stringify(comparison,null,2),contentType:'application/json'});
  expect(comparison.sameSceneBytes).toBe(true); expect(comparison.smoothing).toBe(comparison.previewSmoothing);
  expect(comparison.full.stampDifferences).toBe(0); expect(comparison.full.maxTextDifference).toBeLessThanOrEqual(40); expect(comparison.full.meanDifference).toBeLessThan(.15); expect(comparison.text).toContain('Regional Breakdown');
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#downloadResultBtn')]); const saved=await PDFDocument.load(await readFile(await download.path()));expect(saved.getPageCount()).toBe(3);expect(saved.getPage(1).node.Resources().lookupMaybe((await import('pdf-lib')).PDFName.of('XObject'),(await import('pdf-lib')).PDFDict)?.keys()).toHaveLength(1);
});

test('unsupported preview and export text fail visibly and supported text recovers', async ({ page }) => {
  await open(page, 'add-text'); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#pageGrid .page-tile')).toHaveCount(3); await page.locator('#pageGrid .page-tile').first().click();
  await page.fill('#textInput', '漢字'); await page.locator('#placementCanvas').click({ position: { x: 100, y: 100 } }); await expect(page.locator('#errorText')).toContainText('does not support');
  await expect(page.locator('#applyBtn')).toBeDisabled(); await expect(page.locator('#errorText')).toContainText('does not support'); await expect(page.locator('#documentResult')).toHaveCount(0);
  expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().revision)).toBe(0);
  await applyText(page, 'Türkçe'); expect(await currentText(page)).toContain('Türkçe'); await page.locator('#objectList').selectOption({index:0}); await page.fill('#textInput','東京'); await expect(page.locator('#errorText')).toContainText('Previous text was retained'); await expect(page.locator('#textInput')).toHaveValue('Türkçe'); const revisionBeforeLimit=await page.evaluate(async()=>(await import('/js/tool-ui.js')).documentSession.snapshot().revision); await page.fill('#textInput','A'.repeat(10001)); await expect(page.locator('#errorText')).toContainText('Invalid object text'); await expect(page.locator('#textInput')).toHaveValue('Türkçe'); expect(await page.evaluate(async()=>(await import('/js/tool-ui.js')).documentSession.snapshot().revision)).toBe(revisionBeforeLimit); await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file'); const [checked] = await Promise.all([page.waitForEvent('download'),page.click('#downloadResultBtn')]); const checkedText=await currentText(page,await readFile(await checked.path())); expect(checkedText).toContain('Türkçe'); expect(checkedText).not.toContain('東京'); expect(errors).toEqual([]);
});

test('oversized and unreadable inputs fail visibly before reads and keep the current task', async ({ page }) => {
  await open(page, 'view-pdf');
  const result = await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'); await ui.documentSession.begin(new Uint8Array([1]), 'kept.pdf'); let read = false; const oversized = await ui.readPdfFile({ name: 'huge.pdf', type: 'application/pdf', size: 251 * 1024 * 1024, arrayBuffer: async () => { read = true; throw new Error('must not read'); } }); const kept = ui.documentSession.snapshot().current.name; const unreadable = await ui.readPdfFile({ name: 'broken.pdf', type: 'application/pdf', size: 1, arrayBuffer: async () => { throw new Error('disk unavailable'); } }); return { read, oversized, unreadable, kept }; });
  expect(result).toEqual({ read: false, oversized: null, unreadable: null, kept: 'kept.pdf' }); await expect(page.locator('#errorText')).toContainText('disk unavailable');
});

test('rejected replacement preserves the visible editor and its unapplied text', async ({ page }) => {
  await open(page, 'add-text'); await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#pageGrid .page-tile')).toHaveCount(3); await page.locator('#pageGrid .page-tile').first().click(); await page.fill('#textInput', 'Keep this draft'); await page.locator('#placementCanvas').click({ position: { x: 100, y: 100 } });
  await page.evaluate(() => { const input = document.getElementById('fileInput'); Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'huge.pdf', type: 'application/pdf', size: 251 * 1024 * 1024, arrayBuffer: async () => { throw new Error('must not read'); } }] }); input.dispatchEvent(new Event('change')); });
  await expect(page.locator('#errorText')).toContainText('80 MB'); await expect(page.locator('#textOptionsSection')).toBeVisible(); await expect(page.locator('#textInput')).toHaveValue('Keep this draft'); await expect(page.locator('#objectList option')).toHaveText(/Keep this draft/); await expect(page.locator('#applyBtn')).toBeEnabled();
});

test('transient result module failure retries through a fresh module URL without page errors', async ({ page }) => {
  let imports = 0; await page.route('**/js/document-result.js*', (route) => ++imports === 1 ? route.abort('failed') : route.continue());
  await open(page, 'view-pdf'); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const first = await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'); try { await ui.reviewResult(new TextEncoder().encode('first'), 'first.txt'); return false; } catch { ui.clearResult(); return true; } });
  expect(first).toBe(true);
  await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'); await ui.reviewResult(new TextEncoder().encode('recovered result'), 'recovered.txt'); });
  await expect(page.locator('#documentResult textarea')).toHaveValue('recovered result'); expect(imports).toBe(2); expect(errors).toEqual([]);
});

test('transient session module failure leaves intake retryable', async ({ page }) => {
  let imports = 0; await page.route('**/js/core/document-session.js*', (route) => ++imports === 1 ? route.abort('failed') : route.continue());
  await open(page, 'view-pdf'); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#errorSection')).toBeVisible();
  await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#viewerSection')).toBeVisible(); expect(imports).toBe(2); expect(errors).toEqual([]);
});

test('malformed replacement preserves chosen bytes and pending objects without reviving a stale result', async ({ page }) => {
  await open(page, 'add-text'); await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#pageGrid .page-tile')).toHaveCount(3); await page.locator('#pageGrid .page-tile').first().click(); await applyText(page, 'Saved first edit');
  await page.fill('#textInput', 'Pending second edit'); await page.locator('#placementCanvas').click({ position: { x: 100, y: 220 } }); await expect(page.locator('#objectList option')).toContainText(['Saved first edit', 'Pending second edit']);
  const before = await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot());
  await page.setInputFiles('#fileInput', { name: 'malformed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nThis header is valid but the PDF structure is not.') });
  await expect(page.locator('#errorText')).toContainText('Could not open this PDF'); await expect(page.locator('#textInput')).toHaveValue('Pending second edit'); await expect(page.locator('#objectList option')).toContainText(['Saved first edit', 'Pending second edit']); await expect(page.locator('#documentResult')).toBeHidden();
  const after = await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot()); expect(after.taskId).toBe(before.taskId); expect(after.revision).toBe(before.revision); expect(after.current).toEqual(before.current); await expect(page.locator('#applyBtn')).toBeEnabled(); await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file'); const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); const text = await currentText(page, await readFile(await saved.path())); expect(text).toContain('Saved first edit'); expect(text.match(/Pending second edit/g)).toHaveLength(1);
});

test('Protect to Unlock transitions from encrypted output to editable reviewed output', async ({ page }) => {
  await open(page, 'protect'); await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#optionsSection')).toBeVisible();
  await page.fill('#passwordInput', 'only-live-memory'); await page.fill('#confirmInput', 'only-live-memory'); await page.click('#protectBtn'); await expect(page.locator('#chainRow button')).toHaveCount(1); await expect(page.locator('#documentResultStatus')).toContainText('Password-protected result');
  await page.locator('#chainRow button', { hasText: 'Unlock' }).click(); await expect(page.locator('#passwordSection')).toBeVisible();
  expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().current.capabilities.encrypted)).toBe(true);
  await page.fill('#passwordInput', 'only-live-memory'); await page.click('#unlockBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file'); await expect(page.locator('#chainRow button', { hasText: 'Add Text' })).toBeVisible();
  await page.locator('#chainRow button', { hasText: 'Add Text' }).click(); await expect(page.locator('#textOptionsSection')).toBeVisible();
  expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().current.capabilities.encrypted)).toBe(false);
  const records = await page.evaluate(async () => { const { createWorkflowStore } = await import('/js/core/workflow-store.js'); const id = new URLSearchParams(location.search).get('workflow'); return JSON.stringify(await createWorkflowStore().getWorkflow(id)); }); expect(records).not.toContain('only-live-memory');
});

test('cancelled multi-result lazy publication cannot recreate cleared groups or results', async ({ page }) => {
  let release, entered = false; const hold = new Promise((resolve) => { release = resolve; });
  await page.route('**/js/document-result.js', async (route) => { entered = true; await hold; await route.continue(); });
  await open(page, 'view-pdf'); await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'); window.pendingGroup = ui.reviewResults([{ bytes: new TextEncoder().encode('stale group'), name: 'stale.txt' }]); });
  await expect.poll(() => entered).toBe(true); await page.evaluate(async () => (await import('/js/tool-ui.js')).clearResult()); release(); await page.evaluate(() => window.pendingGroup);
  await expect(page.locator('#documentResultGroup')).toHaveCount(0); await expect(page.locator('#documentResult')).toHaveCount(0);
});

test('Add Text Undo and Redo publish and download the actual current revision', async ({ page }) => {
  await open(page, 'add-text'); await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#pageGrid .page-tile')).toHaveCount(3); await page.locator('#pageGrid .page-tile').first().click(); await applyText(page, 'UNDO_STAMP');
  await page.click('#undoEditBtn'); await expect(page.locator('#documentResultStatus')).toContainText('Result: report.pdf'); await expect(page.locator('#documentIdentity')).toContainText('Revision 2');
  const [undone] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); expect(await currentText(page, await readFile(await undone.path()))).not.toContain('UNDO_STAMP');
  await page.click('#redoEditBtn'); await expect(page.locator('#documentResultStatus')).toContainText('Result: report-text.pdf');
  const [redone] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); expect(await currentText(page, await readFile(await redone.path()))).toContain('UNDO_STAMP');
});

test('Fill & Sign refreshes placed ink in the actual preview and saved bitmap', async ({ page }) => {
  await open(page, 'fill-sign'); await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#signatureSection')).toBeVisible(); await page.click('#sigModeType'); await page.fill('#typeSigInput', 'ALPHA'); await expect(page.locator('#signaturePreview')).toBeVisible(); await page.locator('#sigPageGrid .page-tile').first().click(); await page.locator('#placementCanvas').click({ position: { x: 220, y: 350 } });
  const originalPreview = await page.locator('#signaturePreview').getAttribute('src'); await page.fill('#typeSigInput','東京'); await expect(page.locator('#errorText')).toContainText('Previous signature was retained'); await expect(page.locator('#typeSigInput')).toHaveValue('ALPHA'); await expect(page.locator('#signaturePreview')).toHaveAttribute('src',originalPreview);
  const before = await page.locator('#signaturePreview').getAttribute('src'); const beforePixels = await page.locator('#placementCanvas').evaluate((canvas) => canvas.toDataURL()); await page.fill('#typeSigInput', 'BETA');
  await expect.poll(() => page.locator('#signaturePreview').getAttribute('src')).not.toBe(before); await expect.poll(() => page.locator('#placementCanvas').evaluate((canvas) => canvas.toDataURL())).not.toBe(beforePixels);
  const width = await page.locator('#signaturePreview').evaluate((img) => img.naturalWidth); expect(width).toBeLessThan(420); await page.click('#applyBtn'); await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]); const lib = await import('pdf-lib'), output = await PDFDocument.load(await readFile(await saved.path())); const images = output.getPage(0).node.Resources().lookup(lib.PDFName.of('XObject'), lib.PDFDict); expect(images.keys()).toHaveLength(1); expect(output.context.lookup(images.get(images.keys()[0])).dict.get(lib.PDFName.of('Width')).asNumber()).toBe(width);
});

test('a validated PDF named as text stays typed as PDF and offers PDF actions', async ({ page }) => {
  await open(page, 'add-text'); await page.setInputFiles('#fileInput', { name: 'misleading.txt', mimeType: 'application/pdf', buffer: await readFile(path.join(fixtures, 'report.pdf')) }); await expect(page.locator('#pageGrid .page-tile')).toHaveCount(3);
  expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().current.type)).toBe('application/pdf');
  await page.locator('#pageGrid .page-tile').first().click(); await applyText(page, 'Typed PDF'); await expect(page.locator('#chainRow button', { hasText: 'Add Image' })).toBeVisible();
});

for (const clearPending of [false, true]) {
  test(`delayed sibling PDF cannot replace chosen text continuation${clearPending ? ' after Clear' : ''}`, async ({ page }) => {
    const blank = await PDFDocument.create(); blank.addPage([200, 200]); const pdf = Array.from(await blank.save());
    let release, entered = false; const hold = new Promise((resolve) => { release = resolve; });
    await page.route('**/pdfjs-dist@*/build/pdf.min.mjs', async (route) => { entered = true; await hold; await route.continue(); });
    await page.addInitScript(() => {
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (type === 'click' && this instanceof HTMLButtonElement && this.textContent === 'slow.pdf') {
          const button = this;
          return add.call(this, type, (event) => { const result = listener.call(button, event); window.slowSelection = Promise.resolve(result); return result; }, options);
        }
        return add.call(this, type, listener, options);
      };
    });
    await open(page, 'view-pdf');
    await page.evaluate(async (pdf) => {
      const ui = await import('/js/tool-ui.js');
      await ui.reviewResults([
        { bytes: new TextEncoder().encode('FIRST TEXT'), name: 'first.txt' },
        { bytes: new Uint8Array(pdf), name: 'slow.pdf', type: 'application/pdf' },
        { bytes: new TextEncoder().encode('LATEST TEXT'), name: 'latest.txt', type: 'text/plain' },
      ]);
    }, pdf);
    await page.locator('#documentResultGroup button', { hasText: 'slow.pdf' }).click(); await expect.poll(() => entered).toBe(true);
    await page.locator('#documentResultGroup button', { hasText: 'latest.txt' }).click(); await expect(page.locator('#documentResult textarea')).toHaveValue('LATEST TEXT');
    if (clearPending) await page.evaluate(async () => (await import('/js/tool-ui.js')).clearResult());
    release(); await page.evaluate(() => window.slowSelection);
    let expectedText = 'LATEST TEXT';
    if (clearPending) {
      await expect(page.locator('#documentResultGroup')).toHaveCount(0); await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden();
      expectedText = 'AFTER CLEAR TEXT';
      await page.evaluate(async () => (await import('/js/tool-ui.js')).reviewResults([{ bytes: new TextEncoder().encode('AFTER CLEAR TEXT'), name: 'latest.txt', type: 'text/plain' }]));
    }
    await expect(page.locator('#documentResult textarea')).toHaveValue(expectedText);
    await expect(page.locator('#chainRow button', { hasText: 'Add Text' })).toHaveCount(0);
    await page.locator('#chainRow').getByRole('button', { name: 'Markdown Viewer', exact: true }).click(); await expect(page).toHaveURL(/markdown-viewer\?workflow=.*&file=/);
    const stored = await page.evaluate(async () => {
      const { createWorkflowStore } = await import('/js/core/workflow-store.js'); const params = new URLSearchParams(location.search), store = createWorkflowStore();
      const workflow = await store.getWorkflow(params.get('workflow')), file = await store.getFile(params.get('file'));
      return { bytes: [...file.bytes], type: file.type, name: file.name, owned: file.workflowId === workflow.id && workflow.fileRefs.includes(file.id) };
    });
    expect(stored).toEqual({ bytes: [...new TextEncoder().encode(expectedText)], type: 'text/plain', name: 'latest.txt', owned: true });
  });
}

test('explicit result adoption updates source, current and review identity together', async ({ page }) => {
  const source = await readFile(path.join(fixtures, 'report.pdf')), candidate = await PDFDocument.load(source); candidate.setTitle('Reviewed copy'); const bytes = Array.from(await candidate.save());
  await open(page, 'view-pdf'); await page.setInputFiles('#fileInput', path.join(fixtures, 'report.pdf')); await expect(page.locator('#viewerSection')).toBeVisible();
  await page.evaluate(async (bytes) => (await import('/js/tool-ui.js')).reviewResult(new Uint8Array(bytes), 'chosen.pdf', { type: 'application/pdf' }), bytes);
  const before = await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot()); expect(before.current.name).toBe('report.pdf'); expect(before.revision).toBe(0);
  await expect(page.locator('#documentIdentity')).toContainText('Current: report.pdf'); await expect(page.locator('#documentResultIdentity')).toContainText('Revision 0');
  await page.click('#useResultBtn');
  const after = await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot({ includeBytes: true })); expect(after.original.name).toBe('report.pdf'); expect(after.current.name).toBe('chosen.pdf'); expect([...after.current.bytes]).toEqual(bytes); expect(after.revision).toBe(1);
  await expect(page.locator('#documentIdentity')).toContainText('Original: report.pdf · Current: chosen.pdf · Revision 1'); await expect(page.locator('#documentResultIdentity')).toContainText('Original: report.pdf · Result: chosen.pdf · Revision 1');
});
