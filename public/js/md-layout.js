'use strict';

// Shared Markdown -> paginated-PDF layout engine, extracted verbatim from
// markdown-to-pdf.js so the Markdown Viewer can offer PDF export too.
// Word-wraps and paginates the md-blocks.js block model onto US Letter
// pages using pdf-lib's standard fonts. Caller supplies the loaded pdfLib.

import { parseMarkdownBlocks } from './md-blocks.js';

// ---------- Layout blocks onto PDF pages ----------

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BODY_SIZE = 11;
const LINE_GAP = 1.35;
const HEADING_SIZES = { 1: 22, 2: 18, 3: 15, 4: 13 };

export async function layoutMarkdownToPdf(markdown, pdfLib) {
  const doc = await pdfLib.PDFDocument.create();
  const fontRegular = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(pdfLib.StandardFonts.HelveticaOblique);
  const fontBoldItalic = await doc.embedFont(pdfLib.StandardFonts.HelveticaBoldOblique);
  const fontCode = await doc.embedFont(pdfLib.StandardFonts.Courier);
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
        currentLine.push({ text: word, font, size });
        currentWidth += wordWidth;
      }
    }
    if (currentLine.length) lines.push(currentLine);
    return lines;
  }

  function drawWrappedLines(lines, size, indent) {
    for (const line of lines) {
      newPageIfNeeded(size * LINE_GAP);
      let x = MARGIN + indent;
      for (const piece of line) {
        page.drawText(piece.text, { x, y: y - size, size: piece.size, font: piece.font });
        x += piece.font.widthOfTextAtSize(piece.text, piece.size);
      }
      y -= size * LINE_GAP;
    }
  }

  const blocks = parseMarkdownBlocks(markdown);

  for (const block of blocks) {
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
