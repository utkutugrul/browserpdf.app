import { assertDocumentWorkspaceBudget } from './core/document-draft.js';

const MiB=1024*1024, apply=Reflect.apply, fill=Uint8Array.prototype.fill;
const size=Object.getOwnPropertyDescriptor(Blob.prototype,'size').get;
const mime=Object.getOwnPropertyDescriptor(Blob.prototype,'type').get;
const fileName=Object.getOwnPropertyDescriptor(File.prototype,'name').get;
const read=Blob.prototype.arrayBuffer, abort=AbortSignal.prototype.throwIfAborted;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const signalReason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
const listen=EventTarget.prototype.addEventListener,unlisten=EventTarget.prototype.removeEventListener;
function fail(code,message){const e=new Error(message);e.code=`DOCUMENT_INTAKE_${code}`;throw e;}
function record(value,keys){if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INPUT','Expected plain intake options.');const out={};for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!keys.includes(key)||!d.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Invalid intake option.');out[key]=d.value;}return out;}
function checkSignal(signal){if(signal!==undefined){try{aborted.call(signal);}catch{fail('INPUT','Expected an actual AbortSignal.');}abort.call(signal);}}
const same=(a,b)=>a.taskId===b.taskId&&a.revision===b.revision&&a.generation===b.generation;
function descriptor(file,role){let name,bytes,type;try{name=fileName.call(file);bytes=size.call(file);type=mime.call(file);}catch{fail('INPUT','Choose an actual File.');}
  const kind=role==='image'?'image':/\.docx$/i.test(name)?'docx':'markdown';
  if(role==='image'&&!['image/png','image/jpeg'].includes(type))fail('TYPE','Choose an owned PNG/JPEG image.');
  if(role==='document'&&kind==='markdown'&&!(/\.(md|markdown|txt)$/i.test(name)&&['','text/plain','text/markdown'].includes(type)))fail('TYPE','Choose a .docx, .md, .markdown or .txt file.');
  if(kind==='docx'&&!['','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/zip'].includes(type))fail('TYPE','Choose a .docx file.');
  const maximum=kind==='docx'?32*MiB:kind==='image'?16*MiB:8*MiB;if(bytes>maximum)fail('LIMIT','Selected input exceeds its finite byte limit.');
  if(!Number.isSafeInteger(bytes)||bytes<0||name.length>260)fail('INPUT','Invalid file descriptor.');return {name,type,bytes,kind,role};
}

// One owned File read/parser job and one latest unread descriptor. Cancellation
// invalidates immediately but never releases leases before FIRST jobs settle.
export function createDocumentIntake(settings){
  const cfg=record(settings,['getOwner','getUsage','readCandidate','publishCandidate','onState']);for(const key of ['getOwner','getUsage','readCandidate','publishCandidate'])if(typeof cfg[key]!=='function')fail('INPUT','Trusted intake callbacks are required.');if(cfg.onState!==undefined&&typeof cfg.onState!=='function')fail('INPUT','Invalid state callback.');
  let active=null,pending=null,generation=0,closed=false,cleanupFence=null,disposalPromise=null;
  const notify=value=>cfg.onState?.(value);
  const cleanupError=()=>Object.assign(new Error('Discard cleanup failed. Ownership stays charged until page reset.'),{code:'DOCUMENT_INTAKE_CLEANUP'});
  function cancel(reason=new DOMException('Document intake was cancelled.','AbortError')){generation++;if(pending){pending.resolve({status:'cancelled',reason});pending=null;}active?.controller.abort(reason);}
  async function run(job){
    const controller=job.controller,signal=controller.signal,captured={...cfg.getOwner()},reservations=new Map();let bytes,candidate,cleanup,accepted=false,outcome,firstCleanup;
    const current=()=>!closed&&job.generation===generation&&!aborted.call(signal)&&(!job.options.isCurrent||job.options.isCurrent());
    const assert=()=>{abort.call(signal);if(!current()||!same(captured,cfg.getOwner()))fail('STALE','The input owner or intent changed.');};
    function reservationUsage(){const total={resourceBytes:0,resourceCount:0,artifactBytes:0,expandedBytes:0,expandedCount:0};for(const value of reservations.values())for(const key of Object.keys(total)){total[key]+=value[key]??0;if(!Number.isSafeInteger(total[key]))fail('LIMIT','Reservation arithmetic overflow.');}return total;}
    function reserve(extra){assert();extra=record(extra,['resourceBytes','resourceCount','artifactBytes','expandedBytes','expandedCount']);for(const value of Object.values(extra))if(!Number.isSafeInteger(value)||value<0)fail('INPUT','Reservations require finite nonnegative integers.');const u=cfg.getUsage(),total=reservationUsage();for(const key of Object.keys(total)){total[key]+=extra[key]??0;if(!Number.isSafeInteger(total[key]))fail('LIMIT','Reservation arithmetic overflow.');}const result=assertDocumentWorkspaceBudget(u.snapshot,u.live,total);const key={};reservations.set(key,{...extra});let released=false;return {usage:result,release(){if(!released){released=true;reservations.delete(key);}}};}
    const external=job.options.signal,onAbort=()=>controller.abort(signalReason.call(external));
    try{
      checkSignal(external);if(external)listen.call(external,'abort',onAbort,{once:true});assert();
      reserve({artifactBytes:3*job.fileInfo.bytes});notify({phase:'reading',name:job.fileInfo.name,intent:job.options.intent});assert();
      // Capture/await this exact first promise; no race and no duplicate read.
      const first=read.call(job.file);const buffer=await first;bytes=new Uint8Array(buffer);assert();if(bytes.byteLength!==job.fileInfo.bytes)fail('INPUT','Native file size changed.');
      notify({phase:'parsing',name:job.fileInfo.name,intent:job.options.intent});assert();
      const parsing=cfg.readCandidate(bytes,job.fileInfo,{signal,owner:captured,file:job.file,reserve,reservationUsage});candidate=await parsing;const disposer=candidate&&Object.getOwnPropertyDescriptor(candidate,'dispose');cleanup=disposer&&Object.hasOwn(disposer,'value')?disposer.value:undefined;assert();if(typeof cleanup!=='function')fail('INPUT','The parser must return an owned candidate disposer.');
      notify({phase:'committing',name:job.fileInfo.name,intent:job.options.intent});assert();
      const publishing=cfg.publishCandidate(candidate,{signal,owner:captured,file:job.file,descriptor:job.fileInfo,reserve,reservationUsage,isCurrent:current,assertCurrent:assert});const next=await publishing;
      if(!current()||!next?.owner||!same(next.owner,cfg.getOwner()))fail('STALE','The published candidate did not return its exact current owner.');accepted=true;
      outcome={status:'accepted',owner:{...next.owner}};
    }catch(error){outcome=aborted.call(signal)||!current()?{status:'cancelled',reason:aborted.call(signal)?signalReason.call(signal):error}:{status:'rejected',error};}
    finally{
      if(external)unlisten.call(external,'abort',onAbort);
      if(!accepted&&typeof cleanup==='function'){
        try{firstCleanup=Promise.resolve(apply(cleanup,candidate,[]));await firstCleanup;}
        catch(cause){cleanupFence={cause,candidate,bytes,reservations,firstCleanup};outcome={status:'rejected',error:cleanupError()};}
      }
      if(!cleanupFence){if(bytes)fill.call(bytes,0);reservations.clear();}
    }
    // Settlement and successors follow FIRST cleanup, including an actual async disposer.
    if(!accepted&&!cleanupFence&&(aborted.call(signal)||!current()))outcome={status:'cancelled',reason:aborted.call(signal)?signalReason.call(signal):outcome?.error};
    job.resolve(outcome);notify({phase:outcome.status,intent:job.options.intent,name:job.fileInfo.name});
  }

  function kick(){if(cleanupFence&&pending){pending.resolve({status:'rejected',error:cleanupError()});pending=null;}if(active||!pending||closed||cleanupFence)return;const job=pending;pending=null;active=job;job.promise=run(job).finally(()=>{if(active===job)active=null;kick();});job.promise.catch(()=>{});}
  return {
    select(file,raw={}){
      if(cleanupFence)return Promise.resolve({status:'rejected',error:cleanupError()});
      if(closed)return Promise.resolve({status:'rejected',error:Object.assign(new Error('Intake is closed.'),{code:'DOCUMENT_INTAKE_CLOSED'})});
      cancel(new DOMException('A newer file choice replaced this input.','AbortError'));
      let opts,info;try{opts=record(raw,['role','intent','isCurrent','signal']);opts.role??='document';if(!['document','image'].includes(opts.role)||!Number.isSafeInteger(opts.intent)||opts.intent<0||opts.isCurrent!==undefined&&typeof opts.isCurrent!=='function')fail('INPUT','Invalid intake role/intent guard.');checkSignal(opts.signal);info=descriptor(file,opts.role);}catch(error){return Promise.resolve({status:'rejected',error});}
      return new Promise(resolve=>{pending={file,fileInfo:info,options:opts,generation,controller:new AbortController(),resolve,promise:null};kick();});
    },
    cancel,
    drain(){const first=active?.promise;return (first??Promise.resolve()).then(()=>{if(cleanupFence)throw cleanupError();});},
    dispose(){if(disposalPromise)return disposalPromise;closed=true;cancel();const first=active?.promise;disposalPromise=(first??Promise.resolve()).then(()=>{if(cleanupFence)throw cleanupError();});disposalPromise.catch(()=>{});return disposalPromise;},
    snapshot(){return {phase:cleanupFence?'cleanup-blocked':closed?'disposed':active?'busy':'idle',active:!!active,pending:!!pending,generation,cleanupBlocked:!!cleanupFence};}
  };
}
