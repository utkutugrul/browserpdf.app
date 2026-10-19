import test from 'node:test';
import assert from 'node:assert/strict';
import { OCR_LIMITS, projectOcrLine, validateOcrModel, ocrModelUsage, inspectOcrText, ocrCoverage, createOcrDraft } from '../public/js/core/ocr-model.js';
import { assertDocumentWorkspaceBudget } from '../public/js/core/document-draft.js';

// Owned fixture matches the actually captured public native line schema. No
// private artifact import or assumption that every future line ends with LF.
const raw='ROOT ENGLISH OCR 9472\n',bbox={x0:38,y0:115,x1:638,y1:151};
function line(id='l',text=raw){const projection=projectOcrLine(text);return {id,text:projection.content,...projection,source:'ocr',confidence:96,bbox:{...bbox},rawBbox:{...bbox},baseline:{x0:38,y0:150,x1:638,y1:150},rowAttributes:{rowHeight:47.294117,descenders:11.823529,ascenders:11.823529},included:true,reviewed:false};}
const geometry=()=>({view:[0,0,1000,400],rotate:0,userUnit:1,recognitionRotation:0,scale:1,viewport:{width:1000,height:400,transform:[1,0,0,-1,0,400]},backing:{width:1000,height:400,toViewport:[1,0,0,1,0,0]}});
function model(lines=[line()]){return {version:1,source:{sha256:'0'.repeat(64),byteLength:123,pageCount:3},selection:[0,1],pages:[{pageIndex:0,status:'recognized',confidence:95,rawText:raw,geometry:geometry(),lines,attempt:{status:'recognized',error:null}}]};}
const owner={taskId:'ocr-task',revision:1,generation:2};
function setup(input=model(),extra={}){let state={...owner,resourceBytes:0,resourceCount:0,retainedBytes:123,...extra};return {draft:createOcrDraft(input,{owner,sessionUsage:()=>state}),change:values=>{state={...state,...values};}};}
const edit=(text,more={})=>({type:'set-text',pageIndex:0,lineId:'l',text,...more});

test('single terminal LF is reversible and preserves exact spaces, repeated/internal LF and CR',()=>{
  for(const [rawText,content,separator]of [[' A  B\n',' A  B','\n'],['A','A',''],['A\n\n','A\n','\n'],['A\r\n','A\r','\n'],['A\nB\n','A\nB','\n'],['\n','','\n'],['','','']]){
    const p=projectOcrLine(rawText);assert.equal(p.content,content);assert.equal(p.separator,separator);assert.equal(p.rawText,p.content+p.separator);const m=validateOcrModel(model([line('l',rawText)]));assert.equal(m.pages[0].lines[0].rawText,rawText);
    assert.equal(inspectOcrText(content).status,/[\r\n]/.test(content)?'unsupported':'ready');
  }
  const m=validateOcrModel(model());assert.equal(m.pages[0].confidence,95);assert.equal(m.pages[0].lines[0].confidence,96);assert.deepEqual(m.pages[0].lines[0].baseline,{x0:38,y0:150,x1:638,y1:150});assert.deepEqual(m.pages[0].geometry,geometry());
  const wrong=model();wrong.pages[0].lines[0].separator='';assert.throws(()=>validateOcrModel(wrong),e=>e.code==='OCR_MODEL_INPUT');
});

test('typed trailing LF remains unsupported; raw provenance and original bbox survive edits/history',async()=>{
  const {draft}=setup(),original=draft.snapshot().model.pages[0].lines[0];await draft.apply(edit('İstanbul Şükrü Çığ\n'));
  assert.equal(draft.view().coverage.unsupportedLines,1);let l=draft.snapshot().model.pages[0].lines[0];assert.equal(l.text,'İstanbul Şükrü Çığ\n');for(const k of ['rawText','content','separator','projection'])assert.equal(l[k],original[k]);
  await draft.apply({type:'set-box',pageIndex:0,lineId:'l',bbox:{x0:20,y0:100,x1:900,y1:140}});l=draft.snapshot().model.pages[0].lines[0];assert.deepEqual(l.rawBbox,bbox);assert.equal(l.bbox.x0,20);
  draft.undo();draft.undo();assert.equal(draft.snapshot().model.pages[0].lines[0].text,original.text);draft.redo();assert.equal(draft.snapshot().model.pages[0].lines[0].text,'İstanbul Şükrü Çığ\n');assert.equal(draft.rows()[0].policy.status,'unsupported');await draft.dispose();
});

test('page attempts retain previous success; explicit exclusions and partial coverage remain exact',async()=>{
  const {draft}=setup();await draft.apply({type:'record-attempt',pageIndex:0,status:'failed',error:'finite attempt failure'});const s=draft.snapshot();assert.equal(s.model.pages[0].rawText,raw);assert.equal(s.model.pages[0].lines[0].text,'ROOT ENGLISH OCR 9472');assert.deepEqual(s.coverage.failedPages,[0]);assert.deepEqual(s.coverage.unprocessedPages,[1,2]);
  await draft.apply({type:'include-line',pageIndex:0,lineId:'l',included:false});assert.equal(draft.view().coverage.omittedLines,1);assert.equal(draft.view().coverage.includedLines,0);draft.undo();assert.equal(draft.view().coverage.includedLines,1);
  const before=draft.snapshot();const bad={...before.model.pages[0],lines:[line('l'),line('l')]};await assert.rejects(draft.apply({type:'replace-page',pageIndex:0,page:bad}),e=>e.code==='OCR_MODEL_INPUT');assert.deepEqual(draft.snapshot(),before);await draft.dispose();
});

test('manual lines declare absent OCR provenance; empty and spaces-only lines are distinct',async()=>{
  const m=model([line('empty','\n'),line('spaces','  \n')]),c=ocrCoverage(m);assert.equal(c.emptyLines,1);assert.equal(c.includedLines,2);assert.equal(c.unsupportedLines,0);
  const {draft}=setup();const manual={...line('manual','typed'),source:'manual',rawText:null,content:null,separator:null,projection:null,rawBbox:null,baseline:null,rowAttributes:null,confidence:null};await draft.apply({type:'add-line',pageIndex:0,line:manual});assert.equal(draft.snapshot().model.pages[0].lines[1].text,'typed');assert.equal(draft.snapshot().model.pages[0].lines[1].rawText,null);await draft.dispose();
});

test('own-data, finite geometry, literal Unicode and all-string budgets reject atomically',async()=>{
  let invoked=0;const hostile=model();Object.defineProperty(hostile.pages[0].lines[0],'text',{enumerable:true,get(){invoked++;return '';}});assert.throws(()=>validateOcrModel(hostile));assert.equal(invoked,0);
  const dense=model();Object.defineProperty(dense.selection,'map',{value:()=>[],enumerable:false});assert.throws(()=>validateOcrModel(dense));
  for(const bad of ['\ud800','\udc00'])assert.throws(()=>projectOcrLine(bad),e=>e.code==='OCR_MODEL_UNICODE');
  const wrongBox=model();wrongBox.pages[0].lines[0].bbox.x1=38;assert.throws(()=>validateOcrModel(wrongBox));
  const tooMany=model();tooMany.source.pageCount=1000;tooMany.selection=Array.from({length:21},(_,i)=>i);assert.throws(()=>validateOcrModel(tooMany));
  const unitCount=ocrModelUsage(model());let all=0;const stack=[validateOcrModel(model())];while(stack.length){const v=stack.pop();if(typeof v==='string')all+=v.length;else if(v&&typeof v==='object')stack.push(...Object.values(v));}assert.equal(unitCount.textUnits,all);
  const large=model(Array.from({length:90},(_,i)=>line('l'+i,'a'.repeat(4096))));assert.throws(()=>validateOcrModel(large),e=>e.code==='OCR_MODEL_LIMIT');
  const {draft}=setup();const before=draft.snapshot();await assert.rejects(draft.apply(edit('bad\ud800')),e=>e.code==='OCR_MODEL_UNICODE');await assert.rejects(draft.apply(edit('x',{included:false})),e=>e.code==='OCR_MODEL_INPUT');assert.deepEqual(draft.snapshot(),before);await draft.apply(edit('successor'));assert.equal(draft.view().busy,false);await draft.dispose();
});

test('six versions/joint resources are finite; failure never auto-evicts current history',async()=>{
  const {draft}=setup();for(let i=0;i<5;i++)await draft.apply(edit('edit'+i));const before=draft.snapshot();await assert.rejects(draft.apply(edit('sixth')),e=>e.code==='OCR_MODEL_LIMIT');assert.deepEqual(draft.snapshot(),before);assert.equal(draft.view().canUndo,true);draft.clearUndo();await draft.apply(edit('after explicit clear'));assert.ok(draft.view().resourceBytes<48*1024*1024);await draft.dispose();
  assert.throws(()=>setup(model(),{resourceBytes:96*1024*1024-1}),e=>e.code==='DOCUMENT_DRAFT_LIMIT');assert.throws(()=>setup(model(),{resourceCount:128}),e=>e.code==='DOCUMENT_DRAFT_LIMIT');
});

test('genuine signal, owner/revision checks, cancel and dispose drain the first pending mutation',async()=>{
  const {draft,change}=setup(),abort=new AbortController(),reason={why:'literal reason'};abort.abort(reason);await assert.rejects(draft.apply(edit('no'),{signal:abort.signal}),e=>e===reason);await assert.rejects(draft.apply(edit('no'),{signal:{aborted:false}}),e=>e.code==='OCR_MODEL_INPUT');
  const controller=new AbortController(),pending=draft.apply(edit('pending'),{signal:controller.signal});await assert.rejects(draft.apply(edit('busy')),e=>e.code==='OCR_MODEL_BUSY');controller.abort(reason);await assert.rejects(pending,e=>e===reason);assert.equal(draft.snapshot().revision,0);
  await assert.rejects(draft.apply(edit('old'),{expectedRevision:1}),e=>e.code==='OCR_MODEL_STALE');change({revision:2});await assert.rejects(draft.apply(edit('owner')),e=>e.code==='OCR_MODEL_STALE');draft.acceptOwner(owner,{...owner,revision:2});
  const original=draft.snapshot();const work=draft.apply(edit('dispose pending')),drain=draft.dispose();assert.equal(drain,draft.dispose());await assert.rejects(work,e=>e.code==='OCR_MODEL_CLOSED');await drain;assert.throws(()=>draft.snapshot(),e=>e.code==='OCR_MODEL_CLOSED');assert.equal(original.revision,0);
});

test('unsupported shaping and controls stay literal for deliberate correction or exclusion',()=>{
  for(const [value,code]of [['Cafe\u0301','combining-positioning-unproved'],['مرحبا','script-unproved'],['שלום','script-unproved'],['a\tb','control-or-separator-unproved'],['a\u2028b','control-or-separator-unproved'],['a\u200fb','direction-or-format-unproved']]){const m=model([line('l',value)]);assert.equal(validateOcrModel(m).pages[0].lines[0].text,value);assert.ok(inspectOcrText(value).codes.includes(code));assert.equal(ocrCoverage(m).unsupportedLines,1);}assert.equal(OCR_LIMITS.textUnits,1000000);
});

test('row DTO bounds include raw/content/edit/projection/ID/policy strings and snapshots cannot mutate the draft',async()=>{
  const {draft}=setup(model(Array.from({length:20},(_,i)=>line('bounded-'+i,'x'.repeat(1000)+'\n'))));const rows=draft.rows({count:40});let units=0;const stack=[rows];while(stack.length){const v=stack.pop();if(typeof v==='string')units+=v.length;else if(v&&typeof v==='object')stack.push(...Object.values(v));}assert.ok(units<=16384);assert.ok(rows.length<20);const s=draft.snapshot();s.model.pages[0].lines[0].text='external';assert.notEqual(draft.snapshot().model.pages[0].lines[0].text,'external');await draft.dispose();
});

test('P2 pending reservation is public before construction, held candidate blocks competition, commit/failure/dispose drain without double count',async()=>{
  const state={...owner,resourceBytes:0,resourceCount:0,retainedBytes:0};let draft,externalBytes=0;const seen=[];
  draft=createOcrDraft(model(),{owner,sessionUsage:()=>state,getExternalUsage:()=>{if(draft)seen.push(draft.view());return {resourceBytes:externalBytes};}});
  const before=draft.view(),originalTimer=globalThis.setTimeout;let release;
  try{globalThis.setTimeout=fn=>{release=fn;return 1;};const work=draft.apply(edit('candidate'));
    assert.equal(draft.view().pendingResourceBytes,2*OCR_LIMITS.modelBytes);assert.equal(draft.view().pendingPhase,'construction');
    await Promise.resolve();const during=draft.view();assert.equal(during.pendingPhase,'candidate');assert.equal(during.resourceCount,before.resourceCount+1);assert.ok(during.pendingResourceBytes>0&&during.pendingResourceBytes<2*OCR_LIMITS.modelBytes);
    assert.equal(during.resourceBytes,before.resourceBytes+during.pendingResourceBytes);assert.equal(seen[0].pendingResourceBytes,2*OCR_LIMITS.modelBytes);
    assert.throws(()=>assertDocumentWorkspaceBudget(state,{resourceBytes:during.resourceBytes,resourceCount:during.resourceCount},{resourceBytes:96*1024*1024-before.resourceBytes,resourceCount:1}),e=>e.code==='DOCUMENT_DRAFT_LIMIT');
    const exact=96*1024*1024-during.resourceBytes;assert.equal(assertDocumentWorkspaceBudget(state,{resourceBytes:during.resourceBytes,resourceCount:during.resourceCount},{resourceBytes:exact,resourceCount:1}).resourceBytes,96*1024*1024);
    release();await work;assert.equal(draft.view().pendingResourceBytes,0);assert.equal(draft.view().resourceBytes,during.resourceBytes);assert.equal(draft.view().resourceCount,during.resourceCount);
    const committed=draft.snapshot(),held=draft.apply(edit('rejected commit'));await Promise.resolve();const heldUsage=draft.view();externalBytes=96*1024*1024-heldUsage.resourceBytes+1;release();await assert.rejects(held,e=>e.code==='DOCUMENT_DRAFT_LIMIT');externalBytes=0;assert.deepEqual(draft.snapshot(),committed);assert.equal(draft.view().pendingResourceBytes,0);
    const pending=draft.apply(edit('dispose pending'));await Promise.resolve();const closingUsage=draft.view(),dispose=draft.dispose();assert.equal(draft.view().closing,true);assert.equal(draft.view().resourceBytes,closingUsage.resourceBytes);release();await assert.rejects(pending,e=>e.code==='OCR_MODEL_CLOSED');await dispose;
  }finally{globalThis.setTimeout=originalTimer;await draft.dispose();}
  const valid=setup();await valid.draft.apply(edit('valid successor'));await valid.draft.dispose();
});

test('callback boundary rechecks owner/revision, then genuine signal and closing before construction or candidate transfer',async()=>{
  for(const phase of ['construction','candidate'])for(const channel of ['external','owner-after-budget'])for(const kind of ['abort-false','owner-change','dispose']){
    let draft,armed=false,reads=0,triggered=false,disposal,atInvalidation,charged;const state={...owner,resourceBytes:0,resourceCount:0,retainedBytes:0},controller=new AbortController();
    function invalidate(){if(triggered)return;triggered=true;atInvalidation=draft.snapshot();if(kind==='abort-false')controller.abort(false);else if(kind==='owner-change')state.revision++;else disposal=draft.dispose();charged=draft.view();}
    draft=createOcrDraft(model(),{owner,sessionUsage:()=>{if(draft&&armed&&channel==='owner-after-budget'&&++reads===2)invalidate();return {...state};},getExternalUsage:()=>{if(draft?.view().pendingPhase===phase&&!triggered){if(channel==='external')invalidate();else{armed=true;reads=0;}}return {};}});
    const before=draft.snapshot(),work=draft.apply(edit('B'),{signal:controller.signal});
    await assert.rejects(work,e=>kind==='abort-false'?e===false:e.code===(kind==='dispose'?'OCR_MODEL_CLOSED':'OCR_MODEL_STALE'));
    assert.equal(triggered,true,`${phase}/${channel}/${kind}`);assert.deepEqual(atInvalidation,before);assert.ok(charged.pendingResourceBytes>0);assert.equal(charged.pendingPhase,phase);
    if(kind==='dispose'){assert.equal(charged.closing,true);await disposal;assert.throws(()=>draft.snapshot(),e=>e.code==='OCR_MODEL_CLOSED');}else{assert.deepEqual(draft.snapshot(),before);assert.equal(draft.view().pendingResourceBytes,0);assert.equal(draft.view().pendingResourceCount,0);assert.equal(draft.view().canUndo,false);await draft.dispose();}
  }
  const valid=setup();await valid.draft.apply(edit('valid successor'));assert.equal(valid.draft.snapshot().revision,1);assert.equal(valid.draft.view().pendingResourceBytes,0);await valid.draft.dispose();
});
