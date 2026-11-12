/** Same-node automatic/manual orchestration diagnostic plus identical-automatic noise control. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "docs/design/causal-construction-closeout/performance.json");
const temporary = mkdtempSync(join(tmpdir(), "spending-pair-"));
const entry = `
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { composeOfflineSpending,OfflineAlertResource } from './examples/spending-alerts/causal-focused-host.ts';
import { directOfflineSpending } from './scripts/fixtures/spending-focused-host-direct.ts';
import { inputsFor,drain } from './scripts/fixtures/spending-focused-host-harness.ts';
import { evaluationFixture,evaluationPack,policyFacts,presetBinding } from './scripts/fixtures/spending-preset-harness.ts';
import { oracleCanonical,oracleHash,oracleRequest } from './scripts/fixtures/spending-preset-oracle.ts';
import { Graph } from './packages/ts/src/graph/graph.ts';
import { batch } from './packages/ts/src/batch/batch.ts';
const mode=process.argv[2],size=Number(process.argv[3]),comparison=process.argv[4];
const evaluations=Array.from({length:size},(_,i)=>{
 const {occurrence,...value}=evaluationFixture(i);const {digest,...ref}=occurrence;
 const identity={...ref,revision:1,revisionDomain:'independent-'+i};
 return {...value,occurrence:{...identity,digest:oracleHash(oracleCanonical({schemaRevision:'graphrefly/causal-occurrence-contract/v1@contract-v2',...identity,value}))}};
});
const pack=evaluationPack(evaluations),facts=evaluations.map(e=>policyFacts(e));
const current={...facts[0].current,current:facts.flatMap(f=>f.current.current)};
const verification={...facts[0].verification,receipts:facts.flatMap(f=>f.verification.receipts)};
const local={...facts[0].local,grants:facts.flatMap(f=>f.local.grants)};
const arrivals={packRef:presetBinding.packRef,evaluationRefs:evaluations.map(e=>e.evaluationRef)};
const expectedPayload=oracleRequest(evaluations[0],presetBinding).body.payloadText+'\\n';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const rows=[];
async function sample(label,repetition){
 const metrics={};
 function before(){return {time:performance.now(),heap:process.memoryUsage().heapUsed,rss:process.memoryUsage().rss};}
 function after(stage,prior){const time=performance.now();const m=process.memoryUsage();metrics[stage]={ms:time-prior.time,heapUsedBefore:prior.heap,heapUsedAfter:m.heapUsed,heapUsedDelta:m.heapUsed-prior.heap,rssBefore:prior.rss,rssAfter:m.rss};}
 let prior=before();const graph=new Graph({name:'spending-pair'});const {sources,inputs}=inputsFor(graph);
 let resolve;const pending=new Promise(yes=>{resolve=yes});const calls=[];
 const resource=new OfflineAlertResource(presetBinding,payload=>{calls.push(payload);return pending;});
 after('setup',prior);
 const factory=label==='manual'?directOfflineSpending:composeOfflineSpending;
 prior=before();const host=factory(graph,inputs,presetBinding,resource,{name:'spending',diagnostics:mode});after('construction',prior);
 let stops=[];const observed={};const connect=()=>{stops=Object.entries(host.consume.view).map(([name,node])=>node.subscribe(m=>{if(m[0]==='DATA')(observed[name]??=[]).push(m[1]);}));};
 const disconnect=()=>{stops.forEach(stop=>stop());stops=[];};
 try {
  prior=before();connect();after('subscribe',prior);
  prior=before();await drain();after('readiness',prior);
  const send=(lane,value)=>sources[lane].down([['DATA',value]]);
  prior=before();send('pack',pack);batch(()=>{send('current',current);send('verification',verification);send('local',local);send('arrivals',arrivals);});after('firstInput',prior);
  assert.deepEqual(calls,[expectedPayload]);
  prior=before();resolve({bytesWritten:Buffer.byteLength(calls[0])});await drain();after('completion',prior);
  prior=before();disconnect();connect();after('reconnect',prior);
  const inspected=host.inspect();assert.equal(inspected.fault,undefined);assert.equal(inspected.records.length,size);
  assert.equal(inspected.records.filter(r=>r.outcome?.state==='succeeded').length,1);
  assert.equal(inspected.records.filter(r=>r.outcome?.state==='cancelled').length,size-1);
  const topology=graph.topology();const evidence={topology,calls,observed,records:inspected.records};
  return {label,repetition,metrics,topologyNodes:topology.nodes.length,topologyEdges:topology.edges.length,notifications:inspected.notifications,maxFrameBytes:inspected.maxFrameBytes,evidence,evidenceSha256:hash(evidence)};
 }finally{
  disconnect();for(const lease of host.owner.roots)lease.unsubscribe?.();
  const group=graph.topologyGroup();for(const node of graph.describe().nodes)group.add(graph.find(node.id));group.release();
 }
}
const labels=comparison==='automatic-manual'?['automatic','manual']:['automatic-A','automatic-B'];
for(let repetition=-5;repetition<20;repetition++){
 const order=repetition%2===0?labels:[...labels].reverse();
 const pair=[];for(const label of order)pair.push(await sample(label,repetition));
 assert.deepEqual(pair[0].evidence,pair[1].evidence,'same topology, requests, retained outcomes and consumer output streams');
 if(repetition>=0)for(const row of pair){delete row.evidence;rows.push(row);}
}
console.log(JSON.stringify({mode,size,comparison,rows,maxRssKiB:process.resourceUsage().maxRSS}));
`;
const receipt = {
	schema: "spending-construction-pair-diagnostic/v1",
	startedAt: new Date().toISOString(),
	status: "running",
	command: "node scripts/measure-spending-construction-pair.mjs",
	environment: {
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		cpu: cpus()[0]?.model,
	},
	protocol: {
		warmupsPerArm: 5,
		samplesPerArm: 20,
		modes: ["off", "summary"],
		sizes: [1, 8],
		comparisons: ["automatic-manual", "automatic-automatic-control"],
		order: "fresh child per mode/size/comparison; alternating pair order, no forced GC",
		construction:
			"factory only, graph/input/resource setup and identical five view subscriptions separately timed",
		checks:
			"every warmup/measured pair asserts exact topology, independent oracle writer payload, retained request/outcome records and all consumer view DATA streams; no external I/O",
		retries: 0,
	},
	limitations: [
		"Descriptive diagnostic, not formal frozen performance qualification or100ms latency guarantee.",
		"Manual and automatic arms share the same cold node builder: measures orchestration equivalence, not an independently implemented runtime.",
		"HeapUsed deltas include allocations, reclamation and V8 noise; negative deltas are valid. RSS includes the entire worker process and both arms, not per-node retained memory.",
		"Memory reads add equal measurement overhead; tiny timing differences near automatic/automatic control must not be attributed to the wrapper.",
		"Completion wait is simulated immediate fulfillment, excludes real I/O; no heap attribution, soak or contention isolation.",
	],
	sources: [],
	cells: [],
	failures: [],
};
function stats(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		mean: values.reduce((a, b) => a + b, 0) / values.length,
		median: (sorted[9] + sorted[10]) / 2,
		p95: sorted[18],
		min: sorted[0],
		max: sorted.at(-1),
	};
}
try {
	const outfile = join(temporary, "worker.mjs");
	const compiled = await build({
		stdin: {
			contents: entry,
			resolveDir: root,
			sourcefile: "spending-construction-pair.ts",
			loader: "ts",
		},
		bundle: true,
		platform: "node",
		format: "esm",
		outfile,
		metafile: true,
	});
	receipt.sources = Object.keys(compiled.metafile.inputs)
		.filter((p) => p !== "spending-construction-pair.ts")
		.sort()
		.map((path) => ({
			path,
			sha256: createHash("sha256")
				.update(readFileSync(resolve(root, path)))
				.digest("hex"),
		}));
	for (const mode of receipt.protocol.modes)
		for (const size of receipt.protocol.sizes)
			for (const comparison of receipt.protocol.comparisons) {
				const child = spawnSync(process.execPath, [outfile, mode, String(size), comparison], {
					cwd: root,
					encoding: "utf8",
					timeout: 180000,
					maxBuffer: 8 * 1048576,
				});
				if (child.status !== 0) {
					receipt.failures.push({
						mode,
						size,
						comparison,
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
				const labels = [...new Set(cell.rows.map((r) => r.label))];
				for (const label of labels) {
					const rows = cell.rows.filter((r) => r.label === label);
					cell.summary[label] = Object.fromEntries(
						Object.keys(rows[0].metrics).map((stage) => [
							stage,
							{
								ms: stats(rows.map((r) => r.metrics[stage].ms)),
								heapUsedDelta: stats(rows.map((r) => r.metrics[stage].heapUsedDelta)),
							},
						]),
					);
				}
				cell.pairedConstructionDifferencesMs = Array.from({ length: 20 }, (_, i) => {
					const pair = cell.rows.filter((r) => r.repetition === i);
					const automatic = pair.find((r) => r.label === "automatic" || r.label === "automatic-A");
					const other = pair.find((r) => r !== automatic);
					return automatic.metrics.construction.ms - other.metrics.construction.ms;
				});
				cell.pairedConstructionDifferenceSummary = stats(cell.pairedConstructionDifferencesMs);
				receipt.cells.push(cell);
			}
	receipt.sourceChangesDuringRun = receipt.sources
		.filter(
			({ path, sha256 }) =>
				createHash("sha256")
					.update(readFileSync(resolve(root, path)))
					.digest("hex") !== sha256,
		)
		.map((s) => s.path);
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
	rmSync(temporary, { recursive: true, force: true });
}
console.log(
	JSON.stringify(
		{
			status: receipt.status,
			cells: receipt.cells.map((c) => ({
				mode: c.mode,
				size: c.size,
				comparison: c.comparison,
				constructionDifference: c.pairedConstructionDifferenceSummary,
			})),
			failures: receipt.failures,
		},
		null,
		2,
	),
);
if (receipt.failures.length) process.exitCode = 1;
