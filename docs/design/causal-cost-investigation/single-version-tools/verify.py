"""Independent raw-evidence verifier; never executes a consumer. Python stdlib only."""
import hashlib,json,math,pathlib,statistics,sys
B='8253488bd7458a8f6caeb31e79fa04e4f870c77b'; C='9c30967c8953ae09aa8de5949e0fbdd6de3c4813'
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_text())
def require(ok,msg):
 if not ok:raise ValueError(msg)
def obj(kind,b):return hashlib.sha1(kind.encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()
def phases(clocks):
 require(len(clocks) in (2,8),'clock count')
 require(all(type(x) in (int,float) and math.isfinite(x) for x in clocks),'finite clocks')
 require(all(b>=a for a,b in zip(clocks,clocks[1:])),'clock order')
 if len(clocks)==2:return {'release':clocks[1]-clocks[0]}
 a={k:clocks[i+1]-clocks[i] for i,k in zip((0,2,4,6),('construction','initial','duplicate','cleanup'))}
 a['actionSum']=sum(a.values());a['wall']=clocks[7]-clocks[0];a['residual']=a['wall']-a['actionSum'];return a
def percentile(v,p):
 require(len(v)>0 and all(math.isfinite(x) and x>=0 for x in v),'numeric samples')
 return sorted(v)[math.ceil(len(v)*p)-1]
def continuity(root,r,terminal,complete):
 require(r.get('continuity')=={'clockSkewSeconds':.5,'childObservationGapSeconds':1},'continuity policy')
 points=read(root/'continuity.json');require(points and points[0]['phase']=='start','host start')
 require(all(set(p)=={'wall','mono','phase'} and isinstance(p['phase'],str) and all(type(p[k]) in (int,float) and math.isfinite(p[k]) for k in ('wall','mono')) for p in points),'host clocks shape')
 issues=[]
 for i,p in enumerate(points):
  w=p['wall']-points[0]['wall'];m=p['mono']-points[0]['mono']
  if abs(w-m)>.5:issues.append('clock discontinuity')
  if max(w,m)>900:issues.append('attempt deadline')
  if i:
   last=points[i-1];dw=p['wall']-last['wall'];dm=p['mono']-last['mono']
   if min(dw,dm)<0:issues.append('clock reversal')
   if p['phase'].startswith('child:') and last['phase']==p['phase'] and max(dw,dm)>1:issues.append('observation gap')
 for j in range(complete):
  child=[p for p in points if p['phase']=='child:'+str(j)]
  require(len(child)>=2,'missing child host endpoints')
  require(max(child[-1][k]-child[0][k] for k in ('wall','mono'))<=30,'child host deadline')
 if terminal is None or terminal['failure'] is None:require(not issues,'host continuity '+str(issues))
 if terminal is not None and terminal['failure'] is None:
  require(points[-1]['phase']=='finish','host finish')
  require(terminal['seconds']>=max(points[-1][k]-points[0][k] for k in ('wall','mono')),'host terminal elapsed')
 return {'points':len(points),'violations':sorted(set(issues))}
def inspect(root,complete=None):
 root=pathlib.Path(root)
 if (root/'initialization-failure.json').exists():
  z=read(root/'initialization-failure.json')
  require(z['completed']==z['dispatched']==z['retries']==0 and z['notRun']==list(range(32)) and isinstance(z['failure'],str) and bool(z['failure']),'initialization failure')
  require(not (root/'jobs').exists() or not list((root/'jobs').iterdir()),'initialization dispatched jobs')
  return {'passed':True,'completed':0,'samples':0,'failure':z['failure'],'initializationFailure':True,'numericalComparisonComplete':False}
 r=read(root/'reservation.json')
 terminal=read(root/'result.json') if (root/'result.json').exists() else None
 if complete is None:
  require(terminal is not None,'terminal result required');complete=terminal['completed']
 try:host=continuity(root,r,terminal,complete)
 except (ValueError,KeyError,TypeError,UnicodeError) as ex:
  if terminal is None or terminal['failure'] is None:raise
  host={'violations':['invalid host evidence: '+str(ex)],'rawDigest':sha((root/'continuity.json').read_bytes())}
 require(r['budget']=={'children':32,'samples':3840,'warmup':20,'measured':100,'rssBytes':268435456,'childSeconds':30,'seconds':900,'retries':0},'budget')
 frozenBytes=(root/'frozen.json').read_bytes();frozen=json.loads(frozenBytes)
 require(sha(frozenBytes)==r['preparedDigest'],'preparation digest')
 require(r['assets']=={**frozen['assets'],'frozen.json':r['preparedDigest']},'approved asset set')
 drift=[f for f,h in r['assets'].items() if not (root/f).is_file() or sha((root/f).read_bytes())!=h]
 if drift and terminal is not None and terminal['failure']:
  return {'passed':True,'completed':0,'declaredCompleted':terminal['completed'],'samples':0,'failure':terminal['failure'],'assetDrift':drift,'numericalComparisonComplete':False}
 require(not drift,'asset drift '+str(drift))
 require(r['environment']=={'PATH':r['environment']['PATH'],'LANG':'C','TZ':'UTC'},'environment allowlist')
 require(sha((root/'P2-inputs.json').read_bytes())=='44f1165557fc1444540731a73846233ce3d71da7a0af3a3d4fa2137e249c2079','P2 identity')
 b=read(root/'build.json'); require(b['arms']['B']['commit']==B and b['arms']['C']['commit']==C,'commits')
 require((root/'B.mjs').read_bytes()==(root/'B-copy.mjs').read_bytes(),'B copy')
 require(set(b['arms']['B']['closure'])==set(b['arms']['C']['closure']),'closure sets')
 for label,arm in b['arms'].items():
  require(sha((root/(label+'.mjs')).read_bytes())==arm['bundleDigest'],'bundle')
  commit=(root/'git-objects'/arm['commit']).read_bytes();require(obj('commit',commit)==arm['commit'],'git commit')
  for f,entry in arm['closure'].items():
   raw=(root/'sources'/label/f).read_bytes();require(sha(raw)==entry['sha256'],'source')
   loaded=root/('sources' if entry['loadedSha256']==entry['sha256'] else 'loaded')/label/f
   require(sha(loaded.read_bytes())==entry['loadedSha256'],'loaded source')
   expected=raw
   if f=='scripts/fixtures/spending-preset-performance-worker.ts':
    text=raw.decode();require(text.count('function graphSnapshot(')==1,'snapshot transform anchor')
    text='import { expectedSnapshot } from "./causal-release-comparison-oracle.js";\n'+text.replace('function graphSnapshot(','export function graphSnapshot(')
    target='\t\t\teffects: saved.effects.length,';require(text.count(target)==1,'expected transform anchor')
    expected=text.replace(target,target+'\n\t\t\texpected: expectedSnapshot(c.plain),').encode()
   require(loaded.read_bytes()==expected,'allowlisted loaded transform')
   if entry['gitBlob'] is None:
    require(f in ('scripts/fixtures/causal-release-comparison.ts','scripts/fixtures/causal-release-comparison-oracle.ts'),'private input allowlist')
    require(raw==(root/'tools'/pathlib.Path(f).name).read_bytes(),'private input bytes');continue
   tree=commit.split(b'\n')[0].split()[1].decode()
   for component in f.split('/'):
    rawtree=(root/'git-objects'/tree).read_bytes();require(obj('tree',rawtree)==tree,'git tree');entries={}
    while rawtree:
     head,tail=rawtree.split(b'\0',1);entries[head.split(b' ',1)[1].decode()]=tail[:20].hex();rawtree=tail[20:]
    require(component in entries,'git member');tree=entries[component]
   require(tree==entry['gitBlob']==obj('blob',raw),'git source binding')
 diff=[f for f in b['arms']['B']['closure'] if b['arms']['B']['closure'][f]['sha256']!=b['arms']['C']['closure'][f]['sha256']]
 require(diff==['packages/ts/src/node/core.ts'],'sole difference')
 require([f for f in b['arms']['B']['closure'] if b['arms']['B']['closure'][f]['loadedSha256']!=b['arms']['C']['closure'][f]['loadedSha256']]==diff,'loaded closure differences')
 before=(root/'sources/B'/diff[0]).read_text();after=(root/'sources/C'/diff[0]).read_text()
 marker='export function makeDepBookkeeping('
 require(before.count(marker)==after.count(marker)==1,'factory marker')
 require(before.split(marker)[0]==after.split(marker)[0],'factory isolation')
 require(r['bits']==read(root/'order-bits.json'),'frozen order bits')
 require(len(r['bits'])==8 and all(type(x) is int and x in (0,1) for x in r['bits']) and sum(r['bits'])==4,'balanced order')
 schedule=[]
 for group,bit in enumerate(r['bits']):
  for position,arm in enumerate('BCCB' if bit==0 else 'CBBC'):
   schedule.append({'id':len(schedule),'row':'P2-lifecycle','group':group,'position':position,'arm':arm})
 require(r['schedule']==schedule,'schedule')
 node=read(root/'node-runtime.json')
 require(r['runtime']==node,'frozen Node runtime')
 require(r['environment']=={'PATH':str(pathlib.Path(node['execPath']).parent)+':/usr/bin:/bin:/usr/sbin:/sbin','LANG':'C','TZ':'UTC'},'fixed environment')
 jobs=sorted((root/'jobs').iterdir()) if (root/'jobs').exists() else []
 jobCount=complete
 if terminal is not None:
  require(terminal['completed']==complete and terminal['retries']==0,'terminal count/retries')
  require(terminal['reservationDigest']==sha((root/'reservation.json').read_bytes()),'terminal reservation')
  jobCount=terminal['dispatched'];require(jobCount in (complete,complete+1) and jobCount<=32,'dispatched')
  require(terminal['notRun']==list(range(jobCount,32)),'not-run')
  require(math.isfinite(terminal['seconds']) and terminal['seconds']>0,'terminal elapsed')
  if terminal['failure'] is None:require(complete==jobCount==32 and terminal['seconds']<=900,'successful terminal boundary')
  else:require(isinstance(terminal['failure'],str) and terminal['failure'],'failure reason')
 require([p.name for p in jobs]==[f'{i:02d}' for i in range(jobCount)],'hidden/missing jobs')
 require(0<=complete<=32,'count');pids=set();summaries=[];maxrss=0;maxgap=0
 for j in schedule[:complete]:
  d=root/'jobs'/f"{j['id']:02d}";e=read(d/'entry.json');ident=read(d/'identity.json');done=read(d/'completion.json');out=read(d/'exit.json');pre=read(d/'preflight.json')
  modules=['run-slot/bundle.mjs']
  require(e=={**j,'modules':modules,'moduleDigests':{m:sha((root/(j['arm']+'.mjs')).read_bytes()) for m in modules},'inputDigest':sha((root/'P2-inputs.json').read_bytes())},'entry')
  require(read(d/'projection.json')=={'arm':j['arm'],'digest':sha((root/(j['arm']+'.mjs')).read_bytes())},'projection binding')
  require((d/'bundle.mjs').read_bytes()==(root/(j['arm']+'.mjs')).read_bytes(),'retained slot bytes')
  require(read(d/'slot.json')=={'path':r['originalRoot']+'/run-slot/bundle.mjs','before':sha((d/'bundle.mjs').read_bytes()),'after':sha((d/'bundle.mjs').read_bytes()),'childReaped':True},'slot lifecycle receipt')
  require(ident['entryDigest']==sha((d/'entry.json').read_bytes()),'entry digest')
  actualEnv=dict(ident['env']);encoding=actualEnv.pop('__CF_USER_TEXT_ENCODING',None)
  require(encoding is None or (ident['platform']=='darwin' and encoding=='0x1F5:0x0:0x0'),'system environment')
  require(actualEnv==r['environment'] and all(ident[k]==r['runtime'][k] for k in ['node','v8','platform','arch','execPath']),'runtime')
  require(ident['argv']==[r['runtime']['execPath'],r['originalRoot']+'/tools/child.mjs',r['originalRoot']+f"/jobs/{j['id']:02d}/entry.json"],'argv')
  require(ident['pid'] not in pids and done['pid']==out['pid']==ident['pid'],'PID');pids.add(ident['pid'])
  require(done=={'completed':True,'samples':120,'pid':ident['pid']} and out['code']==0 and out['failure'] is None,'completion')
  require(0<out['seconds']<=30 and out['wakeBefore']==out['wakeAfter']==r['wake'],'duration/wake')
  require(out['rss'] and all(type(x[1]) is int and 0<x[1]<=268435456 for x in out['rss']),'RSS');maxrss=max(maxrss,max(x[1] for x in out['rss']))
  times=[x[0] for x in out['rss']];require(all(math.isfinite(t) and 0<=t<=out['seconds'] for t in times) and all(b>a for a,b in zip(times,times[1:])),'RSS time coordinates')
  maxgap=max(maxgap,max(b-a for a,b in zip([0]+times,times+[out['seconds']])))
  require(len(pre['checks'])==len(pre['expected'])==len(pre['expectedJSON'])==1,'single-arm preflight')
  require(pre['instances']==7,'preflight count')
  if j['row']=='P2-lifecycle':
   require(all(json.loads(pre['expectedJSON'][i])==pre['expected'][i] for i in range(1)),'expected serialization')
   expectedDigest=sha(pre['expectedJSON'][0].encode())
   if summaries:require(expectedDigest==summaries[0]['expectedDigest'],'cross-process oracle agreement')
   for check in pre['checks']:require(check['cold']['passed'] and check['steady']['passed'],'plain/reference preflight')
  else:require(all(x=={'passed':True,'instances':1} for x in pre['checks']),'micro preflight')
  samples=[json.loads(l) for l in (d/'samples.jsonl').read_text().splitlines()];require(len(samples)==120,'sample count')
  for position in range(1):
   values={};slot=0
   for index in range(120):
    s=samples[index];require(all(s[k]==v for k,v in {'block':0,'position':position,'slot':slot,'index':index,'phase':'warmup' if index<20 else 'measured'}.items()),'coordinate')
    require(s['outcome']=='released' and s['releaseCompleted'] is True,'release')
    require(len(s['clocks'])==(8 if j['row']=='P2-lifecycle' else 2),'row clocks');v=phases(s['clocks'])
    if j['row']=='P2-lifecycle':require(s['before']==s['after']==1 and s['snapshotDigest']==sha(pre['expectedJSON'][slot].encode()),'snapshot/occurrence')
    else:require(s['snapshotDigest'] is None,'negative snapshot')
    if index>=20:
     for k,x in v.items():values.setdefault(k,[]).append(x)
   summaries.append({**j,'slot':slot,'expectedDigest':expectedDigest,'metrics':{k:{'p95':percentile(v,.95),'p50':statistics.median(v),'sum':sum(v)} for k,v in values.items()}})
 failedJob=None
 if jobCount>complete:
  d=jobs[-1];j=schedule[complete];e=read(d/'entry.json');out=read(d/'exit.json')
  require(all(e[k]==v for k,v in j.items()),'failed entry coordinates')
  modules=['run-slot/bundle.mjs'];require(e['modules']==modules and e['moduleDigests']=={m:sha((root/(j['arm']+'.mjs')).read_bytes()) for m in modules} and e['inputDigest']==sha((root/'P2-inputs.json').read_bytes()),'failed entry bindings')
  if (d/'identity.json').exists():
   ident=read(d/'identity.json');require(ident['pid']==out['pid'] and ident['entryDigest']==sha((d/'entry.json').read_bytes()),'failed identity')
  raw=(d/'samples.jsonl').read_bytes() if (d/'samples.jsonl').exists() else b''
  valid=0;invalid=None
  for n,line in enumerate(raw.splitlines()):
   try:
    require(n<120,'failed prefix overflow');z=json.loads(line);pos=0;index=n
    require(z['position']==pos and z['index']==index and z['slot']==0 and z['block']==0 and z['phase']==('warmup' if index<20 else 'measured'),'failed prefix coordinates');phases(z['clocks']);valid+=1
   except (ValueError,KeyError,TypeError,UnicodeError) as ex:
    invalid={'line':n+1,'reason':str(ex)};break
  failedJob={'id':complete,'samples':valid,'exit':out,'numericalComparisonComplete':False,'rawSampleDigest':sha(raw),'rawSampleBytes':len(raw),'invalidSuffix':invalid}
 return {'passed':True,'continuity':host,'completed':complete,'samples':complete*120,'maxRssBytes':maxrss,'maxObservedRssGapSeconds':maxgap,'blocks':summaries,'failure':terminal['failure'] if terminal else None,'failedJob':failedJob}
def report(v):
 require(v['completed']==32 and v['failure'] is None,'full comparison required')
 result={}
 for metric in v['blocks'][0]['metrics']:
  result[metric]={}
  for statistic in ['p50','p95']:
   groups=[]
   for group in range(8):
    z=[b for b in v['blocks'] if b['group']==group]
    arms={arm:[b['metrics'][metric][statistic] for b in z if b['arm']==arm] for arm in ['B','C']}
    require(all(len(a)==2 and all(math.isfinite(x) and x>0 for x in a) for a in arms.values()),'nonpositive/group statistic')
    b,c=arms['B'],arms['C'];groups.append({'group':group,'ratio':math.sqrt((c[0]/b[0])*(c[1]/b[1])),'controls':{'B':b[1]/b[0],'C':c[1]/c[0]}})
   stable=all(1/1.05<=x<=1.05 for g in groups for x in g['controls'].values())
   ratios=[g['ratio'] for g in groups]
   label='control-unstable/inconclusive' if not stable else 'observed consistent decrease' if all(x<1 for x in ratios) else 'observed consistent increase' if all(x>1 for x in ratios) else 'mixed/inconclusive'
   result[metric][statistic]={'label':label,'groups':groups,'ratioRange':[min(ratios),max(ratios)]}
 return {'passed':True,'completed':32,'samples':v['samples'],'maxRssBytes':v['maxRssBytes'],'maxObservedRssGapSeconds':v['maxObservedRssGapSeconds'],'metrics':result,'absoluteBlocks':v['blocks'],'formalAcceptance':False}
if __name__=='__main__':
 v=inspect(sys.argv[1],int(sys.argv[2]) if len(sys.argv)>2 else None)
 print(json.dumps(report(v) if v['completed']==32 and v['failure'] is None else v,separators=(',',':'),allow_nan=False))
