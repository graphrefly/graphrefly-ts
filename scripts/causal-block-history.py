"""One approved block-history diagnostic; no business execution on import."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('crossover_shared',ROOT/'scripts/causal-control-crossover.py')
h=importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
digest,read,put,require,archive_materials=h.digest,h.read,h.put,h.require,h.archive_materials
OUTPUT=ROOT/'archive/evals/causal-block-history-v1/run'
APPROVAL=ROOT/'docs/design/causal-block-history-v1-implementation/approval.json'
SCHEDULE=['S00','S01','S11','S10','S10','S11','S01','S00']
CELLS={c:('neutral',0,[0,1]) for c in ('S00','S01','S10','S11')}
ORDERS={'S00': [['candidate', 'reference'], ['reference', 'candidate'], ['candidate', 'reference']], 'S01': [['candidate', 'reference'], ['reference', 'candidate'], ['reference', 'candidate']], 'S10': [['candidate', 'reference'], ['candidate', 'reference'], ['candidate', 'reference']], 'S11': [['candidate', 'reference'], ['candidate', 'reference'], ['reference', 'candidate']]}
ORIGINAL_RECIPE={'revision': 'spending-preset-performance-v1', 'coldRows': 12, 'steadyRows': 60, 'recoveryRows': 12, 'warmup': 100, 'measured': 300, 'orders': [['candidate', 'reference'], ['reference', 'candidate'], ['candidate', 'reference']], 'coldLimit': 1.2, 'steadyLimit': 1.1, 'recoveryCycles': 20, 'stopAfterFailedRow': True, 'childTimeoutMs': 900000, 'totalTimeoutMs': 7200000, 'freshBasis': 'distinct evaluation identities absent before the whole wave', 'doubleData': 'two exact copies of the same arrival frame in one source.down; second copy is intra-wave replay', 'memory': 'raw process heap/RSS before and after action; GC may make deltas negative, not retained-size proof'}
NAMES=h.NAMES
FLAGS=h.FLAGS
ROW=h.ROW
SOURCE_PATHS=[ROOT/'scripts'/name for name in ['causal-block-history.py','verify-causal-block-history.py','derive-causal-block-driver.mjs','check-causal-block-source.mjs','causal-control-crossover.py','verify-causal-control-crossover.py','causal-block-history.test.mjs','causal-block-history.test.py']]


def config_for(directory,cell):
    kind,reference,order=CELLS[cell]
    return dict(row=ROW,output=str(directory),scenarioPath=str(directory.parent/'P2-inputs.json'),control=True,
                copyModule=(directory.parent/NAMES[1-reference]).as_uri(),
                diagnostic=dict(cell=cell,referenceModule=reference,preflightOrder=order,orders=ORDERS[cell]))


def entry_source(directory,cell):
    kind,reference,order=CELLS[cell]
    lines=['import assert from "node:assert/strict";','import {appendFileSync,readFileSync,writeFileSync} from "node:fs";',
        f'assert.deepEqual(JSON.parse(readFileSync({json.dumps(str(directory/"config.json"))}, "utf8")), {json.dumps(config_for(directory,cell))});',
        'import {createHash} from "node:crypto";',
        f'const record = (event) => appendFileSync({json.dumps(str(directory/"entry-events.jsonl"))}, JSON.stringify({{...event,pid:process.pid}})+"\\n");']
    for variable,name,identity in [('n','block-history.mjs','N'),('m0',NAMES[0],0),('m1',NAMES[1],1)]:
        lines += [f'const {variable} = await import({json.dumps((directory.parent/name).as_uri())});',
                  f'record({{kind:"loaded",module:{json.dumps(identity)}}});']
    selected='N' if kind=='neutral' else reference
    lines += [f'record({{kind:"driver",module:{json.dumps(selected)}}});']
    call=f'n.runRow({json.dumps(str(directory/"config.json"))}, [m0,m1])' if kind=='neutral' else f'm{reference}.runRow({json.dumps(str(directory/"config.json"))})'
    lines += [f'const originalRecipe = {json.dumps(ORIGINAL_RECIPE)};',
              'const checkRecipes = () => { assert.deepEqual(m0.RECIPE,originalRecipe); assert.deepEqual(m1.RECIPE,originalRecipe); };',
              f'const recipeProof = {{pid:process.pid,cell:{json.dumps(cell)},originalRecipe,ordersDigest:createHash("sha256").update(JSON.stringify({json.dumps(ORDERS[cell])})).digest("hex")}};',
              'checkRecipes();',f'writeFileSync({json.dumps(str(directory/"recipe-before.json"))},JSON.stringify(recipeProof));',
              f'await {call};','checkRecipes();',f'writeFileSync({json.dumps(str(directory/"recipe-after.json"))},JSON.stringify(recipeProof));']
    return '\n'.join(lines)+'\n'


def summarize(samples,cell):
    import math
    require(len(samples)==2400,'sample count')
    p95={a:[] for a in ('candidate','reference')};prior=-1
    for batch,pair in enumerate(ORDERS[cell]):
        for ordinal,arm in enumerate(pair):
            block=samples[(batch*2+ordinal)*400:(batch*2+ordinal+1)*400]
            for i,x in enumerate(block):
                require(type(x['index']) is int and type(x['batch']) is int,'integer coordinates')
                require((x['batch'],x['arm'],x['index'],x['phase'],x['segment'])==(batch,arm,i,'warmup' if i<100 else 'measured',f'cold-P2-summary/{batch}/{arm}/{i}'),'sample coordinates')
                require(all(type(x[k]) in (int,float) and math.isfinite(x[k]) and x[k]>=0 for k in ('start','end','ms','constructionMs','preparationMs')),'finite clocks')
                require(x['ms']==x['end']-x['start'] and x['constructionMs']==x['preparationMs']==0 and x['start']>=prior,'cold clocks')
                prior=x['end']
            p95[arm].append(sorted(x['ms'] for x in block[100:])[284])
    require(all(n>0 for values in p95.values() for n in values),'positive p95')
    med={a:sorted(values)[1] for a,values in p95.items()}
    ratios=[p95['candidate'][b]/p95['reference'][b] for b in range(3)]
    return dict(batchP95Ms=p95,medianBatchP95Ms=med,candidateOverReference=med['candidate']/med['reference'],m1OverM0=med['candidate']/med['reference'],candidateOverReferenceByBatch=ratios,
        laterOverEarlierByBatch=[p95[pair[1]][b]/p95[pair[0]][b] for b,pair in enumerate(ORDERS[cell])],thirdOverSecond={a:values[2]/values[1] for a,values in p95.items()})


def check_child(directory,cell,pid):
    kind,reference,order=CELLS[cell]
    require(read(directory/'config.json')==config_for(directory,cell),'config mapping')
    require((directory/'entry.mjs').read_text()==entry_source(directory,cell),'entry')
    events=[json.loads(s) for s in (directory/'entry-events.jsonl').read_text().splitlines()]
    expected=[dict(kind='loaded',module=m,pid=pid) for m in ['N',0,1]]+[dict(kind='driver',module='N' if kind=='neutral' else reference,pid=pid)]
    require(events==expected,'entry events')
    worker=read(directory/'worker.json')
    require(worker['pid']==pid and worker['node']=='v24.18.0' and worker['row']==ROW and worker['control'] is True,'worker')
    require(worker['recipe']=={**ORIGINAL_RECIPE,'orders':ORDERS[cell]},'recipe')
    require(read(directory/'preflight.json')['passed'] is True,'preflight')
    if kind=='neutral':
        require(read(directory/'preflight-first.json')==dict(module=order[0],pid=pid),'preflight first')
        require(read(directory/'preflight-order.json')==dict(cell=cell,referenceModule=reference,preflightOrder=order,orders=ORDERS[cell],pid=pid),'preflight order')
    proof=dict(pid=pid,cell=cell,originalRecipe=ORIGINAL_RECIPE,ordersDigest=digest(json.dumps(ORDERS[cell],separators=(',',':')).encode()))
    require(read(directory/'recipe-before.json')==proof and read(directory/'recipe-after.json')==proof,'original recipe preservation')
    require(read(directory/'completion.json')==dict(completed=True,samples=2400),'completion')
    return summarize([json.loads(s) for s in (directory/'samples.jsonl').read_text().splitlines()],cell)


def contrasts(rows):
    require(len(rows)==8,'complete contrasts')
    output=[]
    for half in range(2):
        q={r['cell']:r['candidateOverReferenceByBatch'][2] for r in rows[half*4:half*4+4]}
        require(set(q)==set(ORDERS),'four cells per half')
        third0=q['S01']/q['S00'];third1=q['S11']/q['S10']
        output.append(dict(half=half,thirdOrder=[third0,third1],secondOrder=[q['S10']/q['S00'],q['S11']/q['S01']],interaction=third1/third0))
    return output


def run():
    # Fixed output is also a single-use lock. Never delete it to retry.
    require(not OUTPUT.exists() and not OUTPUT.is_symlink(), 'single diagnostic already reserved')
    require(OUTPUT.parent.resolve() == OUTPUT.parent, 'canonical output parent')
    approval = read(APPROVAL)
    require(approval['designDigest'] == 'sha256:' + digest((ROOT / approval['design']).read_bytes()), 'approved design drift')
    OUTPUT.mkdir()
    first_spawn = None
    rows = []
    stopped = None
    try:
        materials, bindings = archive_materials()
        require(not any(os.environ.get(k) for k in ('NODE_OPTIONS','NODE_COMPILE_CACHE','NODE_V8_COVERAGE')), 'implicit Node options')
        env = {k: os.environ[k] for k in ('PATH','HOME','TMPDIR','LANG','LC_ALL','TZ') if k in os.environ}
        node = str(Path(shutil.which('node')).resolve())
        probe = subprocess.check_output([node, '-p', 'JSON.stringify({node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch})'], env=env, timeout=10)
        runtime = json.loads(probe)
        require(runtime['node'] == 'v24.18.0' and runtime['v8'] == '13.6.233.17-node.50', 'runtime drift')
        put(OUTPUT / 'reservation.json', dict(approvalDigest=digest(APPROVAL.read_bytes()), schedule=SCHEDULE,
            executionRoot=str(OUTPUT), runtime=runtime, executable=node, executableDigest=digest(Path(node).read_bytes()),
            childEnvironmentKeys=sorted(env), implicitNodeOptions={}, loadAverage=os.getloadavg(),
            sourceDigests={p.name:digest(p.read_bytes()) for p in SOURCE_PATHS},
            archiveBindings=bindings))
        (OUTPUT / 'source').mkdir()
        for p in SOURCE_PATHS:
            with (OUTPUT/'source'/p.name).open('xb') as f:
                f.write(p.read_bytes())
        with (OUTPUT/'approval.json').open('xb') as f:
            f.write(APPROVAL.read_bytes())
        for name, data in materials.items():
            with (OUTPUT / name).open('xb') as f:
                f.write(data)
        derived = subprocess.run([node, str(ROOT/'scripts/derive-causal-block-driver.mjs'), str(OUTPUT/'worker.mjs'), str(OUTPUT/'block-history.mjs'), str(OUTPUT/'derivation.json')], capture_output=True, text=True, env=env, timeout=15)
        put(OUTPUT/'derivation-command.json', dict(exitCode=derived.returncode, stdout=derived.stdout, stderr=derived.stderr))
        require(derived.returncode==0, 'source derivation')
        checked = subprocess.run([node, str(ROOT/'scripts/check-causal-block-source.mjs'), str(OUTPUT/'worker.mjs'), str(OUTPUT/'block-history.mjs')], capture_output=True, text=True, env=env, timeout=15)
        put(OUTPUT/'source-check-command.json', dict(exitCode=checked.returncode, stdout=checked.stdout, stderr=checked.stderr))
        require(checked.returncode==0, 'independent source check')
        put(OUTPUT/'source-check.json', json.loads(checked.stdout))
        for position, cell in enumerate(SCHEDULE):
            directory = OUTPUT / f'{position}-{cell}'
            directory.mkdir()
            put(directory / 'config.json', config_for(directory, cell))
            with (directory / 'entry.mjs').open('x') as f:
                f.write(entry_source(directory, cell))
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
        if not (OUTPUT/'reservation.json').exists():
            put(OUTPUT/'reservation.json',dict(approvalDigest=digest(APPROVAL.read_bytes()),schedule=SCHEDULE,executionRoot=str(OUTPUT),status='preparation-failed',reason=stopped))
    finally:
        result = dict(status='complete-diagnostic' if len(rows)==8 and stopped is None else 'incomplete',
                      rows=rows, contrasts=contrasts(rows) if len(rows)==8 and stopped is None else None, stopReason=stopped, notRun=[p for p in range(8) if not (OUTPUT/f'{p}-{SCHEDULE[p]}'/'exit.json').exists()],
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
