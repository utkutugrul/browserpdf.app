import { readPdfFile, wireDropzone, takeChainedFile, showError, showDocumentIdentity, documentSession } from './tool-ui.js';

// A new local file replaces only the owned tool surface. It does not need a
// storage round trip; persistence is reserved for deliberate mode transitions.
export function startObjectRoute(mode) {
  const section = document.querySelector('.dropzone-section');
  const originalMarkup = section.innerHTML;
  let workspace = null, opening = null, openingController = null, epoch = 0;
  function wire() { wireDropzone(document.getElementById('dropzone'), document.getElementById('fileInput'), (files) => { void handleFile(files[0]); }); }
  async function handleFile(file) {
    const parsed = await readPdfFile(file, { validate: true, maxBytes: 80 * 1024 * 1024, allowInheritedScene: true });
    if (!parsed) return;
    const owner = documentSession.snapshot().taskId, token = ++epoch;
    const ownsTask = () => token === epoch && owner === documentSession.snapshot().taskId;
    openingController?.abort(); workspace?.dispose(); workspace = null;
    try {
      if (opening) await opening.catch(() => {});
      if (!ownsTask()) return;
      if (!file.browserpdfSession) history.replaceState(null, '', location.pathname);
      section.innerHTML = originalMarkup; wire(); showDocumentIdentity();
      const { openObjectWorkspace } = await import('./object-workspace.js');
      if (!ownsTask()) return;
      openingController = new AbortController();
      opening = openObjectWorkspace(mode, parsed, { isCurrent: ownsTask, signal: openingController.signal });
      const opened = await opening;
      if (!ownsTask()) { opened.dispose(); return; }
      workspace = opened;
    } catch (error) { if (ownsTask() && error.name !== 'AbortError') showError(error.message); }
    finally { if (ownsTask()) opening = null; }
  }
  wire(); takeChainedFile().then((file) => { if (file) void handleFile(file); });
}
