"""Read-only descriptive tables from independently verified evidence; no capture or consumer import."""
import csv,json,sys
from pathlib import Path
from collections import Counter
p=Path(__file__).resolve().parent
v=json.loads((p/'independent-verification.json').read_text())
assert v['evidenceValid'] and v['status']=='complete-diagnostic' and v['samples']==28800
root=Path(sys.argv[1]);runs=[];comparisons=[];coverage=[]
for row in v['rows']:
    d={k:row[k] for k in ('position','cell')};d['pass']=row['position']//6;d['phases']={}
    for phase in ('warmup','measured'):
        b=[r for r in row['blocks'] if r['name'].endswith(phase)];c=[r for r in row['cpu'] or [] if r['name'].endswith(phase)]
        values=dict(p50=[x['p50'] for x in b],p95=[x['p95'] for x in b],constructionMs=sum(x['constructionMs'] for x in b),withinPhaseGapMs=sum(x['withinPhaseGapMs'] for x in b))
        if c:values.update({k:sum(x[k] for x in c) for k in ('T','P','Wlo','Whi','Wpoint','unaccountedElapsed','processMinusThread')})
        d['phases'][phase]=values
    runs.append(d)
    if row['cell'][0]=='T':
        job=root/f"{row['position']:02d}-{row['cell']}";t=json.loads((job/'report.json').read_text())['trace'];ev=json.loads((job/'evidence.json').read_text());raw=[json.loads(s) for s in (job/'samples.jsonl').read_text().splitlines()]
        lo=int(ev['anchors'][0]['h'])//1000;hi=(int(ev['anchors'][2]['h'])+999)//1000
        counts={n:dict(total=sum(e['name']==n for e in t['events']),insideAnchorCoverage=sum(e['name']==n and lo<=e['start']<=e['end']<=hi for e in t['events'])) for n in t['categories']}
        by={}
        for phase in ('warmup','measured'):
            by[phase]={name:{status:sum(any(e['name']==name and rel[j]==status for j,e in enumerate(t['events'])) for sample,rel in zip(raw,t['sampleRelations']) if sample['phase']==phase) for status in ('overlap','possible','unknown')} for name in t['categories']}
        coverage.append(dict(job=job.name,categories=t['categories'],events=counts,backgroundRecords=len(t['backgroundRefs']),unclassifiedRecords=len(t['unclassifiedRefs']),samplesWithRelationship=by,meaning='Distinct samples per category/status; counts can overlap. unknown means at least one event is outside anchor coverage, not that all other associations of that sample are unknown. No exclusive-pause or causal attribution.'))
for pas in range(2):
    for orient in ('U','V'):
        by={r['cell'][0]:r for r in v['rows'] if r['position']//6==pas and r['cell'][-1]==orient}
        for block in range(12):
            r=dict(passIndex=pas,orientation=orient,phase=by['B']['blocks'][block]['name'])
            for left,right in [('Q','B'),('T','Q')]:
                a,b=by[left]['blocks'][block],by[right]['blocks'][block]
                r[left+'/'+right]=dict(p50Ratio=a['p50']/b['p50'],p95Ratio=a['p95']/b['p95'],constructionMsDifference=a['constructionMs']-b['constructionMs'],withinPhaseGapMsDifference=a['withinPhaseGapMs']-b['withinPhaseGapMs'])
            comparisons.append(r)
analysis=dict(status='complete-unresolved',performanceQualification=False,runs=runs,matchedComparisons=comparisons,aggregation='p50/p95 arrays retain all six individual blocks in execution order; totals sum six disjoint phases of the same warmup/measured class; no warmup/measured pooling or CPU allocation')
for name,value in [('analysis.json',analysis),('event-coverage.json',coverage)]: (p/name).write_text(json.dumps(value,indent='\t')+'\n')
with (p/'matched-comparisons.csv').open('w',newline='') as f:
    writer=csv.writer(f,lineterminator='\n');writer.writerow(['pass','orientation','phase','comparison','p50Ratio','p95Ratio','constructionMsDifference','withinPhaseGapMsDifference'])
    for c in comparisons:
        for pair in ('Q/B','T/Q'):writer.writerow([c['passIndex'],c['orientation'],c['phase'],pair,*c[pair].values()])
lines=['| 顺序 | 模式 | 六个 measured block 的原始 p95（µs） | 构造合计 ms | 间隔合计 ms | T / P / Wpoint 合计 ms |','|---:|---|---|---:|---:|---|']
for r in runs:
    a=r['phases']['measured'];cpu=' / '.join(f'{a[k]:.2f}' for k in ('T','P','Wpoint')) if 'T' in a else '未采 CPU'
    lines.append(f"| {r['position']} | {r['cell']} | {', '.join(f'{x*1000:.1f}' for x in a['p95'])} | {a['constructionMs']:.2f} | {a['withinPhaseGapMs']:.2f} | {cpu} |")
lines.extend(['','原始 p95 按 batch 0 slot 0/1 → batch 1 slot 0/1 → batch 2 slot 0/1 列出，未取单一“新 p95”。间隔只统计同阶段相邻原样本之间的混合时间；含记录、cleanup、让出等，未拆成独占成本。','', '| pass | 阶段 | Q/B p95 比范围（全部 12 个匹配坐标） | T/Q p95 比范围 |','|---|---|---|---|'])
for pas in range(2):
    for phase in ('warmup','measured'):
        selected=[x for x in comparisons if x['passIndex']==pas and x['phase'].endswith(phase)]
        ranges=[' – '.join(f'{fun(x[pair]["p95Ratio"] for x in selected):.4f}' for fun in (min,max)) for pair in ('Q/B','T/Q')]
        lines.append(f'| {pas} | {phase} | {ranges[0]} | {ranges[1]} |')
(p/'tables.md').write_text('\n'.join(lines)+'\n')
print('CPU_DIAGNOSTIC_DESCRIPTIVE_ANALYSIS_DONE',len(runs),len(comparisons),'coordinates, zero new samples')
