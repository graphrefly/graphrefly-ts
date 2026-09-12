"""Offline replay: validates frozen bytes and recorded arithmetic; never launches a process."""
import hashlib,importlib.util,json,tarfile
from pathlib import Path
D=Path(__file__).resolve().parent
ROOT=D.parents[3]
def sha(data):return hashlib.sha256(data).hexdigest()
def read(p):return json.loads(p.read_text())
plan=read(D/'plan.json')
with tarfile.open(D/'source.tar.gz') as archive:
 members={m.name:m for m in archive.getmembers() if m.isfile()}
 for file,digest in plan['files'].items():
  p=ROOT/file
  if p.is_file():data=p.read_bytes()
  else:
   member=str(p.relative_to(D));assert member in members
   data=archive.extractfile(members[member]).read()
  assert sha(data)==digest,file
assert read(D/'plan.json.claim.json')['planSha256']==sha((D/'plan.json').read_bytes())
spec=importlib.util.spec_from_file_location('clock',ROOT/'scripts/verify-causal-aligned-clock.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
probe=D/'probes/00'
analysis=v.verify(read(probe/'profile.json'),read(probe/'probe.json'),plan['platform'],read(probe/'native-clock.json'))
assert analysis==read(probe/'analysis.json') and not analysis['alignmentQualified']
result=read(D/'probes/result.json');assert len(result['children'])==1 and len(result['notRun'])==3
child=result['children'][0];outcome=read(probe/'exit.json');assert child['outcome']==outcome
assert child['qualificationFailure']=='clock-interval-width' and outcome['reason'] is None and outcome['exitCode']==0
assert read(probe/'process.json')['pid']==outcome['pid']
assert outcome['endedElapsed']<=40
for obs in outcome['observations']:
 assert obs['elapsed']<=40 and obs['childElapsed']<=10 and obs['gap']<=1
 assert obs['rssBytes']<=256*1024**2 and obs['directoryBytes']<=256*1024**2
assert not result['probesQualified'] and not result['captureToolingQualified'] and result['consumerExecutions']==0
assert sorted(p.name for p in (D/'probes').iterdir() if p.is_dir())==['00']
for path,digest in read(D/'evidence-index.json').items():assert sha((D/path).read_bytes())==digest,path
print(json.dumps(dict(replay=True,frozenFiles=len(plan['files']),consumerExecutions=0,cpuProbes=1,gcProbes=0,notRun=3,widthMs=analysis['widthMs'],thresholdMs=.1),indent=2))
