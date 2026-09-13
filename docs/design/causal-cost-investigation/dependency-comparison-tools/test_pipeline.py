from fake_runtime import *
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp)/'run';shutil.copytree(BASE,root);freeze_fixture(root)
 clock=Clock();collect.time=clock;continuity.time=clock;collect.subprocess=Subprocess();collect.wake=lambda:'same wake'
 assert collect.capture(root)
 v=inspect(root);assert v['completed']==48 and v['samples']==6720 and report(v)['formalAcceptance'] is False
 assert len(list((root/'jobs').iterdir()))==48
 print('PIPELINE_QUALIFIED actual collector48fakechildren/6720fakesamples; zero consumers')
# Isolated guard failures; points are retained even on rejection.
for failure in ['sleep','reverse','gap','deadline']:
 clock=Clock();continuity.time=clock;guard=continuity.Continuity();guard.record('start');guard.record('child:0')
 if failure=='sleep':clock.time=lambda:1005
 elif failure=='reverse':clock.now=-1
 elif failure=='gap':clock.now=2
 else:clock.now=901
 try:guard.record('child:0');raise AssertionError(failure)
 except ValueError:assert len(guard.points)==3
print('CONTINUITY_QUALIFIED four rejected clock cases')
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp)/'run';root.mkdir();put(root/'frozen.json',{'assets':{}});approval=pathlib.Path(temp)/'approval.json'
 put(approval,{})
 try:collect.authorize(root,approval);raise AssertionError('wrong approval')
 except ValueError:pass
 put(approval,{'action':'one dependency initialization comparison','preparedDigest':sha((root/'frozen.json').read_bytes()),'children':48,'samples':6720,'retries':0,'executionRoot':str(root.resolve())})
 collect.authorize(root,approval)
 try:collect.authorize(root,approval);raise AssertionError('reused approval')
 except FileExistsError:pass
print('AUTHORIZATION_QUALIFIED wrong and reused approval rejected; no capture dispatch')

with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp)/'run';root.mkdir();put(root/'frozen.json',{'assets':{}})
 approval=pathlib.Path(temp)/'approval.json';put(approval,{'action':'one dependency initialization comparison','preparedDigest':sha((root/'frozen.json').read_bytes()),'children':48,'samples':6720,'retries':0,'executionRoot':str(root.resolve())})
 other=pathlib.Path(temp)/'other/run';other.parent.mkdir();shutil.copytree(root,other)
 try:collect.authorize(other,approval);raise AssertionError('copied execution root')
 except ValueError:pass
 collect.authorize(root,approval);duplicate=pathlib.Path(temp)/'duplicate.json';shutil.copy(approval,duplicate)
 try:collect.authorize(root,duplicate);raise AssertionError('copied approval')
 except FileExistsError:pass
print('AUTHORIZATION_QUALIFIED copied root and copied approval rejected')
