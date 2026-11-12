/** D168 private method helpers. Frozen v1 sources are adapted only in the generated bundle. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { percentile, summarize } from "./spending-preset-performance-report.mjs";

export const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const METHOD = Object.freeze({
	revision: "spending-preset-repetition-v2",
	row: { id: "cold-P2-summary", group: "cold", profile: "P2", mode: "summary" },
	repetitions: 16,
	controls: 4,
	warmup: 100,
	measured: 300,
	limit: 1.2,
	controlLimit: 1.05,
	intervalRanks: [2, 15],
	maxProcesses: 20,
	maxSamples: 67200,
	timeoutMs: 900000,
});
export const jobs = () => [
	...Array.from({ length: 2 }, (_, i) => ({ id: `control-${i}`, control: true })),
	...Array.from({ length: 16 }, (_, i) => ({ id: `repeat-${i}`, control: false })),
	...Array.from({ length: 2 }, (_, i) => ({ id: `control-${i + 2}`, control: true })),
];

export function checkQualification(qualification) {
	const expected = [
		"plain-unbounded-domains",
		"plain-cached-outcome-replay",
		"plain-evidence-omitted",
		"baseline",
		"stale-join-rows",
		"pack-bound-one-mib",
		"wrong-score",
		"dependency-guard-removed",
	];
	assert.equal(qualification.complete, true, "current reference qualification");
	assert.deepEqual(
		qualification.results.map((r) => r.id).sort(),
		[...expected].sort(),
		"unique complete semantic cases",
	);
	assert.ok(
		qualification.results.every(
			(r) => r.loaded && r.outcome === (r.id === "baseline" ? "passed" : "detected"),
		),
		"loaded semantic qualification",
	);
}

export function adaptWorker(source) {
	const once = (before, after) => {
		assert.equal(source.split(before).length, 2, `worker shape drift: ${before}`);
		source = source.replace(before, after);
	};
	once("export { matrixRows, RECIPE };", "export { matrixRows, RECIPE, measurementArm };");
	once(
		"\t\toutput: string;",
		"\t\toutput: string;\n\t\tcontrol?: boolean;\n\t\tcopyModule?: string;",
	);
	once(
		"\tconst checked = preflight(row, scenario);",
		`\tconst twin = config.control ? await import(config.copyModule!) : undefined;
\tconst makeArm: typeof measurementArm = config.control
\t\t? (arm, mode) => arm === "candidate" ? twin.measurementArm("reference", mode) : measurementArm("reference", mode)
\t\t: measurementArm;
\tconst checked = preflight(row, scenario);
\tif (twin) assert.deepEqual(twin.preflight(row, scenario), checked, "identical-copy semantic preflight");`,
	);
	once("\t\tpid: process.pid,", "\t\tpid: process.pid,\n\t\tcontrol: config.control === true,");
	once(
		'...(row.group === "recovery" ? [] : ["plain"])',
		'...(row.group === "recovery" || config.control ? [] : ["plain"])',
	);
	assert.equal(source.split("measurementArm(arm, row.mode)").length, 3, "two clock call sites");
	return source.replaceAll("measurementArm(arm, row.mode)", "makeArm(arm, row.mode)");
}

export function summarizeRepeat(row, samples, recipe, control) {
	assert.equal(row.group, "cold", "method validation is cold only");
	const expectedArms = control ? ["candidate", "reference"] : ["candidate", "reference", "plain"];
	let cursor = 0;
	for (let batch = 0; batch < 3; batch++) {
		const order = batch === 1 ? ["reference", "candidate"] : ["candidate", "reference"];
		if (!control) order.push("plain");
		for (const arm of order)
			for (let index = 0; index < 400; index++) {
				const s = samples[cursor++];
				assert.ok(s, "missing sample");
				assert.equal(s.arm, arm, "arm/order mismatch");
				assert.equal(s.batch, batch, "batch mismatch");
				assert.equal(s.index, index, "sample index mismatch");
				assert.equal(s.phase, index < 100 ? "warmup" : "measured", "phase mismatch");
				for (const key of ["start", "end", "ms", "constructionMs", "preparationMs"])
					assert.ok(Number.isFinite(s[key]) && s[key] >= 0, `invalid ${key}`);
				assert.equal(s.end - s.start, s.ms, "clock mismatch");
			}
	}
	assert.equal(cursor, samples.length, "unexpected samples");
	// Main rows use the untouched estimator. Controls apply its same two-arm formula
	// directly because a plain reconnect/construction stand-in is not measured here.
	const arms = control
		? Object.fromEntries(
				expectedArms.map((arm) => {
					const batches = Array.from({ length: 3 }, (_, batch) => ({
						batch,
						p95Ms: percentile(
							samples
								.filter((s) => s.arm === arm && s.batch === batch && s.phase === "measured")
								.map((s) => s.ms),
							0.95,
						),
					}));
					return [
						arm,
						{
							batches,
							medianBatchP95Ms: percentile(
								batches.map((b) => b.p95Ms),
								0.5,
							),
						},
					];
				}),
			)
		: undefined;
	const result = arms
		? { arms, ratio: arms.candidate.medianBatchP95Ms / arms.reference.medianBatchP95Ms }
		: summarize(row, samples, recipe);
	assert.ok(
		Number.isFinite(result.ratio) && result.ratio > 0,
		"positive Graph denominator and ratio",
	);
	return {
		ratio: result.ratio,
		arms: result.arms,
		sampleCount: cursor,
		measuredArms: expectedArms,
	};
}

export function decide(repeats, controls) {
	assert.equal(repeats.length, 16, "fixed repetition count");
	assert.equal(controls.length, 4, "fixed control count");
	assert.ok(
		[...repeats, ...controls].every((n) => Number.isFinite(n) && n > 0),
		"valid ratios",
	);
	const sorted = [...repeats].sort((a, b) => a - b);
	const interval = [sorted[1], sorted[14]];
	const stable = controls.every((r) => r >= 1 / 1.05 && r <= 1.05);
	const verdict = !stable
		? "inconclusive"
		: interval[1] <= 1.2
			? "passed"
			: interval[0] > 1.2
				? "rejected"
				: "inconclusive";
	return {
		verdict,
		reason: !stable
			? "control-instability"
			: verdict === "inconclusive"
				? "budget-straddled"
				: "interval-budget",
		interval,
		median: (sorted[7] + sorted[8]) / 2,
		mean: repeats.reduce((a, b) => a + b, 0) / 16,
		min: sorted[0],
		max: sorted[15],
		controls,
	};
}
