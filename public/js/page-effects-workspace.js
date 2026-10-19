import { t, getLang } from './i18n.js';
import { ensurePdfLib, ensurePdfJs, PDFJS_ASSET_URLS } from './lib-loader.js';
import { documentSession, documentOperations, getWorkspaceInput, reviewResult, offerChain, clearResult, showDocumentIdentity, showError, hideError, stashForChain, showProgress, setProgress, hideProgress, restoreCompositionHistory } from './tool-ui.js';
import { createPageWorkspace } from './page-workspace.js';
import { createPagePlan } from './core/page-plan.js';
import { applyPageEffect } from './core/page-effects.js';
import { splitPdfPages } from './core/page-split.js';
import { embedUnicodeFont } from './core/pdf-fonts.js';
import { renderBoundedPage } from './core/bounded-renderer.js';
import { createOutputGroup } from './page-output-group.js';
import { node, button, input, select, field, styles } from './page-effect-ui.js';

export async function openPageEffectWorkspace(mode, { isCurrent = () => true } = {}) {
  styles(); let disposed = false, suspended = false, hydrating = true, processing = false, preparing = false, failed = false, dirty = false;
  let adopted = false, renderEpoch = 0, rendering = false, renderController = null;
  let logoPending = false, logoInvalid = false, pendingLogoName = "", candidateEpoch = -1, displayedEpoch = -1, displayedPage = -1;
  let value = null, panel = null, candidate = null, group = null, pageCount = 0, pageIndex = 0, epoch = 0, controller = null, renderTask = null, timer = null, logo = null, logoEpoch = 0;
  const owns = () => !disposed && !suspended && isCurrent();
  for (const id of ['optionsSection', 'pageGridSection', 'previewPanel', 'charWarning', 'pageEffectsTask']) document.getElementById(id)?.remove();
  const root = node('section', 'page-effects-task'); root.id = 'pageEffectsTask'; document.getElementById('dropzone').after(root); document.body.classList.add('page-effects-loaded');
  const identity = node('p', 'page-effect-identity'); identity.id = 'pageEffectsIdentity'; identity.setAttribute('role', 'status');
  const modes = node('nav', 'page-effect-actions'); modes.id = 'workspaceModes'; modes.setAttribute('aria-label', t('workspace.modes', 'Document tools'));
  for (const [slug, label] of [['add-text','Add Text'],['fill-sign','Fill & Sign'],['organize','Organize'],['split','Split'],['page-numbers','Page Numbers'],['watermark','Watermark'],['images','Images']]) {
    const control = button(t(`workspace.mode_${slug}`, label), '', () => changeMode(slug)); control.dataset.mode = slug; modes.append(control);
  }
  const status = node('p'); status.id = 'pageEffectsStatus'; status.setAttribute('role', 'status');
  const history = node('div', 'page-effect-actions');
  const undo = button(t('pages.undo_current','Undo current document'), 'undoDocumentBtn', () => restore('undo'));
  const redo = button(t('pages.redo_current','Redo current document'), 'redoDocumentBtn', () => restore('redo'));
  const discard = button(t('pages.discard_settings','Discard pending settings'), 'discardPageEffectBtn', () => { logoEpoch++; logoPending = logoInvalid = false; pendingLogoName = ''; logo = null; for (const control of Object.values(controls)) { control.value = control.dataset.initialValue ?? control.value; control.checked = control.dataset.initialChecked === 'true'; } return hydrate(); });
  const replace = button(t('pages.replace','Choose another PDF'), 'replacePageInputBtn', () => document.getElementById('fileInput').click());
  history.append(undo, redo, discard, replace);
  const layout = node('div', 'page-effect-layout'), sidebar = node('aside', 'page-effect-sidebar'), preview = node('section', 'page-effect-preview');
  const selection = node('div'); selection.id = 'pageSelection'; const options = node('div', 'page-effect-options');
  sidebar.append(options, selection);
  const nav = node('div', 'page-effect-actions');
  const previous = button(t('workspace.previous_page','Previous page'), 'previousPageBtn', () => navigate(pageIndex - 1));
  const pageNumber = input('pagePreviewNumber', 1, { min: 1 }); pageNumber.setAttribute('aria-label', t('pages.preview_page','Preview page')); pageNumber.addEventListener('change', () => navigate(Number(pageNumber.value) - 1));
  const next = button(t('workspace.next_page','Next page'), 'nextPageBtn', () => navigate(pageIndex + 1));
  const previewStatus = node('span'); previewStatus.id = 'pagePreviewStatus'; previewStatus.setAttribute('aria-live','polite');
  nav.append(previous, pageNumber, next, previewStatus);
  const canvas = node('canvas'); canvas.id = 'previewCanvas'; canvas.setAttribute('aria-label', t('pages.actual_candidate','Actual selected-page PDF preview'));
  preview.append(nav, node('p','option-hint', t('pages.saved_preview','This preview renders the saved PDF candidate. Review and use the result to make it current.')), canvas);
  layout.append(sidebar, preview);
  const actions = node('div','page-effect-actions');
  const apply = button(t('pages.review_changes','Review PDF result'), mode === 'split' ? 'splitActionBtn' : 'applyBtn', review); apply.className = 'btn btn-primary';
  const cancel = button(t('common.cancel','Cancel'), 'cancelPageEffectBtn', () => { logoEpoch++; logoPending = logoInvalid = false; pendingLogoName = ''; if (controls.watermarkLogoInput) controls.watermarkLogoInput.value = ''; invalidate(); preparing = processing = false; failed = true; hideProgress(); update(); });
  const retry = button(t('pages.retry_preview','Retry actual preview'), 'retryPageEffectBtn', () => { if (!value || !panel) void hydrate(); else if (logoInvalid && controls.watermarkLogoInput.files[0]) void startLogo(controls.watermarkLogoInput.files[0]); else schedule(); });
  actions.append(apply, cancel, retry); root.append(identity, modes, history, status, layout, actions);
  const controls = {};
  const add = (label, control) => { controls[control.id] = control; options.append(field(label, control)); return control; };
  let splitEach = false;
  if (mode === 'split') {
    const tabs = node('div','page-effect-actions');
    for (const [each,id,label] of [[false,'modeExtract','Extract selected pages'],[true,'modeEach','Split selected into files']]) { const tab = button(t(`pages.${id}`,label), id, () => { splitEach = each; for (const item of tabs.children) item.setAttribute('aria-selected', String(item === tab)); changed(); }); tab.setAttribute('role','tab'); tab.setAttribute('aria-selected',String(!each)); tabs.append(tab); }
    options.append(tabs, node('p','option-hint',t('pages.split_selected','Both modes use the selected pages. Split into files creates one named PDF per selected page.')));
  } else if (mode === 'numbers') {
    add(t('pages.start_page','Start page'),input('numberStartPage',1,{min:1})); add(t('pages.start_number','Start number'),input('startInput',1,{min:0,max:1000000}));
    add(t('pages.number_format','Number format'),select('formatSelect',[['n','1, 2, 3'],['page-n','Page 1'],['page-n-of-m','Page 1 of 10']]));
    add(t('pages.position','Position'),select('positionSelect',[['bottom-center','Bottom center'],['bottom-left','Bottom left'],['bottom-right','Bottom right'],['top-center','Top center'],['top-left','Top left'],['top-right','Top right']]));
    add(t('pages.font','Font'),select('numberFont',[['regular','Noto Sans'],['bold','Noto Sans Bold'],['italic','Noto Sans Italic'],['boldItalic','Noto Sans Bold Italic'],['code','Noto Sans Mono']]));
    add(t('pages.font_size','Font size (pt)'),input('numberSize',11,{min:4,max:200}));
    add(t('pages.margin_x','Horizontal margin (pt)'),input('numberMarginX',28,{min:0,max:1000})); add(t('pages.margin_y','Vertical margin (pt)'),input('numberMarginY',28,{min:0,max:1000}));
  } else {
    add(t('pages.watermark_kind','Watermark type'),select('watermarkKind',[['text','Text'],['logo','PNG / JPEG logo']]));
    const text = add(t('watermark.text_label','Watermark text'),input('watermarkText','DRAFT',{type:'text'})); text.maxLength = 1000;
    const upload = add(t('pages.logo','Logo (PNG/JPEG, ≤16 MiB)'),input('watermarkLogoInput','',{type:'file'})); upload.accept = 'image/png,image/jpeg';
    add(t('pages.logo_width','Logo width (pt)'),input('watermarkLogoWidth',140,{min:4,max:2000}));
    add(t('watermark.style_label','Style'),select('styleSelect',[['diagonal','Diagonal'],['horizontal','Horizontal'],['custom','Custom rotation']]));
    add(t('pages.rotation','Rotation (degrees)'),input('watermarkRotation',45,{min:-360,max:360}));
    add(t('watermark.color_label','Color'),select('colorSelect',[['gray','Gray'],['red','Red'],['blue','Blue']]));
    add(t('watermark.size_label','Font size (pt)'),input('sizeSlider',56,{min:4,max:200})); add(t('watermark.opacity_label','Opacity (%)'),input('opacitySlider',15,{min:1,max:100}));
    add(t('pages.custom_x','Center from left (%)'),input('watermarkX',50,{min:0,max:100})); add(t('pages.custom_y','Center from top (%)'),input('watermarkY',50,{min:0,max:100}));
    add(t('pages.tile','Repeat as tiles'),input('watermarkTile','',{type:'checkbox'})); add(t('pages.tile_gap','Tile spacing (pt)'),input('watermarkGap',60,{min:10,max:1000}));
    const logoStatus = node('p', 'option-hint page-effect-logo-status'); logoStatus.id = 'watermarkLogoStatus'; options.append(logoStatus);
    upload.addEventListener('change', () => { if (upload.files[0]) void startLogo(upload.files[0]); });
  }
  for (const control of Object.values(controls)) if (control.type !== 'file') control.addEventListener(control.tagName === 'SELECT' || control.type === 'checkbox' ? 'change' : 'input', () => { if (control.id === 'styleSelect' && control.value !== 'custom') controls.watermarkRotation.value = control.value === 'diagonal' ? 45 : 0; changed(); });
  function settings() {
    const selected = panel.selection(), capabilities = { ...(value.capabilities || documentSession.snapshot().current.capabilities) };
    if (mode === 'numbers') return { kind: 'numbers', pages: selected, capabilities, startPage: Number(controls.numberStartPage.value), startNumber: Number(controls.startInput.value), format: controls.formatSelect.value, position: controls.positionSelect.value, font: controls.numberFont.value, size: Number(controls.numberSize.value), marginX: Number(controls.numberMarginX.value), marginY: Number(controls.numberMarginY.value) };
    if (mode === 'watermark') return { kind: 'watermark', pages: selected, capabilities, mode: controls.watermarkKind.value, text: controls.watermarkText.value, logo, logoWidth: Number(controls.watermarkLogoWidth.value), size: Number(controls.sizeSlider.value), opacity: Number(controls.opacitySlider.value)/100, color: { gray:[.55,.55,.55],red:[.78,.16,.1],blue:[.12,.29,.65] }[controls.colorSelect.value], rotation: Number(controls.watermarkRotation.value), x:Number(controls.watermarkX.value), y:Number(controls.watermarkY.value), tile:controls.watermarkTile.checked, gap:Number(controls.watermarkGap.value) };
    return { pages:selected, each:splitEach, name:value.name.replace(/\.pdf$/i,''), capabilities };
  }
  function readyCandidate() {
    return !!candidate && candidateEpoch === epoch && displayedEpoch === epoch && displayedPage === pageIndex && !preparing && !rendering && !logoPending && !logoInvalid;
  }
  function invalidate() {
    epoch++; renderEpoch++; clearTimeout(timer); controller?.abort(); controller = null; renderController?.abort(); renderController = null;
    void renderTask?.destroy().catch(() => {}); renderTask = null; candidate = null; candidateEpoch = displayedEpoch = displayedPage = -1;
    preparing = rendering = false; delete canvas.dataset.pdfPage; group?.dispose(); group = null; documentOperations.cancel(); clearResult();
  }
  function changed(run = true) { if (hydrating || !owns()) return; adopted = false; dirty = true; invalidate(); failed = logoInvalid; if (run) schedule(); else update(); }
  function update() {
    if (!owns()) return; const locked = hydrating || processing, pending = preparing || rendering || logoPending, snapshot = documentSession.snapshot();
    root.setAttribute('aria-busy', String(locked || pending));
    identity.textContent = `${t('workspace.current','Current')}: ${snapshot.current?.name || ''} · ${t('workspace.revision','Revision')} ${snapshot.revision} · ${pageCount} ${t('pages.pages','pages')}`;
    identity.title = identity.textContent; identity.setAttribute('aria-label', identity.textContent);
    for (const control of options.querySelectorAll('input,select,button')) control.disabled = locked;
    panel?.setDisabled(locked);
    for (const control of modes.children) control.disabled = locked;
    pageNumber.disabled = locked; previous.disabled = locked || pageIndex <= 0; next.disabled = locked || pageIndex >= pageCount - 1;
    undo.disabled = locked || !snapshot.canUndo; redo.disabled = locked || !snapshot.canRedo; discard.disabled = hydrating; replace.disabled = false;
    apply.disabled = adopted || locked || failed || !panel?.selection().length || !readyCandidate();
    cancel.hidden = !(processing || pending || logoInvalid) || hydrating; retry.hidden = !failed;
    const logoStatus = document.getElementById('watermarkLogoStatus');
    if (logoStatus) logoStatus.textContent = logoPending ? t('pages.logo_pending', 'Preparing selected logo: {name}. Review is unavailable until it is validated.', { name: pendingLogoName }) : logoInvalid ? t('pages.logo_invalid', 'Selected logo could not be validated: {name}. Choose another file, retry, or cancel this draft.', { name: pendingLogoName }) : logo ? t('pages.logo_validated', 'Validated logo: {name}', { name: logo.name }) : t('pages.logo_empty', 'No validated logo selected.');
    status.textContent = hydrating ? t('pages.opening_current','Opening current workspace…') : logoPending ? t('pages.logo_wait','Validating the selected logo. Settings remain editable; review will use the chosen file after validation.') : pending ? t('pages.building_preview','Building actual saved-PDF preview…') : failed ? t('pages.preview_failed_retry','The preview is unavailable. Retry, discard settings or choose another PDF.') : `${dirty ? t('pages.pending','Pending settings') : t('pages.current_ready','Current document')} · ${panel?.selection().length || 0} ${t('pages.selected','selected')}`;
  }
  async function startLogo(file) {
    if (!owns() || hydrating || processing) return;
    const token = ++logoEpoch; logoPending = true; logoInvalid = false; pendingLogoName = file.name; changed(false); update();
    try {
      const { imageAsset } = await import('./core/object-scene.js'); const nextLogo = await imageAsset(file);
      if (!owns() || token !== logoEpoch) return;
      if (nextLogo.bytes.length > 16 * 1024 * 1024) throw new RangeError('The normalized logo exceeds 16 MiB.');
      logo = nextLogo; logoPending = logoInvalid = false; pendingLogoName = ''; hideError(); schedule();
    } catch (error) {
      if (owns() && token === logoEpoch) { logoPending = false; logoInvalid = true; preparing = false; failed = true; showError(error.message); update(); }
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (logoPending || logoInvalid) { preparing = false; update(); return; }
    failed = false; preparing = true; update(); timer = setTimeout(() => { void prepare(); }, 180);
  }
  function fail(error) { if (owns() && error.name !== 'AbortError') { preparing = rendering = false; failed = true; showError(error.message); update(); } }
  async function prepare() {
    if (!owns() || !value || !panel || logoPending || logoInvalid) return;
    const token = epoch; controller?.abort(); const request = new AbortController(); controller = request; const signal = request.signal;
    const current = () => owns() && token === epoch && controller === request && !signal.aborted;
    candidate = null; candidateEpoch = -1; preparing = true; update();
    try {
      const options = settings(), [pdfLib,pdfjs] = await Promise.all([ensurePdfLib(),ensurePdfJs()]);
      if (!current()) return;
      const result = mode === 'split' ? { bytes:value.bytes, capabilities:value.capabilities } : await applyPageEffect(value.bytes, options, { pdfLib,pdfjs,pdfjsAssets:PDFJS_ASSET_URLS,embedFont:embedUnicodeFont,signal });
      if (!current()) return;
      candidate = result; candidateEpoch = token; preparing = false;
      if (await renderCurrentCandidate()) { if (current() && readyCandidate()) { failed = false; hideError(); update(); } }
    } catch (error) { if (current()) fail(error); }
  }
  async function renderCurrentCandidate() {
    if (!candidate || candidateEpoch !== epoch || !owns()) return false;
    const bytes = candidate.bytes, source = candidate, token = epoch, requestedPage = pageIndex, renderToken = ++renderEpoch;
    renderController?.abort(); const request = new AbortController(); renderController = request; const signal = request.signal;
    const current = () => owns() && token === epoch && renderToken === renderEpoch && candidate === source && pageIndex === requestedPage && !signal.aborted;
    rendering = true; displayedEpoch = displayedPage = -1; delete canvas.dataset.pdfPage;
    previewStatus.textContent = `${requestedPage + 1} / ${pageCount} · ${t('workspace.loading_page','Loading page…')}`; update();
    const old = renderTask; renderTask = null;
    const temporary = document.createElement('canvas'); temporary.style.position = 'fixed'; temporary.style.left = '-10000px'; temporary.setAttribute('aria-hidden', 'true'); document.body.append(temporary);
    let task = null;
    const releaseCanvas = () => { temporary.remove(); temporary.width = temporary.height = 0; };
    const abort = () => { releaseCanvas(); void task?.destroy().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      try { await old?.destroy(); } catch { /* previous owned render */ }
      if (!current()) return false;
      const pdfjs = await ensurePdfJs(); if (!current()) return false;
      task = pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_ASSET_URLS }); renderTask = task;
      const doc = await task.promise; if (!current()) return false;
      const page = await doc.getPage(requestedPage + 1); if (!current()) return false;
      await renderBoundedPage(page, temporary, { signal, maxDimension:1200, maxPixels:2000000 });
      if (!current()) return false;
      canvas.width = temporary.width; canvas.height = temporary.height; canvas.getContext('2d').drawImage(temporary, 0, 0);
      canvas.dataset.pdfPage = String(requestedPage + 1); displayedPage = requestedPage; displayedEpoch = token;
      pageNumber.value = requestedPage + 1; previewStatus.textContent = `${requestedPage + 1} / ${pageCount}`;
      return true;
    } catch (error) { if (current()) fail(error); return false; }
    finally {
      signal.removeEventListener('abort', abort); releaseCanvas();
      if (renderTask === task) renderTask = null;
      try { await task?.destroy(); } catch (error) { if (current()) fail(error); }
      if (current()) { rendering = false; update(); }
    }
  }
  async function navigate(index) {
    if (!owns() || hydrating || processing || !Number.isInteger(index) || index < 0 || index >= pageCount) { pageNumber.value = pageIndex + 1; return; }
    pageIndex = index; pageNumber.value = index + 1;
    if (candidate && candidateEpoch === epoch && !preparing) await renderCurrentCandidate();
    else { previewStatus.textContent = `${index + 1} / ${pageCount} · ${t('workspace.loading_page','Loading page…')}`; update(); }
  }
  async function hydrate({ chosen = false } = {}) {
    if ((logoPending || logoInvalid) && controls.watermarkLogoInput) controls.watermarkLogoInput.value = '';
    logoEpoch++; logoPending = logoInvalid = false; pendingLogoName = '';
    adopted = chosen && mode !== 'split'; invalidate(); processing = false; hideProgress(); hydrating = true; preparing = false; failed = false; dirty = false; panel?.dispose(); panel = null; update(); const token = epoch;
    try { const request = documentOperations.begin(); value = await getWorkspaceInput({operation:request}); if (!value || !owns() || token !== epoch) return;
      const pdfLib = await ensurePdfLib(); const doc = await pdfLib.PDFDocument.load(value.bytes.slice(),{updateMetadata:false}); if (!owns() || token !== epoch) return;
      pageCount = doc.getPageCount(); pageIndex = Math.min(documentSession.snapshot().selection[0] || 0,pageCount-1); pageNumber.value=pageIndex+1; pageNumber.max=pageCount;
      if (!documentSession.snapshot().selection.length) documentSession.setSelection(Array.from({length:pageCount},(_,index)=>index));
      panel = await createPageWorkspace({container:selection,disabled:true,plan:createPagePlan({sourceId:'current',pageCount}),sources:[{id:'current',bytes:value.bytes}],onSelectionChange:()=>changed(),onNavigate:(index)=>{void navigate(index);}});
      await panel.ready(); if (!owns() || token !== epoch) return; hydrating=false; showDocumentIdentity(); if (chosen && mode !== 'split') { candidate = { bytes: value.bytes, capabilities: value.capabilities }; candidateEpoch = epoch; preparing = false; await renderCurrentCandidate(); } else schedule();
    } catch(error) { if (owns() && token === epoch) { hydrating=false; failed=true; showError(error.message); update(); } }
  }
  async function review() {
    if (!owns() || hydrating || processing || failed || !panel?.selection().length || !readyCandidate()) return;
    processing=true; update(); hideError(); const token=epoch, revision=documentSession.snapshot().revision, request=documentOperations.begin();
    const current=()=>owns() && token===epoch && request.isCurrent() && revision===documentSession.snapshot().revision;
    showProgress(t('pages.building','Building selected result…'));
    try {
      const onAdopt=()=>{if(owns())void hydrate({chosen:true});};
      if (mode==='split') {
        let results=await splitPdfPages(value.bytes,settings(),{pdfLib:await ensurePdfLib(),signal:request.signal,onProgress:(event)=>{if(current())setProgress(event.percent,t('pages.splitting','Creating output PDFs…'));}});
        if(!current())return; for(const result of results)result.boundary={...result.boundary,losses:[...new Set([...result.boundary.losses,...value.losses])]};
        group=createOutputGroup(results,{container:root,signal:request.signal,isCurrent:()=>owns()&&token===epoch,onAdopt,zipName:value.name.replace(/\.pdf$/i,'')+'-pages.zip'}); results = null; await group.ready;
      } else {
        if(!candidate)return; const result=candidate, name=value.name.replace(/\.pdf$/i,'')+`-${mode==='numbers'?'numbered':'watermarked'}.pdf`;
        const boundary={...result.boundary,losses:[...new Set([...result.boundary.losses,...value.losses])]};
        await reviewResult(result.bytes,name,{...result,boundary,operation:{signal:request.signal,isCurrent:current},onAdopt});
        if(current())await offerChain(result.bytes,name,[],{...result,boundary,operation:{isCurrent:current}});
      }
    } finally { if(owns()&&token===epoch){processing=false;hideProgress();update();} }
  }
  async function restore(kind) {
    if(hydrating||processing)return; invalidate(); processing=true;update();const request=documentOperations.begin();
    try{
      const target=await restoreCompositionHistory(kind,{operation:request});
      if(target){if(owns()&&target.handoff.isCurrent()){const {handoff,targetSlug}=target,lang=getLang();location.href=`${lang==='en'?'':'/'+lang}/${targetSlug}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`;}return;}
      documentSession[kind](); await hydrate();
    }finally{if(owns()&&request.isCurrent()){processing=false;update();}}
  }
  async function changeMode(slug) {
    if(hydrating||processing||!owns())return;
    if(dirty){status.textContent=t('pages.review_before_mode','Review and use the result, or discard pending settings before changing tools.');return;}
    const request=documentOperations.begin(); const current=await getWorkspaceInput({operation:request}); if(!current||!owns()||!request.isCurrent())return;
    if(current.hasScene)documentSession.publishScene(current.bytes,current.name,{capabilities:current.capabilities});
    const handoff=await stashForChain(current.bytes,current.name,slug,{capabilities:current.capabilities,operation:request}); if(!owns()||!request.isCurrent()||!handoff.isCurrent())return;
    const lang=getLang();location.href=`${lang==='en'?'':'/'+lang}/${slug}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`;
  }
  for (const control of Object.values(controls)) { control.dataset.initialValue = control.value; control.dataset.initialChecked = String(control.checked); }
  await hydrate();
  return { suspend(){suspended=true;invalidate();if((logoPending||logoInvalid)&&controls.watermarkLogoInput)controls.watermarkLogoInput.value='';logoEpoch++;logoPending=logoInvalid=false;pendingLogoName='';preparing=processing=false;root.setAttribute('aria-busy','true');for(const control of root.querySelectorAll('button,input,select'))control.disabled=true;}, resume(){suspended=false;if(owns())schedule();}, dispose(){if(disposed)return;invalidate();disposed=true;logoEpoch++;panel?.dispose();canvas.width=canvas.height=0;root.remove();document.body.classList.remove('page-effects-loaded');} };
}
