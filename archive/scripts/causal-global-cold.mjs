/** Fixed cumulative cold-construction diagnostic, never formal qualification. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { adaptWorker } from './spending-preset-repetition.mjs';
const [mode, dir, index] = process.argv.slice(2), root = resolve(dir);
const sha = b => createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(readFileSync(resolve(root,p)));
const put = (p,v) => writeFileSync(resolve(root,p),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
if(mode === 'prepare') {
 mkdirSync(root);
 const bundles={}, sources={};
 for(const arm of ['before','after']) {
  const sourceRoot=resolve(root,'..',arm,'source');
  const frozen=JSON.parse(readFileSync(resolve(root,'..',arm,'freeze.json'))).sources;
  const b=await build({entryPoints:['scripts/fixtures/spending-preset-performance-worker.ts'],bundle:true,platform:'node',format:'esm',write:false,metafile:true,plugins:[{name:'frozen-sources',setup(api){api.onLoad({filter:/\.ts$/}, args=>{
   const p=relative(process.cwd(),args.path),bytes=readFileSync(resolve(sourceRoot,p));
   assert.equal(sha(bytes),frozen[p],p);
   return {contents:p.endsWith('spending-preset-performance-worker.ts')?adaptWorker(bytes.toString()):bytes.toString(),loader:'ts',resolveDir:resolve(args.path,'..')};
  });}}]});
  sources[arm]=Object.fromEntries(Object.keys(b.metafile.inputs).map(p=>[p,frozen[p]]));
  writeFileSync(resolve(root,arm+'.mjs'),b.outputFiles[0].contents);bundles[arm]=sha(b.outputFiles[0].contents);
 }
 const jobs=[];
 for(const mode of ['off','summary']) for(let repeat=0;repeat<4;repeat++) jobs.push({id:jobs.length,mode,repeat,control:repeat===3,order:repeat===3?['before','before']:repeat%2?['after','before']:['before','after']});
 writeFileSync(resolve(root,'P1-inputs.json'),readFileSync(resolve(root,'../before/P1-inputs.json')));
 put('freeze.json',{bundles,sources,jobs,warmup:30,measured:200,input:sha(readFileSync(resolve(root,'P1-inputs.json'))),scope:'Unprofiled cold construction; diagnostic only'});
} else {
 assert.equal(mode,'run');const f=read('freeze.json'),job=f.jobs[Number(index)];assert.equal(job.id,Number(index));
 assert.equal(sha(readFileSync(resolve(root,'P1-inputs.json'))),f.input);
 const records=[];let expected, hasExpected=false;
 for(const arm of job.order) {
  assert.equal(sha(readFileSync(resolve(root,arm+'.mjs'))),f.bundles[arm]);
  const w=await import(pathToFileURL(resolve(root,arm+'.mjs')).href);
  assert.equal(w.preflight({id:'cold-P1-'+job.mode,group:'cold',profile:'P1',mode:job.mode},read('P1-inputs.json')).passed,true);
  const samples=[];
  for(let i=-f.warmup;i<f.measured;i++) {
   let run;try {const start=performance.now();run=w.measurementArm('candidate',job.mode);const ms=performance.now()-start;
    const state=structuredClone(run.state());if(!hasExpected){expected=state;hasExpected=true;}else assert.deepEqual(state,expected);
    if(i>=0)samples.push(ms);
   }finally{run?.cleanup();}
  }
  records.push({arm,samples});
 }
 put('job-'+job.id+'.json',{job,records,pid:process.pid,node:process.version,preflight:true,stateChecks:true,formalQualified:false});
}
