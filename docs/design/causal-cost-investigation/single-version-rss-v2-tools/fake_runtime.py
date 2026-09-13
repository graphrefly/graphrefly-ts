"""Run the actual collector with fake processes/clocks; never import consumer bundles."""
import copy,json,pathlib,shutil,tempfile,types,sys
import collect,continuity
from verify import inspect,report,sha
BASE=pathlib.Path(__file__).resolve().parent/'prepared'
def put(p,x):p.write_text(json.dumps(x,separators=(',',':'))+'\n')
class Clock:
 def __init__(self):self.now=0
 def time(self):return 1000+self.now
 def monotonic(self):return self.now
 def sleep(self,n):self.now+=n
class Process:
 def __init__(self,args,**kw):
  entry=pathlib.Path(args[-1]);d=entry.parent;root=d.parents[1];j=json.loads(entry.read_text());r=json.loads((root/'reservation.json').read_text());self.pid=50000+j['id'];self.returncode=None;self.polls=0
  put(d/'identity.json',{**r['runtime'],'pid':self.pid,'entryDigest':sha(entry.read_bytes()),'env':r['environment'],'argv':args})
  put(d/'completion.json',{'completed':True,'samples':120,'pid':self.pid})
  put(d/'preflight.json',{'instances':7,'checks':[{'cold':{'passed':True},'steady':{'passed':True}}],'expected':[{}],'expectedJSON':['{}']});records=[]
  for n in range(120):
   factor=.8 if j['arm']=='C' else 1
   records.append({'block':0,'position':0,'slot':0,'index':n,'phase':'warmup' if n<20 else 'measured','clocks':[x*factor+n*20 for x in [1,2,3,5,6,9,10,14]],'outcome':'released','releaseCompleted':True,'before':1,'after':1,'snapshotDigest':sha(b'{}')})
  (d/'samples.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in records))
 def poll(self):
  self.polls+=1
  if self.polls>4:self.returncode=0
  return self.returncode
 def wait(self,**kw):self.returncode=0;return 0
original=collect.subprocess
metadata=json.dumps({k:v for k,v in json.loads((BASE/'node-runtime.json').read_text()).items() if k!='executableDigest'}).encode()
class Subprocess:
 Popen=Process
 def check_output(self,*a,**k):return metadata
 def run(self,*a,**k):return types.SimpleNamespace(returncode=0,stdout=a[0][-1]+' R 1024',stderr='')

def freeze_fixture(root):
 put(root/'python-runtime.json',{'executable':sys.executable,'sha256':sha(pathlib.Path(sys.executable).read_bytes()),'version':sys.version})
 (root/'frozen.json').unlink(missing_ok=True)
 assets={str(p.relative_to(root)):sha(p.read_bytes()) for p in root.rglob('*') if p.is_file()}
 put(root/'frozen.json',{'assets':assets})
