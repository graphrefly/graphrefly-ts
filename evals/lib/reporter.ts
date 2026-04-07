/**
 * Result aggregation and reporting.
 */

import { writeFile } from "node:fs/promises";
import type { EvalRun } from "./types.js";

/**
 * Write eval results to a JSON file.
 */
export async function writeResults(run: EvalRun, outputPath: string): Promise<void> {
	await writeFile(outputPath, JSON.stringify(run, null, 2));
	console.log(`Results written to ${outputPath}`);
}

/**
 * Print a summary of an eval run to stdout.
 */
export function printSummary(run: EvalRun): void {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`Eval Run: ${run.run_id}`);
	console.log(`Layer: ${run.layer} | Model: ${run.model} (${run.provider})`);
	console.log(`Tasks: ${run.tasks.length} | Time: ${run.timestamp}`);
	if (run.total_cost_usd != null) {
		console.log(`Estimated cost: $${run.total_cost_usd.toFixed(4)}`);
	}
	console.log(`${"=".repeat(60)}`);

	console.log("\nScores:");
	for (const [metric, score] of Object.entries(run.scores)) {
		const pct = (score * 100).toFixed(1);
		console.log(`  ${metric}: ${pct}%`);
	}

	// Failures
	const failures = run.tasks.filter((t) => !t.valid);
	if (failures.length > 0) {
		console.log(`\nFailures (${failures.length}):`);
		for (const f of failures.slice(0, 10)) {
			console.log(`  - ${f.task_id} [${f.treatment}]`);
		}
		if (failures.length > 10) {
			console.log(`  ... and ${failures.length - 10} more`);
		}
	}

	console.log("");
}

/**
 * Compare two eval runs and report regressions.
 */
export function compareRuns(
	baseline: EvalRun,
	current: EvalRun,
): { regressions: string[]; improvements: string[] } {
	const regressions: string[] = [];
	const improvements: string[] = [];

	for (const [metric, currentScore] of Object.entries(current.scores)) {
		const baselineScore = baseline.scores[metric];
		if (baselineScore === undefined) continue;

		const delta = currentScore - baselineScore;
		const deltaPct = (delta * 100).toFixed(1);

		if (delta < -0.05) {
			regressions.push(
				`${metric}: ${deltaPct}pp (${(baselineScore * 100).toFixed(1)}% → ${(currentScore * 100).toFixed(1)}%)`,
			);
		} else if (delta > 0.05) {
			improvements.push(
				`${metric}: +${deltaPct}pp (${(baselineScore * 100).toFixed(1)}% → ${(currentScore * 100).toFixed(1)}%)`,
			);
		}
	}

	return { regressions, improvements };
}
