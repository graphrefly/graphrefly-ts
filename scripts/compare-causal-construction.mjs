/** D161 offline trace and matched-resource performance qualification. */
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
		? join(root, "packages/ts/qualification/causal-occurrence/ts-v5-construction-comparison.json")
		: resolve(process.argv[outputArg + 1]);
const src = join(root, "packages/ts/src");
const evidence = join(root, "packages/ts/qualification/causal-occurrence");
const frozenPath = join(evidence, "ts-v4-construction-inputs.json");
const frozen = JSON.parse(readFileSync(frozenPath, "utf8"));
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
assert.equal(frozen.receiptDigest, digest(readFileSync(join(evidence, "ts-v4-receipt.json"))));
const temp = mkdtempSync(join(tmpdir(), "causal-construction-comparison-"));
const reference = join(temp, "reference");
for (const [name, file] of Object.entries(frozen.files)) {
	assert.equal(digest(file.text), file.digest);
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
import { Graph } from '${src}/graph/graph.ts';
import { causalOccurrenceBundle, causalOccurrenceDigest } from '${src}/solutions/causal-occurrence.ts';
import { constructionOf, prepareConstruction, startConstruction } from '${src}/graph/construction-scope.ts';
${traceFixture}
const originalPorts=['released','currentness','terminals','conservation','coverage','quiescence','issues'];
const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)];
function run(candidate, scenario, background=0) {
 const g=candidate?new Graph():new ReferenceGraph(); const stops=[];
 const retain=g.retain.bind(g);g.retain=(n,o)=>{const stop=retain(n,o);stops.push(stop);return stop;};
 for(let i=0;i<background;i++)g.node([],null,{name:'background/'+i});
 const inputs=Object.fromEntries(props.map(prop=>[prop,g.node([],null,{name:'source/'+prop})]));
 const start=performance.now();
 const ports=(candidate?causalOccurrenceBundle:referenceBundle)(g,{...scenario.options,...inputs});
 if(!candidate) {
  // Same physical resources and startup fact deliveries; old runtime has no C ownership guarantee.
  const startup=g.node([],null,{name:'causal/startup',factory:'graphConstructionStartup',initial:{kind:'graph-startup',instance:'causal',epoch:1,state:'starting'}});
  g.node([ports.quiescence],()=>{}, {name:'causal/causal-quiescence',factory:'causalLifecycleQuiescence'});
  g.node([g.find('causal/authority')],()=>{}, {name:'causal/committed-effects',factory:'causalCommittedEffectsProjection'});
  g.retain(startup); startup.down([['DATA',{kind:'graph-startup',instance:'causal',epoch:1,state:'started'}]]);
 }
 const constructionNs=(performance.now()-start)*1e6;
 const events=[];const timings=[];
 for(const port of originalPorts)stops.push(ports[port].subscribe(m=>{if(m[0]!=='START')events.push([port,m[0],m.length>1?m[1]:null]);}));
 const shape=g.describe().nodes.map(({id,factory,deps})=>({id,factory,deps})).sort((a,b)=>a.id.localeCompare(b.id));
 for(const arrival of scenario.arrivals){const t=performance.now();inputs[props[lanes.indexOf(arrival.lane)]].down(arrival.values.map(v=>['DATA',v]));timings.push((performance.now()-t)*1e6);}
 for(const stop of stops.reverse())stop();
 for(const lease of constructionOf(g,'causal')?.roots??[])lease.unsubscribe?.();
 const group=g.topologyGroup();for(const n of g.describe().nodes)group.add(g.find(n.id));group.release();
 assert.equal(g.describe().nodes.length,0);
 return {events,shape,constructionNs,timings};
}
const scenarios=[trace(1,0,false),trace(16,128,false),trace(64,512,false),trace(16,128,true),trace(64,512,true),trace(16,128,false,2)];
const comparisons=[];
for(const scenario of scenarios){console.log("trace",scenario.count,scenario.evidenceCount,scenario.reverse);const a=run(false,scenario),b=run(true,scenario);assert.deepEqual(b.events,a.events);assert.deepEqual(b.shape,a.shape);comparisons.push({count:scenario.count,evidence:scenario.evidenceCount,reverse:scenario.reverse,capacity:scenario.capacity,matched:true,events:b.events.length,nodes:b.shape.length});}
function paired(scenario, background=0) {
 console.log("paired",scenario.count,scenario.evidenceCount,background);
 const empty={...scenario,arrivals:[]};const a=[],b=[],constructionBatches=[];
 // Freeze the sampling layout before results: three alternating construction batches,
 // independently warmed full-trace pairs for steady state. Never retain whole traces.
 // Revision 2: 100 warm pairs and 300 measured pairs per batch reduce JIT/GC noise
 // observed with 6/30. Keep the prior report; unchanged 1.20/1.10 budgets apply.
 for(let batch=0;batch<3;batch++){
  for(let i=0;i<100;i++){run(false,empty,background);run(true,empty,background);}
  const aa=[],bb=[];
  for(let i=0;i<300;i++){if((i+batch)%2){bb.push(run(true,empty,background).constructionNs);aa.push(run(false,empty,background).constructionNs);}else{aa.push(run(false,empty,background).constructionNs);bb.push(run(true,empty,background).constructionNs);}}
  a.push(...aa);b.push(...bb);constructionBatches.push({baseline:aa,candidate:bb,ratio:percentile(bb,.95)/percentile(aa,.95)});
 }
 const da=[],db=[];const pairs=scenario.count===64?9:15;
 for(let i=0;i<2;i++){run(false,scenario,background);run(true,scenario,background);}
 const measure=candidate=>percentile(run(candidate,scenario,background).timings,.95);
 for(let i=0;i<pairs;i++){if(i%2){db.push(measure(true));da.push(measure(false));}else{da.push(measure(false));db.push(measure(true));}console.log("steady pair",scenario.count,background,i+1,"of",pairs);}
 const result={count:scenario.count,evidence:scenario.evidenceCount,background,construction:{baselineP95Ns:percentile(a,.95),candidateP95Ns:percentile(b,.95),ratio:percentile(b,.95)/percentile(a,.95),medianDeltaNs:percentile(b,.5)-percentile(a,.5),baseline:a,candidate:b,batches:constructionBatches},steady:{baselineMedianP95Ns:percentile(da,.5),candidateMedianP95Ns:percentile(db,.5),ratio:percentile(db,.5)/percentile(da,.5),baseline:da,candidate:db}};
 console.log("row complete",JSON.stringify(result));return result;
}
const performanceRows=[paired(scenarios[0]),paired(scenarios[1]),paired(scenarios[2]),paired(scenarios[0],1000)];
function ordinary(candidate){const g=candidate?new Graph():new ReferenceGraph();const a=g.state(1);const b=g.derived([a],v=>v+1);const stop=b.subscribe(()=>{});for(let i=0;i<5000;i++)a.set(i);const t=performance.now();for(let i=0;i<20000;i++)a.set(i);const ns=(performance.now()-t)*1e6/20000;stop();const group=g.topologyGroup();for(const n of g.describe().nodes)group.add(g.find(n.id));group.release();return ns;}
const ordinaryBefore=[],ordinaryAfter=[];for(let i=0;i<8;i++){ordinary(false);ordinary(true);}for(let i=0;i<25;i++){if(i%2){ordinaryAfter.push(ordinary(true));ordinaryBefore.push(ordinary(false));}else{ordinaryBefore.push(ordinary(false));ordinaryAfter.push(ordinary(true));}}
function dynamic(candidate){const g=candidate?new Graph():new ReferenceGraph();const source=g.state(1,{name:'source'});let peak=process.memoryUsage().heapUsed;const times=[];for(let i=0;i<200;i++){const name='v'+i;const t=performance.now();let nodes,stops;if(candidate){const scope=prepareConstruction(g,{name,epoch:1,inputs:[source],names:[name+'/startup',name+'/root']});const startup=scope.startupSource();const node=scope.node([source],null,{name:name+'/root'});const owner=scope.seal(startup,[node]);scope.transferToGraph(owner);startConstruction(g,owner);nodes=owner.nodes;stops=owner.roots.map(x=>x.unsubscribe);}else{const startup=g.node([],null,{name:name+'/startup',initial:{kind:'graph-startup',instance:name,epoch:1,state:'starting'}});const node=g.node([source],null,{name:name+'/root'});nodes=[startup,node];stops=[g.retain(startup),g.retain(node)];startup.down([['DATA',{kind:'graph-startup',instance:name,epoch:1,state:'started'}]]);}for(const stop of stops)stop();const group=g.topologyGroup();for(const node of nodes)group.add(node);group.release();times.push((performance.now()-t)*1e6);peak=Math.max(peak,process.memoryUsage().heapUsed);assert.equal(g.describe().nodes.length,1);if(candidate)assert.equal(constructionOf(g,name),undefined);}return {p95Ns:percentile(times,.95),totalNs:times.reduce((a,b)=>a+b,0),peakHeapBytes:peak};}
const dynamicRows=[];for(let i=0;i<5;i++){const first=dynamic(i%2===1),second=dynamic(i%2===0);dynamicRows.push(i%2?{baseline:second,candidate:first}:{baseline:first,candidate:second});}
writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({comparisons,performanceRows,ordinary:{baseline:ordinaryBefore,candidate:ordinaryAfter,ratio:percentile(ordinaryAfter,.5)/percentile(ordinaryBefore,.5)},dynamicRows},null,2));
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
		schema: "graphrefly-ts/causal-construction-comparison/v1",
		revision: "construction-v1",
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
			"ts-v4 actual runtime with same added startup/projection physical resources; no C ownership guarantee",
		...result,
	};
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	console.log(
		JSON.stringify({
			comparisons: report.comparisons,
			performance: report.performanceRows.map(({ count, background, construction, steady }) => ({
				count,
				background,
				constructionRatio: construction.ratio,
				steadyRatio: steady.ratio,
			})),
			ordinaryRatio: report.ordinary.ratio,
		}),
	);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
