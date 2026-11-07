'use strict';
(()=>{
  const {Chart,escape:esc,number:num,finite}=AtlasCharts,$=id=>document.getElementById(id);
  const S={meta:null,market:null,view:'market',display:'lines',metric:'path',heatMetric:'relative',window:1,mode:'dynamic',scale:'linear',cursor:0,industry:'',code:'',selected:new Set(),stocks:new Set(),charts:[],history:null,stock:null,stockSpan:60,stockMode:'candles',seq:0,renderSeq:0,ranges:new Map(),busy:false,files:[],kind:'merged',dataMode:'preview',timer:null};
  const palette=['var(--plot-blue)','var(--plot-gold)','var(--plot-teal)','var(--plot-purple)','var(--plot-red)','var(--plot-slate)'];
  const titles={path:'累计收益',momentum:'窗口收益',relative:'相对强弱',breadth:'MA20广度',drawdown:'峰值回撤',vol:'年化波动',dispersion:'个股分化'};
  const metric=()=>S.view==='market'&&S.display==='heat'?S.heatMetric:S.metric;
  const unit=key=>['relative','dispersion'].includes(key||metric())?'个百分点':'%';
  const color=name=>palette[Math.max(0,S.meta.industries.findIndex(s=>s.name===name))%palette.length];
  const pct=v=>finite(v)?(v>0?'+':'')+num(v)+'%':'—';
  const query=()=>({start:S.market.dates[0],end:S.market.dates.at(-1),window:S.window,mode:S.mode});
  const rangeKey=()=>S.view+'-'+S.display;
  function notice(text,error=false){$('atlasNotice').textContent=text||'';$('atlasNotice').hidden=!text;$('atlasNotice').classList.toggle('is-error',error);}
  function stop(){clearInterval(S.timer);S.timer=null;const b=$('atlasReplay');if(b){b.textContent='回放';b.setAttribute('aria-pressed','false');}}
  function dispose(){AtlasFullscreen.close();AtlasInspector.hide();S.charts.forEach(c=>c.destroy());S.charts=[];}
  function applyRange(start,end,origin){
    S.ranges.set(rangeKey(),{dates:[start,end],view:[...origin.view],total:origin.dates.length});
    for(const chart of S.charts)if(chart!==origin&&chart.setDateRange){if(chart.dates.length===origin.dates.length)chart.setRange(...origin.view);else chart.setDateRange(start,end);}
  }
  function graph(id,options){
    const chart=new Chart($(id),{...options,onInspect:(i,origin)=>observeDate(options.dates[i],origin),onRange:(a,b)=>applyRange(a,b,chart)});
    const range=S.ranges.get(rangeKey());if(range){if(range.total===chart.dates.length)chart.setRange(...range.view);else chart.setDateRange(...range.dates);}
    chart.setIndex(S.cursor);S.charts.push(chart);return chart;
  }
  function observeDate(date,origin){
    if(!S.market)return;const i=S.market.dates.indexOf(date);if(i<0)return;S.cursor=i;
    for(const chart of S.charts)if(chart!==origin){const j=chart.dates.indexOf(date);if(j>=0)chart.setIndex(j,{reveal:true});}
    updateSummary();if($('stateDate'))$('stateDate').textContent=date;
    if($('atlasCompareDialog').open)renderComparison();
  }
  function updateSummary(){
    if(!S.market)return;const p=S.market.pool,i=S.cursor;
    $('summaryDate').textContent='查值日期 '+S.market.dates[i];$('atlasDate').value=S.market.dates[i];
    $('atlasSummary').innerHTML=[['当日等权',pct(p.ret[i])],['站上MA20',finite(p.breadth[i])?num(p.breadth[i],1)+'%':'—'],['上涨比例',finite(p.up[i])?num(p.up[i],1)+'%':'—']].map(([label,value])=>`<span>${label}<strong>${value}</strong></span>`).join('');
  }
  function updateMeta(){
    const m=S.meta;$('atlasDataset').textContent=`${m.source_kind==='public'?'公开行情':'本地预览'} · 截至 ${m.dates.at(-1)} · ${m.stocks.length.toLocaleString()}只股票`;
    $('datasetSummary').textContent=`${m.stocks.length.toLocaleString()}只股票 · ${m.industries.length}个行业 · ${m.dates[0]} — ${m.dates.at(-1)}`;
    $('qualitySummary').textContent=`${m.quality.rows.toLocaleString()}行；无效价格 ${m.quality.invalid_prices}，重复日期 ${m.quality.duplicate_rows}，末日缺价 ${m.quality.missing_latest.length}只。缺失值留空。`;
    for(const id of ['filterStart','filterEnd','atlasDate']){$(id).min=m.dates[0];$(id).max=m.dates.at(-1);}
  }
  async function initialize(){
    const ticket=++S.seq,meta=await AtlasData.request('/api/meta');if(ticket!==S.seq)return;
    S.meta=meta;S.selected.clear();S.stocks.clear();S.industry='';S.code='';S.ranges.clear();updateMeta();
    const dates=meta.dates;await loadMarket(dates[Math.max(0,dates.length-252)],dates.at(-1));
  }
  async function loadMarket(start,end){
    const ticket=++S.seq;$('atlasContent').setAttribute('aria-busy','true');
    try{
      const result=await AtlasData.request('/api/market',{start,end,window:S.window,mode:S.mode});if(ticket!==S.seq)return;
      S.market=result;S.cursor=result.dates.length-1;S.history=null;S.stock=null;S.ranges.clear();
      S.selected=new Set([...S.selected].filter(name=>result.sectors.some(s=>s.name===name)));
      $('filterStart').value=start;$('filterEnd').value=end;updateSummary();notice('');await renderView();
    }catch(error){notice(error.message,true);}finally{if(ticket===S.seq)$('atlasContent').setAttribute('aria-busy','false');}
  }
  function updateControls(){
    const heat=S.view==='market'&&S.display==='heat',fixed=S.view==='stock'||S.view==='market'&&['rotation','state'].includes(S.display);
    $('atlasMetricControl').hidden=fixed;
    const keys=heat?['relative','momentum','breadth']:S.view==='industry'?['path','momentum','relative','drawdown','vol']:Object.keys(titles);
    if(!heat&&!keys.includes(S.metric))S.metric='path';
    $('atlasMetric').innerHTML=keys.map(k=>`<option value="${k}" ${metric()===k?'selected':''}>${titles[k]}</option>`).join('');
    $('atlasSummary').hidden=S.view!=='market';
  }
  async function renderView(){
    if(!S.market)return;stop();dispose();const ticket=++S.renderSeq;document.querySelector('.atlas-app').dataset.view=S.view;
    document.querySelectorAll('[data-atlas-view]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.atlasView===S.view));b.tabIndex=b.dataset.atlasView===S.view?0:-1;});
    $('atlasContent').setAttribute('aria-labelledby','atlasTab-'+S.view);updateControls();
    if(S.view==='market')renderMarket();else if(S.view==='industry')await renderIndustry(ticket);else await renderStock(ticket);
  }
  function compareButton(){const count=S.view==='industry'?S.stocks.size:S.selected.size;return`<button id="openComparison" class="compare-trigger">${S.view==='industry'?'成分对比':'行业对比'}<span>${count}</span></button>`;}
  function bindComparison(){const button=$('openComparison');if(button)button.addEventListener('click',()=>{stop();AtlasInspector.hide();$('compareSearch').value='';renderComparison();$('atlasCompareDialog').showModal();});}
  function syncComparisonChecks(){const industry=S.view==='industry',selected=industry?S.stocks:S.selected;for(const input of $('compareRows').querySelectorAll('[data-pick]'))input.checked=selected.has(input.dataset.pick);$('compareCount').textContent=`已选 ${selected.size} 项 · ${S.market.dates[S.cursor]}`;}
  function marketSeries(){
    const base=S.metric==='relative'?S.market.pool.momentum.map(v=>finite(v)?0:null):S.market.pool[S.metric];
    return [{id:'pool',name:'股票池等权',values:base,reference:true,color:'var(--plot-main)'},...S.market.sectors.filter(s=>S.selected.has(s.name)).map(s=>({id:s.name,name:s.name,values:s.series[S.metric],color:color(s.name),removable:true}))];
  }
  function renderMarket(){
    const modes={lines:'走势',heat:'热力',rotation:'轮动',state:'状态'};
    $('atlasContent').innerHTML=`<section class="workspace-plot"><div class="workspace-viewbar"><nav class="plot-views" aria-label="市场图表">${Object.entries(modes).map(([key,label])=>`<button data-display="${key}" aria-pressed="${S.display===key}">${label}</button>`).join('')}</nav>${compareButton()}</div><div id="marketChart"></div><p class="interaction-note">长按查值 · 双指或滚轮缩放 · 双击复原</p></section>`;
    $('atlasContent').querySelectorAll('[data-display]').forEach(b=>b.addEventListener('click',()=>{S.display=b.dataset.display;renderView();}));bindComparison();
    if(S.display==='lines')graph('marketChart',{dates:S.market.dates,series:marketSeries(),unit:unit(),label:titles[S.metric],log:S.scale==='log'&&S.metric==='path',onRemove:name=>toggleIndustry(name)});
    if(S.display==='heat')renderHeat();if(S.display==='rotation')renderRotation();if(S.display==='state')renderState();
  }
  function toggleIndustry(name){
    if(S.selected.has(name))S.selected.delete(name);else S.selected.add(name);
    if(S.display==='lines')S.charts[0]?.setSeries(marketSeries());
    if(S.display==='rotation')S.charts[0]?.setSelection(S.selected);
    const b=$('openComparison');if(b)b.querySelector('span').textContent=S.selected.size;
    if($('atlasCompareDialog').open)syncComparisonChecks();
  }
  function renderHeat(){
    const key=S.heatMetric;
    const heat=new AtlasMaps.Heatmap($('marketChart'),{dates:S.market.dates,rows:S.market.sectors.map(s=>({name:s.name,values:s.series[key]})),metric:key,window:S.window,onInspect:(i,origin)=>observeDate(S.market.dates[i],origin),onIndustry:name=>{S.industry=name;S.view='industry';renderView();},inspectionRows:(i,row)=>{
      const hovered=S.market.sectors[row]?.name,names=new Set([hovered,...S.selected].filter(Boolean));
      return [{name:'股票池等权',value:key==='relative'?0:S.market.pool[key][i],unit:unit(key),color:'var(--plot-main)'},...[...names].map(name=>({name,value:S.market.sectors.find(s=>s.name===name).series[key][i],unit:unit(key),color:color(name)}))];
    }});heat.setIndex(S.cursor);S.charts.push(heat);
  }
  function renderRotation(){
    const map=new AtlasMaps.Scatter($('marketChart'),{dates:S.market.dates,rows:S.market.sectors.map(s=>({name:s.name,x:s.series.relative,y:s.series.acceleration,color:color(s.name)})),selected:S.selected,onToggle:toggleIndustry});map.setIndex(S.cursor);S.charts.push(map);
  }
  function renderState(){
    const groups=[{label:'参与面',unit:'%',domain:[0,100],metrics:[['站上MA20','breadth',palette[0]],['当日上涨','up',palette[1]],['上涨5日均值','up_smooth',palette[2]]]},{label:'20日年化波动',unit:'%',metrics:[['年化波动','vol',palette[3]]]},{label:'成交额',unit:'亿元',metrics:[['成交额','amount',palette[0]]]}];
    $('marketChart').innerHTML=`<div class="state-bundle"><div class="plot-toolbar"><div><time id="stateDate">${S.market.dates[S.cursor]}</time><span>同日指标联动</span></div><div class="plot-actions"><button data-state-action="out" aria-label="缩小时间范围">−</button><button data-state-action="in" aria-label="放大时间范围">＋</button><button data-state-action="reset">复原</button><button data-state-action="expand">全屏</button></div></div>${groups.map((_,i)=>`<div id="stateChart${i}"></div>`).join('')}</div>`;
    const allRows=i=>groups.flatMap(g=>g.metrics.map(([name,key,color])=>({name,value:S.market.pool[key][i],unit:g.unit,color})));
    groups.forEach((g,i)=>graph('stateChart'+i,{dates:S.market.dates,series:g.metrics.map(([name,key,color],j)=>({id:key,name,values:S.market.pool[key],color,reference:j===0})),unit:g.unit,domain:g.domain,label:g.label,compact:true,hideDates:i<2,inspectionRows:allRows}));
    $('marketChart').querySelectorAll('[data-state-action]').forEach(b=>b.addEventListener('click',()=>{const action=b.dataset.stateAction,first=S.charts[0];if(action==='in')first.zoom(1.7);if(action==='out')first.zoom(1/1.7);if(action==='reset')first.reset();if(action==='expand')AtlasFullscreen.open($('marketChart').firstElementChild,'市场状态 · 同日联动');}));
    if(matchMedia('(max-width:600px)').matches)requestAnimationFrame(()=>{const bundle=$('marketChart').firstElementChild;if(bundle&&bundle.getBoundingClientRect().height<innerHeight-60)window.scrollBy({top:bundle.getBoundingClientRect().top-54,behavior:'smooth'});});
  }
  function industrySeries(){
    const sector=S.market.sectors.find(s=>s.name===S.industry),relative=S.metric==='relative';if(!sector)return [];
    const series=[{id:'pool',name:relative?'股票池 / 相对本行业':'股票池等权',values:relative?S.market.pool.momentum.map((v,i)=>finite(v)&&finite(sector.series.momentum[i])?v-sector.series.momentum[i]:null):S.market.pool[S.metric],color:'var(--plot-main)'},{id:'sector',name:relative?S.industry+' / 基准':S.industry,values:relative?sector.series.momentum.map(v=>finite(v)?0:null):sector.series[S.metric],color:color(S.industry),reference:true}];
    if(['path','momentum','relative','drawdown','vol'].includes(S.metric)&&S.history)S.history.stocks.filter(s=>S.stocks.has(s.code)).forEach((stock,i)=>series.push({id:stock.code,name:stock.name,values:relative?stock.tracks.momentum.map((v,k)=>finite(v)&&finite(sector.series.momentum[k])?v-sector.series.momentum[k]:null):stock.tracks[S.metric],color:palette[(i+1)%palette.length],removable:true}));
    return series;
  }
  async function renderIndustry(ticket){
    $('atlasContent').innerHTML=`<section class="workspace-plot"><div class="workspace-viewbar"><label class="industry-picker"><span class="sr-only">研究行业</span><select id="industrySelect"><option value="">选择研究行业</option>${S.meta.industries.map(s=>`<option value="${esc(s.name)}" ${s.name===S.industry?'selected':''}>${esc(s.name)} · ${s.count}只</option>`).join('')}</select></label>${compareButton()}</div><div id="industryChart" class="plot-empty">选择行业后查看走势，也可在市场轮动或热力图中进入行业研究。</div></section>`;
    $('industrySelect').addEventListener('change',()=>{S.industry=$('industrySelect').value;S.stocks.clear();S.history=null;renderView();});bindComparison();
    if(!S.industry){$('openComparison').disabled=true;return;}
    try{
      const history=await AtlasData.request('/api/industry-history',{...query(),name:S.industry});if(ticket!==S.renderSeq||S.view!=='industry')return;S.history=history;$('industryChart').classList.remove('plot-empty');
      graph('industryChart',{dates:S.market.dates,series:industrySeries(),unit:unit(),label:S.industry+' · '+titles[S.metric],log:S.scale==='log'&&S.metric==='path',onRemove:code=>toggleStock(code)});
    }catch(error){notice(error.message,true);}
  }
  function toggleStock(code){if(S.stocks.has(code))S.stocks.delete(code);else S.stocks.add(code);S.charts[0]?.setSeries(industrySeries());$('openComparison').querySelector('span').textContent=S.stocks.size;if($('atlasCompareDialog').open)syncComparisonChecks();}
  function renderComparison(){
    const q=$('compareSearch').value.trim().toLowerCase(),i=S.cursor,industry=S.view==='industry';$('compareTitle').textContent=industry?'选择成分股对比':'选择行业对比';
    let rows;
    if(industry){const sector=S.market.sectors.find(s=>s.name===S.industry),base=sector?.series.momentum[i];rows=(S.history?.stocks||[]).filter(s=>!q||s.name.toLowerCase().includes(q)||s.code.toLowerCase().includes(q)).map(s=>({id:s.code,name:s.name,detail:s.code,value:finite(base)&&finite(s.tracks.momentum[i])?s.tracks.momentum[i]-base:null,checked:S.stocks.has(s.code),color:palette[1]}));}
    else rows=S.market.sectors.filter(s=>!q||s.name.toLowerCase().includes(q)).map(s=>({id:s.name,name:s.name,detail:`有效 ${s.series.count[i]??0} / 池内 ${s.size}`,value:s.series[metric()][i],checked:S.selected.has(s.name),color:color(s.name)}));
    $('compareRows').innerHTML=rows.map(r=>`<div class="comparison-row"><label><input type="checkbox" data-pick="${esc(r.id)}" ${r.checked?'checked':''}><i style="background:${r.color}"></i><span>${esc(r.name)}<small>${esc(r.detail)}</small></span></label><span class="comparison-number">${num(r.value)}<small>${industry?'百分点':unit()}</small></span><button data-research="${esc(r.id)}">${industry?'日线':'研究'} ↗</button></div>`).join('')||'<p class="plot-empty">没有匹配结果。</p>';
    $('compareCount').textContent=`已选 ${industry?S.stocks.size:S.selected.size} 项 · ${S.market.dates[i]}`;
    $('compareRows').querySelectorAll('[data-pick]').forEach(input=>input.addEventListener('change',()=>industry?toggleStock(input.dataset.pick):toggleIndustry(input.dataset.pick)));
    $('compareRows').querySelectorAll('[data-research]').forEach(b=>b.addEventListener('click',()=>{$('atlasCompareDialog').close();if(industry){S.code=b.dataset.research;S.view='stock';}else{S.industry=b.dataset.research;S.view='industry';}renderView();}));
  }
  async function renderStock(ticket){
    const info=S.meta.stocks.find(s=>s.code===S.code);
    $('atlasContent').innerHTML=`<section class="workspace-plot"><div class="stock-workspace-head"><label class="stock-search"><span class="sr-only">查找股票</span><input id="atlasStockSearch" type="search" placeholder="输入股票名称或代码" autocomplete="off"></label><div id="stockSearchResults" class="stock-search-results" hidden></div><select id="stockSpan" aria-label="日线显示范围"><option value="20" ${S.stockSpan===20?'selected':''}>20日</option><option value="60" ${S.stockSpan===60?'selected':''}>60日</option><option value="all" ${S.stockSpan==='all'?'selected':''}>全部</option></select><select id="stockMode" aria-label="价格图类型"><option value="candles">日K</option><option value="lines" ${S.stockMode==='lines'?'selected':''}>收盘价</option></select></div><div class="stock-identity">${info?`<h2>${esc(info.name)}</h2><span>${info.code} · ${esc(info.industry)}</span>`:''}</div><div id="stockPriceChart" class="${info?'':'plot-empty'}">${info?'正在读取日线…':'搜索并选择股票，查看日线、均线与成交量。'}</div></section>`;
    $('atlasStockSearch').addEventListener('input',searchStocks);$('stockSpan').addEventListener('change',()=>{S.stockSpan=$('stockSpan').value==='all'?'all':Number($('stockSpan').value);S.ranges.delete(rangeKey());renderView();});$('stockMode').addEventListener('change',()=>{S.stockMode=$('stockMode').value;renderView();});if(!info)return;
    try{
      const stock=await AtlasData.request('/api/stock',{...query(),code:S.code});if(ticket!==S.renderSeq||S.view!=='stock')return;S.stock=stock;
      const series=[{id:'price',name:'收盘价',values:stock.close,reference:true,color:'var(--plot-main)'},...['ma5','ma10','ma20'].map((key,i)=>({id:key,name:key.toUpperCase(),values:stock[key],color:[palette[0],palette[1],palette[3]][i]}))];
      const chart=graph('stockPriceChart',{dates:stock.dates,series,stock,unit:'元',kind:S.stockMode,label:info.name+'日线'});
      if(!S.ranges.has(rangeKey())&&S.stockSpan!=='all'){const start=Math.max(0,S.cursor-S.stockSpan+1);chart.setRange(start,Math.min(stock.dates.length-1,start+S.stockSpan-1));}
    }catch(error){notice(error.message,true);}
  }
  function searchStocks(){const q=$('atlasStockSearch').value.trim().toLowerCase(),target=$('stockSearchResults');target.hidden=!q;if(!q)return;target.innerHTML=S.meta.stocks.filter(s=>s.name.toLowerCase().includes(q)||s.code.toLowerCase().includes(q)).slice(0,20).map(s=>`<button data-code="${s.code}"><span>${esc(s.name)}</span><small>${s.code}</small></button>`).join('')||'<p>没有匹配结果。</p>';target.querySelectorAll('[data-code]').forEach(b=>b.addEventListener('click',()=>{S.code=b.dataset.code;renderView();}));}
  function showData(){stop();AtlasInspector.hide();$('dataResult').textContent='';$('atlasDataDialog').showModal();}
  async function dataOperation(action){if(S.busy)return;S.busy=true;stop();document.querySelectorAll('[data-data-action]').forEach(b=>b.disabled=true);try{await action();}catch(error){$('dataResult').textContent=error.message;}finally{S.busy=false;$('atlasPublishToken').value='';document.querySelectorAll('[data-data-action]').forEach(b=>b.disabled=false);}}
  async function importData(){
    if(!S.files.length){$('dataResult').textContent='请先选择CSV。';return;}const token=$('atlasPublishToken').value.trim();if(S.dataMode==='publish'&&!token){$('atlasPublishToken').reportValidity();return;}
    await dataOperation(async()=>{
      await AtlasData.importFiles(S.files,S.kind,p=>$('dataResult').textContent=p.message);await initialize();
      if(S.dataMode==='publish'){const snapshot=await AtlasData.snapshot(),result=await publishAtlasSnapshot({token,snapshot,progress:t=>$('dataResult').textContent=t});$('dataResult').textContent=result.unchanged?'数据与网站一致，无需重复发布。':'数据已提交，部署成功后访客可见。';const link=document.createElement('a');link.href='https://github.com/haodayizhia/haodayizhia.github.io/actions/workflows/deploy.yml';link.target='_blank';link.rel='noopener';link.textContent=' 查看部署进度 ↗';$('dataResult').append(link);}else $('dataResult').textContent='已导入，仅当前浏览器可见；公开网站未改变。';
    });
  }
  const tabs=[...document.querySelectorAll('[data-atlas-view]')];tabs.forEach(b=>{b.id='atlasTab-'+b.dataset.atlasView;b.addEventListener('click',()=>{S.view=b.dataset.atlasView;S.seq++;renderView();});});
  document.querySelector('.atlas-view-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();let i=tabs.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[i].focus();tabs[i].click();});
  $('atlasPeriod').addEventListener('change',()=>{if(!S.meta)return;stop();AtlasInspector.hide();const v=$('atlasPeriod').value;if(v==='custom'){$('atlasFilterDialog').showModal();return;}const dates=S.meta.dates;loadMarket(dates[v==='all'?0:Math.max(0,dates.length-Number(v))],dates.at(-1));});
  $('atlasMetric').addEventListener('change',()=>{if(S.view==='market'&&S.display==='heat')S.heatMetric=$('atlasMetric').value;else S.metric=$('atlasMetric').value;renderView();});
  $('openAtlasFilters').addEventListener('click',()=>{stop();AtlasInspector.hide();$('atlasFilterDialog').showModal();});
  $('atlasFilterForm').addEventListener('submit',e=>{e.preventDefault();const dates=S.meta.dates.filter(d=>d>=$('filterStart').value&&d<=$('filterEnd').value);if(!dates.length){$('filterError').textContent='请选择含交易日的有效区间。';return;}S.window=Number($('filterWindow').value);S.mode=$('filterCohort').value;S.scale=$('filterScale').value;$('atlasPeriod').value='custom';$('atlasFilterDialog').close();loadMarket(dates[0],dates.at(-1));});
  $('atlasDate').addEventListener('change',()=>{if(!S.market)return;const chosen=S.market.dates.filter(d=>d<=$('atlasDate').value).at(-1)||S.market.dates[0];observeDate(chosen);});
  $('atlasReplay').addEventListener('click',()=>{if(S.timer){stop();return;}if(S.cursor===S.market.dates.length-1)observeDate(S.market.dates[0]);$('atlasReplay').textContent='暂停';$('atlasReplay').setAttribute('aria-pressed','true');S.timer=setInterval(()=>{if(S.cursor>=S.market.dates.length-1){stop();return;}observeDate(S.market.dates[S.cursor+1]);},650);});
  $('compareSearch').addEventListener('input',renderComparison);$('clearComparison').addEventListener('click',()=>{if(S.view==='industry'){S.stocks.clear();S.charts[0]?.setSeries(industrySeries());}else{S.selected.clear();if(S.display==='lines')S.charts[0]?.setSeries(marketSeries());if(S.display==='rotation')S.charts[0]?.setSelection(S.selected);}$('openComparison').querySelector('span').textContent='0';syncComparisonChecks();});
  $('openAtlasData').addEventListener('click',showData);document.querySelectorAll('[data-data-mode]').forEach(b=>b.addEventListener('click',()=>{S.dataMode=b.dataset.dataMode;document.querySelectorAll('[data-data-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('publishAuth').hidden=S.dataMode!=='publish';$('atlasImportSubmit').textContent=S.dataMode==='publish'?'校验并公开发布':'导入查看';}));
  for(const [button,input,kind] of [['pickAtlasMerged','atlasMergedFile','merged'],['pickAtlasFolder','atlasFolderFiles','directory']]){$(button).addEventListener('click',()=>$(input).click());$(input).addEventListener('change',e=>{S.files=[...e.target.files].filter(f=>/\.csv$/i.test(f.name));S.kind=kind;$('selectedDataFiles').textContent=`已选 ${S.files.length} 个CSV · ${num(S.files.reduce((n,f)=>n+f.size,0)/1024**2,1)} MB`;});}
  $('atlasImportSubmit').addEventListener('click',importData);$('restoreAtlasPublic').addEventListener('click',()=>dataOperation(async()=>{await AtlasData.request('/api/reload');await initialize();$('dataResult').textContent='已恢复公开数据。';}));
  document.querySelectorAll('[data-close-atlas]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.closeAtlas).close()));document.querySelectorAll('dialog').forEach(AtlasDialogDismiss);$('atlasDataDialog').addEventListener('close',()=>$('atlasPublishToken').value='');
  document.addEventListener('pointerdown',e=>{const r=$('stockSearchResults');if(r&&!e.target.closest('.stock-workspace-head'))r.hidden=true;});
  window.addEventListener('bro:themechange',()=>S.charts.forEach(c=>c.draw()));window.addEventListener('pagehide',()=>{$('atlasPublishToken').value='';stop();});
  window.AtlasWorkspace={state:S,initialize,renderView,observeDate,toggleIndustry};
  initialize().catch(error=>{if(S.busy||S.market)return;notice(error.message,true);$('atlasContent').innerHTML='<p class="plot-empty">暂未加载公开数据，可通过“数据”重试或导入本地CSV。</p>';});
})();
