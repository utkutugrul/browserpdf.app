import * as ui from './tool-ui.js';

let workspace, opening, openingController, localIntent = 0, surfaceEpoch = 0;
const intake = ui.createOperationScope();
const current = () => ui.documentSession.snapshot();
function clear() {
  localIntent++; surfaceEpoch++; intake.cancel(); openingController?.abort(); workspace?.dispose(); workspace = null;
  ui.documentOperations.cancel(); ui.documentSession.clear(); ui.clearResult(); ui.showDocumentIdentity();
  history.replaceState(null, '', location.pathname);
}
async function handleFile(file, intent) {
  const token = intake.begin(), before = current(); workspace?.suspend();
  const operation = { signal: token.signal, isCurrent: () => { const now = current(); return token.isCurrent() && intent === localIntent && now.taskId === before.taskId && now.revision === before.revision && now.generation === before.generation; } };
  try {
    const parsed = await ui.readPdfFile(file, { validate: true, maxBytes: 80 * 1024 * 1024, maxPages: 10000, allowInheritedScene: true, operation });
    if (intent !== localIntent || !token.isCurrent()) return;
    if (!parsed) {
      // A retained first preview may still be opening when B fails validation.
      // Wait for A to publish its workspace before resuming that owned surface.
      if (opening) await opening.catch(() => {});
      if (intent !== localIntent || !token.isCurrent()) return;
      await workspace?.resume(); return;
    }
    const epoch = ++surfaceEpoch, task = current().taskId, owns = () => epoch === surfaceEpoch && task === current().taskId;
    openingController?.abort(); workspace?.dispose(); workspace = null;
    if (opening) await opening.catch(() => {});
    if (!owns() || intent !== localIntent || !token.isCurrent()) return;
    if (!file.browserpdfSession) history.replaceState(null, '', location.pathname);
    const module = await import('./highlight-workspace.js');
    if (!owns() || intent !== localIntent || !token.isCurrent()) return;
    openingController = new AbortController();
    opening = module.openHighlightWorkspace(parsed, { isCurrent: owns, signal: openingController.signal, onClear: clear });
    const result = await opening;
    if (!owns()) { result.dispose(); return; }
    workspace = result;
    if (intent !== localIntent) workspace.suspend();
  } catch (error) { if (intent === localIntent && token.isCurrent() && error.name !== 'AbortError') ui.showError(error.message); }
  finally { if (intent === localIntent && token.isCurrent()) opening = null; }
}

ui.wireDropzone(document.getElementById('dropzone'), document.getElementById('fileInput'), (files) => { const intent = ++localIntent; void handleFile(files[0], intent); });
const initialIntent = localIntent;
void ui.takeChainedFile().then((file) => { if (file && localIntent === initialIntent) return handleFile(file, initialIntent); }).catch((error) => { if (localIntent === initialIntent && error.name !== 'AbortError') ui.showError(error.message); });
