'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {AtlasEngine,fields}=require('../../resources/market-atlas/engine.js');
const {nearestPolylineSegment}=require('../../resources/market-atlas/charts.js');
const {CSVParser,dateValue}=require('../../resources/market-atlas/csv.js');
const fixture=require('./parity-fixture.json');
const engine=new AtlasEngine(structuredClone(fixture.meta),Object.fromEntries(fields.map(f=>[f,Float32Array.from(fixture.arrays[f],v=>v===null?NaN:v)])));
function compare(actual,expected,at='result'){
 if(typeof expected==='number'){assert.equal(typeof actual,'number',at);assert.ok(Math.abs(actual-expected)<=.000025+Math.abs(expected)*.0000002,`${at}: ${actual} != ${expected}`);}
 else if(Array.isArray(expected)){assert.equal(actual.length,expected.length,at);expected.forEach((v,i)=>compare(actual[i],v,at+'['+i+']'));}
 else if(expected&&typeof expected==='object'){assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),at);for(const [k,v]of Object.entries(expected))compare(actual[k],v,at+'.'+k);}
 else assert.equal(actual,expected,at);
}
for(const [i,c] of fixture.cases.entries())test('Python parity '+i+' '+c.path+' '+JSON.stringify(c.query),()=>compare(engine.request(c.path,c.query),c.result));
test('unavailable dates and unsupported cohorts fail explicitly',()=>{assert.throws(()=>engine.market({start:'2025-01-01',end:fixture.meta.dates.at(-1)}),/交易日/);assert.throws(()=>engine.cohort(0,2,'guess'),/口径/);});
test('streaming CSV handles BOM, escaped quotes and line breaks across chunks',()=>{
 const rows=[],p=new CSVParser(row=>rows.push(row));
 for(const ch of '\uFEFF代码,名称,备注\r\n000001.SZ,"a,""b""","一\n二"\r\n')p.write(ch);
 p.write('',true);assert.deepEqual(rows,[['\uFEFF代码','名称','备注'],['000001.SZ','a,"b"','一\n二']]);
 assert.throws(()=>{const x=new CSVParser(()=>{});x.write('"unfinished',true);},/闭合/);
});
test('dates are strictly real calendar dates',()=>{assert.equal(dateValue('20260230'),null);assert.equal(dateValue('20260105.0').iso,'2026-01-05');});
test('local CSV import computes real data and rejects invalid schemas',async()=>{
 const File=globalThis.File||require('node:buffer').File;
 const header='代码,名称,交易日期,所属行业,现价,涨幅%,成交额(亿元),换手率,MA20,成交量(股)\n';
 const body=header+'000001.SZ,平安,20260105,银行,10,0,1,2,9,10000\n000001.SZ,平安,20260106,银行,11,10,2,2,10,20000\n';
 const imported=await globalThis.importAtlasCsv([new File([body],'行情.csv')],'merged');
 assert.equal(imported.s,1);assert.equal(imported.ret[1],10.000000000000009);assert.equal(imported.volume[1],2);
 const out=imported.market({start:'2026-01-05',end:'2026-01-06',window:1,mode:'dynamic'});assert.equal(out.pool.path[0],0);assert.ok(Math.abs(out.pool.path[1]-10)<1e-8);
 await assert.rejects(globalThis.importAtlasCsv([new File(['代码,名称\nwrong,x'],'bad.csv')],'merged'),/缺少字段/);
 await assert.rejects(globalThis.importAtlasCsv([new File([body.replaceAll('000001.SZ','600001.SH')],'000001.SZ.csv')],'directory'),/不一致/);
 await assert.rejects(globalThis.importAtlasCsv([new File([body],'000001.SZ.csv'),new File([body],'000001.SZ.csv')],'directory'),/同名/);
 assert.equal(imported.meta.source_kind,'merged');assert.equal(imported.s,1);
});

test('line hit testing uses actual segments halfway between observations',()=>{
 const steep={id:'steep',values:[0,100,0,100]},other={id:'other',values:[130,130,130,130]};
 const X=i=>i*100,Y=v=>v;
 assert.equal(nearestPolylineSegment([steep,other],X,Y,50,50,.5,4,11)?.id,'steep');
 assert.equal(nearestPolylineSegment([steep,other],X,Y,150,50,1.5,4,11)?.id,'steep');
 assert.equal(nearestPolylineSegment([steep,other],X,Y,50,79,.5,4,10),null,'Off-segment clicks should not select an unrelated line');
 assert.equal(nearestPolylineSegment([{id:'ref',reference:true,values:[0,100]},{id:'actual',values:[0,100]}],X,Y,50,50,.5,2,11)?.id,'actual','Reference curves should not steal selection');
 assert.equal(nearestPolylineSegment([{id:'gap',values:[0,NaN,100]}],X,Y,50,50,.5,3,60),null,'An unavailable observation must break the line');
 assert.equal(nearestPolylineSegment([{id:'one',values:[10]}],X,Y,0,10,0,1,6)?.id,'one','A single visible sample is selectable');
});

const structure=require('../../resources/market-atlas/structure.js');
function structureFixture(changeFuture=false){
 const dates=Array.from({length:30},(_,i)=>'2026-01-'+String(i+1).padStart(2,'0'));
 const stocks=['A','A','A','B','C'].map((industry,i)=>({code:String(i),name:String(i),industry}));
 const s=stocks.length,arrays=Object.fromEntries(fields.map(key=>[key,new Float32Array(dates.length*s).fill(NaN)]));
 for(let t=0;t<dates.length;t++)for(let i=0;i<s;i++){
   if(i===2&&t<8||i===1&&t===16)continue;
   arrays.close[t*s+i]=changeFuture&&t>21?(i===3?NaN:300-i*t):100+(i===0?t:i===1?-t:i===2?2*t:0);
 }
 return new AtlasEngine({dates,stocks,quality:{}},arrays);
}
test('structure windows, membership and compressed points agree on every prefix',()=>{
 const engine=structureFixture(),dates=engine.meta.dates;
 const full=structure.calculate(engine,{start:dates[0],end:dates.at(-1)},true);
 const at=21,rows=full.days[at],group=full.summary.groups.find(x=>x.name==='A');
 assert.equal(group.count[at],1);assert.equal(group.up[at],1);
 assert.ok(Math.abs(group.median[at]-(121/101-1)*100)<1e-5);
 assert.equal(group.count[19],0);assert.equal(group.p90[19],null);
 assert.equal(full.summary.groups.find(x=>x.name==='B').sector[at],0);
 assert.equal(rows.find(r=>r[0]===3)[2],null,'Singleton is not a peer benchmark');
 const buffer=structure.pack(full.days,engine.s);
 assert.deepEqual(structure.unpack(buffer,at,dates.length,engine.s),rows.slice().sort((a,b)=>a[0]-b[0]));
 for(const mode of ['dynamic','complete']){
   const q={start:dates[10],end:dates[at],mode};
   const prefix=structure.calculate(engine,q);
   assert.deepEqual(prefix,structure.calculate(structureFixture(true),q),'Future changes contaminated '+mode);
   if(mode==='dynamic'){
     assert.deepEqual(prefix.summary,structure.slice(full.summary,q.start,q.end));
     assert.deepEqual(prefix.days[0],rows);
   }
 }
 assert.equal(structure.quantile([1,2,4,8],.5),3);
 assert.equal(structure.quantile([], .9),null);
});
test('daily lead-lag aligns sessions before dropping missing pairs',()=>{
 const x=[2,0,null,3,1,6,4], y=[null,2,0,null,3,1,6];
 assert.deepEqual(structure.correlation(x,y,1),{n:5,value:1});
 assert.equal(structure.correlation([1,1,1],[1,2,3]).value,null);
 assert.equal(structure.correlation([2],[3]).value,null);
});
