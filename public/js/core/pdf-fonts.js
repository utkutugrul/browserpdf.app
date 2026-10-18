import { ensureFontkit } from '../lib-loader.js';

const FILES = {
  regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf',
  italic: 'NotoSans-Italic.ttf', boldItalic: 'NotoSans-BoldItalic.ttf',
  code: 'NotoSansMono-Regular.ttf',
  hebrew: 'NotoSansHebrew-Regular.ttf', arabic: 'NotoNaskhArabic-Regular.ttf',
  hebrewBold: 'NotoSansHebrew-Bold.ttf', arabicBold: 'NotoNaskhArabic-Bold.ttf',
};
const byteCache = new Map();
const documents = new WeakMap();
const previewFonts = new Map();
const coverageCache = new Map();

export class UnsupportedGlyphError extends Error {
  constructor(characters) {
    const shown = [...new Set(characters)].slice(0, 12).map((ch) => `${ch} (U+${ch.codePointAt(0).toString(16).toUpperCase()})`).join(', ');
    super(`This document font does not support: ${shown}. Choose a supported font or change the text; no characters were removed.`);
    this.name = 'UnsupportedGlyphError';
    this.characters = [...new Set(characters)];
  }
}

export function assertFontSupports(font, text) {
  const supported = new Set(font.getCharacterSet());
  const missing = [...String(text)].filter((ch) => !/[\n\r\t]/.test(ch) && !supported.has(ch.codePointAt(0)));
  if (missing.length) throw new UnsupportedGlyphError(missing);
  return text;
}

function fontUrl(weight) {
  if (!FILES[weight]) throw new TypeError(`Unknown font style: ${weight}`);
  return new URL(`../../fonts/${FILES[weight]}`, import.meta.url).href;
}

async function fontBytes(weight) {
  const url = fontUrl(weight);
  if (!byteCache.has(url)) byteCache.set(url, fetch(url).then(async (response) => {
    if (!response.ok) throw new Error('Could not load the document font.');
    return new Uint8Array(await response.arrayBuffer());
  }).catch((error) => { byteCache.delete(url); throw error; }));
  return byteCache.get(url);
}

async function missingForStyle(weight, text, onStatus) {
  if (!coverageCache.has(weight)) coverageCache.set(weight, (async () => {
    const [fontkit, bytes] = await Promise.all([ensureFontkit(onStatus), fontBytes(weight)]);
    return new Set(fontkit.create(bytes).characterSet);
  })().catch((error) => { coverageCache.delete(weight); throw error; }));
  const supported = await coverageCache.get(weight);
  return [...String(text)].filter((ch) => !/[\n\r\t]/.test(ch) && !supported.has(ch.codePointAt(0)));
}

export async function resolveDocumentFont({ text = '', weight = 'regular', onStatus, signal } = {}) {
  signal?.throwIfAborted();
  const missing = await missingForStyle(weight, text, onStatus);
  let resolvedWeight = weight;
  if (missing.length) {
    const script = /[\u0600-\u06ff\u0750-\u077f]/u.test(text) ? 'arabic'
      : /[\u0590-\u05ff]/u.test(text) ? 'hebrew' : null;
    if (!script) throw new UnsupportedGlyphError(missing);
    if (/italic/i.test(weight)) throw new Error(`An italic ${script} font is not available. Use regular or bold text; the requested style was not changed.`);
    if (weight === 'code') throw new Error(`A monospaced ${script} font is not available. Use regular text; the requested style was not changed.`);
    resolvedWeight = /bold/i.test(weight) ? `${script}Bold` : script;
    const remaining = await missingForStyle(resolvedWeight, text, onStatus);
    if (remaining.length) throw new UnsupportedGlyphError(remaining);
  }
  signal?.throwIfAborted();
  return { weight: resolvedWeight, family: `BrowserPDF Noto ${resolvedWeight}`, url: fontUrl(resolvedWeight) };
}

export async function embedUnicodeFont(doc, { text = '', weight = 'regular', signal, onStatus } = {}) {
  signal?.throwIfAborted();
  weight = (await resolveDocumentFont({ text, weight, signal, onStatus })).weight;
  if (!documents.has(doc)) documents.set(doc, new Map());
  const fonts = documents.get(doc);
  if (!fonts.has(weight)) fonts.set(weight, (async () => {
    const [fontkit, bytes] = await Promise.all([ensureFontkit(onStatus), fontBytes(weight)]);
    signal?.throwIfAborted();
    doc.registerFontkit(fontkit);
    return doc.embedFont(bytes.slice(), { subset: true });
  })().catch((error) => { fonts.delete(weight); throw error; }));
  const font = await fonts.get(weight);
  signal?.throwIfAborted();
  assertFontSupports(font, text);
  return font;
}

export async function embedDocumentFonts(doc, options = {}) {
  const styles = options.styles || ['regular', 'bold', 'italic', 'boldItalic', 'code'];
  const regular = await embedUnicodeFont(doc, { ...options, weight: 'regular' });
  const [bold, italic, boldItalic, code] = await Promise.all(
    ['bold', 'italic', 'boldItalic', 'code'].map((weight) => styles.includes(weight) ? embedUnicodeFont(doc, { ...options, weight }) : regular),
  );
  return {
    regular, bold, italic, boldItalic, code,
    assertText: (text) => assertFontSupports(regular, text),
    pick: (run = {}) => run.code ? code : run.bold && run.italic ? boldItalic : run.bold ? bold : run.italic ? italic : regular,
  };
}

export async function ensureUnicodePreviewFont(weight = 'regular', options = {}) {
  if (!globalThis.FontFace || !globalThis.document?.fonts) return 'sans-serif';
  const resolved = await resolveDocumentFont({ ...options, weight });
  weight = resolved.weight;
  if (!previewFonts.has(weight)) previewFonts.set(weight, (async () => {
    const face = new FontFace(resolved.family, await fontBytes(weight), {
      weight: /bold/i.test(weight) ? '700' : '400', style: /italic/i.test(weight) ? 'italic' : 'normal',
    });
    await face.load();
    document.fonts.add(face);
    return resolved.family;
  })().catch((error) => { previewFonts.delete(weight); throw error; }));
  return previewFonts.get(weight);
}
