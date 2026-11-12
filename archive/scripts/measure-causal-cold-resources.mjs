/** Descriptive resource measurements of the actual D162 combined qualification caller. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputArg = process.argv.indexOf("--output");
assert.ok(outputArg >= 0 && process.argv[outputArg + 1], "--output required");
const output = resolve(process.argv[outputArg + 1]);
const src = join(root, "packages/ts/src");
const testPath = join(src, "__tests__/causal-cold-assembly.d162.test.ts");
const source = readFileSync(testPath, "utf8");
let fixture = source.slice(source.indexOf("import { depLatest"), source.indexOf('describe("D162'));
fixture =
	fixture.slice(0, fixture.indexOf("afterEach(() =>")) +
	fixture.slice(fixture.indexOf("function trackedGraph"));
fixture = fixture.replaceAll('from "../', `from "${src}/`);
const temp = mkdtempSync(join(tmpdir(), "cold-resources-"));
const resultPath = join(temp, "result.json");
const digest = (data) => `sha256:${createHash("sha256").update(data).digest("hex")}`;
const runner = `import assert from 'node:assert/strict'; import {writeFileSync} from 'node:fs'; import {performance} from 'node:perf_hooks';
${fixture}
const rows=[];
for(let i=0;i<12;i++){
 global.gc(); const heapBefore=process.memoryUsage().heapUsed; const t=performance.now();
 const f=combined(); const coldNs=(performance.now()-t)*1e6;
 assert.equal(f.calls(),0); assert.equal(subscriberCountOfNode(f.a),0);
 const nodes=f.graph.describe().nodes;
 const edges=nodes.reduce((n,x)=>n+x.deps.length,0);
 global.gc(); const coldHeap=process.memoryUsage().heapUsed;
 const ts=performance.now(); const owner=own(f); startConstruction(f.graph,owner); const startNs=(performance.now()-ts)*1e6;
 assert.equal(owner.phase,'started'); assert.deepEqual(f.final.cache,[f.occurrence,7]);
 global.gc(); const activeHeap=process.memoryUsage().heapUsed;
 rows.push({sample:i,coldConstructionNs:coldNs,sealTransferStartNs:startNs,ownedNodes:owner.nodes.length,totalNodes:nodes.length,totalEdges:edges,ownedRoots:owner.roots.length,liveRootLeases:owner.roots.filter(x=>x.unsubscribe).length,liveDispatcherHandles:f.dispatcher.live.size,externalDispatcherHandles:f.handlesBefore,coldRetainedHeapDeltaBytes:coldHeap-heapBefore,activeRetainedHeapDeltaBytes:activeHeap-heapBefore});
 for(const lease of owner.roots)lease.unsubscribe?.(); const group=f.graph.topologyGroup(); for(const n of nodes)group.add(f.graph.find(n.id)); group.release();
 assert.equal(f.graph.describe().nodes.length,0); assert.equal(f.dispatcher.live.size,0); graphs.length=0; dispatchers.clear();
}
writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({rows,cleanup:{nodes:0,dispatcherHandles:0}},null,2));`;
try {
	const runtimePath = join(temp, "measure.mjs");
	const compiled = buildSync({
		stdin: { contents: runner, loader: "ts", resolveDir: root },
		outfile: runtimePath,
		bundle: true,
		format: "esm",
		platform: "node",
		metafile: true,
		define: { __GRAPHREFLY_TS_PACKAGE_REVISION__: '"graphrefly-ts:0.9.0"' },
	});
	const child = spawnSync(process.execPath, ["--expose-gc", runtimePath], {
		encoding: "utf8",
		timeout: 60000,
	});
	assert.ifError(child.error);
	assert.equal(child.status, 0, child.stdout + child.stderr);
	const result = JSON.parse(readFileSync(resultPath, "utf8"));
	const report = {
		schema: "graphrefly-ts/causal-cold-resources/v1",
		revision: "cold-v1",
		runnerDigest: digest(readFileSync(fileURLToPath(import.meta.url))),
		fixtureDigest: digest(source),
		compiledProbeDigest: digest(runner),
		closure: Object.fromEntries(
			Object.keys(compiled.metafile.inputs)
				.filter((p) => p !== "<stdin>")
				.map((p) => [p, digest(readFileSync(resolve(root, p)))]),
		),
		meaning:
			"12 descriptive repetitions of the actual test caller, including external fixture setup. Retained heap deltas are process-level GC observations, not precise owner allocation or a comparative performance budget; all samples retained.",
		...result,
	};
	writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
	console.log("COLD_RESOURCES_DONE samples=12");
} finally {
	rmSync(temp, { recursive: true, force: true });
}
