import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import * as pdfLib from 'pdf-lib';
import {createDocumentDraft,assertDocumentWorkspaceBudget} from '../public/js/core/document-draft.js';
import {validateDocumentModel} from '../public/js/core/document-model.js';
import {buildDocxDocument,readDocxDocument,DOCX_MIME} from '../public/js/core/docx-document.js';
import {readMarkdownDocument} from '../public/js/core/markdown-document.js';
import {buildDocumentPdf,preflightDocumentPdf} from '../public/js/core/document-pdf.js';
import {admitOoxmlArchive} from '../public/js/core/ooxml-zip.js';
const MiB=1024*1024;
const base=()=>({taskId:'task',revision:0,generation:0,resourceBytes:0,resourceCount:0,retainedBytes:0});
const p=(id,text='',style='regular')=>({id,kind:'paragraph',direction:'auto',runs:[{text,style,direction:'auto'}]});
const model=blocks=>({version:1,origin:'text',pages:[],lists:[],blocks,assets:[],warnings:[]});
function bundle(input){const model=validateDocumentModel(input),modelBytes=new TextEncoder().encode(JSON.stringify(model)),sourceBytes=new Uint8Array([1,2,3]);let closed=false;return {model,modelBytes,sourceBytes,assets:[],report:[],usage:{},dispose(){if(!closed){closed=true;modelBytes.fill(0);sourceBytes.fill(0);}}};}
function fixture(m=model([p('p','literal')] )){let state=base();const owned=bundle(m),draft=createDocumentDraft(owned,{owner:state,sourceName:'source.md',sourceType:'text/markdown',sessionUsage:()=>state});return {draft,owned,state:()=>state,change:patch=>{state={...state,...patch};}};}
const target={blockId:'p',runIndex:0};
const edit=text=>({type:'replace-run-range',target,start:0,end:0,text});
function png(){const crc=bytes=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=n&1?n>>>1^0xedb88320:n>>>1;}return(n^0xffffffff)>>>0;};const chunk=(name,data)=>{const h=Buffer.alloc(4),type=Buffer.from(name),tail=Buffer.alloc(4);h.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([h,type,data,tail]);};const h=Buffer.alloc(13);h.writeUInt32BE(2);h.writeUInt32BE(1,4);h[8]=8;h[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);}
async function artifact(name,bytes){if(process.env.DOCUMENT_WORKSPACE_ARTIFACT_DIR){await fs.mkdir(process.env.DOCUMENT_WORKSPACE_ARTIFACT_DIR,{recursive:true});await fs.writeFile(path.join(process.env.DOCUMENT_WORKSPACE_ARTIFACT_DIR,name),bytes);}}

test('joint budget counts expanded JS ZIP bytes, private copies and existing resources with positive headroom',()=>{
  const s={...base(),resourceBytes:4*MiB,resourceCount:2,retainedBytes:10*MiB};const n=assertDocumentWorkspaceBudget(s,{resourceBytes:MiB,resourceCount:1,artifactBytes:2*MiB},{expandedBytes:3*MiB,expandedCount:7,resourceBytes:80*MiB,resourceCount:2});assert.equal(n.resourceBytes,88*MiB);assert.equal(n.resourceCount,12);assert.equal(n.retainedBytes,96*MiB);
  assert.throws(()=>assertDocumentWorkspaceBudget(s,{}, {expandedBytes:93*MiB}),e=>e.code==='DOCUMENT_DRAFT_LIMIT');assert.throws(()=>assertDocumentWorkspaceBudget(s,{}, {resourceCount:127}),e=>e.code==='DOCUMENT_DRAFT_LIMIT');assert.throws(()=>assertDocumentWorkspaceBudget({...s,retainedBytes:511*MiB},{artifactBytes:2*MiB}),e=>e.code==='DOCUMENT_DRAFT_LIMIT');assert.throws(()=>assertDocumentWorkspaceBudget(s,{}, {expandedBytes:Number.MAX_SAFE_INTEGER}),e=>e.code==='DOCUMENT_DRAFT_LIMIT');
  const hidden={};Object.defineProperty(hidden,'resourceBytes',{get(){assert.fail('accessor');}});assert.throws(()=>assertDocumentWorkspaceBudget(s,hidden),e=>e.code==='DOCUMENT_DRAFT_INPUT');
});

test('one active mutation rejects busy before inspecting the second producer or reserving copies',async()=>{
  const f=fixture();const first=f.draft.apply(edit('A'));const malicious=new Proxy({}, {getOwnPropertyDescriptor(){assert.fail('busy producer touched');}});await assert.rejects(()=>f.draft.apply(malicious),e=>e.code==='DOCUMENT_DRAFT_BUSY');const result=await first;assert.equal(result.busy,false);assert.equal(f.draft.model().blocks[0].runs[0].text,'Aliteral');f.draft.dispose();f.draft.dispose();
});

test('canonical/local ownership and genuine abort reasons guard the final commit without lost edits',async()=>{
  const f=fixture(),original=f.draft.model();const first=f.draft.apply(edit('discard'));f.change({generation:1});await assert.rejects(first,e=>e.code==='DOCUMENT_DRAFT_STALE');assert.equal(f.draft.model(),original);f.change({generation:0});
  const controller=new AbortController(),reason={abort:'exact'};controller.signal.throwIfAborted=()=>assert.fail('own override');const job=f.draft.apply(edit('cancel'),{signal:controller.signal});controller.abort(reason);await assert.rejects(job,e=>e===reason);assert.equal(f.draft.model(),original);
  await assert.rejects(()=>f.draft.apply(edit('bad'),{signal:{throwIfAborted(){}}}),e=>e.code==='DOCUMENT_DRAFT_INPUT');await f.draft.apply(edit('kept'));assert.equal(f.draft.model().blocks[0].runs[0].text,'keptliteral');f.draft.dispose();
});

test('literal CR/CRLF offset windows and style edits never normalize untouched source',async()=>{
  const text='A\r\nB\rC\nD 😀 * [x](y)\u00a0',f=fixture(model([p('p',text)])),window=f.draft.view({blockId:'p'}).window;assert.equal(window.text,'A\nB\nC\nD 😀 * [x](y)\u00a0');assert.deepEqual(window.sourceOffsets.slice(0,5),[0,1,3,4,5]);
  await f.draft.apply({type:'set-run-style',target,style:'italic'});assert.equal(f.draft.model().blocks[0].runs[0].text,text);await f.draft.apply({type:'replace-run-range',target,start:window.sourceOffsets[2],end:window.sourceOffsets[3],text:'β'});assert.equal(f.draft.model().blocks[0].runs[0].text,'A\r\nβ\rC\nD 😀 * [x](y)\u00a0');
  const at=f.draft.model().blocks[0].runs[0].text.indexOf('😀');await assert.rejects(()=>f.draft.apply({type:'split-run',target,offset:at+1}),e=>e.code==='DOCUMENT_DRAFT_INPUT');f.draft.dispose();
});

test('table cell paragraphs, reading order and actual requested styles survive edits/undo',async()=>{
  const m=model([p('p','one'),{id:'t',kind:'table',columnWidths:[1,1],rows:[[{paragraphs:[p('a','A'),p('b','B')]},{paragraphs:[]}]]},p('q','last')]),f=fixture(m);
  await f.draft.apply({type:'set-list',target:{blockId:'p'},ordered:true,level:0,value:7,restart:true});assert.equal(f.draft.model().blocks[0].list.value,7);f.draft.undo();f.draft.redo();await f.draft.apply({type:'insert-paragraph',target:{blockId:'t',cell:{row:0,column:1}},position:0});const id=f.draft.model().blocks[1].rows[0][1].paragraphs[0].id;
  await f.draft.apply({type:'insert-run',target:{blockId:'t',cell:{row:0,column:1},paragraphIndex:0},position:0,text:'12. literal',style:'bold',direction:'ltr'});assert.equal(f.draft.model().blocks[1].rows[0][1].paragraphs[0].id,id);assert.equal(f.draft.model().blocks[1].rows[0][1].paragraphs[0].runs[0].text,'12. literal');
  f.draft.clearUndo();await f.draft.apply({type:'move-block',target:{blockId:'q'},delta:-1});assert.deepEqual(f.draft.model().blocks.map(b=>b.id),['p','q','t']);assert.deepEqual((await preflightDocumentPdf(f.draft.model())).missingFontIds,['regular','bold']);f.draft.dispose();
});

test('three actual list edits preserve7/12/8, nested restart and shared identity through undo and saved DOCX',async()=>{
  const f=fixture(model([p('p','parent'),p('child','child'),p('next','next parent')]));
  await f.draft.apply({type:'set-list',target:{blockId:'p'},ordered:true,level:0,value:7,restart:true});const id=f.draft.model().blocks[0].list.id;
  await f.draft.apply({type:'set-list',target:{blockId:'child'},ordered:true,id,level:1,value:12,restart:true});
  await f.draft.apply({type:'set-list',target:{blockId:'next'},ordered:true,id,level:0,value:8,restart:false});
  const expected=[{id,level:0,value:7,restart:true},{id,level:1,value:12,restart:true},{id,level:0,value:8,restart:false}];assert.deepEqual(f.draft.model().blocks.map(b=>b.list),expected);f.draft.undo();assert.equal(f.draft.model().blocks[2].kind,'paragraph');f.draft.redo();assert.deepEqual(f.draft.model().blocks.map(b=>b.list),expected);
  const word=await buildDocxDocument(f.draft.model()),reopened=await readDocxDocument(word.bytes);assert.deepEqual(reopened.model.blocks.map(b=>[b.list.level,b.list.value,b.list.restart]),[[0,7,true],[1,12,true],[0,8,false]]);await artifact('edited-list-7-12-8.docx',word.bytes);reopened.dispose();f.draft.dispose();
});

test('six model versions reject transactionally without eviction and explicit history clear restores capacity',async()=>{
  const f=fixture();for(let i=0;i<5;i++)await f.draft.apply(edit(String(i)));const before=f.draft.model(),state=f.draft.snapshot();await assert.rejects(()=>f.draft.apply(edit('capacity')),e=>e.code==='DOCUMENT_DRAFT_LIMIT');assert.equal(f.draft.model(),before);assert.equal(f.draft.snapshot().revision,state.revision);assert.ok(f.draft.snapshot().canUndo);f.draft.clearUndo();await f.draft.apply(edit('after-clear'));assert.ok(f.draft.model().blocks[0].runs[0].text.startsWith('after-clear'));f.draft.dispose();
});

test('bounded projections/own-data admission, immutable borrowed model and captured disposal',async()=>{
  const f=fixture(model(Array.from({length:100},(_,i)=>p('p'+i,'x'.repeat(200)))));assert.equal(f.draft.view().blocks.length,40);assert.equal(f.draft.view().blocks[0].sample.length,120);assert.throws(()=>{f.draft.model().blocks[0].runs[0].text='tamper';},TypeError);await assert.rejects(()=>f.draft.apply({type:'set-paper',paper:'a4',landscape:false,margin:73}),e=>e.code==='DOCUMENT_DRAFT_INPUT');
  const before=Array.from(f.owned.sourceBytes),dispose=f.draft.dispose;f.owned.dispose=()=>assert.fail('overridden disposer');dispose();assert.deepEqual(before,[1,2,3]);assert.ok(f.owned.sourceBytes.every(n=>n===0));
});

test('real small DOCX/Markdown and all five pinned fonts fit conservative80MiB staging and save actual PDF',async t=>{
  const text='İstanbul Ελληνικά Кириллица',styles=['regular','bold','italic','boldItalic','code'],image=png(),m=model([...styles.map((style,i)=>p('s'+i,text,style)),{id:'table',kind:'table',columnWidths:[1,1],rows:[[{paragraphs:[p('left','LEFT | literal')]},{paragraphs:[p('right','RIGHT')]}]]},{id:'picture',kind:'image',assetId:'picture-asset',width:120,height:60}]);m.assets=[{id:'picture-asset',type:'image/png',width:2,height:1,alt:'Red and blue'}];const word=await buildDocxDocument(m,{assets:[{id:'picture-asset',type:'image/png',bytes:image,width:2,height:1}]}),sourceBefore=new Uint8Array(word.bytes),archive=await admitOoxmlArchive(word.bytes,{kind:'docx'}),expandedBytes=archive.stats.expandedBytes,expandedCount=archive.stats.entries;assert.ok(expandedBytes>image.length);assertDocumentWorkspaceBudget(base(),{},{expandedBytes,expandedCount});archive.dispose();const owned=await readDocxDocument(word.bytes),session=base();session.retainedBytes=word.bytes.length;
  const draft=createDocumentDraft(owned,{owner:session,sourceName:'real.docx',sourceType:DOCX_MIME,sessionUsage:()=>session});
  const retainedImage=draft.assets()[0].bytes,assetId=draft.model().assets[0].id,picture=draft.model().blocks.find(b=>b.kind==='image');assert.deepEqual(retainedImage,new Uint8Array(image));await draft.apply({type:'replace-image',target:{blockId:picture.id},assetId});await draft.apply({type:'remove-block',target:{blockId:picture.id}});assert.equal(draft.assets()[0].bytes,retainedImage);draft.undo();assert.equal(draft.model().blocks.at(-1).assetId,assetId);assert.deepEqual(retainedImage,new Uint8Array(image));
  const names=['NotoSans-Regular.ttf','NotoSans-Bold.ttf','NotoSans-Italic.ttf','NotoSans-BoldItalic.ttf','NotoSansMono-Regular.ttf'],fonts=await Promise.all(names.map(async(name,i)=>({id:styles[i],bytes:new Uint8Array(await fs.readFile(new URL('../public/fonts/'+name,import.meta.url)))})));
  const fontBytes=fonts.reduce((n,f)=>n+f.bytes.length,0),live=draft.snapshot();const headroom=assertDocumentWorkspaceBudget(session,{resourceBytes:live.resourceBytes+fontBytes,resourceCount:live.resourceCount+5,artifactBytes:live.artifactBytes},{resourceBytes:80*MiB+live.modelBytes,resourceCount:3});assert.ok(headroom.remainingResourceBytes>0);t.diagnostic(JSON.stringify({modelBytes:live.modelBytes,fontBytes,expandedBytes,expandedCount,reservedBytes:headroom.resourceBytes,headroom:headroom.remainingResourceBytes}));
  const context=vm.createContext({module:{exports:{}},exports:{},Uint8Array,ArrayBuffer,Buffer,console,setTimeout,clearTimeout});vm.runInContext(await fs.readFile(new URL('../public/vendor/fontkit-1.1.1.umd.min.js',import.meta.url),'utf8'),context);const result=await buildDocumentPdf(draft.model(),{pdfLib,fontkit:context.module.exports,fonts},{assets:draft.assets()});assert.ok(result.bytes.length>1000);assert.equal((await pdfLib.PDFDocument.load(result.bytes)).getPageCount(),1);assert.ok(result.layout.pages[0].items.some(i=>i.kind==='image'));await artifact('small-five-font-table-image.docx',word.bytes);await artifact('small-five-font-table-image.pdf',result.bytes);await artifact('small-five-font-table-image.layout.json',result.layoutBytes);result.dispose();draft.dispose();assert.ok(retainedImage.every(b=>b===0));assert.deepEqual(word.bytes,sourceBefore);
  const md=await readMarkdownDocument('# Heading\n\n1. Plain *literal?*\n'),other=createDocumentDraft(md,{owner:session,sourceName:'real.md',sourceType:'text/markdown',sessionUsage:()=>session});assert.ok(assertDocumentWorkspaceBudget(session,{resourceBytes:other.snapshot().resourceBytes,resourceCount:other.snapshot().resourceCount,artifactBytes:other.snapshot().artifactBytes},{resourceBytes:80*MiB+other.snapshot().modelBytes,resourceCount:3}).remainingResourceBytes>0);other.dispose();
});
