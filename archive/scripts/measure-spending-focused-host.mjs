/** Finite descriptive host-integration measurement; no formal qualification or external I/O. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "docs/design/causal-integrated-implementation/performance.json");
const temp = mkdtempSync(join(tmpdir(), "spending-host-measure-"));
const entry = `
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { runHost, drain } from './scripts/fixtures/spending-focused-host-harness.ts';
import { presetRun,evaluationFixture,evaluationPack,policyFacts,presetBinding } from './scripts/fixtures/spending-preset-harness.ts';
import { batch } from './packages/ts/src/batch/batch.ts';
import { oracleHash,oracleCanonical } from './scripts/fixtures/spending-preset-oracle.ts';
const mode=process.argv[2], size=Number(process.argv[3]);
const es=Array.from({length:size},(_,i)=>{
 const {occurrence,...value}=evaluationFixture(i);
 const {digest,...ref}=occurrence;
 const identity={...ref,revision:1,revisionDomain:'independent-'+i};
 return {...value,occurrence:{...identity,digest:oracleHash(oracleCanonical({schemaRevision:'graphrefly/causal-occurrence-contract/v1@contract-v2',...identity,value}))}};
});
if(size===64) {
 const run=runHost(mode);
 try {
  await drain();run.drive(es);run.pending.resolve({bytesWritten:Buffer.byteLength(run.calls[0])});await drain();
  const stats=run.host.inspect();assert.equal(stats.records.length,64);assert.equal(stats.fault,undefined);
  assert.equal([...run.state().effects.values()].filter(r=>r.outcome).length,64);
  console.log(JSON.stringify({mode,records:64,simulatedWrites:run.calls.length,notifications:stats.notifications,maxFrameBytes:stats.maxFrameBytes,kind:'capacity-snapshot-only-no-timing'}));
 }finally{run.teardown();}
 process.exit(0);
}
const fs=es.map(e=>policyFacts(e)), pack=evaluationPack(es);
const current={...fs[0].current,current:fs.flatMap(f=>f.current.current)};
const verification={...fs[0].verification,receipts:fs.flatMap(f=>f.verification.receipts)};
const local={...fs[0].local,grants:fs.flatMap(f=>f.local.grants)};
const arrivals={packRef:presetBinding.packRef,evaluationRefs:es.map(e=>e.evaluationRef)};
const results=[];
for(let repetition=-5;repetition<20;repetition++) {
 for(const variant of (repetition%2===0?['host','direct']:['direct','host'])) {
  let run, stops=[];
  try {
   const t0=performance.now(); run=variant==='host'?runHost(mode):presetRun(mode);
   const constructionMs=performance.now()-t0;
   run.disconnect();
   const view=variant==='host'?run.host.consume.view:run.built.consume.view;
   const connect=()=>{stops=Object.values(view).map(node=>node.subscribe(()=>{}));};
   const disconnect=()=>{stops.forEach(stop=>stop());stops=[];};
   connect();
   const t1=performance.now();
   if(variant==='host') await drain(); else run.send('inbox',fs[0].inbox);
   const readinessMs=performance.now()-t1;
   const t2=performance.now();
   run.send('pack',pack);
   batch(()=>{run.send('current',current);run.send('verification',verification);run.send('local',local);run.send('arrivals',arrivals);});
   const firstInputMs=performance.now()-t2;
   const records=[...run.state().effects.values()];
   assert.equal(records.length,size); assert.ok(records.every(r=>r.admission?.state==='admitted'));
   const t3=performance.now();
   if(variant==='host') {
    assert.equal(run.calls.length,1);
    run.pending.resolve({bytesWritten:Buffer.byteLength(run.calls[0])}); await drain();
   } else {
    // Explicit fixture injection emulates the same one success / busy cancellations.
    const outcomes=records.map((r,i)=>({...r.proposal,admissionRef:r.admission.admissionRef,
     state:i===0?'succeeded':'cancelled',result:i===0?{kind:'ok',value:{source:'offline-host',io:false}}:
     {kind:'error',error:{kind:'issue',code:'spending-host/busy-or-write-budget',message:'busy-or-write-budget'}}}));
    run.send('inbox',{...fs[0].inbox,outcomes}); await drain();
   }
   const completionMs=performance.now()-t3;
   const states=[...run.state().effects.values()].map(r=>r.outcome?.state);
   assert.equal(states.filter(s=>s==='succeeded').length,1);
   assert.equal(states.filter(s=>s==='cancelled').length,size-1);
   const t4=performance.now(); disconnect();connect();const reconnectMs=performance.now()-t4;
   const stats=variant==='host'?run.host.inspect():null;
   assert.equal(stats?.fault,undefined);
   if(repetition>=0) results.push({variant,repetition,constructionMs,readinessMs,firstInputMs,completionMs,reconnectMs,
    rssMiB:process.memoryUsage().rss/1048576,topologyNodes:run.graph.describe().nodes.length,
    notifications:stats?.notifications??null,maxFrameBytes:stats?.maxFrameBytes??null});
  } finally { stops.forEach(stop=>stop()); if(run) { if(variant==='host')run.teardown();else run.cleanup(); } }
 }
}
console.log(JSON.stringify({mode,size,results,maxRssKiB:process.resourceUsage().maxRSS}));
`;
const receipt = {
	schema: "spending-focused-host-diagnostic-performance/v1",
	startedAt: new Date().toISOString(),
	status: "running",
	attempt: 2,
	supersedesAttempt: {
		path: "docs/design/causal-integrated-implementation/performance-attempt1.json",
		reason:
			"Repair invalid eight-vendor fixture using independent domains sharing coffee vendor; normalize measured input/completion/reconnect observers. Prior attempt retained and not pooled.",
	},
	command: "node scripts/measure-spending-focused-host.mjs",
	node: process.version,
	platform: process.platform,
	arch: process.arch,
	cpu: cpus()[0]?.model,
	protocol: {
		warmupsPerVariantPerCell: 5,
		samplesPerVariantPerCell: 20,
		modes: ["off", "summary"],
		sizes: [1, 8],
		order: "one fresh child process per mode/size; alternating host/direct within each repetition",
		retries: 0,
		forcedGc: false,
		fixture:
			"independent oracle-backed evaluationFixture/policyFacts; independent revision domains with one coffee vendor; same pack and batched inputs",
		completion:
			"host deferred write resolved, direct exact fixture outcomes injected; one success and size-1 busy cancellations",
	},
	limitations: [
		"Diagnostic only; not frozen CSP11, formal 1.20/1.10 gates, or 100ms qualification.",
		"Different topology and execution semantics: delta measures whole host integration plus existing harness behavior, not thin factory overhead.",
		"Construction includes existing harness subscriptions: direct also observes conservation and summary; host observes consumer view only. Subsequent input/completion/reconnect measurements use exactly the same five view-only no-op subscribers in both arms; normalization is outside timing.",
		"First input includes pack and five fact/arrival lane updates; fixture preparation is excluded. Completion excludes external wait and uses no real I/O.",
		"Direct completion injects exact observations while host validates, retains, schedules and publishes them. These are not equivalent host implementations.",
		"Construction creates fresh graphs inside warmed processes, not process cold start. RSS includes Node/V8, bundle, both variants, allocator and GC history; not per-graph retained memory.",
		"No heap attribution, contention isolation, soak, or formal statistical confidence; 20 samples make p95 descriptive only.",
	],
	sources: [],
	cells: [],
	capacitySnapshots: [],
	failures: [],
};
function summary(rows, key) {
	const values = rows.map((r) => r[key]).sort((a, b) => a - b);
	return {
		mean: values.reduce((a, b) => a + b, 0) / values.length,
		median: values[Math.floor(values.length / 2)],
		p95: values[Math.ceil(values.length * 0.95) - 1],
		min: values[0],
		max: values.at(-1),
	};
}
try {
	const outfile = join(temp, "worker.mjs");
	const compiled = await build({
		stdin: { contents: entry, resolveDir: root, sourcefile: "host-diagnostic.ts", loader: "ts" },
		bundle: true,
		platform: "node",
		format: "esm",
		outfile,
		metafile: true,
	});
	receipt.sources = Object.keys(compiled.metafile.inputs)
		.filter((p) => p !== "host-diagnostic.ts")
		.sort()
		.map((path) => ({
			path,
			sha256: createHash("sha256")
				.update(readFileSync(resolve(root, path)))
				.digest("hex"),
		}));
	for (const mode of ["off", "summary"])
		for (const size of [1, 8]) {
			const child = spawnSync(process.execPath, [outfile, mode, String(size)], {
				cwd: root,
				encoding: "utf8",
				timeout: 180000,
				maxBuffer: 4 * 1048576,
			});
			if (child.status !== 0) {
				receipt.failures.push({
					mode,
					size,
					status: child.status,
					signal: child.signal,
					error: child.error?.message,
					stdout: child.stdout,
					stderr: child.stderr,
				});
				continue;
			}
			const cell = JSON.parse(child.stdout.trim());
			cell.summary = {};
			for (const variant of ["direct", "host"]) {
				const rows = cell.results.filter((r) => r.variant === variant);
				cell.summary[variant] = Object.fromEntries(
					[
						"constructionMs",
						"readinessMs",
						"firstInputMs",
						"completionMs",
						"reconnectMs",
						"rssMiB",
						"topologyNodes",
					].map((key) => [key, summary(rows, key)]),
				);
			}
			cell.hostToDirectMeanRatios = Object.fromEntries(
				["constructionMs", "firstInputMs", "completionMs", "reconnectMs"].map((key) => [
					key,
					cell.summary.host[key].mean / cell.summary.direct[key].mean,
				]),
			);
			receipt.cells.push(cell);
		}
	for (const mode of ["off", "summary"]) {
		const child = spawnSync(process.execPath, [outfile, mode, "64"], {
			cwd: root,
			encoding: "utf8",
			timeout: 180000,
			maxBuffer: 1048576,
		});
		if (child.status !== 0)
			receipt.failures.push({
				kind: "capacity-snapshot",
				mode,
				status: child.status,
				stderr: child.stderr,
			});
		else receipt.capacitySnapshots.push(JSON.parse(child.stdout.trim()));
	}
	receipt.sourceChangesDuringRun = receipt.sources
		.filter(
			({ path, sha256 }) =>
				createHash("sha256")
					.update(readFileSync(resolve(root, path)))
					.digest("hex") !== sha256,
		)
		.map(({ path }) => path);
	if (receipt.sourceChangesDuringRun.length)
		receipt.failures.push({
			kind: "source-changed-during-run",
			paths: receipt.sourceChangesDuringRun,
		});
	receipt.status = receipt.failures.length
		? "diagnostic-incomplete"
		: "diagnostic-complete-not-qualified";
} catch (error) {
	receipt.status = "diagnostic-incomplete";
	receipt.failures.push({ error: String(error), stack: error.stack });
} finally {
	receipt.finishedAt = new Date().toISOString();
	receipt.scriptSha256 = createHash("sha256")
		.update(readFileSync(import.meta.filename))
		.digest("hex");
	writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
	rmSync(temp, { recursive: true, force: true });
}
console.log(
	JSON.stringify(
		{
			status: receipt.status,
			cells: receipt.cells.map((c) => ({
				mode: c.mode,
				size: c.size,
				summary: c.summary,
				ratios: c.hostToDirectMeanRatios,
			})),
			failures: receipt.failures,
		},
		null,
		2,
	),
);
if (receipt.failures.length) process.exitCode = 1;
