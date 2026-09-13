"""Independent integrity, coverage and node-counter audit; no consumer or collector imports."""
import hashlib,json,math,sys
from pathlib import Path

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def verify(root):
 root=Path(root);idx=read(root/'artifact-index.json')['files']
 for name,h in idx.items():assert (root/name).resolve().is_relative_to(root.resolve()) and sha(root/name)==h,name
 assert set(idx)=={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}
 f=read(root/'freeze.json');ex=read(root/'exit.json');r=read(root/'result.json')
 assert ex['code']==0 and ex['error'] is None and ex['cleanupErrors']==[] and 0<ex['elapsed']<=f['limits']['seconds']
 assert sha(root/'entry.mjs')==f['bundle'] and read(root/'dispatch.json')['freezeDigest']==sha(root/'freeze.json')
 for p,h in f['sources'].items():assert sha(root/'source'/p)==h,p
 for p,h in f['inputs'].items():assert sha(root/p)==h,p
 rows=[]
 for p in range(1,7):
  for m in ['off','summary']:rows.append(dict(id=f'cold-P{p}-{m}',group='cold',profile=f'P{p}',mode=m))
 for p in range(1,7):
  for m in ['off','summary']:
   for c in ['duplicate','all-new']+(['one-new'] if p in [3,5,6] else []):
    for n in [1,2]:rows.append(dict(id=f'steady-P{p}-{m}-{c}-{n}',group='steady',profile=f'P{p}',mode=m,change=c,dataCount=n))
 for p in range(1,7):
  for m in ['off','summary']:rows.append(dict(id=f'recovery-P{p}-{m}',group='recovery',profile=f'P{p}',mode=m))
 assert len(r['results'])==84 and r['formalQualification'] is False
 assert [json.loads(l) for l in (root/'rows.jsonl').read_text().splitlines()]==r['results']
 observations=0;summary=[]
 for expected,x in zip(rows,r['results']):
  assert x['row']==expected and x['semantic']['passed'] is True
  arms=['candidate','reference']+([] if expected['group']=='recovery' else ['plain']);assert [a['arm'] for a in x['arms']]==arms
  values={}
  for a in x['arms']:
   n=20 if expected['group']=='recovery' else 1;assert len(a['observations'])==n
   for i,o in enumerate(a['observations']):
    observations+=1;assert o['index']==i
    for k in ['constructMs','preparationMs','ms']:assert type(o[k]) in [int,float] and math.isfinite(o[k]) and o[k]>=0
    if a['arm']=='plain':assert o['nodes'] is None and o['totalInvokes'] is None
    else:
     assert sum(v['invokes'] for v in o['nodes'].values())==o['totalInvokes']
     assert all(type(v['invokes']) is int and v['invokes']>=0 and math.isfinite(v['totalDurationNs']) and v['totalDurationNs']>=0 for v in o['nodes'].values())
   values[a['arm']]={k:[o[k] for o in a['observations']] for k in ['constructMs','preparationMs','ms','totalInvokes']}
  summary.append(dict(row=expected,arms=values))
 assert observations==696
 rss=[int(x['raw'])/1024 for x in ex['rss'] if x['raw'].strip()];assert rss and max(rss)<=2048
 return dict(verified=True,rows=84,preflights=84,actionObservations=696,formalQualification=False,elapsed=ex['elapsed'],maxProcessRSSMiB=max(rss),summary=summary)
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
