"""Independent fixed-job/inventory/arithmetic audit, no library imports."""
import hashlib,json,statistics,sys
from pathlib import Path
def verify(root):
 r=Path(root);read=lambda p:json.loads((r/p).read_text());idx=read('artifact-index.json')['files'];assert set(idx)=={str(p.relative_to(r)) for p in r.rglob('*') if p.is_file() and p.name!='artifact-index.json'}
 for p,h in idx.items():assert (r/p).resolve().is_relative_to(r.resolve()) and hashlib.sha256((r/p).read_bytes()).hexdigest()==h
 f=read('freeze.json');a=read('attempt.json');assert a['error'] is None and len(a['records'])==30 and 0<a['elapsed']<=900
 assert (f['warmup'],f['measured'],f['childSeconds'],f['totalSeconds'])==(1,3,120,900)
 assert hashlib.sha256((r/'tool.mjs').read_bytes()).hexdigest()==f['tool']
 for arm,h in f['bundles'].items():assert hashlib.sha256((r/(arm+'.mjs')).read_bytes()).hexdigest()==h
 for p,h in f['inputs'].items():assert hashlib.sha256((r/(p+'-inputs.json')).read_bytes()).hexdigest()==h
 jobs=[]
 for profile in ['P1','P3','P6']:
  for recipe in ['initial','duplicate2','verification']:
   for repeat in range(3):jobs.append(dict(id=len(jobs),profile=profile,recipe=recipe,repeat=repeat,control=False,order=['after','before'] if repeat%2 else ['before','after']))
 for recipe in ['initial','duplicate2','verification']:jobs.append(dict(id=len(jobs),profile='P6',recipe=recipe,repeat=0,control=True,order=['before','before']))
 assert f['jobs']==jobs;results=[];pids=set()
 for j,rec in zip(jobs,a['records']):
  assert rec==dict(id=j['id'],code=0);x=read(f"job-{j['id']}.json");assert x['job']==j and x['preflights'] and x['stateChecks'] and x['formalQualified'] is False and x['pid'] not in pids;pids.add(x['pid']);assert len(x['records'])==2
  med=[]
  for arm,row in zip(j['order'],x['records']):
   assert row['variant']==arm and len(row['samples'])==3 and all(isinstance(v,(int,float)) and 0<=v<120000 for v in row['samples']);med.append(statistics.median(row['samples']))
  ratio=med[1]/med[0] if j['control'] or j['order'][0]=='before' else med[0]/med[1]
  results.append(dict(job=j,orderedMediansMs=med,afterBeforeRatio=ratio))
 groups=[]
 for p in ['P1','P3','P6']:
  for recipe in ['initial','duplicate2','verification']:
   rows=[x for x in results if x['job']['profile']==p and x['job']['recipe']==recipe and not x['job']['control']]
   groups.append(dict(profile=p,recipe=recipe,beforeMedianMs=statistics.median(x['orderedMediansMs'][x['job']['order'].index('before')] for x in rows),afterMedianMs=statistics.median(x['orderedMediansMs'][x['job']['order'].index('after')] for x in rows),pairedRatios=[x['afterBeforeRatio'] for x in rows]))
 return dict(verified=True,formalQualified=False,processes=30,samples=180,preflights=60,groups=groups,results=results)
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
