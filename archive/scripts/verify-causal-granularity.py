"""Independent integrity, recipe metadata and timing arithmetic verification."""
import hashlib,json,math,statistics,sys
from pathlib import Path

def verify(root):
 root=Path(root);read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 idx=read(root/'artifact-index.json')['files'];assert set(idx)=={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}
 for p,h in idx.items():assert (root/p).resolve().is_relative_to(root.resolve()) and sha(root/p)==h
 f=read(root/'freeze.json');r=read(root/'reservation.json');a=read(root/'attempt.json')
 assert r['freeze']==sha(root/'freeze.json') and r['runner']==f['sources']['scripts/run-causal-granularity.py']
 assert f['profiler'] is False and f['retries']==0 and f['limits']==dict(childSeconds=120,totalSeconds=1800,rssMiB=2048)
 for p,h in f['sources'].items():assert sha(root/'source'/p)==h
 for p,h in f['inputs'].items():assert sha(root/(p+'-inputs.json'))==h
 assert sha(root/'entry.mjs')==f['bundle']
 jobs=[];orders=[['candidate','reference','plain'],['reference','plain','candidate'],['plain','candidate','reference']]
 for profile in ['P3','P6']:
  for change in ['one-new','duplicate']:
   for selection in ['full','last']:
    for count in [1,2]:
     row=dict(id=f'steady-{profile}-off-{change}-{count}',group='steady',profile=profile,mode='off',change=change,dataCount=count)
     for repeat in range(3):jobs.append(dict(id=len(jobs),row=row,selection=selection,repeat=repeat,order=orders[repeat]))
 assert f['jobs']==jobs and a['error'] is None and a['notRun']==[] and len(a['records'])==48 and 0<a['elapsed']<=1800
 pids=set();origins=set();raw=[]
 for job,e in zip(jobs,a['records']):
  assert e['id']==job['id'] and e['code']==0 and 0<e['elapsed']<=120 and e['rssKiB'] and max(e['rssKiB'])<=2048*1024
  x=read(root/f"job-{job['id']}.json");assert x['job']==job and x['pid']==e['pid'] and x['pid'] not in pids and x['timeOrigin'] not in origins and x['node']==r['node'];pids.add(x['pid']);origins.add(x['timeOrigin'])
  assert x['preflight'] is True and x['profiler'] is False and x['formalQualified'] is False
  assert [v['arm'] for v in x['records']]==job['order']
  for v in x['records']:
   obs=v['observations'];assert len(obs)==7
   for i,o in enumerate(obs):
    assert o['index']==i and o['phase']==('warmup' if i<2 else 'measured')
    assert all(math.isfinite(o[k]) and o[k]>=0 for k in ['arrivalMs','verificationMs','totalMs','constructionMs','preparationMs']) and o['totalMs']<120000
    assert abs(o['totalMs']-o['arrivalMs']-o['verificationMs'])<1e-7
   raw.append(dict(job=job,arm=v['arm'],medians={k:statistics.median(o[k] for o in obs[2:]) for k in ['arrivalMs','verificationMs','totalMs']}))
 summary=[]
 for j in jobs[::3]:
  item=dict(row=j['row'],selection=j['selection'],arms={})
  for arm in orders[0]:
   xs=[x for x in raw if x['job']['row']==j['row'] and x['job']['selection']==j['selection'] and x['arm']==arm]
   item['arms'][arm]={k:statistics.median(x['medians'][k] for x in xs) for k in xs[0]['medians']};item['arms'][arm]['repeatTotalMs']=[x['medians']['totalMs'] for x in xs]
  summary.append(item)
 return dict(verified=True,formalQualified=False,processes=48,measuredSamples=720,totalSamples=1008,elapsed=a['elapsed'],summary=summary)
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
