import { copyProtectionBytes } from './pdf-protection-policy.js';
const yieldEventLoop = () => new Promise(resolve => setTimeout(resolve, 0));
// WHATWG latin1/ascii decoders use Windows-1252. PDF names require exact bytes.
function byteString(bytes, start = 0, end = bytes.length) {
 let result = ''; for (let offset = start; offset < end; offset += 8192) result += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 8192, end))); return result;
}
function equalRange(a, b, start, end) { for (let index = start; index < end; index++) if (a[index] !== b[index]) return false; return true; }
const DEFAULTS={maxBytes:64*1024*1024,maxObjects:100000,maxTokens:1000000,maxDepth:64};
const white=b=>[0,9,10,12,13,32].includes(b);
const delimiter=b=>b===undefined||white(b)||[40,41,60,62,91,93,123,125,47,37].includes(b);
const hex=b=>b>=48&&b<=57||b>=65&&b<=70||b>=97&&b<=102;
export class PolicyError extends Error {constructor(code){super(code);this.name='PolicyError';this.code=code;}}
function fail(code){throw new PolicyError(code);}
class Parser {
 constructor(bytes,{signal,isCurrent=()=>true,limits={},onYield}={}){
  this.b=copyProtectionBytes(bytes,DEFAULTS.maxBytes);this.options={signal,isCurrent,onYield};this.limits={...DEFAULTS,...limits};
  for(const [k,v]of Object.entries(this.limits))if(!Number.isSafeInteger(v)||v<=0||v>DEFAULTS[k])fail('invalid-limit');
  if(this.b.length>this.limits.maxBytes)fail('byte-limit');this.i=0;this.q=[];this.tokens=0;this.lastYield=0;this.nameTokens=[];this.changes=[];this.preserved=[];this.streams=[];this.objects=new Map();this.xrefEntries=new Map();this.references=[];this.yields=0;
 }
 check(){if(this.options.signal?.aborted)fail('aborted');if(!this.options.isCurrent())fail('stale');}
 async checkpoint(force=false){this.check();if(force||this.tokens%256===0||this.i-this.lastYield>=65536){this.lastYield=this.i;this.yields++;this.options.onYield?.(this.yields);this.check();await yieldEventLoop();this.check();}}
 async digest(start,end){this.check();const value=await globalThis.crypto.subtle.digest('SHA-256',this.b.subarray(start,end));this.check();return Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');}
 async nextToken(){
  this.check();const b=this.b;
  while(this.i<b.length){if(white(b[this.i])){this.i++;continue;}if(b[this.i]===37){const start=this.i;while(this.i<b.length&&b[this.i]!==10&&b[this.i]!==13){this.i++;if(this.i-this.lastYield>=65536)await this.checkpoint(true);}this.preserved.push({kind:'comment',start,end:this.i});continue;}break;}
  if(this.i>=b.length)return{kind:'eof',start:this.i,end:this.i};
  this.tokens++;if(this.tokens>this.limits.maxTokens)fail('token-limit');await this.checkpoint();const start=this.i++,c=b[start];let kind,value,isIntegerToken;
  if(c===47){kind='name';const decoded=[];while(this.i<b.length&&!delimiter(b[this.i])){const v=b[this.i];if(v===35){if(!hex(b[this.i+1])||!hex(b[this.i+2]))fail('invalid-name-escape');const d=parseInt(byteString(b,this.i+1,this.i+3),16);if(d===0)fail('null-name');decoded.push(d);for(let j=1;j<=2;j++)if(b[this.i+j]>=97&&b[this.i+j]<=102)this.changes.push(this.i+j);this.i+=3;}else{if(v===0)fail('null-name');decoded.push(v);this.i++;}if(this.i-this.lastYield>=65536)await this.checkpoint(true);}value=byteString(Uint8Array.from(decoded));if(decoded.length===0)fail('empty-name');this.nameTokens.push({start,end:this.i});}
  else if(c===40){kind='string';let depth=1;while(this.i<b.length&&depth){const v=b[this.i++];if(v===92){if(this.i>=b.length)fail('unterminated-literal');if(b[this.i]===13&&b[this.i+1]===10)this.i+=2;else this.i++;}else if(v===40){if(++depth>this.limits.maxDepth)fail('literal-depth-limit');}else if(v===41)depth--;if(this.i-this.lastYield>=65536)await this.checkpoint(true);}if(depth)fail('unterminated-literal');this.preserved.push({kind:'literal',start,end:this.i});}
  else if(c===60&&b[this.i]===60){this.i++;kind='dict-open';}
  else if(c===62&&b[this.i]===62){this.i++;kind='dict-close';}
  else if(c===60){kind='hex-string';while(this.i<b.length&&b[this.i]!==62){if(!white(b[this.i])&&!hex(b[this.i]))fail('invalid-hex-string');this.i++;if(this.i-this.lastYield>=65536)await this.checkpoint(true);}if(b[this.i++]!==62)fail('unterminated-hex-string');this.preserved.push({kind:'hex',start,end:this.i});}
  else if(c===91)kind='array-open';else if(c===93)kind='array-close';
  else if(delimiter(c))fail('unsupported-delimiter');
  else{while(this.i<b.length&&!delimiter(b[this.i])){this.i++;if(this.i-this.lastYield>=65536)await this.checkpoint(true);}const raw=byteString(b,start,this.i);if(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)){kind='number';isIntegerToken=/^[+-]?\d+$/.test(raw);value=Number(raw);if(!Number.isFinite(value))fail('invalid-number');}else{kind='word';value=raw;}}
  return{kind,value,isIntegerToken,start,end:this.i};
 }
 async peek(n=0){while(this.q.length<=n)this.q.push(await this.nextToken());return this.q[n];}
 async take(){return this.q.length?this.q.shift():this.nextToken();}
 async expect(kind,value){const t=await this.take();if(t.kind!==kind||value!==undefined&&t.value!==value)fail('expected-'+(value??kind));return t;}
 async integer(label,max=Number.MAX_SAFE_INTEGER){const t=await this.expect('number');if(!t.isIntegerToken||!Number.isSafeInteger(t.value)||t.value<0||t.value>max)fail(label);return t;}
 async value(depth=0){
  if(depth>this.limits.maxDepth)fail('structural-depth-limit');const t=await this.take();
  if(t.kind==='number'){const a=await this.peek(),b=await this.peek(1);if(a.kind==='number'&&b.kind==='word'&&b.value==='R'){if(!t.isIntegerToken||!a.isIntegerToken||!Number.isSafeInteger(t.value)||!Number.isSafeInteger(a.value)||t.value<0||a.value<0)fail('reference-integer');await this.take();await this.take();if(t.value>this.limits.maxObjects||a.value>65535)fail('reference-limit');const ref={kind:'ref',object:t.value,generation:a.value};this.references.push(ref);return ref;}return{kind:'number',value:t.value,isIntegerToken:t.isIntegerToken};}
  if(t.kind==='name')return{kind:'name',value:t.value};
  if(['string','hex-string'].includes(t.kind))return{kind:t.kind};
  if(t.kind==='word'&&['true','false','null'].includes(t.value))return{kind:t.value};
  if(t.kind==='array-open'){const items=[];while((await this.peek()).kind!=='array-close'){if((await this.peek()).kind==='eof')fail('unterminated-array');items.push(await this.value(depth+1));}await this.take();return{kind:'array',items};}
  if(t.kind==='dict-open'){const entries=new Map();while((await this.peek()).kind!=='dict-close'){const k=await this.expect('name');if(entries.has(k.value))fail('duplicate-dictionary-key');entries.set(k.value,await this.value(depth+1));}await this.take();if(entries.has('Linearized'))fail('linearized');const type=entries.get('Type');if(type?.kind==='name'&&['ObjStm','XRef'].includes(type.value))fail(type.value==='ObjStm'?'object-stream':'xref-stream');return{kind:'dict',entries};}
  fail(t.kind==='eof'?'unexpected-eof':'unsupported-value');
 }
 async object(){
  const n=await this.integer('object-number',this.limits.maxObjects),g=await this.integer('object-generation',65535);if(n.value===0||this.objects.has(n.value))fail('duplicate-or-zero-object');await this.expect('word','obj');const value=await this.value();
  if((await this.peek()).kind==='word'&&(await this.peek()).value==='stream'){
   const token=await this.take();if(this.q.length)fail('stream-lookahead');if(value.kind!=='dict')fail('stream-without-dictionary');const length=value.entries.get('Length');if(length?.kind==='ref')fail('indirect-stream-length');if(length?.kind!=='number'||!length.isIntegerToken||!Number.isSafeInteger(length.value)||length.value<0)fail('direct-integer-stream-length');
   let p=token.end;if(this.b[p]===13){p++;if(this.b[p]===10)p++;}else if(this.b[p]===10)p++;else fail('stream-eol');const start=p,end=p+length.value;if(!Number.isSafeInteger(end)||end>this.b.length)fail('stream-range');p=end;if(this.b[p]===13){p++;if(this.b[p]===10)p++;}else if(this.b[p]===10)p++;
   if(byteString(this.b,p,p+9)!=='endstream'||!delimiter(this.b[p+9]))fail('stream-end-boundary');this.streams.push({start,end,sha256:await this.digest(start,end)});this.preserved.push({kind:'stream',start,end});this.i=p+9;await this.checkpoint(true);
  }
  await this.expect('word','endobj');this.objects.set(n.value,{generation:g.value,offset:n.start,value});if(this.objects.size>this.limits.maxObjects)fail('object-limit');
 }
 async classic(){
  this.check();if(!/^%PDF-1\.[0-7](?:\r\n|\r|\n)/.test(byteString(this.b,0,12)))fail('pdf-header');
  while((await this.peek()).kind==='number')await this.object();const x=await this.expect('word','xref');
  while((await this.peek()).kind==='number'){
   const start=await this.integer('xref-start',this.limits.maxObjects),count=await this.integer('xref-count',this.limits.maxObjects+1);if(count.value===0||start.value+count.value>this.limits.maxObjects+1)fail('xref-range');
   for(let j=0;j<count.value;j++){const o=await this.integer('xref-offset',this.b.length),g=await this.integer('xref-generation',65535),flag=await this.expect('word');const number=start.value+j;if(!['n','f'].includes(flag.value)||this.xrefEntries.has(number))fail('xref-entry');const raw=byteString(this.b,o.start,flag.end);if(!/^\d{10} \d{5} [nf]$/.test(raw))fail('xref-entry-format');this.xrefEntries.set(number,{offset:o.value,generation:g.value,flag:flag.value});}
  }
  await this.expect('word','trailer');const trailer=await this.value();if(trailer.kind!=='dict')fail('trailer-dictionary');for(const [k,c]of[['Encrypt','encrypted'],['Prev','incremental'],['XRefStm','hybrid-xref']])if(trailer.entries.has(k))fail(c);
  const size=trailer.entries.get('Size'),root=trailer.entries.get('Root');if(size?.kind!=='number'||!size.isIntegerToken||!Number.isSafeInteger(size.value)||size.value<1||size.value>this.limits.maxObjects+1)fail('trailer-size');if(root?.kind!=='ref'||!this.objects.has(root.object))fail('trailer-root');
  await this.expect('word','startxref');const offset=await this.integer('startxref-range',this.b.length);if(offset.value!==x.start)fail('startxref-target');if(this.q.length)fail('eof-lookahead');const tail=byteString(this.b,offset.end);if(!/^[\x00\x09\x0a\x0c\x0d\x20]+%%EOF(?:\r\n|\r|\n)?[\x00\x09\x0a\x0c\x0d\x20]*$/.test(tail))fail('single-revision-eof');
  const zero=this.xrefEntries.get(0);if(!zero||zero.flag!=='f'||zero.generation!==65535)fail('xref-zero');if(this.xrefEntries.size!==size.value)fail('xref-size');
  for(const [number,entry]of this.xrefEntries){if(number>=size.value)fail('xref-size');if(entry.flag==='n'){const object=this.objects.get(number);if(!object||object.offset!==entry.offset||object.generation!==entry.generation)fail('xref-object-target');}}
  for(const [number,object]of this.objects){const entry=this.xrefEntries.get(number);if(!entry||entry.flag!=='n'||entry.offset!==object.offset||entry.generation!==object.generation)fail('object-not-in-xref');}
  for(const ref of this.references){const target=this.objects.get(ref.object);if(!target||target.generation!==ref.generation)fail('unresolved-reference');}const catalog=this.objects.get(root.object).value;if(catalog.kind!=='dict'||catalog.entries.get('Type')?.value!=='Catalog')fail('catalog-root');this.check();return{objectCount:this.objects.size,xrefOffset:x.start,xrefSize:size.value};
 }
 async result(shape){
  const out=new Uint8Array(this.b),positions=new Set(this.changes);for(const p of positions)out[p]-=32;
  for(let i=0;i<out.length;i++){if(out[i]!==this.b[i]&&(!positions.has(i)||this.b[i]<97||this.b[i]>102||out[i]!==this.b[i]-32))fail('unexpected-byte-change');if(i%65536===0)await this.checkpoint(true);}
  for(const range of this.preserved){if(!equalRange(out,this.b,range.start,range.end))fail('preserved-range-change');await this.checkpoint();}
  let changedNameTokens=0,change=0;for(const token of this.nameTokens){while(change<this.changes.length&&this.changes[change]<token.start)change++;if(change<this.changes.length&&this.changes[change]<token.end)changedNameTokens++;}
  const preserved=[];for(const range of this.preserved)preserved.push({...range,sha256:await this.digest(range.start,range.end)});this.check();return{bytes:out,facts:{...shape,byteLength:out.length,tokens:this.tokens,yields:this.yields,changedNameTokens,changedHexLetters:positions.size,streamCount:this.streams.length,streams:this.streams,preservedRanges:preserved,onlyRecordedHexLettersChanged:true,sameLength:out.length===this.b.length}};
 }
}
export async function normalizePdfNameEscapeCase(bytes,options={}){const p=new Parser(bytes,options);await p.checkpoint(true);const shape=await p.classic();await p.checkpoint(true);return p.result(shape);}
export async function normalizeFragment(bytes,{object=false,...options}={}){const p=new Parser(bytes,options);await p.checkpoint(true);if(object)await p.object();else await p.value();if((await p.take()).kind!=='eof')fail('fragment-trailing-syntax');await p.checkpoint(true);return p.result({fragment:true});}
