'use strict';

import { t } from './i18n.js';

// Shared per-page extraction model and Markdown serializer. Plain text callers
// retain the original punctuation without decoding generated Markdown.

import { ensurePdfJs, ensureTesseract, getTesseractWorkerScriptUrl, PDFJS_ASSET_URLS } from './lib-loader.js';
import { withPdfDocument } from './core/privacy-scan.js';

// ---------- PDF -> Markdown conversion ----------

const BULLET_RE = /^[•‣◦⁃∙●▪■•‣◦∙●▪■\-*]\s+/;
const ORDERED_RE = /^(\d{1,3})[.)]\s+/;

function checkPdfMagicBytes(arrayBuffer) {
  const head = new Uint8Array(arrayBuffer.slice(0, 5));
  const text = String.fromCharCode(...head);
  if (text !== '%PDF-') {
    throw new Error('This file does not look like a valid PDF.');
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error('Operation canceled.');
    err.name = 'AbortError';
    throw err;
  }
}

function median(numbers) {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function groupItemsIntoLines(textContent) {
  const withMeta = textContent.items
    .filter((it) => typeof it.str === 'string')
    .map((it) => {
      const fontSize = Math.hypot(it.transform[0], it.transform[1]) || 1;
      const style = textContent.styles[it.fontName] || {};
      const fontFamily = (style.fontFamily || '').toLowerCase();
      return {
        text: it.str,
        x: it.transform[4],
        y: it.transform[5],
        width: it.width || 0,
        fontSize,
        bold: /bold/.test(fontFamily),
        italic: /italic|oblique/.test(fontFamily),
      };
    });

  withMeta.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  let current = null;
  const Y_EPSILON_RATIO = 0.4;

  for (const item of withMeta) {
    if (!item.text.trim() && !current) continue;
    if (current) {
      const epsilon = Math.max(current.fontSize, item.fontSize) * Y_EPSILON_RATIO;
      if (Math.abs(item.y - current.y) <= epsilon) {
        const gap = item.x - current.endX;
        const expectedCharWidth = current.fontSize * 0.28;
        if (gap > expectedCharWidth && !current.text.endsWith(' ')) {
          current.text += ' ';
        }
        current.text += item.text;
        current.endX = item.x + item.width;
        current.fontSize = Math.max(current.fontSize, item.fontSize);
        current.bold = current.bold || item.bold;
        current.italic = current.italic && item.italic;
        continue;
      }
      lines.push(current);
    }
    current = {
      text: item.text,
      y: item.y,
      endX: item.x + item.width,
      fontSize: item.fontSize,
      bold: item.bold,
      italic: item.italic,
    };
  }
  if (current) lines.push(current);

  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    lines[i].gapToNext = next ? lines[i].y - next.y : null;
  }

  return lines.filter((l) => l.text.trim().length > 0);
}

function classifyLine(line, bodyFontSize) {
  const ratio = line.fontSize / bodyFontSize;
  let heading = 0;
  if (ratio >= 1.8) heading = 1;
  else if (ratio >= 1.5) heading = 2;
  else if (ratio >= 1.25) heading = 3;
  else if (ratio >= 1.1) heading = 4;

  const bulletMatch = heading === 0 ? line.text.match(BULLET_RE) : null;
  const orderedMatch = heading === 0 && !bulletMatch ? line.text.match(ORDERED_RE) : null;

  let text = line.text;
  if (bulletMatch) text = line.text.slice(bulletMatch[0].length);
  else if (orderedMatch) text = line.text.slice(orderedMatch[0].length);

  return {
    heading,
    isBullet: !!bulletMatch,
    isOrdered: !!orderedMatch,
    bold: line.bold,
    italic: line.italic,
    text,
    gapToNext: line.gapToNext,
  };
}

function wrapEmphasis(text, bold, italic) {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (bold && italic) return `***${trimmed}***`;
  if (bold) return `**${trimmed}**`;
  if (italic) return `*${trimmed}*`;
  return trimmed;
}

function escapeLeadingMarkdownToken(text) {
  return text.replace(/^([#\-*+>])/, '\\$1');
}

function renderLinesToMarkdown(lines, bodyFontSize) {
  const classified = lines.map((l) => classifyLine(l, bodyFontSize));
  const gaps = classified.map((l) => l.gapToNext).filter((g) => g != null && g > 0);
  const medianGap = median(gaps) || bodyFontSize;

  const blocks = [];
  let paragraphBuffer = [];
  let orderedCounter = 0;

  function flushParagraph() {
    if (paragraphBuffer.length) {
      blocks.push({ type: 'paragraph', text: paragraphBuffer.join(' ').replace(/\s+/g, ' ').trim() });
      paragraphBuffer = [];
    }
  }

  for (const line of classified) {
    if (line.heading > 0) {
      flushParagraph();
      orderedCounter = 0;
      blocks.push({ type: 'heading', text: `${'#'.repeat(line.heading)} ${wrapEmphasis(line.text, false, line.italic)}` });
      continue;
    }
    if (line.isBullet) {
      flushParagraph();
      orderedCounter = 0;
      blocks.push({ type: 'list-item', text: `- ${wrapEmphasis(line.text, line.bold, line.italic)}` });
      continue;
    }
    if (line.isOrdered) {
      flushParagraph();
      orderedCounter += 1;
      blocks.push({ type: 'list-item', text: `${orderedCounter}. ${wrapEmphasis(line.text, line.bold, line.italic)}` });
      continue;
    }

    orderedCounter = 0;
    const prepared = wrapEmphasis(escapeLeadingMarkdownToken(line.text), line.bold, line.italic);
    paragraphBuffer.push(prepared);
    const isParagraphEnd = line.gapToNext == null || line.gapToNext > medianGap * 1.6;
    if (isParagraphEnd) flushParagraph();
  }
  flushParagraph();

  let out = '';
  for (let i = 0; i < blocks.length; i++) {
    if (i > 0) {
      const sameList = blocks[i - 1].type === 'list-item' && blocks[i].type === 'list-item';
      out += sameList ? '\n' : '\n\n';
    }
    out += blocks[i].text;
  }
  return out;
}

function ocrTextToMarkdown(rawText) {
  const cleaned = rawText.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return '';
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  if (!paragraphs.length) return '';
  return `*(Page scanned via OCR)*\n\n${paragraphs.join('\n\n')}`;
}

export async function renderOcrPageToCanvas(page, getCanvas, signal) {
  throwIfAborted(signal);
  const targetWidth = 1800;
  const baseViewport = page.getViewport({ scale: 1 });
  if (!(Number.isFinite(baseViewport.width) && Number.isFinite(baseViewport.height) && baseViewport.width > 0 && baseViewport.height > 0)) throw new RangeError('This page has invalid dimensions.');
  const scale = Math.min(3, targetWidth / baseViewport.width);
  let viewport = page.getViewport({ scale });
  const limit = Math.min(1, 4096 / viewport.width, 4096 / viewport.height, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
  if (limit < 1) viewport = page.getViewport({ scale: scale * limit });

  const canvas = getCanvas ? getCanvas() : document.createElement('canvas');
  let task = null;
  const cancel = () => task?.cancel();
  try {
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    throwIfAborted(signal);
    const ctx = canvas.getContext('2d');
    task = page.render({ canvasContext: ctx, viewport });
    signal?.addEventListener('abort', cancel, { once: true });
    await task.promise;
    throwIfAborted(signal);
    return canvas;
  } catch (error) {
    canvas.width = 0; canvas.height = 0;
    throwIfAborted(signal);
    throw error;
  } finally { signal?.removeEventListener('abort', cancel); }
}

// Owns the entire rendered surface through recognition, including failures
// before a canvas could be returned to its caller.
export async function recognizeOcrPage(page, worker, { signal, createCanvas, terminateWorker } = {}) {
  let canvas = null, stopped = null, rejectRecognition = null;
  const stop = terminateWorker || (() => {
    if (!stopped) stopped = Promise.resolve().then(() => worker.terminate()).catch(() => {});
    return stopped;
  });
  const cancel = () => {
    void stop();
    if (rejectRecognition) {
      const error = new Error('Operation canceled.'); error.name = 'AbortError';
      rejectRecognition(error);
    }
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    throwIfAborted(signal);
    canvas = await renderOcrPageToCanvas(page, createCanvas, signal);
    throwIfAborted(signal);
    const aborted = signal ? new Promise((_, reject) => { rejectRecognition = reject; }) : null;
    const recognition = worker.recognize(canvas);
    const { data } = await (aborted ? Promise.race([recognition, aborted]) : recognition);
    throwIfAborted(signal);
    return data;
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (signal?.aborted) await stop();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export async function extractPdfTextModel(file, opts = {}, callbacks = {}) {
  const { onProgress = () => {}, onPageImage, onStatus, signal } = callbacks;
  const arrayBuffer = await file.arrayBuffer();
  checkPdfMagicBytes(arrayBuffer);

  const pdfjs = await ensurePdfJs(onStatus);
  onStatus?.('Parsing PDF…');
  return withPdfDocument(pdfjs, new Uint8Array(arrayBuffer), { signal, pdfjsAssets: PDFJS_ASSET_URLS }, async (pdfDocument) => {
  const numPages = pdfDocument.numPages;

  const pageTextContents = [];
  const allFontSizes = [];
  for (let i = 1; i <= numPages; i++) {
    throwIfAborted(signal);
    const page = await pdfDocument.getPage(i);
    const textContent = await page.getTextContent();
    pageTextContents.push({ page, textContent });
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const size = Math.hypot(item.transform[0], item.transform[1]);
      if (size > 0) allFontSizes.push(size);
    }
  }
  const bodyFontSize = median(allFontSizes) || 10;

  let tesseractWorker = null;
  let terminationPromise = null;
  const pages = [];
  const terminateWorker = () => {
    if (!tesseractWorker) return Promise.resolve();
    if (!terminationPromise) terminationPromise = Promise.resolve().then(() => tesseractWorker.terminate()).catch(() => {});
    return terminationPromise;
  };
  const cancelOcr = () => { void terminateWorker(); };
  signal?.addEventListener('abort', cancelOcr, { once: true });

  try {
    for (let i = 0; i < numPages; i++) {
      throwIfAborted(signal);
      const pageNum = i + 1;
      const { page, textContent } = pageTextContents[i];
      const meaningfulItems = textContent.items.filter((it) => it.str && it.str.trim().length > 0);
      const totalChars = meaningfulItems.reduce((sum, it) => sum + it.str.trim().length, 0);

      const forceOcr = opts.forceOcr === true || opts.ocrPages?.includes(pageNum);
      if (totalChars > 0 && !forceOcr) {
        onProgress(pageNum, numPages, t('common.js_phase_extract', 'extracting text'));
        throwIfAborted(signal);
        const lines = groupItemsIntoLines(textContent);
        pages.push({ pageNumber: pageNum, source: 'text', lines, text: lines.map((line) => line.text).join('\n'),
          markdown: renderLinesToMarkdown(lines, bodyFontSize), items: meaningfulItems.map((item) => ({ text: item.str,
            x: item.transform[4], y: item.transform[5], width: item.width, height: item.height, direction: item.dir, hasEOL: item.hasEOL })) });
      } else {
        onProgress(pageNum, numPages, t('common.js_phase_ocr', 'running OCR'));
        throwIfAborted(signal);
        if (!tesseractWorker) {
          const createWorker = await ensureTesseract(onStatus);
          onStatus?.(t('common.js_starting_ocr', 'Starting OCR engine…'));
          tesseractWorker = await createWorker(opts.ocrLangs || 'eng', 1, { workerPath: getTesseractWorkerScriptUrl() });
        }
        throwIfAborted(signal);
        const data = await recognizeOcrPage(page, tesseractWorker, { signal, createCanvas: onPageImage, terminateWorker });
        const text = data.text.replace(/\r\n/g, '\n').trim();
        pages.push({ pageNumber: pageNum, source: 'ocr', confidence: data.confidence, text, lines: [], items: [], markdown: ocrTextToMarkdown(text) });
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancelOcr);
    await terminateWorker();
  }

  throwIfAborted(signal);
  return { pageCount: numPages, bodyFontSize, pages };
  });
}

export async function convertPdfToMarkdown(file, opts = {}, callbacks = {}) {
  const model = await extractPdfTextModel(file, opts, callbacks);
  const separator = opts.pageBreaks ? '\n\n---\n\n' : '\n\n';
  return model.pages.map((page) => page.markdown).filter(Boolean).join(separator).trim() + '\n';
}

export function textModelToPlainText(model, { pageBreaks = false, pageLabels = false } = {}) {
  return model.pages.map((page) => `${pageLabels ? `[Page ${page.pageNumber}${page.source === 'ocr' ? ' · OCR' : ''}]\n` : ''}${page.text}`)
    .join(pageBreaks ? '\n\n\f\n\n' : '\n\n');
}
