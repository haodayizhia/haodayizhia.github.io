/* Streaming RFC 4180 reader; files remain on the visitor's machine. */
'use strict';
(function(root){
 const required=['代码','名称','交易日期','所属行业','现价','涨幅%','成交额(亿元)','换手率','MA20'];
 class CSVParser{
  constructor(row){this.row=row;this.field='';this.cells=[];this.quoted=false;this.closed=false;this.started=false;this.line=1;}
  emit(){this.cells.push(this.field);this.field='';if(this.cells.some(v=>v.trim()))this.row(this.cells,this.line);this.cells=[];this.started=false;this.line++;}
  write(text,final=false){
   for(const ch of text){
    if(this.quoted){if(this.closed){if(ch==='"'){this.field+='"';this.closed=false;continue;}this.quoted=false;this.closed=false;if(ch!==','&&ch!=='\n'&&ch!=='\r'&&ch!==' '&&ch!=='\t')throw Error('CSV 引号后的内容不合法，行 '+this.line);if(ch===' '||ch==='\t')continue;}else{if(ch==='"')this.closed=true;else this.field+=ch;continue;}}
    if(ch==='"'){if(this.field.length)throw Error('CSV 引号位置不合法，行 '+this.line);this.quoted=true;this.started=true;}
    else if(ch===','){this.cells.push(this.field);this.field='';this.started=true;}
    else if(ch==='\n')this.emit();else if(ch!=='\r'){this.field+=ch;this.started=true;}
   }
   if(final){if(this.quoted&&!this.closed)throw Error('CSV 引号未闭合。');this.quoted=false;this.closed=false;if(this.started||this.field||this.cells.length)this.emit();}
  }
 }
 const numeric=x=>{const s=String(x??'').trim();if(!s||/^(nan|null|none|na|n\/a)$/i.test(s))return NaN;const v=Number(s);return Number.isFinite(v)?v:NaN;};
 function dateValue(text){
  const s=String(text).trim().replace(/\.0$/,'');if(!/^\d{8}$/.test(s))return null;
  const iso=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6),d=new Date(iso+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===iso?{number:Number(s),iso}:null;
 }
 class StockRows{
  constructor(code){this.code=code;this.capacity=256;this.size=0;this.dates=new Uint32Array(this.capacity);this.values=new Float32Array(this.capacity*9);this.latest=0;this.name=code;this.industry='未分类';this.industries=new Set();}
  push(date,values,name,industry){
   if(this.size===this.capacity){this.capacity*=2;const dates=new Uint32Array(this.capacity),data=new Float32Array(this.capacity*9);dates.set(this.dates);data.set(this.values);this.dates=dates;this.values=data;}
   this.dates[this.size]=date;this.values.set(values,this.size*9);this.size++;
   if(industry)this.industries.add(industry);if(date>=this.latest){this.latest=date;this.name=name||this.code;if(industry)this.industry=industry;}
  }
 }
 async function importCsv(files,kind,progress=()=>{}){
  if(!files.length||(kind==='merged'&&files.length!==1))throw Error('请选择合并CSV或逐股CSV。');
  const total=files.reduce((s,f)=>s+f.size,0);if(total>2*1024**3)throw Error('所选CSV总大小超过2GB，请缩小数据范围。');
  const quality={files:files.length,rows:0,duplicate_rows:0,invalid_dates:0,invalid_prices:0,invalid_amounts:0,invalid_turnover:0,invalid_codes:0,industry_changes:[],errors:[],schema_errors:[],quote_missing:0,cache_hit:false,load_seconds:0};
  const stocks=new Map(),allDates=new Map();let loaded=0,observations=0;
  for(const file of files){
   let header=null,columns=null,rows=0;
   const expected=kind==='directory'?file.name.replace(/\.csv$/i,'').toUpperCase():null;
   if(expected&&!/^\d{6}\.(SH|SZ|BJ)$/.test(expected))throw Error('逐股文件名不合法：'+file.name);
   const parser=new CSVParser((row,line)=>{
    if(!header){header=row.map(v=>v.replace(/^\uFEFF/,'').trim());if(new Set(header).size!==header.length)throw Error('CSV存在重复列名：'+file.name);const missing=required.filter(v=>!header.includes(v));if(missing.length)throw Error(file.name+' 缺少字段：'+missing.join('、'));columns=Object.fromEntries(header.map((name,i)=>[name,i]));return;}
    rows++;quality.rows++;if(row.length!==header.length)throw Error(file.name+' 第'+line+'行列数与表头不一致。');
    const get=name=>row[columns[name]],code=(get('代码')||'').trim().toUpperCase();
    if(!/^\d{6}\.(SH|SZ|BJ)$/.test(code)||expected&&expected!==code)throw Error(file.name+' 第'+line+'行代码或文件名不一致。');
    const date=dateValue(get('交易日期'));if(!date){quality.invalid_dates++;return;}
    const values=['现价','成交额(亿元)','换手率','MA20','涨幅%','开盘价','最高价','最低价'].map(key=>numeric(get(key)));
    for(const [i,label] of [[0,'invalid_prices'],[1,'invalid_amounts'],[2,'invalid_turnover']])if(!Number.isFinite(values[i])||(i===0?values[i]<=0:values[i]<0)){quality[label]++;values[i]=NaN;}
    for(const i of [3,5,6,7])if(!Number.isFinite(values[i])||values[i]<=0)values[i]=NaN;
    if(!Number.isFinite(values[4]))quality.quote_missing++;
    if([0,5,6,7].every(i=>Number.isFinite(values[i]))&&(values[6]<Math.max(values[0],values[5])||values[7]>Math.min(values[0],values[5])||values[7]>values[6]))values[5]=values[6]=values[7]=NaN;
    let volume=NaN;for(const [column,factor] of [['成交量(万股)',1],['成交量(股)',.0001],['成交量(手)',.01]]){const v=numeric(get(column));if(Number.isFinite(v)&&v>=0){volume=v*factor;break;}}values.push(volume);
    if(!stocks.has(code))stocks.set(code,new StockRows(code));stocks.get(code).push(date.number,values,get('名称'),get('所属行业'));
    allDates.set(date.number,date.iso);observations++;if(observations>8_000_000)throw Error('CSV行数超过浏览器容量，请缩小数据范围。');
   });
   const sample=await file.slice(0,65536).arrayBuffer();let encoding='utf-8';try{new TextDecoder('utf-8',{fatal:true}).decode(sample,{stream:true});}catch{encoding='gb18030';}
   const decoder=new TextDecoder(encoding,{fatal:true}),reader=file.stream().getReader();
   try{while(true){const {done,value}=await reader.read();if(done)break;parser.write(decoder.decode(value,{stream:true}));loaded+=value.byteLength;progress({percent:Math.min(95,Math.round(loaded/total*95)),message:'正在本地解析 '+file.name+' · '+Math.round(loaded/total*100)+'%'});}parser.write(decoder.decode(),true);}finally{reader.releaseLock();}
   if(!header||!rows)throw Error(file.name+' 没有数据行。');
  }
  const dateNumbers=[...allDates.keys()].sort((a,b)=>a-b),ordered=[...stocks.values()].sort((a,b)=>a.code.localeCompare(b.code)),n=dateNumbers.length,s=ordered.length;
  if(!n||!s||n*s>30_000_000)throw Error('数据规模为空或超过浏览器容量。');
  const dateIndex=new Map(dateNumbers.map((d,i)=>[d,i])),arrays=Object.fromEntries(AtlasFields.map(f=>[f,new Float32Array(n*s).fill(NaN)]));
  const metadata=ordered.map((stock,i)=>{
   const lastRows=new Map();for(let row=0;row<stock.size;row++){if(lastRows.has(stock.dates[row]))quality.duplicate_rows++;lastRows.set(stock.dates[row],row);}
   let first=Infinity,last=0;for(const [date,row] of lastRows){first=Math.min(first,date);last=Math.max(last,date);const at=dateIndex.get(date)*s+i;for(let f=0;f<AtlasFields.length;f++)arrays[AtlasFields[f]][at]=stock.values[row*9+f];}
   if(stock.industries.size>1)quality.industry_changes.push(stock.code);
   stock.values=null;stock.dates=null;
   return{code:stock.code,name:stock.name,industry:stock.industry,first:allDates.get(first),last:allDates.get(last),rows:lastRows.size};
  });
  const fingerprint=files.map(f=>f.name+':'+f.size+':'+f.lastModified).sort().join('|');
  let hash=2166136261;for(const c of fingerprint)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  progress({percent:98,message:'校验完成，正在建立研究序列…'});
  return new AtlasEngine({dates:dateNumbers.map(d=>allDates.get(d)),stocks:metadata,quality,source:'本地导入 · '+(hash>>>0).toString(16),source_kind:kind,imported_at:new Date().toISOString()},arrays);
 }
 root.CSVParser=CSVParser;root.importAtlasCsv=importCsv;
 if(typeof module!=='undefined')module.exports={CSVParser,dateValue,numeric};
})(globalThis);
