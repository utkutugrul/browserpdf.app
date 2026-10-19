import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentIntake} from '../public/js/document-intake.js';
import {readMarkdownDocument} from '../public/js/core/markdown-document.js';
import {preflightDocumentPdf} from '../public/js/core/document-pdf.js';
const MiB=1024*1024;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(create=createDocumentIntake,changes={}){let owner={taskId:'A',revision:0,generation:0},current='old good A',parsers=0,disposed=0;const usage=()=>({snapshot:{...owner,resourceBytes:0,resourceCount:0,retainedBytes:0},live:{}});const callbacks={getOwner:()=>owner,getUsage:usage,async readCandidate(bytes,info,ctx){parsers++;if(info.name==='bad.md')throw Error('malformed B');return {text:new TextDecoder().decode(bytes),dispose(){disposed++;}};},publishCandidate(candidate,ctx){ctx.assertCurrent();current=candidate.text;owner={taskId:ctx.descriptor.name,revision:0,generation:owner.generation+1};return {owner};},...changes};const lane=create(callbacks);return {lane,owner:()=>owner,current:()=>current,parsers:()=>parsers,disposed:()=>disposed};}
function file(name,text='hello'){return new File([text],name,{type:'text/markdown'});}
let serial=0;
async function heldReader(){const native=Blob.prototype.arrayBuffer,entered=deferred(),release=deferred(),reads=[];Blob.prototype.arrayBuffer=async function(){reads.push(this.name);const bytes=await native.call(this);if(reads.length===1){entered.resolve();await release.promise;}return bytes;};try{return {...await import(`../public/js/document-intake.js?held-read=${++serial}`),entered,release,reads};}finally{Blob.prototype.arrayBuffer=native;}}

test('one actual first File read plus only latest unread survives A/B/C spam; successor waits for drain',async()=>{
  const h=await heldReader(),f=setup(h.createDocumentIntake),A=f.lane.select(file('A.md','A'),{intent:1});await h.entered.promise;const B=f.lane.select(file('B.md','B'),{intent:2}),C=f.lane.select(file('C.md','C'),{intent:3});assert.equal((await B).status,'cancelled');assert.deepEqual(h.reads,['A.md']);assert.equal(f.parsers(),0);h.release.resolve();assert.equal((await A).status,'cancelled');assert.equal((await C).status,'accepted');await f.lane.drain();assert.deepEqual(h.reads,['A.md','C.md']);assert.equal(f.parsers(),1);assert.equal(f.current(),'C');await f.lane.dispose();
});

test('Clear and invalid native B suppress old initial delivery before parser/canonical publish',async()=>{
  for(const mode of ['Clear','invalid B']){const h=await heldReader(),f=setup(h.createDocumentIntake),A=f.lane.select(file('old.md','old initial'),{intent:0});await h.entered.promise;let invalid;if(mode==='Clear')f.lane.cancel('clear reason');else invalid=await f.lane.select(file('invalid.exe','B'),{intent:1});let drained=false;const drain=f.lane.drain().then(()=>drained=true);await new Promise(r=>setTimeout(r,5));assert.equal(drained,false);assert.equal(f.current(),'old good A');h.release.resolve();assert.equal((await A).status,'cancelled');await drain;assert.equal(f.parsers(),0);if(invalid)assert.equal(invalid.status,'rejected');const next=await f.lane.select(file('next.md','next'),{intent:2});assert.equal(next.status,'accepted');await f.lane.dispose();}
});

test('held FIRST parser candidate is disposed only after drain and cannot overwrite newer B',async()=>{
  const entered=deferred(),release=deferred(),controller=new AbortController(),reason={stage:'parser'};Object.defineProperty(controller.signal,'reason',{get(){assert.fail('own signal reason');}});let disposed=0;const f=setup(undefined,{async readCandidate(bytes,info){if(info.name==='held.md'){entered.resolve();await release.promise;}return {text:new TextDecoder().decode(bytes),dispose(){disposed++;}};}}),A=f.lane.select(file('held.md','A'),{intent:1,signal:controller.signal});await entered.promise;controller.abort(reason);const B=f.lane.select(file('B.md','B'),{intent:2});assert.equal(disposed,0);assert.equal(f.current(),'old good A');release.resolve();const abandoned=await A;assert.equal(abandoned.status,'cancelled');assert.equal(abandoned.reason,reason);assert.equal((await B).status,'accepted');assert.equal(disposed,1);await f.lane.dispose();
});

test('malformed/budget B retains A; explicit known JS expanded reservation is included before parser work',async()=>{
  const f=setup();assert.equal((await f.lane.select(file('bad.md'),{intent:1})).status,'rejected');assert.equal(f.current(),'old good A');let afterReservation=false;const g=setup(undefined,{async readCandidate(bytes,info,ctx){ctx.reserve({expandedBytes:97*MiB,expandedCount:7});afterReservation=true;assert.fail();}});const result=await g.lane.select(file('B.md'),{intent:1});assert.equal(result.status,'rejected');assert.equal(result.error.code,'DOCUMENT_DRAFT_LIMIT');assert.equal(afterReservation,false);assert.equal(g.current(),'old good A');await f.lane.dispose();await g.lane.dispose();
});

test('unsupported script B is a valid editable accepted source without fetching any font',async()=>{
  let bundle,fontRequests;const f=setup(undefined,{async readCandidate(bytes){bundle=await readMarkdownDocument(new TextDecoder().decode(bytes));fontRequests=(await preflightDocumentPdf(bundle.model)).fontRequests;return {...bundle,text:'שלום'};}});const result=await f.lane.select(file('hebrew.md','שלום'),{intent:1});assert.equal(result.status,'accepted');assert.equal(f.current(),'שלום');assert.deepEqual(fontRequests,[]);bundle.dispose();await f.lane.dispose();
});

test('native methods bypass own read overrides and actual external signal/canonical owner changes reject stale work',async()=>{
  const f=setup(),chosen=file('real.md','real');chosen.arrayBuffer=()=>assert.fail('own read');assert.equal((await f.lane.select(chosen,{intent:1})).status,'accepted');assert.equal(f.current(),'real');const controller=new AbortController(),reason={kind:'aborted'};controller.abort(reason);const result=await f.lane.select(file('cancel.md'),{intent:2,signal:controller.signal});assert.equal(result.status,'rejected');assert.equal(result.error,reason);assert.equal((await f.lane.select(file('x.md'),{intent:3,signal:{}})).status,'rejected');await f.lane.dispose();await f.lane.dispose();
});
