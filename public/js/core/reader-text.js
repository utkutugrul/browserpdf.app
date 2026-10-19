// Direct PDF.js 6.2.108 API: types/src/display/api.d.ts streamTextContent.
// Read the cancellable stream before creating any TextLayer DOM.
export const TEXT_LIMITS = Object.freeze({ runs: 12000, characters: 500000, styles: 512, cachePages: 4, cacheCharacters: 1500000, results: 200 });
export async function readBoundedText(page, { signal, limits = TEXT_LIMITS } = {}) {
  signal?.throwIfAborted();
  const reader = page.streamTextContent({ includeMarkedContent: false, disableNormalization: false }).getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const content = { items: [], styles: Object.create(null), lang: null };
  let characters = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); signal?.throwIfAborted();
      if (done) break;
      const items = value.items.filter((item) => typeof item.str === 'string');
      characters += items.reduce((n, item) => n + item.str.length + (item.hasEOL ? 1 : 0), 0);
      if (content.items.length + items.length > limits.runs || characters > limits.characters) throw new RangeError('This page exceeds the selectable/searchable text limit (12,000 runs or 500,000 characters). Its page image remains available.');
      Object.assign(content.styles, value.styles); content.lang ||= value.lang;
      if (Object.keys(content.styles).length > limits.styles) throw new RangeError('This page exceeds the 512 text-style limit. Its page image remains available.');
      for (const item of items) {
        if (!Array.isArray(item.transform) || item.transform.length !== 6 || !item.transform.every(Number.isFinite) || !Number.isFinite(item.width) || !Number.isFinite(item.height)) throw new Error('This page has unsupported text geometry. Its page image remains available.');
        content.items.push(item);
      }
    }
    const spans = []; let raw = '';
    for (const [index, item] of content.items.entries()) {
      spans.push({ index, start: raw.length, end: raw.length + item.str.length });
      raw += item.str + (item.hasEOL ? '\n' : '');
    }
    return { content, spans, raw, characters };
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

export function createTextCache() {
  const pages = new Map(); let characters = 0;
  return {
    get(index) { const value = pages.get(index); if (value) { pages.delete(index); pages.set(index, value); } return value; },
    put(index, value) {
      if (pages.has(index)) { characters -= pages.get(index).characters; pages.delete(index); }
      pages.set(index, value); characters += value.characters;
      while (pages.size > TEXT_LIMITS.cachePages || characters > TEXT_LIMITS.cacheCharacters) { const key = pages.keys().next().value; characters -= pages.get(key).characters; pages.delete(key); }
      return value;
    },
    clear() { pages.clear(); characters = 0; },
  };
}

// Case/diacritic-insensitive search, with UTF-16 offsets back into original
// spans. This deliberately does not claim full Unicode case folding (e.g. ß).
export function foldSearchText(raw) {
  let text = ''; const starts = [], ends = [];
  for (let offset = 0; offset < raw.length;) {
    const start = offset; let cluster = String.fromCodePoint(raw.codePointAt(offset)); offset += cluster.length;
    while (offset < raw.length && /\p{M}/u.test(String.fromCodePoint(raw.codePointAt(offset)))) { const mark = String.fromCodePoint(raw.codePointAt(offset)); cluster += mark; offset += mark.length; }
    const folded = cluster.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const character of folded) {
      if (/\s/u.test(character)) {
        if (text.endsWith(' ')) { ends[ends.length - 1] = offset; continue; }
        text += ' '; starts.push(start); ends.push(offset);
      } else { text += character; for (let i = 0; i < character.length; i++) { starts.push(start); ends.push(offset); } }
    }
  }
  return { text, starts: Int32Array.from(starts), ends: Int32Array.from(ends) };
}
export function findTextMatches(model, query, limit = TEXT_LIMITS.results) {
  const needle = foldSearchText(query).text.trim(); if (!needle) return [];
  const folded = foldSearchText(model.raw), matches = []; let from = 0;
  while (matches.length < limit) {
    const offset = folded.text.indexOf(needle, from); if (offset < 0) break;
    const start = folded.starts[offset], end = folded.ends[offset + needle.length - 1];
    const ranges = model.spans.filter((span) => span.start < end && span.end > start).map((span) => ({ index: span.index, start: Math.max(start, span.start) - span.start, end: Math.min(end, span.end) - span.start }));
    matches.push({ start, end, ranges, excerpt: model.raw.slice(Math.max(0, start - 35), Math.min(model.raw.length, end + 65)).replace(/\s+/g, ' ') });
    from = offset + Math.max(1, needle.length);
  }
  return matches;
}

export async function resolveDestination(pdf, destination) {
  if (typeof destination === 'string') destination = await pdf.getDestination(destination);
  if (!Array.isArray(destination) || !destination.length) return null;
  const target = destination[0];
  const index = Number.isInteger(target) ? target : target && Number.isInteger(target.num) && target.num > 0 && Number.isInteger(target.gen) && target.gen >= 0 ? await pdf.getPageIndex(target) : -1;
  return Number.isInteger(index) && index >= 0 && index < pdf.numPages ? index : null;
}
