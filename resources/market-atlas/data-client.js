'use strict';
const AtlasData=(()=>{
 const base=new URL('./resources/market-atlas/',document.baseURI),worker=new Worker(new URL('data-worker.js?v='+document.querySelector('.atlas-app').dataset.build,base));
 const pending=new Map();let next=0;
 function send(action,values={},progress){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject,progress});worker.postMessage({id,action,...values});});}
 function status(p){const el=document.querySelector('#loading');if(el)el.textContent=p.message;}
 worker.onmessage=({data})=>{
  if(data.progress){status(data.progress);pending.get(data.id)?.progress?.(data.progress);return;}
  const task=pending.get(data.id);if(!task)return;pending.delete(data.id);if(data.error)task.reject(Error(data.error));else task.resolve(data.result);
 };
 worker.onerror=event=>{for(const task of pending.values())task.reject(Error('数据线程未能运行，请刷新页面重试。'));pending.clear();};
 const published=()=>send('load',{url:new URL('data/manifest.json',base).href});
 let ready=published();ready.catch(()=>{});
 return{
  async request(path,query={},options={}){
   if(['/api/reload','/api/source'].includes(path)){const result=await published();ready=Promise.resolve(result);return result;}
   await ready;if(path==='/api/sources')return[{title:'网站公开数据',path:'public'}];
   return send('request',{path,query});
  },
  async importFiles(files,kind,progress){const result=await send('import',{files,kind},progress);ready=Promise.resolve(result);return result;},
  snapshot(){return send('snapshot');}
 };
})();
