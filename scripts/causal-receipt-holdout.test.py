"""Evidence corruption checks: reindex altered artifacts, then require semantic rejection."""
import hashlib,importlib.util,json,os,shutil,sys,tempfile
from pathlib import Path
script=Path(__file__).with_name('verify-causal-receipt-holdout.py');spec=importlib.util.spec_from_file_location('verify',script);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
source=Path(sys.argv[1]);report=[]
def alter(root,name,fn):
 p=root/name;x=json.loads(p.read_text());fn(x);p.unlink();p.write_text(json.dumps(x))
mutations=[
 ('extra-arm',lambda r:alter(r,'job-0.json',lambda x:x['records'].append(x['records'][0]))),
 ('sample-count',lambda r:alter(r,'job-0.json',lambda x:x['records'][0]['samples'].pop())),
 ('negative-sample',lambda r:alter(r,'job-0.json',lambda x:x['records'][0]['samples'].__setitem__(0,-1))),
 ('preflight',lambda r:alter(r,'job-0.json',lambda x:x.update(preflights=0))),
 ('identity',lambda r:alter(r,'job-1.json',lambda x:x.update(pid=json.loads((r/'job-0.json').read_text())['pid']))),
 ('order',lambda r:alter(r,'job-0.json',lambda x:x['records'].reverse())),
 ('hidden-failure',lambda r:alter(r,'attempt.json',lambda x:x.update(error='timeout'))),
]
for name,change in mutations:
 temp=Path(tempfile.mkdtemp(prefix='evidence-query-negative-'));root=temp/'run';shutil.copytree(source,root,copy_function=os.link)
 try:
  change(root);p=root/'artifact-index.json';p.unlink();p.write_text(json.dumps({'files':{str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest() for f in root.rglob('*') if f.is_file() and f.name!='artifact-index.json'}}))
  rejected=False
  try:v.verify(root)
  except AssertionError:rejected=True
  assert rejected,name;report.append({'mutation':name,'rejected':True})
 finally:shutil.rmtree(temp)
print(json.dumps({'passed':True,'reindexedNegatives':report},indent=2))
