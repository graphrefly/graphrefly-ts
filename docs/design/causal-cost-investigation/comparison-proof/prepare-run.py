from pathlib import Path
import json,hashlib,tarfile,tempfile,subprocess,shutil
repo=Path(__file__).resolve().parents[4];out=Path(__file__).resolve().parent
base=repo/'archive/evals/causal-release-cost-comparison-v2';idx=json.loads((base/'artifact-index.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest();assert sha((base/'evidence.tar.gz').read_bytes())==idx['archiveSha256']
helper='''
let __stats;
export function __reset(){__stats={transitions:0,arrivals:{},currentness:{count:0,equal:0,chars:0,sameOccurrence:0,payloadPresent:0},quiescence:{count:0,equal:0,chars:0}};}
export function __take(){const s=__stats;__reset();return s;}
function __compare(a,b,label){const left=dataKey(a),right=dataKey(b),m=__stats[label];m.count++;m.equal+=left===right?1:0;m.chars+=left.length+right.length;if(label==='currentness'){m.sameOccurrence+=a.occurrence===b.occurrence?1:0;m.payloadPresent+=Object.hasOwn(b.occurrence,'value')?1:0;}return left!==right;}
__reset();
'''
with tempfile.TemporaryDirectory() as td:
 root=Path(td);bindings={}
 with tarfile.open(base/'evidence.tar.gz') as t:
  for name in ['B.mjs','P2-inputs.json']:
   raw=t.extractfile('run/'+name).read();assert sha(raw)==idx['files']['run/'+name];(root/name).write_bytes(raw);bindings[name]=sha(raw)
 s=(root/'B.mjs').read_text();before=s
 needle='dataKey(prior) !== dataKey(value2)';assert s.count(needle)==2
 s=s.replace(needle,'__compare(prior, value2, "currentness")',1).replace(needle,'__compare(prior, value2, "quiescence")',1)
 needle='function transitionCausalAuthority(prior, arrivals, opts) {';assert s.count(needle)==1
 s=s.replace(needle,needle+'\n__stats.transitions++;for(const a of arrivals)__stats.arrivals[a.lane]=(__stats.arrivals[a.lane]??0)+1;')
 s+=helper;(root/'instrumented.mjs').write_text(s)
 (out/'instrumentation.json').write_text(json.dumps({'inputHashes':bindings,'instrumentedSha256':sha(s.encode()),'comparisonSites':2,'semanticChange':'none; both original dataKey calls and comparison retained, extra counters only','maxTotalInstances':12,'timeoutSeconds':30,'retries':0},indent=2)+'\n')
 (out/'instrumentation.patch').write_text(''.join(__import__('difflib').unified_diff(before.splitlines(True),s.splitlines(True),fromfile='B.mjs',tofile='instrumented.mjs')))
 node=shutil.which('node')
 with (out/'stdout.log').open('wb') as stdout,(out/'stderr.log').open('wb') as stderr:
  try:r=subprocess.run([node,str(out/'count.mjs'),str(root),str(out)],env={'PATH':str(Path(node).parent)+':/usr/bin:/bin'},stdout=stdout,stderr=stderr,timeout=30);code=r.returncode
  except subprocess.TimeoutExpired:code=124
 (out/'exit.json').write_text(json.dumps({'code':code,'nodeExecutable':node,'nodeDigest':sha(Path(node).read_bytes())},indent=2)+'\n');print('exit',code)
