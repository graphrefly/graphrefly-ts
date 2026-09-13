"""Real collector, fake ps/processes; explicit terminal RSS evidence cases."""
from fake_runtime import *
originalKill=collect.os.killpg
for case in ['positive','terminal-zero','terminal-empty','live-zero','zero-with-running-state','zombie-unreaped','wrong-pid','negative','malformed','ps-failure','over-limit']:
 with tempfile.TemporaryDirectory() as tmp:
  root=pathlib.Path(tmp)/'run';shutil.copytree(BASE,root);freeze_fixture(root);clock=Clock();collect.time=clock;continuity.time=clock;collect.wake=lambda:'same';active=[];observed={}
  class Fake(Process):
   def __init__(self,*a,**k):super().__init__(*a,**k);active.append(self)
   def poll(self):return self.returncode
  class Runtime(Subprocess):
   Popen=Fake
   def check_output(self,*a,**k):clock.now+=.001;return metadata
   def run(self,*a,**k):
    proc=active[-1];n=observed.get(proc.pid,0)+1;observed[proc.pid]=n
    code=0;out=str(proc.pid)+' R 1024'
    if n==2:
     if case in ['positive','terminal-zero','terminal-empty','zero-with-running-state']:proc.returncode=0
     if case=='terminal-zero':out=str(proc.pid)+' Z 0'
     elif case=='terminal-empty':code=1;out=''
     elif case in ['live-zero','zero-with-running-state']:out=str(proc.pid)+' R 0'
     elif case=='zombie-unreaped':out=str(proc.pid)+' Z 0'
     elif case=='wrong-pid':out='999999 Z 0';proc.returncode=0
     elif case=='negative':out=str(proc.pid)+' R -1'
     elif case=='malformed':out='not a valid observation'
     elif case=='ps-failure':code=1;out=''
     elif case=='over-limit':out=str(proc.pid)+' R 262145'
    return types.SimpleNamespace(returncode=code,stdout=out,stderr='')
  collect.subprocess=Runtime();collect.os.killpg=lambda *_:setattr(active[-1],'returncode',-9)
  ok=collect.capture(root);assert ok==(case in ['positive','terminal-zero','terminal-empty']),case
  v=inspect(root)
  if ok:
   assert v['completed']==32 and v['samples']==3840
   assert v['maxRssBytes']==1048576 and v['maxObservedRssGapSeconds']>0
   if case=='positive':
    p=root/'jobs/00/exit.json';raw=p.read_bytes();z=json.loads(raw);z['rssObservations'][-1]['pollAfter']=1;put(p,z)
    try:inspect(root);raise AssertionError('exit-code mismatch accepted')
    except ValueError:pass
    p.write_bytes(raw);z=json.loads(raw);z['rssObservations'][0]['pollAfter']=0;put(p,z)
    try:inspect(root);raise AssertionError('post-exit observation accepted')
    except ValueError:pass
    p.write_bytes(raw)
   if case.startswith('terminal'):
    p=root/'jobs/00/exit.json';original=p.read_bytes();z=json.loads(original);z['rssObservations'][-1]['pollAfter']=None;put(p,z)
    try:inspect(root);raise AssertionError('unproven terminal accepted')
    except ValueError:pass
    p.write_bytes(original)
  else:assert v['completed']==0 and v['failure'] and len(active)==1
  print('RSS_QUALIFIED',case)
collect.os.killpg=originalKill
