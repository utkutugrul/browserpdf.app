import {assertDocumentWorkspaceBudget} from './core/document-draft.js';

const MiB=1024*1024, abort=AbortSignal.prototype.throwIfAborted;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get, reasonOf=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
const listen=EventTarget.prototype.addEventListener,unlisten=EventTarget.prototype.removeEventListener;
const nameOf=typeof File==='function'?Object.getOwnPropertyDescriptor(File.prototype,'name').get:null;
const sizeOf=Object.getOwnPropertyDescriptor(Blob.prototype,'size').get,typeOf=Object.getOwnPropertyDescriptor(Blob.prototype,'type').get,read=Blob.prototype.arrayBuffer;
const lengthOf=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,fill=Uint8Array.prototype.fill;
const keys=['resourceBytes','resourceCount','artifactBytes','expandedBytes','expandedCount'];
function fail(code,message){const error=new Error(message);error.code='SPREADSHEET_INTAKE_'+code;throw error;}
function record(value,allowed){if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INPUT','Expected plain own intake data.');const out={};for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!allowed.includes(key)||!d.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Unexpected intake property.');out[key]=d.value;}return out;}
function count(n){if(!Number.isSafeInteger(n)||n<0)fail('INPUT','Expected a finite nonnegative count.');return n;}
function usage(raw={}){const v=record(raw,keys),u={};for(const k of keys)u[k]=count(v[k]??0);return u;}
function sum(...values){const result=usage();for(const value of values){const u=usage(value);for(const k of keys)result[k]=count(result[k]+u[k]);}return result;}
function owner(raw){const r=record(raw,['taskId','revision','generation']);if(r.taskId!==null&&typeof r.taskId!=='string')fail('INPUT','Invalid owner task identity.');return Object.freeze({taskId:r.taskId,revision:count(r.revision),generation:count(r.generation)});}
const same=(a,b)=>a.taskId===b.taskId&&a.revision===b.revision&&a.generation===b.generation;
// Project only required own scalars while returning the actual full snapshot.
// Additional public session metadata stays intact and is never dereferenced.
function canonicalSnapshot(value){
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INPUT','Expected an actual plain canonical snapshot.');
  const all=Reflect.ownKeys(value);if(all.length>64)fail('INPUT','Canonical metadata exceeds its finite key bound.');
  for(const key of all){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!d?.enumerable||!Object.hasOwn(d,'value'))fail('INPUT','Canonical snapshot requires own data properties.');}
  const scalars={};for(const key of ['taskId','revision','generation','retainedBytes','resourceBytes','resourceCount']){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Missing canonical scalar.');scalars[key]=d.value;}
  const identity=owner({taskId:scalars.taskId,revision:scalars.revision,generation:scalars.generation});for(const key of ['retainedBytes','resourceBytes','resourceCount'])count(scalars[key]);return {snapshot:value,identity};
}

function signal(value){if(value!==undefined){try{aborted.call(value);}catch{fail('INPUT','Expected a genuine AbortSignal.');}abort.call(value);}}
function descriptor(file,opts){let name,bytes,type;try{name=nameOf.call(file);bytes=sizeOf.call(file);type=typeOf.call(file);}catch{fail('INPUT','Choose an actual File.');}if(name.length>260||count(bytes)>8*MiB)fail('LIMIT','Choose a file up to 8 MiB.');const kind=/\.xlsx$/iu.test(name)?'xlsx':/\.(?:csv|tsv)$/iu.test(name)?'csv':null;if(!kind)fail('TYPE','Choose XLSX, CSV or TSV; legacy XLS is unsupported.');if(kind==='xlsx'&&!['','application/zip','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(type))fail('TYPE','XLSX MIME and name disagree.');if(kind==='csv'&&!['','text/plain','text/csv','text/tab-separated-values','application/csv','application/vnd.ms-excel'].includes(type))fail('TYPE','CSV MIME and name disagree.');if(kind==='csv'&&!['\t',',',';','|'].includes(opts.delimiter))fail('INPUT','Choose an explicit CSV delimiter.');if(kind==='xlsx'&&opts.delimiter!==undefined)fail('INPUT','XLSX has no CSV delimiter.');return Object.freeze({name,bytes,type,kind,...(opts.delimiter===undefined?{}:{delimiter:opts.delimiter})});}
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}

// No DOM, File chooser, SDK acquisition, publication policy or separate pool.
// The FIRST lane promise is installed before any producer/observer callback.
export function createSpreadsheetIntake(settings){
  const cfg=record(settings,['getOwner','getUsage','readCandidate','publishCandidate','onState']);for(const k of ['getOwner','getUsage','readCandidate','publishCandidate'])if(typeof cfg[k]!=='function')fail('INPUT','Trusted intake callbacks are required.');if(cfg.onState!==undefined&&typeof cfg.onState!=='function')fail('INPUT','Invalid state callback.');
  let active=null,pending=null,generation=0,closed=false,fence=null,disposal;
  const cleanupError=()=>{if(!fence.error)fence.error=fence.cause?.code==='SPREADSHEET_DOCUMENT_CLEANUP'?fence.cause:Object.assign(new Error('Owned cleanup failed. Keep this candidate charged and reload before more work.'),{code:'SPREADSHEET_INTAKE_CLEANUP',cause:fence.cause});return fence.error;};
  function cancel(reason=new DOMException('Spreadsheet intake was cancelled.','AbortError')){generation++;if(pending){pending.result.resolve({status:'cancelled',reason});pending=null;}active?.controller.abort(reason);}
  function snapshot(){let u=active?active.total():usage();if(!active&&fence?.reservations)for(const value of fence.reservations.values())u=sum(u,value);if(!active&&fence?.job)u=fence.job.total();return Object.freeze({phase:fence?'cleanup-blocked':closed?'disposed':active?'busy':'idle',active:!!active,pending:!!pending,generation,cleanupBlocked:!!fence,usage:Object.freeze(u)});}
  async function run(job){
    const ownSignal=job.controller.signal,external=job.options.signal,reservations=new Map(),readerKey={},rawKey={};let bytes,candidate,disposeCandidate,firstCleanup,captured,accepted=false,outcome,finished=false;
    job.total=()=>{let total=usage();for(const v of reservations.values())total=sum(total,v);return total;};
    const local=()=>{abort.call(ownSignal);if(closed||job.generation!==generation)fail('STALE','The actual intake intent changed.');if(fence)throw cleanupError();};
    // All caller callbacks precede the final canonical owner snapshot and the
    // callback-free signal/intent/closing check immediately before a mutation.
    function current(){local();const valid=job.options.isCurrent?job.options.isCurrent():true;local();const actual=owner(cfg.getOwner());local();if(!valid||captured&&!same(captured,actual))fail('STALE','The canonical owner changed.');return actual;}
    function externalUsage(exclude){local();const raw=record(cfg.getUsage(),['snapshot','live']);const canonical=canonicalSnapshot(raw.snapshot);const live=usage(raw.live);let own=usage();for(const [key,value]of reservations)if(key!==exclude)own=sum(own,value);const actual=current();if(!same(canonical.identity,actual))fail('STALE','Usage snapshot and actual canonical owner disagree.');return {snapshot:canonical.snapshot,live:sum(live,own)};}
    function replace(key,value){const next=usage(value),u=externalUsage(key);assertDocumentWorkspaceBudget(u.snapshot,u.live,next);current();reservations.set(key,next);return next;}
    function reserve(value){const key={};replace(key,value);let released=false;return Object.freeze({release(){if(!released){released=true;reservations.delete(key);}}});}
    const notify=phase=>{cfg.onState?.(Object.freeze({phase,name:job.descriptor.name,intent:job.options.intent}));current();};
    const forward=()=>job.controller.abort(reasonOf.call(external));
    function cleanup(){if(!firstCleanup){firstCleanup=Promise.resolve().then(()=>Reflect.apply(disposeCandidate,candidate,[]));firstCleanup.catch(()=>{});}return firstCleanup;}
    try{
      signal(external);if(external)listen.call(external,'abort',forward,{once:true});captured=current();
      replace(rawKey,{artifactBytes:3*job.descriptor.bytes,resourceCount:1});notify('reading');current();
      const firstRead=read.call(job.file);const buffer=await firstRead;const size=lengthOf.call(buffer);bytes=new Uint8Array(buffer);current();if(size!==job.descriptor.bytes)fail('INPUT','Native read size changed.');
      notify('parsing');current();const context=Object.freeze({signal:ownSignal,owner:captured,descriptor:job.descriptor,reserve,reservationUsage:()=>job.total(),getUsage:()=>externalUsage(readerKey),onUsage:value=>{const next=usage(value);if(finished||keys.every(k=>next[k]===0))return;return replace(readerKey,next);},isCurrent:()=>{try{current();return true;}catch(error){if(aborted.call(ownSignal))throw reasonOf.call(ownSignal);return false;}},assertCurrent:current});
      const firstParser=Promise.resolve().then(()=>{current();return cfg.readCandidate(bytes,job.descriptor,context);});candidate=await firstParser;
      // Capture the actual own disposer before any stale callback can throw.
      const disposer=candidate&&Object.getOwnPropertyDescriptor(candidate,'dispose');disposeCandidate=disposer&&Object.hasOwn(disposer,'value')?disposer.value:undefined;
      if(typeof disposeCandidate!=='function')fail('INPUT','Reader must return an owned candidate disposer.');current();if(!reservations.has(readerKey))fail('INPUT','Reader must expose pending usage before constructing its candidate.');
      const advertised=Object.getOwnPropertyDescriptor(candidate,'usage');if(!advertised||!Object.hasOwn(advertised,'value'))fail('INPUT','Reader candidate requires own usage.');const ownUsage={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(advertised.value,k);if(d&&!Object.hasOwn(d,'value'))fail('INPUT','Candidate usage accessors are unsupported.');ownUsage[k]=d?.value??0;}const actual=usage(ownUsage),leased=reservations.get(readerKey);if(keys.some(k=>actual[k]!==leased[k]))fail('INPUT','Reader candidate and live lease disagree.');
      notify('committing');current();const publication=Object.freeze({...context,isCurrent:()=>{try{current();return true;}catch{return false;}}});
      const firstPublish=Promise.resolve().then(()=>{current();return cfg.publishCandidate(candidate,publication);});const next=await firstPublish;
      const nextRecord=record(next,['owner']),returned=owner(nextRecord.owner);const valid=job.options.isCurrent?job.options.isCurrent():true;local();const actualOwner=owner(cfg.getOwner());local();if(!valid||!same(returned,actualOwner))fail('STALE','Publication did not return its actual canonical owner.');
      accepted=true;outcome={status:'accepted',owner:returned};
    }catch(error){outcome=aborted.call(ownSignal)?{status:'cancelled',reason:reasonOf.call(ownSignal)}:{status:'rejected',error};if(error?.code==='SPREADSHEET_DOCUMENT_CLEANUP')fence={cause:error,candidate,bytes,reservations,firstCleanup};}
    finally{
      if(external)unlisten.call(external,'abort',forward);
      if(!accepted&&typeof disposeCandidate==='function')try{await cleanup();}catch(cause){fence={cause,candidate,bytes,reservations,firstCleanup};outcome={status:'rejected',error:cleanupError()};}
      if(!fence){if(bytes)fill.call(bytes,0);reservations.clear();}
    }
    if(fence)outcome={status:'rejected',error:cleanupError()};else if(!accepted&&aborted.call(ownSignal))outcome={status:'cancelled',reason:reasonOf.call(ownSignal)};
    // A final observer cannot strand FIRST settlement or hide cleanup ownership.
    finished=true;if(!accepted)try{cfg.onState?.(Object.freeze({phase:outcome.status,name:job.descriptor.name,intent:job.options.intent}));}catch{}
    return outcome;
  }
  function kick(){if(fence&&pending){pending.result.resolve({status:'rejected',error:cleanupError()});pending=null;}if(active||!pending||closed||fence)return;const job=pending;pending=null;active=job;const first=deferred();job.first=first.promise;job.total=()=>usage();Promise.resolve().then(()=>run(job)).then(outcome=>{if(active===job)active=null;job.result.resolve(outcome);first.resolve();kick();},error=>{if(active===job)active=null;fence={cause:error,job};job.result.resolve({status:'rejected',error:cleanupError()});first.resolve();kick();});}
  async function drain(){while(active){const first=active.first;await first;if(fence)throw cleanupError();}if(fence)throw cleanupError();}
  return Object.freeze({select(file,raw={}){if(closed||fence)return Promise.resolve({status:'rejected',error:fence?cleanupError():Object.assign(new Error('Spreadsheet intake is closed.'),{code:'SPREADSHEET_INTAKE_CLOSED'})});let options,info;try{options=record(raw,['intent','signal','isCurrent','delimiter']);count(options.intent);signal(options.signal);if(options.isCurrent!==undefined&&typeof options.isCurrent!=='function')fail('INPUT','Invalid intent callback.');info=descriptor(file,options);options=Object.freeze(options);}catch(error){return Promise.resolve({status:'rejected',error});}const replacement=new DOMException('A newer file choice replaced this input.','AbortError'),result=deferred(),previous=pending;generation++;pending={file,descriptor:info,options,generation,controller:new AbortController(),result};if(previous)previous.result.resolve({status:'cancelled',reason:replacement});active?.controller.abort(replacement);kick();return result.promise;},cancel,drain,dispose(){if(!disposal){const first=deferred();disposal=first.promise;disposal.catch(()=>{});closed=true;cancel();Promise.resolve().then(drain).then(first.resolve,first.reject);}return disposal;},snapshot});
}
