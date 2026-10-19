// Actual loader source in a controlled browser transport realm. No SDK, core,
// browser or real Worker executes; production exposes no dependency injection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {assertDocumentWorkspaceBudget} from '../public/js/core/document-draft.js';

const root=new URL('../',import.meta.url),source=fs.readFileSync(new URL('public/js/ocr-assets.js',root),'utf8');
const pins=JSON.parse(fs.readFileSync(new URL('public/vendor/ocr-7.0.0/manifest.json',root))).runtime;
const assets=new Map(Object.values(pins).map(p=>[p.url,new Uint8Array(fs.readFileSync(new URL('public'+p.url,root)))]));
const tick=()=>new Promise(r=>setTimeout(r,0));
async function until(fn){for(let i=0;i<1000;i++){if(fn())return;await tick();}throw Error('Controlled transport condition did not occur.');}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function png(){const b=new Uint8Array(33);b.set([137,80,78,71,13,10,26,10]);const v=new DataView(b.buffer);v.setUint32(8,13);b.set([73,72,68,82],12);v.setUint32(16,100);v.setUint32(20,50);return b;}
const page=()=>({pageId:'p1',width:100,height:50,text:'MERHABA İıÇçĞğÖöŞşÜü\n',confidence:71,lines:[{rawText:'MERHABA İıÇçĞğÖöŞşÜü\n',confidence:71,bbox:{x0:1,y0:1,x1:99,y1:40},baseline:{x0:1,y0:35,x1:99,y1:35},rowAttributes:{rowHeight:40,descenders:-4,ascenders:8},fonts:[{font_name:'Noto Sans',font_size:20}]}],counts:{words:2,symbols:18,choices:4}});

async function fixture(t,config={}){
 const world=new EventTarget(),state={fetches:[],hosts:[],urls:new Map(),revokes:[],posts:[],timers:new Map(),digestCalls:0,streamCancels:0,snapshot:{taskId:'task',revision:0,generation:0,resourceBytes:0,resourceCount:0,retainedBytes:0}};
 let context,task;const realm=value=>{context.__json=JSON.stringify(value);return vm.runInContext('JSON.parse(__json)',context);};
 function emit(host,value){const event=new Event('message');Object.defineProperty(event,'data',{value:realm(value)});host.dispatchEvent(event);}
 class FakeWorker extends EventTarget{
  constructor(url,options){super();this.url=url;this.options=options;this.terminations=0;state.hosts.push(this);config.onSpawn?.(state);}
  postMessage(raw,{transfer=[]}={}){const m=structuredClone(raw,{transfer});state.posts.push(m);config.onPost?.(m,state);queueMicrotask(()=>{
   if(m.type==='init'){if(!config.holdInit)emit(this,{type:'ready',requestId:m.requestId});}
   else if(m.type==='recognize'){if(!config.holdPage)emit(this,{type:'page',requestId:m.requestId,page:config.page?.()??page()});}
   else if(m.type==='dispose'){const send=()=>emit(this,{type:'release',requestId:m.requestId,release:{released:config.badRelease!==true,terminationInvoked:true,physicalExitAcknowledged:false,failures:[],lane:{busy:config.badRelease===true,fenced:false,starts:1}}});if(config.releaseWait)config.releaseWait.promise.then(send);else send();}
  });}
  terminate(){this.terminations++;if(Object.hasOwn(config,'terminateFailure'))throw config.terminateFailure;}
 }
 class Url extends URL{static createObjectURL(blob){assert.equal(this,Url);const id='blob:owned-'+(state.urls.size+1);state.urls.set(id,blob);return id;}static revokeObjectURL(url){state.revokes.push(url);if(Object.hasOwn(config,'revokeFailure'))throw config.revokeFailure;}}
 const clockSet=function(fn,ms){assert.equal(this,world,'captured global timer receiver');if(config.timerFailureMs===ms)throw false;const h=setTimeout(()=>{state.timers.delete(h);fn();},ms===5000?50:ms);state.timers.set(h,{fn,ms});return h;};
 const clockClear=function(h){assert.equal(this,world);if(config.clearFailureMs===state.timers.get(h)?.ms)throw false;clearTimeout(h);state.timers.delete(h);};
 const crypto={subtle:{digest:function(alg,bytes){assert.equal(this,crypto.subtle);state.digestCalls++;if(config.holdDigest&&state.digestCalls===1)return config.holdDigest.promise.then(()=>webcrypto.subtle.digest(alg,bytes));if(Object.hasOwn(config,'digestFailure'))return Promise.reject(config.digestFailure);return webcrypto.subtle.digest(alg,bytes);}}};
 function response(url){let chunk=assets.get(url),at=0,empty=0,canceled=false;if(config.mutateAsset)chunk=config.mutateAsset(chunk,url);function pull(c){if(canceled)return;if(config.emptyChunks&&empty++<config.emptyChunks){c.enqueue(new Uint8Array());return;}if(at===0){at=chunk.length;c.enqueue(chunk.slice());}else c.close();}const body=new ReadableStream({pull(c){return config.holdRead?config.holdRead.promise.then(()=>pull(c)):pull(c);},cancel(){canceled=true;state.streamCancels++;return config.holdCancel?.promise;}},{highWaterMark:0});state.lastBody=body;return new Response(body,{status:200,headers:config.noLength?{}:{'content-length':String(config.headerLength??chunk.length)}});}
 const fetch=function(url,options){assert.equal(this,world);state.fetches.push({url,options});config.onFetch?.(state);if(Object.hasOwn(config,'fetchFailure'))return Promise.reject(config.fetchFailure);if(config.holdFetch&&state.fetches.length===1)return config.holdFetch.promise.then(()=>response(url));return Promise.resolve(response(url));};
 Object.assign(world,{fetch,Worker:FakeWorker,Blob,setTimeout:clockSet,clearTimeout:clockClear});
 context=vm.createContext({globalThis:world,crypto,URL:Url,EventTarget,AbortController,AbortSignal,Response,Headers,ReadableStream,ReadableStreamDefaultReader,Uint8Array,ArrayBuffer,DataView,Blob,TextEncoder,Event,console});
 const budget=new vm.SyntheticModule(['assertDocumentWorkspaceBudget'],function(){this.setExport('assertDocumentWorkspaceBudget',(s,l,e)=>{try{return assertDocumentWorkspaceBudget(...[s,l,e].map(v=>JSON.parse(JSON.stringify(v))));}catch(error){context.__budgetMessage=error.message;context.__budgetCode=error.code;throw vm.runInContext('Object.assign(new Error(__budgetMessage),{code:__budgetCode})',context);}});},{context});
 const mod=new vm.SourceTextModule(source,{context});await mod.link(()=>budget);await mod.evaluate();
 state.hooks={snapshot(){config.onUsage?.(state,task);return state.snapshot;},external(){config.onExternal?.(state,task);return {};},signal:config.signal,language:config.language??'eng'};context.hooks=state.hooks;
 const options=()=>vm.runInContext(`({sessionUsage(){return JSON.parse(JSON.stringify(hooks.snapshot()))},getExternalUsage(){return JSON.parse(JSON.stringify(hooks.external()))},signal:hooks.signal,language:hooks.language})`,context);
 function start(){task=mod.namespace.createOcrHostTask(options());state.task=task;return task;}
 t.after(()=>{for(const h of state.timers.keys())clearTimeout(h);});
 return {state,config,start,realm,emit,get task(){return task;},request(){const p=realm({pageId:'p1',width:100,height:50});p.png=png();return p;},invalid(value){return mod.namespace.createOcrHostTask(realm(value));},override(value){return mod.namespace.createOcrHostTask(Object.assign(options(),realm(value)));}};
}

test('six exact streamed pins, immutable final Blob bytes, literal DTO and released successor',async t=>{
 const f=await fixture(t),a=f.start();await a.ready;assert.equal(f.state.fetches.length,6);assert.ok(f.state.fetches.every(x=>x.options.redirect==='error'&&x.options.cache==='no-store'));assert.ok(!f.state.fetches.some(x=>x.url===pins.tur.url));
 const expected=['main','worker','core','ownership','host'];for(const [i,blob]of [...f.state.urls.values()].entries()){const b=new Uint8Array(await blob.arrayBuffer());assert.equal(createHash('sha256').update(b).digest('hex'),pins[expected[i]].sha256,'final Blob source pin');}
 const req=f.request(),out=await a.recognize(req);assert.equal(req.png.byteLength,0,'ownership transfers PNG');assert.equal(out.lines[0].rawText,page().lines[0].rawText);assert.equal(out.text,page().text);assert.equal(a.view().resourceBytes,50331648);assert.equal(a.view().pending,false);await a.dispose();assert.equal(a.view().resourceBytes,0);assert.equal(f.state.hosts[0].terminations,1);assert.equal(f.state.revokes.length,5);
 f.state.hooks.language='tur';const b=f.start();await b.ready;assert.equal(f.state.fetches.at(-3).url,pins.tur.url);await b.dispose();assert.equal(f.state.hosts.length,2);
});
test('duck/already-aborted signals and unknown public injection options create nothing',async t=>{
 const c=new AbortController();c.abort(false);const f=await fixture(t,{signal:c.signal});assert.throws(()=>f.start(),{name:'AbortError'});assert.equal(f.state.fetches.length,0);assert.throws(()=>f.invalid({sessionUsage:'bad',workerPath:'https://invalid/'}),/Unexpected/);
 const g=await fixture(t,{signal:{aborted:false}});assert.throws(()=>g.start(),/genuine/);
 assert.throws(()=>f.override({language:null}),{code:'OCR_INPUT'});assert.throws(()=>f.override({getExternalUsage:null}),{code:'OCR_INPUT'});
});
test('reentrant initial owner callback cannot overwrite an admitted task',async t=>{
 const f=await fixture(t);let once=false,nested;f.config.onUsage=()=>{if(!once){once=true;nested=f.start();}};assert.throws(()=>f.start(),{code:'OCR_BUSY'});await nested.ready;assert.equal(f.state.hosts.length,1);await nested.dispose();
});
test('five falsy native fetch rejections preserve finite failure and drain',async t=>{
 for(const value of [false,0,'',null,undefined]){const f=await fixture(t,{fetchFailure:value}),a=f.start();await assert.rejects(a.ready,e=>e.code==='OCR_NATIVE'&&Object.is(e.cause,value)&&!Object.keys(e).includes('cause'));await a.dispose();assert.equal(a.view().failurePresent,true);assert.equal(a.view().resourceBytes,0);assert.equal(f.state.hosts.length,0);}
});
test('held FIRST fetch remains charged through cancel and late body cancel/drain',async t=>{
 const held=deferred(),f=await fixture(t,{holdFetch:held}),a=f.start();await until(()=>f.state.fetches.length===1);const rejected=assert.rejects(a.ready,{name:'AbortError'}),first=a.cancel(false);let settled=false;first.then(()=>settled=true);await tick();assert.equal(settled,false);assert.equal(a.view().resourceBytes,50331648);assert.throws(()=>f.start(),{code:'OCR_BUSY'});held.resolve();await first;await rejected;assert.equal(f.state.streamCancels,1);assert.equal(f.state.lastBody.locked,false);assert.equal(a.view().resourceBytes,0);
});
test('held FIRST digest stays owned until cancellation drain',async t=>{
 const held=deferred(),f=await fixture(t,{holdDigest:held}),a=f.start();await until(()=>f.state.digestCalls===1);const rejected=assert.rejects(a.ready);let done=false;const first=a.cancel().then(()=>done=true);await tick();assert.equal(done,false);assert.equal(a.view().resourceBytes,50331648);held.resolve();await first;await rejected;assert.equal(a.view().resourceBytes,0);
});
test('FIRST read cancellation drains its original cancel promise before release',async t=>{
 const holdRead=deferred(),holdCancel=deferred(),f=await fixture(t,{holdRead,holdCancel}),a=f.start();await until(()=>f.state.lastBody?.locked);const rejected=assert.rejects(a.ready);let done=false;const first=a.cancel().then(()=>done=true);await until(()=>f.state.streamCancels===1);assert.equal(done,false);assert.equal(a.view().resourceBytes,50331648);holdRead.resolve();await tick();assert.equal(done,false);holdCancel.resolve();await first;await rejected;assert.equal(f.state.lastBody.locked,false);assert.equal(a.view().resourceBytes,0);
});
test('30s captured deadline rejects promptly while owning a late FIRST fetch',async t=>{
 const held=deferred(),f=await fixture(t,{holdFetch:held}),a=f.start();await until(()=>f.state.fetches.length===1);const timer=[...f.state.timers.values()].find(v=>v.ms===30000);assert.ok(timer);const rejected=assert.rejects(a.ready,{code:'OCR_TIMEOUT'});timer.fn();await rejected;assert.equal(a.view().resourceBytes,50331648);held.resolve();await a.dispose();assert.equal(f.state.hosts.length,0);
});
test('joint byte/count headroom is checked before first fetch',async t=>{
 const f=await fixture(t);f.state.snapshot.resourceBytes=49*1024*1024;f.state.snapshot.retainedBytes=49*1024*1024;const a=f.start();await assert.rejects(a.ready,{code:'DOCUMENT_DRAFT_LIMIT'});await a.dispose();assert.equal(f.state.fetches.length,0);
 const g=await fixture(t);g.state.snapshot.resourceCount=97;const b=g.start();await assert.rejects(b.ready,{code:'DOCUMENT_DRAFT_LIMIT'});await b.dispose();assert.equal(g.state.fetches.length,0);
});
test('bad SHA/length/backing and excessive empty reads refuse before any host spawn',async t=>{
 for(const config of [{mutateAsset:b=>{const c=b.slice();c[0]^=1;return c;}},{headerLength:1},{emptyChunks:4096}]){const f=await fixture(t,config),a=f.start();await assert.rejects(a.ready);await a.dispose();assert.equal(f.state.hosts.length,0);assert.equal(a.view().resourceBytes,0);}
 const f=await fixture(t),a=f.start();await a.ready;const req=f.request(),b=new Uint8Array(64);b.set(req.png,1);req.png=b.subarray(1,34);await assert.rejects(a.recognize(req),{code:'OCR_INPUT'});await a.dispose();
});
test('callback abort after usage checks blocks URL creation and host spawn',async t=>{
 const c=new AbortController(),f=await fixture(t,{signal:c.signal,onExternal:s=>{if(s.fetches.length===6)c.abort(false);}}),a=f.start();await assert.rejects(a.ready,{name:'AbortError'});await a.dispose();assert.equal(f.state.urls.size,0);assert.equal(f.state.hosts.length,0);
});
test('callback disposal before transfer and publication cannot strand an owned envelope',async t=>{
 const f=await fixture(t,{onUsage:(s,a)=>{if(s.hosts.length&&!s.posts.length)a.dispose();}}),a=f.start();await assert.rejects(a.ready);await a.dispose();assert.equal(f.state.posts.filter(x=>x.type==='init').length,0);assert.equal(f.state.hosts[0].terminations,1);
 const c=new AbortController(),g=await fixture(t,{signal:c.signal,onExternal:s=>{if(s.posts.some(x=>x.type==='recognize'))c.abort(false);}}),b=g.start();await b.ready;await assert.rejects(b.recognize(g.request()));await b.dispose();assert.equal(b.view().resourceBytes,0);
});
test('external owner change at final publication retains no result',async t=>{
 const f=await fixture(t,{onUsage:s=>{if(s.posts.some(x=>x.type==='recognize'))s.snapshot.revision=1;}}),a=f.start();await a.ready;await assert.rejects(a.recognize(f.request()),{code:'OCR_STALE'});await a.dispose();assert.equal(a.view().resourceBytes,0);
});
test('bad DTO refuses as whole page and independently releases the direct host',async t=>{
 const f=await fixture(t,{page:()=>({...page(),lines:[{...page().lines[0],rawText:'x'.repeat(4097)}]})}),a=f.start();await a.ready;await assert.rejects(a.recognize(f.request()));await a.dispose();assert.equal(f.state.hosts[0].terminations,1);
});
test('failed revokes and terminate are independently attempted, fenced and still charged',async t=>{
 const f=await fixture(t,{revokeFailure:false,terminateFailure:0}),a=f.start();await a.ready;await assert.rejects(a.dispose(),{code:'OCR_CLEANUP'});assert.equal(f.state.hosts[0].terminations,1);assert.equal(f.state.revokes.length,5);assert.equal(a.view().resourceBytes,50331648);assert.equal(a.view().fenced,true);assert.throws(()=>f.start(),{code:'OCR_CLEANUP'});
});
test('failed timer clearing retains charge; failed registration creates no unowned host',async t=>{
 const f=await fixture(t,{clearFailureMs:30000}),a=f.start();await assert.rejects(a.ready,{code:'OCR_CLEANUP'});await assert.rejects(a.dispose(),{code:'OCR_CLEANUP'});assert.equal(a.view().resourceBytes,50331648);assert.equal(f.state.hosts.length,0);
 const g=await fixture(t,{timerFailureMs:300000}),b=g.start();await assert.rejects(b.ready);await b.dispose();assert.equal(g.state.fetches.length,0);
});
test('held child release keeps transferred model charged until actual FIRST ack',async t=>{
 const held=deferred(),f=await fixture(t,{releaseWait:held}),a=f.start();await a.ready;let done=false;const cleanup=a.dispose().then(()=>done=true);await until(()=>f.state.posts.some(x=>x.type==='dispose'));assert.equal(done,false);assert.equal(a.view().resourceBytes,50331648);assert.throws(()=>f.start(),{code:'OCR_BUSY'});held.resolve();await cleanup;assert.equal(a.view().resourceBytes,0);
});
test('parent owns startup/recognition reply deadlines when host publishes nothing',async t=>{
 const f=await fixture(t,{holdInit:true}),a=f.start();await until(()=>f.state.posts.some(x=>x.type==='init'));const startup=[...f.state.timers.values()].find(x=>x.ms===60000);assert.ok(startup);const rejected=assert.rejects(a.ready,{code:'OCR_TIMEOUT'});startup.fn();await rejected;await a.dispose();assert.equal(f.state.hosts[0].terminations,1);
 const g=await fixture(t,{holdPage:true}),b=g.start();await b.ready;const pending=b.recognize(g.request()),failed=assert.rejects(pending,{code:'OCR_TIMEOUT'});await until(()=>g.state.posts.some(x=>x.type==='recognize'));const timer=[...g.state.timers.values()].find(x=>x.ms===120000);assert.ok(timer);timer.fn();await failed;await b.dispose();assert.equal(g.state.hosts[0].terminations,1);
});
test('reply timer clear failure in a successful ready callback rejects, terminates and fences',async t=>{
 const f=await fixture(t,{clearFailureMs:60000}),a=f.start();await assert.rejects(a.ready,{code:'OCR_CLEANUP'});await assert.rejects(a.dispose(),{code:'OCR_CLEANUP'});assert.equal(f.state.hosts[0].terminations,1);assert.equal(a.view().resourceBytes,50331648);assert.equal(a.view().fenced,true);
});
test('recognition entry reserves before external/owner callbacks and admits one RPC',async t=>{
 for(const callback of ['onExternal','onUsage']){
  const f=await fixture(t),a=f.start();await a.ready;let nested,once=false;
  f.config[callback]=()=>{if(!once){once=true;assert.equal(a.view().pending,true);nested=a.recognize(f.request());nested.catch(()=>{});}};
  const first=a.recognize(f.request());const results=await Promise.allSettled([first,nested]);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.code,'OCR_BUSY');assert.equal(f.state.posts.filter(x=>x.type==='recognize').length,1);await a.dispose();
 }
});
test('recognition entry captures only original own values before callbacks and microtasks',async t=>{
 const f=await fixture(t),a=f.start();await a.ready;const request=f.request(),nativeBuffer=request.png.buffer,extra=new Uint8Array(2*1024*1024),replacement=png();let once=false;
 f.config.onExternal=()=>{if(!once){once=true;request.extra=extra;request.png=replacement;request.width=1;request.height=1;request.pageId='mutated';}};
 const result=a.recognize(request);Object.defineProperty(request,'png',{get(){throw false;}});const out=await result,sent=f.state.posts.find(x=>x.type==='recognize');assert.equal(out.pageId,'p1');assert.equal(sent.width,100);assert.equal(sent.height,50);assert.deepEqual(Object.keys(sent).sort(),['type','requestId','pageId','width','height','png'].sort());assert.equal(sent.png.byteLength,33);assert.equal(nativeBuffer.byteLength,0);assert.equal(replacement.byteLength,33);assert.equal(extra.byteLength,2097152);await a.dispose();
});
test('recognition entry transfers intrinsic backing without public PNG getters or species',async t=>{
 const f=await fixture(t),a=f.start();await a.ready;const request=f.request(),real=request.png.buffer,foreign=new ArrayBuffer(2*1024*1024);new Uint8Array(foreign).set(request.png);let reads=0;
 for(const key of ['buffer','byteLength','length','slice','subarray','constructor'])Object.defineProperty(request.png,key,{get(){reads++;throw false;}});
 const out=await a.recognize(request);assert.equal(out.pageId,'p1');assert.equal(reads,0);assert.equal(real.byteLength,0);assert.equal(foreign.byteLength,2097152);assert.equal(f.state.posts.find(x=>x.type==='recognize').png.byteLength,33);await a.dispose();
});
test('recognition entry rejects shared/resizable/detached input then accepts valid successor',async t=>{
 const f=await fixture(t),a=f.start();await a.ready;const invalid=[];
 const shared=new Uint8Array(new SharedArrayBuffer(33));shared.set(png());invalid.push(shared);
 const resizable=new Uint8Array(new ArrayBuffer(33,{maxByteLength:64}));resizable.set(png());assert.equal(resizable.buffer.resizable,true);invalid.push(resizable);
 const detached=png();structuredClone(detached.buffer,{transfer:[detached.buffer]});invalid.push(detached);
 for(const bytes of invalid){const request=f.request();request.png=bytes;await assert.rejects(a.recognize(request),{code:'OCR_INPUT'});assert.equal(a.view().pending,false);}
 assert.equal(f.state.posts.filter(x=>x.type==='recognize').length,0);await a.recognize(f.request());assert.equal(f.state.posts.filter(x=>x.type==='recognize').length,1);assert.equal(f.state.hosts.length,1);await a.dispose();
});
test('recognition entry callback false abort/cancel/dispose settles FIRST admission without deadlock',async t=>{
 for(const kind of ['signal','cancel','dispose']){
  const controller=new AbortController(),held=deferred(),f=await fixture(t,{signal:controller.signal,releaseWait:held}),a=f.start();await a.ready;let once=false;
  f.config.onExternal=()=>{if(!once){once=true;if(kind==='signal')controller.abort(false);else if(kind==='cancel')void a.cancel(false);else void a.dispose();}};
  const work=a.recognize(f.request());await assert.rejects(work,e=>kind!=='signal'||(e.name==='AbortError'&&e.cause===false));const first=a.dispose();let done=false;first.then(()=>done=true);await until(()=>f.state.posts.some(x=>x.type==='dispose'));assert.equal(done,false);assert.equal(a.view().resourceBytes,50331648);assert.equal(f.state.posts.filter(x=>x.type==='recognize').length,0);held.resolve();await first;assert.equal(a.view().resourceBytes,0);assert.equal(f.state.hosts[0].terminations,1);
 }
});
test('recognition entry rechecks captured fixed buffer after final transfer callback',async t=>{
 const f=await fixture(t),a=f.start();await a.ready;const request=f.request(),real=request.png.buffer;let detached=false;
 f.config.onUsage=s=>{if(!detached&&[...s.timers.values()].some(x=>x.ms===120000)){detached=true;structuredClone(real,{transfer:[real]});}};
 await assert.rejects(a.recognize(request),{code:'OCR_INPUT'});assert.equal(detached,true);assert.equal(f.state.posts.filter(x=>x.type==='recognize').length,0);await a.dispose();assert.equal(f.state.hosts[0].terminations,1);
});
