"""Single-use bounded preparation probes. No Graph imports or consumer dispatch capability."""
import ctypes,hashlib,importlib.util,json,os,sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent

def load(file,name):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
supervisor=load('causal-workload-supervisor.py','supervisor')
verifier=load('verify-causal-aligned-clock.py','verifier')
original_violation=supervisor.violation
def violation(elapsed,child_elapsed,gap,rss,directory_bytes):
 if elapsed>40:return 'preparation-deadline'
 if child_elapsed>10:return 'probe-deadline'
 return original_violation(elapsed,child_elapsed,gap,rss,directory_bytes)
supervisor.violation=violation

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,x):
 with p.open('x')as f:json.dump(x,f,indent=2);f.write('\n')
def run(plan_path,output):
 plan=json.loads(plan_path.read_text());put(plan_path.with_name(plan_path.name+'.claim.json'),dict(planSha256=sha(plan_path),output=str(output)))
 output.mkdir();start=time.monotonic();results=[]
 lib=ctypes.CDLL('/usr/lib/libSystem.B.dylib')
 absolute,continuous=lib.mach_absolute_time,lib.mach_continuous_time
 absolute.restype=continuous.restype=ctypes.c_uint64
 absolute.argtypes=continuous.argtypes=[]
 def clock_read():
  a=absolute();c=continuous();b=absolute();return dict(absoluteBefore=a,continuous=c,absoluteAfter=b)
 def guard():
  for file,digest in plan['files'].items():assert sha(ROOT/file)==digest,file
  assert sha(Path(plan['node']))==plan['nodeSha256']
 try:
  assert plan['jobs']==['CPU','CPU','CPU','GC'] and plan['consumerExecutions']==0
  guard()
  for i,kind in enumerate(plan['jobs']):
   guard();folder=output/f'{i:02d}';folder.mkdir()
   argv=[plan['node'],*(['--expose-gc']if kind=='GC'else[]),str(HERE/'probe-causal-aligned-clock.mjs'),kind,str(folder)]
   put(folder/'command.json',dict(argv=argv,explicitEnvironment=plan['explicitEnvironment']))
   before=clock_read();outcome=supervisor.supervise(argv,folder,output,plan['explicitEnvironment'],start);after=clock_read()
   native=dict(before=before,after=after);put(folder/'native-clock.json',native)
   result=dict(id=i,kind=kind,outcome=outcome)
   if not outcome['reason']:
    try:
     probe=json.loads((folder/'probe.json').read_text())
     meta=json.loads((folder/'process.json').read_text());assert meta['pid']==outcome['pid'] and meta['node']=='v24.18.0'
     if kind=='CPU':
      assert (folder/'profile.json').stat().st_size<=32*1024**2
      analysis=verifier.verify(json.loads((folder/'profile.json').read_text()),probe,plan['platform'],native)
      put(folder/'analysis.json',analysis)
      if not analysis['alignmentQualified']:result['qualificationFailure']='clock-interval-width'
     else:
      assert len(probe['windows'])==2 and 0<len(probe['events'])<100000 and not probe.get('fault')
      for e in probe['events']:assert 0<=e['startTime']<=e['startTime']+e['duration']<=e['receivedAt']
    except Exception as e:result['qualificationFailure']=f'{type(e).__name__}:{e}'
   results.append(result)
   if outcome['reason'] or result.get('qualificationFailure'):break
  guard()
  assert time.monotonic()-start<=40,'preparation-deadline'
  assert supervisor.tree_size(output)<=256*1024**2,'directory-size'
  completed=len(results)==4 and not any(r['outcome']['reason']or r.get('qualificationFailure')for r in results)
  put(output/'result.json',dict(probesQualified=completed,children=results,notRun=[dict(id=i,kind=plan['jobs'][i])for i in range(len(results),4)],consumerExecutions=0,captureToolingQualified=False))
 except BaseException as e:
  put(output/'failure.json',dict(error=f'{type(e).__name__}:{e}',children=results,consumerExecutions=0));raise
if __name__=='__main__':
 assert len(sys.argv)==4 and sys.argv[1]=='--run-probes'
 run(Path(sys.argv[2]).resolve(),Path(sys.argv[3]).resolve())
