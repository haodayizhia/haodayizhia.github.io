"""A corrupt update must never replace a working public snapshot."""
from pathlib import Path
import gzip
import hashlib
import json
import struct
import tempfile
import unittest
from package import package


class PackagingTests(unittest.TestCase):
    def test_round_trip_and_failed_update_retains_previous_data(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory)
            source=base/'source';source.mkdir()
            target=base/'public'
            raw=struct.pack('<18f',*range(18))
            (source/'2026-01.bin').write_bytes(raw)
            meta=dict(format=1,fields=list('abcdefghi'),stocks=[{'code':'000001.SZ'}],dates=['2026-01-05','2026-01-06'],
                chunks=[dict(file='2026-01.bin',start=0,count=2,sha256=hashlib.sha256(raw).hexdigest())])
            (source/'manifest.json').write_text(json.dumps(meta),encoding='utf-8')
            result=package(source,target)
            public=(target/'manifest.json').read_bytes()
            self.assertEqual(gzip.decompress((target/result['chunks'][0]['file']).read_bytes()),raw)
            (source/'2026-01.bin').write_bytes(b'corrupt')
            with self.assertRaises(ValueError):package(source,target)
            self.assertEqual((target/'manifest.json').read_bytes(),public)
            meta['chunks'][0]['file']='../outside.bin'
            (source/'manifest.json').write_text(json.dumps(meta),encoding='utf-8')
            with self.assertRaises(ValueError):package(source,target)
            self.assertEqual((target/'manifest.json').read_bytes(),public)


if __name__=='__main__':unittest.main()
