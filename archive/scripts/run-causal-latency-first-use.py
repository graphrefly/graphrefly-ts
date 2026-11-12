"""Serial first-use sampling; execute only after the latency matrix ends."""
import hashlib,json,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]).resolve();sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();f=json.loads((root/'first-freeze.json').read_text());assert not (root/'attempt.json').exists()
assert sha(root/'first.mjs')==f['bundle']
for p,h in f['sources'].items():assert sha(Path(p))==h
(root/'runner.py').write_bytes(Path(__file__).read_bytes());start=time.monotonic();records=[];error=None
try:
 for j in f['jobs']:
  left=300-(time.monotonic()-start);assert left>0
  begin=time.monotonic()
  with (root/f"first-{j['id']}.log").open('x') as log:
   p=subprocess.run(['node',str(root/'first.mjs'),str(j['id'])],stdout=log,stderr=subprocess.STDOUT,timeout=min(60,left))
  records.append({'id':j['id'],'code':p.returncode,'elapsed':time.monotonic()-begin});assert p.returncode==0,j
  print('first-use completed',j['id'],flush=True)
except BaseException as e:error=repr(e)
finally:
 (root/'attempt.json').write_text(json.dumps({'records':records,'error':error,'elapsed':time.monotonic()-start,'runner':sha(root/'runner.py'),'notRun':[j['id'] for j in f['jobs'][len(records):]]},indent=2)+'\n')
 (root/'artifact-index.json').write_text(json.dumps({'files':{str(p.relative_to(root)):sha(p) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}},indent=2)+'\n')
if error:raise RuntimeError(error)
