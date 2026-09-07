'use strict';

const REPORT_VERSION = 1;
const MAX_LOCATIONS = 100;
const MAX_MATCHES = 100;
const MAX_MATCH_LENGTH = 120;

const SENSITIVE_PATTERNS = Object.freeze([
  { id: 'email', label: 'Email address', confidence: 'high', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { id: 'us-ssn', label: 'US Social Security number pattern', confidence: 'high', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { id: 'payment-card', label: 'Payment card number pattern', confidence: 'medium', pattern: /\b(?:\d[ -]*?){13,19}\b/g },
  { id: 'phone', label: 'Phone number pattern', confidence: 'medium', pattern: /(?:\+?\d[\d .()-]{7,}\d)/g },
]);

function throwIfAborted(signal) {
  signal?.throwIfAborted();
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
    version: REPORT_VERSION,
    pageCount: 0,
    encryption: { encrypted: false, locked: false },
    standardMetadata: { count: 0, fields: [] },
    xmp: { present: false },
    catalogAttachments: { count: 0 },
    pageAttachments: { count: 0, locations: [] },
    annotations: { count: 0, locations: [] },
    linksAndActions: { count: 0, locations: [] },
    javascript: { documentActions: 0, pageActions: 0, locations: [] },
    forms: { fieldCount: 0, calculationOrderCount: 0, signatureFields: 0 },
    permissions: { present: false, count: 0 },
    invisibleText: { operations: 0, locations: [] },
    sensitiveText: { count: 0, truncated: false, categories: {}, findings: [] },
    warnings: [],
    limitations: [
      'This is a bounded scan of detectable PDF structures and document text, not a comprehensive privacy or hidden-content audit.',
      'Links and JavaScript are inspected as inert structure and are never opened or executed.',
    ],
  };
}

function isPasswordError(error, pdfjs) {
  return error?.name === 'PasswordException' ||
    (pdfjs?.PasswordException && error instanceof pdfjs.PasswordException) ||
    /password|encrypted/i.test(error?.message || '');
}

export async function scanPdfPrivacy(inputBytes, {
  pdfjs,
  pdfjsAssets = {},
  signal,
  maxMatches = MAX_MATCHES,
  onProgress,
} = {}) {
  if (!(inputBytes instanceof Uint8Array) && !(inputBytes instanceof ArrayBuffer)) {
    throw new TypeError('PDF bytes must be a Uint8Array or ArrayBuffer.');
  }
  const ownedBytes = Uint8Array.from(inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes));
  const report = baseReport();
  const matchLimit = Math.max(1, Math.min(MAX_MATCHES, Number.isInteger(maxMatches) ? maxMatches : MAX_MATCHES));

  try {
    return await withPdfDocument(pdfjs, ownedBytes, { signal, pdfjsAssets }, async (doc) => {
      report.pageCount = doc.numPages;
      throwIfAborted(signal);

      const metadata = await doc.getMetadata().catch(() => ({ info: {}, metadata: null }));
      report.standardMetadata.fields = metadataFields(metadata.info);
      report.standardMetadata.count = report.standardMetadata.fields.length;
      const rawXmp = metadata.metadata?.getRaw?.() || '';
      report.xmp.present = Boolean(String(rawXmp).trim() || Object.keys(metadata.metadata?.getAll?.() || {}).length);

      throwIfAborted(signal);
      const attachments = await doc.getAttachments().catch(() => null);
      report.catalogAttachments.count = attachments instanceof Map
        ? attachments.size
        : attachments ? Object.keys(attachments).length : 0;
      const documentActions = await doc.getJSActions().catch(() => null);
      report.javascript.documentActions = actionCount(documentActions);
      const openAction = await doc.getOpenAction().catch(() => null);
      if (openAction) report.linksAndActions.count++;

      const fields = await doc.getFieldObjects().catch(() => null);
      if (fields) {
        for (const [fieldName, values] of Object.entries(fields)) {
          const entries = Array.isArray(values) ? values : [values];
          report.forms.fieldCount++;
          if (entries.some((field) => /signature|sig/i.test(field?.type || field?.name || fieldName))) {
            report.forms.signatureFields++;
          }
        }
      }
      const calculationOrder = doc.getCalculationOrderIds
        ? await doc.getCalculationOrderIds().catch(() => null)
        : null;
      report.forms.calculationOrderCount = Array.isArray(calculationOrder) ? calculationOrder.length : 0;
      const permissions = await doc.getPermissions().catch(() => null);
      report.permissions = { present: Array.isArray(permissions), count: Array.isArray(permissions) ? permissions.length : 0 };
      if (report.permissions.present) report.encryption.encrypted = true;

      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        throwIfAborted(signal);
        const page = await doc.getPage(pageNumber);
        const annotations = await page.getAnnotations({ intent: 'display' }).catch(() => []);
        report.annotations.count += annotations.length;
        if (annotations.length) boundedPush(report.annotations.locations, { page: pageNumber, count: annotations.length });
        for (const annotation of annotations) {
          const isAttachment = annotation.subtype === 'FileAttachment' || annotation.annotationType === pdfjs.AnnotationType?.FILEATTACHMENT;
          if (isAttachment) {
            report.pageAttachments.count++;
            boundedPush(report.pageAttachments.locations, { page: pageNumber });
          }
          if (annotation.url || annotation.unsafeUrl || annotation.action || annotation.dest) {
            report.linksAndActions.count++;
            boundedPush(report.linksAndActions.locations, { page: pageNumber, kind: annotation.subtype || 'action' });
          }
        }

        const pageActions = await page.getJSActions().catch(() => null);
        const pageActionCount = actionCount(pageActions);
        report.javascript.pageActions += pageActionCount;
        if (pageActionCount) boundedPush(report.javascript.locations, { page: pageNumber, count: pageActionCount });

        const text = await page.getTextContent();
        for (let itemIndex = 0; itemIndex < text.items.length; itemIndex++) {
          if (report.sensitiveText.findings.length >= matchLimit) { report.sensitiveText.truncated = true; break; }
          const value = typeof text.items[itemIndex]?.str === 'string' ? text.items[itemIndex].str : '';
          report.sensitiveText.findings.push(...sensitiveFindings(value, pageNumber, itemIndex, matchLimit - report.sensitiveText.findings.length));
          if (report.sensitiveText.findings.length >= matchLimit) report.sensitiveText.truncated = true;
        }

        const operators = await page.getOperatorList();
        for (let index = 0; index < operators.fnArray.length; index++) {
          if (operators.fnArray[index] !== pdfjs.OPS?.setTextRenderingMode) continue;
          const mode = Number(operators.argsArray[index]?.[0]);
          if ((mode & 3) === 3) {
            report.invisibleText.operations++;
            boundedPush(report.invisibleText.locations, { page: pageNumber, operation: index, mode });
          }
        }
        onProgress?.({ page: pageNumber, pageCount: doc.numPages });
      }

      report.sensitiveText.count = report.sensitiveText.findings.length;
      for (const finding of report.sensitiveText.findings) {
        report.sensitiveText.categories[finding.category] = (report.sensitiveText.categories[finding.category] || 0) + 1;
      }
      if (report.forms.signatureFields) report.warnings.push('A signature field was detected. Rewriting the PDF can invalidate an existing digital signature.');
      return report;
    });
  } catch (error) {
    if (!isPasswordError(error, pdfjs)) throw error;
    report.encryption = { encrypted: true, locked: true };
    report.warnings.push('The PDF is encrypted and could not be inspected without its password.');
    return report;
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
    truncated: Boolean(report.sensitiveText?.truncated),
    warningCount: Math.min(20, report.warnings?.length || 0),
  };
}
