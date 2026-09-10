/** D162 isolated runtime, structural and error-contract mutation qualification. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputArg = process.argv.indexOf("--output");
if (outputArg >= 0 && !process.argv[outputArg + 1]) throw new TypeError("--output requires a path");
const reportPath =
	outputArg < 0
		? join(root, "packages/ts/qualification/causal-occurrence/cold-v1-assembly-mutations.json")
		: resolve(process.argv[outputArg + 1]);
const src = join(root, "packages/ts/src");
const temp = mkdtempSync(join(tmpdir(), "causal-construction-mutations-"));
cpSync(src, join(temp, "src"), { recursive: true });
symlinkSync(join(root, "node_modules"), join(temp, "node_modules"), "dir");
writeFileSync(join(temp, "package.json"), '{"type":"module"}\n');
const config = join(temp, "vitest.config.mts");
writeFileSync(
	config,
	`export default {define:{__GRAPHREFLY_TS_PACKAGE_REVISION__:'"graphrefly-ts:0.9.0"'},test:{include:['src/__tests__/graph-construction.d161.test.ts','src/__tests__/graph-construction-incoming.d161.test.ts','src/__tests__/causal-cold-assembly.d162.test.ts']}};`,
);
const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const originals = new Map();
const replace = (name, from, to) => {
	const path = join(temp, "src", name);
	if (!originals.has(name)) originals.set(name, readFileSync(join(src, name), "utf8"));
	const text = readFileSync(path, "utf8");
	const escaped = from
		.trim()
		.split(/\s+/u)
		.map((s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
		.join("\\s+");
	const pattern = new RegExp(escaped, "gu");
	assert.equal([...text.matchAll(pattern)].length, 1, `mutation anchor: ${name}: ${from}`);
	writeFileSync(
		path,
		text.replace(pattern, () => to),
	);
};
const node = "node/node.ts",
	life = "node/node-lifecycle-runtime.ts",
	scope = "graph/construction-scope.ts";
const builder = "solutions/causal-occurrence/construction.ts";
const mutants = [
	[
		"cold-context-graph",
		[[scope, "graphRegistrations.get(graph) !== this.registrar ||", "false ||"]],
	],
	[
		"cold-context-startup",
		[
			[
				scope,
				"startup !== this.startupNode || epoch !== this.manifest.epoch",
				"false || epoch !== this.manifest.epoch",
			],
		],
	],
	["cold-context-epoch", [[scope, "epoch !== this.manifest.epoch", "false"]]],
	[
		"cold-context-phase",
		[
			[
				scope,
				'this.phase !== "cold" || graphRegistrations.get(graph)',
				"false || graphRegistrations.get(graph)",
			],
		],
	],
	[
		"cold-binding-before-snapshot",
		[
			[
				builder,
				"binding = causalBinding(binding); graph.assertContext(ownerGraph, startup, binding.epoch);",
				"graph.assertContext(ownerGraph, startup, binding.epoch); binding = causalBinding(binding);",
			],
		],
	],
	[
		"cold-incomplete-union",
		[[scope, 'this.phase !== "cold" || this.available.size !== 0', 'this.phase !== "cold"']],
	],
	[
		"cold-lost-release-root",
		[[builder, "roots: Object.freeze([releaseController])", "roots: Object.freeze([])"]],
	],
	[
		"cold-premature-retain",
		[
			[
				builder,
				"Object.freeze(result);",
				"Object.freeze(result); ownerGraph.retain(releaseController);",
			],
		],
	],
	[
		"cold-lost-final-cleanup",
		[
			[
				scope,
				"const registered = this.acquisitions.filter((a) => a.registered).map((a) => a.node!);",
				'const registered = this.acquisitions.filter((a) => a.registered && !a.name.endsWith("/final")).map((a) => a.node!);',
			],
		],
	],
	[
		"cold-faulted-owner-loss",
		[
			[
				scope,
				'owner.phase = "faulted";',
				'owner.phase = "faulted"; graphRegistrations.get(graph)!.constructions.delete(owner.instance);',
			],
		],
	],
	[
		"cold-real-input-cut",
		[[builder, "return graph.node<Arrival<T>>( [input],", "return graph.node<Arrival<T>>( [],"]],
	],
];
const topologyBypass = [
	builder,
	"assertCausalOccurrenceTopology(graph.readIncoming(), opts.name);",
	"void 0;",
];
const runtimeTest = "builds real upstream and downstream nodes cold";
// The isolated probe asserts post-start business output before the ordinary fn-count assertion.
// The unchanged topology-bypass control runs the identical probe first.
const runtimeProbe = [
	"__tests__/causal-cold-assembly.d162.test.ts",
	"expect(f.calls()).toBeGreaterThan(0);",
	'expect(owner.phase).toBe("started"); expect(f.final.cache, "runtime business output missing").toEqual([f.occurrence, "value-5".length]); expect(f.calls()).toBeGreaterThan(0);',
];
const dependencyCuts = [
	[
		"input",
		[builder, "return graph.node<Arrival<T>>( [input],", "return graph.node<Arrival<T>>( [],"],
	],
	[
		"authority",
		[
			builder,
			"const authority = graph.node<AuthorityEmission<T>>( [arrivals],",
			"const authority = graph.node<AuthorityEmission<T>>( [],",
		],
	],
	["projection", [builder, "return graph.node( [authority],", "return graph.node( [],"]],
];
for (const [edge, patch] of dependencyCuts) {
	if (edge !== "input")
		mutants.push([`cold-${edge}-edge-structural`, [patch], runtimeTest, "structural-rejection"]);
	mutants.push([
		`cold-${edge}-edge-runtime`,
		[patch, topologyBypass, runtimeProbe],
		runtimeTest,
		"runtime-dependency-loss",
	]);
}
const report = {
	schema: "graphrefly-ts/causal-cold-assembly-mutations/v1",
	revision: "cold-v1",
	runnerDigest: digest(readFileSync(fileURLToPath(import.meta.url))),
	testDigest: digest(readFileSync(join(src, "__tests__/graph-construction.d161.test.ts"))),
	incomingTestDigest: digest(
		readFileSync(join(src, "__tests__/graph-construction-incoming.d161.test.ts")),
	),
	assemblyTestDigest: digest(
		readFileSync(join(src, "__tests__/causal-cold-assembly.d162.test.ts")),
	),
	baseline: null,
	mutations: [],
	complete: false,
};
function run(id, mutation, testName, detection = "assertion-detection") {
	for (const [name, text] of originals) writeFileSync(join(temp, "src", name), text);
	for (const args of mutation ?? []) replace(...args);
	// Compilation/import resolution failure cannot count as a behavioral kill.
	const compiled = buildSync({
		stdin: {
			contents: `export { Graph } from '${temp}/src/graph/graph.ts'; export * from '${temp}/src/solutions/causal-occurrence.ts';`,
			resolveDir: root,
			loader: "ts",
		},
		outfile: join(temp, "runtime.mjs"),
		bundle: true,
		format: "esm",
		platform: "node",
		metafile: true,
		define: { __GRAPHREFLY_TS_PACKAGE_REVISION__: '"graphrefly-ts:0.9.0"' },
	});
	const resultPath = join(temp, "result.json");
	rmSync(resultPath, { force: true });
	const child = spawnSync(
		process.execPath,
		[
			join(root, "node_modules/vitest/vitest.mjs"),
			"run",
			"--root",
			temp,
			"--config",
			config,
			"--reporter=json",
			`--outputFile=${resultPath}`,
			...(testName ? ["--testNamePattern", testName] : []),
		],
		{ cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
	);
	assert.ifError(child.error);
	assert.equal(child.signal, null);
	assert.ok(existsSync(resultPath), child.stdout + child.stderr);
	const result = JSON.parse(readFileSync(resultPath, "utf8"));
	assert.equal(result.numRuntimeErrorTestSuites ?? 0, 0, id);
	assert.equal((result.unhandledErrors ?? []).length, 0, id);
	const assertions = result.testResults.flatMap((r) => r.assertionResults);
	const failed = assertions.filter((r) => r.status === "failed");
	const assertionFailures = failed.filter((r) =>
		/AssertionError/u.test(r.failureMessages.join("\n")),
	);
	assert.ok(
		assertions.filter((r) => ["passed", "failed"].includes(r.status)).length >= (testName ? 1 : 20),
		id,
	);
	if (!mutation) assert.equal(child.status, 0, child.stdout + child.stderr);
	else assert.ok(child.status === 0 || child.status === 1, id);
	return {
		id,
		compiled: true,
		outcome: !mutation ? "passed" : failed.length > 0 ? "detected" : "survived",
		detection: !mutation ? "baseline" : detection,
		assertionFailureCount: assertionFailures.length,
		selectedTest: testName ?? "all three qualification files",
		// Structural throws and error wording do not prove a business behavior changed.
		runtimeBehaviorDetected:
			detection === "runtime-dependency-loss" &&
			assertionFailures.some((r) =>
				r.failureMessages.join("\n").includes("runtime business output missing"),
			),
		failed: failed.map((r) => ({ test: r.fullName, message: r.failureMessages.join("\n") })),
		patches: mutation ?? [],
		closure: Object.fromEntries(
			Object.keys(compiled.metafile.inputs)
				.filter((p) => p !== "<stdin>")
				.map((p) => [
					`packages/ts/src/${p.split("/src/")[1]}`,
					digest(readFileSync(resolve(root, p))),
				]),
		),
	};
}
try {
	report.baseline = run("unchanged");
	console.log("unchanged: passed");
	report.topologyBypassControl = run(
		"topology-bypass-control",
		[topologyBypass, runtimeProbe],
		runtimeTest,
		"control",
	);
	assert.equal(report.topologyBypassControl.outcome, "survived");
	for (const [id, mutation, testName, category] of mutants) {
		const detection =
			category ??
			(id === "cold-context-phase"
				? "error-contract-only"
				: id === "cold-real-input-cut"
					? "structural-rejection-and-error-contract"
					: "assertion-detection");
		const result = run(id, mutation, testName, detection);
		report.mutations.push(result);
		if (detection === "assertion-detection") assert.ok(result.assertionFailureCount > 0, id);
		if (detection === "runtime-dependency-loss") assert.ok(result.runtimeBehaviorDetected, id);
		console.log(`${id}: ${result.outcome}`);
	}
	report.complete = report.mutations.every((r) => r.outcome === "detected");
} finally {
	for (const [name, text] of originals)
		assert.equal(
			readFileSync(join(src, name), "utf8"),
			text,
			"checkout changed during mutation qualification",
		);
	rmSync(temp, { recursive: true, force: true });
	report.cleanup = { temporaryRemoved: !existsSync(temp), childrenExited: true };
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
assert.ok(
	report.complete,
	"construction mutant survived; inspect the oracle or report the residual",
);
console.log(`QUALIFICATION_DONE complete=${report.complete} mutations=${report.mutations.length}`);
