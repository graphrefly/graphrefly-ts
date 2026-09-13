"""Current source-bound execution of unchanged D169 Z/M schedule and arithmetic."""
import hashlib,importlib.util,json,os,secrets,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def load(name):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
c=load('causal-position-pairs')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
def run(root):
 root=Path(root).resolve();assert not (root/'reservation.json').exists()
 binding=json.loads((root/'current-binding.json').read_text())
 for p,h in binding['sources'].items():assert sha(ROOT/p)==h,p
 q=json.loads((root/'qualification.log').read_text());assert q['passed'] is True and q['manifest']==binding['derivation'] and q['staticNegatives']==23 and len(q['loadedCases'])==23 and all(x['passed'] for x in q['loadedCases']) and q['loadedSourceMutants']==9 and all(x['oraclePassed'] and x['created']==x['cleaned'] for x in q['realAdapterQualification']) and q['consumerPerformanceSamples']==0,'loaded qualification'
 assert not any(os.environ.get(k) for k in ['NODE_OPTIONS','NODE_COMPILE_CACHE','NODE_V8_COVERAGE'])
 node=subprocess.check_output(['which','node'],text=True).strip();env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR','LANG','LC_ALL','TZ'] if k in os.environ}
 runtime=json.loads(subprocess.check_output([node,'-p','JSON.stringify({node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch})'],text=True,env=env));assert runtime==binding['runtime']
 entropy=secrets.token_bytes(5);bits=[(b>>s)&1 for b in entropy for s in range(8)];cells=c.schedule(bits)
 began=time.monotonic();w=c.wake();rows=[];pairs=[];panels=[];attempted=[];error=None
 put(root/'reservation.json',dict(binding=sha(root/'current-binding.json'),qualification=sha(root/'qualification.log'),sourceVerifier=sha(ROOT/'scripts/verify-causal-position-current.py'),executionRoot=str(root),approval='User authorized performance diagnosis, tool repairs and performance acceptance without stepwise continuation.',node=node,nodeDigest=sha(Path(node)),entropyHex=entropy.hex(),orderBits=bits,schedule=cells,wake=w,start=began,limits=dict(processes=80,samples=192000,childSeconds=30,totalSeconds=900,retries=0)))
 try:
  for cell in cells:
   if cell['panel']=='M' and not panels[0]['passed']:break
   for name,key in [('worker.mjs','bundle'),('worker-copy.mjs','bundle'),('position.mjs','position'),('P2-inputs.json','fixture')]:assert sha(root/name)==binding[key],name
   assert c.wake()==w and time.monotonic()-began<900,'pre-dispatch continuity'
   job=root/f"{cell['position']:02d}-{cell['panel']}-{cell['pair']:02d}-{cell['orientation']}";job.mkdir()
   put(job/'config.json',c.config_for(job,cell));(job/'entry.mjs').write_text(c.entry_source(job,cell));t=time.monotonic();wall=time.time();p=None;failure=None;cleanup=[];after=None;wake_error=None
   argv=[node,*c.FLAGS,str(job/'entry.mjs')];put(job/'dispatch.json',dict(**cell,argv=argv,cwd=str(job),cleanupErrors=[],startMonotonic=t,startWall=wall,wakeBefore=w))
   try:
    with (job/'stdout.log').open('xb') as out,(job/'stderr.log').open('xb') as err:
     p=subprocess.Popen(argv,cwd=job,env=env,stdout=out,stderr=err);attempted.append(cell['position']);p.wait(timeout=min(30,900-(t-began)))
   except BaseException as e:failure=repr(e)
   finally:
    if p is not None and p.poll() is None:
     try:p.kill()
     except BaseException as e:cleanup.append(repr(e))
     try:p.wait(timeout=3)
     except BaseException as e:cleanup.append(repr(e))
    try:after=c.wake()
    except BaseException as e:wake_error=repr(e)
    record=dict(**cell,argv=argv,cwd=str(job),pid=None if p is None else p.pid,exitCode=None if p is None else p.returncode,startMonotonic=t,endMonotonic=time.monotonic(),startWall=wall,endWall=time.time(),wakeBefore=w,wakeAfter=after,childError=failure,cleanupErrors=cleanup,wakeError=wake_error)
    put(job/'exit.json',record)
   assert failure is None and not cleanup and wake_error is None and p.returncode==0,record
   assert after==w and record['endMonotonic']-t<=30 and record['endMonotonic']-began<=900,'post-exit continuity/deadline'
   assert abs((record['endWall']-wall)-(record['endMonotonic']-t))<=1,'clock discontinuity'
   rows.append(dict(**cell,**c.check_child(job,cell,p.pid)))
   if len(rows)%2==0:pairs.append(c.paired(rows[-2:]));print('CURRENT_POSITION_PAIR',cell['panel'],cell['pair'],flush=True)
   if len(rows)%40==0:panels.append(c.panel_summary(pairs[-20:],cell['panel']));print(json.dumps(panels[-1]),flush=True)
 except BaseException as e:error=repr(e)
 finally:
  put(root/'result.json',dict(status='invalid' if error else 'method-qualified' if len(panels)==2 and all(x['passed'] for x in panels) else 'method-not-qualified',rows=rows,pairs=pairs,panels=panels,error=error,attempted=attempted,notRun=[i for i in range(80) if i not in attempted],samples=len(rows)*2400,elapsed=time.monotonic()-began,consumerPerformanceQualification=False))
  put(root/'artifact-index.json',dict(files={str(p.relative_to(root)):sha(p) for p in sorted(root.rglob('*')) if p.is_file() and p.name!='artifact-index.json'}));print('CURRENT_POSITION_DONE',error,flush=True)
 return error is not None
if __name__=='__main__':sys.exit(run(sys.argv[1]))
