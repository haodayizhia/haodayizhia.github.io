'use strict';
(function(root) {
  const {escape:esc,number:num,finite,clamp}=root.AtlasCharts;
  const toolbar=label=>`<div class="plot-toolbar"><div><time class="chart-date"></time><span>${esc(label)}</span></div><div class="plot-actions"><button data-map-action="out" aria-label="缩小">−</button><button data-map-action="in" aria-label="放大">＋</button><button data-map-action="reset">复原</button><button data-map-action="expand">全屏</button></div></div>`;
  function rgb(text){if(text.trim().startsWith('#')){let h=text.trim().slice(1);if(h.length===3)h=[...h].map(c=>c+c).join('');return[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));}return(text.match(/[\d.]+/g)||[0,0,0]).slice(0,3).map(Number);}
  class Heatmap {
    constructor(host,options) {
      this.host=host;Object.assign(this,{rowHeight:30,index:options.dates.length-1},options);this.fitted=true;this.abort=new AbortController();host.classList.add('heatmap-host');
      host.innerHTML=toolbar('完整研究区间 · 双指缩放时间')+'<div class="chart-readout"></div><div class="heat-layout"><div class="heat-corner">行业</div><div class="heat-head"><canvas></canvas></div><div class="heat-names"><div></div></div><div class="heat-scroll"><div class="heat-stage"><canvas aria-label="完整行业时间热力图" tabindex="0"></canvas><div class="heat-cursor"></div><div class="heat-selection" hidden></div></div></div></div><p class="map-caption"></p>';
      this.surface=host.querySelector('.heat-scroll');this.canvas=this.surface.querySelector('canvas');this.stage=this.surface.firstElementChild;this.header=host.querySelector('.heat-head canvas');this.names=host.querySelector('.heat-names>div');root.AtlasInspector.mount(this);
      this.names.innerHTML=this.rows.map(r=>`<button title="研究${esc(r.name)}">${esc(r.name)}</button>`).join('');
      [...this.names.children].forEach((b,i)=>b.addEventListener('click',()=>this.onIndustry?.(this.rows[i].name),{signal:this.abort.signal}));
      host.addEventListener('click',e=>{const a=e.target.closest('[data-map-action]')?.dataset.mapAction;if(a==='in')this.zoom(1.8);if(a==='out')this.zoom(1/1.8);if(a==='reset')this.reset();if(a==='expand')root.AtlasFullscreen.open(host,'行业时间热力图');},{signal:this.abort.signal});
      this.surface.addEventListener('scroll',()=>{this.header.style.transform=`translateX(${-this.surface.scrollLeft}px)`;this.names.style.transform=`translateY(${-this.surface.scrollTop}px)`;},{passive:true,signal:this.abort.signal});
      this.gesture=new root.AtlasGesture(this.surface,{wheel:false,inspect:p=>this.inspect(p),tap:p=>this.inspect(p),zoom:(f,p)=>this.zoom(f,p),reset:()=>this.reset(),canPan:()=>false});
      this.canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();this.index=clamp(this.index+(e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0),0,this.dates.length-1);this.row=clamp((this.row??0)+(e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0),0,this.rows.length-1);this.onInspect?.(this.index,this);this.updateCursor();const r=this.surface.getBoundingClientRect();this.show({x:r.left+r.width/2,y:r.top+50});},{signal:this.abort.signal});
      this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(this.surface);window.addEventListener('resize',()=>this.draw(),{signal:this.abort.signal});this.draw();
    }
    destroy(){this.gesture.destroy();this.observer.disconnect();this.abort.abort();}
    setIndex(index){this.index=index;this.updateCursor();}
    draw() {
      const width=this.surface.clientWidth;if(!width)return;
      const fit=width/this.dates.length;if(!this.cellWidth||this.fitted)this.cellWidth=fit;
      const w=Math.max(width,Math.ceil(this.cellWidth*this.dates.length)),h=this.rows.length*this.rowHeight;
      const style=getComputedStyle(this.host),base=rgb(style.getPropertyValue('--surface')),rise=rgb(style.getPropertyValue('--rise')),fall=rgb(style.getPropertyValue('--fall'));
      this.canvas.width=w;this.canvas.height=h;this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';this.stage.style.width=w+'px';this.stage.style.height=h+'px';
      const ctx=this.canvas.getContext('2d'),limit=this.window===1?5:18;
      for(let r=0;r<this.rows.length;r++)for(let d=0;d<this.dates.length;d++){const value=this.rows[r].values[d],strength=this.metric==='breadth'?(value-50)/50:value/limit,t=finite(value)?Math.min(1,Math.abs(strength))*.8+.08:0,to=strength>=0?rise:fall;ctx.fillStyle=finite(value)?`rgb(${base.map((v,i)=>Math.round(v+(to[i]-v)*t)).join(',')})`:style.getPropertyValue('--subtle');ctx.fillRect(d*this.cellWidth,r*this.rowHeight,Math.ceil(this.cellWidth),this.rowHeight-3);}
      const dpr=Math.min(devicePixelRatio||1,2);this.header.width=w*dpr;this.header.height=28*dpr;this.header.style.width=w+'px';this.header.style.height='28px';const c=this.header.getContext('2d');c.scale(dpr,dpr);c.fillStyle=style.getPropertyValue('--muted');c.font='11px "Segoe UI","Microsoft YaHei"';
      const stride=Math.max(1,Math.ceil(82/this.cellWidth));for(let i=0;i<this.dates.length;i+=stride){c.fillText(this.dates[i].slice(2),i*this.cellWidth+2,18);}
      this.host.querySelector('.map-caption').textContent=`${this.dates[0]} — ${this.dates.at(-1)} · ${this.dates.length}个交易日 × ${this.rows.length}个行业 · 冷色落后，暖色领先`;
      if(this.host.classList.contains('is-fullscreen')){const h=Math.max(160,this.host.parentElement.clientHeight-185-this.readout.getBoundingClientRect().height);this.surface.style.maxHeight=h+'px';this.names.parentElement.style.maxHeight=h+'px';}else{this.surface.style.maxHeight='';this.names.parentElement.style.maxHeight='';}
      this.host.dataset.columns=this.dates.length;this.host.dataset.rows=this.rows.length;this.updateCursor();
    }
    reset(){this.fitted=true;this.surface.scrollLeft=0;this.draw();}
    zoom(factor,p) {
      const r=this.surface.getBoundingClientRect(),x=p?clamp(p.x-r.left,0,r.width):r.width/2,anchor=(this.surface.scrollLeft+x)/this.cellWidth;
      const min=this.surface.clientWidth/this.dates.length;this.cellWidth=clamp(this.cellWidth*factor,min,40);this.fitted=this.cellWidth<=min+.001;this.draw();this.surface.scrollLeft=anchor*this.cellWidth-x;
    }
    updateCursor(){this.host.querySelector('.chart-date').textContent=this.dates[this.index];this.surface.querySelector('.heat-cursor').style.left=(this.index+.5)*this.cellWidth+'px';const cell=this.surface.querySelector('.heat-selection');cell.hidden=this.row===undefined;if(this.row!==undefined){Object.assign(cell.style,{left:this.index*this.cellWidth+'px',top:this.row*this.rowHeight+'px',width:Math.max(2,this.cellWidth)+'px',height:this.rowHeight-3+'px'});}this.focus=this.rows[this.row]?.name;root.AtlasInspector.render(this,{date:this.dates[this.index],rows:this.inspectionRows(this.index,this.row),focus:this.focus});}
    inspect(p){const r=this.surface.getBoundingClientRect();this.index=clamp(Math.floor((p.x-r.left+this.surface.scrollLeft)/this.cellWidth),0,this.dates.length-1);this.row=clamp(Math.floor((p.y-r.top+this.surface.scrollTop)/this.rowHeight),0,this.rows.length-1);this.onInspect?.(this.index,this);this.updateCursor();this.show(p);}
    show(p){root.AtlasInspector.show(this,{date:this.dates[this.index],rows:this.inspectionRows(this.index,this.row),x:p.x,y:p.y});}
  }
  // Weekly samples of the actual 20/60-session excess series; no curve smoothing.
  function rotationTrail(row,index,step=5,count=5){
    const out=[];for(let n=count-1;n>=0;n--){const i=index-n*step;if(i>=0)out.push({index:i,x:row.x[i],y:row.y[i]});}return out;
  }
  let scatterId=0;
  class Scatter {
    constructor(host,options) {
      this.host=host;Object.assign(this,options);this.index=this.dates.length-1;this.independentDate=true;this.id=++scatterId;this.abort=new AbortController();
      host.classList.add('scatter-host');
      host.innerHTML=toolbar('行业中期强弱与改善方向')+`<div class="rotation-controls"><div class="rotation-pickers"><label><span class="sr-only">轮动观察窗口</span><select class="rotation-window"><option value="20" ${this.lookback===20?'selected':''}>20日轮动</option><option value="60" ${this.lookback===60?'selected':''}>60日轮动</option></select></label><label><span class="sr-only">固定观察行业</span><select class="rotation-industry"><option value="">指向行业查看轨迹</option></select></label></div><div class="rotation-timeline"><button data-time="prev" aria-label="前一交易日">‹</button><button data-time="play" aria-label="播放行业轮动">播放</button><button data-time="next" aria-label="后一交易日">›</button><input type="range" min="0" max="${this.dates.length-1}" step="1" value="${this.index}" aria-label="轮动时间"><span class="timeline-extent">${this.dates[0].slice(0,7)} — ${this.dates.at(-1).slice(0,7)}</span></div></div><div class="chart-readout"></div><div class="chart-canvas"><svg class="atlas-scatter" tabindex="0" role="img"></svg><div class="rotation-input" aria-hidden="true"></div></div><p class="rotation-explanation">横轴：近${this.lookback}日行业收益减股票池收益；纵轴：这项超额近5日的变化。右侧跑赢，上方改善。仅展示当前观察行业的轨迹，每5个交易日一个点，箭头指向当前日期。拖动上方时间轴可跨月查看。</p>`;
      this.surface=host.querySelector('.chart-canvas');this.svg=host.querySelector('svg');this.timeline=host.querySelector('input[type=range]');root.AtlasInspector.mount(this);
      this.fillIndustryPicker();
      host.addEventListener('click',e=>{const a=e.target.closest('[data-map-action]')?.dataset.mapAction;if(a==='in')this.zoom(1.6);if(a==='out')this.zoom(1/1.6);if(a==='reset')this.reset();if(a==='expand')root.AtlasFullscreen.open(host,'行业轮动 · 独立时间轴');const t=e.target.closest('[data-time]')?.dataset.time;if(t==='play')this.play();if(t==='prev'||t==='next'){this.pause();this.setIndex(this.index+(t==='prev'?-1:1));}},{signal:this.abort.signal});
      this.timeline.addEventListener('input',()=>{this.pause();this.setIndex(Number(this.timeline.value));},{signal:this.abort.signal});
      host.querySelector('.rotation-window').addEventListener('change',e=>{this.pause();this.onWindow(Number(e.target.value));},{signal:this.abort.signal});
      host.querySelector('.rotation-industry').addEventListener('change',e=>{this.pinned=e.target.value;this.focus=this.pinned;this.draw();},{signal:this.abort.signal});
      this.gesture=new root.AtlasGesture(this.surface,{touchInspect:true,scrub:true,start:()=>this.dragDomain=this.domain&&[...this.domain],inspect:p=>this.inspect(p),tap:p=>this.pick(p),end:(p,start)=>{if(start&&Math.hypot(p.x-start.x,p.y-start.y)<7)this.pick(p);},drag:(p,start)=>{if(this.zoomed&&this.dragDomain){const dx=(p.x-start.x)/this.g.width*(this.dragDomain[1]-this.dragDomain[0]),dy=(p.y-start.y)/this.g.height*(this.dragDomain[3]-this.dragDomain[2]);this.domain=[this.dragDomain[0]-dx,this.dragDomain[1]-dx,this.dragDomain[2]+dy,this.dragDomain[3]+dy];this.draw();}else this.inspect(p);},canPan:()=>this.zoomed,zoom:(f,p)=>this.zoom(f,p),reset:()=>this.reset()});
      this.svg.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();this.pause();this.setIndex(this.index+(e.key==='ArrowLeft'?-1:1));}if(e.key==='0')this.reset();const name=e.target.closest('[data-point]')?.dataset.point;if(name&&['Enter',' '].includes(e.key)){e.preventDefault();this.pinned=name;this.focus=name;this.draw();}},{signal:this.abort.signal});
      this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(this.surface);window.addEventListener('resize',()=>this.draw(),{signal:this.abort.signal});this.draw();
    }
    destroy(){this.pause();this.gesture.destroy();this.observer.disconnect();this.abort.abort();}
    pause(){clearInterval(this.timer);this.timer=null;const b=this.host.querySelector('[data-time=play]');if(b){b.textContent='播放';b.setAttribute('aria-pressed','false');}}
    play(){if(this.timer){this.pause();return;}if(this.index===this.dates.length-1){const first=this.dates.findIndex((_,i)=>this.rows.some(r=>finite(r.x[i])&&finite(r.y[i])));this.setIndex(Math.max(0,first));}const b=this.host.querySelector('[data-time=play]');b.textContent='暂停';b.setAttribute('aria-pressed','true');this.timer=setInterval(()=>{if(this.index>=this.dates.length-1){this.pause();return;}this.setIndex(this.index+1);},320);}
    setIndex(i){this.index=clamp(i,0,this.dates.length-1);this.timeline.value=this.index;this.timeline.setAttribute('aria-valuetext',this.dates[this.index]);this.onDate?.(this.dates[this.index]);if(!this.zoomed)this.domain=null;this.draw();}
    fillIndustryPicker(){const el=this.host.querySelector('.rotation-industry');el.innerHTML='<option value="">指向行业查看轨迹</option>'+this.rows.filter(r=>this.selected.has(r.name)).map(r=>`<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('');el.value=this.pinned||'';}
    setSelection(selected){this.selected=selected;if(!selected.has(this.focus)){this.focus='';this.pinned='';}this.domain=null;this.zoomed=false;this.fillIndustryPicker();this.draw();}
    reset(){this.zoomed=false;this.domain=null;this.draw();}
    zoom(factor,p){if(!this.domain)return;const r=this.surface.getBoundingClientRect(),fx=p?clamp((p.x-r.left-this.g.left)/this.g.width,0,1):.5,fy=p?clamp((this.g.bottom-(p.y-r.top))/this.g.height,0,1):.5,[a,b,c,d]=this.domain,x=a+(b-a)*fx,y=c+(d-c)*fy,w=(b-a)/factor,h=(d-c)/factor;if(w<.001||h<.001||w>1e5||h>1e5)return;this.domain=[x-w*fx,x+w*(1-fx),y-h*fy,y+h*(1-fy)];this.zoomed=true;this.draw();}
    draw(){
      this.w=Math.round(this.surface.getBoundingClientRect().width);if(this.w<100)return;
      this.h=360;
      if(this.host.classList.contains('is-fullscreen')){let used=20;for(const child of this.host.children)if(child!==this.surface)used+=child.getBoundingClientRect().height;this.h=Math.max(160,this.host.parentElement.clientHeight-used);}
      this.surface.style.height=this.h+'px';this.svg.setAttribute('viewBox',`0 0 ${this.w} ${this.h}`);this.g=root.AtlasCharts.geometry(this.w,this.h);
      const visible=this.rows.filter(r=>this.selected.has(r.name));
      this.points=visible.map(row=>({...row,x:row.x[this.index],y:row.y[this.index]})).filter(p=>finite(p.x)&&finite(p.y));
      if(!this.domain){let x=1,y=1;for(const row of visible)for(let i=Math.max(0,this.index-20);i<=this.index;i++){if(finite(row.x[i]))x=Math.max(x,Math.abs(row.x[i]));if(finite(row.y[i]))y=Math.max(y,Math.abs(row.y[i]));}const nice=v=>{const n=v*1.1,p=10**Math.floor(Math.log10(n));return([1,2,3,5,8,10].find(k=>k>=n/p)||10)*p;};x=nice(x);y=nice(y);this.domain=[-x,x,-y,y];}
      const [a,b,c,d]=this.domain,g=this.g;this.X=x=>g.left+(x-a)/(b-a)*g.width;this.Y=y=>g.bottom-(y-c)/(d-c)*g.height;
      const clip='rotationClip'+this.id,arrow='rotationArrow'+this.id;
      let html=`<defs><clipPath id="${clip}"><rect x="${g.left}" y="${g.top}" width="${g.width}" height="${g.height}"/></clipPath><marker id="${arrow}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0L10,5L0,10" fill="var(--plot-gold)"/></marker></defs>`;
      for(const v of root.AtlasCharts.ticks(a,b,3))html+=`<path class="grid-line" d="M${this.X(v)},${g.top}V${g.bottom}"/><text class="axis-label" x="${this.X(v)}" y="${this.h-10}" text-anchor="middle">${num(v,1)}</text>`;
      for(const v of root.AtlasCharts.ticks(c,d,3))html+=`<path class="grid-line" d="M${g.left},${this.Y(v)}H${g.right}"/><text class="axis-label" x="${g.left-10}" y="${this.Y(v)+4}" text-anchor="end">${num(v,1)}</text>`;
      if(a<=0&&b>=0)html+=`<path class="zero-line" d="M${this.X(0)},${g.top}V${g.bottom}"/>`;if(c<=0&&d>=0)html+=`<path class="zero-line" d="M${g.left},${this.Y(0)}H${g.right}"/>`;
      html+=`<text class="axis-unit" x="${g.left}" y="13">超额改善 / 百分点</text><text class="axis-unit" x="${g.right}" y="${this.h-26}" text-anchor="end">${this.lookback}日超额 / 百分点</text>`;
      const quadrant=(x,y,text)=>`<text class="quadrant-label" x="${x}" y="${y}">${text}</text>`;
      html+=quadrant(g.left+8,g.top+18,'落后改善')+quadrant(g.right-70,g.top+18,'领先增强')+quadrant(g.left+8,g.bottom-13,'落后走弱')+quadrant(g.right-70,g.bottom-13,'领先减弱');
      html+=`<g clip-path="url(#${clip})">`;
      const row=visible.find(r=>r.name===this.focus);this.trail=row?rotationTrail(row,this.index):[];
      if(row){let trail='',open=false;for(const p of this.trail){if(!finite(p.x)||!finite(p.y)){open=false;continue;}trail+=(open?'L':'M')+this.X(p.x)+','+this.Y(p.y);open=true;}html+=`<path class="rotation-trail" d="${trail}" fill="none" stroke="var(--plot-gold)" stroke-width="1.8" marker-end="url(#${arrow})"/>`;for(const p of this.trail)if(finite(p.x)&&finite(p.y))html+=`<circle class="trail-sample" cx="${this.X(p.x)}" cy="${this.Y(p.y)}" r="2.8" fill="var(--plot-gold)"/>`;}
      for(const p of this.points){const x=this.X(p.x),y=this.Y(p.y),chosen=p.name===this.focus;html+=`<g data-point="${esc(p.name)}" role="button" tabindex="0" aria-label="${esc(p.name)}，超额${num(p.x)}，改善${num(p.y)}" aria-pressed="${chosen}"><circle cx="${x}" cy="${y}" r="${chosen?6:3.5}" fill="${chosen?'var(--plot-gold)':'var(--plot-blue)'}" opacity="${chosen?1:.55}"/></g>`;}
      html+='</g>';
      const point=this.points.find(p=>p.name===this.focus);if(point)html+=`<text class="point-label" x="${clamp(this.X(point.x)+10,g.left,g.right-95)}" y="${clamp(this.Y(point.y)-10,g.top+32,g.bottom-28)}">${esc(point.name)}</text>`;
      if(!this.points.length)html+=`<text class="axis-label" x="${(g.left+g.right)/2}" y="${(g.top+g.bottom)/2}" text-anchor="middle">${visible.length?'历史不足，向后选择交易日':'请在行业对比中选择行业'}</text>`;
      this.svg.innerHTML=html;this.svg.dataset.date=this.dates[this.index];this.svg.dataset.focus=this.focus||'';this.svg.setAttribute('aria-label','行业轮动：右侧跑赢，上方改善；移动查看行业，点按固定，时间轴独立于其他图表。');
      this.host.querySelector('.rotation-industry').value=this.pinned||'';
      root.AtlasInspector.render(this,{date:this.dates[this.index]+(this.pinned?' · 已固定':''),rows:point?[{name:point.name+' · '+this.lookback+'日超额',value:point.x,unit:'个百分点',color:'var(--plot-gold)'},{name:'近5日超额改善',value:point.y,unit:'个百分点',color:'var(--plot-gold)'}]:[{name:'移动指针或拖动查看行业',value:null}]});
    }
    nearest(p){const r=this.surface.getBoundingClientRect(),x=p.x-r.left,y=p.y-r.top;let best=null,distance=Infinity;for(const point of this.points){const px=this.X(point.x),py=this.Y(point.y);if(px<this.g.left||px>this.g.right||py<this.g.top||py>this.g.bottom)continue;const d=Math.hypot(px-x,py-y);if(d<distance){distance=d;best=point;}}return best;}
    pick(p){const point=this.nearest(p);if(point){this.pinned=this.pinned===point.name?'':point.name;this.focus=point.name;this.draw();}}
    inspect(p){const point=this.nearest(p);if(point&&this.focus!==point.name){this.focus=point.name;this.draw();}}
  }
  root.AtlasMaps={Heatmap,Scatter,rotationTrail};
  if(typeof module!=='undefined')module.exports={rotationTrail};
})(globalThis);
