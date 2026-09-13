"""Read archived evidence only. Descriptive audit; never execute consumers or alter acceptance."""
import hashlib,json,pathlib,statistics,tarfile
HERE=pathlib.Path(__file__).resolve().parent
REPO=HERE.parents[3]
ARCH=REPO/'archive/evals/causal-dependency-comparison-capture-v1'
idx=json.loads((ARCH/'artifact-index.json').read_text())
raw=(ARCH/idx['archive']).read_bytes()
assert hashlib.sha256(raw).hexdigest()==idx['sha256']
with tarfile.open(ARCH/idx['archive']) as t:
 data={m.name:t.extractfile(m).read() for m in t.getmembers() if m.isfile()}
assert set(data)==set(idx['files'])
for n,e in idx['files'].items():assert hashlib.sha256(data[n]).hexdigest()==e['sha256'] and len(data[n])==e['bytes'],n
v=json.loads(data['evidence/report.json']);blocks=v['absoluteBlocks']
def p95(x):return sorted(x)[47]
def summary(x):return {'min':min(x),'median':statistics.median(x),'max':max(x)}
out={'archiveSha256':idx['sha256'],'verifiedFiles':len(data),'consumerExecutions':0,'postHocDescriptiveOnly':True,'frozenVerdictUnchanged':True,'rows':{},'blocks':[]}
for row in ['P2-lifecycle','inactive-1']:
 bs=[b for b in blocks if b['row']==row];ms=list(bs[0]['metrics']);r={}
 for metric in ms:
  bystat={}
  for stat in ['p95','p50']:
   pairs=[]
   for pair in range(6):
    for pos in range(2):
     ratios=[];ids=[]
     for rep in range(2):
      z=[b for b in bs if b['pair']==pair and b['position']==pos and b['rep']==rep]
      b=next(b for b in z if b['slot']==0);c=next(b for b in z if b['slot']==1)
      ratios.append(c['metrics'][metric][stat]/b['metrics'][metric][stat]);ids.append([b['id'],c['id']])
     pairs.append({'pair':pair,'position':pos,'ratios':ratios,'median':statistics.median(ratios),'processIds':ids,'oppositeDirections':(ratios[0]-1)*(ratios[1]-1)<0})
   controls=[p for p in pairs if p['pair'] in (0,5)];main=[p for p in pairs if p['pair'] not in (0,5)]
   order=[]
   for i in sorted({b['id'] for b in bs if b['kind']=='control'}):
    z=sorted([b for b in bs if b['id']==i],key=lambda b:b['position'])
    order.append({'id':i,'variant':z[0]['variant'],'secondOverFirst':z[1]['metrics'][metric][stat]/z[0]['metrics'][metric][stat]})
   bystat[stat]={'pairs':pairs,'controlMedianRange':summary([p['median'] for p in controls]),'controlSecondOverFirst':order,'mainOppositeRepeatDirections':sum(p['oppositeDirections'] for p in main),'mainBelowOneIndividual':sum(x<1 for p in main for x in p['ratios']),'mainIndividualCount':16}
  r[metric]=bystat
 out['rows'][row]=r
for b in blocks:
 recs=[json.loads(l) for l in data[f"prepared/jobs/{b['id']:02d}/samples.jsonl"].splitlines()]
 recs=[x for x in recs if x['phase']=='measured' and x['position']==b['position']]
 assert len(recs)==50
 values=[x['clocks'][1]-x['clocks'][0] for x in recs];metric='construction' if b['row']=='P2-lifecycle' else 'release'
 assert p95(values)==b['metrics'][metric]['p95']
 assert statistics.median(values)==b['metrics'][metric]['p50']
 out['blocks'].append({**{k:b[k] for k in ['id','row','pair','rep','variant','position','slot','kind']},'metric':metric,'p95':p95(values),'p50':statistics.median(values),'tenSampleMedians':[statistics.median(values[i:i+10]) for i in range(0,50,10)],'topFive':sorted([{'index':x['index'],'milliseconds':y} for x,y in zip(recs,values)],key=lambda x:x['milliseconds'],reverse=True)[:5]})
print(json.dumps(out,indent=2,allow_nan=False))
