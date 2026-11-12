"""D169: single-use cold method qualification. Importing this module never samples."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import secrets
import shutil
import statistics
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
def module(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py')
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
h=module('causal-control-crossover')
old=module('causal-block-history')
require,read,put,digest=h.require,h.read,h.put,h.digest
ROW,FLAGS,RECIPE=h.ROW,h.FLAGS,old.ORIGINAL_RECIPE
ORDERS={'U':[['candidate','reference'],['reference','candidate'],['candidate','reference']],
        'V':[['reference','candidate'],['candidate','reference'],['reference','candidate']]}
OUTPUT=ROOT/'archive/evals/causal-cold-position-pairs-v3/run'
DOC=ROOT/'docs/design/causal-cold-position-pairs-v3-implementation'
APPROVAL=DOC/'approval.json'
SOURCES=['causal-position-pairs.py','verify-causal-position-pairs.py','derive-causal-position-driver.mjs',
         'check-causal-position-source.mjs','verify-causal-block-history.py','verify-causal-control-crossover.py','causal-position-pairs.test.py','causal-position-pairs.test.mjs',
         'causal-control-crossover.py','causal-block-history.py','derive-causal-block-driver.mjs']

def schedule(bits):
    require(len(bits)==40 and all(type(x) is int and x in (0,1) for x in bits),'40 fair order bits')
    result=[]
    for panel in ('Z','M'):
        for pair in range(20):
            category='control' if pair in (0,1,18,19) else 'main'
            kind='mutation' if panel=='M' and category=='main' else 'control'
            for orientation in (['V','U'] if bits[len(result)//2] else ['U','V']):
                result.append(dict(position=len(result),panel=panel,pair=pair,category=category,kind=kind,orientation=orientation))
    return result

def config_for(job,cell):
    return dict(row=ROW,output=str(job),scenarioPath=str(job.parent/'P2-inputs.json'),
                control=cell['kind']=='control',kind=cell['kind'],orientation=cell['orientation'])

def entry_source(job,cell):
    config=config_for(job,cell)
    lines=['import assert from "node:assert/strict";','import {readFileSync,appendFileSync,writeFileSync} from "node:fs";',
      f'const config = {json.dumps(config)};',
      f'assert.deepEqual(JSON.parse(readFileSync({json.dumps(str(job/"config.json"))},"utf8")),config);',
      f'const record = module => appendFileSync({json.dumps(str(job/"entry-events.jsonl"))},JSON.stringify({{module,pid:process.pid}})+"\\n");']
    for var,name,label in [('n','position.mjs','N'),('m0','worker.mjs','M0'),('m1','worker-copy.mjs','M1')]:
        lines += [f'const {var} = await import({json.dumps((job.parent/name).as_uri())});',f'record({json.dumps(label)});']
    lines += [f'const expected = {json.dumps(RECIPE)};',
      'assert.deepEqual(m0.RECIPE,expected);assert.deepEqual(m1.RECIPE,expected);',
      f'await n.runRow({json.dumps(str(job/"config.json"))},[m0,m1]);',
      'assert.deepEqual(m0.RECIPE,expected);assert.deepEqual(m1.RECIPE,expected);',
      f'writeFileSync({json.dumps(str(job/"recipe-after.json"))},JSON.stringify({{pid:process.pid,recipe:expected}}));']
    return '\n'.join(lines)+'\n'

def summarize(samples,orientation):
    require(orientation in ORDERS and len(samples)==2400,'complete samples/ orientation')
    p95={a:[] for a in ('candidate','reference')};last=-1
    for b,arms in enumerate(ORDERS[orientation]):
        for s,a in enumerate(arms):
            block=samples[(b*2+s)*400:(b*2+s+1)*400]
            for i,x in enumerate(block):
                require(type(x['index']) is int and type(x['batch']) is int,'integer coordinates')
                require((x['batch'],x['arm'],x['index'],x['phase'],x['segment'])==(b,a,i,'warmup' if i<100 else 'measured',f'cold-P2-summary/{b}/{a}/{i}'),'sample identity')
                require(all(type(x[k]) in (int,float) and math.isfinite(x[k]) and x[k]>=0 for k in ('start','end','ms','constructionMs','preparationMs')),'finite clocks')
                require(x['ms']==x['end']-x['start'] and x['constructionMs']==x['preparationMs']==0 and x['start']>=last,'cold clocks')
                last=x['end']
            p95[a].append(sorted(x['ms'] for x in block[100:])[284])
    require(all(x>0 for arm in p95.values() for x in arm),'positive p95')
    return dict(p95=p95,legacySlotRatio=statistics.median(p95['candidate'])/statistics.median(p95['reference']))

def paired(rows):
    require(len(rows)==2 and {x['orientation'] for x in rows}=={'U','V'},'complete complementary pair')
    require(all(rows[0][k]==rows[1][k] for k in ('panel','pair','category','kind')),'pair identity')
    by={x['orientation']:x for x in rows}
    q={'first':[],'second':[]}
    for b in range(3):
        for s,name in enumerate(q):
            c='U' if ORDERS['U'][b][s]=='candidate' else 'V'
            q[name].append(by[c]['p95']['candidate'][b]/by['V' if c=='U' else 'U']['p95']['reference'][b])
    g={k:statistics.median(v) for k,v in q.items()}
    return dict(panel=rows[0]['panel'],pair=rows[0]['pair'],category=rows[0]['category'],firstOrientation=rows[0]['orientation'],q=q,g=g,T=max(g.values()))

def interval(values):
    require(len(values)==16 and all(type(v) in (int,float) and math.isfinite(v) and v>0 for v in values),'16 finite positive values')
    x=sorted(values);return dict(lower=x[1],point=(x[7]+x[8])/2,upper=x[14])

def panel_summary(pairs,panel):
    require(len(pairs)==20 and [x['pair'] for x in pairs]==list(range(20)) and all(x['panel']==panel for x in pairs),'panel completeness')
    controls=[x for x in pairs if x['category']=='control'];main=[x for x in pairs if x['category']=='main']
    require(len(controls)==4 and len(main)==16,'panel categories')
    stable=all(1/1.05<=g<=1.05 for x in controls for g in x['g'].values())
    bands={s:interval([x['g'][s] for x in main]) for s in ('first','second')}
    bands['T']=interval([x['T'] for x in main])
    signal=all(b['lower']>=1/1.05 and b['upper']<=1.05 for b in bands.values()) if panel=='Z' else all(b['lower']>1.20 for b in bands.values())
    groups={orientation:[x['pair'] for x in main if x['firstOrientation']==orientation] for orientation in ('U','V')}
    return dict(panel=panel,controlStable=stable,signalPassed=signal,passed=stable and signal,intervals=bands,mainOrderGroups=groups)

def check_child(job,cell,pid):
    require(read(job/'config.json')==config_for(job,cell),'config')
    require((job/'entry.mjs').read_text()==entry_source(job,cell),'entry source')
    require([json.loads(x) for x in (job/'entry-events.jsonl').read_text().splitlines()]==[dict(module=m,pid=pid) for m in ('N','M0','M1')],'load mapping')
    meta=read(job/'worker.json')
    require(meta['pid']==pid and meta['node']=='v24.18.0' and meta['control']==(cell['kind']=='control') and meta['row']==ROW,'metadata')
    require(meta['recipe']=={**RECIPE,'orders':ORDERS[cell['orientation']]},'recipe')
    require(read(job/'preflight.json')['passed'] is True,'preflight')
    require(read(job/'preflight-first.json')==dict(module=0,pid=pid),'preflight first')
    require(read(job/'preflight-order.json')==dict(modules=[0,1],pid=pid),'preflight order')
    require(read(job/'recipe-after.json')==dict(pid=pid,recipe=RECIPE),'namespace recipe preserved')
    require(read(job/'completion.json')==dict(completed=True,samples=2400),'completion')
    require('PRESET_PERFORMANCE_ROW_DONE cold-P2-summary 2400' in (job/'stdout.log').read_text(),'sentinel')
    return summarize([json.loads(x) for x in (job/'samples.jsonl').read_text().splitlines()],cell['orientation'])

def wake():
    return subprocess.check_output(['/usr/sbin/sysctl','-n','kern.waketime'],text=True,timeout=5).strip()

def execute_child(argv,job,env,record,timeout):
    child=None;child_error=None;wake_error=None
    try:
        with (job/'stdout.log').open('xb') as out,(job/'stderr.log').open('xb') as err:
            child=subprocess.Popen(argv,cwd=job,env=env,stdout=out,stderr=err)
            child.wait(timeout=timeout)
    except BaseException as error:
        child_error=f'{type(error).__name__}: {error}'
    finally:
        if child is not None and child.poll() is None: child.kill();child.wait()
        record.update(pid=None if child is None else child.pid,exitCode=None if child is None else child.returncode,endMonotonic=time.monotonic(),endWall=time.time(),wakeAfter=None)
        try: record['wakeAfter']=wake()
        except BaseException as error: wake_error=f'{type(error).__name__}: {error}'
        record.update(childError=child_error,wakeError=wake_error)
        put(job/'exit.json',record)
    return record


def run():
    require(not OUTPUT.exists() and not OUTPUT.is_symlink(),'single-use reservation consumed')
    require(OUTPUT.parent.resolve()==OUTPUT.parent,'canonical output')
    approval=read(APPROVAL)
    require(approval['designDigest']=='sha256:'+digest((ROOT/approval['design']).read_bytes()),'design approval')
    require((approval['maxProcesses'],approval['maxSamples'],approval['maxSecondsPerChild'],approval['maxSecondsTotal'],approval['retries'])==(80,192000,30,900,0),'approval bounds')
    require(approval['output']==str(OUTPUT.relative_to(ROOT)) and approval['panels']==['Z','M'],'approval scope')
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.mkdir();began=time.monotonic();rows=[];pairs=[];panels=[];attempted=[];stopped=None;cells=[];stage='materials';position=None
    try:
        materials,bindings=h.archive_materials()
        require(not any(os.environ.get(k) for k in ('NODE_OPTIONS','NODE_COMPILE_CACHE','NODE_V8_COVERAGE')),'implicit runtime options')
        env={k:os.environ[k] for k in ('PATH','HOME','TMPDIR','LANG','LC_ALL','TZ') if k in os.environ}
        node=str(Path(shutil.which('node')).resolve())
        runtime=json.loads(subprocess.check_output([node,'-p','JSON.stringify({node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch})'],env=env,timeout=10))
        require(runtime['node']=='v24.18.0' and runtime['v8']=='13.6.233.17-node.50' and runtime['platform']=='darwin','runtime drift')
        stage='qualification'
        qualification=read(DOC/'qualification.json')
        hashes={name:digest((ROOT/'scripts'/name).read_bytes()) for name in SOURCES}
        require(qualification['passed'] is True and qualification['sourceDigests']==hashes,'qualified source binding')
        require(qualification['designDigest']==approval['designDigest'],'qualified design')
        for name,value in qualification['logs'].items(): require(digest((DOC/name).read_bytes())==value,'qualification evidence')
        entropy=secrets.token_bytes(5);bits=[(b>>shift)&1 for b in entropy for shift in range(8)];cells=schedule(bits)
        wake_at_start=wake()
        reservation=dict(status='reserved',approvalDigest=digest(APPROVAL.read_bytes()),executionRoot=str(OUTPUT),runtime=runtime,executable=node,executableDigest=digest(Path(node).read_bytes()),sourceDigests=hashes,archiveBindings=bindings,qualificationDigest=digest((DOC/'qualification.json').read_bytes()),entropyHex=entropy.hex(),orderBits=bits,schedule=cells,implicitNodeOptions={},childEnvironmentKeys=sorted(env),wakeAtStart=wake_at_start,startMonotonic=began,loadAverage=os.getloadavg())
        put(OUTPUT/'reservation.json',reservation)
        stage='snapshot'
        (OUTPUT/'source').mkdir();(OUTPUT/'qualification').mkdir()
        for name in SOURCES: (OUTPUT/'source'/name).write_bytes((ROOT/'scripts'/name).read_bytes())
        for name in ['qualification.json',*qualification['logs']]: (OUTPUT/'qualification'/name).write_bytes((DOC/name).read_bytes())
        (OUTPUT/'approval.json').write_bytes(APPROVAL.read_bytes())
        (OUTPUT/'approved-design.md').write_bytes((ROOT/approval['design']).read_bytes())
        for name,data in materials.items(): (OUTPUT/name).write_bytes(data)
        for label,args in [('derivation',[str(ROOT/'scripts/derive-causal-position-driver.mjs'),str(OUTPUT/'worker.mjs'),str(OUTPUT/'position.mjs'),str(OUTPUT/'derivation.json')]),('source-check',[str(ROOT/'scripts/check-causal-position-source.mjs'),str(OUTPUT/'worker.mjs'),str(OUTPUT/'position.mjs')])]:
            stage=label
            command=subprocess.run([node,*args],capture_output=True,text=True,env=env,timeout=15)
            put(OUTPUT/f'{label}-command.json',dict(exitCode=command.returncode,stdout=command.stdout,stderr=command.stderr));require(command.returncode==0,label)
            if label=='source-check': put(OUTPUT/'source-check.json',json.loads(command.stdout))
        material_hashes={name:digest((OUTPUT/name).read_bytes()) for name in ['position.mjs','worker.mjs','worker-copy.mjs','P2-inputs.json']}
        put(OUTPUT/'runtime-materials.json',material_hashes)
        for cell in cells:
            stage='pre-dispatch';position=cell['position']
            if cell['panel']=='M' and len(panels)==1 and not panels[0]['passed']: break
            for name,value in material_hashes.items(): require(digest((OUTPUT/name).read_bytes())==value,'runtime material drift')
            require(wake()==wake_at_start,'host sleep before dispatch')
            job=OUTPUT/f"{cell['position']:02d}-{cell['panel']}-{cell['pair']:02d}-{cell['orientation']}";job.mkdir()
            put(job/'config.json',config_for(job,cell));(job/'entry.mjs').write_text(entry_source(job,cell))
            argv=[node,*FLAGS,str(job/'entry.mjs')];start=time.monotonic();wall=time.time();remaining=900-(start-began)
            require(remaining>0,'whole-attempt deadline')
            record=dict(**cell,argv=argv,cwd=str(job),startMonotonic=start,startWall=wall,wakeBefore=wake_at_start)
            put(job/'dispatch.json',record);attempted.append(cell['position'])
            stage='child'
            record=execute_child(argv,job,env,record,min(30,remaining))
            child_error,wake_error=record['childError'],record['wakeError']
            stage='post-exit'
            require(child_error is None and wake_error is None,f'child/wake observation: {child_error}; {wake_error}')
            require(record['exitCode']==0,'child failure')
            require(record['wakeAfter']==wake_at_start,'host sleep during dispatch')
            require(0<=record['endMonotonic']-start<=min(30,remaining) and 0<=record['endWall']-wall<=min(30,remaining)+1,'child deadline')
            require(abs((record['endWall']-wall)-(record['endMonotonic']-start))<=1,'wall/monotonic discontinuity')
            stage='validate-child'
            rows.append(dict(**cell,**check_child(job,cell,record['pid'])))
            if len(rows)%2==0:
                pairs.append(paired(rows[-2:]));print(json.dumps(pairs[-1]),flush=True)
            if len(rows)%40==0:
                panels.append(panel_summary(pairs[-20:],cell['panel']));print(json.dumps(panels[-1]),flush=True)
        stage='complete'
        require(time.monotonic()-began<=900,'whole-attempt deadline')
    except BaseException as error:
        stopped=f'{type(error).__name__}: {error}'
        put(OUTPUT/'failure.json',dict(stage=stage,position=position,verifiedRows=len(rows),error=stopped))
        if not (OUTPUT/'reservation.json').exists(): put(OUTPUT/'reservation.json',dict(status='preparation-failed',approvalDigest=digest(APPROVAL.read_bytes()),executionRoot=str(OUTPUT),reason=stopped))
    finally:
        status='invalid' if stopped else 'method-qualified' if len(panels)==2 and all(x['passed'] for x in panels) else 'method-not-qualified'
        result=dict(status=status,rows=rows,pairs=pairs,panels=panels,stopReason=stopped,attempted=attempted,notRun=[p for p in range(80) if p not in attempted],samples=len(rows)*2400,elapsedSeconds=time.monotonic()-began,methodQualification=status=='method-qualified',consumerPerformanceQualification=False,eventAssociation='unknown: retained native clocks uncalibrated')
        put(OUTPUT/'result.json',result)
        put(OUTPUT/'artifact-index.json',dict(files={str(p.relative_to(OUTPUT)):digest(p.read_bytes()) for p in sorted(OUTPUT.rglob('*')) if p.is_file()}))
        print('CAUSAL_POSITION_PAIRS_DONE',status,flush=True)
    return 1 if stopped else 0

if __name__=='__main__':
    require(sys.argv[1:]==['--run-approved'],'explicit single-use invocation required');sys.exit(run())
