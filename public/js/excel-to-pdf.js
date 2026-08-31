'use strict';

import { ensurePdfLib, ensureXlsx } from './lib-loader.js';
import { t } from './i18n.js';
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
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    setProgress(50, t('excel-to-pdf.js_layout', 'Laying out pages…'));
    const doc = await pdfLib.PDFDocument.create();
    const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
    const fontSize = 9;
    const margin = 36;
    const pageWidth = 842; // landscape A4
    const pageHeight = 595;
    const lineH = fontSize + 4;
    let page = doc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;
    const maxW = pageWidth - margin * 2;
    let colCount = 1;
    for (const r of rows) {
      const len = Array.isArray(r) ? r.length : 1;
      if (len > colCount) colCount = len;
    }
    const colW = maxW / colCount;

    function newPage() {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    for (let r = 0; r < rows.length; r++) {
      if (y < margin + lineH) newPage();
      const row = Array.isArray(rows[r]) ? rows[r] : [rows[r]];
      for (let c = 0; c < colCount; c++) {
        const raw = row[c] == null ? '' : String(row[c]);
        let text = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
        // Helvetica Windows-1252 limited; strip unsupported
        text = text.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
        while (font.widthOfTextAtSize(text, fontSize) > colW - 4 && text.length > 1) {
          text = text.slice(0, -1);
        }
        page.drawText(text || ' ', {
          x: margin + c * colW + 2,
          y: y - fontSize,
          size: fontSize,
          font,
          color: pdfLib.rgb(0.1, 0.1, 0.1),
        });
      }
      y -= lineH;
      setProgress(50 + Math.round((r / Math.max(1, rows.length)) * 40), t('excel-to-pdf.js_rows', 'Drawing row {i}/{n}', { i: r + 1, n: rows.length }));
    }

    setProgress(95, t('common.js_saving', 'Saving…'));
    const bytes = await doc.save();
    const name = baseName + '.pdf';
    downloadBytes(bytes, name);
    offerChain(bytes, name, [
      { slug: 'compress', label: 'Compress' },
      { slug: 'protect', label: 'Protect' },
      { slug: 'merge', label: 'Merge' },
    ]);
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
