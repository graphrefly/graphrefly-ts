"""Bounded serial prototype timing; preserve every attempt and failure."""
import hashlib,json,subprocess,sys,time
from pathlib import Path
r=Path(sys.argv[1]).resolve();f=json.loads((r/'freeze.json').read_text());assert not (r/'attempt.json').exists();records=[];error=None;start=time.monotonic()
try:
 for job in f['jobs']:
  remaining=f['totalSeconds']-(time.monotonic()-start);assert remaining>0
  with (r/f"job-{job['id']}.log").open('x') as log:
   p=subprocess.run(['node','scripts/causal-policy-prototype.mjs','run',str(r),str(job['id'])],stdout=log,stderr=subprocess.STDOUT,timeout=min(f['childSeconds'],remaining));records.append(dict(id=job['id'],code=p.returncode));assert p.returncode==0
  print('PROTOTYPE_DONE',job['id'],flush=True)
except BaseException as e:error=repr(e)
finally:
 (r/'attempt.json').write_text(json.dumps(dict(records=records,error=error,elapsed=time.monotonic()-start))+'\n')
 (r/'artifact-index.json').write_text(json.dumps({'files':{str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in r.rglob('*') if p.is_file() and p.name!='artifact-index.json'}},indent=2)+'\n')
if error:raise RuntimeError(error)
