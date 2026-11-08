'use strict';
(function(root) {
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=(v,d=2)=>finite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
  const axisNumber=v=>finite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:12}):'—';
  let axisContext;
  function measureAxis(labels){
    const size=root.innerWidth<=760?11:12;
    if(!axisContext&&root.document)axisContext=document.createElement('canvas').getContext('2d');
    if(axisContext)axisContext.font=size+'px Inter,"Segoe UI","Microsoft YaHei",sans-serif';
    return Math.max(0,...labels.map(label=>axisContext?axisContext.measureText(label).width:String(label).length*size*.62));
  }
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function bounds(series) {
    let lo=Infinity,hi=-Infinity;
    for(const s of series)for(const v of s.values||[])if(finite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v);}
    if(!finite(lo))return [-1,1];
    if(lo===hi){const pad=Math.max(Math.abs(lo)*.02,1);lo-=pad;hi+=pad;}
    const pad=(hi-lo)*.1;return [lo-pad,hi+pad];
  }
  function ticks(lo,hi,count=4) {
    const raw=(hi-lo)/count,p=10**Math.floor(Math.log10(raw||1)),r=raw/p,step=(r<=1?1:r<=2?2:r<=5?5:10)*p,out=[];
    for(let v=Math.ceil(lo/step)*step;v<=hi+step*.001;v+=step)out.push(Math.abs(v)<1e-9?0:v);
    return out;
  }
  function geometry(width,height,labelWidth=24) {
    const left=Math.max(30,Math.ceil(labelWidth+8)),right=width-6,top=12,bottom=height-30;
    return {left,right,top,bottom,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
  }
  function path(values,X,Y,start=0,end=values.length-1) {
    let d='',open=false;
    for(let i=start;i<=end;i++){const v=values[i];if(!finite(v)){open=false;continue;}const x=X(i),y=Y(v);if(!finite(y)){open=false;continue;}d+=(open?'L':'M')+x.toFixed(2)+','+y.toFixed(2);open=true;}
    return d;
  }
  const linePatterns=['','8 3','3 3','10 3 2 3','1 3','12 4','6 3 1 3','2 2 8 2'];
  function seriesStyle(index){return{color:`var(--plot-c${index%12+1})`,dash:linePatterns[Math.floor(index/12)%linePatterns.length]};}
  function rankLatest(items,value){return [...items].sort((a,b)=>{const x=value(a),y=value(b);return(finite(y)?1:0)-(finite(x)?1:0)||(finite(x)&&finite(y)?y-x:0)||String(a.name||a.code||'').localeCompare(String(b.name||b.code||''),'zh-CN');});}
  function zoomDomain(range,factor,anchor=.5){
    if(!range?.every(finite)||range[1]<=range[0]||!finite(factor)||factor<=0)return range&&[...range];
    anchor=clamp(anchor,0,1);const width=clamp((range[1]-range[0])/factor,1e-9,1e12),pivot=range[0]+(range[1]-range[0])*anchor;
    return[pivot-width*anchor,pivot+width*(1-anchor)];
  }
  let chartId=0;
  class Chart {
    constructor(host,options) {
      this.host=host;Object.assign(this,{unit:'%',label:'',kind:'lines',stock:null,log:false,compact:false,onInspect:()=>{},onRange:()=>{},onYRange:()=>{},inspectionActive:false},options);
      this.id=++chartId;this.index=this.dates.length-1;this.view=[0,Math.max(0,this.dates.length-1)];this.resetView=[...this.view];this.axisValue=null;this.revision=0;
      this.abort=new AbortController();
      host.classList.add('chart-host');
      const heading=escape(this.label)+(this.unit?`<small class="chart-unit">（${escape(this.unit)}）</small>`:'');
      host.innerHTML=`${this.compact?`<header class="mini-chart-head"><h3>${heading}</h3><dl class="chart-values"></dl></header>`:`<div class="plot-toolbar"><div><span class="chart-label" title="${escape(this.label)}（${escape(this.unit)}）">${heading}</span><span class="chart-window"></span></div><div class="plot-actions"><button data-chart-action="out" aria-label="缩小图表" title="同时缩小时间与数值范围">−</button><button data-chart-action="in" aria-label="放大图表" title="同时放大时间与数值范围">＋</button><button data-chart-action="reset">复原</button><button data-chart-action="expand">⛶ 全屏</button></div></div><div class="chart-readout"></div>`}<div class="chart-canvas"><svg class="atlas-chart" tabindex="0" role="img"></svg><div class="chart-input" aria-hidden="true"></div></div>`;
      this.surface=host.querySelector('.chart-canvas');this.svg=host.querySelector('svg');this.values=host.querySelector('.chart-values');root.AtlasInspector.mount(this,this.readoutHost);
      host.addEventListener('click',e=>{const action=e.target.closest('[data-chart-action]')?.dataset.chartAction;if(action==='in')this.zoom(1.7);if(action==='out')this.zoom(1/1.7);if(action==='reset')this.reset();if(action==='expand')root.AtlasFullscreen.open(this.host,this.label);const remove=e.target.closest('[data-remove-series]');if(remove)this.onRemove?.(remove.dataset.removeSeries);},{signal:this.abort.signal});
      this.svg.addEventListener('keydown',e=>this.key(e),{signal:this.abort.signal});
      this.gesture=new root.AtlasGesture(this.surface,{
        owner:this,dismiss:keep=>{this.clearInspection(keep);this.onDismiss?.(keep,this);},inspect:p=>this.inspect(p),tap:p=>this.select(p),
        start:()=>{this.dragView=[...this.view];this.dragY=[this.lo,this.hi];},
        drag:(p,start)=>{if(start.shift){this.brush=[this.local(start).x,this.local(p).x];this.updateOverlay();}else if(this.canPan()){this.pan(p.x-start.x,this.dragView,p.y-start.y,this.dragY);}else this.inspect(p);},
        end:(p,start)=>{if(start?.shift&&this.brush&&Math.abs(this.brush[1]-this.brush[0])>12){const a=this.indexAt(Math.min(...this.brush)),b=this.indexAt(Math.max(...this.brush));this.setRange(a,b,true);}else if(start&&Math.hypot(p.x-start.x,p.y-start.y)<7)this.select(p);this.brush=null;this.updateOverlay();},
        cancel:()=>{this.brush=null;},canPan:()=>this.canPan(),zoom:(factor,p)=>this.zoom(factor,p),panPinch:(dx,dy)=>this.pan(dx,[...this.view],dy,[this.lo,this.hi]),reset:()=>this.reset()
      });
      this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(this.surface);
      window.addEventListener('resize',()=>this.draw(),{signal:this.abort.signal});this.draw();
    }
    destroy(){this.gesture.destroy();this.observer.disconnect();this.abort.abort();}
    canPan(){return this.canPanX()||!!this.yView;}
    canPanX(){return this.view[1]-this.view[0]<this.dates.length-1-.1;}
    local(p){const r=this.surface.getBoundingClientRect();return {x:p.x-r.left,y:p.y-r.top};}
    indexAt(x){return clamp(Math.round(this.view[0]+(x-(this.plotXLeft??this.g.left))/(this.plotXWidth??this.g.width)*(this.view[1]-this.view[0])),Math.ceil(this.view[0]),Math.floor(this.view[1]));}
    setRange(a,b,notify=false) {
      a=clamp(a,0,this.dates.length-1);b=clamp(b,a,this.dates.length-1);
      if(b-a<1&&this.dates.length>1)return;
      const previous=this.index;
      if(notify){this.index=clamp(this.index,Math.ceil(a),Math.floor(b));if(this.index!==previous)this.axisValue=null;}
      this.view=[a,b];this.sceneKey='';this.draw();
      if(notify){this.onRange(this.dates[Math.floor(a)],this.dates[Math.ceil(b)]);if(this.index!==previous)this.onInspect(this.index,this);}
    }
    setDateRange(start,end){const a=this.dates.indexOf(start),b=this.dates.indexOf(end);if(a>=0&&b>=a)this.setRange(a,b);}
    setYRange(range,notify=false){this.yView=range&&[...range];this.sceneKey='';this.draw();if(notify)this.onYRange(this.yView);}
    zoom(factor,p,axis){
      if(!this.hasData||!this.g)return;axis=axis||'both';
      const q=p&&this.local(p);
      if(axis!=='x'){const anchor=q?clamp((this.g.bottom-q.y)/this.g.height,0,1):.5;this.yView=zoomDomain([this.lo,this.hi],factor,anchor);this.sceneKey='';}
      if(axis!=='y'){
        const anchor=q?clamp((q.x-(this.plotXLeft??this.g.left))/(this.plotXWidth??this.g.width),0,1):clamp((this.index-this.view[0])/(this.view[1]-this.view[0]||1),0,1);
        this.setRange(...root.AtlasZoomRange(this.view,this.dates.length,factor,anchor),true);
      }else this.draw();
      if(axis!=='x')this.onYRange(this.yView);
    }
    zoomY(factor,p){this.zoom(factor,p,'y');}
    pan(dx,start,dy=0,yStart){
      if(!start)return;const span=start[1]-start[0],a=clamp(start[0]-dx/(this.plotXWidth??this.g.width)*span,0,this.dates.length-1-span);
      if(this.yView&&yStart){const shift=dy/this.g.height*(yStart[1]-yStart[0]);this.yView=yStart.map(v=>v+shift);this.onYRange(this.yView);}
      if(this.canPanX())this.setRange(a,a+span,true);else{this.sceneKey='';this.draw();}
    }
    reset(){this.yView=null;this.onYRange(null);const [a,b]=this.resetView||[0,this.dates.length-1];this.setRange(a,b,true);this.onReset?.(this);}
    setSeries(series){if(!series.some(s=>s.id===this.pinned))this.pinned=null;if(!series.some(s=>s.id===this.focus))this.focus=null;this.series=series;this.revision++;this.sceneKey='';this.draw();}
    setIndex(index,{reveal=false}={}) {
      this.index=clamp(index,0,this.dates.length-1);this.axisValue=null;
      if(reveal&&(index<this.view[0]||index>this.view[1])){const span=this.view[1]-this.view[0],a=clamp(index-span/2,0,this.dates.length-1-span);this.setRange(a,a+span,true);}
      this.updateOverlay();this.updateValues();
    }
    getRows() {
      if(this.inspectionRows)return this.inspectionRows(this.index);
      if(this.stock) {
        const s=this.stock,i=this.index,hasVolume=s.volume.some(finite);
        return [['开盘',s.open[i],'元'],['最高',s.high[i],'元'],['最低',s.low[i],'元'],['收盘',s.close[i],'元'],['涨跌',s.daily[i],'%'],[hasVolume?'成交量':'成交额',hasVolume?s.volume[i]:s.amount[i],hasVolume?'万股':'亿元'],...this.series.filter(s=>s.id!=='price').map(s=>[s.name,s.values[i],'元'])].map(([name,value,unit])=>({name,value,unit}));
      }
      return this.series.map(s=>({id:s.id,name:s.name,detail:s.detail,canOpen:!!this.onOpenSeries&&!s.reference,openLabel:this.openLabel,value:s.values[this.index],color:s.color,dash:s.dash,unit:this.unit}));
    }
    clearInspection(keepReadout=false){this.inspectionActive=false;this.axisValue=null;this.brush=null;if(!keepReadout){this.focus=null;this.pinned=null;}this.updateOverlay();this.updateValues();}
    select(p){this.inspect(p,true);this.pinned=this.pinned===this.focus?null:this.focus;this.updateOverlay();this.updateValues();}
    inspect(p,force=false) {
      if(!this.hasData||!this.g)return;this.inspectionActive=true;const q=this.local(p);
      if(q.x<0||q.x>this.w||q.y<0||q.y>this.h)return;
      this.index=this.indexAt(q.x);const t=clamp((this.g.bottom-q.y)/this.g.height,0,1);this.axisValue=this.inverse(this.lo+t*(this.hi-this.lo));
      this.focus=!force&&this.pinned?this.pinned:this.series.filter(s=>!s.reference&&finite(s.values[this.index])&&this.Y(s.values[this.index])>=this.g.top&&this.Y(s.values[this.index])<=this.g.bottom).sort((a,b)=>Math.abs(this.Y(a.values[this.index])-q.y)-Math.abs(this.Y(b.values[this.index])-q.y))[0]?.id;
      this.onInspect(this.index,this);this.updateOverlay();this.updateValues();
      root.AtlasInspector.show(this,{date:this.dates[this.index],rows:this.getRows(),x:p.x,y:p.y,axis:`纵轴 ${number(this.axisValue)}${this.unit}`});
    }
    key(e) {
      if(e.key==='Enter'&&this.focus&&this.onOpenSeries){e.preventDefault();this.onOpenSeries(this.focus);return;}
      if(e.key==='Escape'){this.clearInspection();this.onDismiss?.(false,this);return;}
      if(['+','=','-','0','f'].includes(e.key)){e.preventDefault();if(e.key==='0')this.reset();else if(e.key==='f')root.AtlasFullscreen.open(this.host,this.label);else this.zoom(e.key==='-'?1/1.7:1.7);return;}
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
      this.inspectionActive=true;e.preventDefault();if(e.key==='ArrowLeft'||e.key==='ArrowRight')this.setIndex(this.index+(e.key==='ArrowLeft'?-1:1),{reveal:true});
      else this.axisValue=(this.axisValue??this.series[0]?.values[this.index]??0)+(e.key==='ArrowUp'?1:-1)*(this.hi-this.lo)/100;
      this.onInspect(this.index,this);this.updateOverlay();this.updateValues();const r=this.surface.getBoundingClientRect();root.AtlasInspector.show(this,{date:this.dates[this.index],rows:this.getRows(),x:r.right-30,y:r.top+60,axis:`纵轴 ${number(this.axisValue)}${this.unit}`});
    }
    measure() {
      this.w=Math.round(this.surface.getBoundingClientRect().width);let h=this.compact?(this.w<600?130:164):Math.max(this.kind==='candles'?370:350,Math.min(460,this.w*.25));
      const expanded=this.host.closest('.is-fullscreen');
      if(expanded){const stage=expanded.parentElement.getBoundingClientRect().height,readout=this.readout?.getBoundingClientRect().height||0;h=this.compact?Math.max(95,(stage-90-readout)/3-34):Math.max(190,stage-100-readout);}
      this.h=Math.round(h);this.surface.style.height=this.h+'px';this.svg.setAttribute('viewBox',`0 0 ${this.w} ${this.h}`);
      this.g=geometry(this.w,this.h,this.axisLabelWidth);if(this.compact){this.g.top=12;if(this.hideDates)this.g.bottom=this.h-12;}if(this.kind==='candles')this.g.bottom-=76;
      this.g.height=Math.max(1,this.g.bottom-this.g.top);
    }
    draw() {
      this.measure();if(this.w<100||!this.dates.length)return;
      const key=JSON.stringify([this.w,this.h,this.view,this.yView,this.revision,this.log,document.documentElement.dataset.theme]);
      if(this.sceneKey===key){this.updateOverlay();this.updateValues();return;}this.sceneKey=key;
      this.transform=v=>this.log?(v>-100?Math.log1p(v/100):NaN):v;this.inverse=v=>this.log?Math.expm1(v)*100:v;
      const a=Math.max(0,Math.floor(this.view[0])),b=Math.min(this.dates.length-1,Math.ceil(this.view[1]));
      const data=[...this.series,...(this.stock&&this.kind==='candles'?[{values:this.stock.high},{values:this.stock.low}]:[])];
      this.hasData=this.stock?this.stock.close.slice(a,b+1).some(finite):data.some(s=>s.values.slice(a,b+1).some(v=>finite(v)&&finite(this.transform(v))));
      if(!this.hasData){this.svg.innerHTML=`<text class="axis-label" x="${this.w/2}" y="${this.h/2}" text-anchor="middle">当前区间缺少有效数据</text>`;if(this.values)this.values.innerHTML='';root.AtlasInspector.render(this,{date:this.dates[this.index],rows:[]});this.svg.dataset.axisValue='';return;}
      [this.lo,this.hi]=this.yView|| (this.domain?this.domain.map(this.transform):bounds(data.map(s=>({values:s.values.slice(a,b+1).map(v=>finite(v)?this.transform(v):null)}))));
      const axisTicks=ticks(this.lo,this.hi,this.compact?2:4),axisLabels=axisTicks.map(v=>axisNumber(this.inverse(v)));
      this.axisLabelWidth=measureAxis(axisLabels);this.g.left=geometry(this.w,this.h,this.axisLabelWidth).left;this.g.width=Math.max(1,this.g.right-this.g.left);
      const g=this.g,edgeInset=this.stock?Math.min(9,g.width/5):0;this.plotXLeft=g.left+edgeInset;this.plotXWidth=Math.max(1,g.width-2*edgeInset);this.X=i=>this.plotXLeft+(this.view[1]===this.view[0]?.5:(i-this.view[0])/(this.view[1]-this.view[0]))*this.plotXWidth;
      this.Y=v=>g.bottom-(this.transform(v)-this.lo)/(this.hi-this.lo)*g.height;
      let html=`<defs><clipPath id="plotClip${this.id}"><rect x="${g.left}" y="${g.top}" width="${g.width}" height="${g.height}"/></clipPath></defs>`;
      for(const v of axisTicks){const y=g.bottom-(v-this.lo)/(this.hi-this.lo)*g.height;html+=`<path class="grid-line" d="M${g.left},${y}H${g.right}"/><text class="axis-label" x="${g.left-7}" y="${y+4}" text-anchor="end">${axisNumber(this.inverse(v))}</text>`;}
      if(!this.hideDates){const n=this.w<500?3:5;for(let k=0;k<n;k++){const i=clamp(Math.round(this.view[0]+k/(n-1)*(this.view[1]-this.view[0])),0,this.dates.length-1);html+=`<text class="axis-label" x="${g.left+k/(n-1)*g.width}" y="${this.h-9}" text-anchor="${k===0?'start':k===n-1?'end':'middle'}">${this.dates[i].slice(2)}</text>`;}}
      html+=`<g clip-path="url(#plotClip${this.id})">`;
      if(this.kind==='candles'&&this.stock) {
        const s=this.stock,cw=Math.max(1,Math.min(15,this.plotXWidth/Math.max(1,b-a+1)*.65));
        for(let i=a;i<=b;i++){const c=s.close[i],o=s.open[i],h=s.high[i],l=s.low[i],color=c>=o?'var(--rise)':'var(--fall)';if([c,o,h,l].every(finite))html+=`<path d="M${this.X(i)},${this.Y(h)}V${this.Y(l)}" stroke="${color}"/><rect x="${this.X(i)-cw/2}" y="${Math.min(this.Y(o),this.Y(c))}" width="${cw}" height="${Math.max(1,Math.abs(this.Y(o)-this.Y(c)))}" fill="${color}"/>`;else if(finite(c))html+=`<circle cx="${this.X(i)}" cy="${this.Y(c)}" r="1.6" fill="var(--plot-main)"/>`;}
      }
      for(const s of this.series){if(this.kind==='candles'&&s.id==='price')continue;html+=`<path class="data-line" d="${path(s.values,this.X,this.Y,Math.max(0,a-1),Math.min(this.dates.length-1,b+1))}" data-series="${escape(s.id)}" stroke-dasharray="${s.dash||''}" stroke="${s.color||'var(--plot-main)'}" stroke-width="${s.reference?2.3:this.series.length>12?1:1.7}"/>`;}
      html+='</g>';
      if(this.stock&&this.kind==='candles') {
        const volume=this.stock.volume.some(finite)?this.stock.volume:this.stock.amount,unit=this.stock.volume.some(finite)?'万股':'亿元',top=g.bottom+16,bottom=this.h-34;let max=0;
        for(let i=a;i<=b;i++)if(finite(volume[i]))max=Math.max(max,volume[i]);
        html+=`<text class="axis-unit" x="${g.left}" y="${top+10}">${unit==='万股'?'成交量':'成交额'} / ${unit}</text>`;
        for(let i=a;i<=b;i++)if(finite(volume[i])&&max>0){const h=volume[i]/max*(bottom-top-14),cw=Math.max(1,Math.min(14,this.plotXWidth/(b-a+1)*.65));html+=`<rect x="${this.X(i)-cw/2}" y="${bottom-h}" width="${cw}" height="${h}" fill="${this.stock.daily[i]>=0?'var(--rise)':'var(--fall)'}" opacity=".45"/>`;}
      }
      this.lastStyleKey=null;this.svg.innerHTML=html+'<g class="plot-overlay"></g>';this.svg.setAttribute('aria-label',this.label+'；点按或长按查值，双指或滚轮缩放，双击复原。');
      this.svg.dataset.start=String(this.view[0]);this.svg.dataset.end=String(this.view[1]);this.updateOverlay();this.updateValues();
    }
    updateOverlay() {
      const layer=this.svg.querySelector('.plot-overlay');if(!layer||!this.hasData)return;
      const i=this.index,g=this.g,focus=this.inspectionActive?this.focus:null,value=this.inspectionActive?(this.axisValue??this.series[0]?.values[i]):null;let html='';
      if(this.inspectionActive&&i>=this.view[0]&&i<=this.view[1]){
        const x=this.X(i);
        if(this.series.length>12)for(const s of this.series)if(s.reference||s.id===focus)html+=`<path class="focus-trace" d="${path(s.values,this.X,this.Y,Math.max(0,Math.floor(this.view[0])-1),Math.min(this.dates.length-1,Math.ceil(this.view[1])+1))}" clip-path="url(#plotClip${this.id})" fill="none" stroke="${s.color||'var(--plot-main)'}" stroke-width="${s.reference?2.3:2.8}" stroke-dasharray="${s.dash||''}"/>`;
        html+=`<path class="crosshair" d="M${x},${g.top}V${this.stock?this.h-34:g.bottom}"/>`;
        for(const s of this.series)if((this.series.length<=8||s.reference||s.id===focus)&&finite(s.values[i])&&this.Y(s.values[i])>=g.top&&this.Y(s.values[i])<=g.bottom)html+=`<circle cx="${x}" cy="${this.Y(s.values[i])}" r="3.2" fill="${s.color||'var(--plot-main)'}" stroke="var(--bg)" stroke-width="1.3"/>`;
      }
      if(finite(value)&&this.Y(value)>=g.top&&this.Y(value)<=g.bottom){const y=this.Y(value),tagWidth=Math.max(g.left-5,Math.ceil(measureAxis([number(value)])+10));html+=`<path class="crosshair" d="M${g.left},${y}H${g.right}"/><rect class="axis-tag" x="0" y="${y-11}" width="${tagWidth}" height="22" rx="2"/><text class="axis-tag-text" x="${tagWidth-5}" y="${y+4}" text-anchor="end">${number(value)}</text>`;}
      if(this.brush){const left=clamp(Math.min(...this.brush),g.left,g.right),right=clamp(Math.max(...this.brush),g.left,g.right);html+=`<rect class="zoom-brush" x="${left}" y="${g.top}" width="${right-left}" height="${g.height}"/>`;}
      layer.innerHTML=html;const styleKey=this.revision+'|'+focus;if(this.lastStyleKey!==styleKey){const references=new Set(this.series.filter(s=>s.reference).map(s=>s.id));for(const line of this.svg.querySelectorAll('[data-series]')){const active=line.dataset.series===focus,reference=references.has(line.dataset.series);line.style.opacity=this.series.length>12&&!reference&&!active?(focus?'.22':'.55'):'1';line.style.strokeWidth=active?'2.5':'';}this.lastStyleKey=styleKey;}this.svg.dataset.date=this.dates[i];this.svg.dataset.axisValue=finite(value)?String(value):'';
    }
    updateValues() {
      const i=this.index,time=this.host.querySelector('.chart-date');if(time)time.textContent=this.dates[i];
      const range=this.host.querySelector('.chart-window');if(range)range.textContent=this.canPanX()?`${this.dates[Math.ceil(this.view[0])]} — ${this.dates[Math.floor(this.view[1])]}`:'';
      root.AtlasInspector.render(this,{date:this.dates[i],rows:this.getRows(),focus:this.focus});
      if(!this.values)return;
      this.values.innerHTML=this.series.map(s=>`<div><dt><i style="background:${s.color||'var(--plot-main)'}"></i>${escape(s.name)}</dt><dd>${number(s.values[i])}<small>${finite(s.values[i])?escape(this.unit):''}</small></dd>${s.removable?`<button data-remove-series="${escape(s.id)}" aria-label="移除${escape(s.name)}">×</button>`:''}</div>`).join('');
    }
  }
  root.AtlasCharts={Chart,geometry,axisNumber,measureAxis,bounds,ticks,path,escape,number,finite,clamp,rankLatest,seriesStyle,zoomDomain};
  if(typeof module!=='undefined')module.exports={Chart,geometry,axisNumber,bounds,ticks,path,rankLatest,seriesStyle,zoomDomain};
})(globalThis);
