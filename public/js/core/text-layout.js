import { assertFontSupports } from './pdf-fonts.js';

export const PAPER_SIZES = Object.freeze({ letter: [612, 792], a4: [595.28, 841.89] });

export function pageDimensions({ paper = 'letter', landscape = false, pageSize } = {}) {
  const dimensions = pageSize || PAPER_SIZES[paper];
  if (!dimensions || dimensions.length !== 2 || dimensions.some((n) => !Number.isFinite(n) || n < 72 || n > 14400)) throw new RangeError('Choose a valid page size.');
  return landscape ? [Math.max(...dimensions), Math.min(...dimensions)] : [...dimensions];
}

export function wrapText(text, font, size, maxWidth) {
  if (!(maxWidth > 0) || !(size > 0)) throw new RangeError('Text size and line width must be positive.');
  assertFontSupports(font, text);
  const lines = [];
  // Grapheme segmentation avoids breaking combining characters inside a token.
  const graphemes = (value) => globalThis.Intl?.Segmenter
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map((part) => part.segment)
    : [...value];
  for (const paragraph of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const token of paragraph.replace(/\t/g, '    ').split(/(\s+)/).filter(Boolean)) {
      if (line && font.widthOfTextAtSize(line + token, size) > maxWidth) {
        lines.push(line.trimEnd()); line = '';
      }
      if (!line && /^\s+$/.test(token)) continue;
      if (font.widthOfTextAtSize(token, size) <= maxWidth) { line += token; continue; }
      for (const char of graphemes(token)) {
        if (font.widthOfTextAtSize(char, size) > maxWidth) throw new RangeError('A character is wider than this column. Increase the column width or reduce the font size.');
        if (line && font.widthOfTextAtSize(line + char, size) > maxWidth) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
