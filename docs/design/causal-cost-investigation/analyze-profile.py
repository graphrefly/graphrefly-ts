"""Read retained allocation profile only; disjoint selfSize attribution, no consumer."""
from pathlib import Path
import json, hashlib, collections
root=Path(__file__).resolve().parents[3]
p=root/'docs/design/causal-release-allocation-v1/profile.json'
receipt=json.loads((p.parent/'receipt.json').read_text())
assert hashlib.sha256(p.read_bytes()).hexdigest()==receipt['artifacts'][str(p.relative_to(root))]
profile=json.loads(p.read_text())['profile']
stages=collections.Counter(); callers=collections.Counter(); nodes=0

def walk(node, stack, stage='outside'):
    global nodes
    nodes+=1
    frame=node['callFrame']; name=frame['functionName']; chain=stack+[name]
    if name.endswith('Stage'):stage=name
    size=node['selfSize'];stages[stage]+=size
    # The nearest dataKey ancestor partitions its complete subtree, including native allocations.
    positions=[i for i,n in enumerate(chain) if n=='dataKey']
    label='outside-dataKey'
    if positions:
        i=positions[-1];label=chain[i-1] if i else 'root'
    callers[label]+=size
    for child in node['children']:walk(child,chain,stage)
walk(profile['head'],[])
total=sum(stages.values());assert total==sum(callers.values())
expected=json.loads((p.parent/'summary.json').read_text());assert total==expected['sampledAllocationBytes'] and dict(stages)==expected['stages']
print(json.dumps({'profileSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'profileNodes':nodes,'estimatedAllocatedBytes':total,'stageBytes':dict(stages),'dataKeyImmediateCallerBytes':dict(callers.most_common()),'dataKeyImmediateCallerPercent':{k:round(v/total*100,3) for k,v in callers.most_common()},'partitionConserved':True,'newConsumerInstances':0,'performanceSamples':0},indent=2))
