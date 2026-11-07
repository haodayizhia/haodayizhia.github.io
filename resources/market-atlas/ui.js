'use strict';
(()=>{
 const {Chart,escape:esc,number:num,finite}=AtlasCharts,$=id=>document.getElementById(id);
 const S={meta:null,market:null,view:'market',display:'lines',metric:'path',window:1,mode:'dynamic',scale:'linear',span:'252',cursor:0,industry:'',code:'',selected:new Set(),comparedStocks:new Set(),showAll:false,charts:[],history:null,stock:null,stockSpan:60,stockMode:'candles',seq:0,renderSeq:0,sectorExpanded:false,stocksExpanded:false,files:[],kind:'merged',dataMode:'preview',busy:false,timer:null};
 const palette=['var(--plot-blue)','var(--plot-gold)','var(--plot-teal)','var(--plot-purple)','var(--plot-red)','var(--plot-slate)'];
 const title={path:'累计收益',momentum:'窗口收益',relative:'相对强弱',breadth:'MA20广度',drawdown:'峰值回撤',vol:'年化波动',dispersion:'个股分化'};
 const unit=()=>S.metric==='relative'||S.metric==='dispersion'?'个百分点':'%';
 const change=v=>finite(v)?(v>0?'+':'')+num(v)+'%':'—';
 const cls=v=>!finite(v)||v===0?'':v>0?'rise':'fall';
 const query=()=>({start:S.market.dates[0],end:S.market.dates.at(-1),window:S.window,mode:S.mode});
 function notice(text,error=false){$('atlasNotice').textContent=text||'';$('atlasNotice').hidden=!text;$('atlasNotice').classList.toggle('is-error',error);}
 function dispose(){S.charts.forEach(c=>c.destroy());S.charts=[];}
 function graph(id,options){const chart=new Chart($(id),{...options,onInspect:index=>observeDate(options.dates[index],chart)});S.charts.push(chart);return chart;}
 function observeDate(date,origin){
  const i=S.market?.dates.indexOf(date);if(i<0)return;S.cursor=i;updateSummary();
  for(const chart of S.charts){const index=chart.dates.indexOf(date);if(index>=0){chart.index=index;if(chart!==origin)chart.axisValue=null;chart.draw();}}
  $('atlasTimeline').value=i;$('asofLabel').textContent=date;
  if(S.view==='market'){renderSectors();if(S.display==='heat')renderHeat();else if(S.display==='rotation')renderRotation();}else if(S.view==='industry')renderStocks();
 }
 function updateSummary(){
  if(!S.market)return;const p=S.market.pool,i=S.cursor;
  const cards=[['当日等权',change(p.ret[i]),cls(p.ret[i])],['站上 MA20',finite(p.breadth[i])?num(p.breadth[i],1)+'%':'—',''],['当日上涨',finite(p.up[i])?num(p.up[i],1)+'%':'—','']];
  $('atlasSummary').innerHTML=cards.map(([name,value,color])=>`<div><span>${name}</span><strong class="${color}">${value}</strong></div>`).join('');
  $('summaryDate').textContent='观察日 '+S.market.dates[i];
 }
 function updateMeta(){
  const m=S.meta;$('atlasDataset').textContent=`${m.source_kind==='public'?'公开数据':'本地预览'} · 截至 ${m.dates.at(-1)} · ${m.stocks.length.toLocaleString()} 只股票`;
  $('datasetSummary').textContent=`${m.stocks.length.toLocaleString()} 只股票 · ${m.industries.length} 个行业 · ${m.dates[0]} — ${m.dates.at(-1)}`;
  $('qualitySummary').textContent=`${m.quality.rows.toLocaleString()} 行记录；无效价格 ${m.quality.invalid_prices}，重复日期 ${m.quality.duplicate_rows}，末日缺价 ${m.quality.missing_latest.length} 只。缺失数据留空，不补零。`;
  $('filterStart').min=$('filterEnd').min=m.dates[0];$('filterStart').max=$('filterEnd').max=m.dates.at(-1);
 }
 async function initialize(keep=false){
  const ticket=++S.seq;S.comparedStocks.clear();const meta=await AtlasData.request('/api/meta');if(ticket!==S.seq)return;S.meta=meta;updateMeta();
  if(!S.meta.industries.some(x=>x.name===S.industry))S.industry=S.meta.industries[0]?.name||'';
  if(!S.meta.stocks.some(x=>x.code===S.code))S.code=S.meta.stocks.find(x=>x.code==='000001.SZ')?.code||S.meta.stocks[0].code;
  const dates=S.meta.dates,start=keep&&dates.includes($('filterStart').value)?$('filterStart').value:dates[Math.max(0,dates.length-252)];
  await loadMarket(start,dates.at(-1));
 }
 async function loadMarket(start,end){
  const ticket=++S.seq;$('atlasContent').setAttribute('aria-busy','true');
  try{
   const result=await AtlasData.request('/api/market',{start,end,window:S.window,mode:S.mode});if(ticket!==S.seq)return;
   S.market=result;S.cursor=result.dates.length-1;S.history=null;S.stock=null;
   $('filterStart').value=start;$('filterEnd').value=end;
   const sectors=[...result.sectors].filter(s=>finite(s.series.path.at(-1))).sort((a,b)=>b.series.path.at(-1)-a.series.path.at(-1));
   if(!S.selected.size)S.selected=new Set([sectors[0]?.name,sectors[1]?.name,sectors.at(-1)?.name].filter(Boolean));
   S.selected=new Set([...S.selected].filter(n=>result.sectors.some(s=>s.name===n)));
   updateSummary();notice('');await renderView();
  }catch(error){notice(error.message,true);}
  finally{if(ticket===S.seq)$('atlasContent').setAttribute('aria-busy','false');}
 }
 function chartHeader(name,description,extra=''){return`<header class="atlas-panel-title"><div><h2>${esc(name)}</h2><p>${esc(description)}</p></div>${extra}</header>`;}
 function metricText(){return S.metric==='momentum'?(S.window===1?'当日涨跌幅':S.window+'日收益'):S.metric==='relative'?(S.window===1?'当日超额':S.window+'日超额'):title[S.metric];}
 function legend(series){return`<div class="atlas-legend">${series.map(s=>`<span><i style="background:${s.color||'var(--plot-main)'}"></i>${esc(s.name)}</span>`).join('')}</div>`;}
 async function renderView(){
  if(!S.market)return;stop();if($('atlasContent').contains(document.activeElement))document.querySelector(`[data-atlas-view="${S.view}"]`)?.focus({preventScroll:true});dispose();S.renderSeq++;document.querySelector('.atlas-app').dataset.view=S.view;
  document.querySelectorAll('[data-atlas-view]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.atlasView===S.view));b.tabIndex=b.dataset.atlasView===S.view?0:-1;});
  $('atlasContent').setAttribute('role','tabpanel');$('atlasContent').setAttribute('aria-labelledby','atlasTab-'+S.view);
  $('atlasMetricControl').hidden=S.view==='stock';$('atlasTimeline').min=0;$('atlasTimeline').max=S.market.dates.length-1;$('atlasTimeline').value=S.cursor;$('asofLabel').textContent=S.market.dates[S.cursor];
  if(S.view==='market')renderMarket();else if(S.view==='industry')await renderIndustry();else await renderStock();
 }
 function renderMarket(){
  const labels={lines:'走势',heat:'热力',rotation:'轮动',state:'市场状态'};
  $('atlasContent').innerHTML=`<div class="market-layout"><section class="atlas-panel">${chartHeader('市场全景',S.display==='lines'?'股票池等权与所选行业；点击曲线查看精确值。':S.display==='heat'?'最近 10 个交易日的行业相对强弱。':'横轴是相对收益，纵轴是相对收益的变化。')}<div class="atlas-subtabs" role="group" aria-label="市场图表类型">${Object.entries(labels).map(([id,name])=>`<button data-display="${id}" aria-pressed="${S.display===id}">${name}</button>`).join('')}</div><div id="marketChart"></div><div id="marketLegend"></div></section><section class="atlas-panel sector-panel">${chartHeader('行业观察','勾选对比，点击名称展开行业。')}<label class="atlas-search"><span class="sr-only">查找行业</span><input id="sectorSearch" type="search" placeholder="查找行业名称"></label><div class="atlas-list-head"><span>行业 / 有效样本</span><span>${esc(metricText())}</span></div><div id="sectorRows" class="sector-rows"></div></section></div>`;
  $('sectorSearch').addEventListener('input',renderSectors);
  $('atlasContent').querySelectorAll('[data-display]').forEach(b=>b.addEventListener('click',()=>{S.display=b.dataset.display;renderView();}));
  if(S.display==='lines'){
   const sectors=S.market.sectors.filter(s=>S.showAll||S.selected.has(s.name)),base=S.metric==='relative'?S.market.pool.momentum.map(v=>finite(v)?0:null):S.market.pool[S.metric];
   const series=[{id:'pool',name:'股票池等权',values:base,color:'var(--plot-main)',reference:true},...sectors.map((s,i)=>({id:s.name,name:s.name,values:s.series[S.metric],color:palette[i%palette.length]}))];
   const c=graph('marketChart',{dates:S.market.dates,series,unit:unit(),label:'市场'+metricText(),log:S.scale==='log'&&S.metric==='path'});c.index=S.cursor;c.draw();$('marketLegend').innerHTML=legend(series);
  }else if(S.display==='heat')renderHeat();else if(S.display==='rotation')renderRotation();else renderMarketState();
  renderSectors();
 }
 function renderMarketState(){
  const groups=[['参与面','%',[["站上 MA20","breadth",palette[0]],["当日上涨","up",palette[1]],["上涨比例5日均值","up_smooth",palette[2]]]],['年化波动','%',[["20日年化波动","vol",palette[3]]]],['成交额','亿元',[["有效样本成交额","amount",palette[0]]]]];
  $('marketChart').innerHTML=groups.map((g,i)=>`<h3 class="state-mini-heading">${g[0]}</h3><div id="stateChart${i}"></div>`).join('');
  groups.forEach(([name,unit,metrics],i)=>{const c=graph('stateChart'+i,{dates:S.market.dates,series:metrics.map(([name,key,color],j)=>({id:key,name,values:S.market.pool[key],color,reference:j===0})),unit,label:name});c.index=S.cursor;c.draw();});
 }
 function renderSectors(){
  const target=$('sectorRows');if(!target)return;const q=$('sectorSearch').value.trim(),i=S.cursor;
  const all=S.market.sectors.filter(s=>!q||s.name.includes(q)).sort((a,b)=>(b.series[S.metric][i]??-Infinity)-(a.series[S.metric][i]??-Infinity)),rows=q||S.sectorExpanded?all:all.slice(0,8);
  target.innerHTML=rows.map(s=>`<div class="atlas-sector-row"><label class="compare-check"><input type="checkbox" data-compare="${esc(s.name)}" ${S.selected.has(s.name)?'checked':''} aria-label="对比${esc(s.name)}"></label><button class="sector-open" data-industry="${esc(s.name)}"><strong>${esc(s.name)}</strong><small>有效 ${s.series.count[i]??0} / 池内 ${s.size}</small></button><span class="metric-number ${cls(s.series[S.metric][i])}">${num(s.series[S.metric][i])}${unit()==='%'?'%':'<small>百分点</small>'}</span></div>`).join('')||'<p class="atlas-empty">没有匹配的行业。</p>';
  target.querySelectorAll('[data-industry]').forEach(b=>b.addEventListener('click',()=>{S.industry=b.dataset.industry;S.view='industry';renderView();}));
  if(all.length>8&&!q){const b=document.createElement('button');b.className='show-more';b.textContent=S.sectorExpanded?'收起行业列表':`查看全部 ${all.length} 个行业`;b.addEventListener('click',()=>{S.sectorExpanded=!S.sectorExpanded;renderSectors();});target.append(b);}
  target.querySelectorAll('[data-compare]').forEach(input=>input.addEventListener('change',()=>{const name=input.dataset.compare;if(input.checked)S.selected.add(name);else S.selected.delete(name);if(S.selected.size>6&&!S.showAll){input.checked=false;S.selected.delete(name);notice('当前最多对比 6 个行业；可在筛选中选择显示全部。');return;}renderView();}));
 }
 function renderHeat(){
  const end=S.cursor,start=Math.max(0,end-9),dates=S.market.dates.slice(start,end+1),rows=[...S.market.sectors].sort((a,b)=>(b.series.relative[end]??-Infinity)-(a.series.relative[end]??-Infinity));
  $('marketChart').innerHTML=`<div class="heat-caption"><span>冷色落后 · 暖色领先</span><span>观察日 ${esc(S.market.dates[end])}</span></div><div class="heat-pickers"><label>行业<select id="heatIndustry">${rows.map(r=>`<option>${esc(r.name)}</option>`).join("")}</select></label><label>日期<select id="heatDate">${dates.map(d=>`<option value="${d}" ${d===S.market.dates[end]?"selected":""}>${d.slice(5)}</option>`).join("")}</select></label></div><div class="accessible-heat"><div class="heat-date-head"><span>行业</span><div>${dates.map((d,i)=>`<span>${i===0||i===dates.length-1?esc(d.slice(5)):''}</span>`).join('')}</div></div>${rows.map(row=>`<div class="heat-line"><button data-industry="${esc(row.name)}">${esc(row.name)}</button><div>${dates.map((d,j)=>{const value=row.series.relative[start+j],t=finite(value)?Math.min(1,Math.abs(value)/(S.window===1?5:18)):0;return`<button class="heat-cell ${value===null?'missing':value>=0?'positive':'negative'}" style="--strength:${.12+t*.7}" data-date="${d}" data-heat-industry="${esc(row.name)}" aria-label="${esc(row.name)} ${d} ${num(value)}个百分点"></button>`;}).join('')}</div></div>`).join('')}</div><p id="heatReadout" class="heat-readout" role="status">点击色块，查看行业、日期和精确数值。</p>`;
  const inspectHeat=()=>{const sector=S.market.sectors.find(s=>s.name===$('heatIndustry').value),date=$('heatDate').value,i=S.market.dates.indexOf(date);$('heatReadout').textContent=`${sector.name} · ${date} · 超额 ${num(sector.series.relative[i])} 个百分点`;};
  $('heatIndustry').addEventListener('change',inspectHeat);$('heatDate').addEventListener('change',inspectHeat);inspectHeat();
  $('marketChart').querySelectorAll('[data-industry]').forEach(b=>b.addEventListener('click',()=>{S.industry=b.dataset.industry;S.view='industry';renderView();}));
  $('marketChart').querySelectorAll('[data-heat-industry]').forEach(b=>b.addEventListener('click',()=>{const sector=S.market.sectors.find(s=>s.name===b.dataset.heatIndustry),i=S.market.dates.indexOf(b.dataset.date);$('heatReadout').textContent=`${sector.name} · ${b.dataset.date} · 超额 ${num(sector.series.relative[i])} 个百分点`;}));
 }
 function renderRotation(){
  const rows=S.market.sectors.map(s=>({name:s.name,x:s.series.relative[S.cursor],y:s.series.acceleration[S.cursor]})).filter(p=>finite(p.x)&&finite(p.y)),host=$('marketChart');
  host.innerHTML='<div id="rotationFigure" class="rotation-figure"></div><label class="rotation-picker">查找行业<select id="rotationIndustry"></select></label><p class="heat-readout" id="rotationReadout" role="status"></p>';
  $('rotationIndustry').innerHTML=rows.map(p=>`<option>${esc(p.name)}</option>`).join('');
  const draw=()=>{const width=Math.round($('rotationFigure').getBoundingClientRect().width),height=300,left=58,right=width-20,top=25,bottom=260,maxX=Math.max(1,...rows.map(p=>Math.abs(p.x)))*1.15,maxY=Math.max(1,...rows.map(p=>Math.abs(p.y)))*1.15,X=x=>left+(x/maxX+1)/2*(right-left),Y=y=>bottom-(y/maxY+1)/2*(bottom-top),name=$('rotationIndustry').value;let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="行业轮动位置；下方选择行业查看精确数值"><path class="grid-line" d="M${X(0)},${top}V${bottom}M${left},${Y(0)}H${right}"/>`;
   for(const v of [-1,0,1])svg+=`<text class="axis-label" x="${X(v*maxX)}" y="${bottom+20}" text-anchor="${v===-1?'start':v===1?'end':'middle'}">${num(v*maxX,1)}</text><text class="axis-label" x="${left-8}" y="${Y(v*maxY)+4}" text-anchor="end">${num(v*maxY,1)}</text>`;
   svg+=`<text class="axis-unit" x="${left}" y="14">变化（百分点）</text><text class="axis-unit" x="${right}" y="298" text-anchor="end">超额（百分点）</text>`;
   rows.forEach(p=>svg+=`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.name===name?6:3}" fill="${p.name===name?'var(--plot-main)':'var(--plot-blue)'}" opacity="${p.name===name?1:.35}"/>`);$('rotationFigure').innerHTML=svg+'</svg>';
   const p=rows.find(p=>p.name===name);$('rotationReadout').textContent=p?`${p.name} · 超额 ${num(p.x)} 个百分点 · 变化 ${num(p.y)} 个百分点`:'当前观察日没有足够历史计算轮动。';
  };$('rotationIndustry').addEventListener('change',draw);draw();
 }
 async function renderIndustry(){
  if(S.comparisonIndustry!==S.industry){S.comparedStocks.clear();S.comparisonIndustry=S.industry;S.stocksExpanded=false;}
  const ticket=S.renderSeq,name=S.industry;$('atlasContent').innerHTML=`<section class="atlas-panel"><div class="industry-toolbar"><label>研究行业<select id="industrySelect">${S.meta.industries.map(s=>`<option ${s.name===name?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><span id="industryCoverage"></span></div>${chartHeader(name+' · 行业研究','先看行业与市场，再展开股票日线。')}<div id="industryChart"></div><div id="industryLegend"></div></section><section class="atlas-panel stock-list-panel">${chartHeader('行业成分','按观察日相对行业的强弱排序。')}<label class="atlas-search"><span class="sr-only">查找股票</span><input id="stockFilter" type="search" placeholder="股票名称或代码"></label><div id="industryStocks"></div></section>`;
  $('industrySelect').addEventListener('change',()=>{S.industry=$('industrySelect').value;S.history=null;renderView();});$('stockFilter').addEventListener('input',renderStocks);
  const sector=S.market.sectors.find(s=>s.name===name);if(!sector)return;
  const series=[{id:'pool',name:'股票池等权',values:S.metric==='relative'?S.market.pool.momentum.map(v=>finite(v)?0:null):S.market.pool[S.metric],reference:true,color:'var(--plot-main)'},{id:name,name,values:sector.series[S.metric],color:'var(--plot-blue)'}];
  const c=graph('industryChart',{dates:S.market.dates,series,unit:unit(),label:name+metricText(),log:S.scale==='log'&&S.metric==='path'});c.index=S.cursor;c.draw();$('industryLegend').innerHTML=legend(series);$('industryCoverage').textContent=`池内 ${sector.size} 只 · 当前口径 ${sector.eligible} 只`;
  try{const history=await AtlasData.request('/api/industry-history',{...query(),name});if(ticket!==S.renderSeq||S.view!=='industry'||name!==S.industry)return;S.history=history;renderStocks();drawStockComparison();}catch(error){notice(error.message,true);}
 }
 function drawStockComparison(){
  if(S.view!=='industry'||!S.history)return;
  const sector=S.market.sectors.find(s=>s.name===S.industry),relative=S.metric==='relative',supported=['path','momentum','relative','drawdown','vol'].includes(S.metric);
  const series=[{id:'pool',name:relative?'股票池 · 相对本行业':'股票池等权',values:relative?S.market.pool.momentum.map((v,i)=>finite(v)&&finite(sector.series.momentum[i])?v-sector.series.momentum[i]:null):S.market.pool[S.metric],color:'var(--plot-main)'},{id:'sector',name:relative?S.industry+' · 基准':S.industry,values:relative?sector.series.momentum.map(v=>finite(v)?0:null):sector.series[S.metric],color:palette[0],reference:true}];
  if(supported)S.history.stocks.filter(s=>S.comparedStocks.has(s.code)).forEach((stock,i)=>series.push({id:stock.code,name:stock.name,values:relative?stock.tracks.momentum.map((v,k)=>finite(v)&&finite(sector.series.momentum[k])?v-sector.series.momentum[k]:null):stock.tracks[S.metric],color:palette[(i+1)%palette.length]}));
  dispose();const c=graph('industryChart',{dates:S.market.dates,series,unit:unit(),label:S.industry+metricText(),log:S.scale==='log'&&S.metric==='path'});c.index=S.cursor;c.draw();$('industryLegend').innerHTML=legend(series);
 }
 function renderStocks(){
  if(!S.history||!$('industryStocks'))return;const q=($('stockFilter')?.value||'').trim().toLowerCase(),sector=S.market.sectors.find(s=>s.name===S.industry),i=S.cursor,base=sector.series.momentum[i];
  const all=S.history.stocks.map(stock=>({...stock,relative:finite(base)&&finite(stock.tracks.momentum[i])?stock.tracks.momentum[i]-base:null})).filter(s=>!q||s.name.toLowerCase().includes(q)||s.code.toLowerCase().includes(q)).sort((a,b)=>(b.relative??-Infinity)-(a.relative??-Infinity)),rows=q||S.stocksExpanded?all:all.slice(0,10);
  $('industryStocks').innerHTML=rows.map(s=>`<div class="atlas-stock-row"><label class="compare-check" title="勾选对比个股曲线，最多3只"><input type="checkbox" data-stock-compare="${s.code}" ${S.comparedStocks.has(s.code)?'checked':''} ${['path','momentum','relative','drawdown','vol'].includes(S.metric)?'':'disabled'} aria-label="对比${esc(s.name)}"></label><div><strong>${esc(s.name)}</strong><small>${s.code} · ${finite(s.tracks.price[i])?num(s.tracks.price[i])+' 元':'缺少价格'}</small></div><div class="stock-relative ${cls(s.relative)}">${num(s.relative)}<small>超额 / 百分点</small></div><button data-stock-code="${s.code}">日线 <span aria-hidden="true">↗</span></button></div>`).join('')||'<p class="atlas-empty">没有匹配的股票。</p>';
  $('industryStocks').querySelectorAll('[data-stock-code]').forEach(b=>b.addEventListener('click',()=>{S.code=b.dataset.stockCode;S.view='stock';renderView();}));
  $('industryStocks').querySelectorAll('[data-stock-compare]').forEach(input=>input.addEventListener('change',()=>{if(input.checked){if(S.comparedStocks.size>=3){input.checked=false;notice('个股曲线最多同时对比3只，可取消已选项后更换。');return;}S.comparedStocks.add(input.dataset.stockCompare);}else S.comparedStocks.delete(input.dataset.stockCompare);drawStockComparison();}));
  if(all.length>10&&!q){const b=document.createElement('button');b.className='show-more';b.textContent=S.stocksExpanded?'收起股票列表':`查看全部 ${all.length} 只股票`;b.addEventListener('click',()=>{S.stocksExpanded=!S.stocksExpanded;renderStocks();});$('industryStocks').append(b);}
 }
 async function renderStock(){
  const ticket=S.renderSeq,code=S.code,info=S.meta.stocks.find(s=>s.code===code);
  $('atlasContent').innerHTML=`<section class="atlas-panel"><div class="stock-toolbar"><label class="stock-search-label">查找股票<input id="atlasStockSearch" type="search" placeholder="股票名称或代码" autocomplete="off"></label><div class="stock-search-results" id="stockSearchResults" hidden></div><label>显示区间<select id="stockSpan"><option value="20" ${S.stockSpan===20?'selected':''}>20日</option><option value="60" ${S.stockSpan===60?'selected':''}>60日</option><option value="all" ${S.stockSpan==='all'?'selected':''}>全部</option></select></label><label>价格图<select id="stockMode"><option value="candles">日K</option><option value="lines" ${S.stockMode==='lines'?'selected':''}>收盘价</option></select></label></div>${chartHeader(info.name,code+' · '+info.industry)}<div id="stockPriceChart"><p class="atlas-empty">正在读取日线…</p></div><div class="atlas-legend"><span><i style="background:var(--plot-blue)"></i>MA5</span><span><i style="background:var(--plot-gold)"></i>MA10</span><span><i style="background:var(--plot-purple)"></i>MA20</span></div><p class="candle-note" id="candleNote"></p></section>`;
  $('atlasStockSearch').addEventListener('input',searchStocks);$('stockSpan').addEventListener('change',()=>{S.stockSpan=$('stockSpan').value==='all'?'all':Number($('stockSpan').value);renderView();});$('stockMode').addEventListener('change',()=>{S.stockMode=$('stockMode').value;renderView();});
  try{
   const stock=await AtlasData.request('/api/stock',{...query(),code});if(ticket!==S.renderSeq||S.view!=='stock'||S.code!==code)return;
   S.stock=stock;const from=S.stockSpan==='all'?0:Math.max(0,stock.dates.length-S.stockSpan),cut=key=>stock[key].slice(from),d={...stock};
   for(const key of ['dates','close','open','high','low','volume','amount','daily','ma5','ma10','ma20'])d[key]=cut(key);
   const series=[{id:'price',name:'收盘价',values:d.close,color:'var(--plot-main)',reference:true},...['ma5','ma10','ma20'].map((key,i)=>({id:key,name:key.toUpperCase(),values:d[key],color:[palette[0],palette[1],palette[3]][i]}))];
   const c=graph('stockPriceChart',{dates:d.dates,series,unit:'元',label:info.name+'日线价格',kind:S.stockMode==='candles'?'candles':'lines',stock:d});
   const min=S.market.dates.indexOf(d.dates[0]);$('atlasTimeline').min=min;S.cursor=Math.max(min,S.cursor);c.index=S.cursor-min;c.draw();observeDate(S.market.dates[S.cursor]);
   const missing=d.close.filter((v,i)=>finite(v)&&![d.open[i],d.high[i],d.low[i]].every(finite)).length;$('candleNote').textContent=missing?`${missing}个交易日缺少有效开高低价，以收盘点表示；不补造K线。`:'价格来自 CSV 真实开高低收；均线使用已有历史，成交量统一为万股。';
  }catch(error){notice(error.message,true);}
 }
 function searchStocks(){const q=$('atlasStockSearch').value.trim().toLowerCase(),target=$('stockSearchResults');target.hidden=!q;if(!q)return;const stocks=S.meta.stocks.filter(s=>s.name.toLowerCase().includes(q)||s.code.toLowerCase().includes(q)).slice(0,20);target.innerHTML=stocks.map(s=>`<button data-select-code="${s.code}"><span>${esc(s.name)}</span><small>${s.code}</small></button>`).join('')||'<p>没有匹配结果</p>';target.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{S.code=b.dataset.selectCode;renderView();}));}
 function stop(){clearInterval(S.timer);S.timer=null;$('atlasPlay').textContent='播放';$('atlasPlay').setAttribute('aria-pressed','false');}
 function step(delta){stop();const i=Math.max(Number($('atlasTimeline').min),Math.min(S.market.dates.length-1,S.cursor+delta));observeDate(S.market.dates[i]);}
 function showData(mode='preview'){S.dataMode=mode;document.querySelectorAll('[data-data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.dataMode===mode)));$('publishAuth').hidden=mode!=='publish';$('atlasImportSubmit').textContent=mode==='publish'?'校验并公开发布':'导入查看';$('dataResult').textContent='';$('atlasDataDialog').showModal();}
 async function dataOperation(action){if(S.busy)return;S.busy=true;stop();document.querySelectorAll('[data-data-action]').forEach(b=>b.disabled=true);try{await action();}catch(error){$('dataResult').textContent=error.message;}finally{S.busy=false;$('atlasPublishToken').value='';document.querySelectorAll('[data-data-action]').forEach(b=>b.disabled=false);}}
 async function importData(){
  if(!S.files.length){$('dataResult').textContent='请先选择CSV。';return;}const token=$('atlasPublishToken').value.trim();if(S.dataMode==='publish'&&!token){$('atlasPublishToken').reportValidity();return;}
  await dataOperation(async()=>{
   await AtlasData.importFiles(S.files,S.kind,p=>$('dataResult').textContent=p.message);S.selected.clear();await initialize();
   if(S.dataMode==='publish'){const snapshot=await AtlasData.snapshot(),result=await publishAtlasSnapshot({token,snapshot,progress:message=>$('dataResult').textContent=message});$('dataResult').textContent=result.unchanged?'数据与网站一致，无需重复发布。':'数据已提交，部署完成后所有访客可见。';const a=document.createElement('a');a.href='https://github.com/haodayizhia/haodayizhia.github.io/actions/workflows/deploy.yml';a.target='_blank';a.rel='noopener';a.textContent=' 查看部署进度 ↗';$('dataResult').append(a);}
   else $('dataResult').textContent='已导入本地数据，仅当前浏览器可见；公开网站未改变。';
  });
 }
 document.querySelectorAll('[data-atlas-view]').forEach(b=>b.addEventListener('click',()=>{if(!S.market)return;S.view=b.dataset.atlasView;S.seq++;renderView();}));
 const viewTabs=[...document.querySelectorAll('[data-atlas-view]')];viewTabs.forEach(b=>{b.id='atlasTab-'+b.dataset.atlasView;b.setAttribute('aria-controls','atlasContent');});
 document.querySelector('.atlas-view-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();let i=viewTabs.indexOf(document.activeElement);i=event.key==='Home'?0:event.key==='End'?viewTabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+viewTabs.length)%viewTabs.length;viewTabs[i].focus();viewTabs[i].click();});
 $('atlasPeriod').addEventListener('change',()=>{if(!S.meta)return;const span=$('atlasPeriod').value;if(span==='custom'){$('atlasFilterDialog').showModal();return;}S.span=span;const dates=S.meta.dates;loadMarket(dates[span==='all'?0:Math.max(0,dates.length-Number(span))],dates.at(-1));});
 $('atlasMetric').addEventListener('change',()=>{S.metric=$('atlasMetric').value;renderView();});$('openAtlasFilters').addEventListener('click',()=>$('atlasFilterDialog').showModal());
 $('atlasFilterForm').addEventListener('submit',event=>{event.preventDefault();const start=$('filterStart').value,end=$('filterEnd').value,dates=S.meta.dates.filter(d=>d>=start&&d<=end);if(!dates.length){$('filterError').textContent='这个区间没有交易日，请重新选择。';return;}S.window=Number($('filterWindow').value);S.mode=$('filterCohort').value;S.scale=$('filterScale').value;S.showAll=$('filterAll').checked;S.span='custom';$('atlasPeriod').value='custom';$('atlasFilterDialog').close();loadMarket(dates[0],dates.at(-1));});
 $('openAtlasData').addEventListener('click',()=>showData());document.querySelectorAll('[data-data-mode]').forEach(b=>b.addEventListener('click',()=>{S.dataMode=b.dataset.dataMode;document.querySelectorAll('[data-data-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('publishAuth').hidden=S.dataMode!=='publish';$('atlasImportSubmit').textContent=S.dataMode==='publish'?'校验并公开发布':'导入查看';}));
 for(const [button,input,kind] of [['pickAtlasMerged','atlasMergedFile','merged'],['pickAtlasFolder','atlasFolderFiles','directory']]){$(button).addEventListener('click',()=>$(input).click());$(input).addEventListener('change',event=>{S.files=[...event.target.files].filter(f=>/\.csv$/i.test(f.name));S.kind=kind;$('selectedDataFiles').textContent=`已选 ${S.files.length} 个CSV · ${num(S.files.reduce((n,f)=>n+f.size,0)/1024**2,1)} MB`;});}
 $('atlasImportSubmit').addEventListener('click',importData);$('restoreAtlasPublic').addEventListener('click',()=>dataOperation(async()=>{await AtlasData.request('/api/reload');S.selected.clear();await initialize();$('dataResult').textContent='已加载网站公开数据。';}));
 document.querySelectorAll('[data-close-atlas]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.closeAtlas).close()));$('atlasDataDialog').addEventListener('close',()=>$('atlasPublishToken').value='');
 $('atlasPrevious').addEventListener('click',()=>step(-1));$('atlasNext').addEventListener('click',()=>step(1));$('atlasTimeline').addEventListener('input',()=>{stop();observeDate(S.market.dates[Number($('atlasTimeline').value)]);});$('atlasPlay').addEventListener('click',()=>{if(S.timer){stop();return;}if(S.cursor===S.market.dates.length-1)S.cursor=Number($('atlasTimeline').min);$('atlasPlay').textContent='暂停';$('atlasPlay').setAttribute('aria-pressed','true');observeDate(S.market.dates[S.cursor]);S.timer=setInterval(()=>{if(S.cursor>=S.market.dates.length-1){stop();return;}observeDate(S.market.dates[++S.cursor]);if(S.view==='market'&&S.display==='heat')renderHeat();else if(S.view==='market'&&S.display==='rotation')renderRotation();},700);});
 window.addEventListener('bro:themechange',()=>S.charts.forEach(c=>c.draw()));
 window.addEventListener('pagehide',()=>{$('atlasPublishToken').value='';stop();});
 window.AtlasWorkspace={state:S,initialize,renderView,observeDate};
 initialize().catch(error=>{if(S.busy||S.market)return;notice(error.message,true);$('atlasContent').innerHTML='<p class="atlas-empty">暂未加载公开数据。可以在“数据”中重试或导入本地CSV。</p>';});
})();
