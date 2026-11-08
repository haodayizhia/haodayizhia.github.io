"""Use the original MarketAtlas reader; export only chart fields, never entire CSVs."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import shutil
import tempfile
import numpy as np
from model import MarketData, ARRAY_FIELDS, clean
from package import ROOT, SOURCE, replace_directory


def export(source, *, allow_older=False):
    model = MarketData(Path(source))
    checks = (
    'errors',
    'schema_errors',
    'invalid_codes',
    'invalid_dates',
    'duplicate_rows',
    )

    issues = {
        key: model.quality.get(key)
        for key in checks
        if model.quality.get(key)
    }

    if issues:
        raise ValueError(
            '数据校验失败，停止发布：' +
            json.dumps(clean(issues), ensure_ascii=False)[:1600]
        )
    if not model.quality['return_observations']:
        raise ValueError('There are no consecutive valid price observations.')
    old = json.loads((SOURCE/'manifest.json').read_text(encoding='utf-8')) if (SOURCE/'manifest.json').exists() else None
    if old and model.dates[0] > old['dates'][0] and not allow_older:
        raise ValueError(
            '新数据起始日期晚于已发布数据，拒绝缩短历史范围。'
        )
    if old and model.dates[-1] < old['dates'][-1] and not allow_older:
        raise ValueError('This data is older than the published snapshot. Use --allow-older only for an intentional replacement.')
    quality = dict(model.quality)
    quality.pop('cache_hit', None)
    quality.pop('load_seconds', None)
    meta = clean(dict(format=1, fields=ARRAY_FIELDS, dates=model.dates, stocks=model.stocks, quality=quality,
                      source='网站公开行情', source_kind='public'))
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.atlas-export-', dir=SOURCE.parent))
    try:
        chunks = []
        months = dict.fromkeys(d[:7] for d in model.dates)
        for month in months:
            ids = [i for i,d in enumerate(model.dates) if d.startswith(month)]
            # Field-major, then date-major, then stock; explicit little endian.
            raw = b''.join(np.asarray(getattr(model, field)[ids, :], dtype='<f4').tobytes(order='C') for field in ARRAY_FIELDS)
            digest = hashlib.sha256(raw).hexdigest()
            filename = month+'.bin'
            (staging/filename).write_bytes(raw)
            chunks.append(dict(file=filename, start=ids[0], count=len(ids), sha256=digest))
        meta['chunks'] = chunks
        revision = hashlib.sha256(json.dumps(meta, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()
        meta['revision'] = revision
        meta['generated_at'] = old['generated_at'] if old and old.get('revision') == revision else datetime.now(timezone.utc).isoformat(timespec='seconds')
        (staging/'manifest.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n', encoding='utf-8')
        replace_directory(staging, SOURCE)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    print(f'Exported {len(model.stocks):,} stocks, {len(model.dates)} sessions; latest {model.dates[-1]}.')
    return meta
