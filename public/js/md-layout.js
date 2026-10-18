'use strict';

// Shared Markdown -> paginated-PDF layout with validated embedded fonts,
// grapheme wrapping and configurable page dimensions. Caller supplies pdfLib.

import { parseMarkdownBlocks } from './md-blocks.js';
import { embedDocumentFonts } from './core/pdf-fonts.js';
import { pageDimensions } from './core/text-layout.js';

// ---------- Layout blocks onto PDF pages ----------

const BODY_SIZE = 11;
const LINE_GAP = 1.35;
const HEADING_SIZES = { 1: 22, 2: 18, 3: 15, 4: 13 };

export async function layoutMarkdownToPdf(markdown, pdfLib, options = {}) {
  const [PAGE_WIDTH, PAGE_HEIGHT] = pageDimensions(options);
  const MARGIN = options.margin ?? 56;
  if (!Number.isFinite(MARGIN) || MARGIN < 0 || MARGIN * 2 >= Math.min(PAGE_WIDTH, PAGE_HEIGHT) - 24) throw new RangeError('Margins leave no space for content.');
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
  const doc = await pdfLib.PDFDocument.create();
  const blocks = options.blocks || parseMarkdownBlocks(markdown);
  const runs = blocks.flatMap((block) => block.runs || []);
  const styles = ['regular'];
  if (blocks.some((block) => block.type === 'heading') || runs.some((run) => run.bold)) styles.push('bold');
  if (runs.some((run) => run.italic)) styles.push('italic');
  if (runs.some((run) => run.bold && run.italic)) styles.push('boldItalic');
  if (runs.some((run) => run.code)) styles.push('code');
  const fonts = await embedDocumentFonts(doc, { text: runs.map((run) => run.text).join('\n'), styles, signal: options.signal, onStatus: options.onStatus });
  const { regular: fontRegular, bold: fontBold, italic: fontItalic, boldItalic: fontBoldItalic, code: fontCode } = fonts;
  const grey = pdfLib.rgb(0.7, 0.7, 0.7);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function newPageIfNeeded(neededHeight) {
    if (y - neededHeight < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function pickFont(run) {
    if (run.code) return fontCode;
    if (run.bold && run.italic) return fontBoldItalic;
    if (run.bold) return fontBold;
    if (run.italic) return fontItalic;
    return fontRegular;
  }

  function wrapRuns(runs, size, indent) {
    const maxWidth = CONTENT_WIDTH - indent;
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;

    for (const run of runs) {
      const font = pickFont(run);
      const words = run.text.split(/(\s+)/).filter((w) => w.length > 0);
      for (const word of words) {
        const isSpace = /^\s+$/.test(word);
        const wordWidth = font.widthOfTextAtSize(word, size);
        if (!isSpace && currentWidth + wordWidth > maxWidth && currentLine.length > 0) {
          lines.push(currentLine);
          currentLine = [];
          currentWidth = 0;
        }
        if (isSpace && currentLine.length === 0) continue;
        if (wordWidth <= maxWidth) {
          currentLine.push({ text: word, font, size });
          currentWidth += wordWidth;
        } else {
          // Break long URLs/tokens at grapheme boundaries without truncating.
          const segments = globalThis.Intl?.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word)].map((part) => part.segment) : [...word];
          let piece = '';
          for (const char of segments) {
            const charWidth = font.widthOfTextAtSize(char, size);
            if (charWidth > maxWidth) throw new RangeError('A character cannot fit inside these margins.');
            if (currentWidth + charWidth > maxWidth) {
              if (piece) currentLine.push({ text: piece, font, size });
              lines.push(currentLine); currentLine = []; currentWidth = 0; piece = '';
            }
            piece += char; currentWidth += charWidth;
          }
          if (piece) currentLine.push({ text: piece, font, size });
        }
      }
    }
    if (currentLine.length) lines.push(currentLine);
    return lines;
  }

  function drawWrappedLines(lines, size, indent) {
    for (const pieces of lines) {
      const line = [];
      for (const piece of pieces) {
        const previous = line.at(-1);
        if (previous && previous.font === piece.font && previous.size === piece.size) previous.text += piece.text;
        else line.push({ ...piece });
      }
      options.signal?.throwIfAborted();
      newPageIfNeeded(size * LINE_GAP);
      const rtl = /^[\s\d\p{P}]*[\u0590-\u08ff]/u.test(line.map((piece) => piece.text).join(''));
      const totalWidth = line.reduce((sum, piece) => sum + piece.font.widthOfTextAtSize(piece.text, piece.size), 0);
      let x = rtl ? PAGE_WIDTH - MARGIN - totalWidth : MARGIN + indent;
      for (const piece of line) {
        page.drawText(piece.text, { x, y: y - size, size: piece.size, font: piece.font });
        x += piece.font.widthOfTextAtSize(piece.text, piece.size);
      }
      y -= size * LINE_GAP;
    }
  }

  for (const block of blocks) {
    options.signal?.throwIfAborted();
    if (block.type === 'heading') {
      const size = HEADING_SIZES[block.level] || 13;
      newPageIfNeeded(size * LINE_GAP + 10);
      y -= 8;
      const boldRuns = block.runs.map((r) => ({ ...r, bold: true }));
      drawWrappedLines(wrapRuns(boldRuns, size, 0), size, 0);
      y -= 4;
    } else if (block.type === 'paragraph') {
      drawWrappedLines(wrapRuns(block.runs, BODY_SIZE, 0), BODY_SIZE, 0);
      y -= 10;
    } else if (block.type === 'list-item') {
      const indent = 18;
      const marker = block.ordered ? `${block.index}.` : '•';
      newPageIfNeeded(BODY_SIZE * LINE_GAP);
      page.drawText(marker, { x: MARGIN, y: y - BODY_SIZE, size: BODY_SIZE, font: fontRegular });
      drawWrappedLines(wrapRuns(block.runs, BODY_SIZE, indent), BODY_SIZE, indent);
      y -= 4;
    } else if (block.type === 'hr') {
      newPageIfNeeded(22);
      y -= 8;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: grey });
      y -= 14;
    }
  }

  return doc;
}
