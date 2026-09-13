"""Finite loaded collector failures; fake processes only."""
from fake_runtime import *
import os
originalKill=collect.os.killpg
for case in ['initial-probe','spawn','interrupt','rss','observation-gap','cleanup-race','cleanup-error','wake-after','asset-drift','cleanup-wake-error']:
 with tempfile.TemporaryDirectory() as temp:
  root=pathlib.Path(temp)/'run';shutil.copytree(BASE,root);freeze_fixture(root);clock=Clock();collect.time=clock;continuity.time=clock;active=[];wakes=[0]
  def wake():
   wakes[0]+=1
   if case=='cleanup-wake-error' and wakes[0]>=4:raise RuntimeError('synthetic wake failure')
   return 'different' if case=='wake-after' and wakes[0]>=4 else 'same'
  collect.wake=wake
  class Fake(Process):
   def __init__(self,*a,**k):
    if case=='spawn':raise RuntimeError('synthetic spawn')
    if case=='interrupt':raise KeyboardInterrupt()
    super().__init__(*a,**k);active.append(self)
   def poll(self):
    if case=='cleanup-race':return self.returncode
    return super().poll()
   def wait(self,**k):
    if case in ['cleanup-error','cleanup-wake-error']:raise RuntimeError('synthetic cleanup')
    return super().wait(**k)
  class Runtime(Subprocess):
   Popen=Fake
   def check_output(self,*a,**k):
    if case=='initial-probe':raise TimeoutError('synthetic metadata probe')
    clock.now+=.001
    if case=='asset-drift':(root/'B.mjs').write_bytes((root/'B.mjs').read_bytes()+b'\n')
    return metadata
   def run(self,*a,**k):
    if case=='cleanup-race':raise RuntimeError('synthetic ps')
    return types.SimpleNamespace(returncode=0,stdout='262145' if case in ['rss','cleanup-error','cleanup-wake-error'] else '1024')
  collect.subprocess=Runtime()
  if case=='observation-gap':clock.sleep=lambda n:setattr(clock,'now',clock.now+2)
  def kill(*a):
   active[0].returncode=0
   if case=='cleanup-race':raise ProcessLookupError()
  collect.os.killpg=kill
  assert collect.capture(root) is False,case
  v=inspect(root);assert v['completed']==0 and v['failure'],case
  if case=='asset-drift':assert v['assetDrift']==['B.mjs'] and not list((root/'jobs').iterdir())
  if case not in ['initial-probe','asset-drift']:
   assert len(list((root/'jobs').iterdir()))==1
   if case=='interrupt':assert 'KeyboardInterrupt' in v['failure']
   if case in ['cleanup-error','cleanup-wake-error']:assert 'cleanup unconfirmed' in v['failure']
   # Independently replay a killed, truncated write and malformed clock prefix.
   if case=='rss':
    samples=root/'jobs/00/samples.jsonl';samples.write_bytes(samples.read_bytes()[:17])
    assert inspect(root)['failedJob']['invalidSuffix'] is not None
    samples.write_text(json.dumps({'block':0,'position':0,'index':0,'slot':0 if json.loads((root/'jobs/00/entry.json').read_text())['variant']=='U' else 1,'phase':'warmup','clocks':[2,1]})+'\n')
    assert inspect(root)['failedJob']['invalidSuffix'] is not None
  print('FAILURE_QUALIFIED',case)
collect.os.killpg=originalKill
