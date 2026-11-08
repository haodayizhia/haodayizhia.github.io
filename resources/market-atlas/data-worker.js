'use strict';
importScripts('./engine.js'+self.location.search,'./csv.js'+self.location.search,'./snapshot.js'+self.location.search);
let engine=null,publicMeta=null,publicUrl='',coveredStart=-1,coveredEnd=-1;
let sourceRevision=0,download=null,loadQueue=Promise.resolve();

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
 // Momentum 60 and volatility 20 need observations preceding the visible window.
 const wantedStart=Math.max(0,start-61),wantedEnd=end;
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
self.onmessage=async({data})=>{
 const {id,action}=data;
 try{
  let result;
  if(action==='load'){
   const revision=++sourceRevision;download?.abort();const controller=new AbortController();download=controller;
   const meta=await publishedManifest(data.url,controller.signal);
   if(revision!==sourceRevision)throw Error('已切换到更新的数据源。');
   publicMeta=meta;publicUrl=data.url;engine=null;coveredStart=-1;coveredEnd=-1;loadQueue=Promise.resolve();
   result=meta;
  }else if(action==='import'){
   const revision=++sourceRevision;download?.abort();
   const next=await importAtlasCsv(data.files,data.kind,progress=>postMessage({id,progress}));
   if(revision!==sourceRevision)throw Error('已切换到更新的数据源。');
   engine=next;publicMeta=null;coveredStart=-1;coveredEnd=-1;loadQueue=Promise.resolve();result=engine.meta;
  }else if(action==='snapshot'){
   if(publicMeta)await ensurePublished({start:publicMeta.dates[0],end:publicMeta.dates.at(-1)},id);
   if(!engine)throw Error('请先导入行情数据。');
   result=await atlasSnapshot(engine);postMessage({id,result},result.chunks.map(c=>c.buffer));return;
  }else if(action==='request'){
   if(publicMeta){
    if(data.path==='/api/meta')result=publicMeta;
    else if(data.path==='/api/health')result={ok:true,version:8};
    else{await ensurePublished(data.query,id);result=engine.request(data.path,data.query);}
   }else{
    if(!engine)throw Error('数据尚未准备好。');
    result=engine.request(data.path,data.query);
   }
  }else throw Error('未知数据操作。');
  postMessage({id,result});
 }catch(error){postMessage({id,error:error.message||String(error)});}
};
