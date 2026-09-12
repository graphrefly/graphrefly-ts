"""Synthetic evidence/arithmetic negative tests. Zero consumer executions."""
import copy,hashlib,json,pathlib,shutil,tempfile
from verify import inspect,report,phases,percentile,sha
HERE=pathlib.Path(__file__).resolve().parent
BASE=HERE.parents[3]/'archive/evals/causal-currentness-comparison-v1/run'
def put(p,x):p.write_text(json.dumps(x,separators=(',',':'))+'\n')
assert phases([1,2,3,5,6,9,10,14])=={'construction':1,'initial':2,'duplicate':3,'cleanup':4,'actionSum':10,'wall':13,'residual':3}
assert percentile(list(range(1,51)),.95)==48
for x in [[2,1],[0,float('nan')],[0,float('inf')]]:
 try:phases(x);raise AssertionError('invalid clocks accepted')
 except ValueError:pass
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp)/'run';shutil.copytree(BASE,root);(root/'jobs').mkdir();bits=[0]*24;schedule=[]
 for row in ['P2-lifecycle','inactive-1']:
  for pair in range(6):
   for rep in range(2):
    for variant in ['U','V']:schedule.append({'id':len(schedule),'row':row,'pair':pair,'rep':rep,'variant':variant,'kind':'control' if pair in (0,5) else 'main'})
 runtime={'node':'test','v8':'test','platform':'test','arch':'test','execPath':'/test/node'}
 assets={str(p.relative_to(root)):sha(p.read_bytes()) for p in root.rglob('*') if p.is_file()}
 r={'assets':assets,'bits':bits,'schedule':schedule,'runtime':runtime,'environment':{'PATH':'/test','LANG':'C','TZ':'UTC'},'wake':'test','originalRoot':str(root),'budget':{'children':48,'samples':6720,'warmup':20,'measured':50,'rssBytes':268435456,'childSeconds':30,'seconds':900,'retries':0}}
 put(root/'reservation.json',r);assert inspect(root,0)['passed']
 for j in schedule:
  d=root/'jobs'/f"{j['id']:02d}";d.mkdir();modules=['B.mjs','B-copy.mjs' if j['kind']=='control' else 'C.mjs'];e={**j,'modules':modules,'moduleDigests':{m:sha((root/m).read_bytes()) for m in modules},'inputDigest':sha((root/'P2-inputs.json').read_bytes())};put(d/'entry.json',e)
  pid=100+j['id'];put(d/'identity.json',{**runtime,'pid':pid,'entryDigest':sha((d/'entry.json').read_bytes()),'env':r['environment'],'argv':['/test/node',str(root/'tools/child.mjs'),str(d/'entry.json')]})
  put(d/'completion.json',{'completed':True,'samples':140,'pid':pid});put(d/'exit.json',{'pid':pid,'code':0,'seconds':.3,'failure':None,'rss':[[.01,1024],[.11,2048],[.21,1024]],'wakeBefore':'test','wakeAfter':'test'})
  pre={'instances':14,'checks':[{'cold':{'passed':True},'steady':{'passed':True}}]*2,'expected':[{},{}],'expectedJSON':['{}','{}']} if j['row']=='P2-lifecycle' else {'instances':2,'checks':[{'passed':True,'instances':1}]*2,'expected':[None,None],'expectedJSON':[None,None]};put(d/'preflight.json',pre)
  records=[]
  for pos in range(2):
   slot=(pos+(j['variant']=='V'))%2;factor=.5 if j['kind']=='main' and slot==1 else 1
   for index in range(70):
    clocks=[x*factor+index*20 for x in ([1,2,3,5,6,9,10,14] if j['row']=='P2-lifecycle' else [1,2])]
    records.append({'block':0,'position':pos,'slot':slot,'index':index,'phase':'warmup' if index<20 else 'measured','clocks':clocks,'outcome':'released','releaseCompleted':True,'before':1,'after':1,'snapshotDigest':sha(b'{}') if j['row']=='P2-lifecycle' else None})
  (d/'samples.jsonl').write_text(''.join(json.dumps(s)+'\n' for s in records))
 put(root/'result.json',{'completed':48,'dispatched':48,'notRun':[],'failure':None,'seconds':50,'reservationDigest':sha((root/'reservation.json').read_bytes()),'retries':0})
 v=inspect(root);rep=report(v);assert rep['rows']['P2-lifecycle']['duplicate']['mainMedianRange']==[.5,.5];assert all(m['label']=='observed consistent decrease' for row in rep['rows'].values() for m in row.values())
 flipped=copy.deepcopy(v)
 for block in flipped['blocks']:
  if block['kind']=='main' and block['position']==1 and block['slot']==1:
   for m in block['metrics'].values():m['p95']*=4
 assert report(flipped)['rows']['P2-lifecycle']['duplicate']['label']=='mixed/inconclusive'
 unstable=copy.deepcopy(v)
 for block in unstable['blocks']:
  if block['kind']=='control' and block['slot']==1:
   for m in block['metrics'].values():m['p95']*=2
 assert report(unstable)['rows']['P2-lifecycle']['duplicate']['label']=='control-unstable/inconclusive'
 zero=copy.deepcopy(v);zero['blocks'][0]['metrics']['construction']['p95']=0
 try:report(zero);raise AssertionError('zero ratio accepted')
 except ValueError:pass
 rejected=[]
 def mutation(name,path,change,jsonl=False):
  p=root/path;original=p.read_bytes();x=[json.loads(l) for l in p.read_text().splitlines()] if jsonl else json.loads(original);change(x)
  p.write_text(''.join(json.dumps(z)+'\n' for z in x) if jsonl else json.dumps(x))
  try:
   try:inspect(root)
   except (ValueError,KeyError):rejected.append(name)
   else:raise AssertionError('survived '+name)
  finally:p.write_bytes(original)
 mutation('terminal-retries','result.json',lambda x:x.update(retries=1))
 mutation('terminal-notrun','result.json',lambda x:x.update(notRun=[47]))
 mutation('terminal-deadline','result.json',lambda x:x.update(seconds=901))
 mutation('terminal-reservation','result.json',lambda x:x.update(reservationDigest='bad'))
 mutation('slots','jobs/00/entry.json',lambda x:x.update(modules=['C.mjs','B.mjs']))
 mutation('runtime-env','jobs/00/identity.json',lambda x:x['env'].update(SECRET='notallowed'))
 mutation('empty-preflight','jobs/00/preflight.json',lambda x:x.update(checks=[]))
 mutation('expected-json','jobs/00/preflight.json',lambda x:x.update(expectedJSON=['[]','[]']))
 mutation('snapshot','jobs/00/samples.jsonl',lambda x:x[20].update(snapshotDigest='wrong'),True)
 mutation('slot-coordinate','jobs/00/samples.jsonl',lambda x:x[20].update(slot=1),True)
 mutation('missing-sample','jobs/00/samples.jsonl',lambda x:x.pop(),True)
 mutation('warmup','jobs/00/samples.jsonl',lambda x:x[20].update(phase='warmup'),True)
 mutation('clock-order','jobs/00/samples.jsonl',lambda x:x[20].update(clocks=[8,7,6,5,4,3,2,1]),True)
 mutation('cleanup','jobs/00/samples.jsonl',lambda x:x[20].update(releaseCompleted=False),True)
 mutation('rss-over','jobs/00/exit.json',lambda x:x.update(rss=[[.01,268435457]]))
 mutation('rss-time','jobs/00/exit.json',lambda x:x.update(rss=[[1,1024]]))
 mutation('rss-order','jobs/00/exit.json',lambda x:x.update(rss=[[.2,1024],[.1,1024]]))
 mutation('wake','jobs/00/exit.json',lambda x:x.update(wakeAfter='other'))
 (root/'jobs/48').mkdir()
 try:inspect(root);raise AssertionError('hidden job accepted')
 except ValueError:rejected.append('hidden-job')
 (root/'jobs/48').rmdir()
 # Final failure remains inspectable; no complete-comparison label may be issued.
 for d in list((root/'jobs').iterdir()):
  if d.name!='00':shutil.rmtree(d)
 p=root/'jobs/00/exit.json';x=json.loads(p.read_text());x.update(code=-9,failure='RSS guard');put(p,x)
 put(root/'result.json',{'completed':0,'dispatched':1,'notRun':list(range(1,48)),'failure':'RSS guard','seconds':1,'reservationDigest':sha((root/'reservation.json').read_bytes()),'retries':0})
 v=inspect(root);assert v['failedJob']['samples']==140 and v['failure']=='RSS guard'
print(json.dumps({'passed':True,'syntheticSamples':6720,'realConsumerExecutions':0,'rejectedMutations':rejected,'failureReplay':True}))
