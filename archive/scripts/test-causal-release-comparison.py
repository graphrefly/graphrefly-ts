"""Synthetic raw-evidence and loaded verifier mutants; zero real consumer execution."""
import copy,hashlib,importlib.util,json,pathlib,tempfile
P=pathlib.Path(__file__).with_name('verify-causal-release-comparison.py')
spec=importlib.util.spec_from_file_location('verifier',P);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
def write(p,x):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(x,separators=(',',':'))+'\n')
def rejection(fn):
 try:fn()
 except (ValueError,KeyError,FileNotFoundError):return
 raise AssertionError('negative accepted')
def arithmetic(subject):
 assert subject.stats(list(range(1,301)))=={'p95':285,'p50':150,'sum':45150}
 assert subject.phases([1,3,5,8,10,15,20,27],'P2-lifecycle')=={'construction':2,'initial-input':3,'duplicate-input':5,'cleanup':7,'sum':17,'wall-span':26,'residual':9}
 assert subject.ratios(4,2)==2 and subject.ratios(2,4)==.5
 assert subject.ratios(0,1) is None and subject.ratios(1,0) is None
 assert subject.label([1]*4,[.9]*8)=='observed consistent decrease'
 assert subject.label([1]*4,[1.1]*8)=='observed consistent increase'
 assert subject.label([1]*4,[.8,1.1]*4)=='mixed/inconclusive'
 assert subject.label([1,1,1,1.06],[.9]*8)=='control-unstable/inconclusive'
 assert subject.label([None]*4,[.9]*8)=='control-unstable/inconclusive'
 jobs=subject.schedule([0]*30)[:12];results={}
 for job in jobs:
  blocks={}
  for block in range(3):
   for pos in range(2):
    slot=(block+pos+(job['variant']=='V'))%2
    # Position-specific non-1 values expose ratio inversion and averaging.
    value=(10+block)*(1 if slot==0 or job['kind']=='control' else (.5 if pos==0 else 2))
    for phase in ['construction','initial-input','duplicate-input','cleanup','sum','wall-span','residual']:blocks[f'{block}/{pos}/{slot}/{phase}']={'p95':value}
  results[str(job['id'])]={'blocks':blocks}
 answer=subject.report(jobs,results)['P2-lifecycle']['cleanup']
 assert answer['mainRange']==[.5,2] and answer['label']=='mixed/inconclusive'
 assert [p['median'] for p in answer['pairs'][1]['positions']]==[.5,2]
arithmetic(v)
for clocks in [[1,float('nan')],[2,1],[1,float('inf')]]:rejection(lambda:v.phases(clocks,'inactive-1'))
for bits in [[0]*29,[2]*30]:rejection(lambda:v.schedule(bits))
loaded=0
for a,b in [('ordered[284]','ordered[285]'),('a/b if a>0 and b>0 else None','b/a if a>0 and b>0 else None'),("median([x['ratio'] for x in values])","1"),("clocks[7]-clocks[0]","clocks[7]-clocks[1]")]:
 source=P.read_text();assert source.count(a)==1
 ns={'__name__':'mutated'};exec(compile(source.replace(a,b),str(P),'exec'),ns)
 module=type('Subject',(),ns)
 try:arithmetic(module)
 except AssertionError:loaded+=1
 else:raise AssertionError('loaded numeric mutant survived')
with tempfile.TemporaryDirectory(prefix='release-comparison-synthetic-') as directory:
 root=pathlib.Path(directory);job=v.schedule([0]*30)[0];folder=root/'jobs/00'
 for name in ['B.mjs','C.mjs','B-copy.mjs']:(root/name).write_text('fake-'+name)
 runtime={'node':'fake','v8':'fake','platform':'fake','arch':'fake','execPath':'/fake/node'}
 reservation={'runtime':runtime,'originalRoot':str(root),'environment':{},'wake':'fake'}
 modules=['B.mjs','B-copy.mjs'];entry={**job,'modules':modules,'inputDigest':v.INPUT,'moduleDigests':{n:v.sha((root/n).read_bytes()) for n in modules}}
 write(folder/'entry.json',entry)
 argv=['/fake/node',str(root/'tools/causal-release-comparison-child.mjs'),str(folder/'entry.json')]
 identity={**runtime,'pid':1,'env':{},'argv':argv,'entryDigest':v.sha((folder/'entry.json').read_bytes())};write(folder/'identity.json',identity)
 exit_={'argv':argv,'pid':1,'code':0,'failure':None,'elapsed':1,'maxRSS':1000,'wakeBefore':'fake','wakeAfter':'fake','startMono':0,'endMono':1,'rssObservations':[[.5,1000]]};write(folder/'exit.json',exit_)
 write(folder/'completion.json',{'completed':True,'samples':2400,'pid':1})
 expected={'effects':[],'evidence':[],'obligations':[],'view':{}}
 precheck={'passed':True,'assessments':1,'topology':{'candidate':[{}]*60,'reference':[{}]*60},'beforeOccurrences':1,'afterOccurrences':1,'preWaveNew':0}
 pre={'instances':14,'checks':[{'cold':precheck,'steady':precheck}]*2,'expected':[expected]*2,'expectedJSON':[json.dumps(expected,separators=(',',':'))]*2};write(folder/'preflight.json',pre)
 records=[]
 for n in range(2400):
  block=n//800;pos=n%800//400;index=n%400
  records.append({'block':block,'position':pos,'slot':(block+pos)%2,'index':index,'phase':'warmup' if index<100 else 'measured','clocks':[n*30+x for x in [1,3,5,8,10,15,20,27]],'outcome':'released','releaseCompleted':True,'before':1,'after':1,'snapshotDigest':v.sha(pre['expectedJSON'][0].encode())})
 def raw(items):(folder/'samples.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in items))
 raw(records);checked=v.child(root,job,reservation,{})
 assert checked['samples']==2400 and checked['clockReads']==19200
 for name,mutate in [
  ('coordinate replay',lambda a:a.__setitem__(1,copy.deepcopy(a[0]))),
  ('missing last block',lambda a:a.__delitem__(slice(1600,None))),
  ('slot swap',lambda a:a[0].__setitem__('slot',1)),
  ('wrong snapshot',lambda a:a[0].__setitem__('snapshotDigest','bad')),
  ('wrong lifecycle',lambda a:a[0].__setitem__('after',2)),
  ('swallowed release',lambda a:a[0].__setitem__('releaseCompleted',False)),
 ]:
  values=copy.deepcopy(records);mutate(values);raw(values);rejection(lambda:v.child(root,job,reservation,{}))
 raw(records)
 for key,value in [('modules',['B-copy.mjs','B.mjs']),('inputDigest','wrong'),('row','inactive-60')]:
  changed={**entry,key:value};write(folder/'entry.json',changed);write(folder/'identity.json',{**identity,'entryDigest':v.sha((folder/'entry.json').read_bytes())});rejection(lambda:v.child(root,job,reservation,{}))
 write(folder/'entry.json',entry);write(folder/'identity.json',identity)
 for key,value in [('pid',2),('node','changed')]:
  write(folder/'identity.json',{**identity,key:value});rejection(lambda:v.child(root,job,reservation,{}))
 # Exercise cumulative PID reuse and terminal failed-child retention through the real verifier.
 write(folder/'identity.json',identity)
 reservation.update({'startMono':0,'schedule':v.schedule([0]*30)})
 write(root/'reservation.json',reservation)
 original_admission=v.admission
 v.admission=lambda _: (reservation,{})
 assert v.verify(root,1)['children']==1
 import shutil
 nextfolder=root/'jobs/01';shutil.copytree(folder,nextfolder)
 nextjob=reservation['schedule'][1]
 nextentry={**entry,**nextjob};write(nextfolder/'entry.json',nextentry)
 nextargv=['/fake/node',str(root/'tools/causal-release-comparison-child.mjs'),str(nextfolder/'entry.json')]
 nextidentity={**identity,'pid':2,'argv':nextargv,'entryDigest':v.sha((nextfolder/'entry.json').read_bytes())}
 write(nextfolder/'identity.json',nextidentity)
 write(nextfolder/'completion.json',{'completed':True,'samples':2400,'pid':2})
 nextexit={**exit_,'pid':2,'argv':nextargv,'startMono':1,'endMono':2,'rssObservations':[[1.5,1000]]};write(nextfolder/'exit.json',nextexit)
 other=copy.deepcopy(records)
 for r in other:r['slot']=1-r['slot']
 (nextfolder/'samples.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in other))
 assert v.verify(root,2)['children']==2
 write(nextfolder/'identity.json',{**nextidentity,'pid':1});write(nextfolder/'completion.json',{'completed':True,'samples':2400,'pid':1});write(nextfolder/'exit.json',{**nextexit,'pid':1})
 rejection(lambda:v.verify(root,2))
 write(nextfolder/'identity.json',nextidentity);write(nextfolder/'exit.json',{**nextexit,'code':1,'failure':'synthetic'})
 (nextfolder/'completion.json').unlink();write(nextfolder/'failure.json',{'error':'synthetic','samples':3})
 (nextfolder/'samples.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in other[:3]))
 write(root/'result.json',{'completed':1,'dispatched':2,'retries':0,'notRun':list(range(2,60)),'failure':{'error':'synthetic'},'elapsed':2})
 terminal=v.verify(root,-1);assert terminal['captureStatus']=='failed' and terminal['failedChild']['identity']['pid']==2 and terminal['failedChild']['rawLines']==3
 v.admission=original_admission
print(json.dumps({'passed':True,'newPerformanceSamples':0,'loadedNumericMutants':loaded,'syntheticSamples':2400,'rawNegatives':12,'failedTerminalVerified':True,'positionMedians':[.5,2]}))

# Loaded collector process-group and RSS-monitor failure paths, no OS child launched.
cp=pathlib.Path(__file__).with_name('collect-causal-release-comparison.py')
cs=importlib.util.spec_from_file_location('collector',cp);c=importlib.util.module_from_spec(cs);cs.loader.exec_module(c)
from unittest.mock import patch
import subprocess
killed=[]
class TimedOut:
 pid=12345
 def communicate(self,timeout):raise subprocess.TimeoutExpired('fake',timeout)
 def wait(self,timeout):return 0
with patch.object(c,'remaining',lambda:1),patch.object(c.subprocess,'Popen',lambda *a,**k:TimedOut()),patch.object(c.os,'killpg',lambda pid,sig:killed.append(pid)):
 try:c.command(['fake'])
 except subprocess.TimeoutExpired:pass
 else:raise AssertionError('timeout swallowed')
assert killed==[12345]
class Alive:
 pid=12345
 returncode=None
 def poll(self):return self.returncode
 def wait(self,timeout):self.returncode=-9;return -9
with tempfile.TemporaryDirectory(prefix='release-comparison-monitor-') as directory:
 c.OUT=pathlib.Path(directory);(c.OUT/'jobs').mkdir();child=Alive();killed=[]
 def kill(pid,sig):killed.append(pid);child.returncode=-9
 failedps=type('PS',(),{'returncode':1,'stdout':''})()
 with patch.object(c,'wake',lambda:'fake'),patch.object(c,'remaining',lambda:1),patch.object(c.subprocess,'Popen',lambda *a,**k:child),patch.object(c.subprocess,'run',lambda *a,**k:failedps),patch.object(c.os,'killpg',kill):
  try:c.execute({'id':0},{'execPath':'fake'}, {},'fake')
  except RuntimeError as e:assert 'RSS monitoring failed' in str(e)
  else:raise AssertionError('monitor failure swallowed')
 assert killed==[12345]
print(json.dumps({'passed':True,'collectorFakeProcessGroupTimeout':True,'collectorLiveRSSFailureStops':True,'newProcesses':0}))
