'use strict';

class StockDetail {
 constructor(){
  this.el=document.createElement('dialog');this.el.id='stockDetail';this.el.className='stock-detail';this.code=null;this.data=null;this.seq=0;this.cache=new Map();this.view=null;this.preferredMode='candle';
  this.el.innerHTML=`<header><div><h2 data-detail="title">个股量价</h2><span data-detail="quote"></span></div><div class="detail-actions"><select data-detail="mode" aria-label="价格图形式"><option value="candle">日K线</option><option value="line">收盘价线</option></select><select data-detail="activity" aria-label="量能指标"><option value="volume">成交量</option><option value="amount">成交额</option></select><button data-detail="close" aria-label="关闭量价图">×</button></div></header><div class="detail-message" data-detail="message"></div><div class="detail-legend"><span style="color:#c1c9d6">MA5</span><span style="color:#d8b687">MA10</span><span style="color:#b59bd0">MA20</span><span data-detail="range"></span></div><div class="detail-plot"><canvas aria-label="个股日线价格与成交量，共用日期"></canvas><div class="plot-tooltip" hidden></div></div>`;
  atlasRoot.append(this.el);this.canvas=this.el.querySelector('canvas');this.c=this.canvas.getContext('2d');this.tip=this.el.querySelector('.plot-tooltip');this.plot=this.el.querySelector('.detail-plot');
  this.part('close').addEventListener('click',()=>this.el.close());this.el.addEventListener('close',()=>{this.seq++;this.tip.hidden=true;});
  this.part('mode').addEventListener('change',()=>{this.preferredMode=this.part('mode').value;this.draw();});this.part('activity').addEventListener('change',()=>this.draw());
  new ResizeObserver(()=>this.resize()).observe(this.plot);
  this.canvas.addEventListener('pointermove',e=>{this.pointer={clientX:e.clientX,clientY:e.clientY};if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.move(this.pointer);});});
  this.canvas.addEventListener('pointerleave',()=>{if(!this.down){cancelAnimationFrame(this.frame);this.frame=0;this.hover=null;this.tip.hidden=true;this.draw();}});
  this.canvas.addEventListener('pointerdown',e=>{const p=this.pos(e);if(!e.button&&this.X&&p.x>=this.left&&p.x<=this.right){this.down=this.indexAt(p.x);this.drag=null;this.canvas.setPointerCapture(e.pointerId);}});
  this.canvas.addEventListener('pointerup',e=>{if(this.down===null||this.down===undefined)return;const b=this.indexAt(this.pos(e).x),a=this.down;this.down=null;this.drag=null;if(Math.abs(a-b)>=2)this.view=[Math.min(a,b),Math.max(a,b)];this.hover=null;this.tip.hidden=true;this.draw();});
  this.canvas.addEventListener('pointercancel',()=>{this.down=null;this.drag=null;this.draw();});
  this.canvas.addEventListener('dblclick',()=>{this.view=null;this.hover=null;this.tip.hidden=true;this.draw();});
 }
 part(name){return this.el.querySelector(`[data-detail="${name}"]`);}
 async open(code){
  if(!state.market)return;stopReplay();this.code=code;this.view=null;this.hover=null;this.data=null;this.canvas.getContext('2d').clearRect(0,0,this.canvas.width,this.canvas.height);this.tip.hidden=true;
  this.part('title').textContent=(state.meta.stocks.find(s=>s.code===code)?.name||code)+' · '+code;this.part('quote').textContent='';this.part('message').hidden=false;this.part('message').textContent='读取日线量价…';if(!this.el.open)this.el.showModal();await this.load();
 }
 async load(){
  if(!state.market||!this.el.open)return;const key=JSON.stringify([state.meta.source,query(),this.code]),token=++this.seq;this.key=key;
  try{
   let pending=this.cache.get(key);if(!pending){pending=api('/api/stock',{...query(),code:this.code});this.cache.set(key,pending);if(this.cache.size>20)this.cache.delete(this.cache.keys().next().value);}
   const data=await pending;if(token!==this.seq||!this.el.open)return;this.data=data;
   const candles=data.close.some((v,i)=>[v,data.open?.[i],data.high?.[i],data.low?.[i]].every(finite));this.part('mode').querySelector('[value="candle"]').disabled=!candles;this.part('mode').value=candles?this.preferredMode:'line';
   const volume=data.volume?.some(finite);this.part('activity').querySelector('[value="volume"]').disabled=!volume;if(!volume)this.part('activity').value='amount';
   this.part('message').textContent=!candles?'未提供有效开高低价，显示真实收盘价线。':!volume?'未提供成交量，量能区显示成交额。':'';this.part('message').hidden=!this.part('message').textContent;
   this.resize();
  }catch(error){if(token===this.seq){this.cache.delete(key);this.part('message').hidden=false;this.part('message').textContent='量价读取失败：'+error.message;}}
 }
 sync(){if(!this.el.open||!state.market)return;const key=JSON.stringify([state.meta.source,query(),this.code]);if(key!==this.key){this.view=null;this.data=null;this.load();}else this.draw();}
 resize(){if(!this.el.open)return;const r=this.plot.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);if(!r.width||!r.height)return;this.w=r.width;this.h=r.height;if(this.canvas.width!==Math.round(this.w*d)||this.canvas.height!==Math.round(this.h*d)){this.canvas.width=Math.round(this.w*d);this.canvas.height=Math.round(this.h*d);this.c.setTransform(d,0,0,d,0,0);}this.draw();}
 pos(e){const r=this.canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
 indexAt(x){return Math.max(this.a,Math.min(this.b,Math.round(this.a+(x-this.left)/(this.right-this.left)*Math.max(1,this.b-this.a))));}
 draw(){
  if(!this.el.open||!this.data||!this.w)return;const c=this.c,d=this.data;c.clearRect(0,0,this.w,this.h);const asof=d.dates.indexOf(state.market.dates[state.cursor]);if(asof<0)return;
  this.a=Math.min(this.view?.[0]??0,asof);this.b=Math.min(this.view?.[1]??asof,asof);const a=this.a,b=this.b;this.left=this.w<600?57:68;this.right=this.w-22;this.top=25;this.priceBottom=Math.round(this.h*.67);this.volumeTop=this.priceBottom+34;this.volumeBottom=this.h-32;
  this.X=i=>this.left+(i-a+.5)/Math.max(1,b-a+1)*(this.right-this.left);const price=[];for(let i=a;i<=b;i++)for(const key of ['close','open','high','low','ma5','ma10','ma20'])if(finite(d[key]?.[i]))price.push(d[key][i]);let lo=Math.min(...price),hi=Math.max(...price);if(!price.length){c.fillStyle=atlasColor('#91aac4');c.fillText('当前日期范围没有有效价格',this.left,40);return;}const pad=Math.max((hi-lo)*.08,hi*.005);lo=Math.max(0,lo-pad);hi+=pad;const Y=v=>this.priceBottom-(v-lo)/(hi-lo)*(this.priceBottom-this.top);
  c.font='10px "Microsoft YaHei",sans-serif';c.textBaseline='middle';c.textAlign='right';c.lineWidth=1;c.setLineDash([]);
  for(const v of ticks(lo,hi)){const y=Y(v);c.strokeStyle=atlasColor('#2c3e51');c.beginPath();c.moveTo(this.left,y);c.lineTo(this.right,y);c.stroke();c.fillStyle=atlasColor('#91a9c2');c.fillText(fmt(v,2),this.left-8,y);}
  const line=(values,color,width=1.1)=>{c.strokeStyle=color;c.lineWidth=width;c.beginPath();let open=false;for(let i=a;i<=b;i++){const v=values?.[i];if(!finite(v)){open=false;continue;}if(open)c.lineTo(this.X(i),Y(v));else c.moveTo(this.X(i),Y(v));open=true;}c.stroke();};
  c.save();c.beginPath();c.rect(this.left,this.top,this.right-this.left,this.priceBottom-this.top);c.clip();const cw=Math.max(1,Math.min(10,(this.right-this.left)/(b-a+1)*.65));let candleCount=0;
  if(this.part('mode').value==='candle')for(let i=a;i<=b;i++){const close=d.close[i],open=d.open?.[i],high=d.high?.[i],low=d.low?.[i];if(![close,open,high,low].every(finite)){if(finite(close)){c.fillStyle=atlasColor('#9cafc3');c.fillRect(this.X(i)-1,Y(close)-1,2,2);}continue;}candleCount++;c.strokeStyle=c.fillStyle=close>=open?atlasColor('#e9a391'):atlasColor('#76c8bb');c.lineWidth=1;c.beginPath();c.moveTo(this.X(i),Y(high));c.lineTo(this.X(i),Y(low));c.stroke();c.fillRect(this.X(i)-cw/2,Math.min(Y(open),Y(close)),cw,Math.max(1,Math.abs(Y(open)-Y(close))));}
  else line(d.close,atlasColor('#a9c8ee'),1.7);
  line(d.ma5,atlasColor('#c1c9d6'));line(d.ma10,atlasColor('#d8b687'));line(d.ma20,atlasColor('#b59bd0'));c.restore();
  const activity=this.part('activity').value,values=d[activity]||[],unit=activity==='volume'?'万股':'亿元',max=Math.max(0,...values.slice(a,b+1).filter(finite)),vmax=max||1,V=v=>this.volumeBottom-v/vmax*(this.volumeBottom-this.volumeTop);
  for(let i=a;i<=b;i++){const v=values[i];if(!finite(v))continue;c.fillStyle=finite(d.daily[i])?(d.daily[i]>=0?atlasColor('#e9a391a0'):atlasColor('#76c8bba0')):atlasColor('#8299b0');c.fillRect(this.X(i)-cw/2,V(v),cw,Math.max(1,this.volumeBottom-V(v)));}
  c.fillStyle=atlasColor('#91a9c2');c.textAlign='right';c.fillText(fmt(vmax,1),this.left-8,this.volumeTop+4);c.fillText('0',this.left-8,this.volumeBottom);c.textAlign='left';c.fillText('价格（元）',this.left,10);c.fillText((activity==='volume'?'成交量':'成交额')+'（'+unit+'）',this.left,this.volumeTop-15);
  const nt=this.w<600?3:5;for(let k=0;k<nt;k++){const i=Math.round(a+k/(nt-1)*(b-a));c.textAlign=k===0?'left':k===nt-1?'right':'center';c.fillText(d.dates[i],this.X(i),this.h-12);}
  const i=this.hover!==null&&this.hover!==undefined?Math.min(b,Math.max(a,this.hover)):asof;if(this.hover!==null&&this.hover!==undefined){c.strokeStyle=atlasColor('#aec5df88');c.beginPath();c.moveTo(this.X(i),this.top);c.lineTo(this.X(i),this.volumeBottom);c.stroke();}
  if(this.down!==null&&this.down!==undefined&&this.drag!==null){c.fillStyle=atlasColor('#abc8ed26');const x=Math.min(this.X(this.down),this.X(this.drag));c.fillRect(x,this.top,Math.abs(this.X(this.down)-this.X(this.drag)),this.volumeBottom-this.top);}
  this.part('quote').textContent=`${d.dates[i]}　收 ${fmt(d.close[i],3)}元　当日 ${metricValue(d.daily[i],'momentum',2)}　量 ${fmt(d.volume?.[i],2)}万股　额 ${fmt(d.amount[i],2)}亿元`;
  this.part('range').textContent=`${d.dates[a]}—${d.dates[b]}`;this.el.dataset.candles=candleCount;this.el.dataset.asof=d.dates[asof];this.el.dataset.visibleEnd=b;this.canvas.setAttribute('aria-label',`${d.name} ${this.part('mode').value==='candle'?'日K线':'收盘价线'}和${activity==='volume'?'成交量':'成交额'}，截至${d.dates[asof]}，共用交易日期`);
 }
 move(e){
  if(!this.data||!this.X)return;const p=this.pos(e);if(p.x<this.left||p.x>this.right){this.tip.hidden=true;return;}const i=this.indexAt(p.x);if(this.down!==null&&this.down!==undefined){this.drag=i;this.tip.hidden=true;this.draw();return;}this.hover=i;this.draw();const d=this.data;
  this.tip.innerHTML=`<b>${esc(d.name)} · ${d.dates[i]}</b>`+[['开盘',d.open?.[i],'元'],['最高',d.high?.[i],'元'],['最低',d.low?.[i],'元'],['收盘',d.close[i],'元'],['当日涨跌',d.daily[i],'%'],['成交量',d.volume?.[i],'万股'],['成交额',d.amount[i],'亿元'],['换手率',d.turnover[i],'%']].map(([name,v,unit])=>`<div class="tip-row"><span>${name}</span><strong>${finite(v)?fmt(v,unit==='元'?3:2)+unit:'—'}</strong></div>`).join('');this.tip.hidden=false;const r=this.tip.getBoundingClientRect();this.tip.style.left=Math.max(4,Math.min(this.w-r.width-4,p.x+12))+'px';this.tip.style.top=Math.max(4,Math.min(this.h-r.height-4,p.y+12))+'px';
 }
}
const stockDetail=new StockDetail();
