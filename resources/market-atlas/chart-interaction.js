'use strict';
(function(root) {
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function zoomRange(range,total,factor,anchor=.5) {
    if(total<2)return [0,Math.max(0,total-1)];
    const span=range[1]-range[0],width=clamp(span/factor,Math.min(5,total-1),total-1);
    const center=range[0]+span*anchor;
    const start=clamp(center-width*anchor,0,total-1-width);
    return [start,start+width];
  }
  function bindDismiss(dialog) {
    if(dialog.dataset.dismissBound)return;
    dialog.dataset.dismissBound='true';let startedOutside=false;
    const outside=e=>{const r=dialog.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
    dialog.addEventListener('pointerdown',e=>startedOutside=outside(e));
    dialog.addEventListener('pointerup',e=>{if(startedOutside&&outside(e))dialog.close();startedOutside=false;});
  }
  const fullscreen={
    open(host,label) {
      if(this.host===host){this.close();return;}
      this.close();
      if(!this.dialog) {
        this.dialog=document.createElement('dialog');this.dialog.className='atlas-dialog chart-dialog';this.dialog.id='atlasChartDialog';
        this.dialog.innerHTML='<header><h2></h2><button type="button" aria-label="关闭全屏图表">×</button></header><div class="fullscreen-stage"></div>';
        document.querySelector('.atlas-app').append(this.dialog);bindDismiss(this.dialog);
        this.dialog.querySelector('button').addEventListener('click',()=>this.close());
        this.dialog.addEventListener('close',()=>this.restore());
      }
      this.previousFocus=document.activeElement;this.host=host;this.placeholder=document.createComment('chart position');host.before(this.placeholder);
      this.position={x:scrollX,y:scrollY};this.dialog.querySelector('h2').textContent=label;
      this.dialog.querySelector('.fullscreen-stage').append(host);host.classList.add('is-fullscreen');
      this.dialog.showModal();root.AtlasInspector.hide();requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
    },
    restore() {
      if(!this.host)return;const host=this.host;host.classList.remove('is-fullscreen');
      if(this.placeholder?.isConnected)this.placeholder.replaceWith(host);
      this.host=null;root.AtlasInspector.hide();if(this.previousFocus?.isConnected)this.previousFocus.focus({preventScroll:true});window.scrollTo(this.position.x,this.position.y);
      requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
    },
    close(){if(this.dialog?.open)this.dialog.close();this.restore();}
  };
  // Unlike comparison curves, stock metrics have distinct units and semantic order.
  const stockPriceNames=['开盘','最高','最低','收盘'],stockChangeNames=['涨跌','距今涨幅'];
  function stockReadoutGroups(rows){
    const select=names=>names.map(name=>rows.find(r=>r.name===name)).filter(Boolean);
    const prices=select(stockPriceNames),changes=select(stockChangeNames);
    const more=rows.filter(r=>!stockPriceNames.includes(r.name)&&!stockChangeNames.includes(r.name));
    return {prices,changes,more};
  }
  function stockReadoutCell(r){
    const {escape:esc,number:num,finite}=root.AtlasCharts;
    const signed=r.signed||r.name==='涨跌',valid=finite(r.value);
    const tone=signed&&valid&&r.value!==0?(r.value>0?' readout-rise':' readout-fall'):'';
    const label=r.name==='涨跌'?'当日涨跌':r.name;
    return '<div class="stock-readout-cell" data-stock-metric="'+esc(r.name)+'"><span class="stock-readout-label" title="'+esc(r.title||label)+'">'+esc(label)+'</span><strong class="stock-readout-number'+tone+'">'+(valid?(signed&&r.value>0?'+':'')+num(r.value,r.digits??2):'—')+(valid?'<small class="stock-readout-unit'+(r.unit==='%'?' is-percent':'')+'">'+esc(r.unit||'')+'</small>':'')+'</strong></div>';
  }
  const toggleText=(el,open)=>open?'收起':el.dataset.stock==='true'?'更多 '+el.dataset.extra+' 项':'全部 '+el.dataset.rows+' 项';
  // Values occupy document flow; inspection never places a panel over the plot.
  const inspector={
    mount(owner,slot) {
      owner.readout=slot||owner.host.querySelector('.chart-readout');
      const el=owner.readout;if(!el)return;
      if(!el.firstElementChild){
        el.innerHTML='<div class="readout-head"><time></time><button class="readout-unpin" type="button" title="取消当前关注" aria-label="取消当前关注" hidden>×</button><a class="readout-drill" hidden></a><button class="readout-toggle" type="button" aria-expanded="false"></button></div><div class="readout-primary"></div><div class="readout-all" hidden></div>';
        el.querySelector('.readout-toggle').addEventListener('click',()=>{const open=el.classList.toggle('is-expanded');if(open)el.renderAll?.();el.querySelector('.readout-all').hidden=!open;el.querySelector('.readout-toggle').setAttribute('aria-expanded',String(open));el.querySelector('.readout-toggle').textContent=toggleText(el,open);window.dispatchEvent(new Event('resize'));});
        el.querySelector('.readout-unpin').addEventListener('click',()=>{const owner=el.owner;owner.clearInspection?.();});
        el.addEventListener('pointerdown',()=>el.owner?.pause?.());
        el.addEventListener('click',e=>{const select=e.target.closest('[data-focus-series]');if(select){const owner=el.owner;if(owner?.onFocusSeries)owner.onFocusSeries(select.dataset.focusSeries);else owner?.focusSeries?.(select.dataset.focusSeries);return;}const link=e.target.closest('[data-open-series]');if(link&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey&&e.button===0){e.preventDefault();el.owner?.onOpenSeries?.(link.dataset.openSeries);}});
      }
    },
    render(owner,{date,rows,focus=owner.focus,detailFocus=focus}) {
      const el=owner.readout;if(!el)return;el.owner=owner;
      const {escape:esc,number:num,finite}=root.AtlasCharts;
      const key=JSON.stringify([date,rows,focus,detailFocus,owner.pinned]);if(el.renderKey===key)return;el.renderKey=key;el.dataset.rows=rows.length;el.dataset.many=String(rows.length>6&&!owner.stock);el.dataset.stock=String(!!owner.stock);const stockGroups=owner.stock?stockReadoutGroups(rows):null;el.dataset.extra=String(stockGroups?.more.length??0);
      el.querySelector('time').textContent=date+(owner.pinned?' · 关注':'');el.querySelector('.readout-unpin').hidden=!owner.pinned;
      const button=el.querySelector('.readout-toggle'),hasMore=stockGroups?stockGroups.more.length>0:rows.length>6;button.hidden=!hasMore;if(!hasMore){el.classList.remove('is-expanded');el.querySelector('.readout-all').hidden=true;button.setAttribute('aria-expanded','false');}button.textContent=toggleText(el,el.classList.contains('is-expanded'));
      const focused=rows.find(r=>r.id===focus||r.name===focus);
      // A past hover can offer a drill link without visually selecting a curve.
      const detail=rows.find(r=>r.id===detailFocus||r.name===detailFocus);
      const drill=el.querySelector('.readout-drill');drill.hidden=!detail?.canOpen;if(detail?.canOpen){drill.textContent=detail.openLabel||owner.openLabel||'查看详情';drill.href=owner.linkFor(detail.id);drill.dataset.openSeries=detail.id;drill.setAttribute('aria-label',drill.textContent+'：'+detail.name);}
      const references=rows.filter(r=>r.reference);
      const primary=stockGroups?[...stockGroups.prices,...stockGroups.changes]:
        rows.length<=6?rows:
        references.length?[...references,...(focused&&!references.includes(focused)?[focused]:[])]:
        focused&&focused!==rows[0]?[rows[0],focused]:rows.slice(0,1);
      const row=r=>{
         const label=esc(r.name)+(r.detail?'<small class="readout-code">'+esc(r.detail)+'</small>':'');
         const link=r.canOpen?'<a class="readout-open readout-jump" href="'+esc(owner.linkFor(r.id))+'" data-open-series="'+esc(r.id)+'" aria-label="'+esc(r.openLabel||owner.openLabel||'查看详情')+'：'+esc(r.name)+'" title="查看详情：'+esc(r.name)+'">↗</a>':'';
         const selectable=!!r.id&&(!!owner.onFocusSeries||!!owner.series?.some(s=>s.id===r.id));
         const identity=selectable?'<span class="readout-identity"><button type="button" class="readout-focus" data-focus-series="'+esc(r.id)+'" aria-pressed="'+(owner.pinned===r.id)+'" title="点击关注 '+esc(r.name)+'">'+label+'</button>'+link+'</span>':
           r.canOpen?'<a class="readout-open" href="'+esc(owner.linkFor(r.id))+'" data-open-series="'+esc(r.id)+'" aria-label="'+esc(r.openLabel||owner.openLabel||'查看详情')+'：'+esc(r.name)+'">'+label+' ↗</a>':'<span title="'+esc(r.title||r.name)+'">'+label+'</span>';
         return '<div class="readout-row'+(focus===r.id?' is-focused':'')+'"><i style="color:'+(r.color||'var(--plot-main)')+';border-top:2px '+(r.dash?'dashed':'solid')+' currentColor;background:transparent"></i>'+identity+'<strong'+(r.signed&&finite(r.value)&&r.value!==0?' class="'+(r.value>0?'readout-rise':'readout-fall')+'"':'')+'>'+(finite(r.value)?(r.signed&&r.value>0?'+':'')+num(r.value,r.digits??2):'—')+'<small class="readout-unit'+(r.unit==='%'?' is-percent':'')+'">'+(finite(r.value)?esc(r.unit||''):'')+'</small></strong></div>';
       };
      el.querySelector('.readout-primary').innerHTML=stockGroups?
        '<div class="stock-readout-prices">'+stockGroups.prices.map(stockReadoutCell).join('')+'</div><div class="stock-readout-changes">'+stockGroups.changes.map(stockReadoutCell).join('')+'</div>':
        primary.map(row).join('')+(rows.length>6&&!focused?'<span class="readout-hint">展开全部列表可选择密集曲线</span>':'');
      el.renderAll=()=>{
         const container=el.querySelector('.readout-all');
         const stamp=date+'|'+(owner.revision||0)+'|'+rows.length+'|'+(owner.index??-1)+'|'+(owner.row??-1)+(stockGroups?'|'+JSON.stringify(stockGroups.more):'');
         if(el.listOwner!==owner||el.listStamp!==stamp){
           const scroll=container.scrollTop;
           const ordered=stockGroups?stockGroups.more:[...rows].sort((a,b)=>Number(!!b.reference)-Number(!!a.reference)||
              Number(finite(b.value))-Number(finite(a.value))||(finite(a.value)&&finite(b.value)?b.value-a.value:0)||
              String(a.name).localeCompare(String(b.name),'zh-CN'));
           container.innerHTML=ordered.map(stockGroups?stockReadoutCell:row).join('');
           container.scrollTop=scroll;el.listOwner=owner;el.listStamp=stamp;
         }
         for(const button of container.querySelectorAll('[data-focus-series]')){
           button.setAttribute('aria-pressed',String(button.dataset.focusSeries===owner.pinned));
           button.closest('.readout-row')?.classList.toggle('is-focused',button.dataset.focusSeries===focus);
         }
       };if(el.classList.contains('is-expanded'))el.renderAll();
    },
    show(owner,data){this.owner=owner;this.render(owner,{...data,focus:owner.focus});},
    settle(){},
    hide(){this.owner=null;}
  };
  function axisControls(kind='time'){
    const x=kind==='time'?'时间':'横轴',y=kind==='time'?'数值':'纵轴';
    return '<span class="zoom-mode-label" aria-hidden="true">缩放</span><div class="zoom-modes" role="group" aria-label="缩放方向">'+[['x',x],['y',y],['both','双轴']].map(([axis,label])=>'<button type="button" data-zoom-axis="'+axis+'" aria-pressed="'+(axis==='both')+'" title="'+label+'缩放">'+label+'</button>').join('')+'</div>';
  }
  function applyZoomAxis(host,axis){for(const b of host.querySelectorAll('[data-zoom-axis]'))b.setAttribute('aria-pressed',String(b.dataset.zoomAxis===axis));}
  // Compact overview: drag the viewport, its edges, or use arrow keys.
  // Latest-input scheduler: one expensive update per display frame, with an
  // explicit flush on release and cancellation when the view is destroyed.
  function frameLatest(apply,raf=requestAnimationFrame,caf=cancelAnimationFrame){
    let frame=0,pending=null;
    function flush(){if(frame){caf(frame);frame=0;}const args=pending;pending=null;if(args)apply(...args);}
    return {push(...args){pending=args;if(!frame)frame=raf(flush);},flush,cancel(){if(frame)caf(frame);frame=0;pending=null;}};
  }
  class TimeNavigator {
    constructor(host,{getRange,getLength,getDates,onChange}){
      Object.assign(this,{getRange,getLength,getDates,onChange});this.abort=new AbortController();this.changes=frameLatest((a,b,mode)=>this.change(a,b,mode));
      this.el=document.createElement('div');this.el.className='atlas-time-nav';
      this.el.innerHTML='<div class="atlas-time-track" tabindex="0" role="slider" aria-label="时间导航，拖动窗口移动日期、拖动两端调整范围"><div class="atlas-time-window"><i class="atlas-time-grip is-start"></i><i class="atlas-time-grip is-end"></i></div></div>';
      host.append(this.el);this.track=this.el.querySelector('.atlas-time-track');this.window=this.track.firstElementChild;
      const signal=this.abort.signal;
      this.track.addEventListener('pointerdown',e=>this.down(e),{signal});
      this.track.addEventListener('pointermove',e=>this.move(e),{signal});
      this.track.addEventListener('pointerup',e=>this.end(e),{signal});
      this.track.addEventListener('pointercancel',e=>this.end(e),{signal});
      this.track.addEventListener('keydown',e=>this.key(e),{signal});
      this.observer=new ResizeObserver(()=>this.update());this.observer.observe(this.track);this.update();
    }
    max(){return Math.max(0,this.getLength()-1);}
    range(){const m=this.max(),v=this.getRange()||[0,m];return[clamp(Number(v[0])||0,0,m),clamp(Number(v[1])||0,0,m)];}
    update(){
      const m=this.max(),[a,b]=this.range(),start=m?a/m*100:0,end=m?b/m*100:100;
      this.window.style.left=start+'%';this.window.style.width=Math.max(0,end-start)+'%';
      const dates=this.getDates(),first=dates[Math.max(0,Math.floor(a))]||'',last=dates[Math.min(dates.length-1,Math.ceil(b))]||'';
      this.track.title=first+' — '+last+'（拖动中间移动，拖动两端缩放）';
      this.track.setAttribute('aria-valuemin','0');this.track.setAttribute('aria-valuemax',String(m));
      this.track.setAttribute('aria-valuenow',String(Math.round(a)));this.track.setAttribute('aria-valuetext',first+' 至 '+last);
    }
    change(a,b,mode){
      const m=this.max(),min=Math.min(5,m);
      if(mode==='left'){b=clamp(b,0,m);a=clamp(a,0,Math.max(0,b-min));}
      else if(mode==='right'){a=clamp(a,0,m);b=clamp(b,Math.min(m,a+min),m);}
      else{const span=clamp(b-a,min,m);a=clamp(a,0,m-span);b=a+span;}
      this.onChange(a,b,mode);this.update();
    }
    down(e){
      if(e.button!==0)return;const rect=this.track.getBoundingClientRect(),m=this.max();if(rect.width<1||m<1)return;
      const x=clamp(e.clientX-rect.left,0,rect.width),value=x/rect.width*m;
      let [a,b]=this.range(),mode='pan';
      // Touch uses forgiving edge zones without enlarging the visual rail.
      const selectedWidth=(b-a)/m*rect.width;
      const edge=e.pointerType==='touch'?Math.max(20,Math.min(26,selectedWidth*.3)):Math.min(10,Math.max(5,selectedWidth*.2));
      const left=Math.abs(x-a/m*rect.width),right=Math.abs(x-b/m*rect.width);
      if(Math.min(left,right)<=edge)mode=left<=right?'left':'right';
      else if(value<a||value>b){const span=b-a;a=clamp(value-span/2,0,m-span);b=a+span;this.change(a,b,'pan');}
      this.drag={id:e.pointerId,x:e.clientX,a,b,mode,w:rect.width};this.track.dataset.dragging=mode;this.track.setPointerCapture(e.pointerId);e.preventDefault();
    }
    move(e){
      const d=this.drag;if(!d||d.id!==e.pointerId){if(!d&&e.pointerType!=='touch'){const r=this.track.getBoundingClientRect(),m=this.max(),[a,b]=this.range();if(m>0){const x=e.clientX-r.left,edge=Math.min(10,Math.max(5,(b-a)/m*r.width*.2));this.track.style.cursor=Math.abs(x-a/m*r.width)<=edge||Math.abs(x-b/m*r.width)<=edge?'ew-resize':x>a/m*r.width&&x<b/m*r.width?'grab':'crosshair';}}return;}
      const m=this.max(),dx=(e.clientX-d.x)/d.w*m,span=d.b-d.a;
      if(d.mode==='left')this.changes.push(d.a+dx,d.b,'left');
      else if(d.mode==='right')this.changes.push(d.a,d.b+dx,'right');
      else{const a=clamp(d.a+dx,0,m-span);this.changes.push(a,a+span,'pan');}
      e.preventDefault();
    }
    end(e){if(!this.drag||e.pointerId!==this.drag.id)return;this.changes.flush();this.drag=null;delete this.track.dataset.dragging;if(this.track.hasPointerCapture(e.pointerId))this.track.releasePointerCapture(e.pointerId);}
    key(e){
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();const m=this.max(),[a,b]=this.range(),span=b-a,step=(e.shiftKey?5:1)*(e.key==='ArrowLeft'?-1:1);
      const left=e.key==='Home'?0:e.key==='End'?m-span:clamp(a+step,0,m-span);this.change(left,left+span,'pan');
    }
    destroy(){this.changes.cancel();this.observer.disconnect();this.abort.abort();this.el.remove();}
  }
  // Merge wheel deltas at the same pointer position and direction into a
  // single render per display frame. Flush on an anchor or direction change
  // so clamping and cursor-centred zoom keep their original semantics.
  function wheelBatch(apply){
    let pending=null,frame=0;
    function flush(){if(frame){cancelAnimationFrame(frame);frame=0;}const next=pending;pending=null;if(next)apply(next.factor,next.point);}
    function push(factor,point){
      if(!Number.isFinite(factor)||factor<=0||factor===1)return;
      if(pending&&(pending.point.x!==point.x||pending.point.y!==point.y||(pending.factor>1)!==(factor>1)))flush();
      if(pending)pending.factor*=factor;else pending={factor,point};
      if(!frame)frame=requestAnimationFrame(flush);
    }
    return {push,flush,cancel(){if(frame)cancelAnimationFrame(frame);frame=0;pending=null;}};
  }
  function touchPanAllowed(dx,dy,canPan,canPanY){
    return !!canPan&&(!!canPanY||Math.abs(dx)>Math.abs(dy));
  }
  class Gesture {
    constructor(surface,handlers) {
      this.surface=surface;this.handlers=handlers;this.abort=new AbortController();const signal=this.abort.signal;
      const on=(name,fn,options={})=>surface.addEventListener(name,fn,{...options,signal});
      const point=e=>({x:e.clientX,y:e.clientY});
      this.wheelBatch=wheelBatch((factor,p)=>handlers.zoom?.(factor,p,true));
      this.dragBatch=frameLatest((p,start)=>handlers.drag?.(p,start));
      let pinchStart=null;
      this.pinchBatch=frameLatest((last)=>{
        if(!pinchStart)return;const first=pinchStart;pinchStart=last;
        const factor=last.d/Math.max(1,first.d);
        if(handlers.pinch)handlers.pinch(factor,first,last);
        else{handlers.zoom?.(factor,last);handlers.panPinch?.(last.x-first.x,last.y-first.y);}
      });
      const drag=(p,start)=>handlers.batchDrag?this.dragBatch.push(p,start):handlers.drag?.(p,start);
      let hoverFrame=0,hoverPoint=null;
      const clearHover=()=>{if(hoverFrame)cancelAnimationFrame(hoverFrame);hoverFrame=0;hoverPoint=null;};
      this.clearHover=clearHover;
      const hover=p=>{hoverPoint=p;if(!hoverFrame)hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;const q=hoverPoint;hoverPoint=null;if(q)handlers.inspect?.(q);});};
      on('contextmenu',e=>e.preventDefault());
      on('pointerdown',e=>{
        if(e.pointerType==='touch'||e.button!==0)return;
        clearHover();this.wheelBatch.flush();this.mouse={...point(e),shift:e.shiftKey};surface.setPointerCapture(e.pointerId);handlers.start?.(point(e),e.shiftKey);
      });
      on('pointermove',e=>{if(e.pointerType==='touch')return;this.mouse?drag(point(e),this.mouse):hover(point(e));});
      on('pointerup',e=>{if(e.pointerType==='touch'||!this.mouse)return;const p=point(e),start=this.mouse;this.mouse=null;this.dragBatch.flush();if(!start.shift&&handlers.tap&&Math.hypot(p.x-start.x,p.y-start.y)<7){handlers.cancel?.();this.queueTap(p,'mouse',()=>handlers.tap(p,'mouse'));}else{this.clearTap();handlers.end?.(p,start);}});
      on('pointercancel',e=>{if(e.pointerType==='touch')return;this.mouse=null;this.dragBatch.cancel();this.clearTap();handlers.cancel?.();});
      on('pointerleave',e=>{clearHover();if(e.pointerType!=='touch'&&!this.mouse){handlers.dismiss?.(true);inspector.hide();}});
      const owner=handlers.owner;
      if(owner){
        const outside=e=>{if(!owner.host.contains(e.target)&&!owner.readout?.contains(e.target)){this.clearTap();clearHover();this.wheelBatch.flush();handlers.dismiss?.(false);}};
        document.addEventListener('pointerdown',outside,{signal});
        document.addEventListener('touchstart',outside,{passive:true,signal});
        // Leaving the chart is not an explicit unpin action. Only the transient crosshair clears.
        owner.host.addEventListener('pointerleave',e=>{if(e.pointerType!=='touch'&&!this.mouse&&!owner.readout?.contains(e.relatedTarget))handlers.dismiss?.(true);},{signal});
      }
      if(handlers.wheel!==false)on('wheel',e=>{if(!e.deltaY)return;e.preventDefault();clearHover();this.wheelBatch.push(Math.exp(-e.deltaY*.002),point(e));},{passive:false});
      on('dblclick',e=>{e.preventDefault();const pending=this.pendingTap;this.clearTap();clearHover();this.wheelBatch.cancel();if(performance.now()-(this.lastDouble??-Infinity)>150){pending?.undo?.();handlers.cancel?.();handlers.reset?.();}});
      on('touchstart',e=>{
        this.clearTimer();clearHover();this.wheelBatch.flush();
        if(e.touches.length===2) {
          this.clearTap();e.preventDefault();const [a,b]=e.touches;
          this.dragBatch.cancel();this.pinchBatch.cancel();handlers.cancel?.();
          this.touch={pinch:Math.max(1,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)),x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2};
          pinchStart={d:this.touch.pinch,x:this.touch.x,y:this.touch.y};
          handlers.startPinch?.(this.touch);return;
        }
        if(e.touches.length!==1)return;
        const p=point(e.touches[0]);this.touch={...p,last:p,moved:false,long:false,start:performance.now()};handlers.start?.(p,false);
        if(handlers.touchInspect)handlers.inspect?.(p);
        this.timer=setTimeout(()=>{if(!this.touch||this.touch.moved)return;this.touch.long=true;surface.classList.add('press-inspecting');handlers.inspect?.(this.touch.last);},380);
      },{passive:false});
      on('touchmove',e=>{
        if(!this.touch)return;
        if(e.touches.length===2&&this.touch.pinch) {
          e.preventDefault();const [a,b]=e.touches,d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
          const center={d:Math.max(1,d),x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2};this.pinchBatch.push(center);return;
        }
        if(e.touches.length!==1||this.touch.pinch)return;
        const p=point(e.touches[0]),dx=p.x-this.touch.x,dy=p.y-this.touch.y;this.touch.last=p;
        if(this.touch.long){e.preventDefault();handlers.inspect?.(p);return;}
        if(handlers.scrub){e.preventDefault();this.touch.moved=true;this.clearTimer();drag(p,this.touch);return;}
        if(Math.hypot(dx,dy)>8){this.touch.moved=true;this.clearTimer();}
        if(this.touch.moved&&touchPanAllowed(dx,dy,handlers.canPan?.(),handlers.canPanY?.())) {
          if(e.cancelable)e.preventDefault();drag(p,this.touch);
        }
      },{passive:false});
      on('touchend',e=>{
        this.clearTimer();const touch=this.touch;if(!touch)return;
        if(touch.pinch){this.pinchBatch.flush();if(!e.touches.length){this.touch=null;pinchStart=null;}return;}
        if(!e.touches.length){this.dragBatch.flush();if(!touch.moved&&!touch.long){this.queueTap(touch.last,'touch',()=>handlers.tap?.(touch.last,'touch'));}inspector.settle();handlers.finishTouch?.();surface.classList.remove('press-inspecting');this.touch=null;}
      });
      on('touchcancel',()=>{this.clearTimer();this.clearTap();this.dragBatch.cancel();this.pinchBatch.cancel();pinchStart=null;this.touch=null;surface.classList.remove('press-inspecting');handlers.cancel?.();});
    }
    // A tap is committed only after the double-tap window. Hover stays immediate.
    queueTap(p,type,action){
      const old=this.pendingTap,near=type==='touch'?24:7;
      if(old&&old.type===type&&Math.hypot(p.x-old.x,p.y-old.y)<near){this.clearTap();old.undo?.();this.handlers.cancel?.();this.handlers.reset?.();this.lastDouble=performance.now();return;}
      if(old){this.clearTap();if(!old.immediate)old.action();}
      // Opt-in charts whose selection has no date/navigation side effects can
      // respond instantly and undo the first tap if it becomes a double tap.
      const immediate=!!this.handlers.immediateTap;
      this.pendingTap={...p,type,action,immediate,undo:immediate?action():null};
      this.tapTimer=setTimeout(()=>{const pending=this.pendingTap;this.clearTap();if(pending&&!pending.immediate)pending.action();},type==='touch'?280:500);
    }
    clearTap(){clearTimeout(this.tapTimer);this.pendingTap=null;}
    clearTimer(){clearTimeout(this.timer);}
    destroy(){this.clearTimer();this.clearTap();this.clearHover?.();this.wheelBatch?.cancel();this.dragBatch?.cancel();this.pinchBatch?.cancel();this.abort.abort();if(inspector.owner?.surface===this.surface)inspector.hide();}
  }
  Object.assign(root,{AtlasGesture:Gesture,AtlasTimeNavigator:TimeNavigator,AtlasAxisControls:axisControls,AtlasApplyZoomAxis:applyZoomAxis,AtlasFullscreen:fullscreen,AtlasInspector:inspector,AtlasDialogDismiss:bindDismiss,AtlasZoomRange:zoomRange,AtlasWheelBatch:wheelBatch,AtlasFrameLatest:frameLatest});
  if(typeof module!=='undefined')module.exports={zoomRange,clamp,stockReadoutGroups,stockReadoutCell,touchPanAllowed,frameLatest};
})(globalThis);
