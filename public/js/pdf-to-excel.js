'use strict';

import { ensurePdfJs, ensureXlsx, PDFJS_ASSET_URLS } from './lib-loader.js';
import { t } from './i18n.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, offerChain, takeChainedFile,
} from './tool-ui.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const convertBtn = document.getElementById('convertBtn');
const panel = document.getElementById('optionsSection');
const fileSummary = document.getElementById('fileSummary');

let currentBytes = null;
let currentFileName = 'document';

// Row/column thresholds scale with font size (matching pdf-convert.js's
// groupItemsIntoLines), instead of fixed-pixel guesses: a heading or a sheet
// exported with a taller row otherwise splits or merges rows incorrectly.
const Y_EPSILON_RATIO = 0.4;
const COLUMN_GAP_RATIO = 2;

function clusterRows(items) {
  if (!items.length) return [];
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  let cur = [sorted[0]];
  let lastY = sorted[0].y;
  let lastFontSize = sorted[0].fontSize;
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    const epsilon = Math.max(lastFontSize, it.fontSize) * Y_EPSILON_RATIO;
    if (Math.abs(it.y - lastY) <= epsilon) {
      cur.push(it);
      lastFontSize = Math.max(lastFontSize, it.fontSize);
    } else {
      rows.push(cur.sort((a, b) => a.x - b.x));
      cur = [it];
      lastY = it.y;
      lastFontSize = it.fontSize;
    }
  }
  rows.push(cur.sort((a, b) => a.x - b.x));
  return rows;
}

function rowsToTable(rows) {
  if (!rows.length) return [['']];
  const xs = [];
  const fontSizes = [];
  rows.forEach((row) => row.forEach((c) => { xs.push(c.x); fontSizes.push(c.fontSize || 1); }));
  xs.sort((a, b) => a - b);
  fontSizes.sort((a, b) => a - b);
  const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)] || 10;
  const gapThreshold = medianFontSize * COLUMN_GAP_RATIO;
  const gaps = [];
  for (let i = 1; i < xs.length; i++) {
    const g = xs[i] - xs[i - 1];
    if (g > gapThreshold) gaps.push(xs[i - 1] + g / 2);
  }
  const cols = [0, ...gaps, 1e9];
  return rows.map((row) => {
    const cells = new Array(Math.max(1, cols.length - 1)).fill('');
    for (const cell of row) {
      let idx = 0;
      for (let c = 0; c < cols.length - 1; c++) {
        if (cell.x >= cols[c] && cell.x < cols[c + 1]) { idx = c; break; }
      }
      cells[idx] = (cells[idx] ? cells[idx] + ' ' : '') + cell.str;
    }
    return cells.map((s) => s.trim());
  });
}

async function handleFile(file) {
  hideError();
  panel.hidden = true;
  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;
  fileSummary.textContent = file.name;
  panel.hidden = false;
}

convertBtn.addEventListener('click', async () => {
  if (!currentBytes) return;
  hideError();
  convertBtn.disabled = true;
  showProgress(t('common.js_loading_pdf', 'Loading PDF…'));
  try {
    const pdfjs = await ensurePdfJs((m) => setProgress(5, m));
    const XLSX = await ensureXlsx((m) => setProgress(15, m));
    const loadingTask = pdfjs.getDocument({ data: currentBytes.slice(), ...PDFJS_ASSET_URLS });
    const pdf = await loadingTask.promise;
    const aoa = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      setProgress(20 + Math.round((p / pdf.numPages) * 60), t('pdf-to-excel.js_page', 'Reading page {i}/{n}', { i: p, n: pdf.numPages }));
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        fontSize: Math.hypot(it.transform[0], it.transform[1]) || 1,
      })).filter((it) => it.str && it.str.trim());
      const table = rowsToTable(clusterRows(items));
      if (p > 1) aoa.push([]);
      table.forEach((row) => aoa.push(row));
    }
    setProgress(90, t('pdf-to-excel.js_writing', 'Writing spreadsheet…'));
    const sheet = XLSX.utils.aoa_to_sheet(aoa.length ? aoa : [['']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const name = currentFileName + '.xlsx';
    downloadBytes(new Uint8Array(out), name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    finishProgress();
  } catch (err) {
    console.error(err);
    hideProgress();
    showError(err?.message || t('pdf-to-excel.js_err', 'Could not convert this PDF to Excel.'));
  } finally {
    convertBtn.disabled = false;
  }
});

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));
takeChainedFile().then((f) => { if (f) handleFile(f); });
