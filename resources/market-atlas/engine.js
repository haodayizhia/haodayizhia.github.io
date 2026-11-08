/* Browser equivalent of scripts/market_atlas/model.py. Missing observations stay missing. */
'use strict';
(function(root){
 const fields=['close','amount','turnover','ma20','quoted','open','high','low','volume'];
 const valid=Number.isFinite, blank=n=>new Float64Array(n).fill(NaN);
 const list=a=>Array.from(a,v=>valid(v)?Math.round(v*1e5)/1e5:null);
 function rolling(a,w,kind='mean'){
  const out=blank(a.length);
  for(let t=w-1;t<a.length;t++){
   let sum=0,min=Infinity,max=-Infinity,ok=true;
   for(let k=t-w+1;k<=t;k++){const v=a[k];if(!valid(v)){ok=false;break;}sum+=v;min=Math.min(min,v);max=Math.max(max,v);}
   if(!ok)continue;
   if(kind==='min')out[t]=min;else if(kind==='max')out[t]=max;else if(kind==='sum')out[t]=sum;
   else if(kind==='std'){let variance=0;for(let k=t-w+1;k<=t;k++)variance+=(a[k]-sum/w)**2;out[t]=Math.sqrt(variance/(w-1));}
   else out[t]=sum/w;
  }
  return out;
 }
 class AtlasEngine{
  constructor(meta,arrays){
   this.meta=meta;this.n=meta.dates.length;this.s=meta.stocks.length;
   if(!this.n||!this.s||this.n*this.s>30_000_000)throw Error('数据规模为空或超过浏览器容量。');
   for(const key of fields){if(!(arrays[key] instanceof Float32Array)||arrays[key].length!==this.n*this.s)throw Error('数据矩阵不完整：'+key);this[key]=arrays[key];}
   this.ret=blank(this.n*this.s);let observations=0,large=0;
   const records=[];
   for(let t=1;t<this.n;t++)for(let i=0;i<this.s;i++){
    const at=t*this.s+i,before=at-this.s,r=(this.close[at]/this.close[before]-1)*100;
    if(this.close[at]>0&&this.close[before]>0&&valid(r)&&r>-100){this.ret[at]=r;observations++;if(Math.abs(r)>50){large++;if(records.length<20)records.push({code:meta.stocks[i].code,name:meta.stocks[i].name,date:meta.dates[t],price_return:r,csv_quoted_return:valid(this.quoted[at])?this.quoted[at]:null});}}
   }
   if(!observations&&!meta.allowEmptyGroup)throw Error('数据中没有可计算的相邻交易日收益，请检查价格与日期。');
   this.groups=new Map();meta.stocks.forEach((stock,i)=>{if(!this.groups.has(stock.industry))this.groups.set(stock.industry,[]);this.groups.get(stock.industry).push(i);});
   this.order=[...this.groups].sort((a,b)=>b[1].length-a[1].length||(a[0]<b[0]?-1:a[0]>b[0]?1:0));
   this.codes=new Map(meta.stocks.map((stock,i)=>[stock.code,i]));
   meta.industries=this.order.map(([name,ids])=>({name,count:ids.length}));
   meta.coverage=Array.from({length:this.n},(_,t)=>{let count=0;for(let i=0;i<this.s;i++)if(valid(this.close[t*this.s+i]))count++;return count;});
   Object.assign(meta.quality,{return_observations:observations,derived_over_50pct:large,large_return_records:records,
    missing_latest:meta.stocks.filter((_,i)=>!valid(this.close[(this.n-1)*this.s+i])).map(({code,name,last})=>({code,name,last}))});
   this.marketCache=new Map();
  }
  bounds(start,end){const a=this.meta.dates.indexOf(start),b=this.meta.dates.indexOf(end);if(a<0||b<0)throw Error('请选择数据范围内的交易日。');if(a>b)throw Error('开始日期不能晚于结束日期。');return[a,b];}
  cohort(a,b,mode){
   if(!['dynamic','complete'].includes(mode))throw Error('未知样本口径。');
   return Array.from({length:this.s},(_,i)=>i).filter(i=>{if(mode==='dynamic')return true;for(let t=a;t<=b;t++)if(!valid(this.close[t*this.s+i])||(t>a&&!valid(this.ret[t*this.s+i])))return false;return true;});
  }
  track(field,i){return Float64Array.from({length:this.n},(_,t)=>this[field][t*this.s+i]);}
  aggregate(ids,w){
   const keys=['ret','index','breadth','up','dispersion','vol','amount','relative','acceleration','momentum','drawdown','up_smooth'];
   const out=Object.fromEntries(keys.map(key=>[key,blank(this.n)]));
   for(const key of ['amount_count','count','price_count','breadth_count','window_count_min','window_count_max','vol_count_min','vol_count_max'])out[key]=new Float64Array(this.n);
   if(!ids.length)return out;
   delete out.relative;delete out.acceleration;
   let compound=1,peak=-Infinity,firstObserved=false;
   for(let t=0;t<this.n;t++){
    let sum=0,sum2=0,count=0,prices=0,breadth=0,breadthCount=0,up=0,amount=0,amountCount=0;
    for(const i of ids){const at=t*this.s+i,r=this.ret[at],c=this.close[at],ma=this.ma20[at],v=this.amount[at];
     if(valid(r)){sum+=r;sum2+=r*r;count++;if(r>0)up++;}
     if(valid(c)){prices++;if(valid(ma)&&ma>0){breadthCount++;if(c>ma)breadth++;}}
     if(valid(v)){amount+=v;amountCount++;}
    }
    out.count[t]=count;out.price_count[t]=prices;out.breadth_count[t]=breadthCount;out.amount_count[t]=amountCount;
    out.amount[t]=amountCount?amount:NaN;out.breadth[t]=breadthCount?breadth/breadthCount*100:NaN;
    if(count){const avg=sum/count;out.ret[t]=avg;out.up[t]=up/count*100;out.dispersion[t]=Math.sqrt(Math.max(0,sum2/count-avg*avg));compound*=1+avg/100;out.index[t]=compound;}
    if(prices&&!firstObserved){if(!valid(out.index[t]))out.index[t]=1;firstObserved=true;}
    if(valid(out.index[t])){peak=Math.max(peak,out.index[t]);out.drawdown[t]=(out.index[t]/peak-1)*100;}
   }
   for(let t=0;t<this.n;t++){
    if(w===1){out.momentum[t]=out.ret[t];continue;}
    if(t<w||!valid(out.index[t-w]))continue;let full=true;for(let k=t-w+1;k<=t;k++)if(!valid(out.ret[k])){full=false;break;}
    if(full)out.momentum[t]=(out.index[t]/out.index[t-w]-1)*100;
   }
   out.up_smooth=rolling(out.up,5);out.vol=rolling(out.ret,20,'std').map(v=>v*Math.sqrt(252));
   out.window_count_min=rolling(out.count,w,'min');out.window_count_max=rolling(out.count,w,'max');
   out.vol_count_min=rolling(out.count,20,'min');out.vol_count_max=rolling(out.count,20,'max');
   return out;
  }
  market(q){
   const key=JSON.stringify(q);if(this.marketCache.has(key))return this.marketCache.get(key);
   const [a,b]=this.bounds(q.start,q.end),w=Number(q.window||1),mode=q.mode||'dynamic';
   if(![1,5,10,20,60].includes(w))throw Error('观察窗口可选 1、5、10、20、60 个交易日。');
   const ids=this.cohort(a,b,mode);if(!ids.length)throw Error('此区间没有完整样本，请缩短区间或切换每日有效样本。');
   const allowed=new Set(ids),pool=this.aggregate(ids,w);
   const sliced=s=>{const out=Object.fromEntries(Object.entries(s).map(([k,v])=>[k,list(v.slice(a,b+1))]));out.path=Array.from({length:b-a+1},(_,t)=>valid(s.index[a])&&s.index[a]>0&&valid(s.index[a+t])?(s.index[a+t]/s.index[a]-1)*100:null);return out;};
   const sectors=this.order.map(([name,members])=>{const subset=members.filter(i=>allowed.has(i)),s=this.aggregate(subset,w),lag=w===1?1:5;
    s.relative=blank(this.n);s.acceleration=blank(this.n);
    for(let t=0;t<this.n;t++){s.relative[t]=s.momentum[t]-pool.momentum[t];s.acceleration[t]=t>=lag?s.relative[t]-s.relative[t-lag]:NaN;}
    return{name,size:members.length,eligible:subset.length,series:sliced(s)};
   });
   const result={dates:this.meta.dates.slice(a,b+1),pool:sliced(pool),sectors,eligible:ids.length,window:w,mode};
   if(this.marketCache.size>=4)this.marketCache.delete(this.marketCache.keys().next().value);this.marketCache.set(key,result);return result;
  }
  stock(q){
   const [a,b]=this.bounds(q.start,q.end),i=this.codes.get(q.code);if(i===undefined)throw Error('未知股票。');
   const c=this.track('close',i),base=c[a],drawdown=blank(this.n);let peak=-Infinity;
   for(let t=0;t<this.n;t++){if(valid(c[t]))peak=Math.max(peak,c[t]);drawdown[t]=(c[t]/peak-1)*100;}
   const out={...this.meta.stocks[i],dates:this.meta.dates.slice(a,b+1),volume_unit:'万股'};
   for(const field of [...fields,'ret'])out[field==='ret'?'daily':field]=list(this.track(field,i).slice(a,b+1));
   out.path=list(c.slice(a,b+1).map(v=>valid(base)?(v/base-1)*100:NaN));out.drawdown=list(drawdown.slice(a,b+1));
   out.ma5=list(rolling(c,5).slice(a,b+1));out.ma10=list(rolling(c,10).slice(a,b+1));return out;
  }
  industryHistory(q){
   const [a,b]=this.bounds(q.start,q.end),w=Number(q.window||1),members=this.groups.get(q.name);if(!members)throw Error('未知行业。');
   const allowed=new Set(this.cohort(a,b,q.mode||'dynamic')),ids=members.filter(i=>allowed.has(i));
   const stocks=ids.map(i=>{
    const c=this.track('close',i),r=this.track('ret',i),momentum=blank(this.n),drawdown=blank(this.n),base=c[a];let peak=-Infinity;
    for(let t=0;t<this.n;t++){
     if(valid(c[t]))peak=Math.max(peak,c[t]);drawdown[t]=(c[t]/peak-1)*100;
     if(t>=w){let ok=true;for(let k=t-w;k<=t;k++)if(!valid(c[k])){ok=false;break;}if(ok)momentum[t]=(c[t]/c[t-w]-1)*100;}
    }
    const cut=v=>list(v.slice(a,b+1)),tracks={path:list(c.slice(a,b+1).map(v=>valid(base)?(v/base-1)*100:NaN)),momentum:cut(momentum),vol:cut(rolling(r,20,'std').map(v=>v*Math.sqrt(252))),drawdown:cut(drawdown),price:cut(c),daily:cut(r),amount:cut(this.track('amount',i)),turnover:cut(this.track('turnover',i))};
    return{...this.meta.stocks[i],tracks};
   });
   return{name:q.name,dates:this.meta.dates.slice(a,b+1),stocks,eligible:stocks.length};
  }
  industry(q){
   const history=this.industryHistory(q),[a,b]=this.bounds(q.start,q.asof||q.end),end=this.bounds(q.start,q.end)[1];if(b>end)throw Error('观察日不能晚于区间结束日。');
   const at=b-a,stocks=history.stocks.map(stock=>{const t=stock.tracks,i=this.codes.get(stock.code),ma=this.ma20[b*this.s+i],price=t.price[at];return{...this.meta.stocks[i],path:t.path.slice(0,at+1),period:t.path[at],momentum:t.momentum[at],vol:t.vol[at],drawdown:t.drawdown[at],daily:t.daily[at],price,amount:t.amount[at],turnover:t.turnover[at],above20:price!==null&&valid(ma)&&ma>0?price>ma:null};});
   return{name:q.name,dates:this.meta.dates.slice(a,b+1),stocks,eligible:stocks.length};
  }
  request(path,q={}){if(path==='/api/health')return{ok:true,version:8};if(path==='/api/meta')return this.meta;if(path==='/api/market')return this.market(q);if(path==='/api/stock')return this.stock(q);if(path==='/api/industry-history')return this.industryHistory(q);if(path==='/api/industry')return this.industry(q);throw Error('未知数据操作。');}
 }
 root.AtlasEngine=AtlasEngine;root.AtlasFields=fields;
 if(typeof module!=='undefined')module.exports={AtlasEngine,fields,rolling};
})(globalThis);
