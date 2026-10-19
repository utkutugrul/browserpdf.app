import { boundedViewport } from './core/bounded-renderer.js';
import { copyProtectionBytes, checkProtectionOwner, addProtectionAbortListener, removeProtectionAbortListener } from './core/pdf-protection-policy.js';
import { workspaceError } from './protection-intake.js';

// Credentials stay in this owned load call and its PDF.js task, never artifacts.
export function createProtectionPreview({ host, ensurePdfJs, pdfjsAssets = {}, onState = () => {} }) {
  let generation = 0, task = null, doc = null, renderTask = null, rendering = Promise.resolve(), loading = Promise.resolve(), currentOptions = null;
  let pageNumber = 1, pendingPage = null, painting = false, pageGeneration = 0;
  const retained = new Map(), failed = new Set();
  const check = (token, options) => { checkProtectionOwner(options); if (token !== generation) throw workspaceError('preview-failed'); };
  async function release(value) {
    if (!value) return; if (failed.has(value)) throw workspaceError('cleanup-failed'); let work = retained.get(value);
    if (!work) { work = Promise.resolve().then(() => value.destroy()); retained.set(value, work); work.catch(() => {}); }
    try { await work; retained.delete(value); } catch { retained.set(value, null); failed.add(value); throw workspaceError('cleanup-failed'); }
  }
  function pause() {
    generation++; pageGeneration++; pendingPage = null; renderTask?.cancel();
    const previous = task; task = null; doc = null; currentOptions = null;
    if (previous) void release(previous).catch(() => {});
    for (const canvas of host.querySelectorAll('canvas')) { canvas.width = canvas.height = 1; } host.replaceChildren();
  }
  async function drained({ retry = false } = {}) {
    await Promise.allSettled([loading, rendering]);
    for (const value of [...retained.keys()]) { if (retry) failed.delete(value); await release(value); }
  }
  async function paint(number, token, options, pageToken) {
    check(token, options); const requestedDoc = doc, page = await requestedDoc.getPage(number); check(token, options);
    const canvas = document.createElement('canvas'), viewport = boundedViewport(page, { scale: 1.5, maxDimension: 900, maxPixels: 1000000 });
    canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
    try {
      if (pageToken !== pageGeneration) return;
      renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport }); await renderTask.promise; check(token, options);
      if (pageToken !== pageGeneration) return;
      for (const old of host.querySelectorAll('canvas')) old.width = old.height = 1;
      canvas.dataset.pdfPage = String(number); canvas.setAttribute('aria-label', String(number)); host.replaceChildren(canvas);
      pageNumber = number; onState({ ready: true, page: number, pages: requestedDoc.numPages });
    } finally { if (!canvas.isConnected) canvas.width = canvas.height = 1; renderTask = null; }
  }
  async function open({ bytes, credential, ...options }) {
    pause(); const token = generation; await drained(); check(token, options);
    const run = async () => {
      const pdfjs = await ensurePdfJs(); check(token, options);
      const value = pdfjs.getDocument({ data: copyProtectionBytes(bytes, 64 * 1024 * 1024), ...(credential === undefined ? {} : { password: credential }), ...pdfjsAssets, stopAtErrors: true, enableXfa: false });
      credential = undefined; task = value; retained.set(value, null);
      const abort = () => { renderTask?.cancel(); void release(value).catch(() => {}); };
      addProtectionAbortListener(options.signal, abort);
      try {
        const loaded = await value.promise; check(token, options);
        if (!Number.isSafeInteger(loaded.numPages) || loaded.numPages < 1 || loaded.numPages > 1000) throw workspaceError('page-limit');
        doc = loaded; currentOptions = { token, options }; pageNumber = Math.max(1, Math.min(loaded.numPages, options.page || 1));
        onState({ ready: false, page: pageNumber, pages: loaded.numPages });
        const ownPage = ++pageGeneration; rendering = paint(pageNumber, token, options, ownPage); await rendering; check(token, options);
      } catch (error) { await release(value); checkProtectionOwner(options); throw error?.code ? error : workspaceError('preview-failed'); }
      finally { removeProtectionAbortListener(options.signal, abort); }
    };
    loading = run(); return loading;
  }
  async function pump() {
    if (painting) return; painting = true;
    try { while (pendingPage) { const item = pendingPage; pendingPage = null; await rendering.catch(() => {}); const { token, options } = item; check(token, options); rendering = paint(item.number, token, options, item.pageToken); try { await rendering; } catch (error) { if (pendingPage && token === generation) { check(token, options); continue; } throw error; } } }
    finally { painting = false; }
  }
  return {
    open,
    selectPage(number) {
      if (!doc || !currentOptions) return Promise.resolve();
      const value = Math.max(1, Math.min(doc.numPages, number)); pageGeneration++; renderTask?.cancel(); onState({ ready: false, page: value, pages: doc.numPages });
      pendingPage = { ...currentOptions, number: value, pageToken: pageGeneration }; return pump();
    },
    page: () => pageNumber, pause, drained, dispose: pause,
  };
}
