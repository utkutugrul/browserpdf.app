import { validateDocumentModel, DOCUMENT_LIMITS } from './document-model.js';

const MiB=1024*1024, encoder=new TextEncoder(), apply=Reflect.apply;
const throwIfAborted=AbortSignal.prototype.throwIfAborted;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const fill=Uint8Array.prototype.fill;
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
function owner(value){return {taskId:field(value,'taskId'),revision:amount(field(value,'revision')),generation:amount(field(value,'generation'))};}
const same=(a,b)=>a.taskId===b.taskId&&a.revision===b.revision&&a.generation===b.generation;
function signal(value){if(value!==undefined){try{aborted.call(value);}catch{fail('INPUT','Expected an actual AbortSignal.');}throwIfAborted.call(value);}return value;}
const check=value=>{if(value)throwIfAborted.call(value);};
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const key of Object.keys(value))freeze(value[key]);Object.freeze(value);}return value;}
const clone=value=>JSON.parse(JSON.stringify(value));
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

export function createDocumentDraft(bundle,settings){
  const config=exact(settings,['owner','sourceName','sourceType','sessionUsage']);
  if(typeof config.sessionUsage!=='function'||typeof config.sourceName!=='string'||config.sourceName.length>260||!['text/markdown','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(config.sourceType))fail('INPUT','Invalid trusted draft configuration.');
  let expected=owner(config.owner),closed=false,busy=false,revision=0,serial=0;
  const sourceSize=bundle.sourceBytes.byteLength,baseSize=bundle.modelBytes.byteLength;
  const assetBytes=bundle.assets.reduce((n,a)=>sum(n,a.bytes.byteLength),0);
  if(baseSize>16*MiB||assetBytes>16*MiB||bundle.assets.length>48)fail('LIMIT','Draft model or task-lifetime image budget exceeded.');
  const getSession=()=>config.sessionUsage();
  assertDocumentWorkspaceBudget(getSession(),{resourceBytes:baseSize+assetBytes,resourceCount:1+bundle.assets.length,artifactBytes:sourceSize});
  const initial=freeze(validateDocumentModel(bundle.model)),assets=Object.freeze(bundle.assets.map(a=>Object.freeze({...a}))),disposeBundle=bundle.dispose;
  if(typeof disposeBundle!=='function')fail('INPUT','An owned reader bundle disposer is required.');
  const baseline={model:initial,bytes:bundle.modelBytes,settings:{paper:'letter',landscape:false,margin:48}};
  let current=baseline,past=[],future=[];
  const owned=new Set([bundle.modelBytes]);const originalBuffers=[bundle.modelBytes,bundle.sourceBytes,...assets.map(a=>a.bytes)];
  function active(){if(closed)fail('CLOSED','This draft is closed.');}
  function unlocked(){active();if(busy)fail('BUSY','Wait for the active model mutation to drain.');}
  function entries(){return [...new Set([baseline,current,...past,...future])];}
  function live(){const versions=entries();return {resourceBytes:sum(assetBytes,...versions.map(v=>v.bytes.byteLength)),resourceCount:assets.length+versions.length,artifactBytes:sourceSize};}
  function assertOwner(captured=expected){if(!same(captured,owner(getSession()))||!same(captured,expected))fail('STALE','The canonical owner changed.');}
  function tidy(){const keep=new Set(entries().map(v=>v.bytes));for(const bytes of owned)if(!keep.has(bytes)){fill.call(bytes,0);owned.delete(bytes);}}
  function snapshot(){active();return {revision,owner:{...expected},sourceName:config.sourceName,sourceType:config.sourceType,blockCount:current.model.blocks.length,modelBytes:current.bytes.byteLength,...live(),canUndo:past.length>0,canRedo:future.length>0,dirty:current!==baseline,paper:{...current.settings},busy};}
  function find(model,id){const index=model.blocks.findIndex(b=>b.id===id);if(index<0)fail('INPUT','Unknown block ID.');return {block:model.blocks[index],index};}
  function paragraph(model,target){let {block}=find(model,target.blockId);if(target.cell!==undefined){const cell=exact(target.cell,['row','column']);if(block.kind!=='table')fail('INPUT','Cell target requires a table.');const row=integer(cell.row,0,block.rows.length-1),col=integer(cell.column,0,block.columnWidths.length-1);const paragraphs=block.rows[row][col].paragraphs;return {paragraphs,p:paragraphs[integer(target.paragraphIndex??0,0,paragraphs.length-1)]};}if(!block.runs)fail('INPUT','Choose a paragraph block.');return {p:block};}
  function freshId(model){const ids=new Set([...model.assets,...model.lists].map(v=>v.id));for(const b of model.blocks){ids.add(b.id);if(b.kind==='table')for(const row of b.rows)for(const cell of row)for(const p of cell.paragraphs)ids.add(p.id);}let id;do{id=`draft-${++serial}`;}while(ids.has(id));return id;}
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
    if(tag==='set-paper'){if(c.target!==undefined)fail('INPUT','Paper has no content target.');paper.paper=enumeration(c.paper,['letter','a4']);if(typeof c.landscape!=='boolean')fail('INPUT','Invalid orientation.');paper.landscape=c.landscape;paper.margin=number(c.margin,0,72);return;}
    const target=exact(c.target??{},['blockId','cell','paragraphIndex','runIndex']);
    if(tag==='insert-block'){
      const position=integer(c.position,0,model.blocks.length),kind=enumeration(c.kind,['paragraph','heading','code','list-item','table','image','rule','page-break']);let block;
      if(['paragraph','heading','code','list-item'].includes(kind)){block=emptyParagraph(model);block.kind=kind;if(kind==='heading')block.level=1;if(kind==='list-item'){const id=freshId({...model,blocks:[...model.blocks,block]});model.lists.push({id,ordered:true,start:1});block.list={id,level:0,value:1,restart:true};}}
      else if(kind==='table')block={id:freshId(model),kind,columnWidths:[1],rows:[[{paragraphs:[]}]]};
      else if(kind==='image'){const asset=model.assets.find(a=>a.id===c.assetId);if(!asset)fail('INPUT','Choose an admitted image.');block={id:freshId(model),kind,assetId:asset.id,width:asset.width,height:asset.height};}
      else block={id:freshId(model),kind};model.blocks.splice(position,0,block);return;
    }
    const {block,index}=find(model,target.blockId);
    if(tag==='remove-block'){model.blocks.splice(index,1);return;}
    if(tag==='move-block'){const to=index+enumeration(c.delta,[-1,1]);integer(to,0,model.blocks.length-1);model.blocks.splice(index,1);model.blocks.splice(to,0,block);return;}
    if(tag==='set-image'||tag==='replace-image'){
      if(block.kind!=='image')fail('INPUT','Choose an image block.');if(tag==='replace-image'){if(!model.assets.some(a=>a.id===c.assetId))fail('INPUT','Choose an admitted image.');block.assetId=c.assetId;}else{block.width=number(c.width,0.001,14400);block.height=number(c.height,0.001,14400);if(typeof c.alt!=='string'||c.alt.length>10000)fail('INPUT','Invalid alternate text.');model.assets.find(a=>a.id===block.assetId).alt=c.alt;}return;
    }
    if(['set-column-width','insert-row','remove-row','insert-column','remove-column','move-row'].includes(tag)){
      if(block.kind!=='table')fail('INPUT','Choose a table.');const cols=block.columnWidths.length;
      if(tag==='set-column-width')block.columnWidths[integer(c.column,0,cols-1)]=number(c.weight,0.001,1000000);
      else if(tag==='insert-row'){integer(c.row,0,block.rows.length);block.rows.splice(c.row,0,Array.from({length:cols},()=>({paragraphs:[]})));}
      else if(tag==='remove-row')block.rows.splice(integer(c.row,0,block.rows.length-1),1);
      else if(tag==='move-row'){const row=integer(c.row,0,block.rows.length-1),to=row+enumeration(c.delta,[-1,1]);integer(to,0,block.rows.length-1);const [value]=block.rows.splice(row,1);block.rows.splice(to,0,value);}
      else if(tag==='insert-column'){integer(c.column,0,cols);block.columnWidths.splice(c.column,0,1);for(const row of block.rows)row.splice(c.column,0,{paragraphs:[]});}
      else{if(cols===1)fail('INPUT','A table needs at least one column.');integer(c.column,0,cols-1);block.columnWidths.splice(c.column,1);for(const row of block.rows)row.splice(c.column,1);}return;
    }
    if(['insert-paragraph','remove-paragraph','move-paragraph'].includes(tag)){
      if(block.kind!=='table'||target.cell===undefined)fail('INPUT','Choose a table cell.');const cell=exact(target.cell,['row','column']),values=block.rows[integer(cell.row,0,block.rows.length-1)][integer(cell.column,0,block.columnWidths.length-1)].paragraphs;
      if(tag==='insert-paragraph')values.splice(integer(c.position,0,values.length),0,emptyParagraph(model));else{const at=integer(target.paragraphIndex,0,values.length-1);if(tag==='remove-paragraph')values.splice(at,1);else{const to=at+enumeration(c.delta,[-1,1]);integer(to,0,values.length-1);const [value]=values.splice(at,1);values.splice(to,0,value);}}return;
    }
    const {p}=paragraph(model,target);
    if(tag==='set-paragraph-direction'){p.direction=enumeration(c.direction,directions);return;}
    if(tag==='set-paragraph-kind'){p.kind=enumeration(c.kind,['paragraph','heading','code']);delete p.list;delete p.level;if(p.kind==='heading')p.level=integer(c.level,1,6);return;}
    if(tag==='set-list'){if(typeof c.ordered!=='boolean'||typeof c.restart!=='boolean')fail('INPUT','Invalid list flags.');let definition=c.id?model.lists.find(l=>l.id===c.id):null;if(c.id&&!definition)fail('INPUT','Unknown list.');if(definition&&definition.ordered!==c.ordered)fail('INPUT','A list identity cannot silently change its ordered kind.');if(!definition){definition={id:freshId(model),ordered:c.ordered,start:integer(c.value,1,1000000)};model.lists.push(definition);}p.kind='list-item';delete p.level;p.list={id:definition.id,level:integer(c.level,0,8),value:integer(c.value,1,1000000),restart:c.restart};return;}
    if(tag==='insert-run'){if(typeof c.text!=='string'||c.text.length>65536)fail('INPUT','Inserted text exceeds its bound.');p.runs.splice(integer(c.position,0,p.runs.length),0,{text:c.text,style:enumeration(c.style,styles),direction:enumeration(c.direction,directions)});return;}
    const at=integer(target.runIndex,0,p.runs.length-1),run=p.runs[at];
    if(tag==='replace-run-range'){if(typeof c.text!=='string'||c.text.length>65536)fail('INPUT','Inserted text exceeds its bound.');boundary(run.text,c.start);boundary(run.text,c.end);if(c.end<c.start)fail('INPUT','Reversed source range.');run.text=run.text.substring(0,c.start)+c.text+run.text.substring(c.end);}
    else if(tag==='set-run-style')run.style=enumeration(c.style,styles);
    else if(tag==='set-run-direction')run.direction=enumeration(c.direction,directions);
    else if(tag==='remove-run')p.runs.splice(at,1);
    else if(tag==='split-run'){boundary(run.text,c.offset);p.runs.splice(at,1,{...run,text:run.text.substring(0,c.offset)},{...run,text:run.text.substring(c.offset)});}
    else{const next=p.runs[at+1];if(!next||next.style!==run.style||next.direction!==run.direction)fail('INPUT','Only equal run style and direction can merge.');run.text+=next.text;p.runs.splice(at+1,1);}
  }
  return {
    snapshot,model(){active();return current.model;},assets(){active();return assets;},
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
        assertDocumentWorkspaceBudget(opts.sessionUsage??getSession(),live(),{resourceBytes:3*bound,resourceCount:3});
        if(entries().length===6)fail('LIMIT','Six retained model versions are full. Explicitly clear undo history.');
        // The first owned mutation is registered before any clone or reservation.
        await new Promise(resolve=>setTimeout(resolve,0));check(abortSignal);assertOwner(capturedOwner);assertDocumentWorkspaceBudget(getSession(),live(),{resourceBytes:3*bound,resourceCount:3});
        const working=validateDocumentModel(current.model,{signal:{throwIfAborted:()=>check(abortSignal)}}),paper={...current.settings};mutate(working,command,paper);
        const validated=validateDocumentModel(working,{signal:{throwIfAborted:()=>check(abortSignal)}}),json=JSON.stringify(validated);candidateBytes=encoder.encode(json);
        const versions=entries();if(sum(candidateBytes.length,...versions.map(v=>v.bytes.length))>48*MiB)fail('LIMIT','Retained model versions exceed 48 MiB. Explicitly clear undo history.');
        await new Promise(resolve=>setTimeout(resolve,0));check(abortSignal);assertOwner(capturedOwner);if(revision!==capturedRevision)fail('STALE','The local revision changed.');
        assertDocumentWorkspaceBudget(getSession(),live(),{resourceBytes:candidateBytes.length,resourceCount:1});
        const next={model:freeze(validated),bytes:candidateBytes,settings:paper};owned.add(candidateBytes);candidateBytes=null;past.push(current);current=next;future=[];revision++;tidy();return {...snapshot(),busy:false};
      }finally{if(candidateBytes)fill.call(candidateBytes,0);busy=false;}
    },
    undo(){unlocked();assertOwner();if(!past.length)return snapshot();future.push(current);current=past.pop();revision++;return snapshot();},
    redo(){unlocked();assertOwner();if(!future.length)return snapshot();past.push(current);current=future.pop();revision++;return snapshot();},
    clearUndo(){unlocked();assertOwner();past=[];future=[];tidy();return snapshot();},
    acceptOwner(before,next){unlocked();const a=owner(before),b=owner(next);if(!same(a,expected)||!same(b,owner(getSession())))fail('STALE','Only the verified adopted owner can transfer.');expected=b;return snapshot();},
    dispose(){if(closed)return;unlocked();closed=true;for(const bytes of owned)fill.call(bytes,0);owned.clear();for(const bytes of originalBuffers)fill.call(bytes,0);apply(disposeBundle,bundle,[]);past=[];future=[];current=null;}
  };
}
