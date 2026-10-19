import { t } from './i18n.js';
import * as ui from './tool-ui.js';
import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { createArtifact, MAX_ARTIFACT_BYTES } from './core/document-session.js';
import { scanPdfPrivacy, summarizePrivacyReport, PRIVACY_SCAN_LIMITS } from './core/privacy-scan.js';
import { PRIVACY_LIMITS, assertPrivacyWorkspaceBudget, createPrivacyWorkQueue, createPrivacyPdfLifetime, createPrivacyPreview, privacyView, privacyBoundary } from './core/privacy-workspace.js';

const $ = id => document.getElementById(id);
const text = (key, fallback, values) => t(`privacy_workspace.${key}`, fallback, values);
const same = (a, b) => !!a && !!b && a.taskId === b.taskId && a.revision === b.revision && a.generation === b.generation;
const ownerOf = value => ({ taskId: value.taskId, revision: value.revision, generation: value.generation });
const snapshot = () => ui.documentSession.snapshot();
const stale = () => new DOMException('Privacy work was replaced or canceled.', 'AbortError');
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason').get;
const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
const checkSignal = signal => { if (signal != null && Reflect.apply(aborted, signal, [])) throw Reflect.apply(reason, signal, []); };
const ZERO = Object.freeze({ artifactBytes: 0, resourceBytes: 0, resourceCount: 0, expandedBytes: 0, expandedCount: 0 });
const CANVAS_BYTES = 4 * PRIVACY_LIMITS.previewPixels, REPORT_BYTES = 2 * PRIVACY_LIMITS.reportUnits;
// These reservations cover known response arrays/text and report backing, not
// opaque native parser graphs, JavaScript object overhead or process RSS.
const SCAN_EXPANSION = 2 * PRIVACY_LIMITS.textUnits + 8 * PRIVACY_LIMITS.operators + 64 * PRIVACY_LIMITS.annotations + 256 * PRIVACY_LIMITS.fields;
const LABELS = Object.freeze({ standardMetadata: 'Standard document metadata', xmp: 'XMP metadata', catalogAttachments: 'Catalog attachments', pageAttachments: 'Page attachments', annotations: 'Annotations', linksAndActions: 'Links and actions', documentJavaScript: 'Document JavaScript actions', pageJavaScript: 'Page JavaScript actions', forms: 'Form fields', calculationOrder: 'Form calculation order', signatureFields: 'Signature fields', invisibleTextOperations: 'Detectable invisible-text operations', sensitivePatterns: 'Sensitive text patterns' });
const REASONS = Object.freeze({ 'inspection-failed': 'An exposed inspection call failed.', 'password-required': 'A password is required.', 'page-limit': 'The page traversal limit was reached.', 'annotation-limit': 'The annotation traversal limit was reached.', 'field-limit': 'The logical field limit was reached.', 'field-entry-limit': 'The field-widget entry limit was reached.', 'operator-limit': 'The operator traversal limit was reached.', 'text-work-limit': 'The extracted-text traversal limit was reached.', 'match-limit': 'The sensitive-pattern match limit was reached.', 'location-limit': 'Additional page locations were omitted.' });
function combine(...leases) {
  const result = { ...ZERO };
  for (const lease of leases) for (const key of Object.keys(result)) { const value = lease?.[key] || 0; if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(result[key] + value)) throw new TypeError('Invalid finite Privacy allocation.'); result[key] += value; }
  return result;
}
function retryable(path) { let pending, attempt = 0; return () => pending ||= import(attempt ? `${path}?retry=${attempt}` : path).catch(error => { pending = null; attempt++; throw error; }); }
const getIntakeModule = retryable('./privacy-scan-intake.js'), getCleanup = retryable('./core/privacy-cleanup.js');
function ownData(value, key) {
  const descriptor = value && Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new TypeError('Inherited document entries must contain data values.');
  return descriptor?.value;
}
function finiteData(value, key) {
  const number = ownData(value, key);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('Complete finite document budget metadata is required.');
  return number;
}
function restoredPageIndex(value) {
  const selection = ownData(value, 'selection');
  if (!Array.isArray(selection) || selection.length > 10000) throw new TypeError('A finite nonnegative selected page is required.');
  for (let index = 0; index < selection.length; index++) finiteData(selection, String(index));
  return Math.min(selection.length ? finiteData(selection, '0') : 0, PRIVACY_LIMITS.pages - 1);
}
function historyCopyPlan(value) {
  const retained = finiteData(value, 'retainedBytes'), resources = finiteData(value, 'resourceBytes');
  const current = finiteData(ownData(value, 'current'), 'size'), original = finiteData(ownData(value, 'original'), 'size'), history = finiteData(value, 'historyBytes');
  finiteData(value, 'resourceCount');
  if (resources > retained || Math.max(current, original, history) > retained - resources || Math.max(current, original) > MAX_ARTIFACT_BYTES) throw new TypeError('Inconsistent retained document metadata.');
  // historyBytes excludes original/current/resource aliases and the future
  // stack. Every target backing is covered by retainedBytes-resourceBytes.
  const upper = Math.min(MAX_ARTIFACT_BYTES, retained - resources), resourceUpper = Math.min(upper, resources);
  // historyTarget copies once; Undo/Redo restore a new canonical artifact and
  // return another owned copy. All three can overlap the old canonical task.
  return { upper, lease: { artifactBytes: 3 * (upper - resourceUpper), resourceBytes: 3 * resourceUpper, resourceCount: resourceUpper ? 3 : 0 } };
}
function inheritedLease(file, inherited = ownData(file, 'browserpdfSession')) {
  if (!inherited) return ZERO;
  const allocations = new Map(), stagedCopies = new Map(), resources = new Set(), resourceViews = new Set();
  let resourceEntries = 0;
  const selection = ownData(inherited, 'selection');
  if (selection !== undefined) restoredPageIndex({ selection });
  const addBuffer = (entry, resource = false) => {
    if (!entry || typeof entry !== 'object') return;
    const bytes = ownData(entry, 'bytes');
    if (bytes === undefined) return;
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new TypeError('Invalid inherited document buffer.');
    allocations.set(bytes.buffer, bytes.buffer.byteLength); stagedCopies.set(bytes, bytes.byteLength);
    if (resource) { resources.add(bytes.buffer); resourceViews.add(bytes); }
  };
  addBuffer(ownData(inherited, 'original')); addBuffer(ownData(inherited, 'current'));
  for (const key of ['history', 'future', 'resources']) {
    const entries = ownData(inherited, key); if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > (key === 'resources' ? 128 : 5)) throw new TypeError('Invalid inherited document entry count.');
    if (key === 'resources') resourceEntries = entries.length;
    for (const entry of entries) addBuffer(entry, key === 'resources');
  }
  let artifactBytes = 0, resourceBytes = 0;
  for (const [buffer, size] of allocations) if (resources.has(buffer)) resourceBytes += size; else artifactBytes += size;
  for (const [view, size] of stagedCopies) if (resourceViews.has(view)) resourceBytes += size; else artifactBytes += size;
  // Delivery deduplicates actual backing allocations. begin deduplicates input
  // view objects, while each distinct resource ID remains a retained entry.
  return { artifactBytes, resourceBytes, resourceCount: 2 * resourceEntries };
}

export function createPrivacyWorkspace({ refresh: refreshWebMcp = () => {} } = {}) {
  const state = ui.createTaskState();
  let epoch = 0, busy = false, accepted = null, input = null, report = null, candidate = null;
  let pageIndex = 0, detailOffset = 0, rawOffset = 0, lastRequest = null, activeRequest = null;
  let phaseLease = null, fencedLease = null, reviewLease = null, railLease = null, sourceCanvasLease = null;
  let reviewReady = false, bakeActive = false, bakeFence = false, pendingClear = null, clearTransition = null;
  const retiredStates = [];
  const lifetime = createPrivacyPdfLifetime();
  const preview = createPrivacyPreview({ canvas: $('privacyCanvas'), ensurePdfJs, pdfjsAssets: PDFJS_ASSET_URLS, lifetime });
  let intake;
  const owns = () => accepted && same(accepted.owner, snapshot());
  function live() {
    const allocations = new Map(), reports = new Set();
    for (const state of [{ input, candidate, report }, ...retiredStates]) {
      for (const bytes of [state.input?.bytes, state.candidate?.artifact.bytes].filter(Boolean)) allocations.set(bytes.buffer, bytes.buffer.byteLength);
      for (const value of [state.report, state.candidate?.before, state.candidate?.after].filter(Boolean)) reports.add(value);
    }
    return combine({ artifactBytes: [...allocations.values()].reduce((sum, value) => sum + value, 0), expandedBytes: reports.size * REPORT_BYTES * 2, expandedCount: reports.size * 2 }, sourceCanvasLease, phaseLease, fencedLease, reviewLease, railLease);
  }
  function retireState() { if (input || report || candidate) retiredStates.push({ input, report, candidate }); }
  function reserve(extra = ZERO) { return assertPrivacyWorkspaceBudget(snapshot(), live(), extra); }
  function controls() {
    const owned = !!owns(), locked = !!report?.encryption.locked || !!accepted?.locked;
    $('privacyWorkspace').setAttribute('aria-busy', String(busy));
    $('dropzone').classList.toggle('privacy-selected-dropzone', !!accepted);
    document.body.classList.toggle('privacy-has-file', !!accepted);
    $('scanBtn').disabled = busy || !owned || bakeFence;
    $('cancelBtn').disabled = !busy;
    $('clearBtn').disabled = !accepted && !busy;
    $('metadataCleanup').disabled = busy || !owned || !report || !report.inspection.complete || locked || bakeFence;
    $('cleanupBtn').disabled = $('metadataCleanup').disabled || !$('metadataCleanup').checked || !!candidate;
    $('downloadBtn').disabled = busy || !candidate || !reviewReady || !same(candidate.owner, snapshot());
    $('undoBtn').disabled = busy || !owned || !snapshot().canUndo || bakeFence;
    $('redoBtn').disabled = busy || !owned || !snapshot().canRedo || bakeFence;
    $('previousPageBtn').disabled = busy || !owned || locked || pageIndex < 1;
    $('nextPageBtn').disabled = busy || !owned || locked || pageIndex >= ((report?.pageCount || accepted?.pageCount || 1) - 1);
    $('privacyPageInput').disabled = busy || !owned || locked;
    $('reloadRecoveryBtn').hidden = !bakeFence;
    for (const button of $('findingList').querySelectorAll('button')) button.disabled = busy || !owned;
    if (report) {
      const view = privacyView(report, { page: pageIndex + 1, offset: detailOffset }), rawCount = report.sensitiveText.findings.filter(value => value.page === pageIndex + 1).length;
      $('detailsPreviousBtn').disabled = busy || detailOffset === 0; $('detailsNextBtn').disabled = busy || !view.more;
      $('rawPreviousBtn').disabled = busy || rawOffset === 0; $('rawNextBtn').disabled = busy || rawOffset + 25 >= rawCount;
    }
    refreshWebMcp();
  }
  function status(key, fallback, values) { $('privacyStatus').textContent = text(key, fallback, values); }
  function showFailure(error) {
    if (error?.name === 'AbortError') return;
    const message = typeof error?.message === 'string' ? error.message : text('failed', 'This local operation could not finish.');
    ui.showError(message.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 512).replace(/[\ud800-\udbff]$/, ''));
    $('retryBtn').hidden = !accepted && !fencedLease && !reviewLease;
    if (bakeFence) status('bake_fenced', 'The native edit bake did not prove cleanup. Its reservations and task remain retained. Reload this workspace to end that context; this discards unsaved tab state.');
  }
  function clearFailure() { ui.hideError(); $('retryBtn').hidden = true; }
  function lockPanel() { const panel = $('documentResult'); panel.inert = true; panel.setAttribute('inert', ''); return panel; }
  function hideActions() { reviewReady = false; lockPanel(); $('documentResult').hidden = true; $('chainRow').hidden = true; $('downloadBtn').disabled = true; }
  async function drainResult() {
    hideActions();
    // Children retain the helper's output/original/rail closures until removed.
    await ui.clearResultAndDrain();
    $('documentResult').replaceChildren(); $('chainRow').replaceChildren(); reviewLease = railLease = null;
  }
  function invalidate(kind) {
    epoch++; queue.cancel(); lifetime.cancel(); preview.clear(); sourceCanvasLease = null;
    hideActions(); $('sensitiveDetails').open = false;
    if (kind === 'clear') { $('sensitiveMatches').replaceChildren(); $('privacyDetails').replaceChildren(); }
    // Invalidation is synchronous; the lane, rather than this call, releases
    // native/document/result leases after their first promises actually drain.
  }
  function identity() {
    ui.showDocumentIdentity(); const shared = $('documentIdentity'), now = snapshot();
    if (shared) $('privacyDocumentNames').append(shared);
    const name = now.current?.displayName || now.current?.name || accepted?.name || '';
    $('selectedFileName').textContent = name; $('selectedFileName').title = name;
    $('selectedFileSize').textContent = ui.formatBytes(now.current?.size || accepted?.size || 0);
    $('selectedFile').hidden = !!shared;
    $('privacyDocumentNames').hidden = false;
    const label = text('names_aria', 'Document names. Original: {original}. Current: {current}. Revision {revision}.', { original: now.original?.displayName || now.original?.name || '', current: name, revision: now.revision });
    $('privacyDocumentNamesSummary').setAttribute('aria-label', label); $('privacyDocumentNamesSummary').title = label;
    $('privacyCanvas').setAttribute('aria-label', name);
  }
  function resetDisplay() {
    retireState();
    report = null; input = null; candidate = null; pageIndex = detailOffset = rawOffset = 0;
    $('scanResults').hidden = $('cleanupPanel').hidden = $('sourcePreview').hidden = true;
    $('privacyPageControls').hidden = true;
    $('sensitiveDetails').hidden = true; $('sensitiveDetails').open = false; $('sensitiveMatches').replaceChildren();
    $('findingList').replaceChildren(); $('privacyDetails').replaceChildren(); $('privacyComparison').replaceChildren();
    $('resultSummary').textContent = $('privacyCoverage').textContent = $('privacyDisclosures').textContent = $('privacyPage').textContent = '';
    $('privacyPageInput').value = '1'; $('privacyCanvas').setAttribute('aria-label', text('canvas_empty', 'Current PDF preview')); $('lossManifest').replaceChildren();
    $('metadataCleanup').checked = false; state.hideSuccess();
  }
  function renderReport() {
    if (!report) return;
    const view = privacyView(report, { page: pageIndex + 1, offset: detailOffset });
    $('resultSummary').textContent = text(view.complete ? 'bounded_complete' : 'bounded_incomplete', view.complete ? 'The listed checks completed for {pages} pages. No findings is not a privacy guarantee.' : 'Coverage is incomplete across {pages} pages. Known counts are lower bounds; unknown checks are not zero.', { pages: report.pageCount });
    $('findingList').replaceChildren();
    for (const row of view.categories) {
      const li = document.createElement('li'), description = document.createElement('div'), label = document.createElement('strong'), count = document.createElement('span'), action = document.createElement('small');
      label.textContent = text(`category_${row.category}`, LABELS[row.category]);
      count.className = 'privacy-category-status'; count.textContent = `${row.lowerBound ? '≥ ' : ''}${row.count} · ${text(`status_${row.status}`, row.status)} · ${text(`scope_${row.scope}`, row.scope === 'page' ? 'Page findings' : 'Document level')}`;
      action.textContent = row.action === 'standard-metadata' ? text('info_action', 'Optional removal of eight standard Info keys only.') : row.action === 'inspect-page' ? text('page_action', 'Inspect the affected page locally; no precise text rectangle is inferred.') : text('inspect_action', 'Reported as structure only; this cleanup does not remove it.');
      const reasons = report.inspection.categories[row.category]?.reasons || [];
      for (const code of reasons.slice(0, 3)) if (REASONS[code]) action.textContent += ' ' + text(`reason_${code.replace(/-/g, '_')}`, REASONS[code]);
      description.append(label, count, action); li.append(description);
      const groups = { pageAttachments: report.pageAttachments, annotations: report.annotations, linksAndActions: report.linksAndActions, pageJavaScript: report.javascript, invisibleTextOperations: report.invisibleText, sensitivePatterns: { locations: report.sensitiveText.findings } };
      const affected = groups[row.category]?.locations?.find(value => Number.isSafeInteger(value.page) && value.page > 0 && value.page <= report.pageCount);
      if (affected) { const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-ghost'; button.textContent = text('inspect_page', 'Inspect page {page}', { page: affected.page }); button.disabled = busy; button.addEventListener('click', () => selectPage(affected.page)); li.append(button); }
      $('findingList').append(li);
    }
    $('privacyDetails').replaceChildren();
    for (const row of view.rows) { const li = document.createElement('li'); li.textContent = `${text(`category_${row.category}`, LABELS[row.category])} · ${text('page', 'page')} ${row.page}${row.count === undefined ? '' : ` · ${row.count}`}`; $('privacyDetails').append(li); }
    $('detailsPage').textContent = `${view.totalRows ? detailOffset + 1 : 0}–${Math.min(detailOffset + PRIVACY_LIMITS.rows, view.totalRows)} / ${view.totalRows}`;
    $('detailsPreviousBtn').disabled = busy || detailOffset === 0; $('detailsNextBtn').disabled = busy || !view.more;
    const raw = report.sensitiveText.findings.filter(value => value.page === pageIndex + 1);
    $('sensitiveMatches').replaceChildren();
    for (const row of raw.slice(rawOffset, rawOffset + 25)) {
      const li = document.createElement('li'); li.textContent = `${row.label.slice(0, 120)} · ${text('page', 'page')} ${row.page}, ${text('item', 'item')} ${row.item}, ${text('offset', 'offset')} ${row.offset}: ${row.match.slice(0, 120)}`; $('sensitiveMatches').append(li);
    }
    $('sensitiveDetails').hidden = !raw.length;
    $('rawPage').textContent = `${raw.length ? rawOffset + 1 : 0}–${Math.min(rawOffset + 25, raw.length)} / ${raw.length}`;
    $('rawPreviousBtn').disabled = busy || rawOffset === 0; $('rawNextBtn').disabled = busy || rawOffset + 25 >= raw.length;
    $('privacyCoverage').textContent = report.sensitiveText.truncated || !view.complete ? text('lower_bound', 'Details may be omitted. Counts and locations are bounded lower bounds wherever inspection is partial or unknown.') : text('finite_coverage', 'Only exposed PDF structures and recognized text patterns were checked. Images need OCR; split text, hidden objects, XFA, attachment contents and concealed content can be missed.');
    const permissions = report.inspection.categories.permissions?.status;
    if (permissions && permissions !== 'complete') $('privacyCoverage').textContent += ' ' + text('permissions_unknown', 'Permissions inspection is incomplete or unknown; content access and encryption facts may be incomplete.');
    $('scanResults').hidden = false; $('cleanupPanel').hidden = report.encryption.locked;
    $('signatureWarning').hidden = false;
  }
  function compare() {
    const target = $('privacyComparison'); target.replaceChildren();
    if (!candidate) return;
    const heading = document.createElement('h3'); heading.textContent = text('before_after', 'Source / saved result'); target.append(heading);
    const facts = document.createElement('p'); facts.textContent = text('verification_facts', 'Removed Info keys: {fields}. All eight standard keys are absent; page count is unchanged. Page {page} rendered. Other category counts were compared, not exhaustively proven.', { fields: candidate.verification.sourceInfoFields.join(', ') || text('none', 'none present'), page: candidate.verification.representativePage }); target.append(facts);
    const table = document.createElement('table'), head = document.createElement('thead'), header = document.createElement('tr');
    for (const label of [text('category', 'Check'), text('source', 'Source'), text('saved', 'Saved result')]) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; header.append(th); } head.append(header); table.append(head);
    const body = document.createElement('tbody'), before = privacyView(candidate.before).categories, after = privacyView(candidate.after).categories;
    for (let index = 0; index < before.length; index++) { const row = document.createElement('tr'); for (const value of [text(`category_${before[index].category}`, LABELS[before[index].category]), `${before[index].count} · ${before[index].status}`, `${after[index].count} · ${after[index].status}`]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); } body.append(row); } table.append(body); target.append(table);
  }
  function phase(extra) { reserve(extra); phaseLease = extra; }
  function retainFailedPhase(error) { if (error?.code === 'PRIVACY_CLEANUP') fencedLease = combine(fencedLease, phaseLease); }
  function inputPeak(now, { currentBytes, scene, composition }) {
    if (scene) return { artifactBytes: 3 * PRIVACY_LIMITS.outputBytes, resourceBytes: 3 * finiteData(now, 'resourceBytes'), resourceCount: 3 * finiteData(now, 'resourceCount'), expandedBytes: CANVAS_BYTES, expandedCount: 1 };
    if (composition) {
      const unique = new Map(composition.items.map(item => [item.assetId, item.width * item.height])), pixels = [...unique.values()].reduce((sum, value) => sum + value, 0);
      return { artifactBytes: 3 * 96 * 1024 * 1024, resourceBytes: 2 * finiteData(now, 'compositionNormalizedBytes'), resourceCount: 2 * unique.size, expandedBytes: pixels * 4, expandedCount: unique.size };
    }
    return { artifactBytes: currentBytes };
  }
  async function effective(operation) {
    if (input && same(input.owner, snapshot())) return input;
    operation.assertCurrent(); const now = snapshot();
    const peak = inputPeak(now, { currentBytes: finiteData(ownData(now, 'current'), 'size'), scene: now.hasScene, composition: now.hasComposition ? ui.documentSession.composition() : null });
    phase(peak); bakeActive = now.hasScene || now.hasComposition; let bakeReturned = false, value;
    try {
      // Shared scene baking has no retained cleanup handle. Do not abort its
      // supplied signal and trigger its cancellation-only cleanup suppression.
      // First bake/save/destroy still drains; ownership prevents publication.
      value = await ui.getWorkspaceInput({ bakeScene: true, bakeComposition: true, operation: bakeActive ? { isCurrent: () => same(now, snapshot()) } : operation });
      bakeReturned = !!value;
      operation.assertCurrent();
      if (!value || value.type !== 'application/pdf' || !value.bytes?.length || value.bytes.length > PRIVACY_LIMITS.inputBytes) throw new RangeError(text('effective_limit', 'The current PDF including visible edits must fit 32 MiB.'));
      reserve({ artifactBytes: value.bytes.length });
      input = { ...value, owner: ownerOf(snapshot()) };
      $('privacyDisclosures').textContent = [...value.losses.map(code => code === 'scene-baked' ? text('scene_baked', 'Inspection includes the current visible PDF edits. Use creates a rewrite; Undo restores the editable scene.') : text('composition_baked', 'Inspection includes the current image composition. Undo after Use restores it.')), text('review_copy', 'Your original PDF is preserved. Review any new copy before using it in another tool.')].join(' ');
      return input;
    } catch (error) {
      if (value?.bytes instanceof Uint8Array && input?.bytes !== value.bytes) value.bytes.fill(0);
      if (bakeActive && !bakeReturned) { bakeFence = true; fencedLease = combine(fencedLease, phaseLease); }
      throw error;
    } finally { bakeActive = false; phaseLease = null; }
  }
  async function paint(operation) {
    const value = await effective(operation); operation.assertCurrent();
    phase({ artifactBytes: value.bytes.length, expandedBytes: CANVAS_BYTES, expandedCount: 1 });
    try {
      const shown = await preview.open(value.bytes, { pageIndex, signal: operation.signal }); operation.assertCurrent();
      pageIndex = shown.pageIndex; accepted.pageCount = shown.pageCount;
      const selected = snapshot().selection;
      if (selected.length && selected[0] !== pageIndex) ui.documentSession.setSelection([pageIndex]);
      sourceCanvasLease = { expandedBytes: $('privacyCanvas').width * $('privacyCanvas').height * 4, expandedCount: 1 };
      $('privacyPage').textContent = `${pageIndex + 1} / ${shown.pageCount}`; $('privacyPageInput').value = String(pageIndex + 1); $('privacyPageInput').max = String(shown.pageCount);
      $('privacyCanvas').setAttribute('aria-label', value.displayName || value.name); $('sourcePreview').hidden = false; $('privacyPageControls').hidden = false;
    } catch (error) { retainFailedPhase(error); throw error; } finally { phaseLease = null; }
  }
  async function inspect(operation) {
    const value = await effective(operation), pdfjs = await ensurePdfJs(); operation.assertCurrent();
    phase({ artifactBytes: 2 * value.bytes.length, expandedBytes: SCAN_EXPANSION + REPORT_BYTES * 2, expandedCount: 6 });
    let result;
    try {
      result = await scanPdfPrivacy(value.bytes, { pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, signal: operation.signal, limits: PRIVACY_SCAN_LIMITS, inspectPdf: lifetime.inspect, onProgress: ({ page, pageCount }) => { if (operation.isCurrent()) ui.setProgress(5 + page / pageCount * 90, text('scanning', 'Inspecting page {page} of {pages}', { page, pages: pageCount })); } }); operation.assertCurrent();
      // Native work and destruction have drained. Keep the returned DTO charged
      // while checking its separately allocated serialized representation.
      phaseLease = { expandedBytes: REPORT_BYTES * 2, expandedCount: 2 };
      reserve({ expandedBytes: REPORT_BYTES, expandedCount: 1 });
      if (JSON.stringify(result).length > PRIVACY_LIMITS.reportUnits) throw new RangeError('The bounded local report is too large.');
      if (candidate) retiredStates.push({ candidate }); report = result; candidate = null;
    } catch (error) { retainFailedPhase(error); throw error; } finally { phaseLease = null; }
    detailOffset = rawOffset = 0; $('metadataCleanup').checked = false; $('sensitiveDetails').open = false; state.hideSuccess(); compare();
    accepted.locked = !!result.encryption.locked;
    if (!accepted.locked) await paint(operation); else { preview.clear(); sourceCanvasLease = null; $('sourcePreview').hidden = $('privacyPageControls').hidden = true; }
    operation.assertCurrent(); renderReport(); status(result.encryption.locked ? 'locked' : 'scanned', result.encryption.locked ? 'Password-protected PDF. Its contents remain unknown; cleanup is unavailable.' : 'Bounded scan ready. Inspect affected pages and review the limits before choosing cleanup.');
    return summarizePrivacyReport(result);
  }
  async function prepare(operation) {
    if (!$('metadataCleanup').checked || !report?.inspection.complete || report.encryption.locked) throw new Error('Select the supported cleanup after a completed scan.');
    const value = await effective(operation), boundary = privacyBoundary(snapshot().current?.boundary, value.losses, { rewrite: true, incomplete: !report.inspection.complete });
    const [cleanup, pdfLib, pdfjs] = await Promise.all([getCleanup(), ensurePdfLib(), ensurePdfJs()]); operation.assertCurrent();
    phase({ artifactBytes: 3 * value.bytes.length + 4 * PRIVACY_LIMITS.outputBytes, expandedBytes: CANVAS_BYTES + SCAN_EXPANSION + 4 * REPORT_BYTES, expandedCount: 11 });
    let result;
    try { result = await cleanup.cleanPdfPrivacy(value.bytes, { categories: ['standard-metadata'], pdfLib, pdfjs, pdfjsAssets: PDFJS_ASSET_URLS, limits: PRIVACY_SCAN_LIMITS, inspectPdf: lifetime.inspect, signal: operation.signal, createCanvas: () => document.createElement('canvas') }); operation.assertCurrent();
      if (!(result.bytes instanceof Uint8Array) || result.bytes.length > PRIVACY_LIMITS.outputBytes || result.lossManifest.verified !== true || result.verification.standardInfoAbsent !== true || !result.verification.pageCountUnchanged || result.verification.unverifiedCategories.length) throw new Error('The saved copy did not meet the named verification checks.');
      const suffix = '-metadata-cleaned.pdf', name = value.name.replace(/\.pdf$/i, '') + suffix;
      const descriptor = { type: 'application/pdf', name, displayName: (value.displayName || value.name).replace(/\.pdf$/i, '') + suffix, capabilities: { ...value.capabilities, encrypted: false }, boundary };
      reserve({ artifactBytes: result.bytes.length, expandedBytes: 4 * REPORT_BYTES, expandedCount: 4 });
      candidate = { artifact: createArtifact(result.bytes, name, descriptor), before: result.before, after: result.report, verification: result.verification, owner: ownerOf(snapshot()), phase: 'prepared' };
    } catch (error) { retainFailedPhase(error); throw error; } finally { result = null; phaseLease = null; }
    operation.assertCurrent(); compare();
    $('lossManifest').replaceChildren(); const item = document.createElement('li'); item.textContent = text('eight_only', 'Only Title, Author, Subject, Keywords, Creator, Producer, CreationDate and ModDate were removed. XMP, attachments, actions and other contents were not selected for removal.'); $('lossManifest').append(item);
    $('successText').textContent = text('saved_verified', 'The new saved copy reopened, rendered one representative page and passed the named before/after checks. Review is required before Download or Use.'); state.showSuccess();
    await review(candidate, operation);
  }
  function reviewPeak(artifact) {
    const original = snapshot().original, originalSize = original?.size || 0;
    return { artifactBytes: artifact.bytes.length * 3 + originalSize + Math.max(artifact.bytes.length, originalSize), expandedBytes: CANVAS_BYTES, expandedCount: 1 };
  }
  async function review(value, operation) {
    operation.assertCurrent(); if (candidate !== value || !same(value.owner, snapshot())) throw stale();
    preview.clear(); await preview.drained(); sourceCanvasLease = null;
    await drainResult(); operation.assertCurrent();
    const peak = reviewPeak(value.artifact); reserve(peak); reviewLease = peak;
    const panel = lockPanel(), artifact = value.artifact; $('sourcePreview').hidden = true;
    let adopted = false;
    try {
      const shown = await ui.reviewResult(artifact.bytes, artifact.name, { ...artifact, operation, allowAdopt: value.phase === 'prepared', onAdopt: value.phase === 'prepared' ? (next, current) => {
        if (adopted || candidate !== value || operation.signal.aborted || !same(next, snapshot()) || next.taskId !== accepted?.owner.taskId || current.type !== artifact.type || current.bytes.length !== artifact.bytes.length || !current.bytes.every((byte, index) => byte === artifact.bytes[index])) return;
        adopted = true; operation.transfer(next); accepted.owner = ownerOf(next); accepted.name = current.displayName || current.name; accepted.size = current.bytes.length; value.owner = ownerOf(next); value.phase = 'chosen';
        if (input) retiredStates.push({ input }); input = null; report = value.after; $('sensitiveDetails').open = false; identity(); renderReport(); hideActions();
        status('checking_chosen', 'The chosen copy is current. Checking its actual preview before continuing.');
        void submit('review', { candidate: value }).catch(() => {});
      } : undefined });
      operation.assertCurrent();
      const viewport = shown?.querySelector('#documentResultPreview'), canvas = viewport?.querySelector('canvas');
      const selected = Math.max(1, Math.min(value.after.pageCount, (Number.isSafeInteger(snapshot().selection[0]) ? snapshot().selection[0] : 0) + 1));
      if (shown !== panel || panel.hidden || viewport?.getAttribute('aria-busy') !== 'false' || !canvas || canvas.dataset.pdfPage !== String(selected) || canvas.getAttribute('aria-label') !== (artifact.displayName || artifact.name) || !(canvas.width > 0 && canvas.height > 0 && canvas.width <= 900 && canvas.height <= 900 && canvas.width * canvas.height <= 4000000)) throw new Error(text('preview_failed', 'The exact saved copy is retained, but its selected-page preview failed. Retry uses the same bytes without saving again.'));
      // Shared image comparison has additional resource/decode copies. Keep
      // those real native controls disabled rather than inventing helper flags.
      for (const id of ['documentResultOriginal', 'showOriginalImageBtn']) { const control = $(id); if (control) { control.disabled = true; control.title = text('image_comparison_limited', 'Original images remain in this task. This bounded PDF review does not allocate another image decode.'); } }
      if (value.phase === 'chosen') {
        const now = snapshot(), railPeak = { artifactBytes: 4 * artifact.bytes.length + 2 * (now.retainedBytes - now.resourceBytes), resourceBytes: 2 * now.resourceBytes, resourceCount: 2 * now.resourceCount };
        try {
          reserve(railPeak); railLease = railPeak;
          await ui.offerChain(artifact.bytes, artifact.name, [{ slug: 'edit-metadata', label: 'Edit Metadata' }, { slug: 'document-doctor', label: 'Document Doctor' }, { slug: 'view-pdf', label: 'Reader' }], { ...artifact, operation, continuationOperation: operation }); operation.assertCurrent();
          status('chosen', 'This verified copy is current. Download or continue with these exact chosen bytes.');
        } catch (error) {
          if (error?.code !== 'PRIVACY_BUDGET') throw error;
          railLease = null; $('chainRow').hidden = true;
          status('rail_limit', 'The chosen copy is retained and can be downloaded. Continuing would exceed this task’s remaining joint budget; its history and resources were retained.');
        }
      } else status('review_ready', 'The saved copy has an actual selected-page preview. Download is explicit. Use this result before continuing.');
      operation.assertCurrent(); reviewReady = true; panel.inert = false; panel.removeAttribute('inert'); clearFailure(); identity();
    } catch (error) {
      hideActions();
      try { await drainResult(); } catch (cleanupError) { throw cleanupError; }
      throw error;
    }
  }
  async function run(request, job) {
    activeRequest = request;
    let owner = request.expected;
    if (clearTransition && same(owner, clearTransition.before) && request.epoch > clearTransition.epoch && same(snapshot(), clearTransition.after)) owner = clearTransition.after;
    const operation = { signal: job.signal, isCurrent: () => request.epoch === epoch && job.isCurrent() && same(owner, snapshot()) && (!request.isCurrent || request.isCurrent()), assertCurrent() { job.assertCurrent(); checkSignal(request.signal); if (!this.isCurrent()) throw stale(); }, transfer(next) { owner = ownerOf(next); } };
    try {
      await preview.drained({ retry: !!request.retry }); await lifetime.drained({ retry: !!request.retry });
      if (fencedLease && !bakeFence) fencedLease = null;
      await drainResult(); operation.assertCurrent();
      retiredStates.length = 0;
      if (bakeFence) throw new Error(text('bake_fence', 'Reload this workspace to end the native bake context before starting another PDF operation. Unsaved tab state will be discarded.'));
      if (request.kind === 'file') {
        const file = request.file; request.file = null;
        if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > PRIVACY_LIMITS.inputBytes) throw new RangeError('Choose a PDF of at most 32 MiB.');
        phase(combine({ artifactBytes: 3 * file.size }, inheritedLease(file)));
        try {
          intake ||= (await getIntakeModule()).createPrivacyIntake(); operation.assertCurrent();
          const selected = await intake.stage(file, { signal: operation.signal, isCurrent: () => operation.isCurrent(), expectedOwner: owner, maxBytes: PRIVACY_LIMITS.inputBytes, maxPages: PRIVACY_LIMITS.pages, inspectPdf: lifetime.inspect, assertAdmission: ({ inherited, size }) => {
            operation.assertCurrent(); const previous = phaseLease; phaseLease = null;
            try { phase(combine({ artifactBytes: 3 * size }, inheritedLease(null, inherited))); }
            catch (error) { phaseLease = previous; throw error; }
            operation.assertCurrent();
          } });
          job.assertCurrent(); checkSignal(request.signal); if (request.epoch !== epoch || !same(selected.owner, snapshot())) throw stale();
          operation.transfer(selected.owner); resetDisplay(); pageIndex = restoredPageIndex(selected.owner); retiredStates.length = 0; request.committed = true; accepted = { owner: ownerOf(selected.owner), name: selected.name, size: selected.size, locked: selected.locked };
          selected.bytes = null;
          if (!request.inherited) history.replaceState(null, '', location.pathname);
          $('privacyDocumentNames').open = false; identity();
        } catch (error) { retainFailedPhase(error); throw error; } finally { phaseLease = null; }
        if (!accepted.locked) await paint(operation);
        status(accepted.locked ? 'locked_ready' : 'ready', accepted.locked ? 'Password-protected PDF accepted. Scan reports unknown contents; cleanup is unavailable.' : 'Current PDF ready. Scan its detectable structures and text patterns.'); clearFailure();
      } else if (request.kind === 'scan') return await inspect(operation);
      else if (request.kind === 'cleanup') await prepare(operation);
      else if (request.kind === 'review') await review(request.candidate, operation);
      else if (request.kind === 'history') {
        const now = snapshot(), plan = historyCopyPlan(now), previewBytes = Math.min(plan.upper, PRIVACY_LIMITS.inputBytes);
        // Admit the copy/commit peak and later effective-current/page preview
        // before any historyTarget or canonical Undo/Redo call.
        phase(combine(plan.lease, { artifactBytes: 2 * previewBytes, expandedBytes: CANVAS_BYTES, expandedCount: 1 }));
        let target, restored;
        try {
          operation.assertCurrent(); target = ui.documentSession.historyTarget(request.direction); operation.assertCurrent();
          if (!target || target.artifact.bytes.length > PRIVACY_LIMITS.inputBytes || target.artifact.type !== 'application/pdf' && !target.scene && !target.composition) throw new Error('This history entry requires its compatible workspace.');
          restoredPageIndex(now);
          if (target.scene || target.composition) reserve(inputPeak(now, { currentBytes: target.artifact.bytes.length, scene: target.scene, composition: target.composition }));
          operation.assertCurrent(); restored = ui.documentSession[request.direction]();
          const next = snapshot(); operation.transfer(next); accepted.owner = ownerOf(next); resetDisplay(); pageIndex = restoredPageIndex(next); identity();
        } finally {
          // Both public return values are owned copies, separate from the new
          // canonical restore. Drop them only after synchronous work settles.
          target?.artifact?.bytes.fill(0); restored?.bytes.fill(0); target = restored = null; phaseLease = null;
        }
        await paint(operation); clearFailure(); status('history_ready', 'The selected history state is current. Visible edits are retained; scan this revision again.');
      } else if (request.kind === 'preview') { await paint(operation); renderReport(); clearFailure(); }
      else { clearFailure(); }
      operation.assertCurrent();
    } catch (error) {
      if (error?.code === 'PRIVACY_CLEANUP') { fencedLease = combine(fencedLease, phaseLease); phaseLease = null; }
      if (request.kind === 'file' && !request.committed && operation.isCurrent() && owns() && !fencedLease && !bakeFence) {
        try { if (candidate && same(candidate.owner, snapshot())) await review(candidate, operation); else if (!accepted.locked) await paint(operation); } catch (restoreError) { if (restoreError?.code === 'PRIVACY_CLEANUP') throw restoreError; }
      }
      throw error;
    } finally {
      if (pendingClear && !bakeActive) {
        const record = pendingClear; pendingClear = null;
        if (same(record.owner, snapshot()) && !bakeFence) { ui.documentSession.clear(); clearTransition = { before: record.owner, after: ownerOf(snapshot()), epoch: record.epoch }; }
      }
      if (!fencedLease) phaseLease = null;
      if (!fencedLease && !bakeFence) retiredStates.length = 0;
      if (activeRequest === request) activeRequest = null;
    }
  }
  const queue = createPrivacyWorkQueue(run);
  function submit(kind, details = {}) {
    try { if (details.signal != null) Reflect.apply(aborted, details.signal, []); } catch (error) { return Promise.reject(error); }
    invalidate(kind); const ticket = epoch;
    busy = true; clearFailure(); $('sensitiveDetails').open = false;
    const request = { kind, ...details, epoch: ticket, expected: details.expectedOwner || ownerOf(snapshot()) }; lastRequest = request;
    controls(); status('working', 'Working locally. A newer choice waits for the first native work and cleanup to drain.');
    if (kind === 'scan' || kind === 'cleanup') state.showProgress(kind === 'scan' ? text('scanning_start', 'Inspecting bounded structures and text locally…') : text('cleaning', 'Creating and verifying the Info-cleaned copy…'));
    let externalAbort;
    if (request.signal != null) { try { Reflect.apply(aborted, request.signal, []); } catch (error) { busy = false; controls(); return Promise.reject(error); } externalAbort = () => { if (request.epoch === epoch) { queue.cancel(Reflect.apply(reason, request.signal, [])); lifetime.cancel(Reflect.apply(reason, request.signal, [])); preview.clear(); } }; Reflect.apply(add, request.signal, ['abort', externalAbort, { once: true }]); }
    const work = queue.submit(request);
    if (request.signal != null && Reflect.apply(aborted, request.signal, [])) externalAbort();
    work.catch(error => { if (ticket === epoch) {
      if (error?.code !== 'PRIVACY_CLEANUP' && request.signal != null && Reflect.apply(aborted, request.signal, [])) status('canceled', 'Canceled. The accepted task and report are retained.');
      else showFailure(error);
    } }).finally(() => { if (externalAbort) Reflect.apply(remove, request.signal, ['abort', externalAbort]); if (ticket === epoch) { busy = false; ui.hideProgress(); controls(); } });
    return work;
  }
  function selectPage(page) {
    if (busy || !owns() || !Number.isSafeInteger(page) || page < 1 || page > (report?.pageCount || accepted.pageCount || 0)) return;
    pageIndex = page - 1; detailOffset = rawOffset = 0; ui.documentSession.setSelection([pageIndex]); $('sensitiveDetails').open = false;
    renderReport();
    void submit(candidate ? 'review' : 'preview', candidate ? { candidate } : {}).catch(() => {});
  }
  function stop(clear) {
    const ticket = epoch, owned = owns(), clearOwner = owned && ownerOf(snapshot());
    busy = false; ui.hideProgress(); hideActions();
    if (clear) {
      if (owned) {
        if (bakeActive || bakeFence) pendingClear = { owner: clearOwner, epoch: ticket };
        else { ui.documentSession.clear(); clearTransition = { before: clearOwner, after: ownerOf(snapshot()), epoch: ticket }; }
      }
      accepted = null; resetDisplay(); $('documentIdentity')?.remove(); $('selectedFile').hidden = true; $('selectedFileName').textContent = $('selectedFileSize').textContent = '';
      $('privacyDocumentNames').hidden = true; $('privacyDocumentNames').open = false; $('privacyDocumentNamesSummary').title = ''; $('privacyDocumentNamesSummary').setAttribute('aria-label', text('names', 'Document names')); clearFailure();
      status('empty', 'Choose a PDF of at most 32 MiB and 1000 pages.');
    } else { status('canceled', 'Canceled. The accepted task, report and saved candidate are retained. Retry after cleanup drains.'); $('retryBtn').hidden = !accepted && !fencedLease; }
    controls();
    void queue.drained().then(() => preview.drained()).then(() => drainResult()).then(() => { if (!bakeFence && !fencedLease) retiredStates.length = 0; }).catch(error => { if (ticket === epoch) showFailure(error); }).finally(() => { if (ticket === epoch) controls(); });
  }
  $('scanBtn').addEventListener('click', () => { if (owns() && !busy) return submit('scan').catch(() => {}); });
  $('cleanupBtn').addEventListener('click', () => { if (owns() && !busy) return submit('cleanup').catch(() => {}); });
  $('metadataCleanup').addEventListener('change', () => {
    const wasBusy = busy; invalidate('mode'); const ticket = epoch;
    if (candidate) retiredStates.push({ candidate }); candidate = null; state.hideSuccess(); compare(); busy = wasBusy; controls();
    void queue.drained().then(() => drainResult()).then(() => { if (!fencedLease && !bakeFence) retiredStates.length = 0; }).catch(error => { if (ticket === epoch) showFailure(error); }).finally(() => { if (ticket === epoch) { busy = false; state.hideProgress(); controls(); } });
  });
  $('downloadBtn').addEventListener('click', () => { if (!busy && reviewReady && candidate && same(candidate.owner, snapshot())) { try { reserve(); ui.downloadBytes(candidate.artifact.bytes, candidate.artifact.name, candidate.artifact.type, { download: true }); } catch (error) { showFailure(error); } } });
  $('retryBtn').addEventListener('click', () => {
    if (busy || bakeFence) return;
    const kind = candidate && same(candidate.owner, snapshot()) ? 'review' : owns() ? 'preview' : 'drain';
    void submit(kind, { candidate, retry: true }).catch(() => {});
  });
  for (const [id, direction] of [['undoBtn', 'undo'], ['redoBtn', 'redo']]) $(id).addEventListener('click', () => { if (!busy && owns()) void submit('history', { direction }).catch(() => {}); });
  $('previousPageBtn').addEventListener('click', () => selectPage(pageIndex)); $('nextPageBtn').addEventListener('click', () => selectPage(pageIndex + 2));
  $('privacyPageInput').addEventListener('change', () => { const value = $('privacyPageInput').value; if (/^[1-9]\d{0,3}$/.test(value)) selectPage(Number(value)); else $('privacyPageInput').value = String(pageIndex + 1); });
  for (const [id, delta, raw] of [['detailsPreviousBtn', -25, false], ['detailsNextBtn', 25, false], ['rawPreviousBtn', -25, true], ['rawNextBtn', 25, true]]) $(id).addEventListener('click', () => { if (!busy && report) { if (raw) rawOffset = Math.max(0, rawOffset + delta); else detailOffset = Math.max(0, detailOffset + delta); renderReport(); } });
  $('reloadRecoveryBtn').addEventListener('click', () => location.reload());
  controls();
  return {
    invalidate,
    accept: (file, options) => submit('file', { file, ...options }),
    scan: ({ signal } = {}) => owns() && !busy ? submit('scan', { signal }) : Promise.reject(busy ? new DOMException('Another document operation is active.', 'InvalidStateError') : new Error('Select an available PDF first.')),
    cancel: () => stop(false), clear: () => stop(true), refresh: controls,
    getSelectedFile: () => owns() ? { name: accepted.name, size: accepted.size } : null,
  };
}
