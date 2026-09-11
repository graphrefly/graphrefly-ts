"""CPU/trace/verifier qualification with offline vectors; never starts a consumer."""
import copy, hashlib, importlib.util, json, subprocess, sys, tempfile
from pathlib import Path
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('v',Path(__file__).with_name('verify-causal-cpu.py'));v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
if __name__=='__main__':
    data=json.loads(Path(sys.argv[1]).read_text());material=Path(sys.argv[2]);count=0
    e=data['evidence'];v.same(v.verify_cpu(e,[]),data['expected'])
    assert v.verify_cpu(e,[])[0]['T']==110 and v.verify_cpu(e,[])[0]['P']==200 and v.verify_cpu(e,[])[0]['unaccountedElapsed']==-10
    def rejected(fn):
        global count
        try:fn()
        except (AssertionError,ValueError,KeyError,TypeError,IndexError,OSError):count+=1
        else:raise AssertionError('mutation escaped')
    for mutation in [lambda x:x.update(cpuUnits='milliseconds'),lambda x:x['thread'].update(threadId=1),lambda x:x.update(thread=dict(isMainThread=1,threadId=False)),lambda x:x['windows'][0]['after']['thread'].update(user=1),lambda x:x['windows'][1]['before']['thread'].update(user=1),lambda x:x['windows'][0].pop('after'),lambda x:x['windows'][1].update(name='other'),lambda x:x['windows'][0]['after']['thread'].update(user=1.5)]:
        x=copy.deepcopy(e);mutation(x);rejected(lambda:v.verify_cpu(x,[]))
    for mutation in [lambda x:x['windows'][0]['after']['thread'].update(user=111000000),lambda x:x['windows'][0]['after']['process'].update(userCPUTime=111000)]:
        x=copy.deepcopy(e);mutation(x);rejected(lambda:v.same(v.verify_cpu(x,[]),data['expected']))
    # Independent bitwise checksum; no observer or consumer is invoked.
    h=2166136261
    for i in range(2000000):h=((h^i)*16777619)&0xffffffff
    assert h==2225220677
    source=(material/'position.mjs').read_text()
    # Derivation output independently reconstructed; generator subprocess is parse/text-only.
    with tempfile.TemporaryDirectory() as td:
        root=Path(td);observed=root/'observed.mjs'
        result=subprocess.run(['node','scripts/derive-causal-cpu-driver.mjs',str(material/'position.mjs'),str(observed)],capture_output=True,text=True,timeout=15);assert result.returncode==0,result.stderr
        content=observed.read_text();v.check_source(source,content)
        for a,b in [('await setImmediate();',''),('observer.end(observationName);',''),('const start = performance2.now();','const start = 0;'),('cleanupAll([run], sampleFailure);','')]:
            assert a in content;rejected(lambda:v.check_source(source,content.replace(a,b)))
        # Real-format and synthesized profile fixtures are independently re-read with rebuilt hashes.
        for case in data['traceCases']:
            ev=case['evidence'];trace=case['trace'];profile=ev['profile'];d=root/profile;d.mkdir()
            def write_case(ev,trace,report):
                for name,value in [('evidence.json',ev),('trace-1.json',trace),('report.json',report)]: (d/name).write_text(json.dumps(value))
                manifest=dict(identity=ev['identity'],exitCode=0,timedOut=False,traceFiles=['trace-1.json'],traceDigest=v.sha(d/'trace-1.json'),evidenceDigest=v.sha(d/'evidence.json'))
                (d/'trace-manifest.json').write_text(json.dumps(manifest));report['traceDigest']=manifest['traceDigest'];report['evidenceDigest']=manifest['evidenceDigest']
                (d/'samples.jsonl').write_text('')
                return report
            code="import {readFileSync} from 'node:fs';import {correlateCpuTrace} from './scripts/causal-cpu-trace.mjs';import {hash} from './scripts/causal-event-correlation.mjs';const f=JSON.parse(readFileSync(process.argv[1],'utf8'));const a=JSON.stringify(f.trace),b=JSON.stringify(f.evidence);console.log(JSON.stringify({...correlateCpuTrace(a,b,{identity:f.evidence.identity,exitCode:0,timedOut:false,traceFiles:['trace-1.json'],traceDigest:hash(a),evidenceDigest:hash(b)}),sampleRelations:[]}));"
            (root/'case.json').write_text(json.dumps(case));r=subprocess.run(['node','--input-type=module','-e',code,str(root/'case.json')],capture_output=True,text=True,timeout=15);assert r.returncode==0,r.stderr
            report=json.loads(r.stdout);assert report['status']=='calibrated',report
            report=write_case(ev,trace,report);v.verify_trace(d,report)
            # Retained raw hashes do not excuse wrong computed labels or unit scale.
            for mutation in [lambda x:x.update(deltaUs=[0,0]),lambda x:x['categories'].update(MajorGC='no-cost'),lambda x:x.update(status='unknown')]:
                rr=copy.deepcopy(report);mutation(rr);rejected(lambda:v.verify_trace(d,rr))
            tt=copy.deepcopy(trace);tt['traceEvents'].append(dict(ph='i',name='unsupported',cat='v8',pid=ev['identity']['pid'],tid=7,ts=float('inf')))
            rr=copy.deepcopy(report);rr['unclassifiedRefs'].append(len(tt['traceEvents'])-1);rr=write_case(ev,tt,rr);rejected(lambda:v.verify_trace(d,rr))
            ee=copy.deepcopy(ev);ee['anchors'][1]=dict(p0=25,p1=25.1,h='125050000');write_case(ee,trace,copy.deepcopy(report));rejected(lambda:v.verify_trace(d,report))
    # Complete synthetic retained attempt: all evidence arithmetic/identity paths, zero business execution.
    import shutil
    with tempfile.TemporaryDirectory() as td:
        root=Path(td);put=lambda p,x:p.write_text(json.dumps(x));(root/'source/scripts').mkdir(parents=True);(root/'qualification').mkdir()
        for name in v.SOURCE_NAMES:
            dest=root/'source/scripts'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(Path('scripts')/name,dest)
        hashes={'scripts/'+n:v.sha(root/'source/scripts'/n) for n in v.SOURCE_NAMES}
        for name in ('worker.mjs','worker-copy.mjs','position.mjs','P2-inputs.json','reference-qualification.json'):shutil.copyfile(material/name,root/name)
        subprocess.run(['node','scripts/derive-causal-cpu-driver.mjs',str(root/'position.mjs'),str(root/'observed.mjs')],check=True,timeout=15)
        approval=json.loads(Path('docs/design/causal-cpu-wall-diagnostic-v1-implementation/approval.json').read_text());put(root/'approval.json',approval);shutil.copyfile(approval['design'],root/'approved-design.md')
        q=dict(passed=True,sourceDigests=hashes,designDigest=approval['designDigest'],logs={});put(root/'qualification/qualification.json',q)
        reservation=dict(status='reserved',executionRoot=str(root),startMonotonic=0,sourceDigests=hashes,qualificationDigest=v.sha(root/'qualification/qualification.json'),approvalDigest=v.sha(root/'approval.json'),schedule=v.SCHEDULE,implicitNodeOptions={},runtime=dict(node='v24.18.0',v8='13.6.233.17-node.50',platform='darwin',arch='arm64'),run='synthetic',executable='/synthetic/node',executableDigest='a'*64,wakeAtStart='same')
        put(root/'reservation.json',reservation);put(root/'materials.json',{n:v.sha(root/n) for n in ('worker.mjs','worker-copy.mjs','position.mjs','observed.mjs','P2-inputs.json','reference-qualification.json')})
        summaries=[];fixture=None
        for position in [-1,*range(12)]:
            mode,orientation=('T',None) if position==-1 else v.SCHEDULE[position].split('-');cell='fixture' if position==-1 else v.SCHEDULE[position];name='fixture' if position==-1 else f'{position:02d}-{cell}'
            d=root/name;d.mkdir();profile='fixture' if position==-1 else 'consumer';pid=42 if position==-1 else 100+position
            script=root/'source/scripts/fixtures/causal-cpu-observer.mjs' if position==-1 else d/'entry.mjs'
            if position!=-1:script.write_text(v.expected_entry(root,d,mode))
            config=dict(output=str(d),run='synthetic'+('-fixture' if position==-1 else f'-{position}'),sourceDigest=v.sha(script),mode=mode,profile=profile,orientation=orientation)
            if position!=-1:config.update(row=v.old.ROW,kind='control',control=True,scenarioPath=str(root/'P2-inputs.json'))
            put(d/'config.json',config)
            dispatch=dict(position=position,cell=cell,argv=['/synthetic/node',*v.FLAGS,*(v.TRACE if mode=='T' else []),str(script),*([str(d/'config.json')] if position==-1 else [])],cwd=str(d),startMonotonic=1+(position+1)*2,startWall=1+(position+1)*2,wakeBefore='same')
            put(d/'dispatch.json',dispatch);put(d/'exit.json',dict(**dispatch,pid=pid,exitCode=0,endMonotonic=2+(position+1)*2,endWall=2+(position+1)*2,childError=None,wakeAfter='same',wakeError=None,finalizationErrors=[]))
            ev=copy.deepcopy(data['traceCases'][0 if profile=='fixture' else 1]['evidence']);ev.update(mode=mode,cpuUnits='microseconds',orientation=orientation,thread=dict(isMainThread=True,threadId=0),complete=True,active=None,error=None)
            ev['identity']=dict(run=config['run'],pid=pid,node='v24.18.0',v8='13.6.233.17-node.50',sourceDigest=config['sourceDigest'])
            for n,w in enumerate(ev['windows']):
                def snapshot(p0,p1,t):return dict(p0=p0,p1=p1,thread=dict(user=t*1000,system=t*100),process=dict(userCPUTime=t*2000,systemCPUTime=t*200,voluntaryContextSwitches=t,involuntaryContextSwitches=0,minorPageFault=0,majorPageFault=0))
                w['before']=snapshot(w['start']-.1,w['start'],n*4);w['after']=snapshot(w['end'],w['end']+.1,n*4+1)
            raw=[]
            if position!=-1:
                for n,w in enumerate(ev['windows']):
                    batch,slot=n//4,(n//2)%2;arm=v.old.order(orientation,batch)[slot];length=300 if n%2 else 100
                    for j in range(length):
                        index=j+(100 if n%2 else 0);start=w['start']+.2+j*8/length;end=start+.01
                        raw.append(dict(batch=batch,arm=arm,index=index,phase='measured' if n%2 else 'warmup',segment=f'cold-P2-summary/{batch}/{arm}/{index}',start=start,end=end,ms=end-start,constructionMs=0,preparationMs=0))
                (d/'samples.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in raw));put(d/'completion.json',dict(completed=True,samples=2400));put(d/'preflight.json',dict(passed=True));put(d/'preflight-first.json',dict(module=0,pid=pid));put(d/'preflight-order.json',dict(modules=[0,1],pid=pid));(d/'entry-events.jsonl').write_text(''.join(json.dumps(dict(module=n,pid=pid))+'\n' for n in ('n','m0','m1')))
                put(d/'worker.json',dict(pid=pid,node='v24.18.0',row=v.old.ROW,control=True,recipe={**v.old.RECIPE,'orders':[v.old.order(orientation,b) for b in range(3)]}))
                (d/'stdout.log').write_text('PRESET_PERFORMANCE_ROW_DONE cold-P2-summary 2400')
            else:put(d/'fixture-result.json',dict(checksum=2225220677,pid=pid));(d/'stdout.log').write_text('CPU_OBSERVER_FIXTURE_DONE')
            if mode!='B':
                if mode=='Q':
                    ev['anchors']=[]
                    for w in ev['windows']:w.pop('begin');w.pop('finish')
                put(d/'evidence.json',ev)
                if mode=='T':
                    trace=copy.deepcopy(data['traceCases'][0 if profile=='fixture' else 1]['trace'])
                    for event in trace['traceEvents']:
                        event['pid']=pid
                        if event.get('name','').startswith('time::synthetic:'):event['name']=event['name'].replace('time::synthetic:','time::'+config['run']+':')
                    put(d/'trace-1.json',trace);put(d/'trace-manifest.json',dict(identity=ev['identity'],exitCode=0,timedOut=False,traceFiles=['trace-1.json'],traceDigest=v.sha(d/'trace-1.json'),evidenceDigest=v.sha(d/'evidence.json')))
                command=subprocess.run(['node','scripts/report-causal-cpu.mjs',str(d)],capture_output=True,text=True,timeout=15);assert command.returncode==0,command.stderr;put(d/'report.json',json.loads(command.stdout))
            value=v.verify_job(root,position)
            put(d/'independent-command.json',dict(exitCode=0,stderr='',stdout=json.dumps({**value,'evidenceValid':True})))
            if position==-1:fixture=dict(status='qualified',cpu=value['cpu'])
            else:summaries.append(dict(position=position,cell=cell,samples=2400))
        result=dict(status='complete-diagnostic',performanceQualification=False,retries=0,attempted=[-1,*range(12)],notRun=[],rows=summaries,fixture=fixture,samples=28800,capturedSamples=28800,elapsedSeconds=29,stopReason=None);put(root/'result.json',result)
        def index():put(root/'artifact-index.json',dict(files={str(p.relative_to(root)):v.sha(p) for p in root.rglob('*') if p.is_file() and p!=root/'artifact-index.json'}))
        index();assert v.verify(root)['samples']==28800
        # Rebuild the complete outer hash map after each semantic corruption.
        for filename,mutation in [('00-B-U/config.json',lambda x:x.update(orientation='V')),('01-Q-V/evidence.json',lambda x:x['identity'].update(pid=999)),('01-Q-V/report.json',lambda x:x['cpu'][0].update(T=0)),('result.json',lambda x:x.update(notRun=[12])),('01-Q-V/independent-command.json',lambda x:x.update(exitCode=1))]:
            p=root/filename;before=p.read_bytes();x=json.loads(before);mutation(x);put(p,x);index();rejected(lambda:v.verify(root));p.write_bytes(before)
        index();assert v.verify(root)['evidenceValid']
    runner_spec=importlib.util.spec_from_file_location('runner',Path(__file__).with_name('causal-cpu-diagnostic.py'));runner=importlib.util.module_from_spec(runner_spec);runner_spec.loader.exec_module(runner)
    from unittest.mock import patch
    with tempfile.TemporaryDirectory() as td:
        root=Path(td);calls=[]
        class Child:
            pid=123;returncode=None
            def poll(self):return self.returncode
            def wait(self,timeout=None):self.returncode=0;return 0
            def kill(self):self.returncode=-9
        for label,clock in [('success',1),('expired',1000)]:
            job=root/label;job.mkdir();record=dict(startMonotonic=0)
            with patch.object(runner.subprocess,'Popen',side_effect=lambda *a,**kw:(calls.append('spawn') or Child())),patch.object(runner.time,'monotonic',return_value=clock),patch.object(runner,'wake',return_value='same'):
                ex=runner.execute(['fake'],job,{},record,root,900)
            assert ex['exitCode']==(0 if label=='success' else None)
            assert bool(ex['childError'])==(label=='expired')
        assert calls==['spawn']
        # A write/wait failure and termination failure retain both primary and finalization causes.
        class Broken(Child):
            def wait(self,timeout=None):raise OSError('primary wait')
            def kill(self):raise OSError('termination')
        job=root/'dual';job.mkdir()
        with patch.object(runner.subprocess,'Popen',return_value=Broken()),patch.object(runner.time,'monotonic',return_value=1),patch.object(runner,'wake',return_value='same'):
            ex=runner.execute(['fake'],job,{},dict(startMonotonic=0),root,900)
        assert 'primary wait' in ex['childError'] and 'termination' in ex['finalizationErrors'][0]
    print(json.dumps(dict(passed=True,negative=count,independentChecksum=h,nativeConsumerSamples=0,nativeObserverCaptures=0)))
