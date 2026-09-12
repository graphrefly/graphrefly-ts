import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
const original=await import(pathToFileURL(path.join(root,'B.mjs')));
const measured=await import(pathToFileURL(path.join(root,'instrumented.mjs')));
const scenario=JSON.parse(readFileSync(path.join(root,'P2-inputs.json')));
const expected=original.preflights(scenario).expected;
const results=[];
for(const name of ['same-object-duplicate','equal-clone-duplicate','local-stop-change']){
 const snapshots=[];
 for(const [label,mod] of [['original',original],['instrumented',measured]]){
  mod.__reset?.();let run,cleaned=false;const phases=[];
  function capture(phase){if(mod.__take)phases.push({phase,stats:mod.__take()});}
  try{
   run=mod.candidate();capture('construct');
   for(const step of scenario.steps){run.send(step);capture('initial-'+step.lane);}
   const before=mod.graphSnapshot(run);assert.deepEqual(before,expected);
   let action=mod.duplicate(scenario);
   if(name==='equal-clone-duplicate')action=JSON.parse(JSON.stringify(action));
   if(name==='local-stop-change'){action=[structuredClone(scenario.steps.find(s=>s.lane==='local'))];action[0].values[0].stop=true;}
   for(const step of action)run.send(step);
   capture('action');const after=mod.graphSnapshot(run);assert.equal(mod.occurrence(run),1);
   if(name!=='local-stop-change')assert.deepEqual(after,expected);
   else {assert.notDeepEqual(after,before);assert.equal(after.effects.length,1);assert.equal(after.effects[0].outcome,null);}
   run.cleanup();cleaned=true;assert.equal(run.graph.describe().nodes.length,0);capture('cleanup');
   snapshots.push(after);results.push({name,label,phases,after});
  }finally{if(run&&!cleaned)run.cleanup();}
 }
 assert.deepEqual(snapshots[0],snapshots[1]);
}
writeFileSync(path.join(out,'counts.json'),JSON.stringify({passed:true,totalInstances:12,candidateLifecycles:8,referenceLifecycles:2,plainInstances:2,results,performanceSamples:0},null,2)+'\n');
