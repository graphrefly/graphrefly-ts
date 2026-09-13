"""Loaded collector and adversarial evidence tests. No consumer execution."""
from fake_runtime import *
import itertools,copy,os
from verify import require
rejected=[]
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp)/'run';shutil.copytree(BASE,root);freeze_fixture(root)
 c=Clock();collect.time=c;continuity.time=c;collect.wake=lambda:'same'
 class Runtime(Subprocess):
  def check_output(self,*a,**k):c.now+=.001;return metadata
 collect.subprocess=Runtime()
 assert collect.capture(root)
 v=inspect(root);assert v['completed']==32 and v['samples']==3840
 result=report(v)
 assert all(x['label']=='observed consistent decrease' for m in result['metrics'].values() for x in m.values())
 def corrupt(name,path,change):
  original=path.read_bytes()
  try:
   change(path)
   try:inspect(root)
   except (ValueError,KeyError,TypeError):rejected.append(name)
   else:raise AssertionError('accepted '+name)
  finally:path.write_bytes(original)
 def alter(p,key,value):z=json.loads(p.read_text());z[key]=value;put(p,z)
 job=root/'jobs/00'
 for name,file,key,value in [('projection-arm','projection.json','arm','X'),('slot-path','slot.json','path','elsewhere'),('slot-unreaped','slot.json','childReaped',False),('slot-digest','slot.json','after','wrong'),('wrong-arm','entry.json','arm','X'),('second-module','entry.json','modules',['run-slot/bundle.mjs','C.mjs']),('wrong-argv','identity.json','argv',[]),('node-path','identity.json','execPath','/other/node'),('missing-preflight','preflight.json','checks',[]),('sample-count','completion.json','samples',119),('wrong-PID','completion.json','pid',-1),('rss-limit','exit.json','rss',[[.01,268435457]]),('clock-limit','exit.json','seconds',31)]:
  corrupt(name,job/file,lambda p,k=key,v=value:alter(p,k,v))
 corrupt('projection-bytes',job/'bundle.mjs',lambda p:p.write_bytes(b'wrong'))
 def sample_change(p,key,val):z=[json.loads(l) for l in p.read_text().splitlines()];z[23][key]=val;p.write_text(''.join(json.dumps(x)+'\n' for x in z))
 for name,key,value in [('coordinate','index',99),('clock-reverse','clocks',[2,1,3,4,5,6,7,8]),('occurrence','after',2),('release','releaseCompleted',False),('snapshot','snapshotDigest','wrong'),('warmup','phase','warmup')]:corrupt(name,job/'samples.jsonl',lambda p,k=key,v=value:sample_change(p,k,v))
 for name,key,val in [('not-run','notRun',[31]),('retry','retries',1),('terminal-count','completed',31)]:corrupt(name,root/'result.json',lambda p,k=key,v=val:alter(p,k,v))
 # Center and tail are independent; no metric can upgrade another.
 z=copy.deepcopy(v)
 for b in z['blocks']:
  if b['arm']=='C':
   for m in b['metrics'].values():m['p95']/=.8;m['p95']*=1.2
 rr=report(z);assert rr['metrics']['construction']['p50']['label']=='observed consistent decrease' and rr['metrics']['construction']['p95']['label']=='observed consistent increase'
 z=copy.deepcopy(v);z['blocks'][3]['metrics']['construction']['p95']*=2
 assert report(z)['metrics']['construction']['p95']['label']=='control-unstable/inconclusive'
 z=copy.deepcopy(v);z['blocks'][0]['metrics']['construction']['p95']=0
 try:report(z);raise AssertionError('zero denominator')
 except ValueError:pass
 print('PIPELINE_QUALIFIED 32fakeprocesses/3840fakesamples; mutations='+json.dumps(rejected))
# Explicit claim, wrong/copy/repeated root and approval rejection; never dispatch.
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp)/'run';shutil.copytree(BASE,root);freeze_fixture(root)
 approval=pathlib.Path(tmp)/'approval.json'
 a={'action':'one single-version dependency comparison','preparedDigest':sha((root/'frozen.json').read_bytes()),'children':32,'samples':3840,'retries':0,'executionRoot':str(root.resolve())}
 put(approval,{**a,'exampleOnly':True})
 try:collect.authorize(root,approval);raise AssertionError('example grant')
 except ValueError:pass
 put(approval,a);collect.authorize(root,approval)
 try:collect.authorize(root,approval);raise AssertionError('replay')
 except FileExistsError:pass
 copyroot=pathlib.Path(tmp)/'copy';shutil.copytree(root,copyroot)
 try:collect.authorize(copyroot,approval);raise AssertionError('copy root')
 except ValueError:pass
# Slot cannot be overwritten until owner acknowledges child exit.
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp);(root/'run-slot').mkdir();(root/'B.mjs').write_bytes(b'B');d=root/'job';d.mkdir();s=collect.Slot(root,{'B.mjs':sha(b'B')})
 s.active=types.SimpleNamespace(returncode=None,poll=lambda:None)
 for fn in [lambda:s.stage('B',d),lambda:s.finish(d)]:
  try:fn();raise AssertionError('active slot accepted')
  except ValueError:pass
 assert not (root/'run-slot/bundle.mjs').exists()
for choice in itertools.combinations(range(8),4):
 groups=['BCCB' if i in choice else 'CBBC' for i in range(8)]
 assert all(sum(g[p]=='B' for g in groups)==4 for p in range(4))
print('AUTH_SLOT_SCHEDULE_QUALIFIED 70balancedorders; zero consumers')

for kind in ['skew','reversal','gap','deadline']:
 c=Clock();continuity.time=c;k=continuity.Continuity();k.record('child:0' if kind=='gap' else 'start')
 if kind=='skew':c.time=lambda:1001
 elif kind=='reversal':c.now=-1
 else:c.now=2 if kind=='gap' else 901
 try:k.record('child:0' if kind=='gap' else 'check');raise AssertionError(kind)
 except ValueError:pass
print('CONTINUITY_QUALIFIED four clock rejections')
