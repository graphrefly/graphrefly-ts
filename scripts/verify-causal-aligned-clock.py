"""Independent interval proof for the bounded known-function probe; no execution."""
import json,math
from pathlib import Path

def require(ok,msg):
 if not ok:raise ValueError(msg)
def num(x):
 require(type(x)in(int,float)and math.isfinite(x),'finite number');return x

def verify(profile,probe,platform,native):
 require(probe['kind']=='CPU' and not probe.get('failure') and not probe.get('disconnectFailure'),'successful CPU probe')
 start,end=num(profile['startTime']),num(profile['endTime'])
 require(0<=start<end<2**53 and end-start<=1000000,'profile <=1s and representable')
 ids=[n['id']for n in profile['nodes']];require(len(ids)<=100000 and len(set(ids))==len(ids),'profile node ids')
 samples,deltas=profile['samples'],profile['timeDeltas'];require(len(samples)==len(deltas) and 0<len(samples)<=200000,'sample count')
 q=start
 for id,dt in zip(samples,deltas):
  require(type(id)is int and id in ids,'sample node');require(type(dt)is int and dt>=0,'sample delta');q+=dt;require(q<=end,'sample timestamp bounded')
 b=probe['bounds'];s0,s1,e0,e1=[num(b[k])for k in ['startBefore','startAfter','stopBefore','stopAfter']]
 require(0<=s0<=s1<=e0<=e1,'request/reply order')
 numerator,denominator=platform['timebase']['numer'],platform['timebase']['denom']
 require(type(numerator)is int and type(denominator)is int and numerator>0 and denominator>0,'timebase')
 before,after=native['before'],native['after']
 for obs in [before,after]:
  require(all(type(obs[k])is int and obs[k]>=0 for k in ['absoluteBefore','continuous','absoluteAfter']),'native ticks')
  require(obs['absoluteBefore']<=obs['absoluteAfter'] and obs['absoluteBefore']<=obs['continuous'],'native brackets')
 low0=max(0,before['continuous']-before['absoluteAfter']);high1=after['continuous']-after['absoluteBefore']
 require(after['absoluteBefore']>=before['absoluteAfter'] and high1>=low0,'native monotonic interval')
 require(after['continuous']*numerator<2**64,'uv conversion must not overflow')
 # C-A is accumulated sleep time. All probe-time variation is bounded by these enclosing reads.
 sleep_upper_ms=(high1-low0)*numerator/denominator/1000000
 # V8 truncates raw ticks before timebase conversion, then rounds down in microseconds.
 # Its conversion error's full variation is strictly below 999*r/1000 + 1 microseconds.
 quantization_spread_ms=(999*numerator/(1000*denominator)+1)/1000
 # Conservative IEEE-754 bound for the absolute-timestamp arithmetic; not fitted to results.
 fp_ms=16*math.ulp(max(start/1000,end/1000,s0,s1,e0,e1,1))
 uv_rounding_ms=.000001 # Full variation of libuv integer-nanosecond truncation.
 epsilon=quantization_spread_ms+uv_rounding_ms+sleep_upper_ms+fp_ms
 a=[s0-start/1000-epsilon,s1-start/1000+epsilon]
 z=[e0-end/1000-epsilon,e1-end/1000+epsilon]
 interval=[max(a[0],z[0]),min(a[1],z[1])]
 width=interval[1]-interval[0]
 names={n['id']:n['callFrame']['functionName']for n in profile['nodes']}
 hits={name:sum(names[id]==name for id in samples)for name in ['knownArithmeticPhase','knownStringPhase']}
 require(all(v>0 for v in hits.values()),'both known functions sampled')
 require(len(probe['windows'])==2,'two known windows')
 for w in probe['windows']:require(s1<=w['start']<=w['end']<=e0,'known window contained')
 return dict(kind='bounded-clock-probe-analysis-v1',alignmentQualified=0<=width<=.1,offsetIntervalMs=interval,widthMs=width,
  epsilonMs=epsilon,quantizationSpreadMs=quantization_spread_ms,sleepVariationUpperMs=sleep_upper_ms,floatBoundMs=fp_ms,uvRoundingSpreadMs=uv_rounding_ms,
  startBracketMs=s1-s0,stopBracketMs=e1-e0,sampleCount=len(samples),knownFunctionHits=hits,
  limitation='Known-function probe only. No consumer attribution or capture qualification. Offset envelope includes bounded clock-error variation; no fitted slope or midpoint.')
if __name__=='__main__':
 import sys
 root=Path(sys.argv[1]);read=lambda n:json.loads((root/n).read_text())
 print(json.dumps(verify(read('profile.json'),read('probe.json'),json.loads(Path(sys.argv[2]).read_text()),read('native-clock.json')),indent=2))
