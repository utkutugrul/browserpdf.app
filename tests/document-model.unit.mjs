import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocumentModel, DOCUMENT_LIMITS } from '../public/js/core/document-model.js';

const run=text=>({text,style:'regular',direction:'auto'});
const paragraph=(id='p1',text='Literal 2 * 3 * 4; #hash; snake_case; C:\\folder.  İstanbul שלום مرحبا\tEND\n')=>({id,kind:'paragraph',direction:'ltr',runs:[run(text)],source:{pageNumber:1,source:'embedded',box:{x:10,y:20,width:300,height:25}}});
const model=()=>({version:1,origin:'pdf',pages:[{number:1,source:'embedded'}],lists:[],assets:[],blocks:[paragraph()],warnings:[]});
test('literal text, whitespace, per-run requested styles and explicit directions are retained without Markdown interpretation',()=>{
  const input=model();input.blocks[0].runs=[{text:'*LATIN ITALIC* ',style:'italic',direction:'ltr'},run('مرحبا '),{text:'שלום',style:'bold',direction:'rtl'},run('  2 * 3 * 4\tEND\n')];input.pages.push({number:2,source:'ocr',confidence:87.5});const result=validateDocumentModel(input);assert.deepEqual(result,input);assert.notEqual(result,input);assert.notEqual(result.blocks[0].runs,input.blocks[0].runs);result.blocks[0].runs[0].text='changed';assert.equal(input.blocks[0].runs[0].text,'*LATIN ITALIC* ');
});
test('list start/restart, owned images and table cells survive a single finite model',()=>{
  const input=model();input.origin='docx';input.lists=[{id:'numbering7',ordered:true,start:7}];input.assets=[{id:'asset-one',type:'image/png',width:120,height:60,alt:'two color'}];input.blocks.push({id:'li1',kind:'list-item',direction:'ltr',list:{id:'numbering7',level:0,value:7,restart:true},runs:[run('NUMBERED ALPHA')]},{id:'img1',kind:'image',assetId:'asset-one',width:120,height:60},{id:'table1',kind:'table',columnWidths:[1,2],rows:[[{paragraphs:[{id:'cell1',kind:'paragraph',direction:'auto',runs:[run('LEFT')]}]},{paragraphs:[{id:'cell2',kind:'paragraph',direction:'auto',runs:[run('İzmir RIGHT')]}]}]]});input.warnings=[{code:'reading-order-inferred',sourcePage:1,blockId:'p1'}];assert.deepEqual(validateDocumentModel(input),input);
});
test('duplicate IDs, missing references and arbitrary model/run metadata reject',()=>{
  for(const mutate of [m=>m.blocks.push(paragraph()),m=>m.blocks.push({id:'i1',kind:'image',assetId:'absent',width:1,height:1}),m=>m.blocks[0].runs[0].url='https://example.invalid/private',m=>m.password='secret',m=>m.blocks[0].id='bad/id',m=>m.warnings=[{code:'arbitrary warning'}]]){const input=model();mutate(input);assert.throws(()=>validateDocumentModel(input),/Invalid document/);}
});
test('finite enums, confidence, geometry, warning references and image dimensions reject invalid values',()=>{
  for(const mutate of [m=>m.pages[0].confidence=101,m=>m.pages[0].confidence=NaN,m=>m.blocks[0].direction='sideways',m=>m.blocks[0].runs[0].style='fake-serif',m=>m.blocks[0].source.box.x=Infinity,m=>m.blocks[0].source.box.width=-1,m=>m.blocks[0].source.box={x:999999,y:0,width:2,height:1},m=>m.warnings=[{code:'complex-layout',sourcePage:99}],m=>m.assets=[{id:'a',type:'image/png',width:4096,height:4096,alt:''}],m=>m.blocks[0].runs[0].text='bad\ud800']){const input=model();mutate(input);assert.throws(()=>validateDocumentModel(input),/Invalid document/);}
});
test('text admission includes alternate text and stops at one million UTF16 units',()=>{
  const input=model();input.blocks[0].runs=[run('x'.repeat(DOCUMENT_LIMITS.textUnits))];assert.equal(validateDocumentModel(input).blocks[0].runs[0].text.length,DOCUMENT_LIMITS.textUnits);input.assets=[{id:'a',type:'image/png',width:1,height:1,alt:'one'}];assert.throws(()=>validateDocumentModel(input),/one million/);
});
test('paragraph/run/warning and table column guards reject before output construction',()=>{
  const input=model();input.blocks[0].runs=Array.from({length:50001},()=>run(''));assert.throws(()=>validateDocumentModel(input),/Paragraph runs/);input.blocks[0].runs=[run('')];input.warnings=Array.from({length:101},()=>({code:'complex-layout'}));assert.throws(()=>validateDocumentModel(input),/Document warnings/);
  input.warnings=[];input.blocks.push({id:'t',kind:'table',columnWidths:[1,1],rows:[[{paragraphs:[]}]]});assert.throws(()=>validateDocumentModel(input),/cell\/column/);
});
test('sparse arrays and accessor properties cannot bypass finite validation',()=>{
  const input=model();input.blocks[0].runs=new Array(1);assert.throws(()=>validateDocumentModel(input),/Paragraph runs/);const second=model();Object.defineProperty(second,'origin',{get(){throw Error('getter must not run');},enumerable:true});assert.throws(()=>validateDocumentModel(second),/Document fields/);
  const third=model();third.blocks[0].runs=new Array(1);third.blocks[0].runs.side=run('side');assert.throws(()=>validateDocumentModel(third),/Paragraph runs/);
  const fourth=model();const row=new Array(1);row.side={paragraphs:[]};fourth.blocks=[{id:'t',kind:'table',columnWidths:[1],rows:[row]}];assert.throws(()=>validateDocumentModel(fourth),/Table row/);
  const fifth=model();Object.defineProperty(fifth.blocks[0],'kind',{get(){throw Error('kind getter must not run');},enumerable:true});assert.throws(()=>validateDocumentModel(fifth),/Block fields/);
});
test('already canceled validation preserves the supplied model',()=>{const input=model(),before=structuredClone(input),controller=new AbortController();controller.abort();assert.throws(()=>validateDocumentModel(input,{signal:controller.signal}),{name:'AbortError'});assert.deepEqual(input,before);});
test('table row capacity is shared across the entire document',()=>{const input=model(),rows=()=>Array.from({length:5001},()=>[{paragraphs:[]}]);input.blocks=[{id:'t1',kind:'table',columnWidths:[1],rows:rows()},{id:'t2',kind:'table',columnWidths:[1],rows:rows()}];assert.throws(()=>validateDocumentModel(input),/aggregate table rows/);});
test('input array map overrides and subclasses cannot bypass nested model validation or ownership',()=>{
  const targets=[m=>m.pages,m=>m.assets,m=>m.lists,m=>m.blocks,m=>m.warnings,m=>m.blocks[0].runs,m=>m.blocks[1].columnWidths,m=>m.blocks[1].rows,m=>m.blocks[1].rows[0],m=>m.blocks[1].rows[0][0].paragraphs];let calls=0;
  for(const target of targets){const input=model();input.blocks.push({id:'t',kind:'table',columnWidths:[1],rows:[[{paragraphs:[]}]]});Object.defineProperty(target(input),'map',{value(){calls++;return this;}});assert.throws(()=>validateDocumentModel(input),/Invalid document/);}
  class Override extends Array{map(){calls++;return this;}}
  const input=model();input.blocks=new Override({id:'bad/id',kind:'arbitrary',url:'https://example.invalid/private'});assert.throws(()=>validateDocumentModel(input),/Document blocks/);assert.equal(calls,0);
});
test('hidden, symbolic and undefined own properties cannot evade the JSON field and byte contract',()=>{
  const mutations=[m=>Object.defineProperty(m,'secret',{value:'hidden'}),m=>Object.defineProperty(m.pages[0],'confidence',{value:90}),m=>Object.defineProperty(m.blocks[0].runs[0],'url',{value:'https://example.invalid/private'}),m=>m[Symbol('private')]='hidden',m=>m.blocks[Symbol('extra')]='hidden',m=>m.blocks[0].source.box[Symbol('extra')]=99,m=>m.pages[0].confidence=undefined];
  for(const mutate of mutations){const input=model();mutate(input);assert.throws(()=>validateDocumentModel(input),/Invalid document/);}
});
test('frozen plain JSON controls return independent standard arrays through all nested collections',()=>{
  const input=model();input.blocks.push({id:'t',kind:'table',columnWidths:[1],rows:[[{paragraphs:[]}]]});for(const value of [input.pages,input.assets,input.lists,input.blocks,input.warnings,input.blocks[0].runs,input.blocks[1].rows,input.blocks[1].rows[0],input.blocks[1].rows[0][0].paragraphs])Object.freeze(value);
  const result=validateDocumentModel(input);assert.deepEqual(result,input);assert.notEqual(result.blocks,input.blocks);assert.notEqual(result.blocks[0].runs,input.blocks[0].runs);assert.notEqual(result.blocks[1].rows[0],input.blocks[1].rows[0]);assert.notEqual(result.blocks[1].rows[0][0].paragraphs,input.blocks[1].rows[0][0].paragraphs);assert.equal(Object.getPrototypeOf(result.blocks),Array.prototype);
});
