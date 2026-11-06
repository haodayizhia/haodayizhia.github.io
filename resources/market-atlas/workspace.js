'use strict';

const metricTitles={path:'累计收益',relative:'窗口超额',momentum:'窗口收益',breadth:'MA20广度',drawdown:'数据内峰值回撤',vol:'20日年化波动',dispersion:'当日个股分化'};
const metricUnit=metric=>['relative','dispersion'].includes(metric)?'百分点':'%';
const metricValue=(value,metric,n=state.market?.window===1?2:1)=>finite(value)?(['vol','breadth','dispersion'].includes(metric)?'':value>0?'+':'')+fmt(value,n)+metricUnit(metric):'—';
function metricAxisTitle(metric,kind='industry'){
 const w=state.market?.window||1;
 return {path:'自研究起点累计涨幅（%）',relative:`${windowPeriod()}领先${kind==='stock'&&state.stockBenchmark==='sector'?'本行业':'股票池'}（百分点）`,momentum:`${windowPeriod()}涨跌幅（%）`,breadth:'股价高于20日均线的占比（%）',drawdown:'较数据内历史峰值下跌（%）',vol:'近20日波动折算年化（%）',dispersion:'当日个股涨跌幅离散度（百分点）'}[metric];
}
function metricExplanation(metric,kind='industry'){
 const w=state.market?.window||1,base=kind==='stock'&&state.stockBenchmark==='sector'?'本行业等权':'股票池等权';
 return {path:'研究区间首日收盘归零；20%表示相对起点上涨20%。缩放不改变起点；行业及股票池按每日有效个股收益等权、逐日复利。',relative:`${windowPeriod()}涨跌幅减${base}同期涨跌幅；0为持平，+5个百分点表示领先5个百分点。窗口可使用研究起点之前的历史。`,momentum:w===1?'当日相对上一交易日的价格涨跌幅，不累计、不平滑；缺少前一交易日价格时留空。':`最近${w}个交易日的累计涨跌幅，与研究起点累计涨幅不同。`,breadth:'有效样本中，股价高于20日均线的股票比例。70%表示70%的有效股票站上均线；缺少均线的股票不计入分母。',drawdown:'−15%表示较此前峰值下跌15%。峰值从CSV数据起点累计到观察日，包含研究区间之前已有的历史。',vol:'近20个日收益的样本标准差乘√252。衡量价格起伏，数值越高起伏越大，不表示涨得更多；组合波动不是个股波动的平均。',dispersion:'当日个股涨跌幅的总体标准差，单位百分点。越大表示股票之间涨跌差异越大，不表示行业本身上涨。'}[metric];
}
function windowPeriod(){return state.market?.window===1?'当日':`近${state.market?.window||1}日`;}
function updateWindowLabels(){
 const daily=state.market?.window===1;metricTitles.momentum=daily?'当日涨跌幅':`${windowPeriod()}涨跌幅`;metricTitles.relative=daily?'当日超额':`${windowPeriod()}超额`;
 for(const select of document.querySelectorAll('#marketMetric,#heatMetric,[data-part="metric"]'))for(const option of select.options){
  if(option.value==='momentum')option.textContent=metricTitles.momentum;
  if(option.value==='relative')option.textContent=select.dataset.part==='metric'?(daily?'当日相对强弱':`${windowPeriod()}相对强弱`):metricTitles.relative;
  if(option.value==='heat')option.textContent=daily?'每日强弱时间图':`${windowPeriod()}强弱时间图`;
 }
}
let saveTimer=null,selectedFiles=[],selectedKind='directory',sourceBusy=false;
state.restoring=true;

function sampleCount(s,index,metric){return s?.series[metric==='breadth'?'breadth_count':'count']?.[index];}
function sampleFlag(s,index,metric){
 const n=sampleCount(s,index,metric);
 if(!s.eligible)return '当前口径没有纳入样本';
 if(s.size<=3)return '池内仅'+s.size+'只，不代表全市场行业';
 if(s.eligible<=3)return '当前口径仅'+s.eligible+'只';
 if(finite(n)&&n<=3)return '当日仅'+fmt(n,0)+'只有效';
 return '';
}
function sampleText(s,index,metric){const n=sampleCount(s,index,metric);return '有效'+(finite(n)?fmt(n,0):'—')+'/池内'+s.size+'只';}
function industrySampleHTML(name,index,metric){
 const s=sector(name);if(!s)return '';const n=sampleCount(s,index,metric),flag=sampleFlag(s,index,metric);
 const stem=metric==='vol'?'vol':'window',a=s.series[stem+'_count_min']?.[index],b=s.series[stem+'_count_max']?.[index];
 let html=`<div class="tip-note">池内成分 ${s.size}只 · 当前口径 ${s.eligible}只<br>当日${metric==='breadth'?'MA20':'收益'}有效 ${finite(n)?fmt(n,0):'—'}只</div>`;
 if((metric==='vol'||state.market.window>1)&&['relative','momentum','vol'].includes(metric)&&finite(a)&&finite(b))html+=`<div class="tip-note">近${metric==='vol'?20:state.market.window}日每日收益有效 ${a===b?fmt(a,0):fmt(a,0)+'—'+fmt(b,0)}只</div>`;
 if(flag)html+=`<div class="sample-warning">${esc(flag)}</div>`;
 return html;
}

function updateMetricNotes(){
 if(!state.market)return;
 updateWindowLabels();const m=state.market,i=state.cursor,p=m.pool,w=m.window;
 const dateIndex=state.meta.dates.indexOf(m.dates[i]),priced=state.meta.coverage[dateIndex],missing=state.meta.stocks.length-priced;
 const coverageNote=missing>state.meta.stocks.length*.05?` 观察日全数据源有${missing}只缺价（有效${priced}/${state.meta.stocks.length}），未补价；可在数据检查中核对。`:'';
 $('metricExplanation').textContent=coverageNote;$('metricExplanation').hidden=!coverageNote;
 $('marketMetric').value=state.metric;const endsAtLatest=m.dates.at(-1)===state.meta.dates.at(-1);document.querySelectorAll('[data-period]').forEach(b=>{const n=b.dataset.period,a=n==='all'?0:Math.max(0,state.meta.dates.length-Number(n));b.classList.toggle('active',endsAtLatest&&m.dates[0]===state.meta.dates[a]);});
 $('globalSummary').title=`收益有效 ${fmt(p.count[i],0)}只；MA20与成交额各使用自身有效样本。${m.mode==='complete'?'完整样本由整个研究区间确定，回放含事后筛选。':''}`;
 $('rangeNote').textContent=`${m.mode==='complete'?'区间完整样本（事后筛选）':'每日有效样本'} · 收益有效 ${fmt(p.count[i],0)} / ${m.eligible}只 · ${m.dates[0]}—${m.dates.at(-1)}`;
}
function setStockMetric(metric){
 if(!['path','momentum','relative','drawdown','vol'].includes(metric))return;
 state.stockMetric=metric;state.domainRevision++;
 if(metric!=='relative')state.stockView='lines';
 for(const pane of state.panes.values()){pane.setSeries();pane.renderList();pane.renderFrame();}
 schedule();saveSoon();
}
function updateHeatLegend(){
 const metric=$('heatMetric').value,w=state.market?.window||1;
 const limit=strengthColorLimit(w);
 document.querySelector('.heat-legend').innerHTML=metric==='breadth'?`0% <i></i> 100% <em>灰色：无有效观察</em>`:`−${limit} <i></i> +${limit} ${metricUnit(metric)} <em>颜色超界饱和 · 灰色：无观察</em>`;
}
const storageKey=source=>'market-atlas-workspace-v5:'+source;
function snapshot(){
 if(!state.market)return null;
 return {version:8,dataLatest:state.meta.dates.at(-1),start:state.market.dates[0],end:state.market.dates.at(-1),window:String(state.market.window),mode:state.market.mode,asof:state.market.dates[state.cursor],metric:state.metric,stockMetric:state.stockMetric,stockBenchmark:state.stockBenchmark,stockView:state.stockView,marketLocked:marketChart.lockedId,scale:state.scale,labelPolicy:state.labelPolicy,lowerMode:state.lowerMode,industryPins:[...state.industryPins],stockPins:[...state.stockPinSets].map(([name,pins])=>[name,[...pins]]),industrySearch:$('industrySearch').value,panes:[...state.panes.values()].map(p=>({name:p.name,...p.preferences()})),marketView:marketChart.view,heatMetric:$('heatMetric').value,heatSort:$('heatSort').value,heatDate:state.market.dates[state.heatAnchor]};
}
function saveWorkspaceNow(){
 clearTimeout(saveTimer);if(state.restoring||!state.meta||!state.market)return;
 try{localStorage.setItem(storageKey(state.meta.source),JSON.stringify(snapshot()));$('storageStatus').textContent='当前研究状态已保存在此浏览器。';}
 catch(error){$('storageStatus').textContent='浏览器未允许保存研究状态；当前探索仍可正常使用。';}
}
function saveSoon(){if(!state.restoring){clearTimeout(saveTimer);saveTimer=setTimeout(saveWorkspaceNow,300);}}
function readWorkspace(source){try{return JSON.parse(localStorage.getItem(storageKey(source))||'null');}catch{return null;}}
async function bootWorkspace(){
 state.restoring=true;stopReplay();closeExpanded();if(typeof stockDetail!=='undefined'){if(stockDetail.el.open)stockDetail.el.close();stockDetail.cache.clear();}++state.loadSeq;
 for(const pane of state.panes.values())pane.dispose();state.panes.clear();state.panePrefs.clear();state.stockPinSets.clear();state.historyCache.clear();state.industryPins.clear();state.market=null;state.hover=null;state.domainRevision++;
 refreshPaneHeader();setLower('heat');
 try{
  const health=await api('/api/health');if(!health.version||health.version<8)throw Error('数据接口版本不兼容（v'+(health.version||'未知')+'），请刷新页面重试。');
  state.meta=await api('/api/meta');const m=state.meta,prev=readWorkspace(m.source)||{};
  if(prev.end===prev.dataLatest&&prev.end<m.dates.at(-1)){if(prev.asof===prev.end)prev.asof=m.dates.at(-1);prev.end=m.dates.at(-1);}
  const industries=new Set(m.industries.map(s=>s.name)),codes=new Set(m.stocks.map(s=>s.code));
  $('dataSourceStatus').textContent=`${m.source_kind==='public'?'已发布':'本地导入'} · 截至 ${m.dates.at(-1)} · ${m.stocks.length.toLocaleString()}只`;
  state.metric=prev.version>=8&&Object.hasOwn(metricTitles,prev.metric)?prev.metric:'momentum';state.stockMetric=prev.version>=8&&['path','momentum','relative','drawdown','vol'].includes(prev.stockMetric)?prev.stockMetric:'relative';
  state.stockBenchmark=prev.stockBenchmark==='pool'?'pool':'sector';state.stockView=prev.stockView==='heat'&&state.stockMetric==='relative'?'heat':'lines';marketChart.lockedId=null;
  state.scale=prev.scale==='log'?'log':'linear';state.labelPolicy=prev.labelPolicy==='focus'?'focus':'extremes';$('scale').value=state.scale;$('labelPolicy').value=state.labelPolicy;
  for(const id of ['startDate','endDate']){$(id).min=m.dates[0];$(id).max=m.dates.at(-1);}
  const validRange=m.dates.includes(prev.start)&&m.dates.includes(prev.end)&&prev.start<=prev.end;
  $('startDate').value=validRange?prev.start:m.dates[Math.max(0,m.dates.length-252)];$('endDate').value=validRange?prev.end:m.dates.at(-1);
  $('window').value=prev.version>=8&&['1','5','20','60'].includes(prev.window)?prev.window:'1';$('cohort').value=prev.mode==='complete'?'complete':'dynamic';
  state.industryPins=new Set((prev.industryPins||[]).filter(n=>industries.has(n)));
  for(const [name,pins] of prev.stockPins||[])if(industries.has(name))state.stockPinSets.set(name,new Set(pins.filter(c=>codes.has(c))));
  $('industrySearch').value=prev.industrySearch||'';
  $('heatMetric').value=prev.version>=8&&['relative','momentum','breadth'].includes(prev.heatMetric)?prev.heatMetric:'relative';
  if(['value','asc','name','size'].includes(prev.heatSort))$('heatSort').value=prev.heatSort;
  try{await loadMarket({throwOnError:true});}catch(error){if($('cohort').value==='complete'&&error.message.includes('没有完整样本')){$('cohort').value='dynamic';await loadMarket({throwOnError:true});fail('原区间没有完整样本，已恢复每日有效样本。');}else throw error;}
  if(prev.asof&&state.market.dates.includes(prev.asof))cursor(state.market.dates.indexOf(prev.asof));
  if(state.market.sectors.some(s=>s.name===prev.marketLocked)||prev.marketLocked==='__pool')marketChart.lockedId=prev.marketLocked;
  if(validRange&&Array.isArray(prev.marketView)&&prev.marketView.length===2&&prev.marketView[0]>=0&&prev.marketView[1]<state.market.dates.length)marketChart.view=prev.marketView;
  for(const prefs of prev.panes||[])if(industries.has(prefs.name)){state.panePrefs.set(prefs.name,prefs);await openIndustry(prefs.name);}
  const lower=['heat','rotation','state','stocks'].includes(prev.lowerMode)?prev.lowerMode:'heat';setLower(lower==='stocks'&&!state.panes.size?'heat':lower);
  renderDataPanel();loadSourceChoices();updateMetricNotes();marketChart.updateViewNote();resizePlots();
 }catch(error){fail(error.message);}
 finally{state.restoring=false;$('loading').hidden=true;saveSoon();}
}

function renderDataPanel(){
 const meta=state.meta;if(!meta)return;const q=meta.quality;
 $('sourceOverview').innerHTML=`<b>${meta.stocks.length.toLocaleString()}只股票 <span>· ${meta.industries.length}个行业 · ${meta.dates.length}个交易日</span></b><p>${meta.source_kind==='public'?'网站公开数据':'浏览器本地导入'} · ${meta.dates[0]} — ${meta.dates.at(-1)}</p><small>${esc(meta.source)}</small>`;
 $('sourceDirectory').value=meta.source;
 const rows=[['成功载入',meta.stocks.length.toLocaleString()+'只'],['文件失败 / 字段不齐',q.errors.length+' / '+q.schema_errors.length],['原始行数',q.rows.toLocaleString()],['重复日期 · 保留末行',q.duplicate_rows],['无效日期 / 价格',q.invalid_dates+' / '+q.invalid_prices],['无效成交额 / 换手',q.invalid_amounts+' / '+q.invalid_turnover],['缺少最新日价格',q.missing_latest.length+'只'],['日价格收益绝对值>50%',q.derived_over_50pct+'条']];
 $('qualityStats').innerHTML=rows.map(([a,b])=>`<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
 const min=Math.min(...meta.coverage),max=Math.max(...meta.coverage),span=Math.max(1,max-min),points=meta.coverage.map((v,i)=>`${i/Math.max(1,meta.coverage.length-1)*780},${100-(v-min)/span*85}`).join(' ');
 $('coverageGraphic').innerHTML=`<svg viewBox="0 0 800 125" role="img" aria-label="价格覆盖从${meta.coverage[0]}只至${meta.coverage.at(-1)}只，最低${min}，最高${max}"><polyline points="${points}" fill="none" stroke="#9bbce9" stroke-width="2"/><text x="0" y="120">${meta.dates[0]} · ${meta.coverage[0]}只</text><text x="780" y="120" text-anchor="end">${meta.dates.at(-1)} · ${meta.coverage.at(-1)}只</text></svg>`;
 const issues=[];if(q.derived_over_50pct)issues.push(`有${q.derived_over_50pct}条日价格收益绝对值超过50%，数据保留；可在下方记录核对具体代码、日期和CSV涨幅。`);if(q.missing_latest.length)issues.push(`${q.missing_latest.length}只股票末日未覆盖，当前日数值留空。`);if(q.errors.length||q.schema_errors.length)issues.push('部分文件未成功纳入，具体原因见完整检查记录。');
 $('qualityIssues').innerHTML=issues.map(t=>`<p class="quality-note">${esc(t)}</p>`).join('');$('qualityDetails').textContent=JSON.stringify(q,null,2);
 $('methodNotes').innerHTML=[['股票池与全市场','当前池覆盖取决于你提供的文件。导入全市场CSV后按同一方法计算；股票池等权不等于沪深300或全A指数，也不使用市值权重。'],['行业样本标注','池内成分数来自本数据源的该行业股票数，不是全市场覆盖。有效数按当前指标所需字段计算；MA20广度和收益的分母可能不同。窗口收益与波动的悬停信息再列出窗口内每日收益有效数范围。当前口径≤3只的行业使用虚线和空心点。'],['等权与复利','先对当日可计算的个股价格收益等权平均，再逐日复利。研究起点收盘归零，不含该日自身涨跌。各行业独立等权，因此行业曲线的简单平均不等于全池等权。'],['每日有效 / 区间完整','每日有效样本按各指标所需字段计数，不补齐缺行。区间完整样本要求整个选定区间价格完整；回放含事后筛选，不能用它冒充当时可投资的组合。'],['价格与行业','当前数据生成脚本使用前复权“现价”；收益以相邻有效交易日价格计算。“涨幅%”保留核对，可能因除权口径不同。行业沿用每份文件最新分类，不能还原历史分类变更。导入其他来源时请自行确保同一复权口径。'],['收益、强弱与回撤','窗口收益使用最近N个交易日及起点价格；超额=对象窗口收益−比较基准同期收益；行业内部默认比较本行业，可切换股票池。回撤相对数据内已有历史峰值。缺少区间首日价格不制造归零收益，缩短区间可重新比较。'],['波动与分化','20日年化波动=20个日收益样本标准差×√252；个股分化=当日有效个股收益总体标准差，单位百分点。行业或全池的波动衡量组合，不代表成分股的平均波动。'],['全量曲线与识别','全部对象先显示。悬停临时辨认；单击曲线、末端名称或右侧名称固定关注；双击行业名称或热力图行、点击名称旁箭头均可追加行业图；点击基准图例锁定查值，和关注互相独立。点击股票名称旁箭头或双击股票打开日线量价图。'],['参与面','上方蓝色面积线是站上MA20的比例；下方淡金色柱是每日上涨比例，金线是该比例的5日简单均线。上下各自采用0—100%刻度与50%参考线，使用同一日期，分别显示各自有效样本数。'],['时间与图形操作','底部控制观察日；图中框选仅缩放本图，双击还原，右上⤢放大。行业及个股时间图随观察日按当前指标重新排序；悬停只查值，不重排。轮动点显示全部行业，悬停或固定后显示尾迹。'],['数据范围的局限','这是提供的历史股票池的描述性研究。选股方式、退市股票缺失、行业现分类与复权修订可能影响历史图形；它不自动生成买卖指令。']].map(([a,b])=>`<article><h3>${a}</h3><p>${b}</p></article>`).join('');
 $('methodNotes').insertAdjacentHTML('afterbegin','<article class="metric-reference"><h3>指标与坐标轴</h3>'+Object.keys(metricTitles).map(metric=>'<p><b>'+esc(metricAxisTitle(metric))+'</b><br>'+esc(metricExplanation(metric))+'</p>').join('')+'<p><b>行业内部相对强弱</b><br>'+esc(metricExplanation('relative','stock'))+'</p><p><b>日线量价图</b><br>点击个股旁的箭头或双击股票打开。日K使用CSV真实开高低收；缺失或不一致的开高低收不制造K线。成交量统一换算为万股，缺成交量时显示成交额并明确标注。MA5、MA10使用已有收盘历史计算，MA20来自CSV。日度图不是分时图；原始价格精度、复权口径与缺失记录决定可达到的精度。</p><p><b>个股强弱时间图</b><br>每行是一只股票，按当前观察日的相对强弱从高到低排序，与右侧列表一致；缺失值放在末尾。改变观察日自动更新排序，悬停历史日期不改变行序；暖色表示领先，冷色表示落后，灰色表示缺数据。色阶之外会饱和，精确值见悬停。图内可滚动查看全部股票，也可从右侧搜索名称或代码定位。</p><p><b>轮动图</b><br>横轴为近N日收益领先股票池的百分点；纵轴为这份领先在当日模式下较上一交易日、其他周期较5个交易日前增加的百分点。</p></article>');
}
function setSourceBusy(busy){sourceBusy=busy;document.querySelectorAll('[data-source-action]').forEach(b=>b.disabled=busy);$('importFiles').disabled=busy||!selectedFiles.length;}
async function sourceOperation(action){
 if(sourceBusy)return;saveWorkspaceNow();setSourceBusy(true);stopReplay();$('sourceStatus').textContent='正在验证CSV与历史数据，验证通过后切换…';
 try{await action();$('loading').hidden=false;await bootWorkspace();$('sourceStatus').textContent=`已启用 ${state.meta.stocks.length.toLocaleString()}只股票、${state.meta.industries.length}个行业。`;}
 catch(error){$('sourceStatus').textContent=error.message+' 原数据源保持不变。';}
 finally{setSourceBusy(false);$('loading').hidden=true;}
}
async function loadSourceChoices(){
 try{const choices=await api('/api/sources');$('sourceChoices').innerHTML=choices.map(s=>`<button data-pick-source="${esc(s.path)}" data-source-action title="验证并使用 ${esc(s.path)}">使用${esc(s.title)}${s.bytes?` <small>${fmt(s.bytes/1024/1024)}MB</small>`:''}</button>`).join('');}catch{$('sourceChoices').replaceChildren();}
}
function chooseFiles(files,kind='directory'){
 const csv=[...files].filter(f=>/\.csv$/i.test(f.name)),names=new Set();let issue='';
 if(kind==='merged'&&csv.length!==1)issue='请选择一个包含全部股票的合并CSV。';
 for(const f of csv){if(kind!=='merged'&&!/^\d{6}\.(SH|SZ|BJ)\.csv$/.test(f.name)){issue='逐股文件名应为代码格式；合并表请使用“选择合并CSV”：'+f.name;break;}if(names.has(f.name)){issue='存在同名股票文件：'+f.name;break;}if(!f.size||f.size>(kind==='merged'?2048:32)*1024*1024){issue=kind==='merged'?'合并CSV须大于0且不超过2GB。':'逐股文件须大于0且不超过32MB：'+f.name;break;}names.add(f.name);}
 selectedFiles=issue?[]:csv;selectedKind=kind;$('importFiles').disabled=!selectedFiles.length;$('folderSummary').textContent=issue||`已选${kind==='merged'?'合并表':'逐股文件'} ${csv.length.toLocaleString()}个，共 ${fmt(csv.reduce((sum,f)=>sum+f.size,0)/1024/1024)}MB；点击“导入并启用”后验证。`;
}
async function importSelected(){
 const files=[...selectedFiles];if(!files.length)return;
 await sourceOperation(async()=>{
  $('importProgress').hidden=false;$('importProgress').max=100;$('importProgress').value=0;
  await AtlasData.importFiles(files,selectedKind,progress=>{$('importProgress').value=progress.percent;$('sourceStatus').textContent=progress.message;});
  selectedFiles=[];$('folderSummary').textContent='导入成功，仅当前浏览器使用。返回公开数据或关闭页面后，本地文件不会上传到网站。';
 });
 $('importProgress').hidden=true;
}
$('marketMetric').addEventListener('change',()=>{state.metric=$('marketMetric').value;setMarketSeries();saveSoon();});
$('labelPolicy').addEventListener('change',()=>{state.labelPolicy=$('labelPolicy').value;updateMetricNotes();schedule();saveSoon();});
$('showState').addEventListener('click',()=>setLower('state'));
for(const id of ['industrySearch','heatMetric','heatSort'])$(id).addEventListener('input',saveSoon);
$('openData').addEventListener('click',()=>{stopReplay();renderDataPanel();$('dataDialog').showModal();});
$('closeData').addEventListener('click',()=>$('dataDialog').close());
document.querySelectorAll('[data-data-tab]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-data-tab]').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('[data-data-section]').forEach(s=>s.hidden=s.dataset.dataSection!==button.dataset.dataTab);}));
$('chooseFolder').addEventListener('click',()=>$('folderFiles').click());$('chooseFiles').addEventListener('click',()=>$('csvFiles').click());
$('chooseMerged').addEventListener('click',()=>$('mergedFile').click());$('mergedFile').addEventListener('change',e=>chooseFiles(e.target.files,'merged'));
for(const id of ['folderFiles','csvFiles'])$(id).addEventListener('change',e=>chooseFiles(e.target.files));
$('importFiles').addEventListener('click',importSelected);
$('switchSource').addEventListener('click',()=>sourceOperation(()=>api('/api/source',null,{method:'POST',headers:{'X-Atlas-Request':'local','Content-Type':'application/json'},body:JSON.stringify({path:$('sourceDirectory').value.trim()})})));
$('reloadData').addEventListener('click',()=>sourceOperation(()=>api('/api/reload',null,{method:'POST',headers:{'X-Atlas-Request':'local'}})));
$('resetWorkspace').addEventListener('click',async()=>{try{localStorage.removeItem(storageKey(state.meta.source));}catch{}await bootWorkspace();$('storageStatus').textContent='已恢复默认工作台：全部曲线、近一年、每日有效样本，无固定关注。';});
$('downloadQuality').addEventListener('click',()=>{const data={source:state.meta.source,stocks:state.meta.stocks.length,industries:state.meta.industries.length,start:state.meta.dates[0],end:state.meta.dates.at(-1),quality:state.meta.quality},url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='股市图谱_数据检查.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('pagehide',saveWorkspaceNow);
document.addEventListener('click',e=>{const choice=e.target.closest('[data-pick-source]');if(choice&&!sourceBusy){$('sourceDirectory').value=choice.dataset.pickSource;sourceOperation(()=>api('/api/source',null,{method:'POST',headers:{'X-Atlas-Request':'local','Content-Type':'application/json'},body:JSON.stringify({path:choice.dataset.pickSource})}));}});
