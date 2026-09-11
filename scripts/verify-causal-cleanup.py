"""Independent raw/source verifier. Never imports collector or generated consumers."""
import sys, json, hashlib, math, statistics, importlib.util, re
from pathlib import Path
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('cpu_raw',Path(__file__).with_name('verify-causal-cpu.py'))
cpu=importlib.util.module_from_spec(spec);spec.loader.exec_module(cpu)
old=cpu.old
SCHEDULE=['B-U','S-V','D-U','B-V','S-U','D-V','D-V','S-U','B-V','D-U','S-V','B-U']
SOURCES=['causal-cleanup-diagnostic.py','derive-causal-cleanup.mjs','causal-cleanup-observer.mjs','verify-causal-cleanup.py','causal-cleanup.test.mjs','causal-cleanup.test.py','causal-cpu-observer.mjs','verify-causal-cpu.py','verify-causal-position-pairs.py','verify-causal-block-history.py','verify-causal-control-crossover.py','causal-control-crossover.py']
DESIGN='dc16c47f22e8f0a0950afc8768383d3ff57c72ee2e132b8afbc4541b3d13f969'
FLAGS=['--trace-gc','--trace-deopt','--log-deopt','--no-logfile-per-isolate','--logfile=v8.log']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text())
def check_source(original,derived,worker,deep):
    assert hashlib.sha256(original.encode()).hexdigest()=='b192d7bef7434b1241dc78d806b26950bcbf4fd5a62af3085611d65797ef08e9'
    assert hashlib.sha256(worker.encode()).hexdigest()==old.h.BUNDLE
    # Reverse the bounded additions, independently of the generator implementation.
    for token in ['function cleanupAll(runs, primary, diagnostic) {','run?.cleanup(diagnostic);','export async function runRow(configPath, modules, observer, gaps) {','cleanupAll([run], sampleFailure, deep);']:assert derived.count(token)==1
    lines=[l for l in derived.splitlines(keepends=True) if not l.rstrip().endswith('// GAP')]
    clean=''.join(lines).replace('function cleanupAll(runs, primary, diagnostic) {','function cleanupAll(runs, primary) {').replace('run?.cleanup(diagnostic);','run?.cleanup();').replace('export async function runRow(configPath, modules, observer, gaps) {','export async function runRow(configPath, modules) {').replace('cleanupAll([run], sampleFailure, deep);','cleanupAll([run], sampleFailure);')
    assert clean==original,'business driver source changed'
    marked=[l.strip() for l in derived.splitlines() if l.rstrip().endswith('// GAP')]
    expected=[
      'const observationName = `b${batch2}s${arms.indexOf(arm)}-${index < 100 ? "warmup" : "measured"}`;',
      'if (index === 0 || index === 100) observer.start(observationName);',
      'const gap = gaps.begin({batch:batch2, arm, index, phase:index < 100 ? "warmup" : "measured"});',
      'gap.y0 = performance2.now();','gap.y1 = performance2.now();','gap.m0 = performance2.now();',
      'gap.m1 = performance2.now();','gap.start = start; gap.end = end;',
       'gap.r0 = performance2.now();','gap.r1 = performance2.now();',
      'let diagnosticFailure, cleanupFailure, deep;', 'try {', 'gap.c0 = performance2.now();', 'deep = gaps.deep(gap);',
      '} catch (error) { diagnosticFailure = error; }', 'try {', '} catch (error) { cleanupFailure = error; }',
      'try { gap.c1 = performance2.now(); } catch (error) { diagnosticFailure = new AggregateError([diagnosticFailure, error].filter(Boolean), "diagnostic clocks"); }',
      'if (cleanupFailure || diagnosticFailure) gaps.fail(sampleFailure, cleanupFailure, diagnosticFailure);', 'gaps.append(gap, sampleFailure);', 
      'if (index === 99 || index === 399) observer.end(observationName);']
    assert marked==[x+' // GAP' for x in expected]
    anchors=[('gap.y0 = performance2.now(); // GAP','await setImmediate();','gap.y1 = performance2.now(); // GAP'),('gap.m0 = performance2.now(); // GAP','const memoryBefore = process.memoryUsage();','const start = performance2.now();'),('const end = performance2.now();','const memoryAfter = process.memoryUsage();','gap.m1 = performance2.now(); // GAP')]
    compact=[l.strip() for l in derived.splitlines()]
    for group in anchors:
        i=compact.index(group[0]);assert compact[i:i+len(group)]==list(group)
    assert 'gap.r0 = performance2.now(); // GAP\n            record({' in derived
    assert 'memoryAfter\n            });\n            gap.r1 = performance2.now(); // GAP' in derived
    clean=''.join(l for l in deep.splitlines(keepends=True) if not l.rstrip().endswith('// GAP'))
    clean=clean.replace('cleanup: (diagnostic) => {','cleanup: () => {').replace('      const snapshot = graph.describe();\n','').replace('for (const n of snapshot.nodes)','for (const n of graph.describe().nodes)')
    assert clean==worker,'business worker source changed'
    expected_deep=['cleanup: (diagnostic) => {','if (diagnostic) diagnostic.d0 = diagnostic.now(); // GAP','disconnect();','for (const root of owner.roots) root.unsubscribe?.();','if (diagnostic) diagnostic.d1 = diagnostic.now(); // GAP','const group = graph.topologyGroup();','const snapshot = graph.describe();','if (diagnostic) diagnostic.d2 = diagnostic.now(); // GAP','for (const n of snapshot.nodes) group.add(graph.find(n.id));','if (diagnostic) diagnostic.d3 = diagnostic.now(); // GAP','group.release();','if (diagnostic) diagnostic.d4 = diagnostic.now(); // GAP','}']
    compact=[l.strip() for l in deep.splitlines()];i=compact.index(expected_deep[0]);assert compact[i:i+len(expected_deep)]==expected_deep
    assert sum(l.rstrip().endswith('// GAP') for l in deep.splitlines())==5

def expected_entry(root,job,mode):
    s='import assert from "node:assert/strict";\nimport {readFileSync,appendFileSync} from "node:fs";\n'
    for var,name in [('n','position.mjs' if mode=='B' else 'observed.mjs'),('m0',('' if mode=='B' else 'derived-')+'worker.mjs'),('m1',('' if mode=='B' else 'derived-')+'worker-copy.mjs')]:
        s+='const '+var+'=await import('+json.dumps((root/name).as_uri())+');\n'
        s+='appendFileSync('+json.dumps(str(job/'entry-events.jsonl'))+',JSON.stringify({module:'+json.dumps(var)+',pid:process.pid})+"\\n");\n'
    c=json.dumps(str(job/'config.json'))
    s+='const config=JSON.parse(readFileSync('+c+',"utf8"));\nassert.deepEqual(m0.RECIPE,m1.RECIPE);const original=JSON.stringify(m0.RECIPE);\n'
    if mode=='B':s+='await n.runRow('+c+',[m0,m1]);\n'
    else:
        s+='const {createObserver}=await import('+json.dumps((root/'source/scripts/causal-cpu-observer.mjs').as_uri())+');\n'
        s+='const {createGaps,finishBoth}=await import('+json.dumps((root/'source/scripts/causal-cleanup-observer.mjs').as_uri())+');\n'
        s+='const observer=createObserver(config),gaps=createGaps(config);let primary=null;\n'
        s+='try {await n.runRow('+c+',[m0,m1],observer,gaps);} catch(error){primary=error;throw error;}\nfinally {finishBoth(observer,gaps,primary);}\n'
    return s+'assert.equal(JSON.stringify(m0.RECIPE),original);assert.equal(JSON.stringify(m1.RECIPE),original);\n'

def distribution(values):
    a=sorted(values);return dict(sumMs=sum(a),p50=statistics.median(a),p95=a[math.ceil(len(a)*.95)-1])

def verify_gaps(g,samples,e,mode):
    assert mode in ('S','D') and g['cpuMode']=='Q' and g['gapMode']==mode and g['units']=='performance-ms'
    assert g['complete'] is True and g['active'] is None and g['error'] is None and len(g['samples'])==2400
    rows=[];last=-1
    for i,(r,s) in enumerate(zip(g['samples'],samples,strict=True)):
        assert set(r)==set(['batch','arm','index','phase','y0','y1','m0','m1','start','end','r0','r1','c0','c1']+(['deep'] if mode=='D' else []))
        for k in ('batch','index'):assert type(r[k]) is int
        for k in ('batch','arm','index','phase','start','end'):assert r[k]==s[k]
        keys=['y0','y1','m0','start','end','m1','r0','r1','c0','c1'];times=[r[k] for k in keys]
        assert all(type(x) in (float,int) and math.isfinite(x) and x>=0 for x in times)
        assert times==sorted(times) and times[0]>=last;last=times[-1]
        w=e['windows'][(i//400)*2+(1 if i%400>=100 else 0)];assert w['start']<=times[0]<=times[-1]<=w['end']
        row={name:r[b]-r[a] for name,a,b in [('yield','y0','y1'),('memoryBefore','m0','start'),('memoryAfter','end','m1'),('record','r0','r1'),('cleanup','c0','c1')]}
        row['withinSampleUnsegmented']=sum(r[b]-r[a] for a,b in [('y1','m0'),('m1','r0'),('r1','c0')])
        if mode=='D':
            assert set(r['deep'])=={f'd{j}' for j in range(5)}
            d=[r['deep'][f'd{j}'] for j in range(5)]
            assert all(type(x) in (float,int) and math.isfinite(x) for x in d)
            assert d==sorted(d) and r['c0']<=d[0]<=d[-1]<=r['c1']
            for j,name in enumerate(['disconnect-roots','group-create-and-describe','membership','group-release']):row[name]=d[j+1]-d[j]
        rows.append(row)
    out=[]
    for n,w in enumerate(e['windows']):
        a=(n//2)*400+(100 if n%2 else 0);b=(n//2)*400+(400 if n%2 else 100)
        data=rows[a:b];raw=g['samples'][a:b]
        edge=w['end']-raw[-1]['c1']+raw[0]['y0']-w['start']
        between=sum(raw[j]['y0']-raw[j-1]['c1'] for j in range(1,len(raw)))
        construction=sum(s['ms'] for s in samples[a:b])
        outer=sum(sum(r[k] for k in ['yield','memoryBefore','memoryAfter','record','cleanup']) for r in data)
        residual=sum(r['withinSampleUnsegmented'] for r in data)+between+edge
        assert math.isclose(construction+outer+residual,w['end']-w['start'],rel_tol=1e-10,abs_tol=1e-8)
        out.append(dict(name=w['name'],segments={k:distribution([r[k] for r in data]) for k in data[0]},phaseEdgesMs=edge,betweenSamplesMs=between,residualMs=residual,constructionMs=construction,outerSegmentsMs=outer,phaseElapsedMs=w['end']-w['start']))
    return out


def admission(root):
    r=read(root/'reservation.json');a=read(root/'approval.json');q=read(root/'qualification/qualification.json')
    assert r['status']=='reserved' and r['schedule']==SCHEDULE and r['implicitNodeOptions']=={}
    assert r['runtime']['node']=='v24.18.0' and r['runtime']['v8']=='13.6.233.17-node.50' and r['runtime']['platform']=='darwin'
    assert a['proposalCommit']=='7c36483a' and a['designDigest']=='sha256:'+DESIGN and sha(root/'approved-design.md')==DESIGN
    assert [a[k] for k in ('maxConsumerProcesses','maxFixtureProcesses','maxSamples','maxSecondsPerChild','maxSecondsTotal','maxOutputBytes','checkIntervalMs','retries')]==[12,0,28800,30,900,268435456,100,0]
    assert a['output']=='archive/evals/causal-cleanup-segments-v1/run'
    assert sha(root/'approval.json')==r['approvalDigest'] and sha(root/'qualification/qualification.json')==r['qualificationDigest']
    hashes={'scripts/'+p:sha(root/'source/scripts'/p) for p in SOURCES}
    assert hashes==r['sourceDigests']==q['sourceDigests'] and q['passed'] is True and q['designDigest']==a['designDigest']
    for p in SOURCES:assert sha(Path(__file__).parent/p)==hashes['scripts/'+p]
    for p,h in q['logs'].items():assert sha(root/'qualification'/p)==h
    for name,h in [('worker.mjs',old.h.BUNDLE),('worker-copy.mjs',old.h.BUNDLE),('P2-inputs.json',old.h.INPUT),('reference-qualification.json',old.h.QUAL)]:assert sha(root/name)==h
    check_source((root/'position.mjs').read_text(),(root/'observed.mjs').read_text(),(root/'worker.mjs').read_text(),(root/'derived-worker.mjs').read_text())
    assert (root/'derived-worker.mjs').read_bytes()==(root/'derived-worker-copy.mjs').read_bytes()
    assert read(root/'materials.json')=={n:sha(root/n) for n in ['worker.mjs','worker-copy.mjs','derived-worker.mjs','derived-worker-copy.mjs','position.mjs','observed.mjs','P2-inputs.json','reference-qualification.json']}
    return r

def job_identity(root,position):
    r=admission(root);physical=Path(r['executionRoot']);cell=SCHEDULE[position];mode,orientation=cell.split('-');name=f'{position:02d}-{cell}';d=root/name;j=physical/name
    assert (d/'entry.mjs').read_text()==expected_entry(physical,j,mode)
    c=dict(output=str(j),run=r['run']+f'-{position}',sourceDigest=sha(d/'entry.mjs'),mode='B' if mode=='B' else 'Q',gapMode=mode,profile='consumer',orientation=orientation,row=old.ROW,kind='control',control=True,scenarioPath=str(physical/'P2-inputs.json'))
    assert read(d/'config.json')==c
    ex=read(d/'exit.json');dispatch=read(d/'dispatch.json')
    assert dispatch=={k:v for k,v in ex.items() if k not in ('pid','exitCode','endMonotonic','endWall','childError','wakeAfter','wakeError','finalizationErrors')}
    assert ex['argv']==[r['executable'],*FLAGS,str(j/'entry.mjs')] and ex['cwd']==str(j) and ex['position']==position and ex['cell']==cell
    return r,d,c,ex

def verify_job(root,position):
    r,d,c,ex=job_identity(root,position);mode,orientation=SCHEDULE[position].split('-');cell=SCHEDULE[position]
    assert type(ex['pid']) is int and ex['pid']>0 and ex['exitCode']==0 and ex['childError'] is None and ex['wakeError'] is None and ex['finalizationErrors']==[] and ex['wakeBefore']==ex['wakeAfter']==r['wakeAtStart']
    span=ex['endMonotonic']-ex['startMonotonic'];assert 0<=span<=30 and abs(ex['endWall']-ex['startWall']-span)<=1
    samples=[json.loads(l) for l in (d/'samples.jsonl').read_text().splitlines()];old.raw_summary(samples,orientation)
    assert read(d/'completion.json')==dict(completed=True,samples=2400)
    assert 'PRESET_PERFORMANCE_ROW_DONE cold-P2-summary 2400' in (d/'stdout.log').read_text()
    assert [json.loads(l) for l in (d/'entry-events.jsonl').read_text().splitlines()]==[dict(module=n,pid=ex['pid']) for n in ('n','m0','m1')]
    assert read(d/'preflight-first.json')==dict(module=0,pid=ex['pid']) and read(d/'preflight-order.json')==dict(modules=[0,1],pid=ex['pid'])
    assert read(d/'preflight.json')['passed'] is True
    m=read(d/'worker.json');assert m['pid']==ex['pid'] and m['node']==r['runtime']['node'] and m['control'] is True and m['row']==old.ROW and m['recipe']=={**old.RECIPE,'orders':[old.order(orientation,b) for b in range(3)]}
    phases=[]
    for n,name in enumerate(cpu.phase_names('consumer')):
        data=samples[(n//2)*400+(100 if n%2 else 0):(n//2)*400+(400 if n%2 else 100)]
        phases.append(dict(name=name,**distribution([s['ms'] for s in data])))
    metrics=None;segments=None
    if mode=='B':assert not any((d/p).exists() for p in ('evidence.json','gaps.json'))
    else:
        e=read(d/'evidence.json');g=read(d/'gaps.json')
        assert e['identity']==dict(run=c['run'],pid=ex['pid'],node=r['runtime']['node'],v8=r['runtime']['v8'],sourceDigest=c['sourceDigest'])
        assert g['identity']==dict(run=c['run'],pid=ex['pid'],sourceDigest=c['sourceDigest'])
        assert e['mode']=='Q' and e['profile']=='consumer' and e['orientation']==orientation
        metrics=cpu.verify_cpu(e,samples);segments=verify_gaps(g,samples,e,mode)
    assert not list(d.glob('trace-*.json'))
    return dict(position=position,cell=cell,samples=2400,blocks=phases,cpu=metrics,segments=segments)

def verify(root):
    inventory=read(root/'artifact-index.json')['files'];actual={}
    for p in root.rglob('*'):
        assert not p.is_symlink()
        if p.is_file() and p!=root/'artifact-index.json':actual[str(p.relative_to(root))]=sha(p)
    assert actual==inventory
    result=read(root/'result.json');attempted=result['attempted'];assert attempted==list(range(len(attempted))) and len(attempted)<=12 and result['notRun']==list(range(len(attempted),12))
    assert result['retries']==0 and result['performanceQualification'] is False and result['fixture'] is None
    failure=read(root/'failure.json') if (root/'failure.json').exists() else None
    if failure:assert result['status']=='incomplete' and failure['error']==result['stopReason'] and failure['verifiedRows']==len(result['rows'])
    else:assert result['status']=='complete-diagnostic' and result['stopReason'] is None and len(attempted)==12
    names={f'{p:02d}-{SCHEDULE[p]}' for p in attempted}
    directories={p.name for p in root.iterdir() if p.is_dir() and p.name not in ('source','qualification')}
    extra=directories-names
    if extra:
        assert failure and failure['stage']=='pre-dispatch' and len(attempted)<12
        next_name=f'{len(attempted):02d}-{SCHEDULE[len(attempted)]}';assert extra=={next_name}
        assert all(p.is_file() and p.name in ('entry.mjs','config.json') for p in (root/next_name).iterdir())
    for name in inventory:
        if Path(name).name in ('dispatch.json','exit.json','samples.jsonl','evidence.json','gaps.json','worker.json','entry-events.jsonl','completion.json'):
            assert len(Path(name).parts)==2 and Path(name).parts[0] in names,'hidden execution artifact'
    if not attempted:
        assert result['status']=='incomplete' and result['rows']==[] and result['samples']==result['capturedSamples']==0 and failure
        return dict(evidenceValid=True,status='incomplete',processes=0,samples=0,reason=result['stopReason'])
    r=admission(root);verified=[];last=r['startMonotonic'];pids=set();failed=None
    for p in attempted:
        _,d,c,ex=job_identity(root,p)
        assert last<=ex['startMonotonic']<r['startMonotonic']+900 and ex['endMonotonic']>=ex['startMonotonic'];last=ex['endMonotonic']
        if ex['pid'] is not None:assert type(ex['pid']) is int and ex['pid']>0 and ex['pid'] not in pids;pids.add(ex['pid'])
        if p<len(result['rows']):
            row=verify_job(root,p);cmd=read(d/'independent-command.json');assert cmd['exitCode']==0 and cmd['stderr']=='';cpu.same(json.loads(cmd['stdout']),dict(evidenceValid=True,**row));verified.append(row)
        else:
            assert p==attempted[-1] and failure and failure['position']==p
            failed=dict(position=p,stage=failure['stage'],error=failure['error'],partialEvidence='retained; whole row unqualified')
            try:verify_job(root,p)
            except (AssertionError,ValueError,KeyError,TypeError,IndexError,OSError):failed['validationFailureReproduced']=True
            else:
                assert failure['stage'] in ('child','validate') or 'ceiling' in failure['error'] or 'deadline' in failure['error']
                if failure['stage']=='validate':assert read(d/'independent-command.json')['exitCode']!=0
                failed['validationFailureReproduced']=False
            if (d/'evidence.json').exists():
                try:
                    raw=[json.loads(l) for l in (d/'samples.jsonl').read_text().splitlines()]
                    e=read(d/'evidence.json');assert e['identity']==dict(run=c['run'],pid=ex['pid'],node=r['runtime']['node'],v8=r['runtime']['v8'],sourceDigest=c['sourceDigest'])
                    failed['arithmeticCPU']=cpu.verify_cpu(e,raw)
                    if (d/'gaps.json').exists():
                        g=read(d/'gaps.json');assert g['identity']==dict(run=c['run'],pid=ex['pid'],sourceDigest=c['sourceDigest'])
                        failed['arithmeticSegments']=verify_gaps(g,raw,e,c['gapMode'])
                except (AssertionError,ValueError,KeyError,TypeError,IndexError,OSError):pass
    assert result['rows']==[dict(position=x['position'],cell=x['cell'],samples=2400) for x in verified]
    assert result['samples']==len(verified)*2400
    assert result['capturedSamples']==sum(len(p.read_bytes().splitlines()) for p in root.glob('*/samples.jsonl'))<=28800
    if result['status']=='complete-diagnostic':assert len(verified)==12 and last-r['startMonotonic']<=result['elapsedSeconds']<=900
    elif failed is None:assert failure['stage'] in ('pre-dispatch','complete')
    return dict(evidenceValid=True,status=result['status'],processes=len(attempted),samples=result['samples'],capturedSamples=result['capturedSamples'],notRun=result['notRun'],rows=verified,failedJob=failed,performanceQualification=False)
if __name__=='__main__':
    try:
        if len(sys.argv)==4 and sys.argv[1]=='--job':out=dict(evidenceValid=True,**verify_job(Path(sys.argv[2]),int(sys.argv[3])))
        else:assert len(sys.argv)==2;out=verify(Path(sys.argv[1]))
    except (AssertionError,ValueError,KeyError,TypeError,IndexError,OSError) as error:
        import traceback
        out=dict(evidenceValid=False,error=str(error),detail=traceback.format_exc())
    print(json.dumps(out,indent=2,allow_nan=False));sys.exit(0 if out['evidenceValid'] else 1)
