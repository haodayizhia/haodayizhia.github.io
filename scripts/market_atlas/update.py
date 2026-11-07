"""Merge the owner's existing CSVs, validate, export, build and optionally publish."""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import subprocess
import sys
from export import export
from package import ROOT
from publish import Publisher

DEFAULT_MERGE=Path.home()/'Documents/BaiduSyncdisk/Code/Python/Money/TushareTools/find_factor/merge_stocks.py'


def run(args):
    publisher=None
    if args.publish:
        publisher=Publisher(ROOT)
        if publisher.git('status','--porcelain').strip():
            raise RuntimeError('The website has uncommitted changes. Commit or review them before updating public data.')
        remote=publisher.remote_head()
        current=publisher.git('rev-parse','HEAD').strip()
        if remote != current:
            parent=publisher.git('rev-parse','HEAD^').strip()
            title=publisher.git('log','-1','--format=%s').strip()
            if remote==parent and title.startswith('Update MarketAtlas data through '):
                # Retry only a previously generated data-only commit after a network failure.
                publisher.publish_head(lambda name:name.startswith('data-source/market-atlas/'))
            else:
                raise RuntimeError('Local main differs from GitHub. Synchronize before publishing; no remote files were changed.')
    if args.source:
        source=Path(args.source).resolve()
        if not source.exists():
            raise ValueError('The CSV or directory does not exist.')
    else:
        script=Path(args.merge_script).resolve()
        if not script.is_file():
            raise ValueError('merge_stocks.py was not found. Specify --merge-script.')
        spec=importlib.util.spec_from_file_location('owner_merge_stocks',script)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        # The original script returns False on validation errors but exits with code 0.
        # Check its actual result rather than accepting a successful process exit.
        if module.merge_stock_data(module.INPUT_FOLDER,module.OUTPUT_FILE,module.START_DATE,module.END_DATE) is not True:
            raise RuntimeError('merge_stocks.py reported a failure. Existing website data was preserved.')
        source=Path(module.OUTPUT_FILE)
    meta=export(source,allow_older=args.allow_older)
    subprocess.run([sys.executable,str(ROOT/'scripts/build.py')],cwd=ROOT,check=True)
    subprocess.run(['node','--test',str(ROOT/'scripts/theme.test.cjs'),str(ROOT/'scripts/market_atlas/engine.test.cjs'),str(ROOT/'scripts/market_atlas/publish.test.cjs'),str(ROOT/'scripts/market_atlas/ui.test.cjs')],cwd=ROOT,check=True)
    if publisher:
        subprocess.run(['git','-C',str(ROOT),'add','--','data-source/market-atlas'],check=True)
        if subprocess.run(['git','-C',str(ROOT),'diff','--cached','--quiet']).returncode==0:
            print('No new data; public snapshot is already current.')
        else:
            subprocess.run(['git','-C',str(ROOT),'commit','-m',f'Update MarketAtlas data through {meta["dates"][-1]}'],check=True)
            sha=publisher.publish_head(lambda name:name.startswith('data-source/market-atlas/'))
            print('Published commit '+sha+'; GitHub Pages deployment is now running.')
    print(json.dumps(dict(latest=meta['dates'][-1],stocks=len(meta['stocks']),sessions=len(meta['dates']),revision=meta['revision']),ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',help='An explicitly selected merged CSV or per-stock CSV directory; skips merging.')
    parser.add_argument('--merge-script',default=str(DEFAULT_MERGE))
    parser.add_argument('--publish',action='store_true',help='Commit validated chart data and publish without force-pushing.')
    parser.add_argument('--allow-older',action='store_true',help='Intentionally replace a newer snapshot with older data.')
    args=parser.parse_args()
    try:
        run(args)
    except Exception as error:
        print('UPDATE FAILED: '+str(error),file=sys.stderr)
        sys.exit(1)
