"""Independent inventory, shape and arithmetic replay of cold diagnostic."""
import hashlib,json,statistics,sys
from pathlib import Path
def verify(root):
 r=Path(root);read=lambda p:json.loads((r/p).read_text());idx=read('artifact-index.json')['files']
 assert set(idx)=={str(p.relative_to(r)) for p in r.rglob('*') if p.is_file() and p.name!='artifact-index.json'}
 for p,h in idx.items():assert (r/p).resolve().is_relative_to(r.resolve()) and hashlib.sha256((r/p).read_bytes()).hexdigest()==h
 f=read('freeze.json');assert hashlib.sha256((r/'P1-inputs.json').read_bytes()).hexdigest()==f['input'];a=read('attempt.json');assert a['error'] is None and len(a['records'])==8 and 0<a['elapsed']<240
 assert f['warmup']==30 and f['measured']==200 and len(f['jobs'])==8
 for name,h in f.get('tools',{}).items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==h
 for arm,h in f['bundles'].items():assert hashlib.sha256((r/(arm+'.mjs')).read_bytes()).hexdigest()==h
 out=[];pids=set()
 for i,job in enumerate(f['jobs']):
  repeat=i%4;assert job==dict(id=i,mode='off' if i<4 else 'summary',repeat=repeat,control=repeat==3,order=['before','before'] if repeat==3 else ['after','before'] if repeat%2 else ['before','after'])
  assert a['records'][i]==dict(id=i,code=0)
  x=read(f'job-{i}.json');assert x['job']==job and x['preflight'] and x['stateChecks'] and x['formalQualified'] is False and x['pid'] not in pids;pids.add(x['pid'])
  assert len(x['records'])==2;medians=[]
  for arm,record in zip(job['order'],x['records']):
   assert record['arm']==arm and len(record['samples'])==200 and all(isinstance(v,(int,float)) and 0<=v<30000 for v in record['samples'])
   medians.append(statistics.median(record['samples']))
  ratio=medians[1]/medians[0] if job['control'] or job['order'][0]=='before' else medians[0]/medians[1]
  out.append(dict(job=job,orderedMediansMs=medians,afterBeforeRatio=ratio))
 return dict(verified=True,formalQualified=False,processes=8,measuredConstructions=3200,results=out)
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),indent=2))
