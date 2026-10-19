import { validateDocumentModel, DOCUMENT_LIMITS } from './document-model.js';
import { imageDimensions } from './composition-state.js';

const MiB=1024*1024, encoder=new TextEncoder(), apply=Reflect.apply;
const throwIfAborted=AbortSignal.prototype.throwIfAborted;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const fill=Uint8Array.prototype.fill,set=Uint8Array.prototype.set;
const typed=Object.getPrototypeOf(Uint8Array.prototype),tag=Object.getOwnPropertyDescriptor(typed,Symbol.toStringTag).get;
const byteLength=Object.getOwnPropertyDescriptor(typed,'byteLength').get,byteOffset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get,byteBuffer=Object.getOwnPropertyDescriptor(typed,'buffer').get;
const arrayBufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const directions=['auto','ltr','rtl'], styles=['regular','bold','italic','boldItalic','code'];
function fail(code,message){const e=new Error(message);e.code=`DOCUMENT_DRAFT_${code}`;throw e;}
function exact(value,keys){
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INPUT','Expected plain own data.');
  const result={};for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!keys.includes(key)||!d.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Invalid own data field.');result[key]=d.value;}return result;
}
function field(value,key){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))fail('INPUT','Expected a scalar snapshot field.');return d.value;}
function amount(value){if(!Number.isSafeInteger(value)||value<0)fail('INPUT','Expected a finite nonnegative byte/count value.');return value;}
function sum(...values){let n=0;for(const v of values){n+=amount(v);if(!Number.isSafeInteger(n))fail('LIMIT','Budget arithmetic overflow.');}return n;}
function usage(value={}){const v=exact(value,['resourceBytes','resourceCount','artifactBytes','expandedBytes','expandedCount']);return {resourceBytes:amount(v.resourceBytes??0),resourceCount:amount(v.resourceCount??0),artifactBytes:amount(v.artifactBytes??0),expandedBytes:amount(v.expandedBytes??0),expandedCount:amount(v.expandedCount??0)};}
function combinedUsage(a,b){a=usage(a);b=usage(b);const result={};for(const key of Object.keys(a))result[key]=sum(a[key],b[key]);return result;}
function owner(value){return {taskId:field(value,'taskId'),revision:amount(field(value,'revision')),generation:amount(field(value,'generation'))};}
const same=(a,b)=>a.taskId===b.taskId&&a.revision===b.revision&&a.generation===b.generation;
function signal(value){if(value!==undefined){try{aborted.call(value);}catch{fail('INPUT','Expected an actual AbortSignal.');}throwIfAborted.call(value);}return value;}
const check=value=>{if(value)throwIfAborted.call(value);};
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const key of Object.keys(value))freeze(value[key]);Object.freeze(value);}return value;}
function byteView(value){let buffer,offset=0,size;try{if(tag.call(value)==='Uint8Array'){buffer=byteBuffer.call(value);offset=byteOffset.call(value);size=byteLength.call(value);arrayBufferLength.call(buffer);}else{size=arrayBufferLength.call(value);buffer=value;}}catch{fail('INPUT','Use actual nonshared Uint8Array or ArrayBuffer image bytes.');}return new Uint8Array(buffer,offset,size);}
function copyView(view){const bytes=new Uint8Array(view.byteLength);set.call(bytes,view);return bytes;}
function dense(value,max){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail('INPUT','Expected a dense standard array.');
  const n=Object.getOwnPropertyDescriptor(value,'length').value;if(n>max||Reflect.ownKeys(value).length!==n+1)fail('INPUT','Array shape exceeds its finite bound.');
  const result=new Array(n);for(let i=0;i<n;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Expected indexed own array data.');result[i]=d.value;}return result;
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function assetRecords(raw,named=false){
  let total=0;const seen=new Set();return dense(raw,48).map(item=>{
    const a=exact(item,[named?'name':'id','type','bytes','width','height']);const key=named?a.name:a.id;
    if(typeof key!=='string'||(named?!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(?:png|jpg|jpeg)$/.test(key)||key.length>100:! /^[A-Za-z0-9-]{1,100}$/.test(key)))fail('INPUT','Invalid image identity/name.');
    const identity=named?key.toLowerCase():key;if(seen.has(identity))fail('INPUT','Duplicate image identity/name.');seen.add(identity);
    enumeration(a.type,['image/png','image/jpeg']);if(named&&(key.endsWith('.png')?a.type!=='image/png':a.type!=='image/jpeg'))fail('INPUT','Image extension and MIME disagree.');
    const bytes=byteView(a.bytes);total=sum(total,bytes.length);if(!bytes.length||total>16*MiB)fail('LIMIT','Named/current images exceed 16 MiB.');
    const size=imageDimensions(bytes,a.type);if(size.width!==a.width||size.height!==a.height||a.width*a.height>16000000)fail('INPUT','Image dimensions disagree.');return {...a,bytes};
  });
}
function integer(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)fail('INPUT','Index/value is out of range.');return value;}
function number(value,min,max){if(!Number.isFinite(value)||value<min||value>max)fail('INPUT','Geometry is out of range.');return value;}
function enumeration(value,values){if(!values.includes(value))fail('INPUT','Unsupported finite choice.');return value;}
function boundary(text,index){integer(index,0,text.length);if(index>0&&index<text.length&&/[\ud800-\udbff]/.test(text[index-1])&&/[\udc00-\udfff]/.test(text[index]))fail('INPUT','A range cannot cut a Unicode scalar.');}

// Known JS ZIP/XML expansion is resource memory, not excluded native heap.
// This helper reserves no disconnected pool and never calls session.transfer().
export function assertDocumentWorkspaceBudget(snapshot,live={},extra={}){
  const a=usage(live),b=usage(extra);
  const resources=sum(field(snapshot,'resourceBytes'),a.resourceBytes,a.expandedBytes,b.resourceBytes,b.expandedBytes);
  const count=sum(field(snapshot,'resourceCount'),a.resourceCount,a.expandedCount,b.resourceCount,b.expandedCount);
  const retained=sum(field(snapshot,'retainedBytes'),a.resourceBytes,a.expandedBytes,a.artifactBytes,b.resourceBytes,b.expandedBytes,b.artifactBytes);
  if(resources>96*MiB||count>128||retained>512*MiB)fail('LIMIT','This operation and retained task exceed the joint 96 MiB/128-resource or 512 MiB limit.');
  return {resourceBytes:resources,resourceCount:count,retainedBytes:retained,remainingResourceBytes:96*MiB-resources,remainingResourceCount:128-count,remainingRetainedBytes:512*MiB-retained};
}

function sample(runs){let value='';for(let i=0;i<runs.length&&value.length<120;i++)value+=runs[i].text.substring(0,120-value.length);return value;}
function project(text,start,count){
  boundary(text,start);let end=Math.min(text.length,start+count);if(end<text.length&&/[\ud800-\udbff]/.test(text[end-1])&&/[\udc00-\udfff]/.test(text[end]))end--;
  let display='';const sourceOffsets=[start];
  for(let i=start;i<end;){const c=text[i];if(c==='\r'){i+=text[i+1]==='\n'&&i+1<end?2:1;display+='\n';sourceOffsets.push(i);}else{display+=c;i++;sourceOffsets.push(i);}}
  return {text:display,sourceStart:start,sourceEnd:end,sourceOffsets};
}

export function createDocumentDraft(bundle,settings,environment={}){
  const config=exact(settings,['owner','sourceName','sourceType','sessionUsage']);
  const env=exact(environment,['normalizeImage','getExternalUsage']),normalizeImage=env.normalizeImage,getExternalUsage=env.getExternalUsage??(()=>({}));
  if(normalizeImage!==undefined&&typeof normalizeImage!=='function')fail('INPUT','Invalid trusted image normalizer.');
  if(typeof getExternalUsage!=='function')fail('INPUT','Invalid trusted external usage accessor.');
  if(typeof config.sessionUsage!=='function'||typeof config.sourceName!=='string'||config.sourceName.length>260||!['text/markdown','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(config.sourceType))fail('INPUT','Invalid trusted draft configuration.');
  let expected=owner(config.owner),closed=false,busy=false,revision=0,serial=0,imageSerial=0,cleanupFence=null,pendingBytes=0,pendingCount=0,sourceSerial=0,disposalPromise=null,firstBundleDisposal;
  const sourceSize=bundle.sourceBytes.byteLength,baseSize=bundle.modelBytes.byteLength;
  let assetBytes=bundle.assets.reduce((n,a)=>sum(n,a.bytes.byteLength),0);
  if(baseSize>16*MiB||assetBytes>16*MiB||bundle.assets.length>48)fail('LIMIT','Draft model or task-lifetime image budget exceeded.');
  const getSession=()=>config.sessionUsage();
  assertDocumentWorkspaceBudget(getSession(),combinedUsage({resourceBytes:baseSize+assetBytes,resourceCount:1+bundle.assets.length,artifactBytes:sourceSize},getExternalUsage()));
  const initial=freeze(validateDocumentModel(bundle.model)),assets=new Map(bundle.assets.map(a=>[a.id,Object.freeze({...a})])),assetMetadata=new Map(initial.assets.map(a=>[a.id,a])),imageReports=[],disposeBundle=bundle.dispose;
  if(typeof disposeBundle!=='function')fail('INPUT','An owned reader bundle disposer is required.');
  const baseline={model:initial,bytes:bundle.modelBytes,settings:{paper:'letter',landscape:false,margin:48},source:null,sourceRelation:'none'};
  let current=baseline,past=[],future=[];
  const sourceOwned=new Set(),digestCache=new Map();
  const owned=new Set([bundle.modelBytes]);const originalBuffers=[bundle.modelBytes,bundle.sourceBytes,...[...assets.values()].map(a=>a.bytes)];
  function active(){if(closed)fail('CLOSED','This draft is closed.');}
  function unlocked(){active();if(busy)fail('BUSY','Wait for the active model mutation to drain.');if(cleanupFence)fail('CLEANUP','Image cleanup failed. Reload this page before starting more work.');}
  function entries(){return [...new Set([baseline,current,...past,...future])];}
  function sourceRecords(){return [...new Set(entries().map(v=>v.source).filter(Boolean))];}
  function live(includePending=true){const versions=entries(),sources=sourceRecords(),buffers=new Set([bundle.sourceBytes,...sources.map(s=>s.bytes)]);return {resourceBytes:sum(assetBytes,...versions.map(v=>v.bytes.byteLength),...sources.map(s=>2*s.text.length+128*1024),digestCache.size?128*1024:0,includePending?pendingBytes:0),resourceCount:assets.size+versions.length+sources.length+(digestCache.size?1:0)+(includePending?pendingCount:0),artifactBytes:sum(...[...buffers].map(b=>b.byteLength))};}
  function budget(extra={},includePending=true){return assertDocumentWorkspaceBudget(getSession(),combinedUsage(live(includePending),getExternalUsage()),extra);}
  function assertOwner(captured=expected){if(!same(captured,owner(getSession()))||!same(captured,expected))fail('STALE','The canonical owner changed.');}
  function tidy(){const keep=new Set(entries().map(v=>v.bytes));for(const bytes of owned)if(!keep.has(bytes)){fill.call(bytes,0);owned.delete(bytes);}const sources=new Set(sourceRecords().map(s=>s.bytes));for(const bytes of sourceOwned)if(!sources.has(bytes)){fill.call(bytes,0);sourceOwned.delete(bytes);}}
  function snapshot(){active();return {revision,owner:{...expected},sourceName:config.sourceName,sourceType:config.sourceType,retainedModelCount:entries().length,retainedModelBytes:sum(...entries().map(v=>v.bytes.length)),lifetimeAssetCount:assets.size,lifetimeAssetBytes:assetBytes,sourceRevision:current.source?.revision??null,sourceRelation:current.sourceRelation,blockCount:current.model.blocks.length,modelBytes:current.bytes.byteLength,...live(),canUndo:past.length>0,canRedo:future.length>0,dirty:current!==baseline,paper:{...current.settings},busy,cleanupBlocked:!!cleanupFence,imageReports:imageReports.map(r=>({...r}))};}
  function find(model,id){const index=model.blocks.findIndex(b=>b.id===id);if(index<0)fail('INPUT','Unknown block ID.');return {block:model.blocks[index],index};}
  function paragraph(model,target){let {block}=find(model,target.blockId);if(target.cell!==undefined){const cell=exact(target.cell,['row','column']);if(block.kind!=='table')fail('INPUT','Cell target requires a table.');const row=integer(cell.row,0,block.rows.length-1),col=integer(cell.column,0,block.columnWidths.length-1);const paragraphs=block.rows[row][col].paragraphs;return {paragraphs,p:paragraphs[integer(target.paragraphIndex??0,0,paragraphs.length-1)]};}if(!block.runs)fail('INPUT','Choose a paragraph block.');return {p:block};}
  function freshId(model){const ids=new Set([...model.assets,...model.lists].map(v=>v.id));for(const b of model.blocks){ids.add(b.id);if(b.kind==='table')for(const row of b.rows)for(const cell of row)for(const p of cell.paragraphs)ids.add(p.id);}let id;do{id=`draft-${++serial}`;}while(ids.has(id));return id;}
  function declaredAsset(model,id){if(!model.assets.some(a=>a.id===id)){const metadata=assetMetadata.get(id);if(!metadata)fail('INPUT','Choose an admitted image.');model.assets.push({...metadata});}return model.assets.find(a=>a.id===id);}
  const emptyParagraph=model=>({id:freshId(model),kind:'paragraph',direction:'auto',runs:[]});
  function mutate(model,command,paper){
    const tags={
      'replace-run-range':['start','end','text'],'set-run-style':['style'],'set-run-direction':['direction'],'insert-run':['position','text','style','direction'],'remove-run':[],'split-run':['offset'],'merge-next-run':[],
      'set-paragraph-kind':['kind','level'],'set-paragraph-direction':['direction'],'insert-paragraph':['position'],'remove-paragraph':[],'move-paragraph':['delta'],
      'set-list':['ordered','id','level','value','restart'],'move-block':['delta'],'insert-block':['kind','position','assetId'],'remove-block':[],
      'set-column-width':['column','weight'],'insert-row':['row'],'remove-row':['row'],'insert-column':['column'],'remove-column':['column'],'move-row':['row','delta'],
      'set-image':['width','height','alt'],'replace-image':['assetId'],'set-paper':['paper','landscape','margin']
    };
    const tag=field(command,'type');if(!Object.hasOwn(tags,tag))fail('INPUT','Unknown edit command.');const c=exact(command,['type','target',...tags[tag]]);
    if(tag==='set-paper'){if(c.target!==undefined)fail('INPUT','Paper has no content target.');paper.paper=enumeration(c.paper,['letter','a4']);if(typeof c.landscape!=='boolean')fail('INPUT','Invalid orientation.');paper.landscape=c.landscape;paper.margin=number(c.margin,0,72);return tag;}
    const target=exact(c.target??{},['blockId','cell','paragraphIndex','runIndex']);
    if(tag==='insert-block'){
      const position=integer(c.position,0,model.blocks.length),kind=enumeration(c.kind,['paragraph','heading','code','list-item','table','image','rule','page-break']);let block;
      if(['paragraph','heading','code','list-item'].includes(kind)){block=emptyParagraph(model);block.kind=kind;if(kind==='heading')block.level=1;if(kind==='list-item'){const id=freshId({...model,blocks:[...model.blocks,block]});model.lists.push({id,ordered:true,start:1});block.list={id,level:0,value:1,restart:true};}}
      else if(kind==='table')block={id:freshId(model),kind,columnWidths:[1],rows:[[{paragraphs:[]}]]};
      else if(kind==='image'){const asset=declaredAsset(model,c.assetId);block={id:freshId(model),kind,assetId:asset.id,width:asset.width,height:asset.height};}
      else block={id:freshId(model),kind};model.blocks.splice(position,0,block);return tag;
    }
    const {block,index}=find(model,target.blockId);
    if(tag==='remove-block'){model.blocks.splice(index,1);return tag;}
    if(tag==='move-block'){const to=index+enumeration(c.delta,[-1,1]);integer(to,0,model.blocks.length-1);model.blocks.splice(index,1);model.blocks.splice(to,0,block);return tag;}
    if(tag==='set-image'||tag==='replace-image'){
      if(block.kind!=='image')fail('INPUT','Choose an image block.');if(tag==='replace-image'){declaredAsset(model,c.assetId);block.assetId=c.assetId;}else{block.width=number(c.width,0.001,14400);block.height=number(c.height,0.001,14400);if(typeof c.alt!=='string'||c.alt.length>10000)fail('INPUT','Invalid alternate text.');model.assets.find(a=>a.id===block.assetId).alt=c.alt;}return tag;
    }
    if(['set-column-width','insert-row','remove-row','insert-column','remove-column','move-row'].includes(tag)){
      if(block.kind!=='table')fail('INPUT','Choose a table.');const cols=block.columnWidths.length;
      if(tag==='set-column-width')block.columnWidths[integer(c.column,0,cols-1)]=number(c.weight,0.001,1000000);
      else if(tag==='insert-row'){integer(c.row,0,block.rows.length);block.rows.splice(c.row,0,Array.from({length:cols},()=>({paragraphs:[]})));}
      else if(tag==='remove-row')block.rows.splice(integer(c.row,0,block.rows.length-1),1);
      else if(tag==='move-row'){const row=integer(c.row,0,block.rows.length-1),to=row+enumeration(c.delta,[-1,1]);integer(to,0,block.rows.length-1);const [value]=block.rows.splice(row,1);block.rows.splice(to,0,value);}
      else if(tag==='insert-column'){integer(c.column,0,cols);block.columnWidths.splice(c.column,0,1);for(const row of block.rows)row.splice(c.column,0,{paragraphs:[]});}
      else{if(cols===1)fail('INPUT','A table needs at least one column.');integer(c.column,0,cols-1);block.columnWidths.splice(c.column,1);for(const row of block.rows)row.splice(c.column,1);}return tag;
    }
    if(['insert-paragraph','remove-paragraph','move-paragraph'].includes(tag)){
      if(block.kind!=='table'||target.cell===undefined)fail('INPUT','Choose a table cell.');const cell=exact(target.cell,['row','column']),values=block.rows[integer(cell.row,0,block.rows.length-1)][integer(cell.column,0,block.columnWidths.length-1)].paragraphs;
      if(tag==='insert-paragraph')values.splice(integer(c.position,0,values.length),0,emptyParagraph(model));else{const at=integer(target.paragraphIndex,0,values.length-1);if(tag==='remove-paragraph')values.splice(at,1);else{const to=at+enumeration(c.delta,[-1,1]);integer(to,0,values.length-1);const [value]=values.splice(at,1);values.splice(to,0,value);}}return tag;
    }
    const {p}=paragraph(model,target);
    if(tag==='set-paragraph-direction'){p.direction=enumeration(c.direction,directions);return tag;}
    if(tag==='set-paragraph-kind'){p.kind=enumeration(c.kind,['paragraph','heading','code']);delete p.list;delete p.level;if(p.kind==='heading')p.level=integer(c.level,1,6);return tag;}
    if(tag==='set-list'){if(typeof c.ordered!=='boolean'||typeof c.restart!=='boolean')fail('INPUT','Invalid list flags.');let definition=c.id?model.lists.find(l=>l.id===c.id):null;if(c.id&&!definition)fail('INPUT','Unknown list.');if(definition&&definition.ordered!==c.ordered)fail('INPUT','A list identity cannot silently change its ordered kind.');if(!definition){definition={id:freshId(model),ordered:c.ordered,start:integer(c.value,1,1000000)};model.lists.push(definition);}p.kind='list-item';delete p.level;p.list={id:definition.id,level:integer(c.level,0,8),value:integer(c.value,1,1000000),restart:c.restart};return tag;}
    if(tag==='insert-run'){if(typeof c.text!=='string'||c.text.length>65536)fail('INPUT','Inserted text exceeds its bound.');p.runs.splice(integer(c.position,0,p.runs.length),0,{text:c.text,style:enumeration(c.style,styles),direction:enumeration(c.direction,directions)});return tag;}
    const at=integer(target.runIndex,0,p.runs.length-1),run=p.runs[at];
    if(tag==='replace-run-range'){if(typeof c.text!=='string'||c.text.length>65536)fail('INPUT','Inserted text exceeds its bound.');boundary(run.text,c.start);boundary(run.text,c.end);if(c.end<c.start)fail('INPUT','Reversed source range.');run.text=run.text.substring(0,c.start)+c.text+run.text.substring(c.end);}
    else if(tag==='set-run-style')run.style=enumeration(c.style,styles);
    else if(tag==='set-run-direction')run.direction=enumeration(c.direction,directions);
    else if(tag==='remove-run')p.runs.splice(at,1);
    else if(tag==='split-run'){boundary(run.text,c.offset);p.runs.splice(at,1,{...run,text:run.text.substring(0,c.offset)},{...run,text:run.text.substring(c.offset)});}
    else{const next=p.runs[at+1];if(!next||next.style!==run.style||next.direction!==run.direction)fail('INPUT','Only equal run style and direction can merge.');run.text+=next.text;p.runs.splice(at+1,1);}
    return tag;
  }
  async function sourceTransaction(rawCandidate,rawOptions,initializing=false){
    unlocked();busy=true;
    const capturedRevision=revision,capturedOwner={...expected};
    let abortSignal,input,cleanup,firstCleanup,cleanupStarted=false,error,caught=false,result,nextSource,nextBytes,newAssetBytes=0,newImageSerial=imageSerial;
    const temporaries=new Set(),newAssets=new Map(),newMetadata=new Map(),hashes=new Map(digestCache);
    let hashWork=0,compareWork=0,steps=0;
    const liveCheck=()=>{check(abortSignal);assertOwner(capturedOwner);if(revision!==capturedRevision)fail('STALE','The local source revision changed.');budget();};
    async function cooperate(force=false){if(force||++steps>=128){steps=0;await pause();liveCheck();}}
    async function copy(bytes){const result=new Uint8Array(bytes.length);temporaries.add(result);for(let at=0;at<bytes.length;at+=16384){set.call(result,bytes.subarray(at,at+16384),at);await cooperate(true);}return result;}
    async function hash(bytes){hashWork=sum(hashWork,bytes.length);if(hashWork>(initializing?32:48)*MiB)fail('LIMIT','Source image hashing work exceeds its finite budget.');liveCheck();const first=crypto.subtle.digest('SHA-256',bytes);const digest=new Uint8Array(await first);liveCheck();return [...digest].map(v=>v.toString(16).padStart(2,'0')).join('');}
    async function equal(a,b){if(a.length!==b.length)return false;for(let at=0;at<a.length;at+=16384){const end=Math.min(a.length,at+16384);compareWork=sum(compareWork,end-at);if(compareWork>(initializing?32:48)*MiB)fail('LIMIT','Source image comparison work exceeds its finite budget.');for(let i=at;i<end;i++)if(a[i]!==b[i])return false;await cooperate(true);}return true;}
    async function measuredModel(value){
      let bytes=0,nodes=0,characters=0;
      const add=n=>{bytes=sum(bytes,n);if(bytes>16*MiB)fail('LIMIT','Candidate model serialization exceeds16MiB.');};
      async function string(text){add(2);for(let i=0;i<text.length;){const cp=text.codePointAt(i);if(cp>=0xd800&&cp<=0xdfff)fail('INPUT','Unpaired model Unicode.');add(cp===34||cp===92?2:cp<32?([8,9,10,12,13].includes(cp)?2:6):cp<128?1:cp<2048?2:cp<65536?3:4);i+=cp>65535?2:1;if(++characters>=16384){characters=0;await cooperate(true);}}}
      async function visit(v,depth){
        if(++nodes>1000000||depth>32)fail('LIMIT','Model preflight work/depth exceeds its finite bound.');await cooperate();
        if(typeof v==='string'){await string(v);return;}if(typeof v==='number'){if(!Number.isFinite(v))fail('INPUT','Nonfinite model number.');add(String(v).length);return;}if(typeof v==='boolean'){add(v?4:5);return;}if(v===null){add(4);return;}
        if(!v||typeof v!=='object')fail('INPUT','Model preflight expects finite own JSON data.');
        if(Array.isArray(v)){
          if(Object.getPrototypeOf(v)!==Array.prototype)fail('INPUT','Model arrays must be standard.');const n=Object.getOwnPropertyDescriptor(v,'length').value;if(n>200000||Reflect.ownKeys(v).length!==n+1)fail('INPUT','Model array shape is invalid.');add(2+Math.max(0,n-1));
          for(let i=0;i<n;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('INPUT','Model arrays must be dense own data.');await visit(d.value,depth+1);}return;
        }
        if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('INPUT','Model objects must be plain.');const keys=Reflect.ownKeys(v);if(keys.length>32)fail('INPUT','Too many model object fields.');add(2+Math.max(0,keys.length-1));
        for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||key.length>64||key==='toJSON'||!d.enumerable||!Object.hasOwn(d,'value'))fail('INPUT','Model fields must be own JSON data.');await string(key);add(1);await visit(d.value,depth+1);}
      }
      await visit(value,0);return bytes;
    }
    async function drainInput(){if(!cleanupStarted){cleanupStarted=true;try{firstCleanup=Promise.resolve(apply(cleanup,input,[]));}catch(e){firstCleanup=Promise.reject(e);}firstCleanup.catch(()=>{});}await firstCleanup;}
    try{
      const options=exact(rawOptions,['signal','expectedModel','expectedRevision','expectedOwner']);abortSignal=signal(options.signal);assertOwner(capturedOwner);
      if(options.expectedModel!==current.model||options.expectedRevision!==revision||!same(owner(options.expectedOwner),expected))fail('STALE','Source work was not captured from this exact current model/owner/revision.');
      if(!['text/markdown','text/plain'].includes(config.sourceType))fail('INPUT','Word source is not Markdown.');
      if(initializing&&(current!==baseline||revision!==0||past.length||future.length||baseline.source))fail('INPUT','Initial Markdown binding is valid only once at the unchanged baseline.');
      if(!initializing&&!baseline.source)fail('INPUT','Initialize the original Markdown source before applying revisions.');
      if(!initializing&&(entries().length>=6||sourceSerial>=100000))fail('LIMIT','Source/history capacity is full. Explicitly clear history or start a new task.');
      const c=exact(rawCandidate,initializing?['kind','localAssets']:['kind','bundle','localAssets','output']);
      const kind=enumeration(c.kind,initializing?['initial']:['reader','serialized']);if(kind==='reader'&&c.output!==undefined||kind==='serialized'&&(c.bundle!==undefined||c.localAssets!==undefined))fail('INPUT','Source candidate fields do not match its kind.');let working,sourceView,named,records,serializedImages;
      if(kind==='initial'){working=baseline.model;sourceView=byteView(bundle.sourceBytes);records=assetRecords([...assets.values()]);named=assetRecords(c.localAssets??[],true);}
      else{
        input=kind==='reader'?c.bundle:c.output;const d=input&&Object.getOwnPropertyDescriptor(input,'dispose');if(d&&Object.hasOwn(d,'value')&&typeof d.value==='function')cleanup=d.value;
        if(!cleanup)fail('INPUT','Source candidates require a captured owned disposer.');
        if(kind==='reader'){
          const b=exact(input,['model','modelBytes','sourceBytes','assets','report','usage','dispose']);sourceView=byteView(b.sourceBytes);records=assetRecords(b.assets);named=assetRecords(c.localAssets??[],true);working=b.model;
        }else{
          const o=exact(input,['text','bytes','type','images','report','usage','dispose']);if(o.type!=='text/markdown'||typeof o.text!=='string'||o.text.length>8*MiB)fail('INPUT','Expected owned Markdown output.');
          sourceView=byteView(o.bytes);serializedImages=dense(o.images,48).map(item=>exact(item,['id','name','type','bytes','width','height']));
          named=assetRecords(serializedImages.map(a=>({name:a.name,type:a.type,bytes:a.bytes,width:a.width,height:a.height})),true);records=[];working=current.model;
        }
        const report=dense(input.report,100);for(const item of report){const r=exact(item,['code','blockId']);if(typeof r.code!=='string'||!/^markdown-[a-z-]{1,64}$/.test(r.code)||r.blockId!==undefined&&(typeof r.blockId!=='string'||r.blockId.length>100))fail('INPUT','Invalid finite source report.');}
      }
      if(sourceView.length>8*MiB)fail('LIMIT','Markdown source exceeds eight MiB.');
      let modelSize=current.bytes.length;
      if(kind==='reader'){
        const declared=byteView(input.modelBytes).length;if(declared>16*MiB)fail('LIMIT','Source model exceeds sixteen MiB.');
        // Bounded own-data byte counting precedes model copies, even if a caller changed its size record.
        budget({resourceBytes:4*MiB,resourceCount:4},false);pendingBytes=4*MiB;pendingCount=4;modelSize=await measuredModel(working);
        if(modelSize!==declared)fail('INPUT','Reader model bytes do not match its measured own-data length.');
      }
      const A=sum(...named.map(a=>a.bytes.length)),P=kind==='initial'?assetBytes:sum(...records.map(a=>a.bytes.length)),B=sourceView.length,S=Math.min(16*MiB,modelSize+2*MiB);
      const peak=initializing?2*B+2*Math.max(A,P)+256*1024:3*S+3*B+3*Math.max(A,P)+256*1024;
      budget({resourceBytes:peak,resourceCount:initializing?6:56},false);pendingBytes=peak;pendingCount=initializing?6:56;
      await cooperate(true);const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(sourceView);if(text.length>8*MiB)fail('LIMIT','Decoded source exceeds its finite bound.');
      if(kind==='serialized'&&text!==input.text)fail('INPUT','Serialized source bytes and text disagree.');
      const sourceCopy=initializing?bundle.sourceBytes:await copy(sourceView);liveCheck();
      if(kind==='serialized')nextBytes=await copy(current.bytes);
      const candidateModel=kind==='reader'?validateDocumentModel(working,{signal:{throwIfAborted:()=>check(abortSignal)}}):working;
      const pool=new Map(assets),metadata=new Map(assetMetadata),mapping=new Map();
      if(kind!=='serialized'){
        for(const a of assets.values()){if(!hashes.has(a.id))hashes.set(a.id,await hash(a.bytes));await cooperate();}
        const candidateIds=new Set(candidateModel.assets.map(a=>a.id));if(records.length!==candidateIds.size)fail('INPUT','Reader image records do not match model metadata.');
        for(const record of records){
          if(!candidateIds.has(record.id))fail('INPUT','Unexpected reader image ID.');const meta=candidateModel.assets.find(a=>a.id===record.id);if(meta.type!==record.type||meta.width!==record.width||meta.height!==record.height)fail('INPUT','Reader image metadata disagree.');
          if(initializing){mapping.set(record.id,record.id);continue;}
          const bytes=await copy(record.bytes),digest=await hash(bytes);let id;
          for(const [priorId,prior] of pool){const m=metadata.get(priorId);if(prior.type===meta.type&&prior.width===meta.width&&prior.height===meta.height&&m.alt===meta.alt&&hashes.get(priorId)===digest&&await equal(prior.bytes,bytes)){id=priorId;break;}}
          if(!id){
            if(pool.size>=48||assetBytes+newAssetBytes+bytes.length>16*MiB)fail('LIMIT','Task-lifetime images exceed48 IDs/16MiB.');
            // Reader structural IDs are regenerated below; pool/reader assets alone constrain this ID.
            do{id=`draft-image-${++newImageSerial}`;}while(pool.has(id)||candidateIds.has(id));
            const a=Object.freeze({id,type:meta.type,width:meta.width,height:meta.height,bytes}),m=freeze({...meta,id});pool.set(id,a);metadata.set(id,m);hashes.set(id,digest);newAssets.set(id,a);newMetadata.set(id,m);newAssetBytes+=bytes.length;
          }else{fill.call(bytes,0);temporaries.delete(bytes);}mapping.set(record.id,id);
        }
      }
      // Name bindings are byte providers only. Model alternate text remains per asset.
      const bindings=[],matched=new Set();
      for(let index=0;index<named.length;index++){
        const name=named[index],temporary=await copy(name.bytes),digest=await hash(temporary);let id;
        if(kind==='serialized'){
          id=serializedImages[index].id;const a=assets.get(id);if(!a||!current.model.assets.some(m=>m.id===id)||a.type!==name.type||a.width!==name.width||a.height!==name.height||!await equal(a.bytes,temporary))fail('INPUT','Serialized local image does not belong to the captured current model.');
        }else{
          for(const record of [...records].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){const finalId=mapping.get(record.id),a=pool.get(finalId);if(a.type===name.type&&a.width===name.width&&a.height===name.height&&hashes.get(finalId)===digest&&await equal(a.bytes,temporary)){id=finalId;break;}}
          if(!id)fail('INPUT','A named source image has no promoted owned byte provider.');
        }
        bindings.push(Object.freeze({name:name.name,id}));matched.add(id);fill.call(temporary,0);temporaries.delete(temporary);await cooperate();
      }
      // Every promoted byte identity must be supplied; identical-byte aliases may share a provider.
      if(kind!=='serialized')for(const record of records){const a=pool.get(mapping.get(record.id));let found=matched.has(a.id);if(!found)for(const id of matched){const b=pool.get(id);if(a.type===b.type&&a.width===b.width&&a.height===b.height&&hashes.get(a.id)===hashes.get(b.id)&&await equal(a.bytes,b.bytes)){found=true;break;}}if(!found)fail('INPUT','A promoted image is missing its exact original local name.');await cooperate();}
      if(kind==='reader'){
        // Fresh structural IDs prevent repeated reader md-N IDs colliding with the lifetime pool.
        const ids=new Set(pool.keys()),remap=new Map();let n=0;const idFor=id=>{let next;do{next=`source-${sourceSerial+1}-${++n}`;}while(ids.has(next));ids.add(next);remap.set(id,next);return next;};
        for(const l of candidateModel.lists)l.id=idFor(l.id);
        for(const b of candidateModel.blocks){const old=b.id;b.id=idFor(old);if(b.list)b.list.id=remap.get(b.list.id);if(b.assetId)b.assetId=mapping.get(b.assetId);if(b.kind==='table')for(const row of b.rows)for(const cell of row)for(const p of cell.paragraphs){p.id=idFor(p.id);if(p.list)p.list.id=remap.get(p.list.id);await cooperate();}await cooperate();}
        for(const warning of candidateModel.warnings)if(warning.blockId)warning.blockId=remap.get(warning.blockId);
        const seen=new Set();candidateModel.assets=candidateModel.assets.flatMap(a=>{const id=mapping.get(a.id);if(seen.has(id))return [];seen.add(id);return [{...a,id}];});
        const validated=validateDocumentModel(candidateModel,{signal:{throwIfAborted:()=>check(abortSignal)}});nextBytes=encoder.encode(JSON.stringify(validated));temporaries.add(nextBytes);if(nextBytes.length>S)fail('LIMIT','Remapped model exceeds reserved capacity.');working=freeze(validated);
      }
      nextSource=Object.freeze({revision:initializing?0:sourceSerial+1,text,bytes:sourceCopy,names:Object.freeze(bindings)});
      const sourceSet=new Set([...sourceRecords(),nextSource]);if(sourceSet.size>6||sum(...[...sourceSet].map(s=>s.bytes.length))>48*MiB)fail('LIMIT','Retained source versions exceed six/48MiB.');
      if(nextBytes&&sum(nextBytes.length,...entries().map(v=>v.bytes.length))>48*MiB)fail('LIMIT','Retained model versions exceed48MiB.');
      if(!initializing)await drainInput();liveCheck();await cooperate(true);
      const finalModelBytes=nextBytes?.length??0,cacheExtra=digestCache.size?0:hashes.size?128*1024:0;
      budget({resourceBytes:sum(finalModelBytes,newAssetBytes,2*text.length,128*1024,cacheExtra),resourceCount:(initializing?1:2)+newAssets.size+(cacheExtra?1:0),artifactBytes:initializing?0:sourceCopy.length},false);
      // All cleanup and ownership checks have completed; publication has no await/callback.
      for(const [id,a] of newAssets){assets.set(id,a);assetMetadata.set(id,newMetadata.get(id));temporaries.delete(a.bytes);}assetBytes+=newAssetBytes;imageSerial=newImageSerial;
      for(const [id,digest] of hashes)digestCache.set(id,digest);
      if(initializing){baseline.source=nextSource;baseline.sourceRelation='parsed';}
      else{if(nextBytes){owned.add(nextBytes);temporaries.delete(nextBytes);}sourceOwned.add(sourceCopy);temporaries.delete(sourceCopy);past.push(current);current={model:working,bytes:nextBytes??current.bytes,settings:{...current.settings},source:nextSource,sourceRelation:kind==='reader'?'parsed':'serialized'};future=[];sourceSerial++;revision++;tidy();}
      pendingBytes=0;pendingCount=0;result={...snapshot(),busy:false};
    }catch(e){caught=true;error=e;}
    finally{
      if(cleanup&&!cleanupStarted||cleanupStarted){try{await drainInput();}catch(cause){cleanupFence={cause,input,firstCleanup,temporaries,newAssets,nextSource};}}
      if(!cleanupFence){for(const bytes of temporaries)fill.call(bytes,0);temporaries.clear();pendingBytes=0;pendingCount=0;}busy=false;
    }
    if(cleanupFence)fail('CLEANUP','Source cleanup failed. Its ownership remains charged until page reset.');
    if(caught){check(abortSignal);throw error;}return result;
  }
  return {
    snapshot,
    initializeMarkdownSource(localAssets,options){return sourceTransaction({kind:'initial',localAssets},options,true);},
    applyMarkdownRevision(candidate,options){return sourceTransaction(candidate,options);},
    markdownSource(){active();return current.source?.text??null;},
    markdownAssets(){active();return Object.freeze((current.source?.names??[]).map(({name,id})=>{const a=assets.get(id);return Object.freeze({name,type:a.type,bytes:a.bytes,width:a.width,height:a.height});}));},
    model(){active();return current.model;},assets(){active();return Object.freeze(current.model.assets.map(a=>assets.get(a.id)));},
    view(raw={}){
      active();const o=exact(raw,['start','count','blockId','cell','paragraphIndex','runIndex','textStart','textCount']);const start=integer(o.start??0,0,current.model.blocks.length),count=integer(o.count??40,0,40);
      const result={revision,blocks:current.model.blocks.slice(start,start+count).map(b=>({id:b.id,kind:b.kind,sample:b.runs?sample(b.runs):'',...(b.kind==='table'?{rows:b.rows.length,columns:b.columnWidths.length}:{})}))};
      if(o.blockId){const {block}=find(current.model,o.blockId);if(block.runs||o.cell){const {p}=paragraph(current.model,o);const at=integer(o.runIndex??0,0,Math.max(0,p.runs.length-1));result.paragraph={id:p.id,kind:p.kind,direction:p.direction,runCount:p.runs.length,runs:p.runs.slice(at,at+20).map((r,index)=>({index:at+index,style:r.style,direction:r.direction,units:r.text.length}))};if(p.runs[at])result.window={...project(p.runs[at].text,integer(o.textStart??0,0,p.runs[at].text.length),integer(o.textCount??16384,0,16384)),style:p.runs[at].style,direction:p.runs[at].direction,runIndex:at};}
        if(block.kind==='table')result.table={rowCount:block.rows.length,columnCount:block.columnWidths.length,columnWidths:block.columnWidths.slice(0,10)};}
      return result;
    },
    async apply(command,raw={}){
      unlocked();busy=true;let candidateBytes;
      const capturedRevision=revision,capturedOwner={...expected};
      try{
        const opts=exact(raw,['signal','sessionUsage']),abortSignal=signal(opts.signal);assertOwner(capturedOwner);
        const text=Object.getOwnPropertyDescriptor(command,'text')?.value,alt=Object.getOwnPropertyDescriptor(command,'alt')?.value;
        const bound=Math.min(DOCUMENT_LIMITS.modelBytes,current.bytes.byteLength+MiB+(typeof text==='string'?text.length*6:0)+(typeof alt==='string'?alt.length*6:0));
        budget({resourceBytes:3*bound,resourceCount:3});
        if(entries().length===6)fail('LIMIT','Six retained model versions are full. Explicitly clear undo history.');
        // The first owned mutation is registered before any clone or reservation.
        await new Promise(resolve=>setTimeout(resolve,0));check(abortSignal);assertOwner(capturedOwner);budget({resourceBytes:3*bound,resourceCount:3});
        const working=validateDocumentModel(current.model,{signal:{throwIfAborted:()=>check(abortSignal)}}),paper={...current.settings};const appliedTag=mutate(working,command,paper);
        const validated=validateDocumentModel(working,{signal:{throwIfAborted:()=>check(abortSignal)}}),json=JSON.stringify(validated);candidateBytes=encoder.encode(json);
        const versions=entries();if(sum(candidateBytes.length,...versions.map(v=>v.bytes.length))>48*MiB)fail('LIMIT','Retained model versions exceed 48 MiB. Explicitly clear undo history.');
        await new Promise(resolve=>setTimeout(resolve,0));check(abortSignal);assertOwner(capturedOwner);if(revision!==capturedRevision)fail('STALE','The local revision changed.');
        budget({resourceBytes:candidateBytes.length,resourceCount:1});
        const next={model:freeze(validated),bytes:candidateBytes,settings:paper,source:current.source,sourceRelation:appliedTag==='set-paper'?current.sourceRelation:current.source?'outdated':'none'};owned.add(candidateBytes);candidateBytes=null;past.push(current);current=next;future=[];revision++;tidy();return {...snapshot(),busy:false};
      }finally{if(candidateBytes)fill.call(candidateBytes,0);busy=false;}
    },
    async replaceImageWithNewAsset(rawTarget,rawAsset,rawOptions={}){
      unlocked();busy=true;
      const capturedRevision=revision,capturedOwner={...expected};
      let abortSignal,rawCopy,candidateAsset,candidateBytes,normalized,cleanup,firstCleanup,nativeStarted=false,nativeSafe=true,result,error,caught=false;
      const fence=cause=>{if(!cleanupFence)cleanupFence={cause,normalized,cleanup,firstCleanup};};
      async function drainNormalizer(){
        if(!firstCleanup){try{firstCleanup=Promise.resolve(apply(cleanup,normalized,[]));}catch(e){firstCleanup=Promise.reject(e);}firstCleanup.catch(()=>{});}
        await firstCleanup;nativeSafe=true;
      }
      try{
        const target=exact(rawTarget,['blockId']),asset=exact(rawAsset,['type','bytes','alt']),options=exact(rawOptions,['signal']);abortSignal=signal(options.signal);
        assertOwner(capturedOwner);const original=find(current.model,target.blockId).block;if(original.kind!=='image')fail('INPUT','Choose an image block.');
        if(typeof normalizeImage!=='function')fail('INPUT','A trusted image normalizer is required.');
        enumeration(asset.type,['image/png','image/jpeg']);if(typeof asset.alt!=='string'||asset.alt.length>10000)fail('INPUT','Invalid alternate text.');
        if(assets.size>=48||assetBytes>=16*MiB)fail('LIMIT','Task-lifetime image capacity is full. Start a new task.');
        if(entries().length===6)fail('LIMIT','Six retained model versions are full. Explicitly clear undo history.');
        const source=byteView(asset.bytes),size=source.byteLength;if(!size||size>16*MiB)fail('LIMIT','Local image bytes exceed 16 MiB.');
        const dimensions=imageDimensions(source,asset.type),pixels=dimensions.width*dimensions.height;if(pixels>8000000)fail('LIMIT','New normalized images are limited to eight million pixels.');
        const maximum=16*MiB-assetBytes,bound=Math.min(16*MiB,current.bytes.byteLength+6*asset.alt.length+4096);
        if(sum(bound,...entries().map(v=>v.bytes.byteLength))>48*MiB)fail('LIMIT','Retained model versions exceed 48 MiB.');
        const peak=Math.max(sum(2*size,8*pixels,2*maximum),sum(3*bound,2*maximum));
        budget({resourceBytes:peak,resourceCount:6},false);pendingBytes=peak;pendingCount=6;
        rawCopy=copyView(source);const copiedDimensions=imageDimensions(rawCopy,asset.type);if(copiedDimensions.width!==dimensions.width||copiedDimensions.height!==dimensions.height)fail('INPUT','Image metadata changed during admission.');
        await new Promise(resolve=>setTimeout(resolve,0));check(abortSignal);assertOwner(capturedOwner);budget();
        nativeStarted=true;nativeSafe=false;
        const first=normalizeImage(rawCopy,{type:asset.type,maxOutputBytes:maximum,signal:abortSignal});normalized=await first;
        const disposer=normalized&&Object.getOwnPropertyDescriptor(normalized,'dispose');if(disposer&&Object.hasOwn(disposer,'value')&&typeof disposer.value==='function')cleanup=disposer.value;
        if(!cleanup)fail('INPUT','The trusted normalizer must return a captured owned disposer.');
        const output=exact(normalized,['type','bytes','width','height','dispose']);check(abortSignal);assertOwner(capturedOwner);budget();
        if(output.type!=='image/png')fail('INPUT','The normalized image must be PNG.');
        const outputView=byteView(output.bytes);if(!outputView.length||outputView.length>maximum)fail('LIMIT','Normalized PNG exceeds remaining lifetime bytes.');
        const actual=imageDimensions(outputView,'image/png'),sameDimensions=actual.width===dimensions.width&&actual.height===dimensions.height,swappedDimensions=actual.width===dimensions.height&&actual.height===dimensions.width;if(actual.width!==output.width||actual.height!==output.height||!sameDimensions&&!swappedDimensions||actual.width*actual.height>8000000)fail('INPUT','Decoded image dimensions disagree with its PNG.');
        candidateAsset=copyView(outputView);await drainNormalizer();fill.call(rawCopy,0);rawCopy=null;normalized=null;
        await new Promise(resolve=>setTimeout(resolve,0));check(abortSignal);assertOwner(capturedOwner);if(revision!==capturedRevision)fail('STALE','The local revision changed.');budget();
        const working=validateDocumentModel(current.model,{signal:{throwIfAborted:()=>check(abortSignal)}}),block=find(working,target.blockId).block,oldId=block.assetId;
        const usedIds=new Set(assets.keys());for(const version of entries()){for(const a of version.model.assets)usedIds.add(a.id);for(const l of version.model.lists)usedIds.add(l.id);for(const b of version.model.blocks){usedIds.add(b.id);if(b.kind==='table')for(const row of b.rows)for(const cell of row)for(const p of cell.paragraphs)usedIds.add(p.id);}}
        let nextSerial=imageSerial,id;do{id=`draft-image-${++nextSerial}`;}while(usedIds.has(id));
        const metadata={id,type:'image/png',width:actual.width,height:actual.height,alt:asset.alt};block.assetId=id;
        if(!working.blocks.some(b=>b.kind==='image'&&b.assetId===oldId))working.assets=working.assets.filter(a=>a.id!==oldId);
        working.assets.push(metadata);const validated=validateDocumentModel(working,{signal:{throwIfAborted:()=>check(abortSignal)}});candidateBytes=encoder.encode(JSON.stringify(validated));
        if(candidateBytes.length>bound||sum(candidateBytes.length,...entries().map(v=>v.bytes.length))>48*MiB)fail('LIMIT','Candidate model exceeds reserved history capacity.');
        const next={model:freeze(validated),bytes:candidateBytes,settings:{...current.settings},source:current.source,sourceRelation:current.source?'outdated':'none'},retainedAsset=Object.freeze({id,type:'image/png',width:actual.width,height:actual.height,bytes:candidateAsset}),report=Object.freeze({assetId:id,code:'local-image-normalized-to-png'});
        await new Promise(resolve=>setTimeout(resolve,0));check(abortSignal);assertOwner(capturedOwner);if(revision!==capturedRevision)fail('STALE','The local revision changed.');
        budget({resourceBytes:candidateBytes.length+candidateAsset.length,resourceCount:2},false);
        // No callback or await between publishing the owned asset and its model.
        assets.set(id,retainedAsset);assetMetadata.set(id,freeze(metadata));assetBytes+=candidateAsset.length;imageSerial=nextSerial;imageReports.push(report);owned.add(candidateBytes);past.push(current);current=next;future=[];revision++;candidateAsset=null;candidateBytes=null;pendingBytes=0;pendingCount=0;tidy();result={...snapshot(),busy:false};
      }catch(e){caught=true;error=e;if(nativeStarted&&!normalized&&e?.code==='DOCUMENT_IMAGE_NORMALIZE')nativeSafe=true;}
      finally{
        if(nativeStarted&&!nativeSafe){if(cleanup){try{await drainNormalizer();}catch(e){fence(e);}}else fence(error);}
        if(rawCopy)fill.call(rawCopy,0);if(candidateAsset)fill.call(candidateAsset,0);if(candidateBytes)fill.call(candidateBytes,0);
        if(!cleanupFence){pendingBytes=0;pendingCount=0;}busy=false;
      }
      if(cleanupFence)fail('CLEANUP','Image cleanup failed. Its reservation remains charged. Reload this page before more work.');
      if(caught){check(abortSignal);throw error;}return result;
    },
    undo(){unlocked();assertOwner();if(!past.length)return snapshot();future.push(current);current=past.pop();revision++;return snapshot();},
    redo(){unlocked();assertOwner();if(!future.length)return snapshot();past.push(current);current=future.pop();revision++;return snapshot();},
    clearUndo(){unlocked();assertOwner();past=[];future=[];tidy();return snapshot();},
    acceptOwner(before,next){unlocked();const a=owner(before),b=owner(next);if(!same(a,expected)||!same(b,owner(getSession())))fail('STALE','Only the verified adopted owner can transfer.');expected=b;return snapshot();},
    dispose(){
      if(disposalPromise)return disposalPromise;if(closed)return Promise.resolve();unlocked();busy=true;
      disposalPromise=(async()=>{try{
        // The exact captured FIRST disposer promise owns all borrowed reader bytes.
        firstBundleDisposal=apply(disposeBundle,bundle,[]);await firstBundleDisposal;
        for(const bytes of owned)fill.call(bytes,0);owned.clear();for(const bytes of sourceOwned)fill.call(bytes,0);sourceOwned.clear();
        for(const bytes of originalBuffers)fill.call(bytes,0);for(const a of assets.values())fill.call(a.bytes,0);assets.clear();digestCache.clear();
        past=[];future=[];current=null;closed=true;
      }catch(cause){cleanupFence={cause,disposalPromise,firstBundleDisposal};fail('CLEANUP','Draft disposal failed. Ownership remains charged until page reset.');}finally{busy=false;}})();
      disposalPromise.catch(()=>{});return disposalPromise;
    }
  };
}
