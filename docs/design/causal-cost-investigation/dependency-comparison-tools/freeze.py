"""Seal reviewed tooling/assets and write an example grant; never dispatch."""
import hashlib,json,pathlib,shutil,subprocess,sys
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE/'prepared';REPO=HERE.parents[3]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
for n in ['collect.py','verify.py','continuity.py','PLAN.md']:shutil.copyfile(HERE/n,ROOT/'tools'/n)
put(ROOT/'python-runtime.json',{'executable':sys.executable,'sha256':sha(pathlib.Path(sys.executable)),'version':sys.version})
changed=subprocess.check_output(['git','diff','--name-only','8253488b','9c30967c','--','packages/ts'],cwd=REPO,text=True).splitlines()
assert changed==['packages/ts/runners/local-untrusted-js/local-untrusted-js-runner.mjs','packages/ts/src/node/core.ts']
put(ROOT/'production-change-scope.json',{'changedPaths':changed,'handwritten':'packages/ts/src/node/core.ts','generatedArtifactExcludedFromBundle':changed[0],'B':'8253488bd7458a8f6caeb31e79fa04e4f870c77b','C':'9c30967c8953ae09aa8de5949e0fbdd6de3c4813'})
assert not (ROOT/'frozen.json').exists()
assets={str(p.relative_to(ROOT)):sha(p) for p in sorted(ROOT.rglob('*')) if p.is_file()}
put(ROOT/'frozen.json',{'assets':assets,'consumerExecutions':0,'captureAuthorized':False})
put(HERE/'approval.example.json',{'action':'one dependency initialization comparison','preparedDigest':sha(ROOT/'frozen.json'),'children':48,'samples':6720,'retries':0,'executionRoot':str(ROOT.resolve()),'exampleOnly':True})
print(json.dumps({'frozenAssets':len(assets),'preparedDigest':sha(ROOT/'frozen.json'),'consumerExecutions':0,'captureAuthorized':False}))
