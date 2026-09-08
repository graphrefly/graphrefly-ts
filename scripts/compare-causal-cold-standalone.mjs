/** D162 receipt-bound standalone trace/order comparison and descriptive timings. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputArg = process.argv.indexOf("--output");
if (outputArg >= 0 && !process.argv[outputArg + 1]) throw new TypeError("--output requires a path");
const reportPath =
	outputArg < 0
		? join(root, "packages/ts/qualification/causal-occurrence/cold-v1-standalone-comparison.json")
		: resolve(process.argv[outputArg + 1]);
const src = join(root, "packages/ts/src");
const evidence = join(root, "packages/ts/qualification/causal-occurrence");
const frozenPath = join(evidence, "ts-v8-cold-inputs.json");
const frozen = JSON.parse(readFileSync(frozenPath, "utf8"));
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
assert.equal(frozen.receiptDigest, digest(readFileSync(join(evidence, "ts-v8-receipt.json"))));
const baselineReceipt = JSON.parse(readFileSync(join(evidence, "ts-v8-receipt.json"), "utf8"));
const temp = mkdtempSync(join(tmpdir(), "causal-construction-comparison-"));
const reference = join(temp, "reference");
for (const [fullName, file] of Object.entries(frozen.files)) {
	if (!fullName.startsWith("packages/ts/src/")) continue;
	const name = fullName.slice("packages/ts/src/".length);
	assert.equal(digest(file.text), file.digest);
	assert.equal(file.digest, baselineReceipt.files[fullName], "baseline receipt source binding");
	mkdirSync(dirname(join(reference, name)), { recursive: true });
	writeFileSync(join(reference, name), file.text);
}
const previousRunner = readFileSync(join(root, "scripts/compare-causal-authority.mjs"), "utf8");
const traceFixture = previousRunner.slice(
	previousRunner.indexOf("const lanes ="),
	previousRunner.indexOf("function graphRun(make, scenario)"),
);
assert.ok(traceFixture.includes("function trace("));
const resultPath = join(temp, "result.json");
const runner = `
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { Graph as ReferenceGraph } from '${reference}/graph/graph.ts';
import { causalOccurrenceBundle as referenceBundle } from '${reference}/solutions/causal-occurrence.ts';
import { constructionOf as referenceConstructionOf } from '${reference}/graph/construction-scope.ts';
import { Graph } from '${src}/graph/graph.ts';
import { causalOccurrenceBundle, causalOccurrenceDigest } from '${src}/solutions/causal-occurrence.ts';
import { constructionOf, prepareConstruction, startConstruction } from '${src}/graph/construction-scope.ts';
${traceFixture}
const originalPorts=['startup','released','currentness','terminals','conservation','coverage','quiescence','issues'];
const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)];
function run(candidate, scenario, background=0, fault=false) {
 const g=candidate?new Graph():new ReferenceGraph(); const stops=[];
 const retain=g.retain.bind(g);g.retain=(n,o)=>{const stop=retain(n,o);stops.push(stop);return stop;};
 for(let i=0;i<background;i++)g.node([],null,{name:'background/'+i});
 const inputs=Object.fromEntries(props.map(prop=>[prop,fault&&prop==='watermarks'?g.producer(()=>{throw new Error('frozen startup fault');},{name:'source/'+prop}):g.node([],null,{name:'source/'+prop})]));
 const start=performance.now();
 const ports=(candidate?causalOccurrenceBundle:referenceBundle)(g,{...scenario.options,...inputs});
 const constructionNs=(performance.now()-start)*1e6;
 const events=[];const timings=[];
 for(const port of originalPorts)stops.push(ports[port].subscribe(m=>{if(m[0]!=='START')events.push([port,m[0],m.length>1?m[1]:null]);}));
 const shape=g.describe().nodes.map(({id,factory,deps})=>({id,factory,deps}));
 for(const arrival of scenario.arrivals){const t=performance.now();inputs[props[lanes.indexOf(arrival.lane)]].down(arrival.values.map(v=>['DATA',v]));timings.push((performance.now()-t)*1e6);}
 const phase=(candidate?constructionOf:referenceConstructionOf)(g,'causal')?.phase;
 for(const stop of stops.reverse())stop();
 for(const lease of (candidate?constructionOf:referenceConstructionOf)(g,'causal')?.roots??[])lease.unsubscribe?.();
 const group=g.topologyGroup();for(const n of g.describe().nodes)group.add(g.find(n.id));group.release();
 assert.equal(g.describe().nodes.length,0);
 return {events,shape,constructionNs,timings,phase};
}
const scenarios=[trace(1,0,false),trace(16,128,false),trace(64,512,false),trace(16,128,true),trace(64,512,true),trace(16,128,false,2)];
const comparisons=[];
for(const scenario of scenarios){console.log("trace",scenario.count,scenario.evidenceCount,scenario.reverse);const a=run(false,scenario),b=run(true,scenario);assert.deepEqual(b.events,a.events);assert.deepEqual(b.shape,a.shape);comparisons.push({count:scenario.count,evidence:scenario.evidenceCount,reverse:scenario.reverse,capacity:scenario.capacity,matched:true,events:b.events.length,nodes:b.shape.length,baseline:a.events,candidate:b.events,shape:b.shape,baselinePhase:a.phase,candidatePhase:b.phase,timing:{baselineConstructionNs:a.constructionNs,candidateConstructionNs:b.constructionNs,baselineDispatchNs:a.timings,candidateDispatchNs:b.timings}});assert.equal(b.phase,a.phase);}
const faultA=run(false,scenarios[0],0,true),faultB=run(true,scenarios[0],0,true);
assert.deepEqual(faultB.events,faultA.events);assert.deepEqual(faultB.shape,faultA.shape);assert.equal(faultB.phase,faultA.phase);assert.equal(faultB.phase,'faulted');
writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({comparisons,startupFault:{baseline:faultA,candidate:faultB,matched:true},timingMeaning:'Descriptive single-run trace timings, not an additional performance budget or best-of batch'},null,2));
`;
try {
	const bundlePath = join(temp, "compare.mjs");
	const compiled = await build({
		stdin: { contents: runner, resolveDir: root, loader: "ts" },
		outfile: bundlePath,
		bundle: true,
		platform: "node",
		format: "esm",
		metafile: true,
		nodePaths: [join(root, "node_modules")],
		define: { __GRAPHREFLY_TS_PACKAGE_REVISION__: JSON.stringify("graphrefly-ts:0.9.0") },
	});
	const child = spawnSync(process.execPath, ["--expose-gc", bundlePath], {
		encoding: "utf8",
		timeout: 1200000,
		stdio: "inherit",
	});
	assert.ifError(child.error);
	assert.equal(child.status, 0, `child signal: ${child.signal}`);
	const result = JSON.parse(readFileSync(resultPath, "utf8"));
	const closure = Object.keys(compiled.metafile.inputs).filter((p) => p !== "<stdin>");
	const report = {
		schema: "graphrefly-ts/causal-cold-standalone-comparison/v1",
		revision: "cold-v1",
		runnerDigest: digest(readFileSync(fileURLToPath(import.meta.url))),
		fixtureDigest: digest(traceFixture),
		frozenDigest: digest(readFileSync(frozenPath)),
		runtime: process.version,
		closure: Object.fromEntries(
			closure.map((p) => [
				p.includes("/reference/") ? `frozen/${p.split("/reference/")[1]}` : p,
				digest(readFileSync(resolve(root, p))),
			]),
		),
		baselineMeaning:
			"Receipt-bound ts-v8 actual runtime, including C owner/startup resources; exact node order and all eight output streams compared",
		...result,
	};
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	console.log("STANDALONE_COMPARISON_DONE cases=" + report.comparisons.length);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
