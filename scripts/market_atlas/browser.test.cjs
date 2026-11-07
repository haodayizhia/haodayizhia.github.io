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
 async function fit(){assert.ok(await state(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal page overflow');}
 async function backdrop(id){await page.mouse.click(2,2);assert.equal(await page.locator(id).evaluate(el=>el.open),false);}
 async function outsidePlot(readout,canvas){const a=await readout.boundingBox(),b=await canvas.boundingBox();assert.ok(a.y+a.height<=b.y+1,'Readout obstructs plot');}
 async function shot(name){const y=await state(()=>scrollY),modal=await page.locator('dialog[open]').count();if(!modal)await state(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(out,name+'.png'),fullPage:!modal});if(!modal)await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);}
 try{
  await page.goto(base+'/market-atlas.html');await ready();await fit();await ensureResearchData(page);
  const total=await state(()=>AtlasWorkspace.state.meta.dates.length),sectors=await state(()=>AtlasWorkspace.state.market.sectors.length);
  assert.equal(await page.locator('#atlasPeriod').inputValue(),'63');assert.equal(await state(()=>AtlasWorkspace.state.market.dates.length),Math.min(63,total));assert.equal(await state(()=>AtlasWorkspace.state.selected.size),sectors);assert.equal(await state(()=>AtlasWorkspace.state.charts[0].series.length),sectors+1);
  assert.equal(await page.locator('#atlasDate,.date-control,.floating-inspector,.inspect-lock').count(),0);
  await outsidePlot(page.locator('.chart-readout'),page.locator('.chart-canvas'));await shot('390-all-industries-dark');
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
  await page.locator('#openComparison').click();await page.locator('#clearComparison').click();await page.locator('[data-pick]').nth(0).check();await page.locator('[data-pick]').nth(1).check();await backdrop('#atlasCompareDialog');
  assert.equal(await page.locator('.readout-primary .readout-row').count(),3);
  const initial=await span(),initialY=await yspan();await page.locator('[data-chart-action=in]').click();assert.ok(await span()<initial);assert.ok(await yspan()<initialY,'Default zoom misses the numeric axis');await page.selectOption('.zoom-axis','y');const xOnly=await state(()=>AtlasWorkspace.state.charts[0].view),yBefore=await yspan();await page.locator('[data-chart-action=in]').click();assert.deepEqual(await state(()=>AtlasWorkspace.state.charts[0].view),xOnly);assert.ok(await yspan()<yBefore);await page.selectOption('.zoom-axis','x');const yOnly=await state(()=>AtlasWorkspace.state.charts[0].yView);await page.locator('[data-chart-action=in]').click();assert.deepEqual(await state(()=>AtlasWorkspace.state.charts[0].yView),yOnly);await page.selectOption('.zoom-axis','both');
  const viewport=await state(()=>AtlasWorkspace.state.charts[0].view),yViewport=await state(()=>AtlasWorkspace.state.charts[0].yView);await page.locator('[data-chart-action=expand]').click();
  await outsidePlot(page.locator('#atlasChartDialog .chart-readout'),page.locator('#atlasChartDialog .chart-canvas'));await backdrop('#atlasChartDialog');assert.deepEqual(await state(()=>AtlasWorkspace.state.charts[0].view),viewport);assert.deepEqual(await state(()=>AtlasWorkspace.state.charts[0].yView),yViewport);
  await page.locator('.chart-host').scrollIntoViewIfNeeded();box=await page.locator('.chart-canvas').boundingBox();const prior=await span(),cx=box.x+box.width*.55,cy=box.y+130;
  await touch('touchStart',[{x:cx-30,y:cy},{x:cx+30,y:cy}]);for(const dx of [45,60,75]){const beforeX=await span(),beforeY=await yspan();await touch('touchMove',[{x:cx-dx,y:cy},{x:cx+dx,y:cy}]);await page.waitForFunction(v=>{const c=AtlasWorkspace.state.charts[0];return c.view[1]-c.view[0]<v[0]&&c.hi-c.lo<v[1];},[beforeX,beforeY],{timeout:3000});}const panBefore=await state(()=>AtlasWorkspace.state.charts[0].yView);await touch('touchMove',[{x:cx-75,y:cy+20},{x:cx+75,y:cy+20}]);await page.waitForFunction(v=>AtlasWorkspace.state.charts[0].yView[0]>v,panBefore[0],{timeout:3000});await touch('touchEnd',[]);assert.ok(await span()<prior,'Continuous pinch failed');
  await page.locator('[data-chart-action=reset]').click();assert.equal(await span(),initial);assert.equal(await state(()=>AtlasWorkspace.state.charts[0].yView),null);
  await page.locator('#openComparison').click();await page.locator('#clearComparison').click();await backdrop('#atlasCompareDialog');
  await page.selectOption('#atlasPeriod','63');await page.waitForFunction(()=>AtlasWorkspace.state.market.dates.length===63);assert.equal(await state(()=>AtlasWorkspace.state.selected.size),0);
  await page.selectOption('#atlasPeriod','all');await page.waitForFunction(n=>AtlasWorkspace.state.market.dates.length===n,total);
  await page.locator('[data-display=heat]').click();assert.equal(await page.locator('.heatmap-host').getAttribute('data-columns'),String(total));
  const width=await state(()=>AtlasWorkspace.state.charts[0].cellWidth);await page.locator('[data-map-action=in]').click();assert.ok(await state(()=>AtlasWorkspace.state.charts[0].cellWidth)>width);
  await page.locator('.heatmap-host').scrollIntoViewIfNeeded();await page.locator('.heat-scroll').evaluate(el=>el.scrollLeft=0);box=await page.locator('.heat-scroll').boundingBox();await touch('touchStart',[{x:box.x+1,y:box.y+15}]);await touch('touchEnd',[]);
  assert.equal(await state(()=>AtlasWorkspace.state.cursor),0);await outsidePlot(page.locator('.chart-readout'),page.locator('.heat-layout'));await shot('390-full-history-heat');
  await page.locator('#openComparison').click();await page.locator('#selectAllComparison').click();await backdrop('#atlasCompareDialog');
  const beforeGlobal=await state(()=>AtlasWorkspace.state.cursor);await page.locator('[data-display=rotation]').click();await page.waitForFunction(()=>AtlasWorkspace.state.charts[0]?.independentDate);
  assert.equal(await state(()=>AtlasWorkspace.state.charts[0].lookback),5);assert.deepEqual(await page.locator('.rotation-window option').evaluateAll(els=>els.map(e=>e.value)),['1','5','10','20','60']);assert.equal(await state(()=>AtlasWorkspace.state.charts[0].index),total-1);
  await page.locator('.scatter-host').scrollIntoViewIfNeeded();
  let pts=await state(()=>{const c=AtlasWorkspace.state.charts[0],r=c.surface.getBoundingClientRect(),p=[...c.points].sort((a,b)=>a.x-b.x);return[p[0],p.at(-1)].map(p=>({x:r.x+c.X(p.x),y:r.y+c.Y(p.y),name:p.name}));});
  await touch('touchStart',[pts[0]]);const f=await state(()=>AtlasWorkspace.state.charts[0].focus);assert.ok(f);
  await touch('touchMove',[pts[1]]);await page.waitForFunction(name=>AtlasWorkspace.state.charts[0].focus!==name,f,{timeout:2000});await touch('touchEnd',[]);assert.notEqual(await state(()=>AtlasWorkspace.state.charts[0].focus),f,'Rotation finger movement has no feedback');
  await page.selectOption('.rotation-industry',{index:1});assert.ok(await state(()=>!!AtlasWorkspace.state.charts[0].pinned));assert.equal(await page.locator('.rotation-trail').count(),1);
  assert.equal(await state(()=>AtlasWorkspace.state.charts[0].trailStep),1);await shot('390-5-day-rotation');for(const n of ['1','10','20']){await page.selectOption('.rotation-window',n);await page.waitForFunction(n=>AtlasWorkspace.state.charts[0]?.lookback===Number(n),n);assert.equal(await state(()=>AtlasWorkspace.state.charts[0].lag),n==='1'?1:5);}await page.selectOption('.rotation-industry',{index:1});const samples=await state(()=>AtlasWorkspace.state.charts[0].trail);assert.ok(samples.length<=5);for(let i=1;i<samples.length;i++)assert.equal(samples[i].index-samples[i-1].index,5);
  const domain=await state(()=>AtlasWorkspace.state.charts[0].domain);await page.locator('.rotation-timeline input').focus();await page.keyboard.press('ArrowLeft');assert.equal(await state(()=>AtlasWorkspace.state.charts[0].index),total-2);assert.ok((await state(()=>AtlasWorkspace.state.charts[0].domain)).every(Number.isFinite));
  assert.equal(await state(()=>AtlasWorkspace.state.cursor),beforeGlobal);const index=await state(()=>AtlasWorkspace.state.charts[0].index);await state(()=>AtlasWorkspace.observeDate(AtlasWorkspace.state.market.dates[1]));assert.equal(await state(()=>AtlasWorkspace.state.charts[0].index),index);
  await page.locator('.rotation-timeline input').focus();await page.keyboard.press('End');await page.locator('[data-time=play]').click();const playStart=await state(()=>AtlasWorkspace.state.charts[0].index);await page.waitForFunction(i=>AtlasWorkspace.state.charts[0].index>i,playStart,{timeout:5000});assert.ok(await state(()=>AtlasWorkspace.state.charts[0].index)<total-1);await page.locator('#openComparison').click();assert.equal(await state(()=>AtlasWorkspace.state.charts[0].timer),null);await backdrop('#atlasCompareDialog');
  await page.selectOption('.rotation-window','60');await page.waitForFunction(()=>AtlasWorkspace.state.charts[0]?.lookback===60);await page.locator('.rotation-timeline input').focus();await page.keyboard.press('End');assert.ok(await state(()=>AtlasWorkspace.state.charts[0].points.length)>0);
  await page.selectOption('.rotation-industry',{index:1});await shot('390-explained-rotation');
  await page.locator('[data-map-action=expand]').click();await outsidePlot(page.locator('#atlasChartDialog .chart-readout'),page.locator('#atlasChartDialog .chart-canvas'));box=await page.locator('#atlasChartDialog .chart-canvas').boundingBox();assert.ok(box.y+box.height<=844);await backdrop('#atlasChartDialog');
  await page.locator('[data-display=state]').click();await page.waitForTimeout(500);assert.equal(await page.locator('.atlas-chart').count(),3);
  assert.equal(await page.locator('.chart-readout').count(),1);assert.equal(await page.locator('.chart-readout').getAttribute('data-rows'),'5');await page.selectOption('.zoom-axis','y');const stateX=await state(()=>AtlasWorkspace.state.charts.map(c=>c.view));const stateScroll=await state(()=>scrollY);const zb=await page.locator('[data-state-action=in]').boundingBox();await page.mouse.click(zb.x+zb.width/2,zb.y+zb.height/2);assert.equal(await state(()=>scrollY),stateScroll);assert.deepEqual(await state(()=>AtlasWorkspace.state.charts.map(c=>c.view)),stateX);assert.ok(await state(()=>AtlasWorkspace.state.charts.every(c=>c.yView)));await page.selectOption('.zoom-axis','both');
  for(const c of await page.locator('.chart-canvas').all()){const b=await c.boundingBox();assert.ok(b.y>=48&&b.y+b.height<=844,'State charts require paging');}
  await page.locator('[data-state-action=in]').click();const ranges=await state(()=>AtlasWorkspace.state.charts.map(c=>c.view));assert.deepEqual(ranges[0],ranges[1]);assert.deepEqual(ranges[1],ranges[2]);
  await page.locator('[data-state-action=expand]').click();const canvases=await page.locator('#atlasChartDialog .chart-canvas').all();for(const c of canvases){const b=await c.boundingBox();assert.ok(b.y>=0&&b.y+b.height<=844);}
  box=await canvases[1].boundingBox();await touch('touchStart',[{x:box.x+box.width*.5,y:box.y+50}]);await page.waitForTimeout(420);await touch('touchMove',[{x:box.x+box.width*.65,y:box.y+35}]);await touch('touchEnd',[]);
  assert.equal(await page.locator('.readout-primary .readout-row').count(),5);const dates=await page.locator('.atlas-chart').evaluateAll(els=>els.map(el=>el.dataset.date));assert.equal(new Set(dates).size,1);await shot('390-state-unobstructed-fullscreen');await backdrop('#atlasChartDialog');
  await page.locator('#openAtlasFilters').click();await backdrop('#atlasFilterDialog');await page.locator('#openAtlasData').click();await backdrop('#atlasDataDialog');
  await page.locator('button[data-theme]').click();await page.locator('[data-display=lines]').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await fit();await shot('390-light');
  await page.setViewportSize({width:320,height:740});await fit();await shot('320-light');
  const desktop=await browser.newPage({viewport:{width:1440,height:1000}});track(desktop);await desktop.goto(base+'/market-atlas.html');await desktop.waitForFunction(()=>window.AtlasWorkspace?.state.charts.length,{timeout:90000});await ensureResearchData(desktop);
  await desktop.locator('.chart-host').scrollIntoViewIfNeeded();const db=await desktop.locator('.chart-canvas').boundingBox(),beforeYZoom=await desktop.evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return{view:c.view,span:c.hi-c.lo};});await desktop.mouse.move(db.x+20,db.y+120);await desktop.mouse.wheel(0,-200);await desktop.waitForFunction(span=>{const c=AtlasWorkspace.state.charts[0];return c.hi-c.lo<span;},beforeYZoom.span);assert.deepEqual(await desktop.evaluate(()=>AtlasWorkspace.state.charts[0].view),beforeYZoom.view);
  const option=await desktop.locator('#atlasMetric option').first().evaluate(el=>({bg:getComputedStyle(el).backgroundColor,ink:getComputedStyle(el).color,scheme:getComputedStyle(el.parentElement).colorScheme}));assert.deepEqual(option,{bg:'rgb(16, 23, 34)',ink:'rgb(237, 241, 247)',scheme:'dark'});
  await desktop.locator('#atlasMetric').click();await desktop.screenshot({path:path.join(out,'1440-dark-native-dropdown.png')});await desktop.keyboard.press('Escape');
  await desktop.locator('[data-display=rotation]').click();await desktop.waitForFunction(()=>AtlasWorkspace.state.charts[0]?.independentDate);await desktop.locator('.scatter-host').scrollIntoViewIfNeeded();
  pts=await desktop.evaluate(()=>{const c=AtlasWorkspace.state.charts[0],r=c.surface.getBoundingClientRect(),p=[...c.points].sort((a,b)=>a.x-b.x);return[p[0],p.at(-1)].map(p=>({x:r.x+c.X(p.x),y:r.y+c.Y(p.y)}));});await desktop.mouse.move(pts[0].x,pts[0].y);const d=await desktop.evaluate(()=>AtlasWorkspace.state.charts[0].focus);await desktop.mouse.move(pts[1].x,pts[1].y);assert.notEqual(await desktop.evaluate(()=>AtlasWorkspace.state.charts[0].focus),d);await desktop.screenshot({path:path.join(out,'1440-rotation-hover.png'),fullPage:true});
  await desktop.locator('button[data-theme]').click();assert.equal(await desktop.locator('#atlasPeriod').evaluate(el=>getComputedStyle(el).colorScheme),'light');await desktop.close();
  for(const mode of ['light','dark']){await page.goto(base+'/index.html');if(await page.evaluate(()=>document.documentElement.dataset.theme)!==mode)await page.locator('button[data-theme]').click();assert.equal(await page.locator('.resource-card').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');}
  assert.deepEqual(errors,[]);console.log('PASS: default/select all, nonoverlapping docked readouts, complete values, zoom/fullscreen, latest ranking, independent 1/5/10/20/60-day rotation timeline/playback, immediate touch/mouse feedback, weekly trails, linked state, native dropdown themes and responsive layouts.');
 }finally{console.log(JSON.stringify({errors}));await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
