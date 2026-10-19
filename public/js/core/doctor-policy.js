// Unreachable pure Doctor policy. No PDF engine, site or session dependency.
const MiB = 1024 * 1024;
export const DOCTOR_LIMITS = Object.freeze({
  inputBytes: 32 * MiB, outputBytes: 32 * MiB, pages: 1000, rebuildPages: 200,
  nodes: 10000, edges: 100000, depth: 64, pageVisits: 4000,
  textItemsPerPage: 10000, textUnitsPerPage: 100000, textItems: 100000, textUnits: 2000000,
  operatorsPerPage: 100000, operators: 1000000, annotationsPerPage: 1000, annotations: 10000, widgets: 1000,
  renderDimension: 4096, renderPixels: 4000000, pixels: 48000000, sourcePixels: 16000000,
  encodedPageBytes: 8 * MiB, encodedBytes: 32 * MiB, reportUnits: 256000, locations: 100, rows: 25,
  phaseMs: 20000, operationMs: 60000,
});
const keys = Object.keys;
const own = Object.getOwnPropertyDescriptor;
const has = Object.hasOwn;
const usageKeys = ['resourceBytes', 'resourceCount', 'artifactBytes', 'expandedBytes', 'expandedCount'];
const counters = ['pageVisits', 'nodes', 'edges', 'textItems', 'textUnits', 'operators', 'annotations', 'widgets', 'pixels', 'sourcePixels', 'encodedBytes'];
const checkKeys = ['pageTree', 'boxes', 'metadata', 'attachments', 'annotations', 'actions', 'forms', 'signatures', 'tags', 'language', 'title', 'alt', 'operators', 'text', 'render'];
const reasons = ['none', 'strict-rejected', 'tolerant-opened', 'pdfjs-rejected', 'page-mismatch', 'box-invalid', 'native-failed', 'work-limit', 'timeout', 'cleanup-failed', 'password-required', 'not-requested'];
const remedies = ['inspect', 'normalize', 'rebuild', 'unlock', 'unknown'];
const plain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function fail(message, code = 'DOCTOR_POLICY') { return Object.assign(new Error(message), { code }); }
function record(value, allowed, required = allowed) {
  if (!plain(value) || Reflect.ownKeys(value).some(key => !allowed.includes(key)) || required.some(key => !has(value, key))) throw new TypeError('Expected a finite own-data Doctor record.');
  for (const key of Reflect.ownKeys(value)) if (!has(own(value, key), 'value')) throw new TypeError('Doctor records require data properties.');
  return value;
}
function data(value, key) {
  const descriptor = value && own(value, key);
  if (!descriptor || !has(descriptor, 'value')) throw new TypeError('Expected an own data property.');
  return descriptor.value;
}
function scalar(value, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new TypeError('Expected a finite nonnegative Doctor integer.');
  return value;
}
function sum(...values) { return scalar(values.reduce((a, b) => a + scalar(b), 0)); }
function usage(value) {
  record(value, usageKeys, []);
  return Object.fromEntries(usageKeys.map(key => [key, has(value, key) ? scalar(data(value, key)) : 0]));
}
export function assertDoctorBudget(snapshot, live = {}, extra = {}) {
  // A real snapshot has nineteen metadata fields. Read only required scalars.
  if (!plain(snapshot)) throw new TypeError('A metadata snapshot is required.');
  const a = usage(live), b = usage(extra);
  const resourceBytes = sum(data(snapshot, 'resourceBytes'), a.resourceBytes, a.expandedBytes, b.resourceBytes, b.expandedBytes);
  const resourceCount = sum(data(snapshot, 'resourceCount'), a.resourceCount, a.expandedCount, b.resourceCount, b.expandedCount);
  const retainedBytes = sum(data(snapshot, 'retainedBytes'), ...usageKeys.filter(key => key.endsWith('Bytes')).flatMap(key => [a[key], b[key]]));
  if (resourceBytes > 96 * MiB || resourceCount > 128 || retainedBytes > 512 * MiB) throw fail('Doctor work exceeds the joint task budget.', 'DOCTOR_BUDGET');
  return Object.freeze({ resourceBytes, resourceCount, retainedBytes, remainingResourceBytes: 96 * MiB - resourceBytes, remainingResourceCount: 128 - resourceCount, remainingRetainedBytes: 512 * MiB - retainedBytes });
}
export function createDoctorWorkBudget(limits = DOCTOR_LIMITS) {
  record(limits, keys(DOCTOR_LIMITS), []);
  const cap = Object.fromEntries(counters.map(key => [key, has(limits, key) ? scalar(data(limits, key), DOCTOR_LIMITS[key]) : DOCTOR_LIMITS[key]]));
  for (const key of keys(limits)) if (!scalar(data(limits, key), DOCTOR_LIMITS[key])) throw new TypeError('Doctor limits must be positive.');
  let current = Object.fromEntries(counters.map(key => [key, 0]));
  return Object.freeze({
    admit(delta) {
      record(delta, counters, []);
      const next = { ...current };
      for (const key of keys(delta)) {
        next[key] = sum(next[key], data(delta, key));
        if (next[key] > cap[key]) throw fail(`Doctor ${key} work limit reached.`, 'DOCTOR_WORK_LIMIT');
      }
      current = next; return Object.freeze({ ...current });
    },
    usage: () => Object.freeze({ ...current }),
  });
}
function list(value, max, map) {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('Expected a bounded dense Doctor list.');
  return Array.from({ length: value.length }, (_, index) => map(data(value, String(index))));
}
function choice(value, allowed) { if (!allowed.includes(value)) throw new TypeError('Invalid Doctor enum.'); return value; }
function bool(value) { if (typeof value !== 'boolean') throw new TypeError('Expected a Doctor boolean.'); return value; }
function reportCopy(input) {
  record(input, ['version', 'mode', 'status', 'pageCount', 'parsers', 'checks', 'recommendation', 'coverage']);
  if (data(input, 'version') !== 2) throw new TypeError('Doctor workspace reports use version two.');
  const pageCount = data(input, 'pageCount') === null ? null : scalar(data(input, 'pageCount'), DOCTOR_LIMITS.pages);
  if (pageCount === 0) throw new TypeError('Unknown page count must be null.');
  const page = number => { scalar(number, pageCount ?? 0); if (!number) throw new TypeError('Invalid affected page.'); return number; };
  const uniquePages = value => { const out = list(value, DOCTOR_LIMITS.locations, page); if (new Set(out).size !== out.length) throw new TypeError('Duplicate affected page.'); return out; };
  const mode = choice(data(input, 'mode'), ['quick', 'deep']);
  const status = choice(data(input, 'status'), ['complete', 'partial', 'unknown', 'locked']);
  const parsers = {}, rawParsers = record(data(input, 'parsers'), ['strict', 'tolerant', 'pdfjs']);
  for (const key of keys(rawParsers)) {
    const raw = record(data(rawParsers, key), ['status', 'reason']);
    parsers[key] = { status: choice(data(raw, 'status'), ['ok', 'failed', 'unknown', 'locked', 'skipped']), reason: choice(data(raw, 'reason'), reasons) };
    if (parsers[key].status === 'locked' && parsers[key].reason !== 'password-required') throw new TypeError('Locked status needs typed password evidence.');
  }
  const checks = {}, rawChecks = record(data(input, 'checks'), checkKeys);
  for (const key of checkKeys) {
    const raw = record(data(rawChecks, key), ['status', 'count', 'lowerBound', 'pages']);
    const state = choice(data(raw, 'status'), ['complete', 'partial', 'unknown', 'locked', 'skipped']);
    const count = data(raw, 'count') === null ? null : scalar(data(raw, 'count'));
    const lowerBound = bool(data(raw, 'lowerBound'));
    if (state === 'complete' && (count === null || lowerBound) || ['unknown', 'locked', 'skipped'].includes(state) && count !== null || state === 'partial' && !lowerBound) throw new TypeError('Unknown and partial Doctor observations must be explicit.');
    checks[key] = { status: state, count, lowerBound, pages: uniquePages(data(raw, 'pages')) };
  }
  const raw = record(data(input, 'coverage'), ['pagesChecked', 'renderedPages', 'omitted', 'complete']);
  const coverage = { pagesChecked: scalar(data(raw, 'pagesChecked'), pageCount ?? 0), renderedPages: uniquePages(data(raw, 'renderedPages')), omitted: scalar(data(raw, 'omitted')), complete: bool(data(raw, 'complete')) };
  const recommended = record(data(input, 'recommendation'), ['remedy', 'reason']);
  const recommendation = { remedy: choice(data(recommended, 'remedy'), remedies), reason: choice(data(recommended, 'reason'), reasons) };
  const result = { version: 2, mode, status, pageCount, parsers, checks, recommendation, coverage };
  if (JSON.stringify(result).length > DOCTOR_LIMITS.reportUnits) throw fail('Doctor report limit reached.', 'DOCTOR_REPORT_LIMIT');
  return result;
}
function advice(report) {
  const { parsers: p, coverage: c, checks: k, pageCount: n } = report;
  if (p.pdfjs.status === 'locked' && p.pdfjs.reason === 'password-required') return { remedy: 'unlock', reason: 'password-required' };
  const unknown = { remedy: 'unknown', reason: 'native-failed' };
  if (Object.values(p).some(value => ['work-limit', 'timeout', 'cleanup-failed', 'password-required'].includes(value.reason) || value.status === 'locked')) return unknown;
  if (report.status !== 'complete' || !n || !c.complete || c.omitted || c.pagesChecked !== n || p.pdfjs.status !== 'ok') return unknown;
  if (Object.entries(k).some(([key, value]) => value.status !== 'complete' && !(report.mode === 'quick' && ['operators', 'text', 'render'].includes(key) && value.status === 'skipped'))) return unknown;
  const allRendered = k.render.status === 'complete' && k.render.count === n && c.renderedPages.length === n && c.renderedPages.every((page, index, all) => all.includes(index + 1));
  if (report.mode === 'deep' && !allRendered) return unknown;
  if (k.pageTree.count || k.boxes.count) return { remedy: 'unknown', reason: k.pageTree.count ? 'page-mismatch' : 'box-invalid' };
  if (p.strict.status === 'ok') return { remedy: 'inspect', reason: 'none' };
  if (p.strict.status === 'failed' && p.tolerant.status === 'ok') return { remedy: 'normalize', reason: 'tolerant-opened' };
  // Failed strict AND tolerant parsing makes this normalizer unavailable.
  // Merely setting recommendation.remedy or complete is never render proof.
  if (p.strict.status === 'failed' && p.tolerant.status === 'failed' && report.mode === 'deep' && n <= DOCTOR_LIMITS.rebuildPages && allRendered) return { remedy: 'rebuild', reason: 'strict-rejected' };
  return unknown;
}
export function recommendDoctor(report) { return Object.freeze(advice(reportCopy(report))); }
export function doctorView(input, options = {}) {
  record(options, ['page', 'offset'], []);
  const report = reportCopy(input), page = has(options, 'page') ? scalar(data(options, 'page'), report.pageCount ?? 1) : 1;
  const offset = has(options, 'offset') ? scalar(data(options, 'offset')) : 0;
  if (!page) throw new TypeError('An affected page starts at one.');
  const rows = checkKeys.flatMap(key => report.checks[key].pages.filter(n => n === page).map(n => ({ check: key, page: n, status: report.checks[key].status, count: report.checks[key].count })));
  return { version: 2, page, pageCount: report.pageCount, status: report.status, categories: checkKeys.map(key => ({ key, ...report.checks[key] })), coverage: report.coverage, recommendation: advice(report), rows: rows.slice(offset, offset + DOCTOR_LIMITS.rows), totalRows: rows.length, more: offset + DOCTOR_LIMITS.rows < rows.length };
}
export function rebuildPagePolicy(viewport) {
  // Actual scale-one PDF.js viewport dimensions include CropBox/Rotate/UserUnit.
  const width = data(viewport, 'width'), height = data(viewport, 'height');
  if (data(viewport, 'scale') !== 1 || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 14400 || height > 14400) throw fail('This visible physical page cannot be rebuilt without changing its size.', 'DOCTOR_GEOMETRY');
  return Object.freeze({ policy: 'visible-physical-page', width, height, mediaBox: Object.freeze([0, 0, width, height]), cropBox: Object.freeze([0, 0, width, height]), rotation: 0, userUnit: 1 });
}
