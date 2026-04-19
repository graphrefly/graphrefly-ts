/**
 * Result aggregation and reporting.
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { computeContrastiveScores } from "./contrastive.js";
import type { EvalRun, TaskResult } from "./types.js";

/**
 * Write eval results to a JSON file.
 */
export async function writeResults(run: EvalRun, outputPath: string): Promise<void> {
	await writeFile(outputPath, JSON.stringify(run, null, 2));
	console.log(`Results written to ${outputPath}`);
}

/**
 * Merge a previous run with a new partial run.
 *
 * Used for incremental / resume runs gated by `EVAL_MAX_CALLS` or
 * `EVAL_L0_FROM`. Tasks dedupe by `task_id+treatment` (last write wins —
 * the new run's results supersede prior ones for the same task). For L0
 * runs, scores are recomputed over the merged set; otherwise the new
 * run's scores are kept as-is. Costs sum, rate-limit totals sum,
 * timestamp = newer.
 *
 * Caller is responsible for matching `run_id` (writer below enforces it).
 */
export function mergeRuns(prev: EvalRun, current: EvalRun): EvalRun {
	const seen = new Set(current.tasks.map((t) => `${t.task_id}::${t.treatment}`));
	const carriedOver = prev.tasks.filter((t) => !seen.has(`${t.task_id}::${t.treatment}`));
	const tasks: TaskResult[] = [...carriedOver, ...current.tasks];

	const scores = current.layer === "L0" ? computeContrastiveScores(tasks) : current.scores;

	const total_cost_usd = (prev.total_cost_usd ?? 0) + (current.total_cost_usd ?? 0) || undefined;

	const rate_limit_stats =
		prev.rate_limit_stats && current.rate_limit_stats
			? {
					total_retries:
						prev.rate_limit_stats.total_retries + current.rate_limit_stats.total_retries,
					total_wait_ms:
						prev.rate_limit_stats.total_wait_ms + current.rate_limit_stats.total_wait_ms,
					effective_rpm: current.rate_limit_stats.effective_rpm,
					effective_tpm: current.rate_limit_stats.effective_tpm,
				}
			: (current.rate_limit_stats ?? prev.rate_limit_stats);

	return {
		...current,
		tasks,
		scores,
		total_cost_usd,
		rate_limit_stats,
	};
}

/**
 * Write eval results to disk, merging into an existing file when present.
 *
 * - File missing → write `current` as-is.
 * - File present, same `run_id` → merge with prior, write back.
 * - File present, different `run_id` → throw (silent overwrite hides bugs).
 *
 * The `run_id` match is the contract for "resume into this file." Set
 * `EVAL_RUN_ID=<your-stable-id>` across resume invocations to opt in.
 */
export async function mergeAndWriteResults(current: EvalRun, outputPath: string): Promise<EvalRun> {
	if (existsSync(outputPath)) {
		const prev = JSON.parse(readFileSync(outputPath, "utf-8")) as EvalRun;
		if (prev.run_id !== current.run_id) {
			throw new Error(
				`Run id mismatch at ${outputPath}: existing run_id="${prev.run_id}" but new run_id="${current.run_id}". ` +
					`Refusing to overwrite. Set EVAL_RUN_ID="${prev.run_id}" to merge into the existing file, or pick a fresh id.`,
			);
		}
		const merged = mergeRuns(prev, current);
		await writeFile(outputPath, JSON.stringify(merged, null, 2));
		console.log(
			`Results merged into ${outputPath} (${current.tasks.length} new task results, ${merged.tasks.length} total)`,
		);
		return merged;
	}
	await writeFile(outputPath, JSON.stringify(current, null, 2));
	console.log(`Results written to ${outputPath}`);
	return current;
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
