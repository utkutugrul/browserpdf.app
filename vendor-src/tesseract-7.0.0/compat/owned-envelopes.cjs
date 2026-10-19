'use strict';
// First-party ownership prototype. SDK recognition uses only the public facade.
const ERROR_UNITS=512;
const applyNative=Reflect.apply;
const timerGlobal=globalThis;
const globalSetTimeout=timerGlobal.setTimeout;
const globalClearTimeout=timerGlobal.clearTimeout;
const nativeAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const nativeAddListener=EventTarget.prototype.addEventListener;
const nativeRemoveListener=EventTarget.prototype.removeEventListener;
function signalAborted(signal) {
 if(signal===undefined)return false;
 try{return applyNative(nativeAborted,signal,[]);}catch{throw finiteError('A genuine AbortSignal is required.','invalid-signal');}
}
function validateSignal(signal){signalAborted(signal);return signal;}
function finiteError(reason,code='ocr-failed') {
 let descriptor=null;try{if(reason&&typeof reason==='object')descriptor=Object.getOwnPropertyDescriptor(reason,'message');}catch{}
 const text=typeof reason==='string'?reason:typeof descriptor?.value==='string'?descriptor.value:'OCR engine operation failed.';
 const error=new Error(text.slice(0,ERROR_UNITS));error.name=code==='aborted'?'AbortError':'OcrOperationError';error.code=code;return error;
}
function deferred() {let resolve,reject,state='pending',settles=0;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,get state(){return state;},get settles(){return settles;},resolve(value){if(state!=='pending')return false;state='resolved';settles++;resolve(value);return true;},reject(error){if(state!=='pending')return false;state='rejected';settles++;reject(error);return true;}};}
function createOwnedOcrLane({createWorkerWithNativeOwner,timers}={}) {
 if(typeof createWorkerWithNativeOwner!=='function')throw new TypeError('A reviewed native-owner factory is required.');
 // Default browser timers require the captured global receiver. Injected methods
 // retain their injected object receiver and are captured once, before ownership.
 // Injected registration must throw without scheduling or return a clearable
 // handle, and callbacks must be asynchronous, as with standard global timers.
 const timerReceiver=timers===undefined?timerGlobal:timers;
 let setTimer,unsetTimer;
 try{setTimer=timers===undefined?globalSetTimeout:timers?.setTimeout;unsetTimer=timers===undefined?globalClearTimeout:timers?.clearTimeout;}catch(error){throw finiteError(error,'invalid-timers');}
 if(typeof setTimer!=='function'||typeof unsetTimer!=='function')throw finiteError('Watchdog timer methods are required.','invalid-timers');
 let active=null,fenced=false,starts=0;
 function start({languages='eng',oem=1,sdkOptions={},config={},signal,startupMs=60000,recognitionMs=120000}={}) {
  if(fenced)throw finiteError('OCR cleanup failed; this lane is fenced.','cleanup-failed');
  if(active)throw finiteError('OCR already owns the lane.','busy');
  if(!Number.isSafeInteger(startupMs)||startupMs<1||startupMs>60000||!Number.isSafeInteger(recognitionMs)||recognitionMs<1||recognitionMs>120000)throw new RangeError('Invalid OCR watchdog bound.');
  signal=validateSignal(signal); // Brand before reservation, listeners, timers or spawn. No duck properties are read.
  const ready=deferred();let sdk=null,native=null,nativeTerminate=null,nativeAdd=null,nativeRemove=null,recognition=null,closed=false,release=null,status='starting',generation=++starts,terminationCalls=0,releaseReport=null,signalAttached=false,nativeErrorAttached=false,messageErrorAttached=false;
  const setupFailures=[],watchdogs={startup:{present:false,handle:null,failure:null},recognition:{present:false,handle:null,failure:null}};
  function clearTimer(name){
   const slot=watchdogs[name];
   if(slot.failure)throw slot.failure;
   if(!slot.present)return;
   // Retain the original returned handle and failed cleanup. A failed clear is
   // never relabeled as release, retried under another handle, or discarded.
   try{applyNative(unsetTimer,timerReceiver,[slot.handle]);slot.present=false;slot.handle=null;}
   catch(error){slot.failure=finiteError(error,name+'-timer-clear');throw slot.failure;}
  }
  function armTimer(name,ms,callback){
   const slot=watchdogs[name];let registering=true,early=false;
   const handle=applyNative(setTimer,timerReceiver,[()=>{if(registering){early=true;return;}if(!closed)callback();},ms]);
   slot.handle=handle;slot.present=true;registering=false;
   if(early)throw finiteError('Watchdog callbacks must be asynchronous.','invalid-timers');
  }
  const nativeFailure=event=>{void fail(event?.message,'native-error');};
  function cleanupListeners(attempt){
   if(signalAttached){signalAttached=false;attempt('signal-listener',()=>applyNative(nativeRemoveListener,signal,['abort',aborted]));}
   if(nativeErrorAttached){nativeErrorAttached=false;attempt('native-error-listener',()=>applyNative(nativeRemove,native,['error',nativeFailure]));}
   if(messageErrorAttached){messageErrorAttached=false;attempt('native-messageerror-listener',()=>applyNative(nativeRemove,native,['messageerror',nativeFailure]));}
  }
  function stop(reason,terminal='disposed',code=terminal==='canceled'?'aborted':'ocr-failed') {
   if(release)return release.promise;
   release=deferred();closed=true;status=terminal;
   const error=finiteError(reason,code);ready.reject(error);recognition?.reject(error);
   const failures=[];
   const attempt=(stage,fn)=>{try{fn();}catch(cause){failures.push(Object.freeze({stage,message:finiteError(cause).message}));}};
   attempt('startup-watchdog',()=>clearTimer('startup'));attempt('recognition-watchdog',()=>clearTimer('recognition'));
   cleanupListeners(attempt);
   // Independent from every listener/timer cleanup. Captured standard method;
   // its void return does not acknowledge physical child exit or heap release.
   if(native){terminationCalls++;attempt('native-terminate',()=>applyNative(nativeTerminate,native,[]));}
   if(!failures.length){
    releaseReport=Object.freeze({released:true,terminationInvoked:terminationCalls===1,physicalExitAcknowledged:false,generation});
    native=null;sdk=null;active=null;release.resolve(releaseReport);
   }else{
    fenced=true;status='fenced';const retained=Object.freeze(failures);releaseReport=Object.freeze({released:false,terminationInvoked:terminationCalls===1,physicalExitAcknowledged:false,generation,error:Object.freeze({code:'cleanup-failed',message:failures[0].message}),failures:retained});
    const cleanupError=finiteError(failures[0].message,'cleanup-failed');cleanupError.failures=retained;release.reject(cleanupError);
   }
   return release.promise;
  }
  function fail(error,code='ocr-failed'){const promise=stop(error,'failed',code);promise.catch(()=>{});return promise;}
  function aborted(){if(closed||!signalAborted(signal))return;const promise=stop('OCR operation canceled.','canceled');promise.catch(()=>{});}
  const api={
   ready:ready.promise,
   recognize(image,{jobId='owned-ocr-page'}={}) {
    if(closed)return Promise.reject(finiteError('OCR owner is closed.','closed'));
    if(ready.state!=='resolved')return Promise.reject(finiteError('OCR startup has not completed.','not-ready'));
    if(recognition?.state==='pending')return Promise.reject(finiteError('Only one OCR recognition is admitted.','busy'));
    if(typeof jobId!=='string'||jobId.length>100)return Promise.reject(finiteError('Invalid job identifier.','invalid-request'));
    recognition=deferred();const envelope=recognition;status='recognizing';
    try{armTimer('recognition',recognitionMs,()=>{void fail('OCR recognition deadline exceeded.','recognition-timeout');});}
    catch(error){void fail(error,'recognition-timer-register');return envelope.promise;}
    let underlying;
    try{underlying=sdk.recognize(image,{rotateAuto:false,rotateRadians:0},{text:true,blocks:true},jobId);}catch(error){void fail(error);return envelope.promise;}
    Promise.resolve(underlying).then(result=>{
     if(closed||envelope!==recognition)return;
     try{clearTimer('recognition');}catch(error){void fail(error,'recognition-timer-clear');return;}
     status='ready';envelope.resolve(result);
    },error=>{if(!closed&&envelope===recognition)void fail(error);});
    return envelope.promise;
   },
   cancel(reason='OCR operation canceled.'){return stop(reason,'canceled');},
   dispose(){return stop('OCR owner disposed.','disposed');},
   inspect(){return {generation,status,closed,ready:ready.state,readySettles:ready.settles,recognition:recognition?.state??null,recognitionSettles:recognition?.settles??0,terminationCalls,release:releaseReport?{...releaseReport}:null};},
  };
  active=api;
  if(signalAborted(signal)){aborted();return api;}
  if(signal!==undefined){try{signalAttached=true;applyNative(nativeAddListener,signal,['abort',aborted]);}catch(error){void fail(error,'signal-listener');return api;}}
  try{armTimer('startup',startupMs,()=>{void fail('OCR startup deadline exceeded.','startup-timeout');});}
  catch(error){void fail(error,'startup-timer-register');return api;}
  let upstream;
  try {
   upstream=createWorkerWithNativeOwner(languages,oem,{...sdkOptions,workerBlobURL:false,
    logger:()=>{},errorHandler:error=>{void fail(error);},
    onNativeWorker:value=>{
     if(native||!value||typeof value.terminate!=='function'||typeof value.addEventListener!=='function'||typeof value.removeEventListener!=='function')throw finiteError('Invalid direct native owner.','owner-hook');
     native=value;nativeTerminate=value.terminate;nativeAdd=value.addEventListener;nativeRemove=value.removeEventListener;
     // Retain setup errors without throwing through the SDK hook and causing a second termination path.
     try{nativeErrorAttached=true;applyNative(nativeAdd,native,['error',nativeFailure]);}catch(error){setupFailures.push(error);}
     try{messageErrorAttached=true;applyNative(nativeAdd,native,['messageerror',nativeFailure]);}catch(error){setupFailures.push(error);}
    },
   },config);
  }catch(error){void fail(error);return api;}
  Promise.resolve(upstream).then(value=>{
   if(closed)return;
   try{if(!native||!value||typeof value.recognize!=='function'){void fail('The public OCR facade is unavailable.','invalid-facade');return;}}
   catch(error){void fail(error,'invalid-facade');return;}
   sdk=value;
   try{clearTimer('startup');}catch(error){void fail(error,'startup-timer-clear');return;}
   status='ready';ready.resolve();
  },error=>{if(!closed)void fail(error);});
  if(setupFailures.length)void fail(setupFailures[0]);
  return api;
 }
 return {start,inspect(){return {busy:active!==null,fenced,starts};}};
}
module.exports={createOwnedOcrLane,finiteError,validateSignal,signalAborted};
