"""Synthetic non-unit-ratio clocks only, no consumer or capture permission."""
import importlib.util
from pathlib import Path
s=importlib.util.spec_from_file_location('fixture',Path(__file__).with_name('causal-workload-verifier.test.py'))
f=importlib.util.module_from_spec(s);s.loader.exec_module(f)
def fixture(condition,orientation):
    samples,diag=f.fixture('CPU',orientation)
    factor={'EAGER':2,'DEFERRED':1}[condition]
    for sample in samples:
        sample['start']/=10;sample['ms']=factor*.2;sample['end']=sample['start']+sample['ms']
        sample.update(constructionMs=0,preparationMs=0,preparationSteps=[],actionSteps=[],memoryBefore={'rss':123},memoryAfter={'rss':456})
    for cp in diag['checkpoints']:
        cp['wallBefore']=cp['wallBefore']/10+.2;cp['wallAfter']=cp['wallAfter']/10+.2
    first,last=diag['checkpoints'][0],diag['checkpoints'][-1]
    begin=dict(edge='begin',wallBefore=0,wallAfter=0,user=0,system=0)
    def finish(edge,n):return dict(edge=edge,wallBefore=last['wallAfter']+n,wallAfter=last['wallAfter']+n+.1,user=last['user']+n*1000,system=last['system']+n*2000)
    cps=[begin,finish('end',100)] if condition=='EAGER' else [begin,finish('flushBegin',10),finish('flushEnd',190),finish('end',200)]
    return samples,diag,dict(condition=condition,checkpoints=cps)
