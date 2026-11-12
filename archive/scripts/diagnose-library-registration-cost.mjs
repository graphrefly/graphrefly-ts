/** D167 private causal diagnostic. Ablations are deliberately unsafe, never product variants. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = process.cwd();
const baseline = "8e13d831a62bddc2b498a307c91e49e75fb310ab";
const current = "194e72eefefb4b8e0d58573e1a5386eeb17987e5";
const sha = (x) => `sha256:${createHash("sha256").update(x).digest("hex")}`;
const old = (file) => execFileSync("git", ["show", `${baseline}:${file}`], { encoding: "utf8" });
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
const cells = [
	["off", "candidate"],
	["off", "reference"],
	["summary", "candidate"],
	["summary", "reference"],
];
const variants = [
	"before",
	"current",
	"current-copy",
	"without-checks",
	"without-acquisition",
	"without-both",
];
const recipe = {
	kind: "finite private diagnostic; not formal qualification",
	warmup: 100,
	measured: 300,
	rounds: 4,
	variants,
	cells,
	process:
		"one fresh child per variant/round; four cells rotated by round; forward/reverse variant order",
	clock: "whole graphArm construction/startup; cleanup outside clock; no scenario inputs/effects",
	filtering: "none, including warmup; no automatic retries",
	interpretation:
		"unsafe ablations remove only D167 additions; remaining structural contrast includes common factory refactoring, not just registry representation",
	acquisitionFactor:
		"D167 ordinary-path acquisition plus constructor exception/control layout and early version validation; NOT isolated WeakMap or record-write cost. Original D161 supplied accounting retained.",
};

function replaceOnce(text, from, to) {
	assert.equal(text.split(from).length - 1, 1, `unique source anchor: ${from}`);
	return text.replace(from, to);
}

function transform(file, source, variant) {
	if (variant === "before") return source;
	const checks = variant === "without-checks" || variant === "without-both";
	const acquisition = variant === "without-acquisition" || variant === "without-both";
	if (file === "packages/ts/src/graph/graph.ts") {
		if (acquisition) {
			const start = source.indexOf("\t\tconst acquired = supplied ??");
			const end = source.indexOf("\n\tprivate _assertAvailableId", start);
			assert.ok(start > 0 && end > start);
			source =
				source.slice(0, start) +
				`
		// DIAGNOSTIC ONLY: D161 supplied records retained; D167 ordinary cleanup removed.
		if (supplied !== undefined) constructionAcquisitions.set(nodeOpts, supplied);
		const n = this._construct(() => create(nodeOpts, supplied!));
		this._addWithId(n, factory, deps, opts, name ?? \`\${factory}#\${this._seq++}\`, supplied);
		return n;
	}
` +
				source.slice(end);
		}
		if (checks) {
			source = replaceOnce(
				source,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: exact TypeScript source anchor
				"\t\tthis._assertDepsLocal(deps, `dep of '${opts.name ?? factory}'`);\n\t\tconst name = id ?? opts.name;\n\t\tif (name !== undefined) this._assertAvailableId(name);",
				"\t\tconst name = id ?? opts.name; // DIAGNOSTIC ONLY: no new prechecks",
			);
			source = replaceOnce(
				source,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: exact TypeScript source anchor
				"\t\tthis._assertDepsLocal(deps, `dep of '${id}'`);\n\t\tthis._assertAvailableId(id);\n\t\tthis._entries.set",
				"\t\t// DIAGNOSTIC ONLY: no final reentry protection\n\t\tthis._entries.set",
			);
		}
	}
	if (acquisition && file === "packages/ts/src/node/node.ts") {
		// Use the exact prior constructor, replacing only its six per-node access closures
		// with the current registration issuance. All non-constructor code stays current.
		const prior = old(file);
		const start = prior.indexOf("\tconstructor(\n");
		const end = prior.indexOf("\n\t/** R-pull (D55", start);
		let ctor = prior.slice(start, end);
		const accessStart = ctor.indexOf("\t\tcheckpointReaders.set(");
		const accessEnd = ctor.indexOf("\t\tNode._retainIndirectRuntimeMethods", accessStart);
		assert.ok(start > 0 && end > start && accessStart > 0 && accessEnd > accessStart);
		ctor =
			ctor.slice(0, accessStart) +
			"\t\tissueNodeRegistration(this as Node<unknown>);\n" +
			ctor.slice(accessEnd);
		const currentStart = source.indexOf("\tconstructor(\n");
		const currentEnd = source.indexOf("\n\t/** R-pull (D55", currentStart);
		assert.ok(currentStart > 0 && currentEnd > currentStart);
		source = source.slice(0, currentStart) + ctor + source.slice(currentEnd);
	}
	if (acquisition && file === "packages/ts/src/node/core.ts") {
		source = replaceOnce(
			source,
			"\t\tif (acquisition !== undefined) {\n\t\t\tacquisition.core = this;\n\t\t\tacquisition.slot = id;\n\t\t}",
			"\t\t// DIAGNOSTIC ONLY: original D161 records after createSlot returns.",
		);
	}
	return source;
}

function instrumentFixture(source) {
	const markers = [
		["\tconst names =\n", "graph-and-inputs"],
		["\tlet view: Record", "prepare-scope"],
		["\tconst owner = scope.seal", "build-consumer"],
		["\tstartConstruction(graph, owner);", "seal-and-transfer"],
		["\tconst latest: Record", "startup"],
		["\treturn {\n\t\tgraph,", "connect"],
	];
	source = replaceOnce(
		source,
		'export function graphArm(arm: Exclude<Arm, "plain">, mode: Mode) {',
		'export function graphArm(arm: Exclude<Arm, "plain">, mode: Mode) {\nconst diagnosticPhases: Record<string, number> = {}; let diagnosticTime = performance.now(); const diagnosticMark = (name: string) => { const now = performance.now(); diagnosticPhases[name] = (now - diagnosticTime) * 1000; diagnosticTime = performance.now(); };',
	);
	for (const [marker, phase] of markers)
		source = replaceOnce(source, marker, `diagnosticMark(${JSON.stringify(phase)});\n${marker}`);
	return replaceOnce(
		source,
		"\treturn {\n\t\tgraph,",
		"\treturn {\n\t\tdiagnosticPhases,\n\t\tgraph,",
	);
}

function snapshot(run) {
	const snap = run.graph.describe();
	return {
		nodes: snap.nodes.map((n) => ({ id: n.id, factory: n.factory })),
		edges: snap.edges,
		latest: run.latest,
		counts: run.counts,
		state: run.state(),
	};
}

async function worker(out, variant, round) {
	const { graphArm } = await import(pathToFileURL(path.join(out, `${variant}.mjs`)));
	const samples = [];
	const order = [...cells.slice(round), ...cells.slice(0, round)];
	for (const [mode, arm] of order) {
		for (let index = -recipe.warmup; index < recipe.measured; index++) {
			const start = performance.now();
			const run = graphArm(arm, mode);
			const micros = (performance.now() - start) * 1000;
			run.cleanup();
			samples.push({
				variant,
				round,
				mode,
				arm,
				index,
				warmup: index < 0,
				micros,
				...(run.diagnosticPhases ? { phases: run.diagnosticPhases } : {}),
			});
		}
	}
	writeFileSync(path.join(out, `${variant}-${round}.json`), JSON.stringify(samples));
}

async function main(out) {
	assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), current);
	assert.equal(
		execFileSync("git", ["diff", "HEAD", "--", "packages/ts/src", "scripts/fixtures"], {
			encoding: "utf8",
		}),
		"",
	);
	assert.equal(existsSync(out), false, "fresh output directory required");
	mkdirSync(out, { recursive: true });
	const write = (file, value) =>
		writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + "\n");
	write("plan.json", {
		baseline,
		current,
		recipe,
		node: process.version,
		machine: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
		authorization:
			"User: 好的,你继续; continuation of proposed isolated cost attribution, no production optimization or formal matrix retry",
		startedAt: new Date().toISOString(),
		scriptDigest: sha(readFileSync(fileURLToPath(import.meta.url))),
	});
	const bindings = {};
	for (const variant of [
		...variants.filter((v) => v !== "current-copy"),
		"before-phases",
		"current-phases",
	]) {
		const revision = variant.replace("-phases", "");
		const inputDigests = {};
		const changes = [];
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
			plugins: [
				{
					name: "isolated-diagnostic",
					setup(b) {
						b.onLoad({ filter: /\.ts$/ }, (args) => {
							const file = path.relative(root, args.path);
							const original =
								revision === "before" && file.startsWith("packages/ts/src/")
									? old(file)
									: readFileSync(args.path, "utf8");
							let text = transform(file, original, revision);
							if (
								variant.endsWith("-phases") &&
								file === "scripts/fixtures/spending-preset-performance.ts"
							)
								text = instrumentFixture(text);
							inputDigests[file] = { original: sha(original), effective: sha(text) };
							if (text !== original) {
								const locator = `source/${variant}/${file}`;
								mkdirSync(path.dirname(path.join(out, locator)), { recursive: true });
								writeFileSync(path.join(out, locator), text);
								changes.push(locator);
							}
							return { contents: text, loader: "ts" };
						});
					},
				},
			],
		});
		writeFileSync(path.join(out, `${variant}.mjs`), built.outputFiles[0].contents);
		bindings[variant] = { bundle: sha(built.outputFiles[0].contents), inputDigests, changes };
	}
	writeFileSync(path.join(out, "current-copy.mjs"), readFileSync(path.join(out, "current.mjs")));
	bindings["current-copy"] = bindings.current;
	write("bindings.json", bindings);
	const preflight = [];
	for (const [mode, arm] of cells) {
		let expected;
		for (const variant of [...variants, "before-phases", "current-phases"]) {
			const { graphArm } = await import(pathToFileURL(path.join(out, `${variant}.mjs`)));
			const run = graphArm(arm, mode);
			try {
				const observed = snapshot(run);
				if (expected === undefined) expected = observed;
				else
					assert.deepEqual(
						observed,
						expected,
						`${variant}/${mode}/${arm}: topology and startup behavior`,
					);
				preflight.push({
					mode,
					arm,
					variant,
					digest: sha(JSON.stringify(observed)),
					nodes: observed.nodes.length,
					edges: observed.edges.length,
				});
			} finally {
				run.cleanup();
			}
		}
	}
	write("preflight.json", preflight);
	// Static recipe finished before timing; children serialized, no heavy checks in parallel.
	for (let round = 0; round < recipe.rounds; round++) {
		const order = round % 2 ? [...variants].reverse() : variants;
		for (const variant of order) {
			execFileSync(
				process.execPath,
				[fileURLToPath(import.meta.url), "--worker", out, variant, String(round)],
				{ timeout: 120000, stdio: "pipe" },
			);
			console.log(`DONE cell-block ${variant}/${round}`);
		}
	}
	for (let round = 0; round < recipe.rounds; round++) {
		const order =
			round % 2 ? ["current-phases", "before-phases"] : ["before-phases", "current-phases"];
		for (const variant of order) {
			execFileSync(
				process.execPath,
				[fileURLToPath(import.meta.url), "--worker", out, variant, String(round)],
				{ timeout: 120000, stdio: "pipe" },
			);
			console.log(`DONE phase-block ${variant}/${round}`);
		}
	}
	const summaries = [];
	for (const variant of [...variants, "before-phases", "current-phases"])
		for (let round = 0; round < recipe.rounds; round++) {
			const samples = JSON.parse(readFileSync(path.join(out, `${variant}-${round}.json`), "utf8"));
			for (const [mode, arm] of cells) {
				const rows = samples.filter((s) => !s.warmup && s.mode === mode && s.arm === arm);
				assert.equal(rows.length, recipe.measured);
				summaries.push({
					variant,
					round,
					mode,
					arm,
					p50: quantile(
						rows.map((s) => s.micros),
						0.5,
					),
					p95: quantile(
						rows.map((s) => s.micros),
						0.95,
					),
					...(variant.endsWith("-phases")
						? {
								phases: Object.fromEntries(
									Object.keys(rows[0].phases).map((p) => [
										p,
										{
											p50: quantile(
												rows.map((s) => s.phases[p]),
												0.5,
											),
											p95: quantile(
												rows.map((s) => s.phases[p]),
												0.95,
											),
										},
									]),
								),
							}
						: {}),
				});
			}
		}
	write("results.json", {
		baseline,
		current,
		recipe,
		preflight,
		summaries,
		completedAt: new Date().toISOString(),
		limitations: [
			"No ablation is a safe product implementation",
			"Phase clocks add overhead; phase percentiles cannot be summed",
			"Structural remainder includes factory/control layout and registry changes",
			"Fresh child per variant differs from prior shared-process diagnostic",
			"No formal performance qualification, steady-state or memory claims",
		],
	});
	console.log("DONE registration-cost diagnostic");
}

if (process.argv[2] === "--worker")
	await worker(process.argv[3], process.argv[4], Number(process.argv[5]));
else await main(path.resolve(process.argv[2] ?? "archive/evals/library-registration-cost-v1/raw"));
