"""Independent current D169 replay; imports historical verifier, never collector."""
import hashlib,importlib.util,json,sys,subprocess
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
 for name in ['verify-causal-position-current.py','verify-causal-position-pairs.py','verify-causal-block-history.py','verify-causal-control-crossover.py']:
  assert sha(Path(__file__).with_name(name))==b['sources']['scripts/'+name],'executing verifier binding'
 assert r['sourceVerifier']==sha(Path(__file__))
 assert r['limits']==dict(processes=80,samples=192000,childSeconds=30,totalSeconds=900,retries=0)
 q=read(root/'qualification.log');assert q['passed'] is True and q['manifest']==b['derivation'] and q['staticNegatives']==23 and len(q['loadedCases'])==23 and all(x['passed'] for x in q['loadedCases']) and q['loadedSourceMutants']==9
 for name,binding in b['copied'].items():
  original=(root/'source/scripts'/name).read_text();assert hashlib.sha256(original.encode()).hexdigest()==binding['original']
  expected=original
  if name in ['derive-causal-block-driver.mjs','check-causal-position-source.mjs']:expected=expected.replace('d9d8606d73e1bcfad66097f027d63c99fc409571042c5f1e7efffaa645356fb2',b['bundle'])
  actual=(root/name).read_text();assert sha(root/name)==binding['bound']
  if 'from "typescript"' in expected:
   import re
   match=re.search(r'from ("file:[^"]+/typescript/lib/typescript.js")',actual);assert match,'parser import'
   expected=expected.replace('from "typescript"','from '+match[1])
  assert expected==actual,'only current bundle/parser rebinding allowed'
 checked=subprocess.run([r['node'],str(root/'check-causal-position-source.mjs'),str(root/'worker.mjs'),str(root/'position.mjs')],capture_output=True,text=True,timeout=15);assert checked.returncode==0,checked.stderr
 for p,key in [('worker.mjs','bundle'),('worker-copy.mjs','bundle'),('position.mjs','position'),('P2-inputs.json','fixture')]:assert sha(root/p)==b[key],p
 entropy=bytes.fromhex(r['entropyHex']);assert len(entropy)==5;bits=[(x>>s)&1 for x in entropy for s in range(8)];cells=v.planned(bits);assert cells==r['schedule'] and bits==r['orderBits']
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
  rows.append(v.verify_job(d,cell,Path(r['executionRoot'])))
  if len(rows)%2==0:pairs.append(v.pair_result(rows[-2:]))
  if len(rows)%40==0:panels.append(v.panel_result(pairs[-20:],cell['panel']))
 assert rows==result['rows'] and pairs==result['pairs'] and panels==result['panels']
 assert len(rows)==(80 if panels[0]['passed'] else 40) and result['attempted']==list(range(len(rows))) and result['notRun']==list(range(len(rows),80))
 assert result['samples']==len(rows)*2400
 assert result['status']==('method-qualified' if len(panels)==2 and all(p['passed'] for p in panels) else 'method-not-qualified')
 assert {p.parent.name for p in root.rglob('dispatch.json')}=={f"{c['position']:02d}-{c['panel']}-{c['pair']:02d}-{c['orientation']}" for c in cells[:len(rows)]}
 return dict(verified=True,methodQualified=len(panels)==2 and all(p['passed'] for p in panels),consumerQualified=False,samples=result['samples'],panels=panels)
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
