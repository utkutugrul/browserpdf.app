import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { readDocxDocument, buildDocxDocument, DOCX_MIME } from '../public/js/core/docx-document.js';
import { documentToPlainText } from '../public/js/core/document-text.js';

// Fixtures and the inspector intentionally do not use either production ZIP
// helper, admission parser, XML events or document reader to establish inputs.
const enc = new TextEncoder(), dec = new TextDecoder(), W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', REL = 'http://schemas.openxmlformats.org/package/2006/relationships', CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const artifactDirectory = await mkdtemp(join(tmpdir(), 'browserpdf-docx-adapters-'));
const sha = value => createHash('sha256').update(value).digest('hex');
function crc(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value & 1 ? value >>> 1 ^ 0xedb88320 : value >>> 1; } return (value ^ 0xffffffff) >>> 0; }
function zip(parts, deflated = false) {
  const local = [], central = []; let position = 0;
  for (const [name, input] of Object.entries(parts)) { const data = typeof input === 'string' ? enc.encode(input) : input, compressed = deflated ? deflateRawSync(data) : data, filename = enc.encode(name), h = Buffer.alloc(30), c = Buffer.alloc(46); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20,4); h.writeUInt16LE(0x800,6); h.writeUInt16LE(deflated ? 8 : 0,8); h.writeUInt32LE(crc(data),14); h.writeUInt32LE(compressed.length,18); h.writeUInt32LE(data.length,22); h.writeUInt16LE(filename.length,26); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6); c.writeUInt16LE(0x800,8); c.writeUInt16LE(deflated ? 8 : 0,10); c.writeUInt32LE(crc(data),16); c.writeUInt32LE(compressed.length,20); c.writeUInt32LE(data.length,24); c.writeUInt16LE(filename.length,28); c.writeUInt32LE(position,42); local.push(h,filename,compressed); central.push(c,filename); position += h.length + filename.length + compressed.length; }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2,8); end.writeUInt16LE(central.length / 2,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(position,16); return Buffer.concat([...local,directory,end]);
}
function inspect(bytes) {
  const input = Buffer.from(bytes), end = input.length - 22, count = input.readUInt16LE(end + 10), parts = new Map(); let position = input.readUInt32LE(end + 16);
  assert.equal(input.readUInt32LE(end),0x06054b50);
  for (let i = 0; i < count; i++) { assert.equal(input.readUInt32LE(position),0x02014b50); const method = input.readUInt16LE(position + 10), size = input.readUInt32LE(position + 20), raw = input.readUInt32LE(position + 24), nameSize = input.readUInt16LE(position + 28), extra = input.readUInt16LE(position + 30), comment = input.readUInt16LE(position + 32), local = input.readUInt32LE(position + 42), name = input.subarray(position + 46,position + 46 + nameSize).toString(); assert.equal(input.readUInt32LE(local),0x04034b50); const begin = local + 30 + input.readUInt16LE(local + 26) + input.readUInt16LE(local + 28), compressed = input.subarray(begin,begin + size), data = method === 8 ? inflateRawSync(compressed) : compressed; assert.equal(data.length,raw); assert.equal(crc(data),input.readUInt32LE(position + 16)); assert.equal(crc(data),input.readUInt32LE(local + 14)); parts.set(name,Buffer.from(data)); position += 46 + nameSize + extra + comment; }
  assert.equal(position,end); return parts;
}
function png() { const chunk = (name,data) => { const size = Buffer.alloc(4), checksum = Buffer.alloc(4), type = Buffer.from(name); size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type,data]))); return Buffer.concat([size,type,data,checksum]); }; const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(1,4); header[8] = 8; header[9] = 2; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,0,0,255]))),chunk('IEND',Buffer.alloc(0))]); }
const XML = text => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const literal = '  2 * 3 * 4; # title; snake_case; [x](url); <math> & İstanbul\tEND\nالسَّلَامُ عَلَيْكُمْ שָׁלוֹם  ';
function fixture({prefix = 'w', document, numbering, styles, image = false, extraRels = '', extraParts = {}} = {}) {
  const p = prefix, body = document ?? `<${p}:p><${p}:pPr><${p}:bidi ${p}:val="1"/></${p}:pPr><${p}:r><${p}:rPr><${p}:i/><${p}:rtl ${p}:val="0"/></${p}:rPr><${p}:t xml:space="preserve">LATIN ITALIC </${p}:t></${p}:r><${p}:r><${p}:rPr><${p}:rtl/></${p}:rPr><${p}:t xml:space="preserve">${XML(literal)}</${p}:t></${p}:r><${p}:r><${p}:rPr><${p}:b/><${p}:bCs/><${p}:rtl/></${p}:rPr><${p}:t>שלום</${p}:t></${p}:r></${p}:p>`;
  const parts = {'[Content_Types].xml':`<Types xmlns="${CT}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>${styles ? `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` : ' '}${numbering ? `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` : ' '}<Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/></Types>`, '_rels/.rels':`<Relationships xmlns="${REL}"><Relationship Id="main" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`, 'word/document.xml':`<${p}:document xmlns:${p}="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><${p}:body>${body}</${p}:body></${p}:document>`, 'word/_rels/document.xml.rels':`<Relationships xmlns="${REL}">${numbering ? `<Relationship Id="n" Type="${R}/numbering" Target="numbering.xml"/>` : ''}${styles ? `<Relationship Id="s" Type="${R}/styles" Target="styles.xml"/>` : ''}${image ? `<Relationship Id="img" Type="${R}/image" Target="media/two.png"/>` : ''}${extraRels}</Relationships>`, ...extraParts};
  if (numbering) parts['word/numbering.xml'] = `<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`;
  if (styles) parts['word/styles.xml'] = `<w:styles xmlns:w="${W}">${styles}</w:styles>`;
  if (image) parts['word/media/two.png'] = png(); return parts;
}
const numbered = (num, text, level = 0) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${num}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const numberingSource = '<w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="7"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="3"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/></w:lvl></w:abstractNum><w:num w:numId="40"><w:abstractNumId w:val="7"/></w:num><w:num w:numId="41"><w:abstractNumId w:val="7"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="12"/></w:lvlOverride></w:num>';
const drawing = '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1524000" cy="762000"/><wp:docPr id="1" name="two" descr="Red &amp; blue"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="two"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="img"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="762000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
const table = '<w:tbl><w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>LEFT | literal</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>RIGHT שלום</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>END</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

test('real stored/deflated DOCX preserve literal logical text, actual per-run styles and separate directions', async () => {
  for (const deflated of [false,true]) { const input = zip(fixture(),deflated), before = sha(input), bundle = await readDocxDocument(input); const p = bundle.model.blocks[0]; assert.equal(p.direction,'rtl'); assert.deepEqual(p.runs,[{text:'LATIN ITALIC ',style:'italic',direction:'ltr'},{text:literal,style:'regular',direction:'rtl'},{text:'שלום',style:'bold',direction:'rtl'}]); assert.equal(await documentToPlainText(bundle.model),'LATIN ITALIC ' + literal + 'שלום\n'); assert.equal(bundle.model.pages.length,0); assert.equal(sha(bundle.sourceBytes),before); bundle.dispose(); assert.equal(sha(input),before); assert.ok(bundle.sourceBytes.every(byte => byte === 0)); }
});
test('source numbering numId, abstract start7, startOverride12, continuation and default deeper restart are independently specified', async () => {
  const source = numbered(40,'SEVEN') + numbered(40,'THREE',1) + numbered(40,'FOUR',1) + numbered(40,'EIGHT') + numbered(40,'THREE AGAIN',1) + numbered(41,'TWELVE') + numbered(41,'THIRTEEN') + numbered(40,'NINE'); const bytes = zip(fixture({document:source,numbering:numberingSource}),true), bundle = await readDocxDocument(bytes);
  assert.deepEqual(bundle.model.blocks.map(p => [p.list.value,p.list.level,p.list.restart]),[[7,0,true],[3,1,true],[4,1,false],[8,0,false],[3,1,true],[12,0,true],[13,0,false],[9,0,false]]); assert.equal(bundle.model.lists[0].start,7); assert.equal(bundle.model.lists[2].start,12); assert.equal(bundle.model.blocks[0].list.id,bundle.model.blocks[7].list.id); assert.notEqual(bundle.model.blocks[0].list.id,bundle.model.blocks[5].list.id); bundle.dispose();
});
test('style inheritance, direct off, explicit complex-script formatting and namespace remapping are based on actual runs', async () => {
  const styles = '<w:style w:type="paragraph" w:default="1" w:styleId="Base"><w:rPr><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/><w:pPr><w:bidi w:val="0"/></w:pPr></w:style><w:style w:type="character" w:styleId="Italic"><w:rPr><w:i/></w:rPr></w:style>';
  const body = '<w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:rPr><w:rStyle w:val="Italic"/><w:b w:val="0"/></w:rPr><w:t>ITALIC ONLY</w:t></w:r><w:r><w:rPr><w:rtl/><w:bCs w:val="0"/><w:iCs/></w:rPr><w:t>עִבְרִית</w:t></w:r></w:p>';
  const bundle = await readDocxDocument(zip(fixture({document:body.replaceAll('w:','q:'),prefix:'q',styles}))); assert.equal(bundle.model.blocks[0].direction,'ltr'); assert.deepEqual(bundle.model.blocks[0].runs.map(run => [run.style,run.direction]),[['italic','auto'],['italic','rtl']]); bundle.dispose();
});
test('real table grid, empty cells, image bytes, physical extent and alt text survive import', async () => {
  const bytes = zip(fixture({document:table + drawing,image:true}),true), bundle = await readDocxDocument(bytes); const [grid,image] = bundle.model.blocks; assert.deepEqual(grid.columnWidths,[60,120]); assert.equal(grid.rows[1][0].paragraphs[0].runs.length,0); assert.deepEqual([image.kind,image.width,image.height],['image',120,60]); assert.equal(bundle.model.assets[0].alt,'Red & blue'); assert.equal(sha(bundle.assets[0].bytes),sha(png())); assert.ok(bundle.report.some(item => item.code === 'inline-image-block-normalized')); const retained = bundle.assets[0].bytes; bundle.assets.length = 0; bundle.dispose(); assert.ok(retained.every(byte => byte === 0)); assert.notEqual(sha(bytes),sha(new Uint8Array(bytes.length)));
});
test('saved DOCX has independently inspected real numbering/restarts, table XML, escaped literal text, direction and media CRC', async () => {
  const parts = fixture({document:numbered(40,'SEVEN') + numbered(40,'EIGHT') + numbered(41,'TWELVE') + table + drawing,numbering:numberingSource,image:true}), source = zip(parts,true), bundle = await readDocxDocument(source), result = await buildDocxDocument(bundle.model,{assets:bundle.assets,paper:'a4',landscape:true,margin:36}), saved = inspect(result.bytes), document = saved.get('word/document.xml').toString(), numbers = saved.get('word/numbering.xml').toString();
  assert.match(document,/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="1"\/>/); assert.equal((document.match(/<w:numId w:val="1"\/>/g) || []).length,2); assert.match(numbers,/<w:abstractNum w:abstractNumId="1">[\s\S]*?<w:start w:val="7"\/>/); assert.match(numbers,/<w:num w:numId="2"><w:abstractNumId w:val="2"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="12"\/>/); assert.match(document,/<w:tblGrid><w:gridCol w:w="3000"\/><w:gridCol w:w="6000"\/>/); assert.match(document,/w:orient="landscape"/); assert.match(document,/w:top="720"/); assert.match(document,/r:embed="image1"/); assert.equal(sha(saved.get('word/media/image1.png')),sha(png())); assert.match(saved.get('word/_rels/document.xml.rels').toString(),/Target="media\/image1.png"/);
  const reopened = await readDocxDocument(result.bytes); assert.deepEqual(reopened.model.blocks.filter(block => block.kind === 'list-item').map(block => block.list.value),[7,8,12]); assert.equal(await documentToPlainText(reopened.model),await documentToPlainText(bundle.model));
  const files = {'source.docx':source,'saved.docx':result.bytes,'saved.txt':await documentToPlainText(reopened.model),'model.json':JSON.stringify(bundle.model,null,2),'artifact-inspection.json':JSON.stringify({parts:[...saved.keys()],pngSHA:sha(png()),sourceSHA:sha(source),savedSHA:sha(result.bytes),numberingXML:numbers},null,2)}; for (const [name,bytes] of Object.entries(files)) await writeFile(join(artifactDirectory,name),bytes); console.log(`DOCX artifacts: ${artifactDirectory}`); reopened.dispose(); bundle.dispose();
});
test('writer emits explicit restarts using a new concrete numId and startOverride without literal marker text', async () => {
  const model = {version:1,origin:'text',pages:[],assets:[],warnings:[],lists:[{id:'list',ordered:true,start:7}],blocks:[7,8,4,5].map((value,i) => ({id:`p${i}`,kind:'list-item',direction:'auto',list:{id:'list',level:0,value,restart:i === 0 || i === 2},runs:[{text:`ITEM${i}`,style:'regular',direction:'auto'}]}))}, result = await buildDocxDocument(model), parts = inspect(result.bytes), numbers = parts.get('word/numbering.xml').toString(), document = parts.get('word/document.xml').toString(); assert.match(numbers,/<w:num w:numId="2"><w:abstractNumId w:val="1"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"\/>/); assert.equal((document.match(/<w:numId w:val="2"\/>/g)||[]).length,2); assert.doesNotMatch(document,/>7\. ITEM/); assert.equal(model.blocks[2].list.value,4);
});
test('writer literal whitespace and Unicode/marks/directions are present in actual saved XML before roundtrip', async () => {
  const bundle = await readDocxDocument(zip(fixture())), result = await buildDocxDocument(bundle.model), doc = inspect(result.bytes).get('word/document.xml').toString(); assert.match(doc,/<w:bidi w:val="1"\/>/); assert.match(doc,/<w:rtl w:val="0"\/>/); assert.match(doc,/<w:rtl w:val="1"\/>/); assert.match(doc,/<w:i\/><w:iCs\/>/); assert.match(doc,/<w:b\/><w:bCs\/>/); assert.ok(doc.includes('2 * 3 * 4; # title; snake_case; [x](url); &lt;math&gt; &amp; İstanbul')); assert.ok(doc.includes('السَّلَامُ عَلَيْكُمْ שָׁלוֹם')); assert.match(doc,/<w:tab\/>/); assert.match(doc,/<w:br\/>/); assert.match(doc,/xml:space="preserve"/); const reopened = await readDocxDocument(result.bytes); assert.deepEqual(reopened.model.blocks[0].runs,bundle.model.blocks[0].runs); await writeFile(join(artifactDirectory,'unicode-styles.docx'),result.bytes); await writeFile(join(artifactDirectory,'unicode-styles.txt'),await documentToPlainText(reopened.model)); reopened.dispose(); bundle.dispose();
});
test('unsupported semantics and namespace aliases reject transactionally, external image is blocked without fetch', async () => {
  const cases = [fixture({document:table.replace('<w:tc>','<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>')}),fixture({document:'<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>'}),fixture({document:numbered(40,'x'),numbering:numberingSource.replace('w:val="decimal"','w:val="upperRoman"')}),fixture({document:'<w:p xmlns:x="urn:same" xmlns:y="urn:same" x:a="1" y:a="2"/>'}),fixture({document:'<w:p><w:r><w:t bad:a="1">x</w:t></w:r></w:p>'}),fixture({styles:'<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="A"/></w:style>'})];
  for (const parts of cases) { const source = zip(parts), before = sha(source); await assert.rejects(readDocxDocument(source)); assert.equal(sha(source),before); }
  const bundle = await readDocxDocument(zip(fixture({document:drawing.replace('r:embed="img"','r:link="ext"'),extraRels:`<Relationship Id="ext" Type="${R}/image" Target="https://example.invalid/private.png" TargetMode="External"/>`}))); assert.equal(bundle.assets.length,0); assert.equal(await documentToPlainText(bundle.model),'Red & blue\n'); assert.ok(bundle.report.some(issue => issue.code === 'external-image-blocked')); bundle.dispose();
});
test('actual Buffer, cross-realm ArrayBuffer, Blob and hostile byte methods keep input ownership through disposal/build', async () => {
  const bytes = zip(fixture()), expected = sha(bytes); let calls = 0; bytes.slice = () => { calls++; throw Error('input slice'); }; bytes[Symbol.iterator] = () => { calls++; throw Error('input iterator'); };
  const foreign = vm.runInNewContext(`new Uint8Array(${JSON.stringify([...Buffer.from(bytes)])}).buffer`);
  for (const source of [bytes,foreign,new Blob([Buffer.from(bytes)])]) { const bundle = await readDocxDocument(source); bundle.dispose(); } assert.equal(calls,0); assert.equal(sha(bytes),expected);
  const bundle = await readDocxDocument(zip(fixture({document:drawing,image:true}))), input = Buffer.from(bundle.assets[0].bytes), before = sha(input); input.slice = () => { calls++; throw Error('asset slice'); }; const result = await buildDocxDocument(bundle.model,{assets:[{...bundle.assets[0],bytes:input}]}); assert.ok(result.bytes.length); assert.equal(sha(input),before); const assetArray = [...bundle.assets]; Object.defineProperty(assetArray,'map',{value(){calls++;return [];}}); await assert.rejects(buildDocxDocument(bundle.model,{assets:assetArray}),/asset array/); await assert.rejects(buildDocxDocument(bundle.model,{assets:[{...bundle.assets[0],bytes:{arrayBuffer:async()=>input,size:input.length}}]}),/actual/); assert.equal(calls,0); bundle.dispose();
});
test('model and generated package bounds reject; real cooperative parse/build cancellation settles before a valid successor', async () => {
  const tooMuch = fixture({document:`<w:p><w:r><w:t>${'x'.repeat(1000001)}</w:t></w:r></w:p>`}); await assert.rejects(readDocxDocument(zip(tooMuch)),/million/);
  const model = {version:1,origin:'text',pages:[],lists:[],assets:[],warnings:[],blocks:Array.from({length:3000},(_,i)=>({id:`p${i}`,kind:'paragraph',direction:'auto',runs:[{text:'x'.repeat(32),style:'regular',direction:'auto'}]}))};
  const readControl = new AbortController(), source = zip(fixture({document:model.blocks.map(block=>`<w:p><w:r><w:t>${block.runs[0].text}</w:t></w:r></w:p>`).join('')})); const pendingRead = readDocxDocument(source,{signal:readControl.signal}); setTimeout(()=>readControl.abort(),20); await assert.rejects(pendingRead,{name:'AbortError'});
  const buildControl = new AbortController(), pendingBuild = buildDocxDocument(model,{signal:buildControl.signal}); setTimeout(()=>buildControl.abort(),0); await assert.rejects(pendingBuild,{name:'AbortError'}); assert.equal(model.blocks[0].runs[0].text,'x'.repeat(32)); const good = await readDocxDocument(zip(fixture())); const successor = await buildDocxDocument(good.model); assert.ok(inspect(successor.bytes).has('word/document.xml')); good.dispose();
  const manyRuns = {...model,blocks:[{id:'large',kind:'paragraph',direction:'auto',runs:Array.from({length:34000},()=>({text:'x',style:'regular',direction:'auto'}))}]}; await assert.rejects(buildDocxDocument(manyRuns),/100000/);
});

test('UTF16 XML, CDATA, normalized source CRLF, entity references and supplementary characters cross real decoder/output chunks', async () => {
  const body = '<w:p><w:r><w:t xml:space="preserve">A\r\nB&#13;C&#x1F642; &amp; &lt;literal&gt; <![CDATA[* # _ < > &]]></w:t></w:r></w:p>', parts = fixture({document:body}), utf16 = Buffer.from(`<?xml version="1.0" encoding="UTF-16"?>${parts['word/document.xml']}`,'utf16le'); parts['word/document.xml'] = Buffer.concat([Buffer.from([255,254]),utf16]);
  const bundle = await readDocxDocument(zip(parts)); assert.equal(bundle.model.blocks[0].runs[0].text,'A\nB\rC🙂 & <literal> * # _ < > &'); bundle.dispose();
  const logical = 'x'.repeat(16383) + '🙂' + ' y '.repeat(5000), model = {version:1,origin:'text',pages:[],lists:[],assets:[],warnings:[],blocks:[{id:'p',kind:'paragraph',direction:'auto',runs:[{text:logical,style:'regular',direction:'auto'}]}]}, result = await buildDocxDocument(model), saved = inspect(result.bytes).get('word/document.xml').toString(); assert.ok(saved.includes('🙂')); assert.ok(!saved.includes('�')); const reopened = await readDocxDocument(result.bytes); assert.equal(reopened.model.blocks[0].runs[0].text,logical); reopened.dispose();
});
test('style defaults toggle through the hierarchy, complex-script variants do not inherit an unrelated Latin bold request', async () => {
  const style = '<w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Toggle"><w:rPr><w:b/></w:rPr></w:style>';
  const body = '<w:p><w:r><w:t>PLAIN AFTER TOGGLE</w:t></w:r><w:r><w:rPr><w:b/><w:rtl/></w:rPr><w:t>שלום</w:t></w:r><w:r><w:rPr><w:bCs/></w:rPr><w:t>עִבְרִית</w:t></w:r></w:p>', bundle = await readDocxDocument(zip(fixture({styles:style,document:body}))); assert.deepEqual(bundle.model.blocks[0].runs.map(run=>run.style),['regular','regular','bold']); bundle.dispose();
  await assert.rejects(readDocxDocument(zip(fixture({document:'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Latin שלום</w:t></w:r></w:p>'}))),{code:'DOCX_UNSUPPORTED_STYLE'});
});
test('bounded structural token, namespace, style and aggregate row rejection preserve input and exact model accounting', async () => {
  const cases = [fixture({document:`<w:p><w:r><w:t><!--${'x'.repeat(65537)}-->ok</w:t></w:r></w:p>`}),fixture({styles:Array.from({length:2049},(_,i)=>`<w:style w:type="paragraph" w:styleId="s${i}"/>`).join('')}),fixture({document:`<w:p>${Array.from({length:33},(_,i)=>`<w:r xmlns:p${i}="urn:${i}"><w:t>x</w:t></w:r>`).join('')}</w:p>`})];
  // Distinct bindings are package-limited at 256, not 32 siblings. This is a
  // positive sibling-scope control, distinct from the style/token rejections.
  const sibling = cases.pop(), bundle = await readDocxDocument(zip(sibling)); assert.equal(bundle.model.blocks[0].runs.length,33); bundle.dispose();
  for (const parts of cases) { const source=zip(parts), before=sha(source); await assert.rejects(readDocxDocument(source)); assert.equal(sha(source),before); }
  const namespaceOverflow = fixture({document:`<w:p>${Array.from({length:257},(_,i)=>`<w:r xmlns:p${i}="urn:${i}"><w:t>x</w:t></w:r>`).join('')}</w:p>`}); await assert.rejects(readDocxDocument(zip(namespaceOverflow)),/Namespace binding budget/);
  const row = '<w:tr><w:tc><w:p/></w:tc></w:tr>', one = `<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid>${row.repeat(5001)}</w:tbl>`; await assert.rejects(readDocxDocument(zip(fixture({document:one + one}))),/aggregate rows/);
});

test('heading, rule, page break and explicit code blocks are actual Word structures; unrepresentable code styles reject', async()=>{
  const run = (text,style='regular')=>({text,style,direction:'auto'}), model = {version:1,origin:'text',pages:[],assets:[],lists:[],warnings:[],blocks:[{id:'h',kind:'heading',level:2,direction:'ltr',runs:[run('HEADING')]},{id:'r',kind:'rule'},{id:'b',kind:'page-break'},{id:'c',kind:'code',direction:'auto',runs:[run('  a * b # literal\nnext','code')]}]};
  const result = await buildDocxDocument(model), document = inspect(result.bytes).get('word/document.xml').toString(); assert.match(document,/w:pStyle w:val="Heading2"/); assert.match(document,/<w:pBdr><w:bottom/); assert.match(document,/<w:br w:type="page"\/>/); const bundle = await readDocxDocument(result.bytes); assert.deepEqual(bundle.model.blocks.map(block=>block.kind),['heading','rule','page-break','code']); assert.equal(bundle.model.blocks[3].runs[0].text,'  a * b # literal\nnext'); bundle.dispose();
  model.blocks[3].runs[0].style='bold'; await assert.rejects(buildDocxDocument(model),{code:'DOCX_UNSUPPORTED_STYLE'});
  await assert.rejects(readDocxDocument(zip(fixture({document:'<w:p><w:r><w:rPr><w:rFonts w:ascii="Courier New"/><w:b/></w:rPr><w:t>bold code</w:t></w:r></w:p>'}))),{code:'DOCX_UNSUPPORTED_STYLE'});
});

// Independent saved-XML oracle for this writer's declared decimal/default
// restart subset. It does not use production admission, events or reader.
function savedNumbering(parts) {
  const abstracts = new Map(), instances = new Map();
  for (const match of parts.get('word/numbering.xml').toString().matchAll(/<w:abstractNum w:abstractNumId="(\d+)">([\s\S]*?)<\/w:abstractNum>/g)) {
    const starts = new Map();
    for (const level of match[2].matchAll(/<w:lvl w:ilvl="(\d+)">([\s\S]*?)<\/w:lvl>/g)) starts.set(Number(level[1]),Number(level[2].match(/<w:start w:val="(\d+)"\/>/)[1]));
    abstracts.set(Number(match[1]),starts);
  }
  for (const match of parts.get('word/numbering.xml').toString().matchAll(/<w:num w:numId="(\d+)">([\s\S]*?)<\/w:num>/g)) {
    const starts = new Map(abstracts.get(Number(match[2].match(/<w:abstractNumId w:val="(\d+)"\/>/)[1])));
    for (const override of match[2].matchAll(/<w:lvlOverride w:ilvl="(\d+)">([\s\S]*?)<\/w:lvlOverride>/g)) starts.set(Number(override[1]),Number(override[2].match(/<w:startOverride w:val="(\d+)"\/>/)[1]));
    instances.set(Number(match[1]),{starts,values:new Map()});
  }
  const result = [];
  for (const paragraph of parts.get('word/document.xml').toString().matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)) {
    const numPr = paragraph[1].match(/<w:numPr>([\s\S]*?)<\/w:numPr>/)?.[1]; if (!numPr) continue;
    const numId = Number(numPr.match(/<w:numId w:val="(\d+)"\/>/)[1]), level = Number(numPr.match(/<w:ilvl w:val="(\d+)"\/>/)[1]), state = instances.get(numId), restart = !state.values.has(level), value = restart ? state.starts.get(level) : state.values.get(level) + 1;
    state.values.set(level,value); for (let deeper=level+1;deeper<9;deeper++) state.values.delete(deeper);
    result.push({numId,level,value,restart});
  }
  return result;
}
test('first-use child startOverride12 preserves parent7 then parent8 continuation in independent actual numbering XML',async()=>{
  const items = [{level:0,value:7,restart:true},{level:1,value:12,restart:true},{level:0,value:8,restart:false},{level:1,value:12,restart:true}], model = {version:1,origin:'text',pages:[],assets:[],warnings:[],lists:[{id:'one-list',ordered:true,start:7}],blocks:items.map((list,i)=>({id:`n${i}`,kind:'list-item',direction:'auto',list:{id:'one-list',...list},runs:[{text:`ITEM${i}`,style:'regular',direction:'auto'}]}))};
  for (const length of [2,3,4]) {
    const built = await buildDocxDocument({...model,blocks:model.blocks.slice(0,length)}), parts = inspect(built.bytes), oracle = savedNumbering(parts);
    await writeFile(join(artifactDirectory,`nested-${length}.docx`),built.bytes); await writeFile(join(artifactDirectory,`nested-${length}-oracle.json`),JSON.stringify(oracle,null,2));
    assert.deepEqual(oracle.map(({level,value,restart})=>({level,value,restart})),items.slice(0,length)); assert.deepEqual(oracle.map(item=>item.numId),Array(length).fill(1));
    assert.match(parts.get('word/numbering.xml').toString(),/<w:lvlOverride w:ilvl="1"><w:startOverride w:val="12"\/><\/w:lvlOverride>/);
    const bundle=await readDocxDocument(built.bytes); assert.deepEqual(bundle.model.blocks.map(block=>({level:block.list.level,value:block.list.value,restart:block.list.restart})),items.slice(0,length)); bundle.dispose();
  }
  const changed = {...model,blocks:model.blocks.map((block,i)=>i===3?{...block,list:{...block.list,value:14}}:block)}, built=await buildDocxDocument(changed), oracle=savedNumbering(inspect(built.bytes));
  await writeFile(join(artifactDirectory,'nested-used-level-change.docx'),built.bytes); assert.deepEqual(oracle.map(item=>item.value),[7,12,8,14]); assert.deepEqual(oracle.map(item=>item.numId),[1,1,1,2]);
  changed.blocks.push({id:'last',kind:'list-item',direction:'auto',list:{id:'one-list',level:0,value:9,restart:false},runs:[{text:'PARENT9',style:'regular',direction:'auto'}]});
  await assert.rejects(buildDocxDocument(changed),{code:'DOCX_UNSUPPORTED_NUMBERING'});
  changed.blocks.at(-1).list.value=7; await assert.rejects(buildDocxDocument(changed),{code:'DOCX_UNSUPPORTED_NUMBERING'});
});
test('markup compatibility alternatives reject as typed unsupported before either exclusive branch is published',async()=>{
  const paragraph = text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  for (const deflated of [false,true]) {
    const body=`<m:AlternateContent xmlns:m="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><m:Choice Requires="w14">${paragraph('CHOICE')}</m:Choice><m:Fallback>${paragraph('FALLBACK')}</m:Fallback></m:AlternateContent>`, input=zip(fixture({document:body}),deflated), before=sha(input);
    await writeFile(join(artifactDirectory,`unsupported-alternatives-${deflated?'deflated':'stored'}.docx`),input);
    await assert.rejects(readDocxDocument(input),{code:'DOCX_UNSUPPORTED_COMPATIBILITY'}); assert.equal(sha(input),before);
  }
  const literal='CONTROL <mc:AlternateContent> choice + fallback literal', good=await readDocxDocument(zip(fixture({document:paragraph(XML(literal))})));
  assert.equal(await documentToPlainText(good.model),literal+'\n'); assert.deepEqual(good.report,[]); good.dispose();
  await assert.rejects(readDocxDocument(zip(fixture({styles:'<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Fallback/></mc:AlternateContent>'}))),{code:'DOCX_UNSUPPORTED_COMPATIBILITY'});
});
test('simple DATE fields reject as typed unsupported and a plain literal successor remains usable',async()=>{
  for (const prefix of ['w','q']) {
    const body='<w:p><w:fldSimple w:instr="DATE"><w:r><w:t>FIELD RESULT</w:t></w:r></w:fldSimple></w:p>'.replaceAll('w:',`${prefix}:`), input=zip(fixture({prefix,document:body}),true), before=sha(input);
    await writeFile(join(artifactDirectory,`unsupported-simple-field-${prefix}.docx`),input);
    await assert.rejects(readDocxDocument(input),{code:'DOCX_UNSUPPORTED_FIELD'}); assert.equal(sha(input),before);
  }
  const literal='CONTROL <w:fldSimple> literal DATE', good=await readDocxDocument(zip(fixture({document:`<w:p><w:r><w:t>${XML(literal)}</w:t></w:r></w:p>`}))), built=await buildDocxDocument(good.model), reopened=await readDocxDocument(built.bytes);
  assert.equal(await documentToPlainText(reopened.model),literal+'\n'); assert.deepEqual(good.report,[]); reopened.dispose(); good.dispose();
});
