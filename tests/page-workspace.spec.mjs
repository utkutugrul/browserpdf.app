import { test, expect } from '@playwright/test';
import * as pdfLib from 'pdf-lib';
import { readFile, writeFile } from 'node:fs/promises';
import { parsePageRanges, pagesByParity, changePageSelection, formatPageRanges } from '../public/js/core/page-selection.js';
import { createPagePlan, movePageGroup, duplicatePageGroup, deletePageGroup, rotatePageGroup, cropPageGroup, insertPageSource, createPagePlanHistory } from '../public/js/core/page-plan.js';
import { applyPagePlan, rotatePdfPages, cropPdfPages } from '../public/js/core/page-operations.js';

async function fixture(markers, { structures = false, extreme = false } = {}) {
  const doc = await pdfLib.PDFDocument.create();
  doc.setTitle('Private source title');
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  for (const [index, marker] of markers.entries()) {
    const page = doc.addPage(extreme && index === 0 ? [10, 50000] : [300, 260]);
    if (!(extreme && index === 0)) { page.setCropBox(20, 30, 260, 200); page.drawText(marker, { x: 45, y: 130, size: 14, font }); }
  }
  if (structures) {
    doc.getForm().createTextField('Private field name').setText('Private form value');
    doc.getForm().getTextField('Private field name').addToPage(doc.getPage(1), { x: 45, y: 60, width: 160, height: 24 });
    doc.catalog.set(pdfLib.PDFName.of('Outlines'), doc.context.obj({ Type: 'Outlines', Count: 0 }));
    doc.catalog.set(pdfLib.PDFName.of('StructTreeRoot'), doc.context.obj({ Type: 'StructTreeRoot', K: [] }));
  }
  return new Uint8Array(await doc.save());
}
async function open(page) { await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected')); await page.goto('/view-pdf'); }
async function textPages(page, bytes) {
  return page.evaluate(async (values) => {
    const { ensurePdfJs, PDFJS_ASSET_URLS } = await import('/js/lib-loader.js');
    const task = (await ensurePdfJs()).getDocument({ data: new Uint8Array(values), ...PDFJS_ASSET_URLS });
    try { const doc = await task.promise, pages = []; for (let n = 1; n <= doc.numPages; n++) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((item) => item.str).join(' ')); return pages; }
    finally { await task.destroy(); }
  }, Array.from(bytes));
}
async function mount(page, bytes, pageCount, { wait = true } = {}) {
  await open(page);
  await page.evaluate(async ({ values, pageCount }) => {
    const { documentSession, ensureDocumentSession } = await import('/js/tool-ui.js');
    const { createPagePlan } = await import('/js/core/page-plan.js');
    const { createPageWorkspace } = await import('/js/page-workspace.js');
    await ensureDocumentSession(); const bytes = new Uint8Array(values); documentSession.begin(bytes, 'page-checkpoint.pdf');
    const container = document.createElement('div'); container.id = 'pageCheckpoint'; document.querySelector('main').append(container);
    window.pageCheckpointEvents = { selection: [], navigation: [] };
    window.pageCheckpoint = await createPageWorkspace({ container, sources: [{ id: 'source', bytes }], plan: createPagePlan({ sourceId: 'source', pageCount }),
      onSelectionChange: (pages) => window.pageCheckpointEvents.selection.push(pages),
      onNavigate: (index, entry) => window.pageCheckpointEvents.navigation.push({ index, id: entry.id, pageIndex: entry.pageIndex }),
    });
  }, { values: Array.from(bytes), pageCount });
  if (wait) await page.evaluate(() => window.pageCheckpoint.ready());
}

test('page ranges validate ordinary syntax, parity and Shift selection without allocating repeated ranges', () => {
  expect(parsePageRanges('1-5,8, 3,10-11', 12)).toEqual([0, 1, 2, 3, 4, 7, 9, 10]);
  expect(formatPageRanges([0, 1, 2, 4, 7, 8], 10)).toBe('1-3,5,8-9');
  for (const value of ['0', '3-1', '1,,2', '1-13', '1.5', 'a', '-2', '1-']) expect(() => parsePageRanges(value, 12), value).toThrow();
  expect(parsePageRanges(Array(100).fill('1-10000').join(','), 10000)).toHaveLength(10000);
  expect(pagesByParity(5, 'odd')).toEqual([0, 2, 4]); expect(pagesByParity(5, 'even')).toEqual([1, 3]);
  expect(changePageSelection({ selected: [0], anchor: 0 }, 3, { pageCount: 6, shiftKey: true })).toEqual({ selected: [0, 1, 2, 3], anchor: 0 });
  expect(changePageSelection({ selected: [5], anchor: 1 }, 3, { pageCount: 6, shiftKey: true, additive: true }).selected).toEqual([1, 2, 3, 5]);
  expect(changePageSelection({ selected: pagesByParity(10000, 'all'), anchor: 0 }, 9999, { pageCount: 10000, shiftKey: true, additive: true }).selected).toHaveLength(10000);
});

test('page plans keep stable immutable IDs and bounded group/insert/crop undo history', () => {
  const original = createPagePlan({ sourceId: 'source', pageCount: 4 }), ids = original.pages.map((entry) => entry.id);
  const moved = movePageGroup(original, [ids[1], ids[2]], 0);
  expect(moved.pages.map((entry) => entry.id)).toEqual([ids[1], ids[2], ids[0], ids[3]]);
  expect(original.pages.map((entry) => entry.id)).toEqual(ids); expect(Object.isFrozen(moved.pages[0])).toBe(true);
  expect(() => { moved.pages[0].rotation = 90; }).toThrow();
  const duplicated = duplicatePageGroup(moved, [ids[1], ids[2]], 2);
  expect(new Set(duplicated.pages.map((entry) => entry.id)).size).toBe(6);
  const inserted = insertPageSource(duplicated, { sourceId: 'external', pageCount: 2, pageIndices: [1] }, 1);
  expect(inserted.pages[1]).toMatchObject({ sourceId: 'external', pageIndex: 1 });
  expect(() => deletePageGroup(original, ids)).toThrow(/Keep between/);
  expect(deletePageGroup(original, [ids[2]], { keepSelected: true }).pages.map((entry) => entry.id)).toEqual([ids[2]]);
  const history = createPagePlanHistory(original, { limit: 3 });
  history.commit(cropPageGroup(original, [ids[0]], { x: 30, y: 40, width: 150, height: 120 }));
  history.commit(rotatePageGroup(history.current(), [ids[1]], 90));
  history.undo(); expect(history.current().pages[1].rotation).toBe(0); expect(history.current().pages[0].crop.width).toBe(150);
  history.redo(); expect(history.current().pages[1].rotation).toBe(90);
  for (let n = 0; n < 8; n++) history.commit(rotatePageGroup(history.current(), [ids[1]], 90));
  expect(history.snapshot().retainedPlans).toBe(4); expect(JSON.stringify(history.snapshot())).not.toMatch(/bytes|tile|canvas|base64/);
  const large = createPagePlan({ sourceId: 'large', pageCount: 10000 }), bounded = createPagePlanHistory(large);
  for (let n = 0; n < 7; n++) bounded.commit(rotatePageGroup(bounded.current(), [large.pages[0].id], 90));
  expect(bounded.snapshot().retainedPages).toBe(60000); expect(bounded.snapshot().retainedPlans).toBe(6);
});

test('shared page executor saves real selected group order, insert, duplicate, rotation and crop artifacts', async ({ page }, testInfo) => {
  const source = await fixture(['PAGE_A', 'PAGE_B', 'PAGE_C'], { structures: true }), external = await fixture(['EXT_ONE', 'EXT_TWO']);
  const originalBytes = source.slice(), original = createPagePlan({ sourceId: 'source', pageCount: 3 });
  let plan = insertPageSource(original, { sourceId: 'external', pageCount: 2, pageIndices: [1, 0] }, 1);
  plan = duplicatePageGroup(plan, [original.pages[1].id], 4);
  const duplicatedId = plan.pages[4].id, externalIds = plan.pages.filter((entry) => entry.sourceId === 'external').map((entry) => entry.id);
  plan = movePageGroup(plan, externalIds, 0); plan = deletePageGroup(plan, [original.pages[0].id]);
  plan = rotatePageGroup(plan, [duplicatedId], 90); plan = cropPageGroup(plan, [original.pages[2].id], { x: 35, y: 40, width: 200, height: 160 });
  const result = await applyPagePlan([{ id: 'source', bytes: source }, { id: 'external', bytes: external }], plan, { pdfLib });
  const outputPath = testInfo.outputPath('group-insert-duplicate-crop.pdf'); await writeFile(outputPath, result.bytes);
  const saved = new Uint8Array(await readFile(outputPath)), reopened = await pdfLib.PDFDocument.load(saved);
  expect(reopened.getPageCount()).toBe(5); expect(reopened.getPage(3).getRotation().angle).toBe(90);
  expect(reopened.getPage(4).getCropBox()).toEqual({ x: 35, y: 40, width: 200, height: 160 });
  expect(reopened.getPage(4).getMediaBox()).toEqual({ x: 0, y: 0, width: 300, height: 260 });
  expect(source).toEqual(originalBytes); expect(result.pageMap.map((entry) => entry.id)).toEqual(plan.pages.map((entry) => entry.id));
  expect(result.boundary).toMatchObject({ kind: 'page-copy', losses: expect.arrayContaining(['page-copy-structures-unverified', 'page-copy-form-definitions', 'page-copy-bookmarks', 'page-copy-tags', 'crop-hidden-content']) });
  expect(JSON.stringify(result.boundary)).not.toMatch(/Private|field name|form value/);
  expect(reopened.catalog.has(pdfLib.PDFName.of('Outlines'))).toBe(false);
  await open(page); const texts = await textPages(page, saved);
  expect(texts.map((value) => value.match(/EXT_\w+|PAGE_\w+/)?.[0])).toEqual(['EXT_TWO', 'EXT_ONE', 'PAGE_B', 'PAGE_B', 'PAGE_C']);
});

test('selected rotation and crop preserve loaded catalog, source boxes, forms and recoverable hidden content', async ({ page }, testInfo) => {
  const source = await fixture(['PAGE_A', 'PAGE_B', 'PAGE_C'], { structures: true });
  const rotated = await rotatePdfPages(source, { pages: [1], degrees: 90, pageCount: 3 }, { pdfLib });
  expect(rotated.boundary.kind).toBe('pdf-rewrite'); expect(rotated.boundary.losses).not.toContain('page-copy-form-definitions');
  const result = await cropPdfPages(rotated.bytes, { pages: [0], pageCount: 3, box: { x: 30, y: 35, width: 180, height: 60 } }, { pdfLib });
  const outputPath = testInfo.outputPath('catalog-preserving-rotate-crop.pdf'); await writeFile(outputPath, result.bytes);
  const saved = new Uint8Array(await readFile(outputPath)), reopened = await pdfLib.PDFDocument.load(saved);
  expect(reopened.getPages().map((page) => page.getRotation().angle)).toEqual([0, 90, 0]);
  expect(reopened.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 300, height: 260 });
  expect(reopened.getPage(2).getCropBox()).toEqual({ x: 20, y: 30, width: 260, height: 200 });
  expect(reopened.catalog.has(pdfLib.PDFName.of('Outlines'))).toBe(true); expect(reopened.catalog.has(pdfLib.PDFName.of('StructTreeRoot'))).toBe(true);
  expect(reopened.getForm().getTextField('Private field name').getText()).toBe('Private form value');
  // Restore visibility only in a verification clone: crop must never claim removal.
  reopened.getPage(0).setCropBox(20, 30, 260, 200); await open(page);
  expect((await textPages(page, await reopened.save()))[0]).toContain('PAGE_A');
});

test('page executor rejects stale plans, out-of-box crops and cancelled results without changing input', async () => {
  const source = await fixture(['PAGE_A', 'PAGE_B']), before = source.slice(), plan = createPagePlan({ sourceId: 'source', pageCount: 2 });
  const controller = new AbortController();
  await expect(applyPagePlan([{ id: 'source', bytes: source }], plan, { pdfLib, signal: controller.signal, onProgress: (event) => { if (event.phase === 'page') controller.abort(); } })).rejects.toHaveProperty('name', 'AbortError');
  await expect(applyPagePlan([{ id: 'source', bytes: source }], createPagePlan({ sourceId: 'source', pageCount: 3 }), { pdfLib })).rejects.toThrow(/no longer matches/);
  await expect(cropPdfPages(source, { pages: [0], pageCount: 2, box: { x: 0, y: 0, width: 280, height: 240 } }, { pdfLib })).rejects.toThrow(/within/);
  expect(source).toEqual(before);
  for (const file of ['page-selection.js', 'page-plan.js', 'page-operations.js']) expect(await readFile(new URL(`../public/js/core/${file}`, import.meta.url), 'utf8')).not.toMatch(/\b(?:document|window|navigator)\s*\.\s*[a-zA-Z_$]|createObjectURL|\.click\(/);
});

test('common panel writes canonical range, odd/even, Shift and keyboard selection and remaps stable page IDs', async ({ page }) => {
  const bytes = await fixture(Array.from({ length: 6 }, (_, index) => `PAGE_${index + 1}`)); await mount(page, bytes, 6);
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('2-4,6'); await page.getByRole('button', { name: 'Select range', exact: true }).click();
  const selection = () => page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.snapshot().selection);
  expect(await selection()).toEqual([1, 2, 3, 5]);
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('0-4'); await page.getByRole('button', { name: 'Select range', exact: true }).click();
  await expect(page.locator('.page-workspace-error')).toBeVisible(); expect(await selection()).toEqual([1, 2, 3, 5]);
  await page.locator('[data-selection="even"]').click(); expect(await selection()).toEqual([1, 3, 5]);
  await page.locator('[data-selection="odd"]').click(); expect(await selection()).toEqual([0, 2, 4]);
  await page.locator('[data-selection="none"]').click(); await page.locator('.page-workspace-tile').nth(0).click(); await page.locator('.page-workspace-tile').nth(3).click({ modifiers: ['Shift'] }); expect(await selection()).toEqual([0, 1, 2, 3]);
  await page.locator('[data-selection="none"]').click(); await page.locator('.page-workspace-tile').nth(1).focus(); await page.keyboard.press('Space'); await page.locator('.page-workspace-tile').nth(4).focus(); await page.keyboard.press('Shift+Space'); expect(await selection()).toEqual([1, 2, 3, 4]);
  await page.evaluate(async () => { const { createPagePlan, movePageGroup } = await import('/js/core/page-plan.js'); const plan = createPagePlan({ sourceId: 'source', pageCount: 6 }); await window.pageCheckpoint.setPlan(movePageGroup(plan, plan.pages.slice(1, 5).map((entry) => entry.id), 0)); });
  expect(await selection()).toEqual([0, 1, 2, 3]);
});

test('cleared and replaced document tasks reject stale panel tiles, controls and selection APIs', async ({ page }) => {
  const four = await fixture(['PAGE_A', 'PAGE_B', 'PAGE_C', 'PAGE_D']), two = await fixture(['NEW_A', 'NEW_B']);
  await mount(page, four, 4);
  const cleared = await page.evaluate(async () => {
    const { documentSession } = await import('/js/tool-ui.js'), { createPagePlan } = await import('/js/core/page-plan.js');
    const panel = window.pageCheckpoint, tile = panel.element.querySelector('[data-page-index="2"]'), canvases = [...panel.element.querySelectorAll('canvas')];
    const range = panel.element.querySelector('input[type="text"]'), rangeButton = panel.element.querySelector('.page-workspace-range button'), parity = panel.element.querySelector('[data-selection="odd"]');
    documentSession.clear(); tile.click(); range.value = '1-4'; rangeButton.click(); parity.click(); panel.setSelection([2]); panel.refreshSelection();
    let errorName; try { await panel.setPlan(createPagePlan({ sourceId: 'source', pageCount: 4 })); } catch (error) { errorName = error.name; }
    return { snapshot: documentSession.snapshot(), connected: panel.element.isConnected, clearedCanvases: canvases.every((canvas) => canvas.width === 0 && canvas.height === 0), events: window.pageCheckpointEvents, selection: panel.selection(), errorName };
  });
  expect(cleared.snapshot).toMatchObject({ taskId: null, current: null, selection: [] });
  expect(cleared).toMatchObject({ connected: false, clearedCanvases: true, selection: [], errorName: 'AbortError', events: { selection: [], navigation: [] } });

  const replaced = await page.evaluate(async ({ four, two }) => {
    const { documentSession } = await import('/js/tool-ui.js'), { createPagePlan } = await import('/js/core/page-plan.js'), { createPageWorkspace } = await import('/js/page-workspace.js');
    const source = new Uint8Array(four); documentSession.begin(source, 'four-pages.pdf'); const owner = documentSession.snapshot().taskId;
    const events = { selection: [], navigation: [] }, panel = await createPageWorkspace({ container: document.querySelector('#pageCheckpoint'), sources: [{ id: 'source', bytes: source }], plan: createPagePlan({ sourceId: 'source', pageCount: 4 }), onSelectionChange: (pages) => events.selection.push(pages), onNavigate: (index, entry) => events.navigation.push({ index, id: entry.id }) });
    await panel.ready(); const tile = panel.element.querySelector('[data-page-index="3"]'), canvases = [...panel.element.querySelectorAll('canvas')], go = [...panel.element.querySelectorAll('button')].find((button) => button.textContent === 'Go'), jump = panel.element.querySelector('input[type="number"]');
    documentSession.begin(new Uint8Array(two), 'two-pages.pdf'); documentSession.setSelection([1]);
    tile.click(); jump.value = '4'; go.click(); panel.setSelection([3]); panel.refreshSelection();
    let errorName; try { await panel.setPlan(createPagePlan({ sourceId: 'source', pageCount: 4 })); } catch (error) { errorName = error.name; }
    const replacementSnapshot = documentSession.snapshot();
    const racingPanel = createPageWorkspace({ container: document.querySelector('#pageCheckpoint'), sources: [{ id: 'source', bytes: new Uint8Array(two) }], plan: createPagePlan({ sourceId: 'source', pageCount: 2 }) });
    documentSession.begin(new Uint8Array(two), 'latest-two-pages.pdf'); documentSession.setSelection([1]);
    let openingErrorName; try { await racingPanel; } catch (error) { openingErrorName = error.name; }
    return { snapshot: documentSession.snapshot(), replacementSnapshot, owner, connected: panel.element.isConnected, clearedCanvases: canvases.every((canvas) => canvas.width === 0 && canvas.height === 0), events, selection: panel.selection(), errorName, openingErrorName };
  }, { four: Array.from(four), two: Array.from(two) });
  expect(replaced.snapshot.taskId).not.toBe(replaced.owner); expect(replaced.snapshot.current.name).toBe('latest-two-pages.pdf'); expect(replaced.snapshot.selection).toEqual([1]);
  expect(replaced.replacementSnapshot.current.name).toBe('two-pages.pdf'); expect(replaced.replacementSnapshot.selection).toEqual([1]);
  expect(replaced).toMatchObject({ connected: false, clearedCanvases: true, selection: [], errorName: 'AbortError', openingErrorName: 'AbortError', events: { selection: [], navigation: [] } });
  await expect(page.locator('.page-workspace')).toHaveCount(0);
});

test('current page keeps its stable identity across windows and moves with a deliberate removed-page fallback', async ({ page }) => {
  const bytes = await fixture(Array.from({ length: 17 }, (_, index) => `PAGE_${index + 1}`)); await mount(page, bytes, 17);
  await page.getByRole('spinbutton', { name: 'Go to page', exact: true }).fill('14'); await page.getByRole('button', { name: 'Go', exact: true }).click(); await page.evaluate(() => window.pageCheckpoint.ready());
  await page.locator('.page-workspace-tile[aria-current="page"]').click();
  await expect(page.locator('.page-workspace-tile[aria-current="page"]')).toHaveAttribute('data-page-id', 'source-14');
  const moved = await page.evaluate(async () => {
    const { createPagePlan, movePageGroup } = await import('/js/core/page-plan.js');
    window.staleCurrentPageTile = window.pageCheckpoint.element.querySelector('[aria-current="page"]');
    window.movedPagePlan = movePageGroup(createPagePlan({ sourceId: 'source', pageCount: 17 }), ['source-14'], 0); await window.pageCheckpoint.setPlan(window.movedPagePlan);
    const tile = window.pageCheckpoint.element.querySelector('[aria-current="page"]');
    return { id: tile.dataset.pageId, index: tile.dataset.pageIndex, jump: window.pageCheckpoint.element.querySelector('input[type="number"]').value, selection: window.pageCheckpoint.selection(), lastNavigation: window.pageCheckpointEvents.navigation.at(-1) };
  });
  expect(moved).toEqual({ id: 'source-14', index: '0', jump: '1', selection: [0], lastNavigation: { index: 0, id: 'source-14', pageIndex: 13 } });
  await expect(page.locator('.page-workspace-tile[aria-current="page"] .page-workspace-source-label')).toHaveText('Source page 14');
  const removed = await page.evaluate(async () => {
    const { deletePageGroup } = await import('/js/core/page-plan.js');
    window.remainingPagePlan = deletePageGroup(window.movedPagePlan, ['source-14']); await window.pageCheckpoint.setPlan(window.remainingPagePlan);
    const eventsBeforeStaleClick = window.pageCheckpointEvents.navigation.length; window.staleCurrentPageTile.click();
    const tile = window.pageCheckpoint.element.querySelector('[aria-current="page"]');
    return { id: tile.dataset.pageId, index: tile.dataset.pageIndex, selection: window.pageCheckpoint.selection(), lastNavigation: window.pageCheckpointEvents.navigation.at(-1), noStaleNavigation: window.pageCheckpointEvents.navigation.length === eventsBeforeStaleClick };
  });
  expect(removed).toEqual({ id: 'source-1', index: '0', selection: [], lastNavigation: { index: 0, id: 'source-1', pageIndex: 0 }, noStaleNavigation: true });
  await page.getByRole('spinbutton', { name: 'Go to page', exact: true }).fill('16'); await page.getByRole('button', { name: 'Go', exact: true }).click(); await page.evaluate(() => window.pageCheckpoint.ready());
  await page.evaluate(async () => { const { deletePageGroup } = await import('/js/core/page-plan.js'); await window.pageCheckpoint.setPlan(deletePageGroup(window.remainingPagePlan, ['source-17'])); });
  await expect(page.locator('.page-workspace-tile[aria-current="page"]')).toHaveAttribute('data-page-id', 'source-16');
  await expect(page.getByRole('spinbutton', { name: 'Go to page', exact: true })).toHaveValue('15');
});

test('common panel bounds extreme thumbnails, pages retained canvases and disposes cancelled windows across layouts', async ({ page }, testInfo) => {
  const bytes = await fixture(Array.from({ length: 17 }, (_, index) => `PAGE_${index + 1}`), { extreme: true });
  await writeFile(testInfo.outputPath('extreme-aspect-pages.pdf'), bytes); await mount(page, bytes, 17);
  expect(await page.locator('.page-workspace-grid canvas').count()).toBe(12);
  const firstDimensions = await page.locator('.page-workspace-grid canvas').first().evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
  expect(Math.max(firstDimensions.width, firstDimensions.height)).toBeLessThanOrEqual(220); expect(firstDimensions.width * firstDimensions.height).toBeLessThanOrEqual(220000);
  const budget = await page.evaluate(async () => {
    const { ensurePdfJs, PDFJS_ASSET_URLS } = await import('/js/lib-loader.js'); const { renderBoundedPage } = await import('/js/core/bounded-renderer.js'); const { documentSession } = await import('/js/tool-ui.js');
    const task = (await ensurePdfJs()).getDocument({ data: documentSession.snapshot({ includeBytes: true }).current.bytes, ...PDFJS_ASSET_URLS });
    try { const doc = await task.promise, canvas = document.createElement('canvas'); await renderBoundedPage(await doc.getPage(2), canvas, { scale: 20, maxDimension: 1000, maxPixels: 5000 }); return { width: canvas.width, height: canvas.height }; }
    finally { await task.destroy(); }
  });
  expect(Math.max(budget.width, budget.height)).toBeLessThanOrEqual(1000); expect(budget.width * budget.height).toBeLessThanOrEqual(5000);
  await page.evaluate(() => { window.oldPageCanvases = [...window.pageCheckpoint.element.querySelectorAll('canvas')]; });
  await page.getByRole('button', { name: 'Next pages', exact: true }).click(); await page.evaluate(() => window.pageCheckpoint.ready());
  expect(await page.locator('.page-workspace-grid canvas').count()).toBe(5); expect(await page.evaluate(() => window.oldPageCanvases.every((canvas) => canvas.width === 0 && canvas.height === 0))).toBe(true);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.dataset.theme = 'dark'; });
    expect(await page.locator('.page-workspace').evaluate((node) => node.scrollWidth <= node.clientWidth + 1), `panel overflow at ${width}`).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('page-panel-dark-rtl.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Previous pages', exact: true }).click();
  const disposed = await page.evaluate(() => { const nodes = [...window.pageCheckpoint.element.querySelectorAll('canvas')]; window.pageCheckpoint.dispose(); return nodes.every((canvas) => canvas.width === 0 && canvas.height === 0); });
  expect(disposed).toBe(true); await expect(page.locator('.page-workspace')).toHaveCount(0); await expect(page.locator('.page-workspace-error')).toHaveCount(0);
});
