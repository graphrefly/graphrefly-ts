"""Separate arithmetic path; no imports from analyze.py and no consumer execution."""
import json
import math
from pathlib import Path
import statistics
import sys
import tarfile

report = json.loads(Path(sys.argv[1]).read_text())
rows = []
with tarfile.open(Path(sys.argv[2]) / 'evidence.tar.gz') as archive:
    for member in archive:
        if not member.name.endswith('/samples.jsonl'):
            continue
        position = int(member.name.split('/')[1].split('-')[0])
        groups = {}
        for line in archive.extractfile(member):
            sample = json.loads(line)
            if sample['phase'] == 'measured':
                groups.setdefault((sample['batch'], sample['arm']), []).append(sample['ms'])
        for (batch, arm), values in groups.items():
            assert len(values) == 300
            actual = dict(process=position, batch=batch, arm=arm,
                          p50=statistics.median(values), p95=sorted(values)[math.ceil(.95*len(values))-1])
            expected = next(b for b in report['blocks'] if (b['process'], b['batch'], b['arm']) == (position, batch, arm))
            assert actual['p95'] == expected['p95'] and actual['p50'] == expected['p50']
            rows.append(actual)
assert len(rows) == 240
for metric in ('p50', 'p95'):
    assert sum(r['process'] < 20 for r in sorted(rows, key=lambda r: r[metric], reverse=True)[:24]) == 24
for half in report['chronologicalHalves']:
    group = [r for r in rows if half['processes'][0] <= r['process'] <= half['processes'][1]]
    for metric in ('p50', 'p95'):
        assert statistics.median(r[metric] for r in group) == half['blockMetrics'][metric]['median']
print(json.dumps(dict(blocksIndependentlyCrossChecked=240, topDecileAndHalfMediansIndependentlyMatch=True,
                      newConsumerExecutions=0, newMeasurements=0), indent='\t'))
