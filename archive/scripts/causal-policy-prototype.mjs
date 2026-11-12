/** Disposable invocation-local prototype. Valid-fixture timing, not product qualification. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [mode,dir,arg]=process.argv.slice(2),root=resolve(dir);
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(readFileSync(resolve(root,p)));
const put=(p,v)=>writeFileSync(resolve(root,p),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
if(mode==='prepare'){
 mkdirSync(root);const countRoot=resolve(arg),source=readFileSync(resolve(countRoot,'original.mjs'),'utf8'),count=JSON.parse(readFileSync(resolve(countRoot,'result.json')));assert.equal(sha(source),count.originalSha256);
 const start=source.indexOf('  const publicationPolicy = make('),end=source.indexOf('  const occurrences = make(',start);assert.ok(start>0&&end>start);
 const part=source.slice(start,end);assert.equal([...part.matchAll(/\bsame\(/g)].length,5);assert.equal(part.split('    (ctx) => {').length,2);
 const changed=part.replace('    (ctx) => {','    (ctx) => { let __texts; const __equal=(a,b)=>{ const key=(v)=>{__texts??=new Map();if(__texts.has(v))return __texts.get(v);const text=canonicalMaterial(v);__texts.set(v,text);return text;};return key(a)===key(b);};').replace(/\bsame\(/g,'__equal(');
 const prototype=source.slice(0,start)+changed+source.slice(end);writeFileSync(resolve(root,'before.mjs'),source);writeFileSync(resolve(root,'after.mjs'),prototype);
 const inputs={};for(const p of ['P1','P3','P6']){const bytes=readFileSync(resolve(countRoot,p+'-inputs.json'));writeFileSync(resolve(root,p+'-inputs.json'),bytes);inputs[p]=sha(bytes);}
 const jobs=[];for(const profile of ['P1','P3','P6'])for(const recipe of ['initial','duplicate2','verification'])for(let repeat=0;repeat<3;repeat++)jobs.push({id:jobs.length,profile,recipe,repeat,control:false,order:repeat%2?['after','before']:['before','after']});
 for(const recipe of ['initial','duplicate2','verification'])jobs.push({id:jobs.length,profile:'P6',recipe,repeat:0,control:true,order:['before','before']});
 put('freeze.json',{bundles:{before:sha(source),after:sha(prototype)},inputs,jobs,warmup:1,measured:3,childSeconds:120,totalSeconds:900,tool:sha(readFileSync(new URL(import.meta.url))),scope:'Temporary exact canonical memoization, valid input fixtures only; no production correctness or formal performance claim'});
}else{
 assert.equal(mode,'run');const f=read('freeze.json'),job=f.jobs[Number(arg)];assert.equal(job.id,Number(arg));assert.equal(sha(readFileSync(new URL(import.meta.url))),f.tool);
 const bytes=readFileSync(resolve(root,job.profile+'-inputs.json'));assert.equal(sha(bytes),f.inputs[job.profile]);const input=JSON.parse(bytes),records=[];let expected,hasExpected=false;
 for(const variant of job.order){assert.equal(sha(readFileSync(resolve(root,variant+'.mjs'))),f.bundles[variant]);const w=await import(pathToFileURL(resolve(root,variant+'.mjs')).href);
  assert.equal(w.preflight({id:'cold-'+job.profile+'-off',group:'cold',profile:job.profile,mode:'off'},input).passed,true);
  const samples=[];for(let i=-f.warmup;i<f.measured;i++){const run=w.measurementArm('candidate','off');try{
   for(const step of input.steps)if(job.recipe==='duplicate2'||job.recipe==='verification'&&step.lane!=='verification')run.send(step);
   const actions=job.recipe==='initial'?input.steps:job.recipe==='duplicate2'?[{lane:'arrivals',values:[input.arrivals,input.arrivals]}]:input.steps.filter(s=>s.lane==='verification');
   const start=performance.now();for(const step of actions)run.send(step);const ms=performance.now()-start;
   const state=structuredClone(run.state());if(!hasExpected){expected=state;hasExpected=true;}else assert.deepEqual(state,expected);
   if(i>=0)samples.push(ms);
  }finally{run.cleanup();}}
  records.push({variant,samples});
 }
 put('job-'+job.id+'.json',{job,records,pid:process.pid,node:process.version,preflights:true,stateChecks:true,formalQualified:false});
}
