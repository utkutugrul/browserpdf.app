import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedOcrLane} from '../public/js/ocr-ownership.js';

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture({held=false,terminateThrows=false,timers}={}){
 const startup=deferred(),recognition=deferred();let stops=0,spawn=0,options;
 const native=new EventTarget();native.terminate=()=>{stops++;if(terminateThrows)throw false;};
 const sdk={recognize(...args){assert.deepEqual(args.slice(1,3),[{rotateAuto:false,rotateRadians:0},{text:true,blocks:true}]);return recognition.promise;}};
 const lane=createOwnedOcrLane({timers,createWorkerWithNativeOwner(_l,_o,v){spawn++;options=v;v.onNativeWorker(native);return held?startup.promise:Promise.resolve(sdk);}});
 return {lane,startup,recognition,sdk,get stops(){return stops;},get spawn(){return spawn;},get options(){return options;}};
}
test('capture owns pending startup; killed SDK promise need not settle; valid successor',async()=>{
 const f=fixture({held:true}),a=f.lane.start();assert.equal(f.spawn,1);const rejected=assert.rejects(a.ready,{name:'AbortError'});const release=await a.cancel(false);await rejected;assert.equal(release.released,true);assert.equal(f.stops,1);assert.equal(release.physicalExitAcknowledged,false);assert.equal(f.lane.inspect().busy,false);
 const b=f.lane.start();const second=assert.rejects(b.ready);await b.dispose();await second;assert.equal(f.stops,2);
});
test('public facade pending recognition settles once on cancel without killed SDK settlement',async()=>{
 const f=fixture(),a=f.lane.start();await a.ready;const first=a.recognize(new Blob(['image']),{jobId:'page'}),rejected=assert.rejects(first,{name:'AbortError'});await a.cancel();await rejected;assert.equal(a.inspect().recognitionSettles,1);await a.dispose();assert.equal(f.stops,1);
});
test('already aborted genuine signal does not spawn; duck signal is refused',async()=>{
 const f=fixture(),c=new AbortController();c.abort(false);const a=f.lane.start({signal:c.signal});await assert.rejects(a.ready,{name:'AbortError'});await a.dispose();assert.equal(f.spawn,0);assert.throws(()=>f.lane.start({signal:{aborted:false}}),/genuine/);
});
test('genuine signal overrides do not prevent independent direct termination',async()=>{
 const f=fixture({held:true}),c=new AbortController();Object.defineProperties(c.signal,{aborted:{get(){throw 0;}},addEventListener:{value(){throw 0;}},removeEventListener:{value(){throw 0;}}});const a=f.lane.start({signal:c.signal});const rejected=assert.rejects(a.ready);c.abort();await rejected;await a.dispose();assert.equal(f.stops,1);
});
test('timer completion clear failure still terminates and fences',async()=>{
 const timers={setTimeout(){return 7;},clearTimeout(){throw false;}},f=fixture({timers}),a=f.lane.start();await assert.rejects(a.ready,{code:'startup-timer-clear'});await assert.rejects(a.dispose(),{code:'cleanup-failed'});assert.equal(f.stops,1);assert.equal(f.lane.inspect().fenced,true);assert.throws(()=>f.lane.start(),{code:'cleanup-failed'});
});
test('failed direct terminate retains fence/reservation ownership',async()=>{
 const f=fixture({terminateThrows:true}),a=f.lane.start();await a.ready;await assert.rejects(a.dispose(),{code:'cleanup-failed'});assert.equal(f.stops,1);assert.equal(f.lane.inspect().busy,true);assert.throws(()=>f.lane.start(),{code:'cleanup-failed'});
});
