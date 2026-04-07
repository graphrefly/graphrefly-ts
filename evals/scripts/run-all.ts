#!/usr/bin/env tsx

/**
 * Run all automated evals.
 *
 * Usage: pnpm eval
 */

import { join } from "node:path";
import { runContrastiveEval } from "../lib/contrastive.js";
import { printSummary, writeResults } from "../lib/reporter.js";
import { runComprehensionEval, runLLMDXEval } from "../lib/runner.js";
import { DEFAULT_CONFIG } from "../lib/types.js";

async function main() {
	console.log("Running all GraphReFly evals\n");
	console.log(`Provider: ${DEFAULT_CONFIG.provider}`);
	console.log(`Model: ${DEFAULT_CONFIG.model}`);
	console.log(`Judge: ${DEFAULT_CONFIG.judgeModel}\n`);

	const resultsDir = join(import.meta.dirname, "..", "results");

	// L0: Contrastive
	console.log("--- Layer 0: Graph > Functions ---");
	const l0 = await runContrastiveEval(DEFAULT_CONFIG);
	printSummary(l0);
	await writeResults(l0, join(resultsDir, `${l0.run_id}.json`));

	// L1 Generation: NL → GraphSpec
	console.log("--- Layer 1: Generation (NL → GraphSpec) ---");
	const l1gen = await runLLMDXEval(DEFAULT_CONFIG);
	printSummary(l1gen);
	await writeResults(l1gen, join(resultsDir, `${l1gen.run_id}.json`));

	// L1 Comprehension: debug / modify / explain
	console.log("--- Layer 1: Comprehension ---");
	const l1comp = await runComprehensionEval(DEFAULT_CONFIG);
	printSummary(l1comp);
	await writeResults(l1comp, join(resultsDir, `${l1comp.run_id}.json`));

	console.log("\nAll evals complete.");
}

main().catch((err) => {
	console.error("Eval failed:", err);
	process.exit(1);
});
