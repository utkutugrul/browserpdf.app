// Unreachable transactional OCR A intake. No route or engine activation.
import { createOcrSource } from './ocr-source.js';
import { assertDocumentWorkspaceBudget } from './core/document-draft.js';
const apply=Reflect.apply,MAX=12*1048576,read=Blob.prototype.arrayBuffer;
const fileName=Object.getOwnPropertyDescriptor(File.prototype,'name').get,size=Object.getOwnPropertyDescriptor(Blob.prototype,'size').get;
const A=AbortSignal.prototype,aborted=Object.getOwnPropertyDescriptor(A,'aborted').get,reason=Object.getOwnPropertyDescriptor(A,'reason').get;
const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener,abort=AbortController.prototype.abort;
const typed=Object.getPrototypeOf(Uint8Array.prototype),tag=Object.getOwnPropertyDescriptor(typed,Symbol.toStringTag).get,length=Object.getOwnPropertyDescriptor(typed,'byteLength').get,offset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,buffer=Object.getOwnPropertyDescriptor(typed,'buffer').get;
const bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get,fill=Uint8Array.prototype.fill,set=Uint8Array.prototype.set;
const zero=()=>({artifactBytes:0,resourceBytes:0,resourceCount:0});
function problem(code,cause){const e=new Error('OCR intake '+code.toLowerCase().replaceAll('_',' ')+'.');e.code='OCR_INTAKE_'+code;Object.defineProperty(e,'cause',{value:cause});return e;}
function fail(code){throw problem(code,undefined);}
function own(v,k){const d=v&&Object.getOwnPropertyDescriptor(v,k);if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('INPUT');return d.value;}
function fields(v,keys){if(!v||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('INPUT');const out={};for(const k of Reflect.ownKeys(v)){if(typeof k!=='string'||!keys.includes(k))fail('INPUT');out[k]=own(v,k);}return out;}
function owner(v){const t={taskId:own(v,'taskId'),revision:own(v,'revision'),generation:own(v,'generation')};if(t.taskId!==null&&(typeof t.taskId!=='string'||!t.taskId.length||t.taskId.length>100)||!Number.isSafeInteger(t.revision)||t.revision<0||!Number.isSafeInteger(t.generation)||t.generation<0)fail('OWNER');return t;}
const same=(a,b)=>a.taskId===b.taskId&&a.revision===b.revision&&a.generation===b.generation;
function cancelled(value){if(genuineAbort(value))return value;const e=problem('ABORT',value);e.name='AbortError';e.code='OCR_ABORT';return e;}
function codeOf(e){const d=e&&typeof e==='object'?Object.getOwnPropertyDescriptor(e,'code'):null;return typeof d?.value==='string'?d.value:null;}
const exceptionName=Object.getOwnPropertyDescriptor(DOMException.prototype,'name').get;
function genuineAbort(e){try{return apply(exceptionName,e,[])==='AbortError';}catch{return false;}}
function finite(e){const d=e&&typeof e==='object'?Object.getOwnPropertyDescriptor(e,'message'):null;return {code:(codeOf(e)??'OCR_INTAKE_NATIVE').slice(0,64),message:typeof d?.value==='string'?d.value.slice(0,512):'OCR intake failed.'};}
function combine(...values){const out=zero();for(const v of values)for(const k of Object.keys(out)){const n=v?.[k]??0;if(!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(out[k]+n))fail('LIMIT');out[k]+=n;}return out;}
function inherited(input){
 // Descriptor-only bounded scan: no byte allocation and no producer callbacks.
 const objects=new Map(),backings=new Map(),views=new Map(),staged=new Map();let nodes=0,data=null;
 function scan(v,depth=0){if(++nodes>262144||depth>32)fail('INHERITED_LIMIT');if(v===null||['undefined','string','boolean','number'].includes(typeof v))return v;if(typeof v!=='object')fail('INHERITED');if(objects.has(v))return objects.get(v);
  let isBytes=false;try{isBytes=apply(tag,v,[])==='Uint8Array';}catch{}
  if(isBytes){const b=apply(buffer,v,[]),n=apply(length,v,[]);if(!n||apply(offset,v,[])!==0||apply(bufferLength,b,[])!==n||resizable&&apply(resizable,b,[]))fail('INHERITED');const view=new Uint8Array(b,0,n);objects.set(v,view);backings.set(b,n);views.set(view,b);return view;}
  const array=Array.isArray(v);if(!array&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('INHERITED');if(array&&v.length>10000)fail('INHERITED_LIMIT');const out=array?[]:Object.create(null);objects.set(v,out);
  for(const k of Reflect.ownKeys(v)){if(array&&k==='length')continue;if(typeof k!=='string'||array&&!/^(0|[1-9]\d*)$/.test(k))fail('INHERITED');Object.defineProperty(out,k,{value:scan(own(v,k),depth+1),enumerable:true});}
  if(array&&(Reflect.ownKeys(out).length!==v.length+1||out.length!==v.length))fail('INHERITED');return Object.freeze(out);
 }
 const descriptor=scan(input),resources=new Set(),resourceViews=new Set(),beginViews=new Set();let resourceBytes=0;
 const requireView=v=>{if(!views.has(v))fail('INHERITED');return v;};
 if(descriptor.resources!==undefined){if(!Array.isArray(descriptor.resources)||descriptor.resources.length>128)fail('INHERITED');for(const r of descriptor.resources){const v=requireView(r?.bytes);resources.add(views.get(v));resourceViews.add(v);beginViews.add(v);resourceBytes+=apply(length,v,[]);}}
 if(descriptor.original)beginViews.add(requireView(descriptor.original.bytes));
 for(const key of ['history','future'])if(Array.isArray(descriptor[key]))for(const a of descriptor[key].slice(-5))if(!a?.scene)beginViews.add(requireView(a?.bytes));
 const retained=zero(),future=zero();for(const [b,n]of backings){if(resources.has(b))retained.resourceBytes+=2*n;else retained.artifactBytes+=2*n;}
 // Canonical begin deduplicates artifact copies by input view identity, aliases
 // scene checkpoints to staged resources, but counts every resource row.
 future.resourceBytes=resourceBytes;for(const v of beginViews)if(!resourceViews.has(v))future.artifactBytes+=apply(length,v,[]);
 retained.resourceCount=(descriptor.resources?.length??0)+resources.size;future.resourceCount=descriptor.resources?.length??0;
 function check(){for(const [b,n]of backings)if(apply(bufferLength,b,[])!==n||resizable&&apply(resizable,b,[]))fail('INHERITED');}
 return {usage:combine(retained,future),retained,data:null,
  stage(){check();for(const [b,n]of backings){const bytes=new Uint8Array(n);staged.set(b,bytes);apply(set,bytes,[new Uint8Array(b,0,n)]);}const copied=new Map();
   function materialize(v){if(v===null||typeof v!=='object')return v;if(copied.has(v))return copied.get(v);if(views.has(v)){const b=staged.get(views.get(v)),out=new Uint8Array(apply(buffer,b,[]));copied.set(v,out);return out;}const out=Array.isArray(v)?[]:Object.create(null);copied.set(v,out);for(const k of Reflect.ownKeys(v)){if(k==='length'&&Array.isArray(v))continue;Object.defineProperty(out,k,{value:materialize(own(v,k)),enumerable:true});}return Object.freeze(out);}
   data=materialize(descriptor);this.data=data;
  },
  clear(){for(const v of staged.values())apply(fill,v,[0]);staged.clear();data=null;this.data=null;}
 };
}

export function createOcrIntake(raw){
 const cfg=fields(raw,['session','ensureSession','pdfjs','pdfjsAssets','getExternalUsage']),session=cfg.session,snapshot=session?.snapshot,begin=session?.begin;
 if(typeof snapshot!=='function'||typeof begin!=='function'||typeof cfg.ensureSession!=='function'||typeof cfg.pdfjs?.getDocument!=='function'||cfg.getExternalUsage!==undefined&&typeof cfg.getExternalUsage!=='function')fail('DEPENDENCY');
 let active=null,pending=null,generation=0,closed=false,fence=null,disposal=null,current=null,metadata=null,phase='idle',lastError=null;
 const sources=new Set(),retainedJobs=new Set(),leases=new Map();
 const snap=()=>apply(snapshot,session,[]),actualOwner=()=>owner(snap());
 const usage=(exclude=null)=>combine(...leases.values(),...[...sources].filter(s=>s!==exclude).map(s=>s.view().usage));
 function external(exclude){return combine(cfg.getExternalUsage?.()??zero(),usage(exclude));}
 function cleanup(cause){const e=problem('CLEANUP',cause);fence??=e;phase='fenced';lastError=finite(fence);return fence;}
 function guard(job){
  const outside=cfg.getExternalUsage?.()??zero();const valid=job.options.isCurrent?job.options.isCurrent():true;const state=snap();assertDocumentWorkspaceBudget(state,outside,usage());
  if(!same(owner(state),job.owner)||!valid)fail('STALE');if(job.options.signal!==undefined&&apply(aborted,job.options.signal,[]))throw cancelled(apply(reason,job.options.signal,[]));if(apply(aborted,job.controller.signal,[]))throw cancelled(apply(reason,job.controller.signal,[]));if(closed||job.generation!==generation)throw cancelled(job.cancelCause);if(fence)throw fence;
 }
 function reserve(job,key,u){leases.set(key,u);guard(job);}
 async function disposeSource(source){try{await source.dispose();sources.delete(source);}catch(e){throw cleanup(e);}}
 function abortJob(job,cause){if(!job)return;job.cancelCause=cause;apply(abort,job.controller,[cause]);if(job.source)void job.source.cancel(cause).catch(()=>{});}
 function rejectPending(cause){if(pending){const job=pending;pending=null;try{job.inherited?.clear();}catch(e){cleanup(e);}if(!fence){leases.delete(job.fileKey);leases.delete(job.inheritKey);retainedJobs.delete(job);job.inherited=null;job.file=null;}job.reject(fence??cancelled(cause));}}
 async function execute(job){
  let inputBytes=null,candidate=null,committed=false,result,failure,failurePresent=false,linked=false;const {fileKey,inheritKey}=job;const commitKey={};
  try{
   if(job.admissionFailed)throw job.admissionError;if(job.options.isCurrent!==undefined&&typeof job.options.isCurrent!=='function')fail('INPUT');const sig=job.options.signal;if(sig!==undefined)try{apply(aborted,sig,[]);}catch{fail('SIGNAL');}
   job.onAbort=()=>{if(apply(aborted,sig,[]))abortJob(job,apply(reason,sig,[]));};if(sig){linked=true;apply(add,sig,['abort',job.onAbort,{once:true}]);if(apply(aborted,sig,[]))job.onAbort();}
   phase='reading';guard(job);
   const first=apply(read,job.file,[]),array=await first;inputBytes=new Uint8Array(array);job.bytes=inputBytes;guard(job);if(inputBytes.byteLength!==job.size||[37,80,68,70,45].some((n,i)=>inputBytes[i]!==n))fail('PDF');
   const captured=job.inherited;
   guard(job);await cfg.ensureSession();guard(job);phase='preparing';
   candidate=createOcrSource({pdfjs:cfg.pdfjs,pdfjsAssets:cfg.pdfjsAssets,session,getExternalUsage:()=>external(candidate)},{bytes:inputBytes,name:job.name,owner:job.owner});job.source=candidate;sources.add(candidate);
   // Transfer read backing to source, retaining the declared File charge.
   leases.set(fileKey,{artifactBytes:job.size});inputBytes=null;job.bytes=null;
   const prepared=await candidate.prepare({signal:job.controller.signal,isCurrent:()=>!closed&&job.generation===generation&&(!job.options.isCurrent||job.options.isCurrent())});guard(job);
   if(current){await current.cancel();guard(job);}
   reserve(job,commitKey,{artifactBytes:job.size});guard(job);
   const returned=apply(begin,session,[array,job.name,{...captured.data,type:'application/pdf'}]);
   // begin is synchronous and is the sole canonical admission point.
   const next=owner(returned),old=current;current=candidate;metadata=prepared;committed=true;candidate.acceptOwner(job.owner,next);job.owner=next;leases.delete(commitKey);leases.set(inheritKey,captured.retained);
   if(old)await disposeSource(old);
   result={status:'ready',source:candidate,metadata:{...prepared},owner:{...next}};
   if(apply(aborted,job.controller.signal,[]))throw cancelled(apply(reason,job.controller.signal,[]));
  }catch(e){failurePresent=true;failure=e;lastError=finite(e);if(codeOf(e)==='OCR_SOURCE_CLEANUP')cleanup(e);}
  finally{
   if(linked)try{apply(remove,job.options.signal,['abort',job.onAbort]);}catch(e){cleanup(e);}
   if(candidate&&!committed)try{await disposeSource(candidate);}catch{}
   if(inputBytes)try{apply(fill,inputBytes,[0]);}catch(e){cleanup(e);}
   if(!fence)try{job.inherited?.clear();}catch(e){cleanup(e);}
   if(!fence){job.file=null;job.bytes=null;job.inherited=null;retainedJobs.delete(job);leases.delete(fileKey);leases.delete(inheritKey);leases.delete(commitKey);}
  }
  if(fence)throw fence;
  if(failurePresent){const code=codeOf(failure);if(genuineAbort(failure)||code&&/^(OCR_(SOURCE_|INTAKE_|ABORT$)|DOCUMENT_DRAFT_)/.test(code))throw failure;throw problem('NATIVE',failure);}return result;
 }
 function pump(){if((closed||fence)&&pending){const job=pending;pending=null;job.reject(fence??problem('CLOSED',undefined));}if(active||!pending||closed||fence)return;const job=pending;pending=null;active=job;retainedJobs.add(job);
  // FIRST before any callbacks, getters, read or ensureSession.
  job.work=Promise.resolve().then(()=>execute(job));job.work.catch(()=>{});const finish=(settle,value)=>{if(active===job)active=null;phase=fence?'fenced':closed?'disposed':current?'ready':'idle';settle(value);pump();};job.work.then(value=>finish(job.resolve,value),cause=>finish(job.reject,cause));
 }
 const api={
  select(file,options){if(closed||fence)return Promise.reject(fence??problem('CLOSED',undefined));generation++;rejectPending(undefined);abortJob(active,new DOMException('A newer selection replaced this input.','AbortError'));
   let name,n;try{name=apply(fileName,file,[]);n=apply(size,file,[]);if(!n||n>MAX||name.length>260||!(/\.pdf$/i.test(name)))fail('FILE');}catch(e){return Promise.reject(codeOf(e)?e:problem('FILE',e));}
   let job;const result=new Promise((resolve,reject)=>{job={file,name,size:n,generation,controller:new AbortController(),owner:null,options:null,source:null,resolve,reject,work:null,cancelCause:undefined};pending=job;retainedJobs.add(job);pump();});try{
    job.options=Object.freeze(fields(options??{},['signal','isCurrent']));if(job.options.isCurrent!==undefined&&typeof job.options.isCurrent!=='function')fail('INPUT');if(job.options.signal!==undefined)try{apply(aborted,job.options.signal,[]);}catch{fail('SIGNAL');}
    job.owner=actualOwner();job.fileKey={};job.inheritKey={};const descriptor=Object.getOwnPropertyDescriptor(file,'browserpdfSession');if(descriptor&&!Object.hasOwn(descriptor,'value'))fail('INHERITED');job.inherited=inherited(descriptor?.value??{});
    // Admit all existing, staged and canonical copies before byte allocation.
    leases.set(job.fileKey,{artifactBytes:2*n});reserve(job,job.inheritKey,job.inherited.usage);job.inherited.stage();guard(job);
   }catch(e){job.admissionFailed=true;job.admissionError=e;}return result;
  },
  current:()=>current,
  view(){return {phase,pending:!!(active||pending),owner:actualOwner(),metadata:metadata?{...metadata}:null,usage:usage(),cleanupBlocked:!!fence,lastError:lastError?{...lastError}:null};},
  cancel(cause){generation++;rejectPending(cause);abortJob(active,cause);const first=active?.work,source=active?.source??current,closing=source?.cancel(cause);closing?.catch(()=>{});return (async()=>{if(first)try{await first;}catch{}if(closing)try{await closing;}catch(e){throw cleanup(e);}if(fence)throw fence;})();},
  drained(){const first=active?.work;return (async()=>{if(first)try{await first;}catch{}if(fence)throw fence;})();},
  dispose(){if(disposal)return disposal;closed=true;disposal=(async()=>{try{await api.cancel(undefined);}catch{}for(const s of [...sources])try{await disposeSource(s);}catch{}if(fence)throw fence;leases.clear();phase='disposed';})();disposal.catch(()=>{});return disposal;}
 };
 return Object.freeze(api);
}
