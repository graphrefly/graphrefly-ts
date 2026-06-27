#!/usr/bin/env tsx
/**
 * Run the Layer 1 evals: generation + comprehension.
 *
 * Usage: pnpm eval:llm-dx
 */

import { join } from "node:path";
import { printSummary, writeResults } from "../lib/reporter.js";
import { runComprehensionEval, runLLMDXEval } from "../lib/runner.js";
import { DEFAULT_CONFIG } from "../lib/types.js";

async function main() {
	console.log("Running L1 Evals\n");
	console.log(`Provider: ${DEFAULT_CONFIG.provider}`);
	console.log(`Model: ${DEFAULT_CONFIG.model}`);
	console.log(`Judge: ${DEFAULT_CONFIG.judgeModel}\n`);

	const resultsDir = join(import.meta.dirname, "..", "results");

	// L1 Generation
	console.log("--- L1: Generation (NL → GraphSpec) ---");
	const l1gen = await runLLMDXEval(DEFAULT_CONFIG);
	printSummary(l1gen);
	await writeResults(l1gen, join(resultsDir, `${l1gen.run_id}.json`));

	// L1 Comprehension
	console.log("--- L1: Comprehension ---");
	const l1comp = await runComprehensionEval(DEFAULT_CONFIG);
	printSummary(l1comp);
	await writeResults(l1comp, join(resultsDir, `${l1comp.run_id}.json`));

	console.log("\nL1 evals complete.");
}

main().catch((err) => {
	console.error("Eval failed:", err);
	process.exit(1);
});
