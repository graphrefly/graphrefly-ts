#!/usr/bin/env tsx
/**
 * Multi-model matrix runner — runs L0+L1 across configured model list.
 *
 * Usage: pnpm eval:matrix
 *
 * Env:
 *   EVAL_MODELS — comma-separated model list
 *     e.g. "claude-sonnet-4-6,gpt-4o-mini,gemini-2.5-flash,gemma4:27b"
 *   EVAL_PROVIDERS — comma-separated provider per model (same order)
 *     e.g. "anthropic,openai,google,ollama"
 *   Falls back to DEFAULT_CONFIG if EVAL_MODELS is not set.
 */

import { join } from "node:path";
import { runContrastiveEval } from "../lib/contrastive.js";
import { printSummary, writeResults } from "../lib/reporter.js";
import { runComprehensionEval, runLLMDXEval } from "../lib/runner.js";
import type { ProviderName } from "../lib/types.js";
import { DEFAULT_CONFIG, type EvalConfig, normalizeProviderName } from "../lib/types.js";

interface ModelEntry {
	model: string;
	provider: ProviderName;
}

function parseModels(): ModelEntry[] {
	const modelsEnv = process.env.EVAL_MODELS;
	const providersEnv = process.env.EVAL_PROVIDERS;

	if (!modelsEnv) {
		return [{ model: DEFAULT_CONFIG.model, provider: DEFAULT_CONFIG.provider }];
	}

	const models = modelsEnv.split(",").map((s) => s.trim());
	const providers = providersEnv
		? providersEnv.split(",").map((s) => normalizeProviderName(s) as ProviderName)
		: models.map(() => DEFAULT_CONFIG.provider);

	if (providers.length !== models.length) {
		console.error(
			`EVAL_PROVIDERS length (${providers.length}) must match EVAL_MODELS (${models.length})`,
		);
		process.exit(1);
	}

	return models.map((model, i) => ({ model, provider: providers[i] }));
}

async function main() {
	const entries = parseModels();

	console.log("=== Multi-Model Matrix Eval ===\n");
	console.log(`Models: ${entries.map((e) => `${e.model} (${e.provider})`).join(", ")}\n`);

	const resultsDir = join(import.meta.dirname, "..", "results");

	for (const entry of entries) {
		const config: EvalConfig = {
			...DEFAULT_CONFIG,
			model: entry.model,
			provider: entry.provider,
		};

		console.log(`\n--- ${entry.model} (${entry.provider}) ---\n`);

		// L0: Contrastive
		console.log("  L0: Contrastive");
		try {
			const l0 = await runContrastiveEval(config);
			printSummary(l0);
			await writeResults(l0, join(resultsDir, `${l0.run_id}.json`));
		} catch (err) {
			console.error(`  L0 failed for ${entry.model}:`, err instanceof Error ? err.message : err);
		}

		// L1 Generation
		console.log("  L1: Generation");
		try {
			const l1gen = await runLLMDXEval(config);
			printSummary(l1gen);
			await writeResults(l1gen, join(resultsDir, `${l1gen.run_id}.json`));
		} catch (err) {
			console.error(
				`  L1-gen failed for ${entry.model}:`,
				err instanceof Error ? err.message : err,
			);
		}

		// L1 Comprehension
		console.log("  L1: Comprehension");
		try {
			const l1comp = await runComprehensionEval(config);
			printSummary(l1comp);
			await writeResults(l1comp, join(resultsDir, `${l1comp.run_id}.json`));
		} catch (err) {
			console.error(
				`  L1-comp failed for ${entry.model}:`,
				err instanceof Error ? err.message : err,
			);
		}
	}

	console.log("\nMatrix eval complete.");
}

main().catch((err) => {
	console.error("Matrix eval failed:", err);
	process.exit(1);
});
