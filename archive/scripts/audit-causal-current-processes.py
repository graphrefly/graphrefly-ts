"""Supplementary time-origin/process-window audit independent of collector statistics."""
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);origins=set();pids=set();samples=0
for d in sorted(root.glob('[0-9][0-9]-*')):
 m=json.loads((d/'worker.json').read_text());e=json.loads((d/'exit.json').read_text())
 assert m['timeOrigin'] not in origins and m['pid'] not in pids
 origins.add(m['timeOrigin']);pids.add(m['pid'])
 assert e['startWall']*1000-1000<=m['timeOrigin']<=e['endWall']*1000
 for line in (d/'samples.jsonl').read_text().splitlines():
  x=json.loads(line);assert e['startWall']*1000-1000<=m['timeOrigin']+x['start']<=m['timeOrigin']+x['end']<=e['endWall']*1000+1000;samples+=1
assert len(pids)==40 and samples==96000
print(json.dumps({'verified':True,'uniqueProcesses':len(pids),'uniqueTimeOrigins':len(origins),'samplesWithinRecordedProcessWindows':samples}))
