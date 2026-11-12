/** Bind the existing paired diagnostic to actual product source, without injection. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build, transformSync } from "esbuild";
import { adaptWorker } from "./spending-preset-repetition.mjs";

const root = resolve(process.argv[2]),
	prior = resolve(process.argv[3]);
mkdirSync(root);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const f = JSON.parse(readFileSync(resolve(prior, "freeze.json")));
const entry = "scripts/fixtures/spending-preset-performance-worker.ts";
const target = "examples/spending-alerts/causal-admission.ts";
const base = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const baseline = execFileSync("git", ["show", `${base}:${target}`], { encoding: "utf8" });
const sources = {};
for (const variant of ["before", "after"]) {
	const b = await build({
		entryPoints: [entry],
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
		metafile: true,
		plugins: [
			{
				name: "worker-adapter",
				setup(api) {
					api.onLoad({ filter: /spending-preset-performance-worker\.ts$/ }, () => ({
						contents: adaptWorker(readFileSync(entry, "utf8")),
						loader: "ts",
						resolveDir: resolve("scripts/fixtures"),
					}));
					api.onLoad({ filter: /spending-alerts\/causal-admission\.ts$/ }, () => ({
						contents: variant === "before" ? baseline : readFileSync(target, "utf8"),
						loader: "ts",
						resolveDir: resolve("examples/spending-alerts"),
					}));
				},
			},
		],
	});
	if (variant === "before") assert.equal(sha(b.outputFiles[0].contents), f.bundles.before);
	writeFileSync(resolve(root, variant + ".mjs"), b.outputFiles[0].contents);
	f.bundles[variant] = sha(b.outputFiles[0].contents);
	for (const p of Object.keys(b.metafile.inputs)) {
		const bytes = readFileSync(p);
		if (p !== target) {
			const priorBytes = execFileSync("git", ["show", `${base}:${p}`]);
			if (p.endsWith("causal-occurrence/transition.ts"))
				assert.equal(
					transformSync(bytes.toString(), { loader: "ts" }).code,
					transformSync(priorBytes.toString(), { loader: "ts" }).code,
					"type-only refresh assertion",
				);
			else assert.equal(sha(bytes), sha(priorBytes), p);
		}
		sources[p] = sha(bytes);
		const dest = resolve(root, "source", p);
		mkdirSync(resolve(dest, ".."), { recursive: true });
		writeFileSync(dest, bytes);
	}
}
for (const p of Object.keys(f.inputs)) {
	const n = p + "-inputs.json";
	const bytes = readFileSync(resolve(prior, n));
	assert.equal(sha(bytes), f.inputs[p]);
	writeFileSync(resolve(root, n), bytes);
}
writeFileSync(resolve(root, "admission-before.ts"), baseline);
writeFileSync(resolve(root, "tool.mjs"), readFileSync("scripts/causal-policy-prototype.mjs"));
writeFileSync(resolve(root, "runner.py"), readFileSync("scripts/run-causal-policy-prototype.py"));
f.scope =
	"Actual product source comparison; fixed diagnostic, not formal performance qualification";
writeFileSync(resolve(root, "freeze.json"), JSON.stringify(f, null, 2) + "\n");
writeFileSync(
	resolve(root, "provenance.json"),
	JSON.stringify(
		{
			base,
			sources,
			baselineSource: sha(baseline),
			productSource: sha(readFileSync(target)),
			adapter: sha(readFileSync("scripts/spending-preset-repetition.mjs")),
			beforeMatchesPreviousBaseline: true,
		},
		null,
		2,
	) + "\n",
);
console.log("PRODUCT_PAIRED_PREPARED", f.jobs.length);
