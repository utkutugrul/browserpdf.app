import { readPdfFile, wireDropzone, takeChainedFile, showError, showDocumentIdentity, documentSession, createOperationScope } from './tool-ui.js';

// Validate replacements before releasing the current editable surface.
export function startObjectRoute(mode) {
  const section = document.querySelector('.dropzone-section');
  const originalMarkup = section.innerHTML;
  const intake = createOperationScope();
  let workspace = null, opening = null, openingController = null, epoch = 0, localIntent = 0;
  const sameOwner = (owner) => { const now = documentSession.snapshot(); return owner.taskId === now.taskId && owner.revision === now.revision && owner.generation === now.generation; };
  function wire() { wireDropzone(document.getElementById('dropzone'), document.getElementById('fileInput'), (files) => { const intent = ++localIntent; void handleFile(files[0], intent); }); }
  async function handleFile(file, intent, expectedOwner) {
    if (!file || intent !== localIntent) return;
    const request = intake.begin(), before = expectedOwner || documentSession.snapshot();
    if (opening) await opening.catch(() => {});
    if (intent !== localIntent || !request.isCurrent() || !sameOwner(before)) return;
    const operation = { signal: request.signal, isCurrent: () => request.isCurrent() && intent === localIntent && sameOwner(before) };
    const parsed = await readPdfFile(file, { validate: true, maxBytes: 80 * 1024 * 1024, allowInheritedScene: true, operation });
    if (!parsed || intent !== localIntent || !request.isCurrent() || !sameOwner(parsed.owner)) return;
    const owner = parsed.owner, token = ++epoch;
    let installed = false, pending;
    // Accepted A may still finish opening while rejected B is being validated.
    // Only another accepted task or Clear revokes that surface's lifetime.
    const ownsTask = () => token === epoch && (installed ? owner.taskId === documentSession.snapshot().taskId : sameOwner(owner));
    openingController?.abort(); workspace?.dispose(); workspace = null;
    try {
      pending = (async () => {
        if (!ownsTask()) return;
        if (!file.browserpdfSession) history.replaceState(null, '', location.pathname);
        section.innerHTML = originalMarkup; wire(); showDocumentIdentity();
        const { openObjectWorkspace } = await import('./object-workspace.js');
        if (!ownsTask()) return;
        openingController = new AbortController();
        const opened = await openObjectWorkspace(mode, parsed, { isCurrent: ownsTask, signal: openingController.signal });
        if (!ownsTask()) { opened.dispose(); return; }
        workspace = opened; installed = true;
      })(); opening = pending;
      await pending;
    } catch (error) { if (ownsTask() && error.name !== 'AbortError') showError(error.message); }
    finally { if (opening === pending) opening = null; }
  }
  wire();
  const initialIntent = localIntent, initialOwner = documentSession.snapshot();
  void takeChainedFile({ isCurrent: () => localIntent === initialIntent && sameOwner(initialOwner) }).then((file) => { if (file && localIntent === initialIntent) return handleFile(file, initialIntent, initialOwner); });
}
