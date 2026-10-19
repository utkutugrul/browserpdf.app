import { imageDimensions } from './composition-state.js';

const MiB = 1024 * 1024;
export const OOXML_LIMITS = Object.freeze({ rawBytes:32*MiB, entries:512, directoryBytes:MiB, nameBytes:1024, expandedBytes:64*MiB, entryBytes:16*MiB, xmlBytes:8*MiB, retainedXmlBytes:16*MiB, xmlNodes:100000, xmlDepth:64, xmlAttributes:32, assets:48, assetBytes:16*MiB, retainedAssetBytes:48*MiB, dimension:4096, pixels:16000000 });
const check = signal => signal?.throwIfAborted();
const invalid = message => { throw new Error(`Office archive rejected: ${message}`); };
const crcTable = Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crcUpdate(crc,bytes){for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return crc>>>0;}
const crc32 = bytes => (crcUpdate(0xffffffff,bytes)^0xffffffff)>>>0;
const yieldTask = () => new Promise(resolve=>setTimeout(resolve,0));
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const typedTag=Object.getOwnPropertyDescriptor(typedArrayPrototype,Symbol.toStringTag).get;
const typedBuffer=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer').get;
const typedOffset=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset').get;
const typedLength=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteLength').get;
const bufferLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const blobSize=typeof Blob==='function'?Object.getOwnPropertyDescriptor(Blob.prototype,'size').get:null;
const blobRead=typeof Blob==='function'?Blob.prototype.arrayBuffer:null;
const byteSet=Uint8Array.prototype.set;
const xmlSpace=char=>char===' '||char==='\t'||char==='\r'||char==='\n';
function validInputSize(size){if(!Number.isSafeInteger(size)||size<22||size>OOXML_LIMITS.rawBytes)throw new RangeError('Office archives must be nonempty ZIP files at most 32 MiB.');return size;}
async function ownedInput(input,signal){
  let source,size;
  // Brand getters bypass instance overrides, iterators, slice and species.
  if(typedTag.call(input)==='Uint8Array'){
    size=validInputSize(typedLength.call(input));source=new Uint8Array(typedBuffer.call(input),typedOffset.call(input),size);
  }else{
    let actualBuffer=false;try{size=bufferLength.call(input);actualBuffer=true;}catch{}
    if(actualBuffer){validInputSize(size);source=new Uint8Array(input,0,size);}
    else{
      let actualBlob=false;try{size=blobSize?.call(input);actualBlob=size!==undefined;}catch{}
      if(!actualBlob)throw new TypeError('Office input must be an actual Blob/File, ArrayBuffer or Uint8Array.');
      validInputSize(size);const buffer=await blobRead.call(input);check(signal);
      if(bufferLength.call(buffer)!==size)invalid('The input byte count changed while reading.');source=new Uint8Array(buffer,0,size);
    }
  }
  check(signal);const owned=new Uint8Array(size);byteSet.call(owned,source);return owned;
}
function span(start,length,end,label){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||length<0||start+length>end)invalid(`${label} exceeds its containing record.`);return start+length;}
function safeName(bytes){
  if(!bytes.length||bytes.length>OOXML_LIMITS.nameBytes)invalid('Part names must contain 1–1024 encoded bytes.');
  let value;try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{invalid('Part names require UTF-8 or ASCII encoding.');}
  if(value.startsWith('/')||/[\\:\u0000-\u001f\u007f-\u009f%]/u.test(value))invalid('Unsafe or percent-encoded part path.');
  const directory=value.endsWith('/'),parts=(directory?value.slice(0,-1):value).split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'))invalid('Unsafe part path component.');
  return {name:value,key:directory?value.slice(0,-1):value,directory};
}
function extras(bytes,start,length,nameBytes,end){
  const finish=span(start,length,end,'Extra field'),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  while(start<finish){span(start,4,finish,'Extra field header');const id=view.getUint16(start,true),size=view.getUint16(start+2,true);start+=4;span(start,size,finish,'Extra field payload');
    if(id===1||id===0x9901)invalid('ZIP64 and encrypted ZIP features are unsupported.');
    if(id===0x7075){if(size<5||bytes[start]!==1||view.getUint32(start+1,true)!==crc32(nameBytes))invalid('Contradictory Unicode path extra field.');const encoded=bytes.subarray(start+5,start+size);if(safeName(encoded).name!==safeName(nameBytes).name)invalid('Contradictory Unicode path extra field.');}
    start+=size;
  }
}
function indexArchive(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){eocd=i;break;}
  if(eocd<0)invalid('The ZIP end record is missing or truncated.');
  const count=v.getUint16(eocd+10,true),cdSize=v.getUint32(eocd+12,true),cdStart=v.getUint32(eocd+16,true);
  if(v.getUint16(eocd+4,true)||v.getUint16(eocd+6,true)||v.getUint16(eocd+8,true)!==count)invalid('Multidisk archives are unsupported.');
  if(!count||count>OOXML_LIMITS.entries||count===65535||cdSize>OOXML_LIMITS.directoryBytes||cdSize===0xffffffff||cdStart===0xffffffff)invalid('ZIP directory exceeds the 512-entry/1-MiB ZIP32 limits.');
  if(span(cdStart,cdSize,eocd,'Central directory')!==eocd)invalid('Unsupported data between directory and end record.');
  let offset=cdStart;const entries=[],names=new Set();
  for(let i=0;i<count;i++){
    span(offset,46,eocd,'Central header');if(v.getUint32(offset,true)!==0x02014b50)invalid('Invalid central directory signature.');
    const version=v.getUint16(offset+6,true),flags=v.getUint16(offset+8,true),method=v.getUint16(offset+10,true),crc=v.getUint32(offset+16,true),compressed=v.getUint32(offset+20,true),expanded=v.getUint32(offset+24,true),nameLength=v.getUint16(offset+28,true),extraLength=v.getUint16(offset+30,true),commentLength=v.getUint16(offset+32,true),local=v.getUint32(offset+42,true);
    if(version>20||flags&~0x080e||![0,8].includes(method)||(method===0&&(flags&6))||v.getUint16(offset+34,true))invalid('Unsupported ZIP version, flags, disk or compression method.');
    if([compressed,expanded,local].includes(0xffffffff)||expanded>OOXML_LIMITS.entryBytes)invalid('An entry exceeds the ZIP32/16-MiB expanded limit.');
    const nameEnd=span(offset+46,nameLength,eocd,'Central name'),nameBytes=bytes.subarray(offset+46,nameEnd),path=safeName(nameBytes);
    span(nameEnd,extraLength+commentLength,eocd,'Central extra/comment');extras(bytes,nameEnd,extraLength,nameBytes,eocd);
    if(!(flags&0x800)&&nameBytes.some(byte=>byte>=128))invalid('Non-ASCII part names require the ZIP UTF-8 flag.');
    if(names.has(path.key))invalid('Duplicate or conflicting part paths.');names.add(path.key);
    const external=v.getUint32(offset+38,true),system=v.getUint16(offset+4,true)>>>8,mode=external>>>16&0xf000;
    if(system===3&&![0,0x8000,0x4000].includes(mode))invalid('Symlink/device entries are unsupported.');
    if(((external&0x10)!==0||mode===0x4000)&&!path.directory)invalid('Directory attributes disagree with the part name.');
    if(path.directory&&(compressed||expanded||crc||method))invalid('Directory entries must be empty and stored.');
    span(local,30,cdStart,'Local header');if(v.getUint32(local,true)!==0x04034b50||v.getUint16(local+4,true)!==version||v.getUint16(local+6,true)!==flags||v.getUint16(local+8,true)!==method)invalid('Local and central headers disagree.');
    const localNameLength=v.getUint16(local+26,true),localExtraLength=v.getUint16(local+28,true),localNameEnd=span(local+30,localNameLength,cdStart,'Local name');
    if(localNameLength!==nameLength||!nameBytes.every((b,j)=>b===bytes[local+30+j]))invalid('Local and central part names disagree.');
    extras(bytes,localNameEnd,localExtraLength,nameBytes,cdStart);const dataStart=span(localNameEnd,localExtraLength,cdStart,'Local extra'),dataEnd=span(dataStart,compressed,cdStart,'Compressed payload');
    const localCrc=v.getUint32(local+14,true),localCompressed=v.getUint32(local+18,true),localExpanded=v.getUint32(local+22,true);let recordEnd=dataEnd;
    if(flags&8){
      if((localCrc&&localCrc!==crc)||(localCompressed&&localCompressed!==compressed)||(localExpanded&&localExpanded!==expanded))invalid('Contradictory descriptor local sizes or CRC.');
      const candidates=[];for(const signed of [false,true]){const pos=dataEnd+(signed?4:0);if(pos+12<=cdStart&&(!signed||v.getUint32(dataEnd,true)===0x08074b50)&&v.getUint32(pos,true)===crc&&v.getUint32(pos+4,true)===compressed&&v.getUint32(pos+8,true)===expanded)candidates.push(pos+12);}
      if(candidates.length!==1)invalid('Missing, ambiguous or contradictory ZIP32 data descriptor.');recordEnd=candidates[0];
    }else if(localCrc!==crc||localCompressed!==compressed||localExpanded!==expanded)invalid('Local and central CRC/sizes disagree.');
    entries.push({...path,method,flags,crc,compressed,expanded,local,dataStart,dataEnd,recordEnd});offset=nameEnd+extraLength+commentLength;
  }
  if(offset!==eocd)invalid('Directory size/count mismatch.');
  const envelopes=[...entries].sort((a,b)=>a.local-b.local);let end=0;
  for(const entry of envelopes){if(entry.local<end||entry.recordEnd>cdStart)invalid('Complete local record envelopes overlap each other or the directory/end area.');end=entry.recordEnd;}
  return entries;
}

// Incremental XML admission. No DOM or downstream Office parser is invoked.
class XmlScanner {
  constructor(shared,signal,onTag){Object.assign(this,{shared,signal,onTag,state:'text',stack:[],roots:0,textNode:false,token:'',attrs:null,attribute:'',value:'',quote:'',tail:'',entity:null,pi:'',characters:0,textTail:'',declarationSeen:false});}
  node(){if(++this.shared.nodes>OOXML_LIMITS.xmlNodes)invalid('Package XML exceeds 100,000 nodes.');}
  name(char){return /[A-Za-z0-9_.:\-\p{L}\p{N}]/u.test(char);}
  append(char){this.token+=char;if(this.token.length>1024)invalid('An XML name exceeds 1,024 characters.');}
  start(){if(!this.stack.length&&++this.roots>1)invalid('XML has multiple document elements.');this.node();if(this.stack.length>=OOXML_LIMITS.xmlDepth)invalid('XML nesting exceeds 64.');this.tag=this.token;this.token='';this.attrs=Object.create(null);this.attributeCount=0;this.state='inside';}
  finish(empty){this.onTag?.(this.tag,this.attrs);if(!empty)this.stack.push(this.tag);this.state='text';this.textNode=false;}
  attributeDone(){if(this.onTag)this.attrs[this.attribute]=this.value;this.value='';this.state='after-value';}
  feed(text){let count=0;for(const char of text){this.characters++;if((++count&1023)===0)check(this.signal);const cp=char.codePointAt(0);if(!(cp===9||cp===10||cp===13||cp>=32&&cp<=0xd7ff||cp>=0xe000&&cp<=0xfffd||cp>=0x10000&&cp<=0x10ffff))invalid('Invalid XML character.');
      if(this.entity!==null){if(char===';'){const e=this.entity;let value;if(/^#x[0-9a-fA-F]+$/.test(e))value=parseInt(e.slice(2),16);else if(/^#[0-9]+$/.test(e))value=Number(e.slice(1));else if(!['amp','lt','gt','quot','apos'].includes(e))invalid('General/external XML entities are unsupported.');if(value!==undefined&&!(value===9||value===10||value===13||value>=32&&value<=0xd7ff||value>=0xe000&&value<=0xfffd||value>=0x10000&&value<=0x10ffff))invalid('Invalid XML character reference.');if(this.state==='value'&&this.onTag){this.value+=value===undefined?({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[e]:String.fromCodePoint(value);if(this.value.length>4096)invalid('A content-type attribute exceeds 4,096 characters.');}this.entity=null;}else{this.entity+=char;if(this.entity.length>32||/[\s<&]/u.test(char))invalid('Invalid XML entity reference.');}continue;}
      switch(this.state){
        case 'text':if(char==='<'){this.state='open';this.textNode=false;this.textTail='';}else{this.textTail=(this.textTail+char).slice(-3);if(this.textTail===']]>')invalid('The CDATA terminator is forbidden in XML text.');if(char==='&'){this.entity='';this.textTail='';}if(!this.textNode){this.node();this.textNode=true;}if(!this.stack.length&&!xmlSpace(char))invalid('Text outside the XML document element.');}break;
        case 'open':if(char==='/'){this.token='';this.state='end';}else if(char==='?'){this.pi='';this.piAtStart=this.characters===2;this.tail='';this.state='pi';this.node();}else if(char==='!'){this.token='';this.state='bang';}else if(this.name(char)&&!/[0-9.\-]/u.test(char)){this.token=char;this.state='name';}else invalid('Invalid XML opening token.');break;
        case 'name':if(this.name(char))this.append(char);else{this.start();this.inside(char);}break;
        case 'inside':this.inside(char);break;
        case 'attribute':if(this.name(char))this.append(char);else if(char==='='||xmlSpace(char)){this.attribute=this.token;this.token='';if(Object.hasOwn(this.attrs,this.attribute))invalid('Duplicate XML attribute.');if(++this.attributeCount>OOXML_LIMITS.xmlAttributes)invalid('XML element exceeds 32 attributes.');this.attrs[this.attribute]='';this.state=char==='='?'before-value':'after-attribute';}else invalid('Invalid XML attribute.');break;
        case 'after-attribute':if(char==='=')this.state='before-value';else if(!xmlSpace(char))invalid('XML attribute requires an equals sign.');break;
        case 'before-value':if(char==='"'||char==="'"){this.quote=char;this.value='';this.state='value';}else if(!xmlSpace(char))invalid('XML attribute values require quotes.');break;
        case 'value':if(char===this.quote)this.attributeDone();else if(char==='<')invalid('Unescaped XML attribute delimiter.');else if(char==='&')this.entity='';else if(this.onTag){this.value+=char;if(this.value.length>4096)invalid('A content-type attribute exceeds 4,096 characters.');}break;
        case 'after-value':if(xmlSpace(char))this.state='inside';else if(char==='>'||char==='/')this.inside(char);else invalid('XML attributes require separating whitespace.');break;
        case 'empty':if(char!=='>')invalid('Malformed XML empty element.');this.finish(true);break;
        case 'end':if(this.name(char))this.append(char);else if(char==='>'||xmlSpace(char)){if(!this.token||this.stack.pop()!==this.token)invalid('Mismatched XML end tag.');this.token='';this.state=char==='>'?'text':'end-close';this.textNode=false;}else invalid('Invalid XML end tag.');break;
        case 'end-close':if(char==='>')this.state='text';else if(!xmlSpace(char))invalid('Malformed XML end tag.');break;
        case 'bang':this.token+=char;if(this.token==='--'){this.node();this.tail='';this.state='comment';}else if(this.token==='[CDATA['){if(!this.stack.length)invalid('CDATA outside the document element.');this.node();this.tail='';this.state='cdata';}else if(!'--'.startsWith(this.token)&&!'[CDATA['.startsWith(this.token))invalid('DTD/entity and other XML declarations are unsupported.');break;
        case 'comment':this.tail=(this.tail+char).slice(-3);if(this.tail==='-->'){this.state='text';this.textNode=false;}else if(this.tail.length===3&&this.tail.startsWith('--'))invalid('Invalid double hyphen in XML comment.');break;
        case 'cdata':this.tail=(this.tail+char).slice(-3);if(this.tail===']]>'){this.state='text';this.textNode=false;}break;
        case 'pi':this.pi+=char;if(this.pi.length>4096)invalid('XML processing instruction exceeds 4,096 characters.');if(this.pi.endsWith('?>')){this.instruction();this.state='text';this.textNode=false;}break;
        default:invalid('Invalid XML scanner state.');
      }
    }}
  instruction(){
    const body=this.pi.slice(0,-2),target=body.match(/^([^ \t\r\n]+)(?:[ \t\r\n][\s\S]*)?$/)?.[1];
    if(!target||target.length>1024||[...target].some(char=>!this.name(char))||/^[0-9.\-]/u.test(target))invalid('Invalid XML processing-instruction target.');
    if(target.toLowerCase()!=='xml')return;
    if(target!=='xml'||!this.piAtStart||this.declarationSeen||this.roots)invalid('The XML declaration must appear exactly once at the start.');
    const declaration=body.match(/^xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(["'])1\.0\1(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(["'])([A-Za-z][A-Za-z0-9._-]*)\2)?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(["'])(yes|no)\4)?[ \t\r\n]*$/);
    if(!declaration)invalid('Only an ordered, unique XML 1.0 declaration is supported.');
    if(declaration[3]){const declared=declaration[3].toLowerCase(),actual=this.encoding;if(!(['utf-8','utf8'].includes(declared)&&actual==='utf-8'||declared==='utf-16'&&actual.startsWith('utf-16')||declared===actual))invalid('Unsupported or contradictory XML encoding.');}
    this.declarationSeen=true;
  }
  inside(char){if(xmlSpace(char))return;if(char==='>'){this.finish(false);return;}if(char==='/'){this.state='empty';return;}if(this.name(char)&&!/[0-9.\-]/u.test(char)){this.token=char;this.state='attribute';return;}invalid('Malformed XML start tag.');}
  end(){check(this.signal);if(this.state!=='text'||this.entity!==null||this.stack.length||this.roots!==1)invalid('Truncated or incomplete XML document.');}
}

class XmlAdmission {
  constructor(required,shared,signal,onTag){Object.assign(this,{required,shared,signal,onTag,prefix:[],decoder:null,scanner:null,classification:null,skipped:false,bytes:0});}
  init(){const p=this.prefix;if(p[0]===0&&p[1]===0&&(p[2]===254&&p[3]===255||p[2]===0&&p[3]===60)||p[0]===255&&p[1]===254&&p[2]===0&&p[3]===0||p[0]===60&&p[1]===0&&p[2]===0&&p[3]===0)invalid('UTF-32 XML is unsupported.');this.encoding=p[0]===255&&p[1]===254||p[0]===60&&p[1]===0?'utf-16le':p[0]===254&&p[1]===255||p[0]===0&&p[1]===60?'utf-16be':'utf-8';this.sniffSkip=p[0]===239&&p[1]===187&&p[2]===191?3:p[0]===255&&p[1]===254||p[0]===254&&p[1]===255?2:0;this.decoder=new TextDecoder(this.encoding,{fatal:true});const first=new Uint8Array(p);this.prefix=[];this.decode(first,false);}
  feed(bytes){this.bytes+=bytes.length;if(this.required&&this.bytes>OOXML_LIMITS.xmlBytes)invalid('An XML part exceeds 8 MiB.');if(this.classification===false)return;if(!this.decoder){let i=0;while(i<bytes.length&&this.prefix.length<4)this.prefix.push(bytes[i++]);if(this.prefix.length===4){this.init();if(i<bytes.length)this.decode(bytes.subarray(i),false);}}else this.decode(bytes,false);}
  decode(bytes,final){
    if(this.classification===null){if(this.required)this.classification=true;else{for(const byte of bytes){if(this.sniffSkip){this.sniffSkip--;continue;}let code=byte;if(this.encoding!=='utf-8'){if(this.sniffCarry===undefined){this.sniffCarry=byte;continue;}code=this.encoding==='utf-16le'?this.sniffCarry+(byte<<8):(this.sniffCarry<<8)+byte;this.sniffCarry=undefined;}if([9,10,13,32].includes(code))continue;this.classification=code===60;break;}}}
    if(this.classification===false)return;
    let text;try{text=this.decoder.decode(bytes,{stream:!final});}catch{invalid('XML encoding is invalid or unsupported.');}
    if(this.classification===null){this.skipped ||= !!text.length;return;}
    if(this.bytes>OOXML_LIMITS.xmlBytes)invalid('An XML part exceeds 8 MiB.');if(!this.scanner){this.scanner=new XmlScanner(this.shared,this.signal,this.onTag);this.scanner.encoding=this.encoding;if(this.skipped)this.scanner.feed(' ');}this.scanner.feed(text);
  }
  end(){if(!this.decoder)this.init();this.decode(new Uint8Array(),true);if(this.classification)this.scanner.end();return this.classification===true;}
}

async function inflateEntry(bytes,entry,consume,signal){
  check(signal);if(entry.method===0){for(let offset=entry.dataStart;offset<entry.dataEnd;offset+=16384){check(signal);await consume(bytes.subarray(offset,Math.min(entry.dataEnd,offset+16384)));}return;}
  if(typeof DecompressionStream!=='function')invalid('Bounded raw-DEFLATE decompression is unavailable in this browser.');let stream;try{stream=new DecompressionStream('deflate-raw');}catch{invalid('Bounded raw-DEFLATE decompression is unavailable in this browser.');}
  const writer=stream.writable.getWriter(),reader=stream.readable.getReader();let complete=false,canceling=null,aborting=null,reading=null;
  const stop=reason=>{if(!canceling){try{canceling=Promise.resolve(reader.cancel(reason));}catch(error){canceling=Promise.reject(error);}void canceling.catch(()=>{});}if(!aborting){try{aborting=Promise.resolve(writer.abort(reason));}catch(error){aborting=Promise.reject(error);}void aborting.catch(()=>{});}};
  const abort=()=>stop(signal?.reason);signal?.addEventListener('abort',abort,{once:true});
  const writing=(async()=>{for(let offset=entry.dataStart;offset<entry.dataEnd;offset+=16384){check(signal);await writer.write(bytes.subarray(offset,Math.min(entry.dataEnd,offset+16384)));}await writer.close();})();void writing.catch(()=>{});
  try{while(true){check(signal);reading=reader.read();const {value,done}=await reading;check(signal);if(done)break;if(!(value instanceof Uint8Array))invalid('Unexpected inflater output.');await consume(value);}await writing;check(signal);complete=true;}
  finally{signal?.removeEventListener('abort',abort);if(!complete)stop(signal?.reason);await Promise.allSettled([canceling,aborting,reading,writing]);reader.releaseLock();writer.releaseLock();}
}
function retainPart(kind,name){if(name==='[Content_Types].xml'||name==='_rels/.rels')return 'xml';if(kind==='xlsx'&&/^xl\/.+\.(?:xml|rels)$/i.test(name))return 'xml';if(kind==='docx'&&/^word\/(?:document|numbering|styles|settings)\.xml$|^word\/_rels\/document\.xml\.rels$/i.test(name))return 'xml';if(new RegExp(`^${kind==='docx'?'word':'xl'}/media/.+\\.(?:png|jpe?g)$`,'i').test(name))return 'asset';return null;}

export async function admitOoxmlArchive(input,{kind,signal,onProgress}={}){
  if(!['docx','xlsx'].includes(kind))throw new TypeError('Choose a DOCX or XLSX archive kind.');check(signal);
  const bytes=await ownedInput(input,signal);check(signal);
  const entries=indexArchive(bytes),parts=new Map(),stats={entries:entries.length,expandedBytes:0,retainedXmlBytes:0,retainedAssetBytes:0,assets:0,xmlParts:0,xmlNodes:0},shared={nodes:0},xmlExtensions=new Set(['xml','rels']),xmlNames=new Set();let sinceYield=0;
  const contentTypes=entries.find(entry=>entry.name==='[Content_Types].xml');if(!contentTypes)invalid('The Office content-types part is missing.');
  const order=[contentTypes,...entries.filter(entry=>entry!==contentTypes)];
  try{for(const [index,entry] of order.entries()){
      check(signal);const retention=retainPart(kind,entry.name),chunks=[];let length=0,crc=0xffffffff;
      if(retention==='asset'&&++stats.assets>OOXML_LIMITS.assets)invalid('At most 48 embedded images may be retained.');
      const onTag=entry===contentTypes?(tag,attrs)=>{const local=tag.split(':').pop();const type=attrs.ContentType;if(type&&/(?:\+xml|\/xml)$/i.test(type)){if(local==='Default'&&attrs.Extension){if(!/^[A-Za-z0-9]{1,100}$/.test(attrs.Extension))invalid('Invalid XML content-type extension.');xmlExtensions.add(attrs.Extension.toLowerCase());}if(local==='Override'&&attrs.PartName){if(!attrs.PartName.startsWith('/'))invalid('Invalid XML content-type part name.');xmlNames.add(safeName(new TextEncoder().encode(attrs.PartName.slice(1))).name);}}}:undefined;
      const requiredXml=xmlNames.has(entry.name)||xmlExtensions.has(entry.name.split('.').pop().toLowerCase()),xml=new XmlAdmission(requiredXml,shared,signal,onTag);
      await inflateEntry(bytes,entry,async chunk=>{check(signal);if(length+chunk.length>OOXML_LIMITS.entryBytes||stats.expandedBytes+chunk.length>OOXML_LIMITS.expandedBytes||length+chunk.length>entry.expanded)invalid('Actual expanded data exceeds the entry/package/declaration budget.');
        length+=chunk.length;stats.expandedBytes+=chunk.length;crc=crcUpdate(crc,chunk);xml.feed(chunk);
        if(retention==='xml'){if(stats.retainedXmlBytes+chunk.length>OOXML_LIMITS.retainedXmlBytes)invalid('Retained XML exceeds 16 MiB.');stats.retainedXmlBytes+=chunk.length;chunks.push(chunk.slice());}
        if(retention==='asset'){if(stats.retainedAssetBytes+chunk.length>OOXML_LIMITS.retainedAssetBytes||length>OOXML_LIMITS.assetBytes)invalid('Retained images exceed their 16/48-MiB budgets.');stats.retainedAssetBytes+=chunk.length;chunks.push(chunk.slice());}
        sinceYield+=chunk.length;if(sinceYield>=65536){sinceYield=0;await yieldTask();check(signal);}
      },signal);check(signal);
      if(length!==entry.expanded||((crc^0xffffffff)>>>0)!==entry.crc)invalid('An expanded part has an invalid size or CRC.');if(xml.end())stats.xmlParts++;
      if(retention){const joined=new Uint8Array(length);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}if(retention==='asset')imageDimensions(joined,/\.png$/i.test(entry.name)?'image/png':'image/jpeg');parts.set(entry.name,joined);}
      onProgress?.({completed:index+1,total:entries.length,expandedBytes:stats.expandedBytes});await yieldTask();check(signal);
    }
    stats.xmlNodes=shared.nodes;let disposed=false;return {kind,bytes,entries:entries.map(({name,directory,method,compressed,expanded,crc})=>({name,directory,method,compressed,expanded,crc})),parts,stats:Object.freeze({...stats}),dispose(){if(disposed)return;disposed=true;for(const part of parts.values())part.fill(0);parts.clear();bytes.fill(0);}};
  }catch(error){for(const part of parts.values())part.fill(0);parts.clear();bytes.fill(0);check(signal);throw error;}
}
