'use strict';
(function(root){
  const {escape:esc,number:num,finite,rankLatest}=AtlasCharts;
  const pct=v=>finite(v)?num(v)+'%':'—';
  const wins=v=>finite(v)?v+' / 20':'—';
  const diff=(x,y)=>finite(x)&&finite(y)?x-y:null;
  function option(value,label,selected){
    return `<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;
  }
  function extent(values){
    let lo=0,hi=0;
    for(const v of values)if(finite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v);}
    const margin=Math.max((hi-lo)*.05,.5);return [lo-margin,hi+margin];
  }
  function records(data,meta){
    return data.points.map(([i,value,groupWins,marketWins])=>({...meta.stocks[i],i,value,groupWins,marketWins}));
  }
  // The shared percentage mapping is used by the header and every row.
  const distributionX=(v,domain)=>100*(v-domain[0])/(domain[1]-domain[0]);
  const within=(v,domain)=>finite(v)&&v>=domain[0]&&v<=domain[1];
  const at=(v,domain)=>'left:'+distributionX(v,domain)+'%';
  function distributionTicks(domain){
    return AtlasCharts.ticks(domain[0],domain[1],4).filter(v=>within(v,domain));
  }
  function distributionAxis(domain){
    return `<div class="dist-axis" aria-label="20日收益共享横轴">${distributionTicks(domain).map(v=>`<span style="${at(v,domain)}">${num(v,1)}%</span>`).join('')}</div>`;
  }
  function heatAxis(dates){
    const n=dates.length,indices=[...new Set([0,Math.round((n-1)/3),Math.round((n-1)*2/3),n-1])];
    return `<div class="heat-axis">${indices.map((i,j)=>`<span class="${j===0?'first':j===indices.length-1?'last':''}" style="left:${100*(i+.5)/n}%">${dates[i].slice(5)}</span>`).join('')}</div>`;
  }
  function distribution(points,group,market,domain){
    const guide=(v,cls)=>within(v,domain)?`<span class="dist-guide ${cls}" style="${at(v,domain)}"></span>`:'';
    const lo=group.p10.at(-1),hi=group.p90.at(-1),sector=group.sector.at(-1),a=Math.max(lo,domain[0]),b=Math.min(hi,domain[1]);
    return `<div class="dist-plot" role="group" aria-label="${esc(group.name)} 20日成分股收益分布">
      ${distributionTicks(domain).map(v=>guide(v,'dist-grid')).join('')}${guide(0,'dist-zero')}${guide(market,'dist-market')}
      ${finite(lo)&&finite(hi)&&a<b?`<span class="dist-range" style="${at(a,domain)};width:${distributionX(b,domain)-distributionX(a,domain)}%"></span>`:''}
      ${points.filter(p=>within(p.value,domain)).map(p=>`<span class="dist-point" data-point-id="${p.i}" title="${esc(p.name)} · ${pct(p.value)}" style="${at(p.value,domain)}"></span>`).join('')}
      ${guide(group.median.at(-1),'dist-median')}
      ${within(sector,domain)?`<span class="dist-diamond" style="${at(sector,domain)}"></span>`:''}</div>`;
  }
  function paintHeat(canvas,values,colors){
    canvas.width=values.length;canvas.height=1;
    const ctx=canvas.getContext('2d');
    values.forEach((v,i)=>{
      ctx.fillStyle=finite(v)?v>=0?colors.rise:colors.fall:colors.missing;
      ctx.globalAlpha=finite(v)?Math.min(1,Math.abs(v)/18)*.8+.08:1;
      ctx.fillRect(i,0,1,1);
    });
  }
  function market(host,options){
    const {state:s,data,graph,openIndustry,persist}=options,{summary}=data;
    const points=records(data,s.meta),byGroup=new Map(summary.groups.map(g=>[g.name,[]]));
    for(const p of points)byGroup.get(p.industry)?.push(p);
    const pool=summary.pool.at(-1);
    host.innerHTML=`<div class="structure-toolbar"><label>范围 <select data-scope>${option('industry','行业结构',s.structureScope)}${option('stocks','全池个股',s.structureScope)}</select></label><span data-scope-controls></span></div><div id="marketParticipation"></div><div id="structureBody"></div>`;
    graph('marketParticipation',{dates:summary.dates,series:[{id:'up',name:'当日上涨比例',values:s.market.pool.up,color:'var(--plot-blue)'}],unit:'%',domain:[0,100],label:'股票池上涨比例',compact:true});
    const controls=host.querySelector('[data-scope-controls]'),body=host.querySelector('#structureBody');
    const fullDomain=extent(points.map(p=>p.value).concat(summary.groups.map(g=>g.sector.at(-1)),pool));let domain=[...fullDomain];
    const zoomed=()=>domain[0]!==fullDomain[0]||domain[1]!==fullDomain[1];
    function zoomDistribution(factor,anchor){const width=fullDomain[1]-fullDomain[0],span=domain[1]-domain[0];if(factor===0||span/factor>=width){domain=[...fullDomain];}else if(span/factor>=Math.min(1,width)){let [a,b]=AtlasCharts.zoomDomain(domain,factor,anchor);if(a<fullDomain[0]){b+=fullDomain[0]-a;a=fullDomain[0];}if(b>fullDomain[1]){a-=b-fullDomain[1];b=fullDomain[1];}domain=[a,b];}draw();}
    function draw(){
      const scroll=body.querySelector('.structure-rows')?.scrollTop||0;body.dataset.mobileMode=s.structureMobile;
      if(s.structureScope==='stocks'){
        controls.innerHTML=`<label><input type="checkbox" data-weak ${s.weakOnly?'checked':''}> 仅行业20日落后于池</label>`;
        controls.querySelector('input').onchange=e=>{s.weakOnly=e.target.checked;s.pointBrush=null;persist();draw();};
        const weak=new Set(summary.groups.filter(g=>finite(g.sector.at(-1))&&finite(pool)&&g.sector.at(-1)<pool).map(g=>g.name));
        scatter(body,s.weakOnly?points.filter(p=>weak.has(p.industry)):points,options);
        return;
      }
      controls.innerHTML=`<label>行序 <select data-sort>${option('wins','20日领先天数',s.structureSort)}${option('excess','20日超额',s.structureSort)}${option('name','行业名称',s.structureSort)}</select></label>`;
      controls.querySelector('select').onchange=e=>{s.structureSort=e.target.value;persist();draw();};
      const known=new Set(s.market.sectors.filter(g=>g.series.price_count.some(n=>n>0)).map(g=>g.name));
      const groups=rankLatest(summary.groups.filter(g=>known.has(g.name)),g=>s.structureSort==='wins'?g.wins.at(-1):s.structureSort==='excess'?diff(g.sector.at(-1),pool):0);
      body.innerHTML=`<div class="structure-mode"><button data-mobile="dist" aria-pressed="${s.structureMobile!=='heat'}">成分分布</button><button data-mobile="heat" aria-pressed="${s.structureMobile==='heat'}">强弱历史</button></div>
        <div class="structure-legend structure-legend-inline">
          <span class="sr-heat heat-legend"><i class="heat-key"></i> 落后 / 领先</span>
          <span class="sr-dist dist-legend"><span><i class="legend-point"></i>个股</span><span><i class="legend-range"></i>中间约80%</span><span><i class="legend-median"></i>中位数</span><span><i class="legend-diamond"></i>行业收益</span><span><i class="legend-market"></i>股票池收益</span><span><i class="legend-zero"></i>零收益</span></span>
          <details class="structure-method"><summary>统计口径</summary><div>5日超额为行业与股票池5日收益之差（百分点）；颜色饱和于 ±18。P10–P90 为第10至90百分位（中间约80%的成分股收益范围）。个股20日累计收益须有完整20个交易日数据；上涨占比为正收益家数 / 有效家数。点行业深入、点个股查值；顶部选择观察日。</div></details>
          <span class="sr-dist dist-actions"><button data-dist-zoom="out" title="缩小收益轴" aria-label="缩小收益轴">−</button><button data-dist-zoom="in" title="放大收益轴" aria-label="放大收益轴">＋</button><button data-dist-zoom="reset" ${zoomed()?'':'disabled'} title="恢复完整收益范围">全范围</button></span>
        </div>
        <div class="structure-rows" data-mobile-mode="${esc(s.structureMobile)}"><div class="structure-row structure-columns"><span>行业</span><div class="sr-heat"><div class="structure-col-title">5日超额收益（百分点）</div>${heatAxis(summary.dates)}</div><div class="sr-dist"><div class="structure-col-title">20日个股收益分布（%）${zoomed()?' · 缩放中':''}</div>${distributionAxis(domain)}</div><span>20日上涨占比</span></div>${groups.map(g=>{
          const members=byGroup.get(g.name)||[];
          return `<div class="structure-row"><button class="structure-name" data-group="${esc(g.name)}" title="${esc(g.name)} · 领先 ${wins(g.wins.at(-1))} 天 · 行业 ${pct(g.sector.at(-1))}">${esc(g.name)}</button><div class="sr-heat"><canvas class="structure-heat" data-heat-group="${esc(g.name)}" aria-label="5日超额历史"></canvas></div><div class="sr-dist">${distribution(members,g,pool,domain)}</div><span class="structure-up" title="近20日正收益家数 / 有效家数">${g.count.at(-1)?num(100*g.up.at(-1)/g.count.at(-1),1)+'%':'—'} <small>(${g.up.at(-1)}/${g.count.at(-1)})</small></span></div>`;
        }).join('')}</div><div class="structure-selection" aria-live="polite"></div>`;
      const style=getComputedStyle(host),colors={rise:style.getPropertyValue('--rise'),fall:style.getPropertyValue('--fall'),missing:style.getPropertyValue('--subtle')};
      const groupMap=new Map(groups.map(g=>[g.name,g]));
      const column=(canvas,event)=>Math.max(0,Math.min(summary.dates.length-1,Math.floor((event.clientX-canvas.getBoundingClientRect().left)/canvas.clientWidth*summary.dates.length)));
      body.querySelectorAll('[data-heat-group]').forEach(canvas=>{
        const values=groupMap.get(canvas.dataset.heatGroup).excess5;
        paintHeat(canvas,values,colors);
        canvas.onpointermove=e=>{const i=column(canvas,e);canvas.title=summary.dates[i]+' · '+num(values[i])+' 个百分点';};
        canvas.onclick=e=>{const i=column(canvas,e);body.querySelector('.structure-selection').textContent=gLabel(canvas.dataset.heatGroup,summary.dates[i],values[i]);};
      });
      const gLabel=(name,date,value)=>name+' · '+date+' · 5日超额 '+(finite(value)?num(value)+' 个百分点':'—');
      const read=body.querySelector('.structure-selection');
      body.querySelector('.structure-rows').scrollTop=scroll;
      body.querySelector('.dist-axis')?.addEventListener('wheel',e=>{e.preventDefault();const r=e.currentTarget.getBoundingClientRect();zoomDistribution(Math.exp(-e.deltaY*.002),Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));},{passive:false});
      body.querySelector('.structure-rows').ondblclick=e=>{if(e.target.closest('.sr-dist')){e.preventDefault();zoomDistribution(0,.5);}};
      function selectPoint(p){
        if(!p)return;
        s.structurePoint=p.code;persist();
        read.innerHTML=pointRead(p,summary)+` <button class="point-open">查看日线 ↗</button>`;
        read.querySelector('button').onclick=()=>options.openStock(p.code);
      }
      selectPoint(points.find(p=>p.code===s.structurePoint));
      body.onclick=e=>{
        const button=e.target.closest('[data-group]'),pt=e.target.closest('[data-point-id]'),mobile=e.target.closest('[data-mobile]'),zoom=e.target.closest('[data-dist-zoom]');
        if(zoom){const action=zoom.dataset.distZoom,anchor=Math.max(0,Math.min(1,(0-domain[0])/(domain[1]-domain[0])));zoomDistribution(action==='reset'?0:action==='in'?1.6:1/1.6,anchor);return;}
        if(button)openIndustry(button.dataset.group);
        if(pt){selectPoint(points.find(p=>p.i===Number(pt.dataset.pointId)));read.scrollIntoView({block:'nearest'});}
        if(mobile){s.structureMobile=mobile.dataset.mobile;persist();draw();}
      };
    }
    host.querySelector('[data-scope]').onchange=e=>{s.structureScope=e.target.value;s.pointBrush=null;body.onclick=null;persist();draw();};
    draw();
  }
  function pointRead(p,summary){
    const sector=summary.groups.find(g=>g.name===p.industry)?.sector.at(-1),market=summary.pool.at(-1);
    return `<b>${esc(p.name)} · ${esc(p.code)}</b>　${esc(p.industry)}　20日 ${pct(p.value)}　行业 ${pct(sector)}　股票池 ${pct(market)}　跑赢行业 ${wins(p.groupWins)} 天　跑赢池 ${wins(p.marketWins)} 天`;
  }
  function scatter(host,points,{state:s,data,openStock,persist},group){
    host.onclick=null;
    const rows=points.filter(p=>finite(p.groupWins)),market=data.summary.pool.at(-1);
    const domain=extent(rows.map(p=>p.value).concat(market,group?.sector.at(-1)));
    host.innerHTML=`<div class="scatter-actions"><b>成分股 · 20日收益与领先比例</b><button data-brush aria-pressed="false">框选</button><button data-reset>全部范围</button><button data-expand>全屏</button></div><div class="point-surface"></div><div class="point-controls"><label>查找 <input type="search" placeholder="股票名称或代码" aria-label="查找散点股票"></label><select aria-label="选择散点股票"></select></div><div class="point-detail" aria-live="polite"></div>`;
    const surface=host.querySelector('.point-surface'),search=host.querySelector('input'),list=host.querySelector('select'),detail=host.querySelector('.point-detail'),brush=host.querySelector('[data-brush]');
    let box=null,searchText='',choices=[],brushing=false,frame=null;
    const base=[0,20,...domain],W=600,H=240,left=55,right=585,top=12,bottom=204;
    function views(){return s.pointBrush||base;}
    const X=v=>left+(v-views()[0])*(right-left)/(views()[1]-views()[0]);
    const Y=v=>bottom-(v-views()[2])*(bottom-top)/(views()[3]-views()[2]);
    const visible=p=>finite(p.groupWins)&&p.groupWins>=views()[0]&&p.groupWins<=views()[1]&&p.value>=views()[2]&&p.value<=views()[3];
    function select(code){
      const p=points.find(p=>p.code===code);
      s.structurePoint=p?.code||'';persist();list.value=s.structurePoint;
      detail.innerHTML=p?pointRead(p,data.summary)+' <button>查看日线 ↗</button>':'点选或搜索个股；重合点可从选择框逐只查看。';
      if(p)detail.querySelector('button').onclick=()=>openStock(p.code);
      surface.querySelectorAll('.chosen').forEach(c=>c.classList.remove('chosen'));
      if(p)surface.querySelector('[data-dot="'+p.i+'"]')?.classList.add('chosen');
    }
    function fill(matches){
      choices=matches||points.filter(p=>(!s.pointBrush||visible(p))&&(!searchText||(p.name+p.code).toLowerCase().includes(searchText)));
      list.innerHTML=option('','选择股票（'+choices.length+'）','')+choices.map(p=>option(p.code,p.name+' '+p.code,s.structurePoint)).join('');
    }
    function draw(){
      const [xl,xr,yl,yr]=views(),yt=AtlasCharts.ticks(yl,yr,4);
      const guid=(v,cls)=>finite(v)&&v>=yl&&v<=yr?`<line x1="${left}" x2="${right}" y1="${Y(v)}" y2="${Y(v)}" class="${cls}"/>`:'';
      surface.innerHTML=`<svg class="point-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="20日绝对收益与跑赢行业天数散点图">
        ${yt.map(v=>`<path class="point-grid" d="M${left},${Y(v)}H${right}"/><text x="${left-5}" y="${Y(v)+4}" text-anchor="end">${num(v,1)}%</text>`).join('')}
        ${[0,5,10,15,20].filter(x=>x>=xl&&x<=xr).map(x=>`<text x="${X(x)}" y="${bottom+16}" text-anchor="middle">${x*5}%</text>`).join('')}
        <text x="${(left+right)/2}" y="238" text-anchor="middle">20日内跑赢本行业的天数占比</text>${guid(0,'dist-zero')}${guid(market,'dist-market')}${guid(group?.sector.at(-1),'point-sector')}
        ${rows.filter(visible).map(p=>`<circle cx="${X(p.groupWins)}" cy="${Y(p.value)}" r="3.2" data-dot="${p.i}" class="${p.code===s.structurePoint?'chosen':''}"><title>${esc(p.name)} · ${pct(p.value)} · ${wins(p.groupWins)}</title></circle>`).join('')}<rect class="brush-box" width="0" height="0"/></svg>`;
      frame=surface.querySelector('svg');surface.dataset.brush=String(brushing);fill();
    }
    function position(e){const pt=new DOMPoint(e.clientX,e.clientY).matrixTransform(frame.getScreenCTM().inverse());return [Math.max(left,Math.min(right,pt.x)),Math.max(top,Math.min(bottom,pt.y))];}
    surface.onpointerdown=e=>{if(!brushing)return;box=position(e);surface.setPointerCapture(e.pointerId);};
    surface.onpointermove=e=>{if(!box)return;const p=position(e),rect=frame.querySelector('.brush-box');for(const [k,v] of Object.entries({x:Math.min(box[0],p[0]),y:Math.min(box[1],p[1]),width:Math.abs(box[0]-p[0]),height:Math.abs(box[1]-p[1])}))rect.setAttribute(k,v);};
    surface.onpointercancel=()=>{box=null;draw();};
    surface.onpointerup=e=>{
      if(!box)return;const p=position(e),q=box;box=null;
      if(Math.abs(p[0]-q[0])>4&&Math.abs(p[1]-q[1])>4){
        const [a,b,c,d]=views(),ix=x=>a+(x-left)*(b-a)/(right-left),iy=y=>c+(bottom-y)*(d-c)/(bottom-top);
        s.pointBrush=[ix(Math.min(p[0],q[0])),ix(Math.max(p[0],q[0])),iy(Math.max(p[1],q[1])),iy(Math.min(p[1],q[1]))];persist();
      }
      brushing=false;brush.setAttribute('aria-pressed','false');draw();
    };
    surface.onclick=e=>{
      const dot=e.target.closest('[data-dot]');if(!dot||brushing)return;
      const p=rows.find(v=>v.i===Number(dot.dataset.dot));
      const near=rows.filter(v=>visible(v)&&Math.abs(X(v.groupWins)-X(p.groupWins))<5&&Math.abs(Y(v.value)-Y(p.value))<5);
      if(near.length>1)fill(near);else fill();select(p.code);
    };
    search.oninput=()=>{searchText=search.value.trim().toLowerCase();fill();if(searchText&&choices.length===1)select(choices[0].code);};
    list.onchange=()=>select(list.value);
    brush.onclick=()=>{brushing=!brushing;surface.dataset.brush=String(brushing);brush.setAttribute('aria-pressed',String(brushing));};
    const reset=()=>{s.pointBrush=null;search.value=searchText='';persist();draw();};
    host.querySelector('[data-reset]').onclick=reset;surface.ondblclick=e=>{e.preventDefault();reset();};
    host.querySelector('[data-expand]').onclick=()=>AtlasFullscreen.open(host,'成分股收益与领先天数');
    draw();if(points.some(p=>p.code===s.structurePoint))select(s.structurePoint);
    else detail.textContent=points.length?'有效收益 '+points.length+' 只，可比较领先天数 '+rows.length+' 只。':'当前观察日没有完整20日收益。';
  }
  function industry(host,options){
    const {state:s,data,graph}=options,{summary}=data,g=summary.groups.find(g=>g.name===s.industry);
    if(!g)return;
    host.innerHTML=`<div class="structure-legend">浅带 P10–P90（第10至90百分位） · 中位数、行业等权、股票池等权 · 20日上涨 ${g.up.at(-1)} / ${g.count.at(-1)} 只</div><div id="industryBand"></div><details class="breadth-details"><summary>上涨家数历史</summary><p class="structure-legend">较前一交易日，共同样本转为正收益 ${g.gained.at(-1)??'—'} 只，转为非正 ${g.lost.at(-1)??'—'} 只；窗口样本新增 ${g.joined.at(-1)??'—'} 只、退出 ${g.left.at(-1)??'—'} 只。</p><div id="industryParticipation"></div></details><div id="industryPoints"></div>`;
    const series=[['median','成分中位数','blue'],['sector','行业等权','gold'],['pool','股票池等权','main']].map(([id,name,color])=>({id,name,color:'var(--plot-'+color+')',values:id==='pool'?summary.pool:g[id]}));
    graph('industryBand',{dates:summary.dates,series,band:[g.p10,g.p90],unit:'%',label:s.industry+' · 20日收益分布'});
    const details=host.querySelector('details');
    details.open=!!s.showBreadth;
    const breadth=()=>graph('industryParticipation',{dates:summary.dates,series:[{id:'participation',name:'20日正收益占比',color:'var(--plot-teal)',values:g.up.map((v,i)=>g.count[i]?100*v/g.count[i]:null)}],domain:[0,100],unit:'%',label:'20日上涨比例',compact:true});
    if(details.open)breadth();
    details.ontoggle=()=>{s.showBreadth=details.open;options.persist();if(host.isConnected&&details.open&&!host.querySelector('#industryParticipation svg'))breadth();};
    scatter(host.querySelector('#industryPoints'),records(data,s.meta).filter(p=>p.industry===s.industry),options,g);
  }
  function linkage(host,market,s,persist){
    const sectors=market.sectors.filter(g=>g.series.count.some(n=>n>0));
    if(sectors.length<2){host.textContent='当前区间至少需要两个有效行业。';return;}
    const names=sectors.map(g=>g.name);
    if(!names.includes(s.pairA))s.pairA=names[0];
    if(!names.includes(s.pairB)||s.pairA===s.pairB)s.pairB=names.find(n=>n!==s.pairA);
    host.innerHTML=`<div class="structure-toolbar"><label>行业 A <select data-a>${names.map(n=>option(n,n,s.pairA)).join('')}</select></label><label>行业 B <select data-b>${names.filter(n=>n!==s.pairA).map(n=>option(n,n,s.pairB)).join('')}</select></label></div><div data-pair-results></div>`;
    const a=sectors.find(g=>g.name===s.pairA).series.ret,b=sectors.find(g=>g.name===s.pairB).series.ret;
    const relative=v=>v.map((x,i)=>diff(x,market.pool.ret[i])),x=relative(a),y=relative(b);
    const raw=AtlasStructure.correlation(a,b),net=AtlasStructure.correlation(x,y);
    const bars=Array.from({length:11},(_,i)=>AtlasStructure.correlation(x,y,i-5));
    host.querySelector('[data-pair-results]').innerHTML=`<p>日收益相关 <b>${num(raw.value,3)}</b>（${raw.n} 对）　减去股票池后 <b>${num(net.value,3)}</b>（${net.n} 对）</p><svg class="lag-plot" viewBox="0 0 550 120" aria-label="相对日收益滞后相关，从负5到正5个交易日"><path class="dist-zero" d="M10,52H540"/>${bars.map((p,i)=>`<g><title>${i-5}日：${num(p.value,3)}，${p.n} 对</title>${finite(p.value)?`<rect x="${18+i*48}" y="${52-Math.max(0,p.value)*42}" width="21" height="${Math.max(1,Math.abs(p.value)*42)}" fill="var(--plot-blue)"/>`:''}<text x="${28+i*48}" y="112" text-anchor="middle">${i-5}</text></g>`).join('')}</svg><p class="structure-legend">共同有效交易日 · 滞后为正表示 A 先于 B。图示样本相关；没有做显著性或预测检验。</p>`;
    for(const [key,field] of [['a','pairA'],['b','pairB']])host.querySelector('[data-'+key+']').onchange=e=>{s[field]=e.target.value;persist();linkage(host,market,s,persist);};
  }
  root.AtlasResearch={market,industry,linkage,distributionX,distributionTicks};
})(globalThis);
