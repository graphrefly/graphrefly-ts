import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const put = (name, value) => writeFileSync(path.join(root, name), JSON.stringify(value, null, 2)+'\n', {flag:'wx'});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const binding = JSON.parse(readFileSync(path.join(root,'binding.json')));
for (const [name, hash] of Object.entries(binding.files)) assert.equal(digest(readFileSync(path.join(root,name))),hash);
assert.deepEqual(process.execArgv, []);
const { sample } = await import(pathToFileURL(path.join(root,'driver.mjs')));
const scenario = JSON.parse(readFileSync(path.join(root,'P2-inputs.json')));
const results=[];
try {
 for (const name of ['B.mjs','C.mjs','B-copy.mjs']) {
  const mod=await import(pathToFileURL(path.join(root,name)));
  const pre=mod.preflights(scenario);
  const exact=sample(mod,'P2-lifecycle',scenario,pre.expected,()=>0);
  const micro=[];
  for (const row of ['inactive-60','active-diamond-5','inactive-2','inactive-1']) micro.push({row,...sample(mod,row,scenario,undefined,()=>0)});
  results.push({name,pre,exact,micro,instances:11});
  put(name+'.result.json',results.at(-1));
 }
 assert.deepEqual(results[0].pre.expected,results[1].pre.expected);
 assert.deepEqual(results[0].pre.expected,results[2].pre.expected);
 put('result.json',{passed:true,instances:33,performanceSamples:0,clock:'constant-zero',pid:process.pid,node:process.version,v8:process.versions.v8,results});
} catch(error) {
 put('failure.json',{passed:false,error:String(error),stack:error.stack,causes:error.errors?.map(e=>({error:String(e),stack:e.stack})),completedModules:results.length,performanceSamples:0});
 process.exitCode=1;
}
