"""Reindexed corruption tests: outer hash updates must not conceal semantic evidence damage."""
import hashlib,json,os,shutil,subprocess,tempfile
from pathlib import Path
ROOT=Path.cwd();source=ROOT/'archive/evals/causal-position-current-v2/run';(ROOT/'.tmp').mkdir(exist_ok=True)
def read(p):return json.loads(p.read_text())
def write(p,x):
 if p.exists():p.unlink()
 p.write_text(json.dumps(x)+'\n')
def change(path,fn):x=read(path);fn(x);write(path,x)
job=sorted(p.name for p in source.glob('00-*'))[0]
mutations=[
 ('recipe',lambda d:change(d/job/'worker.json',lambda x:x['recipe'].update(warmup=99))),
 ('preflight',lambda d:change(d/job/'preflight-order.json',lambda x:x.update(modules=[1,0]))),
 ('status',lambda d:change(d/'result.json',lambda x:x.update(status='method-qualified'))),
 ('argv',lambda d:change(d/job/'exit.json',lambda x:x.update(argv=x['argv'][:1]+x['argv'][2:]))),
 ('completion',lambda d:change(d/job/'completion.json',lambda x:x.update(samples=2399))),
 ('unknown-dispatch',lambda d:(d/'hidden').mkdir() or write(d/'hidden/dispatch.json',{})),
 ('order-bits',lambda d:change(d/'reservation.json',lambda x:x['orderBits'].__setitem__(0,1-x['orderBits'][0]))),
]
reports=[]
for name,mutate in mutations:
 temp=Path(tempfile.mkdtemp(prefix='causal-evidence-',dir=ROOT/'.tmp'));d=temp/'run';shutil.copytree(source,d,copy_function=os.link)
 try:
  mutate(d);write(d/'artifact-index.json',{'files':{str(p.relative_to(d)):hashlib.sha256(p.read_bytes()).hexdigest() for p in d.rglob('*') if p.is_file() and p.name!='artifact-index.json'}})
  r=subprocess.run(['python3',str(ROOT/'scripts/verify-causal-position-current.py'),str(d)],capture_output=True,text=True,timeout=30)
  assert r.returncode!=0,name;reports.append({'mutation':name,'rejected':True,'lastError':r.stderr.strip().splitlines()[-1]})
 finally:shutil.rmtree(temp)
print(json.dumps({'passed':True,'reindexedCorruptions':reports},indent=2))
