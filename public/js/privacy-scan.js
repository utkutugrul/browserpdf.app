import { t } from './i18n.js';
import * as ui from './tool-ui.js';
import { setupPrivacyScanWebMcp } from './webmcp.js';

// Intent belongs to this small entry, before any optional module or File read.
const $ = id => document.getElementById(id);
const text = (key, fallback) => t(`privacy_workspace.${key}`, fallback);
const same = (a, b) => a.taskId === b.taskId && a.revision === b.revision && a.generation === b.generation;
let intent = 0, controller = null, pending = null, modulePromise = null, moduleAttempt = 0, workspace = null;
const getWorkspace = () => modulePromise ||= import(moduleAttempt ? `./privacy-workspace.js?retry=${moduleAttempt}` : './privacy-workspace.js')
  .then(module => workspace ||= module.createPrivacyWorkspace({ refresh: () => webmcp.refresh() }))
  .catch(error => { modulePromise = null; moduleAttempt++; throw error; });
function revoke(kind) {
  intent++; controller?.abort(); controller = null; pending = null;
  workspace?.invalidate(kind);
  return intent;
}
function entryBusy(busy) {
  $('privacyWorkspace').setAttribute('aria-busy', String(busy));
  $('cancelBtn').disabled = !busy;
  $('clearBtn').disabled = !busy && !workspace?.getSelectedFile();
  if (busy) $('scanBtn').disabled = true;
}
function failure(error) {
  if (error?.name === 'AbortError') return;
  ui.showError(text('load_failed', 'This local operation could not load or finish. Choose the PDF again to retry.'));
  $('privacyStatus').textContent = text('load_retry', 'No new document was accepted. Your preceding task is retained.');
}
function accept(file, inheritedIntent) {
  if (!file || inheritedIntent !== undefined && inheritedIntent !== intent) return;
  const ticket = revoke('file'), expectedOwner = ui.documentSession.snapshot(), own = new AbortController();
  controller = own; pending = file; ui.hideError(); entryBusy(true);
  $('privacyStatus').textContent = text('reading', 'Opening the selected PDF locally. Cancel and Clear remain available.');
  const isCurrent = () => ticket === intent && controller === own && !own.signal.aborted;
  void getWorkspace().then(value => {
    if (!isCurrent() || pending !== file) return;
    pending = null;
    return value.accept(file, { signal: own.signal, isCurrent, expectedOwner, inherited: inheritedIntent !== undefined });
  }).catch(error => { if (isCurrent()) failure(error); }).finally(() => {
    if (isCurrent()) { pending = null; workspace ? workspace.refresh() : entryBusy(false); webmcp.refresh(); }
  });
}
$('clearBtn').addEventListener('click', () => {
  revoke('clear');
  if (workspace) workspace.clear();
  else { entryBusy(false); ui.hideError(); ui.hideProgress(); $('privacyStatus').textContent = text('empty', 'Choose a PDF of at most 32 MiB and 1000 pages.'); }
  $('fileInput').value = ''; history.replaceState(null, '', location.pathname); webmcp.refresh();
});
$('cancelBtn').addEventListener('click', () => {
  revoke('cancel');
  if (workspace) workspace.cancel();
  else { entryBusy(false); ui.hideProgress(); $('privacyStatus').textContent = text('canceled', 'Canceled. No pending file will be read.'); }
  webmcp.refresh();
});
ui.wireDropzone($('dropzone'), $('fileInput'), files => accept(files[0]));
const webmcp = setupPrivacyScanWebMcp({
  getSelectedFile: () => workspace?.getSelectedFile() || null,
  scanSelected: options => workspace ? workspace.scan(options) : Promise.reject(new Error('Select a PDF first.')),
});
const params = new URLSearchParams(location.search), workflow = params.get('workflow'), file = params.get('file');
if (workflow && file?.startsWith(`${workflow}:`)) {
  const ticket = intent, expected = ui.documentSession.snapshot(), own = new AbortController(); controller = own;
  const isCurrent = () => ticket === intent && controller === own && !own.signal.aborted && same(expected, ui.documentSession.snapshot());
  entryBusy(true); $('privacyStatus').textContent = text('restoring', 'Restoring the chosen PDF. You can select another file or clear this request.');
  // READ stays outside the native lane. Held storage never delays native B.
  void ui.takeChainedFile({ signal: own.signal, isCurrent }).then(value => { if (value && isCurrent()) accept(value, ticket); })
    .catch(error => { if (isCurrent()) failure(error); }).finally(() => { if (isCurrent()) { entryBusy(false); webmcp.refresh(); } });
}
