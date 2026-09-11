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

runner=module('crossover_runner',HERE/'causal-control-crossover.py')
verifier=module('crossover_verifier',HERE/'verify-causal-control-crossover.py')
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


def job_fixture(root,cell=0,position=0):
    job=root/f'{position}-C{cell}'
    job.mkdir()
    order,driver=runner.CELLS[cell]
    write(job/'config.json',runner.config_for(job,driver))
    (job/'entry.mjs').write_text(runner.entry_source(job,order,driver))
    events=[dict(kind='loaded',module=m,pid=123) for m in order]+[dict(kind='driver',module=driver,pid=123)]
    (job/'entry-events.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in events))
    write(job/'exit.json',dict(pid=123,exitCode=0,cwd=str(job),argv=['node',*runner.FLAGS,str(job/'entry.mjs')],startMonotonic=10,endMonotonic=11))
    write(job/'worker.json',dict(pid=123,node='v24.18.0',control=True,row=runner.ROW,
        recipe=dict(warmup=100,measured=300,orders=[['candidate','reference'],['reference','candidate'],['candidate','reference']])))
    write(job/'preflight.json',dict(passed=True))
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
    source_paths=[HERE/'causal-control-crossover.py',HERE/'verify-causal-control-crossover.py']
    for p in source_paths:(root/'source'/p.name).write_bytes(p.read_bytes())
    (root/'approval.json').write_bytes(runner.APPROVAL.read_bytes())
    write(root/'reservation.json',dict(schedule=runner.SCHEDULE,runtime=dict(node='v24.18.0',v8='13.6.233.17-node.50'),
        implicitNodeOptions={},sourceDigests={p.name:runner.digest(p.read_bytes()) for p in source_paths},
        approvalDigest=runner.digest(runner.APPROVAL.read_bytes()),executionRoot=str(root),executable='node'))
    rows=[]
    for position,cell in enumerate(runner.SCHEDULE):
        job=job_fixture(root,cell,position)
        exit_record=runner.read(job/'exit.json')
        exit_record.update(position=position,cell=cell,startMonotonic=10+position*2,endMonotonic=11+position*2)
        write(job/'exit.json',exit_record)
        rows.append(dict(position=position,cell=cell,**runner.summarize(samples(),cell)))
    write(root/'result.json',dict(status='complete-diagnostic',stopReason=None,notRun=[],elapsedSeconds=16,
        rows=rows,performanceQualification=False,eventAssociation='unknown: retained native clocks uncalibrated'))
    index_fixture(root)


class CrossoverTests(unittest.TestCase):
    def test_independent_quantiles_and_coordinates(self):
        for cell in range(4):
            got=verifier.verify_samples(samples(),cell)
            self.assertEqual(got,runner.summarize(samples(),cell))
            self.assertEqual(got['batchP95Ms']['reference'],[285,570,855])
            self.assertEqual(got['medianBatchP95Ms'],dict(candidate=1140,reference=570))
            self.assertEqual(got['externalOverDriver'],2)
            self.assertEqual(got['m1OverM0'],2 if cell in (0,2) else .5)
            self.assertEqual(got['laterOverEarlier'],2 if cell in (0,3) else .5)

    def test_sample_mutations(self):
        changes={
            'missing-sample':lambda x:x.pop(),
            'duplicate-sample':lambda x:x.__setitem__(401,copy.deepcopy(x[400])),
            'wrong-phase':lambda x:x[100].update(phase='warmup'),
            'wrong-order':lambda x:x[400].update(arm='candidate'),
            'changed-duration':lambda x:x[200].update(ms=1),
            'wrong-cold-construction-field':lambda x:x[200].update(constructionMs=x[200]['ms']),
            'nan-duration':lambda x:x[200].update(ms=float('nan')),
            'nonmonotonic':lambda x:x[1].update(start=x[0]['start'],end=x[0]['end']),
            'boolean-coordinate':lambda x:x[0].update(index=False),
            'wrong-segment':lambda x:x[0].update(segment='fake'),
        }
        for name,change in changes.items():
            with self.subTest(name=name):
                altered=samples();change(altered)
                with self.assertRaises(ValueError):verifier.verify_samples(altered,0)
                MUTANTS.append(dict(id=name,loaded=True,outcome='detected',kind='verifier input'))

    def test_job_proofs_and_negative_controls(self):
        for cell in range(4):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve(); job=job_fixture(root,cell)
                self.assertEqual(verifier.verify_job(job,cell,root),runner.summarize(samples(),cell))
        changes={
            'wrong-copy':lambda job:write(job/'config.json',{**runner.config_for(job,0),'copyModule':(job.parent/'worker.mjs').as_uri()}),
            'missing-completion':lambda job:(job/'completion.json').unlink(),
            'wrong-pid':lambda job:write(job/'worker.json',{**runner.read(job/'worker.json'),'pid':999}),
            'wrong-entry':lambda job:(job/'entry.mjs').write_text((job/'entry.mjs').read_text().replace('await m0.runRow','await m1.runRow')),
            'wrong-import-events':lambda job:(job/'entry-events.jsonl').write_text('{}\n'),
            'wrong-argv':lambda job:write(job/'exit.json',{**runner.read(job/'exit.json'),'argv':['node','--expose-gc']}),
            'preflight-failure':lambda job:write(job/'preflight.json',dict(passed=False)),
        }
        for name,change in changes.items():
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve();job=job_fixture(root);change(job)
                with self.assertRaises((ValueError,OSError)):verifier.verify_job(job,0,root)
                MUTANTS.append(dict(id=name,loaded=True,outcome='detected',kind='verifier job input'))

    def test_actual_loaded_entry_roles_and_mutations(self):
        for mutation in (None,'wrong-driver','self-copy','reversed-load'):
            for cell in range(4):
                with tempfile.TemporaryDirectory() as tmp:
                    root=Path(tmp).resolve();job=root/'job';job.mkdir()
                    actual=root/'actual.jsonl'
                    for identity,name in enumerate(runner.NAMES):
                        (root/name).write_text('import {appendFileSync,readFileSync} from "node:fs";\n'
                            +f'const mark = x => appendFileSync({json.dumps(str(actual))},JSON.stringify(x)+"\\n");\n'
                            +f'mark({{kind:"import",module:{identity}}});\n'
                            +'export async function runRow(path) { const c=JSON.parse(readFileSync(path,"utf8"));\n'
                            +'if(c.copyModule===import.meta.url) throw Error("self copy");\n'
                            +f'mark({{kind:"runRow",module:{identity},copy:c.copyModule}}); }}\n')
                    order,driver=runner.CELLS[cell]
                    config=runner.config_for(job,driver)
                    text=runner.entry_source(job,order,driver)
                    if mutation=='wrong-driver':text=text.replace(f'await m{driver}.runRow',f'await m{1-driver}.runRow')
                    if mutation=='self-copy':config['copyModule']=(root/runner.NAMES[driver]).as_uri()
                    if mutation=='reversed-load':text=runner.entry_source(job,list(reversed(order)),driver)
                    write(job/'config.json',config);(job/'entry.mjs').write_text(text)
                    child=subprocess.run(['node',str(job/'entry.mjs')],capture_output=True,timeout=10,env={'PATH':os.environ['PATH']})
                    observed=[json.loads(line) for line in actual.read_text().splitlines()]
                    expected=[dict(kind='import',module=m) for m in order]+[
                        dict(kind='runRow',module=driver,copy=(root/runner.NAMES[1-driver]).as_uri())]
                    correct=child.returncode==0 and observed==expected
                    self.assertEqual(correct,mutation is None)
                    if mutation:
                        MUTANTS.append(dict(id=f'{mutation}-C{cell}',loaded=True,outcome='detected',kind='actual Node stub entry',entryDigest=runner.digest(text.encode())))

    def test_exact_archive_qualification_without_worker_execution(self):
        materials,info=runner.archive_materials()
        self.assertEqual(info['verifiedFiles'],321)
        self.assertEqual(info['runtimeClosureFiles'],60)
        self.assertEqual(materials['worker.mjs'],materials['worker-copy.mjs'])

    def test_full_verifier_rejects_extra_process_and_false_time_budget(self):
        for mutation in (None,'whole-span','ninth-process','changed-bundle','summary-tamper'):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve();full_fixture(root)
                if mutation=='whole-span':
                    for position,cell in enumerate(runner.SCHEDULE):
                        path=root/f'{position}-C{cell}'/'exit.json';record=runner.read(path)
                        record.update(startMonotonic=10+position*100,endMonotonic=11+position*100)
                        write(path,record)
                if mutation=='ninth-process':
                    job_fixture(root,0,8)
                if mutation=='changed-bundle':
                    path=root/'worker.mjs';path.write_bytes(path.read_bytes()+b'\n')
                if mutation=='summary-tamper':
                    path=root/'result.json';r=runner.read(path);r['rows'][0]['externalOverDriver']=1;write(path,r)
                index_fixture(root)
                if mutation is None:
                    self.assertEqual(verifier.verify(root,runner.ARCHIVE)['samples'],19200)
                else:
                    with self.assertRaises(ValueError):verifier.verify(root,runner.ARCHIVE)
                    MUTANTS.append(dict(id=mutation,loaded=True,outcome='detected',kind='complete verifier input, reindexed'))

    def test_actual_frozen_cold_samples_and_partial_replay(self):
        import tarfile
        with tarfile.open(runner.ARCHIVE/'evidence.tar.gz') as tar:
            for control in range(4):
                raw=tar.extractfile(f'method-validation/control-{control}/samples.jsonl').read().decode()
                actual=[json.loads(line) for line in raw.splitlines()]
                self.assertTrue(all(s['constructionMs']==0 for s in actual))
                self.assertEqual(verifier.verify_samples(actual,0),runner.summarize(actual,0))
        with tempfile.TemporaryDirectory() as tmp:
            import shutil
            root=Path(tmp).resolve();full_fixture(root)
            for position,cell in list(enumerate(runner.SCHEDULE))[1:]:shutil.rmtree(root/f'{position}-C{cell}')
            r=runner.read(root/'result.json');r.update(status='incomplete',stopReason='original validator rejected',rows=[],notRun=list(range(1,8)),elapsedSeconds=2)
            write(root/'result.json',r);index_fixture(root)
            replay=verifier.verify(root,runner.ARCHIVE)
            self.assertEqual(replay['status'],'incomplete')
            self.assertEqual(replay['retainedRowsVerified'],1)
            self.assertEqual(replay['samples'],2400)
            self.assertFalse(replay['performanceQualification'])

    def test_preparation_failure_is_retained(self):
        materials,bindings=runner.archive_materials()
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp).resolve()/'run'
            original_put=runner.put
            def fail_reservation(path,value):
                if path.name=='reservation.json':raise OSError('injected preparation failure')
                original_put(path,value)
            with patch.object(runner,'OUTPUT',output), patch.object(runner,'archive_materials',return_value=(materials,bindings)), patch.object(runner,'put',side_effect=fail_reservation), patch.object(runner.subprocess,'Popen') as spawn, patch.object(runner.subprocess,'check_output',return_value=b'{"node":"v24.18.0","v8":"13.6.233.17-node.50"}'):
                self.assertEqual(runner.run(),1)
                spawn.assert_not_called()
            self.assertEqual(runner.read(output/'result.json')['notRun'],list(range(8)))
            self.assertTrue((output/'artifact-index.json').exists())

    def test_failure_timeout_stop_and_single_use(self):
        materials,bindings=runner.archive_materials()
        for timeout in (False,True):
            with tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp).resolve()/'run'
                class FakeChild:
                    pid=123
                    returncode=1
                    def __init__(self,*args,**kwargs):pass
                    def wait(self,timeout=None):
                        if timeout is not None and should_timeout:raise subprocess.TimeoutExpired('stub',timeout)
                        return self.returncode
                    def kill(self):self.returncode=-9
                should_timeout=timeout
                with patch.object(runner,'OUTPUT',output), patch.object(runner,'archive_materials',return_value=(materials,bindings)), patch.object(runner.subprocess,'Popen',side_effect=FakeChild) as spawn, patch.object(runner.subprocess,'check_output',return_value=b'{"node":"v24.18.0","v8":"13.6.233.17-node.50"}'):
                    self.assertEqual(runner.run(),1)
                    self.assertEqual(spawn.call_count,1)
                    with self.assertRaises(ValueError):runner.run()
                result=runner.read(output/'result.json')
                self.assertEqual(result['status'],'incomplete')
                self.assertEqual(result['notRun'],list(range(1,8)))
                self.assertTrue((output/'artifact-index.json').exists())
                self.assertEqual(runner.read(output/'0-C0'/'exit.json')['exitCode'],-9 if timeout else 1)


if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(CrossoverTests))
    receipt=os.environ.get('CROSSOVER_TEST_RECEIPT')
    if receipt:
        with Path(receipt).open('x') as f:json.dump(dict(testsRun=result.testsRun,failures=len(result.failures),errors=len(result.errors),mutants=MUTANTS,realConsumerMeasurements=0),f,indent=2)
    raise SystemExit(0 if result.wasSuccessful() else 1)
