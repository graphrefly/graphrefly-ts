#!/usr/bin/env python3
"""Independent child-artifact arithmetic; never starts a consumer or proves run authority."""
import argparse
import hashlib
import json
import math
import statistics
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value, label):
    require(type(value) in (int, float) and math.isfinite(value) and value >= 0, label)
    return value


def integer(value, label):
    number(value, label)
    require(type(value) is int, label)
    return value


def union_overlap(intervals, windows):
    """Measure union of event intersections with a union of target windows, in ms."""
    pieces = sorted((max(a, c), min(b, d)) for a, b in intervals for c, d in windows
                    if max(a, c) < min(b, d))
    total = 0.0
    right = -1.0
    for left, end in pieces:
        total += max(0, end - max(left, right))
        right = max(right, end)
    return total


def verify(samples, diagnostic):
    require(isinstance(diagnostic, dict), 'diagnostic object')
    require(set(diagnostic) == {'condition', 'orientation', 'checkpoints', 'gc',
                               'disconnectAt', 'observerInstalled'}, 'diagnostic fields')
    condition, orientation = diagnostic['condition'], diagnostic['orientation']
    require(condition in ('BASE', 'CPU', 'CPU_GC'), 'condition')
    require(orientation in ('U', 'V'), 'orientation')
    require(type(diagnostic['observerInstalled']) is bool, 'observer flag')
    require(diagnostic['observerInstalled'] == (condition == 'CPU_GC'), 'observer condition')
    orders = [['candidate', 'reference'], ['reference', 'candidate'], ['candidate', 'reference']]
    if orientation == 'V':
        orders = [list(reversed(order)) for order in orders]
    require(isinstance(samples, list) and len(samples) == 2400, '2400 samples required')
    coords = [(batch, arm, index) for batch, order in enumerate(orders)
              for arm in order for index in range(400)]
    prior_end = 0
    for sample, (batch, arm, index) in zip(samples, coords):
        require(isinstance(sample, dict), 'sample object')
        require(all(key in sample for key in ('batch', 'arm', 'index', 'phase', 'start', 'end', 'ms')),
                'sample fields')
        require(integer(sample['batch'], 'batch') == batch and sample['arm'] == arm and
                integer(sample['index'], 'index') == index, 'sample coordinate/order')
        require(sample['phase'] == ('warmup' if index < 100 else 'measured'), 'sample phase')
        start, end, ms = (number(sample[key], key) for key in ('start', 'end', 'ms'))
        require(prior_end <= start <= end, 'sample time order')
        require(math.isclose(ms, end - start, rel_tol=1e-9, abs_tol=1e-8), 'sample duration')
        prior_end = end
    checkpoints = diagnostic['checkpoints']
    require(isinstance(checkpoints, list), 'checkpoint array')
    require(len(checkpoints) == (0 if condition == 'BASE' else 18), 'checkpoint count')
    previous = None
    for i, cp in enumerate(checkpoints):
        require(isinstance(cp, dict) and set(cp) == {'batch', 'arm', 'edge', 'wallBefore',
                                                    'wallAfter', 'user', 'system'}, 'checkpoint fields')
        block, edge = divmod(i, 3)
        batch, position = divmod(block, 2)
        require(integer(cp['batch'], 'checkpoint batch') == batch and
                cp['arm'] == orders[batch][position] and
                cp['edge'] == ('warmup', 'measured', 'end')[edge], 'checkpoint coordinate/order')
        before, after = (number(cp[key], key) for key in ('wallBefore', 'wallAfter'))
        require(before <= after, 'checkpoint wall bounds')
        for key in ('user', 'system'):
            integer(cp[key], 'CPU cumulative integer microseconds')
        if previous:
            require(previous['wallAfter'] <= before, 'checkpoint chronological')
            require(all(previous[key] <= cp[key] for key in ('user', 'system')), 'CPU monotonic')
        previous = cp
        subset = samples[block * 400:(block + 1) * 400]
        if edge == 0:
            require(after <= subset[0]['start'], 'warmup checkpoint precedes samples')
        elif edge == 1:
            require(subset[99]['end'] <= before <= after <= subset[100]['start'],
                    'measured checkpoint boundary')
        else:
            require(subset[-1]['end'] <= before, 'end checkpoint follows samples')
        if edge == 0 and block:
            require(samples[block * 400 - 1]['end'] <= before, 'checkpoint after preceding block')
    events = diagnostic['gc']
    require(isinstance(events, list) and len(events) < 100000, 'GC event buffer limit')
    intervals = []
    if condition != 'CPU_GC':
        require(events == [] and diagnostic['disconnectAt'] is None, 'no GC outside observer condition')
    else:
        disconnect = number(diagnostic['disconnectAt'], 'disconnectAt required')
        require(disconnect >= max(samples[-1]['end'], checkpoints[-1]['wallAfter']), 'disconnect boundary')
        prior_received = 0
        for event in events:
            require(isinstance(event, dict) and set(event) == {'startTime', 'duration', 'receivedAt',
                                                               'kind', 'flags'}, 'GC fields')
            start, duration, received = (number(event[key], key)
                                        for key in ('startTime', 'duration', 'receivedAt'))
            integer(event['kind'], 'GC kind')
            integer(event['flags'], 'GC flags')
            require(start + duration <= received <= disconnect, 'GC event/receipt bounds')
            require(prior_received <= received, 'GC callback receipt order')
            prior_received = received
            intervals.append((start, start + duration))
    blocks = []
    for block in range(6):
        batch, position = divmod(block, 2)
        for phase, low, high in [('warmup', 0, 100), ('measured', 100, 400)]:
            subset = samples[block * 400 + low:block * 400 + high]
            durations = sorted(sample['ms'] for sample in subset)
            start, end = subset[0]['start'], subset[-1]['end']
            total = math.fsum(durations)
            result = {'batch': batch, 'position': position, 'arm': orders[batch][position],
                      'phase': phase, 'count': len(subset),
                      'p50Ms': statistics.median(durations),
                      'p95Ms': durations[math.ceil(len(subset) * .95) - 1],
                      'constructionSumMs': total, 'commonSpanMs': end - start,
                      'otherCommonSpanMs': end - start - total,
                      'checkpoint': None, 'gc': None}
            if checkpoints:
                edge = 0 if phase == 'warmup' else 1
                begin, finish = checkpoints[block * 3 + edge:block * 3 + edge + 2]
                result['checkpoint'] = {
                    'elapsedLowerMs': finish['wallBefore'] - begin['wallAfter'],
                    'elapsedUpperMs': finish['wallAfter'] - begin['wallBefore'],
                    'userMs': (finish['user'] - begin['user']) / 1000,
                    'systemMs': (finish['system'] - begin['system']) / 1000}
            if condition == 'CPU_GC':
                result['gc'] = {
                    'commonSpanOverlapMs': union_overlap(intervals, [(start, end)]),
                    'constructionOverlapMs': union_overlap(intervals, [(s['start'], s['end']) for s in subset]),
                    'checkpointOverlapLowerMs': union_overlap(intervals, [(begin['wallAfter'], finish['wallBefore'])]),
                    'checkpointOverlapUpperMs': union_overlap(intervals, [(begin['wallBefore'], finish['wallAfter'])])}
            blocks.append(result)
    return {'schema': 'causal-workload-child-analysis-v1', 'condition': condition,
            'orientation': orientation, 'sampleCount': 2400, 'measuredBlockCount': 6,
            'estimators': {'p50': 'median; average of middle two for even count',
                           'p95': 'nearest rank ceil(0.95*n), one-based'},
            'scope': 'Child arithmetic only; no source, process identity, cleanup, execution authorization, '
                     '24-process schedule or resource qualification. GC is a captured subset; empty is not no GC. '
                     'CPU is process-wide; elapsed minus CPU is not waiting time.',
            'blocks': blocks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('samples', type=Path)
    parser.add_argument('diagnostic', type=Path)
    args = parser.parse_args()
    samples_raw, diagnostic_raw = args.samples.read_bytes(), args.diagnostic.read_bytes()
    result = verify([json.loads(line) for line in samples_raw.splitlines()], json.loads(diagnostic_raw))
    result['inputSha256'] = {'samples': hashlib.sha256(samples_raw).hexdigest(),
                             'diagnostic': hashlib.sha256(diagnostic_raw).hexdigest()}
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
