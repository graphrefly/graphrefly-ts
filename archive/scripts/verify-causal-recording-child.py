"""Independent recording boundary arithmetic; preserves original child sample checks."""
import importlib.util
import json
from pathlib import Path
import sys
spec=importlib.util.spec_from_file_location('workload',Path(__file__).with_name('verify-causal-workload-diagnostic.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
require=base.require
number=base.number

def delta(a,b):
    return dict(elapsedLowerMs=b['wallBefore']-a['wallAfter'],elapsedUpperMs=b['wallAfter']-a['wallBefore'],
                userMs=(b['user']-a['user'])/1000,systemMs=(b['system']-a['system'])/1000)

def verify(samples, diagnostic, recording):
    require(diagnostic['condition']=='CPU','CPU checkpoint condition')
    result=base.verify(samples,diagnostic)
    require(set(recording)=={'condition','checkpoints'},'recording fields')
    c=recording['condition'];require(c in ('EAGER','DEFERRED'),'recording condition')
    cps=recording['checkpoints']
    edges=['begin','end'] if c=='EAGER' else ['begin','flushBegin','flushEnd','end']
    require(len(cps)==len(edges),'whole/flush boundaries')
    previous=None
    for cp,edge in zip(cps,edges):
        require(set(cp)=={'edge','wallBefore','wallAfter','user','system'} and cp['edge']==edge,'boundary fields/order')
        for k in ('wallBefore','wallAfter'): base.number(cp[k],k)
        for k in ('user','system'): base.integer(cp[k],k)
        require(cp['wallBefore']<=cp['wallAfter'],'boundary bracket')
        if previous:
            require(previous['wallAfter']<=cp['wallBefore'],'whole chronological')
            require(all(previous[k]<=cp[k] for k in ('user','system')),'whole CPU monotonic')
        previous=cp
    first,last=diagnostic['checkpoints'][0],diagnostic['checkpoints'][-1]
    require(cps[0]['wallAfter']<=first['wallBefore'],'whole begins before warmup')
    finish=cps[1]
    require(last['wallAfter']<=finish['wallBefore'],'output follows final cleanup/checkpoint')
    for k in ('user','system'):
        require(cps[0][k]<=first[k]<=last[k]<=finish[k],'CPU encloses sequence')
    # Cold records contain only fresh value snapshots; reject unexpected aliases/content shape.
    for s in samples:
        require(s['constructionMs']==0 and s['preparationMs']==0,'cold costs')
        require(s['preparationSteps']==[] and s['actionSteps']==[],'cold arrays')
        require('recoveryDataCounts' not in s,'cold recovery absent')
        for k in ('memoryBefore','memoryAfter'):
            require(isinstance(s[k],dict),'memory snapshot')
            for v in s[k].values(): base.number(v,'memory value')
    result.update(condition=c,whole=delta(cps[0],cps[-1]),
                  flush=None if c=='EAGER' else delta(cps[1],cps[2]))
    return result

if __name__=='__main__':
    root=Path(sys.argv[1]); print(json.dumps(verify([json.loads(s) for s in (root/'samples.jsonl').read_text().splitlines()],
        json.loads((root/'diagnostic.json').read_text()),json.loads((root/'recording.json').read_text())),allow_nan=False))
