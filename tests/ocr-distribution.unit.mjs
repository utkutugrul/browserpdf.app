import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {construct} from '../scripts/build-ocr-distribution.mjs';

const root=new URL('../',import.meta.url),V='vendor-src/tesseract-7.0.0/',D='public/vendor/ocr-7.0.0/';
const read=p=>fs.readFileSync(new URL(p,root)),sha=b=>createHash('sha256').update(b).digest('hex');
test('offline construction is deterministic and reverses whole originals',()=>{
 const a=construct(),b=construct();assert.deepEqual([...a.outputs],[...b.outputs]);
 for(const [p,v]of a.outputs)assert.equal(read(p).toString(),v,p);
 assert.equal(a.mapping.reverse.main.sha256,'64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29');
 assert.equal(a.mapping.reverse.worker.sha256,'576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d');
 assert.equal(sha(read(D+'tesseract.browserpdf-owner-20261019.esm.js')),'1c12db34982b2dd905532431374f5127cbd5485ac163b1a7db98b56f53160b8a');
 assert.equal(sha(read(D+'worker.browserpdf-guard-20261019.js')),'1bd038a24f06a7b49bbc98dbe8c5d67acfaad49d29343d0a1e4f84c42fff58b2');
});
test('mapping is byte-exact for original603, appended source and ownership inverse',()=>{
 const {mapping:m}=construct(),original=read(V+'upstream/tesseract.esm.min.js'),main=read(D+'tesseract.browserpdf-owner-20261019.esm.js'),worker=read(D+'worker.browserpdf-guard-20261019.js');
 assert.deepEqual(original.subarray(...m.main.original603),main.subarray(...m.main.output603));
 assert.deepEqual(main.subarray(...m.main.factory1001.range),read(V+'compat/createWorkerWithNativeOwner.cjs'));
 assert.deepEqual(worker.subarray(...m.worker.helper1002.range),read(V+'compat/publication-guard.cjs'));
 const esm=read('public/js/ocr-ownership.js').toString(),{before,after}=m.ownership.replace;assert.deepEqual(Buffer.from(esm.replace(after,before)),read(m.ownership.source));
});
test('runtime host/envelope pins and known-buffer phases are concrete and bounded',()=>{
 const {manifest:m}=construct();assert.equal(m.runtime.host.sha256,sha(read('public/js/ocr-host.js')));assert.equal(m.runtime.ownership.sha256,'87e22994bbadffe3fda50e7818236445d448b39e37ff81478bce43577ec3e28e');
 for(const phase of Object.values(m.knownBufferPeaks))for(const n of Object.values(phase))assert.ok(n<=48*1024*1024);
 assert.equal(m.reservation.resources,32);assert.equal(m.hardHeapClaim,false);
});
test('altered exact input refuses offline before any output write',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'browserpdf-ocr-distribution-'));
 try{
  const lock=JSON.parse(read(V+'exact-pins.json'));for(const p of lock.paths){if(!fs.existsSync(new URL(p,root)))continue;fs.mkdirSync(path.dirname(path.join(temp,p)),{recursive:true});fs.copyFileSync(new URL(p,root),path.join(temp,p));}
  const input=path.join(temp,V+'compat/publication-guard.cjs'),output=path.join(temp,D+'worker.browserpdf-guard-20261019.js'),before=sha(fs.readFileSync(output));fs.appendFileSync(input,'\n// altered input\n');
  assert.throws(()=>execFileSync('rtk',['proxy','node','scripts/build-ocr-distribution.mjs','--write'],{cwd:temp,stdio:'pipe'}));assert.equal(sha(fs.readFileSync(output)),before);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
