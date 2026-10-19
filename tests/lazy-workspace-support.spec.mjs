import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';

async function input(name = 'lazy-owned.pdf') {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle('Lazy support source');
  for (let index = 0; index < 2; index++) {
    const page = doc.addPage([400, 500]);
    page.drawText(`LAZY SOURCE PAGE ${index + 1}`, { x: 35, y: 350, font, size: 16 });
  }
  const field = doc.getForm().createTextField('name');
  field.addToPage(doc.getPage(0), { x: 35, y: 420, width: 250, height: 25, font });
  field.setText('Original value');
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

async function open(page, mode = 'view-pdf') {
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
  await page.goto(`/${mode}`);
  const optionalRequests = await page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => new URL(entry.name).pathname)
    .filter((pathname) => /\/document-(?:workspace-support|handoff)\.js$/.test(pathname)));
  expect(optionalRequests).toEqual([]);
  await page.setInputFiles('#fileInput', await input());
  if (mode === 'view-pdf') {
    await expect(page.locator('#viewerSection')).toBeVisible();
    await expect.poll(() => page.locator('#pdfCanvas').evaluate((canvas) => canvas.width)).toBeGreaterThan(0);
  } else {
    await expect(page.locator('#placementCanvas')).toHaveAttribute('data-pdf-page', '1');
    await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy', 'false');
  }
}

test('lazy workspace import failure retries extra-source validation without replacing the owned task', async ({ page }, testInfo) => {
  let imports = 0;
  await page.route('**/js/document-workspace-support.js*', (route) => ++imports === 1 ? route.abort('failed') : route.continue());
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 'add-text');
  const result = await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), before = JSON.stringify(ui.documentSession.transfer());
    const makeFile = () => new File([ui.documentSession.current().bytes], 'additional.pdf', { type: 'application/pdf' });
    let failed = false;
    try { await ui.readExternalPdfFile(makeFile()); } catch { failed = true; }
    const retainedAfterFailure = before === JSON.stringify(ui.documentSession.transfer());
    const extra = await ui.readExternalPdfFile(makeFile());
    const bytes = Array.from(extra.bytes);
    extra.bytes.fill(0);
    const current = ui.documentSession.current();
    return { failed, retainedAfterFailure, retainedAfterSuccess: before === JSON.stringify(ui.documentSession.transfer()),
      name: extra.name, pages: extra.pageCount, magic: String.fromCharCode(...current.bytes.slice(0, 4)), bytes };
  });
  expect(result).toMatchObject({ failed: true, retainedAfterFailure: true, retainedAfterSuccess: true, name: 'additional.pdf', pages: 2, magic: '%PDF' });
  const bytes = Buffer.from(result.bytes), saved = await PDFDocument.load(bytes);
  await writeFile(testInfo.outputPath('retried-external-source.pdf'), bytes);
  expect(saved.getPageCount()).toBe(2);
  expect(saved.getTitle()).toBe('Lazy support source');
  expect(saved.getForm().getTextField('name').getText()).toBe('Original value');
  expect(imports).toBe(2); expect(errors).toEqual([]);
});

test('held lazy workspace import respects cancellation and preserves a newer review before a real scene bake recovers', async ({ page }, testInfo) => {
  let entered = false, release;
  const hold = new Promise((resolve) => { release = resolve; });
  await page.route('**/js/document-workspace-support.js*', async (route) => { entered = true; await hold; await route.continue(); });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  try {
    await open(page, 'add-text');
    await page.fill('#textInput', 'RECOVERED SCENE TEXT');
    await expect(page.locator('#placeDraftBtn')).toBeEnabled();
    await page.click('#placeDraftBtn');
    await expect(page.locator('#objectList option')).toHaveCount(1);
    await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(async () => {
      const ui = await import('/js/tool-ui.js');
      window.beforeHeldWorkspace = JSON.stringify(ui.documentSession.transfer());
      const operation = ui.documentOperations.begin();
      window.heldWorkspaceRead = ui.getWorkspaceInput({ operation }).then(
        (value) => ({ returned: value === null ? 'null' : 'bytes' }),
        (error) => ({ error: error.name }),
      );
    });
    await expect.poll(() => entered).toBe(true);
    await page.evaluate(async () => {
      const ui = await import('/js/tool-ui.js'); ui.documentOperations.cancel();
      await ui.reviewResult(new TextEncoder().encode('LATEST OWNED REVIEW'), 'latest.txt');
    });
    await expect(page.locator('#documentResult textarea')).toHaveValue('LATEST OWNED REVIEW');
    release();
    expect(await page.evaluate(() => window.heldWorkspaceRead)).toEqual({ error: 'AbortError' });
    await expect(page.locator('#documentResult textarea')).toHaveValue('LATEST OWNED REVIEW');
    const recovered = await page.evaluate(async () => {
      const ui = await import('/js/tool-ui.js'), retained = window.beforeHeldWorkspace === JSON.stringify(ui.documentSession.transfer());
      const input = await ui.getWorkspaceInput();
      const runtime = await import('/js/lib-loader.js'), task = (await runtime.ensurePdfJs()).getDocument({ data: input.bytes.slice(), ...runtime.PDFJS_ASSET_URLS });
      try {
        const doc = await task.promise, text = [];
        for (let index = 1; index <= doc.numPages; index++) text.push((await (await doc.getPage(index)).getTextContent()).items.map((item) => item.str).join(' '));
        return { retained, text: text.join('\n'), bytes: Array.from(input.bytes), losses: input.losses };
      } finally { await task.destroy(); }
    });
    expect(recovered.retained).toBe(true);
    expect(recovered.text).toContain('LAZY SOURCE PAGE 1');
    expect(recovered.text).toContain('LAZY SOURCE PAGE 2');
    expect(recovered.text.match(/RECOVERED SCENE TEXT/g)).toHaveLength(1);
    expect(recovered.losses).toEqual(['scene-baked']);
    const bytes = Buffer.from(recovered.bytes), saved = await PDFDocument.load(bytes);
    await writeFile(testInfo.outputPath('recovered-baked-scene.pdf'), bytes);
    expect(saved.getPageCount()).toBe(2);
    expect(saved.getForm().getTextField('name').getText()).toBe('Original value');
    expect(errors).toEqual([]);
  } finally { release(); }
});

test('owned handoff import failures retry both persistence and restoration with editable history intact', async ({ page }, testInfo) => {
  let imports = 0;
  await page.route('**/js/document-handoff.js*', (route) => [1, 3].includes(++imports) ? route.abort('failed') : route.continue());
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  const prepared = await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), scene = ui.documentSession.beginScene();
    scene.fields.name = { kind: 'text', value: 'Transferred draft value' };
    ui.documentSession.changeScene(scene); ui.documentSession.setSelection([1]);
    const current = ui.documentSession.current();
    ui.documentSession.publishScene(current.bytes, current.name, { capabilities: { searchable: true, forms: true } });
    const before = JSON.stringify(ui.documentSession.transfer());
    let failed = false;
    try { await ui.stashForChain(current.bytes, current.name, 'view-pdf'); } catch { failed = true; }
    const retained = before === JSON.stringify(ui.documentSession.transfer());
    const handoff = await ui.stashForChain(current.bytes, current.name, 'view-pdf');
    return { failed, retained, handoff, taskId: ui.documentSession.snapshot().taskId, sourceRef: ui.documentSession.scene().sourceRef };
  });
  expect(prepared.failed).toBe(true); expect(prepared.retained).toBe(true); expect(imports).toBe(2);
  await page.goto(`/view-pdf?workflow=${encodeURIComponent(prepared.handoff.workflowId)}&file=${encodeURIComponent(prepared.handoff.fileId)}`);
  await expect.poll(() => imports).toBe(3);
  await expect(page.locator('#viewerSection')).toBeHidden();
  const restored = await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), file = await ui.takeChainedFile();
    if (!file) throw new Error('The owned handoff did not recover.');
    const parsed = await ui.readPdfFile(file, { validate: true });
    if (!parsed) throw new Error('The restored PDF did not validate.');
    const state = ui.documentSession.snapshot(), scene = ui.documentSession.scene(), input = await ui.getWorkspaceInput();
    return { taskId: state.taskId, name: state.current.name, originalName: state.original.name, capabilities: state.current.capabilities,
      selection: state.selection, canUndo: state.canUndo, sourceRef: scene.sourceRef, field: scene.fields.name.value, bytes: Array.from(input.bytes) };
  });
  expect(imports).toBe(4);
  expect(restored).toMatchObject({ taskId: prepared.taskId, name: 'lazy-owned.pdf', originalName: 'lazy-owned.pdf',
    capabilities: { searchable: true, forms: true }, selection: [1], canUndo: true, sourceRef: prepared.sourceRef, field: 'Transferred draft value' });
  const bytes = Buffer.from(restored.bytes), saved = await PDFDocument.load(bytes);
  await writeFile(testInfo.outputPath('retried-owned-handoff.pdf'), bytes);
  expect(saved.getPageCount()).toBe(2);
  expect(saved.getTitle()).toBe('Lazy support source');
  expect(saved.getForm().getTextField('name').getText()).toBe('Transferred draft value');
  expect(errors).toEqual([]);
});
