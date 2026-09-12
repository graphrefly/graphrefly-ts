"""Partition existing allocation evidence; never run a consumer."""
from pathlib import Path
import json,hashlib,tarfile,collections
root=Path(__file__).resolve().parents[4];d=root/'docs/design/causal-release-allocation-v1'
profile_bytes=(d/'profile.json').read_bytes();receipt=json.loads((d/'receipt.json').read_text());assert hashlib.sha256(profile_bytes).hexdigest()==receipt['artifacts'][str((d/'profile.json').relative_to(root))]
b=root/'archive/evals/causal-release-cost-comparison-v2';idx=json.loads((b/'artifact-index.json').read_text());assert hashlib.sha256((b/'evidence.tar.gz').read_bytes()).hexdigest()==idx['archiveSha256']
with tarfile.open(b/'evidence.tar.gz') as t:bundle=t.extractfile('run/B.mjs').read()
assert hashlib.sha256(bundle).hexdigest()==idx['files']['run/B.mjs']
sections={};source='unknown'
for i,line in enumerate(bundle.decode().splitlines()):
 if line.startswith('// snapshot:'):source=line.removeprefix('// snapshot:')
 sections[i]=source
c=collections.Counter();sources=collections.Counter();total=0

def walk(n,stack,source='outside-bundle'):
 global total
 f=n['callFrame'];chain=stack+[f['functionName']]
 if f['url'].endswith('/B.mjs'):source=sections[f['lineNumber']]
 sites=[i for i,name in enumerate(chain) if name=='dataKey'];caller=chain[sites[-1]-1] if sites and sites[-1]>0 else None
 if caller=='recomputeCurrentness':group='currentness-dataKey'
 elif caller=='recomputeDomain':group='quiescence-dataKey'
 elif 'sameRef' in chain:group='sameRef-subtree'
 elif source=='examples/spending-alerts/causal-publication.ts':group='publication-material-code'
 elif caller or source=='packages/ts/src/solutions/causal-occurrence/identity.ts':group='other-identity-canonicalization'
 elif source=='packages/ts/src/json/codec.ts':group='other-codec'
 else:group='remaining-runtime-consumer-harness'
 size=n['selfSize'];c[group]+=size;total+=size;sources[source]+=size
 for ch in n['children']:walk(ch,chain,source)
walk(json.loads(profile_bytes)['profile']['head'],[])
assert total==sum(c.values())==sum(sources.values())==json.loads((d/'summary.json').read_text())['sampledAllocationBytes']
print(json.dumps({'profileSha256':hashlib.sha256(profile_bytes).hexdigest(),'bundleSha256':hashlib.sha256(bundle).hexdigest(),'estimatedAllocatedBytes':total,'priorityPartition':[{ 'group':k,'bytes':v,'percent':round(v/total*100,3)} for k,v in c.most_common()],'allocationSourceSections':dict(sources.most_common()),'partitionConserved':True,'newConsumerRuns':0,'performanceSamples':0,'limits':'Explicit priority partition, not removable-cost estimate. Inlined/missing frames can move attribution. Native allocations inherit nearest recorded source section. Single B diagnostic only.'},indent=2))
