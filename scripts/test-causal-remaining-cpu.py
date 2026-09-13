"""Reindexed malformed profile/attempt rejection, no additional sampling."""
import hashlib,importlib.util,json,shutil,sys,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('verify-causal-remaining-cpu.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
cases=[('unknown-sample','job-0.json',lambda x:x['profiles'][0]['profile']['samples'].__setitem__(0,-999)),('missing-profile','job-0.json',lambda x:x['profiles'].pop()),('negative-delta','job-0.json',lambda x:x['profiles'][0]['profile']['timeDeltas'].__setitem__(0,-1)),('hidden-failure','attempt.json',lambda x:x.update(error='failed'))];out=[]
for name,file,mutate in cases:
 with tempfile.TemporaryDirectory() as temp:
  root=Path(temp)/'run';shutil.copytree(sys.argv[1],root);p=root/file;x=json.loads(p.read_text());mutate(x);p.write_text(json.dumps(x));p=root/'artifact-index.json';idx=json.loads(p.read_text());idx['files'][file]=hashlib.sha256((root/file).read_bytes()).hexdigest();p.write_text(json.dumps(idx))
  try:m.verify(root)
  except AssertionError:out.append(name)
  else:raise AssertionError(name)
print(json.dumps({'passed':True,'reindexedCorruptionsRejected':out},indent=2))
