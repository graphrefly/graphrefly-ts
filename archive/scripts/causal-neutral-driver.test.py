"""Deterministic tools qualification; real Node loads stubs only, never archived runRow."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

runner=module('crossover_runner',HERE/'causal-neutral-driver.py')
verifier=module('crossover_verifier',HERE/'verify-causal-neutral-driver.py')
MUTANTS=[]


def samples():
    result=[]
    now=0
    for batch in range(3):
        for arm in (['reference','candidate'] if batch==1 else ['candidate','reference']):
            for index in range(400):
                duration=99999 if index<100 else (index-99)*(batch+1)*(2 if arm=='candidate' else 1)
                result.append(dict(batch=batch,arm=arm,index=index,phase='warmup' if index<100 else 'measured',
                    segment=f'cold-P2-summary/{batch}/{arm}/{index}',start=now,end=now+duration,
                    ms=duration,constructionMs=0,preparationMs=0))
                now+=duration+1
    return result


def write(path,value):
    path.write_text(json.dumps(value)+'\n')


def job_fixture(root,cell='H0',position=0):
    job=root/f'{position}-{cell}'; job.mkdir()
    kind,reference,order=runner.CELLS[cell]
    write(job/'config.json',runner.config_for(job,cell))
    (job/'entry.mjs').write_text(runner.entry_source(job,cell))
    events=[dict(kind='loaded',module=m,pid=123) for m in ['N',0,1]]+[dict(kind='driver',module='N' if kind=='neutral' else reference,pid=123)]
    (job/'entry-events.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in events))
    write(job/'exit.json',dict(pid=123,exitCode=0,cwd=str(job),argv=['node',*runner.FLAGS,str(job/'entry.mjs')],startMonotonic=10,endMonotonic=11))
    write(job/'worker.json',dict(pid=123,node='v24.18.0',control=True,row=runner.ROW,
        recipe=dict(warmup=100,measured=300,orders=[['candidate','reference'],['reference','candidate'],['candidate','reference']])))
    write(job/'preflight.json',dict(passed=True))
    if kind=='neutral':
        write(job/'preflight-first.json',dict(module=order[0],pid=123))
        write(job/'preflight-order.json',dict(cell=cell,referenceModule=reference,preflightOrder=order,pid=123))
    write(job/'completion.json',dict(completed=True,samples=2400))
    (job/'stdout.log').write_text('PRESET_PERFORMANCE_ROW_DONE cold-P2-summary 2400\n')
    (job/'samples.jsonl').write_text(''.join(json.dumps(s)+'\n' for s in samples()))
    return job


def index_fixture(root):
    write(root/'artifact-index.json',dict(files={str(p.relative_to(root)):runner.digest(p.read_bytes())
        for p in root.rglob('*') if p.is_file() and p!=root/'artifact-index.json'}))


def full_fixture(root):
    materials,bindings=runner.archive_materials()
    for name,data in materials.items():(root/name).write_bytes(data)
    (root/'source').mkdir()
    source_paths=runner.SOURCE_PATHS
    for p in source_paths:(root/'source'/p.name).write_bytes(p.read_bytes())
    (root/'approval.json').write_bytes(runner.APPROVAL.read_bytes())
    subprocess.run(['node',str(HERE/'derive-causal-neutral-driver.mjs'),str(root/'worker.mjs'),str(root/'neutral-driver.mjs'),str(root/'derivation.json')],check=True,capture_output=True,timeout=15)
    result=subprocess.run(['node',str(HERE/'check-causal-neutral-source.mjs'),str(root/'worker.mjs'),str(root/'neutral-driver.mjs')],check=True,capture_output=True,text=True,timeout=15)
    write(root/'source-check.json',json.loads(result.stdout))
    write(root/'reservation.json' ,dict(schedule=runner.SCHEDULE,runtime=dict(node='v24.18.0',v8='13.6.233.17-node.50'),
        implicitNodeOptions={},sourceDigests={p.name:runner.digest(p.read_bytes()) for p in source_paths},
        approvalDigest=runner.digest(runner.APPROVAL.read_bytes()),executionRoot=str(root),executable='node'))
    rows=[]
    for position,cell in enumerate(runner.SCHEDULE):
        job=job_fixture(root,cell,position)
        exit_record=runner.read(job/'exit.json')
        exit_record.update(position=position,cell=cell,startMonotonic=10+position*2,endMonotonic=11+position*2)
        write(job/'exit.json',exit_record)
        rows.append(dict(position=position,cell=cell,**runner.summarize(samples(),cell)))
    write(root/'result.json',dict(status='complete-diagnostic',stopReason=None,notRun=[],elapsedSeconds=24,
        rows=rows,performanceQualification=False,eventAssociation='unknown: retained native clocks uncalibrated'))
    index_fixture(root)


class NeutralTests(unittest.TestCase):
    def test_all_coordinates_and_quantiles(self):
        for cell in runner.CELLS:
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve();job=job_fixture(root,cell)
                got=verifier.verify_job(job,cell,root)
                self.assertEqual(got,runner.summarize(samples(),cell))
                self.assertEqual(got['medianBatchP95Ms'],dict(candidate=1140,reference=570))
                self.assertEqual(got['candidateOverReference'],2)
                self.assertEqual(got['m1OverM0'],2 if cell.endswith('0') else .5)
                self.assertEqual(got['preflightLaterOverEarlier'],.5 if cell.startswith('R') else 2)
                self.assertEqual(got['hostedExternalOverLocal'],2 if cell.startswith('H') else None)

    def test_00_all_retained_real_cold_samples_before_synthetic_acceptance(self):
        import tarfile
        totals={}
        for name in ['causal-performance-repetition-v2','causal-control-role-crossover-attempt-2','causal-control-role-crossover-v1']:
            archive=HERE.parent/'archive/evals'/name/'evidence.tar.gz'
            total=0
            with tarfile.open(archive) as tar:
                for member in tar.getmembers():
                    if member.name.endswith('/samples.jsonl'):
                        rows=[json.loads(line) for line in tar.extractfile(member).read().decode().splitlines()]
                        if rows and rows[0]['segment'].startswith('cold-P2-summary/'):
                            expected=[]
                            for batch,arms in enumerate([['candidate','reference'],['reference','candidate'],['candidate','reference']]):
                                for arm in arms+(['plain'] if len(rows)==3600 else []):
                                    for index in range(400):expected.append((batch,arm,index,'warmup' if index<100 else 'measured',f'cold-P2-summary/{batch}/{arm}/{index}'))
                            self.assertEqual([(s['batch'],s['arm'],s['index'],s['phase'],s['segment']) for s in rows],expected)
                            for sample in rows:
                                self.assertEqual(sample['constructionMs'],0)
                                self.assertEqual(sample['preparationMs'],0)
                                self.assertEqual(sample['ms'],sample['end']-sample['start'])
                            paired=[s for s in rows if s['arm']!='plain']
                            verifier.v.verify_samples(paired,0)
                            runner.h.summarize(paired,0);total+=len(rows)
            totals[name]=total
        self.assertEqual(totals,{'causal-performance-repetition-v2':67200,'causal-control-role-crossover-attempt-2':19200,'causal-control-role-crossover-v1':2400})

    def test_actual_entries_and_pre_dispatch_rejection(self):
        for cell in runner.CELLS:
            for mutation in [None,'row','control','slot','cell','order','self-copy','driver']:
                with tempfile.TemporaryDirectory() as tmp:
                    root=Path(tmp).resolve();job=root/'job';job.mkdir();actual=root/'actual.jsonl'
                    common='import {appendFileSync} from "node:fs";\n'+f'const mark=x=>appendFileSync({json.dumps(str(actual))},JSON.stringify(x)+"\\n");\n'
                    for id,name in enumerate(runner.NAMES):
                        (root/name).write_text(common+f'mark(["import",{id}]);\nexport const id={id};\nexport function preflight(){{mark(["preflight",id]);}}\nexport function measurementArm(){{mark(["factory",id]);return {{cleanup(){{mark(["cleanup",id]);}}}};}}\n'+
                            'export async function runRow(p){ const {readFileSync}=await import("node:fs"); const c=JSON.parse(readFileSync(p)); const twin=await import(c.copyModule); preflight(); twin.preflight(); measurementArm().cleanup(); twin.measurementArm().cleanup(); mark(["driver",id]); }')
                    (root/'neutral-driver.mjs').write_text(common+'mark(["import","N"]);\nexport async function runRow(p,modules){ const {readFileSync}=await import("node:fs"); const c=JSON.parse(readFileSync(p)); for(const i of c.diagnostic.preflightOrder)modules[i].preflight(); for(const m of modules)m.measurementArm().cleanup(); mark(["driver","N"]); }')
                    config=runner.config_for(job,cell);entry=runner.entry_source(job,cell)
                    if mutation=='row':config['row']={**config['row'],'group':'recovery'}
                    if mutation=='control':config['control']=False
                    if mutation=='slot':config['diagnostic']['referenceModule']=1-config['diagnostic']['referenceModule']
                    if mutation=='cell':config['diagnostic']['cell']='invalid'
                    if mutation=='order':config['diagnostic']['preflightOrder']=list(reversed(config['diagnostic']['preflightOrder']))
                    if mutation=='self-copy':config['copyModule']=(root/runner.NAMES[runner.CELLS[cell][1]]).as_uri()
                    if mutation=='driver':entry=entry.replace('await n.runRow','await m0.runRow') if not cell.startswith('H') else entry.replace('await m'+cell[-1]+'.runRow','await n.runRow')
                    write(job/'config.json',config);(job/'entry.mjs').write_text(entry)
                    child=subprocess.run(['node',str(job/'entry.mjs')],capture_output=True,text=True,timeout=10,env={'PATH':os.environ['PATH']})
                    observed=[json.loads(line) for line in actual.read_text().splitlines()] if actual.exists() else []
                    if mutation is None:
                        self.assertEqual(child.returncode,0,child.stderr)
                        self.assertEqual(observed[:3],[['import','N'],['import',0],['import',1]])
                        self.assertEqual([x[1] for x in observed if x[0]=='preflight'],runner.CELLS[cell][2])
                        self.assertEqual(sorted(x[1] for x in observed if x[0]=='factory'),[0,1])
                        self.assertEqual(sorted(x[1] for x in observed if x[0]=='cleanup'),[0,1])
                        self.assertEqual(observed[-1],['driver',int(cell[-1]) if cell.startswith('H') else 'N'])
                    elif mutation=='driver':
                        self.assertNotEqual(entry,verifier.expected_entry(job,root,cell))
                        self.assertTrue(child.returncode!=0 or observed[-1]!=['driver',int(cell[-1]) if cell.startswith('H') else 'N'])
                    else:
                        self.assertNotEqual(child.returncode,0)
                        self.assertEqual(observed,[],child.stderr)
                    if mutation:MUTANTS.append(dict(id=f'{cell}-{mutation}',kind='actual loaded entry stub',detected=True))

    def test_failure_timeout_and_single_use(self):
        materials,bindings=runner.archive_materials()
        for timeout in [False,True]:
            with tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp).resolve()/'run'
                class FakeChild:
                    pid=123
                    returncode=1
                    def wait(self,timeout=None):
                        if timeout is not None and should_timeout:raise subprocess.TimeoutExpired('stub',timeout)
                        return self.returncode
                    def kill(self):self.returncode=-9
                should_timeout=timeout
                fake_command=subprocess.CompletedProcess([],0,'{}','')
                with patch.object(runner,'OUTPUT',output),patch.object(runner,'archive_materials',return_value=(materials,bindings)),patch.object(runner.subprocess,'run',return_value=fake_command),patch.object(runner.subprocess,'Popen',return_value=FakeChild()) as spawn,patch.object(runner.subprocess,'check_output',return_value=b'{"node":"v24.18.0","v8":"13.6.233.17-node.50"}'):
                    self.assertEqual(runner.run(),1)
                    self.assertEqual(spawn.call_count,1)
                    with self.assertRaises(ValueError):runner.run()
                result=runner.read(output/'result.json')
                self.assertEqual(result['status'],'incomplete')
                self.assertEqual(result['notRun'],list(range(1,12)))
                self.assertEqual(runner.read(output/'0-H0'/'exit.json')['exitCode'],-9 if timeout else 1)
                MUTANTS.append(dict(id='timeout' if timeout else 'child-failure',kind='runner child stub',detected=True))

    def test_full_verifier_and_reindexed_negatives(self):
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp).resolve()/'base';base.mkdir();full_fixture(base)
            self.assertEqual(verifier.verify(base,runner.h.ARCHIVE)['samples'],28800)
            for mutation in ['whole-span','thirteenth-process','manifest-function','manifest-indices','manifest-kind','wrong-preflight','missing-completion','summary','environment']:
                root=base.parent/mutation;shutil.copytree(base,root)
                if mutation=='whole-span':
                    for p,c in enumerate(runner.SCHEDULE):
                        f=root/f'{p}-{c}'/'exit.json';r=runner.read(f);r.update(startMonotonic=10+p*100,endMonotonic=11+p*100);write(f,r)
                if mutation=='thirteenth-process':(root/'12-H0').mkdir()
                if mutation.startswith('manifest'):
                    f=root/'derivation.json';r=runner.read(f)
                    if mutation=='manifest-function':r['functionDigests']['runRow']='bad'
                    if mutation=='manifest-indices':r['replacedStatementIndices']=[]
                    if mutation=='manifest-kind':r['kind']='bad'
                    write(f,r)
                if mutation=='wrong-preflight':write(root/'1-N0/preflight-first.json',dict(module=1,pid=123))
                if mutation=='missing-completion':(root/'0-H0/completion.json').unlink()
                if mutation=='summary':
                    f=root/'result.json';r=runner.read(f);r['rows'][0]['candidateOverReference']=1;write(f,r)
                index_fixture(root)
                with patch.dict(os.environ,{'NODE_OPTIONS':'--import=/never-load.mjs'} if mutation=='environment' else {}):
                    with self.assertRaises((ValueError,OSError)):verifier.verify(root,runner.h.ARCHIVE)
                MUTANTS.append(dict(id=mutation,kind='complete reindexed verifier input',detected=True))

if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(NeutralTests))
    receipt=os.environ.get('NEUTRAL_PY_RECEIPT')
    if receipt:
        with Path(receipt).open('x') as f:json.dump(dict(testsRun=result.testsRun,failures=len(result.failures),errors=len(result.errors),mutants=MUTANTS,realConsumerMeasurements=0),f,indent=2)
    raise SystemExit(0 if result.wasSuccessful() else 1)
