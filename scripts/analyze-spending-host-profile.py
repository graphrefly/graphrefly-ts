"""Offline union-of-stack CPU attribution; validates full generated locations and recursion."""
import json
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / 'archive/evals/causal-host-lifetime-cpu/attempt-1'

def aggregate(profile):
    nodes = {n['id']: n for n in profile['nodes']}
    parent = {child: n['id'] for n in nodes.values() for child in n.get('children', [])}
    rows = {}
    total = sum(profile['timeDeltas'])
    assert len(profile['samples']) == len(profile['timeDeltas'])
    for node_id, delta in zip(profile['samples'], profile['timeDeltas']):
        assert delta >= 0
        seen_ids, seen_keys = set(), set()
        leaf = True
        while node_id is not None:
            assert node_id not in seen_ids
            seen_ids.add(node_id)
            f = nodes[node_id]['callFrame']
            key = (f.get('url', ''), f['lineNumber'], f['columnNumber'], f['functionName'])
            row = rows.setdefault(key, dict(url=key[0], generatedLine=key[1]+1,
                generatedColumn=key[2]+1, functionName=key[3], selfUs=0, inclusiveUnionUs=0))
            if leaf:
                row['selfUs'] += delta
            if key not in seen_keys:
                row['inclusiveUnionUs'] += delta
                seen_keys.add(key)
            node_id = parent.get(node_id)
            leaf = False
    assert sum(x['selfUs'] for x in rows.values()) == total
    assert all(x['selfUs'] <= x['inclusiveUnionUs'] <= total for x in rows.values())
    return dict(sampledDeltaUs=total, samples=len(profile['samples']),
                functions=sorted(rows.values(), key=lambda x: -x['selfUs']))

# Recursive frames at identical full locations count once; distinct columns remain distinct.
def node(i, col, children):
    return dict(id=i, callFrame=dict(url='test',lineNumber=4,columnNumber=col,functionName='visit'),children=children)
p = dict(nodes=[node(1,1,[2]),node(2,1,[3]),node(3,9,[])],samples=[2,3],timeDeltas=[3,7])
a = aggregate(p)
assert len(a['functions']) == 2
assert {r['generatedColumn']:r['inclusiveUnionUs'] for r in a['functions']} == {2:10,10:7}
assert {r['generatedColumn']:r['selfUs'] for r in a['functions']} == {2:3,10:7}

method = json.loads((D/'method.json').read_text())
receipt = json.loads((D/'receipt.json').read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(D/'method.json') == receipt['methodSha256']
assert sha(ROOT/'scripts/profile-spending-host-lifetime.mjs') == method['scriptSha256']
assert sha(D/method['bundle']['path']) == method['bundle']['sha256']
assert sha(D/method['bundle']['sourceMapPath']) == method['bundle']['sourceMapSha256']
assert not receipt['failures'] and not receipt['sourceChangesDuringRun']
assert len(receipt['runs']) == 4
for run in receipt['runs']:
    assert sha(D/Path(run['profile']).name) == run['profileSha256']
    assert sha(D/Path(run['attribution']).name) == run['attributionSha256']
    assert run['writes'] == 64 and run['records'] == 64 and run['normalEndReady']

for source in method['sources']:
    assert hashlib.sha256((ROOT/source['path']).read_bytes()).hexdigest() == source['sha256']
results = []
for path in sorted(D.glob('*.cpuprofile')):
    p = json.loads(path.read_text())
    a = aggregate(p)
    original = json.loads(path.with_name(path.stem+'-attribution.json').read_text())
    assert original['sampledDeltaUs'] == a['sampledDeltaUs']
    assert sum(r['selfUs'] for r in original['selfBySource']) == a['sampledDeltaUs']
    # Full generated location permits independent reading against the retained exact bundle.
    results.append(dict(profile=path.name, profileSha256=hashlib.sha256(path.read_bytes()).hexdigest(),**a))
out = dict(kind='corrected-full-location-union-attribution',
    scriptSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    recursiveAndDistinctColumnControlsPassed=True,profileCount=len(results),
    limitations=['Sampled stack weights, not exact elapsed execution time or removable-cost predictions.',
                 'Generated line/column preserved against retained worker; original source-level self totals reused only after conservation checks.',
                 'Raw original inclusiveUs remains historical recursion-weighted attribution; use inclusiveUnionUs for deduplicated ancestry.'],
    methodSha256=hashlib.sha256((D/'method.json').read_bytes()).hexdigest(), profiles=results)
(ROOT/'docs/design/causal-lifetime-profile/corrected-attribution.json').write_text(json.dumps(out,indent='\t')+'\n')
print('Verified 4 raw profiles; self-weight conservation; recursion and column controls pass')
