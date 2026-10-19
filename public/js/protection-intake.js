import { PROTECTION_LIMITS, copyProtectionBytes, checkProtectionOwner, addProtectionAbortListener, removeProtectionAbortListener } from './core/pdf-protection-policy.js';
import { BOUNDARY_LOSSES } from './core/document-session.js';

export const sameProtectionOwner = (a, b) => a?.taskId === b?.taskId && a?.revision === b?.revision && a?.generation === b?.generation;
const localCodes = new Set(['invalid-pdf', 'input-limit', 'page-limit', 'requires-unlock', 'cleanup-failed', 'preview-failed', 'boundary-limit']);
export function workspaceError(code) { const error = new Error(localCodes.has(code) ? code : 'invalid-pdf'); error.code = error.message; return error; }
export function knownProtectionCapabilities(value) { return Object.fromEntries(['encrypted', 'searchable', 'forms', 'rasterized'].filter(key => typeof value?.[key] === 'boolean').map(key => [key, value[key]])); }
export function protectionGuard(options) { checkProtectionOwner(options); }
export function localIntakeOwner(generation) { return Object.freeze({ taskId: 'intake:' + crypto.randomUUID(), revision: 0, generation }); }

// The SDK admits these three boundary kinds and at most twelve finite losses.
// Reject an overflow instead of silently dropping an inherited disclosure.
export function protectionBoundary(prior, inputLosses = [], { rewrite = true } = {}) {
  const valid = prior && ['page-copy', 'pdf-rewrite', 'raster-redaction'].includes(prior.kind);
  const losses = [...new Set([...(valid ? prior.losses || [] : []), ...inputLosses, ...(rewrite ? ['signature-rewrite'] : [])].filter(code => BOUNDARY_LOSSES.includes(code)))];
  if (losses.length > 12) throw workspaceError('boundary-limit');
  return valid || losses.length || rewrite ? { kind: rewrite ? 'pdf-rewrite' : valid ? prior.kind : 'pdf-rewrite', losses } : undefined;
}

// document-result's disclosure renderer is private. Keep this finite route copy
// on its existing translation keys; it describes inherited processing as well.
const lossLabels = Object.freeze({
  'page-copy-structures-unverified': 'Copied pages may lose document structures that this engine cannot verify.',
  'page-copy-form-definitions': 'Page copying may lose interactive form definitions.',
  'page-copy-document-metadata': 'Page copying may lose document metadata.',
  'page-copy-bookmarks': 'Page copying may lose bookmarks.',
  'page-copy-tags': 'Page copying may lose accessibility tags.',
  'page-copy-named-resources': 'Page copying may lose named document resources.',
  'page-copy-labels': 'Page copying may lose page labels.',
  'signature-rewrite': 'Rewriting signed content can invalidate existing digital signatures.',
  'structure-inspection-incomplete': 'Some document structures could not be inspected.',
  'crop-hidden-content': 'Cropping hides content; it does not securely remove it.',
  'scene-baked': 'This operation includes pending edits in the PDF. Undo restores the preceding editable state.',
  'composition-baked': 'This operation includes the image composition in the PDF. Undo restores the preceding editable state.',
  'redaction-selected-pages-rasterized': 'Pages with redaction masks become images and lose selectable/searchable text and vector detail. Other supported pages keep their text.',
  'redaction-document-rasterized': 'Every page becomes an image. Searchable text, editable fields and annotations, links, bookmarks, attachments, tags and vector detail are not retained. Any existing digital signature is invalidated.',
  'redaction-metadata-removed': 'Source Info and XMP metadata are omitted from this new PDF. The original remains separately available in this task.',
});
export function protectionLossMessages(boundary, translate = (_, fallback) => fallback) {
  return (boundary?.losses || []).filter(code => Object.hasOwn(lossLabels, code)).map(code => translate('workspace.loss_' + code, lossLabels[code]));
}

// One active File read and one replaceable unread descriptor belong to the route.
export function createProtectionFileQueue(stage) {
  let generation = 0, active = null, pending = null, pumping = null;
  const canceled = () => { try { protectionGuard({ isCurrent: () => false }); } catch (error) { return error; } };
  async function pump() {
    while (pending) {
      const job = pending; pending = null; active = job;
      const options = { signal: job.controller.signal, isCurrent: () => job.generation === generation && !job.controller.signal.aborted && job.context.isCurrent() };
      try { protectionGuard(options); const data = await stage(job.file, options); protectionGuard(options); job.resolve({ data, ...options, generation: job.generation }); }
      catch (error) { job.reject(error); }
      finally { active = null; }
    }
  }
  function cancel() { generation++; active?.controller.abort(); if (pending) { pending.controller.abort(); pending.reject(canceled()); pending = null; } }
  return {
    replace(file, context) {
      cancel(); const token = generation, controller = new AbortController();
      const promise = new Promise((resolve, reject) => { pending = { file, context, controller, generation: token, resolve, reject }; });
      function start() { pumping = Promise.resolve().then(pump).finally(() => { pumping = null; if (pending) start(); }); pumping.catch(() => {}); }
      if (!pumping) start();
      return promise;
    },
    cancel,
    async drained() { while (pumping) await pumping; },
  };
}

export function createProtectionIntake({ ensurePdfLib, ensurePdfJs, pdfjsAssets = {} }) {
  const retained = new Map(), failed = new Set();
  async function release(task) {
    if (failed.has(task)) throw workspaceError('cleanup-failed');
    let work = retained.get(task);
    if (!work) { work = Promise.resolve().then(() => task.destroy()); retained.set(task, work); work.catch(() => {}); }
    try { await work; retained.delete(task); } catch { retained.set(task, null); failed.add(task); throw workspaceError('cleanup-failed'); }
  }
  async function drained({ retry = false } = {}) { for (const task of [...retained.keys()]) { if (retry) failed.delete(task); await release(task); } }
  async function read(file, options) {
    protectionGuard(options); await drained(); protectionGuard(options);
    if (!file || !Number.isSafeInteger(file.size) || file.size < 5 || file.size > PROTECTION_LIMITS.inputBytes) throw workspaceError('input-limit');
    if (file.type !== 'application/pdf' && !String(file.name).toLowerCase().endsWith('.pdf')) throw workspaceError('invalid-pdf');
    let buffer; try { buffer = await file.arrayBuffer(); } catch { protectionGuard(options); throw workspaceError('invalid-pdf'); }
    protectionGuard(options);
    if (!(buffer instanceof ArrayBuffer)) throw workspaceError('invalid-pdf');
    const bytes = copyProtectionBytes(new Uint8Array(buffer));
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw workspaceError('invalid-pdf');
    return { bytes, name: file.name, inherited: file.browserpdfSession || null };
  }
  async function validatePlain(bytes, options) {
    protectionGuard(options); await drained(); protectionGuard(options);
    const lib = await ensurePdfLib(); protectionGuard(options); let parsed = null, encrypted = false;
    try { parsed = await lib.PDFDocument.load(copyProtectionBytes(bytes), { updateMetadata: false, throwOnInvalidObject: true }); }
    catch { protectionGuard(options); try { const probe = await lib.PDFDocument.load(copyProtectionBytes(bytes), { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: true }); encrypted = probe.isEncrypted === true; } catch {} }
    protectionGuard(options);
    if (encrypted) throw workspaceError('requires-unlock');
    const pdfjs = await ensurePdfJs(); protectionGuard(options); let task, failure, pages;
    const abort = () => { if (task) void release(task).catch(() => {}); };
    try {
      task = pdfjs.getDocument({ data: copyProtectionBytes(bytes), ...pdfjsAssets, stopAtErrors: true, enableXfa: false }); retained.set(task, null);
      addProtectionAbortListener(options.signal, abort); protectionGuard(options);
      const doc = await task.promise; protectionGuard(options); pages = doc.numPages;
      if (!Number.isSafeInteger(pages) || pages < 1 || pages > PROTECTION_LIMITS.pages) throw workspaceError('page-limit');
      if (!parsed || parsed.isEncrypted || parsed.getPageCount() !== pages) throw workspaceError('invalid-pdf');
    } catch (error) {
      if (error?.name === 'PasswordException') failure = workspaceError('requires-unlock'); else failure = error?.code ? error : workspaceError('invalid-pdf');
    } finally {
      removeProtectionAbortListener(options.signal, abort);
      if (task) try { await release(task); } catch (error) { failure = error; }
    }
    protectionGuard(options); if (failure) throw failure;
    return { pages };
  }
  return { read, validatePlain, drained };
}
