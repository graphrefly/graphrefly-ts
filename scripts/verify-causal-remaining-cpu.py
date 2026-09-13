"""Independent CPU sample structure, caller attribution and artifact integrity audit."""
import collections,hashlib,json,sys
from pathlib import Path

def verify(root):
 root=Path(root);read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 idx=read(root/'artifact-index.json')['files'];assert set(idx)=={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}
 for p,h in idx.items():assert (root/p).resolve().is_relative_to(root.resolve()) and sha(root/p)==h
 f=read(root/'freeze.json');a=read(root/'attempt.json');assert a['error'] is None and not a['notRun'] and len(a['records'])==4 and 0<a['elapsed']<=600
 assert f['actionsPerJob']==5 and f['intervalUs']==500 and f['childSeconds']==120 and f['totalSeconds']==600
 jobs=[dict(id=i,recipe=recipe,repeat=repeat) for i,(recipe,repeat) in enumerate((recipe,repeat) for recipe in ['duplicate2','verification'] for repeat in range(2))];assert f['jobs']==jobs
 for p,h in f['files'].items():assert sha(root/p)==h
 results=[];pids=set()
 for job,rec in zip(jobs,a['records']):
  assert rec['job']==job and rec['exitCode']==0 and 0<rec['elapsed']<=120
  x=read(root/f"job-{job['id']}.json");assert x['job']==job and x['preflight'] and x['stateChecks'] and x['formalQualified'] is False and len(x['profiles'])==5 and x['pid'] not in pids;pids.add(x['pid'])
  locations=collections.Counter();counts=collections.Counter();inclusive=collections.Counter();paths=collections.Counter();total=0;elapsed=0
  for i,entry in enumerate(x['profiles']):
   assert entry['index']==i and 0<entry['elapsedMs']<120000;elapsed+=entry['elapsedMs'];p=entry['profile'];nodes={n['id']:n for n in p['nodes']};assert len(nodes)==len(p['nodes']);parents={}
   for n in nodes.values():
    for c in n.get('children',[]):assert c in nodes and c not in parents;parents[c]=n['id']
   assert len(p['samples'])==len(p['timeDeltas'])>0 and all(v>=0 for v in p['timeDeltas']) and sum(p['timeDeltas'])<=p['endTime']-p['startTime']+1000
   for sample in p['samples']:
    assert sample in nodes;total+=1;frame=nodes[sample]['callFrame'];name=frame['functionName'] or f"anonymous:{frame['lineNumber']+1}";counts[name]+=1;locations[json.dumps({k:frame[k] for k in ['functionName','url','lineNumber','columnNumber']},sort_keys=True)]+=1
    chain=[];seen=set();cur=sample
    while True:
     assert cur not in seen;seen.add(cur);cf=nodes[cur]['callFrame'];chain.append(cf['functionName'] or f"anonymous:{cf['lineNumber']+1}")
     if cur not in parents:break
     cur=parents[cur]
    inclusive.update(sorted(set(chain)))
    if name in ['sortedJsonValue','stableJsonString','canonicalMaterial','stringify','materialDigest','encodeMaterial','hash','same'] or 'JSON' in name:paths[' > '.join(chain[:8])]+=1
  results.append(dict(job=job,samples=total,profiledActionMs=elapsed,topSelf=counts.most_common(20),topSelfLocations=[dict(frame=json.loads(k),samples=v) for k,v in locations.most_common()],topInclusive=inclusive.most_common(100),serializationPaths=paths.most_common(15)))
 return dict(verified=True,formalQualified=False,scope='Name tables aggregate same-name frames; topSelfLocations preserves URL and zero-based line/column. Unweighted CPU sample counts; inclusive counts overlap; sampling/inspector overhead included, not exact CPU-time percentages.',jobs=results)
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
