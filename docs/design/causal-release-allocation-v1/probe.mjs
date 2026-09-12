import {Session} from 'node:inspector';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
const mod=await import(pathToFileURL(path.join(root,'B.mjs')));
await import(pathToFileURL(path.join(root,'B-copy.mjs')));
const scenario=JSON.parse(readFileSync(path.join(root,'P2-inputs.json')));
const expected=mod.preflights(scenario).expected;
function constructionStage(){return mod.candidate();}
function inputStage(run){for(const step of scenario.steps)run.send(step);}
function duplicateStage(run){for(const step of mod.duplicate(scenario))run.send(step);}
function snapshotStage(run){return mod.graphSnapshot(run);}
function cleanupStage(run){run.cleanup();}
function validationStage(run,snapshot,before,after){mod.validate(run,snapshot,expected,before,after);}
const session=new Session();session.connect();
const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(e,r)=>e?reject(e):resolve(r)));
const options={samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true};
let completed=0,error;
try{
 global.gc();await post('HeapProfiler.startSampling',options);
 for(let i=0;i<100;i++){
  let run,cleaning=false;
  try{run=constructionStage();inputStage(run);const before=mod.occurrence(run);duplicateStage(run);const after=mod.occurrence(run);const snap=snapshotStage(run);cleaning=true;cleanupStage(run);validationStage(run,snap,before,after);}
  finally{if(run&&!cleaning)cleanupStage(run);}
  completed++;
  if(completed%20===0){global.gc();const memory=process.memoryUsage();appendFileSync(path.join(out,'memory.jsonl'),JSON.stringify({completed,...memory})+'\n');if(memory.rss>268435456)throw Error('checkpoint RSS limit');}
 }
}catch(e){error={message:String(e),stack:e.stack};process.exitCode=1;}
finally{
 const result=await post('HeapProfiler.stopSampling');writeFileSync(path.join(out,'profile.json'),JSON.stringify(result)+'\n');session.disconnect();
 writeFileSync(path.join(out,'result.json'),JSON.stringify({completed,error,options,performanceSamples:0,node:process.version})+'\n');
}
