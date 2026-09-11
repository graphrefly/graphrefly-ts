"""Report retained verified coordinates; no consumer import or dispatch."""
import json,csv,sys
from pathlib import Path
root=Path(__file__).parent
v=json.loads((root/'independent-verification.json').read_text());assert v['evidenceValid']
rows=v['rows'];comparisons=[];totals=[]
for row in rows:
    if not row['segments']:continue
    for phase in ['warmup','measured']:
        blocks=[x for x in row['segments'] if x['name'].endswith(phase)]
        sums={k:sum(x['segments'][k]['sumMs'] for x in blocks) for k in blocks[0]['segments']}
        total=dict(position=row['position'],cell=row['cell'],phase=phase,segments=sums,residualMs=sum(x['residualMs'] for x in blocks),phaseElapsedMs=sum(x['phaseElapsedMs'] for x in blocks),constructionMs=sum(x['constructionMs'] for x in blocks))
        total['outerNonConstructionMs']=total['phaseElapsedMs']-total['constructionMs']
        total['cleanupFractionOfOuterNonConstruction']=sums['cleanup']/total['outerNonConstructionMs']
        if 'group-release' in sums:total['releaseFractionOfCleanup']=sums['group-release']/sums['cleanup']
        totals.append(total)
for half in [0,1]:
    group=rows[half*6:(half+1)*6]
    for orientation in ['U','V']:
        selected={x['cell'][0]:x for x in group if x['cell'].endswith(orientation)}
        for n in range(12):
            b,s,d=[selected[k]['blocks'][n] for k in 'BSD']
            comparisons.append(dict(passIndex=half,orientation=orientation,phase=b['name'],Bposition=selected['B']['position'],Sposition=selected['S']['position'],Dposition=selected['D']['position'],Bp50=b['p50'],Sp50=s['p50'],Dp50=d['p50'],Bp95=b['p95'],Sp95=s['p95'],Dp95=d['p95'],Sp50overB=s['p50']/b['p50'],Dp50overS=d['p50']/s['p50'],Sp95overB=s['p95']/b['p95'],Dp95overS=d['p95']/s['p95'],BconstructionMs=b['sumMs'],SconstructionMs=s['sumMs'],DconstructionMs=d['sumMs']))
result=dict(totals=totals,comparisons=comparisons,performanceQualification=False,causalConstructionAttribution=False)
(root/'analysis.json').write_text(json.dumps(result,indent=2)+'\n')
with (root/'matched-comparisons.csv').open('w') as f:
    w=csv.DictWriter(f,fieldnames=list(comparisons[0]));w.writeheader();w.writerows(comparisons)
for half in [0,1]:
    r=[x for x in comparisons if x['passIndex']==half and x['phase'].endswith('measured')]
    print('pass',half,'S/B p95 range',min(x['Sp95overB'] for x in r),max(x['Sp95overB'] for x in r),'D/S',min(x['Dp95overS'] for x in r),max(x['Dp95overS'] for x in r))
print('deep measured')
for t in totals:
    if t['cell'].startswith('D') and t['phase']=='measured':print(t['position'],t['releaseFractionOfCleanup'],t['cleanupFractionOfOuterNonConstruction'])
