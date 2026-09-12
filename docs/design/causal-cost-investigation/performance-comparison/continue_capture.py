"""Single-use, bounded collector. Independent verifier precedes every next child."""
import hashlib,json,os,pathlib,secrets,signal,subprocess,sys,time
from verify_continuation import inspect
ROOT=pathlib.Path(__file__).resolve().parents[1]
def sha(b):return hashlib.sha256(b).hexdigest()
def put(p,x):
 with p.open('x') as f:json.dump(x,f,separators=(',',':'),allow_nan=False);f.write('\n')
def wake():return subprocess.check_output(['/usr/sbin/sysctl','-n','kern.waketime'],timeout=2).decode().strip()
def capture(root):
 meta=json.loads((root/'continuation.json').read_text())
 for file,digest in meta['bindings'].items():
  if sha((root/file).read_bytes())!=digest:raise ValueError('continuation binding drift')
 original=json.loads((root/'result.json').read_text())
 elapsed=time.time()-(root/'result.json').stat().st_mtime+original['seconds']
 if elapsed<original['seconds'] or elapsed>=900:raise ValueError('original deadline unavailable')
 start=time.monotonic()-elapsed;completed=1;dispatched=1;failure=None
 r=json.loads((root/'reservation.json').read_text());runtime=r['runtime'];env=r['environment'];schedule=r['schedule'];reservationHash=sha((root/'reservation.json').read_bytes())
 if original['completed']!=0 or original['dispatched']!=1 or original['failure']!='runtime':raise ValueError('unexpected original stop')
 v=inspect(root,1)
 put(root/'verified-01.json',{'passed':True,'completed':1,'samples':140,'correction':'retained sample; no re-execution'})
 try:
  for j in schedule[1:]:
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
 finally:put(root/'continuation-result.json',{'completed':completed,'dispatched':dispatched,'notRun':list(range(dispatched,48)),'failure':failure,'seconds':time.monotonic()-start,'reservationDigest':reservationHash,'retries':0})
 print('CAPTURE_DONE '+json.dumps({'completed':completed,'failure':failure}),flush=True)
 return failure is None
if __name__=='__main__':sys.exit(0 if capture(ROOT) else 1)
