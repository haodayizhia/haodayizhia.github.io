'use strict';
// Every publication builds the fast-path assets from the same full-history engine and verified raw data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {AtlasEngine,fields}=require('../../resources/market-atlas/engine.js');
const source=process.argv[2],target=process.argv[3],meta=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
const n=meta.dates.length,s=meta.stocks.length;
const arrays=Object.fromEntries(fields.map(f=>[f,new Float32Array(n*s)]));
let offset=0;
for(const entry of meta.chunks){
 if(entry.start!==offset)throw Error('Discontinuous source chunks');
 const buffer=fs.readFileSync(path.join(source,entry.file));
 if(buffer.length!==entry.count*s*fields.length*4)throw Error('Invalid source chunk size: '+entry.file);
 if(crypto.createHash('sha256').update(buffer).digest('hex')!==entry.sha256)throw Error('Source chunk checksum mismatch: '+entry.file);
 const values=new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)),size=entry.count*s;
 for(let f=0;f<fields.length;f++)arrays[fields[f]].set(values.subarray(f*size,(f+1)*size),offset*s);
 offset+=entry.count;
}
if(offset!==n)throw Error('Incomplete source dates');
const engine=new AtlasEngine({...meta,quality:{...meta.quality}},arrays);
function save(prefix,buffer,extension){
 const sha256=crypto.createHash('sha256').update(buffer).digest('hex');
 const file=prefix+'.'+sha256.slice(0,16)+'.'+extension+'.gz';
 const zipped=zlib.gzipSync(buffer,{level:6,mtime:0});
 fs.writeFileSync(path.join(target,file),zipped);
 return {file,sha256,length:buffer.length,bytes:zipped.length};
}
function json(prefix,value){return save(prefix,Buffer.from(JSON.stringify(value)),'json');}
const first=meta.dates[0],end=meta.dates.at(-1),recentStart=meta.dates[Math.max(0,n-63)];
const previewQuery={start:recentStart,end,window:1,mode:'dynamic'};
const preview={...json('recent',engine.market(previewQuery)),...previewQuery};
const all=[...Array(s).keys()];
const indices={pool:Array.from(engine.aggregate(all,1).index,v=>Number.isFinite(v)?v:null),sectors:[]};
for(const [,ids]of engine.order)indices.sectors.push(Array.from(engine.aggregate(ids,1).index,v=>Number.isFinite(v)?v:null));
// Verify range rebasing against the original engine before publishing assets.
function slicePrecomputed(full,a,b){
 const cut=s=>{
  const result={};
  for(const [key,values] of Object.entries(s))if(key!=='path'&&key!=='__rawIndex')result[key]=values.slice(a,b+1);
  const raw=s.__rawIndex,base=raw[a];
  result.path=Array.from({length:b-a+1},(_,t)=>Number.isFinite(base)&&base>0&&Number.isFinite(raw[a+t])?(raw[a+t]/base-1)*100:null);
  return result;
 };
 return {dates:meta.dates.slice(a,b+1),pool:cut(full.pool),sectors:full.sectors.map(x=>({...x,series:cut(x.series)})),eligible:full.eligible,window:full.window,mode:'dynamic'};
}
const markets={};
for(const window of [1,5,10,20,60]){
 const full=engine.market({start:first,end,window,mode:'dynamic'});
 full.pool.__rawIndex=indices.pool;
 full.sectors.forEach((sector,i)=>{sector.series.__rawIndex=indices.sectors[i];});
 for(const [startIndex,endIndex] of [[Math.max(0,n-63),n-1],[Math.max(0,n-252),n-1]]){
  const q={start:meta.dates[startIndex],end:meta.dates[endIndex],window,mode:'dynamic'};
  assert.deepStrictEqual(slicePrecomputed(full,startIndex,endIndex),engine.market(q),'Fast market range differs from full calculations: '+JSON.stringify(q));
 }
 markets[String(window)]={...json('market-'+window,full),window};
}
const industries={};
for(let group=0;group<engine.order.length;group++){
 const [name,ids]=engine.order[group],count=ids.length,total=n*count;
 const packed=new Float32Array(total*fields.length);
 for(let f=0;f<fields.length;f++){
  const sourceField=arrays[fields[f]],base=f*total;
  for(let t=0;t<n;t++)for(let k=0;k<count;k++)packed[base+t*count+k]=sourceField[t*s+ids[k]];
 }
 const buffer=Buffer.from(packed.buffer);
 const info=save('industry-'+String(group).padStart(3,'0'),buffer,'bin');
 industries[name]={...info,count};
 // Reject any packaging bug before publishing. The local-group engine must reproduce global stock calculations.
 if(group===0||group===engine.order.length-1){
  const subset=Object.fromEntries(fields.map((f,j)=>[f,packed.slice(j*total,(j+1)*total)]));
  const mini=new AtlasEngine({dates:meta.dates,stocks:ids.map(i=>meta.stocks[i]),quality:{...meta.quality},allowEmptyGroup:true},subset);
  for(const code of [meta.stocks[ids[0]].code,meta.stocks[ids.at(-1)].code]){
   const q={code,start:recentStart,end};
   assert.deepStrictEqual(mini.stock(q),engine.stock(q),'Industry bundle changed stock indicators: '+code);
  }
  const q={name,start:recentStart,end,window:5,mode:'complete'};
  assert.deepStrictEqual(mini.industryHistory(q),engine.industryHistory(q),'Industry bundle changed historical stock metrics: '+name);
 }
}
process.stdout.write(JSON.stringify({preview,markets,industriesBundle:industries}));
