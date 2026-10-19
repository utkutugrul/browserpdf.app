import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function corpus() { const pdf = await PDFDocument.create(); pdf.addPage([300, 400]).drawText('NATIVE PREVIEW LIFECYCLE', { x: 20, y: 300 }); return [...await pdf.save()]; }
async function host(page) {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/robots.txt');
  await page.evaluate(async (bytes) => {
    document.body.replaceChildren(document.createElement('main'));
    const ui = await import('/js/tool-ui.js'); await ui.ensureDocumentSession(); ui.documentSession.begin(Uint8Array.from(bytes), 'native.pdf', { type: 'application/pdf' });
    window.__previewUI = ui; window.__previewBytes = Uint8Array.from(bytes);
    window.__hold = new Promise((resolve) => { window.__release = resolve; }); window.__held = false;
    window.__beginReview = () => ui.reviewResult(window.__previewBytes, 'native.pdf', { type: 'application/pdf' });
    window.__beginDrain = () => { window.__drained = false; window.__drainError = null; window.__drain = ui.clearResultAndDrain().then(() => { window.__drained = true; }, (error) => { window.__drainError = { code: error.code, message: error.message }; }); };
  }, await corpus());
  return errors;
}
async function runtimeObserver(page) {
  await page.route('**/js/lib-loader.js*', async (route) => {
    const response = await route.fetch(), body = await response.text();
    const marker = 'export async function ensurePdfJs(onStatus)';
    if (!body.includes(marker)) throw new Error('Pinned public runtime entry was not found.');
    await route.fulfill({ response, body: body.replace(marker, 'async function originalEnsurePdfJs(onStatus)') + '\nexport async function ensurePdfJs(onStatus) { const runtime = await originalEnsurePdfJs(onStatus); return window.__observePdfJs ? window.__observePdfJs(runtime) : runtime; }\n' });
  });
}
async function ready(page) { await expect(page.locator('#documentResultPreview')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('#documentResult canvas')).toHaveAttribute('data-pdf-page', '1'); }
async function release(page) { await page.evaluate(() => window.__release()); await page.evaluate(() => window.__drain); }

test('shared drain awaits a held result module and never starts its stale native preview', async ({ page }) => {
  const module = deferred(), reached = deferred();
  await page.route('**/js/document-result.js*', async (route) => { const response = await route.fetch(); reached.resolve(); await module.promise; await route.fulfill({ response }); });
  const errors = await host(page);
  await page.evaluate(() => { window.__review = window.__beginReview(); window.__review.catch(() => {}); }); await reached.promise;
  await page.evaluate(() => window.__beginDrain()); await expect(page.locator('#documentResult')).toHaveCount(0);
  expect(await page.evaluate(() => window.__drained)).toBe(false);
  module.resolve(); await page.evaluate(() => Promise.all([window.__review, window.__drain]));
  expect(await page.evaluate(() => window.__drained)).toBe(true); await expect(page.locator('#documentResult')).toHaveCount(0);
  await page.evaluate(() => window.__beginReview()); await ready(page); expect(errors).toEqual([]);
});

test('held actual PDF.js load drains only the captured generation while a new preview survives', async ({ page }) => {
  await runtimeObserver(page); const errors = await host(page);
  await page.evaluate(() => {
    let first = true;
    window.__observePdfJs = (runtime) => ({ ...runtime, getDocument(options) {
      const task = runtime.getDocument(options), held = first; first = false;
      return { promise: task.promise.then(async (doc) => { if (held) { window.__held = true; await window.__hold; } return doc; }), destroy: () => task.destroy() };
    } });
    window.__review = window.__beginReview(); window.__review.catch(() => {});
  });
  await page.waitForFunction(() => window.__held); await page.evaluate(() => window.__beginDrain());
  await expect(page.locator('#documentResult')).toBeHidden(); expect(await page.evaluate(() => window.__drained)).toBe(false);
  await page.evaluate(() => window.__beginReview()); await ready(page);
  await release(page); await expect(page.locator('#documentResult')).toBeVisible(); await ready(page);
  expect(await page.evaluate(() => window.__drainError)).toBeNull(); expect(errors).toEqual([]);
});

test('clear captures a retiring native destroy during the Show original event and awaits it', async ({ page }) => {
  await runtimeObserver(page); const errors = await host(page);
  await page.evaluate(() => {
    let first = true;
    window.__observePdfJs = (runtime) => ({ ...runtime, getDocument(options) {
      const task = runtime.getDocument(options), held = first; first = false;
      return { promise: task.promise, async destroy() { if (held) { window.__held = true; await window.__hold; } await task.destroy(); } };
    } });
  });
  await page.evaluate(() => window.__beginReview()); await ready(page);
  await page.getByRole('button', { name: 'Show original', exact: true }).click(); await page.waitForFunction(() => window.__held);
  await page.evaluate(() => window.__beginDrain()); expect(await page.evaluate(() => window.__drained)).toBe(false); await expect(page.locator('#documentResult')).toBeHidden();
  await release(page); expect(await page.evaluate(() => window.__drained)).toBe(true);
  await page.evaluate(() => window.__beginReview()); await ready(page); expect(errors).toEqual([]);
});

test('clear awaits a held actual render completion', async ({ page }) => {
  await runtimeObserver(page); const errors = await host(page);
  await page.evaluate(() => {
    let first = true;
    window.__observePdfJs = (runtime) => ({ ...runtime, getDocument(options) {
      const task = runtime.getDocument(options);
      return { promise: task.promise.then((doc) => {
        const getPage = doc.getPage.bind(doc);
        doc.getPage = async (number) => { const page = await getPage(number), render = page.render.bind(page); page.render = (options) => {
          const renderTask = render(options), held = first; first = false;
          return { promise: renderTask.promise.then(async (value) => { if (held) { window.__held = true; await window.__hold; } return value; }), cancel: () => renderTask.cancel() };
        }; return page; }; return doc;
      }), destroy: () => task.destroy() };
    } });
    window.__review = window.__beginReview(); window.__review.catch(() => {});
  });
  await page.waitForFunction(() => window.__held); await page.evaluate(() => window.__beginDrain());
  expect(await page.evaluate(() => window.__drained)).toBe(false); expect(await page.locator('#documentResult canvas').evaluate((canvas) => canvas.width * canvas.height)).toBe(0);
  await release(page); expect(await page.evaluate(() => window.__drainError)).toBeNull();
  await page.evaluate(() => window.__beginReview()); await ready(page); expect(errors).toEqual([]);
});

test('ordinary public getPage rejection settles cleanup and allows a successful preview retry', async ({ page }) => {
  await runtimeObserver(page); const errors = await host(page);
  await page.evaluate(() => {
    let first = true;
    window.__observePdfJs = (runtime) => ({ ...runtime, getDocument(options) { const task = runtime.getDocument(options); return { promise: task.promise.then((doc) => {
      const getPage = doc.getPage.bind(doc); doc.getPage = async (number) => { if (first) { first = false; throw new Error('Controlled ordinary page failure'); } return getPage(number); }; return doc;
    }), destroy: () => task.destroy() }; } });
  });
  await page.evaluate(() => window.__beginReview()); await expect(page.locator('#documentResultStatus')).toContainText('Controlled ordinary page failure');
  await page.evaluate(() => { window.__beginDrain(); return window.__drain; }); expect(await page.evaluate(() => window.__drainError)).toBeNull();
  await page.evaluate(() => window.__beginReview()); await ready(page); expect(errors).toEqual([]);
});

test('external image lane bitmap completion drains without reentrant waiting and closes the native bitmap', async ({ page }) => {
  const errors = await host(page);
  await page.evaluate(async () => {
    const { createImageWorkLane } = await import('/js/core/image-intake.js'); window.__imageLane = createImageWorkLane(); window.__closed = 0;
    const decode = createImageBitmap;
    window.createImageBitmap = async (...args) => { const bitmap = await decode(...args), close = bitmap.close.bind(bitmap); bitmap.close = () => { window.__closed++; close(); }; window.__held = true; await window.__hold; return bitmap; };
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 3; canvas.getContext('2d').fillRect(0, 0, 3, 3);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/png')), bytes = new Uint8Array(await blob.arrayBuffer());
    window.__review = window.__previewUI.reviewResult(bytes, 'native.png', { type: 'image/png', imageWorkLane: window.__imageLane }); window.__review.catch(() => {});
  });
  await page.waitForFunction(() => window.__held); await page.evaluate(() => window.__beginDrain()); expect(await page.evaluate(() => window.__drained)).toBe(false);
  await release(page); expect(await page.evaluate(() => window.__closed)).toBe(1);
  expect(await page.evaluate(() => window.__imageLane.run(() => 'positive successor'))).toBe('positive successor');
  await page.evaluate(() => window.__beginReview()); await ready(page); expect(errors).toEqual([]);
});

test('actual destroy rejection is visible, remains fenced and retries the native resource before successor', async ({ page }) => {
  await runtimeObserver(page); const errors = await host(page);
  await page.evaluate(() => {
    window.__destroyed = 0; let rejectOnce = true;
    window.__observePdfJs = (runtime) => ({ ...runtime, getDocument(options) { const task = runtime.getDocument(options); return { promise: task.promise, async destroy() {
      if (rejectOnce) { rejectOnce = false; throw new Error('Controlled native destroy rejection'); }
      await task.destroy(); window.__destroyed++;
    } }; } });
  });
  await page.evaluate(() => window.__beginReview()); await ready(page); await page.evaluate(async () => {
    window.__beginDrain(); const concurrent = window.__previewUI.clearResultAndDrain();
    window.__concurrentDrain = await Promise.allSettled([window.__drain, concurrent]);
  });
  expect(await page.evaluate(() => window.__drainError?.code)).toBe('DOCUMENT_PREVIEW_CLEANUP'); expect(await page.evaluate(() => window.__concurrentDrain[1].reason?.code)).toBe('DOCUMENT_PREVIEW_CLEANUP'); expect(await page.evaluate(() => window.__destroyed)).toBe(0);
  await expect(page.locator('#documentResult')).toBeHidden();
  await page.evaluate(() => { window.__beginDrain(); return window.__drain; });
  expect(await page.evaluate(() => window.__drainError)).toBeNull(); expect(await page.evaluate(() => window.__destroyed)).toBe(1);
  await page.evaluate(() => window.__beginReview()); await ready(page); expect(errors).toEqual([]);
});

test('repeated native result selections release retired records and stale detached event handlers', async ({ page }) => {
  await runtimeObserver(page);
  await page.route('**/js/tool-ui.js*', async (route) => {
    const response = await route.fetch(), body = await response.text(), marker = 'async function selectArtifact(artifact) {';
    if (!body.includes(marker)) throw Error('Actual result selection handler was not found.');
    const observer = 'async function selectArtifact(artifact) { const promise = originalSelectArtifact(artifact); window.__selectionWork = promise; return promise; }\n  async function originalSelectArtifact(artifact) {';
    await route.fulfill({ response, body: body.replace(marker, observer) });
  });
  await page.route('**/js/document-result.js*', async (route) => {
    const response = await route.fetch(), body = await response.text();
    if (!body.includes('const previews = new Set();')) throw Error('Private lifecycle probe target was not found.');
    await route.fulfill({ response, body: body + '\nwindow.__previewRecordCount = () => previews.size;\n' });
  });
  const errors = await host(page);
  await page.evaluate(async () => {
    window.__nativePreview = { created: 0, active: 0, destroyed: 0, maximum: 0 };
    window.__observePdfJs = (runtime) => ({ ...runtime, getDocument(options) {
      const task = runtime.getDocument(options), stats = window.__nativePreview; stats.created++; stats.active++; stats.maximum = Math.max(stats.maximum, stats.active);
      return { promise: task.promise, async destroy() { await task.destroy(); stats.destroyed++; stats.active--; } };
    } });
    await window.__previewUI.reviewResults([{ bytes: window.__previewBytes, name: 'choice-one.pdf', type: 'application/pdf' }, { bytes: window.__previewBytes, name: 'choice-two.pdf', type: 'application/pdf' }]);
    window.__detachedOriginal = [...document.querySelectorAll('#documentResult button')].find((button) => button.textContent === 'Show original');
  });
  await ready(page);
  for (let index = 0; index < 12; index++) {
    const chosen = index % 2 ? 'choice-one.pdf' : 'choice-two.pdf';
    await page.locator('#documentResultGroup').getByRole('button', { name: chosen, exact: true }).click();
    await page.evaluate(() => window.__selectionWork);
    await ready(page);
    await expect(page.locator('#documentResult canvas')).toHaveAttribute('aria-label', chosen);
    expect(await page.evaluate(() => window.__previewRecordCount())).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => window.__nativePreview.active)).toBe(1);
  }
  const before = await page.evaluate(() => window.__nativePreview.created); await page.evaluate(() => window.__detachedOriginal.click());
  expect(await page.evaluate(() => window.__nativePreview.created)).toBe(before); await ready(page);
  await page.evaluate(() => window.__previewUI.clearResultAndDrain());
  expect(await page.evaluate(() => window.__previewRecordCount())).toBe(0);
  const stats = await page.evaluate(() => window.__nativePreview); expect(stats.active).toBe(0); expect(stats.destroyed).toBe(stats.created); expect(stats.maximum).toBe(1); expect(errors).toEqual([]);
});

test('event-driven failed destroy blocks every later preview load until actual cleanup succeeds', async ({ page }) => {
  await runtimeObserver(page); const errors = await host(page);
  await page.evaluate(() => {
    window.__nativePreview = { created: 0, active: 0, destroyed: 0, maximum: 0, attempts: 0 }; let first = true;
    window.__observePdfJs = (runtime) => ({ ...runtime, getDocument(options) {
      const task = runtime.getDocument(options), held = first; first = false;
      const stats = window.__nativePreview; stats.created++; stats.active++; stats.maximum = Math.max(stats.maximum, stats.active);
      return { promise: task.promise, async destroy() {
        stats.attempts++;
        if (held && stats.attempts === 1) throw new Error('Controlled event cleanup failure');
        if (held) { window.__held = true; await window.__hold; }
        await task.destroy(); stats.destroyed++; stats.active--;
      } };
    } });
  });
  await page.evaluate(() => window.__beginReview()); await ready(page);
  await page.getByRole('button', { name: 'Show original', exact: true }).click(); await expect(page.locator('#documentResultStatus')).toContainText('Controlled event cleanup failure');
  expect(await page.evaluate(() => window.__nativePreview.created)).toBe(1); expect(await page.evaluate(() => window.__nativePreview.active)).toBe(1);
  await page.getByRole('button', { name: 'Show result', exact: true }).click(); await page.waitForFunction(() => window.__held);
  expect(await page.evaluate(() => window.__nativePreview.created)).toBe(1); expect(await page.evaluate(() => window.__nativePreview.destroyed)).toBe(0);
  await page.evaluate(() => window.__release()); await ready(page); await expect(page.locator('#documentResultStatus')).toContainText('Result: native.pdf');
  const stats = await page.evaluate(() => window.__nativePreview); expect(stats.created).toBe(2); expect(stats.destroyed).toBe(1); expect(stats.active).toBe(1); expect(stats.maximum).toBe(1); expect(stats.attempts).toBe(2);
  await page.evaluate(() => window.__previewUI.clearResultAndDrain()); expect(await page.evaluate(() => window.__nativePreview.active)).toBe(0); expect(errors).toEqual([]);
});

test('image preview event cannot bypass failed PDF destruction and a later native PDF preview succeeds', async ({ page }) => {
  await runtimeObserver(page); const errors = await host(page);
  await page.evaluate(async () => {
    window.__nativePreview = { created: 0, active: 0, destroyed: 0, maximum: 0, attempts: 0 }; window.__bitmapDecodes = 0; let first = true;
    window.__observePdfJs = (runtime) => ({ ...runtime, getDocument(options) {
      const task = runtime.getDocument(options), held = first; first = false;
      const stats = window.__nativePreview; stats.created++; stats.active++; stats.maximum = Math.max(stats.maximum, stats.active);
      return { promise: task.promise, async destroy() {
        stats.attempts++;
        if (held && stats.attempts === 1) throw new Error('Controlled image-event cleanup failure');
        if (held) { window.__held = true; await window.__hold; }
        await task.destroy(); stats.destroyed++; stats.active--;
      } };
    } });
    const decode = createImageBitmap; window.createImageBitmap = (...args) => { window.__bitmapDecodes++; return decode(...args); };
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 3; canvas.getContext('2d').fillRect(0, 0, 3, 3);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/png')), bytes = new Uint8Array(await blob.arrayBuffer());
    window.__resultModule = await import('/js/document-result.js');
    await window.__resultModule.showDocumentResult({ bytes: window.__previewBytes, name: 'native.pdf', type: 'application/pdf', capabilities: { encrypted: false } }, {
      session: { ...window.__previewUI.documentSession.snapshot(), original: window.__previewUI.documentSession.original(), compositionSources: { originals: [{ originalRef: 'native-image', name: 'native.png' }] }, resource: () => ({ bytes, name: 'native.png', type: 'image/png' }) },
      download() {},
    });
  });
  await ready(page); await page.getByRole('button', { name: 'Show original', exact: true }).click(); await expect(page.locator('#documentResultStatus')).toContainText('Controlled image-event cleanup failure');
  await page.click('#showOriginalImageBtn'); await page.waitForFunction(() => window.__held);
  expect(await page.evaluate(() => window.__bitmapDecodes)).toBe(0); expect(await page.evaluate(() => window.__nativePreview.created)).toBe(1);
  await page.evaluate(() => window.__release()); await expect(page.locator('#documentResultStatus')).toContainText('Original: native.png');
  expect(await page.evaluate(() => window.__bitmapDecodes)).toBe(1); expect(await page.evaluate(() => window.__nativePreview.active)).toBe(0);
  await page.click('#showCompositionResultBtn'); await ready(page);
  const stats = await page.evaluate(() => window.__nativePreview); expect(stats.created).toBe(2); expect(stats.destroyed).toBe(1); expect(stats.active).toBe(1); expect(stats.maximum).toBe(1);
  await page.evaluate(() => window.__resultModule.clearDocumentResultAndDrain()); expect(await page.evaluate(() => window.__nativePreview.active)).toBe(0); expect(errors).toEqual([]);
});

test('new review generation retries a failed event native resource even when activeTask was cleared', async ({ page }) => {
  await runtimeObserver(page); const errors = await host(page);
  await page.evaluate(() => {
    window.__nativePreview = { created: 0, active: 0, destroyed: 0, maximum: 0, attempts: 0 }; let first = true;
    window.__observePdfJs = (runtime) => ({ ...runtime, getDocument(options) {
      const task = runtime.getDocument(options), held = first; first = false;
      const stats = window.__nativePreview; stats.created++; stats.active++; stats.maximum = Math.max(stats.maximum, stats.active);
      return { promise: task.promise, async destroy() {
        stats.attempts++;
        if (held && stats.attempts === 1) throw new Error('Controlled previous-generation cleanup failure');
        if (held) { window.__held = true; await window.__hold; }
        await task.destroy(); stats.destroyed++; stats.active--;
      } };
    } });
  });
  await page.evaluate(() => window.__beginReview()); await ready(page);
  await page.getByRole('button', { name: 'Show original', exact: true }).click(); await expect(page.locator('#documentResultStatus')).toContainText('Controlled previous-generation cleanup failure');
  await page.evaluate(() => { window.__successorReview = window.__beginReview(); window.__successorReview.catch(() => {}); }); await page.waitForFunction(() => window.__held);
  expect(await page.evaluate(() => window.__nativePreview.created)).toBe(1); expect(await page.evaluate(() => window.__nativePreview.active)).toBe(1);
  await page.evaluate(() => window.__release()); await page.evaluate(() => window.__successorReview); await ready(page);
  const stats = await page.evaluate(() => window.__nativePreview); expect(stats.created).toBe(2); expect(stats.destroyed).toBe(1); expect(stats.active).toBe(1); expect(stats.maximum).toBe(1);
  await page.evaluate(() => window.__previewUI.clearResultAndDrain()); expect(await page.evaluate(() => window.__nativePreview.active)).toBe(0); expect(errors).toEqual([]);
});
