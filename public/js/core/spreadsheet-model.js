import {assertDocumentWorkspaceBudget} from './document-draft.js';

const MiB=1024*1024, encoder=new TextEncoder(), fill=Uint8Array.prototype.fill;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const abort=AbortSignal.prototype.throwIfAborted;
const reason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
export const SPREADSHEET_LIMITS=Object.freeze({sheets:16,rows:10000,columns:100,cells:200000,textUnits:1000000,cellUnits:32767,formulaUnits:1024,modelBytes:16*MiB,modelCharge:48*MiB,versions:6,historyBytes:48*MiB,merges:1000,reports:100,workVisits:32*MiB,viewRows:40,viewColumns:12,viewUnits:16384});
export const SPREADSHEET_REPORT_CODES=Object.freeze(['inferred','unsupported-angle','empty-page','outside-region','overlapping-regions','separator-crossed','source-unsupported']);
const EMPTY=Object.freeze({taskId:null,revision:0,generation:0,retainedBytes:0,resourceBytes:0,resourceCount:0});
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const fail=(code,message)=>{const e=new Error(message);e.code=`SPREADSHEET_${code}`;throw e;};
function record(value,keys){
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INPUT','Expected plain own spreadsheet data.');
  const out={};for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!keys.includes(key)||!d.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Unexpected spreadsheet property.');out[key]=d.value;}return out;
}
const num=(v,a,b)=>{if(!Number.isFinite(v)||v<a||v>b)fail('INPUT','Invalid finite spreadsheet number.');return v;};
const int=(v,a,b)=>{if(!Number.isSafeInteger(v)||v<a||v>b)fail('INPUT','Invalid spreadsheet integer.');return v;};
const choice=(v,values)=>{if(!values.includes(v))fail('INPUT','Unsupported spreadsheet choice.');return v;};
const boolean=v=>{if(typeof v!=='boolean')fail('INPUT','Expected a boolean.');return v;};
const str=(v,max)=>{if(typeof v!=='string'||v.length>max)fail('INPUT','Invalid spreadsheet text.');return v;};
const identity=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(v))fail('INPUT','Invalid spreadsheet identity.');return v;};
function genuineSignal(value){if(value!==undefined){try{aborted.call(value);}catch{fail('INPUT','Expected a genuine AbortSignal.');}abort.call(value);}return value;}
const check=s=>{if(s)abort.call(s);};
function owner(v){const r=record(v,['taskId','revision','generation']);if(r.taskId!==null&&typeof r.taskId!=='string')fail('INPUT','Invalid task identity.');return {taskId:r.taskId,revision:int(r.revision,0,Number.MAX_SAFE_INTEGER),generation:int(r.generation,0,Number.MAX_SAFE_INTEGER)};}
const same=(a,b)=>a.taskId===b.taskId&&a.revision===b.revision&&a.generation===b.generation;
function usage(v={}){const r=record(v,['resourceBytes','resourceCount','artifactBytes','expandedBytes','expandedCount']),out={};for(const k of ['resourceBytes','resourceCount','artifactBytes','expandedBytes','expandedCount'])out[k]=int(r[k]??0,0,Number.MAX_SAFE_INTEGER);return out;}
function combine(...values){const out=usage();for(const value of values){const u=usage(value);for(const k of Object.keys(out)){out[k]+=u[k];if(!Number.isSafeInteger(out[k]))fail('LIMIT','Spreadsheet budget arithmetic overflow.');}}return out;}
const budgetUsage=u=>({resourceBytes:u.resourceBytes,resourceCount:1});
function dense(value,max){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail('INPUT','Expected a standard dense array.');
  const n=Object.getOwnPropertyDescriptor(value,'length')?.value;int(n,0,max);if(Reflect.ownKeys(value).length!==n+1)fail('INPUT','Invalid array own keys.');
  return n;
}
function indexed(a,i){const d=Object.getOwnPropertyDescriptor(a,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Invalid own array element.');return d.value;}
function meter(signal,yieldControl=pause,assertCurrent=()=>{},maximum=SPREADSHEET_LIMITS.workVisits){
  let visits=0,actions=0,since=0;
  const verify=()=>{check(signal);assertCurrent();check(signal);};
  return {verify,get visits(){return visits;},get actions(){return actions;},get due(){return since>=16384;},visit(n=1){verify();visits+=n;since+=n;if(visits>maximum)fail('LIMIT','Spreadsheet work exceeds 32 Mi visits.');},async step(force=false){verify();actions++;if(force||since>=16384||actions%128===0){since=0;const first=yieldControl({workVisits:visits,actions});await first;verify();}}};
}
function limitsState(m){return {m,json:0,units:0,objects:0};}
function charge(s,n){s.json+=n;if(s.json>SPREADSHEET_LIMITS.modelBytes||s.json*3+2*s.units+128*s.objects>SPREADSHEET_LIMITS.modelCharge)fail('LIMIT','Spreadsheet model/serialization charge exceeds its finite budget.');}
async function textCharge(value,s){
  s.units+=value.length;if(s.units>SPREADSHEET_LIMITS.textUnits)fail('LIMIT','Stored spreadsheet strings exceed one million UTF16 units.');
  let n=2;for(let i=0;i<value.length;){s.m.visit();const cp=value.codePointAt(i);if(cp>=0xd800&&cp<=0xdfff)fail('INPUT','Unpaired UTF16 surrogate.');const c=String.fromCodePoint(cp);n+=c==='"'||c==='\\'?2:cp<32?(['\b','\f','\n','\r','\t'].includes(c)?2:6):cp<128?1:cp<2048?2:cp<65536?3:4;i+=c.length;if(s.m.due)await s.m.step(true);}charge(s,n);
}
async function copy(value,s,depth=0,frozen=true){
  s.m.visit();await s.m.step();if(depth>12)fail('INPUT','Spreadsheet data nesting exceeds twelve.');
  if(typeof value==='string'){await textCharge(value,s);return value;}
  if(value===null||typeof value==='boolean'){charge(s,value===null?4:value?4:5);return value;}
  if(typeof value==='number'){num(value,-Number.MAX_VALUE,Number.MAX_VALUE);charge(s,String(value).length);return value;}
  if(!value||typeof value!=='object')fail('INPUT','Expected finite JSON spreadsheet data.');
  s.objects++;charge(s,2);
  if(Array.isArray(value)){const n=dense(value,SPREADSHEET_LIMITS.cells);charge(s,Math.max(0,n-1));const out=[];for(let i=0;i<n;i++)out.push(await copy(indexed(value,i),s,depth+1,frozen));return frozen?Object.freeze(out):out;}
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INPUT','Unexpected spreadsheet object prototype.');
  const keys=Reflect.ownKeys(value);if(keys.length>32)fail('INPUT','Too many spreadsheet object fields.');charge(s,Math.max(0,keys.length-1));const out={};
  for(const key of keys){s.m.visit();if(typeof key!=='string'||key==='__proto__')fail('INPUT','Invalid spreadsheet key.');const d=Object.getOwnPropertyDescriptor(value,key);if(!d?.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Spreadsheet accessors/hidden values are unsupported.');await textCharge(key,s);charge(s,1);out[key]=await copy(d.value,s,depth+1,frozen);}return frozen?Object.freeze(out):out;
}
function raw(v){const r=record(v,['type','value']);choice(r.type,['string','number','boolean','error','blank']);if(r.type==='string'||r.type==='error')str(r.value,SPREADSHEET_LIMITS.cellUnits);else if(r.type==='number')num(r.value,-Number.MAX_VALUE,Number.MAX_VALUE);else if(r.type==='boolean')boolean(r.value);else if(r.value!==null)fail('INPUT','Blank values must be null.');}
function range(v,s){const r=record(v,['top','left','bottom','right']);int(r.top,0,s.rows-1);int(r.bottom,r.top,s.rows-1);int(r.left,0,s.columns-1);int(r.right,r.left,s.columns-1);return r;}
const overlaps=(a,b)=>a.left<=b.right&&b.left<=a.right&&a.top<=b.bottom&&b.top<=a.bottom;
async function schema(model,m){
  record(model,['version','sourceKind','sheets','reports','unplaced']);if(model.version!==1)fail('INPUT','Spreadsheet version must be one.');choice(model.sourceKind,['xlsx','csv','pdf','authored']);
  const n=dense(model.sheets,16),ids=new Set(),names=new Set();let rows=0,slots=0,cells=0,merges=0;
  for(let i=0;i<n;i++){
    m.visit();await m.step();const s=model.sheets[i];record(s,['id','name','rows','columns','cells','columnWidths','rowMetadata','merges','hidden','selected','print']);identity(s.id);str(s.name,31);if(!s.name||ids.has(s.id)||names.has(s.name.toLowerCase())||/[\[\]:*?/\\]/u.test(s.name))fail('INPUT','Sheet names/identities must be valid and unique.');ids.add(s.id);names.add(s.name.toLowerCase());
    rows+=int(s.rows,1,10000);slots+=s.rows*int(s.columns,1,100);if(rows>10000||slots>200000)fail('LIMIT','Aggregate sheet rows/cell slots exceed limits.');choice(s.hidden,['visible','hidden','very-hidden']);boolean(s.selected);
    if(dense(s.columnWidths,100)!==s.columns)fail('INPUT','Supply one width per column.');for(const w of s.columnWidths){m.visit();await m.step();num(w,0.001,10000);}
    record(s.print,['paper','landscape','margin','range']);choice(s.print.paper,['a4','letter']);boolean(s.print.landscape);num(s.print.margin,0,72);if(s.print.range!==null)range(s.print.range,s);
    const positions=new Set();cells+=dense(s.cells,200000);if(cells>200000)fail('LIMIT','Too many stored spreadsheet cells.');
    for(const c of s.cells){m.visit();await m.step();record(c,['row','column','raw','text','display','formula','source']);int(c.row,0,s.rows-1);int(c.column,0,s.columns-1);const key=c.row*s.columns+c.column;if(positions.has(key))fail('INPUT','Duplicate cell coordinates.');positions.add(key);raw(c.raw);str(c.text,32767);str(c.display,32767);
      if(c.formula!==null){record(c.formula,['text','cached','state']);str(c.formula.text,1024);if(!c.formula.text.length)fail('INPUT','Formula text cannot be empty.');choice(c.formula.state,['source','unverified','missing']);if(c.formula.cached===null){if(c.formula.state!=='missing')fail('INPUT','Missing formula cache state is required.');}else{if(c.formula.state==='missing')fail('INPUT','Missing cache state contradicts a cached value.');raw(c.formula.cached);}}
      if(c.source!==null){const p=record(c.source,['pageNumber','regionId','itemRefs','rawTexts','separator']);int(p.pageNumber,1,1000);identity(p.regionId);str(p.separator,1);const k=dense(p.itemRefs,10000);if(dense(p.rawTexts,10000)!==k)fail('INPUT','Source refs and raw strings differ.');const seen=new Set();for(let j=0;j<k;j++){m.visit();await m.step();int(p.itemRefs[j],0,9999);if(seen.has(p.itemRefs[j]))fail('INPUT','Duplicate source item reference.');seen.add(p.itemRefs[j]);str(p.rawTexts[j],32767);}}
    }
    const seenRows=new Set();dense(s.rowMetadata,10000);for(const r of s.rowMetadata){m.visit();await m.step();record(r,['row','hidden','height']);int(r.row,0,s.rows-1);if(seenRows.has(r.row))fail('INPUT','Duplicate row metadata.');seenRows.add(r.row);boolean(r.hidden);if(r.height!==null)num(r.height,1,4096);}
    merges+=dense(s.merges,1000);if(merges>1000)fail('LIMIT','Too many merged ranges.');for(let a=0;a<s.merges.length;a++){const r=range(s.merges[a],s);if(r.top===r.bottom&&r.left===r.right)fail('INPUT','A merge needs at least two cells.');for(let b=0;b<a;b++){m.visit();await m.step();if(overlaps(r,s.merges[b]))fail('INPUT','Merged ranges overlap.');}}
  }
  dense(model.reports,100);for(const r of model.reports){m.visit();await m.step();record(r,['code','sheetId','pageNumber','count']);choice(r.code,SPREADSHEET_REPORT_CODES);if(r.sheetId!==null&&!ids.has(r.sheetId))fail('INPUT','Report refers to unknown sheet.');if(r.pageNumber!==null)int(r.pageNumber,1,1000);int(r.count,1,1000000);}
  dense(model.unplaced,100000);const refs=new Set();for(const p of model.unplaced){m.visit();await m.step();record(p,['pageNumber','itemRef','text','reason','x','y']);int(p.pageNumber,1,1000);int(p.itemRef,0,9999);str(p.text,32767);choice(p.reason,['unsupported-angle','outside-region','overlapping-regions']);num(p.x,-1000000,1000000);num(p.y,-1000000,1000000);const key=p.pageNumber+':'+p.itemRef;if(refs.has(key))fail('INPUT','Duplicate unplaced source item.');refs.add(key);}
  return cells;
}
export async function validateSpreadsheetModel(input,options={}){
  const o=record(options,['signal','yieldControl','getUsage','onUsage','workLimit']),signal=genuineSignal(o.signal);for(const k of ['yieldControl','getUsage','onUsage'])if(o[k]!==undefined&&typeof o[k]!=='function')fail('INPUT','Invalid trusted spreadsheet callback.');
  const get=o.getUsage??(()=>({snapshot:EMPTY,live:{}})),pending={resourceBytes:48*MiB,resourceCount:2};let bytes;
  const verify=()=>{check(signal);const u=record(get(),['snapshot','live']);check(signal);assertDocumentWorkspaceBudget(u.snapshot,u.live,pending);check(signal);};const m=meter(signal,o.yieldControl??pause,verify,int(o.workLimit??SPREADSHEET_LIMITS.workVisits,0,SPREADSHEET_LIMITS.workVisits));
  const notify=u=>{o.onUsage?.({...u});check(signal);};
  try{
    verify();notify(pending);await m.step(true);const s=limitsState(m),model=await copy(input,s);const cells=await schema(model,m);m.verify();
    const charge=s.json+2*s.units+128*s.objects+64*cells;if(charge+2*s.json>48*MiB)fail('LIMIT','Known model/serialization peak exceeds48MiB.');
    const json=JSON.stringify(model);if(json.length>s.json)fail('LIMIT','Unexpected model encoding budget.');bytes=encoder.encode(json);if(bytes.length>16*MiB)fail('LIMIT','Unexpected model encoding budget.');m.verify();
    const known=bytes.length+2*s.units+128*s.objects+64*cells;if(known>48*MiB)fail('LIMIT','Owned spreadsheet model exceeds48MiB.');
    let disposed=false;const owned=bytes;const result={model,bytes,usage:{modelBytes:bytes.length,textUnits:s.units,objects:s.objects,cells,resourceBytes:known,resourceCount:1,workVisits:m.visits,actions:m.actions},dispose(){if(!disposed){disposed=true;fill.call(owned,0);}}};notify(budgetUsage(result.usage));m.verify();notify({resourceBytes:0,resourceCount:0});m.verify();bytes=null;return result;
  }catch(error){if(bytes)fill.call(bytes,0);try{o.onUsage?.({resourceBytes:0,resourceCount:0});}catch{}check(signal);throw error;}
}

function optionsGuard(raw,current,revision,expected,signal){const o=record(raw,['signal','expectedModel','expectedRevision','expectedOwner']);genuineSignal(o.signal);if(o.expectedModel!==undefined&&o.expectedModel!==current)fail('STALE','The actual model identity changed.');if(o.expectedRevision!==undefined&&o.expectedRevision!==revision)fail('STALE','The model revision changed.');if(o.expectedOwner!==undefined&&!same(owner(o.expectedOwner),expected))fail('STALE','The expected canonical owner changed.');check(signal);return o;}
async function cloneModel(model,m){return copy(model,limitsState(m),0,false);}
function cellKey(r,c){return r+':'+c;}
async function indexModel(model,m){const index=new Map();for(const sheet of model.sheets){const cells=new Map();for(const c of sheet.cells){m.visit();await m.step();cells.set(cellKey(c.row,c.column),c);}index.set(sheet.id,{sheet,cells});}return index;}
function scalarOffset(text,n){int(n,0,text.length);if(n>0&&n<text.length&&/[\ud800-\udbff]/u.test(text[n-1])&&/[\udc00-\udfff]/u.test(text[n]))fail('INPUT','Window offset splits a Unicode scalar.');return n;}
function window(text,offset,limit){scalarOffset(text,offset);let end=Math.min(text.length,offset+limit);if(end>offset&&end<text.length&&/[\ud800-\udbff]/u.test(text[end-1])&&/[\udc00-\udfff]/u.test(text[end]))end--;return {text:text.slice(offset,end),offset,totalUnits:text.length,hasMore:end<text.length};}
export async function createSpreadsheetDraft(input,settings){
  const cfg=record(settings,['owner','sessionUsage','getExternalUsage','yieldControl','prepareCandidate','preparationUsage','signal']);if(typeof cfg.sessionUsage!=='function')fail('INPUT','Canonical session usage is required.');for(const k of ['getExternalUsage','yieldControl','prepareCandidate'])if(cfg[k]!==undefined&&typeof cfg[k]!=='function')fail('INPUT','Invalid trusted draft callback.');
  const openingSignal=genuineSignal(cfg.signal);
  const expected=owner(cfg.owner),external=cfg.getExternalUsage??(()=>({})),prep=usage(cfg.preparationUsage??{});let closed=false,busy=false,revision=0,current,baseline,past=[],future=[],pending=usage(),firstJob=null,controller=null,disposal=null,fence=null;
  const entries=()=>[...new Set([baseline,current,...past,...future].filter(Boolean))];
  const retained=()=>({resourceBytes:entries().reduce((n,e)=>n+e.bundle.usage.resourceBytes,0),resourceCount:entries().length});
  const privateUsage=()=>combine(retained(),pending);
  const canonical=()=>{const s=cfg.sessionUsage();if(!same(expected,owner({taskId:s.taskId,revision:s.revision,generation:s.generation})))fail('STALE','The canonical owner changed.');return s;};
  const budget=(extra={})=>{const s=canonical(),e=external();canonical();return assertDocumentWorkspaceBudget(s,combine(privateUsage(),e),extra);};
  // No callback belongs after this local guard and the ownership mutation.
  const localGuard=(captured,local,signal,admission=false)=>{check(signal);if(closed)fail('CLOSED','The spreadsheet draft is closed.');if(fence)fail('CLEANUP','Spreadsheet preparation cleanup failed; reset the page.');if(admission&&busy)fail('BUSY','Wait for the first spreadsheet operation to drain.');if(current!==captured||revision!==local)fail('STALE','The actual model identity/revision changed.');};
  const ensure=()=>{const captured=current,local=revision;localGuard(captured,local,undefined,true);canonical();localGuard(captured,local,undefined,true);};
  const makeEntry=async(bundle,m)=>({bundle,index:await indexModel(bundle.model,m)});
  const openingGuard=()=>localGuard(undefined,0,openingSignal,true);
  const init=await validateSpreadsheetModel(input,{...(openingSignal?{signal:openingSignal}:{}),...(cfg.yieldControl?{yieldControl:cfg.yieldControl}:{}),getUsage:()=>{const snapshot=canonical(),live=external();canonical();openingGuard();return {snapshot,live};}});
  try{pending=budgetUsage(init.usage);budget();openingGuard();const entry=await makeEntry(init,meter(openingSignal,cfg.yieldControl??pause,()=>{budget();openingGuard();}));budget();openingGuard();baseline=current=entry;pending=usage();}catch(error){init.dispose();throw error;}
  function tidy(){const keep=new Set(entries());for(const e of owned)if(!keep.has(e)){e.bundle.dispose();owned.delete(e);}}
  const owned=new Set([baseline]);
  function snapshot(){const u=privateUsage();return {revision,owner:{...expected},busy,closed,cleanupBlocked:!!fence,pendingUsage:{...pending},retainedModelCount:entries().length,retainedModelBytes:retained().resourceBytes,modelBytes:current?.bundle.bytes.length??0,canUndo:past.length>0,canRedo:future.length>0,dirty:current!==baseline,...u};}
  function sheetOf(model,id){const s=model.sheets.find(v=>v.id===id);if(!s)fail('INPUT','Unknown sheet identity.');return s;}
  async function edit(model,command,m){
    const c=record(command,['type','sheetId','row','column','text','replaceFormula','top','left','values','width','selected','print','metadata','index','delta']);const s=sheetOf(model,c.sheetId),positions=new Map();for(const cell of s.cells){m.visit();await m.step();positions.set(cellKey(cell.row,cell.column),cell);}
    const setCell=(r,col,text)=>{int(r,0,s.rows-1);int(col,0,s.columns-1);str(text,32767);let cell=positions.get(cellKey(r,col));if(cell?.formula&&c.replaceFormula!==true)fail('INPUT','Formula replacement requires an explicit literal choice.');if(c.replaceFormula!==undefined&&c.replaceFormula!==true)fail('INPUT','Invalid formula replacement choice.');if(!cell){cell={row:r,column:col,raw:{type:'blank',value:null},text:'',display:'',formula:null,source:null};s.cells.push(cell);positions.set(cellKey(r,col),cell);}cell.text=text;cell.display=text;cell.formula=null;};
    const allowed={
      'replace-cell':['type','sheetId','row','column','text','replaceFormula'],
      'replace-range':['type','sheetId','top','left','values','replaceFormula'],
      'set-column-width':['type','sheetId','column','width'],'set-selected':['type','sheetId','selected'],
      'set-print':['type','sheetId','print'],'set-row':['type','sheetId','metadata'],'unmerge':['type','sheetId','index'],'move-sheet':['type','sheetId','delta']
    };if(!Object.hasOwn(allowed,c.type))fail('INPUT','Unknown spreadsheet command.');record(command,allowed[c.type]);
    if(c.type==='replace-cell'){m.visit();setCell(c.row,c.column,c.text);}
    else if(c.type==='replace-range'){const n=dense(c.values,10000);int(c.top,0,s.rows-1);int(c.left,0,s.columns-1);if(c.top+n>s.rows)fail('INPUT','Range exceeds sheet rows.');for(let r=0;r<n;r++){const row=indexed(c.values,r),cols=dense(row,100);if(c.left+cols>s.columns)fail('INPUT','Range exceeds sheet columns.');for(let col=0;col<cols;col++){m.visit();await m.step();setCell(c.top+r,c.left+col,indexed(row,col));}}}
    else if(c.type==='set-column-width')s.columnWidths[int(c.column,0,s.columns-1)]=num(c.width,0.001,10000);
    else if(c.type==='set-selected')s.selected=boolean(c.selected);
    else if(c.type==='set-print')s.print=c.print;
    else if(c.type==='set-row'){const value=record(c.metadata,['row','hidden','height']);int(value.row,0,s.rows-1);const i=s.rowMetadata.findIndex(v=>v.row===value.row);if(i<0)s.rowMetadata.push(value);else s.rowMetadata[i]=value;}
    else if(c.type==='unmerge')s.merges.splice(int(c.index,0,s.merges.length-1),1);
    else {choice(c.delta,[-1,1]);const i=model.sheets.indexOf(s),to=i+c.delta;if(to<0||to>=model.sheets.length)fail('INPUT','Sheet move is outside the sheet order.');[model.sheets[i],model.sheets[to]]=[model.sheets[to],model.sheets[i]];}
    for(const sh of model.sheets)for(const cell of sh.cells){m.visit();await m.step();if(cell.formula?.cached!==null&&cell.formula)cell.formula.state='unverified';}
  }
  async function apply(command,rawOptions={}){
    ensure();const captured=current,local=revision,o=optionsGuard(rawOptions,current.bundle.model,revision,expected),outer=o.signal;localGuard(captured,local,outer,true);controller=new AbortController();const inner=controller;const relay=()=>inner.abort(reason.call(outer));if(outer)EventTarget.prototype.addEventListener.call(outer,'abort',relay,{once:true});busy=true;
    let candidate,prepared,disposePrepared,cleanupStarted=false,firstCleanup;
    const assert=()=>{localGuard(captured,local,inner.signal);budget();localGuard(captured,local,inner.signal);};
    const m=meter(inner.signal,cfg.yieldControl??pause,assert);
    const cleanup=async()=>{if(!cleanupStarted){cleanupStarted=true;firstCleanup=Promise.resolve().then(()=>Reflect.apply(disposePrepared,prepared,[]));firstCleanup.catch(()=>{});}await firstCleanup;};
    const run=async()=>{
      try{
        pending=combine({resourceBytes:48*MiB+captured.bundle.usage.resourceBytes,resourceCount:3},prep);budget();m.verify();await m.step(true);
        const next=await cloneModel(captured.bundle.model,m);await edit(next,command,m);m.verify();
        candidate=await validateSpreadsheetModel(next,{signal:inner.signal,workLimit:SPREADSHEET_LIMITS.workVisits-m.visits,yieldControl:async info=>{const first=(cfg.yieldControl??pause)(info);await first;assert();},getUsage:()=>{assert();return {snapshot:canonical(),live:combine(retained(),external(),budgetUsage(captured.bundle.usage),prep)};}});m.visit(candidate.usage.workVisits);assert();
        if(cfg.prepareCandidate){const first=cfg.prepareCandidate(candidate.model,{signal:inner.signal,revision:local,usage:{...pending}});prepared=await first;let d;try{d=prepared&&Object.getOwnPropertyDescriptor(prepared,'dispose');}catch(cause){fence={cause,prepared,candidate};fail('CLEANUP','Preparation ownership inspection failed.');}if(d?.enumerable&&Object.hasOwn(d,'value')&&typeof d.value==='function')disposePrepared=d.value;if(!disposePrepared){fence={prepared,candidate};fail('CLEANUP','Preparation returned no owned disposer.');}assert();await cleanup();assert();}
        const all=entries();if(all.length+1>6||all.reduce((n,e)=>n+e.bundle.usage.resourceBytes,0)+candidate.usage.resourceBytes>48*MiB)fail('LIMIT','Six model versions share48MiB; clear history explicitly.');if(revision===100000)fail('LIMIT','Draft revision limit reached.');budget();assert();
        const entry=await makeEntry(candidate,m);assert();owned.add(entry);past.push(current);current=entry;future=[];revision++;candidate=null;tidy();
      }catch(error){check(inner.signal);throw error;}
      finally{
        if(disposePrepared&&!cleanupStarted){try{await cleanup();}catch(cause){fence={cause,prepared,candidate,firstCleanup};}}
        else if(cleanupStarted){try{await firstCleanup;}catch(cause){fence={cause,prepared,candidate,firstCleanup};}}
        if(!fence){candidate?.dispose();pending=usage();}
        if(outer)EventTarget.prototype.removeEventListener.call(outer,'abort',relay);controller=null;busy=false;
        if(fence)fail('CLEANUP','Spreadsheet cleanup failed; ownership remains charged.');
      }
      return snapshot();
    };
    firstJob=run();firstJob.catch(()=>{});return firstJob;
  }
  function history(kind,rawOptions={}){ensure();const captured=current,local=revision,o=optionsGuard(rawOptions,current.bundle.model,revision,expected);localGuard(captured,local,o.signal,true);const from=kind==='undo'?past:future,to=kind==='undo'?future:past;if(!from.length)return snapshot();if(revision===100000)fail('LIMIT','Draft revision limit reached.');budget();localGuard(captured,local,o.signal,true);to.push(current);current=from.pop();revision++;return snapshot();}
  function lookup(id){const value=current.index.get(id??current.bundle.model.sheets[0]?.id);if(!value)fail('INPUT','Unknown sheet identity.');return value;}
  return {
    model(){if(closed)fail('CLOSED','The draft is closed.');return current.bundle.model;},source(){if(closed)fail('CLOSED','The draft is closed.');return baseline.bundle.model;},snapshot,apply,
    undo:o=>history('undo',o),redo:o=>history('redo',o),clearUndo(){ensure();past=[];future=[];tidy();return snapshot();},
    view(raw={}){ensure();const o=record(raw,['sheetId','row','column']),{sheet,cells}=lookup(o.sheetId),r=int(o.row??0,0,sheet.rows-1),c=int(o.column??0,0,sheet.columns-1);let remaining=16384;const values=[];for(let row=r;row<Math.min(sheet.rows,r+40);row++)for(let column=c;column<Math.min(sheet.columns,c+12);column++){const cell=cells.get(cellKey(row,column)),projection=window(cell?.display??'',0,remaining);remaining-=projection.text.length;values.push({row,column,present:!!cell,type:cell?.raw.type??null,formula:!!cell?.formula,projection});}return {sheetId:sheet.id,row:r,column:c,rows:Math.min(40,sheet.rows-r),columns:Math.min(12,sheet.columns-c),cells:values,textUnits:16384-remaining};},
    cellView(raw){ensure();const o=record(raw,['sheetId','row','column','field','offset']),{sheet,cells}=lookup(o.sheetId);int(o.row,0,sheet.rows-1);int(o.column,0,sheet.columns-1);choice(o.field,['text','display','raw','formula','cached']);const c=cells.get(cellKey(o.row,o.column));let value='';if(c){value=o.field==='raw'?c.raw.value:o.field==='formula'?c.formula?.text:o.field==='cached'?c.formula?.cached?.value:c[o.field];}const text=value==null?'':String(value);return {present:!!c,field:o.field,...window(text,o.offset??0,16384)};},
    async drained(){await firstJob?.catch(()=>{});if(fence)fail('CLEANUP','Spreadsheet cleanup remains blocked.');},
    dispose(){if(disposal)return disposal;closed=true;controller?.abort(new DOMException('Spreadsheet draft disposed.','AbortError'));disposal=(async()=>{await firstJob?.catch(()=>{});if(fence)fail('CLEANUP','Spreadsheet cleanup remains blocked.');for(const e of owned)e.bundle.dispose();owned.clear();past=[];future=[];current=baseline=null;pending=usage();})();disposal.catch(()=>{});return disposal;}
  };
}
