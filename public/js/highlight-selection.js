import { viewportRectToPdf } from './core/page-geometry.js';
import { HIGHLIGHT_LIMITS } from './core/highlight-annotations.js';

export function selectedHighlight({ selection, textContainer, textLayer, viewport, model, pageIndex, surface }) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  if (selection.rangeCount !== 1 || !textLayer || !model) throw new Error('Select supported text on one visible PDF page.');
  const range = selection.getRangeAt(0);
  if (!textContainer.contains(range.startContainer) || !textContainer.contains(range.endContainer)) throw new Error('Select text on one visible PDF page.');
  const selectedText = selection.toString(); if (!selectedText.trim()) return null;
  if (selectedText.length > HIGHLIGHT_LIMITS.text) throw new RangeError('Select at most 10,000 characters per highlight.');
  const rectangles = []; let matched = 0;
  for (const [index, div] of textLayer.textDivs.entries()) {
    if (!range.intersectsNode(div) || !div.firstChild || !div.textContent) continue;
    if (div.firstChild.nodeType !== Node.TEXT_NODE) throw new Error('This PDF text selection has unsupported geometry.');
    const part = document.createRange(); part.setStart(div.firstChild, 0); part.setEnd(div.firstChild, div.firstChild.length);
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
    if (!part.toString().trim()) continue;
    const item = model.content.items[index], style = item && model.content.styles[item.fontName], transform = item?.transform;
    // PageViewport handles the page's four right-angle rotations separately.
    // Native sideways/angled/skew/vertical writing has not been proven safe.
    if (!transform || style?.vertical || item.dir === 'ttb' || !(transform[0] > 0 && transform[3] > 0) || Math.abs(transform[1]) > 1e-6 || Math.abs(transform[2]) > 1e-6) throw new Error('Angled, skewed, sideways or vertical writing is not supported for text highlights.');
    matched++; rectangles.push(...part.getClientRects());
  }
  if (!matched) throw new Error('This selection does not contain supported PDF text.');
  const bounds = surface.getBoundingClientRect(), unique = [];
  for (const rect of rectangles) {
    const local = { x: Math.max(bounds.left, rect.left) - bounds.left, y: Math.max(bounds.top, rect.top) - bounds.top,
      width: Math.min(bounds.right, rect.right) - Math.max(bounds.left, rect.left), height: Math.min(bounds.bottom, rect.bottom) - Math.max(bounds.top, rect.top) };
    if (local.width <= .01 || local.height <= .01) continue;
    if (!unique.some((prior) => ['x', 'y', 'width', 'height'].every((key) => Math.abs(prior[key] - local[key]) < .01))) unique.push(local);
  }
  if (!unique.length || unique.length > HIGHLIGHT_LIMITS.quads) throw new RangeError('Select between 1 and 128 text rectangles per highlight.');
  const quads = unique.map((rect) => {
    const pdf = viewportRectToPdf(viewport, rect, { width: bounds.width, height: bounds.height });
    return [pdf.x, pdf.y, pdf.x + pdf.width, pdf.y, pdf.x + pdf.width, pdf.y + pdf.height, pdf.x, pdf.y + pdf.height];
  });
  return { pageIndex, quads, selectedText };
}
