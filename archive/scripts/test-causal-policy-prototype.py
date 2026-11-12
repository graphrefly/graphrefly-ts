"""Reindexed corruptions must fail prototype evidence verification."""
import hashlib,importlib.util,json,shutil,sys,tempfile
from pathlib import Path
s=importlib.util.spec_from_file_location('v',Path(__file__).with_name('verify-causal-policy-prototype.py'));v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
out=[]
for name,file,mutate in [('extra-arm','job-0.json',lambda x:x['records'].append(x['records'][0])),('hidden-failure','attempt.json',lambda x:x.update(error='failed')),('negative-sample','job-0.json',lambda x:x['records'][0]['samples'].__setitem__(0,-1)),('false-state-check','job-0.json',lambda x:x.update(stateChecks=False))]:
 with tempfile.TemporaryDirectory() as d:
  r=Path(d)/'run';shutil.copytree(sys.argv[1],r);p=r/file;x=json.loads(p.read_text());mutate(x);p.write_text(json.dumps(x));idx=json.loads((r/'artifact-index.json').read_text());idx['files'][file]=hashlib.sha256(p.read_bytes()).hexdigest();(r/'artifact-index.json').write_text(json.dumps(idx))
  try:v.verify(r)
  except AssertionError:out.append(name)
  else:raise AssertionError(name)
print(json.dumps(dict(passed=True,reindexedCorruptionsRejected=out),indent=2))
