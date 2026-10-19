// BrowserPDF OCR foundation, 2026-10-19. Deliberately not imported by any route.
import {assertDocumentWorkspaceBudget} from './core/document-draft.js';
/* BEGIN GENERATED OCR PINS */
const PINS = {"main":{"url":"/vendor/ocr-7.0.0/tesseract.browserpdf-owner-20261019.esm.js","bytes":71533,"sha256":"1c12db34982b2dd905532431374f5127cbd5485ac163b1a7db98b56f53160b8a"},"worker":{"url":"/vendor/ocr-7.0.0/worker.browserpdf-guard-20261019.js","bytes":125485,"sha256":"1bd038a24f06a7b49bbc98dbe8c5d67acfaad49d29343d0a1e4f84c42fff58b2"},"core":{"url":"/vendor/ocr-7.0.0/tesseract-core-lstm.wasm.js","bytes":3896484,"sha256":"eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680"},"eng":{"url":"/vendor/ocr-7.0.0/eng.traineddata","bytes":5199098,"sha256":"5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747"},"tur":{"url":"/vendor/ocr-7.0.0/tur.traineddata","bytes":4680866,"sha256":"f0127d0f3745f9c65e2ae7ec6b23198fbe5aa186a61b35661426f5e1ef9dedd7"},"ownership":{"url":"/js/ocr-ownership.js","bytes":10675,"sha256":"87e22994bbadffe3fda50e7818236445d448b39e37ff81478bce43577ec3e28e"},"host":{"url":"/js/ocr-host.js","bytes":14656,"sha256":"8e7f4ded00725f92977fc8a2eddbaa781ef248c72cf928f4c217b1812d22486c"}};
/* END GENERATED OCR PINS */

const apply=Reflect.apply,G=globalThis;
const fetchNative=G.fetch,WorkerClass=G.Worker,BlobClass=G.Blob;
const createUrl=URL.createObjectURL,revokeUrl=URL.revokeObjectURL;
const timerSet=G.setTimeout,timerClear=G.clearTimeout;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,abortReason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener,abort=AbortController.prototype.abort;
const responseBody=Object.getOwnPropertyDescriptor(Response.prototype,'body').get,responseStatus=Object.getOwnPropertyDescriptor(Response.prototype,'status').get,responseHeaders=Object.getOwnPropertyDescriptor(Response.prototype,'headers').get;
const headerGet=Headers.prototype.get,getReader=ReadableStream.prototype.getReader,readerRead=ReadableStreamDefaultReader.prototype.read,readerCancel=ReadableStreamDefaultReader.prototype.cancel,releaseLock=ReadableStreamDefaultReader.prototype.releaseLock;
const digestNative=crypto.subtle.digest,subtle=crypto.subtle;
const workerPost=WorkerClass?.prototype.postMessage,workerTerminate=WorkerClass?.prototype.terminate;
const typed=Object.getPrototypeOf(Uint8Array.prototype),tag=Object.getOwnPropertyDescriptor(typed,Symbol.toStringTag).get,size=Object.getOwnPropertyDescriptor(typed,'byteLength').get,offset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,buffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,abSize=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
const ByteView=Uint8Array,HeaderView=DataView,headerByte=DataView.prototype.getUint8,headerWord=DataView.prototype.getUint32;
const reservation=Object.freeze({resourceBytes:50331648,resourceCount:32});
let activeTask=null,lifetimeFence=false;
function problem(code,cause){let d;try{if(cause&&typeof cause==='object')d=Object.getOwnPropertyDescriptor(cause,'message');}catch{}const message=typeof cause==='string'?cause:typeof d?.value==='string'?d.value:'OCR operation failed.';const e=new Error(message.slice(0,512));e.code=code;e.name=code==='OCR_ABORT'?'AbortError':'OcrFoundationError';Object.defineProperty(e,'cause',{value:cause});return e;}
function fail(code,message){throw problem(code,message);}
function own(v,k){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('OCR_INPUT','Expected own data.');return d.value;}
function exact(v,keys,optional=[]){if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail('OCR_INPUT','Expected plain options/data.');const ks=Reflect.ownKeys(v);if(ks.length>keys.length+optional.length||ks.some(k=>!keys.includes(k)&&!optional.includes(k))||keys.some(k=>!ks.includes(k)))fail('OCR_INPUT','Unexpected fields.');for(const k of ks)own(v,k);return v;}
function integer(v,min,max){if(!Number.isSafeInteger(v)||v<min||v>max)fail('OCR_INPUT','Invalid finite integer.');return v;}
function text(v,max){if(typeof v!=='string'||v.length>max)fail('OCR_LIMIT','String exceeds its finite bound.');return v;}
function number(v,min=-1e6,max=1e6){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail('OCR_INPUT','Invalid finite number.');return v;}
function confidence(v){return v===null?null:number(v,0,100);}
function byteView(v,max,expected){try{const n=size.call(v);if(tag.call(v)!=='Uint8Array'||offset.call(v)!==0||n<1||n>max||abSize.call(buffer.call(v))!==n||(expected!==undefined&&n!==expected))throw 0;}catch{fail('OCR_INPUT','Use exact nonshared Uint8Array backing.');}return v;}
function checkPng(c){
 try{if(apply(abSize,c.backing,[])!==c.bytes||(resizable&&apply(resizable,c.backing,[])))throw 0;}catch{fail('OCR_INPUT','PNG backing must remain fixed, nonshared and attached.');}
 const header=new HeaderView(c.backing,0,c.bytes);
 if([137,80,78,71,13,10,26,10].some((n,i)=>apply(headerByte,header,[i])!==n)||apply(headerWord,header,[8])!==13||apply(headerWord,header,[12])!==0x49484452||apply(headerWord,header,[16])!==c.width||apply(headerWord,header,[20])!==c.height)fail('OCR_INPUT','PNG dimensions/signature disagree.');
}
function capturePng(v,width,height){
 integer(width,1,4096);integer(height,1,4096);let backing,bytes;
 try{backing=apply(buffer,v,[]);bytes=apply(size,v,[]);if(apply(tag,v,[])!=='Uint8Array'||apply(offset,v,[])!==0||bytes<33||bytes>4194304||apply(abSize,backing,[])!==bytes||(resizable&&apply(resizable,backing,[])))throw 0;}catch{fail('OCR_INPUT','Use fixed exact nonshared PNG backing.');}
 if(width*height>1000000)fail('OCR_LIMIT','PNG pixel bound.');
 const captured={backing,bytes,width,height,png:new ByteView(backing,0,bytes)};checkPng(captured);return captured;
}
function deferred(){let resolve,reject,state='pending';const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,get state(){return state;},resolve(v){if(state!=='pending')return;state='fulfilled';resolve(v);},reject(e){if(state!=='pending')return;state='rejected';reject(e);}};}
const hash=async bytes=>Array.from(new Uint8Array(await apply(digestNative,subtle,['SHA-256',bytes])),v=>v.toString(16).padStart(2,'0')).join('');
function canonical(snapshot){const v={taskId:own(snapshot,'taskId'),revision:own(snapshot,'revision'),generation:own(snapshot,'generation')};text(v.taskId,100);if(!v.taskId.length)fail('OCR_INPUT','A canonical task is required.');integer(v.revision,0,Number.MAX_SAFE_INTEGER);integer(v.generation,0,Number.MAX_SAFE_INTEGER);return v;}
const same=(a,b)=>a.taskId===b.taskId&&a.revision===b.revision&&a.generation===b.generation;

export function createOcrHostTask(options){
 exact(options,['sessionUsage'],['language','signal','getExternalUsage']);
 const {sessionUsage,signal}=options,language=options.language===undefined?'eng':options.language,getExternalUsage=options.getExternalUsage===undefined?(()=>({})):options.getExternalUsage;
 if(typeof sessionUsage!=='function'||typeof getExternalUsage!=='function'||!['eng','tur'].includes(language))fail('OCR_INPUT','Select one pinned language and trusted usage accessors.');
 if(signal!==undefined)try{aborted.call(signal);}catch{fail('OCR_INPUT','A genuine AbortSignal is required.');}
 const checkSignal=()=>{if(signal!==undefined&&aborted.call(signal))throw problem('OCR_ABORT',abortReason.call(signal));};checkSignal();
 if(!PINS||Object.values(PINS).some(p=>!p?.sha256||!p.bytes))fail('OCR_INTEGRITY','Runtime source pins have not been locked.');
 if(lifetimeFence)fail('OCR_CLEANUP','OCR cleanup failed. Reload before starting another task.');if(activeTask)fail('OCR_BUSY','An OCR task still owns its reservation.');
 const captured=canonical(sessionUsage());checkSignal();if(activeTask||lifetimeFence)fail(lifetimeFence?'OCR_CLEANUP':'OCR_BUSY','OCR ownership changed during callback admission.');const token={};activeTask=token;
 let closing=false,disposed=false,fenced=false,reserved=true,failurePresent=false,failure,releasePromise=null;
 let host=null,bootstrapSent=false,hostAttached=false,errorAttached=false,messageErrorAttached=false,signalAttached=false,jobHandle=null,jobPresent=false,firstBoot=null,firstPage=null,firstPublication=null,asset=null,serial=0,progressCount=0,progressBytes=0;
 let hostRelease=null,phase='reserved',selectedPixels=0,totalLines=0;
 const ready=deferred(),requests=new Map(),rpcTimers=new Set(),urls=new Set(),buffers=new Set(),pages=new Set(),pauses=new Set(),cleanupFailures=[];
 const attempt=(stage,fn)=>{try{return fn();}catch(cause){cleanupFailures.push({stage,error:problem('OCR_CLEANUP',cause)});return undefined;}};
 function guard(){
  if(closing)throw problem('OCR_CLOSED','OCR task is closing.');checkSignal();
  const external=getExternalUsage(),snapshot=sessionUsage();assertDocumentWorkspaceBudget(snapshot,external,reservation);
  const current=canonical(sessionUsage());if(!same(current,captured))fail('OCR_STALE','Canonical source owner changed.');
  checkSignal();if(closing)fail('OCR_CLOSED','OCR task is closing.');
 }
 function record(cause,code='OCR_NATIVE'){if(!failurePresent){failurePresent=true;let alreadyFinite=false;try{const d=cause&&typeof cause==='object'?Object.getOwnPropertyDescriptor(cause,'code'):null;alreadyFinite=cause instanceof Error&&typeof d?.value==='string';}catch{}failure=alreadyFinite?cause:problem(code,cause);}}
 function requestStop(cause,code='OCR_NATIVE'){
  if(cause!==undefined||code!=='OCR_DISPOSE')record(cause,code);
  if(releasePromise)return releasePromise;
  closing=true;phase='draining';const e=failurePresent?failure:problem('OCR_CLOSED','OCR task disposed.');ready.reject(e);for(const request of requests.values())request.reject(e);requests.clear();
  // Defer cleanup one microtask so a handle returned by an in-progress native
  // registration/constructor is owned before cleanup examines it.
  releasePromise=Promise.resolve().then(cleanup);releasePromise.catch(()=>{});return releasePromise;
 }
 function clearJob(){if(jobPresent){apply(timerClear,G,[jobHandle]);jobPresent=false;jobHandle=null;}}
 async function cleanup(){
  attempt('job-timer',clearJob);
  for(const slot of rpcTimers)attempt('reply-timer',()=>clearRpcTimer(slot));
  for(const slot of pauses){attempt('cooperation-timer',()=>apply(timerClear,G,[slot.handle]));slot.resolve();}pauses.clear();
  if(signalAttached){signalAttached=false;attempt('signal-listener',()=>apply(remove,signal,['abort',onAbort]));}
  if(asset){attempt('fetch-abort',()=>apply(abort,asset.controller,[]));asset.stopReader();}
  if(firstBoot)try{await firstBoot;}catch{}if(firstPage)try{await firstPage;}catch{}if(firstPublication)try{await firstPublication;}catch{}
  let childKnown=host===null||!bootstrapSent,hostTerminationInvoked=false;
  if(host&&bootstrapSent){
   const ack=deferred();ack.requestId='release-'+(++serial);hostRelease=ack;let handle,present=false;
   try{handle=apply(timerSet,G,[()=>ack.resolve(null),5000]);present=true;}catch(e){cleanupFailures.push({stage:'release-timer',error:problem('OCR_CLEANUP',e)});ack.resolve(null);}
   try{apply(workerPost,host,[{type:'dispose',requestId:ack.requestId}]);}catch(e){cleanupFailures.push({stage:'dispose-post',error:problem('OCR_CLEANUP',e)});ack.resolve(null);}
   const facts=await ack.promise;
   if(present)attempt('release-timer-clear',()=>apply(timerClear,G,[handle]));
   childKnown=facts?.released===true&&facts.physicalExitAcknowledged===false;
   if(!childKnown)cleanupFailures.push({stage:'child-release',error:problem('OCR_CLEANUP','Direct child release is unverified.')});
  }
  if(host){
   if(hostAttached)attempt('host-message-listener',()=>apply(remove,host,['message',onMessage]));
   if(errorAttached)attempt('host-error-listener',()=>apply(remove,host,['error',onHostError]));
   if(messageErrorAttached)attempt('host-messageerror-listener',()=>apply(remove,host,['messageerror',onHostError]));
   hostTerminationInvoked=true;attempt('host-terminate',()=>apply(workerTerminate,host,[]));
  }
  for(const url of urls)attempt('url-revoke',()=>apply(revokeUrl,URL,[url]));
  for(const bytes of buffers)attempt('byte-clear',()=>{if(bytes.byteLength)bytes.fill(0);});
  const released=childKnown&&cleanupFailures.length===0;
  if(released){urls.clear();buffers.clear();host=null;reserved=false;disposed=true;phase='released';activeTask=null;}
  else{fenced=true;lifetimeFence=true;phase='fenced';throw problem('OCR_CLEANUP',cleanupFailures[0]?.error??'Cleanup was not verified.');}
  return Object.freeze({released:true,hostTerminationInvoked,physicalExitAcknowledged:false});
 }
 function onAbort(){if(aborted.call(signal))void requestStop(problem('OCR_ABORT',abortReason.call(signal)));}
 function onHostError(){void requestStop(problem('OCR_HOST','OCR host transport failed.'));}
 function pause(){return new Promise((resolve,reject)=>{const slot={handle:null,resolve};pauses.add(slot);try{slot.handle=apply(timerSet,G,[()=>{pauses.delete(slot);resolve();},0]);}catch(e){pauses.delete(slot);reject(e);}});}

 async function fetchAsset(pin){
  guard();if(pin.bytes>8388608)fail('OCR_LIMIT','Asset exceeds its finite cap.');
  const bytes=new Uint8Array(pin.bytes);buffers.add(bytes);const controller=new AbortController();
  const state={controller,reader:null,firstRead:null,firstCancel:null,firstDigest:null,timer:null,timerPresent:false,stopReader(){if(this.reader&&!this.firstCancel){try{this.firstCancel=Promise.resolve(apply(readerCancel,this.reader,[]));}catch(e){this.firstCancel=Promise.reject(e);}this.firstCancel.catch(()=>{});}}};asset=state;
  let firstFetch,at=0,reads=0,success=false;
  try{
   state.timer=apply(timerSet,G,[()=>{void requestStop(problem('OCR_TIMEOUT','Pinned asset deadline exceeded.'));},30000]);state.timerPresent=true;
   guard();firstFetch=Promise.resolve(apply(fetchNative,G,[pin.url,{redirect:'error',cache:'no-store',credentials:'same-origin',signal:controller.signal}]));firstFetch.catch(()=>{});
   const response=await firstFetch;
   // Own a late response body before checking cancellation or response status.
   const body=apply(responseBody,response,[]);if(body)state.reader=apply(getReader,body,[]);
   guard();if(apply(responseStatus,response,[])!==200||!state.reader)fail('OCR_FETCH','Pinned asset response failed.');
   const length=apply(headerGet,apply(responseHeaders,response,[]),['content-length']);if(length!==null&&length!==String(pin.bytes))fail('OCR_INTEGRITY','Asset Content-Length disagrees.');
   while(true){guard();if(++reads>4096)fail('OCR_LIMIT','Asset stream chunk count exceeded.');state.firstRead=Promise.resolve(apply(readerRead,state.reader,[]));state.firstRead.catch(()=>{});const chunk=await state.firstRead;guard();if(chunk.done)break;
    const view=chunk.value;try{if(tag.call(view)!=='Uint8Array')throw 0;}catch{fail('OCR_INPUT','Asset stream requires byte chunks.');}
    const n=size.call(view);if(n>pin.bytes-at)fail('OCR_INTEGRITY','Asset stream exceeds exact extent.');bytes.set(view,at);at+=n;
   }
   if(at!==pin.bytes)fail('OCR_INTEGRITY','Asset stream ended before exact extent.');
   guard();state.firstDigest=hash(bytes);state.firstDigest.catch(()=>{});const actual=await state.firstDigest;guard();if(actual!==pin.sha256)fail('OCR_INTEGRITY','Pinned asset SHA256 mismatch.');success=true;return bytes;
  }finally{
   if(!success){attempt('asset-abort',()=>apply(abort,controller,[]));state.stopReader();}
   if(firstFetch)try{await firstFetch;}catch{}if(state.firstRead)try{await state.firstRead;}catch{}if(state.firstDigest)try{await state.firstDigest;}catch{}
   if(state.firstCancel)try{await state.firstCancel;}catch(e){cleanupFailures.push({stage:'reader-cancel',error:problem('OCR_CLEANUP',e)});}
   if(state.reader)attempt('reader-release-lock',()=>apply(releaseLock,state.reader,[]));
   if(state.timerPresent)attempt('asset-timer-clear',()=>{apply(timerClear,G,[state.timer]);state.timerPresent=false;});
   if(cleanupFailures.length){fenced=true;lifetimeFence=true;throw problem('OCR_CLEANUP',cleanupFailures[0].error);}
   if(asset===state)asset=null;
  }
 }

 function clearRpcTimer(slot){if(slot.clearFailed)throw slot.clearError;if(!slot.present)return;try{apply(timerClear,G,[slot.handle]);slot.present=false;rpcTimers.delete(slot);}catch(cause){slot.clearFailed=true;slot.clearError=problem('OCR_CLEANUP',cause);throw slot.clearError;}}
 function rpc(type,fields={},transfer=[],pngCapture=null){
  guard();const requestId='ocr-'+(++serial),d=deferred();d.expected=type==='init'?'ready':'page';d.present=false;requests.set(requestId,d);rpcTimers.add(d);
  try{d.handle=apply(timerSet,G,[()=>{d.present=false;rpcTimers.delete(d);void requestStop(problem('OCR_TIMEOUT','OCR host reply deadline exceeded.'));},type==='init'?60000:120000]);d.present=true;guard();if(pngCapture)checkPng(pngCapture);if(type==='init')bootstrapSent=true;apply(workerPost,host,[{type,requestId,...fields},{transfer}]);}
  catch(e){requests.delete(requestId);d.reject(e);}return d.promise;
 }
 function box(v,w,h,positive){exact(v,['x0','y0','x1','y1']);const out={x0:number(v.x0,0,w),y0:number(v.y0,0,h),x1:number(v.x1,0,w),y1:number(v.y1,0,h)};if(positive&&(out.x1<=out.x0||out.y1<=out.y0))fail('OCR_INPUT','Invalid positive box.');return out;}
 async function validatePage(raw){
  exact(raw,['pageId','width','height','text','confidence','lines','counts']);text(raw.pageId,100);integer(raw.width,1,4096);integer(raw.height,1,4096);if(raw.width*raw.height>1000000)fail('OCR_LIMIT','DTO pixels.');text(raw.text,200000);confidence(raw.confidence);
  if(!Array.isArray(raw.lines)||raw.lines.length>1000)fail('OCR_LIMIT','DTO lines.');exact(raw.counts,['words','symbols','choices']);integer(raw.counts.words,0,10000);integer(raw.counts.symbols,0,100000);integer(raw.counts.choices,0,20000);
  let schemaActions=0;async function schemaStep(){if(++schemaActions>=128){schemaActions=0;await pause();guard();}}
  for(const line of raw.lines){await schemaStep();exact(line,['rawText','confidence','bbox','baseline','rowAttributes','fonts']);text(line.rawText,4096);confidence(line.confidence);box(line.bbox,raw.width,raw.height,true);if(line.baseline!==null)box(line.baseline,raw.width,raw.height,false);if(line.rowAttributes!==null){exact(line.rowAttributes,['rowHeight','descenders','ascenders']);for(const v of Object.values(line.rowAttributes)){await schemaStep();number(v);}}if(!Array.isArray(line.fonts)||line.fonts.length>32)fail('OCR_LIMIT','DTO fonts.');for(const font of line.fonts){await schemaStep();exact(font,[],['font_name','font_size','pointsize','font_id','language','direction','is_bold','is_italic','is_underlined','is_monospace','is_serif','is_smallcaps']);for(const v of Object.values(font)){await schemaStep();if(typeof v==='string')text(v,128);else if(v!==null&&typeof v!=='boolean')number(v);}}}
  let encoded=0,units=0,actions=0,visits=0,total=0;
  const addBytes=n=>{encoded+=n;if(encoded>1048576)fail('OCR_LIMIT','Host DTO exceeds one MiB.');};
  async function tick(){if(++total>1000000)fail('OCR_LIMIT','DTO work.');if(++actions>=128||visits>=16384){actions=0;visits=0;await pause();guard();}}
  async function string(s){units+=s.length;if(units>200000)fail('OCR_LIMIT','All DTO strings exceed their bound.');addBytes(2);for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const low=s.charCodeAt(++i);if(!(low>=0xdc00&&low<=0xdfff))fail('OCR_INPUT','Unpaired Unicode.');addBytes(4);}else if(c>=0xdc00&&c<=0xdfff)fail('OCR_INPUT','Unpaired Unicode.');else addBytes(c===34||c===92?2:c<32?([8,9,10,12,13].includes(c)?2:6):c<128?1:c<2048?2:3);if(++visits>=16384)await tick();}}
  async function visit(v,depth=0){if(depth>8)fail('OCR_LIMIT','DTO depth.');await tick();if(typeof v==='string')return string(v);if(typeof v==='number'){number(v);addBytes(String(v).length);return;}if(v===null||typeof v==='boolean'){addBytes(v===null?4:v?4:5);return;}if(Array.isArray(v)){if(v.length>1000||Reflect.ownKeys(v).length!==v.length+1)fail('OCR_INPUT','DTO dense array.');addBytes(2+Math.max(0,v.length-1));for(let i=0;i<v.length;i++)await visit(own(v,String(i)),depth+1);return;}if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail('OCR_INPUT','DTO own data.');const keys=Reflect.ownKeys(v);if(keys.length>32||keys.some(k=>typeof k!=='string'))fail('OCR_LIMIT','DTO keys.');addBytes(2+Math.max(0,keys.length-1));for(const k of keys){await string(k);addBytes(1);await visit(own(v,k),depth+1);}}
  await visit(raw);guard();return raw;
 }
 function onMessage(event){
  let ownedRequest=null;
  try{
   const m=event.data,type=own(m,'type'),id=own(m,'requestId');
   if(type==='release'){exact(m,['type','requestId','release']);if(hostRelease){if(id!==hostRelease.requestId)fail('OCR_HOST','Release identity mismatch.');const r=m.release;exact(r,['released','terminationInvoked','physicalExitAcknowledged','failures','lane']);if(typeof r.released!=='boolean'||typeof r.terminationInvoked!=='boolean'||r.physicalExitAcknowledged!==false||!Array.isArray(r.failures)||r.failures.length>8)fail('OCR_HOST','Malformed release facts.');for(const f of r.failures){exact(f,['code','message']);text(f.code,64);text(f.message,512);}if(r.lane!==null){exact(r.lane,['busy','fenced','starts']);if(typeof r.lane.busy!=='boolean'||typeof r.lane.fenced!=='boolean')fail('OCR_HOST','Malformed lane facts.');integer(r.lane.starts,0,100);}if(r.released&&(r.failures.length||r.lane?.busy||r.lane?.fenced))fail('OCR_HOST','Release contradicts owned lane facts.');hostRelease.resolve(r);}return;}
   if(closing)return;
   if(type==='progress'){exact(m,['type','requestId','phase']);text(m.phase,32);if(++progressCount>128||(progressBytes+=JSON.stringify(m).length)>8192)fail('OCR_LIMIT','Host progress bound.');phase=m.phase;return;}
   const request=requests.get(id);if(!request)fail('OCR_HOST','Unexpected or duplicate host terminal.');ownedRequest=request;requests.delete(id);if(type!=='error'&&type!==request.expected)fail('OCR_HOST','Host response action mismatch.');
   if(type==='error'){exact(m,['type','requestId','error']);exact(m.error,['code','message']);text(m.error.code,64);text(m.error.message,512);clearRpcTimer(request);const e=problem('OCR_HOST',m.error.message);request.reject(e);void requestStop(e);return;}
   if(type==='ready'){exact(m,['type','requestId']);clearRpcTimer(request);guard();request.resolve();return;}
   if(type!=='page')fail('OCR_HOST','Unknown host packet.');exact(m,['type','requestId','page']);
   firstPublication=validatePage(m.page);const publication=firstPublication;publication.catch(()=>{});void publication.then(page=>{clearRpcTimer(request);guard();request.resolve(page);},e=>{request.reject(e);void requestStop(e);}).catch(e=>{request.reject(e);void requestStop(e);}).finally(()=>{if(firstPublication===publication)firstPublication=null;});
  }catch(e){ownedRequest?.reject(e);if(hostRelease)hostRelease.resolve(null);void requestStop(e);}
 }
 async function boot(){
  const verified={};for(const name of ['main','worker','core',language,'ownership','host']){guard();phase='verifying-'+name;verified[name]=await fetchAsset(PINS[name]);}
  const bootstrap={};for(const name of ['main','worker','core','ownership','host']){guard();const blob=new BlobClass([verified[name]],{type:'text/javascript'});guard();const url=apply(createUrl,URL,[blob]);urls.add(url);bootstrap[name]=url;}
  // Exact bytes were hashed before Blob creation; Blob copies those immutable
  // bytes, and no source transform/import rewriting occurs at this boundary.
  for(const name of ['main','worker','core','ownership','host']){verified[name].fill(0);buffers.delete(verified[name]);}
  guard();host=new WorkerClass(bootstrap.host,{type:'module',name:'browserpdf-owned-ocr'});
  guard();hostAttached=true;apply(add,host,['message',onMessage]);errorAttached=true;apply(add,host,['error',onHostError]);messageErrorAttached=true;apply(add,host,['messageerror',onHostError]);
  const model=verified[language];byteView(model,PINS[language].bytes,PINS[language].bytes);guard();await rpc('init',{language,bootstrap:{main:bootstrap.main,worker:bootstrap.worker,core:bootstrap.core,ownership:bootstrap.ownership},model},[apply(buffer,model,[])]);guard();phase='ready';
 }
 try{guard();if(signal!==undefined){signalAttached=true;apply(add,signal,['abort',onAbort]);}guard();jobHandle=apply(timerSet,G,[()=>{void requestStop(problem('OCR_TIMEOUT','OCR task deadline exceeded.'));},300000]);jobPresent=true;guard();}
 catch(e){void requestStop(e);}
 if(!closing){firstBoot=Promise.resolve().then(boot);const bootPromise=firstBoot;bootPromise.catch(()=>{});void bootPromise.then(()=>{if(firstBoot===bootPromise)firstBoot=null;ready.resolve();},e=>{if(firstBoot===bootPromise)firstBoot=null;void requestStop(e);});}
 const api={
  ready:ready.promise,
  recognize(request){
   if(closing)return Promise.reject(problem('OCR_CLOSED','OCR task is closing.'));if(ready.state!=='fulfilled'||firstPage)return Promise.reject(problem('OCR_BUSY','OCR is not ready for another page.'));
   // Reserve before caller data inspection or any usage callback. This promise
   // is also the FIRST drain if a callback cancels/disposes during admission.
   const operation=deferred(),pending=operation.promise;firstPage=pending;let captured;
   try{
    exact(request,['pageId','png','width','height']);const pageId=own(request,'pageId'),input=own(request,'png'),width=own(request,'width'),height=own(request,'height');
    text(pageId,100);if(serial>=63)fail('OCR_LIMIT','Task request work exceeds its finite bound.');if(!pageId.length||(!pages.has(pageId)&&pages.size>=20))fail('OCR_LIMIT','Selected page count.');
    captured=capturePng(input,width,height);captured.pageId=pageId;if(selectedPixels+width*height>20000000)fail('OCR_LIMIT','Selected pixel work.');guard();
   }catch(e){operation.reject(e);if(firstPage===pending)firstPage=null;return pending;}
   const work=Promise.resolve().then(async()=>{
    guard();checkPng(captured);buffers.add(captured.png);pages.add(captured.pageId);selectedPixels+=captured.width*captured.height;phase='recognizing';
    const fields={pageId:captured.pageId,width:captured.width,height:captured.height,png:captured.png};
    const page=await rpc('recognize',fields,[captured.backing],captured);guard();if(page.pageId!==captured.pageId||page.width!==captured.width||page.height!==captured.height)fail('OCR_HOST','Page identity/geometry mismatch.');totalLines+=page.lines.length;if(totalLines>10000)fail('OCR_LIMIT','Task line count.');phase='ready';return page;
   });
   work.catch(()=>{});void work.then(page=>operation.resolve(page),e=>{operation.reject(e);void requestStop(e);});
   void pending.then(()=>{if(firstPage===pending)firstPage=null;},()=>{if(firstPage===pending)firstPage=null;});return pending;
  },
  cancel(reason){return requestStop(reason,'OCR_ABORT');},dispose(){return requestStop(undefined,'OCR_DISPOSE');},
  view(){return {phase,language,closing,disposed,fenced:!!(fenced||lifetimeFence),failurePresent,resourceBytes:reserved?reservation.resourceBytes:0,resourceCount:reserved?reservation.resourceCount:0,pending:!!(firstBoot||firstPage||firstPublication),selectedPages:pages.size,selectedPixels,totalLines,physicalExitAcknowledged:false};},
 };
 return Object.freeze(api);
}
