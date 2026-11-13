'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{Chart,geometry,axisNumber,bounds,ticks,path:linePath,rankLatest,seriesStyle,compareMetric,traceWidth,traceOpacity,zoomDomain,autoVisibleRange}=require('../../resources/market-atlas/charts.js');
const{rotationTrail,rotationSettings}=require('../../resources/market-atlas/maps.js');
const{zoomRange}=require('../../resources/market-atlas/chart-interaction.js');

test('stock chart uses global research period and free zoom, not 20/60-day presets',()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../../resources/market-atlas/ui.js'),'utf8');
 assert.doesNotMatch(ui,/id="stockSpan"/);
 assert.ok(ui.includes("options.stock?[0,chart.dates.length-1]:chart.defaultView()"));
});
test('heatmap hover dismissal and second tap cannot leave a ghost selection',()=>{
 const heat=Object.create(globalThis.AtlasMaps.Heatmap.prototype),seen=[];
 Object.assign(heat,{dates:['d0','d1','d2'],rows:[{id:'a',name:'A'}],index:0,row:0,focus:'a',inspectionActive:true,pinned:null,onInspect:i=>seen.push(i),updateCursor(){}});
 heat.clearInspection(true);
 assert.equal(heat.inspectionActive,false,'Unpinned hover must stop highlighting');
 assert.equal(heat.index,2,'Leaving an unpinned historical hover must restore latest date');
 assert.deepEqual(seen,[2]);
 heat.inspect=function(){this.inspectionActive=true;this.focus='a';this.row=0;this.index=0;};
 heat.select({});
 assert.equal(heat.pinned,'a','First tap should pin exactly one heatmap row');
 heat.select({});
 assert.equal(heat.pinned,null,'Second tap on the same row must unpin');
 assert.equal(heat.inspectionActive,false,'Second tap must remove the selection overlay');
 assert.equal(heat.row,undefined,'Second tap must remove the highlighted row');
});
test('rotation focus only survives a pointer exit when the user pinned a point',()=>{
 const scatter=Object.create(globalThis.AtlasMaps.Scatter.prototype),point={name:'A'};
 Object.assign(scatter,{points:[point],pinned:'',focus:'',inspectionActive:false,nearest:()=>point,draw(){}});
 scatter.pick({});
 assert.equal(scatter.pinned,'A');
 scatter.clearInspection(true);
 assert.equal(scatter.pinned,'A','Fixed trajectory should survive pointer exit');
 scatter.pick({});
 assert.equal(scatter.pinned,'','Tapping the same point again must unpin');
 assert.equal(scatter.inspectionActive,false);
 scatter.nearest=()=>null;scatter.pick({});
 assert.equal(scatter.inspectionActive,false,'Tapping empty plot space must not create a default focus');
});
test('default date viewport first fits all sessions, otherwise keeps the latest',()=>{
 assert.deepEqual(autoVisibleRange(63,400,'lines'),[0,62]);
 assert.deepEqual(autoVisibleRange(63,400,'candles'),[27,62]);
 assert.deepEqual(autoVisibleRange(690,300,'lines'),[540,689]);
 assert.deepEqual(autoVisibleRange(690,300,'candles'),[663,689]);
 assert.deepEqual(autoVisibleRange(690,1200,'candles'),[581,689]);
 assert.deepEqual(autoVisibleRange(1,300,'candles'),[0,0]);
 assert.deepEqual(autoVisibleRange(0,300,'lines'),[0,0]);
});
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

test('market chart entry offers all-selection and removes the global date picker and lock',()=>{
 const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(path.join(root,'market-atlas.html'),'utf8');
 assert.doesNotMatch(html,/<input[^>]+type=["']range["']/);assert.doesNotMatch(html,/inspect-lock|id="atlasDate"|class="date-control"/);assert.ok(html.includes('id="selectAllComparison"'));
 for(const name of ['chart-interaction.js','maps.js'])assert.ok(html.includes('./resources/market-atlas/'+name));
});
test('industry curve width and opacity are consistent regardless of constituent count',()=>{
 for(const size of [3,10,12,13,91,166]){
  assert.equal(traceWidth(false),1.2,'Normal curve width changes with '+size);
  assert.equal(traceWidth(true),1.2,'Unselected benchmark is not visually preselected at '+size+' series');
  assert.equal(traceWidth(false,true),2.5,'Focused curve width changes with '+size);
  assert.equal(traceOpacity(size,false,false,false),.48);
   assert.equal(traceOpacity(size,false,true,false),.48,'Benchmark opacity must match other unfocused lines');
  assert.equal(traceOpacity(size,true,false,false),.16);
 }
});
test('industry curve emphasis is independent of selected stock count',()=>{
 for(const size of [2,3,11,12,13,166]){
  const idle=traceOpacity(size,false,false,false),dim=traceOpacity(size,true,false,false);
  assert.ok(idle>0&&idle<1,'Default stock line unexpectedly highlighted for '+size+' series');
  assert.ok(dim<idle,'Unfocused stock must fade when another stock receives focus');
  assert.equal(traceOpacity(size,true,false,true),1,'Focused stock must be prominent');
  assert.equal(traceOpacity(size,true,true,false),1,'Industry and pool benchmarks stay visible');
 }
 assert.equal(traceOpacity(1,false,false,false),1,'A single isolated curve stays legible');
});

test('mobile chart preserves the vertical axis and a usable plotting area',()=>{
 for(const width of [264,288,318,342,760,1200])for(const labelWidth of [18,24,36,64]){const g=geometry(width,300,labelWidth);assert.ok(g.left>=labelWidth+7);assert.ok(g.width>=width-Math.max(38,labelWidth+16));assert.equal(width-g.right,6);assert.ok(g.bottom>g.top+180);}
 assert.equal(axisNumber(-50),'-50');assert.equal(axisNumber(0),'0');assert.equal(axisNumber(.25),'0.25');assert.equal(axisNumber(.00002),'0.00002');assert.notEqual(axisNumber(1000010),axisNumber(1000015));
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

test('rotation trails sample actual weekly observations including the current session',()=>{
 const row={x:Array.from({length:50},(_,i)=>i/10),y:Array.from({length:50},(_,i)=>i%2?null:i)};
 const trail=rotationTrail(row,39);assert.deepEqual(trail.map(p=>p.index),[19,24,29,34,39]);
 assert.equal(trail[0].y,null);assert.equal(trail.at(-1).x,row.x[39]);
 assert.deepEqual(rotationTrail(row,3).map(p=>p.index),[3]);
});

test('latest ranking uses the actual final session, preserves missing values last and never mutates data',()=>{
 const rows=[{name:'B',v:[100,null]},{name:'C',v:[-100,3]},{name:'A',v:[10,3]},{name:'D',v:[99,0]}];
 assert.deepEqual(rankLatest(rows,s=>s.v.at(-1)).map(s=>s.name),['A','C','D','B']);assert.equal(rows[0].name,'B');
});
test('each of 91 industries has a distinct stable hue/line-pattern pair',()=>{
 const keys=Array.from({length:91},(_,i)=>JSON.stringify(seriesStyle(i)));assert.equal(new Set(keys).size,91);assert.deepEqual(seriesStyle(16),seriesStyle(16));
});
test('numeric zoom preserves its anchor, supports negative domains and is reversible',()=>{
 assert.deepEqual(zoomDomain([-10,30],2,.25),[-5,15]);assert.deepEqual(zoomDomain(zoomDomain([-10,30],2,.25),.5,.25),[-10,30]);assert.deepEqual(zoomDomain([2,4],0),[2,4]);
});
test('short rotation windows use daily trails and the engine change interval',()=>{
 for(const window of [1,5,10,20,60]){const {lag,trailStep}=rotationSettings(window);assert.equal(lag,window===1?1:5);assert.equal(trailStep,window<=5?1:window===10?2:5);}
 const row={x:Array(20).fill(1),y:Array(20).fill(2)};assert.deepEqual(rotationTrail(row,12,rotationSettings(5).trailStep).map(p=>p.index),[8,9,10,11,12]);
});

test('crosshair dates remain inside the zoomed visible sessions at either margin',()=>{
 const chart={dates:Array(100),view:[10.25,20.75],g:{left:58,width:200}};
 assert.equal(Chart.prototype.indexAt.call(chart,0),11);assert.equal(Chart.prototype.indexAt.call(chart,1000),20);
 assert.equal(Chart.prototype.indexAt.call(chart,158),16);
});

test('industry metric benchmarks use wealth ratios for returns and point spreads for risks',()=>{
 const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} differs from ${b}`);
 close(compareMetric('path',10,6),((1.1/1.06)-1)*100);
 close(compareMetric('momentum',20,10),((1.2/1.1)-1)*100);
 assert.equal(compareMetric('relative',20,10),10);
 assert.equal(compareMetric('drawdown',-15,-8),-7);
 assert.equal(compareMetric('vol',32,23),9);
 for(const key of ['path','momentum','relative','drawdown','vol']){
   assert.equal(compareMetric(key,null,3),null);
   assert.equal(compareMetric(key,3,undefined),null);
   assert.equal(compareMetric(key,NaN,3),null);
 }
 assert.equal(compareMetric('path',12,-100),null);
 assert.equal(compareMetric('momentum',12,-101),null);
 assert.equal(compareMetric('path',-101,5),null);
});
