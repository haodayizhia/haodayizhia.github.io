'use strict';
// Returns are in percent, differences in percentage points. Missing observations never vote.
(function(root) {
  const W = 20;
  const metrics = ['sector','excess5','wins','p10','median','p90','up','count','gained','lost','joined','left'];
  const finite = Number.isFinite;
  function quantile(sorted,p) {
    if (!sorted.length) return null;
    const position=(sorted.length-1)*p, lower=Math.floor(position);
    return sorted[lower]+(sorted[Math.ceil(position)]-sorted[lower])*(position-lower);
  }
  function winCount(values,reference,t,peerCounts) {
    if (t<W) return null;
    let wins=0;
    for (let k=t-W+1;k<=t;k++) {
      if (!finite(values[k])||!finite(reference[k])||(peerCounts&&peerCounts[k]<2)) return null;
      if (values[k]>reference[k]) wins++;
    }
    return wins;
  }
  // Six bytes per stock/session: one Float32 return, then two unsigned day counts.
  function pack(days,size) {
    const total=days.length*size, buffer=new ArrayBuffer(total*6);
    const returns=new Float32Array(buffer,0,total).fill(NaN);
    const industryWins=new Uint8Array(buffer,total*4,total).fill(255);
    const marketWins=new Uint8Array(buffer,total*5,total).fill(255);
    days.forEach((rows,d)=>rows.forEach(([id,r,g,m])=>{
      const i=d*size+id;returns[i]=r;industryWins[i]=g??255;marketWins[i]=m??255;
    }));
    return buffer;
  }
  function unpack(buffer,offset,count,size) {
    if (offset<0||offset>=count||buffer.byteLength!==count*size*6) throw Error('结构分片与日期或股票目录不一致。');
    const total=count*size, start=offset*size;
    const returns=new Float32Array(buffer,start*4,size);
    const group=new Uint8Array(buffer,total*4+start,size), market=new Uint8Array(buffer,total*5+start,size);
    const rows=[];
    for (let i=0;i<size;i++) if (finite(returns[i])) rows.push([i,returns[i],group[i]===255?null:group[i],market[i]===255?null:market[i]]);
    return rows;
  }
  function slice(summary,start,end) {
    const a=summary.dates.indexOf(start),b=summary.dates.indexOf(end);
    if (a<0||b<a) throw Error('结构数据缺少所选交易日。');
    const cut=arr=>arr.slice(a,b+1);
    return {dates:cut(summary.dates),pool:cut(summary.pool),groups:summary.groups.map(g=>({
      name:g.name,...Object.fromEntries(metrics.map(k=>[k,cut(g[k])]))
    }))};
  }
  function calculate(engine,q,saveDays=false) {
    const [a,b]=engine.bounds(q.start,q.end),ids=engine.cohort(a,b,q.mode||'dynamic'),allowed=new Set(ids);
    const pool=engine.aggregate(ids,W),poolShort=engine.aggregate(ids,5);
    const display=v=>finite(v)?Math.round(v*1e5)/1e5:null;
    const cleanSlice=arr=>Array.from(arr.slice(a,b+1),display);
    const summary={dates:engine.meta.dates.slice(a,b+1),pool:cleanSlice(pool.momentum),groups:[]};
    const days=Array.from({length:saveDays?b-a+1:1},()=>[]);
    for (const [name,members] of engine.order) {
      const included=members.filter(i=>allowed.has(i)),group=engine.aggregate(included,W),short=engine.aggregate(included,5);
      const series={name,...Object.fromEntries(metrics.map(k=>[k,[]]))};
      const tracks=included.map(i=>({id:i,values:engine.track('ret',i)}));
      let previous=null;
      for (let t=Math.max(0,a-1);t<=b;t++) {
        const values=[],today=new Map(),rows=t<a?null:saveDays?days[t-a]:t===b?days[0]:null;
        for (const {id,values:daily} of tracks) {
          if (t<W) continue;
          let valid=true;
          for (let k=t-W+1;k<=t;k++) if (!finite(daily[k])) {valid=false;break;}
          if (!valid) continue;
          const r=(engine.close[t*engine.s+id]/engine.close[(t-W)*engine.s+id]-1)*100;
          values.push(r);today.set(id,r>0);
          if (rows) rows.push([id,Math.fround(r),winCount(daily,group.ret,t,group.count),winCount(daily,pool.ret,t)]);
        }
        let gained=0,lost=0,joined=0,left=0;
        if(previous){
          for(const [id,positive] of today){
            if(!previous.has(id))joined++;
            else if(positive!==previous.get(id)){if(positive)gained++;else lost++;}
          }
          for(const id of previous.keys())if(!today.has(id))left++;
        }
        const comparable=previous!==null;previous=today;
        if(t<a)continue;
        for(const [key,value] of Object.entries({gained,lost,joined,left}))series[key].push(comparable?value:null);
        values.sort((x,y)=>x-y);
        series.sector.push(display(group.momentum[t]));
        const excess=short.momentum[t]-poolShort.momentum[t];
        series.excess5.push(display(excess));
        series.wins.push(winCount(group.ret,pool.ret,t));
        series.p10.push(display(quantile(values,.1)));series.median.push(display(quantile(values,.5)));series.p90.push(display(quantile(values,.9)));
        series.count.push(values.length);series.up.push(values.filter(v=>v>0).length);
      }
      summary.groups.push(series);
    }
    return {summary,days};
  }
  function correlation(a,b,lag=0) {
    let n=0,mx=0,my=0,xx=0,yy=0,xy=0;
    for (let i=0;i<a.length;i++) {
      const x=a[i],y=b[i+lag];if (!finite(x)||!finite(y)) continue;
      n++;const dx=x-mx,dy=y-my;mx+=dx/n;my+=dy/n;
      xx+=dx*(x-mx);yy+=dy*(y-my);xy+=dx*(y-my);
    }
    return {n,value:n>=2&&xx>0&&yy>0?Math.min(1,Math.max(-1,xy/Math.sqrt(xx*yy))):null};
  }
  root.AtlasStructure={calculate,pack,unpack,slice,quantile,correlation};
  if (typeof module!=='undefined') module.exports=root.AtlasStructure;
})(globalThis);
