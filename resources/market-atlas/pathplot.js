'use strict';

class PathPlot {
 constructor(id,kind,pane=null){
  this.pane=pane;this.el=$(id);this.canvas=this.el.querySelector('canvas');this.tip=this.el.querySelector('.plot-tooltip');this.c=this.canvas.getContext('2d');this.kind=kind;this.series=[];this.view=null;this.lockedId=null;this.labelHit=[];this.key='';this.renderStats={backgrounds:0,overlays:0};
  this.baseCanvas=document.createElement('canvas');this.baseCanvas.className='plot-background';this.baseCanvas.setAttribute('aria-hidden','true');this.el.prepend(this.baseCanvas);this.base=this.baseCanvas.getContext('2d');this.canvas.classList.add('plot-overlay');
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.el);
  this.canvas.addEventListener('pointermove',e=>{this.pendingPointer={clientX:e.clientX,clientY:e.clientY};if(!this.pointerFrame)this.pointerFrame=requestAnimationFrame(()=>{this.pointerFrame=0;this.move(this.pendingPointer);});});
  this.canvas.addEventListener('pointerleave',()=>{if(!this.down){cancelAnimationFrame(this.pointerFrame);this.pointerFrame=0;this.tip.hidden=true;setHover(this.kind,null,null,'plot',this.pane?.name);}});
  this.canvas.addEventListener('pointerdown',e=>{const p=this.pos(e),label=this.hitLabel(p);if(e.button===0&&(this.inside(p)||label)){this.down=p;this.downLabel=label;this.canvas.setPointerCapture(e.pointerId);}});
  this.canvas.addEventListener('pointerup',e=>this.up(e));
  this.canvas.addEventListener('pointercancel',()=>{this.down=null;this.drag=null;schedule();});
  this.canvas.addEventListener('dblclick',()=>{this.view=null;this.down=null;this.tip.hidden=true;this.updateViewNote();this.draw();saveSoon();});
  this.el.closest('.plot-column')?.addEventListener('click',e=>{const button=e.target.closest('[data-lock-series]');if(button)this.lock(button.dataset.lockSeries);});
 }
 lock(id){this.lockedId=this.lockedId===id?null:id;this.el.closest('.plot-column')?.querySelectorAll('[data-lock-series]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.lockSeries===this.lockedId)));this.tip.hidden=true;schedule();saveSoon();}
 set(series,key){
  this.el.dataset.seriesCount=series.length;this.canvas.setAttribute('aria-label',`${this.kind==='industry'?'全部行业':this.pane.name+'全部成分股'}，按日期显示基准数值；点击名称或图例锁定查值`);
  if(this.key!==key){this.view=null;this.key=key;}this.series=series;if(!series.some(s=>s.id===this.lockedId))this.lockedId=null;this.dataRevision=(this.dataRevision||0)+1;this.domainCache=null;this.pathCache=null;this.backgroundKey=null;this.resize();this.updateViewNote();
 }
 resize(){
  const r=this.el.getBoundingClientRect();if(!r.width||!r.height)return;const d=Math.min(devicePixelRatio||1,2),w=Math.max(120,r.width),h=Math.max(100,r.height);
  if(this.w!==w||this.h!==h||this.dpr!==d){this.w=w;this.h=h;this.dpr=d;for(const canvas of [this.canvas,this.baseCanvas]){canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);canvas.style.width=w+'px';canvas.style.height=h+'px';canvas.getContext('2d').setTransform(d,0,0,d,0,0);}this.backgroundKey=null;}
  this.draw();
 }
 pos(e){const r=this.canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
 inside(p){return p.x>=this.left&&p.x<=this.right&&p.y>=this.top&&p.y<=this.bottom;}
 indexAt(x){return Math.max(this.a,Math.min(this.b,Math.round(this.a+(x-this.left)/(this.right-this.left)*Math.max(1,this.b-this.a))));}
 updateViewNote(){const target=this.kind==='industry'?$('marketViewport'):this.pane.part('viewNote');if(!state.market)return;target.textContent=this.view?`${state.market.dates[this.view[0]]}—${state.market.dates[this.view[1]]} · 双击还原`:'';}

 metric(){return this.kind==='industry'?state.metric:state.stockMetric;}
 draw(){
  if(!this.w||!state.market)return;const c=this.c;c.clearRect(0,0,this.w,this.h);if(!this.series.length){this.base.clearRect(0,0,this.w,this.h);return;}this.renderStats.overlays++;this.el.closest('.plot-column')?.querySelectorAll('[data-lock-series]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.lockSeries===this.lockedId)));
  this.left=this.w<520?55:65;this.right=this.w-(this.w<520?96:132);this.top=31;this.bottom=this.h-39;
  const view=this.view;this.a=view?.[0]??0;this.b=view?.[1]??state.market.dates.length-1;
  const end=Math.min(this.b,state.cursor),metric=this.metric(),logScale=state.scale==='log'&&metric==='path',transform=v=>logScale?Math.log1p(v/100):v;
  const domainKey=JSON.stringify([this.dataRevision,end,this.a,this.b,logScale,state.domainRevision,metric]);
  if(this.domainCache?.key!==domainKey){let lo=0,hi=0,found=false;for(const s of this.series)for(let i=this.a;i<=end;i++){const v=s.values[i];if(!finite(v))continue;const t=transform(v);if(!finite(t))continue;lo=Math.min(lo,t);hi=Math.max(hi,t);found=true;}this.domainCache={key:domainKey,hasData:found,domain:extent(found?[lo,hi]:[])};}
  if(!this.domainCache.hasData){this.base.clearRect(0,0,this.w,this.h);this.backgroundKey=null;c.font='12px "Microsoft YaHei"';c.fillStyle=atlasColor('#91aac4');c.textAlign='center';c.fillText('此视窗在观察日之前没有有效数据',this.w/2,this.h/2);return;}
  const [lo,hi]=(this.kind==='stock'&&!this.view?sharedStockDomain(logScale):null)||this.domainCache.domain;this.lo=lo;this.hi=hi;this.el.dataset.yDomain=JSON.stringify([lo,hi]);
  this.X=i=>this.left+(i-this.a)/Math.max(1,this.b-this.a)*(this.right-this.left);this.Y=v=>this.bottom-(transform(v)-lo)/(hi-lo)*(this.bottom-this.top);
  const pathKey=JSON.stringify([this.dataRevision,this.a,this.b,end,lo,hi,this.w,this.h,logScale]);
  if(this.pathCache?.key!==pathKey){
   const paths=new Map(),ends=new Map();let pointCount=0;const budget=Math.max(1,(this.right-this.left)*(end-this.a+1)/Math.max(1,this.b-this.a+1));
   for(const s of this.series){const path=new Path2D();let open=false,last=null;for(const i of samplePathIndices(s.values,this.a,end,budget)){if(i===null){open=false;continue;}const v=s.values[i],x=this.X(i),y=this.Y(v);if(open)path.lineTo(x,y);else path.moveTo(x,y);open=true;last={x,y,index:i,value:v};pointCount++;}paths.set(s.id,path);if(last)ends.set(s.id,last);}
   this.pathCache={key:pathKey,paths,ends};this.el.dataset.renderedPoints=pointCount;
  }
  this.ends=this.pathCache.ends;const hover=hoveredId(this.kind,this.pane?.name),pins=pinSet(this.kind,this.pane?.name),hasFocus=!!hover||pins.size>0||!!this.lockedId;
  const backgroundKey=JSON.stringify([pathKey,hasFocus,metric,state.market.window,state.stockBenchmark]);
  if(this.backgroundKey!==backgroundKey){
   this.backgroundKey=backgroundKey;this.renderStats.backgrounds++;const bg=this.base;bg.clearRect(0,0,this.w,this.h);bg.font='10px "Microsoft YaHei",sans-serif';bg.textBaseline='middle';bg.lineWidth=1;
   const ts=logScale?[-99.9,-99,-95,-90,-80,-60,-40,-20,0,20,50,100,200,500,1000,2000,5000,10000].filter(v=>transform(v)>=lo&&transform(v)<=hi):ticks(lo,hi);
   bg.textAlign='right';for(const v of ts){const y=this.Y(v);bg.strokeStyle=v===0?atlasColor('#8197b0'):atlasColor('#2c3e51');bg.setLineDash(v===0?[]:[2,5]);bg.beginPath();bg.moveTo(this.left,y);bg.lineTo(this.right,y);bg.stroke();bg.fillStyle=atlasColor('#8ba1b8');bg.fillText(fmt(v,Math.abs(v%1)>.01?1:0),this.left-9,y);}
   bg.setLineDash([]);bg.textAlign='left';bg.fillStyle=atlasColor('#a8bdd4');bg.fillText(metricAxisTitle(metric,this.kind)+(logScale?' · 对数间距':''),this.left,13);
   const nt=this.w<560?3:5;for(let k=0;k<nt;k++){const i=Math.round(this.a+k/(nt-1)*(this.b-this.a));bg.textAlign=k===0?'left':k===nt-1?'right':'center';bg.fillText(state.market.dates[i].slice(2),this.X(i),this.bottom+21);}
   bg.save();bg.beginPath();bg.rect(this.left,this.top,this.right-this.left,this.bottom-this.top);bg.clip();bg.globalAlpha=hasFocus?.22:.63;bg.lineWidth=1;
   for(const s of this.series){if(s.reference)continue;bg.strokeStyle=s.color;bg.setLineDash(s.dashed?[5,4]:[]);bg.stroke(this.pathCache.paths.get(s.id));}bg.restore();
  }
  c.save();c.beginPath();c.rect(this.left,this.top,this.right-this.left,this.bottom-this.top);c.clip();
  for(const s of this.series){const active=s.id===hover||pins.has(s.id)||s.id===this.lockedId;if(!s.reference&&!active)continue;c.strokeStyle=s.color;c.lineWidth=active?2.8:2.2;c.setLineDash(s.dashed?[5,4]:[]);c.stroke(this.pathCache.paths.get(s.id));}
  c.setLineDash([]);const date=state.hoverDate;if(date!==null&&date>=this.a&&date<=end){const x=this.X(date);c.strokeStyle=atlasColor('#abc6e77d');c.lineWidth=1;c.beginPath();c.moveTo(x,this.top);c.lineTo(x,this.bottom);c.stroke();for(const s of this.series)if(s.reference||s.id===hover||s.id===this.lockedId){const v=s.values[date];if(finite(v)){c.fillStyle=s.color;c.beginPath();c.arc(x,this.Y(v),3,0,Math.PI*2);c.fill();}}}
  if(this.down&&this.drag){const x=Math.min(this.down.x,this.drag.x);c.fillStyle=atlasColor('#9ab5df23');c.fillRect(x,this.top,Math.abs(this.down.x-this.drag.x),this.bottom-this.top);c.strokeStyle=atlasColor('#9eb8da');c.strokeRect(x,this.top,Math.abs(this.down.x-this.drag.x),this.bottom-this.top);}c.restore();
  this.drawLabels(hover,pins,end);
 }
 drawLabels(hover,pins,end){
  const c=this.c,ends=this.ends,candidates=[],add=id=>{const s=this.series.find(s=>s.id===id);if(s&&ends.has(id)&&!candidates.includes(s))candidates.push(s);};
  this.series.filter(s=>s.reference).forEach(s=>add(s.id));if(this.lockedId)add(this.lockedId);if(hover)add(hover);[...pins].reverse().forEach(add);
  if(state.labelPolicy==='extremes'){const ranked=this.series.filter(s=>!s.reference&&ends.get(s.id)?.index===end).sort((a,b)=>ends.get(b.id).value-ends.get(a.id).value);[...ranked.slice(0,2),...ranked.slice(-2)].forEach(s=>add(s.id));}
  const labels=candidates.slice(0,Math.max(4,Math.floor((this.bottom-this.top)/19))).map(s=>({s,...ends.get(s.id)})).sort((a,b)=>a.y-b.y);
  for(let k=0;k<labels.length;k++)labels[k].labelY=Math.max(this.top+8,labels[k].y,k?labels[k-1].labelY+18:this.top+8);
  if(labels.length&&labels.at(-1).labelY>this.bottom-6){const shift=labels.at(-1).labelY-(this.bottom-6);for(const l of labels)l.labelY-=shift;for(let k=labels.length-2;k>=0;k--)labels[k].labelY=Math.min(labels[k].labelY,labels[k+1].labelY-18);}
  c.font='11px "Microsoft YaHei",sans-serif';c.textBaseline='middle';c.textAlign='left';this.labelHit=[];const rail=Math.min(this.right,this.X(end));
  for(const l of labels){const {x,y,labelY,s}=l;c.strokeStyle=s.color;c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(rail+8,labelY);c.lineTo(rail+13,labelY);c.stroke();c.fillStyle=hover===s.id||s.id===this.lockedId||pins.has(s.id)?atlasColor('#f1f5fa'):atlasColor('#b2c3d6');const text=(s.short||s.name)+(l.index<end?' ·旧':'');c.fillText(text,rail+17,labelY);this.labelHit.push({id:s.id,reference:s.reference,x:rail+12,y:labelY,width:c.measureText(text).width+12});}
  this.labelIds=labels.map(l=>l.s.id);
 }
 nearest(index,y){let best=null,distance=12;for(const s of this.series){const v=s.values[index];if(!finite(v))continue;const d=Math.abs(this.Y(v)-y)-(pinSet(this.kind,this.pane?.name).has(s.id)?.7:0);if(d<distance){distance=d;best=s;}}return best;}
 hitLabel(p){return this.labelHit.find(l=>p.x>=l.x&&p.x<=l.x+l.width&&Math.abs(p.y-l.y)<9);}
 move(e){
  if(!this.X)return;const p=this.pos(e);if(this.down){this.drag={x:Math.max(this.left,Math.min(this.right,p.x)),y:p.y};this.tip.hidden=true;schedule();return;}
  const label=this.hitLabel(p),index=this.indexAt(Math.max(this.left,Math.min(this.right,p.x))),visible=this.inside(p)&&index<=state.cursor;
  const nearest=label?this.series.find(s=>s.id===label.id):visible?this.nearest(index,p.y):null;
  const locked=this.series.find(s=>s.id===this.lockedId),selected=locked||nearest,obs=label?this.ends.get(nearest?.id)?.index:index;
  setHover(this.kind,selected&&!selected.reference?selected.id:null,visible?index:null,'plot',this.pane?.name);this.canvas.style.cursor=nearest?'pointer':'crosshair';
  if((!visible&&!label)||obs===undefined){this.tip.hidden=true;return;}
  const rows=this.series.filter(s=>s.reference);if(selected&&!rows.includes(selected))rows.push(selected);
  if(!selected)for(const id of [...pinSet(this.kind,this.pane?.name)].slice(-3)){const s=this.series.find(s=>s.id===id);if(s)rows.push(s);}
  this.tip.innerHTML=`<b>${state.market.dates[obs]}</b><div class="tip-note">${esc(metricAxisTitle(this.metric(),this.kind))}</div>`+rows.map(s=>`<div class="tip-row"><span>${esc(s.short||s.name)}${s.id===this.lockedId?' · 锁定':''}</span><strong>${metricValue(s.values[obs],this.metric(),2)}</strong></div>`).join('');
  if(this.kind==='stock'&&selected&&!selected.reference){const stock=this.pane.history.stocks.find(s=>s.code===selected.id),v=excessValue(stock?.tracks.momentum[obs],sector(this.pane.name).series.momentum[obs]);this.tip.innerHTML+=`<div class="tip-row"><span>${windowPeriod()}领先行业</span><strong>${metricValue(v,'relative',2)}</strong></div>`;}
  if(this.kind==='industry'&&selected&&!selected.reference)this.tip.innerHTML+=industrySampleHTML(selected.id,obs,this.metric());
  this.tip.innerHTML+='<div class="tip-note">移动查看日期 · 点击图例或名称锁定查值</div>';this.tip.hidden=false;const rect=this.tip.getBoundingClientRect();this.tip.style.left=Math.max(5,Math.min(this.w-rect.width-5,p.x+14))+'px';this.tip.style.top=Math.max(8,Math.min(this.h-rect.height-5,p.y+14))+'px';
 }
 up(e){
  if(!this.down)return;const from=this.down,to=this.pos(e),label=this.downLabel;this.down=null;this.downLabel=null;this.drag=null;const a=this.indexAt(from.x),b=this.indexAt(Math.max(this.left,Math.min(this.right,to.x)));
  if(label&&Math.hypot(from.x-to.x,from.y-to.y)<12){if(label.reference)this.lock(label.id);else togglePin(this.kind,label.id,this.pane?.name);return;}
  if(Math.abs(from.x-to.x)>12&&a!==b){this.view=[Math.min(a,b),Math.max(a,b)];this.updateViewNote();this.tip.hidden=true;this.draw();saveSoon();}
  else if(b<=state.cursor){const s=this.nearest(b,to.y);if(s){if(s.reference)this.lock(s.id);else togglePin(this.kind,s.id,this.pane?.name);}}schedule();
 }
 dispose(){cancelAnimationFrame(this.pointerFrame);this.resizeObserver.disconnect();this.series=[];this.el.replaceChildren();}
}
