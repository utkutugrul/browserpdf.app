// Pinned pdf-lib 1.17.1 PDFContext/PDFAnnotation/PDFPageLeaf declarations;
// Adobe PDF 1.7 Tables 8.30/8.21: default-user-space quads and AP transparency.
export const HIGHLIGHT_LIMITS = Object.freeze({ quads: 128, text: 10000, note: 2000 });

export function highlightRect(quads) {
  const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]), ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function validateHighlight(value) {
  if (!Array.isArray(value.quads) || !value.quads.length || value.quads.length > HIGHLIGHT_LIMITS.quads) throw new RangeError('Select between 1 and 128 text rectangles per highlight.');
  const seen = new Set(), quads = value.quads.map((quad) => {
    if (!Array.isArray(quad) || quad.length !== 8 || quad.some((n) => !Number.isFinite(n) || Math.abs(n) > 10000000)) throw new Error('Invalid highlight geometry.');
    const [left, bottom, right, top] = highlightRect([quad]);
    const expected = [left, bottom, right, bottom, right, top, left, top];
    if (!(right > left && top > bottom) || quad.some((n, index) => Math.abs(n - expected[index]) > .000001)) throw new Error('Only axis-aligned text highlight rectangles are supported.');
    const key = quad.join(','); if (seen.has(key)) throw new Error('Duplicate highlight rectangle.'); seen.add(key);
    return [...quad];
  });
  if (!Array.isArray(value.color) || value.color.length !== 3 || value.color.some((n) => !Number.isFinite(n) || n < 0 || n > 1) || !Number.isFinite(value.opacity) || value.opacity < .2 || value.opacity > .8 || typeof value.note !== 'string' || value.note.length > HIGHLIGHT_LIMITS.note || typeof value.selectedText !== 'string' || !value.selectedText.trim() || value.selectedText.length > HIGHLIGHT_LIMITS.text) throw new RangeError('Invalid highlight color, opacity, selected text or note. Notes support at most 2000 characters.');
  return { quads, color: [...value.color], opacity: value.opacity, note: value.note, selectedText: value.selectedText };
}

export function writeHighlightAnnotation(doc, page, object, lib) {
  const { quads, color, opacity, note } = validateHighlight(object), context = doc.context, rect = highlightRect(quads);
  if (typeof object.id !== 'string' || !object.id || object.id.length > 100) throw new Error('Invalid highlight identifier.');
  const state = context.register(context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity, BM: 'Multiply' }));
  // PDF content numbers cannot use JavaScript's exponent notation.
  const number = (n) => lib.PDFNumber.of(n).toString();
  const paths = quads.map((q) => `${number(q[0])} ${number(q[1])} m ${number(q[2])} ${number(q[3])} l ${number(q[4])} ${number(q[5])} l ${number(q[6])} ${number(q[7])} l h f`).join('\n');
  const appearance = context.register(context.flateStream(`q /GS0 gs ${color.map(number).join(' ')} rg\n${paths}\nQ`, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect, Matrix: [1, 0, 0, 1, 0, 0], Resources: { ExtGState: { GS0: state } } }));
  // context.obj turns bare strings into PDF names. Notes/IDs need PDF strings.
  const dict = context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: rect, QuadPoints: quads.flat(), P: page.ref, C: color, CA: opacity, NM: lib.PDFHexString.fromText(object.id), Contents: lib.PDFHexString.fromText(note), F: 4 });
  lib.PDFAnnotation.fromDict(dict).setNormalAppearance(appearance); page.node.addAnnot(context.register(dict));
}
