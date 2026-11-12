"""Offline independent arithmetic/source qualifications; no consumer execution."""
import sys,json,importlib.util,copy,tempfile,subprocess
from pathlib import Path
spec=importlib.util.spec_from_file_location('v',Path(__file__).with_name('verify-causal-cleanup.py'));v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
def rejected(call):
    try:call()
    except (AssertionError,KeyError,ValueError,TypeError):return
    raise AssertionError('negative survived')
if sys.argv[1]=='--synthetic':
    a=json.loads(Path(sys.argv[2]).read_text());g,s,e,mode=[a[k] for k in ('g','samples','e','mode')]
    out=v.verify_gaps(g,s,e,mode);v.cpu.verify_cpu(e,s)
    assert len(out)==12 and out[0]['segments']['yield']==dict(sumMs=100,p50=1,p95=1)
    if mode=='D':assert out[0]['segments']['group-release']==dict(sumMs=100,p50=1,p95=1)
    negatives=0
    for mutate in [lambda x:x.update(units='seconds'),lambda x:x.update(gapMode='B'),lambda x:x.update(complete=False),lambda x:x.update(active={}),lambda x:x['samples'].pop(),lambda x:x['samples'].append(x['samples'][0]),lambda x:x['samples'][0].update(index=1),lambda x:x['samples'][0].update(batch=True),lambda x:x['samples'][0].update(y0=-1),lambda x:x['samples'][0].update(y0=float('nan')),lambda x:x['samples'][0].update(y0=x['samples'][0]['y1']+1),lambda x:x['samples'][0].update(c1=1e99),lambda x:x['samples'][0].update(start=0),lambda x:x['samples'][0].update(extra=1)]:
        x=copy.deepcopy(g);mutate(x);rejected(lambda:v.verify_gaps(x,s,e,mode));negatives+=1
    if mode=='D':
        for mutate in [lambda x:x['samples'][0]['deep'].pop('d4'),lambda x:x['samples'][0]['deep'].update(d1=-1),lambda x:x['samples'][0]['deep'].update(d4=1e99),lambda x:x['samples'][0]['deep'].update(d0=float('inf')),lambda x:x['samples'][0]['deep'].update(d3=True)]:
            x=copy.deepcopy(g);mutate(x);rejected(lambda:v.verify_gaps(x,s,e,mode));negatives+=1
    if mode=='D' and e['orientation']=='U':
        import shutil
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();physical=root
            material=Path('archive/evals/causal-cpu-wall-diagnostic-v1/run')
            for name in ['worker.mjs','worker-copy.mjs','position.mjs','P2-inputs.json','reference-qualification.json']:shutil.copyfile(material/name,root/name)
            for kind,source,target in [('driver','position.mjs','observed.mjs'),('worker','worker.mjs','derived-worker.mjs'),('worker','worker-copy.mjs','derived-worker-copy.mjs')]:subprocess.run(['node','scripts/derive-causal-cleanup.mjs',kind,str(root/source),str(root/target)],check=True)
            put=lambda p,x:p.write_text(json.dumps(x)+'\n')
            for name in v.SOURCES:
                target=root/'source/scripts'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(Path('scripts')/name,target)
            approval=json.loads(Path('docs/design/causal-cleanup-segments-v1-implementation/approval.json').read_text());put(root/'approval.json',approval);shutil.copyfile(approval['design'],root/'approved-design.md')
            hashes={'scripts/'+n:v.sha(root/'source/scripts'/n) for n in v.SOURCES}
            (root/'qualification').mkdir();put(root/'qualification/qualification.json',dict(passed=True,sourceDigests=hashes,designDigest=approval['designDigest'],logs={}))
            reservation=dict(status='reserved',executionRoot=str(root),schedule=v.SCHEDULE,implicitNodeOptions={},runtime=dict(node='v24.18.0',v8='13.6.233.17-node.50',platform='darwin',arch='arm64'),approvalDigest=v.sha(root/'approval.json'),qualificationDigest=v.sha(root/'qualification/qualification.json'),sourceDigests=hashes,startMonotonic=100,run='fake-run',executable='/fake/node',wakeAtStart='fake-wake')
            put(root/'reservation.json',reservation)
            put(root/'materials.json',{n:v.sha(root/n) for n in ['worker.mjs','worker-copy.mjs','derived-worker.mjs','derived-worker-copy.mjs','position.mjs','observed.mjs','P2-inputs.json','reference-qualification.json']})
            for position,cell in enumerate(v.SCHEDULE):
                m,o=cell.split('-');d=root/f'{position:02d}-{cell}';d.mkdir();pid=1000+position
                (d/'entry.mjs').write_text(v.expected_entry(root,d,m));digest=v.sha(d/'entry.mjs')
                config=dict(output=str(d),run=f'fake-run-{position}',sourceDigest=digest,mode='B' if m=='B' else 'Q',gapMode=m,profile='consumer',orientation=o,row=v.old.ROW,kind='control',control=True,scenarioPath=str(root/'P2-inputs.json'));put(d/'config.json',config)
                dispatch=dict(argv=['/fake/node',*v.FLAGS,str(d/'entry.mjs')],cwd=str(d),position=position,cell=cell,wakeBefore='fake-wake',startMonotonic=101+position,startWall=1001+position)
                put(d/'dispatch.json',dispatch);put(d/'exit.json',dict(**dispatch,pid=pid,exitCode=0,childError=None,wakeError=None,finalizationErrors=[],wakeAfter='fake-wake',endMonotonic=101.1+position,endWall=1001.1+position))
                ss=copy.deepcopy(s);gg=copy.deepcopy(g);ee=copy.deepcopy(e)
                for i,r in enumerate(ss):
                    block,index=divmod(i,400);batch,slot=divmod(block,2);arm=v.old.order(o,batch)[slot]
                    r['arm']=arm;r['segment']=f'cold-P2-summary/{batch}/{arm}/{index}';gg['samples'][i]['arm']=arm
                    if m=='S':gg['samples'][i].pop('deep')
                (d/'samples.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in ss));put(d/'completion.json',dict(completed=True,samples=2400));(d/'stdout.log').write_text('PRESET_PERFORMANCE_ROW_DONE cold-P2-summary 2400');(d/'stderr.log').write_text('')
                (d/'entry-events.jsonl').write_text(''.join(json.dumps(dict(module=n,pid=pid))+'\n' for n in ['n','m0','m1']))
                put(d/'preflight-first.json',dict(module=0,pid=pid));put(d/'preflight-order.json',dict(modules=[0,1],pid=pid));put(d/'preflight.json',dict(passed=True))
                put(d/'worker.json',dict(pid=pid,node='v24.18.0',control=True,row=v.old.ROW,recipe={**v.old.RECIPE,'orders':[v.old.order(o,b) for b in range(3)]}))
                if m!='B':
                    ee['identity']=dict(run=config['run'],pid=pid,node='v24.18.0',v8='13.6.233.17-node.50',sourceDigest=digest);ee['orientation']=o
                    gg['identity']=dict(run=config['run'],pid=pid,sourceDigest=digest);gg['gapMode']=m
                    put(d/'evidence.json',ee);put(d/'gaps.json',gg)
                row=v.verify_job(root,position);put(d/'independent-command.json',dict(exitCode=0,stdout=json.dumps(dict(evidenceValid=True,**row)),stderr=''))
            result=dict(attempted=list(range(12)),notRun=[],retries=0,performanceQualification=False,fixture=None,status='complete-diagnostic',stopReason=None,rows=[dict(position=i,cell=cell,samples=2400) for i,cell in enumerate(v.SCHEDULE)],samples=28800,capturedSamples=28800,elapsedSeconds=20)
            put(root/'result.json',result)
            def index():put(root/'artifact-index.json',dict(files={str(p.relative_to(root)):v.sha(p) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}))
            index();assert v.verify(root)['samples']==28800
            d=root/'02-D-U';config=json.loads((d/'config.json').read_text());bad={**config,'run':'wrong'};put(d/'config.json',bad);rejected(lambda:v.verify_job(root,2));put(d/'config.json',config)
            gaps=json.loads((d/'gaps.json').read_text());bad=copy.deepcopy(gaps);bad['identity']['pid']=999;put(d/'gaps.json',bad);rejected(lambda:v.verify_job(root,2));put(d/'gaps.json',gaps)
            for name in ['hidden/exit.json','source/deeper/gaps.json']:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);put(p,{});index();rejected(lambda:v.verify(root));p.unlink()
                if p.parent.name=='hidden':p.parent.rmdir()
            # A failed last row still has exact entry/dispatch identity and must reproduce its failed validation.
            d=root/'11-B-U';completion=json.loads((d/'completion.json').read_text());put(d/'completion.json',dict(completed=False,samples=2400))
            result.update(status='incomplete',stopReason='failed validation',rows=result['rows'][:-1],samples=26400);put(root/'result.json',result)
            failure=dict(stage='validate',position=11,error='failed validation',verifiedRows=11);put(root/'failure.json',failure);index();assert v.verify(root)['failedJob']['validationFailureReproduced'] is True
            failure['position']=10;put(root/'failure.json',failure);index();rejected(lambda:v.verify(root));failure['position']=11;put(root/'failure.json',failure)
            config=json.loads((d/'config.json').read_text());config['run']='forged-failed-run';put(d/'config.json',config);index();rejected(lambda:v.verify(root))
            print(json.dumps(dict(syntheticWholeBatchVerified=True,syntheticFailedBatchVerified=True,wholeJobNegatives=6,realConsumerSamples=0)))
    print(json.dumps(dict(passed=True,negatives=negatives)))
else:
    material=Path(sys.argv[1]);original=(material/'position.mjs').read_text();worker=(material/'worker.mjs').read_text()
    with tempfile.TemporaryDirectory() as tmp:
        tmp=Path(tmp)
        for kind,name,target in [('driver','position.mjs','d.mjs'),('worker','worker.mjs','w.mjs')]:subprocess.run(['node','scripts/derive-causal-cleanup.mjs',kind,str(material/name),str(tmp/target)],check=True)
        d=(tmp/'d.mjs').read_text();w=(tmp/'w.mjs').read_text();v.check_source(original,d,worker,w)
        for a,b in [('const start = performance2.now();','const start = 0;'),('gap.y0 = performance2.now();','gap.y0 = 0;'),('gap.r0 = performance2.now();','gap.r0 = performance2.now(); gap.extra = 1;'),('gaps.append(gap, sampleFailure);','gaps.append({...gap}, sampleFailure);'),('run?.cleanup(diagnostic);','run?.cleanup();')]:rejected(lambda:v.check_source(original,d.replace(a,b),worker,w))
        rejected(lambda:v.check_source(original,d,worker,w.replace('group.release();','')))
    # Independent expected entry must match generator for every exact cell, without dispatch.
    spec=importlib.util.spec_from_file_location('collector',Path(__file__).with_name('causal-cleanup-diagnostic.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
    for mode in ['B','S','D']:assert c.entry(Path('/frozen/run'),Path('/frozen/run/00-job'),mode)==v.expected_entry(Path('/frozen/run'),Path('/frozen/run/00-job'),mode)
    assert c.SCHEDULE==v.SCHEDULE and c.SOURCES==['scripts/'+n for n in v.SOURCES]
    # Preparation refusal must consume only the reservation, never spawn a consumer.
    import shutil
    approval=Path('docs/design/causal-cleanup-segments-v1-implementation/approval.json')
    for field,value in [('designDigest','sha256:bad'),('maxOutputBytes',1),('checkIntervalMs',1),('maxFixtureProcesses',1)]:
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();doc=root/'doc';doc.mkdir();out=root/'run'
            a=json.loads(approval.read_text());a[field]=value
            target=root/a['design'];target.parent.mkdir(parents=True);shutil.copyfile(a['design'],target)
            c.put(doc/'approval.json',a);c.ROOT=root;c.DOC=doc;c.OUTPUT=out
            assert c.run()==1 and c.read(out/'result.json')['attempted']==[]
            assert v.verify(out)['processes']==0
            def reindex():c.put(out/'artifact-index.json',dict(files={str(p.relative_to(out)):v.sha(p) for p in out.rglob('*') if p.is_file() and p.name!='artifact-index.json'}))
            result=c.read(out/'result.json');result['capturedSamples']=1;c.put(out/'result.json',result);reindex();rejected(lambda:v.verify(out));result['capturedSamples']=0;c.put(out/'result.json',result)
            hidden=out/'hidden/deep/exit.json';hidden.parent.mkdir(parents=True);c.put(hidden,{});reindex();rejected(lambda:v.verify(out))
    print(json.dumps(dict(passed=True,sourceNegatives=6,entryModes=3,preparationRefusals=4,inventoryNegatives=8,newConsumerSamples=0)))
