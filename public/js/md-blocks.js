'use strict';

// Shared Markdown block/inline parser, extracted verbatim from
// markdown-to-pdf.js so PDF to Word can reuse the same block model.
// ---------- Markdown -> block parser (independent of md-render.js's DOM renderer) ----------

export function parseInline(text) {
  const tokenRe = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  const runs = [];
  let lastIndex = 0;
  let match;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) runs.push({ text: text.slice(lastIndex, match.index) });
    const token = match[0];
    if (token.startsWith('***')) runs.push({ text: token.slice(3, -3), bold: true, italic: true });
    else if (token.startsWith('**')) runs.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith('`')) runs.push({ text: token.slice(1, -1), code: true });
    else runs.push({ text: token.slice(1, -1), italic: true });
    lastIndex = tokenRe.lastIndex;
  }
  if (lastIndex < text.length) runs.push({ text: text.slice(lastIndex) });
  return runs;
}

export function parseMarkdownBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  let i = 0;
  let orderedCounter = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^-{3,}\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      orderedCounter = 0;
      i++;
      continue;
    }
    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, runs: parseInline(headingMatch[2]) });
      orderedCounter = 0;
      i++;
      continue;
    }
    const bulletMatch = line.match(/^-\s+(.*)$/);
    if (bulletMatch) {
      blocks.push({ type: 'list-item', ordered: false, runs: parseInline(bulletMatch[1]) });
      orderedCounter = 0;
      i++;
      continue;
    }
    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      orderedCounter += 1;
      blocks.push({ type: 'list-item', ordered: true, index: orderedCounter, runs: parseInline(orderedMatch[1]) });
      i++;
      continue;
    }
    orderedCounter = 0;
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^-{3,}\s*$/.test(lines[i].trim()) &&
      !/^-\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', runs: parseInline(paraLines.join(' ')) });
  }
  return blocks;
}
