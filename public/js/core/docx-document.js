import { admitOoxmlArchive } from './ooxml-zip.js';
import { validateDocumentModel, DOCUMENT_LIMITS } from './document-model.js';
import { imageDimensions } from './composition-state.js';
import { readAdmittedXml as readXmlEvents, xmlKey } from './document-xml.js';
import { zipStore } from '../zip-writer.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MiB = 1024 * 1024, W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', REL = 'http://schemas.openxmlformats.org/package/2006/relationships', CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const encoder = new TextEncoder(), pause = () => new Promise(resolve => setTimeout(resolve, 0));
const check = signal => signal?.throwIfAborted();
const error = (code, message) => { const value = new Error(message); value.code = `DOCX_${code}`; throw value; };
// Office compatibility selection is adapter policy after admission. Apply it
// to every structurally consumed part, before any branch's Word descendants.
function readAdmittedXml(bytes, onEvent, env) {
  return readXmlEvents(bytes, event => {
    if (event.type === 'start' && event.ns === 'http://schemas.openxmlformats.org/markup-compatibility/2006' && ['AlternateContent','Choice','Fallback'].includes(event.name)) error('UNSUPPORTED_COMPATIBILITY', 'Office markup compatibility alternatives are unsupported in this subset.');
    onEvent(event);
  }, env);
}
const attr = (event, name, ns = W) => event.attrs.get(xmlKey(ns, name));
const xml = value => String(value).replace(/[&<>"\r]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\r':'&#13;'})[char]);
const jsonBytes = value => encoder.encode(JSON.stringify(value)).length;
function record(value, allowed, label) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`Invalid ${label}.`);
  const owned = {};
  for (const key of Reflect.ownKeys(value)) { const d = Object.getOwnPropertyDescriptor(value, key); if (typeof key !== 'string' || !allowed.includes(key) || !d.enumerable || !Object.hasOwn(d, 'value') || d.value === undefined) throw new TypeError(`Invalid ${label} field.`); owned[key] = d.value; }
  return owned;
}
function dense(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('Expected a standard dense asset array.');
  const length = Object.getOwnPropertyDescriptor(value, 'length').value;
  if (length > max || Reflect.ownKeys(value).length !== length + 1) throw new TypeError('Invalid asset array shape.');
  const out = [];
  for (let i = 0; i < length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) throw new TypeError('Invalid asset array item.'); out.push(d.value); }
  return out;
}
const typed = Object.getPrototypeOf(Uint8Array.prototype), tag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag).get, buffer = Object.getOwnPropertyDescriptor(typed, 'buffer').get, offset = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get, length = Object.getOwnPropertyDescriptor(typed, 'byteLength').get, abLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get, blobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get, blobRead = Blob.prototype.arrayBuffer, byteSet = Uint8Array.prototype.set;
async function copyBytes(input, signal, remaining) {
  let source, size;
  if (tag.call(input) === 'Uint8Array') { size = length.call(input); source = new Uint8Array(buffer.call(input), offset.call(input), size); }
  else { let actual = false; try { size = abLength.call(input); actual = true; } catch {} if (actual) source = new Uint8Array(input); else { try { size = blobSize.call(input); } catch { throw new TypeError('Asset bytes must be an actual Uint8Array, ArrayBuffer or Blob/File.'); } if (!size || size > 16 * MiB || size > remaining) throw new RangeError('Asset bytes exceed the part, aggregate or 32 MiB output budget.'); const bytes = await blobRead.call(input); check(signal); if (abLength.call(bytes) !== size) throw new Error('Asset byte length changed.'); source = new Uint8Array(bytes); } }
  if (!size || size > 16 * MiB || size > remaining) throw new RangeError('Asset bytes exceed the part, aggregate or 32 MiB output budget.');
  check(signal); const owned = new Uint8Array(size); byteSet.call(owned, source); return owned;
}
function integer(value, min = 0, max = 1000000) { if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) error('UNSUPPORTED_NUMBER', 'An Office integer is outside the supported range.'); return Number(value); }
function onOff(value) { if (value === undefined || ['1','true','on'].includes(value)) return true; if (['0','false','off'].includes(value)) return false; error('UNSUPPORTED_STYLE', 'An Office on/off property is invalid.'); }
const REPORT_CODES = new Set(['source-font-face-unrepresented','source-size-unrepresented','source-style-unrepresented','column-width-inferred','inline-image-block-normalized','external-image-blocked','header-footer-omitted','notes-omitted','hyperlink-unrepresented','office-layout-unrepresented']);
function reports() {
  const values = [], seen = new Set();
  return {values, add(code, blockId) { if (!REPORT_CODES.has(code)) throw new Error('Unknown adapter report code.'); const key = `${code}|${blockId || ''}`; if (seen.has(key)) return; if (values.length === 100) throw new RangeError('DOCX fidelity report exceeds 100 entries.'); seen.add(key); values.push(blockId ? {code, blockId} : {code}); }};
}
function targetPath(base, target) {
  if (typeof target !== 'string' || encoder.encode(target).length > 1024 || /[\\:%?#\u0000-\u0020\u007f-\u009f]/u.test(target)) error('UNSUPPORTED_RELATIONSHIP', 'Unsupported local relationship target.');
  const out = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const part of target.split('/')) { if (!part) { if (out.length || !target.startsWith('/')) error('UNSUPPORTED_RELATIONSHIP', 'Empty relationship path component.'); continue; } if (part === '.') continue; if (part === '..') { if (!out.length) error('UNSUPPORTED_RELATIONSHIP', 'Relationship escapes the package.'); out.pop(); } else out.push(part); }
  return out.join('/');
}
function metadataBudget() { let count = 0; return value => { count += jsonBytes(value); if (count > MiB) throw new RangeError('DOCX style/numbering/relationship metadata exceeds 1 MiB.'); }; }
async function relationships(bytes, base, env) {
  const result = new Map(); if (!bytes) return result;
  await readAdmittedXml(bytes, event => {
    if (event.type !== 'start') return;
    if (event.depth === 1 && (event.ns !== REL || event.name !== 'Relationships')) error('PACKAGE', 'Invalid relationship root namespace.');
    if (event.ns === REL && event.name === 'Relationship') {
      const id = attr(event, 'Id', ''), type = attr(event, 'Type', ''), target = attr(event, 'Target', ''), mode = attr(event, 'TargetMode', '');
      if (!id || id.length > 100 || !type || type.length > 1024 || result.has(id) || result.size === 512 || mode !== undefined && !['Internal','External'].includes(mode)) error('UNSUPPORTED_RELATIONSHIP', 'Invalid or excessive relationships.');
      const value = {type, external:mode === 'External', target:mode === 'External' ? null : targetPath(base, target)}; if (typeof target !== 'string' || encoder.encode(target).length > 1024) error('UNSUPPORTED_RELATIONSHIP', 'Relationship target exceeds its bound.');
      env.charge([id, value]); result.set(id, value);
    }
  }, env); return result;
}
function property(event, props, report) {
  const value = attr(event, 'val');
  if (['b','i','bCs','iCs','rtl','bidi','cs'].includes(event.name)) props[event.name] = onOff(value);
  else if (['pStyle','rStyle','basedOn'].includes(event.name)) { if (!value || value.length > 100) error('UNSUPPORTED_STYLE', 'Style identity exceeds its bound.'); props[event.name] = value; }
  else if (event.name === 'numId') props.numId = integer(value);
  else if (event.name === 'ilvl') props.ilvl = integer(value, 0, 8);
  else if (event.name === 'outlineLvl') props.outline = integer(value, 0, 9);
  else if (event.name === 'rFonts') { const fonts = ['ascii','hAnsi','cs','eastAsia'].map(name => attr(event, name)).filter(Boolean); if (fonts.some(font => font.length > 100)) error('UNSUPPORTED_STYLE', 'Font name exceeds its bound.'); report.add('source-font-face-unrepresented'); if (fonts.includes('Courier New')) props.code = true; }
  else if (['sz','szCs'].includes(event.name)) report.add('source-size-unrepresented');
  else if (['spacing','ind','jc','keepNext','keepLines','contextualSpacing','widowControl'].includes(event.name)) report.add('office-layout-unrepresented');
  else if (!['pPr','rPr','numPr','name','qFormat','uiPriority','semiHidden','unhideWhenUsed','next','color','lang','pBdr','bottom'].includes(event.name)) report.add('source-style-unrepresented');
}
function apply(base, properties, toggle = false) { const result = {...base}; for (const key of Object.keys(properties)) if (toggle && ['b','i','bCs','iCs'].includes(key)) { if (properties[key]) result[key] = !result[key]; } else result[key] = properties[key]; return result; }
async function styles(bytes, env, report) {
  const definitions = new Map(), defaults = {}; let current = null, inDefaults = false, propertyDepth = 0;
  if (bytes) await readAdmittedXml(bytes, event => {
    if (event.type === 'start' && event.depth === 1 && (event.ns !== W || event.name !== 'styles')) error('PACKAGE', 'Invalid styles root.');
    if (event.ns !== W) return;
    if (event.type === 'start') {
      if (event.name === 'docDefaults') inDefaults = true;
      if (event.name === 'style') { const id = attr(event, 'styleId'), type = attr(event, 'type'); if (!id || id.length > 100 || definitions.has(id) || definitions.size === 2048 || !['paragraph','character','table','numbering'].includes(type)) error('UNSUPPORTED_STYLE', 'Unsupported or excessive style definitions.'); current = {id, type, props:{}}; if (type === 'table' || type === 'numbering') report.add('source-style-unrepresented'); if (onOff(attr(event, 'default') ?? '0')) defaults[type] = id; }
      else if (event.name === 'pPr' || event.name === 'rPr') propertyDepth = event.depth;
      else if (current && event.name === 'basedOn') property(event, current.props, report);
      else if (propertyDepth && event.depth > propertyDepth) property(event, current ? current.props : inDefaults ? defaults : {}, report);
    } else if (event.type === 'end') { if (event.name === 'style') { env.charge(current); definitions.set(current.id, current); current = null; } if (event.depth === propertyDepth) propertyDepth = 0; if (event.name === 'docDefaults') inDefaults = false; }
  }, env);
  env.charge(defaults); const cache = new Map();
  function resolve(id, expected, chain = []) {
    if (!id) return {}; const key = `${expected}|${id}`; if (cache.has(key)) return cache.get(key);
    if (chain.includes(id) || chain.length === 16) error('UNSUPPORTED_STYLE', 'Cyclic or excessive style inheritance.');
    const style = definitions.get(id); if (!style || style.type !== expected) error('UNSUPPORTED_STYLE', 'A required style definition is missing or has another type.');
    const base = resolve(style.props.basedOn, expected, [...chain, id]), result = apply(base, style.props, true); env.charge([key,result]); cache.set(key, result); return result;
  }
  // Resolve even unused styles to bound cycles deterministically.
  let resolvedCount = 0;
  for (const value of definitions.values()) { resolve(value.id, value.type); if (++resolvedCount % 256 === 0) { await pause(); check(env.signal); } }
  return {paragraph(id) { return apply(defaults, resolve(id || defaults.paragraph, 'paragraph'), true); }, character(id) { return resolve(id || defaults.character, 'character'); }};
}
async function numbering(bytes, env, report) {
  const abstracts = new Map(), numbers = new Map(); let abstract = null, num = null, override = null, level = null;
  if (bytes) await readAdmittedXml(bytes, event => {
    if (event.type === 'start' && event.depth === 1 && (event.ns !== W || event.name !== 'numbering')) error('PACKAGE', 'Invalid numbering root.');
    if (event.ns !== W) return;
    if (event.type === 'start') {
      const val = attr(event, 'val');
      if (event.name === 'abstractNum') { const id = integer(attr(event, 'abstractNumId')); if (abstracts.has(id) || abstracts.size === 256) error('UNSUPPORTED_NUMBERING', 'Duplicate or excessive abstract numbering.'); abstract = {id, levels:new Map()}; }
      else if (event.name === 'num') { const id = integer(attr(event, 'numId'), 1); if (numbers.has(id) || numbers.size === 512) error('UNSUPPORTED_NUMBERING', 'Duplicate or excessive numbering instances.'); num = {id, overrides:new Map()}; }
      else if (event.name === 'abstractNumId' && num) num.abstract = integer(val);
      else if (event.name === 'lvlOverride' && num) { const index = integer(attr(event, 'ilvl'), 0, 8); if (num.overrides.has(index)) error('UNSUPPORTED_NUMBERING', 'Duplicate level override.'); override = {index}; }
      else if (event.name === 'startOverride' && override) override.start = integer(val, 1);
      else if (event.name === 'lvl') level = {index:integer(attr(event, 'ilvl'), 0, 8), start:1, format:'decimal'};
      else if (level && event.name === 'start') level.start = integer(val, 1);
      else if (level && event.name === 'numFmt') level.format = val;
      else if (level && event.name === 'lvlText') level.text = val;
      else if (level && event.name === 'lvlRestart') level.restart = integer(val, 0, 9);
      else if (level && event.name === 'pPr') report.add('office-layout-unrepresented');
      else if (level && event.name === 'rFonts') report.add('source-font-face-unrepresented');
      else if (['numPicBullet','lvlPicBulletId','numStyleLink','styleLink','isLgl','suff'].includes(event.name)) error('UNSUPPORTED_NUMBERING', 'Picture, linked or nonstandard numbering semantics are unsupported.');
    } else if (event.type === 'end') {
      if (event.name === 'lvl') { if (!level || !['decimal','bullet'].includes(level.format) || level.text !== (level.format === 'decimal' ? `%${level.index + 1}.` : '•') || level.restart !== undefined && level.restart !== 0 && level.restart !== level.index) error('UNSUPPORTED_NUMBERING', 'Unsupported numbering format, marker or restart rule.'); if (override) { if (level.index !== override.index) error('UNSUPPORTED_NUMBERING', 'Override level identity disagrees.'); override.level = level; } else { if (!abstract || abstract.levels.has(level.index)) error('UNSUPPORTED_NUMBERING', 'Invalid numbering level.'); abstract.levels.set(level.index, level); } level = null; }
      if (event.name === 'lvlOverride') { env.charge(override); num.overrides.set(override.index, override); override = null; }
      if (event.name === 'abstractNum') { env.charge([abstract.id, [...abstract.levels]]); abstracts.set(abstract.id, abstract); abstract = null; }
      if (event.name === 'num') { env.charge([num.id, num.abstract]); numbers.set(num.id, num); num = null; }
    }
  }, env);
  for (const instance of numbers.values()) if (!abstracts.has(instance.abstract)) error('UNSUPPORTED_NUMBERING', 'A numbering instance has no abstract definition.');
  return {level(id, index) { const instance = numbers.get(id), base = abstracts.get(instance?.abstract)?.levels.get(index), override = instance?.overrides.get(index); if (!instance || !base && !override?.level) error('UNSUPPORTED_NUMBERING', 'A required numbering level is missing.'); return {...(override?.level || base), ...(override?.start === undefined ? {} : {start:override.start})}; }};
}
function counters() {
  let paragraphs = 0, runs = 0, text = 0, rows = 0, cells = 0, tables = 0, cost = jsonBytes({version:1,origin:'docx',pages:[],lists:[],blocks:[],assets:[],warnings:[]});
  const lengths = {blocks:0,assets:0,lists:0};
  const charge = bytes => { if (cost + bytes > DOCUMENT_LIMITS.modelBytes) throw new RangeError('DOCX model exceeds 16 MiB.'); cost += bytes; };
  return {
    paragraph() { if (++paragraphs > 10000) throw new RangeError('DOCX exceeds 10000 paragraphs.'); },
    run(value) { if (++runs > 50000) throw new RangeError('DOCX exceeds 50000 runs.'); this.text(value); },
    text(value) { if ((text += value.length) > 1000000) throw new RangeError('DOCX exceeds one million UTF-16 text units.'); },
    row(index) { if (++rows > 10000) throw new RangeError('DOCX exceeds 10000 aggregate rows.'); charge(2 + (index ? 1 : 0)); },
    cell(index) { if (++cells > 200000) throw new RangeError('DOCX exceeds 200000 cells.'); charge(jsonBytes({paragraphs:[]}) + (index ? 1 : 0)); },
    cellParagraph(value, index) { charge(jsonBytes(value) + (index ? 1 : 0)); },
    width(value, index) { charge(String(value).length + (index ? 1 : 0)); },
    table(value) { if (++tables > 500) throw new RangeError('DOCX exceeds 500 tables.'); this.append(value); },
    append(value, bucket = 'blocks') { const max = bucket === 'blocks' ? 10548 : bucket === 'assets' ? 48 : 10000; if (lengths[bucket] === max) throw new RangeError(`DOCX exceeds its ${bucket} count limit.`); charge(jsonBytes(value) + (lengths[bucket] ? 1 : 0)); lengths[bucket]++; },
    bytes() { return cost; }
  };
}
export async function readDocxDocument(input, settings = {}) {
  const {signal, onProgress} = record(settings, ['signal','onProgress'], 'DOCX read options'); if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function.');
  check(signal); let archive = null; const owned = [], report = reports();
  try {
    archive = await admitOoxmlArchive(input, {kind:'docx', signal, onProgress}); check(signal);
    const env = {signal, context:{bindings:new Set()}, charge:metadataBudget()}, parts = archive.parts;
    const roots = await relationships(parts.get('_rels/.rels'), '', env), main = [...roots.values()].filter(rel => rel.type === `${R}/officeDocument`);
    if (main.length !== 1 || main[0].external || main[0].target !== 'word/document.xml' || !parts.has('word/document.xml')) error('PACKAGE', 'Only the standard local Word document part is supported.');
    let contentType = false; const overrides = new Map(), extensions = new Map();
    await readAdmittedXml(parts.get('[Content_Types].xml'), event => {
      if (event.type !== 'start') return;
      if (event.depth === 1 && (event.ns !== CT || event.name !== 'Types')) error('PACKAGE', 'Invalid content-types root.');
      if (event.ns === CT && ['Override','Default'].includes(event.name)) {
        const override = event.name === 'Override', name = attr(event, override ? 'PartName' : 'Extension', ''), type = attr(event, 'ContentType', ''), map = override ? overrides : extensions;
        if (!name || encoder.encode(name).length > 1024 || !type || type.length > 1024 || overrides.size + extensions.size === 512 || map.has(name) || !override && !/^[A-Za-z0-9]{1,100}$/.test(name)) error('PACKAGE', 'Invalid or excessive content-type records.');
        env.charge([name,type]); map.set(name,type); if (override && name === '/word/document.xml') contentType = type === `${DOCX_MIME}.main+xml`;
      }
    }, env);
    if (!contentType) error('PACKAGE', 'The main Word content type is missing or unsupported.');
    const rels = await relationships(parts.get('word/_rels/document.xml.rels'), 'word/document.xml', env);
    for (const rel of rels.values()) { if (rel.type === `${R}/header` || rel.type === `${R}/footer`) report.add('header-footer-omitted'); if (rel.type === `${R}/footnotes` || rel.type === `${R}/endnotes` || rel.type === `${R}/comments`) report.add('notes-omitted'); }
    const partType = name => overrides.get(`/${name}`) || extensions.get(name.split('.').pop());
    function linkedPart(type, conventional) { const matches = [...rels.values()].filter(rel => rel.type === `${R}/${type}`); if (matches.length > 1 || matches.some(rel => rel.external || rel.target !== conventional || !parts.has(conventional) || partType(conventional) !== `application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml`)) error('PACKAGE', 'Only standard correctly typed local style/numbering parts are supported.'); return matches.length ? parts.get(conventional) : undefined; }
    const style = await styles(linkedPart('styles', 'word/styles.xml'), env, report), nums = await numbering(linkedPart('numbering', 'word/numbering.xml'), env, report), count = counters();
    const model = {version:1, origin:'docx', pages:[], lists:[], blocks:[], assets:[], warnings:[]}, assets = [], assetByPath = new Map(), listStates = new Map();
    let id = 0, paragraph = null, run = null, table = null, row = null, cell = null, textDepth = 0, drawing = null, propertyScope = null, root = false, body = false, bodySeen = false, assetBytes = 0;
    const next = prefix => `${prefix}${++id}`;
    const append = block => { count.append(block); model.blocks.push(block); };
    function listFor(props) {
      if (!props.numId) return null; const index = props.ilvl || 0, level = nums.level(props.numId, index); let state = listStates.get(props.numId);
      if (!state) { state = {values:[], lists:new Map()}; listStates.set(props.numId, state); }
      let definition = state.lists.get(index); if (!definition) { definition = {id:next('l'), ordered:level.format === 'decimal', start:level.start}; count.append(definition, 'lists'); model.lists.push(definition); state.lists.set(index, definition); }
      const restart = state.values[index] === undefined, value = restart ? level.start : state.values[index] + 1; if (value > 1000000) error('UNSUPPORTED_NUMBERING', 'A list value exceeds one million.'); state.values[index] = value;
      for (let deeper = index + 1; deeper < 9; deeper++) { try { if (nums.level(props.numId, deeper).restart !== 0) state.values[deeper] = undefined; } catch (reason) { if (reason.code !== 'DOCX_UNSUPPORTED_NUMBERING') throw reason; } }
      return {id:definition.id, level:index, value, restart};
    }
    function image(segment) {
      const rel = rels.get(segment.rel); if (!rel || rel.type !== `${R}/image`) error('UNSUPPORTED_ASSET', 'An embedded image relationship is missing.');
      if (rel.external) { report.add('external-image-blocked'); if (segment.alt) { count.run(segment.alt); return {text:segment.alt, style:'regular', direction:'auto'}; } return null; }
      const assetKey = JSON.stringify([rel.target,segment.alt || '']); let asset = assetByPath.get(assetKey);
      if (!asset) { const bytes = parts.get(rel.target), type = /\.png$/i.test(rel.target) ? 'image/png' : /\.jpe?g$/i.test(rel.target) ? 'image/jpeg' : null; if (!bytes || !type || partType(rel.target) !== type || !/^word\/media\//.test(rel.target)) error('UNSUPPORTED_ASSET', 'An embedded image is missing, mistyped or unsupported.'); if (assets.length === 48 || assetBytes + bytes.length > 48 * MiB) throw new RangeError('Embedded images exceed their retained budget.'); const dims = imageDimensions(bytes, type); asset = {id:next('a'), type, ...dims, alt:segment.alt || ''}; count.text(asset.alt); count.append(asset, 'assets'); assetBytes += bytes.length; assets.push({asset, source:bytes}); model.assets.push(asset); assetByPath.set(assetKey, asset); }
      if (!Number.isFinite(segment.width) || !Number.isFinite(segment.height) || segment.width <= 0 || segment.height <= 0 || segment.width > 14400 || segment.height > 14400) error('UNSUPPORTED_ASSET', 'An image has missing or unsupported physical extents.');
      report.add('inline-image-block-normalized'); return {id:next('i'), kind:'image', assetId:asset.id, width:segment.width, height:segment.height};
    }
    function finishParagraph() {
      const props = apply(style.paragraph(paragraph.props.pStyle), paragraph.props), list = listFor(props); let runs = [];
      if (list && props.outline < 6) report.add('source-style-unrepresented');
      const save = () => { count.paragraph(); const block = {id:next('p'), kind:list ? 'list-item' : props.outline < 6 ? 'heading' : props.code ? 'code' : 'paragraph', direction:props.bidi === undefined ? 'auto' : props.bidi ? 'rtl' : 'ltr', runs, ...(list ? {list} : props.outline < 6 ? {level:props.outline + 1} : {})}; if (cell) { count.cellParagraph(block, cell.paragraphs.length); cell.paragraphs.push(block); } else append(block); runs = []; };
      for (const segment of paragraph.segments) {
        if (segment.kind === 'drawing') { if (cell || list) error('UNSUPPORTED_ASSET', 'Images inside table cells or numbered paragraphs are unsupported.'); const result = image(segment); if (result?.text !== undefined) runs.push(result); else if (result) { if (runs.length) save(); append(result); } }
        else if (segment.kind === 'break') { if (cell || list) error('UNSUPPORTED_STRUCTURE', 'Page breaks inside tables or lists are unsupported.'); if (runs.length) save(); append({id:next('b'), kind:'page-break'}); }
        else {
          let resolved = apply(props, style.character(segment.props.rStyle), true); resolved = apply(resolved, segment.props);
          const hasComplex = /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(segment.text), different = !!resolved.bCs !== !!resolved.b || !!resolved.iCs !== !!resolved.i;
          const mixed = hasComplex && [...segment.text].some(char => /\p{L}/u.test(char) && !/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(char));
          if (!resolved.cs && resolved.rtl === undefined && mixed && different) error('UNSUPPORTED_STYLE', 'Mixed implicit complex-script styles need a logical span distinction outside this subset.');
          const complex = resolved.cs || (resolved.rtl === undefined ? hasComplex : resolved.rtl), bold = complex ? resolved.bCs : resolved.b, italic = complex ? resolved.iCs : resolved.i;
          if (resolved.code && (bold || italic)) error('UNSUPPORTED_STYLE', 'Combined monospace and bold/italic styling has no exact model style.');
          runs.push({text:segment.text, style:resolved.code ? 'code' : bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular', direction:resolved.rtl === undefined ? 'auto' : resolved.rtl ? 'rtl' : 'ltr'});
        }
      }
      if (paragraph.rule && !paragraph.segments.length && !cell && !list) append({id:next('r'), kind:'rule'}); else if (runs.length || !paragraph.segments.length) save(); paragraph = null;
    }
    await readAdmittedXml(parts.get('word/document.xml'), event => {
      const start = event.type === 'start', end = event.type === 'end';
      if (event.type === 'text') { if (textDepth && run) { count.text(event.text); run.text += event.text; } return; }
      if (start && event.depth === 1) { root = event.ns === W && event.name === 'document'; if (!root) error('PACKAGE', 'Invalid Word document namespace.'); }
      if (event.ns === W) {
        if (start) {
          if (event.name === 'body') { if (bodySeen || event.depth !== 2) error('PACKAGE', 'The document must have one direct body.'); body = true; bodySeen = true; }
          else if (['fldSimple','fldChar','instrText'].includes(event.name)) error('UNSUPPORTED_FIELD', 'Word fields and their dynamic instructions are unsupported in this subset.');
          else if (['del','ins','moveFrom','moveTo','altChunk','object','pict','txbxContent','subDoc','footnoteReference','endnoteReference'].includes(event.name)) error('UNSUPPORTED_STRUCTURE', 'Tracked changes or embedded Office structures are unsupported.');
          else if (event.name === 'tbl') { if (table || paragraph) error('UNSUPPORTED_TABLE', 'Nested tables are unsupported.'); table = {id:next('t'), kind:'table', columnWidths:[], rows:[]}; count.table(table); }
          else if (event.name === 'gridCol' && table) { if (table.columnWidths.length === 100) throw new RangeError('Table exceeds 100 columns.'); const width = integer(attr(event, 'w'), 1) / 20; count.width(width, table.columnWidths.length); table.columnWidths.push(width); }
          else if (event.name === 'tr' && table) { count.row(table.rows.length); row = []; }
          else if (event.name === 'tc' && table) { if (!row || cell) error('UNSUPPORTED_TABLE', 'Malformed table cell structure.'); count.cell(row.length); if (row.length === 100) throw new RangeError('Table exceeds 100 columns.'); cell = {paragraphs:[]}; }
          else if (['gridSpan','vMerge','hMerge','gridBefore','gridAfter'].includes(event.name)) error('UNSUPPORTED_TABLE', 'Merged or offset table cells are unsupported.');
          else if (event.name === 'p' && body) { if (paragraph || table && !cell) error('UNSUPPORTED_STRUCTURE', 'Nested or misplaced paragraphs are unsupported.'); paragraph = {props:{}, segments:[]}; }
          else if (event.name === 'r' && paragraph) { if (run) error('UNSUPPORTED_STRUCTURE', 'Nested runs are unsupported.'); run = {props:{}, text:''}; }
          else if (['pPr','rPr'].includes(event.name) && paragraph) propertyScope = {depth:event.depth, target:run ? run.props : paragraph.props};
          else if (propertyScope && event.depth > propertyScope.depth) { if (event.name === 'bottom') paragraph.rule = true; property(event, propertyScope.target, report); }
          else if (event.name === 't') { if (!run) error('UNSUPPORTED_STRUCTURE', 'Text outside a supported Word run is unsupported.'); textDepth = event.depth; }
          else if (event.name === 'tab' && run) { count.text('\t'); run.text += '\t'; }
          else if (event.name === 'br' && run) { const type = attr(event, 'type'); if (type === 'page') { if (run.text) { count.run(''); paragraph.segments.push({...run}); run.text = ''; } paragraph.segments.push({kind:'break'}); } else if (type === undefined || type === 'textWrapping') { count.text('\n'); run.text += '\n'; } else error('UNSUPPORTED_STRUCTURE', 'Column breaks are unsupported.'); }
          else if (event.name === 'cr' && run) { count.text('\n'); run.text += '\n'; }
          else if (event.name === 'drawing' && run) { if (drawing) error('UNSUPPORTED_ASSET', 'Nested drawings are unsupported.'); if (run.text) { count.run(''); paragraph.segments.push({...run}); run.text = ''; } drawing = {kind:'drawing'}; }
          else if (event.name === 'hyperlink') report.add('hyperlink-unrepresented');
          else if (event.name === 'tblStyle') report.add('source-style-unrepresented');
          else if (event.name === 'sectPr') report.add('office-layout-unrepresented');
          else if (event.name === 'sym' || event.name === 'noBreakHyphen' || event.name === 'softHyphen') error('UNSUPPORTED_STRUCTURE', 'Symbol and special hyphen runs are unsupported.');
        } else if (end) {
          if (event.name === 't' && event.depth === textDepth) textDepth = 0;
          if (propertyScope?.depth === event.depth) propertyScope = null;
          if (event.name === 'drawing' && drawing) { if (!drawing.rel || !drawing.picture || !drawing.graphic) error('UNSUPPORTED_ASSET', 'A drawing has no supported picture structure.'); paragraph.segments.push(drawing); drawing = null; }
          if (event.name === 'r' && run) { if (run.text || !paragraph.segments.length) { count.run(''); paragraph.segments.push(run); } run = null; }
          if (event.name === 'p' && paragraph) finishParagraph();
          if (event.name === 'tc' && cell) { row.push(cell); cell = null; }
          if (event.name === 'tr' && row) { table.rows.push(row); row = null; }
          if (event.name === 'tbl' && table) { if (!table.columnWidths.length) { const columns = table.rows[0]?.length; if (!columns) error('UNSUPPORTED_TABLE', 'An empty table has no grid.'); for (let index = 0; index < columns; index++) { count.width(1, index); table.columnWidths.push(1); } report.add('column-width-inferred', table.id); } if (table.rows.some(value => value.length !== table.columnWidths.length)) error('UNSUPPORTED_TABLE', 'Ragged table cells are unsupported.'); model.blocks.push(table); table = null; }
          if (event.name === 'body') body = false;
        }
      } else if (start && drawing && event.ns === WP && event.name === 'extent') { if (drawing.width !== undefined) error('UNSUPPORTED_ASSET', 'Multiple picture extents are unsupported.'); drawing.width = integer(attr(event, 'cx', ''), 1, 182880000) / 12700; drawing.height = integer(attr(event, 'cy', ''), 1, 182880000) / 12700; }
      else if (start && drawing && event.ns === WP && event.name === 'docPr') { drawing.alt = attr(event, 'descr', '') || attr(event, 'title', '') || ''; if (drawing.alt.length > 10000) throw new RangeError('Image alternate text exceeds 10000 units.'); }
      else if (start && drawing && event.ns === A && event.name === 'graphicData') { if (attr(event, 'uri', '') !== 'http://schemas.openxmlformats.org/drawingml/2006/picture') error('UNSUPPORTED_ASSET', 'Non-picture graphic data is unsupported.'); drawing.graphic = true; }
      else if (start && drawing && event.ns === 'http://schemas.openxmlformats.org/drawingml/2006/picture' && event.name === 'pic') drawing.picture = true;
      else if (start && drawing && event.ns === A && event.name === 'srcRect' && [...event.attrs.values()].some(value => value !== '0')) error('UNSUPPORTED_ASSET', 'Cropped pictures are unsupported.');
      else if (start && drawing && event.ns === A && event.name === 'xfrm' && ['rot','flipH','flipV'].some(name => { const value = attr(event, name, ''); return value !== undefined && !['0','false'].includes(value); })) error('UNSUPPORTED_ASSET', 'Rotated or reflected pictures are unsupported.');
      else if (start && drawing && event.ns === A && event.name === 'prstGeom' && attr(event, 'prst', '') !== 'rect') error('UNSUPPORTED_ASSET', 'Non-rectangular picture geometry is unsupported.');
      else if (start && drawing && event.ns === A && event.name === 'blip') { if (drawing.rel) error('UNSUPPORTED_ASSET', 'Multiple image fills in one drawing are unsupported.'); drawing.rel = attr(event, 'embed', R) || attr(event, 'link', R); }
      else if (start && event.ns === 'http://schemas.openxmlformats.org/officeDocument/2006/math') error('UNSUPPORTED_STRUCTURE', 'Office math objects are unsupported.');
    }, env);
    check(signal); if (!root || !bodySeen || paragraph || run || table || body) error('PACKAGE', 'The Word document structure is incomplete.');
    const validated = validateDocumentModel(model, {signal}), modelSize = jsonBytes(validated), total = archive.bytes.length + modelSize + assetBytes, resources = 2 + assets.length;
    if (count.bytes() !== modelSize) throw new Error('Document model incremental byte accounting mismatch.');
    if (total > 96 * MiB || resources > 128) throw new RangeError('The document bundle exceeds 96 MiB/128 resources.');
    await pause(); check(signal);
    const modelBytes = encoder.encode(JSON.stringify(validated)); owned.push(modelBytes);
    const sourceBytes = new Uint8Array(archive.bytes.length); byteSet.call(sourceBytes, archive.bytes); owned.push(sourceBytes);
    const finalAssets = assets.map(({asset, source}) => { const bytes = new Uint8Array(source.length); byteSet.call(bytes, source); owned.push(bytes); return {id:asset.id, type:asset.type, bytes, width:asset.width, height:asset.height}; });
    await pause(); check(signal);
    let disposed = false; return {model:validated, modelBytes, sourceBytes, assets:finalAssets, report:report.values, usage:{bytes:total, resources, modelBytes:modelSize, assetBytes}, dispose() { if (disposed) return; disposed = true; for (const bytes of owned) bytes.fill(0); owned.length = 0; }};
  } catch (reason) { for (const bytes of owned) bytes.fill(0); check(signal); throw reason; }
  finally { archive?.dispose(); }
}

// Generated parts use the same package-wide limits as admission. The scanner
// below counts emitted nodes, not downstream DOM allocations or source schema.
function xmlBuilder(shared) {
  const chunks = []; let bytes = 0, textNode = false;
  return {add(value) { const size = encoder.encode(value).length; if (bytes + size > 8 * MiB || shared.bytes + size > 16 * MiB) throw new RangeError('Generated XML exceeds 8/16 MiB.'); bytes += size; shared.bytes += size;
    for (const token of value.matchAll(/<[^>]*>|[^<]+/g)) { const part = token[0]; if (part[0] === '<') { textNode = false; if (!part.startsWith('</')) shared.nodes++; } else if (!textNode) { shared.nodes++; textNode = true; } if (shared.nodes > 100000) throw new RangeError('Generated XML exceeds 100000 package nodes.'); } chunks.push(value); }, bytes() { return encoder.encode(chunks.join('')); }};
}
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export async function buildDocxDocument(input, settings = {}) {
  const {assets:assetInput = [], paper = 'letter', landscape = false, margin = 56, signal, onProgress} = record(settings, ['assets','paper','landscape','margin','signal','onProgress'], 'DOCX build options');
  if (!['letter','a4'].includes(paper) || typeof landscape !== 'boolean' || !Number.isFinite(margin) || margin < 0 || margin > 72 || onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('Invalid DOCX paper, margin or progress options.');
  check(signal); const model = validateDocumentModel(input, {signal}), owned = [], files = [], report = reports(), shared = {bytes:0, nodes:0}; let result = null;
  try {
    if (model.lists.length > 256) throw new RangeError('Generated numbering exceeds 256 abstract definitions.');
    const supplied = dense(assetInput, 48), assetMap = new Map(), expected = new Map(model.assets.map(asset => [asset.id, asset])); let assetBytes = 0;
    for (const raw of supplied) { const entry = record(raw, ['id','type','bytes','width','height'], 'DOCX asset'); if (!expected.has(entry.id) || assetMap.has(entry.id)) error('UNSUPPORTED_ASSET', 'Missing, duplicate or unexpected image asset.'); const definition = expected.get(entry.id); if (entry.type !== definition.type || entry.width !== definition.width || entry.height !== definition.height) error('UNSUPPORTED_ASSET', 'Asset metadata does not match its model.'); const bytes = await copyBytes(entry.bytes, signal, Math.min(48 * MiB,32 * MiB - 22) - assetBytes); owned.push(bytes); const dims = imageDimensions(bytes, entry.type); if (dims.width !== entry.width || dims.height !== entry.height) error('UNSUPPORTED_ASSET', 'Asset pixel dimensions disagree with its bytes.'); assetBytes += bytes.length; assetMap.set(entry.id, {bytes, path:`media/image${assetMap.size + 1}.${entry.type === 'image/png' ? 'png' : 'jpg'}`, relation:`image${assetMap.size + 1}`}); }
    if (assetMap.size !== expected.size) error('UNSUPPORTED_ASSET', 'Required image bytes are missing.');
    const make = () => xmlBuilder(shared), document = make(), numberingXml = make(), stylesXml = make(), rels = make(), types = make(), packageRels = make();
    const abstracts = new Map(model.lists.map((list, i) => [list.id, {id:i + 1, list}])), active = new Map(), instances = []; let work = 0, elements = 0, drawId = 0, completed = 0;
    const cooperative = async units => { work += units; if (work >= 65536 || ++elements >= 256) { work = 0; elements = 0; await pause(); check(signal); } };
    function listReference(block) { const reference = block.list, definition = abstracts.get(reference.id); let state = active.get(reference.id); if (!state) { state = {values:[], instance:null, blockedAncestors:new Set()}; active.set(reference.id, state); }
      if (!reference.restart && state.blockedAncestors.has(reference.level)) error('UNSUPPORTED_NUMBERING', 'This subset cannot continue an ancestor across a nested concrete-instance restart.');
      const expectedValue = state.values[reference.level] === undefined ? definition.list.start : state.values[reference.level] + 1;
      if (!reference.restart && reference.value !== expectedValue) error('UNSUPPORTED_NUMBERING', 'This subset cannot preserve the requested non-restarting list continuation.');
      const instance = state.instance, firstAfterReset = state.values[reference.level] === undefined;
      const wordValue = firstAfterReset ? instance?.starts.get(reference.level) ?? definition.list.start : expectedValue;
      if (!reference.restart && reference.value !== wordValue) error('UNSUPPORTED_NUMBERING', 'A non-restarting value conflicts with the concrete level start.');
      if (!instance || reference.restart && !firstAfterReset || instance.used.has(reference.level) && reference.value !== wordValue) {
        if (instances.length === 512) throw new RangeError('Generated numbering exceeds 512 instances.');
        for (let ancestor=0;ancestor<reference.level;ancestor++) if (state.values[ancestor] !== undefined) state.blockedAncestors.add(ancestor);
        state.instance = {id:instances.length + 1, abstract:definition.id, starts:new Map(), used:new Set()};
        state.values = []; instances.push(state.instance);
      }
      // A first-use level can receive its own override without restarting its
      // already-used parent. Never change a used level's global start: that
      // would retroactively renumber earlier paragraphs sharing this numId.
      if (!state.instance.used.has(reference.level)) state.instance.starts.set(reference.level, reference.value);
      state.instance.used.add(reference.level);
      if (reference.restart) for (let level=reference.level;level<9;level++) state.blockedAncestors.delete(level);
      state.values[reference.level] = reference.value; for (let i = reference.level + 1; i < 9; i++) state.values[i] = undefined;
      return `<w:numPr><w:ilvl w:val="${reference.level}"/><w:numId w:val="${state.instance.id}"/></w:numPr>`;
    }
    async function paragraph(block) {
      if (block.kind === 'code' && block.runs.some(run => run.style !== 'code')) error('UNSUPPORTED_STYLE', 'A code paragraph requires explicit code runs in this subset.');
      let props = block.kind === 'heading' ? `<w:pStyle w:val="Heading${block.level}"/>` : block.kind === 'code' ? '<w:pStyle w:val="Code"/>' : '';
      if (block.direction !== 'auto') props += `<w:bidi w:val="${block.direction === 'rtl' ? 1 : 0}"/>`;
      if (block.kind === 'list-item') props += listReference(block);
      document.add(`<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}`);
      for (const run of block.runs) { check(signal); let properties = ''; if (['bold','boldItalic'].includes(run.style)) properties += '<w:b/><w:bCs/>'; if (['italic','boldItalic'].includes(run.style)) properties += '<w:i/><w:iCs/>'; if (run.style === 'code') properties += '<w:rStyle w:val="CodeRun"/>'; if (run.direction !== 'auto') properties += `<w:rtl w:val="${run.direction === 'rtl' ? 1 : 0}"/>`; document.add(`<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}`);
        let start = 0;
        while (start < run.text.length) {
          let end = start;
          while (end < run.text.length && end - start < 16384 && run.text[end] !== '\t' && run.text[end] !== '\n') end++;
          if (end < run.text.length && end > start && /[\uDC00-\uDFFF]/.test(run.text[end])) end--;
          if (end > start) document.add(`<w:t xml:space="preserve">${xml(run.text.slice(start,end))}</w:t>`);
          else { document.add(run.text[start] === '\t' ? '<w:tab/>' : '<w:br/>'); end++; }
          await cooperative(end - start); start = end;
        }
        document.add('</w:r>'); }
      document.add('</w:p>'); await cooperative(0);
    }
    document.add(`${declaration}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>`);
    for (const block of model.blocks) { check(signal);
      if (['paragraph','heading','list-item','code'].includes(block.kind)) await paragraph(block);
      else if (block.kind === 'table') { const sum = block.columnWidths.reduce((a,b) => a + b, 0), widths = block.columnWidths.map(value => Math.max(1, Math.round(value / sum * 9000))); document.add(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`); for (const row of block.rows) { document.add('<w:tr>'); for (let i = 0; i < row.length; i++) { document.add(`<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/></w:tcPr>`); if (!row[i].paragraphs.length) document.add('<w:p/>'); for (const p of row[i].paragraphs) await paragraph(p); document.add('</w:tc>'); await cooperative(0); } document.add('</w:tr>'); } document.add('</w:tbl>'); }
      else if (block.kind === 'image') { const asset = assetMap.get(block.assetId), definition = expected.get(block.assetId), cx = Math.round(block.width * 12700), cy = Math.round(block.height * 12700); drawId++; document.add(`<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${drawId}" name="Image${drawId}" descr="${xml(definition.alt)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${drawId}" name="Image${drawId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${asset.relation}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`); }
      else if (block.kind === 'page-break') document.add('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      else if (block.kind === 'rule') document.add('<w:p><w:pPr><w:pBdr><w:bottom w:val="single"/></w:pBdr></w:pPr></w:p>');
      await cooperative(0); onProgress?.({completed:++completed, total:model.blocks.length});
    }
    let [width, height] = paper === 'a4' ? [11906,16838] : [12240,15840]; if (landscape) [width,height] = [height,width]; const m = Math.round(margin * 20);
    document.add(`<w:sectPr><w:pgSz w:w="${width}" w:h="${height}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}"/></w:sectPr></w:body></w:document>`);
    numberingXml.add(`${declaration}<w:numbering xmlns:w="${W}">`);
    if (abstracts.size > 256) throw new RangeError('Generated numbering exceeds 256 abstract definitions.');
    for (const {id, list} of abstracts.values()) { numberingXml.add(`<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>`); for (let level = 0; level < 9; level++) numberingXml.add(`<w:lvl w:ilvl="${level}"><w:start w:val="${list.start}"/><w:numFmt w:val="${list.ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${list.ordered ? `%${level + 1}.` : '•'}"/></w:lvl>`); numberingXml.add('</w:abstractNum>'); await cooperative(0); }
    for (const instance of instances) { numberingXml.add(`<w:num w:numId="${instance.id}"><w:abstractNumId w:val="${instance.abstract}"/>`); for (const [level,start] of [...instance.starts].sort((a,b)=>a[0]-b[0])) numberingXml.add(`<w:lvlOverride w:ilvl="${level}"><w:startOverride w:val="${start}"/></w:lvlOverride>`); numberingXml.add('</w:num>'); } numberingXml.add('</w:numbering>');
    stylesXml.add(`${declaration}<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="character" w:styleId="CodeRun"><w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr></w:style>`); for (let i = 1; i <= 6; i++) stylesXml.add(`<w:style w:type="paragraph" w:styleId="Heading${i}"><w:pPr><w:outlineLvl w:val="${i - 1}"/></w:pPr></w:style>`); stylesXml.add('</w:styles>');
    rels.add(`${declaration}<Relationships xmlns="${REL}"><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="numbering" Type="${R}/numbering" Target="numbering.xml"/>`); for (const asset of assetMap.values()) rels.add(`<Relationship Id="${asset.relation}" Type="${R}/image" Target="${asset.path}"/>`); rels.add('</Relationships>');
    packageRels.add(`${declaration}<Relationships xmlns="${REL}"><Relationship Id="document" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
    types.add(`${declaration}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`);
    for (const [name, builder] of [['[Content_Types].xml',types],['_rels/.rels',packageRels],['word/document.xml',document],['word/styles.xml',stylesXml],['word/numbering.xml',numberingXml],['word/_rels/document.xml.rels',rels]]) { const data = builder.bytes(); owned.push(data); files.push({name, data}); }
    for (const asset of assetMap.values()) files.push({name:`word/${asset.path}`, data:asset.bytes});
    const size = 22 + files.reduce((sum, file) => sum + 76 + 2 * encoder.encode(file.name).length + file.data.length, 0);
    if (size > 32 * MiB || files.length > 512) throw new RangeError('Generated DOCX exceeds its 32 MiB/512 part limit.');
    await pause(); check(signal); result = zipStore(files); if (result.length !== size) throw new Error('Stored ZIP preflight size mismatch.'); await pause(); check(signal);
    return {bytes:result, type:DOCX_MIME, report:report.values, usage:{bytes:size, resources:1, xmlBytes:shared.bytes, assetBytes}};
  } catch (reason) { result?.fill(0); check(signal); throw reason; }
  finally { for (const bytes of owned) bytes.fill(0); }
}
