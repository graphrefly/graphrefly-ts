"""Independent current D169 replay; imports historical verifier, never collector."""
import hashlib,importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('v',Path(__file__).with_name('verify-causal-position-pairs.py'));v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def verify(root):
 root=Path(root);idx=read(root/'artifact-index.json')['files']
 for p,h in idx.items():assert (root/p).resolve().is_relative_to(root.resolve()) and sha(root/p)==h,p
 assert set(idx)=={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!='artifact-index.json'}
 r=read(root/'reservation.json');b=read(root/'current-binding.json');result=read(root/'result.json')
 assert sha(root/'current-binding.json')==r['binding'] and sha(root/'qualification.log')==r['qualification']
 for p,h in b['sources'].items():assert sha(root/'source'/p)==h,p
 for p,key in [('worker.mjs','bundle'),('worker-copy.mjs','bundle'),('position.mjs','position'),('P2-inputs.json','fixture')]:assert sha(root/p)==b[key],p
 entropy=bytes.fromhex(r['entropyHex']);bits=[(x>>s)&1 for x in entropy for s in range(8)];cells=v.planned(bits);assert cells==r['schedule'] and bits==r['orderBits']
 assert result['error'] is None and 0<result['elapsed']<=900 and result['consumerPerformanceQualification'] is False
 rows=[];pairs=[];panels=[];pids=set()
 for cell in cells[:len(result['rows'])]:
  name=f"{cell['position']:02d}-{cell['panel']}-{cell['pair']:02d}-{cell['orientation']}";d=root/name;historical=Path(r['executionRoot'])/name
  assert read(d/'config.json')==v.expected_config(historical,cell) and (d/'entry.mjs').read_text()==v.expected_entry(historical,cell)
  e=read(d/'exit.json');m=read(d/'worker.json');assert e['exitCode']==0 and e['childError'] is None and not e['cleanupErrors'] and e['wakeError'] is None
  assert e['wakeBefore']==e['wakeAfter']==r['wake'] and 0<e['endMonotonic']-e['startMonotonic']<=30
  assert abs(e['endWall']-e['startWall']-(e['endMonotonic']-e['startMonotonic']))<=1
  assert m['pid']==e['pid'] and e['pid'] not in pids;pids.add(e['pid'])
  assert read(d/'preflight.json')['passed'] is True and read(d/'completion.json')==dict(completed=True,samples=2400)
  samples=[json.loads(l) for l in (d/'samples.jsonl').read_text().splitlines()];rows.append(dict(**cell,**v.raw_summary(samples,cell['orientation'])))
  if len(rows)%2==0:pairs.append(v.pair_result(rows[-2:]))
  if len(rows)%40==0:panels.append(v.panel_result(pairs[-20:],cell['panel']))
 assert rows==result['rows'] and pairs==result['pairs'] and panels==result['panels']
 assert len(rows)==(80 if panels[0]['passed'] else 40) and result['attempted']==list(range(len(rows))) and result['notRun']==list(range(len(rows),80))
 assert result['samples']==len(rows)*2400
 return dict(verified=True,methodQualified=len(panels)==2 and all(p['passed'] for p in panels),consumerQualified=False,samples=result['samples'],panels=panels)
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
