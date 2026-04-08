#!/usr/bin/env tsx

/**
 * Dogfood: wire eval results through the reactive collaboration harness loop.
 *
 * Reads eval result JSONs from evals/results/, feeds them through
 * evalIntakeBridge → harnessLoop, and reports findings. Supports
 * treatment-grouped analysis, interactive gate steering, and
 * persistent retrospective memory via FileCheckpointAdapter.
 *
 * ## How to run
 *
 * ```bash
 * # Process all eval results (dry-run, no API key needed)
 * pnpm eval:harness -- --dry-run
 *
 * # Process with real LLM for triage/execute/verify
 * pnpm eval:harness
 *
 * # Interactive mode — pause at gates for human steering
 * pnpm eval:harness -- --interactive --dry-run
 *
 * # Filter to specific result files
 * pnpm eval:harness -- --file l0-conversational --dry-run
 *
 * # Map eval runs to treatments for comparative analysis
 * #   Format: --treatment <run_id_substring>=<label>
 * pnpm eval:harness -- --dry-run \
 *   --treatment batch1=baseline \
 *   --treatment batch2=auto-gen
 * ```
 *
 * ## Env vars
 *
 *   EVAL_PROVIDER / EVAL_MODEL — LLM for triage/execute/verify stages
 *   (defaults to claude-sonnet-4-6 via DEFAULT_CONFIG)
 *
 * ## Retrospective persistence
 *
 * The script persists an agentMemory retrospective to
 * `evals/results/harness-retrospective/` via FileCheckpointAdapter.
 * Each run appends learnings (which rootCause→intervention combos
 * worked, which failed). Next run auto-loads previous context.
 *
 * @module
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { DATA } from "../../src/core/messages.js";
import type { Node } from "../../src/core/node.js";
import { state } from "../../src/core/sugar.js";
import {
	FileCheckpointAdapter,
	restoreGraphCheckpoint,
	saveGraphCheckpoint,
} from "../../src/extra/checkpoint.js";
import { agentMemory } from "../../src/patterns/ai.js";
import { type EvalResult, evalIntakeBridge } from "../../src/patterns/harness/bridge.js";
import { harnessLoop } from "../../src/patterns/harness/loop.js";
import type { TriagedItem, VerifyResult } from "../../src/patterns/harness/types.js";
import type { EvalRun, ProviderName } from "../lib/types.js";
import { DEFAULT_CONFIG, type EvalConfig } from "../lib/types.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const interactive = args.includes("--interactive");
const filePattern = (() => {
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--file" && i + 1 < args.length) return args[i + 1];
	}
	return undefined;
})();

/** Parse --treatment <substring>=<label> pairs from CLI args. */
function parseTreatmentMap(): Map<string, string> {
	const map = new Map<string, string>();
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--treatment" && i + 1 < args.length) {
			const val = args[i + 1];
			const eq = val.indexOf("=");
			if (eq > 0) {
				map.set(val.slice(0, eq), val.slice(eq + 1));
			} else if (eq === -1) {
				console.warn(
					`Warning: --treatment "${val}" missing "=" separator (expected key=label), skipping`,
				);
			}
		}
	}
	return map;
}

const treatmentMap = parseTreatmentMap();

// ---------------------------------------------------------------------------
// LLM adapter (real or mock)
// ---------------------------------------------------------------------------

function createAdapter(config: EvalConfig) {
	if (dryRun) {
		return {
			invoke: (msgs: Array<{ role: string; content: string }>) => {
				const text = msgs
					.map((m) => m.content)
					.join(" ")
					.toLowerCase();

				if (text.includes("triage") || text.includes("intake item")) {
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
// Treatment resolver — maps run_id to treatment label
// ---------------------------------------------------------------------------

function resolveTreatment(runId: string): string | undefined {
	for (const [substring, label] of treatmentMap) {
		if (runId.includes(substring)) return label;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Retrospective memory types
// ---------------------------------------------------------------------------

type RetrospectiveLearning = {
	rootCause: string;
	intervention: string;
	success: boolean;
	taskIds: string[];
	finding: string;
};

// ---------------------------------------------------------------------------
// Interactive gate steering
// ---------------------------------------------------------------------------

async function steerGates(harness: ReturnType<typeof harnessLoop>): Promise<void> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	try {
		for (const [route, gateCtrl] of harness.gates) {
			const pending = gateCtrl.pending.get() ?? [];
			if (pending.length === 0) continue;

			console.log(`\n--- Gate: ${route} (${pending.length} pending) ---`);
			for (let i = 0; i < pending.length; i++) {
				const item = pending[i] as TriagedItem;
				console.log(
					`  [${i}] ${item.summary}\n` +
						`      rootCause: ${item.rootCause}, intervention: ${item.intervention}`,
				);
			}

			const action = await rl.question(
				"\n  Action? (a)pprove all, (r)eject all, (m)odify, (s)kip: ",
			);

			switch (action.trim().toLowerCase()) {
				case "a":
					gateCtrl.approve(pending.length);
					console.log(`  → Approved ${pending.length} items`);
					break;
				case "r":
					gateCtrl.reject(pending.length);
					console.log(`  → Rejected ${pending.length} items`);
					break;
				case "m": {
					const rcInput = await rl.question("  Override rootCause (or enter to keep): ");
					const intInput = await rl.question("  Override intervention (or enter to keep): ");
					gateCtrl.modify(
						(item: TriagedItem) => ({
							...item,
							...(rcInput.trim() ? { rootCause: rcInput.trim() } : {}),
							...(intInput.trim() ? { intervention: intInput.trim() } : {}),
						}),
						pending.length,
					);
					console.log(`  → Modified and forwarded ${pending.length} items`);
					break;
				}
				default:
					console.log(`  → Skipped`);
					break;
			}
		}
	} finally {
		rl.close();
	}
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
	if (treatmentMap.size > 0) {
		console.log(
			`Treatments: ${[...treatmentMap.entries()].map(([k, v]) => `${k}→${v}`).join(", ")}`,
		);
	}
	if (interactive) console.log("Interactive mode: will pause at gates for steering");
	console.log(
		`Harness LLM: ${dryRun ? "mock (offline)" : `${config.model} (${config.provider})`}\n`,
	);

	// --- Create harness ---
	const adapter = createAdapter(config);
	const harness = harnessLoop("eval-dogfood", {
		adapter,
		maxRetries: 1,
		maxReingestions: 0,
	});

	// --- Wire eval bridge ---
	const evalSource = state<EvalResult | null>(null);
	const bridge = evalIntakeBridge(evalSource as Node<EvalResult | EvalResult[]>, harness.intake);
	bridge.subscribe(() => {}); // keepalive

	// --- Retrospective memory ---
	// Wire agentMemory to verifyResults with FileCheckpointAdapter for persistence.
	// extractFn is pure (no LLM) — VerifyResult is already structured.
	const retrospectiveDir = join(resultsDir, "harness-retrospective");
	const checkpointAdapter = new FileCheckpointAdapter(retrospectiveDir);

	const memory = agentMemory<RetrospectiveLearning>("retrospective", harness.verifyResults.latest, {
		extractFn: (raw: unknown) => {
			// distill passes the unwrapped node value (a single VerifyResult), not messages.
			const vr = raw as VerifyResult | undefined;
			if (vr == null || !vr.item) return { upsert: [] };
			const key = `${vr.item.rootCause}→${vr.item.intervention}:${vr.item.summary.slice(0, 40)}`;
			return {
				upsert: [
					{
						key,
						value: {
							rootCause: vr.item.rootCause,
							intervention: vr.item.intervention,
							success: vr.verified,
							taskIds: vr.item.affectsEvalTasks ?? [],
							finding: vr.findings.join("; "),
						},
					},
				],
			};
		},
		score: () => 1, // all learnings equally weighted
		cost: () => 1, // uniform cost
	});

	// Restore previous session's retrospective.
	// Must happen after graph wiring but before any data flows — reversing the
	// order causes distill to re-extract persisted entries.
	const restored = restoreGraphCheckpoint(memory, checkpointAdapter);
	if (restored) console.log("Loaded previous retrospective from disk.\n");

	// --- Collectors ---
	const triaged: TriagedItem[] = [];
	const verified: VerifyResult[] = [];
	// Per-treatment tracking (script-level, not in IntakeItem)
	const treatmentItems = new Map<string, TriagedItem[]>();

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
		const treatment = resolveTreatment(run.run_id);
		const failingTasks = adapted.tasks.filter(
			(t) => !t.valid || t.judge_scores?.some((s) => !s.pass),
		);
		const label = treatment ? ` [${treatment}]` : "";
		console.log(`  ${run.run_id}${label}: ${failingTasks.length} failing criteria`);

		// Track triaged count before feeding so we can tag new items to this treatment
		const triagedBefore = triaged.length;

		evalSource.down([[DATA, adapted]]);

		// Runner script — §5.10 exemption: settlement delay outside reactive layer.
		await new Promise((r) => setTimeout(r, 200));

		// Tag new triaged items with treatment (script-level tracking)
		if (treatment) {
			const newItems = triaged.slice(triagedBefore);
			const existing = treatmentItems.get(treatment) ?? [];
			existing.push(...newItems);
			treatmentItems.set(treatment, existing);
		}
	}

	// --- Interactive gate steering ---
	if (interactive) {
		// Runner script — §5.10 exemption: settlement delay outside reactive layer.
		await new Promise((r) => setTimeout(r, 500));
		await steerGates(harness);
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

	// --- Per-treatment comparison ---
	if (treatmentItems.size > 0) {
		console.log(`\n${"─".repeat(40)}`);
		console.log("Per-treatment comparison");
		console.log(`${"─".repeat(40)}`);

		for (const [treatment, items] of treatmentItems) {
			console.log(`\n  [${treatment}] ${items.length} triaged items`);

			const causes = new Map<string, number>();
			for (const item of items) {
				const key = `${item.rootCause}→${item.intervention}`;
				causes.set(key, (causes.get(key) ?? 0) + 1);
			}
			for (const [key, count] of causes) {
				console.log(`    ${key}: ${count}`);
			}
		}

		// Pairwise chain delta: A→B, B→C, C→D
		if (treatmentItems.size >= 2) {
			const labels = [...treatmentItems.keys()];
			console.log("\n  Pairwise deltas:");
			for (let i = 0; i < labels.length - 1; i++) {
				const prev = treatmentItems.get(labels[i])!;
				const next = treatmentItems.get(labels[i + 1])!;
				const diff = prev.length - next.length;
				const sign = diff > 0 ? `-${diff}` : diff < 0 ? `+${-diff}` : "±0";
				console.log(
					`    ${labels[i]} → ${labels[i + 1]}: ${sign} failures (${prev.length} → ${next.length})`,
				);
			}
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

	// --- Persist retrospective ---
	saveGraphCheckpoint(memory, checkpointAdapter);
	const memSize = memory.size.get() ?? 0;
	console.log(`\nRetrospective: ${memSize} learnings persisted to ${retrospectiveDir}`);

	console.log("\nDone.");
	process.exit(0);
}

main().catch((err) => {
	console.error("Harness dogfood failed:", err);
	process.exit(1);
});
