"""Bounded serial diagnostic execution, preserving all attempted and unrun jobs."""
import hashlib,json,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]).resolve();read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
f=read(root/'freeze.json');start=time.monotonic();records=[];error=None
(root/'runner.py').write_bytes(Path(__file__).read_bytes())
(root/'reservation.json').write_text(json.dumps({'freeze':sha(root/'freeze.json'),'runner':sha(root/'runner.py'),'node':subprocess.check_output(['node','--version'],text=True).strip(),'jobs':len(f['jobs'])},indent=2)+'\n')
try:
 for job in f['jobs']:
  assert time.monotonic()-start<f['totalSeconds']
  argv=['node',str(Path(__file__).with_name('causal-ref-comparison.mjs').resolve()),'run',str(root),str(job['id'])];beg=time.monotonic()
  with (root/f"job-{job['id']}.log").open('w') as log:
   try:
    r=subprocess.run(argv,stdout=log,stderr=subprocess.STDOUT,timeout=min(f['childSeconds'],f['totalSeconds']-(beg-start)))
    records.append({'job':job['id'],'argv':argv,'exitCode':r.returncode,'elapsed':time.monotonic()-beg})
    assert r.returncode==0,job
   except subprocess.TimeoutExpired:
    records.append({'job':job['id'],'argv':argv,'timeout':True,'elapsed':time.monotonic()-beg});raise
  print('completed',job['id'],flush=True)
except BaseException as e:error=repr(e)
finally:
 (root/'attempt.json').write_text(json.dumps({'records':records,'error':error,'elapsed':time.monotonic()-start,'notRun':[j['id'] for j in f['jobs'][len(records):]],'formalQualification':False},indent=2)+'\n')
 (root/'artifact-index.json').write_text(json.dumps({'files':{str(p.relative_to(root)):sha(p) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}},indent=2)+'\n')
if error:raise RuntimeError(error)
