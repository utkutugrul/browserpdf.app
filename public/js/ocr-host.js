// BrowserPDF owned OCR module host, 2026-10-19. Standalone verified Blob entry.
// No SDK private messages, global Worker replacement, or relative imports.
const apply=Reflect.apply,sendNative=globalThis.postMessage,globalReceiver=globalThis;
const timerSet=globalThis.setTimeout,timerClear=globalThis.clearTimeout;
const WorkerClass=globalThis.Worker,terminateNative=WorkerClass.prototype.terminate;
const addNative=EventTarget.prototype.addEventListener,removeNative=EventTarget.prototype.removeEventListener;
const typed=Object.getPrototypeOf(Uint8Array.prototype),tag=Object.getOwnPropertyDescriptor(typed,Symbol.toStringTag).get;
const size=Object.getOwnPropertyDescriptor(typed,'byteLength').get,offset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,buffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,abSize=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const modelPins=Object.freeze({eng:{bytes:5199098,sha256:'5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747'},tur:{bytes:4680866,sha256:'f0127d0f3745f9c65e2ae7ec6b23198fbe5aa186a61b35661426f5e1ef9dedd7'}});
const digestNative=crypto.subtle.digest,subtle=crypto.subtle;
let initialized=false,closed=false,fenced=false,lane=null,owner=null,first=null,release=null,model=null,jobTimer=null,currentId=null;
let progressCount=0,progressBytes=0,totalPixels=0,totalLines=0,invalidReplied=false,publicationFailed=false,publicationCause;
const seen=new Set(),terminals=new Set(),pages=new Set(),pauses=new Set(),pauseFailures=[],encoder=new TextEncoder();
function error(code,message){const e=new Error(message);e.code=code;return e;}
function fail(code,message){throw error(code,message);}
function finite(cause,code='OCR_HOST_NATIVE'){const c=cause&&typeof cause==='object'?Object.getOwnPropertyDescriptor(cause,'code'):null,m=cause&&typeof cause==='object'?Object.getOwnPropertyDescriptor(cause,'message'):null;return {code:typeof c?.value==='string'?c.value.slice(0,64):code,message:typeof m?.value==='string'?m.value.slice(0,512):'OCR host operation failed.'};}
function post(value){if(publicationFailed)return;try{apply(sendNative,globalReceiver,[value]);}catch(cause){publicationFailed=true;publicationCause=cause;void stop();}}
function terminal(type,requestId,data){if(terminals.has(requestId))return;terminals.add(requestId);post({type,requestId,...data});}
function own(v,k){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('OCR_HOST_INPUT','Expected own data.');return d.value;}
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail('OCR_HOST_INPUT','Expected plain data.');const ks=Reflect.ownKeys(v);if(ks.length!==keys.length||ks.some(k=>!keys.includes(k)))fail('OCR_HOST_INPUT','Unexpected fields.');for(const k of keys)own(v,k);return v;}
function text(v,max){if(typeof v!=='string'||v.length>max)fail('OCR_HOST_LIMIT','Text exceeds its finite bound.');return v;}
function integer(v,min,max){if(!Number.isSafeInteger(v)||v<min||v>max)fail('OCR_HOST_INPUT','Integer exceeds its finite bound.');return v;}
function number(v,min=-1e6,max=1e6){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail('OCR_HOST_INPUT','Invalid finite number.');return v;}
function confidence(v){return v===null?null:number(v,0,100);}
function bytes(v,max,expected){try{if(tag.call(v)!=='Uint8Array'||offset.call(v)!==0||size.call(v)<1||size.call(v)>max||abSize.call(buffer.call(v))!==size.call(v)||(expected!==undefined&&size.call(v)!==expected))throw 0;}catch{fail('OCR_HOST_INPUT','Expected exact nonshared Uint8Array backing.');}return v;}
function png(v,w,h){bytes(v,4194304);integer(w,1,4096);integer(h,1,4096);if(w*h>1000000||v.length<33||[137,80,78,71,13,10,26,10].some((n,i)=>v[i]!==n)||new DataView(v.buffer).getUint32(8)!==13||String.fromCharCode(...v.subarray(12,16))!=='IHDR'||new DataView(v.buffer).getUint32(16)!==w||new DataView(v.buffer).getUint32(20)!==h)fail('OCR_HOST_INPUT','PNG dimensions/signature disagree.');}
function dense(v,max){if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length>max||Reflect.ownKeys(v).length!==v.length+1)fail('OCR_HOST_LIMIT','Expected finite dense array.');for(let i=0;i<v.length;i++)own(v,String(i));return v;}
function geometry(v,w,h,positive){exact(v,['x0','y0','x1','y1']);const b={x0:number(v.x0,0,w),y0:number(v.y0,0,h),x1:number(v.x1,0,w),y1:number(v.y1,0,h)};if(positive&&(b.x1<=b.x0||b.y1<=b.y0))fail('OCR_HOST_INPUT','Bounding box needs positive extents.');return b;}
function live(){if(closed)fail('OCR_HOST_CLOSED','OCR host is closing.');}
const digest=async v=>Array.from(new Uint8Array(await apply(digestNative,subtle,['SHA-256',v])),x=>x.toString(16).padStart(2,'0')).join('');
function pause(){return new Promise((resolve,reject)=>{const slot={handle:null,resolve};pauses.add(slot);try{slot.handle=apply(timerSet,globalReceiver,[()=>{pauses.delete(slot);resolve();},0]);}catch(e){pauses.delete(slot);reject(e);}});}
function progress(phase){const v={type:'progress',requestId:currentId,phase},n=encoder.encode(JSON.stringify(v)).length;if(progressCount<128&&progressBytes+n<=8192){progressCount++;progressBytes+=n;post(v);}}

// Bounds exact UTF8 JSON size before allocating a serialized packet. All stored
// strings, including keys, are charged; no literal text is normalized or trimmed.
async function admitDto(dto){
 let encoded=0,units=0,actions=0,visits=0,total=0;
 async function tick(n=1){visits+=n;total+=n;if(total>1000000)fail('OCR_HOST_LIMIT','DTO work exceeds its bound.');if(++actions>=128||visits>=16384){actions=0;visits=0;await pause();live();}}
 const add=n=>{encoded+=n;if(encoded>1046528)fail('OCR_HOST_LIMIT','Host DTO exceeds one MiB minus envelope reserve.');};
 async function str(s){units+=s.length;if(units>199000)fail('OCR_HOST_LIMIT','Host DTO strings exceed their bound.');add(2);for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const low=s.charCodeAt(++i);if(!(low>=0xdc00&&low<=0xdfff))fail('OCR_HOST_INPUT','Unpaired Unicode.');add(4);}else if(c>=0xdc00&&c<=0xdfff)fail('OCR_HOST_INPUT','Unpaired Unicode.');else add(c===34||c===92?2:c<32?([8,9,10,12,13].includes(c)?2:6):c<128?1:c<2048?2:3);if(++visits>=16384){await tick();}}}
 async function visit(v,depth=0){if(depth>8)fail('OCR_HOST_LIMIT','DTO depth.');await tick();if(typeof v==='string')return str(v);if(typeof v==='number'){number(v);add(String(v).length);return;}if(v===null||typeof v==='boolean'){add(v===null?4:v?4:5);return;}if(Array.isArray(v)){dense(v,1000);add(2+Math.max(0,v.length-1));for(const a of v)await visit(a,depth+1);return;}if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail('OCR_HOST_INPUT','Non-data DTO value.');const keys=Object.keys(v);if(keys.length>32)fail('OCR_HOST_LIMIT','DTO keys.');add(2+Math.max(0,keys.length-1));for(const k of keys){await str(k);add(1);await visit(own(v,k),depth+1);}}
 await visit(dto);live();return dto;
}

async function project(result,pageId,w,h){
 const data=own(result,'data'),lines=[],counts={words:0,symbols:0,choices:0};let actions=0,visits=0,blocks=0,paras=0,rawUnits=0;
 async function tick(){if(++visits>100000)fail('OCR_HOST_LIMIT','Raw traversal work.');if(++actions>=128){actions=0;await pause();live();}}
 function literal(v,max){text(v,max);rawUnits+=v.length;if(rawUnits>200000)fail('OCR_HOST_LIMIT','Raw text units.');return v;}
 const dto={pageId,width:w,height:h,text:literal(own(data,'text'),200000),confidence:confidence(own(data,'confidence')),lines,counts};
 for(const block of dense(own(data,'blocks'),256)){if(++blocks>256)fail('OCR_HOST_LIMIT','Block count.');await tick();for(const para of dense(own(block,'paragraphs'),512)){if(++paras>512)fail('OCR_HOST_LIMIT','Paragraph count.');await tick();for(const line of dense(own(para,'lines'),1000)){
  await tick();if(lines.length>=1000||totalLines+lines.length+1>10000)fail('OCR_HOST_LIMIT','Line count.');
  const fonts=[],fontKeys=new Set();
  for(const word of dense(own(line,'words'),10000)){await tick();if(++counts.words>10000)fail('OCR_HOST_LIMIT','Word count.');const font={};for(const k of ['font_name','font_size','pointsize','font_id','language','direction','is_bold','is_italic','is_underlined','is_monospace','is_serif','is_smallcaps']){const d=Object.getOwnPropertyDescriptor(word,k);if(d){if(!Object.hasOwn(d,'value'))fail('OCR_HOST_INPUT','Font accessor.');const v=d.value;if(typeof v==='string')font[k]=literal(v,128);else if(typeof v==='boolean'||v===null)font[k]=v;else font[k]=number(v);}}
   const key=JSON.stringify(font);if(!fontKeys.has(key)){if(fonts.length>=32)fail('OCR_HOST_LIMIT','Distinct line font facts.');fontKeys.add(key);fonts.push(font);}
   const wordChoices=Object.getOwnPropertyDescriptor(word,'choices');if(wordChoices)counts.choices+=dense(own(word,'choices'),20000).length;if(counts.choices>20000)fail('OCR_HOST_LIMIT','Choice count.');
   for(const symbol of dense(own(word,'symbols'),100000)){await tick();if(++counts.symbols>100000)fail('OCR_HOST_LIMIT','Symbol count.');if(Object.hasOwn(symbol,'choices'))counts.choices+=dense(own(symbol,'choices'),20000).length;if(counts.choices>20000)fail('OCR_HOST_LIMIT','Choice count.');}
  }
  const rawBaseline=Object.getOwnPropertyDescriptor(line,'baseline'),rawRow=Object.getOwnPropertyDescriptor(line,'rowAttributes');let rowAttributes=null;
  if(rawRow&&own(line,'rowAttributes')!==null){const r=exact(own(line,'rowAttributes'),['rowHeight','descenders','ascenders']);rowAttributes={rowHeight:number(r.rowHeight),descenders:number(r.descenders),ascenders:number(r.ascenders)};}
  lines.push({rawText:literal(own(line,'text'),4096),confidence:confidence(own(line,'confidence')),bbox:geometry(own(line,'bbox'),w,h,true),baseline:rawBaseline&&own(line,'baseline')!==null?geometry(own(line,'baseline'),w,h,false):null,rowAttributes,fonts});
 }}}
 await admitDto(dto);totalLines+=lines.length;return dto;
}

function stop(){
 if(release)return release;
 closed=true;const cleanup=publicationFailed?[finite(publicationCause)]:[...pauseFailures];
 try{if(jobTimer!==null){apply(timerClear,globalReceiver,[jobTimer]);jobTimer=null;}}catch(e){cleanup.push(finite(e));}
 for(const slot of pauses){try{apply(timerClear,globalReceiver,[slot.handle]);}catch(e){cleanup.push(finite(e));}slot.resolve();}pauses.clear();
 release=(async()=>{
  // A publication can fail synchronously inside the native capture hook before
  // lane.start returns. Own that returned owner before examining/disposal.
  await Promise.resolve();let firstRelease;
  try{firstRelease=owner?owner.dispose():Promise.resolve(null);}catch(e){firstRelease=Promise.reject(e);}firstRelease.catch(()=>{});
  let facts=null;try{facts=await firstRelease;}catch(e){cleanup.push(finite(e));}
  if(first)try{await first;}catch{} // FIRST owned startup/recognition/import/hash drain, never killed SDK job Promise.
  if(model)try{model.fill(0);model=null;}catch(e){cleanup.push(finite(e));}
  const state=lane?.inspect(),released=cleanup.length===0&&(!state||(!state.busy&&!state.fenced));
  fenced=!released;return {released,terminationInvoked:facts?.terminationInvoked===true,physicalExitAcknowledged:false,failures:cleanup.slice(0,8),lane:state??null};
 })();release.catch(()=>{});return release;
}

async function initialize(m){
 exact(m,['type','requestId','language','bootstrap','model']);if(!Object.hasOwn(modelPins,m.language))fail('OCR_HOST_INPUT','Select one pinned language.');
 const urls=exact(m.bootstrap,['main','worker','core','ownership']);for(const v of Object.values(urls))if(!text(v,2048).startsWith('blob:'))fail('OCR_HOST_INPUT','Expected owned Blob URLs.');
 model=bytes(m.model,8388608,modelPins[m.language].bytes);if(model[0]===31&&model[1]===139)fail('OCR_HOST_INPUT','Decoded model required.');if(await digest(model)!==modelPins[m.language].sha256)fail('OCR_HOST_INTEGRITY','Selected model hash mismatch.');live();
 const [engine,ownership]=await Promise.all([import(urls.main),import(urls.ownership)]);live();
 lane=ownership.createOwnedOcrLane({createWorkerWithNativeOwner:(langs,oem,options,config)=>engine.createWorkerWithNativeOwner(langs,oem,{...options,onNativeWorker:native=>{if(!(native instanceof WorkerClass)||native.terminate!==terminateNative)fail('OCR_HOST_NATIVE','Expected direct native Worker.');options.onNativeWorker(native);progress('captured');},logger:()=>{if(currentId)progress('recognizing');}},config)});
 live();owner=lane.start({languages:[{code:m.language,data:model}],oem:1,startupMs:60000,recognitionMs:120000,sdkOptions:{workerPath:urls.worker,workerBlobURL:false,corePath:urls.core+'#tesseract-core-lstm.wasm.js',cacheMethod:'none',gzip:false,legacyCore:false,legacyLang:false}});
 await owner.ready;live();terminal('ready',m.requestId,{});
}

apply(addNative,globalThis,['message',event=>{
 const m=event.data;let id;
 try{id=text(own(m,'requestId'),100);if(!id.length||seen.has(id)||seen.size>=64)fail('OCR_HOST_INPUT','Duplicate or excessive request.');seen.add(id);
  const type=own(m,'type');if(type==='cancel'||type==='dispose'){exact(m,['type','requestId']);void stop().then(facts=>terminal('release',id,{release:facts}),e=>terminal('error',id,{error:finite(e)}));return;}
  if(closed||fenced||first)fail('OCR_HOST_BUSY','Host is busy or closed.');
  if(type==='init'){if(initialized)fail('OCR_HOST_INPUT','Already initialized.');initialized=true;currentId=id;jobTimer=apply(timerSet,globalReceiver,[()=>{void stop();},300000]);first=initialize(m);}
  else if(type==='recognize'){exact(m,['type','requestId','pageId','width','height','png']);if(!owner)fail('OCR_HOST_INPUT','Not ready.');text(m.pageId,100);if(!m.pageId.length||(!pages.has(m.pageId)&&pages.size>=20))fail('OCR_HOST_LIMIT','Page count.');png(m.png,m.width,m.height);totalPixels+=m.width*m.height;if(totalPixels>20000000)fail('OCR_HOST_LIMIT','Selected pixel work.');pages.add(m.pageId);currentId=id;
   first=(async()=>{let image;try{image=new Blob([m.png],{type:'image/png'});live();const result=await owner.recognize(image,{jobId:id});live();const dto=await project(result,m.pageId,m.width,m.height);live();terminal('page',id,{page:dto});}finally{m.png.fill(0);image=null;}})();
  }else fail('OCR_HOST_INPUT','Unknown request.');
  const pending=first;pending.catch(()=>{});void pending.then(()=>{if(first===pending){first=null;currentId=null;}},e=>{if(first===pending){first=null;currentId=null;}terminal('error',id,{error:finite(e)});void stop();});
 }catch(e){if(!invalidReplied){invalidReplied=true;if(id&&seen.has(id)&&!terminals.has(id))terminal('error',id,{error:finite(e)});else post({type:'error',requestId:null,error:finite(e)});}void stop();}
}]);
