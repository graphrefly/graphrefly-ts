import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {graphArm,schedule} from './scripts/fixtures/spending-preset-performance.ts';
import {preflight} from './scripts/fixtures/spending-preset-performance-worker.ts';
const scenario=JSON.parse(readFileSync(new URL('./P1-inputs.json',import.meta.url),'utf8'));
const results=[];
for(const dataCount of [1,2]) for(const arm of ['candidate','reference']) {
 const row={id:'steady-P1-off-duplicate-'+dataCount,group:'steady',profile:'P1',mode:'off',change:'duplicate',dataCount};
 const semantic=preflight(row,scenario);assert.equal(semantic.passed,true);
 const run=graphArm(arm,'off');const plan=schedule(row,scenario);
 try {
  for(const step of plan.before)run.send(step);
  const baseline=structuredClone(run.state());const observations=[];
  for(let i=0;i<10;i++){
   const before=run.graph.profile();const t=performance.now();
   for(const step of plan.action)run.send(step);
   const elapsed=performance.now()-t;const after=run.graph.profile();
   assert.deepEqual(run.state(),baseline,'duplicate preserves authority');
   const nodes=Object.fromEntries(Object.keys(after.nodes).map(id=>[id,{invokes:after.nodes[id].invokes-before.nodes[id].invokes,totalDurationNs:after.nodes[id].totalDurationNs-before.nodes[id].totalDurationNs}]));
   observations.push({index:i,elapsed,totalInvokes:after.totalInvokes-before.totalInvokes,nodes});
  }
  results.push({row,arm,semantic,topology:run.graph.describe(),observations});
 }finally{run.cleanup();}
}
writeFileSync(new URL('./result.json',import.meta.url),JSON.stringify({kind:'opt-in-node-profile-diagnostic',qualification:false,limitations:'Dispatcher durations may nest; do not sum as exclusive CPU. Opt-in profile overhead is included, not formal timing.',results},null,2)+'\n');
console.log('STEADY_PROFILE_DONE',results.length);