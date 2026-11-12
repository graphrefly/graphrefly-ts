"""Independent neutral experiment verification; Node subprocess only parses source AST."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile

spec=importlib.util.spec_from_file_location('crossover_verifier',Path(__file__).with_name('verify-causal-control-crossover.py'))
v=importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
expect,load,sha=v.expect,v.load,v.sha
BUNDLE,INPUT,QUAL,ARCHIVE,NAMES,ROW,FLAGS=v.BUNDLE,v.INPUT,v.QUAL,v.ARCHIVE,v.NAMES,v.ROW,v.FLAGS
SCHEDULE=('H0','N0','R0','H1','N1','R1','R1','N1','H1','R0','N0','H0')
CELLS={'H0':('hosted',0,(0,1)),'N0':('neutral',0,(0,1)),'R0':('neutral',0,(1,0)),
       'H1':('hosted',1,(1,0)),'N1':('neutral',1,(1,0)),'R1':('neutral',1,(0,1))}


def expected_entry(job,physical_root,cell):
    kind,reference,order=CELLS[cell]
    config=dict(row=ROW,output=str(job),scenarioPath=str(physical_root/"P2-inputs.json"),control=True,
                copyModule=(physical_root/NAMES[1-reference]).as_uri(),diagnostic=dict(cell=cell,referenceModule=reference,preflightOrder=list(order)))
    text='import assert from "node:assert/strict";\nimport {appendFileSync,readFileSync} from "node:fs";\n'
    text+='assert.deepEqual(JSON.parse(readFileSync('+json.dumps(str(job/"config.json"))+', "utf8")), '+json.dumps(config)+');\n'
    text+='const record = (event) => appendFileSync('+json.dumps(str(job/'entry-events.jsonl'))+', JSON.stringify({...event,pid:process.pid})+"\\n");\n'
    for variable,name,identity in [('n','neutral-driver.mjs','N'),('m0','worker.mjs',0),('m1','worker-copy.mjs',1)]:
        text+='const '+variable+' = await import('+json.dumps((physical_root/name).as_uri())+');\n'
        text+='record({kind:"loaded",module:'+json.dumps(identity)+'});\n'
    text+='record({kind:"driver",module:'+json.dumps('N' if kind=='neutral' else reference)+'});\n'
    text+='await '+('n' if kind=='neutral' else 'm'+str(reference))+'.runRow('+json.dumps(str(job/'config.json'))+(', [m0,m1]' if kind=='neutral' else '')+');\n'
    return text


def verify_job(directory,cell,physical_root):
    kind,reference,order=CELLS[cell]
    job=physical_root/directory.name
    expect((directory/'entry.mjs').read_text()==expected_entry(job,physical_root,cell),'actual entry source')
    config=dict(row=ROW,output=str(job),scenarioPath=str(physical_root/'P2-inputs.json'),control=True,
                copyModule=(physical_root/NAMES[1-reference]).as_uri(),diagnostic=dict(cell=cell,referenceModule=reference,preflightOrder=list(order)))
    expect(load(directory/'config.json')==config,'coordinates/config')
    record=load(directory/'exit.json');pid=record['pid']
    expect(type(pid) is int and pid>0 and record['exitCode']==0,'process identity/exit')
    expect(record['cwd']==str(job) and record['argv'][1:]==FLAGS+[str(job/'entry.mjs')],'argv/cwd')
    expect(0<=record['endMonotonic']-record['startMonotonic']<=30,'child deadline')
    events=[json.loads(line) for line in (directory/'entry-events.jsonl').read_text().splitlines()]
    expect(events==[dict(kind='loaded',module=x,pid=pid) for x in ['N',0,1]]+[dict(kind='driver',module='N' if kind=='neutral' else reference,pid=pid)],'execution/import observations')
    metadata=load(directory/'worker.json')
    expect(metadata['node']=='v24.18.0' and metadata['pid']==pid and metadata['control'] is True and metadata['row']==ROW,'worker identity')
    recipe=metadata['recipe']
    expect(recipe['warmup']==100 and recipe['measured']==300 and recipe['orders']==[['candidate','reference'],['reference','candidate'],['candidate','reference']],'recipe')
    expect(load(directory/'preflight.json')['passed'] is True,'semantic preflight')
    if kind=='neutral':
        expect(load(directory/'preflight-first.json')==dict(module=order[0],pid=pid),'preflight first')
        expect(load(directory/'preflight-order.json')==dict(cell=cell,referenceModule=reference,preflightOrder=list(order),pid=pid),'preflight order')
    expect(load(directory/'completion.json')==dict(completed=True,samples=2400),'completion')
    expect('PRESET_PERFORMANCE_ROW_DONE cold-P2-summary 2400' in (directory/'stdout.log').read_text(),'completion sentinel')
    raw=[json.loads(line) for line in (directory/'samples.jsonl').read_text().splitlines()]
    result=v.verify_samples(raw,0)
    med=result['medianBatchP95Ms']
    physical=[med['reference'] if i==reference else med['candidate'] for i in (0,1)]
    return dict(batchP95Ms=result['batchP95Ms'],medianBatchP95Ms=med,
                candidateOverReference=med['candidate']/med['reference'],m1OverM0=physical[1]/physical[0],
                preflightLaterOverEarlier=physical[order[1]]/physical[order[0]],
                hostedExternalOverLocal=result['externalOverDriver'] if kind=='hosted' else None)


def verify(root, archive):
    expect(sha(archive/'evidence.tar.gz')==ARCHIVE, 'original archive digest')
    expect(sha(archive/'artifact-index.json')=='07a8e0384997617197f729bf11bd997335095227244eb8e11a18cc4603e85ef8', 'original index digest')
    original_index = load(archive/'artifact-index.json')['files']
    seen = set()
    with tarfile.open(archive/'evidence.tar.gz') as tar:
        for member in tar.getmembers():
            expect(member.isfile() and member.name in original_index and member.name not in seen,'original archive member')
            seen.add(member.name)
            expect('sha256:'+hashlib.sha256(tar.extractfile(member).read()).hexdigest()==original_index[member.name], 'original archive bytes')
    expect(seen==set(original_index), 'original archive completeness')
    indexed = load(root/'artifact-index.json')['files']
    actual = set()
    for path in root.rglob('*'):
        expect(not path.is_symlink(), 'no symlinks')
        if path.is_file() and path != root/'artifact-index.json':
            actual.add(str(path.relative_to(root)))
    expect(actual==set(indexed), 'complete evidence inventory')
    for name, value in indexed.items():
        expect(not Path(name).is_absolute() and '..' not in Path(name).parts, 'index path')
        expect(sha(root/name)==value, 'evidence digest')
    for name,value in [('worker.mjs',BUNDLE),('worker-copy.mjs',BUNDLE),('P2-inputs.json',INPUT),('reference-qualification.json',QUAL)]:
        expect(sha(root/name)==value,'frozen material')
    reservation = load(root/'reservation.json')
    expect(reservation['schedule']==list(SCHEDULE), 'schedule')
    expect(reservation['runtime']['node']=='v24.18.0' and reservation['runtime']['v8']=='13.6.233.17-node.50', 'runtime')
    expect(reservation['implicitNodeOptions']=={}, 'implicit options')
    for name,value in reservation['sourceDigests'].items():
        expect(sha(root/'source'/name)==value,'executed tool snapshot')
    expect(sha(root/'approval.json')==reservation['approvalDigest'],'approval binding')
    checker=Path(__file__).with_name('check-causal-neutral-source.mjs')
    expect(sha(checker)==sha(root/'source'/checker.name),'static checker source binding')
    expect(not any(os.environ.get(k) for k in ('NODE_OPTIONS','NODE_COMPILE_CACHE','NODE_V8_COVERAGE')), 'implicit Node options')
    env={k:os.environ[k] for k in ('PATH','HOME','TMPDIR','LANG','LC_ALL','TZ') if k in os.environ}
    parser_check=subprocess.run(['node',str(checker),str(root/'worker.mjs'),str(root/'neutral-driver.mjs')],capture_output=True,text=True,timeout=15,env=env)
    expect(parser_check.returncode==0,'independent source AST check: '+parser_check.stderr)
    source_check=json.loads(parser_check.stdout)
    expect(source_check==load(root/'source-check.json'),'source check bytes/structure')
    manifest=load(root/'derivation.json')
    expect(manifest==dict(kind='neutral-driver-source-derivation-v1', originalDigest=BUNDLE, derivedDigest=sha(root/'neutral-driver.mjs'),
        functionDigests=dict(runRow='c36a27e4a40aaae9cec16aea83a5bfa9db5afff04ddd184eb392838645eec5a3',schedule='20db86119f6367133cb1534d3d94c9606d8a764801d8176c2fcbc4475c66063a',cleanupAll='512a11336f9831c67126edc36b62e214c29e5817be759788a9fbb2eda369d782'),
        unchangedStatementIndices=[0,1,2,7,8,9,10,11,12,13,14,15],replacedStatementIndices=[3,4,5,6],
        changes=['parameter/modules guards and recipe binding','two external factories and ordered preflight','cold-only closure guard'],parserVersion=source_check['parserVersion']), 'complete derivation manifest')
    result = load(root/'result.json')
    expected_dirs={f'{p}-{c}' for p,c in enumerate(SCHEDULE)}
    execution_dirs={p.name for p in root.iterdir() if p.is_dir() and p.name!='source'}
    expect(execution_dirs <= expected_dirs, 'unexpected execution directory')
    for name in indexed:
        if Path(name).name in ('exit.json','samples.jsonl'):
            expect(len(Path(name).parts)==2 and Path(name).parts[0] in expected_dirs, 'extra execution evidence')
    physical_root = Path(reservation['executionRoot'])
    expect(physical_root.is_absolute(), 'original execution root')
    expect(result['performanceQualification'] is False, 'diagnostic cannot qualify performance')
    expect(result['eventAssociation']=='unknown: retained native clocks uncalibrated','uncalibrated association')
    if result['status']=='incomplete':
        # Independently salvage complete retained children, never promote a partial experiment.
        positions=[p for p,c in enumerate(SCHEDULE) if (root/f'{p}-{c}'/'exit.json').exists()]
        expect(positions==list(range(len(positions))), 'partial execution prefix')
        expect(result['notRun']==[p for p in range(12) if p not in positions], 'partial not-run')
        rows=[]
        last_end=None
        first_start=None
        for position in positions:
            cell=SCHEDULE[position]
            directory=root/f'{position}-{cell}'
            record=load(directory/'exit.json')
            expect(record['position']==position and record['cell']==cell, 'partial identity')
            expect(record['argv'][0]==reservation['executable'], 'partial executable')
            if first_start is None:
                first_start=record['startMonotonic']
            if last_end is not None:
                expect(record['startMonotonic']>=last_end, 'partial serial execution')
            last_end=record['endMonotonic']
            if record['exitCode']!=0:
                expect(position==positions[-1], 'no dispatch after failed child')
                break
            rows.append(dict(position=position,cell=cell,**verify_job(directory,cell,physical_root)))
        if last_end is not None:
            expect(0<=last_end-first_start<=result['elapsedSeconds'], 'partial recorded span')
        return dict(status='incomplete',completeEvidenceVerified=False,reason=result['stopReason'],
                    retainedRowsVerified=len(rows),samples=len(rows)*2400,rows=rows,notRun=result['notRun'],
                    performanceQualification=False,eventAssociation='unknown')
    expect(result['status']=='complete-diagnostic' and result['stopReason'] is None and result['notRun']==[], 'completion state')
    expect(0<result['elapsedSeconds']<=420, 'whole-run deadline')
    expect(len(result['rows'])==12 and execution_dirs==expected_dirs,'twelve results/directories')
    summaries=[]
    previous_end=-1
    first_start=None
    for position,cell in enumerate(SCHEDULE):
        directory=root/f'{position}-{cell}'
        record=load(directory/'exit.json')
        expect(record['cell']==cell and record['position']==position,'job identity')
        expect(record['argv'][0]==reservation['executable'],'executable identity')
        if first_start is None:
            first_start=record['startMonotonic']
        expect(record['startMonotonic']>=previous_end, 'serial execution')
        previous_end=record['endMonotonic']
        computed=dict(position=position,cell=cell,**verify_job(directory,cell,physical_root))
        expect(computed==result['rows'][position],'independent summary equality')
        summaries.append(computed)
    expect(0<previous_end-first_start<=result['elapsedSeconds']<=420, 'recorded whole-run span')
    return dict(status='complete-diagnostic',samples=28800,processes=12,rows=summaries,
                performanceQualification=False,eventAssociation='unknown')


if __name__=='__main__':
    try:
        expect(len(sys.argv)==3, 'usage: verifier run-directory original-archive-directory')
        value=verify(Path(sys.argv[1]).resolve(),Path(sys.argv[2]).resolve())
    except (ValueError,KeyError,TypeError,OSError,IndexError,subprocess.SubprocessError) as error:
        value=dict(status='invalid',error=str(error))
    print(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False))
    sys.exit(0 if value['status']=='complete-diagnostic' else 1)
