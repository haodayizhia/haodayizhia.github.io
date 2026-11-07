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
  // Values occupy document flow; inspection never places a panel over the plot.
  const inspector={
    mount(owner,slot) {
      owner.readout=slot||owner.host.querySelector('.chart-readout');
      const el=owner.readout;if(!el)return;
      if(!el.firstElementChild){
        el.innerHTML='<div class="readout-head"><time></time><button type="button" aria-expanded="false"></button></div><div class="readout-primary"></div><div class="readout-all" hidden></div>';
        el.querySelector('button').addEventListener('click',()=>{const open=el.classList.toggle('is-expanded');el.querySelector('.readout-all').hidden=!open;el.querySelector('button').setAttribute('aria-expanded',String(open));el.querySelector('button').textContent=open?'收起列表':'全部 '+el.dataset.rows+' 项';window.dispatchEvent(new Event('resize'));});
      }
    },
    render(owner,{date,rows,focus}) {
      const el=owner.readout;if(!el)return;
      const {escape:esc,number:num,finite}=root.AtlasCharts;
      const key=JSON.stringify([date,rows,focus]);if(el.renderKey===key)return;el.renderKey=key;el.dataset.rows=rows.length;el.dataset.many=String(rows.length>6&&!owner.stock);
      el.querySelector('time').textContent=date;
      const button=el.querySelector('button');button.hidden=rows.length<=6;if(rows.length<=6){el.classList.remove('is-expanded');el.querySelector('.readout-all').hidden=true;button.setAttribute('aria-expanded','false');}button.textContent=el.classList.contains('is-expanded')?'收起列表':'全部 '+rows.length+' 项';
      const focused=rows.find(r=>r.id===focus||r.name===focus);
      const primary=owner.stock?rows.filter(r=>['收盘','涨跌','最高','最低'].includes(r.name)):rows.length<=6?rows:focused&&focused!==rows[0]?[rows[0],focused]:rows.slice(0,1);
      const row=r=>`<div class="readout-row"><i style="background:${r.color||'var(--plot-main)'}"></i><span title="${esc(r.name)}">${esc(r.name)}</span><strong>${finite(r.value)?num(r.value,r.digits??2):'—'}<small>${finite(r.value)?esc(r.unit||''):''}</small></strong></div>`;
      el.querySelector('.readout-primary').innerHTML=primary.map(row).join('')+(rows.length>6&&!focused&&!owner.stock?'<span class="readout-hint">移动查看行业 · 完整数值可展开</span>':'');
      el.querySelector('.readout-all').innerHTML=rows.map(row).join('');
    },
    show(owner,data){this.owner=owner;this.render(owner,{...data,focus:owner.focus});},
    settle(){},
    hide(){this.owner=null;}
  };
  class Gesture {
    constructor(surface,handlers) {
      this.surface=surface;this.handlers=handlers;this.abort=new AbortController();const signal=this.abort.signal;
      const on=(name,fn,options={})=>surface.addEventListener(name,fn,{...options,signal});
      const point=e=>({x:e.clientX,y:e.clientY});
      on('contextmenu',e=>e.preventDefault());
      on('pointerdown',e=>{
        if(e.pointerType==='touch'||e.button!==0)return;
        this.mouse={...point(e),shift:e.shiftKey};surface.setPointerCapture(e.pointerId);handlers.start?.(point(e),e.shiftKey);
      });
      on('pointermove',e=>{if(e.pointerType==='touch')return;this.mouse?handlers.drag?.(point(e),this.mouse):handlers.inspect?.(point(e));});
      on('pointerup',e=>{if(e.pointerType==='touch')return;handlers.end?.(point(e),this.mouse);this.mouse=null;});
      on('pointercancel',()=>{this.mouse=null;handlers.cancel?.();});
      on('pointerleave',e=>{if(e.pointerType!=='touch'&&!this.mouse)inspector.hide();});
      if(handlers.wheel!==false)on('wheel',e=>{e.preventDefault();handlers.zoom?.(Math.exp(-e.deltaY*.002),point(e));},{passive:false});
      on('dblclick',e=>{e.preventDefault();handlers.reset?.();});
      on('touchstart',e=>{
        this.clearTimer();
        if(e.touches.length===2) {
          e.preventDefault();const [a,b]=e.touches;
          this.touch={pinch:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2};
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
          handlers.zoom?.(d/this.touch.pinch,{x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2});this.touch.pinch=d;return;
        }
        if(e.touches.length!==1||this.touch.pinch)return;
        const p=point(e.touches[0]),dx=p.x-this.touch.x,dy=p.y-this.touch.y;this.touch.last=p;
        if(this.touch.long){e.preventDefault();handlers.inspect?.(p);return;}
        if(handlers.scrub){e.preventDefault();this.touch.moved=true;this.clearTimer();handlers.drag?.(p,this.touch);return;}
        if(Math.hypot(dx,dy)>8){this.touch.moved=true;this.clearTimer();}
        if(this.touch.moved&&Math.abs(dx)>Math.abs(dy)&&(handlers.canPan?.()||handlers.scrub)) {e.preventDefault();handlers.drag?.(p,this.touch);}
      },{passive:false});
      on('touchend',e=>{
        this.clearTimer();const touch=this.touch;if(!touch)return;
        if(touch.pinch){if(!e.touches.length)this.touch=null;return;}
        if(!e.touches.length){if(!touch.moved&&!touch.long){const now=performance.now();if(this.lastTap&&now-this.lastTap.time<280&&Math.hypot(touch.last.x-this.lastTap.x,touch.last.y-this.lastTap.y)<24){handlers.reset?.();this.lastTap=null;}else{handlers.tap?.(touch.last);this.lastTap={time:now,...touch.last};}}inspector.settle();handlers.finishTouch?.();surface.classList.remove('press-inspecting');this.touch=null;}
      });
      on('touchcancel',()=>{this.clearTimer();this.touch=null;surface.classList.remove('press-inspecting');handlers.cancel?.();});
    }
    clearTimer(){clearTimeout(this.timer);}
    destroy(){this.clearTimer();this.abort.abort();if(inspector.owner?.surface===this.surface)inspector.hide();}
  }
  Object.assign(root,{AtlasGesture:Gesture,AtlasFullscreen:fullscreen,AtlasInspector:inspector,AtlasDialogDismiss:bindDismiss,AtlasZoomRange:zoomRange});
  if(typeof module!=='undefined')module.exports={zoomRange,clamp};
})(globalThis);
