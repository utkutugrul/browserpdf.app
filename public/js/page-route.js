import { readPdfFile, wireDropzone, takeChainedFile, showError, hideError, documentSession } from './tool-ui.js';

// Keep each entry URL lightweight. The shared task surface is loaded on intake.
export function startPageRoute(mode) {
  let epoch = 0, workspace = null;
  async function open(file) {
    const parsed = await readPdfFile(file, { validate: true, maxPages: 10000 });
    if (!parsed) return;
    const token = ++epoch, taskId = documentSession.snapshot().taskId;
    workspace?.dispose(); workspace = null; hideError();
    try {
      const { openPageTask } = await import('./page-task-workspace.js');
      const owns = () => token === epoch && taskId === documentSession.snapshot().taskId;
      if (!owns()) return;
      const next = await openPageTask(mode, { isCurrent: owns });
      if (!owns()) { next.dispose(); return; }
      workspace = next;
      if (!file.browserpdfSession) history.replaceState(null, '', location.pathname);
    } catch (error) { if (token === epoch && error.name !== 'AbortError') showError(error.message); }
  }
  wireDropzone(document.getElementById('dropzone'), document.getElementById('fileInput'), (files) => { void open(files[0]); });
  takeChainedFile().then((file) => { if (file) void open(file); });
}
