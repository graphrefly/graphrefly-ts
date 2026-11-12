/** Bounded growing-retention lifetime diagnostic; not stationary throughput or qualification. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "docs/design/causal-lifetime-closeout/receipt.json");
const temp = mkdtempSync(join(tmpdir(), "spending-lifetime-"));
const entry = `
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { composeOfflineSpending,OfflineAlertResource } from './examples/spending-alerts/causal-focused-host.ts';
import { directOfflineSpending } from './scripts/fixtures/spending-focused-host-direct.ts';
import { inputsFor,drain } from './scripts/fixtures/spending-focused-host-harness.ts';
import { evaluationFixture,evaluationPack,policyFacts,presetBinding } from './scripts/fixtures/spending-preset-harness.ts';
import { oracleRequest } from './scripts/fixtures/spending-preset-oracle.ts';
import { Graph } from './packages/ts/src/graph/graph.ts';
import { batch } from './packages/ts/src/batch/batch.ts';
const mode=process.argv[2],kind=process.argv[3],memoryArm=process.argv[4];
const evaluations=Array.from({length:32},(_,i)=>[evaluationFixture(i,'coffee'),evaluationFixture(i,'tea')]).flat();
const pack=evaluationPack(evaluations),facts=evaluations.map(e=>policyFacts(e));
const payloads=evaluations.map(e=>oracleRequest(e,presetBinding).body.payloadText+'\\n');
const arrivals=evaluations.map(e=>({packRef:presetBinding.packRef,evaluationRefs:[e.evaluationRef]}));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function create(arm){
 const graph=new Graph({name:'spending-lifetime'});const {sources,inputs}=inputsFor(graph);const calls=[];
 const resource=new OfflineAlertResource(presetBinding,async payload=>{calls.push(payload);return {bytesWritten:Buffer.byteLength(payload)}});
 const host=(arm==='automatic'?composeOfflineSpending:directOfflineSpending)(graph,inputs,presetBinding,resource,{name:'spending',diagnostics:mode});
 const stops=Object.values(host.consume.view).map(node=>node.subscribe(()=>{}));
 const send=(lane,value)=>sources[lane].down([['DATA',value]]);
 return {graph,host,calls,send,teardown(){stops.forEach(stop=>stop());for(const r of host.owner.roots)r.unsubscribe?.();const group=graph.topologyGroup();for(const n of graph.describe().nodes)group.add(graph.find(n.id));group.release();}};
}
async function drive(run,recordTimes){
 await drain();run.send('pack',pack);const rows=[];
 for(let i=0;i<64;i++){
  const f=facts[i];const t0=performance.now();
  batch(()=>{run.send('current',f.current);run.send('verification',f.verification);run.send('local',f.local);run.send('arrivals',arrivals[i]);});
  const syncInputMs=performance.now()-t0;
  assert.equal(run.calls.length,i+1);assert.equal(run.calls[i],payloads[i]);
  const t1=performance.now();await drain();const completionMs=performance.now()-t1;
  const inspected=run.host.inspect();assert.equal(inspected.fault,undefined);assert.equal(inspected.records.length,i+1);assert.ok(inspected.records.every(r=>r.outcome?.state==='succeeded'));
  if(recordTimes)rows.push({frontier:i+1,domain:evaluations[i].occurrence.revisionDomain,revision:evaluations[i].occurrence.revision,syncInputMs,completionMs,notifications:inspected.notifications,maxFrameBytes:inspected.maxFrameBytes,heapUsed:process.memoryUsage().heapUsed,rss:process.memoryUsage().rss});
 }
 const latest=facts.slice(-2);batch(()=>{run.send('current',{...latest[0].current,current:latest.flatMap(f=>f.current.current)});run.send('local',{...latest[0].local,stop:true,grants:latest.flatMap(f=>f.local.grants)});});await drain();
 const inspected=run.host.inspect();assert.equal(inspected.normalEndReady,true);assert.equal(inspected.writes,64);assert.equal(inspected.inFlight,0);assert.equal(inspected.records.length,64);assert.ok(inspected.records.every(r=>r.outcome?.state==='succeeded'));
 return {rows,witness:{topology:run.graph.topology(),calls:run.calls,records:inspected.records,normalEndReady:inspected.normalEndReady},final:{records:64,writes:64,notifications:inspected.notifications,maxFrameBytes:inspected.maxFrameBytes,normalEndReady:true}};
}
if(kind==='timing'){
 const lifetimes=[];
 for(let repetition=-1;repetition<3;repetition++){
  const order=repetition%2===0?['automatic','manual']:['manual','automatic'];const pair=[];
  for(const arm of order){const start=performance.now();const run=create(arm);const constructionAndSubscribeMs=performance.now()-start;
   try{const result=await drive(run,true);pair.push({arm,repetition,constructionAndSubscribeMs,...result});}finally{run.teardown();}
  }
  assert.deepEqual(pair[0].witness,pair[1].witness,'exact topology, oracle payloads, retained results and normal-end eligibility');
  if(repetition>=0)for(const value of pair){value.witnessSha256=hash(value.witness);delete value.witness;lifetimes.push(value);}
 }
 console.log(JSON.stringify({mode,kind,lifetimes,maxRssKiB:process.resourceUsage().maxRSS}));
}else{
 assert.equal(typeof global.gc,'function');
 const collect=()=>{global.gc();global.gc();return process.memoryUsage();};
 const beforeConstruction=collect();let run=create(memoryArm);let result=await drive(run,false);
 const witnessSha256=hash(result.witness);const final=result.final;result=null;
 const activeRetained=collect();run.teardown();run=null;await drain();const afterForcedTestTeardown=collect();
 console.log(JSON.stringify({mode,kind,arm:memoryArm,witnessSha256,final,beforeConstruction,activeRetained,afterForcedTestTeardown,
  heapUsedDeltaActive:activeRetained.heapUsed-beforeConstruction.heapUsed,heapUsedDeltaAfterTeardown:afterForcedTestTeardown.heapUsed-beforeConstruction.heapUsed,maxRssKiB:process.resourceUsage().maxRSS}));
}
`;
const receipt = {
	schema: "spending-host-finite-lifetime-diagnostic/v1",
	startedAt: new Date().toISOString(),
	status: "running",
	command: "node scripts/measure-spending-host-lifetime.mjs",
	baseline: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
	environment: {
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		cpu: cpus()[0]?.model,
	},
	method: {
		modes: ["off", "summary"],
		arms: ["automatic", "manual"],
		requests: 64,
		domains: 2,
		revisionsPerDomain: 32,
		warmupFullLifetimesPerArm: 1,
		measuredFullLifetimesPerArm: 3,
		pairOrder: "alternating arm order within each repetition; fresh child per mode",
		timingForcedGc: false,
		memory:
			"separate fresh --expose-gc child per arm/mode; two gc calls at each beforeconstruction,active64retained,afterforcedtestteardown point",
		capacity:
			"unchanged original64materials/effects/writes and one write in flight; each completion drained before next input",
		checks:
			"oracle payload at every write; exact automatic/manual topology and retained outcomes; final normalEndReady=true",
	},
	limitations: [
		"Finite growing-retention trajectories, not independent input samples or stationary steady-state throughput.",
		"No formal qualification, hard100ms guarantee, provider or filesystem I/O; immediate simulated write fulfillment excludes external latency.",
		"Timing includes identical five no-op view subscriptions and runtime host work; checkpoint assertions and memory reads occur outside recorded input/completion intervals.",
		"Post-GC heap deltas are descriptive process observations, not complete allocation/retained-memory attribution or leak proof. V8/JIT/module and fixture costs remain.",
		"Active-retained point is after normalEndReady but before teardown; all64settled host records remain owned by the running graph. Test teardown is forced resource release, not a public lifecycle API.",
		"Automatic/manual share the cold node builder; tests establish orchestration parity, not independent runtime implementation.",
	],
	sources: [],
	timing: [],
	memory: [],
	failures: [],
};
try {
	const outfile = join(temp, "worker.mjs");
	const compiled = await build({
		stdin: {
			contents: entry,
			resolveDir: root,
			sourcefile: "spending-host-lifetime.ts",
			loader: "ts",
		},
		bundle: true,
		platform: "node",
		format: "esm",
		outfile,
		metafile: true,
	});
	receipt.sources = Object.keys(compiled.metafile.inputs)
		.filter((p) => p !== "spending-host-lifetime.ts")
		.sort()
		.map((path) => ({
			path,
			sha256: createHash("sha256")
				.update(readFileSync(resolve(root, path)))
				.digest("hex"),
		}));
	for (const mode of receipt.method.modes)
		for (const kind of ["timing", "memory"]) {
			for (const arm of kind === "timing" ? [undefined] : receipt.method.arms) {
				const child = spawnSync(
					process.execPath,
					[
						...(kind === "memory" ? ["--expose-gc"] : []),
						outfile,
						mode,
						kind,
						...(arm ? [arm] : []),
					],
					{ cwd: root, encoding: "utf8", timeout: 240000, maxBuffer: 8 * 1048576 },
				);
				if (child.status !== 0)
					receipt.failures.push({
						mode,
						kind,
						arm,
						status: child.status,
						signal: child.signal,
						error: child.error?.message,
						stdout: child.stdout,
						stderr: child.stderr,
					});
				else receipt[kind].push(JSON.parse(child.stdout.trim()));
			}
		}
	receipt.sourceChangesDuringRun = receipt.sources
		.filter(
			({ path, sha256 }) =>
				createHash("sha256")
					.update(readFileSync(resolve(root, path)))
					.digest("hex") !== sha256,
		)
		.map((v) => v.path);
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
	if (existsSync(output)) {
		let n = 1;
		while (existsSync(output.replace("receipt.json", "receipt-attempt" + n + ".json"))) n++;
		const previous = readFileSync(output);
		const preserved = output.replace("receipt.json", "receipt-attempt" + n + ".json");
		writeFileSync(preserved, previous);
		receipt.previousAttempt = {
			path: preserved,
			sha256: createHash("sha256").update(previous).digest("hex"),
			relationship: "preserved separately; no pooling",
		};
	}
	writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
	rmSync(temp, { recursive: true, force: true });
}
console.log(
	JSON.stringify(
		{
			status: receipt.status,
			timingCells: receipt.timing.length,
			memoryCells: receipt.memory.length,
			failures: receipt.failures,
		},
		null,
		2,
	),
);
if (receipt.failures.length) process.exitCode = 1;
