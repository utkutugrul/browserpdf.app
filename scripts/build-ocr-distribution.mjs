// BrowserPDF compatibility distribution, modified 2026-10-19. Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const V='vendor-src/tesseract-7.0.0/',D='public/vendor/ocr-7.0.0/';
const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=b=>({bytes:Buffer.byteLength(b),sha256:sha(b)});
const read=p=>fs.readFileSync(path.join(root,p));
const json=v=>JSON.stringify(v,null,2)+'\n';
function once(text,before,after){assert.equal(text.split(before).length-1,1,'Unique transform marker');return text.replace(before,()=>after);}
function reverse(text,edits){for(const e of [...edits].reverse()){if(e.after==='')text=text.slice(0,e.position)+e.before+text.slice(e.position);else text=once(text,e.after,e.before);}return text;}
function slice(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return {range:[a,b],text:text.slice(a,b)};}

export function construct(){
 const lock=JSON.parse(read(V+'exact-pins.json'));assert.equal(lock.paths.length,41);assert.equal(new Set(lock.paths).size,41);
 for(const [p,expected]of Object.entries(lock.inputs))assert.deepEqual(pin(read(p)),expected,'Pinned input '+p);
 const mainInput=read(V+'upstream/tesseract.esm.min.js').toString(),factoryInput=read(V+'upstream/createWorker.cjs').toString();
 let factory=factoryInput;const mainEdits=JSON.parse(read(V+'patches/main-edits.json'));for(const e of mainEdits)factory=once(factory,e.from,e.to);
 assert.equal(factory,read(V+'compat/createWorkerWithNativeOwner.cjs').toString());
 const dependencyMap={'./utils/resolvePaths':35,'./createJob':910,'./utils/log':65,'./utils/getId':70,'./constants/OEM':972,'./worker/node':523};
 const body=`,1001:(module,exports,__bundleRequire)=>{\nconst __dependencyMap=Object.freeze(${JSON.stringify(dependencyMap)});\nconst require=name=>{if(!Object.hasOwn(__dependencyMap,name))throw new Error('Unmapped compatibility dependency.');return __bundleRequire(__dependencyMap[name]);};\n`+factory+'\n}';
 const notice='/* Modified 2026-10-19: appended first-party native-owner prototype.\n * This is not an upstream rebuild. Original createWorker module is unchanged.\n * Upstream Apache-2.0 and existing bundle notices are retained beside this file. */\n';
 const marker=',972:t=>{t.exports={TESSERACT_ONLY:0';
 const exportBefore='export { tesseract_min as default };',exportAfter='var createWorkerWithNativeOwner = tesseract_min.createWorkerWithNativeOwner;\nexport { createWorkerWithNativeOwner, tesseract_min as default };';
 const mapBefore='//# sourceMappingURL=tesseract.esm.min.js.map',mapAfter='// Original upstream map removed: new module mapping is in source-compiled-mapping.json.';
 let main=once(mainInput,marker,body+marker);main=once(main,'createWorker:c,setLogging:h','createWorker:c,createWorkerWithNativeOwner:e(1001),setLogging:h');main=notice+once(once(main,exportBefore,exportAfter),mapBefore,mapAfter);
 let recovered=once(main.slice(notice.length),body,'');recovered=once(recovered,'createWorker:c,createWorkerWithNativeOwner:e(1001),setLogging:h','createWorker:c,setLogging:h');recovered=once(once(recovered,exportAfter,exportBefore),mapAfter,mapBefore);assert.equal(recovered,mainInput);
 let recoveredFactory=factory;for(const e of [...mainEdits].reverse())recoveredFactory=once(recoveredFactory,e.to,e.from);assert.equal(recoveredFactory,factoryInput);
 const old603=slice(mainInput,',603:(t,r,e)=>{',',727:t=>{'),new603=slice(main,',603:(t,r,e)=>{',',727:t=>{');assert.equal(old603.text,new603.text);
 const workerInput=read(V+'upstream/worker.min.js').toString(),workerEdits=JSON.parse(read(V+'patches/worker-edits.json'));
 let worker=workerInput;for(const e of workerEdits.compiledEdits)worker=once(worker,e.before,e.after);worker=workerEdits.notice+worker;assert.equal(reverse(worker.slice(workerEdits.notice.length),workerEdits.compiledEdits),workerInput);
 const helper=read(V+'compat/publication-guard.cjs').toString();assert.equal(worker.split(helper).length-1,1);
 const sourceMappings=[];for(const [p,edits]of [['upstream/worker-script.cjs',workerEdits.sourceEdits],['upstream/browser-adapter.cjs',workerEdits.browserEdits]]){const original=read(V+p).toString();let changed=original;for(const e of edits)changed=once(changed,e.before,e.after);assert.equal(reverse(changed,edits),original);sourceMappings.push({path:V+p,original:pin(original),changed:pin(changed),edits});}
 const cjs=read(V+'compat/owned-envelopes.cjs').toString(),cjsEnd='module.exports={createOwnedOcrLane,finiteError,validateSignal,signalAborted};',esmEnd='export {createOwnedOcrLane,finiteError,validateSignal,signalAborted};';
 const ownership=once(cjs,cjsEnd,esmEnd);assert.equal(once(ownership,esmEnd,cjsEnd),cjs);assert.deepEqual(pin(ownership),{bytes:lock.ownership.bytes,sha256:lock.ownership.sha256});
 const outputs=new Map([[D+'tesseract.browserpdf-owner-20261019.esm.js',main],[D+'worker.browserpdf-guard-20261019.js',worker],['public/js/ocr-ownership.js',ownership]]);
 for(const [p,b]of outputs)if(lock.acceptedOutputs[p])assert.deepEqual(pin(b),lock.acceptedOutputs[p]);
 assert.ok(lock.runtime?.host&&lock.runtime?.envelope,'Authored runtime pins must be explicitly locked');
 assert.deepEqual(pin(read('public/js/ocr-host.js')),lock.runtime.host,'Host source lock');assert.deepEqual(pin(ownership),lock.runtime.envelope,'Envelope source lock');
 const runtime={main:{url:'/vendor/ocr-7.0.0/tesseract.browserpdf-owner-20261019.esm.js',...pin(main)},worker:{url:'/vendor/ocr-7.0.0/worker.browserpdf-guard-20261019.js',...pin(worker)},core:{url:'/vendor/ocr-7.0.0/tesseract-core-lstm.wasm.js',...pin(read(D+'tesseract-core-lstm.wasm.js'))},eng:{url:'/vendor/ocr-7.0.0/eng.traineddata',...pin(read(D+'eng.traineddata'))},tur:{url:'/vendor/ocr-7.0.0/tur.traineddata',...pin(read(D+'tur.traineddata'))},ownership:{url:'/js/ocr-ownership.js',...pin(ownership)},host:{url:'/js/ocr-host.js',...lock.runtime.host}};
 // Code source Blobs, three selected-model copies/echo, four PNG/input copies,
 // render backing, raw reply, host+UI DTOs and embedded WASM input. This is a
 // known-buffer schedule, not a promise about SDK/native engine heaps.
 const code=runtime.main.bytes+runtime.worker.bytes+runtime.core.bytes+runtime.ownership.bytes+runtime.host.bytes;
 const peaks=Object.fromEntries(['eng','tur'].map(lang=>[lang,{load:code+3*runtime[lang].bytes,recognize:code+3*runtime[lang].bytes+4*4194304+4000000+4194304+2*1048576+2855361}]));
 for(const phase of Object.values(peaks))for(const n of Object.values(phase))assert.ok(n<=50331648,'Known phase exceeds 48MiB');
 const loader=read('public/js/ocr-assets.js').toString(),start='/* BEGIN GENERATED OCR PINS */',end='/* END GENERATED OCR PINS */';assert.equal(loader.split(start).length,2);assert.equal(loader.split(end).length,2);
 const loaderBody=loader.slice(0,loader.indexOf(start))+start+'\n'+end+loader.slice(loader.indexOf(end)+end.length);assert.deepEqual(pin(loaderBody),lock.runtime.loaderBody,'Authored loader body lock');
 const generated=start+'\nconst PINS = '+JSON.stringify(runtime)+';\n'+end;
 outputs.set('public/js/ocr-assets.js',loader.slice(0,loader.indexOf(start))+generated+loader.slice(loader.indexOf(end)+end.length));
 const mapping={kind:'Appended compatibility transform, not upstream compiler rebuild',reverse:{main:pin(recovered),factory:pin(recoveredFactory),worker:pin(workerInput),ownership:pin(cjs)},main:{original603:old603.range,output603:new603.range,module603Sha256:sha(old603.text),factory1001:{source:V+'compat/createWorkerWithNativeOwner.cjs',range:[main.indexOf(factory),main.indexOf(factory)+factory.length],lines:factory.split('\n').length},dependencyMap},worker:{helper1002:{source:V+'compat/publication-guard.cjs',range:[worker.indexOf(helper),worker.indexOf(helper)+helper.length]},recognitionModule:968,sourceRecognition:'publication.recognition(result, image)',compiledRecognition:'__bpdfPublication.recognition(j,o)',protocol:['jobId','workerId','action','status','data'],sourceMappings},ownership:{source:V+'compat/owned-envelopes.cjs',replace:{before:cjsEnd,after:esmEnd}},sourceMap:'No stale or invented map advertisement'};
 outputs.set(V+'source-compiled-mapping.json',json(mapping));
 const manifest={distribution:'BrowserPDF Tesseract.js 7.0.0 native-owner + publication-guard, modified 2026-10-19',runtime,loader:pin(outputs.get('public/js/ocr-assets.js')),recipe:pin(read('scripts/build-ocr-distribution.mjs')),licenses:Object.fromEntries(Object.entries(lock.inputs).filter(([p])=>p.startsWith(D)&&/LICENSE/.test(p))),knownBufferPeaks:peaks,reservation:{bytes:50331648,resources:32},limits:{oneSelectedLanguage:true,hosts:1,directChildren:1},hardHeapClaim:false};
 outputs.set(D+'manifest.json',json(manifest));
 for(const p of outputs.keys())assert.ok(lock.paths.includes(p),'Output outside allowlist');
 return {outputs,mapping,manifest};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.ok(process.argv.length===3&&['--check','--write'].includes(process.argv[2]),'Use --check or --write');
 const a=construct(),b=construct();assert.deepEqual([...a.outputs],[...b.outputs]);
 if(process.argv[2]==='--write')for(const [p,bytes]of a.outputs)fs.writeFileSync(path.join(root,p),bytes);else for(const [p,bytes]of a.outputs)assert.equal(read(p).toString(),bytes,'Generated output '+p);
 console.log(JSON.stringify({pass:true,mode:process.argv[2],outputs:a.outputs.size,reverse:a.mapping.reverse,knownBufferPeaks:a.manifest.knownBufferPeaks}));
}
