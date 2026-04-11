#!/usr/bin/env tsx
/**
 * Run the Layer 0 contrastive eval: Graph > Functions.
 *
 * Usage: pnpm eval:contrastive
 *
 * Resume (full corpus file unchanged):
 * - EVAL_L0_FROM=<task-id>     — start at this task (inclusive)
 * - EVAL_L0_AFTER=<task-id>    — start after this task (next task in corpus)
 * Set only one of FROM / AFTER.
 */

import { join } from "node:path";
import { runContrastiveEval } from "../lib/contrastive.js";
import { printSummary, writeResults } from "../lib/reporter.js";
import { DEFAULT_CONFIG } from "../lib/types.js";

async function main() {
	console.log("Running L0 Contrastive Eval: Graph > Functions\n");
	console.log(`Model: ${DEFAULT_CONFIG.model}`);
	console.log(`Judge: ${DEFAULT_CONFIG.judgeModel}`);
	console.log(`Spec evals: ${DEFAULT_CONFIG.specEvalsPath}`);
	if (DEFAULT_CONFIG.l0FromTaskId) {
		console.log(`Resume: EVAL_L0_FROM=${DEFAULT_CONFIG.l0FromTaskId} (inclusive)`);
	} else if (DEFAULT_CONFIG.l0ResumeAfterTaskId) {
		console.log(`Resume: EVAL_L0_AFTER=${DEFAULT_CONFIG.l0ResumeAfterTaskId} (exclusive)`);
	}
	console.log("");

	const run = await runContrastiveEval(DEFAULT_CONFIG);

	printSummary(run);

	const outputPath = join(import.meta.dirname, "..", "results", `${run.run_id}.json`);
	await writeResults(run, outputPath);
}

main().catch((err) => {
	console.error("Eval failed:", err);
	process.exit(1);
});
