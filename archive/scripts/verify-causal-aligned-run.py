#!/usr/bin/env python3
"""Offline complete-run verification and descriptive instrumentation ratios; no execution."""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

_spec = importlib.util.spec_from_file_location('child_verifier', Path(__file__).with_name('verify-causal-aligned-child.py'))
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
    require(len(jobs) == 12, '12 jobs')
    expected = {(r, c, o) for r in range(2) for c in ('CONTROL','GC','GC_CPU') for o in ('U', 'V')}
    coordinates = [(j['round'], j['condition'], j['orientation']) for j in jobs]
    require(all(type(j['round']) is int for j in jobs), 'integer round')
    require([j['round'] for j in jobs] == [i // 6 for i in range(12)], 'round blocks preserved')
    require(len(set(coordinates)) == 12 and set(coordinates) == expected, 'exact schedule coordinates')
    require(all(type(j['id']) is int for j in jobs) and [j['id'] for j in jobs] == list(range(12)), 'sequential job IDs')
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
    qualification=read(root/'qualification.json')
    for file,d in qualification['toolDigests'].items():
        require(digest(root/'assets'/'tools'/Path(file).name)==d,'frozen tool binding')
    require(qualification['captureToolingQualified'] is True,'qualified tools')
    require(reservation['sourceDigests']=={'assets/'+k:v for k,v in qualification['preparedDigests'].items()},'qualified prepared bindings')
    require(all(reservation[k]==qualification[k] for k in ('nodeDigest','scenarioDigest')),'qualified runtime/scenario')
    claim=read(root/'approval-claim.json');require(claim['approvalDigest']==reservation['approvalDigest'],'approval claim binding')
    require(not (root/'final-boundary-failure.json').exists(),'final budget failure')
    boundary=read(root/'final-boundary.json')
    require(0<=boundary['endedElapsed']<=900 and 0<=boundary['directoryBytes']<=256*1024**2,'final budget')
    require(sum(p.stat().st_size for p in root.rglob('*')if p.is_file())<=256*1024**2,'retained directory budget')
    node_digest = reservation['nodeDigest']
    require(isinstance(node_digest, str) and len(node_digest) == 64 and
            all(c in '0123456789abcdef' for c in node_digest), 'node digest syntax')
    require(isinstance(result.get('children'), list) and len(result['children']) == 12, '12 result children')
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
        dispatch=read(directory/'dispatch.json')
        require(dispatch['cell']==job and dispatch['explicitEnvironment']==qualification['explicitEnvironment'],'dispatch coordinate/environment')
        require(dispatch['argv'][1:-1]==FLAGS and Path(dispatch['argv'][-1]).name=='entry.mjs','dispatch flags/entry')
        require(digest(root/'assets'/f"{job['condition']}.mjs")==qualification['preparedDigests'][f"{job['condition']}.mjs"],'driver binding')
        require(entry['node'] == 'v24.18.0' and entry['execArgv'] == FLAGS, 'Node and flags')
        require(outcome['pid'] == pid and outcome['exitCode'] == 0 and outcome['reason'] is None, 'successful child exit')
        completion = read(directory / 'completion.json')
        require(completion == {'completed': True, 'samples': 2400}, 'completion count')
        observations = outcome['observations']
        require(isinstance(observations, list) and observations, 'resource observations')
        previous_elapsed, previous_child, inferred_begin = None, 0, None
        for observation in observations:
            elapsed, child_elapsed, gap, rss, size = (number(observation[key], key)
                for key in ('elapsed', 'childElapsed', 'gap', 'rssBytes', 'directoryBytes'))
            require(prior_end <= elapsed <= 900 and previous_child <= child_elapsed <= 30,
                    'serial elapsed/resource duration')
            require(gap <= 1 and rss <= 256 * 1024 ** 2 and size <= 256 * 1024 ** 2, 'resource stop bounds')
            if previous_elapsed is None:
                inferred_begin=elapsed-child_elapsed
                require(inferred_begin>=prior_end-1e-7, 'serial inferred begin')
                require(math.isclose(gap,child_elapsed,abs_tol=1e-7), 'first gap equals child elapsed')
            else:
                require(0 <= elapsed - previous_elapsed <= 1, 'observed actual gap')
                require(math.isclose(gap,elapsed-previous_elapsed,abs_tol=1e-7), 'gap matches elapsed')
                require(math.isclose(inferred_begin,elapsed-child_elapsed,abs_tol=1e-7), 'stable inferred begin')
            previous_elapsed, previous_child = elapsed, child_elapsed
        ended = number(outcome['endedElapsed'], 'endedElapsed')
        require(previous_elapsed <= ended <= 900 and ended - previous_elapsed <= 1, 'end observation gap')
        require(ended - observations[0]['elapsed'] + observations[0]['childElapsed'] <= 30, 'complete child duration')
        prior_end = ended
        vd=directory/'verification';ve=read(vd/'exit.json');dispatch_v=read(vd/'dispatch.json')
        require(dispatch_v['explicitEnvironment']==qualification['explicitEnvironment'],'verification environment')
        require(dispatch_v['argv'][1]=='-B' and Path(dispatch_v['argv'][2]).name=='verify-causal-aligned-child.py','verification entry')
        require(ve['reason'] is None and ve['exitCode']==0 and ve['pid'] not in pids,'successful distinct verifier')
        pids.add(ve['pid']);last=prior_end;begin=None
        require(bool(ve['observations']),'verification observations')
        for o in ve['observations']:
            elapsed,child,gap=[number(o[k],k)for k in ('elapsed','childElapsed','gap')]
            require(last<=elapsed<=900 and 0<=child<=30 and 0<=gap<=1,'verification bounds')
            if begin is None:
                begin=elapsed-child;require(begin>=prior_end-1e-7 and math.isclose(gap,child,abs_tol=1e-7),'verification begin')
            else:require(math.isclose(elapsed-child,begin,abs_tol=1e-7) and math.isclose(elapsed-last,gap,abs_tol=1e-7),'verification time consistency')
            require(0<=o['rssBytes']<=256*1024**2 and 0<=o['directoryBytes']<=256*1024**2,'verification resource budget');last=elapsed
        require(last<=ve['endedElapsed']<=boundary['endedElapsed'] and ve['endedElapsed']-last<=1 and ve['endedElapsed']-begin<=30,'verification end')
        prior_end=ve['endedElapsed']
        require((vd/'stdout.log').read_bytes()==(directory/'analysis.json').read_bytes(),'verification stdout evidence')
        worker_path = directory / 'worker.json'
        require(worker_path.is_file(), 'worker metadata required')
        worker = read(worker_path)
        require(read(directory/'preflight-first.json')==dict(module=0,pid=pid),'first preflight')
        require(read(directory/'preflight-order.json')==dict(modules=[0,1],pid=pid),'two preflights')
        require(worker['pid'] == pid and worker['timeOrigin'] == origin, 'worker process identity')
        samples = [json.loads(line) for line in (directory / 'samples.jsonl').read_bytes().splitlines()]
        diagnostic = read(directory / 'diagnostic.json')
        alignment=read(directory/'alignment.json')
        require(diagnostic['orientation']==job['orientation'] and alignment['condition']==job['condition'],'observation coordinates')
        platform=read(directory/'platform.json')
        require(platform==read(root/'qualification.json')['platform'],'bound platform')
        require(entry['platform']=='darwin' and entry['arch']=='arm64','runtime platform')
        profile=read(directory/'profile.json') if (directory/'profile.json').exists() else None
        if profile is not None:require((directory/'profile.json').stat().st_size<=32*1024**2,'profile size')
        analysis=_child.verify(samples,diagnostic,alignment,profile,read(directory/'native-clock.json'),platform,entry)
        require(analysis==read(directory/'analysis.json'),'retained analysis matches recomputation')
        children.append({'id': job['id'], 'round': job['round'], 'pid': pid, 'analysis': analysis})
        for block in analysis['blocks']:
            if block['phase'] == 'measured':
                indexed[(job['round'], job['condition'], job['orientation'], block['batch'], block['arm'])] = block
    ratios = []
    for round_id in range(2):
        for orientation in ('U', 'V'):
            for batch in range(3):
                for arm in ('candidate', 'reference'):
                    for numerator, denominator in [('GC','CONTROL'),('GC_CPU','GC'),('GC_CPU','CONTROL')]:
                        a, b = (indexed[(round_id, c, orientation, batch, arm)] for c in (numerator, denominator))
                        values = {}
                        for metric in ('p50Ms', 'p95Ms', 'constructionSumMs', 'commonSpanMs'):
                            require(b[metric] > 0, 'positive ratio denominator')
                            values[metric] = a[metric] / b[metric]
                        for metric in ('userMs','systemMs','elapsedLowerMs','elapsedUpperMs'):
                            values['checkpoint.'+metric]=a['checkpoint'][metric]/b['checkpoint'][metric] if b['checkpoint'][metric]>0 else None
                        ratios.append({'round': round_id, 'orientation': orientation, 'batch': batch,
                                       'arm': arm, 'contrast': numerator + '/' + denominator, 'ratios': values})
    ranges = []
    for orientation in ('U', 'V'):
        for batch in range(3):
            for arm in ('candidate', 'reference'):
                for contrast in ('GC/CONTROL','GC_CPU/GC','GC_CPU/CONTROL'):
                    rows = [r for r in ratios if (r['orientation'], r['batch'], r['arm'], r['contrast']) ==
                            (orientation, batch, arm, contrast)]
                    ranges.append({'orientation': orientation, 'batch': batch, 'arm': arm,
                                   'contrast': contrast, 'rounds': [r['round'] for r in rows],
                                   'ranges': {metric: [min(r['ratios'][metric] for r in rows),
                                                       max(r['ratios'][metric] for r in rows)]
                                              for metric in ('p50Ms', 'p95Ms', 'constructionSumMs', 'commonSpanMs')}})
    return {'schema':'causal-aligned-run-analysis-v1','children':children,'ratios':ratios,
            'twoRoundRanges':ranges,'sampleCount':28800,'measuredBlockCount':72,
            'nodeDigestRecordedNotReexecuted':node_digest,
            'scope':'Descriptive instrumented window evidence only. No D169 qualification, exact CPU duration, waiting attribution or complete GC assertion.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.root), indent=2, allow_nan=False))
