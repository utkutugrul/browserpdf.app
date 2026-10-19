import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createDocumentSession } from '../public/js/core/document-session.js';
import { assertDocumentWorkspaceBudget } from '../public/js/core/document-draft.js';
import { createDocumentIntake } from '../public/js/document-intake.js';
import { readMarkdownDocument } from '../public/js/core/markdown-document.js';
const bytes = text => new TextEncoder().encode('%PDF-1.7\n'+text);
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));

test('snapshot reports actual resource map cardinality without transfer or byte copies',async()=>{
  const session=createDocumentSession();assert.equal(session.snapshot().resourceCount,0);session.begin(bytes('A'),'A.pdf');session.transfer=()=>assert.fail('not an inventory API');assert.equal(session.snapshot().resourceCount,0);
  const scene=session.beginScene();assert.equal(session.snapshot().resourceCount,1);const first=await session.addAsset(png,'image/png');assert.equal(session.snapshot().resourceCount,2);assert.equal(await session.addAsset(png,'image/png'),first);assert.equal(session.snapshot().resourceCount,2);assert.equal(session.snapshot().resourceBytes,bytes('A').length+png.length);
  const stable=session.snapshot();stable.resourceCount=999;assert.equal(session.snapshot().resourceCount,2);assert.equal(session.scene().sourceRef,scene.sourceRef);session.clear();assert.equal(session.snapshot().resourceCount,0);assert.equal(session.snapshot().resourceBytes,0);
});

test('composition source resources survive publish/adopt/history and explicit inherited restore',async()=>{
  const session=createDocumentSession();session.begin(bytes('original'),'original.pdf');const initial=session.snapshot();await session.beginComposition([{id:'one',original:{bytes:png,name:'one.png',type:'image/png'},asset:{bytes:png,name:'one.png',type:'image/png',width:1,height:1}}],{expectedTaskId:initial.taskId,expectedRevision:initial.revision});
  assert.equal(session.snapshot().resourceCount,2);const state=session.snapshot();session.publishComposition(bytes('chosen'),'chosen.pdf',{expectedTaskId:state.taskId,expectedRevision:state.revision});session.adopt(bytes('edited'),'edited.pdf');assert.equal(session.snapshot().resourceCount,2);session.undo();assert.equal(session.snapshot().resourceCount,2);session.redo();assert.equal(session.snapshot().resourceCount,2);
  // A deliberate restore fixture uses transfer once; it never counts resources.
  const transfer=session.transfer(),restored=createDocumentSession();restored.begin(transfer.current.bytes,transfer.current.name,transfer);assert.equal(restored.snapshot().resourceCount,2);assert.equal(restored.snapshot().resourceBytes,session.snapshot().resourceBytes);assert.deepEqual(restored.original(),session.original());
});

test('failed inherited admission preserves scalar, original/current and history identity',()=>{
  const session=createDocumentSession();session.begin(bytes('A'),'A.pdf');session.adopt(bytes('A edit'),'A-edit.pdf');const before=session.snapshot(),original=session.original(),current=session.current();assert.throws(()=>session.begin(bytes('B'),'B.pdf',{resources:[{id:'invalid',bytes:png,name:'bad.png',type:'image/png'}]}));assert.deepEqual(session.snapshot(),before);assert.deepEqual(session.original(),original);assert.deepEqual(session.current(),current);
});

async function actualEmptySession(){const source=await readFile(new URL('../public/js/tool-ui.js',import.meta.url),'utf8'),expression=source.match(/^const emptySession = (.*);$/m)?.[1];assert.ok(expression);assert.ok(!source.includes("import { createDocumentSession }"));return vm.runInNewContext('('+expression+')()');}

test('actual lazy emptySession has zero resources and passes joint budget before initialization',async()=>{
  const empty=await actualEmptySession();assert.equal(empty.resourceBytes,0);assert.equal(empty.resourceCount,0);assert.equal(empty.retainedBytes,0);assert.equal(empty.current,null);const admitted=assertDocumentWorkspaceBudget(empty);assert.deepEqual([admitted.resourceBytes,admitted.resourceCount,admitted.retainedBytes],[0,0,0]);assert.deepEqual([admitted.remainingResourceBytes,admitted.remainingResourceCount,admitted.remainingRetainedBytes],[96*1024*1024,128,512*1024*1024]);const missing={...empty};delete missing.resourceBytes;assert.throws(()=>assertDocumentWorkspaceBudget(missing),e=>e.code==='DOCUMENT_DRAFT_INPUT');
});

test('actual unnormalized empty snapshot admits first Markdown File and real reader before canonical publication',async()=>{
  let owner=await actualEmptySession(),parses=0,publications=0,accepted;
  const literal='first *literal*  \r\nnext';const lane=createDocumentIntake({getOwner:()=>owner,getUsage:()=>({snapshot:owner,live:{}}),async readCandidate(input){parses++;assert.equal(owner.taskId,null);assert.equal(new TextDecoder().decode(input),literal);return readMarkdownDocument(new TextDecoder().decode(input));},publishCandidate(candidate,ctx){ctx.assertCurrent();publications++;assert.equal(owner.taskId,null);assert.equal(candidate.model.blocks[0].runs.map(r=>r.text).join(''),'first literal\nnext');assert.deepEqual(candidate.model.blocks[0].runs.map(r=>r.style),['regular','italic','regular']);accepted=candidate;owner={...owner,taskId:'first-document',generation:1};return {owner};}});
  try{const result=await lane.select(new File([literal],'first.md',{type:'text/markdown'}),{intent:1});await lane.drain();assert.equal(result.status,'accepted');assert.equal(parses,1);assert.equal(publications,1);assert.equal(result.owner.taskId,'first-document');assert.ok(accepted.modelBytes.length>0);}finally{await lane.dispose();accepted?.dispose();}
});
