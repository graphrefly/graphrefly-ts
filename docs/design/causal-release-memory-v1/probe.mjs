import {readFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.resolve(process.argv[2]), out=process.argv[3];
const record=(phase,n)=>{const m=process.memoryUsage();appendFileSync(out,JSON.stringify({phase,n,...m})+'\n');if(m.rss>268435456)throw Error('unchanged RSS limit');};
record('before-import',0);
const a=await import(pathToFileURL(path.join(root,'B.mjs')));
await import(pathToFileURL(path.join(root,'B-copy.mjs')));
const {sample}=await import(pathToFileURL(path.join(root,'tools/causal-release-comparison-driver.mjs')));
const scenario=JSON.parse(readFileSync(path.join(root,'P2-inputs.json')));
record('after-import',0);
const pre=a.preflights(scenario);
record('after-preflight',0);global.gc();record('post-gc',0);
for(let i=1;i<=400;i++){
 sample(a,'P2-lifecycle',scenario,pre.expected,()=>0);
 if(i%50===0){record('pre-gc',i);global.gc();record('post-gc',i);}
}
record('complete',400);
