const MiB=1024*1024;
export const DOCUMENT_LIMITS=Object.freeze({textUnits:1000000,modelBytes:16*MiB,paragraphs:10000,runs:50000,tables:500,rows:10000,columns:100,cells:200000,pages:1000,assets:48,warnings:100,fragments:200000,layoutBytes:16*MiB,outputPages:1000,retainedModels:6,outputBytes:96*MiB,outputs:3});
export const DOCUMENT_ORIGINS=Object.freeze(['pdf','docx','markdown','text']);
export const DOCUMENT_DIRECTIONS=Object.freeze(['ltr','rtl','auto']);
export const DOCUMENT_STYLES=Object.freeze(['regular','bold','italic','boldItalic','code']);
export const DOCUMENT_SOURCES=Object.freeze(['embedded','ocr','authored']);
export const DOCUMENT_WARNING_CODES=Object.freeze(['reading-order-inferred','complex-layout','unsupported-structure','external-image-blocked','header-footer-omitted','notes-omitted','floating-image-inline','table-merge-unsupported','ocr-low-confidence']);
const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const fail=message=>{throw new TypeError(`Invalid document model: ${message}`);};
const finite=(value,min,max,label)=>{if(!Number.isFinite(value)||value<min||value>max)fail(label);return value;};
const integer=(value,min,max,label)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail(label);return value;};
const enumeration=(value,values,label)=>{if(!values.includes(value))fail(label);return value;};
function exact(value,allowed,label){
  if(!isObject(value))fail(label);
  for(const key of Reflect.ownKeys(value)){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||!allowed.includes(key)||!descriptor.enumerable||!Object.hasOwn(descriptor,'value')||descriptor.value===undefined)fail(label);
  }
}
function array(value,max,label){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail(label);
  const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(!Number.isSafeInteger(length)||length>max||Reflect.ownKeys(value).length!==length+1)fail(label);
  for(let index=0;index<length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value')||descriptor.value===undefined)fail(label);
  }
  return length;
}

// Synchronous finite validation. Signal checks cannot receive event-loop work
// until this bounded call returns; asynchronous adapters yield separately.
export function validateDocumentModel(value,{signal}={}){
  signal?.throwIfAborted();let bytes=0,textUnits=0,paragraphs=0,runs=0,tables=0,rows=0,cells=0,steps=0;
  const ids=new Set(),blockIds=new Set(),assetIds=new Set(),listIds=new Set(),pageNumbers=new Set();
  const step=()=>{if((++steps&255)===0)signal?.throwIfAborted();};
  const charge=n=>{bytes+=n;if(bytes>DOCUMENT_LIMITS.modelBytes)throw new RangeError('The serialized document model exceeds 16 MiB.');};
  function string(text,max,label,{logical=false}={}){if(typeof text!=='string'||text.length>max)fail(label);if(logical&&/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))fail('Unsupported text control character.');if(logical&&(textUnits+=text.length)>DOCUMENT_LIMITS.textUnits)throw new RangeError('Document text exceeds one million UTF-16 units.');let size=2;for(const char of text){step();const cp=char.codePointAt(0);if(cp>=0xd800&&cp<=0xdfff)fail('Unpaired UTF-16 surrogate.');size+=char==='"'||char==='\\'?2:cp<32?(['\b','\f','\n','\r','\t'].includes(char)?2:6):cp<128?1:cp<2048?2:cp<65536?3:4;}charge(size);return text;}
  function scalar(n){charge(String(n).length);return n;}
  function object(keys){charge(2+Math.max(0,keys.length-1)+keys.reduce((n,key)=>n+key.length+3,0));}
  function list(values,max,label){const length=array(values,max,label);charge(2+Math.max(0,length-1));const owned=new Array(length);for(let index=0;index<length;index++)owned[index]=Object.getOwnPropertyDescriptor(values,String(index)).value;return owned;}
  function identity(id,label){if(typeof id!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(id)||ids.has(id))fail(label);ids.add(id);return string(id,100,label);}
  function reference(id,set,label){if(!set.has(id))fail(label);return string(id,100,label);}
  function direction(d){return string(enumeration(d,DOCUMENT_DIRECTIONS,'Direction must be ltr, rtl or auto.'),4,'Direction');}
  function source(p){exact(p,['pageNumber','source','box'],'Source provenance fields');object(Object.keys(p));const result={pageNumber:scalar(integer(p.pageNumber,1,DOCUMENT_LIMITS.pages,'Source page')),source:string(enumeration(p.source,DOCUMENT_SOURCES,'Source kind'),8,'Source kind')};if(!pageNumbers.has(p.pageNumber))fail('Provenance refers to an absent page.');if(p.box!==undefined){exact(p.box,['x','y','width','height'],'Source box fields');object(['x','y','width','height']);const {x,y,width,height}=p.box;finite(x,-1000000,1000000,'Box x');finite(y,-1000000,1000000,'Box y');finite(width,Number.MIN_VALUE,1000000,'Box width');finite(height,Number.MIN_VALUE,1000000,'Box height');if(x+width>1000000||y+height>1000000)fail('Box extents exceed the coordinate bound.');result.box={x:scalar(x),y:scalar(y),width:scalar(width),height:scalar(height)};}return result;}
  function base(block,allowed){exact(block,['id','kind','source',...allowed],'Block fields');const keys=['id','kind',...(block.source===undefined?[]:['source']),...allowed.filter(key=>block[key]!==undefined)];object(keys);const result={id:identity(block.id,'Unique block ID'),kind:string(block.kind,16,'Block kind')};blockIds.add(block.id);if(block.source!==undefined)result.source=source(block.source);return result;}
  function paragraph(block){step();exact(block,['id','kind','source','direction','runs','level','list'],'Paragraph fields');if(++paragraphs>DOCUMENT_LIMITS.paragraphs)throw new RangeError('The document exceeds 10,000 paragraphs.');if(!['paragraph','heading','list-item','code'].includes(block.kind))fail('Cell content must contain paragraph blocks.');const result=base(block,['direction','runs','level','list']);result.direction=direction(block.direction);
    if(block.kind==='heading')result.level=scalar(integer(block.level,1,6,'Heading level'));else if(block.level!==undefined)fail('Only headings have a heading level.');
    if(block.kind==='list-item'){exact(block.list,['id','level','value','restart'],'List reference fields');object(['id','level','value','restart']);if(typeof block.list.restart!=='boolean')fail('List restart');result.list={id:reference(block.list.id,listIds,'Missing list definition'),level:scalar(integer(block.list.level,0,8,'List level')),value:scalar(integer(block.list.value,1,1000000,'List value')),restart:scalar(block.list.restart)};}else if(block.list!==undefined)fail('Only list-item blocks have list references.');
    result.runs=list(block.runs,DOCUMENT_LIMITS.runs,'Paragraph runs').map(run=>{step();if(++runs>DOCUMENT_LIMITS.runs)throw new RangeError('The document exceeds 50,000 runs.');exact(run,['text','style','direction'],'Run fields');object(['text','style','direction']);if(typeof run.text==='string'&&/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(run.text))fail('Unsupported text control character.');return {text:string(run.text,DOCUMENT_LIMITS.textUnits,'Run text',{logical:true}),style:string(enumeration(run.style,DOCUMENT_STYLES,'Requested run style'),10,'Run style'),direction:direction(run.direction)};});return result;
  }
  function block(value){step();exact(value,['id','kind','source','direction','runs','level','list','columnWidths','rows','assetId','width','height'],'Block fields');if(['paragraph','heading','list-item','code'].includes(value.kind))return paragraph(value);
    if(value?.kind==='table'){if(++tables>DOCUMENT_LIMITS.tables)throw new RangeError('The document exceeds 500 tables.');const result=base(value,['columnWidths','rows']);const widths=list(value.columnWidths,DOCUMENT_LIMITS.columns,'Table columns');if(!widths.length)fail('A table must have columns.');result.columnWidths=widths.map(n=>scalar(finite(n,0.001,1000000,'Column width weight')));const tableRows=list(value.rows,DOCUMENT_LIMITS.rows,'Table rows');if((rows+=tableRows.length)>DOCUMENT_LIMITS.rows)throw new RangeError('The document exceeds 10,000 aggregate table rows.');result.rows=tableRows.map(row=>{step();const ownedRow=list(row,DOCUMENT_LIMITS.columns,'Table row');if(ownedRow.length!==widths.length)fail('Table cell/column count');return ownedRow.map(cell=>{if(++cells>DOCUMENT_LIMITS.cells)throw new RangeError('The document exceeds 200,000 table cells.');exact(cell,['paragraphs'],'Table cell fields');object(['paragraphs']);return {paragraphs:list(cell.paragraphs,DOCUMENT_LIMITS.paragraphs,'Cell paragraphs').map(paragraph)};});});return result;}
    if(value?.kind==='image'){const result=base(value,['assetId','width','height']);return {...result,assetId:reference(value.assetId,assetIds,'Missing owned image asset'),width:scalar(finite(value.width,0.001,14400,'Image physical width')),height:scalar(finite(value.height,0.001,14400,'Image physical height'))};}
    if(['rule','page-break'].includes(value?.kind))return base(value,[]);fail('Unknown block kind.');
  }
  exact(value,['version','origin','pages','lists','blocks','assets','warnings'],'Document fields');if(value.version!==1)fail('Document version');object(['version','origin','pages','lists','blocks','assets','warnings']);const model={version:scalar(1),origin:string(enumeration(value.origin,DOCUMENT_ORIGINS,'Document origin'),8,'Origin')};
  model.pages=list(value.pages,DOCUMENT_LIMITS.pages,'Source pages').map(page=>{step();exact(page,['number','source','confidence'],'Page fields');object(Object.keys(page));const number=integer(page.number,1,DOCUMENT_LIMITS.pages,'Page number');if(pageNumbers.has(number))fail('Duplicate source page.');pageNumbers.add(number);const result={number:scalar(number),source:string(enumeration(page.source,DOCUMENT_SOURCES,'Page source'),8,'Page source')};if(page.confidence!==undefined)result.confidence=scalar(finite(page.confidence,0,100,'Confidence must be 0–100.'));return result;});
  model.assets=list(value.assets,DOCUMENT_LIMITS.assets,'Owned image assets').map(asset=>{step();exact(asset,['id','type','width','height','alt'],'Asset fields');object(['id','type','width','height','alt']);const id=identity(asset.id,'Unique asset ID');assetIds.add(id);const width=integer(asset.width,1,4096,'Asset pixel width'),height=integer(asset.height,1,4096,'Asset pixel height');if(width*height>16000000)fail('Asset pixels exceed 16 million.');return {id,type:string(enumeration(asset.type,['image/png','image/jpeg'],'Image MIME'),10,'Image MIME'),width:scalar(width),height:scalar(height),alt:string(asset.alt,10000,'Alternate text',{logical:true})};});
  model.lists=list(value.lists,DOCUMENT_LIMITS.paragraphs,'List definitions').map(entry=>{step();exact(entry,['id','ordered','start'],'List definition fields');object(['id','ordered','start']);const id=identity(entry.id,'Unique list ID');listIds.add(id);if(typeof entry.ordered!=='boolean')fail('List ordered flag');return {id,ordered:scalar(entry.ordered),start:scalar(integer(entry.start,1,1000000,'List start'))};});
  model.blocks=list(value.blocks,DOCUMENT_LIMITS.paragraphs+DOCUMENT_LIMITS.tables+DOCUMENT_LIMITS.assets,'Document blocks').map(block);
  model.warnings=list(value.warnings,DOCUMENT_LIMITS.warnings,'Document warnings').map(warning=>{step();exact(warning,['code','sourcePage','blockId'],'Warning fields');object(Object.keys(warning));const result={code:string(enumeration(warning.code,DOCUMENT_WARNING_CODES,'Warning code'),64,'Warning code')};if(warning.sourcePage!==undefined){if(!pageNumbers.has(warning.sourcePage))fail('Warning refers to an absent source page.');result.sourcePage=scalar(warning.sourcePage);}if(warning.blockId!==undefined)result.blockId=reference(warning.blockId,blockIds,'Warning refers to an absent block.');return result;});
  signal?.throwIfAborted();return model;
}
