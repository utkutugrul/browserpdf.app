import { test, expect } from '@playwright/test';
import * as lib from 'pdf-lib';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// Root supplies the existing server and an isolated configuration with its
// shared fixture writer disabled. This file generates no corpus on disk.
test.skip(process.env.BROWSERPDF_PRIVACY_NATIVE !== '1', 'Set BROWSERPDF_PRIVACY_NATIVE=1 in the exclusive Root native window.');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function source(label, { matches = false, name = `${label}.pdf`, blankInfo = false } = {}) {
  const doc = await lib.PDFDocument.create({ updateMetadata: false }), font = await doc.embedFont(lib.StandardFonts.Helvetica);
  for (let index = 0; index < 2; index++) {
    const page = doc.addPage([420, 340]); page.drawText(`${label} PAGE ${index + 1}`, { x: 30, y: 290, size: 15, font });
    if (matches) for (let line = 0; line < 30; line++) page.drawText(`qa${line}@example.test`, { x: 30, y: 265 - line * 8, size: 7, font });
    if (index === 1) { page.setCropBox(18.5, 21.25, 370, 290); page.setRotation(lib.degrees(90)); page.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(2)); }
  }
  doc.setTitle(label); doc.setAuthor('PRIVATE AUTHOR');
  const info = doc.context.lookup(doc.context.trailerInfo.Info); info.set(lib.PDFName.of('CustomPrivacy'), lib.PDFHexString.fromText('KEEP CUSTOM α'));
  if (blankInfo) { info.set(lib.PDFName.of('Title'), lib.PDFString.of('')); info.set(lib.PDFName.of('Author'), lib.PDFNull); info.set(lib.PDFName.of('Subject'), lib.PDFNumber.of(17)); }
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/">KEEP PRIVACY XMP</x:xmpmeta>';
  doc.catalog.set(lib.PDFName.of('Metadata'), doc.context.register(doc.context.flateStream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' })));
  const field = doc.getForm().createTextField('KEEP field'); field.setText('KEEP FORM VALUE'); field.addToPage(doc.getPages()[0], { x: 30, y: 30, width: 180, height: 20 });
  const annotation = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [30, 60, 160, 80], A: { Type: 'Action', S: 'URI', URI: lib.PDFString.of('https://example.test/never-follow-privacy') } });
  doc.getPages()[0].node.addAnnot(doc.context.register(annotation));
  await doc.attach(new TextEncoder().encode('KEEP ATTACHMENT PAYLOAD'), 'retained.txt', { mimeType: 'text/plain' });
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save({ updateFieldAppearances: false })) };
}
async function open(page, url = '/privacy-scan') { await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected')); await page.goto(url); await expect(page.locator('#dropzone')).toBeVisible(); }
async function ready(page) { await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#scanBtn')).toBeEnabled(); await expect(page.locator('#privacyCanvas')).toHaveAttribute('data-pdf-page', /\d+/); }
async function scan(page) { await ready(page); await page.click('#scanBtn'); await expect(page.locator('#scanResults')).toBeVisible(); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false'); }
async function prepare(page) { await page.check('#metadataCleanup'); await expect(page.locator('#cleanupBtn')).toBeEnabled(); await page.click('#cleanupBtn'); await expect(page.locator('#documentResultPreview canvas')).toHaveAttribute('data-pdf-page', /\d+/); await expect(page.locator('#documentResult')).not.toHaveAttribute('inert', ''); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false'); }
async function download(page, info, label) { const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBtn')]); const target = info.outputPath(label); await saved.saveAs(target); return new Uint8Array(await readFile(target)); }
async function use(page) { await page.click('#useResultBtn'); await expect(page.locator('#chainRow')).toBeVisible(); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#documentResult')).not.toHaveAttribute('inert', ''); }
async function state(page) {
  return page.evaluate(async () => {
    const ui = await import(new URL('./tool-ui.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href), transfer = ui.documentSession.transfer();
    const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    const jsonHash = value => digest(new TextEncoder().encode(JSON.stringify(value))), resources = new Map(transfer.resources.map(resource => [resource.id, resource]));
    const descriptor = value => ({ name: value.name, displayName: value.displayName, type: value.type, capabilities: value.capabilities, boundary: value.boundary });
    const entry = async value => value.scene ? { kind: 'scene', ...descriptor(value), sourceRef: value.sourceRef || value.scene.sourceRef, source: await digest(resources.get(value.sourceRef || value.scene.sourceRef).bytes), scene: await jsonHash(value.scene) } : { kind: value.composition ? 'composition' : 'artifact', ...descriptor(value), sha: await digest(value.bytes), composition: value.composition ? await jsonHash(value.composition) : null };
    return { snapshot: ui.documentSession.snapshot(), current: transfer.current ? await digest(transfer.current.bytes) : null, original: transfer.original ? await digest(transfer.original.bytes) : null,
      history: await Promise.all(transfer.history.map(entry)), future: await Promise.all(transfer.future.map(entry)), resources: await Promise.all(transfer.resources.map(async resource => ({ ...descriptor(resource), id: resource.id, sha: await digest(resource.bytes) }))), scene: transfer.scene ? await jsonHash(transfer.scene) : null };
  });
}
async function savedFacts(bytes) {
  const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false }), info = doc.context.lookup(doc.context.trailerInfo.Info);
  const names = doc.catalog.lookup(lib.PDFName.of('Names'), lib.PDFDict).lookup(lib.PDFName.of('EmbeddedFiles'), lib.PDFDict).lookup(lib.PDFName.of('Names'), lib.PDFArray);
  const attachment = names.lookup(1, lib.PDFDict).lookup(lib.PDFName.of('EF'), lib.PDFDict).lookup(lib.PDFName.of('F'), lib.PDFRawStream);
  const uri = [], appearances = [];
  for (const page of doc.getPages()) for (const ref of page.node.Annots()?.asArray() || []) {
    const annotation = doc.context.lookup(ref, lib.PDFDict), action = annotation.lookupMaybe(lib.PDFName.of('A'), lib.PDFDict);
    if (action?.has(lib.PDFName.of('URI'))) uri.push(action.lookup(lib.PDFName.of('URI')).decodeText());
    const appearance = annotation.lookupMaybe(lib.PDFName.of('AP'), lib.PDFDict)?.lookupMaybe(lib.PDFName.of('N'), lib.PDFRawStream);
    if (appearance) appearances.push(sha(lib.decodePDFRawStream(appearance).decode()));
  }
  return { keys: info.keys().map(key => key.toString()), custom: info.lookup(lib.PDFName.of('CustomPrivacy')).decodeText(), xmp: Buffer.from(lib.decodePDFRawStream(doc.catalog.lookup(lib.PDFName.of('Metadata'), lib.PDFRawStream)).decode()).toString(), field: doc.getForm().getTextField('KEEP field').getText(), attachment: { mime: attachment.dict.lookup(lib.PDFName.of('Subtype'), lib.PDFName).decodeText(), payload: sha(lib.decodePDFRawStream(attachment).decode()) }, uri, appearances, pages: doc.getPages().map(page => ({ crop: page.getCropBox(), rotation: page.getRotation().angle, unit: page.node.lookupMaybe(lib.PDFName.of('UserUnit'), lib.PDFNumber)?.asNumber() || 1 })) };
}
async function observeSaves(page) {
  await page.evaluate(async () => {
    const runtime = await import(new URL('./lib-loader.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href), lib = await runtime.ensurePdfLib(), save = lib.PDFDocument.prototype.save;
    window.privacySaves = 0;
    lib.PDFDocument.prototype.save = async function (...args) { const bytes = await save.apply(this, args); window.privacySaves++; window.privacySavedSHA = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join(''); if (window.privacyHoldSave) { window.privacySaveHeld = true; await new Promise(resolve => { window.releasePrivacySave = resolve; }); } return bytes; };
  });
}
async function reviewFault(page) {
  await page.route('**/js/document-result.js', async route => {
    const response = await route.fetch(), body = await response.text(), marker = "import { ensurePdfJs, ensureMammoth, ensureXlsx, PDFJS_ASSET_URLS } from './lib-loader.js';";
    expect(body).toContain(marker);
    await route.fulfill({ response, body: body.replace(marker, "import { ensurePdfJs as privacyNativePdfJs, ensureMammoth, ensureXlsx, PDFJS_ASSET_URLS } from './lib-loader.js';") + `
async function ensurePdfJs(...args) {
  const native = await privacyNativePdfJs(...args);
  return { ...native, getDocument(options) {
    const task = native.getDocument(options), mode = window.privacyReviewFault;
    window.privacyReviewFault = null; window.privacySharedLoads = (window.privacySharedLoads || 0) + 1;
    window.privacySharedActive = (window.privacySharedActive || 0) + 1; window.privacySharedMaximum = Math.max(window.privacySharedMaximum || 0, window.privacySharedActive);
    const promise = task.promise.then(async pdf => {
      if (mode === 'hold') { window.privacyReviewHeld = true; await new Promise(resolve => { window.releasePrivacyReview = resolve; }); }
      if (mode === 'load') throw new Error('Injected failure after actual Privacy result parse');
      if (mode === 'render') { const getPage = pdf.getPage.bind(pdf); pdf.getPage = async (...args) => { const page = await getPage(...args); return { getViewport: (...args) => page.getViewport(...args), render(...args) { const task = page.render(...args); return { promise: task.promise.then(() => { throw new Error('Injected failure after actual Privacy render'); }), cancel: (...args) => task.cancel(...args) }; } }; }; }
      return pdf;
    });
    let destroyed;
    return { promise, destroy() { destroyed ||= task.destroy().then(value => { window.privacySharedActive--; return value; }); return destroyed; } };
  } };
}
` });
  });
}
async function chain(page, slug) {
  const label = await page.evaluate(async slug => { const { t } = await import(new URL('./i18n.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href); return t('hub.tool_' + slug.replace(/-/g, '_'), slug === 'view-pdf' ? 'Reader' : slug === 'edit-metadata' ? 'Edit Metadata' : 'Document Doctor'); }, slug);
  await page.locator('#chainRow').getByRole('button', { name: label, exact: true }).click();
}
async function sourceNativeFault(page) {
  await page.route('**/js/privacy-workspace.js*', async route => {
    const response = await route.fetch(), body = await response.text(), marker = "import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';";
    expect(body).toContain(marker);
    await route.fulfill({ response, body: body.replace(marker, "import { ensurePdfJs as privacySourceNativePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';") + `
async function ensurePdfJs(...args) {
  const native = await privacySourceNativePdfJs(...args);
  return { ...native, getDocument(options) {
    const actual = native.getDocument(options), mode = window.privacySourceFault;
    window.privacySourceFault = null; window.privacySourceLoads = (window.privacySourceLoads || 0) + 1;
    const promise = actual.promise.then(async pdf => {
      if (mode === 'hold-load') { window.privacySourceHeld = true; await new Promise(resolve => { window.releasePrivacySource = resolve; }); }
      if (mode === 'hold-render') { const getPage = pdf.getPage.bind(pdf); pdf.getPage = async (...args) => { const page = await getPage(...args); return { getViewport: (...args) => page.getViewport(...args), render(...args) { const work = page.render(...args); return { promise: work.promise.then(async value => { window.privacySourceHeld = true; await new Promise(resolve => { window.releasePrivacySource = resolve; }); return value; }), cancel: (...args) => work.cancel(...args) }; } }; }; }
      return pdf;
    });
    let failed = false;
    return { promise, destroy() { if (mode === 'destroy' && !failed) { failed = true; window.privacyDestroyFirstRejected = true; return Promise.reject(new Error('Injected first actual handle destruction failure')); } return actual.destroy(); } };
  } };
}
` });
  });
}

test('actual affected-page review, explicit Download and Use preserve rich facts and send exact chosen PDF to Reader', async ({ page }, info) => {
  const file = await source('PRIVACY SOURCE'), facts = await savedFacts(file.buffer), downloads = []; page.on('download', value => downloads.push(value));
  const outbound = []; page.on('request', request => { if (request.url().includes('never-follow-privacy')) outbound.push(request.url()); });
  await open(page); await page.setInputFiles('#fileInput', file); await scan(page); const before = await state(page);
  await expect(page.locator('#findingList>li')).toHaveCount(13); await expect(page.locator('#privacyDetails>li')).toHaveCount(2); await expect(page.locator('#findingList')).toContainText('Document level');
  await page.click('#nextPageBtn'); await ready(page); await expect(page.locator('#privacyCanvas')).toHaveAttribute('data-pdf-page', '2');
  await prepare(page); await expect(page.locator('#documentResultPreview canvas')).toHaveAttribute('data-pdf-page', '2'); expect(downloads).toHaveLength(0); expect((await state(page)).current).toBe(before.current); await expect(page.locator('#chainRow')).toBeHidden();
  const bytes = await download(page, info, 'privacy-reviewed.pdf'), after = await savedFacts(bytes);
  for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate']) expect(after.keys).not.toContain('/' + key);
  expect(after.custom).toBe(facts.custom); expect(after.xmp).toBe(facts.xmp); expect(after.field).toBe(facts.field); expect(after.attachment).toEqual(facts.attachment); expect(after.uri).toEqual(facts.uri); expect(after.appearances).toEqual(facts.appearances); expect(after.pages).toEqual(facts.pages); await expect(page.locator('#privacyComparison')).toContainText('All eight standard keys are absent');
  await use(page); const chosen = await state(page); expect(chosen.current).toBe(sha(bytes)); expect(chosen.original).toBe(sha(file.buffer)); expect(chosen.snapshot.taskId).toBe(before.snapshot.taskId); expect(chosen.snapshot.current.boundary.losses).toContain('signature-rewrite');
  await chain(page, 'view-pdf'); await expect(page).toHaveURL(/view-pdf\?workflow=/);
  await expect.poll(() => page.evaluate(async () => { const ui = await import(new URL('./tool-ui.js', document.querySelector('script[src$="js/view-pdf.js"]').src).href); const current = ui.documentSession.current(); return current ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', current.bytes))].map(value => value.toString(16).padStart(2, '0')).join('') : null; })).toBe(sha(bytes)); expect(outbound).toEqual([]);
});
test('raw matches stay collapsed in 25-row page-local windows and zero is never used for unknown inspection', async ({ page }) => {
  await open(page); await page.setInputFiles('#fileInput', await source('SENSITIVE', { matches: true })); await scan(page);
  await expect(page.locator('#sensitiveDetails')).not.toHaveAttribute('open', ''); await expect(page.locator('#sensitiveMatches>li')).toHaveCount(25); await expect(page.locator('#privacyDetails>li')).toHaveCount(25);
  await page.locator('#sensitiveDetails summary').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#sensitiveDetails')).toHaveAttribute('open', ''); await expect(page.locator('#sensitiveMatches')).toContainText('qa0@example.test');
  await page.click('#rawNextBtn'); await expect(page.locator('#sensitiveMatches>li')).toHaveCount(5); await page.click('#nextPageBtn'); await ready(page); await expect(page.locator('#sensitiveDetails')).not.toHaveAttribute('open', '');
  const serialized = JSON.stringify(await state(page)); expect(serialized).not.toContain('qa0@example.test');
  await page.evaluate(async () => { const runtime = await import(new URL('./lib-loader.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href), ui = await import(new URL('./tool-ui.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href), task = (await runtime.ensurePdfJs()).getDocument({ data: ui.documentSession.current().bytes.slice(), ...runtime.PDFJS_ASSET_URLS }); try { const doc = await task.promise, page = await doc.getPage(1), prototype = Object.getPrototypeOf(page), native = prototype.getAnnotations; prototype.getAnnotations = async function (...args) { await native.apply(this, args); throw new Error('Injected actual annotation inspection failure'); }; } finally { await task.destroy(); } });
  await page.click('#scanBtn'); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#findingList')).toContainText('unknown'); await expect(page.locator('#privacyCoverage')).toContainText('lower bounds'); await expect(page.locator('#metadataCleanup')).toBeDisabled();
});
test('present blank, numeric and null Info values are eligible and really absent after cleanup', async ({ page }, info) => {
  await open(page); await page.setInputFiles('#fileInput', await source('RAW INFO', { blankInfo: true })); await scan(page); await prepare(page);
  const facts = await savedFacts(await download(page, info, 'raw-info-cleaned.pdf'));
  expect(facts.keys).not.toContain('/Title'); expect(facts.keys).not.toContain('/Author'); expect(facts.keys).not.toContain('/Subject'); expect(facts.keys).toContain('/CustomPrivacy'); await expect(page.locator('#privacyComparison')).toContainText('Title, Author, Subject');
});
test('malformed B retains A report, checked choice, owner and good URL', async ({ page }) => {
  await open(page); await page.setInputFiles('#fileInput', await source('GOOD A')); await scan(page); await page.check('#metadataCleanup'); const before = await state(page), report = await page.locator('#scanResults').textContent(), url = page.url();
  await page.setInputFiles('#fileInput', { name: 'BROKEN B.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 broken graph') }); await expect(page.locator('#errorSection')).toBeVisible(); await ready(page);
  expect(await state(page)).toEqual(before); expect(await page.locator('#scanResults').textContent()).toBe(report); await expect(page.locator('#metadataCleanup')).toBeChecked(); expect(page.url()).toBe(url);
});
test('first actual read drains before latest C; skipped B is never read and Clear suppresses stale publication', async ({ page }) => {
  await page.addInitScript(() => { const read = File.prototype.arrayBuffer; window.privacyReads = []; File.prototype.arrayBuffer = async function () { window.privacyReads.push(this.name); if (this.name === 'HELD A.pdf') { window.privacyReadHeld = true; await new Promise(resolve => { window.releasePrivacyRead = resolve; }); } return read.call(this); }; });
  await open(page); await page.setInputFiles('#fileInput', await source('HELD A')); await expect.poll(() => page.evaluate(() => window.privacyReadHeld)).toBe(true);
  await page.setInputFiles('#fileInput', await source('UNREAD B')); const c = await source('LATEST C'); await page.setInputFiles('#fileInput', c); expect(await page.evaluate(() => window.privacyReads)).toEqual(['HELD A.pdf']); await page.evaluate(() => window.releasePrivacyRead()); await ready(page); expect(await page.evaluate(() => window.privacyReads)).toEqual(['HELD A.pdf', 'LATEST C.pdf']); expect((await state(page)).current).toBe(sha(c.buffer));
  await page.setInputFiles('#fileInput', await source('HELD A')); await expect.poll(() => page.evaluate(() => window.privacyReads.length)).toBe(3); await page.click('#clearBtn'); await expect(page.locator('#scanResults')).toBeHidden(); await page.evaluate(() => window.releasePrivacyRead()); await page.setInputFiles('#fileInput', c); await ready(page); expect((await state(page)).current).toBe(sha(c.buffer));
});
for (const action of ['native B', 'Clear']) test(`completed initial handoff READ loses to ${action} before late A is read`, async ({ page }) => {
  await open(page); const old = await source('OLD INITIAL'), fresh = await source('NEW NATIVE');
  const handoff = await page.evaluate(async bytes => { const ui = await import(new URL('./tool-ui.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href); await ui.ensureDocumentSession(); ui.documentSession.begin(new Uint8Array(bytes), 'OLD INITIAL.pdf', { type: 'application/pdf' }); const value = await ui.stashForChain(new Uint8Array(bytes), 'OLD INITIAL.pdf', 'privacy-scan', { type: 'application/pdf' }); return { workflow: value.workflowId, file: value.fileId }; }, [...old.buffer]);
  await page.route('**/js/tool-ui.js', async route => { const response = await route.fetch(), body = await response.text(), marker = 'export async function takeChainedFile(options = {}) {'; expect(body).toContain(marker); await route.fulfill({ response, body: body.replace(marker, 'async function privacyObservedInitial(options = {}) {') + '\nexport async function takeChainedFile(...args) { try { const value = await privacyObservedInitial(...args); window.privacyInitialHeld = true; await new Promise(resolve => { window.releasePrivacyInitial = resolve; }); return value; } finally { window.privacyInitialSettled = true; } }\n' }); });
  await page.addInitScript(() => { const read = File.prototype.arrayBuffer; window.privacyOldReads = 0; File.prototype.arrayBuffer = function (...args) { if (this.name === 'OLD INITIAL.pdf') window.privacyOldReads++; return read.apply(this, args); }; });
  await page.goto(`/privacy-scan?workflow=${encodeURIComponent(handoff.workflow)}&file=${encodeURIComponent(handoff.file)}`); await expect.poll(() => page.evaluate(() => window.privacyInitialHeld)).toBe(true);
  if (action === 'native B') { await page.setInputFiles('#fileInput', fresh); await ready(page); } else { await page.click('#clearBtn'); await expect(page).toHaveURL(/\/privacy-scan$/); }
  const before = await state(page); await page.evaluate(() => window.releasePrivacyInitial()); await expect.poll(() => page.evaluate(() => window.privacyInitialSettled)).toBe(true); expect(await page.evaluate(() => window.privacyOldReads)).toBe(0); expect(await state(page)).toEqual(before);
  if (action === 'Clear') { await page.setInputFiles('#fileInput', fresh); await ready(page); } expect((await state(page)).current).toBe(sha(fresh.buffer));
});
for (const optional of ['privacy-workspace', 'privacy-scan-intake', 'core/privacy-cleanup']) test(`optional ${optional} rejection is retryable without accepting another task`, async ({ page }) => {
  let first = true; await page.route(`**/js/${optional}.js*`, async route => { if (first) { first = false; await route.abort('failed'); } else await route.continue(); });
  await open(page); const file = await source('OPTIONAL RETRY'); await page.setInputFiles('#fileInput', file);
  if (optional.endsWith('cleanup')) { await scan(page); await page.check('#metadataCleanup'); await page.click('#cleanupBtn'); }
  await expect(page.locator('#errorSection')).toBeVisible(); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false');
  if (optional.endsWith('cleanup')) { const before = await state(page); await page.click('#cleanupBtn'); await expect(page.locator('#documentResult')).not.toHaveAttribute('inert', ''); expect((await state(page)).current).toBe(before.current); }
  else { await page.setInputFiles('#fileInput', file); await ready(page); expect((await state(page)).current).toBe(sha(file.buffer)); }
});
test('initial held shared preview makes actual native Use and Download inert until positive readiness', async ({ page }) => {
  await reviewFault(page); await open(page); await page.setInputFiles('#fileInput', await source('HELD REVIEW')); await scan(page); const before = await state(page), downloads = []; page.on('download', value => downloads.push(value)); await observeSaves(page);
  await page.evaluate(() => { window.privacyReviewFault = 'hold'; }); await page.check('#metadataCleanup'); await page.click('#cleanupBtn'); await expect.poll(() => page.evaluate(() => window.privacyReviewHeld)).toBe(true); await expect(page.locator('#documentResult')).toHaveAttribute('inert', '');
  await page.locator('#documentResult').scrollIntoViewIfNeeded(); for (const id of ['downloadResultBtn', 'useResultBtn']) { const box = await page.locator(`#${id}`).boundingBox(); expect(box).not.toBeNull(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); }
  expect(await state(page)).toEqual(before); expect(downloads).toHaveLength(0); await page.evaluate(() => window.releasePrivacyReview()); await expect(page.locator('#documentResult')).not.toHaveAttribute('inert', ''); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false'); expect(await page.evaluate(() => window.privacySaves)).toBe(1);
});
for (const phase of ['initial', 'chosen']) for (const kind of ['load', 'render']) test(`${phase} ${kind} failure retains exact cached bytes and Retry never saves again`, async ({ page }, info) => {
  await reviewFault(page); await open(page); const file = await source(`${phase} ${kind}`); await page.setInputFiles('#fileInput', file); await scan(page); const before = await state(page); await observeSaves(page);
  if (phase === 'initial') { await page.evaluate(kind => { window.privacyReviewFault = kind; }, kind); await page.check('#metadataCleanup'); await page.click('#cleanupBtn'); }
  else { await prepare(page); await download(page, info, 'chosen-before-failure.pdf'); await page.evaluate(kind => { window.privacyReviewFault = kind; }, kind); await page.click('#useResultBtn'); }
  await expect(page.locator('#retryBtn')).toBeVisible(); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#documentResult')).toHaveAttribute('inert', ''); await expect(page.locator('#documentResult')).toBeHidden(); await expect(page.locator('#chainRow')).toBeHidden(); await expect(page.locator('#useResultBtn')).toHaveCount(0); await expect(page.locator('#downloadResultBtn')).toHaveCount(0);
  const savedSHA = await page.evaluate(() => window.privacySavedSHA), failed = await state(page); expect(failed.current).toBe(phase === 'initial' ? before.current : savedSHA); expect(failed.original).toBe(sha(file.buffer)); expect(await page.evaluate(() => window.privacySaves)).toBe(1); expect(await page.evaluate(() => window.privacySharedActive)).toBe(0);
  await page.click('#retryBtn'); await expect(page.locator('#documentResult')).not.toHaveAttribute('inert', ''); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false'); expect(sha(await download(page, info, `${phase}-${kind}-retry.pdf`))).toBe(savedSHA); expect(await state(page)).toEqual(failed); expect(await page.evaluate(() => window.privacySaves)).toBe(1); expect(await page.evaluate(() => window.privacySharedMaximum)).toBe(1);
  if (phase === 'chosen') await expect(page.locator('#chainRow')).toBeVisible(); else await expect(page.locator('#chainRow')).toBeHidden();
});
test('first actual save drains after Cancel and no stale verified result or download appears', async ({ page }) => {
  await open(page); await page.setInputFiles('#fileInput', await source('SAVE CANCEL')); await scan(page); const before = await state(page); await observeSaves(page); await page.evaluate(() => { window.privacyHoldSave = true; });
  await page.check('#metadataCleanup'); await page.click('#cleanupBtn'); await expect.poll(() => page.evaluate(() => window.privacySaveHeld)).toBe(true); await page.click('#cancelBtn'); await expect(page.locator('#documentResult')).toBeHidden(); expect(await state(page)).toEqual(before);
  await page.evaluate(() => { window.privacyHoldSave = false; window.releasePrivacySave(); }); await expect(page.locator('#scanBtn')).toBeEnabled(); await expect(page.locator('#successSection')).toBeHidden(); expect(await state(page)).toEqual(before); await page.click('#scanBtn'); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false');
});
for (const mode of ['hold-load', 'hold-render']) test(`first actual ${mode} drains before a later native File can be read`, async ({ page }) => {
  await sourceNativeFault(page); await open(page); await page.setInputFiles('#fileInput', await source('FIRST NATIVE')); await scan(page);
  await page.evaluate(mode => { window.privacySourceFault = mode; const read = File.prototype.arrayBuffer; window.privacyLaterReads = 0; File.prototype.arrayBuffer = function (...args) { if (this.name === 'LATER FILE.pdf') window.privacyLaterReads++; return read.apply(this, args); }; }, mode);
  if (mode === 'hold-load') await page.click('#scanBtn'); else await page.click('#nextPageBtn');
  await expect.poll(() => page.evaluate(() => window.privacySourceHeld)).toBe(true); const loads = await page.evaluate(() => window.privacySourceLoads);
  await page.setInputFiles('#fileInput', await source('LATER FILE')); expect(await page.evaluate(() => window.privacyLaterReads)).toBe(0); expect(await page.evaluate(() => window.privacySourceLoads)).toBe(loads);
  await page.evaluate(() => window.releasePrivacySource()); await ready(page); expect(await page.evaluate(() => window.privacyLaterReads)).toBe(1); await expect(page.locator('#selectedFileName')).toHaveText('LATER FILE.pdf');
});
test('a rejected first actual native destroy fences new loads until explicit cleanup Retry', async ({ page }) => {
  await sourceNativeFault(page); await open(page); await page.setInputFiles('#fileInput', await source('DESTROY FENCE')); await ready(page); await page.evaluate(() => { window.privacySourceFault = 'destroy'; }); await page.click('#scanBtn');
  await expect(page.locator('#errorSection')).toBeVisible(); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false'); expect(await page.evaluate(() => window.privacyDestroyFirstRejected)).toBe(true); const loads = await page.evaluate(() => window.privacySourceLoads);
  await page.click('#scanBtn'); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false'); expect(await page.evaluate(() => window.privacySourceLoads)).toBe(loads);
  await page.click('#retryBtn'); await ready(page); expect(await page.evaluate(() => window.privacySourceLoads)).toBe(loads + 1); await expect(page.locator('#errorSection')).toBeHidden();
});
test('live scene inspection and chosen cleanup retain typed Undo state and exact source resources', async ({ page }, info) => {
  await open(page); const file = await source('EDITABLE SCENE');
  const handoff = await page.evaluate(async bytes => {
    const ui = await import(new URL('./tool-ui.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href); await ui.ensureDocumentSession(); ui.documentSession.begin(new Uint8Array(bytes), 'SCENE SOURCE.pdf', { type: 'application/pdf', capabilities: { searchable: true, encrypted: false } }); ui.documentSession.beginScene(); const scene = ui.documentSession.scene(); scene.objects.push({ id: 'privacy-visible-text', kind: 'text', pageIndex: 1, x: 45, y: 100, width: 180, height: 30, text: 'VISIBLE SCENE', fontSize: 16, weight: 'regular', color: [0, 0, 0] }); ui.documentSession.changeScene(scene); ui.documentSession.setSelection([1]); const current = ui.documentSession.current(), value = await ui.stashForChain(current.bytes, current.name, 'privacy-scan', current); return { workflow: value.workflowId, file: value.fileId };
  }, [...file.buffer]);
  await page.goto(`/privacy-scan?workflow=${encodeURIComponent(handoff.workflow)}&file=${encodeURIComponent(handoff.file)}`); await scan(page); const before = await state(page); expect(before.scene).not.toBeNull(); await expect(page.locator('#privacyCanvas')).toHaveAttribute('data-pdf-page', '2'); await expect(page.locator('#privacyDisclosures')).toContainText('current visible PDF edits');
  await prepare(page); const bytes = await download(page, info, 'scene-info-cleaned.pdf'); await use(page); const chosen = await state(page); expect(chosen.current).toBe(sha(bytes)); expect(chosen.original).toBe(sha(file.buffer)); expect(chosen.scene).toBeNull(); expect(chosen.history.some(entry => entry.kind === 'scene' && entry.scene === before.scene)).toBe(true); expect(chosen.resources).toEqual(before.resources); expect(chosen.snapshot.current.boundary.losses).toContain('scene-baked');
  await page.click('#undoBtn'); await ready(page); const undone = await state(page); expect(undone.scene).toBe(before.scene); expect(undone.resources).toEqual(before.resources); expect(undone.original).toBe(before.original); await expect(page.locator('#scanResults')).toBeHidden();
});
for (const limit of ['total', 'original', 'resources', 'count']) test(`cached review ${limit} admission rejects before original clone and retries without another save`, async ({ page }, info) => {
  await reviewFault(page); await open(page); await page.setInputFiles('#fileInput', await source(`BUDGET ${limit}`)); await scan(page); await observeSaves(page); await page.evaluate(() => { window.privacyReviewFault = 'load'; }); await page.check('#metadataCleanup'); await page.click('#cleanupBtn'); await expect(page.locator('#retryBtn')).toBeVisible(); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false');
  const before = await state(page);
  await page.evaluate(async limit => {
    const ui = await import(new URL('./tool-ui.js', document.querySelector('script[src$="js/privacy-scan.js"]').src).href), original = ui.documentSession.original, snapshot = ui.documentSession.snapshot;
    window.privacyOriginalCopies = 0; ui.documentSession.original = (...args) => { window.privacyOriginalCopies++; return original(...args); };
    window.privacyBudgetFake = true; ui.documentSession.snapshot = (...args) => { const actual = snapshot(...args); if (!window.privacyBudgetFake) return actual; return { ...actual, ...(limit === 'total' ? { retainedBytes: 511 * 1024 * 1024 } : limit === 'original' ? { original: { ...actual.original, size: 250 * 1024 * 1024 }, retainedBytes: 300 * 1024 * 1024 } : limit === 'resources' ? { resourceBytes: 95 * 1024 * 1024, retainedBytes: 96 * 1024 * 1024 } : { resourceCount: 128 }) }; };
  }, limit);
  const loads = await page.evaluate(() => window.privacySharedLoads); await page.click('#retryBtn'); await expect(page.locator('#errorSection')).toBeVisible(); await expect(page.locator('#privacyWorkspace')).toHaveAttribute('aria-busy', 'false'); expect(await page.evaluate(() => window.privacyOriginalCopies)).toBe(0); expect(await page.evaluate(() => window.privacySharedLoads)).toBe(loads); expect(await page.evaluate(() => window.privacySaves)).toBe(1);
  await page.evaluate(() => { window.privacyBudgetFake = false; }); expect(await state(page)).toEqual(before); await page.click('#retryBtn'); await expect(page.locator('#documentResult')).not.toHaveAttribute('inert', ''); expect(sha(await download(page, info, `${limit}-retry.pdf`))).toBe(await page.evaluate(() => window.privacySavedSHA)); expect(await page.evaluate(() => window.privacySaves)).toBe(1);
});
for (const destination of ['edit-metadata', 'document-doctor']) test(`chosen ${destination} handoff stores exact typed bytes, original and disclosures`, async ({ page }, info) => {
  const file = await source('TYPED HANDOFF'); await open(page); await page.setInputFiles('#fileInput', file); await scan(page); await prepare(page); const bytes = await download(page, info, `${destination}-chosen.pdf`); await use(page); const chosen = await state(page); await chain(page, destination); await expect(page).toHaveURL(new RegExp(`${destination}\\?workflow=`));
  const bundle = await page.evaluate(async () => { const entry = document.querySelector('script[src$="js/edit-metadata.js"],script[src$="js/document-doctor.js"]'), { createWorkflowStore } = await import(new URL('./core/workflow-store.js', entry.src).href), store = createWorkflowStore(), params = new URLSearchParams(location.search), workflow = await store.getWorkflow(params.get('workflow')), files = await store.getFiles(workflow.id, workflow.fileRefs), digest = async file => [...new Uint8Array(await crypto.subtle.digest('SHA-256', file.bytes))].map(value => value.toString(16).padStart(2, '0')).join(''); return { type: workflow.inputDescriptor.type, current: await digest(files.find(file => file.id === params.get('file'))), original: await digest(files.find(file => file.id === workflow.originalRef)), task: workflow.id }; });
  expect(bundle).toEqual({ type: 'application/pdf', current: sha(bytes), original: sha(file.buffer), task: chosen.snapshot.taskId });
  // Doctor bundle commitment is not a claim that its separate UI consumes it.
});
for (const [locale, theme] of [['en', 'light'], ['ar', 'dark']]) for (const width of [320, 390, 768, 1440]) test(`actual names and selected preview fit ${locale} ${theme} ${width}px with applied external CSS`, async ({ page }, info) => {
  const errors = []; page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); await page.addInitScript(theme => localStorage.setItem('pdf2md-theme', theme), theme); await page.setViewportSize({ width, height: 820 });
  const name = `${'İstanbul العربية '.repeat(12)}NAMES.pdf`; await open(page, locale === 'en' ? '/privacy-scan' : '/ar/privacy-scan'); await page.setInputFiles('#fileInput', await source('NAMES', { name })); await ready(page);
  await expect(page.locator('#privacyDocumentNames')).not.toHaveAttribute('open', ''); await expect(page.locator('#privacyDocumentNamesSummary')).toHaveAttribute('aria-label', /İstanbul العربية/); expect(await page.locator('#documentIdentity').evaluate(node => node.parentElement.id)).toBe('privacyDocumentNames');
  const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, canvas: document.querySelector('#privacyCanvas').getBoundingClientRect().toJSON(), display: getComputedStyle(document.querySelector('.privacy-page-controls')).display, direction: document.documentElement.dir, backing: [document.querySelector('#privacyCanvas').width, document.querySelector('#privacyCanvas').height] }));
  expect(layout.scroll).toBeLessThanOrEqual(width); expect(layout.canvas.top).toBeLessThan(820); expect(layout.display).toBe('flex'); expect(Math.max(...layout.backing)).toBeLessThanOrEqual(900); expect(layout.backing[0] * layout.backing[1]).toBeLessThanOrEqual(4000000); if (locale === 'ar') expect(layout.direction).toBe('rtl'); expect(errors).toEqual([]); await page.screenshot({ path: info.outputPath(`privacy-${locale}-${width}.png`), fullPage: true });
  await page.locator('#privacyDocumentNamesSummary').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#documentIdentity')).toBeVisible(); await page.keyboard.press('Enter'); await page.click('#clearBtn'); await expect(page.locator('#documentIdentity')).toHaveCount(0);
});
test('empty route keeps the unchanged 100000-byte / 16-request native idle bound and never loads optional engines', async ({ page }) => {
  const requests = []; page.on('request', request => { if (request.resourceType() === 'script') requests.push(new URL(request.url())); }); await open(page); await page.waitForLoadState('networkidle');
  const firstParty = requests.filter(url => url.origin === new URL(page.url()).origin), paths = [...new Set(firstParty.map(url => decodeURIComponent(url.pathname)))];
  const publicRoot = path.resolve('public');
  const sizes = await Promise.all(paths.map(async relative => {
    expect(relative).toMatch(/^\/js\//);
    const target = path.resolve(publicRoot, `.${relative}`);
    expect(target.startsWith(`${publicRoot}${path.sep}`)).toBe(true);
    return (await stat(target)).size;
  }));
  expect(sizes.reduce((sum, value) => sum + value, 0)).toBeLessThan(100000); expect(requests.length).toBeLessThanOrEqual(16); expect(paths.join('\n')).not.toMatch(/privacy-workspace|privacy-scan-intake|privacy-cleanup|core\/privacy-scan|document-session|document-result|workflow-store|vendor/); await expect(page.locator('#scanBtn')).toBeDisabled();
});
