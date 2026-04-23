/**
 * Harness wiring types (roadmap §9.0).
 *
 * Shared types for the reactive collaboration loop: intake, triage, queue,
 * gate, execute, verify, reflect. These types are intentionally domain-agnostic
 * — the harness loop is not specific to eval workflows.
 *
 * @module
 */

import type { Node } from "../../core/node.js";

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/** Sources that can produce intake items. */
export type IntakeSource = "eval" | "test" | "human" | "code-change" | "hypothesis" | "parity";

/** Severity levels for intake items. */
export type Severity = "critical" | "high" | "medium" | "low";

/** Root cause categories for triage classification. */
export type RootCause =
	| "composition"
	| "missing-fn"
	| "bad-docs"
	| "schema-gap"
	| "regression"
	| "unknown";

/** Intervention types that address root causes. */
export type Intervention =
	| "template"
	| "catalog-fn"
	| "docs"
	| "wrapper"
	| "schema-change"
	| "investigate";

/** Routing destinations after triage. */
export type QueueRoute = "auto-fix" | "needs-decision" | "investigation" | "backlog";

/** Ordered queue route names for iteration. */
export const QUEUE_NAMES: readonly QueueRoute[] = [
	"auto-fix",
	"needs-decision",
	"investigation",
	"backlog",
];

/**
 * An item entering the harness loop via the INTAKE stage.
 *
 * All intake sources produce this uniform shape — the intake topic
 * doesn't care where items came from.
 */
export interface IntakeItem {
	source: IntakeSource;
	summary: string;
	evidence: string;
	affectsAreas: string[];
	affectsEvalTasks?: string[];
	severity?: Severity;
	relatedTo?: string[];
	/** Item-carried reingestion count. Incremented on each full-loop reingestion. */
	_reingestions?: number;
}

// ---------------------------------------------------------------------------
// Triage output
// ---------------------------------------------------------------------------

/** Output of the TRIAGE stage — enriched intake item with classification. */
export interface TriagedItem extends IntakeItem {
	rootCause: RootCause;
	intervention: Intervention;
	route: QueueRoute;
	priority: number;
	triageReasoning?: string;
	/** Item-carried retry count. Incremented on each fast-retry pass. */
	_retries?: number;
}

// ---------------------------------------------------------------------------
// Strategy model
// ---------------------------------------------------------------------------

/** Effectiveness record for a rootCause→intervention pair. */
export interface StrategyEntry {
	rootCause: RootCause;
	intervention: Intervention;
	attempts: number;
	successes: number;
	successRate: number;
}

/** Key format: `${rootCause}→${intervention}`. */
export type StrategyKey = `${RootCause}→${Intervention}`;

export function strategyKey(rootCause: RootCause, intervention: Intervention): StrategyKey {
	return `${rootCause}→${intervention}`;
}

// ---------------------------------------------------------------------------
// Execution & verification
// ---------------------------------------------------------------------------

/** LLM output shape from the EXECUTE stage (partial — lacks `item`). */
export type ExecuteOutput = {
	outcome: "success" | "failure" | "partial";
	detail: string;
	/**
	 * Optional opaque artifact that a custom executor (e.g. `refineExecutor`)
	 * may attach so downstream verifiers can re-run evaluation against the
	 * thing that was produced. LLM-backed default executors never populate
	 * this — it's an escape hatch for reactive executors carrying structured
	 * output (a refined prompt, a patched spec, a generated template, ...).
	 */
	artifact?: unknown;
};

/** Full execution result assembled downstream (LLM output + context). */
export interface ExecutionResult {
	item: TriagedItem;
	outcome: "success" | "failure" | "partial";
	detail: string;
	/**
	 * Passthrough of {@link ExecuteOutput.artifact} when the executor emitted
	 * one. Reactive executors like `refineExecutor` populate this; LLM-backed
	 * default executors leave it undefined.
	 */
	artifact?: unknown;
}

/** Whether an error is self-correctable (fast-retry) or structural (full loop). */
export type ErrorClass = "self-correctable" | "structural";

/** Classifier for fast-retry path. */
export type ErrorClassifier = (result: ExecutionResult) => ErrorClass;

/** Default error classifier: parse/config errors are self-correctable. */
export function defaultErrorClassifier(result: ExecutionResult): ErrorClass {
	const d = result.detail.toLowerCase();
	if (
		d.includes("parse") ||
		d.includes("json") ||
		d.includes("config") ||
		d.includes("validation") ||
		d.includes("syntax")
	) {
		return "self-correctable";
	}
	return "structural";
}

// ---------------------------------------------------------------------------
// Verification output
// ---------------------------------------------------------------------------

/** Result of the VERIFY stage. */
export interface VerifyResult {
	item: TriagedItem;
	execution: ExecutionResult;
	verified: boolean;
	findings: string[];
	errorClass?: ErrorClass;
}

/**
 * Verifier output shape — what a custom verifier emits. The harness
 * assembles this into the full {@link VerifyResult} using the triaged
 * item + execute output sampled from `executeContextNode`.
 */
export interface VerifyOutput {
	verified: boolean;
	findings: string[];
	errorClass?: ErrorClass;
}

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

/** Configurable signals for priority scoring. */
export interface PrioritySignals {
	/** Per-severity base weight (default: critical=100, high=70, medium=40, low=10). */
	severityWeights?: Partial<Record<Severity, number>>;
	/** Decay rate per second for attention decay (default ~1.15e-6 ≈ 7-day half-life). */
	decayRate?: number;
	/** Strategy model effectiveness boost threshold (default 0.7). */
	effectivenessThreshold?: number;
	/** Strategy model effectiveness boost amount (default 15). */
	effectivenessBoost?: number;
}

/** Default severity weights. */
export const DEFAULT_SEVERITY_WEIGHTS: Record<Severity, number> = {
	critical: 100,
	high: 70,
	medium: 40,
	low: 10,
};

/** Default decay rate: ~7-day half-life. */
export const DEFAULT_DECAY_RATE = Math.LN2 / (7 * 24 * 3600);

// ---------------------------------------------------------------------------
// Harness loop configuration
// ---------------------------------------------------------------------------

/** Per-queue configuration in the harness loop. */
export interface QueueConfig {
	/** Whether this queue is gated (requires human approval). */
	gated: boolean;
	/** Maximum pending items in the gate (default Infinity). */
	maxPending?: number;
	/** Start the gate in open (auto-approve) mode? */
	startOpen?: boolean;
}

/** Default queue configurations. */
export const DEFAULT_QUEUE_CONFIGS: Record<QueueRoute, QueueConfig> = {
	"auto-fix": { gated: false },
	"needs-decision": { gated: true },
	investigation: { gated: true },
	backlog: { gated: false, startOpen: false },
};

/**
 * Pluggable EXECUTE slot. Given the reactive `executeInput` stream of
 * triaged items, produce a stream of `ExecuteOutput` decisions.
 *
 * **Contract** (see design note in `docs/optimizations.md` / session log):
 * 1. Emit DATA exactly once per completed execution — not on input arrival.
 * 2. Cancel in-flight work when a new item supersedes the current one
 *    (`switchMap` is the idiomatic pattern).
 * 3. Do not bypass `input.cache` — the harness pairs output with item via
 *    `withLatestFrom(output, input)`. A side-state mirror of the item can
 *    desync under nested-drain ordering.
 * 4. The returned node IS the primary of a subsequent `withLatestFrom`;
 *    firing on input arrival (rather than result completion) causes verify
 *    to pair with a stale/null ExecuteOutput.
 *
 * `refineExecutor` makes all four rules structurally unreachable.
 */
export type HarnessExecutor = (input: Node<TriagedItem | null>) => Node<ExecuteOutput | null>;

/**
 * Pluggable VERIFY slot. Receives `[executeOutput, triagedItem]` pairs
 * sampled via `withLatestFrom(executeNode, executeInput)` and produces
 * `VerifyOutput` decisions.
 *
 * Same contract rules 1–3 as {@link HarnessExecutor}. Rule 4 does not
 * apply (verify output isn't a primary to a further withLatestFrom).
 *
 * `evalVerifier` handles the re-evaluation case against affected eval tasks.
 */
export type HarnessVerifier = (
	context: Node<[ExecuteOutput | null, TriagedItem | null]>,
) => Node<VerifyOutput | null>;

/** Options for {@link harnessLoop}. */
export interface HarnessLoopOptions {
	/** LLM adapter for promptNode-based stages (triage + any default executor/verifier). */
	adapter: unknown; // LLMAdapter — kept as unknown to avoid circular dep

	/** Custom triage prompt (receives IntakeItem + strategy model as context). */
	triagePrompt?: string | ((...args: unknown[]) => string);

	/**
	 * Execute prompt — sugar over the default LLM executor. Ignored when
	 * `executor` is set.
	 */
	executePrompt?: string | ((...args: unknown[]) => string);

	/**
	 * Verify prompt — sugar over the default LLM verifier. Ignored when
	 * `verifier` is set.
	 */
	verifyPrompt?: string | ((...args: unknown[]) => string);

	/**
	 * Pluggable EXECUTE slot. When omitted, the harness uses a `promptNode`
	 * driven by `adapter` + `executePrompt`. Replace to plug in a
	 * `refineExecutor`, tool-using agent, or any reactive execution pipeline.
	 */
	executor?: HarnessExecutor;

	/**
	 * Pluggable VERIFY slot. When omitted, the harness uses a `promptNode`
	 * driven by `adapter` + `verifyPrompt`. Replace to plug in an
	 * `evalVerifier` that re-runs affected eval tasks.
	 */
	verifier?: HarnessVerifier;

	/** Per-queue configuration overrides. */
	queues?: Partial<Record<QueueRoute, QueueConfig>>;

	/** Priority scoring signals. */
	priority?: PrioritySignals;

	/** Error classifier for fast-retry path. */
	errorClassifier?: ErrorClassifier;

	/** Max fast-retries per item before routing to full intake (default 2). */
	maxRetries?: number;

	/** Global retry cap across all items — circuit breaker (default maxRetries × 10). */
	maxTotalRetries?: number;

	/** Max re-ingestions from verify→intake before giving up (default 1). */
	maxReingestions?: number;

	/** Global reingestion cap across all items — circuit breaker (default maxReingestions × 10). */
	maxTotalReingestions?: number;

	/** Retained limit for topic logs (default 1000). */
	retainedLimit?: number;
}
