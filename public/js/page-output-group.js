import { reviewResult, offerChain, clearResult, downloadBytes, formatBytes, showError } from './tool-ui.js';
import { t } from './i18n.js';
import { outputBudget } from './core/page-split.js';
import { safeOutputName, outputExtension } from './core/output-names.js';
import { createOutputZip } from './core/output-zip.js';

export function createOutputGroup(results, { container, signal, isCurrent = () => true, onAdopt, zipName = 'outputs.zip' } = {}) {
  const total = outputBudget(results), used = new Set();
  const artifacts = results.map((value) => ({ ...value, name: safeOutputName(value.name, outputExtension(value.type), used) }));
  results = null; // Drop the caller's full group reference before any asynchronous review.
  let disposed = false, selection = 0, selected = 0, start = 0, zip = null;
  const root = document.createElement('section'); root.id = 'pageOutputGroup'; root.className = 'page-output-group';
  const title = document.createElement('h2'); title.textContent = t('pages.outputs', 'Output files');
  const status = document.createElement('p'); status.id = 'outputListStatus'; status.setAttribute('role', 'status');
  const help = document.createElement('p'); help.className = 'option-hint'; help.textContent = t('pages.output_limits', 'All outputs are listed: up to 10,000 files and 96 MiB combined. ZIP is limited to 100 MiB. Edit a filename; duplicate names receive a numbered suffix.');
  const list = document.createElement('ol'); list.id = 'outputList';
  const controls = document.createElement('div'); controls.className = 'page-effect-actions';
  function button(label, id, run) { const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-ghost btn-small'; button.id = id; button.textContent = label; button.addEventListener('click', () => { Promise.resolve(run()).catch((error) => { if (owns() && error.name !== 'AbortError') showError(error.message); }); }); return button; }
  const previous = button(t('pages.previous_files', 'Previous files'), 'outputPreviousBtn', () => { start = Math.max(0, start - 12); render(); });
  const next = button(t('pages.next_files', 'Next files'), 'outputNextBtn', () => { start = Math.min(artifacts.length - 1, start + 12); render(); });
  const cancel = button(t('common.cancel', 'Cancel ZIP'), 'cancelZipBtn', () => { zip?.abort(); zip = null; download.disabled = false; cancel.hidden = true; }); cancel.hidden = true;
  const download = button(t('pages.download_zip', 'Download all as ZIP'), 'downloadZipBtn', async () => {
    if (!owns() || zip) return; const controller = new AbortController(); zip = controller; download.disabled = true; cancel.hidden = false;
    try { const bytes = await createOutputZip(artifacts, { signal: controller.signal }); if (owns() && zip === controller) downloadBytes(bytes, safeOutputName(zipName, '.zip'), 'application/zip', { download: true }); }
    finally { if (zip === controller) { zip = null; download.disabled = false; cancel.hidden = true; } }
  });
  controls.append(previous, next, download, cancel); root.append(title, status, help, list, controls); container.append(root);
  function dispose() {
    if (disposed) return; disposed = true; selection++; zip?.abort(); zip = null;
    signal?.removeEventListener('abort', dispose); list.replaceChildren(); root.replaceChildren(); root.remove(); artifacts.length = 0;
  }
  const owns = () => !disposed && !signal?.aborted && isCurrent();
  async function select(index) {
    if (!owns() || !artifacts[index]) return; selected = index; const token = ++selection;
    const operation = { isCurrent: () => owns() && token === selection };
    clearResult(); const artifact = artifacts[index];
    await reviewResult(artifact.bytes, artifact.name, { ...artifact, operation, onAdopt });
    if (operation.isCurrent()) await offerChain(artifact.bytes, artifact.name, artifact.type.startsWith('image/') ? [{ slug: 'jpg-to-pdf', label: 'JPG / PNG to PDF' }, { slug: 'images', label: 'Images' }] : [], { ...artifact, operation });
    if (operation.isCurrent()) render();
  }
  function render() {
    if (!owns()) return;
    const end = Math.min(artifacts.length, start + 12); list.replaceChildren(); list.start = start + 1;
    status.textContent = `${artifacts.length} ${t('pages.files', 'files')} · ${formatBytes(total)} · ${start + 1}–${end} · ${t('pages.chosen', 'Chosen')}: ${artifacts[selected].name}`;
    previous.disabled = start === 0; next.disabled = end >= artifacts.length;
    for (let i = start; i < end; i++) {
      const artifact = artifacts[i], item = document.createElement('li'); item.className = 'page-output-row';
      const input = document.createElement('input'); input.type = 'text'; input.value = artifact.name; input.maxLength = 128; input.dataset.outputName = String(i); input.setAttribute('aria-label', `${t('pages.output_name', 'Output filename')} ${i + 1}`);
      input.addEventListener('input', () => { ++selection; zip?.abort(); zip = null; download.disabled = false; cancel.hidden = true; clearResult(); });
      input.addEventListener('change', () => { const names = new Set(artifacts.filter((_, index) => index !== i).map((value) => value.name.toLocaleLowerCase('en'))); artifact.name = safeOutputName(input.value, outputExtension(artifact.type), names); input.value = artifact.name; void select(i).catch((error) => { if (owns()) showError(error.message); }); });
      const choose = button(t('pages.review_file', 'Review'), '', () => select(i)); choose.dataset.outputIndex = String(i); if (i === selected) choose.setAttribute('aria-current', 'true');
      const meta = document.createElement('span'); meta.textContent = `${formatBytes(artifact.bytes.length)}${artifact.pages ? ' · ' + artifact.pages.join(', ') : ''}`;
      item.append(input, meta, choose); list.append(item);
    }
  }
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
  const handle = { artifacts, dispose, select, ready: Promise.resolve() };
  if (!disposed) { render(); handle.ready = select(0).catch((error) => { dispose(); throw error; }); }
  return handle;
}
