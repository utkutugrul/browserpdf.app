import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {loadRequestedDocumentFonts} from '../public/js/document-font-source.js';
import {preflightDocumentPdf} from '../public/js/core/document-pdf.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const model=styles=>({version:1,origin:'text',pages:[],lists:[],assets:[],warnings:[],blocks:styles.map((style,i)=>({id:'p'+i,kind:'paragraph',direction:'auto',runs:[{text:'İstanbul Ελληνικά Кириллица',style,direction:'auto'}]}))});
const requests=(await preflightDocumentPdf(model(['regular','bold','italic','boldItalic','code']))).fontRequests;
const bytes=new Map(await Promise.all(requests.map(async r=>[r.file,new Uint8Array(await fs.readFile(new URL('../public/fonts/'+r.file,import.meta.url)))])));
const context=vm.createContext({module:{exports:{}},exports:{},Uint8Array,ArrayBuffer,Buffer,console,setTimeout,clearTimeout});vm.runInContext(await fs.readFile(new URL('../public/vendor/fontkit-1.1.1.umd.min.js',import.meta.url),'utf8'),context);const fontkit=context.module.exports;
const environment=()=>({fetch:async url=>new Response(bytes.get(url.split('/').at(-1))),ensureFontkit:async()=>fontkit});

test('zero actual font requests requires no loader/fetch and dispose is idempotent',async()=>{
  const result=await loadRequestedDocumentFonts([],{}, {fetch(){assert.fail();},ensureFontkit(){assert.fail();}});assert.deepEqual(result.fonts,[]);assert.equal(result.fontkit,undefined);result.dispose();result.dispose();
});

test('all5 actual pins load serially, verify SHA and supply real native font metrics with owned buffers',async()=>{
  const env=environment(),calls=[],native=env.fetch;env.fetch=async url=>{calls.push(url);return native(url);};const result=await loadRequestedDocumentFonts(requests,{},env);assert.deepEqual(calls,requests.map(r=>'/fonts/'+r.file));assert.equal(result.fontkit,fontkit);for(const f of result.fonts){assert.equal(Object.getPrototypeOf(f.bytes),Uint8Array.prototype);assert.ok(fontkit.create(f.bytes).hasGlyphForCodePoint('İ'.codePointAt(0)));}
  const captured=result.fonts.map(f=>f.bytes);result.fonts.length=0;result.dispose();result.dispose();assert.ok(captured.every(b=>b.every(v=>v===0)));assert.ok(bytes.get(requests[0].file).some(v=>v!==0));
});

test('registry/own-data/pin/truncation/overflow controls reject before native font parse',async()=>{
  let loaded=0;const env=environment();env.ensureFontkit=()=>{loaded++;assert.fail();};const hidden={...requests[0]};Object.defineProperty(hidden,'url',{value:'https://example.invalid'});for(const input of [[null],[hidden],[{...requests[0],file:'../font.ttf'}],[requests[0],requests[0]]])await assert.rejects(()=>loadRequestedDocumentFonts(input,{},env),e=>e.code==='DOCUMENT_FONT_INPUT');
  for(const mutation of ['truncated','oversized','changed']){env.fetch=async()=>{let b=bytes.get(requests[0].file).slice();if(mutation==='truncated')b=b.subarray(0,b.length-1);else if(mutation==='oversized')b=new Uint8Array(b.length+1);else b[100]^=1;return new Response(b);};await assert.rejects(()=>loadRequestedDocumentFonts([requests[0]],{},env),e=>e.code==='DOCUMENT_FONT_INTEGRITY');}assert.equal(loaded,0);
});

test('first pending stream cancellation drains fully before abort settlement and valid successor',async()=>{
  const controller=new AbortController(),entered=deferred(),release=deferred(),reason={stage:'stream'};let cancels=0,settled=false;Object.defineProperty(controller.signal,'reason',{get(){assert.fail('own signal reason');}});
  const body=new ReadableStream({pull(){entered.resolve();},cancel(actual){assert.equal(actual,reason);cancels++;return release.promise;}});
  const job=loadRequestedDocumentFonts([requests[0]],{signal:controller.signal},{fetch:async()=>new Response(body),ensureFontkit:async()=>assert.fail()}).then(()=>assert.fail(),e=>{settled=true;assert.equal(e,reason);});await entered.promise;controller.abort(reason);await new Promise(r=>setTimeout(r,5));assert.equal(settled,false);assert.equal(cancels,1);release.resolve();await job;const next=await loadRequestedDocumentFonts([requests[0]],{},environment());next.dispose();
});

test('held first fetch and loader promises cannot publish after abort or stale ownership',async()=>{
  for(const stage of ['fetch','loader']){const entered=deferred(),release=deferred(),env=environment(),controller=new AbortController(),reason={stage};let settled=false;const native=stage==='fetch'?env.fetch:env.ensureFontkit;env[stage==='fetch'?'fetch':'ensureFontkit']=async(...args)=>{entered.resolve();await release.promise;return native(...args);};const job=loadRequestedDocumentFonts([requests[0]],{signal:controller.signal},env).then(()=>assert.fail(),e=>{settled=true;assert.equal(e,reason);});await entered.promise;controller.abort(reason);await new Promise(r=>setTimeout(r,5));assert.equal(settled,false);release.resolve();await job;}
  await assert.rejects(()=>loadRequestedDocumentFonts([requests[0]],{isCurrent:()=>false},environment()),e=>e.code==='DOCUMENT_FONT_STALE');await assert.rejects(()=>loadRequestedDocumentFonts([],{signal:{throwIfAborted(){}}},environment()),e=>e.code==='DOCUMENT_FONT_INPUT');
});
