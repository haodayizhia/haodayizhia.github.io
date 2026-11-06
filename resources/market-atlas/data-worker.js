'use strict';
importScripts('./engine.js'+self.location.search,'./csv.js'+self.location.search,'./snapshot.js'+self.location.search);
let engine=null;
async function loadPublished(url){
 const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('公开数据尚未加载，请稍后重试（'+response.status+'）。');
 const meta=await response.json();
 if(meta.format!==1||JSON.stringify(meta.fields)!==JSON.stringify(AtlasFields))throw Error('公开数据格式不兼容，请刷新页面。');
 const n=meta.dates.length,s=meta.stocks.length;
 if(!n||!s||n*s>30_000_000)throw Error('公开数据规模不合法。');
 const arrays=Object.fromEntries(AtlasFields.map(f=>[f,new Float32Array(n*s).fill(NaN)]));
 let filled=0;
 for(const chunk of meta.chunks){
  if(chunk.start!==filled||!Number.isInteger(chunk.count)||chunk.count<=0||filled+chunk.count>n||!/^[\w.-]+\.bin\.gz$/.test(chunk.file))throw Error('公开数据清单不完整。');
  const r=await fetch(new URL(chunk.file,url),{cache:'force-cache'});if(!r.ok)throw Error('读取行情分片失败，请刷新重试（'+r.status+'）。');
  if(typeof DecompressionStream==='undefined')throw Error('此浏览器不支持数据解压，请更新浏览器后重试。');
  const buffer=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if(buffer.byteLength!==chunk.count*s*9*4)throw Error('行情分片长度校验失败，已停止加载。');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==chunk.sha256)throw Error('行情分片校验失败，已停止加载。');
  const values=new Float32Array(buffer),size=chunk.count*s;
  for(let f=0;f<9;f++)arrays[AtlasFields[f]].set(values.subarray(f*size,(f+1)*size),filled*s);
  filled+=chunk.count;
  postMessage({progress:{percent:Math.round(filled/n*100),message:'正在加载 '+meta.dates[filled-1].slice(0,7)+' 行情…'}});
 }
 if(filled!==n)throw Error('行情交易日不完整。');
 return new AtlasEngine(meta,arrays);
}
self.onmessage=async({data})=>{
 const {id,action}=data;
 try{
  let result;
  if(action==='load'){const next=await loadPublished(data.url);engine=next;result=engine.meta;}
  else if(action==='import'){const next=await importAtlasCsv(data.files,data.kind,progress=>postMessage({id,progress}));engine=next;result=engine.meta;}
  else if(action==='snapshot'){if(!engine)throw Error('请先导入行情数据。');result=await atlasSnapshot(engine);postMessage({id,result},result.chunks.map(c=>c.buffer));return;}
  else{if(!engine)throw Error('数据尚未准备好。');result=engine.request(data.path,data.query);}
  postMessage({id,result});
 }catch(error){postMessage({id,error:error.message||String(error)});}
};
