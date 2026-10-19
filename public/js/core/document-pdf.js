import { validateDocumentModel, DOCUMENT_LIMITS } from './document-model.js';
import { imageDimensions } from './composition-state.js';

// Trusted native dependencies are injected. No loader, network or document session.
const MiB = 1024 * 1024, encoder = new TextEncoder();
const REGISTRY = [
  ['regular','NotoSans-Regular.ttf','Noto Sans Regular',569208,'b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5'],
  ['bold','NotoSans-Bold.ttf','Noto Sans Bold',575740,'c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a'],
  ['italic','NotoSans-Italic.ttf','Noto Sans Italic',552776,'36cff144df01309dab648bea71baff9bb074026914afe63aeacc8bc90b67a28b'],
  ['boldItalic','NotoSans-BoldItalic.ttf','Noto Sans Bold Italic',555292,'6edf4227ef0fa846aca70e86a307804ca4401741830f5b3af0f2554abe2b8466'],
  ['code','NotoSansMono-Regular.ttf','Noto Sans Mono Regular',512836,'d9e2b23d19f8230be7146f409a52b1d23117e635e28f2e2892cf91b7382f325b']
];
const features = () => ({kern:false, liga:false, clig:false});
const fail = (suffix, message, issues) => { const error = new Error(message); error.code = `DOCUMENT_PDF_${suffix}`; if (issues) error.issues = issues; throw error; };
const typed = Object.getPrototypeOf(Uint8Array.prototype), tag = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag).get;
const byteLength = Object.getOwnPropertyDescriptor(typed, 'byteLength').get, byteOffset = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get, buffer = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
const abLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get, set = Uint8Array.prototype.set, fill = Uint8Array.prototype.fill;
const signalCheck = AbortSignal.prototype.throwIfAborted, signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get, blobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get, blobRead = Blob.prototype.arrayBuffer;
function record(value, allowed) {
  if (!value || typeof value !== 'object' || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail('INPUT','Expected plain own data.');
  const out = {};
  for (const key of Reflect.ownKeys(value)) { const d = Object.getOwnPropertyDescriptor(value,key); if (typeof key !== 'string' || !allowed.includes(key) || !d.enumerable || !Object.hasOwn(d,'value') || d.value === undefined) fail('INPUT','Invalid own data field.'); out[key] = d.value; }
  return out;
}
function dense(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('INPUT','Expected a standard dense array.');
  const length = Object.getOwnPropertyDescriptor(value,'length').value;
  if (length > max || Reflect.ownKeys(value).length !== length + 1) fail('INPUT','Invalid array bounds or own keys.');
  const out = [];
  for (let i=0;i<length;i++) { const d=Object.getOwnPropertyDescriptor(value,String(i)); if (!d || !d.enumerable || !Object.hasOwn(d,'value') || d.value === undefined) fail('INPUT','Invalid array item.'); out.push(d.value); }
  return out;
}
function options(raw) {
  const o = record(raw,['paper','landscape','margin','assets','signal']);
  if(o.paper===undefined)o.paper='letter';if(o.landscape===undefined)o.landscape=false;if(o.margin===undefined)o.margin=48;if(o.assets===undefined)o.assets=[];
  if (!['letter','a4'].includes(o.paper) || typeof o.landscape !== 'boolean' || !Number.isFinite(o.margin) || o.margin < 0 || o.margin > 72) fail('INPUT','Invalid paper or margins.');
  if (o.signal !== undefined) { try { signalAborted.call(o.signal); } catch { fail('INPUT','Expected an actual AbortSignal.'); } signalCheck.call(o.signal); }
  return o;
}
function environment(o) {
  const usage = {textUnits:0,modelBytes:0,fontBytes:0,assetBytes:0,imagePixels:0,pngPixels:0,workVisits:0,glyphRequests:0,items:0,pages:0,layoutBytes:0,outputBytes:0,resourceBytes:0,resourceCount:0};
  let since = 0, actions = 0;
  const check = () => { if (o.signal) signalCheck.call(o.signal); };
  return {usage,check,visit(n=1) { check(); usage.workVisits += n; since += n; if (usage.workVisits > 32*MiB) fail('LIMIT','Document PDF work exceeds its finite budget.'); },
    async yield(force=false) { if (force || since >= 16384 || ++actions >= 128) { since=0;actions=0; await new Promise(resolve=>setTimeout(resolve,0)); check(); } },
    async job(start) { check(); try { const first = start(); const value = await first; check(); return value; } catch (error) { check(); throw error; } }
  };
}
async function copyBytes(input, env, maximum, blob=false) {
  env.check(); let source, size;
  if (tag.call(input) === 'Uint8Array') { size=byteLength.call(input); source=new Uint8Array(buffer.call(input),byteOffset.call(input),size); }
  else { let actual=false; try { size=abLength.call(input); actual=true; } catch {} if (actual) source=new Uint8Array(input); else {
    if (!blob) fail('INPUT','Font bytes require an actual Uint8Array or ArrayBuffer.');
    try { size=blobSize.call(input); } catch { fail('INPUT','Image bytes require an actual Uint8Array, ArrayBuffer or Blob/File.'); }
    if (!size || size>maximum) fail('LIMIT','Input bytes exceed the finite budget.');
    const data=await env.job(()=>blobRead.call(input)); if (abLength.call(data)!==size) fail('INPUT','Blob byte length changed.'); source=new Uint8Array(data);
  } }
  if (!size || size>maximum) fail('LIMIT','Input bytes exceed the finite budget.');
  const out=new Uint8Array(size); set.call(out,source); return out;
}
function aggregated(prefix='') {
  const values=[], seen=new Map();
  return {values,add(code,blockId,counts) { const key=prefix+code; let value=seen.get(key); if (!value) { if (values.length===100) fail('LIMIT','Report exceeds 100 records.'); value={code:key,occurrences:0,...(blockId?{blockId}:{}),...(counts?{tabs:0,cr:0,crlf:0}:{})};seen.set(key,value);values.push(value); } value.occurrences++; if (counts) for (const k of ['tabs','cr','crlf']) value[k]+=counts[k]||0; }};
}
function issues() {
  const values=[], seen=new Map();
  return {values,add(code,blockId,runIndex,start,end,fontId,cp) { const key=code+'|'+(fontId||'');let value=seen.get(key); if (!value) { if (values.length===100) fail('LIMIT','Issues exceed 100 records.');value={code,occurrences:0,...(blockId?{blockId}:{}),...(runIndex===undefined?{}:{runIndex,start,end}),...(fontId?{fontId}:{}),...(cp===undefined?{}:{codePoints:[]})};seen.set(key,value);values.push(value); } value.occurrences++;if(cp!==undefined&&value.codePoints&&!value.codePoints.includes(cp)&&value.codePoints.length<12)value.codePoints.push(cp); }};
}
function* paragraphs(model) { for(const b of model.blocks) { if(b.kind==='table') { for(const row of b.rows) for(const cell of row) for(const p of cell.paragraphs) yield p; } else if(b.runs) yield b; } }
function sizeOf(p) { return p.kind==='heading'?[22,18,16,14,12,11][p.level-1]:p.kind==='code'?10:11; }
// Called only for a CR at a run's end. Across one paragraph these gaps are
// disjoint: each lookahead ends at the next nonempty run, which a later call
// must itself follow. Charge every inspected run and yield through long gaps.
async function nextTextRun(p,index,env) {
  for(let next=index+1;next<p.runs.length;next++) {
    env.visit();await env.yield();
    if(p.runs[next].text.length)return next;
  }
  return p.runs.length;
}
function marker(p,lists) { return p.kind==='list-item'?(lists.get(p.list.id).ordered?`${p.list.value}.`:'•'):null; }
const eligible = /^(?:\p{Script=Latin}|\p{Script=Greek}|\p{Script=Cyrillic}|\p{Script=Common})$/u;
const marks = /\p{Mark}/u, bidi = /[\u061c\u200c-\u200f\u202a-\u202e\u2066-\u2069]/u;
async function policy(model,env,problem,report) {
  const requested=new Set(),lists=new Map(model.lists.map(x=>[x.id,x]));
  for(const p of paragraphs(model)) {
    env.visit(); if(p.direction==='rtl')problem.add('direction-unproved',p.id);
    if(p.source)report.add('source-page-reflowed',p.id);
    if(marker(p,lists)!==null)requested.add('regular');
    for(let ri=0;ri<p.runs.length;ri++) {
      env.visit();await env.yield();const r=p.runs[ri]; if(r.direction==='rtl')problem.add('direction-unproved',p.id,ri,0,r.text.length,r.style);
      const controls={tabs:0,cr:0,crlf:0};
      for(let i=0;i<r.text.length;) { env.visit(); const cp=r.text.codePointAt(i),c=String.fromCodePoint(cp),end=i+c.length;
        if(c==='\t')controls.tabs++; else if(c==='\r') { if(r.text[i+1]==='\n'||end===r.text.length&&p.runs[await nextTextRun(p,ri,env)]?.text[0]==='\n')controls.crlf++;else controls.cr++; }
        if(!['\t','\r','\n'].includes(c)) { requested.add(r.style); if(/[\u0085\u2028\u2029]/u.test(c))problem.add('font-logical-mapping-unproved',p.id,ri,i,end,r.style,cp);else if(bidi.test(c))problem.add('bidi-controls-unproved',p.id,ri,i,end,r.style,cp);else if(marks.test(c))problem.add('combining-positioning-unproved',p.id,ri,i,end,r.style,cp);else if(!eligible.test(c))problem.add('script-unproved',p.id,ri,i,end,r.style,cp); }
        // A TAB needs this actual run's space metric, but hard breaks alone do not.
        else if(c==='\t')requested.add(r.style);
        i=end+(c==='\r'&&r.text[end]==='\n'?1:0);if(['\t','\r','\n'].includes(c))await env.yield();else if((env.usage.workVisits&16383)===0)await env.yield(true);
      }
      if(controls.tabs+controls.cr+controls.crlf)report.add('control-whitespace-projected',p.id,controls);
    } await env.yield();
  }
  for(const b of model.blocks)if(b.source&&!b.runs)report.add('source-page-reflowed',b.id);
  if(model.warnings.length)report.add('source-warnings-present');
  return REGISTRY.filter(x=>requested.has(x[0])).map(([id,file,label,byteLength,sha256])=>({id,style:id,file,label,byteLength,sha256}));
}
async function admitAssets(model,supplied,owned,env) {
  const expected=new Map(model.assets.map(a=>[a.id,a])), map=new Map();
  for(const raw of dense(supplied,48)) {
    const a=record(raw,['id','type','bytes','width','height']), def=expected.get(a.id);
    if(!def||map.has(a.id)||a.type!==def.type||a.width!==def.width||a.height!==def.height)fail('ASSET','Unexpected, duplicate or mismatched image metadata.');
    const pixels=a.width*a.height;if(env.usage.imagePixels+pixels>16000000||a.type==='image/png'&&env.usage.pngPixels+pixels>8000000)fail('LIMIT','Image pixel budget exceeded.');
    const bytes=await copyBytes(a.bytes,env,16*MiB-env.usage.assetBytes,true);owned.push(bytes);let dims;try{dims=imageDimensions(bytes,a.type);}catch{fail('ASSET','Image bytes have invalid PNG/JPEG dimensions.');}
    if(dims.width!==a.width||dims.height!==a.height)fail('ASSET','Image dimensions disagree with bytes.');
    env.usage.assetBytes+=bytes.length;env.usage.imagePixels+=pixels;if(a.type==='image/png')env.usage.pngPixels+=pixels;map.set(a.id,{...def,bytes});await env.yield();
  }
  for(const b of model.blocks)if(b.kind==='image'&&!map.has(b.assetId))fail('ASSET','A referenced image is missing.');
  return map;
}
async function admitFonts(inputs,requests,fontkit,owned,env) {
  const required=new Map(requests.map(x=>[x.id,x])), map=new Map();
  for(const raw of dense(inputs,5)) {const f=record(raw,['id','bytes']);if(!required.has(f.id)||map.has(f.id))fail('INPUT','Unexpected, duplicate or unused font.');const pin=required.get(f.id);
    const bytes=await copyBytes(f.bytes,env,Math.min(pin.byteLength,3*MiB-env.usage.fontBytes));owned.push(bytes);if(bytes.length!==pin.byteLength)fail('FONT_INTEGRITY','Font size does not match the fixed registry.');
    if(!globalThis.crypto?.subtle)fail('DEPENDENCY','Native SHA-256 is required for supplied fonts.');
    const hash=await env.job(()=>crypto.subtle.digest('SHA-256',bytes));const hex=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');if(hex!==pin.sha256)fail('FONT_INTEGRITY','Font digest does not match the fixed registry.');
    env.usage.fontBytes+=bytes.length;map.set(f.id,{bytes});
  }
  const missing=requests.filter(r=>!map.has(r.id)).map(r=>r.id);if(missing.length)return {map,missing};
  if(requests.length&&typeof fontkit?.create!=='function')fail('DEPENDENCY','The pinned public fontkit module is required for actual font requests.');
  for(const [id,value]of map) {env.check();value.native=fontkit.create(value.bytes);env.check();const f=value.native;if(!Number.isFinite(f.unitsPerEm)||f.unitsPerEm<=0||!Number.isFinite(f.ascent)||!Number.isFinite(f.descent))fail('METRICS','Invalid native font metrics.');value.widths=new Map();value.mapping=new Map();value.id=id;await env.yield();}
  return {map,missing};
}
function metricSpan(value,text,where,env,problem) {
  if(!text)return;
  if(text.length>4096)fail('LIMIT','Native span exceeds 4096 UTF-16 units.');
  const cps=Array.from(text,c=>c.codePointAt(0));env.visit(cps.length);if(env.usage.glyphRequests+cps.length>2000000)fail('LIMIT','Native glyph requests exceed two million.');env.usage.glyphRequests+=cps.length;
  let run; try {run=value.native.layout(text,features());}catch {problem.add('font-positioning-unproved',...where,value.id);return;}
  env.check();let index=0;
  for(let gi=0;gi<run.glyphs.length;gi++) {const g=run.glyphs[gi],pos=run.positions[gi],mapped=Array.from(g.codePoints||[]);const key=mapped.join(',');
    if(!g.id||mapped.some(cp=>!value.native.hasGlyphForCodePoint(cp)))problem.add('glyph-missing',...where,value.id,mapped[0]);
    if(mapped.length!==1||mapped[0]!==cps[index]||value.mapping.has(g.id)&&value.mapping.get(g.id)!==key)problem.add('font-logical-mapping-unproved',...where,value.id,mapped[0]);
    if(!pos||pos.xAdvance!==g.advanceWidth||pos.yAdvance!==0||pos.xOffset!==0||pos.yOffset!==0)problem.add('font-positioning-unproved',...where,value.id,mapped[0]);
    if(mapped.length===1) {value.widths.set(mapped[0],g.advanceWidth/value.native.unitsPerEm);value.mapping.set(g.id,key);}index+=mapped.length;
  }
  if(index!==cps.length)problem.add('font-logical-mapping-unproved',...where,value.id);
}
async function metrics(model,fonts,env,problem) {
  const lists=new Map(model.lists.map(x=>[x.id,x]));
  for(const p of paragraphs(model)) {
    const label=marker(p,lists);if(label!==null)metricSpan(fonts.get('regular'),label,[p.id,undefined,undefined,undefined],env,problem);
    for(let ri=0;ri<p.runs.length;ri++) {env.visit();await env.yield();const r=p.runs[ri],f=fonts.get(r.style);let start=0;
      for(let i=0;i<=r.text.length;) {env.visit();const control=i===r.text.length||['\t','\r','\n'].includes(r.text[i]);if(control||i-start>=4094) {if(i>start)metricSpan(f,r.text.substring(start,i),[p.id,ri,start,i],env,problem);if(control) {if(r.text[i]==='\t')metricSpan(f,' ',[p.id,ri,i,i+1],env,problem);i++;}start=i;await env.yield(); }else i+=String.fromCodePoint(r.text.codePointAt(i)).length;if((env.usage.workVisits&16383)===0)await env.yield(true); }
    }await env.yield();
  }
}
function width(fonts,id,text,size) {const f=fonts.get(id);let n=0;for(const c of text){const advance=f?.widths.get(c.codePointAt(0));if(advance===undefined)fail('METRICS','Missing admitted scalar metrics.');n+=advance*size;}return n;}
function lineMetric(fonts,id,size) {const f=fonts.get(id)?.native;return f?{height:Math.max(size*1.35,(f.ascent-f.descent)/f.unitsPerEm*size),ascent:f.ascent/f.unitsPerEm*size}:{height:size*1.35,ascent:size};}
function layouter(model,fonts,o,env,report) {
  let [W,H]=o.paper==='letter'?[612,792]:[595.28,841.89];if(o.landscape)[W,H]=[H,W];const M=o.margin,CW=W-2*M,CH=H-2*M;
  const layout={version:1,paper:{width:W,height:H,margin:M},pages:[],warnings:model.warnings};
  let page,y=M,operators=0,jsonEstimate=256,fragments=0,drawGlyphs=0;const lists=new Map(model.lists.map(x=>[x.id,x]));
  function reserve(item) {env.visit();if(++fragments>200000)fail('LIMIT','Layout exceeds 200000 items.');jsonEstimate+=encoder.encode(JSON.stringify(item)).length+129;if(jsonEstimate>DOCUMENT_LIMITS.layoutBytes-128000)fail('LIMIT','Layout JSON exceeds its finite budget.');if(['text','marker'].includes(item.kind)){const n=Array.from(item.text).length;drawGlyphs+=2*n;if(env.usage.glyphRequests+drawGlyphs>2000000)fail('LIMIT','Planned native glyph requests exceed two million.');operators+=512+4*n;}else if(['image','rule','border'].includes(item.kind))operators+=512;if(operators>8*MiB)fail('LIMIT','PDF operator estimate exceeds 8 MiB.');return item;}
  function newPage() {if(layout.pages.length===1000)fail('LIMIT','PDF exceeds 1000 pages.');page={number:layout.pages.length+1,width:W,height:H,items:[]};layout.pages.push(page);y=M;}
  function emit(item,b) {const value={...item,...(b.source?{sourcePage:b.source.pageNumber}:{})};for(const key of ['x','y','width','height'])if(!Number.isFinite(value[key])||value[key]<-1e-6)fail('METRICS','Nonfinite or negative geometry.');if(value.x+value.width>W+1e-6||value.y+value.height>H+1e-6)fail('METRICS','Geometry exceeds the page.');page.items.push(value);}
  function room(h) {if(h>CH+1e-6)fail('LIMIT','A layout band cannot fit a fresh page.');if(y+h>H-M+1e-6)newPage();}
  function simple(b,kind,h,extra={}) {room(h);const item=reserve({kind,blockId:b.id,x:M,y,width:CW,height:h,...extra});emit(item,b);y+=h;}
  async function lines(p,available) {
    const size=sizeOf(p),label=marker(p,lists);let inset=0,labelWidth=0;
    if(label!==null) {labelWidth=width(fonts,'regular',label,size);inset=p.list.level*18+labelWidth+6;}
    const content=available-inset;if(content<=0)fail('LIMIT','List indentation leaves no content width.');
    const result=[],skipLeadingLf=new Set();let line={items:[],height:size*1.35,ascent:size,width:0},x=0,pending=null;
    function flush() {if(pending){line.items.push(reserve(pending));pending=null;}}
    function finish(reason,continuation) {flush();if(!line.items.length)line.items.push(reserve({kind:'empty-line',blockId:p.id,x:inset,y:0,width:0,height:0,size,paragraphDirection:p.direction}));if(reason)line.items.push(reserve(reason));if(continuation)line.items.push(reserve(continuation));result.push(line);line={items:[],height:size*1.35,ascent:size,width:0};x=0;}
    function boundary(reason,ri,start,end,sourceText) {return {kind:'break',blockId:p.id,x:inset+x,y:0,width:0,height:0,reason,...(ri===undefined?{}:{runIndex:ri,start,end}),sourceText};}
    for(let ri=0;ri<p.runs.length;ri++) {env.visit();await env.yield();const r=p.runs[ri],lm=lineMetric(fonts,r.style,size);flush();
      for(let i=skipLeadingLf.has(ri)?1:0;i<r.text.length;) {env.visit();const cp=r.text.codePointAt(i),c=String.fromCodePoint(cp);let end=i+c.length;
        if(c==='\r'||c==='\n') {let continuation;if(c==='\r'&&r.text[end]==='\n')end++;else if(c==='\r'&&end===r.text.length){const next=await nextTextRun(p,ri,env);if(p.runs[next]?.text[0]==='\n'){skipLeadingLf.add(next);continuation=boundary('source-lf',next,0,1,'\n');}}finish(boundary(c==='\r'?(end-i===2?'source-crlf':'source-cr'):'source-lf',ri,i,end,r.text.substring(i,end)),continuation);i=end;await env.yield();continue;}
        if(c==='\t') {flush();const advance=width(fonts,r.style,' ',size),stop=p.kind==='code'?advance*4:36;if(!(stop>0)||stop>content+1e-6)fail('LIMIT','Column cannot fit a tab stop.');let target=(Math.floor((x+1e-8)/stop)+1)*stop;if(target>content+1e-6){finish(boundary('wrap',ri,i,i,''));target=stop;}const count=Math.floor((target-x+1e-8)/advance);if(count>64)fail('LIMIT','Tab projection exceeds 64 spaces.');const text=' '.repeat(count);line.items.push(reserve({kind:'text',blockId:p.id,x:inset+x,y:0,width:advance*count,height:0,runIndex:ri,start:i,end,text,fontId:r.style,size,direction:r.direction,paragraphDirection:p.direction}));x=target;line.width=x;line.height=Math.max(line.height,lm.height);line.ascent=Math.max(line.ascent,lm.ascent);i=end;await env.yield();continue;}
        const w=width(fonts,r.style,c,size);if(w>content+1e-6)fail('LIMIT','A single glyph cannot fit its column.');
        // Prefer a fresh line for a word that fits whole. Whitespace remains literal.
        if(c!==' '&&c!=='\u00a0'&&(i===0||/[ \t\r\n]/.test(r.text[i-1]))&&x>0) {let token=0,j=i;while(j<r.text.length&&!/[ \t\r\n]/.test(r.text[j])&&token<=content){const v=String.fromCodePoint(r.text.codePointAt(j));env.visit();token+=width(fonts,r.style,v,size);j+=v.length;}if(token<=content&&x+token>content+1e-6)finish(boundary('wrap',ri,i,i,''));}
        if(x+w>content+1e-6) {finish(boundary('wrap',ri,i,i,''));report.add(p.kind==='code'?'code-wrapped':'unbreakable-token-wrapped',p.id);}
        if(pending&&(pending.end!==i||pending.text.length+c.length>4096))flush();if(!pending)pending={kind:'text',blockId:p.id,x:inset+x,y:0,width:0,height:0,runIndex:ri,start:i,end:i,text:'',fontId:r.style,size,direction:r.direction,paragraphDirection:p.direction};pending.text+=c;pending.end=end;pending.width+=w;
        x+=w;line.width=x;line.height=Math.max(line.height,lm.height);line.ascent=Math.max(line.ascent,lm.ascent);i=end;if((env.usage.workVisits&16383)===0)await env.yield(true);
      }
    }
    finish();if(label!==null) {const lm=lineMetric(fonts,'regular',size);result[0].height=Math.max(result[0].height,lm.height);result[0].ascent=Math.max(result[0].ascent,lm.ascent);result[0].items.unshift(reserve({kind:'marker',blockId:p.id,x:p.list.level*18,y:0,width:labelWidth,height:0,text:label,fontId:'regular',size,listLevel:p.list.level,listValue:p.list.value,restart:p.list.restart}));}
    return result;
  }
  function placeLine(line,b,xOrigin) {room(line.height);for(const item of line.items)emit({...item,x:xOrigin+item.x,y:y+(item.kind==='text'||item.kind==='marker'?line.ascent:0),height:0},b);y+=line.height;}
  async function paragraph(p,available=CW,x=M) {if(p.kind==='heading'){room(8+sizeOf(p)*1.35);y+=8;}for(const line of await lines(p,available)){placeLine(line,p,x);await env.yield();}y=Math.min(H-M,y+(p.kind==='list-item'?4:6));}
  async function table(b) {
    const sum=b.columnWidths.reduce((a,c)=>a+c,0),widths=b.columnWidths.map(v=>CW*v/sum);if(widths.some(v=>v<=8))fail('LIMIT','Table columns cannot fit padding.');
    for(let row=0;row<b.rows.length;row++) {const cells=[];
      for(let col=0;col<widths.length;col++) {const queue=[];for(const p of b.rows[row][col].paragraphs) {if(p.kind==='heading')queue.push({gap:8,p});const ls=await lines(p,widths[col]-8);for(const line of ls)queue.push({line,p});queue.push({gap:p.kind==='list-item'?4:6,p});await env.yield();}if(!queue.length)queue.push({line:{items:[],height:14.85,ascent:11},p:b});cells.push(queue);}
      let synchronized=0;const bands=Math.max(...cells.map(q=>q.length));for(let band=0;band<bands;band++){env.visit(cells.length);if((band&127)===0)await env.yield(true);synchronized+=Math.max(...cells.map(q=>{const a=q[band];return a?(a.gap??a.line.height):0;}));}const total=synchronized+8;if(total<=CH)room(total);else report.add('table-row-split',b.id);
      const indices=cells.map(()=>0);
      while(indices.some((n,i)=>n<cells[i].length)) {
        if(H-M-y<8+Math.max(...cells.map((q,i)=>q[indices[i]]?.line?.height||q[indices[i]]?.gap||0)))newPage();
        const top=y;let used=4;const positions=[];
        while(true) {const band=Math.max(...cells.map((q,i)=>{const a=q[indices[i]];return a?(a.gap??a.line.height):0;}));if(!band)break;if(used+band+4>H-M-top+1e-6)break;
          let left=M;for(let col=0;col<cells.length;col++){const a=cells[col][indices[col]];if(a?.line){for(const item of a.line.items)positions.push({item:{...item,x:left+4+item.x,y:top+used+(item.kind==='text'||item.kind==='marker'?a.line.ascent:0),height:0},p:a.p});}if(a)indices[col]++;left+=widths[col];}used+=band;await env.yield();
        }
        if(used===4)fail('LIMIT','A table line cannot fit its page.');used+=4;for(const {item,p}of positions)emit(item,p);let left=M;for(let col=0;col<widths.length;col++){emit(reserve({kind:'border',blockId:b.id,x:left,y:top,width:widths[col],height:used,row,column:col,thickness:0.5}),b);left+=widths[col];}y=top+used;if(indices.some((n,i)=>n<cells[i].length))newPage();
      }await env.yield();
    }y=Math.min(H-M,y+6);
  }
  return {layout,async run() {newPage();for(const b of model.blocks) {env.visit();if(b.runs)await paragraph(b);else if(b.kind==='table')await table(b);else if(b.kind==='page-break'){emit(reserve({kind:'break',blockId:b.id,x:M,y,width:0,height:0,reason:'page-break',sourceText:''}),b);newPage();}else if(b.kind==='rule'){simple(b,'rule',1,{thickness:0.5});y=Math.min(H-M,y+6);}else if(b.kind==='image'){const scale=Math.min(1,CW/b.width,CH/b.height);if(scale<1)report.add('image-scaled-to-fit',b.id);room(b.height*scale);emit(reserve({kind:'image',blockId:b.id,x:M,y,width:b.width*scale,height:b.height*scale,assetId:b.assetId}),b);y+=b.height*scale;y=Math.min(H-M,y+6);}await env.yield();}env.usage.items=fragments;env.usage.pages=layout.pages.length;return layout;}};
}
function disposeBytes(buffers) {let disposed=false;return()=>{if(!disposed){disposed=true;for(const bytes of buffers)fill.call(bytes,0);}};}
async function prepare(input,deps,rawOptions) {
  const o=options(rawOptions),env=environment(o),owned=[],problem=issues(),report=aggregated('document-pdf-');
  try {
    env.check();let model;try {model=validateDocumentModel(input,{signal:{throwIfAborted:env.check}});}catch(error){env.check();fail(error instanceof RangeError?'LIMIT':'INPUT',error.message);}
    const modelJson=JSON.stringify(model);env.usage.modelBytes=encoder.encode(modelJson).length;env.visit(modelJson.length);
    for(const p of paragraphs(model))for(const r of p.runs){env.visit();env.usage.textUnits+=r.text.length;await env.yield();}for(const a of model.assets)env.usage.textUnits+=a.alt.length;
    const requests=await policy(model,env,problem,report),assets=await admitAssets(model,o.assets,owned,env);
    // Unsupported source publishes zero requests. All supplied fonts are therefore
    // unused and reject through the same strict record admission, without parsing.
    if(problem.values.length) {await admitFonts(deps.fonts===undefined?[]:deps.fonts,[],undefined,owned,env);return {env,owned,model,assets,status:'unsupported',fontRequests:[],missingFontIds:[],issues:problem.values,report:report.values};}
    const {map:fonts,missing}=await admitFonts(deps.fonts===undefined?[]:deps.fonts,requests,deps.fontkit,owned,env);
    const common={env,owned,model,assets,fonts,fontRequests:requests,missingFontIds:missing,issues:problem.values,report:report.values};
    if(missing.length)return {...common,status:'needs-fonts'};
    await metrics(model,fonts,env,problem);if(problem.values.length)return {...common,status:'unsupported',fontRequests:[],missingFontIds:[]};
    const layout=await layouter(model,fonts,o,env,report).run(),json=JSON.stringify(layout);if(encoder.encode(json).length>16*MiB)fail('LIMIT','Layout JSON exceeds 16 MiB.');const layoutBytes=encoder.encode(json);owned.push(layoutBytes);env.usage.layoutBytes=layoutBytes.length;
    return {...common,status:'ready',layout,layoutBytes};
  }catch(error){disposeBytes(owned)();throw error;}
}
function commonResult(p) {return {status:p.status,fontRequests:p.fontRequests,missingFontIds:p.missingFontIds,issues:p.issues,report:p.report,usage:{...p.env.usage}};}
export async function preflightDocumentPdf(model,deps={},rawOptions={}) {
  const p=await prepare(model,deps,rawOptions);try {const result=commonResult(p);if(p.status==='ready'){p.owned.splice(p.owned.indexOf(p.layoutBytes),1);result.layout=p.layout;result.layoutBytes=p.layoutBytes;result.dispose=disposeBytes([p.layoutBytes]);result.usage.resourceBytes=p.layoutBytes.length;result.usage.resourceCount=1;}return result;}finally{disposeBytes(p.owned)();}
}
export async function buildDocumentPdf(model,deps={},rawOptions={}) {
  const p=await prepare(model,deps,rawOptions);try {
    if(p.status!=='ready')fail('UNSUPPORTED',p.status==='needs-fonts'?'Required fonts have not been supplied.':'The requested content has unproved PDF support.',p.issues);
    const lib=deps.pdfLib;if(typeof lib?.PDFDocument?.create!=='function')fail('DEPENDENCY','The pinned public pdf-lib module is required.');
    const pdf=await p.env.job(()=>lib.PDFDocument.create());if(p.fonts.size)pdf.registerFontkit(deps.fontkit);
    const fonts=new Map();for(const [id,f]of p.fonts){const embedded=await p.env.job(()=>pdf.embedFont(f.bytes,{subset:true,customName:`Document-${id}`,features:features()}));fonts.set(id,embedded);await p.env.yield();}
    const images=new Map();for(const page of p.layout.pages)for(const item of page.items)if(item.kind==='image'&&!images.has(item.assetId)){const a=p.assets.get(item.assetId);const image=await p.env.job(()=>a.type==='image/png'?pdf.embedPng(a.bytes):pdf.embedJpg(a.bytes));images.set(item.assetId,image);}
    for(const plan of p.layout.pages) {const page=pdf.addPage([plan.width,plan.height]);for(const item of plan.items) {p.env.visit();if(item.kind==='text'||item.kind==='marker'){if(!item.text)continue;const glyphs=Array.from(item.text).length;if(p.env.usage.glyphRequests+2*glyphs>2000000)fail('LIMIT','Native glyph requests exceed two million.');p.env.usage.glyphRequests+=2*glyphs;const font=fonts.get(item.fontId),actual=font.widthOfTextAtSize(item.text,item.size);if(Math.abs(actual-item.width)>1e-6)fail('METRICS','Saved font width differs from the admitted layout.');page.drawText(item.text,{x:item.x,y:plan.height-item.y,size:item.size,font});}else if(item.kind==='image')page.drawImage(images.get(item.assetId),{x:item.x,y:plan.height-item.y-item.height,width:item.width,height:item.height});else if(item.kind==='rule')page.drawLine({start:{x:item.x,y:plan.height-item.y},end:{x:item.x+item.width,y:plan.height-item.y},thickness:item.thickness});else if(item.kind==='border'){const x=item.x,y=plan.height-item.y,w=item.width,h=item.height;for(const [a,b]of [[[x,y],[x+w,y]],[[x+w,y],[x+w,y-h]],[[x+w,y-h],[x,y-h]],[[x,y-h],[x,y]]])page.drawLine({start:{x:a[0],y:a[1]},end:{x:b[0],y:b[1]},thickness:item.thickness});}await p.env.yield();}}
    // Native save is not a bounded stream and cannot be aborted. Await the FIRST job.
    const saved=await p.env.job(()=>pdf.save({useObjectStreams:true,addDefaultPage:false,objectsPerTick:50,updateFieldAppearances:false}));if(byteLength.call(saved)>32*MiB)fail('LIMIT','Saved PDF exceeds 32 MiB after native serialization.');
    // Save has finished consuming admitted image/font buffers. Release those before
    // allocating the final owned PDF copy; native internals have no disposal API.
    for(let i=p.owned.length-1;i>=0;i--)if(p.owned[i]!==p.layoutBytes){fill.call(p.owned[i],0);p.owned.splice(i,1);}
    const bytes=await copyBytes(saved,p.env,32*MiB);p.owned.push(bytes);p.env.usage.outputBytes=bytes.length;p.env.usage.resourceBytes=bytes.length+p.layoutBytes.length;p.env.usage.resourceCount=2;if(p.env.usage.resourceBytes>48*MiB)fail('LIMIT','Returned PDF and layout exceed 48 MiB.');
    p.owned.splice(p.owned.indexOf(bytes),1);p.owned.splice(p.owned.indexOf(p.layoutBytes),1);return {bytes,type:'application/pdf',layout:p.layout,layoutBytes:p.layoutBytes,report:p.report,usage:{...p.env.usage},dispose:disposeBytes([bytes,p.layoutBytes])};
  }finally{disposeBytes(p.owned)();}
}
