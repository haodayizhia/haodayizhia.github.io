'use strict';

class ContextPlot {
 constructor(id,metrics,unit,domain=null){
  this.el=$(id);this.canvas=this.el.querySelector('canvas');this.c=this.canvas.getContext('2d');this.tip=this.el.querySelector('.plot-tooltip');this.metrics=metrics;this.unit=unit;this.domain=domain;
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this.el);
  this.canvas.addEventListener('pointermove',e=>{if(!state.market||!this.X)return;const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,i=Math.max(0,Math.min(state.cursor,Math.round((x-this.left)/(this.right-this.left)*(state.market.dates.length-1))));setHover('context',null,i,'plot');this.tip.innerHTML=`<b>${state.market.dates[i]}</b>`+this.metrics.map(m=>`<div class="tip-row"><span>${m.name}${m.count?' · 有效'+fmt(state.market.pool[m.count]?.[i],0)+'只':''}</span><strong>${fmt(state.market.pool[m.key][i])}${this.unit}</strong></div>`).join('');this.tip.hidden=false;this.tip.style.left=Math.max(5,Math.min(this.w-260,x+12))+'px';this.tip.style.top=Math.max(10,Math.min(this.h-110,y+10))+'px';});
  this.canvas.addEventListener('pointerleave',()=>{this.tip.hidden=true;setHover('context',null);});
 }
 resize(){const r=this.el.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);this.w=Math.max(200,r.width);this.h=Math.max(150,r.height);if(this.canvas.width!==Math.round(this.w*d))this.canvas.width=Math.round(this.w*d);if(this.canvas.height!==Math.round(this.h*d))this.canvas.height=Math.round(this.h*d);this.canvas.style.width=this.w+'px';this.canvas.style.height=this.h+'px';this.c.setTransform(d,0,0,d,0,0);this.draw();}
 draw(){
  if(!state.market||$('stateSection').hidden)return;const c=this.c;c.clearRect(0,0,this.w,this.h);this.left=53;this.right=this.w-18;this.top=42;this.bottom=this.h-36;const m=state.market,p=m.pool,i=state.cursor,values=this.metrics.flatMap(metric=>p[metric.key].slice(0,i+1)).filter(finite),[lo,hi]=this.domain||extent(values);
  this.X=j=>this.left+j/Math.max(1,m.dates.length-1)*(this.right-this.left);const Y=v=>this.bottom-(v-lo)/(hi-lo)*(this.bottom-this.top);c.font='10px "Microsoft YaHei",sans-serif';c.textBaseline='middle';c.lineWidth=1;
  for(const t of ticks(lo,hi)){const y=Y(t);c.strokeStyle=atlasColor('#2b3b4d');c.beginPath();c.moveTo(this.left,y);c.lineTo(this.right,y);c.stroke();c.fillStyle=atlasColor('#829ab4');c.textAlign='right';c.fillText(fmt(t,Math.abs(t)>=100?0:1),this.left-8,y);}
  for(let k=0;k<3;k++){const j=Math.round(k/2*(m.dates.length-1));c.fillStyle=atlasColor('#829ab4');c.textAlign=k===0?'left':k===2?'right':'center';c.fillText(m.dates[j].slice(2),this.X(j),this.bottom+19);}
  for(const metric of this.metrics){c.strokeStyle=metric.color;c.lineWidth=1.8;c.setLineDash(metric.dash?[4,4]:[]);c.beginPath();let open=false;for(let j=0;j<=i;j++){const v=p[metric.key][j];if(!finite(v)){open=false;continue;}if(open)c.lineTo(this.X(j),Y(v));else c.moveTo(this.X(j),Y(v));open=true;}c.stroke();}
  c.setLineDash([]);c.strokeStyle=atlasColor('#b7cae66e');const j=state.hoverDate??i;c.beginPath();c.moveTo(this.X(j),this.top);c.lineTo(this.X(j),this.bottom);c.stroke();c.fillStyle=atlasColor('#a3b8cf');c.textAlign='left';c.fillText(this.metrics.map(metric=>`${metric.name} ${fmt(p[metric.key][j])}${this.unit}`).join(' · '),this.left,11);
  const metric=this.metrics[0],loN=p.vol_count_min?.[j],hiN=p.vol_count_max?.[j],countNote=metric.key==='vol'&&finite(loN)&&finite(hiN)?`近20日每日收益有效 ${loN===hiN?fmt(loN,0):fmt(loN,0)+'—'+fmt(hiN,0)}只`:`当日${metric.key==='amount'?'成交额':'收益'}有效 ${fmt(p[metric.count]?.[j],0)} / ${m.eligible}只`;
  c.fillStyle=atlasColor('#819ab4');c.fillText(countNote,this.left,27);this.canvas.setAttribute('aria-label',this.metrics.map(metric=>`${metric.name}，${state.market.dates[j]}为${fmt(p[metric.key][j])}${this.unit}`).join('；')+'；'+countNote);
 }
}
class ParticipationPlot extends ContextPlot {
 constructor(id){super(id,[{key:'breadth',name:'站上MA20',count:'breadth_count'},{key:'up',name:'当日上涨',count:'count'},{key:'up_smooth',name:'上涨比例5日均线'}],'%',[0,100]);this.el.dataset.layout='separate-lanes';}
 draw(){
  if(!state.market||$('stateSection').hidden)return;
  const c=this.c,m=state.market,p=m.pool,i=state.cursor,j=state.hoverDate??i;
  c.clearRect(0,0,this.w,this.h);this.left=44;this.right=this.w-17;
  this.X=k=>this.left+k/Math.max(1,m.dates.length-1)*(this.right-this.left);
  const laneH=(this.h-100)/2,first={top:29,bottom:29+laneH},second={top:71+laneH,bottom:71+2*laneH};
  const Y=(value,lane)=>lane.bottom-value/100*(lane.bottom-lane.top);
  c.font='10px "Microsoft YaHei",sans-serif';c.textBaseline='middle';
  for(const lane of [first,second])for(const v of [0,50,100]){const y=Y(v,lane);c.lineWidth=1;c.setLineDash(v===50?[3,4]:[]);c.strokeStyle=v===50?atlasColor('#73879e80'):atlasColor('#304154');c.beginPath();c.moveTo(this.left,y);c.lineTo(this.right,y);c.stroke();c.fillStyle=atlasColor('#809ab5');c.textAlign='right';c.fillText(String(v),this.left-9,y);}
  c.setLineDash([]);
  const line=(values,lane,color,width=1.8)=>{c.strokeStyle=color;c.lineWidth=width;c.beginPath();let open=false;for(let k=0;k<=i;k++){const v=values?.[k];if(!finite(v)){open=false;continue;}if(open)c.lineTo(this.X(k),Y(v,lane));else c.moveTo(this.X(k),Y(v,lane));open=true;}c.stroke();};
  // Separate scales and marks retain daily movement without competing overlaid lines.
  c.fillStyle=atlasColor('#91b5e42b');let segment=[];const fill=()=>{if(!segment.length)return;c.beginPath();c.moveTo(this.X(segment[0]),first.bottom);for(const k of segment)c.lineTo(this.X(k),Y(p.breadth[k],first));c.lineTo(this.X(segment.at(-1)),first.bottom);c.closePath();c.fill();segment=[];};for(let k=0;k<=i;k++){if(finite(p.breadth[k]))segment.push(k);else fill();}fill();line(p.breadth,first,atlasColor('#a3c3ee'),2);
  const cw=(this.right-this.left)/Math.max(1,m.dates.length-1);c.fillStyle=atlasColor('#c4a37658');for(let k=0;k<=i;k++){const v=p.up[k];if(finite(v))c.fillRect(this.X(k)-cw*.36,Y(v,second),Math.max(.5,cw*.72),second.bottom-Y(v,second));}line(p.up_smooth,second,atlasColor('#e0bd85'),2.1);
  c.textAlign='left';c.fillStyle=atlasColor('#b8d1f3');c.fillText('站上MA20 '+fmt(p.breadth[j])+'%',this.left,12);c.textAlign='right';c.fillStyle=atlasColor('#8ca8c5');c.fillText('有效 '+fmt(p.breadth_count?.[j],0)+' / '+m.eligible+'只',this.right,12);
  c.textAlign='left';c.fillStyle=atlasColor('#d9b887');c.fillText('当日上涨 '+fmt(p.up[j])+'%',this.left,second.top-16);c.textAlign='right';c.fillStyle=atlasColor('#c4b08d');c.fillText((this.w<560?'':'收益有效 '+fmt(p.count[j],0)+'只 · ')+'5日均线 '+fmt(p.up_smooth?.[j])+'%',this.right,second.top-16);
  c.strokeStyle=atlasColor('#c1d2e568');c.lineWidth=1;for(const lane of [first,second]){c.beginPath();c.moveTo(this.X(j),lane.top);c.lineTo(this.X(j),lane.bottom);c.stroke();}
  for(let k=0;k<3;k++){const index=Math.round(k/2*(m.dates.length-1));c.fillStyle=atlasColor('#829ab4');c.textAlign=k===0?'left':k===2?'right':'center';c.fillText(m.dates[index].slice(2),this.X(index),this.h-10);}
  this.canvas.setAttribute('aria-label','上下独立的0—100%时间带：上方蓝色面积线为站上MA20比例；下方淡金色柱为当日上涨比例，金线为上涨比例5日均线。横虚线为50%。');
 }
}
const contextPlots=[new ParticipationPlot('breadthContext'),new ContextPlot('volContext',[{key:'vol',name:'20日年化波动',count:'count',color:atlasColor('#c0a3c5')}],'%'),new ContextPlot('amountContext',[{key:'amount',name:'成交额',count:'amount_count',color:atlasColor('#86b9ac')}],'亿元')];
function drawContexts(){if(typeof contextPlots!=='undefined'&&!$('stateSection').hidden)for(const plot of contextPlots)plot.draw();}
