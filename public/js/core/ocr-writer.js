import { OCR_LIMITS, validateOcrModel, ocrCoverage, ocrModelUsage, inspectOcrText } from './ocr-model.js';
import { assertDocumentWorkspaceBudget } from './document-draft.js';

// Pure append-only invisible overlay. Trusted pinned native modules are injected.
// No recognition, loader, network, adoption, page replacement or text-layer removal.
const MiB=1024*1024,apply=Reflect.apply,set=Uint8Array.prototype.set,fill=Uint8Array.prototype.fill;
const typed=Object.getPrototypeOf(Uint8Array.prototype),tag=Object.getOwnPropertyDescriptor(typed,Symbol.toStringTag).get;
const size=Object.getOwnPropertyDescriptor(typed,'byteLength').get,offset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,buffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,abSize=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,reason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get,throwIfAborted=AbortSignal.prototype.throwIfAborted;
const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener,abort=AbortController.prototype.abort;
const defer=globalThis.setTimeout,globalReceiver=globalThis;
export const OCR_FONT=Object.freeze({id:'regular',style:'regular',file:'NotoSans-Regular.ttf',label:'Noto Sans Regular',byteLength:569208,sha256:'b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5'});
const features=()=>({kern:false,liga:false,clig:false});
function error(code,message){const e=new Error(message);e.code=`OCR_WRITER_${code}`;return e;}
const fail=(code,message)=>{throw error(code,message);};
function genuineSignal(v){if(v!==undefined){try{apply(aborted,v,[]);}catch{fail('INPUT','Expected a genuine AbortSignal.');}apply(throwIfAborted,v,[]);}return v;}
function view(value){let data,n;try{if(apply(tag,value,[])==='Uint8Array'){const b=apply(buffer,value,[]);apply(abSize,b,[]);n=apply(size,value,[]);data=new Uint8Array(b,apply(offset,value,[]),n);}else{n=apply(abSize,value,[]);data=new Uint8Array(value);}}catch{fail('INPUT','Expected actual nonshared Uint8Array or ArrayBuffer bytes.');}return data;}
function copy(data){const result=new Uint8Array(data.byteLength);apply(set,result,[data]);return result;}
function zero(data){if(apply(abSize,apply(buffer,data,[]),[])>0)apply(fill,data,[0]);}
async function digest(bytes){if(!globalThis.crypto?.subtle)fail('DEPENDENCY','Native SHA256 is required.');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
function included(model){return model.pages.flatMap(p=>p.lines.filter(l=>l.included).map(line=>({page:p,line})));}
function policy(model){const issues=[];for(const {page,line}of included(model)){if(page.status==='embedded'&&line.text.length)issues.push({code:'embedded-text-replacement-unproved',pageIndex:page.pageIndex,lineId:line.id});const check=inspectOcrText(line.text);for(const code of check.codes){if(issues.length===100)fail('LIMIT','OCR preflight exceeds100 issue records.');issues.push({code,pageIndex:page.pageIndex,lineId:line.id});}}return issues;}
function near(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b));}
function vectorEqual(a,b){return a.length===b.length&&a.every((n,i)=>near(n,b[i]));}
function transform(m,x,y){return [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];}
function capturedOwner(snapshot){if(!snapshot||typeof snapshot.taskId!=='string'||!snapshot.taskId.length||snapshot.taskId.length>100||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||!Number.isSafeInteger(snapshot.generation)||snapshot.generation<0)fail('INPUT','Joint snapshot needs canonical task/revision/generation.');return {taskId:snapshot.taskId,revision:snapshot.revision,generation:snapshot.generation};}
const sameOwner=(a,b)=>a.taskId===b.taskId&&a.revision===b.revision&&a.generation===b.generation;

export async function preflightOcrWriter(input,{fontkit,fontBytes}={}, {signal:rawSignal}={}){
  const signal=genuineSignal(rawSignal),model=validateOcrModel(input),coverage=ocrCoverage(model),issues=policy(model),rows=included(model).filter(r=>r.line.text.length);
  const usage={...ocrModelUsage(model),workVisits:0,glyphRequests:0,actions:0};
  const check=()=>{if(signal)apply(throwIfAborted,signal,[]);};
  if(issues.length)return {status:'unsupported',coverage,issues,usage,fontRequests:[]};
  if(!rows.length)return {status:'empty-no-glyphs',coverage,issues:[],usage,fontRequests:[]};
  if(fontBytes===undefined)return {status:'needs-fonts',coverage,issues:[],usage,fontRequests:[{...OCR_FONT}]};
  const supplied=view(fontBytes);if(supplied.byteLength!==OCR_FONT.byteLength)fail('FONT_INTEGRITY','Regular font size does not match its fixed pin.');const bytes=copy(supplied);try{if(await digest(bytes)!==OCR_FONT.sha256)fail('FONT_INTEGRITY','Regular font does not match its fixed pin.');check();
  if(typeof fontkit?.create!=='function')fail('DEPENDENCY','The pinned fontkit module is required.');
  const font=fontkit.create(bytes),mapping=new Map(),metrics=[];
  if(!Number.isFinite(font.unitsPerEm)||font.unitsPerEm<=0||!Number.isFinite(font.ascent)||!Number.isFinite(font.descent)||font.ascent<=font.descent)fail('FONT','Invalid pinned font metrics.');
  let since=0,actions=0;
  for(const {page,line}of rows){check();const cps=Array.from(line.text,c=>c.codePointAt(0));usage.workVisits+=cps.length+1;usage.glyphRequests+=3*cps.length;since+=cps.length+1;actions++;usage.actions++;
    if(usage.workVisits>OCR_LIMITS.workVisits||usage.glyphRequests>OCR_LIMITS.glyphRequests)fail('LIMIT','OCR writer work/glyph budget exceeded.');
    let run;try{run=font.layout(line.text,features());}catch{issues.push({code:'font-layout-unproved',lineId:line.id,pageIndex:page.pageIndex});}
    if(run){let valid=run.glyphs.length===cps.length,width=0;
    for(let i=0;i<run.glyphs.length;i++){const glyph=run.glyphs[i],pos=run.positions[i],mapped=Array.from(glyph.codePoints??[]),key=mapped.join(',');
      if(!glyph.id||mapped.length!==1||mapped[0]!==cps[i]||cps[i]===undefined||!font.hasGlyphForCodePoint(cps[i])||mapping.has(glyph.id)&&mapping.get(glyph.id)!==key||!pos||pos.xAdvance!==glyph.advanceWidth||pos.yAdvance!==0||pos.xOffset!==0||pos.yOffset!==0)valid=false;
      mapping.set(glyph.id,key);width+=glyph.advanceWidth/font.unitsPerEm;
    }
    if(!valid||!(width>0&&Number.isFinite(width)))issues.push({code:'glyph-or-logical-positioning-unproved',lineId:line.id,pageIndex:page.pageIndex});
    metrics.push({lineId:line.id,width,ascent:font.ascent/font.unitsPerEm,descent:font.descent/font.unitsPerEm});}
    if(issues.length>100)fail('LIMIT','OCR preflight exceeds100 issue records.');
    if(since>=16384||actions>=128){since=0;actions=0;await new Promise(resolve=>apply(defer,globalReceiver,[resolve,0]));check();}
  }
  return {status:issues.length?'unsupported':'ready',coverage,issues,usage,fontRequests:[{...OCR_FONT}],metrics};}finally{zero(bytes);}
}

// A lane retains the FIRST native promise through cancel/dispose. PDF.js tasks
// get one actual destroy invocation; failed cleanup retains/fences the lease.
export function createOcrWriter({pdfLib,pdfjs,fontkit,fontBytes,pdfjsAssets={}}){
  if(typeof pdfLib?.PDFDocument?.load!=='function'||typeof pdfjs?.getDocument!=='function')fail('DEPENDENCY','Pinned public pdf-lib and PDF.js modules are required.');
  let active=null,closed=false,fence=null,disposeFirst;
  function write(source,input,{signal:rawSignal,sessionUsage,getExternalUsage=()=>({}),isCurrent,draftRevision}={}){
    let owner;try{if(closed)fail('CLOSED','OCR writer is closed.');if(fence)fail('CLEANUP','OCR writer cleanup failed; reload before more work.');if(active)fail('BUSY','Wait for the first writer promise to drain.');genuineSignal(rawSignal);if(typeof sessionUsage!=='function'||typeof getExternalUsage!=='function'||typeof isCurrent!=='function')fail('INPUT','Canonical owner, draft revision and joint accounting accessors are required.');if(!Number.isSafeInteger(draftRevision)||draftRevision<0)fail('INPUT','A captured draft revision is required.');owner=capturedOwner(sessionUsage());}catch(e){return Promise.reject(e);}
    const controller=new AbortController(),lease={controller,first:null,tasks:[],arrays:new Set(),reservedBytes:0,cleanup:[]};active=lease;
    const s=controller.signal;
    function check(){apply(throwIfAborted,s,[]);if(!isCurrent()||!sameOwner(owner,capturedOwner(sessionUsage())))fail('STALE','The canonical source or draft revision changed.');}
    function reserve(bytes,count=8){lease.reservedBytes=bytes;assertDocumentWorkspaceBudget(sessionUsage(),getExternalUsage(),{resourceBytes:bytes,resourceCount:count});}
    function own(bytes){lease.arrays.add(bytes);return bytes;}
    async function native(start,take){check();let value;try{const first=start();value=await first;if(take)take(value);}catch(e){check();throw e;}check();return value;}
    function destroy(record){if(!record.started){record.started=true;try{record.first=Promise.resolve(apply(record.destroy,record.task,[]));}catch(e){record.first=Promise.reject(e);}record.first.catch(()=>{});}return record.first;}
    lease.cancel=value=>{apply(abort,controller,[value]);for(const task of lease.tasks)void destroy(task);};
    const onAbort=()=>lease.cancel(apply(reason,rawSignal,[]));
    let listener=false;
    async function parse(bytes,fn){
      check();const data=own(copy(bytes)),task=pdfjs.getDocument({...pdfjsAssets,data,useSystemFonts:false,isEvalSupported:false}),record={task,destroy:task.destroy,started:false,first:null};lease.tasks.push(record);
      // Register ownership even if a trusted constructor synchronously aborts.
      if(apply(aborted,s,[]))void destroy(record);
      let pdf;try{const first=task.promise;pdf=await first;check();return await fn(pdf);}finally{await destroy(record);zero(data);lease.arrays.delete(data);record.released=true;}
    }
    lease.first=(async()=>{
      let result,failure,failurePresent=false;
      try{
        if(rawSignal){listener=true;apply(add,rawSignal,['abort',onAbort,{once:true}]);if(apply(aborted,rawSignal,[]))onAbort();}
        check();const sourceView=view(source),fontView=view(fontBytes);if(!sourceView.byteLength||sourceView.byteLength>OCR_LIMITS.sourceBytes)fail('LIMIT','OCR source exceeds12MiB.');
        if(fontView.byteLength!==OCR_FONT.byteLength)fail('FONT_INTEGRITY','Regular font size does not match its pin.');
        reserve(sourceView.byteLength+2*OCR_FONT.byteLength+2*OCR_LIMITS.modelBytes);
        const model=validateOcrModel(input),modelUsage=ocrModelUsage(model);
        // Eight MiB is a reservation inside the existing joint pool, not extra capacity.
        const planBytes=8*MiB;reserve(sourceView.byteLength+2*fontView.byteLength+2*modelUsage.modelBytes+planBytes+2*OCR_LIMITS.outputBytes);
        const bytes=own(copy(sourceView)),font=own(copy(fontView));
        if(model.source.byteLength!==bytes.byteLength||await native(()=>digest(bytes))!==model.source.sha256)fail('SOURCE','The source PDF does not match the captured OCR model.');
        const preflight=await native(()=>preflightOcrWriter(model,{fontkit,fontBytes:font},{signal:s}));
        if(preflight.status!=='ready')fail(preflight.status==='unsupported'?'UNSUPPORTED':'EMPTY',preflight.status==='unsupported'?'Included OCR text has unproved controls, glyphs or positioning. Correct or exclude those lines.':'No included searchable glyphs.');
        const metrics=new Map(preflight.metrics.map(m=>[m.lineId,m])),viewports=new Map(),sourceGeometry=[];
        await parse(bytes,async pdf=>{
          if(pdf.numPages!==model.source.pageCount)fail('SOURCE','Source page count differs.');for(let i=0;i<pdf.numPages;i++){const page=await native(()=>pdf.getPage(i+1));sourceGeometry.push({view:[...page.view],rotate:page.rotate,userUnit:page.userUnit});}
          for(const p of model.pages){if(!p.lines.some(l=>l.included&&l.text.length))continue;const page=await native(()=>pdf.getPage(p.pageIndex+1)),g=p.geometry,v=page.getViewport({scale:g.scale,rotation:g.recognitionRotation});
            if(!vectorEqual(page.view,g.view)||page.rotate!==g.rotate||!near(page.userUnit,g.userUnit)||!near(v.width,g.viewport.width)||!near(v.height,g.viewport.height)||!vectorEqual(v.transform,g.viewport.transform))fail('GEOMETRY','Actual PDF.js source viewport differs from captured geometry.');
            const m=g.backing.toViewport;if(!(m[0]>0&&m[3]>0)||m[1]!==0||m[2]!==0||m[4]!==0||m[5]!==0)fail('GEOMETRY','Only captured positive output scaling is supported.');
            const corner=transform(m,g.backing.width,g.backing.height);if(corner[0]>v.width+1e-6||corner[1]>v.height+1e-6)fail('GEOMETRY','Backing-to-viewport mapping exceeds the actual viewport.');viewports.set(p.pageIndex,v);
          }
        });
        const doc=await native(()=>pdfLib.PDFDocument.load(bytes,{updateMetadata:false}));if(doc.getPageCount()!==model.source.pageCount)fail('SOURCE','PDF writer page count differs.');
        const before=doc.getPages().map(page=>({media:page.getMediaBox(),crop:page.getCropBox(),rotation:page.getRotation().angle,userUnit:page.node.get(pdfLib.PDFName.of('UserUnit'))?.toString()??'1'}));
        doc.registerFontkit(fontkit);const embedded=await native(()=>doc.embedFont(font,{subset:true,features:features()})),placements=[];
        for(const {page:p,line}of included(model)){
          check();if(!line.text.length)continue;const metric=metrics.get(line.id),g=p.geometry,v=viewports.get(p.pageIndex),b=line.bbox,width=embedded.widthOfTextAtSize(line.text,1);
          if(!near(width,metric.width))fail('FONT','Encoded font width differs from admitted logical glyph metrics.');
          const sy=(b.y1-b.y0)/(metric.ascent-metric.descent),sx=(b.x1-b.x0)/width,baselineY=b.y0+metric.ascent*sy;
          const point=(x,y)=>v.convertToPdfPoint(...transform(g.backing.toViewport,x,y)),origin=point(b.x0,baselineY),ux=point(b.x0+sx,baselineY),uy=point(b.x0,baselineY-sy),matrix=[ux[0]-origin[0],ux[1]-origin[1],uy[0]-origin[0],uy[1]-origin[1],...origin];
          if(matrix.some(n=>!Number.isFinite(n)))fail('GEOMETRY','Nonfinite overlay matrix.');
          const page=doc.getPage(p.pageIndex);page.pushOperators(pdfLib.pushGraphicsState(),pdfLib.setTextRenderingMode(pdfLib.TextRenderingMode.Invisible),pdfLib.concatTransformationMatrix(...matrix));page.drawText(line.text,{font:embedded,size:1,x:0,y:0});page.pushOperators(pdfLib.popGraphicsState());
          placements.push({pageIndex:p.pageIndex,lineId:line.id,matrix,bbox:{...b}});
          if((placements.length&127)===0){await new Promise(resolve=>apply(defer,globalReceiver,[resolve,0]));check();}
        }
        // Save is not abortable. Await its first promise before cancel can settle.
        const saved=own(view(await native(()=>doc.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false,objectsPerTick:50}),value=>own(view(value)))));
        if(saved.byteLength>OCR_LIMITS.outputBytes)fail('LIMIT','Saved OCR PDF exceeds24MiB after serialization.');
        await parse(saved,async pdf=>{if(pdf.numPages!==before.length)fail('VERIFY','Saved page count differs.');for(let i=0;i<before.length;i++){const p=await native(()=>pdf.getPage(i+1));if(!vectorEqual(p.view,sourceGeometry[i].view)||p.rotate!==sourceGeometry[i].rotate||!near(p.userUnit,sourceGeometry[i].userUnit))fail('VERIFY','Saved page view/rotation/UserUnit differs.');}});
        const output=copy(saved),addedSearchableText=included(model).some(({line})=>/\S/u.test(line.text));let disposed=false;result={bytes:output,type:'application/pdf',draftRevision,coverage:preflight.coverage,capabilities:{encrypted:false,...(addedSearchableText?{searchable:true}:{})},placements,usage:{artifactBytes:output.byteLength,resourceBytes:0,resourceCount:0},report:{font:{...OCR_FONT},features:features(),emptyNoGlyphLines:preflight.coverage.emptyLines,work:preflight.usage,planReservationBytes:planBytes,addedSearchableText,appendOnly:true,existingTextLayerRemoval:false,nativeHeapBound:false},dispose(){if(!disposed){disposed=true;zero(output);}}};
        check();
      }catch(e){failurePresent=true;failure=e;}
      finally{
        // Cleanup failure cannot suppress independent actual destroy attempts.
        if(listener)try{apply(remove,rawSignal,['abort',onAbort]);}catch(e){lease.cleanup.push(String(e?.message??e).slice(0,512));}
        for(const task of lease.tasks)try{await destroy(task);task.released=true;}catch(e){lease.cleanup.push(String(e?.message??e).slice(0,512));}
        if(!lease.cleanup.length){for(const data of lease.arrays)try{zero(data);}catch(e){lease.cleanup.push(String(e?.message??e).slice(0,512));}}
        if(lease.cleanup.length){result?.dispose();fence=lease;}else{lease.arrays.clear();lease.tasks=[];active=null;}
      }
      if(lease.cleanup.length)throw error('CLEANUP','OCR writer cleanup failed and remains fenced.');
      if(apply(aborted,s,[])){result?.dispose();apply(throwIfAborted,s,[]);}
      if(failurePresent){result?.dispose();if(typeof failure?.code==='string'&&/^(OCR_|DOCUMENT_DRAFT_)/.test(failure.code))throw failure;const mapped=error('NATIVE','The bounded OCR PDF write failed.');Object.defineProperty(mapped,'cause',{value:failure});throw mapped;}return result;
    })();
    return lease.first;
  }
  return {write,inspect(){return {busy:!!active,fenced:!!fence,closed,reservedBytes:active?.reservedBytes??0,cleanupErrors:fence?[...fence.cleanup]:[],physicalExitAcknowledged:false};},drained:()=>active?.first??Promise.resolve(),dispose(){if(disposeFirst)return disposeFirst;closed=true;if(active)active.cancel();const pending=active?.first;disposeFirst=(async()=>{if(pending)try{await pending;}catch{}if(fence)throw error('CLEANUP','OCR writer remains fenced after failed cleanup.');})();return disposeFirst;}};
}
