"""Seal qualified inputs/tooling; create invalid example only, never dispatch."""
import pathlib,json,hashlib,shutil
H=pathlib.Path(__file__).resolve().parent;R=H/'prepared'
assert not (R/'frozen.json').exists()
for n in ['collect.py','verify.py','continuity.py','driver.mjs','child.mjs']:shutil.copyfile(H/n,R/'tools'/n)
# Original build/source proofs retained unchanged; PLAN now points to approved single-process design.
shutil.copyfile(H.parent/'dependency-measurement-design/README.md',R/'tools/PLAN.md')
assets={str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(R.rglob('*')) if p.is_file()}
(R/'frozen.json').write_text(json.dumps({'assets':assets,'consumerExecutions':0,'captureAuthorized':False},indent=2)+'\n')
digest=hashlib.sha256((R/'frozen.json').read_bytes()).hexdigest()
(H/'approval.example.json').write_text(json.dumps({'action':'one single-version dependency comparison','preparedDigest':digest,'children':32,'samples':3840,'retries':0,'executionRoot':str(R.resolve()),'exampleOnly':True},indent=2)+'\n')
print(json.dumps({'assets':len(assets),'preparedDigest':digest,'realConsumerExecutions':0,'captureAuthorized':False}))
