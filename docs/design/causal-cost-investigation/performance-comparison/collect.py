"""Single-use, bounded collector. Independent verifier precedes every next child."""
import hashlib,json,os,pathlib,secrets,signal,subprocess,sys,time
from verify import inspect
ROOT=pathlib.Path(__file__).resolve().parents[1]
def sha(b):return hashlib.sha256(b).hexdigest()
def put(p,x):
 with p.open('x') as f:json.dump(x,f,separators=(',',':'),allow_nan=False);f.write('\n')
def wake():return subprocess.check_output(['/usr/sbin/sysctl','-n','kern.waketime'],timeout=2).decode().strip()
def capture(root):
 start=time.monotonic();completed=0;dispatched=0;failure=None
 env={'PATH':os.environ['PATH'],'LANG':'C','TZ':'UTC'}
 runtime=json.loads(subprocess.check_output(['node','-e','console.log(JSON.stringify({node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,execPath:process.execPath}))'],env=env,timeout=5))
 runtime['executableDigest']=sha(pathlib.Path(runtime['execPath']).read_bytes())
 for file,digest in json.loads((root/'build-tools.json').read_text()).items():
  if sha(pathlib.Path(file).read_bytes())!=digest:raise ValueError('build tool drift')
 bits=[secrets.randbits(1) for _ in range(24)];schedule=[]
 for ri,row in enumerate(['P2-lifecycle','inactive-1']):
  for pair in range(6):
   for rep in range(2):
    for variant in (['U','V'] if bits[ri*12+pair*2+rep]==0 else ['V','U']):schedule.append({'id':len(schedule),'row':row,'pair':pair,'rep':rep,'variant':variant,'kind':'control' if pair in (0,5) else 'main'})
 assets={str(p.relative_to(root)):sha(p.read_bytes()) for p in sorted(root.rglob('*')) if p.is_file()}
 r={'originalRoot':str(root),'assets':assets,'bits':bits,'schedule':schedule,'runtime':runtime,'environment':env,'wake':wake(),'budget':{'children':48,'samples':6720,'warmup':20,'measured':50,'rssBytes':268435456,'childSeconds':30,'seconds':900,'retries':0}}
 put(root/'reservation.json',r);reservationHash=sha((root/'reservation.json').read_bytes());(root/'jobs').mkdir()
 try:
  for j in schedule:
   if time.monotonic()-start>=900:raise ValueError('attempt deadline')
   if sha((root/'reservation.json').read_bytes())!=reservationHash:raise ValueError('reservation drift')
   inspect(root,completed)
   if sha(pathlib.Path(runtime['execPath']).read_bytes())!=runtime['executableDigest']:raise ValueError('runtime drift')
   if wake()!=r['wake']:raise ValueError('wake drift')
   d=root/'jobs'/f"{j['id']:02d}";d.mkdir();modules=['B.mjs','B-copy.mjs' if j['kind']=='control' else 'C.mjs']
   put(d/'entry.json',{**j,'modules':modules,'moduleDigests':{m:sha((root/m).read_bytes()) for m in modules},'inputDigest':sha((root/'P2-inputs.json').read_bytes())})
   dispatched+=1;child=None;err=None;rss=[];begin=time.monotonic();before=None
   try:
    before=wake()
    with (d/'stdout.log').open('xb') as out,(d/'stderr.log').open('xb') as stderr:
     child=subprocess.Popen([runtime['execPath'],str(root/'tools/child.mjs'),str(d/'entry.json')],env=env,stdout=out,stderr=stderr,start_new_session=True)
     while child.poll() is None:
      if time.monotonic()-start>=900:raise ValueError('attempt deadline')
      if time.monotonic()-begin>30:raise ValueError('child deadline')
      q=subprocess.run(['/bin/ps','-o','rss=','-p',str(child.pid)],capture_output=True,text=True,timeout=2)
      if q.returncode==0 and q.stdout.strip():
       size=int(q.stdout.strip())*1024;rss.append([time.monotonic()-begin,size])
       if size>268435456:raise ValueError('RSS guard')
      elif child.poll() is None:raise ValueError('RSS observation failed')
      time.sleep(.1)
     if child.returncode!=0:raise ValueError('child failure')
   except Exception as e:err=str(e)
   finally:
    if child is not None and child.poll() is None:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
    try:after=wake()
    except Exception as e:after=None;err=str(e)
    if before!=r['wake'] or after!=r['wake']:err=err or 'wake drift'
    if not rss:err=err or 'missing RSS observations'
    put(d/'exit.json',{'pid':child.pid if child else None,'code':child.returncode if child else None,'seconds':time.monotonic()-begin,'failure':err,'rss':rss,'wakeBefore':before,'wakeAfter':after})
   if err:raise ValueError(err)
   v=inspect(root,completed+1)
   if time.monotonic()-start>900:raise ValueError('attempt deadline after verification')
   put(root/f"verified-{completed+1:02d}.json",{'passed':v['passed'],'completed':v['completed'],'samples':v['samples'],'maxRssBytes':v['maxRssBytes']});completed+=1
   print(json.dumps({'completed':completed,'total':48,'row':j['row']}),flush=True)
 except Exception as e:failure=str(e)
 finally:put(root/'result.json',{'completed':completed,'dispatched':dispatched,'notRun':list(range(dispatched,48)),'failure':failure,'seconds':time.monotonic()-start,'reservationDigest':reservationHash,'retries':0})
 print('CAPTURE_DONE '+json.dumps({'completed':completed,'failure':failure}),flush=True)
 return failure is None
if __name__=='__main__':sys.exit(0 if capture(ROOT) else 1)
