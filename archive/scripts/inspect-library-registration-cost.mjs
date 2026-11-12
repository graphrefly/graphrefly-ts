/** Analyze the finite diagnostic and count real validation calls outside any timing window. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const out = path.resolve(process.argv[2] ?? "archive/evals/library-registration-cost-v1/raw");
const report = JSON.parse(readFileSync(path.join(out, "results.json"), "utf8"));
const bindings = JSON.parse(readFileSync(path.join(out, "bindings.json"), "utf8"));
const sha = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const median = (xs) => {
	const sorted = [...xs].sort((a, b) => a - b);
	return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};
const get = (variant, mode, arm, round) => {
	const matches = report.summaries.filter(
		(r) => r.variant === variant && r.mode === mode && r.arm === arm && r.round === round,
	);
	assert.equal(matches.length, 1);
	return matches[0];
};
const contrasts = [];
for (const [mode, arm] of report.recipe.cells)
	for (const variant of report.recipe.variants.filter((v) => v !== "current")) {
		const rounds = Array.from({ length: report.recipe.rounds }, (_, round) => {
			const row = get(variant, mode, arm, round),
				reference = get("current", mode, arm, round);
			return {
				round,
				p50DeltaMicros: row.p50 - reference.p50,
				p95DeltaMicros: row.p95 - reference.p95,
				p50Percent: (row.p50 / reference.p50 - 1) * 100,
				p95Percent: (row.p95 / reference.p95 - 1) * 100,
			};
		});
		contrasts.push({
			mode,
			arm,
			variant,
			rounds,
			medianPairedP50DeltaMicros: median(rounds.map((r) => r.p50DeltaMicros)),
			medianPairedP95DeltaMicros: median(rounds.map((r) => r.p95DeltaMicros)),
		});
	}
const counts = [];
const probeBindings = [];
for (const variant of ["current", "without-checks"]) {
	const source = readFileSync(path.join(out, `${variant}.mjs`), "utf8");
	assert.equal(sha(source), bindings[variant].bundle);
	assert.equal(source.split("var Graph = class {").length, 2);
	const probe = source + "\nexport { Graph as DiagnosticGraph };\n";
	const file = path.join(out, `${variant}-counts.mjs`);
	writeFileSync(file, probe, { flag: "wx" });
	probeBindings.push({
		variant,
		sourceDigest: sha(source),
		probeDigest: sha(probe),
		change: "append private DiagnosticGraph export only; wrap two methods at runtime",
	});
	const { graphArm, DiagnosticGraph } = await import(pathToFileURL(file));
	const proto = DiagnosticGraph.prototype;
	const available = proto._assertAvailableId,
		depsLocal = proto._assertDepsLocal;
	let calls;
	proto._assertAvailableId = function (id) {
		calls.ids.push(id);
		return available.call(this, id);
	};
	proto._assertDepsLocal = function (deps, label) {
		calls.deps.push({ label, count: deps.length });
		return depsLocal.call(this, deps, label);
	};
	try {
		for (const [mode, arm] of report.recipe.cells) {
			calls = { ids: [], deps: [] };
			const run = graphArm(arm, mode);
			try {
				counts.push({
					variant,
					mode,
					arm,
					idChecks: calls.ids.length,
					dependencyElementsChecked: calls.deps.reduce((sum, r) => sum + r.count, 0),
					perNodeIdChecks: Object.fromEntries(
						[...new Set(calls.ids)].map((id) => [id, calls.ids.filter((v) => v === id).length]),
					),
					calls: structuredClone(calls),
				});
			} finally {
				run.cleanup();
			}
		}
	} finally {
		proto._assertAvailableId = available;
		proto._assertDepsLocal = depsLocal;
	}
}
for (const [mode, arm] of report.recipe.cells) {
	const full = counts.find((r) => r.mode === mode && r.arm === arm && r.variant === "current");
	const less = counts.find(
		(r) => r.mode === mode && r.arm === arm && r.variant === "without-checks",
	);
	const shape = report.preflight.find(
		(r) => r.mode === mode && r.arm === arm && r.variant === "current",
	);
	assert.equal(full.idChecks - less.idChecks, 2 * shape.nodes);
	assert.equal(full.dependencyElementsChecked - less.dependencyElementsChecked, 2 * shape.edges);
	assert.deepEqual(Object.keys(full.perNodeIdChecks), Object.keys(less.perNodeIdChecks));
}
writeFileSync(
	path.join(out, "analysis.json"),
	JSON.stringify(
		{
			resultDigest: sha(readFileSync(path.join(out, "results.json"))),
			contrasts,
			counts,
			probeBindings,
			note: "Counts cover these two Graph methods only, not all validation. Wrappers never participate in performance measurements. Differences of quantiles are contrasts, not additive cost accounting.",
		},
		null,
		2,
	) + "\n",
	{ flag: "wx" },
);
console.log(
	JSON.stringify(
		counts.map(({ variant, mode, arm, idChecks, dependencyElementsChecked }) => ({
			variant,
			mode,
			arm,
			idChecks,
			dependencyElementsChecked,
		})),
		null,
		2,
	),
);
console.log("DONE registration-cost analysis");
