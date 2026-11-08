'use strict';
// Build-time preview comes from the same complete-history JS engine as the live website.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {AtlasEngine,fields}=require('../../resources/market-atlas/engine.js');
const source=process.argv[2],target=process.argv[3],meta=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
const n=meta.dates.length,s=meta.stocks.length;
const arrays=Object.fromEntries(fields.map(f=>[f,new Float32Array(n*s)]));
let offset=0;
for(const entry of meta.chunks){
 if(entry.start!==offset)throw Error('Discontinuous source chunks');
 const buffer=fs.readFileSync(path.join(source,entry.file));
 if(buffer.length!==entry.count*s*fields.length*4)throw Error('Invalid source chunk size: '+entry.file);
 const sha=crypto.createHash('sha256').update(buffer).digest('hex');
 if(sha!==entry.sha256)throw Error('Source chunk checksum mismatch: '+entry.file);
 const values=new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
 const size=entry.count*s;
 for(let f=0;f<fields.length;f++)arrays[fields[f]].set(values.subarray(f*size,(f+1)*size),offset*s);
 offset+=entry.count;
}
if(offset!==n)throw Error('Incomplete source dates');
const engine=new AtlasEngine({...meta,quality:{...meta.quality}},arrays);
const start=meta.dates[Math.max(0,n-63)],end=meta.dates[n-1],window=1,mode='dynamic';
const result=engine.request('/api/market',{start,end,window,mode});
const body=Buffer.from(JSON.stringify(result));
const sha256=crypto.createHash('sha256').update(body).digest('hex');
const file='recent.'+sha256.slice(0,16)+'.json.gz';
fs.writeFileSync(path.join(target,file),zlib.gzipSync(body,{level:6,mtime:0}));
process.stdout.write(JSON.stringify({file,sha256,length:body.length,start,end,window,mode}));
