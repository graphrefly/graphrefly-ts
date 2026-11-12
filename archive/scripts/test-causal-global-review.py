"""Reindexed corruptions must fail independent replay; no measurements."""
import hashlib,importlib.util,json,shutil,sys,tempfile
from pathlib import Path
def load(name):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
cold=load('verify-causal-global-cold');coverage=load('audit-causal-global-review');root=Path(sys.argv[1]);out=[]
cases=[('missing-arm','cold-v2','job-0.json',lambda x:x['records'].pop()),('negative-time','cold-v2','job-0.json',lambda x:x['records'][0]['samples'].__setitem__(0,-1)),('hidden-failure','cold-v2','attempt.json',lambda x:x.update(error='failed')),('different-node','after','dispatch.json',lambda x:x.update(nodeDigest='wrong'))]
for name,arm,file,mutate in cases:
 with tempfile.TemporaryDirectory() as temp:
  r=Path(temp)/arm;shutil.copytree(root/arm,r);p=r/file;x=json.loads(p.read_text());mutate(x);p.write_text(json.dumps(x));idx=json.loads((r/'artifact-index.json').read_text());idx['files'][file]=hashlib.sha256(p.read_bytes()).hexdigest();(r/'artifact-index.json').write_text(json.dumps(idx))
  try:
   if arm=='cold-v2':cold.verify(r)
   else:coverage.audit(root/'before',r)
  except AssertionError:out.append(name)
  else:raise AssertionError(name)
print(json.dumps(dict(passed=True,reindexedCorruptionsRejected=out),indent=2))
