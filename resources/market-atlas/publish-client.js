'use strict';
(function(root){
 const repository='haodayizhia/haodayizhia.github.io',prefix='data-source/market-atlas/';
 const base64=buffer=>{const bytes=new Uint8Array(buffer);let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);};
 async function publish({token,snapshot,request=fetch,progress=()=>{}}){
  if(!token||token.trim().length<20)throw Error('请填写对此网站仓库有 Contents 读写权限的 GitHub 令牌。');
  async function api(method,path,body){
   const response=await request('https://api.github.com/repos/'+repository+path,{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token.trim(),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(!response.ok){if(response.status===401||response.status===403)throw Error('GitHub 认证失败或仓库写权限不足，请检查令牌。');throw Error('GitHub 操作失败（'+response.status+'），网站原数据未被覆盖。');}
   return response.status===204?null:response.json();
  }
  progress('正在检查仓库与发布权限…');
  const ref=await api('GET','/git/ref/heads/main'),parent=ref.object.sha,commit=await api('GET','/git/commits/'+parent),tree=await api('GET','/git/trees/'+commit.tree.sha+'?recursive=1');
  if(tree.truncated)throw Error('仓库目录清单不完整，已停止发布。');
  const entries=[],wanted=new Set([prefix+'manifest.json',...snapshot.chunks.map(c=>prefix+c.file)]);
  for(const entry of tree.tree)if(entry.type==='blob'&&entry.path.startsWith(prefix)&&!wanted.has(entry.path))entries.push({path:entry.path,mode:'100644',type:'blob',sha:null});
  const old=new Map(tree.tree.filter(e=>e.type==='blob').map(e=>[e.path,e.sha]));
  if(old.has(prefix+'manifest.json')){
   const blob=await api('GET','/git/blobs/'+old.get(prefix+'manifest.json'));
   if(blob.encoding==='base64'){
    const previous=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));
    if(previous.revision===snapshot.meta.revision)return{sha:parent,unchanged:true};
   }
  }
  const files=[...snapshot.chunks.map(c=>({path:prefix+c.file,buffer:c.buffer})),{path:prefix+'manifest.json',buffer:new TextEncoder().encode(JSON.stringify(snapshot.meta)+'\n').buffer}];
  for(let i=0;i<files.length;i++){
   const file=files[i],header=new TextEncoder().encode('blob '+file.buffer.byteLength+'\0'),joined=new Uint8Array(header.length+file.buffer.byteLength);joined.set(header);joined.set(new Uint8Array(file.buffer),header.length);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',joined)),v=>v.toString(16).padStart(2,'0')).join('');
   if(old.get(file.path)===hash)continue;
   progress('正在发布数据 '+(i+1)+' / '+files.length+'…');
   const blob=await api('POST','/git/blobs',{content:base64(file.buffer),encoding:'base64'});
   if(blob.sha!==hash)throw Error('上传数据校验失败，网站原数据未改变。');
   entries.push({path:file.path,mode:'100644',type:'blob',sha:blob.sha});
  }
  if(!entries.length)return{sha:parent,unchanged:true};
  const uploaded=await api('POST','/git/trees',{base_tree:commit.tree.sha,tree:entries});
  const created=await api('POST','/git/commits',{message:'Update MarketAtlas data through '+snapshot.meta.dates.at(-1)+' (web upload)',tree:uploaded.sha,parents:[parent]});
  const current=await api('GET','/git/ref/heads/main');
  if(current.object.sha!==parent)throw Error('发布期间网站有其他更新；已停止覆盖，请重新发布。');
  await api('PATCH','/git/refs/heads/main',{sha:created.sha,force:false});
  return{sha:created.sha,unchanged:false};
 }
 root.publishAtlasSnapshot=publish;
 if(typeof module!=='undefined')module.exports={publish};
})(globalThis);
