import { readPdfFile, wireDropzone, takeChainedFile, documentSession, showError, createOperationScope } from './tool-ui.js';
export function startPageEffectRoute(mode) {
  const intake = createOperationScope();
  let workspace = null, opening = null, localIntent = 0, epoch = 0;
  const sameOwner = (owner) => { const now = documentSession.snapshot(); return owner.taskId === now.taskId && owner.revision === now.revision && owner.generation === now.generation; };
  async function open(file, intent, expectedOwner) {
    if (!file || intent !== localIntent) return;
    const request = intake.begin(), before = expectedOwner || documentSession.snapshot();
    if (opening) await opening.catch(() => {});
    if (intent !== localIntent || !request.isCurrent() || !sameOwner(before)) return;
    workspace?.suspend();
    const operation = { signal: request.signal, isCurrent: () => request.isCurrent() && intent === localIntent && sameOwner(before) };
    const parsed = await readPdfFile(file, { validate: true, maxPages: 10000, operation });
    if (intent !== localIntent || !request.isCurrent()) return;
    if (!parsed) {
      // A retained surface can still be constructing when B is rejected.
      if (opening) await opening.catch(() => {});
      if (intent === localIntent && request.isCurrent() && sameOwner(before)) workspace?.resume({ preserveError: true });
      return;
    }
    if (!sameOwner(parsed.owner)) return;
    const token = ++epoch, owner = parsed.owner;
    let installed = false, pending;
    const owns = () => token === epoch && (installed ? owner.taskId === documentSession.snapshot().taskId : sameOwner(owner));
    workspace?.dispose(); workspace = null;
    try {
      pending = (async () => {
        if (!owns()) return;
        const { openPageEffectWorkspace } = await import('./page-effects-workspace.js');
        if (!owns()) return;
        const next = await openPageEffectWorkspace(mode, { isCurrent: owns });
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
