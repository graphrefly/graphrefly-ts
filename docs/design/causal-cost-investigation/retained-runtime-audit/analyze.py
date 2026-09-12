"""Read retained text events only. No clock alignment, profiling or consumer execution."""
import collections,csv,hashlib,json,re,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
run=ROOT/'archive/evals/causal-recording-diagnostic-v1/run'
index=json.loads((run.parent/'artifact-index.json').read_text())['files']
def read(relative):
 p=run/relative;raw=p.read_bytes();assert hashlib.sha256(raw).hexdigest()==index[relative],relative
 return raw.decode()
reservation=json.loads(read('reservation.json'))
rows=[];sites={}
for job in reservation['jobs']:
 prefix=f"{job['id']:02d}/";stdout=read(prefix+'stdout.log');native=read(prefix+'v8.log')
 gc=[];bailouts=collections.Counter();deopts=collections.Counter();unparsed=[]
 for line in stdout.splitlines():
  if re.match(r'^\[\d+:0x[0-9a-f]+\]\s+\d+ ms:',line):
   m=re.search(r'ms: (.*?) [\d.]+ \([\d.]+\) -> .*?, ([\d.]+) / ([\d.]+) ms',line)
   if m:gc.append(dict(label=m[1],reportedMainMs=float(m[2]),reportedSecondaryMs=float(m[3])))
   else:unparsed.append(line)
  if line.startswith('[bailout '):
   m=re.search(r'<JSFunction (.*?) \(sfi =',line);bailouts[m[1] if m else '<unparsed>']+=1
 for line in native.splitlines():
  if not line.startswith('code-deopt,'):continue
  fields=next(csv.reader([line]));assert len(fields)>=9,line
  m=re.fullmatch(r'<file://(.*/assets/(worker(?:-copy)?|EAGER|DEFERRED)\.mjs):(\d+):(\d+)>',fields[7])
  if m:
   file=Path(m[1]).name;line_no=int(m[3]);column=int(m[4]);key=f'{file}:{line_no}:{column}|{fields[6]}|'+','.join(fields[8:])
   source=read('assets/'+file).splitlines();assert 1<=line_no<=len(source)
   sites[key]=dict(file=file,line=line_no,column=column,sourceLine=source[line_no-1].strip())
  else:key=fields[7]+'|'+fields[6]+'|'+','.join(fields[8:])
  deopts[key]+=1
 samples=[json.loads(s) for s in read(prefix+'samples.jsonl').splitlines()]
 first=samples[100:400];p95=sorted(x['ms'] for x in first)[284]
 rows.append(dict(**job,firstPositionP95Ms=p95,gcEventCount=len(gc),gcLabels=dict(collections.Counter(x['label'] for x in gc)),
  gcReportedMainSumMs=sum(x['reportedMainMs'] for x in gc),gcReportedMainMaxMs=max((x['reportedMainMs'] for x in gc),default=0),
  stdoutBailoutCount=sum(bailouts.values()),stdoutFunctions=dict(bailouts),nativeDeoptCount=sum(deopts.values()),nativeSites=dict(deopts),unparsedGc=unparsed))
slow=rows[0];others=rows[1:];unique=[k for k in slow['nativeSites'] if all(k not in r['nativeSites'] for r in others)]
result=dict(scope='Whole-process retained event counts only; no shared clock or event duration attribution to construction. Stdout bailout and native code-deopt may describe the same events; never added together.',
 inputIndexSha256=hashlib.sha256((run.parent/'artifact-index.json').read_bytes()).hexdigest(),rows=rows,sourceSites=sites,
 slowChild=slow['id'],slowChildUniqueNativeSites=unique,
 ranges={k:dict(slow=slow[k],othersMin=min(r[k] for r in others),othersMedian=statistics.median(r[k] for r in others),othersMax=max(r[k] for r in others)) for k in ['gcEventCount','gcReportedMainSumMs','gcReportedMainMaxMs','stdoutBailoutCount','nativeDeoptCount']},
 consumerExecutions=0)
print(json.dumps(result,indent=2,allow_nan=False))
