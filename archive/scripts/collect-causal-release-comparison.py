"""One exclusive attempt; no retry/resume or arbitrary output option."""
import hashlib,json,os,pathlib,secrets,shutil,signal,subprocess,sys,tarfile,time,traceback
REPO=pathlib.Path(__file__).resolve().parent.parent
OUT=REPO/'archive/evals/causal-release-cost-comparison-v2/run'
DOC=REPO/'docs/design/causal-release-cost-comparison-v2'
TOOLS=['build-causal-release-comparison.mjs','rebuild-causal-release-comparison.mjs','causal-release-comparison-child.mjs','causal-release-comparison-driver.mjs','verify-causal-release-comparison.py','collect-causal-release-comparison.py','causal-release-comparison.test.mjs','test-causal-release-comparison.py']
ROWS=['P2-lifecycle','inactive-60','active-diamond-5','inactive-2','inactive-1']
def sha(b):return hashlib.sha256(b).hexdigest()
def put(path,value):
 path.parent.mkdir(parents=True,exist_ok=True)
 with path.open('x') as f:json.dump(value,f,separators=(',',':'),ensure_ascii=False,allow_nan=False);f.write('\n')
def remaining():
 value=900-(time.monotonic()-START)
 if value<=0:raise RuntimeError('whole attempt deadline')
 return value
def command(argv,**kwargs):
 timeout=remaining();text=kwargs.pop('text',False);stderr=kwargs.pop('stderr',subprocess.PIPE)
 child=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=stderr,start_new_session=True,**kwargs)
 try:
  out,err=child.communicate(timeout=timeout)
  if child.returncode:
   path=OUT/f'command-failure-{child.pid}.json'
   put(path,{'argv':argv,'code':child.returncode,'stdout':out.decode(errors='replace'),'stderr':(err or b'').decode(errors='replace')})
   raise RuntimeError('command failure: '+str(path))
  return out.decode() if text else out
 finally:
  # Includes verifier -> Node -> esbuild descendants, not only the direct child.
  try:os.killpg(child.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  child.wait(timeout=5)
def wake():return command(['/usr/sbin/sysctl','-n','kern.waketime'],text=True).strip()
def frozen_objects(build):
 directory=OUT/'git-objects';directory.mkdir()
 def save(oid,kind):
  target=directory/oid
  if not target.exists():target.write_bytes(command(['git','cat-file',kind,oid],cwd=REPO))
  return target.read_bytes()
 for arm in build['arms'].values():
  commit=arm['commit'];root_tree=save(commit,'commit').split(b'\n')[0].decode().split(' ')[1]
  for file,entry in arm['closure'].items():
   if not entry['gitBlob']:continue
   tree=root_tree
   for component in file.split('/')[:-1]:
    raw=save(tree,'tree');entries={}
    while raw:
     header,tail=raw.split(b'\0',1);entries[header.split(b' ',1)[1].decode()]=tail[:20].hex();raw=tail[20:]
    tree=entries[component]
   save(tree,'tree')
def verify(count):
 raw=command([sys.executable,'-B',str(OUT/'tools/verify-causal-release-comparison.py'),str(OUT),str(count)],cwd=REPO)
 target=OUT/f'verified-{count:02d}.json';target.write_bytes(raw)
 result=json.loads(raw)
 if not result.get('passed'):raise RuntimeError('independent verification failed')
 remaining()
 return result
def execute(entry,runtime,environment,wake_value):
 folder=OUT/'jobs'/f"{entry['id']:02d}";folder.mkdir();put(folder/'entry.json',entry)
 argv=[runtime['execPath'],str(OUT/'tools/causal-release-comparison-child.mjs'),str(folder/'entry.json')]
 before=wake();start=time.monotonic();failure=None;rss=0;observations=[];child=None
 try:
  if before!=wake_value:raise RuntimeError('wake changed before child')
  with (folder/'stdout.log').open('xb') as stdout,(folder/'stderr.log').open('xb') as stderr:
   child=subprocess.Popen(argv,cwd=REPO,env=environment,stdout=stdout,stderr=stderr,start_new_session=True)
   while child.poll() is None:
    remaining()
    if time.monotonic()-start>30:raise RuntimeError('child deadline')
    proc=subprocess.run(['/bin/ps','-o','rss=','-p',str(child.pid)],capture_output=True,text=True,timeout=min(2,remaining()))
    if proc.returncode==0 and proc.stdout.strip():
     current=int(proc.stdout.strip())*1024;rss=max(rss,current);observations.append([time.monotonic(),current])
     if current>268435456:raise RuntimeError('RSS soft guard')
    elif child.poll() is None:raise RuntimeError('RSS monitoring failed for live child')
    time.sleep(min(.1,max(0,30-(time.monotonic()-start))))
   if child.returncode:failure='child exit '+str(child.returncode)
   if not observations:failure='no RSS observations'
 except Exception as e:
  failure=str(e)
 finally:
  if child is not None and child.poll() is None:
   os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
  end=time.monotonic()
  try:after=wake()
  except Exception as e:after=None;failure=f'{failure}; wake check: {e}'
  if after!=wake_value:failure=f'{failure}; wake changed'
  put(folder/'exit.json',{'argv':argv,'pid':child.pid if child else None,'code':child.returncode if child else None,'failure':failure,'startMono':start,'endMono':end,'elapsed':end-start,'maxRSS':rss,'rssObservations':observations,'wakeBefore':before,'wakeAfter':after})
 if failure:raise RuntimeError(failure)
if __name__=='__main__':
 # Existence consumes authorization; never delete or reuse this directory.
 OUT.parent.mkdir(parents=True,exist_ok=True);OUT.mkdir()
 START=time.monotonic();completed=0;dispatched=0;failure=None
 put(OUT/'attempt.json',{'startMono':START,'startWall':time.time(),'retry':0,'owner':'graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS'})
 try:
  for key in ['NODE_OPTIONS','NODE_V8_COVERAGE','NODE_COMPILE_CACHE']:
   if key in os.environ:raise RuntimeError('implicit Node hook '+key)
  environment={k:os.environ[k] for k in ['PATH','HOME','TMPDIR','LANG','LC_ALL','TZ'] if k in os.environ}
  node=str(pathlib.Path(shutil.which('node')).resolve())
  runtime=json.loads(command([node,'-e','console.log(JSON.stringify({node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,execPath:process.execPath}))'],env=environment))
  runtime['executableDigest']=sha(pathlib.Path(node).read_bytes())
  tools=OUT/'tools';tools.mkdir();(OUT/'jobs').mkdir()
  for name in TOOLS:shutil.copyfile(REPO/'scripts'/name,tools/name)
  shutil.copyfile(REPO/'scripts/fixtures/causal-release-comparison.ts',tools/'causal-release-comparison.ts')
  shutil.copyfile(REPO/'scripts/fixtures/causal-release-comparison-oracle.ts',tools/'causal-release-comparison-oracle.ts')
  for name in ['approval.json','qualification.json']:shutil.copyfile(DOC/name,tools/name)
  qualification=json.loads((DOC/'qualification.json').read_bytes())
  for name in qualification['evidence']:shutil.copyfile(DOC/name,tools/name)
  shutil.copyfile(REPO/'docs/design/causal-release-cost-comparison-v1.md',tools/'proposal.md')
  archive=REPO/'archive/evals/causal-release-boundaries-v1/evidence.tar.gz'
  if sha(archive.read_bytes())!='ed9ee0ab1a7662b3719f1fc8309eb7d3da3cb3b0c21331ac0c7e7e81a2d720fb':raise RuntimeError('input archive drift')
  index=REPO/'archive/evals/causal-release-boundaries-v1/artifact-index.json'
  if sha(index.read_bytes())!='4c87c21a93d45b141fb720ccc315e7c64edd4e5541bf999ef79323b297801f8e':raise RuntimeError('input index drift')
  with tarfile.open(archive) as tar:data=tar.extractfile('run/P2-inputs.json').read()
  if sha(data)!='44f1165557fc1444540731a73846233ce3d71da7a0af3a3d4fa2137e249c2079':raise RuntimeError('P2 drift')
  (OUT/'P2-inputs.json').write_bytes(data)
  build_log=command([node,str(tools/'build-causal-release-comparison.mjs'),str(OUT),str(REPO)],env=environment,cwd=REPO,stderr=subprocess.STDOUT)
  (OUT/'build.log').write_bytes(build_log)
  build=json.loads((OUT/'build.json').read_bytes());frozen_objects(build)
  bits=[secrets.randbits(1) for _ in range(30)];jobs=[]
  for r,row in enumerate(ROWS):
   for pair in range(6):
    for variant in (['U','V'] if bits[r*6+pair]==0 else ['V','U']):jobs.append({'id':len(jobs),'row':row,'pair':pair,'variant':variant,'kind':'control' if pair in (0,5) else 'main'})
  wake_value=wake()
  budget={'processes':60,'samples':144000,'seconds':900,'childSeconds':30,'rssBytes':268435456,'retries':0}
  reservation={'startMono':START,'originalRoot':str(OUT),'bits':bits,'schedule':jobs,'runtime':runtime,'environment':environment,'wake':wake_value,'budget':budget,'tools':{p.name:sha(p.read_bytes()) for p in sorted(tools.iterdir())}}
  put(OUT/'reservation.json',reservation)
  reservation_digest=sha((OUT/'reservation.json').read_bytes())
  bundle_digests={name:build['arms']['B' if name=='B-copy.mjs' else name[0]]['bundleDigest'] for name in ['B.mjs','C.mjs','B-copy.mjs']}
  verify(0)
  for job in jobs:
   remaining()
   if sha(pathlib.Path(node).read_bytes())!=runtime['executableDigest']:raise RuntimeError('Node executable drift')
   # Previous full prefix verdict and fresh immutable tool/bundle checks authorize this exact next child.
   if sha((OUT/'reservation.json').read_bytes())!=reservation_digest:raise RuntimeError('reservation drift')
   for name,digest in reservation['tools'].items():
    if sha((tools/name).read_bytes())!=digest:raise RuntimeError('tool drift')
   for name,digest in bundle_digests.items():
    if sha((OUT/name).read_bytes())!=digest:raise RuntimeError('bundle drift before dispatch')
   modules=['B.mjs','B-copy.mjs' if job['kind']=='control' else 'C.mjs']
   entry={**job,'modules':modules,'moduleDigests':{name:sha((OUT/name).read_bytes()) for name in modules},'inputDigest':sha(data)}
   dispatched+=1;execute(entry,runtime,environment,wake_value)
   verify(dispatched);completed=dispatched
   print(json.dumps({'verified':completed,'total':60,'row':job['row']}),flush=True)
 except Exception as e:
  failure={'error':str(e),'traceback':traceback.format_exc()}
 finally:
  put(OUT/'result.json',{'completed':completed,'dispatched':dispatched,'notRun':list(range(dispatched,60)),'failure':failure,'elapsed':time.monotonic()-START,'retries':0})
 print(json.dumps({'completed':completed,'dispatched':dispatched,'failure':failure}),flush=True)
 sys.exit(1 if failure else 0)
