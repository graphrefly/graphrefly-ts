"""D169 offline test vectors and failure replay. Synthetic clocks are not measurements."""
import copy
import importlib.util
import json
import math
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def import_tool(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py')
    x=importlib.util.module_from_spec(spec);spec.loader.exec_module(x);return x
r=import_tool('causal-position-pairs');v=import_tool('verify-causal-position-pairs')
ARCHIVE=ROOT/'archive/evals/causal-performance-repetition-v2'
NEGATIVES=0

def put(p,x):p.write_text(json.dumps(x,allow_nan=False)+'\n')
def reindex(root):put(root/'artifact-index.json',dict(files={str(p.relative_to(root)):v.sha(p) for p in root.rglob('*') if p.is_file() and p!=root/'artifact-index.json'}))
def samples(cell,z_cost=100):
    output=[];time=0
    for b in range(3):
        for s,arm in enumerate(r.ORDERS[cell['orientation']][b]):
            base=(100 if s==0 else 80)*(b+1)
            cost=2*base if cell['kind']=='mutation' and arm=='candidate' else base
            if cell['panel']=='Z' and cell['category']=='main' and arm=='candidate':cost=base*z_cost/100
            for i in range(400):
                start=time;end=start+cost;time=end+1
                output.append(dict(batch=b,arm=arm,index=i,phase='warmup' if i<100 else 'measured',segment=f'cold-P2-summary/{b}/{arm}/{i}',start=start,end=end,ms=end-start,constructionMs=0,preparationMs=0))
    return output

def fixture(root,count=80,z_cost=100):
    root.mkdir();(root/'source').mkdir();(root/'qualification').mkdir()
    materials,_=r.h.archive_materials()
    for name,data in materials.items():(root/name).write_bytes(data)
    source_hashes={name:v.sha(ROOT/'scripts'/name) for name in r.SOURCES}
    for name in r.SOURCES:(root/'source'/name).write_bytes((ROOT/'scripts'/name).read_bytes())
    a=json.loads(r.APPROVAL.read_text());(root/'approval.json').write_bytes(r.APPROVAL.read_bytes());(root/'approved-design.md').write_bytes((ROOT/a['design']).read_bytes())
    (root/'qualification/synthetic.log').write_text('SYNTHETIC TEST ONLY; NOT TOOL QUALIFICATION\n')
    q=dict(passed=True,sourceDigests=source_hashes,designDigest=a['designDigest'],logs={'synthetic.log':v.sha(root/'qualification/synthetic.log')})
    put(root/'qualification/qualification.json',q)
    subprocess.run(['node',str(ROOT/'scripts/derive-causal-position-driver.mjs'),str(root/'worker.mjs'),str(root/'position.mjs'),str(root/'derivation.json')],check=True,capture_output=True)
    checked=subprocess.run(['node',str(ROOT/'scripts/check-causal-position-source.mjs'),str(root/'worker.mjs'),str(root/'position.mjs')],check=True,capture_output=True,text=True)
    put(root/'source-check.json',json.loads(checked.stdout))
    put(root/'runtime-materials.json',{name:v.sha(root/name) for name in ['position.mjs','worker.mjs','worker-copy.mjs','P2-inputs.json']})
    bits=[0]*40;cells=r.schedule(bits)
    reservation=dict(status='reserved',approvalDigest=v.sha(root/'approval.json'),executionRoot=str(root),runtime=dict(node='v24.18.0',v8='13.6.233.17-node.50',platform='darwin'),executable='/synthetic/node',sourceDigests=source_hashes,qualificationDigest=v.sha(root/'qualification/qualification.json'),entropyHex='00'*5,orderBits=bits,schedule=cells,implicitNodeOptions={},wakeAtStart='synthetic-no-sleep',startMonotonic=0)
    put(root/'reservation.json',reservation);rows=[];pairs=[];panels=[]
    for c in cells[:count]:
        position=c['position'];job=root/f"{position:02d}-{c['panel']}-{c['pair']:02d}-{c['orientation']}";job.mkdir();pid=100+position
        put(job/'config.json',r.config_for(job,c));(job/'entry.mjs').write_text(r.entry_source(job,c))
        (job/'entry-events.jsonl').write_text(''.join(json.dumps(dict(module=m,pid=pid))+'\n' for m in ('N','M0','M1')))
        put(job/'worker.json',dict(pid=pid,node='v24.18.0',control=c['kind']=='control',row=r.ROW,recipe={**r.RECIPE,'orders':r.ORDERS[c['orientation']]},timeOrigin=1000+position))
        put(job/'preflight.json',dict(passed=True));put(job/'preflight-first.json',dict(module=0,pid=pid));put(job/'preflight-order.json',dict(modules=[0,1],pid=pid))
        put(job/'recipe-after.json',dict(pid=pid,recipe=r.RECIPE));put(job/'completion.json',dict(completed=True,samples=2400))
        (job/'stdout.log').write_text('PRESET_PERFORMANCE_ROW_DONE cold-P2-summary 2400\n');(job/'stderr.log').write_text('')
        record=dict(**c,argv=['/synthetic/node',*r.FLAGS,str(job/'entry.mjs')],cwd=str(job),startMonotonic=position+1,startWall=position+1001,wakeBefore='synthetic-no-sleep')
        put(job/'dispatch.json',record);put(job/'exit.json',{**record,'pid':pid,'exitCode':0,'endMonotonic':position+1.5,'endWall':position+1001.5,'wakeAfter':'synthetic-no-sleep','childError':None,'wakeError':None})
        raw=samples(c,z_cost);(job/'samples.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in raw));rows.append(dict(**c,**r.summarize(raw,c['orientation'])))
        if len(rows)%2==0:pairs.append(r.paired(rows[-2:]))
        if len(rows)%40==0:panels.append(r.panel_summary(pairs[-20:],c['panel']))
    passed=len(panels)==2 and all(p['passed'] for p in panels)
    put(root/'result.json',dict(status='method-qualified' if passed else 'method-not-qualified',rows=rows,pairs=pairs,panels=panels,stopReason=None,attempted=list(range(count)),notRun=list(range(count,80)),samples=count*2400,elapsedSeconds=count+2,methodQualification=passed,consumerPerformanceQualification=False,eventAssociation='unknown: retained native clocks uncalibrated'))
    reindex(root);return cells

class Tests(unittest.TestCase):
    def test_arithmetic_and_negative_coordinates(self):
        global NEGATIVES
        for bits in ([0]*40,[1]*40,[i%2 for i in range(40)]):self.assertEqual(r.schedule(bits),v.planned(bits))
        for bad in ([0]*39,[True]*40,[2]*40):
            for fn in (r.schedule,v.planned):
                with self.assertRaises(ValueError):fn(bad)
                NEGATIVES+=1
        for o in ('U','V'):
            c=r.schedule([0]*40)[0 if o=='U' else 1];raw=samples(c)
            self.assertEqual(r.summarize(raw,o),v.raw_summary(raw,o))
            for key,value in [('batch',True),('arm','plain'),('index',1),('phase','measured'),('segment','wrong'),('ms',-1),('ms',1),('constructionMs',1),('preparationMs',1),('start',float('nan')),('end',-1)]:
                bad=copy.deepcopy(raw);bad[0][key]=value
                for fn in (r.summarize,v.raw_summary):
                    with self.assertRaises((ValueError,KeyError)):fn(bad,o)
                    NEGATIVES+=1
        rows=[]
        for c in r.schedule([0]*40)[:2]:rows.append(dict(**c,**r.summarize(samples(c),c['orientation'])))
        # Independent first position 1.3, second .8 at each batch; max must not average.
        for row in rows:
            o=row['orientation'];row['p95']={'candidate':[],'reference':[]}
            for b in range(3):
                for s,a in enumerate(r.ORDERS[o][b]):row['p95'][a].append((130 if s==0 else 80) if a=='candidate' else 100)
        a=r.paired(rows);self.assertEqual(a,v.pair_result(rows));self.assertEqual(a['g'],{'first':1.3,'second':.8});self.assertEqual(a['T'],1.3)
        bad=copy.deepcopy(rows);bad[1]['pair']=99
        for fn in (r.paired,v.pair_result):
            with self.assertRaises(ValueError):fn(bad)
            NEGATIVES+=1
        for fn in (r.interval,v.band):self.assertEqual(fn(list(range(1,17))),dict(lower=2,point=8.5,upper=15))
        # Differing reference denominators distinguish median ratios (.3) from ratio medians (2).
        for b in range(3):
            for row in rows:
                o=row['orientation']
                for position,arm in enumerate(r.ORDERS[o][b]):
                    row['p95'][arm][b]=([1,20,30][b] if arm=='candidate' else [10,1,100][b]) if position==0 else ([200,30,4][b] if arm=='candidate' else [100,10,1][b])
        for fn in (r.paired,v.pair_result):
            result=fn(rows);self.assertEqual(result['g'],dict(first=.3,second=3));self.assertEqual(result['T'],3)
        for values in ([1]*15,[1]*15+[0],[1]*15+[float('inf')],[True]*16):
            for fn in (r.interval,v.band):
                with self.assertRaises(ValueError):fn(values)
                NEGATIVES+=1
    def test_exact_control_and_positive_boundaries(self):
        def make(panel,value):
            return [dict(panel=panel,pair=i,category='control' if i<2 or i>=18 else 'main',firstOrientation='U',g=dict(first=1/1.05 if i<2 or i>=18 else value,second=1.05 if i<2 or i>=18 else value),T=1.05 if i<2 or i>=18 else value) for i in range(20)]
        for fn in (r.panel_summary,v.panel_result):
            for edge in (1/1.05,1.05):self.assertTrue(fn(make('Z',edge),'Z')['passed'])
            self.assertFalse(fn(make('M',1.2),'M')['signalPassed'])
            self.assertTrue(fn(make('M',math.nextafter(1.2,math.inf)),'M')['passed'])
            for edge in (math.nextafter(1/1.05,0),math.nextafter(1.05,math.inf)):
                p=make('Z',1);p[0]['g']['first']=edge;self.assertFalse(fn(p,'Z')['controlStable'])

    def test_full_synthetic_qualification_and_reindexed_mutants(self):
        global NEGATIVES
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'run';fixture(root)
            self.assertEqual(v.verify(root,ARCHIVE)['status'],'method-qualified')
            job=root/'00-Z-00-U'
            other=root/'01-Z-00-V';saved={}
            for name in ('worker.json','exit.json','preflight-first.json','preflight-order.json','recipe-after.json'):
                path=other/name;saved[path]=path.read_bytes();item=json.loads(saved[path]);item['pid']=100
                if name=='worker.json':item['timeOrigin']=1000
                put(path,item)
            path=other/'entry-events.jsonl';saved[path]=path.read_bytes();path.write_text(''.join(json.dumps(dict(module=m,pid=100))+'\n' for m in ('N','M0','M1')))
            reindex(root)
            with self.assertRaisesRegex(ValueError,'fresh process identity'):v.verify(root,ARCHIVE)
            NEGATIVES+=1
            for path,content in saved.items():path.write_bytes(content)
            mutations=[(root/'result.json',lambda x:x.update(status='invalid',stopReason='invented',methodQualification=False)),(root/'result.json',lambda x:x.update(methodQualification=False)),(job/'config.json',lambda x:x.update(kind='mutation')),(job/'worker.json',lambda x:x.update(timeOrigin=-1,pid=500)),(job/'preflight-order.json',lambda x:x.update(modules=[1,0])),(job/'recipe-after.json',lambda x:x['recipe'].update(warmup=99))]
            for p,change in mutations:
                before=p.read_bytes();data=json.loads(before);change(data);put(p,data);reindex(root)
                with self.assertRaises((ValueError,KeyError,OSError)):v.verify(root,ARCHIVE)
                NEGATIVES+=1;p.write_bytes(before)
            reindex(root)
            result=json.loads((root/'result.json').read_text());result['pairs'][2]['g']['first']=99;put(root/'result.json',result);reindex(root)
            with self.assertRaises(ValueError):v.verify(root,ARCHIVE)
            NEGATIVES+=1
    def test_z_failure_stops_m_and_rejects_hidden_dispatch(self):
        global NEGATIVES
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'run';fixture(root,40,110)
            result=v.verify(root,ARCHIVE);self.assertEqual(result['status'],'method-not-qualified');self.assertEqual(result['samples'],96000)
            hidden=root/'40-M-00-U';hidden.mkdir();put(hidden/'exit.json',dict(exitCode=0));reindex(root)
            with self.assertRaises(ValueError):v.verify(root,ARCHIVE)
            NEGATIVES+=1
    def test_zero_exit_failed_validator_retained_and_reproduced(self):
        global NEGATIVES
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'run';fixture(root,1)
            p=root/'00-Z-00-U/samples.jsonl';lines=p.read_text().splitlines();x=json.loads(lines[0]);x['constructionMs']=1;lines[0]=json.dumps(x);p.write_text('\n'.join(lines)+'\n')
            result=json.loads((root/'result.json').read_text());result.update(status='invalid',rows=[],pairs=[],panels=[],samples=0,stopReason='ValueError: cold clocks',methodQualification=False);put(root/'result.json',result)
            put(root/'failure.json',dict(stage='validate-child',position=0,verifiedRows=0,error=result['stopReason']));reindex(root)
            self.assertTrue(v.verify(root,ARCHIVE)['evidenceValid'])
            x['constructionMs']=0;lines[0]=json.dumps(x);p.write_text('\n'.join(lines)+'\n');reindex(root)
            with self.assertRaises(ValueError):v.verify(root,ARCHIVE)
            NEGATIVES+=1
    def test_preparation_failure_single_use_and_hidden_execution(self):
        global NEGATIVES
        with tempfile.TemporaryDirectory(dir=ROOT/'archive/evals') as tmp:
            root=Path(tmp).resolve()/'run'
            approval=Path(tmp)/'approval.json';grant=json.loads(r.APPROVAL.read_text());grant['output']=str(root.relative_to(ROOT));put(approval,grant)
            with patch.object(r,'OUTPUT',root),patch.object(r,'APPROVAL',approval),patch.object(r.h,'archive_materials',side_effect=ValueError('fixture material failure')):
                self.assertEqual(r.run(),1)
                with self.assertRaises(ValueError):r.run()
            self.assertTrue(v.verify(root,ARCHIVE)['evidenceValid'])
            hidden=root/'hidden';hidden.mkdir();put(hidden/'samples.jsonl',[]);reindex(root)
            with self.assertRaises(ValueError):v.verify(root,ARCHIVE)
            NEGATIVES+=2
    def test_reserved_preparation_and_zero_exit_wake_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'run';fixture(root,1)
            result=json.loads((root/'result.json').read_text());result.update(status='invalid',rows=[],pairs=[],panels=[],samples=0,stopReason='ValueError: wake observation',methodQualification=False)
            put(root/'result.json',result);put(root/'failure.json',dict(stage='post-exit',position=0,verifiedRows=0,error=result['stopReason']))
            ex=root/'00-Z-00-U/exit.json';value=json.loads(ex.read_text());value.update(wakeAfter=None,wakeError='OSError: synthetic wake failure');put(ex,value);reindex(root)
            self.assertTrue(v.verify(root,ARCHIVE)['evidenceValid'])
            shutil.rmtree(root/'00-Z-00-U');(root/'runtime-materials.json').unlink();(root/'position.mjs').unlink()
            result.update(attempted=[],notRun=list(range(80)),stopReason='OSError: synthetic derivation failure');put(root/'result.json',result)
            put(root/'failure.json',dict(stage='derivation',position=None,verifiedRows=0,error=result['stopReason']));reindex(root)
            proof=v.verify(root,ARCHIVE);self.assertTrue(proof['evidenceValid']);self.assertIn('zero-dispatch',proof['failureProof'])

    def test_timeout_and_wake_failure_preserve_both(self):
        class Child:
            pid=123;returncode=None
            def wait(self,timeout=None):
                if timeout is not None:raise subprocess.TimeoutExpired('fixture',timeout)
                self.returncode=-9
            def poll(self):return self.returncode
            def kill(self):self.returncode=-9
        with tempfile.TemporaryDirectory() as tmp:
            job=Path(tmp)
            with patch.object(r.subprocess,'Popen',return_value=Child()),patch.object(r,'wake',side_effect=OSError('fixture wake')):
                result=r.execute_child(['fixture'],job,{},dict(startMonotonic=0,startWall=0),1)
            self.assertEqual(result['pid'],123);self.assertEqual(result['exitCode'],-9)
            self.assertIn('TimeoutExpired',result['childError']);self.assertIn('fixture wake',result['wakeError']);self.assertTrue((job/'exit.json').exists())

if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(Tests)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps(dict(passed=result.wasSuccessful(),tests=result.testsRun,negativeCases=NEGATIVES,syntheticOnly=True,consumerPerformanceSamples=0)))
    raise SystemExit(0 if result.wasSuccessful() else 1)
