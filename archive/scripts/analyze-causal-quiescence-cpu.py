"""Attribute samples under dataKey directly parented by recomputeDomain (observed frames)."""
import importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('verify-causal-remaining-cpu.py'));audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
root=Path(sys.argv[1]);audit.verify(root);out=[]
for i in range(4):
 job=json.loads((root/f'job-{i}.json').read_text());total=0;direct=0
 for item in job['profiles']:
  p=item['profile'];nodes={n['id']:n for n in p['nodes']};parent={c:n['id'] for n in nodes.values() for c in n.get('children',[])}
  targets={n['id'] for n in nodes.values() if n['callFrame']['functionName']=='dataKey' and n['id'] in parent and nodes[parent[n['id']]]['callFrame']['functionName']=='recomputeDomain'}
  for sample in p['samples']:
   total+=1;cur=sample
   while True:
    if cur in targets:direct+=1;break
    if cur not in parent:break
    cur=parent[cur]
 out.append(dict(job=job['job'],totalSamples=total,directDataKeySubtreeSamples=direct,share=direct/total))
print(json.dumps({'verifiedInput':True,'scope':'Observed dataKey frames directly parented by recomputeDomain; unweighted subtree samples, not exact time or removable cost. JIT inlining/frame omission limits source attribution.','jobs':out},indent=2))
