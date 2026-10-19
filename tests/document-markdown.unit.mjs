import test from 'node:test';
import assert from 'node:assert/strict';
import { documentToMarkdown } from '../public/js/core/document-markdown.js';
import { readMarkdownDocument } from '../public/js/core/markdown-document.js';
const run = (text,style='regular',direction='auto') => ({text,style,direction});
const p = (id,text,kind='paragraph') => ({id,kind,direction:'auto',runs:[run(text)]});
const model = blocks => ({version:1,origin:'pdf',pages:[],lists:[],assets:[],warnings:[],blocks});
const text = block => block.runs.map(run=>run.text).join('');
const has = (result,code) => result.report.some(issue=>issue.code===`markdown-${code}`);
const PNG_BASE64='iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==';
test('independently expected normal Markdown is human readable, including prose, tables and fences', async () => {
  const input = model([p('p','Hello world. Ordinary punctuation, yes!'),{...p('h','Readable title','heading'),level:2},{...p('b','Bold words'),runs:[run('Bold words','bold')]},{id:'t',kind:'table',columnWidths:[1,1],rows:[[{paragraphs:[p('a','Name')]},{paragraphs:[p('b2','Value')]}],[{paragraphs:[p('c','Red blue')]},{paragraphs:[p('d','42')]}]]},{...p('code','const n = 7;\n','code'),runs:[run('const n = 7;\n','code')]}]);
  const result = await documentToMarkdown(input);
  assert.equal(result.text,'Hello world. Ordinary punctuation, yes!\n\n## Readable title\n\n**Bold words**\n\n| Name | Value |\n| --- | --- |\n| Red blue | 42 |\n\n```\nconst n = 7;\n```\n');
  assert.equal(new TextDecoder().decode(result.bytes),result.text); assert.ok(!has(result,'safe-html-required')); assert.ok(has(result,'table-header-inferred'));
});
test('normal adjacent prose and styles do not manufacture entities or empty-comment noise', async () => {
  const input = model([{...p('p',''),runs:[run('Hello '),run('ordinary '),run('bold','bold'),run(' world.')]}]);
  const result = await documentToMarkdown(input); assert.equal(result.text,'Hello ordinary **bold** world.\n');
  const reopened = await readMarkdownDocument(result.text); assert.equal(text(reopened.model.blocks[0]),'Hello ordinary bold world.'); assert.equal(reopened.model.blocks[0].runs.find(run=>run.style==='bold').text,'bold');
});
test('literal embedded punctuation, entities, HTML and boundary whitespace survive once without style guessing', async () => {
  const literal = '  #title * 2 * 3 snake_case [x](url) &amp; <br /> <!-- -->\t\r\nlast  ';
  const result = await documentToMarkdown(model([p('p',literal)]));
  assert.match(result.text,/\\\* 2 \\\* 3/); assert.match(result.text,/\\&amp;/); assert.match(result.text,/&#32;/); assert.match(result.text,/&#13;/);
  const reopened = await readMarkdownDocument(result.text); assert.equal(text(reopened.model.blocks[0]),literal); assert.ok(reopened.model.blocks[0].runs.every(run=>run.style==='regular'));
  for (const value of ['---','# header','1. literal','> quote','+ item','- item','<p></p>','<pre><code>x</code></pre>','<!-- -->']) { const saved = await documentToMarkdown(model([p('p',value)])); const parsed = await readMarkdownDocument(saved.text); assert.equal(parsed.model.blocks[0].kind,'paragraph'); assert.equal(text(parsed.model.blocks[0]),value); }
});
test('adjacent styled edge whitespace and separate styles stay deliberate and exact', async () => {
  const input = model([{...p('p',''),runs:[run(' a ','bold'),run('b','italic'),run('c','boldItalic'),run('`literal`','code')]}]);
  const result = await documentToMarkdown(input), reopened = await readMarkdownDocument(result.text);
  assert.deepEqual(reopened.model.blocks[0].runs.map(run=>[run.text,run.style]),[[' a ','bold'],['b','italic'],['c','boldItalic'],['`literal`','code']]); assert.ok(has(result,'safe-html-required'));
});
test('code fences remain standard while genuine exact fallback preserves missing LF, CR and literal backslashes', async () => {
  for (const value of ['a\\* &amp;\rno final LF','a\\*','<code>&literal</code>','`'.repeat(64)]) {
    const result = await documentToMarkdown(model([{...p('code','','code'),runs:[run(value,'code')]}]));
    assert.match(result.text,/^<pre><code>/); assert.ok(has(result,'safe-html-required')); const reopened = await readMarkdownDocument(result.text); assert.equal(reopened.model.blocks[0].kind,'code'); assert.equal(text(reopened.model.blocks[0]),value);
  }
  const result = await documentToMarkdown(model([{...p('code','','code'),runs:[run('```\n\t x\n','code')]}])); assert.equal(result.text,'````\n```\n\t x\n````\n'); assert.ok(!has(result,'safe-html-required'));
  await assert.rejects(documentToMarkdown(model([{...p('p',''),runs:[run('x\ny','code')]}])),{code:'MARKDOWN_UNSUPPORTED_STYLE'});
});
test('explicit nested7/12/8 and later12 restart have independently asserted readable markers', async () => {
  const input = model([]); input.lists=[{id:'list',ordered:true,start:7}]; const item=(id,level,value,restart)=>({...p(id,id,'list-item'),list:{id:'list',level,value,restart}}); input.blocks=[item('parent',0,7,true),item('child',1,12,true),item('next',0,8,false),item('restart',0,12,true)];
  const result = await documentToMarkdown(input); assert.equal(result.text,'7. parent\n   12. child\n8. next\n<!-- -->\n12. restart\n'); const parsed = await readMarkdownDocument(result.text); assert.deepEqual(parsed.model.blocks.map(block=>[block.list.level,block.list.value,block.list.restart]),[[0,7,true],[1,12,true],[0,8,false],[0,12,true]]);
});
test('table paragraph and inline LF artifacts are distinct and preserve literal syntax-looking strings', async () => {
  const input = model([{id:'t',kind:'table',columnWidths:[1],rows:[[{paragraphs:[p('a','ordinary cell')]}],[{paragraphs:[p('b','a\nb | c'),p('c',''),p('d','<br /> &#10;')]}]]}]);
  const result = await documentToMarkdown(input); assert.match(result.text,/a&#10;b \\\| c<br \/><br \/>/); const parsed=await readMarkdownDocument(result.text); assert.deepEqual(parsed.model.blocks[0].rows[1][0].paragraphs.map(text),['a\nb | c','','<br /> &#10;']);
  await assert.rejects(documentToMarkdown(model([{id:'t',kind:'table',columnWidths:[1],rows:[[{paragraphs:[{...p('h','h','heading'),level:1}]}]]} ])),{code:'MARKDOWN_UNSUPPORTED_TABLE'});
});
test('explicit direction and source metadata have finite honest reports without reversing text', async () => {
  const input = model([{...p('p','שָׁלוֹם العربية'),direction:'rtl',runs:[run('שָׁלוֹם العربية','regular','rtl')],source:{pageNumber:1,source:'embedded'}}]); input.pages=[{number:1,source:'embedded'}]; input.warnings=[{code:'complex-layout',blockId:'p'}]; const before=structuredClone(input), result=await documentToMarkdown(input); assert.ok(has(result,'direction-unrepresented')); assert.ok(has(result,'source-references-unrepresented')); assert.ok(has(result,'source-warnings-unrepresented')); assert.deepEqual(input,before); assert.ok(result.text.includes('שָׁלוֹם العربية'));
});
test('model overrides reject without calls, cancellation preserves input and output owns its bytes', async () => {
  let calls=0; const input=model([p('p','good')]); Object.defineProperty(input.blocks,'map',{value(){calls++; return [];}}); await assert.rejects(documentToMarkdown(input),/Invalid document model/); assert.equal(calls,0);
  const actual=new AbortController();actual.signal.throwIfAborted=()=>{calls++;throw new Error('Controlled signal method');};assert.equal((await documentToMarkdown(model([p('p','good')]),{signal:actual.signal})).text,'good\n');assert.equal(calls,0);
  const long=model([p('p','x'.repeat(900000))]), before=long.blocks[0].runs[0].text; const stop=new AbortController(), operation=documentToMarkdown(long,{signal:stop.signal}); setTimeout(()=>stop.abort(),0); await assert.rejects(operation,{name:'AbortError'}); assert.equal(long.blocks[0].runs[0].text,before);
  const result=await documentToMarkdown(model([p('p','successor')])), bytes=result.bytes; bytes.fill=()=>{throw new Error('Controlled fill');}; result.dispose(); result.dispose(); assert.ok(Uint8Array.prototype.every.call(bytes,byte=>byte===0)); assert.equal(result.text,'successor\n');
});
test('delimiter flank boundaries and long inline-code prefix keep every character and requested style', async () => {
  const cases=[[run('letter'),run(' *edge ','bold'),run('tail')],[run('<#``ع* _>\t&\\* )','code'),run('\tש:\t# +``__ *&b','bold'),run(')-[&: ع#שع\t:  .','bold')],[run('b]b_`:ש(\n)\\|+#\n','boldItalic'),run('#*\r\n+[a`[b\\ש+ a'),run('*.:b):))ع- `\n.ש','italic')]];
  const chars=runs=>runs.flatMap(run=>Array.from(run.text,char=>[char,run.style]));
  for(const runs of cases){const result=await documentToMarkdown(model([{...p('p',''),runs}])), parsed=await readMarkdownDocument(result.text); assert.equal(parsed.model.blocks.length,1); assert.deepEqual(chars(parsed.model.blocks[0].runs),chars(runs)); assert.ok(has(result,'safe-html-required'));}
  for(const value of ['', 'C# and literal ###']){const result=await documentToMarkdown(model([{...p('h',value,'heading'),level:3}])),parsed=await readMarkdownDocument(result.text);assert.equal(parsed.model.blocks[0].kind,'heading');assert.equal(parsed.model.blocks[0].level,3);assert.equal(text(parsed.model.blocks[0]),value);}
});
test('one-million literal escaped characters reopen beyond the old raw limit and expansion-specific bounds reject', async () => {
  const literal='*'.repeat(1000000),result=await documentToMarkdown(model([p('p',literal)])); assert.equal(result.text.length,2000001); const parsed=await readMarkdownDocument(result.text); assert.equal(text(parsed.model.blocks[0]),literal); assert.equal(parsed.usage.logicalTextUnits,1000000); result.dispose(); parsed.dispose();
  const emptyCells=Array.from({length:101},()=>Array.from({length:100},()=>({paragraphs:[]}))); await assert.rejects(documentToMarkdown(model([{id:'t',kind:'table',columnWidths:Array(100).fill(1),rows:emptyCells}])),{code:'MARKDOWN_LIMIT'});
  await assert.rejects(documentToMarkdown(model([{...p('code','','code'),runs:[run('\n'.repeat(100000),'code')]}])),{code:'MARKDOWN_LIMIT'});
});
test('output image names, actual PNG bytes and Buffer disposal are independently owned and deterministic', async () => {
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==','base64'),before=Buffer.from(bytes);
  Object.defineProperty(bytes,'slice',{value(){throw new Error('Input slice called');}});
  const input=model([{id:'i',kind:'image',assetId:'a',width:120,height:60},{id:'j',kind:'image',assetId:'a',width:120,height:60}]);input.assets=[{id:'a',type:'image/png',width:2,height:1,alt:'Red & blue'}]; const supplied=[{id:'a',type:'image/png',width:2,height:1,bytes}];
  const result=await documentToMarkdown(input,{assets:supplied});assert.equal(result.text,'![Red \\& blue](image-001.png)\n\n![Red \\& blue](image-001.png)\n');assert.equal(result.images.length,1);assert.deepEqual(Buffer.from(result.images[0].bytes),before);assert.notEqual(result.images[0].bytes.buffer,bytes.buffer);
  const {inflateSync}=await import('node:zlib');const png=result.images[0].bytes;let offset=8,idat=[];const crc=data=>{let c=0xffffffff;for(const byte of data){c^=byte;for(let i=0;i<8;i++)c=c>>>1^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;};while(offset<png.length){const view=new DataView(png.buffer,png.byteOffset+offset),size=view.getUint32(0),type=Buffer.from(png.subarray(offset+4,offset+8)).toString();assert.equal(view.getUint32(8+size),crc(png.subarray(offset+4,offset+8+size)));if(type==='IDAT')idat.push(png.subarray(offset+8,offset+8+size));offset+=size+12;}assert.deepEqual([...inflateSync(Buffer.concat(idat))],[0,255,0,0,0,0,255]);
  const owned=result.images[0].bytes;result.images.length=0;result.dispose();assert.ok(owned.every(byte=>byte===0));assert.deepEqual(Buffer.from(bytes),before);await assert.rejects(documentToMarkdown(input),{code:'MARKDOWN_ASSET_MISSING'});
  input.assets[0].alt=' '.repeat(10000);const edge=await documentToMarkdown(input,{assets:supplied}),parsed=await readMarkdownDocument(edge.text,{assets:edge.images.map(({name,type,bytes,width,height})=>({name,type,bytes,width,height}))});assert.equal(parsed.model.assets[0].alt,input.assets[0].alt);edge.dispose();parsed.dispose();
});
test('writer native Blob cancellation drains its first read and preserves the input before a clean successor', async () => {
  const native=Blob.prototype.arrayBuffer;let release,began,settled=false,drained=false,reads=0;const start=new Promise(resolve=>began=resolve),hold=new Promise(resolve=>release=resolve);
  Blob.prototype.arrayBuffer=async function(){reads++;const bytes=await native.call(this);began();await hold;drained=true;return bytes;};
  try{const {documentToMarkdown:write}=await import(`../public/js/core/document-markdown.js?held-writer=${Date.now()}`),stop=new AbortController(),reason=new Error('test cancellation');const input=model([{id:'i',kind:'image',assetId:'a',width:2,height:1}]);input.assets=[{id:'a',type:'image/png',width:2,height:1,alt:'red blue'}];const before=structuredClone(input),pending=write(input,{assets:[{id:'a',type:'image/png',bytes:new Blob([Buffer.from(PNG_BASE64,'base64')]),width:2,height:1}],signal:stop.signal});pending.finally(()=>settled=true).catch(()=>{});await start;stop.abort(reason);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(settled,false);assert.equal(drained,false);assert.equal(reads,1);release();await assert.rejects(pending,error=>error===reason);assert.equal(drained,true);assert.deepEqual(input,before);assert.equal((await write(model([p('p','clean successor')]))).text,'clean successor\n');}finally{release?.();Blob.prototype.arrayBuffer=native;}
});
test('portable structural artifact bundle has independent marker, literal and owned-media assertions', async () => {
  const literal='  2 * 3 * 4, snake_case [x](url) &amp; <br /> <!-- -->\t\r\nשָׁלוֹם العربية  ';
  const input=model([p('literal',literal)]);input.lists=[{id:'list',ordered:true,start:7}];const item=(id,level,value,restart)=>({...p(id,id,'list-item'),list:{id:'list',level,value,restart}});input.blocks.push(item('parent',0,7,true),item('child',1,12,true),item('next',0,8,false),item('restart',0,20,true),{id:'t',kind:'table',columnWidths:[1,2],rows:[[{paragraphs:[p('h1','Name')]},{paragraphs:[p('h2','Value')]}],[{paragraphs:[p('c1','a\nb'),p('c2',''),p('c3','<br />') ]},{paragraphs:[p('c4','literal | pipe')]}]]},{...p('code','','code'),runs:[run('const n = 7;\n','code')]},{...p('exact','','code'),runs:[run('x\\*\rno final LF','code')]},{id:'i',kind:'image',assetId:'a',width:120,height:60});input.assets=[{id:'a',type:'image/png',width:2,height:1,alt:'Red & blue'}];
  const before=structuredClone(input),bytes=Buffer.from(PNG_BASE64,'base64'),result=await documentToMarkdown(input,{assets:[{id:'a',type:'image/png',bytes,width:2,height:1}]}),parsed=await readMarkdownDocument(result.text,{assets:result.images.map(({name,type,bytes,width,height})=>({name,type,bytes,width,height}))});
  assert.deepEqual(input,before);assert.equal(text(parsed.model.blocks[0]),literal);assert.match(result.text,/7\. parent\n {3}12\. child\n8\. next\n<!-- -->\n20\. restart/);assert.deepEqual(parsed.model.blocks.filter(block=>block.kind==='list-item').map(block=>[block.list.level,block.list.value]),[[0,7],[1,12],[0,8],[0,20]]);assert.deepEqual(parsed.model.blocks.find(block=>block.kind==='table').rows[1][0].paragraphs.map(text),['a\nb','','<br />']);assert.deepEqual(Buffer.from(result.images[0].bytes),bytes);
  if(process.env.BROWSERPDF_MARKDOWN_ARTIFACT_DIR){const {mkdir,writeFile}=await import('node:fs/promises'),{join}=await import('node:path'),directory=process.env.BROWSERPDF_MARKDOWN_ARTIFACT_DIR;await mkdir(directory,{recursive:true});const files={'literal.md':result.bytes,'source-model.json':JSON.stringify(input,null,2),'reopened-model.json':JSON.stringify(parsed.model,null,2),'report.json':JSON.stringify({writer:result.report,reader:parsed.report,writerUsage:result.usage,readerUsage:parsed.usage},null,2)};for(const image of result.images)files[image.name]=image.bytes;for(const [name,bytes]of Object.entries(files))await writeFile(join(directory,name),bytes);const normal=await documentToMarkdown(model([p('p','Hello world. Ordinary punctuation, yes!'),{...p('h','Readable title','heading'),level:2},{...p('code','','code'),runs:[run('const n = 7;\n','code')]}]));assert.equal(normal.text,'Hello world. Ordinary punctuation, yes!\n\n## Readable title\n\n```\nconst n = 7;\n```\n');await writeFile(join(directory,'readable.md'),normal.bytes);normal.dispose();}
  result.dispose();parsed.dispose();
});
test('literal tilde-fence prefixes escape only their active paragraph boundary and ordinary tilde prose stays readable', async () => {
  const cases=[['ordinary-tilde','ordinary ~ prose','ordinary ~ prose\n'],['ordinary-middle-run','ordinary ~~~ prose','ordinary ~~~ prose\n'],['single-tilde','~','~\n'],['double-tilde','~~','~~\n'],['double-with-text','~~js','~~js\n'],['literal-tilde-fence','~~~','\\~~~\n'],['literal-tilde-info','~~~~js','\\~~~~js\n']];
  const artifacts=[];
  for(const [name,literal,expected] of cases){const result=await documentToMarkdown(model([p('p',literal)]));assert.equal(result.text,expected);assert.deepEqual(result.bytes,new TextEncoder().encode(expected));assert.deepEqual(result.report,[]);const parsed=await readMarkdownDocument(result.text);assert.equal(parsed.model.blocks.length,1);assert.equal(parsed.model.blocks[0].kind,'paragraph');assert.deepEqual(parsed.model.blocks[0].runs.map(run=>[run.text,run.style]),[[literal,'regular']]);artifacts.push({name,literal,saved:result.text,writerReport:result.report,readerReport:parsed.report,blocks:parsed.model.blocks});if(process.env.BROWSERPDF_MARKDOWN_ARTIFACT_DIR){const {mkdir,writeFile}=await import('node:fs/promises'),{join}=await import('node:path'),directory=process.env.BROWSERPDF_MARKDOWN_ARTIFACT_DIR;await mkdir(directory,{recursive:true});await writeFile(join(directory,`${name}.md`),result.bytes);}result.dispose();parsed.dispose();}
  const intentional=await readMarkdownDocument('~~~js\nbody\n~~~');assert.equal(intentional.model.blocks[0].kind,'code');assert.equal(text(intentional.model.blocks[0]),'body\n');assert.ok(has(intentional,'code-info-unrepresented'));
  if(process.env.BROWSERPDF_MARKDOWN_ARTIFACT_DIR){const {writeFile}=await import('node:fs/promises'),{join}=await import('node:path');await writeFile(join(process.env.BROWSERPDF_MARKDOWN_ARTIFACT_DIR,'tilde-literal-prefixes.json'),JSON.stringify(artifacts,null,2));}
});
