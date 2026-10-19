import * as ui from './tool-ui.js';
import { t } from './i18n.js';

const sameOwner = (a, b) => a.taskId === b.taskId && a.revision === b.revision && a.generation === b.generation;
const copyText = (key, fallback) => t('protection.' + key, fallback);

export function bootProtectionWorkspace(mode) {
  const host = document.getElementById('protectionWorkspace'); if (!host || !['protect', 'unlock'].includes(mode)) return;
  let intent = 0, operationRevision = 0, accepted = null, pendingInput = null, output = null, activeJob = null, operationController = null, previewController = null, runtimePromise = null, queue = null, preview = null, intake = null;
  let pendingSelection = null, selecting = false, inputApi = null;
  const initialController = new AbortController();
  let busy = false, ready = false, shown = 'current', cleanupFailure = false;
  const nodes = {};
  function element(tag, text, parent = host, id) { const value = document.createElement(tag); if (text) value.textContent = text; if (id) { value.id = id; nodes[id] = value; } parent.append(value); return value; }
  function button(label, id, action, parent = host) { const value = element('button', label, parent, id); value.type = 'button'; value.className = 'btn btn-secondary'; value.addEventListener('click', action); return value; }
  const bar = element('div', null, host); bar.className = 'protection-toolbar';
  button(copyText('clear', 'Clear'), 'clearProtectionBtn', clear, bar);
  button(copyText('cancel', 'Cancel'), 'cancelProtectionBtn', cancel, bar);
  button(copyText('undo', 'Undo'), 'undoProtectionBtn', () => void recover('undo'), bar);
  button(copyText('redo', 'Redo'), 'redoProtectionBtn', () => void recover('redo'), bar);
  button(copyText('restore_original', 'Use original'), 'originalProtectionBtn', () => void recover('original'), bar);
  button(copyText('download_current', 'Download current PDF'), 'downloadCurrentProtectionBtn', () => { if (!accepted || busy || !owns(accepted.owner)) return; const current = ui.documentSession.current(); ui.downloadBytes(current.bytes, current.name, current.type, { download: true }); }, bar);
  const status = element('p', copyText('choose', 'Choose a PDF to begin.'), host, 'protectionStatus'); status.setAttribute('role', 'status');
  const details = element('details', null, host, 'protectionDocumentDetails'); details.className = 'protection-document-details'; details.hidden = true;
  const summary = element('summary', null, details, 'protectionDocumentSummary');
  element('span', copyText('document_details', 'Document details'), summary);
  const currentSummary = element('span', null, summary); currentSummary.className = 'protection-summary-row';
  element('span', t('workspace.current', 'Current') + ':', currentSummary);
  const currentName = element('span', '', currentSummary, 'protectionCurrentName'); currentName.className = 'protection-summary-name'; currentName.dir = 'auto';
  const pendingSummary = element('span', null, summary, 'protectionPendingSummary'); pendingSummary.className = 'protection-summary-row'; pendingSummary.hidden = true;
  element('span', copyText('pending_input', 'Pending input') + ':', pendingSummary);
  const pendingName = element('span', '', pendingSummary, 'protectionPendingName'); pendingName.className = 'protection-summary-name'; pendingName.dir = 'auto';
  const identity = element('p', '', details, 'protectionInputIdentity'); identity.className = 'protection-identity'; identity.hidden = true;
  const currentLosses = element('ul', null, host, 'protectionCurrentLosses'); currentLosses.hidden = true;
  currentLosses.setAttribute('aria-label', copyText('current_disclosures', 'Current document disclosures'));
  const form = element('div', null, host, 'protectionFields'); form.className = 'protection-fields';
  function secret(label, id, autocomplete) {
    const wrap = element('div', null, form); wrap.className = 'protection-field';
    const name = element('label', label, wrap); name.htmlFor = id;
    const row = element('div', null, wrap); row.className = 'protection-secret';
    const input = element('input', null, row, id); input.type = 'password'; input.autocomplete = autocomplete; input.className = 'text-input'; input.setAttribute('aria-describedby', 'protectionCredentialError');
    const show = button(copyText('show', 'Show'), id + 'Show', () => { const visible = input.type === 'password'; input.type = visible ? 'text' : 'password'; show.textContent = copyText(visible ? 'hide' : 'show', visible ? 'Hide' : 'Show'); show.setAttribute('aria-pressed', String(visible)); }, row); show.setAttribute('aria-controls', id); show.setAttribute('aria-pressed', 'false');
    input.addEventListener('input', policyEdited); input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void submit(); } });
    return input;
  }
  const password = secret(mode === 'protect' ? copyText('opening_password', 'Opening password') : copyText('pdf_password', 'PDF password (may be empty)'), 'passwordInput', mode === 'protect' ? 'new-password' : 'off');
  const confirmation = mode === 'protect' ? secret(copyText('confirm_password', 'Confirm opening password'), 'confirmInput', 'new-password') : null;
  const ownerPassword = mode === 'protect' ? secret(copyText('owner_password', 'Owner password (optional)'), 'ownerInput', 'off') : null;
  function select(label, id, values) { const wrap = element('label', label, form); wrap.className = 'protection-field'; const value = element('select', null, wrap, id); value.className = 'select-input'; for (const [key, text] of values) { const option = element('option', copyText(id + '_' + key, text), value); option.value = key; } value.addEventListener('change', policyEdited); return value; }
  const algorithm = mode === 'protect' ? select(copyText('encryption', 'Encryption'), 'protectionAlgorithm', [['aes256', 'AES-256'], ['aes128', 'AES-128 compatibility (ASCII, up to 32 bytes)']]) : null;
  const printing = mode === 'protect' ? select(copyText('printing', 'Printing'), 'protectionPrinting', [['full', 'Full resolution'], ['low', 'Low resolution'], ['none', 'Not allowed']]) : null;
  const modifying = mode === 'protect' ? select(copyText('modifying', 'Editing permissions'), 'protectionModifying', [['all', 'All changes'], ['annotate', 'Annotations and forms'], ['form', 'Form filling'], ['assembly', 'Document assembly'], ['none', 'No changes']]) : null;
  const extraction = mode === 'protect' ? select(copyText('extraction', 'Copy text and images'), 'protectionExtraction', [['yes', 'Allowed'], ['no', 'Not allowed']]) : null;
  const errorBox = element('p', '', form, 'protectionCredentialError'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
  button(copyText(mode === 'protect' ? 'protect_review' : 'unlock_review', mode === 'protect' ? 'Protect and review' : 'Unlock and review'), mode === 'protect' ? 'protectBtn' : 'unlockBtn', () => void submit(), form).className = 'btn btn-primary';
  const policyHint = element('p', copyText('policy_hint', 'AES-256 passwords allow up to 127 UTF-8 bytes. Passwords stay in this tab. Opening and owner passwords must not contain control characters.'), form); policyHint.className = 'option-hint';
  if (mode === 'unlock') policyHint.textContent = copyText('unlock_hint', 'An empty opening password is allowed. A pending input replaces the current task only after it is validated.');
  const review = element('section', null, host, 'protectionReview'); review.hidden = true;
  element('h2', copyText('review_actual', 'Review the actual result'), review);
  const resultLosses = element('ul', null, review, 'protectionResultLosses'); resultLosses.hidden = true;
  resultLosses.setAttribute('aria-label', copyText('result_disclosures', 'Result disclosures'));
  const reviewActions = element('div', null, review); reviewActions.className = 'protection-toolbar';
  button(copyText('use', 'Use this result'), 'useProtectionResultBtn', useResult, reviewActions).className = 'btn btn-primary';
  button(copyText('download', 'Download result'), 'downloadProtectionResultBtn', () => { if (reviewCurrent()) ui.downloadBytes(output.bytes, output.name, 'application/pdf', { download: true }); }, reviewActions);
  const previewControls = element('div', null, host); previewControls.className = 'protection-toolbar';
  button(copyText('show_current', 'Show current'), 'showProtectionCurrentBtn', () => void showCurrent().catch(finiteError), previewControls);
  button(copyText('show_result', 'Show result'), 'showProtectionResultBtn', () => void showOutput().catch(finiteError), previewControls);
  button(copyText('previous', 'Previous page'), 'previousProtectionPageBtn', () => void page(-1), previewControls);
  element('span', '', previewControls, 'protectionPageStatus').setAttribute('aria-live', 'polite');
  button(copyText('next', 'Next page'), 'nextProtectionPageBtn', () => void page(1), previewControls);
  const canvasHost = element('div', null, host, 'protectionCanvas'); canvasHost.className = 'protection-preview'; canvasHost.setAttribute('aria-busy', 'false');
  button(copyText('retry_cleanup', 'Retry cleanup'), 'retryProtectionCleanupBtn', () => void retryCleanup());
  // Keep DOM and keyboard order aligned: inspect the actual page before the
  // settings, then choose Use/Download only from its guarded result review.
  for (const value of [previewControls, canvasHost, review]) host.insertBefore(value, form);
  host.hidden = false;

  function owns(owner) { return sameOwner(owner, ui.documentSession.snapshot()); }
  function setStatus(value) { status.textContent = value; }
  function refreshIdentity() {
    const current = ui.documentSession.snapshot().current, name = current?.displayName || current?.name || '';
    ui.showDocumentIdentity();
    const sharedIdentity = document.getElementById('documentIdentity');
    if (current && sharedIdentity) details.append(sharedIdentity); else sharedIdentity?.remove();
    const inheritedName = pendingInput?.inherited?.name === pendingInput?.name ? pendingInput?.inherited?.displayName : undefined;
    const candidateName = typeof inheritedName === 'string' && inheritedName.trim() && inheritedName.length <= 260 && !/[\u0000-\u001f\u007f-\u009f]/.test(inheritedName) ? inheritedName : pendingInput?.name || '';
    currentName.textContent = name || copyText('no_current', 'No current document'); currentName.title = name; currentName.setAttribute('aria-label', currentName.textContent);
    pendingName.textContent = candidateName; pendingName.title = candidateName; pendingName.setAttribute('aria-label', candidateName); pendingSummary.hidden = !pendingInput;
    identity.textContent = pendingInput ? copyText('pending_input', 'Pending input') + ': ' + candidateName : name;
    identity.title = pendingInput ? candidateName : name; identity.setAttribute('aria-label', identity.textContent); identity.hidden = !pendingInput;
    const description = copyText('document_details', 'Document details') + '. ' + t('workspace.current', 'Current') + ': ' + currentName.textContent + (pendingInput ? '. ' + copyText('pending_input', 'Pending input') + ': ' + candidateName : '');
    summary.title = description; summary.setAttribute('aria-label', description);
    details.hidden = !current && !pendingInput;
    if (details.hidden) { details.open = false; identity.textContent = ''; identity.removeAttribute('title'); identity.removeAttribute('aria-label'); summary.removeAttribute('title'); summary.removeAttribute('aria-label'); }
  }
  function disclose(list, boundary, input) {
    list.replaceChildren();
    for (const message of input.protectionLossMessages(boundary, t)) element('li', message, list);
    list.hidden = !list.children.length;
  }
  function clearCredentials() { for (const input of [password, confirmation, ownerPassword].filter(Boolean)) { input.value = ''; input.type = 'password'; const show = nodes[input.id + 'Show']; show.textContent = copyText('show', 'Show'); show.setAttribute('aria-pressed', 'false'); } }
  function controls() {
    const state = ui.documentSession.snapshot(); form.hidden = !accepted && !pendingInput;
    const pdfInput = state.current?.type === 'application/pdf' || state.hasComposition;
    nodes[mode === 'protect' ? 'protectBtn' : 'unlockBtn'].disabled = busy || cleanupFailure || (mode === 'protect' ? !accepted || !pdfInput || state.current?.capabilities?.encrypted : !pendingInput && !pdfInput);
    nodes.clearProtectionBtn.disabled = !accepted && !pendingInput && !busy;
    nodes.cancelProtectionBtn.hidden = !busy && !pendingInput;
    nodes.undoProtectionBtn.disabled = busy || !state.canUndo; nodes.redoProtectionBtn.disabled = busy || !state.canRedo;
    nodes.originalProtectionBtn.disabled = busy || !accepted; nodes.downloadCurrentProtectionBtn.disabled = busy || !accepted;
    nodes.useProtectionResultBtn.disabled = !reviewCurrent() || output?.chosen; nodes.downloadProtectionResultBtn.disabled = !reviewCurrent();
    nodes.showProtectionResultBtn.disabled = !output || busy; nodes.showProtectionCurrentBtn.disabled = !accepted || busy;
    nodes.previousProtectionPageBtn.disabled = !ready || busy; nodes.nextProtectionPageBtn.disabled = !ready || busy;
    nodes.retryProtectionCleanupBtn.hidden = !cleanupFailure;
  }
  function finiteError(error) {
    const code = error?.code === 'DOCUMENT_PREVIEW_CLEANUP' ? 'cleanup-failed' : error?.code;
    const labels = {
      'input-limit': ['input_limit', 'Choose a non-empty PDF up to 32 MiB.'], 'invalid-pdf': ['invalid_pdf', 'This PDF could not be validated. The previous task was retained.'], 'page-limit': ['page_limit', 'Choose a PDF with at most 1,000 pages.'],
      'credential-rejected': ['wrong_password', 'The password was not accepted. Try again.'], 'credential-length': ['password_length', 'Check the password length for the selected encryption.'], 'credential-control': ['password_control', 'Passwords cannot contain control characters.'], 'credential-surrogate': ['password_encoding', 'This password contains an invalid character.'], 'credential-encoding': ['password_ascii', 'AES-128 requires printable ASCII characters.'], 'empty-owner': ['owner_empty', 'Enter an owner password or leave the optional field unused.'], 'invalid-permission': ['permissions_invalid', 'Choose supported permission options.'],
      'requires-unlock': ['requires_unlock', 'This PDF is protected. Continue in Unlock before changing it.'], 'cleanup-failed': ['cleanup_failed', 'Preview cleanup did not finish. Retry cleanup before continuing.'], 'preview-failed': ['preview_failed', 'The actual result could not be previewed. Try again.'], 'unsupported-serialization': ['unsupported_pdf', 'This PDF uses an unsupported structure. The current document was retained.'], 'timeout': ['timeout', 'The operation timed out. Try a smaller PDF.'],
      'boundary-limit': ['boundary_limit', 'This result would exceed the supported processing disclosures. The current document was retained.'],
    };
    const [key, fallback] = labels[code] || ['operation_failed', 'The operation could not finish. The current document was retained.'];
    if (['canceled', 'stale'].includes(code)) return;
    if (code === 'cleanup-failed') cleanupFailure = true;
    errorBox.textContent = copyText(key, fallback); errorBox.hidden = false; canvasHost.setAttribute('aria-busy', 'false'); controls();
  }
  function invalidateOutput() {
    operationRevision++; operationController?.abort(); previewController?.abort(); output = null; ready = false; review.hidden = true; preview?.pause(); canvasHost.setAttribute('aria-busy', 'false');
    resultLosses.replaceChildren(); resultLosses.hidden = true;
    const rail = document.getElementById('chainRow'); rail.hidden = true; rail.replaceChildren(); ui.clearResult(); controls();
  }
  function policyEdited() { invalidateOutput(); errorBox.hidden = true; setStatus(copyText('settings_changed', 'Settings changed. Run the operation to review a new result.')); }
  async function runtime() {
    return runtimePromise ||= Promise.all([import('./protection-intake.js'), import('./protection-preview.js'), import('./lib-loader.js')]).then(([input, display, engines]) => {
      inputApi = input;
      intake = input.createProtectionIntake({ ensurePdfLib: engines.ensurePdfLib, ensurePdfJs: engines.ensurePdfJs, pdfjsAssets: engines.PDFJS_ASSET_URLS });
      preview = display.createProtectionPreview({ host: canvasHost, ensurePdfJs: engines.ensurePdfJs, pdfjsAssets: engines.PDFJS_ASSET_URLS, onState: value => { ready = value.ready; nodes.protectionPageStatus.textContent = `${value.page} / ${value.pages}`; canvasHost.setAttribute('aria-busy', String(!value.ready)); controls(); } });
      return { input, engines };
    }).catch(error => { runtimePromise = null; throw error; });
  }
  async function drainOwned(retry = false) {
    await Promise.allSettled([activeJob]);
    await preview?.drained({ retry }); await intake?.drained({ retry }); await ui.clearResultAndDrain();
  }
  function bind(expected, token, revision, signal) { return { signal, isCurrent: () => intent === token && (revision === undefined || operationRevision === revision) && owns(expected) }; }
  function assert(guard) { if (guard.signal?.aborted || !guard.isCurrent()) { const error = new Error('stale'); error.code = 'stale'; throw error; } }
  async function ensureQueue() {
    const value = await runtime();
    queue ||= value.input.createProtectionFileQueue(async (file, guard) => { await drainOwned(); assert(guard); const data = await intake.read(file, guard); assert(guard); if (mode === 'protect') { data.validation = await intake.validatePlain(data.bytes, guard); assert(guard); } return data; });
    return queue;
  }
  function choose(file, initialToken) {
    if (!file || (initialToken !== undefined && initialToken !== intent)) return;
    if (cleanupFailure) { setStatus(copyText('cleanup_failed', 'Retry cleanup before selecting another input.')); return; }
    initialController.abort(); const token = ++intent, expected = ui.documentSession.snapshot(); queue?.cancel(); invalidateOutput(); clearCredentials(); pendingInput = null; errorBox.hidden = true; busy = true; refreshIdentity(); controls(); setStatus(copyText('validating', 'Validating the pending input. The current document is retained.'));
    pendingSelection = { file, token, expected }; void pumpSelections();
  }
  async function pumpSelections() {
    if (selecting) return; selecting = true;
    try {
      const q = await ensureQueue();
      while (pendingSelection) {
        const { file, token, expected } = pendingSelection; pendingSelection = null;
        try {
          if (token !== intent || !owns(expected)) continue;
          const staged = await q.replace(file, { isCurrent: () => token === intent && owns(expected) }); assert(staged);
          if (mode === 'unlock') {
            const value = await runtime(); assert(staged);
            pendingInput = { ...staged.data, token, expected, localOwner: value.input.localIntakeOwner(staged.generation) };
            refreshIdentity();
            setStatus(copyText('credential_pending', 'Enter the password and review. The current task is retained until validation succeeds.')); password.focus();
          } else { await commit(staged.data, false, staged); await showCurrent(); }
        } catch (error) { if (token === intent) { finiteError(error); if (!cleanupFailure && accepted && owns(accepted.owner)) await showCurrent().catch(finiteError); } }
        finally { if (token === intent) { busy = false; controls(); } }
      }
    } catch (error) { pendingSelection = null; busy = false; finiteError(error); controls(); }
    finally { selecting = false; if (pendingSelection) void pumpSelections(); }
  }
  async function commit(data, encrypted, guard) {
    assert(guard); await ui.ensureDocumentSession(); assert(guard);
    const value = await runtime(); assert(guard);
    const inherited = data.inherited || {}, capabilities = { ...value.input.knownProtectionCapabilities(inherited.capabilities), encrypted };
    const owner = ui.documentSession.begin(data.bytes, data.name, { ...inherited, type: 'application/pdf', capabilities });
    if (!owner || typeof owner.then === 'function') throw new Error('invalid-request');
    accepted = { owner: { taskId: owner.taskId, revision: owner.revision, generation: owner.generation } }; pendingInput = null;
    refreshIdentity(); return accepted;
  }
  async function showCurrent() {
    if (!accepted || !owns(accepted.owner)) return;
    const token = intent, revision = operationRevision, owner = accepted.owner, controller = new AbortController(); previewController?.abort(); previewController = controller; shown = 'current'; ready = false; preview?.pause(); canvasHost.setAttribute('aria-busy', 'true');
    const guard = bind(owner, token, revision, controller.signal); const value = await runtime(); assert(guard); await drainOwned(); assert(guard);
    const current = ui.documentSession.current();
    refreshIdentity();
    disclose(currentLosses, current.boundary, value.input);
    if (current.capabilities.encrypted) { canvasHost.setAttribute('aria-busy', 'false'); setStatus(copyText('current_encrypted', 'The current document is protected. Continue in Unlock or restore an earlier version.')); await continuations(current, guard); return; }
    const input = await ui.getWorkspaceInput({ bakeScene: true, bakeComposition: true, operation: guard }); assert(guard); if (!input) return;
    disclose(currentLosses, value.input.protectionBoundary(current.boundary, input.losses, { rewrite: false }), value.input);
    if (input.type !== 'application/pdf') { canvasHost.setAttribute('aria-busy', 'false'); setStatus(copyText('original_image', 'The original image is restored. Continue with image tools or download it.')); await continuations(current, guard); controls(); return; }
    await preview.open({ bytes: input.bytes, ...guard, page: (ui.documentSession.snapshot().selection[0] || 0) + 1 }); assert(guard);
    setStatus(copyText('current_ready', 'Current document ready. Review an output before using it.')); controls();
  }
  function reviewCurrent() { return !!output && ready && shown === 'result' && !busy && !cleanupFailure && !output.controller.signal.aborted && output.revision === operationRevision && owns(output.owner); }
  async function showOutput() {
    if (!output || !owns(output.owner)) return;
    const result = output, token = intent; previewController?.abort(); previewController = new AbortController(); shown = 'result'; ready = false; preview?.pause(); canvasHost.setAttribute('aria-busy', 'true');
    const guard = { signal: previewController.signal, isCurrent: () => output === result && intent === token && operationRevision === result.revision && !result.controller.signal.aborted && owns(result.owner) }; await drainOwned(); assert(guard);
    await preview.open({ bytes: result.bytes, credential: result.credential, ...guard, page: (ui.documentSession.snapshot().selection[0] || 0) + 1 }); assert(guard);
    if (output !== result) return;
    const value = await runtime(); assert(guard); disclose(resultLosses, result.boundary, value.input);
    review.hidden = false; setStatus(result.noop ? copyText('already_plain', 'This PDF is already unprotected. These are the unchanged original bytes.') : copyText('result_ready', 'The actual result is shown. Use it or download when ready.')); controls();
  }
  async function submit() {
    if (busy || cleanupFailure || (!accepted && !pendingInput)) return;
    const source = pendingInput, canonical = source ? source.expected : accepted.owner;
    if (!owns(canonical)) return;
    if (mode === 'protect' && password.value !== confirmation.value) { errorBox.textContent = copyText('mismatch', 'Opening passwords do not match.'); errorBox.hidden = false; confirmation.focus(); return; }
    invalidateOutput(); errorBox.hidden = true;
    const token = intent, revision = operationRevision, controller = new AbortController(); operationController = controller;
    const guard = bind(canonical, token, revision, controller.signal); let credential = password.value;
    busy = true; controls(); setStatus(copyText('working', 'Processing locally. The current document is retained.'));
    let resolveJob; const job = new Promise(resolve => resolveJob = resolve);
    const prior = activeJob; activeJob = job;
    try {
      await prior?.catch(() => {}); await preview?.drained(); await intake?.drained(); await ui.clearResultAndDrain(); assert(guard);
      const value = await runtime(); assert(guard);
      let input = source ? { bytes: source.bytes, capabilities: source.inherited?.capabilities || {}, losses: [] } : await ui.getWorkspaceInput({ bakeScene: true, bakeComposition: true, operation: guard }); assert(guard); if (!input) return;
      const engine = await import('./pdf-protection-loader.js'); assert(guard);
      const request = { operation: mode, bytes: input.bytes, ownerToken: source ? source.localOwner : canonical, operationRevision: revision };
      if (mode === 'protect') { request.userPassword = credential; request.algorithm = algorithm.value; if (ownerPassword.value !== '') request.ownerPassword = ownerPassword.value; request.permissions = { print: printing.value, modify: modifying.value, extract: extraction.value === 'yes', accessibility: true }; }
      else request.password = credential;
      let result, noop = false;
      try { result = await engine.runProtectionJob(request, guard); }
      catch (error) { if (mode !== 'unlock' || error.code !== 'already-unlocked') throw error; await intake.validatePlain(input.bytes, guard); assert(guard); result = { bytes: input.bytes }; noop = true; }
      assert(guard);
      const rewritten = !noop || input.hasScene || input.hasComposition;
      const boundary = value.input.protectionBoundary(source ? source.inherited?.boundary : ui.documentSession.current().boundary, input.losses, { rewrite: !!rewritten });
      if (source) { if (pendingInput !== source) return; await commit(source, !noop, guard); }
      const actualOwner = accepted.owner; if (!owns(actualOwner)) return;
      const current = ui.documentSession.current(), capabilities = { ...value.input.knownProtectionCapabilities(input.capabilities), encrypted: mode === 'protect' };
      output = { bytes: result.bytes, name: noop ? current.name : current.name.replace(/\.pdf$/i, '') + (mode === 'protect' ? '-protected.pdf' : '-unlocked.pdf'), capabilities, boundary, owner: actualOwner, revision, controller, credential: mode === 'protect' ? credential : undefined, chosen: false, noop: noop && !rewritten };
      disclose(currentLosses, current.boundary, value.input);
      if (mode === 'unlock') clearCredentials(); credential = undefined;
    } catch (error) { if (intent === token && operationRevision === revision) finiteError(error); }
    finally { resolveJob(); if (activeJob === job) activeJob = null; if (intent === token) { busy = false; controls(); } }
    if (output && intent === token && operationRevision === revision) await showOutput().catch(finiteError);
  }
  function useResult() {
    if (!reviewCurrent()) return; const result = output;
    try {
      const next = ui.documentSession.adopt(result.bytes, result.name, { type: 'application/pdf', capabilities: result.capabilities, boundary: result.boundary });
      // This exact synchronous Use is the sole owner transition for this review.
      result.owner = { taskId: next.taskId, revision: next.revision, generation: next.generation }; accepted.owner = result.owner; result.chosen = true; refreshIdentity(); controls();
      disclose(currentLosses, ui.documentSession.current().boundary, inputApi);
      setStatus(copyText('chosen', 'This reviewed result is now the current document.'));
      void continuations(ui.documentSession.current(), bind(result.owner, intent, result.revision, result.controller.signal)).catch(finiteError);
    } catch (error) { finiteError(error); }
  }
  async function continuations(current, guard) {
    const targets = current.capabilities.encrypted ? [{ slug: 'unlock', label: 'Unlock' }] : current.type.startsWith('image/') ? [{ slug: 'jpg-to-pdf', label: 'Images to PDF' }, { slug: 'images', label: 'Images' }] : [{ slug: 'view-pdf', label: 'Reader' }, { slug: 'add-text', label: 'Add Text' }, { slug: 'compress', label: 'Compress' }];
    await ui.offerChain(current.bytes, current.name, targets, { ...current, operation: guard, continuationOperation: guard });
  }
  async function page(delta) { try { if (ready && !busy) await preview.selectPage(preview.page() + delta); } catch (error) { finiteError(error); } }
  function cancel() {
    intent++; initialController.abort(); pendingSelection = null; queue?.cancel(); pendingInput = null; invalidateOutput(); clearCredentials(); errorBox.hidden = true; busy = true; refreshIdentity(); controls();
    const token = intent; void (async () => { await queue?.drained(); await drainOwned(); if (token !== intent) return; if (accepted && owns(accepted.owner)) await showCurrent(); else setStatus(copyText('cancelled', 'Canceled. Choose a PDF to continue.')); })().catch(finiteError).finally(() => { if (token === intent) { busy = false; controls(); } });
  }
  function clear() {
    intent++; initialController.abort(); pendingSelection = null; queue?.cancel(); pendingInput = null; accepted = null; invalidateOutput(); clearCredentials(); errorBox.hidden = true; ui.documentSession.clear(); refreshIdentity(); busy = false; controls();
    currentLosses.replaceChildren(); currentLosses.hidden = true;
    const url = new URL(location.href); url.searchParams.delete('workflow'); url.searchParams.delete('file'); history.replaceState(null, '', url.pathname + url.search + url.hash);
    setStatus(copyText('choose', 'Choose a PDF to begin.')); void (async () => { await queue?.drained(); await drainOwned(); })().catch(finiteError);
  }
  async function recover(kind) {
    if (!accepted || busy) return; const expected = accepted.owner, token = ++intent; pendingSelection = null; queue?.cancel(); pendingInput = null; invalidateOutput(); clearCredentials(); busy = true; controls();
    try {
      await queue?.drained(); await drainOwned(); if (token !== intent || !owns(expected)) return;
      if (kind === 'original') { const original = ui.documentSession.original(); ui.documentSession.adopt(original.bytes, original.name, original); }
      else ui.documentSession[kind]();
      const next = ui.documentSession.snapshot(); accepted = { owner: { taskId: next.taskId, revision: next.revision, generation: next.generation } }; refreshIdentity(); await showCurrent();
    } catch (error) { finiteError(error); } finally { if (token === intent) { busy = false; controls(); } }
  }
  async function retryCleanup() { try { await queue?.drained(); await drainOwned(true); cleanupFailure = false; errorBox.hidden = true; if (accepted && owns(accepted.owner)) await showCurrent(); controls(); } catch (error) { finiteError(error); } }
  controls(); ui.wireDropzone(document.getElementById('dropzone'), document.getElementById('fileInput'), files => void choose(files[0]));
  const initialIntent = intent, initialOwner = ui.documentSession.snapshot();
  const ownsInitial = () => initialIntent === intent && sameOwner(initialOwner, ui.documentSession.snapshot());
  void ui.takeChainedFile({ signal: initialController.signal, isCurrent: ownsInitial }).then(file => { if (file && ownsInitial()) return choose(file, initialIntent); }).catch(() => {});
}
