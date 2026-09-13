"""Independent first-use sample integrity and scope audit."""
import hashlib,json,math,statistics,sys
from pathlib import Path

def verify(root):
 root=Path(root);sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();read=lambda p:json.loads(p.read_text())
 idx=read(root/'artifact-index.json')['files']
 assert set(idx)=={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}
 for p,h in idx.items():assert (root/p).resolve().is_relative_to(root.resolve()) and sha(root/p)==h
 f=read(root/'first-freeze.json');a=read(root/'attempt.json');assert a['error'] is None and a['notRun']==[] and len(a['records'])==27 and 0<a['elapsed']<=300 and a['runner']==sha(root/'runner.py')
 assert sha(root/'first.mjs')==f['bundle'] and f['limits']==dict(childSeconds=60,totalSeconds=300)
 for p,h in f['sources'].items():assert sha(root/'source'/p)==h
 for p,h in f['inputs'].items():assert sha(root/(p+'-inputs.json'))==h
 expected=[];orders=[['candidate','reference','plain'],['reference','plain','candidate'],['plain','candidate','reference']]
 for profile in ['P1','P3','P6']:
  for repeat in range(3):
   for arm in orders[repeat]:expected.append(dict(id=len(expected),profile=profile,repeat=repeat,arm=arm))
 assert f['jobs']==expected;pids=set();origins=set();results=[]
 for j,e in zip(expected,a['records']):
  assert e['id']==j['id'] and e['code']==0 and 0<e['elapsed']<=60;x=read(root/f"first-{j['id']}.json");assert x['job']==j and x['profiler'] is False and x['formalQualification'] is False and x['preflightAfterTiming'] is True
  assert x['businessCheckedAfterTiming']==(j['arm']!='plain') and x['pid'] not in pids and x['timeOrigin'] not in origins;pids.add(x['pid']);origins.add(x['timeOrigin'])
  assert all(math.isfinite(x[k]) and x[k]>=0 for k in ['totalMs','constructionMs','processingMs']) and abs(x['totalMs']-x['constructionMs']-x['processingMs'])<1e-7
  results.append(x)
 summary=[]
 for profile in ['P1','P3','P6']:
  for arm in ['candidate','reference','plain']:
   xs=[x for x in results if x['job']['profile']==profile and x['job']['arm']==arm]
   summary.append(dict(profile=profile,arm=arm,totalMs=[x['totalMs'] for x in xs],medianMs=statistics.median(x['totalMs'] for x in xs)))
 return dict(verified=True,formalQualified=False,processes=27,elapsed=a['elapsed'],scope='first API use in separate processes; no preflight before clock; process/module startup excluded',summary=summary)
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
