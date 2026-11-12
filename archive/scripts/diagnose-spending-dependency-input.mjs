/** Counterfactual diagnostic only: preserve the frozen guard snapshot, vary only constructor input. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const hash = (x) => `sha256:${createHash("sha256").update(x).digest("hex")}`;
const put = (p, x) => writeFileSync(p, `${JSON.stringify(x, null, 2)}\n`);
const output = process.argv[2] && resolve(process.argv[2]),
	diagnostic = process.argv[3] && resolve(process.argv[3]);
assert.ok(
	output && diagnostic && !existsSync(output),
	"fresh output and completed cold diagnostic run required",
);
mkdirSync(output, { recursive: true });
const prior = JSON.parse(
	readFileSync(
		"packages/ts/qualification/causal-occurrence/preset-performance-v1/receipt.json",
		"utf8",
	),
);
for (const [p, d] of Object.entries(prior.sourceBindings))
	assert.equal(hash(readFileSync(p)), d, `frozen source drift ${p}`);
const firstFreeze = JSON.parse(readFileSync(`${diagnostic}/freeze.json`, "utf8"));
assert.equal(JSON.parse(readFileSync(`${diagnostic}/completion.json`, "utf8")).completed, true);
assert.equal(hash(readFileSync(`${diagnostic}/unmodified.mjs`)), firstFreeze.bundles.unmodified);
const fixtureBytes = readFileSync(`${diagnostic}/P2-inputs.json`);
const originalIndex = JSON.parse(readFileSync(prior.rawEvidence.indexPath, "utf8"));
assert.equal(hash(readFileSync(prior.rawEvidence.indexPath)), prior.rawEvidence.indexDigest);
assert.equal(hash(fixtureBytes), originalIndex.files["attempt-01/P2-inputs.json"]);
writeFileSync(`${output}/P2-inputs.json`, fixtureBytes);
const snapshots = {},
	bindings = {};
let original, transformed;
const result = await build({
	stdin: {
		contents:
			'export {graphArm} from "./scripts/fixtures/spending-preset-performance.ts"; export {preflight} from "./scripts/fixtures/spending-preset-performance-worker.ts";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	metafile: true,
	plugins: [
		{
			name: "diagnostic-constructor-array",
			setup(build) {
				build.onLoad({ filter: /\.(ts|js|mjs|json)$/ }, (args) => {
					const path = relative(process.cwd(), args.path);
					let contents = readFileSync(args.path, "utf8");
					assert.equal(hash(contents), prior.sourceBindings[path], `source at load ${path}`);
					snapshots[path] = contents;
					bindings[path] = hash(contents);
					if (path === "examples/spending-alerts/causal-business.ts") {
						original = contents;
						const anchor = "const node = scope.node<T>(\n\t\t\texpected,";
						assert.equal(contents.split(anchor).length, 2, "exact one callsite required");
						contents = contents.replace(
							anchor,
							'const node = scope.node<T>(\n\t\t\tglobalThis.__spendingDependencyInput === "ordinary" ? deps : expected,',
						);
						transformed = contents;
					}
					return {
						contents,
						loader: path.endsWith(".ts") ? "ts" : path.endsWith(".json") ? "json" : "js",
					};
				});
			},
		},
	],
});
for (const [p, d] of Object.entries(bindings))
	assert.equal(hash(readFileSync(p)), d, `post-build drift ${p}`);
writeFileSync(`${output}/trial.mjs`, result.outputFiles[0].contents);
writeFileSync(`${output}/causal-business.original.ts`, original);
writeFileSync(`${output}/causal-business.diagnostic.ts`, transformed);
put(`${output}/metafile.json`, result.metafile);
const recipe = {
	kind: "diagnostic-counterfactual",
	qualification: false,
	baseline: "frozen expected array",
	counterfactual: "original ordinary deps array; same frozen expected guard remains",
	warmup: 100,
	measured: 1000,
	orders: [
		["frozen", "ordinary"],
		["ordinary", "frozen"],
		["frozen", "ordinary"],
	],
	modes: ["off", "summary"],
	timeoutMs: 120000,
	sourceBindings: bindings,
	scriptDigest: hash(readFileSync("scripts/diagnose-spending-dependency-input.mjs")),
	bundleDigest: hash(result.outputFiles[0].contents),
	fixtureDigest: hash(fixtureBytes),
	hypothesis:
		"Passing a frozen array to Graph registration/spread contributes to the candidate cold-builder excess",
	nonClaims: [
		"No production edit",
		"No qualified optimization",
		"No qualification rerun or threshold change",
		"No claim to explain historical p95 solely from this trial",
	],
};
put(`${output}/freeze.json`, recipe);
const mod = await import(pathToFileURL(`${output}/trial.mjs`).href),
	scenario = JSON.parse(fixtureBytes),
	checks = [];
for (const mode of recipe.modes)
	for (const variant of ["frozen", "ordinary"]) {
		globalThis.__spendingDependencyInput = variant;
		checks.push({
			mode,
			variant,
			result: mod.preflight(
				{ id: `dependency-trial-${mode}-${variant}`, group: "cold", profile: "P2", mode },
				scenario,
			),
		});
	}
put(`${output}/preflight.json`, checks);
const samples = [],
	begin = Date.now();
for (const mode of recipe.modes)
	for (let batch = 0; batch < recipe.orders.length; batch++)
		for (const variant of recipe.orders[batch]) {
			globalThis.__spendingDependencyInput = variant;
			for (let index = 0; index < recipe.warmup + recipe.measured; index++) {
				assert.ok(
					Date.now() - begin < recipe.timeoutMs,
					"diagnostic timeout; partial samples preserved",
				);
				let run;
				try {
					const start = performance.now();
					run = mod.graphArm("candidate", mode);
					const end = performance.now();
					const sample = {
						mode,
						batch,
						variant,
						index,
						phase: index < recipe.warmup ? "warmup" : "measured",
						ms: end - start,
					};
					samples.push(sample);
					appendFileSync(`${output}/samples.jsonl`, `${JSON.stringify(sample)}\n`);
				} finally {
					run?.cleanup();
				}
			}
		}
delete globalThis.__spendingDependencyInput;
const summary = [];
for (const mode of recipe.modes)
	for (let batch = 0; batch < 3; batch++)
		for (const variant of ["frozen", "ordinary"]) {
			const values = samples
				.filter(
					(s) =>
						s.mode === mode && s.batch === batch && s.variant === variant && s.phase === "measured",
				)
				.map((s) => s.ms)
				.sort((a, b) => a - b);
			summary.push({
				mode,
				batch,
				variant,
				count: values.length,
				meanMs: values.reduce((a, b) => a + b, 0) / values.length,
				p50Ms: values[499],
				p95Ms: values[949],
			});
		}
put(`${output}/summary.json`, summary);
put(`${output}/completion.json`, {
	completed: true,
	qualification: false,
	samples: samples.length,
	elapsedMs: Date.now() - begin,
});
console.log("DEPENDENCY_INPUT_DIAGNOSTIC_DONE", samples.length);
