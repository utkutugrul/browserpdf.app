// Page numbers in the interface are one-based; session/core indices are zero-based.
export const MAX_PAGE_COUNT = 10000;

export class PageRangeError extends RangeError {
  constructor(message, token = '') { super(message); this.name = 'PageRangeError'; this.token = token; }
}

export function validatePageCount(pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGE_COUNT) {
    throw new RangeError(`Choose a document with between 1 and ${MAX_PAGE_COUNT} pages.`);
  }
  return pageCount;
}

export function normalizePageSelection(pages, pageCount) {
  validatePageCount(pageCount);
  if (!Array.isArray(pages) || pages.length > MAX_PAGE_COUNT || pages.some((page) => !Number.isInteger(page) || page < 0 || page >= pageCount)) {
    throw new PageRangeError(`Choose page numbers between 1 and ${pageCount}.`);
  }
  return [...new Set(pages)].sort((a, b) => a - b);
}

export function parsePageRanges(value, pageCount) {
  validatePageCount(pageCount);
  const text = String(value).trim();
  if (!text) return [];
  if (text.length > 60000) throw new PageRangeError('The page range is too long.');
  const intervals = [];
  for (const part of text.split(',')) {
    const token = part.trim(), match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(token);
    if (!match) throw new PageRangeError('Use page ranges such as 1-5,8.', token);
    const start = Number(match[1]), end = match[2] === undefined ? start : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end > pageCount) {
      throw new PageRangeError(`Choose page numbers between 1 and ${pageCount}.`, token);
    }
    if (end < start) throw new PageRangeError('Write each range from its first page to its last page.', token);
    intervals.push([start, end]);
  }
  intervals.sort((left, right) => left[0] - right[0]);
  const pages = []; let previous = 0;
  for (const [start, end] of intervals) {
    for (let page = Math.max(start, previous + 1); page <= end; page++) pages.push(page - 1);
    previous = Math.max(previous, end);
  }
  return pages;
}

export function pagesByParity(pageCount, parity) {
  validatePageCount(pageCount);
  if (!['odd', 'even', 'all', 'none'].includes(parity)) throw new TypeError('Choose odd, even, all, or none.');
  return Array.from({ length: pageCount }, (_, index) => index)
    .filter((index) => parity === 'all' || (parity === 'odd' && index % 2 === 0) || (parity === 'even' && index % 2 === 1));
}

export function formatPageRanges(pages, pageCount) {
  const selected = normalizePageSelection(pages, pageCount), ranges = [];
  for (let index = 0; index < selected.length; index++) {
    const first = selected[index]; let last = first;
    while (selected[index + 1] === last + 1) last = selected[++index];
    ranges.push(first === last ? String(first + 1) : `${first + 1}-${last + 1}`);
  }
  return ranges.join(',');
}

export function changePageSelection({ selected = [], anchor = null } = {}, pageIndex, {
  pageCount, shiftKey = false, additive = false,
} = {}) {
  const previous = normalizePageSelection(selected, pageCount);
  normalizePageSelection([pageIndex], pageCount);
  if (shiftKey && Number.isInteger(anchor) && anchor >= 0 && anchor < pageCount) {
    const first = Math.min(anchor, pageIndex), last = Math.max(anchor, pageIndex);
    const range = Array.from({ length: last - first + 1 }, (_, index) => first + index);
    return { selected: normalizePageSelection(additive ? [...new Set([...previous, ...range])] : range, pageCount), anchor };
  }
  const next = new Set(previous);
  if (next.has(pageIndex)) next.delete(pageIndex); else next.add(pageIndex);
  return { selected: [...next].sort((a, b) => a - b), anchor: pageIndex };
}
