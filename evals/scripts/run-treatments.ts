#!/usr/bin/env tsx

/**
 * 4-treatment harness experiment driver.
 *
 * Runs the `harnessLoop` against a fixed synthetic intake batch under
 * each treatment configuration and prints a comparison table. Probes
 * which combination of (LLM shells / actuator+overlay / autoSolidify /
 * refineExecutor) gives the strongest closed-loop signal on the
 * dogfood catalog-automation problem.
 *
 * **Why in-process.** The script runs each treatment with a dry-run
 * mock adapter so there is no LLM spend; the goal is to exercise the
 * harness wiring deltas, not to score real LLM output. Real-budget
 * runs (when we want to compare actual judge scores per treatment)
 * are a follow-on that wires this script's same treatment definitions
 * against `createAdapter` from `run-harness.ts`.
 *
 * **Treatments (current).**
 *  - **A baseline**            — pluggable EXECUTE/VERIFY left as the
 *    default LLM `promptNode` shells. No catalog actuation.
 *  - **B actuator**            — `actuatorExecutor` writes a
 *    `CatalogPatch` to a reactive `catalogOverlay`; `evalVerifier` +
 *    `catalogAwareEvaluator` re-score against the post-actuation
 *    overlay. No durable promotion.
 *  - **C actuator+solidify**   — same as (B) plus `autoSolidify`
 *    promoting verified passes into a `learned-` namespace inside the
 *    same overlay.
 *
 * Treatment D (refineExecutor + actuator chain) is held for follow-up:
 * `refineExecutor` and `actuatorExecutor` are mutually exclusive in
 * the EXECUTE slot, so D needs a small composition layer (either a
 * `refineExecutor` whose strategy generates `CatalogPatch` candidates,
 * or an actuator that consumes refine output as its `apply` input)
 * before it's runnable.
 *
 * ## How to run
 *
 * ```bash
 * pnpm tsx evals/scripts/run-treatments.ts
 * pnpm tsx evals/scripts/run-treatments.ts --items 12  # widen synthetic batch
 * ```
 *
 * @module
 */

import { DATA } from "../../packages/legacy-pure-ts/src/core/messages.js";
import type { Node } from "../../packages/legacy-pure-ts/src/core/node.js";
import {
	actuatorExecutor,
	autoSolidify,
	evalVerifier,
	type HarnessExecutor,
	type HarnessVerifier,
} from "../../packages/legacy-pure-ts/src/patterns/harness/index.js";
import { harnessLoop } from "../../packages/legacy-pure-ts/src/patterns/harness/loop.js";
import type {
	IntakeItem,
	TriagedItem,
	VerifyResult,
} from "../../packages/legacy-pure-ts/src/patterns/harness/types.js";
import { catalogAwareEvaluator } from "../lib/catalog-aware-evaluator.js";
import {
	type CatalogOverlayBundle,
	type CatalogPatch,
	catalogOverlay,
} from "../lib/catalog-overlay.js";
import { portableCatalog } from "../lib/portable-catalog.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function pickArg(flag: string, fallback: number): number {
	const ix = args.indexOf(flag);
	if (ix === -1 || ix + 1 >= args.length) return fallback;
	const n = Number(args[ix + 1]);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}
const itemCount = pickArg("--items", 8);

// ---------------------------------------------------------------------------
// Synthetic intake batch — exercises catalog-fn / template / docs paths
// ---------------------------------------------------------------------------

const INTAKE_TEMPLATES: ReadonlyArray<Omit<IntakeItem, "$reingestions">> = [
	{
		source: "eval",
		summary: "missing fn for resilient-fetch retry shape",
		evidence: "Treatment A run-7 task t3 failed: no fn matched resilient-fetch pattern",
		affectsAreas: ["catalog"],
		affectsEvalTasks: ["t3"],
		severity: "high",
	},
	{
		source: "eval",
		summary: "schema gap: budgetGate config missing tokensPerMinute",
		evidence: "validateSpec rejected budgetGate with unknown field",
		affectsAreas: ["catalog"],
		affectsEvalTasks: ["t1"],
		severity: "medium",
	},
	{
		source: "human",
		summary: "doc unclear about distill score function input",
		evidence: "engineer asked in chat — fn description missing",
		affectsAreas: ["docs"],
		affectsEvalTasks: ["t9"],
		severity: "low",
	},
	{
		source: "test",
		summary: "missing fn: adaptive poller pattern",
		evidence: "Treatment A run-7 task t4 expected pattern not found",
		affectsAreas: ["catalog"],
		affectsEvalTasks: ["t4"],
		severity: "high",
	},
	{
		source: "eval",
		summary: "template needed for circuit-breaker compose",
		evidence: "two evals failed without a circuit-breaker template",
		affectsAreas: ["templates"],
		affectsEvalTasks: ["t6", "t7"],
		severity: "medium",
	},
	{
		source: "test",
		summary: "missing fn for fan-in scoring",
		evidence: "GraphSpec.fns lookup failed for `scoreFanIn`",
		affectsAreas: ["catalog"],
		affectsEvalTasks: ["t11"],
		severity: "high",
	},
	{
		source: "human",
		summary: "investigate: suspected race in retry catalog application",
		evidence: "intermittent test fail — needs investigation",
		affectsAreas: ["resilience"],
		severity: "medium",
	},
	{
		source: "eval",
		summary: "missing fn for prompt-cache lookup",
		evidence: "no fn matched prompt-cache; fell back to passthrough",
		affectsAreas: ["catalog"],
		affectsEvalTasks: ["t12"],
		severity: "high",
	},
];

function buildIntake(n: number): readonly IntakeItem[] {
	const items: IntakeItem[] = [];
	for (let i = 0; i < n; i++) {
		items.push({ ...INTAKE_TEMPLATES[i % INTAKE_TEMPLATES.length] });
	}
	return items;
}

// ---------------------------------------------------------------------------
// Mock LLM adapter — keyword-routed JSON for triage / execute / verify
// ---------------------------------------------------------------------------

function mockAdapter() {
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
				if (text.includes("missing fn") || text.includes("schema gap")) {
					rootCause = "missing-fn";
					intervention = "catalog-fn";
					route = "auto-fix";
				} else if (text.includes("template needed")) {
					rootCause = "composition";
					intervention = "template";
					route = "auto-fix";
				} else if (text.includes("doc")) {
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
						triageReasoning: "[treatment-driver] keyword route",
					}),
				});
			}
			if (text.includes("triaged issue")) {
				return Promise.resolve({
					content: JSON.stringify({
						outcome: "success",
						detail: "[treatment-driver] LLM-shell pretend success",
					}),
				});
			}
			if (text.includes("verify") || text.includes("execution")) {
				return Promise.resolve({
					content: JSON.stringify({
						verified: true,
						findings: ["[treatment-driver] LLM-shell pretend pass"],
					}),
				});
			}
			return Promise.resolve({ content: "{}" });
		},
	};
}

// ---------------------------------------------------------------------------
// Treatment configurations
// ---------------------------------------------------------------------------

interface TreatmentConfig {
	readonly id: string;
	readonly description: string;
	readonly actuate: boolean;
	readonly solidify: boolean;
}

const TREATMENTS: readonly TreatmentConfig[] = [
	{
		id: "A-baseline",
		description: "Default LLM shells in EXECUTE/VERIFY. No catalog actuation.",
		actuate: false,
		solidify: false,
	},
	{
		id: "B-actuator",
		description: "actuatorExecutor + catalogOverlay + catalogAwareEvaluator. No solidify.",
		actuate: true,
		solidify: false,
	},
	{
		id: "C-actuator+solidify",
		description: "Same as B plus autoSolidify promoting verified passes.",
		actuate: true,
		solidify: true,
	},
];

// ---------------------------------------------------------------------------
// Treatment runner
// ---------------------------------------------------------------------------

interface TreatmentMetrics {
	readonly id: string;
	readonly intakeCount: number;
	readonly triagedCount: number;
	readonly verifiedTotal: number;
	readonly verifiedPass: number;
	readonly verifiedFail: number;
	readonly patchesApplied: number;
	readonly solidifiedCount: number;
	readonly durationMs: number;
}

function slugify(s: string): string {
	return (
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "anon"
	);
}

function reusableFactory() {
	const seed = portableCatalog.fns?.filterBy;
	if (seed == null) throw new Error("portableCatalog.fns.filterBy missing — base catalog drift");
	return typeof seed === "function" ? seed : seed.factory;
}

function patchFromItem(item: TriagedItem): CatalogPatch | null {
	if (item.intervention === "catalog-fn") {
		return {
			kind: "fn-upsert",
			name: `t-${slugify(item.summary)}`,
			entry: {
				factory: reusableFactory(),
				description: `Treatment-driver entry: ${item.summary.slice(0, 100)}`,
				tags: ["treatment-driver", item.rootCause],
			},
		};
	}
	if (item.intervention === "template") {
		return {
			kind: "template-upsert",
			name: `t-tpl-${slugify(item.summary)}`,
			template: { params: [], nodes: {}, output: "noop" },
		};
	}
	return null;
}

interface ActuationStack {
	readonly executor: HarnessExecutor<CatalogPatch>;
	readonly verifier: HarnessVerifier<CatalogPatch>;
	readonly overlay: CatalogOverlayBundle;
	readonly patchedCount: () => number;
}

function buildActuationStack(): ActuationStack {
	const overlay = catalogOverlay({ base: portableCatalog });
	let patchCount = 0;
	const executor = actuatorExecutor<CatalogPatch>({
		name: "treatment-actuate",
		shouldApply: (item) => patchFromItem(item) != null,
		apply(item) {
			const patch = patchFromItem(item);
			if (patch == null) {
				throw new Error(`patchFromItem returned null for ${item.intervention}`);
			}
			patchCount++;
			return overlay.applyPatch(patch);
		},
	});
	const evaluator = catalogAwareEvaluator<CatalogPatch>({
		overlay,
		name: "treatment-eval",
		async runEvalSuite({ catalog, candidates, dataset }) {
			return dataset.map((row) => {
				const patch = candidates[0];
				const present = patch?.kind === "fn-upsert" && catalog.fns?.[patch.name] != null;
				return { taskId: row.id, score: present ? 1 : 0 };
			});
		},
	});
	const verifier = evalVerifier<CatalogPatch>({
		name: "treatment-verify",
		evaluator,
		datasetFor: (item) => (item.affectsEvalTasks ?? []).map((id) => ({ id })),
		threshold: 1.0,
	});
	return { executor, verifier, overlay, patchedCount: () => patchCount };
}

async function runTreatment(
	cfg: TreatmentConfig,
	intake: readonly IntakeItem[],
): Promise<TreatmentMetrics> {
	const t0 = performance.now();
	const adapter = mockAdapter();
	const stack = cfg.actuate ? buildActuationStack() : null;

	const harness = harnessLoop<CatalogPatch>(`treatment-${cfg.id}`, {
		adapter,
		maxRetries: 1,
		maxReingestions: 0,
		executor: stack?.executor,
		verifier: stack?.verifier,
	});

	const triaged: TriagedItem[] = [];
	const verified: VerifyResult<CatalogPatch>[] = [];
	const solidified: CatalogPatch[] = [];

	for (const [, topic] of harness.queueTopics) {
		topic.latest.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && m[1] != null) triaged.push(m[1] as TriagedItem);
			}
		});
	}
	harness.verifyResults.latest.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA && m[1] != null) verified.push(m[1] as VerifyResult<CatalogPatch>);
		}
	});

	let solidifyDispose: (() => void) | null = null;
	if (cfg.solidify && stack) {
		const node = autoSolidify<CatalogPatch>({
			verifyResults: harness.verifyResults.latest as Node<VerifyResult<CatalogPatch> | null>,
			predicate: (vr) => vr.item.intervention === "catalog-fn",
			write: (patch) => {
				if (patch.kind === "fn-upsert") {
					stack.overlay.upsertFn(`learned-${patch.name}`, patch.entry);
				}
			},
		});
		solidifyDispose = node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && m[1] != null) solidified.push(m[1] as CatalogPatch);
			}
		});
	}

	for (const item of intake) {
		harness.intake.publish(item);
	}
	// Settlement window outside the reactive layer — script-level, §5.10
	// runner exemption.
	await new Promise((r) => setTimeout(r, 250));

	const metrics: TreatmentMetrics = {
		id: cfg.id,
		intakeCount: intake.length,
		triagedCount: triaged.length,
		verifiedTotal: verified.length,
		verifiedPass: verified.filter((v) => v.verified).length,
		verifiedFail: verified.filter((v) => !v.verified).length,
		patchesApplied: stack?.patchedCount() ?? 0,
		solidifiedCount: solidified.length,
		durationMs: Math.round(performance.now() - t0),
	};

	solidifyDispose?.();
	stack?.overlay.dispose();
	harness.destroy();
	return metrics;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
	return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printTable(rows: readonly TreatmentMetrics[]): void {
	const headers = [
		"Treatment",
		"Intake",
		"Triaged",
		"Verified",
		"Pass",
		"Fail",
		"Patches",
		"Solidified",
		"Time (ms)",
	];
	const colWidths = headers.map((h) => h.length);
	const cells = rows.map((r) => [
		r.id,
		String(r.intakeCount),
		String(r.triagedCount),
		String(r.verifiedTotal),
		String(r.verifiedPass),
		String(r.verifiedFail),
		String(r.patchesApplied),
		String(r.solidifiedCount),
		String(r.durationMs),
	]);
	for (const row of cells) {
		for (let i = 0; i < row.length; i++) {
			if (row[i].length > colWidths[i]) colWidths[i] = row[i].length;
		}
	}
	const sep = colWidths.map((w) => "─".repeat(w)).join("─┼─");
	const head = headers.map((h, i) => pad(h, colWidths[i])).join(" │ ");
	console.log(head);
	console.log(sep);
	for (const row of cells) {
		console.log(row.map((c, i) => pad(c, colWidths[i])).join(" │ "));
	}
}

function describeTreatments(): void {
	console.log("\nTreatments:");
	for (const t of TREATMENTS) {
		console.log(`  ${t.id}: ${t.description}`);
	}
	console.log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	console.log(`=== Harness Treatment Runner ===`);
	console.log(`Synthetic intake size: ${itemCount}`);
	describeTreatments();

	const intake = buildIntake(itemCount);
	const results: TreatmentMetrics[] = [];
	for (const cfg of TREATMENTS) {
		console.log(`Running ${cfg.id} ...`);
		const metrics = await runTreatment(cfg, intake);
		results.push(metrics);
	}

	console.log("");
	printTable(results);

	// Pairwise commentary — what each treatment delta tells us.
	console.log("\nPairwise deltas:");
	for (let i = 1; i < results.length; i++) {
		const prev = results[i - 1];
		const cur = results[i];
		const dPatches = cur.patchesApplied - prev.patchesApplied;
		const dPass = cur.verifiedPass - prev.verifiedPass;
		const dSolidified = cur.solidifiedCount - prev.solidifiedCount;
		console.log(
			`  ${prev.id} → ${cur.id}: Δpatches=${signed(dPatches)}, Δpass=${signed(dPass)}, Δsolidified=${signed(dSolidified)}`,
		);
	}

	console.log("\nDone.");
}

function signed(n: number): string {
	return n > 0 ? `+${n}` : String(n);
}

main().catch((err) => {
	console.error("Treatment runner failed:", err);
	process.exit(1);
});
