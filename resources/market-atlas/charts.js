'use strict';
(function(root){
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=(v,d=2)=>finite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
 function bounds(series){let lo=Infinity,hi=-Infinity;for(const s of series)for(const v of s.values||[])if(finite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v);}if(!finite(lo))return[-1,1];if(lo===hi){const pad=Math.max(Math.abs(lo)*.02,1);lo-=pad;hi+=pad;}const pad=(hi-lo)*.12;return[lo-pad,hi+pad];}
 function ticks(lo,hi,count=4){const raw=(hi-lo)/count,p=10**Math.floor(Math.log10(raw||1)),r=raw/p,step=(r<=1?1:r<=2?2:r<=5?5:10)*p,out=[];for(let v=Math.ceil(lo/step)*step;v<=hi+step*.001;v+=step)out.push(Math.abs(v)<1e-9?0:v);return out;}
 function geometry(width,height){const left=width<400?57:66,right=width-18,top=30,bottom=height-38;return{left,right,top,bottom,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};}
 function path(values,X,Y){let d='',open=false;values.forEach((v,i)=>{if(!finite(v)){open=false;return;}const x=X(i),y=Y(v);if(!finite(y)){open=false;return;}d+=(open?'L':'M')+x.toFixed(2)+','+y.toFixed(2);open=true;});return d;}
 class Chart{
  constructor(host,{dates,series,unit='%',label='',kind='lines',stock=null,log=false,onInspect=()=>{}}){
   this.host=host;Object.assign(this,{dates,series,unit,label,kind,stock,log,onInspect});this.index=dates.length-1;this.axisValue=null;this.locked=false;
   host.innerHTML='<div class="chart-hint"><span>点击查值 · 左右拖动选日期</span><button type="button" class="inspect-lock" aria-pressed="false">锁定查值</button></div><svg class="atlas-chart" tabindex="0" role="img"></svg><div class="chart-readout" aria-live="polite"></div>';
   this.svg=host.querySelector('svg');this.readout=host.querySelector('.chart-readout');this.button=host.querySelector('button');
   this.button.addEventListener('click',()=>{this.locked=!this.locked;this.svg.classList.toggle('inspection-locked',this.locked);this.button.setAttribute('aria-pressed',String(this.locked));this.button.textContent=this.locked?'退出查值':'锁定查值';});
   this.svg.addEventListener('pointerdown',event=>{if(event.button!==0&&event.pointerType==='mouse')return;this.active=true;this.svg.setPointerCapture(event.pointerId);this.inspect(event);});
   this.svg.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'||this.active)this.inspect(event);});
   const finish=()=>{this.active=false;};this.svg.addEventListener('pointerup',finish);this.svg.addEventListener('pointercancel',finish);
   this.svg.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();if(event.key==='ArrowLeft')this.index=Math.max(0,this.index-1);if(event.key==='ArrowRight')this.index=Math.min(this.dates.length-1,this.index+1);if(event.key==='ArrowUp'||event.key==='ArrowDown')this.axisValue=(this.axisValue??this.series[0]?.values[this.index]??0)+(event.key==='ArrowUp'?1:-1)*(this.hi-this.lo)/100;else this.axisValue=null;this.draw();this.onInspect(this.index);});
   this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(host);this.draw();
  }
  destroy(){this.observer.disconnect();}
  inspect(event){
   if(!this.X||!this.Y)return;
   const box=this.svg.getBoundingClientRect(),x=(event.clientX-box.left)*this.w/box.width,y=(event.clientY-box.top)*this.h/box.height,g=this.g;
   this.index=Math.max(0,Math.min(this.dates.length-1,Math.round((x-g.left)/g.width*Math.max(1,this.dates.length-1))));
   const fraction=Math.max(0,Math.min(1,(g.bottom-y)/g.height));this.axisValue=this.inverse(this.lo+fraction*(this.hi-this.lo));
   let distance=Infinity,selected=this.series[0];for(const s of this.series){const v=s.values[this.index];if(finite(v)){const d=Math.abs(this.Y(v)-y);if(d<distance){distance=d;selected=s;}}}this.selected=selected;this.draw();this.onInspect(this.index);
  }
  draw(){
   const width=this.host.getBoundingClientRect().width;if(width<100||!this.dates.length)return;
   this.w=Math.round(width);this.h=this.kind==='candles'?360:300;this.svg.setAttribute('viewBox',`0 0 ${this.w} ${this.h}`);this.svg.setAttribute('aria-label',this.label+'；点击或拖动查值，键盘左右切换日期，上下调整纵轴查值');
   this.g=geometry(this.w,this.h);if(this.kind==='candles')this.g.bottom-=78;const g=this.g;g.height=g.bottom-g.top;
   const transform=v=>this.log?(v>-100?Math.log1p(v/100):NaN):v;this.inverse=v=>this.log?Math.expm1(v)*100:v;
   const expanded=this.kind==='candles'&&this.stock?[...this.series,{values:this.stock.high},{values:this.stock.low}]:this.series;
   const available=this.stock?this.stock.close.some(finite):expanded.some(s=>s.values.some(v=>finite(v)&&finite(transform(v))));
   if(!available){this.X=this.Y=null;this.svg.innerHTML=`<text class="axis-label" x="${this.w/2}" y="${this.h/2}" text-anchor="middle">当前区间缺少有效数据</text>`;this.svg.dataset.axisValue='';this.readout.innerHTML='<p class="chart-empty">此指标需要更多有效历史，缺失数据不会补零。</p>';return;}
   [this.lo,this.hi]=bounds(expanded.map(s=>({values:s.values.map(v=>finite(v)?transform(v):null)})));
   this.X=i=>g.left+(this.dates.length===1?.5:i/(this.dates.length-1))*g.width;this.Y=v=>g.bottom-(transform(v)-this.lo)/(this.hi-this.lo)*g.height;
   let html='';
   for(const value of ticks(this.lo,this.hi)){const y=g.bottom-(value-this.lo)/(this.hi-this.lo)*g.height;html+=`<path class="grid-line" d="M${g.left},${y}H${g.right}"/><text class="axis-label" x="${g.left-10}" y="${y+4}" text-anchor="end">${escape(number(this.inverse(value),Math.abs(this.inverse(value))<10?2:1))}</text>`;}
   html+=`<text class="axis-unit" x="${g.left}" y="14">${escape(this.unit)}</text>`;
   const nt=this.w<500?3:5;for(let k=0;k<nt;k++){const i=Math.round(k/(nt-1)*(this.dates.length-1));html+=`<text class="axis-label" x="${this.X(i)}" y="${this.h-10}" text-anchor="${k===0?'start':k===nt-1?'end':'middle'}">${escape(this.dates[i].slice(2))}</text>`;}
   if(this.kind==='candles'&&this.stock){
    const s=this.stock,cw=Math.max(1,Math.min(11,g.width/this.dates.length*.62)),volume=s.volume.some(finite)?s.volume:s.amount,unit=s.volume.some(finite)?'万股':'亿元',top=g.bottom+20,bottom=this.h-40;let maximum=0;for(const v of volume)if(finite(v))maximum=Math.max(maximum,v);
    html+=`<text class="axis-unit" x="${g.left}" y="${top+9}">${unit==='万股'?'成交量':'成交额'} · ${unit}</text>`;
    this.dates.forEach((_,i)=>{const close=s.close[i],open=s.open[i],high=s.high[i],low=s.low[i],up=finite(open)?close>=open:(s.daily[i]??0)>=0,color=up?'var(--rise)':'var(--fall)';if([close,open,high,low].every(finite))html+=`<path d="M${this.X(i)},${this.Y(high)}V${this.Y(low)}" stroke="${color}"/><rect x="${this.X(i)-cw/2}" y="${Math.min(this.Y(open),this.Y(close))}" width="${cw}" height="${Math.max(1,Math.abs(this.Y(open)-this.Y(close)))}" fill="${color}"/>`;else if(finite(close))html+=`<circle cx="${this.X(i)}" cy="${this.Y(close)}" r="1.5" fill="var(--plot-main)"/>`;if(finite(volume[i])&&maximum>0){const h=volume[i]/maximum*Math.max(1,bottom-top-14);html+=`<rect x="${this.X(i)-cw/2}" y="${bottom-h}" width="${cw}" height="${h}" fill="${color}" opacity=".5"/>`;}});
   }
   for(const s of this.series){if(this.kind==='candles'&&s.id==='price')continue;html+=`<path d="${path(s.values,this.X,this.Y)}" stroke="${s.color||'var(--plot-main)'}" class="data-line" stroke-width="${s.reference?2.5:1.7}" ${s.dash?'stroke-dasharray="5 4"':''}/>`;}
   const index=Math.max(0,Math.min(this.index,this.dates.length-1)),selected=this.selected||this.series[0],value=selected?.values[index],axis=finite(this.axisValue)?this.axisValue:value,x=this.X(index);
   html+=`<path class="crosshair" d="M${x},${g.top}V${this.kind==='candles'?this.h-39:g.bottom}"/>`;
   if(finite(value))html+=`<circle cx="${x}" cy="${this.Y(value)}" r="4" fill="${selected.color||'var(--plot-main)'}" stroke="var(--surface)" stroke-width="2"/>`;
   if(finite(axis)){const y=Math.max(g.top,Math.min(g.bottom,this.Y(axis)));html+=`<path class="crosshair" d="M${g.left},${y}H${g.right}"/><rect class="axis-tag" x="0" y="${y-12}" width="${g.left-5}" height="24" rx="3"/><text class="axis-tag-text" x="${g.left-11}" y="${y+4}" text-anchor="end">${escape(number(axis,2))}</text>`;}
   this.svg.innerHTML=html;this.svg.dataset.date=this.dates[index];this.svg.dataset.axisValue=finite(axis)?String(axis):'';
   if(this.kind==='candles'&&this.stock){const s=this.stock;this.readout.innerHTML=`<div class="inspection-date">${escape(this.dates[index])}<span>纵轴 ${escape(number(axis))} 元</span></div><dl class="ohlc-readout">${[['开',s.open[index]],['高',s.high[index]],['低',s.low[index]],['收',s.close[index]],['涨跌',finite(s.daily[index])?number(s.daily[index])+'%':null],[s.volume.some(finite)?'量（万股）':'额（亿元）',s.volume.some(finite)?s.volume[index]:s.amount[index]]].map(([key,v])=>`<div><dt>${key}</dt><dd>${typeof v==='string'?escape(v):escape(number(v))}</dd></div>`).join('')}</dl>`;}
   else{this.readout.innerHTML=`<div class="inspection-date">${escape(this.dates[index])}<span>纵轴 ${escape(number(axis))}${escape(this.unit)}</span></div><dl class="line-readout">${this.series.filter(s=>s.reference||s===selected).slice(0,3).map(s=>`<div><dt><i style="background:${s.color||'var(--plot-main)'}"></i>${escape(s.name)}</dt><dd>${escape(number(s.values[index]))}${escape(this.unit)}</dd></div>`).join('')}</dl>`;}
  }
 }
 root.AtlasCharts={Chart,geometry,bounds,ticks,escape,number,finite};
 if(typeof module!=='undefined')module.exports={geometry,bounds,ticks,path};
})(globalThis);
