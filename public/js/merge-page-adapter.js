import { parsePageRanges } from './core/page-selection.js';
import { validatePagePlan } from './core/page-plan.js';
import { applyPagePlan } from './core/page-operations.js';
import { renderThumbnail } from './core/bounded-renderer.js';
import { t } from './i18n.js';

let thumbnailEpoch = 0, controller = null;
export function mergePageIndices(item) {
  return item.ranges?.trim() ? parsePageRanges(item.ranges, item.pageCount) : Array.from({ length: item.pageCount }, (_, index) => index);
}
export function validMergeRanges(items) {
  try { return items.every((item) => mergePageIndices(item).length > 0) && items.reduce((n, item) => n + mergePageIndices(item).length, 0) <= 10000; }
  catch { return false; }
}
export function appendMergeRange(item, row, onChange) {
  if (!document.getElementById('pageWorkspaceStyles')) { const link = document.createElement('link'); link.id = 'pageWorkspaceStyles'; link.rel = 'stylesheet'; link.href = '/css/page-workspace.css'; document.head.append(link); }
  const label = document.createElement('label'); label.className = 'merge-page-range'; label.textContent = t('pages.source_ranges', 'Pages (empty means all)');
  const input = document.createElement('input'); input.className = 'text-input'; input.type = 'text'; input.placeholder = '1-5,8'; input.value = item.ranges || ''; input.dataset.sourceRange = String(item.id);
  input.setAttribute('aria-label', t('pages.source_range_named', 'Pages from {name}', { name: item.file.name }));
  const error = document.createElement('span'); error.className = 'merge-range-error'; error.setAttribute('role', 'status');
  const validate = () => { try { mergePageIndices(item); input.removeAttribute('aria-invalid'); error.textContent = ''; } catch (failure) { input.setAttribute('aria-invalid', 'true'); error.textContent = failure.message; } };
  input.addEventListener('input', () => { item.ranges = input.value; validate(); onChange(); }); validate(); label.append(input, error); row.querySelector('.file-item-info').append(label);
}
export function renderMergeThumbnails(items, list) {
  const token = ++thumbnailEpoch; controller?.abort(); controller = new AbortController(); const signal = controller.signal;
  for (const canvas of list.querySelectorAll('canvas')) { canvas.width = canvas.height = 0; }
  const jobs = [];
  for (const item of items) {
    const row = list.querySelector(`[data-file-id="${item.id}"]`); if (!row) continue;
    const canvas = document.createElement('canvas'); canvas.className = 'merge-source-thumbnail'; canvas.setAttribute('aria-label', t('pages.source_preview', 'First selected page preview'));
    row.querySelector('.file-item-icon').replaceChildren(canvas);
    let pageIndex = 0; try { pageIndex = mergePageIndices(item)[0] || 0; } catch { /* retain first source page until corrected */ }
    jobs.push({ item, canvas, pageIndex });
  }
  void (async () => {
    for (const { item, canvas, pageIndex } of jobs) {
      if (signal.aborted || token !== thumbnailEpoch) return;
      try { await renderThumbnail({ bytes: item.bytes, pageIndex, canvas, signal, maxDimension: 100, maxPixels: 10000 }); }
      catch { if (!signal.aborted && token === thumbnailEpoch) canvas.setAttribute('aria-label', t('pages.preview_failed', 'Preview unavailable; source pages are still validated.')); }
    }
  })();
}
export function disposeMergeThumbnails(list) { ++thumbnailEpoch; controller?.abort(); for (const canvas of list.querySelectorAll('canvas')) canvas.width = canvas.height = 0; }
export async function executeMergePlan(items, context) {
  if (!validMergeRanges(items)) throw new RangeError(t('pages.invalid_merge_scope', 'Correct source ranges and keep between 1 and 10,000 output pages.'));
  const sources = items.map((item, index) => ({ id: `merge-${index}`, pageCount: item.pageCount }));
  const pages = items.flatMap((item, index) => mergePageIndices(item).map((pageIndex) => ({ id: `merge-${index}-${pageIndex}`, sourceId: sources[index].id, pageIndex, rotation: 0, crop: null })));
  const plan = validatePagePlan({ sources, pages });
  return applyPagePlan(items.map((item, index) => ({ id: sources[index].id, bytes: item.bytes })), plan, context);
}
