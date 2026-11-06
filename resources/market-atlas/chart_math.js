'use strict';

// Display sampling never replaces the raw observations used by tooltips or metrics.
function samplePathIndices(values, start, end, pixels) {
 const result=[], bucketSize=Math.max(1,(end-start+1)/Math.max(1,Math.floor(pixels)));
 let bucket=-1,points=[];
 const flush=()=>{if(!points.length)return;let min=points[0],max=min;for(const i of points){if(values[i]<values[min])min=i;if(values[i]>values[max])max=i;}result.push(...[...new Set([points[0],min,max,points.at(-1)])].sort((a,b)=>a-b));points=[];};
 for(let i=start;i<=end;i++){
  if(typeof values[i]!=='number'||!Number.isFinite(values[i])){flush();if(result.length&&result.at(-1)!==null)result.push(null);bucket=-1;continue;}
  const next=Math.floor((i-start)/bucketSize);if(next!==bucket){flush();bucket=next;}points.push(i);
 }
 flush();return result;
}
function excessValue(value, benchmark) {return typeof value==='number'&&Number.isFinite(value)&&typeof benchmark==='number'&&Number.isFinite(benchmark)?value-benchmark:null;}
function excessTrack(values,benchmark) {return values.map((value,i)=>excessValue(value,benchmark[i]));}
function rankStocks(stocks,valueAt){
 return stocks.map(stock=>({stock,value:valueAt(stock)})).sort((a,b)=>{
  const av=typeof a.value==='number'&&Number.isFinite(a.value),bv=typeof b.value==='number'&&Number.isFinite(b.value);
  if(av!==bv)return av?-1:1;
  if(av&&a.value!==b.value)return b.value-a.value;
  return String(a.stock.code??a.stock.name).localeCompare(String(b.stock.code??b.stock.name));
 }).map(row=>row.stock);
}
function strengthColorLimit(window){return window===1?5:window===5?10:window===60?35:18;}
function visibleHeatRows(total,height,scrollTop,rowHeight,header){
 const top=Math.max(0,Math.min(scrollTop,Math.max(0,header+total*rowHeight-height)));
 return {top,first:Math.min(total,Math.floor(top/rowHeight)),last:Math.min(total-1,Math.ceil((top+height-header)/rowHeight)-1)};
}
if(typeof module!=='undefined')module.exports={samplePathIndices,excessValue,excessTrack,visibleHeatRows,rankStocks,strengthColorLimit};
