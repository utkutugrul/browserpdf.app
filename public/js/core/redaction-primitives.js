// Restricted PDF content grammar. This never returns source PDFObjects or bytes.
// PDF 32000-1:2008 §§7.3, 8.4–8.6, 9.3–9.4 define these primitive operands.
export class RedactionUnsupportedError extends Error {
  constructor(message) { super(message); this.name = 'RedactionUnsupportedError'; }
}
const unsupported = (message) => { throw new RedactionUnsupportedError(message); };
const white = (code) => [0, 9, 10, 12, 13, 32].includes(code);
const delimiter = (code) => white(code) || '()<>[]{}/%'.includes(String.fromCharCode(code));
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const ARITY = Object.freeze({ q: 0, Q: 0, cm: 6, BT: 0, ET: 0, Tf: 2, Tm: 6, Td: 2, TD: 2, 'T*': 0, Tc: 1, Tw: 1, Tz: 1, TL: 1, Tr: 1, Ts: 1, Tj: 1, TJ: 1, g: 1, G: 1, rg: 3, RG: 3, k: 4, K: 4, w: 1, J: 1, j: 1, M: 1, d: 2, m: 2, l: 2, c: 6, v: 4, y: 4, h: 0, re: 4, S: 0, s: 0, f: 0, F: 0, 'f*': 0, B: 0, 'B*': 0, b: 0, 'b*': 0, n: 0, W: 0, 'W*': 0 });
const TEXT = new Set(['Tf', 'Tm', 'Td', 'TD', 'T*', 'Tc', 'Tw', 'Tz', 'TL', 'Tr', 'Ts', 'Tj', 'TJ']);

export function parseRedactionPrimitives(bytes, fontNames, { maxOperators = 100000, maxStringBytes = 65536, maxPlanBytes = 8 * 1024 * 1024 } = {}) {
  let position = 0, nesting = 0, inText = false, font = null, hasText = false, planBytes = 0;
  const operators = [], operands = [], stack = [];
  const failure = () => unsupported('Unsupported or malformed content syntax. Use explicit whole-document raster mode.');
  function skip() { while (position < bytes.length) { if (white(bytes[position])) position++; else if (bytes[position] === 37) { while (position < bytes.length && ![10, 13].includes(bytes[position])) position++; } else break; } }
  const hex = (value) => value.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  function token(depth = 0) {
    skip(); if (position >= bytes.length) return null;
    if (depth > 4) failure();
    const first = bytes[position++];
    if (first === 40) {
      const value = []; let level = 1;
      while (position < bytes.length && level) {
        let byte = bytes[position++];
        if (byte === 92) {
          if (position >= bytes.length) failure(); byte = bytes[position++];
          if (byte === 13 || byte === 10) { if (byte === 13 && bytes[position] === 10) position++; continue; }
          if (byte >= 48 && byte <= 55) { let octal = byte - 48; for (let count = 1; count < 3 && bytes[position] >= 48 && bytes[position] <= 55; count++) octal = octal * 8 + bytes[position++] - 48; value.push(octal & 255); }
          else value.push(({ 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 })[byte] ?? byte);
        } else if (byte === 40) { if (++level > 64) failure(); value.push(byte); }
        else if (byte === 41) { if (--level) value.push(byte); }
        else if (byte === 13) { if (bytes[position] === 10) position++; value.push(10); }
        else value.push(byte);
        if (value.length > maxStringBytes) unsupported('An untouched-page text string exceeds the redaction limit.');
      }
      if (level) failure(); return { type: 'hex', value: hex(value) };
    }
    if (first === 60) {
      if (bytes[position] === 60) failure(); let value = '';
      while (position < bytes.length && bytes[position] !== 62) { const byte = bytes[position++]; if (white(byte)) continue; const char = String.fromCharCode(byte); if (!/[\da-f]/i.test(char)) failure(); value += char; if (value.length > maxStringBytes * 2) unsupported('An untouched-page text string exceeds the redaction limit.'); }
      if (bytes[position++] !== 62) failure(); if (value.length % 2) value += '0'; return { type: 'hex', value };
    }
    if (first === 91) { const value = []; while (true) { skip(); if (position >= bytes.length) failure(); if (bytes[position] === 93) { position++; break; } if (value.length >= 4096) unsupported('An untouched-page array exceeds the redaction limit.'); value.push(token(depth + 1)); } return { type: 'array', value }; }
    if ([41, 62, 93, 123, 125].includes(first)) failure();
    const start = position - 1; while (position < bytes.length && !delimiter(bytes[position])) position++;
    if (position - start > 256) failure();
    let value = String.fromCharCode(...bytes.subarray(start, position));
    if (first === 47) {
      // Slash is a delimiter, but is already consumed above.
      value = value.slice(1);
      if (/#(?![\da-f]{2})/i.test(value)) failure();
      value = value.replace(/#([\da-f]{2})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
      return { type: 'name', value };
    }
    if (NUMBER.test(value)) { const number = Number(value); if (!Number.isFinite(number) || Math.abs(number) > 1e9) failure(); return { type: 'number', value: number }; }
    return { type: 'operator', value };
  }
  while (true) {
    const next = token(); if (!next) break;
    if (next.type !== 'operator') { if (operands.length >= 64) failure(); operands.push(next); continue; }
    const op = next.value;
    if (!Object.hasOwn(ARITY, op) || operands.length !== ARITY[op]) unsupported(`Unsupported untouched-page operator: ${op.slice(0, 20)}.`);
    if (TEXT.has(op) && !inText) failure();
    if (op === 'BT') { if (inText) failure(); inText = true; }
    if (op === 'ET') { if (!inText) failure(); inText = false; }
    if (op === 'q') { if (inText || ++nesting > 64) failure(); stack.push(font); }
    if (op === 'Q') { if (inText || nesting-- <= 0) failure(); font = stack.pop(); }
    if (op === 'Tf') {
      if (operands[0].type !== 'name' || !fontNames.has(operands[0].value) || operands[1].type !== 'number' || operands[1].value <= 0) failure();
      font = operands[0].value;
    } else if (op === 'Tj' || op === 'TJ') {
      if (!font || (op === 'Tj' ? operands[0].type !== 'hex' : operands[0].type !== 'array' || operands[0].value.some((entry) => !['number', 'hex'].includes(entry.type)))) failure();
      hasText ||= op === 'Tj' ? operands[0].value.length > 0 : operands[0].value.some((entry) => entry.type === 'hex' && entry.value.length);
    } else if (op === 'd') {
      if (operands[0].type !== 'array' || operands[0].value.length > 32 || operands[0].value.some((entry) => entry.type !== 'number' || entry.value < 0) || operands[1].type !== 'number' || operands[1].value < 0) failure();
    } else if (operands.some((operand) => operand.type !== 'number')) failure();
    if (op === 'Tr' && (!Number.isInteger(operands[0].value) || operands[0].value < 0 || operands[0].value > 7)) failure();
    if (['J', 'j'].includes(op) && (![0, 1, 2].includes(operands[0].value))) failure();
    const entry = { op, args: operands.splice(0) };
    planBytes += JSON.stringify(entry).length;
    if (planBytes > maxPlanBytes || operators.length >= maxOperators) unsupported('The untouched-page primitive plan exceeds the redaction limit.');
    operators.push(entry);
  }
  if (operands.length || nesting || inText) failure();
  return { operators, hasText, planBytes };
}

export function writeRedactionPrimitives(plan, page, fonts, pdfLib) {
  const fresh = (operand) => operand.type === 'number' ? pdfLib.PDFNumber.of(operand.value) : operand.type === 'hex' ? pdfLib.PDFHexString.of(operand.value) : operand.type === 'name' ? pdfLib.PDFName.of(fonts.get(operand.value)) : page.doc.context.obj(operand.value.map(fresh));
  const operators = plan.operators.map(({ op, args }) => pdfLib.PDFOperator.of(op, args.map(fresh)));
  page.node.addContentStream(page.doc.context.register(page.doc.context.contentStream(operators)));
}
