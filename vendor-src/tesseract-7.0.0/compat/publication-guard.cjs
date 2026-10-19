'use strict';
// BrowserPDF compatibility output admission, 2026-10-19. After SDK dump, before
// native publication. This is not a WASM, JSON parse, dump or native heap cap.
const MiB=1024*1024, own=Object.prototype.hasOwnProperty, apply=Reflect.apply;
const proto=Object.getPrototypeOf, descriptor=Object.getOwnPropertyDescriptor;
const objectSource=Function.prototype.toString, arrayIs=Array.isArray;
const typed=proto(Uint8Array.prototype), typedName=descriptor(typed,Symbol.toStringTag).get;
const typedSize=descriptor(typed,'byteLength').get,typedBuffer=descriptor(typed,'buffer').get,typedOffset=descriptor(typed,'byteOffset').get;
const abSize=descriptor(ArrayBuffer.prototype,'byteLength').get;
const LIMITS=Object.freeze({messageBytes:4*MiB,envelopeBytes:2048,textUnits:200000,stringUnits:4096,keyUnits:128,depth:12,nodes:100000,keys:128,blocks:256,paragraphs:512,lines:1000,words:10000,symbols:100000,choices:20000,imageBytes:4*MiB,imagePixels:1000000,imageEdge:4096,progress:128,startupMetadataBytes:65536,startupAggregateBytes:16*MiB});
const LANGUAGES=Object.freeze({eng:Object.freeze({bytes:5199098,sha256:'5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747'}),tur:Object.freeze({bytes:4680866,sha256:'f0127d0f3745f9c65e2ae7ec6b23198fbe5aa186a61b35661426f5e1ef9dedd7'})});
function fail(message){const error=new Error('OCR publication rejected: '+message);error.code='OCR_OUTPUT_LIMIT';throw error;}
function finite(reason){let message;try{message=typeof reason==='string'?reason:descriptor(reason,'message')?.value;}catch{}return (typeof message==='string'?message:'OCR publication failed.').slice(0,512);}
function field(value,key){const d=descriptor(value,key);if(!d||!d.enumerable||!apply(own,d,['value']))fail('expected an own data field '+key);return d.value;}
function plain(value){const p=proto(value);if(p===null)return true;if(proto(p)!==null)return false;const d=descriptor(p,'constructor');return typeof d?.value==='function'&&apply(objectSource,d.value,[])==='function Object() { [native code] }';}
function bytes(value){try{if(apply(typedName,value,[])!=='Uint8Array')fail('expected Uint8Array');const n=apply(typedSize,value,[]),buffer=apply(typedBuffer,value,[]);apply(abSize,buffer,[]);return new Uint8Array(buffer,apply(typedOffset,value,[]),n);}catch{fail('expected owned Uint8Array backed by ArrayBuffer');}}
function imageBounds(image){const b=bytes(image);if(b.length<33||b.length>LIMITS.imageBytes||![137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n)||b[12]!==73||b[13]!==72||b[14]!==68||b[15]!==82)fail('only the admitted PNG image is supported');const v=new DataView(b.buffer,b.byteOffset,b.byteLength),width=v.getUint32(16),height=v.getUint32(20);if(v.getUint32(8)!==13||!width||!height||width>LIMITS.imageEdge||height>LIMITS.imageEdge||width*height>LIMITS.imagePixels)fail('submitted PNG dimensions exceed admission');return {width,height};}
function amount(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail('invalid '+label);return value;}
function geometry(value,bounds,baseline=false){if(!value||typeof value!=='object'||!plain(value)||arrayIs(value))fail('invalid geometry record');const x0=field(value,'x0'),y0=field(value,'y0'),x1=field(value,'x1'),y1=field(value,'y1');amount(x0,0,bounds.width,'x0');amount(x1,0,bounds.width,'x1');amount(y0,0,bounds.height,'y0');amount(y1,0,bounds.height,'y1');if(!baseline&&!(x1>x0&&y1>y0))fail('bbox requires positive extents');}
function visitor({maximum=LIMITS.messageBytes-LIMITS.envelopeBytes,bounds,recognition=false}={}){
 const usage={bytes:0,textUnits:0,nodes:0,depth:0,blocks:0,paragraphs:0,lines:0,words:0,symbols:0,choices:0},ancestors=new Set();
 function charge(n){usage.bytes+=n;if(usage.bytes>maximum)fail('serialized message budget');}
 function string(text,key=false,pageText=false){if(text.length>(key?LIMITS.keyUnits:pageText?LIMITS.textUnits:LIMITS.stringUnits))fail('string length');if(!key&&(usage.textUnits+=text.length)>LIMITS.textUnits)fail('aggregate string units');charge(2);for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c===34||c===92)charge(2);else if(c<32)charge(6);else if(c<128)charge(1);else if(c<2048)charge(2);else if(c>=0xd800&&c<=0xdbff){const low=text.charCodeAt(++i);if(!(low>=0xdc00&&low<=0xdfff))fail('unpaired surrogate');charge(4);}else{if(c>=0xdc00&&c<=0xdfff)fail('unpaired surrogate');charge(3);}}}
 function visit(value,depth=0,key='',pageText=false){if(++usage.nodes>LIMITS.nodes)fail('tree work/depth budget');if(value&&typeof value==='object'){if(depth>LIMITS.depth)fail('tree work/depth budget');usage.depth=Math.max(usage.depth,depth);}
  if(value===null){charge(4);return;}if(typeof value==='string'){string(value,false,pageText);return;}if(typeof value==='boolean'){charge(value?4:5);return;}if(typeof value==='number'){if(!Number.isFinite(value))fail('nonfinite number');charge(String(value).length);return;}
  // Exact v7 dump enum projections may have no matching exported enum key.
  // Preserve these two own root values literally; charge a finite9-byte scalar.
  if(value===undefined&&recognition&&depth===1&&(key==='psm'||key==='oem')){charge(9);return;}
  if(!value||typeof value!=='object')fail('non-data value');
  if(ancestors.has(value))fail('cycle');ancestors.add(value);
  try{
   if(arrayIs(value)){
    const length=fieldLength(value);if(length>LIMITS.nodes-usage.nodes)fail('array length/work budget');if(recognition&&apply(own,LIMITS,[key])&&['blocks','paragraphs','lines','words','symbols','choices'].includes(key)){usage[key]+=length;if(usage[key]>LIMITS[key])fail('aggregate '+key+' budget');}
    charge(2+Math.max(0,length-1));for(let i=0;i<length;i++){const d=descriptor(value,String(i));if(!d||!d.enumerable||!apply(own,d,['value']))fail('sparse/accessor array');if(recognition)schemaItem(key,d.value);visit(d.value,depth+1,'',false);}
    // Enumerate incrementally; no Object.keys/Reflect.ownKeys/descriptor table.
    for(const name in value)if(apply(own,value,[name])&&(!/^(?:0|[1-9][0-9]*)$/.test(name)||Number(name)>=length))fail('extra enumerable array field');
   }else{
    if(!plain(value))fail('non-plain or binary record');charge(2);let count=0;
    for(const name in value){if(!apply(own,value,[name]))continue;if(++count>LIMITS.keys)fail('record key count');const d=descriptor(value,name);if(!d||!d.enumerable||!apply(own,d,['value']))fail('enumerable accessor');if(count>1)charge(1);string(name,true);charge(1);
     if(recognition&&name==='bbox')geometry(d.value,bounds);
     if(recognition&&name==='baseline')geometry(d.value,bounds,true);
     if(recognition&&name==='confidence'&&d.value!==null)amount(d.value,0,100,'confidence');
     if(recognition&&name==='rowAttributes'&&d.value!==null){for(const metric of ['ascenders','descenders','rowHeight'])amount(field(d.value,metric),-1000000,1000000,'signed row metric');}
     visit(d.value,depth+1,name,depth===0&&name==='text');
    }
   }
  }finally{ancestors.delete(value);}
 }
 return {usage,visit};
}
function fieldLength(array){const d=descriptor(array,'length');if(!d||!Number.isSafeInteger(d.value)||d.value<0)fail('invalid dense array length');return d.value;}
function schemaItem(kind,value){if(!['blocks','paragraphs','lines','words','symbols','choices'].includes(kind))return;if(!value||typeof value!=='object'||!plain(value)||arrayIs(value))fail('invalid '+kind+' item');if(typeof field(value,'text')!=='string')fail('missing literal '+kind+' text');const confidence=field(value,'confidence');if(confidence!==null)amount(confidence,0,100,'confidence');if(kind!=='choices')field(value,'bbox');const child={blocks:'paragraphs',paragraphs:'lines',lines:'words',words:'symbols'}[kind];if(child&&!arrayIs(field(value,child)))fail('missing '+child+' array');const choices=descriptor(value,'choices');if(choices&&(!apply(own,choices,['value'])||!arrayIs(choices.value)))fail('invalid choices array');}
function exactEnumerable(value,keys){let count=0;for(const name in value)if(apply(own,value,[name])){if(++count>keys.length||!keys.includes(name))fail('unexpected startup field');field(value,name);}if(count!==keys.length)fail('missing startup field');}
function recognition(result,image){const bounds=imageBounds(image);if(!result||typeof result!=='object'||!plain(result)||arrayIs(result))fail('invalid page result');for(const key of ['hocr','tsv','box','unlv','osd','pdf','imageColor','imageGrey','imageBinary','debug','layoutBlocks']){const d=descriptor(result,key);if(d&&(!apply(own,d,['value'])||d.value!==null&&d.value!==undefined))fail('disabled output '+key);}const text=field(result,'text'),blocks=field(result,'blocks');if(typeof text!=='string'||!arrayIs(blocks))fail('text and blocks are required');if(field(result,'rotateRadians')!==0)fail('unexpected recognition rotation');const v=visitor({bounds,recognition:true});v.visit(result);return {...v.usage,bounds};}
function correlation(packet){const result={};for(const key of ['jobId','workerId','action']){const value=field(packet,key);if(typeof value!=='string'||!value.length||value.length>100)fail('invalid SDK correlation');result[key]=value;}return result;}
function selectedLanguages(packet){const langs=field(field(packet,'payload'),'langs');if(!arrayIs(langs)||fieldLength(langs)<1||fieldLength(langs)>2)fail('owned selected Lang array required');const admitted=[],seen=new Set();let total=0;
 exactEnumerable(langs,Array.from({length:langs.length},(_,i)=>String(i)));
 for(let i=0;i<langs.length;i++){const lang=field(langs,String(i));if(!lang||typeof lang!=='object'||!plain(lang)||arrayIs(lang))fail('invalid Lang record');exactEnumerable(lang,['code','data']);const code=field(lang,'code');if(typeof code!=='string'||!apply(own,LANGUAGES,[code]))fail('unpinned language');const pin=LANGUAGES[code];if(seen.has(code))fail('duplicate language');seen.add(code);const data=field(lang,'data'),b=bytes(data);if(apply(typedOffset,data,[])!==0||apply(abSize,apply(typedBuffer,data,[]),[])!==pin.bytes)fail('language backing extent must equal pinned view');if(b.length!==pin.bytes||b[0]===31&&b[1]===139||b[0]===139&&b[1]===31)fail('language length/gzip mismatch');total+=b.length;if(total>LIMITS.startupAggregateBytes)fail('selected language aggregate');admitted.push({lang,code,data,size:b.length});}
 return {langs,admitted,total};
}
function open(packet,nativePost){const ids=correlation(packet);if(typeof nativePost!=='function')fail('native publication function required');let terminal=false,progress=0,admitted=null,bounds=null,setupError=null,lastUsage=null;
 try{if(ids.action==='recognize'){const payload=field(packet,'payload');bounds=imageBounds(field(payload,'image'));const options=field(payload,'options');for(const key of ['rotateAuto','rotateRadians']){const d=descriptor(options,key);if(d&&(!apply(own,d,['value'])||d.value))fail('only the admitted unrotated PNG is supported');}const output=field(payload,'output');for(const name in output)if(apply(own,output,[name])&&field(output,name)&&!['text','blocks'].includes(name))fail('disabled requested output');if(field(output,'text')!==true||field(output,'blocks')!==true)fail('text/blocks output required');}else if(ids.action==='loadLanguage')admitted=selectedLanguages(packet);else if(!['load','initialize','setParameters','terminate'].includes(ids.action))fail('unsupported standalone action');}catch(error){setupError=error;}
 function reject(reason){if(terminal)return false;terminal=true;nativePost({...ids,status:'reject',data:finite(reason)});return true;}
 function publish(message){if(terminal)return false;try{for(const key of ['jobId','workerId','action'])if(field(message,key)!==ids[key])fail('mismatched SDK correlation');const status=field(message,'status'),data=field(message,'data');if(setupError){reject(setupError);return false;}
   if(status==='reject'){reject(data);return true;}
   if(status==='progress'){if(progress>=LIMITS.progress)return false;const v=visitor({maximum:8192});v.visit(data);const pd=data&&typeof data==='object'?descriptor(data,'progress'):null;if(pd){if(!apply(own,pd,['value']))fail('progress accessor');amount(pd.value,0,1,'progress');}progress++;nativePost({...ids,status,data});return true;}
   if(status!=='resolve')fail('unknown SDK status');
   if(ids.action==='recognize'){lastUsage=recognition(data,field(field(packet,'payload'),'image'));}
   else if(ids.action==='loadLanguage'){
    const current=selectedLanguages(packet);if(data!==admitted.langs||current.total!==admitted.total||fieldLength(data)!==admitted.admitted.length)fail('language response identity');for(let i=0;i<data.length;i++){const item=admitted.admitted[i];if(field(data,String(i))!==item.lang||field(item.lang,'code')!==item.code||field(item.lang,'data')!==item.data||bytes(item.data).length!==item.size)fail('language response changed');}
    lastUsage={binaryBytes:admitted.total,metadataBytes:LIMITS.startupMetadataBytes,cloneReservationBytes:admitted.total+LIMITS.startupMetadataBytes,policy:'Exact host-verified selected Lang identities and registry lengths. Host owns SHA verification before request; no silent binary startup rewrite.'};
   }else if(data!==undefined){const v=visitor({maximum:LIMITS.startupMetadataBytes});v.visit(data);lastUsage={...v.usage};}
   // Last adapter admission is complete before this call. If native posting
   // itself throws, use one finite rejection, never a resolve/reject pair.
   try{nativePost({...ids,status,data});terminal=true;return true;}catch(error){reject(error);return false;}
  }catch(error){reject(error);return false;}}
 return {publish,reject,get valid(){return !setupError;},get error(){return setupError;},inspect(){return {terminal,progress,lastUsage,bounds};}};
}
module.exports={LIMITS,LANGUAGES,finite,imageBounds,recognition,open};
