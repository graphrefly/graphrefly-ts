"""Independent unprofiled latency replay. No collector imports or formal acceptance decision."""
import hashlib,json,math,statistics,sys
from pathlib import Path

def verify(root):
 root=Path(root);read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 idx=read(root/'artifact-index.json')['files']
 assert set(idx)=={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}
 for p,h in idx.items():assert (root/p).resolve().is_relative_to(root.resolve()) and sha(root/p)==h,p
 f=read(root/'freeze.json');res=read(root/'reservation.json');attempt=read(root/'attempt.json')
 assert res['freeze']==sha(root/'freeze.json') and res['node']=='v24.18.0'
 assert res['runner']==f['sources']['scripts/run-causal-latency-baseline.py']
 assert f['profiler'] is False and f['retries']==0 and f['limits']==dict(childSeconds=120,totalSeconds=1800,rssMiB=2048)
 for p,h in f['sources'].items():assert sha(root/'source'/p)==h,p
 assert sha(root/'entry.mjs')==f['bundle']
 for p,h in f['inputs'].items():assert sha(root/(p+'-inputs.json'))==h,p
 assert 'new Graph({ name: "spending-performance" })' in (root/'source/scripts/fixtures/spending-preset-performance.ts').read_text()
 expected_rows=[]
 for profile in ['P1','P3','P6']:
  cold=dict(id=f'cold-{profile}-off',group='cold',profile=profile,mode='off')
  expected_rows.extend([dict(row=cold,initial=False),dict(row=cold,initial=True)])
  cases=[('duplicate',1),('duplicate',2),('all-new',2)]+([] if profile=='P1' else [('one-new',1)])
  for change,n in cases:expected_rows.append(dict(row=dict(id=f'steady-{profile}-off-{change}-{n}',group='steady',profile=profile,mode='off',change=change,dataCount=n),initial=False))
  expected_rows.append(dict(row=dict(id=f'recovery-{profile}-off',group='recovery',profile=profile,mode='off'),initial=False))
 assert f['rows']==expected_rows and len(expected_rows)==20
 jobs=[];orders=[['candidate','reference','plain'],['reference','plain','candidate'],['plain','candidate','reference']]
 for r in expected_rows:
  for repeat in range(3):
   for control in ([True,False] if repeat%2 else [False,True]):jobs.append(dict(id=len(jobs),**r,repeat=repeat,control=control,order=orders[repeat]))
 assert f['jobs']==jobs and len(attempt['records'])==len(jobs)==120 and attempt['notRun']==[] and attempt['error'] is None and 0<attempt['elapsed']<=1800
 pids=set();origins=set();summaries=[];total=0;measured_total=0;maxrss=0
 for job,ex in zip(jobs,attempt['records']):
  assert ex['id']==job['id'] and ex['code']==0 and 0<ex['elapsed']<=120
  assert ex['rssKiB'] and max(ex['rssKiB'])<=2048*1024;maxrss=max(maxrss,max(ex['rssKiB']))
  x=read(root/f"job-{job['id']}.json");assert x['job']==job and x['pid']==ex['pid'] and x['pid'] not in pids and x['timeOrigin'] not in origins;pids.add(x['pid']);origins.add(x['timeOrigin'])
  assert x['preflight'] and x['stateChecks'] and x['profiler'] is False and x['formalQualification'] is False
  labels=[l for l in job['order'] if not (job['row']['group']=='recovery' and l=='plain')];assert [a['label'] for a in x['records']]==labels
  vals={};raw={};warm={}
  for rec in x['records']:
   label=rec['label'];assert rec['position']==job['order'].index(label) and rec['arm']==('plain' if label=='plain' else 'reference' if job['control'] else label)
   cold=job['row']['group']=='cold' and not job['initial'];nw,nm=(20,100) if cold else (2,5);obs=rec['observations'];assert len(obs)==nw+nm
   for i,o in enumerate(obs):
    assert o['index']==i and o['phase']==('warmup' if i<nw else 'measured')
    assert all(math.isfinite(o[k]) and o[k]>=0 for k in ['ms','constructionMs','preparationMs']) and o['ms']<120000
    if cold:assert o['ms']==o['constructionMs']
    if job['initial']:assert abs(o['ms']-o['constructionMs']-o['preparationMs'])<1e-7
   total+=len(obs);measured_total+=nm
   raw[label]=[o['ms'] for o in obs[nw:]];vals[label]=statistics.median(raw[label]);warm[label]=[o['ms'] for o in obs[:nw]]
  summaries.append(dict(job=job,medianMs=vals,ratio=vals['candidate']/vals['reference'],samplesMs=raw,warmupMs=warm))
 results=[]
 for r in expected_rows:
  xs=[s for s in summaries if s['job']['row']==r['row'] and s['job']['initial']==r['initial']];main=[s for s in xs if not s['job']['control']];ctrl=[s for s in xs if s['job']['control']]
  results.append(dict(**r,armMedianMs={label:statistics.median(s['medianMs'][label] for s in main) for label in main[0]['medianMs']},candidateReplicateMedians=[s['medianMs']['candidate'] for s in main],mainRatios=[s['ratio'] for s in main],controlRatios=[s['ratio'] for s in ctrl]))
 return dict(verified=True,formalQualified=False,profiler=False,processes=120,rows=20,preflights=120,samples=total,measuredSamples=measured_total,elapsed=attempt['elapsed'],maxProcessRSSMiB=maxrss/1024,interpretation='Synchronous library consumption through publication projection; excludes process startup, UI rendering, external executor/network. Small diagnostic samples, not qualified p95. 100ms is user experience expectation only.',results=results,jobs=summaries)
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
