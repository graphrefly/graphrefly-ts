"""Read-only closeout evidence binding; no tests, consumers or measurements."""
import json,pathlib,hashlib,subprocess,tarfile
ROOT=pathlib.Path(__file__).resolve().parents[3]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
x=next(json.loads(l) for l in (ROOT/'plan/work.jsonl').read_text().splitlines() if json.loads(l).get('id')=='CAUSAL-PRESET-ASSEMBLY-TS')
refs=[]
for e in x['evidence_refs']:
 if ':' in e['ref'] or 'causal-assembly-closeout-review/' in e['ref']:continue
 p=ROOT/e['ref'];refs.append({'path':e['ref'],'exists':p.is_file(),'matches':p.is_file() and 'sha256:'+digest(p)==e['digest']})
paths=['packages/ts','scripts','examples','biome.json','package.json','pnpm-lock.yaml']
diff=git('diff','--name-only','9c30967c','HEAD','--',*paths).splitlines();dirty=git('diff','--name-only','HEAD','--',*paths).splitlines()
archive=ROOT/'archive/evals/causal-dependency-initialization-v1';idx=json.loads((archive/'artifact-index.json').read_text());assert digest(archive/'evidence.tar.gz')==idx['archive_sha256']
with tarfile.open(archive/'evidence.tar.gz') as t:
 for e in idx['files']:
  raw=t.extractfile(e['path']).read();assert hashlib.sha256(raw).hexdigest()==e['sha256']
source=json.loads((ROOT/'docs/design/causal-cost-investigation/dependency-initialization-implementation/source-binding.json').read_text())
assert all(digest(ROOT/e['path'])==e['after_sha256'] for e in source['source'])
soak=json.loads((ROOT/'docs/design/causal-cost-investigation/soak-timeout-audit/source-binding.json').read_text());assert all(digest(ROOT/n)==h for n,h in soak.items())
print(json.dumps({'sourceBaseline':git('rev-parse','9c30967c'),'sourceScope':paths,'committedChangesSinceLastBehaviorQualification':diff,'uncommittedChangesInScope':dirty,'candidateArchiveFilesVerified':len(idx['files']),'currentFactoryAndGeneratedRunnerMatch':True,'soakRetestBindingsMatch':True,'fileEvidenceReferences':refs,'qualifiedRefsNotExpandedByFileAudit':[e['ref'] for e in x['evidence_refs'] if ':' in e['ref']],'testsRun':0,'consumerExecutions':0,'doesNotAssertHistoricalEnvironmentRequalification':True},indent=2))
