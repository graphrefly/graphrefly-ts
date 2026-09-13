"""Reuse hash-verified immutable source preparation; no consumer imports/executions."""
import hashlib,itertools,json,pathlib,secrets,shutil,subprocess,sys,tarfile
H=pathlib.Path(__file__).resolve().parent;R=H/'prepared';REPO=H.parents[3]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):
 with p.open('x') as f:json.dump(x,f,indent=2);f.write('\n')
if not R.exists():
 a=REPO/'archive/evals/causal-dependency-comparison-preparation-v1';idx=json.loads((a/'artifact-index.json').read_text());assert sha(a/'prepared.tar.gz')==idx['sha256']
 with tarfile.open(a/'prepared.tar.gz') as t:
  for n,e in idx['files'].items():
   b=t.extractfile(n).read();assert hashlib.sha256(b).hexdigest()==e['sha256']
   if n.startswith('prepared/') and n!='prepared/frozen.json':
    p=H/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
assert not (R/'frozen.json').exists()
assert not (R/'node-runtime.json').exists(), 'preparation already exists; reuse its frozen order, do not redraw'
# Remove obsolete dynamic plans and tooling; retained sources/build proof are unchanged.
for n in ['order-bits.json','python-runtime.json']:(R/n).unlink(missing_ok=True)
for n in ['collect.py','verify.py','continuity.py','driver.mjs','child.mjs']:shutil.copyfile(H/n,R/'tools'/n)
shutil.copyfile(H.parent/'dependency-measurement-design/README.md',R/'tools/PLAN.md')
chosen=set(secrets.choice(list(itertools.combinations(range(8),4))))
put(R/'order-bits.json',[0 if i in chosen else 1 for i in range(8)])
put(R/'python-runtime.json',{'executable':sys.executable,'sha256':sha(pathlib.Path(sys.executable)),'version':sys.version})
b=json.loads((R/'build-tools.json').read_text());node=next(n for n in b if pathlib.Path(n).name=='node');assert sha(pathlib.Path(node))==b[node]
env={'PATH':str(pathlib.Path(node).parent)+':/usr/bin:/bin:/usr/sbin:/sbin','LANG':'C','TZ':'UTC'}
r=json.loads(subprocess.check_output([node,'-e','console.log(JSON.stringify({node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,execPath:process.execPath}))'],env=env));assert r['execPath']==node
r['executableDigest']=b[node];put(R/'node-runtime.json',r)
print('PREPARED source reuse and Node metadata probe; consumer executions=0; not frozen')
