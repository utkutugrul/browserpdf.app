import { embedDocumentFonts } from './pdf-fonts.js';
import { pageDimensions, wrapText } from './text-layout.js';

// Text-first spreadsheet pagination. Every cell is wrapped; tall rows can
// continue across pages. Workbook print styles and charts are not inferred.
export async function buildSpreadsheetPdf(sheets, pdfLib, options = {}) {
  const [width, height] = pageDimensions({ paper: 'a4', landscape: true, ...options });
  const margin = options.margin ?? 36, fontSize = options.fontSize ?? 9;
  if (!(margin >= 0 && margin * 2 < Math.min(width, height) - 24)) throw new RangeError('Margins leave no space for spreadsheet cells.');
  if (!(fontSize >= 4 && fontSize <= 72)) throw new RangeError('Choose a font size between 4 and 72 points.');
  const contentWidth = width - margin * 2, lineHeight = fontSize * 1.4;
  const fullPageCapacity = Math.floor((height - margin * 2 - 6) / lineHeight);
  if (fullPageCapacity < 1) throw new RangeError('The page cannot fit one line at this font size. Increase the page height, reduce margins or reduce the font size.');
  const nonempty = sheets.filter((sheet) => sheet.rows.some((row) => row.some((cell) => String(cell ?? '').trim())));
  if (!nonempty.length) throw new Error('This spreadsheet has no non-empty cells to export.');
  if (nonempty.some((sheet) => sheet.rows.length > 10000) || nonempty.reduce((sum, sheet) => sum + sheet.rows.reduce((count, row) => count + row.length, 0), 0) > 200000) {
    throw new RangeError('Select a smaller spreadsheet range: PDF export supports up to 10,000 rows per sheet and 200,000 cells.');
  }
  const allText = nonempty.flatMap((sheet) => sheet.rows.flat().map((cell) => String(cell ?? ''))).join('\n');
  const doc = await pdfLib.PDFDocument.create();
  const fonts = await embedDocumentFonts(doc, { text: allText, styles: ['regular', 'bold'], signal: options.signal, onStatus: options.onStatus });
  for (const sheet of nonempty) {
    const columns = Math.max(...sheet.rows.map((row) => row.length));
    if (columns > 100) throw new RangeError('This sheet has more than 100 columns. Select a smaller range before exporting.');
    let columnWidths = options.columnWidths;
    if (columnWidths) {
      if (columnWidths.length !== columns || columnWidths.some((value) => !(value > 0 && Number.isFinite(value)))) throw new RangeError('Supply one positive width per column.');
    } else columnWidths = Array.from({ length: columns }, (_, column) => Math.max(36, Math.min(220,
      Math.max(...sheet.rows.map((row) => Math.min(200, fonts.regular.widthOfTextAtSize(String(row[column] ?? '').split('\n')[0], fontSize) + 8))),
    )));
    const scale = contentWidth / columnWidths.reduce((sum, value) => sum + value, 0);
    columnWidths = columnWidths.map((value) => value * scale);
    let page, y;
    const newPage = () => { page = doc.addPage([width, height]); y = height - margin; };
    newPage();
    for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex++) {
      options.signal?.throwIfAborted();
      const font = rowIndex === 0 && options.header !== false ? fonts.bold : fonts.regular;
      const cells = Array.from({ length: columns }, (_, column) => wrapText(String(sheet.rows[rowIndex][column] ?? ''), font, fontSize, columnWidths[column] - 8));
      const rowLines = Math.max(1, ...cells.map((cell) => cell.length));
      let line = 0;
      while (line < rowLines) {
        options.signal?.throwIfAborted();
        let capacity = Math.floor((y - margin - 6) / lineHeight);
        if (capacity < 1) { newPage(); capacity = Math.floor((y - margin - 6) / lineHeight); }
        if (capacity < 1) throw new RangeError('The page cannot fit one spreadsheet line.');
        const count = Math.min(capacity, rowLines - line);
        let x = margin;
        for (let column = 0; column < columns; column++) {
          for (let offset = 0; offset < count; offset++) {
            const text = cells[column][line + offset];
            if (text) page.drawText(text, { x: x + 4, y: y - fontSize - offset * lineHeight - 3, size: fontSize, font });
          }
          x += columnWidths[column];
        }
        y -= count * lineHeight + 6;
        page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.3, color: pdfLib.rgb(0.75, 0.75, 0.75) });
        line += count;
      }
      options.onProgress?.({ sheet: sheet.name, row: rowIndex + 1, rows: sheet.rows.length });
    }
  }
  return doc;
}
