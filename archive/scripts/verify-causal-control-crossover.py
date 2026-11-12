"""Independent offline verifier. No runner import, Node execution, or sampling."""
import hashlib
import json
import math
from pathlib import Path
import sys
import tarfile

SCHEDULE = (0, 1, 3, 2, 2, 3, 1, 0)
CELLS = {0: ((0,1),0), 1: ((0,1),1), 2: ((1,0),0), 3: ((1,0),1)}
BUNDLE = 'd9d8606d73e1bcfad66097f027d63c99fc409571042c5f1e7efffaa645356fb2'
INPUT = '44f1165557fc1444540731a73846233ce3d71da7a0af3a3d4fa2137e249c2079'
QUAL = 'd6748e269f7c86cd838099e405a3eda70705b9bfdcff711fda630c2035afe60e'
ARCHIVE = '3483b61f34da607ccd04ff99b86e49d14e90584f843ff3aefcf2640d60a4fbd7'
NAMES = ('worker.mjs','worker-copy.mjs')
ROW = {'id':'cold-P2-summary','group':'cold','profile':'P2','mode':'summary'}
FLAGS = ['--trace-gc','--trace-deopt','--log-deopt','--no-logfile-per-isolate','--logfile=v8.log']


def expect(test, message):
    if not test:
        raise ValueError(message)


def load(path):
    return json.loads(path.read_text(), parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def expected_entry(job, physical_root, cell):
    order, driver = CELLS[cell]
    lines = ['import {appendFileSync} from "node:fs";',
             'const record = (event) => appendFileSync(' + json.dumps(str(job/'entry-events.jsonl')) + ', JSON.stringify({...event,pid:process.pid})+"\\n");']
    for identity in order:
        lines.append('const m%d = await import(%s);' % (identity, json.dumps((physical_root/NAMES[identity]).as_uri())))
        lines.append('record({kind:"loaded",module:%d});' % identity)
    lines.append('record({kind:"driver",module:%d});' % driver)
    lines.append('await m%d.runRow(%s);' % (driver, json.dumps(str(job/'config.json'))))
    return '\n'.join(lines)+'\n'


def verify_samples(samples, cell):
    expect(len(samples)==2400, '2400 samples required')
    buckets = {(b,a):[] for b in range(3) for a in ('candidate','reference')}
    prior = -1
    for offset, sample in enumerate(samples):
        block, index = divmod(offset,400)
        batch, ordinal = divmod(block,2)
        arm = (('candidate','reference') if batch != 1 else ('reference','candidate'))[ordinal]
        expect(type(sample['index']) is int and type(sample['batch']) is int, 'integer coordinates')
        expect((sample['index'],sample['batch'],sample['arm'],sample['phase']) ==
               (index,batch,arm,'measured' if index>=100 else 'warmup'), 'coordinates/phase')
        expect(sample['segment']==f'cold-P2-summary/{batch}/{arm}/{index}', 'segment')
        for key in ('start','end','ms','constructionMs','preparationMs'):
            v = sample[key]
            expect(type(v) in (int,float) and math.isfinite(v) and v>=0, 'finite times')
        expect(sample['end']-sample['start']==sample['ms'], 'clock difference')
        expect(sample['constructionMs']==0 and sample['preparationMs']==0, 'cold construction')
        expect(sample['start']>=prior, 'time ordering')
        prior = sample['end']
        if index>=100:
            buckets[(batch,arm)].append(sample['ms'])
    p95 = {arm:[sorted(buckets[(batch,arm)])[284] for batch in range(3)] for arm in ('candidate','reference')}
    med = {arm:sorted(values)[1] for arm,values in p95.items()}
    expect(min(med.values())>0, 'positive quantiles')
    order, driver = CELLS[cell]
    m = [med['reference'] if module==driver else med['candidate'] for module in (0,1)]
    return dict(batchP95Ms=p95, medianBatchP95Ms=med,
                externalOverDriver=med['candidate']/med['reference'],
                m1OverM0=m[1]/m[0],laterOverEarlier=m[order[1]]/m[order[0]])


def verify_job(directory, cell, physical_root):
    # physical_root is retained original location, so read-only relocation is supported.
    original = physical_root/directory.name
    order, driver = CELLS[cell]
    expect((directory/'entry.mjs').read_text()==expected_entry(original,physical_root,cell), 'entry source')
    expect(load(directory/'config.json')==dict(row=ROW,output=str(original),
        scenarioPath=str(physical_root/'P2-inputs.json'),control=True,
        copyModule=(physical_root/NAMES[1-driver]).as_uri()), 'config mapping')
    exit_record = load(directory/'exit.json')
    pid = exit_record['pid']
    expect(type(pid) is int and pid>0, 'pid')
    expect(exit_record['exitCode']==0, 'exit code')
    expect(exit_record['cwd']==str(original) and exit_record['argv'][1:]==FLAGS+[str(original/'entry.mjs')], 'execution coordinates')
    duration = exit_record['endMonotonic']-exit_record['startMonotonic']
    expect(0<=duration<=30, 'child deadline')
    events = [json.loads(line) for line in (directory/'entry-events.jsonl').read_text().splitlines()]
    expect(events==[dict(kind='loaded',module=m,pid=pid) for m in order]+[dict(kind='driver',module=driver,pid=pid)], 'actual import/driver events')
    worker = load(directory/'worker.json')
    expect(worker['pid']==pid and worker['node']=='v24.18.0' and worker['control'] is True and worker['row']==ROW, 'worker identity')
    recipe = worker['recipe']
    expect(recipe['warmup']==100 and recipe['measured']==300 and recipe['orders']==[
        ['candidate','reference'],['reference','candidate'],['candidate','reference']], 'recipe')
    expect(load(directory/'preflight.json')['passed'] is True, 'semantic preflight')
    expect(load(directory/'completion.json')==dict(completed=True,samples=2400), 'completion')
    expect('PRESET_PERFORMANCE_ROW_DONE cold-P2-summary 2400' in (directory/'stdout.log').read_text(), 'worker completion sentinel')
    samples = [json.loads(line) for line in (directory/'samples.jsonl').read_text().splitlines()]
    return verify_samples(samples,cell)


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
    result = load(root/'result.json')
    expected_dirs={f'{p}-C{c}' for p,c in enumerate(SCHEDULE)}
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
        positions=[p for p,c in enumerate(SCHEDULE) if (root/f'{p}-C{c}'/'exit.json').exists()]
        expect(positions==list(range(len(positions))), 'partial execution prefix')
        expect(result['notRun']==[p for p in range(8) if p not in positions], 'partial not-run')
        rows=[]
        last_end=None
        first_start=None
        for position in positions:
            cell=SCHEDULE[position]
            directory=root/f'{position}-C{cell}'
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
    expect(0<result['elapsedSeconds']<=300, 'whole-run deadline')
    expect(len(result['rows'])==8 and execution_dirs==expected_dirs,'eight results/directories')
    summaries=[]
    previous_end=-1
    first_start=None
    for position,cell in enumerate(SCHEDULE):
        directory=root/f'{position}-C{cell}'
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
    expect(0<previous_end-first_start<=result['elapsedSeconds']<=300, 'recorded whole-run span')
    return dict(status='complete-diagnostic',samples=19200,processes=8,rows=summaries,
                performanceQualification=False,eventAssociation='unknown')


if __name__=='__main__':
    try:
        expect(len(sys.argv)==3, 'usage: verifier run-directory original-archive-directory')
        value=verify(Path(sys.argv[1]).resolve(),Path(sys.argv[2]).resolve())
    except (ValueError,KeyError,TypeError,OSError,IndexError) as error:
        value=dict(status='invalid',error=str(error))
    print(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False))
    sys.exit(0 if value['status']=='complete-diagnostic' else 1)
