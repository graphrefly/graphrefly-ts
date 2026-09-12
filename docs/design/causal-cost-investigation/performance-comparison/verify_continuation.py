"""Independent raw-evidence verifier; never executes a consumer. Python stdlib only."""
import hashlib,json,math,pathlib,statistics,sys
B='60190fcc2f660df1164a0c351ff2083925b71baf'; C='f7ea7a5281550060620c2e671d12d06885a07fd2'
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
def inspect(root,complete=None):
 root=pathlib.Path(root);r=read(root/'reservation.json')
 if (root/'continuation.json').exists():
  amendment=read(root/'continuation.json')
  require(amendment['retainedChildren']==[0] and amendment['remainingChildren']==list(range(1,48)),'continuation schedule boundary')
  for f,h in amendment['bindings'].items():require(sha((root/f).read_bytes())==h,'continuation binding '+f)
 terminal=read(root/'continuation-result.json') if (root/'continuation-result.json').exists() else None
 if complete is None:
  require(terminal is not None,'terminal result required');complete=terminal['completed']
 require(r['budget']=={'children':48,'samples':6720,'warmup':20,'measured':50,'rssBytes':268435456,'childSeconds':30,'seconds':900,'retries':0},'budget')
 for f,h in r['assets'].items():require(sha((root/f).read_bytes())==h,'asset drift '+f)
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
 require(diff==['packages/ts/src/solutions/causal-occurrence/identity.ts'],'sole difference')
 require([f for f in b['arms']['B']['closure'] if b['arms']['B']['closure'][f]['loadedSha256']!=b['arms']['C']['closure'][f]['loadedSha256']]==diff,'loaded closure differences')
 before=(root/'sources/B'/diff[0]).read_text();after=(root/'sources/C'/diff[0]).read_text()
 start=after.index('// This call site receives a canonicalSnapshot-owned occurrence');end=after.index('/** D160: fixed identity transition helper',start)
 require(after.count('currentnessChanged(prior, value, occurrence)')==1,'callsite count')
 require(before==(after[:start]+after[end:]).replace('currentnessChanged(prior, value, occurrence)','dataKey(prior) !== dataKey(value)'),'comparator isolation')
 require(len(r['bits'])==24 and all(type(x) is int and x in (0,1) for x in r['bits']),'order bits')
 schedule=[]
 for rowIndex,row in enumerate(['P2-lifecycle','inactive-1']):
  for pair in range(6):
   for rep in range(2):
    for variant in (['U','V'] if r['bits'][rowIndex*12+pair*2+rep]==0 else ['V','U']):
     schedule.append({'id':len(schedule),'row':row,'pair':pair,'rep':rep,'variant':variant,'kind':'control' if pair in (0,5) else 'main'})
 require(r['schedule']==schedule,'schedule')
 jobs=sorted((root/'jobs').iterdir()) if (root/'jobs').exists() else []
 jobCount=complete
 if terminal is not None:
  require(terminal['completed']==complete and terminal['retries']==0,'terminal count/retries')
  require(terminal['reservationDigest']==sha((root/'reservation.json').read_bytes()),'terminal reservation')
  jobCount=terminal['dispatched'];require(jobCount in (complete,complete+1) and jobCount<=48,'dispatched')
  require(terminal['notRun']==list(range(jobCount,48)),'not-run')
  require(math.isfinite(terminal['seconds']) and terminal['seconds']>0,'terminal elapsed')
  if terminal['failure'] is None:require(complete==jobCount==48 and terminal['seconds']<=900,'successful terminal boundary')
  else:require(isinstance(terminal['failure'],str) and terminal['failure'],'failure reason')
 require([p.name for p in jobs]==[f'{i:02d}' for i in range(jobCount)],'hidden/missing jobs')
 require(0<=complete<=48,'count');pids=set();summaries=[];maxrss=0;maxgap=0
 for j in schedule[:complete]:
  d=root/'jobs'/f"{j['id']:02d}";e=read(d/'entry.json');ident=read(d/'identity.json');done=read(d/'completion.json');out=read(d/'exit.json');pre=read(d/'preflight.json')
  modules=['B.mjs','B-copy.mjs' if j['kind']=='control' else 'C.mjs']
  require(e=={**j,'modules':modules,'moduleDigests':{m:sha((root/m).read_bytes()) for m in modules},'inputDigest':sha((root/'P2-inputs.json').read_bytes())},'entry')
  require(ident['entryDigest']==sha((d/'entry.json').read_bytes()),'entry digest')
  actualEnv=dict(ident['env'])
  systemEncoding=actualEnv.pop('__CF_USER_TEXT_ENCODING',None)
  require(systemEncoding is None or (r['runtime']['platform']=='darwin' and systemEncoding=='0x1F5:0x0:0x0'),'system environment')
  require(actualEnv==r['environment'] and all(ident[k]==r['runtime'][k] for k in ['node','v8','platform','arch','execPath']),'runtime')
  require(ident['argv']==[r['runtime']['execPath'],r['originalRoot']+'/tools/child.mjs',r['originalRoot']+f"/jobs/{j['id']:02d}/entry.json"],'argv')
  require(ident['pid'] not in pids and done['pid']==out['pid']==ident['pid'],'PID');pids.add(ident['pid'])
  require(done=={'completed':True,'samples':140,'pid':ident['pid']} and out['code']==0 and out['failure'] is None,'completion')
  require(0<out['seconds']<=30 and out['wakeBefore']==out['wakeAfter']==r['wake'],'duration/wake')
  require(out['rss'] and all(type(x[1]) is int and 0<x[1]<=268435456 for x in out['rss']),'RSS');maxrss=max(maxrss,max(x[1] for x in out['rss']))
  times=[x[0] for x in out['rss']];require(all(math.isfinite(t) and 0<=t<=out['seconds'] for t in times) and all(b>a for a,b in zip(times,times[1:])),'RSS time coordinates')
  maxgap=max(maxgap,max(b-a for a,b in zip([0]+times,times+[out['seconds']])))
  require(len(pre['checks'])==len(pre['expected'])==len(pre['expectedJSON'])==2,'two-arm preflight')
  require(pre['instances']==(14 if j['row']=='P2-lifecycle' else 2),'preflight count')
  if j['row']=='P2-lifecycle':
   require(all(json.loads(pre['expectedJSON'][i])==pre['expected'][i] for i in range(2)),'expected serialization')
   require(pre['expectedJSON'][0]==pre['expectedJSON'][1] and pre['expected'][0]==pre['expected'][1],'expected arms')
   for check in pre['checks']:require(check['cold']['passed'] and check['steady']['passed'],'plain/reference preflight')
  else:require(all(x=={'passed':True,'instances':1} for x in pre['checks']),'micro preflight')
  samples=[json.loads(l) for l in (d/'samples.jsonl').read_text().splitlines()];require(len(samples)==140,'sample count')
  for position in range(2):
   values={};slot=(position+(j['variant']=='V'))%2
   for index in range(70):
    s=samples[position*70+index];require(all(s[k]==v for k,v in {'block':0,'position':position,'slot':slot,'index':index,'phase':'warmup' if index<20 else 'measured'}.items()),'coordinate')
    require(s['outcome']=='released' and s['releaseCompleted'] is True,'release')
    require(len(s['clocks'])==(8 if j['row']=='P2-lifecycle' else 2),'row clocks');v=phases(s['clocks'])
    if j['row']=='P2-lifecycle':require(s['before']==s['after']==1 and s['snapshotDigest']==sha(pre['expectedJSON'][slot].encode()),'snapshot/occurrence')
    else:require(s['snapshotDigest'] is None,'negative snapshot')
    if index>=20:
     for k,x in v.items():values.setdefault(k,[]).append(x)
   summaries.append({**j,'position':position,'slot':slot,'metrics':{k:{'p95':percentile(v,.95),'p50':statistics.median(v),'sum':sum(v)} for k,v in values.items()}})
 failedJob=None
 if jobCount>complete:
  d=jobs[-1];j=schedule[complete];e=read(d/'entry.json');out=read(d/'exit.json')
  require(all(e[k]==v for k,v in j.items()),'failed entry coordinates')
  modules=['B.mjs','B-copy.mjs' if j['kind']=='control' else 'C.mjs'];require(e['modules']==modules and e['moduleDigests']=={m:sha((root/m).read_bytes()) for m in modules} and e['inputDigest']==sha((root/'P2-inputs.json').read_bytes()),'failed entry bindings')
  if (d/'identity.json').exists():
   ident=read(d/'identity.json');require(ident['pid']==out['pid'] and ident['entryDigest']==sha((d/'entry.json').read_bytes()),'failed identity')
  samples=[json.loads(l) for l in (d/'samples.jsonl').read_text().splitlines()] if (d/'samples.jsonl').exists() else []
  require(len(samples)<=140,'failed prefix count')
  for n,s in enumerate(samples):
   pos=n//70;index=n%70;require(s['position']==pos and s['index']==index and s['slot']==(pos+(j['variant']=='V'))%2 and s['block']==0 and s['phase']==('warmup' if index<20 else 'measured'),'failed prefix coordinates');phases(s['clocks'])
  failedJob={'id':complete,'samples':len(samples),'exit':out,'numericalComparisonComplete':False}
 return {'passed':True,'completed':complete,'samples':complete*140,'maxRssBytes':maxrss,'maxObservedRssGapSeconds':maxgap,'blocks':summaries,'failure':terminal['failure'] if terminal else None,'failedJob':failedJob}
def report(v):
 require(v['completed']==48 and v['failure'] is None,'full comparison required');rows={}
 for row in ['P2-lifecycle','inactive-1']:
  blocks=[b for b in v['blocks'] if b['row']==row];result={}
  for metric in blocks[0]['metrics']:
   pairs=[]
   for pair in range(6):
    for pos in range(2):
     ratios=[]
     for rep in range(2):
      z=[b for b in blocks if b['pair']==pair and b['position']==pos and b['rep']==rep];base=next(b for b in z if b['slot']==0)['metrics'][metric]['p95'];cand=next(b for b in z if b['slot']==1)['metrics'][metric]['p95'];require(base>0 and cand>0,'nonpositive percentile');ratios.append(cand/base)
     pairs.append({'pair':pair,'position':pos,'kind':'control' if pair in (0,5) else 'main','ratios':ratios,'median':statistics.median(ratios)})
   control=[p['median'] for p in pairs if p['kind']=='control'];main=[p['median'] for p in pairs if p['kind']=='main'];stable=all(1/1.05<=x<=1.05 for x in control)
   label='control-unstable/inconclusive' if not stable else 'observed consistent decrease' if all(x<1 for x in main) else 'observed consistent increase' if all(x>1 for x in main) else 'mixed/inconclusive'
   result[metric]={'label':label,'mainMedianRange':[min(main),max(main)],'controlMedianRange':[min(control),max(control)],'pairs':pairs}
  rows[row]=result
 return {'passed':True,'completed':48,'samples':v['samples'],'maxRssBytes':v['maxRssBytes'],'maxObservedRssGapSeconds':v['maxObservedRssGapSeconds'],'rows':rows,'absoluteBlocks':v['blocks'],'formalAcceptance':False}
if __name__=='__main__':
 v=inspect(sys.argv[1],int(sys.argv[2]) if len(sys.argv)>2 else None)
 print(json.dumps(report(v) if v['completed']==48 and v['failure'] is None else v,separators=(',',':'),allow_nan=False))
