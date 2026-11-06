'use strict';

class StockHeat {
 constructor(pane){this.pane=pane;this.el=pane.part('heat');this.scroll=this.el.querySelector('.stock-heat-scroll');this.body=this.el.querySelector('.stock-heat-body');this.canvas=this.el.querySelector('canvas');this.c=this.canvas.getContext('2d');this.tip=this.el.querySelector('.plot-tooltip');this.rowHeight=32;this.header=27;this.rows=[];
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this.scroll);this.scroll.addEventListener('scroll',()=>{this.tip.hidden=true;this.draw();});
  this.canvas.addEventListener('pointermove',e=>this.move(e));this.canvas.addEventListener('pointerleave',()=>{this.tip.hidden=true;setHover('stock',null,null,'plot',pane.name);});this.canvas.addEventListener('dblclick',e=>{const cell=this.cell(e);if(cell)stockDetail.open(cell.stock.code);});this.canvas.addEventListener('click',e=>{const cell=this.cell(e);if(cell)togglePin('stock',cell.stock.code,pane.name);});
 }
 resize(){if(this.el.hidden)return;const r=this.scroll.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);if(!r.width)return;this.w=this.scroll.clientWidth;this.h=this.scroll.clientHeight;if(this.canvas.width!==Math.round(this.w*d)||this.canvas.height!==Math.round(this.h*d)){this.canvas.width=Math.round(this.w*d);this.canvas.height=Math.round(this.h*d);this.canvas.style.height=this.h+'px';this.c.setTransform(d,0,0,d,0,0);this.drawKey=null;}this.draw();}
 set(){
  if(!this.pane.history)return;const base=this.pane.benchmark().momentum;this.rows=this.pane.history.stocks.map(stock=>({stock,values:excessTrack(stock.tracks.momentum,base)}));this.sortedStocks=null;this.sort();this.scroll.scrollTop=0;this.body.style.height=(this.rows.length*this.rowHeight+this.header)+'px';this.drawKey=null;this.resize();
 }
 sort(){
  if(!this.pane.history)return;const ordered=this.pane.orderedStocks();if(this.sortedStocks===ordered)return;const rows=new Map(this.rows.map(row=>[row.stock.code,row]));this.rows=ordered.map(stock=>rows.get(stock.code)).filter(Boolean);this.sortedStocks=ordered;this.drawKey=null;this.tip.hidden=true;
 }
 draw(){
  if(this.el.hidden||!this.w||!this.pane.history||state.stockView!=='heat')return;
  this.sort();
  const [a,b]=[0,state.market.dates.length-1],end=Math.min(b,state.cursor),range=visibleHeatRows(this.rows.length,this.h,this.scroll.scrollTop,this.rowHeight,this.header),offset=range.first,hover=hoveredId('stock',this.pane.name),pins=stockPins(this.pane.name),key=JSON.stringify([a,b,end,range.top,hover,[...pins],state.hoverDate,this.w,this.h,state.stockBenchmark]);if(this.drawKey===key)return;this.drawKey=key;
  const c=this.c,left=this.w<500?98:125,right=this.w-8,cols=b-a+1,cw=(right-left)/cols,limit=strengthColorLimit(state.market.window);c.clearRect(0,0,this.w,this.h);c.fillStyle=atlasColor('#141f2d');c.fillRect(0,0,this.w,this.h);c.font='10px "Microsoft YaHei"';c.textBaseline='middle';this.geometry={left,right,a,b,offset,cw};
  this.geometry.scrollTop=range.top;this.geometry.last=range.last;c.save();c.beginPath();c.rect(0,this.header,this.w,this.h-this.header);c.clip();
  for(let index=offset;index<=range.last;index++){const row=this.rows[index];if(!row)break;const y=this.header+index*this.rowHeight-range.top,active=pins.has(row.stock.code)||hover===row.stock.code;c.fillStyle=active?atlasColor('#c9dfff'):atlasColor('#9eb2c8');c.textAlign='left';c.font='11px "Microsoft YaHei"';c.fillText(row.stock.name,7,y+11,left-12);c.fillStyle=atlasColor('#7894b0');c.font='9px "Microsoft YaHei"';c.fillText(row.stock.code,7,y+25,left-12);
   for(let i=a;i<=end;i++){const v=row.values[i],t=finite(v)?Math.max(-1,Math.min(1,v/limit)):null;c.fillStyle=t===null?atlasColor('#2b3440'):t>=0?`rgba(222,151,125,${.12+Math.abs(t)*.88})`:`rgba(91,183,172,${.12+Math.abs(t)*.88})`;c.fillRect(left+(i-a)*cw,y,Math.max(.5,cw),this.rowHeight-2);}
   if(active){c.strokeStyle=atlasColor('#c9dfff');c.lineWidth=1;c.strokeRect(1,y,this.w-2,this.rowHeight-2);}
  }
  c.restore();c.font='10px "Microsoft YaHei"';c.fillStyle=atlasColor('#a6bdd7');for(let k=0;k<3;k++){const i=Math.round(a+k/2*(b-a));c.textAlign=k===0?'left':k===2?'right':'center';c.fillText(state.market.dates[i],left+(i-a)/Math.max(1,b-a)*(right-left),12);}c.textAlign='left';c.fillText('强 → 弱 / 日期',7,12);
  if(state.hoverDate!==null&&state.hoverDate>=a&&state.hoverDate<=end){c.strokeStyle=atlasColor('#d3e4f6');c.beginPath();const x=left+(state.hoverDate-a+.5)*cw;c.moveTo(x,this.header);c.lineTo(x,this.h);c.stroke();}
  this.el.dataset.renderedRows=Math.max(0,range.last-offset+1);this.el.dataset.totalRows=this.rows.length;this.pane.part('heatRange').textContent=this.rows.length?`${offset+1}–${range.last+1} / ${this.rows.length}只`: '暂无股票';this.canvas.setAttribute('aria-label',`个股${windowPeriod()}领先${state.stockBenchmark==='sector'?'本行业':'股票池'}的时间图，单位百分点；共${this.rows.length}只，滚动查看全部股票。`);
 }
 cell(e){if(!this.geometry)return null;const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,g=this.geometry,row=this.rows[Math.floor((y-this.header+g.scrollTop)/this.rowHeight)],i=x<g.left?state.cursor:g.a+Math.floor((x-g.left)/g.cw);return y>=this.header&&y<this.h&&row&&i>=g.a&&i<=g.b&&i<=state.cursor?{...row,i,x,y}:null;}
 locate(query){const text=query.trim().toLowerCase();if(!text||this.el.hidden)return;const index=this.rows.findIndex(r=>r.stock.name.toLowerCase().includes(text)||r.stock.code.toLowerCase().includes(text));if(index>=0){this.scroll.scrollTop=index*this.rowHeight;this.draw();}}
 move(e){const cell=this.cell(e);if(!cell){this.tip.hidden=true;return;}setHover('stock',cell.stock.code,cell.i,'plot',this.pane.name);this.tip.innerHTML=`<b>${esc(cell.stock.name)} · ${state.market.dates[cell.i]}</b><div class="tip-row"><span>${windowPeriod()}领先${state.stockBenchmark==='sector'?'本行业':'股票池'}</span><strong>${metricValue(cell.values[cell.i],'relative',2)}</strong></div><div class="tip-note">0为持平 · 单击固定关注</div>`;this.tip.hidden=false;this.tip.style.left=Math.max(5,Math.min(this.w-280,cell.x+12))+'px';this.tip.style.top=Math.max(35,Math.min(this.h-85,cell.y+12))+'px';}
 dispose(){this.observer.disconnect();}
}
