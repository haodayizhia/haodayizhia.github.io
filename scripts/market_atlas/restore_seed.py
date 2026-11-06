"""Safely restore only stock CSVs from the owner-provided cloud seed archive."""
from pathlib import Path
import argparse
import re
import tarfile
import hashlib
import json
from package import ROOT

def restore(archive,target,checksum=None):
    if checksum:
        expected=json.loads(Path(checksum).read_text(encoding='utf-8'))
        with Path(archive).open('rb') as source:
            if hashlib.file_digest(source,'sha256').hexdigest()!=expected['sha256']:
                raise ValueError('Seed archive checksum mismatch.')
    target=Path(target).resolve()
    target.mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive,'r:gz') as bundle:
        members=bundle.getmembers()
        if len(members)>15000 or sum(m.size for m in members)>3*1024**3:
            raise ValueError('Seed archive exceeds the expected data capacity.')
        for member in members:
            if not member.isfile() or not re.fullmatch(r'\d{6}\.(?:SH|SZ|BJ)\.csv',member.name):
                raise ValueError('Seed archive contains an unexpected path.')
        for member in members:
            source=bundle.extractfile(member)
            destination=target/member.name
            with source,destination.open('wb') as output:
                while block:=source.read(1024*1024):output.write(block)
    print(f'Restored {len(members)} stock CSVs into the cloud cache.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive');parser.add_argument('--target',default=str(ROOT/'.market-atlas/raw/stock_data'))
    parser.add_argument('--checksum')
    args=parser.parse_args();restore(args.archive,args.target,args.checksum)
