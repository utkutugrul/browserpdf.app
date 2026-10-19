import {validateSpreadsheetModel,SPREADSHEET_LIMITS} from './spreadsheet-model.js';
import {assertDocumentWorkspaceBudget} from './document-draft.js';

const MiB=1024*1024,abort=AbortSignal.prototype.throwIfAborted;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const EMPTY={retainedBytes:0,resourceBytes:0,resourceCount:0};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const fail=(code,message)=>{const e=new Error(message);e.code=`PDF_TABLE_${code}`;throw e;};
function record(value,keys){if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INPUT','Expected plain PDF table data.');const out={};for(const k of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,k);if(typeof k!=='string'||!keys.includes(k)||!d.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Invalid PDF table property.');out[k]=d.value;}return out;}
async function array(value,max,m){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail('INPUT','Expected standard dense geometry arrays.');const n=Object.getOwnPropertyDescriptor(value,'length')?.value;if(!Number.isSafeInteger(n)||n<0||n>max||Reflect.ownKeys(value).length!==n+1)fail('INPUT','Geometry array exceeds its finite bound.');const out=[];for(let i=0;i<n;i++){m?.visit();if(m)await m.step();const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Geometry arrays require own data.');out.push(d.value);}return out;}
const num=(v,a,b)=>{if(!Number.isFinite(v)||v<a||v>b)fail('INPUT','Invalid finite PDF geometry.');return v;};
const integer=(v,a,b)=>{if(!Number.isSafeInteger(v)||v<a||v>b)fail('INPUT','Invalid PDF table integer.');return v;};
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(v))fail('INPUT','Invalid region identity.');return v;};
async function matrix(v,m){const a=await array(v,6,m);if(a.length!==6)fail('INPUT','Affine transform needs six numbers.');for(const n of a)num(n,-1000000,1000000);return a;}
const point=(m,x,y)=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
const contains=(r,p)=>p.x>=r.box.x&&p.x<=r.box.x+r.box.width&&p.y>=r.box.y&&p.y<=r.box.y+r.box.height;
const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
async function sorted(input,compare,m){
  let src=input.slice(),dst=new Array(input.length);for(let width=1;width<src.length;width*=2){for(let start=0;start<src.length;start+=2*width){let a=start,b=Math.min(start+width,src.length),endA=b,endB=Math.min(start+2*width,src.length),at=start;while(a<endA||b<endB){m.visit(3);await m.step();if(b===endB||a<endA&&compare(src[a],src[b])<=0)dst[at++]=src[a++];else dst[at++]=src[b++];}}[src,dst]=[dst,src];}return src;
}

export async function inferPdfTables(input,options={}){
  const o=record(options,['signal','yieldControl','getUsage','onUsage','workLimit']);if(o.signal!==undefined){try{aborted.call(o.signal);}catch{fail('INPUT','Expected a genuine AbortSignal.');}abort.call(o.signal);}for(const k of ['yieldControl','getUsage','onUsage'])if(o[k]!==undefined&&typeof o[k]!=='function')fail('INPUT','Invalid trusted inference callback.');
  const maximum=integer(o.workLimit??SPREADSHEET_LIMITS.workVisits,0,SPREADSHEET_LIMITS.workVisits);
  const get=o.getUsage??(()=>({snapshot:EMPTY,live:{}})),yieldControl=o.yieldControl??pause;let visits=0,actions=0,since=0,result,units=0,itemCount=0,regionCount=0;const reserve={resourceBytes:32*MiB,resourceCount:2};
  const check=()=>{if(o.signal)abort.call(o.signal);};
  const external=()=>{check();const u=record(get(),['snapshot','live']);assertDocumentWorkspaceBudget(u.snapshot,u.live);check();return u;};
  const budget=extra=>{const u=external();assertDocumentWorkspaceBudget(u.snapshot,u.live,{resourceBytes:reserve.resourceBytes+(extra?.resourceBytes??0),resourceCount:reserve.resourceCount+(extra?.resourceCount??0)});check();};
  const m={visit(n=1){check();visits+=n;since+=n;if(visits>maximum)fail('LIMIT','PDF table inference exceeds32Mi visits.');},async step(force=false){check();actions++;if(force||since>=16384||actions%128===0){const first=yieldControl({workVisits:visits,actions});await first;check();budget();since=0;}}};
  const reports=[],reportMap=new Map(),sheets=[],unplaced=[];
  function report(code,sheetId,pageNumber,count=1){const key=code+':'+sheetId+':'+pageNumber;if(reportMap.has(key)){reportMap.get(key).count+=count;return;}if(reports.length===100)fail('LIMIT','Too many inference reports.');const r={code,sheetId,pageNumber,count};reports.push(r);reportMap.set(key,r);}
  function keep(p,index,item,reason){unplaced.push({pageNumber:p.number,itemRef:index,text:item.text,reason,x:item.x,y:item.y});report(reason,null,p.number);}
  try{
    budget({resourceBytes:48*MiB,resourceCount:2});o.onUsage?.({...reserve});check();await m.step(true);
    const root=record(input,['pages']),pages=await array(root.pages,100,m),numbers=new Set();
    for(const rawPage of pages){
      m.visit();await m.step();const p=record(rawPage,['number','viewport','items','regions']);integer(p.number,1,1000);if(numbers.has(p.number))fail('INPUT','Duplicate source page number.');numbers.add(p.number);
      const v=record(p.viewport,['width','height','transform']);num(v.width,0.001,1000000);num(v.height,0.001,1000000);const t=await matrix(v.transform,m);if(Math.abs(t[0]*t[3]-t[1]*t[2])<1e-12)fail('INPUT','Viewport transform is singular.');
      const rawItems=await array(p.items,10000,m),rawRegions=await array(p.regions,16,m);itemCount+=rawItems.length;regionCount+=rawRegions.length;if(itemCount>100000||regionCount>16)fail('LIMIT','Inference supports100k items and16 regions total.');let pageUnits=0;
      const regions=[];const regionIds=new Set();for(const source of rawRegions){m.visit();await m.step();const r=record(source,['id','name','box','separators','rowTolerance']);id(r.id);if(regionIds.has(r.id))fail('INPUT','Duplicate region identity.');regionIds.add(r.id);if(typeof r.name!=='string'||!r.name.length||r.name.length>31)fail('INPUT','Region sheet names require1..31 units.');const box=record(r.box,['x','y','width','height']);num(box.x,0,v.width);num(box.y,0,v.height);num(box.width,0.001,v.width-box.x);num(box.height,0.001,v.height-box.y);num(r.rowTolerance,0.1,100);const separators=await array(r.separators,99,m);let last=box.x;for(const x of separators){m.visit();await m.step();num(x,last+0.000001,box.x+box.width-0.000001);last=x;}regions.push({...r,box,separators,items:[],sheetId:'table-'+(sheets.length+regions.length+1)});}
      for(let a=0;a<regions.length;a++)for(let b=0;b<a;b++){m.visit();await m.step();if(overlaps(regions[a].box,regions[b].box))report('overlapping-regions',null,p.number);}
      for(let i=0;i<rawItems.length;i++){
        m.visit();await m.step();const r=record(rawItems[i],['text','transform','width','height','hasEOL']);if(typeof r.text!=='string'||r.text.length>32767)fail('INPUT','PDF item text exceeds cell text bound.');if(typeof r.hasEOL!=='boolean')fail('INPUT','Expected literal hasEOL boolean.');pageUnits+=r.text.length;units+=r.text.length;if(pageUnits>100000||units>1000000)fail('LIMIT','Source text exceeds per-page/total bounds.');
        const a=await matrix(r.transform,m);num(r.width,0,1000000);num(r.height,0,1000000);const pos=point(t,a[4],a[5]);num(pos.x,-1000000,1000000);num(pos.y,-1000000,1000000);const dx=t[0]*a[0]+t[2]*a[1],dy=t[1]*a[0]+t[3]*a[1],length=Math.hypot(a[0],a[1]),span=length?(t[0]*a[0]+t[2]*a[1])*r.width/length:0;const item={...r,...pos,itemRef:i,endX:pos.x+span};
        if(!(dx>0)||Math.abs(dy)>Math.max(1,Math.hypot(dx,dy))*1e-7){keep(p,i,item,'unsupported-angle');continue;}
        const hits=[];for(const region of regions){m.visit();await m.step();if(contains(region,item))hits.push(region);}if(hits.length!==1){keep(p,i,item,hits.length?'overlapping-regions':'outside-region');continue;}hits[0].items.push(item);
      }
      if(!rawItems.length)report('empty-page',null,p.number);
      for(const region of regions){
        const ordered=await sorted(region.items,(a,b)=>a.y-b.y||a.x-b.x||a.itemRef-b.itemRef,m),rows=[];let row=null;for(const item of ordered){m.visit();await m.step();if(!row||Math.abs(item.y-row.y)>region.rowTolerance){row={y:item.y,items:[]};rows.push(row);}row.items.push(item);}if(rows.length>10000)fail('LIMIT','Too many inferred rows.');
        const cells=[];for(let r=0;r<rows.length;r++){
          const byColumn=new Map(),items=await sorted(rows[r].items,(a,b)=>a.x-b.x||a.itemRef-b.itemRef,m);for(const item of items){let lo=0,hi=region.separators.length;while(lo<hi){m.visit();await m.step();const mid=(lo+hi)>>>1;if(item.x<region.separators[mid])hi=mid;else lo=mid+1;}if(lo<region.separators.length&&item.endX>region.separators[lo])report('separator-crossed',region.sheetId,p.number);if(!byColumn.has(lo))byColumn.set(lo,[]);byColumn.get(lo).push(item);}
          for(const [column,values]of byColumn){m.visit(values.length);await m.step();const length=values.reduce((n,i)=>n+i.text.length,0)+Math.max(0,values.length-1);if(length>32767)fail('LIMIT','Inferred cell exceeds32767 units.');const text=values.map(i=>i.text).join(' ');cells.push({row:r,column,raw:{type:'string',value:text},text,display:text,formula:null,source:{pageNumber:p.number,regionId:region.id,itemRefs:values.map(i=>i.itemRef),rawTexts:values.map(i=>i.text),separator:' '}});}
        }
        const boundaries=[region.box.x,...region.separators,region.box.x+region.box.width],widths=[];for(let i=1;i<boundaries.length;i++)widths.push(boundaries[i]-boundaries[i-1]);sheets.push({id:region.sheetId,name:region.name,rows:Math.max(1,rows.length),columns:widths.length,cells,columnWidths:widths,rowMetadata:[],merges:[],hidden:'visible',selected:true,print:{paper:'a4',landscape:false,margin:36,range:null}});if(region.items.length)report('inferred',region.sheetId,p.number,region.items.length);
      }
    }
    const model={version:1,sourceKind:'pdf',sheets,reports,unplaced};budget({resourceBytes:48*MiB,resourceCount:2});
    result=await validateSpreadsheetModel(model,{...(o.signal?{signal:o.signal}:{}),workLimit:maximum-visits,yieldControl:async info=>{const first=yieldControl({workVisits:visits+info.workVisits,actions:actions+info.actions});await first;check();budget({resourceBytes:48*MiB,resourceCount:2});},getUsage:()=>{const u=external();return {snapshot:u.snapshot,live:{resourceBytes:(u.live?.resourceBytes??0)+(u.live?.expandedBytes??0)+32*MiB,resourceCount:(u.live?.resourceCount??0)+(u.live?.expandedCount??0)+2,artifactBytes:u.live?.artifactBytes??0}};}});
    if(visits+result.usage.workVisits>SPREADSHEET_LIMITS.workVisits)fail('LIMIT','Joint inference/model work exceeds32Mi visits.');check();result.work={inferenceVisits:visits,validationVisits:result.usage.workVisits,totalVisits:visits+result.usage.workVisits,actions:actions+result.usage.actions};o.onUsage?.({resourceBytes:0,resourceCount:0});check();const output=result;result=null;return output;
  }catch(error){result?.dispose();try{o.onUsage?.({resourceBytes:0,resourceCount:0});}catch{}check();throw error;}
}
