import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import vm from 'node:vm';
import { admitOoxmlArchive, OOXML_LIMITS } from '../public/js/core/ooxml-zip.js';

// Independent ZIP32 fixtures: no application writer or private corpus inputs.
const encoder=new TextEncoder(),xml='<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>Literal 2 * 3 * 4 — İstanbul שלום</w:t></w:r></w:p></w:body></w:document>';
const types='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
function crc(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
function fixture(input=[],{kind='docx',contentTypes=types}={}){
  const specs=[{name:'[Content_Types].xml',text:contentTypes},...input],locals=[],centrals=[],positions=[];let offset=0;
  for(const spec of specs){const name=encoder.encode(spec.name),data=spec.data||encoder.encode(spec.text??xml),method=spec.method??0,compressed=spec.encoded|| (method===8?deflateRawSync(data):data),sum=spec.crc??crc(data),flags=0x800|(spec.descriptor?8:0),local=Buffer.alloc(30),central=Buffer.alloc(46),declared=spec.expanded??data.length;
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);if(!spec.descriptor){local.writeUInt32LE(sum,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(declared,22);}local.writeUInt16LE(name.length,26);
    let descriptor=Buffer.alloc(0);if(spec.descriptor){const signed=spec.descriptor==='signed';descriptor=Buffer.alloc(signed?16:12);let p=0;if(signed){descriptor.writeUInt32LE(0x08074b50);p=4;}descriptor.writeUInt32LE(sum,p);descriptor.writeUInt32LE(compressed.length,p+4);descriptor.writeUInt32LE(declared,p+8);}
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(sum,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(declared,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    positions.push({name:spec.name,local:offset,data:offset+30+name.length,central:centrals.reduce((n,b)=>n+b.length,0)});locals.push(local,name,compressed,descriptor);centrals.push(central,name);offset+=local.length+name.length+compressed.length+descriptor.length;
  }
  const cd=offset,directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(specs.length,8);end.writeUInt16LE(specs.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(cd,16);for(const p of positions)p.central+=cd;
  return {bytes:new Uint8Array(Buffer.concat([...locals,directory,end])),positions,kind};
}
async function accept(f,options={}){return admitOoxmlArchive(f.bytes,{kind:f.kind,...options});}
function utf16(text,be=false){const body=Buffer.from(text,'utf16le');if(be)body.swap16();return Buffer.concat([Buffer.from(be?[254,255]:[255,254]),body]);}

test('stored and real raw-deflated DOCX/XLSX parts retain exact bytes and deterministic metadata',async()=>{
  for(const kind of ['docx','xlsx'])for(const method of [0,8]){
    const name=kind==='docx'?'word/document.xml':'xl/workbook.xml',f=fixture([{name,text:xml,method},{name:'unretained.xml',text:'<extra>DISCARDED</extra>',method}],{kind}),before=f.bytes.slice(),result=await accept(f);
    assert.equal(new TextDecoder().decode(result.parts.get(name)),xml);assert.equal(result.parts.has('unretained.xml'),false);assert.deepEqual(result.bytes,before);assert.equal(result.stats.xmlParts,3);assert.ok(result.stats.xmlNodes>=8);assert.equal(result.stats.entries,3);assert.equal(result.stats.expandedBytes,encoder.encode(types+xml+'<extra>DISCARDED</extra>').length);result.parts.get(name)[0]=0;assert.deepEqual(f.bytes,before);result.dispose();result.dispose();assert.equal(result.parts.size,0);assert.ok(result.bytes.every(byte=>byte===0));
  }
});
test('signed and unsigned ZIP32 descriptors are validated against actual parts',async()=>{
  for(const descriptor of ['signed','unsigned']){const f=fixture([{name:'word/document.xml',method:8,descriptor}]),r=await accept(f);assert.equal(new TextDecoder().decode(r.parts.get('word/document.xml')),xml);r.dispose();const bad=f.bytes.slice();bad[f.positions[1].central+16]^=1;await assert.rejects(admitOoxmlArchive(bad,{kind:'docx'}),/descriptor|CRC|sizes/i);}
});
test('size guards run before reading or copying input; actual output defeats false declarations',async()=>{
  let reads=0;const large=new Blob([new Uint8Array(OOXML_LIMITS.rawBytes+1)]);Object.defineProperty(large,'arrayBuffer',{value(){reads++;throw Error('must not read');}});await assert.rejects(admitOoxmlArchive(large,{kind:'docx'}),/32 MiB/);assert.equal(reads,0);
  const f=fixture([{name:'word/document.xml',method:8,expanded:1}]);await assert.rejects(accept(f),/Actual expanded/);
});
test('CRC, truncation, unsupported methods, paths, duplicates and local mismatches reject',async()=>{
  const invalids=[fixture([{name:'word/document.xml',crc:1}]),fixture([{name:'word/document.xml',method:8,encoded:deflateRawSync(encoder.encode(xml)).subarray(0,5)}]),fixture([{name:'../word/document.xml'}]),fixture([{name:'word\\document.xml'}]),fixture([{name:'word/%64ocument.xml'}]),fixture([{name:'word/a.xml'},{name:'word/a.xml'}]),fixture([{name:'word/a',text:''},{name:'word/a/',text:''}])];
  for(const f of invalids)await assert.rejects(accept(f));
  const f=fixture([{name:'word/document.xml'}]);for(const [position,value] of [[f.positions[1].central+10,99],[f.positions[1].local+8,8]]){const bad=f.bytes.slice();new DataView(bad.buffer).setUint16(position,value,true);await assert.rejects(admitOoxmlArchive(bad,{kind:'docx'}),/Unsupported|disagree/);}
  await assert.rejects(admitOoxmlArchive(f.bytes.subarray(0,f.bytes.length-1),{kind:'docx'}),/end record/);
});
test('complete local-record envelopes reject a valid nested header inside another payload',async()=>{
  const name='nested.bin',payload=Buffer.from('second'),inner=Buffer.alloc(30+name.length+payload.length);inner.writeUInt32LE(0x04034b50);inner.writeUInt16LE(20,4);inner.writeUInt16LE(0x800,6);inner.writeUInt32LE(crc(payload),14);inner.writeUInt32LE(payload.length,18);inner.writeUInt32LE(payload.length,22);inner.writeUInt16LE(name.length,26);inner.write(name,30);inner.set(payload,30+name.length);
  const outer=Buffer.alloc(512,65);outer.set(inner,100);const f=fixture([{name:'outer.bin',data:outer},{name,data:payload}]);new DataView(f.bytes.buffer).setUint32(f.positions[2].central+42,f.positions[1].data+100,true);await assert.rejects(accept(f),/Complete local record envelopes overlap/);
});
test('every expanded discarded XML part is scanned before admission, including declared .blob',async()=>{
  const dtd='<!DOCTYPE x [<!ENTITY secret SYSTEM "https://example.invalid/secret">]><x>&secret;</x>';
  for(const name of ['custom/discarded.xml','custom/discarded.rels','custom/unknown.blob']){const contentTypes=types.replace('</Types>',`<Override PartName="/${name}" ContentType="application/custom+xml"/></Types>`),f=fixture([{name:'word/document.xml'},{name,text:dtd,method:8}],{contentTypes});await assert.rejects(accept(f),/DTD\/entity/);}
  await assert.rejects(accept(fixture([{name:'unknown.bin',text:' '.repeat(70000)+'<!DOCTYPE x><x/>',method:8}])),/DTD\/entity/);
  const contentTypes=types.replace('</Types>','<Override PartName="/hidden.bl&#111;b" ContentType="application/custom+&#x78;ml"/></Types>');
  await assert.rejects(accept(fixture([{name:'hidden.blob',data:new Uint8Array([255,255,255,255])}],{contentTypes})),/encoding/);
});
test('literal declaration-looking CDATA/comments and strict UTF8/UTF16 encodings are admitted',async()=>{
  const body='<x><!-- literal <!DOCTYPE nope> --><![CDATA[<!ENTITY inert>]]><a q="&quot;">&#x5e9;&#32;&amp;</a></x>';
  const variants=[encoder.encode('\ufeff<?xml version="1.0" encoding="UTF-8"?>'+body),utf16('<?xml version="1.0" encoding="UTF-16"?>'+body),utf16('<?xml version="1.0" encoding="UTF-16BE"?>'+body,true)];
  for(const data of variants){const r=await accept(fixture([{name:'word/document.xml',data,method:8}]));assert.deepEqual(r.parts.get('word/document.xml'),new Uint8Array(data));r.dispose();}
});
test('XML malformed tags, references, attributes, version, encoding and invalid UTF8 reject',async()=>{
  for(const text of ['<x>&unknown;</x>','<x>&#0;</x>','<x>&#X41;</x>','<x><a></x>','<x a="1" a="2"/>','<x a="1"b="2"/>','<?xml version="1.1"?><x/>','<?xml version="1.0" encoding="UTF-16"?><x/>','<x a=unquoted/>','<x><!-- bad -- comment --></x>'])await assert.rejects(accept(fixture([{name:'discarded.xml',text,method:8}])));
  await assert.rejects(accept(fixture([{name:'word/document.xml',data:new Uint8Array([60,120,62,255,60,47,120,62]),method:8}])),/encoding/);
  await assert.rejects(accept(fixture([{name:'unknown.blob',data:new Uint8Array([60,120,62,255,60,47,120,62]),method:8}])),/encoding/);
});
test('XML depth, attributes and package node caps are enforced while scanning discarded parts',async()=>{
  for(const text of ['<x>'.repeat(65)+'</x>'.repeat(65),'<x '+Array.from({length:33},(_,i)=>`a${i}="x"`).join(' ')+'/>','<x>'+'<a/>'.repeat(100001)+'</x>'])await assert.rejects(accept(fixture([{name:'discarded.xml',text,method:8}])),/nesting|attributes|nodes/);
});
test('actual aggregate expansion counts discarded binary entries',async()=>{
  const data=Buffer.alloc(16*1024*1024,65),f=fixture(Array.from({length:5},(_,i)=>({name:`discarded${i}.bin`,data,method:8})));await assert.rejects(accept(f),/Actual expanded/);
});
test('native raw inflater cancellation drains both ends before retry succeeds',async()=>{
  const Native=globalThis.DecompressionStream,controller=new AbortController(),f=fixture([{name:'discarded.bin',data:Buffer.alloc(1024*1024,65),method:8}]);let active=0,cancels=0,aborts=0,reads=0;
  globalThis.DecompressionStream=class{constructor(format){const stream=new Native(format);return {readable:{getReader(){const reader=stream.readable.getReader();return {async read(){active++;try{const result=await reader.read();if(result.value?.length&&++reads===1)controller.abort();return result;}finally{active--; }},async cancel(reason){cancels++;return reader.cancel(reason);},releaseLock:()=>reader.releaseLock()};}},writable:{getWriter(){const writer=stream.writable.getWriter();return {async write(bytes){active++;try{return await writer.write(bytes);}finally{active--; }},close:()=>writer.close(),async abort(reason){aborts++;return writer.abort(reason);},releaseLock:()=>writer.releaseLock()};}}};}};
  try{await assert.rejects(accept(f,{signal:controller.signal}),{name:'AbortError'});assert.equal(active,0);assert.equal(reads,1);assert.ok(cancels&&aborts);}finally{globalThis.DecompressionStream=Native;}
  const result=await accept(f);assert.equal(result.stats.expandedBytes,encoder.encode(types).length+1024*1024);result.dispose();
});
test('the first underlying reader cancellation must drain before an awaiting successor can start',async()=>{
  const Native=globalThis.DecompressionStream,controller=new AbortController(),f=fixture([{name:'discarded.bin',data:Buffer.alloc(1024*1024,65),method:8}]);
  let releaseCancel,markCancel,markRead,markWriter,cancelCalls=0,successorStarted=false;
  const held=new Promise(resolve=>{releaseCancel=resolve;}),cancelStarted=new Promise(resolve=>{markCancel=resolve;}),readDrained=new Promise(resolve=>{markRead=resolve;}),writerDrained=new Promise(resolve=>{markWriter=resolve;});
  globalThis.DecompressionStream=class{constructor(format){const native=new Native(format),source=native.readable.getReader();let first=true;
    const outer=new ReadableStream({async pull(sink){const result=await source.read();if(result.done)sink.close();else sink.enqueue(result.value);},async cancel(reason){cancelCalls++;markCancel();await source.cancel(reason);await held;}});
    return {readable:{getReader(){const reader=outer.getReader();return {async read(){try{const result=await reader.read();if(result.value?.length&&first){first=false;controller.abort();}return result;}finally{markRead();}},cancel:reason=>reader.cancel(reason),releaseLock:()=>reader.releaseLock()};}},writable:{getWriter(){const writer=native.writable.getWriter();return {write:bytes=>writer.write(bytes),close:()=>writer.close(),async abort(reason){try{return await writer.abort(reason);}finally{markWriter();}},releaseLock:()=>writer.releaseLock()};}}};}};
  const work=accept(f,{signal:controller.signal});const rejected=assert.rejects(work,{name:'AbortError'});const successor=work.catch(()=>{}).then(()=>{successorStarted=true;});
  try{await Promise.all([cancelStarted,readDrained,writerDrained]);await new Promise(resolve=>setImmediate(resolve));assert.equal(successorStarted,false);assert.equal(cancelCalls,1);releaseCancel();await rejected;await successor;assert.equal(successorStarted,true);}finally{releaseCancel();globalThis.DecompressionStream=Native;await work.catch(()=>{});}
  const retry=await accept(f);assert.equal(retry.stats.entries,2);retry.dispose();
});
test('unflagged ASCII names are compatible; unflagged non-ASCII names reject before downstream ambiguity',async()=>{
  for(const name of ['word/document.xml','word/İstanbul.xml']){const f=fixture([{name}]),v=new DataView(f.bytes.buffer),entry=f.positions[1];v.setUint16(entry.local+6,0,true);v.setUint16(entry.central+8,0,true);if(name==='word/document.xml'){const result=await accept(f);result.dispose();}else await assert.rejects(accept(f),/UTF-8 flag/);}
});
test('Buffer, typed-array overrides/subclasses, ArrayBuffer and actual Blob/File inputs have independent standard owned bytes',async()=>{
  const f=fixture([{name:'word/document.xml'}]),original=f.bytes.slice();let calls=0;
  class Bytes extends Uint8Array{slice(){calls++;throw Error('slice must not run');}*[Symbol.iterator](){calls++;throw Error('iterator must not run');}static get [Symbol.species](){calls++;throw Error('species must not run');}}
  class Binary extends ArrayBuffer{slice(){calls++;throw Error('buffer slice must not run');}static get [Symbol.species](){calls++;throw Error('buffer species must not run');}}
  class ActualBlob extends Blob{arrayBuffer(){calls++;throw Error('blob override must not run');}}
  const own=f.bytes.slice();Object.defineProperty(own,'slice',{get(){calls++;throw Error('own slice getter must not run');}});Object.defineProperty(own,Symbol.iterator,{value(){calls++;throw Error('own iterator must not run');}});for(const key of ['buffer','byteOffset','byteLength'])Object.defineProperty(own,key,{get(){calls++;throw Error('own byte getter must not run');}});
  const subclass=new Bytes(original.length);Uint8Array.prototype.set.call(subclass,original);
  const binary=new Binary(original.length);new Uint8Array(binary).set(original);
  const cross=vm.runInNewContext('new Uint8Array(bytes)',{bytes:Array.from(original)});
  const variants=[Buffer.from(original),own,subclass,binary,cross,cross.buffer,new ActualBlob([original]),new Blob([original])];if(typeof File==='function')variants.push(new File([original],'owned.docx'));
  const typed=Object.getPrototypeOf(Uint8Array.prototype),get=(key,input)=>Object.getOwnPropertyDescriptor(typed,key).get.call(input);
  for(const input of variants){let raw=null;if(ArrayBuffer.isView(input))raw=new Uint8Array(get('buffer',input),get('byteOffset',input),get('byteLength',input));else{try{const size=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(input);raw=new Uint8Array(input,0,size);}catch{}}
    const before=raw?.slice();const archive=await admitOoxmlArchive(input,{kind:'docx'});assert.equal(Object.getPrototypeOf(archive.bytes),Uint8Array.prototype);assert.deepEqual(archive.bytes,original);assert.notEqual(archive.bytes,input);if(raw)assert.notEqual(archive.bytes.buffer,raw.buffer);archive.bytes[0]^=1;archive.dispose();if(raw)assert.deepEqual(raw,before);else assert.deepEqual(new Uint8Array(await Blob.prototype.arrayBuffer.call(input)),original);}
  assert.equal(calls,0);
});
test('duck-typed blobs, spoofed tags and other byte-view types are rejected without calling supplied methods',async()=>{
  let calls=0;const fake={get size(){calls++;return 100;},arrayBuffer(){calls++;return new ArrayBuffer(100);},[Symbol.toStringTag]:'Uint8Array'};
  for(const input of [fake,new Uint16Array(40),new DataView(new ArrayBuffer(100)),null])await assert.rejects(admitOoxmlArchive(input,{kind:'docx'}),/actual Blob\/File/);
  assert.equal(calls,0);
});
test('strict comment/text/whitespace controls span stored-entry feed boundaries',async()=>{
  for(let split=1;split<=8;split++){
    const prefix='<x>'+'a'.repeat(16384-split-3);
    for(const ending of ['<!----></x>','<!--a--></x>',']]&gt;</x>']){const archive=await accept(fixture([{name:'word/document.xml',text:prefix+ending}]));archive.dispose();}
    for(const ending of [']]></x>','<!--bad--x--></x>','<a\u00a0q="x"/></x>'])await assert.rejects(accept(fixture([{name:'discarded.xml',text:prefix+ending}])));
  }
  const archive=await accept(fixture([{name:'word/document.xml',text:'<x \t\r\na="1" \t\r\n></x \t\r\n>'}]));archive.dispose();
  for(const text of ['\u00a0<x/>','<x a\u00a0="1"/>','<x a=\u00a0"1"/>','<x a="1"\u00a0/>','<x></x\u00a0>'])await assert.rejects(accept(fixture([{name:'discarded.xml',text}])));
});
test('XML declaration has one exact start position and ordered unique pseudoattributes',async()=>{
  for(const declaration of ['<?xml version="1.0"?>',"<?xml\tversion = '1.0'\r\nencoding = 'UTF-8'\tstandalone = 'yes' ?>",'<?xml version="1.0" standalone="no"?>']){const archive=await accept(fixture([{name:'word/document.xml',text:declaration+'<x/>'}]));archive.dispose();}
  for(const text of [' <?xml version="1.0"?><x/>','<!--before--><?xml version="1.0"?><x/>','<?a?><?xml version="1.0"?><x/>','<?xml version="1.0"?><?xml version="1.0"?><x/>','<x><?xml version="1.0"?></x>','<x/><?xml version="1.0"?>','<?XML version="1.0"?><x/>','<?xml encoding="UTF-8" version="1.0"?><x/>','<?xml version="1.0" encoding="UTF-8" encoding="ISO-8859-1"?><x/>','<?xml version="1.0" standalone="yes" encoding="UTF-8"?><x/>','<?xml version="1.0" unknown="x"?><x/>','<?xml version="1.0" standalone="maybe"?><x/>','<?xml\u00a0version="1.0"?><x/>'])await assert.rejects(accept(fixture([{name:'discarded.xml',text}])));
});
