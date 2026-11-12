/** Finite private before/after cold-construction comparison; never a formal Causal matrix retry. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { build } from "esbuild";

const root = process.cwd();
const out = path.resolve(process.argv[2] ?? "archive/evals/library-registration-v1/cold");
assert.equal(existsSync(out), false, "fresh diagnostic output required");
mkdirSync(out, { recursive: true });
const baseline = "8e13d831";
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sources = new Map();
const bindings = {};
const variants = {};
for (const revision of ["before", "after"]) {
	const built = await build({
		absWorkingDir: root,
		stdin: {
			contents: 'export { graphArm } from "./scripts/fixtures/spending-preset-performance.ts";',
			resolveDir: root,
			loader: "ts",
		},
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
		metafile: true,
		plugins:
			revision === "before"
				? [
						{
							name: "frozen-baseline",
							setup(b) {
								b.onLoad({ filter: /\.ts$/ }, async (args) => {
									const file = path.relative(root, args.path);
									if (!file.startsWith("packages/ts/src/")) return;
									const text = execFileSync("git", ["show", `${baseline}:${file}`], {
										encoding: "utf8",
									});
									sources.set(file, text);
									return { contents: text, loader: "ts" };
								});
							},
						},
					]
				: [],
	});
	const file = path.join(out, `${revision}.mjs`);
	writeFileSync(file, built.outputFiles[0].contents);
	variants[revision] = await import(`file://${file}`);
	bindings[revision] = {
		bundleDigest: sha(built.outputFiles[0].contents),
		sources: Object.keys(built.metafile.inputs)
			.filter((f) => !f.startsWith("<"))
			.sort()
			.map((file) => ({
				file,
				digest: sha(
					revision === "before" && sources.has(file) ? sources.get(file) : readFileSync(file),
				),
			})),
	};
}
const preflight = [];
for (const mode of ["off", "summary"])
	for (const arm of ["candidate", "reference"]) {
		const shapes = [];
		for (const revision of ["before", "after"]) {
			const run = variants[revision].graphArm(arm, mode);
			try {
				const snap = run.graph.describe();
				shapes.push({
					nodes: snap.nodes.map((n) => ({ id: n.id, factory: n.factory })),
					edges: snap.edges,
				});
			} finally {
				run.cleanup();
			}
		}
		assert.deepEqual(shapes[0], shapes[1]);
		preflight.push({
			mode,
			arm,
			nodes: shapes[0].nodes.length,
			edges: shapes[0].edges.length,
			topologyDigest: sha(JSON.stringify(shapes[0])),
		});
	}
const samples = [];
const summaries = [];
const warmup = 100,
	measured = 300;
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
for (const mode of ["off", "summary"])
	for (const arm of ["candidate", "reference"])
		for (let pass = 0; pass < 2; pass++) {
			const order = pass === 0 ? ["before", "after"] : ["after", "before"];
			for (const revision of order) {
				const rows = [];
				for (let i = -warmup; i < measured; i++) {
					const start = performance.now();
					const run = variants[revision].graphArm(arm, mode);
					const micros = (performance.now() - start) * 1000;
					run.cleanup(); // outside clock; no effects/provider calls
					const row = { mode, arm, pass, revision, index: i, warmup: i < 0, micros };
					samples.push(row);
					if (i >= 0) rows.push(micros);
				}
				summaries.push({
					mode,
					arm,
					pass,
					revision,
					p50: quantile(rows, 0.5),
					p95: quantile(rows, 0.95),
				});
			}
		}
const contrasts = [];
for (const mode of ["off", "summary"])
	for (const arm of ["candidate", "reference"])
		for (let pass = 0; pass < 2; pass++) {
			const rows = summaries.filter((r) => r.mode === mode && r.arm === arm && r.pass === pass);
			const before = rows.find((r) => r.revision === "before"),
				after = rows.find((r) => r.revision === "after");
			contrasts.push({
				mode,
				arm,
				pass,
				p50AfterOverBefore: after.p50 / before.p50,
				p95AfterOverBefore: after.p95 / before.p95,
			});
		}
const report = {
	kind: "finite private diagnostic; not formal qualification or retry",
	baseline,
	node: process.version,
	recipe: {
		warmup,
		measured,
		passes: ["before-after", "after-before"],
		clock: "whole graphArm construction/startup; cleanup outside clock",
		filtering: "none; all measured and warmup samples retained",
		scope:
			"same changed substrate applied to candidate and reference; no scenario input/effect executed",
	},
	preflight,
	bindings,
	summaries,
	contrasts,
	samples,
};
writeFileSync(path.join(out, "results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ preflight, contrasts, samples: samples.length }, null, 2));
