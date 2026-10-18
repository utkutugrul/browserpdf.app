import { validatePageCount, MAX_PAGE_COUNT } from './page-selection.js';

export const MAX_PAGE_SOURCES = 20;
export const MAX_PAGE_PLAN_HISTORY = 30;
export const MAX_RETAINED_PLAN_PAGES = 60000;
const idPattern = /^[a-zA-Z0-9_-]{1,120}$/;

function source(value) {
  if (!value || typeof value.id !== 'string' || !idPattern.test(value.id) || value.id.length > 80) throw new TypeError('A stable source ID of at most 80 characters is required.');
  return { id: value.id, pageCount: validatePageCount(value.pageCount) };
}
function cropBox(value) {
  if (value == null) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new RangeError('A crop box must have positive finite dimensions.');
  return Object.freeze({ x, y, width, height });
}

// Plans contain IDs and geometry only. Bytes and DOM objects never enter history.
export function validatePagePlan(plan) {
  if (!plan || !Array.isArray(plan.sources) || !plan.sources.length || plan.sources.length > MAX_PAGE_SOURCES) throw new RangeError(`Use between 1 and ${MAX_PAGE_SOURCES} page sources.`);
  const sources = plan.sources.map(source), bySource = new Map(sources.map((item) => [item.id, item]));
  if (bySource.size !== sources.length) throw new TypeError('Source IDs must be unique.');
  if (!Array.isArray(plan.pages) || !plan.pages.length || plan.pages.length > MAX_PAGE_COUNT) throw new RangeError(`Keep between 1 and ${MAX_PAGE_COUNT} pages.`);
  const ids = new Set();
  const pages = plan.pages.map((page) => {
    if (!page || typeof page.id !== 'string' || !idPattern.test(page.id) || ids.has(page.id)) throw new TypeError('Page IDs must be stable and unique.');
    ids.add(page.id);
    const input = bySource.get(page.sourceId);
    if (!input || !Number.isInteger(page.pageIndex) || page.pageIndex < 0 || page.pageIndex >= input.pageCount) throw new RangeError('A page refers to an unavailable source page.');
    if (!Number.isFinite(page.rotation) || page.rotation % 90 !== 0) throw new RangeError('Page rotation must be a multiple of 90 degrees.');
    return Object.freeze({ id: page.id, sourceId: page.sourceId, pageIndex: page.pageIndex, rotation: ((page.rotation % 360) + 360) % 360, crop: cropBox(page.crop) });
  });
  return Object.freeze({ sources: Object.freeze(sources.map(Object.freeze)), pages: Object.freeze(pages) });
}

export function createPagePlan({ sourceId = 'source', pageCount }) {
  const input = source({ id: sourceId, pageCount });
  return validatePagePlan({ sources: [input], pages: Array.from({ length: pageCount }, (_, pageIndex) => ({ id: `${sourceId}-${pageIndex + 1}`, sourceId, pageIndex, rotation: 0, crop: null })) });
}

function selectedIds(plan, ids) {
  const available = new Set(plan.pages.map((page) => page.id));
  if (!Array.isArray(ids) || ids.length > MAX_PAGE_COUNT || ids.some((id) => !available.has(id))) throw new RangeError('Choose existing page IDs.');
  return new Set(ids);
}
function rebuild(plan, pages, sources = plan.sources) { return validatePagePlan({ sources, pages }); }
function insertionIndex(index, length) {
  if (!Number.isInteger(index) || index < 0 || index > length) throw new RangeError('Choose a valid insertion position.');
  return index;
}
function nextId(base, used) {
  let suffix = 1, id;
  do { id = `${base.slice(0, 106)}_copy_${suffix++}`; } while (used.has(id));
  used.add(id); return id;
}

export function movePageGroup(input, ids, beforeIndex) {
  const plan = validatePagePlan(input), selected = selectedIds(plan, ids);
  insertionIndex(beforeIndex, plan.pages.length);
  const group = plan.pages.filter((page) => selected.has(page.id));
  const rest = plan.pages.filter((page) => !selected.has(page.id));
  const adjusted = beforeIndex - plan.pages.slice(0, beforeIndex).filter((page) => selected.has(page.id)).length;
  rest.splice(adjusted, 0, ...group); return rebuild(plan, rest);
}

export function duplicatePageGroup(input, ids, beforeIndex) {
  const plan = validatePagePlan(input), selected = selectedIds(plan, ids), used = new Set(plan.pages.map((page) => page.id));
  insertionIndex(beforeIndex, plan.pages.length);
  const copies = plan.pages.filter((page) => selected.has(page.id)).map((page) => ({ ...page, id: nextId(page.id, used) }));
  const pages = [...plan.pages]; pages.splice(beforeIndex, 0, ...copies); return rebuild(plan, pages);
}

export function deletePageGroup(input, ids, { keepSelected = false } = {}) {
  const plan = validatePagePlan(input), selected = selectedIds(plan, ids);
  return rebuild(plan, plan.pages.filter((page) => selected.has(page.id) === keepSelected));
}

export function rotatePageGroup(input, ids, degrees, { reset = false } = {}) {
  if (!Number.isFinite(degrees) || degrees % 90 !== 0) throw new RangeError('Page rotation must be a multiple of 90 degrees.');
  const plan = validatePagePlan(input), selected = selectedIds(plan, ids);
  return rebuild(plan, plan.pages.map((page) => selected.has(page.id) ? { ...page, rotation: reset ? 0 : page.rotation + degrees } : page));
}

export function cropPageGroup(input, ids, box) {
  const plan = validatePagePlan(input), selected = selectedIds(plan, ids), crop = cropBox(box);
  return rebuild(plan, plan.pages.map((page) => selected.has(page.id) ? { ...page, crop } : page));
}

export function insertPageSource(input, { sourceId, pageCount, pageIndices }, beforeIndex) {
  const plan = validatePagePlan(input), added = source({ id: sourceId, pageCount });
  insertionIndex(beforeIndex, plan.pages.length);
  const existing = plan.sources.find((item) => item.id === sourceId);
  if (existing && existing.pageCount !== pageCount) throw new RangeError('An existing source ID has a different page count.');
  const indices = pageIndices ?? Array.from({ length: pageCount }, (_, index) => index);
  if (!Array.isArray(indices) || !indices.length || indices.some((index) => !Number.isInteger(index) || index < 0 || index >= pageCount)) throw new RangeError('Choose valid source pages to insert.');
  const used = new Set(plan.pages.map((page) => page.id));
  const addedPages = indices.map((pageIndex) => ({ id: nextId(`${sourceId}-${pageIndex + 1}`, used), sourceId, pageIndex, rotation: 0, crop: null }));
  const pages = [...plan.pages]; pages.splice(beforeIndex, 0, ...addedPages);
  return rebuild(plan, pages, existing ? plan.sources : [...plan.sources, added]);
}

export function createPagePlanHistory(initial, { limit = MAX_PAGE_PLAN_HISTORY } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_PLAN_HISTORY) throw new RangeError('Choose a bounded page history limit.');
  let current = validatePagePlan(initial), past = [], future = [];
  const retainedPages = () => [current, ...past, ...future].reduce((count, plan) => count + plan.pages.length, 0);
  function bound() { while (past.length && (past.length > limit || retainedPages() > MAX_RETAINED_PLAN_PAGES)) past.shift(); }
  return {
    current: () => current,
    snapshot: () => ({ plan: current, canUndo: past.length > 0, canRedo: future.length > 0, retainedPlans: 1 + past.length + future.length, retainedPages: retainedPages(), pageBudget: MAX_RETAINED_PLAN_PAGES }),
    commit(next) { next = validatePagePlan(next); if (JSON.stringify(next) === JSON.stringify(current)) return current; past.push(current); current = next; future = []; bound(); return current; },
    undo() { if (!past.length) return null; future.push(current); current = past.pop(); return current; },
    redo() { if (!future.length) return null; past.push(current); current = future.pop(); return current; },
  };
}
