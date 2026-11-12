"""Independent D169 raw evidence verifier. Never imports runner/collector or executes a consumer."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tarfile

spec=importlib.util.spec_from_file_location('historical_verifier',Path(__file__).with_name('verify-causal-block-history.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
expect,load,sha=h.expect,h.load,h.sha
ROW,RECIPE,FLAGS=h.ROW,h.ORIGINAL_RECIPE,h.FLAGS

def order(orientation,batch):
    expect(orientation in ('U','V'),'orientation')
    first='candidate' if (batch!=1)==(orientation=='U') else 'reference'
    return [first,'reference' if first=='candidate' else 'candidate']

def planned(bits):
    expect(len(bits)==40 and all(type(x) is int and 0<=x<=1 for x in bits),'order entropy')
    out=[]
    for index,bit in enumerate(bits):
        panel='Z' if index<20 else 'M';pair=index%20
        category='control' if pair<2 or pair>=18 else 'main'
        for orientation in (('V','U') if bit else ('U','V')):
            out.append(dict(position=len(out),panel=panel,pair=pair,category=category,kind='mutation' if panel=='M' and category=='main' else 'control',orientation=orientation))
    return out

def expected_config(job,cell):
    return dict(row=ROW,output=str(job),scenarioPath=str(job.parent/'P2-inputs.json'),control=cell['kind']=='control',kind=cell['kind'],orientation=cell['orientation'])

def expected_entry(job,cell):
    text='import assert from "node:assert/strict";\nimport {readFileSync,appendFileSync,writeFileSync} from "node:fs";\n'
    text+='const config = '+json.dumps(expected_config(job,cell))+';\n'
    text+='assert.deepEqual(JSON.parse(readFileSync('+json.dumps(str(job/'config.json'))+',"utf8")),config);\n'
    text+='const record = module => appendFileSync('+json.dumps(str(job/'entry-events.jsonl'))+',JSON.stringify({module,pid:process.pid})+"\\n");\n'
    for var,name,label in [('n','position.mjs','N'),('m0','worker.mjs','M0'),('m1','worker-copy.mjs','M1')]:
        text+='const '+var+' = await import('+json.dumps((job.parent/name).as_uri())+');\nrecord('+json.dumps(label)+');\n'
    text+='const expected = '+json.dumps(RECIPE)+';\n'
    text+='assert.deepEqual(m0.RECIPE,expected);assert.deepEqual(m1.RECIPE,expected);\n'
    text+='await n.runRow('+json.dumps(str(job/'config.json'))+',[m0,m1]);\n'
    text+='assert.deepEqual(m0.RECIPE,expected);assert.deepEqual(m1.RECIPE,expected);\n'
    text+='writeFileSync('+json.dumps(str(job/'recipe-after.json'))+',JSON.stringify({pid:process.pid,recipe:expected}));\n'
    return text

def raw_summary(samples,orientation):
    expect(len(samples)==2400,'complete 2400 samples')
    data={(b,a):[] for b in range(3) for a in ('candidate','reference')};prior=-1
    for offset,x in enumerate(samples):
        block,i=divmod(offset,400);b,s=divmod(block,2);arm=order(orientation,b)[s]
        expect(type(x['batch']) is int and type(x['index']) is int,'integer coordinates')
        expect((x['batch'],x['arm'],x['index'],x['phase'],x['segment'])==(b,arm,i,'measured' if i>=100 else 'warmup',f'cold-P2-summary/{b}/{arm}/{i}'),'coordinates/segment')
        for k in ('start','end','ms','constructionMs','preparationMs'):
            expect(type(x[k]) in (float,int) and math.isfinite(x[k]) and x[k]>=0,'finite time')
        expect(x['end']-x['start']==x['ms'] and x['constructionMs']==0 and x['preparationMs']==0,'cold measurement fields')
        expect(x['start']>=prior,'monotonic samples');prior=x['end']
        if i>=100:data[b,arm].append(x['ms'])
    p={arm:[sorted(data[b,arm])[284] for b in range(3)] for arm in ('candidate','reference')}
    expect(all(value>0 for values in p.values() for value in values),'positive p95')
    return dict(p95=p,legacySlotRatio=sorted(p['candidate'])[1]/sorted(p['reference'])[1])

def pair_result(rows):
    expect(len(rows)==2 and {r['orientation'] for r in rows}=={'U','V'},'two complementary processes')
    expect(all(rows[0][k]==rows[1][k] for k in ('panel','pair','category','kind')),'pair membership')
    by={r['orientation']:r['p95'] for r in rows};q={}
    for s,name in enumerate(('first','second')):
        values=[]
        for b in range(3):
            coords={order(o,b)[s]:(o,a) for o in ('U','V') for a in [order(o,b)[s]]}
            co,ca=coords['candidate'];ro,ra=coords['reference']
            values.append(by[co][ca][b]/by[ro][ra][b])
        q[name]=values
    g={name:sorted(values)[1] for name,values in q.items()}
    return dict(panel=rows[0]['panel'],pair=rows[0]['pair'],category=rows[0]['category'],firstOrientation=rows[0]['orientation'],q=q,g=g,T=max(g['first'],g['second']))

def band(values):
    expect(len(values)==16 and all(type(x) in (int,float) and math.isfinite(x) and x>0 for x in values),'16 positive repetitions')
    sorted_values=sorted(values)
    return dict(lower=sorted_values[1],point=(sorted_values[7]+sorted_values[8])/2,upper=sorted_values[14])

def panel_result(pairs,name):
    expect(len(pairs)==20 and [p['pair'] for p in pairs]==list(range(20)) and all(p['panel']==name for p in pairs),'20 pairs panel')
    expect([p['category'] for p in pairs]==['control']*2+['main']*16+['control']*2,'category positions')
    stability=all(1/1.05<=p['g'][s]<=1.05 for p in pairs[:2]+pairs[18:] for s in ('first','second'))
    main=pairs[2:18]
    bands={s:band([p['g'][s] for p in main]) for s in ('first','second')};bands['T']=band([p['T'] for p in main])
    signal=all(b['lower']>=1/1.05 and b['upper']<=1.05 for b in bands.values()) if name=='Z' else all(b['lower']>1.2 for b in bands.values())
    return dict(panel=name,controlStable=stability,signalPassed=signal,passed=stability and signal,intervals=bands,mainOrderGroups={o:[p['pair'] for p in main if p['firstOrientation']==o] for o in ('U','V')})

def verify_job(directory,cell,physical):
    job=physical/directory.name;config=expected_config(job,cell)
    expect(load(directory/'config.json')==config,'config binding')
    expect((directory/'entry.mjs').read_text()==expected_entry(job,cell),'actual executable entry')
    ex=load(directory/'exit.json');pid=ex['pid']
    expect(type(pid) is int and pid>0 and ex['exitCode']==0,'child exit')
    expect(load(directory/'dispatch.json')=={k:v for k,v in ex.items() if k not in ('pid','exitCode','endMonotonic','endWall','wakeAfter','childError','wakeError')},'dispatch/exit binding')
    expect(all(ex[k]==v for k,v in cell.items()),'exit coordinates')
    expect(ex['cwd']==str(job) and ex['argv'][1:]==FLAGS+[str(job/'entry.mjs')],'argv')
    elapsed=ex['endMonotonic']-ex['startMonotonic'];wall=ex['endWall']-ex['startWall']
    expect(0<=elapsed<=30 and 0<=wall<=31 and abs(wall-elapsed)<=1,'clock/deadline')
    expect(ex['wakeBefore']==ex['wakeAfter'] and ex['childError'] is None and ex['wakeError'] is None,'no sleep/operational failure')
    expect([json.loads(x) for x in (directory/'entry-events.jsonl').read_text().splitlines()]==[dict(module=m,pid=pid) for m in ('N','M0','M1')],'module observations')
    worker=load(directory/'worker.json')
    expect(worker['pid']==pid and worker['node']=='v24.18.0' and worker['row']==ROW and worker['control']==config['control'],'worker metadata')
    expect(worker['recipe']=={**RECIPE,'orders':[order(cell['orientation'],b) for b in range(3)]},'runtime recipe')
    expect(load(directory/'preflight.json')['passed'] is True,'business preflight')
    expect(load(directory/'preflight-first.json')==dict(module=0,pid=pid),'preflight first')
    expect(load(directory/'preflight-order.json')==dict(modules=[0,1],pid=pid),'preflight second')
    expect(load(directory/'recipe-after.json')==dict(pid=pid,recipe=RECIPE),'original recipe')
    expect(load(directory/'completion.json')==dict(completed=True,samples=2400),'sample completion')
    expect('PRESET_PERFORMANCE_ROW_DONE cold-P2-summary 2400' in (directory/'stdout.log').read_text(),'DONE sentinel')
    return dict(**cell,**raw_summary([json.loads(x) for x in (directory/'samples.jsonl').read_text().splitlines()],cell['orientation']))

def verify(root,archive):
    expect(sha(archive/'evidence.tar.gz')==h.ARCHIVE,'original archive digest')
    original_index=load(archive/'artifact-index.json')['files'];seen=set()
    with tarfile.open(archive/'evidence.tar.gz') as t:
        for m in t.getmembers():
            expect(m.isfile() and m.name in original_index and m.name not in seen,'original members');seen.add(m.name)
            expect('sha256:'+hashlib.sha256(t.extractfile(m).read()).hexdigest()==original_index[m.name],'original bytes')
    expect(seen==set(original_index),'original completeness')
    indexed=load(root/'artifact-index.json')['files'];actual=set()
    for p in root.rglob('*'):
        expect(not p.is_symlink(),'no symbolic evidence')
        if p.is_file() and p!=root/'artifact-index.json':actual.add(str(p.relative_to(root)))
    expect(actual==set(indexed),'exact inventory')
    for name,value in indexed.items():
        expect(not Path(name).is_absolute() and '..' not in Path(name).parts,'safe path');expect(sha(root/name)==value,'indexed bytes')
    r=load(root/'reservation.json');result=load(root/'result.json')
    expect(result['consumerPerformanceQualification'] is False and result['eventAssociation']=='unknown: retained native clocks uncalibrated','claim boundary')
    if result['status']=='invalid':
        failure=load(root/'failure.json')
        expect(failure['verifiedRows']==len(result['rows']) and failure['error']==result['stopReason'] and type(failure['error']) is str and failure['error'],'failure record binding')
    else:expect(not (root/'failure.json').exists(),'no hidden failure in completed qualification')
    if result['status']=='invalid' and result['attempted']==[]:
        expect(result['notRun']==list(range(80)) and result['samples']==0 and result['rows']==result['pairs']==result['panels']==[] and result['methodQualification'] is False,'preparation stop')
        expect(not any(Path(name).name in ('dispatch.json','exit.json','samples.jsonl','worker.json','entry-events.jsonl') for name in indexed),'no hidden dispatch on preparation failure')
        failure=load(root/'failure.json')
        expect(failure['verifiedRows']==0 and failure['error']==result['stopReason'] and failure['stage'] in ('materials','qualification','snapshot','derivation','source-check','pre-dispatch'),'recorded preparation phase')
        expect(r['status'] in ('preparation-failed','reserved'),'preparation reservation')
        return dict(status='invalid',evidenceValid=True,samples=0,methodQualification=False,reason=result['stopReason'],failureProof='recorded operational failure and zero-dispatch inventory; no completed preparation claim')
    expect(r['status']=='reserved' and r['implicitNodeOptions']=={},'reservation')
    entropy=bytes.fromhex(r['entropyHex']);expect(len(entropy)==5,'entropy width')
    bits=[(value>>i)&1 for value in entropy for i in range(8)]
    expect(bits==r['orderBits'] and r['schedule']==planned(bits),'preregistered schedule')
    expect(r['runtime']['node']=='v24.18.0' and r['runtime']['v8']=='13.6.233.17-node.50' and r['runtime']['platform']=='darwin','runtime')
    expect(sha(root/'approval.json')==r['approvalDigest'],'approval binding')
    a=load(root/'approval.json')
    expect(a['designDigest']=='sha256:'+sha(root/'approved-design.md') and a['designDigest']=='sha256:a649c371dfaa4dc78e637899d9d27fe54fd382aa0e2f4070cf10cae5ea7c82b8','approved design')
    expect((a['maxProcesses'],a['maxSamples'],a['maxSecondsPerChild'],a['maxSecondsTotal'],a['retries'])==(80,192000,30,900,0),'grant limits')
    expect(a['panels']==['Z','M'] and a['governing_refs']==['graphrefly-ts:D169','graphrefly-ts:D168'],'approved purpose')
    for name,value in r['sourceDigests'].items():expect(sha(root/'source'/name)==value,'source snapshot')
    for name in ('verify-causal-position-pairs.py','verify-causal-block-history.py','verify-causal-control-crossover.py','check-causal-position-source.mjs'):
        expect(sha(Path(__file__).with_name(name))==sha(root/'source'/name),'independent verifier binding')
    q=load(root/'qualification/qualification.json')
    expect(sha(root/'qualification/qualification.json')==r['qualificationDigest'] and q['passed'] is True,'qualification receipt')
    expect(q['sourceDigests']==r['sourceDigests'] and q['designDigest']==a['designDigest'],'qualified sources')
    for name,value in q['logs'].items():expect(sha(root/'qualification'/name)==value,'qualification logs')
    for name,value in [('worker.mjs',h.BUNDLE),('worker-copy.mjs',h.BUNDLE),('P2-inputs.json',h.INPUT),('reference-qualification.json',h.QUAL)]:expect(sha(root/name)==value,'frozen material')
    expect(load(root/'runtime-materials.json')=={name:sha(root/name) for name in ('position.mjs','worker.mjs','worker-copy.mjs','P2-inputs.json')},'runtime bytes')
    expect(not any(os.environ.get(k) for k in ('NODE_OPTIONS','NODE_COMPILE_CACHE','NODE_V8_COVERAGE')),'implicit verifier options')
    env={k:os.environ[k] for k in ('PATH','HOME','TMPDIR','LANG','LC_ALL','TZ') if k in os.environ}
    parsed=subprocess.run(['node',str(Path(__file__).with_name('check-causal-position-source.mjs')),str(root/'worker.mjs'),str(root/'position.mjs')],capture_output=True,text=True,env=env,timeout=15)
    expect(parsed.returncode==0,'independent AST check '+parsed.stderr)
    expect(json.loads(parsed.stdout)==load(root/'source-check.json'),'parser proof')
    manifest=load(root/'derivation.json')
    expect(manifest==dict(kind='cold-position-pairs-v3-source',originalDigest=h.BUNDLE,derivedDigest=sha(root/'position.mjs'),parserVersion=json.loads(parsed.stdout)['parserVersion'],functionDigests=dict(runRow='c36a27e4a40aaae9cec16aea83a5bfa9db5afff04ddd184eb392838645eec5a3',schedule='20db86119f6367133cb1534d3d94c9606d8a764801d8176c2fcbc4475c66063a',cleanupAll='512a11336f9831c67126edc36b62e214c29e5817be759788a9fbb2eda369d782')),'complete derivation provenance')
    physical=Path(r['executionRoot']);expect(physical.is_absolute(),'physical path')
    attempted=result['attempted'];expect(attempted==list(range(len(attempted))) and len(attempted)<=80,'serial attempt prefix')
    expect(result['notRun']==list(range(len(attempted),80)),'unrun suffix')
    expected_names={f"{c['position']:02d}-{c['panel']}-{c['pair']:02d}-{c['orientation']}" for c in r['schedule']}
    attempted_names={f"{c['position']:02d}-{c['panel']}-{c['pair']:02d}-{c['orientation']}" for c in r['schedule'][:len(attempted)]}
    dirs={p.name for p in root.iterdir() if p.is_dir() and p.name not in ('source','qualification')}
    expect(dirs<=expected_names,'no extra execution directories')
    for name in indexed:
        if Path(name).name in ('dispatch.json','exit.json','samples.jsonl'):
            expect(len(Path(name).parts)==2 and Path(name).parts[0] in attempted_names,'no hidden execution evidence')
    extras=dirs-attempted_names
    if extras:
        expect(result['status']=='invalid' and len(extras)==1,'only failed pre-dispatch preparation may remain')
        next_cell=r['schedule'][len(attempted)]
        expect(extras=={f"{next_cell['position']:02d}-{next_cell['panel']}-{next_cell['pair']:02d}-{next_cell['orientation']}"},'prepared next directory')
        expect(all(p.name in ('entry.mjs','config.json') for name in extras for p in (root/name).iterdir()),'prepared but not executed')
    rows=[];pairs=[];panels=[];prior=r['startMonotonic'];identities=set()
    for position in attempted:
        c=r['schedule'][position];directory=root/f"{position:02d}-{c['panel']}-{c['pair']:02d}-{c['orientation']}"
        ex=load(directory/'exit.json')
        expect(ex['argv'][0]==r['executable'] and ex['startMonotonic']>=prior,'executable/serial order')
        prior=ex['endMonotonic'];expect(ex['wakeBefore']==r['wakeAtStart'],'wake identity')
        job=physical/directory.name
        expect(load(directory/'config.json')==expected_config(job,c),'attempted config identity')
        expect((directory/'entry.mjs').read_text()==expected_entry(job,c),'attempted entry identity')
        expect(ex['cwd']==str(job) and ex['argv'][1:]==FLAGS+[str(job/'entry.mjs')] and all(ex[k]==value for k,value in c.items()),'attempted invocation')
        expect(load(directory/'dispatch.json')=={k:value for k,value in ex.items() if k not in ('pid','exitCode','endMonotonic','endWall','wakeAfter','childError','wakeError')},'attempted dispatch exit link')
        if position>=len(result['rows']):
            expect(result['status']=='invalid' and position==attempted[-1],'only final attempted child may be unvalidated')
            failure=load(root/'failure.json')
            expect(failure['position']==position and failure['verifiedRows']==len(rows) and failure['error']==result['stopReason'],'failure coordinate')
            if failure['stage']=='post-exit':
                span=ex['endMonotonic']-ex['startMonotonic'];wall=ex['endWall']-ex['startWall']
                expect(ex['exitCode']!=0 or ex['childError'] is not None or ex['wakeError'] is not None or ex['wakeAfter']!=ex['wakeBefore'] or not (0<=span<=30 and 0<=wall<=31 and abs(span-wall)<=1) or ex['endMonotonic']-r['startMonotonic']>900,'recorded post-exit failure fact')
            else:
                expect(failure['stage']=='validate-child','failed validation stage')
                try: verify_job(directory,c,physical)
                except (ValueError,KeyError,TypeError,IndexError,OSError): pass
                else: raise ValueError('recorded validator failure did not reproduce')
            break
        row=verify_job(directory,c,physical)
        identity=(ex['pid'],load(directory/'worker.json')['timeOrigin']);expect(identity not in identities,'fresh process identity');identities.add(identity)
        rows.append(row)
        if len(rows)%2==0:pairs.append(pair_result(rows[-2:]))
        if len(rows)%40==0:panels.append(panel_result(pairs[-20:],c['panel']))
    expect(result['rows']==rows and result['pairs']==pairs and result['panels']==panels,'independent summaries')
    expect(result['samples']==2400*len(rows),'retained sample count')
    if result['status']!='invalid':
        expect(result['stopReason'] is None and 0<result['elapsedSeconds']<=900 and prior-r['startMonotonic']<=result['elapsedSeconds'],'completed deadline')
        expect(len(rows) in (40,80),'complete panels')
        expect(len(rows)==(80 if panels[0]['passed'] else 40),'Z must pass before M')
        qualified=len(panels)==2 and all(p['passed'] for p in panels)
        expect(result['status']==('method-qualified' if qualified else 'method-not-qualified') and result['methodQualification']==qualified,'method verdict')
    else:
        expect(result['stopReason'] is not None and result['methodQualification'] is False,'invalid cannot qualify')
        if len(rows)==len(attempted):
            expect(failure['stage'] in ('complete','pre-dispatch'),'failure after validated prefix')
            if failure['stage']=='complete':expect(result['elapsedSeconds']>900,'final deadline failure fact')
            else:expect(failure['position']==len(attempted) and len(attempted)<80,'next pre-dispatch coordinate')
    return dict(status=result['status'],evidenceValid=True,processes=len(attempted),samples=len(rows)*2400,panels=panels,methodQualification=result['methodQualification'],consumerPerformanceQualification=False)

if __name__=='__main__':
    try:
        expect(len(sys.argv)==3,'usage: run directory original archive');value=verify(Path(sys.argv[1]).resolve(),Path(sys.argv[2]).resolve())
    except (ValueError,KeyError,TypeError,OSError,IndexError,AssertionError,subprocess.SubprocessError) as error:value=dict(status='invalid-evidence',evidenceValid=False,error=str(error))
    print(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False));sys.exit(0 if value['evidenceValid'] else 1)
