'use strict';

import * as ui from './tool-ui.js';
import { t } from './i18n.js';

const byId = (id) => document.getElementById(id);
const sameOwner = (a, b) => a.taskId === b.taskId && a.revision === b.revision && a.generation === b.generation;
let intent = 0, candidate = null, accepted = null, runtimePromise, workspacePromise, runtimeAttempt = 0, workspaceAttempt = 0, cleanup = Promise.resolve();
let lastSelection = null;
const retiringWorkspaces = new Set();
function loadRuntime() {
  return runtimePromise ||= Promise.all([
    import(runtimeAttempt ? `./compress-intake.js?retry=${runtimeAttempt}` : './compress-intake.js'),
    import('./core/image-intake.js'), import('./lib-loader.js'),
  ]).then(([intake, native, engines]) => {
    const lane = native.createImageWorkLane();
    return { lane, engines, intake: intake.createCompressIntake({ session: ui.documentSession, ensureSession: ui.ensureDocumentSession, ensurePdfLib: engines.ensurePdfLib, ensurePdfJs: engines.ensurePdfJs, pdfjsAssets: engines.PDFJS_ASSET_URLS, lane }) };
  }).catch((error) => { runtimePromise = null; runtimeAttempt++; throw error; });
}
function loadWorkspace() {
  return workspacePromise ||= import(workspaceAttempt ? `./compress-workspace.js?retry=${workspaceAttempt}` : './compress-workspace.js').catch((error) => { workspacePromise = null; workspaceAttempt++; throw error; });
}
function removeWorkflow() {
  const url = new URL(location.href); url.searchParams.delete('workflow'); url.searchParams.delete('file');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
function status(message) { byId('compressionStatus').textContent = message; }
function controls() { byId('clearBtn').hidden = !candidate && !accepted; byId('cancelIntakeBtn').hidden = !candidate; }
async function openAccepted(record) {
  if (record !== accepted || record.paused || record.controller.signal.aborted) return;
  if (record.workspace) { await record.workspace.resume(); return; }
  if (record.opening) return record.opening;
  record.opening = (async () => {
    const module = await loadWorkspace();
    if (record !== accepted || record.paused || record.controller.signal.aborted || !sameOwner(ui.documentSession.snapshot(), record.data.owner)) return;
    record.workspace = module.createCompressWorkspace({ admitted: record.data, lane: record.runtime.lane, engines: record.runtime.engines, signal: record.controller.signal,
      isCurrent: () => record === accepted && !record.paused && !record.controller.signal.aborted,
    });
    await record.workspace.open();
  })().finally(() => { record.opening = null; });
  return record.opening;
}
function showFailure(error) { if (error.name !== 'AbortError') { ui.showError(error.message || String(error)); byId('retryIntakeBtn').hidden = false; } }
async function drainBeforeIntake(record, runtime) {
  // Capture and invalidate shared work outside its own native lane.
  const resultCleanup = ui.clearResultAndDrain();
  resultCleanup.catch(() => {});
  await cleanup; await resultCleanup;
  for (const workspace of [...retiringWorkspaces]) { await workspace.drained(); retiringWorkspaces.delete(workspace); }
  await record?.workspace?.drained(); await runtime.intake.drained(); await runtime.lane.drained();
}
async function choose(file, { inherited = false, initialToken } = {}) {
  if (!file || (initialToken !== undefined && initialToken !== intent)) return;
  const token = ++intent, controller = new AbortController(), prior = accepted;
  lastSelection = { file, inherited };
  candidate?.controller.abort(); candidate = { controller, token, file, inherited };
  if (prior) { prior.paused = true; prior.workspace?.pause(); }
  const expectedOwner = ui.documentSession.snapshot();
  const current = () => token === intent && candidate?.controller === controller && !controller.signal.aborted;
  const check = () => { controller.signal.throwIfAborted(); if (!current() || !sameOwner(ui.documentSession.snapshot(), expectedOwner)) throw new DOMException('Selection replaced.', 'AbortError'); };
  ui.hideError(); status(t('compress.structural_validating', 'Validating the PDF before replacing the current task…')); controls();
  try {
    const runtime = await loadRuntime(); check();
    await drainBeforeIntake(prior, runtime); check();
    const data = await runtime.intake.stage(file, { signal: controller.signal, isCurrent: current, expectedOwner, allowInheritedReadonly: inherited });
    if (!current() || !sameOwner(ui.documentSession.snapshot(), data.owner)) return;
    candidate = null;
    prior?.controller.abort(); prior?.workspace?.dispose();
    const record = { data, runtime, controller: new AbortController(), paused: false, workspace: null, opening: null };
    accepted = record;
    if (!inherited) removeWorkflow();
    ui.showDocumentIdentity(); status(t('compress.structural_opening', 'Opening the current input preview…')); controls();
    await openAccepted(record);
  } catch (error) {
    if (!current()) { if (token === intent && accepted?.data.owner && sameOwner(ui.documentSession.snapshot(), accepted.data.owner) && accepted !== prior) showFailure(error); return; }
    candidate = null; showFailure(error);
    if (error.code === 'COMPRESS_NATIVE_CLEANUP' || error.code === 'DOCUMENT_PREVIEW_CLEANUP') return;
    if (prior === accepted) {
      if (prior) { prior.paused = false; try { await openAccepted(prior); showFailure(error); } catch (resumeError) { showFailure(resumeError); } }
      else status(t('compress.structural_choose', 'Choose a PDF to optimize.'));
    }
  } finally { if (token === intent) { if (candidate?.controller === controller) candidate = null; controls(); } }
}
byId('retryIntakeBtn').addEventListener('click', () => {
  byId('retryIntakeBtn').hidden = true;
  const token = intent, record = accepted;
  if (record) void (async () => { const runtime = await loadRuntime(); await drainBeforeIntake(record, runtime); if (token !== intent || record !== accepted) return; record.paused = false; await openAccepted(record); })().catch(showFailure);
  else if (lastSelection) void choose(lastSelection.file, { inherited: lastSelection.inherited });
});
byId('cancelIntakeBtn').addEventListener('click', () => {
  intent++; candidate?.controller.abort(); candidate = null;
  if (accepted) {
    const token = intent, record = accepted;
    void (async () => { await drainBeforeIntake(record, record.runtime); if (token !== intent || record !== accepted) return; record.paused = false; await openAccepted(record); })().catch(showFailure);
  }
  else status(t('compress.structural_cancelled', 'Selection canceled. Choose a PDF to continue.'));
  controls();
});
byId('clearBtn').addEventListener('click', () => {
  intent++; candidate?.controller.abort(); candidate = null;
  const prior = accepted; accepted = null; prior?.controller.abort(); prior?.workspace?.dispose();
  if (prior?.workspace) retiringWorkspaces.add(prior.workspace);
  const resultCleanup = ui.clearResultAndDrain();
  ui.documentSession.clear(); removeWorkflow(); byId('compressionWorkspace').replaceChildren(); byId('compressionWorkspace').hidden = true;
  byId('retryIntakeBtn').hidden = true; ui.hideError(); status(t('compress.structural_choose', 'Choose a PDF to optimize.')); controls();
  lastSelection = null;
  const pendingCleanup = Promise.all([resultCleanup, prior?.workspace?.drained(), prior?.runtime.intake.drained(), prior?.runtime.lane.drained()]).then(() => {});
  cleanup = pendingCleanup.catch(() => {}); pendingCleanup.catch(showFailure);
});
ui.wireDropzone(byId('dropzone'), byId('fileInput'), (files) => { byId('retryIntakeBtn').hidden = true; void choose(files[0]); });
// Capture before optional descriptor import and every initial READ.
const initialToken = intent, initialOwner = ui.documentSession.snapshot(), initial = new AbortController();
const ownsInitial = () => initialToken === intent && sameOwner(ui.documentSession.snapshot(), initialOwner);
void ui.takeChainedFile({ signal: initial.signal, isCurrent: ownsInitial }).then((file) => {
  if (file && ownsInitial()) return choose(file, { inherited: true, initialToken });
}).catch((error) => { if (ownsInitial()) showFailure(error); });
