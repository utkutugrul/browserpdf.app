import { readPdfFile, wireDropzone, takeChainedFile, showError, documentSession, createOperationScope } from './tool-ui.js';

const intake = createOperationScope();
let workspace, opening, controller, epoch = 0, localIntent = 0;
const sameOwner = (owner) => { const now = documentSession.snapshot(); return owner.taskId === now.taskId && owner.revision === now.revision && owner.generation === now.generation; };
async function handleFile(file, intent, expectedOwner) {
  if (!file || intent !== localIntent) return;
  const request = intake.begin(), before = expectedOwner || documentSession.snapshot();
  if (opening) await opening.catch(() => {});
  if (intent !== localIntent || !request.isCurrent() || !sameOwner(before)) return;
  const operation = { signal: request.signal, isCurrent: () => request.isCurrent() && intent === localIntent && sameOwner(before) };
  const parsed = await readPdfFile(file, { validate: true, maxPages: 10000, operation });
  if (!parsed || intent !== localIntent || !request.isCurrent() || !sameOwner(parsed.owner)) return;
  const token = ++epoch, owner = parsed.owner;
  let installed = false, pending;
  const isCurrent = () => token === epoch && (installed ? owner.taskId === documentSession.snapshot().taskId : sameOwner(owner));
  controller?.abort(); workspace?.dispose(); workspace = null;
  try {
    pending = (async () => {
      if (!isCurrent()) return;
      controller = new AbortController();
      const { openReaderWorkspace } = await import('./reader-workspace.js');
      if (!isCurrent()) return;
      const result = await openReaderWorkspace(parsed, { isCurrent, signal: controller.signal });
      if (!isCurrent()) { result.dispose(); return; }
      workspace = result; installed = true;
      if (!file.browserpdfSession) history.replaceState(null, '', location.pathname);
    })(); opening = pending;
    await pending;
  } catch (error) { if (isCurrent() && error.name !== 'AbortError') showError(error.message); }
  finally { if (opening === pending) opening = null; }
}
wireDropzone(document.getElementById('dropzone'), document.getElementById('fileInput'), (files) => { const intent = ++localIntent; void handleFile(files[0], intent); });
const initialIntent = localIntent, initialOwner = documentSession.snapshot();
void takeChainedFile({ isCurrent: () => localIntent === initialIntent && sameOwner(initialOwner) }).then((file) => { if (file && localIntent === initialIntent) return handleFile(file, initialIntent, initialOwner); });
