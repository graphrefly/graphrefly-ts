"""Reindexed semantic corruptions: rejection must not rely solely on old hashes."""
import hashlib, importlib.util, json, shutil, sys, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('verifier', Path(__file__).with_name('verify-causal-granularity.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
source = Path(sys.argv[1])
cases = [
 ('wrong-arm', 'job-0.json', lambda x: x['records'][0].update(arm='reference')),
 ('negative-time', 'job-0.json', lambda x: x['records'][0]['observations'][0].update(totalMs=-1)),
 ('warmup-as-measured', 'job-0.json', lambda x: x['records'][0]['observations'][0].update(phase='measured')),
 ('missing-preflight', 'job-0.json', lambda x: x.update(preflight=False)),
 ('hidden-failure', 'attempt.json', lambda x: x['records'][0].update(code=1)),
]
rejected=[]
for name, file, mutate in cases:
 with tempfile.TemporaryDirectory() as temp:
  root=Path(temp)/'run';shutil.copytree(source,root)
  path=root/file;data=json.loads(path.read_text());mutate(data);path.write_text(json.dumps(data))
  index=root/'artifact-index.json';data=json.loads(index.read_text());data['files'][file]=hashlib.sha256(path.read_bytes()).hexdigest();index.write_text(json.dumps(data))
  try: module.verify(root)
  except AssertionError: rejected.append(name)
  else: raise AssertionError(f'Accepted corruption: {name}')
print(json.dumps(dict(passed=True,rejected=rejected,reindexed=True),indent=2))
