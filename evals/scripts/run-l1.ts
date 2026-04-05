#!/usr/bin/env tsx
/**
 * Run the Layer 1 LLM-DX eval: NL → GraphSpec composition accuracy.
 *
 * Usage: pnpm eval:llm-dx
 */

import { join } from "node:path";
import { printSummary, writeResults } from "../lib/reporter.js";
import { runLLMDXEval } from "../lib/runner.js";
import { DEFAULT_CONFIG } from "../lib/types.js";

async function main() {
	console.log("Running L1 LLM-DX Eval: NL → GraphSpec\n");
	console.log(`Model: ${DEFAULT_CONFIG.model}`);
	console.log(`Judge: ${DEFAULT_CONFIG.judgeModel}`);
	console.log(`Spec evals: ${DEFAULT_CONFIG.specEvalsPath}\n`);

	const run = await runLLMDXEval(DEFAULT_CONFIG);

	printSummary(run);

	const outputPath = join(import.meta.dirname, "..", "results", `${run.run_id}.json`);
	await writeResults(run, outputPath);
}

main().catch((err) => {
	console.error("Eval failed:", err);
	process.exit(1);
});
