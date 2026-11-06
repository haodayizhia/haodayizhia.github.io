"""Cloud fetch -> strict validation -> public snapshot. No local Windows dependency."""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import sys
from export import export
from package import ROOT
from merge_stocks import merge_stock_data, START_DATE


def run(probe_only=False):
    if not os.environ.get('TUSHARE_TOKEN'):
        raise RuntimeError('Configure the repository secret TUSHARE_TOKEN before fetching.')
    raw=(ROOT/'.market-atlas/raw/stock_data').resolve()
    raw.mkdir(parents=True,exist_ok=True)
    os.environ['MARKET_ATLAS_RAW_DIR']=str(raw)
    os.environ['MARKET_ATLAS_POOL_FILE']=str(Path(__file__).with_name('cloud-pool.csv'))
    os.environ['MARKET_ATLAS_INDUSTRY_FILE']=str(Path(__file__).with_name('cloud-industries.csv'))
    spec=importlib.util.spec_from_file_location('cloud_fetch_stocks',Path(__file__).with_name('fetch_stocks.py'))
    fetch=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fetch)
    if probe_only:
        print(json.dumps(dict(probe='ok',latest=fetch.REAL_END_DATE),ensure_ascii=False))
        return
    fetch.main()  # Raises if any stock failed; no partial public snapshot.
    # Keep the original merge script's publication window; older raw history warms indicators.
    merged=ROOT/'.market-atlas/merged_stock_data.csv'
    if merge_stock_data(str(raw),str(merged),START_DATE,None) is not True:
        raise RuntimeError('Merged CSV validation failed; the public snapshot was preserved.')
    report=export(merged)
    if report['dates'][-1].replace('-','') != fetch.REAL_END_DATE:
        raise RuntimeError('The fetched dataset did not reach the latest probed trading day.')
    print(json.dumps(dict(latest=report['dates'][-1],stocks=len(report['stocks']),revision=report['revision']),ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe-only',action='store_true')
    args=parser.parse_args()
    try:run(args.probe_only)
    except Exception as error:
        print('CLOUD UPDATE FAILED: '+str(error),file=sys.stderr)
        sys.exit(1)
