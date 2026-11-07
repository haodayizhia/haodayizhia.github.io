'use strict';
(function(root) {
  const {escape:esc,number:num,finite,clamp}=root.AtlasCharts;
  const toolbar=label=>`<div class="plot-toolbar"><div><time class="chart-date"></time><span>${esc(label)}</span></div><div class="plot-actions"><button data-map-action="out" aria-label="缩小">−</button><button data-map-action="in" aria-label="放大">＋</button><button data-map-action="reset">复原</button><button data-map-action="expand">全屏</button></div></div>`;
  function rgb(text){if(text.trim().startsWith('#')){let h=text.trim().slice(1);if(h.length===3)h=[...h].map(c=>c+c).join('');return[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));}return(text.match(/[\d.]+/g)||[0,0,0]).slice(0,3).map(Number);}
  class Heatmap {
    constructor(host,options) {
      this.host=host;Object.assign(this,{rowHeight:30,index:options.dates.length-1},options);this.fitted=true;this.abort=new AbortController();host.classList.add('heatmap-host');
      host.innerHTML=toolbar('完整研究区间 · 双指缩放时间')+'<div class="heat-layout"><div class="heat-corner">行业</div><div class="heat-head"><canvas></canvas></div><div class="heat-names"><div></div></div><div class="heat-scroll"><div class="heat-stage"><canvas aria-label="完整行业时间热力图" tabindex="0"></canvas><div class="heat-cursor"></div><div class="heat-selection" hidden></div></div></div></div><p class="map-caption"></p>';
      this.surface=host.querySelector('.heat-scroll');this.canvas=this.surface.querySelector('canvas');this.stage=this.surface.firstElementChild;this.header=host.querySelector('.heat-head canvas');this.names=host.querySelector('.heat-names>div');
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
      this.host.dataset.columns=this.dates.length;this.host.dataset.rows=this.rows.length;this.updateCursor();
    }
    reset(){this.fitted=true;this.surface.scrollLeft=0;this.draw();}
    zoom(factor,p) {
      const r=this.surface.getBoundingClientRect(),x=p?clamp(p.x-r.left,0,r.width):r.width/2,anchor=(this.surface.scrollLeft+x)/this.cellWidth;
      const min=this.surface.clientWidth/this.dates.length;this.cellWidth=clamp(this.cellWidth*factor,min,40);this.fitted=this.cellWidth<=min+.001;this.draw();this.surface.scrollLeft=anchor*this.cellWidth-x;
    }
    updateCursor(){this.host.querySelector('.chart-date').textContent=this.dates[this.index];this.surface.querySelector('.heat-cursor').style.left=(this.index+.5)*this.cellWidth+'px';const cell=this.surface.querySelector('.heat-selection');cell.hidden=this.row===undefined;if(this.row!==undefined){Object.assign(cell.style,{left:this.index*this.cellWidth+'px',top:this.row*this.rowHeight+'px',width:Math.max(2,this.cellWidth)+'px',height:this.rowHeight-3+'px'});}}
    inspect(p){const r=this.surface.getBoundingClientRect();this.index=clamp(Math.floor((p.x-r.left+this.surface.scrollLeft)/this.cellWidth),0,this.dates.length-1);this.row=clamp(Math.floor((p.y-r.top+this.surface.scrollTop)/this.rowHeight),0,this.rows.length-1);this.onInspect?.(this.index,this);this.updateCursor();this.show(p);}
    show(p){root.AtlasInspector.show(this,{date:this.dates[this.index],rows:this.inspectionRows(this.index,this.row),x:p.x,y:p.y});}
  }
  class Scatter {
    constructor(host,options) {
      this.host=host;Object.assign(this,options);this.index=this.dates.length-1;this.abort=new AbortController();host.classList.add('scatter-host');host.innerHTML=toolbar('点击选中行业 · 双指缩放')+'<div class="chart-canvas"><svg class="atlas-scatter" tabindex="0" role="img"></svg></div><div class="rotation-selected"></div>';
      this.surface=host.querySelector('.chart-canvas');this.svg=host.querySelector('svg');
      host.addEventListener('click',e=>{const a=e.target.closest('[data-map-action]')?.dataset.mapAction;if(a==='in')this.zoom(1.6);if(a==='out')this.zoom(1/1.6);if(a==='reset')this.reset();if(a==='expand')root.AtlasFullscreen.open(host,'市场轮动');const remove=e.target.closest('[data-remove-point]');if(remove)this.onToggle(remove.dataset.removePoint);},{signal:this.abort.signal});
      this.gesture=new root.AtlasGesture(this.surface,{start:()=>this.dragDomain=this.domain&&[...this.domain],inspect:p=>this.inspect(p),tap:p=>this.pick(p),end:(p,start)=>{if(start&&Math.hypot(p.x-start.x,p.y-start.y)<7)this.pick(p);},drag:(p,start)=>{if(this.zoomed&&this.dragDomain){const dx=(p.x-start.x)/this.g.width*(this.dragDomain[1]-this.dragDomain[0]),dy=(p.y-start.y)/this.g.height*(this.dragDomain[3]-this.dragDomain[2]);this.domain=[this.dragDomain[0]-dx,this.dragDomain[1]-dx,this.dragDomain[2]+dy,this.dragDomain[3]+dy];this.draw();}else this.inspect(p);},canPan:()=>this.zoomed,zoom:(f,p)=>this.zoom(f,p),reset:()=>this.reset()});
      this.svg.addEventListener('keydown',e=>{const name=e.target.closest('[data-point]')?.dataset.point;if(name&&['Enter',' '].includes(e.key)){e.preventDefault();this.onToggle(name);}if(e.key==='0')this.reset();},{signal:this.abort.signal});
      this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(this.surface);window.addEventListener('resize',()=>this.draw(),{signal:this.abort.signal});this.draw();
    }
    destroy(){this.gesture.destroy();this.observer.disconnect();this.abort.abort();}
    setIndex(i){this.index=i;if(!this.zoomed)this.domain=null;this.draw();}
    setSelection(selected){this.selected=selected;this.draw();}
    reset(){this.zoomed=false;this.domain=null;this.draw();}
    zoom(factor,p){if(!this.domain)return;const r=this.surface.getBoundingClientRect(),fx=p?clamp((p.x-r.left-this.g.left)/this.g.width,0,1):.5,fy=p?clamp((this.g.bottom-(p.y-r.top))/this.g.height,0,1):.5,[a,b,c,d]=this.domain,x=a+(b-a)*fx,y=c+(d-c)*fy,w=(b-a)/factor,h=(d-c)/factor;if(w<.001||h<.001||w>1e5||h>1e5)return;this.domain=[x-w*fx,x+w*(1-fx),y-h*fy,y+h*(1-fy)];this.zoomed=true;this.draw();}
    draw(){
      this.w=Math.round(this.surface.getBoundingClientRect().width);if(this.w<100)return;
      this.h=this.host.classList.contains('is-fullscreen')?Math.max(250,this.host.parentElement.clientHeight-110):360;this.surface.style.height=this.h+'px';this.svg.setAttribute('viewBox',`0 0 ${this.w} ${this.h}`);this.g=root.AtlasCharts.geometry(this.w,this.h);
      this.points=this.rows.map(row=>({...row,x:row.x[this.index],y:row.y[this.index]})).filter(p=>finite(p.x)&&finite(p.y));
      if(!this.domain){let x=1,y=1;for(const p of this.points){x=Math.max(x,Math.abs(p.x));y=Math.max(y,Math.abs(p.y));}this.domain=[-x*1.12,x*1.12,-y*1.12,y*1.12];}
      const [a,b,c,d]=this.domain,g=this.g;this.X=x=>g.left+(x-a)/(b-a)*g.width;this.Y=y=>g.bottom-(y-c)/(d-c)*g.height;
      let html='';for(const v of root.AtlasCharts.ticks(a,b,3))html+=`<path class="grid-line" d="M${this.X(v)},${g.top}V${g.bottom}"/><text class="axis-label" x="${this.X(v)}" y="${this.h-10}" text-anchor="middle">${num(v,1)}</text>`;
      for(const v of root.AtlasCharts.ticks(c,d,3))html+=`<path class="grid-line" d="M${g.left},${this.Y(v)}H${g.right}"/><text class="axis-label" x="${g.left-10}" y="${this.Y(v)+4}" text-anchor="end">${num(v,1)}</text>`;
      if(a<=0&&b>=0)html+=`<path class="zero-line" d="M${this.X(0)},${g.top}V${g.bottom}"/>`;if(c<=0&&d>=0)html+=`<path class="zero-line" d="M${g.left},${this.Y(0)}H${g.right}"/>`;
      html+=`<text class="axis-unit" x="${g.left}" y="13">超额变化 / 百分点</text><text class="axis-unit" x="${g.right}" y="${this.h-26}" text-anchor="end">超额收益 / 百分点</text>`;
      for(const row of this.rows)if(this.selected.has(row.name)){let trail='',open=false;for(let i=Math.max(0,this.index-19);i<=this.index;i++){if(!finite(row.x[i])||!finite(row.y[i])){open=false;continue;}trail+=(open?'L':'M')+this.X(row.x[i])+','+this.Y(row.y[i]);open=true;}html+=`<path d="${trail}" fill="none" stroke="${row.color}" opacity=".55" stroke-width="1.5"/>`;}
      for(const p of this.points){const x=this.X(p.x),y=this.Y(p.y),chosen=this.selected.has(p.name);if(x<g.left||x>g.right||y<g.top||y>g.bottom)continue;html+=`<g data-point="${esc(p.name)}" role="button" tabindex="0" aria-label="${esc(p.name)}，超额${num(p.x)}，变化${num(p.y)}" aria-pressed="${chosen}"><circle cx="${x}" cy="${y}" r="${chosen?6:3.5}" fill="${chosen?p.color:'var(--plot-blue)'}" opacity="${chosen?1:.4}"/><title>${esc(p.name)}</title></g>`;if(chosen)html+=`<text class="point-label" x="${clamp(x+10,g.left,g.right-70)}" y="${clamp(y-10,g.top+12,g.bottom)}">${esc(p.name)}</text>`;}
      this.svg.innerHTML=html;this.svg.setAttribute('aria-label','市场轮动；点击行业点可多选，选中项显示轨迹。');this.host.querySelector('.chart-date').textContent=this.dates[this.index];
      this.host.querySelector('.rotation-selected').innerHTML=this.points.filter(p=>this.selected.has(p.name)).map(p=>`<button data-remove-point="${esc(p.name)}"><i style="background:${p.color}"></i>${esc(p.name)}<span>${num(p.x)} / ${num(p.y)}</span> ×</button>`).join('')||'<p class="map-caption">点选行业显示历史轨迹；上方“行业对比”也可查找选择。</p>';
    }
    nearest(p){const r=this.surface.getBoundingClientRect(),x=p.x-r.left,y=p.y-r.top;let best=null,distance=24;for(const point of this.points){const d=Math.hypot(this.X(point.x)-x,this.Y(point.y)-y);if(d<distance){distance=d;best=point;}}return best;}
    pick(p){const point=this.nearest(p);if(point)this.onToggle(point.name);this.inspect(p);}
    inspect(p){const point=this.nearest(p),names=new Set(this.selected);if(point)names.add(point.name);const rows=[];for(const name of names){const row=this.points.find(p=>p.name===name);if(row){rows.push({name:row.name+' · 超额',value:row.x,unit:'个百分点',color:row.color});rows.push({name:row.name+' · 变化',value:row.y,unit:'个百分点',color:row.color});}}if(rows.length)root.AtlasInspector.show(this,{date:this.dates[this.index],rows,x:p.x,y:p.y});}
  }
  root.AtlasMaps={Heatmap,Scatter};
})(globalThis);
