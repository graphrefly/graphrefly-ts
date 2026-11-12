/** Source-transformed call-local comparison prototype; never edits production source. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, ".."),
	base = resolve(root, "docs/design/causal-host-call-local");
let attempt = 1;
while (existsSync(resolve(base, `attempt-${attempt}`))) attempt++;
const directory = resolve(base, `attempt-${attempt}`);
mkdirSync(directory, { recursive: true });
const sha = (v) => createHash("sha256").update(v).digest("hex");
const hostPath = "examples/spending-alerts/causal-focused-host.ts";
const original = readFileSync(resolve(root, hostPath), "utf8");
const anchor = "const view = depLatest(ctx, 0) as CommittedEffectsView | undefined;";
const insertion = `let comparisonTexts: Map<unknown, string> | undefined;
const comparisonKey = (value: unknown): string => {
 const prior = comparisonTexts?.get(value);
 if (prior !== undefined) return prior;
 const text = canonicalMaterial(value);
 comparisonTexts ??= new Map();
 comparisonTexts.set(value, text);
 return text;
};
const same = (left: unknown, right: unknown): boolean => comparisonKey(left) === comparisonKey(right);
`;
const worker = `
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { composeOfflineSpending,OfflineAlertResource } from './examples/spending-alerts/causal-focused-host.ts';
import { inputsFor,drain } from './scripts/fixtures/spending-focused-host-harness.ts';
import { evaluationFixture,evaluationPack,policyFacts,presetBinding } from './scripts/fixtures/spending-preset-harness.ts';
import { oracleRequest } from './scripts/fixtures/spending-preset-oracle.ts';
import { Graph } from './packages/ts/src/graph/graph.ts';
import { batch } from './packages/ts/src/batch/batch.ts';
const evaluations=Array.from({length:32},(_,i)=>[evaluationFixture(i,'coffee'),evaluationFixture(i,'tea')]).flat();
const pack=evaluationPack(evaluations),facts=evaluations.map(e=>policyFacts(e));
const payloads=evaluations.map(e=>oracleRequest(e,presetBinding).body.payloadText+'\\n');
const arrivals=evaluations.map(e=>({packRef:presetBinding.packRef,evaluationRefs:[e.evaluationRef]}));
export async function sample(mode){
 const graph=new Graph({name:'spending-call-local'}),{sources,inputs}=inputsFor(graph),calls=[];
 const resource=new OfflineAlertResource(presetBinding,async payload=>{calls.push(payload);return {bytesWritten:Buffer.byteLength(payload)}});
 const t0=performance.now();const host=composeOfflineSpending(graph,inputs,presetBinding,resource,{name:'spending',diagnostics:mode});const constructionMs=performance.now()-t0;
 const stops=Object.values(host.consume.view).map(node=>node.subscribe(()=>{}));
 const send=(lane,value)=>sources[lane].down([['DATA',value]]);
 const rows=[];
 try{
  await drain();send('pack',pack);
  for(let i=0;i<64;i++){
   const f=facts[i];const t1=performance.now();batch(()=>{send('current',f.current);send('verification',f.verification);send('local',f.local);send('arrivals',arrivals[i]);});const syncInputMs=performance.now()-t1;
   assert.equal(calls.length,i+1);assert.equal(calls[i],payloads[i]);
   const t2=performance.now();await drain();const completionMs=performance.now()-t2;
   const state=host.inspect();assert.equal(state.fault,undefined);assert.equal(state.records.length,i+1);assert.ok(state.records.every(r=>r.outcome?.state==='succeeded'));
   rows.push({frontier:i+1,syncInputMs,completionMs,heapUsed:process.memoryUsage().heapUsed,rss:process.memoryUsage().rss,notifications:state.notifications,maxFrameBytes:state.maxFrameBytes});
  }
  const latest=facts.slice(-2);batch(()=>{send('current',{...latest[0].current,current:latest.flatMap(f=>f.current.current)});send('local',{...latest[0].local,stop:true,grants:latest.flatMap(f=>f.local.grants)});});await drain();
  const final=host.inspect();assert.equal(final.normalEndReady,true);assert.equal(final.writes,64);assert.equal(final.inFlight,0);
  return {constructionMs,rows,witness:{topology:graph.topology(),calls,records:final.records,normalEndReady:final.normalEndReady},final:{writes:64,records:64,normalEndReady:true,notifications:final.notifications,maxFrameBytes:final.maxFrameBytes}};
 }finally{stops.forEach(stop=>stop());for(const r of host.owner.roots)r.unsubscribe?.();const group=graph.topologyGroup();for(const n of graph.describe().nodes)group.add(graph.find(n.id));group.release();}
}
`;
const driver = `
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
`;
const method = {
	schema: "spending-host-call-local-prototype-method/v1",
	createdAt: new Date().toISOString(),
	attempt,
	baseline: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
	scriptSha256: sha(readFileSync(import.meta.filename)),
	hostPath,
	originalHostSha256: sha(original),
	anchor,
	insertion,
	transformation:
		"unique insertion directly inside hostGuard callback before view read; local same shadows imported same; lazy Map stores full canonical strings for this invocation only",
	modes: ["off", "summary"],
	comparisons: ["baseline-prototype", "baseline-baseline-control"],
	requestsPerLifetime: 64,
	vendors: 2,
	revisionsPerVendor: 32,
	warmupLifetimesPerArm: 1,
	measuredLifetimesPerArm: 3,
	order: "fresh process per mode/comparison; alternating paired arm order; no forcedGC",
	measurements:
		"sync batched input and microtask completion separately,oracle/assertions/inspect/memory reads outside recorded intervals",
	checks:
		"every pair exact topology,all64oracle payloads,retained64successes andnormalEndReady;original bounds unchanged",
	limits: [
		"Prototype profitability diagnostic only;no production edits,qualification or publicAPI change.",
		"Full lifetime trajectories are not independent stationary input samples;no favorable reruns or averaging with previous tools.",
		"Complete canonical text cache has same left-to-right first use and thrown-error behavior for the reviewed deeply frozen inputs;no across-call registry or new admission authority.",
		"Baseline/prototype use separately bundled module instances;baseline/baselinecontrol shares baseline module. This can alter JIT/GC history;control noise is not a proof of statistical equivalence.",
		"No externalI/O,no forcedGC;process heap/RSS observations include fixture,module,JIT and allocator state.",
	],
	sources: [],
	bundles: [],
};
const receipt = {
	schema: "spending-host-call-local-prototype-receipt/v1",
	attempt,
	startedAt: new Date().toISOString(),
	status: "running",
	environment: {
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		cpu: cpus()[0]?.model,
	},
	cells: [],
	failures: [],
};
try {
	if (original.split(anchor).length - 1 !== 1)
		throw new Error("hostGuard insertion anchor is not unique");
	const prototype = original.replace(anchor, insertion + anchor);
	method.prototypeHostSha256 = sha(prototype);
	for (const variant of ["baseline", "prototype"]) {
		const outfile = resolve(directory, variant + ".mjs");
		let transformed = 0;
		const compiled = await build({
			stdin: {
				contents: worker,
				resolveDir: root,
				sourcefile: "spending-host-call-local-worker.ts",
				loader: "ts",
			},
			bundle: true,
			platform: "node",
			format: "esm",
			outfile,
			sourcemap: "external",
			sourcesContent: true,
			minify: false,
			plugins:
				variant === "prototype"
					? [
							{
								name: "call-local-prototype",
								setup(b) {
									b.onLoad({ filter: /causal-focused-host\.ts$/ }, (args) => {
										if (resolve(args.path) !== resolve(root, hostPath))
											throw new Error("unexpected host path");
										transformed++;
										return { contents: prototype, loader: "ts" };
									});
								},
							},
						]
					: [],
			metafile: true,
		});
		if (variant === "prototype" && transformed !== 1)
			throw new Error("prototype source transform count");
		method.bundles.push({
			variant,
			path: variant + ".mjs",
			sha256: sha(readFileSync(outfile)),
			mapPath: variant + ".mjs.map",
			mapSha256: sha(readFileSync(outfile + ".map")),
		});
		if (variant === "baseline")
			method.sources = Object.keys(compiled.metafile.inputs)
				.filter((p) => p !== "spending-host-call-local-worker.ts")
				.sort()
				.map((path) => ({ path, sha256: sha(readFileSync(resolve(root, path))) }));
	}
	writeFileSync(resolve(directory, "driver.mjs"), driver);
	method.driverSha256 = sha(driver);
	writeFileSync(resolve(directory, "method.json"), JSON.stringify(method, null, 2) + "\n");
	receipt.methodSha256 = sha(readFileSync(resolve(directory, "method.json")));
	for (const mode of method.modes)
		for (const comparison of method.comparisons) {
			const child = spawnSync(
				process.execPath,
				[resolve(directory, "driver.mjs"), mode, comparison],
				{ cwd: root, encoding: "utf8", timeout: 240000, maxBuffer: 8 * 1048576 },
			);
			if (child.status !== 0) {
				receipt.failures.push({
					mode,
					comparison,
					status: child.status,
					signal: child.signal,
					error: child.error?.message,
					stdout: child.stdout,
					stderr: child.stderr,
				});
				throw new Error("fixture or execution failed;remainingcellsnotrun");
			}
			receipt.cells.push(JSON.parse(child.stdout.trim()));
		}
	receipt.sourceChangesDuringRun = method.sources
		.filter(({ path, sha256 }) => sha(readFileSync(resolve(root, path))) !== sha256)
		.map((v) => v.path);
	if (receipt.sourceChangesDuringRun.length)
		receipt.failures.push({
			kind: "source-changed-during-run",
			paths: receipt.sourceChangesDuringRun,
		});
	receipt.status = receipt.failures.length
		? "prototype-diagnostic-incomplete"
		: "prototype-diagnostic-complete-not-qualified";
} catch (error) {
	receipt.status = "prototype-diagnostic-incomplete";
	receipt.failures.push({ error: String(error), stack: error.stack });
} finally {
	receipt.finishedAt = new Date().toISOString();
	writeFileSync(resolve(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
}
console.log(
	JSON.stringify(
		{ directory, status: receipt.status, cells: receipt.cells.length, failures: receipt.failures },
		null,
		2,
	),
);
if (receipt.failures.length) process.exitCode = 1;
