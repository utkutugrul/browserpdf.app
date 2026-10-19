import { validateDocumentModel, DOCUMENT_LIMITS } from './document-model.js';
import { imageDimensions } from './composition-state.js';

const MiB = 1024 * 1024, encoder = new TextEncoder(), pause = () => new Promise(resolve => setTimeout(resolve, 0));
const error = (code, message) => { const failure = new Error(message); failure.code = `MARKDOWN_${code}`; throw failure; };
const abort = AbortSignal.prototype.throwIfAborted, check = signal => { if (signal) abort.call(signal); };
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
const reportCodes = new Set(['list-identity-unrepresented','table-header-inferred','table-widths-unrepresented','table-paragraph-layout-normalized','empty-cell-normalized','whitespace-visual-dependent','direction-unrepresented','source-references-unrepresented','source-warnings-unrepresented','page-break-unrepresented','safe-html-required','image-size-unrepresented']);
const punctuation = char => !!char && /[\p{P}\p{S}]/u.test(char), whitespace = char => !char || /[ \t\r\n]/.test(char);

export async function documentToMarkdown(input, settings = {}) {
  const opts = record(settings, ['assets','signal']), signal = opts.signal;
  if (signal !== undefined) { try { Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get.call(signal); } catch { error('INPUT_SHAPE', 'Expected an actual AbortSignal.'); } }
  check(signal); const model = validateDocumentModel(input, {signal:signal ? {throwIfAborted:() => check(signal)} : undefined}), owned = [], candidates = new Map(), images = [], names = new Map(), report = [], seen = new Set(); let output;
  const usage = {sourceUnits:0,sourceBytes:0,visits:0,tokens:0,logicalTextUnits:0,paragraphs:0,runs:0,tables:0,rows:0,cells:0,assets:0,assetBytes:0,modelBytes:0,outputBytes:0,resourceBytes:0,resourceCount:0};
  let work = 0, actions = 0, outputUnits = 0, outputLineBreaks = 0;
  const clean = () => { for (const bytes of owned) byteFill.call(bytes, 0); if (output) byteFill.call(output, 0); };
  const issue = (code, blockId) => { if (!reportCodes.has(code)) throw new Error('Unknown Markdown report code.'); if (seen.has(code)) return; if (report.length >= 100) error('LIMIT', 'Markdown report budget exceeded.'); seen.add(code); report.push(blockId ? {code:`markdown-${code}`,blockId} : {code:`markdown-${code}`}); };
  const spend = n => { usage.visits += n; work += n; if (usage.visits > 32 * MiB) error('LIMIT', 'Markdown serialization work budget exceeded.'); };
  const cooperative = async (force = false) => { if (force || work >= 16384 || ++actions >= 128) { work = 0; actions = 0; await pause(); check(signal); } };
  const chunks = [];
  const add = async value => { if (outputUnits + value.length > 8 * MiB) error('LIMIT', 'Markdown output exceeds the source unit budget.'); let lines = outputLineBreaks, bytes = 0; for (let i = 0; i < value.length;) { const cp = value.codePointAt(i); spend(1); bytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4; if (usage.outputBytes + bytes > 8 * MiB) error('LIMIT', 'Markdown output exceeds the source byte budget.'); if (cp === 10 && ++lines > 100000) error('LIMIT', 'Markdown output exceeds the source physical line budget.'); i += cp > 65535 ? 2 : 1; if (work >= 16384) await cooperative(); } if (lines + (value && !value.endsWith('\n') ? 1 : 0) > 100000) error('LIMIT', 'Markdown output exceeds the source physical line budget.'); outputLineBreaks = lines; usage.outputBytes += bytes; outputUnits += value.length; if (++usage.tokens > 2000000) error('LIMIT', 'Markdown output token budget exceeded.'); chunks.push(value); };
  const definitions = new Map(model.lists.map(value => [value.id,value])), metadata = new Map(model.assets.map(value => [value.id,value]));
  async function escaped(text, {table = false, heading = false, edge = false, startEdge = edge, endEdge = edge, alt = false} = {}) {
    let out = '';
    let leading = 0, trailing = text.length;
    if (startEdge) while (leading < text.length && (text[leading] === ' ' || text[leading] === '\t')) { leading++; spend(1); if (work >= 16384) await cooperative(); }
    if (endEdge) while (trailing > leading && (text[trailing - 1] === ' ' || text[trailing - 1] === '\t')) { trailing--; spend(1); if (work >= 16384) await cooperative(); }
    for (let i = 0; i < text.length; i++) {
      spend(1); const char = text[i];
      if (char === '\r') out += '&#13;';
      else if (char === '\n') out += table || alt ? '&#10;' : '<br />';
      else if ((char === ' ' || char === '\t') && (startEdge && i < leading || endEdge && i >= trailing)) out += char === ' ' ? '&#32;' : '&#9;';
      else if (/[\\`*_\[\]<>&]/.test(char) || table && char === '|' || heading && char === '#') out += '\\' + char;
      else out += char;
      if ((i & 4095) === 0) await cooperative();
    }
    return out;
  }
  function provenance(block) {
    if (block.source) issue('source-references-unrepresented', block.id);
    if (block.direction && block.direction !== 'auto' || block.runs?.some(run => run.direction !== 'auto')) issue('direction-unrepresented', block.id);
  }
  async function inlineCode(text, table) {
    if (/[\r\n]/.test(text)) error('UNSUPPORTED_STYLE', 'Exact inline code cannot contain CR or LF.');
    if (table && /\\\|/.test(text)) error('UNSUPPORTED_TABLE', 'Backslash before a code pipe is unsupported.');
    let longest = 0, current = 0;
    for (let i = 0; i < text.length; i++) { spend(1); if (text[i] === '`') longest = Math.max(longest, ++current); else current = 0; if ((i & 4095) === 0) await cooperative(); }
    if (longest >= 64) error('UNSUPPORTED_STYLE', 'Exact inline code needs a delimiter over64.');
    const delimiter = '`'.repeat(longest + 1), padding = text.startsWith('`') || text.endsWith('`') || text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text) ? ' ' : '';
    return delimiter + padding + (table ? text.replace(/\|/g, '\\|') : text) + padding + delimiter;
  }
  async function body(block, table = false) {
    provenance(block); usage.paragraphs++; let out = '', previousStyle = null, previousTail = null;
    const merged = [];
    for (const run of block.runs) {
      usage.runs++; usage.logicalTextUnits += run.text.length;
      if (!run.text) { await cooperative(); continue; }
      let previous = merged[merged.length - 1];
      if (!previous || previous.style !== run.style) { previous = {text:'',style:run.style}; merged.push(previous); }
      for (let i = 0; i < run.text.length; i += 16384) { const fragment = run.text.slice(i, i + 16384); previous.text += fragment; spend(fragment.length); await cooperative(); }
    }
    for (let index = 0; index < merged.length; index++) {
      const run = merged[index];
      let piece, tail;
      if (run.style === 'code') { piece = await inlineCode(run.text, table); tail = '`'; }
      else {
        let value = await escaped(run.text, {table,heading:block.kind === 'heading',startEdge:run.style !== 'regular' || index === 0,endEdge:run.style !== 'regular' || index === merged.length - 1});
        if (run.style === 'regular') {
          // Only actual block-prefix syntax is escaped; ordinary punctuation stays readable.
          if (!out) value = value.replace(/^(#{1,6})(?=[ \t]|$)|^([>+\-=])(?=[ \t]|$)|^([-])(?=--[ \t]*$)|^(\d{1,9})([.)])(?=[ \t])/, (match, hashes, prefix, rule, digits, dot) => digits ? digits + '\\' + dot : '\\' + match);
          if (!out && !table && block.kind === 'paragraph' && value.startsWith('~~~')) value = '\\' + value;
          piece = value;
        } else { const marker = run.style === 'bold' ? '**' : run.style === 'italic' ? '*' : run.style === 'boldItalic' ? '***' : null; if (!marker) error('UNSUPPORTED_STYLE', 'Unsupported Markdown run style.'); piece = marker + value + marker; }
        tail = value.at(-1);
      }
      const emphasis = !['regular','code'].includes(run.style), previousEmphasis = previousStyle && !['regular','code'].includes(previousStyle);
      const needsSeparator = previousStyle && previousStyle !== 'regular' && run.style !== 'regular'
        || emphasis && punctuation(piece[run.style === 'boldItalic' ? 3 : run.style === 'bold' ? 2 : 1]) && !whitespace(out.at(-1)) && !punctuation(out.at(-1))
        || previousEmphasis && run.style === 'regular' && punctuation(previousTail) && !whitespace(piece[0]) && !punctuation(piece[0])
        || index === 0 && run.style === 'code' && piece.startsWith('```');
      if (out.length + piece.length + (needsSeparator ? 8 : 0) > 8 * MiB) error('LIMIT', 'Markdown inline output unit budget exceeded.');
      if (needsSeparator) { out += '<!-- -->'; issue('safe-html-required', block.id); }
      out += piece;
      if (/\t| {2}|\r|\n/.test(run.text)) issue('whitespace-visual-dependent', block.id);
      if (run.text.includes('\n') && !table) issue('safe-html-required', block.id);
      previousStyle = run.style;
      previousTail = tail;
      await cooperative();
    }
    return out;
  }
  async function codeBlock(block) {
    provenance(block); usage.paragraphs++; let text = '';
    for (const run of block.runs) { usage.runs++; usage.logicalTextUnits += run.text.length; if (run.style !== 'code') error('UNSUPPORTED_STYLE', 'Code blocks require explicit code runs.'); for (let i = 0; i < run.text.length; i += 16384) { const fragment = run.text.slice(i, i + 16384); text += fragment; spend(fragment.length); await cooperative(); } await cooperative(); }
    let longest = 0, current = 0;
    for (let i = 0; i < text.length; i++) { spend(1); if (text[i] === '`') longest = Math.max(longest, ++current); else current = 0; if ((i & 4095) === 0) await cooperative(); }
    if ((!text || text.endsWith('\n')) && !text.includes('\r') && longest < 64) { const fence = '`'.repeat(Math.max(3, longest + 1)); return `${fence}\n${text}${fence}`; }
    issue('safe-html-required', block.id); let escapedText = '';
    for (let i = 0; i < text.length; i++) { spend(1); const char = text[i]; escapedText += char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '\r' ? '&#13;' : char; if ((i & 4095) === 0) await cooperative(); }
    return `<pre><code>${escapedText}</code></pre>`;
  }
  try {
    let admittedBytes = 0;
    for (const item of dense(opts.assets ?? [], 48)) {
      const value = record(item, ['id','type','bytes','width','height']), expected = metadata.get(value.id);
      if (!expected || candidates.has(value.id)) error('INPUT_SHAPE', 'Unknown or duplicate Markdown asset ID.');
      if (value.type !== expected.type || value.width !== expected.width || value.height !== expected.height) error('ASSET_MISMATCH', 'Markdown asset metadata differs from the model.');
      const bytes = await copyBytes(value.bytes, signal, 48 * MiB - admittedBytes); owned.push(bytes); admittedBytes += bytes.length;
      const size = imageDimensions(bytes, value.type); if (size.width !== value.width || size.height !== value.height) error('ASSET_MISMATCH', 'Image dimensions do not match owned bytes.'); candidates.set(value.id, {...value,bytes}); await cooperative(true);
    }
    usage.modelBytes = encoder.encode(JSON.stringify(model)).length;
    for (const asset of model.assets) usage.logicalTextUnits += asset.alt.length;
    if (model.pages.length) issue('source-references-unrepresented'); if (model.warnings.length) issue('source-warnings-unrepresented');
    const stack = [], used = new Set(); let previousList = false, emittedBlock = false;
    for (const block of model.blocks) {
      check(signal); provenance(block); let value = '', list = block.kind === 'list-item';
      if (list) {
        const item = block.list, definition = definitions.get(item.id), level = item.level;
        if (level > stack.length) error('UNSUPPORTED_LIST_CONTINUATION', 'List level jumps are unsupported.');
        stack.length = Math.min(stack.length, level + 1); let state = stack[level], boundary = false;
        if (state && (state.id !== item.id || item.restart || state.next !== item.value)) { boundary = true; stack.length = level; state = null; }
        if (!state) {
          if (!item.restart && used.has(item.id)) error('UNSUPPORTED_LIST_CONTINUATION', 'Interrupted list continuation cannot be represented.');
          if (!item.restart) error('UNSUPPORTED_LIST_CONTINUATION', 'First-use list items require an explicit restart.');
          if (!level && !used.has(item.id) && item.value !== definition.start) error('UNSUPPORTED_LIST_CONTINUATION', 'Root list start differs from its definition.');
          state = {id:item.id,next:item.value,indent:level ? stack[level - 1].content : 0}; stack[level] = state; used.add(item.id);
        }
        if (!definition.ordered && (definition.start !== 1 || item.value !== state.next)) error('UNSUPPORTED_LIST_CONTINUATION', 'Bullet counter semantics cannot be represented.');
        const marker = definition.ordered ? `${item.value}. ` : '- '; state.content = state.indent + marker.length; state.next = item.value + 1;
        value = (boundary ? ' '.repeat(state.indent) + '<!-- -->\n' : '') + ' '.repeat(state.indent) + marker + await body(block); issue('list-identity-unrepresented', block.id);
      } else {
        stack.length = 0;
        if (block.kind === 'paragraph' || block.kind === 'heading') { value = await body(block); if (!value && block.kind === 'paragraph') { value = '<p></p>'; issue('safe-html-required', block.id); } if (block.kind === 'heading') value = '#'.repeat(block.level) + (value ? ' ' + value : ''); }
        else if (block.kind === 'code') value = await codeBlock(block);
        else if (block.kind === 'rule') value = '---';
        else if (block.kind === 'page-break') { issue('page-break-unrepresented', block.id); continue; }
        else if (block.kind === 'table') {
          usage.tables++; if (!block.rows.length) error('UNSUPPORTED_TABLE', 'A table needs a header/data row.');
          issue('table-header-inferred', block.id); issue('table-widths-unrepresented', block.id); const rows = [];
          for (let r = 0; r < block.rows.length; r++) { usage.rows++; const cells = []; for (const cell of block.rows[r]) { usage.cells++; const paragraphs = cell.paragraphs; if (!paragraphs.length) { if (++usage.paragraphs > DOCUMENT_LIMITS.paragraphs) error('LIMIT', 'Normalized empty cells exceed the reader paragraph budget.'); cells.push(''); issue('empty-cell-normalized', block.id); } else { const pieces = []; for (const paragraph of paragraphs) { if (paragraph.kind !== 'paragraph') error('UNSUPPORTED_TABLE', 'Table cells require ordinary paragraph blocks.'); pieces.push(await body(paragraph, true)); if (usage.paragraphs > DOCUMENT_LIMITS.paragraphs) error('LIMIT', 'Table output exceeds the reader paragraph budget.'); } cells.push(pieces.join('<br />')); if (pieces.length > 1) { issue('table-paragraph-layout-normalized', block.id); issue('safe-html-required', block.id); } } await cooperative(); } rows.push('| ' + cells.join(' | ') + ' |'); if (r === 0) rows.push('| ' + cells.map(() => '---').join(' | ') + ' |'); }
          value = rows.join('\n');
        } else if (block.kind === 'image') {
          const asset = metadata.get(block.assetId), candidate = candidates.get(block.assetId); if (!candidate) error('ASSET_MISSING', 'A referenced image has no owned bytes.');
          let name = names.get(asset.id); if (!name) { name = `image-${String(images.length + 1).padStart(3, '0')}.${asset.type === 'image/png' ? 'png' : 'jpg'}`; names.set(asset.id, name); images.push({id:asset.id,name,type:asset.type,bytes:candidate.bytes,width:asset.width,height:asset.height}); usage.assetBytes += candidate.bytes.length; }
          value = `![${await escaped(asset.alt, {alt:true,edge:true})}](${name})`; issue('image-size-unrepresented', block.id);
        }
      }
      if (emittedBlock) await add(list && previousList ? '\n' : '\n\n'); await add(value); emittedBlock = true; previousList = list; await cooperative();
    }
    if (emittedBlock) await add('\n'); await cooperative(true);
    const text = chunks.join(''); output = encoder.encode(text); usage.assets = images.length; usage.resourceBytes = usage.outputBytes + usage.assetBytes; usage.resourceCount = images.length + 1;
    if (usage.resourceBytes > 96 * MiB || usage.resourceCount > 128) error('LIMIT', 'Markdown output resource budget exceeded.');
    const retained = new Set(images.map(image => image.bytes)); for (const bytes of owned) if (!retained.has(bytes)) byteFill.call(bytes, 0);
    await cooperative(true); let disposed = false; return {text,bytes:output,type:'text/markdown',images,report,usage,dispose() { if (!disposed) { disposed = true; clean(); } }};
  } catch (failure) { clean(); throw failure; }
}
