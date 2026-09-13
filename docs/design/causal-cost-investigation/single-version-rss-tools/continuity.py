"""Parent-only continuity admission; no graph imports or child instrumentation."""
import math,time
class Continuity:
 def __init__(self):self.points=[]
 def record(self,phase):
  p={'wall':time.time(),'mono':time.monotonic(),'phase':phase};self.points.append(p)
  if not all(math.isfinite(p[k]) for k in ('wall','mono')):raise ValueError('nonfinite host clock')
  first=self.points[0];elapsed=max(p['wall']-first['wall'],p['mono']-first['mono'])
  if abs((p['wall']-first['wall'])-(p['mono']-first['mono']))>.5:raise ValueError('host clock discontinuity')
  if len(self.points)>1:
   prev=self.points[-2]
   if p['wall']<prev['wall'] or p['mono']<prev['mono']:raise ValueError('host clock reversal')
   if phase.startswith('child:') and prev['phase']==phase and max(p['wall']-prev['wall'],p['mono']-prev['mono'])>1:raise ValueError('host observation gap')
  if elapsed>900:raise ValueError('attempt deadline')
  return elapsed
