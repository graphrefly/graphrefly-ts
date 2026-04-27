/**
 * Harness wiring types (roadmap §9.0).
 *
 * Shared types for the reactive collaboration loop: intake, triage, queue,
 * gate, execute, verify, reflect. These types are intentionally domain-agnostic
 * — the harness loop is not specific to eval workflows.
 *
 * Runtime constants and helpers live in `./defaults.ts`. The harness barrel
 * (`./index.ts`) re-exports both so external consumers see a single surface.
 *
 * @module
 */

import type { Node } from "../../core/node.js";
// Type-only import avoids a runtime cycle with `patterns/ai`.
import type { LLMAdapter } from "../ai/index.js";

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/** Known intake source tags. */
export type KnownIntakeSource = "eval" | "test" | "human" | "code-change" | "hypothesis" | "parity";

/**
 * Sources that can produce intake items. Open union — the known tags
 * retain IDE autocomplete while user-supplied strings (e.g. `"schema"`,
 * `"slack"`) pass through without a type change.
 */
export type IntakeSource = KnownIntakeSource | (string & {});

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

/** Routing destinations after triage. Closed union — iterated via `QUEUE_NAMES`. */
export type QueueRoute = "auto-fix" | "needs-decision" | "investigation" | "backlog";

/**
 * An item entering the harness loop via the INTAKE stage.
 *
 * All intake sources produce this uniform shape — the intake topic
 * doesn't care where items came from.
 *
 * `$`-prefix keys (`$reingestions`, `$retries` on {@link TriagedItem}) are
 * framework-only — an LLM round-tripping the serialized item is far less
 * likely to echo back a `$`-prefixed key than an `_`-prefixed one, which
 * neutralizes the field-collision class that surfaced earlier in the
 * router's spread order.
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
	$reingestions?: number;
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
	$retries?: number;
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

// ---------------------------------------------------------------------------
// Execution & verification
// ---------------------------------------------------------------------------

/**
 * LLM output shape from the EXECUTE stage (partial — lacks `item`).
 *
 * Generic over the artifact type `A` so typed executors like
 * `refineExecutor<T>` can flow `T` through to an `evalVerifier<T>` without
 * the caller casting `artifact` at the boundary. Defaults to `unknown`
 * for escape-hatch executors that carry opaque state.
 */
export type ExecuteOutput<A = unknown> = {
	/**
	 * Execution outcome classification:
	 *
	 * - `"success"`: execution completed cleanly and the artifact (if any) is
	 *   ready for verification. The verifier should proceed with a full
	 *   evaluation pass.
	 * - `"failure"`: execution did not produce a usable artifact — the actuator
	 *   threw, a prompt parse failed, or `shouldApply` skipped the item. The
	 *   verifier should treat this as a non-result and route accordingly.
	 * - `"partial"`: execution produced a candidate that converged but did not
	 *   fully meet verification criteria. Used by `refineExecutor` when the
	 *   iteration cap is reached without full convergence; the artifact holds
	 *   the best candidate achieved.
	 */
	outcome: "success" | "failure" | "partial";
	detail: string;
	/**
	 * Optional opaque artifact that a custom executor (e.g. `refineExecutor`)
	 * may attach so downstream verifiers can re-run evaluation against the
	 * thing that was produced. LLM-backed default executors never populate
	 * this — it's an escape hatch for reactive executors carrying structured
	 * output (a refined prompt, a patched spec, a generated template, ...).
	 */
	artifact?: A;
};

/** Full execution result assembled downstream (LLM output + context). */
export interface ExecutionResult<A = unknown> {
	item: TriagedItem;
	/**
	 * Execution outcome classification. Same semantics as
	 * {@link ExecuteOutput.outcome}:
	 *
	 * - `"success"`: execution completed cleanly; artifact is ready for
	 *   verification.
	 * - `"failure"`: no usable artifact was produced.
	 * - `"partial"`: best candidate produced but convergence criteria not met
	 *   (iteration cap reached in `refineExecutor`).
	 */
	outcome: "success" | "failure" | "partial";
	detail: string;
	/**
	 * Passthrough of {@link ExecuteOutput.artifact} when the executor emitted
	 * one. Reactive executors like `refineExecutor` populate this; LLM-backed
	 * default executors leave it undefined.
	 */
	artifact?: A;
}

/** Whether an error is self-correctable (fast-retry) or structural (full loop). */
export type ErrorClass = "self-correctable" | "structural";

/** Classifier for fast-retry path. */
export type ErrorClassifier = (result: ExecutionResult) => ErrorClass;

// ---------------------------------------------------------------------------
// Verification output
// ---------------------------------------------------------------------------

/** Result of the VERIFY stage. */
export interface VerifyResult<A = unknown> {
	item: TriagedItem;
	execution: ExecutionResult<A>;
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

// ---------------------------------------------------------------------------
// Harness loop configuration
// ---------------------------------------------------------------------------

import type { StrategySnapshot } from "./strategy.js";

/** Per-queue configuration in the harness loop. */
export interface QueueConfig {
	/** Whether this queue is gated (requires human approval). */
	gated: boolean;
	/** Maximum pending items in the gate (default Infinity). */
	maxPending?: number;
	/** Start the gate in open (auto-approve) mode? Only meaningful when `gated: true`. */
	startOpen?: boolean;
}

/**
 * Pluggable EXECUTE slot. Given the reactive `executeInput` stream of
 * triaged items, produce a stream of `ExecuteOutput<A>` decisions.
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
export type HarnessExecutor<A = unknown> = (
	input: Node<TriagedItem | null>,
) => Node<ExecuteOutput<A> | null>;

/**
 * Pluggable VERIFY slot. Receives a pre-paired `[executeOutput, triagedItem]`
 * context node — the harness creates this via `withLatestFrom(executeNode,
 * executeInput)` once and shares it with both the verifier and the internal
 * fast-retry dispatcher, so verifier implementations do NOT need to build
 * their own pairing node (and doubling the `withLatestFrom` would pay the
 * subscription cost twice).
 *
 * Same contract rules 1–3 as {@link HarnessExecutor}. Rule 4 does not
 * apply (verify output isn't a primary to a further withLatestFrom).
 *
 * `evalVerifier` handles the re-evaluation case against affected eval tasks.
 */
export type HarnessVerifier<A = unknown> = (
	context: Node<readonly [ExecuteOutput<A> | null, TriagedItem | null] | null>,
) => Node<VerifyOutput | null>;

/** Triage prompt callable shape — pair of `[intake item, strategy snapshot]`. */
export type TriagePromptFn = (pair: readonly [IntakeItem, StrategySnapshot]) => string;
/** Execute prompt callable shape. */
export type ExecutePromptFn = (item: TriagedItem) => string;
/** Verify prompt callable shape — pair of `[execute output, triaged item]`. */
export type VerifyPromptFn<A = unknown> = (
	pair: readonly [ExecuteOutput<A> | null, TriagedItem | null],
) => string;

/** Options for {@link harnessLoop}. */
export interface HarnessLoopOptions<A = unknown> {
	/** LLM adapter for promptNode-based stages (triage + any default executor/verifier). */
	adapter: LLMAdapter;

	/** Custom triage prompt (receives IntakeItem + strategy snapshot as a tuple). */
	triagePrompt?: string | TriagePromptFn;

	/**
	 * Execute prompt — sugar over the default LLM executor. Ignored when
	 * `executor` is set.
	 */
	executePrompt?: string | ExecutePromptFn;

	/**
	 * Verify prompt — sugar over the default LLM verifier. Ignored when
	 * `verifier` is set.
	 */
	verifyPrompt?: string | VerifyPromptFn<A>;

	/**
	 * Pluggable EXECUTE slot. When omitted, the harness uses a `promptNode`
	 * driven by `adapter` + `executePrompt`. Replace to plug in a
	 * `refineExecutor`, tool-using agent, or any reactive execution pipeline.
	 */
	executor?: HarnessExecutor<A>;

	/**
	 * Pluggable VERIFY slot. When omitted, the harness uses a `promptNode`
	 * driven by `adapter` + `verifyPrompt`. Replace to plug in an
	 * `evalVerifier` that re-runs affected eval tasks.
	 */
	verifier?: HarnessVerifier<A>;

	/** Per-queue configuration overrides. */
	queues?: Partial<Record<QueueRoute, QueueConfig>>;

	/** Priority scoring signals. */
	priority?: PrioritySignals;

	/**
	 * Reactive last-human-interaction timestamp (monotonic ns). Drives the
	 * priority score age-decay term for `HarnessGraph.priorityScores`.
	 *
	 * **Required when `opts.priority` is set.** Priority score nodes only
	 * re-derive when `topic.latest`, `strategy.node`, or this tick settles —
	 * an idle queue would freeze its age at construction time if we
	 * auto-defaulted. Typical sources:
	 *  - `fromTimer(60_000)` — steady tick, uniform decay.
	 *  - `state(monotonicNs())` — bumped from a human-interaction handler.
	 *  - A reactive view over a DB column / external metrics source.
	 */
	lastInteractionNs?: Node<number>;

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

// ---------------------------------------------------------------------------
// Barrel re-exports from defaults.ts — preserves the pre-split import
// surface (`import { QUEUE_NAMES, defaultErrorClassifier } from ".../types"`).
// ---------------------------------------------------------------------------

export {
	DEFAULT_DECAY_RATE,
	DEFAULT_QUEUE_CONFIGS,
	DEFAULT_SEVERITY_WEIGHTS,
	defaultErrorClassifier,
	QUEUE_NAMES,
	strategyKey,
} from "./defaults.js";
