'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const{publish}=require('../../resources/market-atlas/publish-client.js');
function mock(changed=false){
 const writes=[],parent='1'.repeat(40),sha='2'.repeat(40);let refs=0;
 const request=async(url,options)=>{
  const route=url.replace('https://api.github.com/repos/haodayizhia/haodayizhia.github.io',''),body=options.body?JSON.parse(options.body):null;
  if(options.method!=='GET')writes.push({route,body});let result;
  if(route==='/git/ref/heads/main')result={object:{sha:changed&&refs++?sha:parent}};
  else if(route==='/git/commits/'+parent)result={tree:{sha:'base'}};
  else if(route==='/git/trees/base?recursive=1')result={truncated:false,tree:[{path:'index.html',type:'blob',sha:'keep'},{path:'data-source/market-atlas/old.bin',type:'blob',sha:'remove'}]};
  else if(route==='/git/blobs'){const bytes=Buffer.from(body.content,'base64');result={sha:crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex')};}
  else if(route==='/git/trees')result={sha:'newtree'};
  else if(route==='/git/commits')result={sha};
  else if(route==='/git/refs/heads/main')result={object:{sha}};
  else throw Error(route);
  return{ok:true,status:200,json:async()=>result};
 };
 return{request,writes};
}
const data=()=>({meta:{dates:['2026-11-06'],revision:'new'},chunks:[{file:'2026-11.bin',buffer:new Uint8Array([0,255,128,3]).buffer}]});
test('web publication uploads exact binary data and changes only chart data',async()=>{
 const m=mock(),result=await publish({token:'x'.repeat(30),snapshot:data(),request:m.request});
 assert.equal(result.unchanged,false);
 const tree=m.writes.find(w=>w.route==='/git/trees').body;
 assert.equal(tree.base_tree,'base');assert.ok(tree.tree.every(e=>e.path.startsWith('data-source/market-atlas/')));
 assert.equal(tree.tree.find(e=>e.path.endsWith('old.bin')).sha,null);
 const ref=m.writes.at(-1);assert.equal(ref.route,'/git/refs/heads/main');assert.equal(ref.body.force,false);
});
test('a concurrent website change blocks the final branch update',async()=>{
 const m=mock(true);await assert.rejects(publish({token:'x'.repeat(30),snapshot:data(),request:m.request}),/其他更新/);
 assert.equal(m.writes.some(w=>w.route==='/git/refs/heads/main'),false);
});
test('invalid credentials stop before publishing',async()=>{
 await assert.rejects(publish({token:'',snapshot:data(),request:()=>{throw Error('must not run');}}),/令牌/);
 await assert.rejects(publish({token:'x'.repeat(30),snapshot:data(),request:async()=>({ok:false,status:403})}),/权限/);
});
