#!/usr/bin/env tsx
/**
 * Dogfood: wire eval results through the reactive collaboration harness loop.
 *
 * Reads eval result JSONs from evals/results/, feeds them through
 * evalIntakeBridge → harnessLoop, and reports findings.
 *
 * Usage:
 *   pnpm eval:harness                    # process all results
 *   pnpm eval:harness -- --file l0-*.json  # specific result files
 *   pnpm eval:harness -- --dry-run        # offline mode (mock LLM)
 *
 * Env:
 *   EVAL_PROVIDER / EVAL_MODEL — LLM for triage/execute/verify stages
 *   (defaults to claude-sonnet-4-6 via DEFAULT_CONFIG)
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA } from "../../src/core/messages.js";
import type { Node } from "../../src/core/node.js";
import { state } from "../../src/core/sugar.js";
import { type EvalResult, evalIntakeBridge } from "../../src/patterns/harness/bridge.js";
import { type HarnessGraph, harnessLoop } from "../../src/patterns/harness/loop.js";
import type { IntakeItem, TriagedItem, VerifyResult } from "../../src/patterns/harness/types.js";
import type { EvalRun, ProviderName } from "../lib/types.js";
import { DEFAULT_CONFIG, type EvalConfig } from "../lib/types.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const filePattern = args.find((a) => !a.startsWith("--"));

// ---------------------------------------------------------------------------
// LLM adapter (real or mock)
// ---------------------------------------------------------------------------

function createAdapter(config: EvalConfig) {
	if (dryRun) {
		// Offline mock: deterministic triage based on keywords
		return {
			invoke: (msgs: Array<{ role: string; content: string }>) => {
				const text = msgs
					.map((m) => m.content)
					.join(" ")
					.toLowerCase();

				if (text.includes("triage") || text.includes("intake item")) {
					// Simple keyword-based triage
					let rootCause = "unknown";
					let intervention = "investigate";
					let route = "investigation";

					if (text.includes("catalog") || text.includes("missing")) {
						rootCause = "missing-fn";
						intervention = "catalog-fn";
						route = "auto-fix";
					} else if (text.includes("schema") || text.includes("spec")) {
						rootCause = "schema-gap";
						intervention = "schema-change";
						route = "needs-decision";
					} else if (text.includes("doc") || text.includes("description")) {
						rootCause = "bad-docs";
						intervention = "docs";
						route = "auto-fix";
					}

					return Promise.resolve({
						content: JSON.stringify({
							rootCause,
							intervention,
							route,
							priority: 50,
							triageReasoning: `[dry-run] keyword-based triage`,
						}),
					});
				}

				if (text.includes("implementation") || text.includes("triaged issue")) {
					return Promise.resolve({
						content: JSON.stringify({
							outcome: "partial",
							detail: "[dry-run] no real execution — requires human review",
						}),
					});
				}

				if (text.includes("qa") || text.includes("verify") || text.includes("execution")) {
					return Promise.resolve({
						content: JSON.stringify({
							verified: false,
							findings: ["[dry-run] verification skipped — manual review needed"],
							errorClass: "structural",
						}),
					});
				}

				return Promise.resolve({ content: "{}" });
			},
		};
	}

	// Real LLM adapter — bridges eval LLM client to harness adapter interface
	return {
		invoke: async (msgs: Array<{ role: string; content: string }>) => {
			const { createProvider } = await import("../lib/llm-client.js");
			const provider = createProvider(config.provider, config);
			const system = msgs
				.filter((m) => m.role === "system")
				.map((m) => m.content)
				.join("\n");
			const user = msgs
				.filter((m) => m.role === "user")
				.map((m) => m.content)
				.join("\n");
			const resp = await provider.generate({ system, user, model: config.model });
			return { content: resp.content };
		},
	};
}

// ---------------------------------------------------------------------------
// Load eval results
// ---------------------------------------------------------------------------

async function loadResults(resultsDir: string): Promise<EvalRun[]> {
	const files = await readdir(resultsDir);
	const jsonFiles = files
		.filter((f) => f.endsWith(".json"))
		.filter((f) => (filePattern ? f.includes(filePattern.replace("*", "")) : true));

	const runs: EvalRun[] = [];
	for (const file of jsonFiles) {
		try {
			const raw = await readFile(join(resultsDir, file), "utf-8");
			runs.push(JSON.parse(raw) as EvalRun);
		} catch {
			console.warn(`  Skipping ${file} (invalid JSON)`);
		}
	}
	return runs;
}

// ---------------------------------------------------------------------------
// Adapt EvalRun → EvalResult (bridge shape)
// ---------------------------------------------------------------------------

function adaptEvalRun(run: EvalRun): EvalResult {
	return {
		run_id: run.run_id,
		model: run.model,
		tasks: run.tasks.map((t) => ({
			task_id: t.task_id,
			valid: t.valid,
			judge_scores: t.judge_scores?.map((s) => ({
				claim: s.claim,
				pass: s.pass,
				reasoning: s.reasoning,
			})),
		})),
	};
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const config: EvalConfig = {
		...DEFAULT_CONFIG,
		provider: (process.env.EVAL_PROVIDER ?? DEFAULT_CONFIG.provider) as ProviderName,
		model: process.env.EVAL_MODEL ?? DEFAULT_CONFIG.model,
	};

	const resultsDir = join(import.meta.dirname, "..", "results");
	const runs = await loadResults(resultsDir);

	if (runs.length === 0) {
		console.log("No eval results found in evals/results/. Run evals first.");
		process.exit(0);
	}

	console.log(`=== Harness Loop Dogfood ${dryRun ? "(dry-run)" : ""} ===`);
	console.log(`Eval runs: ${runs.length} (${runs.map((r) => r.model).join(", ")})`);
	console.log(
		`Harness LLM: ${dryRun ? "mock (offline)" : `${config.model} (${config.provider})`}\n`,
	);

	// --- Create harness ---
	const adapter = createAdapter(config);
	const harness = harnessLoop("eval-dogfood", {
		adapter,
		maxRetries: 1,
		maxReingestions: 0, // Don't re-ingest in dogfood mode
	});

	// --- Wire eval bridge ---
	const evalSource = state<EvalResult | null>(null);
	const bridge = evalIntakeBridge(evalSource as Node<EvalResult | EvalResult[]>, harness.intake);
	bridge.subscribe(() => {}); // keepalive

	// --- Collectors ---
	const triaged: TriagedItem[] = [];
	const verified: VerifyResult[] = [];

	for (const [, topic] of harness.queues) {
		topic.latest.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && m[1] != null) triaged.push(m[1] as TriagedItem);
			}
		});
	}

	harness.verifyResults.latest.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA && m[1] != null) verified.push(m[1] as VerifyResult);
		}
	});

	// --- Feed eval results ---
	for (const run of runs) {
		const adapted = adaptEvalRun(run);
		const failingTasks = adapted.tasks.filter(
			(t) => !t.valid || t.judge_scores?.some((s) => !s.pass),
		);
		console.log(`  ${run.run_id}: ${failingTasks.length} failing criteria`);

		evalSource.down([[DATA, adapted]]);

		// Runner script — §5.10 exemption: settlement delay outside reactive layer.
		// Proper fix (reactive drain signal) deferred; timeout is a pragmatic bound.
		await new Promise((r) => setTimeout(r, 200));
	}

	// Runner script — §5.10 exemption: final settlement outside reactive layer.
	await new Promise((r) => setTimeout(r, 1000));

	// --- Report ---
	console.log(`\n${"=".repeat(60)}`);
	console.log("Harness Loop Results");
	console.log(`${"=".repeat(60)}`);

	const intake = harness.intake.retained();
	console.log(`\nIntake items: ${intake.length}`);

	console.log(`Triaged items: ${triaged.length}`);

	// Route distribution
	const routeCounts = new Map<string, number>();
	for (const item of triaged) {
		routeCounts.set(item.route, (routeCounts.get(item.route) ?? 0) + 1);
	}
	if (routeCounts.size > 0) {
		console.log("\nRoute distribution:");
		for (const [route, count] of routeCounts) {
			console.log(`  ${route}: ${count}`);
		}
	}

	// Root cause distribution
	const causeCounts = new Map<string, number>();
	for (const item of triaged) {
		causeCounts.set(item.rootCause, (causeCounts.get(item.rootCause) ?? 0) + 1);
	}
	if (causeCounts.size > 0) {
		console.log("\nRoot cause distribution:");
		for (const [cause, count] of causeCounts) {
			console.log(`  ${cause}: ${count}`);
		}
	}

	// Strategy model
	const strategyMap = harness.strategy.node.get();
	if (strategyMap.size > 0) {
		console.log("\nStrategy model (rootCause→intervention effectiveness):");
		for (const [key, entry] of strategyMap) {
			console.log(
				`  ${key}: ${entry.successes}/${entry.attempts} (${(entry.successRate * 100).toFixed(0)}%)`,
			);
		}
	}

	console.log(`\nVerified results: ${verified.length}`);
	const successCount = verified.filter((v) => v.verified).length;
	const failCount = verified.filter((v) => !v.verified).length;
	if (verified.length > 0) {
		console.log(`  Success: ${successCount}, Failed: ${failCount}`);
	}

	console.log("\nDone.");
	process.exit(0);
}

main().catch((err) => {
	console.error("Harness dogfood failed:", err);
	process.exit(1);
});
