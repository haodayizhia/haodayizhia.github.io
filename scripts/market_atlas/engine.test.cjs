'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {AtlasEngine,fields}=require('../../resources/market-atlas/engine.js');
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
 assert.equal(imported.meta.source_kind,'merged');assert.equal(imported.s,1);
});
