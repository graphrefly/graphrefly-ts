"""Independent private window attribution. No execution; profile points are not durations."""
import bisect
import importlib.util
import json
import math
import statistics
from fractions import Fraction as F
from pathlib import Path

def module(name):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
clock=module('verify-causal-anchor-clock.py')
base=module('verify-causal-workload-diagnostic.py')
require=base.require
number=base.number

def merged_index(intervals):
 merged=[]
 for a,z in sorted(intervals):
  if merged and a<=merged[-1][1]:merged[-1]=(merged[-1][0],max(z,merged[-1][1]))
  else:merged.append((a,z))
 starts=[a for a,z in merged];prefix=[0.0]
 for a,z in merged:prefix.append(prefix[-1]+z-a)
 return merged,starts,prefix

_cached_intervals=None
_cached_index=None
def fast_union_overlap(intervals,windows):
 global _cached_intervals,_cached_index
 if intervals is not _cached_intervals:
  _cached_intervals=intervals;_cached_index=merged_index(intervals)
 merged,starts,prefix=_cached_index
 def area(x):
  i=bisect.bisect_right(starts,x)-1
  return 0.0 if i<0 else prefix[i]+min(x,merged[i][1])-merged[i][0]
 target=[]
 for a,z in sorted(windows):
  if target and a<=target[-1][1]:target[-1]=(target[-1][0],max(z,target[-1][1]))
  else:target.append((a,z))
 return math.fsum(area(z)-area(a) for a,z in target)
base.union_overlap=fast_union_overlap

def category(frame):
 url=frame['url'];name=frame['functionName']
 if name=='(idle)':return 'idle'
 if name in ('(garbage collector)','(program)') or url.startswith('node:'):return 'runtime'
 if url.endswith(('worker.mjs','worker-copy.mjs')):return 'bundle:library-or-consumer-unresolved'
 if 'causal-' in url or url.endswith(('CONTROL.mjs','GC.mjs','GC_CPU.mjs','entry.mjs')):return 'harness'
 return 'unknown'

def verify(samples,diag,alignment,profile,native,platform,meta):
 condition=alignment['condition'];require(condition in ('CONTROL','GC','GC_CPU'),'condition')
 require(diag['condition']==('CPU' if condition=='CONTROL' else 'CPU_GC'),'diagnostic condition')
 blocks=base.verify(samples,diag)
 require(alignment['pid']==meta['pid'],'alignment PID')
 jlo,jhi=clock.anchors(alignment,meta);r=clock.native_check(alignment,platform,native)
 require(alignment['anchors'][0]['after']<=samples[0]['start'] and max(samples[-1]['end'],diag['checkpoints'][-1]['wallAfter'])<=alignment['anchors'][1]['before'],'sample/anchor bounds')
 groups=[];window_group={}
 intervals=[(e['startTime'],e['startTime']+e['duration'])for e in diag['gc']]
 windows=[]
 for index,s in enumerate(samples):
  windows.append(dict(batch=s['batch'],arm=s['arm'],index=s['index'],phase=s['phase'],start=s['start'],end=s['end'],ms=s['ms'],certain=0,ambiguous=0,gcOverlapMs=base.union_overlap(intervals,[(s['start'],s['end'])])))
 for b in range(6):
  measured=list(range(b*400+100,(b+1)*400))
  slow=set(sorted(measured,key=lambda i:(-samples[i]['ms'],samples[i]['index']))[:15])
  for name,indices in [('slow',sorted(slow)),('ordinary',[i for i in measured if i not in slow])]:
   g=dict(block=b,group=name,windows=indices,count=len(indices),constructionSumMs=math.fsum(samples[i]['ms']for i in indices),gcOverlapMs=math.fsum(windows[i]['gcOverlapMs']for i in indices),self={},ambiguousSelf={},inclusive={})
   for i in indices:window_group[i]=len(groups)
   groups.append(g)
 result=dict(condition=condition,blocks=blocks['blocks'],windows=windows,groups=groups,cpu=None)
 if condition!='GC_CPU':
  require(profile is None and alignment['bounds']=={},'no CPU profile for other conditions');return result
 require(isinstance(profile,dict),'CPU profile required')
 start,end=profile['startTime'],profile['endTime']
 require(type(start)is int and type(end)is int and 0<=start<end<2**53 and end-start<=30000000,'CPU timestamps')
 nodes=profile['nodes'];require(0<len(nodes)<=100000,'nodes limit')
 by_id={};parents={}
 for n in nodes:
  require(type(n['id'])is int and n['id']>0 and n['id']not in by_id,'unique node id');by_id[n['id']]=n
  frame=n['callFrame'];require(all(k in frame for k in ('functionName','scriptId','url','lineNumber','columnNumber')),'frame identity')
  require(all(type(frame[k])is str for k in ('functionName','scriptId','url')),'frame strings')
  require(all(type(frame[k])is int for k in ('lineNumber','columnNumber')),'frame positions')
  for child in n.get('children',[]):
   require(type(child)is int and child not in parents,'one parent');parents[child]=n['id']
 require(set(parents)<=set(by_id),'child references')
 roots=set(by_id)-set(parents);require(len(roots)==1,'one profile root')
 visited=set();order=[];todo=list(roots)
 while todo:
  id=todo.pop();require(id not in visited,'acyclic tree');visited.add(id);order.append(id);todo.extend(by_id[id].get('children',[]))
 require(visited==set(by_id),'connected profile tree')
 pids,deltas=profile['samples'],profile['timeDeltas']
 require(len(pids)==len(deltas) and 0<len(pids)<=200000,'sample arrays')
 before,after=native['before'],native['after']
 slo=max(0,before['continuous']-before['absoluteAfter'])*r/1000000
 shi=(after['continuous']-after['absoluteBefore'])*r/1000000
 lo=jlo+slo-F(1,1000)-F(1,1000000);hi=jhi+shi+999*r/1000000
 require(0<=hi-lo<=F(1,10),'clock precision')
 bounds=alignment['bounds']
 s0,s1,e0,e1=[clock.rational(bounds[k])for k in ('startBefore','startAfter','stopBefore','stopAfter')]
 require(0<=s0<=s1<=alignment['anchors'][0]['before']<=alignment['anchors'][-1]['after']<=e0<=e1,'profile/anchor order')
 for q,a,z in [(start,s0,s1),(end,e0,e1)]:require(max(F(q,1000)+lo,a)<=min(F(q,1000)+hi,z),'profile endpoint consistency')
 starts=[F(s['start'])for s in samples];ends=[F(s['end'])for s in samples]
 tolerance=[4*max(F(math.ulp(s['start'])),F(math.ulp(s['end'])))for s in samples]
 hits=dict(certain=0,ambiguous=0,outside=0);q=start
 for id,dt in zip(pids,deltas):
  require(type(id)is int and id in by_id and type(dt)is int and dt>=0,'sample node/delta');q+=dt;require(q<=end,'sample timestamp')
  left,right=F(q,1000)+lo,F(q,1000)+hi
  # Nonoverlapping chronological windows: bisect, then inspect only intersecting neighbors.
  first=max(0,bisect.bisect_left(ends,left)-1);last=min(len(samples),bisect.bisect_right(starts,right)+1)
  touched=[i for i in range(first,last) if left<=ends[i]+tolerance[i] and right>=starts[i]-tolerance[i]]
  certain=[i for i in touched if starts[i]+tolerance[i]<=left and right<=ends[i]-tolerance[i]]
  if len(certain)==1:
   i=certain[0];hits['certain']+=1;windows[i]['certain']+=1
   if i in window_group:
    counts=groups[window_group[i]]['self'];counts[str(id)]=counts.get(str(id),0)+1
  elif touched:
   hits['ambiguous']+=1
   for i in touched:windows[i]['ambiguous']+=1
   for group in {window_group[i]for i in touched if i in window_group}:
    counts=groups[group]['ambiguousSelf'];counts[str(id)]=counts.get(str(id),0)+1
  else:hits['outside']+=1
 for g in groups:
  g['inclusive']=dict(g['self'])
  for id in reversed(order):
   count=g['inclusive'].get(str(id),0)
   if count and id in parents:
    key=str(parents[id]);g['inclusive'][key]=g['inclusive'].get(key,0)+count
  g['zeroHitWindows']=sum(windows[i]['certain']==0 for i in g['windows'])
 sorted_deltas=sorted(deltas)
 result['cpu']=dict(intervalDistributionUs=dict(min=sorted_deltas[0],median=statistics.median(sorted_deltas),p95=sorted_deltas[math.ceil(.95*len(deltas))-1],max=sorted_deltas[-1],overRequested250us=sum(d>250 for d in deltas),longGapsOver1ms=sum(d>1000 for d in deltas)),offsetIntervalExactMs=[clock.exact(lo),clock.exact(hi)],widthMs=float(hi-lo),sampleCount=len(pids),assignment=hits,
  timeDeltasUs=deltas,zeroCertainWindows=sum(w['certain']==0 for w in windows),
  # Parent links + unmodified callFrame give complete stack paths without quadratic path duplication.
  frames=[dict(id=n['id'],parent=parents.get(n['id']),category=category(n['callFrame']),callFrame=n['callFrame'])for n in nodes],
  limitation='Counts only; inclusive is not additive with self. URL/scriptId/bundle positions only; no unverified source map or graph-node identity. Long gaps and zero-hit windows remain unknown.')
 return result

if __name__=='__main__':
 import sys
 d=Path(sys.argv[1]);read=lambda n:json.loads((d/n).read_text())
 profile=read('profile.json')if(d/'profile.json').exists()else None
 print(json.dumps(verify([json.loads(x)for x in(d/'samples.jsonl').read_text().splitlines()],read('diagnostic.json'),read('alignment.json'),profile,read('native-clock.json'),read('platform.json'),read('entry.json'))))
