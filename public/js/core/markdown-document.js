import { validateDocumentModel, DOCUMENT_LIMITS } from './document-model.js';
import { imageDimensions } from './composition-state.js';

// A finite literal-document subset, not a general CommonMark implementation.
const MiB = 1024 * 1024, encoder = new TextEncoder(), pause = () => new Promise(resolve => setTimeout(resolve, 0));
const error = (code, message) => { const value = new Error(message); value.code = `MARKDOWN_${code}`; throw value; };
const abort = AbortSignal.prototype.throwIfAborted, check = signal => { if (signal) abort.call(signal); };
const codes = new Set(['unsupported-literal','html-literal','entity-literal','line-endings-normalized','blank-layout-unrepresented','code-info-unrepresented','list-marker-normalized','list-identity-unrepresented','table-header-unrepresented','table-header-inferred','table-alignment-unrepresented','table-widths-unrepresented','table-paragraph-layout-normalized','empty-cell-normalized','whitespace-visual-dependent','direction-unrepresented','source-references-unrepresented','source-warnings-unrepresented','page-break-unrepresented','safe-html-required','inline-image-block-normalized','image-size-inferred','image-size-unrepresented','image-alt-style-unrepresented','image-target-blocked']);
function record(value, allowed) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) error('INPUT_SHAPE', 'Expected a plain Markdown data record.');
  const out = {};
  for (const key of Reflect.ownKeys(value)) { const d = Object.getOwnPropertyDescriptor(value, key); if (typeof key !== 'string' || !allowed.includes(key) || !d.enumerable || !Object.hasOwn(d, 'value') || d.value === undefined) error('INPUT_SHAPE', 'Invalid Markdown data field.'); out[key] = d.value; }
  return out;
}
function dense(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) error('INPUT_SHAPE', 'Expected a standard dense asset array.');
  const size = Object.getOwnPropertyDescriptor(value, 'length').value;
  if (size > max || Reflect.ownKeys(value).length !== size + 1) error('INPUT_SHAPE', 'Invalid Markdown asset array.');
  const out = [];
  for (let i = 0; i < size; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d?.enumerable || !Object.hasOwn(d, 'value')) error('INPUT_SHAPE', 'Invalid Markdown asset item.'); out.push(d.value); }
  return out;
}
const typed = Object.getPrototypeOf(Uint8Array.prototype), tag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag).get, buffer = Object.getOwnPropertyDescriptor(typed, 'buffer').get, offset = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get, length = Object.getOwnPropertyDescriptor(typed, 'byteLength').get, abLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get, blobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get, blobRead = Blob.prototype.arrayBuffer, byteSet = Uint8Array.prototype.set, byteFill = Uint8Array.prototype.fill;
async function copyBytes(input, signal, remaining) {
  let source, size;
  if (tag.call(input) === 'Uint8Array') { size = length.call(input); source = new Uint8Array(buffer.call(input), offset.call(input), size); }
  else { let actual = false; try { size = abLength.call(input); actual = true; } catch {} if (actual) source = new Uint8Array(input); else { try { size = blobSize.call(input); } catch { error('INPUT_SHAPE', 'Asset bytes require actual Uint8Array, ArrayBuffer or Blob/File.'); } if (!size || size > 16 * MiB || size > remaining) error('LIMIT', 'Markdown asset byte budget exceeded.'); const bytes = await blobRead.call(input); check(signal); source = new Uint8Array(bytes); if (source.length !== size) error('ASSET_MISMATCH', 'Asset byte length changed.'); } }
  if (!size || size > 16 * MiB || size > remaining) error('LIMIT', 'Markdown asset byte budget exceeded.');
  check(signal); const owned = new Uint8Array(size); byteSet.call(owned, source); return owned;
}
const punctuation = char => !!char && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(char);
const flankPunctuation = char => !!char && /[\p{P}\p{S}]/u.test(char);
const whitespace = char => !char || /[ \t\r\n]/.test(char);
const named = Object.freeze({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'});
function entity(raw, index, env) {
  let end = -1;
  for (let j = index + 1; j < raw.length && j - index <= 32; j++) { env?.spend(); if (raw[j] === ';') { end = j; break; } }
  if (end < 0 || end - index > 32) return null;
  const name = raw.slice(index + 1, end); let text;
  if (Object.hasOwn(named, name)) text = named[name];
  else if (/^#(?:[0-9]{1,10}|[xX][0-9a-fA-F]{1,8})$/.test(name)) {
    const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    if (point > 0x10ffff || point >= 0xd800 && point <= 0xdfff || point < 32 && ![9,10,13].includes(point)) error('TEXT_UNICODE', 'Unsupported numeric character reference.');
    text = String.fromCodePoint(point);
  } else return null;
  return {text, end:end + 1};
}
function environment(signal) {
  const usage = {sourceUnits:0,sourceBytes:0,visits:0,tokens:0,logicalTextUnits:0,paragraphs:0,runs:0,tables:0,rows:0,cells:0,assets:0,assetBytes:0,modelBytes:0,outputBytes:0,resourceBytes:0,resourceCount:0};
  const report = [], seen = new Set(); let work = 0, actions = 0, modelCost = 256, serial = 0;
  return {signal, usage, report, id:() => `md-${++serial}`,
    issue(code, blockId) { if (!codes.has(code)) throw new Error('Unknown Markdown report code.'); if (seen.has(code)) return; if (report.length >= 100) error('LIMIT', 'Markdown report budget exceeded.'); seen.add(code); report.push(blockId ? {code:`markdown-${code}`,blockId} : {code:`markdown-${code}`}); },
    spend(n = 1) { usage.visits += n; work += n; if (usage.visits > 32 * MiB) error('LIMIT', 'Markdown scan budget exceeded.'); },
    token() { if (++usage.tokens > 2000000) error('LIMIT', 'Markdown token budget exceeded.'); },
    reserve(n) { modelCost += n; if (modelCost > DOCUMENT_LIMITS.modelBytes) error('LIMIT', 'Markdown model budget exceeded.'); },
    pending:() => work >= 16384,
    async yield(force = false) { if (force || work >= 16384 || ++actions >= 128) { work = 0; actions = 0; await pause(); check(signal); } },
    text(n) { if ((usage.logicalTextUnits += n) > DOCUMENT_LIMITS.textUnits) error('LIMIT', 'Markdown logical text exceeds one million UTF-16 units.'); }
  };
}
function addRun(runs, text, style, env) {
  if (!text) return;
  env.text(text.length); env.token();
  const previous = runs[runs.length - 1];
  if (previous?.style === style) { env.reserve(encoder.encode(JSON.stringify(text)).length); previous.text += text; }
  else { if (++env.usage.runs > DOCUMENT_LIMITS.runs) error('LIMIT', 'Markdown run budget exceeded.'); const run = {text,style,direction:'auto'}; env.reserve(encoder.encode(JSON.stringify(run)).length + 1); runs.push(run); }
}
function paragraph(runs, env, kind = 'paragraph', extras = {}) {
  if (++env.usage.paragraphs > DOCUMENT_LIMITS.paragraphs) error('LIMIT', 'Markdown paragraph budget exceeded.');
  env.reserve(150); return {id:env.id(),kind,direction:'auto',runs,...extras};
}
const combine = (style, marker) => { const bold = style === 'bold' || style === 'boldItalic' || marker.length > 1, italic = style === 'italic' || style === 'boldItalic' || marker.length % 2 === 1; return bold && italic ? 'boldItalic' : bold ? 'bold' : 'italic'; };
async function literalDecode(raw, env, escapes = true, max = DOCUMENT_LIMITS.textUnits) {
  let out = '';
  for (let i = 0; i < raw.length;) { env.spend(); const value = raw[i] === '&' ? entity(raw, i, env) : null; if (escapes && raw[i] === '\\' && punctuation(raw[i + 1])) { out += raw[i + 1]; i += 2; } else if (value) { out += value.text; i = value.end; } else out += raw[i++]; if (out.length > max) error('LIMIT', 'Decoded Markdown text exceeds its logical budget.'); if (env.pending()) await env.yield(); }
  return out;
}
async function inline(raw, env, {table = false, images = false, candidates, promote} = {}) {
  const parts = [{runs:[]}]; let runs = parts[0].runs, chunk = '', chunkStyle = 'regular';
  const flush = () => { addRun(runs, chunk, chunkStyle, env); chunk = ''; };
  const append = (text, style) => { if (style !== chunkStyle || chunk.length + text.length > 4096) { flush(); chunkStyle = style; } chunk += text; };
  async function parse(start, end, style, depth) {
    if (depth > 16) error('LIMIT', 'Markdown inline nesting exceeds sixteen.');
    let i = start;
    while (i < end) {
      env.spend(); env.token(); const char = raw[i];
      if (char === '\\' && punctuation(raw[i + 1])) { append(raw[i + 1], style); i += 2; }
      else if (char === '\\' && raw[i + 1] === '\n') { append('\n', style); i += 2; }
      else if (char === ' ') { let last = i; while (last < end && raw[last] === ' ') { last++; env.spend(); if (env.pending()) await env.yield(); } if (last - i >= 2 && raw[last] === '\n') { append('\n', style); i = last + 1; } else { append(raw.slice(i, last), style); i = last; } }
      else if (char === '<' && raw.startsWith('<!-- -->', i)) { env.spend(8); env.issue('safe-html-required'); flush(); i += 8; }
      else if (char === '<' && (raw.startsWith('<br />', i) || raw.startsWith('<br/>', i) || raw.startsWith('<br>', i))) { const size = raw.startsWith('<br />', i) ? 6 : raw.startsWith('<br/>', i) ? 5 : 4; env.spend(size); env.issue('safe-html-required'); if (table) { flush(); parts.push({runs:[]}); runs = parts[parts.length - 1].runs; } else append('\n', style); i += size; }
      else if (char === '&') { const value = entity(raw, i, env); if (value && value.end <= end) { append(value.text, style); i = value.end; } else { if (/^&(?:#|[A-Za-z])/.test(raw.slice(i, i + 2))) env.issue('entity-literal'); append(char, style); i++; } }
      else if (char === '`') {
        let size = 1; while (raw[i + size] === '`') { env.spend(); if (++size > 64) error('LIMIT', 'Markdown backtick delimiter exceeds64.'); }
        let close = -1;
        for (let j = i + size; j < end;) { env.spend(); if (raw[j] !== '`') j++; else { let n = 1; while (raw[j + n] === '`') { n++; env.spend(); if (n > 64) error('LIMIT', 'Markdown backtick delimiter exceeds64.'); } if (n === size) { close = j; break; } j += n; } if (env.pending()) await env.yield(); }
        if (close < 0) { append(raw.slice(i, i + size), style); i += size; }
        else { if (style !== 'regular') error('UNSUPPORTED_STYLE', 'Emphasized inline code is unsupported.'); let text = raw.slice(i + size, close).replace(/\n/g, ' '); if (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text)) text = text.slice(1, -1); if (table) { if (/\\\\\|/.test(text)) error('UNSUPPORTED_TABLE', 'Backslash before a code pipe is unsupported.'); text = text.replace(/\\\|/g, '|'); } append(text, 'code'); i = close + size; }
      } else if ((char === '*' || char === '_') && !whitespace(raw[i + 1])) {
        let size = 1; while (raw[i + size] === char && size < 4) size++;
        const marker = char.repeat(size), before = raw[i - 1], after = raw[i + size], left = !whitespace(after) && (!flankPunctuation(after) || whitespace(before) || flankPunctuation(before)) && !(char === '_' && /[\p{L}\p{N}]/u.test(before || ''));
        let close = -1;
        if (size <= 3 && left) for (let j = i + size; j < end; j++) {
          env.spend();
          if (raw[j] === '\\') j++;
          else if (raw.startsWith(marker, j) && raw[j + size] !== char) {
            const previous = raw[j - 1], following = raw[j + size];
            const right = !whitespace(previous) && (!flankPunctuation(previous) || whitespace(following) || flankPunctuation(following));
            if (right && !(char === '_' && /[\p{L}\p{N}]/u.test(following || ''))) { close = j; break; }
          }
          if (env.pending()) await env.yield();
        }
        if (close >= 0) { flush(); await parse(i + size, close, combine(style, marker), depth + 1); flush(); i = close + size; }
        else { append(marker, style); i += size; }
      } else if (char === '!' && raw[i + 1] === '[') {
        let endAlt = i + 2; while (endAlt < end && raw[endAlt] !== ']') { env.spend(); if (raw[endAlt] === '\\') endAlt++; endAlt++; if (env.pending()) await env.yield(); }
        let endTarget = endAlt + 2; if (raw[endAlt + 1] === '(') while (endTarget < end && raw[endTarget] !== ')' && endTarget - endAlt <= 1026) { env.spend(); endTarget++; }
        if (raw[endAlt + 1] === '(' && endTarget - endAlt > 1026) error('LIMIT', 'Markdown image target exceeds1024 units.');
        if (raw[endAlt] !== ']' || raw[endAlt + 1] !== '(' || raw[endTarget] !== ')') { env.issue('unsupported-literal'); append(char, style); i++; }
        else {
          const target = raw.slice(endAlt + 2, endTarget), key = target.startsWith('./') ? target.slice(2) : target;
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpg|jpeg)$/.test(key) || key.length > 100 || target.length > 1024) { env.issue('image-target-blocked'); append(raw.slice(i, endTarget + 1), style); i = endTarget + 1; }
          else {
            if (!images || table || style !== 'regular') error('UNSUPPORTED_STRUCTURE', 'Images in lists, cells or emphasized text are unsupported.');
            const candidate = candidates.get(key); if (!candidate) error('ASSET_MISSING', 'A named local image has no owned bytes.');
            const altRaw = raw.slice(i + 2, endAlt), alt = await literalDecode(altRaw, env, true, 10000); if (/[*_`]/.test(altRaw)) env.issue('image-alt-style-unrepresented');
            flush(); const asset = promote(candidate, alt); parts.push({image:asset}); parts.push({runs:[]}); runs = parts[parts.length - 1].runs; i = endTarget + 1;
          }
        }
      } else if (char === '[') {
        let close = i + 1; while (close < end && raw[close] !== ']') { env.spend(); if (raw[close] === '\\') close++; close++; if (env.pending()) await env.yield(); }
        if (raw[close + 1] === '(' || raw[close + 1] === '[') { const terminator = raw[close + 1] === '(' ? ')' : ']'; let target = close + 2; while (target < end && raw[target] !== terminator) { env.spend(); target++; if (env.pending()) await env.yield(); } if (target < end) { env.issue('unsupported-literal'); append(raw.slice(i, target + 1), style); i = target + 1; } else { append(char, style); i++; } } else { append(char, style); i++; }
      } else { if (char === '<') env.issue('html-literal'); append(char, style); i++; }
      if (env.pending()) await env.yield();
    }
  }
  await parse(0, raw.length, 'regular', 0); flush(); return parts;
}
async function tableCells(line, env) {
  const trim = async value => { let first = 0, last = value.length; while (first < last && (value[first] === ' ' || value[first] === '\t')) { first++; env.spend(); if (env.pending()) await env.yield(); } while (last > first && (value[last - 1] === ' ' || value[last - 1] === '\t')) { last--; env.spend(); if (env.pending()) await env.yield(); } return value.slice(first, last); };
  let text = await trim(line), cells = [], chunk = '';
  if (text.startsWith('|')) text = text.slice(1);
  let trailing = false;
  for (let i = 0; i < text.length; i++) { env.spend(); const char = text[i]; if (char === '\\' && i + 1 < text.length) { chunk += char + text[++i]; trailing = false; } else if (char === '|') { cells.push(await trim(chunk)); chunk = ''; trailing = true; } else { chunk += char; trailing = false; } if (cells.length > 100) error('LIMIT', 'Markdown table column budget exceeded.'); if (env.pending()) await env.yield(); }
  if (!trailing) cells.push(await trim(chunk)); return cells;
}
const marker = line => /^( {0,63})(?:(\d{1,9})([.)])|([-+*]))[ \t]+(.*)$/.exec(line);
const fence = line => /^( {0,3})(`{3,}|~{3,})([^\n]*)$/.exec(line);
const heading = line => /^( {0,3})(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
const rule = line => /^( {0,3})(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
async function delimiter(line, env) {
  let i = 0, count = 0;
  const spaces = async () => { while (line[i] === ' ' || line[i] === '\t') { i++; env.spend(); if (env.pending()) await env.yield(); } };
  await spaces(); if (line[i] === '|') i++;
  while (i < line.length) { await spaces(); if (line[i] === ':') i++; let dashes = 0; while (line[i] === '-') { dashes++; i++; env.spend(); if (env.pending()) await env.yield(); } if (dashes < 3) return false; if (line[i] === ':') i++; await spaces(); if (++count > 100) error('LIMIT', 'Markdown table separator column budget exceeded.'); if (i === line.length) return true; if (line[i++] !== '|') return false; await spaces(); if (i === line.length) return true; }
  return false;
}
async function headingText(text, env) {
  let last = text.length; while (last && (text[last - 1] === ' ' || text[last - 1] === '\t')) { last--; env.spend(); if (env.pending()) await env.yield(); }
  const end = last; while (last && text[last - 1] === '#') { last--; env.spend(); if (env.pending()) await env.yield(); }
  if (last === end || last && text[last - 1] !== ' ' && text[last - 1] !== '\t') return text;
  while (last && (text[last - 1] === ' ' || text[last - 1] === '\t')) { last--; env.spend(); if (env.pending()) await env.yield(); }
  return text.slice(0, last);
}

export async function readMarkdownDocument(source, settings = {}) {
  const opts = record(settings, ['assets','signal']), signal = opts.signal;
  if (signal !== undefined) { try { Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get.call(signal); } catch { error('INPUT_SHAPE', 'Expected an actual AbortSignal.'); } }
  check(signal); const env = environment(signal), u = env.usage, owned = [], candidates = new Map(), promoted = new Map(); let sourceBytes, modelBytes;
  const clean = () => { for (const bytes of owned) byteFill.call(bytes, 0); if (sourceBytes) byteFill.call(sourceBytes, 0); if (modelBytes) byteFill.call(modelBytes, 0); };
  try {
    if (typeof source !== 'string') error('INPUT_SHAPE', 'Markdown source must be a primitive string.');
    if (source.length > 8 * MiB) error('LIMIT', 'Markdown source unit budget exceeded.'); u.sourceUnits = source.length;
    for (let i = 0; i < source.length;) { const cp = source.codePointAt(i); env.spend(); if (cp >= 0xd800 && cp <= 0xdfff || cp < 32 && ![9,10,13].includes(cp)) error('TEXT_UNICODE', 'Invalid Markdown source Unicode.'); u.sourceBytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4; if (u.sourceBytes > 8 * MiB) error('LIMIT', 'Markdown source byte budget exceeded.'); i += cp > 65535 ? 2 : 1; if (env.pending()) await env.yield(); }
    sourceBytes = encoder.encode(source);
    let suppliedBytes = 0;
    for (const item of dense(opts.assets ?? [], 48)) {
      check(signal); const value = record(item, ['name','type','bytes','width','height']);
      if (typeof value.name !== 'string' || value.name.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpg|jpeg)$/.test(value.name) || !['image/png','image/jpeg'].includes(value.type) || (value.name.endsWith('.png') ? value.type !== 'image/png' : value.type !== 'image/jpeg')) error('INPUT_SHAPE', 'Invalid flat local image name or MIME.');
      if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 4096 || value.height > 4096 || value.width * value.height > 16000000) error('INPUT_SHAPE', 'Invalid local image dimension declaration.');
      const folded = value.name.toLowerCase(); if ([...candidates.keys()].some(name => name.toLowerCase() === folded)) error('INPUT_SHAPE', 'Local image names collide.');
      const bytes = await copyBytes(value.bytes, signal, 48 * MiB - suppliedBytes); owned.push(bytes); suppliedBytes += bytes.length;
      const size = imageDimensions(bytes, value.type); if (size.width !== value.width || size.height !== value.height) error('ASSET_MISMATCH', 'Image dimensions do not match owned bytes.'); candidates.set(value.name, {...value,bytes}); await env.yield(true);
    }
    const model = {version:1,origin:'markdown',pages:[],lists:[],blocks:[],assets:[],warnings:[]};
    const pushBlock = block => { if (model.blocks.length >= DOCUMENT_LIMITS.paragraphs + DOCUMENT_LIMITS.tables + DOCUMENT_LIMITS.assets) error('LIMIT', 'Markdown block budget exceeded.'); model.blocks.push(block); };
    const promote = (candidate, alt) => {
      if (promoted.has(candidate.name)) { const prior = promoted.get(candidate.name); if (prior.alt !== alt) error('ASSET_MISMATCH', 'One owned image cannot carry different alternate texts in this model.'); return prior; }
      env.text(alt.length); const asset = {id:env.id(),type:candidate.type,width:candidate.width,height:candidate.height,alt}; model.assets.push(asset); promoted.set(candidate.name, {...asset,bytes:candidate.bytes}); env.issue('image-size-inferred'); env.reserve(encoder.encode(JSON.stringify(asset)).length + 1); return asset;
    };
    // The line cursor retains at most two physical lines, never a source AST.
    let cursor = 0, lines = 0; const queue = [];
    async function readLine() {
      if (cursor >= source.length) return null;
      const start = cursor; while (cursor < source.length && source[cursor] !== '\n' && source[cursor] !== '\r') { cursor++; env.spend(); if (env.pending()) await env.yield(); }
      const text = source.slice(start, cursor); if (source[cursor] === '\r') { env.issue('line-endings-normalized'); cursor++; if (source[cursor] === '\n') cursor++; } else if (source[cursor] === '\n') cursor++;
      if (++lines > 100000) error('LIMIT', 'Markdown physical line budget exceeded.'); return {text, ended:cursor > start + text.length};
    }
    async function peek(n = 0) { while (queue.length <= n) { const line = await readLine(); queue.push(line); if (!line) break; } return queue[n] ?? null; }
    async function take() { const value = await peek(); queue.shift(); return value; }
    const stack = [];
    function reset() { stack.length = 0; }
    async function emitText(raw, kind = 'paragraph', extras = {}, images = true) {
      const parts = await inline(raw, env, {images,candidates,promote}); const actual = parts.filter(part => part.image || part.runs.length);
      if (actual.some(part => part.image) && actual.length > 1) env.issue('inline-image-block-normalized');
      if (!actual.length) pushBlock(paragraph([], env, kind, extras));
      else for (const part of actual) if (part.image) { const asset = part.image; pushBlock({id:env.id(),kind:'image',assetId:asset.id,width:asset.width * .75,height:asset.height * .75}); } else pushBlock(paragraph(part.runs, env, kind, extras));
    }
    while (await peek()) {
      await env.yield(); check(signal); const current = await take(), line = current.text;
      if (/^[ \t]*$/.test(line)) { if (line || (await peek())?.text === '') env.issue('blank-layout-unrepresented'); await env.yield(); continue; }
      const boundary = /^( *)<!-- -->$/.exec(line);
      if (boundary) { if (!boundary[1].length) reset(); else { const level = stack.findIndex(value => value.content === boundary[1].length); if (level < 0) error('UNSUPPORTED_LIST_CONTINUATION', 'List boundary indentation is unsupported.'); stack.length = level + 1; stack[level].childBoundary = true; } continue; }
      if (line === '<p></p>') { reset(); env.issue('safe-html-required'); pushBlock(paragraph([], env)); continue; }
      if (line.startsWith('<pre><code>')) {
        reset(); let raw = line.slice(11); while (!raw.endsWith('</code></pre>')) { const next = await take(); if (!next) error('UNSUPPORTED_STRUCTURE', 'Unclosed exact code wrapper.'); if (raw.length + next.text.length + 1 > 8 * MiB) error('LIMIT', 'Code wrapper budget exceeded.'); raw += '\n' + next.text; }
        raw = raw.slice(0, -13); if (raw.includes('<')) error('UNSUPPORTED_STRUCTURE', 'Exact code wrapper contains raw markup.'); const text = await literalDecode(raw, env, false); const runs = []; addRun(runs, text, 'code', env); pushBlock(paragraph(runs, env, 'code')); env.issue('safe-html-required'); continue;
      }
      const f = fence(line);
      if (f) {
        reset(); if (f[2].length > 64 || f[3].length > 100) error('LIMIT', 'Code delimiter or info budget exceeded.'); if (f[2][0] === '`' && f[3].includes('`')) error('UNSUPPORTED_STRUCTURE', 'Backtick fence info cannot contain a backtick.'); if (f[3].replace(/[ \t]/g, '')) env.issue('code-info-unrepresented'); let text = '', closed = false;
        while (await peek()) { const next = await take(); const closing = /^( {0,3})(`+|~+)[ \t]*$/.exec(next.text); if (closing && closing[2][0] === f[2][0] && closing[2].length >= f[2].length) { if (closing[2].length > 64) error('LIMIT', 'Code closing delimiter exceeds64.'); closed = true; break; } let indent = 0; while (indent < f[1].length && next.text[indent] === ' ') indent++; const content = next.text.slice(indent); if (text.length + content.length + 1 > DOCUMENT_LIMITS.textUnits) error('LIMIT', 'Code text budget exceeded.'); text += content + (next.ended ? '\n' : ''); }
        if (!closed) env.issue('unsupported-literal'); const runs = []; addRun(runs, text, 'code', env); pushBlock(paragraph(runs, env, 'code')); continue;
      }
      const next = await peek(), validSeparator = next ? await delimiter(next.text, env) : false;
      if (next && !validSeparator && /^[ \t|:-]+$/.test(next.text) && next.text.includes('-') && line.includes('|')) error('UNSUPPORTED_TABLE', 'Malformed pipe-table separator.');
      if (validSeparator && line.includes('|')) {
        reset(); if (++u.tables > 500) error('LIMIT', 'Table budget exceeded.'); const headers = await tableCells(line, env), delimiters = await tableCells((await take()).text, env); if (!headers.length || headers.length !== delimiters.length) error('UNSUPPORTED_TABLE', 'Table header and separator differ.');
        const table = {id:env.id(),kind:'table',columnWidths:headers.map(() => 1),rows:[]}; env.reserve(200 + headers.length * 4); env.issue('table-header-unrepresented', table.id); if (delimiters.some(value => value.includes(':'))) env.issue('table-alignment-unrepresented', table.id);
        async function row(values) { if (values.length !== headers.length) error('UNSUPPORTED_TABLE', 'Ragged Markdown tables are unsupported.'); if (++u.rows > 10000) error('LIMIT', 'Aggregate table row budget exceeded.'); const cells = []; for (const value of values) { if (++u.cells > 200000) error('LIMIT', 'Table cell budget exceeded.'); env.reserve(24); const parts = await inline(value, env, {table:true}); const paragraphs = parts.map(part => paragraph(part.runs, env)); if (paragraphs.length > 1) env.issue('table-paragraph-layout-normalized', table.id); if (value.includes('&#10;')) env.issue('whitespace-visual-dependent', table.id); cells.push({paragraphs}); await env.yield(); } table.rows.push(cells); }
        await row(headers); while ((await peek())?.text.includes('|') && (await peek()).text.replace(/[ \t]/g, '')) await row(await tableCells((await take()).text, env)); pushBlock(table); continue;
      }
      if (rule(line)) { reset(); pushBlock({id:env.id(),kind:'rule'}); env.reserve(40); continue; }
      const m = marker(line);
      if (m && /^\[[ xX]\](?:[ \t]|$)/.test(m[5])) { reset(); env.issue('unsupported-literal'); const runs = []; addRun(runs, line, 'regular', env); pushBlock(paragraph(runs, env)); continue; }
      if (m) {
        const indent = m[1].length, ordered = !!m[2], value = ordered ? Number(m[2]) : null, content = indent + m[0].length - m[5].length - indent;
        if (ordered && (value < 1 || value > 1000000)) error('UNSUPPORTED_STRUCTURE', 'List number is outside the supported model.');
        let level = stack.findIndex(entry => entry.indent === indent);
        if (level < 0) { if (!stack.length && indent <= 3) level = 0; else if (stack.length && indent === stack[stack.length - 1].content) level = stack.length; else error('UNSUPPORTED_LIST_CONTINUATION', 'Unsupported list indentation.'); }
        if (level >= 9) error('LIMIT', 'List nesting exceeds nine.'); stack.length = Math.min(stack.length, level + 1);
        let state = stack[level], restart = false;
        if (!state || state.ordered !== ordered || (level && stack[level - 1].childBoundary)) {
          if (level) stack[level - 1].childBoundary = false;
          const definition = {id:env.id(),ordered,start:ordered ? value : 1}; if (model.lists.length >= 10000) error('LIMIT', 'List definition budget exceeded.'); model.lists.push(definition); env.reserve(100); state = {id:definition.id,ordered,indent,content,next:definition.start}; stack[level] = state; restart = true;
        }
        const actual = state.next++; if (actual > 1000000) error('LIMIT', 'List counter exceeds the supported model.'); if (ordered && value !== actual) env.issue('list-marker-normalized'); state.content = content;
        let raw = m[5]; while ((await peek()) && /^[ ]+\S/.test((await peek()).text) && !marker((await peek()).text) && !(await peek()).text.includes('<!-- -->')) { const continuation = (await peek()).text; if (continuation.length - continuation.trimStart().length !== state.content) break; await take(); raw += '\n' + continuation.slice(state.content); if (raw.length > 8 * MiB) error('LIMIT', 'List item source budget exceeded.'); }
        await emitText(raw, 'list-item', {list:{id:state.id,level,value:actual,restart}}, false); await env.yield(); continue;
      }
      reset(); const h = heading(line);
      if (h) { await emitText(await headingText(h[3] ?? '', env), 'heading', {level:h[2].length}, false); continue; }
      let raw = line, unsupported = /^(?: {4}|\t| {0,3}>| {0,3}\[[^\]]+\]:| {0,3}(?:=+|-+)[ \t]*$| {0,3}<(?!br(?:>|\/>| \/>)|!-- -->))/.test(line);
      while (await peek()) { const candidate = (await peek()).text; if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(candidate)) { await take(); raw += '\n' + candidate; unsupported = true; break; } if (/^[ \t]*$/.test(candidate) || fence(candidate) || heading(candidate) || marker(candidate) || rule(candidate) || /^(?: *<!-- -->|<p><\/p>|<pre><code>)/.test(candidate) || candidate.includes('|') && (await peek(1)) && await delimiter((await peek(1)).text, env)) break; await take(); raw += '\n' + candidate; if (raw.length > 8 * MiB) error('LIMIT', 'Paragraph source budget exceeded.'); }
      if (unsupported) { env.issue('unsupported-literal'); const runs = []; addRun(runs, raw, 'regular', env); pushBlock(paragraph(runs, env)); } else await emitText(raw); await env.yield();
    }
    await env.yield(true); const validated = validateDocumentModel(model, {signal:signal ? {throwIfAborted:() => check(signal)} : undefined}); modelBytes = encoder.encode(JSON.stringify(validated)); u.modelBytes = modelBytes.length;
    const assets = []; const retained = new Set(); for (const asset of promoted.values()) { const {id,type,width,height,bytes} = asset; assets.push({id,type,width,height,bytes}); retained.add(bytes); u.assetBytes += bytes.length; }
    for (const bytes of owned) if (!retained.has(bytes)) byteFill.call(bytes, 0);
    u.assets = assets.length; u.resourceBytes = u.sourceBytes + u.modelBytes + u.assetBytes; u.resourceCount = 2 + assets.length;
    if (u.resourceBytes > 96 * MiB || u.resourceCount > 128) error('LIMIT', 'Markdown retained resource budget exceeded.');
    await env.yield(true); let disposed = false; return {model:validated,modelBytes,sourceBytes,assets,report:env.report,usage:u,dispose() { if (!disposed) { disposed = true; clean(); } }};
  } catch (failure) { clean(); throw failure; }
}
