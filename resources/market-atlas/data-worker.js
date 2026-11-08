'use strict';
importScripts('./engine.js'+self.location.search,'./csv.js'+self.location.search,'./snapshot.js'+self.location.search);
let engine=null,publicMeta=null,publicUrl='',coveredStart=-1,coveredEnd=-1;
let sourceRevision=0,download=null,loadQueue=Promise.resolve();
const marketAssets=new Map(),industryAssets=new Map();

// Only publicly published, SHA-256 verified monthly arrays are persisted. Local imports stay in memory.
const database=(()=>{
 if(!self.indexedDB)return Promise.resolve(null);
 return new Promise(resolve=>{
  let done=false;const finish=db=>{if(!done){done=true;resolve(db);}};
  try{
   const request=indexedDB.open('MarketAtlasPublicData',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('chunks');
   request.onsuccess=()=>finish(request.result);
   request.onerror=()=>finish(null);request.onblocked=()=>finish(null);
  }catch{finish(null);}
 });
})();
async function cachedChunk(hash,length){
 const db=await database;if(!db)return null;
 return new Promise(resolve=>{
  try{
   const req=db.transaction('chunks','readonly').objectStore('chunks').get(hash);
   req.onsuccess=()=>{const value=req.result;resolve(value instanceof ArrayBuffer&&value.byteLength===length?value:null);};
   req.onerror=()=>resolve(null);
  }catch{resolve(null);}
 });
}
async function rememberChunk(hash,buffer){
 const db=await database;if(!db)return;
 try{
  await new Promise(resolve=>{
   const tx=db.transaction('chunks','readwrite');
   tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();
   tx.objectStore('chunks').put(buffer,hash);
  });
 }catch{/* Browser storage is optional; network loading remains available. */}
}
async function publishedManifest(url,signal){
 const response=await fetch(url,{cache:'no-cache',signal});
 if(!response.ok)throw Error('公开数据尚未加载，请稍后重试（'+response.status+'）。');
 const meta=await response.json(),n=meta.dates?.length,s=meta.stocks?.length;
 if(meta.format!==1||JSON.stringify(meta.fields)!==JSON.stringify(AtlasFields))throw Error('公开数据格式不兼容，请刷新页面。');
 if(!n||!s||n*s>30_000_000||!meta.quality)throw Error('公开数据规模不合法。');
 let filled=0;
 for(const chunk of meta.chunks||[]){
  if(chunk.start!==filled||!Number.isInteger(chunk.count)||chunk.count<=0||filled+chunk.count>n
   ||!/^[\w.-]+\.bin\.gz$/.test(chunk.file)||!/^[a-f0-9]{64}$/.test(chunk.sha256))
   throw Error('公开数据清单不完整。');
  filled+=chunk.count;
 }
 if(filled!==n)throw Error('行情交易日不完整。');
 // Metadata is immediately usable, before the historical price matrices have loaded.
 const groups=new Map();
 for(const stock of meta.stocks)groups.set(stock.industry,(groups.get(stock.industry)||0)+1);
 meta.industries=[...groups].sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:a[0]>b[0]?1:0)).map(([name,count])=>({name,count}));
 return meta;
}
async function loadChunk(entry,id,signal){
 const length=entry.count*publicMeta.stocks.length*AtlasFields.length*4;
 const existing=await cachedChunk(entry.sha256,length);
 if(existing)return existing;
 if(signal.aborted)throw Error('数据源已切换。');
 const response=await fetch(new URL(entry.file,publicUrl),{cache:'force-cache',signal});
 if(!response.ok)throw Error('读取行情分片失败，请刷新重试（'+response.status+'）。');
 if(typeof DecompressionStream==='undefined')throw Error('此浏览器不支持数据解压，请更新浏览器后重试。');
 const buffer=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 if(buffer.byteLength!==length)throw Error('行情分片长度校验失败，已停止加载。');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');
 if(digest!==entry.sha256)throw Error('行情分片校验失败，已停止加载。');
 // Storage failures never prevent the current visit from working.
 await rememberChunk(entry.sha256,buffer);
 return buffer;
}
async function ensurePublished(query,id){
 if(!publicMeta)return;
 const dates=publicMeta.dates,start=dates.indexOf(query.start),end=dates.indexOf(query.end);
 if(start<0||end<0)throw Error('请选择数据范围内的交易日。');
 if(start>end)throw Error('开始日期不能晚于结束日期。');
 // Historical peaks and drawdowns require the full prefix up to the requested end date.
 const wantedStart=0,wantedEnd=end;
 const revision=sourceRevision;
 const run=async()=>{
  if(engine&&coveredStart<=wantedStart&&coveredEnd>=wantedEnd)return;
  const first=Math.min(coveredStart<0?wantedStart:coveredStart,wantedStart);
  const last=Math.max(coveredEnd<0?wantedEnd:coveredEnd,wantedEnd);
  const chunks=publicMeta.chunks.filter(e=>e.start<=last&&e.start+e.count>first);
  if(!chunks.length)throw Error('找不到指定日期的行情分片。');
  const a=chunks[0].start,b=chunks.at(-1).start+chunks.at(-1).count;
  const s=publicMeta.stocks.length,arrays=Object.fromEntries(AtlasFields.map(field=>[field,new Float32Array((b-a)*s)]));
  for(let i=0;i<chunks.length;i++){
   if(revision!==sourceRevision)throw Error('已切换到更新的数据源。');
   const entry=chunks[i],buffer=await loadChunk(entry,id,download.signal);
   if(revision!==sourceRevision)throw Error('已切换到更新的数据源。');
   const values=new Float32Array(buffer),size=entry.count*s,offset=(entry.start-a)*s;
   for(let f=0;f<AtlasFields.length;f++)arrays[AtlasFields[f]].set(values.subarray(f*size,(f+1)*size),offset);
   postMessage({id,progress:{percent:Math.round((i+1)/chunks.length*100),message:'正在准备 '+publicMeta.dates[entry.start+entry.count-1].slice(0,7)+' 行情…'}});
  }
  const subset={...publicMeta,dates:dates.slice(a,b),quality:{...publicMeta.quality}};
  const next=new AtlasEngine(subset,arrays);
  if(revision!==sourceRevision)throw Error('已切换到更新的数据源。');
  engine=next;coveredStart=a;coveredEnd=b-1;
 };
 const task=loadQueue.then(run);
 loadQueue=task.catch(()=>{});
 return task;
}

async function verifiedAsset(info){
 const cached=await cachedChunk(info.sha256,info.length);
 if(cached)return cached;
 if(download?.signal.aborted)throw Error('数据源已切换。');
 const r=await fetch(new URL(info.file,publicUrl),{cache:'force-cache',signal:download.signal});
 if(!r.ok)throw Error('读取预计算数据失败（'+r.status+'）。');
 if(typeof DecompressionStream==='undefined')throw Error('此浏览器不支持数据解压，请更新浏览器后重试。');
 const buffer=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 if(buffer.byteLength!==info.length)throw Error('预计算数据长度校验失败。');
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');
 if(sha!==info.sha256)throw Error('预计算数据校验失败。');
 await rememberChunk(info.sha256,buffer);
 return buffer;
}
function assetPromise(map,key,load){
 if(!map.has(key)){
  const task=Promise.resolve().then(load).catch(error=>{map.delete(key);throw error;});
  map.set(key,task);
 }
 return map.get(key);
}
async function fullMarket(window){
 const info=publicMeta?.markets?.[String(window)];
 if(!info)return null;
 return assetPromise(marketAssets,String(window),async()=>{
  const full=JSON.parse(new TextDecoder().decode(await verifiedAsset(info)));
  if(full.window!==window||full.mode!=='dynamic'||full.dates.length!==publicMeta.dates.length||
     full.dates[0]!==publicMeta.dates[0]||full.dates.at(-1)!==publicMeta.dates.at(-1)||
     full.sectors.length!==publicMeta.industries.length)throw Error('预计算市场数据与行情清单不匹配。');
  return full;
 });
}
function selectFullMarket(full,q){
 const dates=publicMeta.dates,a=dates.indexOf(q.start),b=dates.indexOf(q.end);
 if(a<0||b<0)throw Error('请选择数据范围内的交易日。');
 if(a>b)throw Error('开始日期不能晚于结束日期。');
 const slice=series=>{
  const result={};
  for(const [name,values] of Object.entries(series))if(name!=='path'&&name!=='__rawIndex')result[name]=values.slice(a,b+1);
  const raw=series.__rawIndex,base=raw[a];
  result.path=Array.from({length:b-a+1},(_,i)=>Number.isFinite(base)&&base>0&&Number.isFinite(raw[a+i])?(raw[a+i]/base-1)*100:null);
  return result;
 };
 return {dates:dates.slice(a,b+1),pool:slice(full.pool),sectors:full.sectors.map(x=>({...x,series:slice(x.series)})),eligible:full.eligible,window:full.window,mode:'dynamic'};
}
async function industryEngine(industry){
 const info=publicMeta?.industriesBundle?.[industry];
 if(!info)return null;
 return assetPromise(industryAssets,industry,async()=>{
  const selected=publicMeta.stocks.filter(s=>s.industry===industry),n=publicMeta.dates.length,count=selected.length;
  if(count!==info.count||!count||info.length!==n*count*AtlasFields.length*4)throw Error('行业分片与股票目录不一致。');
  const buffer=await verifiedAsset(info),values=new Float32Array(buffer),size=n*count;
  const arrays=Object.fromEntries(AtlasFields.map((name,f)=>[name,new Float32Array(buffer,size*f*4,size)]));
  const subset={dates:publicMeta.dates,stocks:selected,quality:{...publicMeta.quality},allowEmptyGroup:true};
  const instance=new AtlasEngine(subset,arrays);
  // Don't keep an unbounded set of stock matrices in a mobile browser.
  if(industryAssets.size>3){
   for(const key of industryAssets.keys())if(key!==industry){industryAssets.delete(key);break;}
  }
  return instance;
 });
}
async function previewMarket(query,id){
 const info=publicMeta?.preview;
 if(!info||query.start!==info.start||query.end!==info.end||Number(query.window||1)!==info.window||(query.mode||'dynamic')!==info.mode)return null;
 const data=await cachedChunk(info.sha256,info.length);
 if(data)return JSON.parse(new TextDecoder().decode(data));
 const response=await fetch(new URL(info.file,publicUrl),{cache:'force-cache',signal:download.signal});
 if(!response.ok)throw Error('近期行情摘要尚未准备好（'+response.status+'）。');
 if(typeof DecompressionStream==='undefined')throw Error('此浏览器不支持数据解压，请更新浏览器后重试。');
 const buffer=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 if(buffer.byteLength!==info.length)throw Error('近期行情摘要长度校验失败。');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');
 if(digest!==info.sha256)throw Error('近期行情摘要校验失败。');
 const result=JSON.parse(new TextDecoder().decode(buffer));
 await rememberChunk(info.sha256,buffer);
 return result;
}
self.onmessage=async({data})=>{
 const {id,action}=data;
 try{
  let result;
  if(action==='load'){
   const revision=++sourceRevision;download?.abort();const controller=new AbortController();download=controller;
   const meta=await publishedManifest(data.url,controller.signal);
   if(revision!==sourceRevision)throw Error('已切换到更新的数据源。');
   publicMeta=meta;publicUrl=data.url;engine=null;coveredStart=-1;coveredEnd=-1;loadQueue=Promise.resolve();marketAssets.clear();industryAssets.clear();
   result=meta;
  }else if(action==='import'){
   const revision=++sourceRevision;download?.abort();
   const next=await importAtlasCsv(data.files,data.kind,progress=>postMessage({id,progress}));
   if(revision!==sourceRevision)throw Error('已切换到更新的数据源。');
   engine=next;publicMeta=null;coveredStart=-1;coveredEnd=-1;loadQueue=Promise.resolve();marketAssets.clear();industryAssets.clear();result=engine.meta;
  }else if(action==='snapshot'){
   if(publicMeta)await ensurePublished({start:publicMeta.dates[0],end:publicMeta.dates.at(-1)},id);
   if(!engine)throw Error('请先导入行情数据。');
   result=await atlasSnapshot(engine);postMessage({id,result},result.chunks.map(c=>c.buffer));return;
  }else if(action==='request'){
   if(publicMeta){
    if(data.path==='/api/meta')result=publicMeta;
    else if(data.path==='/api/health')result={ok:true,version:8};
    else{
     const q=data.query||{},route=data.path;
     if(route==='/api/market'&&(q.mode||'dynamic')==='dynamic'){
      const preview=await previewMarket(q,id);
      if(preview)result=preview;
      else{
       const w=Number(q.window||1),full=await fullMarket(w);
       if(full)result=selectFullMarket(full,q);
       else{await ensurePublished(q,id);result=engine.request(route,q);}
      }
     }else if(['/api/stock','/api/industry-history','/api/industry'].includes(route)&&publicMeta.industriesBundle){
      const group=route==='/api/stock'?publicMeta.stocks.find(s=>s.code===q.code)?.industry:q.name;
      if(!group)throw Error(route==='/api/stock'?'未知股票。':'未知行业。');
      const mini=await industryEngine(group);
      if(mini)result=mini.request(route,q);
      else{await ensurePublished(q,id);result=engine.request(route,q);}
     }else{await ensurePublished(q,id);result=engine.request(route,q);}
    }
   }else{
    if(!engine)throw Error('数据尚未准备好。');
    result=engine.request(data.path,data.query);
   }
  }else throw Error('未知数据操作。');
  postMessage({id,result});
 }catch(error){postMessage({id,error:error.message||String(error)});}
};
