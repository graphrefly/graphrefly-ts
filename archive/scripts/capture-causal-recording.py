"""Explicit single-use capture entry. Import is inert; no capture is currently authorized."""
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import shutil
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent


def module(file, name):
    spec = importlib.util.spec_from_file_location(name, HERE/file)
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


supervisor = module('causal-recording-supervisor.py', 'supervisor')
verifier = module('verify-causal-recording-child.py', 'child_verifier')
FLAGS = ['--trace-gc', '--trace-deopt', '--log-deopt', '--no-logfile-per-isolate', '--logfile=v8.log']


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def put(file, value):
    with Path(file).open('x') as f:
        json.dump(value, f, indent=2)
        f.write('\n')


def entry(job, assets, condition):
    return '\n'.join([
        'import fs from "node:fs";',
        f'const d = await import({json.dumps((assets/(condition+".mjs")).as_uri())});',
        f'const a = await import({json.dumps((assets/"worker.mjs").as_uri())});',
        f'const b = await import({json.dumps((assets/"worker-copy.mjs").as_uri())});',
        f'fs.writeFileSync({json.dumps(str(job/"entry.json"))},JSON.stringify({{pid:process.pid,timeOrigin:performance.timeOrigin,node:process.version,execArgv:process.execArgv}}));',
        f'await d.runRow({json.dumps(str(job/"config.json"))},[a,b]);',
    ])+'\n'


def capture(prepared, scenario, approval, qualification, output, node):
    prepared, scenario, approval, qualification, output, node = (
        p.resolve() for p in (prepared, scenario, approval, qualification, output, node))
    start = time.monotonic()
    wall_start = time.time()
    reservation = None
    claimed = False
    output_created = False
    try:
        approval_bytes = approval.read_bytes()
        assert approval_bytes.strip(), 'Explicit approval artifact required'
        approval_digest = hashlib.sha256(approval_bytes).hexdigest()
        claim = approval.with_name(approval.name+'.claim.json')
        put(claim, dict(output=str(output), approvalDigest=approval_digest))
        claimed = True
        output.mkdir(parents=True, exist_ok=False)
        output_created = True
        qualification_bytes = qualification.read_bytes()
        qualification_digest = hashlib.sha256(qualification_bytes).hexdigest()
        q = json.loads(qualification_bytes)
        assert q['captureToolingQualified'] is True
        for file, digest in q['toolDigests'].items():
            assert sha(HERE.parent/file) == digest, file
        actual_files = {str(p.relative_to(prepared)) for p in prepared.rglob('*') if p.is_file()}
        assert actual_files == set(q['preparedDigests'])
        for file, digest in q['preparedDigests'].items():
            target = prepared/file
            assert not target.is_symlink() and target.resolve().is_relative_to(prepared)
            assert sha(target) == digest, file
        assert sha(scenario) == q['scenarioDigest']
        assert sha(node) == q['nodeDigest']
        explicit_environment = q['explicitEnvironment']
        assert set(explicit_environment) <= {'PATH','HOME','TMPDIR','LANG','LC_ALL','__CF_USER_TEXT_ENCODING'}
        assert all(isinstance(v,str) for v in explicit_environment.values())
        assert subprocess.check_output([str(node),'--version'], env=explicit_environment,
                                       text=True, timeout=5).strip() == 'v24.18.0'
        assets = output/'assets'
        shutil.copytree(prepared, assets)
        shutil.copyfile(scenario, output/'P2-inputs.json')
        (output/'approval.txt').write_bytes(approval_bytes)
        (output/'qualification.json').write_bytes(qualification_bytes)
        shutil.copyfile(claim, output/'approval-claim.json')
        jobs = supervisor.schedule(random.SystemRandom())
        reservation = dict(jobs=jobs,sourceDigests={f'assets/{k}':v for k,v in q['preparedDigests'].items()},
            approvalDigest=approval_digest,qualificationDigest=qualification_digest,scenarioDigest=q['scenarioDigest'],
            nodeDigest=q['nodeDigest'],flags=FLAGS)
        assert sha(output/'P2-inputs.json') == reservation['scenarioDigest']
        assert sha(output/'approval.txt') == approval_digest
        assert sha(output/'qualification.json') == qualification_digest
        put(output/'reservation.json', reservation)
        pids, origins = set(), set()

        def guard_runtime():
            for file, digest in reservation['sourceDigests'].items():
                assert sha(output/file) == digest, 'source changed during capture'
            assert sha(output/'P2-inputs.json') == reservation['scenarioDigest'], 'scenario drift'
            assert sha(node) == reservation['nodeDigest'], 'runtime drift'
            assert sha(output/'approval.txt') == approval_digest, 'approval snapshot drift'
            assert sha(output/'qualification.json') == qualification_digest, 'qualification snapshot drift'

        def run_one(cell):
            guard_runtime()
            if abs((time.time()-wall_start)-(time.monotonic()-start)) > 1:
                raise RuntimeError('host-sleep-or-wall-clock-discontinuity')
            if time.monotonic()-start > 900: raise RuntimeError('total-deadline-before-dispatch')
            job = output/f'{cell["id"]:02d}'
            job.mkdir()
            config = dict(row=dict(id='cold-P2-summary',group='cold',profile='P2',mode='summary'),
                kind='control',control=True,output=str(job),scenarioPath=str(output/'P2-inputs.json'),**cell)
            put(job/'config.json', config)
            (job/'entry.mjs').write_text(entry(job,assets,cell['condition']))
            argv = [str(node),*FLAGS,str(job/'entry.mjs')]
            put(job/'dispatch.json',dict(argv=argv,explicitEnvironment=explicit_environment,cell=cell))
            result = supervisor.supervise(argv,job,output,explicit_environment,start)
            if result['reason']: return result
            meta = json.loads((job/'entry.json').read_text())
            assert meta['pid']==result['pid'] and meta['execArgv']==FLAGS and meta['node']=='v24.18.0'
            assert meta['pid'] not in pids and meta['timeOrigin'] not in origins
            pids.add(meta['pid']);origins.add(meta['timeOrigin'])
            assert json.loads((job/'completion.json').read_text()) == dict(completed=True,samples=2400)
            samples = [json.loads(x) for x in (job/'samples.jsonl').read_text().splitlines()]
            diag = json.loads((job/'diagnostic.json').read_text())
            assert diag['condition']=='CPU' and diag['orientation']==cell['orientation']
            recording = json.loads((job/'recording.json').read_text())
            assert recording['condition']==cell['condition']
            verifier.verify(samples,diag,recording)
            return result

        result = supervisor.dispatch(jobs,run_one)
        try: guard_runtime()
        except AssertionError as error:
            result['completed'] = False
            result['finalSnapshotFailure'] = str(error)
        # Verification time is outside construction but still inside the total budget.
        if (time.monotonic()-start > 900 or supervisor.tree_size(output)>256*1024*1024
                or abs((time.time()-wall_start)-(time.monotonic()-start)) > 1):
            result['completed'] = False
            result['finalBoundaryFailure'] = True
        put(output/'result.json',result)
        return result
    except BaseException as error:
        if claimed:
            failure_path = output/'failure.json' if output_created else approval.with_name(approval.name+'.setup-failure.json')
            put(failure_path,dict(error=f'{type(error).__name__}:{error}',
                reservationWritten=reservation is not None,formalAcceptance=False))
        raise


if __name__ == '__main__':
    assert len(sys.argv)==8 and sys.argv[1]=='--capture', 'Explicit approved capture only'
    result=capture(*(Path(x).resolve() for x in sys.argv[2:]))
    if not result['completed']: sys.exit(1)
