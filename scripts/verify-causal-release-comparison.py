"""Independent archive/prefix verification and arithmetic; imports no collector code."""
import hashlib,json,math,pathlib,statistics,sys,subprocess,re
ROWS=['P2-lifecycle','inactive-60','active-diamond-5','inactive-2','inactive-1']
COMMITS={'B':'2f19cc0d79937bee0faa462cc9f2cf5209b62111','C':'907eec8138cddce9f8ff0e74d9f19d60db8c5b96'}
INPUT='44f1165557fc1444540731a73846233ce3d71da7a0af3a3d4fa2137e249c2079'
def require(ok,message):
 if not ok: raise ValueError(message)
def sha(data): return hashlib.sha256(data).hexdigest()
def read(p): return json.loads(p.read_bytes())
def phases(clocks,row):
 n=8 if row==ROWS[0] else 2
 require(len(clocks)==n,'clock count')
 require(all(type(x) in (int,float) and math.isfinite(x) for x in clocks),'finite clock')
 require(all(a<=b for a,b in zip(clocks,clocks[1:])),'backward clock')
 if n==2:return {'release':clocks[1]-clocks[0]}
 values=[clocks[i+1]-clocks[i] for i in (0,2,4,6)]
 total=sum(values);wall=clocks[7]-clocks[0]
 return dict(zip(['construction','initial-input','duplicate-input','cleanup','sum','wall-span','residual'],values+[total,wall,wall-total]))
def stats(values):
 require(len(values)==300,'measured count')
 ordered=sorted(values)
 return {'p95':ordered[284],'p50':ordered[149],'sum':sum(values)}
def ratios(a,b): return a/b if a>0 and b>0 else None
def median(values): return statistics.median(values) if all(v is not None for v in values) else None
def label(controls,main):
 if any(v is None or not 1/1.05<=v<=1.05 for v in controls):return 'control-unstable/inconclusive'
 if all(v is not None and v<1 for v in main):return 'observed consistent decrease'
 if all(v is not None and v>1 for v in main):return 'observed consistent increase'
 return 'mixed/inconclusive'
def schedule(bits):
 require(len(bits)==30 and all(type(b)==int and b in (0,1) for b in bits),'30 bits')
 out=[]
 for r,row in enumerate(ROWS):
  for pair in range(6):
   for variant in (['U','V'] if bits[r*6+pair]==0 else ['V','U']):
    out.append({'id':len(out),'row':row,'pair':pair,'variant':variant,'kind':'control' if pair in (0,5) else 'main'})
 return out

def git_binding(root,commit,file,blob):
 def obj(oid,kind):
  data=(root/'git-objects'/oid).read_bytes()
  require(hashlib.sha1(kind.encode()+b' '+str(len(data)).encode()+b'\0'+data).hexdigest()==oid,'git object hash')
  return data
 tree=obj(commit,'commit').split(b'\n')[0].decode().split(' ')[1]
 for part in file.split('/'):
  raw=obj(tree,'tree');entries={}
  while raw:
   header,tail=raw.split(b'\0',1);name=header.split(b' ',1)[1].decode();entries[name]=tail[:20].hex();raw=tail[20:]
  require(part in entries,'tree path');tree=entries[part]
 require(tree==blob,'commit blob mapping')

def admission(root):
 reservation=read(root/'reservation.json'); build=read(root/'build.json')
 require(reservation['budget']=={'processes':60,'samples':144000,'seconds':900,'childSeconds':30,'rssBytes':268435456,'retries':0},'budget')
 require(reservation['schedule']==schedule(reservation['bits']),'schedule')
 require(sha((root/'P2-inputs.json').read_bytes())==INPUT,'input identity')
 s=read(root/'P2-inputs.json');require(len(s['steps'])==6 and len(s['evaluations'])==1,'P2 shape')
 approval=read(root/'tools/approval.json')
 require(approval['proposalCommit']=='fc5acae0' and approval['approvedSections']=='2–6' and approval['budget']==reservation['budget'],'approval')
 require(sha((root/'tools/proposal.md').read_bytes())==approval['designDigest'].removeprefix('sha256:'),'proposal binding')
 qualification=read(root/'tools/qualification.json');require(qualification['passed'] is True,'qualification')
 require(set(qualification['sources'])=={'build-causal-release-comparison.mjs','rebuild-causal-release-comparison.mjs','causal-release-comparison-child.mjs','causal-release-comparison-driver.mjs','verify-causal-release-comparison.py','collect-causal-release-comparison.py','causal-release-comparison.test.mjs','test-causal-release-comparison.py','causal-release-comparison.ts','causal-release-comparison-oracle.ts'},'qualification source inventory')
 require(set(qualification['evidence'])=={'js-qualification.log','python-qualification.log','counting-regression.log','scoped-biome.log','review.md'},'qualification evidence inventory')
 for name,digest in {**qualification['sources'],**qualification['evidence']}.items():require(sha((root/'tools'/name).read_bytes())==digest,'qualification binding '+name)
 for name,digest in reservation['tools'].items():require(sha((root/'tools'/name).read_bytes())==digest,'tool drift '+name)
 require((root/'B.mjs').read_bytes()==(root/'B-copy.mjs').read_bytes(),'copy bytes')
 require(set(build['arms'])=={'B','C'},'arm set')
 loaded={}
 for arm,commit in COMMITS.items():
  info=build['arms'][arm];require(info['commit']==commit,'commit identity')
  require(sha((root/f'{arm}.mjs').read_bytes())==info['bundleDigest'],'bundle identity')
  closure=info['closure']; loaded[arm]={}
  meta=read(root/f'{arm}-metafile.json')
  require(set(meta['inputs'])=={'snapshot:'+k for k in closure},'complete import closure')
  for file,entry in closure.items():
   raw=(root/'sources'/arm/file).read_bytes();require(sha(raw)==entry['sha256'],'source hash')
   if entry['gitBlob']:
    require(hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==entry['gitBlob'],'blob bytes')
    git_binding(root,commit,file,entry['gitBlob'])
   else:require(file in ['scripts/fixtures/causal-release-comparison.ts','scripts/fixtures/causal-release-comparison-oracle.ts'] and raw==(root/'tools'/pathlib.Path(file).name).read_bytes(),'wrapper identity')
   actual=raw
   if file=='scripts/fixtures/spending-preset-performance-worker.ts':
    text=raw.decode();require(text.count('function graphSnapshot(')==1,'snapshot export transform')
    text='import { expectedSnapshot } from "./causal-release-comparison-oracle.js";\n'+text.replace('function graphSnapshot(','export function graphSnapshot(')
    target='\t\t\teffects: saved.effects.length,';require(text.count(target)==1,'preflight transform')
    text=text.replace(target,target+'\n\t\t\texpected: expectedSnapshot(c.plain),')
    actual=text.encode();require(actual==(root/'loaded'/arm/file).read_bytes(),'allowlisted transform')
   require(sha(actual)==entry['loadedSha256'],'loaded bytes')
   loaded[arm][file]=raw
  require(len(re.findall(r'\bperformance\.now\(\)', (root/f'{arm}.mjs').read_text()))==2,'only frozen recorder clock sites')
  require(not re.search(r'''\bperformance\s*\[|\[\s*["']performance["']\s*\]''', (root/f'{arm}.mjs').read_text()),'computed performance access')
  require(b'private _recording = false;' in loaded[arm]['packages/ts/src/dispatcher/index.ts'],'recorder default off')
 require(set(loaded['B'])==set(loaded['C']),'closure sets')
 differences=[k for k in sorted(loaded['B']) if loaded['B'][k]!=loaded['C'][k]]
 require(differences==['packages/ts/src/graph/graph.ts'],'sole runtime difference')
 bodies=[]
 for arm in ['B','C']:
  src=loaded[arm][differences[0]].decode();start=src.index('\tprivate _releaseNodes(');end=src.index('\n\t// ── 8 verbs',start)
  bodies.append(src[:start]+src[end:])
 require(bodies[0]==bodies[1],'outside release method')
 rebuilt=json.loads(subprocess.check_output([reservation['runtime']['execPath'],str(root/'tools/rebuild-causal-release-comparison.mjs'),str(root)],env=reservation['environment'],timeout=30))
 require(rebuilt=={'passed':True,'bundles':{k:build['arms'][k]['bundleDigest'] for k in ['B','C']},'newSamples':0},'independent rebuild')
 return reservation,build

def child(root,job,reservation,build):
 folder=root/'jobs'/f"{job['id']:02d}"
 entry=read(folder/'entry.json');identity=read(folder/'identity.json');exit_=read(folder/'exit.json');completion=read(folder/'completion.json');pre=read(folder/'preflight.json')
 require(all(entry[k]==v for k,v in job.items()),'entry schedule identity')
 modules=['B.mjs','B-copy.mjs' if job['kind']=='control' else 'C.mjs']
 require(entry['modules']==modules and entry['inputDigest']==INPUT,'physical slots/input')
 require(entry['moduleDigests']=={n:sha((root/n).read_bytes()) for n in modules},'module digests')
 require(identity['entryDigest']==sha((folder/'entry.json').read_bytes()),'entry bytes')
 runtime=reservation['runtime']
 require(all(identity[k]==runtime[k] for k in ['node','v8','platform','arch','execPath']),'runtime identity')
 require(identity['env']==reservation['environment'],'environment identity')
 expectedargv=[runtime['execPath'],reservation['originalRoot']+'/tools/causal-release-comparison-child.mjs',reservation['originalRoot']+f"/jobs/{job['id']:02d}/entry.json"]
 require(identity['argv']==expectedargv and exit_['argv']==expectedargv,'argv')
 require(exit_['pid']==identity['pid']==completion['pid'],'process identity')
 require(exit_['code']==0 and exit_['failure'] is None and completion=={'completed':True,'samples':2400,'pid':identity['pid']},'child success')
 require(0<=exit_['elapsed']<=30 and exit_['maxRSS']<=268435456,'child resources')
 observations=exit_['rssObservations'];require(len(observations)>0 and all(type(x[1])==int and x[1]>0 for x in observations) and max(x[1] for x in observations)==exit_['maxRSS'],'RSS observation evidence')
 require(all(exit_['startMono']<=x[0]<=exit_['endMono'] for x in observations),'RSS observation clock')
 require(exit_['wakeBefore']==exit_['wakeAfter']==reservation['wake'],'wake boundary')
 require(pre['instances']==(14 if job['row']==ROWS[0] else 2),'preflight instances')
 expected_hashes=[]
 if job['row']==ROWS[0]:
  require(len(pre['checks'])==2 and pre['expected'][0]==pre['expected'][1],'preflight arms')
  for i,check in enumerate(pre['checks']):
   for p in ['cold','steady']:
    require(check[p]['passed'] is True and check[p]['assessments']==1,'business preflight')
    for arm in ['candidate','reference']:require(len(check[p]['topology'][arm])==60,'preflight topology')
   require(check['steady']['beforeOccurrences']==check['steady']['afterOccurrences']==1 and check['steady']['preWaveNew']==0,'duplicate preflight')
   require(json.loads(pre['expectedJSON'][i])==pre['expected'][i],'expected raw vector')
   expected_hashes.append(sha(pre['expectedJSON'][i].encode()))
 else:require(pre['checks']==[{'passed':True,'instances':1}]*2,'micro preflight')
 records=[json.loads(line) for line in (folder/'samples.jsonl').read_text().splitlines()]
 require(len(records)==2400,'sample inventory')
 distributions={};clock_reads=0;last_end=None
 for n,record in enumerate(records):
  block=n//800;position=n%800//400;index=n%400;slot=(block+position+(job['variant']=='V'))%2
  coord={'block':block,'position':position,'index':index,'slot':slot,'phase':'warmup' if index<100 else 'measured'}
  require(all(record[k]==v for k,v in coord.items()),'sample coordinate')
  p=phases(record['clocks'],job['row']);clock_reads+=len(record['clocks'])
  require(last_end is None or record['clocks'][0]>=last_end,'sample clock replay');last_end=record['clocks'][-1]
  active=job['row']=='active-diamond-5'
  require(record['outcome']==('rejected-then-cleaned' if active else 'released') and record['releaseCompleted']==(not active),'release outcome')
  if job['row']==ROWS[0]:require(record['before']==record['after']==1 and record['snapshotDigest']==expected_hashes[slot],'sample semantics')
  else:require(record['snapshotDigest'] is None,'micro snapshot')
  if index>=100:
   for phase,value in p.items():distributions.setdefault(f'{block}/{position}/{slot}/{phase}',[]).append(value)
 return {'pid':identity['pid'],'samples':2400,'clockReads':clock_reads,'preflightInstances':pre['instances'],'blocks':{k:stats(v) for k,v in distributions.items()}}

def report(jobs,results):
 output={}
 for row in ROWS:
  selected=[j for j in jobs if j['row']==row]
  if len(selected)!=12:continue
  phases_=['construction','initial-input','duplicate-input','cleanup','sum','wall-span','residual'] if row==ROWS[0] else ['release']
  output[row]={}
  for phase in phases_:
   pairs=[]
   for pair in range(6):
    entries=[j for j in selected if j['pair']==pair]; positions=[]
    for pos in range(2):
     values=[]
     for block in range(3):
      p95={}
      for job in entries:
       slot=(block+pos+(job['variant']=='V'))%2
       p95[slot]=results[str(job['id'])]['blocks'][f'{block}/{pos}/{slot}/{phase}']['p95']
      values.append({'block':block,'B':p95[0],'other':p95[1],'ratio':ratios(p95[1],p95[0])})
     positions.append({'position':pos,'blocks':values,'median':median([x['ratio'] for x in values])})
    pairs.append({'pair':pair,'kind':entries[0]['kind'],'positions':positions})
   controls=[p['median'] for i in (0,5) for p in pairs[i]['positions']];main=[p['median'] for i in range(1,5) for p in pairs[i]['positions']]
   output[row][phase]={'pairs':pairs,'label':label(controls,main),'mainRange':[min(main),max(main)] if all(x is not None for x in main) else None,'controls':controls}
 return output

def verify(root,count):
 terminal=read(root/'result.json') if count==-1 else None
 if terminal is not None:
  count=terminal['completed'];dispatched=terminal['dispatched']
  require(0<=count<=dispatched<=min(60,count+1),'terminal counts')
  require(terminal['retries']==0 and terminal['notRun']==list(range(dispatched,60)),'terminal not-run')
  require((count==60 and terminal['failure'] is None) or terminal['failure'] is not None,'terminal status')
  if not (root/'reservation.json').exists():
   require(count==dispatched==0 and terminal['failure'] is not None,'preparation failure')
   return {'passed':True,'captureStatus':'preparation-failed','children':0,'samples':0,'failure':terminal['failure'],'files':{str(p.relative_to(root)):sha(p.read_bytes()) for p in sorted(root.rglob('*')) if p.is_file()}}
 reservation,build=admission(root);require(0<=count<=60,'prefix count')
 expected_dirs={f'{i:02d}' for i in range(terminal['dispatched'] if terminal else count)}
 require({p.name for p in (root/'jobs').iterdir()}==expected_dirs,'hidden/stale job directories')
 results={};pids=set();previous_end=None
 for job in reservation['schedule'][:count]:
  result=child(root,job,reservation,build);require(result['pid'] not in pids,'reused pid');pids.add(result['pid']);results[str(job['id'])]=result
  ex=read(root/'jobs'/f"{job['id']:02d}"/'exit.json')
  require(previous_end is None or ex['startMono']>=previous_end,'serial processes');previous_end=ex['endMono']
  require(ex['endMono']-reservation['startMono']<=900,'whole deadline')
 answer={'passed':True,'children':count,'samples':count*2400,'clockReads':sum(x['clockReads'] for x in results.values()),'preflightInstances':sum(x['preflightInstances'] for x in results.values()),'results':results, 'comparison':report(reservation['schedule'][:count],results)}
 if terminal is not None:
  answer['captureStatus']='completed' if count==60 else 'failed'
  answer['terminal']=terminal
  if terminal['dispatched']>count:
   folder=root/'jobs'/f'{count:02d}';job=reservation['schedule'][count]
   available={p.name:sha(p.read_bytes()) for p in sorted(folder.iterdir()) if p.is_file()}
   detail={'job':job,'files':available}
   if (folder/'entry.json').exists():
    entry=read(folder/'entry.json');require(all(entry[k]==x for k,x in job.items()),'failed entry identity');detail['entry']=entry
   if (folder/'identity.json').exists():
    identity=read(folder/'identity.json');detail['identity']=identity
    require(identity['pid'] not in pids and identity['entryDigest']==sha((folder/'entry.json').read_bytes()),'failed process identity')
   for name in ['failure.json','exit.json','completion.json']:
    if (folder/name).exists():detail[name]=read(folder/name)
   if (folder/'samples.jsonl').exists():
    lines=(folder/'samples.jsonl').read_text().splitlines();require(len(lines)<=2400,'failed sample ceiling');detail['rawLines']=len(lines)
    valid=0
    for line in lines:
     try:record=json.loads(line);phases(record['clocks'],job['row']);valid+=1
     except Exception:break
    detail['arithmeticallyReadablePrefix']=valid
   answer['failedChild']=detail
 return answer
if __name__=='__main__':
 try:
  result=verify(pathlib.Path(sys.argv[1]),int(sys.argv[2]));print(json.dumps(result,separators=(',',':'),allow_nan=False))
 except Exception as e:
  print(json.dumps({'passed':False,'error':str(e)}));sys.exit(1)
