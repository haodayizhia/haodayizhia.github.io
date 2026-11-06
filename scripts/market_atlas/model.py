"""Read-only CSV analytics. All windows are trailing trading-day windows."""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

VERSION = 5
REQUIRED = ['代码', '名称', '交易日期', '所属行业', '现价', '涨幅%', '成交额(亿元)', '换手率', 'MA20']
OPTIONAL = ['开盘价', '最高价', '最低价', '成交量(万股)', '成交量(股)', '成交量(手)']
ARRAY_FIELDS = ['close', 'amount', 'turnover', 'ma20', 'quoted', 'open', 'high', 'low', 'volume']


def clean(value):
    """JSON floats must never contain NaN or Infinity."""
    if isinstance(value, np.ndarray):
        return clean(value.tolist())
    if isinstance(value, (list, tuple)):
        return [clean(x) for x in value]
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (float, np.floating)):
        return round(float(value), 5) if np.isfinite(value) else None
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def mean(a, axis=1):
    n = np.isfinite(a).sum(axis=axis)
    return np.divide(np.nansum(a, axis=axis), n, out=np.full(n.shape, np.nan), where=n > 0)


def fraction(condition, valid):
    n = valid.sum(axis=1)
    return np.divide((condition & valid).sum(axis=1) * 100., n, out=np.full(len(n), np.nan), where=n > 0)


def rolling(a, window, kind='mean'):
    obj = pd.DataFrame(a).rolling(window, min_periods=window)
    return getattr(obj, kind)().to_numpy()


def compound(r):
    # No observations => gap, never a synthetic zero-return observation.
    values = np.cumprod(1 + np.where(np.isfinite(r), r, 0) / 100, axis=0)
    return np.where(np.isfinite(r), values, np.nan)


class MarketData:
    def __init__(self, source: Path, cache: Path | None = None):
        self.source = source.resolve()
        self.cache = cache
        self.lock = threading.RLock()
        started = time.perf_counter()
        if self.source.is_file() and self.source.suffix.lower()!='.csv':
            raise ValueError('请选择CSV文件，或直接包含逐股CSV的目录。')
        files = [self.source] if self.source.is_file() else sorted(self.source.glob('*.csv'))
        if not files:
            raise ValueError(f'路径不存在或没有CSV：{self.source}')
        signature = hashlib.sha256((str(VERSION) + str(self.source) + ''.join(
            f'{f.name}:{f.stat().st_size}:{f.stat().st_mtime_ns};' for f in files)).encode()).hexdigest()
        loaded = False
        if cache and (cache / 'manifest.json').exists() and (cache / 'arrays.npz').exists():
            try:
                manifest = json.loads((cache / 'manifest.json').read_text(encoding='utf-8'))
                if manifest['signature'] == signature:
                    with np.load(cache / 'arrays.npz', allow_pickle=False) as saved:
                        for key in ARRAY_FIELDS:
                            setattr(self, key, saved[key].astype(float))
                    self.dates, self.stocks, self.quality = manifest['dates'], manifest['stocks'], manifest['quality']
                    loaded = True
            except (OSError, ValueError, KeyError, EOFError):
                pass
        if not loaded:
            self._read(files)
            if cache:
                cache.mkdir(parents=True, exist_ok=True)
                with (cache / 'arrays.tmp').open('wb') as out:
                    np.savez_compressed(out, **{k: getattr(self, k).astype('float32') for k in ARRAY_FIELDS})
                os.replace(cache / 'arrays.tmp', cache / 'arrays.npz')
                manifest = dict(signature=signature, dates=self.dates, stocks=self.stocks, quality=self.quality)
                (cache / 'manifest.tmp').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
                os.replace(cache / 'manifest.tmp', cache / 'manifest.json')
        self.date_index = {d: i for i, d in enumerate(self.dates)}
        self.code_index = {s['code']: i for i, s in enumerate(self.stocks)}
        self.groups = {}
        for i, s in enumerate(self.stocks):
            self.groups.setdefault(s['industry'], []).append(i)
        with np.errstate(invalid='ignore', divide='ignore'):
            self.ret = (self.close / np.roll(self.close, 1, axis=0) - 1) * 100
        self.ret[0] = np.nan
        self.ret[(self.ret <= -100) | ~np.isfinite(self.ret)] = np.nan
        self.above_valid = np.isfinite(self.close) & np.isfinite(self.ma20) & (self.ma20 > 0)
        self.quality['return_observations'] = int(np.isfinite(self.ret).sum())
        self.quality['derived_over_50pct'] = int((np.abs(self.ret) > 50).sum())
        self.quality['large_return_records'] = clean([dict(code=self.stocks[j]['code'],name=self.stocks[j]['name'],
            date=self.dates[i],price_return=self.ret[i,j],csv_quoted_return=self.quoted[i,j])
            for i,j in np.argwhere(np.abs(self.ret)>50)[:20]])
        self.quality['missing_latest'] = [dict(code=s['code'],name=s['name'],last=s['last'])
                                         for j,s in enumerate(self.stocks) if not np.isfinite(self.close[-1,j])]
        self.quality['cache_hit'] = loaded
        self.quality['load_seconds'] = round(time.perf_counter() - started, 2)

    def _read(self, files):
        frames=[]; stocks=[]
        quality=dict(files=len(files), rows=0, duplicate_rows=0, invalid_dates=0, invalid_prices=0,
                     invalid_amounts=0, invalid_turnover=0, invalid_codes=0, industry_changes=[], errors=[], schema_errors=[], quote_missing=0)
        for f in files:
            try:
                try:
                    df = pd.read_csv(f, encoding='utf-8-sig', usecols=lambda c: c in REQUIRED+OPTIONAL, dtype={'代码':str, '交易日期':str})
                except UnicodeDecodeError:
                    df = pd.read_csv(f, encoding='gb18030', usecols=lambda c: c in REQUIRED+OPTIONAL, dtype={'代码':str, '交易日期':str})
                missing = set(REQUIRED) - set(df.columns)
                if missing:
                    quality['schema_errors'].append(dict(file=f.name, missing=sorted(missing)))
                    continue
                quality['rows'] += len(df)
                df['代码']=df['代码'].str.strip().str.upper()
                valid_codes=df['代码'].str.fullmatch(r'\d{6}\.(SH|SZ|BJ)',na=False)
                if not valid_codes.all():
                    n=int((~valid_codes).sum());quality['invalid_codes']+=n
                    quality['errors'].append(dict(file=f.name,error=f'{n}条代码为空或格式不符，未纳入'))
                    df=df.loc[valid_codes]
                groups=df.groupby('代码',sort=True) if self.source.is_file() else [(f.stem,df)]
                for expected,part in groups:
                    try:
                        self._read_stock(part.copy(),expected,f.name,frames,stocks,quality)
                    except Exception as e:
                        quality['errors'].append(dict(file=f.name,code=expected,error=str(e)))
            except Exception as e:
                quality['errors'].append(dict(file=f.name, error=str(e)))
        if not frames:
            raise ValueError('全部 CSV 读取失败，请检查字段、编码和数据路径。')
        data=pd.concat(frames,ignore_index=True)
        dates=sorted(data['date'].unique())
        self.dates=[pd.Timestamp(d).strftime('%Y-%m-%d') for d in dates]
        self.stocks=stocks; self.quality=quality
        for key in ARRAY_FIELDS:
            mat=data.pivot(index='date',columns='stock',values=key).reindex(index=dates,columns=range(len(stocks)))
            setattr(self,key,mat.to_numpy(dtype='float32').astype(float))

    def _read_stock(self,df,expected,filename,frames,stocks,quality):
        df['date'] = pd.to_datetime(df['交易日期'].str.replace(r'\.0$', '', regex=True), format='%Y%m%d', errors='coerce')
        quality['invalid_dates'] += int(df['date'].isna().sum())
        df = df.dropna(subset=['date']).sort_values('date', kind='stable')
        if df.empty:
            raise ValueError('没有有效日期')
        codes = df['代码'].dropna().unique()
        if len(codes) != 1 or str(codes[0]) != expected:
            raise ValueError('文件名与代码不一致，或一个文件含多个代码')
        quality['duplicate_rows'] += int(df.duplicated('date').sum())
        df = df.drop_duplicates('date', keep='last').copy()
        industries=df['所属行业'].dropna().astype(str)
        if industries.nunique() > 1:
            quality['industry_changes'].append(f'{filename}: {expected}')
        industry=industries.iloc[-1] if len(industries) else '未分类'
        stock=dict(code=str(codes[0]), name=str(df['名称'].iloc[-1]), industry=industry,
                   first=df['date'].iloc[0].strftime('%Y-%m-%d'), last=df['date'].iloc[-1].strftime('%Y-%m-%d'), rows=len(df))
        for key, col in [('close','现价'),('quoted','涨幅%'),('amount','成交额(亿元)'),('turnover','换手率'),('ma20','MA20')]:
            df[key]=pd.to_numeric(df[col],errors='coerce')
        bad=~np.isfinite(df['close']) | (df['close']<=0)
        quality['invalid_prices']+=int(bad.sum()); df.loc[bad,'close']=np.nan
        for key,label in [('amount','invalid_amounts'),('turnover','invalid_turnover')]:
            bad=~np.isfinite(df[key]) | (df[key]<0)
            quality[label]+=int(bad.sum()); df.loc[bad,key]=np.nan
        df.loc[df['ma20']<=0,'ma20']=np.nan
        for key,col in [('open','开盘价'),('high','最高价'),('low','最低价')]:
            df[key]=pd.to_numeric(df[col],errors='coerce') if col in df else np.nan
            df.loc[~np.isfinite(df[key]) | (df[key]<=0),key]=np.nan
        df['volume']=np.nan
        for col,factor in [('成交量(万股)',1.),('成交量(股)',.0001),('成交量(手)',.01)]:
            if col in df:
                values=pd.to_numeric(df[col],errors='coerce')*factor
                df['volume']=df['volume'].fillna(values.where(np.isfinite(values)&(values>=0)))
        # An inconsistent candle is unavailable, never repaired with synthetic OHLC.
        candle=np.isfinite(df[['open','high','low','close']]).all(axis=1)
        bad=candle & ((df['high']<df[['open','close']].max(axis=1)) | (df['low']>df[['open','close']].min(axis=1)) | (df['low']>df['high']))
        df.loc[bad,['open','high','low']]=np.nan
        quality['quote_missing']+=int(df['quoted'].isna().sum())
        df['stock']=len(stocks);stocks.append(stock)
        frames.append(df[['date','stock']+ARRAY_FIELDS])

    def metadata(self):
        return clean(dict(dates=self.dates, stocks=self.stocks,
            industries=[dict(name=k,count=len(v)) for k,v in sorted(self.groups.items(), key=lambda x:(-len(x[1]),x[0]))],
            quality=self.quality, source=str(self.source),source_kind='merged' if self.source.is_file() else 'directory', coverage=np.isfinite(self.close).sum(axis=1)))

    def bounds(self, start, end):
        if start not in self.date_index or end not in self.date_index:
            raise ValueError('请选择数据范围内的交易日。')
        a,b=self.date_index[start],self.date_index[end]
        if a>b:
            raise ValueError('开始日期不能晚于结束日期。')
        return a,b

    def cohort(self,a,b,mode):
        if mode not in ('dynamic','complete'):
            raise ValueError('未知样本口径。')
        if mode=='dynamic':
            return np.arange(len(self.stocks))
        valid=np.isfinite(self.close[a:b+1]).all(axis=0)
        if b>a:
            valid &= np.isfinite(self.ret[a+1:b+1]).all(axis=0)
        return np.flatnonzero(valid)

    def aggregate(self,indices,w):
        n=len(self.dates)
        if not len(indices):
            empty={k:np.full(n,np.nan) for k in ['ret','index','breadth','up','dispersion','vol','amount','relative','acceleration','momentum','drawdown','up_smooth']}
            empty.update({k:np.zeros(n) for k in ['amount_count','count','price_count','breadth_count','window_count_min','window_count_max','vol_count_min','vol_count_max']})
            return empty
        r=self.ret[:,indices]
        avg=mean(r)
        index=compound(avg)
        observed=np.isfinite(self.close[:,indices]).any(axis=1)
        first=np.flatnonzero(observed)
        if len(first) and not np.isfinite(index[first[0]]):
            index[first[0]]=1.
        with np.errstate(divide='ignore',invalid='ignore'):
            mom=(index/np.roll(index,w)-1)*100
        mom[:w]=np.nan
        # A momentum window crossing an entirely missing aggregate session is unavailable.
        full=rolling(np.isfinite(avg).astype(float),w,'sum').ravel()==w
        mom[~full]=np.nan
        if w==1:
            mom=avg.copy()
        breadth=fraction(self.close[:,indices]>self.ma20[:,indices],self.above_valid[:,indices])
        count=np.isfinite(r).sum(axis=1)
        price_count=np.isfinite(self.close[:,indices]).sum(axis=1)
        breadth_count=self.above_valid[:,indices].sum(axis=1)
        up=fraction(r>0,np.isfinite(r))
        dispersion=np.sqrt(mean((r-avg[:,None])**2))
        amount=self.amount[:,indices]; amount_n=np.isfinite(amount).sum(axis=1)
        total=np.nansum(amount,axis=1); total[amount_n==0]=np.nan
        peak=np.maximum.accumulate(np.where(np.isfinite(index),index,-np.inf))
        return dict(ret=avg,index=index,breadth=breadth,breadth_count=breadth_count,up=up,up_smooth=rolling(up,5).ravel(),dispersion=dispersion,
                    vol=rolling(avg,20,'std').ravel()*np.sqrt(252),amount=total,amount_count=amount_n,
                    count=count,price_count=price_count,window_count_min=rolling(count,w,'min').ravel(),window_count_max=rolling(count,w,'max').ravel(),
                    vol_count_min=rolling(count,20,'min').ravel(),vol_count_max=rolling(count,20,'max').ravel(),momentum=mom,drawdown=(index/peak-1)*100)

    @lru_cache(maxsize=12)
    def market(self,start,end,w=1,mode='dynamic'):
        a,b=self.bounds(start,end)
        if w not in (1,5,10,20,60):
            raise ValueError('观察窗口可选 1、5、10、20、60 个交易日。')
        ids=self.cohort(a,b,mode)
        pool=self.aggregate(ids,w)
        if len(ids)==0:
            raise ValueError('此区间没有完整样本，请缩短区间或切换每日有效样本。')
        def sliced(series):
            result={k:v[a:b+1].copy() for k,v in series.items()}
            # First selected session is the baseline; its return is not included in period P&L.
            base=series['index'][a]
            if np.isfinite(base) and base>0:
                result['path']=(series['index'][a:b+1]/base-1)*100
            else:
                result['path']=np.full(b-a+1,np.nan)
                # No baseline observation => no comparable period path, including late industries.
            return result
        sectors=[]; allowed=set(ids.tolist())
        for name,members in sorted(self.groups.items(),key=lambda x:(-len(x[1]),x[0])):
            subset=[i for i in members if i in allowed]
            s=self.aggregate(subset,w)
            s['relative']=s['momentum']-pool['momentum']
            lag=1 if w==1 else 5
            s['acceleration']=s['relative']-np.roll(s['relative'],lag)
            s['acceleration'][:lag]=np.nan
            sectors.append(dict(name=name,size=len(members),eligible=len(subset),series=sliced(s)))
        return clean(dict(dates=self.dates[a:b+1],pool=sliced(pool),sectors=sectors,eligible=len(ids),window=w,mode=mode))

    def stock_metrics(self,ids,a,b,w):
        c=self.close[:,ids]
        with np.errstate(divide='ignore',invalid='ignore'):
            momentum=(c[b]/c[b-w]-1)*100 if b>=w else np.full(len(ids),np.nan)
            period=(c[b]/c[a]-1)*100
        if b>=w:
            momentum[~np.isfinite(c[b-w:b+1]).all(axis=0)]=np.nan
        if b>=19:
            rr=self.ret[b-19:b+1,ids]
            vol=np.std(rr,axis=0,ddof=1)*np.sqrt(252)
        else: vol=np.full(len(ids),np.nan)
        # No forward fill: stale final observations remain unavailable.
        peak=np.max(np.where(np.isfinite(c[:b+1]),c[:b+1],-np.inf),axis=0)
        dd=(c[b]/peak-1)*100
        return momentum,period,vol,dd

    @lru_cache(maxsize=20)
    def industry(self,name,start,end,w=1,mode='dynamic',asof=None):
        a,selection_end=self.bounds(start,end)
        b=self.bounds(start,asof or end)[1]
        if b>selection_end:
            raise ValueError('观察日不能晚于区间结束日。')
        if name not in self.groups:
            raise ValueError('未知行业。')
        allowed=set(self.cohort(a,selection_end,mode).tolist())
        ids=[i for i in self.groups[name] if i in allowed]
        if not ids:
            return dict(name=name,dates=self.dates[a:b+1],stocks=[],eligible=0)
        mom,period,vol,dd=self.stock_metrics(ids,a,b,w)
        rows=[]
        for j,i in enumerate(ids):
            base=self.close[a,i]
            path=(self.close[a:b+1,i]/base-1)*100 if np.isfinite(base) else np.full(b-a+1,np.nan)
            rows.append(dict(**self.stocks[i],path=path,period=period[j],momentum=mom[j],vol=vol[j],drawdown=dd[j],
                             daily=self.ret[b,i],price=self.close[b,i],amount=self.amount[b,i],turnover=self.turnover[b,i],
                             above20=(self.close[b,i]>self.ma20[b,i]) if self.above_valid[b,i] else None))
        return clean(dict(name=name,dates=self.dates[a:b+1],stocks=rows,eligible=len(ids)))

    @lru_cache(maxsize=32)
    def stock(self,code,start,end,w=1,mode='dynamic'):
        a,b=self.bounds(start,end)
        if code not in self.code_index:
            raise ValueError('未知股票。')
        i=self.code_index[code]; c=self.close[:,i]
        base=c[a]
        path=(c[a:b+1]/base-1)*100 if np.isfinite(base) else np.full(b-a+1,np.nan)
        peak=np.maximum.accumulate(np.where(np.isfinite(c),c,-np.inf))
        return clean(dict(**self.stocks[i],dates=self.dates[a:b+1],close=c[a:b+1],path=path,
                          open=self.open[a:b+1,i],high=self.high[a:b+1,i],low=self.low[a:b+1,i],volume=self.volume[a:b+1,i],volume_unit='万股',
                          ma5=rolling(c,5).ravel()[a:b+1],ma10=rolling(c,10).ravel()[a:b+1],
                          daily=self.ret[a:b+1,i],quoted=self.quoted[a:b+1,i],ma20=self.ma20[a:b+1,i],
                          drawdown=(c[a:b+1]/peak[a:b+1]-1)*100,amount=self.amount[a:b+1,i],
                          turnover=self.turnover[a:b+1,i]))

    @lru_cache(maxsize=4)
    def industry_history(self,name,start,end,w=1,mode='dynamic'):
        """Precompute selected industry's history once; replay needs no per-frame requests."""
        a,b=self.bounds(start,end)
        if name not in self.groups: raise ValueError('未知行业。')
        allowed=set(self.cohort(a,b,mode).tolist())
        ids=[i for i in self.groups[name] if i in allowed]
        if not ids: return dict(name=name,dates=self.dates[a:b+1],stocks=[],eligible=0)
        c=self.close[:,ids]
        with np.errstate(divide='ignore',invalid='ignore'):
            momentum=(c/np.roll(c,w,axis=0)-1)*100
        momentum[:w]=np.nan
        full=rolling(np.isfinite(c).astype(float),w+1,'sum')==w+1
        momentum[~full]=np.nan
        vol=rolling(self.ret[:,ids],20,'std')*np.sqrt(252)
        peak=np.maximum.accumulate(np.where(np.isfinite(c),c,-np.inf),axis=0)
        dd=(c/peak-1)*100
        rows=[]
        for j,i in enumerate(ids):
            base=c[a,j]
            path=(c[a:b+1,j]/base-1)*100 if np.isfinite(base) else np.full(b-a+1,np.nan)
            rows.append(dict(**self.stocks[i],tracks=dict(path=path,momentum=momentum[a:b+1,j],vol=vol[a:b+1,j],
                drawdown=dd[a:b+1,j],price=c[a:b+1,j],daily=self.ret[a:b+1,i],amount=self.amount[a:b+1,i],turnover=self.turnover[a:b+1,i])))
        return clean(dict(name=name,dates=self.dates[a:b+1],stocks=rows,eligible=len(ids)))
