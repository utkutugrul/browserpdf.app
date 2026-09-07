'use strict';

import { withPdfDocument } from './privacy-scan.js';

const REPORT_VERSION = 1;
const MAX_LOCATIONS = 100;
const MAX_GRAPH_OBJECTS = 1000;
const MAX_CANVAS_DIMENSION = 4096;
const MAX_CANVAS_PIXELS = 16_000_000;

function abort(signal) { signal?.throwIfAborted(); }
function safeError(error) { return { name: String(error?.name || 'Error').slice(0, 64) }; }
function pushBounded(values, value) { if (values.length < MAX_LOCATIONS) values.push(value); }
function mapSize(value) { return value instanceof Map ? value.size : value ? Object.keys(value).length : 0; }
function actionCount(actions) {
  if (!actions || typeof actions !== 'object') return 0;
  const values = actions instanceof Map ? [...actions.values()] : Object.values(actions);
  return values.reduce((sum, value) => sum + (Array.isArray(value) ? value.length : value ? 1 : 0), 0);
}

function recordInspectionError(report, category, error, page) {
  report.inspectionErrors.count = Math.min(100000, report.inspectionErrors.count + 1);
  if (!report.inspectionErrors.categories.includes(category) && report.inspectionErrors.categories.length < 30) {
    report.inspectionErrors.categories.push(category);
  }
  if (report.inspectionErrors.locations.length < MAX_LOCATIONS) {
    report.inspectionErrors.locations.push({ category, ...(page ? { page } : {}), error: safeError(error).name });
  } else {
    report.inspectionErrors.truncated = true;
  }
}

async function inspect(report, category, operation, fallback, page) {
  try { return await operation(); }
  catch (error) { recordInspectionError(report, category, error, page); return fallback; }
}

function inspectSync(report, category, operation, fallback, page) {
  try { return operation(); }
  catch (error) { recordInspectionError(report, category, error, page); return fallback; }
}

async function parsePdfLib(pdfLib, bytes, options) {
  try {
    return { ok: true, document: await pdfLib.PDFDocument.load(bytes.slice(), options) };
  } catch (error) {
    return { ok: false, error: safeError(error), document: null };
  }
}

function boxIssues(document) {
  const locations = [];
  for (const [index, page] of document.getPages().entries()) {
    const media = page.getMediaBox();
    const crop = page.getCropBox();
    const invalidMedia = ![media.x, media.y, media.width, media.height].every(Number.isFinite) || media.width <= 0 || media.height <= 0;
    const invalidCrop = ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.width <= 0 || crop.height <= 0 ||
      crop.x < media.x || crop.y < media.y || crop.x + crop.width > media.x + media.width || crop.y + crop.height > media.y + media.height;
    if (invalidMedia || invalidCrop) pushBounded(locations, { page: index + 1, media: invalidMedia, crop: invalidCrop });
  }
  return { issueCount: locations.length, locations, truncated: locations.length >= MAX_LOCATIONS };
}

function catalogReadiness(pdfLib, document) {
  const { PDFArray, PDFDict, PDFName, PDFRef } = pdfLib;
  const context = document.context;
  const struct = document.catalog.get(PDFName.of('StructTreeRoot'));
  const markInfo = document.catalog.lookupMaybe?.(PDFName.of('MarkInfo'), PDFDict) || null;
  const marked = String(markInfo?.get(PDFName.of('Marked')) || '') === 'true';
  const langValue = document.catalog.get(PDFName.of('Lang'));
  const languagePresent = Boolean(langValue?.decodeText?.()?.trim());
  const titlePresent = Boolean(document.getTitle()?.trim());
  let figures = 0;
  let figuresWithAlt = 0;
  let visitedCount = 0;
  const visitedRefs = new Set();

  // Matterhorn checks distinguish the presence of a structure tree from the
  // semantics inside it. These are readiness signals only, never compliance.
  function visit(value) {
    if (!value || visitedCount >= MAX_GRAPH_OBJECTS) return;
    if (value instanceof PDFRef) {
      const key = String(value);
      if (visitedRefs.has(key)) return;
      visitedRefs.add(key); visitedCount++;
      visit(context.lookup(value));
      return;
    }
    if (value instanceof PDFArray) {
      for (let index = 0; index < value.size(); index++) visit(value.get(index));
      return;
    }
    if (!(value instanceof PDFDict)) return;
    if (String(value.get(PDFName.of('S')) || '') === '/Figure') {
      figures++;
      if (value.get(PDFName.of('Alt'))?.decodeText?.()?.trim()) figuresWithAlt++;
    }
    for (const [, child] of value.entries()) visit(child);
  }
  visit(struct);
  return {
    structureTreePresent: Boolean(struct), markInfoMarked: marked, languagePresent,
    titlePresent, figureCount: figures, figuresWithAlt,
    figuresMissingAlt: Math.max(0, figures - figuresWithAlt), graphTruncated: visitedCount >= MAX_GRAPH_OBJECTS,
  };
}

function reportBase(mode) {
  return {
    version: REPORT_VERSION,
    mode,
    parses: { pdfLibStrict: { ok: false }, pdfLibTolerant: { ok: false }, pdfjsStrict: { ok: false } },
    pageCount: 0,
    pageTree: { pdfLibCount: 0, pdfjsCount: 0, consistent: false },
    pageBoxes: { issueCount: 0, locations: [], truncated: false },
    features: {
      encrypted: false, locked: false, permissions: 0, standardMetadata: 0, xmp: 0,
      catalogAttachments: 0, pageAttachments: 0, annotations: 0, linksAndActions: 0,
      documentJavaScript: 0, pageJavaScript: 0, forms: 0, calculationOrder: 0, signatureFields: 0,
    },
    accessibilityReadiness: {
      structureTreePresent: false, markInfoMarked: false, languagePresent: false, titlePresent: false,
      figureCount: 0, figuresWithAlt: 0, figuresMissingAlt: 0, graphTruncated: false,
    },
    inspectionErrors: { count: 0, categories: [], locations: [], truncated: false },
    deep: { performed: mode === 'deep', pagesChecked: 0, operatorErrors: 0, textErrors: 0, renderErrors: 0, locations: [] },
    warnings: [],
    limitations: [
      'These are bounded structural and rendering-readiness signals, not a comprehensive repair assessment.',
      'Structure-tree, language, title, and alternative-text presence do not establish accessibility conformance.',
      'Signature fields are detected as rewrite-risk signals; signature validity is not checked.',
    ],
  };
}

function isPasswordError(error, pdfjs) {
  return error?.name === 'PasswordException' ||
    (pdfjs?.PasswordException && error instanceof pdfjs.PasswordException) ||
    /password|encrypted/i.test(error?.message || '');
}

function canvasFor(createCanvas, viewport) {
  if (typeof createCanvas !== 'function') throw new TypeError('Deep diagnosis requires a canvas factory.');
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION || width * height > MAX_CANVAS_PIXELS) {
    throw new RangeError('The page exceeds the bounded diagnostic render surface.');
  }
  return createCanvas(width, height);
}

export async function diagnosePdf(inputBytes, {
  mode = 'quick', pdfLib, pdfjs, pdfjsAssets = {}, createCanvas, signal, onProgress,
} = {}) {
  if (!['quick', 'deep'].includes(mode)) throw new RangeError('mode must be quick or deep.');
  if (!pdfLib?.PDFDocument || !pdfjs?.getDocument) throw new TypeError('pdf-lib and PDF.js runtimes are required.');
  const bytes = Uint8Array.from(inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes));
  const report = reportBase(mode);
  abort(signal);
  const strict = await parsePdfLib(pdfLib, bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false, parseSpeed: 100 });
  report.parses.pdfLibStrict = strict.ok ? { ok: true } : { ok: false, error: strict.error };
  abort(signal);
  const tolerant = await parsePdfLib(pdfLib, bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
  report.parses.pdfLibTolerant = tolerant.ok ? { ok: true } : { ok: false, error: tolerant.error };
  if (tolerant.ok) {
    report.pageTree.pdfLibCount = tolerant.document.getPageCount();
    report.pageBoxes = inspectSync(report, 'pdf-lib-page-boxes', () => boxIssues(tolerant.document), report.pageBoxes);
    report.accessibilityReadiness = inspectSync(
      report, 'pdf-lib-catalog-readiness', () => catalogReadiness(pdfLib, tolerant.document), report.accessibilityReadiness,
    );
  }

  try {
    await withPdfDocument(pdfjs, bytes, { signal, pdfjsAssets: { ...pdfjsAssets, stopAtErrors: true } }, async (document) => {
      report.parses.pdfjsStrict = { ok: true };
      report.pageCount = document.numPages;
      report.pageTree.pdfjsCount = document.numPages;
      const metadata = await inspect(report, 'document-metadata', () => document.getMetadata(), { info: {}, metadata: null });
      report.features.standardMetadata = ['Title','Author','Subject','Keywords','Creator','Producer','CreationDate','ModDate']
        .filter((key) => metadata.info?.[key] != null && String(metadata.info[key]).trim()).length;
      const rawXmp = inspectSync(report, 'xmp-metadata', () => metadata.metadata?.getRaw?.() || '', '');
      report.features.xmp = String(rawXmp).trim() ? 1 : 0;
      report.features.catalogAttachments = mapSize(await inspect(report, 'catalog-attachments', () => document.getAttachments(), null));
      report.features.documentJavaScript = actionCount(await inspect(report, 'document-javascript', () => document.getJSActions(), null));
      if (await inspect(report, 'document-open-action', () => document.getOpenAction(), null)) report.features.linksAndActions++;
      const fields = await inspect(report, 'document-forms', () => document.getFieldObjects(), null);
      if (fields) {
        const entries = fields instanceof Map ? [...fields.entries()] : Object.entries(fields);
        report.features.forms = entries.length;
        for (const [name, values] of entries) {
          const entries = Array.isArray(values) ? values : [values];
          if (entries.some((field) => /signature|sig/i.test(field?.type || field?.name || name))) report.features.signatureFields++;
        }
      }
      const order = document.getCalculationOrderIds
        ? await inspect(report, 'calculation-order', () => document.getCalculationOrderIds(), null)
        : null;
      report.features.calculationOrder = Array.isArray(order) ? order.length : 0;
      const permissions = await inspect(report, 'document-permissions', () => document.getPermissions(), null);
      report.features.permissions = Array.isArray(permissions) ? permissions.length : 0;
      report.features.encrypted = Array.isArray(permissions);
      if (document.getMarkInfo) {
        const markInfo = await inspect(report, 'document-mark-info', () => document.getMarkInfo(), null);
        report.accessibilityReadiness.markInfoMarked ||= Boolean(markInfo?.Marked);
      }

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        abort(signal);
        const page = await inspect(report, 'page-load', () => document.getPage(pageNumber), null, pageNumber);
        if (!page) { onProgress?.({ page: pageNumber, pageCount: document.numPages, mode }); continue; }
        const annotations = await inspect(report, 'page-annotations', () => page.getAnnotations({ intent: 'display' }), [], pageNumber);
        report.features.annotations += annotations.length;
        for (const annotation of annotations) {
          if (annotation.subtype === 'FileAttachment' || annotation.annotationType === pdfjs.AnnotationType?.FILEATTACHMENT) report.features.pageAttachments++;
          if (annotation.url || annotation.unsafeUrl || annotation.action || annotation.dest) report.features.linksAndActions++;
        }
        report.features.pageJavaScript += actionCount(await inspect(report, 'page-javascript', () => page.getJSActions(), null, pageNumber));
        if (page.getStructTree) await inspect(report, 'page-structure-tree', () => page.getStructTree(), null, pageNumber);
        if (mode === 'deep') {
          const location = { page: pageNumber, operator: true, text: true, render: true };
          try { await page.getOperatorList(); } catch { location.operator = false; report.deep.operatorErrors++; }
          abort(signal);
          try { await page.getTextContent(); } catch { location.text = false; report.deep.textErrors++; }
          abort(signal);
          let renderTask = null;
          try {
            const viewport = page.getViewport({ scale: 0.35 });
            const canvas = canvasFor(createCanvas, viewport);
            renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
            const cancel = () => renderTask.cancel?.();
            signal?.addEventListener('abort', cancel, { once: true });
            try { await renderTask.promise; } finally { signal?.removeEventListener('abort', cancel); }
          } catch (error) {
            if (signal?.aborted) throw error;
            location.render = false; report.deep.renderErrors++;
          }
          report.deep.pagesChecked++;
          if (!location.operator || !location.text || !location.render) pushBounded(report.deep.locations, location);
        }
        onProgress?.({ page: pageNumber, pageCount: document.numPages, mode });
      }
    });
  } catch (error) {
    if (!isPasswordError(error, pdfjs)) report.parses.pdfjsStrict = { ok: false, error: safeError(error) };
    else {
      report.parses.pdfjsStrict = { ok: false, error: { name: 'PasswordException' } };
      report.features.encrypted = true; report.features.locked = true;
    }
  }
  abort(signal);
  report.pageTree.consistent = report.pageTree.pdfLibCount > 0 && report.pageTree.pdfLibCount === report.pageTree.pdfjsCount;
  if (!report.parses.pdfLibStrict.ok && report.parses.pdfLibTolerant.ok) report.warnings.push('The tolerant parser opened content that the strict parser rejected. Reserialization may still lose unsupported structures.');
  if (!report.pageTree.consistent) report.warnings.push('The parsing engines did not confirm the same usable page count.');
  if (report.pageBoxes.issueCount) report.warnings.push('One or more page boxes are invalid or extend outside the media box.');
  if (report.features.signatureFields) report.warnings.push('A signature field is present. Any rewrite can invalidate an existing digital signature.');
  if (report.inspectionErrors.count) report.warnings.push('One or more inspection categories could not be confirmed; their zero values must not be read as verified absence.');
  if (report.accessibilityReadiness.graphTruncated) report.warnings.push('The bounded structure-tree traversal stopped at 1,000 referenced objects, so readiness signals are incomplete.');
  return report;
}

export function summarizeDoctorReport(report) {
  return {
    version: report.version, mode: report.mode, pageCount: Math.min(100000, report.pageCount || 0),
    parses: {
      pdfLibStrict: Boolean(report.parses?.pdfLibStrict?.ok),
      pdfLibTolerant: Boolean(report.parses?.pdfLibTolerant?.ok),
      pdfjsStrict: Boolean(report.parses?.pdfjsStrict?.ok),
    },
    pageTreeConsistent: Boolean(report.pageTree?.consistent), pageBoxIssues: Math.min(MAX_LOCATIONS, report.pageBoxes?.issueCount || 0),
    features: Object.fromEntries(Object.entries(report.features || {}).map(([key, value]) => [key, typeof value === 'boolean' ? value : Math.min(100000, value || 0)])),
    readiness: { ...(report.accessibilityReadiness || {}) },
    inspectionErrors: {
      count: Math.min(100000, report.inspectionErrors?.count || 0),
      categories: (report.inspectionErrors?.categories || []).slice(0, 30),
      truncated: Boolean(report.inspectionErrors?.truncated),
    },
    deep: {
      performed: Boolean(report.deep?.performed), pagesChecked: Math.min(100000, report.deep?.pagesChecked || 0),
      operatorErrors: Math.min(MAX_LOCATIONS, report.deep?.operatorErrors || 0), textErrors: Math.min(MAX_LOCATIONS, report.deep?.textErrors || 0),
      renderErrors: Math.min(MAX_LOCATIONS, report.deep?.renderErrors || 0),
    },
    warningCount: Math.min(20, report.warnings?.length || 0),
  };
}
