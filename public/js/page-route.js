import { readPdfFile, wireDropzone, takeChainedFile, showError, hideError, documentSession, createOperationScope } from './tool-ui.js';

// Keep each entry URL lightweight. The shared task surface is loaded on intake.
export function startPageRoute(mode) {
  const intake = createOperationScope();
  let epoch = 0, workspace = null, opening = null, localIntent = 0;
  const sameOwner = (owner) => { const now = documentSession.snapshot(); return owner.taskId === now.taskId && owner.revision === now.revision && owner.generation === now.generation; };
  async function open(file, intent, expectedOwner) {
    if (!file || intent !== localIntent) return;
    const request = intake.begin(), before = expectedOwner || documentSession.snapshot();
    if (opening) await opening.catch(() => {});
    if (intent !== localIntent || !request.isCurrent() || !sameOwner(before)) return;
    const operation = { signal: request.signal, isCurrent: () => request.isCurrent() && intent === localIntent && sameOwner(before) };
    const parsed = await readPdfFile(file, { validate: true, maxPages: 10000, operation });
    if (!parsed || intent !== localIntent || !request.isCurrent() || !sameOwner(parsed.owner)) return;
    const token = ++epoch, owner = parsed.owner;
    let installed = false, pending;
    const owns = () => token === epoch && (installed ? owner.taskId === documentSession.snapshot().taskId : sameOwner(owner));
    workspace?.dispose(); workspace = null; hideError();
    try {
      pending = (async () => {
        if (!owns()) return;
        const { openPageTask } = await import('./page-task-workspace.js');
        if (!owns()) return;
        const next = await openPageTask(mode, { isCurrent: owns });
        if (!owns()) { next.dispose(); return; }
        workspace = next; installed = true;
        if (!file.browserpdfSession) history.replaceState(null, '', location.pathname);
      })(); opening = pending;
      await pending;
    } catch (error) { if (owns() && error.name !== 'AbortError') showError(error.message); }
    finally { if (opening === pending) opening = null; }
  }
  wireDropzone(document.getElementById('dropzone'), document.getElementById('fileInput'), (files) => { const intent = ++localIntent; void open(files[0], intent); });
  const initialIntent = localIntent, initialOwner = documentSession.snapshot();
  void takeChainedFile({ isCurrent: () => localIntent === initialIntent && sameOwner(initialOwner) }).then((file) => { if (file && localIntent === initialIntent) return open(file, initialIntent, initialOwner); });
}
