"""Frozen serial latency collection with process bounds, no acceptance retries."""
import hashlib,json,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]).resolve();sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();f=json.loads((root/'freeze.json').read_text());assert not (root/'reservation.json').exists()
for p,h in f['sources'].items():assert sha(Path(p))==h
assert sha(root/'entry.mjs')==f['bundle']
for p,h in f['inputs'].items():assert sha(root/(p+'-inputs.json'))==h
(root/'reservation.json').write_text(json.dumps({'freeze':sha(root/'freeze.json'),'node':subprocess.check_output(['node','--version'],text=True).strip(),'runner':sha(Path(__file__))})+'\n')
start=time.monotonic();records=[];error=None;p=None;job=None;begin=None;rss=[]
try:
 for job in f['jobs']:
  p=None;begin=None;rss=[]
  assert time.monotonic()-start<f['limits']['totalSeconds'];begin=time.monotonic();rss=[]
  with (root/f"job-{job['id']}.log").open('x') as log:
   p=subprocess.Popen(['node',str(root/'entry.mjs'),str(job['id'])],stdout=log,stderr=subprocess.STDOUT)
   while p.poll() is None:
    assert time.monotonic()-begin<f['limits']['childSeconds'] and time.monotonic()-start<f['limits']['totalSeconds'],'deadline'
    raw=subprocess.run(['/bin/ps','-o','rss=','-p',str(p.pid)],capture_output=True,text=True,timeout=2)
    if raw.stdout.strip():rss.append(int(raw.stdout));assert rss[-1]<=f['limits']['rssMiB']*1024,'RSS cap'
    try:p.wait(timeout=.2)
    except subprocess.TimeoutExpired:pass
  records.append({'id':job['id'],'pid':p.pid,'code':p.returncode,'elapsed':time.monotonic()-begin,'rssKiB':rss});assert p.returncode==0,job
  print('completed',job['id'],flush=True)
except BaseException as e:error=repr(e)
finally:
 if p is not None and p.poll() is None:p.kill();p.wait(timeout=5)
 if p is not None and job is not None and not any(r['id']==job['id'] for r in records):records.append({'id':job['id'],'pid':p.pid,'code':p.returncode,'elapsed':time.monotonic()-begin,'rssKiB':rss,'failed':True})
 (root/'attempt.json').write_text(json.dumps({'records':records,'error':error,'elapsed':time.monotonic()-start,'notRun':[j['id'] for j in f['jobs'][len(records):]]},indent=2)+'\n')
 (root/'artifact-index.json').write_text(json.dumps({'files':{str(p.relative_to(root)):sha(p) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}},indent=2)+'\n')
if error:raise RuntimeError(error)
