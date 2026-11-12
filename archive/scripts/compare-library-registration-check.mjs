/** Finite D167 single-read comparison. No formal matrix dispatch or qualification claim. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = process.cwd();
const out = path.resolve(
	process.argv[2] ?? "archive/evals/library-registration-check-v1/performance",
);
const baseline = "194e72eefefb4b8e0d58573e1a5386eeb17987e5";
const worker = "scripts/diagnose-library-registration-cost.mjs";
const sha = (b) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
const cells = [
	["off", "candidate"],
	["off", "reference"],
	["summary", "candidate"],
	["summary", "reference"],
];
const variants = ["before", "current", "current-copy"];
const recipe = {
	warmup: 100,
	measured: 300,
	rounds: 4,
	cells,
	variants,
	clock:
		"whole graphArm construction/startup, cleanup outside clock; no scenario inputs or external effects",
	order:
		"fresh process per variant/round, four cells rotated by round, forward/reverse variant order",
	filtering: "none; warmup and measured retained; no retry",
	worker,
	workerDigest: sha(readFileSync(worker)),
	note: "Existing frozen diagnostic --worker only; its ablations/main/old baseline are never invoked. Timing waits for all heavy offline checks to finish.",
};
assert.equal(existsSync(out), false, "fresh output directory required");
mkdirSync(out, { recursive: true });
const write = (f, x) => writeFileSync(path.join(out, f), JSON.stringify(x, null, 2) + "\n");
write("plan.json", {
	baseline,
	recipe,
	node: process.version,
	startedAt: new Date().toISOString(),
	approval:
		"User 好的，继续 after reviewed single-read implementation/validation scope at 6d818419",
	scriptDigest: sha(readFileSync(new URL(import.meta.url))),
});
const bindings = {},
	modules = {};
for (const variant of ["before", "current"]) {
	const sources = {};
	const built = await build({
		absWorkingDir: root,
		stdin: {
			contents:
				'export { graphArm } from "./scripts/fixtures/spending-preset-performance.ts"; export { Graph, assertGraphLocalNode } from "./packages/ts/src/graph/graph.ts";',
			resolveDir: root,
			loader: "ts",
		},
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
		plugins: [
			{
				name: "bound-source",
				setup(b) {
					b.onLoad({ filter: /\.ts$/ }, (args) => {
						const file = path.relative(root, args.path);
						const source =
							variant === "before" && file.startsWith("packages/ts/src/")
								? execFileSync("git", ["show", `${baseline}:${file}`], { encoding: "utf8" })
								: readFileSync(args.path, "utf8");
						sources[file] = sha(source);
						return { contents: source, loader: "ts" };
					});
				},
			},
		],
	});
	const bytes = built.outputFiles[0].contents;
	writeFileSync(path.join(out, `${variant}.mjs`), bytes);
	bindings[variant] = { bundleDigest: sha(bytes), sources };
	modules[variant] = await import(pathToFileURL(path.join(out, `${variant}.mjs`)));
}
writeFileSync(path.join(out, "current-copy.mjs"), readFileSync(path.join(out, "current.mjs")));
bindings["current-copy"] = bindings.current;
modules["current-copy"] = await import(pathToFileURL(path.join(out, "current-copy.mjs")));
write("bindings.json", bindings);
const preflight = [];
for (const [mode, arm] of cells) {
	let expected;
	for (const variant of variants) {
		const run = modules[variant].graphArm(arm, mode);
		try {
			const snapshot = run.graph.describe();
			const observed = {
				nodes: snapshot.nodes.map((n) => ({ id: n.id, factory: n.factory })),
				edges: snapshot.edges,
				latest: run.latest,
				counts: run.counts,
				state: run.state(),
			};
			if (expected === undefined) expected = observed;
			else assert.deepEqual(observed, expected);
			preflight.push({
				variant,
				mode,
				arm,
				digest: sha(JSON.stringify(observed)),
				nodes: snapshot.nodes.length,
				edges: snapshot.edges.length,
			});
		} finally {
			run.cleanup();
		}
	}
}
// Counts are outside timing and run the real public Graph guard; no source instrumentation.
const lookupTrace = [];
for (const variant of ["before", "current"]) {
	const { Graph, assertGraphLocalNode } = modules[variant];
	const g = new Graph();
	const n = g.state(1, { name: "input" });
	const original = WeakMap.prototype.get;
	let lookups = 0;
	WeakMap.prototype.get = function (key) {
		if (key === n) lookups++;
		return original.call(this, key);
	};
	try {
		assertGraphLocalNode(g, n, "input");
	} finally {
		WeakMap.prototype.get = original;
	}
	assert.equal(lookups, variant === "before" ? 2 : 1);
	lookupTrace.push({
		variant,
		node: "input",
		lookups,
		guard: "assertGraphLocalNode",
		scope: "same-owner live node, no callback, no timing",
	});
	const group = g.topologyGroup();
	group.add(n);
	group.release();
}
write("preflight.json", { preflight, lookupTrace });
for (let round = 0; round < recipe.rounds; round++) {
	for (const variant of round % 2 ? [...variants].reverse() : variants) {
		execFileSync(process.execPath, [worker, "--worker", out, variant, String(round)], {
			timeout: 120000,
			stdio: "pipe",
		});
		console.log(`DONE ${variant}/${round}`);
	}
}
const summaries = [];
const q = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
for (const variant of variants)
	for (let round = 0; round < recipe.rounds; round++) {
		const samples = JSON.parse(readFileSync(path.join(out, `${variant}-${round}.json`), "utf8"));
		assert.equal(samples.length, 1600);
		for (const [mode, arm] of cells) {
			const rows = samples.filter((s) => !s.warmup && s.mode === mode && s.arm === arm);
			assert.equal(rows.length, recipe.measured);
			summaries.push({
				variant,
				round,
				mode,
				arm,
				p50: q(
					rows.map((s) => s.micros),
					0.5,
				),
				p95: q(
					rows.map((s) => s.micros),
					0.95,
				),
			});
		}
	}
const contrasts = [];
for (const [mode, arm] of cells)
	for (let round = 0; round < recipe.rounds; round++) {
		const get = (v) =>
			summaries.find(
				(s) => s.mode === mode && s.arm === arm && s.round === round && s.variant === v,
			);
		for (const [numerator, denominator] of [
			["current", "before"],
			["current-copy", "current"],
		]) {
			const n = get(numerator),
				d = get(denominator);
			contrasts.push({
				mode,
				arm,
				round,
				numerator,
				denominator,
				p50DeltaMicros: n.p50 - d.p50,
				p95DeltaMicros: n.p95 - d.p95,
				p50Ratio: n.p50 / d.p50,
				p95Ratio: n.p95 / d.p95,
			});
		}
	}
write("results.json", {
	baseline,
	recipe,
	preflight,
	lookupTrace,
	summaries,
	contrasts,
	samples: 19200,
	limitations: [
		"No formal qualification or retry",
		"Lookup count reduction is not a latency guarantee",
		"Identical-copy contrast retained to expose process/sample variability",
		"No steady-state, memory or human/agent-learning claim",
	],
});
console.log("DONE single-read comparison");
