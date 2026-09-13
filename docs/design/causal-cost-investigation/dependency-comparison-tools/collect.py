"""Single-use, bounded collector. Independent verifier precedes every next child."""
import hashlib,json,os,pathlib,secrets,signal,subprocess,sys,time
from verify import inspect
from continuity import Continuity
ROOT=pathlib.Path(__file__).resolve().parents[1]
def sha(b):return hashlib.sha256(b).hexdigest()
def put(p,x):
 with p.open('x') as f:json.dump(x,f,separators=(',',':'),allow_nan=False);f.write('\n')
def wake():return subprocess.check_output(['/usr/sbin/sysctl','-n','kern.waketime'],timeout=2).decode().strip()
def reason(e):return str(e) or type(e).__name__
def capture(root,prepared_digest=None):
 start=time.monotonic();completed=0;dispatched=0;failure=None;clock=Continuity()
 try:
  clock.record('start')
  frozenBytes=(root/'frozen.json').read_bytes();frozen=json.loads(frozenBytes)
  if prepared_digest is None:prepared_digest=sha(frozenBytes)
  if sha(frozenBytes)!=prepared_digest:raise ValueError('approved preparation drift')
  python=json.loads((root/'python-runtime.json').read_text())
  if python!={'executable':sys.executable,'sha256':sha(pathlib.Path(sys.executable).read_bytes()),'version':sys.version}:raise ValueError('Python runtime drift')
  env={'PATH':os.environ['PATH'],'LANG':'C','TZ':'UTC'}
  runtime=json.loads(subprocess.check_output(['node','-e','console.log(JSON.stringify({node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,execPath:process.execPath}))'],env=env,timeout=5))
  runtime['executableDigest']=sha(pathlib.Path(runtime['execPath']).read_bytes())
  for file,digest in json.loads((root/'build-tools.json').read_text()).items():
   if sha(pathlib.Path(file).read_bytes())!=digest:raise ValueError('build tool drift')
  bits=json.loads((root/'order-bits.json').read_text());schedule=[]
  for ri,row in enumerate(['P2-lifecycle','inactive-1']):
   for pair in range(6):
    for rep in range(2):
     for variant in (['U','V'] if bits[ri*12+pair*2+rep]==0 else ['V','U']):schedule.append({'id':len(schedule),'row':row,'pair':pair,'rep':rep,'variant':variant,'kind':'control' if pair in (0,5) else 'main'})
  assets={**frozen['assets'],'frozen.json':prepared_digest}
  r={'originalRoot':str(root),'preparedDigest':prepared_digest,'assets':assets,'bits':bits,'schedule':schedule,'runtime':runtime,'environment':env,'wake':wake(),'budget':{'children':48,'samples':6720,'warmup':20,'measured':50,'rssBytes':268435456,'childSeconds':30,'seconds':900,'retries':0},'continuity':{'clockSkewSeconds':.5,'childObservationGapSeconds':1}}
  put(root/'reservation.json',r);(root/'continuity.json').write_text(json.dumps(clock.points));reservationHash=sha((root/'reservation.json').read_bytes());(root/'jobs').mkdir()
 except (Exception,KeyboardInterrupt) as e:
  put(root/'initialization-failure.json',{'completed':0,'dispatched':0,'notRun':list(range(48)),'failure':reason(e),'retries':0})
  print('CAPTURE_DONE initialization failure '+reason(e),flush=True);return False

 try:
  for j in schedule:
   clock.record("before-job")
   if sha((root/'reservation.json').read_bytes())!=reservationHash:raise ValueError('reservation drift')
   inspect(root,completed)
   if sha(pathlib.Path(runtime['execPath']).read_bytes())!=runtime['executableDigest']:raise ValueError('runtime drift')
   if wake()!=r['wake']:raise ValueError('wake drift')
   clock.record('before-spawn')
   d=root/'jobs'/f"{j['id']:02d}";d.mkdir();modules=['B.mjs','B-copy.mjs' if j['kind']=='control' else 'C.mjs']
   put(d/'entry.json',{**j,'modules':modules,'moduleDigests':{m:sha((root/m).read_bytes()) for m in modules},'inputDigest':sha((root/'P2-inputs.json').read_bytes())})
   dispatched+=1;child=None;err=None;rss=[];begin=time.monotonic();wallBegin=time.time();before=None
   try:
    before=wake();clock.record('child:'+str(j['id']))
    with (d/'stdout.log').open('xb') as out,(d/'stderr.log').open('xb') as stderr:
     child=subprocess.Popen([runtime['execPath'],str(root/'tools/child.mjs'),str(d/'entry.json')],env=env,stdout=out,stderr=stderr,start_new_session=True)
     while child.poll() is None:
      clock.record('child:'+str(j['id']))
      if max(time.monotonic()-begin,time.time()-wallBegin)>30:raise ValueError('child deadline')
      q=subprocess.run(['/bin/ps','-o','rss=','-p',str(child.pid)],capture_output=True,text=True,timeout=2)
      if q.returncode==0 and q.stdout.strip():
       size=int(q.stdout.strip())*1024;rss.append([time.monotonic()-begin,size])
       if size>268435456:raise ValueError('RSS guard')
      elif child.poll() is None:raise ValueError('RSS observation failed')
      time.sleep(.1)
     clock.record('child:'+str(j['id']))
     if child.returncode!=0:raise ValueError('child failure')
   except (Exception,KeyboardInterrupt) as e:err=reason(e)
   finally:
    if child is not None:
     try:
      if child.poll() is None:
       try:os.killpg(child.pid,signal.SIGKILL)
       except ProcessLookupError:pass
      child.wait(timeout=5)
     except (Exception,KeyboardInterrupt) as e:err=(err+'; ' if err else '')+'cleanup unconfirmed: '+reason(e)
    try:after=wake()
    except (Exception,KeyboardInterrupt) as e:after=None;err=(err+'; ' if err else '')+'wake check: '+reason(e)
    if before!=r['wake'] or after!=r['wake']:err=err or 'wake drift'
    if not rss:err=err or 'missing RSS observations'
    put(d/'exit.json',{'pid':child.pid if child else None,'code':child.returncode if child else None,'seconds':max(time.monotonic()-begin,time.time()-wallBegin),'failure':err,'rss':rss,'wakeBefore':before,'wakeAfter':after})
   (root/'continuity.json').write_text(json.dumps(clock.points))
   if err:raise ValueError(err)
   v=inspect(root,completed+1)
   clock.record('after-verification')
   put(root/f"verified-{completed+1:02d}.json",{'passed':v['passed'],'completed':v['completed'],'samples':v['samples'],'maxRssBytes':v['maxRssBytes']});completed+=1
   print(json.dumps({'completed':completed,'total':48,'row':j['row']}),flush=True)
 except (Exception,KeyboardInterrupt) as e:failure=reason(e)
 finally:
  try:
   clock.record('finish')
   if wake()!=r['wake']:raise ValueError('wake drift')
  except (Exception,KeyboardInterrupt) as e:failure=failure or reason(e)
  (root/'continuity.json').write_text(json.dumps(clock.points))
  put(root/'result.json',{'completed':completed,'dispatched':dispatched,'notRun':list(range(dispatched,48)),'failure':failure,'seconds':max(time.monotonic()-start,time.time()-clock.points[0]['wall']),'reservationDigest':reservationHash,'retries':0})
 print('CAPTURE_DONE '+json.dumps({'completed':completed,'failure':failure}),flush=True)
 return failure is None
def authorize(root,approval):
 frozen=json.loads((root/'frozen.json').read_text())
 expected={'action':'one dependency initialization comparison','preparedDigest':sha((root/'frozen.json').read_bytes()),'children':48,'samples':6720,'retries':0,'executionRoot':str(root.resolve())}
 if json.loads(approval.read_text())!=expected:raise ValueError('exact approval required')
 for f,h in frozen['assets'].items():
  if sha((root/f).read_bytes())!=h:raise ValueError('prepared drift '+f)
 if any((root/f).exists() for f in ['reservation.json','result.json','initialization-failure.json','jobs']):raise ValueError('already dispatched')
 put(root.resolve().parent/'capture-claim.json',{'approvalDigest':sha(approval.read_bytes()),'preparedDigest':expected['preparedDigest']})
 return expected['preparedDigest']
if __name__=='__main__':
 signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt('SIGTERM')))
 if len(sys.argv)!=3 or sys.argv[1]!='--approval':raise SystemExit('explicit --approval PATH required')
 prepared_digest=authorize(ROOT,pathlib.Path(sys.argv[2]));sys.exit(0 if capture(ROOT,prepared_digest) else 1)
