import { t } from './i18n.js';

// Move the existing controls, retaining their input identity and event handlers.
export function mountObjectShell({ mode, root, placement, grid, pageNav, toolbar, history, status, properties, fieldEditor, canvas, zoom }) {
  const section = document.querySelector('.dropzone-section');
  const shell = document.createElement('div'); shell.id = 'objectWorkspace'; shell.className = 'object-workspace';
  const top = document.createElement('div'); top.className = 'scene-taskbar';
  const identity = document.getElementById('documentIdentity');
  const dropzone = document.getElementById('dropzone');
  const replace = document.createElement('details'); replace.className = 'scene-replace';
  const replaceLabel = document.createElement('summary'); replaceLabel.textContent = t('workspace.replace_pdf', 'Replace PDF'); replace.append(replaceLabel, dropzone);
  const apply = document.getElementById('applyBtn');
  apply.textContent = t('workspace.apply_review', 'Apply & review');
  top.append(toolbar, history, apply, replace);
  const body = document.createElement('div'); body.className = 'scene-taskbody';
  const stage = document.createElement('section'); stage.className = 'scene-stage'; stage.setAttribute('aria-label', t('workspace.document_page', 'Document page'));
  const side = document.createElement('aside'); side.className = 'scene-sidebar'; side.setAttribute('aria-label', t('workspace.edit_controls', 'Editing controls'));
  const pageControls = document.createElement('div'); pageControls.className = 'scene-page-controls';
  const scaleLabel = document.createElement('label'); scaleLabel.textContent = t('workspace.zoom', 'Zoom');
  const scale = document.createElement('select'); scale.id = 'workspaceZoom';
  for (const [value, name] of [['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%']]) { const option = document.createElement('option'); option.value = value; option.textContent = name; scale.append(option); }
  scale.addEventListener('change', () => zoom(Number(scale.value))); scaleLabel.append(scale);
  const mobile = matchMedia('(max-width:759px)').matches;
  const thumbPanel = document.createElement('details'); thumbPanel.className = 'scene-thumbnails'; thumbPanel.open = !mobile;
  const thumbLabel = document.createElement('summary'); thumbLabel.textContent = t('workspace.page_thumbnails', 'Page thumbnails'); thumbPanel.append(thumbLabel, grid);
  pageControls.append(pageNav, scaleLabel, thumbPanel);
  const scroll = document.createElement('div'); scroll.className = 'scene-canvas-scroll'; scroll.tabIndex = 0; scroll.setAttribute('aria-label', t('workspace.scroll_page', 'Document page; scroll to inspect when zoomed'));
  scroll.append(placement); stage.append(pageControls, scroll, fieldEditor);
  const selectedPanel = document.createElement('details'); selectedPanel.className = 'scene-panel'; selectedPanel.open = !mobile;
  const selectedLabel = document.createElement('summary'); selectedLabel.textContent = t('workspace.selected_object', 'Objects & position');
  const objectActions = document.createElement('div'); objectActions.className = 'editor-toolbar scene-object-actions'; objectActions.append(history.querySelector('#newObjectBtn'), history.querySelector('#deleteObjectBtn'));
  selectedPanel.append(selectedLabel, objectActions, properties);
  const draftPanel = document.createElement('details'); draftPanel.className = 'scene-panel'; draftPanel.open = true;
  const draftLabel = document.createElement('summary'); draftLabel.id = 'sceneDraftLabel'; draftLabel.textContent = t(mode === 'fill-sign' ? 'workspace.signature_text' : mode === 'add-image' ? 'workspace.image_properties' : 'workspace.text_properties', mode === 'fill-sign' ? 'Signature & text' : mode === 'add-image' ? 'Image properties' : 'Text properties');
  draftPanel.append(draftLabel, root);
  if (mode === 'fill-sign') {
    const text = document.getElementById('fillTextMode')?.closest('.option-block'); if (text) draftPanel.append(text);
    const fields = document.getElementById('fieldsSection');
    if (fields && !fields.hidden) { const panel = document.createElement('details'); panel.className = 'scene-panel'; panel.open = !mobile; const label = document.createElement('summary'); label.textContent = t('workspace.all_form_fields', 'All form fields'); panel.append(label, fields); side.append(panel); }
    const note = document.getElementById('noFieldsNote'); if (note) draftPanel.append(note);
  }
  side.prepend(draftPanel, selectedPanel);
  body.append(stage, side); shell.append(...(identity ? [identity] : []), top, status, body); section.prepend(shell);
  for (const block of root.querySelectorAll('.option-block')) if (![...block.querySelectorAll('input,textarea,select,button,canvas')].length) block.classList.add('scene-empty-block');
  canvas.setAttribute('aria-label', t('workspace.page_canvas', 'Current PDF page. Click to place an object, or select an existing object to edit it.'));
  shell.tabIndex = -1; shell.setAttribute('role', 'region'); shell.setAttribute('aria-label', t('workspace.document_workspace', 'Document workspace'));
  return { dispose() { shell.remove(); }, reveal() { shell.focus({ preventScroll: true }); shell.scrollIntoView({ block: 'start', behavior: 'instant' }); }, showObjectProperties() { selectedPanel.open = true; }, draftLabel };
}
