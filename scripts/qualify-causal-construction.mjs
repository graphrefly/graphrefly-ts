/** D161 actual-runtime mutation qualification in an isolated source copy. */
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
		? join(root, "packages/ts/qualification/causal-occurrence/ts-v5-construction-mutations.json")
		: resolve(process.argv[outputArg + 1]);
const src = join(root, "packages/ts/src");
const temp = mkdtempSync(join(tmpdir(), "causal-construction-mutations-"));
cpSync(src, join(temp, "src"), { recursive: true });
symlinkSync(join(root, "node_modules"), join(temp, "node_modules"), "dir");
writeFileSync(join(temp, "package.json"), '{"type":"module"}\n');
const config = join(temp, "vitest.config.mts");
writeFileSync(
	config,
	`export default {define:{__GRAPHREFLY_TS_PACKAGE_REVISION__:'"graphrefly-ts:0.9.0"'},test:{include:['src/__tests__/graph-construction.d161.test.ts','src/__tests__/graph-construction-incoming.d161.test.ts']}};`,
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
const mutants = [
	[
		"b1-stale-deps",
		[
			[
				"graph/graph.ts",
				"const liveIds = entry.node.deps.map(localId); if (incoming === undefined)",
				"const liveIds = entry.deps.map(localId); if (incoming === undefined)",
			],
		],
	],
	[
		"b1-skip-unrelated-discovery",
		[
			[
				"graph/graph.ts",
				"const liveIds = entry.node.deps.map(localId); if (incoming === undefined)",
				"if (incoming && !incoming.has(entry.node)) continue; const liveIds = entry.node.deps.map(localId); if (incoming === undefined)",
			],
		],
	],
	[
		"b1-bypass-override",
		[
			[
				"graph/graph.ts",
				'describe === nativeDescribe ? this._describe("", nodes) : Reflect.apply(describe, this, [])',
				'this._describe("", nodes)',
			],
		],
	],
	[
		"b1-skip-mount-read",
		[
			[
				"graph/graph.ts",
				"if (this._mounts.length > 0) { snap.subgraphs = this._mounts.map",
				"if (incoming === undefined && this._mounts.length > 0) { snap.subgraphs = this._mounts.map",
			],
		],
	],
	[
		"b1-include-unowned-targets",
		[["graph/graph.ts", "if (incoming === undefined || incoming.has(entry.node))", "if (true)"]],
	],
	[
		"b1-drop-transitive-discovery",
		[
			[
				"graph/graph.ts",
				"// discovered node emitted once (stable ids via _synthIds).\nconst visited = new Set<Node<unknown>>(); const queue: Node<unknown>[] = [...discovered.keys()];",
				"// discovered node emitted once (stable ids via _synthIds).\nconst visited = new Set<Node<unknown>>(); const queue: Node<unknown>[] = incoming ? [] : [...discovered.keys()];",
			],
		],
	],
	[
		"b1-late-parent-capture",
		[
			[
				"graph/graph.ts",
				"return snap;",
				"if (incoming) { snap.edges = [...this._entries.values()].filter(e => incoming.has(e.node)).flatMap(e => e.node.deps.map(d => ({from: this._idForTopologyNode(d), to: e.id}))); } return snap;",
			],
		],
	],
	[
		"b1-bypass-real-topology-check",
		[
			[
				"solutions/causal-occurrence/construction.ts",
				"assertCausalOccurrenceTopology(graph.readIncoming(), opts.name);",
				"void graph.readIncoming();",
			],
		],
	],
	["constructor-handle-loss", [[node, "acquisition.handle = handle;", "void handle;"]]],
	["constructor-slot-loss", [[node, "acquisition.slot = created.id;", "void created.id;"]]],
	["root-lease-after-return", [[node, "acquisition?.record(unsubscribe);", "void acquisition;"]]],
	["dependency-lease-loss", [[life, "self._dep.unsubs[idx0] = release;", "void release;"]]],
	[
		"wrong-graph-preflight",
		[
			[
				scope,
				'registrar.assertRegisteredNode(node, "construction input/dependency");',
				"void node;",
			],
		],
	],
	["retired-name-preflight", [[scope, "registrar.assertAvailableName(name);", "void name;"]]],
	["construction-during-wave", [[scope, "if (isWaveActive() || currentBatch())", "if (false)"]]],
	["false-started-after-fault", [[scope, 'owner.phase = "faulted";', 'owner.phase = "started";']]],
	["startup-fact-forges-success", [[scope, "state: owner.phase,", 'state: "started",']]],
	[
		"started-delivery-rewrites-history",
		[
			[
				scope,
				"owner.deliveryError = error;",
				'owner.deliveryError = error; owner.phase = "faulted";',
			],
		],
	],
	["automatic-start-replay", [[scope, 'owner.phase !== "owned"', "false"]]],
	[
		"owner-missing-at-first-run",
		[
			[scope, "this.registrar.constructions.set(owner.instance, owner);", "void owner;"],
			[
				scope,
				"lifecycleRegistrars.get(graph)?.constructions.get(owner.instance) !== owner ||",
				"false ||",
			],
		],
	],
	[
		"cleanup-loses-secondary-handles",
		[[scope, "errors.push(...detailed);", "errors.push(...detailed.slice(0, 1));"]],
	],
	[
		"cleanup-forgets-slot-failure",
		[
			[
				life,
				'releaseErrors.push({ resource: "slot", cause, core: self._core, slot: self._id });',
				"void cause;",
			],
		],
	],
	[
		"retained-owner-dropped-on-unrelated-release",
		[
			[
				"graph/graph.ts",
				"isNodeRuntimeReleased(node) && !runtimeReleaseFailures.has(node)",
				"isNodeRuntimeReleased(node)",
			],
		],
	],
	[
		"exact-capability-epoch-removed",
		[
			[
				"solutions/causal-occurrence/capabilities.ts",
				"root.binding.epoch !== binding.epoch",
				"false",
			],
		],
	],
	[
		"narrow-view-leaks-retained-field",
		[
			[
				"solutions/causal-occurrence/capabilities.ts",
				"lifecycle: value.lifecycle,",
				"lifecycle: value.lifecycle, retainedEvidence: value.retainedEvidence,",
			],
		],
	],
];
const report = {
	schema: "graphrefly-ts/causal-construction-mutations/v1",
	revision: "construction-v1",
	runnerDigest: digest(readFileSync(fileURLToPath(import.meta.url))),
	testDigest: digest(readFileSync(join(src, "__tests__/graph-construction.d161.test.ts"))),
	incomingTestDigest: digest(
		readFileSync(join(src, "__tests__/graph-construction-incoming.d161.test.ts")),
	),
	baseline: null,
	mutations: [],
	complete: false,
};
function run(id, mutation) {
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
	const behavioral = failed.filter((r) => /AssertionError/u.test(r.failureMessages.join("\n")));
	assert.ok(assertions.filter((r) => ["passed", "failed"].includes(r.status)).length >= 20, id);
	if (!mutation) assert.equal(child.status, 0, child.stdout + child.stderr);
	else assert.ok(child.status === 0 || child.status === 1, id);
	return {
		id,
		compiled: true,
		outcome: !mutation ? "passed" : behavioral.length > 0 ? "killed" : "survived",
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
	for (const [id, mutation] of mutants) {
		const result = run(id, mutation);
		report.mutations.push(result);
		console.log(`${id}: ${result.outcome}`);
	}
	report.complete = report.mutations.every((r) => r.outcome === "killed");
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
