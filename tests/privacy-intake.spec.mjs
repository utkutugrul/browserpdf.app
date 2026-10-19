import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const sha = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
async function source(label, count = 2) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica); doc.setTitle(label);
  for (let index = 1; index <= count; index++) doc.addPage([400, 500]).drawText(`${label} PAGE ${index}`, { x: 30, y: 400, font, size: 15 });
  return { name: `${label}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}
async function open(page) { await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected')); await page.goto('/privacy-scan'); }
async function snapshot(page) {
  return page.evaluate(async () => {
    const ui = await import(new URL('./tool-ui.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href), transfer = ui.documentSession.transfer();
    const digest = async (value) => value ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', value.bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('') : null;
    return { snapshot: ui.documentSession.snapshot(), currentSHA: await digest(transfer.current), originalSHA: await digest(transfer.original), history: await Promise.all(transfer.history.map(async (value) => ({ name: value.name, boundary: value.boundary, capabilities: value.capabilities, sha: await digest(value) }))) };
  });
}
async function observeScan(page) {
  await page.route('**/js/core/privacy-scan.js', async (route) => {
    const response = await route.fetch(), body = await response.text();
    expect(body).toContain('export async function scanPdfPrivacy(');
    await route.fulfill({ response, body: body.replace('export async function scanPdfPrivacy(', 'async function observedNativeScan(') + `
export async function scanPdfPrivacy(bytes, options) {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const value = await observedNativeScan(bytes, options);
  (window.privacyObservedScans ||= []).push({ hash, length: bytes.length, pageCount: value.pageCount, encryption: value.encryption });
  if (window.holdPrivacyScan) { window.privacyScanHeld = true; await new Promise(resolve => { window.releasePrivacyScan = resolve; }); }
  return value;
}
` });
  });
}
async function scan(page) { await expect(page.locator('#scanBtn')).toBeEnabled(); await page.click('#scanBtn'); await expect(page.locator('#scanResults')).toBeVisible(); await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'false'); }
async function seed(page, original, chosen) {
  return page.evaluate(async ({ original, chosen }) => {
    const ui = await import(new URL('./tool-ui.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href); await ui.ensureDocumentSession();
    ui.documentSession.begin(Uint8Array.from(original), 'ORIGINAL retained.pdf', { type: 'application/pdf', capabilities: { searchable: true, forms: false } });
    ui.documentSession.adopt(Uint8Array.from(chosen), 'CHOSEN clean.pdf', { type: 'application/pdf', capabilities: { searchable: false, rasterized: true, encrypted: false, forms: false }, boundary: { kind: 'raster-redaction', losses: ['redaction-selected-pages-rasterized', 'redaction-metadata-removed'] } });
    const current = ui.documentSession.current(), handoff = await ui.stashForChain(current.bytes, current.name, 'privacy-scan', current);
    return { workflowId: handoff.workflowId, fileId: handoff.fileId, snapshot: ui.documentSession.snapshot() };
  }, { original: [...original.buffer], chosen: [...chosen.buffer] });
}
const url = (handoff) => `/privacy-scan?workflow=${handoff.workflowId}&file=${encodeURIComponent(handoff.fileId)}`;

test('Privacy restores exact chosen bytes and inherited facts while malformed and invalid inherited candidates retain the good report/task', async ({ page }) => {
  await observeScan(page); await open(page); const original = await source('RETAINED ORIGINAL SECRET', 1), chosen = await source('CHOSEN CLEAN');
  const handoff = await seed(page, original, chosen); await page.goto(url(handoff)); await scan(page);
  const good = await snapshot(page); expect(good.snapshot.taskId).toBe(handoff.workflowId); expect(good.currentSHA).toBe(sha(chosen.buffer)); expect(good.originalSHA).toBe(sha(original.buffer));
  expect(good.snapshot.current.capabilities).toEqual(handoff.snapshot.current.capabilities); expect(good.snapshot.current.boundary).toEqual(handoff.snapshot.current.boundary); expect(good.history).toHaveLength(1);
  expect((await page.evaluate(() => window.privacyObservedScans)).at(-1)).toMatchObject({ hash: sha(chosen.buffer), pageCount: 2 });
  const report = await page.locator('#scanResults').textContent(), goodURL = page.url();
  await page.setInputFiles('#fileInput', { name: 'malformed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nnot a PDF graph') });
  await expect(page.locator('#errorSection')).toBeVisible(); await expect(page.locator('#scanBtn')).toBeEnabled(); expect(await snapshot(page)).toEqual(good); expect(page.url()).toBe(goodURL); expect(await page.locator('#scanResults').textContent()).toBe(report); await expect(page.locator('#selectedFileName')).toHaveText('CHOSEN clean.pdf');
  const rejected = await page.evaluate(async (values) => {
    const entry = document.querySelector('script[src$="js/privacy-scan.js"]'), ui = await import(new URL('./tool-ui.js', entry.src).href), { createPrivacyIntake } = await import(new URL('./privacy-scan-intake.js', entry.src).href);
    const file = new File([Uint8Array.from(values)], 'invalid-inherited.pdf', { type: 'application/pdf' }); Object.defineProperty(file, 'browserpdfSession', { value: { scene: { version: 1, sourceRef: 'source-missing', objects: [], fields: {}, flatten: false }, resources: [] } });
    try { await createPrivacyIntake().stage(file, { isCurrent: () => true, expectedOwner: ui.documentSession.snapshot() }); return 'accepted'; } catch (error) { return error.message; }
  }, [...chosen.buffer]);
  expect(rejected).toMatch(/resource.*missing/i); expect(await snapshot(page)).toEqual(good); expect(await page.locator('#scanResults').textContent()).toBe(report);
});

for (const action of ['new native B', 'native Clear']) test(`held initial Privacy READ loses to ${action} before any late A File read`, async ({ page }) => {
  await observeScan(page); await open(page); const original = await source('OLD ORIGINAL A', 1), chosen = await source('OLD CHOSEN A', 1), newer = await source('NEW NATIVE B'); const handoff = await seed(page, original, chosen);
  await page.route('**/js/tool-ui.js', async (route) => {
    const response = await route.fetch(), body = await response.text();
    await route.fulfill({ response, body: body.replace('export async function takeChainedFile()', 'async function observedNativeTake()') + '\nexport async function takeChainedFile() { try { return await observedNativeTake(); } finally { window.privacyInitialReturned = true; } }\n' });
  });
  await page.addInitScript(() => {
    window.privacyOldFileReads = 0; const read = File.prototype.arrayBuffer; File.prototype.arrayBuffer = function () { if (this.name === 'CHOSEN clean.pdf') window.privacyOldFileReads++; return read.call(this); };
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete'); let first = true;
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { configurable: true, enumerable: descriptor.enumerable, get: descriptor.get, set(handler) {
      const tx = this;
      if (first && tx.db.name === 'browserpdf-workflows' && tx.mode === 'readonly' && [...tx.objectStoreNames].includes('workflows')) { first = false; descriptor.set.call(tx, function (event) { window.privacyInitialHeld = true; window.releasePrivacyInitial = () => handler.call(tx, event); }); }
      else descriptor.set.call(tx, handler);
    } });
  });
  await page.goto(url(handoff)); await expect.poll(() => page.evaluate(() => window.privacyInitialHeld)).toBe(true); await expect(page.locator('#clearBtn')).toBeEnabled(); await expect(page.locator('#fileInput')).toBeEnabled();
  if (action === 'new native B') { await page.setInputFiles('#fileInput', newer); await scan(page); }
  else { await page.click('#clearBtn'); await expect(page.locator('#selectedFile')).toBeHidden(); await expect(page.locator('#progressSection')).not.toBeVisible(); }
  const before = await snapshot(page); expect(page.url()).toMatch(/\/privacy-scan$/); if (action === 'new native B') expect(before.currentSHA).toBe(sha(newer.buffer)); else expect(before.snapshot.taskId).toBeNull();
  await page.evaluate(() => window.releasePrivacyInitial()); await expect.poll(() => page.evaluate(() => window.privacyInitialReturned)).toBe(true);
  expect(await snapshot(page)).toEqual(before); expect(await page.evaluate(() => window.privacyOldFileReads)).toBe(0);
  if (action === 'new native B') { await expect(page.locator('#selectedFileName')).toHaveText(newer.name); expect((await page.evaluate(() => window.privacyObservedScans)).at(-1)).toMatchObject({ hash: sha(newer.buffer), pageCount: 2 }); }
  else { await expect(page.locator('#scanBtn')).toBeDisabled(); await expect(page.locator('#errorSection')).not.toBeVisible(); }
});

test('native locked PDF intake admits proved encryption while keeping unknown capabilities unknown', async ({ page }) => {
  await observeScan(page); await open(page);
  const bytes = await page.evaluate(async () => {
    const runtime = await import(new URL('./lib-loader.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href), lib = await runtime.ensureCantooPdfLib(), doc = await lib.PDFDocument.create(); doc.addPage([400, 500]); doc.encrypt({ userPassword: 'fixture-lock', ownerPassword: 'fixture-owner' }); return [...await doc.save()];
  });
  await page.setInputFiles('#fileInput', { name: 'locked.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) }); await scan(page);
  expect((await snapshot(page)).snapshot.current.capabilities).toEqual({ encrypted: true }); expect((await page.evaluate(() => window.privacyObservedScans)).at(-1).encryption).toEqual({ encrypted: true, locked: true }); await expect(page.locator('#cleanupPanel')).toBeHidden(); await expect(page.locator('#errorSection')).not.toBeVisible();
});

test('Privacy drains a canceled actual File read and admits only the latest pending native choice with Clear recovery', async ({ page }) => {
  await observeScan(page); await open(page); const a = await source('HELD A'), b = await source('SKIPPED B'), c = await source('LATEST C');
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer; window.privacyReadNames = [];
    File.prototype.arrayBuffer = async function () { window.privacyReadNames.push(this.name); if (this.name === 'HELD A.pdf') { window.privacyLocalReadHeld = true; await new Promise((resolve) => { window.releasePrivacyLocalRead = resolve; }); } return read.call(this); };
  });
  await page.setInputFiles('#fileInput', a); await expect.poll(() => page.evaluate(() => window.privacyLocalReadHeld)).toBe(true);
  await page.setInputFiles('#fileInput', b); await page.setInputFiles('#fileInput', c); expect(await page.evaluate(() => window.privacyReadNames)).toEqual([a.name]); await expect(page.locator('#clearBtn')).toBeEnabled();
  await page.evaluate(() => window.releasePrivacyLocalRead()); await scan(page); expect(await page.evaluate(() => window.privacyReadNames)).toEqual([a.name, c.name]); expect((await snapshot(page)).currentSHA).toBe(sha(c.buffer));
  await page.setInputFiles('#fileInput', a); await expect.poll(() => page.evaluate(() => window.privacyReadNames.length)).toBe(3); await page.click('#clearBtn'); await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => window.releasePrivacyLocalRead()); await page.setInputFiles('#fileInput', c); await scan(page); expect((await snapshot(page)).currentSHA).toBe(sha(c.buffer)); await expect(page.locator('#errorSection')).not.toBeVisible();
});

test('failed optional Privacy intake import is retryable by a new native choice', async ({ page }) => {
  let first = true; await page.route('**/js/privacy-scan-intake.js*', async (route) => { if (first) { first = false; await route.abort('failed'); } else await route.continue(); });
  await open(page); const file = await source('RETRY'); await page.setInputFiles('#fileInput', file); await expect(page.locator('#errorSection')).toBeVisible(); expect((await snapshot(page)).snapshot.taskId).toBeNull(); await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'false');
  await page.setInputFiles('#fileInput', file); await scan(page); expect((await snapshot(page)).currentSHA).toBe(sha(file.buffer)); await expect(page.locator('#errorSection')).not.toBeVisible();
});

test('same-task canonical invalidation rejects held scan and cleanup publication while recovering native controls without rebasing', async ({ page }) => {
  await observeScan(page);
  await page.route('**/js/core/privacy-cleanup.js', async (route) => {
    const response = await route.fetch(), body = await response.text();
    await route.fulfill({ response, body: body.replace('export async function cleanPdfPrivacy(', 'async function observedNativeCleanup(') + '\nexport async function cleanPdfPrivacy(...args) { const value = await observedNativeCleanup(...args); if (window.holdPrivacyCleanup) { window.privacyCleanupHeld = true; await new Promise(resolve => { window.releasePrivacyCleanup = resolve; }); } return value; }\n' });
  });
  await open(page); const file = await source('OWNED'); await page.setInputFiles('#fileInput', file); await expect(page.locator('#scanBtn')).toBeEnabled();
  await page.evaluate(() => { window.holdPrivacyScan = true; }); await page.click('#scanBtn'); await expect.poll(() => page.evaluate(() => window.privacyScanHeld)).toBe(true);
  const invalidate = () => page.evaluate(async () => { const ui = await import(new URL('./tool-ui.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href); ui.documentSession.invalidate(); });
  await invalidate(); const newer = await snapshot(page); await page.evaluate(() => { window.holdPrivacyScan = false; window.releasePrivacyScan(); }); await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#scanResults')).toBeHidden(); await expect(page.locator('#scanBtn')).toBeDisabled(); expect(await snapshot(page)).toEqual(newer);
  await page.click('#clearBtn'); expect(await snapshot(page)).toEqual(newer);
  await page.setInputFiles('#fileInput', file); await scan(page); await page.check('#metadataCleanup'); await page.evaluate(() => { window.holdPrivacyCleanup = true; }); await page.click('#cleanupBtn'); await expect.poll(() => page.evaluate(() => window.privacyCleanupHeld)).toBe(true);
  await invalidate(); const later = await snapshot(page); await page.evaluate(() => window.releasePrivacyCleanup()); await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#successSection')).not.toBeVisible(); await expect(page.locator('#scanBtn')).toBeDisabled(); expect(await snapshot(page)).toEqual(later); await page.click('#clearBtn'); expect(await snapshot(page)).toEqual(later);
});

test('native cleanup retries a rejected optional import and downloads the actually verified clean PDF', async ({ page }, info) => {
  let first = true; await page.route('**/js/core/privacy-cleanup.js*', async (route) => { if (first) { first = false; await route.abort('failed'); } else await route.continue(); });
  const downloads = []; page.on('download', (download) => downloads.push(download));
  await open(page); const file = await source('CLEANUP RETRY'); await page.setInputFiles('#fileInput', file); await scan(page); await page.check('#metadataCleanup');
  const before = await snapshot(page), report = await page.locator('#scanResults').textContent();
  await page.click('#cleanupBtn'); await expect(page.locator('#errorSection')).toBeVisible(); await expect(page.locator('.privacy-scan-workspace')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#cleanupBtn')).toBeEnabled();
  expect(await snapshot(page)).toEqual(before); expect(await page.locator('#scanResults').textContent()).toBe(report); await expect(page.locator('#successSection')).not.toBeVisible(); expect(downloads).toHaveLength(0);
  await page.click('#cleanupBtn'); await expect(page.locator('#successSection')).toBeVisible(); await expect(page.locator('#downloadBtn')).toBeEnabled(); await expect(page.locator('#errorSection')).not.toBeVisible(); expect(await snapshot(page)).toEqual(before);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBtn')]), path = info.outputPath('retry-verified-metadata-cleaned.pdf'); await download.saveAs(path);
  const bytes = await readFile(path), pdf = await PDFDocument.load(bytes, { updateMetadata: false }); expect(pdf.getPageCount()).toBe(2); expect(pdf.getTitle()).toBeUndefined(); expect(sha(bytes)).not.toBe(sha(file.buffer)); expect(downloads).toHaveLength(1);
});
