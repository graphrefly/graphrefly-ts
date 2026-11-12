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

runner=module('crossover_runner',HERE/'causal-block-history.py')
verifier=module('crossover_verifier',HERE/'verify-causal-block-history.py')
MUTANTS=[]


def samples(cell,candidate_multiplier=2):
    result=[]
    now=0
    for batch in range(3):
        for arm in runner.ORDERS[cell][batch]:
            for index in range(400):
                duration=99999 if index<100 else (index-99)*(batch+1)*(candidate_multiplier if arm=='candidate' else 1)
                result.append(dict(batch=batch,arm=arm,index=index,phase='warmup' if index<100 else 'measured',
                    segment=f'cold-P2-summary/{batch}/{arm}/{index}',start=now,end=now+duration,
                    ms=duration,constructionMs=0,preparationMs=0))
                now+=duration+1
    return result


def write(path,value):
    path.write_text(json.dumps(value)+'\n')


def job_fixture(root,cell='S00',position=0):
    job=root/f'{position}-{cell}'; job.mkdir()
    kind,reference,order=runner.CELLS[cell]
    write(job/'config.json',runner.config_for(job,cell))
    (job/'entry.mjs').write_text(runner.entry_source(job,cell))
    events=[dict(kind='loaded',module=m,pid=123) for m in ['N',0,1]]+[dict(kind='driver',module='N' if kind=='neutral' else reference,pid=123)]
    (job/'entry-events.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in events))
    write(job/'exit.json',dict(pid=123,exitCode=0,cwd=str(job),argv=['node',*runner.FLAGS,str(job/'entry.mjs')],startMonotonic=10,endMonotonic=11))
    write(job/'worker.json',dict(pid=123,node='v24.18.0',control=True,row=runner.ROW,
        recipe={**runner.ORIGINAL_RECIPE,'orders':runner.ORDERS[cell]}))
    write(job/'preflight.json',dict(passed=True))
    if kind=='neutral':
        write(job/'preflight-first.json',dict(module=order[0],pid=123))
        write(job/'preflight-order.json',dict(cell=cell,referenceModule=reference,preflightOrder=order,orders=runner.ORDERS[cell],pid=123))
    proof=dict(pid=123,cell=cell,originalRecipe=runner.ORIGINAL_RECIPE,ordersDigest=runner.digest(json.dumps(runner.ORDERS[cell],separators=(',',':')).encode()))
    write(job/'recipe-before.json',proof);write(job/'recipe-after.json',proof)
    write(job/'completion.json',dict(completed=True,samples=2400))
    (job/'stdout.log').write_text('PRESET_PERFORMANCE_ROW_DONE cold-P2-summary 2400\n')
    (job/'samples.jsonl').write_text(''.join(json.dumps(s)+'\n' for s in samples(cell)))
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
    subprocess.run(['node',str(HERE/'derive-causal-block-driver.mjs'),str(root/'worker.mjs'),str(root/'block-history.mjs'),str(root/'derivation.json')],check=True,capture_output=True,timeout=15)
    result=subprocess.run(['node',str(HERE/'check-causal-block-source.mjs'),str(root/'worker.mjs'),str(root/'block-history.mjs')],check=True,capture_output=True,text=True,timeout=15)
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
        rows.append(dict(position=position,cell=cell,**runner.summarize(samples(cell),cell)))
    write(root/'result.json',dict(status='complete-diagnostic',stopReason=None,notRun=[],elapsedSeconds=24,
        rows=rows,contrasts=runner.contrasts(rows),performanceQualification=False,eventAssociation='unknown: retained native clocks uncalibrated'))
    index_fixture(root)


class BlockTests(unittest.TestCase):
    def test_all_coordinates_and_quantiles(self):
        for cell in runner.CELLS:
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve();job=job_fixture(root,cell)
                got=verifier.verify_job(job,cell,root)
                self.assertEqual(got,runner.summarize(samples(cell),cell))
                self.assertEqual(got['medianBatchP95Ms'],dict(candidate=1140,reference=570))
                self.assertEqual(got['candidateOverReference'],2)
                self.assertEqual(got['m1OverM0'],2)
                self.assertEqual(got['laterOverEarlierByBatch'],[2 if pair[1]=='candidate' else .5 for pair in runner.ORDERS[cell]])
                self.assertEqual(got['thirdOverSecond'],dict(candidate=1.5,reference=1.5))

    def test_00_all_retained_real_cold_samples_before_synthetic_acceptance(self):
        import tarfile
        totals={}
        for name in ['causal-performance-repetition-v2','causal-control-role-crossover-attempt-2','causal-control-role-crossover-v1','causal-neutral-driver-v1']:
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
        self.assertEqual(totals,{'causal-performance-repetition-v2':67200,'causal-control-role-crossover-attempt-2':19200,'causal-control-role-crossover-v1':2400,'causal-neutral-driver-v1':28800})
        old=module('retained_neutral_verifier',HERE/'verify-causal-neutral-driver.py')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve()
            with tarfile.open(HERE.parent/'archive/evals/causal-neutral-driver-v1/evidence.tar.gz') as tar:tar.extractall(root,filter='data')
            replay=old.verify(root/'run',runner.h.ARCHIVE)
            self.assertEqual(replay['samples'],28800)
            self.assertEqual(replay['status'],'complete-diagnostic')

    def test_actual_entries_and_full_driver(self):
        # Parse original source once; every Node execution below uses stub factories only.
        with tempfile.TemporaryDirectory() as workspace:
            work=Path(workspace).resolve()
            materials,_=runner.archive_materials();(work/'original.mjs').write_bytes(materials['worker.mjs'])
            subprocess.run(['node',str(HERE/'derive-causal-block-driver.mjs'),str(work/'original.mjs'),str(work/'derived.mjs'),str(work/'manifest.json')],check=True,capture_output=True,timeout=15)
            derived=(work/'derived.mjs').read_text()
            for cell in runner.CELLS:
                for mutation in [None,'row','control','slot','cell','order','self-copy','driver','orders']:
                    with tempfile.TemporaryDirectory() as tmp:
                        root=Path(tmp).resolve();job=root/'job';job.mkdir();actual=root/'actual.jsonl'
                        common='import {appendFileSync} from "node:fs";\n'+f'const mark=x=>appendFileSync({json.dumps(str(actual))},JSON.stringify(x)+"\\n");\n'
                        for id,name in enumerate(runner.NAMES):
                            (root/name).write_text(common+f'export const RECIPE={json.dumps(runner.ORIGINAL_RECIPE)};\nmark(["import",{id}]);\nexport const id={id};\nexport function preflight(){{mark(["preflight",id]);return {{passed:true}};}}\nexport function measurementArm(){{mark(["factory",id]);return {{cleanup(){{mark(["cleanup",id]);}}}};}}\n')
                        (root/'block-history.mjs').write_text(derived)
                        write(root/'P2-inputs.json',{})
                        config=runner.config_for(job,cell);entry=runner.entry_source(job,cell)
                        if mutation=='row':config['row']={**config['row'],'group':'recovery'}
                        if mutation=='control':config['control']=False
                        if mutation=='slot':config['diagnostic']['referenceModule']=1
                        if mutation=='cell':config['diagnostic']['cell']='invalid'
                        if mutation=='order':config['diagnostic']['preflightOrder']=[1,0]
                        if mutation=='self-copy':config['copyModule']=(root/'worker.mjs').as_uri()
                        if mutation=='driver':entry=entry.replace('await n.runRow','await m0.runRow')
                        if mutation=='orders':config['diagnostic']['orders']=[['candidate','candidate']]*3
                        write(job/'config.json',config);(job/'entry.mjs').write_text(entry)
                        child=subprocess.run(['node',str(job/'entry.mjs')],capture_output=True,text=True,timeout=10,env={'PATH':os.environ['PATH']})
                        observed=[json.loads(line) for line in actual.read_text().splitlines()] if actual.exists() else []
                        if mutation is None:
                            self.assertEqual(child.returncode,0,child.stderr)
                            self.assertEqual(observed[:4],[['import',0],['import',1],['preflight',0],['preflight',1]])
                            expected=[]
                            for pair in runner.ORDERS[cell]:
                                for arm in pair:
                                    for i in range(400):expected.extend([['factory',1 if arm=='candidate' else 0],['cleanup',1 if arm=='candidate' else 0]])
                            self.assertEqual(observed[4:],expected)
                            self.assertEqual(runner.read(job/'recipe-before.json'),runner.read(job/'recipe-after.json'))
                            self.assertEqual(runner.read(job/'worker.json')['recipe'],{**runner.ORIGINAL_RECIPE,'orders':runner.ORDERS[cell]})
                        elif mutation=='driver':
                            self.assertNotEqual(entry,verifier.expected_entry(job,root,cell))
                            self.assertNotEqual(child.returncode,0)
                            self.assertFalse(any(e[0]=='factory' for e in observed))
                        else:
                            self.assertNotEqual(child.returncode,0)
                            self.assertEqual(observed,[],child.stderr)
                        if mutation:MUTANTS.append(dict(id=f'{cell}-{mutation}',kind='actual entry with derived driver and stub factories',detected=True))

    def test_independent_half_contrasts_and_samples(self):
        rows=[]
        values=[{'S00':2,'S01':4,'S10':6,'S11':3},{'S00':3,'S01':9,'S10':6,'S11':6}]
        for p,cell in enumerate(runner.SCHEDULE):
            raw=samples(cell,values[p//4][cell])
            got=verifier.verify_samples(raw,cell)
            self.assertEqual(got,runner.summarize(raw,cell))
            rows.append(dict(position=p,cell=cell,**got))
        expected=[dict(half=0,thirdOrder=[2,.5],secondOrder=[3,.75],interaction=.25),dict(half=1,thirdOrder=[3,1],secondOrder=[2,2/3],interaction=1/3)]
        self.assertEqual(verifier.verify_contrasts(rows),expected)
        self.assertEqual(runner.contrasts(rows),expected)
        for mutation in ['missing','phase','duration','construction','nan','boolean','segment']:
            raw=samples('S11')
            if mutation=='missing':raw.pop()
            if mutation=='phase':raw[100]['phase']='warmup'
            if mutation=='duration':raw[100]['ms']=1
            if mutation=='construction':raw[100]['constructionMs']=raw[100]['ms']
            if mutation=='nan':raw[100]['ms']=float('nan')
            if mutation=='boolean':raw[0]['index']=False
            if mutation=='segment':raw[0]['segment']='wrong'
            with self.assertRaises(ValueError):verifier.verify_samples(raw,'S11')
            with self.assertRaises(ValueError):runner.summarize(raw,'S11')
            MUTANTS.append(dict(id=mutation,kind='new sample verifier negative',detected=True))

    def test_preparation_failure_retains_reservation(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp).resolve()/'run'
            with patch.object(runner,'OUTPUT',output),patch.object(runner,'archive_materials',side_effect=ValueError('material drift')),patch.object(runner.subprocess,'Popen') as spawn:
                self.assertEqual(runner.run(),1)
                spawn.assert_not_called()
                with self.assertRaises(ValueError):runner.run()
            self.assertEqual(runner.read(output/'reservation.json')['status'],'preparation-failed')
            self.assertEqual(runner.read(output/'result.json')['notRun'],list(range(8)))
            self.assertTrue((output/'artifact-index.json').exists())
            MUTANTS.append(dict(id='preparation-material-failure',kind='runner preparation stub',detected=True))

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
                self.assertEqual(result['notRun'],list(range(1,8)))
                self.assertEqual(runner.read(output/'0-S00'/'exit.json')['exitCode'],-9 if timeout else 1)
                MUTANTS.append(dict(id='timeout' if timeout else 'child-failure',kind='runner child stub',detected=True))

    def test_full_verifier_and_reindexed_negatives(self):
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp).resolve()/'base';base.mkdir();full_fixture(base)
            self.assertEqual(verifier.verify(base,runner.h.ARCHIVE)['samples'],19200)
            for mutation in ['whole-span','ninth-process','manifest-function','manifest-indices','manifest-kind','wrong-preflight','missing-completion','summary','environment','recipe-tamper','wrong-orders','old-sample-order','contrasts']:
                root=base.parent/mutation;shutil.copytree(base,root)
                if mutation=='whole-span':
                    for p,c in enumerate(runner.SCHEDULE):
                        f=root/f'{p}-{c}'/'exit.json';r=runner.read(f);r.update(startMonotonic=10+p*100,endMonotonic=11+p*100);write(f,r)
                if mutation=='ninth-process':(root/'8-S00').mkdir()
                if mutation.startswith('manifest'):
                    f=root/'derivation.json';r=runner.read(f)
                    if mutation=='manifest-function':r['functionDigests']['runRow']='bad'
                    if mutation=='manifest-indices':r['replacedStatementIndices']=[]
                    if mutation=='manifest-kind':r['kind']='bad'
                    write(f,r)
                if mutation=='wrong-preflight':write(root/'1-S01/preflight-first.json',dict(module=1,pid=123))
                if mutation=='missing-completion':(root/'0-S00/completion.json').unlink()
                if mutation=='summary':
                    f=root/'result.json';r=runner.read(f);r['rows'][0]['candidateOverReference']=1;write(f,r)
                if mutation=='recipe-tamper':
                    f=root/'1-S01/recipe-after.json';r=runner.read(f);r['originalRecipe']['warmup']=99;write(f,r)
                if mutation=='wrong-orders':
                    f=root/'1-S01/config.json';r=runner.read(f);r['diagnostic']['orders']=runner.ORDERS['S00'];write(f,r)
                if mutation=='old-sample-order':
                    (root/'1-S01/samples.jsonl').write_text(''.join(json.dumps(s)+'\n' for s in samples('S00')))
                if mutation=='contrasts':
                    f=root/'result.json';r=runner.read(f);r['contrasts'][0]['interaction']=7;write(f,r)
                index_fixture(root)
                with patch.dict(os.environ,{'NODE_OPTIONS':'--import=/never-load.mjs'} if mutation=='environment' else {}):
                    with self.assertRaises((ValueError,OSError)):verifier.verify(root,runner.h.ARCHIVE)
                MUTANTS.append(dict(id=mutation,kind='complete reindexed verifier input',detected=True))

if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(BlockTests))
    receipt=os.environ.get('BLOCK_PY_RECEIPT')
    if receipt:
        with Path(receipt).open('x') as f:json.dump(dict(testsRun=result.testsRun,failures=len(result.failures),errors=len(result.errors),mutants=MUTANTS,realConsumerMeasurements=0),f,indent=2)
    raise SystemExit(0 if result.wasSuccessful() else 1)
