"""Descriptive summary only, from independently verified frozen recording analysis."""
import json,statistics,sys
from pathlib import Path
analysis=json.loads(Path(sys.argv[1]).read_text());run=Path(sys.argv[2])
def stats(v):return dict(min=min(v),median=statistics.median(v),max=max(v))
ratios=analysis['ratios'];first=[x for x in ratios if x['batch']==0]
metrics=['p50Ms','p95Ms','constructionSumMs','commonSpanMs']
summary=dict(sampleCount=analysis['sampleCount'],measuredBlockCount=analysis['measuredBlockCount'],
 firstBatchConsistent=analysis['consistentFirstBatch'],
 firstBatchLowerCounts={k:sum(x['ratios'][k]<1 for x in first) for k in ['p95Ms','constructionSumMs']},firstBatchPairs=len(first),
 firstBatchRatios={k:stats([x['ratios'][k] for x in first]) for k in metrics},
 allBlockRatios={k:stats([x['ratios'][k] for x in ratios]) for k in metrics},
 wholeRatios={k:stats([x['ratios'][k] for x in analysis['wholePairs'] if x['ratios'][k] is not None]) for k in analysis['wholePairs'][0]['ratios']},
 groups=[])
for c in ['EAGER','DEFERRED']:
 children=[x['analysis'] for x in analysis['children'] if x['analysis']['condition']==c]
 for batch in range(3):
  blocks=[b for x in children for b in x['blocks'] if b['batch']==batch and b['phase']=='measured']
  summary['groups'].append(dict(condition=c,batch=batch,blocks=len(blocks),**{k:stats([b[k] for b in blocks]) for k in metrics},
   checkpointCpuMs=stats([b['checkpoint']['userMs']+b['checkpoint']['systemMs'] for b in blocks])))
 summary[c+'Whole']={k:stats([x['whole'][k] for x in children]) for k in children[0]['whole']}
 if c=='DEFERRED':summary['deferredFlush']={k:stats([x['flush'][k] for x in children]) for k in children[0]['flush']}
result=json.loads((run/'result.json').read_text());obs=[o for x in result['children'] for o in x['result']['observations']]
summary['run']=dict(completed=result['completed'],children=len(result['children']),notRun=len(result['notRun']),lastChildEndedSeconds=result['children'][-1]['result']['endedElapsed'],
 maxObservedRssMiB=max(o['rssBytes'] for o in obs)/1024**2,maxDirectoryMiB=max(o['directoryBytes'] for o in obs)/1024**2,maxGapSeconds=max(o['gap'] for o in obs))
print(json.dumps(summary,indent=2,allow_nan=False))
