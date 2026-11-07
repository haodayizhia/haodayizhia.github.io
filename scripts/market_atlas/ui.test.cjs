'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{geometry,bounds,ticks,path:linePath}=require('../../resources/market-atlas/charts.js');
test('mobile chart preserves the vertical axis and a usable plotting area',()=>{
 for(const width of [264,288,318,342,760,1200]){const g=geometry(width,300);assert.ok(g.left>=55);assert.ok(g.width>=width-90);assert.ok(g.right<=width-16);assert.ok(g.bottom>g.top+180);}
});
test('chart domains preserve zero and gaps without non-finite coordinates',()=>{
 assert.deepEqual(bounds([{values:[null,NaN]}]),[-1,1]);const[lo,hi]=bounds([{values:[0,0,0]}]);assert.ok(lo<0&&hi>0);
 assert.equal(linePath([1,null,3],i=>i,v=>v),'M0.00,1.00M2.00,3.00');assert.ok(ticks(-2,5).every(Number.isFinite));
});
test('every built page installs a matching inline theme before the main stylesheet',()=>{
 const root=path.resolve(__dirname,'../..');
 for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.html'))){
  const html=fs.readFileSync(path.join(root,name),'utf8'),match=html.match(/<script data-bro-theme>([\s\S]*?)<\/script>/);
  assert.ok(match,'Theme boot missing: '+name);assert.ok(html.indexOf('<script data-bro-theme>')<html.indexOf('./assets/css/style.css'),name);
  assert.equal((html.match(/<script data-bro-theme>/g)||[]).length,1,name);assert.ok(html.includes('data-bro-theme-canvas'),name);
  if(name==='market-atlas.html'){const hash=crypto.createHash('sha256').update(match[1].replace(/\r\n?/g,'\n')).digest('base64');assert.ok(html.includes("'sha256-"+hash+"'"),'Theme CSP hash does not match HTML parser-normalized script');}
 }
});
