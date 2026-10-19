import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import * as pdfLib from 'pdf-lib';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { preflightDocumentPdf, buildDocumentPdf } from '../public/js/core/document-pdf.js';

globalThis.DOMMatrix ??= DOMMatrix; globalThis.ImageData ??= ImageData; globalThis.Path2D ??= Path2D;
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const root = new URL('../',import.meta.url), styles=['regular','bold','italic','boldItalic','code'];
const names=['NotoSans-Regular.ttf','NotoSans-Bold.ttf','NotoSans-Italic.ttf','NotoSans-BoldItalic.ttf','NotoSansMono-Regular.ttf'];
const source=await fs.readFile(new URL('public/vendor/fontkit-1.1.1.umd.min.js',root),'utf8');
const context=vm.createContext({module:{exports:{}},exports:{},Uint8Array,ArrayBuffer,Buffer,console,setTimeout,clearTimeout});vm.runInContext(source,context);const fontkit=context.module.exports;
const fonts=await Promise.all(styles.map(async(id,i)=>({id,bytes:await fs.readFile(new URL(`public/fonts/${names[i]}`,root))})));
const model=(blocks=[],extra={})=>({version:1,origin:'text',pages:[],lists:[],blocks,assets:[],warnings:[],...extra});
const para=(id,text,style='regular',extra={})=>({id,kind:'paragraph',direction:'auto',runs:[{text,style,direction:'auto'}],...extra});
const deps=(ids=styles)=>({pdfLib,fontkit,fonts:fonts.filter(f=>ids.includes(f.id))});
const allItems=r=>r.layout.pages.flatMap(p=>p.items);
const texts=r=>allItems(r).filter(i=>i.kind==='text').map(i=>i.text).join('');
async function parse(result,fn){const task=pdfjs.getDocument({data:new Uint8Array(result.bytes)});try{return await fn(await task.promise);}finally{await task.destroy();}}
async function extracted(result){return parse(result,async pdf=>{const pages=[];for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);pages.push((await p.getTextContent({disableNormalization:true})).items.filter(i=>i.str!==undefined).map(i=>i.str).join(''));}return pages;});}
async function savedGlyphText(result,expected) {
  const pdf=await pdfLib.PDFDocument.load(result.bytes),page=pdf.getPage(0),resources=page.node.Resources(),fontDict=resources.lookup(pdfLib.PDFName.of('Font'));
  const fonts=new Map();for(const [name,ref]of fontDict.entries()){const font=pdf.context.lookup(ref),stream=font.lookup(pdfLib.PDFName.of('ToUnicode')),cmap=new TextDecoder().decode(pdfLib.decodePDFRawStream(stream).decode()),mapping=new Map();for(const match of cmap.matchAll(/<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4,})>/g)){const bytes=match[2];let text='';for(let i=0;i<bytes.length;i+=4)text+=String.fromCharCode(parseInt(bytes.substring(i,i+4),16));mapping.set(match[1].toUpperCase(),text);}fonts.set(name.toString(),mapping);}
  const contents=page.node.Contents(),chunks=[];if(contents instanceof pdfLib.PDFArray)for(let i=0;i<contents.size();i++)chunks.push(pdf.context.lookup(contents.get(i)));else chunks.push(contents);let text='',active;
  for(const stream of chunks){const content=new TextDecoder().decode(pdfLib.decodePDFRawStream(stream).decode());for(const token of content.matchAll(/(\/[A-Za-z0-9-]+)\s+[0-9.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj/g)){if(token[1])active=fonts.get(token[1]);else for(let i=0;i<token[2].length;i+=4){const code=token[2].substring(i,i+4).toUpperCase();assert.ok(active.has(code),'saved glyph has explicit Unicode mapping');text+=active.get(code);}}}
  if(expected!==undefined)assert.equal(text,expected);return text;
}
const artifacts=process.env.DOCUMENT_PDF_ARTIFACT_DIR;
async function artifact(name,result){if(artifacts){await fs.mkdir(artifacts,{recursive:true});await fs.writeFile(path.join(artifacts,name+'.pdf'),result.bytes);await fs.writeFile(path.join(artifacts,name+'.layout.json'),result.layoutBytes);}}

test('empty, rule, image and hard-break-only models do not require or touch fontkit',async()=>{
  const hostile={get create(){throw Error('Fontkit must not be touched');}};
  for(const m of [model(),model([{id:'r',kind:'rule'}]),model([para('p','\r\n\n')])]){const p=await preflightDocumentPdf(m,{fontkit:hostile});assert.equal(p.status,'ready');assert.deepEqual(p.fontRequests,[]);p.dispose();const r=await buildDocumentPdf(m,{pdfLib,fontkit:hostile});assert.ok(r.bytes.length>100);r.dispose();}
  const canvas=createCanvas(2,1),ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,1,1);ctx.fillStyle='blue';ctx.fillRect(1,0,1,1);const bytes=canvas.toBuffer('image/png');
  const m=model([{id:'im',kind:'image',assetId:'a',width:100,height:50}],{assets:[{id:'a',type:'image/png',width:2,height:1,alt:''}]});
  const r=await buildDocumentPdf(m,{pdfLib,fontkit:hostile},{assets:[{id:'a',type:'image/png',bytes,width:2,height:1}]});assert.equal(r.usage.fontBytes,0);await artifact('font-free-image',r);r.dispose();
});

test('requests only actual styles and generated markers; headings never force bold',async()=>{
  const m=model([para('h','Title','italic',{kind:'heading',level:1}),para('empty','','bold')]);const r=await preflightDocumentPdf(m);assert.equal(r.status,'needs-fonts');assert.deepEqual(r.missingFontIds,['italic']);
  const n=model([para('l','','bold',{kind:'list-item',list:{id:'ls',level:0,value:7,restart:true}})],{lists:[{id:'ls',ordered:true,start:7}]});assert.deepEqual((await preflightDocumentPdf(n)).missingFontIds,['regular']);
  await assert.rejects(()=>preflightDocumentPdf(m,deps(['regular','italic'])),e=>e.code==='DOCUMENT_PDF_INPUT');
});

test('15 actual Turkish Greek Cyrillic/style saved artifacts retain logical glyph sequences',async()=>{
  const corpus=['İstanbul ıĞğŞşÇçÖöÜü','Ελληνικά Καλημέρα κόσμε','Привет мир Ёжик'];
  const blocks=[];for(const style of styles)for(let i=0;i<corpus.length;i++)blocks.push(para(`p-${style}-${i}`,corpus[i],style));
  const m=model(blocks),before=JSON.stringify(m),r=await buildDocumentPdf(m,deps());assert.equal(JSON.stringify(m),before);assert.equal(texts(r),blocks.map(p=>p.runs[0].text).join(''));
  const saved=(await extracted(r)).join('');for(const text of corpus)assert.equal(saved.split(text).length-1,5,text);await parse(r,async pdf=>{const names=new Set();for(let i=1;i<=pdf.numPages;i++)for(const item of (await (await pdf.getPage(i)).getTextContent()).items)if(item.fontName)names.add(item.fontName);assert.equal(names.size,5);});assert.equal(r.usage.fontBytes,2765852);await artifact('ltr15',r);r.dispose();
});

test('unsupported script, explicit direction, marks and bidi controls are precise before native work',async()=>{
  const cases=[['שלום','script-unproved'],['السَّلَامُ','script-unproved'],['e\u0301','combining-positioning-unproved'],['a\u200fb','bidi-controls-unproved'],['a\u2028b','font-logical-mapping-unproved']];
  for(const [text,code]of cases){const r=await preflightDocumentPdf(model([para('p',text)]));assert.equal(r.status,'unsupported');assert.deepEqual(r.fontRequests,[]);assert.ok(r.issues.some(i=>i.code===code));}
  const r=await preflightDocumentPdf(model([para('p','abc','regular',{direction:'rtl'})]));assert.equal(r.issues[0].code,'direction-unproved');
});

test('literal whitespace and math remain model-exact; PDF projection records original ranges',async()=>{
  const input='  A\u00a0 B\tC\r\n\rD\n  1/2 * x ** [a](b) <tag>  ',m=model([para('p',input)]),before=JSON.stringify(m);
  const r=await buildDocumentPdf(m,deps(['regular']));assert.equal(JSON.stringify(m),before);const items=allItems(r),br=items.filter(x=>x.kind==='break'&&x.reason.startsWith('source-'));
  assert.deepEqual(br.map(x=>[x.reason,x.sourceText]),[['source-crlf','\r\n'],['source-cr','\r'],['source-lf','\n']]);for(const b of br)assert.equal(input.substring(b.start,b.end),b.sourceText);
  assert.ok(texts(r).startsWith('  A\u00a0 B'));assert.equal((await extracted(r)).join('').replace(/\s/g,''),input.replace(/\s/g,''));await savedGlyphText(r,texts(r));assert.ok(texts(r).endsWith('  1/2 * x ** [a](b) <tag>  '));
  const c=items.find(x=>x.kind==='text'&&x.text.startsWith('C'));assert.ok(Math.abs(c.x-84)<1e-6);const report=r.report.find(x=>x.code.endsWith('control-whitespace-projected'));assert.deepEqual([report.tabs,report.cr,report.crlf],[1,1,1]);await artifact('literal-controls',r);r.dispose();
});

test('code indentation and long tokens wrap without dropping literal characters',async()=>{
  const input='    a\tb\n'+('xyz~*_'.repeat(110)),m=model([para('p',input,'code',{kind:'code'})]);const r=await buildDocumentPdf(m,deps(['code']));
  assert.equal(texts(r).replace(/ /g,''),input.replace(/[ \t\n]/g,''));assert.ok(r.report.some(x=>x.code.endsWith('code-wrapped')));assert.ok(allItems(r).some(x=>x.kind==='break'&&x.reason==='wrap'));await artifact('code-wrap',r);r.dispose();
});

test('actual list values and nested restart 7 child12 parent8 are explicit independent markers',async()=>{
  const blocks=[7,12,8].map((value,i)=>para('l'+i,'item','italic',{kind:'list-item',list:{id:'list',level:i===1?1:0,value,restart:i<2}}));
  const r=await buildDocumentPdf(model(blocks,{lists:[{id:'list',ordered:true,start:7}]}),deps(['regular','italic']));const markers=allItems(r).filter(i=>i.kind==='marker');assert.deepEqual(markers.map(i=>[i.text,i.listLevel,i.restart]),[['7.',0,true],['12.',1,true],['8.',0,false]]);
  assert.ok((await extracted(r)).join('').includes('12.'));await artifact('nested-list',r);r.dispose();
});

test('table preserves paragraphs/styles and synchronizes tall-row page bands',async()=>{
  const cell=(id,text,style)=>({paragraphs:[para(id+'a',text,style),para(id+'b','tail','regular')]});const long='line\n'.repeat(90);
  const m=model([{id:'table',kind:'table',columnWidths:[1,1],rows:[[cell('left',long,'italic'),cell('right','R1\nR2','bold')]]}]);const r=await buildDocumentPdf(m,deps(['regular','italic','bold']));
  assert.ok(r.layout.pages.length>=2);assert.ok(r.report.some(x=>x.code.endsWith('table-row-split')));assert.equal(texts(r).match(/line/g).length,90);assert.equal(texts(r).match(/tail/g).length,2);assert.ok(texts(r).includes('R1'));for(const page of r.layout.pages)assert.ok(page.items.some(i=>i.kind==='border'));
  await artifact('table-long-row',r);r.dispose();
});

test('page breaks keep intentional blank pages and exact Letter/A4 landscape geometry',async()=>{
  const r=await buildDocumentPdf(model([{id:'b1',kind:'page-break'},{id:'b2',kind:'page-break'},para('p','last')]),deps(['regular']),{paper:'a4',landscape:true,margin:72});assert.equal(r.layout.pages.length,3);assert.equal(r.layout.paper.width,841.89);assert.equal(r.layout.paper.height,595.28);assert.equal(allItems(r).find(x=>x.kind==='text').x,72);
  await parse(r,async pdf=>{assert.equal(pdf.numPages,3);assert.deepEqual((await pdf.getPage(3)).view,[0,0,841.89,595.28]);});r.dispose();
});

test('actual PNG/JPEG are copied, rendered with independent pixel colors and disposed safely',async()=>{
  for(const type of ['image/png','image/jpeg']){const c=createCanvas(20,10),ctx=c.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,10,10);ctx.fillStyle='#0000ff';ctx.fillRect(10,0,10,10);const input=c.toBuffer(type),original=Buffer.from(input);
    const r=await buildDocumentPdf(model([{id:'im',kind:'image',assetId:'a',width:200,height:100}],{assets:[{id:'a',type,width:20,height:10,alt:''}]}),{pdfLib},{assets:[{id:'a',type,bytes:input,width:20,height:10}]});
    await parse(r,async pdf=>{const p=await pdf.getPage(1),v=p.getViewport({scale:1}),canvas=createCanvas(v.width,v.height);await p.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;const a=canvas.getContext('2d').getImageData(80,80,1,1).data,b=canvas.getContext('2d').getImageData(210,80,1,1).data;assert.ok(a[0]>200&&a[2]<50);assert.ok(b[2]>200&&b[0]<50);});await artifact(type==='image/png'?'two-color-png':'two-color-jpeg',r);const out=r.bytes;r.bytes=new Uint8Array([1]);r.dispose();r.dispose();assert.ok(out.every(x=>x===0));assert.deepEqual(input,original);
  }
});

test('own-key, overridden arrays/bytes, pin and dimension controls cannot bypass admission',async()=>{
  const input=Buffer.from(fonts[0].bytes),copy=Buffer.from(input);input.slice=()=>{throw Error('slice called');};input[Symbol.iterator]=()=>{throw Error('iterator called');};
  const r=await buildDocumentPdf(model([para('p','Buffer')]),{pdfLib,fontkit,fonts:[{id:'regular',bytes:input}]});r.dispose();assert.deepEqual(Buffer.from(input.buffer,input.byteOffset,input.byteLength),copy);
  const array=[para('p','x')];Object.defineProperty(array,'map',{value:()=>[],enumerable:false});await assert.rejects(()=>preflightDocumentPdf(model(array)),e=>e.code==='DOCUMENT_PDF_INPUT');
  const bad=Buffer.from(fonts[0].bytes);bad[50]^=1;await assert.rejects(()=>preflightDocumentPdf(model([para('p','x')]),{fontkit,fonts:[{id:'regular',bytes:bad}]}),e=>e.code==='DOCUMENT_PDF_FONT_INTEGRITY');
  await assert.rejects(()=>preflightDocumentPdf(model(),{}, {margin:73}),e=>e.code==='DOCUMENT_PDF_INPUT');await assert.rejects(()=>preflightDocumentPdf(model(),{}, {signal:{throwIfAborted(){}}}),e=>e.code==='DOCUMENT_PDF_INPUT');
});

test('page, narrow-column and model bounds reject transactionally with valid successor',async()=>{
  const blocks=Array.from({length:1000},(_,i)=>({id:'b'+i,kind:'page-break'}));await assert.rejects(()=>preflightDocumentPdf(model(blocks)),e=>e.code==='DOCUMENT_PDF_LIMIT');
  await assert.rejects(()=>buildDocumentPdf(model([{id:'t',kind:'table',columnWidths:[0.001,1000000],rows:[[{paragraphs:[para('a','a')]},{paragraphs:[para('b','b')]}]]}]),deps(['regular'])),e=>e.code==='DOCUMENT_PDF_LIMIT');
  await assert.rejects(()=>preflightDocumentPdf(model([para('p','x'.repeat(500001)),para('q','x'.repeat(500001))])),e=>e.code==='DOCUMENT_PDF_LIMIT');const r=await buildDocumentPdf(model([para('ok','successor')]),deps(['regular']));assert.deepEqual(await extracted(r),['successor']);r.dispose();
});

function heldPdf(stage){let release,entered;const started=new Promise(r=>entered=r),held=new Promise(r=>release=r);let pending=0;const fake={PDFDocument:{async create(){const pdf=await pdfLib.PDFDocument.create();const native=pdf[stage].bind(pdf);pdf[stage]=async(...args)=>{pending++;entered();await held;try{return await native(...args);}finally{pending--;}};return pdf;}}};return {fake,started,release:()=>release(),pending:()=>pending};}
for(const stage of ['embedFont','save'])test(`first ${stage} native promise drains before abort settles and valid successor`,async()=>{
  const h=heldPdf(stage),controller=new AbortController(),reason={stage},m=model([para('p','held')]);let settled=false;const job=buildDocumentPdf(m,{...deps(['regular']),pdfLib:h.fake},{signal:controller.signal}).then(()=>{settled=true;assert.fail('must abort');},e=>{settled=true;assert.equal(e,reason);});
  await h.started;controller.abort(reason);await new Promise(r=>setTimeout(r,10));assert.equal(settled,false);assert.equal(h.pending(),1);h.release();await job;assert.equal(h.pending(),0);const r=await buildDocumentPdf(m,deps(['regular']));assert.deepEqual(await extracted(r),['held']);r.dispose();
});

test('native Blob read uses intrinsic method and already-aborted reason identity',async()=>{
  const canvas=createCanvas(1,1),bytes=canvas.toBuffer('image/png'),blob=new Blob([bytes]);blob.arrayBuffer=()=>{throw Error('own method called');};const controller=new AbortController();controller.abort('cancelled');
  const m=model([{id:'im',kind:'image',assetId:'a',width:10,height:10}],{assets:[{id:'a',type:'image/png',width:1,height:1,alt:''}]});await assert.rejects(()=>buildDocumentPdf(m,{pdfLib},{assets:[{id:'a',type:'image/png',bytes:blob,width:1,height:1}],signal:controller.signal}),e=>e==='cancelled');const r=await buildDocumentPdf(m,{pdfLib},{assets:[{id:'a',type:'image/png',bytes:blob,width:1,height:1}]});r.dispose();
});


test('independent saved text geometry and raster pixels preserve code leading-space indentation',async()=>{
  const r=await buildDocumentPdf(model([para('a','X','code',{kind:'code'}),para('b','    X','code',{kind:'code'})]),deps(['code']));
  await parse(r,async pdf=>{const p=await pdf.getPage(1),content=await p.getTextContent({disableNormalization:true}),items=content.items.filter(i=>i.str?.includes('X'));assert.equal(items.length,2);const expected=allItems(r).filter(i=>i.kind==='text');assert.ok(Math.abs(items[1].width-items[0].width)<1e-4);assert.ok(Math.abs(items[1].transform[4]-items[0].transform[4]-24)<1e-4);
    const v=p.getViewport({scale:2}),canvas=createCanvas(v.width,v.height),ctx=canvas.getContext('2d');await p.render({canvasContext:ctx,viewport:v}).promise;
    function left(top,bottom){const image=ctx.getImageData(0,Math.floor(top*2),canvas.width,Math.ceil((bottom-top)*2));let min=Infinity;for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const at=(y*image.width+x)*4;if(image.data[at]<100&&image.data[at+1]<100&&image.data[at+2]<100)min=Math.min(min,x);}return min;}
    const a=left(48,61.5),b=left(67.5,81);assert.ok(Number.isFinite(a)&&Number.isFinite(b));assert.ok(Math.abs((b-a)-48)<2,'four actual 6pt monospace spaces');});await artifact('visible-code-indent',r);r.dispose();
});

test('held FIRST intrinsic Blob read drains before abort rejection; image embed also drains',async()=>{
  const bytes=createCanvas(1,1).toBuffer('image/png'),blob=new Blob([bytes]),m=model([{id:'im',kind:'image',assetId:'a',width:10,height:10}],{assets:[{id:'a',type:'image/png',width:1,height:1,alt:''}]}),assets=[{id:'a',type:'image/png',bytes:blob,width:1,height:1}];
  let release,entered,pending=0;const hold=new Promise(r=>release=r),started=new Promise(r=>entered=r),original=Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer=async function(){pending++;entered();await hold;try{return await original.call(this);}finally{pending--;}};
  let isolated;try{isolated=await import('../public/js/core/document-pdf.js?read-drain-control');}finally{Blob.prototype.arrayBuffer=original;}
  const controller=new AbortController(),reason={kind:'read'};let settled=false;const job=isolated.buildDocumentPdf(m,{pdfLib},{assets,signal:controller.signal}).then(()=>assert.fail(),e=>{settled=true;assert.equal(e,reason);});await started;controller.abort(reason);await new Promise(r=>setTimeout(r,10));assert.equal(settled,false);assert.equal(pending,1);release();await job;assert.equal(pending,0);
  const h=heldPdf('embedPng'),abort=new AbortController();settled=false;const draw=buildDocumentPdf(m,{pdfLib:h.fake},{assets,signal:abort.signal}).then(()=>assert.fail(),e=>{settled=true;assert.equal(e,'image');});await h.started;abort.abort('image');await new Promise(r=>setTimeout(r,10));assert.equal(settled,false);h.release();await draw;assert.equal(h.pending(),0);const r=await buildDocumentPdf(m,{pdfLib},{assets});r.dispose();
});


test('TypeError abort reasons retain identity and native failed saves do not publish',async()=>{
  const controller=new AbortController(),reason=new TypeError('original reason');controller.abort(reason);await assert.rejects(()=>preflightDocumentPdf(model(),{},{signal:controller.signal}),e=>e===reason);
  const m=model([para('p','save failure')]),failed={PDFDocument:{async create(){const p=await pdfLib.PDFDocument.create();p.save=async()=>{throw reason;};return p;}}};await assert.rejects(()=>buildDocumentPdf(m,{...deps(['regular']),pdfLib:failed}),e=>e===reason);const r=await buildDocumentPdf(m,deps(['regular']));assert.deepEqual(await extracted(r),['save failure']);r.dispose();
});


test('cross-run CRLF has one visual advance and two adjacent co-located source-range records',async()=>{
  const m=model([{id:'p',kind:'paragraph',direction:'ltr',runs:[{text:'A\r',style:'regular',direction:'auto'},{text:'',style:'bold',direction:'auto'},{text:'\nB\rC\nD\r\nE',style:'italic',direction:'ltr'}]}]);const before=JSON.stringify(m),r=await buildDocumentPdf(m,deps(['regular','italic'])),items=allItems(r),breaks=items.filter(i=>i.kind==='break');
  assert.equal(JSON.stringify(m),before);assert.deepEqual(breaks.map(i=>[i.reason,i.runIndex,i.start,i.end,i.sourceText]),[['source-cr',0,1,2,'\r'],['source-lf',2,0,1,'\n'],['source-cr',2,2,3,'\r'],['source-lf',2,4,5,'\n'],['source-crlf',2,6,8,'\r\n']]);assert.equal(breaks[0].x,breaks[1].x);assert.equal(breaks[0].y,breaks[1].y);const text=items.filter(i=>i.kind==='text');const step=text[1].y-text[0].y;assert.ok(step>0);for(let i=2;i<text.length;i++)assert.ok(Math.abs(text[i].y-text[i-1].y-step)<1e-6);assert.equal(texts(r),'ABCDE');const report=r.report.find(i=>i.code.endsWith('control-whitespace-projected'));assert.deepEqual([report.cr,report.crlf],[1,2]);await savedGlyphText(r,'ABCDE');await artifact('cross-run-crlf',r);r.dispose();
});

test('native metrics see each actual run style only, using fresh fixed feature objects',async()=>{
  const seen=new Map(),spy={create(bytes){const id=styles[names.findIndex((_,i)=>createHash('sha256').update(bytes).digest('hex')===createHash('sha256').update(fonts[i].bytes).digest('hex'))],f=fontkit.create(bytes),native=f.layout.bind(f);f.layout=(text,features)=>{if(!seen.has(id))seen.set(id,[]);assert.deepEqual(features,{kern:false,liga:false,clig:false});seen.get(id).push(text);return native(text,features);};return f;}};
  const m=model([{id:'p',kind:'paragraph',direction:'auto',runs:[{text:'Regular only',style:'regular',direction:'auto'},{text:'Bold only',style:'bold',direction:'auto'}]}]);const p=await preflightDocumentPdf(m,{...deps(['regular','bold']),fontkit:spy});assert.equal(p.status,'ready');assert.deepEqual(seen.get('regular'),['Regular only']);assert.deepEqual(seen.get('bold'),['Bold only']);p.dispose();
  const missing=await preflightDocumentPdf(model([para('p','\u{1df00}')]),deps(['regular']));assert.equal(missing.status,'unsupported');assert.ok(missing.issues.some(i=>i.code==='glyph-missing'));
});

test('preflight ownership, ArrayBuffer font input, hidden options and native post-save guard',async()=>{
  const input=fonts[0].bytes.buffer.slice(fonts[0].bytes.byteOffset,fonts[0].bytes.byteOffset+fonts[0].bytes.byteLength),original=new Uint8Array(input).slice(),p=await preflightDocumentPdf(model([para('p','owned')]),{fontkit,fonts:[{id:'regular',bytes:input}]});assert.equal(p.status,'ready');const owned=p.layoutBytes;p.layoutBytes=null;p.dispose();assert.ok(owned.every(x=>x===0));assert.deepEqual(new Uint8Array(input),original);
  const hidden={};Object.defineProperty(hidden,'margin',{value:48});await assert.rejects(()=>preflightDocumentPdf(model(),{},hidden),e=>e.code==='DOCUMENT_PDF_INPUT');await assert.rejects(()=>preflightDocumentPdf(model(),{},{margin:null}),e=>e.code==='DOCUMENT_PDF_INPUT');
  let saves=0;const oversize={PDFDocument:{async create(){const p=await pdfLib.PDFDocument.create();p.save=async()=>{saves++;return new Uint8Array(32*1024*1024+1);};return p;}}};await assert.rejects(()=>buildDocumentPdf(model(),{pdfLib:oversize}),e=>e.code==='DOCUMENT_PDF_LIMIT');assert.equal(saves,1);const r=await buildDocumentPdf(model(),{pdfLib});r.dispose();
});

test('image admission bounds and missing ownership fail before any native PDF work',async()=>{
  const m=model([{id:'im',kind:'image',assetId:'a',width:100,height:100}],{assets:[{id:'a',type:'image/png',width:3000,height:3000,alt:''}]});let creates=0;const spy={PDFDocument:{create(){creates++;throw Error('must not start');}}};
  await assert.rejects(()=>buildDocumentPdf(m,{pdfLib:spy},{assets:[{id:'a',type:'image/png',width:3000,height:3000,bytes:new Uint8Array(33)}]}),e=>e.code==='DOCUMENT_PDF_LIMIT');assert.equal(creates,0);
  await assert.rejects(()=>buildDocumentPdf(m,{pdfLib:spy}),e=>e.code==='DOCUMENT_PDF_ASSET');assert.equal(creates,0);
  const small=model([{id:'im',kind:'image',assetId:'a',width:10,height:10}],{assets:[{id:'a',type:'image/png',width:1,height:1,alt:''}]});await assert.rejects(()=>preflightDocumentPdf(small,{}, {assets:[{id:'a',type:'image/png',width:1,height:1,bytes:new Uint8Array(33)}]}),e=>e.code==='DOCUMENT_PDF_ASSET');
});


// Focused fresh-review regressions. Scheduling assertions count completed work,
// not machine-dependent milliseconds. Instrumentation is restored before assert.
async function observeLayoutAbort(m,dependencies,kind) {
  const controller=new AbortController(),reason={review:'bounded-layout',kind};
  const originalEncode=TextEncoder.prototype.encode,originalGet=Map.prototype.get;
  let anchored=false,encodes=0,encodesAtAbort=0,emptyRunGets=0,emptyRunGetsAtAbort=0,timerResolve;
  const timer=new Promise(resolve=>timerResolve=resolve);let outcome;
  TextEncoder.prototype.encode=function(value) {
    if(value.startsWith('{"kind":')) {
      encodes++;
      if(!anchored) {anchored=true;setTimeout(()=>{encodesAtAbort=encodes;emptyRunGetsAtAbort=emptyRunGets;controller.abort(reason);timerResolve();},0);}
    }
    return originalEncode.call(this,value);
  };
  Map.prototype.get=function(key){if(anchored&&key==='regular')emptyRunGets++;return originalGet.call(this,key);};
  try {
    try {const result=await preflightDocumentPdf(m,dependencies,{signal:controller.signal});outcome={resolved:result.status};result.dispose?.();}catch(error){outcome={originalReason:error===reason};}
    assert.ok(anchored,'the abort is scheduled only after actual layout starts');await timer;
  }finally {TextEncoder.prototype.encode=originalEncode;Map.prototype.get=originalGet;}
  return {...outcome,encodesAtAbort,emptyRunGetsAtAbort};
}
function emptyRuns(count){return Array.from({length:count},()=>({text:'',style:'regular',direction:'auto'}));}
function runParagraph(runs){return model([{id:'p',kind:'paragraph',direction:'auto',runs}]);}

test('review correction: LF plus 49,999 empty runs has linear charged work',async t=>{
  const source={text:'\n'.repeat(2000),style:'regular',direction:'auto'},small=await preflightDocumentPdf(runParagraph([source])),large=await preflightDocumentPdf(runParagraph([source,...emptyRuns(49999)]));
  try {assert.equal(large.status,'ready');assert.equal(large.usage.pages,44);assert.equal(large.usage.items,4001);
    const delta=(large.usage.workVisits-large.usage.modelBytes)-(small.usage.workVisits-small.usage.modelBytes);t.diagnostic(JSON.stringify({case:'LF-linear',workVisits:large.usage.workVisits,modelBytes:large.usage.modelBytes,chargedExtraRunVisits:delta}));assert.ok(delta>=4*49999,'all empty-run passes are charged');assert.ok(delta<=12*49999,'extra work is linear in runs, independent of LF count');
  }finally{small.dispose();large.dispose();}
});

for(const control of ['\n','\r','\t'])test(`review correction: ${JSON.stringify(control)} layout cancellation yields before allocating the whole sequence`,async t=>{
  const source={text:control.repeat(2000),style:'regular',direction:'auto'},m=runParagraph([source,...emptyRuns(control==='\n'?49999:0)]),observed=await observeLayoutAbort(m,control==='\t'?deps(['regular']):{},control);
  t.diagnostic(JSON.stringify({case:'control-layout-cancel',control,...observed}));assert.equal(observed.originalReason,true);assert.ok(observed.encodesAtAbort>0&&observed.encodesAtAbort<=512,'timer runs within a finite layout chunk');const next=await preflightDocumentPdf(model());assert.equal(next.status,'ready');next.dispose();
});

test('review correction: empty-run layout loop yields before traversing all remaining runs',async t=>{
  const observed=await observeLayoutAbort(runParagraph([{text:'X',style:'regular',direction:'auto'},...emptyRuns(12000)]),deps(['regular']),'empty-runs');t.diagnostic(JSON.stringify({case:'empty-run-layout-cancel',...observed}));assert.equal(observed.originalReason,true);assert.ok(observed.emptyRunGetsAtAbort>0&&observed.emptyRunGetsAtAbort<=256);const next=await buildDocumentPdf(model(),{pdfLib});next.dispose();
});

test('review correction: cross-run CRLF across a long empty-run gap is charged and advances once',async t=>{
  const p=await preflightDocumentPdf(runParagraph([{text:'\r',style:'regular',direction:'auto'},...emptyRuns(49998),{text:'\n',style:'regular',direction:'auto'}]));try{const breaks=allItems(p).filter(x=>x.kind==='break');assert.equal(p.status,'ready');assert.deepEqual(breaks.map(x=>[x.reason,x.runIndex,x.start,x.end,x.sourceText]),[['source-cr',0,0,1,'\r'],['source-lf',49999,0,1,'\n']]);assert.equal(breaks[0].x,breaks[1].x);assert.equal(breaks[0].y,breaks[1].y);assert.equal(allItems(p).filter(x=>x.kind==='empty-line').length,2);assert.ok(p.usage.workVisits-p.usage.modelBytes>=6*49998);assert.ok(p.usage.workVisits<32*1024*1024);t.diagnostic(JSON.stringify({case:'long-gap-cross-run-CRLF',workVisits:p.usage.workVisits,modelBytes:p.usage.modelBytes,items:p.usage.items}));}finally{p.dispose();}
});

test('review correction: unsupported source rejects every supplied font as unused without native work',async()=>{
  const unsupported=model([para('p','שלום')]),hostile={get create(){assert.fail('unsupported source must not inspect fontkit');}};
  const hidden={id:'regular',bytes:fonts[0].bytes};Object.defineProperty(hidden,'extra',{value:1});let read=0;const accessor={id:'regular',get bytes(){read++;return fonts[0].bytes;}};
  for(const supplied of [[null],[hidden],[accessor],[{id:'regular',bytes:fonts[0].bytes}],[{id:'other',bytes:new Uint8Array([1])}],[{id:'regular',bytes:fonts[0].bytes},{id:'regular',bytes:fonts[0].bytes}]])for(const source of [unsupported,model()])await assert.rejects(()=>preflightDocumentPdf(source,{fontkit:hostile,fonts:supplied}),e=>e.code==='DOCUMENT_PDF_INPUT');assert.equal(read,0);
  const result=await preflightDocumentPdf(unsupported,{fontkit:hostile,fonts:[]});assert.equal(result.status,'unsupported');assert.deepEqual(result.fontRequests,[]);const next=await preflightDocumentPdf(model([para('p','valid successor')]),deps(['regular']));assert.equal(next.status,'ready');next.dispose();
});
