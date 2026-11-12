"""Synthetic arithmetic/provenance tests. No inspector or consumer executions."""
import copy,importlib.util,unittest
from fractions import Fraction
from pathlib import Path
spec=importlib.util.spec_from_file_location('verifier',Path(__file__).with_name('verify-causal-aligned-clock.py'))
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
def fixture():
 p=dict(startTime=1000000,endTime=1000200,nodes=[dict(id=1,callFrame=dict(functionName='knownArithmeticPhase')),dict(id=2,callFrame=dict(functionName='knownStringPhase'))],samples=[1,2],timeDeltas=[50,100])
 b=dict(kind='CPU',bounds=dict(startBefore=10,startAfter=10.001,stopBefore=10.2,stopAfter=10.201),windows=[dict(start=10.02,end=10.06),dict(start=10.1,end=10.17)])
 platform=dict(timebase=dict(numer=125,denom=3))
 native=dict(before=dict(absoluteBefore=100000,absoluteAfter=100002,continuous=200001),after=dict(absoluteBefore=200000,absoluteAfter=200002,continuous=300001))
 return p,b,platform,native
class ClockTests(unittest.TestCase):
 def test_pass_and_wide(self):
  args=fixture();r=v.verify(*args);self.assertTrue(r['alignmentQualified']);self.assertGreater(r['widthMs'],.085)
  args[1]['bounds'].update(startAfter=10.02,stopBefore=10.18,stopAfter=10.22)
  self.assertFalse(v.verify(*args)['alignmentQualified'])
 def test_sleep_expands_not_fits(self):
  args=fixture();args[3]['after']['continuous']+=2400 # 0.1ms accumulated sleep
  r=v.verify(*args);self.assertFalse(r['alignmentQualified']);self.assertGreater(r['sleepVariationUpperMs'],.1)
 def test_rejections(self):
  mutations=[lambda a:a[0].update(endTime=999999),lambda a:a[0].update(endTime=2000001),lambda a:a[0].update(timeDeltas=[50]),lambda a:a[0].update(samples=[1,3]),lambda a:a[0].update(timeDeltas=[-1,100]),lambda a:a[0].update(timeDeltas=[50,200]),lambda a:a[0]['nodes'].append(a[0]['nodes'][0]),lambda a:a[1]['bounds'].update(startAfter=11),lambda a:a[1].update(failure=dict(message='fault')),lambda a:a[2]['timebase'].update(denom=0),lambda a:a[3]['after'].update(continuous=100000),lambda a:a[0].update(samples=[1,1])]
  for change in mutations:
   args=fixture();change(args)
   with self.assertRaises(ValueError):v.verify(*args)
 def test_full_integer_rounding_period(self):
  # Exact arithmetic over every residue in the fixed 125/3 Darwin conversion.
  errors=[]
  for tick in range(3000):
   q=(tick//1000*125)//3+1
   errors.append(Fraction(q)-Fraction(tick*125,3000))
  spread=max(errors)-min(errors);bound=Fraction(999*125,3000)+1
  self.assertLess(spread,bound)
  # Any observed endpoint offsets padded by full error variation contain every internal offset.
  for anchor in [min(errors),max(errors)]:
   for interior in errors:self.assertTrue(-anchor-bound<=-interior<=-anchor+bound)
class LauncherTests(unittest.TestCase):
 def test_stop_and_single_use_without_process(self):
  import json,tempfile
  from unittest.mock import patch
  spec=importlib.util.spec_from_file_location('launcher',Path(__file__).with_name('run-causal-clock-probes.py'))
  launcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(launcher)
  calls=[]
  def fake(argv,folder,*unused):
   calls.append(argv)
   for name,value in [('probe.json',{}),('profile.json',{}),('process.json',dict(pid=12,node='v24.18.0'))]:launcher.put(folder/name,value)
   return dict(reason=None,pid=12)
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);plan=root/'plan.json';output=root/'output'
   launcher.put(plan,dict(files={},node=__file__,nodeSha256=launcher.sha(Path(__file__)),jobs=['CPU','CPU','CPU','GC'],consumerExecutions=0,explicitEnvironment={},platform={}))
   with patch.object(launcher.supervisor,'supervise',fake),patch.object(launcher.verifier,'verify',return_value=dict(alignmentQualified=False)):
    launcher.run(plan,output)
    with self.assertRaises(FileExistsError):launcher.run(plan,root/'retry')
   result=json.loads((output/'result.json').read_text())
   self.assertEqual(len(calls),1);self.assertEqual(len(result['notRun']),3)
   self.assertFalse(result['probesQualified']);self.assertEqual(result['consumerExecutions'],0)
  self.assertEqual(launcher.violation(41,0,0,0,0),'preparation-deadline')
  self.assertEqual(launcher.violation(0,11,0,0,0),'probe-deadline')
  self.assertEqual(launcher.violation(0,0,0,257*1024**2,0),'observed-rss')
if __name__=='__main__':unittest.main()

