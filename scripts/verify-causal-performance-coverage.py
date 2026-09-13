"""Independent raw coverage replay. Imports no collector or statistics from it."""
import hashlib,json,math,statistics,sys
from pathlib import Path

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def quant(values,q):
 assert values and all(type(x) in (int,float) and math.isfinite(x) and x>=0 for x in values)
 return sorted(values)[math.ceil(len(values)*q)-1]
def verify(root):
 root=Path(root); idx=read(root/'artifact-index.json')['files']
 for name,h in idx.items():
  p=root/name;assert p.resolve().is_relative_to(root.resolve()) and sha(p)==h,name
 assert set(idx)=={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'},'file membership'
 f=read(root/'freeze.json'); r=read(root/'reservation.json'); a=read(root/'attempt.json')
 assert r['freeze']==sha(root/'freeze.json') and f['bundle']==sha(root/'worker.mjs')
 assert f['limits']==dict(processes=168,childSeconds=900,totalSeconds=7200,rssMiB=2048,retries=0)
 assert len(f['jobs'])==168
 assert a['complete'] is True and a['failure'] is None and a['dispatched']==168 and a['notRun']==[]
 assert 0<a['elapsed']<=7200 and a['formalQualification'] is False
 for name,h in f['sources'].items():assert sha(root/'source'/name)==h,name
 for name,h in f['inputs'].items():assert sha(root/name)==h,name
 assert sha(root/'adapted-worker.ts')==f['adapted']
 expected_rows=[]
 for profile in ['P1','P2','P3','P4','P5','P6']:
  for mode in ['off','summary']:expected_rows.append(dict(id=f'cold-{profile}-{mode}',group='cold',profile=profile,mode=mode))
 for profile in ['P1','P2','P3','P4','P5','P6']:
  for mode in ['off','summary']:
   for change in ['duplicate','all-new']+(['one-new'] if profile in ['P3','P5','P6'] else []):
    for dataCount in [1,2]:expected_rows.append(dict(id=f'steady-{profile}-{mode}-{change}-{dataCount}',group='steady',profile=profile,mode=mode,change=change,dataCount=dataCount))
 for profile in ['P1','P2','P3','P4','P5','P6']:
  for mode in ['off','summary']:expected_rows.append(dict(id=f'recovery-{profile}-{mode}',group='recovery',profile=profile,mode=mode))
 entropy=bytes.fromhex(f['entropyHex']); assert len(entropy)==84
 for i,row in enumerate(expected_rows):
  for slot,control in enumerate([True,False] if entropy[i]%2 else [False,True]):
   assert f['jobs'][2*i+slot]==dict(position=2*i+slot,row=row,identicalReference=control),'frozen schedule'
 rows={};pids=set();samples_total=0;maxrss=0
 for j,job in enumerate(f['jobs']):
  assert job['position']==j
  d=root/f'job-{j:03}'; cfg=read(d/'config.json');exit=read(d/'exit.json');meta=read(d/'worker.json')
  row=job['row']; assert cfg['row']==row and cfg['identicalReference']==job['identicalReference']
  assert exit['exitCode']==0 and exit['error'] is None and exit['cleanupErrors']==[] and exit['wakeError'] is None and 0<exit['end']-exit['start']<=900
  assert exit['wakeBefore']==exit['wakeAfter']==r['wake'] and abs(exit['wallEnd']-exit['wallStart']-(exit['end']-exit['start']))<=1
  assert meta['pid']==exit['pid'] and meta['pid'] not in pids;pids.add(meta['pid'])
  assert meta['row']==row and meta['recipe']==f['recipe'] and meta['node']==f['runtime']['node']
  assert read(d/'preflight.json')['passed'] is True
  for x in exit['rss']:
   if x['code']==0 and x['stdout'].strip():
    pid,rss,state=x['stdout'].split();assert int(pid)==exit['pid'] and 0<=int(rss)<=2097152
    maxrss=max(maxrss,int(rss)/1024)
  values=[json.loads(l) for l in (d/'samples.jsonl').read_text().splitlines()];samples_total+=len(values)
  expected=[]
  for batch,arms in enumerate([['candidate','reference'],['reference','candidate'],['candidate','reference']]):
   if row['group']=='recovery' and batch>0:continue
   for arm in arms+([] if row['group']=='recovery' else ['plain']):
    for i in range(20 if row['group']=='recovery' else 400):expected.append((batch,arm,i,'measured' if row['group']=='recovery' or i>=100 else 'warmup'))
  assert len(values)==len(expected) and read(d/'completion.json')==dict(completed=True,samples=len(expected))
  last=-1
  for x,coordinate in zip(values,expected):
   assert (x['batch'],x['arm'],x['index'],x['phase'])==coordinate
   assert x['start']>=last and x['ms']==x['end']-x['start'] and x['ms']>=0;last=x['end']
   assert all(math.isfinite(x[k]) and x[k]>=0 for k in ['start','end','ms','constructionMs','preparationMs'])
   if row['group']=='cold':assert x['constructionMs']==x['preparationMs']==0 and not x['actionSteps']
   if row['group']=='recovery':
    counts=x['recoveryDataCounts'];assert all(counts[k]>0 for k in ['assessment','publication','startup'] if k in counts)
  arms={}
  for arm in ['candidate','reference']+([] if row['group']=='recovery' else ['plain']):
   blocks=[]
   for b in range(1 if row['group']=='recovery' else 3):
    block=[x for x in values if x['arm']==arm and x['batch']==b and x['phase']=='measured']
    blocks.append({key:{'p50':quant([x[key] for x in block],.5),'p95':quant([x[key] for x in block],.95)} for key in ['ms','constructionMs','preparationMs']})
   arms[arm]=blocks
  ratio=statistics.median(b['ms']['p95'] for b in arms['candidate'])/statistics.median(b['ms']['p95'] for b in arms['reference'])
  rows.setdefault(row['id'],{'row':row})['control' if job['identicalReference'] else 'main']=dict(position=j,ratio=ratio,arms=arms)
 assert len(rows)==84 and samples_total==519360
 report=[]
 for item in rows.values():
  assert 'main' in item and 'control' in item
  row=item['row'];limit=1.2 if row['group']=='cold' else 1.1 if row['group']=='steady' else None
  item.update(limit=limit,descriptiveWithinBudget=None if limit is None else item['main']['ratio']<=limit,controlWithinFivePercent=1/1.05<=item['control']['ratio']<=1.05)
  report.append(item)
 return dict(kind='diagnostic-coverage-replay',complete=True,formalQualification=False,jobs=168,samples=samples_total,maxObservedRSSMiB=maxrss,rows=report)
if __name__=='__main__': print(json.dumps(verify(sys.argv[1]),indent=2))
