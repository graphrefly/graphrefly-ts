import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
s=importlib.util.spec_from_file_location('capture',Path(__file__).with_name('capture-causal-workload.py'))
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Qualification(unittest.TestCase):
 def test_preparation_failure_preserved_and_single_use(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'approval').write_text('SYNTHETIC');q=root/'q.json';q.write_text(json.dumps({'captureToolingQualified':False}))
   args=(root/'prepared',root/'scenario',root/'approval',q,root/'out',root/'node')
   with self.assertRaises(AssertionError):m.capture(*args)
   self.assertTrue((root/'out/failure.json').exists())
   self.assertFalse((root/'out/reservation.json').exists())
   with self.assertRaises(FileExistsError):m.capture(*args)
 def test_source_failure_before_spawn(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'approval').write_text('SYNTHETIC');q=root/'q.json';q.write_text(json.dumps({'captureToolingQualified':True,'toolDigests':{'scripts/capture-causal-workload.py':'incorrect'}}))
   with self.assertRaises(AssertionError):m.capture(root/'prepared',root/'scenario',root/'approval',q,root/'out',root/'node')
   self.assertIn('AssertionError',(root/'out/failure.json').read_text())
 def test_full_dispatch_and_replay_with_fake_children(self):
  fixture=m.module('causal-workload-verifier.test.py','fixture')
  whole=m.module('verify-causal-workload-run.py','whole')
  for stop in (None,6,"scenario-drift","runtime-drift"):
   with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);prepared=root/'prepared';prepared.mkdir();(prepared/'tool.mjs').write_text('// synthetic')
    scenario=root/'scenario';scenario.write_text('{}');approval=root/'approval';approval.write_text('SYNTHETIC ONLY')
    node=root/'node';node.write_text('fake');q=root/'qualification'
    q.write_text(json.dumps(dict(captureToolingQualified=True,toolDigests={},preparedDigests={'tool.mjs':m.sha(prepared/'tool.mjs')},scenarioDigest=m.sha(scenario),nodeDigest=m.sha(node),explicitEnvironment={})))
    calls=[]
    def fake(argv,job,out,environment,start):
     config=json.loads((job/'config.json').read_text());i=config['id'];calls.append(i)
     outcome=dict(pid=100+i,exitCode=0,reason='injected-stop' if i==stop else None,endedElapsed=i*6+6,observations=[dict(elapsed=i*6+j/2,childElapsed=j/2,gap=.5,rssBytes=1000,directoryBytes=1000) for j in range(1,13)])
     for name,value in [('exit.json',outcome),('entry.json',dict(pid=100+i,timeOrigin=10000+i,node='v24.18.0',execArgv=m.FLAGS)),('worker.json',dict(pid=100+i,timeOrigin=10000+i)),('completion.json',dict(completed=True,samples=2400))]:m.put(job/name,value)
     samples,diag=fixture.fixture(config['condition'],config['orientation'])
     (job/'samples.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in samples));m.put(job/'diagnostic.json',diag)
     if i==0 and stop=='scenario-drift':(out/'P2-inputs.json').write_text('{"changed":true}')
     if i==0 and stop=='runtime-drift':node.write_text('changed executable')
     return outcome
    old_run=m.supervisor.supervise;old_command=m.subprocess.check_output
    m.supervisor.supervise=fake;m.subprocess.check_output=lambda *a,**k:'v24.18.0\n'
    try:r=m.capture(prepared,scenario,approval,q,root/'out',node)
    finally:m.supervisor.supervise=old_run;m.subprocess.check_output=old_command
    if stop is None:
     self.assertTrue(r['completed']);self.assertEqual(whole.verify(root/'out')['sampleCount'],57600)
     with self.assertRaises(FileExistsError):m.capture(prepared,scenario,approval,q,root/'other-out',node)
    elif stop==6:self.assertFalse(r['completed']);self.assertEqual(calls,list(range(7)));self.assertEqual(len(r['notRun']),17)
    else:self.assertFalse(r['completed']);self.assertEqual(calls,[0])
 def test_entry_has_two_distinct_modules_and_selected_driver(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)
   for condition in ('BASE','CPU','CPU_GC'):
    text=m.entry(root/'00',root/'assets',condition)
    self.assertEqual(text.count('await import('),3)
    self.assertIn('worker-copy.mjs',text);self.assertIn(condition+'.mjs',text)
    self.assertIn('await d.runRow(',text)
if __name__=='__main__':unittest.main()
