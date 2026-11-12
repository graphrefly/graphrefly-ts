"""Independent retained-trace verifier: no reporter import, execution or network."""
import hashlib
import json
import sys
from fractions import Fraction as F
from pathlib import Path
sys.dont_write_bytecode=True
import math
import statistics
import re

def phase_names(profile):
    assert profile in ('fixture','consumer')
    return ['empty','cpu','yield'] if profile=='fixture' else [f'b{b//2}s{b%2}-{p}' for b in range(6) for p in ('warmup','measured')]

def verify_cpu(e,samples):
    assert e['cpuUnits']=='microseconds' and e['units']=='performance-ms/hrtime-ns/trace-us'
    assert type(e['thread']['isMainThread']) is bool and type(e['thread']['threadId']) is int
    assert e['thread']==dict(isMainThread=True,threadId=0) and e['mode'] in ('Q','T')
    assert e['complete'] is True and e['active'] is None and e['error'] is None
    assert [x['name'] for x in e['windows']]==phase_names(e['profile'])
    assert len(samples)==(2400 if e['profile']=='consumer' else 0)
    out=[];previous=-1;prior=None
    for index,w in enumerate(e['windows']):
        a,b=w['before'],w['after']
        for x in (a,b):
            assert all(type(x[k]) in (int,float) and math.isfinite(x[k]) and x[k]>=0 for k in ('p0','p1'))
            assert x['p0']<=x['p1'] and set(x['thread'])=={'user','system'}
            assert all(type(v) is int and 0<=v<=2**53-1 for v in [*x['thread'].values(),*x['process'].values()])
            assert all(k in x['process'] for k in ('userCPUTime','systemCPUTime','voluntaryContextSwitches','involuntaryContextSwitches','minorPageFault','majorPageFault'))
        assert a['p0']>previous and a['p1']<=b['p0'];previous=b['p1']
        assert w['start']==a['p1'] and w['end']==b['p0']
        for group in ('thread','process'):
            assert set(a[group])==set(b[group]) and all(b[group][k]>=a[group][k] for k in a[group])
        if prior:
            for group in ('thread','process'):
                assert set(a[group])==set(prior[group]) and all(a[group][k]>=prior[group][k] for k in a[group])
        prior=b
        T=(b['thread']['user']+b['thread']['system']-a['thread']['user']-a['thread']['system'])/1000
        P=(b['process']['userCPUTime']+b['process']['systemCPUTime']-a['process']['userCPUTime']-a['process']['systemCPUTime'])/1000
        Wlo=b['p0']-a['p1'];Whi=b['p1']-a['p0'];Wpoint=(Wlo+Whi)/2
        start=(index//2)*400+(100 if index%2 else 0);end=(index//2)*400+(400 if index%2 else 100)
        data=samples[start:end] if e['profile']=='consumer' else []
        if e['profile']=='consumer':
            assert e['orientation'] in ('U','V')
            batch,slot=index//4,(index//2)%2
            first='candidate' if (batch!=1)==(e['orientation']=='U') else 'reference'
            arm=first if slot==0 else ('candidate' if first=='reference' else 'reference')
            for i,sample in enumerate(data):
                assert (sample['batch'],sample['arm'],sample['index'],sample['phase'])==(batch,arm,i+(100 if index%2 else 0),'measured' if index%2 else 'warmup')
                assert w['start']<=sample['start']<=sample['end']<=w['end'] and sample['ms']==sample['end']-sample['start']
                if i:assert sample['start']>=data[i-1]['end']
        values=sorted(s['ms'] for s in data)
        out.append(dict(name=w['name'],T=T,P=P,Wlo=Wlo,Whi=Whi,Wpoint=Wpoint,unaccountedElapsed=Wpoint-T,processMinusThread=P-T,snapshotWidths=[a['p1']-a['p0'],b['p1']-b['p0']],resourceDeltas={k:b['process'][k]-a['process'][k] for k in ('voluntaryContextSwitches','involuntaryContextSwitches','minorPageFault','majorPageFault')},samples=len(values),constructionMs=sum(s['ms'] for s in data),p50=statistics.median(values) if values else None,p95=values[math.ceil(len(values)*.95)-1] if values else None))
    if e['mode']=='Q':assert e['anchors']==[] and all('begin' not in w and 'finish' not in w for w in e['windows'])
    return out


def verify_trace(directory, report):
    root = Path(directory)
    read = lambda name: (root / name).read_bytes()
    m = json.loads(read('trace-manifest.json'))
    assert m['exitCode'] == 0 and m['timedOut'] is False and m['traceFiles'] == ['trace-1.json']
    tb, eb = read(m['traceFiles'][0]), read('evidence.json')
    assert len(tb) <= 16 * 1024 * 1024
    assert hashlib.sha256(tb).hexdigest() == m['traceDigest']
    assert hashlib.sha256(eb).hexdigest() == m['evidenceDigest']
    e = json.loads(eb)
    ident = e['identity']
    assert ident == m['identity']
    assert type(ident['pid']) is int and 0<ident['pid']<=2**53-1
    assert re.fullmatch('[a-zA-Z0-9-]+',ident['run']) and re.fullmatch('[a-f0-9]{64}',ident['sourceDigest'])
    assert ident['node'] == 'v24.18.0' and ident['v8'] == '13.6.233.17-node.50'
    assert e['units'] == 'performance-ms/hrtime-ns/trace-us'
    anchors, windows = e['anchors'], e['windows']
    assert len(anchors) == 3 and [w['name'] for w in windows] == phase_names(e['profile'])
    floor = lambda x: x.numerator // x.denominator
    ceil = lambda x: -floor(-x)
    # Match the stored IEEE-754 performance-ms multiplication, independently rounded outward.
    ms = lambda x: F.from_float(float(x) * 1000)
    lows, highs = [], []
    for i, a in enumerate(anchors):
        assert type(a['h']) is str and re.fullmatch('[0-9]+',a['h']) and int(a['h'])<=(2**53-1)*1000
        assert all(type(a[k]) in (int,float) and math.isfinite(a[k]) for k in ('p0','p1'))
        h = F(int(a['h']),1000)
        assert a['p0'] <= a['p1']
        if i: assert a['p0'] > anchors[i-1]['p1'] and int(a['h']) > int(anchors[i-1]['h'])
        lows.append(floor(h)-ceil(ms(a['p1'])))
        highs.append(ceil(h)-floor(ms(a['p0'])))
    dl, du = max(lows), min(highs)
    assert dl <= du
    middle=2 if e['profile']=='fixture' else 6
    assert windows[middle-1]['end']<anchors[1]['p0']<=anchors[1]['p1']<windows[middle]['start']
    for i, w in enumerate(windows):
        assert anchors[0]['p1'] < w['start'] <= w['end'] < anchors[2]['p0']
        assert all(a['p1'] < w['start'] or a['p0'] > w['end'] for a in anchors)
        if i: assert windows[i-1]['end'] < w['start']
    raw = json.loads(tb)['traceEvents']
    tids = {r['tid'] for r in raw if r['ph']=='M' and r['pid']==ident['pid'] and r['name']=='thread_name' and r.get('args',{}).get('name')=='JavaScriptMainThread'}
    assert len(tids)==1
    tid = tids.pop();assert type(tid) is int and 0<tid<=2**53-1
    stack, spans, seen, last = [], [], set(), -1
    supported = {'MinorGC','MajorGC','V8.DeoptimizeCode'}
    marker_names = {'time::'+ident['run']+':'+w['name'] for w in windows}
    opened, markers = {}, []
    for i,r in enumerate(raw):
        if r['ph']=='M': continue
        if 'node.console' in r.get('cat','').split(',') or r.get('name','').startswith('time::'):
            assert r['pid']==ident['pid'] and r['tid']==tid, 'console process/thread'
            assert r['name'] in marker_names and r['cat']=='node,node.console', 'console name/category'
            marker_id=r.get('id')
            assert isinstance(marker_id,str) and marker_id.startswith('0x') and len(marker_id)>2
            assert all(c in '0123456789abcdef' for c in marker_id[2:])
            assert 'id2' not in r and 'scope' not in r
            assert type(r['ts']) in (int,float) and math.isfinite(r['ts'])
            assert r['ph'] in ['b','e'] and r['ts']>=last, 'console phase/time'
            last=r['ts']
            coordinate=(r['pid'],r['tid'],r['cat'],r['name'],marker_id)
            if r['ph']=='b':
                assert coordinate not in opened, 'duplicate console begin'
                opened[coordinate]=(i,r)
            else:
                assert coordinate in opened, 'orphan console end'
                j,b=opened.pop(coordinate)
                markers.append((b['name'],b['cat'],b['ts'],r['ts'],[j,i],marker_id))
            continue
        if r['pid']!=ident['pid']:
            assert r['name'] not in supported
            continue
        if r['tid']!=tid: continue
        assert type(r['ts']) in (int,float) and math.isfinite(r['ts']) and r['ts']>=last
        last=r['ts']
        if r['ph'] not in ['B','E','X']:
            assert r['name'] not in supported
            continue
        key=json.dumps(r,sort_keys=True)
        assert key not in seen
        seen.add(key)
        if r['ph']=='B': stack.append((i,r))
        elif r['ph']=='E':
            j,b=stack.pop()
            assert (not r.get('name') or r['name']==b['name']) and r['cat']==b['cat']
            spans.append((b['name'],b['cat'],b['ts'],r['ts'],[j,i]))
        else:
            assert type(r['dur']) in (int,float) and math.isfinite(r['dur']) and r['dur']>=0 and math.isfinite(r['ts']+r['dur'])
            spans.append((r['name'],r['cat'],r['ts'],r['ts']+r['dur'],[i]))
    assert not stack and not opened
    events=[s for s in spans if s[0] in supported and 'v8' in s[1].split(',')]
    output=[]
    enclosure_low, enclosure_high = dl, du
    for w in windows:
        matched=[s for s in markers if s[0]=='time::'+ident['run']+':'+w['name']]
        assert len(matched)==1
        assert int(w['begin'][1]) <= int(w['finish'][0])
        for anchor in anchors:
            if anchor['p1'] < w['start']: assert int(anchor['h']) < int(w['begin'][0])
            if anchor['p0'] > w['end']: assert int(anchor['h']) > int(w['finish'][1])
        enclosure_low=max(enclosure_low,matched[0][2]-1-ceil(ms(w['start'])))
        enclosure_high=min(enclosure_high,matched[0][3]+1-floor(ms(w['end'])))
        assert enclosure_low <= enclosure_high
        for ts,bracket in zip(matched[0][2:4],[w['begin'],w['finish']]):
            lo,hi=map(int,bracket)
            assert lo<=hi and floor(F(lo,1000))-1<=ts<=ceil(F(hi,1000))+1
        row=[]
        for name,_,a,b,refs in events:
            if a < floor(F(int(anchors[0]['h']),1000)) or b > ceil(F(int(anchors[2]['h']),1000)):
                row.append({'name':name,'refs':refs,'status':'unknown','reason':'outside calibration coverage','start':None,'end':None})
                continue
            starts=[a-1-du,a+1-dl];ends=[b-1-du,b+1-dl]
            ss,se=ms(w['start']),ms(w['end'])
            if ends[1]<floor(ss) or starts[0]>ceil(se): status='disjoint'
            elif a<b and w['start']<w['end'] and starts[1]<floor(se) and ends[0]>ceil(ss): status='overlap'
            else: status='possible'
            row.append({'name':name,'refs':refs,'status':status,'start':starts,'end':ends})
        output.append({'name':w['name'],'events':row})
    expected_markers=[{'name':name,'cat':cat,'pid':ident['pid'],'tid':tid,'id':marker_id,'start':a,'end':b,'refs':refs} for name,cat,a,b,refs,marker_id in markers]
    assert report['markers']==expected_markers
    assert report['status']=='calibrated' and report['deltaUs']==[dl,du] and report['samples']==output
    assert report['events']==[dict(name=n,cat=c,start=a,end=b,refs=refs) for n,c,a,b,refs in events]
    assert report['categories']=={name:'observed' if any(x[0]==name for x in events) else 'not-observed' for name in supported}
    raw_samples=[json.loads(line) for line in read('samples.jsonl').splitlines()] if e['profile']=='consumer' else []
    relations=[]
    for sample in raw_samples:
        ss,se=ms(sample['start']),ms(sample['end']); row=[]
        for name,_,a,b,refs in events:
            if a < floor(F(int(anchors[0]['h']),1000)) or b > ceil(F(int(anchors[2]['h']),1000)): row.append('unknown');continue
            starts=[a-1-du,a+1-dl];ends=[b-1-du,b+1-dl]
            if ends[1]<floor(ss) or starts[0]>ceil(se):status='disjoint'
            elif a<b and sample['start']<sample['end'] and starts[1]<floor(se) and ends[0]>ceil(ss):status='overlap'
            else:status='possible'
            row.append(status)
        relations.append(row)
    assert report['sampleRelations']==relations
    background=[i for i,r in enumerate(raw) if r['ph']!='M' and r['pid']==ident['pid'] and r['tid']!=tid and r.get('name') in supported]
    assert report['backgroundRefs']==background
    used={i for s in events for i in s[4]}|{i for s in markers for i in s[4]}|set(background)
    assert report['unclassifiedRefs']==[i for i in range(len(raw)) if i not in used]
    assert report['identity']==ident and report['tid']==tid and report['traceDigest']==m['traceDigest'] and report['evidenceDigest']==m['evidenceDigest']
    return dict(status='calibrated',events=len(events),windows=len(windows),markers=len(markers),deltaUs=[dl,du])

# The verifier imports only the prior immutable raw-data verifier, never the collector.
import importlib.util
spec=importlib.util.spec_from_file_location('position_raw',Path(__file__).with_name('verify-causal-position-pairs.py'))
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
SCHEDULE=['B-U','Q-V','T-U','B-V','Q-U','T-V','T-V','Q-U','B-V','T-U','Q-V','B-U']
SOURCE_NAMES=['causal-cpu-diagnostic.py','causal-cpu-observer.mjs','fixtures/causal-cpu-observer.mjs','derive-causal-cpu-driver.mjs','causal-cpu-trace.mjs','report-causal-cpu.mjs','verify-causal-cpu.py','causal-cpu.test.mjs','causal-cpu.test.py','causal-event-correlation.mjs','verify-causal-event-clock.py','verify-causal-position-pairs.py','verify-causal-block-history.py','verify-causal-control-crossover.py','causal-control-crossover.py']
FLAGS=['--trace-gc','--trace-deopt','--log-deopt','--no-logfile-per-isolate','--logfile=v8.log']
TRACE=['--trace-events-enabled','--trace-event-categories=v8,node.console','--trace-event-file-pattern=trace-${rotation}.json']
DESIGN='a71ab506c01b59ddef2c4d4c6d5abfecf3226a22c6a64fc9eabe363a4f9f5d84'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text())
def same(a,b):
    if type(a) in (float,int) and type(b) in (float,int):assert math.isfinite(a) and math.isfinite(b) and math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-12)
    elif isinstance(a,dict):
        assert isinstance(b,dict) and set(a)==set(b)
        for k in a:same(a[k],b[k])
    elif isinstance(a,list):
        assert isinstance(b,list) and len(a)==len(b)
        for x,y in zip(a,b):same(x,y)
    else:assert a==b

def check_source(original,observed):
    assert hashlib.sha256(original.encode()).hexdigest()=='b192d7bef7434b1241dc78d806b26950bcbf4fd5a62af3085611d65797ef08e9'
    replacements=[
        ('export async function runRow(configPath, modules) {','export async function runRow(configPath, modules, observer) {'),
        ('          await setImmediate();','          const observationName = `b${batch2}s${arms.indexOf(arm)}-${index < 100 ? "warmup" : "measured"}`;\n          if (index === 0 || index === 100) observer.start(observationName);\n          await setImmediate();'),
        ('            if (run !== shared) cleanupAll([run], sampleFailure);\n          }','            if (run !== shared) cleanupAll([run], sampleFailure);\n          }\n          if (index === 99 || index === 399) observer.end(observationName);')]
    for before,after in replacements:
        assert original.count(before)==1
        original=original.replace(before,after)
    assert observed==original, 'unapproved driver transformation'

def expected_entry(root,job,mode):
    text='import assert from "node:assert/strict";\nimport {readFileSync,appendFileSync} from "node:fs";\n'
    for var,name in [('n','position.mjs' if mode=='B' else 'observed.mjs'),('m0','worker.mjs'),('m1','worker-copy.mjs')]:
        text+='const '+var+'=await import('+json.dumps((root/name).as_uri())+');\n'
        text+='appendFileSync('+json.dumps(str(job/'entry-events.jsonl'))+',JSON.stringify({module:'+json.dumps(var)+',pid:process.pid})+"\\n");\n'
    config=json.dumps(str(job/'config.json'))
    text+='const config=JSON.parse(readFileSync('+config+',"utf8"));\nassert.deepEqual(m0.RECIPE,m1.RECIPE);const original=JSON.stringify(m0.RECIPE);\n'
    if mode=='B':text+='await n.runRow('+config+',[m0,m1]);\n'
    else:
        text+='const {createObserver}=await import('+json.dumps((root/'source/scripts/causal-cpu-observer.mjs').as_uri())+');\nconst observer=createObserver(config);let primary=null;\n'
        text+='try {await n.runRow('+config+',[m0,m1],observer);} catch(error){primary=error;throw error;}\n'
        text+='finally {try {observer.finish(primary);} catch(error){if(primary)throw new AggregateError([primary,error],"consumer and observer finalization");throw error;}}\n'
    return text+'assert.equal(JSON.stringify(m0.RECIPE),original);assert.equal(JSON.stringify(m1.RECIPE),original);\n'

def job_identity(root,position):
    r=read(root/'reservation.json');physical=Path(r['executionRoot'])
    mode,orientation=('T',None) if position==-1 else SCHEDULE[position].split('-')
    name='fixture' if position==-1 else f'{position:02d}-{SCHEDULE[position]}'
    directory=root/name;job=physical/name
    script=physical/'source/scripts/fixtures/causal-cpu-observer.mjs' if position==-1 else job/'entry.mjs'
    source=root/'source/scripts/fixtures/causal-cpu-observer.mjs' if position==-1 else directory/'entry.mjs'
    if position!=-1:assert source.read_text()==expected_entry(physical,job,mode)
    config=dict(output=str(job),run=r['run']+('-fixture' if position==-1 else f'-{position}'),sourceDigest=sha(source),mode=mode,profile='fixture' if position==-1 else 'consumer',orientation=orientation)
    if position!=-1:config.update(row=old.ROW,kind='control',control=True,scenarioPath=str(physical/'P2-inputs.json'))
    assert read(directory/'config.json')==config
    ex=read(directory/'exit.json')
    assert ex['argv']==[r['executable'],*FLAGS,*(TRACE if mode=='T' else []),str(script),*([str(job/'config.json')] if position==-1 else [])]
    assert (ex['position'],ex['cell'],ex['cwd'],ex['wakeBefore'])==(position,'fixture' if position==-1 else SCHEDULE[position],str(job),r['wakeAtStart'])
    assert read(directory/'dispatch.json')=={k:v for k,v in ex.items() if k not in ('pid','exitCode','endMonotonic','endWall','childError','wakeAfter','wakeError','finalizationErrors')}
    return directory,config,ex

def verify_job(root,position):
    check_admission(root)
    directory,c,ex=job_identity(root,position)
    assert type(ex['pid']) is int and ex['pid']>0 and ex['exitCode']==0 and ex['childError'] is None and ex['wakeError'] is None and ex['wakeAfter']==ex['wakeBefore'] and ex['finalizationErrors']==[]
    span=ex['endMonotonic']-ex['startMonotonic'];wall=ex['endWall']-ex['startWall']
    assert 0<=span<=30 and abs(wall-span)<=1
    samples=[];blocks=[]
    if position!=-1:
        samples=[json.loads(line) for line in (directory/'samples.jsonl').read_text().splitlines()]
        old.raw_summary(samples,c['orientation'])
        assert read(directory/'completion.json')==dict(completed=True,samples=2400)
        assert 'PRESET_PERFORMANCE_ROW_DONE cold-P2-summary 2400' in (directory/'stdout.log').read_text()
        assert [json.loads(s) for s in (directory/'entry-events.jsonl').read_text().splitlines()]==[dict(module=n,pid=ex['pid']) for n in ('n','m0','m1')]
        meta=read(directory/'worker.json');recipe={**old.RECIPE,'orders':[old.order(c['orientation'],b) for b in range(3)]}
        assert meta['pid']==ex['pid'] and meta['node']=='v24.18.0' and meta['row']==old.ROW and meta['control'] is True and meta['recipe']==recipe
        assert read(directory/'preflight-first.json')==dict(module=0,pid=ex['pid'])
        assert read(directory/'preflight-order.json')==dict(modules=[0,1],pid=ex['pid'])
        assert read(directory/'preflight.json')['passed'] is True
        # Original source guarantees the two three-arm preflight calls, not fabricated new counts.
        for n in range(12):
            a=(n//2)*400+(100 if n%2 else 0);b=(n//2)*400+(400 if n%2 else 100);data=samples[a:b];v=sorted(s['ms'] for s in data)
            gaps=[data[i]['start']-data[i-1]['end'] for i in range(1,len(data))]
            blocks.append(dict(name=phase_names('consumer')[n],samples=len(v),p50=statistics.median(v),p95=v[math.ceil(len(v)*.95)-1],constructionMs=sum(s['ms'] for s in data),withinPhaseGapMs=sum(gaps),gapP50=statistics.median(gaps),gapP95=sorted(gaps)[math.ceil(len(gaps)*.95)-1]))
    cpu=None;trace=dict(status='not-enabled')
    if c['mode']=='B':
        assert not any((directory/name).exists() for name in ('evidence.json','trace-manifest.json','report.json')) and not list(directory.glob('trace-*.json'))
    else:
        e=read(directory/'evidence.json')
        assert e['identity']==dict(run=c['run'],pid=ex['pid'],node='v24.18.0',v8='13.6.233.17-node.50',sourceDigest=c['sourceDigest'])
        assert (e['mode'],e['profile'],e['orientation'])==(c['mode'],c['profile'],c['orientation'])
        cpu=verify_cpu(e,samples);report=read(directory/'report.json');same(cpu,report['cpu']);assert report['performanceQualification'] is False
        if c['mode']=='T':
            assert sorted(p.name for p in directory.glob('trace-*.json') if p.name not in ('trace-manifest.json','trace-unknown.json'))==['trace-1.json']
            trace=verify_trace(directory,report['trace'])
        else:
            assert report['trace']==dict(status='not-enabled') and not list(directory.glob('trace-*.json'))
    if position==-1:
        assert read(directory/'fixture-result.json')==dict(checksum=2225220677,pid=ex['pid'])
        assert cpu[1]['T']>0 and cpu[2]['Wlo']>cpu[2]['T']
        assert 'CPU_OBSERVER_FIXTURE_DONE' in (directory/'stdout.log').read_text()
        assert not any((directory/n).exists() for n in ('samples.jsonl','worker.json','completion.json','preflight.json','entry-events.jsonl'))
    return dict(position=position,cell=ex['cell'],samples=len(samples),cpu=cpu,trace=trace,blocks=blocks)

def check_admission(root):
    r=read(root/'reservation.json')
    assert r['status']=='reserved' and r['schedule']==SCHEDULE and r['implicitNodeOptions']=={}
    assert r['runtime']==dict(node='v24.18.0',v8='13.6.233.17-node.50',platform='darwin',arch=r['runtime']['arch']) and r['runtime']['arch'] in ('arm64','x64')
    assert sha(root/'approval.json')==r['approvalDigest'];a=read(root/'approval.json')
    assert a['designDigest']=='sha256:'+DESIGN and sha(root/'approved-design.md')==DESIGN and a['proposalCommit']=='cf20118b'
    assert [a[k] for k in ('maxConsumerProcesses','maxFixtureProcesses','maxSamples','maxSecondsPerChild','maxSecondsTotal','maxOutputBytes','checkIntervalMs','maxTraceBytes','retries')]==[12,1,28800,30,900,268435456,100,16777216,0]
    sources={'scripts/'+n:sha(root/'source/scripts'/n) for n in SOURCE_NAMES};assert sources==r['sourceDigests']
    for name in SOURCE_NAMES:
        assert sha(Path(__file__).parent/name)==sources['scripts/'+name],'independent verifier source'
    q=read(root/'qualification/qualification.json');assert sha(root/'qualification/qualification.json')==r['qualificationDigest'] and q['passed'] is True and q['sourceDigests']==sources and q['designDigest']==a['designDigest']
    for name,digest in q['logs'].items():assert sha(root/'qualification'/name)==digest
    for name,digest in [('worker.mjs',old.h.BUNDLE),('worker-copy.mjs',old.h.BUNDLE),('P2-inputs.json',old.h.INPUT),('reference-qualification.json',old.h.QUAL),('position.mjs','b192d7bef7434b1241dc78d806b26950bcbf4fd5a62af3085611d65797ef08e9')]:assert sha(root/name)==digest
    check_source((root/'position.mjs').read_text(),(root/'observed.mjs').read_text())
    assert read(root/'materials.json')=={n:sha(root/n) for n in ('worker.mjs','worker-copy.mjs','P2-inputs.json','reference-qualification.json','position.mjs','observed.mjs')}

def verify(root):
    indexed=read(root/'artifact-index.json')['files'];actual={}
    for p in root.rglob('*'):
        assert not p.is_symlink()
        if p.is_file() and p!=root/'artifact-index.json':actual[str(p.relative_to(root))]=sha(p)
    assert indexed==actual,'exact inventory/hash'
    r=read(root/'reservation.json');result=read(root/'result.json')
    assert result['performanceQualification'] is False and result['retries']==0
    attempted=result['attempted'];assert attempted==[-1,*range(12)][:len(attempted)] and len(attempted)<=13
    assert result['notRun']==[-1,*range(12)][len(attempted):]
    failure=read(root/'failure.json') if (root/'failure.json').exists() else None
    if failure is not None:
        assert result['status']=='incomplete' and failure['error']==result['stopReason'] and failure['verifiedRows']==len(result['rows'])
    else:assert result['status']=='complete-diagnostic' and result['stopReason'] is None and len(attempted)==13
    attempted_names={'fixture' if p==-1 else f'{p:02d}-{SCHEDULE[p]}' for p in attempted}
    dirs={p.name for p in root.iterdir() if p.is_dir() and p.name not in ('source','qualification')}
    extras=dirs-attempted_names
    if extras:
        assert failure and failure['stage']=='pre-dispatch' and len(attempted)<13
        next_position=[-1,*range(12)][len(attempted)];next_name='fixture' if next_position==-1 else f'{next_position:02d}-{SCHEDULE[next_position]}'
        assert extras=={next_name}
        assert all(p.name in ('entry.mjs','config.json') for p in (root/next_name).iterdir())
    for name in indexed:
        if Path(name).name in ('dispatch.json','exit.json','samples.jsonl','evidence.json','worker.json'):
            assert len(Path(name).parts)==2 and Path(name).parts[0] in attempted_names,'hidden execution'
    if not attempted:
        assert result['rows']==[] and result['fixture'] is None and result['samples']==0 and failure
        return dict(evidenceValid=True,status='incomplete',processes=0,samples=0,performanceQualification=False,reason=result['stopReason'],proof='zero-dispatch inventory; preparation did not qualify')
    check_admission(root)
    verified=[];fixture=None;previous=r['startMonotonic'];identities=set();captured=0;failed_job=None
    for p in attempted:
        directory,c,ex=job_identity(root,p)
        assert previous<=ex['startMonotonic']<r['startMonotonic']+900 and ex['endMonotonic']>=ex['startMonotonic'];previous=ex['endMonotonic']
        if ex['pid'] is not None:assert ex['pid'] not in identities;identities.add(ex['pid'])
        if (directory/'samples.jsonl').exists():captured+=len((directory/'samples.jsonl').read_text().splitlines())
        expected_valid=p==-1 and result['fixture'] is not None or 0<=p<len(result['rows'])
        if expected_valid:
            assert not (directory/'trace-unknown.json').exists(),'qualified job cannot hide unknown receipt'
            value=verify_job(root,p)
            admission=read(directory/'independent-command.json');assert admission['exitCode']==0 and admission['stderr']==''
            same(json.loads(admission['stdout']),{**value,'evidenceValid':True})
            if p==-1:fixture=value;same(result['fixture'],dict(status='qualified',cpu=value['cpu']))
            else:verified.append(value)
        else:
            assert p==attempted[-1] and failure and failure['position']==p
            failed_job=dict(position=p,stage=failure['stage'],error=failure['error'],rawCPU='retained but not independently qualified')
            if c['mode']=='T':
                assert read(directory/'trace-unknown.json')==dict(status='unknown',reason=failure['error'],stage=failure['stage'],rawEvidencePreserved=True)
            try:verify_job(root,p)
            except (AssertionError,ValueError,KeyError,TypeError,IndexError,OSError):failed_job['validationFailureReproduced']=True
            else:
                if failure['stage']=='validate' and (directory/'independent-command.json').exists():
                    assert read(directory/'independent-command.json')['exitCode']!=0
                else:assert failure['stage']=='child' or 'ceiling' in failure['error'] or 'deadline' in failure['error']
                failed_job['validationFailureReproduced']=False
            if (directory/'evidence.json').exists():
                try:
                    raw=[json.loads(s) for s in (directory/'samples.jsonl').read_text().splitlines()] if p!=-1 else []
                    cpu=verify_cpu(read(directory/'evidence.json'),raw)
                    failed_job.update(rawCPU='arithmetically valid; whole child did not qualify',cpu=cpu)
                except (AssertionError,ValueError,KeyError,TypeError,IndexError,OSError):pass
    assert result['rows']==[dict(position=x['position'],cell=x['cell'],samples=2400) for x in verified]
    assert result['samples']==len(verified)*2400 and result['capturedSamples']==captured and captured<=28800
    if failure is None:assert len(verified)==12 and fixture is not None and 0<result['elapsedSeconds']<=900 and previous-r['startMonotonic']<=result['elapsedSeconds']
    elif failed_job is None:assert failure['stage'] in ('pre-dispatch','complete')
    return dict(evidenceValid=True,status=result['status'],processes=len(attempted),samples=result['samples'],capturedSamples=captured,notRun=result['notRun'],fixture=fixture,rows=verified,failedJob=failed_job,performanceQualification=False,sourceBound=True)

if __name__=='__main__':
    try:
        if len(sys.argv)==4 and sys.argv[1]=='--job':out=verify_job(Path(sys.argv[2]),int(sys.argv[3]));out['evidenceValid']=True
        else:
            assert len(sys.argv)==2
            out=verify(Path(sys.argv[1]))
    except (AssertionError,ValueError,KeyError,TypeError,IndexError,OSError) as ex:
        import traceback
        out=dict(evidenceValid=False,error=str(ex),detail=traceback.format_exc())
    print(json.dumps(out,indent=2,allow_nan=False));sys.exit(0 if out['evidenceValid'] else 1)
