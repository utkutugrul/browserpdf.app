import test from 'node:test';
import assert from 'node:assert/strict';
import {inferPdfTables} from '../public/js/core/pdf-table-model.js';

const item=(text,x,y,extra={})=>({text,transform:[10,0,0,10,x,y],width:10,height:10,hasEOL:false,...extra});
const region=(id='region',name='Page One',extra={})=>({id,name,box:{x:0,y:0,width:200,height:200},separators:[80],rowTolerance:2,...extra});
const page=(items,extra={})=>({number:1,viewport:{width:200,height:200,transform:[1,0,0,-1,0,200]},items,regions:[region()],...extra});
const code=name=>e=>e?.code===name;

test('two explicit page tables preserve exact whitespace, literal formula text, refs and unequal columns',async()=>{
  const input={pages:[page([item(' A ',10,180),item('B',25,180),item('İstanbul',100,180),item('LAST Ελληνικά Русский',10,160)]),page([item('=1+1',20,50,{transform:[0,5,-5,0,20,50]})],{number:2,viewport:{width:200,height:200,transform:[0,2,2,0,-40,-20]},regions:[region('rotated','Rotated')]})]};const out=await inferPdfTables(input);assert.equal(out.model.sheets.length,2);const first=out.model.sheets[0];assert.deepEqual(first.columnWidths,[80,120]);assert.equal(first.rows,2);assert.equal(first.cells[0].text,' A  B');assert.deepEqual(first.cells[0].source.rawTexts,[' A ','B']);assert.deepEqual(first.cells[0].source.itemRefs,[0,1]);assert.equal(first.cells[0].source.pageNumber,1);assert.equal(first.cells[1].text,'İstanbul');assert.equal(out.model.sheets[1].cells[0].text,'=1+1');assert.equal(out.model.sheets[1].cells[0].formula,null);assert.equal(out.model.sheets[1].cells[0].source.pageNumber,2);assert.equal(out.model.unplaced.length,0);assert.ok(out.work.totalVisits>out.work.inferenceVisits);assert.ok(out.work.totalVisits<32*1024*1024);out.dispose();
});

test('unsupported angle, outside and overlapping items remain explicit with original text and geometry',async()=>{
  const overlapping=region('second','Second',{box:{x:0,y:0,width:40,height:200},separators:[]});const out=await inferPdfTables({pages:[page([item('vertical raw',5,180,{transform:[0,10,-10,0,5,180]}),item(' outside ',250,180),item('ambiguous',10,160)],{regions:[region(),overlapping]})]});assert.deepEqual(out.model.unplaced.map(i=>[i.itemRef,i.text,i.reason]),[[0,'vertical raw','unsupported-angle'],[1,' outside ','outside-region'],[2,'ambiguous','overlapping-regions']]);assert.equal(out.model.unplaced[0].x,5);assert.equal(out.model.unplaced[0].y,20);assert.ok(out.model.reports.some(r=>r.code==='unsupported-angle'));assert.equal(out.model.sheets.flatMap(s=>s.cells).length,0);out.dispose();
});

test('separator crossing is a visible inference report and empty/whitespace items are not trimmed or lost',async()=>{
  const out=await inferPdfTables({pages:[page([item('',10,180),item('  ',20,180),item('CROSS',70,160,{width:30})]),page([],{number:2,regions:[region('empty','Empty')]})]});assert.equal(out.model.sheets[0].cells[0].text,'   ');assert.deepEqual(out.model.sheets[0].cells[0].source.rawTexts,['','  ']);assert.ok(out.model.reports.some(r=>r.code==='separator-crossed'));assert.ok(out.model.reports.some(r=>r.code==='empty-page'));assert.equal(out.model.sheets[1].cells.length,0);assert.equal(out.model.sheets[1].rows,1);out.dispose();
});

test('no explicit region invents no table and preserves every supplied item',async()=>{
  const out=await inferPdfTables({pages:[page([item('page punctuation * [x]',10,180)],{regions:[]})]});assert.equal(out.model.sheets.length,0);assert.equal(out.model.unplaced[0].text,'page punctuation * [x]');assert.equal(out.model.unplaced[0].reason,'outside-region');out.dispose();
});

test('strict geometry, duplicate source identities, aggregate text and work limits reject without silent truncation',async()=>{
  await assert.rejects(()=>inferPdfTables({pages:[page([item('x',10,180)],{viewport:{width:200,height:200,transform:[0,0,0,0,0,0]}})]}),code('PDF_TABLE_INPUT'));
  await assert.rejects(()=>inferPdfTables({pages:[page([]),page([])]}),code('PDF_TABLE_INPUT'));
  await assert.rejects(()=>inferPdfTables({pages:[page([],{regions:[region('r','One',{separators:[90,80]})]})]}),code('PDF_TABLE_INPUT'));
  await assert.rejects(()=>inferPdfTables({pages:[page(Array.from({length:4},()=>item('x'.repeat(32767),10,180)))]}),code('PDF_TABLE_LIMIT'));
  await assert.rejects(()=>inferPdfTables({pages:[page([item('x',10,180)])]},{workLimit:10}),code('PDF_TABLE_LIMIT'));
  const items=[item('x',10,180)];Object.defineProperty(items,'map',{value:()=>assert.fail('own map called')});await assert.rejects(()=>inferPdfTables({pages:[page(items)]}),code('PDF_TABLE_INPUT'));
});

test('first held scheduler drains genuine cancellation and future independent inference succeeds',async()=>{
  let release,entered;const hold=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;}),controller=new AbortController(),reason={cancel:'first'};const usage=[];const first=inferPdfTables({pages:[page([item('A',10,180)])]},{signal:controller.signal,onUsage:u=>usage.push(u),yieldControl:()=>{entered();return hold;}});await ready;controller.abort(reason);let settled=false;first.finally(()=>{settled=true;}).catch(()=>{});await Promise.resolve();assert.equal(settled,false);assert.equal(usage[0].resourceBytes,32*1024*1024);release();await assert.rejects(first,e=>e===reason);assert.equal(usage.at(-1).resourceBytes,0);const next=await inferPdfTables({pages:[page([item('successor',10,180)])]});assert.equal(next.model.sheets[0].cells[0].text,'successor');next.dispose();
});

test('real comparison sort work and selected-page admission stay finite without large fixtures',async()=>{
  let yields=0;const out=await inferPdfTables({pages:[page(Array.from({length:92},(_,i)=>item('row-'+(91-i),10,20+i*1.7)),{regions:[region('rows','Rows',{rowTolerance:0.1})]})]},{yieldControl:()=>{yields++;}});assert.equal(out.model.sheets[0].rows,92);assert.equal(out.model.sheets[0].cells[0].text,'row-0');assert.equal(out.model.sheets[0].cells.at(-1).text,'row-91');assert.ok(yields>5);assert.ok(out.work.inferenceVisits>92*2);out.dispose();let calls=0;await assert.rejects(()=>inferPdfTables({pages:[]},{getUsage:()=>({snapshot:{retainedBytes:0,resourceBytes:20*1024*1024,resourceCount:0},live:{}}),yieldControl:()=>{calls++;}}),e=>e.code==='DOCUMENT_DRAFT_LIMIT');assert.equal(calls,0);
});
