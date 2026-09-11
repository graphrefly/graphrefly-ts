"""Single-use approved D/R release diagnostic. No dispatch on import."""
import hashlib, importlib.util, json, os, shutil, subprocess, sys, tarfile, time, uuid
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
DOC=ROOT/'docs/design/causal-release-boundaries-v1-implementation'
OUTPUT=ROOT/'archive/evals/causal-release-boundaries-v1/run'
FIRST=['D-U','R-V','D-V','R-U'];SCHEDULE=FIRST+FIRST[::-1]
FLAGS=['--trace-gc','--trace-deopt','--log-deopt','--no-logfile-per-isolate','--logfile=v8.log']
NEW=['causal-release-diagnostic.py','derive-causal-release.mjs','causal-release-observer.mjs','verify-causal-release.py','causal-release.test.mjs','causal-release.test.py','causal-release-paths.test.mjs']
OLD=['causal-cleanup-observer.mjs','verify-causal-cleanup.py','causal-cpu-observer.mjs','verify-causal-cpu.py','verify-causal-position-pairs.py','verify-causal-block-history.py','verify-causal-control-crossover.py','causal-control-crossover.py']
SOURCES=['scripts/'+p for p in NEW+OLD]
ROW=dict(id='cold-P2-summary',group='cold',profile='P2',mode='summary')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def put(p,x):p.write_text(json.dumps(x,indent=2,allow_nan=False)+'\n')
def require(x,m):
    if not x:raise ValueError(m)
def wake():return subprocess.check_output(['/usr/sbin/sysctl','-n','kern.waketime'],text=True,timeout=5).strip()
def size(root):return sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
def entry(root,job,mode):
    require(mode in ('D','R'),'entry mode')
    prefix='derived-' if mode=='D' else 'release-'
    s='import assert from "node:assert/strict";\nimport {readFileSync,appendFileSync} from "node:fs";\n'
    for name,file in [('n','observed.mjs'),('m0',prefix+'worker.mjs'),('m1',prefix+'worker-copy.mjs')]:
        s+=f'const {name}=await import({json.dumps((root/file).as_uri())});\n'
        s+=f'appendFileSync({json.dumps(str(job/"entry-events.jsonl"))},JSON.stringify({{module:{json.dumps(name)},pid:process.pid}})+"\\n");\n'
    s+=f'const config=JSON.parse(readFileSync({json.dumps(str(job/"config.json"))},"utf8"));\n'
    s+='assert.deepEqual(m0.RECIPE,m1.RECIPE);const original=JSON.stringify(m0.RECIPE);\n'
    s+=f'const {{createObserver}}=await import({json.dumps((root/"source/scripts/causal-cpu-observer.mjs").as_uri())});\n'
    s+=f'const {{createGaps,finishBoth}}=await import({json.dumps((root/"source/scripts/causal-cleanup-observer.mjs").as_uri())});\n'
    if mode=='R':s+=f'const {{createReleaseGaps}}=await import({json.dumps((root/"source/scripts/causal-release-observer.mjs").as_uri())});\n'
    s+='const observer=createObserver(config),gaps='+('createGaps' if mode=='D' else 'createReleaseGaps')+'(config);let primary=null;\n'
    s+=f'try {{await n.runRow({json.dumps(str(job/"config.json"))},[m0,m1],observer,gaps);}} catch(error){{primary=error;throw error;}}\n'
    s+='finally {finishBoth(observer,gaps,primary);}\n'
    s+='assert.equal(JSON.stringify(m0.RECIPE),original);assert.equal(JSON.stringify(m1.RECIPE),original);\n'
    return s
def execute(argv,job,env,record,root,deadline):
    child=None;primary=None;wake_error=None;finalization=[]
    try:
        with (job/'stdout.log').open('xb') as out,(job/'stderr.log').open('xb') as err:
            require(time.monotonic()<deadline and size(root)<=268435456,'pre-spawn budget')
            child=subprocess.Popen(argv,cwd=job,env=env,stdout=out,stderr=err)
            while True:
                require(time.monotonic()<min(deadline,record['startMonotonic']+30),'deadline')
                require(size(root)<=268435456,'output soft ceiling')
                try:child.wait(timeout=.1);break
                except subprocess.TimeoutExpired:pass
    except BaseException as error:primary=f'{type(error).__name__}: {error}'
    finally:
        try:
            if child is not None and child.poll() is None:child.kill();child.wait(timeout=5)
        except BaseException as error:finalization.append(f'termination: {type(error).__name__}: {error}')
        record.update(pid=None if child is None else child.pid,exitCode=None if child is None else child.returncode,endMonotonic=time.monotonic(),endWall=time.time(),childError=primary,wakeAfter=None,wakeError=None)
        try:record['wakeAfter']=wake()
        except BaseException as error:wake_error=f'{type(error).__name__}: {error}'
        record['wakeError']=wake_error;record['finalizationErrors']=finalization
        try:put(job/'exit.json',record)
        except BaseException as error:
            finalization.append(f'exit write: {type(error).__name__}: {error}')
            raise RuntimeError(json.dumps(record)) from error
    return record
def run():
    require(not OUTPUT.exists() and not OUTPUT.is_symlink(),'single-use output already consumed');require(OUTPUT.parent.resolve()==OUTPUT.parent,'canonical output parent');OUTPUT.mkdir(parents=True)
    start=time.monotonic();stage='approval';position=None;attempted=[];rows=[];fixture=None;error=None
    def budget():
        require(time.monotonic()<start+900,'whole attempt deadline');require(size(OUTPUT)<=268435456,'output soft ceiling')
    put(OUTPUT/'reservation.json',dict(status='preparing',executionRoot=str(OUTPUT),startMonotonic=start,schedule=SCHEDULE))
    try:
        approval=read(DOC/'approval.json');require(approval['design']=='docs/design/causal-release-boundaries-v1.md' and approval['designDigest']=='sha256:11b753d7a9682d1ab9cd951c1c8e828ab663da6b5ac981354e6e51b31db9b069' and approval['designDigest']=='sha256:'+sha(ROOT/approval['design']),'design binding')
        require(approval['maxOutputBytes']==268435456 and approval['checkIntervalMs']==100,'output budget binding')
        require(approval['proposalCommit']=='720f9b18' and [approval[k] for k in ['maxConsumerProcesses','maxFixtureProcesses','maxSamples','maxSecondsPerChild','maxSecondsTotal','retries']]==[8,0,19200,30,900,0],'scope')
        require(approval['output']==str(OUTPUT.relative_to(ROOT)),'output approval');shutil.copyfile(DOC/'approval.json',OUTPUT/'approval.json');shutil.copyfile(ROOT/approval['design'],OUTPUT/'approved-design.md')
        require(not any(os.environ.get(k) for k in ('NODE_OPTIONS','NODE_COMPILE_CACHE','NODE_V8_COVERAGE')),'implicit Node options')
        env={k:os.environ[k] for k in ('PATH','HOME','TMPDIR','LANG','LC_ALL','TZ') if k in os.environ}
        node=str(Path(shutil.which('node')).resolve());stage='qualification'
        q=read(DOC/'qualification.json');hashes={p:sha(ROOT/p) for p in SOURCES}
        require(q['sourceDigests']==hashes and q['passed'] is True and q['designDigest']==approval['designDigest'],'qualified tool source')
        for name,digest in q['logs'].items():require(sha(DOC/name)==digest,'qualification logs')
        runtime=json.loads(subprocess.check_output([node,'-p','JSON.stringify({node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch})'],env=env,text=True,timeout=10))
        require(runtime['node']=='v24.18.0' and runtime['v8']=='13.6.233.17-node.50' and runtime['platform']=='darwin','runtime')
        w=wake();run_id=str(uuid.uuid4())
        reservation=dict(status='reserved',executionRoot=str(OUTPUT),startMonotonic=start,approvalDigest=sha(DOC/'approval.json'),qualificationDigest=sha(DOC/'qualification.json'),sourceDigests=hashes,runtime=runtime,executable=node,executableDigest=sha(Path(node)),schedule=SCHEDULE,run=run_id,wakeAtStart=w,implicitNodeOptions={},childEnvironmentKeys=sorted(env),loadAverage=os.getloadavg())
        put(OUTPUT/'reservation.json',reservation);stage='snapshot'
        for p in SOURCES:
            budget();target=OUTPUT/'source'/p;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/p,target)
        (OUTPUT/'qualification').mkdir()
        for name in ['qualification.json',*q['logs']]:shutil.copyfile(DOC/name,OUTPUT/'qualification'/name)
        stage='materials';archive=ROOT/'archive/evals/causal-cleanup-segments-v1'
        require(sha(archive/'evidence.tar.gz')=='f854a39e4af9e6989f357addf83939f4754b939492a6db2d9c2b67f91db6b2ac','archive')
        require(sha(archive/'artifact-index.json')=='aa843f453f5403c745531533e787a3bd81e0c12211eed40491c118a52b820123','index')
        index=read(archive/'artifact-index.json')['files'];seen=set()
        with tarfile.open(archive/'evidence.tar.gz') as tf:
            for m in tf:
                budget();require(m.isfile() and m.name in index and m.name not in seen,'archive member');data=tf.extractfile(m).read();seen.add(m.name)
                require('sha256:'+hashlib.sha256(data).hexdigest()==index[m.name],'archive bytes')
                if m.name in ['run/'+n for n in ['worker.mjs','worker-copy.mjs','derived-worker.mjs','derived-worker-copy.mjs','position.mjs','observed.mjs','P2-inputs.json','reference-qualification.json']]: (OUTPUT/Path(m.name).name).write_bytes(data)
        require(seen==set(index),'full archive')
        for source,target in [('derived-worker.mjs','release-worker.mjs'),('derived-worker-copy.mjs','release-worker-copy.mjs')]:
            command=subprocess.run([node,str(OUTPUT/'source/scripts/derive-causal-release.mjs'),str(OUTPUT/source),str(OUTPUT/target)],capture_output=True,text=True,env=env,timeout=min(15,max(.01,start+900-time.monotonic())))
            put(OUTPUT/(target+'.derivation.json'),dict(exitCode=command.returncode,stdout=command.stdout,stderr=command.stderr));require(command.returncode==0,'derivation')
        materials={name:sha(OUTPUT/name) for name in ['worker.mjs','worker-copy.mjs','derived-worker.mjs','derived-worker-copy.mjs','position.mjs','observed.mjs','release-worker.mjs','release-worker-copy.mjs','P2-inputs.json','reference-qualification.json']};put(OUTPUT/'materials.json',materials)
        stage='admission'
        checked=subprocess.run([sys.executable,str(OUTPUT/'source/scripts/verify-causal-release.py'),'--admission',str(OUTPUT)],capture_output=True,text=True,env=env,timeout=min(30,max(.01,start+900-time.monotonic())))
        put(OUTPUT/'admission-command.json',dict(exitCode=checked.returncode,stdout=checked.stdout,stderr=checked.stderr));require(checked.returncode==0,'independent pre-dispatch admission')
        for position,cell in enumerate(SCHEDULE):
            stage='pre-dispatch';require(wake()==w,'host sleep before dispatch')
            budget()
            for name,digest in materials.items():require(sha(OUTPUT/name)==digest,'material drift')
            for name,digest in hashes.items():require(sha(OUTPUT/'source'/name)==digest,'source drift')
            require(sha(Path(node))==reservation['executableDigest'],'executable drift');budget()
            checked=subprocess.run([sys.executable,str(OUTPUT/'source/scripts/verify-causal-release.py'),'--prefix',str(OUTPUT),str(position)],capture_output=True,text=True,env=env,timeout=min(30,max(.01,start+900-time.monotonic())))
            put(OUTPUT/f'prefix-{position}.json',dict(exitCode=checked.returncode,stdout=checked.stdout,stderr=checked.stderr));require(checked.returncode==0,'independent prefix admission')
            mode=cell[0];orientation=cell[-1]
            job=OUTPUT/f'{position:02d}-{cell}';job.mkdir()
            script=job/'entry.mjs';script.write_text(entry(OUTPUT,job,mode))
            config=dict(output=str(job),run=run_id+f'-{position}',sourceDigest=sha(script),mode='Q',gapMode='D',releaseMode=mode,profile='consumer',orientation=orientation)
            config.update(row=ROW,kind='control',control=True,scenarioPath=str(OUTPUT/'P2-inputs.json'))
            put(job/'config.json',config)
            argv=[node,*FLAGS,str(script)]
            record=dict(position=position,cell=cell,argv=argv,cwd=str(job),startMonotonic=time.monotonic(),startWall=time.time(),wakeBefore=w)
            budget();put(job/'dispatch.json',record);attempted.append(position);stage='child'
            ex=execute(argv,job,env,record,OUTPUT,start+900)
            require(ex['childError'] is None and ex['wakeError'] is None and ex['finalizationErrors']==[],'child/wake/finalization failure')
            require(ex['exitCode']==0 and ex['wakeAfter']==w,'exit/sleep')
            require(0<=ex['endMonotonic']-ex['startMonotonic']<=30 and abs((ex['endWall']-ex['startWall'])-(ex['endMonotonic']-ex['startMonotonic']))<=1,'time continuity')
            require(size(OUTPUT)<=268435456,'output soft ceiling');stage='validate'
            budget()
            checked=subprocess.run([sys.executable,str(OUTPUT/'source/scripts/verify-causal-release.py'),'--job',str(OUTPUT),str(position)],capture_output=True,text=True,env=env,timeout=min(30,max(.01,start+900-time.monotonic())))
            put(job/'independent-command.json',dict(exitCode=checked.returncode,stdout=checked.stdout,stderr=checked.stderr));require(checked.returncode==0,'independent child verification')
            samples=[json.loads(line) for line in (job/'samples.jsonl').read_text().splitlines()]
            require(len(samples)==2400 and read(job/'completion.json')==dict(completed=True,samples=2400),'sample completion')
            require(read(job/'preflight.json')['passed'] is True,'preflight')
            rows.append(dict(position=position,cell=cell,samples=2400));print('RELEASE_DIAGNOSTIC_CHILD_DONE',position,cell,flush=True)
        stage='complete';require(time.monotonic()-start<=900,'whole attempt deadline');require(size(OUTPUT)<=268435456,'output soft ceiling')
    except BaseException as ex:
        error=f'{type(ex).__name__}: {ex}'
        put(OUTPUT/'failure.json',dict(stage=stage,position=position,error=error,verifiedRows=len(rows)))
    finally:
        captured=sum(len(p.read_bytes().splitlines()) for p in OUTPUT.glob('*/samples.jsonl'))
        result=dict(capturedSamples=captured,status='complete-diagnostic' if error is None and len(rows)==8 else 'incomplete',fixture=fixture,rows=rows,attempted=attempted,notRun=[p for p in list(range(8)) if p not in attempted],samples=len(rows)*2400,elapsedSeconds=time.monotonic()-start,stopReason=error,performanceQualification=False,retries=0)
        put(OUTPUT/'result.json',result)
        inventory={str(p.relative_to(OUTPUT)):sha(p) for p in sorted(OUTPUT.rglob('*')) if p.is_file()}
        result['elapsedSeconds']=time.monotonic()-start
        if result['elapsedSeconds']>900 or size(OUTPUT)>268435456:
            result['status']='incomplete';result['stopReason']=result['stopReason'] or 'finalization budget exceeded'
            if not (OUTPUT/'failure.json').exists():put(OUTPUT/'failure.json',dict(stage='complete',position=position,error=result['stopReason'],verifiedRows=len(rows)))
        put(OUTPUT/'result.json',result)
        inventory['result.json']=sha(OUTPUT/'result.json')
        if (OUTPUT/'failure.json').exists():inventory['failure.json']=sha(OUTPUT/'failure.json')
        put(OUTPUT/'artifact-index.json',dict(files=inventory));print('CAUSAL_RELEASE_DIAGNOSTIC_DONE',result['status'],flush=True)
    return 0 if result['status']=='complete-diagnostic' else 1
if __name__=='__main__':
    require(sys.argv[1:]==['--run-approved'],'explicit single-use invocation');sys.exit(run())
