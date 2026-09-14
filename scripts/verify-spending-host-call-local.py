"""Recompute retained prototype/control comparisons without executing consumers."""
import hashlib
import json
import math
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
D = ROOT / 'archive/evals/causal-host-call-local/attempt-1'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
m = json.loads((D/'method.json').read_text())
r = json.loads((D/'receipt.json').read_text())
assert sha(D/'method.json') == r['methodSha256']
assert sha(ROOT/'scripts/compare-spending-host-call-local.mjs') == m['scriptSha256']
assert not r['failures'] and not r['sourceChangesDuringRun']
for f in m['sources']:
    assert sha(ROOT/f['path']) == f['sha256']
for f in m['bundles']:
    assert sha(D/f['path']) == f['sha256']
    assert sha(D/f['mapPath']) == f['mapSha256']
assert sha(D/'driver.mjs') == m['driverSha256']
s = (ROOT/m['hostPath']).read_text()
assert sha(ROOT/m['hostPath']) == m['originalHostSha256']
assert s.count(m['anchor']) == 1
assert hashlib.sha256(s.replace(m['anchor'],m['insertion']+m['anchor']).encode()).hexdigest() == m['prototypeHostSha256']
assert len(r['cells']) == 4
assert {(c['mode'],c['comparison']) for c in r['cells']} == {(mode,comparison) for mode in ['off','summary'] for comparison in ['baseline-prototype','baseline-baseline-control']}
assert m['requestsPerLifetime']==64 and m['warmupLifetimesPerArm']==1 and m['measuredLifetimesPerArm']==3
summary = []
for cell in r['cells']:
    assert len(cell['lifetimes']) == 6
    for rep in range(3):
        pair = sorted([x for x in cell['lifetimes'] if x['repetition']==rep],key=lambda x:x['label'])
        assert len(pair) == 2 and pair[0]['witnessSha256'] == pair[1]['witnessSha256']
        assert [x['label'] for x in pair] == (['baseline','prototype'] if cell['comparison']=='baseline-prototype' else ['baseline-A','baseline-B'])
        totals=[]; last8=[]
        for life in pair:
            assert [x['frontier'] for x in life['rows']] == list(range(1,65))
            assert life['final']['writes']==64 and life['final']['records']==64 and life['final']['normalEndReady']
            costs=[x['syncInputMs']+x['completionMs'] for x in life['rows']]
            assert all(math.isfinite(x) and x>=0 for x in costs)
            totals.append(sum(costs));last8.append(sum(costs[-8:])/8)
        summary.append(dict(mode=cell['mode'],comparison=cell['comparison'],repetition=rep,
            labels=[x['label'] for x in pair],totalInputCompletionMs=totals,totalRatio=totals[1]/totals[0],
            last8MeanMs=last8,last8Ratio=last8[1]/last8[0]))
output=ROOT/'docs/design/causal-host-call-local/verification.json'
output.write_text(json.dumps(dict(kind='retained-prototype-independent-verification',
    verifierSha256=sha(Path(__file__)),methodSha256=sha(D/'method.json'),receiptSha256=sha(D/'receipt.json'),
    sourceBindingsVerified=True,compiledBundlesVerified=True,uniqueTransformationVerified=True,
    measuredLifetimesVerified=24,frontierRowsVerified=1536,pairedWitnessesVerified=12,
    productionModified=False,formalQualification=False,comparisons=summary),indent='\t')+'\n')
print('24 lifetimes /1536 rows /12 paired witnesses and source/bundle hashes verified')
