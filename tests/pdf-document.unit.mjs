import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import * as pdfLib from 'pdf-lib';
import {DOMMatrix,ImageData,Path2D,createCanvas} from '@napi-rs/canvas';
import {readPdfDocument,PDF_DOCUMENT_LIMITS} from '../public/js/core/pdf-document.js';
import {assertDocumentWorkspaceBudget} from '../public/js/core/document-draft.js';
import {documentToMarkdown} from '../public/js/core/document-markdown.js';
import {readMarkdownDocument} from '../public/js/core/markdown-document.js';
import {buildDocxDocument,readDocxDocument} from '../public/js/core/docx-document.js';
import {documentToPlainText} from '../public/js/core/document-text.js';
const MiB=1024*1024,bytes=()=>new TextEncoder().encode('%PDF-owned fixture'),pause=()=>new Promise(r=>setTimeout(r,0)),gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const reason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
const item=(str,hasEOL=false,extra={})=>({str,dir:'ltr',transform:[12,0,0,12,30,100],width:100,height:12,fontName:'f1',hasEOL,...extra});
const chunk=(items=[],styles={})=>({items,styles,lang:null});
function ledger(snapshot={resourceBytes:0,resourceCount:0,retainedBytes:0}){let usage={resourceBytes:0,resourceCount:0,artifactBytes:0},peak=0,calls=0;return {admitUsage(next){assertDocumentWorkspaceBudget(snapshot,{},next);usage=next;peak=Math.max(peak,next.resourceBytes);calls++;},get usage(){return usage;},get peak(){return peak;},get calls(){return calls;}};}
function fixture(definitions=[[chunk([item('literal')])]],options={}){
 const state={loads:0,destroys:0,cancels:0,cleanups:0,reads:0,pageCalls:0,workerData:null,streams:0};
 const pages=definitions.map((chunks,index)=>({view:[0,0,612,792],rotate:0,userUnit:1,...options.pageProperties,cleanup(){state.cleanups++;if(Object.hasOwn(options,'cleanupError'))throw options.cleanupError;return true;},streamTextContent(settings){assert.deepEqual(settings,{includeMarkedContent:false,disableNormalization:true});state.streams++;let at=0;options.onStream?.();return new ReadableStream({pull(controller){state.reads++;if(options.holdRead)return;const next=chunks[at++];if(next)controller.enqueue(next);else controller.close();},cancel(){state.cancels++;if(Object.hasOwn(options,'cancelError'))return Promise.reject(options.cancelError);return options.cancelGate?.promise;}});}}));
 const doc={numPages:pages.length,isPureXfa:!!options.xfa,getPage(number){state.pageCalls++;return options.pageGate?.promise??Promise.resolve(pages[number-1]);}};
 const pdfjs={getDocument(params){state.loads++;state.workerData=params.data;assert.equal(params.stopAtErrors,true);assert.equal(params.useSystemFonts,false);assert.equal(params.disableFontFace,true);assert.equal(params.enableXfa,false);options.onLoad?.();const promise=Object.hasOwn(options,'loadError')?Promise.reject(options.loadError):options.loadGate?.promise??Promise.resolve(doc);return {promise,destroy(){state.destroys++;if(Object.hasOwn(options,'destroyError'))return Promise.reject(options.destroyError);return options.destroyGate?.promise??Promise.resolve();}};}};
 return {pdfjs,state,doc,pages};
}
async function run(f,settings={},input=bytes(),l=ledger()){const result=await readPdfDocument(input,{pdfjs:f.pdfjs},{admitUsage:l.admitUsage,...settings});return {result,l};}
async function rejection(p){let present=false,value;await p.catch(e=>{present=true;value=e;});assert(present,'must reject even for a falsy payload');return value;}
async function until(predicate){for(let i=0;i<500;i++){if(predicate())return;await pause();}throw Error('held boundary was not reached');}
function literalRuns(model){return model.blocks.filter(b=>b.runs).flatMap(b=>b.runs.map(r=>r.text));}

test('literal items and synthesized boundaries are distinct; all page coverage survives',async()=>{
 const strings=['  *a!*b **x** [y] ~~~ & < > \u00a0','', 'שלום العربية e\u0301', ' \u00a0', '.'];
 const f=fixture([[chunk([item(strings[0],true),item(strings[1],true),item(strings[2],false,{dir:'rtl'})])],[],[],[chunk([item(strings[3])])],[chunk([item(strings[4])])]]),{result:r,l}=await run(f);
 assert.deepEqual(literalRuns(r.model),strings);assert.equal(r.model.pages.length,5);assert.deepEqual(r.extraction.pages.map(p=>p.status),['embedded','no-embedded-text','no-embedded-text','embedded','embedded']);assert.equal(r.model.blocks.filter(b=>b.kind==='page-break').length,4);assert.equal(r.extraction.items.length,5);
 for(const origin of r.extraction.items){const block=r.model.blocks.find(b=>b.id===origin.blockId);assert.equal(origin.start,0);assert.equal(origin.end,block.runs[origin.runIndex].text.length);assert.equal(block.source.pageNumber,origin.pageNumber);assert.equal(block.source.box,undefined);}
 assert.equal(r.usage.textUnits,strings.join('').length);assert(r.report.find(x=>x.code==='pdf-missing-text').count===2);assert(Object.isFrozen(r.extraction.items[0]));assert.equal(f.state.destroys,1);assert.equal(f.state.cleanups,5);assert.equal(l.usage.artifactBytes,bytes().length);const first=r.dispose();assert.strictEqual(first,r.dispose());await first;assert.equal(l.usage.resourceBytes,0);assert(r.sourceBytes.every(n=>n===0));assert(r.modelBytes.every(n=>n===0));assert(r.extractionBytes.every(n=>n===0));
});
test('mixed directions and rotated/skewed/vertical data preserve text without guessing styles or ink boxes',async()=>{
 const f=fixture([[chunk([item('left'),item('ימין',false,{dir:'rtl'}),item('vertical',true,{dir:'ttb',transform:[12,1,2,12,20,20]})])]],{pageProperties:{rotate:90}}),{result:r}=await run(f);
 assert.equal(r.model.blocks[0].direction,'auto');assert.deepEqual(r.model.blocks[0].runs.map(r=>r.direction),['ltr','rtl','auto']);assert(r.model.blocks[0].runs.every(r=>r.style==='regular'));assert.deepEqual(r.extraction.pages[0].flags,['rotated','skewed','vertical']);assert(r.model.warnings.some(x=>x.code==='complex-layout'));await r.dispose();
});
test('Buffer/subarray/subclass ownership ignores slice, species, iterators and own backing getters',async()=>{
 for(const original of [Buffer.from(bytes()),new(class extends Uint8Array{})(bytes()),new Uint8Array([0,...bytes(),0]).subarray(1,-1)]){
  const expected=Uint8Array.from(original);original.slice=()=>{throw Error('slice');};Object.defineProperty(original,'constructor',{value:{get [Symbol.species](){throw Error('species');}}});Object.defineProperty(original,Symbol.iterator,{value:()=>{throw Error('iterator');}});Object.defineProperty(original,'buffer',{get(){throw Error('own buffer');}});
  const {result:r}=await run(fixture(),{},original);assert.equal(Object.getPrototypeOf(r.sourceBytes),Uint8Array.prototype);assert.deepEqual(r.sourceBytes,expected);await r.dispose();assert.deepEqual(new Uint8Array(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'buffer').get.call(original),Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteOffset').get.call(original),expected.length),expected);
 }
});
test('actual ArrayBuffer accepted; resizable/shared/detached/duck/other views reject before runtime',async()=>{
 const good=bytes().buffer,{result}=await run(fixture(),{},good);await result.dispose();assert(new Uint8Array(good).some(n=>n));
 const detached=bytes().buffer;structuredClone(detached,{transfer:[detached]});const bad=[detached,new Uint16Array(5),new Blob([bytes()]),{byteLength:5},new Uint8Array(new SharedArrayBuffer(12))];if(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')){bad.push(new ArrayBuffer(10,{maxByteLength:20}));bad.push(new Uint8Array(new ArrayBuffer(10,{maxByteLength:20})));}
 for(const input of bad){const f=fixture();await rejection(run(f,{},input));assert.equal(f.state.loads,0);}
});
test('required synchronous own admission and genuine signals precede input allocation',async()=>{
 const f=fixture();await rejection(readPdfDocument(bytes(),{pdfjs:f.pdfjs},{}));await rejection(readPdfDocument(bytes(),{pdfjs:f.pdfjs},{admitUsage:()=>Promise.resolve()}));await rejection(readPdfDocument(bytes(),{pdfjs:f.pdfjs},{admitUsage(){},signal:{aborted:false}}));assert.equal(f.state.loads,0);
});
test('ordinary document fits real joint budget; near96MiB/512MiB rejects before runtime and does not change prior ledger',async()=>{
 const small=ledger({resourceBytes:MiB,resourceCount:4,retainedBytes:2*MiB}),{result:r}=await run(fixture(),{},bytes(),small);assert(small.peak<6*MiB);await r.dispose();
 for(const snapshot of [{resourceBytes:95*MiB,resourceCount:0,retainedBytes:0},{resourceBytes:0,resourceCount:120,retainedBytes:0},{resourceBytes:0,resourceCount:0,retainedBytes:512*MiB-1}]){const f=fixture(),l=ledger(snapshot);await rejection(run(f,{},bytes(),l));assert.equal(f.state.loads,0);assert.equal(l.calls,0);}
});
test('final retained admission abort is observed before publication',async()=>{
 for(const payload of [null,false,0,'']){const controller=new AbortController(),f=fixture(),l=ledger();let reached=false;const error=await rejection(run(f,{signal:controller.signal,admitUsage(v){l.admitUsage(v);if(v.resourceCount===3){reached=true;controller.abort(payload);}}},bytes(),l));assert(reached);assert.strictEqual(error,payload);assert.equal(f.state.destroys,1);assert.equal(l.usage.resourceBytes,0);assert(f.state.workerData.every(n=>n===0));}
});
for(const payload of [null,false,0,''])test(`FIRST held read/cancel/destroy drains with exact abort payload ${JSON.stringify(payload)}`,async()=>{
 const controller=new AbortController(),cg=gate(),dg=gate(),f=fixture([[chunk([item('held')])]],{holdRead:true,cancelGate:cg,destroyGate:dg}),l=ledger();let settled=false,getters=0;Object.defineProperty(controller.signal,'reason',{get(){getters++;throw Error('own reason');}});Object.defineProperty(controller.signal,'aborted',{get(){getters++;throw Error('own aborted');}});
 const first=run(f,{signal:controller.signal},bytes(),l).finally(()=>settled=true),caught=first.catch(e=>e);await until(()=>f.state.reads>0);controller.abort(payload);await pause();assert.equal(f.state.cancels,1);assert.equal(f.state.destroys,1);assert.equal(settled,false);assert(l.usage.resourceBytes>0);assert(f.state.workerData.some(n=>n!==0));dg.resolve();await pause();assert.equal(settled,false,'held FIRST cancel alone must fence settlement');cg.resolve();assert.strictEqual(await caught,payload);assert.equal(getters,0);assert.equal(l.usage.resourceBytes,0);assert.equal(f.state.cancels,1);assert.equal(f.state.destroys,1);const {result}=await run(fixture());await result.dispose();
});
test('late fulfilled loading promise is registered and destroyed once before stale settlement',async()=>{
 const controller=new AbortController(),lg=gate(),dg=gate(),f=fixture(undefined,{loadGate:lg,destroyGate:dg}),l=ledger();let settled=false;const promise=run(f,{signal:controller.signal},bytes(),l).finally(()=>settled=true),caught=promise.catch(e=>e);await until(()=>f.state.loads===1);controller.abort(false);lg.resolve(f.doc);await pause();assert.equal(f.state.pageCalls,0);assert.equal(settled,false);assert.equal(f.state.destroys,1);dg.resolve();assert.strictEqual(await caught,false);assert.equal(l.usage.resourceBytes,0);
});
test('late fulfilled getPage is cleaned before stale settlement without starting a reader',async()=>{
 const controller=new AbortController(),pg=gate(),f=fixture(undefined,{pageGate:pg}),l=ledger();const caught=run(f,{signal:controller.signal},bytes(),l).catch(e=>e);await until(()=>f.state.pageCalls===1);controller.abort(0);pg.resolve(f.pages[0]);assert.strictEqual(await caught,0);assert.equal(f.state.cleanups,1);assert.equal(f.state.streams,0);assert.equal(f.state.destroys,1);assert.equal(l.usage.resourceBytes,0);
});
test('reader created during synchronous abort is registered then cancelled exactly once',async()=>{
 const controller=new AbortController(),f=fixture(undefined,{onStream:()=>controller.abort('late-reader'),holdRead:true}),l=ledger();assert.equal(await rejection(run(f,{signal:controller.signal},bytes(),l)),'late-reader');assert.equal(f.state.cancels,1);assert.equal(f.state.destroys,1);assert.equal(l.usage.resourceBytes,0);
});
for(const phase of ['cancel','destroy','page'])test(`falsy ${phase} cleanup failure wins abort and retains charge/owned bytes`,async()=>{
 const controller=new AbortController(),options=phase==='page'?{cleanupError:false}:phase==='cancel'?{holdRead:true,cancelError:false}:{holdRead:true,destroyError:false},f=fixture(undefined,options),l=ledger();const job=run(f,{signal:controller.signal},bytes(),l);let observed;if(phase==='page')observed=await rejection(job);else{const caught=job.catch(e=>e);await until(()=>f.state.reads>0);controller.abort(null);observed=await caught;}
 assert.equal(observed.code,'PDF_DOCUMENT_CLEANUP');assert.strictEqual(observed.cause,false);assert(l.usage.resourceBytes>0);assert(f.state.workerData.some(n=>n!==0));assert.equal(f.state.destroys,1);assert(observed.ownedResources);
});
for(const payload of [null,false,0,''])test(`native load falsy failure ${JSON.stringify(payload)} remains a rejection after successful cleanup`,async()=>{const f=fixture(undefined,{loadError:payload}),l=ledger();assert.strictEqual(await rejection(run(f,{},bytes(),l)),payload);assert.equal(f.state.destroys,1);assert.equal(l.usage.resourceBytes,0);});
test('style-only and empty chunks are measured/charged/yielded without raw stringification',async()=>{
 const raw=chunk([],{f1:{fontFamily:'Family '+'.'.repeat(1000),ascent:1,descent:-.2,vertical:false}}),f=fixture([Array(130).fill(raw)]),stringify=JSON.stringify;let calls=0;JSON.stringify=function(value,...args){assert.notStrictEqual(value,raw);assert.notStrictEqual(value,raw.styles);return Reflect.apply(stringify,this,[value,...args]);};
 try{const {result:r}=await run(f,{admitUsage(){calls++;}});assert(calls>130);assert(r.usage.workVisits>130000);assert.equal(r.extraction.pages[0].status,'no-embedded-text');await r.dispose();}finally{JSON.stringify=stringify;}
});
test('style-only metadata overrun, oversized item/chunk and sparse/accessor/map data reject transactionally',async()=>{
 const styles={};for(let i=0;i<40;i++)styles['f'+i]={fontFamily:'x'.repeat(65536),ascent:1,descent:0,vertical:false};const sparse=[item('A'),item('B')];delete sparse[0];sparse.side=item('hidden');const getter=item('');Object.defineProperty(getter,'str',{get(){throw Error('accessor invoked');},enumerable:true});const mapArray=[item('')];mapArray.map=()=>[];
 const cases=[chunk([],styles),chunk([item('x'.repeat(65537))]),chunk(Array(2049).fill(item(''))),chunk(sparse),chunk([getter]),chunk(mapArray),chunk([item('bad\u0000')]),chunk([item('x',false,{transform:[NaN,0,0,1,0,0]})])];
 for(const c of cases){const f=fixture([[c]]),l=ledger();const e=await rejection(run(f,{},bytes(),l));assert(/^PDF_DOCUMENT_/.test(e.code));assert.notEqual(e.code,'PDF_DOCUMENT_CLEANUP');assert.equal(f.state.destroys,1);assert.equal(l.usage.resourceBytes,0);}
 const {result}=await run(fixture());await result.dispose();
});
test('page count/XFA/password/header/size states are precise and never invoke OCR',async()=>{
 for(const [override,expected]of [[{xfa:true},'UNSUPPORTED'],[{loadError:Object.assign(new Error('password'),{name:'PasswordException'})},'PASSWORD']]){const f=fixture(undefined,override);assert.equal((await rejection(run(f))).code,'PDF_DOCUMENT_'+expected);assert.equal(f.state.destroys,1);}
 for(const n of [0,1001]){const f=fixture();f.doc.numPages=n;assert.equal((await rejection(run(f))).code,'PDF_DOCUMENT_LIMIT');assert.equal(f.state.destroys,1);}
 for(const b of [new Uint8Array(4),new Uint8Array(PDF_DOCUMENT_LIMITS.sourceBytes+1),new TextEncoder().encode('wrong prefix')]){const f=fixture();await rejection(run(f,{},b));assert.equal(f.state.loads,0);}
});
test('aggregate chunk text, total logical text, paragraph and item caps reject without publishing partial data',async()=>{
 const long=item('x'.repeat(65536)),empty=item(''),line=item('',true),groups=[];
 groups.push([chunk([long,long,long])]);groups.push(Array.from({length:8},()=>chunk([long,long])));
 groups.push(Array.from({length:10},()=>chunk(Array(1000).fill(line))).concat(chunk([line])));
 groups.push(Array.from({length:25},()=>chunk(Array(2000).fill(empty))).concat(chunk([empty])));
 for(const chunks of groups){const f=fixture([chunks]),l=ledger(),e=await rejection(run(f,{},bytes(),l));assert.equal(e.code,'PDF_DOCUMENT_LIMIT');assert.equal(f.state.destroys,1);assert.equal(l.usage.resourceBytes,0);}
});
test('raw-copy and metadata-only scanning yield to genuine cancellation before completion',async()=>{
 const large=new Uint8Array(65536);large.set(bytes());const original=new Uint8Array(large),controller=new AbortController(),f=fixture(),l=ledger();setTimeout(()=>controller.abort(0),0);assert.strictEqual(await rejection(run(f,{signal:controller.signal},large,l)),0);assert.equal(f.state.loads,0);assert.deepEqual(large,original);assert.equal(l.usage.resourceBytes,0);
 const raw=chunk([],{f1:{fontFamily:'x'.repeat(65536),ascent:1,descent:0,vertical:false}}),next=new AbortController(),g=fixture([[raw]]),budget=ledger();let armed=false;const e=await rejection(run(g,{signal:next.signal,admitUsage(v){budget.admitUsage(v);if(g.state.reads&&!armed){armed=true;setTimeout(()=>next.abort(false),0);}}},bytes(),budget));assert.strictEqual(e,false);assert.equal(g.state.destroys,1);assert.equal(budget.usage.resourceBytes,0);
});
test('correction: FIRST disposal is published before release callback reentry',async()=>{
 const f=fixture(),l=ledger(),input=bytes(),original=new Uint8Array(input);let bundle,nested,releases=0;
 ({result:bundle}=await run(f,{admitUsage(next){if(next.resourceCount===0){releases++;if(releases===1)nested=bundle.dispose();}l.admitUsage(next);}},input,l));
 const first=bundle.dispose();await first;assert.strictEqual(nested,first);assert.strictEqual(bundle.dispose(),first);assert.equal(releases,1);assert.equal(l.usage.resourceBytes,0);assert.equal(f.state.destroys,1);assert.deepEqual(input,original);
 for(const owned of [bundle.sourceBytes,bundle.modelBytes,bundle.extractionBytes])assert(owned.every(n=>n===0));
 const {result:successor}=await run(fixture());await successor.dispose();
});
test('correction: reentrant FIRST disposal shares false cleanup failure and keeps its charge',async()=>{
 const f=fixture(),l=ledger();let bundle,nested,releases=0;
 ({result:bundle}=await run(f,{admitUsage(next){if(next.resourceCount===0){releases++;if(releases===1){nested=bundle.dispose();throw false;}}l.admitUsage(next);}},bytes(),l));
 const retained=l.usage,first=bundle.dispose(),error=await rejection(first);assert.strictEqual(nested,first);assert.strictEqual(bundle.dispose(),first);assert.strictEqual(await rejection(nested),error);assert.equal(error.code,'PDF_DOCUMENT_CLEANUP');assert.strictEqual(error.cause,false);assert(error.ownedResources);assert.equal(releases,1);assert.strictEqual(l.usage,retained);assert(l.usage.resourceBytes>0);assert.equal(f.state.destroys,1);
 // A failed release is a fence, so this reservation admits no successor or retry.
});
test('correction: actual raw-copy loop respects 16384 visits and aborts at its first quantum',async()=>{
 const sourceText=await fs.readFile(new URL('../public/js/core/pdf-document.js',import.meta.url),'utf8'),start=sourceText.indexOf('    for(let at=0;at<N;at+='),end=sourceText.indexOf('\n    check();const task=',start);assert(start>=0&&end>start);
 const actualLoop=sourceText.slice(start,end),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,copy=new AsyncFunction('source','sourceBytes','workerBytes','N','apply','set','visit','cooperate',actualLoop);
 const source=Uint8Array.from({length:65536},(_,i)=>(i%251)+1),sourceBytes=new Uint8Array(source.length),workerBytes=new Uint8Array(source.length),intervals=[];let pending=0,total=0;
 await copy(source,sourceBytes,workerBytes,source.length,Reflect.apply,Uint8Array.prototype.set,n=>{pending+=n;total+=n;},async()=>{intervals.push(pending);pending=0;});
 assert(intervals.length>0);assert(intervals.every(n=>n<=16384));assert.equal(total,2*source.length);assert.deepEqual(sourceBytes,source);assert.deepEqual(workerBytes,source);
 const controller=new AbortController(),abort=AbortSignal.prototype.throwIfAborted,partialSource=new Uint8Array(source.length),partialWorker=new Uint8Array(source.length);let beforeAbort=0,stops=0;
 const error=await rejection(copy(source,partialSource,partialWorker,source.length,Reflect.apply,Uint8Array.prototype.set,n=>beforeAbort+=n,async()=>{stops++;controller.abort(false);Reflect.apply(abort,controller.signal,[]);}));
 assert.strictEqual(error,false);assert.equal(stops,1);assert(beforeAbort<=16384);const copied=beforeAbort/2;assert(copied>0&&copied<source.length);assert.deepEqual(partialSource.subarray(0,copied),source.subarray(0,copied));assert.deepEqual(partialWorker.subarray(0,copied),source.subarray(0,copied));assert(partialSource.subarray(copied).every(n=>n===0));assert(partialWorker.subarray(copied).every(n=>n===0));
 const input=new Uint8Array(source);input.set(bytes());const original=new Uint8Array(input),f=fixture(),l=ledger(),cancelled=new AbortController();setTimeout(()=>cancelled.abort(0),0);assert.strictEqual(await rejection(run(f,{signal:cancelled.signal},input,l)),0);assert.equal(f.state.loads,0);assert.equal(l.usage.resourceBytes,0);assert.deepEqual(input,original);
 const next=fixture(),{result:successor}=await run(next,{},input);assert.deepEqual(next.state.workerData,input);assert.deepEqual(successor.sourceBytes,input);await successor.dispose();assert.deepEqual(input,original);
});
function zipParts(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length),out=new Map();let at=0;while(v.getUint32(at,true)===0x04034b50){assert.equal(v.getUint16(at+8,true),0);const nl=v.getUint16(at+26,true),xl=v.getUint16(at+28,true),size=v.getUint32(at+18,true),start=at+30+nl+xl,data=bytes.subarray(start,start+size),name=new TextDecoder().decode(bytes.subarray(at+30,at+30+nl));let crc=0xffffffff;for(const b of data){crc^=b;for(let n=0;n<8;n++)crc=crc&1?crc>>>1^0xedb88320:crc>>>1;}assert.equal((crc^0xffffffff)>>>0,v.getUint32(at+14,true));out.set(name,new TextDecoder().decode(data));at=start+size;}return out;}
const artifacts=process.env.PDF_DOCUMENT_ARTIFACT_DIR;
async function save(name,data){if(artifacts){await fs.mkdir(artifacts,{recursive:true});await fs.writeFile(path.join(artifacts,name),data);}}
test('actual installed PDF.js small PDF produces item-exact model and real escaped MD/DOCX XML+CRC/TXT artifacts',async()=>{
 globalThis.DOMMatrix??=DOMMatrix;globalThis.ImageData??=ImageData;globalThis.Path2D??=Path2D;const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),root=new URL('../',import.meta.url),source=await fs.readFile(new URL('public/vendor/fontkit-1.1.1.umd.min.js',root),'utf8'),context=vm.createContext({module:{exports:{}},exports:{},Uint8Array,ArrayBuffer,Buffer,console,setTimeout,clearTimeout});vm.runInContext(source,context);const fontkit=context.module.exports;
 const doc=await pdfLib.PDFDocument.create();doc.registerFontkit(fontkit);const font=await doc.embedFont(await fs.readFile(new URL('public/fonts/NotoSans-Regular.ttf',root)),{subset:true});doc.addPage([400,300]).drawText('  *literal* [x] ~~~ 7. İstanbul Ελληνικά Кириллица  ',{x:25,y:250,size:12,font});const canvas=createCanvas(2,1);canvas.getContext('2d').fillStyle='red';canvas.getContext('2d').fillRect(0,0,2,1);const png=await doc.embedPng(canvas.toBuffer('image/png'));doc.addPage([400,300]).drawImage(png,{x:25,y:100,width:120,height:60});canvas.width=canvas.height=0;doc.addPage([400,300]);const input=await doc.save(),original=Buffer.from(input),l=ledger();
 const referenceTask=pdfjs.getDocument({data:new Uint8Array(input),useSystemFonts:false,disableFontFace:true}),reference=[];try{const pdf=await referenceTask.promise;for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p),text=await page.getTextContent({includeMarkedContent:false,disableNormalization:true});reference.push(text.items.map(x=>({str:x.str,hasEOL:x.hasEOL})));}}finally{await referenceTask.destroy();}
 const r=await readPdfDocument(input,{pdfjs},{admitUsage:l.admitUsage});assert.deepEqual(literalRuns(r.model),reference.flat().map(x=>x.str));assert.deepEqual(r.extraction.items.map(x=>x.hasEOL),reference.flat().map(x=>x.hasEOL));assert.deepEqual(r.extraction.pages.map(p=>p.status),['embedded','no-embedded-text','no-embedded-text']);assert.equal(r.model.assets.length,0);assert.equal(r.model.blocks.filter(b=>b.kind==='page-break').length,2);const literal=literalRuns(r.model).join('');for(const marker of ['*literal*','[x]','~~~','7.','İstanbul','Ελληνικά','Кириллица'])assert(literal.includes(marker));
 const md=await documentToMarkdown(r.model),reopened=await readMarkdownDocument(md.text),txt=await documentToPlainText(r.model,{pageBreaks:true}),word=await buildDocxDocument(r.model),parts=zipParts(word.bytes),xml=parts.get('word/document.xml'),decodeXml=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&'),xmlText=Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g),x=>decodeXml(x[1])).join('');assert.equal(xmlText,literal);assert.equal((xml.match(/<w:br w:type="page"\/>/g)||[]).length,2);assert.equal(literalRuns(reopened.model).join(''),literal);assert.equal((txt.match(/\f/g)||[]).length,2);const readback=await readDocxDocument(word.bytes);assert.equal(literalRuns(readback.model).join(''),literal);
 await save('source.pdf',input);await save('extraction.json',r.extractionBytes);await save('model.json',r.modelBytes);await save('reference-items.json',JSON.stringify(reference,null,2));await save('literal.md',md.bytes);await save('literal.docx',word.bytes);await save('literal.txt',txt);await save('artifact-proof.json',JSON.stringify({sourceSha:createHash('sha256').update(input).digest('hex'),sourceBytes:input.length,literal,pages:r.extraction.pages,wordParts:[...parts.keys()],wordXml:xml,modelSha:createHash('sha256').update(r.modelBytes).digest('hex'),workVisits:r.usage.workVisits,peakResourceBytes:l.peak,nativeHeapBound:false},null,2));assert.deepEqual(Buffer.from(input),original);await readback.dispose();await reopened.dispose();await md.dispose();word.bytes.fill(0);await r.dispose();assert.equal(l.usage.resourceBytes,0);assert.deepEqual(Buffer.from(input),original);
});
