"""Replay both complete profile maps and compare scope/counts; timings remain descriptive."""
import hashlib,importlib.util,json,statistics,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('profile_verifier',Path(__file__).with_name('verify-causal-coverage-profile.py'));v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
def audit(before,after):
 before,after=Path(before),Path(after);read=lambda p:json.loads(p.read_text())
 checks=[v.verify(p) for p in [before,after]]
 bf,af=[read(p/'freeze.json') for p in [before,after]]
 assert bf['inputs']==af['inputs'] and bf['limits']==af['limits']
 assert set(bf['sources'])==set(af['sources'])
 changed=sorted(p for p in bf['sources'] if bf['sources'][p]!=af['sources'][p])
 assert changed==['packages/ts/src/solutions/causal-occurrence/evidence.ts','packages/ts/src/solutions/causal-occurrence/identity.ts'],changed
 old,new=[read(p/'result.json')['results'] for p in [before,after]];rows=[];matched=0
 for a,b in zip(old,new):
  assert a['row']==b['row'] and a['semantic']==b['semantic']
  arms=[]
  for x,y in zip(a['arms'],b['arms']):
   assert x['arm']==y['arm'] and len(x['observations'])==len(y['observations'])
   for m,n in zip(x['observations'],y['observations']):
    assert m['totalInvokes']==n['totalInvokes'],b['row']['id']
    if m['nodes'] is not None:
     assert set(m['nodes'])==set(n['nodes'])
     assert {k:v['invokes'] for k,v in m['nodes'].items()}=={k:v['invokes'] for k,v in n['nodes'].items()},b['row']['id']
    matched+=1
   def summary(obs):
    result={k:statistics.median(z[k] for z in obs) for k in ['constructMs','preparationMs','ms']}
    result['constructMs']=obs[0]['constructMs']
    result['heapUsedDeltaBytes']=[z['memoryAfter']['heapUsed']-z['memoryBefore']['heapUsed'] for z in obs]
    result['rssAfterMiB']=[z['memoryAfter']['rss']/1024**2 for z in obs]
    return result
   arms.append({'arm':x['arm'],'before':summary(x['observations']),'after':summary(y['observations'])})
  rows.append({'row':b['row'],'arms':arms})
 assert matched==696
 return {'verified':True,'formalQualification':False,'rows':84,'preflightsPerRun':84,'matchedInvocationObservations':matched,'changedSources':changed,'beforeProcess':{k:checks[0][k] for k in ['elapsed','maxProcessRSSMiB']},'afterProcess':{k:checks[1][k] for k in ['elapsed','maxProcessRSSMiB']},'memoryCaveat':'single process RSS and uncollected heap deltas; not retained heap, no per-graph attribution or qualified memory improvement','timingCaveat':'one profiled action per cold/steady row; 20 recovery cycles; cross-run descriptive comparison, not paired p95 acceptance','results':rows}
if __name__=='__main__':print(json.dumps(audit(*sys.argv[1:3]),indent=2))
