/** Private estimator: median batch p95s, never median of paired ratios. */
import assert from "node:assert/strict";
export function percentile(values, fraction) {
	assert.ok(
		values.length && values.every((v) => Number.isFinite(v) && v >= 0),
		"finite nonnegative samples required",
	);
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
export function summarize(row, samples, recipe) {
	const arms = {};
	for (const arm of row.group === "recovery"
		? ["candidate", "reference"]
		: ["candidate", "reference", "plain"]) {
		const selected = samples.filter((s) => s.arm === arm && s.phase === "measured");
		const batches = Array.from({ length: row.group === "recovery" ? 1 : 3 }, (_, batch) => {
			const group = selected.filter((s) => s.batch === batch);
			assert.equal(
				group.length,
				row.group === "recovery" ? recipe.recoveryCycles : recipe.measured,
				`${arm} batch ${batch} measured count`,
			);
			assert.equal(new Set(group.map((s) => s.index)).size, group.length, "duplicate sample index");
			if (row.group !== "recovery")
				assert.equal(
					samples.filter((s) => s.arm === arm && s.batch === batch && s.phase === "warmup").length,
					recipe.warmup,
					"warmup count",
				);
			const p95 = percentile(
				group.map((s) => s.ms),
				0.95,
			);
			return {
				batch,
				p95Ms: p95,
				p95Samples: group
					.filter((s) => s.ms === p95)
					.map(({ index, start, end }) => ({ index, start, end })),
				constructionTotalMs: group.reduce((n, s) => n + s.constructionMs, 0),
				preparationTotalMs: group.reduce((n, s) => n + s.preparationMs, 0),
			};
		});
		arms[arm] = {
			batches,
			medianBatchP95Ms: percentile(
				batches.map((b) => b.p95Ms),
				0.5,
			),
			memoryMeaning: recipe.memory,
		};
	}
	if (row.group === "recovery")
		arms.plain = {
			status: "not-applicable",
			reason:
				"qualified plain reference has no subscription API; no-op timing would not be an equivalent recovery operation",
		};
	const ratio = arms.candidate.medianBatchP95Ms / arms.reference.medianBatchP95Ms;
	assert.ok(
		Number.isFinite(ratio) && arms.reference.medianBatchP95Ms > 0,
		"valid Graph denominator required",
	);
	const limit =
		row.group === "cold" ? recipe.coldLimit : row.group === "steady" ? recipe.steadyLimit : null;
	return { arms, ratio, limit, passed: limit === null || ratio <= limit };
}
export { legacyCorrelation as correlate } from "./causal-event-correlation.mjs";
