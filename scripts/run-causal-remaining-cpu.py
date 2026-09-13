"""Bounded serial action sampling; no retries."""
import hashlib,json,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]).resolve();f=json.loads((root/'freeze.json').read_text());assert not (root/'attempt.json').exists();records=[];start=time.monotonic();error=None
(root/'runner.py').write_bytes(Path(__file__).read_bytes())
try:
 for j in f['jobs']:
  begin=time.monotonic();assert begin-start<f['totalSeconds']
  with (root/f"job-{j['id']}.log").open('x') as log:
   try:
    p=subprocess.run(['node',str(root/'tool.mjs'),str(root),str(j['id'])],stdout=log,stderr=subprocess.STDOUT,timeout=min(f['childSeconds'],f['totalSeconds']-(begin-start)))
    records.append({'job':j,'exitCode':p.returncode,'elapsed':time.monotonic()-begin});assert p.returncode==0
   except subprocess.TimeoutExpired:
    records.append({'job':j,'timeout':True,'elapsed':time.monotonic()-begin});raise
  print('completed',j['id'],flush=True)
except BaseException as e:error=repr(e)
finally:
 (root/'attempt.json').write_text(json.dumps({'records':records,'error':error,'elapsed':time.monotonic()-start,'notRun':f['jobs'][len(records):]},indent=2)+'\n')
 (root/'artifact-index.json').write_text(json.dumps({'files':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}},indent=2)+'\n')
if error:raise RuntimeError(error)
