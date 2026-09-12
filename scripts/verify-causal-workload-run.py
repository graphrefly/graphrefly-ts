#!/usr/bin/env python3
"""Offline complete-run verification and descriptive instrumentation ratios; no execution."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

_spec = importlib.util.spec_from_file_location('child_verifier', Path(__file__).with_name('verify-causal-workload-diagnostic.py'))
_child = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_child)
require = _child.require
number = _child.number
FLAGS = ['--trace-gc', '--trace-deopt', '--log-deopt', '--no-logfile-per-isolate', '--logfile=v8.log']


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_file(root, relative):
    require(isinstance(relative, str), 'source path string')
    path = Path(relative)
    require(not path.is_absolute() and '..' not in path.parts, 'source path contained')
    require(not (root / path).is_symlink(), 'source is not symlink')
    resolved = (root / path).resolve()
    require(resolved.is_relative_to(root.resolve()) and resolved.is_file(), 'source file contained')
    return resolved


def verify(root):
    root = Path(root)
    reservation, result = read(root / 'reservation.json'), read(root / 'result.json')
    require(result.get('completed') is True and result.get('notRun') == [], 'complete run required')
    jobs = reservation['jobs']
    require(len(jobs) == 24, '24 jobs')
    expected = {(r, c, o) for r in range(4) for c in ('BASE', 'CPU', 'CPU_GC') for o in ('U', 'V')}
    coordinates = [(j['round'], j['condition'], j['orientation']) for j in jobs]
    require(all(type(j['round']) is int for j in jobs), 'integer round')
    require([j['round'] for j in jobs] == [i // 6 for i in range(24)], 'round blocks preserved')
    require(len(set(coordinates)) == 24 and set(coordinates) == expected, 'exact schedule coordinates')
    require(all(type(j['id']) is int for j in jobs) and [j['id'] for j in jobs] == list(range(24)), 'sequential job IDs')
    require(reservation['flags'] == FLAGS, 'frozen trace flags')
    require(isinstance(reservation['sourceDigests'], dict) and reservation['sourceDigests'], 'source digests')
    require({str(p.relative_to(root)) for p in (root / 'assets').rglob('*') if p.is_file()} ==
            set(reservation['sourceDigests']), 'complete prepared asset inventory')
    for name, sha in reservation['sourceDigests'].items():
        require(name.startswith('assets/'), 'prepared assets prefix')
        require(digest(safe_file(root, name)) == sha, 'source digest: ' + name)
    for name, key in [('approval.txt', 'approvalDigest'), ('qualification.json', 'qualificationDigest'),
                      ('P2-inputs.json', 'scenarioDigest')]:
        require(digest(root / name) == reservation[key], key)
    node_digest = reservation['nodeDigest']
    require(isinstance(node_digest, str) and len(node_digest) == 64 and
            all(c in '0123456789abcdef' for c in node_digest), 'node digest syntax')
    require(isinstance(result.get('children'), list) and len(result['children']) == 24, '24 result children')
    pids, origins, children, indexed = set(), set(), [], {}
    prior_end = 0
    for job, summary in zip(jobs, result['children']):
        directory = root / f"{job['id']:02d}"
        config, entry, outcome = (read(directory / name) for name in ('config.json', 'entry.json', 'exit.json'))
        require(summary == {'job': job, 'result': outcome}, 'aggregate child matches retained exit')
        require(all(config.get(key) == job[key] for key in ('id', 'round', 'condition', 'orientation')), 'config coordinates')
        require(config.get('kind') == 'control' and config.get('control') is True, 'reference control only')
        require(config.get('row') == {'id': 'cold-P2-summary', 'group': 'cold', 'profile': 'P2', 'mode': 'summary'}, 'fixed row')
        # Original absolute paths remain provenance after relocation; compare basenames only.
        require(Path(config['output']).name == f"{job['id']:02d}" and Path(config['scenarioPath']).name == 'P2-inputs.json', 'config destinations')
        pid = entry['pid']
        require(type(pid) is int and pid > 0 and pid not in pids, 'unique positive PID')
        origin = number(entry['timeOrigin'], 'timeOrigin')
        require(origin not in origins, 'unique timeOrigin')
        pids.add(pid)
        origins.add(origin)
        require(entry['node'] == 'v24.18.0' and entry['execArgv'] == FLAGS, 'Node and flags')
        require(outcome['pid'] == pid and outcome['exitCode'] == 0 and outcome['reason'] is None, 'successful child exit')
        completion = read(directory / 'completion.json')
        require(completion == {'completed': True, 'samples': 2400}, 'completion count')
        observations = outcome['observations']
        require(isinstance(observations, list) and observations, 'resource observations')
        previous_elapsed, previous_child = None, 0
        for observation in observations:
            elapsed, child_elapsed, gap, rss, size = (number(observation[key], key)
                for key in ('elapsed', 'childElapsed', 'gap', 'rssBytes', 'directoryBytes'))
            require(prior_end <= elapsed <= 900 and previous_child <= child_elapsed <= 30,
                    'serial elapsed/resource duration')
            require(gap <= 1 and rss <= 256 * 1024 ** 2 and size <= 256 * 1024 ** 2, 'resource stop bounds')
            if previous_elapsed is not None:
                require(0 <= elapsed - previous_elapsed <= 1, 'observed actual gap')
            previous_elapsed, previous_child = elapsed, child_elapsed
        ended = number(outcome['endedElapsed'], 'endedElapsed')
        require(previous_elapsed <= ended <= 900 and ended - previous_elapsed <= 1, 'end observation gap')
        require(ended - observations[0]['elapsed'] + observations[0]['childElapsed'] <= 30, 'complete child duration')
        prior_end = ended
        worker_path = directory / 'worker.json'
        require(worker_path.is_file(), 'worker metadata required')
        worker = read(worker_path)
        require(worker['pid'] == pid and worker['timeOrigin'] == origin, 'worker process identity')
        samples = [json.loads(line) for line in (directory / 'samples.jsonl').read_bytes().splitlines()]
        diagnostic = read(directory / 'diagnostic.json')
        require(diagnostic['condition'] == job['condition'] and diagnostic['orientation'] == job['orientation'], 'diagnostic coordinates')
        analysis = _child.verify(samples, diagnostic)
        children.append({'id': job['id'], 'round': job['round'], 'pid': pid, 'analysis': analysis})
        for block in analysis['blocks']:
            if block['phase'] == 'measured':
                indexed[(job['round'], job['condition'], job['orientation'], block['batch'], block['arm'])] = block
    ratios = []
    for round_id in range(4):
        for orientation in ('U', 'V'):
            for batch in range(3):
                for arm in ('candidate', 'reference'):
                    for numerator, denominator in [('CPU', 'BASE'), ('CPU_GC', 'CPU')]:
                        a, b = (indexed[(round_id, c, orientation, batch, arm)] for c in (numerator, denominator))
                        values = {}
                        for metric in ('p95Ms', 'constructionSumMs', 'commonSpanMs'):
                            require(b[metric] > 0, 'positive ratio denominator')
                            values[metric] = a[metric] / b[metric]
                        ratios.append({'round': round_id, 'orientation': orientation, 'batch': batch,
                                       'arm': arm, 'contrast': numerator + '/' + denominator, 'ratios': values})
    ranges = []
    for orientation in ('U', 'V'):
        for batch in range(3):
            for arm in ('candidate', 'reference'):
                for contrast in ('CPU/BASE', 'CPU_GC/CPU'):
                    rows = [r for r in ratios if (r['orientation'], r['batch'], r['arm'], r['contrast']) ==
                            (orientation, batch, arm, contrast)]
                    ranges.append({'orientation': orientation, 'batch': batch, 'arm': arm,
                                   'contrast': contrast, 'rounds': [r['round'] for r in rows],
                                   'ranges': {metric: [min(r['ratios'][metric] for r in rows),
                                                       max(r['ratios'][metric] for r in rows)]
                                              for metric in ('p95Ms', 'constructionSumMs', 'commonSpanMs')}})
    return {'schema': 'causal-workload-run-analysis-v1', 'children': children, 'ratios': ratios,
            'fourRoundRanges': ranges,
            'sampleCount': 57600, 'measuredBlockCount': 144,
            'nodeDigestRecordedNotReexecuted': node_digest,
            'scope': 'Offline artifact consistency and descriptive ratios, not formal D169 qualification, '
                     'semantic truth of approval text, replayed executable/tool binary provenance beyond bound assets, '
                     'proof of complete GC, continuous resource bounds '
                     'or attribution of process CPU to construction. Relocated config paths are historical.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.root), indent=2, allow_nan=False))
