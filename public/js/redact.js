import * as ui from './tool-ui.js';

let workspace, opening, openingController, localIntent = 0, surfaceEpoch = 0;
let draining = Promise.resolve();
const intake = ui.createOperationScope();
const snapshot = () => ui.documentSession.snapshot();
function clear() {
  localIntent++; surfaceEpoch++; intake.cancel(); openingController?.abort();
  const previous = workspace; workspace = null; previous?.dispose();
  draining = Promise.allSettled([draining, previous?.settled(), opening]).then(() => {});
  ui.documentSession.clear(); ui.clearResult(); history.replaceState(null, '', location.pathname);
}
async function handleFile(file, intent) {
  if (!file || intent !== localIntent) return;
  const token = intake.begin(), before = snapshot(); workspace?.suspend();
  const operation = { signal: token.signal, isCurrent: () => { const now = snapshot(); return token.isCurrent() && intent === localIntent && now.taskId === before.taskId && now.revision === before.revision && now.generation === before.generation; } };
  try {
    // Redact has local masks, not a new editable scene. Current PDFs may reach
    // 250 MiB; shared begin validates inherited source/assets/history jointly.
    const parsed = await ui.readPdfFile(file, { validate: true, maxBytes: 250 * 1024 * 1024, maxPages: 10000, allowInheritedScene: true, operation });
    if (intent !== localIntent || !token.isCurrent()) return;
    if (!parsed) {
      if (opening) await opening.catch(() => {});
      if (intent !== localIntent || !token.isCurrent()) return;
      await workspace?.resume(); return;
    }
    const epoch = ++surfaceEpoch, task = snapshot().taskId;
    const owns = () => epoch === surfaceEpoch && task === snapshot().taskId;
    openingController?.abort(); const previous = workspace; workspace = null; previous?.dispose();
    const waiting = document.createElement('p'); waiting.id = 'redactTransitionStatus'; waiting.setAttribute('role', 'status'); waiting.textContent = 'Finishing abandoned native image work before opening the chosen PDF…'; document.getElementById('dropzone').after(waiting);
    try { await Promise.allSettled([draining, previous?.settled(), opening]); } finally { waiting.remove(); }
    if (!owns() || intent !== localIntent || !token.isCurrent()) return;
    if (!file.browserpdfSession) history.replaceState(null, '', location.pathname);
    const module = await import('./redact-workspace.js');
    if (!owns() || intent !== localIntent || !token.isCurrent()) return;
    openingController = new AbortController();
    opening = module.openRedactWorkspace(parsed, { isCurrent: owns, signal: openingController.signal, onClear: clear });
    const result = await opening;
    if (!owns()) { result.dispose(); return; }
    workspace = result;
    if (intent !== localIntent) workspace.suspend();
  } catch (error) { if (intent === localIntent && token.isCurrent() && error.name !== 'AbortError') ui.showError(error.message); }
  finally { if (intent === localIntent && token.isCurrent()) opening = null; }
}
ui.wireDropzone(document.getElementById('dropzone'), document.getElementById('fileInput'), (files) => { const intent = ++localIntent; void handleFile(files[0], intent); });
// Capture BEFORE the initial store read: a newer native intake or Clear wins
// even when an old handoff read finishes after that new document is ready.
const initialIntent = localIntent;
void ui.takeChainedFile().then((file) => { if (file && initialIntent === localIntent) return handleFile(file, initialIntent); }).catch((error) => { if (initialIntent === localIntent && error.name !== 'AbortError') ui.showError(error.message); });
