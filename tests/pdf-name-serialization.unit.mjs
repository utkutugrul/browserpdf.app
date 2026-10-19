import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { normalizePdfNameEscapeCase, normalizeFragment } from '../public/js/core/pdf-name-serialization.js';
globalThis.crypto ??= webcrypto;
const bytes = text => new Uint8Array(Buffer.from(text, 'latin1'));
const text = value => Buffer.from(value).toString('latin1');
function classic({ extra = '', body = 'q\nQ', length = String(Buffer.byteLength(body, 'latin1')), trailer = '' } = {}) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R ' + extra + ' >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>', `<< /Length ${length} >>\nstream\n${body}\nendstream`];
  let value = '%PDF-1.7\n%\x80\xff\n'; const offsets = [0];
  for (let index = 0; index < objects.length; index++) { offsets.push(Buffer.byteLength(value, 'latin1')); value += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(value, 'latin1'); value += 'xref\n0 5\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) value += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return bytes(value + `trailer\n<< /Size 5 /Root 1 0 R ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`);
}
test('only name escape hex case changes with single-pass literal hash semantics', async () => {
  const input = classic({ extra: '/Subtype /text#2fplain /Literal /text#232fplain /Real 2.0 /Names [/A#ff /B#2f]' });
  const original = new Uint8Array(input), result = await normalizePdfNameEscapeCase(input);
  assert.equal(result.bytes.length, input.length); assert.match(text(result.bytes), /\/text#2Fplain/); assert.match(text(result.bytes), /\/text#232fplain/);
  assert.equal(result.facts.changedNameTokens, 3); assert.equal(result.facts.objectCount, 4); assert.equal(result.facts.sameLength, true);
  const allowed = new Set(); for (let index = 0; index < input.length; index++) if (input[index] !== result.bytes[index]) { assert.ok(input[index] >= 97 && input[index] <= 102); assert.equal(result.bytes[index], input[index] - 32); allowed.add(index); }
  assert.ok(allowed.size > 0); assert.deepEqual(input, original); assert.deepEqual((await normalizePdfNameEscapeCase(result.bytes)).bytes, result.bytes);
});
test('raw byte 0x80 equals escaped #80, rather than WHATWG Windows-1252 Euro', async () => {
  await assert.rejects(normalizeFragment(bytes('<< /\x80 1 /#80 2 >>')), { code: 'duplicate-dictionary-key' });
  await assert.rejects(normalizeFragment(bytes('<< /A#2f 1 /A#2F 2 >>')), { code: 'duplicate-dictionary-key' });
  const input = bytes('<< /\x80 1 /\xe2\x82\xac 2 /A#232f 3 /A#2f 4 >>'), result = await normalizeFragment(input);
  assert.equal(text(result.bytes), '<< /\x80 1 /\xe2\x82\xac 2 /A#232f 3 /A#2F 4 >>');
  await assert.rejects(normalizeFragment(bytes('/#00')), { code: 'null-name' });
});
test('high bytes, comments, literal and hex strings, and fake stream syntax remain exact', async () => {
  const body = '\x00\x80\xff /Stream#2f (endstream)\nxref\n%%EOF\n';
  const input = classic({ extra: '/Name /raw\x80\xff /Literal (\x80 /text#2fplain \\(x\\)) /Hex <80FF>\n%\x80 /Comment#2f\n', body });
  const result = await normalizePdfNameEscapeCase(input); assert.deepEqual(result.bytes, input);
  assert.equal(result.facts.streams.length, 1); assert.equal(result.facts.streams[0].sha256, createHash('sha256').update(Buffer.from(body, 'latin1')).digest('hex'));
  for (const range of result.facts.preservedRanges) assert.deepEqual(result.bytes.subarray(range.start, range.end), input.subarray(range.start, range.end));
});
test('exact syntax rejects folded high bits and real tokens at integer-only positions', async () => {
  const xref = classic(), at = text(xref).indexOf('\nxref\n') + 1; xref[at] = 0xf8;
  await assert.rejects(normalizePdfNameEscapeCase(xref), { code: 'expected-xref' });
  await assert.rejects(normalizePdfNameEscapeCase(classic({ body: 'xx', length: '2.0' })), { code: 'direct-integer-stream-length' });
  await assert.rejects(normalizeFragment(bytes('1.0 0 obj\nnull\nendobj'), { object: true }), { code: 'object-number' });
  await assert.rejects(normalizeFragment(bytes('[1.0 0 R]')), { code: 'reference-integer' });
  const end = classic(); const position = text(end).indexOf('endstream'); end[position] = 0xe5;
  await assert.rejects(normalizePdfNameEscapeCase(end), { code: 'stream-end-boundary' });
  assert.equal(text((await normalizeFragment(bytes('[2.0 -.5 +3 /A#ff]'))).bytes), '[2.0 -.5 +3 /A#FF]');
});
test('unsupported serialization is rejected without recovery or byte rewriting', async () => {
  for (const [trailer, code] of [['/Encrypt 1 0 R', 'encrypted'], ['/Prev 0', 'incremental'], ['/XRefStm 0', 'hybrid-xref']]) await assert.rejects(normalizePdfNameEscapeCase(classic({ trailer })), { code });
  for (const [input, code] of [['<< /Type /ObjStm >>', 'object-stream'], ['<< /Type /XRef >>', 'xref-stream'], ['<< /Linearized 1 >>', 'linearized'], ['<< /A#gg 1 >>', 'invalid-name-escape']]) await assert.rejects(normalizeFragment(bytes(input)), { code });
  await assert.rejects(normalizePdfNameEscapeCase(classic({ length: '1 0 R' })), { code: 'indirect-stream-length' });
  await assert.rejects(normalizeFragment(bytes('[[[1]]]'), { limits: { maxDepth: 1 } }), { code: 'structural-depth-limit' });
  await assert.rejects(normalizeFragment(bytes('[1 2 3]'), { limits: { maxTokens: 2 } }), { code: 'token-limit' });
  await assert.rejects(normalizePdfNameEscapeCase(classic(), { limits: { maxBytes: 20 } }), { code: 'byte-limit' });
});
test('event-loop cancellation and stale ownership withhold output before a clean successor', async () => {
  const input = classic({ extra: '/Long (' + 'x'.repeat(140000) + ')' }), original = new Uint8Array(input);
  const stop = new AbortController(), pending = normalizePdfNameEscapeCase(input, { signal: stop.signal }); setTimeout(() => stop.abort(), 0);
  await assert.rejects(pending, { code: 'aborted' }); assert.deepEqual(input, original);
  let current = true; await assert.rejects(normalizePdfNameEscapeCase(input, { isCurrent: () => current, onYield: () => { current = false; } }), { code: 'stale' });
  assert.equal((await normalizePdfNameEscapeCase(classic())).facts.objectCount, 4);
});
