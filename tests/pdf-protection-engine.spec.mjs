import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

// Root allocates the native browser window and supplies a configuration without globalSetup.
test.skip(process.env.BPDF_PROTECTION_NATIVE !== '1', 'Requires the allocated protection native gate');
test.describe.configure({ mode: 'serial' });

async function fixture() {
  const doc = await PDFDocument.create(); doc.setTitle('Native protection title'); const page = doc.addPage([320, 240]); page.drawText('NATIVE PROTECTION RETAIN', { x: 20, y: 180, size: 14 });
  const field = doc.getForm().createTextField('native-field'); field.setText('RETAINED VALUE'); field.addToPage(page, { x: 20, y: 100, width: 180, height: 24 });
  await doc.attach(new Uint8Array([0, 128, 255]), 'retained.txt', { mimeType: 'text/plain' });
  return [...await doc.save()];
}
function observe(page) {
  const errors = [], nonGet = [], assetRequests = []; page.on('pageerror', error => errors.push(error.name));
  page.on('request', request => { if (request.method() !== 'GET') nonGet.push(request.method()); if (request.url().includes('/vendor/pdfstudio-0.4.0/')) assetRequests.push(new URL(request.url()).pathname); });
  return { errors, nonGet, assetRequests };
}
async function instrument(page) {
  await page.evaluate(() => {
    const NativeWorker = window.Worker, create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    const state = window.__protectionNative = { active: 0, maximum: 0, terminations: 0, created: [], revoked: [], phases: [], stop: null };
    URL.createObjectURL = blob => { const url = create(blob); state.created.push(url); return url; };
    URL.revokeObjectURL = url => { state.revoked.push(url); revoke(url); };
    window.Worker = class extends NativeWorker {
      constructor(url, options) { super(url, options); this.owned = String(url).includes('/pdf-protection-worker.js'); this.stopped = false; if (this.owned) { state.active++; state.maximum = Math.max(state.maximum, state.active); this.addEventListener('message', event => { if (event.data?.type === 'phase') { state.phases.push(event.data.phase); if (event.data.phase === 'native' && state.stop) { const stop = state.stop; state.stop = null; stop.abort(); } } }); } }
      terminate() { const value = super.terminate(); if (this.owned && !this.stopped) { this.stopped = true; state.active--; state.terminations++; } return value; }
    };
  });
}

test('real same-origin hashes, Blob module/WASM and output artifacts work under the site CSP', async ({ page }) => {
  const seen = observe(page), bytes = await fixture(); await page.goto('/view-pdf');
  await page.evaluate(() => import('/js/pdf-protection-loader.js')); expect(seen.assetRequests).toEqual([]); await instrument(page);
  const result = await page.evaluate(async bytes => {
    const { runProtectionJob } = await import('/js/pdf-protection-loader.js'), ownerToken = { taskId: 'native-proof', revision: 0, generation: 0 }, password = crypto.randomUUID().slice(0, 24);
    const protectedResult = await runProtectionJob({ operation: 'protect', bytes: Uint8Array.from(bytes), algorithm: 'aes256', userPassword: password, ownerToken });
    const unlockedResult = await runProtectionJob({ operation: 'unlock', bytes: protectedResult.bytes, password, ownerToken });
    const native = window.__protectionNative;
    const result = { protectedBytes: [...protectedResult.bytes], unlockedBytes: [...unlockedResult.bytes], protectedFacts: protectedResult.facts, unlockedFacts: unlockedResult.facts, active: native.active, maximum: native.maximum, terminations: native.terminations, created: native.created.length, revoked: native.revoked.length };
    const runtime = await import('/js/lib-loader.js'), pdfjs = await runtime.ensurePdfJs();
    async function read(data, credential) {
      const task = pdfjs.getDocument({ data: data.slice(), password: credential, ...runtime.PDFJS_ASSET_URLS });
      try { const pdf = await task.promise, page = await pdf.getPage(1), viewport = page.getViewport({ scale: 0.5 }), canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        try { await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; return { text: (await page.getTextContent()).items.map(item => item.str || '').join(' '), pixels: canvas.toDataURL() }; }
        finally { canvas.width = canvas.height = 1; }
      } finally { await task.destroy(); }
    }
    const source = await read(Uint8Array.from(bytes)), protectedView = await read(protectedResult.bytes, password), unlockedView = await read(unlockedResult.bytes);
    result.textPreserved = source.text === protectedView.text && source.text === unlockedView.text; result.pixelsPreserved = source.pixels === protectedView.pixels && source.pixels === unlockedView.pixels; return result;
  }, bytes);
  const doc = await PDFDocument.load(Uint8Array.from(result.unlockedBytes), { updateMetadata: false }); expect(doc.getTitle()).toBe('Native protection title'); expect(doc.getForm().getTextField('native-field').getText()).toBe('RETAINED VALUE');
  const ordinary = await doc.save({ updateFieldAppearances: false }); expect((await PDFDocument.load(ordinary, { updateMetadata: false })).getTitle()).toBe('Native protection title');
  expect(result.protectedFacts.encrypted).toBe(true); expect(result.unlockedFacts.encrypted).toBe(false); expect(result.active).toBe(0); expect(result.maximum).toBe(1); expect(result.terminations).toBe(2); expect(result.created).toBe(4); expect(result.revoked).toBe(4);
  expect(result.textPreserved).toBe(true); expect(result.pixelsPreserved).toBe(true);
  expect(seen.assetRequests.every(path => ['/vendor/pdfstudio-0.4.0/qpdf.js', '/vendor/pdfstudio-0.4.0/qpdf.wasm'].includes(path))).toBe(true); expect(seen.errors).toEqual([]); expect(seen.nonGet).toEqual([]);
});
test('native-phase hard abort uses public void termination and a positive successor', async ({ page }) => {
  const seen = observe(page), bytes = await fixture(); await page.goto('/view-pdf'); await instrument(page);
  const result = await page.evaluate(async bytes => {
    const { runProtectionJob } = await import('/js/pdf-protection-loader.js'), ownerToken = { taskId: 'native-cancel', revision: 0, generation: 0 }, password = crypto.randomUUID().slice(0, 24), stop = new AbortController();
    window.__protectionNative.stop = stop;
    let code; try { await runProtectionJob({ operation: 'protect', bytes: Uint8Array.from(bytes), userPassword: password, ownerToken }, { signal: stop.signal }); code = 'unexpected-success'; } catch (error) { code = error.code; }
    const successor = await runProtectionJob({ operation: 'protect', bytes: Uint8Array.from(bytes), userPassword: password, ownerToken });
    const state = window.__protectionNative; return { code, successor: successor.facts.encrypted, active: state.active, maximum: state.maximum, terminations: state.terminations, created: state.created.length, revoked: state.revoked.length, observedNativePhase: state.phases.includes('native') };
  }, bytes);
  expect(result).toEqual({ code: 'canceled', successor: true, active: 0, maximum: 1, terminations: 2, created: 4, revoked: 4, observedNativePhase: true }); expect(seen.errors).toEqual([]); expect(seen.nonGet).toEqual([]);
});
test('held fetch, overlap, stale and corrupt asset rejection drain before successor jobs', async ({ page }) => {
  const seen = observe(page), bytes = await fixture(); let release, began; const hold = new Promise(resolve => release = resolve), start = new Promise(resolve => began = resolve);
  await page.route('**/vendor/pdfstudio-0.4.0/qpdf.js', async route => { began(); await hold; await route.continue().catch(() => {}); });
  try {
    await page.goto('/view-pdf'); await instrument(page);
    await page.evaluate(bytes => {
      const state = window.__protectionHeld = { current: true, stop: new AbortController(), bytes: Uint8Array.from(bytes) };
      state.pending = import('/js/pdf-protection-loader.js').then(async ({ runProtectionJob }) => {
        try { await runProtectionJob({ operation: 'protect', bytes: state.bytes, userPassword: crypto.randomUUID(), ownerToken: { taskId: 'held', revision: 0, generation: 0 } }, { signal: state.stop.signal, isCurrent: () => state.current }); return 'unexpected-success'; } catch (error) { return error.code; }
      });
    }, bytes);
    await start;
    const overlap = await page.evaluate(async () => { const { runProtectionJob } = await import('/js/pdf-protection-loader.js'); try { await runProtectionJob({}); return 'unexpected-success'; } catch (error) { return error.code; } }); expect(overlap).toBe('busy');
    const canceled = await page.evaluate(async () => { window.__protectionHeld.stop.abort(); return window.__protectionHeld.pending; }); expect(canceled).toBe('canceled'); release(); await page.unroute('**/vendor/pdfstudio-0.4.0/qpdf.js');
    const result = await page.evaluate(async () => {
      const { runProtectionJob } = await import('/js/pdf-protection-loader.js'), state = window.__protectionHeld, ownerToken = { taskId: 'successor', revision: 1, generation: 0 };
      state.current = false; let stale; try { await runProtectionJob({ operation: 'protect', bytes: state.bytes, userPassword: crypto.randomUUID(), ownerToken }, { isCurrent: () => state.current }); } catch (error) { stale = error.code; }
      const successor = await runProtectionJob({ operation: 'protect', bytes: state.bytes, userPassword: crypto.randomUUID(), ownerToken }); return { stale, successor: successor.facts.encrypted, active: window.__protectionNative.active, maximum: window.__protectionNative.maximum };
    }); expect(result).toEqual({ stale: 'stale', successor: true, active: 0, maximum: 1 });
    await page.route('**/vendor/pdfstudio-0.4.0/qpdf.js', async route => { const response = await route.fetch(), body = await response.body(); body[0] ^= 1; await route.fulfill({ response, body }); });
    const corrupt = await page.evaluate(async () => {
      const { runProtectionJob } = await import('/js/pdf-protection-loader.js'), state = window.__protectionHeld, native = window.__protectionNative, created = native.created.length, terminations = native.terminations;
      let code; try { await runProtectionJob({ operation: 'protect', bytes: state.bytes, userPassword: crypto.randomUUID(), ownerToken: { taskId: 'integrity', revision: 0, generation: 0 } }); } catch (error) { code = error.code; }
      return { code, newUrls: native.created.length - created, newWorkers: native.terminations - terminations, active: native.active };
    }); expect(corrupt).toEqual({ code: 'asset-integrity', newUrls: 0, newWorkers: 0, active: 0 }); await page.unroute('**/vendor/pdfstudio-0.4.0/qpdf.js');
    expect(await page.evaluate(async () => { const { runProtectionJob } = await import('/js/pdf-protection-loader.js'); const result = await runProtectionJob({ operation: 'protect', bytes: window.__protectionHeld.bytes, userPassword: crypto.randomUUID(), ownerToken: { taskId: 'after-integrity', revision: 0, generation: 0 } }); return result.facts.encrypted; })).toBe(true);
    expect(seen.errors).toEqual([]); expect(seen.nonGet).toEqual([]);
  } finally { release(); await page.unroute('**/vendor/pdfstudio-0.4.0/qpdf.js'); }
});
