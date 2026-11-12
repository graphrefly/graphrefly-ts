"""Bounded execution of a frozen attribution map; no acceptance statistics."""
import hashlib,json,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]).resolve();freeze=json.loads((root/'freeze.json').read_text());assert not (root/'dispatch.json').exists()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(root/'entry.mjs')==freeze['bundle']
for p,h in freeze['sources'].items():assert sha(Path(p))==h,p
for p,h in freeze['inputs'].items():assert sha(root/p)==h,p
node=subprocess.check_output(['which','node'],text=True).strip();start=time.monotonic();p=None;failure=None;rss=[]
(root/'dispatch.json').write_text(json.dumps(dict(node=node,nodeDigest=sha(Path(node)),start=start,freezeDigest=sha(root/'freeze.json'),limits=freeze['limits']))+'\n')
try:
 with (root/'stdout.log').open('xb') as out,(root/'stderr.log').open('xb') as err:
  p=subprocess.Popen([node,str(root/'entry.mjs')],cwd=root,stdout=out,stderr=err)
  while p.poll() is None:
   assert time.monotonic()-start<freeze['limits']['seconds'],'deadline'
   raw=subprocess.run(['/bin/ps','-o','rss=','-p',str(p.pid)],text=True,capture_output=True,timeout=2)
   rss.append(dict(time=time.monotonic(),code=raw.returncode,raw=raw.stdout))
   if raw.stdout.strip():assert int(raw.stdout)<=2048*1024,'RSS cap'
   try:p.wait(timeout=.2)
   except subprocess.TimeoutExpired:pass
  assert p.returncode==0,'child failed'
  assert time.monotonic()-start<=freeze['limits']['seconds'],'post-exit deadline'
except BaseException as e:failure=repr(e)
finally:
 cleanup=[]
 if p is not None and p.poll() is None:
  try:p.kill()
  except BaseException as e:cleanup.append(repr(e))
  try:p.wait(timeout=3)
  except BaseException as e:cleanup.append(repr(e))
 (root/'exit.json').write_text(json.dumps(dict(pid=None if p is None else p.pid,code=None if p is None else p.returncode,error=failure,cleanupErrors=cleanup,elapsed=time.monotonic()-start,rss=rss))+'\n')
 (root/'artifact-index.json').write_text(json.dumps({'files':{str(p.relative_to(root)):sha(p) for p in sorted(root.rglob('*')) if p.is_file() and p.name!='artifact-index.json'}},indent=2)+'\n')
 print('PROFILE_MAP_EXIT',failure,flush=True)
sys.exit(failure is not None)
