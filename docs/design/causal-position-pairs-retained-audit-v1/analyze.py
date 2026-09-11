"""Read-only descriptive audit of the immutable D169 attempt; never runs a consumer.

Print JSON to stdout. Chronological halves, top decile and 50-sample windows are
post-hoc descriptions, not new acceptance criteria, exclusions or significance tests.
"""
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
import tarfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def spread(values):
    return dict(min=min(values), median=statistics.median(values), max=max(values))


archive = Path(sys.argv[1])
assert digest((archive / 'evidence.tar.gz').read_bytes()) == '6e6c00fc5c6be7ab7e6ee950c7f7540d952511333af3f1b750abbe648f808799'
assert digest((archive / 'artifact-index.json').read_bytes()) == '54511a0da2f563cccb10b0d7d81dd8183781b3397867de03689a1a6585a70865'
index = json.loads((archive / 'artifact-index.json').read_text())['files']
raw = {}
with tarfile.open(archive / 'evidence.tar.gz') as stream:
    for member in stream.getmembers():
        assert member.isfile() and member.name in index and member.name not in raw
        data = stream.extractfile(member).read()
        assert 'sha256:' + digest(data) == index[member.name]
        raw[member.name] = data
assert set(raw) == set(index) and len(raw) == 635
read = lambda name: json.loads(raw['run/' + name])
result = read('result.json')
assert result['status'] == 'method-not-qualified' and result['samples'] == 96000
assert result['attempted'] == list(range(40)) and result['notRun'] == list(range(40, 80))
blocks, processes = [], []
for row in result['rows']:
    directory = f"{row['position']:02d}-Z-{row['pair']:02d}-{row['orientation']}"
    samples = [json.loads(line) for line in raw[f'run/{directory}/samples.jsonl'].splitlines()]
    exit_record = read(directory + '/exit.json')
    assert len(samples) == 2400
    for number in range(6):
        full = samples[number * 400:(number + 1) * 400]
        selected = full[100:]
        batch, slot = divmod(number, 2)
        first = 'candidate' if (batch != 1) == (row['orientation'] == 'U') else 'reference'
        arm = first if slot == 0 else ('reference' if first == 'candidate' else 'candidate')
        for i, sample in enumerate(full):
            assert (sample['batch'], sample['arm'], sample['index'], sample['phase']) == (batch, arm, i, 'warmup' if i < 100 else 'measured')
            assert math.isfinite(sample['ms']) and sample['ms'] == sample['end'] - sample['start'] >= 0
        values = sorted(x['ms'] for x in selected)
        assert values[284] == row['p95'][arm][batch]
        blocks.append(dict(process=row['position'], pair=row['pair'], category=row['category'], orientation=row['orientation'], batch=batch, slot=slot, arm=arm,
                           p50=statistics.median(values), p90=values[269], p95=values[284], p99=values[296], maximum=values[-1],
                           windowMedians=[statistics.median(x['ms'] for x in selected[i:i+50]) for i in range(0, 300, 50)],
                           heapUsedDecreases=sum(x['memoryAfter']['heapUsed'] < x['memoryBefore']['heapUsed'] for x in selected),
                           rssRangeBytes=spread([x['memoryBefore']['rss'] for x in selected]),
                           heapTotalRangeBytes=spread([x['memoryBefore']['heapTotal'] for x in selected])))
    gaps = [samples[i+1]['start'] - x['end'] for i, x in enumerate(samples[:-1]) if samples[i+1]['index'] == x['index'] + 1]
    assert len(gaps) == 2394 and min(gaps) >= 0
    log = raw[f'run/{directory}/stdout.log'].decode()
    processes.append(dict(process=row['position'], orientation=row['orientation'],
                          elapsedSeconds=exit_record['endMonotonic'] - exit_record['startMonotonic'],
                          allConstructionMs=sum(x['ms'] for x in samples),
                          withinBlockGapMs=dict(p50=statistics.median(gaps), p95=sorted(gaps)[math.ceil(len(gaps)*.95)-1]),
                          maxRssBytes=max(x['memoryAfter']['rss'] for x in samples),
                          logBytes=len(raw[f'run/{directory}/stdout.log']),
                          bailoutLines=sum('[bailout ' in line for line in log.splitlines()),
                          dependentCodeMarkingLines=sum('[marking dependent code ' in line for line in log.splitlines())))

pairs = []
for pair in result['pairs']:
    group = [b for b in blocks if b['pair'] == pair['pair']]
    summary = dict(pair=pair['pair'], category=pair['category'], firstOrientation=pair['firstOrientation'])
    for metric in ('p50', 'p95'):
        q = {}
        for slot, name in enumerate(('first', 'second')):
            q[name] = []
            for batch in range(3):
                by_arm = {b['arm']: b[metric] for b in group if b['slot'] == slot and b['batch'] == batch}
                assert len(by_arm) == 2
                q[name].append(by_arm['candidate'] / by_arm['reference'])
        g = {name: statistics.median(values) for name, values in q.items()}
        summary[metric] = dict(q=q, g=g)
        if metric == 'p95':
            assert q == pair['q'] and g == pair['g'] and max(g.values()) == pair['T']
    pairs.append(summary)

halves = []
for start in (0, 20):
    bs = [b for b in blocks if start <= b['process'] < start + 20]
    ps = processes[start:start+20]
    halves.append(dict(processes=[start, start+19], blockCount=len(bs),
                       blockMetrics={metric: spread([b[metric] for b in bs]) for metric in ('p50','p95')},
                       medianProcessElapsedSeconds=statistics.median(p['elapsedSeconds'] for p in ps),
                       medianWithinBlockGapP50Ms=statistics.median(p['withinBlockGapMs']['p50'] for p in ps),
                       medianWithinBlockGapP95Ms=statistics.median(p['withinBlockGapMs']['p95'] for p in ps),
                       maxRssBytes=spread([p['maxRssBytes'] for p in ps]),
                       bailoutLines=spread([p['bailoutLines'] for p in ps])))
top = {}
for metric in ('p50', 'p95'):
    ranked = sorted(blocks, key=lambda b: (-b[metric], b['process'], b['batch'], b['slot']))[:24]
    top[metric] = dict(count=24, fromFirst20Processes=sum(b['process'] < 20 for b in ranked),
                       coordinates=[[b['process'], b['batch'], b['slot']] for b in ranked],
                       metricRange=spread([b[metric] for b in ranked]),
                       blocksWithoutObservedHeapUsedDecrease=sum(b['heapUsedDecreases'] == 0 for b in ranked))
assert len(blocks) == 240 and len(processes) == 40 and len(pairs) == 20
report = dict(kind='post-hoc descriptive retained-data audit; no acceptance change', verifiedArchiveFiles=635,
              retainedSamples=96000, measuredSamples=72000, newMeasurements=0,
              originalVerdict=result['status'], originalNotRun=result['notRun'],
              initialLoadAverage=read('reservation.json')['loadAverage'],
              chronologicalHalves=halves, largestDecile=top, blocks=blocks, processes=processes, pairs=pairs,
              limits=['No IID or causal conclusion from post-hoc halves or ranks.',
                      'p50 ratios are descriptive, never replace the p95 criterion.',
                      'A heapUsed decrease is a boundary observation, not a calibrated GC event.',
                      'Inter-sample gap includes harness, cleanup, event-loop and unmeasured work; no component timing attribution.',
                      'Native event clocks remain uncalibrated. No CPU-time, scheduling or thermal observation is available.'])
print(json.dumps(report, indent='\t', allow_nan=False))
