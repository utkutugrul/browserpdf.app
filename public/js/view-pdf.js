import { readPdfFile, wireDropzone, takeChainedFile, showError, documentSession } from './tool-ui.js';

let workspace, opening, controller, epoch = 0;
async function handleFile(file) {
  const parsed = await readPdfFile(file, { validate: true, maxPages: 10000 });
  if (!parsed) return;
  const token = ++epoch, task = documentSession.snapshot().taskId;
  const isCurrent = () => token === epoch && task === documentSession.snapshot().taskId;
  controller?.abort(); workspace?.dispose(); workspace = null;
  try {
    if (opening) await opening.catch(() => {});
    if (!isCurrent()) return;
    controller = new AbortController();
    const { openReaderWorkspace } = await import('./reader-workspace.js');
    if (!isCurrent()) return;
    opening = openReaderWorkspace(parsed, { isCurrent, signal: controller.signal });
    const result = await opening;
    if (!isCurrent()) { result.dispose(); return; }
    workspace = result;
  } catch (error) { if (isCurrent() && error.name !== 'AbortError') showError(error.message); }
  finally { if (isCurrent()) opening = null; }
}
wireDropzone(document.getElementById('dropzone'), document.getElementById('fileInput'), (files) => { void handleFile(files[0]); });
takeChainedFile().then((file) => { if (file) void handleFile(file); });
