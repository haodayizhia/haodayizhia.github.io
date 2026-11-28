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
    ctx.setLineDash([]);ctx.globalAlpha=.55;ctx.fillStyle=colors.range||colors.blue;
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
    const colorTokens={muted:'--muted',teal:'--plot-teal',blue:'--plot-blue',range:'--plot-range',slate:'--plot-slate',main:'--plot-main',gold:'--plot-gold',ink:'--ink'};
    const pointById=new Map(points.map(p=>[String(p.i),p]));
    let frame=0,rows=null,entries=[],width=0,dpr=1,colors=null,paintedDomain=null,paintedTicks=[],revision=0,observer=null,scatterCleanup=null;
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
      scatterCleanup?.();scatterCleanup=null;gestures.cancel();if(frame){cancelAnimationFrame(frame);frame=0;}
      observer?.disconnect();observer=null;rows=null;entries=[];paintedDomain=null;
    }
    function draw(){
      const scroll=body.querySelector('.structure-rows')?.scrollTop||0;disposeDistribution();body.dataset.mobileMode=s.structureMobile;
      if(s.structureScope==='stocks'){
        controls.innerHTML=`<label><input type="checkbox" data-weak ${s.weakOnly?'checked':''}> 仅行业20日落后于池</label>`;
        controls.querySelector('input').onchange=e=>{s.weakOnly=e.target.checked;s.pointBrush=null;persist();draw();};
        const weak=new Set(summary.groups.filter(g=>finite(g.sector.at(-1))&&finite(pool)&&g.sector.at(-1)<pool).map(g=>g.name));
        scatterCleanup=scatter(body,s.weakOnly?points.filter(p=>weak.has(p.industry)):points,options);
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
  function scatterRange(view,base,factor,from=.5,to=from,minSpan=1){
    const total=base[1]-base[0],span=view[1]-view[0];
    if(!finite(factor)||factor<=0)return [...base];
    const width=Math.max(Math.min(minSpan,total),Math.min(total,span/factor));
    if(width>=total)return [...base];
    const left=Math.max(base[0],Math.min(base[1]-width,view[0]+span*from-width*to));
    return [left,left+width];
  }
  // Keep reference labels distinct even when their underlying values coincide.
  function scatterLabels(labels,top,bottom,gap=17){
    const sorted=labels.map(l=>({...l})).sort((a,b)=>a.y-b.y);
    if(!sorted.length)return sorted;
    gap=Math.min(gap,(bottom-top)/Math.max(1,sorted.length-1));
    for(let i=0;i<sorted.length;i++)sorted[i].labelY=Math.max(top,sorted[i].y,i?sorted[i-1].labelY+gap:top);
    if(sorted.at(-1).labelY>bottom){
      sorted.at(-1).labelY=bottom;
      for(let i=sorted.length-2;i>=0;i--)sorted[i].labelY=Math.min(sorted[i].labelY,sorted[i+1].labelY-gap);
    }
    return sorted;
  }
  // Keep labels in a dedicated right gutter, outside all data and grid lines.
  // Reserve space for the longest label even if a reference is outside the
  // current zoom range, so the plot geometry is stable while zooming.
  function scatterReferenceLayout(width,left,labelWidth){
    const right=Math.max(left+1,width-6-Math.ceil(labelWidth)-24);
    return {right,labelX:right+22,leaderStart:right+4,leaderBend:right+10,leaderEnd:right+17};
  }
  let pointChartId=0;
  function scatter(host,points,{state:s,data,openStock,persist},group){
    host.onclick=null;
    const rows=points.filter(p=>finite(p.groupWins)),market=data.summary.pool.at(-1),sector=group?.sector.at(-1);
    const domain=extent(rows.map(p=>p.value).concat(market,sector)),base=[0,20,...domain];
    const clamp=AtlasCharts.clamp,axisNum=AtlasCharts.axisNumber,clip='pointClip'+(++pointChartId);
    // Persist only a valid view of this chart's data.
    let view=Array.isArray(s.pointBrush)&&s.pointBrush.length===4&&s.pointBrush.every(finite)&&s.pointBrush[0]<s.pointBrush[1]&&s.pointBrush[2]<s.pointBrush[3]&&s.pointBrush[0]>=0&&s.pointBrush[1]<=20&&s.pointBrush[2]>=base[2]&&s.pointBrush[3]<=base[3]?[...s.pointBrush]:[...base];
    host.classList.add('point-chart-host');
    host.innerHTML=`<div class="plot-toolbar point-toolbar"><div><span class="chart-label">成分股 · 20日收益与领先比例</span><span class="point-date">${esc(data.summary.dates.at(-1))}</span></div><div class="plot-actions"><button data-expand aria-label="全屏成分股图">⛶ 全屏</button></div></div><div class="point-surface"><svg class="point-plot" tabindex="0" role="img" aria-label="20日累计收益与跑赢本行业天数占比" aria-description="滚轮缩放；拖动平移；Shift 加拖动框选；双击或按 0 复原"></svg></div><div class="point-controls"><label>查找 <input type="search" placeholder="股票名称或代码" aria-label="查找散点股票"></label><select aria-label="选择散点股票"></select></div><div class="point-detail" aria-live="polite"></div>`;
    const surface=host.querySelector('.point-surface'),svg=surface.querySelector('svg'),search=host.querySelector('input'),list=host.querySelector('select'),detail=host.querySelector('.point-detail');
    let W=0,H=0,g=null,drawFrame=0,settleTimer=0,searchText='',choices=[],hover=null,drag=null,brushBox=null,painted=[],lastRead=null,lastList='',dead=false;
    const X=v=>g.left+(v-view[0])*g.width/(view[1]-view[0]),Y=v=>g.bottom-(v-view[2])*g.height/(view[3]-view[2]);
    const visible=p=>finite(p.groupWins)&&p.groupWins>=view[0]&&p.groupWins<=view[1]&&p.value>=view[2]&&p.value<=view[3];
    const pointMap=new Map(points.map(p=>[p.code,p]));
    const isZoomed=()=>view.some((v,i)=>v!==base[i]);
    function read(p){
      if(p===lastRead&&detail.firstChild)return;lastRead=p;
      if(!p){detail.textContent=points.length?'有效收益 '+points.length+' 只，可比较领先天数 '+rows.length+' 只。悬停查值，单击固定；重合点可通过股票选择框查看。':'当前观察日没有完整20日收益。';return;}
      const industry=data.summary.groups.find(v=>v.name===p.industry)?.sector.at(-1);
      const metrics=[['20日收益',pct(p.value)],['行业收益',pct(industry)],['股票池收益',pct(market)],['跑赢行业',wins(p.groupWins)+' 天'],['跑赢股票池',wins(p.marketWins)+' 天']];
      detail.innerHTML=`<div class="point-identity"><b>${esc(p.name)} · ${esc(p.code)}</b><span>${esc(p.industry)}</span><button class="point-open">查看日线 ↗</button></div><div class="point-metrics">${metrics.map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`;
      detail.querySelector('button').onclick=()=>openStock(p.code);
    }
    function highlight(){
      for(const el of svg.querySelectorAll('.chosen,.point-hover'))el.classList.remove('chosen','point-hover');
      const selected=pointMap.get(s.structurePoint);
      if(selected)svg.querySelector('[data-dot="'+selected.i+'"]')?.classList.add('chosen');
      if(hover)svg.querySelector('[data-dot="'+hover.i+'"]')?.classList.add('point-hover');
      read(hover||selected||null);
    }
    function fill(matches){
      choices=matches||points.filter(p=>(!isZoomed()||visible(p))&&(!searchText||(p.name+p.code).toLowerCase().includes(searchText)));
      const stamp=choices.map(p=>p.code).join(',');
      if(stamp!==lastList||!list.options.length){list.innerHTML=option('','选择股票（'+choices.length+'）','')+choices.map(p=>option(p.code,p.name+' '+p.code,s.structurePoint)).join('');lastList=stamp;}
      list.value=choices.some(p=>p.code===s.structurePoint)?s.structurePoint:'';
    }
    function select(code){s.structurePoint=pointMap.has(code)?code:'';hover=null;persist();list.value=s.structurePoint;highlight();}
    function schedule(){if(!drawFrame&&!dead)drawFrame=requestAnimationFrame(()=>{drawFrame=0;draw();});}
    function setView(next){
      if(next.every((v,i)=>v===view[i]))return;
      view=next;hover=null;s.pointBrush=isZoomed()?[...view]:null;schedule();
      clearTimeout(settleTimer);settleTimer=setTimeout(()=>{if(!dead){fill();persist();}},100);
    }
    function draw(){
      if(dead||!host.isConnected)return;
      W=Math.round(surface.clientWidth);if(W<100)return;
      H=AtlasCharts.chartHeight(W,window.innerHeight);
      if(host.classList.contains('is-fullscreen'))H=Math.max(190,Math.floor(host.parentElement.clientHeight-host.querySelector('.point-toolbar').offsetHeight-host.querySelector('.point-controls').offsetHeight-detail.offsetHeight-48));
      // Match the actual CSS pixel dimensions. No fixed-ratio letterboxing.
      surface.style.height=H+'px';svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
      const [xl,xr,yl,yr]=view,yt=AtlasCharts.ticks(yl,yr,W<500?5:6).filter(v=>v>=yl&&v<=yr);
      const referenceSpecs=[{v:0,label:'零收益',cls:'dist-zero',color:'var(--muted)'},{v:market,label:'股票池 '+pct(market),cls:'dist-market',color:'var(--plot-teal)'},{v:sector,label:'行业 '+pct(sector),cls:'point-sector',color:'var(--plot-gold)'}].filter(r=>finite(r.v));
      g=AtlasCharts.geometry(W,H,AtlasCharts.measureAxis(yt.map(v=>axisNum(v)+'%')));
      const referenceLayout=scatterReferenceLayout(W,g.left,AtlasCharts.measureAxis(referenceSpecs.map(r=>r.label)));
      g.right=referenceLayout.right;g.width=Math.max(1,g.right-g.left);
      g.top=24;g.bottom=H-46;g.height=Math.max(1,g.bottom-g.top);
      const span=xr-xl,step=span>12?5:span>5?2:1,xt=[];
      for(let v=Math.ceil(xl/step)*step;v<=xr+1e-8;v+=step)xt.push(v);
      const refs=referenceSpecs.filter(r=>r.v>=yl&&r.v<=yr).map(r=>({...r,y:Y(r.v)}));
      const labels=scatterLabels(refs,g.top+9,g.bottom-9,18);
      painted=rows.filter(visible).map(p=>({p,x:X(p.groupWins),y:Y(p.value)}));
      svg.innerHTML=`<defs><clipPath id="${clip}"><rect x="${g.left-5}" y="${g.top-5}" width="${g.width+10}" height="${g.height+10}"/></clipPath></defs>
        <text class="axis-unit" x="${g.left}" y="13">20日累计收益率</text>
        ${yt.map(v=>`<path class="grid-line" d="M${g.left},${Y(v)}H${g.right}"/><text class="axis-label" x="${g.left-7}" y="${Y(v)+4}" text-anchor="end">${axisNum(v)}%</text>`).join('')}
        ${xt.map(v=>`<text class="axis-label" x="${X(v)}" y="${g.bottom+18}" text-anchor="${v===xl?'start':v===xr?'end':'middle'}">${v*5}%</text>`).join('')}
        <text class="axis-label" x="${(g.left+g.right)/2}" y="${H-7}" text-anchor="middle">20日内跑赢本行业的天数占比</text>
        ${refs.map(r=>`<line x1="${g.left}" x2="${g.right}" y1="${r.y}" y2="${r.y}" class="${r.cls}"/>`).join('')}
        <g clip-path="url(#${clip})">${painted.map(({p,x,y})=>`<circle cx="${x}" cy="${y}" r="3.2" data-dot="${p.i}"/>`).join('')}</g>
        ${labels.map(r=>`<g class="point-reference" style="color:${r.color}"><path d="M${g.right},${r.y}H${referenceLayout.leaderStart}L${referenceLayout.leaderBend},${r.labelY}H${referenceLayout.leaderEnd}" fill="none" stroke="currentColor"/><text x="${referenceLayout.labelX}" y="${r.labelY}" dominant-baseline="central" text-anchor="start">${esc(r.label)}</text></g>`).join('')}
        <rect class="brush-box" width="0" height="0"/>`;
      surface.classList.toggle('can-pan',isZoomed());
      highlight();
    }
    function local(p){const r=surface.getBoundingClientRect();return {x:p.x-r.left,y:p.y-r.top};}
    function fractions(p){const q=local(p);return [clamp((q.x-g.left)/g.width,0,1),clamp((g.bottom-q.y)/g.height,0,1)];}
    function nearest(p,radius=12){
      if(!g)return null;const q=local(p);let best=radius,found=null;
      for(const d of painted){const dist=Math.hypot(d.x-q.x,d.y-q.y);if(dist<=best){best=dist;found=d;}}
      return found;
    }
    function inspect(p){
      const hit=nearest(p)?.p||null;if(hit===hover)return;hover=hit;
      surface.style.cursor=hit?'pointer':'';highlight();
    }
    function dismiss(){hover=null;surface.style.cursor='';highlight();}
    function pick(p,type){
      const hit=nearest(p,type==='touch'?18:12);if(!hit)return;
      const previous=s.structurePoint,previousChoices=[...choices];
      const near=painted.filter(d=>Math.hypot(d.x-hit.x,d.y-hit.y)<=7).map(d=>d.p);
      fill(near.length>1?near:null);select(hit.p.code);
      return ()=>{fill(previousChoices);select(previous);};
    }
    function begin(p,shift){if(!g)return;drag={view:[...view],anchor:fractions(p),start:local(p),shift};hover=null;}
    function move(p,start){
      if(!drag||!g||Math.hypot(p.x-start.x,p.y-start.y)<6)return;
      const q=local(p);
      if(drag.shift){
        const a=drag.start,b={x:clamp(q.x,g.left,g.right),y:clamp(q.y,g.top,g.bottom)},c={x:clamp(a.x,g.left,g.right),y:clamp(a.y,g.top,g.bottom)};
        brushBox=[c,b];const rect=svg.querySelector('.brush-box');
        for(const [k,v] of Object.entries({x:Math.min(c.x,b.x),y:Math.min(c.y,b.y),width:Math.abs(c.x-b.x),height:Math.abs(c.y-b.y)}))rect?.setAttribute(k,v);
        return;
      }
      if(!isZoomed())return;
      const [fx,fy]=fractions(p);
      setView([...scatterRange(drag.view.slice(0,2),base.slice(0,2),1,drag.anchor[0],fx),...scatterRange(drag.view.slice(2),base.slice(2),1,drag.anchor[1],fy)]);
    }
    function cancel(){drag=null;brushBox=null;const rect=svg.querySelector('.brush-box');rect?.setAttribute('width',0);rect?.setAttribute('height',0);}
    function finish(){
      if(brushBox&&g){
        const [a,b]=brushBox;
        if(Math.abs(a.x-b.x)>7&&Math.abs(a.y-b.y)>7){
          const ix=x=>view[0]+(x-g.left)/g.width*(view[1]-view[0]),iy=y=>view[2]+(g.bottom-y)/g.height*(view[3]-view[2]);
          const x0=ix(Math.min(a.x,b.x)),x1=ix(Math.max(a.x,b.x)),y0=iy(Math.max(a.y,b.y)),y1=iy(Math.min(a.y,b.y));
          if(x1-x0>=1&&y1-y0>=1)setView([x0,x1,y0,y1]);
        }
      }
      cancel();
    }
    function zoom(factor,p,wheel){
      if(!g)return;
      const [fx,fy]=fractions(p),q=local(p),xOnly=wheel&&q.y>g.bottom,yOnly=wheel&&q.x<g.left;
      setView([...(yOnly?view.slice(0,2):scatterRange(view.slice(0,2),base.slice(0,2),factor,fx)),...(xOnly?view.slice(2):scatterRange(view.slice(2),base.slice(2),factor,fy))]);
    }
    function panPinch(dx,dy){
      if(!g)return;
      setView([...scatterRange(view.slice(0,2),base.slice(0,2),1,.5,.5+dx/g.width),...scatterRange(view.slice(2),base.slice(2),1,.5,.5-dy/g.height)]);
    }
    function reset(){cancel();hover=null;setView([...base]);fill();highlight();persist();}
    const gesture=new root.AtlasGesture(surface,{inspect,dismiss,tap:pick,immediateTap:true,start:begin,drag:move,end:finish,cancel,finishTouch:finish,canPan:isZoomed,canPanY:isZoomed,zoom,panPinch,reset,startPinch:cancel});
    // Suppress the browser's pointer-focus rectangle without removing
    // keyboard focus or its visible accessibility cue.
    surface.addEventListener('pointerdown',()=>svg.classList.add('pointer-focused'));
    svg.addEventListener('blur',()=>svg.classList.remove('pointer-focused'));
    svg.addEventListener('keydown',e=>{
      svg.classList.remove('pointer-focused');
      if(e.key==='Escape'){dismiss();return;}if(e.key==='0'){e.preventDefault();reset();return;}
      if(!g)return;
      const r=surface.getBoundingClientRect();
      if(['+','=','-'].includes(e.key)){e.preventDefault();zoom(e.key==='-'?1/1.6:1.6,{x:r.left+g.left+g.width/2,y:r.top+g.top+g.height/2},false);}
    });
    search.oninput=()=>{searchText=search.value.trim().toLowerCase();fill();if(searchText&&choices.length===1)select(choices[0].code);};
    list.onchange=()=>select(list.value);
    host.querySelector('[data-expand]').onclick=()=>root.AtlasFullscreen.open(host,'成分股收益与领先天数');
    const observer=new ResizeObserver(schedule);observer.observe(surface);
    window.addEventListener('resize',schedule);
    draw();fill();highlight();
    return ()=>{dead=true;gesture.destroy();observer.disconnect();window.removeEventListener('resize',schedule);if(drawFrame)cancelAnimationFrame(drawFrame);clearTimeout(settleTimer);host.classList.remove('point-chart-host');};
  }
  function industry(host,options){
    const {state:s,data,graph}=options,{summary}=data,g=summary.groups.find(g=>g.name===s.industry);
    if(!g)return;
    host.innerHTML=`<div class="structure-legend">浅带 P10–P90（第10至90百分位） · 中位数、行业等权、股票池等权 · 20日上涨 ${g.up.at(-1)} / ${g.count.at(-1)} 只</div><div id="industryBand"></div><details class="breadth-details"><summary>上涨家数历史</summary><p class="structure-legend">较前一交易日，共同样本转为正收益 ${g.gained.at(-1)??'—'} 只，转为非正 ${g.lost.at(-1)??'—'} 只；窗口样本新增 ${g.joined.at(-1)??'—'} 只、退出 ${g.left.at(-1)??'—'} 只。</p><div id="industryParticipation"></div></details><div id="industryPoints"></div>`;
    const series=[['median','成分中位数','blue',''],['sector','行业等权','gold',''],['pool','股票池等权','benchmark','6 4']].map(([id,name,color,dash])=>({id,name,color:'var(--plot-'+color+')',dash,values:id==='pool'?summary.pool:g[id]}));
    graph('industryBand',{dates:summary.dates,series,band:[g.p10,g.p90],unit:'%',label:s.industry+' · 20日收益分布',keepSeriesVisible:true});
    const details=host.querySelector('details');
    details.open=!!s.showBreadth;
    const breadth=()=>graph('industryParticipation',{dates:summary.dates,series:[{id:'participation',name:'20日正收益占比',color:'var(--plot-teal)',values:g.up.map((v,i)=>g.count[i]?100*v/g.count[i]:null)}],domain:[0,100],unit:'%',label:'20日上涨比例',compact:true});
    if(details.open)breadth();
    details.ontoggle=()=>{s.showBreadth=details.open;options.persist();if(host.isConnected&&details.open&&!host.querySelector('#industryParticipation svg'))breadth();};
    return scatter(host.querySelector('#industryPoints'),records(data,s.meta).filter(p=>p.industry===s.industry),options,g);
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
  root.AtlasResearch={market,industry,linkage,distributionX,distributionTicks,distributionView,distributionRank,bindDistributionGestures,distributionHit,paintDistribution,scatterRange,scatterLabels,scatterReferenceLayout};
})(globalThis);
