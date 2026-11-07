'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{Chart,geometry,bounds,ticks,path:linePath}=require('../../resources/market-atlas/charts.js');
const{zoomRange}=require('../../resources/market-atlas/chart-interaction.js');

test('pinch zoom preserves its date anchor and stops at data boundaries',()=>{
 const next=zoomRange([0,202],203,2,.25);assert.deepEqual(next,[25.25,126.25]);
 for(const anchor of [0,.25,.5,1])for(const factor of [.01,.5,2,1000]){const [a,b]=zoomRange([40,80],203,factor,anchor);assert.ok(a>=0&&b<=202&&b-a>=5);}
 assert.deepEqual(zoomRange([0,0],1,2),[0,0]);assert.deepEqual(zoomRange([0,0],0,2),[0,0]);
});

test('small pinch steps retain fractional dates without rounding back outward',()=>{
 const chart={dates:Array.from({length:203},(_,i)=>String(i)),view:[0,202],draw(){},onRange(){}};
 for(let i=0;i<40;i++){const before=chart.view[1]-chart.view[0];Chart.prototype.setRange.call(chart,...zoomRange(chart.view,203,1.01,.5));assert.ok(chart.view[1]-chart.view[0]<before);}
 assert.ok(chart.view[0]%1>0);
});

test('a zoomed or panned chart reads a date inside its visible interval',()=>{
 let observed;
 const chart={dates:Array.from({length:203},(_,i)=>String(i)),index:202,axisValue:9,draw(){},onRange(){},onInspect(i){observed=i;}};
 Chart.prototype.setRange.call(chart,10.1,70.6,true);assert.equal(chart.index,70);assert.equal(observed,70);assert.equal(chart.axisValue,null);
});

test('market chart entry has no automatic selection, lock button or date slider',()=>{
 const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(path.join(root,'market-atlas.html'),'utf8');
 assert.doesNotMatch(html,/<input[^>]+type=["']range["']/);assert.doesNotMatch(html,/inspect-lock/);
 for(const name of ['chart-interaction.js','maps.js'])assert.ok(html.includes('./resources/market-atlas/'+name));
});
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
