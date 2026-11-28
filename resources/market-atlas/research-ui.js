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
    return `<div class="dist-axis" tabindex="0" role="group" aria-label="20日收益共享横轴" title="滚轮缩放 · 拖动平移 · 双指缩放 · 双击复原；键盘 + / − / ← / → / 0">${distributionTicks(domain).map(v=>`<span style="${at(v,domain)}">${num(v,1)}%</span>`).join('')}</div>`;
  }
  // Transform one shared domain. The original anchor remains under the pointer,
  // unless the requested view would extend beyond the complete data range.
  function distributionView(view,full,factor,from=.5,to=from){
    if(!finite(factor)||factor<=0)return [...full];
    const total=full[1]-full[0],span=view[1]-view[0];
    const width=Math.max(Math.min(1,total),Math.min(total,span/factor));
    if(width>=total)return [...full];
    const pivot=view[0]+span*from;
    const left=Math.max(full[0],Math.min(full[1]-width,pivot-width*to));
    return [left,left+width];
  }
  function distributionRank(group,pool,sort){
    if(sort==='wins')return group.wins.at(-1);
    if(sort==='excess')return diff(group.sector.at(-1),pool);
    if(sort==='excess5')return group.excess5.at(-1);
    if(sort==='breadth'){const count=group.count.at(-1);return count?group.up.at(-1)/count:null;}
    return 0;
  }
  // Pointer capture is on the stable container, never on a point that is
  // replaced while scaling. Native vertical touch scrolling remains available.
  function bindDistributionGestures(body,{getView,full,setView,onPoint,pointAt}){
    const active=new Map();let gesture=null,pending=null,tapTimer=null;
    const clearTap=()=>{clearTimeout(tapTimer);pending=null;};
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const fraction=(x,r)=>clamp((x-r.left)/Math.max(1,r.width),0,1);
    const coord=e=>({x:e.clientX,y:e.clientY});
    const cell=e=>e.target.closest('.dist-plot,.dist-axis');
    const transform=(view,factor,from,to)=>setView(distributionView(view,full,factor,from,to));
    const reset=()=>{clearTap();setView([...full]);};
    function queueTap(p,type,id){
      const previous=pending,radius=type==='touch'?24:8,delay=type==='touch'?280:450;
      if(previous&&previous.type===type&&Math.hypot(p.x-previous.x,p.y-previous.y)<radius){reset();return;}
      if(previous){clearTap();if(previous.id!=null&&body.isConnected)onPoint(previous.id);}
      pending={...p,type,id};tapTimer=setTimeout(()=>{const tap=pending;clearTap();if(tap?.id!=null&&body.isConnected)onPoint(tap.id);},delay);
    }
    function pinch(){
      const [a,b]=active.values();return {x:(a.x+b.x)/2,d:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
    }
    function beginPinch(){
      clearTap();const p=pinch();
      gesture={...gesture,mode:'pinch',view:[...getView()],anchor:fraction(p.x,gesture.rect),distance:p.d,moved:true};
    }
    body.onpointerdown=e=>{
      const target=cell(e);if(!target||e.button!==0||active.size>=2)return;
      if(active.size&&e.pointerType!=='touch')return;
      const p=coord(e);active.set(e.pointerId,p);
      body.setPointerCapture(e.pointerId);
      if(active.size===2){beginPinch();return;}
      const rect=target.getBoundingClientRect();
      gesture={mode:'single',type:e.pointerType,rect,view:[...getView()],start:p,anchor:fraction(p.x,rect),moved:false,id:pointAt?pointAt(target,p,e.pointerType):e.target.closest('[data-point-id]')?.dataset.pointId};
    };
    body.onpointermove=e=>{
      if(!active.has(e.pointerId)||!gesture)return;
      const p=coord(e);active.set(e.pointerId,p);
      if(gesture.mode==='pinch'&&active.size===2){
        const now=pinch();transform(gesture.view,now.d/gesture.distance,gesture.anchor,fraction(now.x,gesture.rect));return;
      }
      if(gesture.mode!=='single')return;
      const dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;
      if(!gesture.moved&&Math.hypot(dx,dy)>6){gesture.moved=true;clearTap();}
      if(!gesture.moved)return;
      if(gesture.type==='touch'&&Math.abs(dx)<=Math.abs(dy))return;
      body.classList.add('dist-dragging');
      transform(gesture.view,1,gesture.anchor,fraction(p.x,gesture.rect));
    };
    const end=(e,cancel=false)=>{
      if(!active.has(e.pointerId))return;
      active.delete(e.pointerId);
      if(body.hasPointerCapture(e.pointerId))body.releasePointerCapture(e.pointerId);
      if(!gesture)return;
      if(cancel){clearTap();gesture.moved=true;}
      if(active.size){gesture.mode='ended';return;}
      if(!cancel&&gesture.mode==='single'&&!gesture.moved)queueTap(coord(e),gesture.type,gesture.id);
      gesture=null;body.classList.remove('dist-dragging');
    };
    body.onpointerup=e=>end(e);
    body.onpointercancel=e=>end(e,true);
    body.onlostpointercapture=e=>end(e,true);
    // Only the actual plotting surfaces need a non-passive wheel listener.
    // The rest of the table can scroll natively without waiting for this handler.
    const wheel=e=>{
      const target=e.currentTarget;
      if(!e.deltaY)return;
      e.preventDefault();clearTap();
      const rect=target.getBoundingClientRect(),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?Math.max(1,rect.width):1);
      const anchor=fraction(e.clientX,rect);
      transform(getView(),Math.exp(clamp(-delta*.002,-2,2)),anchor,anchor);
    };
    const attachWheel=target=>target.addEventListener('wheel',wheel,{passive:false});
    body.ondblclick=e=>{if(cell(e)){e.preventDefault();reset();}};
    body.onkeydown=e=>{
      if(!e.target.closest('.dist-axis'))return;
      const key=e.key;if(!['+','=','-','0','ArrowLeft','ArrowRight'].includes(key))return;
      e.preventDefault();clearTap();
      if(key==='0'){reset();return;}
      const view=getView();
      if(key==='ArrowLeft'||key==='ArrowRight')transform(view,1,.5,key==='ArrowLeft'?.7:.3);
      else transform(view,key==='-'?1/1.6:1.6,.5,.5);
    };
    return {attachWheel,cancel(){clearTap();for(const id of active.keys()){active.delete(id);if(body.hasPointerCapture(id))body.releasePointerCapture(id);}gesture=null;body.classList.remove('dist-dragging');}};
  }
  function heatAxis(dates){
    const n=dates.length,indices=[...new Set([0,Math.round((n-1)/3),Math.round((n-1)*2/3),n-1])];
    return `<div class="heat-axis">${indices.map((i,j)=>`<span class="${j===0?'first':j===indices.length-1?'last':''}" style="left:${100*(i+.5)/n}%">${dates[i].slice(5)}</span>`).join('')}</div>`;
  }
  function distribution(group){
    return `<canvas class="dist-plot" role="img" aria-label="${esc(group.name)} 20日成分股收益分布"></canvas>`;
  }
  // Draw the same statistics and every individual return, using CSS pixel
  // dimensions and a HiDPI backing store. Symbols keep their size while zooming.
  function paintDistribution(ctx,width,height,points,group,market,domain,ticks,colors,hover){
    const X=v=>distributionX(v,domain)*width/100;
    const guide=(v,color,lineWidth,alpha=1,dash=[],top=0,bottom=height)=>{
      if(!within(v,domain))return;
      ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.globalAlpha=alpha;ctx.setLineDash(dash);
      ctx.beginPath();ctx.moveTo(X(v),top);ctx.lineTo(X(v),bottom);ctx.stroke();
    };
    ctx.clearRect(0,0,width,height);
    for(const v of ticks)guide(v,colors.muted,1,.13);
    guide(0,colors.muted,1,.65,[4,3]);
    guide(market,colors.teal,1.5,1,[1.5,2.5]);
    ctx.setLineDash([]);ctx.globalAlpha=.55;ctx.fillStyle=colors.blue;
    const lo=group.p10.at(-1),hi=group.p90.at(-1);
    if(finite(lo)&&finite(hi)){
      const a=Math.max(lo,domain[0]),b=Math.min(hi,domain[1]);
      if(a<b){const x=X(a),w=X(b)-x;ctx.beginPath();ctx.roundRect(x,15,w,4,Math.min(2,w/2));ctx.fill();}
    }
    ctx.fillStyle=colors.slate;ctx.globalAlpha=.8;
    // Fill each circle separately, preserving the original opacity for overlaps.
    for(const p of points)if(within(p.value,domain)){ctx.beginPath();ctx.arc(X(p.value),17,2.2,0,Math.PI*2);ctx.fill();}
    guide(group.median.at(-1),colors.main,2.5,1,[],11,23);
    const sector=group.sector.at(-1);
    if(within(sector,domain)){const x=X(sector),r=3*Math.SQRT2;ctx.fillStyle=colors.gold;ctx.globalAlpha=1;ctx.beginPath();ctx.moveTo(x,4-r);ctx.lineTo(x+r,4);ctx.lineTo(x,4+r);ctx.lineTo(x-r,4);ctx.closePath();ctx.fill();}
    if(hover&&within(hover.value,domain)){ctx.globalAlpha=1;ctx.fillStyle=colors.gold;ctx.strokeStyle=colors.ink;ctx.lineWidth=1;ctx.beginPath();ctx.arc(X(hover.value),17,2.6,0,Math.PI*2);ctx.fill();ctx.stroke();}
    ctx.globalAlpha=1;ctx.setLineDash([]);
  }
  // Points share a single horizontal line. Use a generous horizontal
  // snap radius and the entire plotting row as the vertical target, rather
  // than requiring the pointer to land on a tiny painted circle.
  function distributionHit(points,domain,width,x,y,radius=12){
    if(!width||x<0||x>width||y<0||y>28)return null;
    let result=null,best=radius;
    for(const p of points){if(!within(p.value,domain))continue;const d=Math.abs(distributionX(p.value,domain)*width/100-x);if(d<=best){best=d;result=p;}}
    return result;
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
    const groupByName=new Map(summary.groups.map(g=>[g.name,g]));
    const colorTokens={muted:'--muted',teal:'--plot-teal',blue:'--plot-blue',slate:'--plot-slate',main:'--plot-main',gold:'--plot-gold',ink:'--ink'};
    const pointById=new Map(points.map(p=>[String(p.i),p]));
    let frame=0,rows=null,entries=[],width=0,dpr=1,colors=null,paintedDomain=null,paintedTicks=[],revision=0,observer=null;
    function selectPoint(p,scroll=false){
      const read=body.querySelector('.structure-selection');if(!p||!read)return;
      s.structurePoint=p.code;persist();
      read.innerHTML=pointRead(p,summary)+` <button class="point-open">查看日线 ↗</button>`;
      read.querySelector('button').onclick=()=>options.openStock(p.code);
      if(scroll)read.scrollIntoView({block:'nearest'});
    }
    function requestPaint(){if(!frame)frame=requestAnimationFrame(refreshDistribution);}
    function paintEntry(entry){
      if(!width||entry.revision===revision||!paintedDomain)return;
      const {canvas}=entry,pw=Math.max(1,Math.round(width*dpr)),ph=Math.round(28*dpr);
      if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
      const ctx=canvas.getContext('2d');
      ctx.setTransform(pw/width,0,0,ph/28,0,0);
      paintDistribution(ctx,width,28,entry.points,entry.group,pool,paintedDomain,paintedTicks,colors,entry.hover);
      entry.revision=revision;
    }
    function measureDistribution(){
      if(!body.isConnected||!rows)return;
      const axis=rows.querySelector('.dist-axis'),next=axis?.clientWidth||0,ratio=Math.min(window.devicePixelRatio||1,2);
      // Read layout before drawing; all rows have one shared grid column.
      for(const entry of entries){entry.top=entry.row.offsetTop;entry.bottom=entry.top+entry.row.offsetHeight;}
      if(next!==width||ratio!==dpr){width=next;dpr=ratio;revision++;}
      requestPaint();
    }
    function refreshDistribution(){
      frame=0;if(!body.isConnected||s.structureScope!=='industry'||!rows||!width)return;
      const axis=rows.querySelector('.dist-axis');
      if(!paintedDomain||paintedDomain[0]!==domain[0]||paintedDomain[1]!==domain[1]){
        paintedDomain=[...domain];paintedTicks=distributionTicks(paintedDomain);revision++;
        const title=rows.querySelector('.structure-columns .sr-dist .structure-col-title'),label='20日个股收益分布（%）'+(zoomed()?' · 缩放中':'');
        if(title.textContent!==label)title.textContent=label;
        // Reuse tick nodes as long as the tick values have not changed.
        const stamp=paintedTicks.join(',');
        if(axis.dataset.tickStamp!==stamp){axis.innerHTML=paintedTicks.map(v=>`<span style="${at(v,domain)}">${num(v,1)}%</span>`).join('');axis.dataset.tickStamp=stamp;}
        else for(let i=0;i<paintedTicks.length;i++)axis.children[i].style.left=distributionX(paintedTicks[i],domain)+'%';
      }
      const top=rows.scrollTop-96,bottom=rows.scrollTop+rows.clientHeight+96;
      // Render visible rows and a small overscan region; scrolled-in rows catch
      // up to the current shared domain on the next frame.
      for(const entry of entries)if(entry.bottom>=top&&entry.top<=bottom)paintEntry(entry);
    }
    function locate(target,p,type){
      const entry=target._distributionEntry;
      if(!entry||!paintedDomain)return null;
      const r=target.getBoundingClientRect();
      return distributionHit(entry.points,paintedDomain,r.width,p.x-r.left,p.y-r.top,type==='touch'?18:12);
    }
    const gestures=bindDistributionGestures(body,{getView:()=>domain,full:fullDomain,setView:next=>{
      if(next[0]===domain[0]&&next[1]===domain[1])return;
      domain=next;requestPaint();
    },pointAt:(target,p,type)=>locate(target,p,type)?.i,onPoint:id=>selectPoint(pointById.get(String(id)),true)});
    function setupDistribution(){
      rows=body.querySelector('.structure-rows');if(!rows)return;
      const style=getComputedStyle(host);colors=Object.fromEntries(Object.entries(colorTokens).map(([key,token])=>[key,style.getPropertyValue(token).trim()]));
      entries=[...rows.querySelectorAll('[data-dist-group]')].map(el=>{
        const name=el.dataset.distGroup,canvas=el.querySelector('canvas'),entry={canvas,row:el.parentElement,group:groupByName.get(name),points:byGroup.get(name)||[],revision:-1,hover:null};
        canvas._distributionEntry=entry;gestures.attachWheel(canvas);
        canvas.onpointermove=e=>{
          if(e.buttons||e.pointerType==='touch')return;
          const p=locate(canvas,{x:e.clientX,y:e.clientY},e.pointerType);
          if(p===entry.hover)return;entry.hover=p;canvas.title=p?p.name+' · '+pct(p.value):'';canvas.style.cursor=p?'pointer':'';
          entry.revision=-1;requestPaint();
        };
        canvas.onpointerleave=()=>{if(!entry.hover)return;entry.hover=null;canvas.title='';canvas.style.cursor='';entry.revision=-1;requestPaint();};
        return entry;
      });
      gestures.attachWheel(rows.querySelector('.dist-axis'));
      rows.addEventListener('scroll',requestPaint,{passive:true});
      observer=new ResizeObserver(measureDistribution);observer.observe(rows);
      paintedDomain=null;revision++;measureDistribution();
    }
    function disposeDistribution(){
      gestures.cancel();if(frame){cancelAnimationFrame(frame);frame=0;}
      observer?.disconnect();observer=null;rows=null;entries=[];paintedDomain=null;
    }
    function draw(){
      const scroll=body.querySelector('.structure-rows')?.scrollTop||0;disposeDistribution();body.dataset.mobileMode=s.structureMobile;
      if(s.structureScope==='stocks'){
        controls.innerHTML=`<label><input type="checkbox" data-weak ${s.weakOnly?'checked':''}> 仅行业20日落后于池</label>`;
        controls.querySelector('input').onchange=e=>{s.weakOnly=e.target.checked;s.pointBrush=null;persist();draw();};
        const weak=new Set(summary.groups.filter(g=>finite(g.sector.at(-1))&&finite(pool)&&g.sector.at(-1)<pool).map(g=>g.name));
        scatter(body,s.weakOnly?points.filter(p=>weak.has(p.industry)):points,options);
        return;
      }
      controls.innerHTML=`<label>行序 <select data-sort>${option('wins','20日领先天数',s.structureSort)}${option('excess5','5日超额收益',s.structureSort)}${option('excess','20日超额收益',s.structureSort)}${option('breadth','20日上涨占比',s.structureSort)}${option('name','行业名称',s.structureSort)}</select></label>`;
      controls.querySelector('select').onchange=e=>{s.structureSort=e.target.value;persist();draw();};
      const known=new Set(s.market.sectors.filter(g=>g.series.price_count.some(n=>n>0)).map(g=>g.name));
      const groups=rankLatest(summary.groups.filter(g=>known.has(g.name)),g=>distributionRank(g,pool,s.structureSort));
      body.innerHTML=`<div class="structure-mode"><button data-mobile="dist" aria-pressed="${s.structureMobile!=='heat'}">成分分布</button><button data-mobile="heat" aria-pressed="${s.structureMobile==='heat'}">强弱历史</button></div>
        <div class="structure-legend structure-legend-inline">
          <span class="sr-heat heat-legend"><i class="heat-key"></i> 落后 / 领先</span>
          <span class="sr-dist dist-legend"><span><i class="legend-point"></i>个股</span><span><i class="legend-range"></i>中间约80%</span><span><i class="legend-median"></i>中位数</span><span><i class="legend-diamond"></i>行业收益</span><span><i class="legend-market"></i>股票池收益</span><span><i class="legend-zero"></i>零收益</span></span>
          <details class="structure-method"><summary>统计口径</summary><div>5日超额为行业与股票池5日收益之差（百分点）；颜色饱和于 ±18。P10–P90 为第10至90百分位（中间约80%的成分股收益范围）。个股20日累计收益须有完整20个交易日数据；上涨占比为正收益家数 / 有效家数。点行业深入、点个股查值；顶部选择观察日。成分分布：滚轮或双指横向缩放，横向拖动平移，双击复原。20日领先天数统计行业日收益超过股票池日收益的天数；20日超额为累计收益之差；各排序均基于当前观察日。</div></details>
        </div>
        <div class="structure-rows" data-mobile-mode="${esc(s.structureMobile)}"><div class="structure-row structure-columns"><span>行业</span><div class="sr-heat"><div class="structure-col-title">5日超额收益（百分点）</div>${heatAxis(summary.dates)}</div><div class="sr-dist"><div class="structure-col-title">20日个股收益分布（%）${zoomed()?' · 缩放中':''}</div>${distributionAxis(domain)}</div><span>20日上涨占比</span></div>${groups.map(g=>{
          return `<div class="structure-row"><button class="structure-name" data-group="${esc(g.name)}" title="${esc(g.name)} · 20日领先 ${wins(g.wins.at(-1))} 天 · 5日超额 ${finite(g.excess5.at(-1))?num(g.excess5.at(-1))+' 个百分点':'—'} · 20日超额 ${finite(diff(g.sector.at(-1),pool))?num(diff(g.sector.at(-1),pool))+' 个百分点':'—'} · 行业 ${pct(g.sector.at(-1))}">${esc(g.name)}</button><div class="sr-heat"><canvas class="structure-heat" data-heat-group="${esc(g.name)}" aria-label="5日超额历史"></canvas></div><div class="sr-dist" data-dist-group="${esc(g.name)}">${distribution(g)}</div><span class="structure-up" title="近20日正收益家数 / 有效家数">${g.count.at(-1)?num(100*g.up.at(-1)/g.count.at(-1),1)+'%':'—'} <small>(${g.up.at(-1)}/${g.count.at(-1)})</small></span></div>`;
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
      body.querySelector('.structure-rows').scrollTop=scroll;
      setupDistribution();
      selectPoint(points.find(p=>p.code===s.structurePoint));
      body.onclick=e=>{
        const button=e.target.closest('[data-group]'),mobile=e.target.closest('[data-mobile]');
        if(button)openIndustry(button.dataset.group);
        if(mobile){s.structureMobile=mobile.dataset.mobile;persist();draw();}
      };
    }
    host.querySelector('[data-scope]').onchange=e=>{s.structureScope=e.target.value;s.pointBrush=null;body.onclick=null;persist();draw();};
    draw();return disposeDistribution;
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
  root.AtlasResearch={market,industry,linkage,distributionX,distributionTicks,distributionView,distributionRank,bindDistributionGestures,distributionHit,paintDistribution};
})(globalThis);
