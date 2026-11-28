'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{Chart,geometry,axisNumber,bounds,ticks,path:linePath,rankLatest,seriesStyle,traceWidth,traceOpacity,zoomDomain,autoVisibleRange,chartHeight,volumeReserve,visibleExtremes,extremeLabel,returnToLatest}=require('../../resources/market-atlas/charts.js');
const{rotationTrail,rotationSettings}=require('../../resources/market-atlas/maps.js');
const{zoomRange,stockReadoutGroups,stockReadoutCell}=require('../../resources/market-atlas/chart-interaction.js');

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
 
test('industry curves use true benchmarks and no hidden baseline selection',()=>{
 const charts=require('../../resources/market-atlas/charts.js');
 const ui=fs.readFileSync(path.join(__dirname,'../../resources/market-atlas/ui.js'),'utf8');
 assert.equal('compareMetric' in charts,false);
 assert.ok(ui.includes("name:'股票池等权'")&&ui.includes("name:'本行业等权'"));
 assert.ok(ui.includes("name:'本行业等权 · 相对股票池'"));
 assert.doesNotMatch(ui,/industryBenchmark|S\.benchmark|industryTitles/);
 assert.ok(ui.includes("bro.atlas.navigation.v2"));
 assert.ok(ui.includes("delete migrated.benchmark"),'Legacy benchmark state must be migrated');
});


test('stock price pane uses responsive height and reserves proportional volume space',()=>{
 for(const [width,vh] of [[320,740],[390,844],[760,800],[1280,800],[1560,900],[2560,1200]]){
  const h=chartHeight(width,vh,'candles'),g=geometry(width,h),reserve=volumeReserve(g.height);
  assert.ok(h>=(width<=760?420:500)&&h<=(width<=760?520:700));
  assert.ok(reserve>0&&reserve<=g.height*.30&&g.height-reserve>260);
 }
 assert.equal(chartHeight(390,844,'lines',true),130);
 assert.equal(chartHeight(1200,900,'lines',true),164);
 assert.equal(chartHeight(390,844,'lines'),350);
 assert.ok(chartHeight(1440,1000,'lines')>460);
 assert.ok(volumeReserve(148)<45,'Short fullscreen price pane must remain usable');
});
test('price domain padding includes all extrema and handles gaps or flat prices',()=>{
 assert.deepEqual(bounds([{values:[10,14,null]}],.05),[9.8,14.2]);
 assert.deepEqual(bounds([{values:[10,14]}]),[9.6,14.4]);
 const [lo,hi]=bounds([{values:[15.27,15.27]}],.05);assert.ok(lo<15.27&&hi>15.27);
 assert.deepEqual(visibleExtremes({high:[99,13,null,15,80],low:[1,11,10,12,2]},1,3),{high:{index:3,value:15},low:{index:2,value:10}});
 assert.deepEqual(visibleExtremes({high:[13],low:[11]},0,0,()=>false),{high:null,low:null});
});


test('extreme callouts stay horizontal and choose a side with space',()=>{
 const g={left:30,right:330,top:12,bottom:300};
 assert.equal(extremeLabel(150,280,35,g,false).side,-1);
 assert.equal(extremeLabel(310,25,35,g,true).side,-1);
 assert.equal(extremeLabel(40,280,35,g,false).side,1);
 assert.equal(extremeLabel(150,100,35,g,true,[{left:170,right:250,top:92,bottom:108}]).side,-1);
 assert.equal(extremeLabel(150,299,35,g,false),null);
});
test('stock return to latest close is independent of visible window',()=>{
 assert.ok(Math.abs(returnToLatest(10.8,19.86)-83.88888888888889)<1e-9);
 assert.equal(returnToLatest(10,10),0);
 assert.equal(returnToLatest(20,10),-50);
 for(const [a,b] of [[null,10],[10,null],[0,10],[10,0],[NaN,10]])assert.equal(returnToLatest(a,b),null);
 const stock={open:[10,12],high:[11,13],low:[9,11],close:[10,12],daily:[0,20],volume:[1,1]};
 const chart={stock,index:0,series:[],afterwards:true,latestClose:15,latestDate:'2026-11-26',view:[0,0]};
 const row=()=>Chart.prototype.getRows.call(chart).find(r=>r.name==='距今涨幅');
 assert.equal(row().value,50);assert.equal(row().signed,true);assert.match(row().title,/2026-11-26/);
 chart.index=1;chart.view=[1,1];assert.equal(row().value,25);
 chart.latestClose=null;assert.equal(row().value,null);chart.afterwards=false;assert.equal(row(),undefined);
});


test('stock readout groups OHLC, daily and cumulative return, then supplementary metrics in fixed order',()=>{
 const names=['开盘','最高','最低','收盘','涨跌','距今涨幅','成交量','MA5','MA10','MA20'];
 const rows=names.map((name,i)=>({name,value:i,unit:i<4?'元':i<6?'%':'',signed:i===5}));
 const groups=stockReadoutGroups(rows);
 assert.deepEqual(groups.prices.map(r=>r.name),names.slice(0,4));
 assert.deepEqual(groups.changes.map(r=>r.name),names.slice(4,6));
 assert.deepEqual(groups.more.map(r=>r.name),names.slice(6));
 const reordered=stockReadoutGroups([...rows].reverse());assert.deepEqual(reordered.prices.map(r=>r.name),names.slice(0,4));assert.deepEqual(reordered.changes.map(r=>r.name),names.slice(4,6));
 assert.match(stockReadoutCell({name:'开盘',value:10.5,unit:'元'}),/10\.50/);
 assert.match(stockReadoutCell({name:'涨跌',value:-2,unit:'%'}),/当日涨跌.*readout-fall/);
 assert.match(stockReadoutCell({name:'距今涨幅',value:10,unit:'%',signed:true}),/readout-rise.*\+10\.00/);
 assert.match(stockReadoutCell({name:'距今涨幅',value:null,unit:'%',signed:true}),/—/);
});


test('MarketAtlas palette C remains consistent across quote and candle marks',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../../resources/market-atlas/atlas.css'),'utf8');
 assert.ok(css.includes('--rise:#b84e44;--fall:#277f65;'));
 assert.ok(css.includes('--rise:#d98479;--fall:#68ad91;'));
 assert.ok(css.includes('--candle-rise:var(--rise);--candle-fall:var(--fall)'));
 assert.ok(!css.includes('--heat-neutral:'));
});


test('structure header and constituent rows share one linear return scale',()=>{
 require('../../resources/market-atlas/research-ui.js');
 const {distributionX,distributionTicks}=globalThis.AtlasResearch,domain=[-50,100];
 assert.equal(distributionX(-50,domain),0);assert.equal(distributionX(100,domain),100);assert.equal(distributionX(25,domain),50);
 assert.ok(distributionTicks(domain).every(v=>v>=-50&&v<=100));
});
test('two nearby taps reset without committing either single tap',()=>{
 const gesture=Object.create(globalThis.AtlasGesture.prototype),calls=[];
 gesture.handlers={reset:()=>calls.push('reset')};
 gesture.queueTap({x:10,y:20},'mouse',()=>calls.push('tap'));
 gesture.queueTap({x:12,y:20},'mouse',()=>calls.push('tap'));
 assert.deepEqual(calls,['reset']);assert.equal(gesture.pendingTap,null);
 gesture.queueTap({x:10,y:20},'touch',()=>calls.push('tap'));
 gesture.queueTap({x:12,y:20},'touch',()=>calls.push('tap'));
 assert.deepEqual(calls,['reset','reset']);gesture.clearTap();
});


test('distribution gestures use a common bounded horizontal viewport',()=>{
 require('../../resources/market-atlas/research-ui.js');
 const {distributionView,distributionRank}=globalThis.AtlasResearch,full=[-60,120];
 assert.deepEqual(distributionView(full,full,2,.5),[-15,75]);
 assert.ok(distributionView([-15,75],full,1,.5,.7).every((v,i)=>Math.abs(v-[-33,57][i])<1e-9));
 assert.deepEqual(distributionView([-15,75],full,1,.5,2),[-60,30]);
 assert.deepEqual(distributionView([-15,75],full,0),full);
 assert.deepEqual(distributionView([-15,75],full,.1),full);
 const g={wins:[12],sector:[20],excess5:[3],up:[5],count:[8]};
 assert.equal(distributionRank(g,4,'wins'),12);
 assert.equal(distributionRank(g,4,'excess'),16);
 assert.equal(distributionRank(g,4,'excess5'),3);
 assert.equal(distributionRank(g,4,'breadth'),5/8);
 assert.equal(distributionRank({...g,count:[0]},4,'breadth'),null);
});
test('individual stock price chart has one fixed daily-candle view',()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../../resources/market-atlas/ui.js'),'utf8');
 assert.doesNotMatch(ui,/id="stockMode"|kind:S\.stockMode/);
 assert.ok(ui.includes("kind:'candles',label:info.name+'日线'"));
});


test('distribution point hit testing uses exact shared coordinate mapping',()=>{
 require('../../resources/market-atlas/research-ui.js');
 const {distributionHit}=globalThis.AtlasResearch,points=[{i:1,value:0},{i:2,value:20},{i:3,value:80}];
 assert.equal(distributionHit(points,[-20,40],300,100,17)?.i,1);
 assert.equal(distributionHit(points,[-20,40],300,200,17)?.i,2);
 assert.equal(distributionHit(points,[-20,40],300,200,25)?.i,2);
 assert.equal(distributionHit(points,[-20,40],300,211,2)?.i,2);
 assert.equal(distributionHit(points,[-20,40],300,213,17),null);
 assert.equal(distributionHit(points,[-20,40],300,200,29),null);
 assert.equal(distributionHit(points,[-20,40],300,216,17,18)?.i,2);
 assert.equal(distributionHit([{i:4,value:20},{i:5,value:22}],[-20,40],300,207,17)?.i,5);
 assert.equal(distributionHit([{i:4,value:20},{i:5,value:22}],[-20,40],300,203,17)?.i,4);
 assert.equal(distributionHit(points,[-20,40],300,299,17),null);
 assert.equal(distributionHit(points,[10,30],300,150,17)?.i,2);
});

test('scatter zoom and pan retain valid data bounds',()=>{
 require('../../resources/market-atlas/research-ui.js');
 const {scatterRange}=globalThis.AtlasResearch;
 assert.deepEqual(scatterRange([0,20],[0,20],2,.5),[5,15]);
 assert.deepEqual(scatterRange([5,15],[0,20],1,.5,1),[0,10]);
 assert.deepEqual(scatterRange([5,15],[0,20],.1),[0,20]);
 assert.deepEqual(scatterRange([0,20],[0,20],100,.5),[9.5,10.5]);
});
test('scatter reference labels avoid overlaps and respect plot boundaries',()=>{
 const {scatterLabels}=globalThis.AtlasResearch;
 const labels=scatterLabels([{y:95},{y:96},{y:97}],0,100,17);
 assert.deepEqual(labels.map(r=>r.labelY),[66,83,100]);
 assert.deepEqual(labels.map(r=>r.y),[95,96,97]);
});

test('scatter tap selects immediately and double tap restores prior selection before reset',()=>{
 const gesture=Object.create(globalThis.AtlasGesture.prototype),calls=[];
 gesture.handlers={immediateTap:true,reset:()=>calls.push('reset')};
 const pick=()=>{calls.push('pick');return ()=>calls.push('undo');};
 gesture.queueTap({x:10,y:20},'mouse',pick);
 assert.deepEqual(calls,['pick']);
 gesture.queueTap({x:12,y:20},'mouse',pick);
 assert.deepEqual(calls,['pick','undo','reset']);
 gesture.queueTap({x:10,y:20},'mouse',pick);
 gesture.queueTap({x:50,y:20},'mouse',pick);
 assert.deepEqual(calls,['pick','undo','reset','pick','pick']);
 gesture.clearTap();
});

test('scatter baseline labels remain outside all plotted lines, at desktop and mobile widths',()=>{
 require('../../resources/market-atlas/research-ui.js');
 const {scatterReferenceLayout,scatterLabels}=globalThis.AtlasResearch;
 for(const width of [264,320,768,1440]){
  const left=42,labelWidth=88;
  const g=scatterReferenceLayout(width,left,labelWidth);
  assert.ok(g.right>left);
  assert.ok(g.leaderStart>g.right&&g.leaderEnd<g.labelX);
  assert.ok(g.labelX+labelWidth<=width-6);
  assert.ok(g.right===width-6-labelWidth-24);
 }
 const labels=scatterLabels([{y:100},{y:100},{y:101}],20,200,18);
 assert.ok(labels[1].labelY-labels[0].labelY>=18);
 assert.ok(labels[2].labelY-labels[1].labelY>=18);
 assert.deepEqual(labels.map(r=>r.y),[100,100,101]);
});

test('light theme benchmark clarity does not alter dark mode or ordinary series opacity',()=>{
 const {chartTraceOpacity}=require('../../resources/market-atlas/charts.js');
 assert.equal(chartTraceOpacity({count:91,reference:true}),1);
 assert.equal(chartTraceOpacity({count:91,reference:true,dark:true}),.48);
 assert.equal(chartTraceOpacity({count:91}),.48);
 assert.equal(chartTraceOpacity({count:91,focus:true}),.16);
 assert.equal(chartTraceOpacity({keepSeriesVisible:true}),1);
 assert.equal(chartTraceOpacity({keepSeriesVisible:true,dark:true}),.88);
});
test('semantic range and stock-pool colors are separate from the original industry palette',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../../resources/market-atlas/atlas.css'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'../../resources/market-atlas/ui.js'),'utf8');
 const research=fs.readFileSync(path.join(__dirname,'../../resources/market-atlas/research-ui.js'),'utf8');
 assert.match(css,/--plot-benchmark:#414951;--plot-range:#8897a3/);
 assert.match(css,/--plot-benchmark:var\(--plot-main\);--plot-range:var\(--plot-blue\)/);
 assert.match(ui,/color:'var\(--plot-benchmark\)',dash:'6 4'/);
 assert.match(research,/\['pool','股票池等权','benchmark','6 4'\]/);
});

test('mobile chart pans vertically only when it owns a vertical viewport',()=>{
 const {touchPanAllowed}=require('../../resources/market-atlas/chart-interaction.js');
 assert.equal(touchPanAllowed(2,40,true,true),true);
 assert.equal(touchPanAllowed(40,2,true,true),true);
 assert.equal(touchPanAllowed(2,40,true,false),false);
 assert.equal(touchPanAllowed(40,2,true,false),true);
 assert.equal(touchPanAllowed(40,2,false,false),false);
});

test('frame scheduler coalesces inputs, flushes final state and cancels stale work',()=>{
 const {frameLatest}=require('../../resources/market-atlas/chart-interaction.js');
 let seq=0;const frames=new Map(),calls=[];
 const task=frameLatest((...args)=>calls.push(args),fn=>{frames.set(++seq,fn);return seq;},id=>frames.delete(id));
 task.push(1);task.push(2);task.push(3);
 assert.equal(frames.size,1);assert.deepEqual(calls,[]);
 task.flush();assert.deepEqual(calls,[[3]]);assert.equal(frames.size,0);
 task.push(4);task.cancel();assert.equal(frames.size,0);assert.deepEqual(calls,[[3]]);
});

test('rotation drag moves the existing layer and commits exact domain on release',()=>{
 const obj=Object.create(globalThis.AtlasMaps.Scatter.prototype);
 const attr=new Map(),layer={setAttribute:(k,v)=>attr.set(k,v),removeAttribute:k=>attr.delete(k)},label={style:{}};
 Object.assign(obj,{g:{width:200,height:100},domain:[-10,10,-5,5],dragDomain:[-10,10,-5,5],zoomedAxes:{x:true,y:true},svg:{querySelector:s=>s==='.rotation-data'?layer:label},draw(){this.draws=(this.draws||0)+1;}});
 obj.previewPan(20,10);assert.equal(attr.get('transform'),'translate(20 10)');assert.equal(obj.draws,undefined);
 assert.deepEqual(obj.domain,[-10,10,-5,5]);
 obj.finishPan();assert.deepEqual(obj.domain,[-12,8,-4,6]);assert.equal(obj.draws,1);assert.equal(attr.has('transform'),false);
});
test('distribution selection overlay updates immediately without canvas or hover',()=>{
 require('../../resources/market-atlas/research-ui.js');
 const {syncDistributionSelection}=globalThis.AtlasResearch;
 const make=name=>{const classes=new Set();return {group:{name},marker:{hidden:true,style:{}},row:{classList:{toggle:(key,on)=>on?classes.add(key):classes.delete(key)}},classes};};
 const a=make('IT服务'),b=make('银行'),p={industry:'IT服务',value:48.09};
 syncDistributionSelection(a,p,[-50,150]);syncDistributionSelection(b,p,[-50,150]);
 assert.equal(a.marker.hidden,false);assert.equal(a.marker.style.left,'49.045%');assert.ok(a.classes.has('dist-row-selected'));assert.equal(b.marker.hidden,true);
 syncDistributionSelection(a,p,[0,100]);assert.equal(a.marker.style.left,'48.09%');
 syncDistributionSelection(a,p,[-20,20]);assert.equal(a.marker.hidden,true);assert.ok(a.classes.has('dist-row-selected'));
 const next={industry:'银行',value:10};syncDistributionSelection(a,next,[0,100]);syncDistributionSelection(b,next,[0,100]);
 assert.equal(a.marker.hidden,true);assert.equal(a.classes.has('dist-row-selected'),false);assert.equal(b.marker.hidden,false);assert.equal(b.marker.style.left,'10%');
});

test('heatmap immediate selection returns an undo restoring the preceding inspection',()=>{
 const heat=Object.create(globalThis.AtlasMaps.Heatmap.prototype),seen=[];
 Object.assign(heat,{index:5,row:undefined,focus:null,pinned:null,inspectionActive:false,onInspect:i=>seen.push(i),updateCursor(){},inspect(){Object.assign(this,{index:0,row:2,focus:'A',inspectionActive:true});}});
 const undo=heat.select({});assert.equal(heat.pinned,'A');assert.equal(heat.index,0);
 undo();assert.equal(heat.index,5);assert.equal(heat.row,undefined);assert.equal(heat.pinned,null);assert.equal(heat.inspectionActive,false);assert.deepEqual(seen,[5]);
});

test('rotation immediate selection supports rollback and empty plot clears selection',()=>{
 const o=Object.create(globalThis.AtlasMaps.Scatter.prototype);
 Object.assign(o,{pinned:'A',focus:'A',inspectionActive:true,nearest:()=>({name:'B'}),draw(){}});
 const undo=o.pick({});assert.equal(o.pinned,'B');undo();assert.equal(o.pinned,'A');
 o.nearest=()=>null;o.pick({});assert.equal(o.pinned,'');assert.equal(o.inspectionActive,false);
});
