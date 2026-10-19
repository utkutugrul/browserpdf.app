'use strict';

import * as ui from './tool-ui.js';
import { t, getLang } from './i18n.js';
import { optimizePdfStructure, COMPRESSION_LIMITS } from './core/pdf-compression.js';
import { renderBoundedPage } from './core/bounded-renderer.js';
import { sameCompressOwner } from './compress-intake.js';

const text = (key, fallback, values) => t(`compress.structural_${key}`, fallback, values);
const abortError = () => new DOMException('Compression was replaced or canceled.', 'AbortError');
function trimName(value, length) { return value.slice(0, length).replace(/[\ud800-\udbff]$/, ''); }
export function optimizedNames(input) {
  const suffix = '-optimized.pdf';
  const base = String(input.name).replace(/\.pdf$/i, '') || 'document';
  const label = String(input.displayName || input.name).replace(/\.pdf$/i, '') || 'document';
  return { name: trimName(base, 160 - suffix.length) + suffix, displayName: trimName(label, 260 - suffix.length) + suffix };
}
function inputBoundary(input, previous, rewritten) {
  const added = [...(rewritten ? ['signature-rewrite'] : []), ...(input.losses || [])];
  if (input.losses?.length && !added.includes('signature-rewrite')) added.unshift('signature-rewrite');
  return added.length ? { kind: 'pdf-rewrite', losses: [...new Set([...added, ...(previous?.losses || [])])].slice(0, 12) } : previous;
}
let stylePromise;
function styles() {
  if (stylePromise) return stylePromise;
  stylePromise = new Promise((resolve, reject) => {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/css/compress-workspace.css';
    link.onload = resolve; link.onerror = () => { link.remove(); stylePromise = null; reject(new Error('Compression styles could not load. Retry opening the workspace.')); };
    document.head.append(link);
  });
  return stylePromise;
}
function element(tag, content, className) { const node = document.createElement(tag); if (content) node.textContent = content; if (className) node.className = className; return node; }

export function createCompressWorkspace({ admitted, lane, engines, signal, isCurrent }) {
  const root = document.getElementById('compressionWorkspace');
  const status = document.getElementById('compressionStatus');
  let owner = admitted.owner, disposed = false, paused = false, operationId = 0, operationController = null, busy = false;
  let input = null, candidate = null, chosen = false, sourceReady = false, pageCount = admitted.pageCount, pageNumber = Math.max(1, (ui.documentSession.snapshot().selection[0] || 0) + 1);
  let sourceRunning = false, sourcePending = null, sourceController = null, sourceWork = Promise.resolve(), sourceGeneration = 0;
  const jobs = new Set(), nativeTasks = new Map();
  let cleanupFailure = null, sourceError = null;
  const current = () => !disposed && !paused && !signal.aborted && isCurrent() && sameCompressOwner(owner, ui.documentSession.snapshot());
  const own = () => { if (!current()) throw abortError(); };
  const track = (promise) => { jobs.add(promise); promise.then(() => jobs.delete(promise), () => jobs.delete(promise)); return promise; };
  function report(error) { if (current() && error.name !== 'AbortError') { ui.showError(error.message); retry.hidden = false; } }
  function setStatus(message) { if (current()) status.textContent = message; }
  const source = element('section', '', 'compression-source'); source.setAttribute('aria-labelledby', 'compressionSourceHeading');
  const heading = element('h2', text('source', 'Input used for this optimization')); heading.id = 'compressionSourceHeading';
  const identity = element('p', '', 'compression-identity'); identity.id = 'compressionInputIdentity';
  const sourceStatus = element('p', '', 'compression-page-status'); sourceStatus.id = 'compressionSourceStatus'; sourceStatus.setAttribute('role', 'status');
  const pageControls = element('div', '', 'btn-row');
  function button(label, id, handler, parent = actions) { const node = element('button', label, 'btn btn-secondary'); node.id = id; node.type = 'button'; node.addEventListener('click', handler); parent.append(node); return node; }
  const actions = element('div', '', 'btn-row compression-actions');
  const optimize = button(text('optimize', 'Optimize and review'), 'compressBtn', () => { void run('optimize'); }); optimize.className = 'btn btn-primary';
  const cancel = button(text('cancel', 'Cancel'), 'cancelCompressBtn', () => { pauseWork(); paused = false; setStatus(text('cancelled', 'Canceled. The current document was retained.')); void run(chosen ? 'review' : 'prepare'); });
  const retry = button(text('retry', 'Retry'), 'retryCompressBtn', () => { void run(candidate ? 'review' : 'prepare'); }); retry.hidden = true;
  const previous = button(text('previous', 'Previous input page'), 'compressionPrevious', () => requestPage(pageNumber - 1), pageControls);
  const pageLabel = element('label', text('page', 'Input page')); pageLabel.htmlFor = 'compressionSourcePage';
  const pageInput = document.createElement('input'); pageInput.id = 'compressionSourcePage'; pageInput.type = 'number'; pageInput.min = '1'; pageInput.step = '1'; pageInput.value = String(pageNumber);
  pageInput.addEventListener('change', () => { const value = Number(pageInput.value); if (Number.isSafeInteger(value) && value >= 1 && value <= pageCount) requestPage(value); else pageInput.value = String(pageNumber); });
  pageLabel.append(pageInput); pageControls.append(pageLabel);
  const next = button(text('next', 'Next input page'), 'compressionNext', () => requestPage(pageNumber + 1), pageControls);
  const canvas = element('canvas'); canvas.id = 'compressionSourceCanvas'; canvas.setAttribute('aria-label', text('canvas', 'Actual compression input page'));
  const canvasHost = element('div', '', 'compression-canvas'); canvasHost.id = 'compressionSourcePreview'; canvasHost.append(canvas);
  source.append(heading, identity, pageControls, sourceStatus, canvasHost);
  const summary = element('p', '', 'callout'); summary.id = 'resultSummary'; summary.hidden = true; summary.setAttribute('role', 'status');
  const readonly = element('section', '', 'compression-readonly'); readonly.id = 'compressionReadonly'; readonly.hidden = true;
  const readonlyText = element('p'); readonly.append(readonlyText);
  const reader = button(text('reader', 'Open current PDF in Reader'), 'compressionReaderBtn', () => { void continueCurrent(admitted.reason === 'locked' ? 'unlock' : 'view-pdf').catch(report); }, readonly);
  button(text('download_current', 'Download current PDF'), 'compressionDownloadCurrent', () => { if (current()) { const artifact = ui.documentSession.current(); ui.downloadBytes(artifact.bytes, artifact.name, artifact.type, { download: true }); } }, readonly);
  const resultHost = element('div', '', 'compression-result-host'); resultHost.id = 'compressionResultHost'; resultHost.hidden = true;
  const panel = element('section', '', 'document-result'); panel.id = 'documentResult'; panel.hidden = true; resultHost.append(panel);
  root.replaceChildren(source, actions, readonly, summary, resultHost); root.hidden = false;
  function update() {
    optimize.disabled = busy || !sourceReady || readonly.hidden === false || !current();
    cancel.hidden = !busy && !sourceRunning;
    previous.disabled = busy || !input || pageNumber <= 1 || !current(); next.disabled = busy || !input || pageNumber >= pageCount || !current();
    pageInput.disabled = busy || !input || !current(); pageInput.max = String(pageCount || 1); pageInput.value = String(pageNumber);
    source.setAttribute('aria-busy', String(!sourceReady && readonly.hidden));
  }
  async function destroy(task) {
    if (!nativeTasks.has(task)) return;
    let promise = nativeTasks.get(task);
    if (!promise) { promise = Promise.resolve().then(() => task.destroy()); nativeTasks.set(task, promise); promise.catch(() => {}); }
    try { await promise; nativeTasks.delete(task); }
    catch (cause) { nativeTasks.set(task, null); const error = new Error(`Native input preview cleanup failed: ${cause.message}`, { cause }); error.code = 'COMPRESS_NATIVE_CLEANUP'; cleanupFailure = error; throw error; }
  }
  function reportCleanupFailure() { if (cleanupFailure) { const error = cleanupFailure; cleanupFailure = null; throw error; } }
  async function drainNative() { for (const task of [...nativeTasks.keys()]) await destroy(task); }
  async function drained() {
    await Promise.allSettled([...jobs, sourceWork]); reportCleanupFailure(); await drainNative();
  }
  function stopSource() { sourceGeneration++; sourcePending = null; sourceController?.abort(); sourceReady = false; canvas.width = canvas.height = 0; canvas.removeAttribute('data-pdf-page'); }
  function pauseWork() {
    operationId++; operationController?.abort(); operationController = null; stopSource();
    resultHost.hidden = true; ui.clearResult(); busy = false; update();
  }
  function pause() { paused = true; pauseWork(); }
  function readOnly(reason) {
    stopSource(); source.hidden = true; readonly.hidden = false; actions.hidden = true; summary.hidden = true; resultHost.hidden = true;
    const artifact = ui.documentSession.current();
    readonlyText.textContent = `${artifact.displayName || artifact.name} · ${ui.formatBytes(artifact.bytes.length)}. ` + (reason === 'locked' ? text('locked', 'This inherited PDF is locked. Continue through Unlock to inspect it.') : reason === 'pages' ? text('pages_limit', 'Structural optimization supports at most 250 pages. The inherited current task was retained; Reader supports up to 10,000 pages.') : text('bytes_limit', 'Structural optimization supports at most 80 MiB. The current task was retained. Reader accepts inherited PDFs up to 250 MiB.'));
    reader.textContent = reason === 'locked' ? text('unlock', 'Open current PDF in Unlock') : text('reader', 'Open current PDF in Reader');
    setStatus(readonlyText.textContent); update();
  }
  async function continueCurrent(slug) {
    own(); const generation = operationId, controller = new AbortController();
    const operation = { signal: controller.signal, isCurrent: () => current() && generation === operationId };
    const artifact = ui.documentSession.current(); reader.disabled = true;
    try {
      const handoff = await ui.stashForChain(artifact.bytes, artifact.name, slug, { ...artifact, operation });
      if (!operation.isCurrent() || !handoff.isCurrent()) throw abortError();
      const lang = getLang(); location.href = `${lang === 'en' ? '' : '/' + lang}/${slug}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`;
    } finally { if (operation.isCurrent()) reader.disabled = false; }
  }
  async function renderInput(number, controller, generation) {
    const check = () => { controller.signal.throwIfAborted(); own(); if (generation !== sourceGeneration) throw abortError(); };
    check(); await drainNative(); check(); const pdfjs = await engines.ensurePdfJs(); check();
    const task = pdfjs.getDocument({ data: input.bytes.slice(), ...engines.PDFJS_ASSET_URLS, stopAtErrors: true, enableXfa: false }); nativeTasks.set(task, null);
    const abort = () => { void destroy(task).catch(() => {}); };
    controller.signal.addEventListener('abort', abort, { once: true });
    const temporary = document.createElement('canvas');
    try {
      const doc = await task.promise; check(); pageCount = doc.numPages;
      if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > COMPRESSION_LIMITS.pages) throw new RangeError('The compression input exceeds 250 pages.');
      const page = await doc.getPage(number); check();
      await renderBoundedPage(page, temporary, { signal: controller.signal, scale: 1.5, maxDimension: 900, maxPixels: 1000000 }); check();
      canvas.width = temporary.width; canvas.height = temporary.height; canvas.getContext('2d').drawImage(temporary, 0, 0); canvas.dataset.pdfPage = String(number);
      sourceReady = true; sourceStatus.textContent = `${number} / ${pageCount}`; canvasHost.setAttribute('aria-busy', 'false');
    } finally { controller.signal.removeEventListener('abort', abort); temporary.width = temporary.height = 0; await destroy(task); }
  }
  function requestPage(number) {
    if (!current() || !input || busy || !Number.isSafeInteger(number) || number < 1 || number > (pageCount || 1)) return sourceWork;
    pageNumber = number; sourceReady = false; sourceError = null; sourcePending = { number, generation: ++sourceGeneration }; sourceController?.abort();
    canvasHost.setAttribute('aria-busy', 'true'); sourceStatus.textContent = text('loading_page', 'Loading input page…'); update();
    if (sourceRunning) return sourceWork;
    sourceRunning = true;
    sourceWork = (async () => {
      try {
        while (sourcePending && current()) {
          const request = sourcePending; sourcePending = null; const controller = new AbortController(); sourceController = controller;
          try { await lane.run(() => renderInput(request.number, controller, request.generation), { signal: controller.signal }); }
          catch (error) { if (request.generation === sourceGeneration) { sourceError = error; sourceReady = false; canvas.width = canvas.height = 0; canvas.removeAttribute('data-pdf-page'); report(error); } }
        }
      } finally { sourceRunning = false; sourceController = null; update(); }
    })();
    return sourceWork;
  }
  function operation(token, controller) {
    return { signal: controller.signal, isCurrent: () => token === operationId && !controller.signal.aborted && current() };
  }
  async function prepare(op) {
    const value = await lane.run(() => ui.getWorkspaceInput({ bakeScene: true, bakeComposition: true, operation: op }), { signal: op.signal });
    if (!op.isCurrent() || !value) throw abortError();
    input = { ...value, boundary: ui.documentSession.snapshot().current?.boundary };
    if (input.bytes.length > COMPRESSION_LIMITS.inputBytes) { readOnly('bytes'); return false; }
    source.hidden = false; readonly.hidden = true; actions.hidden = false;
    identity.textContent = `${input.displayName || input.name} · ${ui.formatBytes(input.bytes.length)}` + (input.losses.length ? '. ' + text('baked', 'The shown input includes pending edits; sizes compare against these baked bytes.') : '');
    pageNumber = Math.max(1, Math.min(pageCount || 1, input.selection?.[0] + 1 || pageNumber));
    // Source rendering reserves its own native job after input baking drains.
    busy = false; await requestPage(pageNumber); busy = true;
    if (!op.isCurrent()) throw abortError();
    if (!sourceReady) throw sourceError || new Error('The actual input preview is unavailable. Retry before optimizing.');
    return true;
  }
  async function showCandidate(op) {
    resultHost.hidden = true;
    const artifact = candidate;
    const reviewed = await ui.reviewResult(artifact.bytes, artifact.name, { ...artifact, operation: op, imageWorkLane: lane,
      onAdopt(nextOwner) {
        // Shared Use has already committed. Validate its actual returned owner
        // against the live task before rebasing the operation's owner.
        if (disposed || paused || signal.aborted || !isCurrent() || op.signal.aborted || !sameCompressOwner(nextOwner, ui.documentSession.snapshot()) || nextOwner.taskId !== owner.taskId) return;
        owner = nextOwner; chosen = true; ui.showDocumentIdentity();
        void publishChosen(op).catch(report);
      },
    });
    if (!op.isCurrent()) throw abortError();
    const ready = reviewed?.querySelector('#documentResultPreview[aria-busy="false"] canvas[data-pdf-page]');
    if (!ready || ready.width < 1 || ready.height < 1) throw new Error(text('result_preview_failed', 'The verified result preview could not be displayed. Retry preview; no download or Use is available yet.'));
    if (reviewed.parentElement !== resultHost) resultHost.append(reviewed);
    resultHost.hidden = false; retry.hidden = true;
    if (chosen) await publishChosen(op);
  }
  async function publishChosen(op) {
    if (!op.isCurrent() || !chosen || resultHost.hidden) return;
    const artifact = ui.documentSession.current();
    await ui.offerChain(artifact.bytes, artifact.name, [{ slug: 'view-pdf', label: 'Reader' }], { ...artifact, operation: op, continuationOperation: op });
  }
  function run(kind) {
    const previousJobs = [...jobs], priorSource = sourceWork;
    operationController?.abort(); stopSource(); const token = ++operationId, controller = new AbortController(); operationController = controller;
    const op = operation(token, controller); busy = true; resultHost.hidden = true; retry.hidden = true; ui.hideError(); update();
    const cleanup = ui.clearResultAndDrain(); cleanup.catch(() => {});
    const promise = (async () => {
      try {
        await Promise.allSettled([...previousJobs, priorSource]); await cleanup; reportCleanupFailure(); await drainNative(); await lane.drained();
        if (!op.isCurrent()) throw abortError();
        if (admitted.readOnly) { readOnly(admitted.reason); return; }
        if (kind !== 'review' || !candidate) {
          if (!await prepare(op)) return;
        } else {
          busy = false; await requestPage(pageNumber); busy = true;
          if (!op.isCurrent() || !sourceReady) throw new Error('The current input preview is unavailable. Retry preview.');
        }
        if (kind === 'optimize') {
          if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') throw new Error(text('unsupported', 'This browser does not provide the native deflate streams required for structural optimization. The current PDF was retained.'));
          setStatus(text('checking', 'Optimizing eligible streams and verifying the actual PDF…'));
          const [pdfLib, pdfjs] = await Promise.all([engines.ensurePdfLib(), engines.ensurePdfJs()]);
          if (!op.isCurrent()) throw abortError();
          const result = await lane.run(() => optimizePdfStructure(input.bytes, { pdfLib, pdfjs, pdfjsAssets: engines.PDFJS_ASSET_URLS, canvasFactory: () => document.createElement('canvas'), signal: controller.signal, capabilities: input.capabilities,
            onProgress(value) { if (op.isCurrent()) setStatus(text('progress', 'Verifying PDF: {phase}', { phase: value.phase })); },
          }), { signal: controller.signal });
          if (!op.isCurrent()) throw abortError();
          const names = result.reduced ? optimizedNames(input) : { name: input.name, displayName: input.displayName };
          candidate = { ...result, ...names, type: 'application/pdf', boundary: inputBoundary(input, input.boundary, result.reduced) }; chosen = false;
          summary.textContent = result.reduced ? text('reduced', 'Verified output: {before} → {after}. Review the actual file before Use or Download.', { before: ui.formatBytes(result.sourceBytes), after: ui.formatBytes(result.resultBytes) }) : text('no_reduction', 'No size reduction: the input bytes were retained. The shown input and output are byte identical.');
          if (input.losses.length) summary.textContent += ' ' + text('baked', 'The shown input includes pending edits; sizes compare against these baked bytes.');
          summary.hidden = false;
        }
        if (candidate && kind !== 'prepare') await showCandidate(op);
        setStatus(candidate && kind !== 'prepare' ? text('review_ready', 'Actual result ready for review. Use is optional; Download requires your click.') : text('ready', 'Input preview ready. Optimize and review to check for a smaller PDF.'));
      } catch (error) { if (op.isCurrent()) { resultHost.hidden = true; report(error); } }
      finally { if (token === operationId) { busy = false; update(); } }
    })();
    return track(promise);
  }
  async function resume() {
    paused = false; if (!current()) return;
    await styles(); own();
    return run(candidate ? 'review' : 'prepare');
  }
  signal.addEventListener('abort', () => { disposed = true; pauseWork(); }, { once: true });
  update();
  return { open: resume, resume, pause, drained, dispose() { disposed = true; pauseWork(); } };
}
