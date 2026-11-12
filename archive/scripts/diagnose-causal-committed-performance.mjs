/** Finite D163 diagnosis; descriptive only, never replaces the failed qualification gate. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[process.argv.indexOf("--output-dir") + 1];
assert.ok(process.argv.includes("--output-dir") && out, "fresh --output-dir required");
const output = resolve(out);
const selected = process.argv.includes("--processes")
	? process.argv[process.argv.indexOf("--processes") + 1].split(",").map(Number)
	: [0, 1, 2, 3];
assert.ok(
	selected.length &&
		selected.every((x) => Number.isInteger(x) && x >= 0 && x < 4) &&
		new Set(selected).size === selected.length,
);
assert.equal(existsSync(output), false, "never replace an existing diagnostic attempt");
mkdirSync(output, { recursive: true });
const digest = (x) => `sha256:${createHash("sha256").update(x).digest("hex")}`;
const baselineCommit = "d9c868dc8c2cec395f96a5ae327f692cc37c6df7";
const command = (args) => {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 20e6 });
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
};
const temp = mkdtempSync(join(tmpdir(), "causal-diagnosis-"));
const src = join(root, "packages/ts/src");
const frozenFile = join(
	root,
	"packages/ts/qualification/causal-occurrence/ts-v4-construction-inputs.json",
);
const frozen = JSON.parse(readFileSync(frozenFile, "utf8"));
assert.equal(
	frozen.receiptDigest,
	digest(readFileSync(join(dirname(frozenFile), "ts-v4-receipt.json"))),
);
const put = (path, bytes) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, bytes);
};
for (const [name, file] of Object.entries(frozen.files)) {
	assert.equal(digest(file.text), file.digest);
	put(join(temp, "ts-v4", name), file.text);
}
for (const name of command(["ls-tree", "-r", "--name-only", baselineCommit, "packages/ts/src"])
	.trim()
	.split("\n")) {
	if (name.endsWith(".ts"))
		put(
			join(temp, "d9", name.slice("packages/ts/src/".length)),
			command(["show", `${baselineCommit}:${name}`]),
		);
}
const authorityRunner = readFileSync(join(root, "scripts/compare-causal-authority.mjs"), "utf8");
const fixture = authorityRunner.slice(
	authorityRunner.indexOf("const lanes ="),
	authorityRunner.indexOf("function graphRun(make, scenario)"),
);
const qualifiedRunner = readFileSync(join(root, "scripts/compare-causal-construction.mjs"), "utf8");
let runSource = qualifiedRunner.slice(
	qualifiedRunner.indexOf("function run(candidate,"),
	qualifiedRunner.indexOf("const scenarios=["),
);
assert.ok(runSource.includes("return {events,shape,constructionNs,timings};"));
runSource = runSource
	.replace(
		"const g=candidate?",
		"const runStart=performance.now();const cpuStart=process.cpuUsage();const heapStart=process.memoryUsage().heapUsed;const g=candidate?",
	)
	.replace(
		"const events=[];const timings=[];",
		"const events=[];const timings=[];const intervals=[];const subscribedAt=performance.now();",
	)
	.replace(
		" const shape=g.describe()",
		" const describeStart=performance.now();const shape=g.describe()",
	)
	.replace(
		" for(const arrival of scenario.arrivals)",
		" const describeEnd=performance.now();for(const arrival of scenario.arrivals)",
	)
	.replace(
		"timings.push((performance.now()-t)*1e6);",
		"const end=performance.now();timings.push((end-t)*1e6);intervals.push({lane:arrival.lane,start:t,end});",
	)
	.replace(
		" for(const stop of stops.reverse())",
		" const cleanupStart=performance.now();for(const stop of stops.reverse())",
	)
	.replace(
		"return {events,shape,constructionNs,timings};",
		"return {events,shape,constructionNs,timings,intervals,runStart,runEnd:performance.now(),cpu:process.cpuUsage(cpuStart),heapStart,heapEnd:process.memoryUsage().heapUsed,phases:{constructStart:start,constructEnd:start+constructionNs/1e6,subscribeMs:describeStart-subscribedAt,describeMs:describeEnd-describeStart,cleanupStart}};",
	);
const layout = {
	schema: "graphrefly-ts/committed-view-diagnosis/v1",
	qualification: false,
	sourceCommit: command(["rev-parse", "HEAD"]).trim(),
	baselineCommit,
	frozenDigest: digest(readFileSync(frozenFile)),
	runnerDigest: digest(readFileSync(fileURLToPath(import.meta.url))),
	fixtureDigest: digest(fixture),
	originalRunnerDigest: digest(qualifiedRunner),
	processes: [
		{ baseline: "ts-v4", backgrounds: [0, 1000] },
		{ baseline: "d9", backgrounds: [1000, 0] },
		{ baseline: "d9", backgrounds: [0, 1000] },
		{ baseline: "ts-v4", backgrounds: [1000, 0] },
	],
	selected,
	construction: { warmPairs: 80, measuredPairs: 100 },
	steady: { warmPairs: 20, measuredPairs: 80 },
	meaning:
		"Same original seven observed ports, events, cleanup and ten-arrival trace. Fresh process per baseline/order. Per-arrival clocks, run CPU/heap and asynchronous GC entries added. No forced GC or discarded measured samples; no budget requalification.",
};
writeFileSync(join(output, "layout.json"), JSON.stringify(layout, null, 2));
try {
	for (const [index, config] of layout.processes.entries()) {
		if (!selected.includes(index)) continue;
		const reference = join(temp, config.baseline);
		let run = runSource;
		if (config.baseline === "d9") {
			const from = run.indexOf(" if(!candidate) {");
			const to = run.indexOf(" const constructionNs", from);
			run =
				run.slice(0, from) +
				" if(!candidate)g.node([g.find('causal/authority')],()=>{}, {name:'causal/committed-effects',factory:'causalCommittedEffectsProjection'});\n" +
				run.slice(to);
			run = run.replace(
				"constructionOf(g,'causal')",
				"(candidate?constructionOf:referenceConstructionOf)(g,'causal')",
			);
		}
		const resultPath = join(output, `process-${index}.json`);
		const runner = `
import assert from 'node:assert/strict';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { Graph as ReferenceGraph } from '${reference}/graph/graph.ts';
import { causalOccurrenceBundle as referenceBundle } from '${reference}/solutions/causal-occurrence.ts';
import { Graph } from '${src}/graph/graph.ts';
import { causalOccurrenceBundle, causalOccurrenceDigest } from '${src}/solutions/causal-occurrence.ts';
import { constructionOf } from '${src}/graph/construction-scope.ts';
${config.baseline === "d9" ? `import { constructionOf as referenceConstructionOf } from '${reference}/graph/construction-scope.ts';` : ""}
${fixture}
const originalPorts=['released','currentness','terminals','conservation','coverage','quiescence','issues'];
${run}
const gc=[];const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({start:e.startTime,duration:e.duration,detail:e.detail});});observer.observe({entryTypes:['gc']});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const scenario=trace(1,0,false),empty={...scenario,arrivals:[]};
const rows=[];
for(const background of ${JSON.stringify(config.backgrounds)}) {
 const before=run(false,scenario,background),after=run(true,scenario,background);
 assert.deepEqual(before.events,after.events);assert.deepEqual(before.shape,after.shape);
 const samples=[];
 for(const [phase,trace,warm,pairs] of [['construction',empty,80,100],['steady',scenario,20,80]]) {
  for(let i=0;i<warm;i++){run(false,trace,background);run(true,trace,background);if(i%10===0)await tick();}
  for(let i=0;i<pairs;i++) {
   for(const candidate of i%2?[true,false]:[false,true]) {
    const value=run(candidate,trace,background);delete value.events;delete value.shape;
    samples.push({phase,pair:i,candidate,...value});await tick();
   }
  }
 }
 rows.push({background,samples});console.log('row done',background);
}
await tick();await tick();for(const e of observer.takeRecords())gc.push({start:e.startTime,duration:e.duration,detail:e.detail});observer.disconnect();
writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({runtime:process.version,platform:process.platform,arch:process.arch,config:${JSON.stringify(config)},arrivals:scenario.arrivals.map(x=>x.lane),rows,gc},null,2));
`;
		const bundle = join(output, `process-${index}.mjs`);
		writeFileSync(join(output, `process-${index}.ts`), runner);
		const compilation = await build({
			stdin: { contents: runner, resolveDir: root, loader: "ts" },
			outfile: bundle,
			bundle: true,
			platform: "node",
			format: "esm",
			metafile: true,
			nodePaths: [join(root, "node_modules")],
			define: { __GRAPHREFLY_TS_PACKAGE_REVISION__: JSON.stringify("graphrefly-ts:0.9.0") },
		});
		const inputs = Object.keys(compilation.metafile.inputs).filter((x) => x !== "<stdin>");
		const closure = Object.fromEntries(
			inputs.map((x) => [resolve(root, x), digest(readFileSync(resolve(root, x)))]),
		);
		const child = spawnSync(process.execPath, ["--expose-gc", bundle], {
			encoding: "utf8",
			timeout: 120000,
			maxBuffer: 2e6,
		});
		writeFileSync(
			join(output, `process-${index}.log`),
			child.stdout + child.stderr + `\nDONE status=${child.status} signal=${child.signal}\n`,
		);
		assert.ifError(child.error);
		assert.equal(child.status, 0, child.stderr);
		for (const [path, hash] of Object.entries(closure))
			assert.equal(digest(readFileSync(path)), hash, `source changed: ${path}`);
		writeFileSync(
			join(output, `process-${index}.bindings.json`),
			JSON.stringify(
				{
					closure,
					bundleDigest: digest(readFileSync(bundle)),
					reportDigest: digest(readFileSync(resultPath)),
					unchanged: true,
				},
				null,
				2,
			),
		);
		console.log(
			`DONE diagnostic process ${index}: ${config.baseline} ${config.backgrounds.join(",")}`,
		);
	}
} finally {
	rmSync(temp, { recursive: true, force: true });
}
