"""Refresh deterministic browser parity cases against the original Python model."""
from pathlib import Path
import tempfile
import json
import numpy as np
import pandas as pd
from model import MarketData, ARRAY_FIELDS, clean

def main():
    with tempfile.TemporaryDirectory() as directory:
        source=Path(directory)
        dates=pd.bdate_range('2026-01-05',periods=72)
        for index,code in enumerate(['000001.SZ','000002.SZ','600001.SH','830001.BJ']):
            price=10+index*8+np.sin(np.arange(72)/4+index)*2+np.arange(72)*.13
            frame=pd.DataFrame({'代码':code,'名称':'股票'+str(index),'交易日期':dates.strftime('%Y%m%d'),'所属行业':['甲','甲','乙','丙'][index],
                '现价':price,'涨幅%':.2,'成交额(亿元)':np.arange(72)*.05,'换手率':1.5,'MA20':price*.97,
                '开盘价':price*.99,'最高价':price*1.02,'最低价':price*.98,'成交量(万股)':100.})
            if index==1:frame.loc[[9,10,24],'现价']=np.nan
            if index==2:frame=frame.iloc[7:].copy()
            if index==3:frame=frame.drop([2,11,71])
            frame.to_csv(source/(code+'.csv'),index=False,encoding='utf-8-sig')
        m=MarketData(source)
        meta=m.metadata();meta['source']='fixture';meta['quality']['load_seconds']=0
        cases=[]
        for w,mode,a in [(1,'dynamic',0),(5,'dynamic',3),(20,'dynamic',20),(60,'dynamic',0),(5,'complete',3),(1,'complete',30)]:
            q=dict(start=m.dates[a],end=m.dates[-1],window=w,mode=mode)
            cases.append(dict(path='/api/market',query=q,result=m.market(q['start'],q['end'],w,mode)))
        q=dict(start=m.dates[3],end=m.dates[-1],window=5,mode='dynamic')
        for name in m.groups:
            cases.append(dict(path='/api/industry-history',query=dict(q,name=name),result=m.industry_history(name,q['start'],q['end'],5)))
            cases.append(dict(path='/api/industry',query=dict(q,name=name,asof=m.dates[40]),result=m.industry(name,q['start'],q['end'],5,'dynamic',m.dates[40])))
        for stock in m.stocks:
            cases.append(dict(path='/api/stock',query=dict(q,code=stock['code']),result=m.stock(stock['code'],q['start'],q['end'],5)))
        fixture=dict(meta=meta,arrays={k:[float(v) if np.isfinite(v) else None for v in getattr(m,k).ravel()] for k in ARRAY_FIELDS},cases=cases)
        target=Path(__file__).with_name('parity-fixture.json')
        target.write_text(json.dumps(fixture,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
        print('Wrote',len(cases),'Python/browser parity cases.')

if __name__=='__main__':main()
