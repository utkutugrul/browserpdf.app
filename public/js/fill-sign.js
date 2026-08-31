'use strict';

import { ensurePdfJs, ensurePdfLib, PDFJS_ASSET_URLS } from './lib-loader.js';
import { t } from './i18n.js';

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
  applyBtn.disabled = !hasFields && !hasSigPlacement;
  if (hasSignature && placementPoint == null) {
    applyHint.textContent = t('fill-sign.js_hint_pick_page', 'Pick a page above and click on it to place your signature.');
  } else if (!hasSignature && placementPoint != null) {
    applyHint.textContent = t('fill-sign.js_hint_draw_sig', 'Draw a signature above to place it here.');
  } else if (!hasFields && !hasSigPlacement) {
    applyHint.textContent = t('fill-sign.js_hint_fill_or_sign', 'Fill a field or add a signature to enable this.');
  } else {
    applyHint.textContent = t('fill-sign.js_hint_ready', 'Ready.');
  }
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

  for (const field of fields) {
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
  }
}

/* ---------- File loading ---------- */

async function handleFile(file) {
  hideError();
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

  const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) {
    showError(t('common.js_err_not_pdf', 'Please select a PDF file.'));
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!checkPdfMagicBytes(bytes)) {
    showError(t('common.js_err_invalid_pdf', 'This file does not look like a valid PDF.'));
    return;
  }
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
    pdfJsDocRef = await loadingTask.promise;
    numPages = pdfJsDocRef.numPages;
    await renderSigPageGrid();

    signatureSection.hidden = false;
    applyRow.hidden = false;
    updateApplyState();
  } catch (err) {
    console.error(err);
    showError(err?.message || t('common.js_err_read', 'Could not read this PDF.'));
  } finally {
    progressSection.hidden = true;
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
  placementCanvas.width = viewport.width;
  placementCanvas.height = viewport.height;
  await page.render({ canvasContext: placementCanvas.getContext('2d'), viewport }).promise;
  placementPageHeightPt = baseViewport.height;

  placementSection.hidden = false;
  updateApplyState();
}

placementCanvas.addEventListener('click', (e) => {
  const rect = placementCanvas.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;
  const canvasX = cssX * (placementCanvas.width / rect.width);
  const canvasY = cssY * (placementCanvas.height / rect.height);
  placementPoint = {
    pdfX: canvasX / placementScale,
    pdfY: placementPageHeightPt - canvasY / placementScale,
  };

  document.getElementById('sigGhost')?.remove();
  const ghost = document.createElement('div');
  ghost.id = 'sigGhost';
  ghost.className = 'sig-ghost';
  const w = 64;
  const h = 26;
  ghost.style.left = `${cssX - w / 2}px`;
  ghost.style.top = `${cssY - h / 2}px`;
  ghost.style.width = `${w}px`;
  ghost.style.height = `${h}px`;
  placementWrap.appendChild(ghost);

  updateApplyState();
});

/* ---------- Apply & download ---------- */

applyBtn.addEventListener('click', async () => {
  if (!currentDoc) return;
  hideError();
  progressSection.hidden = false;
  applyBtn.disabled = true;
  try {
    if (fieldControls.length && currentForm) {
      setProgress(20, t('fill-sign.js_filling_fields', 'Filling fields…'));
      for (const control of fieldControls) {
        try {
          control.apply();
        } catch (err) {
          console.warn(`Could not set field "${control.field.getName()}":`, err);
        }
      }
      if (flattenInput.checked) {
        try {
          currentForm.flatten();
        } catch (err) {
          console.warn('Could not flatten form:', err);
        }
      }
    }

    if (hasSignature && placementPoint != null && selectedPageIndex != null) {
      setProgress(60, t('fill-sign.js_adding_signature', 'Adding signature…'));
      const sigBlob = await new Promise((resolve) => sigCanvas.toBlob(resolve, 'image/png'));
      const sigBytes = new Uint8Array(await sigBlob.arrayBuffer());
      const sigImage = await currentDoc.embedPng(sigBytes);
      const pages = currentDoc.getPages();
      const targetPage = pages[selectedPageIndex];
      const sigWidthPt = 140;
      const sigHeightPt = sigWidthPt * (sigCanvas.height / sigCanvas.width);
      targetPage.drawImage(sigImage, {
        x: placementPoint.pdfX - sigWidthPt / 2,
        y: placementPoint.pdfY - sigHeightPt / 2,
        width: sigWidthPt,
        height: sigHeightPt,
      });
    }

    setProgress(90, t('common.js_saving', 'Saving…'));
    const outBytes = await currentDoc.save();
    const blob = new Blob([outBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentFileName}-signed.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setProgress(100, t('common.js_done', 'Done.'));
    setTimeout(() => {
      progressSection.hidden = true;
    }, 1200);
  } catch (err) {
    console.error(err);
    showError(err?.message || t('fill-sign.js_err_save', 'Something went wrong while saving this PDF.'));
    progressSection.hidden = true;
  } finally {
    applyBtn.disabled = false;
  }
});
