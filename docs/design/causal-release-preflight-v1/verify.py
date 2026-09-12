from pathlib import Path
import json, hashlib, sys

def verify(root):
    read=lambda n:json.loads((root/n).read_text())
    binding=read('binding.json')
    for name,h in binding['files'].items():
        assert hashlib.sha256((root/name).read_bytes()).hexdigest()==h
    assert read('exit.json')['exitCode']==0
    r=read('result.json')
    assert r['passed'] is True and r['instances']==33 and r['performanceSamples']==0
    assert [x['name'] for x in r['results']]==['B.mjs','C.mjs','B-copy.mjs']
    expected=r['results'][0]['pre']['expected']
    for x in r['results']:
        assert x==read(x['name']+'.result.json') and x['instances']==11
        p=x['pre']; assert p['expected']==expected
        for phase in ['cold','steady']:
            assert p[phase]['passed'] is True and p[phase]['assessments']==1
            assert all(len(p[phase]['topology'][a])==60 for a in ['candidate','reference'])
        assert p['steady']['beforeOccurrences']==p['steady']['afterOccurrences']==1
        assert p['steady']['preWaveNew']==0
        e=x['exact'];assert e['before']==e['after']==1 and e['snapshot']==expected
        assert e['clocks']==[0]*8 and e['outcome']=='released' and e['releaseCompleted'] is True
        assert [m['row'] for m in x['micro']]==['inactive-60','active-diamond-5','inactive-2','inactive-1']
        for m in x['micro']:
            active=m['row']=='active-diamond-5'
            assert m['clocks']==[0,0] and m['releaseCompleted']==(not active)
            assert m['outcome']==('rejected-then-cleaned' if active else 'released')
    return {'passed':True,'modules':3,'instances':33,'performanceSamples':0,'scope':'retained preflight results and bindings; no consumer replay'}
if __name__=='__main__':print(json.dumps(verify(Path(sys.argv[1])),sort_keys=True))
