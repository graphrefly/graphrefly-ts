"""Extract and replay archived diagnostics; no new performance execution."""
import hashlib,json,subprocess,tarfile,tempfile,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
archive=ROOT/'archive/evals/causal-performance-completion-v1'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
tmp=Path(tempfile.mkdtemp(prefix='causal-completion-replay-',dir=ROOT/'.tmp'))
try:
 with tarfile.open(archive/'evidence.tar.gz') as tar:
  for m in tar.getmembers():assert (tmp/m.name).resolve().is_relative_to(tmp) and not m.issym() and not m.islnk()
  tar.extractall(tmp,filter='data')
 files=json.loads((archive/'artifact-index.json').read_text())['files']
 assert set(files)=={str(p.relative_to(tmp)) for p in tmp.rglob('*') if p.is_file()}
 for p,h in files.items():assert sha(tmp/p)==h,p
 checks=[]
 for tool,name,record in [
  ('verify-causal-position-current.py','causal-position-current-v2/run','causal-position-current-v2/verification.json'),
  ('verify-causal-coverage-profile.py','causal-coverage-profile-current-v2/run','causal-coverage-profile-current-v2/verification.json'),
  ('audit-causal-performance-coverage.py','causal-performance-coverage-current-v1/run','causal-performance-coverage-current-v1/partial-audit.json'),
  ('audit-causal-performance-coverage.py','causal-performance-coverage-current-v2/run','causal-performance-coverage-current-v2/partial-audit.json'),
  ('audit-causal-action-cpu.py','causal-action-cpu-current-v1','causal-action-cpu-current-v1/verification.json')]:
  r=subprocess.run(['python3',str(ROOT/'scripts'/tool),str(tmp/name)],capture_output=True,text=True,timeout=60)
  assert r.returncode==0,(tool,r.stderr)
  assert json.loads(r.stdout)==json.loads((tmp/record).read_text()),tool
  checks.append({'tool':tool,'evidence':name,'matched':True})
 r=subprocess.run(['node',str(ROOT/'scripts/check-causal-selection-batch-probe.mjs'),str(tmp/'causal-steady-profile-current-v1/run/entry.mjs'),str(tmp/'causal-selection-batch-probe-v1/run/entry.mjs'),str(tmp/'causal-steady-profile-current-v1/run/P1-inputs.json')],capture_output=True,text=True,timeout=30)
 assert r.returncode==0,r.stderr
 checks.append({'tool':'check-causal-selection-batch-probe.mjs','passed':True,'result':json.loads(r.stdout)})
 print(json.dumps({'verified':True,'files':len(files),'archiveSha256':sha(archive/'evidence.tar.gz'),'indexSha256':sha(archive/'artifact-index.json'),'checks':checks,'formalConsumerQualified':False},indent=2))
finally:shutil.rmtree(tmp)
