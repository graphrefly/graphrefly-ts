import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
const mod=await import(pathToFileURL(path.join(root,'instrumented.mjs')));
const scenario=JSON.parse(readFileSync(path.join(root,'P2-inputs.json')));
const expected=JSON.parse(readFileSync(path.join(root,'expected.json')));
const phases=[];let run,cleaned=false;
function capture(phase){const entry={phase,stats:mod.__take()};phases.push(entry);appendFileSync(path.join(out,'partial-counts.jsonl'),JSON.stringify(entry)+'\n');}
try{
 run=mod.candidate();capture('construct');
 for(const step of scenario.steps){run.send(step);capture('initial-'+step.lane);}
 assert.deepEqual(mod.graphSnapshot(run),expected);
 const action=mod.duplicate(scenario);
 for(const step of action)run.send(step);capture('same-object-duplicate');assert.deepEqual(mod.graphSnapshot(run),expected);
 for(const step of structuredClone(action))run.send(step);capture('equal-clone-duplicate');assert.deepEqual(mod.graphSnapshot(run),expected);
 const stop=structuredClone(scenario.steps.find(s=>s.lane==='local'));stop.values[0].stop=true;
 run.send(stop);capture('local-stop-change');assert.deepEqual(mod.graphSnapshot(run),expected);assert.equal(mod.occurrence(run),1);
 run.cleanup();cleaned=true;assert.equal(run.graph.describe().nodes.length,0);capture('cleanup');
 writeFileSync(path.join(out,'remaining-result.json'),JSON.stringify({passed:true,additionalLifecycles:1,totalInstancesThisBatch:12,phases,stopSnapshotUnchanged:true,performanceSamples:0},null,2)+'\n');
}finally{if(run&&!cleaned)run.cleanup();}
