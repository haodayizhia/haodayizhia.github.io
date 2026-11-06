'use strict';

class IndustryPane {
 constructor(name){
  this.name=name;this.uid=String(++state.paneCounter);this.history=null;this.inspection=null;this.disposed=false;this.token=0;this.inViewport=true;
  this.el=document.createElement('article');this.el.className='industry-pane';this.el.dataset.industry=name;this.el.id='industry-pane-'+this.uid;
  this.el.innerHTML=`
   <header class="industry-pane-heading"><div><h2>${esc(name)}</h2><span data-part="stats">读取完整行业历史…</span></div><div class="pane-actions"><label class="pane-metric"><span class="sr-only">视图</span><select data-part="metric" aria-label="行业内部共同指标"><option value="path">累计涨幅</option><option value="momentum">窗口收益</option><option value="relative">相对强弱</option><option value="heat">强弱时间图</option><option value="drawdown">数据内回撤</option><option value="vol">20日年化波动</option></select></label><label class="stock-benchmark"><span class="sr-only">比较基准</span><select data-part="benchmark" aria-label="相对强弱比较基准"><option value="sector">相对本行业</option><option value="pool">相对股票池</option></select></label><button class="expand" data-expand-industry="${esc(name)}" aria-label="展开${esc(name)}图">⤢</button><button class="pane-close" data-close-industry="${esc(name)}" aria-label="关闭${esc(name)}行业图">×</button></div></header>
   <div class="pane-context"><div class="focus-strip" data-part="pins"></div><span class="hover-value" data-part="hover">全部成分股曲线均保留</span></div>
   <div class="plot-and-index"><div class="plot-column"><div class="plot stock-plot" id="stockPlot-${this.uid}" data-industry="${esc(name)}"><canvas aria-label="${esc(name)}全部个股、行业及股票池基准"></canvas><div class="plot-tooltip" hidden></div></div><div class="plot-caption"><button class="baseline-lock" data-lock-series="__pool" aria-pressed="false"><i class="baseline-swatch"></i>股票池等权</button><button class="baseline-lock" data-lock-series="__sector" aria-pressed="false"><i class="sector-swatch"></i>行业等权</button><span data-part="viewNote"></span></div></div>
    <aside class="name-index"><div class="index-search"><input data-part="search" placeholder="定位名称或代码" aria-label="定位${esc(name)}行业股票"><span data-part="matches"></span></div><div class="index-head"><span>单击名称固定关注</span><span>区间收益</span></div><div class="name-list" data-part="list"></div><div class="index-foot" data-part="note"></div></aside>
   </div><div class="stock-heat" data-part="heat" hidden><div class="stock-heat-legend"><span data-part="heatLegend"></span><i></i><span>落后 / 领先（百分点）</span><span data-part="heatRange"></span></div><div class="stock-heat-scroll"><div class="stock-heat-body"><canvas></canvas></div></div><div class="plot-tooltip" hidden></div></div><div class="stock-inspection" data-part="inspection" hidden aria-live="polite"></div>`;
  $('stockGrid').append(this.el);this.el.querySelector('.plot-column').append(this.part('heat'));this.chart=new PathPlot('stockPlot-'+this.uid,'stock',this);this.heat=new StockHeat(this);
  const prefs=state.panePrefs.get(name);this.part('search').value=prefs?.search||'';this.inspection=prefs?.inspection||null;this.savedView=prefs?.view||null;this.savedKey=prefs?.key||null;this.savedLocked=prefs?.locked||null;
  this.part('search').addEventListener('input',()=>{this.renderList();this.heat.locate(this.part('search').value);saveSoon();});this.part('metric').value=state.stockMetric;this.part('metric').addEventListener('change',()=>{const value=this.part('metric').value;state.stockView=value==='heat'?'heat':'lines';setStockMetric(value==='heat'?'relative':value);});
  this.part('benchmark').addEventListener('change',()=>{state.stockBenchmark=this.part('benchmark').value;state.domainRevision++;for(const pane of state.panes.values()){pane.setSeries();pane.renderFrame();}schedule();saveSoon();});
  this.part('list').addEventListener('pointerover',event=>{const row=event.target.closest('.name-row');if(row)setHover('stock',row.dataset.rowId,null,'list',this.name);});
  this.part('list').addEventListener('pointerleave',()=>setHover('stock',null,null,'list',this.name));
  this.part('list').addEventListener('dblclick',event=>{const row=event.target.closest('.name-row');if(row)stockDetail.open(row.dataset.rowId);});
  this.el.addEventListener('click',event=>{const inspect=event.target.closest('[data-inspect-code]');if(inspect){this.inspection=inspect.dataset.inspectCode;stockDetail.open(inspect.dataset.inspectCode);}if(event.target.closest('[data-close-inspection]')){this.inspection=null;this.part('inspection').hidden=true;}});
  this.intersection=new IntersectionObserver(entries=>{this.inViewport=entries[0].isIntersecting;if(this.inViewport&&state.lowerMode==='stocks'&&this.history){if(state.stockView==='heat')this.heat.resize();else this.chart.draw();}},{rootMargin:'100px'});this.intersection.observe(this.el);
 }
 part(name){return this.el.querySelector(`[data-part="${name}"]`);}
 chartKey(){const q=query();return JSON.stringify([state.meta.source,q.start,q.end,this.name]);}
 async load(){
  const token=++this.token;this.part('stats').textContent='读取完整行业历史…';this.el.classList.add('is-loading');
  try{
   const key=JSON.stringify({...query(),name:this.name});let pending=state.historyCache.get(key);
   if(!pending){pending=api('/api/industry-history',{...query(),name:this.name});state.historyCache.set(key,pending);}
   const history=await pending;
   if(this.disposed||token!==this.token||state.panes.get(this.name)!==this)return;
   this.history=history;state.domainRevision++;
   this.setSeries();if(this.savedLocked&&this.chart.series.some(s=>s.id===this.savedLocked))this.chart.lockedId=this.savedLocked;this.savedLocked=null;
   if(this.savedView&&this.savedKey===this.chart.key)this.chart.view=[...this.savedView];this.savedView=null;
   this.renderList();this.renderPins();this.renderFrame();this.chart.updateViewNote();refreshPaneHeader();schedule();
  }catch(error){if(!this.disposed&&token===this.token){this.part('stats').textContent='读取失败：'+error.message;fail(this.name+'：'+error.message);}}
  finally{if(token===this.token)this.el.classList.remove('is-loading');}
 }
 setSeries(){
  if(!this.history)return;const metric=state.stockMetric,m=state.market,parent=sector(this.name);
  const base=this.benchmark().momentum,values=(tracks)=>metric==='relative'?excessTrack(tracks.momentum,base):tracks[metric];
  this.chart.set([{id:'__pool',name:'股票池等权',short:'股票池等权',values:metric==='relative'?excessTrack(m.pool.momentum,base):m.pool[metric],color:atlasColor('#e9edf4'),reference:true,dashed:true},{id:'__sector',name:this.name+' · 行业等权',short:'行业等权',values:metric==='relative'?excessTrack(parent.series.momentum,base):parent.series[metric],color:atlasColor('#e7c189'),reference:true},...this.history.stocks.map(stock=>({id:stock.code,name:stock.name,values:values(stock.tracks),color:stockColor(stock.code)}))],this.chartKey());
  this.part('metric').value=state.stockView==='heat'?'heat':metric;this.part('list').previousElementSibling.lastElementChild.textContent=metricTitles[metric];
  this.part('benchmark').value=state.stockBenchmark;this.part('benchmark').closest('label').hidden=metric!=='relative';
  this.el.querySelector('.stock-plot').hidden=state.stockView==='heat';this.el.querySelector('.plot-caption').hidden=state.stockView==='heat';this.part('heat').hidden=state.stockView!=='heat';
  const limit=strengthColorLimit(m.window);this.part('heatLegend').textContent=`−${limit} / +${limit}`;
  updateWindowLabels();this.heat.set();this.chart.resize();
 }
 benchmark(){return state.stockBenchmark==='pool'?state.market.pool:sector(this.name).series;}
 value(stock,i){const metric=state.stockMetric,t=stock.tracks;return metric==='relative'?excessValue(t.momentum[i],this.benchmark().momentum[i]):t[metric][i];}
 orderedStocks(){
  if(!this.history)return [];
  const key=JSON.stringify([state.cursor,state.stockMetric,state.stockBenchmark]);
  if(this.orderCache?.history!==this.history||this.orderCache.key!==key)this.orderCache={history:this.history,key,stocks:rankStocks(this.history.stocks,stock=>this.value(stock,state.cursor))};
  return this.orderCache.stocks;
 }
 syncListOrder(){
  const list=this.part('list'),rows=new Map([...list.children].map(row=>[row.dataset.rowId,row])),ordered=this.orderedStocks().filter(stock=>rows.has(stock.code)),key=ordered.map(stock=>stock.code).join('|');
  if(this.listOrderKey!==key){const top=list.scrollTop,fragment=document.createDocumentFragment();for(const stock of ordered)fragment.append(rows.get(stock.code));list.append(fragment);list.scrollTop=top;this.listOrderKey=key;}
  const heading=list.previousElementSibling;heading.firstElementChild.textContent=state.stockMetric==='vol'?'指标 ↓':'强 → 弱';heading.title=`按${state.market.dates[state.cursor]}的${metricAxisTitle(state.stockMetric,'stock')}降序，缺失值在末尾`;
 }
 reload(){this.history=null;this.chart.set([],this.chartKey());this.part('list').replaceChildren();this.part('inspection').hidden=true;this.ready=this.load();return this.ready;}
 renderList(){
  if(!this.history)return;const search=this.part('search').value.trim().toLowerCase();
  const rows=this.orderedStocks().filter(stock=>!search||stock.name.toLowerCase().includes(search)||stock.code.toLowerCase().includes(search));
  this.part('matches').textContent=rows.length+'/'+this.history.stocks.length;
  this.part('list').innerHTML=rows.map(stock=>`<div class="name-row" data-row-id="${stock.code}"><button class="name-button" data-pin-kind="stock" data-pin-id="${stock.code}" data-industry="${esc(this.name)}" aria-pressed="false"><i class="series-swatch" style="--line-color:${stockColor(stock.code)}"></i><span class="name-text">${esc(stock.name)}<small>${stock.code}</small></span></button><span class="name-return" data-return-code="${stock.code}"></span><button class="drill-button" data-inspect-code="${stock.code}" aria-label="打开${esc(stock.name)}量价图" title="打开量价图">↗</button></div>`).join('');
  const missing=state.stockMetric==='path'?this.history.stocks.filter(stock=>!finite(stock.tracks.path[0])).length:0;this.part('note').textContent=missing?`${missing}只缺少区间起点；名称保留，不制造收益路径。`:'';this.renderFrame();this.rowStates();
 }
 renderFrame(){
  if(!this.history)return;const i=state.cursor,n=this.history.stocks.length,valid=this.history.stocks.filter(stock=>stock.tracks[state.stockMetric==='relative'?'momentum':state.stockMetric].slice(0,i+1).some(finite)).length;
  this.syncListOrder();this.heat.sort();
  this.part('stats').textContent=valid===n?`${n}只`:`${valid} / ${n}条有效轨迹`;this.part('stats').title=`${state.market.dates[i]} · 当日收益有效${fmt(sector(this.name).series.count[i],0)}只 / 池内${sector(this.name).size}只`;
  const stocks=new Map(this.history.stocks.map(stock=>[stock.code,stock]));
  this.part('list').querySelectorAll('[data-return-code]').forEach(cell=>{const stock=stocks.get(cell.dataset.returnCode),value=stock?this.value(stock,i):null;cell.textContent=metricValue(value,state.stockMetric);cell.className='name-return '+sign(value);});
  this.updateHover();this.chart.updateViewNote();
 }
 renderPins(){
  const pins=stockPins(this.name),target=this.part('pins');
  if(!pins.size){target.innerHTML='';return;}
  target.innerHTML='<span class="focus-label">固定关注</span>'+[...pins].map(code=>{const stock=this.history?.stocks.find(s=>s.code===code);return`<span class="pin-chip" style="--line-color:${stockColor(code)}"><i></i>${esc(stock?.name||code)}<button data-unpin-kind="stock" data-unpin-id="${code}" data-industry="${esc(this.name)}" aria-label="取消关注${esc(stock?.name||code)}">×</button></span>`;}).join('')+`<button class="clear-focus" data-clear-pins="stock" data-industry="${esc(this.name)}">清空关注</button>`;
 }
 rowStates(){const pins=stockPins(this.name),hover=hoveredId('stock',this.name);this.part('list').querySelectorAll('.name-row').forEach(row=>{row.classList.toggle('is-pinned',pins.has(row.dataset.rowId));row.classList.toggle('is-hover',hover===row.dataset.rowId);row.querySelector('.name-button').setAttribute('aria-pressed',String(pins.has(row.dataset.rowId)));});}
 updateHover(){const code=hoveredId('stock',this.name),stock=code?this.history?.stocks.find(s=>s.code===code):null,index=state.hoverDate??state.cursor;this.part('hover').textContent=stock?`${state.market.dates[index]} · ${stock.name} ${metricValue(this.value(stock,index),state.stockMetric)}`:'';}
 inspect(code){this.inspection=code;stockDetail.open(code);}

 preferences(){return{search:this.part('search').value,inspection:this.inspection,view:this.chart.view?[...this.chart.view]:null,key:this.chart.key,locked:this.chart.lockedId};}
 dispose(){this.disposed=true;this.token++;this.resizeObserver?.disconnect();this.intersection.disconnect();this.chart.dispose();this.heat.dispose();this.el.remove();}
}
