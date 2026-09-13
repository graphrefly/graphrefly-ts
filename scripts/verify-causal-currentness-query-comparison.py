"""Independent replay of fixed diagnostic samples, hashes, process scope and order."""
import hashlib,json,math,statistics,sys
from pathlib import Path

def verify(root):
 root=Path(root);read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 idx=read(root/'artifact-index.json')['files']
 assert set(idx)=={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}
 for p,h in idx.items():assert (root/p).resolve().is_relative_to(root.resolve()) and sha(root/p)==h,p
 f=read(root/'freeze.json');a=read(root/'attempt.json');r=read(root/'reservation.json')
 assert r['freeze']==sha(root/'freeze.json') and r['runner']==sha(root/'runner.py') and r['node']=='v24.18.0'
 assert f['warmup']==1 and f['measured']==3 and f['childSeconds']==120 and f['totalSeconds']==900
 assert r['jobs']==21 and len(a['records'])==21 and a['error'] is None and a['notRun']==[] and 0<a['elapsed']<=900
 assert f['tool']==sha(root/'tool.mjs') and f['beforeSource']==sha(root/'identity-before.ts')
 assert f['afterSource']==sha(root/'source/packages/ts/src/solutions/causal-occurrence/identity.ts')
 for p,h in f['sources'].items():assert sha(root/'source'/p)==h,p
 for v,h in f['bundles'].items():assert sha(root/(v+'.mjs'))==h,v
 for p,h in f['inputs'].items():assert sha(root/(p+'-inputs.json'))==h,p
 expected=[]
 for p in ['P1','P3','P4']:
  for count in [1,2]:
   for repeat in range(3):expected.append(dict(id=len(expected),profile=p,count=count,repeat=repeat,control=False,order=['after','before'] if repeat%2 else ['before','after']))
 for p in ['P1','P3','P4']:expected.append(dict(id=len(expected),profile=p,count=2,repeat=0,control=True,order=['before','before']))
 assert f['jobs']==expected
 rows=[];pids=set();origins=set()
 for job,record in zip(expected,a['records']):
  assert record['job']==job['id'] and record['exitCode']==0 and 0<record['elapsed']<=120
  x=read(root/f"job-{job['id']}.json");assert x['job']==job and x['preflights']==2 and x['stateComparison'] is True and x['formalQualification'] is False
  assert x['pid'] not in pids and x['timeOrigin'] not in origins;pids.add(x['pid']);origins.add(x['timeOrigin'])
  med=[]
  for i,v in enumerate(job['order']):
   rec=x['records'][i];assert rec['variant']==v and rec['position']==i and len(rec['samples'])==3
   assert all(math.isfinite(n) and 0<n<120000 for n in rec['samples']);med.append(statistics.median(rec['samples']))
  before=med[0 if job['order'][0]=='before' else 1];after=med[1 if job['order'][0]=='before' else 0]
  rows.append(dict(job=job,beforeMedianMs=before,afterMedianMs=after,ratio=after/before))
 summary=[]
 for p in ['P1','P3','P4']:
  for count in [1,2]:
   xs=[x for x in rows if x['job']['profile']==p and x['job']['count']==count and not x['job']['control']]
   summary.append(dict(profile=p,dataCount=count,beforeMedianMs=statistics.median(x['beforeMedianMs'] for x in xs),afterMedianMs=statistics.median(x['afterMedianMs'] for x in xs),ratios=[x['ratio'] for x in xs]))
 return dict(verified=True,formalQualification=False,processes=21,samples=126,preflights=42,summary=summary,controls=[x for x in rows if x['job']['control']],rows=rows)
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
