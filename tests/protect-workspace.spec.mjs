import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test.skip(process.env.BPDF_PROTECTION_WORKSPACES_NATIVE !== '1', 'Root allocates standalone protection native cases');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(name = 'Source.pdf', text = 'PROTECT RETAIN') {
  const doc = await PDFDocument.create(); doc.setTitle('Protection route title');
  for (let index = 0; index < 2; index++) doc.addPage([320, 240]).drawText(text + ' ' + (index + 1), { x: 20, y: 170, size: 14 });
  const field = doc.getForm().createTextField('retained'); field.setText('FORM RETAIN'); field.addToPage(doc.getPage(0), { x: 20, y: 80, width: 180, height: 24 });
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}
async function state(page) { return page.evaluate(async () => { const ui = await import('/js/tool-ui.js'), digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(x => x.toString(16).padStart(2, '0')).join(''); const snapshot = ui.documentSession.snapshot(); return { snapshot, current: snapshot.current ? await digest(ui.documentSession.current().bytes) : null, original: snapshot.original ? await digest(ui.documentSession.original().bytes) : null }; }); }
async function secrets(page) { await page.evaluate(() => { const value = crypto.randomUUID().slice(0, 24); for (const id of ['passwordInput', 'confirmInput']) { const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); } }); }
async function ready(page, expectedPage = 1) { await expect(page.locator('#protectBtn')).toBeEnabled(); await expect(page.locator('#protectionCanvas canvas')).toHaveAttribute('data-pdf-page', String(expectedPage)); }
async function reviewed(page, number = 1) { await expect(page.locator('#protectionReview')).toBeVisible(); await expect(page.locator('#protectionCanvas canvas')).toHaveAttribute('data-pdf-page', String(number)); await expect(page.locator('#useProtectionResultBtn')).toBeEnabled(); }

test('compact document details keep exact names keyboard accessible and refresh after history and Clear', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const original = await fixture('Original İstanbul ' + 'uzun-belge-adı_'.repeat(25) + '.pdf', 'ORIGINAL DETAILS');
  const current = await fixture('Current İstanbul ' + 'başka-belge-adı_'.repeat(25) + '.pdf', 'CURRENT DETAILS');
  const errors = [], nonGet = [], vendor = []; page.on('pageerror', error => errors.push(error.name)); page.on('request', request => { if (request.method() !== 'GET') nonGet.push(request.method()); if (request.url().includes('/vendor/pdfstudio-0.4.0/')) vendor.push(request.url()); });
  await page.goto('/protect');
  const seed = await page.evaluate(async ({ original, current }) => {
    const ui = await import('/js/tool-ui.js'); await ui.ensureDocumentSession();
    ui.documentSession.begin(Uint8Array.from(original.bytes), original.name, { capabilities: { encrypted: false, forms: true } });
    ui.documentSession.adopt(Uint8Array.from(current.bytes), current.name, { capabilities: { encrypted: false, forms: true } }); ui.documentSession.setSelection([1]);
    const accepted = ui.documentSession.current(), descriptor = await ui.stashForChain(accepted.bytes, accepted.name, 'protect', accepted);
    return { workflowId: descriptor.workflowId, fileId: descriptor.fileId, originalDisplayName: ui.documentSession.original().displayName, currentDisplayName: accepted.displayName, taskId: ui.documentSession.snapshot().taskId };
  }, { original: { name: original.name, bytes: [...original.buffer] }, current: { name: current.name, bytes: [...current.buffer] } });
  await page.goto(`/protect?workflow=${encodeURIComponent(seed.workflowId)}&file=${encodeURIComponent(seed.fileId)}`); await ready(page, 2);
  const details = page.locator('#protectionDocumentDetails'), summary = page.locator('#protectionDocumentSummary');
  expect(seed.originalDisplayName).toHaveLength(260); expect(seed.currentDisplayName).toHaveLength(260);
  const names = async expectedCurrent => {
    await expect(page.locator('#protectionCurrentName')).toHaveText(expectedCurrent); await expect(page.locator('#protectionCurrentName')).toHaveAttribute('title', expectedCurrent); await expect(page.locator('#protectionCurrentName')).toHaveAttribute('aria-label', expectedCurrent);
    await expect(summary).toHaveAttribute('aria-label', 'Document details. Current: ' + expectedCurrent);
    expect(await details.evaluate(element => element.open)).toBe(false); await expect(page.locator('#documentIdentity')).toBeHidden();
    await summary.focus(); await summary.press('Enter'); await expect(details).toHaveAttribute('open', '');
    await expect(page.locator('#documentIdentity')).toBeVisible(); expect(await page.locator('#documentIdentity').evaluate(element => element.parentElement.id)).toBe('protectionDocumentDetails');
    await expect(page.locator('#documentIdentity .document-identity-name').nth(0)).toHaveText(seed.originalDisplayName); await expect(page.locator('#documentIdentity .document-identity-name').nth(1)).toHaveText(expectedCurrent);
    await expect(page.locator('#protectionInputIdentity')).toBeHidden(); await summary.press('Enter'); expect(await details.evaluate(element => element.open)).toBe(false);
  };
  await names(seed.currentDisplayName); const before = await state(page); expect(before.current).toBe(hash(current.buffer)); expect(before.original).toBe(hash(original.buffer));
  const layout = await page.evaluate(() => { const canvas = document.getElementById('protectionCanvas'), form = document.getElementById('protectionFields'), name = document.getElementById('protectionCurrentName'); return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, previewBeforeForm: !!(canvas.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING), previewTop: canvas.getBoundingClientRect().top, formTop: form.getBoundingClientRect().top, nameClipped: name.scrollWidth > name.clientWidth, textOverflow: getComputedStyle(name).textOverflow, overflowControls: [...document.querySelectorAll('#protectionWorkspace button, #protectionWorkspace input, #protectionWorkspace select')].filter(element => element.getClientRects().length).map(element => element.getBoundingClientRect()).filter(rect => rect.left < -.5 || rect.right > innerWidth + .5).length }; });
  expect(layout.scrollWidth).toBeLessThanOrEqual(321); expect(layout.previewBeforeForm).toBe(true); expect(layout.previewTop).toBeLessThan(layout.formTop); expect(layout.nameClipped).toBe(true); expect(layout.textOverflow).toBe('ellipsis'); expect(layout.overflowControls).toBe(0);
  await page.click('#undoProtectionBtn'); await ready(page, 2); await names(seed.originalDisplayName); expect((await state(page)).current).toBe(hash(original.buffer));
  await page.click('#redoProtectionBtn'); await ready(page, 2); await names(seed.currentDisplayName); expect((await state(page)).current).toBe(before.current);
  await page.click('#originalProtectionBtn'); await ready(page, 2); await names(seed.originalDisplayName); expect((await state(page)).original).toBe(before.original); expect((await state(page)).snapshot.taskId).toBe(seed.taskId);
  await summary.focus(); await summary.press('Enter'); await expect(details).toHaveAttribute('open', ''); await page.click('#clearProtectionBtn');
  await expect(details).toBeHidden(); expect(await details.evaluate(element => element.open)).toBe(false); await expect(page.locator('#documentIdentity')).toHaveCount(0); await expect(page.locator('#protectionInputIdentity')).toHaveText(''); await expect(summary).not.toContainText(seed.originalDisplayName); await expect(summary).not.toContainText(seed.currentDisplayName); expect((await state(page)).current).toBe(null);
  await page.setInputFiles('#fileInput', await fixture('AfterClear.pdf')); await ready(page); await expect(details).toBeVisible(); expect(await details.evaluate(element => element.open)).toBe(false); await expect(page.locator('#protectionCurrentName')).toHaveText('AfterClear.pdf'); expect((await state(page)).snapshot.taskId).not.toBe(seed.taskId); expect(errors).toEqual([]); expect(nonGet).toEqual([]); expect(vendor).toEqual([]);
});

test('Protect reviews the actual encrypted selected page, adopts only on Use and downloads manually', async ({ page }, info) => {
  const errors = [], nonGet = [], downloads = [], vendor = []; page.on('pageerror', error => errors.push(error.name)); page.on('download', value => downloads.push(value)); page.on('request', request => { if (request.method() !== 'GET') nonGet.push(request.method()); if (request.url().includes('/vendor/pdfstudio-0.4.0/')) vendor.push(request.url()); });
  const source = await fixture(); await page.goto('/protect'); expect(vendor).toEqual([]); await page.setInputFiles('#fileInput', source); await ready(page); expect(vendor).toEqual([]);
  await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.setSelection([1])); const before = await state(page); await secrets(page); await page.click('#protectBtn'); await reviewed(page, 2); expect((await state(page)).current).toBe(before.current); expect(downloads).toHaveLength(0);
  await page.click('#nextProtectionPageBtn'); await expect(page.locator('#protectionCanvas canvas')).toHaveAttribute('data-pdf-page', '2');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadProtectionResultBtn')]); const path = info.outputPath('reviewed-protected.pdf'); await download.saveAs(path); const bytes = await readFile(path);
  const actual = await page.evaluate(async data => { const runtime = await import('/js/lib-loader.js'), pdfjs = await runtime.ensurePdfJs(), task = pdfjs.getDocument({ data: Uint8Array.from(data), password: document.getElementById('passwordInput').value, ...runtime.PDFJS_ASSET_URLS }); try { const doc = await task.promise, page = await doc.getPage(2), viewport = page.getViewport({ scale: 1.5 }), canvas = document.createElement('canvas'); canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height); await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; return { text: (await page.getTextContent()).items.map(x => x.str).join(' '), pixels: canvas.toDataURL() === document.querySelector('#protectionCanvas canvas').toDataURL() }; } finally { await task.destroy(); } }, [...bytes]); expect(actual.text).toContain('PROTECT RETAIN 2'); expect(actual.pixels).toBe(true);
  await page.click('#useProtectionResultBtn'); const chosen = await state(page); expect(chosen.current).toBe(hash(bytes)); expect(chosen.original).toBe(before.original); expect(chosen.snapshot.taskId).toBe(before.snapshot.taskId); expect(chosen.snapshot.current.capabilities.encrypted).toBe(true); expect(chosen.snapshot.canUndo).toBe(true); await expect(page.locator('#chainRow button')).toHaveCount(1); await expect(page.locator('#chainRow button')).toHaveText('Unlock');
  await page.click('#previousProtectionPageBtn'); await expect(page.locator('#protectionCanvas canvas')).toHaveAttribute('data-pdf-page', '1'); await page.click('#undoProtectionBtn'); await ready(page, 2); expect((await state(page)).current).toBe(before.current); expect((await state(page)).original).toBe(before.original); expect(errors).toEqual([]); expect(nonGet).toEqual([]);
});
test('prior and actual scene-baking disclosures survive Protect Use, history, Unlock handoff and Reader', async ({ page }) => {
  const errors = [], nonGet = [], downloads = [];
  page.on('pageerror', error => errors.push(error.name)); page.on('request', request => { if (request.method() !== 'GET') nonGet.push(request.method()); }); page.on('download', item => downloads.push(item));
  const source = await fixture('Disclosure-source.pdf'); await page.goto('/protect');
  const prior = { kind: 'pdf-rewrite', losses: ['structure-inspection-incomplete', 'signature-rewrite'] };
  const expected = { kind: 'pdf-rewrite', losses: [...prior.losses, 'scene-baked'] };
  const handoff = await page.evaluate(async ({ data, prior }) => {
    const ui = await import('/js/tool-ui.js'); await ui.ensureDocumentSession();
    ui.documentSession.begin(Uint8Array.from(data), 'Disclosure-source.pdf', { boundary: prior, capabilities: { encrypted: false, forms: true, searchable: true } });
    ui.documentSession.beginScene(); const scene = ui.documentSession.scene(); scene.fields.retained = { kind: 'text', value: 'BAKED DISCLOSURE FIELD' }; ui.documentSession.changeScene(scene);
    const current = ui.documentSession.current(), descriptor = await ui.stashForChain(current.bytes, current.name, 'protect', current);
    return { workflowId: descriptor.workflowId, fileId: descriptor.fileId, taskId: ui.documentSession.snapshot().taskId };
  }, { data: [...source.buffer], prior });
  await page.goto(`/protect?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`); await ready(page);
  const visible = async selector => {
    await expect(page.locator(selector)).toBeVisible(); await expect(page.locator(selector + ' li')).toHaveCount(3);
    await expect(page.locator(selector)).toContainText('Some document structures could not be inspected.');
    await expect(page.locator(selector)).toContainText('digital signatures'); await expect(page.locator(selector)).toContainText('pending edits');
    for (const code of expected.losses) await expect(page.locator(selector)).not.toContainText(code);
  };
  await visible('#protectionCurrentLosses'); const before = await state(page); expect(before.original).toBe(hash(source.buffer)); expect(before.snapshot.current.boundary).toEqual(prior);
  // The credential is owned only by this test operation and live route input.
  // Traces/screenshots/video stay disabled; it never enters a handoff or report.
  let credential;
  try {
    await secrets(page); credential = await page.locator('#passwordInput').inputValue(); await page.click('#protectBtn'); await reviewed(page); await visible('#protectionResultLosses');
    expect((await state(page)).snapshot.current.boundary).toEqual(prior); await page.click('#useProtectionResultBtn'); await visible('#protectionCurrentLosses');
    let current = await state(page); expect(current.snapshot.current.boundary).toEqual(expected); expect(current.original).toBe(before.original); expect(current.snapshot.taskId).toBe(handoff.taskId);
    await page.click('#undoProtectionBtn'); await ready(page); await visible('#protectionCurrentLosses'); expect((await state(page)).snapshot.current.boundary).toEqual(prior);
    expect(await page.evaluate(async () => (await import('/js/tool-ui.js')).documentSession.scene().fields.retained.value)).toBe('BAKED DISCLOSURE FIELD');
    await page.click('#redoProtectionBtn'); await expect(page.locator('#protectionStatus')).toContainText('protected'); await visible('#protectionCurrentLosses');
    await Promise.all([page.waitForURL(/\/unlock\?/), page.locator('#chainRow').getByRole('button', { name: 'Unlock', exact: true }).click()]);
    await expect(page.locator('#protectionStatus')).toContainText('current task is retained'); expect((await state(page)).current).toBe(null);
    await page.evaluate(value => { const input = document.getElementById('passwordInput'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, credential);
    await page.click('#unlockBtn'); await expect(page.locator('#useProtectionResultBtn')).toBeEnabled(); await visible('#protectionCurrentLosses'); await visible('#protectionResultLosses');
    await expect(page.locator('#passwordInput')).toHaveValue(''); current = await state(page); expect(current.snapshot.current.capabilities.encrypted).toBe(true); expect(current.snapshot.current.boundary).toEqual(expected);
    await page.click('#useProtectionResultBtn'); await visible('#protectionCurrentLosses'); const unlocked = await state(page); expect(unlocked.snapshot.current.boundary).toEqual(expected); expect(unlocked.original).toBe(before.original); expect(unlocked.snapshot.taskId).toBe(handoff.taskId);
    const actual = await page.evaluate(async () => { const ui = await import('/js/tool-ui.js'), runtime = await import('/js/lib-loader.js'), lib = await runtime.ensurePdfLib(), current = ui.documentSession.current(), parsed = await lib.PDFDocument.load(current.bytes, { updateMetadata: false }); return { field: parsed.getForm().getTextField('retained').getText(), originalBoundary: ui.documentSession.original().boundary, protectedHistoryBoundary: ui.documentSession.historyTarget('undo').artifact.boundary }; });
    expect(actual).toEqual({ field: 'BAKED DISCLOSURE FIELD', originalBoundary: prior, protectedHistoryBoundary: expected });
    expect(await page.evaluate(value => !JSON.stringify((document.URL)).includes(value), credential)).toBe(true);
    await Promise.all([page.waitForURL(/\/view-pdf\?/), page.locator('#chainRow').getByRole('button', { name: 'Reader', exact: true }).click()]);
    await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#readerTextLayer')).toContainText('PROTECT RETAIN 1');
    const reader = await state(page); expect(reader.current).toBe(unlocked.current); expect(reader.original).toBe(before.original); expect(reader.snapshot.taskId).toBe(handoff.taskId); expect(reader.snapshot.current.boundary).toEqual(expected); expect(reader.snapshot.original.boundary).toEqual(prior);
    expect(await page.evaluate(async value => !JSON.stringify((await import('/js/tool-ui.js')).documentSession.snapshot()).includes(value), credential)).toBe(true);
    expect(downloads).toHaveLength(0); expect(errors).toEqual([]); expect(nonGet).toEqual([]);
  } finally { credential = undefined; }
});
test('show/hide, confirmation, ASCII compatibility and edits invalidate every old result action', async ({ page }) => {
  await page.goto('/protect'); await page.setInputFiles('#fileInput', await fixture()); await ready(page);
  await page.fill('#passwordInput', 'synthetic-a'); await page.fill('#confirmInput', 'synthetic-b'); await page.click('#passwordInputShow'); await expect(page.locator('#passwordInput')).toHaveAttribute('type', 'text'); await expect(page.locator('#passwordInputShow')).toHaveAttribute('aria-pressed', 'true'); await page.click('#passwordInputShow'); await expect(page.locator('#passwordInput')).toHaveAttribute('type', 'password');
  await page.click('#protectBtn'); await expect(page.locator('#protectionCredentialError')).toContainText('do not match'); expect((await state(page)).snapshot.revision).toBe(0);
  await page.selectOption('#protectionAlgorithm', 'aes128'); await page.fill('#passwordInput', 'é'); await page.fill('#confirmInput', 'é'); await page.click('#protectBtn'); await expect(page.locator('#protectionCredentialError')).toContainText('ASCII');
  await secrets(page); await page.selectOption('#protectionPrinting', 'none'); await page.selectOption('#protectionModifying', 'form'); await page.selectOption('#protectionExtraction', 'no'); await page.click('#protectBtn'); await reviewed(page);
  await page.fill('#ownerInput', 'synthetic-owner-edit'); await expect(page.locator('#protectionReview')).toBeHidden(); await expect(page.locator('#downloadProtectionResultBtn')).toBeDisabled(); await expect(page.locator('#useProtectionResultBtn')).toBeDisabled(); await expect(page.locator('#chainRow')).toBeHidden(); expect((await state(page)).snapshot.current.capabilities.encrypted).toBe(false);
  await page.click('#clearProtectionBtn'); await expect(page.locator('#passwordInput')).toHaveValue(''); await expect(page.locator('#confirmInput')).toHaveValue(''); await expect(page.locator('#ownerInput')).toHaveValue(''); expect((await state(page)).current).toBe(null);
});
test('held native File read keeps A, discards B for C, and Clear prevents stale acceptance', async ({ page }) => {
  await page.goto('/protect'); const a = await fixture('A.pdf', 'A'), b = await fixture('B.pdf', 'B'), c = await fixture('C.pdf', 'C'); await page.setInputFiles('#fileInput', a); await ready(page); const before = await state(page);
  await page.evaluate(() => { const native = File.prototype.arrayBuffer, state = window.__protectionRead = { reads: [], release: null }; const hold = new Promise(resolve => state.release = resolve); File.prototype.arrayBuffer = async function () { state.reads.push(this.name); const value = await native.call(this); if (this.name === 'B.pdf') await hold; return value; }; });
  await page.setInputFiles('#fileInput', b); await expect.poll(() => page.evaluate(() => window.__protectionRead.reads)).toEqual(['B.pdf']); await page.setInputFiles('#fileInput', c); expect((await state(page)).current).toBe(before.current); expect(await page.evaluate(() => window.__protectionRead.reads)).toEqual(['B.pdf']); await page.evaluate(() => window.__protectionRead.release()); await ready(page); await expect(page.locator('#protectionInputIdentity')).toHaveText('C.pdf'); expect(await page.evaluate(() => window.__protectionRead.reads)).toEqual(['B.pdf', 'C.pdf']);
  await page.evaluate(() => { window.__protectionRead.release = null; const native = File.prototype.arrayBuffer; const hold = new Promise(resolve => window.__protectionRead.release = resolve); File.prototype.arrayBuffer = async function () { const value = await native.call(this); if (this.name === 'B.pdf') await hold; return value; }; });
  await page.setInputFiles('#fileInput', b); await expect.poll(() => page.evaluate(() => window.__protectionRead.reads.filter(name => name === 'B.pdf').length)).toBe(2); await page.click('#clearProtectionBtn'); await page.evaluate(() => window.__protectionRead.release()); await expect.poll(async () => (await state(page)).current).toBe(null); await expect(page.locator('#protectionCanvas canvas')).toHaveCount(0);
  await page.setInputFiles('#fileInput', a); await ready(page); await expect(page.locator('#protectionInputIdentity')).toHaveText('A.pdf');
});
test('native-phase Cancel drains the engine before a successful reviewed successor', async ({ page }) => {
  const source = await fixture(), errors = []; page.on('pageerror', error => errors.push(error.name)); await page.goto('/protect'); await page.setInputFiles('#fileInput', source); await ready(page); const before = await state(page);
  await page.evaluate(() => {
    const Native = Worker, state = window.__protectionWorker = { active: 0, maximum: 0, terminations: 0, abortNext: true, nativeObserved: false };
    window.Worker = class extends Native {
      constructor(url, options) { super(url, options); this.protectionOwned = String(url).includes('/pdf-protection-worker.js'); this.stopped = false; if (this.protectionOwned) { state.active++; state.maximum = Math.max(state.maximum, state.active); this.addEventListener('message', event => { if (event.data?.type === 'phase' && event.data.phase === 'native' && state.abortNext) { state.nativeObserved = true; state.abortNext = false; document.getElementById('cancelProtectionBtn').click(); } }); } }
      terminate() { const result = super.terminate(); if (this.protectionOwned && !this.stopped) { this.stopped = true; state.active--; state.terminations++; } return result; }
    };
  });
  await secrets(page); await page.click('#protectBtn'); await expect.poll(() => page.evaluate(() => window.__protectionWorker.nativeObserved)).toBe(true); await ready(page); await expect(page.locator('#protectionReview')).toBeHidden(); expect((await state(page)).current).toBe(before.current);
  await secrets(page); await page.click('#protectBtn'); await reviewed(page); expect(await page.evaluate(() => { const state = window.__protectionWorker; return { active: state.active, maximum: state.maximum, terminations: state.terminations }; })).toEqual({ active: 0, maximum: 1, terminations: 2 }); expect(errors).toEqual([]);
});
