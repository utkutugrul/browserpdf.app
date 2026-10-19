// Internal structural reader for parts from this operation's completed ZIP
// admission. Admission owns XML well-formedness, encodings, DTD/entity and
// package node/byte limits. This reader adds expanded namespace semantics and
// bounded event/token storage; it is not an independent Office admission API.
const SPACE = '[ \\t\\r\\n]';
const XML = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS = 'http://www.w3.org/2000/xmlns/';
export const xmlKey = (namespace, name) => `${namespace}|${name}`;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const check = signal => signal?.throwIfAborted();
const reject = message => { throw new Error(`DOCX XML structure rejected: ${message}`); };
function characters(value, attribute = false) {
  if (attribute) value = value.replace(/[\t\n]/g, ' ');
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, name) => name[0] === '#' ? String.fromCodePoint(name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))) : ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[name]);
}
function qname(value) {
  const parts = value.split(':');
  if (parts.length > 2 || parts.some(part => !part)) reject('Invalid namespace-qualified name.');
  return parts.length === 1 ? ['', parts[0]] : parts;
}
export async function readAdmittedXml(bytes, onEvent, {signal, context = {bindings:new Set()}} = {}) {
  check(signal);
  const encoding = bytes[0] === 255 && bytes[1] === 254 || bytes[0] === 60 && bytes[1] === 0 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 || bytes[0] === 0 && bytes[1] === 60 ? 'utf-16be' : 'utf-8';
  const decoder = new TextDecoder(encoding, {fatal:true});
  const stack = [], initial = new Map([['xml', XML], ['', '']]);
  let pending = '', offset = 0, ended = false, cr = false, events = 0, work = 0;
  const emit = event => { check(signal); onEvent(event); events++; };
  function expanded(raw, bindings, attribute) {
    const [prefix, name] = qname(raw), ns = !prefix && attribute ? '' : bindings.get(prefix);
    if (ns === undefined || prefix === 'xmlns' || ns.length + name.length + 1 > 1024) reject('Unbound, reserved or excessive expanded namespace name.');
    return {ns, name};
  }
  async function fill() {
    if (ended) return false;
    const end = Math.min(bytes.length, offset + 4096);
    let value = decoder.decode(bytes.subarray(offset, end), {stream:end < bytes.length});
    offset = end; ended = offset === bytes.length;
    if (cr) { value = '\r' + value; cr = false; }
    if (!ended && value.endsWith('\r')) { value = value.slice(0, -1); cr = true; }
    pending += value.replace(/\r\n?/g, '\n'); work += 4096;
    if (work >= 65536 || events >= 256) { work = 0; events = 0; await pause(); check(signal); }
    return true;
  }
  while (!ended || pending.length) {
    check(signal);
    if (!pending.length) { await fill(); continue; }
    if (pending[0] !== '<') {
      let end = pending.indexOf('<');
      if (end < 0) end = pending.length;
      // An entity may straddle decoder chunks. Do not retain unbounded text.
      const amp = pending.lastIndexOf('&', end - 1);
      if (!ended && amp >= 0 && pending.indexOf(';', amp) >= end) end = amp;
      if (!ended && amp >= 0 && pending.indexOf(';', amp) < 0) end = amp;
      if (end) { emit({type:'text', text:characters(pending.slice(0, end)), depth:stack.length}); pending = pending.slice(end); continue; }
      if (!await fill()) reject('Incomplete character data.');
      continue;
    }
    let end = -1, kind = 'tag';
    if (pending.startsWith('<!--')) { end = pending.indexOf('-->'); if (end >= 0) end += 3; kind = 'comment'; }
    else if (pending.startsWith('<![CDATA[')) { end = pending.indexOf(']]>'); if (end >= 0) end += 3; kind = 'cdata'; }
    else if (pending.startsWith('<?')) { end = pending.indexOf('?>'); if (end >= 0) end += 2; kind = 'pi'; }
    else {
      let quote = '';
      for (let i = 1; i < pending.length; i++) { const c = pending[i]; if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') { end = i + 1; break; } }
    }
    if (end < 0) { if (pending.length > 65536) reject('A structural token exceeds 65536 UTF-16 units.'); if (!await fill()) reject('Incomplete structural token.'); continue; }
    if (end > 65536) reject('A structural token exceeds 65536 UTF-16 units.');
    const token = pending.slice(0, end); pending = pending.slice(end);
    if (kind === 'comment' || kind === 'pi') continue;
    if (kind === 'cdata') { emit({type:'text', text:token.slice(9, -3), depth:stack.length}); continue; }
    if (token.startsWith('</')) {
      const frame = stack.pop(); if (!frame) reject('Missing structural frame.');
      emit({type:'end', ns:frame.ns, name:frame.name, depth:stack.length + 1}); continue;
    }
    const name = token.match(/^<([^ \t\r\n/>]+)/)?.[1]; if (!name || name[0] === '!') reject('Unsupported structural token.');
    const parent = stack.length ? stack[stack.length - 1].bindings : initial, bindings = new Map(parent), rawAttrs = [];
    const regex = new RegExp(`${SPACE}+([^ \\t\\r\\n=/>]+)${SPACE}*=${SPACE}*(["'])([\\s\\S]*?)\\2`, 'g');
    regex.lastIndex = name.length + 1; let match;
    while ((match = regex.exec(token))) {
      const raw = match[1], value = characters(match[3], true); if (value.length > 65536) reject('Attribute value exceeds its bound.');
      if (raw === 'xmlns' || raw.startsWith('xmlns:')) {
        const prefix = raw === 'xmlns' ? '' : raw.slice(6);
        if (prefix.length > 1024 || prefix.includes(':') || value.length > 1024 || prefix === 'xmlns' || value === XMLNS || prefix === 'xml' && value !== XML || prefix !== 'xml' && value === XML || prefix && !value) reject('Contradictory namespace binding.');
        bindings.set(prefix, value); context.bindings.add(`${prefix}|${value}`);
      } else rawAttrs.push([raw, value]);
    }
    if (bindings.size > 32 || context.bindings.size > 256) reject('Namespace binding budget exceeded.');
    const element = expanded(name, bindings, false), attrs = new Map();
    for (const [raw, value] of rawAttrs) { const attr = expanded(raw, bindings, true), key = xmlKey(attr.ns, attr.name); if (attrs.has(key)) reject('Duplicate expanded attribute.'); attrs.set(key, value); }
    if (stack.length >= 64) reject('Structural stack exceeds 64 frames.');
    const frame = {...element, bindings}; stack.push(frame);
    emit({type:'start', ...element, attrs, depth:stack.length});
    if (/\/[ \t\r\n]*>$/.test(token)) { stack.pop(); emit({type:'end', ...element, depth:stack.length + 1}); }
  }
  check(signal); if (stack.length) reject('Unclosed structural frames.');
}
