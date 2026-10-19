import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readMarkdownDocument } from '../public/js/core/markdown-document.js';

const text = block => block.runs.map(run => run.text).join('');
const texts = result => result.model.blocks.filter(block => block.runs).map(text);
const has = (result, code) => result.report.some(issue => issue.code === `markdown-${code}`);
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function png() { const chunk = (type, bytes) => { const name = Buffer.from(type), out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); name.copy(out, 4); bytes.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([name,bytes])), bytes.length + 8); return out; }; const size = Buffer.alloc(13); size.writeUInt32BE(2); size.writeUInt32BE(1,4); size[8] = 8; size[9] = 2; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',size),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,0,0,255]))),chunk('IEND',Buffer.alloc(0))]); }

test('plain literal punctuation, soft lines and Unicode stay literal; raw source bytes stay exact', async () => {
  const source = '  2 * 3 * 4, snake_case [x](url) &amp;\t\r\nالسَّلَامُ שָׁלוֹם\rthird';
  const result = await readMarkdownDocument(source);
  assert.deepEqual(texts(result), ['  2 * 3 * 4, snake_case [x](url) &\t\nالسَّلَامُ שָׁלוֹם\nthird']);
  assert.equal(new TextDecoder().decode(result.sourceBytes), source);
  assert.equal(result.model.blocks[0].direction, 'auto'); assert.ok(has(result,'line-endings-normalized'));
  assert.equal(result.usage.modelBytes, result.modelBytes.length);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(result.modelBytes)), result.model);
});
test('direct headings, emphasis, code and thematic rule structure have independent expected styles', async () => {
  const result = await readMarkdownDocument('# Title\n\nplain **bold** and *italic* and ***both*** and `a * b`\n\n---\n\n```js\n  a\\* &amp;\n```\n');
  assert.equal(result.model.blocks[0].kind, 'heading'); assert.equal(result.model.blocks[0].level, 1);
  assert.deepEqual(result.model.blocks[1].runs.filter(run => run.style !== 'regular').map(run => [run.text,run.style]), [['bold','bold'],['italic','italic'],['both','boldItalic'],['a * b','code']]);
  assert.equal(result.model.blocks[2].kind, 'rule'); assert.equal(result.model.blocks[3].kind, 'code'); assert.equal(text(result.model.blocks[3]), '  a\\* &amp;\n'); assert.ok(has(result,'code-info-unrepresented'));
});
test('numeric references decode once and escaped HTML/comments cannot become syntax', async () => {
  const result = await readMarkdownDocument('\\&amp; &#42; &#35; &lt;br /&gt; \\<!-- --\\>\n\n<p></p>');
  assert.deepEqual(texts(result), ['&amp; * # <br /> <!-- -->','']); assert.ok(has(result,'safe-html-required'));
  for (const source of ['&#0;','&#xD800;','&#1114112;','\ud800','x\u0000']) await assert.rejects(readMarkdownDocument(source), {code:'MARKDOWN_TEXT_UNICODE'});
});
test('direct source numbering keeps parent7 child12 parent8 and nested restart boundaries', async () => {
  const result = await readMarkdownDocument('7. parent\n   12. child\n8. parent again\n   <!-- -->\n   20. new child\n9. third\n\n<!-- -->\n12. root restart');
  const items = result.model.blocks;
  assert.deepEqual(items.map(block => [block.list.level,block.list.value,block.list.restart]), [[0,7,true],[1,12,true],[0,8,false],[1,20,true],[0,9,false],[0,12,true]]);
  assert.equal(items[0].list.id, items[2].list.id); assert.equal(items[0].list.id, items[4].list.id); assert.notEqual(items[1].list.id,items[3].list.id); assert.notEqual(items[4].list.id,items[5].list.id);
  const normalized = await readMarkdownDocument('7. first\n99. next'); assert.equal(normalized.model.blocks[1].list.value,8); assert.ok(has(normalized,'list-marker-normalized'));
});
test('table cells distinguish paragraph boundaries, numeric LF, empty paragraphs and literal lookalikes', async () => {
  const result = await readMarkdownDocument('| A | B |\n| --- | :---: |\n| first<br /><br />third | one&#10;line \\| pipe |\n| \\<br /\\> | `a\\|b` |');
  const table = result.model.blocks[0]; assert.equal(table.kind,'table'); assert.deepEqual(table.rows[1][0].paragraphs.map(text), ['first','','third']); assert.deepEqual(table.rows[1][1].paragraphs.map(text),['one\nline | pipe']); assert.equal(text(table.rows[2][0].paragraphs[0]),'<br />'); assert.equal(text(table.rows[2][1].paragraphs[0]),'a|b'); assert.ok(has(result,'table-alignment-unrepresented'));
  for (const source of ['| A | B |\n| --- | --- |\n| missing |','| A |\n| --- |\n| excess | column |','| A | B |\n| -- | --- |']) await assert.rejects(readMarkdownDocument(source), {code:'MARKDOWN_UNSUPPORTED_TABLE'});
});
test('owned images require actual bytes, immutable Buffer copies, exact local names and no remote fetch', async () => {
  const bytes = png(), before = Buffer.from(bytes), assets = [{name:'two.png',type:'image/png',bytes,width:2,height:1}];
  Object.defineProperty(bytes,'slice',{value(){throw new Error('Input slice called');}});
  const result = await readMarkdownDocument('before ![red & blue](./two.png) after\n\n![remote](https://invalid.example/x.png)', {assets});
  assert.deepEqual(result.model.blocks.map(block => block.kind), ['paragraph','image','paragraph','paragraph']); assert.equal(result.assets.length,1); assert.equal(result.model.assets[0].alt,'red & blue'); assert.equal(result.model.blocks[1].width,1.5); assert.ok(has(result,'image-target-blocked')); assert.deepEqual(Buffer.from(result.assets[0].bytes),before); assert.notEqual(result.assets[0].bytes.buffer,bytes.buffer);
  const output = result.assets[0].bytes; result.assets.length = 0; output.fill = () => { throw new Error('Controlled output fill called'); }; result.dispose(); result.dispose(); assert.equal(Uint8Array.prototype.every.call(output,byte => byte === 0),true); assert.deepEqual(Buffer.from(bytes),before);
  await assert.rejects(readMarkdownDocument('![x](two.png)'),{code:'MARKDOWN_ASSET_MISSING'});
  await assert.rejects(readMarkdownDocument('',{assets:[...assets,{...assets[0],name:'TWO.png'}]}),{code:'MARKDOWN_INPUT_SHAPE'});
  await assert.rejects(readMarkdownDocument('',{assets:[{...assets[0],bytes:{size:1,arrayBuffer(){throw new Error('Duck read');}}}]}),{code:'MARKDOWN_INPUT_SHAPE'});
});
test('strict record/array guards never invoke traversal or accessor overrides', async () => {
  let calls = 0; const assets = []; Object.defineProperty(assets,'map',{value(){calls++; return [];}}); await assert.rejects(readMarkdownDocument('',{assets}),{code:'MARKDOWN_INPUT_SHAPE'});
  const settings = {}; Object.defineProperty(settings,'assets',{enumerable:true,get(){calls++; return [];}}); await assert.rejects(readMarkdownDocument('',settings),{code:'MARKDOWN_INPUT_SHAPE'}); assert.equal(calls,0);
  const stop=new AbortController();stop.signal.throwIfAborted=()=>{calls++;throw new Error('Controlled signal method');};assert.equal(text((await readMarkdownDocument('good',{signal:stop.signal})).model.blocks[0]),'good');assert.equal(calls,0);
});
test('raw, logical, structural and delimiter limits reject transactionally with a valid successor', async () => {
  await assert.rejects(readMarkdownDocument('x'.repeat(8*1024*1024+1)),{code:'MARKDOWN_LIMIT'});
  await assert.rejects(readMarkdownDocument('x'.repeat(1000001)),{code:'MARKDOWN_LIMIT'});
  await assert.rejects(readMarkdownDocument(Array.from({length:10001},()=>'<p></p>').join('\n')),{code:'MARKDOWN_LIMIT'});
  await assert.rejects(readMarkdownDocument('`'.repeat(65)),{code:'MARKDOWN_LIMIT'});
  assert.deepEqual(texts(await readMarkdownDocument('previous good remains')) , ['previous good remains']);
});
test('cooperative scan abort and actual Blob read cancellation drain before rejection and successor', async () => {
  const controller = new AbortController(); const pending = readMarkdownDocument('x'.repeat(900000),{signal:controller.signal}); setTimeout(()=>controller.abort(),0); await assert.rejects(pending,{name:'AbortError'});
  const native = Blob.prototype.arrayBuffer; let release, began, drained = false, settled = false;
  const started = new Promise(resolve => began = resolve), hold = new Promise(resolve => release = resolve);
  Blob.prototype.arrayBuffer = async function() { const bytes = await native.call(this); began(); await hold; drained = true; return bytes; };
  try { const isolated = await import(`../public/js/core/markdown-document.js?held-reader=${Date.now()}`); const stop = new AbortController(); const operation = isolated.readMarkdownDocument('![x](a.png)',{assets:[{name:'a.png',type:'image/png',bytes:new Blob([png()]),width:2,height:1}],signal:stop.signal}); operation.finally(()=>settled=true).catch(()=>{}); await started; stop.abort(); await new Promise(resolve=>setTimeout(resolve,10)); assert.equal(settled,false); assert.equal(drained,false); release(); await assert.rejects(operation,{name:'AbortError'}); assert.equal(drained,true); assert.deepEqual(texts(await isolated.readMarkdownDocument('successor')),['successor']); } finally { release?.(); Blob.prototype.arrayBuffer = native; }
});
test('unsupported block regions and links retain their syntax, while hard breaks cross chunk boundaries correctly', async () => {
  for (const source of ['> **quoted** &amp;','    **indented** <br />','- [ ] **task**','<b>**raw HTML**</b>','Title\n---','[**label**](https://invalid.example)']) {
    const result = await readMarkdownDocument(source); assert.equal(result.model.blocks[0].kind,'paragraph'); assert.equal(text(result.model.blocks[0]),source); assert.ok(has(result,'unsupported-literal')); assert.ok(result.model.blocks[0].runs.every(run=>run.style==='regular'));
  }
  const source = 'x'.repeat(4095)+'  \nnext'; assert.equal(text((await readMarkdownDocument(source)).model.blocks[0]),'x'.repeat(4095)+'\nnext');
  const table=await readMarkdownDocument('| \u00a0A\u00a0 |\n| --- |'); assert.equal(text(table.model.blocks[0].rows[0][0].paragraphs[0]),'\u00a0A\u00a0');
  assert.equal((await readMarkdownDocument('######')).model.blocks[0].level,6);
  assert.equal(text((await readMarkdownDocument('   ```\n   a\n  b\n```')).model.blocks[0]),'a\nb\n');
});
test('actual JPEG and cross-realm/ArrayBuffer asset byte types preserve intrinsic ownership', async () => {
  const {runInNewContext}=await import('node:vm');
  const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQACAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/IvxD/yH9S/6+Zv/AEM1j1seIf8AkP6l/wBfM3/oZrHr+qD+1D//2Q==','base64');
  const cross=runInNewContext(`new Uint8Array(${JSON.stringify([...png()])})`), ab=Uint8Array.from(jpeg).buffer;
  const result=await readMarkdownDocument('![PNG](a.png)\n\n![JPEG](b.jpg)',{assets:[{name:'a.png',type:'image/png',bytes:cross,width:2,height:1},{name:'b.jpg',type:'image/jpeg',bytes:ab,width:2,height:1}]});
  assert.deepEqual(Buffer.from(result.assets[0].bytes),png()); assert.deepEqual(Buffer.from(result.assets[1].bytes),jpeg); const before=Buffer.from(jpeg); result.dispose(); assert.deepEqual(Buffer.from(ab),before); assert.deepEqual(Buffer.from(cross),png());
});
test('closing emphasis requires punctuation-aware right-flanking and keeps rejected delimiter regions literal', async () => {
  for (const source of ['*a!*b','**a!**b','***a!***b','*a؟*b','**a؟**b','_a!_b','__a!__b','snake_case']) {
    const result=await readMarkdownDocument(source);assert.equal(result.model.blocks.length,1);assert.equal(result.model.blocks[0].kind,'paragraph');assert.deepEqual(result.model.blocks[0].runs.map(run=>[run.text,run.style]),[[source,'regular']]);
  }
  for (const [source,expected] of [
    ['*a* b',[['a','italic'],[' b','regular']]],
    ['*a!* b',[['a!','italic'],[' b','regular']]],
    ['**a!** b',[['a!','bold'],[' b','regular']]],
    ['*a!*!',[['a!','italic'],['!','regular']]],
    ['**a!**!',[['a!','bold'],['!','regular']]],
    ['*a!*',[['a!','italic']]],
    ['**a!**',[['a!','bold']]],
    ['*a؟* b',[['a؟','italic'],[' b','regular']]],
    ['_a!_ b',[['a!','italic'],[' b','regular']]],
    ['__a!__ b',[['a!','bold'],[' b','regular']]],
    ['*a*b',[['a','italic'],['b','regular']]]
  ]) {const result=await readMarkdownDocument(source);assert.deepEqual(result.model.blocks[0].runs.map(run=>[run.text,run.style]),expected);}
});
