"""Descriptive aggregation of independently verified retained blocks; no execution."""
import hashlib
import json
from pathlib import Path
import statistics

folder=Path(__file__).resolve().parent
raw=(folder/'analysis.json').read_bytes()
x=json.loads(raw)
result={'analysisSha256':hashlib.sha256(raw).hexdigest(),'conditions':{},'contrasts':{},
        'classification':'Mixed: early block CPU activity observed; original extreme tail not reproduced; no single root cause identified.',
        'formalAcceptance':False,'newConsumerExecutions':0}
for condition in ['BASE','CPU','CPU_GC']:
    rows=[b for c in x['children'] if c['analysis']['condition']==condition
          for b in c['analysis']['blocks'] if b['phase']=='measured']
    assert len(rows)==48
    batches=[]
    for batch in range(3):
        selected=[b for b in rows if b['batch']==batch]
        assert len(selected)==16
        batches.append({'batch':batch,'count':16,
            **{k:statistics.median(b[k] for b in selected) for k in ['p95Ms','constructionSumMs','commonSpanMs']},
            'processCpuMsMedian':None if condition=='BASE' else statistics.median(b['checkpoint']['userMs']+b['checkpoint']['systemMs'] for b in selected)})
    result['conditions'][condition]={'p95RangeMs':[min(b['p95Ms'] for b in rows),max(b['p95Ms'] for b in rows)],'batchMedians':batches}
    if condition!='BASE':
        result['conditions'][condition]['cpuExceedsElapsedUpperBlocks']=sum(b['checkpoint']['userMs']+b['checkpoint']['systemMs']>b['checkpoint']['elapsedUpperMs'] for b in rows)
    if condition=='CPU_GC':
        result['conditions'][condition]['observedGcConstructionOverlapMs']=sum(b['gc']['constructionOverlapMs'] for b in rows)
        result['conditions'][condition]['observedGcCommonSpanOverlapMs']=sum(b['gc']['commonSpanOverlapMs'] for b in rows)
for contrast in ['CPU/BASE','CPU_GC/CPU']:
    rows=[r for r in x['ratios'] if r['contrast']==contrast]
    assert len(rows)==48
    result['contrasts'][contrast]={metric:{'min':min(r['ratios'][metric] for r in rows),'median':statistics.median(r['ratios'][metric] for r in rows),'max':max(r['ratios'][metric] for r in rows)} for metric in ['p95Ms','constructionSumMs','commonSpanMs']}
print(json.dumps(result,indent=2,allow_nan=False))
