"""Independent structural audit and self-sample attribution; no timing qualification."""
import collections, hashlib, json, sys
from pathlib import Path

def verify(root):
 root=Path(root); read=lambda p:json.loads(p.read_text()); sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 freeze=read(root/'freeze.json'); attempt=read(root/'attempt.json')
 assert attempt['complete'] and len(attempt['records'])==len(freeze['jobs'])==4
 assert 0<attempt['elapsed']<=freeze['maxSecondsTotal']
 for p,h in freeze['files'].items():assert sha(root/p)==h,p
 results=[]
 for job,record in zip(freeze['jobs'],attempt['records']):
  assert record['job']==job and record['code']==0 and 0<record['elapsed']<=freeze['maxSecondsPerJob']
  name=f"{job['profile']}-{job['dataCount']}.json"; data=read(root/name)
  assert data['repeats']==job['repeats'] and data['row']['profile']==job['profile'] and data['row']['dataCount']==job['dataCount']
  assert data['formalQualification'] is False and 0<data['elapsed']<record['elapsed']*1000
  for k,p in [('workerDigest','worker.mjs'),('toolDigest','tool.mjs'),('inputDigest',job['profile']+'-inputs.json')]:assert data[k]==sha(root/p)
  profile=data['profile']; nodes={n['id']:n for n in profile['nodes']}; assert len(nodes)==len(profile['nodes'])
  samples=profile['samples']; deltas=profile['timeDeltas']; assert len(samples)==len(deltas)>0 and all(x>=0 for x in deltas)
  assert profile['endTime']>profile['startTime'] and sum(deltas)<=profile['endTime']-profile['startTime']+1000
  parents={}
  for n in nodes.values():
   for child in n.get('children',[]):assert child in nodes and child not in parents; parents[child]=n['id']
  counts=collections.Counter(); paths=collections.Counter()
  for sample in samples:
   assert sample in nodes
   fn=nodes[sample]['callFrame']['functionName']; counts[fn]+=1
   if fn in ['sortedJsonValue','stableJsonString']:
    chain=[]; seen=set(); current=sample
    while current in parents:
     assert current not in seen; seen.add(current); current=parents[current]; frame=nodes[current]['callFrame']; chain.append(frame['functionName'] or f"anonymous:{frame['lineNumber']+1}")
    paths[' > '.join(chain[:8])]+=1
  results.append(dict(file=name,sha256=sha(root/name),samples=len(samples),elapsedMs=data['elapsed'],topSelfSamples=counts.most_common(15),canonicalJsonSamples=counts['sortedJsonValue']+counts['stableJsonString'],canonicalJsonFraction=(counts['sortedJsonValue']+counts['stableJsonString'])/len(samples),topCanonicalAncestors=paths.most_common(10)))
 return dict(verified=True,formalQualification=False,scope='sample counts, not exact CPU-time percentages; inspector overhead included',jobs=results)
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
