'use strict';

const REPORT_VERSION = 1;
const MAX_LOCATIONS = 100;
const MAX_MATCHES = 100;
const MAX_MATCH_LENGTH = 120;
export const PRIVACY_CATEGORY_KEYS = Object.freeze(['standardMetadata', 'xmp', 'catalogAttachments', 'pageAttachments', 'annotations', 'linksAndActions', 'documentJavaScript', 'pageJavaScript', 'forms', 'calculationOrder', 'signatureFields', 'invisibleTextOperations', 'sensitivePatterns']);
export const PRIVACY_SCAN_LIMITS = Object.freeze({ pages: 1000, textItemsPerPage: 10000, textUnitsPerPage: 100000, textUnits: 2000000, operatorsPerPage: 100000, operators: 1000000, annotationsPerPage: 10000, annotations: 50000, fields: 1000 });
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const signalReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason').get;
const apply = Reflect.apply;

const SENSITIVE_PATTERNS = Object.freeze([
  { id: 'email', label: 'Email address', confidence: 'high', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { id: 'us-ssn', label: 'US Social Security number pattern', confidence: 'high', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { id: 'payment-card', label: 'Payment card number pattern', confidence: 'medium', pattern: /\b(?:\d[ -]*?){13,19}\b/g },
  { id: 'phone', label: 'Phone number pattern', confidence: 'medium', pattern: /(?:\+?\d[\d .()-]{7,}\d)/g },
]);

function throwIfAborted(signal) {
  if (signal != null && apply(signalAborted, signal, [])) throw apply(signalReason, signal, []);
}

async function destroyQuietly(value) {
  try { await value?.destroy?.(); } catch { /* cleanup must not mask the scan result */ }
}

// PDF.js owns workers and document resources behind both objects. Keeping this
// lifecycle in one helper makes success, parse failure, and AbortSignal paths
// release both handles consistently.
export async function withPdfDocument(pdfjs, bytes, { signal, pdfjsAssets = {} } = {}, inspect) {
  if (!pdfjs?.getDocument) throw new TypeError('A PDF.js runtime is required.');
  throwIfAborted(signal);
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), ...pdfjsAssets });
  let doc = null;
  const abort = () => { void destroyQuietly(task); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    doc = await task.promise;
    throwIfAborted(signal);
    return await inspect(doc);
  } finally {
    signal?.removeEventListener('abort', abort);
    await destroyQuietly(doc);
    await destroyQuietly(task);
  }
}

function boundedPush(target, value, limit = MAX_LOCATIONS) {
  if (target.length < limit) target.push(value);
}

function actionCount(actions) {
  if (!actions || typeof actions !== 'object') return 0;
  return Object.values(actions).reduce((total, value) => total + (Array.isArray(value) ? value.length : value ? 1 : 0), 0);
}

function metadataFields(info) {
  const names = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'];
  return names.filter((name) => info?.[name] !== undefined && info?.[name] !== null && String(info[name]).trim());
}

function freshPattern(definition) {
  return new RegExp(definition.pattern.source, definition.pattern.flags);
}

function sensitiveFindings(text, page, itemIndex, remaining) {
  const findings = [];
  for (const definition of SENSITIVE_PATTERNS) {
    const pattern = freshPattern(definition);
    let match;
    while (findings.length < remaining && (match = pattern.exec(text))) {
      boundedPush(findings, {
        category: definition.id,
        label: definition.label,
        confidence: definition.confidence,
        page,
        item: itemIndex,
        offset: match.index,
        match: match[0].slice(0, MAX_MATCH_LENGTH),
      }, remaining);
      if (match[0].length === 0) pattern.lastIndex++;
    }
  }
  return findings;
}

function baseReport() {
  return {
    version: REPORT_VERSION, pageCount: 0,
    encryption: { encrypted: false, locked: false },
    standardMetadata: { count: 0, fields: [] }, xmp: { present: false }, catalogAttachments: { count: 0 },
    pageAttachments: { count: 0, locations: [] }, annotations: { count: 0, locations: [] }, linksAndActions: { count: 0, locations: [] },
    javascript: { documentActions: 0, pageActions: 0, locations: [] },
    forms: { fieldCount: 0, calculationOrderCount: 0, signatureFields: 0 }, permissions: { present: false, count: 0 },
    invisibleText: { operations: 0, locations: [] }, sensitiveText: { count: 0, truncated: false, categories: {}, findings: [] },
    warnings: [],
    limitations: [
      'This is a bounded scan of detectable PDF structures and document text, not a comprehensive privacy or hidden-content audit.',
      'Links and JavaScript are inspected as inert structure and are never opened or executed.',
    ],
    inspection: { complete: true, categories: Object.fromEntries([...PRIVACY_CATEGORY_KEYS, 'permissions'].map(key => [key, { status: 'complete', lowerBound: false, reasons: [] }])), issues: [], issuesTruncated: false },
  };
}
function limitsFor(value) {
  if (value === undefined) return Object.fromEntries(Object.keys(PRIVACY_SCAN_LIMITS).map(key => [key, Number.MAX_SAFE_INTEGER]));
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => !Object.hasOwn(PRIVACY_SCAN_LIMITS, key))) throw new TypeError('Unsupported privacy scan limits.');
  const result = { ...PRIVACY_SCAN_LIMITS };
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value') || !Number.isSafeInteger(descriptor.value) || descriptor.value < 1 || descriptor.value > PRIVACY_SCAN_LIMITS[key]) throw new RangeError('Privacy scan limits must be finite positive supported bounds.');
    result[key] = descriptor.value;
  }
  return result;
}
function mark(report, categories, reason, page, status = 'partial') {
  report.inspection.complete = false;
  for (const category of categories) {
    const entry = report.inspection.categories[category];
    if (entry.status === 'complete' || status === 'locked' || status === 'unknown') entry.status = status;
    entry.lowerBound = true;
    if (!entry.reasons.includes(reason) && entry.reasons.length < 20) entry.reasons.push(reason);
    if (report.inspection.issues.length < 100) report.inspection.issues.push({ category, reason, ...(page ? { page } : {}) });
    else report.inspection.issuesTruncated = true;
  }
}
function location(report, group, category, value) {
  group.locationsOmitted ||= 0;
  if (group.locations.length < MAX_LOCATIONS) group.locations.push(value);
  else { group.locationsOmitted++; group.locationsTruncated = true; mark(report, [category], 'location-limit', value.page); }
}
function finish(report) {
  report.sensitiveText.count = report.sensitiveText.findings.length;
  for (const finding of report.sensitiveText.findings) report.sensitiveText.categories[finding.category] = (report.sensitiveText.categories[finding.category] || 0) + 1;
  if (report.forms.signatureFields) report.warnings.push('A signature field was detected. Rewriting the PDF can invalidate an existing digital signature.');
  if (!report.inspection.complete) report.warnings.push('Some inspection results are unknown or partial. Zero observed findings do not establish absence.');
  if (JSON.stringify(report).length > 256000) throw new RangeError('The bounded privacy report exceeded its local DTO limit.');
  return report;
}
const PAGE_CATEGORIES = ['pageAttachments', 'annotations', 'linksAndActions', 'pageJavaScript', 'invisibleTextOperations', 'sensitivePatterns'];

export async function scanPdfPrivacy(inputBytes, {
  pdfjs, pdfjsAssets = {}, signal, maxMatches = MAX_MATCHES, onProgress,
  limits, inspectPdf = withPdfDocument,
} = {}) {
  if (!(inputBytes instanceof Uint8Array) && !(inputBytes instanceof ArrayBuffer)) throw new TypeError('PDF bytes must be a Uint8Array or ArrayBuffer.');
  if (typeof inspectPdf !== 'function') throw new TypeError('A PDF inspector is required.');
  throwIfAborted(signal);
  const bounds = limitsFor(limits), ownedBytes = Uint8Array.from(inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes));
  const report = baseReport(), matchLimit = Math.max(1, Math.min(MAX_MATCHES, Number.isInteger(maxMatches) ? maxMatches : MAX_MATCHES));
  async function inspectValue(work, categories, page) {
    try { const value = await work(); throwIfAborted(signal); return { ok: true, value }; }
    catch (error) { throwIfAborted(signal); mark(report, categories, 'inspection-failed', page, 'unknown'); return { ok: false }; }
  }
  try {
    const result = await inspectPdf(pdfjs, ownedBytes, { signal, pdfjsAssets }, async doc => {
      report.pageCount = doc.numPages;
      if (!Number.isSafeInteger(doc.numPages) || doc.numPages < 1) throw new Error('The PDF has no readable pages.');
      throwIfAborted(signal);
      const metadata = await inspectValue(async () => {
        const value = await doc.getMetadata();
        if (!value?.info || typeof value.info !== 'object') throw new TypeError('Metadata inspection is unavailable.');
        return { fields: metadataFields(value.info), xmp: Boolean(String(value.metadata?.getRaw?.() || '').trim() || Object.keys(value.metadata?.getAll?.() || {}).length) };
      }, ['standardMetadata', 'xmp']);
      if (metadata.ok) {
        report.standardMetadata.fields = metadata.value.fields;
        report.standardMetadata.count = report.standardMetadata.fields.length;
        report.xmp.present = metadata.value.xmp;
      }
      const attachments = await inspectValue(() => doc.getAttachments(), ['catalogAttachments']);
      if (attachments.ok) report.catalogAttachments.count = attachments.value instanceof Map ? attachments.value.size : attachments.value ? Object.keys(attachments.value).length : 0;
      const actions = await inspectValue(() => doc.getJSActions(), ['documentJavaScript']);
      if (actions.ok) report.javascript.documentActions = actionCount(actions.value);
      const open = await inspectValue(() => doc.getOpenAction(), ['linksAndActions']); if (open.ok && open.value) report.linksAndActions.count++;
      const fields = await inspectValue(() => doc.getFieldObjects(), ['forms', 'signatureFields']);
      if (fields.ok && fields.value) {
        let count = 0, entryWork = 0;
        for (const fieldName of Object.keys(fields.value)) {
          throwIfAborted(signal); if (count++ >= bounds.fields) { mark(report, ['forms', 'signatureFields'], 'field-limit'); break; }
          const values = fields.value[fieldName], entries = Array.isArray(values) ? values : [values]; report.forms.fieldCount++;
          let signature = false;
          for (let index = 0; index < entries.length; index++) {
            throwIfAborted(signal);
            if (entryWork >= bounds.fields) { mark(report, ['forms', 'signatureFields'], 'field-entry-limit'); break; }
            entryWork++; const field = entries[index];
            if (/signature|sig/i.test(field?.type || field?.name || fieldName)) signature = true;
          }
          throwIfAborted(signal);
          if (signature) report.forms.signatureFields++;
        }
      }
      const order = await inspectValue(() => doc.getCalculationOrderIds ? doc.getCalculationOrderIds() : Promise.reject(new Error('Unavailable')), ['calculationOrder']);
      if (order.ok) report.forms.calculationOrderCount = Array.isArray(order.value) ? order.value.length : 0;
      const permissions = await inspectValue(() => doc.getPermissions(), ['permissions']);
      if (permissions.ok) report.permissions = { present: Array.isArray(permissions.value), count: Array.isArray(permissions.value) ? permissions.value.length : 0 };
      if (report.permissions.present) report.encryption.encrypted = true;
      let textUnits = 0, operatorCount = 0, annotationCount = 0;
      const pageLimit = Math.min(doc.numPages, bounds.pages);
      if (doc.numPages > pageLimit) mark(report, PAGE_CATEGORIES, 'page-limit');
      for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
        throwIfAborted(signal);
        const loaded = await inspectValue(() => doc.getPage(pageNumber), PAGE_CATEGORIES, pageNumber);
        if (!loaded.ok) { onProgress?.({ page: pageNumber, pageCount: doc.numPages }); continue; }
        const page = loaded.value;
        const annotations = await inspectValue(() => page.getAnnotations({ intent: 'display' }), ['annotations', 'pageAttachments', 'linksAndActions'], pageNumber);
        if (annotations.ok) {
          const all = annotations.value || [], admitted = Math.min(all.length, bounds.annotationsPerPage, Math.max(0, bounds.annotations - annotationCount));
          report.annotations.count += admitted; annotationCount += admitted;
          if (admitted < all.length) mark(report, ['annotations', 'pageAttachments', 'linksAndActions'], 'annotation-limit', pageNumber);
          if (admitted) location(report, report.annotations, 'annotations', { page: pageNumber, count: admitted });
          for (let index = 0; index < admitted; index++) {
            throwIfAborted(signal); const annotation = all[index];
            if (annotation.subtype === 'FileAttachment' || (pdfjs.AnnotationType?.FILEATTACHMENT !== undefined && annotation.annotationType === pdfjs.AnnotationType.FILEATTACHMENT)) { report.pageAttachments.count++; location(report, report.pageAttachments, 'pageAttachments', { page: pageNumber }); }
            if (annotation.url || annotation.unsafeUrl || annotation.action || annotation.dest) { report.linksAndActions.count++; location(report, report.linksAndActions, 'linksAndActions', { page: pageNumber, kind: String(annotation.subtype || 'action').slice(0, 40) }); }
          }
        }
        const actions = await inspectValue(() => page.getJSActions(), ['pageJavaScript'], pageNumber);
        if (actions.ok) { const count = actionCount(actions.value); report.javascript.pageActions += count; if (count) location(report, report.javascript, 'pageJavaScript', { page: pageNumber, count }); }
        const text = await inspectValue(() => page.getTextContent(), ['sensitivePatterns'], pageNumber);
        if (text.ok) {
          const items = text.value?.items || []; let pageUnits = 0;
          for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            throwIfAborted(signal);
            if (itemIndex >= bounds.textItemsPerPage || textUnits >= bounds.textUnits || pageUnits >= bounds.textUnitsPerPage) { mark(report, ['sensitivePatterns'], 'text-work-limit', pageNumber); break; }
            if (report.sensitiveText.findings.length >= matchLimit) { report.sensitiveText.truncated = true; mark(report, ['sensitivePatterns'], 'match-limit', pageNumber); break; }
            const raw = typeof items[itemIndex]?.str === 'string' ? items[itemIndex].str : '', allowed = Math.min(raw.length, bounds.textUnitsPerPage - pageUnits, bounds.textUnits - textUnits), value = raw.slice(0, allowed);
            textUnits += allowed; pageUnits += allowed;
            report.sensitiveText.findings.push(...sensitiveFindings(value, pageNumber, itemIndex, matchLimit - report.sensitiveText.findings.length));
            if (allowed < raw.length) mark(report, ['sensitivePatterns'], 'text-work-limit', pageNumber);
            if (report.sensitiveText.findings.length >= matchLimit) { report.sensitiveText.truncated = true; mark(report, ['sensitivePatterns'], 'match-limit', pageNumber); }
          }
        }
        const operators = await inspectValue(() => page.getOperatorList(), ['invisibleTextOperations'], pageNumber);
        if (operators.ok) {
          const functions = operators.value?.fnArray || [], admitted = Math.min(functions.length, bounds.operatorsPerPage, Math.max(0, bounds.operators - operatorCount)); operatorCount += admitted;
          if (admitted < functions.length) mark(report, ['invisibleTextOperations'], 'operator-limit', pageNumber);
          for (let index = 0; index < admitted; index++) {
            throwIfAborted(signal); if (functions[index] !== pdfjs.OPS?.setTextRenderingMode) continue;
            const mode = Number(operators.value.argsArray[index]?.[0]);
            if ((mode & 3) === 3) { report.invisibleText.operations++; location(report, report.invisibleText, 'invisibleTextOperations', { page: pageNumber, operation: index, mode }); }
          }
        }
        onProgress?.({ page: pageNumber, pageCount: doc.numPages });
      }
      return finish(report);
    });
    throwIfAborted(signal); return result;
  } catch (error) {
    // The injected owner retains a failed native handle. Its cleanup fence must
    // remain visible even when the canceled operation has a falsy reason.
    if (error?.code === 'PRIVACY_CLEANUP') throw error;
    throwIfAborted(signal);
    if (!(error?.name === 'PasswordException' || (typeof pdfjs?.PasswordException === 'function' && error instanceof pdfjs.PasswordException))) throw error;
    report.encryption = { encrypted: true, locked: true };
    mark(report, [...PRIVACY_CATEGORY_KEYS, 'permissions'], 'password-required', undefined, 'locked');
    report.warnings.push('The PDF is encrypted and could not be inspected without its password.');
    return finish(report);
  }
}

export function summarizePrivacyReport(report) {
  return {
    version: report.version,
    pageCount: report.pageCount,
    encrypted: Boolean(report.encryption?.encrypted),
    locked: Boolean(report.encryption?.locked),
    counts: {
      standardMetadata: report.standardMetadata?.count || 0,
      xmp: report.xmp?.present ? 1 : 0,
      catalogAttachments: report.catalogAttachments?.count || 0,
      pageAttachments: report.pageAttachments?.count || 0,
      annotations: report.annotations?.count || 0,
      linksAndActions: report.linksAndActions?.count || 0,
      documentJavaScript: report.javascript?.documentActions || 0,
      pageJavaScript: report.javascript?.pageActions || 0,
      forms: report.forms?.fieldCount || 0,
      calculationOrder: report.forms?.calculationOrderCount || 0,
      signatureFields: report.forms?.signatureFields || 0,
      invisibleTextOperations: report.invisibleText?.operations || 0,
      sensitivePatterns: report.sensitiveText?.count || 0,
    },
    sensitiveCategories: { ...(report.sensitiveText?.categories || {}) },
    truncated: Boolean(report.sensitiveText?.truncated || report.inspection?.complete === false),
    warningCount: Math.min(20, report.warnings?.length || 0),
  };
}
