'use strict';

import { ensurePdfLib, ensureXlsx } from './lib-loader.js';
import { t } from './i18n.js';
import { buildSpreadsheetPdf } from './core/spreadsheet-pdf.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBytes, offerChain,
} from './tool-ui.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const convertBtn = document.getElementById('convertBtn');
const panel = document.getElementById('optionsSection');
const fileSummary = document.getElementById('fileSummary');
const sheetSelect = document.getElementById('sheetSelect');

let workbook = null;
let baseName = 'spreadsheet';

function looksLikeExcel(file) {
  return /\.(xlsx|xls|csv)$/i.test(file.name)
    || file.type.includes('spreadsheet')
    || file.type === 'text/csv'
    || file.type === 'application/vnd.ms-excel';
}

async function handleFile(file) {
  hideError();
  panel.hidden = true;
  if (!looksLikeExcel(file)) {
    showError(t('excel-to-pdf.js_err_not_excel', 'Please select an Excel (.xlsx) or CSV file.'));
    return;
  }
  showProgress(t('excel-to-pdf.js_reading', 'Reading spreadsheet…'));
  try {
    const XLSX = await ensureXlsx((m) => setProgress(20, m));
    const buf = await file.arrayBuffer();
    workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
    baseName = file.name.replace(/\.(xlsx|xls|csv)$/i, '') || 'spreadsheet';
    sheetSelect.textContent = '';
    workbook.SheetNames.forEach((name, i) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (i === 0) opt.selected = true;
      sheetSelect.appendChild(opt);
    });
    if (workbook.SheetNames.length > 1) {
      const all = document.createElement('option'); all.value = '*';
      all.textContent = t('excel-to-pdf.js_all_sheets', 'All sheets'); sheetSelect.appendChild(all);
    }
    fileSummary.textContent = file.name;
    panel.hidden = false;
    hideProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err?.message || t('excel-to-pdf.js_err_read', 'Could not read this spreadsheet.'));
  }
}

convertBtn.addEventListener('click', async () => {
  if (!workbook) return;
  hideError();
  convertBtn.disabled = true;
  showProgress(t('common.js_loading_pdflib', 'Loading pdf-lib…'));
  try {
    const [XLSX, pdfLib] = await Promise.all([
      ensureXlsx((m) => setProgress(10, m)),
      ensurePdfLib((m) => setProgress(20, m)),
    ]);
    const sheetName = sheetSelect.value || workbook.SheetNames[0];
    const names = sheetName === '*' ? workbook.SheetNames : [sheetName];
    const sheets = names.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false }) }));
    setProgress(50, t('excel-to-pdf.js_layout', 'Laying out pages…'));
    const doc = await buildSpreadsheetPdf(sheets, pdfLib, {
      onStatus: (m) => setProgress(40, m),
      onProgress: ({ row, rows }) => setProgress(50 + Math.round((row / rows) * 40), t('excel-to-pdf.js_rows', 'Drawing row {i}/{n}', { i: row, n: rows })),
    });

    setProgress(95, t('common.js_saving', 'Saving…'));
    const bytes = await doc.save();
    const name = baseName + '.pdf';
    const resultOptions = { capabilities: { searchable: true } };
    await downloadBytes(bytes, name, 'application/pdf', resultOptions);
    offerChain(bytes, name, [
      { slug: 'compress', label: 'Compress' },
      { slug: 'protect', label: 'Protect' },
      { slug: 'merge', label: 'Merge' },
    ], resultOptions);
    finishProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err?.message || t('excel-to-pdf.js_err', 'Could not convert this spreadsheet to PDF.'));
  } finally {
    convertBtn.disabled = false;
  }
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
['dragenter','dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
['dragleave','drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
dropzone.addEventListener('drop', (e) => { const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); });
fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) handleFile(f); fileInput.value = ''; });
