"""Synthetic arithmetic/whole-run/stop qualification. Never imports or runs consumers."""
import copy,hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent

def load(name):
 s=importlib.util.spec_from_file_location(name,HERE/name);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
v=load('verify-causal-aligned-child.py');whole=load('verify-causal-aligned-run.py');sup=load('causal-aligned-supervisor.py');old=load('causal-workload-verifier.test.py')

def fixture(c='GC_CPU',orientation='U',pid=12):
 samples,diag=old.fixture('CPU' if c=='CONTROL' else 'CPU_GC',orientation)
 for s in samples:
  for k in ('start','end','ms'):s[k]*=.1
 for cp in diag['checkpoints']:
  cp['wallBefore']*=.1;cp['wallAfter']*=.1
 if c!='CONTROL':
  diag['disconnectAt']=5500
  diag['gc']=[dict(startTime=100.9,duration=.5,receivedAt=5500,kind=1,flags=0),dict(startTime=101,duration=.3,receivedAt=5500,kind=1,flags=0)]
 alignment=dict(condition=c,pid=pid,anchors=[dict(before=.001,after=.002,h='1000000001500',pid=pid),dict(before=5401.001,after=5401.002,h='1005401001500',pid=pid)],bounds={})
 if c=='GC_CPU':alignment['bounds']=dict(startBefore=0,startAfter=.0005,stopBefore=5401.1,stopAfter=5401.2)
 native=dict(before=dict(absoluteBefore=23999976000,absoluteAfter=23999976002,continuous=23999976001),after=dict(absoluteBefore=24132000000,absoluteAfter=24132000002,continuous=24132000001))
 platform=dict(timebase=dict(numer=125,denom=3))
 profile=None
 if c=='GC_CPU':
  frame=lambda name,url:dict(functionName=name,url=url,scriptId='1',lineNumber=0,columnNumber=0)
  nodes=[dict(id=1,callFrame=frame('(root)',''),children=[2]),dict(id=2,callFrame=frame('consumer','worker.mjs'))]
  times=[1000000000+round((s['start']+.1)*1000) for s in samples]
  profile=dict(startTime=1000000000,endTime=1005401150,nodes=nodes,samples=[2]*2400,timeDeltas=[times[0]-1000000000]+[b-a for a,b in zip(times,times[1:])])
 return samples,diag,alignment,profile,native,platform,dict(pid=pid)

class ToolsTests(unittest.TestCase):
 def test_arithmetic(self):
  for c in ['CONTROL','GC','GC_CPU']:
   for o in ['U','V']:
    report=v.verify(*fixture(c,o));self.assertEqual(len(report['groups']),12)
    self.assertEqual([g['count']for g in report['groups']],[15,285]*6)
    if c=='GC_CPU':
     self.assertEqual(report['cpu']['assignment'],dict(certain=2400,ambiguous=0,outside=0))
     self.assertEqual(sum(sum(g['self'].values())for g in report['groups']),1800)
     self.assertAlmostEqual(report['windows'][100]['gcOverlapMs'],.2)
 def test_corruptions(self):
  changes=[lambda a:a[2].update(pid=13),lambda a:a[2]['anchors'][1].update(before=1),lambda a:a[3].update(samples=[2]),lambda a:a[3].update(timeDeltas=[-1]*2400),lambda a:a[3]['nodes'][1].update(children=[1]),lambda a:a[3]['nodes'][0].update(children=[2,2]),lambda a:a[4]['after'].update(continuous=24132024001),lambda a:a[2]['anchors'][0].update(h='1'),lambda a:a[1].update(orientation='V'),lambda a:a[0].pop()]
  for change in changes:
   args=fixture();change(args)
   with self.assertRaises((ValueError,AssertionError)):v.verify(*args)
 def test_ambiguous_outside_and_deep_tree(self):
  args=fixture();p=args[3];p['samples']=[2,2];p['timeDeltas']=[1000,500000]
  r=v.verify(*args);self.assertEqual(r['cpu']['assignment']['ambiguous'],1);self.assertEqual(r['cpu']['assignment']['outside'],1)
  args=fixture();p=args[3];frame=p['nodes'][1]['callFrame'];p['nodes']=[dict(id=i,callFrame=frame,children=[i+1]if i<2000 else [])for i in range(1,2001)];p['samples']=[2000]*2400
  self.assertEqual(v.verify(*args)['cpu']['assignment']['certain'],2400)
 def test_schedule_stops(self):
  import random
  jobs=sup.schedule(random.Random(1));self.assertEqual(len(jobs),12)
  for stop in range(12):
   calls=[]
   def run(j):calls.append(j);return dict(reason='fault'if j['id']==stop else None)
   result=sup.dispatch(jobs,run);self.assertEqual(len(calls),stop+1);self.assertEqual(len(result['notRun']),11-stop)

class CaptureTests(unittest.TestCase):
 def test_complete_fake_capture_replay_and_corruptions(self):
  from unittest.mock import patch
  capture=load('capture-causal-aligned.py')
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);prepared=root/'prepared';prepared.mkdir()
   for name in ['CONTROL.mjs','GC.mjs','GC_CPU.mjs','worker.mjs','worker-copy.mjs','causal-aligned-observation.mjs']:(prepared/name).write_text('// fake asset')
   scenario=root/'scenario.json';scenario.write_text('{}');approval=root/'approval.txt';approval.write_text('SYNTHETIC ONLY')
   node=root/'node';node.write_text('fake node');qualification=root/'qualification.json'
   q=dict(captureToolingQualified=True,preparedDigests={p.name:capture.sha(p)for p in prepared.iterdir()},toolDigests={},scenarioDigest=capture.sha(scenario),nodeDigest=capture.sha(node),pythonDigest=capture.sha(__import__('sys').executable),platform=dict(timebase=dict(numer=125,denom=3)),explicitEnvironment={})
   capture.put(qualification,q);output=root/'output';clock=[0.0];reads=[0];calls=[]
   native=fixture()[4]
   def native_read():
    side='before'if reads[0]%2==0 else 'after';reads[0]+=1;return native[side]
   def supervise(argv,folder,*unused):
    calls.append(argv);verifying=folder.name=='verification';job=folder.parent if verifying else folder
    config=json.loads((job/'config.json').read_text());pid=100+config['id']+(100 if verifying else 0)
    if not verifying:
     samples,diag,alignment,profile,n,platform,meta=fixture(config['condition'],config['orientation'],pid)
     for name,value in [('entry.json',dict(**meta,timeOrigin=pid,node='v24.18.0',execArgv=capture.FLAGS,platform='darwin',arch='arm64')),('worker.json',dict(pid=pid,timeOrigin=pid)),('completion.json',dict(completed=True,samples=2400)),('diagnostic.json',diag),('alignment.json',alignment),('preflight-first.json',dict(module=0,pid=pid)),('preflight-order.json',dict(modules=[0,1],pid=pid))]:capture.put(job/name,value)
     if profile:capture.put(job/'profile.json',profile)
     (job/'samples.jsonl').write_text(''.join(json.dumps(s)+'\n'for s in samples));text=''
    else:
     args=fixture(config['condition'],config['orientation'],100+config['id']);text=json.dumps(v.verify(*args))
    (folder/'stdout.log').write_text(text);(folder/'stderr.log').write_text('')
    clock[0]+=.1;obs=dict(elapsed=clock[0],childElapsed=.1,gap=.1,rssBytes=1000,directoryBytes=1000);clock[0]+=.1
    result=dict(pid=pid,exitCode=0,reason=None,observations=[obs],endedElapsed=clock[0]);capture.put(folder/'exit.json',result);return result
   with patch.object(capture,'mach_setup',return_value=native_read),patch.object(capture.supervisor,'supervise',supervise),patch.object(capture.subprocess,'check_output',return_value='v24.18.0'),patch.object(capture.time,'monotonic',side_effect=lambda:clock[0]),patch.object(capture.time,'time',side_effect=lambda:clock[0]):
    result=capture.capture(prepared,scenario,approval,qualification,output,node)
    self.assertTrue(result['completed'],result);self.assertEqual(len(calls),24)
    with self.assertRaises(FileExistsError):capture.capture(prepared,scenario,approval,qualification,root/'retry',node)
   report=whole.verify(output);self.assertEqual(report['sampleCount'],28800);self.assertEqual(len(report['ratios']),72)
   for name in ['00/dispatch.json','00/verification/dispatch.json','approval-claim.json','00/analysis.json','final-boundary.json']:
    path=output/name;data=path.read_bytes();path.unlink()
    with self.assertRaises((FileNotFoundError,ValueError)):whole.verify(output)
    path.write_bytes(data)
   self.assertEqual(whole.verify(output)['sampleCount'],28800)

if __name__=='__main__':unittest.main()
