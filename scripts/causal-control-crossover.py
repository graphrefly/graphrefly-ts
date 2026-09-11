"""Private, single-use approved diagnostic. Importing this module never runs a worker."""
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'archive/evals/causal-performance-repetition-v2'
OUTPUT = ROOT / 'archive/evals/causal-control-role-crossover-v1/run'
APPROVAL = ROOT / 'docs/design/causal-control-role-crossover-v1-implementation/approval.json'
SCHEDULE = [0, 1, 3, 2, 2, 3, 1, 0]
CELLS = [([0, 1], 0), ([0, 1], 1), ([1, 0], 0), ([1, 0], 1)]
NAMES = ['worker.mjs', 'worker-copy.mjs']
ROW = dict(id='cold-P2-summary', group='cold', profile='P2', mode='summary')
FLAGS = ['--trace-gc', '--trace-deopt', '--log-deopt', '--no-logfile-per-isolate', '--logfile=v8.log']
ARCHIVE_SHA = '3483b61f34da607ccd04ff99b86e49d14e90584f843ff3aefcf2640d60a4fbd7'
INDEX_SHA = '07a8e0384997617197f729bf11bd997335095227244eb8e11a18cc4603e85ef8'
MATERIALS = {
    'worker.mjs': 'd9d8606d73e1bcfad66097f027d63c99fc409571042c5f1e7efffaa645356fb2',
    'worker-copy.mjs': 'd9d8606d73e1bcfad66097f027d63c99fc409571042c5f1e7efffaa645356fb2',
    'P2-inputs.json': '44f1165557fc1444540731a73846233ce3d71da7a0af3a3d4fa2137e249c2079',
    'reference-qualification.json': 'd6748e269f7c86cd838099e405a3eda70705b9bfdcff711fda630c2035afe60e',
}


def digest(b):
    return hashlib.sha256(b).hexdigest()


def read(p):
    return json.loads(p.read_text())


def put(p, value):
    with p.open('x') as f:
        json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write('\n')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def archive_materials():
    require(digest((ARCHIVE / 'evidence.tar.gz').read_bytes()) == ARCHIVE_SHA, 'archive drift')
    require(digest((ARCHIVE / 'artifact-index.json').read_bytes()) == INDEX_SHA, 'index drift')
    index = read(ARCHIVE / 'artifact-index.json')['files']
    raw = {}
    with tarfile.open(ARCHIVE / 'evidence.tar.gz') as tar:
        for member in tar.getmembers():
            require(member.isfile() and member.name in index and member.name not in raw, 'archive member')
            data = tar.extractfile(member).read()
            require('sha256:' + digest(data) == index[member.name], 'indexed bytes')
            raw[member.name] = data
    require(set(raw) == set(index), 'archive completeness')
    for name, expected in MATERIALS.items():
        require(digest(raw['method-validation/' + name]) == expected, 'material drift')
    qualification = json.loads(raw['method-validation/reference-qualification.json'])
    ids = {'baseline', 'plain-unbounded-domains', 'plain-cached-outcome-replay',
           'plain-evidence-omitted', 'stale-join-rows', 'pack-bound-one-mib', 'wrong-score',
           'dependency-guard-removed'}
    require(qualification['complete'] is True and len(qualification['results']) == 8, 'qualification complete')
    require({r['id'] for r in qualification['results']} == ids, 'qualification cases')
    for result in qualification['results']:
        require(result['loaded'] is True and result['outcome'] == ('passed' if result['id'] == 'baseline' else 'detected'), 'loaded qualification')
        require('sha256:' + digest(raw['reference-qualification/' + result['id'] + '.result.json']) == result['resultDigest'], 'qualification result binding')
    freeze = json.loads(raw['method-validation/freeze.json'])
    for path, expected in freeze['runtimeSources'].items():
        require('sha256:' + digest(raw['method-validation/source/' + path]) == expected, 'archived closure')
        require(qualification['copiedInputs'].get(path) == expected, 'qualification closure')
        require('sha256:' + digest((ROOT / path).read_bytes()) == expected, 'current closure drift')
    return {name: raw['method-validation/' + name] for name in MATERIALS}, {
        'archive': ARCHIVE_SHA, 'index': INDEX_SHA, 'verifiedFiles': len(raw),
        'runtimeClosureFiles': len(freeze['runtimeSources']), 'qualificationCases': 8,
    }


def entry_source(directory, order, driver):
    """Only the experiment coordinates vary; original worker has no edits/wrappers."""
    urls = [(directory.parent / n).as_uri() for n in NAMES]
    events = str(directory / 'entry-events.jsonl')
    lines = ['import {appendFileSync} from "node:fs";',
             f'const record = (event) => appendFileSync({json.dumps(events)}, JSON.stringify({{...event,pid:process.pid}})+"\\n");']
    for module in order:
        lines += [f'const m{module} = await import({json.dumps(urls[module])});',
                  f'record({{kind:"loaded",module:{module}}});']
    lines += [f'record({{kind:"driver",module:{driver}}});',
              f'await m{driver}.runRow({json.dumps(str(directory / "config.json"))});']
    return '\n'.join(lines) + '\n'


def config_for(directory, driver):
    return dict(row=ROW, output=str(directory), scenarioPath=str(directory.parent / 'P2-inputs.json'),
                control=True, copyModule=(directory.parent / NAMES[1-driver]).as_uri())


def summarize(samples, cell):
    require(len(samples) == 2400, 'sample count')
    batches = {'candidate': [], 'reference': []}
    cursor, last_end = 0, -1
    for batch in range(3):
        for arm in (['reference', 'candidate'] if batch == 1 else ['candidate', 'reference']):
            values = []
            for index in range(400):
                s = samples[cursor]
                require((s['batch'], s['arm'], s['index'], s['phase']) ==
                        (batch, arm, index, 'warmup' if index < 100 else 'measured'), 'sample order')
                require(all(type(s[k]) in (int, float) and math.isfinite(s[k]) and s[k] >= 0
                            for k in ('start', 'end', 'ms', 'constructionMs', 'preparationMs')), 'sample number')
                require(s['end'] - s['start'] == s['ms'] and s['constructionMs'] == 0 and s['preparationMs'] == 0, 'cold clock')
                require(s['start'] >= last_end, 'sample monotonicity')
                require(s['segment'] == f'cold-P2-summary/{batch}/{arm}/{index}', 'sample identity')
                last_end = s['end']
                if index >= 100:
                    values.append(s['ms'])
                cursor += 1
            batches[arm].append(sorted(values)[284])
    medians = {arm: sorted(values)[1] for arm, values in batches.items()}
    require(all(v > 0 for v in medians.values()), 'positive denominators')
    order, driver = CELLS[cell]
    physical = {driver: medians['reference'], 1-driver: medians['candidate']}
    return dict(batchP95Ms=batches, medianBatchP95Ms=medians,
                externalOverDriver=medians['candidate']/medians['reference'],
                m1OverM0=physical[1]/physical[0], laterOverEarlier=physical[order[1]]/physical[order[0]])


def check_child(directory, cell, pid):
    order, driver = CELLS[cell]
    require(read(directory / 'config.json') == config_for(directory, driver), 'config')
    require((directory / 'entry.mjs').read_text() == entry_source(directory, order, driver), 'entry')
    events = [json.loads(s) for s in (directory / 'entry-events.jsonl').read_text().splitlines()]
    require(events == [dict(kind='loaded', module=m, pid=pid) for m in order] +
            [dict(kind='driver', module=driver, pid=pid)], 'entry events')
    meta = read(directory / 'worker.json')
    require(meta['pid'] == pid and meta['node'] == 'v24.18.0' and meta['control'] is True and meta['row'] == ROW, 'worker metadata')
    require(meta['recipe']['warmup'] == 100 and meta['recipe']['measured'] == 300 and
            meta['recipe']['orders'] == [['candidate','reference'],['reference','candidate'],['candidate','reference']], 'recipe')
    require(read(directory / 'preflight.json')['passed'] is True, 'preflight')
    require(read(directory / 'completion.json') == dict(completed=True, samples=2400), 'completion')
    samples = [json.loads(s) for s in (directory / 'samples.jsonl').read_text().splitlines()]
    return summarize(samples, cell)


def run():
    # Fixed output is also a single-use lock. Never delete it to retry.
    require(not OUTPUT.exists() and not OUTPUT.is_symlink(), 'single diagnostic already reserved')
    require(OUTPUT.parent.resolve() == OUTPUT.parent, 'canonical output parent')
    approval = read(APPROVAL)
    require(approval['designDigest'] == 'sha256:' + digest((ROOT / approval['design']).read_bytes()), 'approved design drift')
    materials, bindings = archive_materials()
    require(not any(os.environ.get(k) for k in ('NODE_OPTIONS','NODE_COMPILE_CACHE','NODE_V8_COVERAGE')), 'implicit Node options')
    env = {k: os.environ[k] for k in ('PATH','HOME','TMPDIR','LANG','LC_ALL','TZ') if k in os.environ}
    node = str(Path(shutil.which('node')).resolve())
    probe = subprocess.check_output([node, '-p', 'JSON.stringify({node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch})'], env=env, timeout=10)
    runtime = json.loads(probe)
    require(runtime['node'] == 'v24.18.0' and runtime['v8'] == '13.6.233.17-node.50', 'runtime drift')
    OUTPUT.mkdir()
    first_spawn = None
    rows = []
    stopped = None
    try:
        put(OUTPUT / 'reservation.json', dict(approvalDigest=digest(APPROVAL.read_bytes()), schedule=SCHEDULE,
            executionRoot=str(OUTPUT), runtime=runtime, executable=node, executableDigest=digest(Path(node).read_bytes()),
            childEnvironmentKeys=sorted(env), implicitNodeOptions={}, loadAverage=os.getloadavg(),
            sourceDigests={p.name:digest(p.read_bytes()) for p in [Path(__file__), ROOT/'scripts/verify-causal-control-crossover.py']},
            archiveBindings=bindings))
        (OUTPUT / 'source').mkdir()
        for p in [Path(__file__), ROOT/'scripts/verify-causal-control-crossover.py']:
            with (OUTPUT/'source'/p.name).open('xb') as f:
                f.write(p.read_bytes())
        with (OUTPUT/'approval.json').open('xb') as f:
            f.write(APPROVAL.read_bytes())
        for name, data in materials.items():
            with (OUTPUT / name).open('xb') as f:
                f.write(data)
        for position, cell in enumerate(SCHEDULE):
            directory = OUTPUT / f'{position}-C{cell}'
            directory.mkdir()
            order, driver = CELLS[cell]
            put(directory / 'config.json', config_for(directory, driver))
            with (directory / 'entry.mjs').open('x') as f:
                f.write(entry_source(directory, order, driver))
            argv = [node, *FLAGS, str(directory / 'entry.mjs')]
            started = time.monotonic()
            if first_spawn is None:
                first_spawn = started
            remaining = 300 - (started-first_spawn)
            require(remaining > 0, 'whole-run deadline')
            child_record = dict(position=position, cell=cell, argv=argv, cwd=str(directory),
                                startMonotonic=started, status='incomplete')
            with (directory/'stdout.log').open('xb') as out, (directory/'stderr.log').open('xb') as err:
                child = subprocess.Popen(argv, cwd=directory, env=env, stdout=out, stderr=err)
                child_record['pid'] = child.pid
                try:
                    child.wait(timeout=min(30, remaining))
                except BaseException:
                    child.kill()
                    child.wait()
                    raise
                finally:
                    child_record.update(exitCode=child.returncode, endMonotonic=time.monotonic(), status='exited')
                    put(directory/'exit.json', child_record)
            require(child.returncode == 0, 'child failure')
            require(child_record['endMonotonic']-started <= min(30,remaining), 'child deadline')
            summary = check_child(directory, cell, child.pid)
            rows.append(dict(position=position, cell=cell, **summary))
            print(json.dumps(dict(position=position, cell=cell, **summary)), flush=True)
    except BaseException as error:
        stopped = f'{type(error).__name__}: {error}'
    finally:
        result = dict(status='complete-diagnostic' if len(rows)==8 and stopped is None else 'incomplete',
                      rows=rows, stopReason=stopped, notRun=[p for p in range(8) if not (OUTPUT/f'{p}-C{SCHEDULE[p]}'/'exit.json').exists()],
                      elapsedSeconds=0 if first_spawn is None else time.monotonic()-first_spawn,
                      eventAssociation='unknown: retained native clocks uncalibrated', performanceQualification=False)
        put(OUTPUT/'result.json', result)
        files = {str(p.relative_to(OUTPUT)):digest(p.read_bytes()) for p in sorted(OUTPUT.rglob('*')) if p.is_file()}
        put(OUTPUT/'artifact-index.json', dict(files=files))
        print('CAUSAL_CROSSOVER_DONE', result['status'], flush=True)
    return 0 if result['status']=='complete-diagnostic' else 1


if __name__ == '__main__':
    require(sys.argv[1:] == ['--run-approved'], 'explicit single-use command required')
    sys.exit(run())
