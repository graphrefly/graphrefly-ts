#!/usr/bin/env tsx

/**
 * Run all automated evals.
 *
 * Usage: pnpm eval
 */

import { join } from "node:path";
import { runContrastiveEval } from "../lib/contrastive.js";
import { printSummary, writeResults } from "../lib/reporter.js";
import { runLLMDXEval } from "../lib/runner.js";
import { DEFAULT_CONFIG } from "../lib/types.js";

async function main() {
	console.log("Running all GraphReFly evals\n");
	console.log(`Model: ${DEFAULT_CONFIG.model}`);
	console.log(`Judge: ${DEFAULT_CONFIG.judgeModel}\n`);

	// L0: Contrastive
	console.log("--- Layer 0: Graph > Functions ---");
	const l0 = await runContrastiveEval(DEFAULT_CONFIG);
	printSummary(l0);
	await writeResults(l0, join(import.meta.dirname, "..", "results", `${l0.run_id}.json`));

	// L1: LLM-DX
	console.log("--- Layer 1: LLM-DX ---");
	const l1 = await runLLMDXEval(DEFAULT_CONFIG);
	printSummary(l1);
	await writeResults(l1, join(import.meta.dirname, "..", "results", `${l1.run_id}.json`));

	console.log("\nAll evals complete.");
}

main().catch((err) => {
	console.error("Eval failed:", err);
	process.exit(1);
});
