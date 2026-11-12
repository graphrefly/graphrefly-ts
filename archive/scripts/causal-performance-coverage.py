"""Bounded diagnostic runner. Frozen schedule; no retries or statistical acceptance."""
import hashlib,json,os,subprocess,sys,time
from pathlib import Path

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x): p.write_text(json.dumps(x,indent=2)+'\n')
def wake(): return subprocess.check_output(['/usr/sbin/sysctl','-n','kern.waketime'],text=True,timeout=3).strip()
def finish(p):
 cleanup=[]
 if p is not None and p.poll() is None:
  try:p.kill()
  except BaseException as e:cleanup.append(repr(e))
  try:p.wait(timeout=3)
  except BaseException as e:cleanup.append(repr(e))
 after=None;wake_error=None
 try:after=wake()
 except BaseException as e:wake_error=repr(e)
 return cleanup,after,wake_error
def run(root):
 root=Path(root).resolve(); f=json.loads((root/'freeze.json').read_text()); assert not (root/'reservation.json').exists()
 assert not any(os.environ.get(k) for k in ['NODE_OPTIONS','NODE_COMPILE_CACHE','NODE_V8_COVERAGE'])
 for p,h in f['sources'].items(): assert sha(Path(p))==h,p
 for p,h in f['inputs'].items(): assert sha(root/p)==h,p
 assert sha(root/'worker.mjs')==f['bundle']
 node=subprocess.check_output(['which','node'],text=True).strip(); env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR','LANG','LC_ALL','TZ'] if k in os.environ}
 runtime=json.loads(subprocess.check_output([node,'-p','JSON.stringify({node:process.version,platform:process.platform,arch:process.arch})'],text=True,env=env,timeout=5)); assert runtime==f['runtime'],'runtime drift'
 start=time.monotonic(); wall=time.time(); w=wake(); records=[]; attempted=[]; failure=None
 put(root/'reservation.json',dict(freeze=sha(root/'freeze.json'),start=start,wall=wall,wake=w,node=node,nodeDigest=sha(Path(node)),environmentKeys=sorted(env)))
 try:
  for job in f['jobs']:
   assert wake()==w,'host wake drift'
   assert time.monotonic()-start<7200,'whole deadline'
   assert sha(root/'worker.mjs')==f['bundle'],'bundle drift'
   name=job['row']['profile']+'-inputs.json';assert sha(root/name)==f['inputs'][name],'input drift'
   d=root/f"job-{job['position']:03}"; d.mkdir()
   cfg=dict(row=job['row'],identicalReference=job['identicalReference'],scenarioPath=str(root/(job['row']['profile']+'-inputs.json')),output=str(d));put(d/'config.json',cfg)
   entry='import {runRow} from '+json.dumps((root/'worker.mjs').as_uri())+'; await runRow('+json.dumps(str(d/'config.json'))+');\n';(d/'entry.mjs').write_text(entry)
   t=time.monotonic(); wt=time.time(); observations=[]; p=None; error=None
   argv=[node,'--trace-gc','--trace-deopt',str(d/'entry.mjs')]
   put(d/'dispatch.json',dict(job=job,argv=argv,start=t,wall=wt,wake=w))
   try:
    with (d/'stdout.log').open('xb') as out,(d/'stderr.log').open('xb') as err:
     p=subprocess.Popen(argv,stdout=out,stderr=err,cwd=root,env=env)
     attempted.append(job['position'])
     while p.poll() is None:
      assert time.monotonic()-t<900 and time.monotonic()-start<7200,'deadline'
      ps=subprocess.run(['/bin/ps','-o','pid=,rss=,stat=','-p',str(p.pid)],capture_output=True,text=True,timeout=2)
      observations.append(dict(time=time.monotonic(),code=ps.returncode,stdout=ps.stdout,stderr=ps.stderr))
      if ps.returncode==0 and ps.stdout.strip():
       fields=ps.stdout.split(); assert len(fields)==3 and int(fields[0])==p.pid,'ps identity'
       assert int(fields[1])<=2048*1024,'RSS cap'
       if int(fields[1])==0: assert any(s in fields[2] for s in 'EZ') or p.poll() is not None,'live zero RSS'
      else: assert p.poll() is not None,'missing running process RSS'
      try:p.wait(timeout=.1)
      except subprocess.TimeoutExpired:pass
     assert p.returncode==0,'child exit'
   except BaseException as e:error=repr(e)
   finally:
    cleanup,after,wake_error=finish(p)
    end=time.monotonic(); ew=time.time()
    record=dict(position=job['position'],pid=None if p is None else p.pid,exitCode=None if p is None else p.returncode,start=t,end=end,wallStart=wt,wallEnd=ew,wakeBefore=w,wakeAfter=after,error=error,cleanupErrors=cleanup,wakeError=wake_error,rss=observations)
    put(d/'exit.json',record);records.append(record)
   assert error is None and not cleanup and wake_error is None,(error,cleanup,wake_error)
   assert end-t<=900 and end-start<=7200,'post-exit deadline'
   assert after==w and abs((ew-wt)-(end-t))<=1,'clock discontinuity'
   assert json.loads((d/'completion.json').read_text())==dict(completed=True,samples=40 if job['row']['group']=='recovery' else 3600),'completion'
   assert json.loads((d/'preflight.json').read_text())['passed'] is True,'semantic preflight'
   print('COVERAGE_JOB_DONE',job['position'],job['row']['id'],'control' if job['identicalReference'] else 'main',round(end-t,3),flush=True)
 except BaseException as e:failure=repr(e)
 finally:
  put(root/'attempt.json',dict(complete=len(records)==168 and failure is None,failure=failure,dispatched=len(attempted),attempted=attempted,notRun=[i for i in range(168) if i not in attempted],elapsed=time.monotonic()-start,formalQualification=False))
  put(root/'artifact-index.json',{'files':{str(p.relative_to(root)):sha(p) for p in sorted(root.rglob('*')) if p.is_file() and p.name!='artifact-index.json'}})
  print('COVERAGE_DONE',len(records),failure,flush=True)
 return failure is not None
if __name__=='__main__': sys.exit(run(sys.argv[1]))
