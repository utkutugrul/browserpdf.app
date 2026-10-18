'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { t } from './i18n.js';
import { readPdfFile, takeChainedFile, downloadBytes, offerChain, documentSession, clearResult } from './tool-ui.js';
import { embedUnicodeFont } from './core/pdf-fonts.js';
import { visualTransform } from './core/page-geometry.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fieldsSection = document.getElementById('fieldsSection');
const fieldsList = document.getElementById('fieldsList');
const noFieldsNote = document.getElementById('noFieldsNote');
const flattenInput = document.getElementById('flattenInput');
const signatureSection = document.getElementById('signatureSection');
const sigModeDraw = document.getElementById('sigModeDraw');
const sigModeType = document.getElementById('sigModeType');
const typeSigRow = document.getElementById('typeSigRow');
const typeSigInput = document.getElementById('typeSigInput');
const sigCanvas = document.getElementById('sigCanvas');
const clearSigBtn = document.getElementById('clearSigBtn');
const sigStatus = document.getElementById('sigStatus');
const sigPageGrid = document.getElementById('sigPageGrid');
const placementSection = document.getElementById('placementSection');
const placementWrap = document.getElementById('placementWrap');
const placementCanvas = document.getElementById('placementCanvas');
const applyRow = document.getElementById('applyRow');
const applyHint = document.getElementById('applyHint');
const applyBtn = document.getElementById('applyBtn');
const progressSection = document.getElementById('progressSection');
const progressStatus = document.getElementById('progressStatus');
const progressFill = document.getElementById('progressFill');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');

let currentFileName = 'document';
let pdfLibRef = null;
let currentDoc = null;
let currentForm = null;
let fieldControls = [];
let pdfJsDocRef = null;
let numPages = 0;
let selectedPageIndex = null;
let placementScale = 1;
let placementPageHeightPt = 0;
let placementPoint = null;
let hasSignature = false;
let currentBytes = null;
let placementViewport = null;
let generation = 0;
let busy = false;
let cachedExport = null;

function changed() { cachedExport = null; }
fieldsList.addEventListener('input', changed);
flattenInput.addEventListener('change', changed);

function showError(message) {
  errorText.textContent = message;
  errorSection.hidden = false;
}
function hideError() {
  errorSection.hidden = true;
  errorText.textContent = '';
}
function setProgress(percent, text) {
  progressFill.style.setProperty('--progress', String(percent));
  progressStatus.textContent = text;
}
function checkPdfMagicBytes(bytes) {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
}

function updateApplyState() {
  const hasFields = fieldControls.length > 0;
  const hasSigPlacement = hasSignature && placementPoint != null;
  applyBtn.disabled = busy || (!hasFields && !hasSigPlacement);
  if (hasSignature && placementPoint == null) {
    applyHint.textContent = t('fill-sign.js_hint_pick_page', 'Pick a page above and click on it to place your signature.');
  } else if (!hasSignature && placementPoint != null) {
    applyHint.textContent = t('fill-sign.js_hint_draw_sig', 'Draw a signature above to place it here.');
  } else if (!hasFields && !hasSigPlacement) {
    applyHint.textContent = t('fill-sign.js_hint_fill_or_sign', 'Fill a field or add a signature to enable this.');
  } else {
    applyHint.textContent = t('fill-sign.js_hint_ready', 'Ready.');
  }
  updateSignatureGhost();
}

function updateSignatureGhost() {
  let ghost = document.getElementById('sigGhost');
  if (!hasSignature || !placementPoint || !placementViewport) { ghost?.remove(); return; }
  const rect = placementCanvas.getBoundingClientRect(); if (!rect.width) return;
  if (!ghost) { ghost = document.createElement('img'); ghost.id = 'sigGhost'; ghost.className = 'sig-ghost'; ghost.alt = t('workspace.signature_preview', 'Signature preview'); placementWrap.append(ghost); }
  const ratio = rect.width / placementCanvas.width, width = 140 * placementScale * ratio, height = width * sigCanvas.height / sigCanvas.width;
  ghost.src = sigCanvas.toDataURL('image/png');
  ghost.style.left = `${placementPoint.pdfX * placementScale * ratio - width / 2}px`;
  ghost.style.top = `${(placementViewport.height / placementScale - placementPoint.pdfY) * placementScale * ratio - height / 2}px`;
  ghost.style.width = `${width}px`; ghost.style.height = `${height}px`;
}

/* ---------- Form fields ---------- */

// pdf-lib ships minified, so field.constructor.name is a mangled single letter:
// match against the exported classes instead, with duck-typing as a backstop.
function fieldKind(field) {
  const lib = pdfLibRef || {};
  if (lib.PDFTextField && field instanceof lib.PDFTextField) return 'text';
  if (lib.PDFCheckBox && field instanceof lib.PDFCheckBox) return 'checkbox';
  if (lib.PDFDropdown && field instanceof lib.PDFDropdown) return 'dropdown';
  if (lib.PDFRadioGroup && field instanceof lib.PDFRadioGroup) return 'radio';
  if (lib.PDFOptionList && field instanceof lib.PDFOptionList) return 'optionlist';
  if (lib.PDFButton && field instanceof lib.PDFButton) return 'button';
  if (lib.PDFSignature && field instanceof lib.PDFSignature) return 'signature';

  if (typeof field.setText === 'function') return 'text';
  if (typeof field.check === 'function' && typeof field.uncheck === 'function') return 'checkbox';
  if (typeof field.isMutuallyExclusive === 'function') return 'radio';
  if (typeof field.isEditable === 'function') return 'dropdown';
  if (typeof field.getOptions === 'function' && typeof field.select === 'function') return 'optionlist';
  return 'unknown';
}

function buildFieldsUI(form) {
  const fields = form.getFields();
  fieldsList.textContent = '';
  fieldControls = [];

  if (!fields.length) {
    fieldsSection.hidden = true;
    noFieldsNote.hidden = false;
    return;
  }
  fieldsSection.hidden = false;
  noFieldsNote.hidden = true;

  for (let field of fields) {
    const name = field.getName();
    const kind = fieldKind(field);
    const row = document.createElement('div');
    row.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = name;
    row.appendChild(label);

    if (kind === 'text') {
      const input = document.createElement('input');
      input.type = 'text';
      try {
        input.value = field.getText() || '';
      } catch {
        /* leave blank */
      }
      row.appendChild(input);
      fieldControls.push({ field, apply: () => field.setText(input.value) });
    } else if (kind === 'checkbox') {
      const wrap = document.createElement('div');
      wrap.className = 'field-checkbox-list';
      const cbLabel = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      try {
        cb.checked = field.isChecked();
      } catch {
        /* leave unchecked */
      }
      cbLabel.appendChild(cb);
      cbLabel.appendChild(document.createTextNode(t('fill-sign.js_checked', 'Checked')));
      wrap.appendChild(cbLabel);
      row.appendChild(wrap);
      fieldControls.push({ field, apply: () => (cb.checked ? field.check() : field.uncheck()) });
    } else if (kind === 'dropdown') {
      const select = document.createElement('select');
      for (const opt of field.getOptions()) {
        const optionEl = document.createElement('option');
        optionEl.value = opt;
        optionEl.textContent = opt;
        select.appendChild(optionEl);
      }
      try {
        const selected = field.getSelected();
        if (selected?.[0]) select.value = selected[0];
      } catch {
        /* leave default */
      }
      row.appendChild(select);
      fieldControls.push({ field, apply: () => field.select(select.value) });
    } else if (kind === 'radio') {
      const wrap = document.createElement('div');
      wrap.className = 'field-radio-group';
      const groupName = `radio-${name}`;
      let selectedValue = null;
      try {
        selectedValue = field.getSelected();
      } catch {
        /* none selected */
      }
      for (const opt of field.getOptions()) {
        const optLabel = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = groupName;
        radio.value = opt;
        if (opt === selectedValue) radio.checked = true;
        optLabel.appendChild(radio);
        optLabel.appendChild(document.createTextNode(opt));
        wrap.appendChild(optLabel);
      }
      row.appendChild(wrap);
      fieldControls.push({
        field,
        apply: () => {
          const checked = wrap.querySelector('input[type="radio"]:checked');
          if (checked) field.select(checked.value);
        },
      });
    } else if (kind === 'optionlist') {
      const select = document.createElement('select');
      select.multiple = true;
      for (const opt of field.getOptions()) {
        const optionEl = document.createElement('option');
        optionEl.value = opt;
        optionEl.textContent = opt;
        select.appendChild(optionEl);
      }
      row.appendChild(select);
      fieldControls.push({
        field,
        apply: () => {
          const values = Array.from(select.selectedOptions).map((o) => o.value);
          if (values.length) field.select(values);
        },
      });
    } else {
      const note = document.createElement('span');
      note.className = 'file-list-count';
      note.textContent = t('fill-sign.js_field_unsupported', '({type} not supported yet)', { type: kind });
      row.appendChild(note);
    }

    fieldsList.appendChild(row);
    const control = fieldControls.find((item) => item.field === field);
    if (control) {
      control.row = row;
      control.applyTo = (form) => {
        const originalField = field;
        try { field = form.getField(name); control.apply(); }
        finally { field = originalField; }
      };
      const input = row.querySelector('input,select');
      if (input) { input.id = `form-field-${fieldControls.length}`; label.htmlFor = input.id; }
    }
  }
}

/* ---------- File loading ---------- */

async function handleFile(file) {
  const token = ++generation; busy = true; applyBtn.disabled = true;
  hideError();
  const parsed = await readPdfFile(file, { validate: true });
  if (!parsed || token !== generation) { if (token === generation) { busy = false; updateApplyState(); } return; }
  busy = false;
  cachedExport = null;
  fieldsSection.hidden = true;
  noFieldsNote.hidden = true;
  signatureSection.hidden = true;
  placementSection.hidden = true;
  applyRow.hidden = true;
  selectedPageIndex = null;
  placementPoint = null;
  hasSignature = false;
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  typeSigInput.value = '';
  sigStatus.textContent = '';
  setSigMode('draw');

  const bytes = parsed.bytes; currentBytes = bytes;
  currentFileName = file.name.replace(/\.pdf$/i, '') || 'document';

  progressSection.hidden = false;
  setProgress(0, t('common.js_loading_pdf', 'Loading PDF…'));
  try {
    pdfLibRef = await ensurePdfLib((t) => setProgress(0, t));
    currentDoc = await pdfLibRef.PDFDocument.load(bytes, { ignoreEncryption: true });
    try {
      currentForm = currentDoc.getForm();
    } catch {
      currentForm = null;
    }
    buildFieldsUI(currentForm || { getFields: () => [] });

    const pdfjs = await ensurePdfJs((t) => setProgress(0, t));
    const loadingTask = pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_ASSET_URLS });
    const loaded = await loadingTask.promise;
    if (token !== generation) { await loadingTask.destroy(); return; }
    pdfJsDocRef = loaded;
    numPages = pdfJsDocRef.numPages;
    await renderSigPageGrid();

    signatureSection.hidden = false;
    applyRow.hidden = false;
    updateApplyState();
  } catch (err) {
    if (token === generation) showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  } finally {
    if (token === generation) progressSection.hidden = true;
  }
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
  fileInput.value = '';
});

/* ---------- Signature drawing ---------- */

const sigCtx = sigCanvas.getContext('2d');
sigCtx.strokeStyle = '#111111';
sigCtx.lineWidth = 2.2;
sigCtx.lineCap = 'round';
sigCtx.lineJoin = 'round';
let drawing = false;
let sigMode = 'draw';

function getCanvasPoint(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function setSigMode(mode) {
  sigMode = mode;
  sigModeDraw.classList.toggle('active', mode === 'draw');
  sigModeType.classList.toggle('active', mode === 'type');
  sigModeDraw.setAttribute('aria-selected', String(mode === 'draw'));
  sigModeType.setAttribute('aria-selected', String(mode === 'type'));
  typeSigRow.hidden = mode !== 'type';
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  hasSignature = false;
  sigStatus.textContent = '';
  if (mode === 'type' && typeSigInput.value.trim()) {
    renderTypedSignature(typeSigInput.value);
  }
  updateApplyState();
}
sigModeDraw.addEventListener('click', () => setSigMode('draw'));
sigModeType.addEventListener('click', () => setSigMode('type'));

function renderTypedSignature(text) {
  changed();
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  const trimmed = text.trim();
  if (!trimmed) {
    hasSignature = false;
    sigStatus.textContent = '';
    return;
  }
  sigCtx.fillStyle = '#111111';
  sigCtx.textAlign = 'center';
  sigCtx.textBaseline = 'middle';
  let fontSize = 56;
  sigCtx.font = `${fontSize}px cursive`;
  while (fontSize > 20 && sigCtx.measureText(trimmed).width > sigCanvas.width - 40) {
    fontSize -= 2;
    sigCtx.font = `${fontSize}px cursive`;
  }
  sigCtx.fillText(trimmed, sigCanvas.width / 2, sigCanvas.height / 2);
  hasSignature = true;
  sigStatus.textContent = t('fill-sign.js_sig_drawn', 'Signature drawn');
}
typeSigInput.addEventListener('input', () => {
  renderTypedSignature(typeSigInput.value);
  updateApplyState();
});

sigCanvas.addEventListener('pointerdown', (e) => {
  changed();
  if (sigMode !== 'draw') return;
  drawing = true;
  const p = getCanvasPoint(e, sigCanvas);
  sigCtx.beginPath();
  sigCtx.moveTo(p.x, p.y);
  e.preventDefault();
});
sigCanvas.addEventListener('pointermove', (e) => {
  if (!drawing || sigMode !== 'draw') return;
  const p = getCanvasPoint(e, sigCanvas);
  sigCtx.lineTo(p.x, p.y);
  sigCtx.stroke();
  hasSignature = true;
  sigStatus.textContent = t('fill-sign.js_sig_drawn', 'Signature drawn');
  updateApplyState();
});
window.addEventListener('pointerup', () => {
  drawing = false;
});
clearSigBtn.addEventListener('click', () => {
  changed();
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  typeSigInput.value = '';
  hasSignature = false;
  sigStatus.textContent = '';
  updateApplyState();
});

/* ---------- Page picker + placement ---------- */

async function renderSigPageGrid() {
  sigPageGrid.textContent = '';
  for (let i = 1; i <= numPages; i++) {
    const page = await pdfJsDocRef.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = 150 / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    const tile = document.createElement('div');
    tile.className = 'page-tile';
    tile.dataset.pageIndex = String(i - 1);
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');
    tile.appendChild(canvas);
    const label = document.createElement('span');
    label.className = 'page-tile-label';
    label.textContent = t('fill-sign.js_page_label', 'Page {n}', { n: i });
    tile.appendChild(label);

    const index = i - 1;
    tile.addEventListener('click', () => selectSigPage(index));
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectSigPage(index);
      }
    });
    sigPageGrid.appendChild(tile);
  }
}

async function selectSigPage(index) {
  selectedPageIndex = index;
  placementPoint = null;
  document.getElementById('sigGhost')?.remove();
  sigPageGrid.querySelectorAll('.page-tile').forEach((t) => {
    t.classList.toggle('selected', Number(t.dataset.pageIndex) === index);
  });

  const page = await pdfJsDocRef.getPage(index + 1);
  const baseViewport = page.getViewport({ scale: 1 });
  placementScale = Math.min(560 / baseViewport.width, 1.8);
  const viewport = page.getViewport({ scale: placementScale });
  placementViewport = viewport;
  placementCanvas.width = viewport.width;
  placementCanvas.height = viewport.height;
  await page.render({ canvasContext: placementCanvas.getContext('2d'), viewport }).promise;
  placementPageHeightPt = baseViewport.height;

  placementSection.hidden = false;
  updateApplyState();
}

placementCanvas.addEventListener('click', (e) => {
  changed();
  const rect = placementCanvas.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;
  const canvasX = cssX * (placementCanvas.width / rect.width);
  const canvasY = cssY * (placementCanvas.height / rect.height);
  placementPoint = {
    pdfX: canvasX / placementScale,
    pdfY: (placementViewport.height - canvasY) / placementScale,
  };

  updateApplyState();
});

/* ---------- Apply & download ---------- */

applyBtn.addEventListener('click', async () => {
  if (!currentDoc || busy) return;
  if (cachedExport) { await downloadBytes(cachedExport.bytes, cachedExport.name); return; }
  hideError();
  clearResult();
  progressSection.hidden = false;
  applyBtn.disabled = true;
  busy = true; const token = generation;
  try {
    const outputDoc = await pdfLibRef.PDFDocument.load(currentBytes);
    const outputForm = outputDoc.getForm();
    fieldsList.querySelectorAll('.field-error').forEach((node) => node.remove());
    if (fieldControls.length && currentForm) {
      setProgress(20, t('fill-sign.js_filling_fields', 'Filling fields…'));
      for (const control of fieldControls) {
        try {
          control.applyTo(outputForm);
        } catch (err) {
          const error = document.createElement('span'); error.className = 'field-error'; error.setAttribute('role', 'alert'); error.textContent = `${control.field.getName()}: ${err.message}`; control.row.append(error);
          throw new Error(t('workspace.field_failed', 'A form field could not be applied. Correct the highlighted field and try again.'));
        }
      }
      const text = [...fieldsList.querySelectorAll('input[type="text"],select')].map((input) => input.value).join('\n');
      const font = await embedUnicodeFont(outputDoc, { text });
      outputForm.updateFieldAppearances(font);
      if (flattenInput.checked) {
        try {
          outputForm.flatten();
        } catch (err) {
          throw new Error(t('workspace.flatten_failed', 'The form could not be flattened. No result was created: {message}', { message: err.message }));
        }
      }
    }

    if (hasSignature && placementPoint != null && selectedPageIndex != null) {
      setProgress(60, t('fill-sign.js_adding_signature', 'Adding signature…'));
      const sigBlob = await new Promise((resolve) => sigCanvas.toBlob(resolve, 'image/png'));
      const sigBytes = new Uint8Array(await sigBlob.arrayBuffer());
      const sigImage = await outputDoc.embedPng(sigBytes);
      const pages = outputDoc.getPages();
      const targetPage = pages[selectedPageIndex];
      const sigWidthPt = 140;
      const sigHeightPt = sigWidthPt * (sigCanvas.height / sigCanvas.width);
      const sourcePage = await pdfJsDocRef.getPage(selectedPageIndex + 1);
      targetPage.pushOperators(pdfLibRef.pushGraphicsState(), pdfLibRef.concatTransformationMatrix(...visualTransform(sourcePage.getViewport({ scale: 1 }))));
      targetPage.drawImage(sigImage, {
        x: placementPoint.pdfX - sigWidthPt / 2,
        y: placementPoint.pdfY - sigHeightPt / 2,
        width: sigWidthPt,
        height: sigHeightPt,
      });
      targetPage.pushOperators(pdfLibRef.popGraphicsState());
    }

    setProgress(90, t('common.js_saving', 'Saving…'));
    const outBytes = await outputDoc.save();
    await pdfLibRef.PDFDocument.load(outBytes);
    if (token !== generation) return;
    const outName = `${currentFileName}-signed.pdf`;
    currentBytes = outBytes.slice(); cachedExport = { bytes: outBytes.slice(), name: outName };
    documentSession.adopt(outBytes, outName, { type: 'application/pdf', capabilities: { ...documentSession.snapshot().current?.capabilities, forms: outputForm.getFields().length > 0 } });
    currentDoc = await pdfLibRef.PDFDocument.load(outBytes); currentForm = currentDoc.getForm(); buildFieldsUI(currentForm);
    placementPoint = null; document.getElementById('sigGhost')?.remove();
    const pdfjs = await ensurePdfJs(); await pdfJsDocRef.loadingTask.destroy(); pdfJsDocRef = await pdfjs.getDocument({ data: outBytes.slice(), ...PDFJS_ASSET_URLS }).promise;
    await renderSigPageGrid(); if (selectedPageIndex !== null) await selectSigPage(selectedPageIndex);
    if (token !== generation) return;
    await downloadBytes(outBytes, outName, 'application/pdf', { operation: { isCurrent: () => token === generation } });
    if (token !== generation) return;
    offerChain(outBytes, outName, [{ slug: 'add-text', label: 'Add Text' }, { slug: 'organize', label: 'Organize' }]);

    setProgress(100, t('common.js_done', 'Done.'));
    setTimeout(() => {
      progressSection.hidden = true;
    }, 1200);
  } catch (err) {
    if (token === generation) { showError(err?.message || t('fill-sign.js_err_save', 'Something went wrong while saving this PDF.')); progressSection.hidden = true; }
  } finally {
    if (token === generation) { busy = false; applyBtn.disabled = false; }
  }
});

takeChainedFile().then((file) => { if (file) void handleFile(file); });
new ResizeObserver(updateSignatureGhost).observe(placementCanvas);
