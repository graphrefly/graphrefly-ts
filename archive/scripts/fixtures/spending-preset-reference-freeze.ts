/** Freeze private consumer source, actual node/dependency tables and pre-timing input fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { presetBinding, presetRun } from "./spending-preset-harness.js";
import { referenceRun } from "./spending-preset-reference-run.js";
import { PERF_PROFILES, profileScenario } from "./spending-preset-scenarios.js";

const output = process.argv[2];
assert.ok(output && !existsSync(output), "fresh output required");
mkdirSync(output, { recursive: true });
const hash = (data: string | Uint8Array) =>
	`sha256:${createHash("sha256").update(data).digest("hex")}`;
const put = (name: string, value: unknown) =>
	writeFileSync(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`);
const artifacts: Record<string, string> = {};
const sources: Record<string, string> = {};
for (const [arm, entry] of Object.entries({
	candidate: "spending-preset-harness",
	reference: "spending-preset-reference-run",
	plain: "spending-preset-plain",
	oracle: "spending-preset-oracle",
})) {
	const result = await build({
		entryPoints: [`scripts/fixtures/${entry}.ts`],
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
		metafile: true,
	});
	const bytes = result.outputFiles[0].contents;
	writeFileSync(resolve(output, `${arm}.mjs`), bytes);
	artifacts[`${arm}.mjs`] = hash(bytes);
	const closure = Object.keys(result.metafile.inputs).sort();
	if (arm === "reference" || arm === "plain")
		assert.ok(
			closure.every((p) => !p.startsWith("examples/spending-alerts/")),
			`${arm} must not load candidate consumer helpers`,
		);
	for (const path of closure) sources[path] = hash(readFileSync(path));
	put(`${arm}-metafile.json`, result.metafile);
	put(`${arm}-source-closure.json`, Object.fromEntries(closure.map((p) => [p, sources[p]])));
}
for (const mode of ["off", "summary"] as const)
	for (const arm of ["candidate", "reference"] as const) {
		const run = arm === "candidate" ? presetRun(mode) : referenceRun(mode, presetBinding);
		try {
			const nodes = run.graph
				.describe()
				.nodes.map(({ id, factory, deps }) => ({ id, factory, deps }));
			put(`${arm}-${mode}-topology.json`, {
				owned: run.owner.nodes.length,
				roots: run.owner.roots.length,
				inputSources: 6,
				nodes,
				edges: nodes.flatMap((n) => n.deps.map((from) => ({ from, to: n.id }))),
			});
			assert.equal(run.owner.nodes.length, mode === "off" ? 53 : 54);
			assert.equal(run.owner.roots.length, 2);
		} finally {
			run.cleanup();
		}
	}
for (const { id } of PERF_PROFILES) put(`${id}-inputs.json`, profileScenario(id));
for (const path of [
	"scripts/fixtures/spending-preset-scenarios.ts",
	"scripts/fixtures/spending-preset-reference-freeze.ts",
	"scripts/qualify-spending-preset-reference.mjs",
	"packages/ts/src/__tests__/spending-alerts-preset-reference.test.ts",
	"docs/design/causal-preset-assembly-v1.md",
	"docs/design/causal-preset-numeric-contract-v1.md",
	"pnpm-lock.yaml",
])
	sources[path] = hash(readFileSync(path));
put("freeze.json", {
	kind: "private-preset-reference-freeze",
	work: "graphrefly-ts:CAUSAL-PRESET-ASSEMBLY-TS",
	node: process.version,
	platform: process.platform,
	arch: process.arch,
	sources,
	artifacts,
	sharedFloor: "existing Graph/C runtime and independently qualified publication reference",
	consumerHelperSharing: false,
	publicApiChanges: false,
	performanceRun: false,
	fullPresetQualification: false,
});
console.log("PRESET_REFERENCE_FREEZE_DONE", Object.keys(sources).length);
