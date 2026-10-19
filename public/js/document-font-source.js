// Fixed local payloads already accepted by the finite PDF core. No font fallback,
// FontFace, global byte cache, producer URL or new dependency is introduced.
const MiB=1024*1024, set=Uint8Array.prototype.set,fill=Uint8Array.prototype.fill;
const typed=Object.getPrototypeOf(Uint8Array.prototype),tag=Object.getOwnPropertyDescriptor(typed,Symbol.toStringTag).get;
const length=Object.getOwnPropertyDescriptor(typed,'byteLength').get,buffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,offset=Object.getOwnPropertyDescriptor(typed,'byteOffset').get;
const abort=AbortSignal.prototype.throwIfAborted,aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const signalReason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
const listen=EventTarget.prototype.addEventListener,unlisten=EventTarget.prototype.removeEventListener;
const registry=[
 ['regular','NotoSans-Regular.ttf','Noto Sans Regular',569208,'b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5'],
 ['bold','NotoSans-Bold.ttf','Noto Sans Bold',575740,'c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a'],
 ['italic','NotoSans-Italic.ttf','Noto Sans Italic',552776,'36cff144df01309dab648bea71baff9bb074026914afe63aeacc8bc90b67a28b'],
 ['boldItalic','NotoSans-BoldItalic.ttf','Noto Sans Bold Italic',555292,'6edf4227ef0fa846aca70e86a307804ca4401741830f5b3af0f2554abe2b8466'],
 ['code','NotoSansMono-Regular.ttf','Noto Sans Mono Regular',512836,'d9e2b23d19f8230be7146f409a52b1d23117e635e28f2e2892cf91b7382f325b']
];
function fail(code,message){const e=new Error(message);e.code=`DOCUMENT_FONT_${code}`;throw e;}
function record(value,keys){if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INPUT','Expected plain font request data.');const out={};for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!keys.includes(key)||!d.enumerable||!Object.hasOwn(d,'value')||d.value===undefined)fail('INPUT','Invalid font request field.');out[key]=d.value;}return out;}
function requests(values){if(!Array.isArray(values)||Object.getPrototypeOf(values)!==Array.prototype)fail('INPUT','Expected a standard dense request array.');const n=Object.getOwnPropertyDescriptor(values,'length').value;if(n>5||Reflect.ownKeys(values).length!==n+1)fail('INPUT','Invalid request array.');const seen=new Set(),out=[];let total=0;
  for(let i=0;i<n;i++){const d=Object.getOwnPropertyDescriptor(values,String(i));if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('INPUT','Invalid request index.');const r=record(d.value,['id','style','file','label','byteLength','sha256']),pin=registry.find(v=>v[0]===r.id);if(!pin||seen.has(r.id)||r.style!==pin[0]||r.file!==pin[1]||r.label!==pin[2]||r.byteLength!==pin[3]||r.sha256!==pin[4])fail('INPUT','The request does not match the accepted registry.');seen.add(r.id);total+=r.byteLength;out.push(r);}if(total>3*MiB)fail('LIMIT','Font bytes exceed 3 MiB.');return out;
}
const loadDefaultFontkit=async onStatus=>(await import('./lib-loader.js')).ensureFontkit(onStatus);
export async function loadRequestedDocumentFonts(input,raw={},environment={}){
  const options=record(raw,['signal','isCurrent','onStatus']),env=record(environment,['fetch','ensureFontkit']);
  if(options.signal!==undefined){try{aborted.call(options.signal);}catch{fail('INPUT','Expected an actual AbortSignal.');}}
  for(const key of ['isCurrent','onStatus'])if(options[key]!==undefined&&typeof options[key]!=='function')fail('INPUT','Invalid trusted callback.');
  const check=()=>{if(options.signal)abort.call(options.signal);if(options.isCurrent&&!options.isCurrent())fail('STALE','The font request is no longer current.');};
  const pins=requests(input),fetcher=env.fetch??globalThis.fetch,load=env.ensureFontkit??loadDefaultFontkit,owned=[];
  if(typeof fetcher!=='function'||typeof load!=='function')fail('INPUT','Trusted acquisition functions are required.');
  let disposed=false;const dispose=()=>{if(!disposed){disposed=true;for(const bytes of owned)fill.call(bytes,0);}};
  try{
    check();const fonts=[];let chunks=0;
    for(const pin of pins){check();options.onStatus?.(`Loading ${pin.label}`);const bytes=new Uint8Array(pin.byteLength);owned.push(bytes);
      const firstFetch=fetcher(`/fonts/${pin.file}`,{signal:options.signal});const response=await firstFetch;if(!response?.ok||!response.body)fail('FETCH','The pinned font could not be read.');
      const reader=response.body.getReader();let used=0,cancellation;
      function cancel(){if(!cancellation){try{cancellation=Promise.resolve(reader.cancel(options.signal?signalReason.call(options.signal):undefined));}catch(error){cancellation=Promise.reject(error);}cancellation.catch(()=>{});}return cancellation;}
      const onAbort=()=>{void cancel();};if(options.signal)listen.call(options.signal,'abort',onAbort,{once:true});
      try{
        while(true){check();const firstRead=reader.read(),part=await firstRead;check();if(part.done)break;if(++chunks>65536)fail('LIMIT','Font stream chunk budget exceeded.');
          if(tag.call(part.value)!=='Uint8Array')fail('FETCH','Expected native byte chunks.');const n=length.call(part.value);if(used+n>pin.byteLength)fail('INTEGRITY','The font stream exceeds the pinned length.');set.call(bytes,new Uint8Array(buffer.call(part.value),offset.call(part.value),n),used);used+=n;
          if((chunks&127)===0){await new Promise(resolve=>setTimeout(resolve,0));check();}
        }
        if(used!==pin.byteLength)fail('INTEGRITY','The font stream is truncated.');
      }finally{
        if(options.signal)unlisten.call(options.signal,'abort',onAbort);
        // Await the FIRST cancellation, not a second immediately-resolved call.
        try{await cancel();}finally{reader.releaseLock();}
      }
      check();const firstDigest=crypto.subtle.digest('SHA-256',bytes),digest=await firstDigest;check();const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');if(actual!==pin.sha256)fail('INTEGRITY','The font does not match its pinned SHA256.');fonts.push({id:pin.id,bytes});
    }
    check();let fontkit;if(pins.length){const firstLoader=load(options.onStatus);fontkit=await firstLoader;check();if(typeof fontkit?.create!=='function')fail('DEPENDENCY','The public fontkit module is unavailable.');}
    return {fonts,fontkit,dispose};
  }catch(error){dispose();if(options.signal)abort.call(options.signal);throw error;}
}
