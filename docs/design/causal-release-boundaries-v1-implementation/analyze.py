"""Retained-data report only; never imports a consumer or collector."""
import json,csv
from pathlib import Path
root=Path(__file__).parent
v=json.loads((root/'independent-verification.json').read_text());assert v['evidenceValid']
rows=v['rows'];totals=[];comparisons=[]
for row in rows:
    for phase in ['warmup','measured']:
        segments=[s for s in row['segments'] if s['name'].endswith(phase)]
        outer={k:sum(s['segments'][k]['sumMs'] for s in segments) for k in segments[0]['segments']}
        total=dict(position=row['position'],cell=row['cell'],phase=phase,outer=outer,constructionMs=sum(s['constructionMs'] for s in segments),phaseElapsedMs=sum(s['phaseElapsedMs'] for s in segments),residualMs=sum(s['residualMs'] for s in segments))
        if 'releaseSegments' in segments[0]:
            internal={k:sum(s['releaseSegments'][k]['sumMs'] for s in segments) for k in segments[0]['releaseSegments']}
            total['releaseSegments']=internal;total['releaseShares']={k:x/outer['group-release'] for k,x in internal.items()}
        totals.append(total)
for half in [0,1]:
    group=[r for r in rows if half*4<=r['position']<(half+1)*4]
    for o in ['U','V']:
        selected={r['cell'][0]:r for r in group if r['cell'].endswith(o)}
        if set(selected)!={'D','R'}:continue
        d,r=selected['D'],selected['R']
        for i in range(12):
            db,rb=d['blocks'][i],r['blocks'][i];ds,rs=d['segments'][i],r['segments'][i]
            comparisons.append(dict(passIndex=half,orientation=o,phase=db['name'],Dposition=d['position'],Rposition=r['position'],Dp50=db['p50'],Rp50=rb['p50'],Dp95=db['p95'],Rp95=rb['p95'],p50Ratio=rb['p50']/db['p50'],p95Ratio=rb['p95']/db['p95'],DconstructionMs=db['sumMs'],RconstructionMs=rb['sumMs'],DreleaseMs=ds['segments']['group-release']['sumMs'],RreleaseMs=rs['segments']['group-release']['sumMs'],DreleaseP95=ds['segments']['group-release']['p95'],RreleaseP95=rs['segments']['group-release']['p95'],releaseP95Ratio=rs['segments']['group-release']['p95']/ds['segments']['group-release']['p95']))
(root/'analysis.json').write_text(json.dumps(dict(status=v['status'],totals=totals,comparisons=comparisons,performanceQualification=False,causalConstructionAttribution=False),indent=2)+'\n')
if comparisons:
    with (root/'matched-comparisons.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(comparisons[0]),lineterminator='\n');w.writeheader();w.writerows(comparisons)
for t in totals:
    if t['cell'][0]=='R' and t['phase']=='measured':print(t['position'],t['releaseSegments'],t['releaseShares'])
for half in [0,1]:
    c=[c for c in comparisons if c['passIndex']==half and c['phase'].endswith('measured')]
    if c:print('pass',half,'construction p95 R/D',min(x['p95Ratio'] for x in c),max(x['p95Ratio'] for x in c),'release p95',min(x['releaseP95Ratio'] for x in c),max(x['releaseP95Ratio'] for x in c))
