"""Pre-spawn wake failure must still produce a replayable failed-job receipt."""
import pathlib,shutil,tempfile
import collect
from verify import inspect
HERE=pathlib.Path(__file__).resolve().parent
BASE=HERE.parents[3]/'archive/evals/causal-currentness-comparison-v1/run'
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp)/'run';shutil.copytree(BASE,root)
 count=0
 def wake():
  global count
  count+=1
  if count==3:raise TimeoutError('synthetic pre-spawn wake timeout')
  return 'synthetic wake'
 collect.wake=wake
 assert collect.capture(root) is False
 v=inspect(root)
 assert v['completed']==0 and v['failedJob']['samples']==0 and v['failedJob']['exit']['pid'] is None
 assert v['failure']=='synthetic pre-spawn wake timeout'
print('COLLECTOR_QUALIFIED pre-spawn failure replay passed; consumer executions=0')
