"""Design arithmetic only: no clock reads, inspector, subprocess or consumers."""
from fractions import Fraction as F
import json
r=F(125,3)
elo=-999*r/1000000;ehi=F(1,1000)
slo=F(120000);shi=slo+F(37,24000) # hypothetical absolute accumulated-sleep interval
jlo=F(-240000);jhi=jlo+F(1,100)
lo=jlo+slo-ehi-F(1,1000000);hi=jhi+shi-elo
checked=0
for a in range(3000):
 q=(a//1000*125)//3+1
 err=F(q,1000)-a*r/1000000
 assert elo<=err<=ehi
 for sleep in [slo,(slo+shi)/2,shi]:
  for k in [jlo,(jlo+jhi)/2,jhi]:
   # C may be rational here to include extreme uv rounding envelopes conservatively.
   for uv_err in [-F(1,1000000),F(0)]:
    actual=k+sleep-err+uv_err
    assert lo<=actual<=hi
    checked+=1
assert hi-lo<F(1,10)
assert hi+F(1,10)-lo>F(1,10) # sleep uncertainty grows the interval, never fits it away
assert hi+F(1,5)-lo>F(1,10) # a widened anchor cannot qualify
# Same-clock bracket intersection: empty intersection must fail, no midpoint.
assert max(F(0),F(2))>min(F(1),F(3))
print(json.dumps(dict(designArithmetic=True,runtimeExecutions=0,exactResidues=3000,envelopeCases=checked,
 exampleWidthMs=float(hi-lo),exampleIsNotMeasurement=True,quantizationWidthMs=float(ehi-elo)),indent=2))
