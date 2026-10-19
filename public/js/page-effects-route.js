import { readPdfFile, wireDropzone, takeChainedFile, documentSession, showError } from './tool-ui.js';
export function startPageEffectRoute(mode) {
  let workspace = null, opening = null, intake = 0, epoch = 0;
  async function open(file) {
    const readToken = ++intake; workspace?.suspend();
    const parsed = await readPdfFile(file, { validate: true, maxPages: 10000 });
    if (readToken !== intake) return;
    if (!parsed) { workspace?.resume(); return; }
    const token = ++epoch, taskId = documentSession.snapshot().taskId;
    const owns = () => token === epoch && taskId === documentSession.snapshot().taskId;
    workspace?.dispose(); workspace = null;
    try {
      // Finish abandoned construction/disposal before installing another surface.
      if (opening) await opening.catch(() => {});
      if (!owns()) return;
      const { openPageEffectWorkspace } = await import('./page-effects-workspace.js');
      if (!owns()) return;
      opening = openPageEffectWorkspace(mode, { isCurrent: owns });
      const next = await opening;
      if (!owns()) { next.dispose(); return; } workspace = next;
      if (!file.browserpdfSession) history.replaceState(null, '', location.pathname);
    } catch (error) { if (owns() && error.name !== 'AbortError') showError(error.message); }
    finally { if (owns()) opening = null; }
  }
  wireDropzone(document.getElementById('dropzone'), document.getElementById('fileInput'), (files) => { void open(files[0]); });
  takeChainedFile().then((file) => { if (file) void open(file); });
}
