
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sample as baseline } from './baseline.mjs';
const mode=process.argv[2],comparison=process.argv[3];
const candidate=comparison==='baseline-prototype'?(await import('./prototype.mjs')).sample:baseline;
const labels=comparison==='baseline-prototype'?['baseline','prototype']:['baseline-A','baseline-B'];
const lifetimes=[];
for(let repetition=-1;repetition<3;repetition++){
 const order=repetition%2===0?labels:[...labels].reverse();const pair=[];
 for(const label of order){const run=await (label===labels[0]?baseline:candidate)(mode);pair.push({label,repetition,...run});}
 assert.deepEqual(pair[0].witness,pair[1].witness,'exact topology,oracle payloads,retained outcomes and normal end');
 if(repetition>=0)for(const result of pair){result.witnessSha256=createHash('sha256').update(JSON.stringify(result.witness)).digest('hex');delete result.witness;lifetimes.push(result);}
}
console.log(JSON.stringify({mode,comparison,lifetimes,maxRssKiB:process.resourceUsage().maxRSS}));
