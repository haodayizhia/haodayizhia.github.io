'use strict';
(function(root){
 const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
 const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 async function snapshot(engine){
  const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v)])):typeof value==='number'?(Number.isFinite(value)?Math.round(value*1e5)/1e5:null):value;
  const quality=clean(engine.meta.quality);delete quality.cache_hit;delete quality.load_seconds;
  const meta={format:1,fields:AtlasFields,dates:engine.meta.dates,stocks:engine.meta.stocks,quality,source:'网站公开行情',source_kind:'public'},chunks=[];
  let a=0;
  while(a<engine.n){let b=a+1;while(b<engine.n&&meta.dates[b].slice(0,7)===meta.dates[a].slice(0,7))b++;
   const size=(b-a)*engine.s,values=new Float32Array(size*9);
   AtlasFields.forEach((field,f)=>values.set(engine[field].subarray(a*engine.s,b*engine.s),f*size));
   const file=meta.dates[a].slice(0,7)+'.bin',sha256=await digest(values.buffer);
   chunks.push({file,start:a,count:b-a,sha256,buffer:values.buffer});a=b;
  }
  meta.chunks=chunks.map(({buffer,...entry})=>entry);
  meta.revision=await digest(new TextEncoder().encode(JSON.stringify(ordered(meta))));
  meta.generated_at=new Date().toISOString();
  return{meta,chunks};
 }
 root.atlasSnapshot=snapshot;
 if(typeof module!=='undefined')module.exports={snapshot,ordered};
})(globalThis);
