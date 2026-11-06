"""Package tracked monthly float32 data for Pages. Standard library only."""
from pathlib import Path
import gzip
import hashlib
import json
import os
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'data-source/market-atlas'
TARGET = ROOT / 'resources/market-atlas/data'


def replace_directory(staged, target):
    """Switch only a validated dataset, restoring the previous one if rename fails."""
    backup = target.with_name(target.name + '.previous')
    if backup.exists():
        raise RuntimeError(f'Previous interrupted update needs review: {backup}')
    existed = target.exists()
    if existed:
        os.replace(target, backup)
    try:
        os.replace(staged, target)
    except BaseException:
        if existed:
            os.replace(backup, target)
        raise
    if existed:
        shutil.rmtree(backup)


def package(source=SOURCE, target=TARGET):
    manifest_path = source / 'manifest.json'
    if not manifest_path.exists():
        raise RuntimeError('MarketAtlas source data is missing; run scripts/market_atlas/update.py first.')
    meta = json.loads(manifest_path.read_text(encoding='utf-8'))
    if meta.get('format') != 1 or len(meta.get('fields', [])) != 9:
        raise ValueError('Unsupported MarketAtlas data format.')
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.atlas-package-', dir=target.parent))
    try:
        chunks = []
        position = 0
        for entry in meta['chunks']:
            name = entry['file']
            if Path(name).name != name or not name.endswith('.bin'):
                raise ValueError('Invalid source chunk path.')
            raw = (source / name).read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if entry['start'] != position or len(raw) != entry['count'] * len(meta['stocks']) * 9 * 4 or digest != entry['sha256']:
                raise ValueError('MarketAtlas chunk integrity check failed: ' + name)
            filename = Path(name).stem + '.' + digest[:16] + '.bin.gz'
            zipped = gzip.compress(raw, compresslevel=6, mtime=0)
            (staging / filename).write_bytes(zipped)
            chunks.append(dict(entry, file=filename, bytes=len(zipped)))
            position += entry['count']
        if position != len(meta['dates']):
            raise ValueError('MarketAtlas trading days are incomplete.')
        meta['chunks'] = chunks
        (staging / 'manifest.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n', encoding='utf-8')
        replace_directory(staging, target)
        print(f'MarketAtlas: {len(meta["stocks"]):,} stocks, {len(meta["dates"])} sessions, {sum(c["bytes"] for c in chunks)/1024**2:.1f} MiB compressed; through {meta["dates"][-1]}.')
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return meta


if __name__ == '__main__':
    package()
