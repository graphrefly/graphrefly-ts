"""Eight serial frozen cold checks, retain all failures; no automatic retries."""
import hashlib,json,subprocess,sys,time
from pathlib import Path
r=Path(sys.argv[1]).resolve();f=json.loads((r/'freeze.json').read_text());assert not (r/'attempt.json').exists()
start=time.monotonic();records=[];error=None
try:
 for job in f['jobs']:
  assert time.monotonic()-start<240
  with (r/f"job-{job['id']}.log").open('x') as log:
   p=subprocess.run(['node','scripts/causal-global-cold.mjs','run',str(r),str(job['id'])],stdout=log,stderr=subprocess.STDOUT,timeout=30)
   records.append(dict(id=job['id'],code=p.returncode));assert p.returncode==0
  print('COLD_DONE',job['id'],flush=True)
except BaseException as e:error=repr(e)
finally:
 (r/'attempt.json').write_text(json.dumps(dict(error=error,records=records,elapsed=time.monotonic()-start))+'\n')
 (r/'artifact-index.json').write_text(json.dumps({'files':{str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in r.rglob('*') if p.is_file() and p.name!='artifact-index.json'}},indent=2)+'\n')
if error:raise RuntimeError(error)
