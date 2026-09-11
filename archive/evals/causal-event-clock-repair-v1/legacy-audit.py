import hashlib,json,subprocess,tarfile,tempfile
from pathlib import Path
root=Path.cwd(); base=root/'archive/evals/causal-event-clock-repair-v1'; prior=root/'archive/evals/causal-performance-repetition-v2'
index=json.loads((prior/'artifact-index.json').read_text())['files']
with tempfile.TemporaryDirectory(prefix='clock-legacy-readonly-') as temp:
 with tarfile.open(prior/'evidence.tar.gz') as tar:
  regular=[m for m in tar.getmembers() if m.isfile()]
  assert len(regular)==len(index)==321
  for m in regular:
   data=tar.extractfile(m).read();assert 'sha256:'+hashlib.sha256(data).hexdigest()==index[m.name]
   path=Path(temp)/m.name;assert Path(temp).resolve() in path.resolve().parents;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
 script='''import {readFileSync,writeFileSync} from 'node:fs';
import {verifyEvidence} from REPLAY;
import {legacyCorrelation} from HELPER;
const dir=process.argv[1], output=process.argv[2];
const verified=verifyEvidence(dir), report=JSON.parse(readFileSync(dir+'/report.json'));
const rows=report.jobs.map(j=>{const p=dir+'/'+j.id;const samples=readFileSync(p+'/samples.jsonl','utf8').trim().split('\\n').map(JSON.parse);const r=legacyCorrelation(samples,readFileSync(p+'/runtime.log','utf8'),readFileSync(p+'/v8.log','utf8'));if(r.samples.some(s=>s.status!=='unknown'||s.gc!==null||s.deopt!==null))throw Error('not unknown');return {job:j.id,totalSamples:samples.length,measuredSamples:r.samples.length,scope:'all measured coordinates in original samples.jsonl',status:'unknown',sources:r.sources};});
writeFileSync(output,JSON.stringify({archiveFilesVerified:321,verified,originalDecision:report.decision,rows},null,2)+'\\n');console.log(JSON.stringify(verified));'''
 script=script.replace('REPLAY',json.dumps((root/'scripts/verify-spending-preset-repetition.mjs').as_uri())).replace('HELPER',json.dumps((root/'scripts/causal-event-correlation.mjs').as_uri()))
 r=subprocess.run(['node','--input-type=module','-e',script,str(Path(temp)/'method-validation'),str(base/'legacy-correction.json')],capture_output=True,text=True)
 (base/'logs/legacy-replay.log').write_text(r.stdout+r.stderr);print('LEGACY_REPLAY_DONE',r.returncode,r.stdout,r.stderr)
 assert r.returncode==0
