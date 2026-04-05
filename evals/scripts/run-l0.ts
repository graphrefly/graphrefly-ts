#!/usr/bin/env tsx
/**
 * Run the Layer 0 contrastive eval: Graph > Functions.
 *
 * Usage: pnpm eval:contrastive
 */

import { join } from "node:path";
import { runContrastiveEval } from "../lib/contrastive.js";
import { printSummary, writeResults } from "../lib/reporter.js";
import { DEFAULT_CONFIG } from "../lib/types.js";

async function main() {
	console.log("Running L0 Contrastive Eval: Graph > Functions\n");
	console.log(`Model: ${DEFAULT_CONFIG.model}`);
	console.log(`Judge: ${DEFAULT_CONFIG.judgeModel}`);
	console.log(`Spec evals: ${DEFAULT_CONFIG.specEvalsPath}\n`);

	const run = await runContrastiveEval(DEFAULT_CONFIG);

	printSummary(run);

	const outputPath = join(import.meta.dirname, "..", "results", `${run.run_id}.json`);
	await writeResults(run, outputPath);
}

main().catch((err) => {
	console.error("Eval failed:", err);
	process.exit(1);
});
