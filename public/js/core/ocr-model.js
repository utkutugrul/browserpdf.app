import { assertDocumentWorkspaceBudget } from './document-draft.js';

// Literal OCR workspace data. This module performs no recognition or loading.
const MiB=1024*1024, encoder=new TextEncoder();
export const OCR_LIMITS=Object.freeze({sourceBytes:12*MiB,sourcePages:1000,selectedPages:20,pagePixels:1000000,selectedPixels:20000000,edge:4096,textUnits:1000000,modelBytes:16*MiB,lines:10000,lineUnits:4096,rawPageUnits:200000,versions:6,historyBytes:48*MiB,outputBytes:24*MiB,workVisits:32*MiB,glyphRequests:2000000});
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get, throwIfAborted=AbortSignal.prototype.throwIfAborted;
const fill=Uint8Array.prototype.fill;
function fail(code,message){const e=new Error(message);e.code=`OCR_MODEL_${code}`;throw e;}
function exact(value,keys){
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INPUT','Expected plain own data.');
  const result={};for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!keys.includes(key)||!d.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Unexpected or non-data field.');result[key]=d.value;}return result;
}
function dense(value,max){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail('INPUT','Expected a standard dense array.');
  const n=Object.getOwnPropertyDescriptor(value,'length').value;if(n>max||Reflect.ownKeys(value).length!==n+1)fail('LIMIT','Array exceeds its finite bounds.');
  const result=[];for(let i=0;i<n;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('INPUT','Expected dense own data.');result.push(d.value);}return result;
}
function integer(n,min,max){if(!Number.isSafeInteger(n)||n<min||n>max)fail('INPUT','Integer is out of range.');return n;}
function finite(n,min=-1000000,max=1000000){if(!Number.isFinite(n)||n<min||n>max)fail('INPUT','Geometry is out of range.');return n;}
function choice(v,values){if(!values.includes(v))fail('INPUT','Unsupported finite state.');return v;}
function bool(v){if(typeof v!=='boolean')fail('INPUT','Expected a boolean.');return v;}
function text(v,max){if(typeof v!=='string'||v.length>max)fail('LIMIT','Text exceeds its finite bound.');for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const next=v.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))fail('UNICODE','Text contains an unpaired surrogate.');}else if(c>=0xdc00&&c<=0xdfff)fail('UNICODE','Text contains an unpaired surrogate.');}return v;}
function confidence(v){if(v===null)return null;return finite(v,0,100);}
function vector(v,n){const a=dense(v,n);if(a.length!==n)fail('INPUT','Invalid affine/vector length.');return a.map(x=>finite(x));}
function positive(n,max){finite(n,0,max);if(n===0)fail('INPUT','Extent must be positive.');return n;}
function affine(v){const a=vector(v,6);if(Math.abs(a[0]*a[3]-a[1]*a[2])<1e-12)fail('INPUT','Affine transform must be invertible.');return a;}
function geometry(raw){
  const g=exact(raw,['view','rotate','userUnit','recognitionRotation','scale','viewport','backing']);
  const view=vector(g.view,4);if(view[2]<=view[0]||view[3]<=view[1])fail('INPUT','Invalid source view.');
  const viewport=exact(g.viewport,['width','height','transform']),backing=exact(g.backing,['width','height','toViewport']);
  const width=integer(backing.width,1,OCR_LIMITS.edge),height=integer(backing.height,1,OCR_LIMITS.edge);if(width*height>OCR_LIMITS.pagePixels)fail('LIMIT','OCR page exceeds one million backing pixels.');
  return {view,rotate:choice(g.rotate,[0,90,180,270]),userUnit:positive(g.userUnit,75000),recognitionRotation:choice(g.recognitionRotation,[0,90,180,270]),scale:positive(g.scale,100),viewport:{width:positive(viewport.width,1000000),height:positive(viewport.height,1000000),transform:affine(viewport.transform)},backing:{width,height,toViewport:affine(backing.toViewport)}};
}
function box(raw,g){const b=exact(raw,['x0','y0','x1','y1']);for(const key of ['x0','x1'])finite(b[key],0,g.backing.width);for(const key of ['y0','y1'])finite(b[key],0,g.backing.height);if(b.x1<=b.x0||b.y1<=b.y0)fail('INPUT','Text box requires positive extents.');return b;}
export function projectOcrLine(rawText){
  text(rawText,OCR_LIMITS.lineUnits);const separator=rawText.endsWith('\n')?'\n':'';
  return {rawText,content:separator?rawText.substring(0,rawText.length-1):rawText,separator,projection:'single-terminal-lf-v1'};
}
function baseline(raw,g){if(raw===null)return null;const b=exact(raw,['x0','y0','x1','y1']);for(const k of ['x0','x1'])finite(b[k],0,g.backing.width);for(const k of ['y0','y1'])finite(b[k],0,g.backing.height);return b;}
function rowAttributes(raw){if(raw===null)return null;const r=exact(raw,['rowHeight','descenders','ascenders']);for(const k of Object.keys(r))finite(r[k]);if(Object.keys(r).length!==3)fail('INPUT','Incomplete row attributes.');return r;}
function modelUsage(model){let units=0,visits=0;const stack=[model];while(stack.length){const v=stack.pop();if(++visits>OCR_LIMITS.workVisits)fail('LIMIT','Model work budget exceeded.');if(typeof v==='string'){units+=v.length;if(units>OCR_LIMITS.textUnits)fail('LIMIT','All stored OCR strings exceed one million UTF-16 units.');}else if(v&&typeof v==='object')for(const item of Object.values(v))stack.push(item);}const bytes=encoder.encode(JSON.stringify(model));if(bytes.byteLength>OCR_LIMITS.modelBytes)fail('LIMIT','OCR model exceeds sixteen MiB.');return {textUnits:units,modelBytes:bytes.byteLength};}
const eligible=/^(?:\p{Script=Latin}|\p{Script=Greek}|\p{Script=Cyrillic}|\p{Script=Common})$/u;
// This is an explicit policy state, not a transformation of the literal string.
export function inspectOcrText(value){
  text(value,OCR_LIMITS.lineUnits);const codes=new Set();
  for(const c of value){if(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(c))codes.add('control-or-separator-unproved');else if(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(c))codes.add('direction-or-format-unproved');else if(/\p{Mark}/u.test(c))codes.add('combining-positioning-unproved');else if(!eligible.test(c))codes.add('script-unproved');}
  return {status:codes.size?'unsupported':'ready',codes:[...codes]};
}
export function validateOcrModel(input){
  const m=exact(input,['version','source','selection','pages']);if(m.version!==1)fail('INPUT','Unsupported OCR model version.');
  const s=exact(m.source,['sha256','byteLength','pageCount']);if(typeof s.sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256))fail('INPUT','A source SHA-256 is required.');
  const source={sha256:s.sha256,byteLength:integer(s.byteLength,1,OCR_LIMITS.sourceBytes),pageCount:integer(s.pageCount,1,OCR_LIMITS.sourcePages)};
  const selection=dense(m.selection,OCR_LIMITS.selectedPages).map(v=>integer(v,0,source.pageCount-1));if(new Set(selection).size!==selection.length)fail('INPUT','Duplicate selected page.');
  let units=0,lines=0,pixels=0;const pageIds=new Set(),lineIds=new Set();
  const count=v=>{units+=v.length;if(units>OCR_LIMITS.textUnits)fail('LIMIT','OCR model exceeds one million UTF-16 units.');return v;};
  const pages=dense(m.pages,OCR_LIMITS.sourcePages).map(raw=>{
    const p=exact(raw,['pageIndex','status','confidence','rawText','geometry','lines','attempt']);
    const pageIndex=integer(p.pageIndex,0,source.pageCount-1);if(pageIds.has(pageIndex))fail('INPUT','Duplicate page.');pageIds.add(pageIndex);
    const g=p.geometry===null?null:geometry(p.geometry);if(selection.includes(pageIndex)&&g)pixels+=g.backing.width*g.backing.height;
    const attempt=exact(p.attempt,['status','error']);choice(attempt.status,['idle','pending','recognized','failed','cancelled']);if(attempt.error!==null)text(attempt.error,512);
    const lineData=dense(p.lines,OCR_LIMITS.lines).map(rawLine=>{
      if(++lines>OCR_LIMITS.lines)fail('LIMIT','OCR model exceeds ten thousand lines.');if(!g)fail('INPUT','A line requires captured page geometry.');
      const l=exact(rawLine,['id','text','rawText','content','separator','projection','confidence','source','bbox','rawBbox','baseline','rowAttributes','included','reviewed']);
      const id=text(l.id,80);if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(id)||lineIds.has(id))fail('INPUT','Line IDs must be unique bounded identifiers.');lineIds.add(id);
      const source=choice(l.source,['ocr','manual']);let provenance;
      if(source==='ocr'){provenance=projectOcrLine(l.rawText);for(const k of ['content','separator','projection'])if(l[k]!==provenance[k])fail('INPUT','OCR provenance must roundtrip through the canonical final-LF split.');count(provenance.rawText);count(provenance.content);count(provenance.separator);}
      else{for(const k of ['rawText','content','separator','projection','confidence','baseline','rowAttributes'])if(l[k]!==null)fail('INPUT','Manual lines have no OCR provenance/confidence.');provenance={rawText:null,content:null,separator:null,projection:null};}
      return {id,text:count(text(l.text,OCR_LIMITS.lineUnits)),...provenance,confidence:confidence(l.confidence),source,bbox:box(l.bbox,g),rawBbox:source==='ocr'?box(l.rawBbox,g):(l.rawBbox===null?null:fail('INPUT','Manual lines have no raw OCR box.')),baseline:baseline(l.baseline,g),rowAttributes:rowAttributes(l.rowAttributes),included:bool(l.included),reviewed:bool(l.reviewed)};
    });
    return {pageIndex,status:choice(p.status,['unprocessed','recognized','blank','embedded','manual']),confidence:confidence(p.confidence),rawText:count(text(p.rawText,OCR_LIMITS.rawPageUnits)),geometry:g,lines:lineData,attempt:{status:attempt.status,error:attempt.error}};
  });
  if(pixels>OCR_LIMITS.selectedPixels)fail('LIMIT','Selected page pixels exceed twenty million.');
  const result={version:1,source,selection,pages};modelUsage(result);return result;
}
export function ocrModelUsage(input){return modelUsage(validateOcrModel(input));}
export function ocrCoverage(input){
  const model=validateOcrModel(input),byPage=new Map(model.pages.map(p=>[p.pageIndex,p]));
  const result={totalPages:model.source.pageCount,selectedPages:[...model.selection],recognizedPages:[],embeddedPages:[],blankPages:[],manualPages:[],pendingPages:[],unprocessedPages:[],failedPages:[],cancelledPages:[],includedPages:[],includedLines:0,omittedLines:0,unreviewedLines:0,unsupportedLines:0,emptyLines:0};
  for(let i=0;i<model.source.pageCount;i++){const p=byPage.get(i);if(!p||p.status==='unprocessed')result.unprocessedPages.push(i);else if(p.status==='recognized'||p.status==='blank')result.recognizedPages.push(i);if(p?.status==='embedded')result.embeddedPages.push(i);if(p?.status==='blank')result.blankPages.push(i);if(p?.status==='manual')result.manualPages.push(i);if(p?.attempt.status==='pending')result.pendingPages.push(i);if(p?.attempt.status==='failed')result.failedPages.push(i);if(p?.attempt.status==='cancelled')result.cancelledPages.push(i);let included=false;for(const l of p?.lines??[]){if(!l.included){result.omittedLines++;continue;}result.includedLines++;included=true;if(!l.reviewed)result.unreviewedLines++;if(!l.text.length)result.emptyLines++;if(inspectOcrText(l.text).status!=='ready')result.unsupportedLines++;}if(included)result.includedPages.push(i);}
  return result;
}
function freeze(v){if(v&&typeof v==='object'){for(const key of Object.keys(v))freeze(v[key]);Object.freeze(v);}return v;}
function signal(v){if(v!==undefined){try{aborted.call(v);}catch{fail('INPUT','Expected a genuine AbortSignal.');}throwIfAborted.call(v);}return v;}
const check=v=>{if(v)throwIfAborted.call(v);};
function owner(v){const a=exact(v,['taskId','revision','generation']);text(a.taskId,100);if(!a.taskId.length)fail('INPUT','A canonical task ID is required.');integer(a.revision,0,Number.MAX_SAFE_INTEGER);integer(a.generation,0,Number.MAX_SAFE_INTEGER);return a;}
const same=(a,b)=>a.taskId===b.taskId&&a.revision===b.revision&&a.generation===b.generation;

// The session callback and external usage accessor are trusted first-party code.
// Every retained version shares the existing joint budget; failed admission is atomic.
export function createOcrDraft(input,{owner:initialOwner,sessionUsage,getExternalUsage=()=>({})}){
  if(typeof sessionUsage!=='function'||typeof getExternalUsage!=='function')fail('INPUT','Joint accounting accessors are required.');
  let expected=owner(initialOwner),revision=0,closed=false,closing=false,first=null,pendingBytes=0,pendingCount=0,pendingPhase=null;
  const encode=model=>({model:freeze(validateOcrModel(model)),bytes:null});
  assertDocumentWorkspaceBudget(sessionUsage(),getExternalUsage(),{resourceBytes:2*OCR_LIMITS.modelBytes,resourceCount:1});
  const initial=encode(input);initial.bytes=encoder.encode(JSON.stringify(initial.model));let current=initial,past=[],future=[];
  const owned=new Set([initial.bytes]);
  const entries=(c=current,p=past,f=future)=>[...new Set([initial,c,...p,...f])];
  const live=()=>({resourceBytes:2*entries().reduce((n,v)=>n+v.bytes.byteLength,0)+pendingBytes,resourceCount:entries().length+pendingCount,pendingResourceBytes:pendingBytes,pendingResourceCount:pendingCount,pendingPhase});
  function budget(extra={}){const external=getExternalUsage();assertDocumentWorkspaceBudget(sessionUsage(),external,{resourceBytes:live().resourceBytes+(extra.resourceBytes??0),resourceCount:live().resourceCount+(extra.resourceCount??0)});}
  budget();
  function active(){if(closed||closing)fail('CLOSED','OCR draft is closing or closed.');}
  function unlocked(){active();if(first||pendingCount)fail('BUSY','Wait for the first mutation promise to drain.');}
  function assertOwner(captured=expected){const snapshot=sessionUsage(),actual=owner({taskId:snapshot.taskId,revision:snapshot.revision,generation:snapshot.generation});if(!same(captured,expected)||!same(captured,actual))fail('STALE','The canonical source owner changed.');}
  function tidy(){const keep=new Set(entries().map(v=>v.bytes));for(const bytes of owned)if(!keep.has(bytes)){fill.call(bytes,0);owned.delete(bytes);}}
  function view(){if(closed)fail('CLOSED','OCR draft is closed.');return {revision,owner:{...expected},dirty:current!==initial,canUndo:past.length>0,canRedo:future.length>0,busy:!!first||pendingCount>0,closing,...live(),coverage:ocrCoverage(current.model)};}
  function snapshot(){active();return {revision,model:validateOcrModel(current.model),coverage:ocrCoverage(current.model),owner:{...expected}};}
  function rows({start=0,count=40}={}){active();integer(start,0,OCR_LIMITS.lines);integer(count,0,40);const result=[];let offset=0,units=0;for(const p of current.model.pages)for(const l of p.lines){if(offset++<start)continue;const policy=inspectOcrText(l.text),size=l.id.length+l.source.length+l.text.length+(l.rawText?.length??0)+(l.content?.length??0)+(l.separator?.length??0)+(l.projection?.length??0)+policy.status.length+policy.codes.reduce((n,c)=>n+c.length,0);if(result.length===count||units+size>16384)return result;units+=size;result.push({pageIndex:p.pageIndex,...l,bbox:{...l.bbox},policy});}return result;}

  function edit(model,raw){
    const all=['type','pageIndex','lineId','text','bbox','included','reviewed','page','selection','status','error','line'],type=exact(raw,all).type;
    const tags={'select-pages':['selection'],'replace-page':['pageIndex','page'],'record-attempt':['pageIndex','status','error'],'add-line':['pageIndex','line'],'set-text':['pageIndex','lineId','text'],'set-box':['pageIndex','lineId','bbox'],'include-line':['pageIndex','lineId','included'],'review-line':['pageIndex','lineId','reviewed']};
    if(!Object.hasOwn(tags,type))fail('INPUT','Unknown OCR edit command.');const c=exact(raw,['type',...tags[type]]);
    if(c.type==='select-pages'){model.selection=c.selection;return;}
    const page=model.pages.find(p=>p.pageIndex===c.pageIndex);
    if(c.type==='replace-page'){if(!c.page||exact(c.page,['pageIndex','status','confidence','rawText','geometry','lines','attempt']).pageIndex!==c.pageIndex)fail('INPUT','Replacement page index differs.');if(page)model.pages[model.pages.indexOf(page)]=c.page;else model.pages.push(c.page);return;}
    if(!page)fail('INPUT','Unknown page.');
    if(c.type==='record-attempt'){page.attempt={status:c.status,error:c.error};return;}
    if(c.type==='add-line'){if(exact(c.line,['id','text','rawText','content','separator','projection','confidence','source','bbox','rawBbox','baseline','rowAttributes','included','reviewed']).source!=='manual')fail('INPUT','Typed lines require explicit manual provenance.');page.lines.push(c.line);return;}
    const line=page.lines.find(l=>l.id===c.lineId);if(!line)fail('INPUT','Unknown line.');
    switch(c.type){case 'set-text':line.text=c.text;line.reviewed=false;break;case 'set-box':line.bbox=c.bbox;line.reviewed=false;break;case 'include-line':line.included=c.included;break;case 'review-line':line.reviewed=c.reviewed;break;default:fail('INPUT','Unknown OCR edit command.');}
  }
  async function apply(command,{signal:rawSignal,expectedRevision=revision}={}){
    unlocked();const s=signal(rawSignal);assertOwner();check(s);active();if(expectedRevision!==revision)fail('STALE','Draft revision changed.');const captured={...expected};
    const guard=()=>{check(s);assertOwner(captured);if(expectedRevision!==revision)fail('STALE','Draft revision changed.');check(s);active();};
    // Publish the maximum pending reservation before constructing a candidate.
    // Sibling operations consume this same public usage, including during close.
    pendingBytes=2*OCR_LIMITS.modelBytes;pendingCount=1;pendingPhase='construction';
    const work=async()=>{let model,next;try{
      model=validateOcrModel(current.model);edit(model,command);next=encode(model);next.bytes=encoder.encode(JSON.stringify(next.model));model=null;
      pendingBytes=2*next.bytes.byteLength;pendingPhase='candidate';
      await new Promise(resolve=>setTimeout(resolve,0));guard();
      const nextPast=[...past,current],versions=entries(next,nextPast,[]),size=versions.reduce((n,v)=>n+v.bytes.byteLength,0);
      if(versions.length>OCR_LIMITS.versions||size>OCR_LIMITS.historyBytes)fail('LIMIT','Clear undo history before retaining another OCR revision.');
      budget(); // Candidate is already included once in live usage.
      guard(); // Last owner callback precedes the final signal/closing checks.
      owned.add(next.bytes);past=nextPast;future=[];current=next;revision++;
      // Transfer the existing reservation to the committed entry atomically.
      pendingBytes=0;pendingCount=0;pendingPhase='committed';tidy();
    }catch(error){if(next?.bytes)fill.call(next.bytes,0);throw error;}};
    // Register FIRST before accounting callbacks or candidate construction.
    first=Promise.resolve().then(()=>{guard();budget();guard();return work();});
    try{await first;}finally{pendingBytes=0;pendingCount=0;pendingPhase=null;first=null;}return view();
  }
  function move(undo){unlocked();assertOwner();const from=undo?past:future;if(!from.length)fail('INPUT','No revision in that direction.');const next=from[from.length-1];if(undo){past=past.slice(0,-1);future=[...future,current];}else{future=future.slice(0,-1);past=[...past,current];}current=next;revision++;return view();}
  let disposeFirst;
  return {view,snapshot,rows,apply,undo:()=>move(true),redo:()=>move(false),
    clearUndo(){unlocked();assertOwner();past=[];future=[];tidy();return view();},
    acceptOwner(before,next){unlocked();if(!same(owner(before),expected))fail('STALE','Owner transition does not match.');const n=owner(next),snapshot=sessionUsage();if(!same(n,owner({taskId:snapshot.taskId,revision:snapshot.revision,generation:snapshot.generation})))fail('STALE','New owner is not canonical.');expected=n;return view();},
    drained:()=>first??Promise.resolve(),
    dispose(){if(disposeFirst)return disposeFirst;closing=true;const pending=first;disposeFirst=(async()=>{if(pending)try{await pending;}catch{}for(const bytes of owned)fill.call(bytes,0);owned.clear();past=[];future=[];closed=true;})();return disposeFirst;}
  };
}
