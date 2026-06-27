#!/usr/bin/env tsx
/**
 * Compare two eval result files and report regressions.
 *
 * Usage: pnpm eval:compare evals/results/baseline.json evals/results/latest.json
 */

import { readFile } from "node:fs/promises";
import { compareRuns } from "../lib/reporter.js";
import type { EvalRun } from "../lib/types.js";

async function main() {
	const [, , baselinePath, currentPath] = process.argv;

	if (!baselinePath || !currentPath) {
		console.error("Usage: pnpm eval:compare <baseline.json> <current.json>");
		process.exit(1);
	}

	const baseline: EvalRun = JSON.parse(await readFile(baselinePath, "utf-8"));
	const current: EvalRun = JSON.parse(await readFile(currentPath, "utf-8"));

	console.log(`Comparing: ${baseline.run_id} → ${current.run_id}`);
	console.log(`Layer: ${current.layer} | Model: ${current.model}\n`);

	const { regressions, improvements } = compareRuns(baseline, current);

	if (improvements.length > 0) {
		console.log("Improvements:");
		for (const imp of improvements) {
			console.log(`  + ${imp}`);
		}
	}

	if (regressions.length > 0) {
		console.log("\nRegressions (>5pp drop):");
		for (const reg of regressions) {
			console.log(`  - ${reg}`);
		}
		console.log("");
		process.exit(1); // Fail CI on regression
	}

	if (regressions.length === 0 && improvements.length === 0) {
		console.log("No significant changes.");
	}

	console.log("");
}

main().catch((err) => {
	console.error("Compare failed:", err);
	process.exit(1);
});
