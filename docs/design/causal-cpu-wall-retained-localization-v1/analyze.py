"""Retained-data localization only. No consumer imports, processes, clocks or measurements."""
import hashlib,json,math,statistics,sys
from pathlib import Path
root=Path(sys.argv[1]);out=Path(__file__).resolve().parent
index=json.loads((root/'artifact-index.json').read_text())['files']
assert {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}==set(index)
for name,h in index.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==h
summary=[]
def stats(xs):
 v=sorted(xs);return dict(n=len(v),totalMs=sum(v),p50=statistics.median(v),p95=v[math.ceil(len(v)*.95)-1],maximum=max(v)) if v else dict(n=0,totalMs=0,p50=None,p95=None,maximum=None)
def relation(ev,start,end,delta):
 a,b=ev['start'],ev['end'];dl,du=delta
 starts=[a-1-du,a+1-dl];ends=[b-1-du,b+1-dl]
 if ends[1]<math.floor(start*1000) or starts[0]>math.ceil(end*1000):return 'disjoint'
 if a<b and start<end and starts[1]<math.floor(end*1000) and ends[0]>math.ceil(start*1000):return 'overlap'
 return 'possible'
for job in sorted(p for p in root.iterdir() if p.is_dir() and (p/'samples.jsonl').exists()):
 raw=[json.loads(s) for s in (job/'samples.jsonl').read_text().splitlines()];pre=json.loads((job/'preflight.json').read_text());assert len(raw)==2400 and len(pre['topology']['reference'])==60
 t=json.loads((job/'report.json').read_text())['trace'] if '-T-' in job.name else None
 e=json.loads((job/'evidence.json').read_text()) if t else None
 covered=[]
 if t:
  lo=int(e['anchors'][0]['h'])//1000;hi=(int(e['anchors'][2]['h'])+999)//1000
  covered=[(i,x) for i,x in enumerate(t['events']) if lo<=x['start']<=x['end']<=hi]
 cells=[]
 for block in range(6):
  for phase,a,b in [('warmup',0,100),('measured',100,400)]:
   data=raw[block*400+a:block*400+b];gaps=[]
   for left,right in zip(data,data[1:]):
    assert (left['batch'],left['arm'],left['phase'])==(right['batch'],right['arm'],right['phase'])
    spans={n:[] for n in ('gc','deopt','possible')}
    for i,event in covered:
     rel=relation(event,left['end'],right['start'],t['deltaUs'])
     if rel=='overlap':spans['deopt' if event['name']=='V8.DeoptimizeCode' else 'gc'].append(i)
     elif rel=='possible':spans['possible'].append(i)
    gaps.append(dict(afterIndex=left['index'],ms=right['start']-left['end'],**spans))
   cells.append(dict(block=block,phase=phase,construction=stats([x['ms'] for x in data]),gaps=stats([x['ms'] for x in gaps]),gcOverlappingGaps=stats([x['ms'] for x in gaps if x['gc']]) if t else None,noSupportedOverlapGaps=stats([x['ms'] for x in gaps if not(x['gc'] or x['deopt'] or x['possible'])]) if t else None,gapRelations=[x for x in gaps if x['gc'] or x['deopt'] or x['possible']] if t else None))
 summary.append(dict(job=job.name,phases=cells,releaseNodes=60,staticPairChecksPerCleanup=60*59,staticPairChecksFor2400Cleanups=60*59*2400))
result=dict(scope='retained 28800 samples only; zero new capture',sourceIndexDigest=hashlib.sha256((root/'artifact-index.json').read_bytes()).hexdigest(),claims='GC-overlapping gap totals are entire mixed gap durations, not GC pause attribution; no event durations added/subtracted. Pair-check count follows frozen cleanup source and preflight topology, not a runtime counter.',jobs=summary)
(out/'analysis.json').write_text(json.dumps(result,indent='\t')+'\n')
for row in summary:
 measured=[x for x in row['phases'] if x['phase']=='measured'];c=sum(x['construction']['totalMs'] for x in measured);g=sum(x['gaps']['totalMs'] for x in measured)
 print(row['job'],round(c,2),round(g,2),round(g/(c+g)*100,2),'gap%')
 if '-T-' in row['job']:
  count=sum(x['gcOverlappingGaps']['n'] for x in measured);gg=sum(x['gcOverlappingGaps']['totalMs'] for x in measured);no=sum(x['noSupportedOverlapGaps']['totalMs'] for x in measured)
  print('  GC-overlapping gaps',count,'of1794; entire mixed gap ms',round(gg,2),'other no-overlap ms',round(no,2))
