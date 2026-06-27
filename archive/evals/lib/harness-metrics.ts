/**
 * Harness metrics — computes KPIs from eval run data (roadmap §9.1).
 *
 * Pure functions: no LLM calls, no I/O. Takes EvalRun[] and returns metrics.
 */

import type { EvalRun } from "./types.js";

export interface HarnessMetrics {
	/** % of GraphSpec outputs that are structurally valid JSON with correct schema. */
	firstPassValidity: number;
	/** % of outputs that reference fns/sources not in the catalog. */
	hallucinationRate: number;
	/** Average completeness across all generation tasks (0–1). */
	completeness: number;
	/** % of bug-finding tasks where the seeded bug was correctly identified. */
	debugAccuracy: number;
	/** Number of schema gaps still open (from tracked issues). */
	schemaGapsOpen: number;
	/** Number of schema gaps resolved (from tracked issues). */
	schemaGapsResolved: number;
	/** Total estimated cost in USD across all runs. */
	totalCostUsd: number;
	/** Number of eval runs analyzed. */
	runCount: number;
	/** Number of unique models tested. */
	modelCount: number;
}

/**
 * Compute harness metrics from a set of eval runs.
 *
 * @param runs - Array of EvalRun results (L0, L1, etc.)
 * @param schemaGaps - Optional { open, resolved } counts (tracked externally).
 */
export function computeMetrics(
	runs: EvalRun[],
	schemaGaps?: { open: number; resolved: number },
): HarnessMetrics {
	const allTasks = runs.flatMap((r) => r.tasks);
	const graphSpecTasks = allTasks.filter(
		(t) => t.treatment === "graphspec" || t.treatment === "single",
	);

	// First-pass validity: % of graphspec/single outputs that are valid
	const firstPassValidity =
		graphSpecTasks.length > 0
			? graphSpecTasks.filter((t) => t.valid).length / graphSpecTasks.length
			: 0;

	// Hallucination rate: % with a judge score flagging catalog misses
	const hallucinationRate =
		graphSpecTasks.length > 0
			? graphSpecTasks.filter((t) =>
					t.judge_scores.some(
						(s) => (s.claim.includes("catalog") || s.claim.includes("hallucin")) && !s.pass,
					),
				).length / graphSpecTasks.length
			: 0;

	// Completeness: average of completeness judge scores (0-1)
	const completenessScores = allTasks
		.flatMap((t) => t.judge_scores)
		.filter((s) => s.claim.includes("completeness") || s.claim.includes("complete"));
	const completeness =
		completenessScores.length > 0
			? completenessScores.filter((s) => s.pass).length / completenessScores.length
			: firstPassValidity; // Fallback: use validity as proxy

	// Debug accuracy: % of bug tasks where the bug was found
	const bugTasks = allTasks.filter((t) => t.judge_scores.some((s) => s.claim.includes("bug")));
	const debugAccuracy =
		bugTasks.length > 0
			? bugTasks.filter((t) => t.judge_scores.some((s) => s.claim.includes("bug") && s.pass))
					.length / bugTasks.length
			: 0;

	// Cost
	const totalCostUsd = runs.reduce((sum, r) => sum + (r.total_cost_usd ?? 0), 0);

	// Model diversity
	const models = new Set(runs.map((r) => r.model));

	return {
		firstPassValidity,
		hallucinationRate,
		completeness,
		debugAccuracy,
		schemaGapsOpen: schemaGaps?.open ?? 0,
		schemaGapsResolved: schemaGaps?.resolved ?? 0,
		totalCostUsd,
		runCount: runs.length,
		modelCount: models.size,
	};
}

/**
 * Format metrics as a markdown summary.
 */
export function formatMetricsMd(metrics: HarnessMetrics): string {
	const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
	const usd = (v: number) => `$${v.toFixed(4)}`;

	return `## Harness Metrics

| KPI | Value |
|-----|-------|
| First-pass validity | ${pct(metrics.firstPassValidity)} |
| Hallucination rate | ${pct(metrics.hallucinationRate)} |
| Completeness | ${pct(metrics.completeness)} |
| Debug accuracy | ${pct(metrics.debugAccuracy)} |
| Schema gaps (open / resolved) | ${metrics.schemaGapsOpen} / ${metrics.schemaGapsResolved} |
| Total cost | ${usd(metrics.totalCostUsd)} |
| Runs | ${metrics.runCount} |
| Models tested | ${metrics.modelCount} |
`;
}
