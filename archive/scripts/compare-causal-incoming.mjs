/** B1 semantic differential against frozen ts-v6 runtime, independent of the new reader. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "packages/ts/src");
const outputArg = process.argv.indexOf("--output");
assert.ok(outputArg >= 0 && process.argv[outputArg + 1], "--output requires a fresh evidence path");
const output = resolve(process.argv[outputArg + 1]);
const digest = (x) => `sha256:${createHash("sha256").update(x).digest("hex")}`;
const frozenPath = join(root, "packages/ts/qualification/causal-occurrence/ts-v6-inputs.json");
const frozen = JSON.parse(readFileSync(frozenPath, "utf8"));
assert.equal(
	frozen.receiptDigest,
	digest(
		readFileSync(join(root, "packages/ts/qualification/causal-occurrence/ts-v6-receipt.json")),
	),
);
const temp = mkdtempSync(join(tmpdir(), "causal-incoming-differential-"));
const reference = join(temp, "reference");
cpSync(src, reference, { recursive: true });
for (const [name, file] of Object.entries(frozen.files)) {
	assert.equal(digest(file.text), file.digest, name);
	if (!name.startsWith("packages/ts/src/")) continue;
	const path = join(reference, name.slice("packages/ts/src/".length));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, file.text);
}
const resultPath = join(temp, "result.json");
const runner = `
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {Graph as OldGraph,releaseGraphNodes as oldRelease} from '${reference}/graph/graph.ts';
import {Node as OldNode} from '${reference}/node/node.ts';
import {releaseRuntimeOfNode as oldBareRelease} from '${reference}/node/runtime-accessors.ts';
import {prepareConstruction as oldPrepare} from '${reference}/graph/construction-scope.ts';
import {Graph,releaseGraphNodes} from '${src}/graph/graph.ts';
import {Node} from '${src}/node/node.ts';
import {releaseRuntimeOfNode} from '${src}/node/runtime-accessors.ts';
import {prepareConstruction} from '${src}/graph/construction-scope.ts';
function run(candidate, seed, mode) {
 const G=candidate?Graph:OldGraph, N=candidate?Node:OldNode;
 const release=candidate?releaseGraphNodes:oldRelease, releaseBare=candidate?releaseRuntimeOfNode:oldBareRelease;
 const prepare=candidate?prepareConstruction:oldPrepare;
 const g=new G(), child=new G(), nodes=[], events=[], trace=[], stops=[];
 const read=G.prototype.describe;
 const hidden=deps=>{const n=new N(deps,null,{factory:'hidden'});nodes.push(n);return n;};
 const a=g.state(seed,{name:'a'}), b=g.state(3,{name:'b'});
 const view=g.derived([a,b],(x,y)=>x+y,{name:'view'});
 const name='scope/空:'+seed;
 const scope=prepare(g,{name,epoch:1,inputs:[a,b],names:[name+'/root',name+'/future']});
 const target=scope.node([a,b],null,{name:name+'/root'});
 if(seed%2)target.replaceDeps([b],null);
 const bg=mode==='plain'||mode==='override'||mode==='call-property'?g:child;
 const leaf=hidden([]), inner=hidden([leaf]), outer=hidden([inner]);
 bg.node([outer,inner,outer],null,{name:'background'});
 bg.node([],null,{name:'~hidden#0'});
 for(let i=0;i<seed%5;i++)bg.node([outer],null,{name:'background/'+i});
 if(bg===child)g.mount(child,{at:'child'});
 if(seed%3===0)stops.push(bg.observeTopology().subscribe(e=>events.push(e)));
 let overrideReads=0;
 if(mode==='override')Object.defineProperty(g,'describe',{configurable:true,get(){overrideReads++;return function(){assert.equal(this,g);return {nodes:[],edges:[{from:'custom',to:'custom-target'}]};};}});
 if(mode==='call-property'){g.describe=function(){assert.equal(this,g);return {nodes:[],edges:[{from:'custom',to:'custom-target'}]};};Object.defineProperty(g.describe,'call',{get(){throw new Error('extra call property read');}});}
 if(mode==='child-rewire')child.describe=function(...args){target.replaceDeps([a],null);return read.apply(this,args);};
 if(mode==='child-throw')child.describe=function(){throw new Error('child read failure');};
 let inspected;
 try{
  const snap=candidate?scope.readIncoming():g.describe();
  inspected={edges:!candidate&&mode!=='override'&&mode!=='call-property'?snap.edges.filter(e=>e.to===name+'/root'):snap.edges};
 }catch(e){inspected={error:[e.constructor.name,e.message]};}
 delete g.describe;delete child.describe;
 stops.push(bg.observeTopology().subscribe(e=>events.push(e)));
 bg.node([hidden([])],null,{name:'later'});
 const snapshot=g.describe(), checkpoint=g.checkpoint();
 stops.push(view.subscribe(m=>{if(m[0]==='DATA')trace.push(m[1]);}));
 a.set(seed+10);b.set(9);
 const active=g.describe();
 for(const stop of stops.reverse())stop();
 for(const host of [g,child])release(host,read.call(host).nodes.flatMap(n=>host.find(n.id)?[host.find(n.id)]:[]));
 for(const n of nodes)releaseBare(n);
 return {inspected,overrideReads,events,snapshot,checkpoint,active,trace};
}
const cases=[];
for(let seed=0;seed<24;seed++)for(const mode of ['plain','mount','override','call-property','child-rewire','child-throw']){
 const baseline=run(false,seed,mode), candidate=run(true,seed,mode);
 assert.deepEqual(candidate,baseline,mode+':'+seed);
 cases.push({seed,mode,matched:true,baseline,candidate});
}
writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({passed:true,cases},null,2));
console.log('INCOMING_DIFFERENTIAL_DONE cases='+cases.length);
`;
try {
	const bundle = join(temp, "runner.mjs");
	const compiled = await build({
		stdin: { contents: runner, resolveDir: root, loader: "ts" },
		outfile: bundle,
		bundle: true,
		format: "esm",
		platform: "node",
		metafile: true,
		nodePaths: [join(root, "node_modules")],
		define: { __GRAPHREFLY_TS_PACKAGE_REVISION__: '"graphrefly-ts:0.9.0"' },
	});
	const child = spawnSync(process.execPath, [bundle], {
		encoding: "utf8",
		timeout: 60000,
		maxBuffer: 2 * 1024 * 1024,
	});
	assert.ifError(child.error);
	assert.equal(child.status, 0, child.stdout + child.stderr);
	const closure = Object.fromEntries(
		Object.keys(compiled.metafile.inputs)
			.filter((p) => p !== "<stdin>")
			.map((p) => {
				const path = resolve(root, p);
				return [
					path.startsWith(reference)
						? `frozen/${path.slice(reference.length + 1)}`
						: `current/${path.slice(src.length + 1)}`,
					digest(readFileSync(path)),
				];
			}),
	);
	writeFileSync(
		output,
		`${JSON.stringify({ schema: "graphrefly-ts/causal-incoming-differential/v1", runnerDigest: digest(readFileSync(fileURLToPath(import.meta.url))), frozenDigest: digest(readFileSync(frozenPath)), baselineReceiptDigest: frozen.receiptDigest, closure, ...JSON.parse(readFileSync(resultPath, "utf8")), cleanup: { childrenExited: true, temporaryRemovedOnExit: true } }, null, 2)}\n`,
	);
	console.log(child.stdout);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
