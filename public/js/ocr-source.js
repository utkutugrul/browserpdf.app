// Unreachable OCR A source adapter. First-party public PDF.js APIs only.
import { assertDocumentWorkspaceBudget } from './core/document-draft.js';
import { boundedViewport } from './core/bounded-renderer.js';
const MiB=1048576,SOURCE=12*MiB,Q=4*MiB,apply=Reflect.apply,G=globalThis;
const A=AbortSignal.prototype,aborted=Object.getOwnPropertyDescriptor(A,'aborted').get,reason=Object.getOwnPropertyDescriptor(A,'reason').get;
const listen=EventTarget.prototype.addEventListener,unlisten=EventTarget.prototype.removeEventListener,abort=AbortController.prototype.abort;
const promiseThen=Promise.prototype.then,timerSet=G.setTimeout,timerClear=G.clearTimeout,typed=Object.getPrototypeOf(Uint8Array.prototype);
const length=Object.getOwnPropertyDescriptor(typed,'byteLength').get,offset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,backing=Object.getOwnPropertyDescriptor(typed,'buffer').get,tag=Object.getOwnPropertyDescriptor(typed,Symbol.toStringTag).get;
const bufferSize=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
const fill=Uint8Array.prototype.fill,set=Uint8Array.prototype.set,blobSize=Object.getOwnPropertyDescriptor(Blob.prototype,'size').get,blobType=Object.getOwnPropertyDescriptor(Blob.prototype,'type').get,blobRead=Blob.prototype.arrayBuffer;
const getReader=ReadableStream.prototype.getReader,read=ReadableStreamDefaultReader.prototype.read,cancelReader=ReadableStreamDefaultReader.prototype.cancel,unlock=ReadableStreamDefaultReader.prototype.releaseLock;
const digestNative=crypto.subtle.digest,subtle=crypto.subtle;
const canvasProto=G.HTMLCanvasElement?.prototype,context=canvasProto?.getContext,toBlob=canvasProto?.toBlob,widthSet=canvasProto&&Object.getOwnPropertyDescriptor(canvasProto,'width').set,heightSet=canvasProto&&Object.getOwnPropertyDescriptor(canvasProto,'height').set,append=G.Node?.prototype.appendChild,createElement=G.Document?.prototype.createElement,documentReceiver=G.document;
const zero=()=>({artifactBytes:0,resourceBytes:0,resourceCount:0});
function error(code,cause){const e=new Error('OCR source '+code.toLowerCase().replaceAll('_',' ')+'.');e.code='OCR_SOURCE_'+code;Object.defineProperty(e,'cause',{value:cause});return e;}
function fail(code){throw error(code,undefined);}
function own(v,k){const d=v&&Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail('INPUT');return d.value;}
function fields(v,keys){if(!v||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('INPUT');const out={};for(const k of Reflect.ownKeys(v)){if(typeof k!=='string'||!keys.includes(k))fail('INPUT');out[k]=own(v,k);}return out;}
function tuple(v){const t={taskId:own(v,'taskId'),revision:own(v,'revision'),generation:own(v,'generation')};if(t.taskId!==null&&(typeof t.taskId!=='string'||!t.taskId.length||t.taskId.length>100)||!Number.isSafeInteger(t.revision)||t.revision<0||!Number.isSafeInteger(t.generation)||t.generation<0)fail('OWNER');return t;}
const same=(a,b)=>a.taskId===b.taskId&&a.revision===b.revision&&a.generation===b.generation;
function bytes(v,max=SOURCE){let b,n;try{b=apply(backing,v,[]);n=apply(length,v,[]);if(apply(tag,v,[])!=='Uint8Array'||apply(offset,v,[])!==0||n<1||n>max||apply(bufferSize,b,[])!==n||(resizable&&apply(resizable,b,[])))throw 0;}catch{fail('BACKING');}return {value:new Uint8Array(b,0,n),buffer:b,size:n};}
function clear(v){if(apply(length,v,[]))apply(fill,v,[0]);}
function signal(v){if(v!==undefined)try{apply(aborted,v,[]);}catch{fail('SIGNAL');}return v;}
function abortError(cause){try{if(genuineAbort(cause))return cause;}catch{}const e=error('ABORT',cause);e.name='AbortError';e.code='OCR_ABORT';return e;}
function codeOf(e){const d=e&&typeof e==='object'?Object.getOwnPropertyDescriptor(e,'code'):null;return typeof d?.value==='string'?d.value:null;}
const exceptionName=Object.getOwnPropertyDescriptor(DOMException.prototype,'name').get;
function genuineAbort(e){try{return apply(exceptionName,e,[])==='AbortError';}catch{return false;}}
function finite(e){const d=e&&typeof e==='object'?Object.getOwnPropertyDescriptor(e,'message'):null;return {code:(codeOf(e)??'OCR_SOURCE_NATIVE').slice(0,64),message:typeof d?.value==='string'?d.value.slice(0,512):'OCR source failed.'};}
function vector(v,n){if(!Array.isArray(v)||v.length!==n||Reflect.ownKeys(v).length!==n+1)fail('GEOMETRY');return Array.from({length:n},(_,i)=>{const x=own(v,String(i));if(!Number.isFinite(x)||Math.abs(x)>1e6)fail('GEOMETRY');return x;});}
function callable(v){if(typeof v!=='function')fail('DEPENDENCY');return v;}
function defaults(){if(!canvasProto)fail('PLATFORM');return {createCanvas:()=>apply(createElement,documentReceiver,['canvas']),encodePng:canvas=>new Promise((resolve,reject)=>apply(toBlob,canvas,[v=>v?resolve(v):reject(error('ENCODE',null)),'image/png'])),readBlob:v=>apply(blobRead,v,[]),resetCanvas:canvas=>{apply(widthSet,canvas,[0]);apply(heightSet,canvas,[0]);}};}

export function createOcrSource(raw,base){
 const deps=fields(raw,['pdfjs','pdfjsAssets','session','getExternalUsage','platform']),input=fields(base,['bytes','name','owner']);
 const pdfjs=deps.pdfjs,getDocument=callable(pdfjs?.getDocument),session=deps.session,snapshot=callable(session?.snapshot),external=deps.getExternalUsage??zero;callable(external);
 const assets=Object.freeze({...fields(deps.pdfjsAssets??{},['standardFontDataUrl','cMapUrl','cMapPacked','wasmUrl'])});
 const native=deps.platform?fields(deps.platform,['createCanvas','encodePng','readBlob','resetCanvas']):null;if(native)for(const k of ['createCanvas','encodePng','readBlob','resetCanvas'])callable(native[k]);
 let expected=tuple(input.owner),baseBytes=bytes(input.bytes).value;const S=apply(length,baseBytes,[]);
 if(typeof input.name!=='string'||input.name.length>260)fail('INPUT');const name=input.name;
 let phase='idle',metadata=null,doc=null,op=null,closing=false,disposed=false,fenced=false,closeFirst=null,disposeFirst=null,lastError=null,frameHeld=null;
 let attempts=0,attemptPixels=0,previewRenders=0,totalChunks=0,totalItems=0,totalUnits=0;
 const selected=new Set(),inspections=new Map(),copies=new Set(),retainedOps=new Set(),tasks=[],leases=new Map([['base',{artifactBytes:S}]]),cleanupFailures=[];
 const live=()=>{const out=zero();for(const u of leases.values())for(const k of Object.keys(out))out[k]+=u[k]??0;return out;};
 function cleanupFailure(stage,cause){const e=error('CLEANUP',cause);Object.defineProperty(e,'stage',{value:stage});cleanupFailures.push(e);fenced=true;phase='fenced';lastError=finite(e);return e;}
 function attempt(stage,fn){try{return fn();}catch(e){cleanupFailure(stage,e);}}
 function check(o){
  if(disposed||closing)throw op?.cancelled?op.cancelError:error('CLOSED',undefined);if(fenced)throw cleanupFailures[0];
  if(o&&apply(aborted,o.controller.signal,[]))throw abortError(apply(reason,o.controller.signal,[]));
  const u=external();const current=o?.options?.isCurrent?o.options.isCurrent():true;const actual=apply(snapshot,session,[]);
  assertDocumentWorkspaceBudget(actual,u,live());if(!same(tuple(actual),expected)||!current)fail('STALE');
  if(o&&apply(aborted,o.controller.signal,[]))throw abortError(apply(reason,o.controller.signal,[]));if(disposed||closing)throw o?.cancelled?o.cancelError:error('CLOSED',undefined);if(fenced)throw cleanupFailures[0];
 }
 function reserve(key,u,o){leases.set(key,u);check(o);}
 function destroy(record){if(!record.first){record.first=Promise.resolve().then(()=>apply(record.destroy,record.task,[]));record.first.catch(()=>{});}return record.first;}
 function stopReader(o){if(o?.reader&&!o.readerDone&&!o.readerCancel){o.readerCancelReason=error('TEXT_CANCEL',undefined);try{o.readerCancel=Promise.resolve(apply(cancelReader,o.reader,[o.readerCancelReason]));}catch(e){o.readerCancel=Promise.reject(e);}o.readerCancel.catch(()=>{});}return o?.readerCancel;}
 function stopNow(o){if(o?.render&&o.renderCancel)attempt('render-cancel',()=>apply(o.renderCancel,o.render,[]));stopReader(o);for(const t of tasks)void destroy(t);}
 function deadline(p){let h;return new Promise((resolve,reject)=>{try{h=apply(timerSet,G,[()=>reject(error('CLEANUP','FIRST did not drain.')),60000]);}catch(e){reject(e);return;}p.then(resolve,reject);}).finally(()=>apply(timerClear,G,[h]));}
 function requestClose(cause){
  if(closeFirst)return closeFirst;closing=true;phase='closing';const current=op;
  if(current){current.cancelled=true;current.cancelError=abortError(cause);attempt('abort',()=>apply(abort,current.controller,[cause]));}
  // Microtask ownership: constructors/listener registrations can finish first.
  closeFirst=Promise.resolve().then(async()=>{
   stopNow(current);
   const draining=(async()=>{if(current)try{await current.work;}catch{}for(const t of tasks)try{await destroy(t);t.released=true;}catch(e){cleanupFailure('task-destroy',e);}})();draining.catch(()=>{});
   try{await deadline(draining);}catch(e){cleanupFailure('first-drain',e);}
   if(cleanupFailures.length)throw cleanupFailures[0];
   for(const t of tasks){const n=cleanupFailures.length;attempt('worker-byte-clear',()=>clear(t.data));if(cleanupFailures.length===n)leases.delete(t.key);}tasks.length=0;doc=null;
   if(cleanupFailures.length)throw cleanupFailures[0];if(op===current)op=null;closing=false;phase='idle';return {released:true,physicalExitAcknowledged:false};
  });closeFirst.catch(e=>{current?.reject?.(e);});return closeFirst;
 }
 async function drainRender(o){
  if(!o.render)return true;
  if(o.renderFirst){try{await o.renderFirst;}catch{}return true;}
  // An opaque render has no observable FIRST. Only strict document destruction
  // can establish release; a rejected/unavailable destroy leaves strong refs.
  let released=tasks.length>0;for(const t of tasks)try{await destroy(t);t.released=true;}catch(e){released=false;cleanupFailure('opaque-render-destroy',e);}return released;
 }
 async function cooperate(o){await new Promise(resolve=>apply(timerSet,G,[resolve,0]));check(o);}
 function run(kind,rawOptions,fn){
  if(disposed||fenced||closing||op||frameHeld&&!['copy','mount'].includes(kind))return Promise.reject(fenced?cleanupFailures[0]:error(op||frameHeld?'BUSY':'CLOSED',undefined));
  if(closeFirst)closeFirst=null;
  const o={controller:new AbortController(),options:null,render:null,reader:null,readerCancel:null,cancelled:false,timer:null,timerPresent:false,listener:false,temp:new Set(),canvases:new Set(),arrays:new Set(),result:null};op=o;retainedOps.add(o);phase=kind==='mount'?'ready':kind;let resolve,reject;o.first=new Promise((a,b)=>{resolve=a;reject=b;});o.first.catch(()=>{});o.resolve=v=>{o.settled=true;resolve(v);};o.reject=e=>{o.settled=true;reject(e);};o.workPending=true;
  // FIRST exists before options, signal listeners, callbacks, or producers.
  o.work=Promise.resolve().then(async()=>{
   let value,failure,failurePresent=false;
   try{
    if(o.admissionFailed)throw o.admissionError;
    if(o.options.isCurrent!==undefined)callable(o.options.isCurrent);const s=signal(o.options.signal);
    o.onAbort=()=>{if(apply(aborted,s,[]))void requestClose(apply(reason,s,[]));};
    if(s&&apply(aborted,s,[]))requestClose(apply(reason,s,[]));check(o);
    if(s){o.listener=true;apply(listen,s,['abort',o.onAbort,{once:true}]);if(apply(aborted,s,[]))o.onAbort();}check(o);
    o.timer=apply(timerSet,G,[()=>{void requestClose(error('TIMEOUT',undefined));},60000]);o.timerPresent=true;check(o);
    value=await fn(o);o.result=value;check(o);
   }catch(e){failurePresent=true;failure=e;
    // Start the bounded cleanup envelope without awaiting it from its own work.
    if(cleanupFailures.length&&!closeFirst)void requestClose(cleanupFailures[0]);
   }
   finally{
    if(o.listener)attempt('abort-listener',()=>apply(unlisten,o.options.signal,['abort',o.onAbort]));
    if(o.reader){try{await stopReader(o);}catch(e){if(!o.readerFailed||!Object.is(o.readerError,e))cleanupFailure('reader-cancel',e);}attempt('reader-unlock',()=>apply(unlock,o.reader,[]));}
    const renderReleased=await drainRender(o);
    // Keep the operation watchdog live through all newly owned drain waits.
    if(o.timerPresent)attempt('operation-timer',()=>apply(timerClear,G,[o.timer]));
    if(renderReleased)for(const canvas of o.canvases)attempt('canvas-reset',()=>(native??defaults()).resetCanvas(canvas));
    for(const a of o.arrays)attempt('byte-clear',()=>clear(a));
    if(!cleanupFailures.length)for(const key of o.temp)leases.delete(key);
   }
   if(cleanupFailures.length)throw cleanupFailures[0];
   if(o.cancelled||apply(aborted,o.controller.signal,[]))throw o.cancelError??abortError(apply(reason,o.controller.signal,[]));
   if(failurePresent)throw failure;return value;
  });o.work.catch(()=>{});o.work.then(()=>{o.workPending=false;if(o.settled&&op===o)op=null;},()=>{o.workPending=false;if(o.settled&&op===o)op=null;});
  const completion=o.work.then(async value=>{try{check(o);return value;}catch(e){if(closeFirst)await closeFirst;if(value?.dispose)await value.dispose();throw e;}},async cause=>{
   lastError=finite(cause);if(kind==='preparing'&&!closeFirst)requestClose(cause);if(closeFirst)try{await closeFirst;}catch(e){throw e;}
   if(o.result?.dispose)try{await o.result.dispose();}catch(e){throw e;}
   if(cleanupFailures.length)throw cleanupFailures[0];
   if(genuineAbort(cause))throw cause;const code=codeOf(cause);if(code&&/^(OCR_SOURCE_|OCR_ABORT$|DOCUMENT_DRAFT_)/.test(code))throw cause;const n=cause&&typeof cause==='object'?Object.getOwnPropertyDescriptor(cause,'name'):null;throw error(n?.value==='PasswordException'?'PASSWORD':'NATIVE',cause);
  });completion.then(o.resolve,o.reject);o.first.finally(()=>{if(op===o&&!o.workPending)op=null;if(!cleanupFailures.length)retainedOps.delete(o);if(!closing&&!fenced&&!disposed)phase=doc?'ready':'idle';}).catch(()=>{});try{o.options=Object.freeze(fields(rawOptions??{},kind==='inspecting'?['pageIndex','signal','isCurrent']:kind==='rendering'?['pageIndex','purpose','signal','isCurrent']:['signal','isCurrent']));}catch(e){o.admissionFailed=true;o.admissionError=e;}return o.first;
 }
 function pageIndex(v){if(!metadata||!doc)fail('NOT_READY');if(!Number.isSafeInteger(v)||v<0||v>=metadata.pageCount)fail('PAGE');return v;}
 async function getPage(o,i){const fn=callable(doc.getPage);check(o);const first=apply(fn,doc,[i+1]);const p=await first;check(o);return p;}
 function workLease(o){const key={};o.temp.add(key);reserve(key,{resourceBytes:2*MiB,resourceCount:2},o);}
 function pngHeader(data,w,h){const b=bytes(data,Q);if(b.size<33)fail('PNG');const d=new DataView(b.buffer);if([137,80,78,71,13,10,26,10].some((n,i)=>d.getUint8(i)!==n)||d.getUint32(8)!==13||d.getUint32(12)!==0x49484452||d.getUint32(16)!==w||d.getUint32(20)!==h)fail('PNG');return data;}
 function clone(v){return JSON.parse(JSON.stringify(v));}
 const api={
  prepare(options){return run('preparing',options,async o=>{
   if(doc)return {...metadata};
   const hashKey={};o.temp.add(hashKey);reserve(hashKey,{resourceBytes:S,resourceCount:1},o);
   check(o);const first=apply(digestNative,subtle,['SHA-256',baseBytes]);const hashed=await first;check(o);const sha256=Array.from(new Uint8Array(hashed),v=>v.toString(16).padStart(2,'0')).join('');leases.delete(hashKey);o.temp.delete(hashKey);
   const key={};reserve(key,{resourceBytes:S,resourceCount:1},o);const data=new Uint8Array(S);apply(set,data,[baseBytes]);
   let record;try{check(o);const task=apply(getDocument,pdfjs,[{...assets,data,useSystemFonts:false,isEvalSupported:false}]);record={task,destroy:null,data,key,first:null};tasks.push(record);record.destroy=callable(task.destroy);check(o);doc=await task.promise;check(o);}catch(e){if(!record){o.arrays.add(data);o.temp.add(key);}throw e;}
   const pageCount=doc.numPages;check(o);if(!Number.isSafeInteger(pageCount)||pageCount<1||pageCount>1000)fail('PAGES');metadata={sha256,byteLength:S,pageCount,name,encrypted:false};return {...metadata};
  });},
  acceptOwner(before,after){if(disposed||fenced)fail('CLOSED');const b=tuple(before),a=tuple(after);const current=tuple(apply(snapshot,session,[]));if(!same(b,expected)||!same(a,current)||a.taskId===null)fail('STALE');expected=a;return api.view();},
  inspect(options){return run('inspecting',options,async o=>{
   const i=pageIndex(o.options.pageIndex);if(!inspections.has(i)&&inspections.size>=20)fail('INSPECTION_LIMIT');
   workLease(o);const result={pageIndex:i,status:'unknown',items:0,units:0,chunks:0,complete:false,error:null};inspections.set(i,result);
   try{const page=await getPage(o,i),fn=callable(page.streamTextContent);check(o);const stream=apply(fn,page,[{disableNormalization:true,includeMarkedContent:false}]);o.reader=apply(getReader,stream,[]);check(o);let actions=0,visits=0;
    while(true){check(o);const first=apply(read,o.reader,[]);let part;try{part=await first;}catch(e){o.readerFailed=true;o.readerError=e;throw e;}check(o);if(part.done){o.readerDone=true;result.status=result.status==='embedded'?'embedded':'clear';result.complete=true;break;}
     if(++result.chunks>256||++totalChunks>4096)fail('TEXT_LIMIT');const chunk=part.value,items=own(chunk,'items');if(!Array.isArray(items)||items.length>10000-result.items)fail('TEXT_LIMIT');
     for(let j=0;j<items.length;j++){
      if(++result.items>10000||++totalItems>100000)fail('TEXT_LIMIT');const item=own(items,String(j));const d=item&&Object.getOwnPropertyDescriptor(item,'str');if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string')fail('TEXT_SCHEMA');{const n=d.value.length;if(n>200000-result.units||n>1000000-totalUnits)fail('TEXT_LIMIT');result.units+=n;totalUnits+=n;visits+=n;if(n)result.status='embedded';}
      if(++actions>=128||visits>=16384){actions=0;visits=0;await cooperate(o);}
     }
    }
   }catch(e){if(o.cancelled||closing)throw e;result.status='unknown';result.error=finite(codeOf(e)?e:error('TEXT',e));}
   check(o);return clone(result);
  });},
  capture(options){return run('rendering',options,async o=>{
   const i=pageIndex(o.options.pageIndex),purpose=o.options.purpose;if(!['preview','recognition'].includes(purpose))fail('INPUT');const inspection=inspections.get(i)??null;
   if(purpose==='recognition'){
    if(inspection?.status!=='clear')fail('TEXT_BLOCKED');if(attempts>=20||!selected.has(i)&&selected.size>=20)fail('ATTEMPTS');attempts++;selected.add(i);
   }else{if(previewRenders>=100)fail('PREVIEWS');previewRenders++;}
   workLease(o);const page=await getPage(o,i),viewport=boundedViewport(page,{scale:1.5,maxDimension:4096,maxPixels:1000000});
   const width=Math.max(1,Math.floor(viewport.width)),height=Math.max(1,Math.floor(viewport.height));
   const geometry={view:vector(page.view,4),rotate:page.rotate,userUnit:page.userUnit,recognitionRotation:viewport.rotation,scale:viewport.scale,viewport:{width:viewport.width,height:viewport.height,transform:vector(viewport.transform,6)},backing:{width,height,toViewport:[1,0,0,1,0,0]}};
   if(geometry.view[2]<=geometry.view[0]||geometry.view[3]<=geometry.view[1]||viewport.width>1e6||viewport.height>1e6||![0,90,180,270].includes(geometry.rotate)||![0,90,180,270].includes(geometry.recognitionRotation)||!(geometry.userUnit>0&&geometry.userUnit<=75000)||!(geometry.scale>0&&geometry.scale<=100)||width>4096||height>4096||width*height>1000000||Math.abs(geometry.viewport.transform[0]*geometry.viewport.transform[3]-geometry.viewport.transform[1]*geometry.viewport.transform[2])<1e-12)fail('GEOMETRY');
   check(o);if(purpose==='recognition'){if(attemptPixels+width*height>20000000)fail('PIXELS');attemptPixels+=width*height;}
   const canvasKey={};o.temp.add(canvasKey);reserve(canvasKey,{resourceBytes:4*width*height,resourceCount:1},o);const ports=native??defaults();check(o);const canvas=ports.createCanvas();o.canvases.add(canvas);check(o);
   if(native){canvas.width=width;check(o);canvas.height=height;}else{apply(widthSet,canvas,[width]);check(o);apply(heightSet,canvas,[height]);}check(o);
   const contextFn=native?callable(canvas.getContext):context;check(o);const ctx=apply(contextFn,canvas,['2d']);const render=callable(page.render);check(o);o.render=apply(render,page,[{canvasContext:ctx,viewport}]);
   // Capture and observe the actual FIRST before any later task getter/check.
   try{o.renderFirst=apply(promiseThen,o.render.promise,[v=>v,e=>{throw e;}]);o.renderFirst.catch(()=>{});}catch(e){throw cleanupFailure('render-first-acquire',e);}
   try{o.renderCancel=callable(o.render.cancel);}catch(e){for(const t of tasks)void destroy(t);throw cleanupFailure('render-cancel-acquire',e);}
   check(o);await o.renderFirst;check(o);o.render=null;
   let png=null,pngKey=null;
   if(purpose==='recognition'){
    phase='encoding';pngKey={};o.temp.add(pngKey);reserve(pngKey,{resourceBytes:2*Q,resourceCount:2},o);check(o);const blob=await ports.encodePng(canvas);check(o);
    const n=apply(blobSize,blob,[]);if(n<33||n>Q||apply(blobType,blob,[])!=='image/png')fail('PNG');check(o);const buffer=await ports.readBlob(blob);if(apply(bufferSize,buffer,[])!==n||(resizable&&apply(resizable,buffer,[])))fail('PNG');const data=new Uint8Array(buffer);o.arrays.add(data);check(o);png=pngHeader(data,width,height);check(o);leases.set(pngKey,{resourceBytes:Q,resourceCount:1});
   }
   let firstDispose;const frame={pageIndex:i,width,height,geometry:clone(geometry),inspection:inspection?clone(inspection):null,png,
    usage:{resourceBytes:4*width*height+(png?Q:0),resourceCount:png?2:1,artifactBytes:0},
    mount(host){return run('mount',{},async job=>{const fn=append??callable(host?.appendChild);check(job);if(firstDispose)fail('CLOSED');apply(fn,host,[canvas]);});},
    dispose(){if(firstDispose)return firstDispose;firstDispose=Promise.resolve().then(()=>{attempt('frame-canvas',()=>ports.resetCanvas(canvas));if(png)attempt('frame-bytes',()=>clear(png));if(cleanupFailures.length)throw cleanupFailures[0];leases.delete(canvasKey);if(pngKey)leases.delete(pngKey);if(frameHeld===frame)frameHeld=null;});firstDispose.catch(()=>{});return firstDispose;}
   };
   frameHeld=frame;o.result=frame;o.canvases.delete(canvas);o.temp.delete(canvasKey);if(pngKey)o.temp.delete(pngKey);if(png)o.arrays.delete(png);return Object.freeze(frame);
  });},
  copyBase(options){return run('copy',options,async o=>{if(copies.size>=2)fail('COPIES');const key={};o.temp.add(key);reserve(key,{artifactBytes:S,resourceCount:1},o);const data=new Uint8Array(S);o.arrays.add(data);apply(set,data,[baseBytes]);check(o);let done=false;const copy={bytes:data,dispose(){if(done)return;try{clear(data);}catch(e){throw cleanupFailure('copy-clear',e);}done=true;leases.delete(key);copies.delete(copy);}};copies.add(copy);o.arrays.delete(data);o.temp.delete(key);return Object.freeze(copy);});},
  cancel(cause){return requestClose(cause);},
  drained(){return closeFirst??op?.first??Promise.resolve();},
  dispose(){if(disposeFirst)return disposeFirst;disposeFirst=(async()=>{try{await requestClose(undefined);}catch{}if([...retainedOps].some(o=>o.workPending))throw cleanupFailures[0]??error('CLEANUP',undefined);if(frameHeld)try{await frameHeld.dispose();}catch{}for(const copy of [...copies])attempt('copy-dispose',()=>copy.dispose());attempt('base-clear',()=>clear(baseBytes));if(cleanupFailures.length)throw cleanupFailures[0];leases.clear();disposed=true;phase='disposed';})();disposeFirst.catch(()=>{});return disposeFirst;},
  view(){return {phase,owner:{...expected},metadata:metadata?{...metadata}:null,pending:!!op,frameHeld:!!frameHeld,attempts,attemptPixels,previewRenders,usage:live(),fenced,lastError:lastError?{...lastError}:null};}
 };
 return Object.freeze(api);
}
