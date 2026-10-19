// Executes only new host/ownership source with a controlled public SDK facade.
// Accepted Tesseract main/core/model code never executes in these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';

const root=new URL('../',import.meta.url),hostSource=fs.readFileSync(new URL('public/js/ocr-host.js',root),'utf8'),ownedSource=fs.readFileSync(new URL('public/js/ocr-ownership.js',root),'utf8');
const model=code=>new Uint8Array(fs.readFileSync(new URL('public/vendor/ocr-7.0.0/'+code+'.traineddata',root)));
const tick=()=>new Promise(r=>setTimeout(r,0));async function until(fn){for(let i=0;i<2000;i++){if(fn())return;await tick();}throw Error('Host condition did not occur.');}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function png(){const b=new Uint8Array(33);b.set([137,80,78,71,13,10,26,10]);const v=new DataView(b.buffer);v.setUint32(8,13);b.set([73,72,68,82],12);v.setUint32(16,100);v.setUint32(20,50);return b;}
function nativeResult(){const bbox={x0:1,y0:1,x1:99,y1:40};return {data:{text:'MERHABA İıÇçĞğÖöŞşÜü\n',confidence:71,blocks:[{paragraphs:[{lines:[{text:'MERHABA İıÇçĞğÖöŞşÜü\n',confidence:71,bbox,baseline:{x0:1,y0:35,x1:99,y1:35},rowAttributes:{rowHeight:40,descenders:-4,ascenders:8},words:[{text:'MERHABA',confidence:93,bbox,font_name:'Arial',font_size:20,symbols:Array.from({length:7},()=>({text:'A',confidence:93,bbox,choices:[]})),choices:[]},{text:'İıÇçĞğÖöŞşÜü',confidence:49,bbox,font_name:'Arial',font_size:20,symbols:Array.from({length:11},()=>({text:'İ',confidence:49,bbox,choices:[]})),choices:Array.from({length:4},()=>({text:'x',confidence:50}))}]}]}]}]}};}

async function fixture(t,config={}){
 const world=new EventTarget(),packets=[],timers=new Map(),state={captures:0,terminates:0,recognitions:0,loaded:null,options:null};let context;
 function realm(value){context.__json=JSON.stringify(value);return vm.runInContext('JSON.parse(__json)',context);}
 function send(value){const e=new Event('message');Object.defineProperty(e,'data',{value});world.dispatchEvent(e);}
 class NativeChild extends EventTarget{terminate(){state.terminates++;if(Object.hasOwn(config,'terminateFailure'))throw config.terminateFailure;}}
 const timerSet=function(fn,ms){assert.equal(this,world);const h=setTimeout(()=>{timers.delete(h);if(ms===0)config.onYield?.(()=>send(realm({type:'cancel',requestId:'yield-cancel'})));fn();},ms);timers.set(h,ms);return h;};
 const timerClear=function(h){assert.equal(this,world);if(config.clearFailureMs===timers.get(h))throw false;clearTimeout(h);timers.delete(h);};
 Object.assign(world,{Worker:NativeChild,setTimeout:timerSet,clearTimeout:timerClear,postMessage:function(value){assert.equal(this,world);if(Object.hasOwn(config,'postFailure'))throw config.postFailure;packets.push(structuredClone(value));}});
 context=vm.createContext({globalThis:world,crypto:webcrypto,Worker:NativeChild,EventTarget,AbortController,AbortSignal,Uint8Array,ArrayBuffer,DataView,Blob,TextEncoder,Event,console});
 const ownership=new vm.SourceTextModule(ownedSource,{context});await ownership.link(()=>{throw Error('No static ownership imports.');});await ownership.evaluate();
 const engine=new vm.SyntheticModule(['createWorkerWithNativeOwner'],function(){this.setExport('createWorkerWithNativeOwner',(langs,oem,options,initConfig)=>{
  state.captures++;state.loaded=langs;state.options=options;assert.equal(langs.length,1);assert.equal(oem,1);assert.deepEqual({...initConfig},{});const child=new NativeChild();options.onNativeWorker(child);
  const sdk={recognize(image,recognitionOptions,outputOptions,jobId){state.recognitions++;assert.ok(image instanceof Blob);assert.deepEqual({...recognitionOptions},{rotateAuto:false,rotateRadians:0});assert.deepEqual({...outputOptions},{text:true,blocks:true});assert.equal(typeof jobId,'string');if(config.recognition)return config.recognition.promise;const value=realm(config.result?.()??nativeResult());config.decorateResult?.(value);return Promise.resolve(value);}};
  return config.startup?config.startup.promise:Promise.resolve(sdk);
 });},{context});await engine.link(()=>{});await engine.evaluate();
 const host=new vm.SourceTextModule(hostSource,{context,importModuleDynamically:async url=>{if(url==='blob:main')return engine;if(url==='blob:ownership')return ownership;throw Error('Unverified import '+url);}});await host.link(()=>{throw Error('Host must be standalone.');});await host.evaluate();
 t.after(()=>{for(const h of timers.keys())clearTimeout(h);});
 return {state,packets,realm,send,async init(code='eng',transform=b=>b){const m=realm({type:'init',requestId:'init',language:code,bootstrap:{main:'blob:main',worker:'blob:worker',core:'blob:core',ownership:'blob:ownership'}});m.model=transform(model(code));send(m);await until(()=>packets.some(x=>x.requestId==='init'&&['ready','error'].includes(x.type)));return m.model;},startHeld(){const m=realm({type:'init',requestId:'init',language:'eng',bootstrap:{main:'blob:main',worker:'blob:worker',core:'blob:core',ownership:'blob:ownership'}});m.model=model('eng');send(m);return m.model;},recognize(){const m=realm({type:'recognize',requestId:'page',pageId:'p1',width:100,height:50});m.png=png();send(m);return m.png;},async dispose(id='dispose'){send(realm({type:'dispose',requestId:id}));await until(()=>packets.some(x=>x.type==='release'&&x.requestId===id));return packets.find(x=>x.type==='release'&&x.requestId===id).release;}};
}

test('actual host selected Turkish bytes/public facade/literal LF and nested counts',async t=>{
 const f=await fixture(t),bytes=await f.init('tur');assert.equal(f.packets.find(x=>x.requestId==='init'&&['ready','error'].includes(x.type)).type,'ready');assert.equal(f.state.captures,1);assert.equal(createHash('sha256').update(f.state.loaded[0].data).digest('hex'),'f0127d0f3745f9c65e2ae7ec6b23198fbe5aa186a61b35661426f5e1ef9dedd7');
 assert.equal(f.state.options.cacheMethod,'none');assert.equal(f.state.options.gzip,false);assert.equal(f.state.options.corePath,'blob:core#tesseract-core-lstm.wasm.js');const png=f.recognize();await until(()=>f.packets.some(x=>x.requestId==='page'&&x.type==='page'));const out=f.packets.find(x=>x.type==='page').page;assert.equal(out.lines[0].rawText,nativeResult().data.text);assert.equal(out.lines[0].baseline.y0,out.lines[0].baseline.y1);assert.equal(out.lines[0].rowAttributes.descenders,-4);assert.deepEqual(out.counts,{words:2,symbols:18,choices:4});assert.ok(new TextEncoder().encode(JSON.stringify(f.packets.find(x=>x.type==='page'))).length<=1048576);assert.equal(png.every(x=>x===0),true);
 const r=await f.dispose();assert.equal(r.released,true);assert.equal(r.physicalExitAcknowledged,false);assert.equal(f.state.terminates,1);assert.equal(bytes.every(x=>x===0),true);
});
test('held startup cancel owns native before ready and settles without killed SDK promise',async t=>{
 const f=await fixture(t,{startup:deferred()}),bytes=f.startHeld();await until(()=>f.state.captures===1);const r=await f.dispose();assert.equal(r.released,true);assert.equal(f.state.terminates,1);assert.equal(f.packets.filter(x=>x.requestId==='init'&&x.type==='error').length,1);assert.equal(bytes.every(x=>x===0),true);
});
test('held recognition cancel has one terminal and one direct terminate',async t=>{
 const f=await fixture(t,{recognition:deferred()});await f.init();f.recognize();await until(()=>f.state.recognitions===1);const r=await f.dispose();assert.equal(r.released,true);assert.equal(f.state.terminates,1);assert.equal(f.packets.filter(x=>x.requestId==='page'&&x.type==='error').length,1);assert.equal(f.packets.filter(x=>x.type==='page').length,0);
});
test('wrong model hash/length/backing reject before child capture and preserve normal successor',async t=>{
 for(const transform of [b=>{b[0]^=1;return b;},b=>b.subarray(0,b.length-1),b=>{const large=new Uint8Array(b.length+1);large.set(b,1);return large.subarray(1);}]){const f=await fixture(t);await f.init('eng',transform);assert.equal(f.state.captures,0);assert.equal(f.packets.filter(x=>x.requestId==='init'&&x.type==='error').length,1);assert.equal((await f.dispose()).released,true);}
 const good=await fixture(t);await good.init();assert.equal(good.state.captures,1);assert.equal((await good.dispose()).released,true);
});
test('literal unsupported control output is not filtered; over-limit output never posts raw page',async t=>{
 const raw=nativeResult();raw.data.text='x\r\n';raw.data.blocks[0].paragraphs[0].lines[0].text='x\r\n';const f=await fixture(t,{result:()=>raw});await f.init();f.recognize();await until(()=>f.packets.some(x=>x.type==='page'));assert.equal(f.packets.find(x=>x.type==='page').page.lines[0].rawText,'x\r\n');await f.dispose();
 const g=await fixture(t,{result:()=>{const v=nativeResult();v.data.blocks[0].paragraphs[0].lines[0].text='x'.repeat(4097);return v;}});await g.init();g.recognize();await until(()=>g.packets.some(x=>x.requestId==='page'&&x.type==='error'));assert.equal(g.packets.some(x=>x.type==='page'),false);assert.equal(g.packets.filter(x=>x.requestId==='page'&&x.type==='error').length,1);assert.equal((await g.dispose()).released,true);assert.equal(g.state.terminates,1);
});
test('encoded DTO admission rejects before native post and no binary font fact leaks',async t=>{
 const f=await fixture(t,{result:()=>{const v=nativeResult(),line=v.data.blocks[0].paragraphs[0].lines[0];v.data.text='\u0000'.repeat(100000);line.words=[];line.text='\u0000'.repeat(4000);v.data.blocks[0].paragraphs[0].lines=Array.from({length:22},()=>structuredClone(line));return v;}});await f.init();f.recognize();await until(()=>f.packets.some(x=>x.type==='error'&&x.requestId==='page'));assert.equal(f.packets.some(x=>x.type==='page'),false);await f.dispose();
 const g=await fixture(t,{decorateResult:v=>{v.data.blocks[0].paragraphs[0].lines[0].words[0].font_name=new Uint8Array([1]);}});await g.init();g.recognize();await until(()=>g.packets.some(x=>x.type==='error'&&x.requestId==='page'));assert.equal(g.packets.some(x=>x.type==='page'),false);await g.dispose();
});
test('many short lines yield by first128 actions and cancellation publishes no partial page',async t=>{
 const f=await fixture(t,{onYield:cancel=>cancel(),result:()=>{const v=nativeResult(),line=v.data.blocks[0].paragraphs[0].lines[0];line.text='A';line.words=[];v.data.blocks[0].paragraphs[0].lines=Array.from({length:1000},()=>structuredClone(line));return v;}});await f.init();f.recognize();await until(()=>f.packets.some(x=>x.type==='release'&&x.requestId==='yield-cancel'));assert.equal(f.packets.some(x=>x.type==='page'),false);assert.equal(f.state.terminates,1);
});
test('cleanup timer failure still invokes direct terminate and reports fenced release truth',async t=>{
 const f=await fixture(t,{clearFailureMs:300000});await f.init();const r=await f.dispose();assert.equal(r.released,false);assert.equal(f.state.terminates,1);assert.equal(r.physicalExitAcknowledged,false);assert.ok(r.failures.length>0);
});
test('duplicate request cannot emit a second terminal for its identity',async t=>{
 const f=await fixture(t);await f.init();f.send(f.realm({type:'init',requestId:'init'}));await tick();assert.equal(f.packets.filter(x=>x.requestId==='init'&&['ready','error'].includes(x.type)).length,1);await f.dispose();assert.equal(f.state.terminates,1);
});
test('malformed request flood cannot grow terminal publication past its finite cap',async t=>{
 const f=await fixture(t);for(let i=0;i<1000;i++)f.send(f.realm({type:'unknown',requestId:'bad-'+i}));await tick();assert.equal(f.packets.filter(x=>x.type==='error').length,1);assert.equal(f.state.captures,0);
});
test('falsy native publication failure during capture still owns and terminates held startup',async t=>{
 const f=await fixture(t,{startup:deferred(),postFailure:false}),bytes=f.startHeld();await until(()=>f.state.terminates===1&&bytes.every(x=>x===0));assert.equal(f.state.captures,1);assert.equal(f.packets.length,0);
});
