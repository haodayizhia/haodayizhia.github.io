const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const{chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.env.ATLAS_QA_OUTPUT||'work/atlas-interaction-qa');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://local').pathname;
 const file=path.resolve(root,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=process.env.QA_URL||`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,...(process.env.ATLAS_QA_CHROME?{executablePath:process.env.ATLAS_QA_CHROME}:{})});
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}),page=await ctx.newPage(),errors=[];
 const track=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});};track(page);
 const cdp=await ctx.newCDPSession(page),touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((p,i)=>({...p,id:i+1}))});
 const state=fn=>page.evaluate(fn),span=()=>state(()=>{const v=AtlasWorkspace.state.charts[0].view;return v[1]-v[0]});
 // Short user-uploaded datasets remain deployable; exercise longer interactions in a local-only fixture.
 async function ensureResearchData(p){
  if(!process.env.ATLAS_QA_FIXTURE&&await p.evaluate(()=>AtlasWorkspace.state.meta.dates.length>=80&&AtlasWorkspace.state.meta.industries.length>=24))return;
  const dates=[];for(let d=new Date('2026-01-05T00:00:00Z');dates.length<90;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()%6!==0)dates.push(d.toISOString().slice(0,10).replaceAll('-',''));
  let csv='代码,名称,交易日期,所属行业,现价,涨幅%,成交额(亿元),换手率,MA20\n';
  for(let s=0;s<24;s++){let price=10+s;for(let i=0;i<dates.length;i++){const change=Math.sin(i*.17+s*.4)*1.7+(s-12)*.025;price*=1+change/100;csv+=`${String(s+1).padStart(6,'0')}.SZ,样例${s+1},${dates[i]},示例行业${String(s+1).padStart(2,'0')},${price},${change},1,1,${price*.98}\n`;}}
  await p.locator('#openAtlasData').click();await p.locator('#atlasMergedFile').setInputFiles({name:'browser-acceptance.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await p.locator('#atlasImportSubmit').click();
  await p.waitForFunction(()=>!AtlasWorkspace.state.busy&&AtlasWorkspace.state.meta.stocks.length===24&&AtlasWorkspace.state.meta.dates.length===90);await p.locator('[data-close-atlas="atlasDataDialog"]').click();
 }
 const yspan=()=>state(()=>{const c=AtlasWorkspace.state.charts[0];return c.hi-c.lo;});
 async function ready(){await page.waitForFunction(()=>window.AtlasWorkspace?.state.market&&AtlasWorkspace.state.charts.length,{timeout:90000});}
 async function fit(){assert.ok(await state(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal page overflow');assert.deepEqual(await state(()=>[...document.querySelectorAll('.atlas-chart,.atlas-scatter')].flatMap(svg=>[...svg.querySelectorAll('.axis-label')].filter(el=>{const b=el.getBBox();return b.x<-.5||b.x+b.width>svg.viewBox.baseVal.width+.5;}).map(el=>el.textContent))),[],'Axis labels clipped at a chart edge');assert.equal(await page.locator('.atlas-chart>.axis-unit').count(),0,'Unit is floating inside the plot');}
 async function backdrop(id){await page.mouse.click(2,2);assert.equal(await page.locator(id).evaluate(el=>el.open),false);}
 async function outsidePlot(readout,canvas){const a=await readout.boundingBox(),b=await canvas.boundingBox();assert.ok(a.y+a.height<=b.y+1,'Readout obstructs plot');}
 async function shot(name){const y=await state(()=>scrollY),modal=await page.locator('dialog[open]').count();if(!modal)await state(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(out,name+'.png'),fullPage:!modal});if(!modal)await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);}
 try{
  let documents=0;const dataRequests=[];page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())documents++;if(/\/resources\/market-atlas\/data\/.*\.(?:bin|json)\.gz(?:\?|$)/.test(r.url()))dataRequests.push(r.url());});
  await page.addInitScript(()=>{window.atlasHistoryWrites=0;window.atlasAddressWrites=[];const replace=history.replaceState;history.replaceState=function(...args){window.atlasHistoryWrites++;if(args.length>2)window.atlasAddressWrites.push(args[2]);return replace.apply(this,args);};});
  await page.goto(base+'/market-atlas.html');await ready();await fit();const previewInfo=await state(()=>AtlasWorkspace.state.meta.preview||null),isPublished=await state(()=>AtlasWorkspace.state.meta.source_kind==='public');if(isPublished&&previewInfo){assert.ok(dataRequests.some(url=>url.includes(previewInfo.file)),'Initial view must use the exact full-history preview');assert.equal(dataRequests.filter(url=>/\/\d{4}-\d{2}\.[a-f0-9]{16}\.bin\.gz$/.test(url)).length,0,'Initial view downloaded monthly raw stock files');}await ensureResearchData(page);
  const total=await state(()=>AtlasWorkspace.state.meta.dates.length),sectors=await state(()=>AtlasWorkspace.state.market.sectors.length),referenceRecent=isPublished&&previewInfo?await state(()=>({pool:AtlasWorkspace.state.market.pool,sectors:AtlasWorkspace.state.market.sectors.map(x=>x.series)})):null;
  assert.equal(await page.locator('#atlasPeriod').inputValue(),'63');assert.equal(await state(()=>AtlasWorkspace.state.market.dates.length),Math.min(63,total));assert.equal(await state(()=>AtlasWorkspace.state.selected.size),sectors);assert.equal(await state(()=>AtlasWorkspace.state.charts[0].series.length),sectors+1);
  assert.equal(await page.locator('#atlasDate,.date-control,.floating-inspector,.inspect-lock').count(),0);
  await outsidePlot(page.locator('.chart-readout'),page.locator('.chart-canvas'));await shot('390-all-industries-dark');
  await page.locator('#marketChart .readout-toggle').click();
  const candidates=page.locator('#marketChart .readout-all [data-focus-series]');
  assert.ok(await candidates.count()>6,'Dense chart must provide selectable readout rows');
  const chosen=await candidates.nth(5).getAttribute('data-focus-series');
  await candidates.nth(5).click();
  assert.equal(await state(()=>AtlasWorkspace.state.charts[0].pinned),chosen,'Readout row did not pin curve');
  assert.equal(await page.locator('#marketChart .readout-all [data-focus-series][aria-pressed="true"]').count(),1);
  const nextChosen=await candidates.nth(2).getAttribute('data-focus-series');
  await candidates.nth(2).click();
  assert.equal(await state(()=>AtlasWorkspace.state.charts[0].pinned),nextChosen,'Last clicked curve is the primary drill target');
  assert.deepEqual(await state(()=>[...AtlasWorkspace.state.charts[0].pinnedSet].sort()),[chosen,nextChosen].sort(),'Second selection must not replace the first');
  assert.equal(await page.locator('#marketChart .readout-all [data-focus-series][aria-pressed="true"]').count(),2,'Both pinned rows must remain active');
  await page.locator('#marketChart .chart-canvas').dispatchEvent('pointerleave',{pointerType:'mouse'});
  await page.locator('#marketChart').dispatchEvent('pointerleave',{pointerType:'mouse'});
  assert.deepEqual(await state(()=>[...AtlasWorkspace.state.charts[0].pinnedSet].sort()),[chosen,nextChosen].sort(),'Leaving the chart must preserve both pins');
  assert.equal(await page.locator('#marketChart .plot-overlay .crosshair').count(),0,'Temporary crosshair must clear');
  const activeAfterLeave=await state(()=>{const c=AtlasWorkspace.state.charts[0];return [...c.svg.querySelectorAll('[data-series]')].filter(e=>c.pinnedSet.has(e.dataset.series)).map(e=>Number(e.style.opacity));});
  assert.deepEqual(activeAfterLeave,[1,1],'Pinned lines must remain highlighted outside the plot');
  await candidates.nth(5).click();
  assert.deepEqual(await state(()=>[...AtlasWorkspace.state.charts[0].pinnedSet]),[nextChosen],'Clicking a pinned curve removes only that curve');
  await page.locator('.interaction-note').tap();
  assert.deepEqual(await state(()=>[...AtlasWorkspace.state.charts[0].pinnedSet]),[nextChosen],'Outside click must retain the remaining pin');
  await page.locator('#marketChart .readout-unpin').click();
  await page.locator('#marketChart .readout-toggle').click();
  await page.locator('#openComparison').click();const ranked=await state(()=>AtlasCharts.rankLatest(AtlasWorkspace.state.market.sectors,s=>s.series.path.at(-1)).map(s=>s.name));assert.deepEqual(await page.locator('[data-pick]').evaluateAll(els=>els.map(e=>e.dataset.pick)),ranked);assert.match(await page.locator('#compareOrder').textContent(),/最新/);assert.equal(await page.locator('[data-pick]:checked').count(),sectors);
  await page.locator('#clearComparison').click();assert.equal(await page.locator('[data-pick]:checked').count(),0);
  await page.locator('#selectAllComparison').click();assert.equal(await page.locator('[data-pick]:checked').count(),sectors);await backdrop('#atlasCompareDialog');
  // Long-press values stay in normal layout, with all selected values accessible outside the plot.
  await page.locator('.chart-host').scrollIntoViewIfNeeded();let box=await page.locator('.chart-canvas').boundingBox(),x=box.x+box.width*.65,y=box.y+125,sy=await state(()=>scrollY);
  await touch('touchStart',[{x,y}]);await page.waitForTimeout(420);await touch('touchMove',[{x,y:y-30}]);await touch('touchEnd',[]);
  assert.equal(await state(()=>scrollY),sy);assert.equal(await page.locator('.chart-readout').getAttribute('data-rows'),String(sectors+1));
  assert.equal(await page.locator('.floating-inspector').count(),0);assert.doesNotMatch(await page.locator('.chart-readout').textContent(),/纵轴/);
  assert.ok(await state(()=>!!AtlasWorkspace.state.charts[0].focus));await outsidePlot(page.locator('.chart-readout'),page.locator('.chart-canvas'));await shot('390-unobstructed-inspection');
  await page.locator('.readout-toggle').click();assert.equal(await page.locator('.readout-all .readout-row').count(),sectors+1);
  await outsidePlot(page.locator('.chart-readout'),page.locator('.chart-canvas'));
  const list=await page.locator('.readout-all').boundingBox();await touch('touchStart',[{x:list.x+list.width/2,y:list.y+list.height-15}]);await touch('touchMove',[{x:list.x+list.width/2,y:list.y+list.height-50}]);await touch('touchMove',[{x:list.x+list.width/2,y:list.y+10}]);await touch('touchEnd',[]);await page.waitForTimeout(100);
  assert.ok(await page.locator('.readout-all').evaluate(el=>el.scrollTop>0),'Complete readouts cannot be scrolled');await page.locator('.readout-toggle').click();
  await page.locator('.interaction-note').tap();assert.equal(await state(()=>AtlasWorkspace.state.charts[0].inspectionActive),false);assert.equal(await page.locator('.plot-overlay .crosshair,.plot-overlay .axis-tag').count(),0);
  await page.locator('#openComparison').click();await page.locator('#clearComparison').click();await page.locator('[data-pick]').nth(0).check();await page.locator('[data-pick]').nth(1).check();await backdrop('#atlasCompareDialog');
  assert.equal(await page.locator('.readout-primary .readout-row').count(),3);
   const smallChartStyles=await state(()=>{
     const chart=AtlasWorkspace.state.charts[0],normal=chart.series.find(s=>!s.reference),other=chart.series.find(s=>!s.reference&&s.id!==normal.id);
     const find=id=>chart.svg.querySelectorAll('[data-series]').length&&[...chart.svg.querySelectorAll('[data-series]')].find(el=>el.dataset.series===id);
     const idle=Number(find(normal.id).style.opacity);
     chart.focusSeries(normal.id);
     const focused=Number(find(normal.id).style.opacity),dimmed=Number(find(other.id).style.opacity);
     const benchmarks=chart.series.filter(s=>s.reference).map(s=>Number(find(s.id).style.opacity));
     chart.clearInspection();
     return{idle,focused,dimmed,benchmarks,restored:Number(find(other.id).style.opacity)};
   });
   assert.ok(smallChartStyles.idle<1&&smallChartStyles.focused===1&&smallChartStyles.dimmed<smallChartStyles.idle&&smallChartStyles.restored===smallChartStyles.idle&&smallChartStyles.benchmarks.every(v=>v===1),'Small sector plots must highlight only the focused line, not every selected line');
  const initial=await span(),initialY=await yspan();await page.locator('[data-chart-action=in]').click();assert.ok(await span()<initial);assert.ok(await yspan()<initialY,'Default zoom misses the numeric axis');assert.equal(await page.locator('.zoom-axis').count(),0);const dragNav=async(p,selector,part,delta)=>{await p.locator(selector).scrollIntoViewIfNeeded();const point=await p.locator(selector).evaluate((el,part)=>{const r=el.getBoundingClientRect(),w=el.firstElementChild.getBoundingClientRect();return{x:part==='start'?w.left+2:part==='end'?w.right-2:(w.left+w.right)/2,y:r.top+r.height/2};},part);await p.mouse.move(point.x,point.y);await p.mouse.down();await p.mouse.move(point.x+delta,point.y,{steps:5});await p.mouse.up();};assert.equal(await page.locator('#marketChart .atlas-time-nav').count(),1);assert.equal(await page.locator('#marketChart .zoom-modes [aria-pressed="true"]').count(),1);assert.equal(await page.locator('#marketChart .atlas-time-meta').count(),0,'Timeline should not repeat axis date labels');const navBefore=await state(()=>[...AtlasWorkspace.state.charts[0].view]);await dragNav(page,'#marketChart .atlas-time-track','middle',-25);const navAfter=await state(()=>[...AtlasWorkspace.state.charts[0].view]);assert.ok(navAfter[0]<navBefore[0]&&Math.abs((navAfter[1]-navAfter[0])-(navBefore[1]-navBefore[0]))<.1,'Time window drag must pan without zooming: '+JSON.stringify({navBefore,navAfter}));await dragNav(page,'#marketChart .atlas-time-track','end',-20);assert.ok(await span()<navAfter[1]-navAfter[0],'Time window handle must resize');await page.locator('#marketChart [data-zoom-axis="x"]').click();const yFixed=await state(()=>[...AtlasWorkspace.state.charts[0].yView]),xSpan=await span();await page.locator('[data-chart-action=in]').click();assert.ok(await span()<xSpan);assert.deepEqual(await state(()=>AtlasWorkspace.state.charts[0].yView),yFixed,'X-only zoom changed Y');await page.locator('#marketChart [data-zoom-axis="y"]').click();const yDateSpan=await span(),yValueSpan=await yspan();await page.locator('[data-chart-action=in]').click();assert.equal(await span(),yDateSpan,'Y-only zoom changed dates');assert.ok(await yspan()<yValueSpan,'Y-only zoom did not scale numbers');await page.locator('#marketChart [data-zoom-axis="both"]').click();await fit();
  await page.locator('#marketChart [data-chart-action="reset"]').click();
  await page.locator('#marketChart [data-zoom-axis="x"]').click();
  await page.locator('#marketChart [data-chart-action="in"]').click();
  assert.equal(await state(()=>AtlasWorkspace.state.charts[0].yView),null,'X zoom should initially leave Y automatic');
  await page.locator('#marketChart .chart-canvas').scrollIntoViewIfNeeded();
  const panPoint=await state(()=>{const c=AtlasWorkspace.state.charts[0],r=c.surface.getBoundingClientRect();return{x:r.left+c.g.left+c.g.width*.55,y:r.top+c.g.top+c.g.height*.48};});
  const dragBefore=await state(()=>[...AtlasWorkspace.state.charts[0].view]);
  await page.mouse.move(panPoint.x,panPoint.y);await page.mouse.down();
  await page.mouse.move(panPoint.x+38,panPoint.y+43,{steps:6});
  await page.waitForFunction(()=>!!document.querySelector('#marketChart .plot-data[transform]'),null,{timeout:4000});
  assert.deepEqual(await state(()=>AtlasWorkspace.state.charts[0].view),dragBefore,'Panning should defer date-domain updates until release');
  assert.equal(await state(()=>AtlasWorkspace.state.charts[0].yView),null,'Panning should defer Y-domain updates until release');
  await page.mouse.up();
  assert.ok(await state(()=>Array.isArray(AtlasWorkspace.state.charts[0].yView)),'Vertical pan after X zoom must work');
  assert.ok(await page.evaluate(v=>AtlasWorkspace.state.charts[0].view[0]<v[0],dragBefore),'Dragging must move visible dates');
  assert.equal(await page.locator('#marketChart .plot-data[transform]').count(),0,'Pending preview transform after release');
  await page.locator('#marketChart [data-chart-action="reset"]').click();
  await page.locator('#marketChart [data-zoom-axis="both"]').click();await fit();
  const viewport=await state(()=>AtlasWorkspace.state.charts[0].view),yViewport=await state(()=>AtlasWorkspace.state.charts[0].yView);await page.locator('[data-chart-action=expand]').click();
  await outsidePlot(page.locator('#atlasChartDialog .chart-readout'),page.locator('#atlasChartDialog .chart-canvas'));await backdrop('#atlasChartDialog');assert.deepEqual(await state(()=>AtlasWorkspace.state.charts[0].view),viewport);assert.deepEqual(await state(()=>AtlasWorkspace.state.charts[0].yView),yViewport);
  await page.locator('.chart-host').scrollIntoViewIfNeeded();box=await page.locator('.chart-canvas').boundingBox();const prior=await span(),cx=box.x+box.width*.55,cy=box.y+130;
  await touch('touchStart',[{x:cx-30,y:cy},{x:cx+30,y:cy}]);for(const dx of [45,60,75]){const beforeX=await span(),beforeY=await yspan();await touch('touchMove',[{x:cx-dx,y:cy},{x:cx+dx,y:cy}]);await page.waitForFunction(v=>{const c=AtlasWorkspace.state.charts[0];return c.view[1]-c.view[0]<v[0]&&c.hi-c.lo<v[1];},[beforeX,beforeY],{timeout:3000});}const panBefore=await state(()=>AtlasWorkspace.state.charts[0].yView);await touch('touchMove',[{x:cx-75,y:cy+20},{x:cx+75,y:cy+20}]);await page.waitForFunction(v=>AtlasWorkspace.state.charts[0].yView[0]>v,panBefore[0],{timeout:3000});await touch('touchEnd',[]);assert.ok(await span()<prior,'Continuous pinch failed');
  await page.locator('[data-chart-action=reset]').click();assert.equal(await span(),initial);assert.equal(await state(()=>AtlasWorkspace.state.charts[0].yView),null);assert.equal(await state(()=>AtlasWorkspace.state.ranges.has('market-lines')),false);assert.ok(await state(()=>document.documentElement.scrollWidth<=innerWidth),'Market chart reset overflow');
  await page.locator('#openComparison').click();await page.locator('#clearComparison').click();await backdrop('#atlasCompareDialog');
  await page.selectOption('#atlasPeriod','63');await page.waitForFunction(()=>AtlasWorkspace.state.market.dates.length===63);assert.equal(await state(()=>AtlasWorkspace.state.selected.size),0);
  await page.selectOption('#atlasPeriod','all');await page.waitForFunction(n=>AtlasWorkspace.state.market.dates.length===n,total);if(referenceRecent){assert.ok(dataRequests.some(url=>url.includes('market-1.')),'Full-history market request did not load precomputed indicators');assert.equal(dataRequests.filter(url=>/\/\d{4}-\d{2}\.[a-f0-9]{16}\.bin\.gz$/.test(url)).length,0,'Full-history market unexpectedly downloaded raw monthly stock files');const full=await state(()=>({pool:AtlasWorkspace.state.market.pool,sectors:AtlasWorkspace.state.market.sectors.map(x=>x.series)}));const take=values=>values.slice(-referenceRecent.pool.ret.length);for(const key of ['ret','drawdown','vol','momentum','breadth','up','dispersion','amount'])assert.deepEqual(referenceRecent.pool[key],take(full.pool[key]),'Preview differs from complete-history market calculation: '+key);for(let i=0;i<Math.min(3,full.sectors.length);i++)for(const key of ['ret','drawdown','vol','momentum'])assert.deepEqual(referenceRecent.sectors[i][key],take(full.sectors[i][key]),'Industry preview differs from complete-history: '+key);for(const w of [5,10,20,60]){const m=await page.evaluate(w=>AtlasData.request('/api/market',{start:AtlasWorkspace.state.meta.dates[0],end:AtlasWorkspace.state.meta.dates.at(-1),window:w,mode:'dynamic'}),w);assert.equal(m.dates.length,total);assert.ok(dataRequests.some(url=>url.includes('market-'+w+'.')),'Precomputed market window missing: '+w);}const name=await state(()=>AtlasWorkspace.state.meta.industries[0].name),code=await page.evaluate(name=>AtlasWorkspace.state.meta.stocks.find(s=>s.industry===name).code,name),dates=await state(()=>AtlasWorkspace.state.meta.dates);const stockBundle=await page.evaluate(({code,dates})=>AtlasData.request('/api/stock',{start:dates[dates.length-63],end:dates.at(-1),code}),{code,dates});assert.equal(stockBundle.code,code);const industryBundle=await page.evaluate(({name,dates})=>AtlasData.request('/api/industry-history',{start:dates[dates.length-63],end:dates.at(-1),name,window:5,mode:'dynamic'}),{name,dates});assert.ok(industryBundle.stocks.length>0);assert.ok(dataRequests.some(url=>url.includes('industry-')),'Industry-specific data bundle was not loaded');assert.equal(dataRequests.filter(url=>/\/\d{4}-\d{2}\.[a-f0-9]{16}\.bin\.gz$/.test(url)).length,0,'Standard stock or industry exploration downloaded global monthly raw stock files');}
  await page.locator('[data-display=heat]').click();assert.equal(await page.locator('.heatmap-host').getAttribute('data-columns'),String(total));const heatStart=await state(()=>{const c=AtlasWorkspace.state.charts[0];return{cell:c.cellWidth,left:c.surface.scrollLeft,max:c.surface.scrollWidth-c.surface.clientWidth};});assert.ok(heatStart.cell>=4,'Full-history heatmap starts too compressed');assert.ok(Math.abs(heatStart.left-heatStart.max)<=2,'Heatmap should open at the most recent dates');
  const width=await state(()=>AtlasWorkspace.state.charts[0].cellWidth);await page.locator('[data-map-action=in]').click();assert.ok(await state(()=>AtlasWorkspace.state.charts[0].cellWidth)>width);await page.locator('.heatmap-host [data-map-action=reset]').click();assert.ok(Math.abs((await state(()=>AtlasWorkspace.state.charts[0].cellWidth))-width)<.01,'Reset should restore readable default zoom');assert.equal(await page.locator('.heatmap-host .atlas-time-nav').count(),1);await page.locator('.heatmap-host [data-map-action=in]').click();const heatNavBefore=await state(()=>AtlasWorkspace.state.charts[0].surface.scrollLeft);await dragNav(page,'.heatmap-host .atlas-time-track','middle',-23);assert.ok(await state(()=>AtlasWorkspace.state.charts[0].surface.scrollLeft)<heatNavBefore,'Heatmap navigator did not pan');await page.locator('.heatmap-host [data-map-action=reset]').click();await fit();
  await page.locator('.heatmap-host').scrollIntoViewIfNeeded();for(let n=0;n<12&&(await state(()=>AtlasWorkspace.state.charts[0].cellWidth))<6;n++)await page.locator('.heatmap-host [data-map-action=in]').click();const heatCellWidth=await state(()=>AtlasWorkspace.state.charts[0].cellWidth);assert.ok(heatCellWidth>=6,'Heatmap cell is too narrow for precise touch');await page.locator('.heat-scroll').evaluate(el=>el.scrollLeft=0);box=await page.locator('.heat-scroll').boundingBox();await touch('touchStart',[{x:box.x+heatCellWidth/2,y:box.y+15}]);await touch('touchEnd',[]);
  assert.equal(await state(()=>AtlasWorkspace.state.cursor),0);await outsidePlot(page.locator('.chart-readout'),page.locator('.heat-layout'));await shot('390-full-history-heat');await page.locator('.interaction-note').tap();assert.equal(await page.locator('.heat-selection').isHidden(),true);assert.equal(await page.locator('.heat-cursor').isHidden(),true);assert.equal(await state(()=>!!AtlasWorkspace.state.charts[0].focus),false);await page.locator('.heatmap-host [data-map-action=reset]').click();assert.equal(await state(()=>AtlasWorkspace.state.cursor),total-1);assert.ok(await state(()=>{const c=AtlasWorkspace.state.charts[0];return c.index===c.dates.length-1&&Math.abs(c.surface.scrollLeft-(c.surface.scrollWidth-c.surface.clientWidth))<=2;}),'Heatmap reset date/scroll mismatch');assert.ok(await state(()=>document.documentElement.scrollWidth<=innerWidth),'Heatmap reset overflow');await state(()=>AtlasWorkspace.observeDate(AtlasWorkspace.state.market.dates[0]));await page.locator('[data-display=lines]').click();await page.waitForFunction(()=>AtlasWorkspace.state.charts[0] instanceof AtlasCharts.Chart);await page.locator('[data-display=heat]').click();await page.waitForFunction(()=>AtlasWorkspace.state.charts[0] instanceof AtlasMaps.Heatmap);assert.ok(await state(()=>{const c=AtlasWorkspace.state.charts[0],s=AtlasWorkspace.state;return s.cursor===s.market.dates.length-1&&c.index===c.dates.length-1&&Math.abs(c.surface.scrollLeft-(c.surface.scrollWidth-c.surface.clientWidth))<=2;}),'Reopening heatmap after inspecting old dates must show latest date');
  await page.locator('#openComparison').click();await page.locator('#selectAllComparison').click();await backdrop('#atlasCompareDialog');
  const beforeGlobal=await state(()=>AtlasWorkspace.state.cursor);await page.locator('[data-display=rotation]').click();await page.waitForFunction(()=>AtlasWorkspace.state.charts[0]?.independentDate);
  assert.equal(await state(()=>AtlasWorkspace.state.charts[0].lookback),5);assert.deepEqual(await page.locator('.rotation-window option').evaluateAll(els=>els.map(e=>e.value)),['1','5','10','20','60']);assert.equal(await state(()=>AtlasWorkspace.state.charts[0].index),total-1);
  await page.locator('.scatter-host').scrollIntoViewIfNeeded();
  let pts=await state(()=>{const c=AtlasWorkspace.state.charts[0],r=c.surface.getBoundingClientRect(),p=[...c.points].sort((a,b)=>a.x-b.x);return[p[0],p.at(-1)].map(p=>({x:r.x+c.X(p.x),y:r.y+c.Y(p.y),name:p.name}));});
  await touch('touchStart',[pts[0]]);const f=await state(()=>AtlasWorkspace.state.charts[0].focus);assert.ok(f);
  await touch('touchMove',[pts[1]]);await page.waitForFunction(name=>AtlasWorkspace.state.charts[0].focus!==name,f,{timeout:2000});await touch('touchEnd',[]);assert.notEqual(await state(()=>AtlasWorkspace.state.charts[0].focus),f,'Rotation finger movement has no feedback');await page.locator('.interaction-note').tap();assert.equal(await page.locator('.rotation-trail,.point-label').count(),0);assert.equal(await state(()=>!!AtlasWorkspace.state.charts[0].focus),false);
  await page.selectOption('.rotation-industry',{index:1});assert.ok(await state(()=>!!AtlasWorkspace.state.charts[0].pinned));assert.equal(await page.locator('.rotation-trail').count(),1);
  assert.equal(await state(()=>AtlasWorkspace.state.charts[0].trailStep),1);await shot('390-5-day-rotation');for(const n of ['1','10','20']){await page.selectOption('.rotation-window',n);await page.waitForFunction(n=>AtlasWorkspace.state.charts[0]?.lookback===Number(n),n);assert.equal(await state(()=>AtlasWorkspace.state.charts[0].lag),n==='1'?1:5);}await page.selectOption('.rotation-industry',{index:1});const samples=await state(()=>AtlasWorkspace.state.charts[0].trail);assert.ok(samples.length<=5);for(let i=1;i<samples.length;i++)assert.equal(samples[i].index-samples[i-1].index,5);
  const domain=await state(()=>AtlasWorkspace.state.charts[0].domain);await page.locator('.rotation-timeline input').focus();await page.keyboard.press('ArrowLeft');assert.equal(await state(()=>AtlasWorkspace.state.charts[0].index),total-2);assert.ok((await state(()=>AtlasWorkspace.state.charts[0].domain)).every(Number.isFinite));
  assert.equal(await state(()=>AtlasWorkspace.state.cursor),beforeGlobal);const index=await state(()=>AtlasWorkspace.state.charts[0].index);await state(()=>AtlasWorkspace.observeDate(AtlasWorkspace.state.market.dates[1]));assert.equal(await state(()=>AtlasWorkspace.state.charts[0].index),index);
  await page.locator('.rotation-timeline input').focus();await page.keyboard.press('End');await page.locator('[data-time=play]').click();const playStart=await state(()=>AtlasWorkspace.state.charts[0].index);await page.waitForFunction(i=>AtlasWorkspace.state.charts[0].index>i,playStart,{timeout:5000});assert.ok(await state(()=>AtlasWorkspace.state.charts[0].index)<total-1);await page.locator('#openComparison').click();assert.equal(await state(()=>AtlasWorkspace.state.charts[0].timer),null);await backdrop('#atlasCompareDialog');
  await page.selectOption('.rotation-window','60');await page.waitForFunction(()=>AtlasWorkspace.state.charts[0]?.lookback===60);await page.locator('.rotation-timeline input').focus();await page.keyboard.press('End');assert.ok(await state(()=>AtlasWorkspace.state.charts[0].points.length)>0);
  await page.selectOption('.rotation-industry',{index:1});await shot('390-explained-rotation');assert.equal(await page.locator('.scatter-host .atlas-time-nav').count(),0,'Rotation already has one date slider');await page.locator('.scatter-host [data-zoom-axis="x"]').click();const rot1=await state(()=>[...AtlasWorkspace.state.charts[0].domain]);await page.locator('.scatter-host [data-map-action=in]').click();const rot2=await state(()=>[...AtlasWorkspace.state.charts[0].domain]);assert.ok(rot2[1]-rot2[0]<rot1[1]-rot1[0]&&rot2[2]===rot1[2]&&rot2[3]===rot1[3],'Rotation horizontal zoom altered vertical axis');await page.locator('.scatter-host [data-zoom-axis="y"]').click();await page.locator('.scatter-host [data-map-action=in]').click();const rot3=await state(()=>[...AtlasWorkspace.state.charts[0].domain]);assert.ok(Math.abs((rot3[1]-rot3[0])-(rot2[1]-rot2[0]))<1e-7&&rot3[3]-rot3[2]<rot2[3]-rot2[2],'Rotation vertical zoom altered horizontal axis');await page.locator('.scatter-host [data-map-action=reset]').click();
  await page.locator('[data-map-action=expand]').click();await outsidePlot(page.locator('#atlasChartDialog .chart-readout'),page.locator('#atlasChartDialog .chart-canvas'));box=await page.locator('#atlasChartDialog .chart-canvas').boundingBox();assert.ok(box.y+box.height<=844);await backdrop('#atlasChartDialog');
  await page.locator('[data-display=state]').click();await page.waitForTimeout(500);assert.equal(await page.locator('.atlas-chart').count(),3);
  // Three breadth curves have equal status; MA20 must not be an unselectable reference.
  const stateInitial=await state(()=>AtlasWorkspace.state.charts.map(c=>({
    ids:c.series.map(s=>s.id),referenceIds:c.series.filter(s=>s.reference).map(s=>s.id),
    opacities:[...c.svg.querySelectorAll('path[data-series]')].map(p=>Number(p.style.opacity))
  })));
  assert.deepEqual(stateInitial[0].ids,['breadth','up','up_smooth']);
  assert.ok(stateInitial.every(c=>c.referenceIds.length===0&&c.opacities.every(o=>o===1)),'State metrics must be equally visible before focus');
  const breadthPoint=await state(()=>{
    const c=AtlasWorkspace.state.charts[0],s=c.series[0],r=c.surface.getBoundingClientRect();
    for(let i=Math.floor(c.view[1]);i>=Math.ceil(c.view[0]);i--){
      if(!Number.isFinite(s.values[i]))continue;
      const p={x:r.x+c.X(i),y:r.y+c.Y(s.values[i])};
      if(c.hitSeries(p,8)?.id==='breadth')return p;
    }
    return null;
  });
  assert.ok(breadthPoint,'MA20 curve cannot be selected by geometric hit testing');
  await page.locator('#marketChart .readout-primary [data-focus-series="breadth"]').click();
  assert.equal(await state(()=>AtlasWorkspace.state.charts[0].pinned),'breadth','Readout cannot pin MA20');
  const breadthStyles=await state(()=>{
    const c=AtlasWorkspace.state.charts[0],paths=[...c.svg.querySelectorAll('path[data-series]')];
    return Object.fromEntries(c.series.map(s=>[s.id,Number(paths.find(p=>p.dataset.series===s.id).style.opacity)]));
  });
  assert.equal(breadthStyles.breadth,1);
  assert.ok(breadthStyles.up<.3&&breadthStyles.up_smooth<.3,'Non-focused breadth lines did not dim');
  await page.locator('#marketChart .readout-primary [data-focus-series="amount"]').click();
  assert.equal(await state(()=>AtlasWorkspace.state.charts[2].pinned),'amount','Readout did not route across chart panels');
  assert.ok(await state(()=>AtlasWorkspace.state.charts.slice(0,2).every(c=>c.pinned===null&&!c.inspectionActive)),'Previous metric kept its highlight');
  await page.locator('#marketChart .readout-primary [data-focus-series="up"]').click();
  assert.equal(await state(()=>AtlasWorkspace.state.charts[0].pinned),'up');
  assert.equal(await state(()=>AtlasWorkspace.state.charts[2].pinned),null,'Switching focus did not clear the previous panel');
  await page.locator('#marketChart .readout-unpin').click();
  assert.equal(await page.locator('.chart-readout').count(),1);assert.equal(await page.locator('.chart-readout').getAttribute('data-rows'),'5');const stateX=await state(()=>AtlasWorkspace.state.charts.map(c=>c.view));const stateScroll=await state(()=>scrollY);const zb=await page.locator('[data-state-action=in]').boundingBox();await page.mouse.click(zb.x+zb.width/2,zb.y+zb.height/2);assert.equal(await state(()=>scrollY),stateScroll);assert.ok(await page.evaluate(ranges=>AtlasWorkspace.state.charts.every((c,i)=>c.view[1]-c.view[0]<ranges[i][1]-ranges[i][0]),stateX), 'State zoom must scale both axes');assert.ok(await state(()=>AtlasWorkspace.state.charts.every(c=>c.yView)));
  for(const c of await page.locator('.chart-canvas').all()){const b=await c.boundingBox();assert.ok(b.y>=48&&b.y+b.height<=844,'State charts require paging');}
  await page.locator('[data-state-action=in]').click();const ranges=await state(()=>AtlasWorkspace.state.charts.map(c=>c.view));assert.deepEqual(ranges[0],ranges[1]);assert.deepEqual(ranges[1],ranges[2]);await page.locator('[data-state-action=reset]').click();assert.equal(await page.locator('.state-bundle .atlas-time-nav').count(),1,'State charts must share one time navigator');await page.locator('.state-bundle [data-zoom-axis="x"]').click();const stateXBefore=await state(()=>AtlasWorkspace.state.charts.map(c=>[...c.view]));await page.locator('[data-state-action=in]').click();assert.ok(await page.evaluate(before=>AtlasWorkspace.state.charts.every((c,i)=>c.view[1]-c.view[0]<before[i][1]-before[i][0]&&c.yView===null),stateXBefore),'State X-only zoom changed Y');await page.locator('.state-bundle [data-zoom-axis="y"]').click();const stateYBefore=await state(()=>AtlasWorkspace.state.charts.map(c=>[...c.view]));await page.locator('[data-state-action=in]').click();assert.deepEqual(await state(()=>AtlasWorkspace.state.charts.map(c=>c.view)),stateYBefore,'State Y-only zoom changed X');assert.ok(await state(()=>AtlasWorkspace.state.charts.every(c=>c.yView)),'State Y-only zoom missing');await page.locator('[data-state-action=reset]').click();assert.ok(await state(()=>AtlasWorkspace.state.charts.every(c=>c.yView===null&&c.view[0]===c.resetView[0]&&c.view[1]===c.resetView[1])),'Linked state charts did not reset consistently');assert.equal(await state(()=>AtlasWorkspace.state.ranges.has('market-state')),false);assert.ok(await state(()=>document.documentElement.scrollWidth<=innerWidth),'State chart reset overflow');
  await page.locator('[data-state-action=expand]').click();const canvases=await page.locator('#atlasChartDialog .chart-canvas').all();for(const c of canvases){const b=await c.boundingBox();assert.ok(b.y>=0&&b.y+b.height<=844);}
  box=await canvases[1].boundingBox();await touch('touchStart',[{x:box.x+box.width*.5,y:box.y+50}]);await page.waitForTimeout(420);await touch('touchMove',[{x:box.x+box.width*.65,y:box.y+35}]);await touch('touchEnd',[]);
  assert.equal(await page.locator('.readout-primary .readout-row').count(),5);const dates=await page.locator('.atlas-chart').evaluateAll(els=>els.map(el=>el.dataset.date));assert.equal(new Set(dates).size,1);await shot('390-state-unobstructed-fullscreen');await backdrop('#atlasChartDialog');
  await page.locator('#openAtlasFilters').click();await backdrop('#atlasFilterDialog');await page.locator('#openAtlasData').click();await backdrop('#atlasDataDialog');
  await page.locator('button[data-theme]').click();await page.locator('[data-display=lines]').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await fit();await shot('390-light');
  await page.setViewportSize({width:320,height:740});await fit();await shot('320-light');
  const desktop=await browser.newPage({viewport:{width:1440,height:1000}});track(desktop);await desktop.goto(base+'/market-atlas.html');await desktop.waitForFunction(()=>window.AtlasWorkspace?.state.charts.length,{timeout:90000});await ensureResearchData(desktop);
  await desktop.locator('.chart-host').scrollIntoViewIfNeeded();assert.equal(await desktop.locator('.chart-host .atlas-time-nav').count(),1);const db=await desktop.locator('.chart-canvas').boundingBox(),beforeYZoom=await desktop.evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return{view:c.view,span:c.hi-c.lo};});await desktop.mouse.move(db.x+20,db.y+120);await desktop.mouse.wheel(0,-200);await desktop.waitForFunction(span=>{const c=AtlasWorkspace.state.charts[0];return c.hi-c.lo<span;},beforeYZoom.span);assert.deepEqual(await desktop.evaluate(()=>AtlasWorkspace.state.charts[0].view),beforeYZoom.view,'Hovering the Y axis must not zoom the timeline');const point=await desktop.evaluate(()=>{const c=AtlasWorkspace.state.charts[0],r=c.surface.getBoundingClientRect();return{x:r.left+c.g.left+c.g.width/2,y:r.top+c.g.top+c.g.height/2};});await desktop.mouse.move(point.x,point.y);await desktop.mouse.wheel(0,-200);await desktop.waitForFunction(v=>{const c=AtlasWorkspace.state.charts[0];return c.view[1]-c.view[0]<v[1]-v[0];},beforeYZoom.view);const timeBefore=await desktop.evaluate(()=>({view:[...AtlasWorkspace.state.charts[0].view],y:[...AtlasWorkspace.state.charts[0].yView]}));await desktop.mouse.move(point.x,db.y+db.height-12);await desktop.mouse.wheel(0,-130);await desktop.waitForFunction(v=>{const c=AtlasWorkspace.state.charts[0];return c.view[1]-c.view[0]<v[1]-v[0];},timeBefore.view);assert.deepEqual(await desktop.evaluate(()=>AtlasWorkspace.state.charts[0].yView),timeBefore.y,'Hovering the time axis must not zoom Y');
  assert.ok(await desktop.locator('.crosshair').count()>0);const detailBox=await desktop.locator('.readout-drill').boundingBox();await desktop.mouse.move(detailBox.x+detailBox.width/2,detailBox.y+detailBox.height/2);assert.equal(await desktop.locator('.plot-overlay .crosshair,.plot-overlay .axis-tag,.focus-trace').count(),0);assert.equal(await desktop.locator('.readout-drill').isVisible(),true,'Clearing the plot made the detail action unreachable');await desktop.locator('.interaction-note').click();assert.equal(await desktop.evaluate(()=>!!AtlasWorkspace.state.charts[0].focus),false);
  const option=await desktop.locator('#atlasMetric option').first().evaluate(el=>({bg:getComputedStyle(el).backgroundColor,ink:getComputedStyle(el).color,scheme:getComputedStyle(el.parentElement).colorScheme}));assert.deepEqual(option,{bg:'rgb(16, 23, 34)',ink:'rgb(237, 241, 247)',scheme:'dark'});
  await desktop.locator('#atlasMetric').click();await desktop.screenshot({path:path.join(out,'1440-dark-native-dropdown.png')});await desktop.keyboard.press('Escape');
  for(const width of [1920,2560]){await desktop.setViewportSize({width,height:1000});await desktop.waitForFunction(width=>{const c=AtlasWorkspace.state.charts[0];return innerWidth===width&&c.w>1200&&c.w<=1440&&Math.abs(c.w-c.surface.getBoundingClientRect().width)<.6;},width);const layout=await desktop.evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return{canvas:c.w,labels:[...c.svg.querySelectorAll('.axis-label')].map(el=>{const b=el.getBBox();return[b.x,b.x+b.width];}),unit:c.host.querySelector('.chart-label .chart-unit').textContent};});assert.ok(layout.canvas>1200&&layout.canvas<=1440,'Chart width should follow the 1440px layout');assert.ok(layout.labels.every(([left,right])=>left>=-.5&&right<=layout.canvas+.5),'Wide chart clipped axis labels');assert.equal(layout.unit,'（%）');assert.ok(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await desktop.locator('.workspace-plot').screenshot({path:path.join(out,width+'-expanded-chart.png')});}await desktop.setViewportSize({width:1440,height:1000});
  await desktop.locator('[data-display=heat]').click();const wheelStart=await desktop.evaluate(()=>AtlasWorkspace.state.charts[0].cellWidth);await desktop.locator('.heat-head').hover();await desktop.mouse.wheel(0,-180);await desktop.waitForFunction(w=>AtlasWorkspace.state.charts[0].cellWidth>w,wheelStart);await desktop.locator('[data-display=lines]').click();
  await desktop.locator('[data-display=rotation]').click();await desktop.waitForFunction(()=>AtlasWorkspace.state.charts[0]?.independentDate);await desktop.locator('.scatter-host').scrollIntoViewIfNeeded();
  pts=await desktop.evaluate(()=>{const c=AtlasWorkspace.state.charts[0],r=c.surface.getBoundingClientRect(),p=[...c.points].sort((a,b)=>a.x-b.x);return[p[0],p.at(-1)].map(p=>({x:r.x+c.X(p.x),y:r.y+c.Y(p.y)}));});await desktop.mouse.move(pts[0].x,pts[0].y);const d=await desktop.evaluate(()=>AtlasWorkspace.state.charts[0].focus);await desktop.mouse.move(pts[1].x,pts[1].y);assert.notEqual(await desktop.evaluate(()=>AtlasWorkspace.state.charts[0].focus),d);await desktop.screenshot({path:path.join(out,'1440-rotation-hover.png'),fullPage:true});const rotationDrill=await desktop.locator('.readout-drill').boundingBox();await desktop.mouse.move(rotationDrill.x+rotationDrill.width/2,rotationDrill.y+rotationDrill.height/2);assert.equal(await desktop.locator('.rotation-trail,.point-label').count(),0);assert.equal(await desktop.locator('.readout-drill').isVisible(),true);await desktop.locator('.interaction-note').click();assert.equal(await desktop.evaluate(()=>!!AtlasWorkspace.state.charts[0].focus),false);
  await desktop.locator('button[data-theme]').click();assert.equal(await desktop.locator('#atlasPeriod').evaluate(el=>getComputedStyle(el).colorScheme),'light');await desktop.close();
  // Independent, intentionally steep multi-line chart. Its midpoint is far from both daily endpoints.
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
    const host=document.createElement('section');host.id='atlas-hit-fixture';host.style.cssText='margin:10px auto;width:100%;max-width:390px';
    document.querySelector('.atlas-app').append(host);
    const dates=Array.from({length:20},(_,i)=>'2026-01-'+String(i+1).padStart(2,'0'));
    const series=[{id:'steep',name:'两日之间的陡峭曲线',values:dates.map((_,i)=>i%2?100:0),color:'#c23535'},...Array.from({length:7},(_,i)=>({id:'other-'+i,name:'其他行业 '+i,values:dates.map(()=>105+i),color:'#238767'}))];
    window.atlasHitFixture=new AtlasCharts.Chart(host,{dates,series,label:'线段命中与双击测试',unit:'%'});
  });
  await page.locator('#atlas-hit-fixture .chart-canvas').scrollIntoViewIfNeeded();
  const hitPoint=await page.evaluate(()=>{
    const c=window.atlasHitFixture,r=c.surface.getBoundingClientRect();
    const x=c.X(10.5),y=(c.Y(c.series[0].values[10])+c.Y(c.series[0].values[11]))/2;
    return{x:r.left+x,y:r.top+y,dayDistance:Math.min(Math.abs(y-c.Y(c.series[0].values[10])),Math.abs(y-c.Y(c.series[0].values[11])))};
  });
  assert.ok(hitPoint.dayDistance>30,'Fixture does not exercise the gap between daily points');
  await page.mouse.move(hitPoint.x,hitPoint.y);
  await page.waitForFunction(()=>window.atlasHitFixture.focus==='steep',null,{timeout:3000});
  await page.mouse.click(hitPoint.x,hitPoint.y);
  assert.equal(await page.evaluate(()=>window.atlasHitFixture.pinned),'steep','Clicking the visible segment midpoint did not select its line');
  const secondPoint=await page.evaluate(()=>{const c=window.atlasHitFixture,r=c.surface.getBoundingClientRect();return{x:r.left+c.X(10.5),y:r.top+c.Y(105)};});
  await page.mouse.click(secondPoint.x,secondPoint.y);
  assert.deepEqual(await page.evaluate(()=>[...window.atlasHitFixture.pinnedSet].sort()),['other-0','steep'],'Clicking another painted line must preserve both');
  await page.mouse.move(2,2);
  assert.deepEqual(await page.evaluate(()=>[...window.atlasHitFixture.pinnedSet].sort()),['other-0','steep'],'Pins must survive leaving the plot');
  await page.evaluate(()=>window.atlasHitFixture.clearInspection());
  await touch('touchStart',[hitPoint]);await touch('touchEnd',[]);
  assert.equal(await page.evaluate(()=>window.atlasHitFixture.pinned),'steep','Tapping the segment midpoint did not select its line');
  await page.evaluate(()=>window.atlasHitFixture.clearInspection());
  const blankPoint=await page.evaluate(()=>{const c=window.atlasHitFixture,r=c.surface.getBoundingClientRect();return{x:r.left+c.X(10.5),y:r.top+c.g.bottom-4};});
  await page.mouse.click(blankPoint.x,blankPoint.y);
  assert.equal(await page.locator('#atlas-hit-fixture .readout-all').isHidden(),true,'Blank click expanded the readout');
  assert.equal(await page.locator('#atlas-hit-fixture .readout-toggle').getAttribute('aria-expanded'),'false','Blank click toggled the readout');
  await page.evaluate(()=>window.atlasHitFixture.zoom(1.7,null,'both'));
  assert.ok(await page.evaluate(()=>!!window.atlasHitFixture.yView&&window.atlasHitFixture.canPanX()));
  await page.mouse.dblclick(blankPoint.x,blankPoint.y);
  assert.ok(await page.evaluate(()=>{
    const c=window.atlasHitFixture;return c.yView===null&&c.view[0]===c.resetView[0]&&c.view[1]===c.resetView[1]&&!c.panMove;
  }),'Mouse double-click did not fully reset both zoom axes');
  assert.equal(await page.locator('#atlas-hit-fixture .readout-toggle').getAttribute('aria-expanded'),'false','Double-click unexpectedly expanded the readout');
  await page.evaluate(()=>window.atlasHitFixture.zoom(1.7,null,'both'));
  await touch('touchStart',[blankPoint]);await touch('touchEnd',[]);
  await touch('touchStart',[blankPoint]);await touch('touchEnd',[]);
  assert.ok(await page.evaluate(()=>{
    const c=window.atlasHitFixture;return c.yView===null&&c.view[0]===c.resetView[0]&&c.view[1]===c.resetView[1];
  }),'Touch double-tap did not reset zoom');
  await page.evaluate(()=>{window.atlasHitFixture.destroy();document.getElementById('atlas-hit-fixture').remove();delete window.atlasHitFixture;});

  assert.equal(await page.evaluate(()=>window.atlasHistoryWrites),1,'Ordinary interactions re-entered the browser history pipeline');assert.equal(documents,1,'Chart interactions reloaded the document');assert.deepEqual(await page.evaluate(()=>window.atlasAddressWrites),[],'Chart interactions rewrote the browser address');
  for(const mode of ['light','dark']){await page.goto(base+'/index.html');if(await page.evaluate(()=>document.documentElement.dataset.theme)!==mode)await page.locator('button[data-theme]').click();assert.equal(await page.locator('.resource-card').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');}
  assert.deepEqual(errors,[]);console.log('PASS: default/select all, outside dismissal, state-only history without address writes, nonoverlapping docked readouts, complete values, zoom/fullscreen, latest ranking, independent 1/5/10/20/60-day rotation timeline/playback, immediate touch/mouse feedback, weekly trails, linked state, native dropdown themes and responsive layouts.');
 }finally{console.log(JSON.stringify({errors}));await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
