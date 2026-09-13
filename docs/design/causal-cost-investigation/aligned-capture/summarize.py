"""Summarize independently replayed aligned capture. Read-only, no execution."""
import collections,hashlib,json,statistics
from pathlib import Path
D=Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text())
a=read(D/'analysis.json');raw=D/'raw';result=read(raw/'result.json');q=read(raw/'qualification.json')
assert result['completed'] and len(result['children'])==12 and result['notRun']==[]
assert q['preparedDigests']['worker.mjs']==q['preparedDigests']['worker-copy.mjs']
rows=[];all_mapping=collections.Counter();named={'slow':collections.Counter(),'ordinary':collections.Counter()};den=collections.Counter();zeros=collections.Counter();events=0
for c in a['children']:
 x=c['analysis'];diag=read(raw/f"{c['id']:02d}"/'diagnostic.json');events+=len(diag['gc'])
 row=dict(id=c['id'],round=c['round'],condition=x['condition'],deliveredGcEvents=len(diag['gc']),measuredGcOverlapMs=sum(g['gcOverlapMs']for g in x['groups']),maxMeasuredConstructionMs=max(w['ms']for w in x['windows']if w['phase']=='measured'))
 if x['cpu']:
  cp=x['cpu'];frames={n['id']:n['callFrame']for n in cp['frames']};all_mapping.update(cp['assignment'])
  row.update(widthMs=cp['widthMs'],samples=cp['sampleCount'],assignment=cp['assignment'],groups={})
  for group in ['slow','ordinary']:
   counts=collections.Counter();subset=[g for g in x['groups']if g['group']==group]
   for g in subset:
    for id,n in g['self'].items():
     f=frames[int(id)];name=(f['functionName'],Path(f['url']).name,f['lineNumber']+1,f['columnNumber']+1);counts[name]+=n
     # Combine ONLY the two hash-identical bundles for this explicit source-location table.
     if name[1]in('worker.mjs','worker-copy.mjs'):named[group][(name[0],name[2],name[3])]+=n
   total=sum(counts.values());den[group]+=total;zero=sum(g['zeroHitWindows']for g in subset);zeros[group]+=zero
   row['groups'][group]=dict(windows=sum(g['count']for g in subset),zeroCertainWindows=zero,certainLeafSamples=total,makeDepBookkeepingSamples=sum(n for k,n in counts.items()if k[0]=='makeDepBookkeeping'),top=[dict(function=k[0],bundle=k[1],line=k[2],column=k[3],samples=n)for k,n in counts.most_common(8)])
 rows.append(row)
ratios={}
for contrast in ['GC/CONTROL','GC_CPU/GC','GC_CPU/CONTROL']:
 ratios[contrast]={}
 for metric in ['p95Ms','constructionSumMs','checkpoint.userMs']:
  values=[r['ratios'][metric]for r in a['ratios']if r['contrast']==contrast]
  ratios[contrast][metric]=dict(median=statistics.median(values),min=min(values),max=max(values),aboveOne=sum(v>1 for v in values),pairs=len(values))
obs=[o for p in raw.glob('*/exit.json')for o in read(p)['observations']]
vobs=[o for p in raw.glob('*/verification/exit.json')for o in read(p)['observations']]
report=dict(complete=True,nodeProcesses=12,pythonVerifiers=12,retries=0,samples=28800,warmup=7200,measured=21600,preflightCalls=24,untimedPreflightInstances=72,
 boundary=read(raw/'final-boundary.json'),maxObservedNodeRssMiB=max(o['rssBytes']for o in obs)/2**20,maxObservedVerifierRssMiB=max(o['rssBytes']for o in vobs)/2**20,maxObservationGapSeconds=max(o['gap']for o in obs+vobs),
 deliveredGcEvents=events,measuredGcOverlapMs=sum(r['measuredGcOverlapMs']for r in rows),cpuAssignment=dict(all_mapping),knownWindowZeroCounts=dict(zeros),
 makeDepBookkeeping={g:dict(samples=sum(n for k,n in named[g].items()if k[0]=='makeDepBookkeeping'),certainLeafDenominator=den[g])for g in named},children=rows,ratios=ratios,
 analysisSha256=hashlib.sha256((D/'analysis.json').read_bytes()).hexdigest(),
 conclusion='Valid instrumented capture. Repeated makeDepBookkeeping source clue, not a proven slow-tail cause. Delivered GC subset has no measured construction overlap. Sampling interference and coverage gaps prevent a second optimization or D169 acceptance claim.')
print(json.dumps(report,indent=2))
