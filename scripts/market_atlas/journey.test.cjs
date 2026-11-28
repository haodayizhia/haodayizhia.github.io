const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.env.ATLAS_QA_OUTPUT||'work/atlas-journey-qa');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname==='/'?'/index.html':new URL(req.url,'http://local').pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
function fixture(){const dates=[];for(let d=new Date('2026-01-05T00:00:00Z');dates.length<92;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()%6)dates.push(d.toISOString().slice(0,10).replaceAll('-',''));let csv='代码,名称,交易日期,所属行业,现价,涨幅%,成交额(亿元),换手率,MA20,开盘价,最高价,最低价,成交量(万股)\n';for(let s=0;s<120;s++){let price=10+s/10;for(let i=0;i<dates.length;i++){const open=price,ret=Math.sin(i*.21+s*.09)*1.2+(s%30-15)*.018;price*=1+ret/100;csv+=`${String(s+1).padStart(6,'0')}.SZ,样例${s+1},${dates[i]},样例行业${Math.floor(s/30)+1},${price},${ret},1,1,${price*.98},${open},${Math.max(price,open)*1.01},${Math.min(price,open)*.99},10\n`;}}return Buffer.from(csv);}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=process.env.QA_URL||`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,...(process.env.ATLAS_QA_CHROME?{executablePath:process.env.ATLAS_QA_CHROME}:{})}),errors=[];
try{for(const width of [390,1440,320]){
 const context=await browser.newContext({viewport:{width,height:width<600?844:1000},isMobile:width<600,hasTouch:width<600,deviceScaleFactor:1}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const cdp=await context.newCDPSession(page),touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((p,i)=>({...p,id:i+1}))}),evaluate=fn=>page.evaluate(fn);
 const ready=()=>page.waitForFunction(()=>window.AtlasWorkspace?.state.market&&AtlasWorkspace.state.charts.length,{timeout:90000});
 const industryReady=()=>page.waitForFunction(()=>AtlasWorkspace.state.view==='industry'&&AtlasWorkspace.state.history?.name===AtlasWorkspace.state.industry&&AtlasWorkspace.state.charts.length);
 const stockReady=()=>page.waitForFunction(()=>AtlasWorkspace.state.view==='stock'&&AtlasWorkspace.state.stock?.code===AtlasWorkspace.state.code&&AtlasWorkspace.state.charts.length);
 async function enterIndustryLines(){
   await page.waitForSelector('#industryBand svg');assert.equal(await page.locator('[data-industry-display=structure]').getAttribute('aria-pressed'),'true');
   await page.locator('[data-industry-display=lines]').click();await industryReady();
 }
 async function assertAllIndustryStocks(){
   const actual=await evaluate(()=>({selected:[...AtlasWorkspace.state.stocks].sort(),available:AtlasWorkspace.state.history.stocks.map(s=>s.code).sort(),all:AtlasWorkspace.state.stockSelections.get(AtlasWorkspace.state.industry)?.all}));
   assert.deepEqual(actual.selected,actual.available,'Fresh industry comparison must select every available constituent');
   assert.equal(actual.all,true,'Default full selection must be remembered');
 }
 async function fit(){assert.ok(await evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow at '+width);}
 async function shot(name){const y=await evaluate(()=>scrollY),modal=await page.locator('dialog[open]').count();if(!modal)await evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(out,width+'-'+name+'.png'),fullPage:!modal});if(!modal)await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);}
 async function closeComparison(){await page.locator('[data-close-atlas=atlasCompareDialog]').first().click();}
 async function back(){await page.goBack();await page.waitForFunction(()=>AtlasWorkspace.state.charts.length);}
 await page.goto(base+'/market-atlas.html');await ready();
 if(process.env.ATLAS_QA_FIXTURE||!await evaluate(()=>AtlasWorkspace.state.meta.dates.length>=80&&AtlasWorkspace.state.meta.industries.some(s=>s.count>=12))){await page.locator('#openAtlasData').click();await page.locator('#atlasMergedFile').setInputFiles({name:'journey-local-only.csv',mimeType:'text/csv',buffer:fixture()});await page.locator('#atlasImportSubmit').click();await page.waitForFunction(()=>!AtlasWorkspace.state.busy&&AtlasWorkspace.state.meta.stocks.length===120);await page.locator('[data-close-atlas=atlasDataDialog]').click();}
 const largest=await evaluate(()=>[...AtlasWorkspace.state.meta.industries].sort((a,b)=>b.count-a.count)[0].name),other=await evaluate(()=>[...AtlasWorkspace.state.meta.industries].sort((a,b)=>b.count-a.count)[1].name),isPublic=await evaluate(()=>AtlasWorkspace.state.meta.source_kind==='public');
 await page.waitForSelector('.structure-row');
 const endDate=await page.locator('#observationDate').inputValue();
 await page.locator('#observationPrev').click();await page.waitForFunction(d=>document.querySelector('#observationDate').value<d&&document.querySelector('.structure-rows'),endDate);
 const locked=await page.locator('#observationDate').inputValue();
 await page.selectOption('[data-scope]','stocks');await page.locator('[data-weak]').check();await fit();
 const example=await page.locator('.point-controls select option:not([value=""])').first().getAttribute('value');
 await page.locator('.point-controls select').selectOption(example);await page.locator('.point-detail button').click();await stockReady();
 assert.equal(await page.locator('#observationDate').inputValue(),locked);assert.equal(await evaluate(()=>AtlasWorkspace.state.stock.dates.at(-1)),locked);
 assert.equal(await page.locator('#stockRelative svg').count(),1);
 assert.equal(await page.locator('#stockRelative .readout-curve-group .readout-row i').count(),2,'Only plotted curves may have line keys');
 assert.equal(await page.locator('#stockRelative .readout-aux-values .readout-aux-cell').count(),3,'All three supporting returns must remain visible');
 assert.equal(await page.locator('#stockRelative .readout-aux-group i,#stockRelative .readout-aux-group [data-focus-series]').count(),0,'Supporting values must not mimic interactive curve legends');
 assert.equal(await page.locator('#stockRelative .readout-primary .readout-row').count(),2);
 assert.ok(await evaluate(()=>AtlasWorkspace.state.charts.find(c=>c.host.id==='stockRelative').keepSeriesVisible));
 await back();await page.waitForSelector('.point-controls select');
 assert.equal(await page.locator('[data-weak]').isChecked(),true);assert.equal(await page.locator('.point-controls select').inputValue(),example);
 await page.selectOption('[data-scope]','industry');await page.locator('#observationLatest').click();await page.waitForFunction(d=>document.querySelector('#observationDate').value===d&&document.querySelector('.structure-rows'),endDate);
 await page.waitForSelector('.structure-row');await page.locator('[data-display=lines]').click();
 await page.selectOption('#atlasMetric','momentum');await page.locator('#openComparison').click();await page.locator('#clearComparison').click();for(const name of [largest,other]){const input=page.locator('[data-pick]').filter({visible:true});await input.evaluateAll((els,name)=>els.find(e=>e.dataset.pick===name).setAttribute('data-journey-pick','true'),name);await page.locator('[data-journey-pick=true]').check();await page.locator('[data-journey-pick=true]').evaluate(el=>el.removeAttribute('data-journey-pick'));}await closeComparison();
 // Dense lines are hit-tested separately; navigation here should use the
 // deterministic and keyboard-accessible readout entry.
 await page.locator('#marketChart .readout-primary [data-focus-series='+JSON.stringify(largest)+']').click();
 assert.equal(await evaluate(()=>AtlasWorkspace.state.charts[0].pinned),largest);
 assert.equal(await page.locator('.readout-drill').isVisible(),true);
 const marketBefore=await evaluate(()=>{const s=AtlasWorkspace.state,c=s.charts[0];return{metric:s.metric,date:s.market.dates[s.cursor],selected:[...s.selected].sort(),view:c.view,yView:c.yView,pinned:c.pinned};});
 await page.locator('.readout-drill').click();await enterIndustryLines();assert.equal(await evaluate(()=>AtlasWorkspace.state.industry),largest);
  assert.equal(await page.locator('#atlasMetric').inputValue(),'path','Entering an industry must default to cumulative returns');
  assert.ok(await evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return !c.pinned&&!c.focus&&!c.inspectionActive;}),'Industry must not inherit the selected market curve');
  assert.equal(await page.locator('#industryChart .readout-row.is-focused').count(),0);
 await assertAllIndustryStocks();
 // Explicit clear must still be respected; then select all via the real controls.
 await page.locator('#openComparison').click();await page.locator('#clearComparison').click();await closeComparison();
 assert.equal(await evaluate(()=>AtlasWorkspace.state.stocks.size),0,'Manual clear must remain empty');
 assert.equal(await evaluate(()=>AtlasWorkspace.state.charts[0].series.length),2,'Manual clear must retain both benchmark curves');
 await page.locator('#openComparison').click();await page.locator('#selectAllComparison').click();await closeComparison();
 await assertAllIndustryStocks();
 const count=await evaluate(()=>AtlasWorkspace.state.history.stocks.length);assert.ok(count>=12);assert.equal(await evaluate(()=>AtlasWorkspace.state.stocks.size),count);assert.equal(await evaluate(()=>AtlasWorkspace.state.charts[0].series.length),count+2);assert.equal(await page.locator('#industryChart .chart-readout').getAttribute('data-rows'),String(count+2));await fit();await shot('industry-all-stocks');
 await page.selectOption('#atlasMetric','relative');await industryReady();assert.equal(await evaluate(()=>AtlasWorkspace.state.stocks.size),count);
  // Validate every indicator across the entire date range without a selectable baseline.
  assert.equal(await page.locator('#industryBenchmark').count(),0);
  for(const key of ['path','momentum','relative','drawdown','vol']){
    await page.selectOption('#atlasMetric',key);await industryReady();
    const v=await page.evaluate(key=>{
      const s=AtlasWorkspace.state,c=s.charts[0],sect=s.market.sectors.find(x=>x.name===s.industry),
        relative=key==='relative',src=relative?'momentum':key;
      const diff=(x,b)=>x.map((v,i)=>Number.isFinite(v)&&Number.isFinite(b[i])?v-b[i]:null);
      const same=(a,b)=>a?.length===b?.length&&a.every((v,i)=>v===b[i]||Number.isFinite(v)&&Number.isFinite(b[i])&&Math.abs(v-b[i])<1e-9);
      const pool=s.market.pool,member=s.history.stocks.find(x=>x.tracks[src].some(Number.isFinite));
      const expectedStocks=AtlasCharts.rankLatest(s.history.stocks,x=>{
        const v=x.tracks[src]?.at(-1),base=sect.series.momentum.at(-1);
        return relative?(Number.isFinite(v)&&Number.isFinite(base)?v-base:null):v;
      }).map(x=>x.code);
      return{ids:c.series.map(x=>x.id),references:c.series.filter(x=>x.reference).map(x=>x.id),
        rows:c.getRows().length,unit:c.unit,title:c.label,zero:!!c.svg.querySelector('.zero-guide'),
        poolOk:relative||same(c.series.find(x=>x.id==='pool')?.values,pool[key]),
        sectorOk:same(c.series.find(x=>x.id==='sector')?.values,relative?diff(sect.series.momentum,pool.momentum):sect.series[key]),
        stockOk:same(c.series.find(x=>x.id===member?.code)?.values,relative?diff(member.tracks.momentum,sect.series.momentum):member.tracks[key]),
        sorted:JSON.stringify(expectedStocks)===JSON.stringify(c.series.filter(x=>!x.reference).map(x=>x.id)),
        primary:[...c.host.querySelectorAll('.readout-primary .readout-row')].map(x=>x.textContent),
        selected:s.stocks.size};
    },key);
    const absolute=key!=='relative';
    assert.equal(v.ids.length,count+(absolute?2:1),key+' series count');
    assert.equal(v.rows,v.ids.length,key+' readout count');
    assert.equal(v.unit,absolute?'%':'个百分点',key+' unit');
    assert.ok(v.title.includes({path:'累计收益',momentum:'窗口收益',relative:'相对强弱',drawdown:'峰值回撤',vol:'年化波动'}[key]),key+' title');
    assert.ok(v.poolOk&&v.sectorOk&&v.stockOk,key+' numerical values');
    assert.ok(v.sorted,key+' stock order');
    assert.equal(v.selected,count,key+' selected stocks');
    assert.equal(v.zero,key!=='vol',key+' zero guide');
    assert.deepEqual(v.references,absolute?['pool','sector']:['sector'],key+' reference identity');
    if(absolute)assert.ok(v.primary[0]?.includes('股票池等权')&&v.primary[1]?.includes('本行业等权'),key+' missing readout references');
    else assert.equal(v.primary.length,1,'Relative strength has one peer reference');
  }
  await page.selectOption('#atlasMetric','path');await industryReady();
  const chosenStock=await evaluate(()=>AtlasWorkspace.state.history.stocks[0].code);
  await page.locator('#industryChart .readout-toggle').click();
  await page.locator('#industryChart .readout-all [data-focus-series='+JSON.stringify(chosenStock)+']').click();
  assert.equal(await page.locator('#industryChart .readout-primary .readout-row').count(),3,'Focused stock must join both equal-weight readouts');
  await page.locator('#industryChart .readout-unpin').click();
  await page.selectOption('#atlasMetric','relative');await industryReady();
 await page.locator('[data-industry-display=heat]').click();await page.waitForSelector('.heatmap-host');
  assert.ok(await evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return !c.inspectionActive&&!c.pinned&&c.row===undefined&&!c.focus;}),'Industry heatmap should open without highlighted rows');assert.equal(await page.locator('.heatmap-host').getAttribute('data-rows'),String(count));assert.equal(await page.locator('.heatmap-host').getAttribute('data-columns'),'63');assert.equal(await page.locator('.heat-names button').count(),count);assert.match(await page.locator('.heat-corner').textContent(),/股票/);await fit();await shot('industry-complete-heat');
 const order=await evaluate(()=>AtlasCharts.rankLatest(AtlasWorkspace.state.history.stocks,s=>s.tracks.momentum.at(-1)).map(s=>s.code));assert.deepEqual(await evaluate(()=>AtlasWorkspace.state.charts[0].rows.map(r=>r.id)),order);
 await page.locator('[data-map-action=in]').click();await page.locator('.heat-layout').scrollIntoViewIfNeeded();await page.locator('.heat-scroll').evaluate(el=>{el.scrollLeft=0;el.scrollTop=el.scrollHeight;});await page.waitForTimeout(30);
 const hit=await evaluate(()=>{const c=AtlasWorkspace.state.charts[0],r=c.surface.getBoundingClientRect(),row=c.rows.length-3,col=20;return{x:r.left+(col+.5)*c.cellWidth-c.surface.scrollLeft,y:r.top+(row+.5)*c.rowHeight-c.surface.scrollTop,row,col,code:c.rows[row].id};});
 if(width<600){await touch('touchStart',[hit]);await touch('touchEnd',[]);}else await page.mouse.click(hit.x,hit.y);
 assert.equal(await evaluate(()=>AtlasWorkspace.state.cursor),20);assert.equal(await evaluate(()=>AtlasWorkspace.state.charts[0].focus),hit.code);assert.equal(await evaluate(()=>AtlasWorkspace.state.charts[0].pinned),hit.code,'Tap or desktop click must pin the historical heatmap cell before drilling');
 const heatBefore=await evaluate(()=>{const s=AtlasWorkspace.state,c=s.charts[0];return{date:s.market.dates[s.cursor],row:c.row,cellWidth:c.cellWidth,scrollLeft:c.surface.scrollLeft,scrollTop:c.surface.scrollTop,selected:[...s.stocks].sort()};});
 await page.locator('.readout-drill').click();await stockReady();assert.equal(await evaluate(()=>AtlasWorkspace.state.code),hit.code);assert.equal(await evaluate(()=>AtlasWorkspace.state.stock.dates.at(-1)),heatBefore.date);
  assert.ok(await evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return !c.inspectionActive&&!c.pinned&&!c.focus;}),'Opening a stock chart should not carry heatmap focus');assert.equal(await evaluate(()=>AtlasWorkspace.state.stock.dates[AtlasWorkspace.state.cursor]),heatBefore.date);
  assert.equal(await page.locator('#stockSpan').count(),0,'Redundant stock date presets must be absent');
  const quote=page.locator('#stockPriceChart .chart-readout');
  assert.deepEqual(await quote.locator('.readout-primary [data-stock-metric]').evaluateAll(els=>els.map(el=>el.dataset.stockMetric)),['开盘','最高','最低','收盘','涨跌','距今涨幅']);
  assert.equal(await page.locator('#afterwards').count(),0,'Return to latest must not require a toggle');
  const latestReturn=await evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return {actual:c.getRows().find(r=>r.name==='距今涨幅').value,expected:AtlasCharts.returnToLatest(c.stock.close[c.index],c.latestClose),latestDate:c.latestDate,dataDate:AtlasWorkspace.state.meta.dates.at(-1)};});
  assert.equal(latestReturn.latestDate,latestReturn.dataDate);assert.equal(latestReturn.actual,latestReturn.expected);
  await quote.locator('.readout-toggle').click();
  assert.equal(await quote.locator('.readout-all [data-stock-metric]').count(),4);
  assert.deepEqual(await quote.locator('.readout-all [data-stock-metric]').evaluateAll(els=>els.map(el=>el.dataset.stockMetric)).then(names=>names.slice(1)),['MA5','MA10','MA20']);
  await quote.locator('.readout-toggle').click();
  assert.ok(await quote.locator('.readout-primary').evaluate(el=>[...el.querySelectorAll('.stock-readout-cell')].every(cell=>{const a=cell.getBoundingClientRect(),v=cell.querySelector('strong').getBoundingClientRect();return v.right<=a.right+1;})),'Quote metrics must fit their own columns');
  assert.deepEqual(await evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return c.view;}),
    await evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return[0,c.dates.length-1];}),
    'Stock opened from a historical heatmap date should show the entire research period');assert.match(await page.locator('.atlas-drill-path').textContent(),new RegExp(largest));await fit();await shot('stock-from-heat');assert.equal(await page.locator('#stockPriceChart .atlas-time-nav').count(),1,'Stock price chart needs one timeline');await page.locator('#stockPriceChart [data-chart-action=in]').click();const stockNavBefore=await evaluate(()=>[...AtlasWorkspace.state.charts[0].view]);await page.locator('#stockPriceChart .atlas-time-track').scrollIntoViewIfNeeded();const stockNavTarget=await evaluate(()=>{const c=AtlasWorkspace.state.charts[0],w=c.navigator.window.getBoundingClientRect(),r=c.navigator.track.getBoundingClientRect();return{x:(w.left+w.right)/2,y:r.top+r.height/2};});await page.mouse.move(stockNavTarget.x,stockNavTarget.y);await page.mouse.down();await page.mouse.move(stockNavTarget.x+(stockNavBefore[0]>5?-40:40),stockNavTarget.y,{steps:5});await page.mouse.up();const stockNavAfter=await evaluate(()=>[...AtlasWorkspace.state.charts[0].view]);assert.ok(Math.abs(stockNavBefore[0]-stockNavAfter[0])>.25&&Math.abs((stockNavBefore[1]-stockNavBefore[0])-(stockNavAfter[1]-stockNavAfter[0]))<.1,'K-line timeline must pan without changing date span: '+JSON.stringify({stockNavBefore,stockNavAfter}));await page.locator('#stockPriceChart [data-chart-action=reset]').click();await fit();const candleEdges=async()=>{const state=await evaluate(()=>{const c=AtlasWorkspace.state.charts[0],rects=[...c.svg.querySelectorAll('g[clip-path] rect')].map(e=>({x:Number(e.getAttribute('x')),w:Number(e.getAttribute('width'))})),volumes=[...c.svg.querySelectorAll('.plot-volume rect')].map(e=>({x:Number(e.getAttribute('x')),w:Number(e.getAttribute('width'))}));return{left:c.g.left,right:c.g.right,start:c.view[0],end:c.view[1],first:c.X(c.view[0]),last:c.X(c.view[1]),firstIndex:c.indexAt(c.X(c.view[0])),lastIndex:c.indexAt(c.X(c.view[1])),rects,volumes,overflow:document.documentElement.scrollWidth-innerWidth};});assert.ok(state.rects.length>0,'Candlestick bodies missing');for(const [type,bars]of [['K-line',state.rects],['volume',state.volumes]]){assert.ok(bars.every(bar=>bar.x>=state.left-.1&&bar.x+bar.w<=state.right+.1),type+' bars clipped by the horizontal plot boundary');}assert.ok(state.first>state.left&&state.last<state.right,'First and last date centers need horizontal padding');assert.equal(state.firstIndex,Math.ceil(state.start));assert.equal(state.lastIndex,Math.floor(state.end));assert.ok(state.overflow<=0,'K-line causes page overflow');};await candleEdges();await page.locator('#stockPriceChart [data-chart-action=in]').click();await candleEdges();await page.locator('#stockPriceChart [data-chart-action=reset]').click();await candleEdges();const stockReset=await evaluate(()=>AtlasWorkspace.state.charts[0].resetView);await page.locator('#stockPriceChart [data-chart-action=in]').click();await page.locator('#stockPriceChart [data-chart-action=reset]').click();assert.deepEqual(await evaluate(()=>AtlasWorkspace.state.charts[0].view),stockReset,'Stock reset must restore the whole research interval');assert.equal(await evaluate(()=>AtlasWorkspace.state.charts[0].yView),null);assert.equal(await evaluate(()=>AtlasWorkspace.state.ranges.has('stock-'+AtlasWorkspace.state.code)),false);await fit();
 await back();await industryReady();await page.waitForFunction(()=>AtlasWorkspace.state.industryDisplay==='heat');
 const heatAfter=await evaluate(()=>{const s=AtlasWorkspace.state,c=s.charts[0];return{date:s.market.dates[s.cursor],row:c.row,cellWidth:c.cellWidth,scrollLeft:c.surface.scrollLeft,scrollTop:c.surface.scrollTop,selected:[...s.stocks].sort()};});assert.deepEqual(heatAfter,heatBefore,'Back lost industry heat context');
 await back();await page.waitForFunction(()=>AtlasWorkspace.state.view==='market'&&AtlasWorkspace.state.charts[0]?.series);const marketAfter=await evaluate(()=>{const s=AtlasWorkspace.state,c=s.charts[0];return{metric:s.metric,date:s.market.dates[s.cursor],selected:[...s.selected].sort(),view:c.view,yView:c.yView,pinned:c.pinned};});assert.deepEqual(marketAfter,marketBefore,'Back lost market chart context');
 await page.goForward();await industryReady();await page.waitForFunction(()=>AtlasWorkspace.state.industryDisplay==='heat');
 // User-selected subsets survive mode, metric and industry changes, while the heat retains all members.
 await page.locator('#openComparison').click();await page.locator('#clearComparison').click();await page.locator('[data-pick]').first().check();const chosen=await page.locator('[data-pick]:checked').getAttribute('data-pick');await closeComparison();assert.equal(await page.locator('.heatmap-host').getAttribute('data-rows'),String(count));
 await page.locator('[data-industry-display=lines]').click();await industryReady();assert.equal(await evaluate(()=>AtlasWorkspace.state.charts[0].series.length),2);await page.selectOption('#atlasMetric','drawdown');await industryReady();assert.equal(await evaluate(()=>AtlasWorkspace.state.charts[0].series.length),3);assert.deepEqual(await evaluate(()=>[...AtlasWorkspace.state.stocks]),[chosen]);
 await page.selectOption('#industrySelect',other);await enterIndustryLines();assert.equal(await page.locator('#atlasMetric').inputValue(),'path','Switching industries must default to cumulative returns');await assertAllIndustryStocks();await page.selectOption('#industrySelect',largest);await enterIndustryLines();assert.deepEqual(await evaluate(()=>[...AtlasWorkspace.state.stocks]),[chosen]);await page.locator('[data-route-view=market]').click();await page.waitForFunction(()=>AtlasWorkspace.state.view==='market'&&AtlasWorkspace.state.charts.length);await page.selectOption('#atlasMetric','relative');
  await page.waitForFunction(()=>AtlasWorkspace.state.view==='market'&&AtlasWorkspace.state.charts[0]?.zeroGuide===true);
  assert.ok(await evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return !c.series.some(s=>s.id==='pool')&&!c.getRows().some(s=>s.id==='pool')&&!!c.svg.querySelector('.zero-guide');}),'Market relative strength displays a redundant zero pool series');
  await page.selectOption('#atlasMetric','vol');await page.locator('[data-atlas-view=industry]').click();await enterIndustryLines();assert.deepEqual(await evaluate(()=>[...AtlasWorkspace.state.stocks]),[chosen]);assert.equal(await page.locator('#atlasMetric').inputValue(),'path','Industry re-entry must default to cumulative returns regardless of the market metric');assert.equal(await evaluate(()=>AtlasWorkspace.state.industryDisplay),'lines','New entry from market should show the comparable industry line chart, not an old heatmap');
 await page.locator('#openComparison').click();await page.locator('#selectAllComparison').click();await closeComparison();assert.equal(await evaluate(()=>AtlasWorkspace.state.charts[0].series.length),count+2);
 // Industry curve -> stock, including fullscreen, keeps all data and returns to the same viewport.
 await page.selectOption('#atlasMetric','path');await industryReady();await page.locator('[data-chart-action=expand]').click();await page.locator('.readout-toggle').click();const stockLink=page.locator('#atlasChartDialog .readout-all a[data-open-series]').first(),stockCode=await stockLink.getAttribute('data-open-series');await stockLink.click();await stockReady();assert.equal(await evaluate(()=>AtlasWorkspace.state.code),stockCode);assert.equal(await page.locator('#atlasChartDialog').evaluate(el=>el.open),false);
 await back();await industryReady();await page.waitForFunction(()=>document.getElementById('atlasChartDialog').open);await page.locator('#atlasChartDialog>header button').click();
 // Breadcrumbs restore the parent, and both market heat and rotation have direct drill links.
 await page.locator('[data-route-view=market]').click();await page.waitForFunction(()=>AtlasWorkspace.state.view==='market'&&AtlasWorkspace.state.charts.length);await page.locator('[data-display=heat]').click();await page.locator('.heat-names button').first().click();await enterIndustryLines();
  assert.equal(await evaluate(()=>AtlasWorkspace.state.industryMetric),'path','Heatmap drill must default to cumulative returns');await page.locator('[data-route-view=market]').click();await page.waitForFunction(()=>AtlasWorkspace.state.view==='market');await page.locator('[data-display=rotation]').click();await page.waitForFunction(()=>AtlasWorkspace.state.charts[0]?.independentDate);await page.selectOption('.rotation-industry',{label:largest});const rotationDate=await evaluate(()=>AtlasWorkspace.state.rotationDate);await page.locator('.readout-drill').click();await enterIndustryLines();assert.equal(await evaluate(()=>AtlasWorkspace.state.industry),largest);assert.equal(await evaluate(()=>AtlasWorkspace.state.market.dates[AtlasWorkspace.state.cursor]),rotationDate);assert.equal(await page.locator('#atlasMetric').inputValue(),'path','Rotation drill must default to cumulative returns');
 await page.locator('[data-industry-display=heat]').click();await page.waitForSelector('.heatmap-host');await page.locator('.heat-names button').first().click();await stockReady();
 // Price viewports belong to the stock, independently of the market metric or display mode.
 assert.equal(await page.locator('#stockMode').count(),0,'Redundant close-price display selector must remain absent');assert.equal(await evaluate(()=>AtlasWorkspace.state.charts[0].kind),'candles');
 await page.locator('#stockPriceChart [data-chart-action=in]').click();const priceViewport=await evaluate(()=>({view:AtlasWorkspace.state.charts[0].view,yView:AtlasWorkspace.state.charts[0].yView}));
 await page.locator('[data-route-view=market]').click();await page.waitForFunction(()=>AtlasWorkspace.state.view==='market'&&AtlasWorkspace.state.charts.length);await page.locator('[data-display=lines]').click();await page.selectOption('#atlasMetric','vol');
 await back();await stockReady();assert.equal(await evaluate(()=>AtlasWorkspace.state.charts[0].kind),'candles');assert.deepEqual(await evaluate(()=>({view:AtlasWorkspace.state.charts[0].view,yView:AtlasWorkspace.state.charts[0].yView})),priceViewport);
 if(isPublic){const url=base+'/market-atlas.html#industry/'+encodeURIComponent(largest),deep=await context.newPage();deep.on('pageerror',e=>errors.push(e.message));await deep.goto(url);await deep.waitForSelector('#industryBand svg');assert.equal(await deep.evaluate(()=>AtlasWorkspace.state.industryDisplay),'structure');assert.equal(await deep.locator('#atlasMetric').inputValue(),'path','Direct industry links must default to cumulative returns');
 // Internal structure does not load the comparison universe until needed.
 await deep.locator('[data-industry-display=lines]').click();
 await deep.waitForFunction(()=>AtlasWorkspace.state.history?.name===AtlasWorkspace.state.industry&&AtlasWorkspace.state.charts[0]?.host.id==='industryChart');
 assert.deepEqual(await deep.evaluate(()=>[...AtlasWorkspace.state.stocks].sort()),await deep.evaluate(()=>AtlasWorkspace.state.history.stocks.map(s=>s.code).sort()),'Fresh direct industry link must default to all constituents');
 await deep.locator('[data-industry-display=heat]').click();await deep.waitForSelector('.heatmap-host');await deep.reload();await deep.waitForFunction(()=>window.AtlasWorkspace?.state.industryDisplay==='heat'&&AtlasWorkspace.state.charts.length,{timeout:90000});assert.equal(await deep.locator('.heatmap-host').getAttribute('data-rows'),String(count));await deep.close();}
 // Changing research dates and navigating immediately uses one consistent dataset.
 await page.locator('[data-route-view=market]').click();await page.waitForFunction(()=>AtlasWorkspace.state.view==='market'&&AtlasWorkspace.state.charts.length);
 await page.selectOption('#atlasPeriod','all');await page.locator('[data-atlas-view=industry]').click();await enterIndustryLines();
 assert.equal(await evaluate(()=>AtlasWorkspace.state.market.dates.length),await evaluate(()=>AtlasWorkspace.state.meta.dates.length));assert.equal(await evaluate(()=>AtlasWorkspace.state.history.dates.length),await evaluate(()=>AtlasWorkspace.state.market.dates.length));
 if(width===390){await page.locator('[data-industry-display=heat]').click();await page.waitForSelector('.heatmap-host');await evaluate(()=>AtlasWorkspace.observeDate(AtlasWorkspace.state.market.dates[0]));
 const beforeReset=await evaluate(()=>{const s=AtlasWorkspace.state,c=s.charts[0];return {cursor:s.cursor,index:c.index,observation:document.querySelector('#observationDate').value};});
 await page.locator('.heatmap-host [data-map-action=reset]').click();
 assert.deepEqual(await evaluate(()=>{const s=AtlasWorkspace.state,c=s.charts[0];return {cursor:s.cursor,index:c.index,observation:document.querySelector('#observationDate').value};}),beforeReset,'Heatmap viewport reset must not change the inspected or observation date');
 assert.ok(await evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return Math.abs(c.surface.scrollLeft-(c.surface.scrollWidth-c.surface.clientWidth))<=2;}),'Heatmap reset must restore the latest viewport edge');await page.locator('button[data-theme]').click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await fit();await shot('industry-heat-light');}
 // Changing the global research period must directly change the full stock date span.
 await evaluate(()=>AtlasWorkspace.openStock(AtlasWorkspace.state.history.stocks[0].code));await stockReady();
 const verifyFull=async()=>{
   assert.equal(await page.locator('#stockSpan').count(),0,'No duplicate stock date selector');
   const info=await evaluate(()=>{const c=AtlasWorkspace.state.charts[0];return{view:[...c.view],reset:[...c.resetView],expected:[0,c.dates.length-1]};});
   assert.deepEqual(info.view,info.expected,'Stock must show all research dates');
   assert.deepEqual(info.reset,info.expected,'Reset must show all research dates');
 };
 await verifyFull();
 await page.selectOption('#atlasPeriod','63');
 await page.waitForFunction(()=>AtlasWorkspace.state.market?.dates.length===63&&AtlasWorkspace.state.charts[0]?.dates.length===63,{timeout:90000});
 await verifyFull();
 await page.selectOption('#atlasPeriod','all');
 const allDays=await evaluate(()=>AtlasWorkspace.state.meta.dates.length);
 await page.waitForFunction(n=>AtlasWorkspace.state.market?.dates.length===n&&AtlasWorkspace.state.charts[0]?.dates.length===n,allDays,{timeout:90000});
 await verifyFull();
 await fit();console.log('PASS journey '+width+'px: '+count+' stocks, complete heat, both benchmarks, curve/heat/rotation drill, stock detail, back/forward, selection persistence, fullscreen and '+(isPublic?'deep link/refresh.':'local-preview context.'));await context.close();
}assert.deepEqual(errors,[]);}finally{console.log(JSON.stringify({errors}));await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
