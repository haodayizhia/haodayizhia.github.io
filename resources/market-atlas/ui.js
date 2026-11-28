'use strict';
(()=>{
  const {Chart,escape:esc,number:num,finite,rankLatest,seriesStyle}=AtlasCharts,$=id=>document.getElementById(id);
  const S={meta:null,market:null,view:'market',display:'structure',metric:'path',heatMetric:'relative',window:1,mode:'dynamic',scale:'linear',cursor:0,industry:'',code:'',selected:new Set(),stocks:new Set(),charts:[],history:null,stock:null,industryDisplay:'structure',industryMetric:'path',stockSelections:new Map(),seq:0,renderSeq:0,ranges:new Map(),yRanges:new Map(),industryStyles:new Map(),stockStyles:new Map(),busy:false,files:[],kind:'merged',dataMode:'preview',timer:null,rotationWindow:5,rotationDate:'',rotationMarket:null,
    researchEnd:'',lockedDate:'',structureSort:'excess',structureScope:'industry',structureMobile:'dist',weakOnly:false,
    pointBrush:null,structurePoint:'',showBreadth:false,pairA:'',pairB:'',afterwards:false,compareTouched:false};
  const palette=['var(--plot-blue)','var(--plot-gold)','var(--plot-teal)','var(--plot-purple)','var(--plot-red)','var(--plot-slate)'];
  const titles={path:'累计收益',momentum:'窗口收益',relative:'相对强弱',breadth:'MA20广度',drawdown:'峰值回撤',vol:'年化波动',dispersion:'个股分化'};
  const metric=()=>S.view==='industry'?(S.industryDisplay==='heat'?'relative':S.industryMetric):S.view==='market'&&S.display==='rotation'?'relative':S.view==='market'&&S.display==='heat'?S.heatMetric:S.metric;
  const unit=key=>['relative','dispersion'].includes(key||metric())?'个百分点':'%';
  const style=name=>S.industryStyles.get(name)||seriesStyle(0);
  const color=name=>style(name).color;
  const orderedSectors=(data=S.market,key=metric())=>rankLatest((data?.sectors||[]).filter(s=>s.series.price_count.some(n=>n>0)),s=>s.series[key]?.at(-1));
  const pct=v=>finite(v)?(v>0?'+':'')+num(v)+'%':'—';
  const query=()=>({start:S.market.dates[0],end:S.market.dates.at(-1),window:S.window,mode:S.mode});
  const rangeKey=()=>S.view==='industry'?'industry-'+S.industry+'-'+S.industryDisplay:S.view==='stock'?'stock-'+S.code:'market-'+S.display;
  let navigationReady=false,navigationEpoch=0,historyTimer,activeRestore=null;const parentContexts=new Map();
  const navigationFields=['view','display','metric','industryDisplay','industryMetric','industry','code','window','mode','scale','rotationWindow','rotationDate','heatMetric','researchEnd','lockedDate','structureSort','structureScope','structureMobile','weakOnly','pointBrush','structurePoint','showBreadth','pairA','pairB','afterwards','compareTouched'];
  function routeURL(view,id=''){return location.pathname+location.search+(view==='market'?'':'#'+view+(id?'/'+encodeURIComponent(id):''));}
  function parseRoute(){try{const [view,id='']=location.hash.slice(1).split('/');return{view:['industry','stock'].includes(view)?view:'market',id:decodeURIComponent(id)};}catch{return{view:'market',id:''};}}
  function applyRoute(view,id){
    S.view=['market','industry','stock'].includes(view)?view:'market';
    if(S.view==='industry'){if(id&&!S.meta.industries.some(s=>s.name===id)){notice('当前数据源没有该行业，已返回市场。',true);S.view='market';return '当前数据源没有该行业，已返回市场。';}if(S.industry!==id)S.stocks=new Set();S.industry=id||'';}
    if(S.view==='stock'){const stock=S.meta.stocks.find(s=>s.code===String(id).toUpperCase());if(id&&!stock){notice('当前数据源没有该股票，已返回市场。',true);S.view='market';return '当前数据源没有该股票，已返回市场。';}S.code=stock?.code||'';if(stock)S.industry=stock.industry;}
  }
  function captureNavigation(){
    if(!S.market)return null;
    const charts=S.charts.map(c=>({host:c.host.id,index:c.index,focus:c.pinned?c.focus:null,axisValue:null,view:c.view&&[...c.view],yView:c.yView&&[...c.yView],row:c.pinned?c.row:undefined,cellWidth:c.cellWidth,fitted:c.fitted,resetIndex:c.resetIndex,scrollLeft:c.surface.scrollLeft,scrollTop:c.surface.scrollTop,pinned:c.pinned,domain:c.domain&&[...c.domain],zoomed:c.zoomed,zoomedAxes:c.zoomedAxes&&{...c.zoomedAxes},zoomAxis:c.zoomAxis}));
    return{dataset:S.datasetKey,...Object.fromEntries(navigationFields.map(k=>[k,S[k]])),start:S.market.dates[0],end:S.market.dates.at(-1),date:S.market.dates[S.cursor],period:$('atlasPeriod').value,selected:[...S.selected],stockSelections:[...S.stockSelections],ranges:[...S.ranges],yRanges:[...S.yRanges],charts,structureScroll:document.querySelector('.structure-rows')?.scrollTop||0,scroll:[scrollX,scrollY],fullscreen:AtlasFullscreen.host?.id||''};
  }
  // Keep ordinary chart interaction out of the browser navigation pipeline.
  // Only small UI snapshots are stored; source data and credentials are excluded by captureNavigation.
  const navigationStore='bro.atlas.navigation.v2';let navigationSnapshots=new Map();
  try{navigationSnapshots=new Map(JSON.parse(sessionStorage.getItem(navigationStore)||'[]'));}catch{}
  function cacheNavigation(key,value){
    navigationSnapshots.delete(key);navigationSnapshots.set(key,value);
    while(navigationSnapshots.size>12)navigationSnapshots.delete(navigationSnapshots.keys().next().value);
    try{sessionStorage.setItem(navigationStore,JSON.stringify([...navigationSnapshots]));}catch{/* Memory and the entry snapshot remain available. */}
  }
  function savedNavigation(state){
    const saved=navigationSnapshots.get(state?.broAtlasEntry)||state?.broAtlas;
    if(!saved||saved.view!=='industry'||!Object.prototype.hasOwnProperty.call(saved,'benchmark'))return saved;
    // Pre-change comparison plots stored a different y-axis meaning. Retain dates
    // and selected stocks, but never restore that old numeric axis into raw returns.
    const migrated={...saved,yRanges:[],charts:(saved.charts||[]).map(chart=>({...chart,yView:null,domain:null}))};
    delete migrated.benchmark;
    return migrated;
  }
  function pushNavigation(value,url){const key=crypto.randomUUID();cacheNavigation(key,value);history.pushState({broAtlasEntry:key,broAtlas:value},'',url);}
  function recordNavigation(){
    if(!navigationReady||!S.market||S.marketPromise||S.marketDatasetKey!==S.datasetKey)return;
    const value=captureNavigation(),id=S.view==='industry'?S.industry:S.view==='stock'?S.code:'';
    try{const key=history.state?.broAtlasEntry||crypto.randomUUID(),url=routeURL(S.view,id);cacheNavigation(key,value);if(location.pathname+location.search+location.hash!==url)history.replaceState({...history.state,broAtlasEntry:key,broAtlas:value},'',url);else if(!history.state?.broAtlasEntry)history.replaceState({...history.state,broAtlasEntry:key,broAtlas:value},'');if(S.view!=='stock'){const key=S.view==='market'?'market':'industry:'+S.industry;parentContexts.set(key,value);if(parentContexts.size>12)parentContexts.delete(parentContexts.keys().next().value);}}catch{/* The document may already be leaving. */}
  }
  function scheduleNavigation(){if(!navigationReady)return;clearTimeout(historyTimer);historyTimer=setTimeout(recordNavigation,400);}
  function restoreCharts(states=[]){
    for(const saved of states){const c=S.charts.find(c=>c.host.id===saved.host);if(!c)continue;
      if(c instanceof Chart){
        if(saved.view)c.setRange(...saved.view);
        if(saved.yView)c.setYRange(saved.yView,true);
        c.setIndex(Math.min(saved.index,c.dates.length-1));
        // Restore explicit fixed focus; transient pointer hover must never leak.
        c.pinned=c.series.some(s=>s.id===saved.pinned)?saved.pinned:null;
        c.focus=c.pinned;c.inspectionActive=false;c.axisValue=null;
        c.zoomAxis=saved.zoomAxis||'both';AtlasApplyZoomAxis(c.host,c.zoomAxis);
        c.updateOverlay();c.updateValues();
      }else if(c instanceof AtlasMaps.Heatmap){
        const row=c.rows.findIndex(r=>(r.id||r.name)===saved.pinned);
        c.pinned=row>=0?saved.pinned:null;
        c.inspectionActive=!!c.pinned;c.row=row>=0?row:undefined;c.focus=c.pinned;
        c.fitted=saved.fitted;c.cellWidth=saved.cellWidth;
        c.resetIndex=Number.isInteger(saved.resetIndex)?Math.max(0,Math.min(saved.resetIndex,c.dates.length-1)):c.resetIndex;
        c.draw();c.setIndex(saved.index);
        c.surface.scrollLeft=saved.scrollLeft||0;c.surface.scrollTop=saved.scrollTop||0;
      }else{
        c.setIndex(saved.index);
        c.pinned=c.rows.some(r=>r.name===saved.pinned)?saved.pinned:'';
        c.focus=c.pinned;c.inspectionActive=!!c.pinned;
        c.domain=saved.domain;c.zoomed=saved.zoomed;c.zoomedAxes=saved.zoomedAxes||{x:!!saved.zoomed,y:!!saved.zoomed};
        c.zoomAxis=saved.zoomAxis||'both';AtlasApplyZoomAxis(c.host,c.zoomAxis);
        c.fillIndustryPicker();c.draw();
      }
    }
  }
  function restoreNavigation(value,hydrate=false){const pending=restoreNavigationNow(value,hydrate);activeRestore=pending;const done=()=>{if(activeRestore===pending)activeRestore=null;};pending.then(done,done);return pending;}
  async function restoreNavigationNow(value,hydrate=false){
    const epoch=++navigationEpoch,sameSource=value.dataset===S.datasetKey;stop();++S.seq;S.marketPromise=null;
    const rolling=!value.lockedDate&&!sameSource&&['63','252','all'].includes(value.period),allDates=S.meta.dates,dates=rolling?allDates.slice(value.period==='all'?0:Math.max(0,allDates.length-Number(value.period))):allDates.filter(d=>d>=value.start&&d<=value.end),start=dates[0]||allDates[Math.max(0,allDates.length-63)],end=dates.at(-1)||allDates.at(-1);
    const needsData=S.market.dates[0]!==start||S.market.dates.at(-1)!==end||S.window!==value.window||S.mode!==value.mode;
    const shared=['researchEnd','lockedDate','afterwards','structurePoint','pointBrush','showBreadth'],own=value.view==='market'?['display','metric','heatMetric','rotationWindow','rotationDate','structureSort','structureScope','structureMobile','weakOnly','pairA','pairB','compareTouched']:value.view==='industry'?['industry','industryDisplay','industryMetric']:['code'],restoreKeys=hydrate?navigationFields:['view','window','mode','scale',...shared,...own];
    for(const key of restoreKeys)if(value[key]!==undefined)S[key]=value[key];
    S.lockedDate=value.lockedDate&&dates.includes(value.lockedDate)?value.lockedDate:'';
    S.researchEnd=rolling?end:allDates.filter(d=>d<=(value.researchEnd||end)).at(-1)||end;
    if(needsData)await loadMarket(start,end,false);if(epoch!==navigationEpoch)return;
    if(hydrate||value.view==='market')S.selected=S.compareTouched?new Set((value.selected||[]).filter(name=>S.meta.industries.some(s=>s.name===name))):allIndustrySelection();
    const incoming=new Map(value.stockSelections||[]),choices=new Map([...incoming,...S.stockSelections]);if(value.view==='industry'&&incoming.has(value.industry))choices.set(value.industry,incoming.get(value.industry));S.stockSelections=choices;
    const prefix=value.view==='industry'?'industry-'+value.industry+'-':value.view+'-',mergeRanges=(current,entries)=>{const map=new Map(!needsData&&sameSource?current:[]);for(const [key,range]of entries||[])if(hydrate||key.startsWith(prefix)||!map.has(key))map.set(key,range);return map;};
    S.ranges=mergeRanges(S.ranges,sameSource?value.ranges:[]);S.yRanges=mergeRanges(S.yRanges,sameSource?value.yRanges:[]);
    S.cursor=rolling&&value.date===value.end?S.market.dates.length-1:Math.max(0,S.market.dates.indexOf(value.date));$('atlasPeriod').value=value.period||'63';
    applyRoute(S.view,S.view==='industry'?S.industry:S.view==='stock'?S.code:'');updateSummary();await renderView();if(epoch!==navigationEpoch)return;
    if(sameSource){
      // Older navigation entries may contain an implicit 20/60-day stock preset.
      // Only discard that legacy preset, not a separately user-zoomed viewport.
      const legacyPreset=value.view==='stock'&&value.stockSpan!==undefined&&!S.ranges.has('stock-'+value.code);
      restoreCharts(legacyPreset?(value.charts||[]).map(c=>({...c,view:null})):value.charts);
    }
    const rows=document.querySelector('.structure-rows');if(rows)rows.scrollTop=value.structureScroll||0;
    S.stateTimeNav?.update();window.scrollTo({left:value.scroll?.[0]||0,top:value.scroll?.[1]||0,behavior:'instant'});
    if(value.fullscreen){const host=$(value.fullscreen);if(host)AtlasFullscreen.open(host,S.view==='industry'?S.industry:'图表详情');}
    scheduleNavigation();
  }
  async function goView(view,id){
    if(!S.market)return;if(view===S.view&&(id===undefined||id===(view==='industry'?S.industry:view==='stock'?S.code:'')))return;while(activeRestore||S.marketPromise)await(activeRestore||S.marketPromise);const epoch=++navigationEpoch;clearTimeout(historyTimer);recordNavigation();
    const structureView=S.view==='market'&&S.display==='structure'||S.view==='industry'&&S.industryDisplay==='structure';
    const drillDate=structureView?S.market.dates.at(-1):S.view==='market'&&S.display==='rotation'?S.rotationDate:S.market.dates[S.cursor];
    const previousView=S.view,source=S.charts[0],range=source instanceof Chart?{dates:[source.dates[Math.floor(source.view[0])],source.dates[Math.ceil(source.view[1])]],view:[...source.view],total:source.dates.length}:null;
    const nextId=id!==undefined?id:view==='industry'?S.industry:view==='stock'?S.code:'';
    if(view==='industry'){S.industryDisplay=defaultStructure()?'structure':'lines';S.industryMetric='path';}
    if(view==='market')S.display=defaultStructure()?'structure':'lines';
    if(view!==previousView||id!==S.industry){S.pointBrush=null;S.structurePoint='';}
    if(view==='stock')S.afterwards=false;
    if(view==='industry'&&previousView==='market'&&S.display==='rotation')S.cursor=Math.max(0,S.market.dates.indexOf(S.rotationDate));
    if((view==='stock'||view==='industry')&&drillDate&&drillDate<S.market.dates.at(-1)){
      S.lockedDate=drillDate;await loadMarket(S.market.dates[0],drillDate,false);if(epoch!==navigationEpoch)return;
    }
    applyRoute(view,nextId);if(range&&S.view==='industry'&&!S.ranges.has(rangeKey()))S.ranges.set(rangeKey(),range);
    const value=captureNavigation();value.charts=[];value.scroll=[0,0];value.fullscreen='';
    pushNavigation(value,routeURL(S.view,S.view==='industry'?S.industry:S.view==='stock'?S.code:''));
    await renderView();if(epoch!==navigationEpoch)return;
    $('atlasContent').scrollIntoView({block:'start',behavior:'instant'});recordNavigation();
  }
  function goParent(view,id=''){const value=parentContexts.get(view==='market'?'market':'industry:'+id)||[...navigationSnapshots.values()].reverse().find(v=>v.dataset===S.datasetKey&&v.view===view&&(view==='market'||v.industry===id));if(!value)return goView(view,id);clearTimeout(historyTimer);recordNavigation();pushNavigation(value,routeURL(view,id));return restoreNavigation(value);}
  function openIndustry(name){if(S.view==='market'&&S.display==='structure')S.comparisonSeed=name;return goView('industry',name);}
  function openStock(code){return goView('stock',code);}
  function drillPath(){
    if(S.view==='market')return '';
    const stock=S.meta.stocks.find(s=>s.code===S.code),industry=S.view==='stock'?stock?.industry:S.industry;
    return`<nav class="atlas-drill-path" aria-label="图谱层级"><a href="${esc(routeURL('market'))}" data-route-view="market">市场</a><span>/</span>${S.view==='stock'&&industry?`<a href="${esc(routeURL('industry',industry))}" data-route-industry="${esc(industry)}">${esc(industry)}</a><span>/</span>`:''}<span aria-current="page">${esc(S.view==='industry'?industry||'选择行业':stock?.name||'选择股票')}</span><button type="button" data-atlas-back>返回上一步</button></nav>`;
  }
  function notice(text,error=false){$('atlasNotice').textContent=text||'';$('atlasNotice').hidden=!text;$('atlasNotice').classList.toggle('is-error',error);}
  function stop(){S.charts.forEach(c=>c.pause?.());clearInterval(S.timer);S.timer=null;const b=$('atlasReplay');if(b){b.textContent='回放';b.setAttribute('aria-pressed','false');}}
  function dispose(){S.researchCleanup?.();S.researchCleanup=null;AtlasFullscreen.close();AtlasInspector.hide();S.stateTimeNav?.destroy();S.stateTimeNav=null;S.charts.forEach(c=>c.destroy());S.charts=[];}
  function applyRange(start,end,origin){
    scheduleNavigation();S.ranges.set(rangeKey(),{dates:[start,end],view:[...origin.view],total:origin.dates.length});
    for(const chart of S.charts)if(chart!==origin&&chart.setDateRange){if(chart.dates.length===origin.dates.length)chart.setRange(...origin.view);else chart.setDateRange(start,end);}S.stateTimeNav?.update();
  }
  function restoreLatestInspectionDate(){
    if(!S.market?.dates.length)return;
    const latest=S.market.dates.at(-1);
    S.cursor=S.market.dates.length-1;
    // Preserve zoom ranges: update readout dates, not the user's visible time window.
    for(const chart of S.charts){
      if(chart.independentDate||!chart.dates?.length||!chart.setIndex)continue;
      const i=chart.dates.indexOf(latest);
      chart.setIndex(i>=0?i:chart.dates.length-1);
    }
    updateSummary();
    if($('stateDate'))$('stateDate').textContent=latest;
    // Do not rebuild the comparison dialog during pointerdown: doing so removes
    // its checkbox before the native change event can commit the user's selection.
    scheduleNavigation();
  }
  function graph(id,options){
    const scope=S.view==='industry'?S.industry:S.view==='stock'?S.code:'',yKey=rangeKey()+'-'+id+'-'+(S.view==='stock'?'price':metric())+'-'+(S.view==='stock'?'linear':S.scale)+'-'+scope;
    const chart=new Chart($(id),{...options,onDismiss:(keep,origin)=>S.charts.filter(c=>c!==origin).forEach(c=>c.clearInspection?.(keep,false)),onInspectionEnd:restoreLatestInspectionDate,onYRange:range=>{scheduleNavigation();if(range)S.yRanges.set(yKey,[...range]);else S.yRanges.delete(yKey);},onInspect:(i,origin)=>observeDate(options.dates[i],origin),onRange:(a,b)=>applyRange(a,b,chart),onReset:()=>{S.ranges.delete(rangeKey());scheduleNavigation();}});
    const defaults=options.stock?[0,chart.dates.length-1]:chart.defaultView();chart.resetView=[...defaults];
    const range=S.ranges.get(rangeKey());
    if(range){if(range.total===chart.dates.length)chart.setRange(...range.view);else chart.setDateRange(...range.dates);}
    else if(chart.dates.length>1)chart.setRange(...defaults);
    if(S.yRanges.has(yKey))chart.setYRange(S.yRanges.get(yKey));
    // The inspected historical date is independent of the default visible window.
    chart.setIndex(S.cursor);S.charts.push(chart);return chart;
  }
  function observeDate(date,origin){
    if(!S.market)return;const i=S.market.dates.indexOf(date);if(i<0)return;const changed=S.cursor!==i;S.cursor=i;
    for(const chart of S.charts)if(chart!==origin&&!chart.independentDate){
      const j=chart.dates.indexOf(date);if(j<0)continue;
      const active=origin?.inspectionActive??false,clearFocus=S.view==='market'&&S.display==='state'&&origin instanceof Chart&&(chart.focus||chart.pinned);
      if(clearFocus){chart.focus=null;chart.pinned=null;}
      if(chart.index===j&&chart.inspectionActive===active&&!clearFocus)continue;
      chart.inspectionActive=active;chart.setIndex(j);
    }
    if(changed){if($('stateDate'))$('stateDate').textContent=date;if($('atlasCompareDialog').open)renderComparison();}
  }
  function updateSummary(){
    if(!S.market)return;const p=S.market.pool,i=S.market.dates.length-1;
    $('atlasSummary').innerHTML=[['当日等权',pct(p.ret[i])],['站上MA20',finite(p.breadth[i])?num(p.breadth[i],1)+'%':'—'],['上涨比例',finite(p.up[i])?num(p.up[i],1)+'%':'—']].map(([label,value])=>`<span>${label}<strong>${value}</strong></span>`).join('');
  }
  function updateMeta(){
    const m=S.meta;$('atlasDataset').textContent=`${m.source_kind==='public'?'公开行情':'本地预览'} · 截至 ${m.dates.at(-1)} · ${m.stocks.length.toLocaleString()}只股票`;
    $('datasetSummary').textContent=`${m.stocks.length.toLocaleString()}只股票 · ${m.industries.length}个行业 · ${m.price_basis==='qfq'?'前复权':'复权口径以原始数据为准'} · ${m.dates[0]} — ${m.dates.at(-1)}`;
    $('qualitySummary').textContent=`${m.quality.rows.toLocaleString()}行；无效价格 ${m.quality.invalid_prices}，重复日期 ${m.quality.duplicate_rows}，末日缺价 ${m.quality.missing_latest.length}只。缺失值留空。`;
    for(const id of ['filterStart','filterEnd']){$(id).min=m.dates[0];$(id).max=m.dates.at(-1);}
  }
  async function initialize(){
    const desired=navigationReady?{view:S.view,id:S.view==='industry'?S.industry:S.view==='stock'?S.code:''}:parseRoute(),saved=!navigationReady&&savedNavigation(history.state);
    const ticket=++S.seq,meta=await AtlasData.request('/api/meta');if(ticket!==S.seq)return;
    S.meta=meta;S.comparisonSeed='';S.datasetKey=meta.revision||meta.source_kind+':'+Date.now()+':'+S.seq;parentContexts.clear();S.historyKey=null;S.pendingHistoryKey=null;S.pendingHistory=null;S.industryStyles=new Map([...meta.industries].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map((s,i)=>[s.name,seriesStyle(i)]));S.stockStyles=new Map([...meta.stocks].sort((a,b)=>a.code.localeCompare(b.code)).map((s,i)=>[s.code,seriesStyle(i)]));S.selected=new Set();S.compareTouched=false;S.lockedDate='';S.researchEnd=meta.dates.at(-1);S.structureCache=null;S.afterwards=false;S.structurePoint='';S.pointBrush=null;S.rotationDate='';S.stockSelections.clear();S.stocks.clear();S.industry='';S.code='';S.ranges.clear();S.yRanges.clear();updateMeta();
    if(!defaultStructure()){S.display='lines';S.industryDisplay='lines';}
    const routeError=applyRoute(desired.view,desired.id);$('atlasPeriod').value='63';const dates=meta.dates;await loadMarket(dates[Math.max(0,dates.length-63)],dates.at(-1),!saved);navigationReady=true;if(saved)await restoreNavigation(saved,true);else recordNavigation();if(routeError)notice(routeError,true);
  }
  function loadMarket(start,end,render=true){const pending=loadMarketData(start,end,render);S.marketPromise=pending;const done=()=>{if(S.marketPromise===pending)S.marketPromise=null;};pending.then(done,done);return pending;}
  async function loadMarketData(start,end,render=true){
    const ticket=++S.seq;++S.renderSeq;$('atlasContent').setAttribute('aria-busy','true');
    try{
      const result=await AtlasData.request('/api/market',{start,end,window:S.window,mode:S.mode});if(ticket!==S.seq)return;
      S.market=result;
      S.asofSizes=industrySizesAt(end);S.marketDatasetKey=S.datasetKey;S.rotationMarket=null;S.cursor=result.dates.length-1;if(!result.dates.includes(S.rotationDate))S.rotationDate=result.dates.at(-1);S.history=null;S.historyKey=null;S.stock=null;S.ranges.clear();S.yRanges.clear();
      S.selected=S.compareTouched?new Set([...S.selected].filter(name=>result.sectors.some(s=>s.name===name))):allIndustrySelection();
      $('filterStart').value=start;$('filterEnd').value=end;updateSummary();notice('');if(render)await renderView();
    }catch(error){notice(error.message,true);}finally{if(ticket===S.seq)$('atlasContent').setAttribute('aria-busy','false');}
  }
  function industrySizesAt(date){
    const sizes=new Map();
    for(const stock of S.meta.stocks)if(stock.first<=date)sizes.set(stock.industry,(sizes.get(stock.industry)||0)+1);
    return sizes;
  }
  function defaultStructure(){return S.meta?.source_kind!=='public'||S.meta?.structure?.version===1;}
  function researchPeriod(start,end) {
    S.lockedDate='';S.afterwards=false;S.researchEnd=end;S.pointBrush=null;
    return loadMarket(start,end);
  }
  async function lockObservation(date,latest=false) {
    if(!S.market)return;
    const start=S.market.dates[0],end=S.researchEnd||S.market.dates.at(-1);
    if(!S.meta.dates.includes(date)||date<start||date>end){notice('请选择研究区间内的交易日。',true);updateControls();return;}
    S.lockedDate=latest?'':date;S.afterwards=false;S.rotationDate=date;S.pointBrush=null;
    if(S.market.dates.at(-1)!==date)await loadMarket(start,date);
    else await renderView();
    recordNavigation();
  }
  async function researchView(host,ticket,kind){
    const q=query(),key=JSON.stringify([S.datasetKey,q.start,q.end,q.mode]);
    if(S.structureCache?.key!==key)S.structureCache={key,promise:AtlasData.request('/api/structure',q)};
    let data;
    try{data=await S.structureCache.promise;}catch(error){if(S.structureCache?.key===key)S.structureCache=null;throw error;}
    if(ticket!==S.renderSeq)return;
    S.researchCleanup=AtlasResearch[kind](host,{state:S,data,graph,openIndustry,openStock,persist:scheduleNavigation});
  }
  function updateControls(){
    const obs=$('observationDate'),dates=S.market.dates;
    obs.min=dates[0];obs.max=S.researchEnd||dates.at(-1);obs.value=dates.at(-1);
    $('observationPrev').disabled=dates.length<=1;$('observationNext').disabled=obs.value>=obs.max;
    $('observationLatest').disabled=!S.lockedDate;$('filterEnd').value=obs.max;
    const heat=S.view==='market'&&S.display==='heat',fixed=(S.view==='market'&&S.display==='structure')||(S.view==='industry'&&S.industryDisplay==='structure')||S.view==='stock'||S.view==='industry'&&S.industryDisplay==='heat'||S.view==='market'&&['rotation','state'].includes(S.display);
    $('atlasMetricControl').hidden=fixed;
    const keys=heat?['relative','momentum','breadth']:S.view==='industry'?['path','momentum','relative','drawdown','vol']:Object.keys(titles);
    if(!heat&&!keys.includes(metric())){if(S.view==='industry')S.industryMetric='path';else S.metric='path';}
    $('atlasMetric').innerHTML=keys.map(k=>`<option value="${k}" ${metric()===k?'selected':''}>${titles[k]}</option>`).join('');
    $('atlasSummary').hidden=S.view!=='market';
  }
  async function renderView(){
    if(!S.market)return;stop();dispose();const ticket=++S.renderSeq;document.querySelector('.atlas-app').dataset.view=S.view;
    document.querySelectorAll('[data-atlas-view]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.atlasView===S.view));b.tabIndex=b.dataset.atlasView===S.view?0:-1;});
    $('atlasContent').setAttribute('aria-labelledby','atlasTab-'+S.view);updateControls();
    if(S.view==='market')await renderMarket(ticket);else if(S.view==='industry')await renderIndustry(ticket);else await renderStock(ticket);scheduleNavigation();
  }
  function compareButton(){const count=S.view==='industry'?S.stocks.size:S.selected.size;return`<button id="openComparison" class="compare-trigger">${S.view==='industry'?'成分对比':'行业对比'}<span>${S.view==='industry'?count+' / '+(S.history?.name===S.industry?S.history.stocks.length:'…'):count}</span></button>`;}
  function bindComparison(){const button=$('openComparison');if(button)button.addEventListener('click',()=>{stop();AtlasInspector.hide();$('compareSearch').value='';renderComparison();button.focus({preventScroll:true});$('atlasCompareDialog').showModal();});}
  function syncComparisonChecks(){const industry=S.view==='industry',selected=industry?S.stocks:S.selected;for(const input of $('compareRows').querySelectorAll('[data-pick]'))input.checked=selected.has(input.dataset.pick);$('compareCount').textContent=`已选 ${selected.size} 项 · ${S.view==='market'&&S.display==='rotation'?S.rotationDate:S.market.dates[S.cursor]}`;}
  function allIndustrySelection(){return new Set((S.market?.sectors||[]).filter(g=>g.series.price_count.some(n=>n>0)).map(g=>g.name));}
  function marketSeries(){
    const sectors=orderedSectors(S.market,S.metric).filter(s=>S.selected.has(s.name)).map(s=>({id:s.name,name:s.name,values:s.series[S.metric],...style(s.name),removable:true}));
    return S.metric==='relative'?sectors:[{id:'pool',name:'股票池等权',values:S.market.pool[S.metric],reference:true,color:'var(--plot-main)'},...sectors];
  }
  async function renderMarket(ticket){
    const modes={structure:'行业结构',lines:'走势',heat:'热力',rotation:'轮动',state:'状态'};
    $('atlasContent').innerHTML=`<section class="workspace-plot"><div class="workspace-viewbar"><nav class="plot-views" aria-label="市场图表">${Object.entries(modes).map(([key,label])=>`<button data-display="${key}" aria-pressed="${S.display===key}">${label}</button>`).join('')}</nav>${S.display==='structure'?'':compareButton()}</div><div id="marketChart"></div><p class="interaction-note">点曲线查值，点名称进入行业 · 双击复原 · 观察日由顶部选择</p></section>`;
    $('atlasContent').querySelectorAll('[data-display]').forEach(b=>b.addEventListener('click',()=>{if(!S.compareTouched)S.selected=allIndustrySelection();S.cursor=S.market.dates.length-1;S.display=b.dataset.display;renderView();}));bindComparison();
    if(S.display==='structure'){
      $('atlasContent').querySelector('.interaction-note').hidden=true;
      try{await researchView($('marketChart'),ticket,'market');}catch(e){if(ticket===S.renderSeq)notice(e.message,true);}
    }
    if(S.display==='lines')graph('marketChart',{dates:S.market.dates,series:marketSeries(),unit:unit(),label:titles[S.metric],zeroGuide:S.metric==='relative',log:S.scale==='log'&&S.metric==='path',onRemove:name=>toggleIndustry(name),onOpenSeries:openIndustry,linkFor:name=>routeURL('industry',name),openLabel:'进入行业'});
    if(S.display==='heat')renderHeat();if(S.display==='rotation')await renderRotation(ticket);if(S.display==='state')renderState();
  }
  function toggleIndustry(name){
    S.compareTouched=true;
    if(S.selected.has(name))S.selected.delete(name);else S.selected.add(name);
    if(S.display==='lines')S.charts[0]?.setSeries(marketSeries());
    if(S.display==='rotation')S.charts[0]?.setSelection(S.selected);
    const b=$('openComparison');if(b)b.querySelector('span').textContent=S.selected.size;
    if($('atlasCompareDialog').open)syncComparisonChecks();
  }
  function renderHeat(){
    const key=S.heatMetric,sectors=orderedSectors(S.market,key);
    const heat=new AtlasMaps.Heatmap($('marketChart'),{dates:S.market.dates,rows:sectors.map(s=>({name:s.name,values:s.series[key]})),metric:key,window:S.window,onInspect:(i,origin)=>observeDate(S.market.dates[i],origin),onOpenSeries:openIndustry,linkFor:name=>routeURL('industry',name),openLabel:'进入行业',inspectionRows:(i,row)=>{
      const hovered=sectors[row]?.name,names=new Set([hovered,...S.selected].filter(Boolean));
      return [...(key==='relative'?[]:[{name:'股票池等权',value:S.market.pool[key][i],unit:unit(key),color:'var(--plot-main)',reference:true}]),...orderedSectors(S.market,key).filter(s=>names.has(s.name)).map(({name})=>({id:name,name,canOpen:true,openLabel:'进入行业',value:S.market.sectors.find(s=>s.name===name).series[key][i],unit:unit(key),color:color(name)}))];
    }});heat.setIndex(S.cursor);S.charts.push(heat);
  }
  async function renderRotation(ticket){
    $('marketChart').innerHTML='<p class="plot-empty">正在计算行业轮动…</p>';$('openComparison').disabled=true;
    try{
      const data=await AtlasData.request('/api/market',{...query(),window:S.rotationWindow,mode:'dynamic'});
      if(ticket!==S.renderSeq||S.view!=='market'||S.display!=='rotation')return;S.rotationMarket=data;if(S.mode==='complete')notice('轮动回放按每日有效样本计算。');
      const map=new AtlasMaps.Scatter($('marketChart'),{dates:data.dates,rows:data.sectors.map(s=>({name:s.name,first:s.series.price_count.findIndex(n=>n>0),x:s.series.relative,y:s.series.acceleration,color:color(s.name)})),selected:S.selected,onOpenSeries:openIndustry,linkFor:name=>routeURL('industry',name),lookback:S.rotationWindow,onDate:date=>{S.rotationDate=date;const i=S.market.dates.indexOf(date);if(i>=0){S.cursor=i;updateSummary();}scheduleNavigation();},onWindow:n=>{S.rotationWindow=n;renderView();}});
      map.setIndex(Math.max(0,data.dates.indexOf(S.rotationDate)));S.charts.push(map);$('openComparison').disabled=false;
      const detail=document.createElement('details');detail.className='pair-study';detail.innerHTML='<summary>双行业联动与领先滞后</summary><div></div>';$('marketChart').append(detail);
      const pair=()=>{const end=data.dates.indexOf(S.rotationDate)+1;
        AtlasResearch.linkage(detail.lastElementChild,{pool:{ret:data.pool.ret.slice(0,end)},sectors:data.sectors.map(g=>({name:g.name,series:{ret:g.series.ret.slice(0,end),count:g.series.count.slice(0,end)}}))},S,scheduleNavigation);};
      detail.ontoggle=()=>{if(detail.open)pair();};
      const dateChanged=map.onDate;map.onDate=date=>{dateChanged(date);if(detail.open)pair();};
    }catch(error){notice(error.message,true);}
  }
  function renderState(){
    const groups=[{label:'参与面',unit:'%',domain:[0,100],metrics:[['站上MA20','breadth',palette[0]],['当日上涨','up',palette[1]],['上涨5日均值','up_smooth',palette[2]]]},{label:'20日年化波动',unit:'%',metrics:[['年化波动','vol',palette[3]]]},{label:'成交额',unit:'亿元',metrics:[['成交额','amount',palette[0]]]}];
    $('marketChart').innerHTML=`<div class="state-bundle"><div class="plot-toolbar"><div><span class="state-title">同日联动</span></div><div class="plot-actions">${AtlasAxisControls('time')}<button data-state-action="out" aria-label="缩小图表">−</button><button data-state-action="in" aria-label="放大图表">＋</button><button data-state-action="reset">复原</button><button data-state-action="expand">⛶ 全屏</button></div></div><div class="chart-readout"></div>${groups.map((_,i)=>`<div id="stateChart${i}"></div>`).join('')}</div>`;
    const allRows=i=>groups.flatMap(g=>g.metrics.map(([name,key,color])=>({id:key,name,value:S.market.pool[key][i],unit:g.unit,color})));
    const focusLinkedMetric=id=>{
      const target=S.charts.find(c=>c instanceof Chart&&c.series.some(s=>s.id===id));
      if(!target)return;
      for(const c of S.charts)if(c!==target){c.focus=null;c.pinned=null;c.inspectionActive=false;c.updateOverlay();c.updateValues();}
      target.focusSeries(id);
    };
    groups.forEach((g,i)=>graph('stateChart'+i,{dates:S.market.dates,series:g.metrics.map(([name,key,color])=>({id:key,name,values:S.market.pool[key],color})),unit:g.unit,domain:g.domain,label:g.label,compact:true,strictHit:true,hideDates:i<2,inspectionRows:allRows,onFocusSeries:focusLinkedMetric,readoutHost:$('marketChart').querySelector('.chart-readout')}));
    // Linked panels must share one time axis and one reset target even when Y labels
    // leave slightly different plot widths on the individual panels.
    const sharedWidth=Math.min(...S.charts.map(c=>c.plotXWidth??c.g.width));
    const sharedDefault=AtlasCharts.autoVisibleRange(S.market.dates.length,sharedWidth);
    for(const c of S.charts){c.resetView=[...sharedDefault];if(!S.ranges.has(rangeKey())&&c.dates.length>1)c.setRange(...sharedDefault);}
    $('marketChart').querySelector('.state-bundle .plot-actions').addEventListener('click',e=>{const mode=e.target.closest('[data-zoom-axis]');if(mode){AtlasApplyZoomAxis($('marketChart').firstElementChild,mode.dataset.zoomAxis);return;}const b=e.target.closest('[data-state-action]');if(!b)return;const action=b.dataset.stateAction,first=S.charts[0];if(action==='in'||action==='out'){const factor=action==='in'?1.7:1/1.7,axis=$('marketChart').querySelector('.state-bundle .zoom-modes [aria-pressed="true"]')?.dataset.zoomAxis||'both';if(axis!=='x')S.charts.slice(1).forEach(c=>c.zoomY(factor));first.zoom(factor,null,axis);}if(action==='reset')S.charts.forEach(c=>c.reset());if(action==='expand')AtlasFullscreen.open($('marketChart').firstElementChild,'同日联动');});
    S.stateTimeNav=new AtlasTimeNavigator($('marketChart').firstElementChild,{getRange:()=>S.charts[0]?.view||[0,S.market.dates.length-1],getLength:()=>S.market.dates.length,getDates:()=>S.market.dates,onChange:(a,b)=>S.charts[0]?.setRange(a,b,true)});
    if(matchMedia('(max-width:600px)').matches)requestAnimationFrame(()=>{const bundle=$('marketChart').firstElementChild;if(bundle&&bundle.getBoundingClientRect().height<innerHeight-60)window.scrollBy({top:bundle.getBoundingClientRect().top-54,behavior:'smooth'});});
  }
  function rememberStocks(all=S.history?.stocks.length>0&&S.stocks.size===S.history.stocks.length){
    if(S.industry)S.stockSelections.set(S.industry,{all:!!all,codes:[...S.stocks],initialized:true});
  }
  function prepareStocks(){
    const saved=S.stockSelections.get(S.industry),codes=S.history.stocks.map(s=>s.code),available=new Set(codes);
    // Older versions saved the initial empty selection indistinguishably from a manual clear.
    // Migrate that legacy empty state once; subsequently an explicit empty selection is retained.
    const legacyEmpty=saved&&!saved.initialized&&!saved.all&&!saved.codes?.length;
    S.stocks=new Set(!saved||legacyEmpty||saved.all?codes:(saved.codes||[]).filter(code=>available.has(code)));
    if(!saved||legacyEmpty)rememberStocks(true);
  }
  function industrySeries(selectedOnly=true,key=metric()){
    const sector=S.market.sectors.find(s=>s.name===S.industry);if(!sector)return [];
    const relative=key==='relative',poolMom=S.market.pool.momentum,sectorMom=sector.series.momentum;
    // Fixed relative strength: constituents vs this industry; industry vs stock pool.
    const diff=(values,base)=>values.map((v,i)=>finite(v)&&finite(base[i])?v-base[i]:null);
    const series=relative?
      [{id:'sector',name:'本行业等权 · 相对股票池',values:diff(sectorMom,poolMom),...style(S.industry),reference:true}]:
      [
        {id:'pool',name:'股票池等权',values:S.market.pool[key],color:'var(--plot-main)',dash:'5 4',reference:true},
        {id:'sector',name:'本行业等权',values:sector.series[key],...style(S.industry),reference:true}
      ];
    if(S.history){
      const source=relative?'momentum':key,last=S.market.dates.length-1;
      const value=stock=>{
        const v=stock.tracks[source]?.[last],base=sectorMom[last];
        return relative?(finite(v)&&finite(base)?v-base:null):v;
      };
      rankLatest(S.history.stocks,value).filter(s=>!selectedOnly||S.stocks.has(s.code))
        .forEach(stock=>series.push({
          id:stock.code,name:stock.name,detail:stock.code,
          values:relative?diff(stock.tracks.momentum,sectorMom):stock.tracks[key],
          ...S.stockStyles.get(stock.code),removable:true
        }));
    }
    return series;
  }
  function industryHeat(){
    const series=industrySeries(false,'relative'),stocks=series.filter(s=>!s.reference);
    const heat=new AtlasMaps.Heatmap($('industryChart'),{label:S.industry+' · 全部成分股强弱热力',rowType:'股票',dates:S.market.dates,rows:stocks.map(s=>({id:s.id,name:s.name,detail:s.detail,values:s.values})),metric:'relative',window:S.window,onOpenSeries:openStock,linkFor:code=>routeURL('stock',code),openLabel:'查看日线',onInspect:(i,origin)=>observeDate(S.market.dates[i],origin),inspectionRows:(i,row)=>{
      const hovered=stocks[row]?.id;
      return series.filter(s=>s.reference||S.stocks.has(s.id)||s.id===hovered).map(s=>({id:s.id,name:s.name,detail:s.detail,value:s.values[i],color:s.color,dash:s.dash,reference:!!s.reference,unit:'个百分点',canOpen:!s.reference,openLabel:'查看日线'}));
    }});heat.setIndex(S.cursor);S.charts.push(heat);
  }
  async function renderIndustry(ticket){
    $('atlasContent').innerHTML=`<section class="workspace-plot"><div class="workspace-viewbar"><label class="industry-picker"><span class="sr-only">研究行业</span><select id="industrySelect"><option value="">选择研究行业</option>${orderedSectors().map(s=>`<option value="${esc(s.name)}" ${s.name===S.industry?'selected':''}>${esc(s.name)} · ${S.asofSizes.get(s.name)||0}只</option>`).join('')}</select></label>${S.industryDisplay==='structure'?'':compareButton()}</div><div class="industry-viewbar"><nav class="plot-views" aria-label="成分股视图"><button type="button" data-atlas-back aria-label="返回上一步" title="返回上一步">←</button><a class="industry-return" data-route-view="market" href="${esc(routeURL('market'))}">市场</a><button data-industry-display="structure" aria-pressed="${S.industryDisplay==='structure'}">内部结构</button><button data-industry-display="lines" aria-pressed="${S.industryDisplay==='lines'}">走势</button><button data-industry-display="heat" aria-pressed="${S.industryDisplay==='heat'}">热力</button></nav></div><p id="industryCoverage" class="coverage-note" hidden></p><div id="industryChart" class="plot-empty">${S.industry?'正在读取全部成分股…':'选择行业，或从市场图的行业名称进入。'}</div>${S.industryDisplay==='lines'?'<p class="interaction-note">点股票曲线查值，点名称查看日线 · 双击复原 · 观察日由顶部选择</p>':''}</section>`;
    if($('openComparison'))$('openComparison').disabled=true;
    $('industrySelect').addEventListener('change',()=>openIndustry($('industrySelect').value));bindComparison();
    $('atlasContent').querySelectorAll('[data-industry-display]').forEach(b=>b.addEventListener('click',()=>{S.industryDisplay=b.dataset.industryDisplay;renderView();}));
    if(!S.industry)return;
    if(!S.asofSizes.has(S.industry)){$('industryChart').textContent='该观察日尚无本行业行情。';return;}
    if(S.industryDisplay==='structure'){
      const host=$('industryChart');host.classList.remove('plot-empty');host.textContent='';
      try{await researchView(host,ticket,'industry');}catch(e){if(ticket===S.renderSeq)notice(e.message,true);}
      return;
    }
    const key=JSON.stringify({...query(),name:S.industry});
    try{
      let history=S.history;
      if(S.historyKey!==key){
        if(S.pendingHistoryKey!==key){S.pendingHistoryKey=key;S.pendingHistory=AtlasData.request('/api/industry-history',{...query(),name:S.industry});}
        history=await S.pendingHistory;
      }
      if(ticket!==S.renderSeq||S.view!=='industry')return;
      S.history={...history,stocks:history.stocks.filter(stock=>stock.first<=S.market.dates.at(-1))};S.historyKey=key;prepareStocks();
      $('industryChart').classList.remove('plot-empty');$('openComparison').disabled=false;updateStockCount();
      if(S.industryDisplay==='heat')industryHeat();
      else graph('industryChart',{dates:S.market.dates,series:industrySeries(),unit:unit(),label:S.industry+' · '+titles[metric()],zeroGuide:metric()!=='vol',log:S.scale==='log'&&metric()==='path',onRemove:toggleStock,onOpenSeries:openStock,linkFor:code=>routeURL('stock',code),openLabel:'查看日线'});
    }catch(error){if(S.pendingHistoryKey===key){S.pendingHistoryKey=null;S.pendingHistory=null;}if(ticket===S.renderSeq)notice(error.message,true);}
  }
  function updateStockCount(){
    const total=S.history?.stocks.length||0,b=$('openComparison');if(b)b.querySelector('span').textContent=S.stocks.size+' / '+total;
    const note=$('industryCoverage');if(note){note.hidden=!!total;note.textContent=total?'':'当前样本口径没有成分股，请调整研究区间或切换每日有效样本。';}
  }
  function toggleStock(code){if(S.stocks.has(code))S.stocks.delete(code);else S.stocks.add(code);rememberStocks();updateSelection();}
  function renderComparison(){
    const q=$('compareSearch').value.trim().toLowerCase(),rotation=S.view==='market'&&S.display==='rotation',data=rotation&&S.rotationMarket?S.rotationMarket:S.market,date=rotation?S.rotationDate:S.market.dates[S.cursor],i=Math.max(0,data.dates.indexOf(date)),industry=S.view==='industry';$('compareTitle').textContent=industry?'选择成分股对比':'选择行业对比';
    const sizes=date===S.market.dates.at(-1)?S.asofSizes:industrySizesAt(date);
    let rows;
    if(industry)rows=industrySeries(false).filter(s=>!s.reference).filter(s=>!q||s.name.toLowerCase().includes(q)||s.id.toLowerCase().includes(q)).map(s=>({id:s.id,name:s.name,detail:s.detail,value:s.values[i],checked:S.stocks.has(s.id),color:s.color}));
    else rows=rankLatest(data.sectors.filter(g=>g.series.price_count.slice(0,i+1).some(n=>n>0)),g=>g.series[metric()][rotation?i:data.dates.length-1]).filter(s=>!q||s.name.toLowerCase().includes(q)).map(s=>({id:s.name,name:s.name,detail:`有效 ${s.series.count[i]??0} / 截至读数日 ${sizes.get(s.name)||0}`,value:s.series[metric()][i],checked:S.selected.has(s.name),color:color(s.name)}));
    $('compareRows').innerHTML=rows.map(r=>`<div class="comparison-row"><label><input type="checkbox" data-pick="${esc(r.id)}" ${r.checked?'checked':''}><i style="background:${r.color}"></i><span>${esc(r.name)}<small>${esc(r.detail)}</small></span></label><span class="comparison-number">${num(r.value)}<small>${unit()}</small></span><button data-research="${esc(r.id)}">${industry?'日线':'研究'} ↗</button></div>`).join('')||'<p class="plot-empty">没有匹配结果。</p>';
    $('compareOrder').textContent=`按观察日 ${rotation?date:data.dates.at(-1)} ${titles[metric()]}降序 · 读数 ${data.dates[i]}`;
    $('compareCount').textContent=`已选 ${industry?S.stocks.size:S.selected.size} 项 · ${data.dates[i]}`;
    $('compareRows').querySelectorAll('[data-pick]').forEach(input=>input.addEventListener('change',()=>industry?toggleStock(input.dataset.pick):toggleIndustry(input.dataset.pick)));
    $('compareRows').querySelectorAll('[data-research]').forEach(b=>b.addEventListener('click',()=>{$('atlasCompareDialog').close();if(industry)openStock(b.dataset.research);else openIndustry(b.dataset.research);}));
  }
  async function renderStock(ticket){
    const info=S.meta.stocks.find(s=>s.code===S.code&&s.first<=S.market.dates.at(-1));
    $('atlasContent').innerHTML=drillPath()+`<section class="workspace-plot"><div class="stock-workspace-head"><label class="stock-search"><span class="sr-only">查找股票</span><input id="atlasStockSearch" type="search" placeholder="输入股票名称或代码" autocomplete="off"></label><div id="stockSearchResults" class="stock-search-results" hidden></div></div><div class="stock-identity">${info?`<h2>${esc(info.name)}</h2><span>${info.code} · ${esc(info.industry)}</span>`:''}</div><div id="stockPriceChart" class="${info?'':'plot-empty'}">${info?'正在读取日线…':'搜索并选择股票，查看日线、均线与成交量。'}</div>${info?'<div id="stockRelative"></div><label class="afterwards"><input id="afterwards" type="checkbox"> 事后对照：显示距今涨幅</label>':''}</section>`;
    $('atlasStockSearch').addEventListener('input',searchStocks);if(!info){if(S.code)$('stockPriceChart').textContent='该观察日尚无此股行情。';return;}
    try{
      $('afterwards').checked=S.afterwards;$('afterwards').onchange=e=>{S.afterwards=e.target.checked;renderView();};
      const q={...query(),code:S.code},latestDate=S.meta.dates.at(-1);
      const stock=await AtlasData.request('/api/stock',q);if(ticket!==S.renderSeq||S.view!=='stock')return;
      // The latest data-source date is independent of a historical research interval.
      let latestClose=stock.dates.at(-1)===latestDate?stock.close.at(-1):null;
      if(S.afterwards&&stock.dates.at(-1)!==latestDate){
        try{const latest=await AtlasData.request('/api/stock',{...q,start:latestDate,end:latestDate});latestClose=latest.dates.at(-1)===latestDate?latest.close.at(-1):null;}
        catch(error){console.warn('Latest stock close unavailable',error);}
      }
      if(ticket!==S.renderSeq||S.view!=='stock')return;S.stock=stock;
      const series=[{id:'price',name:'收盘价',values:stock.close,reference:true,color:'var(--plot-main)'},...['ma5','ma10','ma20'].map((key,i)=>({id:key,name:key.toUpperCase(),values:stock[key],color:[palette[0],palette[1],palette[3]][i]}))];
      const chart=graph('stockPriceChart',{dates:stock.dates,series,stock,afterwards:S.afterwards,latestClose,latestDate,unit:'元',kind:'candles',label:info.name+'日线'});
      const selectedDate=S.market.dates[S.cursor],stockIndex=Math.max(0,stock.dates.findLastIndex(date=>date<=selectedDate));
      // Historical inspection changes the readout date, not the full opening window.
      chart.setIndex(stockIndex);
      const sector=S.market.sectors.find(g=>g.name===info.industry)?.series.path||[],pool=S.market.pool.path;
      const delta=(a,b)=>a.map((v,i)=>finite(v)&&finite(b[i])?v-b[i]:null);
      const comparisons=[{id:'stock-industry',name:'个股 − 行业',values:delta(stock.path,sector),color:palette[0]},{id:'industry-pool',name:'行业 − 股票池',values:delta(sector,pool),color:palette[1]}];
      const relative=graph('stockRelative',{dates:stock.dates,series:comparisons,unit:'个百分点',label:'自区间首日收盘 · 相对表现',zeroGuide:true,
        inspectionRows:i=>[...comparisons.map(c=>({...c,value:c.values[i],unit:'个百分点'})),...[[info.name,stock.path],['行业等权',sector],['股票池等权',pool]].map(([name,values])=>({name,value:values[i],unit:'%'}))]});
      relative.resetView=[...chart.resetView];relative.setRange(...chart.view);relative.setIndex(stockIndex);
    }catch(error){notice(error.message,true);}
  }
  function searchStocks(){
    const q=$('atlasStockSearch').value.trim().toLowerCase(),target=$('stockSearchResults');target.hidden=!q;if(!q)return;
    const matches=S.meta.stocks.filter(s=>s.first<=S.market.dates.at(-1)&&(s.name.toLowerCase().includes(q)||s.code.toLowerCase().includes(q)));
    target.innerHTML=(matches.length>20?`<p class="stock-search-hint">共${matches.length}只，显示前20项；继续输入名称或代码可缩小范围。</p>`:'')+matches.slice(0,20).map(s=>`<button data-code="${s.code}"><span>${esc(s.name)}</span><small>${s.code}</small></button>`).join('')||'<p>没有匹配结果。</p>';
    target.querySelectorAll('[data-code]').forEach(b=>b.addEventListener('click',()=>openStock(b.dataset.code)));
  }
  function showData(){stop();AtlasInspector.hide();$('dataResult').textContent='';$('openAtlasData').focus({preventScroll:true});$('atlasDataDialog').showModal();}
  async function dataOperation(action){if(S.busy)return;S.busy=true;stop();document.querySelectorAll('[data-data-action]').forEach(b=>b.disabled=true);try{await action();}catch(error){$('dataResult').textContent=error.message;}finally{S.busy=false;$('atlasPublishToken').value='';document.querySelectorAll('[data-data-action]').forEach(b=>b.disabled=false);}}
  async function importData(){
    if(!S.files.length){$('dataResult').textContent='请先选择CSV。';return;}const token=$('atlasPublishToken').value.trim();if(S.dataMode==='publish'&&!token){$('atlasPublishToken').reportValidity();return;}
    await dataOperation(async()=>{
      await AtlasData.importFiles(S.files,S.kind,p=>$('dataResult').textContent=p.message);await initialize();
      if(S.dataMode==='publish'){const snapshot=await AtlasData.snapshot(),result=await publishAtlasSnapshot({token,snapshot,progress:t=>$('dataResult').textContent=t});$('dataResult').textContent=result.unchanged?'数据与网站一致，无需重复发布。':'数据已提交，部署成功后访客可见。';const link=document.createElement('a');link.href='https://github.com/haodayizhia/haodayizhia.github.io/actions/workflows/deploy.yml';link.target='_blank';link.rel='noopener';link.textContent=' 查看部署进度 ↗';$('dataResult').append(link);}else $('dataResult').textContent='已导入，仅当前浏览器可见；公开网站未改变。';
    });
  }
  const tabs=[...document.querySelectorAll('[data-atlas-view]')];tabs.forEach(b=>{b.id='atlasTab-'+b.dataset.atlasView;b.addEventListener('click',()=>{goView(b.dataset.atlasView);});});
  document.querySelector('.atlas-view-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();let i=tabs.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[i].focus();tabs[i].click();});
  $('atlasPeriod').addEventListener('change',()=>{if(!S.meta)return;stop();AtlasInspector.hide();const v=$('atlasPeriod').value;if(v==='custom'){$('atlasFilterDialog').showModal();return;}const dates=S.meta.dates;researchPeriod(dates[v==='all'?0:Math.max(0,dates.length-Number(v))],dates.at(-1));});
  $('observationDate').onchange=e=>lockObservation(e.target.value);
  for(const [id,delta] of [['observationPrev',-1],['observationNext',1]])$(id).onclick=()=>{
    const d=S.meta.dates[S.meta.dates.indexOf(S.market.dates.at(-1))+delta];if(d)lockObservation(d);
  };
  $('observationLatest').onclick=()=>lockObservation(S.researchEnd,true);
  $('atlasMetric').addEventListener('change',()=>{if(S.view==='market'&&S.display==='heat')S.heatMetric=$('atlasMetric').value;else if(S.view==='industry')S.industryMetric=$('atlasMetric').value;else S.metric=$('atlasMetric').value;renderView();});
  $('openAtlasFilters').addEventListener('click',()=>{stop();AtlasInspector.hide();$('openAtlasFilters').focus({preventScroll:true});$('atlasFilterDialog').showModal();});
  $('atlasFilterForm').addEventListener('submit',e=>{e.preventDefault();const dates=S.meta.dates.filter(d=>d>=$('filterStart').value&&d<=$('filterEnd').value);if(!dates.length){$('filterError').textContent='请选择含交易日的有效区间。';return;}S.window=Number($('filterWindow').value);S.mode=$('filterCohort').value;S.scale=$('filterScale').value;$('atlasPeriod').value='custom';$('atlasFilterDialog').close();researchPeriod(dates[0],dates.at(-1));});
  function updateSelection(){
    if(S.view==='industry'){rememberStocks();if(S.industryDisplay==='heat')S.charts[0]?.setIndex(S.cursor);else S.charts[0]?.setSeries(industrySeries());updateStockCount();}
    else if(S.display==='lines')S.charts[0]?.setSeries(marketSeries());
    else if(S.display==='rotation')S.charts[0]?.setSelection(S.selected);
    scheduleNavigation();$('openComparison').querySelector('span').textContent=S.view==='industry'?S.stocks.size+' / '+(S.history?.stocks.length||0):S.selected.size;syncComparisonChecks();
  }
  $('compareSearch').addEventListener('input',renderComparison);
  $('clearComparison').addEventListener('click',()=>{(S.view==='industry'?S.stocks:S.selected).clear();if(S.view==='market')S.compareTouched=true;updateSelection();});
  $('selectAllComparison').addEventListener('click',()=>{if(S.view==='industry')S.stocks=new Set((S.history?.stocks||[]).map(s=>s.code));else {S.compareTouched=true;S.selected=new Set(S.market.sectors.filter(g=>g.series.price_count.some(n=>n>0)).map(s=>s.name));}updateSelection();});
  $('openAtlasData').addEventListener('click',showData);document.querySelectorAll('[data-data-mode]').forEach(b=>b.addEventListener('click',()=>{S.dataMode=b.dataset.dataMode;document.querySelectorAll('[data-data-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('publishAuth').hidden=S.dataMode!=='publish';$('atlasImportSubmit').textContent=S.dataMode==='publish'?'校验并公开发布':'导入查看';}));
  for(const [button,input,kind] of [['pickAtlasMerged','atlasMergedFile','merged'],['pickAtlasFolder','atlasFolderFiles','directory']]){$(button).addEventListener('click',()=>$(input).click());$(input).addEventListener('change',e=>{S.files=[...e.target.files].filter(f=>/\.csv$/i.test(f.name));S.kind=kind;$('selectedDataFiles').textContent=`已选 ${S.files.length} 个CSV · ${num(S.files.reduce((n,f)=>n+f.size,0)/1024**2,1)} MB`;});}
  $('atlasImportSubmit').addEventListener('click',importData);$('restoreAtlasPublic').addEventListener('click',()=>dataOperation(async()=>{await AtlasData.request('/api/reload');await initialize();$('dataResult').textContent='已恢复公开数据。';}));
  document.querySelectorAll('[data-close-atlas]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.closeAtlas).close()));document.querySelectorAll('dialog').forEach(AtlasDialogDismiss);$('atlasDataDialog').addEventListener('close',()=>$('atlasPublishToken').value='');
  document.addEventListener('pointerdown',e=>{const r=$('stockSearchResults');if(r&&!e.target.closest('.stock-workspace-head'))r.hidden=true;});
  $('atlasContent').addEventListener('click',e=>{
    const back=e.target.closest('[data-atlas-back]');if(back){recordNavigation();history.length>1?history.back():goView('market');return;}
    const industry=e.target.closest('[data-route-industry]'),view=e.target.closest('[data-route-view]');
    if((industry||view)&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();industry?goParent('industry',industry.dataset.routeIndustry):goParent(view.dataset.routeView);}
  });
  const atlasApp=document.querySelector('.atlas-app');atlasApp.addEventListener('scroll',scheduleNavigation,{capture:true,passive:true});atlasApp.addEventListener('wheel',scheduleNavigation,{passive:true});atlasApp.addEventListener('change',scheduleNavigation);atlasApp.addEventListener('pointerup',scheduleNavigation);atlasApp.addEventListener('touchend',scheduleNavigation,{passive:true});
  window.addEventListener('popstate',e=>{clearTimeout(historyTimer);const saved=savedNavigation(e.state);if(saved)restoreNavigation(saved).catch(error=>notice(error.message,true));else{const route=parseRoute();if(route.view==='industry'){S.industryDisplay='structure';S.industryMetric='path';}applyRoute(route.view,route.id);renderView().then(recordNavigation);}});
  window.addEventListener('bro:themechange',()=>{S.charts.forEach(c=>c.draw());if(S.view==='market'&&S.display==='structure'&&S.market)renderView();});window.addEventListener('pagehide',()=>{clearTimeout(historyTimer);recordNavigation();$('atlasPublishToken').value='';stop();});
  window.AtlasWorkspace={state:S,initialize,renderView,observeDate,toggleIndustry,openIndustry,openStock,goView};
  initialize().catch(error=>{if(S.busy||S.market)return;notice(error.message,true);$('atlasContent').innerHTML='<p class="plot-empty">暂未加载公开数据，可通过“数据”重试或导入本地CSV。</p>';});
})();
