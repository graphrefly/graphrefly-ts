/** Four finite CPU attribution runs of the current focused host, no performance qualification. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const base = resolve(root, "docs/design/causal-lifetime-profile");
let attempt = 1;
while (existsSync(resolve(base, `attempt-${attempt}`))) attempt++;
const directory = resolve(base, `attempt-${attempt}`);
mkdirSync(directory, { recursive: true });
const sha = (value) => createHash("sha256").update(value).digest("hex");
const entry = `
import assert from 'node:assert/strict';
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';
import { composeOfflineSpending,OfflineAlertResource } from './examples/spending-alerts/causal-focused-host.ts';
import { inputsFor,drain } from './scripts/fixtures/spending-focused-host-harness.ts';
import { evaluationFixture,evaluationPack,policyFacts,presetBinding } from './scripts/fixtures/spending-preset-harness.ts';
import { oracleRequest } from './scripts/fixtures/spending-preset-oracle.ts';
import { Graph } from './packages/ts/src/graph/graph.ts';
import { batch } from './packages/ts/src/batch/batch.ts';
const mode=process.argv[2],window=process.argv[3],output=process.argv[4];
const start=window==='first8'?0:56,end=window==='first8'?7:63;
const evaluations=Array.from({length:32},(_,i)=>[evaluationFixture(i,'coffee'),evaluationFixture(i,'tea')]).flat();
const pack=evaluationPack(evaluations),facts=evaluations.map(e=>policyFacts(e));
const expected=evaluations.map(e=>oracleRequest(e,presetBinding).body.payloadText+'\\n');
const arrivals=evaluations.map(e=>({packRef:presetBinding.packRef,evaluationRefs:[e.evaluationRef]}));
const graph=new Graph({name:'spending-lifetime-profile'}),{sources,inputs}=inputsFor(graph),calls=[];
const resource=new OfflineAlertResource(presetBinding,async payload=>{calls.push(payload);return {bytesWritten:Buffer.byteLength(payload)}});
const host=composeOfflineSpending(graph,inputs,presetBinding,resource,{name:'spending',diagnostics:mode});
const stops=Object.values(host.consume.view).map(node=>node.subscribe(()=>{}));
const send=(lane,value)=>sources[lane].down([['DATA',value]]);
const session=new Session();session.connect();
const post=(method,params={})=>new Promise((yes,no)=>session.post(method,params,(error,value)=>error?no(error):yes(value)));
let profile;
try{
 await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:100});
 await drain();send('pack',pack);
 for(let i=0;i<64;i++){
  if(i===start)await post('Profiler.start');
  const f=facts[i];batch(()=>{send('current',f.current);send('verification',f.verification);send('local',f.local);send('arrivals',arrivals[i]);});
  await drain();
  if(i===end){profile=(await post('Profiler.stop')).profile;writeFileSync(output,JSON.stringify(profile));}
 }
 // All assertions and material/record inspection are after sampling has stopped.
 assert.deepEqual(calls,expected);
 const beforeStop=host.inspect();assert.equal(beforeStop.fault,undefined);assert.equal(beforeStop.records.length,64);assert.ok(beforeStop.records.every(r=>r.outcome?.state==='succeeded'));
 const latest=facts.slice(-2);batch(()=>{send('current',{...latest[0].current,current:latest.flatMap(f=>f.current.current)});send('local',{...latest[0].local,stop:true,grants:latest.flatMap(f=>f.local.grants)});});await drain();
 const final=host.inspect();assert.equal(final.normalEndReady,true);assert.equal(final.writes,64);assert.equal(final.inFlight,0);
 console.log(JSON.stringify({mode,window,profileSamples:profile.samples.length,profileDurationUs:profile.endTime-profile.startTime,records:final.records.length,writes:final.writes,allExactOraclePayloads:true,allSucceeded:true,normalEndReady:final.normalEndReady,notifications:final.notifications,maxFrameBytes:final.maxFrameBytes,topology:graph.topology()}));
}finally{
 session.disconnect();stops.forEach(stop=>stop());for(const r of host.owner.roots)r.unsubscribe?.();const group=graph.topologyGroup();for(const n of graph.describe().nodes)group.add(graph.find(n.id));group.release();
}
`;
const method = {
	schema: "spending-host-lifetime-cpu-method/v1",
	createdAt: new Date().toISOString(),
	attempt,
	baseline: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
	scriptSha256: sha(readFileSync(import.meta.filename)),
	runs: [
		{ mode: "off", window: "first8" },
		{ mode: "off", window: "last8" },
		{ mode: "summary", window: "first8" },
		{ mode: "summary", window: "last8" },
	],
	samplingIntervalUs: 100,
	lifetime:
		"64 sequential successful simulated writes:2vendors,32revisions each,original bounds;drain each completion",
	capture:
		"one profiler session around inputs+completion for requests1..8 or57..64; construction/fixture generation/pack ingress/finalstop/assertions/inspect/teardown excluded",
	harnessOverhead:
		"includes loop,source.send wrappers,batch wrapper,writer calls.push and byte counting,drain await continuations,inspector start/stop boundary; five identical no-op view subscriptions",
	limits: [
		"CPU sampling instrumentation changes execution cost; profiles are attribution evidence, not latency benchmarks or formal qualification.",
		"First8 and last8 are fresh processes with different JIT/retained frontiers, not matched stationary samples. No warmup repetition or timing selection.",
		"Sample counts may be sparse, especially first8. Unattributed/GC/native/inspector samples remain explicit; source-mapped function coordinates are start-site attribution, not exact instruction locations.",
		"No real inbox I/O,forcedGC,public API,production change or budget change.",
	],
	sources: [],
};
const receipt = {
	schema: "spending-host-lifetime-cpu-receipt/v1",
	startedAt: new Date().toISOString(),
	attempt,
	status: "running",
	environment: {
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		cpu: cpus()[0]?.model,
	},
	runs: [],
	failures: [],
};
// Decode standard base64 VLQ source-map generated positions for readable raw-profile attribution.
function mapper(map) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let source = 0,
		line = 0,
		column = 0;
	const lines = map.mappings.split(";").map((text) => {
		let generated = 0;
		return text
			.split(",")
			.filter(Boolean)
			.map((segment) => {
				const values = [];
				let value = 0,
					shift = 0;
				for (const char of segment) {
					const digit = alphabet.indexOf(char);
					value += (digit & 31) * 2 ** shift;
					if (digit & 32) {
						shift += 5;
					} else {
						values.push(value & 1 ? -(value >> 1) : value >> 1);
						value = 0;
						shift = 0;
					}
				}
				generated += values[0];
				if (values.length < 4) return { generated };
				source += values[1];
				line += values[2];
				column += values[3];
				return { generated, source: map.sources[source], line: line + 1, column: column + 1 };
			});
	});
	return (frame) => {
		const segments = lines[frame.lineNumber] ?? [];
		let found;
		for (const segment of segments) {
			if (segment.generated > frame.columnNumber) break;
			found = segment;
		}
		return found?.source ? { source: found.source, line: found.line, column: found.column } : null;
	};
}
function attribute(profile, map) {
	const position = mapper(map),
		nodes = new Map(profile.nodes.map((n) => [n.id, n])),
		parents = new Map();
	for (const n of profile.nodes) for (const child of n.children ?? []) parents.set(child, n.id);
	const totals = new Map(),
		sources = new Map();
	let totalUs = 0;
	for (let i = 0; i < (profile.samples ?? []).length; i++) {
		const id = profile.samples[i],
			weight = profile.timeDeltas?.[i] ?? 0;
		totalUs += weight;
		let at = id;
		const visited = new Set();
		while (at !== undefined && !visited.has(at)) {
			visited.add(at);
			const n = nodes.get(at);
			if (!n) break;
			const frame = n.callFrame;
			const original = frame.url.endsWith("worker.mjs") ? position(frame) : null;
			const key = JSON.stringify([
				original?.source ?? frame.url ?? "",
				original?.line ?? frame.lineNumber + 1,
				frame.functionName || "(anonymous)",
			]);
			let row = totals.get(key);
			if (!row) {
				row = {
					functionName: frame.functionName || "(anonymous)",
					source: original?.source ?? frame.url ?? "",
					line: original?.line ?? frame.lineNumber + 1,
					generatedLine: frame.lineNumber + 1,
					selfUs: 0,
					inclusiveUs: 0,
					selfSamples: 0,
				};
				totals.set(key, row);
			}
			row.inclusiveUs += weight;
			if (at === id) {
				row.selfUs += weight;
				row.selfSamples++;
				const sourceKey = row.source || row.functionName;
				sources.set(sourceKey, (sources.get(sourceKey) ?? 0) + weight);
			}
			at = parents.get(at);
		}
	}
	return {
		sampledDeltaUs: totalUs,
		samples: profile.samples?.length ?? 0,
		selfBySource: [...sources]
			.map(([source, selfUs]) => ({ source, selfUs }))
			.sort((a, b) => b.selfUs - a.selfUs),
		functions: [...totals.values()].sort((a, b) => b.selfUs - a.selfUs),
	};
}
try {
	const outfile = resolve(directory, "worker.mjs");
	const compiled = await build({
		stdin: {
			contents: entry,
			resolveDir: root,
			sourcefile: "spending-host-profile-worker.ts",
			loader: "ts",
		},
		bundle: true,
		platform: "node",
		format: "esm",
		outfile,
		metafile: true,
		sourcemap: "external",
		sourcesContent: true,
		minify: false,
		keepNames: true,
	});
	method.sources = Object.keys(compiled.metafile.inputs)
		.filter((p) => p !== "spending-host-profile-worker.ts")
		.sort()
		.map((path) => ({ path, sha256: sha(readFileSync(resolve(root, path))) }));
	method.bundle = {
		path: "worker.mjs",
		sha256: sha(readFileSync(outfile)),
		sourceMapPath: "worker.mjs.map",
		sourceMapSha256: sha(readFileSync(outfile + ".map")),
	};
	// Freeze the declared method and source binding before the first profiled worker starts.
	writeFileSync(resolve(directory, "method.json"), JSON.stringify(method, null, 2) + "\n");
	receipt.methodSha256 = sha(readFileSync(resolve(directory, "method.json")));
	const map = JSON.parse(readFileSync(outfile + ".map", "utf8"));
	for (const run of method.runs) {
		const filename = `${run.mode}-${run.window}.cpuprofile`,
			profilePath = resolve(directory, filename);
		const child = spawnSync(process.execPath, [outfile, run.mode, run.window, profilePath], {
			cwd: root,
			encoding: "utf8",
			timeout: 180000,
			maxBuffer: 2 * 1048576,
		});
		if (child.status !== 0) {
			receipt.failures.push({
				...run,
				status: child.status,
				signal: child.signal,
				error: child.error?.message,
				stdout: child.stdout,
				stderr: child.stderr,
				profileRetained: existsSync(profilePath),
			});
			continue;
		}
		const result = JSON.parse(child.stdout.trim()),
			profile = JSON.parse(readFileSync(profilePath));
		const attribution = attribute(profile, map);
		const attributionName = `${run.mode}-${run.window}-attribution.json`;
		writeFileSync(resolve(directory, attributionName), JSON.stringify(attribution, null, 2) + "\n");
		receipt.runs.push({
			...result,
			profile: filename,
			profileSha256: sha(readFileSync(profilePath)),
			attribution: attributionName,
			attributionSha256: sha(readFileSync(resolve(directory, attributionName))),
		});
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
		? "attribution-incomplete"
		: "attribution-complete-not-qualified";
} catch (error) {
	receipt.status = "attribution-incomplete";
	receipt.failures.push({ error: String(error), stack: error.stack });
} finally {
	receipt.finishedAt = new Date().toISOString();
	writeFileSync(resolve(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
}
console.log(
	JSON.stringify(
		{
			directory,
			status: receipt.status,
			runs: receipt.runs.map((r) => ({
				mode: r.mode,
				window: r.window,
				samples: r.profileSamples,
				durationUs: r.profileDurationUs,
			})),
			failures: receipt.failures,
		},
		null,
		2,
	),
);
if (receipt.failures.length) process.exitCode = 1;
