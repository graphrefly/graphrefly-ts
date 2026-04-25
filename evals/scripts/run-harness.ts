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
 *
 * # Closed-loop actuation: EXECUTE writes to a reactive catalog overlay,
 * # VERIFY re-scores against the post-actuation overlay, and autoSolidify
 * # promotes verified passes into a "learned-" namespace. This dogfoods
 * # the actuatorExecutor + catalogOverlay + autoSolidify primitives.
 * pnpm eval:harness -- --actuate --dry-run
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
import { fileStorage } from "../../src/extra/storage-node.js";
import type { GraphPersistSnapshot } from "../../src/graph/graph.js";
import { agentMemory } from "../../src/patterns/ai/index.js";
import { type EvalResult, evalIntakeBridge } from "../../src/patterns/harness/bridge.js";
import {
	actuatorExecutor,
	autoSolidify,
	evalVerifier,
	type HarnessExecutor,
	type HarnessVerifier,
} from "../../src/patterns/harness/index.js";
import { harnessLoop } from "../../src/patterns/harness/loop.js";
import type { TriagedItem, VerifyResult } from "../../src/patterns/harness/types.js";
import { catalogAwareEvaluator } from "../lib/catalog-aware-evaluator.js";
import {
	type CatalogOverlayBundle,
	type CatalogPatch,
	catalogOverlay,
} from "../lib/catalog-overlay.js";
import { portableCatalog } from "../lib/portable-catalog.js";
import type { EvalRun, ProviderName } from "../lib/types.js";
import { DEFAULT_CONFIG, type EvalConfig } from "../lib/types.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const interactive = args.includes("--interactive");
const actuate = args.includes("--actuate");
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
			const { createSafeProvider } = await import("../lib/llm-client.js");
			const provider = createSafeProvider(config);
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
// Actuation stack (--actuate)
// ---------------------------------------------------------------------------

interface ActuationStack {
	overlay: CatalogOverlayBundle;
	executor: HarnessExecutor<CatalogPatch>;
	verifier: HarnessVerifier<CatalogPatch>;
	patchedCount: () => number;
}

/**
 * Slug a free-form summary into a fn-name-safe identifier. Lowercases
 * letters/digits, collapses other runs into single dashes, trims to 60
 * chars to keep generated names readable in `describe()`.
 */
function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

/**
 * Maps a triaged item into a `CatalogPatch`. The dogfood implementation
 * is intentionally a placeholder factory — the real codegen lives in the
 * treatment runner. The point here is to prove the closed-loop topology:
 * actuator writes → overlay updates → verifier re-scores → autoSolidify
 * promotes if verified.
 */
/**
 * Reuse the pass-through `filterBy` factory from the portable catalog so
 * the actuator's generated entries are runnable in `compileSpec`. The
 * point of this script is to prove the actuator wires; real codegen for
 * a useful factory belongs in the treatment runner.
 */
function reusableFactory() {
	const seed = portableCatalog.fns?.filterBy;
	if (seed == null) throw new Error("portableCatalog.fns.filterBy missing — base catalog drift");
	return typeof seed === "function" ? seed : seed.factory;
}

function patchFromItem(item: TriagedItem): CatalogPatch | null {
	if (item.intervention === "catalog-fn") {
		const slug = slugify(item.summary) || "anon";
		return {
			kind: "fn-upsert",
			name: `actuator-${slug}`,
			entry: {
				factory: reusableFactory(),
				description: `Actuator-generated entry for: ${item.summary.slice(0, 100)}`,
				tags: ["actuator", item.rootCause],
			},
		};
	}
	if (item.intervention === "template") {
		const slug = slugify(item.summary) || "anon";
		return {
			kind: "template-upsert",
			name: `actuator-tpl-${slug}`,
			template: { params: [], nodes: {}, output: "noop" },
		};
	}
	return null;
}

/**
 * Build the actuator + overlay + verifier triple for `--actuate` mode.
 *
 * The `runEvalSuite` here is a placeholder that scores 1 if the
 * candidate patch's name appears in the live overlay catalog (i.e. the
 * actuator successfully wrote it), else 0. This exercises the
 * actuator → overlay → verifier dataflow end-to-end without committing
 * to a full eval pipeline (that's the treatment-runner's scope).
 */
function buildActuationStack(): ActuationStack {
	const overlay = catalogOverlay({ base: portableCatalog });
	let patchCount = 0;
	const executor = actuatorExecutor<CatalogPatch>({
		name: "actuate-exec",
		shouldApply: (item) => patchFromItem(item) != null,
		apply(item) {
			const patch = patchFromItem(item);
			if (patch == null) {
				throw new Error(
					`patchFromItem returned null for intervention ${item.intervention} — shouldApply gate should have skipped this`,
				);
			}
			patchCount++;
			return overlay.applyPatch(patch);
		},
	});
	const evaluator = catalogAwareEvaluator<CatalogPatch>({
		overlay,
		name: "actuate-eval",
		async runEvalSuite({ catalog, candidates, dataset }) {
			// Placeholder closed-loop check: did the actuator's patch land in
			// the overlay? If yes, every dataset row scores 1; if no, 0.
			return dataset.map((row) => {
				const patch = candidates[0];
				let present = false;
				if (patch?.kind === "fn-upsert") {
					present = catalog.fns?.[patch.name] != null;
				} else if (patch?.kind === "template-upsert") {
					// Templates aren't surfaced in the catalog return shape;
					// presence-checking here would require the overlay API
					// directly, so we score 0 to keep the failure path observable.
					present = false;
				}
				return { taskId: row.id, score: present ? 1 : 0 };
			});
		},
	});
	const verifier = evalVerifier<CatalogPatch>({
		name: "actuate-verify",
		evaluator,
		datasetFor: (item) => (item.affectsEvalTasks ?? []).map((id) => ({ id })),
		threshold: 1.0,
	});
	return {
		overlay,
		executor,
		verifier,
		patchedCount: () => patchCount,
	};
}

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

	// --- Optional actuation stack (--actuate flag) ---
	// When enabled, EXECUTE writes to a reactive `catalogOverlay` instead of
	// asking an LLM to opine; VERIFY re-scores against the post-actuation
	// catalog state via `catalogAwareEvaluator`; `autoSolidify` watches
	// `verifyResults` and promotes verified passes into a separate "learned"
	// fn-overlay slot (kept distinct from the working overlay so the dogfood
	// can inspect what the loop chose to durably learn).
	const actuationStack = actuate ? buildActuationStack() : null;

	const harness = harnessLoop<CatalogPatch>("eval-dogfood", {
		adapter,
		maxRetries: 1,
		maxReingestions: 0,
		executor: actuationStack?.executor,
		verifier: actuationStack?.verifier,
	});

	// Wire autoSolidify after harness so it sees verifyResults.
	const solidified: CatalogPatch[] = [];
	let solidifyDispose: (() => void) | null = null;
	if (actuationStack) {
		const solidifyNode = autoSolidify<CatalogPatch>({
			verifyResults: harness.verifyResults.latest as Node<VerifyResult<CatalogPatch> | null>,
			predicate: (vr) => vr.item.intervention === "catalog-fn",
			write: (patch) => {
				// Re-apply the patch under a `learned-` namespace so it's
				// distinguishable from the working overlay state.
				if (patch.kind === "fn-upsert") {
					actuationStack.overlay.upsertFn(`learned-${patch.name}`, patch.entry);
				} else if (patch.kind === "template-upsert") {
					actuationStack.overlay.upsertTemplate(`learned-${patch.name}`, patch.template);
				}
			},
		});
		solidifyDispose = solidifyNode.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && m[1] != null) solidified.push(m[1] as CatalogPatch);
			}
		});
	}

	// --- Wire eval bridge ---
	const evalSource = state<EvalResult | null>(null);
	const bridge = evalIntakeBridge(evalSource as Node<EvalResult | EvalResult[]>, harness.intake);
	bridge.subscribe(() => {}); // keepalive

	// --- Retrospective memory ---
	// Wire agentMemory to verifyResults with FileCheckpointAdapter for persistence.
	// extractFn is pure (no LLM) — VerifyResult is already structured.
	const retrospectiveDir = join(resultsDir, "harness-retrospective");
	const retrospectiveTier = fileStorage(retrospectiveDir);

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
	const raw = retrospectiveTier.load("retrospective") as GraphPersistSnapshot | null;
	if (raw != null) {
		memory.restore(raw);
		console.log("Loaded previous retrospective from disk.\n");
	}

	// --- Collectors ---
	const triaged: TriagedItem[] = [];
	const verified: VerifyResult[] = [];
	// Per-treatment tracking (script-level, not in IntakeItem)
	const treatmentItems = new Map<string, TriagedItem[]>();

	for (const [, topic] of harness.queueTopics) {
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

	// --- Actuation stats (--actuate) ---
	if (actuationStack) {
		console.log(`\n${"─".repeat(40)}`);
		console.log("Actuation stats");
		console.log(`${"─".repeat(40)}`);
		console.log(`  Patches applied:    ${actuationStack.patchedCount()}`);
		console.log(`  Solidified entries: ${solidified.length}`);
		if (solidified.length > 0) {
			for (const p of solidified) {
				const label = p.kind.startsWith("fn-")
					? "fn"
					: p.kind.startsWith("template-")
						? "tpl"
						: "src";
				console.log(`    [${label}] ${"name" in p ? p.name : "?"} (${p.kind})`);
			}
		}
	}

	// --- Persist retrospective ---
	retrospectiveTier.save("retrospective", memory.snapshot());
	const memSize = memory.size.get() ?? 0;
	console.log(`\nRetrospective: ${memSize} learnings persisted to ${retrospectiveDir}`);

	console.log("\nDone.");
	// Tear down in dependency order: solidify subscription → harness graph
	// (releases all internal subscriptions / disposers / strategy-model
	// keepalives) → overlay (releases reactiveMap entries node). Without
	// `harness.destroy()` the script would `process.exit(0)` with the
	// graph still live — pending async `runEvalSuite` Promises would
	// cancel mid-flight and any disk-backed storage adapters could be
	// truncated. Mirrors the per-treatment teardown in `run-treatments.ts`.
	if (solidifyDispose) solidifyDispose();
	harness.destroy();
	if (actuationStack) actuationStack.overlay.dispose();
	process.exit(0);
}

main().catch((err) => {
	console.error("Harness dogfood failed:", err);
	process.exit(1);
});
