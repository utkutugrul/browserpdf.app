'use strict';

import { ensurePdfJs, ensurePdfLib, ensureTesseract, getTesseractWorkerScriptUrl, PDFJS_ASSET_URLS } from './lib-loader.js';
import {
  showError, hideError, setProgress, showProgress, finishProgress, hideProgress,
  downloadBytes, wireDropzone, readPdfFile, formatBytes, initLangChips, getSelectedOcrLangs,
  takeChainedFile, offerChain,
} from './tool-ui.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const optionsSection = document.getElementById('optionsSection');
const fileSummary = document.getElementById('fileSummary');
const forceAllInput = document.getElementById('forceAllInput');
const applyBtn = document.getElementById('applyBtn');
const resultSummary = document.getElementById('resultSummary');

const MIN_TEXT_ITEMS = 6;
const MIN_TEXT_CHARS = 25;
const MIN_WORD_CONFIDENCE = 30;
const RENDER_TARGET_WIDTH = 1800;

let currentBytes = null;
let currentFileName = 'document';
let pdfDocRef = null;

initLangChips();

async function handleFile(file) {
  hideError();
  optionsSection.hidden = true;
  resultSummary.hidden = true;
  const parsed = await readPdfFile(file);
  if (!parsed) return;
  currentBytes = parsed.bytes;
  currentFileName = parsed.baseName;

  showProgress('Loading PDF…');
  try {
    const pdfjs = await ensurePdfJs((t) => setProgress(0, t));
    const loadingTask = pdfjs.getDocument({ data: parsed.bytes.slice(), ...PDFJS_ASSET_URLS });
    pdfDocRef = await loadingTask.promise;
    fileSummary.textContent = `${file.name} (${formatBytes(file.size)}, ${pdfDocRef.numPages} pages)`;
    optionsSection.hidden = false;
    hideProgress();
  } catch (err) {
    console.error(err);
    showError(err?.message || 'Could not read this PDF.');
    hideProgress();
  }
}

wireDropzone(dropzone, fileInput, (files) => handleFile(files[0]));

async function pageHasTextLayer(page) {
  const textContent = await page.getTextContent();
  const meaningful = textContent.items.filter((it) => it.str && it.str.trim().length > 0);
  const chars = meaningful.reduce((sum, it) => sum + it.str.trim().length, 0);
  return meaningful.length >= MIN_TEXT_ITEMS && chars >= MIN_TEXT_CHARS;
}

// Tesseract's block tree (v6+) nests lines under blocks > paragraphs.
// Whole lines (rather than single words) give text extractors natural
// word flow, so phrase search works in the output. Older versions expose
// a flat data.words; group those into one line each as a fallback.
function collectLines(data) {
  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) lines.push(line);
    }
  }
  if (!lines.length && Array.isArray(data.words)) {
    for (const word of data.words) lines.push({ text: word.text, bbox: word.bbox, confidence: word.confidence });
  }
  return lines;
}

applyBtn.addEventListener('click', async () => {
  if (!currentBytes || !pdfDocRef) return;
  hideError();
  resultSummary.hidden = true;
  showProgress('Scanning for pages that need OCR…');
  applyBtn.disabled = true;
  let tesseractWorker = null;

  try {
    const numPages = pdfDocRef.numPages;
    const targets = [];
    const skippedRotated = [];
    for (let i = 1; i <= numPages; i++) {
      setProgress(Math.round((i / numPages) * 100), `Checking page ${i}/${numPages}`);
      const page = await pdfDocRef.getPage(i);
      const needsOcr = forceAllInput.checked || !(await pageHasTextLayer(page));
      if (!needsOcr) continue;
      if (page.rotate % 360 !== 0) {
        skippedRotated.push(i);
        continue;
      }
      targets.push(i);
    }

    if (!targets.length) {
      resultSummary.textContent = skippedRotated.length
        ? `Only rotated pages (${skippedRotated.join(', ')}) needed OCR, and rotated pages aren't supported yet. Try the Rotate tool first to normalize them.`
        : 'Every page in this PDF already has a searchable text layer, nothing to do. If you want to re-OCR anyway, tick "OCR every page" above.';
      resultSummary.hidden = false;
      hideProgress();
      return;
    }

    const pdfLib = await ensurePdfLib((t) => setProgress(0, t));
    const doc = await pdfLib.PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
    const supported = new Set(font.getCharacterSet());
    const outPages = doc.getPages();

    const createWorker = await ensureTesseract((t) => setProgress(0, t));
    setProgress(0, 'Starting OCR engine…');
    tesseractWorker = await createWorker(getSelectedOcrLangs(), 1, { workerPath: getTesseractWorkerScriptUrl() });

    let wordsAdded = 0;
    for (let n = 0; n < targets.length; n++) {
      const pageNum = targets[n];
      setProgress(Math.round((n / targets.length) * 95), `OCR on page ${pageNum} (${n + 1}/${targets.length})`);
      const page = await pdfDocRef.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(3, RENDER_TARGET_WIDTH / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

      const { data } = await tesseractWorker.recognize(canvas, {}, { blocks: true, text: true });
      const lines = collectLines(data);

      const outPage = outPages[pageNum - 1];
      outPage.setFont(font); // one shared font resource instead of one per draw call
      const pageHeightPt = outPage.getSize().height;
      // Text rendering mode 3 ("neither fill nor stroke") is how OCR tools
      // conventionally add invisible-but-searchable text.
      const setInvisible = pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.SetTextRenderingMode, [pdfLib.PDFNumber.of(3)]);
      const setVisible = pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.SetTextRenderingMode, [pdfLib.PDFNumber.of(0)]);
      outPage.pushOperators(setInvisible);
      for (const line of lines) {
        if (!line.text || !line.bbox || (line.confidence ?? 100) < MIN_WORD_CONFIDENCE) continue;
        const text = [...line.text.replace(/\s+/g, ' ').trim()].filter((ch) => supported.has(ch.codePointAt(0))).join('');
        if (!text.trim()) continue;
        const heightPt = (line.bbox.y1 - line.bbox.y0) / scale;
        outPage.drawText(text, {
          x: line.bbox.x0 / scale,
          y: pageHeightPt - line.bbox.y1 / scale,
          size: Math.max(4, heightPt * 0.85),
        });
        wordsAdded += text.split(' ').length;
      }
      outPage.pushOperators(setVisible);
    }

    setProgress(97, 'Saving…');
    const outBytes = await doc.save();
    const outName = `${currentFileName}-searchable.pdf`;
    downloadBytes(outBytes, outName);
    offerChain(outBytes, outName, [{ slug: 'compress', label: 'Compress' }]);

    const parts = [`Added an invisible text layer to ${targets.length} page${targets.length === 1 ? '' : 's'} (${wordsAdded} words recognized).`];
    if (skippedRotated.length) parts.push(`Skipped rotated page${skippedRotated.length === 1 ? '' : 's'} ${skippedRotated.join(', ')}.`);
    parts.push('The page image is unchanged; the recognized text sits invisibly on top, so you can now select and search it.');
    resultSummary.textContent = parts.join(' ');
    resultSummary.hidden = false;
    finishProgress();
  } catch (err) {
    console.error(err);
    showError(err?.message || 'Something went wrong while running OCR on this PDF.');
    hideProgress();
  } finally {
    if (tesseractWorker) await tesseractWorker.terminate();
    applyBtn.disabled = false;
  }
});

takeChainedFile().then((file) => {
  if (file) handleFile(file);
});
