import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function source(label, count) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= count; index++) doc.addPage([600, 800]).drawText(`${label} PAGE ${index}`, { x: 40, y: 700, font, size: 18 });
  return { name: `${label}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}
async function state(page) {
  return page.evaluate(async () => {
    const entry = document.querySelector('script[type="module"][src^="js/"]:not([src="js/i18n.js"])'), ui = await import(new URL('./tool-ui.js', entry.src).href);
    const digest = async (value) => value ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', value.bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('') : null;
    return { snapshot: ui.documentSession.snapshot(), sha: await digest(ui.documentSession.current()), originalSHA: await digest(ui.documentSession.original()) };
  });
}
async function ready(page, kind, name) {
  if (kind === 'object') {
    await expect(page.locator('#objectWorkspace')).toBeVisible();
    await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy', 'false');
  } else if (kind === 'page') {
    await expect(page.locator('#pageTask')).toBeVisible(); await expect(page.locator('#applyBtn')).toBeEnabled();
    await expect(page.locator('#pagePreviewStatus')).toContainText('1 /');
    await expect.poll(() => page.locator('#previewCanvas').evaluate((canvas) => canvas.width > 0 && canvas.height > 0)).toBe(true);
  } else if (kind === 'effect') {
    await expect(page.locator('#pageEffectsTask')).toBeVisible(); await expect(page.locator('#applyBtn')).toBeEnabled();
    await expect(page.locator('#previewCanvas')).toHaveAttribute('data-pdf-page', '1');
  } else if (kind === 'reader') {
    await expect(page.locator('#readerPage')).toBeEnabled(); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#readerTextLayer')).toContainText('PAGE 1');
  } else {
    await expect(page.locator('#fileList > li')).toHaveCount(1);
    if (name !== undefined) await expect(page.locator('#fileList')).toContainText(name);
    await expect(page.locator('.merge-workspace')).toHaveAttribute('aria-busy', 'false');
  }
  if (kind !== 'merge' && name !== undefined) await expect(page.locator('#documentIdentity')).toContainText(name);
}
async function edit(page, text) {
  await ready(page, 'object');
  for (const details of await page.locator('#textInput').locator('xpath=ancestor::details[not(@open)]').all()) await details.locator('summary').first().click();
  await page.fill('#textInput', text); await expect(page.locator('#placeDraftBtn')).toBeEnabled(); await page.click('#placeDraftBtn');
  await expect(page.locator('#applyBtn')).toBeEnabled(); await page.click('#applyBtn');
  await expect(page.locator('#documentResultPreview')).toHaveAttribute('aria-busy', 'false');
}
async function saved(page, testInfo, name) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadResultBtn')]);
  const path = testInfo.outputPath(name); await download.saveAs(path);
  const bytes = await readFile(path), doc = await PDFDocument.load(bytes);
  const text = await page.evaluate(async (bytes) => {
    const entry = document.querySelector('script[type="module"][src^="js/"]:not([src="js/i18n.js"])'), runtime = await import(new URL('./lib-loader.js', entry.src).href);
    const task = (await runtime.ensurePdfJs()).getDocument({ data: Uint8Array.from(bytes), ...runtime.PDFJS_ASSET_URLS });
    try { const pdf = await task.promise, result = []; for (let index = 1; index <= pdf.numPages; index++) result.push((await (await pdf.getPage(index)).getTextContent()).items.map((item) => item.str).join(' ')); return result; }
    finally { await task.destroy(); }
  }, [...bytes]);
  return { pages: doc.getPageCount(), text };
}
async function mergeThenEditor(page) {
  await expect(page.locator('#mergeBtn')).toBeEnabled(); await page.click('#mergeBtn');
  await expect(page.locator('#documentResultPreview')).toHaveAttribute('aria-busy', 'false');
  await page.click('#useResultBtn');
  const label = await page.evaluate(async () => { const entry = document.querySelector('script[type="module"][src^="js/"]:not([src="js/i18n.js"])'); return (await import(new URL('./i18n.js', entry.src).href)).t('hub.tool_add_text', 'Add Text'); });
  await page.locator('#chainRow').getByRole('button', { name: label, exact: true }).click();
  await ready(page, 'object');
}
async function continueToEditor(page, kind) {
  if (kind === 'object') return;
  if (kind === 'merge') {
    await page.setInputFiles('#fileInput', await source('ADDED C', 1));
    await mergeThenEditor(page);
  } else {
    if (kind === 'reader' && await page.locator('#readerModes').getAttribute('open') === null) await page.locator('#readerModes > summary').click();
    await page.locator('#workspaceModes button[data-mode="add-text"]').click();
    await ready(page, 'object');
  }
}

function observe(page) {
  const errors = [], nonGet = [], downloads = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.method() !== 'GET') nonGet.push(request.url()); });
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  return { errors, nonGet, downloads };
}
async function initialRead(page, route) {
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
  await page.goto('/add-text'); await page.setInputFiles('#fileInput', await source('OLD A', 1)); await ready(page, 'object', 'OLD A.pdf');
  const handoff = await page.evaluate(async (target) => {
    const entry = document.querySelector('script[type="module"][src^="js/"]:not([src="js/i18n.js"])'), ui = await import(new URL('./tool-ui.js', entry.src).href), current = ui.documentSession.current();
    const result = await ui.stashForChain(current.bytes, current.name, target);
    return { workflowId: result.workflowId, fileId: result.fileId };
  }, route.split('/').at(-1));
  // Delegation-only observer awaits the real helper's returned Promise. It does
  // not replace storage, parser, guard, File, or caller behavior.
  await page.route('**/document-handoff.js*', async (route) => {
    const response = await route.fetch(), body = await response.text();
    const marker = 'export async function takeChainedFile(';
    if (!body.includes(marker)) throw new Error('The real initial handoff helper was not found.');
    await route.fulfill({ response, body: body.replace(marker, 'async function observedTakeChainedFile(') + '\nexport async function takeChainedFile(...args) { try { return await observedTakeChainedFile(...args); } finally { window.initialHandoffSettled = true; } }\n' });
  });
  await page.route('**/document-workspace-support.js*', async (route) => {
    const response = await route.fetch(), body = await response.text();
    const marker = 'export async function readExternalPdfFile(';
    if (!body.includes(marker)) throw new Error('The real external source intake helper was not found.');
    const observer = `
export async function readExternalPdfFile(...args) {
  const observed = args[0]?.name === 'OLD A.pdf' && window.holdLateInitialSource;
  try { return await observedExternalPdfFile(...args); }
  finally { if (observed) window.lateInitialExternalSettled = true; }
}
`;
    await route.fulfill({ response, body: body.replace(marker, 'async function observedExternalPdfFile(') + observer });
  });
  await page.addInitScript((target) => {
    if (location.pathname !== target) return;
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    let claimed = false; window.oldInitialFileReads = 0;
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const ordinal = this.name === 'OLD A.pdf' ? ++window.oldInitialFileReads : 0;
      const bytes = await read.call(this);
      // The first A read validates/commits canonical intake. Its second read is
      // the real external source import, held only after native bytes complete.
      if (ordinal === 2 && window.holdLateInitialSource) {
        window.lateInitialSourceHeld = true; window.lateInitialNativeReadCompleted = true;
        await new Promise((resolve) => { window.releaseLateInitialSource = resolve; });
      }
      return bytes;
    };
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      configurable: true, enumerable: descriptor.enumerable, get: descriptor.get,
      set(handler) {
        const tx = this, eligible = !claimed && tx.db.name === 'browserpdf-workflows' && tx.mode === 'readonly' && [...tx.objectStoreNames].includes('workflows');
        if (eligible) {
          claimed = true;
          descriptor.set.call(tx, function (event) {
            window.initialReadHeld = true; window.initialNativeReadCompleted = true;
            window.releaseInitialRead = () => handler.call(tx, event);
          });
        } else descriptor.set.call(tx, handler);
      },
    });
  }, route);
  await page.goto(`${route}?workflow=${handoff.workflowId}&file=${encodeURIComponent(handoff.fileId)}`);
  await expect.poll(() => page.evaluate(() => window.initialReadHeld)).toBe(true);
  expect(await page.evaluate(() => window.initialNativeReadCompleted)).toBe(true);
  return handoff;
}
async function release(page) {
  await page.evaluate(() => window.releaseInitialRead());
  await expect.poll(() => page.evaluate(() => window.initialHandoffSettled)).toBe(true);
  expect(await page.evaluate(() => window.oldInitialFileReads)).toBe(0);
}

async function lateInitialImport(page) {
  await initialRead(page, '/merge');
  await page.evaluate(() => { window.holdLateInitialSource = true; window.releaseInitialRead(); });
  await expect.poll(() => page.evaluate(() => window.lateInitialSourceHeld)).toBe(true);
  expect(await page.evaluate(() => window.lateInitialNativeReadCompleted)).toBe(true);
  expect(await page.evaluate(() => window.oldInitialFileReads)).toBe(2);
  const accepted = await state(page);
  expect(accepted.snapshot.current.name).toBe('OLD A.pdf'); expect(accepted.snapshot.original.name).toBe('OLD A.pdf');
  expect(accepted.sha).toBe(accepted.originalSHA);
  await expect(page.locator('#fileList > li')).toHaveCount(0);
  return accepted;
}
async function releaseLateSource(page) {
  await page.evaluate(() => window.releaseLateInitialSource());
  await expect.poll(() => page.evaluate(() => window.lateInitialExternalSettled)).toBe(true);
  await expect(page.locator('.merge-workspace')).toHaveAttribute('aria-busy', 'false');
}

for (const [slug, kind] of [['add-text', 'object'], ['rotate', 'page'], ['page-numbers', 'effect'], ['view-pdf', 'reader'], ['merge', 'merge']]) {
  for (const locale of ['', '/tr']) test(`completed initial READ loses to fully ready native B in ${locale || 'en'}/${slug}`, async ({ page }, testInfo) => {
    const observed = observe(page), target = `${locale}/${slug}`, handoff = await initialRead(page, target), replacement = await source('NEW B', 2);
    await expect(page.locator('#fileInput')).toBeEnabled(); await page.setInputFiles('#fileInput', replacement); await ready(page, kind, replacement.name);
    const before = await state(page);
    if (kind !== 'merge') { expect(before.sha).toBe(hash(replacement.buffer)); expect(before.originalSHA).toBe(hash(replacement.buffer)); expect(before.snapshot.taskId).not.toBe(handoff.workflowId); }
    await release(page);
    expect(await state(page)).toEqual(before); expect(new URL(page.url()).pathname).toBe(target); expect(new URL(page.url()).search).toBe('');
    await continueToEditor(page, kind); await edit(page, 'SURVIVING B EDIT');
    const result = await saved(page, testInfo, 'surviving-B.pdf');
    expect(result.pages).toBe(kind === 'merge' ? 3 : 2); expect(result.text[0]).toContain('NEW B PAGE 1'); expect(result.text[1]).toContain('NEW B PAGE 2');
    expect(result.text.join('\n')).toContain('SURVIVING B EDIT'); expect(result.text.join('\n')).not.toContain('OLD A');
    expect(observed.downloads).toHaveLength(1); expect(observed.errors).toEqual([]); expect(observed.nonGet).toEqual([]);
  });
}

test('native Merge Clear invalidates completed initial READ and a new native batch remains usable', async ({ page }, testInfo) => {
  const observed = observe(page); await initialRead(page, '/merge'); await expect(page.locator('#clearBtn')).toBeEnabled(); await page.click('#clearBtn');
  await release(page); expect((await state(page)).snapshot.taskId).toBeNull(); await expect(page.locator('#fileList > li')).toHaveCount(0); expect(new URL(page.url()).search).toBe('');
  await page.setInputFiles('#fileInput', await source('NEW B', 2)); await ready(page, 'merge', 'NEW B.pdf');
  await continueToEditor(page, 'merge'); await edit(page, 'AFTER CLEAR'); const result = await saved(page, testInfo, 'clear-then-B.pdf');
  expect(result.pages).toBe(3); expect(result.text.join('\n')).toContain('AFTER CLEAR'); expect(result.text.join('\n')).not.toContain('OLD A');
  expect(observed.downloads).toHaveLength(1); expect(observed.errors).toEqual([]); expect(observed.nonGet).toEqual([]);
});

test('rejected native B invalidates initial A without reading it and fresh B still exports', async ({ page }, testInfo) => {
  const observed = observe(page); await initialRead(page, '/add-text');
  await page.setInputFiles('#fileInput', { name: 'rejected.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid B') }); await expect(page.locator('#errorSection')).toBeVisible();
  await release(page); expect((await state(page)).snapshot.taskId).toBeNull();
  await page.setInputFiles('#fileInput', await source('NEW B', 2)); await ready(page, 'object', 'NEW B.pdf'); await edit(page, 'AFTER REJECTION');
  const result = await saved(page, testInfo, 'rejected-then-B.pdf'); expect(result.pages).toBe(2); expect(result.text.join('\n')).not.toContain('OLD A');
  expect(observed.downloads).toHaveLength(1); expect(observed.errors).toEqual([]); expect(observed.nonGet).toEqual([]);
});

for (const [slug, kind, module] of [['add-text', 'object', 'object-workspace'], ['rotate', 'page', 'page-task-workspace'], ['page-numbers', 'effect', 'page-effects-workspace'], ['view-pdf', 'reader', 'reader-workspace']]) {
  test(`rejected B retains accepted A while ${module} is still opening`, async ({ page }, testInfo) => {
    const observed = observe(page), entered = deferred(), releaseModule = deferred();
    await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
    await page.route(`**/${module}.js`, async (route) => { entered.resolve(); await releaseModule.promise; await route.continue(); });
    await page.goto(`/${slug}`); await page.setInputFiles('#fileInput', await source('ACCEPTED A', 2)); await entered.promise;
    const before = await state(page); expect(before.snapshot.current.name).toBe('ACCEPTED A.pdf');
    await page.setInputFiles('#fileInput', { name: 'rejected.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid B') }); releaseModule.resolve();
    await ready(page, kind, 'ACCEPTED A.pdf'); await expect(page.locator('#errorSection')).toBeVisible();
    expect((await state(page)).snapshot.taskId).toBe(before.snapshot.taskId); expect((await state(page)).sha).toBe(before.sha);
    await continueToEditor(page, kind); await edit(page, 'RETAINED A EDIT');
    const result = await saved(page, testInfo, 'accepted-A-after-rejected-B.pdf'); expect(result.pages).toBe(2); expect(result.text[1]).toContain('ACCEPTED A PAGE 2'); expect(result.text.join('\n')).toContain('RETAINED A EDIT');
    expect(observed.downloads).toHaveLength(1); expect(observed.errors).toEqual([]); expect(observed.nonGet).toEqual([]);
  });
}


test('late initial Merge Clear releases only accepted A, and stale source drain cannot restore it over native B', async ({ page }, testInfo) => {
  const observed = observe(page), accepted = await lateInitialImport(page);
  await expect(page.locator('#clearBtn')).toBeEnabled(); await page.click('#clearBtn');
  const cleared = await state(page); expect(cleared.snapshot.taskId).toBeNull(); expect(cleared.sha).toBeNull(); expect(cleared.originalSHA).toBeNull();
  await page.setInputFiles('#fileInput', await source('NEW B', 2)); await ready(page, 'merge', 'NEW B.pdf');
  const beforeDrain = await state(page); expect(beforeDrain.snapshot.taskId).toBeNull();
  await releaseLateSource(page); await expect(page.locator('#fileList > li')).toHaveCount(1); await expect(page.locator('#fileList')).not.toContainText('OLD A');
  expect(await state(page)).toEqual(beforeDrain); expect(new URL(page.url()).search).toBe('');
  await continueToEditor(page, 'merge'); await edit(page, 'LATE CLEAR B EDIT');
  const result = await saved(page, testInfo, 'late-clear-native-B.pdf');
  expect(result.pages).toBe(3); expect(result.text[0]).toContain('NEW B PAGE 1'); expect(result.text[1]).toContain('NEW B PAGE 2'); expect(result.text.join('\n')).not.toContain('OLD A'); expect(result.text.join('\n')).toContain('LATE CLEAR B EDIT');
  expect((await state(page)).snapshot.taskId).not.toBe(accepted.snapshot.taskId);
  expect(observed.downloads).toHaveLength(1); expect(observed.errors).toEqual([]); expect(observed.nonGet).toEqual([]);
});

test('late accepted initial Merge A retains exact ownership and source order when native B is added', async ({ page }, testInfo) => {
  const observed = observe(page), accepted = await lateInitialImport(page);
  await page.setInputFiles('#fileInput', await source('NEW B', 2));
  expect(await state(page)).toEqual(accepted);
  await releaseLateSource(page); await expect(page.locator('#fileList > li')).toHaveCount(2);
  await expect(page.locator('#fileList > li').nth(0)).toContainText('OLD A.pdf'); await expect(page.locator('#fileList > li').nth(1)).toContainText('NEW B.pdf');
  expect(await state(page)).toEqual(accepted);
  await mergeThenEditor(page); await edit(page, 'ADDITIVE B EDIT');
  const result = await saved(page, testInfo, 'late-additive-A-B.pdf');
  expect(result.pages).toBe(3); expect(result.text[0]).toContain('OLD A PAGE 1'); expect(result.text[1]).toContain('NEW B PAGE 1'); expect(result.text[2]).toContain('NEW B PAGE 2'); expect(result.text.join('\n')).toContain('ADDITIVE B EDIT');
  expect((await state(page)).snapshot.taskId).toBe(accepted.snapshot.taskId); expect((await state(page)).originalSHA).toBe(accepted.originalSHA);
  expect(observed.downloads).toHaveLength(1); expect(observed.errors).toEqual([]); expect(observed.nonGet).toEqual([]);
});

test('late accepted initial Merge A survives actual rejected PDF B and still produces an A-containing artifact', async ({ page }, testInfo) => {
  const observed = observe(page), accepted = await lateInitialImport(page);
  await page.setInputFiles('#fileInput', { name: 'REJECTED B.pdf', mimeType: 'application/pdf', buffer: Buffer.from('malformed native B') });
  expect(await state(page)).toEqual(accepted);
  await releaseLateSource(page); await expect(page.locator('#fileList > li')).toHaveCount(1); await expect(page.locator('#fileList')).toContainText('OLD A.pdf'); await expect(page.locator('#errorSection')).toBeVisible();
  expect(await state(page)).toEqual(accepted);
  await continueToEditor(page, 'merge'); await edit(page, 'REJECTED B RETAINED A');
  const result = await saved(page, testInfo, 'late-rejected-B-retained-A.pdf');
  expect(result.pages).toBe(2); expect(result.text[0]).toContain('OLD A PAGE 1'); expect(result.text[1]).toContain('ADDED C PAGE 1'); expect(result.text.join('\n')).toContain('REJECTED B RETAINED A');
  expect((await state(page)).snapshot.taskId).toBe(accepted.snapshot.taskId); expect((await state(page)).originalSHA).toBe(accepted.originalSHA);
  expect(observed.downloads).toHaveLength(1); expect(observed.errors).toEqual([]); expect(observed.nonGet).toEqual([]);
});

test('late initial Merge Clear preserves a newer unrelated validated canonical task', async ({ page }, testInfo) => {
  const observed = observe(page); await lateInitialImport(page);
  const replacement = await source('UNRELATED CURRENT B', 2);
  // Merge file input is additive. This public intake control runs the actual
  // File/PDF validators to choose a different canonical task before native Clear.
  await page.evaluate(async (bytes) => {
    const entry = document.querySelector('script[type="module"][src^="js/"]:not([src="js/i18n.js"])'), ui = await import(new URL('./tool-ui.js', entry.src).href);
    const accepted = await ui.readPdfFile(new File([Uint8Array.from(bytes)], 'UNRELATED CURRENT B.pdf', { type: 'application/pdf' }), { validate: true });
    if (!accepted) throw new Error('The newer canonical task was not validated.');
  }, [...replacement.buffer]);
  const newer = await state(page); expect(newer.sha).toBe(hash(replacement.buffer)); expect(newer.originalSHA).toBe(hash(replacement.buffer));
  await page.click('#clearBtn'); expect(await state(page)).toEqual(newer);
  await releaseLateSource(page); await expect(page.locator('#fileList > li')).toHaveCount(0); expect(await state(page)).toEqual(newer);
  const handoff = await page.evaluate(async () => {
    const entry = document.querySelector('script[type="module"][src^="js/"]:not([src="js/i18n.js"])'), ui = await import(new URL('./tool-ui.js', entry.src).href), current = ui.documentSession.current(), result = await ui.stashForChain(current.bytes, current.name, 'add-text');
    return { workflowId: result.workflowId, fileId: result.fileId };
  });
  await page.goto(`/add-text?workflow=${handoff.workflowId}&file=${encodeURIComponent(handoff.fileId)}`); await edit(page, 'NEWER B RETAINED');
  const result = await saved(page, testInfo, 'late-clear-preserved-newer-B.pdf');
  expect(result.pages).toBe(2); expect(result.text[1]).toContain('UNRELATED CURRENT B PAGE 2'); expect(result.text.join('\n')).not.toContain('OLD A'); expect(result.text.join('\n')).toContain('NEWER B RETAINED');
  expect((await state(page)).snapshot.taskId).toBe(newer.snapshot.taskId); expect((await state(page)).originalSHA).toBe(newer.originalSHA);
  expect(observed.downloads).toHaveLength(1); expect(observed.errors).toEqual([]); expect(observed.nonGet).toEqual([]);
});


test('resumed page-effects rejection stays visible until a later owned edit succeeds, and future failures replace it', async ({ page }, testInfo) => {
  const observed = observe(page), entered = deferred(), releaseModule = deferred();
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected'));
  await page.route('**/page-effects-workspace.js', async (route) => { entered.resolve(); await releaseModule.promise; await route.continue(); });
  await page.goto('/page-numbers'); await page.setInputFiles('#fileInput', await source('ACCEPTED A', 2)); await entered.promise;
  const before = await state(page);
  await page.setInputFiles('#fileInput', { name: 'rejected.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid B') }); releaseModule.resolve();
  await ready(page, 'effect', 'ACCEPTED A.pdf'); await expect(page.locator('#errorSection')).toBeVisible();
  await expect(page.locator('#errorText')).toContainText('Please select a PDF file.');
  expect((await state(page)).sha).toBe(before.sha); expect((await state(page)).snapshot.taskId).toBe(before.snapshot.taskId);

  await page.fill('#startInput', '7'); await ready(page, 'effect'); await expect(page.locator('#errorSection')).toBeHidden();
  await page.fill('#startInput', '-1'); await expect(page.locator('#errorSection')).toBeVisible();
  await expect(page.locator('#errorText')).toContainText('Start number must be between 0 and 1000000.');
  await expect(page.locator('#applyBtn')).toBeDisabled();
  await page.fill('#startInput', '9'); await ready(page, 'effect'); await expect(page.locator('#errorSection')).toBeHidden();
  await page.click('#applyBtn'); await expect(page.locator('#documentResultPreview')).toHaveAttribute('aria-busy', 'false');
  await page.click('#useResultBtn'); await expect(page.locator('#workspaceModes button[data-mode="add-text"]')).toBeEnabled();
  await continueToEditor(page, 'effect'); await edit(page, 'RESUMED A LATER EDIT');
  const result = await saved(page, testInfo, 'resumed-A-owned-error-lifecycle.pdf');
  expect(result.pages).toBe(2); expect(result.text[0]).toContain('ACCEPTED A PAGE 1'); expect(result.text[1]).toContain('ACCEPTED A PAGE 2');
  expect(result.text[0]).toMatch(/\b9\b/); expect(result.text[1]).toMatch(/\b10\b/); expect(result.text.join('\n')).toContain('RESUMED A LATER EDIT');
  expect((await state(page)).snapshot.taskId).toBe(before.snapshot.taskId); expect((await state(page)).originalSHA).toBe(before.originalSHA);
  expect(observed.downloads).toHaveLength(1); expect(observed.errors).toEqual([]); expect(observed.nonGet).toEqual([]);
});
