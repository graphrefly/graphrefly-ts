import importlib.util
from pathlib import Path
import random
import tempfile
import unittest
s=importlib.util.spec_from_file_location('supervisor',Path(__file__).with_name('causal-workload-supervisor.py'))
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Qualification(unittest.TestCase):
 def test_schedule(self):
  for seed in range(16):
   jobs=m.schedule(random.Random(seed));self.assertEqual([x['id'] for x in jobs],list(range(24)))
   seen=[];r=m.dispatch(jobs,lambda j:(seen.append(j) or {'reason':None}))
   self.assertTrue(r['completed']);self.assertEqual(len(seen),24)
 def test_stop_every_coordinate(self):
  for stop in range(24):
   seen=[]
   def run(j):
    seen.append(j['id']);return {'reason':'failed' if j['id']==stop else None}
   r=m.dispatch(m.schedule(random.Random(0)),run)
   self.assertFalse(r['completed']);self.assertEqual(seen,list(range(stop+1)))
   self.assertEqual([j['id'] for j in r['notRun']],list(range(stop+1,24)))
 def test_thresholds(self):
  self.assertIsNone(m.violation(900,30,1,256*1024*1024,256*1024*1024))
  cases=[(901,0,0,0,0),(0,31,0,0,0),(0,0,1.01,0,0),(0,0,0,256*1024*1024+1,0),(0,0,0,0,256*1024*1024+1)]
  for x in cases:self.assertIsNotNone(m.violation(*x))
 def test_duplicate(self):
  jobs=m.schedule(random.Random(0));jobs[1]=jobs[0]
  with self.assertRaises(ValueError):m.dispatch(jobs,lambda _:None)
 def test_observer_kills(self):
  for mode in ['rss','gap','error','normal']:
   with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);killed=[];ticks=iter([0,.2,2] if mode=='gap' else [0,.2,.3]);polls=0
    class Child:
     pid=123;returncode=None
     def poll(self):
      nonlocal polls
      polls+=1
      if mode=='normal' and polls>=2:self.returncode=0
      return self.returncode
     def wait(self,timeout):self.returncode=-15;return -15
    child=Child()
    def memory(_):
     if mode=='error':raise RuntimeError('monitor failed')
     return 256*1024*1024+1 if mode=='rss' else 10
    # gap triggers at first observation; normal terminates after first.
    times=iter([0,2,2.1] if mode=='gap' else [0,.2,.3])
    r=m.supervise(['stub'],root,root,{},0,popen=lambda *a,**k:child,clock=lambda:next(times),sleep=lambda _:None,memory=memory,size=lambda _:0,kill_group=lambda *x:killed.append(x))
    self.assertEqual(bool(killed),mode!='normal')
    self.assertEqual(r['reason'] is None,mode=='normal')
    self.assertTrue((root/'exit.json').exists())
if __name__=='__main__':unittest.main()
