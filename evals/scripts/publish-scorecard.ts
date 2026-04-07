#!/usr/bin/env tsx
/**
 * Scorecard generator — aggregates eval results into a publishable scorecard.
 *
 * Usage: pnpm eval:scorecard
 *
 * Reads all JSON result files in evals/results/, computes harness metrics,
 * and outputs evals/scorecard/latest.json + latest.md.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeMetrics, formatMetricsMd } from "../lib/harness-metrics.js";
import type { EvalRun } from "../lib/types.js";

async function loadAllRuns(resultsDir: string): Promise<EvalRun[]> {
	const files = await readdir(resultsDir);
	const jsonFiles = files.filter((f) => f.endsWith(".json"));

	const runs: EvalRun[] = [];
	for (const file of jsonFiles) {
		try {
			const raw = await readFile(join(resultsDir, file), "utf-8");
			const run = JSON.parse(raw) as EvalRun;
			if (run.run_id && run.tasks) {
				runs.push(run);
			}
		} catch {
			console.warn(`  Skipping ${file} (not a valid EvalRun)`);
		}
	}

	return runs;
}

async function main() {
	const resultsDir = join(import.meta.dirname, "..", "results");
	const scorecardDir = join(import.meta.dirname, "..", "scorecard");

	console.log("Loading eval results...");
	const runs = await loadAllRuns(resultsDir);

	if (runs.length === 0) {
		console.log("No eval results found. Run `pnpm eval` first.");
		process.exit(0);
	}

	console.log(`Found ${runs.length} runs across ${new Set(runs.map((r) => r.model)).size} models`);

	// Schema gaps: tracked in roadmap — hardcode current counts
	// TODO: automate from issue tracker / roadmap parsing
	const schemaGaps = { open: 1, resolved: 3 }; // T6 feedback, T8 templates, T5 resilience resolved; gap tracking itself is open

	const metrics = computeMetrics(runs, schemaGaps);

	// Per-model breakdown
	const byModel = new Map<string, EvalRun[]>();
	for (const run of runs) {
		const key = `${run.model} (${run.provider})`;
		const arr = byModel.get(key) ?? [];
		arr.push(run);
		byModel.set(key, arr);
	}

	let md = `# GraphReFly Eval Scorecard\n\nGenerated: ${new Date().toISOString()}\n\n`;
	md += formatMetricsMd(metrics);
	md += "\n## Per-Model Breakdown\n\n";

	for (const [modelKey, modelRuns] of byModel) {
		const modelMetrics = computeMetrics(modelRuns, schemaGaps);
		md += `### ${modelKey}\n\n`;
		md += `| KPI | Value |\n|-----|-------|\n`;
		md += `| First-pass validity | ${(modelMetrics.firstPassValidity * 100).toFixed(1)}% |\n`;
		md += `| Hallucination rate | ${(modelMetrics.hallucinationRate * 100).toFixed(1)}% |\n`;
		md += `| Debug accuracy | ${(modelMetrics.debugAccuracy * 100).toFixed(1)}% |\n`;
		md += `| Runs | ${modelMetrics.runCount} |\n`;
		md += `| Cost | $${modelMetrics.totalCostUsd.toFixed(4)} |\n\n`;
	}

	// Write outputs
	await mkdir(scorecardDir, { recursive: true });

	const jsonPayload = {
		generated: new Date().toISOString(),
		metrics,
		runs: runs.map((r) => ({
			run_id: r.run_id,
			layer: r.layer,
			model: r.model,
			provider: r.provider,
			timestamp: r.timestamp,
			scores: r.scores,
			total_cost_usd: r.total_cost_usd,
			task_count: r.tasks.length,
		})),
	};

	await writeFile(join(scorecardDir, "latest.json"), JSON.stringify(jsonPayload, null, 2));
	await writeFile(join(scorecardDir, "latest.md"), md);

	console.log(`\nScorecard written to:`);
	console.log(`  ${join(scorecardDir, "latest.json")}`);
	console.log(`  ${join(scorecardDir, "latest.md")}`);
	console.log("");
	console.log(md);
}

main().catch((err) => {
	console.error("Scorecard generation failed:", err);
	process.exit(1);
});
